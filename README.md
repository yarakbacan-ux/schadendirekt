# Schadendirekt

Unabhängige Fahrzeughistorien-Plattform mit nachvollziehbarer Datenherkunft. Fehlende Daten werden ausdrücklich als **„keine Daten vorhanden“** dargestellt und niemals als Aussage, dass ein Fahrzeug unfallfrei sei.

## Stand nach Review Phase 1

- Next.js + TypeScript
- PostgreSQL + Prisma mit Migrationen
- versionierte FIN-Abfrage `GET /api/v1/vehicles/:vin`
- DB-basierte Admin-Authentifizierung mit Scrypt-Passwort-Hashes und serverseitigen Sessions
- Rollen `ADMIN`, `ANALYST`, `VIEWER`
- SameSite/HttpOnly Session-Cookie, CSRF-Token für schreibende Admin-APIs und Login-Rate-Limit
- asynchrone Importarchitektur: HTTP legt nur `PENDING`-Job + Payload ab und antwortet `202`; ein separater Worker verarbeitet Jobs in Batches
- RFC-4180-tauglicher CSV-Parser
- Zod-Validierung, stabiler Event-Fingerprint, `PARTIAL`-Status und Fehlerzahlen
- zentrale Lizenzpolicy für Speicherung, Weitergabe, kommerzielle Veröffentlichung und Gültigkeitszeiträume
- Retention für Importpayloads und Event-Rohdaten technisch abgebildet
- Request-ID und kontrollierte 5xx-Antworten für FIN/API-Fehler
- CI mit PostgreSQL-Service, Migration, Prisma Generate, Tests, Typecheck und Production Build

## Lokal starten

Voraussetzungen: Node.js 22+, npm und PostgreSQL.

```bash
cp .env.example .env
npm ci
npm run db:generate
npm run db:migrate
npm run user:create-admin -- admin@example.com "ein-sehr-langes-passwort"
npm run dev
```

## Umgebungsvariablen

- `DATABASE_URL`: PostgreSQL-Verbindung
- `WORKER_TOKEN`: langes zufälliges Secret für den internen Import-Worker

Keine echten Zugangsdaten committen.

## Admin-Authentifizierung

`/admin/login` verwendet Benutzer aus der `User`-Tabelle. Passwörter werden als Scrypt-Hash gespeichert. Erfolgreiche Logins erzeugen eine zufällige, in der DB nur gehashte Session. Schreibende Admin-APIs verlangen zusätzlich einen CSRF-Token. Die Login-Rate-Limitierung ist aktuell pro Prozess; für horizontal skalierte Produktion sollte sie auf einen zentralen Store (z. B. Redis) umgestellt werden.

## Importarchitektur

`POST /api/v1/imports` verlangt eine gültige Session mit Rolle `ADMIN` oder `ANALYST`, `X-Source-Key`, passenden Content-Type und `X-CSRF-Token`. Der Request wird **nicht synchron importiert**. Stattdessen wird ein `PENDING`-Importjob mit Payloadreferenz gespeichert und `202 Accepted` zurückgegeben.

Der Worker wird über `POST /api/internal/import-worker` mit `Authorization: Bearer <WORKER_TOKEN>` aufgerufen. Er verarbeitet offene Jobs in Batches. Für Produktion sollte dieser Endpunkt durch Scheduler/Queue-Infrastruktur ausgelöst werden.

CSV unterstützt Quotes, eingebettete Kommas, escaped Quotes, CRLF, UTF-8 und Zeilenumbrüche in quoted fields. Datensätze werden vor Persistenz mit Zod validiert. Ohne externe Source-ID wird eine stabile SHA-256-Fingerprint-ID aus fachlichen Feldern gebildet; die Zeilenposition spielt keine Rolle.

## Lizenz- und Retention-Policy

Eine Lizenz ist nur nutzbar, wenn sie zum aktuellen Zeitpunkt zwischen `validFrom` und `validUntil` liegt. Speicherung benötigt `canStore`. Öffentliche kommerzielle Ausgabe benötigt **beides**: `canRedistribute` und `canCommercialize`.

`retentionDays` steuert das Ablaufdatum gespeicherter Rohpayloads. Abgelaufene Event-Rohdaten werden bereinigt und abgelaufene Importpayloads gelöscht. Quellen mit `retentionDays = 0` werden für die asynchrone Importablage abgelehnt, weil eine kurzzeitige Speicherung sonst die Lizenzbedingung verletzen könnte.

## Tests und CI

```bash
npm test
npx tsc --noEmit
npm run build
```

GitHub Actions startet PostgreSQL, führt `prisma migrate deploy` aus, generiert Prisma Client, startet Tests, TypeScript-Check und den Next.js-Production-Build.

## Sicherheits- und Datenprinzipien

- keine erfundenen Fahrzeughistorien
- fehlende Historie ist keine Aussage über Unfallfreiheit
- keine Veröffentlichung ohne aktive, passende Nutzungsrechte
- keine Secrets im Repository
- Importdaten starten mit Qualitätsstatus `UNVERIFIED`
- Rohdaten nur innerhalb erlaubter Retention
- API-Fehler mit Request-ID statt unstrukturierter Framework-Ausgabe
