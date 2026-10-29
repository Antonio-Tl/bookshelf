-- Härtung nach dem Sicherheits-Check (Oktober 2026).
--   admin_list_users: wurde in 013_premium.sql neu angelegt und hat dabei die Standardrechte bekommen
--                     (auch anon). assert_admin() lehnt anonyme Aufrufe zwar ab, aber gar nicht erst
--                     aufrufen dürfen ist sicherer.
--   assert_admin:     nur innerhalb der Admin-Funktionen gebraucht; Gäste brauchen es nie.
-- Im Supabase SQL Editor ausführen. Lässt sich erneut ausführen.

revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

revoke execute on function public.assert_admin() from public, anon;
grant execute on function public.assert_admin() to authenticated;
