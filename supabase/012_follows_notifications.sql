-- Folgen und Mitteilungen.
--   follows:       wer wem folgt. notify = Mitteilung, wenn das Konto ein neues Buch bewertet (Standard: an).
--   notifications: Mitteilungen an einen Nutzer. Entstehen nur per Trigger: sobald ein gefolgtes Konto
--                  ein Buch im Regal hat UND es zum ersten Mal mit Sternen bewertet. Ein Buch ohne
--                  Bewertung löst nichts aus, ein neu bewertetes altes Buch auch nicht noch einmal.
-- Im Supabase SQL Editor ausführen, bevor die neue script.js online geht. Lässt sich erneut ausführen.

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_not_self check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id);

alter table public.follows enable row level security;

-- Jeder sieht und ändert nur, wem er selbst folgt. Gesperrte Konten folgen niemandem neu.
drop policy if exists follows_select_own on public.follows;
create policy follows_select_own on public.follows
  for select using (follower_id = auth.uid());

drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows
  for insert with check (
    follower_id = auth.uid()
    and not exists (select 1 from public.bans b where b.user_id = auth.uid())
  );

drop policy if exists follows_update_own on public.follows;
create policy follows_update_own on public.follows
  for update using (follower_id = auth.uid()) with check (follower_id = auth.uid());

drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows
  for delete using (follower_id = auth.uid());


create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,  -- Empfänger
  actor_id uuid not null references public.profiles(id) on delete cascade, -- gefolgtes Konto
  book_id uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_once_per_book unique (user_id, book_id)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Lesen, als gelesen markieren und löschen nur die eigenen. Anlegen nur über den Trigger unten.
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete using (user_id = auth.uid());


-- Neues Buch mit Bewertung: alle Follower mit eingeschalteten Mitteilungen bekommen eine.
-- Greift beim Anlegen mit Sternen und beim ersten Bewerten danach (0 -> 1..5), pro Buch höchstens einmal.
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

drop trigger if exists books_notify_followers on public.books;
create trigger books_notify_followers
  after insert or update of rating on public.books
  for each row execute function public.notify_followers_book_rated();


-- Wem ich folge, mit Namen und Bild. Über eine Funktion, weil private Profile in der Tabelle
-- profiles für andere unsichtbar sind; gefolgt werden kann ihnen trotzdem (per Link).
create or replace function public.my_follows()
returns table (id uuid, username text, display_name text, avatar_url text, notify boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username::text, p.display_name::text, p.avatar_url::text, f.notify, f.created_at
  from follows f
  join profiles p on p.id = f.followee_id
  where f.follower_id = auth.uid()
    and p.username is not null
    and not exists (select 1 from bans b where b.user_id = p.id)
  order by lower(coalesce(nullif(trim(p.display_name), ''), p.username));
$$;

revoke all on function public.my_follows() from public;
grant execute on function public.my_follows() to authenticated;


-- Die eigenen Mitteilungen mit Buch und Absender, neueste zuerst.
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
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.my_notifications(integer) from public;
grant execute on function public.my_notifications(integer) to authenticated;


-- Live-Zustellung: neue Mitteilungen erscheinen ohne Neuladen (RLS gilt auch hier).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
