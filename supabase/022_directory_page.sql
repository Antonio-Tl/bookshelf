-- Übersicht „Bücherregale“ seitenweise statt alles auf einmal. Bisher hat die Seite alle gelisteten Profile
-- und bis zu 5.000 Bücher geladen und daraus im Browser Karten gebaut. directory_page() liefert pro Profil
-- nur Zahlen, die ersten Reihentitel und bis zu sechs Bücher für die Cover-Reihe, je Seite höchstens 50.
-- Security invoker: es gelten dieselben Lese-Regeln (RLS) wie für die Tabellen selbst.
-- Im Supabase SQL Editor ausführen, bevor die neue script.js online geht. Lässt sich erneut ausführen.

create or replace function public.directory_page(p_query text default '', p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid, username text, display_name text, avatar_url text, created_at timestamptz,
  book_count integer, series_count integer, series text[], picks jsonb, total bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    -- % und _ im Suchbegriff wörtlich nehmen
    select '%' || replace(replace(replace(coalesce(trim(p_query), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           coalesce(trim(p_query), '') = '' as all_rows
  ),
  listed as (
    select p.id, p.username, p.display_name, p.avatar_url, p.created_at
    from profiles p, q
    where p.username is not null and p.listed and not p.is_private
      and (q.all_rows or p.username ilike q.pat or p.display_name ilike q.pat)
  ),
  open_books as (
    select b.id, b.user_id, b.shelf_id, s.label, b.title, b.author, b.series_order, b.page_count, b.cover_url,
           min(b.series_order) over (partition by b.shelf_id) as first_order
    from books b
    join shelves s on s.id = b.shelf_id and not s.is_private
    where b.user_id in (select l.id from listed l) and not b.is_private
  ),
  counts as (
    select ob.user_id, count(*)::integer as book_count, count(distinct ob.shelf_id)::integer as series_count
    from open_books ob group by ob.user_id
  ),
  series_names as (
    select x.user_id, (array_agg(x.label order by x.label))[1:4] as series
    from (select distinct ob.user_id, ob.label from open_books ob) x
    group by x.user_id
  ),
  -- Cover-Reihe: erst die Vitrine, dann der erste Band jeder Reihe, dann die Folgebände
  ranked as (
    select ob.*,
           row_number() over (
             partition by ob.user_id
             order by case
                        when ob.id = any(coalesce(sc.book_ids, '{}')) then 0
                        when ob.series_order = ob.first_order then 1
                        else 2
                      end,
                      ob.label, ob.series_order, ob.id
           ) as pick_no
    from open_books ob
    left join showcases_of(array(select l.id from listed l)) sc on sc.user_id = ob.user_id
  ),
  picks as (
    select r.user_id,
           jsonb_agg(jsonb_build_object(
             'id', r.id, 'user_id', r.user_id, 'shelf_id', r.shelf_id, 'label', r.label, 'title', r.title,
             'author', r.author, 'series_order', r.series_order, 'page_count', r.page_count, 'cover_url', r.cover_url
           ) order by r.pick_no) as picks
    from ranked r where r.pick_no <= 6
    group by r.user_id
  )
  select l.id, l.username, l.display_name, l.avatar_url, l.created_at,
         coalesce(c.book_count, 0), coalesce(c.series_count, 0), coalesce(sn.series, '{}'), coalesce(pk.picks, '[]'),
         count(*) over ()
  from listed l
  left join counts c on c.user_id = l.id
  left join series_names sn on sn.user_id = l.id
  left join picks pk on pk.user_id = l.id
  order by (l.username = 'antonio') desc, coalesce(c.book_count, 0) desc, l.username
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.directory_page(text, integer, integer) from public;
grant execute on function public.directory_page(text, integer, integer) to anon, authenticated;
