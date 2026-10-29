-- Link-Vorschau für geteilte Regale (WhatsApp, Instagram, Suchmaschinen). Der Worker ruft shelf_preview()
-- beim Aufruf von /@name auf und schreibt Titel, Beschreibung und Bild in die Seite, bevor sie ausgeliefert
-- wird. Liefert nur, was der Link ohnehin zeigt: Namen, Zahl der öffentlichen Bücher, die größten Reihen
-- und ein Cover (Vitrine zuerst, sonst das bestbewertete). Private Reihen und Bücher zählen nicht mit,
-- gesperrte Konten liefern nichts.
-- Im Supabase SQL Editor ausführen, bevor der neue worker.js online geht. Lässt sich erneut ausführen.

create or replace function public.shelf_preview(p_username text)
returns table (username text, display_name text, is_private boolean, listed boolean, book_count integer, series text[], cover_url text)
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select pr.id, pr.username, pr.display_name, pr.is_private, pr.listed
    from profiles pr
    where pr.username = lower(p_username)
      and not exists (select 1 from bans b where b.user_id = pr.id)
    limit 1
  ),
  open_books as (
    select b.id, b.cover_url, b.rating, b.date_read, s.label
    from books b
    join shelves s on s.id = b.shelf_id and not s.is_private
    where b.user_id = (select p.id from p) and not b.is_private
  ),
  showcase as (
    select unnest(sc.book_ids) as id from showcases_of(array(select p.id from p)) sc
  )
  select p.username, p.display_name, p.is_private, p.listed,
         (select count(*)::integer from open_books),
         array(select ob.label from open_books ob group by ob.label order by count(*) desc, ob.label limit 3),
         (select ob.cover_url from open_books ob
          where ob.cover_url like 'https://%'
          order by (ob.id in (select s.id from showcase s)) desc, ob.rating desc nulls last, ob.date_read desc nulls last
          limit 1)
  from p;
$$;

revoke all on function public.shelf_preview(text) from public;
grant execute on function public.shelf_preview(text) to anon, authenticated;
