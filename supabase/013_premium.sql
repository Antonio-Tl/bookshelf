-- Premium: Konten, die Premium-Funktionen nutzen dürfen (zuerst: Regal scannen).
--   premium_members:   eine Zeile pro Premium-Konto. Jeder sieht nur die eigene Zeile. Schreiben kann
--                      niemand direkt (keine insert/update/delete-Policy), nur über admin_set_premium.
--   admin_set_premium: Admins vergeben oder entziehen Premium. Wie alle Admin-Aktionen nur mit
--                      Zwei-Faktor (assert_admin) und mit Eintrag im Admin-Protokoll.
--   can_use_premium(): Premium oder Admin, nicht gesperrt. Die App blendet damit den Scan-Knopf ein,
--                      der Worker prüft es vor jedem Scan noch einmal mit dem Login des Nutzers.
--   admin_list_users:  bekommt die Spalte is_premium (neu angelegt, weil sich der Rückgabetyp ändert).
-- Im Supabase SQL Editor ausführen, bevor die neue script.js online geht. Lässt sich erneut ausführen.

create table if not exists public.premium_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  -- Später für Käufe; bis dahin vergeben nur Admins.
  source text not null default 'admin' check (source in ('admin', 'purchase'))
);

alter table public.premium_members enable row level security;

drop policy if exists premium_select_own on public.premium_members;
create policy premium_select_own on public.premium_members
  for select using (user_id = auth.uid());

create or replace function public.can_use_premium()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and not public.is_banned(auth.uid())
    and (
      exists (select 1 from public.premium_members where user_id = auth.uid())
      or exists (select 1 from public.admins where user_id = auth.uid())
    );
$$;
revoke execute on function public.can_use_premium() from public, anon;
grant execute on function public.can_use_premium() to authenticated;

create or replace function public.admin_set_premium(target uuid, premium boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_admin();
  if premium then
    insert into public.premium_members (user_id, granted_by) values (target, auth.uid())
    on conflict (user_id) do nothing;
  else
    delete from public.premium_members where user_id = target;
  end if;
  perform public.log_admin_action(case when premium then 'premium_on' else 'premium_off' end, target);
end;
$$;
revoke execute on function public.admin_set_premium(uuid, boolean) from public, anon;
grant execute on function public.admin_set_premium(uuid, boolean) to authenticated;

drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table(id uuid, username text, display_name text, avatar_url text, email text,
  created_at timestamp with time zone, last_sign_in_at timestamp with time zone,
  book_count bigint, shelf_count bigint, banned_at timestamp with time zone, ban_reason text,
  is_admin boolean, is_premium boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query
  select p.id, p.username, p.display_name, p.avatar_url, u.email::text, p.created_at, u.last_sign_in_at,
    (select count(*) from public.books b where b.user_id = p.id),
    (select count(*) from public.shelves s where s.user_id = p.id),
    bn.banned_at, bn.reason,
    exists (select 1 from public.admins a where a.user_id = p.id),
    exists (select 1 from public.premium_members pm where pm.user_id = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.bans bn on bn.user_id = p.id
  order by p.created_at;
end;
$$;
