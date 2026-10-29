-- Vitrine: höchstens drei Bücher. Eine Reihe zeigt nicht mehr alle Bände, sondern bis zu drei
-- ausgewählte daraus: shelf_id = die Reihe (gibt den Titel vor), book_ids = die gewählten Bände.
-- Ohne shelf_id bleiben es bis zu drei einzelne Lieblingsbücher aus beliebigen Reihen.
-- Im Supabase SQL Editor ausführen, NACH 018_showcase.sql und bevor die neue script.js online geht.
-- Lässt sich erneut ausführen.

begin;

-- Bisherige Reihen-Vitrinen (ganze Reihe, keine Bände gewählt): die ersten drei Bände übernehmen.
update public.showcases s
set book_ids = array(
  select b.id from public.books b
  where b.shelf_id = s.shelf_id and b.user_id = s.user_id and not b.is_private
  order by b.series_order
  limit 3
)
where s.shelf_id is not null and cardinality(s.book_ids) = 0;

update public.showcases set book_ids = book_ids[1:3] where cardinality(book_ids) > 3;

alter table public.showcases drop constraint if exists showcases_one_mode;
alter table public.showcases drop constraint if exists showcases_max_books;
alter table public.showcases add constraint showcases_max_books check (cardinality(book_ids) <= 3);

-- Wie in 018, nur: bei einer Reihe zählen nur Bände aus genau dieser Reihe.
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
             and (s.shelf_id is null or b.shelf_id = s.shelf_id)
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
