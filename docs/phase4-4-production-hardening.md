# Phase 4.4 – Produktionshärtung

Diese Phase härtet die vorhandene Provider-/Import-Architektur. Sie aktiviert **keine neue Datenquelle** und **keine Payments**.

## Rights-Semantik: fail closed

Für `SourceLicense.markets/capabilities` und `SourceContract.markets/capabilities` gilt dieselbe Semantik:

- `null` / nicht gesetzt: bewusst unbeschränkt.
- `['*']`: explizit unbeschränkt.
- `[]`: keine Freigabe.
- Nicht-Array, gemischte Typen, leere Strings oder unbekannte Werte: keine Freigabe.
- Capabilities müssen aus dem internen Provider-Capability-Katalog stammen.
- Market-Scopes akzeptieren ausschließlich zweistellige, normalisierte Ländercodes oder `*`; Aliase werden nicht geraten.
- Auch ein unbekannter angefragter Scope wird trotz unbeschränkter Konfiguration nicht still akzeptiert.

Eine Lizenz ist nur nutzbar, wenn Review-Zeitpunkt, Reviewer und dokumentierte Lizenzinformation vorhanden sind. Ein produktiver Vertrag ist nur wirksam, wenn `active=true`, Review-Zeitpunkt, `reviewedBy`, Name **und** Referenz dokumentiert sind und der Gültigkeitszeitraum passt.

## Persistenz pro Capability

Ein Provider-Lookup wird nicht mehr all-or-nothing gespeichert:

1. Eligibility bestimmt die tatsächlich aufrufbaren Capabilities.
2. Für jede Capability werden STORE und COMMERCIALIZE getrennt geprüft.
3. STORE-freigegebene Felder/Ereignisse werden persistiert.
4. COMMERCIALIZE-freigegebene, aber nicht speicherbare Daten werden nur im aktuellen Report-Outcome zurückgegeben.
5. Daten ohne erforderliche Freigabe werden weder persistiert noch an den Report gegeben.

`ProviderAttribute` trägt eine explizite Capability. Für bekannte Alt-/Standardfelder existiert zusätzlich eine zentrale, fail-closed Feldzuordnung. `market`, Registrierung und Registrierungsdatum sind `REGISTRATION`, nicht pauschal `VEHICLE_SPECS`.

Provider-Raw-Payloads werden nur feldweise persistiert/weitergereicht, wenn der Provider eine `rawPayloadCapabilities`-Zuordnung liefert. Nicht klassifizierte Raw-Felder werden bei Capability-Filterung verworfen. Beim DVSA-Mapping sind MOT-Prüfungsfelder, Registrierung und Odometer getrennt markiert.

## Distributed Rate Limit

In Dev/Test bleibt In-Memory erlaubt. In Production ist ein geteilter Store erforderlich:

- `RATE_LIMIT_STORE=redis-rest`
- `REDIS_REST_URL`
- `REDIS_REST_TOKEN`

Der REST-Client nutzt eine Redis-kompatible `EVAL`-Operation; dadurch teilen sich mehrere App-Instanzen dieselben Provider-Counter. Ohne Shared Store meldet Production `RATE_LIMIT_SHARED_STORE_REQUIRED`. Credentials werden nicht geloggt oder in Health-Ausgaben ausgegeben.

## Production Object Storage

In Production muss `IMPORT_STORAGE_DRIVER=s3` gesetzt sein. Der Treiber ist path-style S3-kompatibel und für AWS S3/R2/MinIO vorgesehen:

- `IMPORT_STORAGE_S3_ENDPOINT`
- `IMPORT_STORAGE_S3_REGION`
- `IMPORT_STORAGE_S3_BUCKET`
- `IMPORT_STORAGE_S3_ACCESS_KEY_ID`
- `IMPORT_STORAGE_S3_SECRET_ACCESS_KEY`
- optional `IMPORT_STORAGE_S3_SESSION_TOKEN`

Upload und Download sind streamingbasiert. Uploads berechnen SHA-256 und Größe während des Streams. API und Worker verwenden beide `getImportStorage()` und damit denselben ENV-selektierten Backend-Typ. Lokales Dateisystem ist in Production absichtlich gesperrt.

## Retention, Retry und Reprocessing

Ein erfolgreich verarbeiteter Import löscht die Rohdatei nicht mehr automatisch. Solange rechtlich erlaubt, bleibt sie bis `expiresAt` im Object Storage. `PARTIAL`/`FAILED` bleiben ebenfalls retryfähig. Cleanup entfernt Rohdateien erst nach Ablauf der Retention.

`reprocessImportJob()` setzt denselben Job mit derselben Rohdatei auf `PENDING` zurück und verlangt eine neue Mapping-Version. `ImportAuditLog` protokolliert insbesondere `REPROCESS`, `RETRY`, `DELETE_POLICY` und `DELETE_RETENTION`.

Wenn die Storage-Freigabe entfällt oder die Policy sofortige Löschung verlangt, wird die Rohdatei entfernt und der Delete-Audit geschrieben. Für DVSA-Roharchive werden STORE-Rechte für sämtliche im Archiv enthaltenen Bulk-Capabilities verlangt, weil das untransformierte Archiv selbst capability-übergreifend ist.

## Große Dateien / Abuse-Schutz

`ImportObject.sizeBytes` ist PostgreSQL `BIGINT` / Prisma `BigInt`. JSON-Ausgaben serialisieren die Größe als String.

`IMPORT_MAX_BYTES` begrenzt Uploads (Default: 5 GiB). `Content-Length` dient nur als frühe Ablehnung. Die verbindliche Grenze wird während des Storage-Streams gezählt. Bei Überschreitung wird der Upload abgebrochen und ein eventuell begonnenes Partial Object gelöscht.

## Production Gates

Die Admin-Ansicht zeigt explizit, ob Shared Rate Limit und Shared Object Storage produktionsbereit sind. Sie zeigt keine Secrets. Unvollständig geprüfte Verträge werden nicht als freigegeben dargestellt.
