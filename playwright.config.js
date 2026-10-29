// Smoke-Tests für die wichtigsten Seiten und Endpunkte, gegen `wrangler dev` (Seite plus Worker, lokal).
// Lesen echte, öffentliche Daten aus Supabase (Antonios Regal); schreiben nichts: auf localhost bearbeitet
// die App nur ihre Testkopie im Browser. Starten mit `npm test`.
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8787;

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'de-DE',
  },
  // channel 'chromium': das volle Chromium im neuen Headless-Modus, ohne die zusätzliche Headless-Shell.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'chromium' } },
  ],
  webServer: {
    command: `npx wrangler dev --ip 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
