# vertriebsportal.ch

Kundenportal mit echter Registrierung/Login, Warenkorb und automatischem Versand von
Offerte & Rechnung per E-Mail, sobald ein Kunde Leistungen auswählt und die Bestellung
verbindlich abschickt. Läuft produktiv als Netlify Function + Netlify DB (Postgres).

## Produktiv-Deployment (Netlify)

1. Repo mit Netlify verbinden (Build-Einstellungen kommen aus `netlify.toml`:
   `publish = public`, `functions = netlify/functions`).
2. **Netlify DB aktivieren**: Team-Dashboard → Extensions → Netlify DB (oder
   `netlify db init` per CLI). Netlify setzt danach automatisch `NETLIFY_DATABASE_URL`.
3. In den Netlify-Umgebungsvariablen (Site settings → Environment variables) setzen:
   - `SESSION_SECRET` – langer Zufallswert (`openssl rand -hex 32`)
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` – für den echten
     Versand von Offerte & Rechnung. **Ohne diese Werte läuft die Seite trotzdem**, E-Mails
     werden dann nur ins Function-Log geschrieben statt wirklich verschickt.
   - `COMPANY_UID`, `COMPANY_IBAN` – Firmendaten für die Rechnung (siehe `.env.example` für
     alle verfügbaren `COMPANY_*`-Felder; Name/Adresse sind bereits mit Esche Consulting
     GmbH, Städtle 35, 9490 Vaduz vorbelegt).
4. Deploy auslösen – fertig.

## Lokale Entwicklung

```bash
npm install
cp .env.example .env   # DATABASE_URL auf eine lokale/Dev-Postgres-Instanz zeigen lassen
npm run dev
```

Das Portal läuft dann auf `http://localhost:3000` (Express-Server, der dieselbe App wie
die Netlify Function nutzt, siehe `server/app.js`).

## Was ist jetzt "echt"?

- **Registrierung/Login**: eigene Benutzerkonten in Postgres, Passwörter gehasht mit
  bcrypt, Sitzung über ein signiertes, httpOnly-Cookie.
- **Warenkorb**: Leads, Kampagnen, Landingpages und Marketingservices lassen sich frei
  auswählen, in den Warenkorb legen, Mengen anpassen und gesammelt verbindlich bestellen –
  kein Guthaben/Vorauszahlung nötig, wie in einem normalen Online-Shop.
- **Offerte & Rechnung per E-Mail**: Beim verbindlichen Bestellen werden serverseitig zwei
  PDFs (Offerte, Rechnung mit MWST-Ausweis, Zahlungsinformationen, allen Positionen)
  erzeugt und an die registrierte E-Mail-Adresse verschickt. Beide Dokumente lassen sich
  zusätzlich unter "Rechnungen" im Portal jederzeit erneut herunterladen.
- Bestellte Leads werden **separat** für den Kunden zusammengestellt und im Portal unter
  "Meine Aufträge" bereitgestellt (Status "Bestellung eingegangen" bis zur manuellen
  Erfüllung durch das Team – dafür gibt es aktuell noch keine Admin-Oberfläche).

Alle übrigen Demo-Bereiche (Pipeline, Budget/Wallet, Termine, Herausgeber-Ansicht) nutzen
weiterhin den bisherigen Vorschau-Speicher (`window.storage`) und sind ausserhalb der
ursprünglichen Vorschau-Umgebung nicht persistent – das war explizit nicht Teil dieses
Auftrags.

## Preise

Die Preise pro Dienstleistung werden ausschliesslich serverseitig in `server/catalog.js`
nachgeschlagen (nie vom Client übernommen), damit niemand über die API einen manipulierten
Preis einschleusen kann. Beim individuellen Auftrags-Wizard dient das gewählte Budget als
Richtpreis für die Offerte.
