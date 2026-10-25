const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const DEFAULT_USERNAME = 'antonio';

let currentUser = null;    // eingeloggter Auth-User (oder null)
let currentProfile = null; // profiles-Zeile des eingeloggten Users

let viewedProfile = null;  // profiles-Zeile des Regals, das gerade angezeigt wird

let books = [];       // Zeilen aus public.books für viewedProfile
let shelves = [];     // Zeilen aus public.shelves für viewedProfile
let categories = [];  // Zeilen aus public.categories für viewedProfile: {id, name}

let selectedId = null;
let displayedId = null; // Buch, das in seiner Reihe frontal steht; alle anderen Reihen zeigen ihren ersten Band
let shelfLoading = true;
let shelfLoadError = false;
let editingBookId = null;
let activeCategory = null;
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

function pumpCovers(){
  while(coverActive < 2 && coverQueue.length){
    const b = coverQueue.shift();
    coverActive++;
    processCover(b).finally(()=>{
      coverActive--;
      coverQueued.delete(coverKey(b));
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
    let chosen = null, first = null, analyzed = 0;
    for(const id of entry.candidates || []){
      const info = await analyzeCover(coverUrl(id, 'M'));
      if(info.error) continue;
      analyzed++;
      if(!first) first = { id, info };
      if(!info.photo){ chosen = { id, info }; break; }
    }
    // Alle Bilder fehlgeschlagen = vermutlich Netzproblem: nicht als erledigt merken, beim nächsten Laden erneut.
    if((entry.candidates || []).length && !analyzed){
      coverGaveUp.add(coverKey(b));
      refreshBookVisual(b);
      return;
    }
    chosen = chosen || first;
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
  const meta = bookIndex.get(String(b.id));
  (meta ? meta.group.items : [b]).forEach(refreshBookVisual);
  scheduleFit();
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
  const meta = bookIndex.get(String(b.id));
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
    urlLarge: has ? (entry.srcLarge || entry.src) : null,
  };
}

function visualStyle(v, large){
  let s = `--c:${v.rgb.join(',')};--g:${v.ground.join(',')};--l:${v.letter.join(',')};--ratio:${v.ratio.toFixed(3)};--w:${v.width};--hf:${v.hf}`;
  if(v.url) s += large ? `;--cover:url('${v.urlLarge}');--cover-sm:url('${v.url}')` : `;--cover:url('${v.url}')`;
  if(v.emblem) s += `;--emblem:url('${v.emblem.url}');--ex:${v.emblem.x}%;--ey:${v.emblem.y}%;--es:${v.emblem.size}%`;
  return s;
}

function refreshBookVisual(b){
  const meta = bookIndex.get(String(b.id));
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
  if(!GB_KEY || gbUnavailable) return [];
  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=10&printType=books&key=${encodeURIComponent(GB_KEY)}`);
    // Gesperrt oder Kontingent leer: für diese Sitzung nur noch Open Library fragen.
    if(r.status === 403 || r.status === 429){ gbUnavailable = true; return []; }
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
      };
    }).filter(c=>c.title);
  } catch(e){ return []; }
}

async function searchOpenLibrary(q){
  try {
    const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=10&fields=key,title,author_name,first_publish_year,cover_i,number_of_pages_median`);
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
      twin.covers.push(...(c.cover ? [{ url: c.cover, label: c.source }] : []));
      return;
    }
    merged.push({ ...c, _k: k, covers: c.cover ? [{ url: c.cover, label: c.source + (c.year ? ' · ' + c.year : '') }] : [] });
  });
  return merged;
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
async function findCoverOptions(title, author, preset = [], seriesLabel = ''){
  const list = [];
  const push = (u, label)=>{ const s = safeImageUrl(u); if(s && !list.some(o=>o.url === s)) list.push({ url: s, label }); };
  preset.forEach(o=>push(o.url, o.label));
  const res = await searchBooks([title, author].filter(Boolean).join(' '));
  const hits = res.filter(c=>titleMatches(c.title, title));
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

async function findDescription(title, author){
  const res = await searchBooks([title, author].filter(Boolean).join(' '));
  const hits = res.filter(c=>titleMatches(c.title, title));
  for(const c of hits){
    const d = await fetchDescription(c);
    if(d) return d;
  }
  return '';
}

// Wiederverwendbare Cover-Auswahl: "" = automatisch suchen, "none" = bewusst kein Cover, sonst Bild-URL.
function createCoverPicker(container){
  const state = { value: '', options: [], loading: false };
  const render = ()=>{
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
  return !!(currentUser && viewedProfile && currentUser.id === viewedProfile.id);
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
const themeMenu = document.getElementById('themeMenu');
const themeBtn = document.getElementById('themeBtn');
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
function renderThemeMenu(){
  const current = savedTheme();
  themeMenu.innerHTML = THEMES.map(t=>`
    <button type="button" class="theme-item" role="menuitemradio" aria-checked="${t.id === current}" data-theme-id="${t.id}">
      <span class="theme-swatch" style="background:${t.wall}"><i style="background:${t.accent}"></i><b style="background:${t.shelf}"></b></span>
      <span class="theme-text"><span class="theme-name">${t.name}</span><span class="theme-note">${t.note}</span></span>
    </button>`).join('');
  themeMenu.querySelectorAll('.theme-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-theme-id');
      try { localStorage.setItem(THEME_KEY, id); } catch(e){}
      applyTheme(id);
      renderThemeMenu();
    });
  });
}
function setThemeMenu(open){
  themeMenu.classList.toggle('hidden', !open);
  themeBtn.setAttribute('aria-expanded', open);
  if(open) renderThemeMenu();
}
themeBtn.addEventListener('click', e=>{ e.stopPropagation(); setThemeMenu(themeMenu.classList.contains('hidden')); });
document.addEventListener('click', e=>{ if(!document.getElementById('themePicker').contains(e.target)) setThemeMenu(false); });
themeMenu.addEventListener('keydown', e=>{ if(e.key === 'Escape'){ e.stopPropagation(); setThemeMenu(false); themeBtn.focus(); } });
darkQuery.addEventListener('change', ()=>{ if(savedTheme() === 'auto') applyTheme('auto'); });
applyTheme(savedTheme());

// ---- Lokaler Testmodus ----
// Auf localhost ist man ohne Login Besitzer von Antonios Regal. Alle Änderungen landen in einer
// Kopie im localStorage; die echte Datenbank wird nie beschrieben (RLS würde es ohnehin ablehnen).
const DEV_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost');
const SANDBOX_KEY = 'bookshelf-dev-sandbox-v1';
let sandbox = null;
try { sandbox = JSON.parse(localStorage.getItem(SANDBOX_KEY)); } catch(e){ sandbox = null; }

function devSandboxActive(){
  return DEV_LOCAL && !currentUser && !!viewedProfile && viewedProfile.username === DEFAULT_USERNAME;
}

function saveSandbox(){
  try { localStorage.setItem(SANDBOX_KEY, JSON.stringify(sandbox)); } catch(e){ showToast('Lokaler Speicher ist voll'); }
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
}

function seedSandbox(profileId, cats, shelvesData, booksData){
  sandbox = {
    profileId,
    categories: cats.map(c=>({ ...c })),
    shelves: shelvesData.map(({ shelf_categories, ...s })=>({ ...s })),
    shelf_categories: shelvesData.flatMap(s=>(s.shelf_categories || []).map(sc=>({ shelf_id: s.id, category_id: sc.category_id }))),
    books: booksData.map(b=>({ ...b })),
  };
  saveSandbox();
}

async function resetSandbox(){
  sandbox = null;
  try { localStorage.removeItem(SANDBOX_KEY); } catch(e){}
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
    }
  } else {
    currentProfile = null;
  }
  // Login/Logout auf localhost wechselt zwischen Testkopie und echten Daten.
  if(DEV_LOCAL && viewedProfile) await loadShelfData(viewedProfile.id);
  render();
}

async function loadProfile(){
  const { data, error } = await supabaseClient
    .from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  if(error){ showToast('Profil konnte nicht geladen werden'); return; }
  currentProfile = data;
}

const LOGIN_HINT_DISMISSED_KEY = 'bookshelf-login-hint-dismissed';
function loginHintDismissed(){
  try { return localStorage.getItem(LOGIN_HINT_DISMISSED_KEY) === '1'; } catch(e){ return false; }
}

function renderAuthUI(){
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
    document.getElementById('profileDisplayName').textContent = currentProfile.display_name || '';

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

    const showMyShelf = currentProfile.username && !isOwnerView();
    myShelfBtn.classList.toggle('hidden', !showMyShelf);
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
  // Feste URL ohne Query-String (z.B. ?u=irgendwer), damit die Redirect-URL
  // immer exakt zu einem Eintrag in Supabase -> Authentication -> Redirect URLs
  // passt, egal von welcher Profilansicht aus man sich anmeldet.
  const stableRedirect = window.location.origin + window.location.pathname;
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
document.getElementById('myShelfBtn').addEventListener('click', ()=>{
  document.getElementById('profilePanel').classList.add('hidden');
  if(currentProfile && currentProfile.username) goToUser(currentProfile.username);
});

document.getElementById('userChipTrigger').addEventListener('click', (e)=>{
  e.stopPropagation();
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
    showToast(error.code === '23505' ? 'Nutzername bereits vergeben' : 'Fehler beim Speichern');
    return;
  }
  currentProfile.username = val;
  usernameModalOverlay.classList.add('hidden');
  await goToUser(val);
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
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('username, avatar_url')
    .not('username', 'is', null)
    .ilike('username', `%${q}%`)
    .limit(8);

  if(error || !data || data.length === 0){
    userSearchResults.innerHTML = '<p class="user-search-empty">Keine Nutzer gefunden.</p>';
    userSearchResults.classList.remove('hidden');
    return;
  }
  userSearchResults.innerHTML = data.map(p=>`
    <button type="button" class="user-search-item" data-username="${escapeHtml(p.username)}">
      ${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}" alt="" referrerpolicy="no-referrer">` : '<span class="user-search-avatar-fallback"></span>'}
      <span>@${escapeHtml(p.username)}</span>
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

// ---- Regal-Routing (welches Profil wird angezeigt) ----
function usernameFromURL(){
  const params = new URLSearchParams(window.location.search);
  // Ohne ?u= (z. B. beim Start der installierten App) das zuletzt angesehene Regal öffnen.
  return (params.get('u') || getPref(LAST_USER_KEY, DEFAULT_USERNAME)).toLowerCase();
}

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
  const { data, error } = await supabaseClient
    .from('profiles').select('*').eq('username', username.toLowerCase()).maybeSingle();

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
  const url = new URL(window.location.href);
  url.searchParams.set('u', username.toLowerCase());
  history.pushState({}, '', url);
  await loadViewedUserByUsername(username);
}

window.addEventListener('popstate', loadViewedUserFromURL);

// ---- Daten laden ----
async function loadShelfData(profileId){
  const useSandbox = devSandboxActive();
  if(useSandbox && sandbox && sandbox.profileId === profileId){
    applySandboxToState();
    return;
  }
  const [{data: cats, error: catErr}, {data: shelvesData, error: shelfErr}, {data: booksData, error: bookErr}] = await Promise.all([
    supabaseClient.from('categories').select('*').eq('user_id', profileId).order('name'),
    supabaseClient.from('shelves').select('*, shelf_categories(category_id)').eq('user_id', profileId),
    supabaseClient.from('books').select('*').eq('user_id', profileId).order('series_order'),
  ]);
  if(catErr || shelfErr || bookErr){
    showToast('Daten konnten nicht geladen werden');
    return;
  }
  if(useSandbox){
    seedSandbox(profileId, cats || [], shelvesData || [], booksData || []);
    applySandboxToState();
    return;
  }
  categories = cats || [];
  shelves = (shelvesData || []).map(s=>({
    ...s,
    categoryIds: (s.shelf_categories || []).map(sc=>sc.category_id),
  }));
  books = booksData || [];
}

async function refreshAndRender(){
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
  if(cats.length === 0){ bar.innerHTML = ''; return; }
  const pills = [`<button class="filter-pill ${activeCategory===null?'active':''}" data-cat="" aria-pressed="${activeCategory===null}">Alle</button>`]
    .concat(cats.map(c=>`<button class="filter-pill ${activeCategory===c?'active':''}" data-cat="${escapeHtml(c)}" aria-pressed="${activeCategory===c}">${escapeHtml(c)}</button>`));
  bar.innerHTML = pills.join('');
  bar.querySelectorAll('.filter-pill').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const cat = btn.getAttribute('data-cat');
      activeCategory = cat === '' ? null : cat;
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

  const displayName = viewedProfile.username.charAt(0).toUpperCase() + viewedProfile.username.slice(1);
  h1.textContent = owner ? 'Mein Regal' : `${displayName}s Regal`;
  const since = viewedProfile.created_at
    ? ' · seit ' + new Date(viewedProfile.created_at).toLocaleDateString('de-DE', {month:'long', year:'numeric'})
    : '';
  sub.textContent = '@' + viewedProfile.username + since;
  shareBtn.classList.remove('hidden');
  document.title = owner ? 'Mein Bücherregal' : `${displayName}s Bücherregal`;

  if(owner){
    banner.classList.add('hidden');
  } else {
    banner.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Nur ansehen';
    banner.classList.remove('hidden');
  }

  const rated = books.filter(b=>b.rating > 0);
  const avg = rated.length ? (rated.reduce((s,b)=>s+b.rating,0) / rated.length).toLocaleString('de-DE', {minimumFractionDigits:1, maximumFractionDigits:1}) : '–';
  const seriesCount = buildGroups().length;
  stats.innerHTML = `
    <div><dt>Bücher</dt><dd>${books.length}</dd></div>
    <div><dt>${seriesCount === 1 ? 'Reihe' : 'Reihen'}</dt><dd>${seriesCount}</dd></div>
    <div><dt>Ø Bewertung</dt><dd>${avg}</dd></div>`;
}

async function shareShelf(){
  if(!viewedProfile) return;
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('u', viewedProfile.username);
  const shareUrl = url.toString();

  if(navigator.share){
    try { await navigator.share({ title: 'Bücherregal von @' + viewedProfile.username, url: shareUrl }); }
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
document.getElementById('shareBtn').addEventListener('click', shareShelf);

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
  return `<header class="series-head"><div class="series-line"><h2 class="series-title">${escapeHtml(group.label)}</h2><span class="series-sub"><span class="series-meta">${meta}</span>${edit}</span></div>${tags ? `<div class="cat-tags">${tags}</div>` : ''}</header>`;
}

// Pro Reihe steht genau ein Band frontal: der zuletzt gewählte dieser Reihe, sonst der erste.
function faceOutId(group){
  if(displayedId != null && group.items.some(b=>String(b.id) === String(displayedId))) return String(displayedId);
  const lead = getPref(FACE_KEY, 'first') === 'latest' ? group.items[group.items.length - 1] : group.items[0];
  return String(lead.id);
}

function bookHtml(b, group){
  const v = bookVisual(b, group.label);
  const isSel = String(b.id) === String(selectedId);
  const isOut = faceOutId(group) === String(b.id);
  const multi = group.items.length > 1;
  const label = multi ? `${b.title}, Band ${b.series_order}` : b.title;
  return `<button type="button" class="book ${v.ink} ${v.has?'has-cover':''} ${v.loading?'is-loading':''} ${v.emblem?'has-emblem':''} ${isOut?'open':''} ${isSel?'selected':''}" data-book="${escapeHtml(b.id)}" style="${escapeHtml(visualStyle(v))}" aria-label="${escapeHtml(label)}" aria-pressed="${isSel}">
    <span class="book-3d">
      <span class="face spine"><span class="spine-emblem"></span><span class="spine-title">${escapeHtml(b.title)}</span><span class="spine-no">${multi ? b.series_order : ''}</span></span>
      <span class="face front">${genCoverHtml(b, group)}</span>
    </span>
  </button>`;
}

function tileHtml(b, group){
  const v = bookVisual(b, group.label);
  const isSel = String(b.id) === String(selectedId);
  const multi = group.items.length > 1;
  const stars = b.rating > 0 ? `<span class="tile-stars" aria-label="${b.rating} von 5 Sternen">${[1,2,3,4,5].map(i=>starsSVG(i<=b.rating)).join('')}</span>` : '';
  return `<button type="button" class="tile ${v.ink} ${v.has?'has-cover':''} ${v.loading?'is-loading':''} ${isSel?'open':''}" data-book="${escapeHtml(b.id)}" style="${escapeHtml(visualStyle(v))}" aria-pressed="${isSel}">
    <span class="tile-cover">${genCoverHtml(b, group)}</span>
    <span class="tile-title">${escapeHtml(b.title)}</span>
    <span class="tile-meta">${multi ? `Band ${b.series_order}` : escapeHtml(b.author || 'Einzelband')}</span>
    ${stars}
  </button>`;
}

function render(){
  const owner = isOwnerView();
  document.getElementById('devBanner').classList.toggle('hidden', !devSandboxActive());
  renderAuthUI();
  renderHeader(owner);
  syncViewButtons();
  document.getElementById('headerActions').classList.toggle('hidden', !owner);

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

  if(books.length === 0){
    container.innerHTML = owner
      ? '<div class="empty-state"><p>Dein Regal ist noch leer. Stell mit „+ Buch“ dein erstes Buch hinein.</p></div>'
      : '<div class="empty-state"><p>Dieses Regal ist noch leer.</p></div>';
    lastGroups = [];
    updateToc([]);
    updateBookDetailPanel();
    return;
  }

  let groups = buildGroups();
  if(activeCategory){
    groups = groups.filter(g=>g.categories.some(c=>c.name===activeCategory));
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
      : '<div class="empty-state"><p>Keine Bücher in dieser Kategorie.</p></div>';
    updateToc([]);
    updateBookDetailPanel();
    return;
  }

  container.innerHTML = groups.map(group=>{
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
  queueCovers(groups.flatMap(g=>g.items));
  scheduleFit();
}

// Rückentitel dürfen nie über den Buchrand laufen: lange Titel werden schrittweise kleiner gesetzt.
let fitFrame = 0;
function scheduleFit(){
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(()=>{
    document.querySelectorAll('#shelves .spine-title').forEach(t=>{
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

  const dateBlockHtml = owner
    ? `<label class="detail-row"><span class="row-label">Gelesen am</span><input type="date" class="f-date" value="${escapeHtml(book.date_read||'')}"></label>`
    : (book.date_read ? `<p class="detail-row"><span class="row-label">Gelesen am</span><span class="row-value">${escapeHtml(formatDate(book.date_read))}</span></p>` : '');

  const pagesBlockHtml = owner
    ? `<label class="detail-row"><span class="row-label">Seitenzahl</span><input type="number" class="f-pages" min="1" placeholder="${v.pages && v.pagesEstimated ? 'ca. ' + v.pages : 'optional'}" value="${book.page_count||''}"></label>`
    : (pagesText ? `<p class="detail-row"><span class="row-label">Umfang</span><span class="row-value">${escapeHtml(pagesText)}</span></p>` : '');

  const summaryBlockHtml = owner
    ? `<div class="detail-block"><label><span class="row-label">Klappentext</span><textarea class="f-summary" rows="3" placeholder="Worum geht's? (optional)">${escapeHtml(book.summary||'')}</textarea></label>${book.summary ? '' : '<button type="button" class="link-btn summary-search">Klappentext automatisch suchen</button>'}</div>`
    : (book.summary ? `<div class="detail-block"><span class="row-label">Klappentext</span><p class="detail-text">${escapeHtml(book.summary)}</p></div>` : '');

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
        ${owner && !isEditing ? `<button type="button" class="icon-btn cover-btn" aria-label="Cover ändern" title="Cover ändern">${ICON_IMAGE}</button><button type="button" class="icon-btn edit-btn" aria-label="Titel und Autor bearbeiten" title="Bearbeiten">${ICON_EDIT}</button>` : ''}
        <button type="button" class="icon-btn close-x" aria-label="Schließen">${ICON_CLOSE}</button>
      </div>
      <div class="detail-cover ${v.ink} ${v.has?'has-cover':''} ${v.loading?'is-loading':''}" data-book="${escapeHtml(book.id)}" style="${escapeHtml(visualStyle(v, true))}">${genCoverHtml(book, group)}</div>
    </div>
    <div class="detail-body">
      ${titleBlockHtml}
      <div class="detail-rows">
        <div class="rating-row"><span class="row-label">Bewertung</span><div class="stars">${starsHtml}</div></div>
        ${dateBlockHtml}
        ${pagesBlockHtml}
        ${categoryBlockHtml}
        ${summaryBlockHtml}
        ${notesBlockHtml}
      </div>
      ${actionsHtml}
    </div>
  `;

  wrap.querySelector('.close-x').addEventListener('click', closeDetail);

  if(owner){
    renderCategoryToggleList(wrap.querySelector('.f-shelf-category-list'), group.key, group.categoryIds);

    const coverBtn = wrap.querySelector('.cover-btn');
    if(coverBtn) coverBtn.addEventListener('click', ()=>openCoverModal(book));

    const summaryBtn = wrap.querySelector('.summary-search');
    if(summaryBtn) summaryBtn.addEventListener('click', async ()=>{
      summaryBtn.disabled = true;
      summaryBtn.textContent = 'Suche …';
      const text = await findDescription(book.title, book.author);
      if(!text){
        showToast('Kein Klappentext gefunden');
        summaryBtn.disabled = false;
        summaryBtn.textContent = 'Klappentext automatisch suchen';
        return;
      }
      const { error } = await db('books').update({ summary: text }).eq('id', book.id);
      if(error){ showToast('Fehler beim Speichern'); return; }
      await refreshAndRender();
      showToast('Klappentext ergänzt');
    });

    if(isEditing){
      wrap.querySelector('.cancel-edit-btn').addEventListener('click', ()=>{ editingBookId = null; updateBookDetailPanel(); });
      wrap.querySelector('.save-edit-btn').addEventListener('click', async ()=>{
        const titleInput = wrap.querySelector('.f-edit-title');
        const authorInput = wrap.querySelector('.f-edit-author');
        const newTitle = titleInput.value.trim();
        if(!newTitle){ showToast('Bitte einen Titel eingeben'); titleInput.focus(); return; }
        const newAuthor = authorInput.value.trim();
        const { error } = await db('books').update({ title: newTitle, author: newAuthor }).eq('id', book.id);
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
    wrap.querySelector('.f-date').addEventListener('change', async (e)=>{
      const { error } = await db('books').update({date_read: e.target.value || null}).eq('id', book.id);
      if(error){ showToast('Fehler beim Speichern'); return; }
      await refreshAndRender();
    });
    wrap.querySelector('.f-pages').addEventListener('change', async (e)=>{
      const val = e.target.value.trim();
      const pageCount = val ? parseInt(val, 10) : null;
      const { error } = await db('books').update({page_count: pageCount}).eq('id', book.id);
      if(error){ showToast('Fehler beim Speichern'); return; }
      await refreshAndRender();
    });
    wrap.querySelector('.f-summary').addEventListener('change', async (e)=>{
      const { error } = await db('books').update({summary: e.target.value.trim() || null}).eq('id', book.id);
      if(error){ showToast('Fehler beim Speichern'); return; }
      await refreshAndRender();
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

// ---- Add-book modal ----
const overlay = document.getElementById('modalOverlay');
const seriesInput = document.getElementById('f-series');
const categoryListEl = document.getElementById('f-category-list');
const categoryHint = document.getElementById('f-category-hint');
let addBookSelectedCategoryIds = new Set();

function updateCategoryFieldForSeries(){
  const seriesVal = seriesInput.value.trim();
  const existingShelf = shelves.find(s=> s.is_series && s.label.toLowerCase() === seriesVal.toLowerCase() && seriesVal !== '');
  if(existingShelf){
    renderCategoryPickerList(categoryListEl, new Set(existingShelf.categoryIds), true);
    categoryHint.textContent = 'Übernommen von der bestehenden Reihe „' + seriesVal + '“.';
  } else {
    renderCategoryPickerList(categoryListEl, addBookSelectedCategoryIds, false);
    categoryHint.textContent = '';
  }
}

const addPicker = createCoverPicker(document.getElementById('addCoverPicker'));
const titleInput = document.getElementById('f-title');
const suggestBox = document.getElementById('addSuggest');
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
  const authorEl = document.getElementById('f-author');
  const pagesEl = document.getElementById('f-pages');
  const summaryEl = document.getElementById('f-summary');
  if(c.authors.length) authorEl.value = c.authors.slice(0, 2).join(', ');
  if(c.pages) pagesEl.value = c.pages;
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
  addPicker.set('', []);
  closeSuggest();
  const dl = document.getElementById('series-list');
  const uniqueSeries = shelves.filter(s=>s.is_series).map(s=>s.label);
  dl.innerHTML = uniqueSeries.map(s=>`<option value="${escapeHtml(s)}">`).join('');
  updateCategoryFieldForSeries();
  overlay.classList.remove('hidden');
  document.getElementById('f-title').focus();
});
seriesInput.addEventListener('input', updateCategoryFieldForSeries);

document.getElementById('cancelAddBtn').addEventListener('click', ()=>overlay.classList.add('hidden'));
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
    .insert({ shelf_id: shelf.id, title, author, series_order: seriesOrder, rating:0, notes:'', summary, date_read:null, page_count: pageCount, cover_url: coverChoice })
    .select().single();
  if(bookErr){ showToast('Fehler beim Speichern des Buchs'); return; }

  selectedId = newBook.id;
  displayedId = newBook.id;
  await refreshAndRender();
  overlay.classList.add('hidden');
  showToast('„' + title + '“ steht jetzt im Regal');
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

function openShelfCatModal(key, label){
  currentShelfKey = key;
  setShelfCatTitle(label);
  closeShelfRenameMode();
  refreshShelfCatToggleList();
  renderCatChips('shelfCatChipList', refreshShelfCatToggleList);
  document.getElementById('shelfNewCatInput').value = '';
  shelfCatOverlay.classList.remove('hidden');
}

function refreshShelfCatToggleList(){
  const shelf = shelves.find(s=>s.id===currentShelfKey);
  renderCategoryToggleList(shelfCatToggleList, currentShelfKey, shelf ? shelf.categoryIds : []);
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

document.getElementById('shelfAddCatBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('shelfNewCatInput');
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
  renderCatChips('shelfCatChipList', refreshShelfCatToggleList);
  refreshShelfCatToggleList();
});
document.getElementById('shelfNewCatInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('shelfAddCatBtn').click(); }
});

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
  if(openModal){ openModal.classList.add('hidden'); return; }
  if(tocPanel.classList.contains('open')){ closeToc(); return; }
  if(selectedId != null) closeDetail();
});

// ---- Einstellungen ----
const settingsOverlay = document.getElementById('settingsOverlay');
const setTheme = document.getElementById('setTheme');
const setSort = document.getElementById('setSort');
const setFace = document.getElementById('setFace');

function openSettings(){
  closeToc();
  setTheme.innerHTML = THEMES.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  setTheme.value = savedTheme();
  setSort.value = getPref(SORT_KEY, 'alpha');
  setFace.value = getPref(FACE_KEY, 'first');
  settingsOverlay.querySelectorAll('[data-set-view]').forEach(b=>b.setAttribute('aria-pressed', b.getAttribute('data-set-view') === viewMode));
  const owner = isOwnerView();
  document.getElementById('ownerSettings').classList.toggle('hidden', !owner);
  document.getElementById('setUsernameBtn').classList.toggle('hidden', !(owner && currentProfile));
  document.getElementById('setDevRow').classList.toggle('hidden', !devSandboxActive());
  settingsOverlay.classList.remove('hidden');
}
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('settingsCloseBtn').addEventListener('click', ()=>settingsOverlay.classList.add('hidden'));
settingsOverlay.addEventListener('click', e=>{ if(e.target === settingsOverlay) settingsOverlay.classList.add('hidden'); });

setTheme.addEventListener('change', ()=>{ setPref(THEME_KEY, setTheme.value); applyTheme(setTheme.value); });
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
  openUsernameModal(true);
});
document.getElementById('setShareBtn').addEventListener('click', shareShelf);
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
  await Promise.all([ initAuth(), loadViewedUserFromURL() ]);
  render();
}
boot();
