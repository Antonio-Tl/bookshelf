// Supporter-Kauf, Einstellungen, Einführung, App-Installation und der Start der App.
// Die App besteht aus sechs klassischen Skripten ohne Build-Schritt. Sie teilen sich einen globalen
// Gültigkeitsbereich und laden in index.html in fester Reihenfolge: core, account, admin, shelf, edit, extras.
// Was beim Laden sofort läuft (nicht erst bei einem Klick), darf nur auf Früheres zugreifen.

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
    closeSupportFlow();
    openLogin('buy');
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
      ? 'Bände einer Reihe stehen zusammen, ein Einzelband ist eine Reihe mit einem Buch. Über „Regal“ stellst du sie als Buchrücken ins Regal. Tipp ein Buch an, um Sterne, Notizen, Lesedatum und Kategorien zu setzen.'
      : 'Jede Reihe bekommt ihr eigenes Regalbrett, ein Einzelband ist eine Reihe mit einem Buch. Tipp ein Buch an, um Sterne, Notizen, Lesedatum und Kategorien zu setzen.',
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
