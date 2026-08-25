# vertriebsportal.ch

Kundenportal mit echter Registrierung/Login (Node.js/Express + SQLite) und automatischem
Versand von Offerte & Rechnung per E-Mail, sobald ein Kunde im Portal eine Dienstleistung
auswählt und absendet.

## Setup

```bash
npm install
cp .env.example .env
```

`.env` ausfüllen:

- `SESSION_SECRET`: langer Zufallswert, z. B. `openssl rand -hex 32`
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`: Zugangsdaten deines Mail-Providers
  für den Versand von Offerte & Rechnung. **Ohne diese Angaben startet der Server trotzdem**,
  E-Mails werden dann nur ins Server-Log geschrieben statt wirklich verschickt.
- `COMPANY_*`: Firmendaten, die auf Offerte/Rechnung erscheinen (Adresse, MWST-Nummer, IBAN).

Server starten:

```bash
npm start        # Produktion
npm run dev       # mit Auto-Reload
```

Das Portal läuft danach auf `http://localhost:3000`.

## Was ist jetzt "echt"?

- **Registrierung/Login**: eigene Benutzerkonten in SQLite (`data/app.db`), Passwörter
  gehasht mit bcrypt, Sitzung über ein signiertes, httpOnly-Cookie.
- **Dienstleistung auswählen & absenden**: Leads, Kampagnen, Landingpages, Marketingservices
  sowie der individuelle Auftrags-Wizard erzeugen einen echten Auftrag in der Datenbank.
- **Offerte & Rechnung per E-Mail**: Beim Absenden werden serverseitig zwei PDFs (Offerte,
  Rechnung mit MWST-Ausweis und Zahlungsinformationen) erzeugt und an die registrierte
  E-Mail-Adresse verschickt (Anhänge). Beide Dokumente lassen sich zusätzlich unter
  "Rechnungen" im Portal jederzeit erneut herunterladen.

Alle übrigen Demo-Bereiche (Pipeline, Budget/Wallet, Termine, Herausgeber-Ansicht) nutzen
weiterhin den bisherigen Vorschau-Speicher (`window.storage`) und sind ausserhalb der
ursprünglichen Vorschau-Umgebung nicht persistent – das war explizit nicht Teil dieses Auftrags.

## Preise

Die Preise pro Dienstleistung werden ausschliesslich serverseitig in `server/catalog.js`
nachgeschlagen (nie vom Client übernommen), damit niemand über die API einen manipulierten
Preis einschleusen kann. Beim individuellen Auftrags-Wizard dient das gewählte Budget als
Richtpreis für die Offerte.
