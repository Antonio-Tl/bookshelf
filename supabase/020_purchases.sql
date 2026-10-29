-- Supporter-Kauf über Stripe: wer bezahlt, bekommt Premium (premium_members.source = 'purchase').
--   purchases:       eine Zeile pro bezahltem Stripe-Checkout. Jeder sieht nur die eigenen. Wird ein Konto
--                    gelöscht, bleibt der Kauf ohne Nutzer stehen (Buchhaltung; die Belege liegen bei Stripe).
--   payment_secret:  SHA-256 des Geheimnisses PAYMENT_DB_SECRET, mit dem sich der Worker ausweist. So braucht
--                    der Worker keinen Service-Role-Key: wer das Geheimnis hat, kann nur Käufe eintragen,
--                    nicht die Datenbank lesen. Niemand außer record_purchase liest die Tabelle.
--   record_purchase: ruft nur der Worker auf, nachdem er die Signatur von Stripe geprüft hat.
--                    'paid' gibt Premium; 'refunded'/'disputed' nimmt es wieder, aber nur, wenn es gekauft
--                    war und kein anderer bezahlter Kauf bleibt. Verschenktes Premium (Admin) bleibt immer.
--                    Stripe schickt Meldungen auch doppelt; jede Bestellung zählt trotzdem nur einmal.
--   admin_list_users: bekommt premium_source ('admin' = geschenkt, 'purchase' = gekauft).
-- Im Supabase SQL Editor ausführen, bevor der neue Worker online geht. Lässt sich erneut ausführen.
-- Danach einmal den Hash des Geheimnisses eintragen (Anleitung unten).

begin;

create table if not exists public.purchases (
  id text primary key,                      -- Stripe Checkout Session (cs_…)
  payment_intent text unique,               -- pi_…; Erstattungen und Rückbuchungen kommen damit an
  user_id uuid references public.profiles(id) on delete set null,
  amount integer not null,                  -- in Cent
  currency text not null,
  status text not null check (status in ('paid', 'refunded', 'disputed')),
  consent_at timestamptz,                   -- Häkchen bei Stripe: AGB zugestimmt, Widerrufsbelehrung gelesen
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchases_user_idx on public.purchases (user_id);

alter table public.purchases enable row level security;
drop policy if exists purchases_select_own on public.purchases;
create policy purchases_select_own on public.purchases
  for select using (user_id = auth.uid());
revoke all on public.purchases from anon;
revoke insert, update, delete, truncate, references, trigger on public.purchases from authenticated;

create table if not exists public.payment_secret (
  hash text primary key
);
alter table public.payment_secret enable row level security;
revoke all on public.payment_secret from anon, authenticated;

create or replace function public.record_purchase(secret text, session_id text, intent text, buyer uuid,
  amount integer, currency text, status text, consent_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if secret is null or not exists (
    select 1 from public.payment_secret where hash = encode(sha256(convert_to(secret, 'UTF8')), 'hex')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if status = 'paid' then
    -- Konto inzwischen gelöscht: Kauf ohne Nutzer festhalten, der Worker erstattet ihn.
    if buyer is null or not exists (select 1 from public.profiles where id = buyer) then
      insert into public.purchases (id, payment_intent, user_id, amount, currency, status, consent_at)
      values (session_id, intent, null, amount, currency, 'paid', consent_at)
      on conflict (id) do nothing;
      return 'no_user';
    end if;
    insert into public.purchases (id, payment_intent, user_id, amount, currency, status, consent_at)
    values (session_id, intent, buyer, amount, currency, 'paid', consent_at)
    on conflict (id) do nothing;
    if not found then return 'duplicate'; end if;
    -- Zweimal bezahlt (zwei offene Bezahlseiten): der Worker erstattet den zweiten Kauf.
    if exists (select 1 from public.purchases p
               where p.user_id = buyer and p.status = 'paid' and p.id <> session_id) then
      return 'double';
    end if;
    -- Geschenktes Premium bleibt geschenkt, sonst wäre es nach einer Erstattung weg.
    insert into public.premium_members (user_id, granted_by, source) values (buyer, null, 'purchase')
    on conflict (user_id) do nothing;
    return 'ok';
  end if;

  if status in ('refunded', 'disputed') then
    update public.purchases p set status = record_purchase.status, updated_at = now()
    where p.payment_intent = intent
    returning p.user_id into owner;
    if not found then return 'unknown'; end if;
    if owner is not null and not exists (
      select 1 from public.purchases p where p.user_id = owner and p.status = 'paid'
    ) then
      delete from public.premium_members where user_id = owner and source = 'purchase';
    end if;
    return 'ok';
  end if;

  raise exception 'unknown status %', status;
end;
$$;
-- Der Worker ruft ohne Login auf (anon); die Prüfung oben ist das Geheimnis.
revoke execute on function public.record_purchase(text, text, text, uuid, integer, text, text, timestamptz) from public, authenticated;
grant execute on function public.record_purchase(text, text, text, uuid, integer, text, text, timestamptz) to anon;

drop function if exists public.admin_list_users();
create function public.admin_list_users()
returns table(id uuid, username text, display_name text, avatar_url text, email text,
  created_at timestamp with time zone, last_sign_in_at timestamp with time zone,
  book_count bigint, shelf_count bigint, banned_at timestamp with time zone, ban_reason text,
  is_admin boolean, is_premium boolean, premium_source text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform public.assert_admin();
  return query
  select p.id, p.username, p.display_name, p.avatar_url, u.email::text, p.created_at, u.last_sign_in_at,
    (select count(*) from public.books b where b.user_id = p.id),
    (select count(*) from public.shelves s where s.user_id = p.id),
    bn.banned_at, bn.reason,
    exists (select 1 from public.admins a where a.user_id = p.id),
    pm.user_id is not null,
    pm.source
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.bans bn on bn.user_id = p.id
  left join public.premium_members pm on pm.user_id = p.id
  order by p.created_at;
end;
$$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

commit;

-- ---- Einmalig: Hash des Worker-Geheimnisses eintragen ----
-- Im Terminal ein Geheimnis erzeugen und seinen Hash ausgeben:
--   SECRET=$(openssl rand -hex 32); echo "Für Cloudflare: $SECRET"; printf %s "$SECRET" | shasum -a 256
-- Das Geheimnis kommt in Cloudflare als Secret PAYMENT_DB_SECRET, nur der Hash (die erste Spalte) hierher:
--   insert into public.payment_secret (hash) values ('<hash>');
-- Neues Geheimnis: alte Zeile löschen (delete from public.payment_secret;) und neue eintragen.
