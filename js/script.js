const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const DEFAULT_USERNAME = 'antonio';

let currentUser = null;    // eingeloggter Auth-User (oder null)
let currentProfile = null; // profiles-Zeile des eingeloggten Users

let viewedProfile = null;  // profiles-Zeile des Regals, das gerade angezeigt wird

let books = [];       // Zeilen aus public.books für viewedProfile
let shelves = [];     // Zeilen aus public.shelves für viewedProfile
let categories = [];  // Zeilen aus public.categories für viewedProfile: {id, name}

let selectedId = null;
let editingBookId = null;
let activeCategory = null;
let searchQuery = '';

const seriesPalettes = {
  'Red Rising': ['var(--rr-1)','var(--rr-2)','var(--rr-3)','var(--rr-4)'],
  'The Will of the Many': ['var(--wm-1)','var(--wm-2)'],
  'Fourth Wing': ['var(--fw-1)','var(--fw-2)'],
};
const fallbackPalette = ['var(--fallback-1)','var(--fallback-2)','var(--fallback-3)','var(--fallback-4)'];

function hashStr(s){
  let h = 0;
  for(let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) >>> 0; }
  return h;
}

function colorFor(book, label){
  const key = label || '__none__';
  if(seriesPalettes[key]){
    return seriesPalettes[key][(book.series_order-1) % seriesPalettes[key].length];
  }
  const base = fallbackPalette[hashStr(key) % fallbackPalette.length];
  return base;
}

function romanize(num){
  const map=[[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let n=num, out='';
  for(const [v,s] of map){ while(n>=v){ out+=s; n-=v; } }
  return out || String(num);
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2400);
}

const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

function formatDate(iso){
  // T00:00 erzwingt lokale Zeit, sonst kann ein reines Datum je nach Zeitzone auf den Vortag rutschen.
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d) ? iso : d.toLocaleDateString('de-DE', { day:'numeric', month:'long', year:'numeric' });
}

function starsSVG(filled){
  const c = filled ? 'var(--brass-light)' : '#4a3d2c';
  return `<svg viewBox="0 0 24 24" fill="${c}"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9L5.7 21l1.7-7L2 9.2l7.1-.6z"/></svg>`;
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

function categoryNameById(id){
  const c = categories.find(c=>c.id===id);
  return c ? c.name : 'Unkategorisiert';
}

// ---- Kategorie-Mehrfachauswahl (Toggle-Chips) ----
async function toggleShelfCategory(shelfId, categoryId, isActive){
  if(isActive){
    const { error } = await supabaseClient.from('shelf_categories').insert({ shelf_id: shelfId, category_id: categoryId });
    if(error){ showToast('Fehler beim Speichern'); return false; }
  } else {
    const { error } = await supabaseClient.from('shelf_categories').delete().eq('shelf_id', shelfId).eq('category_id', categoryId);
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
    <button type="button" class="cat-toggle ${selected.has(c.id)?'active':''}" data-id="${escapeHtml(c.id)}">${escapeHtml(c.name)}</button>
  `).join('');
  containerEl.querySelectorAll('.cat-toggle').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id');
      const nowActive = !btn.classList.contains('active');
      btn.classList.toggle('active', nowActive); // optimistisch, damit z.B. das Regal-Modal (das render() nicht neu aufbaut) sofort korrekt aussieht
      const ok = await toggleShelfCategory(shelfId, id, nowActive);
      if(!ok){ btn.classList.toggle('active', !nowActive); return; }
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
    <button type="button" class="cat-toggle ${selectedIds.has(c.id)?'active':''}" data-id="${escapeHtml(c.id)}" ${disabled?'disabled':''}>${escapeHtml(c.name)}</button>
  `).join('');
  if(disabled) return;
  containerEl.querySelectorAll('.cat-toggle').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-id');
      if(selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      btn.classList.toggle('active');
    });
  });
}

function isOwnerView(){
  return !!(currentUser && viewedProfile && currentUser.id === viewedProfile.id);
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
  render();
}

async function loadProfile(){
  const { data, error } = await supabaseClient
    .from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  if(error){ showToast('Profil konnte nicht geladen werden'); return; }
  currentProfile = data;
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
    loginHint.classList.toggle('hidden', localStorage.getItem(LOGIN_HINT_DISMISSED_KEY) === '1');
    userChip.classList.add('hidden');
    document.getElementById('profilePanel').classList.add('hidden');
  }
}

const LOGIN_HINT_DISMISSED_KEY = 'bookshelf-login-hint-dismissed';
document.getElementById('loginHintClose').addEventListener('click', (e)=>{
  e.stopPropagation();
  document.getElementById('loginHint').classList.add('hidden');
  localStorage.setItem(LOGIN_HINT_DISMISSED_KEY, '1');
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

function openUsernameModal(){
  document.getElementById('f-username').value = '';
  usernameModalOverlay.classList.remove('hidden');
}

document.getElementById('saveUsernameBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('f-username');
  const val = input.value.trim().toLowerCase();
  if(!/^[a-z0-9_]{3,20}$/.test(val)){
    showToast('3-20 Zeichen: a-z, 0-9, _');
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

const isMobileSearch = () => window.matchMedia('(max-width:600px)').matches;

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
      ${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}" alt="">` : '<span class="user-search-avatar-fallback"></span>'}
      <span>@${escapeHtml(p.username)}</span>
    </button>
  `).join('');
  userSearchResults.classList.remove('hidden');
  userSearchResults.querySelectorAll('.user-search-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      userSearchInput.value = '';
      userSearchResults.classList.add('hidden');
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
  return (params.get('u') || DEFAULT_USERNAME).toLowerCase();
}

async function loadViewedUserByUsername(username){
  selectedId = null;
  activeCategory = null;
  searchQuery = '';
  closeToc();
  const searchInputEl = document.getElementById('searchInput');
  if(searchInputEl) searchInputEl.value = '';

  const { data, error } = await supabaseClient
    .from('profiles').select('*').eq('username', username.toLowerCase()).maybeSingle();

  if(error || !data){
    viewedProfile = null;
    shelves = []; books = []; categories = [];
    render();
    return;
  }
  viewedProfile = data;
  await loadShelfData(viewedProfile.id);
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
  const [{data: cats, error: catErr}, {data: shelvesData, error: shelfErr}, {data: booksData, error: bookErr}] = await Promise.all([
    supabaseClient.from('categories').select('*').eq('user_id', profileId).order('name'),
    supabaseClient.from('shelves').select('*, shelf_categories(category_id)').eq('user_id', profileId),
    supabaseClient.from('books').select('*').eq('user_id', profileId).order('series_order'),
  ]);
  if(catErr || shelfErr || bookErr){
    showToast('Daten konnten nicht geladen werden');
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
    .filter(g=>g.items.length>0);
}

function renderFilterBar(){
  const bar = document.getElementById('filterBar');
  const allGroups = buildGroups();
  const cats = [...new Set(allGroups.flatMap(g=>g.categories.map(c=>c.name)))].sort();
  if(cats.length === 0){ bar.innerHTML = ''; return; }
  const pills = ['<button class="filter-pill '+(activeCategory===null?'active':'')+'" data-cat="">Alle</button>']
    .concat(cats.map(c=>`<button class="filter-pill ${activeCategory===c?'active':''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`));
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

  if(!viewedProfile){
    h1.textContent = 'Nutzer nicht gefunden';
    sub.textContent = 'Prüf die Schreibweise oder nutze die Suche oben.';
    banner.classList.add('hidden');
    shareBtn.classList.add('hidden');
    return;
  }

  const displayName = viewedProfile.username.charAt(0).toUpperCase() + viewedProfile.username.slice(1);
  h1.textContent = owner ? 'Mein Bücherregal' : `${displayName}'s Bücherregal`;
  sub.textContent = 'Gelesene Bücher, nach Reihe geordnet';
  shareBtn.classList.remove('hidden');

  if(owner){
    banner.classList.add('hidden');
  } else {
    banner.textContent = `Nur-Lese-Ansicht · @${viewedProfile.username}`;
    banner.classList.remove('hidden');
  }
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
    showToast('Link kopiert!');
  } catch(e){
    showToast(shareUrl);
  }
}
document.getElementById('shareBtn').addEventListener('click', shareShelf);

function render(){
  const owner = isOwnerView();
  renderAuthUI();
  renderHeader(owner);
  document.getElementById('headerActions').classList.toggle('hidden', !owner);

  if(!viewedProfile){
    document.getElementById('filterBar').innerHTML = '';
    document.getElementById('shelves').innerHTML = '';
    updateToc([]);
    updateBookDetailPanel([], owner);
    return;
  }

  renderFilterBar();
  const container = document.getElementById('shelves');
  container.innerHTML = '';

  if(books.length === 0){
    container.innerHTML = owner
      ? '<p class="empty-msg">Das Regal ist noch leer. Stell dein erstes Buch hinein.</p>'
      : '<p class="empty-msg">Dieses Regal ist noch leer.</p>';
    updateToc([]);
    updateBookDetailPanel([], owner);
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

  if(groups.length === 0){
    container.innerHTML = q
      ? '<p class="empty-msg">Keine Treffer für „' + escapeHtml(searchQuery.trim()) + '“.</p>'
      : '<p class="empty-msg">Keine Bücher in dieser Kategorie.</p>';
    updateToc([]);
    updateBookDetailPanel([], owner);
    return;
  }

  groups.forEach(group=>{
    const section = document.createElement('section');
    section.className = 'shelf-group';
    section.id = 'shelf-' + group.key;

    const catTagsHtml = group.categories.map(c=>`<span class="cat-tag">${escapeHtml(c.name)}</span>`).join('');
    const labelInner = `<span class="plate">${escapeHtml(group.label)}</span><div class="cat-tags">${catTagsHtml}</div>`;
    const labelHtml = owner
      ? `<button type="button" class="shelf-label" data-key="${escapeHtml(group.key)}" data-label="${escapeHtml(group.label)}" title="Reihe bearbeiten">${labelInner}</button>`
      : `<div class="shelf-label">${labelInner}</div>`;

    const spinesHtml = group.items.map(b=>{
      const width = Math.max(46, Math.min(66, 44 + b.title.length*1.1));
      const height = 176 + (hashStr(String(b.id)) % 22);
      const isSel = b.id === selectedId;
      const badge = group.items.length > 1 ? `<span class="spine-badge">${romanize(b.series_order)}</span>` : '';
      const starsRow = `<span class="spine-stars">${[1,2,3,4,5].map(i=>starsSVG(i<=b.rating)).join('')}</span>`;
      const color = colorFor(b, group.label);
      return `<button type="button" class="spine ${isSel?'selected':''}" style="--spine:${color};--w:${width}px;--h:${height}px" data-id="${b.id}" aria-label="${escapeHtml(b.title)}" aria-pressed="${isSel}">
        <span class="spine-title">${escapeHtml(b.title)}</span>
        <span class="spine-foot">${starsRow}${badge}</span>
      </button>`;
    }).join('');

    section.innerHTML = `
      ${labelHtml}
      <div class="shelf-row">
        <div class="bookend"></div>
        ${spinesHtml}
        <div class="bookend"></div>
      </div>
      <div class="shelf-plank"></div>
    `;

    container.appendChild(section);
  });

  container.querySelectorAll('.spine').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = el.getAttribute('data-id');
      selectedId = (selectedId === id) ? null : id;
      editingBookId = null;
      closeToc();
      render();
    });
  });

  if(owner){
    container.querySelectorAll('.shelf-label').forEach(el=>{
      el.addEventListener('click', ()=>{
        openShelfCatModal(el.getAttribute('data-key'), el.getAttribute('data-label'));
      });
    });
  }

  updateToc(groups);
  updateBookDetailPanel(groups, owner);
}

function buildDetailCard(book, group, owner){
  const wrap = document.createElement('div');
  wrap.className = 'detail-card';
  const meta = [book.author, group.items.length > 1 ? `Band ${book.series_order} · ${group.label}` : null].filter(Boolean).join(', ');
  const isEditing = owner && editingBookId === book.id;

  const starsHtml = owner
    ? [1,2,3,4,5].map(i=>`<button type="button" class="star-btn" data-star="${i}">${starsSVG(i<=book.rating)}</button>`).join('')
    : [1,2,3,4,5].map(i=>starsSVG(i<=book.rating)).join('');

  const categoryBlockHtml = owner
    ? `<label class="field"><span>Kategorien der Reihe</span>
         <div class="cat-toggle-list f-shelf-category-list"></div>
         <small>Gilt für alle Bände von "${escapeHtml(group.label)}".</small>
       </label>`
    : `<p class="detail-readonly-row"><span class="rating-label">Kategorien</span> ${escapeHtml(group.categories.map(c=>c.name).join(', '))}</p>`;

  const dateBlockHtml = owner
    ? `<label class="field"><span>Gelesen am</span><input type="date" class="f-date" value="${book.date_read||''}"></label>`
    : (book.date_read ? `<p class="detail-readonly-row"><span class="rating-label">Gelesen am</span> ${escapeHtml(formatDate(book.date_read))}</p>` : '');

  const pagesBlockHtml = owner
    ? `<label class="field"><span>Seitenzahl</span><input type="number" class="f-pages" min="1" placeholder="optional" value="${book.page_count||''}"></label>`
    : (book.page_count ? `<p class="detail-readonly-row"><span class="rating-label">Seitenzahl</span> ${escapeHtml(String(book.page_count))}</p>` : '');

  const summaryBlockHtml = owner
    ? `<label class="field"><span>Klappentext</span><textarea class="f-summary" rows="3" placeholder="Worum geht's? (optional)">${escapeHtml(book.summary||'')}</textarea></label>`
    : (book.summary ? `<label class="field"><span>Klappentext</span><p class="detail-notes-readonly">${escapeHtml(book.summary)}</p></label>` : '');

  const notesBlockHtml = owner
    ? `<label class="field"><span>Notizen</span><textarea class="f-notes" rows="3" placeholder="Deine Gedanken zum Buch...">${escapeHtml(book.notes||'')}</textarea></label>`
    : (book.notes ? `<label class="field"><span>Notizen</span><p class="detail-notes-readonly">${escapeHtml(book.notes)}</p></label>` : '');

  const actionsHtml = owner
    ? `<div class="detail-actions"><button type="button" class="btn-ghost remove-btn">Aus dem Regal entfernen</button></div>`
    : '';

  const titleBlockHtml = isEditing
    ? `<div class="detail-edit-fields">
         <label class="field"><span>Titel</span><input type="text" class="f-edit-title" value="${escapeHtml(book.title)}"></label>
         <label class="field"><span>Autor:in</span><input type="text" class="f-edit-author" value="${escapeHtml(book.author||'')}"></label>
         <div class="detail-edit-actions">
           <button type="button" class="btn-ghost cancel-edit-btn">Abbrechen</button>
           <button type="button" class="btn-primary save-edit-btn">Speichern</button>
         </div>
       </div>`
    : `<div>
         <p class="detail-title">${escapeHtml(book.title)}</p>
         <p class="detail-meta">${escapeHtml(meta)}</p>
       </div>`;

  const coverMark = group.items.length > 1 ? `<span class="detail-cover-mark">${romanize(book.series_order)}</span>` : '';

  wrap.innerHTML = `
    <div class="detail-cover" style="--spine:${colorFor(book, group.label)}" aria-hidden="true">${coverMark}</div>
    <div class="detail-top">
      ${titleBlockHtml}
      <div class="detail-top-actions">
        ${owner && !isEditing ? `<button type="button" class="edit-btn" aria-label="Bearbeiten" title="Bearbeiten">${ICON_EDIT}</button>` : ''}
        <button type="button" class="close-x" aria-label="Schließen">${ICON_CLOSE}</button>
      </div>
    </div>
    <div class="rating-row">
      <span class="rating-label">Bewertung</span>
      <div class="stars">${starsHtml}</div>
    </div>
    ${categoryBlockHtml}
    ${dateBlockHtml}
    ${pagesBlockHtml}
    ${summaryBlockHtml}
    ${notesBlockHtml}
    ${actionsHtml}
  `;

  wrap.querySelector('.close-x').addEventListener('click', ()=>{ selectedId=null; editingBookId=null; render(); });

  if(owner){
    renderCategoryToggleList(wrap.querySelector('.f-shelf-category-list'), group.key, group.categoryIds);

    if(isEditing){
      wrap.querySelector('.cancel-edit-btn').addEventListener('click', ()=>{ editingBookId = null; render(); });
      wrap.querySelector('.save-edit-btn').addEventListener('click', async ()=>{
        const titleInput = wrap.querySelector('.f-edit-title');
        const authorInput = wrap.querySelector('.f-edit-author');
        const newTitle = titleInput.value.trim();
        if(!newTitle){ showToast('Bitte einen Titel eingeben'); titleInput.focus(); return; }
        const newAuthor = authorInput.value.trim();
        const { error } = await supabaseClient.from('books').update({ title: newTitle, author: newAuthor }).eq('id', book.id);
        if(error){ showToast('Fehler beim Speichern'); return; }
        editingBookId = null;
        await refreshAndRender();
        showToast('Änderungen gespeichert');
      });
    } else {
      wrap.querySelector('.edit-btn').addEventListener('click', ()=>{ editingBookId = book.id; render(); });
    }

    wrap.querySelectorAll('.star-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const val = parseInt(btn.getAttribute('data-star'),10);
        const newRating = (book.rating === val) ? 0 : val;
        const { error } = await supabaseClient.from('books').update({rating: newRating}).eq('id', book.id);
        if(error){ showToast('Fehler beim Speichern'); return; }
        await refreshAndRender();
      });
    });
    wrap.querySelector('.f-date').addEventListener('change', async (e)=>{
      const { error } = await supabaseClient.from('books').update({date_read: e.target.value || null}).eq('id', book.id);
      if(error){ showToast('Fehler beim Speichern'); return; }
      await refreshAndRender();
    });
    wrap.querySelector('.f-pages').addEventListener('change', async (e)=>{
      const val = e.target.value.trim();
      const pageCount = val ? parseInt(val, 10) : null;
      const { error } = await supabaseClient.from('books').update({page_count: pageCount}).eq('id', book.id);
      if(error){ showToast('Fehler beim Speichern'); return; }
      await refreshAndRender();
    });
    wrap.querySelector('.f-summary').addEventListener('change', async (e)=>{
      const { error } = await supabaseClient.from('books').update({summary: e.target.value.trim() || null}).eq('id', book.id);
      if(error){ showToast('Fehler beim Speichern'); return; }
      await refreshAndRender();
    });
    wrap.querySelector('.f-notes').addEventListener('change', async (e)=>{
      const { error } = await supabaseClient.from('books').update({notes: e.target.value}).eq('id', book.id);
      if(error){ showToast('Fehler beim Speichern'); return; }
      await refreshAndRender();
    });
    wrap.querySelector('.remove-btn').addEventListener('click', async ()=>{
      const { error } = await supabaseClient.from('books').delete().eq('id', book.id);
      if(error){ showToast('Fehler beim Entfernen'); return; }
      const remaining = books.filter(b=>b.shelf_id===book.shelf_id && b.id!==book.id).length;
      if(remaining === 0){
        await supabaseClient.from('shelves').delete().eq('id', book.shelf_id);
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
    categoryHint.textContent = 'Übernommen von der bestehenden Reihe "' + seriesVal + '".';
  } else {
    renderCategoryPickerList(categoryListEl, addBookSelectedCategoryIds, false);
    categoryHint.textContent = '';
  }
}

document.getElementById('openAddBtn').addEventListener('click', ()=>{
  document.getElementById('f-title').value='';
  document.getElementById('f-author').value='';
  document.getElementById('f-pages').value='';
  document.getElementById('f-summary').value='';
  seriesInput.value='';
  addBookSelectedCategoryIds = new Set();
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

  let shelf = series ? shelves.find(s=>s.is_series && s.label.toLowerCase()===series.toLowerCase()) : null;

  if(!shelf){
    const { data: newShelf, error: shelfErr } = await supabaseClient
      .from('shelves')
      .insert({ label: series || title, is_series: !!series })
      .select().single();
    if(shelfErr){ showToast('Fehler beim Anlegen des Regals'); return; }
    shelf = newShelf;

    if(addBookSelectedCategoryIds.size > 0){
      const rows = [...addBookSelectedCategoryIds].map(catId=>({ shelf_id: shelf.id, category_id: catId }));
      const { error: catLinkErr } = await supabaseClient.from('shelf_categories').insert(rows);
      if(catLinkErr){ showToast('Fehler beim Zuordnen der Kategorien'); }
    }
  }

  const sameSeries = books.filter(b=>b.shelf_id===shelf.id);
  const seriesOrder = sameSeries.length ? Math.max(...sameSeries.map(b=>b.series_order||0)) + 1 : 1;

  const { data: newBook, error: bookErr } = await supabaseClient
    .from('books')
    .insert({ shelf_id: shelf.id, title, author, series_order: seriesOrder, rating:0, notes:'', summary, date_read:null, page_count: pageCount })
    .select().single();
  if(bookErr){ showToast('Fehler beim Speichern des Buchs'); return; }

  selectedId = newBook.id;
  await refreshAndRender();
  overlay.classList.add('hidden');
  showToast('„' + title + '" wurde ins Regal gestellt');
});

// ---- Category management modal ----
const catOverlay = document.getElementById('catModalOverlay');

function renderCatChips(containerId, afterDelete){
  const list = document.getElementById(containerId);
  if(categories.length === 0){
    list.innerHTML = '<p class="cat-empty">Noch keine Kategorien angelegt.</p>';
    return;
  }
  list.innerHTML = categories.map(c=>`<span class="cat-chip">${escapeHtml(c.name)}<button type="button" data-id="${escapeHtml(c.id)}" aria-label="${escapeHtml(c.name)} entfernen">${ICON_CLOSE}</button></span>`).join('');
  list.querySelectorAll('button').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-id');
      const cat = categories.find(c=>c.id===id);
      const { error } = await supabaseClient.from('categories').delete().eq('id', id);
      if(error){ showToast('Fehler beim Löschen'); return; }
      if(cat && activeCategory === cat.name) activeCategory = null;
      await loadShelfData(viewedProfile.id);
      renderCatChips(containerId);
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
  const { error } = await supabaseClient.from('categories').insert({ name: val });
  if(error){ showToast('Fehler beim Anlegen'); return; }
  input.value='';
  await loadShelfData(viewedProfile.id);
  renderCatChips('catChipList');
  render();
});
document.getElementById('newCatInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('addCatBtn').click(); }
});

// ---- Shelf (series) category modal — opened by clicking a shelf label ----
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
  shelfCatTitleEl.textContent = 'Kategorien für „' + label + '“';
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
  const { error } = await supabaseClient.from('shelves').update({ label: newLabel }).eq('id', currentShelfKey);
  if(error){ showToast('Fehler beim Speichern'); return; }
  setShelfCatTitle(newLabel);
  closeShelfRenameMode();
  await refreshAndRender();
  showToast('Titel gespeichert');
});
shelfRenameInput.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('shelfRenameSaveBtn').click(); }
  if(e.key === 'Escape'){ e.preventDefault(); closeShelfRenameMode(); }
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
  const { error } = await supabaseClient.from('categories').insert({ name: val });
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

  if(!groups || groups.length === 0){
    tocMenuBtn.classList.add('hidden');
    closeToc();
    tocList.innerHTML = '';
    return;
  }

  tocMenuBtn.classList.remove('hidden');
  tocList.innerHTML = groups.map(g=>`
    <li><button type="button" class="toc-item" data-target="shelf-${escapeHtml(g.key)}">${escapeHtml(g.label)}</button></li>
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

// ---- Buchdetails als Seitenpanel (öffnet von links) ----
const bookDetailOverlay = document.getElementById('bookDetailOverlay');
const bookDetailPanel = document.getElementById('bookDetailPanel');

function closeBookDetail(){
  bookDetailOverlay.classList.remove('open');
  bookDetailPanel.classList.remove('open');
}
bookDetailOverlay.addEventListener('click', ()=>{ selectedId = null; editingBookId = null; render(); });

function updateBookDetailPanel(groups, owner){
  let selBook = null, selGroup = null;
  for(const g of groups){
    const b = g.items.find(b=>b.id===selectedId);
    if(b){ selBook = b; selGroup = g; break; }
  }

  if(!selBook){
    closeBookDetail();
    bookDetailPanel.innerHTML = '';
    return;
  }

  bookDetailPanel.innerHTML = '';
  bookDetailPanel.appendChild(buildDetailCard(selBook, selGroup, owner));
  bookDetailOverlay.classList.add('open');
  bookDetailPanel.classList.add('open');
}

// ---- Start ----
async function boot(){
  await Promise.all([ initAuth(), loadViewedUserFromURL() ]);
  render();
}
boot();
