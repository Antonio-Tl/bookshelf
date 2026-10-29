// Läuft die Seite? Startseite, Regal, Übersicht, Weiterleitungen, Sitemap, Import, Story-Bild und Worker.
const { test, expect } = require('@playwright/test');

// Jeder Test schlägt fehl, sobald im Browser ein Fehler auftritt.
test.beforeEach(async ({ page }, info)=>{
  info.pageErrors = [];
  page.on('pageerror', e=>info.pageErrors.push(e.message));
});
test.afterEach(async ({}, info)=>{
  expect(info.pageErrors, 'Fehler im Browser').toEqual([]);
});

test('Startseite zeigt das Schaufenster', async ({ page })=>{
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#heroTitle')).toContainText('In einem Regal');
  await expect(page.locator('#heroShelf .display-cover').first()).toBeVisible({ timeout: 15_000 });
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).not.toContain('user-scalable=no');
});

test('Regal unter /@name zeigt Bücher', async ({ page })=>{
  const res = await page.goto('/@antonio', { waitUntil: 'domcontentloaded' });
  expect(res.status()).toBe(200);
  await expect(page.locator('#shelves [data-book]').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/@antonio$/);
});

test('alte ?u=-Links und Großschreibung leiten auf /@name um', async ({ request })=>{
  const old = await request.get('/?u=Antonio', { maxRedirects: 0 });
  expect(old.status()).toBe(301);
  expect(old.headers()['location']).toMatch(/\/@antonio$/);
  const upper = await request.get('/@Antonio/', { maxRedirects: 0 });
  expect(upper.status()).toBe(301);
  expect(upper.headers()['location']).toMatch(/\/@antonio$/);
});

test('unbekanntes Regal: 404, noindex und Hinweis', async ({ page })=>{
  const res = await page.goto('/@gibt_es_nicht_123', { waitUntil: 'domcontentloaded' });
  expect(res.status()).toBe(404);
  expect(res.headers()['x-robots-tag']).toBe('noindex');
  await expect(page.locator('#pageTitle')).toHaveText('Nutzer nicht gefunden', { timeout: 15_000 });
});

test('Übersicht listet Regale und kennzeichnet Beispiele', async ({ page })=>{
  await page.goto('/?view=regale', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.reader-row[data-user="antonio"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.reader-row[data-user="lenamarie"] .demo-badge')).toBeVisible();
});

test('Sitemap enthält echte Regale, aber keine Beispiele', async ({ request })=>{
  const xml = await (await request.get('/sitemap.xml')).text();
  expect(xml).toContain('/@antonio</loc>');
  expect(xml).not.toContain('/@lenamarie</loc>');
});

test('Goodreads-Export wird richtig gelesen', async ({ page })=>{
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const items = await page.evaluate(()=>{
    const csv = 'Book Id,Title,Author,My Rating,Number of Pages,Date Read,Exclusive Shelf,My Review\n'
      + '1,"Der Name des Windes (Die Königsmörder-Chronik, #1)",Patrick Rothfuss,5,864,2024/03/02,read,"Toll, wirklich"\n'
      + '2,Project Hail Mary,Andy Weir,0,,,to-read,\n';
    return importItemsFromCsv(parseCsv(csv));
  });
  expect(items.source).toBe('Goodreads');
  expect(items.items[0]).toMatchObject({ title: 'Der Name des Windes', series: 'Die Königsmörder-Chronik', series_order: 1, rating: 5, page_count: 864, date_read: '2024-03-02', status: 'read', review: 'Toll, wirklich' });
  expect(items.items[1]).toMatchObject({ title: 'Project Hail Mary', series: '', status: 'want' });
});

test('Story-Bild wird gezeichnet', async ({ page })=>{
  await page.goto('/@antonio', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#shelves [data-book]').first()).toBeVisible({ timeout: 15_000 });
  const size = await page.evaluate(async ()=>(await drawStory('shelf')).size);
  expect(size).toBeGreaterThan(50_000);
});

test('Worker: Cover-Proxy nur für erlaubte Hosts, Fehlerberichte werden angenommen', async ({ request })=>{
  const foreign = await request.get('/api/cover?url=' + encodeURIComponent('https://example.com/x.jpg'));
  expect(foreign.status()).toBe(400);
  const log = await request.post('/api/log', { data: { message: 'Smoke-Test', page: '/' } });
  expect(log.status()).toBe(204);
});

test('Anmeldedialog: Anbieter nach Supabase-Einstellung, Registrieren und Passwort vergessen', async ({ page })=>{
  // Supabase-Antworten im Browser abfangen: es geht nichts an den echten Server.
  await page.route('**/auth/v1/settings', r=>r.fulfill({ json: { external: { google: true, apple: true, email: true } } }));
  await page.route('**/auth/v1/recover**', r=>r.fulfill({ json: {} }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#homeCreateNote')).toContainText('Apple', { timeout: 10_000 });
  await page.locator('#googleLoginBtn').click();
  await expect(page.locator('#loginAppleBtn')).toBeVisible();
  await page.locator('[data-login-mode="signup"]').click();
  await expect(page.locator('#loginTitle')).toHaveText('Konto erstellen');
  await page.locator('#loginEmail').fill('test@example.test');
  await page.locator('#loginPassword').fill('kurz');
  await page.locator('#loginSubmitBtn').click();
  await expect(page.locator('#loginError')).toContainText('mindestens 8 Zeichen');
  await page.locator('[data-login-mode="signin"]').click();
  await page.locator('#loginForgotBtn').click();
  await page.locator('#loginSubmitBtn').click();
  await expect(page.locator('#loginSentText')).toContainText('Link zum Zurücksetzen');
});
