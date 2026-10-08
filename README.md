# Schadendirekt

Unabhängige Fahrzeughistorien-Plattform mit nachvollziehbarer Datenherkunft. Fehlende Daten werden ausdrücklich als **„keine Daten vorhanden“** dargestellt und niemals als Aussage, dass ein Fahrzeug unfallfrei sei oder der Kilometerstand korrekt sei.

## Architekturstand

- Next.js + TypeScript
- PostgreSQL + Prisma mit versionierten Migrationen
- öffentliche FIN-Abfrage `GET /api/v1/vehicles/:vin`
- öffentlicher Fahrzeugbericht unter `/report/[vin]`
- DB-basierte Admin-Authentifizierung mit Scrypt-Passwort-Hashes und serverseitigen Sessions
- Rollen `ADMIN`, `ANALYST`, `VIEWER`
- SameSite/HttpOnly Session-Cookie, CSRF-Token für schreibende Admin-APIs und Login-Rate-Limit
- asynchrone Importarchitektur mit Worker und Batch-Verarbeitung
- RFC-4180-tauglicher CSV-Parser
- Zod-Validierung, stabiler Event-Fingerprint, `PARTIAL`-Status und Fehlerzahlen
- zentrale Lizenzpolicy für Speicherung, Weitergabe, kommerzielle Veröffentlichung und Gültigkeitszeiträume
- Retention für Importpayloads und Event-Rohdaten
- Request-ID und kontrollierte 5xx-Antworten
- CI mit PostgreSQL-Service, Migrationen, Dependency-Audit, Prisma Generate, Tests, Typecheck und Production Build

## Phase 2: Bericht und Fahrzeugdaten

### Internes Ereignismodell

Quellenspezifische Ereignisnamen werden in ein stabiles internes Modell normalisiert:

- `ODOMETER_READING`
- `DAMAGE_RECORD`
- `INSPECTION`
- `REGISTRATION`
- `SALE_LISTING`
- `SERVICE`
- `RECALL`
- `IMPORT_EXPORT`
- `OTHER`

Der Originaltyp bleibt zusätzlich in `sourceEventType` erhalten. Dadurch geht keine Information aus der Quelle verloren.

### Kilometeranalyse

Der Bericht analysiert datierte Kilometerstände und liefert ausschließlich technische Hinweise:

- `OK`
- `NOTICE`
- `SUSPICIOUS`
- `INSUFFICIENT_DATA`

Geprüft werden unter anderem rückläufige Kilometerstände, identische Werte über lange Zeiträume, ungewöhnlich große Sprünge und widersprüchliche Werte am selben Datum. Jeder Hinweis referenziert die zugrunde liegenden Ereignis-IDs. Die Analyse ist keine juristisch absolute Aussage zur Manipulation.

### Fahrzeugstammdaten und Provenance

Strukturierte Fahrzeugfelder wie Marke, Modell, Modelljahr, Karosserie, Kraftstoff, Hubraum, Leistung, Getriebe, Hersteller, Produktionsland und Fahrzeugtyp werden direkt am Fahrzeug gespeichert. Die Herkunft jedes veröffentlichten Felds wird zusätzlich über `VehicleAttribute` abgebildet. Ohne passende aktive Lizenz und Feld-Provenance wird ein Feld im öffentlichen Bericht nicht veröffentlicht.

## NHTSA vPIC

`nhtsa-vpic` ist die erste reale Datenquelle für VIN-Decoding und technische Stammdaten. Diese Quelle wird **nicht** als Unfall- oder Fahrzeughistorie behandelt.

### Entscheidung: Live-API zuerst, lokaler Dump später

Für den aktuellen Projektstand wird die offizielle vPIC Live-API genutzt und das Ergebnis pro VIN 30 Tage in `VinDecodeCache` zwischengespeichert. Gründe:

- geringer Betriebsaufwand in der frühen Phase
- keine separate Datenbank-Importstrecke notwendig
- einzelne VIN-Abfragen passen zum aktuellen Produktvolumen
- Timeout und internes Rate-Limit sind implementiert

Für höhere Stückzahlen soll auf den von NHTSA bereitgestellten PostgreSQL-Standalone-Dump gewechselt werden. NHTSA stellt den Dump ausdrücklich für lokale VIN-Decoding-Szenarien bereit, um API-Quotas bzw. Rate-Limits zu vermeiden. Der Dump deckt VIN-Decoding ab; zusätzliche vPIC-Informationen können weiterhin API-Aufrufe benötigen.

### Source-Mapping

| Schadendirekt | vPIC Feld |
| --- | --- |
| `make` | `Make` |
| `model` | `Model` |
| `modelYear` | `ModelYear` |
| `bodyClass` | `BodyClass` |
| `fuelType` | `FuelTypePrimary` |
| `engineDisplacement` | `DisplacementL` |
| `enginePowerKw` | `EngineKW`, Fallback aus `EngineHP` |
| `transmission` | `TransmissionStyle` |
| `manufacturer` | `Manufacturer` |
| `plantCountry` | `PlantCountry` |
| `vehicleType` | `VehicleType` |

Leere oder fehlende vPIC-Werte werden nicht erfunden und nicht in Fahrzeugfelder übernommen.

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

`/admin/login` verwendet Benutzer aus der `User`-Tabelle. Passwörter werden als Scrypt-Hash gespeichert. Erfolgreiche Logins erzeugen eine zufällige, in der DB nur gehashte Session. Schreibende Admin-APIs verlangen zusätzlich einen CSRF-Token. Die Login-Rate-Limitierung ist aktuell pro Prozess; für horizontal skalierte Produktion sollte sie auf einen zentralen Store wie Redis umgestellt werden.

## Importarchitektur

`POST /api/v1/imports` verlangt eine gültige Session mit Rolle `ADMIN` oder `ANALYST`, `X-Source-Key`, passenden Content-Type und `X-CSRF-Token`. Der Request wird **nicht synchron importiert**. Stattdessen wird ein `PENDING`-Importjob mit Payloadreferenz gespeichert und `202 Accepted` zurückgegeben.

Der Worker wird über `POST /api/internal/import-worker` mit `Authorization: Bearer <WORKER_TOKEN>` aufgerufen. Er verarbeitet offene Jobs in Batches. Für Produktion sollte dieser Endpunkt durch Scheduler/Queue-Infrastruktur ausgelöst werden.

CSV unterstützt Quotes, eingebettete Kommas, escaped Quotes, CRLF, UTF-8 und Zeilenumbrüche in quoted fields. Datensätze werden vor Persistenz mit Zod validiert. Ohne externe Source-ID wird eine stabile SHA-256-Fingerprint-ID aus fachlichen Feldern gebildet; die Zeilenposition spielt keine Rolle.

## Lizenz- und Retention-Policy

Eine Lizenz ist nur nutzbar, wenn sie zum aktuellen Zeitpunkt zwischen `validFrom` und `validUntil` liegt. Speicherung benötigt `canStore`. Öffentliche kommerzielle Ausgabe benötigt **beides**: `canRedistribute` und `canCommercialize`.

`retentionDays` steuert das Ablaufdatum gespeicherter Rohpayloads. Abgelaufene Event-Rohdaten werden bereinigt und abgelaufene Importpayloads gelöscht. Quellen mit `retentionDays = 0` werden für die asynchrone Importablage abgelehnt.

## Tests und CI

```bash
npm test
npx tsc --noEmit
npm run build
```

GitHub Actions startet PostgreSQL, führt `prisma migrate deploy` aus, prüft `npm audit --audit-level=moderate`, generiert Prisma Client, startet Tests, TypeScript-Check und den Next.js-Production-Build.

## Sicherheits- und Datenprinzipien

- keine erfundenen Fahrzeughistorien
- fehlende Historie ist keine Aussage über Unfallfreiheit
- fehlende Kilometerdaten sind keine Bestätigung eines korrekten Kilometerstands
- NHTSA vPIC liefert Stammdaten und wird nicht als Unfallhistorie dargestellt
- keine Veröffentlichung ohne aktive, passende Nutzungsrechte
- Feld- und Ereignisherkunft nachvollziehbar halten
- keine Secrets im Repository
- Importdaten starten mit Qualitätsstatus `UNVERIFIED`
- Rohdaten nur innerhalb erlaubter Retention
- API-Fehler mit Request-ID statt unstrukturierter Framework-Ausgabe
