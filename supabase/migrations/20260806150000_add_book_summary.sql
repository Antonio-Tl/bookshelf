-- Optionaler Klappentext pro Buch (worum es im Buch geht).
alter table public.books
  add column summary text;
