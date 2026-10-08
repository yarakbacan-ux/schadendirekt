# Deutschland/EU Source Matrix

Stand: 2026-10-08. Diese Matrix ist ein Integrationsinventar, keine Aussage über die Historie eines konkreten Fahrzeugs. `UNAVAILABLE` bedeutet nur: für Schadendirekt ist aktuell kein verifizierter, rechtlich freigegebener Produktivzugang vorhanden.

| Kategorie | Betreiber / Quelle | Zugang | Per VIN | Datenarten | Gebiet | Weitergabe / kommerzielle Nutzung | Retention | Status für Schadendirekt | Verifizierte Grundlage |
|---|---|---|---|---|---|---|---|---|---|
| Fahrzeugregister | Kraftfahrt-Bundesamt (ZFZR) | Registerauskunft nur bei gesetzlicher Berechtigung; kein verifizierter allgemeiner Reseller-API-Zugang | Ja, in berechtigten Auskunftsfällen | Fahrzeug-/Halterdaten | DE | Zweckgebunden; kein allgemeiner Historien-Resale verifiziert | Rechtsgrundlagen/Einzelfall prüfen | `UNAVAILABLE` für Produktbericht | §39/39a StVG; öffentliche Verwaltungsinformationen zur Fahrzeugregisterauskunft |
| Öffentliche Fahrzeugdaten | KBA / GovData / Mobilithek | Öffentliche Statistik-/Open-Data-Datensätze | überwiegend Nein | Bestände, Zulassungsstatistik, Marktüberwachung | DE | Datensatzabhängige Lizenz prüfen | datensatzabhängig | `PLANNED` nur für Aggregat-/Kontextdaten | GovData/KBA-Publisher |
| Rückrufe | KBA Rückrufdatenbank, via GovData/Mobilithek | öffentlicher Datensatz, u.a. CSV | Nein (Rückrufaktion ist typ-/modellbezogen, keine individuelle VIN-Bestätigung) | Rückrufe, Mängel, Aktionen | DE | konkrete Datensatzlizenz vor Persistenz/Redistribution prüfen | datensatzabhängig | `PLANNED` als nicht-VIN-spezifische Ergänzung | GovData: „Rückrufdatenbank für Fahrzeuge, Fahrzeugteile und Zubehör“ |
| Hauptuntersuchung | amtlich anerkannte Prüforganisationen / zuständige Systeme | kein verifizierter allgemeiner öffentlicher per-VIN API-/Bulk-Zugang für kommerziellen Fahrzeughistorien-Resale gefunden | potentiell bei Partnerzugang | HU/AU, Mängel, Kilometerstände | DE | Partnervertrag/Rechtsprüfung erforderlich | offen | `PLANNED` / Partner-Onboarding | Kein produktiver Zugang behauptet |
| Versicherungs-/Schadendaten | Besurance HIS GmbH / GDV HIS | HIS dient Risikoprüfung/Betrugsbekämpfung; kein verifizierter Schadendirekt-Resellerzugang | systemintern fallbezogen | Hinweise für Versicherungswirtschaft | DE | keine kommerzielle Weitergabe an Schadendirekt verifiziert | nach HIS-/Datenschutzregeln | `UNAVAILABLE` | GDV: HIS, Betreiber seit 01.10.2025 Besurance HIS GmbH |
| Auktionen / Restwertbörsen | verschiedene private Betreiber | nur vertraglich/partnerschaftlich denkbar; kein verifizierter Zugang | je Anbieter | Auktion, Restwert, Fotos, Schäden | DE/EU | Vertrag + Bild-/Datenrechte erforderlich | offen | `PLANNED` | Anbieter einzeln prüfen; keine Scraper |
| Werkstatt-/Servicehistorie | OEM-Netze, Werkstatt-/DMS-Anbieter | kein universeller öffentlicher Zugang; Partnervertrag/Einwilligung möglich | je System | Service, Reparatur, Kilometer | DE/EU | Quelle/Vertrag/Einwilligung abhängig | quelleabhängig | `PLANNED` | kein allgemeiner Produktivzugang behauptet |
| Leasing/Fuhrpark | Leasing-/Fleet-Partner | B2B-Partnervertrag | Ja, bei Partnerdaten | Laufleistung, Service, Schäden, Halter-/Flottenkontext | DE/EU | Vertrag, Zweckbindung und Datenminimierung | vertraglich | `PLANNED` | Partner-Onboarding erforderlich |
| OEM/Hersteller | herstellerspezifisch | herstellerspezifische APIs/Partnerprogramme; kein universeller Zugang | teilweise | Stammdaten, Service, Rückrufe, Connected-Car-Daten | DE/EU | je Hersteller/Vertrag | je Hersteller/Vertrag | `PLANNED` | einzelne OEMs separat prüfen |
| Zulassungs-/Import-/Exportdaten EU | EUCARIS / nationale Zulassungsbehörden | EUCARIS ist Behördenaustausch; private Parteien erhalten keinen direkten EUCARIS-Zugang | Ja, für bestimmte Behördenservices | Registrierungs-/Fahrzeugdaten, je Service | EU/teilnehmende Staaten | direkter privater Zugriff nicht verfügbar; nationale Rechtswege prüfen | service-/rechtsgrundlagenabhängig | `UNAVAILABLE` direkt | EUCARIS: private parties cannot get direct access |
| eCoC / Initial Vehicle Information | nationale Genehmigungsbehörden, EUCARIS als Behördenaustausch | öffentliche VIN-Abfrage soll durch Genehmigungsbehörden ermöglicht werden; konkrete nationale Zugangspunkte/Weitergaberechte separat prüfen | Ja, Zielbild laut eCoC-Regelwerk | Certificate of Conformity / Initial Vehicle Information | EU | öffentliche Read-only-Nutzung ≠ automatische Resale-/Speicherfreigabe | offen | `PLANNED` / Legal+Technical Review | EUCARIS IVI-Dokumentation, VO (EU) 2018/858 / Durchführungsrecht |

## Verifizierte Kernpunkte

- EUCARIS ist ein Austauschmechanismus zwischen nationalen Zulassungsbehörden, keine frei zugängliche zentrale Fahrzeughistorien-Datenbank. Private Parteien erhalten keinen direkten Zugang; sie müssen nationale rechtliche Zugänge prüfen.
- Das KBA führt das Zentrale Fahrzeugregister. Eine einfache Registerauskunft kann bei berechtigtem Zweck u.a. anhand FIN erfolgen. Das ist kein allgemeiner kommerzieller Fahrzeughistorien-API-Zugang.
- Die KBA-Rückrufdatenbank ist öffentlich als Datensatz verfügbar. Sie ist nicht automatisch eine individuelle VIN-Betroffenheitsbestätigung.
- Das HIS der deutschen Versicherungswirtschaft dient Risikoprüfung und Betrugsbekämpfung. Ein Schadendirekt-Resellerzugang ist nicht verifiziert und wird daher nicht integriert.

## Onboarding-Regel

Eine Quelle wechselt erst von `PLANNED`/`UNAVAILABLE` auf `PARTIAL` oder `LIVE`, wenn mindestens technische Zugangsmöglichkeit, Datenumfang, Lizenz-/Weitergaberecht, Retention und ein verantwortlicher Review dokumentiert sind. Fehlende Treffer ändern niemals den Coverage-Status einer Quelle.

## Offene Partnerpfade

Priorität für Deutschland: (1) Prüforganisation/HU-Partner, (2) Leasing/Fuhrpark-Partner, (3) Werkstatt-/DMS-Partner, (4) autorisierte Auktions-/Restwertquelle, (5) OEM-spezifische Programme. Für jeden Pfad wird zuerst ein Vertrag-/Lizenzdatensatz angelegt; erst danach folgt ein Live-Adapter.
