# Provider-Onboarding und Datenminimierung

## Standard-Onboarding

Jede neue Quelle nutzt die bestehende `VehicleDataProvider`-Architektur. Vor einem Live-Aufruf müssen dokumentiert sein: Source-Key, Capabilities, Markt-Coverage, Auth-Typ, Refresh/Freshness, Rate-Limit-Hinweise, Mapping-Version und technische Konfiguration. Coverage-Status wird aus verifizierter Quellen-/Vertragsinformation gepflegt und niemals aus einzelnen VIN-Nichttreffern abgeleitet.

Lizenzrechte bleiben im `SourceLicense`-Modell. Vertragliche Freigaben werden davon getrennt in `SourceContract` geführt. `ProviderCoverage` beschreibt die operative technische/geografische Abdeckung und ihre Voraussetzungen. Ein Provider kann deshalb gleichzeitig eine gültige Lizenz und einen fehlenden Vertrag haben oder umgekehrt; `LICENSE_REQUIRED` und `CONTRACT_REQUIRED` sind getrennte Eligibility-Gründe.

## ProviderCoverage als operative Source-of-Truth

Die Coverage-Definition im Provider-Code ist nur Bootstrap für noch nicht vorhandene `(source, market, capability)`-Zeilen. Sobald eine `ProviderCoverage`-Zeile in der Datenbank existiert, wird sie bei normalen VIN-Lookups **nicht** mehr aus dem Code überschrieben. Damit kann Operations eine Quelle z. B. auf `UNAVAILABLE`, `PLANNED` oder mit abweichender Freshness setzen, ohne dass ein späterer Request diese Entscheidung zurücksetzt.

Operativ aus der Datenbank berücksichtigt werden insbesondere:
- Markt und Capability,
- Status (`LIVE`, `PARTIAL`, `PLANNED`, `UNAVAILABLE`),
- `LICENSE`-/`CONTRACT`-/Credential-Voraussetzungen,
- `freshnessSeconds`,
- `allowUnknownMarket`,
- Mapping-Version und Last-Success-Metadaten.

Änderungen an Coverage sind ein administrativer Onboarding-/Operations-Vorgang und nicht das Ergebnis eines einzelnen `NO_DATA`-Treffers.

## Marktlogik / zweistufiger Report-Lookup

Marktspezifische Provider dürfen nicht anhand WMI, Herstellerland oder ähnlicher Heuristiken als passend angenommen werden. Der Report arbeitet konservativ:

1. Bei unbekanntem Markt laufen nur Provider, deren operative Coverage unbekannte Märkte ausdrücklich zulässt (typisch globale Identifikations-/Stammdatenquellen).
2. Marktspezifische Provider werden zunächst als `MARKET_UNKNOWN` übersprungen.
3. Ergibt die erste Stufe einen gespeicherten, nicht widersprüchlichen und qualifizierten `market`-Wert mit zulässiger Storage-Provenance, werden nur die zuvor wegen `MARKET_UNKNOWN` übersprungenen Provider erneut bewertet.
4. Ein belegter Markt außerhalb der Provider-Coverage ergibt `NOT_APPLICABLE`, nicht `NO_DATA`.

Ein kanonischer `Vehicle.market`-Wert ohne passende Provenance reicht nicht zur Provider-Auswahl.

## Mapping-Versionierung

Provider geben `mappingVersion` an. Die Version wird auf `ProviderRun`, `VehicleAttribute`, `VehicleEvent` und Coverage-Einträgen gespeichert. Eine Mapping-Änderung erhält eine neue stabile Version, zum Beispiel `provider-x-v2`. Historische Datensätze behalten ihre alte Version.

Generische CSV-/JSON-Importe tragen zusätzlich `ImportJob.mappingVersion` (Default `generic-import-v1`). Der Import schreibt diese Version auf jedes erzeugte oder aktualisierte `VehicleEvent`. Derselbe Payload darf mit einer neuen Mapping-Version erneut als eigener Job verarbeitet werden; dadurch bleibt nachvollziehbar, mit welcher Mapping-Regel ein normalisierter Datensatz entstanden ist. Rohdaten dürfen für Reprocessing nur verwendet werden, solange die jeweilige Retention dies erlaubt.

## Konfliktstrategie

Rohwerte und Provenance verschiedener Quellen werden nicht überschrieben. Attribute bleiben pro Quelle erhalten. Bei unterschiedlichen Werten wird `conflict=true` gesetzt. Für den Kundenbericht erfolgt die Auswahl deterministisch nach Datenqualitätsklasse und anschließend stabil nach Source-Key; Aktualität ist nur ein später Tie-Breaker und macht eine Quelle nicht automatisch „wahr“. Alle Kandidaten bleiben im Admin sichtbar.

Für Events gelten bewusst konservative Regeln:
- **Kilometer:** bestehende Mileage-Analyse bleibt maßgeblich. Nur klare `BACKWARD_READING`- und `SAME_DATE_CONFLICT`-Befunde setzen Event-`conflict`; reine Hinweise wie starke Sprünge sind nicht automatisch ein Quellenwiderspruch.
- **Registrierung:** Konflikt nur bei direkt vergleichbaren Ereignissen mit gleichem Datum und gleicher Quellsemantik, wenn widersprüchliche Länder gemeldet werden.
- **Schaden:** keine automatische Zusammenführung oder Konfliktmarkierung allein aufgrund gleicher VIN und gleichen Datums. Dafür wäre eine belastbare quellenübergreifende Incident-ID oder eine gesondert geprüfte Matching-Regel erforderlich.
- Andere Eventklassen bleiben getrennt, solange keine fachlich belastbare Vergleichsregel definiert ist.

Damit bedeutet `conflict=false` bei einem Schadenereignis nicht, dass andere Quellen den Schaden bestätigen oder ausschließen; es bedeutet nur, dass keine freigegebene Konfliktregel ausgelöst wurde.

## Datenqualität

Verwendete Zustände: `UNVERIFIED`, `TECHNICALLY_VALID`, `VERIFIED`, `CONFLICTING`, `STALE`, `INCOMPLETE`, `PARTIAL`, `REJECTED`. Es werden keine künstlichen Prozent-Confidence-Werte erzeugt. Ein `conflict`-Flag ergänzt die Qualitätsklasse, damit ein ursprünglich durch die Quelle verifizierter Wert nicht seine Herkunftsaussage verliert.

## Datenschutz und Minimierung

FIN/VIN kann je Nutzungskontext mit einer Person oder einem Halter verknüpfbar sein. Schadendirekt speichert deshalb für die Fahrzeughistorie standardmäßig keine Halternamen, Anschriften oder andere Identitätsdaten. Quellen mit solchen Feldern müssen sie vor Normalisierung verwerfen, sofern keine gesonderte dokumentierte Rechtsgrundlage und Produktnotwendigkeit besteht.

Retention wird über `SourceLicense.retentionDays` und vorhandene Ablauf-/Cleanup-Mechanismen umgesetzt. Neue Quellen benötigen vor Produktivfreigabe einen dokumentierten Lösch-/Korrekturpfad. Rechtliche Zweifelsfragen werden als Reviewbedarf markiert und nicht durch Code-Kommentare oder Annahmen als geklärt behandelt.

## Report-Semantik

- `DATA`: veröffentlichbare Daten vorhanden bzw. frische persistierte Daten wurden verwendet.
- `NO_DATA`: Quelle wurde erfolgreich geprüft, lieferte aber keine Daten. Das ist niemals gleichbedeutend mit „kein Unfall“.
- `NOT_APPLICABLE`: bekannte Markt-/Coverage-Regel schließt die Quelle aus.
- `NOT_CONFIGURED`: Credentials, notwendige Lizenz oder notwendiger Vertrag fehlen; `reason` unterscheidet diese Fälle.
- `ERROR`: Providerfehler; darf nicht in `NO_DATA` umgedeutet werden.
- `SKIPPED`: bewusster Nichtaufruf, z. B. unbekannter Markt oder frische Daten.

## Phase-4-Entscheidung zur zusätzlichen EU-Quelle

In Phase 4 wird keine weitere Live-EU-Quelle nur für Demonstrationszwecke eingebaut. Solange kein offizieller/vertraglich autorisierter per-VIN Zugang inklusive erlaubter Speicherung/Weitergabe verifiziert ist, bleibt die Integrationsarchitektur das Ergebnis. Keine Scraper, keine übernommenen Daten von carVertical/CARFAX/autoDNA und keine erfundenen Zugangsdaten.

Zusätzlich bleibt Issue #9 (Repository-Schutz / produktive DVSA-Freigabe) ein Blocker vor weiteren produktiven Integrationen. Der aktuelle `main`-Branch ist weiterhin nicht geschützt; deshalb wird durch diese Restabnahme keine neue produktive Datenquelle aktiviert.
