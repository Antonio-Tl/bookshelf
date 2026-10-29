-- Import aus Goodreads und StoryGraph: import_books() legt viele Bücher in einem Aufruf an, jede Reihe als
-- eigenes Regalbrett (bestehende Reihen gleichen Namens werden weiterverwendet). Der Browser liest die
-- CSV-Datei selbst; hierher kommen nur Titel, Autor, Reihe, Band, Bewertung, Lesedatum, Seiten, Status
-- und auf Wunsch die Rezension als Notiz.
-- Während des Imports schickt der Trigger keine Mitteilungen an Follower (sonst bekämen sie eine pro
-- bewertetem Buch, bei einem großen Import Hunderte).
-- Security invoker: es gelten dieselben Regeln (RLS, Sperren, Besitzer-Prüfungen) wie beim Anlegen per Hand.
-- Im Supabase SQL Editor ausführen, NACH 024_reading_status.sql und bevor die neue script.js online geht.
-- Lässt sich erneut ausführen.

begin;

-- Wie in 017_private_items.sql, nur: während import_books() keine Mitteilungen.
create or replace function public.notify_followers_book_rated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('bookshelf.importing', true) = 'on' then
    return new;
  end if;
  if coalesce(new.rating, 0) > 0 and (tg_op = 'INSERT' or coalesce(old.rating, 0) = 0) then
    if exists (select 1 from bans b where b.user_id = new.user_id) then
      return new;
    end if;
    if new.is_private or exists (select 1 from shelves s where s.id = new.shelf_id and s.is_private) then
      return new;
    end if;
    insert into notifications (user_id, actor_id, book_id)
    select f.follower_id, new.user_id, new.id
    from follows f
    where f.followee_id = new.user_id and f.notify
    on conflict (user_id, book_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_followers_book_rated() from public, anon, authenticated;

-- p_books: [{title, author, series, series_order, rating, date_read, page_count, status, notes}, …],
-- höchstens 500 pro Aufruf (die App teilt größere Importe auf). Gibt die Zahl der angelegten Bücher zurück.
create or replace function public.import_books(p_books jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  v_title text;
  v_label text;
  v_shelf uuid;
  v_order integer;
  v_date date;
  added integer := 0;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_typeof(p_books) <> 'array' or jsonb_array_length(p_books) > 500 then
    raise exception 'bad import';
  end if;
  perform set_config('bookshelf.importing', 'on', true);

  for item in select value from jsonb_array_elements(p_books) loop
    v_title := left(trim(coalesce(item->>'title', '')), 300);
    continue when v_title = '';
    v_label := left(trim(coalesce(item->>'series', '')), 200);
    if v_label = '' then v_label := left(v_title, 200); end if;

    select s.id into v_shelf from shelves s
    where s.user_id = uid and s.is_series and lower(s.label) = lower(v_label)
    limit 1;
    if v_shelf is null then
      insert into shelves (label, is_series) values (v_label, true) returning id into v_shelf;
    end if;

    v_order := case when item->>'series_order' ~ '^\d{1,4}$' then (item->>'series_order')::integer end;
    if v_order is null or exists (select 1 from books b where b.shelf_id = v_shelf and b.series_order = v_order) then
      select coalesce(max(b.series_order), 0) + 1 into v_order from books b where b.shelf_id = v_shelf;
    end if;

    v_date := null;
    if item->>'date_read' ~ '^\d{4}-\d{2}-\d{2}$' then
      begin
        v_date := (item->>'date_read')::date;
      exception when others then
        v_date := null;
      end;
    end if;

    insert into books (shelf_id, title, author, series_order, rating, notes, summary, date_read, page_count, cover_url, status)
    values (
      v_shelf,
      v_title,
      left(trim(coalesce(item->>'author', '')), 200),
      v_order,
      case when item->>'rating' ~ '^[0-5]$' then (item->>'rating')::integer else 0 end,
      left(coalesce(item->>'notes', ''), 5000),
      null,
      v_date,
      case when item->>'page_count' ~ '^\d{1,5}$' and (item->>'page_count')::integer > 0 then (item->>'page_count')::integer end,
      null,
      case when item->>'status' in ('read', 'reading', 'want') then item->>'status' else 'read' end
    );
    added := added + 1;
  end loop;
  return added;
end;
$$;

revoke all on function public.import_books(jsonb) from public, anon;
grant execute on function public.import_books(jsonb) to authenticated;

commit;
