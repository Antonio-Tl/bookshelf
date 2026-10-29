-- Zweite Härtung nach dem Sicherheits-Check (Oktober 2026), Grundlage: supabase/audit.sql.
--   Rechte:   anon und authenticated hatten auf JEDE Tabelle alle Rechte (Supabase-Standard), auch TRUNCATE,
--             das RLS nicht prüft. Über die API ist TRUNCATE nicht erreichbar, aber jede Regel, die fehlt,
--             soll nicht die einzige Sperre sein. Gäste schreiben nie; Tabellen, die nur Funktionen
--             beschreiben, bekommen keine direkten Schreibrechte; bei notifications und follows darf man
--             nur die Spalte ändern, die die App ändert (sonst ließen sich z. B. eigene Mitteilungen mit
--             fremdem Absender fälschen).
--   Trigger:  check_book_shelf_owner und check_shelf_category_owner liefen mit den Rechten des Nutzers.
--             Ein Regal oder eine Kategorie eines gesperrten Kontos ist für ihn unsichtbar, die Abfrage
--             ergab NULL, und "NULL <> x" lässt die Prüfung durchgehen: man konnte ein Buch in ein
--             fremdes (gesperrtes) Regal stellen. Jetzt mit Besitzerrechten und "is distinct from".
-- Im Supabase SQL Editor ausführen. Lässt sich erneut ausführen.

begin;

-- ---- Tabellenrechte ----
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Nur über security-definer-Funktionen beschrieben.
revoke insert, update, delete on public.admin_log, public.admins, public.bans, public.premium_members,
  public.scan_log, public.username_holds from authenticated;
-- Nur über Funktionen gelesen (admin_list_log, claim_scan, guard_profile_update).
revoke select on public.admin_log, public.scan_log, public.username_holds from anon, authenticated;

-- Mitteilungen entstehen nur per Trigger; ändern darf man nur "gelesen".
revoke insert, update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Beim Folgen lässt sich nur die Glocke umschalten.
revoke update on public.follows from authenticated;
grant update (notify) on public.follows to authenticated;

-- Neue Tabellen bekommen TRUNCATE & Co. gar nicht erst.
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- ---- Funktionen ----
-- Nur für eingeloggte Nutzer sinnvoll.
revoke execute on function public.my_follows() from anon;
revoke execute on function public.my_notifications(integer) from anon;
-- Trigger-Funktionen ruft niemand direkt auf.
revoke execute on function public.guard_profile_update(), public.handle_new_user(),
  public.check_book_shelf_owner(), public.check_shelf_category_owner(), public.set_updated_at()
  from public, anon, authenticated;
-- is_admin() und is_banned() bleiben für anon: die Lese-Regeln der Tabellen rufen sie auf.

-- ---- Besitzer-Prüfungen ----
create or replace function public.check_book_shelf_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shelf_id is not null
     and (select user_id from public.shelves where id = new.shelf_id) is distinct from new.user_id then
    raise exception 'shelf gehört nicht diesem Benutzer';
  end if;
  return new;
end;
$$;

create or replace function public.check_shelf_category_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select user_id from public.shelves where id = new.shelf_id)
     is distinct from (select user_id from public.categories where id = new.category_id) then
    raise exception 'Kategorie gehört nicht demselben Benutzer wie das Regal';
  end if;
  return new;
end;
$$;

-- create or replace setzt die Rechte nicht zurück, aber sicher ist sicher.
revoke execute on function public.check_book_shelf_owner(), public.check_shelf_category_owner()
  from public, anon, authenticated;

commit;
