# Provider-Onboarding und Datenminimierung

## Standard-Onboarding

Jede neue Quelle nutzt die bestehende `VehicleDataProvider`-Architektur. Vor einem Live-Aufruf müssen dokumentiert sein: Source-Key, Capabilities, Markt-Coverage, Auth-Typ, Refresh/Freshness, Rate-Limit-Hinweise, Mapping-Version und technische Konfiguration. Coverage-Status wird aus verifizierter Quellen-/Vertragsinformation gepflegt und niemals aus einzelnen VIN-Nichttreffern abgeleitet.

Lizenzrechte bleiben im bestehenden `SourceLicense`-Modell. `ProviderCoverage` beschreibt technische/geografische Abdeckung, nicht die rechtliche Erlaubnis zur Speicherung oder Veröffentlichung. Beides muss für die jeweilige Nutzung gemeinsam erfüllt sein.

## Mapping-Versionierung

Provider geben `mappingVersion` an. Die Version wird auf `ProviderRun`, `VehicleAttribute`, `VehicleEvent` und synchronisierten Coverage-Einträgen gespeichert. Eine Mapping-Änderung erhält eine neue stabile Version, zum Beispiel `provider-x-v2`. Historische Datensätze behalten ihre alte Version. Falls ein Reprocessing nötig wird, erfolgt es über einen nachvollziehbaren Import-/Reprocessing-Job; vorhandene Rohdaten werden nur verwendet, solange die jeweilige Retention dies erlaubt.

## Konfliktstrategie

Rohwerte und Provenance verschiedener Quellen werden nicht überschrieben. Attribute bleiben pro Quelle erhalten. Bei unterschiedlichen Werten wird `conflict=true` gesetzt. Für den Kundenbericht erfolgt die Auswahl deterministisch nach Datenqualitätsklasse und anschließend stabil nach Source-Key; Aktualität ist nur ein später Tie-Breaker und macht eine Quelle nicht automatisch „wahr“. Alle Kandidaten bleiben im Admin sichtbar.

Kilometerwerte werden als einzelne Events erhalten und über die Kilometeranalyse auf Rückgänge/Anomalien geprüft. Schaden-, Registrierungs- und Serviceevents verschiedener Quellen werden nicht zu einem vermeintlich eindeutigen Ereignis verschmolzen, solange dafür keine belastbare Matching-Regel existiert.

## Datenqualität

Verwendete Zustände: `UNVERIFIED`, `TECHNICALLY_VALID`, `VERIFIED`, `CONFLICTING`, `STALE`, `INCOMPLETE`, `PARTIAL`, `REJECTED`. Es werden keine künstlichen Prozent-Confidence-Werte erzeugt. Ein `conflict`-Flag ergänzt die Qualitätsklasse, damit ein ursprünglich durch die Quelle verifizierter Wert nicht seine Herkunftsaussage verliert.

## Datenschutz und Minimierung

FIN/VIN kann je Nutzungskontext mit einer Person oder einem Halter verknüpfbar sein. Schadendirekt speichert deshalb für die Fahrzeughistorie standardmäßig keine Halternamen, Anschriften oder andere Identitätsdaten. Quellen mit solchen Feldern müssen sie vor Normalisierung verwerfen, sofern keine gesonderte dokumentierte Rechtsgrundlage und Produktnotwendigkeit besteht.

Retention wird über `SourceLicense.retentionDays` und vorhandene Ablauf-/Cleanup-Mechanismen umgesetzt. Neue Quellen benötigen vor Produktivfreigabe einen dokumentierten Lösch-/Korrekturpfad. Rechtliche Zweifelsfragen werden als Reviewbedarf markiert und nicht durch Code-Kommentare oder Annahmen als geklärt behandelt.

## Report-Semantik

- `DATA`: veröffentlichbare Daten vorhanden bzw. frische persistierte Daten wurden verwendet.
- `NO_DATA`: Quelle wurde erfolgreich geprüft, lieferte aber keine Daten. Das ist niemals gleichbedeutend mit „kein Unfall“.
- `NOT_APPLICABLE`: bekannte Markt-/Coverage-Regel schließt die Quelle aus.
- `NOT_CONFIGURED`: Credentials oder notwendige Lizenz fehlen.
- `ERROR`: Providerfehler; darf nicht in `NO_DATA` umgedeutet werden.
- `SKIPPED`: bewusster Nichtaufruf, z. B. unbekannter Markt oder frische Daten.

## Phase-4-Entscheidung zur zusätzlichen EU-Quelle

In Phase 4 wird keine weitere Live-EU-Quelle nur für Demonstrationszwecke eingebaut. Solange kein offizieller/vertraglich autorisierter per-VIN Zugang inklusive erlaubter Speicherung/Weitergabe verifiziert ist, bleibt die Integrationsarchitektur das Ergebnis. Keine Scraper, keine übernommenen Daten von carVertical/CARFAX/autoDNA und keine erfundenen Zugangsdaten.
