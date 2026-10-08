# Schadendirekt Source-Matrix Deutschland / EU

Stand: 2026-10-08. Diese Matrix trennt **öffentlich verifizierbare Fakten** von noch ungeklärten Partner-/Lizenzfragen. Ein Eintrag bedeutet ausdrücklich nicht, dass Schadendirekt die Daten schon speichern oder kommerziell weitergeben darf.

## Statusregeln

- `VERIFIED_PUBLIC`: offizieller öffentlicher Zugang ist dokumentiert.
- `PARTNER_REVIEW`: Quelle/Datensatz existiert, produktiver Zugang und Nutzungsrechte müssen vertraglich geklärt werden.
- `PURPOSE_LIMITED`: Zugriff ist nur für einen bestimmten gesetzlichen/vertraglichen Zweck vorgesehen und darf nicht als allgemeine Fahrzeughistorie zweckentfremdet werden.
- `NO_VERIFIED_VIN_API`: es wurde kein offizieller allgemein nutzbarer per-VIN-API-/Bulk-Zugang verifiziert.
- `DO_NOT_INTEGRATE`: ohne neue Rechts-/Vertragsgrundlage nicht in die produktive Historienplattform übernehmen.

| Kategorie | Betreiber / Quelle | Offizieller Zugang | Per-VIN? | Relevante Daten | Geografie | Speicherung / Weitergabe | Schadendirekt-Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fahrzeugregister / Zulassung | Kraftfahrt-Bundesamt / ZFZR und Zulassungsbehörden | Registerauskünfte sind gesetzlich zweckgebunden. Das Bundesportal beschreibt Halter-/Versicherungsauskunft bei verkehrsbezogenem Rechtsanspruch; eigene Fahrzeugauskunft ist ebenfalls möglich. | Teilweise, aber zweckgebunden | Fahrzeug-/Halter-/Versicherungsbezug | DE | Keine allgemeine kommerzielle Wiederverwendung verifiziert | `PURPOSE_LIMITED`, `DO_NOT_INTEGRATE` für allgemeine Historie |
| KBA Statistik / Open Data | Kraftfahrt-Bundesamt | Öffentliche Statistik-Downloads/Statistikportal | Nein, aggregiert | Bestände, Neuzulassungen, Typ-/Marktstatistik | DE | Je Datensatz gesonderte Nutzungsbedingungen prüfen | `VERIFIED_PUBLIC`, aber nicht für individuelle Fahrzeughistorie |
| Hauptuntersuchung | DEKRA | Offizielles Formular „HU-Prüfbericht anfordern“. DEKRA nennt FIN als Suchmerkmal; gewerbliche Kunden benötigen eine unterschriebene Vollmacht des Halters. Laut FAQ kann nur ein DEKRA-HU-Bericht der letzten zwei Jahre bereitgestellt werden. | Ja, aber autorisierungsgebunden | HU-Prüfbericht | DE / DEKRA-Bestand | Keine allgemeine Speicherung/Weitergabe für Fahrzeughistorien verifiziert | `PARTNER_REVIEW`; kein Live-Provider ohne Vertrag/Rechtsprüfung |
| Versicherungs-Hinweisdaten | Besurance HIS / GDV-Umfeld | HIS dient Risikoprüfung/Betrugsprävention. Für eine Fahrzeug-Selbstauskunft werden u. a. FIN und Nachweis als Halter/Eigentümer/Versicherungsnehmer verlangt. | Ja, aber Betroffenen-/Berechtigungsprüfung | Hinweise zu versicherungsrelevanten Vorgängen | DE | Zweck, Datenschutz und Speicherfristen sind eng begrenzt; keine allgemeine kommerzielle Historienfreigabe verifiziert | `PURPOSE_LIMITED`, `DO_NOT_INTEGRATE` ohne Vertrag/Rechtsgrundlage |
| Unfallgegner-Versicherung | GDV Dienstleistungs-GmbH / Zentralruf der Autoversicherer | Gesetzlich anerkannte Auskunftsstelle nach § 8a PflVG zur Ermittlung des gegnerischen Haftpflichtversicherers nach Verkehrsunfällen | Primär Kennzeichen/Schadentag/Unfallland; kein allgemeiner Historienzugang | Versicherer des Unfallgegners | DE/EWR-Kontext | Zweckgebunden; keine allgemeine Schadenhistoriennutzung | `PURPOSE_LIMITED`, nicht als Schaden-Datenquelle verwenden |
| Rückrufe / Produktsicherheit | EU Safety Gate | Öffentliche Safety-Gate-Warnungen und Folgemaßnahmen | In der öffentlichen Darstellung typischerweise Produkt-/Modell-/Chargenbezug, kein verifizierter allgemeiner VIN-Historienendpoint | Rückrufe / Sicherheitswarnungen | EU/EWR | Öffentliche Informationen; Nutzungsbedingungen je Schnittstelle/Export prüfen | `VERIFIED_PUBLIC` für Recherche, `NO_VERIFIED_VIN_API` für VIN-Historie |
| Rückrufe national | KBA | KBA veröffentlicht Informationen/Services zu Fahrzeugrückrufen; ein allgemein nutzbarer kommerzieller per-VIN-Historien-API-Zugang wurde für diese Phase nicht verifiziert | Nicht verifiziert | Rückrufe | DE | Vor Integration Zugang/Nutzungsbedingungen prüfen | `NO_VERIFIED_VIN_API` |
| Auktionen / Restwertbörsen | Diverse kommerzielle Betreiber | Kein allgemein freier autorisierter VIN-Bulk-/API-Zugang verifiziert | Potenziell | Schadenbilder, Restwerte, Angebotsdaten | DE/EU | Partnervertrag und Weitergaberechte zwingend | `PARTNER_REVIEW` |
| Werkstatt / Service | Werkstattnetze / DMS / Hersteller | Kein allgemeiner öffentlicher EU-Servicehistory-API-Zugang verifiziert | Potenziell | Wartung, Service, Reparaturen | DE/EU | Einwilligung/Vertrag, Zweckbindung und Retention prüfen | `PARTNER_REVIEW` |
| Leasing / Fuhrpark | Leasing-/Flottenanbieter | Kein allgemeiner öffentlicher VIN-Historienzugang verifiziert | Potenziell | Laufleistung, Wartung, Schäden, Haltezeiten | DE/EU | Vertrag + Datenschutzprüfung erforderlich | `PARTNER_REVIEW` |
| OEM / Hersteller | Fahrzeughersteller | Herstellerabhängige Partner-/Service-Schnittstellen; kein einheitlicher öffentlicher EU-VIN-Historienzugang verifiziert | Potenziell | Ausstattung, Service, Rückrufe, Produktionsdaten | DE/EU | OEM-spezifischer Vertrag / Einwilligung / Lizenz | `PARTNER_REVIEW` |
| Import / Export / Zulassungsbewegungen | Nationale Register / Behörden | Kein allgemeiner autorisierter EU-weiten per-VIN-API-Zugang für kommerzielle Historien verifiziert | Nicht verifiziert | Zulassung, Import/Export | EU | Behörden- und länderspezifisch | `NO_VERIFIED_VIN_API` |

## Verifizierte Referenzen

1. Bundesportal – Fahrzeugregister/Halterauskunft: https://verwaltung.bund.de/leistungsverzeichnis/de/leistung/99036043001001/
2. KBA Statistikportal: https://www.kba.de/DE/Statistik/Statistikportal/statistikportal_node.html
3. DEKRA – HU-Prüfbericht anfordern: https://www.dekra.de/de/hu-pruefbericht-anfordern/
4. GDV – Hinweis- und Informationssystem HIS: https://www.gdv.de/gdv/themen/schaden-unfall/das-hinweis-und-informationssystem-his-der-versicherungswirtschaft-22256
5. GDV Dienstleistungs-GmbH – Zentralruf / Services: https://www.gdv-dl.de/services
6. GDV Dienstleistungs-GmbH – Datenschutz Zentralruf: https://www.gdv-dl.de/datenschutzinformationen-zentralruf
7. EU Safety Gate: https://ec.europa.eu/safety-gate/

## Datenschutz / Datenminimierung

- FIN/VIN kann im konkreten Kontext mit Halter-, Versicherungs- oder Vertragsdaten verknüpft und damit personenbezogen werden. Deshalb keine Halternamen, Adressen oder sonstigen Identitätsdaten in die allgemeine Fahrzeughistorie übernehmen, solange dafür keine klare Rechtsgrundlage und Zweckdefinition existiert.
- SourceLicense bleibt das technische Gate für Speicherung, Weitergabe, kommerzielle Nutzung und Retention.
- Lösch-/Korrekturanforderungen müssen auf Quelle, Fahrzeug, Importjob und Mapping-Version zurückverfolgbar bleiben.
- Diese Matrix ist technische Produktdokumentation, keine Rechtsberatung. `PARTNER_REVIEW` und `PURPOSE_LIMITED` erfordern vor Produktivbetrieb eine gesonderte rechtliche/vertragliche Prüfung.

## Ergebnis Phase 4 – zusätzliche Quelle

In dieser Phase wird **bewusst keine weitere Live-EU-Quelle integriert**, weil kein zusätzlicher offizieller per-VIN-Zugang mit gleichzeitig verifizierten Speicher- und kommerziellen Weitergaberechten vorliegt. Die Coverage-/Eligibility-/Onboarding-Architektur wird stattdessen so vorbereitet, dass ein später vertraglich freigegebener Provider ohne paralleles Providersystem ergänzt werden kann.
