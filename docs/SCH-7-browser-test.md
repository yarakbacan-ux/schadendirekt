# SCH-7 Browser-Test und Staging

## Automatisierter Test

`npm test` läuft nur mit Vitest. `npm run test:browser` startet ausschließlich Playwright.
GitHub Actions führt `verify` unverändert mit Audit, Prisma, Unit/Integration, TypeScript und Build aus;
danach läuft `browser` gegen einen Production-Build mit frisch migriertem PostgreSQL 16,
echtem Redis 7 über TCP und S3-kompatiblem MinIO. Beide Jobs müssen grün sein.
Browser-Report und Fehler-Traces liegen im Actions-Artefakt `browser-results` (7 Tage).

Lokal werden PostgreSQL, Redis und MinIO benötigt. Ausschließlich eine isolierte Datenbank namens
`schadendirekt_e2e` auf localhost/127.0.0.1 verwenden; die Suite verweigert andere Datenbanken.
Die `browser.env`-Werte in `.github/workflows/ci.yml` sind nur lokale, wegwerfbare Testwerte.
MinIO starten und Bucket wie im Schritt „Start isolated S3-compatible storage“ anlegen, danach:

```sh
npm ci
npm audit --audit-level=moderate
npm run db:validate
npm run db:generate
npm run db:migrate
npx prisma migrate status
npx playwright install --with-deps chromium
npm run build
npm run test:browser
```

Alle CI-Umgebungsvariablen des Browser-Jobs vorher lokal setzen. Produktionsmodus verwendet
niemals In-Memory-Rate-Limits oder lokales Import-Storage. Playwright startet eine eigene App
auf `http://localhost:3000`; es verbindet sich nicht mit einer vorhandenen Staging-Instanz.

Die sechs Browser-Tests prüfen FIN-Fehler, NO_DATA mit ausdrücklichem Unfallfreiheitsvorbehalt,
leeren Bericht, Health/Schema/Redis/S3, anonymen Zugriff und falsches Passwort,
Admin-Login mit sicheren Cookies und persistenter DB-Session, CSRF-Abweisung, Logout/Replay
sowie Import/Worker/BigInt/S3-Roundtrip/Retention/Audit. Test-Admins erhalten zufällige Passwörter.
Importfixtures haben ausdrücklich keine Veröffentlichungs- oder kommerziellen Rechte,
werden nie als echte Historie ausgegeben und werden wieder entfernt.
NHTSA/DVSA-Rechte werden durch diese Tests nicht freigeschaltet.

## Railway-Konfiguration (noch kein Deployment-Nachweis)

Projekt `02884498-2c3f-48c4-aa2c-ddefcd1e43e8`, Environment `staging`
(`2084d74d-03ab-4923-9430-3dac2d607dd4`). Stand der Plattformprüfung am 11.10.2026:
vier Dienste nur `staged-create`, sieben ausstehende Änderungen; keine Deployments, Volumes
oder Buckets. Daher gibt es noch keine geprüfte externe Test-URL.

`railway.json` ist ausschließlich für den Webdienst: reproduzierbarer Build, Migrationen
als Pre-Deploy, Start auf Railway-PORT, `/health` als Deployment-Gate.

Vor Aktivierung müssen folgende Punkte erfüllt sein:

| Dienst | Konfiguration |
| --- | --- |
| PostgreSQL | Privater Zugriff; sichere Zugangsdaten; persistentes Volume `/var/lib/postgresql/data` (Postgres 16); DATABASE_URL im Webdienst |
| Redis | Privater Zugriff und Authentifizierung; `RATE_LIMIT_STORE=redis-tcp`, `REDIS_URL=redis://…` oder `rediss://…`; bestehende REST-Installationen bleiben unterstützt |
| MinIO/S3 | `server /data`, persistentes Volume `/data`, privater S3-Endpunkt, sichere Credentials, Bucket einmalig anlegen; `IMPORT_STORAGE_DRIVER=s3` und alle `IMPORT_STORAGE_S3_*` Werte setzen |
| Web | GitHub-Branch erst nach unabhängiger Freigabe verbinden; NODE_ENV=production, DATABASE_URL, Redis-/S3-Werte und zufälligen WORKER_TOKEN setzen |
| Scheduler | Bestehenden Scheduler oder separat freigegebenen Cron verwenden: `WORKER_APP_URL=https://… npm run worker:once`; WORKER_TOKEN nur als Secret setzen |

Kostenpflichtige Ressourcen werden nicht ohne erneute Zustimmung aktiviert. Zuerst Plan/Kosten
klären, fehlende Persistenz/Secrets/Bucket konfigurieren und danach erst das vorgemerkte Deployment
aktivieren. Das vorgemerkte `minio/minio`-Image ist laut CI nicht mehr abrufbar. Stattdessen vor Aktivierung
`deploy/minio.Dockerfile` aus dem offiziellen gepinnten Quellstand bauen und als eigene
Service-Quelle konfigurieren. CI baut denselben MinIO-Quellstand und den offiziellen Client direkt
mit Go; Go-Modul-Prüfsummen bleiben aktiv. Keine ungeprüften Drittanbieter-Images verwenden.
Keine Secrets in Repo, Linear oder PR-Kommentare schreiben. Keine Production-Gates lockern.

Health meldet App, DB, sämtliche Prisma-Modelltabellen, Migrationserfolg, echten Redis-Befehl
und S3-Schreiben/Lesen/Löschen. Fehlende optionale Provider-Credentials werden separat gemeldet;
der leere öffentliche Bericht bleibt möglich. Konfiguration ist kein Nachweis von Nutzungsrechten.
Bei fehlender Infrastruktur muss Health HTTP 503 liefern, bei gesunder Infrastruktur HTTP 200.

## Testanleitung für Arda nach freigegebenem Deployment

Erst nach erfolgreichem Deployment und echtem Browser-Smoke die tatsächlich geprüfte URL in
Linear eintragen. Admin-URL ist `<geprüfte URL>/admin/login`.
Einmalig einen Admin mit eigenem zufälligem Passwort erzeugen:

```sh
# ADMIN_BOOTSTRAP_PASSWORD vorher sicher als Umgebungsvariable setzen.
npm run user:create-admin -- eigene-admin-email@example.com
```

Der vorhandene Bootstrap setzt/aktualisiert einen Admin; erneutes Ausführen ändert dessen Passwort.
Testfall `WBA00000000000000` liefert bei einer leeren/unfreigegebenen Datenbank NO_DATA und einen
leeren Bericht. `INVALID` liefert eine sichtbare FIN-Fehlermeldung. NO_DATA bestätigt weder
Unfallfreiheit noch Kilometerstand. Ein echter Daten-Treffer bleibt ohne nachgewiesene Quellrechte
und gegebenenfalls Credentials blockiert. Keine synthetische Historie in Staging importieren.
SCH-7 bleibt In Progress bis zur unabhängigen Abnahme; dieser Arbeitsauftrag führt keinen Merge aus.
