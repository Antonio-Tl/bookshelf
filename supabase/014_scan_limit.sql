-- Tageslimit für "Regal scannen", damit das Gratis-Kontingent von Gemini (Flash-Lite, ca. 1.000 Anfragen
-- am Tag und 15 pro Minute) nie ausgeschöpft wird.
--   scan_log:     eine Zeile pro Scan (wer, wann), wird nach 7 Tagen gelöscht. Niemand liest oder
--                 schreibt direkt (keine Policies), nur claim_scan.
--   claim_scan(): prüft Premium wie can_use_premium(), dann die Grenzen, und trägt den Scan ein.
--                 Grenzen: 10 pro Minute und 200 am Tag für alle zusammen, 20 am Tag pro Konto
--                 (Admins ausgenommen). Der Tag läuft wie bei Google nach pazifischer Zeit.
--                 Antwort: 'ok', 'premium_required', 'busy', 'daily_limit' oder 'user_limit'.
--                 Der Worker ruft sie vor jedem Scan mit dem Login des Nutzers auf.
-- Im Supabase SQL Editor ausführen, bevor der neue worker.js online geht. Lässt sich erneut ausführen.

create table if not exists public.scan_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists scan_log_created_idx on public.scan_log (created_at);
create index if not exists scan_log_user_idx on public.scan_log (user_id, created_at);

alter table public.scan_log enable row level security;

create or replace function public.claim_scan()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
begin
  if not public.can_use_premium() then
    return 'premium_required';
  end if;
  -- Gleichzeitige Scans nacheinander zählen, sonst könnten zwei Anfragen beide das letzte Kontingent bekommen.
  perform pg_advisory_xact_lock(hashtext('claim_scan'));
  if (select count(*) from public.scan_log where created_at > now() - interval '1 minute') >= 10 then
    return 'busy';
  end if;
  if (select count(*) from public.scan_log where created_at >= day_start) >= 200 then
    return 'daily_limit';
  end if;
  if not exists (select 1 from public.admins where user_id = auth.uid())
     and (select count(*) from public.scan_log where user_id = auth.uid() and created_at >= day_start) >= 20 then
    return 'user_limit';
  end if;
  insert into public.scan_log (user_id) values (auth.uid());
  delete from public.scan_log where created_at < now() - interval '7 days';
  return 'ok';
end;
$$;
revoke execute on function public.claim_scan() from public, anon;
grant execute on function public.claim_scan() to authenticated;
