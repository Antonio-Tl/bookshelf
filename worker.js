// Cloudflare Worker vor den statischen Dateien. Läuft nur für /api/* (siehe wrangler.jsonc),
// alles andere liefert Cloudflare direkt aus.
//
// GET /api/books?q=… leitet die Buchsuche an Google Books weiter (POST /api/scan und den Supporter-Kauf siehe unten).
// Der API-Key liegt als Laufzeit-Secret GOOGLE_BOOKS_API_KEY am Worker und kommt so nie in den Browser.
const UPSTREAM = 'https://www.googleapis.com/books/v1/volumes';
const CACHE_SECONDS = 60 * 60 * 24;

function json(body, status, extra = {}){
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

async function searchBooks(request, env, ctx){
  // Nur für die eigene Seite, damit fremde Seiten nicht das Kontingent aufbrauchen.
  if(request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  if(!env.GOOGLE_BOOKS_API_KEY) return json({ error: 'not configured' }, 503);

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 300);
  if(!q) return json({ items: [] }, 400);

  // Gleiche Suchen kommen oft mehrfach (Cover-Suche beim Laden); die Antwort einen Tag im Edge-Cache halten.
  const cacheKey = new Request(`${url.origin}/api/books?q=${encodeURIComponent(q)}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if(hit) return hit;

  // Den Sec-Fetch-Site-Check oben umgeht jedes Skript. Deshalb zusätzlich pro IP begrenzen (BOOKS_LIMITER in
  // wrangler.jsonc), erst nach dem Cache: nur echte Anfragen an Google zählen. 429 versteht die App schon.
  if(env.BOOKS_LIMITER){
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.BOOKS_LIMITER.limit({ key: ip });
    if(!success) return json({ error: 'rate limited' }, 429, { 'Retry-After': '60' });
  }

  const upstream = new URL(UPSTREAM);
  upstream.searchParams.set('q', q);
  upstream.searchParams.set('maxResults', '10');
  upstream.searchParams.set('printType', 'books');
  upstream.searchParams.set('key', env.GOOGLE_BOOKS_API_KEY);

  let r;
  try {
    // Referer mitschicken, falls der Key in Google auf die eigene Domain beschränkt ist.
    r = await fetch(upstream, { headers: { Referer: `${url.origin}/` } });
  } catch(e){
    return json({ error: 'upstream unreachable' }, 502);
  }
  // 403/429 unverändert weitergeben: die App fragt Google dann für den Rest der Sitzung nicht mehr.
  if(!r.ok) return json({ error: 'upstream', status: r.status }, r.status === 403 || r.status === 429 ? r.status : 502);

  const res = new Response(await r.text(), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${CACHE_SECONDS}` },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// POST /api/scan { image: <Foto als Base64>, mime } liest die Buchrücken auf einem Regalfoto mit Gemini.
// Der Key liegt als Secret GEMINI_API_KEY am Worker. Nur für Premium-Konten und Admins und nur
// innerhalb des Tageslimits: der Worker ruft dafür claim_scan() in Supabase mit dem Login des
// Nutzers auf (supabase/014_scan_limit.sql). Ohne Prüfung nur unter `wrangler dev` mit SCAN_SKIP_AUTH=1
// in .dev.vars (lokaler Testmodus ohne Login): die Datei wird nie hochgeladen, und der Hostname muss
// zusätzlich localhost sein.
// Fest statt "gemini-flash-lite-latest": der Alias wechselt ohne Ankündigung das Modell (und damit die
// Geschwindigkeit). Minimales Nachdenken war im Test spürbar schneller und erkannte genauso viel.
const SCAN_MODEL = 'gemini-3.5-flash-lite';
// Meist ein im Browser auf 2000 px verkleinertes JPEG (unter 1 MB). Kann der Browser das Foto nicht lesen
// (HEIC in Chrome, Riesenfotos auf schwachen Handys), kommt die Originaldatei bis 10 MB, also ~14 MB als Base64.
const SCAN_MAX_BASE64 = 14 * 1024 * 1024;
const SCAN_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const SCAN_PROMPT = `Das Foto zeigt ein Bücherregal. Liste jedes Buch auf, dessen Rücken oder Cover zu sehen ist:
von links nach rechts, oberstes Regalbrett zuerst. Gib Titel und Autor so an, wie sie gedruckt sind
(Originalsprache beibehalten, normale Groß-/Kleinschreibung statt GROSSBUCHSTABEN).
Gehört das Buch erkennbar zu einer Reihe, nenne die Reihe in "reihe", sonst "".
Kannst du nur einen Teil lesen, gib das Lesbare an und setze "unsicher": true.
Erfinde keine Bücher, die nicht zu sehen sind.
Antworte ausschließlich mit JSON in dieser Form:
{"buecher": [{"titel": "...", "autor": "...", "reihe": "", "unsicher": false}]}`;

// Fragt claim_scan() mit dem Login des Nutzers: 'ok' zählt den Scan schon mit. Sonst 'unauthorized',
// 'premium_required', 'busy', 'daily_limit' oder 'user_limit'. Die Entscheidung trifft die Datenbank;
// der Browser kann sie nicht fälschen.
async function claimScan(request, env){
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if(!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return 'unauthorized';
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/claim_scan`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if(r.status === 401) return 'unauthorized';
  if(!r.ok) return 'premium_required';
  return String(await r.json());
}
const CLAIM_STATUS = { unauthorized: 401, premium_required: 403, busy: 429, daily_limit: 429, user_limit: 429 };

function cleanScan(text){
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if(start < 0 || end < start) return [];
  let data;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch(e){ return []; }
  const str = (v, max)=>String(v ?? '').trim().slice(0, max);
  return (Array.isArray(data.buecher) ? data.buecher : []).slice(0, 150).map(b=>({
    titel: str(b.titel, 300),
    autor: str(b.autor, 200),
    reihe: str(b.reihe, 200),
    unsicher: !!b.unsicher,
  })).filter(b=>b.titel);
}

async function scanShelf(request, env){
  if(request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  if(!env.GEMINI_API_KEY) return json({ error: 'not configured' }, 503);
  const { hostname } = new URL(request.url);
  const local = env.SCAN_SKIP_AUTH === '1' && ['localhost', '127.0.0.1'].includes(hostname);
  // Erst das Foto prüfen, dann zählen: ein kaputter Upload soll kein Kontingent kosten.
  // Zu große Anfragen gar nicht erst einlesen.
  if(Number(request.headers.get('Content-Length') || 0) > SCAN_MAX_BASE64 + 1024) return json({ error: 'too large' }, 413);
  let image, mime;
  try { ({ image, mime = 'image/jpeg' } = await request.json()); } catch(e){ return json({ error: 'bad request' }, 400); }
  if(typeof image !== 'string' || !image) return json({ error: 'bad request' }, 400);
  if(!SCAN_MIME_TYPES.includes(mime)) return json({ error: 'unsupported type' }, 415);
  if(image.length > SCAN_MAX_BASE64) return json({ error: 'too large' }, 413);

  if(!local){
    const claim = await claimScan(request, env);
    if(claim !== 'ok') return json({ error: claim }, CLAIM_STATUS[claim] || 403);
  }

  // Die Gratis-Stufe meldet oft kurz "überlastet" (503/429); einmal nach einer Pause neu versuchen,
  // statt dem Nutzer gleich einen Fehler zu zeigen. Gezählt wurde der Scan oben nur einmal.
  let r;
  for(const wait of [0, 1500]){
    if(wait) await new Promise(res=>setTimeout(res, wait));
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${SCAN_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data: image } }, { text: SCAN_PROMPT }] }],
          generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'minimal' } },
        }),
      });
    } catch(e){
      return json({ error: 'upstream unreachable' }, 502);
    }
    if(r.status !== 503 && r.status !== 429) break;
  }
  // Überlastung (429/503) unverändert weitergeben, damit die App "später nochmal" sagen kann.
  if(!r.ok) return json({ error: 'upstream', status: r.status }, r.status === 429 || r.status === 503 ? r.status : 502);
  const body = await r.json();
  const text = (body.candidates?.[0]?.content?.parts ?? []).map(p=>p.text ?? '').join('');
  return json({ buecher: cleanScan(text) }, 200);
}

// ---- Supporter-Kauf über Stripe ----
// POST /api/checkout legt für den eingeloggten Nutzer eine Stripe-Bezahlseite an und gibt ihre Adresse zurück.
// POST /api/withdraw widerruft den Kauf binnen 14 Tagen (Geld zurück).
// POST /api/stripe-webhook nimmt die Meldungen von Stripe entgegen (bezahlt, erstattet, Rückbuchung) und trägt
// sie mit record_purchase() ein (supabase/020_purchases.sql). Premium gibt es also erst, wenn Stripe die
// Zahlung signiert bestätigt; die Rückkehr auf die Seite allein schaltet nichts frei.
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (whsec_…) und PAYMENT_DB_SECRET (sein Hash steht in
// payment_secret). Den Preis kennt nur der Server; der Browser schickt keinen mit.
const SUPPORTER_PRICE_CENTS = 399; // steht auch in index.html (#buyPrice) und agb.html
const STRIPE_API = 'https://api.stripe.com/v1';
const enc = new TextEncoder();

async function stripePost(env, path, params, idempotencyKey){
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  if(idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const r = await fetch(`${STRIPE_API}/${path}`, { method: 'POST', headers, body: new URLSearchParams(params) });
  return { ok: r.ok, status: r.status, body: await r.json().catch(()=>({})) };
}

// Fragt Supabase mit dem Login des Nutzers. Lesen darf er nur die eigenen Zeilen (RLS).
async function supabaseGet(env, path, token){
  const r = await fetch(`${env.SUPABASE_URL}${path}`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}

async function startCheckout(request, env){
  if(request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  if(!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL) return json({ error: 'not configured' }, 503);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const user = token && await supabaseGet(env, '/auth/v1/user', token);
  if(!user || !user.id) return json({ error: 'unauthorized' }, 401);
  const id = encodeURIComponent(user.id);
  const [premium, ban] = await Promise.all([
    supabaseGet(env, `/rest/v1/premium_members?select=user_id&user_id=eq.${id}`, token),
    supabaseGet(env, `/rest/v1/bans?select=user_id&user_id=eq.${id}`, token),
  ]);
  if(!premium || !ban) return json({ error: 'upstream' }, 502);
  if(ban.length) return json({ error: 'banned' }, 403);
  if(premium.length) return json({ error: 'already' }, 409);

  // Zurück dorthin, wo der Kauf gestartet wurde. Nur eine Query auf der eigenen Seite, nie eine fremde Adresse.
  let from = '';
  try { ({ from = '' } = await request.json()); } catch(e){}
  if(typeof from !== 'string' || from.length > 200 || !/^\?[\w=&%.~-]*$/.test(from)) from = '';
  const { origin } = new URL(request.url);
  const back = (status)=>`${origin}/${from ? `${from}&` : '?'}kauf=${status}`;

  const params = {
    mode: 'payment',
    // Stripe schaltet bei neuen Konten "Managed Payments" ein (Stripe als Händler); wir verkaufen selbst
    // (Kleinunternehmer, eigene AGB), und eigene Texte auf der Bezahlseite gehen nur ohne.
    'managed_payments[enabled]': 'false',
    locale: 'de',
    submit_type: 'pay',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(SUPPORTER_PRICE_CENTS),
    'line_items[0][price_data][product_data][name]': 'Bücherregal Supporter',
    'line_items[0][price_data][product_data][description]': 'Einmalige Zahlung, kein Abo. Schaltet „Regal scannen“ und die Vitrine für dein Konto frei.',
    client_reference_id: user.id,
    'metadata[user_id]': user.id,
    'payment_intent_data[metadata][user_id]': user.id,
    success_url: back('danke'),
    cancel_url: back('abgebrochen'),
    // Freigeschaltete Funktionen gelten eher als digitale Dienstleistung, nicht als digitaler Inhalt: das
    // Widerrufsrecht erlischt dann nicht mit dem Beginn. Darum gibt es 14 Tage Widerruf mit vollem Geld
    // zurück (POST /api/withdraw, Knopf im Konto-Fenster). Das Häkchen über dem Bezahlen-Knopf braucht in
    // Stripe unter Einstellungen → Öffentliche Details eine AGB-Adresse.
    'consent_collection[terms_of_service]': 'required',
    'custom_text[terms_of_service_acceptance][message]': `Ich stimme den [AGB](${origin}/agb.html) zu und habe die [Widerrufsbelehrung](${origin}/agb.html#widerruf) gelesen.`,
    'custom_text[submit][message]': 'Einmalig, kein Abo. Supporter ist sofort nach der Zahlung in deinem Konto freigeschaltet.',
    // Rechnung als Beleg per E-Mail, mit dem Hinweis für Kleinunternehmer und der Widerrufsbelehrung in Kurzform
    // (die Bestätigung muss sie auf einem dauerhaften Datenträger enthalten).
    'invoice_creation[enabled]': 'true',
    'invoice_creation[invoice_data][footer]': `Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.\n\nWiderrufsrecht: Du kannst diesen Vertrag binnen 14 Tagen ab dem Kauf ohne Angabe von Gründen widerrufen, am einfachsten im Bücherregal unter Konto → Supporter → „Vertrag widerrufen“ oder über die Kontaktdaten im Impressum (${origin}/impressum.html). Du bekommst den vollen Betrag über deine Zahlungsart zurück. Vollständige Widerrufsbelehrung und AGB: ${origin}/agb.html`,
  };
  if(user.email) params.customer_email = user.email;
  const r = await stripePost(env, 'checkout/sessions', params);
  if(!r.ok || !r.body.url) return json({ error: 'stripe', status: r.status, message: r.body.error?.message }, 502);
  return json({ url: r.body.url }, 200);
}

// Stripe signiert jede Meldung: Header "t=<Zeit>,v1=<HMAC-SHA256 von "t.Body">". Älter als 5 Minuten zählt
// nicht, damit abgefangene Meldungen nicht später noch einmal eingespielt werden können.
async function verifyStripeSignature(payload, header, secret){
  if(!header) return false;
  const parts = header.split(',').map(p=>p.trim().split('='));
  const t = (parts.find(([k])=>k === 't') || [])[1];
  const sigs = parts.filter(([k, v])=>k === 'v1' && /^[0-9a-f]{64}$/.test(v || '')).map(([, v])=>v);
  if(!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  for(const sig of sigs){
    const bytes = new Uint8Array(sig.match(/../g).map(h=>parseInt(h, 16)));
    if(await crypto.subtle.verify('HMAC', key, bytes, enc.encode(`${t}.${payload}`))) return true;
  }
  return false;
}

// Ohne Login (anon); record_purchase prüft stattdessen das Geheimnis. Gibt 'ok', 'duplicate', 'double',
// 'no_user' oder 'unknown' zurück, bei einem Fehler null (dann versucht Stripe es später noch einmal).
async function recordPurchase(env, args){
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_purchase`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.PAYMENT_DB_SECRET, ...args }),
  });
  return r.ok ? String(await r.json()) : null;
}

async function stripeWebhook(request, env){
  if(!env.STRIPE_WEBHOOK_SECRET || !env.PAYMENT_DB_SECRET || !env.STRIPE_SECRET_KEY) return json({ error: 'not configured' }, 503);
  const raw = await request.text();
  if(!await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET)){
    return json({ error: 'bad signature' }, 400);
  }
  let event;
  try { event = JSON.parse(raw); } catch(e){ return json({ error: 'bad request' }, 400); }
  const o = event.data?.object || {};
  let result = 'ignored';

  if(event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded'){
    // Lastschrift & Co. melden "completed" erst unbezahlt; bezahlt kommt dann als async_payment_succeeded.
    if(o.payment_status !== 'paid') return json({ received: true, result: 'pending' }, 200);
    result = await recordPurchase(env, {
      session_id: o.id,
      intent: o.payment_intent,
      buyer: o.client_reference_id || o.metadata?.user_id || null,
      amount: o.amount_total,
      currency: o.currency,
      status: 'paid',
      consent_at: o.consent?.terms_of_service === 'accepted' ? new Date(event.created * 1000).toISOString() : null,
    });
    // Zweiter Kauf desselben Kontos oder Konto inzwischen gelöscht: Geld zurück.
    if(result === 'double' || result === 'no_user'){
      const reason = result === 'double' ? 'duplicate' : 'requested_by_customer';
      const r = await stripePost(env, 'refunds', { payment_intent: o.payment_intent, reason }, `refund-${o.payment_intent}`);
      if(!r.ok) result = null;
    }
  } else if(event.type === 'charge.refunded'){
    // Teilerstattung: Premium bleibt.
    if(o.refunded) result = await recordPurchase(env, { session_id: '', intent: o.payment_intent, buyer: null, amount: 0, currency: '', status: 'refunded' });
  } else if(event.type === 'charge.dispute.created'){
    result = await recordPurchase(env, { session_id: '', intent: o.payment_intent, buyer: null, amount: 0, currency: '', status: 'disputed' });
  }

  if(result === null) return json({ error: 'not recorded' }, 500);
  return json({ received: true, result }, 200);
}

// Widerruf binnen 14 Tagen: erstattet den letzten bezahlten Kauf über Stripe. Premium nimmt danach die
// Meldung charge.refunded weg (wie bei jeder Erstattung). Die Bestätigung schickt Stripe per E-Mail.
const WITHDRAW_DAYS = 14;
async function withdrawPurchase(request, env){
  if(request.headers.get('Sec-Fetch-Site') === 'cross-site') return json({ error: 'forbidden' }, 403);
  if(!env.STRIPE_SECRET_KEY || !env.SUPABASE_URL) return json({ error: 'not configured' }, 503);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const user = token && await supabaseGet(env, '/auth/v1/user', token);
  if(!user || !user.id) return json({ error: 'unauthorized' }, 401);
  const rows = await supabaseGet(env,
    `/rest/v1/purchases?select=payment_intent,created_at&user_id=eq.${encodeURIComponent(user.id)}&status=eq.paid&order=created_at.desc&limit=1`, token);
  if(!rows) return json({ error: 'upstream' }, 502);
  if(!rows.length) return json({ error: 'none' }, 404);
  // Ein Tag Kulanz, damit "bis einschließlich Tag 14" in jeder Zeitzone reicht.
  if(Date.now() - Date.parse(rows[0].created_at) > (WITHDRAW_DAYS + 1) * 86400e3) return json({ error: 'expired' }, 410);
  const intent = rows[0].payment_intent;
  const r = await stripePost(env, 'refunds', { payment_intent: intent, reason: 'requested_by_customer', 'metadata[widerruf]': 'ja' }, `withdraw-${intent}`);
  if(!r.ok && r.body.error?.code !== 'charge_already_refunded') return json({ error: 'stripe', status: r.status }, 502);
  return json({ ok: true }, 200);
}

export default {
  async fetch(request, env, ctx){
    const { pathname } = new URL(request.url);
    if(pathname === '/api/books'){
      if(request.method !== 'GET') return json({ error: 'method not allowed' }, 405, { Allow: 'GET' });
      return searchBooks(request, env, ctx);
    }
    if(pathname === '/api/scan'){
      if(request.method !== 'POST') return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
      return scanShelf(request, env);
    }
    if(pathname === '/api/checkout'){
      if(request.method !== 'POST') return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
      return startCheckout(request, env);
    }
    if(pathname === '/api/withdraw'){
      if(request.method !== 'POST') return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
      return withdrawPurchase(request, env);
    }
    if(pathname === '/api/stripe-webhook'){
      if(request.method !== 'POST') return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
      return stripeWebhook(request, env);
    }
    if(pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
