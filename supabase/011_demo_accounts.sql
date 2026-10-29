-- Drei Demo-Regale für die Übersicht „Bücherregale“ (Lena Marie, Jonas, Sophie).
-- Die Konten haben kein Passwort und keinen Google-Login: niemand kann sich damit anmelden.
-- Mit festen IDs; das Skript lässt sich gefahrlos erneut ausführen und setzt die Regale dann neu auf.
-- Im Supabase SQL Editor ausführen, nach 010_profile_visibility.sql.
-- Entfernen: nur den Block „Aufräumen“ ausführen.

begin;

-- Aufräumen
delete from public.shelf_categories where shelf_id in (select id from public.shelves where user_id in ('c113063e-8ba8-5334-96d0-ccc9d40420a3', '9bb67999-39d3-55f6-a80e-109f39b628ad', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a'));
delete from public.books where user_id in ('c113063e-8ba8-5334-96d0-ccc9d40420a3', '9bb67999-39d3-55f6-a80e-109f39b628ad', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a');
delete from public.shelves where user_id in ('c113063e-8ba8-5334-96d0-ccc9d40420a3', '9bb67999-39d3-55f6-a80e-109f39b628ad', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a');
delete from public.categories where user_id in ('c113063e-8ba8-5334-96d0-ccc9d40420a3', '9bb67999-39d3-55f6-a80e-109f39b628ad', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a');
delete from public.profiles where id in ('c113063e-8ba8-5334-96d0-ccc9d40420a3', '9bb67999-39d3-55f6-a80e-109f39b628ad', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a');
delete from auth.users where id in ('c113063e-8ba8-5334-96d0-ccc9d40420a3', '9bb67999-39d3-55f6-a80e-109f39b628ad', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a');

-- Konten (ein Trigger legt dabei je eine leere Profilzeile an)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'authenticated', 'authenticated', 'lenamarie@demo.invalid', '', '2026-08-19 18:42:07+02', '{"provider":"email","providers":["email"]}', '{}', '2026-08-19 18:42:07+02', '2026-08-19 18:42:07+02', '', '', '', '');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'authenticated', 'authenticated', 'jonas_kr@demo.invalid', '', '2026-09-03 21:15:44+02', '{"provider":"email","providers":["email"]}', '{}', '2026-09-03 21:15:44+02', '2026-09-03 21:15:44+02', '', '', '', '');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000000', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'authenticated', 'authenticated', 'sophie_liest@demo.invalid', '', '2026-08-28 09:03:51+02', '{"provider":"email","providers":["email"]}', '{}', '2026-08-28 09:03:51+02', '2026-08-28 09:03:51+02', '', '', '', '');

-- Profile. Die Trigger auf profiles setzen u. a. created_at zurück; damit das Beitrittsdatum stimmt,
-- sind sie nur innerhalb dieser Transaktion aus (andere Sitzungen merken davon nichts).
do $$ declare t record; begin
  for t in select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal loop
    execute format('alter table public.profiles disable trigger %I', t.tgname);
  end loop;
end $$;
insert into public.profiles (id, username, display_name, avatar_url, created_at, is_private, listed)
values ('c113063e-8ba8-5334-96d0-ccc9d40420a3', 'lenamarie', 'Lena Marie', null, '2026-08-19 18:42:07+02', false, true)
on conflict (id) do update set username = excluded.username, display_name = excluded.display_name, avatar_url = null,
  created_at = excluded.created_at, username_changed_at = null, is_private = false, listed = true;
insert into public.profiles (id, username, display_name, avatar_url, created_at, is_private, listed)
values ('9bb67999-39d3-55f6-a80e-109f39b628ad', 'jonas_kr', 'Jonas', null, '2026-09-03 21:15:44+02', false, true)
on conflict (id) do update set username = excluded.username, display_name = excluded.display_name, avatar_url = null,
  created_at = excluded.created_at, username_changed_at = null, is_private = false, listed = true;
insert into public.profiles (id, username, display_name, avatar_url, created_at, is_private, listed)
values ('1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'sophie_liest', 'Sophie', null, '2026-08-28 09:03:51+02', false, true)
on conflict (id) do update set username = excluded.username, display_name = excluded.display_name, avatar_url = null,
  created_at = excluded.created_at, username_changed_at = null, is_private = false, listed = true;
do $$ declare t record; begin
  for t in select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal loop
    execute format('alter table public.profiles enable trigger %I', t.tgname);
  end loop;
end $$;

-- @lenamarie
insert into public.categories (id, user_id, name, created_at) values ('9d467aa7-909c-5446-b2d8-c0b23ca2d3fa', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'Fantasy', '2026-08-19 18:42:07+02');
insert into public.categories (id, user_id, name, created_at) values ('a4809561-4e42-5f03-8e4b-441b61852dec', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'Romantasy', '2026-08-19 18:42:07+02');
insert into public.categories (id, user_id, name, created_at) values ('6110b1d8-726e-5670-8304-7fa032d60471', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'Young Adult', '2026-08-19 18:42:07+02');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('b86579bb-0512-54f5-bd69-8a132d891bc6', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'Das Reich der sieben Höfe', true, '2026-08-19T18:46:07+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('b86579bb-0512-54f5-bd69-8a132d891bc6', '9d467aa7-909c-5446-b2d8-c0b23ca2d3fa');
insert into public.shelf_categories (shelf_id, category_id) values ('b86579bb-0512-54f5-bd69-8a132d891bc6', 'a4809561-4e42-5f03-8e4b-441b61852dec');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('53dfffe3-e191-5208-98d1-f98c1e5c785a', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'b86579bb-0512-54f5-bd69-8a132d891bc6', 'Dornen und Rosen', 'Sarah J. Maas', 1, 4, 'Anfang zieht sich ein bisschen, ab der Hälfte konnte ich nicht mehr aufhören', '2025-11-08', 512, 'https://covers.openlibrary.org/b/id/12589177-M.jpg', '2026-08-19T18:47:07+02:00', '2026-08-19T18:47:07+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('547c2167-c11f-5b89-9dba-a00bdc347564', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'b86579bb-0512-54f5-bd69-8a132d891bc6', 'Flammen und Finsternis', 'Sarah J. Maas', 2, 5, 'RHYSAND. Mehr muss man nicht sagen', '2025-11-23', 688, 'https://covers.openlibrary.org/b/id/12589279-M.jpg', '2026-08-19T18:48:07+02:00', '2026-08-19T18:48:07+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('d2203fd7-7fdd-5e7e-91ec-c8dbdd00e60c', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'b86579bb-0512-54f5-bd69-8a132d891bc6', 'Sterne und Schwerter', 'Sarah J. Maas', 3, 5, null, '2025-12-14', 768, 'https://covers.openlibrary.org/b/id/14348724-M.jpg', '2026-08-19T18:49:07+02:00', '2026-08-19T18:49:07+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('9479ad8a-1cc7-558a-9d7f-833a225abdec', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'b86579bb-0512-54f5-bd69-8a132d891bc6', 'Frost und Mondlicht', 'Sarah J. Maas', 4, 3, 'Nett für zwischendurch, passiert aber kaum was', '2025-12-21', 272, 'https://covers.openlibrary.org/b/id/14348652-M.jpg', '2026-08-19T18:50:07+02:00', '2026-08-19T18:50:07+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('fc6e6360-39fe-5214-8960-8e50f821e590', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'b86579bb-0512-54f5-bd69-8a132d891bc6', 'Silbernes Feuer', 'Sarah J. Maas', 5, 4, 'Nesta hat mich am Anfang genervt, am Ende war sie meine Lieblingsfigur', '2026-01-30', 864, 'https://covers.openlibrary.org/b/id/12589611-M.jpg', '2026-08-19T18:51:07+02:00', '2026-08-19T18:51:07+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('5abb2678-9329-5e8e-abb3-0113c00851ef', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'Die Tribute von Panem', true, '2026-08-19T18:50:07+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('5abb2678-9329-5e8e-abb3-0113c00851ef', '6110b1d8-726e-5670-8304-7fa032d60471');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('a4d13812-b144-5000-b611-6adf9b640bce', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', '5abb2678-9329-5e8e-abb3-0113c00851ef', 'Tödliche Spiele', 'Suzanne Collins', 1, 5, 'Zum zweiten Mal gelesen, immer noch genauso gut', '2025-06-02', 416, 'https://covers.openlibrary.org/b/id/12878037-M.jpg', '2026-08-19T18:51:07+02:00', '2026-08-19T18:51:07+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('763c7209-2a05-53ff-8b97-d86ecd45a7ed', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', '5abb2678-9329-5e8e-abb3-0113c00851ef', 'Gefährliche Liebe', 'Suzanne Collins', 2, 4, null, '2025-06-10', 432, 'https://covers.openlibrary.org/b/id/15169828-M.jpg', '2026-08-19T18:52:07+02:00', '2026-08-19T18:52:07+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('e61144f5-4063-5b3a-9c49-178a11370b48', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', '5abb2678-9329-5e8e-abb3-0113c00851ef', 'Flammender Zorn', 'Suzanne Collins', 3, 3, null, '2025-06-21', 432, 'https://covers.openlibrary.org/b/id/9273770-M.jpg', '2026-08-19T18:53:07+02:00', '2026-08-19T18:53:07+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('b7296041-c6f9-5e90-83d3-645f8e8f9a71', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', '5abb2678-9329-5e8e-abb3-0113c00851ef', 'Das Lied von Vogel und Schlange', 'Suzanne Collins', 4, 4, null, '2026-03-15', 608, 'https://covers.openlibrary.org/b/id/14858983-M.jpg', '2026-08-19T18:54:07+02:00', '2026-08-19T18:54:07+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('3eb18cf8-7f11-5772-adce-053f00f183ae', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'Six of Crows', true, '2026-08-19T18:54:07+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('3eb18cf8-7f11-5772-adce-053f00f183ae', '9d467aa7-909c-5446-b2d8-c0b23ca2d3fa');
insert into public.shelf_categories (shelf_id, category_id) values ('3eb18cf8-7f11-5772-adce-053f00f183ae', '6110b1d8-726e-5670-8304-7fa032d60471');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('ba3aed07-df7c-5fc6-8a46-86861e1bddba', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', '3eb18cf8-7f11-5772-adce-053f00f183ae', 'Das Lied der Krähen', 'Leigh Bardugo', 1, 5, 'Beste Crew ever. Kaz und Inej 🖤', '2026-07-04', 576, 'https://covers.openlibrary.org/b/id/10377666-M.jpg', '2026-08-19T18:55:07+02:00', '2026-08-19T18:55:07+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('71ab19f9-6851-5b13-b9f2-54c388cecdab', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', '3eb18cf8-7f11-5772-adce-053f00f183ae', 'Das Gold der Krähen', 'Leigh Bardugo', 2, 0, 'Lese ich gerade', null, 672, 'https://covers.openlibrary.org/b/id/10169147-M.jpg', '2026-10-08T18:42:07+02:00', '2026-10-08T18:42:07+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('bf2cbc13-ba86-50cf-a0d3-056749dccb36', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'Das unsichtbare Leben der Addie LaRue', false, '2026-08-19T18:58:07+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('bf2cbc13-ba86-50cf-a0d3-056749dccb36', '9d467aa7-909c-5446-b2d8-c0b23ca2d3fa');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('a3425b67-9de8-52e9-802c-e2b5bcaf99f2', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'bf2cbc13-ba86-50cf-a0d3-056749dccb36', 'Das unsichtbare Leben der Addie LaRue', 'V. E. Schwab', 1, 5, 'Hab am Ende echt geweint', '2026-04-27', null, 'https://covers.openlibrary.org/b/id/10092261-M.jpg', '2026-08-19T18:59:07+02:00', '2026-08-19T18:59:07+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('7a6193aa-7871-5a97-9037-9fa7cc9bf44c', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'Der Nachtzirkus', false, '2026-08-19T19:02:07+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('7a6193aa-7871-5a97-9037-9fa7cc9bf44c', '9d467aa7-909c-5446-b2d8-c0b23ca2d3fa');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('7971ad5e-f80b-5a09-86dd-f62d4dd8d524', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', '7a6193aa-7871-5a97-9037-9fa7cc9bf44c', 'Der Nachtzirkus', 'Erin Morgenstern', 1, 4, null, '2025-09-12', null, 'https://covers.openlibrary.org/b/id/8936864-M.jpg', '2026-08-19T19:03:07+02:00', '2026-08-19T19:03:07+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('13b1f59f-9b50-5321-a14f-dd1aa442fb2d', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', 'Das Lied des Achill', false, '2026-08-19T19:06:07+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('13b1f59f-9b50-5321-a14f-dd1aa442fb2d', '9d467aa7-909c-5446-b2d8-c0b23ca2d3fa');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('489e8aa4-ce6e-554b-8d70-257c8f995756', 'c113063e-8ba8-5334-96d0-ccc9d40420a3', '13b1f59f-9b50-5321-a14f-dd1aa442fb2d', 'Das Lied des Achill', 'Madeline Miller', 1, 5, null, '2026-08-30', 416, 'https://covers.openlibrary.org/b/id/14421806-M.jpg', '2026-08-30T20:47:00+02:00', '2026-08-30T20:47:00+02:00');

-- @jonas_kr
insert into public.categories (id, user_id, name, created_at) values ('cc188142-31b6-5229-8739-708fb76fdeff', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'Sci-Fi', '2026-09-03 21:15:44+02');
insert into public.categories (id, user_id, name, created_at) values ('5d9fbd02-9973-51bc-a589-5f7774c92344', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'Thriller', '2026-09-03 21:15:44+02');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('f4be1470-60fc-5ecd-b55c-c921923aa728', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'Trisolaris-Trilogie', true, '2026-09-03T21:19:44+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('f4be1470-60fc-5ecd-b55c-c921923aa728', 'cc188142-31b6-5229-8739-708fb76fdeff');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('af8e3016-9778-573d-acb7-e6a4a241c610', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'f4be1470-60fc-5ecd-b55c-c921923aa728', 'Die drei Sonnen', 'Cixin Liu', 1, 4, 'Erste Hälfte zäh, dann völlig verrückt', '2025-02-16', 592, 'https://covers.openlibrary.org/b/id/11181548-M.jpg', '2026-09-03T21:20:44+02:00', '2026-09-03T21:20:44+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('1c4cf82c-5f73-5b26-b32f-05ab0b82a4cb', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'f4be1470-60fc-5ecd-b55c-c921923aa728', 'Der dunkle Wald', 'Cixin Liu', 2, 5, 'Einer der besten Sci-Fi Romane die ich kenne', '2025-03-30', 800, 'https://covers.openlibrary.org/b/id/11219961-M.jpg', '2026-09-03T21:21:44+02:00', '2026-09-03T21:21:44+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('1b14ce98-e4f3-560b-97f1-7c9b051deb04', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'f4be1470-60fc-5ecd-b55c-c921923aa728', 'Jenseits der Zeit', 'Cixin Liu', 3, 4, null, '2025-05-18', 832, 'https://covers.openlibrary.org/b/id/11220071-M.jpg', '2026-09-03T21:22:44+02:00', '2026-09-03T21:22:44+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('c115150a-1e7d-5ac9-95a5-d3211a0a66fc', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'Dune', true, '2026-09-03T21:23:44+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('c115150a-1e7d-5ac9-95a5-d3211a0a66fc', 'cc188142-31b6-5229-8739-708fb76fdeff');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('c5c3a190-743f-540a-a79b-32defa772d80', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'c115150a-1e7d-5ac9-95a5-d3211a0a66fc', 'Der Wüstenplanet', 'Frank Herbert', 1, 5, null, '2024-12-28', 800, 'https://covers.openlibrary.org/b/id/6390607-M.jpg', '2026-09-03T21:24:44+02:00', '2026-09-03T21:24:44+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('9341f53c-17d8-51e0-a4af-4a680db32fb5', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'c115150a-1e7d-5ac9-95a5-d3211a0a66fc', 'Der Herr des Wüstenplaneten', 'Frank Herbert', 2, 3, null, '2025-01-19', 352, 'https://covers.openlibrary.org/b/id/6390608-M.jpg', '2026-09-03T21:25:44+02:00', '2026-09-03T21:25:44+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('9fb55544-c1ee-5144-b797-6c35aae66f9d', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'c115150a-1e7d-5ac9-95a5-d3211a0a66fc', 'Die Kinder des Wüstenplaneten', 'Frank Herbert', 3, 3, 'Ab hier wirds sehr philosophisch', '2025-08-07', 560, 'https://covers.openlibrary.org/b/id/1009422-M.jpg', '2026-09-03T21:26:44+02:00', '2026-09-03T21:26:44+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('444469e6-beeb-5734-bafc-237314374242', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'The Expanse', true, '2026-09-03T21:27:44+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('444469e6-beeb-5734-bafc-237314374242', 'cc188142-31b6-5229-8739-708fb76fdeff');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('a6badd0d-4599-53de-83ab-6c1b77cad761', '9bb67999-39d3-55f6-a80e-109f39b628ad', '444469e6-beeb-5734-bafc-237314374242', 'Leviathan erwacht', 'James Corey', 1, 4, null, '2026-09-21', 592, 'https://covers.openlibrary.org/b/id/12716998-M.jpg', '2026-09-21T20:47:00+02:00', '2026-09-21T20:47:00+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('1ec25c66-68cb-5e5b-82e9-c9fdb9adad43', '9bb67999-39d3-55f6-a80e-109f39b628ad', '444469e6-beeb-5734-bafc-237314374242', 'Calibans Krieg', 'James Corey', 2, 0, null, null, 640, 'https://covers.openlibrary.org/b/id/12717009-M.jpg', '2026-10-13T21:15:44+02:00', '2026-10-13T21:15:44+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('036d09fe-4fc1-541b-88b9-31ad407da5d4', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'Der Astronaut', false, '2026-09-03T21:31:44+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('036d09fe-4fc1-541b-88b9-31ad407da5d4', 'cc188142-31b6-5229-8739-708fb76fdeff');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('58092829-a26c-5d16-908f-1506da39b102', '9bb67999-39d3-55f6-a80e-109f39b628ad', '036d09fe-4fc1-541b-88b9-31ad407da5d4', 'Der Astronaut', 'Andy Weir', 1, 5, 'Rocky!!! Lieblingsbuch dieses Jahr', '2026-02-08', 560, 'https://covers.openlibrary.org/b/id/14615813-M.jpg', '2026-09-03T21:32:44+02:00', '2026-09-03T21:32:44+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('be45dbf1-a1cf-5dd1-a736-37d05c14cd52', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'Der Marsianer', false, '2026-09-03T21:35:44+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('be45dbf1-a1cf-5dd1-a736-37d05c14cd52', 'cc188142-31b6-5229-8739-708fb76fdeff');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('b891deec-4ca6-5766-bbeb-2d902cf1e09c', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'be45dbf1-a1cf-5dd1-a736-37d05c14cd52', 'Der Marsianer', 'Andy Weir', 1, 4, null, '2024-08-14', null, 'https://covers.openlibrary.org/b/id/8137311-M.jpg', '2026-09-03T21:36:44+02:00', '2026-09-03T21:36:44+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('0dc77311-e485-552c-b781-052e63dd11ec', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'Blackout', false, '2026-09-03T21:39:44+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('0dc77311-e485-552c-b781-052e63dd11ec', '5d9fbd02-9973-51bc-a589-5f7774c92344');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('9fe782c9-dbb0-5809-981d-41052ed02824', '9bb67999-39d3-55f6-a80e-109f39b628ad', '0dc77311-e485-552c-b781-052e63dd11ec', 'Blackout – Morgen ist es zu spät', 'Marc Elsberg', 1, 4, 'Danach erstmal Wasser und Konserven gekauft', '2025-10-26', 800, 'https://covers.openlibrary.org/b/id/13314898-M.jpg', '2026-09-03T21:40:44+02:00', '2026-09-03T21:40:44+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('4f17571c-fe37-5611-8a0b-b1b46b0b23d3', '9bb67999-39d3-55f6-a80e-109f39b628ad', 'Der Schwarm', false, '2026-09-03T21:43:44+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('4f17571c-fe37-5611-8a0b-b1b46b0b23d3', '5d9fbd02-9973-51bc-a589-5f7774c92344');
insert into public.shelf_categories (shelf_id, category_id) values ('4f17571c-fe37-5611-8a0b-b1b46b0b23d3', 'cc188142-31b6-5229-8739-708fb76fdeff');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('9800864b-44f6-599f-9680-082272cbf372', '9bb67999-39d3-55f6-a80e-109f39b628ad', '4f17571c-fe37-5611-8a0b-b1b46b0b23d3', 'Der Schwarm', 'Frank Schätzing', 1, 3, 'Gute Idee, aber locker 300 Seiten zu lang', '2026-06-29', 992, 'https://covers.openlibrary.org/b/id/13011325-M.jpg', '2026-09-03T21:44:44+02:00', '2026-09-03T21:44:44+02:00');

-- @sophie_liest
insert into public.categories (id, user_id, name, created_at) values ('4f2e64d0-c8b4-5785-8e66-6a42a97ca44e', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Literary Fiction', '2026-08-28 09:03:51+02');
insert into public.categories (id, user_id, name, created_at) values ('a180415c-6ce7-57c3-acc2-e4e1c07ade9b', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Crime', '2026-08-28 09:03:51+02');
insert into public.categories (id, user_id, name, created_at) values ('ddb97137-e16b-5566-8a6e-68bd9dd445e0', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Biography', '2026-08-28 09:03:51+02');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('ba70c073-300f-5c36-86d7-a2e7bcdeb65d', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Neapolitanische Saga', true, '2026-08-28T09:07:51+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('ba70c073-300f-5c36-86d7-a2e7bcdeb65d', '4f2e64d0-c8b4-5785-8e66-6a42a97ca44e');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('2a46dc25-07c7-5e9b-8ddc-43c89cb2aede', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'ba70c073-300f-5c36-86d7-a2e7bcdeb65d', 'Meine geniale Freundin', 'Elena Ferrante', 1, 5, 'Lila und Lenù 💛', '2025-07-20', 422, 'https://covers.openlibrary.org/b/id/15257413-M.jpg', '2026-08-28T09:08:51+02:00', '2026-08-28T09:08:51+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('59baa0f5-5ea8-5af3-9eed-21f87193c9a6', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'ba70c073-300f-5c36-86d7-a2e7bcdeb65d', 'Die Geschichte eines neuen Namens', 'Elena Ferrante', 2, 5, null, '2025-08-11', 624, 'https://covers.openlibrary.org/b/id/11777720-M.jpg', '2026-08-28T09:09:51+02:00', '2026-08-28T09:09:51+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('33ffe7de-191c-5b14-b933-e1fbde9e568e', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'ba70c073-300f-5c36-86d7-a2e7bcdeb65d', 'Die Geschichte der getrennten Wege', 'Elena Ferrante', 3, 4, null, '2025-09-02', 544, 'https://covers.openlibrary.org/b/id/15261236-M.jpg', '2026-08-28T09:10:51+02:00', '2026-08-28T09:10:51+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('18d0e341-3ad7-565e-bdcb-7ac62c1c28b4', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'ba70c073-300f-5c36-86d7-a2e7bcdeb65d', 'Die Geschichte des verlorenen Kindes', 'Elena Ferrante', 4, 5, 'Was für ein Abschluss. Brauche erstmal eine Pause', '2025-10-05', 608, 'https://covers.openlibrary.org/b/id/15155315-M.jpg', '2026-08-28T09:11:51+02:00', '2026-08-28T09:11:51+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('0aac2f9e-d7da-50d7-84c6-ab18594410bc', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Taunus-Krimis', true, '2026-08-28T09:11:51+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('0aac2f9e-d7da-50d7-84c6-ab18594410bc', 'a180415c-6ce7-57c3-acc2-e4e1c07ade9b');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('81f59390-8597-5992-ad4e-0c92dd484861', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', '0aac2f9e-d7da-50d7-84c6-ab18594410bc', 'Eine unbeliebte Frau', 'Nele Neuhaus', 1, 3, null, '2026-01-11', 384, 'https://covers.openlibrary.org/b/id/14567524-M.jpg', '2026-08-28T09:12:51+02:00', '2026-08-28T09:12:51+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('e3aabbd8-aaf7-511c-b0b7-862c1bc51921', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', '0aac2f9e-d7da-50d7-84c6-ab18594410bc', 'Mordsfreunde', 'Nele Neuhaus', 2, 4, null, '2026-02-01', 400, 'https://covers.openlibrary.org/b/id/10650941-M.jpg', '2026-08-28T09:13:51+02:00', '2026-08-28T09:13:51+02:00');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('dbc41a42-023a-55e2-8be8-22218512d02b', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', '0aac2f9e-d7da-50d7-84c6-ab18594410bc', 'Tiefe Wunden', 'Nele Neuhaus', 3, 4, 'Bisher der beste Teil', '2026-09-14', 480, 'https://covers.openlibrary.org/b/id/6677913-M.jpg', '2026-09-14T21:21:00+02:00', '2026-09-14T21:21:00+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('1f0ccd05-bb62-503b-aa03-cad06e754e2e', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Altes Land', false, '2026-08-28T09:15:51+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('1f0ccd05-bb62-503b-aa03-cad06e754e2e', '4f2e64d0-c8b4-5785-8e66-6a42a97ca44e');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('776fdf42-52e3-5470-a218-f6da3ae4e6c2', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', '1f0ccd05-bb62-503b-aa03-cad06e754e2e', 'Altes Land', 'Dörte Hansen', 1, 5, null, '2025-04-06', 288, 'https://covers.openlibrary.org/b/id/13882963-M.jpg', '2026-08-28T09:16:51+02:00', '2026-08-28T09:16:51+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('7251850f-70d9-5c26-81c2-cb5c74bb7934', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Mittagsstunde', false, '2026-08-28T09:19:51+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('7251850f-70d9-5c26-81c2-cb5c74bb7934', '4f2e64d0-c8b4-5785-8e66-6a42a97ca44e');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('39267616-47d5-58fc-8ab6-1805cb3dab1d', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', '7251850f-70d9-5c26-81c2-cb5c74bb7934', 'Mittagsstunde', 'Dörte Hansen', 1, 4, 'Wie zu Besuch bei den Großeltern', '2025-05-01', 320, 'https://covers.openlibrary.org/b/id/10840639-M.jpg', '2026-08-28T09:20:51+02:00', '2026-08-28T09:20:51+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('4bca29bf-64ea-58d2-a2dc-317d86836b67', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Normale Menschen', false, '2026-08-28T09:23:51+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('4bca29bf-64ea-58d2-a2dc-317d86836b67', '4f2e64d0-c8b4-5785-8e66-6a42a97ca44e');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('4af297eb-6305-5981-8d84-2fb31b333c7e', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', '4bca29bf-64ea-58d2-a2dc-317d86836b67', 'Normale Menschen', 'Sally Rooney', 1, 3, null, '2026-03-22', 320, 'https://covers.openlibrary.org/b/id/15087216-M.jpg', '2026-08-28T09:24:51+02:00', '2026-08-28T09:24:51+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('f895bf36-8132-5e4e-8cf9-fcfabe084b2b', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Unterleuten', false, '2026-08-28T09:27:51+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('f895bf36-8132-5e4e-8cf9-fcfabe084b2b', '4f2e64d0-c8b4-5785-8e66-6a42a97ca44e');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('b782e1fc-2ac1-5cdb-a193-fb8bcc6c1b1e', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'f895bf36-8132-5e4e-8cf9-fcfabe084b2b', 'Unterleuten', 'Juli Zeh', 1, 4, null, '2026-05-17', 640, 'https://covers.openlibrary.org/b/id/14408266-M.jpg', '2026-08-28T09:28:51+02:00', '2026-08-28T09:28:51+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('b598f1cc-86cd-515e-8422-b34bc37d3bca', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Kleine Feuer überall', false, '2026-08-28T09:31:51+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('b598f1cc-86cd-515e-8422-b34bc37d3bca', '4f2e64d0-c8b4-5785-8e66-6a42a97ca44e');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('296cadcd-7d20-522c-b1e5-035596fce13a', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'b598f1cc-86cd-515e-8422-b34bc37d3bca', 'Kleine Feuer überall', 'Celeste Ng', 1, 4, null, '2026-10-12', 384, 'https://covers.openlibrary.org/b/id/14593328-M.jpg', '2026-10-12T20:47:00+02:00', '2026-10-12T20:47:00+02:00');
insert into public.shelves (id, user_id, label, is_series, created_at) values ('ad22ec5b-24f3-5583-8717-a59479f0f701', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'Becoming', false, '2026-08-28T09:35:51+02:00');
insert into public.shelf_categories (shelf_id, category_id) values ('ad22ec5b-24f3-5583-8717-a59479f0f701', 'ddb97137-e16b-5566-8a6e-68bd9dd445e0');
insert into public.books (id, user_id, shelf_id, title, author, series_order, rating, notes, date_read, page_count, cover_url, created_at, updated_at)
  values ('82884697-8d5d-584e-9aa1-e597f37cd0bf', '1cf2e6fa-73f8-5ad1-81cf-1ea35d5b186a', 'ad22ec5b-24f3-5583-8717-a59479f0f701', 'Becoming', 'Michelle Obama', 1, 4, 'Als Hörbuch, von ihr selbst gelesen', '2025-12-29', 544, 'https://covers.openlibrary.org/b/id/13010931-M.jpg', '2026-08-28T09:36:51+02:00', '2026-08-28T09:36:51+02:00');

commit;
