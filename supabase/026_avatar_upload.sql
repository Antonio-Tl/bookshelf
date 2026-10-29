-- Eigenes Profilbild: Dateien liegen im öffentlichen Storage-Bucket „avatars“, je Konto ein Ordner <user-id>/.
-- Der Browser schneidet das Bild quadratisch zu und verkleinert es auf 512 × 512 JPEG (js/account.js).
-- profiles.avatar_url darf vom Konto selbst nur noch auf ein Bild im eigenen Ordner, auf das Bild vom
-- Anmeldeanbieter (Google, Apple) oder auf leer gesetzt werden, nicht auf beliebige fremde Adressen.
-- Im Supabase SQL Editor ausführen, NACH 025_import_books.sql und bevor die neue script.js online geht.
-- Lässt sich erneut ausführen.

begin;

-- guard_profile_update() steht nicht im Repository. Falls sie avatar_url sperrt, ginge der Upload ins Leere.
do $$
begin
  if pg_get_functiondef('public.guard_profile_update'::regproc) ilike '%avatar_url%' then
    raise exception 'guard_profile_update() erwähnt avatar_url: bitte vor dieser Migration prüfen, ob sie Änderungen daran sperrt.';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

-- Öffentlich lesbar ist der Bucket ohnehin (über die öffentliche Adresse). Auflisten, Hochladen und Löschen
-- nur im eigenen Ordner, gesperrte Konten gar nicht.
drop policy if exists avatars_own_select on storage.objects;
create policy avatars_own_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_own_insert on storage.objects;
create policy avatars_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
    and not public.is_banned(auth.uid()));

drop policy if exists avatars_own_delete on storage.objects;
create policy avatars_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Nur Änderungen aus dem Browser prüfen (Rolle authenticated); Supabase selbst und der SQL Editor bleiben frei.
create or replace function public.check_avatar_url()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
begin
  if new.avatar_url is null or new.avatar_url is not distinct from old.avatar_url
     or coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if new.avatar_url like 'https://zlbedwktggcdyfvaerop.supabase.co/storage/v1/object/public/avatars/' || new.id::text || '/%'
     and new.avatar_url !~ '\.\.' then
    return new;
  end if;
  select raw_user_meta_data into meta from auth.users where id = new.id;
  if new.avatar_url in (meta->>'avatar_url', meta->>'picture') then
    return new;
  end if;
  raise exception 'avatar_url_not_allowed';
end;
$$;
revoke execute on function public.check_avatar_url() from public, anon, authenticated;

drop trigger if exists check_avatar_url on public.profiles;
create trigger check_avatar_url before update of avatar_url on public.profiles
  for each row execute function public.check_avatar_url();

commit;
