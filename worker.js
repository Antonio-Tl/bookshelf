// Cloudflare Worker vor den statischen Dateien. Läuft nur für /api/* (siehe wrangler.jsonc),
// alles andere liefert Cloudflare direkt aus.
//
// GET /api/books?q=… leitet die Buchsuche an Google Books weiter (POST /api/scan siehe unten). Der API-Key liegt als
// Laufzeit-Secret GOOGLE_BOOKS_API_KEY am Worker und kommt so nie in den Browser.
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

// POST /api/scan { image: <JPEG als Base64> } liest die Buchrücken auf einem Regalfoto mit Gemini.
// Der Key liegt als Secret GEMINI_API_KEY am Worker. Nur für Premium-Konten und Admins und nur
// innerhalb des Tageslimits: der Worker ruft dafür claim_scan() in Supabase mit dem Login des
// Nutzers auf (supabase/014_scan_limit.sql). Auf localhost (wrangler dev, lokaler Testmodus ohne
// Login) ohne Prüfung.
const SCAN_MODEL = 'gemini-flash-lite-latest';
const SCAN_MAX_BASE64 = 6 * 1024 * 1024;
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
  const local = ['localhost', '127.0.0.1'].includes(hostname);
  // Erst das Foto prüfen, dann zählen: ein kaputter Upload soll kein Kontingent kosten.
  let image;
  try { ({ image } = await request.json()); } catch(e){ return json({ error: 'bad request' }, 400); }
  if(typeof image !== 'string' || !image) return json({ error: 'bad request' }, 400);
  if(image.length > SCAN_MAX_BASE64) return json({ error: 'too large' }, 413);

  if(!local){
    const claim = await claimScan(request, env);
    if(claim !== 'ok') return json({ error: claim }, CLAIM_STATUS[claim] || 403);
  }

  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${SCAN_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: image } }, { text: SCAN_PROMPT }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
  } catch(e){
    return json({ error: 'upstream unreachable' }, 502);
  }
  // Überlastung (429/503) unverändert weitergeben, damit die App "später nochmal" sagen kann.
  if(!r.ok) return json({ error: 'upstream', status: r.status }, r.status === 429 || r.status === 503 ? r.status : 502);
  const body = await r.json();
  const text = (body.candidates?.[0]?.content?.parts ?? []).map(p=>p.text ?? '').join('');
  return json({ buecher: cleanScan(text) }, 200);
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
    if(pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
