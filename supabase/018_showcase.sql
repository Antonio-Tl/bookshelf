-- Vitrine (Premium): die erste Reihe im Regal, Cover nach vorne. Entweder eine ganze Reihe (shelf_id)
-- oder bis zu fünf einzelne Bücher in fester Reihenfolge (book_ids), nie beides.
--   showcases:      eine Zeile pro Konto. Lesen, anlegen, ändern, löschen nur die eigene; anlegen und ändern
--                   nur mit Premium (can_use_premium()). Löschen geht immer.
--   showcases_of(): was andere sehen. Nur Konten, die gerade Premium (oder Admin) und nicht gesperrt sind;
--                   läuft Premium aus, bleibt die Auswahl gespeichert, wird aber nicht mehr gezeigt.
--                   Private Reihen und Bücher (017_private_items.sql) und fremde IDs fallen heraus.
-- Im Supabase SQL Editor ausführen, NACH 017_private_items.sql und bevor die neue script.js online geht.
-- Lässt sich erneut ausführen.

begin;

create table if not exists public.showcases (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  shelf_id uuid references public.shelves(id) on delete set null,
  book_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint showcases_one_mode check (shelf_id is null or cardinality(book_ids) = 0),
  constraint showcases_max_books check (cardinality(book_ids) <= 5)
);

alter table public.showcases enable row level security;

drop policy if exists showcases_select_own on public.showcases;
create policy showcases_select_own on public.showcases
  for select using (user_id = auth.uid());

drop policy if exists showcases_insert_own on public.showcases;
create policy showcases_insert_own on public.showcases
  for insert with check (user_id = auth.uid() and public.can_use_premium());

drop policy if exists showcases_update_own on public.showcases;
create policy showcases_update_own on public.showcases
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_use_premium());

drop policy if exists showcases_delete_own on public.showcases;
create policy showcases_delete_own on public.showcases
  for delete using (user_id = auth.uid());

-- Gäste schreiben nie (wie in 016); gelesen wird nur über showcases_of().
revoke all on public.showcases from anon;

create or replace function public.showcases_of(p_users uuid[])
returns table (user_id uuid, shelf_id uuid, book_ids uuid[])
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id,
         sh.id,
         array(
           select b.id
           from unnest(s.book_ids) with ordinality as u(id, ord)
           join books b on b.id = u.id and b.user_id = s.user_id and not b.is_private
           where not exists (select 1 from shelves bs where bs.id = b.shelf_id and bs.is_private)
           order by u.ord
         )
  from showcases s
  left join shelves sh on sh.id = s.shelf_id and sh.user_id = s.user_id and not sh.is_private
  where s.user_id = any(p_users)
    and not exists (select 1 from bans x where x.user_id = s.user_id)
    and (exists (select 1 from premium_members pm where pm.user_id = s.user_id)
         or exists (select 1 from admins a where a.user_id = s.user_id))
  limit 200;
$$;

revoke all on function public.showcases_of(uuid[]) from public;
grant execute on function public.showcases_of(uuid[]) to anon, authenticated;

commit;
