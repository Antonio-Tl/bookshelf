// Vorlage für js/config.js
// Werte aus Supabase eintragen: Project Settings -> API -> Project URL / publishable key.
// Der Key darf öffentlich sein, Row Level Security sichert die Daten ab.
window.SUPABASE_URL = 'https://DEIN-PROJEKT.supabase.co';
window.SUPABASE_ANON_KEY = 'DEIN-ANON-KEY';
// Google Books läuft online über worker.js mit dem Laufzeit-Secret GOOGLE_BOOKS_API_KEY am Worker.
// Nur zum lokalen Testen ohne `wrangler dev`: hier einen auf localhost beschränkten Browser-Key eintragen.
// window.GOOGLE_BOOKS_API_KEY = '';
