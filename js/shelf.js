// Das Regal: Daten laden, Teilen und Story-Bild, Vitrine, Lesestatus, Zeichnen, Buchdetails.
// Die App besteht aus sechs klassischen Skripten ohne Build-Schritt. Sie teilen sich einen globalen
// Gültigkeitsbereich und laden in index.html in fester Reihenfolge: core, account, admin, shelf, edit, extras.
// Was beim Laden sofort läuft (nicht erst bei einem Klick), darf nur auf Früheres zugreifen.

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

  if(isDemo(viewedProfile)){
    banner.innerHTML = `${DEMO_BADGE}<span>Erfundenes Beispielregal: so kann ein Regal aussehen.</span>`;
    banner.classList.remove('hidden');
  } else if(owner){
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

// Einmal geladene Cover bleiben für die Sitzung, damit der Wechsel Regal/Lesejahr nicht alles neu lädt.
// Fehlgeschlagene nicht, die dürfen beim nächsten Mal erneut versuchen.
const storyImages = new Map();
function loadStoryImage(url){
  if(!url || !/^https:\/\//.test(url)) return Promise.resolve(null);
  if(!storyImages.has(url)){
    storyImages.set(url, new Promise(resolve=>{
      const img = new Image();
      img.onload = ()=>resolve(img);
      img.onerror = ()=>{ storyImages.delete(url); resolve(null); };
      img.src = '/api/cover?url=' + encodeURIComponent(url);
    }));
  }
  return storyImages.get(url);
}

// Hängt Open Library bei einem Cover, soll nicht das ganze Bild warten: was bis dahin fehlt, wird Farbfläche.
const STORY_COVER_MS = 5000;
function withDeadline(promise, ms){
  return Promise.race([promise, new Promise(r=>setTimeout(()=>r(null), ms))]);
}

// Lieber scharf, aber nie Googles „image not available“: Google liefert für manche Bände statt der großen
// Fassung dieses Platzhalterbild. Die große Fassung gilt darum nur, wenn ihr Seitenverhältnis zum kleinen
// Cover passt (wie verifyLargeCover). Open Library hat zu jedem Cover eine echte große Fassung.
async function storyCover(e){
  if(!e || !e.src) return null;
  const large = largeCoverUrl(e.src);
  if(large === e.src || /covers\.openlibrary\.org/.test(e.src)) return (await loadStoryImage(large)) || loadStoryImage(e.src);
  const [small, big] = await Promise.all([loadStoryImage(e.src), e.largeOk === false ? null : loadStoryImage(large)]);
  const ratio = img=>img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0;
  return big && small && Math.abs(ratio(big) - ratio(small)) < 0.04 ? big : small;
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
  const images = await Promise.all(shown.map(b=>withDeadline(storyCover(coverCache[coverKey(b)]), STORY_COVER_MS)));

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

  // JPEG statt PNG: etwa ein Sechstel der Größe und auf dem Handy schneller kodiert; Instagram & Co. speichern ohnehin JPEG.
  return new Promise(r=>canvas.toBlob(r, 'image/jpeg', 0.9));
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
  return shareKind === 'year' ? `lesejahr-${storyYear()}-${viewedProfile.username}.jpg` : `regal-${viewedProfile.username}.jpg`;
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
  const file = new File([shareBlob], shareFileName(), { type: 'image/jpeg' });
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
const STATUS_CHOICES = { read: 'Gelesen', reading: 'Lese gerade', want: 'Will ich lesen' };
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
    ? `<div class="status-row"><span class="row-label">Status</span><div class="seg seg-status" role="group" aria-label="Lesestatus">
         ${Object.keys(STATUS_LABELS).map(k=>`<button type="button" data-book-status="${k}" aria-pressed="${st === k}">${STATUS_CHOICES[k]}</button>`).join('')}
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
