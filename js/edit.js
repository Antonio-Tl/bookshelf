// Bearbeiten: Buch hinzufügen, Regal scannen, Import, Cover, Kategorien, Reihen, Suche, Inhaltsverzeichnis.
// Die App besteht aus sechs klassischen Skripten ohne Build-Schritt. Sie teilen sich einen globalen
// Gültigkeitsbereich und laden in index.html in fester Reihenfolge: core, account, admin, shelf, edit, extras.
// Was beim Laden sofort läuft (nicht erst bei einem Klick), darf nur auf Früheres zugreifen.

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
