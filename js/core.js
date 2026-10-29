// Grundlagen: Zustand, Hilfsfunktionen, Cover, Buchsuche, Genres, Designs und der lokale Testmodus.
// Die App besteht aus sechs klassischen Skripten ohne Build-Schritt. Sie teilen sich einen globalen
// Gültigkeitsbereich und laden in index.html in fester Reihenfolge: core, account, admin, shelf, edit, extras.
// Was beim Laden sofort läuft (nicht erst bei einem Klick), darf nur auf Früheres zugreifen.

// Vor createClient merken: Supabase räumt die Adresse nach dem Lesen des Links auf.
const PASSWORD_RECOVERY_LINK = /[#&]type=recovery\b/.test(window.location.hash);
const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const DEFAULT_USERNAME = 'antonio';
// Erfundene Beispielregale (supabase/011_demo_accounts.sql). Sie zeigen, wie ein Regal aussehen kann, und
// werden überall als Beispiel gekennzeichnet, damit niemand sie für echte Leser hält.
const DEMO_USERNAMES = new Set(['lenamarie', 'jonas_kr', 'sophie_liest']);
const isDemo = p=>!!(p && DEMO_USERNAMES.has(p.username));
const DEMO_BADGE = '<span class="demo-badge" title="Erfundenes Beispielregal">Beispiel</span>';

let currentUser = null;    // eingeloggter Auth-User (oder null)
let currentProfile = null; // profiles-Zeile des eingeloggten Users
let isAdminMember = false; // in der Tabelle admins eingetragen (Admin-Aktionen brauchen zusätzlich Zwei-Faktor)
let ownBan = null;         // eigene Sperre {reason, banned_at} oder null
let canUsePremium = false; // Premium oder Admin laut can_use_premium(); blendet nur Knöpfe ein, der Worker prüft selbst
let ownPremium = false;    // eigene Zeile in premium_members (gekauft oder geschenkt); Admins ohne Zeile dürfen kaufen
let ownPurchase = null;    // letzter eigener bezahlter Kauf {created_at} oder null (für den Widerruf)

let viewedProfile = null;  // profiles-Zeile des Regals, das gerade angezeigt wird

let books = [];       // Zeilen aus public.books für viewedProfile
let shelves = [];     // Zeilen aus public.shelves für viewedProfile
let categories = [];  // Zeilen aus public.categories für viewedProfile: {id, name}
let showcase = null;  // Vitrine von viewedProfile laut showcases_of(): {shelf_id, book_ids} oder null

let selectedId = null;
let displayedId = null; // Buch, das in seiner Reihe frontal steht; alle anderen Reihen zeigen ihren ersten Band
let shelfLoading = true;
let shelfLoadError = false;
let editingBookId = null;
let activeCategory = null;
let activeStatus = null;   // Filter nach Lesestatus: null (alle), 'read', 'reading' oder 'want'
let searchQuery = '';
let lastGroups = [];

const VIEW_KEY = 'bookshelf-view';
const SORT_KEY = 'bookshelf-sort';
const FACE_KEY = 'bookshelf-faceout';
const LAST_USER_KEY = 'bookshelf-last-user';
function getPref(key, fallback){
  try { return localStorage.getItem(key) || fallback; } catch(e){ return fallback; }
}
function setPref(key, value){
  try { localStorage.setItem(key, value); } catch(e){}
}
// Ohne gespeicherte Wahl: auf dem Handy das Cover-Raster, auf größeren Screens das Regal.
let viewMode = window.matchMedia('(max-width: 640px)').matches ? 'grid' : 'shelf';
try {
  const saved = localStorage.getItem(VIEW_KEY);
  if(saved === 'grid' || saved === 'shelf') viewMode = saved;
} catch(e){}

const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_IMAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>';
const ICON_BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const ICON_BELL_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.7 3A6 6 0 0 1 18 8c0 2.8.5 4.8 1.1 6.2"/><path d="M17 17H3s3-2 3-9c0-.9.2-1.8.6-2.6"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
const ICON_SLIDERS ='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.2" fill="#fff"/><circle cx="15" cy="17" r="2.2" fill="#fff"/></svg>';

// Buchfarben für Bände ohne gefundenes Cover; Index über den Reihennamen, damit eine Reihe einheitlich bleibt.
const FALLBACK_COLORS = [[59,13,18],[22,52,58],[44,36,80],[96,58,18],[30,48,36],[70,24,64],[24,38,72],[110,40,32]];

function hashStr(s){
  let h = 0;
  for(let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) >>> 0; }
  return h;
}

function romanize(num){
  const map=[[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let n=num, out='';
  for(const [v,s] of map){ while(n>=v){ out+=s; n-=v; } }
  return out || String(num);
}

function formatDate(iso){
  // T00:00 erzwingt lokale Zeit, sonst kann ein reines Datum je nach Zeitzone auf den Vortag rutschen.
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' });
}

let toastTimer = null;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2400);
}

function starsSVG(filled){
  const c = filled ? 'var(--red)' : 'var(--star-empty)';
  return `<svg viewBox="0 0 24 24" fill="${c}" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9L5.7 21l1.7-7L2 9.2l7.1-.6z"/></svg>`;
}

function escapeHtml(s){
  if(s == null) return '';
  // Escaped für Text- UND Attribut-Kontext: textContent->innerHTML lässt " und ' unangetastet,
  // was reicht, um z.B. aus data-label="${escapeHtml(...)}" auszubrechen. Deshalb manuell ersetzen.
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Cover (Open Library) ----
// Ein Buch hat entweder ein gewähltes Cover (books.cover_url, "none" = bewusst keins) oder wird per
// Titel+Autor bei Open Library gesucht. Treffer, Farben und Seitenverhältnis werden lokal gemerkt.
const COVER_CACHE_KEY = 'bookshelf-covers-v7';
let coverCache = {};
try {
  coverCache = JSON.parse(localStorage.getItem(COVER_CACHE_KEY)) || {};
  ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'].forEach(v=>localStorage.removeItem('bookshelf-covers-' + v));
} catch(e){ coverCache = {}; }

// Nur http(s)-Bilder, und Zeichen, die aus url('…') oder dem style-Attribut ausbrechen könnten, werden kodiert.
function safeImageUrl(raw){
  try {
    const u = new URL(String(raw).trim());
    if(u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if(u.protocol === 'http:') u.protocol = 'https:';
    return u.href.replace(/['"()\\\s<>]/g, c=>'%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  } catch(e){ return null; }
}
function largeCoverUrl(u){
  if(/covers\.openlibrary\.org\/.+-M\.jpg$/.test(u)) return u.replace(/-M\.jpg$/, '-L.jpg');
  if(/books\.google/.test(u)) return u.replace(/&zoom=\d/, '') + '&fife=w600-h900';
  return u;
}
const coverPending = new Map();
const coverGaveUp = new Set(); // Suche in dieser Sitzung gescheitert (Netz): kein Ladezustand mehr anzeigen
const coverQueue = [];
const coverQueued = new Set();
let coverActive = 0;
let coverSaveTimer = null;

function coverKey(b){
  if(b.cover_url) return 'url:' + b.cover_url;
  return (String(b.title||'') + '|' + String(b.author||'')).trim().toLowerCase();
}
function normTitle(s){
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'").replace(/[^a-z0-9']+/g, ' ').trim();
}
function coverUrl(id, size){ return `https://covers.openlibrary.org/b/id/${encodeURIComponent(id)}-${size}.jpg`; }

function saveCoverCache(){
  clearTimeout(coverSaveTimer);
  coverSaveTimer = setTimeout(()=>{
    try { localStorage.setItem(COVER_CACHE_KEY, JSON.stringify(coverCache)); } catch(e){}
  }, 300);
}

function lookupCover(b){
  const key = coverKey(b);
  if(coverCache[key]) return Promise.resolve(coverCache[key]);
  if(b.cover_url){
    const direct = b.cover_url === 'none' ? null : safeImageUrl(b.cover_url);
    coverCache[key] = { id: null, candidates: [], direct, pages: null, done: !direct };
    return Promise.resolve(coverCache[key]);
  }
  if(coverPending.has(key)) return coverPending.get(key);
  const p = (async ()=>{
    try {
      const q = `title=${encodeURIComponent(b.title)}${b.author ? `&author=${encodeURIComponent(b.author)}` : ''}&limit=3&fields=key,number_of_pages_median`;
      const r = await fetch(`https://openlibrary.org/search.json?${q}`);
      if(!r.ok) return null;
      const docs = (await r.json()).docs || [];
      const work = docs.find(d=>d.key);
      let entry = { id: null, candidates: [], pages: (docs[0] && docs[0].number_of_pages_median) || null };
      if(work){
        // Das Werk-Cover ist oft eine Übersetzung; deshalb die Ausgaben einzeln nach Sprache und Titel bewerten.
        const er = await fetch(`https://openlibrary.org${work.key}/editions.json?limit=60`);
        if(!er.ok) return null;
        const eds = (await er.json()).entries || [];
        const want = normTitle(b.title);
        const looksGerman = /[äöüß]/i.test(b.title) || /\b(der|die|das|und|im|zu|von|ein|eine)\b/i.test(b.title);
        const prefLang = looksGerman ? 'ger' : 'eng';
        const scored = [];
        for(const ed of eds){
          const cover = (ed.covers || []).find(c=>c > 0);
          if(!cover) continue;
          const langs = (ed.languages || []).map(l=>String(l.key).split('/').pop());
          const t = normTitle(ed.title);
          let score = 0;
          if(langs.some(l=>l === 'eng' || l === 'ger')) score += langs.includes(prefLang) ? 3 : 2;
          else if(langs.length) score -= 10;
          if(t === want) score += 3;
          else if(t.startsWith(want) || want.startsWith(t)) score += 1;
          if(score >= 0) scored.push({ cover, score, pages: ed.number_of_pages || null });
        }
        // Mehrere Kandidaten behalten: processCover überspringt Produktfotos zugunsten flacher Cover.
        scored.sort((a,b)=>b.score - a.score);
        const top = scored.filter((s,i,arr)=>arr.findIndex(o=>o.cover === s.cover) === i).slice(0, 4);
        if(top.length) entry = { id: null, candidates: top.map(s=>s.cover), pages: top[0].pages || entry.pages };
      }
      // Open Library kennt viele deutsche Ausgaben nicht: dann die Ausgabe bei Google Books suchen.
      if(!entry.candidates.length){
        const gb = await searchGoogleBooks(`intitle:${b.title}${b.author ? ' inauthor:' + b.author : ''}`);
        const hit = gb.find(c=>c.cover && titleMatches(c.title, b.title));
        if(hit) entry = { id: null, candidates: [], direct: hit.cover, pages: hit.pages || entry.pages };
      }
      coverCache[key] = entry;
      saveCoverCache();
      return entry;
    } catch(e){
      return null; // Netzfehler nicht cachen, beim nächsten Laden erneut versuchen
    } finally {
      coverPending.delete(key);
    }
  })();
  coverPending.set(key, p);
  return p;
}

// Liefert Farben/Emblem, oder {error:'nocors'} (Bild lädt, darf aber nicht ausgelesen werden) bzw. {error:'load'}.
function analyzeCover(src){
  return new Promise(resolve=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = ()=>{
      try {
        const w = 40, h = 60;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const at = (x, y)=>{ const i = (y*w + x) * 4; return [d[i], d[i+1], d[i+2]]; };
        const sat = p=>(Math.max(...p) - Math.min(...p)) / 255;
        const nearWhite = p=>p[0] > 232 && p[1] > 232 && p[2] > 232;
        let r=0, g=0, b=0, tw=0, borderN=0, borderWhite=0;
        const border = new Map();
        const px = [];
        for(let y=0;y<h;y++){
          for(let x=0;x<w;x++){
            const p = at(x, y);
            px.push(p);
            const wgt = sat(p) + 0.08; // gesättigte Pixel zählen mehr, sonst wird der Farbton graubraun
            r += p[0]*wgt; g += p[1]*wgt; b += p[2]*wgt; tw += wgt;
            if(x < 2 || y < 2 || x >= w-2 || y >= h-2){
              addBucket(border, p);
              borderN++;
              if(nearWhite(p)) borderWhite++;
            }
          }
        }
        // Rückengrund = häufigste Randfarbe; Schrift = häufigste Coverfarbe mit 4,5:1 Kontrast (13px-Titel sind keine Großschrift).
        const ground = topBucket(border);
        const lg = luminance(ground);
        const letters = new Map();
        px.forEach(p=>{ if(contrast(luminance(p), lg) >= 4.5) addBucket(letters, p); });
        const letter = letters.size
          ? topBucket(letters)
          : (contrast(luminance([250,250,250]), lg) >= contrast(luminance([20,20,20]), lg) ? [250,250,250] : [20,20,20]);

        // Produktfoto statt flachem Cover: weiße Ecken, aber kein durchgehend weißer Rand.
        const corners = [[0,0],[w-3,0],[0,h-3],[w-3,h-3]].filter(([cx, cy])=>{
          let white = 0;
          for(let yy=0; yy<3; yy++) for(let xx=0; xx<3; xx++) if(nearWhite(at(cx+xx, cy+yy))) white++;
          return white >= 7;
        }).length;
        const photo = corners >= 2 && borderWhite / borderN < 0.6;

        // Emblem für den Buchrücken: das Fenster mit den meisten "Bild"-Pixeln, die weder Grund- noch Schriftfarbe sind.
        const dist = (p, q)=>Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]);
        // Harte Helligkeitskanten markieren Schrift (auch in einer dritten Farbe); solche Fenster scheiden aus.
        const lum = px.map(luminance);
        const edge = lum.map((l, i)=>{
          const x = i % w, y = Math.floor(i / w);
          const right = x < w-1 ? Math.abs(l - lum[i+1]) : 0;
          const down = y < h-1 ? Math.abs(l - lum[i+w]) : 0;
          return Math.max(right, down) > 0.28 ? 1 : 0;
        });
        const s = 13;
        let emblem = null, bestScore = 0;
        // Oberes und unteres Sechstel auslassen: dort stehen fast immer Titel und Autor.
        for(let y0=Math.round(h*0.16); y0<=Math.round(h*0.84)-s; y0+=3){
          for(let x0=2; x0<=w-s-2; x0+=3){
            let score = 0, edges = 0;
            for(let yy=0; yy<s; yy++) for(let xx=0; xx<s; xx++){
              const p = at(x0+xx, y0+yy);
              edges += edge[(y0+yy)*w + x0+xx];
              if(dist(p, ground) > 80 && dist(p, letter) > 80) score += 0.35 + sat(p);
            }
            const edgeFrac = edges / (s * s);
            if(edgeFrac > 0.3) continue;
            score = score / (s * s) * (1 - edgeFrac * 1.5);
            if(score > bestScore){ bestScore = score; emblem = { x: x0 / (w - s) * 100, y: y0 / (h - s) * 100, size: w / s * 100 }; }
          }
        }
        if(bestScore < 0.42) emblem = null;

        resolve({
          rgb: [Math.round(r/tw), Math.round(g/tw), Math.round(b/tw)],
          ground,
          letter,
          photo,
          emblem: emblem && { x: +emblem.x.toFixed(1), y: +emblem.y.toFixed(1), size: Math.round(emblem.size) },
          ratio: img.naturalWidth / img.naturalHeight,
        });
      } catch(e){ resolve({ error: 'nocors' }); }
    };
    img.onerror = ()=>{
      // Ohne CORS-Header schlägt das Laden mit crossOrigin fehl; zeigen lässt sich das Bild trotzdem.
      const plain = new Image();
      plain.onload = ()=>resolve({ error: 'nocors', ratio: plain.naturalWidth / plain.naturalHeight });
      plain.onerror = ()=>resolve({ error: 'load' });
      plain.src = src;
    };
    img.src = src;
  });
}

function addBucket(map, p){
  const k = (p[0] >> 5) << 6 | (p[1] >> 5) << 3 | (p[2] >> 5);
  const e = map.get(k) || { n: 0, s: [0,0,0] };
  e.n++; e.s[0] += p[0]; e.s[1] += p[1]; e.s[2] += p[2];
  map.set(k, e);
}
function topBucket(map){
  let best = null;
  map.forEach(e=>{ if(!best || e.n > best.n) best = e; });
  return best.s.map(v=>Math.round(v / best.n));
}
function luminance([r,g,b]){
  const lin = v=>{ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
  return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
}
function contrast(l1, l2){
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function queueCovers(list){
  list.forEach(b=>{
    const e = coverCache[coverKey(b)];
    if(e && e.done) return;
    const k = coverKey(b);
    if(coverQueued.has(k)) return;
    coverQueued.add(k);
    coverQueue.push(b);
  });
  pumpCovers();
}

const COVER_CONCURRENCY = 6; // Erste Ladung ohne Cache: mehr parallele Lookups statt 2 nacheinander.
function pumpCovers(){
  while(coverActive < COVER_CONCURRENCY && coverQueue.length){
    const b = coverQueue.shift();
    const k = coverKey(b); // rememberCover ändert den Schlüssel unterwegs
    coverActive++;
    processCover(b).finally(()=>{
      coverActive--;
      coverQueued.delete(k);
      pumpCovers();
    });
  }
}

async function processCover(b){
  const entry = await lookupCover(b);
  if(!entry){
    coverGaveUp.add(coverKey(b));
    refreshBookVisual(b);
    return;
  }
  if(!entry.done && entry.direct){
    const info = await analyzeCover(entry.direct);
    if(info.error !== 'load'){
      const ok = !info.error;
      const ratio = info.ratio > 0.4 && info.ratio < 1 ? info.ratio : 0.66;
      Object.assign(entry, {
        src: entry.direct,
        srcLarge: largeCoverUrl(entry.direct),
        rgb: ok ? info.rgb : [70,70,70],
        ground: ok ? info.ground : [28,28,28],
        letter: ok ? info.letter : [245,245,245],
        emblem: ok ? info.emblem : null,
        ratio,
      });
    }
    entry.done = true;
    saveCoverCache();
  } else if(!entry.done){
    // Alle Kandidaten parallel laden statt nacheinander: Bildladen ist die Wartezeit, nicht die Analyse.
    const results = await Promise.all((entry.candidates || []).map(id=>
      analyzeCover(coverUrl(id, 'M')).then(info=>({ id, info }))
    ));
    const okResults = results.filter(r=>!r.info.error);
    const first = okResults[0] || null;
    const chosenFound = okResults.find(r=>!r.info.photo);
    // Alle Bilder fehlgeschlagen = vermutlich Netzproblem: nicht als erledigt merken, beim nächsten Laden erneut.
    if(results.length && !okResults.length){
      coverGaveUp.add(coverKey(b));
      refreshBookVisual(b);
      return;
    }
    const chosen = chosenFound || first;
    if(chosen){
      const i = chosen.info;
      Object.assign(entry, {
        id: chosen.id,
        src: coverUrl(chosen.id, 'M'),
        srcLarge: coverUrl(chosen.id, 'L'),
        rgb: i.rgb,
        ground: i.ground,
        letter: i.letter,
        emblem: i.emblem,
        ratio: i.ratio > 0.4 && i.ratio < 1 ? i.ratio : 0.66,
      });
    }
    entry.done = true;
    saveCoverCache();
  }
  rememberCover(b, entry.src);
  const meta = bookIndex.get(String(b.id));
  (meta ? meta.group.items : [b]).forEach(refreshBookVisual);
  scheduleFit();
}

// Ein gefundenes Cover als Adresse in books.cover_url ablegen (rund 70 Byte pro Buch, kein Bild), damit
// Besucher nicht jedes Mal Open Library und Google Books durchsuchen. Schreiben darf nur der Besitzer;
// fremde Regale bekommen ihre Cover, sobald ihr Besitzer sie einmal öffnet.
function rememberCover(b, url){
  if(!url || b.cover_url || !b.id || !/^https:\/\/(covers\.openlibrary\.org|books\.google\.com)\//.test(url)) return;
  const mine = devSandboxActive() ? isOwnerView() && books.includes(b) : !!(currentUser && b.user_id === currentUser.id && !ownBan);
  if(!mine) return;
  const entry = coverCache[coverKey(b)];
  b.cover_url = url;
  coverCache[coverKey(b)] = entry; // Farben und Seitenverhältnis gelten auch unter der neuen Adresse
  saveCoverCache();
  db('books').update({ cover_url: url }).eq('id', b.id).then(({ error })=>{
    if(error) b.cover_url = null; // beim nächsten Laden erneut versuchen
  });
}

function isLight(rgb){
  return luminance(rgb) > 0.36;
}

// Bekannte Cover-Adresse heißt noch nicht geladenes Bild: bis dahin den Ladezustand zeigen statt einer Farbfläche.
const coverPainted = new Set();
const coverPreloading = new Set();
function coverIsPainted(url, b){
  if(coverPainted.has(url)) return true;
  const img = new Image();
  img.src = url;
  if(img.complete && img.naturalWidth){ coverPainted.add(url); return true; }
  if(!coverPreloading.has(url)){
    coverPreloading.add(url);
    img.onload = img.onerror = ()=>{
      coverPainted.add(url);
      coverPreloading.delete(url);
      const meta = bookIndex.get(String(b.id));
      (meta ? meta.group.items : [b]).forEach(refreshBookVisual);
    };
  }
  return false;
}

// Bände ohne eigenes Cover übernehmen Farben und Emblem vom ersten bebilderten Band der Reihe.
function seriesDonor(b){
  const meta = bookIndex.get(String(b.id)) || browseIndex.get(String(b.id));
  if(!meta) return null;
  for(const o of meta.group.items){
    const e = coverCache[coverKey(o)];
    if(e && e.src && e.rgb && e.ground) return e;
  }
  return null;
}

function bookVisual(b, seriesLabel){
  const entry = coverCache[coverKey(b)];
  const has = !!(entry && entry.src && entry.rgb);
  const donor = has ? null : seriesDonor(b);
  const src = has ? entry : donor;
  const fallback = FALLBACK_COLORS[hashStr(seriesLabel || b.title) % FALLBACK_COLORS.length];
  const rgb = has ? entry.rgb : (donor ? donor.ground : fallback);
  const pages = b.page_count || (entry && entry.pages) || null;
  const width = pages ? Math.round(Math.max(24, Math.min(64, 14 + pages * 0.05))) : 26 + (hashStr(String(b.id)) % 14);
  const hf = (0.9 + (hashStr(String(b.id) + 'h') % 10) / 100).toFixed(2);
  const ground = src && src.ground ? src.ground : rgb;
  const letter = src && src.letter ? src.letter : (isLight(rgb) ? [22,22,22] : [250,250,250]);
  const emblem = src && src.emblem ? { ...src.emblem, url: src.src } : null;
  return {
    has,
    loading: has ? !coverIsPainted(entry.src, b) : (!(entry && entry.done) && !coverGaveUp.has(coverKey(b))),
    rgb,
    ground,
    letter,
    emblem,
    ink: isLight(rgb) ? 'ink-dark' : 'ink-light',
    ratio: (has && entry.ratio) ? entry.ratio : 0.66,
    width,
    hf,
    pages,
    pagesEstimated: !b.page_count && !!pages,
    url: has ? entry.src : null,
    urlLarge: has ? (entry.largeOk ? entry.srcLarge : entry.src) : null,
  };
}

// Google liefert für manche Bände statt einer großen Fassung sein „image not available“-Bild, mit
// anderem Seitenverhältnis. Die große Fassung gilt darum erst, wenn sie zum kleinen Bild passt.
const largeCoverChecks = new Set();
function verifyLargeCover(b){
  const entry = coverCache[coverKey(b)];
  if(!entry || !entry.src || !entry.srcLarge || entry.largeOk !== undefined || largeCoverChecks.has(coverKey(b))) return;
  if(entry.srcLarge === entry.src){ entry.largeOk = true; return; }
  largeCoverChecks.add(coverKey(b));
  const ratioOf = url=>new Promise(resolve=>{
    const img = new Image();
    img.onload = ()=>resolve(img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0);
    img.onerror = ()=>resolve(0);
    img.src = url;
  });
  Promise.all([ratioOf(entry.src), ratioOf(entry.srcLarge)]).then(([small, large])=>{
    // Kein Netz: nichts merken, beim nächsten Öffnen erneut prüfen.
    if(!small){ largeCoverChecks.delete(coverKey(b)); return; }
    entry.largeOk = large > 0 && Math.abs(small - large) < 0.04;
    saveCoverCache();
    refreshBookVisual(b);
  });
}

function visualStyle(v, large){
  let s = `--c:${v.rgb.join(',')};--g:${v.ground.join(',')};--l:${v.letter.join(',')};--ratio:${v.ratio.toFixed(3)};--w:${v.width};--hf:${v.hf}`;
  if(v.url) s += large ? `;--cover:url('${v.urlLarge}');--cover-sm:url('${v.url}')` : `;--cover:url('${v.url}')`;
  if(v.emblem) s += `;--emblem:url('${v.emblem.url}');--ex:${v.emblem.x}%;--ey:${v.emblem.y}%;--es:${v.emblem.size}%`;
  return s;
}

function refreshBookVisual(b){
  const meta = bookIndex.get(String(b.id)) || browseIndex.get(String(b.id));
  const label = meta ? meta.group.label : '';
  const v = bookVisual(b, label);
  document.querySelectorAll(`[data-book="${CSS.escape(String(b.id))}"]`).forEach(el=>{
    el.setAttribute('style', visualStyle(v, el.classList.contains('detail-cover')));
    el.classList.toggle('has-cover', v.has);
    el.classList.toggle('has-emblem', !!v.emblem);
    el.classList.toggle('is-loading', v.loading);
    el.classList.remove('ink-light','ink-dark');
    el.classList.add(v.ink);
  });
  if(String(selectedId) === String(b.id)){
    const hero = document.querySelector('.detail-hero');
    if(hero) hero.style.setProperty('--c', v.rgb.join(','));
  }
}

function genCoverHtml(b, group){
  const sub = group.items.length > 1 ? `${escapeHtml(b.author || '')} · Band ${b.series_order}` : escapeHtml(b.author || '');
  return `<span class="gen-cover"><b>${escapeHtml(b.title)}</b><small>${sub}</small></span>`;
}

// ---- Buchsuche (Google Books + Open Library) ----
// Online läuft Google Books über den Cloudflare-Worker /api/books (worker.js), der den Key als Secret hält.
// Ein Key in config.js (nur für lokales Testen) geht stattdessen direkt zu Google.
const GB_KEY = window.GOOGLE_BOOKS_API_KEY || '';
let gbUnavailable = false;

function htmlToText(html){
  return new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent.trim();
}
function cleanDescription(s){
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/\*\*|__/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\n-{3,}[\s\S]*$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function gbCover(info){
  const l = info.imageLinks;
  if(!l) return null;
  return safeImageUrl(String(l.thumbnail || l.smallThumbnail).replace(/&edge=curl/, ''));
}

async function searchGoogleBooks(q){
  if(gbUnavailable) return [];
  try {
    const r = await fetch(GB_KEY
      ? `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books&key=${encodeURIComponent(GB_KEY)}`
      : `/api/books?q=${encodeURIComponent(q)}`);
    // Gesperrt, Kontingent leer oder kein Worker (lokaler Server): für diese Sitzung nur noch Open Library fragen.
    if([403, 404, 429, 503].includes(r.status) || !(r.headers.get('content-type') || '').includes('json')){ gbUnavailable = true; return []; }
    if(!r.ok) return [];
    const j = await r.json();
    return (j.items || []).map(item=>{
      const v = item.volumeInfo || {};
      return {
        source: 'Google Books',
        title: v.title || '',
        authors: v.authors || [],
        year: (v.publishedDate || '').slice(0, 4),
        pages: v.pageCount || null,
        lang: v.language || '',
        cover: gbCover(v),
        description: cleanDescription(htmlToText(v.description)),
        genres: v.categories || [],
      };
    }).filter(c=>c.title);
  } catch(e){ return []; }
}

async function searchOpenLibrary(q){
  try {
    const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median,subject`);
    if(!r.ok) return [];
    const j = await r.json();
    return (j.docs || []).map(d=>({
      source: 'Open Library',
      olKey: /^\/works\/OL\d+W$/.test(d.key) ? d.key : null,
      title: d.title || '',
      authors: d.author_name || [],
      year: d.first_publish_year ? String(d.first_publish_year) : '',
      pages: d.number_of_pages_median || null,
      lang: '',
      cover: d.cover_i ? coverUrl(d.cover_i, 'M') : null,
      description: '',
      genres: d.subject || [],
    })).filter(c=>c.title);
  } catch(e){ return []; }
}

// Ergebnisse beider Quellen zusammenführen; Doppelte (gleicher Titel + Autor) ergänzen sich gegenseitig.
async function searchBooks(q){
  const [gb, ol] = await Promise.all([searchGoogleBooks(q), searchOpenLibrary(q)]);
  const merged = [];
  [...gb, ...ol].forEach(c=>{
    const k = normTitle(c.title) + '|' + normTitle((c.authors[0] || '').split(' ').pop());
    const twin = merged.find(m=>m._k === k);
    if(twin){
      twin.cover = twin.cover || c.cover;
      twin.pages = twin.pages || c.pages;
      twin.description = twin.description || c.description;
      twin.olKey = twin.olKey || c.olKey;
      twin.genres = [...new Set([...twin.genres, ...c.genres])];
      twin.covers.push(...(c.cover ? [{ url: c.cover, label: c.source }] : []));
      return;
    }
    merged.push({ ...c, _k: k, covers: c.cover ? [{ url: c.cover, label: c.source + (c.year ? ' · ' + c.year : '') }] : [] });
  });
  return merged;
}

// Google liefert grobe Pfade ("Fiction / Fantasy / Epic"), Open Library viele, teils verrauschte Subjects.
// Beides wird auf eine feste Genre-Liste abgebildet. Spezifische Genres stehen vor ihrem Obergenre
// (parent), damit eine Kategorie wie "Urban Fantasy" nicht als "Fantasy" erkannt wird.
const GENRE_RULES = [
  { name: 'Space Opera', parent: 'Sci-Fi', re: /space opera|space warfare|interstellar/ },
  { name: 'Military Sci-Fi', parent: 'Sci-Fi', re: /military science fiction|military sf\b/ },
  { name: 'Cyberpunk', parent: 'Sci-Fi', re: /cyberpunk/ },
  { name: 'Dystopia', parent: 'Sci-Fi', re: /dystop/ },
  { name: 'Post-Apocalyptic', parent: 'Sci-Fi', re: /post-?apocalyp|endzeit/ },
  { name: 'Time Travel', parent: 'Sci-Fi', re: /time travel|zeitreise/ },
  { name: 'Steampunk', parent: 'Sci-Fi', re: /steampunk/ },
  { name: 'LitRPG', parent: 'Fantasy', re: /litrpg|gamelit|progression fantasy/ },
  { name: 'Romantasy', parent: 'Fantasy', re: /romantasy|romantic fantasy|fantasy romance/ },
  { name: 'Urban Fantasy', parent: 'Fantasy', re: /urban fantasy/ },
  { name: 'Epic Fantasy', parent: 'Fantasy', re: /epic fantasy|high fantasy|epische fantasy/ },
  { name: 'Dark Fantasy', parent: 'Fantasy', re: /dark fantasy/ },
  { name: 'Paranormal', parent: 'Fantasy', re: /paranormal|vampires?\b|werewol/ },
  { name: 'Fairy Tales', parent: 'Fantasy', re: /fairy tales?|märchen|folklore/ },
  { name: 'Mythology', parent: 'Fantasy', re: /mytholog/ },
  { name: 'Psychological Thriller', parent: 'Thriller', re: /psychological (thriller|suspense)|psychothriller/ },
  { name: 'Spy', parent: 'Thriller', re: /espionage|\bspies\b|spy (stories|fiction|thrillers?)|spionage/ },
  { name: 'Political Thriller', parent: 'Thriller', re: /political thriller/ },
  { name: 'Cozy Mystery', parent: 'Crime', re: /cozy myster/ },
  { name: 'True Crime', parent: 'Nonfiction', re: /true crime/ },
  { name: 'Historical Fiction', re: /historical fiction|historischer roman/ },
  { name: 'Fantasy', re: /\bfantasy\b|fantastik/ },
  { name: 'Sci-Fi', re: /science.?fiction|\bsci-?fi\b/ },
  { name: 'Horror', re: /horror|grusel/ },
  { name: 'Thriller', re: /thriller|suspense/ },
  { name: 'Crime', re: /\bcrime\b|mystery|detective|krimi|kriminal/ },
  { name: 'Romance', re: /\bromance\b|love stories|liebesroman/ },
  { name: 'Adventure', re: /adventure|abenteuer/ },
  { name: 'Action', re: /\baction\b/ },
  { name: 'Humor', re: /\bhumou?r|humorous|comedy|satire/ },
  { name: 'War', re: /war stories|\bwar fiction|kriegsroman/ },
  { name: 'Western', re: /western stories|western fiction|\bwesterns\b/ },
  { name: 'Literary Fiction', re: /contemporary fiction|literary fiction|gegenwartsliteratur/ },
  { name: 'Classics', re: /\bclassics?\b|klassiker/ },
  { name: 'Young Adult', re: /^young adult|juvenile fiction|jugendbuch/ },
  { name: "Children's", re: /children's (fiction|stories|books)|picture books|kinderbuch/ },
  { name: 'Graphic Novel', re: /graphic novel|comic books|comics & graphic|\bmanga\b/ },
  { name: 'Poetry', re: /\bpoetry\b|lyrik|gedichte/ },
  { name: 'Biography', nonfiction: true, re: /biograph|memoir/ },
  { name: 'History', nonfiction: true, re: /^history\b|^geschichte/ },
  { name: 'Science', nonfiction: true, re: /^science$|popular science|physics|astronomy|biology|naturwissenschaft/ },
  { name: 'Psychology', nonfiction: true, re: /psycholog/ },
  { name: 'Philosophy', nonfiction: true, re: /philosoph/ },
  { name: 'Self-Help', nonfiction: true, re: /self-?help|personal growth|ratgeber/ },
  { name: 'Business', nonfiction: true, re: /business|economics|wirtschaft/ },
  { name: 'Cookbook', nonfiction: true, re: /cooking|cookbook|kochbuch/ },
  { name: 'Nonfiction', nonfiction: true, re: /non-?fiction|sachbuch/ },
];
const MAX_NEW_GENRES = 4;

function detectGenres(raw){
  const tokens = [];
  (raw || []).forEach(s=>{
    const t = String(s).toLowerCase().trim();
    if(/^(nyt|series|franchise|form|place|person|time):/.test(t)) return;
    const clean = t.replace(/^genre:/, '');
    tokens.push(clean, ...clean.split(/\s*\/\s*/));
  });
  const isFiction = tokens.some(t=>/\bfiction\b|\bnovel|\broman\b/.test(t.replace(/non-?fiction/g, '')));
  const rules = GENRE_RULES.filter(r=>!(r.nonfiction && isFiction));
  const found = new Set();
  tokens.forEach(t=>{
    const hits = rules.filter(r=>r.re.test(t));
    // Sammel-Regale wie "Science fiction, fantasy, horror" oder "Action & adventure" sagen nichts über das Buch.
    if(hits.length > 1 && /,|&| and /.test(t)) return;
    hits.forEach(r=>found.add(r.name));
  });
  if(found.has('Fantasy') && found.has('Romance')) found.add('Romantasy');
  [...found].forEach(n=>{ const p = GENRE_RULES.find(r=>r.name === n).parent; if(p) found.add(p); });
  if(found.has('Young Adult')) found.delete("Children's");
  // In Listenreihenfolge zurückgeben: spezifische zuerst.
  return GENRE_RULES.map(r=>r.name).filter(n=>found.has(n));
}

// Welches Genre eine vorhandene Kategorie meint: exakter Name zuerst, sonst die erste passende Regel.
function genreOfCategory(name){
  const n = name.toLowerCase();
  const rule = GENRE_RULES.find(r=>r.name.toLowerCase() === n) || GENRE_RULES.find(r=>r.re.test(n));
  return rule ? rule.name : null;
}

// Erkannte Genres -> IDs vorhandener Kategorien plus höchstens vier Namen, für die es noch keine gibt.
function suggestCategories(raw){
  return categoriesForGenres(detectGenres(raw));
}
// Dasselbe für schon erkannte Genres (Namen aus GENRE_RULES).
function categoriesForGenres(genres){
  const ids = new Set(), fresh = [];
  genres.forEach(g=>{
    const hit = categories.find(c=>genreOfCategory(c.name) === g);
    if(hit) ids.add(hit.id); else fresh.push(g);
  });
  return { ids, fresh: fresh.slice(0, MAX_NEW_GENRES) };
}

async function fetchDescription(c){
  if(c.description) return c.description;
  if(!c.olKey) return '';
  try {
    const w = await (await fetch(`https://openlibrary.org${c.olKey}.json`)).json();
    const d = typeof w.description === 'string' ? w.description : (w.description && w.description.value);
    return d ? cleanDescription(d) : '';
  } catch(e){ return ''; }
}

function titleMatches(a, b){
  const x = normTitle(a), y = normTitle(b);
  return !!x && !!y && (x.startsWith(y) || y.startsWith(x));
}

// Cover-Vorschläge: passende Treffer beider Quellen plus englische/deutsche Ausgaben des Open-Library-Werks.
// hitsOut: optionale Liste, in die die passenden Suchtreffer kommen (der Scan liest daraus die Genres).
async function findCoverOptions(title, author, preset = [], seriesLabel = '', hitsOut = null){
  const list = [];
  const push = (u, label)=>{ const s = safeImageUrl(u); if(s && !list.some(o=>o.url === s)) list.push({ url: s, label }); };
  preset.forEach(o=>push(o.url, o.label));
  const res = await searchBooks([title, author].filter(Boolean).join(' '));
  const hits = res.filter(c=>titleMatches(c.title, title));
  if(hitsOut) hitsOut.push(...hits);
  // Kein Treffer für den (oft deutschen) Titel: Cover der Original-Reihe desselben Autors anbieten.
  if(!hits.some(c=>c.cover) && seriesLabel && author){
    const series = await searchOpenLibrary(`${seriesLabel} ${author}`);
    const surname = normTitle(author.split(',')[0].split(' ').pop());
    series
      .filter(c=>c.cover && c.authors.some(a=>normTitle(a).includes(surname)) && !/\b(set|collection|box|bundle|vol\.?\s*\d+\s*-)/i.test(c.title))
      .forEach(c=>push(c.cover, `${c.title} (Original)`));
  }
  hits.forEach(c=>c.covers.forEach(o=>push(o.url, o.label)));
  const work = hits.find(c=>c.olKey);
  if(work){
    try {
      const eds = (await (await fetch(`https://openlibrary.org${work.olKey}/editions.json?limit=40`)).json()).entries || [];
      eds.forEach(ed=>{
        const langs = (ed.languages || []).map(l=>String(l.key).split('/').pop());
        if(langs.length && !langs.some(l=>l === 'eng' || l === 'ger')) return;
        // Ohne Sprachangabe nur, wenn der Titel passt (sonst landen Übersetzungen wie "Mañana Azul" in der Auswahl).
        if(!langs.length && !titleMatches(ed.title || '', title)) return;
        const cid = (ed.covers || []).find(x=>x > 0);
        if(cid) push(coverUrl(cid, 'M'), 'Open Library' + (ed.publish_date ? ' · ' + ed.publish_date : ''));
      });
    } catch(e){}
  }
  return list.slice(0, 14);
}

// Seitenzahl und Klappentext eines vorhandenen Buchs nachschlagen; nur was gebraucht wird, wird gesucht.
async function findBookDetails(title, author, { pages = true, description = true } = {}){
  const res = await searchBooks([title, author].filter(Boolean).join(' '));
  const hits = res.filter(c=>titleMatches(c.title, title));
  const found = { pages: null, description: '' };
  if(pages) found.pages = (hits.find(c=>c.pages) || {}).pages || null;
  if(description){
    for(const c of hits){
      const d = await fetchDescription(c);
      if(d){ found.description = d; break; }
    }
  }
  return found;
}

// Wiederverwendbare Cover-Auswahl: "" = automatisch suchen, "none" = bewusst kein Cover, sonst Bild-URL.
function createCoverPicker(container, onChange){
  const state = { value: '', options: [], loading: false };
  const render = ()=>{
    if(onChange) onChange(state);
    const custom = state.value && state.value !== 'none' && !state.options.some(o=>o.url === state.value);
    const opts = [...(custom ? [{ url: state.value, label: 'Eigene URL' }] : []), ...state.options];
    container.innerHTML = `
      <div class="cp-strip" role="group" aria-label="Cover wählen">
        <button type="button" class="cp-opt cp-text ${state.value === '' ? 'is-selected' : ''}" data-v="" aria-pressed="${state.value === ''}">Auto&shy;matisch</button>
        ${opts.map(o=>`<button type="button" class="cp-opt ${state.value === o.url ? 'is-selected' : ''}" data-v="${escapeHtml(o.url)}" aria-pressed="${state.value === o.url}" title="${escapeHtml(o.label)}"><img src="${escapeHtml(o.url)}" alt="${escapeHtml(o.label)}" loading="lazy" referrerpolicy="no-referrer"></button>`).join('')}
        ${state.loading ? '<span class="cp-loading">Suche Cover …</span>' : ''}
        <button type="button" class="cp-opt cp-text ${state.value === 'none' ? 'is-selected' : ''}" data-v="none" aria-pressed="${state.value === 'none'}">Kein Cover</button>
      </div>
      <div class="cp-url">
        <input type="url" placeholder="Oder eigene Bild-URL einfügen" aria-label="Eigene Bild-URL">
        <button type="button" class="btn btn-secondary">Übernehmen</button>
      </div>`;
    container.querySelectorAll('.cp-opt').forEach(btn=>{
      btn.addEventListener('click', ()=>{ state.value = btn.getAttribute('data-v'); render(); });
      const img = btn.querySelector('img');
      if(img) img.addEventListener('error', ()=>{ if(state.value !== btn.getAttribute('data-v')) btn.remove(); });
    });
    const input = container.querySelector('.cp-url input');
    const apply = ()=>{
      const url = safeImageUrl(input.value);
      if(!url){ showToast('Bitte eine gültige Bild-Adresse (https://…) einfügen'); return; }
      state.value = url;
      render();
    };
    container.querySelector('.cp-url button').addEventListener('click', apply);
    input.addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); apply(); } });
  };
  render();
  return {
    get value(){ return state.value; },
    set(value, options){
      state.value = value || '';
      if(options) state.options = options;
      render();
    },
    setLoading(on){ state.loading = on; render(); },
  };
}

function categoryNameById(id){
  const c = categories.find(c=>c.id===id);
  return c ? c.name : 'Unkategorisiert';
}

// ---- Kategorie-Mehrfachauswahl (Toggle-Chips) ----
async function toggleShelfCategory(shelfId, categoryId, isActive){
  if(isActive){
    const { error } = await db('shelf_categories').insert({ shelf_id: shelfId, category_id: categoryId });
    if(error){ showToast('Fehler beim Speichern'); return false; }
  } else {
    const { error } = await db('shelf_categories').delete().eq('shelf_id', shelfId).eq('category_id', categoryId);
    if(error){ showToast('Fehler beim Speichern'); return false; }
  }
  return true;
}

// Sofort-Speichern-Variante: für ein bestehendes Regal, jeder Klick schreibt direkt in die DB.
function renderCategoryToggleList(containerEl, shelfId, currentIds){
  if(!containerEl) return;
  if(categories.length === 0){
    containerEl.innerHTML = '<p class="cat-toggle-empty">Noch keine Kategorien angelegt.</p>';
    return;
  }
  const selected = new Set(currentIds);
  containerEl.innerHTML = categories.map(c=>`
    <button type="button" class="cat-toggle ${selected.has(c.id)?'active':''}" data-id="${escapeHtml(c.id)}" aria-pressed="${selected.has(c.id)}">${escapeHtml(c.name)}</button>
  `).join('');
  containerEl.querySelectorAll('.cat-toggle').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id');
      const nowActive = !btn.classList.contains('active');
      btn.classList.toggle('active', nowActive); // optimistisch, damit z.B. das Regal-Modal (das render() nicht neu aufbaut) sofort korrekt aussieht
      btn.setAttribute('aria-pressed', nowActive);
      const ok = await toggleShelfCategory(shelfId, id, nowActive);
      if(!ok){ btn.classList.toggle('active', !nowActive); btn.setAttribute('aria-pressed', !nowActive); return; }
      await refreshAndRender();
    });
  });
}

// Lokale Variante: für das "Neues Buch"-Formular, Auswahl wird erst beim Absenden gespeichert.
function renderCategoryPickerList(containerEl, selectedIds, disabled){
  if(!containerEl) return;
  if(categories.length === 0){
    containerEl.innerHTML = '<p class="cat-toggle-empty">Noch keine Kategorien angelegt.</p>';
    return;
  }
  containerEl.innerHTML = categories.map(c=>`
    <button type="button" class="cat-toggle ${selectedIds.has(c.id)?'active':''}" data-id="${escapeHtml(c.id)}" aria-pressed="${selectedIds.has(c.id)}" ${disabled?'disabled':''}>${escapeHtml(c.name)}</button>
  `).join('');
  if(disabled) return;
  containerEl.querySelectorAll('.cat-toggle').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-id');
      if(selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      const on = btn.classList.toggle('active');
      btn.setAttribute('aria-pressed', on);
    });
  });
}

function isOwnerView(){
  if(devSandboxActive()) return true;
  // Gesperrte Konten sehen ihr Regal nur noch lesend; die Datenbank lehnt Änderungen ohnehin ab.
  return !!(currentUser && viewedProfile && currentUser.id === viewedProfile.id && !ownBan);
}

// ---- Designs ----
const THEME_KEY = 'bookshelf-theme';
const THEMES = [
  { id: 'auto', name: 'Automatisch', note: 'Folgt Hell/Dunkel deines Systems', wall: 'linear-gradient(135deg, #efeeeb 50%, #121214 50%)', shelf: '#6d6d70', accent: '#d23a24' },
  { id: 'light', name: 'Hell', note: 'Galeriewand, Stahlbrett', wall: '#efeeeb', shelf: '#29292b', accent: '#d23a24' },
  { id: 'dark', name: 'Dunkel', note: 'Anthrazit, Aluminiumbrett', wall: '#121214', shelf: '#9fa3ab', accent: '#d23a24' },
  { id: 'oak', name: 'Eiche', note: 'Warm, Holzbrett', wall: '#ece6dc', shelf: '#b98b5b', accent: '#2f6b55' },
  { id: 'midnight', name: 'Mitternacht', note: 'Nachtblau, Messingbrett', wall: '#0e1726', shelf: '#cfa962', accent: '#e2b65a' },
  { id: 'sage', name: 'Salbei', note: 'Ruhiges Grün, weißes Brett', wall: '#e3e9e2', shelf: '#f8f9f6', accent: '#1d6b66' },
];
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function savedTheme(){
  try { const t = localStorage.getItem(THEME_KEY); return THEMES.some(x=>x.id === t) ? t : 'oak'; } catch(e){ return 'oak'; }
}
function applyTheme(choice){
  const resolved = choice === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : choice;
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--wall').trim());
}
// Auswahl mit Farbmustern in den Einstellungen.
function renderThemeChoices(el){
  const current = savedTheme();
  el.innerHTML = THEMES.map(t=>`
    <button type="button" class="theme-item" role="radio" aria-checked="${t.id === current}" data-theme-id="${t.id}">
      <span class="theme-swatch" style="background:${t.wall}"><i style="background:${t.accent}"></i><b style="background:${t.shelf}"></b></span>
      <span class="theme-text"><span class="theme-name">${t.name}</span><span class="theme-note">${t.note}</span></span>
    </button>`).join('');
  el.querySelectorAll('.theme-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-theme-id');
      setPref(THEME_KEY, id);
      applyTheme(id);
      renderThemeChoices(el);
      el.querySelector(`[data-theme-id="${id}"]`).focus();
    });
  });
}
darkQuery.addEventListener('change', ()=>{ if(savedTheme() === 'auto') applyTheme('auto'); });
applyTheme(savedTheme());

// ---- Lokaler Testmodus ----
// Auf localhost ist man ohne Login Besitzer eines Regals: Antonios (Admin mit Premium) oder eines der
// Demo-Regale (ohne Premium), wählbar in den Einstellungen. Alle Änderungen landen in einer Kopie je
// Regal im localStorage; die echte Datenbank wird nie beschrieben (RLS würde es ohnehin ablehnen).
const DEV_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost');
const DEV_IDENTITIES = [DEFAULT_USERNAME, ...DEMO_USERNAMES];
const DEV_AS_KEY = 'bookshelf-dev-as';
const SANDBOX_KEY = 'bookshelf-dev-sandbox-v1';
let devAs = DEFAULT_USERNAME;
try { if(DEV_IDENTITIES.includes(localStorage.getItem(DEV_AS_KEY))) devAs = localStorage.getItem(DEV_AS_KEY); } catch(e){}
let sandbox = null;
// Antonios Kopie behält ihren alten Schlüssel, damit vorhandene Testdaten bleiben.
const sandboxKey = ()=>devAs === DEFAULT_USERNAME ? SANDBOX_KEY : `${SANDBOX_KEY}:${devAs}`;
function loadSandbox(){
  try { sandbox = JSON.parse(localStorage.getItem(sandboxKey())); } catch(e){ sandbox = null; }
}
loadSandbox();

function devSandboxActive(){
  return DEV_LOCAL && !currentUser && !!viewedProfile && viewedProfile.username === devAs;
}
// Nur Antonio hat im Testmodus Premium; die Demo-Regale zeigen, was Leser ohne Premium sehen.
function devPremium(){
  return devSandboxActive() && devAs === DEFAULT_USERNAME;
}

async function setDevAs(username){
  devAs = username;
  try { localStorage.setItem(DEV_AS_KEY, username); } catch(e){}
  loadSandbox();
  selectedId = null;
  displayedId = null;
  goToUser(username);
  showToast(username === DEFAULT_USERNAME ? 'Du testest als @antonio, mit Premium' : `Du testest als @${username}, ohne Premium`);
}

function saveSandbox(){
  try { localStorage.setItem(sandboxKey(), JSON.stringify(sandbox)); } catch(e){ showToast('Lokaler Speicher ist voll'); }
}

function db(table){
  return devSandboxActive() ? sandboxTable(table) : supabaseClient.from(table);
}

// Bildet genau die Supabase-Aufrufe nach, die die App zum Schreiben nutzt: insert/update/delete + eq + select().single().
function sandboxTable(table){
  let op = null, payload = null, single = false;
  const filters = [];
  const run = ()=>{
    const match = r=>filters.every(([k, v])=>String(r[k]) === String(v));
    if(op === 'insert'){
      const list = (Array.isArray(payload) ? payload : [payload]).map(p=>({
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        user_id: sandbox.profileId,
        ...p,
      }));
      sandbox[table].push(...list);
      saveSandbox();
      return { data: single ? list[0] : list, error: null };
    }
    if(op === 'update'){
      sandbox[table].forEach(r=>{ if(match(r)) Object.assign(r, payload); });
    } else if(op === 'delete'){
      const removed = sandbox[table].filter(match).map(r=>r.id);
      sandbox[table] = sandbox[table].filter(r=>!match(r));
      if(table === 'categories') sandbox.shelf_categories = sandbox.shelf_categories.filter(sc=>!removed.includes(sc.category_id));
      if(table === 'shelves') sandbox.shelf_categories = sandbox.shelf_categories.filter(sc=>!removed.includes(sc.shelf_id));
    }
    saveSandbox();
    return { data: null, error: null };
  };
  const q = {
    insert(p){ op = 'insert'; payload = p; return q; },
    update(p){ op = 'update'; payload = p; return q; },
    delete(){ op = 'delete'; return q; },
    eq(k, v){ filters.push([k, v]); return q; },
    select(){ return q; },
    single(){ single = true; return q; },
    then(resolve, reject){ try { resolve(run()); } catch(e){ reject(e); } },
  };
  return q;
}

function applySandboxToState(){
  categories = [...sandbox.categories].sort((a, b)=>a.name.localeCompare(b.name, 'de'));
  shelves = sandbox.shelves.map(s=>({
    ...s,
    categoryIds: sandbox.shelf_categories.filter(sc=>sc.shelf_id === s.id).map(sc=>sc.category_id),
  }));
  books = [...sandbox.books].sort((a, b)=>(a.series_order || 0) - (b.series_order || 0));
  showcase = sandbox.showcase || null;
}

function seedSandbox(profileId, cats, shelvesData, booksData, showcaseRow){
  sandbox = {
    profileId,
    categories: cats.map(c=>({ ...c })),
    shelves: shelvesData.map(({ shelf_categories, ...s })=>({ ...s })),
    shelf_categories: shelvesData.flatMap(s=>(s.shelf_categories || []).map(sc=>({ shelf_id: s.id, category_id: sc.category_id }))),
    books: booksData.map(b=>({ ...b })),
    showcase: showcaseRow,
  };
  saveSandbox();
}

async function resetSandbox(){
  sandbox = null;
  try { localStorage.removeItem(sandboxKey()); } catch(e){}
  selectedId = null;
  displayedId = null;
  await refreshAndRender();
  showToast('Testdaten auf den echten Stand zurückgesetzt');
}
