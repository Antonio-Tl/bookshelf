// Anmelden, Nutzername, Personensuche, Folgen und Mitteilungen, Routing, Startseite, Übersicht, Profil und Konto.
// Die App besteht aus sechs klassischen Skripten ohne Build-Schritt. Sie teilen sich einen globalen
// Gültigkeitsbereich und laden in index.html in fester Reihenfolge: core, account, admin, shelf, edit, extras.
// Was beim Laden sofort läuft (nicht erst bei einem Klick), darf nur auf Früheres zugreifen.

// ---- Auth ----
async function initAuth(){
  const { data:{ session } } = await supabaseClient.auth.getSession();
  await handleSession(session);
  supabaseClient.auth.onAuthStateChange((_event, session)=>{ handleSession(session); });
}

async function handleSession(session){
  currentUser = session ? session.user : null;
  if(currentUser) document.getElementById('loginOverlay').classList.add('hidden');
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

// ---- Anmelden: Google oder ein Anmeldelink per E-Mail (Supabase „Magic Link“) ----
const loginOverlay = document.getElementById('loginOverlay');
function openLogin(after){
  if(after) setPref(AFTER_LOGIN_KEY, after);
  document.getElementById('loginChoose').classList.remove('hidden');
  document.getElementById('loginSent').classList.add('hidden');
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('loginEmailBtn').disabled = false;
  loginOverlay.classList.remove('hidden');
}
function closeLogin(){
  loginOverlay.classList.add('hidden');
}
const LOGIN_ERRORS = {
  over_email_send_rate_limit: 'Gerade wurden zu viele Links verschickt. Versuch es in einer Minute noch einmal.',
  email_address_invalid: 'Diese E-Mail-Adresse sieht nicht richtig aus.',
  email_provider_disabled: 'Die Anmeldung per E-Mail ist gerade ausgeschaltet. Nimm bitte Google.',
};
document.getElementById('loginEmailForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const input = document.getElementById('loginEmail');
  const email = input.value.trim();
  const errorEl = document.getElementById('loginError');
  if(!email) return;
  const btn = document.getElementById('loginEmailBtn');
  btn.disabled = true;
  errorEl.classList.add('hidden');
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + '/' },
  });
  btn.disabled = false;
  if(error){
    errorEl.textContent = LOGIN_ERRORS[error.code] || (error.status === 429 ? LOGIN_ERRORS.over_email_send_rate_limit : 'Der Link ließ sich nicht verschicken. Versuch es gleich noch einmal.');
    errorEl.classList.remove('hidden');
    return;
  }
  document.getElementById('loginSentTo').textContent = email;
  document.getElementById('loginChoose').classList.add('hidden');
  document.getElementById('loginSent').classList.remove('hidden');
});
document.getElementById('loginGoogleBtn').addEventListener('click', signInWithGoogle);
document.getElementById('loginAgainBtn').addEventListener('click', ()=>openLogin());
document.getElementById('loginDoneBtn').addEventListener('click', closeLogin);
document.getElementById('loginCloseBtn').addEventListener('click', closeLogin);
loginOverlay.addEventListener('click', e=>{ if(e.target === loginOverlay) closeLogin(); });

document.getElementById('googleLoginBtn').addEventListener('click', ()=>openLogin());
document.getElementById('devResetBtn').addEventListener('click', resetSandbox);
document.getElementById('loginHintAction').addEventListener('click', ()=>openLogin());
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
      <span class="user-search-names"><b>${escapeHtml(shownName(p))}${isDemo(p) ? DEMO_BADGE : ''}</b><small>@${escapeHtml(p.username)}</small></span>
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
    <span class="reader-text"><b>${escapeHtml(possessive(shownName(p)))} Regal${isDemo(p) ? DEMO_BADGE : ''}</b><small>@${escapeHtml(p.username)} · ${meta}</small>${seriesLine}</span>
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
  note.textContent = mine ? `Angemeldet als @${currentProfile.username}` : 'Kostenlos, Anmeldung mit Google oder E-Mail';
}

document.getElementById('homeCreateBtn').addEventListener('click', ()=>{
  if(currentProfile && currentProfile.username){ goToUser(currentProfile.username); return; }
  if(currentUser){ openUsernameModal(); return; }
  // Lokal gibt es keinen Google-Login: der Testmodus macht Antonios Regal zum eigenen.
  if(DEV_LOCAL){ goToUser(devAs); return; }
  openLogin('1');
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
  if(!q){
    const demos = list.entries.filter(e=>isDemo(e.profile)).length;
    const real = list.total - demos;
    document.getElementById('browseCount').textContent = `${real} ${real === 1 ? 'Regal' : 'Regale'}${demos ? `, dazu ${demos} ${demos === 1 ? 'Beispiel' : 'Beispiele'}` : ''}`;
  }
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
