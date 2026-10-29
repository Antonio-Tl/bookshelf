-- Private Reihen und Bücher, auch in einem öffentlichen Regal.
--   shelves.is_private: die ganze Reihe samt allen Bänden sieht nur der Besitzer.
--   books.is_private:   nur dieses Buch sieht nur der Besitzer.
-- Andere bekommen private Einträge gar nicht erst aus der Datenbank (nicht nur ausgeblendet), auch
-- nicht über den Link auf ein Regal. Admins sehen sie auch nicht; die Buchzahl in der Admin-Ansicht
-- zählt sie weiter mit.
-- Mitteilungen: ein privates Buch (oder ein Buch in einer privaten Reihe) löst keine aus, und schon
-- verschickte verschwinden, sobald das Buch privat wird.
-- Im Supabase SQL Editor ausführen, bevor die neue script.js online geht. Lässt sich erneut ausführen.

begin;

alter table public.shelves add column if not exists is_private boolean not null default false;
alter table public.books add column if not exists is_private boolean not null default false;

-- Restrictive: gilt zusätzlich zu den bestehenden Lese-Regeln, ersetzt sie nicht.
drop policy if exists shelves_hide_private on public.shelves;
create policy shelves_hide_private on public.shelves
  as restrictive for select
  using (user_id = auth.uid() or not is_private);

-- Ein Buch ist nur sichtbar, wenn auch seine Reihe sichtbar ist. Die Abfrage auf shelves läuft mit den
-- Rechten des Lesers, eine private Reihe findet sie also nicht (und damit auch keins ihrer Bücher).
drop policy if exists books_hide_private on public.books;
create policy books_hide_private on public.books
  as restrictive for select
  using (
    user_id = auth.uid()
    or (not is_private
        and (shelf_id is null or exists (select 1 from public.shelves s where s.id = books.shelf_id)))
  );

create or replace function public.notify_followers_book_rated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

create or replace function public.my_notifications(p_limit integer default 40)
returns table (
  id uuid, created_at timestamptz, read_at timestamptz,
  book_id uuid, title text, author text, rating integer, cover_url text,
  username text, display_name text, avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.created_at, n.read_at,
         b.id, b.title::text, b.author::text, b.rating::integer, b.cover_url::text,
         p.username::text, p.display_name::text, p.avatar_url::text
  from notifications n
  join books b on b.id = n.book_id
  join profiles p on p.id = n.actor_id
  where n.user_id = auth.uid()
    and p.username is not null
    and not exists (select 1 from bans x where x.user_id = p.id)
    and not b.is_private
    and not exists (select 1 from shelves s where s.id = b.shelf_id and s.is_private)
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

-- create or replace behält die Rechte, aber sicher ist sicher (wie in 012/016).
revoke all on function public.notify_followers_book_rated() from public, anon, authenticated;
revoke all on function public.my_notifications(integer) from public, anon;
grant execute on function public.my_notifications(integer) to authenticated;

commit;
