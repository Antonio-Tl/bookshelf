-- Kostenübersicht in der Verwaltung: liefert die Zahlen, aus denen die App die laufenden Kosten schätzt.
--   admin_cost_stats(): Scans aus scan_log (hält nur 7 Tage, siehe 014_scan_limit.sql), Käufe aus
--                       purchases (020_purchases.sql) und die Auslastung des Gratis-Plans von Supabase.
--                       Nur für Admins mit Zwei-Faktor (assert_admin). Der Worker nutzt den Aufruf auch als
--                       Admin-Prüfung für GET /api/usage. Antwort als JSON:
--                         scans_7d, scans_today, first_scan  (für den Tagesschnitt der Gemini-Kosten)
--                         sales, sales_30d                   (alle Käufe, auch erstattete: Stripe behält
--                                                             die Gebühr auch bei einer Erstattung)
--                         paid_cents, paid_cents_30d          (Umsatz der nicht erstatteten Käufe)
--                         refunds                             (erstattet oder zurückgebucht)
--                         db_bytes, storage_bytes             (Gratis: 500 MB Datenbank, 1 GB Dateien)
--                         active_30d                          (in 30 Tagen angemeldet; Näherung für die
--                                                             MAU, Gratis: 50.000)
--                         accounts, accounts_30d              (für die Hochrechnung pro Konto)
-- Im Supabase SQL Editor ausführen. Lässt sich erneut ausführen.

create or replace function public.admin_cost_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  month_ago timestamptz := now() - interval '30 days';
begin
  perform public.assert_admin();
  return json_build_object(
    'scans_7d', (select count(*) from public.scan_log where created_at > now() - interval '7 days'),
    'scans_today', (select count(*) from public.scan_log where created_at >= day_start),
    'first_scan', (select min(created_at) from public.scan_log),
    'sales', (select count(*) from public.purchases),
    'sales_30d', (select count(*) from public.purchases where created_at > month_ago),
    'paid_cents', (select coalesce(sum(amount), 0) from public.purchases where status = 'paid'),
    'paid_cents_30d', (select coalesce(sum(amount), 0) from public.purchases where status = 'paid' and created_at > month_ago),
    'refunds', (select count(*) from public.purchases where status <> 'paid'),
    'db_bytes', pg_database_size(current_database()),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects),
    'active_30d', (select count(*) from auth.users where last_sign_in_at > month_ago),
    'accounts', (select count(*) from public.profiles),
    'accounts_30d', (select count(*) from public.profiles where created_at > month_ago)
  );
end;
$$;
revoke execute on function public.admin_cost_stats() from public, anon;
grant execute on function public.admin_cost_stats() to authenticated;
