# DVSA MOT History integration

Status: Code/Fixtures implementiert. **Kein Live-Zugriff wurde behauptet oder getestet, solange keine echten DVSA-Credentials in der Laufzeitumgebung vorhanden sind.**

## Offizielle Quelle

- Dokumentation: https://documentation.history.mot.api.gov.uk/
- API-Spezifikation: https://documentation.history.mot.api.gov.uk/mot-history-api/api-specification/
- Authentifizierung: https://documentation.history.mot.api.gov.uk/mot-history-api/authentication/
- Bulk/Delta: https://documentation.history.mot.api.gov.uk/mot-history-api/download-vehicle-mot-history-data/
- Fehlercodes: https://documentation.history.mot.api.gov.uk/mot-history-api/error-codes/
- Rate Limits: https://documentation.history.mot.api.gov.uk/mot-history-api/rate-limits/

Die Quelle deckt MOT-Prüfungsdaten für unterstützte Fahrzeuge in Großbritannien und Nordirland ab. Sie ist **keine Unfall- oder Versicherungshistorie**.

## Zugang

DVSA verwendet OAuth 2.0 Client Credentials und zusätzlich `X-API-Key`. Nach der Registrierung liefert DVSA Client ID, Client Secret, Scope URL, Token URL und API Key. Access Tokens werden serverseitig gecacht und vor Ablauf erneuert; kein Credential wird an Browser/öffentliche Responses ausgegeben.

Benötigte ENV-Werte:

```text
DVSA_CLIENT_ID
DVSA_CLIENT_SECRET
DVSA_SCOPE_URL
DVSA_TOKEN_URL
DVSA_API_KEY
DVSA_BASE_URL=https://history.mot.api.gov.uk
```

Der Admin zeigt nur `CONFIGURED` oder `MISSING` sowie Namen fehlender ENV-Schlüssel, niemals Secret-Werte. Laut DVSA kann ein ungenutzter API-Key nach 90 Tagen widerrufen werden; Client Secrets laufen nach zwei Jahren ab.

## Einzelabfrage

Implementiert/vorbereitet:

- `GET /v1/trade/vehicles/vin/{vin}` – produktiver Schadendirekt-Flow
- `GET /v1/trade/vehicles/registration/{registration}` – Client-seitig vorbereitet
- `GET /v1/trade/vehicles/bulk-download` – Manifest-Client vorbereitet

Fehlersemantik:

- `404` + `MOTH-NF-01`: Fahrzeug tatsächlich nicht gefunden, kein Providerfehler
- `401`/`403`: Auth-/Berechtigungsfehler, niemals `NO_DATA`
- `429`: Rate-Limit-/Quota-Fehler, Retry/Backoff und danach expliziter Providerfehler
- `5xx`/Timeout/Netzwerk: retrybar, anschließend expliziter Providerfehler

Schadendirekt begrenzt eigene DVSA-Aufrufe konservativ auf 10 pro Sekunde. Die offizielle Dokumentation nennt 500.000 Requests/Tag, Burst 10 und durchschnittlich 15 RPS.

## MOT-Mapping

Ein MOT-Test wird als `VehicleEvent(eventType=INSPECTION)` gespeichert. `motTestNumber` wird als stabile Source-External-ID verwendet (`mot:<number>`), sodass wiederholte Abfragen denselben Event updaten statt Duplikate anzulegen.

Persistiert werden – sofern geliefert und lizenzrechtlich erlaubt – unter anderem:

- Testdatum
- Ergebnis `PASSED` / `FAILED`
- Ablaufdatum
- MOT-Testnummer
- Registration zum Testzeitpunkt
- Odometer-Originalwert
- Odometer-Originaleinheit
- Odometer-Result-Type
- normalisierter Kilometerwert
- strukturierte Defects/Advisories (`text`, `type`, `dangerous`)
- DVSA-DataSource/Provenance

Defects liegen strukturiert im Event-Rohpayload und werden im Report strukturiert angezeigt, nicht zu einem einzigen Freitext zusammengefasst.

## Odometer

- `KM`: numerischer Wert wird als Kilometer übernommen.
- `MI`: Multiplikation mit exakt `1.609344`, danach Rundung auf ganze Kilometer.
- unbekannte/fehlende Einheit: `mileageKm = null`; es wird nichts geraten.
- Originalwert und Originaleinheit bleiben im Rohpayload erhalten.

Die bestehende Mileage Analysis verwendet `mileageKm` von INSPECTION-Events direkt zusammen mit anderen freigegebenen Kilometerquellen.

## Lizenzfreigabe

Runtime-Code erzeugt **keine DVSA-Nutzungsrechte**. `DataSource(dvsa-mot)` darf technisch entstehen, `SourceLicense` muss nach realer Prüfung separat erfasst werden.

Dafür existiert:

```bash
npm run license:configure-dvsa
```

Erforderlich sind die Variablen `DVSA_LICENSE_APPROVAL=I_HAVE_REVIEWED_THE_DVSA_TERMS`, `DVSA_LICENSE_REVIEWED_BY`, `DVSA_LICENSE_TERMS_URL`, `DVSA_LICENSE_NOTES` sowie explizite `true`/`false`-Werte für Store/Redistribute/Commercialize. Es gibt absichtlich keine automatisch positiven Defaults. Retention kann über `DVSA_LICENSE_RETENTION_DAYS` dokumentiert werden.

Ohne aktive `STORE`-Freigabe werden DVSA-Ergebnisse nicht persistiert. Ohne aktive Commercialize-/Redistribute-Freigabe werden vorhandene DVSA-Daten nicht im öffentlichen Report veröffentlicht.

## Bulk und Delta

DVSA stellt wöchentlich einen vollständigen Bulk-Snapshot und täglich Delta-Dateien bereit. Die Download-API gibt kurzlebige S3-URLs zurück; laut DVSA laufen diese nach etwa fünf Minuten ab und dürfen nicht als dauerhafte Credentials gespeichert werden.

Die Archive enthalten große JSON-Dokumente im NDJSON-Stil; einzelne Bulk-Dateien enthalten laut Dokumentation ungefähr 500.000 komplette Fahrzeugdatensätze. `parseDvsaNdjsonStream()` verarbeitet dekomprimierte JSON-Dokumente zeilenweise und hält nicht die gesamte Datei im RAM. `CREATED`, `UPDATED` und `DELETED` werden erkannt.

Wichtig für den nächsten Live-Schritt: In den offiziell dokumentierten Bulk-Beispielen ist die Registrierung enthalten, aber nicht zwingend eine VIN. Schadendirekt erzeugt daher **nicht** eigenmächtig VINs oder verknüpft Bulk-Datensätze unsicher mit Fahrzeugen. Der Live-Bulk-Ingest muss nach Erhalt echter Dateien/Zugangsdaten anhand des tatsächlich gelieferten Identitätsschlüssels final freigeschaltet werden. Die bestehende Object-Storage-/Worker-Architektur aus Issue #4 bleibt die Zielstrecke:

`Download -> Object Storage -> Streaming/Archive Parser -> Worker -> DB-Batches`

## Testdaten

`fixtures/dvsa/*` sind ausdrücklich synthetische Testfixtures. Sie werden nicht als Produktivhistorien importiert.
