-- Sichtbarkeit von Profilen.
--   is_private: taucht weder in der Übersicht noch in „Leute finden“ auf. Wer den Link
--               (?u=name) hat, sieht das Regal trotzdem.
--   listed:     öffentliches Profil, das ausdrücklich in der Übersicht „Bücherregale“
--               stehen möchte. Standard: nein.
-- Im Supabase SQL Editor ausführen, bevor die neue script.js online geht.

alter table public.profiles
  add column if not exists is_private boolean not null default false,
  add column if not exists listed boolean not null default false;

-- Ein privates Profil steht nie in der Übersicht.
alter table public.profiles drop constraint if exists profiles_private_not_listed;
alter table public.profiles
  add constraint profiles_private_not_listed check (not (is_private and listed));

-- Antonios Regal steht in der Übersicht.
update public.profiles set listed = true where username = 'antonio';

-- Private Profile sind bei Abfragen auf die Tabelle unsichtbar (außer für einen selbst).
-- Restrictive: gilt zusätzlich zu den bestehenden Lese-Regeln, ersetzt sie nicht.
drop policy if exists profiles_hide_private on public.profiles;
create policy profiles_hide_private on public.profiles
  as restrictive for select
  using (not is_private or id = auth.uid());

-- Das Regal per Link öffnen: Nachschlagen über den genauen Nutzernamen, auch bei privaten
-- Profilen. Gesperrte Konten sieht nur der Besitzer selbst.
create or replace function public.profile_by_username(p_username text)
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.profiles p
  where p.username = lower(p_username)
    and (p.id = auth.uid() or not exists (select 1 from public.bans b where b.user_id = p.id))
  limit 1;
$$;

revoke all on function public.profile_by_username(text) from public;
grant execute on function public.profile_by_username(text) to anon, authenticated;
