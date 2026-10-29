// Service Worker: macht die Seite installierbar und offline grundsätzlich lesbar.
// Immer zuerst das Netz fragen, damit nach einem Deploy sofort die neue Version kommt;
// der Cache ist nur der Rückfall ohne Verbindung.
const CACHE = 'bookshelf-v6';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/theme.js',
  'js/monitor.js',
  'js/vendor/supabase-2.117.3.js',
  'js/config.js',
  'js/core.js',
  'js/account.js',
  'js/admin.js',
  'js/shelf.js',
  'js/edit.js',
  'js/extras.js',
  'manifest.webmanifest',
  'img/favicon.svg',
  'img/logo-mark.svg',
  'img/logo-mark-negativ.svg',
  'img/favicon-192.png',
  'img/favicon-512.png',
  'fonts/geist-latin-wght-normal.woff2',
  'fonts/geist-latin-ext-wght-normal.woff2',
];

self.addEventListener('install', event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>Promise.allSettled(SHELL.map(url=>cache.add(url))))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k !== CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', event=>{
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return; // Supabase, Open Library usw. nicht anfassen
  if(url.pathname.startsWith('/api/')) return;    // Suchantworten nicht im App-Cache sammeln

  event.respondWith(
    fetch(req)
      .then(res=>{
        if(res.ok){
          const copy = res.clone();
          caches.open(CACHE).then(cache=>cache.put(req, copy));
        }
        return res;
      })
      .catch(async ()=>{
        const cached = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
        if(cached) return cached;
        if(req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      })
  );
});
