# Schadendirekt

Unabhängige Fahrzeughistorien-Plattform mit nachvollziehbarer Datenherkunft. Fehlende Daten werden ausdrücklich als **„keine Daten vorhanden“** dargestellt und niemals als Aussage, dass ein Fahrzeug unfallfrei sei.

## Phase 1

Enthalten sind aktuell:

- Next.js + TypeScript Grundstruktur
- PostgreSQL/Prisma Datenmodell für Fahrzeuge, Historienereignisse, Datenquellen, Importjobs, Lizenzrechte und Benutzerrollen
- versionierte FIN-Abfrage unter `GET /api/v1/vehicles/:vin`
- Kundenportal für FIN-Suche
- geschütztes Admin-Dashboard unter `/admin`
- idempotente JSON-/CSV-Import-Pipeline unter `POST /api/v1/imports`
- Speicherung von Herkunft, Qualitätsstatus, Rohdaten und Importfehlern
- Tests für FIN-Validierung

## Lokal starten

Voraussetzungen: Node.js 20+, npm und PostgreSQL.

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

Danach ist die Anwendung standardmäßig unter `http://localhost:3000` erreichbar.

## Umgebungsvariablen

Siehe `.env.example`.

- `DATABASE_URL`: PostgreSQL-Verbindung
- `ADMIN_EMAIL`: Benutzer für den Phase-1-Adminzugang
- `ADMIN_PASSWORD`: Passwort für den Phase-1-Adminzugang

Keine echten Zugangsdaten committen.

## Datenquellen und Rechte

Jede Datenquelle besitzt eigene Lizenzdatensätze. Ein Import wird nur akzeptiert, wenn für die Quelle mindestens eine Lizenz mit `canStore=true` hinterlegt ist. In der öffentlichen FIN-Abfrage werden nur Ereignisse aus Quellen ausgegeben, für die `canRedistribute=true` hinterlegt ist.

Externe Quellen wie NHTSA oder DVSA werden erst angebunden, nachdem Nutzungs-, Speicher- und Weitergaberechte konkret geprüft wurden.

## Import-API

`POST /api/v1/imports`

Header:

- HTTP Basic Auth mit `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `X-Source-Key: <key-der-datenquelle>`
- `Content-Type: application/json` oder `text/csv`

JSON kann entweder ein Array oder `{ "records": [...] }` enthalten. CSV erwartet die Spalten `vin,externalId,eventType,eventDate,country,mileageKm,title,description`.

## Tests

```bash
npm test
npm run build
```

## Sicherheits- und Datenprinzipien

- keine erfundenen Fahrzeughistorien
- keine Veröffentlichung ohne dokumentierte Weitergaberechte
- keine Secrets im Repository
- Rohdaten und Quelle bleiben nachvollziehbar
- importierte Daten starten mit Qualitätsstatus `UNVERIFIED`
- fehlende Historie ist keine Aussage über Unfallfreiheit
