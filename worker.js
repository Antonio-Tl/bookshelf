// Cloudflare Worker vor den statischen Dateien. Läuft nur für /api/* (siehe wrangler.jsonc),
// alles andere liefert Cloudflare direkt aus.
//
// GET /api/books?q=… leitet die Buchsuche an Google Books weiter. Der API-Key liegt als
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

export default {
  async fetch(request, env, ctx){
    const { pathname } = new URL(request.url);
    if(pathname === '/api/books'){
      if(request.method !== 'GET') return json({ error: 'method not allowed' }, 405, { Allow: 'GET' });
      return searchBooks(request, env, ctx);
    }
    if(pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
