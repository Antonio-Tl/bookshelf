// Vorlage für js/config.js
// 1. Diese Datei zu js/config.js kopieren.
// 2. Werte aus Supabase eintragen: Project Settings -> API -> Project URL / anon public key.
// js/config.js wird per .gitignore nicht eingecheckt (auch wenn der anon key
// grundsätzlich öffentlich sein darf, da Row Level Security ihn absichert).
window.SUPABASE_URL = 'https://DEIN-PROJEKT.supabase.co';
window.SUPABASE_ANON_KEY = 'DEIN-ANON-KEY';
