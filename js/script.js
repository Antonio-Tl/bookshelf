const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const DEFAULT_USERNAME = 'antonio';

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
const DEV_IDENTITIES = [DEFAULT_USERNAME, 'lenamarie', 'jonas_kr', 'sophie_liest'];
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

// ---- Auth ----
async function initAuth(){
  const { data:{ session } } = await supabaseClient.auth.getSession();
  await handleSession(session);
  supabaseClient.auth.onAuthStateChange((_event, session)=>{ handleSession(session); });
}

async function handleSession(session){
  currentUser = session ? session.user : null;
  if(currentUser){
    await loadProfile();
    if(currentProfile && !currentProfile.username){
      openUsernameModal();
    } else if(currentProfile && getPref(AFTER_LOGIN_KEY, '')){
      // Nach dem Google-Login dorthin zurück, wo die Anmeldung gestartet wurde.
      const target = getPref(AFTER_LOGIN_KEY, '');
      setPref(AFTER_LOGIN_KEY, '');
      if(target === 'admin') navigate('?view=admin');
      else if(target === 'buy') openBuy();
      else goToUser(currentProfile.username);
    }
    loadSocial();
  } else {
    currentProfile = null;
    isAdminMember = false;
    ownBan = null;
    canUsePremium = false;
    ownPremium = false;
    ownPurchase = null;
    resetSocial();
  }
  // Login/Logout auf localhost wechselt zwischen Testkopie und echten Daten.
  if(DEV_LOCAL && viewedProfile) await loadShelfData(viewedProfile.id);
  render();
  if(currentRoute === 'admin') renderAdmin();
}

async function loadProfile(){
  const { data, error } = await supabaseClient
    .from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  if(error){ showToast('Profil konnte nicht geladen werden'); return; }
  currentProfile = data;
  // Beide Tabellen zeigen nur die eigene Zeile. Fehlen sie noch (SQL 008 nicht ausgeführt), gilt: kein Admin, keine Sperre.
  const [{ data: adminRow }, { data: banRow }] = await Promise.all([
    supabaseClient.from('admins').select('user_id').eq('user_id', currentUser.id).maybeSingle(),
    supabaseClient.from('bans').select('reason, banned_at').eq('user_id', currentUser.id).maybeSingle(),
    loadPremium(),
  ]);
  isAdminMember = !!adminRow;
  ownBan = banRow || null;
}

// Premium-Stand des eigenen Kontos; nach einem Kauf oder Widerruf wird nur das neu geladen.
// Fehlt purchases noch (SQL 020 nicht ausgeführt), gibt es eben keinen Kauf.
async function loadPremium(){
  const [{ data: premium }, { data: member }, { data: purchase }] = await Promise.all([
    supabaseClient.rpc('can_use_premium'),
    supabaseClient.from('premium_members').select('source').eq('user_id', currentUser.id).maybeSingle(),
    supabaseClient.from('purchases').select('created_at').eq('user_id', currentUser.id).eq('status', 'paid')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  canUsePremium = premium === true;
  ownPremium = !!member;
  ownPurchase = purchase || null;
}

const LOGIN_HINT_DISMISSED_KEY = 'bookshelf-login-hint-dismissed';
function loginHintDismissed(){
  try { return localStorage.getItem(LOGIN_HINT_DISMISSED_KEY) === '1'; } catch(e){ return false; }
}

function renderAuthUI(){
  updateHomeCta();
  updateHomeBtn();
  const loginBtn = document.getElementById('googleLoginBtn');
  const userChip = document.getElementById('userChip');
  const myShelfBtn = document.getElementById('myShelfBtn');
  const loginHint = document.getElementById('loginHint');

  if(currentUser){
    // Sobald currentUser gesetzt ist, NIE wieder den Login-Button zeigen -
    // auch nicht kurzzeitig, während loadProfile() noch lädt.
    loginBtn.classList.add('hidden');
    loginHint.classList.add('hidden');

    if(!currentProfile){
      userChip.classList.add('hidden');
      return;
    }
    userChip.classList.remove('hidden');

    const handle = currentProfile.username ? '@' + currentProfile.username : '…';
    document.getElementById('userName').textContent = handle;
    document.getElementById('profileUsername').textContent = handle;
    document.getElementById('profileDisplayName').textContent = currentProfile.username ? shownName(currentProfile) : '';

    const avatar = document.getElementById('userAvatar');
    const avatarLarge = document.getElementById('profileAvatarLarge');
    if(currentProfile.avatar_url){
      avatar.src = currentProfile.avatar_url; avatar.style.display = '';
      avatarLarge.src = currentProfile.avatar_url; avatarLarge.style.display = '';
    } else {
      avatar.style.display = 'none';
      avatarLarge.style.display = 'none';
    }

    const memberSinceEl = document.getElementById('profileMemberSince');
    memberSinceEl.textContent = currentProfile.created_at
      ? 'Mitglied seit ' + new Date(currentProfile.created_at).toLocaleDateString('de-DE', {year:'numeric', month:'long'})
      : '';

    const showMyShelf = currentProfile.username && !(viewedProfile && viewedProfile.id === currentUser.id && currentRoute === 'shelf');
    myShelfBtn.classList.toggle('hidden', !showMyShelf);
    document.getElementById('adminBtn').classList.toggle('hidden', !isAdminMember);
  } else {
    loginBtn.classList.remove('hidden');
    loginHint.classList.toggle('hidden', loginHintDismissed() || DEV_LOCAL);
    userChip.classList.add('hidden');
    document.getElementById('profilePanel').classList.add('hidden');
  }
}

document.getElementById('loginHintClose').addEventListener('click', (e)=>{
  e.stopPropagation();
  document.getElementById('loginHint').classList.add('hidden');
  try { localStorage.setItem(LOGIN_HINT_DISMISSED_KEY, '1'); } catch(err){}
});

async function signInWithGoogle(){
  // Immer die Startseite (ohne /@name und Query-String), damit die Redirect-URL exakt zu einem Eintrag in
  // Supabase -> Authentication -> Redirect URLs passt, egal von welchem Regal aus man sich anmeldet.
  const stableRedirect = window.location.origin + '/';
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: stableRedirect }
  });
  if(error) showToast('Anmeldung fehlgeschlagen');
}

async function signOut(){
  await supabaseClient.auth.signOut();
}

document.getElementById('googleLoginBtn').addEventListener('click', signInWithGoogle);
document.getElementById('devResetBtn').addEventListener('click', resetSandbox);
document.getElementById('loginHintAction').addEventListener('click', signInWithGoogle);
document.getElementById('logoutBtn').addEventListener('click', signOut);
// ---- Mein-Regal-Knopf in der Kopfleiste ----
// Führt von überall (fremdes Regal, Übersicht, Startseite, offenes Buch) zurück ins eigene Regal.
// Lokal ohne Login gilt das Regal aus dem Testmodus als eigenes, wie beim Knopf auf der Startseite.
const homeBtn = document.getElementById('homeBtn');
function ownShelfName(){
  if(currentProfile && currentProfile.username) return currentProfile.username;
  return DEV_LOCAL && !currentUser ? devAs : null;
}
function onOwnShelf(){
  const name = ownShelfName();
  return currentRoute === 'shelf' && !!name && !!viewedProfile && viewedProfile.username === name;
}
function updateHomeBtn(){
  homeBtn.classList.toggle('hidden', !ownShelfName());
  if(onOwnShelf()) homeBtn.setAttribute('aria-current', 'page');
  else homeBtn.removeAttribute('aria-current');
}
homeBtn.addEventListener('click', ()=>{
  const name = ownShelfName();
  if(!name) return;
  closeToc();
  document.getElementById('profilePanel').classList.add('hidden');
  if(onOwnShelf()){
    if(selectedId != null) closeDetail();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  // Auch aus einem fremden Regal oben anfangen, nicht an dessen Scroll-Position.
  window.scrollTo(0, 0);
  goToUser(name);
});

document.getElementById('myShelfBtn').addEventListener('click', ()=>{
  document.getElementById('profilePanel').classList.add('hidden');
  if(currentProfile && currentProfile.username) goToUser(currentProfile.username);
});
document.getElementById('accountBtn').addEventListener('click', ()=>openAccount());
document.getElementById('adminBtn').addEventListener('click', ()=>document.getElementById('profilePanel').classList.add('hidden'));

document.getElementById('userChipTrigger').addEventListener('click', (e)=>{
  e.stopPropagation();
  setNotifMenu(false);
  document.getElementById('profilePanel').classList.toggle('hidden');
});
document.addEventListener('click', (e)=>{
  const chip = document.getElementById('userChip');
  if(!chip.contains(e.target)){
    document.getElementById('profilePanel').classList.add('hidden');
  }
});

// ---- Nutzername-Pflicht ----
const usernameModalOverlay = document.getElementById('usernameModalOverlay');

// optional=true: Umbenennen aus den Einstellungen (abbrechbar); sonst Pflicht-Auswahl nach dem ersten Login.
function openUsernameModal(optional){
  document.getElementById('f-username').value = optional && currentProfile ? (currentProfile.username || '') : '';
  document.getElementById('cancelUsernameBtn').classList.toggle('hidden', !optional);
  usernameModalOverlay.classList.remove('hidden');
}
document.getElementById('cancelUsernameBtn').addEventListener('click', ()=>usernameModalOverlay.classList.add('hidden'));

document.getElementById('saveUsernameBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('f-username');
  const val = input.value.trim().toLowerCase();
  if(!/^[a-z0-9_]{3,20}$/.test(val)){
    showToast('3–20 Zeichen: a–z, 0–9, _');
    return;
  }
  const { error } = await supabaseClient.from('profiles').update({ username: val }).eq('id', currentUser.id);
  if(error){
    showToast(dbErrorText(error, 'Fehler beim Speichern'));
    return;
  }
  currentProfile.username = val;
  setPref(AFTER_LOGIN_KEY, '');
  resetDirectory();
  usernameModalOverlay.classList.add('hidden');
  loadSocial();
  await goToUser(val);
  startTour();
});
document.getElementById('f-username').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('saveUsernameBtn').click(); }
});

// ---- Nutzer suchen ----
const userSearchInput = document.getElementById('userSearchInput');
const userSearchResults = document.getElementById('userSearchResults');
const userSearchBox = document.getElementById('userSearchBox');
let userSearchTimer = null;

const isMobileSearch = () => window.matchMedia('(max-width:640px)').matches;

userSearchBox.addEventListener('click', (e)=>{
  if(isMobileSearch() && !userSearchBox.classList.contains('expanded')){
    e.preventDefault();
    userSearchBox.classList.add('expanded');
    userSearchInput.focus();
  }
});

userSearchInput.addEventListener('input', (e)=>{
  clearTimeout(userSearchTimer);
  const q = e.target.value.trim();
  if(!q){ userSearchResults.classList.add('hidden'); return; }
  userSearchTimer = setTimeout(()=>runUserSearch(q), 250);
});

async function runUserSearch(q){
  // Sucht in Nutzer- und Anzeigenamen. Zeichen, die im PostgREST-Filter eine Bedeutung haben, fallen weg.
  const term = q.replace(/[,()*%\\:"]/g, ' ').trim();
  if(!term){ userSearchResults.classList.add('hidden'); return; }
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('username, display_name, avatar_url')
    .not('username', 'is', null)
    .eq('is_private', false)
    .or(`username.ilike.*${term}*,display_name.ilike.*${term}*`)
    .limit(8);

  if(error || !data || data.length === 0){
    userSearchResults.innerHTML = '<p class="user-search-empty">Keine Nutzer gefunden.</p>';
    userSearchResults.classList.remove('hidden');
    return;
  }
  userSearchResults.innerHTML = data.map(p=>`
    <button type="button" class="user-search-item" data-username="${escapeHtml(p.username)}">
      ${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}" alt="" referrerpolicy="no-referrer">` : '<span class="user-search-avatar-fallback"></span>'}
      <span class="user-search-names"><b>${escapeHtml(shownName(p))}</b><small>@${escapeHtml(p.username)}</small></span>
    </button>
  `).join('');
  userSearchResults.classList.remove('hidden');
  userSearchResults.querySelectorAll('.user-search-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      userSearchInput.value = '';
      userSearchResults.classList.add('hidden');
      userSearchBox.classList.remove('expanded');
      goToUser(btn.getAttribute('data-username'));
    });
  });
}

document.addEventListener('click', (e)=>{
  if(!userSearchBox.contains(e.target)){
    userSearchResults.classList.add('hidden');
    if(isMobileSearch() && !userSearchInput.value.trim()){
      userSearchBox.classList.remove('expanded');
    }
  }
});

// ---- Folgen und Mitteilungen ----
// Wem man folgt, liefert my_follows(). Mitteilungen legt die Datenbank selbst an, sobald ein gefolgtes Konto
// ein Buch im Regal hat und es zum ersten Mal bewertet (supabase/012_follows_notifications.sql).
const notifPicker = document.getElementById('notifPicker');
const notifBtn = document.getElementById('notifBtn');
const notifMenu = document.getElementById('notifMenu');
const notifBadge = document.getElementById('notifBadge');
let follows = [];          // [{id, username, display_name, avatar_url, notify}]
let notifications = [];    // Zeilen aus my_notifications(), neueste zuerst
let socialReady = false;   // false ohne Login oder solange die Tabellen in Supabase noch fehlen
let notifChannel = null;
let notifChannelUser = null;
let notifSeen = new Set(); // beim Öffnen ungelesen: bleiben hervorgehoben, bis das Menü wieder zu ist

async function loadSocial(){
  if(!(currentUser && currentProfile && currentProfile.username)){ resetSocial(); return; }
  const userId = currentUser.id;
  const [f, n] = await Promise.all([
    supabaseClient.rpc('my_follows'),
    supabaseClient.rpc('my_notifications', { p_limit: 40 }),
  ]);
  if(!currentUser || currentUser.id !== userId) return;
  // Ohne die Migration bleibt alles ausgeblendet, statt Fehler zu zeigen.
  socialReady = !f.error && !n.error;
  follows = f.data || [];
  notifications = n.data || [];
  if(socialReady) subscribeNotifications();
  renderSocialUI();
}

async function loadNotifications(){
  if(!socialReady) return;
  const { data, error } = await supabaseClient.rpc('my_notifications', { p_limit: 40 });
  if(error || !socialReady) return;
  notifications = data || [];
  renderSocialUI();
}

function resetSocial(){
  follows = [];
  notifications = [];
  socialReady = false;
  if(notifChannel) supabaseClient.removeChannel(notifChannel);
  notifChannel = null;
  notifChannelUser = null;
  setNotifMenu(false);
  renderSocialUI();
}

// Neue Mitteilungen live empfangen; die Zeile selbst holt loadNotifications() mit Buch und Absender.
function subscribeNotifications(){
  if(notifChannel && notifChannelUser === currentUser.id) return;
  if(notifChannel) supabaseClient.removeChannel(notifChannel);
  notifChannelUser = currentUser.id;
  notifChannel = supabaseClient.channel('notifications:' + currentUser.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, ()=>loadNotifications())
    .subscribe();
}
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) loadNotifications(); });

function renderSocialUI(){
  notifPicker.classList.toggle('hidden', !socialReady);
  const unread = socialReady ? notifications.filter(n=>!n.read_at).length : 0;
  notifBadge.textContent = unread > 9 ? '9+' : String(unread);
  notifBadge.classList.toggle('hidden', !unread);
  notifBtn.setAttribute('aria-label', unread ? `Mitteilungen, ${unread} neu` : 'Mitteilungen');
  if(!notifMenu.classList.contains('hidden')) renderNotifMenu();
  renderFollowButtons();
}

function followOf(profileId){
  return follows.find(f=>f.id === profileId) || null;
}

function renderFollowButtons(){
  const btn = document.getElementById('followBtn');
  const bell = document.getElementById('followNotifyBtn');
  const show = socialReady && !ownBan && !!viewedProfile && viewedProfile.id !== currentUser.id;
  const f = show ? followOf(viewedProfile.id) : null;
  btn.classList.toggle('hidden', !show);
  bell.classList.toggle('hidden', !f);
  if(!show) return;
  btn.textContent = f ? 'Gefolgt' : 'Folgen';
  btn.classList.toggle('btn-primary', !f);
  btn.classList.toggle('btn-secondary', !!f);
  btn.setAttribute('aria-pressed', !!f);
  btn.title = f ? 'Nicht mehr folgen' : `${shownName(viewedProfile)} folgen`;
  if(f){
    bell.innerHTML = f.notify ? ICON_BELL : ICON_BELL_OFF;
    bell.setAttribute('aria-pressed', f.notify);
    bell.setAttribute('aria-label', `Mitteilungen bei neuen Büchern: ${f.notify ? 'an' : 'aus'}`);
    bell.title = f.notify ? 'Mitteilungen an' : 'Mitteilungen aus';
  }
}

async function toggleFollow(){
  if(!socialReady || !viewedProfile) return;
  const target = viewedProfile;
  const btn = document.getElementById('followBtn');
  const f = followOf(target.id);
  btn.disabled = true;
  const { error } = f
    ? await supabaseClient.from('follows').delete().eq('follower_id', currentUser.id).eq('followee_id', target.id)
    : await supabaseClient.from('follows').insert({ follower_id: currentUser.id, followee_id: target.id });
  btn.disabled = false;
  if(error){ showToast(f ? 'Entfolgen hat nicht geklappt' : 'Folgen hat nicht geklappt'); return; }
  if(f){
    follows = follows.filter(x=>x !== f);
    showToast(`Du folgst ${shownName(target)} nicht mehr`);
  } else {
    const { id, username, display_name, avatar_url } = target;
    follows = [...follows, { id, username, display_name, avatar_url, notify: true }]
      .sort((a, b)=>shownName(a).localeCompare(shownName(b), 'de'));
    showToast(`Du folgst jetzt ${shownName(target)}`);
  }
  renderSocialUI();
}

async function setFollowNotify(profileId, notify){
  const f = followOf(profileId);
  if(!f) return;
  const { error } = await supabaseClient.from('follows').update({ notify }).eq('follower_id', currentUser.id).eq('followee_id', profileId);
  if(error){ showToast('Fehler beim Speichern'); return; }
  f.notify = notify;
  renderSocialUI();
  showToast(`Mitteilungen für ${shownName(f)} ${notify ? 'an' : 'aus'}`);
}

document.getElementById('followBtn').addEventListener('click', toggleFollow);
document.getElementById('followNotifyBtn').addEventListener('click', ()=>{
  const f = viewedProfile && followOf(viewedProfile.id);
  if(f) setFollowNotify(f.id, !f.notify);
});

const relTime = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
function timeAgo(iso){
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if(s > -60) return 'gerade eben';
  if(s > -3600) return relTime.format(Math.round(s / 60), 'minute');
  if(s > -86400) return relTime.format(Math.round(s / 3600), 'hour');
  if(s > -7 * 86400) return relTime.format(Math.round(s / 86400), 'day');
  return fmtDate(iso);
}

function miniAvatarHtml(p){
  return p.avatar_url
    ? `<img class="notif-avatar" src="${escapeHtml(p.avatar_url)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
    : `<span class="notif-avatar" aria-hidden="true">${escapeHtml(shownName(p).charAt(0).toUpperCase())}</span>`;
}

function notifItemHtml(n){
  const entry = coverCache[coverKey(n)];
  const cover = entry && entry.src ? entry.src : null;
  const isNew = !n.read_at || notifSeen.has(n.id);
  return `<li><button type="button" class="notif-item ${isNew ? 'is-new' : ''}" data-notif="${escapeHtml(n.id)}">
    ${miniAvatarHtml(n)}
    <span class="notif-text">
      <span><b>${escapeHtml(shownName(n))}</b> hat <b>${escapeHtml(n.title)}</b> ins Regal gestellt und bewertet</span>
      <span class="notif-stars" aria-label="${n.rating} von 5 Sternen">${[1,2,3,4,5].map(i=>starsSVG(i <= n.rating)).join('')}</span>
      <small>${escapeHtml(timeAgo(n.created_at))}</small>
    </span>
    ${cover ? `<img class="notif-cover" src="${escapeHtml(cover)}" alt="" loading="lazy">` : ''}
  </button></li>`;
}

function followRowHtml(f){
  const name = escapeHtml(shownName(f));
  return `<li class="follow-row">
    <button type="button" class="follow-go" data-follow-user="${escapeHtml(f.username)}">
      ${miniAvatarHtml(f)}
      <span class="follow-names"><b>${name}</b><small>@${escapeHtml(f.username)}</small></span>
    </button>
    <button type="button" class="icon-btn sm follow-bell" data-follow-bell="${escapeHtml(f.id)}" aria-pressed="${f.notify}" aria-label="Mitteilungen für ${name}: ${f.notify ? 'an' : 'aus'}" title="${f.notify ? 'Mitteilungen an' : 'Mitteilungen aus'}">${f.notify ? ICON_BELL : ICON_BELL_OFF}</button>
  </li>`;
}

function renderNotifMenu(){
  const list = notifications.length
    ? `<ol class="notif-list">${notifications.map(notifItemHtml).join('')}</ol>`
    : '<p class="notif-empty">Noch nichts Neues. Stellt jemand, dem du folgst, ein Buch ins Regal und bewertet es, steht es hier.</p>';
  const people = follows.length
    ? `<ul class="follow-list">${follows.map(followRowHtml).join('')}</ul>`
    : '<p class="notif-empty">Du folgst noch niemandem. Öffne ein Regal und tippe auf „Folgen“.</p>';
  notifMenu.innerHTML = `
    <section class="notif-section"><h3 class="notif-head">Mitteilungen</h3>${list}</section>
    <section class="notif-section"><h3 class="notif-head">Ich folge${follows.length ? ` <span>${follows.length}</span>` : ''}</h3>${people}</section>`;
}

// Beim Öffnen frisch laden und alles als gelesen markieren; neu Hinzugekommenes bleibt bis zum Schließen hervorgehoben.
async function markNotificationsRead(){
  await loadNotifications();
  const unread = notifications.filter(n=>!n.read_at);
  if(!unread.length || notifMenu.classList.contains('hidden')) return;
  unread.forEach(n=>notifSeen.add(n.id));
  const now = new Date().toISOString();
  const { error } = await supabaseClient.from('notifications').update({ read_at: now })
    .eq('user_id', currentUser.id).is('read_at', null);
  if(error) return;
  unread.forEach(n=>{ n.read_at = now; });
  renderSocialUI();
}

function setNotifMenu(open){
  if(open === !notifMenu.classList.contains('hidden')) return;
  notifMenu.classList.toggle('hidden', !open);
  notifBtn.setAttribute('aria-expanded', open);
  if(open){
    notifSeen = new Set(notifications.filter(n=>!n.read_at).map(n=>n.id));
    renderNotifMenu();
    markNotificationsRead();
  } else {
    notifSeen = new Set();
  }
}

async function openNotification(n){
  setNotifMenu(false);
  await goToUser(n.username);
  if(!bookIndex.has(String(n.book_id))){ showToast('Das Buch steht nicht mehr im Regal'); return; }
  selectedId = n.book_id;
  displayedId = n.book_id;
  editingBookId = null;
  render();
  const el = document.querySelector(`#shelves [data-book="${CSS.escape(String(n.book_id))}"]`);
  if(el) revealAfterTurn(el);
}

notifBtn.addEventListener('click', ()=>{
  document.getElementById('profilePanel').classList.add('hidden');
  setNotifMenu(notifMenu.classList.contains('hidden'));
});
notifMenu.addEventListener('click', e=>{
  const bell = e.target.closest('[data-follow-bell]');
  if(bell){
    const f = followOf(bell.getAttribute('data-follow-bell'));
    if(f) setFollowNotify(f.id, !f.notify);
    return;
  }
  const person = e.target.closest('[data-follow-user]');
  if(person){
    setNotifMenu(false);
    goToUser(person.getAttribute('data-follow-user'));
    return;
  }
  const item = e.target.closest('[data-notif]');
  const n = item && notifications.find(x=>String(x.id) === item.getAttribute('data-notif'));
  if(n) openNotification(n);
});
notifMenu.addEventListener('keydown', e=>{ if(e.key === 'Escape'){ e.stopPropagation(); setNotifMenu(false); notifBtn.focus(); } });
document.addEventListener('click', e=>{
  if(e.target instanceof Element && e.target.isConnected && !notifPicker.contains(e.target)) setNotifMenu(false);
});

// ---- Regal-Routing (welches Profil wird angezeigt) ----
// Regal-Adresse /@name (alte Links ?u=name leitet der Worker um; lokal ohne Worker gehen beide).
const SHELF_PATH = /^\/@([a-z0-9_]{3,20})\/?$/i;
function shelfPath(username){
  return '/@' + encodeURIComponent(String(username).toLowerCase());
}
function usernameFromPath(){
  const m = window.location.pathname.match(SHELF_PATH);
  return m ? m[1] : new URLSearchParams(window.location.search).get('u');
}
function usernameFromURL(){
  return (usernameFromPath() || getPref(LAST_USER_KEY, DEFAULT_USERNAME)).toLowerCase();
}

// Drei Ansichten: Startseite (/), Übersicht aller Regale (/?view=regale), ein Regal (/@name).
// Die installierte App startet weiter direkt im zuletzt angesehenen Regal.
function routeFromURL(){
  const params = new URLSearchParams(window.location.search);
  if(usernameFromPath()) return 'shelf';
  if(params.get('view') === 'regale') return 'browse';
  if(params.get('view') === 'admin') return 'admin';
  if(params.get('source') === 'app' && getPref(LAST_USER_KEY, '')) return 'shelf';
  return 'home';
}

let currentRoute = null;
function showRoute(route){
  currentRoute = route;
  document.body.setAttribute('data-route', route);
  document.getElementById('homeView').classList.toggle('hidden', route !== 'home');
  document.getElementById('browseView').classList.toggle('hidden', route !== 'browse');
  document.getElementById('adminView').classList.toggle('hidden', route !== 'admin');
  document.getElementById('shelfView').classList.toggle('hidden', route !== 'shelf');
  updateHomeBtn();
  if(route !== 'shelf'){
    selectedId = null;
    closeToc();
    updateBookDetailPanel();
    document.title = { browse: 'Bücherregale', admin: 'Verwaltung' }[route] || 'Bücherregal';
  }
  if(route === 'home') renderHome();
  if(route === 'browse') renderBrowse();
  if(route === 'admin') renderAdmin();
  syncDemoLoop();
}

async function applyRoute(){
  const route = routeFromURL();
  showRoute(route);
  if(route === 'shelf') await loadViewedUserFromURL();
}

function navigate(search){
  history.pushState({}, '', '/' + search);
  window.scrollTo(0, 0);
  applyRoute();
}

document.addEventListener('click', e=>{
  const link = e.target.closest('a[data-route]');
  if(!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate({ browse: '?view=regale', admin: '?view=admin' }[link.getAttribute('data-route')] || '');
});
document.querySelector('.brand').addEventListener('click', e=>{
  if(e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate('');
});

async function loadViewedUserByUsername(username){
  selectedId = null;
  displayedId = null;
  activeCategory = null;
  searchQuery = '';
  closeToc();
  const searchInputEl = document.getElementById('searchInput');
  if(searchInputEl) searchInputEl.value = '';
  document.getElementById('clearSearchBtn').classList.remove('show');

  shelfLoading = true;
  // Über die Datenbankfunktion statt der Tabelle: so öffnet der Link auch private Regale.
  const { data, error } = await supabaseClient
    .rpc('profile_by_username', { p_username: username.toLowerCase() }).maybeSingle();

  shelfLoadError = !!error;
  if(error || !data){
    viewedProfile = null;
    shelves = []; books = []; categories = [];
    shelfLoading = false;
    render();
    return;
  }
  viewedProfile = data;
  setPref(LAST_USER_KEY, data.username);
  await loadShelfData(viewedProfile.id);
  shelfLoading = false;
  render();
}

async function loadViewedUserFromURL(){
  await loadViewedUserByUsername(usernameFromURL());
}

async function goToUser(username){
  history.pushState({}, '', shelfPath(username));
  if(currentRoute !== 'shelf') window.scrollTo(0, 0);
  showRoute('shelf');
  await loadViewedUserByUsername(username);
}

window.addEventListener('popstate', applyRoute);

// ---- Startseite und Regal-Übersicht ----
const AFTER_LOGIN_KEY = 'bookshelf-after-login';
const browseIndex = new Map(); // id -> {book, group}, für Bücher außerhalb des geöffneten Regals
const BROWSE_PAGE = 20;
let directory = null;          // Übersicht: {q, entries: [{profile, bookCount, seriesCount, series, picks}], total}
let directoryLoading = null;
let heroEntry = null;          // Schaufenster der Startseite: Antonios Regal, {profile, groups, bookCount, showcase}
let heroLoading = null;

// Nach eigenen Änderungen (Name, Sichtbarkeit, Bücher) Übersicht und Schaufenster neu laden.
function resetDirectory(){
  directory = null;
  heroEntry = null;
}

// Nur Regale, die ausdrücklich in der Übersicht stehen wollen. Alle anderen öffentlichen
// findet man über „Leute finden“, private nur per Link. Seitenweise über directory_page()
// (supabase/022_directory_page.sql): pro Regal nur Zahlen, Reihentitel und sechs Cover.
async function loadDirectoryPage(q, more = false){
  if(directory && directory.q === q && !more) return directory;
  if(directoryLoading) return directoryLoading;
  const offset = more && directory && directory.q === q ? directory.entries.length : 0;
  directoryLoading = (async ()=>{
    const { data, error } = await supabaseClient.rpc('directory_page', { p_query: q, p_limit: BROWSE_PAGE, p_offset: offset });
    directoryLoading = null;
    if(error) return null;
    const entries = (data || []).map(directoryRowEntry);
    const total = data && data.length ? Number(data[0].total) : offset;
    directory = { q, entries: offset ? directory.entries.concat(entries) : entries, total };
    return directory;
  })();
  return directoryLoading;
}

function directoryRowEntry(row){
  const groups = new Map();
  const picks = (row.picks || []).map(b=>{
    if(!groups.has(b.shelf_id)) groups.set(b.shelf_id, { key: b.shelf_id, label: b.label, items: [] });
    const g = groups.get(b.shelf_id);
    g.items.push(b);
    browseIndex.set(String(b.id), { book: b, group: g });
    return { b, g };
  });
  return {
    profile: { id: row.id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url, created_at: row.created_at },
    bookCount: row.book_count,
    seriesCount: row.series_count,
    series: row.series || [],
    picks,
  };
}

// Ein ganzes Regal so aufbereitet, wie Startseite und Karten es brauchen.
function directoryEntry(profile, shelfRows, bookRows, showcaseRows){
  const openShelves = new Set((shelfRows || []).map(s=>s.id));
  const own = (bookRows || []).filter(b=>openShelves.has(b.shelf_id));
  const groups = (shelfRows || [])
    .map(s=>({
      key: s.id,
      label: s.label,
      items: own.filter(b=>b.shelf_id === s.id).sort((a, b)=>(a.series_order || 0) - (b.series_order || 0)),
    }))
    .filter(g=>g.items.length)
    .sort((a, b)=>a.label.localeCompare(b.label, 'de'));
  groups.forEach(g=>g.items.forEach(b=>browseIndex.set(String(b.id), { book: b, group: g })));
  // Vitrine (nur Premium): ihre Bücher stehen auf Startseite und Karten vorne.
  const sc = (showcaseRows || [])[0];
  const scGroup = sc && sc.shelf_id && groups.find(g=>g.key === sc.shelf_id);
  const showcaseItems = scGroup
    ? scGroup.items.filter(b=>sc.book_ids.includes(b.id)).map(b=>({ b, g: scGroup }))
    : ((sc && sc.book_ids) || []).map(id=>{
        const g = groups.find(x=>x.items.some(b=>b.id === id));
        return g ? { b: g.items.find(b=>b.id === id), g } : null;
      }).filter(Boolean);
  return { profile, groups, bookCount: own.length, showcase: showcaseItems };
}

// Schaufenster der Startseite: nur ein Regal laden, nicht alle.
async function loadHeroEntry(){
  if(heroEntry) return heroEntry;
  if(heroLoading) return heroLoading;
  heroLoading = (async ()=>{
    const { data: profile } = await supabaseClient.rpc('profile_by_username', { p_username: DEFAULT_USERNAME }).maybeSingle();
    if(!profile){ heroLoading = null; return null; }
    const [{ data: shelfRows, error: sErr }, { data: bookRows, error: bErr }, { data: showcaseRows }] = await Promise.all([
      supabaseClient.from('shelves').select('id, user_id, label').eq('user_id', profile.id).eq('is_private', false),
      supabaseClient.from('books').select('id, user_id, shelf_id, title, author, series_order, page_count, cover_url, date_read, rating').eq('user_id', profile.id).eq('is_private', false).neq('status', 'want'),
      supabaseClient.rpc('showcases_of', { p_users: [profile.id] }),
    ]);
    heroLoading = null;
    if(sErr || bErr) return null;
    heroEntry = directoryEntry(profile, shelfRows, bookRows, showcaseRows);
    return heroEntry;
  })();
  return heroLoading;
}

// Nicht anklickbare Kopie eines Regalbuchs für Startseite und Karten; dreht sich wie im echten Regal.
function staticBookHtml(b, group, out){
  const v = bookVisual(b, group.label);
  const multi = group.items.length > 1;
  return `<span class="book ${v.ink} ${v.has?'has-cover':''} ${v.loading?'is-loading':''} ${v.emblem?'has-emblem':''} ${out?'open':''}" data-book="${escapeHtml(b.id)}" data-series="${escapeHtml(group.key)}" style="${escapeHtml(visualStyle(v))}">
    <span class="book-3d">
      <span class="face spine"><span class="spine-emblem"></span><span class="spine-title">${escapeHtml(b.title)}</span><span class="spine-no">${multi ? b.series_order : ''}</span></span>
      <span class="face front">${genCoverHtml(b, group)}</span>
    </span>
  </span>`;
}

// „Antonios Regal“, aber „Orientdreams’ Regal“.
function possessive(name){
  return /[sßxz]$/i.test(name) ? name + '’' : name + 's';
}

// Sichtbarer Name: der selbst gewählte Anzeigename, sonst der Nutzername mit großem Anfangsbuchstaben.
function shownName(p){
  const display = p && p.display_name && p.display_name.trim();
  if(display) return display;
  const u = (p && p.username) || '';
  return u.charAt(0).toUpperCase() + u.slice(1);
}

function avatarHtml(p){
  return p.avatar_url
    ? `<img class="reader-avatar" src="${escapeHtml(p.avatar_url)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
    : `<span class="reader-avatar reader-avatar-fallback" aria-hidden="true">${escapeHtml(p.username.charAt(0).toUpperCase())}</span>`;
}

function thumbHtml(b, group){
  const v = bookVisual(b, group.label);
  return `<span class="thumb ${v.has ? 'has-cover' : ''} ${v.loading ? 'is-loading' : ''}" data-book="${escapeHtml(b.id)}" style="${escapeHtml(visualStyle(v))}"></span>`;
}

// Für die Cover-Reihe: erst die Vitrine, dann der erste Band jeder Reihe, dann die Folgebände.
function coverPicks(entry, n){
  const firsts = entry.groups.map(g=>({ b: g.items[0], g }));
  const rest = entry.groups.flatMap(g=>g.items.slice(1).map(b=>({ b, g })));
  const seen = new Set();
  return (entry.showcase || []).concat(firsts, rest)
    .filter(({ b })=>!seen.has(b.id) && seen.add(b.id))
    .slice(0, n);
}

// Schaufenster der Startseite: Reihen mit Vitrinen-Büchern zuerst, jeweils mit diesem Buch vorne.
function heroGroups(entry){
  const lead = [];
  (entry.showcase || []).forEach(({ b, g })=>{
    if(!lead.some(x=>x.key === g.key)) lead.push({ ...g, items: [b, ...g.items.filter(x=>x !== b)] });
  });
  return lead.concat(entry.groups.filter(g=>!lead.some(x=>x.key === g.key)));
}

function readerRowHtml(entry){
  const p = entry.profile;
  const series = entry.seriesCount;
  const meta = entry.bookCount
    ? `${entry.bookCount} ${entry.bookCount === 1 ? 'Buch' : 'Bücher'} · ${series} ${series === 1 ? 'Reihe' : 'Reihen'}`
    : 'Noch keine Bücher';
  const names = entry.series;
  const seriesLine = names.length
    ? `<span class="reader-series">${escapeHtml(names.join(' · '))}${series > names.length ? ` <em>+${series - names.length}</em>` : ''}</span>`
    : '';
  // Auch leer vorhanden, damit der Pfeil in jeder Zeile an derselben Stelle steht.
  const covers = `<span class="reader-covers" aria-hidden="true">${entry.picks.map(({ b, g })=>thumbHtml(b, g)).join('')}</span>`;
  return `<a class="reader-row ${entry.bookCount ? '' : 'is-empty'}" href="${shelfPath(p.username)}" data-user="${escapeHtml(p.username)}">
    ${avatarHtml(p)}
    <span class="reader-text"><b>${escapeHtml(possessive(shownName(p)))} Regal</b><small>@${escapeHtml(p.username)} · ${meta}</small>${seriesLine}</span>
    ${covers}
    <span class="reader-go" aria-hidden="true">→</span>
  </a>`;
}

function readerSkeleton(n){
  return Array.from({ length: n }, ()=>`<div class="reader-row is-skeleton"><span class="reader-avatar"></span><span class="reader-text"><b></b><small></small></span><span class="reader-covers">${'<span class="thumb"></span>'.repeat(5)}</span></div>`).join('');
}

function updateHomeCta(){
  const btn = document.getElementById('homeCreateBtn');
  const note = document.getElementById('homeCreateNote');
  const mine = currentProfile && currentProfile.username;
  btn.textContent = mine ? 'Zu meinem Regal' : 'Eigenes Regal erstellen';
  note.textContent = mine ? `Angemeldet als @${currentProfile.username}` : 'Kostenlos, Anmeldung mit Google';
}

document.getElementById('homeCreateBtn').addEventListener('click', ()=>{
  if(currentProfile && currentProfile.username){ goToUser(currentProfile.username); return; }
  if(currentUser){ openUsernameModal(); return; }
  // Lokal gibt es keinen Google-Login: der Testmodus macht Antonios Regal zum eigenen.
  if(DEV_LOCAL){ goToUser(devAs); return; }
  setPref(AFTER_LOGIN_KEY, '1');
  signInWithGoogle();
});

async function renderHome(){
  updateHomeCta();
  const entry = await loadHeroEntry();
  if(currentRoute !== 'home' || !entry) return;
  renderHero(entry.bookCount ? entry : null);
}

const narrowQuery = window.matchMedia('(max-width: 640px)');
narrowQuery.addEventListener('change', ()=>{ if(currentRoute === 'home' && heroEntry) renderHome(); });

// Schaufenster statt vollem Regal: je Reihe ein Cover, alle gleich groß. Die weiteren Bände
// liegen unsichtbar dahinter und werden nacheinander eingeblendet.
function displayShelfHtml(groups, count){
  return groups.slice(0, count).map(g=>`<span class="display-slot">${g.items.slice(0, 4).map((b, i)=>{
    const v = bookVisual(b, g.label);
    return `<span class="display-cover ${v.has ? 'has-cover' : ''} ${i === 0 ? 'is-front' : ''}" data-book="${escapeHtml(b.id)}" style="${escapeHtml(visualStyle(v))}">${genCoverHtml(b, g)}</span>`;
  }).join('')}</span>`).join('');
}

function renderHero(entry){
  const shelf = document.getElementById('heroShelf');
  const caption = document.getElementById('heroCaption');
  if(!entry){ shelf.innerHTML = ''; caption.innerHTML = ''; return; }
  const count = narrowQuery.matches ? 3 : 5;
  const groups = heroGroups(entry).slice(0, count);
  shelf.innerHTML = `<div class="ledge-wrap"><div class="display-row">${displayShelfHtml(groups, count)}</div></div>`;
  const u = entry.profile.username;
  caption.innerHTML = `Aus dem Regal von <a href="${shelfPath(u)}">${escapeHtml(shownName(entry.profile))}</a>`;
  caption.querySelector('a').addEventListener('click', e=>{ e.preventDefault(); goToUser(u); });

  // Schritt 1 und 2 zeigen echte Bücher aus diesem Regal.
  const all = entry.groups.flatMap(g=>g.items.map(b=>({ b, g })));
  const pick = all.find(x=>/red rising/i.test(x.g.label)) || all[0];
  const sameSeries = all.filter(x=>x.g === pick.g).slice(0, 2);
  document.getElementById('demoTyped').textContent = pick.g.label.slice(0, Math.max(3, pick.g.label.length - 3));
  document.getElementById('demoSuggest').innerHTML = sameSeries.map(({ b, g })=>
    `<div class="demo-row">${thumbHtml(b, g)}<span><b>${escapeHtml(b.title)}</b><small>${escapeHtml(b.author || '')}${g.items.length > 1 ? ' · Band ' + b.series_order : ''}</small></span></div>`
  ).join('');
  const turnGroup = entry.groups.find(g=>g.items.length >= 3) || entry.groups[0];
  document.getElementById('demoTurn').innerHTML = turnGroup.items.slice(0, 4).map((b, i)=>staticBookHtml(b, turnGroup, i === 0)).join('');

  // Supporter-Extras: ein „fotografiertes“ Regal aus verschiedenen Reihen und drei Lieblinge in der Vitrine.
  const scanned = coverPicks(entry, 4);
  document.getElementById('demoScan').innerHTML = scanned.map(({ b, g })=>staticBookHtml(b, g, false)).join('');
  document.getElementById('demoFound').innerHTML = scanned.map(({ b, g })=>
    `<li>${thumbHtml(b, g)}<span class="scan-hit-text"><b>${escapeHtml(b.title)}</b><small>${escapeHtml(b.author || '')}</small></span><i class="scan-tick"></i></li>`
  ).join('');
  const favs = (entry.showcase || []).concat(entry.groups.map(g=>({ b: g.items.reduce((a, x)=>(x.rating || 0) > (a.rating || 0) ? x : a), g }))
    .sort((x, y)=>(y.b.rating || 0) - (x.b.rating || 0)))
    .filter(({ b }, i, arr)=>arr.findIndex(x=>x.b.id === b.id) === i)
    .slice(0, 3);
  document.getElementById('demoVitrine').innerHTML = favs.map(({ b, g })=>{
    const v = bookVisual(b, g.label);
    return `<span class="demo-vitrine-item"><i style="${escapeHtml(visualStyle(v))}" data-book="${escapeHtml(b.id)}" class="demo-vitrine-glow"></i>${thumbHtml(b, g)}</span>`;
  }).join('');
  queueCovers(groups.flatMap(g=>g.items.slice(0, 4)).concat(sameSeries.map(x=>x.b), turnGroup.items.slice(0, 4), scanned.map(x=>x.b), favs.map(x=>x.b)));
  scheduleFit();
}

async function renderBrowse(more = false){
  const rows = document.getElementById('browseCards');
  const q = document.getElementById('browseSearch').value.trim();
  if(!directory || directory.q !== q) rows.innerHTML = readerSkeleton(4);
  const list = await loadDirectoryPage(q, more);
  if(currentRoute !== 'browse' || q !== document.getElementById('browseSearch').value.trim()) return;
  if(!list){
    rows.innerHTML = '<p class="cards-error">Die Regale konnten gerade nicht geladen werden. <button type="button" class="link-btn" id="browseRetry">Neu laden</button></p>';
    document.getElementById('browseRetry').addEventListener('click', ()=>renderBrowse());
    return;
  }
  if(!q) document.getElementById('browseCount').textContent = `${list.total} ${list.total === 1 ? 'Regal' : 'Regale'}`;
  const moreBtn = list.entries.length < list.total
    ? `<button type="button" class="btn btn-secondary browse-more" id="browseMore">Weitere Regale laden</button>`
    : '';
  rows.innerHTML = list.entries.length
    ? list.entries.map(readerRowHtml).join('') + moreBtn
    : `<p class="cards-error">Kein Regal mit „${escapeHtml(q)}“ in der Übersicht. Über „Leute finden“ oben suchst du in allen öffentlichen Regalen.</p>`;
  rows.querySelectorAll('.reader-row[data-user]').forEach(row=>{
    row.addEventListener('click', e=>{
      if(e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      goToUser(row.getAttribute('data-user'));
    });
  });
  const btn = document.getElementById('browseMore');
  if(btn) btn.addEventListener('click', ()=>{ btn.disabled = true; renderBrowse(true); });
  queueCovers(list.entries.flatMap(e=>e.picks.map(x=>x.b)));
}
let browseSearchTimer = 0;
document.getElementById('browseSearch').addEventListener('input', ()=>{
  clearTimeout(browseSearchTimer);
  browseSearchTimer = setTimeout(()=>renderBrowse(), 250);
});

// Startseite: im Schaufenster blendet ab und zu ein Cover zum nächsten Band über,
// in Schritt 2 dreht sich ein anderer Band nach vorne.
let demoTimer = 0;
let demoLastSlot = null;
function syncDemoLoop(){
  clearInterval(demoTimer);
  if(currentRoute !== 'home' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  demoTimer = setInterval(()=>{
    if(document.hidden) return;
    const slots = [...document.querySelectorAll('#heroShelf .display-slot')].filter(s=>s.children.length > 1 && s !== demoLastSlot);
    if(slots.length){
      const slot = slots[Math.floor(Math.random() * slots.length)];
      const covers = [...slot.children];
      const cur = covers.findIndex(el=>el.classList.contains('is-front'));
      covers[cur].classList.remove('is-front');
      covers[(cur + 1) % covers.length].classList.add('is-front');
      demoLastSlot = slot;
    }
    const books = [...document.querySelectorAll('#demoTurn .book')];
    if(books.length > 1){
      const cur = books.findIndex(el=>el.classList.contains('open'));
      books.forEach(el=>el.classList.remove('open'));
      books[(cur + 1) % books.length].classList.add('open');
    }
  }, 3200);
}

// ---- Fehlermeldungen der Datenbank ----
const DB_ERRORS = {
  username_cooldown: 'Du kannst deinen Nutzernamen nur alle 30 Tage ändern.',
  username_reserved: 'Dieser Name ist gerade noch für jemand anderen reserviert.',
  confirm_mismatch: 'Der Nutzername stimmt nicht überein.',
  admin_cannot_delete_self: 'Admin-Konten können sich nicht selbst löschen. Entferne zuerst den Admin-Eintrag in Supabase.',
  admin_required: 'Keine Berechtigung. Bitte bestätige dich erneut mit dem Zwei-Faktor-Code.',
  not_on_self: 'Das geht nicht mit deinem eigenen Konto.',
  target_is_admin: 'Andere Admins lassen sich hier nicht sperren oder löschen.',
};
function dbErrorText(error, fallback){
  if(!error) return fallback;
  if(error.code === '23505') return 'Nutzername bereits vergeben';
  if(error.code === '23514'){
    return String(error.message || '').includes('display_name') ? 'Anzeigename: 1–32 Zeichen' : '3–20 Zeichen: a–z, 0–9, _';
  }
  if(error.code === 'PGRST202') return 'Diese Funktion ist in der Datenbank noch nicht eingerichtet.';
  const key = Object.keys(DB_ERRORS).find(k=>String(error.message || '').includes(k));
  return key ? DB_ERRORS[key] : fallback;
}

const fmtDate = d=>new Date(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtMonth = d=>new Date(d).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

// ---- Rückfrage-Dialog ----
// Mit `match` muss ein Text exakt eingetippt werden (wie bei GitHub), mit `input` liefert er die Eingabe.
function ask({ title, text = '', confirmLabel = 'OK', danger = false, input = null, match = null }){
  return new Promise(resolve=>{
    const overlay = document.getElementById('askOverlay');
    const form = document.getElementById('askForm');
    const inp = document.getElementById('askInput');
    const confirm = document.getElementById('askConfirm');
    const cancel = document.getElementById('askCancel');
    const needsInput = !!(input || match);
    document.getElementById('askTitle').textContent = title;
    document.getElementById('askText').textContent = text;
    document.getElementById('askField').classList.toggle('hidden', !needsInput);
    document.getElementById('askLabel').textContent = match ? `Zur Bestätigung „${match}“ eintippen` : (input && input.label) || '';
    document.getElementById('askHint').textContent = (input && input.hint) || '';
    inp.value = (input && input.value) || '';
    inp.placeholder = (input && input.placeholder) || '';
    confirm.textContent = confirmLabel;
    confirm.className = 'btn ' + (danger ? 'btn-danger-solid' : 'btn-primary');
    const sync = ()=>{ confirm.disabled = !!match && inp.value.trim().toLowerCase() !== match.toLowerCase(); };
    const done = value=>{
      overlay.classList.add('hidden');
      form.removeEventListener('submit', onSubmit);
      cancel.removeEventListener('click', onCancel);
      inp.removeEventListener('input', sync);
      overlay.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onSubmit = e=>{ e.preventDefault(); if(!confirm.disabled) done(input ? inp.value.trim() : true); };
    const onCancel = ()=>done(null);
    const onKey = e=>{ if(e.key === 'Escape') done(null); };
    form.addEventListener('submit', onSubmit);
    cancel.addEventListener('click', onCancel);
    inp.addEventListener('input', sync);
    overlay.addEventListener('keydown', onKey);
    sync();
    overlay.classList.remove('hidden');
    (needsInput ? inp : confirm).focus();
  });
}

// ---- Profil und Konto ----
const accountOverlay = document.getElementById('accountOverlay');
const RENAME_COOLDOWN_DAYS = 30;

function renameAvailableAt(){
  if(!currentProfile || !currentProfile.username || !currentProfile.username_changed_at) return null;
  const at = new Date(currentProfile.username_changed_at).getTime() + RENAME_COOLDOWN_DAYS * 864e5;
  return at > Date.now() ? new Date(at) : null;
}

function syncRenameRow(){
  const at = renameAvailableAt();
  document.getElementById('accUsername').textContent = currentProfile.username ? '@' + currentProfile.username : 'Noch kein Nutzername';
  document.getElementById('accUsernameHint').textContent = ownBan
    ? 'Gesperrte Konten können den Namen nicht ändern.'
    : at ? `Nächste Änderung ab ${fmtDate(at)} möglich.` : 'Alle 30 Tage änderbar.';
  document.getElementById('accRenameBtn').disabled = !!at || !!ownBan;
}

function syncDisplayRow(){
  const own = currentProfile.display_name && currentProfile.display_name.trim();
  document.getElementById('accDisplay').textContent = own || `Nicht gesetzt (es erscheint „${shownName(currentProfile)}“)`;
  document.getElementById('accName').textContent = currentProfile.username ? shownName(currentProfile) : 'Dein Konto';
  document.getElementById('accDisplayBtn').disabled = !!ownBan;
}

function syncPrivacyRows(){
  const priv = !!currentProfile.is_private;
  document.querySelectorAll('[data-privacy]').forEach(b=>{
    b.setAttribute('aria-pressed', b.getAttribute('data-privacy') === (priv ? 'private' : 'public'));
    b.disabled = !!ownBan;
  });
  document.querySelectorAll('[data-listed]').forEach(b=>{
    b.setAttribute('aria-pressed', b.getAttribute('data-listed') === String(!!currentProfile.listed));
    b.disabled = !!ownBan;
  });
  document.getElementById('accPrivacyHint').textContent = priv
    ? 'Nicht in der Übersicht und nicht über „Leute finden“. Wer deinen Link hat, sieht dein Regal trotzdem.'
    : 'Andere finden dich über „Leute finden“.';
  document.getElementById('accListedRow').classList.toggle('hidden', priv);
}

async function saveVisibility(patch, success){
  const { data, error } = await supabaseClient.from('profiles').update(patch).eq('id', currentUser.id).select().single();
  if(error){ showToast(dbErrorText(error, 'Fehler beim Speichern')); syncPrivacyRows(); return; }
  currentProfile = data;
  resetDirectory();
  if(viewedProfile && viewedProfile.id === currentUser.id) Object.assign(viewedProfile, { is_private: data.is_private, listed: data.listed });
  syncPrivacyRows();
  render();
  showToast(success);
}

document.querySelectorAll('[data-privacy]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const priv = btn.getAttribute('data-privacy') === 'private';
    if(priv === !!currentProfile.is_private) return;
    // Wer privat wird, verlässt auch die Übersicht; zurück dorthin nur mit neuer Zustimmung.
    saveVisibility(priv ? { is_private: true, listed: false } : { is_private: false },
      priv ? 'Profil ist jetzt privat' : 'Profil ist jetzt öffentlich');
  });
});
document.querySelectorAll('[data-listed]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const listed = btn.getAttribute('data-listed') === 'true';
    if(listed === !!currentProfile.listed) return;
    saveVisibility({ listed }, listed ? 'Dein Regal steht jetzt in der Übersicht' : 'Dein Regal steht nicht mehr in der Übersicht');
  });
});

function closeAccountForms(){
  document.getElementById('accDisplayForm').classList.add('hidden');
  document.getElementById('accDisplayRow').classList.remove('hidden');
  document.getElementById('accRenameForm').classList.add('hidden');
  document.getElementById('accRenameRow').classList.remove('hidden');
  document.getElementById('accDeleteForm').classList.add('hidden');
  document.getElementById('accDeleteBtn').classList.remove('hidden');
}

async function openAccount(){
  if(!currentProfile) return;
  document.getElementById('profilePanel').classList.add('hidden');
  const p = currentProfile;
  const avatar = document.getElementById('accAvatar');
  avatar.classList.toggle('hidden', !p.avatar_url);
  if(p.avatar_url) avatar.src = p.avatar_url;
  document.getElementById('accHandle').textContent = p.username ? '@' + p.username : '';
  document.getElementById('accSince').textContent = p.created_at ? fmtMonth(p.created_at) : '–';
  document.getElementById('accBooks').textContent = '–';
  document.getElementById('accSeries').textContent = '–';
  const banned = document.getElementById('accBanned');
  banned.classList.toggle('hidden', !ownBan);
  if(ownBan){
    banned.textContent = `Dein Konto ist seit ${fmtDate(ownBan.banned_at)} gesperrt${ownBan.reason ? ': ' + ownBan.reason : '.'} Dein Regal ist nicht mehr öffentlich, und du kannst nichts ändern.`;
  }
  document.getElementById('accDeleteLabel').textContent = p.username
    ? `Zur Bestätigung „${p.username}“ eintippen`
    : 'Zur Bestätigung „löschen“ eintippen';
  syncDisplayRow();
  syncRenameRow();
  syncPrivacyRows();
  syncSupporterRow();
  closeAccountForms();
  accountOverlay.classList.remove('hidden');

  const [books, series] = await Promise.all([
    supabaseClient.from('books').select('id', { count: 'exact', head: true }).eq('user_id', p.id).eq('status', 'read'),
    supabaseClient.from('shelves').select('id', { count: 'exact', head: true }).eq('user_id', p.id),
  ]);
  if(books.count != null) document.getElementById('accBooks').textContent = books.count;
  if(series.count != null) document.getElementById('accSeries').textContent = series.count;
}

// Supporter im Konto-Fenster: seit wann, und 14 Tage lang der Widerruf (Pflicht-Knopf für Online-Verträge).
const WITHDRAW_DAYS = 14; // wie im Worker
function withdrawUntil(){
  if(!ownPurchase) return null;
  const until = new Date(ownPurchase.created_at);
  until.setDate(until.getDate() + WITHDRAW_DAYS);
  return until > new Date() ? until : null;
}
function syncSupporterRow(){
  const until = withdrawUntil();
  document.getElementById('accSupporter').classList.toggle('hidden', !ownPremium);
  if(!ownPremium) return;
  document.getElementById('accSupporterTitle').textContent = ownPurchase
    ? `Supporter seit ${fmtDate(ownPurchase.created_at)}` : 'Supporter, geschenkt';
  document.getElementById('accSupporterNote').textContent = until
    ? `Regal scannen und Vitrine sind freigeschaltet. Widerrufen kannst du bis ${fmtDate(until)} und bekommst dann alles zurück.`
    : 'Regal scannen und Vitrine sind freigeschaltet. Danke für deine Unterstützung!';
  document.getElementById('accWithdrawBtn').classList.toggle('hidden', !until);
}
document.getElementById('accWithdrawBtn').addEventListener('click', async ()=>{
  const ok = await ask({
    title: 'Vertrag widerrufen?',
    text: `Du bekommst die vollen ${document.getElementById('buyPrice').textContent} über deine Zahlungsart zurück. Regal scannen und die Vitrine sind danach nicht mehr verfügbar; dein Regal bleibt, wie es ist. Die Bestätigung kommt per E-Mail.`,
    confirmLabel: 'Widerruf bestätigen',
    danger: true,
  });
  if(!ok) return;
  const btn = document.getElementById('accWithdrawBtn');
  btn.disabled = true;
  try {
    const { data:{ session } } = await supabaseClient.auth.getSession();
    const res = await fetch('/api/withdraw', {
      method: 'POST',
      headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    if(!res.ok){
      showToast(res.status === 410 ? 'Die 14 Tage für den Widerruf sind vorbei'
        : 'Widerruf hat nicht geklappt. Versuch es gleich noch einmal oder schreib uns (siehe Impressum).');
      return;
    }
    showToast('Widerruf ist eingegangen. Das Geld kommt in ein paar Tagen zurück.');
    // Premium nimmt der Worker weg, sobald Stripe die Erstattung meldet.
    for(let i = 0; i < 10 && ownPremium; i++){
      await new Promise(r=>setTimeout(r, 2000));
      await loadPremium();
    }
    syncSupporterRow();
    render();
  } catch(e){
    showToast('Keine Verbindung. Versuch es gleich noch einmal.');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('accountCloseBtn').addEventListener('click', ()=>accountOverlay.classList.add('hidden'));
accountOverlay.addEventListener('click', e=>{ if(e.target === accountOverlay) accountOverlay.classList.add('hidden'); });

document.getElementById('accDisplayBtn').addEventListener('click', ()=>{
  closeAccountForms();
  document.getElementById('accDisplayRow').classList.add('hidden');
  document.getElementById('accDisplayForm').classList.remove('hidden');
  const input = document.getElementById('accDisplayInput');
  input.value = currentProfile.display_name || '';
  input.focus();
  input.select();
});
document.getElementById('accDisplayCancel').addEventListener('click', closeAccountForms);

document.getElementById('accDisplayForm').addEventListener('submit', async e=>{
  e.preventDefault();
  // Mehrfache Leerzeichen zusammenziehen, Steuerzeichen entfernen; leer heißt: Nutzername anzeigen.
  const val = document.getElementById('accDisplayInput').value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32) || null;
  if(val === (currentProfile.display_name || null)){ closeAccountForms(); return; }
  const btn = document.getElementById('accDisplaySave');
  btn.disabled = true;
  const { data, error } = await supabaseClient.from('profiles').update({ display_name: val }).eq('id', currentUser.id).select().single();
  btn.disabled = false;
  if(error){ showToast(dbErrorText(error, 'Fehler beim Speichern')); return; }
  currentProfile = data;
  resetDirectory();
  if(viewedProfile && viewedProfile.id === currentUser.id) viewedProfile.display_name = data.display_name;
  syncDisplayRow();
  closeAccountForms();
  render();
  showToast(val ? 'Anzeigename gespeichert' : 'Anzeigename entfernt');
});

document.getElementById('accRenameBtn').addEventListener('click', ()=>{
  closeAccountForms();
  document.getElementById('accRenameRow').classList.add('hidden');
  document.getElementById('accRenameForm').classList.remove('hidden');
  const input = document.getElementById('accRenameInput');
  input.value = currentProfile.username || '';
  input.focus();
  input.select();
});
document.getElementById('accRenameCancel').addEventListener('click', closeAccountForms);

document.getElementById('accRenameForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const val = document.getElementById('accRenameInput').value.trim().toLowerCase();
  if(val === currentProfile.username){ closeAccountForms(); return; }
  if(!/^[a-z0-9_]{3,20}$/.test(val)){ showToast('3–20 Zeichen: a–z, 0–9, _'); return; }
  const btn = document.getElementById('accRenameSave');
  btn.disabled = true;
  const { data, error } = await supabaseClient.from('profiles').update({ username: val }).eq('id', currentUser.id).select().single();
  btn.disabled = false;
  if(error){ showToast(dbErrorText(error, 'Fehler beim Speichern')); return; }
  const wasViewingOwn = currentRoute === 'shelf' && viewedProfile && viewedProfile.id === currentUser.id;
  currentProfile = data;
  resetDirectory();
  document.getElementById('accHandle').textContent = '@' + val;
  syncDisplayRow();
  syncRenameRow();
  closeAccountForms();
  showToast('Nutzername geändert');
  if(wasViewingOwn) goToUser(val); else renderAuthUI();
});

document.getElementById('accDeleteBtn').addEventListener('click', ()=>{
  closeAccountForms();
  document.getElementById('accDeleteBtn').classList.add('hidden');
  document.getElementById('accDeleteForm').classList.remove('hidden');
  const input = document.getElementById('accDeleteInput');
  input.value = '';
  document.getElementById('accDeleteConfirm').disabled = true;
  input.focus();
});
document.getElementById('accDeleteCancel').addEventListener('click', closeAccountForms);
document.getElementById('accDeleteInput').addEventListener('input', e=>{
  const expected = currentProfile.username || 'löschen';
  document.getElementById('accDeleteConfirm').disabled = e.target.value.trim().toLowerCase() !== expected;
});
document.getElementById('accDeleteForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const btn = document.getElementById('accDeleteConfirm');
  if(btn.disabled) return;
  btn.disabled = true;
  const { error } = await supabaseClient.rpc('delete_my_account', { confirm_username: document.getElementById('accDeleteInput').value.trim() });
  if(error){
    btn.disabled = false;
    showToast(dbErrorText(error, 'Konto konnte nicht gelöscht werden'));
    return;
  }
  accountOverlay.classList.add('hidden');
  setPref(LAST_USER_KEY, '');
  resetDirectory();
  await supabaseClient.auth.signOut({ scope: 'local' });
  navigate('');
  showToast('Dein Konto wurde gelöscht');
});

// ---- Verwaltung (nur Admins, zusätzlich mit Zwei-Faktor gesichert) ----
// Die Seite ist nur die Oberfläche: jede Aktion läuft über eine Datenbankfunktion,
// die selbst prüft, ob die Sitzung einem Admin gehört und per Zwei-Faktor bestätigt ist.
let adminUsers = [];
let adminLogEntries = [];
let adminOpenId = null;
let adminLoadSeq = 0;
let adminFilter = 'all';
let limitPeak = null; // { name, pct } des vollsten Gratis-Kontingents, für die Übersicht
const ADMIN_TAB_KEY = 'bookshelf-admin-tab';
const ADMIN_TABS = ['overview', 'users', 'costs', 'limits', 'log'];
let adminTab = ADMIN_TABS.includes(getPref(ADMIN_TAB_KEY, '')) ? getPref(ADMIN_TAB_KEY, '') : 'overview';
const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>';

function gateHtml(title, text, actions = ''){
  return `<div class="gate-card"><span class="gate-icon">${ICON_LOCK}</span><h2>${title}</h2><p>${text}</p>${actions ? `<div class="gate-actions">${actions}</div>` : ''}</div>`;
}
function codeFormHtml(){
  return `<form class="mfa-form" id="mfaForm" autocomplete="off">
    <input type="text" id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" aria-label="6-stelliger Code">
    <button type="submit" class="btn btn-primary">Bestätigen</button>
  </form>`;
}

function showAdminGate(html){
  const gate = document.getElementById('adminGate');
  gate.innerHTML = html;
  gate.classList.remove('hidden');
  document.getElementById('adminContent').classList.add('hidden');
  document.getElementById('adminRefreshBtn').classList.add('hidden');
}

async function renderAdmin(){
  if(!currentUser){
    showAdminGate(gateHtml('Bitte anmelden', 'Die Verwaltung ist nur für angemeldete Admins.',
      '<button type="button" class="btn btn-primary" id="adminLoginBtn">Mit Google anmelden</button>'));
    document.getElementById('adminLoginBtn').addEventListener('click', ()=>{
      setPref(AFTER_LOGIN_KEY, 'admin');
      signInWithGoogle();
    });
    return;
  }
  if(!isAdminMember){
    showAdminGate(gateHtml('Kein Zugriff', 'Dein Konto hat keine Admin-Rechte.',
      '<a class="btn btn-secondary" href="./" data-route="home">Zur Startseite</a>'));
    return;
  }
  const { data: aal, error } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if(currentRoute !== 'admin') return;
  if(error){ showAdminGate(gateHtml('Fehler', 'Die Sicherheitsstufe der Sitzung konnte nicht geprüft werden.')); return; }
  if(aal.currentLevel !== 'aal2'){ await renderMfaGate(); return; }
  document.getElementById('adminGate').classList.add('hidden');
  document.getElementById('adminContent').classList.remove('hidden');
  document.getElementById('adminRefreshBtn').classList.remove('hidden');
  setAdminTab(adminTab);
  await loadAdminData();
}

// ---- Verwaltung: Reiter ----
function setAdminTab(tab, focus = false){
  adminTab = tab;
  setPref(ADMIN_TAB_KEY, tab);
  document.querySelectorAll('#adminTabs [role="tab"]').forEach(btn=>{
    const on = btn.getAttribute('data-tab') === tab;
    btn.setAttribute('aria-selected', on);
    btn.tabIndex = on ? 0 : -1;
    if(on && focus) btn.focus();
  });
  ADMIN_TABS.forEach(t=>document.getElementById(`adminPanel-${t}`).classList.toggle('hidden', t !== tab));
}
document.getElementById('adminTabs').addEventListener('click', e=>{
  const btn = e.target.closest('[role="tab"]');
  if(btn) setAdminTab(btn.getAttribute('data-tab'));
});
document.getElementById('adminTabs').addEventListener('keydown', e=>{
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if(!step) return;
  e.preventDefault();
  setAdminTab(ADMIN_TABS[(ADMIN_TABS.indexOf(adminTab) + step + ADMIN_TABS.length) % ADMIN_TABS.length], true);
});
// Kacheln und Knöpfe der Übersicht springen in den passenden Reiter.
document.getElementById('adminContent').addEventListener('click', e=>{
  const go = e.target.closest('[data-goto]');
  if(go){ setAdminTab(go.getAttribute('data-goto')); window.scrollTo({ top: 0 }); return; }
  const user = e.target.closest('[data-user]');
  if(!user) return;
  adminOpenId = user.getAttribute('data-user');
  adminFilter = 'all';
  document.getElementById('adminSearch').value = '';
  setAdminTab('users');
  renderAdminUsers();
  document.querySelector(`.admin-user[data-id="${CSS.escape(adminOpenId)}"]`)?.scrollIntoView({ block: 'center' });
});

async function renderMfaGate(){
  const { data: factors, error } = await supabaseClient.auth.mfa.listFactors();
  if(error){ showAdminGate(gateHtml('Fehler', 'Der Zwei-Faktor-Status konnte nicht geladen werden.')); return; }
  const verified = (factors.totp || []).find(f=>f.status === 'verified');
  if(verified){
    showAdminGate(gateHtml('Mit Code bestätigen', 'Gib den 6-stelligen Code aus deiner Authenticator-App ein.', codeFormHtml()));
    bindCodeForm(verified.id);
    return;
  }
  // Abgebrochene Einrichtungen entfernen, sonst lehnt Supabase eine neue ab.
  for(const f of (factors.all || []).filter(f=>f.status === 'unverified')){
    await supabaseClient.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data: enroll, error: enrollErr } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Bücherregal Admin', issuer: 'Bücherregal' });
  if(currentRoute !== 'admin') return;
  if(enrollErr){
    showAdminGate(gateHtml('Zwei-Faktor nicht verfügbar', 'Aktiviere in Supabase unter Authentication → Multi-Factor die App-Authentifizierung (TOTP) und lade die Seite neu.'));
    return;
  }
  const qrSrc = await mfaQrSrc(enroll.totp);
  if(currentRoute !== 'admin') return;
  showAdminGate(gateHtml('Zwei-Faktor einrichten',
    'Die Verwaltung ist zusätzlich mit einem Code aus einer Authenticator-App geschützt, zum Beispiel Google Authenticator, 1Password oder Authy. Scanne den QR-Code und gib den angezeigten Code ein.',
    `<img class="mfa-qr" src="${escapeHtml(qrSrc)}" alt="QR-Code für die Authenticator-App">
     <p class="mfa-secret">Oder den Schlüssel von Hand eingeben:<code>${escapeHtml(enroll.totp.secret)}</code></p>
     ${codeFormHtml()}`));
  bindCodeForm(enroll.id);
}

// Supabase schreibt die E-Mail als Kontonamen in den QR-Code. Die App soll aber nur
// „Bücherregal“ und „Admin“ zeigen, also den otpauth-Link umschreiben und den QR-Code
// selbst erzeugen. Der Schlüssel bleibt derselbe, nur die Anzeige in der App ändert sich.
async function mfaQrSrc(totp){
  try {
    const uri = new URL(totp.uri);
    uri.pathname = '/' + encodeURIComponent('Bücherregal') + ':Admin';
    uri.searchParams.set('issuer', 'Bücherregal');
    uri.searchParams.set('image', new URL('img/favicon-512.png', location.href).href);
    // Selbst ausgeliefert: der TOTP-Schlüssel soll durch keinen fremden Code laufen.
    const { default: QRCode } = await import('./js/vendor/qrcode-1.5.4.mjs');
    const svg = await QRCode.toString(uri.href, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  } catch(e){
    return totp.qr_code;
  }
}

function bindCodeForm(factorId){
  const form = document.getElementById('mfaForm');
  const input = document.getElementById('mfaCode');
  input.focus();
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const code = input.value.replace(/\s/g, '');
    if(!/^\d{6}$/.test(code)){ showToast('Bitte den 6-stelligen Code eingeben'); return; }
    const btn = form.querySelector('button');
    btn.disabled = true;
    const { error } = await supabaseClient.auth.mfa.challengeAndVerify({ factorId, code });
    btn.disabled = false;
    if(error){ input.select(); showToast('Code falsch oder abgelaufen'); return; }
    renderAdmin();
  });
}

async function loadAdminData(){
  const seq = ++adminLoadSeq;
  const [users, log] = await Promise.all([supabaseClient.rpc('admin_list_users'), supabaseClient.rpc('admin_list_log')]);
  if(seq !== adminLoadSeq || currentRoute !== 'admin') return;
  if(users.error){
    document.getElementById('adminUsers').innerHTML = `<p class="cards-error">${escapeHtml(dbErrorText(users.error, 'Die Nutzer konnten nicht geladen werden.'))}</p>`;
    return;
  }
  adminUsers = users.data || [];
  adminLogEntries = log.data || [];
  document.getElementById('adminTabUsersCount').textContent = adminUsers.length;
  renderAdminOverview();
  renderAdminUsers();
  renderAdminLog();
  loadAdminCosts(seq);
}

function adminTileHtml(label, value, note = '', goto = ''){
  return `<div class="admin-tile">${goto ? `<button type="button" class="admin-tile-link" data-goto="${goto}" aria-label="${label}: Details"></button>` : ''}
    <dt>${label}</dt><dd>${value}</dd>${note ? `<small>${note}</small>` : ''}</div>`;
}

// Kacheln, neue Konten und die letzten Aktionen. Kosten und Grenzen kommen nach, sobald sie geladen sind.
function renderAdminOverview(){
  const books = adminUsers.reduce((s, u)=>s + Number(u.book_count || 0), 0);
  const banned = adminUsers.filter(u=>u.banned_at).length;
  const premium = adminUsers.filter(u=>u.is_premium).length;
  const bought = adminUsers.filter(u=>u.premium_source === 'purchase').length;
  const monthAgo = Date.now() - 30 * 86400000;
  const fresh = adminUsers.filter(u=>new Date(u.created_at) >= monthAgo).length;
  const active = adminUsers.filter(u=>u.last_sign_in_at && new Date(u.last_sign_in_at) >= monthAgo).length;
  const n = costStats ? costNumbers() : null;
  const peakNote = limitPeak ? `${escapeHtml(limitPeak.name)}` : '';
  document.getElementById('adminStats').innerHTML = [
    adminTileHtml('Konten', fmtNum(adminUsers.length), `${fresh} neu in 30 Tagen${banned ? ` · ${banned}\u00a0gesperrt` : ''}`, 'users'),
    adminTileHtml('Aktiv', fmtNum(active), 'in 30 Tagen angemeldet', 'users'),
    adminTileHtml('Bücher', fmtNum(books), adminUsers.length ? `Ø ${fmtNum(books / adminUsers.length, 1)} pro Konto` : ''),
    adminTileHtml('Premium', fmtNum(premium), `davon ${bought} gekauft`, 'users'),
    adminTileHtml('Kosten pro Monat', n ? fmtEur(n.month) : '…', n ? `${fmtEur(n.month * 12)} im Jahr` : 'wird geladen', 'costs'),
    adminTileHtml('Gratis-Grenzen', limitPeak ? `${limitPeak.pct < 0.1 && limitPeak.pct > 0 ? '< 0,1' : fmtNum(limitPeak.pct, 1)} %` : '…',
      limitPeak ? `am vollsten: ${peakNote}` : 'wird geladen', 'limits'),
  ].join('');
  const newest = adminUsers.slice().sort((a, b)=>new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  document.getElementById('adminNewUsers').innerHTML = newest.length ? newest.map(u=>`
    <li><button type="button" class="admin-mini-user" data-user="${escapeHtml(u.id)}">
      ${adminAvatarHtml(u)}
      <span><b>${escapeHtml(u.username ? shownName(u) : 'Ohne Nutzernamen')}</b><small>${escapeHtml(u.username ? '@' + u.username : u.email || '')}</small></span>
      <time>${relDay(u.created_at)}</time>
    </button></li>`).join('') : '<li class="admin-muted">Noch keine Konten.</li>';
  document.getElementById('adminRecentLog').innerHTML = adminLogEntries.length
    ? adminLogEntries.slice(0, 5).map(l=>`<li><time>${relDay(l.created_at)}, ${fmtTime(l.created_at)}</time><span>${logEntryText(l)}</span></li>`).join('')
    : '<li class="admin-muted">Noch keine Aktionen.</li>';
}

const fmtTime = d=>new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
// „Heute“, „Gestern“ oder das Datum, nach dem Kalendertag in der Ortszeit.
function relDay(d){
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if(diff === 0) return 'Heute';
  if(diff === 1) return 'Gestern';
  return day.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: day.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
function adminAvatarHtml(u){
  return u.avatar_url
    ? `<img class="reader-avatar" src="${escapeHtml(u.avatar_url)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
    : `<span class="reader-avatar reader-avatar-fallback" aria-hidden="true">${escapeHtml((u.username || '?').charAt(0).toUpperCase())}</span>`;
}

function adminUserHtml(u){
  const open = u.id === adminOpenId;
  const name = u.username ? shownName(u) : 'Ohne Nutzernamen';
  const badges = (u.is_admin ? '<span class="badge">Admin</span>' : '')
    + (u.is_premium ? `<span class="badge badge-premium">${u.premium_source === 'purchase' ? 'Gekauft' : 'Premium'}</span>` : '')
    + (u.banned_at ? '<span class="badge badge-danger">Gesperrt</span>' : '');
  const avatar = adminAvatarHtml(u);
  const body = open ? `
    <div class="admin-user-body">
      ${u.banned_at ? `<p class="admin-note">Gesperrt seit ${fmtDate(u.banned_at)}${u.ban_reason ? ': ' + escapeHtml(u.ban_reason) : ''}</p>` : ''}
      <div class="admin-actions">
        ${u.username ? `<a class="btn btn-secondary" href="${shelfPath(u.username)}" data-act="open">Regal öffnen</a>` : ''}
        <button type="button" class="btn btn-secondary" data-act="rename">Umbenennen</button>
        <button type="button" class="btn btn-secondary" data-act="premium">${u.is_premium ? 'Premium entziehen' : 'Premium geben'}</button>
        ${u.is_admin ? '' : `<button type="button" class="btn btn-secondary" data-act="ban">${u.banned_at ? 'Sperre aufheben' : 'Sperren'}</button>`}
        <button type="button" class="btn btn-danger-outline" data-act="clear" ${Number(u.book_count) ? '' : 'disabled'}>Regal leeren</button>
        ${u.is_admin ? '' : '<button type="button" class="btn btn-danger-outline" data-act="delete">Konto löschen</button>'}
      </div>
      <div class="admin-books" id="adminBooks"><p class="admin-muted">Bücher werden geladen …</p></div>
    </div>` : '';
  return `<article class="admin-user ${open ? 'open' : ''} ${u.banned_at ? 'is-banned' : ''}" data-id="${escapeHtml(u.id)}">
    <button type="button" class="admin-user-head" aria-expanded="${open}">
      ${avatar}
      <span class="admin-user-main"><span class="admin-user-name"><b>${escapeHtml(name)}</b>${badges}</span><small>${escapeHtml([u.username ? '@' + u.username : '', u.email].filter(Boolean).join(' · '))}</small></span>
      <span class="admin-user-meta">
        <span>${Number(u.book_count)} ${Number(u.book_count) === 1 ? 'Buch' : 'Bücher'}</span>
        <span>seit ${fmtMonth(u.created_at)}</span>
        <span>${u.last_sign_in_at ? 'zuletzt ' + new Date(u.last_sign_in_at).toLocaleDateString('de-DE') : 'nie angemeldet'}</span>
      </span>
      <svg class="admin-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    ${body}
  </article>`;
}

const ADMIN_FILTERS = {
  all: ['Alle', ()=>true],
  premium: ['Premium', u=>u.is_premium],
  banned: ['Gesperrt', u=>u.banned_at],
  admin: ['Admins', u=>u.is_admin],
  empty: ['Ohne Bücher', u=>!Number(u.book_count)],
};
const ADMIN_SORTS = {
  new: (a, b)=>new Date(b.created_at) - new Date(a.created_at),
  active: (a, b)=>new Date(b.last_sign_in_at || 0) - new Date(a.last_sign_in_at || 0),
  books: (a, b)=>Number(b.book_count) - Number(a.book_count),
  name: (a, b)=>(a.username || '~').localeCompare(b.username || '~', 'de'),
};

function renderAdminUsers(){
  const q = document.getElementById('adminSearch').value.trim().toLowerCase();
  document.getElementById('adminFilters').innerHTML = Object.entries(ADMIN_FILTERS).map(([k, [label, test]])=>
    `<button type="button" class="filter-pill ${adminFilter === k ? 'active' : ''}" data-filter="${k}" aria-pressed="${adminFilter === k}">${label} <span class="admin-pill-count">${adminUsers.filter(test).length}</span></button>`).join('');
  const list = adminUsers
    .filter(ADMIN_FILTERS[adminFilter][1])
    .filter(u=>!q || [u.username, u.email, u.display_name].some(v=>v && v.toLowerCase().includes(q)))
    .sort(ADMIN_SORTS[document.getElementById('adminSort').value]);
  document.getElementById('adminUserCount').textContent = list.length === adminUsers.length
    ? `${list.length} ${list.length === 1 ? 'Konto' : 'Konten'}` : `${list.length} von ${adminUsers.length} Konten`;
  const box = document.getElementById('adminUsers');
  box.classList.toggle('is-empty', !list.length);
  box.innerHTML = list.length ? list.map(adminUserHtml).join('') : '<p class="admin-empty">Niemand gefunden.</p>';
  if(adminOpenId && list.some(u=>u.id === adminOpenId)) loadAdminBooks(adminOpenId);
}

async function loadAdminBooks(userId){
  const { data, error } = await supabaseClient
    .from('books').select('id, title, author, series_order, shelves(label)')
    .eq('user_id', userId).order('created_at', { ascending: false });
  const box = document.getElementById('adminBooks');
  if(!box || adminOpenId !== userId) return;
  if(error){ box.innerHTML = '<p class="admin-muted">Bücher konnten nicht geladen werden.</p>'; return; }
  if(!data.length){ box.innerHTML = '<p class="admin-muted">Keine Bücher.</p>'; return; }
  box.innerHTML = `<h3>Bücher</h3><ul>${data.map(b=>`
    <li>
      <span><b>${escapeHtml(b.title)}</b><small>${escapeHtml([b.author, b.shelves && b.shelves.label !== b.title ? `${b.shelves.label} · Band ${b.series_order}` : ''].filter(Boolean).join(' · '))}</small></span>
      <button type="button" class="icon-btn sm" data-book-del="${escapeHtml(b.id)}" data-title="${escapeHtml(b.title)}" aria-label="„${escapeHtml(b.title)}“ löschen" title="Buch löschen">${ICON_TRASH}</button>
    </li>`).join('')}</ul>`;
}

async function runAdmin(fn, args, success){
  const { error } = await supabaseClient.rpc(fn, args);
  if(error){ showToast(dbErrorText(error, 'Aktion fehlgeschlagen')); return false; }
  showToast(success);
  resetDirectory();
  await loadAdminData();
  return true;
}

async function adminAction(act, u){
  const label = u.username ? '@' + u.username : 'dieses Konto';
  if(act === 'rename'){
    const val = await ask({ title: `${label} umbenennen`, text: 'Admins sind nicht an die 30-Tage-Frist gebunden. Alte Links auf das Regal funktionieren danach nicht mehr.',
      input: { label: 'Neuer Nutzername', value: u.username || '', hint: '3–20 Zeichen: a–z, 0–9, _' }, confirmLabel: 'Umbenennen' });
    if(val == null) return;
    const name = val.toLowerCase();
    if(!/^[a-z0-9_]{3,20}$/.test(name)){ showToast('3–20 Zeichen: a–z, 0–9, _'); return; }
    if(name !== u.username) await runAdmin('admin_rename_user', { target: u.id, new_username: name }, `Umbenannt in @${name}`);
  } else if(act === 'ban'){
    if(u.banned_at){
      if(await ask({ title: `Sperre von ${label} aufheben?`, text: 'Das Regal ist danach wieder öffentlich, und das Konto kann wieder bearbeiten.', confirmLabel: 'Sperre aufheben' })){
        await runAdmin('admin_set_ban', { target: u.id, banned: false, reason: null }, 'Sperre aufgehoben');
      }
    } else {
      const reason = await ask({ title: `${label} sperren?`, text: 'Das Regal verschwindet aus der Öffentlichkeit, und das Konto kann nichts mehr ändern. Die Daten bleiben erhalten.',
        input: { label: 'Grund (sieht die Person in ihrem Profil)', placeholder: 'optional' }, confirmLabel: 'Sperren', danger: true });
      if(reason == null) return;
      await runAdmin('admin_set_ban', { target: u.id, banned: true, reason }, `${label} gesperrt`);
    }
  } else if(act === 'clear'){
    if(await ask({ title: `Regal von ${label} leeren?`, text: `Alle ${u.book_count} Bücher, Reihen und Kategorien werden endgültig gelöscht. Das Konto bleibt bestehen.`,
      match: u.username || 'leeren', confirmLabel: 'Regal leeren', danger: true })){
      await runAdmin('admin_clear_shelf', { target: u.id }, 'Regal geleert');
    }
  } else if(act === 'delete'){
    if(await ask({ title: `Konto ${label} löschen?`, text: 'Profil, Regal und alle Bücher werden endgültig gelöscht. Die Person kann sich danach mit Google neu registrieren.',
      match: u.username || 'löschen', confirmLabel: 'Konto löschen', danger: true })){
      if(await runAdmin('admin_delete_user', { target: u.id }, 'Konto gelöscht')) adminOpenId = null;
    }
  } else if(act === 'premium'){
    if(!u.is_premium){
      await runAdmin('admin_set_premium', { target: u.id, premium: true }, `${label} hat jetzt Premium`);
    } else if(await ask({ title: `Premium von ${label} entziehen?`, text: 'Premium-Funktionen wie „Regal scannen“ sind danach nicht mehr verfügbar. Das Regal bleibt, wie es ist.'
      + (u.premium_source === 'purchase' ? ' Supporter wurde gekauft: Erstatte den Kauf lieber in Stripe, dann wird Premium von selbst entzogen.' : ''), confirmLabel: 'Premium entziehen' })){
      await runAdmin('admin_set_premium', { target: u.id, premium: false }, `Premium von ${label} entzogen`);
    }
  }
}

document.getElementById('adminUsers').addEventListener('click', async e=>{
  const card = e.target.closest('.admin-user');
  if(!card) return;
  const u = adminUsers.find(x=>x.id === card.getAttribute('data-id'));
  if(!u) return;
  if(e.target.closest('.admin-user-head')){
    adminOpenId = adminOpenId === u.id ? null : u.id;
    renderAdminUsers();
    return;
  }
  const del = e.target.closest('[data-book-del]');
  if(del){
    if(await ask({ title: 'Buch löschen?', text: `„${del.getAttribute('data-title')}“ wird aus dem Regal von ${u.username ? '@' + u.username : 'diesem Konto'} entfernt.`, confirmLabel: 'Löschen', danger: true })){
      await runAdmin('admin_delete_book', { book: del.getAttribute('data-book-del') }, 'Buch gelöscht');
    }
    return;
  }
  const btn = e.target.closest('[data-act]');
  if(!btn) return;
  if(btn.getAttribute('data-act') === 'open'){
    if(e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    goToUser(u.username);
    return;
  }
  adminAction(btn.getAttribute('data-act'), u);
});
document.getElementById('adminSearch').addEventListener('input', renderAdminUsers);
document.getElementById('adminSort').addEventListener('change', renderAdminUsers);
document.getElementById('adminFilters').addEventListener('click', e=>{
  const btn = e.target.closest('[data-filter]');
  if(!btn) return;
  adminFilter = btn.getAttribute('data-filter');
  renderAdminUsers();
});
document.getElementById('adminRefreshBtn').addEventListener('click', loadAdminData);

const LOG_LABELS = {
  ban: 'hat gesperrt:',
  unban: 'hat die Sperre aufgehoben:',
  rename: 'hat umbenannt:',
  delete_book: 'hat ein Buch gelöscht bei',
  clear_shelf: 'hat das Regal geleert von',
  delete_user: 'hat das Konto gelöscht:',
  premium_on: 'hat Premium vergeben an',
  premium_off: 'hat Premium entzogen:',
};
function logEntryText(l){
  const d = l.details || {};
  const extra = l.action === 'rename' ? ` (@${d.from || '–'} → @${d.to || '–'})`
    : l.action === 'delete_book' ? ` („${d.title || ''}“)`
    : l.action === 'clear_shelf' ? ` (${d.books || 0} Bücher)`
    : l.action === 'ban' && d.reason ? ` (${d.reason})` : '';
  return `<b>@${escapeHtml(l.admin_name || '?')}</b> ${LOG_LABELS[l.action] || escapeHtml(l.action)} <b>${l.target_name ? '@' + escapeHtml(l.target_name) : 'gelöschtes Konto'}</b>${escapeHtml(extra)}`;
}
// Nach Kalendertagen gegliedert, neueste zuerst wie aus admin_list_log.
function renderAdminLog(){
  const box = document.getElementById('adminLog');
  if(!adminLogEntries.length){ box.innerHTML = '<p class="admin-empty">Noch keine Aktionen.</p>'; return; }
  const days = [];
  adminLogEntries.forEach(l=>{
    const label = relDay(l.created_at);
    if(!days.length || days[days.length - 1].label !== label) days.push({ label, items: [] });
    days[days.length - 1].items.push(l);
  });
  box.innerHTML = days.map(day=>`<section class="admin-log-day">
    <h3>${day.label}<span>${day.items.length} ${day.items.length === 1 ? 'Aktion' : 'Aktionen'}</span></h3>
    <ol class="admin-log">${day.items.map(l=>`<li><time>${fmtTime(l.created_at)}</time><span>${logEntryText(l)}</span></li>`).join('')}</ol>
  </section>`).join('');
}

// ---- Verwaltung: Kosten ----
// Gemini und Stripe rechnet die App aus den echten Zahlen (admin_cost_stats, supabase/021_admin_costs.sql).
// Die übrigen Posten und die Annahmen trägt der Admin selbst ein; sie bleiben in diesem Browser.
// Preise Stand Oktober 2026: Gemini 3.5 Flash-Lite bezahlt 0,30 $ / 2,50 $ pro 1 Mio. Tokens (rein/raus),
// .app bei Cloudflare 14,20 $ im Jahr, Google Play einmalig 25 $, Stripe 1,5 % + 0,25 € (EWR-Karte)
// plus 0,4 % für die Rechnung nach dem Checkout.
const COST_KEY = 'bookshelf-admin-costs';
const SCAN_DAILY_LIMIT = 200; // wie claim_scan() in supabase/014_scan_limit.sql
const COST_DEFAULTS = {
  items: [
    { name: 'Supabase (Free)', amount: 0, cur: 'EUR', every: 'month' },
    { name: 'Cloudflare Workers (Free)', amount: 0, cur: 'EUR', every: 'month' },
    { name: 'Domain buecherregal.app (Cloudflare)', amount: 14.2, cur: 'USD', every: 'year' },
    { name: 'Google Play Entwicklerkonto', amount: 25, cur: 'USD', every: 'once' },
  ],
  usdEur: 0.86,
  inPrice: 0.3,
  outPrice: 2.5,
  // Ein auf 2000 px verkleinertes Foto zählt bei Gemini 3 rund 1.100 Tokens, dazu der Prompt. Raus geht
  // die Bücherliste als JSON, bei einem vollen Regalbrett um die 1.000 Tokens.
  inTokens: 1400,
  outTokens: 1000,
  scansPerDay: '', // leer: Schnitt der letzten 7 Tage
  stripePct: 1.9,
  stripeFix: 0.25,
};
const COST_ASSUME_FIELDS = [
  ['usdEur', 'Kurs (€ pro $)', '0.01'],
  ['inPrice', 'Gemini Eingabe ($ pro 1 Mio. Tokens)', '0.01'],
  ['outPrice', 'Gemini Ausgabe ($ pro 1 Mio. Tokens)', '0.01'],
  ['inTokens', 'Tokens pro Scan rein', '50'],
  ['outTokens', 'Tokens pro Scan raus', '50'],
  ['scansPerDay', 'Scans pro Tag (leer = Schnitt der letzten 7 Tage)', '1'],
  ['stripePct', 'Stripe-Gebühr in %', '0.1'],
  ['stripeFix', 'Stripe-Gebühr fest (€ pro Kauf)', '0.01'],
];
const COST_EVERY = { month: 'pro Monat', year: 'pro Jahr', once: 'einmalig' };
let costCfg = loadCostCfg();
let costStats = null; // null = lädt noch, { error } = fehlt (021 noch nicht ausgeführt)

function loadCostCfg(){
  try {
    const saved = JSON.parse(getPref(COST_KEY, 'null'));
    if(saved && Array.isArray(saved.items)) return { ...COST_DEFAULTS, ...saved };
  } catch(e){}
  return structuredClone(COST_DEFAULTS);
}
function saveCostCfg(){ setPref(COST_KEY, JSON.stringify(costCfg)); }

const fmtEur = v=>v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const toEur = (amount, cur)=>(Number(amount) || 0) * (cur === 'USD' ? Number(costCfg.usdEur) || 0 : 1);
const perMonth = item=>item.every === 'month' ? toEur(item.amount, item.cur) : item.every === 'year' ? toEur(item.amount, item.cur) / 12 : 0;

// Rechnet alles aus, was die Kacheln und die beiden automatischen Zeilen zeigen.
function costNumbers(){
  const s = costStats && !costStats.error ? costStats : null;
  const perScan = (costCfg.inTokens * costCfg.inPrice + costCfg.outTokens * costCfg.outPrice) / 1e6 * toEur(1, 'USD');
  // scan_log hält 7 Tage. Läuft das Zählen noch nicht so lange, durch die tatsächlichen Tage teilen.
  const days = s && s.first_scan ? Math.min(7, Math.max(1, (Date.now() - new Date(s.first_scan)) / 86400000)) : 7;
  const avgPerDay = s ? s.scans_7d / days : 0;
  const perDay = costCfg.scansPerDay === '' ? avgPerDay : Number(costCfg.scansPerDay) || 0;
  const gemini = perDay * 30 * perScan;
  const stripe = s ? s.sales_30d * costCfg.stripeFix + s.paid_cents_30d / 100 * costCfg.stripePct / 100 : 0;
  const items = costCfg.items.reduce((sum, it)=>sum + perMonth(it), 0);
  const once = costCfg.items.filter(it=>it.every === 'once').reduce((sum, it)=>sum + toEur(it.amount, it.cur), 0);
  const month = gemini + stripe + items;
  return { s, perScan, avgPerDay, perDay, gemini, stripe, month, once, revenue: s ? s.paid_cents_30d / 100 - stripe : 0 };
}

async function loadAdminCosts(seq){
  const [{ data, error }, usage] = await Promise.all([supabaseClient.rpc('admin_cost_stats'), loadWorkerUsage()]);
  if(seq !== adminLoadSeq || currentRoute !== 'admin') return;
  costStats = error ? { error } : data;
  workerUsage = usage;
  renderCostList();
  renderLimits();
}

// ---- Verwaltung: Gratis-Grenzen ----
// Supabase-Zahlen kommen mit admin_cost_stats, die Worker-Aufrufe pro Tag mit GET /api/usage (worker.js).
// Grenzen der Gratis-Pläne, Stand Oktober 2026. Egress (5 GB) lässt sich per SQL nicht messen.
const FREE_LIMITS = { workerPerDay: 100000, workerCpuMs: 10, dbBytes: 500e6, storageBytes: 1e9, mau: 50000 };
let workerUsage = null; // { days: [{ date, requests, errors, cpuP99 }] } oder { error: <Text> }
let usageActive = -1; // Tag, den Tooltip und Tastatur gerade zeigen

async function loadWorkerUsage(){
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const res = await fetch('/api/usage', { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} });
    const body = await res.json().catch(()=>({}));
    if(res.ok && Array.isArray(body.days)) return { days: fillUsageDays(body.days) };
    return { error: res.status === 503 ? 'Cloudflare ist noch nicht verbunden: lege am Worker das Secret CF_API_TOKEN an.'
      : res.status === 502 ? `Cloudflare hat keine Zahlen geliefert${body.message ? ` (${body.message})` : ''}.`
      : res.status === 404 || !res.headers.get('Content-Type')?.includes('json') ? 'Die Worker-Zahlen gibt es nur auf der echten Seite.'
      : 'Die Worker-Zahlen ließen sich nicht laden.' };
  } catch(e){
    return { error: 'Keine Verbindung zu Cloudflare.' };
  }
}
// Tage ohne Aufrufe fehlen in der Antwort; für das Diagramm alle 30 Tage (UTC, wie Cloudflares Tageszähler).
function fillUsageDays(rows){
  const byDate = new Map(rows.map(r=>[r.date, r]));
  return Array.from({ length: 30 }, (_, i)=>{
    const date = new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10);
    return byDate.get(date) || { date, requests: 0, errors: 0, cpuP99: 0 };
  });
}

const fmtNum = (v, digits = 0)=>v.toLocaleString('de-DE', { maximumFractionDigits: digits });
const fmtBytes = b=>b >= 1e9 ? `${fmtNum(b / 1e9, 2)} GB` : `${fmtNum(b / 1e6, 1)} MB`;
const fmtDay = d=>new Date(`${d}T00:00:00Z`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Ab wie vielen Konten die Grenze erreicht ist und wann, wenn es so weiterwächst wie in den letzten 30 Tagen.
function limitForecast(used, limit, s){
  if(!s || !s.accounts || !used) return 'Noch zu wenig Daten für eine Hochrechnung';
  const atAccounts = limit / (used / s.accounts);
  const head = `Gratis bis ca. ${fmtNum(Math.round(atAccounts))} Konten`;
  if(atAccounts <= s.accounts) return `${head}: Grenze erreicht`;
  const months = (atAccounts - s.accounts) / s.accounts_30d * 30 / 30.44; // ohne neue Konten: Infinity
  if(!isFinite(months) || months > 120) return `${head}, bei ${s.accounts_30d} neuen Konten im Monat nicht absehbar`;
  const when = new Date();
  when.setMonth(when.getMonth() + Math.ceil(months));
  return `${head}, voraussichtlich ab ${when.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`;
}

function meterHtml({ name, host, used, limit, value, of, note }){
  const pct = limit ? used / limit * 100 : 0;
  if(!limitPeak || pct > limitPeak.pct) limitPeak = { name, pct };
  const state = pct >= 100 ? ['is-over', 'Über der Grenze'] : pct >= 80 ? ['is-near', 'Fast voll'] : ['', ''];
  const shown = pct > 0 && pct < 0.1 ? '< 0,1' : fmtNum(pct, 1);
  return `<div class="limit-meter ${state[0]}">
    <div class="limit-head"><b>${name}</b><span>${host}</span></div>
    <p class="limit-value"><strong>${value}</strong> von ${of}${state[1] ? ` <span class="badge badge-danger">${state[1]}</span>` : ''}</p>
    <div class="limit-track" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, pct).toFixed(1)}" aria-label="${name}: ${shown} % der Gratis-Grenze"><span style="width:${Math.min(100, Math.max(pct, pct > 0 ? 1 : 0))}%"></span></div>
    <small>${shown} % belegt · ${escapeHtml(note)}</small>
  </div>`;
}

function renderLimits(){
  limitPeak = null;
  const s = costStats && !costStats.error ? costStats : null;
  const days = workerUsage && workerUsage.days;
  const meters = [];
  if(days){
    const peak = days.reduce((a, b)=>b.requests > a.requests ? b : a);
    const today = days[days.length - 1];
    const cpu = Math.max(...days.map(d=>d.cpuP99 || 0)) / 1000; // Cloudflare liefert Mikrosekunden
    meters.push(meterHtml({ name: 'Worker-Aufrufe am Tag', host: 'Cloudflare', used: peak.requests, limit: FREE_LIMITS.workerPerDay,
      value: fmtNum(peak.requests), of: `${fmtNum(FREE_LIMITS.workerPerDay)} (Spitze ${fmtDay(peak.date)}, heute ${fmtNum(today.requests)})`,
      note: limitForecast(peak.requests, FREE_LIMITS.workerPerDay, s) }));
    meters.push(meterHtml({ name: 'Rechenzeit pro Aufruf', host: 'Cloudflare', used: cpu, limit: FREE_LIMITS.workerCpuMs,
      value: `${fmtNum(cpu, 1)} ms`, of: `${FREE_LIMITS.workerCpuMs} ms (P99, 30 Tage)`,
      note: 'Darüber bricht der Aufruf ab, der Bezahlplan erlaubt mehr' }));
  }
  if(s){
    meters.push(meterHtml({ name: 'Datenbank', host: 'Supabase', used: s.db_bytes, limit: FREE_LIMITS.dbBytes,
      value: fmtBytes(s.db_bytes), of: '500 MB', note: limitForecast(s.db_bytes, FREE_LIMITS.dbBytes, s) }));
    meters.push(meterHtml({ name: 'Aktive Nutzer im Monat', host: 'Supabase', used: s.active_30d, limit: FREE_LIMITS.mau,
      value: fmtNum(s.active_30d), of: fmtNum(FREE_LIMITS.mau), note: limitForecast(s.active_30d, FREE_LIMITS.mau, s) }));
    meters.push(meterHtml({ name: 'Dateispeicher', host: 'Supabase', used: s.storage_bytes, limit: FREE_LIMITS.storageBytes,
      value: fmtBytes(s.storage_bytes), of: '1 GB', note: limitForecast(s.storage_bytes, FREE_LIMITS.storageBytes, s) }));
  }
  const hints = [!s && costStats && 'Supabase-Zahlen fehlen: supabase/021_admin_costs.sql im SQL Editor ausführen.',
    workerUsage && workerUsage.error].filter(Boolean);
  document.getElementById('adminLimitMeters').innerHTML = meters.join('')
    + hints.map(h=>`<p class="admin-muted limit-hint">${escapeHtml(h)}</p>`).join('')
    + '<p class="admin-muted limit-hint">Egress (5 GB im Monat) zeigt nur Supabase selbst: Dashboard → Usage.</p>';
  renderAdminOverview();
  renderUsageChart();
}

// Säulen pro Tag; heute in der Akzentfarbe. Hover oder Pfeiltasten zeigen den Wert eines Tages.
function renderUsageChart(){
  const plot = document.getElementById('adminUsagePlot');
  const table = document.getElementById('adminUsageTable');
  const note = document.getElementById('adminUsageNote');
  const days = workerUsage && workerUsage.days;
  if(!days){
    plot.innerHTML = `<p class="admin-muted">${workerUsage ? escapeHtml(workerUsage.error) : 'Wird geladen …'}</p>`;
    table.innerHTML = '';
    note.textContent = '';
    return;
  }
  const total = days.reduce((sum, d)=>sum + d.requests, 0);
  note.textContent = `Letzte 30 Tage: ${fmtNum(total)} Aufrufe, Gratis-Grenze ${fmtNum(FREE_LIMITS.workerPerDay)} am Tag`;
  const W = Math.max(280, plot.clientWidth), H = 200, padL = 44, padR = 8, padT = 22, padB = 26;
  const max = Math.max(...days.map(d=>d.requests), 1);
  const mag = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 5, 10].map(m=>m * mag).find(v=>v >= max); // runde Obergrenze für die Achse
  const y = v=>padT + (1 - v / top) * (H - padT - padB);
  const slot = (W - padL - padR) / days.length;
  const bw = Math.min(24, slot - 2);
  const peakIdx = days.reduce((best, d, i)=>d.requests > days[best].requests ? i : best, 0);
  const ticks = [0, top / 2, top];
  const bars = days.map((d, i)=>{
    const x = padL + i * slot + (slot - bw) / 2, yt = y(d.requests), h = H - padB - yt, r = Math.min(4, h, bw / 2);
    const path = h > 0 ? `M${x},${H - padB}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x + bw - r}Q${x + bw},${yt} ${x + bw},${yt + r}V${H - padB}Z` : '';
    return `<path class="usage-bar ${i === days.length - 1 ? 'is-today' : ''}" data-i="${i}" d="${path}"/>`;
  }).join('');
  const peak = days[peakIdx];
  const peakX = padL + peakIdx * slot + slot / 2;
  plot.innerHTML = `<svg class="usage-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img" aria-label="Worker-Aufrufe pro Tag, letzte 30 Tage. Pfeiltasten zeigen einzelne Tage.">
    ${ticks.map(t=>`<line class="usage-grid" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text class="usage-tick" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t, 1)}</text>`).join('')}
    <line class="usage-cross" id="adminUsageCross" y1="${padT}" y2="${H - padB}" visibility="hidden"/>
    ${bars}
    ${peak.requests ? `<text class="usage-label" x="${Math.min(Math.max(peakX, padL + 20), W - padR - 20)}" y="${y(peak.requests) - 6}" text-anchor="middle">${fmtNum(peak.requests)}</text>` : ''}
    <text class="usage-tick" x="${padL}" y="${H - 6}">${fmtDay(days[0].date)}</text>
    <text class="usage-tick" x="${W - padR}" y="${H - 6}" text-anchor="end">heute</text>
  </svg><div class="usage-tip hidden" id="adminUsageTip" role="status"></div>`;
  table.innerHTML = '<thead><tr><th>Tag (UTC)</th><th>Aufrufe</th><th>Fehler</th></tr></thead><tbody>'
    + days.slice().reverse().map(d=>`<tr><td>${fmtDay(d.date)}</td><td>${fmtNum(d.requests)}</td><td>${fmtNum(d.errors)}</td></tr>`).join('') + '</tbody>';

  const svg = plot.querySelector('svg');
  const show = i=>{
    usageActive = i;
    const tip = document.getElementById('adminUsageTip');
    const cross = document.getElementById('adminUsageCross');
    plot.querySelectorAll('.usage-bar').forEach(b=>b.classList.toggle('is-active', Number(b.getAttribute('data-i')) === i));
    if(i < 0){ tip.classList.add('hidden'); cross.setAttribute('visibility', 'hidden'); return; }
    const d = days[i], cx = padL + i * slot + slot / 2;
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<strong>${fmtNum(d.requests)}</strong> Aufrufe<span>${fmtDay(d.date)}${d.errors ? ` · ${fmtNum(d.errors)} Fehler` : ''}</span>`;
    tip.classList.remove('hidden');
    const left = cx / W * svg.clientWidth;
    tip.style.left = `${Math.min(Math.max(left, tip.offsetWidth / 2), svg.clientWidth - tip.offsetWidth / 2)}px`;
  };
  svg.addEventListener('pointermove', e=>{
    const x = (e.clientX - svg.getBoundingClientRect().left) / svg.clientWidth * W;
    show(Math.min(days.length - 1, Math.max(0, Math.floor((x - padL) / slot))));
  });
  svg.addEventListener('pointerleave', ()=>show(-1));
  svg.addEventListener('blur', ()=>show(-1));
  svg.addEventListener('focus', ()=>show(usageActive >= 0 ? usageActive : days.length - 1));
  svg.addEventListener('keydown', e=>{
    if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    show(Math.min(days.length - 1, Math.max(0, usageActive + (e.key === 'ArrowLeft' ? -1 : 1))));
  });
}
// Die Säulenbreite hängt von der Breite ab: bei Größenänderung neu zeichnen.
new ResizeObserver(()=>{ if(currentRoute === 'admin' && workerUsage && workerUsage.days) renderUsageChart(); })
  .observe(document.getElementById('adminUsagePlot'));

function costItemHtml(it, i){
  const opt = (map, cur)=>Object.entries(map).map(([v, label])=>`<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`).join('');
  return `<div class="admin-cost-row" data-i="${i}">
    <input type="text" data-k="name" value="${escapeHtml(it.name)}" aria-label="Posten" maxlength="80">
    <span class="admin-cost-amount">
      <input type="number" data-k="amount" value="${Number(it.amount) || 0}" min="0" step="0.01" inputmode="decimal" aria-label="Betrag">
      <select data-k="cur" aria-label="Währung">${opt({ EUR: '€', USD: '$' }, it.cur)}</select>
    </span>
    <select data-k="every" aria-label="Wie oft">${opt(COST_EVERY, it.every)}</select>
    <output class="admin-cost-month"></output>
    <button type="button" class="icon-btn sm" data-act="remove" aria-label="Posten entfernen">${ICON_TRASH}</button>
  </div>`;
}

function renderCostList(){
  document.getElementById('adminCostList').innerHTML = `
    <div class="admin-cost-group">Aus echten Zahlen berechnet</div>
    <div class="admin-cost-row is-auto" id="adminCostGemini"><span class="admin-cost-main"><b>Gemini 3.5 Flash-Lite (Regal scannen)</b><small></small></span><output class="admin-cost-month"></output></div>
    <div class="admin-cost-row is-auto" id="adminCostStripe"><span class="admin-cost-main"><b>Stripe-Gebühren (Supporter-Käufe)</b><small></small></span><output class="admin-cost-month"></output></div>
    <div class="admin-cost-group">Eigene Posten<span>Betrag · Rhythmus · pro Monat</span></div>
    ${costCfg.items.length ? costCfg.items.map(costItemHtml).join('') : '<p class="admin-empty">Noch keine eigenen Posten.</p>'}`;
  document.getElementById('adminCostAssume').innerHTML = COST_ASSUME_FIELDS.map(([k, label, step])=>`
    <label class="field"><span>${label}</span><input type="number" data-k="${k}" value="${escapeHtml(String(costCfg[k]))}" min="0" step="${step}" inputmode="decimal"></label>`).join('');
  renderCostTotals();
}

// Nur Zahlen und Texte neu schreiben, damit das Eingabefeld beim Tippen den Fokus behält.
function renderCostTotals(){
  const n = costNumbers();
  const fmtCt = v=>`${(v * 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} ct`;
  const missing = costStats === null ? 'Zahlen werden geladen …'
    : costStats.error ? 'Keine echten Zahlen: supabase/021_admin_costs.sql im Supabase SQL Editor ausführen.' : '';
  document.getElementById('adminCostStats').innerHTML = [
    adminTileHtml('Pro Monat', fmtEur(n.month)),
    adminTileHtml('Pro Jahr', fmtEur(n.month * 12)),
    adminTileHtml('Einmalig', fmtEur(n.once)),
    adminTileHtml('Supporter netto', fmtEur(n.revenue), 'letzte 30 Tage'),
  ].join('');
  const gemini = document.getElementById('adminCostGemini');
  gemini.querySelector('small').textContent = [
    missing || `${n.s.scans_7d} Scans in 7 Tagen, heute ${n.s.scans_today}`,
    `${costCfg.scansPerDay === '' ? 'Ø' : 'angenommen'} ${n.perDay.toLocaleString('de-DE', { maximumFractionDigits: 1 })} am Tag`,
    `${fmtCt(n.perScan)} pro Scan`,
    `höchstens ${fmtEur(SCAN_DAILY_LIMIT * 30 * n.perScan)} im Monat (Tageslimit ${SCAN_DAILY_LIMIT})`,
  ].join(' · ');
  gemini.querySelector('output').textContent = `${fmtEur(n.gemini)}/Monat`;
  const stripe = document.getElementById('adminCostStripe');
  stripe.querySelector('small').textContent = missing || [
    `${n.s.sales_30d} ${n.s.sales_30d === 1 ? 'Kauf' : 'Käufe'} in 30 Tagen`,
    `${costCfg.stripePct.toLocaleString('de-DE')} % + ${fmtEur(Number(costCfg.stripeFix))} pro Kauf`,
    `insgesamt ${n.s.sales}, davon ${n.s.refunds} erstattet`,
  ].join(' · ');
  stripe.querySelector('output').textContent = `${fmtEur(n.stripe)}/Monat`;
  document.querySelectorAll('#adminCostList .admin-cost-row[data-i]').forEach(row=>{
    const it = costCfg.items[row.getAttribute('data-i')];
    row.querySelector('output').textContent = it.every === 'once' ? 'einmalig' : `${fmtEur(perMonth(it))}/Monat`;
  });
  renderAdminOverview();
}

document.getElementById('adminCostList').addEventListener('input', e=>{
  const row = e.target.closest('[data-i]');
  const k = e.target.getAttribute('data-k');
  if(!row || !k) return;
  const it = costCfg.items[row.getAttribute('data-i')];
  it[k] = k === 'amount' ? Math.max(0, Number(e.target.value) || 0) : e.target.value;
  saveCostCfg();
  renderCostTotals();
});
document.getElementById('adminCostList').addEventListener('click', e=>{
  const btn = e.target.closest('[data-act="remove"]');
  if(!btn) return;
  costCfg.items.splice(Number(btn.closest('[data-i]').getAttribute('data-i')), 1);
  saveCostCfg();
  renderCostList();
});
document.getElementById('adminCostAssume').addEventListener('input', e=>{
  const k = e.target.getAttribute('data-k');
  if(!k) return;
  costCfg[k] = k === 'scansPerDay' && e.target.value === '' ? '' : Math.max(0, Number(e.target.value) || 0);
  saveCostCfg();
  renderCostTotals();
});
document.getElementById('adminCostAdd').addEventListener('click', ()=>{
  costCfg.items.push({ name: 'Neues Abo', amount: 0, cur: 'EUR', every: 'month' });
  saveCostCfg();
  renderCostList();
  const input = document.querySelector('#adminCostList .admin-cost-row:last-child input');
  input.focus();
  input.select();
});
document.getElementById('adminCostReset').addEventListener('click', async ()=>{
  if(!await ask({ title: 'Kosten zurücksetzen?', text: 'Deine eigenen Posten und Annahmen werden durch die Standardwerte ersetzt.', confirmLabel: 'Zurücksetzen', danger: true })) return;
  costCfg = structuredClone(COST_DEFAULTS);
  saveCostCfg();
  renderCostList();
});

// ---- Daten laden ----
async function loadShelfData(profileId){
  const useSandbox = devSandboxActive();
  if(useSandbox && sandbox && sandbox.profileId === profileId){
    applySandboxToState();
    return;
  }
  const [{data: cats, error: catErr}, {data: shelvesData, error: shelfErr}, {data: booksData, error: bookErr}, {data: showcaseRows}] = await Promise.all([
    supabaseClient.from('categories').select('*').eq('user_id', profileId).order('name'),
    supabaseClient.from('shelves').select('*, shelf_categories(category_id)').eq('user_id', profileId),
    supabaseClient.from('books').select('*').eq('user_id', profileId).order('series_order'),
    // Ohne Premium (oder solange 018_showcase.sql fehlt) kommt nichts zurück: dann eben keine Vitrine.
    supabaseClient.rpc('showcases_of', { p_users: [profileId] }),
  ]);
  if(catErr || shelfErr || bookErr){
    showToast('Daten konnten nicht geladen werden');
    return;
  }
  const sc = (showcaseRows || [])[0];
  const loadedShowcase = sc ? { shelf_id: sc.shelf_id || null, book_ids: sc.book_ids || [] } : null;
  if(useSandbox){
    seedSandbox(profileId, cats || [], shelvesData || [], booksData || [], loadedShowcase);
    applySandboxToState();
    return;
  }
  showcase = loadedShowcase;
  categories = cats || [];
  shelves = (shelvesData || []).map(s=>({
    ...s,
    categoryIds: (s.shelf_categories || []).map(sc=>sc.category_id),
  }));
  books = booksData || [];
}

async function refreshAndRender(){
  resetDirectory(); // Übersicht beim nächsten Öffnen neu laden
  if(viewedProfile) await loadShelfData(viewedProfile.id);
  render();
}

function buildGroups(){
  return shelves
    .map(s=>{
      const cats = s.categoryIds.map(id=>categories.find(c=>c.id===id)).filter(Boolean);
      return {
        key: s.id,
        label: s.label,
        isPrivate: !!s.is_private,
        categoryIds: s.categoryIds,
        categories: cats.length ? cats : [{id:null, name:'Unkategorisiert'}],
        items: books.filter(b=>b.shelf_id===s.id).sort((a,b)=>(a.series_order||0)-(b.series_order||0)),
      };
    })
    .filter(g=>g.items.length>0)
    .sort(seriesComparator());
}

function seriesComparator(){
  const byName = (a, b)=>a.label.localeCompare(b.label, 'de');
  const pref = getPref(SORT_KEY, 'alpha');
  if(pref === 'count') return (a, b)=>b.items.length - a.items.length || byName(a, b);
  if(pref === 'recent'){
    const last = g=>g.items.reduce((m, b)=>(b.date_read && b.date_read > m ? b.date_read : m), '');
    return (a, b)=>last(b).localeCompare(last(a)) || byName(a, b);
  }
  return byName;
}

function groupAuthor(group){
  const counts = {};
  group.items.forEach(b=>{ if(b.author) counts[b.author] = (counts[b.author]||0) + 1; });
  return Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0] || '';
}

function renderFilterBar(){
  const bar = document.getElementById('filterBar');
  const allGroups = buildGroups();
  const cats = [...new Set(allGroups.flatMap(g=>g.categories.map(c=>c.name)))].sort((a,b)=>a.localeCompare(b,'de'));
  // Status-Filter nur, wenn es neben gelesenen Büchern auch andere gibt.
  const counts = { read: 0, reading: 0, want: 0 };
  books.forEach(b=>counts[bookStatus(b)]++);
  const statuses = counts.reading || counts.want ? Object.keys(STATUS_FILTERS).filter(st=>counts[st]) : [];
  if(activeStatus && !statuses.includes(activeStatus)) activeStatus = null;
  if(cats.length === 0 && !statuses.length){ bar.innerHTML = ''; return; }
  const all = activeCategory === null && activeStatus === null;
  const pills = [`<button class="filter-pill ${all?'active':''}" data-cat="" aria-pressed="${all}">Alle</button>`]
    .concat(statuses.map(st=>`<button class="filter-pill filter-status ${activeStatus===st?'active':''}" data-status="${st}" aria-pressed="${activeStatus===st}">${STATUS_FILTERS[st]} <span class="filter-count">${counts[st]}</span></button>`))
    .concat(statuses.length && cats.length ? ['<span class="filter-sep" aria-hidden="true"></span>'] : [])
    .concat(cats.map(c=>`<button class="filter-pill ${activeCategory===c?'active':''}" data-cat="${escapeHtml(c)}" aria-pressed="${activeCategory===c}">${escapeHtml(c)}</button>`));
  bar.innerHTML = pills.join('');
  bar.querySelectorAll('.filter-pill').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const st = btn.getAttribute('data-status');
      if(st){
        activeStatus = activeStatus === st ? null : st;
      } else {
        const cat = btn.getAttribute('data-cat');
        activeCategory = cat === '' ? null : cat;
        if(cat === '') activeStatus = null;
      }
      selectedId = null;
      render();
    });
  });
}

function renderHeader(owner){
  const h1 = document.getElementById('pageTitle');
  const sub = document.getElementById('pageSub');
  const banner = document.getElementById('viewingBanner');
  const shareBtn = document.getElementById('shareBtn');
  const stats = document.getElementById('shelfStats');

  if(!viewedProfile){
    if(shelfLoading){
      h1.textContent = ' ';
      sub.textContent = 'Regal wird geladen …';
    } else if(shelfLoadError){
      h1.textContent = 'Regal konnte nicht geladen werden';
      sub.innerHTML = 'Die Verbindung ist gerade gestört. <button type="button" class="link-btn" id="retryLoadBtn">Neu laden</button>';
      document.getElementById('retryLoadBtn').addEventListener('click', loadViewedUserFromURL);
    } else {
      h1.textContent = 'Nutzer nicht gefunden';
      sub.textContent = 'Prüf die Schreibweise oder nutze die Suche oben.';
    }
    banner.classList.add('hidden');
    shareBtn.classList.add('hidden');
    stats.innerHTML = '';
    document.getElementById('appContent').classList.add('hidden');
    return;
  }
  document.getElementById('appContent').classList.remove('hidden');

  const displayName = possessive(shownName(viewedProfile));
  h1.textContent = owner ? 'Mein Regal' : `${displayName} Regal`;
  const since = viewedProfile.created_at
    ? ' · seit ' + new Date(viewedProfile.created_at).toLocaleDateString('de-DE', {month:'long', year:'numeric'})
    : '';
  sub.textContent = '@' + viewedProfile.username + since + (owner && viewedProfile.is_private ? ' · privat, nur per Link' : '');
  shareBtn.classList.remove('hidden');
  document.title = owner ? 'Mein Bücherregal' : `${displayName} Bücherregal`;

  if(owner){
    banner.classList.add('hidden');
  } else {
    const ownButBanned = ownBan && currentUser && viewedProfile.id === currentUser.id;
    banner.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' + (ownButBanned ? 'Konto gesperrt' : 'Nur ansehen');
    banner.classList.remove('hidden');
  }

  const read = readBooks();
  const rated = read.filter(b=>b.rating > 0);
  const avg = rated.length ? (rated.reduce((s,b)=>s+b.rating,0) / rated.length).toLocaleString('de-DE', {minimumFractionDigits:1, maximumFractionDigits:1}) : '–';
  const seriesCount = buildGroups().length;
  stats.innerHTML = `
    <div><dt>Gelesen</dt><dd>${read.length}</dd></div>
    <div><dt>${seriesCount === 1 ? 'Reihe' : 'Reihen'}</dt><dd>${seriesCount}</dd></div>
    <div><dt>Ø Bewertung</dt><dd>${avg}</dd></div>`;
}

async function shareShelfLink(){
  if(!viewedProfile) return;
  const shareUrl = window.location.origin + shelfPath(viewedProfile.username);

  if(navigator.share){
    try { await navigator.share({ title: `${possessive(shownName(viewedProfile))} Bücherregal`, url: shareUrl }); }
    catch(e){ /* Nutzer hat den Teilen-Dialog abgebrochen */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(shareUrl);
    showToast('Link kopiert');
  } catch(e){
    showToast(shareUrl);
  }
}
document.getElementById('shareBtn').addEventListener('click', openShare);

// ---- Teilen: Link oder Story-Bild (Regal bzw. Lesejahr), 1080 × 1920 wie eine Instagram-Story ----
// Gezeichnet im Browser auf einem Canvas. Cover kommen über /api/cover (worker.js) von der eigenen Domain,
// sonst ließe sich das Bild nicht exportieren. Bücher ohne Cover bekommen eine Farbfläche mit Titel.
const shareOverlay = document.getElementById('shareOverlay');
const sharePreview = document.getElementById('sharePreview');
const STORY_W = 1080, STORY_H = 1920;
let shareKind = 'shelf';
let shareBlob = null;
let shareSeq = 0;

function storyYear(){
  const years = readBooks().map(b=>b.date_read && Number(b.date_read.slice(0, 4))).filter(Boolean);
  const now = new Date().getFullYear();
  // Im Januar ist das alte Jahr spannender als drei Bücher im neuen.
  if(years.includes(now) && !(new Date().getMonth() === 0 && years.includes(now - 1))) return now;
  return years.length ? Math.max(...years.filter(y=>y <= now)) : now;
}

function openShare(){
  if(!viewedProfile) return;
  closeToc();
  document.getElementById('shareUrl').textContent = location.host + shelfPath(viewedProfile.username);
  const year = storyYear();
  const yearBtn = document.getElementById('shareYearBtn');
  yearBtn.textContent = `Lesejahr ${year}`;
  yearBtn.classList.toggle('hidden', !readBooks().some(b=>b.date_read && b.date_read.startsWith(String(year))));
  if(yearBtn.classList.contains('hidden')) shareKind = 'shelf';
  syncShareKind();
  shareOverlay.classList.remove('hidden');
  renderSharePreview();
}

function syncShareKind(){
  document.querySelectorAll('[data-share-kind]').forEach(b=>b.setAttribute('aria-pressed', b.getAttribute('data-share-kind') === shareKind));
}

// Bücher fürs Bild: beim Regal Vitrine, dann die bestbewerteten und zuletzt gelesenen; beim Lesejahr alle aus dem Jahr.
function storyBooks(kind, year){
  const read = readBooks();
  if(kind === 'year'){
    return read.filter(b=>b.date_read && b.date_read.startsWith(String(year)))
      .sort((a, b)=>a.date_read.localeCompare(b.date_read));
  }
  const sc = new Set(showcaseBookIds());
  return [...read].sort((a, b)=>
    (sc.has(b.id) - sc.has(a.id)) || (b.rating || 0) - (a.rating || 0) || String(b.date_read || '').localeCompare(String(a.date_read || ''))
  );
}

function loadStoryImage(url){
  return new Promise(resolve=>{
    if(!url || !/^https:\/\/(covers\.openlibrary\.org|books\.google\.com|books\.googleusercontent\.com)\//.test(url)){ resolve(null); return; }
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = ()=>resolve(null);
    img.src = '/api/cover?url=' + encodeURIComponent(url);
  });
}

function cssVar(name, fallback){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

// Text auf eine Breite kürzen, mit „…“.
function fitText(ctx, text, max){
  if(ctx.measureText(text).width <= max) return text;
  while(text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
  return text.trimEnd() + '…';
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawStory(kind){
  const year = storyYear();
  const list = storyBooks(kind, year);
  const shown = list.slice(0, 12);
  // Fehlende Cover erst suchen (höchstens ein paar Sekunden), dann zeichnen.
  await Promise.race([
    Promise.all(shown.map(b=>{ const e = coverCache[coverKey(b)]; return e && e.done ? null : processCover(b); })),
    new Promise(r=>setTimeout(r, 4000)),
  ]);
  await document.fonts.load('800 80px Geist').catch(()=>{});
  const images = await Promise.all(shown.map(b=>{
    const e = coverCache[coverKey(b)];
    return loadStoryImage(e && e.src ? (e.largeOk ? e.srcLarge : largeCoverUrl(e.src)) : null)
      .then(img=>img || (e && e.src ? loadStoryImage(e.src) : null));
  }));

  const canvas = document.createElement('canvas');
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  const wall = cssVar('--wall', '#efeeeb'), ink = cssVar('--ink', '#141414'), dim = cssVar('--dim', '#5e5c58'), accent = cssVar('--red', '#d23a24');
  const font = (w, px)=>`${w} ${px}px Geist, system-ui, sans-serif`;
  const glow = ctx.createLinearGradient(0, 0, 0, STORY_H);
  glow.addColorStop(0, cssVar('--wall-glow', wall));
  glow.addColorStop(1, wall);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // Kopf: Marke, Titel, Zahlen
  const logo = await new Promise(r=>{ const i = new Image(); i.onload = ()=>r(i); i.onerror = ()=>r(null); i.src = document.querySelector('.brand-mark:not(.brand-mark-negativ)').src; });
  if(logo) ctx.drawImage(logo, 80, 96, 56, 48);
  ctx.fillStyle = ink;
  ctx.font = font(700, 38);
  ctx.textBaseline = 'middle';
  ctx.fillText('Bücherregal', logo ? 152 : 80, 122);

  const name = shownName(viewedProfile);
  const title = kind === 'year' ? `${possessive(name)} Lesejahr ${year}` : `${possessive(name)} Regal`;
  ctx.textBaseline = 'alphabetic';
  let size = 104;
  ctx.font = font(800, size);
  while(ctx.measureText(title).width > STORY_W - 160 && size > 60){ size -= 4; ctx.font = font(800, size); }
  ctx.fillText(title, 80, 300);

  const pages = list.reduce((sum, b)=>sum + (b.page_count || ((coverCache[coverKey(b)] || {}).pages) || 0), 0);
  const rated = list.filter(b=>b.rating > 0);
  const avg = rated.length ? (rated.reduce((s, b)=>s + b.rating, 0) / rated.length).toLocaleString('de-DE', { maximumFractionDigits: 1 }) : null;
  const stats = [
    [list.length.toLocaleString('de-DE'), list.length === 1 ? 'Buch' : 'Bücher'],
    pages ? [pages.toLocaleString('de-DE'), 'Seiten'] : null,
    avg ? [avg + ' ★', 'im Schnitt'] : null,
  ].filter(Boolean);
  stats.forEach(([value, label], i)=>{
    const x = 80 + i * 320;
    ctx.fillStyle = kind === 'year' && i === 0 ? accent : ink;
    ctx.font = font(800, 72);
    ctx.fillText(value, x, 440);
    ctx.fillStyle = dim;
    ctx.font = font(500, 32);
    ctx.fillText(label, x, 488);
  });

  // Drei Regalbretter mit je vier Covern
  const cols = 4, coverW = 200, gap = 40, coverH = 300;
  const rowTop = [600, 990, 1380];
  const shelfX = 60, shelfW = STORY_W - 120;
  rowTop.forEach((top, r)=>{
    const row = shown.slice(r * cols, r * cols + cols);
    if(!row.length && r > 0) return;
    const startX = (STORY_W - (cols * coverW + (cols - 1) * gap)) / 2;
    row.forEach((b, i)=>{
      const img = images[r * cols + i];
      const x = startX + i * (coverW + gap);
      const v = bookVisual(b, (shelves.find(s=>s.id === b.shelf_id) || {}).label || b.title);
      const h = img ? Math.min(coverH, Math.round(coverW * img.naturalHeight / img.naturalWidth)) : coverH;
      const y = top + coverH - h;
      ctx.save();
      ctx.shadowColor = 'rgba(20, 20, 20, 0.35)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 14;
      roundRect(ctx, x, y, coverW, h, 6);
      ctx.fillStyle = `rgb(${v.rgb.join(',')})`;
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(ctx, x, y, coverW, h, 6);
      ctx.clip();
      if(img){
        ctx.drawImage(img, x, y, coverW, h);
      } else {
        ctx.fillStyle = isLight(v.rgb) ? '#161616' : '#fafafa';
        ctx.font = font(700, 26);
        const words = b.title.split(/\s+/);
        let line = '', ly = y + 56;
        for(const w of words){
          if(ctx.measureText(line + ' ' + w).width > coverW - 32 && line){ ctx.fillText(line, x + 16, ly); line = w; ly += 32; if(ly > y + h - 60) break; }
          else line = line ? line + ' ' + w : w;
        }
        if(ly <= y + h - 60) ctx.fillText(fitText(ctx, line, coverW - 32), x + 16, ly);
        ctx.font = font(500, 20);
        ctx.fillText(fitText(ctx, b.author || '', coverW - 32), x + 16, y + h - 28);
      }
      ctx.restore();
    });
    // Brett: Oberkante, Vorderseite, Schatten
    const by = top + coverH;
    ctx.fillStyle = 'rgba(20, 20, 20, 0.12)';
    ctx.fillRect(shelfX + 10, by + 34, shelfW - 20, 18);
    const wood = ctx.createLinearGradient(0, by, 0, by + 34);
    wood.addColorStop(0, cssVar('--shelf-top', '#4a4a4c'));
    wood.addColorStop(0.35, cssVar('--shelf-front', '#29292b'));
    wood.addColorStop(1, cssVar('--shelf-front-2', '#141415'));
    ctx.fillStyle = wood;
    roundRect(ctx, shelfX, by, shelfW, 34, 4);
    ctx.fill();
  });

  // Fuß: Lieblingsbuch im Lesejahr, und wo man das Regal findet
  ctx.textBaseline = 'alphabetic';
  if(kind === 'year' && rated.length){
    const fav = [...rated].sort((a, b)=>b.rating - a.rating || b.date_read.localeCompare(a.date_read))[0];
    ctx.fillStyle = dim;
    ctx.font = font(500, 32);
    ctx.fillText('Lieblingsbuch', 80, 1790);
    ctx.fillStyle = ink;
    ctx.font = font(700, 40);
    ctx.fillText(fitText(ctx, fav.title, STORY_W - 160), 80, 1840);
  } else if(list.length > shown.length){
    ctx.fillStyle = dim;
    ctx.font = font(500, 32);
    ctx.fillText(`und ${list.length - shown.length} weitere`, 80, 1820);
  }
  ctx.fillStyle = ink;
  ctx.font = font(600, 34);
  ctx.textAlign = 'right';
  ctx.fillText(location.host + shelfPath(viewedProfile.username), STORY_W - 80, kind === 'year' && rated.length ? 1840 : 1820);
  ctx.textAlign = 'left';

  return new Promise(r=>canvas.toBlob(r, 'image/png'));
}

async function renderSharePreview(){
  const seq = ++shareSeq;
  shareBlob = null;
  document.getElementById('shareImageBtn').disabled = true;
  document.getElementById('shareDownloadBtn').disabled = true;
  sharePreview.innerHTML = '<span class="share-loading">Bild wird gezeichnet …</span>';
  let blob = null;
  try { blob = await drawStory(shareKind); } catch(e){}
  if(seq !== shareSeq) return;
  if(!blob){ sharePreview.innerHTML = '<span class="share-loading">Das Bild ließ sich nicht erstellen.</span>'; return; }
  shareBlob = blob;
  const old = sharePreview.querySelector('img');
  if(old) URL.revokeObjectURL(old.src);
  sharePreview.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="Vorschau des Bildes zum Teilen">`;
  document.getElementById('shareImageBtn').disabled = false;
  document.getElementById('shareDownloadBtn').disabled = false;
}

function shareFileName(){
  return shareKind === 'year' ? `lesejahr-${storyYear()}-${viewedProfile.username}.png` : `regal-${viewedProfile.username}.png`;
}
function downloadShareImage(){
  if(!shareBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(shareBlob);
  a.download = shareFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
document.getElementById('shareImageBtn').addEventListener('click', async ()=>{
  if(!shareBlob) return;
  const file = new File([shareBlob], shareFileName(), { type: 'image/png' });
  if(navigator.canShare && navigator.canShare({ files: [file] })){
    try { await navigator.share({ files: [file], title: document.title }); } catch(e){ /* abgebrochen */ }
    return;
  }
  downloadShareImage();
  showToast('Bild gespeichert');
});
document.getElementById('shareDownloadBtn').addEventListener('click', downloadShareImage);
document.getElementById('shareLinkBtn').addEventListener('click', shareShelfLink);
document.querySelectorAll('[data-share-kind]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(shareKind === btn.getAttribute('data-share-kind')) return;
    shareKind = btn.getAttribute('data-share-kind');
    syncShareKind();
    renderSharePreview();
  });
});
document.getElementById('shareCloseBtn').addEventListener('click', ()=>shareOverlay.classList.add('hidden'));
shareOverlay.addEventListener('click', e=>{ if(e.target === shareOverlay) shareOverlay.classList.add('hidden'); });

// ---- Ansicht (Regal / Cover) ----
const viewButtons = document.querySelectorAll('.seg [data-view]');
function syncViewButtons(){
  viewButtons.forEach(btn=>btn.setAttribute('aria-pressed', btn.getAttribute('data-view') === viewMode));
}
viewButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    viewMode = btn.getAttribute('data-view');
    try { localStorage.setItem(VIEW_KEY, viewMode); } catch(e){}
    syncViewButtons();
    render();
  });
});

const bookIndex = new Map(); // id -> {book, group}

function seriesHeadHtml(group, owner){
  const author = groupAuthor(group);
  const count = group.items.length === 1 ? '1 Band' : `${group.items.length} Bände`;
  const meta = [author, count].filter(Boolean).map(escapeHtml).join(' · ');
  const tags = group.categories.filter(c=>c.id).map(c=>`<span class="cat-tag">${escapeHtml(c.name)}</span>`).join('');
  const edit = owner
    ? `<button type="button" class="icon-btn sm series-edit" data-key="${escapeHtml(group.key)}" data-label="${escapeHtml(group.label)}" aria-label="Reihe „${escapeHtml(group.label)}“ bearbeiten" title="Reihe bearbeiten">${ICON_SLIDERS}</button>`
    : '';
  const lock = group.isPrivate ? `<span class="private-tag" title="Nur du siehst diese Reihe">${ICON_LOCK}Privat</span>` : '';
  return `<header class="series-head"><div class="series-line"><h2 class="series-title">${escapeHtml(group.label)}</h2>${lock}<span class="series-sub"><span class="series-meta">${meta}</span>${edit}</span></div>${tags ? `<div class="cat-tags">${tags}</div>` : ''}</header>`;
}

// Pro Reihe steht genau ein Band frontal: der zuletzt gewählte dieser Reihe, sonst der erste.
function faceOutId(group){
  if(displayedId != null && group.items.some(b=>String(b.id) === String(displayedId))) return String(displayedId);
  const lead = getPref(FACE_KEY, 'first') === 'latest' ? group.items[group.items.length - 1] : group.items[0];
  return String(lead.id);
}

// ---- Vitrine (Premium): erste Reihe im Regal, alle Cover nach vorne ----
const ICON_SPARK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.6 6.1 6.6.6-5 4.4 1.5 6.5L12 16.7 6.3 20.1l1.5-6.5-5-4.4 6.6-.6z"/></svg>';
const SHOWCASE_MAX = 3;
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17 19 7"/></svg>';

function canEditShowcase(){
  return isOwnerView() && (canUsePremium || devPremium());
}

// Löst die gespeicherte Vitrine gegen das geladene Regal auf. Zwei Arten: eine Reihe mit bis zu drei
// gewählten Bänden (shelf_id + book_ids, in Bandfolge) oder bis zu drei einzelne Bücher (nur book_ids,
// in der gewählten Folge). Private Einträge zeigt sie auch dem Besitzer nicht, damit er sie so sieht
// wie alle anderen.
function showcaseEntries(){
  if(!showcase) return null;
  const groups = buildGroups();
  if(showcase.shelf_id){
    const g = groups.find(x=>x.key === showcase.shelf_id && !x.isPrivate);
    const ids = new Set((showcase.book_ids || []).map(String));
    const items = g ? g.items.filter(b=>!b.is_private && ids.has(String(b.id))) : [];
    return items.length ? { series: g, items: items.map(b=>({ b, g })) } : null;
  }
  const items = (showcase.book_ids || []).map(id=>{
    const g = groups.find(x=>!x.isPrivate && x.items.some(b=>String(b.id) === String(id)));
    const b = g && g.items.find(x=>String(x.id) === String(id));
    return b && !b.is_private ? { b, g } : null;
  }).filter(Boolean).slice(0, SHOWCASE_MAX);
  return items.length ? { series: null, items } : null;
}

function vitrineBookHtml(b, group){
  const v = bookVisual(b, group.label);
  const isSel = String(b.id) === String(selectedId);
  const label = group.items.length > 1 ? `${b.title}, Band ${b.series_order}` : b.title;
  const stars = b.rating > 0 ? `<span class="tile-stars">${[1,2,3,4,5].map(i=>starsSVG(i<=b.rating)).join('')}</span>` : '';
  return `<button type="button" class="book vitrine-book open ${v.ink} ${v.has?'has-cover':''} ${v.loading?'is-loading':''} ${isSel?'selected':''}" data-book="${escapeHtml(b.id)}" style="${escapeHtml(visualStyle(v))}" aria-label="${escapeHtml(label)}" aria-pressed="${isSel}">
    <span class="vitrine-light" aria-hidden="true"></span>
    <span class="book-3d">
      <span class="face spine"><span class="spine-title">${escapeHtml(b.title)}</span></span>
      <span class="face front">${genCoverHtml(b, group)}</span>
    </span>
    <span class="vitrine-plaque" aria-hidden="true"><b>${escapeHtml(b.title)}</b>${stars}</span>
  </button>`;
}

function vitrineHtml(sc){
  const n = sc.items.length;
  const title = sc.series
    ? sc.series.label
    : (isOwnerView() ? 'Meine Lieblinge' : `${possessive(shownName(viewedProfile))} Lieblinge`);
  const total = sc.series ? sc.series.items.filter(b=>!b.is_private).length : 0;
  const meta = sc.series
    ? [groupAuthor(sc.series), n === total ? (n === 1 ? '1 Band' : `${n} Bände`) : `${n} von ${total} Bänden`].filter(Boolean).join(' · ')
    : `${n} ${n === 1 ? 'Buch' : 'Bücher'}`;
  return `<section class="vitrine" aria-labelledby="vitrineTitle">
    <header class="vitrine-head">
      <div>
        <span class="vitrine-eyebrow">${ICON_SPARK}Vitrine</span>
        <div class="series-line"><h2 class="series-title" id="vitrineTitle">${escapeHtml(title)}</h2><span class="series-meta">${escapeHtml(meta)}</span></div>
      </div>
    </header>
    <div class="ledge-wrap"><div class="ledge">${sc.items.map(({ b, g })=>vitrineBookHtml(b, g)).join('')}</div></div>
  </section>`;
}

async function saveShowcase(next, message){
  const row = { shelf_id: next.shelf_id || null, book_ids: next.book_ids || [] };
  const empty = !row.book_ids.length; // eine Reihe ohne gewählte Bände zeigt nichts
  let error = null;
  if(devSandboxActive()){
    sandbox.showcase = empty ? null : row;
    saveSandbox();
  } else if(empty){
    ({ error } = await supabaseClient.from('showcases').delete().eq('user_id', currentUser.id));
  } else {
    ({ error } = await supabaseClient.from('showcases').upsert({ user_id: currentUser.id, ...row, updated_at: new Date().toISOString() }));
  }
  if(error){ showToast(dbErrorText(error, 'Vitrine konnte nicht gespeichert werden')); return false; }
  showcase = empty ? null : row;
  resetDirectory();
  render();
  if(message) showToast(message);
  return true;
}

// Die gespeicherte Liste ohne Einträge, die es nicht mehr gibt oder die privat sind.
function showcaseBookIds(){
  const sc = showcaseEntries();
  return sc ? sc.items.map(x=>String(x.b.id)) : [];
}

function showcaseShelfId(){
  return showcase && showcase.shelf_id ? showcase.shelf_id : null;
}

// Ein Band derselben Reihe kommt zu ihr dazu; ein Buch aus einer anderen Reihe stellt die Vitrine auf
// einzelne Bücher um.
function addBookToShowcase(book){
  const shelfId = showcaseShelfId();
  const sameSeries = shelfId === book.shelf_id;
  const switching = shelfId && !sameSeries;
  const ids = switching ? [] : showcaseBookIds();
  if(ids.length >= SHOWCASE_MAX){ showToast(`In der Vitrine ist Platz für ${SHOWCASE_MAX} Bücher`); return; }
  saveShowcase({ shelf_id: sameSeries ? shelfId : null, book_ids: [...ids, String(book.id)] },
    switching ? 'Die Vitrine zeigt jetzt einzelne Bücher' : 'Steht jetzt in der Vitrine');
}

function moveInShowcase(book, delta){
  const ids = showcaseBookIds();
  const i = ids.indexOf(String(book.id));
  const j = i + delta;
  if(i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  saveShowcase({ book_ids: ids }, `Jetzt auf Platz ${j + 1}`);
}

function removeBookFromShowcase(book){
  saveShowcase({ shelf_id: showcaseShelfId(), book_ids: showcaseBookIds().filter(id=>id !== String(book.id)) }, 'Aus der Vitrine genommen');
}

function showcaseControlHtml(book, group){
  if(!isOwnerView() || book.is_private || group.isPrivate) return '';
  // Ohne Premium zeigt die Zeile, dass es die Vitrine gibt, und führt zum Unterstützen-Fenster.
  if(!canEditShowcase()){
    return `<div class="rating-row"><span class="row-label">Vitrine</span><div class="vitrine-ctl"><button type="button" class="btn btn-secondary vitrine-locked">${ICON_SPARK}In die Vitrine</button><small class="vitrine-full">Für Supporter</small></div></div>`;
  }
  const shelfId = showcaseShelfId();
  const ids = showcaseBookIds();
  const i = ids.indexOf(String(book.id));
  let body;
  if(i >= 0 && shelfId){
    // Bände einer Reihe stehen in Bandfolge; da gibt es nichts zu verschieben.
    body = `<span class="vitrine-pos">Steht drin</span><button type="button" class="link-btn vitrine-remove">Herausnehmen</button>`;
  } else if(i >= 0){
    body = `<span class="vitrine-pos">Platz ${i + 1} von ${ids.length}</span>
      <button type="button" class="icon-btn sm vitrine-move" data-move="-1" aria-label="Weiter nach vorne" title="Weiter nach vorne" ${i === 0 ? 'disabled' : ''}>‹</button>
      <button type="button" class="icon-btn sm vitrine-move" data-move="1" aria-label="Weiter nach hinten" title="Weiter nach hinten" ${i === ids.length - 1 ? 'disabled' : ''}>›</button>
      <button type="button" class="link-btn vitrine-remove">Herausnehmen</button>`;
  } else {
    const otherSeries = shelfId && shelfId !== group.key && ids.length;
    const full = !otherSeries && ids.length >= SHOWCASE_MAX;
    const otherLabel = otherSeries ? ((shelves.find(s=>s.id === shelfId) || {}).label || '') : '';
    const note = full ? `Voll (${SHOWCASE_MAX} ${shelfId ? 'Bände' : 'Bücher'})` : otherSeries ? `Ersetzt „${escapeHtml(otherLabel)}“` : '';
    body = `<button type="button" class="btn btn-secondary vitrine-add" ${full ? 'disabled' : ''}>${ICON_SPARK}In die Vitrine</button>${note ? `<small class="vitrine-full">${note}</small>` : ''}`;
  }
  return `<div class="rating-row"><span class="row-label">Vitrine</span><div class="vitrine-ctl">${body}</div></div>`;
}

const PRIVATE_BADGE = `<span class="private-badge" title="Nur du siehst dieses Buch">${ICON_LOCK}</span>`;

// ---- Lesestatus: gelesen, lese ich gerade, will ich lesen (books.status, supabase/024_reading_status.sql) ----
const STATUS_LABELS = { read: 'Gelesen', reading: 'Lese ich gerade', want: 'Will ich lesen' };
const STATUS_FILTERS = { read: 'Gelesen', reading: 'Lese gerade', want: 'Merkliste' };
function bookStatus(b){
  return b.status === 'reading' || b.status === 'want' ? b.status : 'read';
}
const readBooks = ()=>books.filter(b=>bookStatus(b) === 'read');
function statusMarkHtml(b){
  const st = bookStatus(b);
  if(st === 'read') return '';
  return `<span class="status-mark status-mark-${st}" title="${STATUS_LABELS[st]}"></span>`;
}
function todayIso(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bookHtml(b, group){
  const v = bookVisual(b, group.label);
  const isSel = String(b.id) === String(selectedId);
  const isOut = faceOutId(group) === String(b.id);
  const multi = group.items.length > 1;
  const st = bookStatus(b);
  const label = (multi ? `${b.title}, Band ${b.series_order}` : b.title) + (st === 'read' ? '' : ` (${STATUS_LABELS[st]})`);
  return `<button type="button" class="book status-${st} ${v.ink} ${v.has?'has-cover':''} ${v.loading?'is-loading':''} ${v.emblem?'has-emblem':''} ${isOut?'open':''} ${isSel?'selected':''}" data-book="${escapeHtml(b.id)}" style="${escapeHtml(visualStyle(v))}" aria-label="${escapeHtml(label)}" aria-pressed="${isSel}">
    <span class="book-3d">
      <span class="face spine"><span class="spine-emblem"></span><span class="spine-title">${escapeHtml(b.title)}</span><span class="spine-no">${multi ? b.series_order : ''}</span>${statusMarkHtml(b)}</span>
      <span class="face front">${genCoverHtml(b, group)}${statusMarkHtml(b)}</span>
    </span>
    ${b.is_private ? PRIVATE_BADGE : ''}
  </button>`;
}

function tileHtml(b, group){
  const v = bookVisual(b, group.label);
  const isSel = String(b.id) === String(selectedId);
  const multi = group.items.length > 1;
  const stars = b.rating > 0 ? `<span class="tile-stars" aria-label="${b.rating} von 5 Sternen">${[1,2,3,4,5].map(i=>starsSVG(i<=b.rating)).join('')}</span>` : '';
  const st = bookStatus(b);
  return `<button type="button" class="tile status-${st} ${v.ink} ${v.has?'has-cover':''} ${v.loading?'is-loading':''} ${isSel?'open':''}" data-book="${escapeHtml(b.id)}" style="${escapeHtml(visualStyle(v))}" aria-pressed="${isSel}">
    <span class="tile-cover">${genCoverHtml(b, group)}${statusMarkHtml(b)}${b.is_private ? PRIVATE_BADGE : ''}</span>
    <span class="tile-title">${escapeHtml(b.title)}</span>
    <span class="tile-meta">${st === 'read' ? '' : `${STATUS_FILTERS[st]} · `}${multi ? `Band ${b.series_order}` : escapeHtml(b.author || 'Einzelband')}</span>
    ${stars}
  </button>`;
}

function render(){
  const owner = isOwnerView();
  document.getElementById('devBanner').classList.toggle('hidden', !devSandboxActive());
  document.getElementById('devBannerWho').textContent = devAs === DEFAULT_USERNAME ? 'Antonios Regal (mit Premium)' : `@${devAs} (ohne Premium)`;
  renderAuthUI();
  renderHeader(owner);
  renderFollowButtons();
  syncViewButtons();
  document.getElementById('headerActions').classList.toggle('hidden', !owner);
  // Regal scannen ist Premium, der Knopf ist aber für alle da: ohne Premium führt er zum Unterstützen-Fenster.
  document.getElementById('openScanBtn').classList.toggle('is-locked', !hasPremium());

  const container = document.getElementById('shelves');
  container.classList.toggle('grid-mode', viewMode === 'grid');
  bookIndex.clear();

  if(!viewedProfile){
    document.getElementById('filterBar').innerHTML = '';
    container.innerHTML = '';
    lastGroups = [];
    updateToc([]);
    updateBookDetailPanel();
    return;
  }

  renderFilterBar();
  renderReadingNow(owner);

  if(books.length === 0){
    container.innerHTML = owner
      ? '<div class="empty-state"><p>Dein Regal ist noch leer. Stell mit „+ Buch“ dein erstes Buch hinein.</p><p><button type="button" class="btn btn-secondary" id="emptyImportBtn">Aus Goodreads oder StoryGraph importieren</button></p></div>'
      : '<div class="empty-state"><p>Dieses Regal ist noch leer.</p></div>';
    const importBtn = document.getElementById('emptyImportBtn');
    if(importBtn) importBtn.addEventListener('click', openImport);
    lastGroups = [];
    updateToc([]);
    updateBookDetailPanel();
    return;
  }

  let groups = buildGroups();
  if(activeCategory){
    groups = groups.filter(g=>g.categories.some(c=>c.name===activeCategory));
  }
  if(activeStatus){
    groups = groups
      .map(g=>({ ...g, items: g.items.filter(b=>bookStatus(b) === activeStatus) }))
      .filter(g=>g.items.length);
  }
  const q = searchQuery.trim().toLowerCase();
  if(q){
    groups = groups.filter(g=>
      g.label.toLowerCase().includes(q) ||
      g.items.some(b=>b.title.toLowerCase().includes(q))
    );
  }
  lastGroups = groups;
  groups.forEach(g=>g.items.forEach(b=>bookIndex.set(String(b.id), {book:b, group:g})));

  if(groups.length === 0){
    container.innerHTML = q
      ? '<div class="empty-state"><p>Keine Treffer für „' + escapeHtml(searchQuery.trim()) + '“.</p></div>'
      : `<div class="empty-state"><p>Keine Bücher ${activeStatus && activeCategory ? 'mit diesem Status in dieser Kategorie' : activeStatus ? 'mit diesem Status' : 'in dieser Kategorie'}.</p></div>`;
    updateToc([]);
    updateBookDetailPanel();
    return;
  }

  const sc = !q && !activeCategory && !activeStatus ? showcaseEntries() : null;
  container.innerHTML = (sc ? vitrineHtml(sc) : '') + groups.map(group=>{
    const body = viewMode === 'grid'
      ? `<div class="tile-grid">${group.items.map(b=>tileHtml(b, group)).join('')}</div>`
      : `<div class="ledge-wrap"><div class="ledge">${group.items.map(b=>bookHtml(b, group)).join('')}</div></div>`;
    return `<section class="series" id="shelf-${escapeHtml(group.key)}">${seriesHeadHtml(group, owner)}${body}</section>`;
  }).join('');

  container.querySelectorAll('[data-book]').forEach(el=>{
    el.addEventListener('click', ()=>selectBook(el.getAttribute('data-book')));
  });

  if(owner){
    container.querySelectorAll('.series-edit').forEach(el=>{
      el.addEventListener('click', ()=>{
        openShelfCatModal(el.getAttribute('data-key'), el.getAttribute('data-label'));
      });
    });
  }

  updateToc(groups);
  updateBookDetailPanel();
  queueCovers((sc ? sc.items.map(x=>x.b) : []).concat(groups.flatMap(g=>g.items)));
  scheduleFit();
}

// „Lese ich gerade“: die angefangenen Bücher als kleine Leiste unter dem Kopf, ein Klick öffnet das Buch.
function renderReadingNow(owner){
  const el = document.getElementById('readingNow');
  const list = viewedProfile ? books.filter(b=>bookStatus(b) === 'reading') : [];
  el.classList.toggle('hidden', !list.length);
  if(!list.length){ el.innerHTML = ''; return; }
  const who = owner ? 'Lese ich gerade' : `${escapeHtml(shownName(viewedProfile))} liest gerade`;
  el.innerHTML = `<span class="reading-now-label">${who}</span>` + list.slice(0, 4).map(b=>{
    const g = { label: (shelves.find(s=>s.id === b.shelf_id) || {}).label || b.title, items: [b] };
    return `<button type="button" class="reading-now-book" data-reading="${escapeHtml(b.id)}">${thumbHtml(b, g)}<span><b>${escapeHtml(b.title)}</b><small>${escapeHtml(b.author || '')}</small></span></button>`;
  }).join('');
  el.querySelectorAll('[data-reading]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-reading');
      if(activeStatus && activeStatus !== 'reading') activeStatus = null;
      if(!bookIndex.has(String(id))){ activeCategory = null; searchQuery = ''; document.getElementById('searchInput').value = ''; render(); }
      selectBook(id);
      const target = document.querySelector(`#shelves [data-book="${CSS.escape(String(id))}"]`);
      if(target) revealAfterTurn(target);
    });
  });
}

// Rückentitel dürfen nie über den Buchrand laufen: lange Titel werden schrittweise kleiner gesetzt.
let fitFrame = 0;
function scheduleFit(){
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(()=>{
    document.querySelectorAll('#shelves .spine-title, #heroShelf .spine-title, #demoTurn .spine-title, #demoScan .spine-title').forEach(t=>{
      t.style.fontSize = '';
      let size = parseFloat(getComputedStyle(t).fontSize);
      while(t.scrollWidth > t.clientWidth + 1 && size > 9){
        size -= 0.5;
        t.style.fontSize = size + 'px';
      }
    });
    updateFilterFade();
  });
}

function updateFilterFade(){
  const bar = document.getElementById('filterBar');
  const overflowing = bar.scrollWidth > bar.clientWidth + 1;
  const atEnd = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 2;
  bar.classList.toggle('fade-end', overflowing && !atEnd);
}
document.getElementById('filterBar').addEventListener('scroll', updateFilterFade, { passive: true });
new ResizeObserver(scheduleFit).observe(document.getElementById('appContent'));

function selectBook(id){
  selectedId = String(selectedId) === String(id) ? null : id;
  displayedId = id;
  editingBookId = null;
  closeToc();
  syncSelection(id);
}

// Auswahl ohne kompletten Neuaufbau, damit die Dreh-Animation der Buchrücken sichtbar bleibt.
function syncSelection(revealId){
  document.querySelectorAll('#shelves [data-book]').forEach(el=>{
    const id = String(el.getAttribute('data-book'));
    const isSel = id === String(selectedId);
    el.setAttribute('aria-pressed', isSel);
    if(!el.classList.contains('book')){
      el.classList.toggle('open', isSel);
      return;
    }
    if(el.classList.contains('vitrine-book')){
      el.classList.toggle('selected', isSel);
      return;
    }
    const meta = bookIndex.get(id);
    const out = meta ? faceOutId(meta.group) === id : false;
    el.classList.toggle('open', out);
    el.classList.toggle('selected', isSel);
    if(isSel && revealId != null && String(revealId) === id) revealAfterTurn(el);
  });
  updateBookDetailPanel();
}

// Erst nach Ende der Breiten-Animation scrollen, sonst wird noch die schmale Rückenbox gemessen.
function revealAfterTurn(el){
  let done = false;
  const go = ()=>{
    if(done) return;
    done = true;
    el.removeEventListener('transitionend', onEnd);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest', inline: 'nearest' });
  };
  const onEnd = e=>{ if(e.target === el && e.propertyName === 'width') go(); };
  el.addEventListener('transitionend', onEnd);
  setTimeout(go, 750);
}

function closeDetail(){
  selectedId = null;
  editingBookId = null;
  syncSelection();
}

// Im Bearbeitungsmodus: Vorschlag, fehlende Seitenzahl und fehlenden Klappentext automatisch einzufügen.
function missingDetailsHtml(book){
  const noPages = !book.page_count, noSummary = !book.summary;
  if(!noPages && !noSummary) return '';
  const what = noPages && noSummary ? 'Seitenzahl und Klappentext fehlen' : noPages ? 'Die Seitenzahl fehlt' : 'Der Klappentext fehlt';
  return `<p class="fill-missing"><span>${what} noch.</span><button type="button" class="btn btn-secondary fill-missing-btn">Automatisch einfügen</button></p>`;
}

function buildDetailCard(book, group, owner){
  const wrap = document.createElement('div');
  wrap.className = 'detail';
  const v = bookVisual(book, group.label);
  const multi = group.items.length > 1;
  const metaParts = [book.author, multi ? `Band ${book.series_order} · ${group.label}` : null].filter(Boolean);
  const isEditing = owner && editingBookId === book.id;
  const pagesText = v.pages ? `${v.pagesEstimated ? 'ca. ' : ''}${v.pages.toLocaleString('de-DE')} Seiten` : '';

  const starsHtml = owner
    ? [1,2,3,4,5].map(i=>`<button type="button" class="star-btn" data-star="${i}" aria-label="${i} ${i===1?'Stern':'Sterne'}">${starsSVG(i<=book.rating)}</button>`).join('')
    : `<span aria-label="${book.rating} von 5 Sternen" style="display:flex;gap:2px">${[1,2,3,4,5].map(i=>starsSVG(i<=book.rating)).join('')}</span>`;

  const categoryBlockHtml = owner
    ? `<div class="detail-block"><span class="row-label">Kategorien der Reihe</span>
         <div class="cat-toggle-list f-shelf-category-list"></div>
         <small>Gilt für alle Bände von „${escapeHtml(group.label)}“.</small>
       </div>`
    : `<p class="detail-row"><span class="row-label">Kategorien</span><span class="row-value">${escapeHtml(group.categories.map(c=>c.name).join(', '))}</span></p>`;

  const st = bookStatus(book);
  const statusBlockHtml = owner
    ? `<div class="rating-row"><span class="row-label">Status</span><div class="seg seg-status" role="group" aria-label="Lesestatus">
         ${Object.keys(STATUS_LABELS).map(k=>`<button type="button" data-book-status="${k}" aria-pressed="${st === k}">${STATUS_FILTERS[k] === 'Merkliste' ? 'Will ich lesen' : STATUS_FILTERS[k]}</button>`).join('')}
       </div></div>`
    : (st === 'read' ? '' : `<p class="detail-row"><span class="row-label">Status</span><span class="row-value">${STATUS_LABELS[st]}</span></p>`);

  const dateBlockHtml = st !== 'read' ? '' : owner
    ? `<label class="detail-row"><span class="row-label">Gelesen am</span><span class="date-field ${book.date_read ? '' : 'is-empty'}"><input type="date" class="f-date" value="${escapeHtml(book.date_read||'')}"><span class="date-placeholder" aria-hidden="true">Datum wählen</span></span></label>`
    : (book.date_read ? `<p class="detail-row"><span class="row-label">Gelesen am</span><span class="row-value">${escapeHtml(formatDate(book.date_read))}</span></p>` : '');

  // Ist die ganze Reihe privat, gibt es pro Buch nichts zu schalten; umgestellt wird dann an der Reihe.
  const privacyBlockHtml = !owner ? '' : group.isPrivate
    ? `<p class="detail-row"><span class="row-label">Sichtbarkeit</span><span class="row-value">Privat, wie die ganze Reihe</span></p>`
    : `<div class="rating-row"><span class="row-label">Sichtbarkeit</span><div class="seg" role="group" aria-label="Sichtbarkeit des Buchs">
         <button type="button" data-book-privacy="public" aria-pressed="${!book.is_private}">Öffentlich</button>
         <button type="button" data-book-privacy="private" aria-pressed="${!!book.is_private}">Privat</button>
       </div></div>`;

  // Seitenzahl und Klappentext ändert der Besitzer nur im Bearbeitungsmodus (Stift), dort stehen sie bei Titel und Autor.
  const pagesBlockHtml = !isEditing && pagesText
    ? `<p class="detail-row"><span class="row-label">Umfang</span><span class="row-value">${escapeHtml(pagesText)}</span></p>`
    : '';

  const summaryBlockHtml = !isEditing && book.summary
    ? `<div class="detail-block"><span class="row-label">Klappentext</span><p class="detail-text">${escapeHtml(book.summary)}</p></div>`
    : '';

  const notesBlockHtml = owner
    ? `<label class="detail-block"><span class="row-label">Notizen</span><textarea class="f-notes" rows="3" placeholder="Deine Gedanken zum Buch …">${escapeHtml(book.notes||'')}</textarea></label>`
    : (book.notes ? `<div class="detail-block"><span class="row-label">Notizen</span><p class="detail-note">${escapeHtml(book.notes)}</p></div>` : '');

  const actionsHtml = owner
    ? `<div class="detail-actions"><button type="button" class="btn btn-ghost btn-danger remove-btn">Aus dem Regal entfernen</button></div>`
    : '';

  const titleBlockHtml = isEditing
    ? `<div class="detail-edit-fields">
         <label class="field"><span>Titel</span><input type="text" class="f-edit-title" value="${escapeHtml(book.title)}"></label>
         <label class="field"><span>Autor:in</span><input type="text" class="f-edit-author" value="${escapeHtml(book.author||'')}"></label>
         ${missingDetailsHtml(book)}
         <label class="field"><span>Seitenzahl</span><input type="number" class="f-pages" min="1" inputmode="numeric" placeholder="${v.pages && v.pagesEstimated ? 'ca. ' + v.pages : 'optional'}" value="${book.page_count||''}"></label>
         <label class="field"><span>Klappentext</span><textarea class="f-summary" rows="5" placeholder="Worum geht's? (optional)">${escapeHtml(book.summary||'')}</textarea></label>
         <div class="detail-edit-actions">
           <button type="button" class="btn btn-ghost cancel-edit-btn">Abbrechen</button>
           <button type="button" class="btn btn-primary save-edit-btn">Speichern</button>
         </div>
       </div>`
    : `<h2 class="detail-title">${escapeHtml(book.title)}</h2>
       <p class="detail-meta">${escapeHtml(metaParts.join(' · '))}</p>`;

  wrap.innerHTML = `
    <div class="detail-hero" style="--c:${v.rgb.join(',')}">
      <div class="detail-hero-actions">
        ${owner && !isEditing ? `<button type="button" class="icon-btn cover-btn" aria-label="Cover ändern" title="Cover ändern">${ICON_IMAGE}</button><button type="button" class="icon-btn edit-btn" aria-label="Buch bearbeiten" title="Bearbeiten">${ICON_EDIT}</button>` : ''}
        <button type="button" class="icon-btn close-x" aria-label="Schließen">${ICON_CLOSE}</button>
      </div>
      <div class="detail-cover ${v.ink} ${v.has?'has-cover':''} ${v.loading?'is-loading':''}" data-book="${escapeHtml(book.id)}" style="${escapeHtml(visualStyle(v, true))}" role="button" tabindex="0" aria-label="Cover vergrößern">${genCoverHtml(book, group)}</div>
    </div>
    <div class="detail-body">
      ${titleBlockHtml}
      <div class="detail-rows">
        ${statusBlockHtml}
        ${st === 'want' && !book.rating ? '' : `<div class="rating-row"><span class="row-label">Bewertung</span><div class="stars">${starsHtml}</div></div>`}
        ${dateBlockHtml}
        ${privacyBlockHtml}
        ${showcaseControlHtml(book, group)}
        ${pagesBlockHtml}
        ${categoryBlockHtml}
        ${summaryBlockHtml}
        ${notesBlockHtml}
      </div>
      ${actionsHtml}
    </div>
  `;

  wrap.querySelector('.close-x').addEventListener('click', closeDetail);

  const coverEl = wrap.querySelector('.detail-cover');
  verifyLargeCover(book);
  coverEl.addEventListener('click', ()=>openCoverZoom(book, group));
  coverEl.addEventListener('keydown', e=>{
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openCoverZoom(book, group); }
  });

  if(owner){
    renderCategoryToggleList(wrap.querySelector('.f-shelf-category-list'), group.key, group.categoryIds);

    const coverBtn = wrap.querySelector('.cover-btn');
    if(coverBtn) coverBtn.addEventListener('click', ()=>openCoverModal(book));

    // Fehlende Seitenzahl / fehlenden Klappentext nur in die leeren Felder setzen; gespeichert wird mit „Speichern“.
    const fillBtn = wrap.querySelector('.fill-missing-btn');
    if(fillBtn) fillBtn.addEventListener('click', async ()=>{
      const pagesInput = wrap.querySelector('.f-pages');
      const summaryInput = wrap.querySelector('.f-summary');
      const wantPages = !pagesInput.value.trim();
      const wantSummary = !summaryInput.value.trim();
      const hint = wrap.querySelector('.fill-missing');
      if(!wantPages && !wantSummary){ hint.remove(); return; }
      fillBtn.disabled = true;
      fillBtn.textContent = 'Suche …';
      const found = await findBookDetails(book.title, book.author, { pages: wantPages, description: wantSummary });
      if(!fillBtn.isConnected) return;
      // Keine Seitenzahl gefunden: die Schätzung aus der Cover-Suche übernehmen.
      const pages = found.pages || (wantPages && v.pagesEstimated ? v.pages : null);
      if(wantPages && pages) pagesInput.value = pages;
      if(wantSummary && found.description) summaryInput.value = found.description;
      const missing = [wantPages && !pages && 'Seitenzahl', wantSummary && !found.description && 'Klappentext'].filter(Boolean);
      if(missing.length === (wantPages + wantSummary)){
        showToast('Leider nichts gefunden');
        fillBtn.disabled = false;
        fillBtn.textContent = 'Automatisch einfügen';
        return;
      }
      hint.innerHTML = `<span>${missing.length ? `Eingefügt, aber ${missing[0] === 'Seitenzahl' ? 'keine Seitenzahl' : 'kein Klappentext'} gefunden.` : 'Eingefügt.'} Prüfen und speichern.</span>`;
    });

    if(isEditing){
      wrap.querySelector('.cancel-edit-btn').addEventListener('click', ()=>{ editingBookId = null; updateBookDetailPanel(); });
      wrap.querySelector('.save-edit-btn').addEventListener('click', async ()=>{
        const titleInput = wrap.querySelector('.f-edit-title');
        const authorInput = wrap.querySelector('.f-edit-author');
        const pagesInput = wrap.querySelector('.f-pages');
        const newTitle = titleInput.value.trim();
        if(!newTitle){ showToast('Bitte einen Titel eingeben'); titleInput.focus(); return; }
        const newAuthor = authorInput.value.trim();
        const pagesVal = pagesInput.value.trim();
        const pageCount = pagesVal ? parseInt(pagesVal, 10) : null;
        if(pagesVal && !(pageCount > 0)){ showToast('Seitenzahl muss größer als 0 sein'); pagesInput.focus(); return; }
        const summary = wrap.querySelector('.f-summary').value.trim() || null;
        const { error } = await db('books').update({ title: newTitle, author: newAuthor, page_count: pageCount, summary }).eq('id', book.id);
        if(error){ showToast('Fehler beim Speichern'); return; }
        editingBookId = null;
        await refreshAndRender();
        showToast('Änderungen gespeichert');
      });
      setTimeout(()=>wrap.querySelector('.f-edit-title').focus(), 50);
    } else {
      wrap.querySelector('.edit-btn').addEventListener('click', ()=>{ editingBookId = book.id; updateBookDetailPanel(); });
    }

    wrap.querySelectorAll('.star-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const val = parseInt(btn.getAttribute('data-star'),10);
        const newRating = (book.rating === val) ? 0 : val;
        const { error } = await db('books').update({rating: newRating}).eq('id', book.id);
        if(error){ showToast('Fehler beim Speichern'); return; }
        await refreshAndRender();
      });
    });
    wrap.querySelectorAll('[data-book-status]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const next = btn.getAttribute('data-book-status');
        if(next === st) return;
        // Fertig gelesen: ohne Datum gilt heute.
        const patch = { status: next };
        if(next === 'read' && !book.date_read) patch.date_read = todayIso();
        const { error } = await db('books').update(patch).eq('id', book.id);
        if(error){ showToast('Fehler beim Speichern'); return; }
        await refreshAndRender();
        showToast(next === 'read' ? 'Als gelesen eingetragen' : next === 'reading' ? 'Steht jetzt bei „Lese ich gerade“' : 'Steht jetzt auf der Merkliste');
      });
    });
    const dateInput = wrap.querySelector('.f-date');
    if(dateInput) dateInput.addEventListener('input', e=>{
      e.target.parentElement.classList.toggle('is-empty', !e.target.value);
    });
    if(dateInput) dateInput.addEventListener('change', async (e)=>{
      const { error } = await db('books').update({date_read: e.target.value || null}).eq('id', book.id);
      if(error){ showToast('Fehler beim Speichern'); return; }
      await refreshAndRender();
    });
    const addBtn = wrap.querySelector('.vitrine-add');
    if(addBtn) addBtn.addEventListener('click', ()=>addBookToShowcase(book));
    const lockedBtn = wrap.querySelector('.vitrine-locked');
    if(lockedBtn) lockedBtn.addEventListener('click', ()=>openSupport('vitrine'));
    wrap.querySelectorAll('.vitrine-move').forEach(btn=>{
      btn.addEventListener('click', ()=>moveInShowcase(book, parseInt(btn.getAttribute('data-move'), 10)));
    });
    const outBtn = wrap.querySelector('.vitrine-remove');
    if(outBtn) outBtn.addEventListener('click', ()=>removeBookFromShowcase(book));
    wrap.querySelectorAll('[data-book-privacy]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const priv = btn.getAttribute('data-book-privacy') === 'private';
        if(priv === !!book.is_private) return;
        const { error } = await db('books').update({ is_private: priv }).eq('id', book.id);
        if(error){ showToast('Fehler beim Speichern'); return; }
        await refreshAndRender();
        showToast(priv ? 'Nur du siehst dieses Buch' : 'Buch ist wieder öffentlich');
      });
    });
    wrap.querySelector('.f-notes').addEventListener('change', async (e)=>{
      const { error } = await db('books').update({notes: e.target.value}).eq('id', book.id);
      if(error){ showToast('Fehler beim Speichern'); return; }
      await refreshAndRender();
    });
    wrap.querySelector('.remove-btn').addEventListener('click', async ()=>{
      const { error } = await db('books').delete().eq('id', book.id);
      if(error){ showToast('Fehler beim Entfernen'); return; }
      const remaining = books.filter(b=>b.shelf_id===book.shelf_id && b.id!==book.id).length;
      if(remaining === 0){
        await db('shelves').delete().eq('id', book.shelf_id);
      }
      selectedId = null;
      editingBookId = null;
      await refreshAndRender();
      showToast('Buch entfernt');
    });
  }

  return wrap;
}

// ---- Reihen-Auswahl: Freitext plus aufklappbare Liste der vorhandenen Reihen ----
// Ersetzt <datalist>, das Safari und Handys kaum sichtbar anzeigen.
const ICON_CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
let seriesComboSeq = 0;

function mountSeriesCombo(input){
  if(input.closest('.combo')) return;
  const id = 'series-combo-' + (++seriesComboSeq);
  const wrap = document.createElement('div');
  wrap.className = 'combo';
  input.replaceWith(wrap);
  wrap.append(input);
  wrap.insertAdjacentHTML('beforeend', `<button type="button" class="combo-toggle" tabindex="-1" aria-label="Vorhandene Reihen anzeigen">${ICON_CHEVRON}</button>
    <div class="suggest-list combo-list hidden" id="${id}" role="listbox" aria-label="Vorhandene Reihen"></div>`);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', id);
  const list = wrap.querySelector('.combo-list');
  const toggle = wrap.querySelector('.combo-toggle');
  let items = [], active = -1;

  const isOpen = ()=>!list.classList.contains('hidden');
  const close = ()=>{
    list.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const render = ()=>{
    const typed = input.value.trim();
    const exact = items.some(g=>g.label.toLowerCase() === typed.toLowerCase());
    list.innerHTML = items.map((g, i)=>{
      const meta = [g.items[0].author, g.items.length > 1 ? `${g.items.length} Bände` : 'Einzelband'].filter(Boolean).join(' · ');
      return `<button type="button" role="option" id="${id}-${i}" class="suggest-item combo-item ${i === active ? 'is-active' : ''}" data-i="${i}" aria-selected="${i === active}">
        ${thumbHtml(g.items[0], g)}
        <span class="suggest-text"><span class="suggest-title">${escapeHtml(g.label)}</span><span class="suggest-meta">${escapeHtml(meta)}</span></span>
      </button>`;
    }).join('') + (typed && !exact ? `<p class="suggest-empty">„${escapeHtml(typed)}“ wird als neue Reihe angelegt.</p>` : '');
    list.querySelectorAll('.combo-item').forEach(btn=>{
      btn.addEventListener('mousedown', e=>e.preventDefault()); // Fokus bleibt im Feld
      btn.addEventListener('click', ()=>pick(items[+btn.getAttribute('data-i')]));
    });
    if(active >= 0){
      input.setAttribute('aria-activedescendant', `${id}-${active}`);
      list.querySelector('.is-active').scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
    list.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  };
  // Beim Tippen wird gefiltert; über den Pfeil oder bei einer schon gewählten Reihe stehen alle zur Auswahl.
  const open = (filter)=>{
    const q = filter ? input.value.trim().toLowerCase() : '';
    const series = new Set(shelves.filter(s=>s.is_series).map(s=>s.id));
    items = buildGroups()
      .filter(g=>series.has(g.key) && g.label.toLowerCase().includes(q))
      .sort((a, b)=>(b.label.toLowerCase().startsWith(q) - a.label.toLowerCase().startsWith(q)) || a.label.localeCompare(b.label, 'de'));
    active = -1;
    if(items.length) render(); else close();
  };
  const pick = (g)=>{
    input.value = g.label;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  };
  const openAll = ()=>{
    const v = input.value.trim().toLowerCase();
    open(!!v && !shelves.some(s=>s.is_series && s.label.toLowerCase() === v));
  };

  input.addEventListener('input', ()=>open(true));
  input.addEventListener('click', ()=>{ if(!isOpen()) openAll(); });
  input.addEventListener('blur', ()=>setTimeout(close, 150));
  input.addEventListener('keydown', e=>{
    if(!isOpen()){
      if(e.key === 'ArrowDown'){ e.preventDefault(); openAll(); }
      return;
    }
    if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); }
    else if(e.key === 'ArrowDown'){ e.preventDefault(); active = (active + 1) % items.length; render(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
    else if(e.key === 'Enter' && active >= 0){ e.preventDefault(); pick(items[active]); }
  });
  toggle.addEventListener('mousedown', e=>e.preventDefault());
  toggle.addEventListener('click', ()=>{
    if(isOpen()){ close(); return; }
    input.focus();
    open(false);
  });
}

// ---- Add-book modal ----
const overlay = document.getElementById('modalOverlay');
const seriesInput = document.getElementById('f-series');
mountSeriesCombo(seriesInput);
const categoryListEl = document.getElementById('f-category-list');
const categoryHint = document.getElementById('f-category-hint');
const authorInput = document.getElementById('f-author');
const titleInput = document.getElementById('f-title');
const suggestBox = document.getElementById('addSuggest');
const addPreview = document.getElementById('addPreview');
let addBookSelectedCategoryIds = new Set();
let addSuggestedCatIds = new Set();
let addFreshGenres = [];

function existingSeriesShelf(){
  const v = seriesInput.value.trim().toLowerCase();
  return v ? shelves.find(s=>s.is_series && s.label.toLowerCase() === v) : null;
}

const moreGenresEl = document.getElementById('f-more-genres');
const moreGenresList = document.getElementById('f-more-genres-list');

// Alle bekannten Genres, für die es noch keine Kategorie gibt und die nicht schon vorgeschlagen sind.
function renderMoreGenres(){
  const have = new Set(categories.map(c=>genreOfCategory(c.name)));
  const rest = GENRE_RULES.map(r=>r.name)
    .filter(n=>!have.has(n) && !addFreshGenres.includes(n))
    .sort((a, b)=>a.localeCompare(b, 'en'));
  moreGenresEl.classList.toggle('hidden', !rest.length);
  moreGenresEl.querySelector('summary').textContent = `Weitere Genres (${rest.length})`;
  moreGenresList.innerHTML = rest.map(g=>
    `<button type="button" class="cat-toggle cat-new" data-genre="${escapeHtml(g)}" title="Als neue Kategorie anlegen">+ ${escapeHtml(g)}</button>`).join('');
  moreGenresList.querySelectorAll('.cat-new').forEach(btn=>{
    btn.addEventListener('click', ()=>createCategoryFromGenre(btn.getAttribute('data-genre'), btn));
  });
}

function updateCategoryFieldForSeries(){
  const existingShelf = existingSeriesShelf();
  if(existingShelf){
    renderCategoryPickerList(categoryListEl, new Set(existingShelf.categoryIds), true);
    categoryHint.textContent = 'Übernommen von der bestehenden Reihe „' + existingShelf.label + '“.';
    moreGenresEl.classList.add('hidden');
    return;
  }
  renderMoreGenres();
  renderCategoryPickerList(categoryListEl, addBookSelectedCategoryIds, false);
  if(addFreshGenres.length){
    const empty = categoryListEl.querySelector('.cat-toggle-empty');
    if(empty) empty.remove();
    categoryListEl.insertAdjacentHTML('beforeend', addFreshGenres.map(g=>
      `<button type="button" class="cat-toggle cat-new" data-genre="${escapeHtml(g)}" title="Als neue Kategorie anlegen">+ ${escapeHtml(g)}</button>`).join(''));
    categoryListEl.querySelectorAll('.cat-new').forEach(btn=>{
      btn.addEventListener('click', ()=>createCategoryFromGenre(btn.getAttribute('data-genre'), btn));
    });
  }
  categoryHint.textContent = addSuggestedCatIds.size || addFreshGenres.length
    ? 'Nach den Genres aus der Buchdatenbank vorausgewählt.' + (addFreshGenres.length ? ' Gestrichelte legen eine neue Kategorie an.' : '')
    : '';
}

async function createCategoryFromGenre(name, btn){
  btn.disabled = true;
  const { data, error } = await db('categories').insert({ name }).select().single();
  if(error || !data){ btn.disabled = false; showToast('Kategorie konnte nicht angelegt werden'); return; }
  categories = [...categories, data].sort((a, b)=>a.name.localeCompare(b.name, 'de'));
  if(addFreshGenres.includes(name)) addSuggestedCatIds.add(data.id);
  addFreshGenres = addFreshGenres.filter(g=>g !== name);
  addBookSelectedCategoryIds.add(data.id);
  updateCategoryFieldForSeries();
}

// Vorschau links neben den Feldern: gewähltes Cover, sonst ein schlichtes Titelblatt.
let addPickerState = { value: '', options: [] };
function renderAddPreview(state = addPickerState){
  addPickerState = state;
  const url = state.value === 'none' ? '' : (state.value || (state.options[0] && state.options[0].url) || '');
  const title = titleInput.value.trim();
  addPreview.classList.toggle('is-empty', !url && !title);
  const blank = `<span class="add-preview-blank"><b>${escapeHtml(title || 'Titel')}</b><small>${escapeHtml(authorInput.value.trim())}</small></span>`;
  addPreview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer">` : blank;
  const img = addPreview.querySelector('img');
  if(img) img.addEventListener('error', ()=>{ addPreview.innerHTML = blank; });
}

const addPicker = createCoverPicker(document.getElementById('addCoverPicker'), renderAddPreview);
authorInput.addEventListener('input', ()=>renderAddPreview());
let suggestTimer = null, suggestSeq = 0, suggestItems = [], suggestActive = -1;

function closeSuggest(){
  suggestBox.classList.add('hidden');
  titleInput.setAttribute('aria-expanded', 'false');
  titleInput.removeAttribute('aria-activedescendant');
  suggestActive = -1;
}

function renderSuggest(){
  suggestBox.innerHTML = suggestItems.length
    ? suggestItems.map((c, i)=>`<button type="button" role="option" id="sugg-${i}" class="suggest-item ${i === suggestActive ? 'is-active' : ''}" data-i="${i}" aria-selected="${i === suggestActive}">
        <span class="suggest-thumb">${c.cover ? `<img src="${escapeHtml(c.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
        <span class="suggest-text">
          <span class="suggest-title">${escapeHtml(c.title)}</span>
          <span class="suggest-meta">${escapeHtml([c.authors.slice(0, 2).join(', '), c.year, c.pages ? c.pages + ' S.' : '', c.lang ? c.lang.toUpperCase() : ''].filter(Boolean).join(' · '))}</span>
          ${(g=>g.length ? `<span class="suggest-genres">${g.slice(0, 3).map(n=>`<span>${escapeHtml(n)}</span>`).join('')}</span>` : '')(detectGenres(c.genres))}
        </span>
      </button>`).join('')
    : '<p class="suggest-empty">Nichts gefunden. Du kannst das Buch trotzdem von Hand eintragen.</p>';
  suggestBox.querySelectorAll('.suggest-item').forEach(btn=>{
    btn.addEventListener('mousedown', e=>e.preventDefault()); // Fokus bleibt im Titelfeld
    btn.addEventListener('click', ()=>chooseSuggestion(suggestItems[+btn.getAttribute('data-i')]));
  });
  if(suggestActive >= 0) titleInput.setAttribute('aria-activedescendant', 'sugg-' + suggestActive);
  suggestBox.classList.remove('hidden');
  titleInput.setAttribute('aria-expanded', 'true');
}

titleInput.addEventListener('input', ()=>{
  renderAddPreview();
  clearTimeout(suggestTimer);
  const q = titleInput.value.trim();
  if(q.length < 3){ closeSuggest(); return; }
  suggestTimer = setTimeout(async ()=>{
    const seq = ++suggestSeq;
    suggestBox.innerHTML = '<p class="suggest-empty">Suche …</p>';
    suggestBox.classList.remove('hidden');
    const author = document.getElementById('f-author').value.trim();
    const res = await searchBooks(author ? `${q} ${author}` : q);
    if(seq !== suggestSeq || document.activeElement !== titleInput) return;
    suggestItems = res.slice(0, 7);
    suggestActive = -1;
    renderSuggest();
  }, 350);
});
titleInput.addEventListener('keydown', e=>{
  if(suggestBox.classList.contains('hidden')) return;
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeSuggest(); return; }
  if(!suggestItems.length) return;
  if(e.key === 'ArrowDown'){ e.preventDefault(); suggestActive = (suggestActive + 1) % suggestItems.length; renderSuggest(); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); suggestActive = (suggestActive - 1 + suggestItems.length) % suggestItems.length; renderSuggest(); }
  else if(e.key === 'Enter' && suggestActive >= 0){ e.preventDefault(); chooseSuggestion(suggestItems[suggestActive]); }
});
titleInput.addEventListener('blur', ()=>setTimeout(closeSuggest, 150));

async function chooseSuggestion(c){
  clearTimeout(suggestTimer);
  suggestSeq++;
  closeSuggest();
  titleInput.value = c.title;
  const pagesEl = document.getElementById('f-pages');
  const summaryEl = document.getElementById('f-summary');
  if(c.authors.length) authorInput.value = c.authors.slice(0, 2).join(', ');
  if(c.pages) pagesEl.value = c.pages;

  // Open Library nennt die Reihe als "series:…"-Subject; eine passende bestehende Reihe hat Vorrang.
  if(!seriesInput.value.trim()){
    const seriesNames = c.genres.filter(s=>/^series:/i.test(s)).map(s=>s.slice(7).trim()).filter(Boolean);
    const known = shelves.find(s=>s.is_series && seriesNames.some(n=>normTitle(n).includes(normTitle(s.label))));
    if(known || seriesNames.length) seriesInput.value = known ? known.label : seriesNames[0];
  }

  const { ids, fresh } = suggestCategories(c.genres);
  addSuggestedCatIds.forEach(id=>addBookSelectedCategoryIds.delete(id));
  ids.forEach(id=>addBookSelectedCategoryIds.add(id));
  addSuggestedCatIds = ids;
  addFreshGenres = fresh;
  updateCategoryFieldForSeries();

  addPicker.set(c.cover || '', c.covers);
  addPicker.setLoading(true);
  const [desc, options] = await Promise.all([
    summaryEl.value.trim() ? '' : fetchDescription(c),
    findCoverOptions(c.title, c.authors[0] || '', c.covers, seriesInput.value.trim()),
  ]);
  if(desc && !summaryEl.value.trim()) summaryEl.value = desc;
  addPicker.set(addPicker.value, options);
  addPicker.setLoading(false);
}

document.getElementById('openAddBtn').addEventListener('click', ()=>{
  document.getElementById('f-title').value='';
  document.getElementById('f-author').value='';
  document.getElementById('f-pages').value='';
  document.getElementById('f-summary').value='';
  seriesInput.value='';
  addBookSelectedCategoryIds = new Set();
  addSuggestedCatIds = new Set();
  addFreshGenres = [];
  moreGenresEl.open = false;
  addPicker.set('', []);
  setAddStatus('read');
  closeSuggest();
  updateCategoryFieldForSeries();
  overlay.classList.remove('hidden');
  document.getElementById('f-title').focus();
});
seriesInput.addEventListener('input', updateCategoryFieldForSeries);

let addStatus = 'read';
function setAddStatus(st){
  addStatus = st;
  document.querySelectorAll('#f-status [data-add-status]').forEach(b=>b.setAttribute('aria-pressed', b.getAttribute('data-add-status') === st));
}
document.querySelectorAll('#f-status [data-add-status]').forEach(btn=>{
  btn.addEventListener('click', ()=>setAddStatus(btn.getAttribute('data-add-status')));
});

document.getElementById('cancelAddBtn').addEventListener('click', ()=>overlay.classList.add('hidden'));
document.getElementById('closeAddBtn').addEventListener('click', ()=>overlay.classList.add('hidden'));
overlay.addEventListener('click', (e)=>{ if(e.target===overlay) overlay.classList.add('hidden'); });

document.getElementById('bookForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!isOwnerView()) return;
  const title = document.getElementById('f-title').value.trim();
  const author = document.getElementById('f-author').value.trim();
  const pagesVal = document.getElementById('f-pages').value.trim();
  const pageCount = pagesVal ? parseInt(pagesVal, 10) : null;
  const summary = document.getElementById('f-summary').value.trim() || null;
  const series = seriesInput.value.trim();

  if(!title){
    showToast('Bitte einen Titel eingeben');
    document.getElementById('f-title').focus();
    return;
  }
  if(!series){
    showToast('Bitte eine Reihe eingeben (bei Einzelbänden den Buchtitel)');
    seriesInput.focus();
    return;
  }

  let shelf = series ? shelves.find(s=>s.is_series && s.label.toLowerCase()===series.toLowerCase()) : null;

  if(!shelf){
    const { data: newShelf, error: shelfErr } = await db('shelves')
      .insert({ label: series || title, is_series: !!series })
      .select().single();
    if(shelfErr){ showToast('Fehler beim Anlegen des Regals'); return; }
    shelf = newShelf;

    if(addBookSelectedCategoryIds.size > 0){
      const rows = [...addBookSelectedCategoryIds].map(catId=>({ shelf_id: shelf.id, category_id: catId }));
      const { error: catLinkErr } = await db('shelf_categories').insert(rows);
      if(catLinkErr){ showToast('Fehler beim Zuordnen der Kategorien'); }
    }
  }

  const sameSeries = books.filter(b=>b.shelf_id===shelf.id);
  const seriesOrder = sameSeries.length ? Math.max(...sameSeries.map(b=>b.series_order||0)) + 1 : 1;

  const coverChoice = addPicker.value || null;
  const { data: newBook, error: bookErr } = await db('books')
    .insert({ shelf_id: shelf.id, title, author, series_order: seriesOrder, rating:0, notes:'', summary, date_read: null, page_count: pageCount, cover_url: coverChoice, status: addStatus })
    .select().single();
  if(bookErr){ showToast('Fehler beim Speichern des Buchs'); return; }

  selectedId = newBook.id;
  displayedId = newBook.id;
  await refreshAndRender();
  overlay.classList.add('hidden');
  showToast('„' + title + '“ steht jetzt im Regal');
});

// ---- Regal scannen ----
// Ein Foto vom Regal geht verkleinert an /api/scan (worker.js, Gemini). Die erkannten Bücher erscheinen
// als Prüfliste; erst nach Bestätigung landen sie im Regal, wie beim Neues-Buch-Dialog ohne Reihe
// jeweils mit dem Titel als Regal. Cover sucht die App danach automatisch.
const scanOverlay = document.getElementById('scanOverlay');
const scanInput = document.getElementById('scanFileInput');
const scanBody = document.getElementById('scanBody');
const scanLede = document.getElementById('scanLede');
const saveScanBtn = document.getElementById('saveScanBtn');
let scanItems = [];
let scanSeq = 0;

function pickScanPhoto(){
  scanInput.value = '';
  scanInput.click();
}
// Im lokalen Testmodus als Antonio freigeschaltet, damit es sich ohne Login ausprobieren lässt.
function hasPremium(){
  return canUsePremium || devPremium();
}
// Solange das Foto gelesen wird, schließt nur „Abbrechen“ das Fenster (kein X, kein Escape).
function setScanBusy(on){
  scanOverlay.classList.toggle('is-busy', on);
}
function scanIsBusy(){
  return !scanOverlay.classList.contains('hidden') && scanOverlay.classList.contains('is-busy');
}
function closeScan(){
  scanSeq++;
  setScanBusy(false);
  scanOverlay.classList.add('hidden');
}
document.getElementById('openScanBtn').addEventListener('click', ()=>{
  if(hasPremium()) pickScanPhoto();
  else openSupport('scan');
});
document.getElementById('scanAgainBtn').addEventListener('click', pickScanPhoto);
document.getElementById('closeScanBtn').addEventListener('click', ()=>{ if(!scanIsBusy()) closeScan(); });
document.getElementById('cancelScanBtn').addEventListener('click', closeScan);
// Kein Schließen per Klick daneben: weder mitten im Scan noch mit der fertigen Liste, die sonst weg wäre.
scanInput.addEventListener('change', ()=>{ if(scanInput.files[0]) runScan(scanInput.files[0]); });

// Handyfotos sind oft 10 MB groß; auf 2000 px reicht für die Buchrücken und hält die Anfrage klein.
// Was der Browser lesen kann (JPEG, PNG, WebP, AVIF, GIF, BMP, je nach Browser auch HEIC, TIFF, JPEG XL),
// wird hier verkleinert und als JPEG geschickt. Klappt das nicht, etwa HEIC vom iPhone in Chrome oder ein
// 50-Megapixel-Foto, für das dem Handy der Speicher fehlt, geht die Datei unverändert an den Worker, sofern
// Gemini das Format selbst lesen kann.
const SCAN_MAX_PX = 2000;
const SCAN_MAX_RAW_BYTES = 10 * 1024 * 1024;

function bytesToBase64(bytes){
  let bin = '';
  for(let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Das Format an den ersten Bytes erkennen: file.type ist bei HEIC und Dateien aus Cloud-Ordnern oft leer.
async function sniffImageType(file){
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (from, to)=>String.fromCharCode(...b.subarray(from, to));
  if(b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
  if(b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if(ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if(ascii(4, 8) === 'ftyp'){
    const brand = ascii(8, 12);
    if(/^(heic|heix|heim|heis|hevc|hevx|hevm|hevs)$/.test(brand)) return 'image/heic';
    if(/^(mif1|msf1|heif)$/.test(brand)) return 'image/heif';
    if(/^avi[fs]$/.test(brand)) return 'image/avif';
  }
  return file.type || '';
}

// Erst die Maße lesen, dann gleich verkleinert dekodieren: ein volles 50-MP-Bild braucht 200 MB Speicher.
function loadImageElement(url){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
// -> { source, width, height, url? }; url ist die Objekt-Adresse des <img>, die erst nach dem Zeichnen frei wird.
async function decodePhoto(file){
  const fit = (w, h)=>{
    const scale = Math.min(1, SCAN_MAX_PX / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  };
  const url = URL.createObjectURL(file);
  let img;
  try { img = await loadImageElement(url); } catch(e){ img = null; }
  if(!img || !img.naturalWidth){
    // Manche Browser lesen das Bild nur über createImageBitmap, nicht als <img>.
    URL.revokeObjectURL(url);
    const bmp = await createImageBitmap(file);
    return { source: bmp, ...fit(bmp.width, bmp.height) };
  }
  const size = fit(img.naturalWidth, img.naturalHeight);
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' });
    // Dreht ein Browser hochkant fotografierte Bilder erst nach dem Verkleinern, wäre das Ergebnis verzerrt.
    if(bmp.width === size.width && bmp.height === size.height){
      URL.revokeObjectURL(url);
      return { source: bmp, ...size };
    }
    bmp.close();
  } catch(e){}
  return { source: img, ...size, url };
}

async function photoToJpegBase64(file){
  const photo = await decodePhoto(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = photo.width;
    canvas.height = photo.height;
    const ctx = canvas.getContext('2d');
    // Transparente PNGs sonst mit schwarzem Hintergrund.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(photo.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res=>canvas.toBlob(res, 'image/jpeg', 0.85));
    if(blob) return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    // Ältere Android-Browser liefern bei toBlob manchmal null.
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if(!dataUrl.startsWith('data:image/jpeg')) throw new Error('no jpeg');
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  } finally {
    if(photo.source.close) photo.source.close();
    if(photo.url) URL.revokeObjectURL(photo.url);
  }
}

// Formate, die Gemini auch ohne Umwandlung im Browser liest.
const SCAN_RAW_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// -> { image, mime } oder ein Fehler mit .reason ('unsupported' | 'too_large').
async function photoToScanImage(file){
  try {
    return { image: await photoToJpegBase64(file), mime: 'image/jpeg' };
  } catch(e){
    const type = await sniffImageType(file).catch(()=>file.type);
    const fail = reason=>Object.assign(new Error(reason), { reason });
    if(!SCAN_RAW_TYPES.includes(type)) throw fail('unsupported');
    if(file.size > SCAN_MAX_RAW_BYTES) throw fail('too_large');
    return { image: bytesToBase64(new Uint8Array(await file.arrayBuffer())), mime: type };
  }
}

// code: das "error"-Feld aus der Antwort des Workers, z. B. die Tageslimits aus claim_scan().
function scanErrorText(res, code){
  if(!res) return 'Das Foto konnte nicht gelesen werden. Prüf deine Verbindung und versuch es nochmal.';
  if(code === 'user_limit') return 'Du hast heute schon 20 Fotos gescannt. Ab morgen 9 Uhr geht es weiter.';
  if(code === 'daily_limit') return 'Für heute sind alle Scans aufgebraucht. Ab morgen 9 Uhr geht es weiter.';
  if(res.status === 429 || res.status === 503) return 'Die Erkennung ist gerade ausgelastet. Versuch es in einer Minute nochmal.';
  if(res.status === 401) return 'Zum Scannen musst du angemeldet sein.';
  if(res.status === 403) return 'Regal scannen ist eine Premium-Funktion.';
  if(res.status === 413) return 'Das Foto ist zu groß.';
  if(res.status === 415) return 'Dieses Bildformat kann die Erkennung nicht lesen. Nimm bitte ein Foto als JPG, PNG, WebP oder HEIC.';
  if(res.status === 404 || res.status === 405) return 'Scannen geht nur über den Worker: online oder lokal mit „wrangler dev“.';
  return 'Das hat nicht geklappt. Versuch es nochmal oder mit einem anderen Foto.';
}

async function runScan(file){
  const seq = ++scanSeq;
  scanItems = [];
  scanLede.textContent = 'Das Foto wird gelesen. Meist dauert das ein paar Sekunden, bei viel Andrang auch mal bis zu einer Minute.';
  scanBody.innerHTML = '<div class="scan-loading" aria-hidden="true"></div>';
  // Dauert es länger, kurz Bescheid geben, damit niemand denkt, es hängt.
  setTimeout(()=>{
    if(seq === scanSeq && !scanItems.length && scanBody.querySelector('.scan-loading')){
      scanLede.textContent = 'Gerade ist bei der Erkennung viel los. Noch einen Moment …';
    }
  }, 12000);
  updateScanSave();
  setScanBusy(true);
  scanOverlay.classList.remove('hidden');

  let photo;
  try { photo = await photoToScanImage(file); } catch(e){
    if(seq !== scanSeq) return;
    setScanBusy(false);
    scanBody.innerHTML = '';
    scanLede.textContent = e.reason === 'too_large'
      ? 'Das Foto ist zu groß. Nimm bitte eins mit weniger als 10 MB, zum Beispiel ein normales Handyfoto statt eines 50-MP-Fotos.'
      : 'Dieses Bildformat kann die Erkennung nicht lesen. Nimm bitte ein Foto als JPG, PNG, WebP oder HEIC.';
    return;
  }
  let res = null;
  try {
    const { data:{ session } } = await supabaseClient.auth.getSession();
    res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(photo),
    });
  } catch(e){ res = null; }
  if(seq !== scanSeq) return;
  if(!res || !res.ok || !(res.headers.get('content-type') || '').includes('json')){
    const code = res && !res.ok ? ((await res.json().catch(()=>null)) || {}).error : null;
    if(seq !== scanSeq) return;
    setScanBusy(false);
    scanBody.innerHTML = '';
    scanLede.textContent = scanErrorText(res && res.ok ? { status: 404 } : res, code);
    return;
  }

  const { buecher = [] } = await res.json().catch(()=>({}));
  if(seq !== scanSeq) return;
  setScanBusy(false);
  const owned = new Set(books.map(b=>normTitle(b.title)));
  scanItems = buecher.map(b=>{
    // Eine schon vorhandene Reihe mit gleichem Namen übernehmen, damit die Bücher dort einsortiert werden.
    const known = b.reihe ? shelves.find(s=>s.is_series && normTitle(s.label) === normTitle(b.reihe)) : null;
    const isOwned = owned.has(normTitle(b.titel));
    // Unsicher gelesene Titel sind oft falsch: abgewählt und gleich zum Bearbeiten offen.
    const unsure = b.unsicher && !isOwned;
    return { titel: b.titel, autor: b.autor, reihe: known ? known.label : b.reihe, unsicher: b.unsicher, owned: isOwned,
      checked: !isOwned && !b.unsicher, editing: unsure,
      // coverChoice wie beim Cover-Picker: "" = automatisch, "none" = kein Cover, sonst Bild-URL.
      coverOptions: null, coverChoice: '', coverLoading: true, coverReq: 0, genres: [] };
  });
  scanOwnedOpen = false;
  renderScanList();
  loadScanCovers(seq);
}

let scanOwnedOpen = false;
const ICON_SCAN_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';

function scanRowHtml(b, i){
  const series = b.reihe && normTitle(b.reihe) !== normTitle(b.titel) ? b.reihe : '';
  const meta = [b.autor, series].filter(Boolean).join(' · ');
  const editor = b.editing ? `
    <div class="scan-editor">
      <label class="field"><span>Titel</span><input type="text" data-i="${i}" data-k="titel" value="${escapeHtml(b.titel)}"></label>
      <div class="field-row">
        <label class="field"><span>Autor</span><input type="text" data-i="${i}" data-k="autor" value="${escapeHtml(b.autor)}"></label>
        <div class="field"><label for="scan-reihe-${i}">Reihe</label><input type="text" id="scan-reihe-${i}" class="series-input" data-i="${i}" data-k="reihe" value="${escapeHtml(b.reihe)}" placeholder="leer: Einzelband"></div>
      </div>
      <div class="field"><span>Cover</span><div class="cover-picker scan-cover-picker"></div></div>
    </div>` : '';
  return `<li class="scan-row${b.checked ? ' is-on' : ''}" data-i="${i}">
    <label class="scan-pick">
      <input type="checkbox" class="scan-check" data-i="${i}" ${b.checked ? 'checked' : ''}>
      <span class="scan-cover" aria-hidden="true">${scanThumbHtml(b)}</span>
      <span class="scan-text"><b>${escapeHtml(b.titel)}</b>${meta ? `<small>${escapeHtml(meta)}</small>` : ''}${scanGenresHtml(b)}</span>
    </label>
    <button type="button" class="icon-btn sm scan-edit" data-edit="${i}" aria-expanded="${b.editing}" aria-label="„${escapeHtml(b.titel)}“ bearbeiten">${ICON_SCAN_EDIT}</button>
    ${editor}
  </li>`;
}

function renderScanList(){
  if(!scanItems.length){
    // Groß in der Mitte statt klein im Kopf; role="status" sagt es auch Screenreadern an.
    scanLede.textContent = '';
    scanBody.innerHTML = '<p class="scan-empty" role="status">Auf dem Foto wurde kein Buch erkannt!</p>';
    updateScanSave();
    return;
  }
  scanLede.textContent = 'Die Erkennung kann sich irren, schau also kurz über die Liste und hak an, was ins Regal soll. Gefundene Genres kommen als Kategorien mit.';
  const idx = pick=>scanItems.map((b, i)=>i).filter(i=>pick(scanItems[i]));
  const fresh = idx(b=>!b.owned && !b.unsicher);
  const unsure = idx(b=>!b.owned && b.unsicher);
  const owned = idx(b=>b.owned);
  const rows = list=>`<ul class="scan-rows">${list.map(i=>scanRowHtml(scanItems[i], i)).join('')}</ul>`;
  const allOn = fresh.length && fresh.every(i=>scanItems[i].checked);
  // Die Zahl groß wie im Regal-Kopf, darunter die Aufteilung auf die Abschnitte.
  const split = [
    fresh.length && `${fresh.length} neu`,
    unsure.length && `${unsure.length} zu prüfen`,
    owned.length && `${owned.length} schon im Regal`,
  ].filter(Boolean).join(' · ');
  scanBody.innerHTML = `
    <div class="scan-summary">
      <b>${scanItems.length}</b>
      <span><strong>${scanItems.length === 1 ? 'Buch erkannt' : 'Bücher erkannt'}</strong>${split ? `<small>${escapeHtml(split)}</small>` : ''}</span>
    </div>
    ${fresh.length ? `<section class="scan-section">
      <div class="scan-section-head"><h3>Neu <span>${fresh.length}</span></h3>
        <button type="button" class="link-btn" data-all="${allOn ? 'off' : 'on'}">${allOn ? 'Alle abwählen' : 'Alle auswählen'}</button></div>
      ${rows(fresh)}</section>` : ''}
    ${unsure.length ? `<section class="scan-section">
      <div class="scan-section-head"><h3>Bitte prüfen <span>${unsure.length}</span></h3></div>
      <p class="scan-section-hint">Diese Titel waren schwer zu lesen. Stimmt einer, hak ihn an; sonst korrigier ihn vorher.</p>
      ${rows(unsure)}</section>` : ''}
    ${owned.length ? `<details class="scan-section scan-owned"${scanOwnedOpen ? ' open' : ''}>
      <summary class="scan-section-head"><h3>Schon in deinem Regal <span>${owned.length}</span></h3></summary>
      ${rows(owned)}</details>` : ''}`;
  mountScanPickers();
  scanBody.querySelectorAll('.series-input').forEach(mountSeriesCombo);
  updateScanSave();
}

// Vorschaubild der Zeile: das gewählte Cover, sonst der erste Vorschlag der Suche.
function scanThumbHtml(b){
  const url = b.coverChoice === 'none' ? null
    : b.coverChoice || (b.coverOptions && b.coverOptions.length ? b.coverOptions[0].url : null);
  return url
    ? `<img src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer">`
    : `<span>${escapeHtml((b.titel || '?').charAt(0).toUpperCase())}</span>`;
}
function updateScanThumb(i){
  const slot = scanBody.querySelector(`.scan-row[data-i="${i}"] .scan-cover`);
  if(slot) slot.innerHTML = scanThumbHtml(scanItems[i]);
}
// Die drei spezifischsten Genres als Chips unter Titel und Autor.
function scanGenresHtml(b){
  return b.genres.length ? `<span class="suggest-genres">${b.genres.slice(0, 3).map(g=>`<span>${escapeHtml(g)}</span>`).join('')}</span>` : '';
}
function updateScanGenres(i){
  const text = scanBody.querySelector(`.scan-row[data-i="${i}"] .scan-text`);
  if(!text) return;
  const old = text.querySelector('.suggest-genres');
  if(old) old.remove();
  text.insertAdjacentHTML('beforeend', scanGenresHtml(scanItems[i]));
}

// Offene Bearbeiten-Bereiche bekommen dieselbe Cover-Auswahl wie der Neues-Buch-Dialog.
const scanPickers = new Map();
function mountScanPickers(){
  scanPickers.clear();
  scanItems.forEach((b, i)=>{
    const el = b.editing && scanBody.querySelector(`.scan-row[data-i="${i}"] .scan-cover-picker`);
    if(!el) return;
    let ready = false;
    // Der Picker meldet auch beim ersten Zeichnen seinen (leeren) Wert; erst echte Klicks übernehmen.
    const picker = createCoverPicker(el, st=>{ if(ready){ b.coverChoice = st.value; updateScanThumb(i); } });
    picker.set(b.coverChoice, b.coverOptions || []);
    if(b.coverLoading) picker.setLoading(true);
    ready = true;
    scanPickers.set(i, picker);
  });
}
function syncScanPicker(i){
  const picker = scanPickers.get(i);
  if(!picker) return;
  const b = scanItems[i];
  picker.set(b.coverChoice, b.coverOptions || []);
  picker.setLoading(!!b.coverLoading);
}

// Cover suchen wie im Neues-Buch-Dialog (Google Books und Open Library), drei Bücher gleichzeitig.
// Ein gefundenes Cover zeigt nebenbei, ob der Titel richtig erkannt wurde.
async function searchScanCovers(i, seq){
  const b = scanItems[i];
  const req = ++b.coverReq;
  b.coverLoading = true;
  syncScanPicker(i);
  let options = [];
  const hits = [];
  try { options = await findCoverOptions(b.titel, b.autor, [], b.reihe, hits); } catch(e){ options = []; }
  // Liste inzwischen geschlossen, neu gescannt oder der Titel wurde seitdem wieder geändert.
  if(seq !== scanSeq || req !== b.coverReq) return;
  b.coverOptions = options;
  b.coverLoading = false;
  b.genres = scanGenresFromHits(hits);
  updateScanThumb(i);
  updateScanGenres(i);
  syncScanPicker(i);
}
// Genres wie im Neues-Buch-Dialog aus den Treffern der Buchdatenbanken; beim Speichern werden sie zu Kategorien.
// Die Subjects von Open Library sind verrauscht (Dune steht dort auch unter Fantasy), deshalb
// zählt nur, was mindestens die Hälfte der Treffer mit Genres nennt, höchstens drei, die häufigsten zuerst.
function scanGenresFromHits(hits){
  const lists = hits.map(c=>detectGenres(c.genres)).filter(l=>l.length);
  const count = new Map();
  lists.forEach(l=>l.forEach(g=>count.set(g, (count.get(g) || 0) + 1)));
  const order = GENRE_RULES.map(r=>r.name);
  return [...count.keys()]
    .filter(g=>count.get(g) >= Math.ceil(lists.length / 2))
    .sort((a, b)=>count.get(b) - count.get(a) || order.indexOf(a) - order.indexOf(b))
    .slice(0, 3);
}
async function loadScanCovers(seq){
  const queue = scanItems.map((b, i)=>i).sort((a, b)=>scanItems[a].owned - scanItems[b].owned);
  const next = async ()=>{
    while(queue.length && seq === scanSeq) await searchScanCovers(queue.shift(), seq);
  };
  await Promise.all([next(), next(), next()]);
}

// Nach dem Korrigieren von Titel oder Autor neu suchen, sobald man kurz aufhört zu tippen.
const scanResearchTimers = new Map();
function queueScanResearch(i){
  clearTimeout(scanResearchTimers.get(i));
  const seq = scanSeq;
  scanResearchTimers.set(i, setTimeout(()=>searchScanCovers(i, seq), 700));
}

scanBody.addEventListener('input', e=>{
  const i = e.target.getAttribute('data-i');
  const k = e.target.getAttribute('data-k');
  if(i === null || !k) return;
  scanItems[i][k] = e.target.value;
  // Titelzeile live mitschreiben, ohne die Liste neu zu bauen (sonst springt der Cursor raus).
  const row = scanBody.querySelector(`.scan-row[data-i="${i}"]`);
  if(row && k === 'titel') row.querySelector('.scan-text b').textContent = e.target.value;
  if(k === 'titel' || k === 'autor') queueScanResearch(Number(i));
  updateScanSave();
});
scanBody.addEventListener('change', e=>{
  if(!e.target.classList.contains('scan-check')) return;
  const i = e.target.getAttribute('data-i');
  scanItems[i].checked = e.target.checked;
  e.target.closest('.scan-row').classList.toggle('is-on', e.target.checked);
  updateScanSave();
});
scanBody.addEventListener('click', e=>{
  const edit = e.target.closest('[data-edit]');
  const all = e.target.closest('[data-all]');
  if(edit){
    const b = scanItems[edit.getAttribute('data-edit')];
    b.editing = !b.editing;
    // Ohne Fokus ins Titelfeld, sonst klappt auf dem Handy sofort die Tastatur über die Cover.
    renderScanList();
  } else if(all){
    const on = all.getAttribute('data-all') === 'on';
    scanItems.forEach(b=>{ if(!b.owned && !b.unsicher) b.checked = on; });
    renderScanList();
  }
});
scanBody.addEventListener('toggle', e=>{
  if(e.target.classList && e.target.classList.contains('scan-owned')) scanOwnedOpen = e.target.open;
}, true);

// Erkannte Genres als Kategorien ans Regal hängen. Fehlt eine Kategorie, wird sie angelegt (höchstens
// MAX_NEW_GENRES pro Buch, wie die Vorschläge im Neues-Buch-Dialog). Fehler hier halten das Speichern nicht auf.
async function addScanGenres(shelf, genres){
  if(!genres.length) return;
  const { ids, fresh } = categoriesForGenres(genres);
  for(const name of fresh){
    const { data, error } = await db('categories').insert({ name }).select().single();
    if(error || !data) continue;
    categories = [...categories, data].sort((a, b)=>a.name.localeCompare(b.name, 'de'));
    ids.add(data.id);
  }
  const missing = [...ids].filter(id=>!shelf.categoryIds.includes(id));
  if(!missing.length) return;
  const { error } = await db('shelf_categories').insert(missing.map(category_id=>({ shelf_id: shelf.id, category_id })));
  if(!error) shelf.categoryIds.push(...missing);
}

function updateScanSave(){
  const n = scanItems.filter(b=>b.checked && b.titel.trim()).length;
  saveScanBtn.disabled = n === 0;
  saveScanBtn.textContent = n === 1 ? '1 Buch ins Regal stellen' : n > 1 ? `${n} Bücher ins Regal stellen` : 'Ins Regal stellen';
}

saveScanBtn.addEventListener('click', async ()=>{
  if(!isOwnerView()) return;
  const chosen = scanItems.filter(b=>b.checked && b.titel.trim());
  if(!chosen.length) return;
  saveScanBtn.disabled = true;
  let added = 0;
  // Regale, die erst jetzt entstehen. Nur die bekommen Genres; bestehende Reihen behalten ihre Kategorien,
  // wie im Neues-Buch-Dialog.
  const freshShelves = new Set();
  for(const b of chosen){
    const title = b.titel.trim();
    const author = b.autor.trim();
    const label = b.reihe.trim() || title;
    let shelf = shelves.find(s=>s.is_series && s.label.toLowerCase() === label.toLowerCase());
    if(!shelf){
      const { data, error } = await db('shelves').insert({ label, is_series: true }).select().single();
      if(error) break;
      shelf = { ...data, categoryIds: [] };
      shelves.push(shelf);
      freshShelves.add(shelf.id);
    }
    if(freshShelves.has(shelf.id)) await addScanGenres(shelf, b.genres);
    const same = books.filter(x=>x.shelf_id === shelf.id);
    const seriesOrder = same.length ? Math.max(...same.map(x=>x.series_order || 0)) + 1 : 1;
    const { data: newBook, error } = await db('books')
      .insert({ shelf_id: shelf.id, title, author, series_order: seriesOrder, rating: 0, notes: '', summary: null, date_read: null, page_count: null, cover_url: b.coverChoice || null })
      .select().single();
    if(error) break;
    books.push(newBook);
    added++;
  }
  await refreshAndRender();
  scanOverlay.classList.add('hidden');
  showToast(added === chosen.length
    ? (added === 1 ? '1 Buch steht jetzt im Regal' : `${added} Bücher stehen jetzt im Regal`)
    : `${added} von ${chosen.length} Büchern gespeichert, dann ist ein Fehler aufgetreten`);
});

// ---- Import aus Goodreads und StoryGraph ----
// Beide Dienste exportieren die eigene Bibliothek als CSV. Die Datei liest nur der Browser; in die Datenbank
// gehen per import_books() (supabase/025_import_books.sql) die Bücher selbst, ohne Cover. Die sucht das
// Regal danach wie immer selbst und merkt sie sich (rememberCover).
const importOverlay = document.getElementById('importOverlay');
const importBody = document.getElementById('importBody');
const importFileInput = document.getElementById('importFileInput');
const IMPORT_CHUNK = 500;
let importState = null; // { source, items: [{title, author, series, series_order, rating, date_read, page_count, status, review}], dupes }

// CSV nach RFC 4180: Felder in Anführungszeichen dürfen Kommas, Zeilenumbrüche und "" enthalten.
function parseCsv(text){
  const rows = [];
  let row = [], field = '', quoted = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(quoted){
      if(c === '"' && text[i + 1] === '"'){ field += '"'; i++; }
      else if(c === '"') quoted = false;
      else field += c;
    } else if(c === '"') quoted = true;
    else if(c === ','){ row.push(field); field = ''; }
    else if(c === '\n' || c === '\r'){
      if(c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if(field || row.length){ row.push(field); rows.push(row); }
  const head = (rows.shift() || []).map(h=>h.replace(/^﻿/, '').trim());
  return rows.filter(r=>r.some(v=>v.trim())).map(r=>Object.fromEntries(head.map((h, i)=>[h, (r[i] || '').trim()])));
}

// Goodreads hängt die Reihe an den Titel: „Der Name des Windes (Die Königsmörder-Chronik, #1)“.
function splitSeries(title){
  const m = title.match(/^(.*\S)\s*\(([^()]+?),?\s*#(\d+(?:\.\d+)?)(?:-\d+)?\)\s*$/);
  if(!m) return { title, series: '', order: null };
  return { title: m[1], series: m[2].trim(), order: /^\d+$/.test(m[3]) ? Number(m[3]) : null };
}
// "2023/05/14" oder "2023-05-14" (bei StoryGraph auch mehrere, durch Komma getrennt: das letzte zählt)
function importDate(raw){
  const all = String(raw || '').match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g);
  if(!all) return null;
  const [y, m, d] = all[all.length - 1].split(/[/-]/).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if(date.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const IMPORT_STATUS = { 'read': 'read', 'currently-reading': 'reading', 'to-read': 'want' };

function importItemsFromCsv(rows){
  if(!rows.length) return null;
  const cols = Object.keys(rows[0]);
  if(cols.includes('Exclusive Shelf')){
    return { source: 'Goodreads', items: rows.map(r=>{
      const { title, series, order } = splitSeries(r['Title'] || '');
      return {
        title, series, series_order: order,
        author: r['Author'] || '',
        rating: Math.max(0, Math.min(5, parseInt(r['My Rating'], 10) || 0)),
        date_read: importDate(r['Date Read']),
        page_count: parseInt(r['Number of Pages'], 10) || null,
        status: IMPORT_STATUS[r['Exclusive Shelf']] || null,
        review: r['My Review'] || '',
      };
    }) };
  }
  if(cols.includes('Read Status')){
    return { source: 'StoryGraph', items: rows.map(r=>{
      const { title, series, order } = splitSeries(r['Title'] || '');
      return {
        title, series, series_order: order,
        author: (r['Authors'] || '').split(',')[0].trim(),
        rating: Math.max(0, Math.min(5, Math.round(parseFloat(r['Star Rating']) || 0))),
        date_read: importDate(r['Last Date Read'] || r['Dates Read']),
        page_count: null,
        status: IMPORT_STATUS[r['Read Status']] || null, // did-not-finish bleibt draußen
        review: r['Review'] || '',
      };
    }) };
  }
  return null;
}

const importKey = (title, author)=>normTitle(title) + '|' + normTitle(author);

function openImport(){
  if(!isOwnerView()) return;
  importState = null;
  renderImport();
  importOverlay.classList.remove('hidden');
}

function renderImport(phase = 'pick', info = ''){
  if(phase === 'pick'){
    importBody.innerHTML = `
      <p class="modal-lede">Hol deine Bücher aus Goodreads oder StoryGraph ins Regal, mit Bewertung, Lesedatum und Reihe. Die Datei bleibt in deinem Browser.</p>
      <ol class="import-steps">
        <li><b>Goodreads:</b> Meine Bücher → Import und Export → „Export Library“, dann die CSV-Datei herunterladen.</li>
        <li><b>StoryGraph:</b> Manage Account → „Export StoryGraph Library“, die CSV kommt per E-Mail.</li>
      </ol>
      ${info ? `<p class="import-error" role="alert">${escapeHtml(info)}</p>` : ''}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-import-close>Abbrechen</button>
        <button type="button" class="btn btn-primary" id="importPickBtn">CSV-Datei wählen</button>
      </div>`;
    document.getElementById('importPickBtn').addEventListener('click', ()=>{ importFileInput.value = ''; importFileInput.click(); });
  } else if(phase === 'review'){
    const st = importState;
    const by = { read: 0, reading: 0, want: 0 };
    st.items.forEach(b=>{ if(b.status && !b.dupe) by[b.status]++; });
    const dupes = st.items.filter(b=>b.dupe).length;
    const opt = (key, label, n, on)=>n ? `<label class="import-opt"><input type="checkbox" class="scan-check" data-import-status="${key}" ${on ? 'checked' : ''}><span><b>${label}</b><small>${n} ${n === 1 ? 'Buch' : 'Bücher'}</small></span></label>` : '';
    importBody.innerHTML = `
      <p class="modal-lede">${st.items.length} Einträge aus ${st.source} gelesen.${dupes ? ` ${dupes} ${dupes === 1 ? 'steht' : 'stehen'} schon in deinem Regal und ${dupes === 1 ? 'wird' : 'werden'} übersprungen.` : ''}</p>
      <div class="import-opts">
        ${opt('read', 'Gelesen', by.read, true)}
        ${opt('reading', 'Lese ich gerade', by.reading, true)}
        ${opt('want', 'Will ich lesen (Merkliste)', by.want, false)}
      </div>
      <div class="import-opts">
        <label class="import-opt"><input type="checkbox" class="scan-check" id="importRatings" checked><span><b>Bewertungen übernehmen</b><small>Deine Follower bekommen dafür keine Mitteilungen.</small></span></label>
        <label class="import-opt"><input type="checkbox" class="scan-check" id="importReviews"><span><b>Rezensionen als Notizen übernehmen</b><small>Notizen sind in deinem Regal für alle sichtbar.</small></span></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-import-close>Abbrechen</button>
        <button type="button" class="btn btn-primary" id="importGoBtn"></button>
      </div>`;
    const sync = ()=>{
      const n = importSelection().length;
      const btn = document.getElementById('importGoBtn');
      btn.disabled = n === 0;
      btn.textContent = n === 1 ? '1 Buch importieren' : `${n} Bücher importieren`;
    };
    importBody.querySelectorAll('[data-import-status]').forEach(c=>c.addEventListener('change', sync));
    sync();
    document.getElementById('importGoBtn').addEventListener('click', runImport);
  } else if(phase === 'busy'){
    importBody.innerHTML = `<p class="modal-lede import-busy" aria-live="polite">${escapeHtml(info)}</p>`;
  }
  importBody.querySelectorAll('[data-import-close]').forEach(b=>b.addEventListener('click', ()=>importOverlay.classList.add('hidden')));
}

function importSelection(){
  const on = new Set([...importBody.querySelectorAll('[data-import-status]:checked')].map(c=>c.getAttribute('data-import-status')));
  return importState.items.filter(b=>!b.dupe && on.has(b.status));
}

importFileInput.addEventListener('change', async ()=>{
  const file = importFileInput.files[0];
  if(!file) return;
  if(file.size > 20 * 1024 * 1024){ renderImport('pick', 'Die Datei ist größer als 20 MB. Ist das wirklich der Export?'); return; }
  let parsed = null;
  try { parsed = importItemsFromCsv(parseCsv(await file.text())); } catch(e){}
  if(!parsed){ renderImport('pick', 'Das sieht nicht nach einem Export aus Goodreads oder StoryGraph aus. Wähl die CSV-Datei aus dem Export.'); return; }
  const have = new Set(books.map(b=>importKey(b.title, b.author)));
  const seen = new Set();
  parsed.items = parsed.items.filter(b=>b.title && b.status).map(b=>{
    const k = importKey(b.title, b.author);
    const dupe = have.has(k) || seen.has(k);
    seen.add(k);
    return { ...b, dupe };
  });
  if(!parsed.items.length){ renderImport('pick', 'In der Datei stehen keine Bücher, die sich importieren lassen.'); return; }
  importState = parsed;
  renderImport('review');
});

async function runImport(){
  const ratings = document.getElementById('importRatings').checked;
  const reviews = document.getElementById('importReviews').checked;
  const chosen = importSelection().map(b=>({
    title: b.title, author: b.author, series: b.series, series_order: b.series_order,
    rating: ratings ? b.rating : 0,
    date_read: b.status === 'read' ? b.date_read : null,
    page_count: b.page_count,
    status: b.status,
    notes: reviews ? htmlToText(b.review).slice(0, 5000) : '',
  }));
  // Reihen zusammen anlegen und in Band-Reihenfolge, damit Band 1 vorne steht.
  chosen.sort((a, b)=>(a.series || a.title).localeCompare(b.series || b.title, 'de') || (a.series_order || 999) - (b.series_order || 999));
  let added = 0;
  try {
    if(devSandboxActive()){
      added = await importIntoSandbox(chosen);
    } else {
      for(let i = 0; i < chosen.length; i += IMPORT_CHUNK){
        renderImport('busy', `Importiere … ${i} von ${chosen.length}`);
        const { data, error } = await supabaseClient.rpc('import_books', { p_books: chosen.slice(i, i + IMPORT_CHUNK) });
        if(error) throw error;
        added += data || 0;
      }
    }
  } catch(e){
    await refreshAndRender();
    renderImport('pick', added
      ? `${added} von ${chosen.length} Büchern importiert, dann ist ein Fehler aufgetreten. Versuch es noch einmal; was schon im Regal steht, wird übersprungen.`
      : 'Der Import hat nicht geklappt. Versuch es gleich noch einmal.');
    return;
  }
  resetDirectory();
  await refreshAndRender();
  importOverlay.classList.add('hidden');
  showToast(added === 1 ? '1 Buch importiert' : `${added} Bücher importiert`);
}

// Lokaler Testmodus: dieselbe Logik wie import_books(), nur in der Testkopie.
async function importIntoSandbox(list){
  let added = 0;
  for(const b of list){
    const label = (b.series || b.title).slice(0, 200);
    let shelf = shelves.find(s=>s.is_series && s.label.toLowerCase() === label.toLowerCase());
    if(!shelf){
      const { data } = await db('shelves').insert({ label, is_series: true }).select().single();
      shelf = { ...data, categoryIds: [] };
      shelves.push(shelf);
    }
    const same = books.filter(x=>x.shelf_id === shelf.id);
    const taken = same.some(x=>x.series_order === b.series_order);
    const order = b.series_order && !taken ? b.series_order : (same.length ? Math.max(...same.map(x=>x.series_order || 0)) + 1 : 1);
    const { data } = await db('books').insert({ shelf_id: shelf.id, title: b.title, author: b.author, series_order: order, rating: b.rating, notes: b.notes, summary: null, date_read: b.date_read, page_count: b.page_count, cover_url: null, status: b.status }).select().single();
    books.push(data);
    added++;
  }
  return added;
}

document.getElementById('importCloseBtn').addEventListener('click', ()=>importOverlay.classList.add('hidden'));
importOverlay.addEventListener('click', e=>{ if(e.target === importOverlay) importOverlay.classList.add('hidden'); });
document.getElementById('setImportBtn').addEventListener('click', ()=>{
  settingsOverlay.classList.add('hidden');
  openImport();
});
document.getElementById('addImportLink').addEventListener('click', ()=>{
  overlay.classList.add('hidden');
  openImport();
});

// ---- Cover nachträglich ändern ----
const coverOverlay = document.getElementById('coverModalOverlay');
const editPicker = createCoverPicker(document.getElementById('editCoverPicker'));
let coverEditBook = null;

async function openCoverModal(book){
  coverEditBook = book;
  document.getElementById('coverModalLede').textContent = `Für „${book.title}“. „Automatisch“ sucht das Cover anhand von Titel und Autor.`;
  const entry = coverCache[coverKey(book)];
  const current = entry && entry.src ? [{ url: entry.src, label: 'Aktuelles Cover' }] : [];
  editPicker.set(book.cover_url || '', current);
  editPicker.setLoading(true);
  coverOverlay.classList.remove('hidden');
  const meta = bookIndex.get(String(book.id));
  const seriesLabel = meta && meta.group.items.length > 1 ? meta.group.label : '';
  const options = await findCoverOptions(book.title, book.author, current, seriesLabel);
  if(coverEditBook !== book) return;
  editPicker.set(editPicker.value, options);
  editPicker.setLoading(false);
}

function closeCoverModal(){
  coverOverlay.classList.add('hidden');
  coverEditBook = null;
}
document.getElementById('coverCancelBtn').addEventListener('click', closeCoverModal);
coverOverlay.addEventListener('click', e=>{ if(e.target === coverOverlay) closeCoverModal(); });
document.getElementById('coverSaveBtn').addEventListener('click', async ()=>{
  if(!coverEditBook) return;
  const { error } = await db('books').update({ cover_url: editPicker.value || null }).eq('id', coverEditBook.id);
  if(error){ showToast('Cover konnte nicht gespeichert werden'); return; }
  closeCoverModal();
  await refreshAndRender();
  showToast('Cover gespeichert');
});

// ---- Cover groß ansehen (Klick aufs Cover in den Buchdetails) ----
const coverZoomOverlay = document.getElementById('coverZoomOverlay');
const coverZoomImg = document.getElementById('coverZoomImg');

function openCoverZoom(book, group){
  const v = bookVisual(book, group.label);
  if(!v.has) return;
  // Bis das große Bild da ist, steht das kleine (schon geladene) als Hintergrund dahinter.
  coverZoomImg.style.setProperty('--cover-sm', `url('${v.url}')`);
  coverZoomImg.style.aspectRatio = v.ratio.toFixed(3);
  coverZoomImg.onerror = ()=>{ coverZoomImg.onerror = null; coverZoomImg.src = v.url; };
  coverZoomImg.src = v.urlLarge;
  coverZoomImg.alt = `Cover von „${book.title}“`;
  coverZoomOverlay.classList.remove('hidden');
  coverZoomOverlay.focus();
}
function closeCoverZoom(){
  coverZoomOverlay.classList.add('hidden');
  coverZoomImg.removeAttribute('src');
}
coverZoomOverlay.addEventListener('click', closeCoverZoom);

// ---- Category management modal ----
const catOverlay = document.getElementById('catModalOverlay');

function renderCatChips(containerId, afterDelete){
  const list = document.getElementById(containerId);
  if(categories.length === 0){
    list.innerHTML = '<p class="cat-empty">Noch keine Kategorien angelegt.</p>';
    return;
  }
  list.innerHTML = categories.map(c=>`<span class="cat-chip">${escapeHtml(c.name)}<button type="button" data-id="${escapeHtml(c.id)}" aria-label="${escapeHtml(c.name)} löschen">${ICON_CLOSE}</button></span>`).join('');
  list.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id');
      const cat = categories.find(c=>c.id===id);
      const { error } = await db('categories').delete().eq('id', id);
      if(error){ showToast('Fehler beim Löschen'); return; }
      if(cat && activeCategory === cat.name) activeCategory = null;
      await loadShelfData(viewedProfile.id);
      renderCatChips(containerId, afterDelete);
      render();
      if(afterDelete) afterDelete();
    });
  });
}

document.getElementById('openCatBtn').addEventListener('click', ()=>{
  if(!isOwnerView()) return;
  renderCatChips('catChipList');
  document.getElementById('newCatInput').value='';
  catOverlay.classList.remove('hidden');
});
document.getElementById('closeCatBtn').addEventListener('click', ()=>catOverlay.classList.add('hidden'));
catOverlay.addEventListener('click', (e)=>{ if(e.target===catOverlay) catOverlay.classList.add('hidden'); });

document.getElementById('addCatBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('newCatInput');
  const val = input.value.trim();
  if(!val) return;
  if(categories.some(c=>c.name.toLowerCase()===val.toLowerCase())){
    showToast('Kategorie existiert bereits');
    return;
  }
  const { error } = await db('categories').insert({ name: val });
  if(error){ showToast('Fehler beim Anlegen'); return; }
  input.value='';
  await loadShelfData(viewedProfile.id);
  renderCatChips('catChipList');
  render();
});
document.getElementById('newCatInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('addCatBtn').click(); }
});

// ---- Reihen-Modal (Titel + Kategorien), geöffnet über den Bearbeiten-Knopf einer Reihe ----
const shelfCatOverlay = document.getElementById('shelfCatModalOverlay');
const shelfCatToggleList = document.getElementById('shelfCatToggleList');
const shelfCatTitleEl = document.getElementById('shelfCatTitle');
const shelfEditTitleBtn = document.getElementById('shelfEditTitleBtn');
const shelfRenameField = document.getElementById('shelfRenameField');
const shelfRenameActions = document.getElementById('shelfRenameActions');
const shelfRenameInput = document.getElementById('shelfRenameInput');
let currentShelfKey = null;
let currentShelfLabel = null;

function setShelfCatTitle(label){
  currentShelfLabel = label;
  shelfCatTitleEl.textContent = label;
}

// Bände der Reihe, die in die Vitrine dürfen (nicht privat), in Bandfolge.
function showcaseVolumes(){
  const g = buildGroups().find(x=>x.key === currentShelfKey);
  return g && !g.isPrivate ? g.items.filter(b=>!b.is_private) : [];
}

// Eine Reihe mit nur einem Buch kommt über die Buch-Details in die Vitrine, nicht hier.
function syncShelfShowcase(){
  const row = document.getElementById('shelfShowcaseRow');
  const pick = document.getElementById('shelfShowcasePick');
  const shelf = shelves.find(s=>s.id===currentShelfKey);
  const priv = !!(shelf && shelf.is_private);
  const volumes = showcaseVolumes();
  const multi = (books.filter(b=>b.shelf_id === currentShelfKey).length) > 1;
  const locked = isOwnerView() && !canEditShowcase();
  const show = (canEditShowcase() || locked) && multi;
  row.classList.toggle('hidden', !show);
  row.classList.toggle('is-locked', locked);
  const inside = show && showcaseShelfId() === currentShelfKey && showcaseBookIds().length > 0;
  pick.classList.toggle('hidden', !inside);
  if(!show) return;
  const btn = document.getElementById('shelfShowcaseBtn');
  btn.textContent = inside ? 'Herausnehmen' : 'In die Vitrine';
  btn.disabled = !inside && (priv || !volumes.length);
  if(locked){
    document.getElementById('shelfShowcaseHint').textContent = priv
      ? 'Private Reihen können nicht in die Vitrine.'
      : `Für Supporter: bis zu ${SHOWCASE_MAX} Bände dieser Reihe ganz oben in deinem Regal.`;
    return;
  }
  const picked = inside ? showcaseBookIds().length : 0;
  document.getElementById('shelfShowcaseHint').textContent = inside
    ? `${picked} von ${SHOWCASE_MAX} gewählt · Tippe auf ein Cover.`
    : priv ? 'Private Reihen können nicht in die Vitrine.'
    : `Bis zu ${SHOWCASE_MAX} Bände dieser Reihe ganz oben in deinem Regal. Ersetzt, was gerade in der Vitrine steht.`;
  if(!inside){ pick.innerHTML = ''; return; }
  const chosen = new Set(showcaseBookIds());
  const group = buildGroups().find(x=>x.key === currentShelfKey);
  const full = chosen.size >= SHOWCASE_MAX;
  pick.innerHTML = volumes.map(b=>{
    const on = chosen.has(String(b.id));
    const v = bookVisual(b, group.label);
    return `<button type="button" class="tile vitrine-pick-item ${v.ink} ${v.has ? 'has-cover' : ''} ${on ? 'open' : ''} ${!on && full ? 'is-muted' : ''}" data-book="${escapeHtml(b.id)}" data-id="${escapeHtml(b.id)}" style="${escapeHtml(visualStyle(v))}" aria-pressed="${on}" aria-label="${escapeHtml(`Band ${b.series_order}: ${b.title}`)}">
      <span class="tile-cover">${genCoverHtml(b, group)}${on ? `<span class="vitrine-check" aria-hidden="true">${ICON_CHECK}</span>` : ''}</span>
      <span class="tile-meta">Band ${escapeHtml(String(b.series_order))}</span>
    </button>`;
  }).join('');
  pick.querySelectorAll('.vitrine-pick-item').forEach(chip=>{
    chip.addEventListener('click', async ()=>{
      const id = chip.getAttribute('data-id');
      const ids = showcaseBookIds();
      const on = ids.includes(id);
      if(on && ids.length === 1){ showToast('Ein Band bleibt drin. Ganz raus geht mit „Herausnehmen“.'); return; }
      if(!on && ids.length >= SHOWCASE_MAX){ showToast(`Höchstens ${SHOWCASE_MAX} Bände. Nimm erst einen heraus.`); return; }
      await saveShowcase({ shelf_id: currentShelfKey, book_ids: on ? ids.filter(x=>x !== id) : [...ids, id] });
      syncShelfShowcase();
    });
  });
}

document.getElementById('shelfShowcaseBtn').addEventListener('click', async ()=>{
  if(!canEditShowcase()){
    shelfCatOverlay.classList.add('hidden');
    openSupport('vitrine');
    return;
  }
  const inside = showcaseShelfId() === currentShelfKey && showcaseBookIds().length > 0;
  await saveShowcase(inside ? {} : { shelf_id: currentShelfKey, book_ids: showcaseVolumes().slice(0, SHOWCASE_MAX).map(b=>String(b.id)) },
    inside ? 'Reihe aus der Vitrine genommen' : 'Die Reihe steht jetzt in der Vitrine');
  syncShelfShowcase();
});

function syncShelfPrivacy(){
  const shelf = shelves.find(s=>s.id===currentShelfKey);
  const priv = !!(shelf && shelf.is_private);
  document.querySelectorAll('[data-shelf-privacy]').forEach(b=>{
    b.setAttribute('aria-pressed', b.getAttribute('data-shelf-privacy') === (priv ? 'private' : 'public'));
  });
  document.getElementById('shelfPrivacyHint').textContent = priv
    ? 'Nur du siehst diese Reihe, auch wenn dein Regal öffentlich ist.'
    : 'Alle, die dein Regal sehen, sehen auch diese Reihe.';
}

document.querySelectorAll('[data-shelf-privacy]').forEach(btn=>{
  btn.addEventListener('click', async ()=>{
    const shelf = shelves.find(s=>s.id===currentShelfKey);
    const priv = btn.getAttribute('data-shelf-privacy') === 'private';
    if(!shelf || priv === !!shelf.is_private) return;
    const { error } = await db('shelves').update({ is_private: priv }).eq('id', currentShelfKey);
    if(error){ showToast('Fehler beim Speichern'); return; }
    await refreshAndRender();
    syncShelfPrivacy();
    syncShelfShowcase();
    showToast(priv ? 'Nur du siehst diese Reihe' : 'Reihe ist wieder öffentlich');
  });
});

function openShelfCatModal(key, label){
  currentShelfKey = key;
  setShelfCatTitle(label);
  closeShelfRenameMode();
  syncShelfPrivacy();
  syncShelfShowcase();
  refreshShelfCatToggleList();
  shelfCatOverlay.classList.remove('hidden');
}

// Eine Liste: antippen ordnet zu, „+ Neue Kategorie“ legt direkt eine an und ordnet sie gleich zu.
// Löschen geht im Kategorien-Fenster der Werkzeugleiste.
function refreshShelfCatToggleList(){
  const shelf = shelves.find(s=>s.id===currentShelfKey);
  renderCategoryToggleList(shelfCatToggleList, currentShelfKey, shelf ? shelf.categoryIds : []);
  const empty = shelfCatToggleList.querySelector('.cat-toggle-empty');
  if(empty) empty.remove();
  shelfCatToggleList.insertAdjacentHTML('beforeend', '<button type="button" class="cat-toggle cat-new">+ Neue Kategorie</button>');
  shelfCatToggleList.querySelector('.cat-new').addEventListener('click', openShelfNewCat);
}

function openShelfNewCat(){
  const chip = shelfCatToggleList.querySelector('.cat-new');
  const form = document.createElement('form');
  form.className = 'cat-new-form';
  form.innerHTML = `<input type="text" maxlength="30" placeholder="Name" aria-label="Neue Kategorie" enterkeyhint="done"><button type="submit" aria-label="Anlegen">${ICON_CHECK}</button>`;
  chip.replaceWith(form);
  const input = form.querySelector('input');
  input.focus();
  input.addEventListener('keydown', e=>{
    if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); refreshShelfCatToggleList(); }
  });
  // Leer verlassen: wieder der Chip. Ein Tipp auf den Haken zählt nicht als Verlassen.
  input.addEventListener('blur', ()=>setTimeout(()=>{
    if(form.isConnected && !input.value.trim() && !form.contains(document.activeElement)) refreshShelfCatToggleList();
  }, 150));
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const name = input.value.trim();
    if(!name){ input.focus(); return; }
    const shelf = shelves.find(s=>s.id===currentShelfKey);
    let cat = categories.find(c=>c.name.toLowerCase() === name.toLowerCase());
    if(!cat){
      const { data, error } = await db('categories').insert({ name }).select().single();
      if(error){ showToast('Fehler beim Anlegen'); return; }
      cat = data;
    }
    if(!(shelf && shelf.categoryIds.includes(cat.id))){
      if(!await toggleShelfCategory(currentShelfKey, cat.id, true)) return;
    }
    await refreshAndRender();
    refreshShelfCatToggleList();
    showToast(`„${cat.name}“ zugeordnet`);
  });
}

function openShelfRenameMode(){
  shelfCatTitleEl.classList.add('hidden');
  shelfEditTitleBtn.classList.add('hidden');
  shelfRenameField.classList.remove('hidden');
  shelfRenameActions.classList.remove('hidden');
  shelfRenameInput.value = currentShelfLabel || '';
  shelfRenameInput.focus();
}

function closeShelfRenameMode(){
  shelfCatTitleEl.classList.remove('hidden');
  shelfEditTitleBtn.classList.remove('hidden');
  shelfRenameField.classList.add('hidden');
  shelfRenameActions.classList.add('hidden');
}

shelfEditTitleBtn.addEventListener('click', openShelfRenameMode);
document.getElementById('shelfRenameCancelBtn').addEventListener('click', closeShelfRenameMode);
document.getElementById('shelfRenameSaveBtn').addEventListener('click', async ()=>{
  const newLabel = shelfRenameInput.value.trim();
  if(!newLabel){ showToast('Bitte einen Titel eingeben'); shelfRenameInput.focus(); return; }
  const { error } = await db('shelves').update({ label: newLabel }).eq('id', currentShelfKey);
  if(error){ showToast('Fehler beim Speichern'); return; }
  setShelfCatTitle(newLabel);
  closeShelfRenameMode();
  await refreshAndRender();
  showToast('Titel gespeichert');
});
shelfRenameInput.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('shelfRenameSaveBtn').click(); }
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeShelfRenameMode(); }
});

document.getElementById('closeShelfCatBtn').addEventListener('click', ()=>shelfCatOverlay.classList.add('hidden'));
shelfCatOverlay.addEventListener('click', (e)=>{ if(e.target===shelfCatOverlay) shelfCatOverlay.classList.add('hidden'); });

// ---- Buch-Suche (innerhalb des angezeigten Regals) ----
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');

searchInput.addEventListener('input', (e)=>{
  searchQuery = e.target.value;
  clearSearchBtn.classList.toggle('show', searchQuery.trim().length > 0);
  render();
});
clearSearchBtn.addEventListener('click', ()=>{
  searchQuery = '';
  searchInput.value = '';
  clearSearchBtn.classList.remove('show');
  searchInput.focus();
  render();
});

// ---- Inhaltsverzeichnis (Reihen) mit Scrollspy ----
const tocMenuBtn = document.getElementById('tocMenuBtn');
const tocOverlay = document.getElementById('tocOverlay');
const tocPanel = document.getElementById('tocPanel');
const tocList = document.getElementById('tocList');
let tocObserver = null;

function openToc(){
  tocOverlay.classList.add('open');
  tocPanel.classList.add('open');
}
function closeToc(){
  tocOverlay.classList.remove('open');
  tocPanel.classList.remove('open');
}
tocMenuBtn.addEventListener('click', openToc);
tocOverlay.addEventListener('click', closeToc);
document.getElementById('tocCloseBtn').addEventListener('click', closeToc);

function updateToc(groups){
  if(tocObserver){ tocObserver.disconnect(); tocObserver = null; }

  // Die Seitenleiste enthält auch Installation und Einstellungen, deshalb bleibt sie immer erreichbar.
  tocMenuBtn.classList.remove('hidden');
  if(!groups || groups.length === 0){
    tocList.innerHTML = '<li class="toc-empty">Keine Reihen in dieser Ansicht.</li>';
    return;
  }
  tocList.innerHTML = groups.map(g=>`
    <li><button type="button" class="toc-item" data-target="shelf-${escapeHtml(g.key)}">${escapeHtml(g.label)}<em>${g.items.length}</em></button></li>
  `).join('');

  tocList.querySelectorAll('.toc-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const target = document.getElementById(btn.getAttribute('data-target'));
      if(target) target.scrollIntoView({behavior:'smooth', block:'start'});
      closeToc();
    });
  });

  setActiveTocItem('shelf-' + groups[0].key);

  const sections = groups
    .map(g=>document.getElementById('shelf-' + g.key))
    .filter(Boolean);
  if(sections.length === 0) return;

  tocObserver = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting) setActiveTocItem(entry.target.id);
    });
  }, { rootMargin: '-10% 0px -75% 0px', threshold: 0 });
  sections.forEach(s=>tocObserver.observe(s));
}

function setActiveTocItem(targetId){
  tocList.querySelectorAll('.toc-item').forEach(btn=>{
    btn.classList.toggle('active', btn.getAttribute('data-target') === targetId);
  });
}

// ---- Buchdetails als Schublade (rechts, auf dem Handy von unten) ----
const bookDetailOverlay = document.getElementById('bookDetailOverlay');
const bookDetailPanel = document.getElementById('bookDetailPanel');

function closeBookDetailPanel(){
  bookDetailOverlay.classList.remove('open');
  bookDetailPanel.classList.remove('open');
  document.body.classList.remove('drawer-open');
}
bookDetailOverlay.addEventListener('click', closeDetail);

// Klick außerhalb schließt die Schublade, der Klick selbst wirkt trotzdem normal weiter.
// Ausnahmen: andere Bücher (wechseln die Auswahl) und Dialoge, die aus der Schublade geöffnet wurden.
document.addEventListener('click', e=>{
  if(!bookDetailPanel.classList.contains('open') || selectedId == null) return;
  const t = e.target;
  if(!(t instanceof Element) || !t.isConnected) return;
  if(bookDetailPanel.contains(t) || t.closest('[data-book], .modal-overlay, .toast')) return;
  closeDetail();
});

function updateBookDetailPanel(){
  const meta = selectedId != null ? bookIndex.get(String(selectedId)) : null;
  if(!meta){
    closeBookDetailPanel();
    return;
  }
  const wasOpen = bookDetailPanel.classList.contains('open');
  const scroll = bookDetailPanel.scrollTop;
  bookDetailPanel.innerHTML = '';
  bookDetailPanel.appendChild(buildDetailCard(meta.book, meta.group, isOwnerView()));
  if(wasOpen) bookDetailPanel.scrollTop = scroll;
  bookDetailOverlay.classList.add('open');
  bookDetailPanel.classList.add('open');
  document.body.classList.add('drawer-open');
}

document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Escape') return;
  const openModal = [...document.querySelectorAll('.modal-overlay')].find(m=>!m.classList.contains('hidden') && m !== usernameModalOverlay);
  if(openModal === scanOverlay){ if(!scanIsBusy()) closeScan(); return; }
  if(openModal){ openModal.classList.add('hidden'); return; }
  if(!notifMenu.classList.contains('hidden')){ setNotifMenu(false); notifBtn.focus(); return; }
  if(tocPanel.classList.contains('open')){ closeToc(); return; }
  if(selectedId != null) closeDetail();
});

// ---- Supporter: Unterstützen-Fenster und Kauf-Fenster ----
// Bezahlt wird auf der Bezahlseite von Stripe (POST /api/checkout im Worker). Freigeschaltet wird erst,
// wenn Stripe dem Worker die Zahlung bestätigt; die App wartet nach der Rückkehr nur darauf.
const supportOverlay = document.getElementById('supportOverlay');
const buyOverlay = document.getElementById('buyOverlay');
const SUPPORT_LEDES = {
  scan: 'Regal scannen ist für Supporter. Unterstütz das Bücherregal und schalte es frei, zusammen mit der Vitrine.',
  vitrine: 'Die Vitrine ist für Supporter. Unterstütz das Bücherregal und schalte sie frei, zusammen mit Regal scannen.',
  default: 'Unterstütz das Bücherregal und schalte zwei Extras frei.',
};
// Wer die Fenster geöffnet hat, bekommt den Fokus zurück, wenn sie wieder zugehen.
let supportOpener = null;
function closeSupportFlow(){
  supportOverlay.classList.add('hidden');
  buyOverlay.classList.add('hidden');
  if(supportOpener && document.contains(supportOpener)) supportOpener.focus();
  supportOpener = null;
}

function openSupport(reason){
  supportOpener = document.activeElement;
  document.getElementById('supportLede').textContent = SUPPORT_LEDES[reason] || SUPPORT_LEDES.default;
  // Die Vorschauen zeigen das eigene Regal: ein Buch, das erkannt und hinzugefügt wird, und die drei
  // Lieblinge in der Vitrine. Ohne Bücher stehen neutrale Platzhalter da.
  const all = [...bookIndex.values()];
  const favs = [...all].sort((a, b)=>(b.book.rating || 0) - (a.book.rating || 0)).slice(0, 3);
  const seen = all[0];
  const thumb = seen ? thumbHtml(seen.book, seen.group) : '<span class="thumb"></span>';
  document.getElementById('supportSpines').innerHTML = thumb;
  document.getElementById('supportFound').innerHTML = `${thumb}<span class="sf-result-text"><b>${escapeHtml(seen ? seen.book.title : 'Dein Buch')}</b><small>${escapeHtml(seen ? seen.book.author || '' : '')}</small></span><i class="sf-tick"></i>`;
  document.getElementById('supportCovers').innerHTML = favs.length
    ? favs.map(({ book, group })=>thumbHtml(book, group)).join('')
    : '<span class="thumb"></span>'.repeat(3);
  supportOverlay.querySelectorAll('[data-feature]').forEach(li=>li.classList.toggle('is-focus', li.getAttribute('data-feature') === reason));
  supportOverlay.classList.remove('is-step', 'is-step-back');
  supportOverlay.classList.remove('hidden');
  supportOverlay.querySelector('.modal').focus();
}
// Zwischen den beiden Fenstern gleitet nur der Inhalt seitlich weiter; der Hintergrund bleibt stehen.
function showModalStep(from, to, back){
  from.classList.add('hidden');
  to.classList.remove('is-step', 'is-step-back');
  void to.offsetWidth; // Animation neu starten
  to.classList.add(back ? 'is-step-back' : 'is-step');
  to.classList.remove('hidden');
}
const buyConfirmBtn = document.getElementById('buyConfirmBtn');
// Ob der Kauf offen ist, weiß nur der Worker (erst mit dem Live-Key von Stripe). null = noch nicht gefragt.
let salesOpen = null;
async function loadSalesOpen(){
  if(salesOpen !== null || DEV_LOCAL) return;
  try {
    const res = await fetch('/api/checkout', { cache: 'no-store' });
    salesOpen = res.ok && (await res.json()).live === true;
  } catch(e){
    salesOpen = false;
  }
  if(!buyOverlay.classList.contains('hidden')) renderBuy();
}
function renderBuy(){
  const note = document.getElementById('buyNote');
  buyConfirmBtn.disabled = false;
  if(ownPremium){
    note.textContent = 'Du bist schon Supporter. Danke, dass du das Bücherregal unterstützt!';
    buyConfirmBtn.textContent = 'Schon freigeschaltet';
    buyConfirmBtn.disabled = true;
  } else if(!DEV_LOCAL && salesOpen !== true){
    note.textContent = salesOpen === null
      ? 'Bezahlt wird sicher über Stripe. Du kannst 14 Tage lang widerrufen und bekommst dann alles zurück.'
      : 'Der Kauf startet in Kürze. Schau bald wieder vorbei!';
    buyConfirmBtn.textContent = salesOpen === null ? 'Einen Moment …' : 'Bald verfügbar';
    buyConfirmBtn.disabled = true;
  } else if(!currentUser){
    note.textContent = DEV_LOCAL
      ? 'Im lokalen Testmodus gibt es keinen Kauf. Teste ihn auf der echten Seite mit Stripes Testkarten.'
      : 'Supporter gilt für dein Konto. Melde dich an, danach geht es direkt weiter zur Zahlung.';
    buyConfirmBtn.textContent = 'Anmelden und weiter';
    buyConfirmBtn.disabled = DEV_LOCAL;
  } else {
    note.textContent = 'Bezahlt wird sicher über Stripe. Du kannst 14 Tage lang widerrufen und bekommst dann alles zurück.';
    buyConfirmBtn.textContent = 'Weiter zur Zahlung';
  }
}
const CHECKOUT_ERRORS = {
  401: 'Bitte melde dich noch einmal an',
  403: 'Mit einem gesperrten Konto ist kein Kauf möglich',
  404: 'Der Kauf ist gerade nicht verfügbar',
  405: 'Der Kauf ist gerade nicht verfügbar',
  503: 'Der Kauf ist gerade nicht verfügbar',
};
async function startCheckout(){
  if(!currentUser){
    setPref(AFTER_LOGIN_KEY, 'buy');
    signInWithGoogle();
    return;
  }
  buyConfirmBtn.disabled = true;
  buyConfirmBtn.textContent = 'Einen Moment …';
  try {
    const { data:{ session } } = await supabaseClient.auth.getSession();
    // Zurück auf dieselbe Ansicht (z. B. das eigene Regal), ohne alte Kauf-Parameter.
    const from = new URLSearchParams(window.location.search);
    from.delete('kauf');
    const fromPath = SHELF_PATH.test(window.location.pathname) ? window.location.pathname.replace(/\/$/, '') : '';
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ from: fromPath + (from.toString() ? `?${from}` : '') }),
    });
    const body = await res.json().catch(()=>({}));
    if(res.ok && body.url){ window.location.href = body.url; return; }
    if(res.status === 409){ ownPremium = true; renderBuy(); showToast('Du bist schon Supporter'); return; }
    showToast(CHECKOUT_ERRORS[res.status] || 'Die Bezahlseite ließ sich nicht öffnen. Versuch es gleich noch einmal.');
  } catch(e){
    showToast('Keine Verbindung. Versuch es gleich noch einmal.');
  }
  renderBuy();
}
buyConfirmBtn.addEventListener('click', startCheckout);

// Rückkehr von Stripe: ?kauf=danke oder ?kauf=abgebrochen. Stripe meldet die Zahlung dem Worker meist
// innerhalb von Sekunden; so lange fragt die App nach, ob Premium schon da ist.
async function handlePurchaseReturn(){
  const params = new URLSearchParams(window.location.search);
  const kauf = params.get('kauf');
  if(!kauf) return;
  params.delete('kauf');
  history.replaceState({}, '', window.location.pathname + (params.toString() ? `?${params}` : ''));
  if(kauf === 'abgebrochen'){ showToast('Kauf abgebrochen, es wurde nichts berechnet'); return; }
  if(kauf !== 'danke' || !currentUser) return;
  showToast('Danke! Supporter wird freigeschaltet …');
  for(let i = 0; i < 15 && !ownPremium; i++){
    await new Promise(r=>setTimeout(r, 2000));
    await loadPremium();
  }
  if(ownPremium){
    render();
    showToast('Danke für deine Unterstützung! Regal scannen und die Vitrine sind freigeschaltet.');
  } else {
    showToast('Die Freischaltung dauert länger als sonst. Lad die Seite in ein paar Minuten neu.');
  }
}

let buyFromSupport = false;
function openBuy(){
  renderBuy();
  loadSalesOpen();
  buyFromSupport = !supportOverlay.classList.contains('hidden');
  document.getElementById('buyBackBtn').classList.toggle('hidden', !buyFromSupport);
  if(buyFromSupport) showModalStep(supportOverlay, buyOverlay, false);
  else {
    supportOpener = document.activeElement;
    buyOverlay.classList.remove('is-step', 'is-step-back');
    buyOverlay.classList.remove('hidden');
  }
  buyOverlay.querySelector('.modal').focus();
}
document.getElementById('supportCloseBtn').addEventListener('click', closeSupportFlow);
document.getElementById('supportLaterBtn').addEventListener('click', closeSupportFlow);
document.getElementById('supportBuyBtn').addEventListener('click', openBuy);
supportOverlay.addEventListener('click', e=>{ if(e.target === supportOverlay) closeSupportFlow(); });
document.getElementById('buyCloseBtn').addEventListener('click', closeSupportFlow);
// Der Pfeil zurück erscheint nur, wenn man aus dem Unterstützen-Fenster kam.
document.getElementById('buyBackBtn').addEventListener('click', ()=>{
  showModalStep(buyOverlay, supportOverlay, true);
  supportOverlay.querySelector('.modal').focus();
});
buyOverlay.addEventListener('click', e=>{ if(e.target === buyOverlay) closeSupportFlow(); });
document.getElementById('perksBuyBtn').addEventListener('click', openBuy);

// ---- Einstellungen ----
const settingsOverlay = document.getElementById('settingsOverlay');
const setTheme = document.getElementById('setTheme');
const setSort = document.getElementById('setSort');
const setFace = document.getElementById('setFace');

function openSettings(){
  closeToc();
  renderThemeChoices(setTheme);
  setSort.value = getPref(SORT_KEY, 'alpha');
  setFace.value = getPref(FACE_KEY, 'first');
  settingsOverlay.querySelectorAll('[data-set-view]').forEach(b=>b.setAttribute('aria-pressed', b.getAttribute('data-set-view') === viewMode));
  const owner = isOwnerView();
  document.getElementById('ownerSettings').classList.toggle('hidden', !owner);
  document.getElementById('setUsernameBtn').classList.toggle('hidden', !(owner && currentProfile));
  document.getElementById('setDevRow').classList.toggle('hidden', !devSandboxActive());
  document.getElementById('setDevAsRow').classList.toggle('hidden', !(DEV_LOCAL && !currentUser));
  setDevAsSelect.value = devAs;
  settingsOverlay.classList.remove('hidden');
}
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('profileSettingsBtn').addEventListener('click', ()=>{
  document.getElementById('profilePanel').classList.add('hidden');
  openSettings();
});
document.getElementById('settingsCloseBtn').addEventListener('click', ()=>settingsOverlay.classList.add('hidden'));
settingsOverlay.addEventListener('click', e=>{ if(e.target === settingsOverlay) settingsOverlay.classList.add('hidden'); });

setSort.addEventListener('change', ()=>{ setPref(SORT_KEY, setSort.value); render(); });
setFace.addEventListener('change', ()=>{ setPref(FACE_KEY, setFace.value); displayedId = null; render(); });
settingsOverlay.querySelectorAll('[data-set-view]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    viewMode = btn.getAttribute('data-set-view');
    setPref(VIEW_KEY, viewMode);
    settingsOverlay.querySelectorAll('[data-set-view]').forEach(b=>b.setAttribute('aria-pressed', b === btn));
    render();
  });
});
document.getElementById('setCategoriesBtn').addEventListener('click', ()=>{
  settingsOverlay.classList.add('hidden');
  document.getElementById('openCatBtn').click();
});
document.getElementById('setUsernameBtn').addEventListener('click', ()=>{
  settingsOverlay.classList.add('hidden');
  openAccount();
});
document.getElementById('setShareBtn').addEventListener('click', ()=>{
  settingsOverlay.classList.add('hidden');
  openShare();
});
document.getElementById('setReloadCoversBtn').addEventListener('click', ()=>{
  coverCache = {};
  coverGaveUp.clear();
  coverPainted.clear();
  try { localStorage.removeItem(COVER_CACHE_KEY); } catch(e){}
  settingsOverlay.classList.add('hidden');
  render();
  showToast('Cover werden neu geladen');
});
document.getElementById('setDevResetBtn').addEventListener('click', ()=>{
  settingsOverlay.classList.add('hidden');
  resetSandbox();
});
const setDevAsSelect = document.getElementById('setDevAs');
setDevAsSelect.innerHTML = DEV_IDENTITIES.map(u=>`<option value="${u}">@${u}${u === DEFAULT_USERNAME ? ' (Admin, Premium)' : ' (ohne Premium)'}</option>`).join('');
setDevAsSelect.addEventListener('change', ()=>{
  settingsOverlay.classList.add('hidden');
  setDevAs(setDevAsSelect.value);
});
document.getElementById('setTourBtn').addEventListener('click', ()=>{
  settingsOverlay.classList.add('hidden');
  startTour();
});

// ---- Einführung: kurze Tour nach dem ersten Login, jederzeit überspringbar ----
const tourEl = document.getElementById('tour');
const tourSpot = document.getElementById('tourSpot');
const tourCard = document.getElementById('tourCard');
const tourNext = document.getElementById('tourNext');
const tourBack = document.getElementById('tourBack');
const TOUR_STEPS = [
  {
    title: ()=>{
      const p = currentProfile || viewedProfile;
      return p && p.username ? `Willkommen, ${shownName(p)}!` : 'Willkommen!';
    },
    text: 'Das ist dein Regal. In ein paar Schritten siehst du, wo alles ist. Du kannst die Tour jederzeit überspringen.',
  },
  {
    target: ()=>document.getElementById('openAddBtn'),
    title: 'Bücher hinzufügen',
    text: 'Tipp einen Titel ein, und das Regal schlägt passende Bücher vor. Cover, Autor, Seiten und Klappentext kommen von allein.',
  },
  {
    // Ein ganzes Brett ist zu hoch, um das Kärtchen daneben zu setzen; deshalb das erste Buch, im leeren Regal der Hinweis.
    target: ()=>document.querySelector('#shelves [data-book]') || document.getElementById('shelves'),
    // In der Cover-Ansicht gibt es keine Bretter, nur Raster pro Reihe.
    title: ()=>viewMode === 'grid' ? 'Sortiert nach Reihen' : 'Ein Brett pro Reihe',
    text: ()=>viewMode === 'grid'
      ? 'Bände einer Reihe stehen zusammen, ein Einzelband ist eine Reihe mit einem Buch. Über „Regal“ stellst du sie als Buchrücken ins Regal. Tipp ein Buch an, um Sterne, Notizen und Lesedatum zu setzen.'
      : 'Jede Reihe bekommt ihr eigenes Regalbrett, ein Einzelband ist eine Reihe mit einem Buch. Tipp ein Buch an, um Sterne, Notizen und Lesedatum zu setzen.',
  },
  {
    target: ()=>document.getElementById('openCatBtn'),
    title: 'Kategorien',
    text: 'Lege Kategorien wie Fantasy oder Krimi an. Sie gelten für ganze Reihen und erscheinen als Filter über dem Regal.',
  },
  {
    target: ()=>document.getElementById('userSearchBox'),
    title: 'Andere Regale entdecken',
    text: 'Finde Freunde über ihren Namen und folge ihren Regalen. Die Glocke meldet sich, wenn sie ein neues Buch bewerten.',
  },
  {
    target: ()=>document.getElementById('shareBtn'),
    title: 'Regal teilen',
    text: 'Dein Regal hat einen eigenen Link. Andere stöbern darin, ohne sich anmelden zu müssen.',
  },
  {
    // Der Knopf steckt in der Seitenleiste; nur zeigen, wenn dieser Browser die Installation auch anbietet.
    when: ()=>!installBtn.classList.contains('hidden'),
    menu: true,
    target: ()=>installBtn,
    title: 'Auch als App',
    text: 'Leg dir das Bücherregal auf den Startbildschirm. Es öffnet sich dann wie eine App, ohne Browserleiste. Den Knopf findest du jederzeit hier im Menü.',
  },
];
let tourSteps = [];
let tourIndex = 0;
let tourFrame = 0;
let tourReturnFocus = null;

function tourTarget(step){
  const el = step.target && step.target();
  if(!el) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height ? el : null;
}

function startTour(){
  closeToc();
  closeDetail();
  // Ziele, die gerade nicht sichtbar sind (z. B. auf dem Handy), fallen einfach weg.
  tourSteps = TOUR_STEPS.filter(s=>s.when ? s.when() : !s.target || tourTarget(s));
  tourIndex = 0;
  tourReturnFocus = document.activeElement;
  document.getElementById('tourDots').innerHTML = tourSteps.map(()=>'<i></i>').join('');
  tourEl.classList.remove('hidden');
  showTourStep();
}

function endTour(){
  tourEl.classList.add('hidden');
  closeToc();
  if(tourReturnFocus && tourReturnFocus.isConnected) tourReturnFocus.focus();
}

function showTourStep(){
  const step = tourSteps[tourIndex];
  const last = tourIndex === tourSteps.length - 1;
  document.getElementById('tourTitle').textContent = typeof step.title === 'function' ? step.title() : step.title;
  document.getElementById('tourText').textContent = typeof step.text === 'function' ? step.text() : step.text;
  document.getElementById('tourCount').textContent = `Schritt ${tourIndex + 1} von ${tourSteps.length}`;
  document.querySelectorAll('#tourDots i').forEach((d, i)=>d.classList.toggle('on', i === tourIndex));
  tourBack.classList.toggle('hidden', tourIndex === 0);
  document.getElementById('tourSkip').classList.toggle('hidden', last);
  tourNext.textContent = last ? 'Los geht’s' : 'Weiter';

  if(step.menu) openToc(); else closeToc();
  const el = !step.menu && tourTarget(step);
  if(el && !el.closest('.topbar')){
    // Ziel und Kärtchen sollen zusammen ins Bild passen, ohne dass das Kärtchen das Ziel verdeckt (auf dem Handy oft knapp).
    const r = el.getBoundingClientRect(), ch = tourCard.offsetHeight, { top, bottom } = tourInsets();
    const head = document.querySelector('.topbar').offsetHeight + TOUR_PAD;
    const vh = window.innerHeight;
    const visible = r.top - TOUR_PAD >= head && r.bottom + TOUR_PAD <= vh - bottom;
    const roomBelow = r.bottom + TOUR_PAD + TOUR_GAP + ch <= vh - bottom;
    const roomAbove = r.top - TOUR_PAD - TOUR_GAP - ch >= top;
    if(!visible || !(roomBelow || roomAbove)){
      const fitsUnderHead = head + r.height + 2 * TOUR_PAD + TOUR_GAP + ch <= vh - bottom;
      const delta = fitsUnderHead ? r.top - TOUR_PAD - head : r.top + r.height / 2 - vh / 2;
      window.scrollBy({ top: delta, behavior: 'smooth' });
    }
  }
  placeTour();
  tourNext.focus({ preventScroll: true });
}

const TOUR_GAP = 14, TOUR_PAD = 6, TOUR_EDGE = 16;
// Abstand zu den Rändern, auf dem iPhone zusätzlich zu Notch und Home-Balken (aus dem Padding von .tour).
function tourInsets(){
  const cs = getComputedStyle(tourEl);
  return { top: TOUR_EDGE + parseFloat(cs.paddingTop), bottom: TOUR_EDGE + parseFloat(cs.paddingBottom) };
}

function placeTour(){
  const step = tourSteps[tourIndex];
  const el = step && tourTarget(step);
  const vw = window.innerWidth, vh = window.innerHeight, gap = TOUR_GAP, pad = TOUR_PAD, edge = TOUR_EDGE;
  const insets = tourInsets();
  tourEl.classList.toggle('is-center', !el);
  const cw = tourCard.offsetWidth, ch = tourCard.offsetHeight;

  if(!el){
    tourSpot.style.cssText = `left:${vw / 2}px; top:${vh / 2}px; width:0; height:0;`;
    tourCard.style.left = Math.max(edge, (vw - cw) / 2) + 'px';
    tourCard.style.top = Math.max(insets.top, (vh - ch) / 2) + 'px';
    return;
  }

  const r = el.getBoundingClientRect();
  const top = Math.max(r.top - pad, 0), bottom = Math.min(r.bottom + pad, vh);
  const left = Math.max(r.left - pad, 0), right = Math.min(r.right + pad, vw);
  tourSpot.style.cssText = `left:${left}px; top:${top}px; width:${right - left}px; height:${Math.max(bottom - top, 0)}px;`;

  // Unter dem Ziel, sonst darüber, sonst unten am Rand.
  let y = bottom + gap;
  if(y + ch > vh - insets.bottom) y = top - gap - ch >= insets.top ? top - gap - ch : vh - insets.bottom - ch;
  const x = Math.min(Math.max((left + right) / 2 - cw / 2, edge), vw - edge - cw);
  tourCard.style.left = x + 'px';
  tourCard.style.top = Math.max(y, insets.top) + 'px';
}

function scheduleTourPlace(){
  if(tourEl.classList.contains('hidden') || tourFrame) return;
  tourFrame = requestAnimationFrame(()=>{ tourFrame = 0; placeTour(); });
}
window.addEventListener('resize', scheduleTourPlace);
window.addEventListener('scroll', scheduleTourPlace, { passive: true });
tocPanel.addEventListener('transitionend', scheduleTourPlace); // Seitenleiste fährt ein oder aus

tourNext.addEventListener('click', ()=>{
  if(tourIndex >= tourSteps.length - 1){ endTour(); return; }
  tourIndex++;
  showTourStep();
});
tourBack.addEventListener('click', ()=>{
  if(tourIndex === 0) return;
  tourIndex--;
  showTourStep();
});
document.getElementById('tourSkip').addEventListener('click', endTour);

// Vor allen anderen Tastenkürzeln, damit Escape nur die Tour schließt und Tab im Kärtchen bleibt.
window.addEventListener('keydown', e=>{
  if(tourEl.classList.contains('hidden')) return;
  if(e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); endTour(); return; }
  if(e.key === 'ArrowRight'){ e.preventDefault(); tourNext.click(); return; }
  if(e.key === 'ArrowLeft'){ e.preventDefault(); tourBack.click(); return; }
  if(e.key === 'Tab'){
    const btns = [...tourCard.querySelectorAll('button:not(.hidden)')];
    const i = btns.indexOf(document.activeElement);
    e.preventDefault();
    btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
  }
}, true);

// ---- Als App installieren (PWA) ----
const installBtn = document.getElementById('installBtn');
const installHelp = document.getElementById('installHelpOverlay');
let deferredInstall = null;
const isStandalone = ()=>window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function updateInstallUI(){
  installBtn.classList.toggle('hidden', isStandalone() || !(deferredInstall || isIOS));
}
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault(); // eigenen Knopf in der Seitenleiste statt Browser-Banner
  deferredInstall = e;
  updateInstallUI();
});
window.addEventListener('appinstalled', ()=>{
  deferredInstall = null;
  updateInstallUI();
  showToast('Bücherregal ist jetzt als App installiert');
});
installBtn.addEventListener('click', async ()=>{
  if(deferredInstall){
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    updateInstallUI();
    return;
  }
  document.getElementById('installHelpText').textContent = 'Auf dem iPhone geht das über Safari:';
  document.getElementById('installHelpSteps').innerHTML =
    '<li>Tippe unten auf das Teilen-Symbol (Quadrat mit Pfeil nach oben).</li>' +
    '<li>Wähle „Zum Home-Bildschirm“.</li>' +
    '<li>Tippe auf „Hinzufügen“. Das Bücherregal erscheint als App-Symbol.</li>';
  closeToc();
  installHelp.classList.remove('hidden');
});
document.getElementById('installHelpClose').addEventListener('click', ()=>installHelp.classList.add('hidden'));
installHelp.addEventListener('click', e=>{ if(e.target === installHelp) installHelp.classList.add('hidden'); });
updateInstallUI();

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
}

// ---- Start ----
async function boot(){
  syncViewButtons();
  await Promise.all([ initAuth(), applyRoute() ]);
  render();
  handlePurchaseReturn();
}
boot();
