// Verwaltung für Admins: Übersicht, Nutzer, Kosten, Gratis-Grenzen, Protokoll.
// Die App besteht aus sechs klassischen Skripten ohne Build-Schritt. Sie teilen sich einen globalen
// Gültigkeitsbereich und laden in index.html in fester Reihenfolge: core, account, admin, shelf, edit, extras.
// Was beim Laden sofort läuft (nicht erst bei einem Klick), darf nur auf Früheres zugreifen.

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
      '<button type="button" class="btn btn-primary" id="adminLoginBtn">Anmelden</button>'));
    document.getElementById('adminLoginBtn').addEventListener('click', ()=>openLogin('admin'));
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
    const { default: QRCode } = await import('/js/vendor/qrcode-1.5.4.mjs');
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
