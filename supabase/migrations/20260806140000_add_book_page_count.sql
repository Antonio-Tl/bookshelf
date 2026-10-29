-- Optionale Seitenzahl pro Buch.
alter table public.books
  add column page_count integer;

alter table public.books
  add constraint books_page_count_check check (page_count is null or page_count > 0);
