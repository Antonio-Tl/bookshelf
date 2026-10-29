# E-Mail-Vorlagen für Supabase

Supabase → Authentication → Emails → Templates. Für jede Vorlage Betreff eintragen und den Inhalt der
passenden Datei in das Feld „Message body“ kopieren.

| Vorlage in Supabase | Betreff | Datei |
|---|---|---|
| Confirm signup | Bestätige deine E-Mail-Adresse fürs Bücherregal | `confirm-signup.html` |
| Magic Link | Dein Anmeldelink fürs Bücherregal | `magic-link.html` |
| Reset Password | Neues Passwort fürs Bücherregal | `reset-password.html` |
| Change Email Address | Neue E-Mail-Adresse fürs Bücherregal bestätigen | `change-email.html` |

`{{ .ConfirmationURL }}`, `{{ .Email }}` und `{{ .NewEmail }}` füllt Supabase selbst aus.
