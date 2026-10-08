import Link from 'next/link';
import { getVehicleReport } from '@/lib/report';
import { isValidVin, normalizeVin } from '@/lib/vin';
import { DVSA_SOURCE_KEY } from '@/lib/providers/dvsa-provider';

export const dynamic = 'force-dynamic';

type Reading = { eventId: string; date: string; mileageKm: number };
type MotDetails = {
  motTestNumber?: string | null;
  expiryDate?: string | null;
  testResult?: string | null;
  registrationAtTimeOfTest?: string | null;
  odometer?: { originalValue?: string | null; originalUnit?: string | null; resultType?: string | null; mileageKm?: number | null };
  defects?: Array<{ text?: string; type?: string; dangerous?: boolean }>;
};

function MileageChart({ readings }: { readings: Reading[] }) {
  if (readings.length < 2) return <p>Für ein Diagramm sind mindestens zwei datierte Kilometerstände erforderlich.</p>;
  const min = Math.min(...readings.map((item) => item.mileageKm));
  const max = Math.max(...readings.map((item) => item.mileageKm));
  const range = Math.max(1, max - min);
  const points = readings.map((item, index) => {
    const x = readings.length === 1 ? 0 : (index / (readings.length - 1)) * 100;
    const y = 90 - ((item.mileageKm - min) / range) * 75;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="mileageChart" aria-label="Kilometerstandsverlauf">
      <svg viewBox="0 0 100 100" role="img" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chartLegend">
        <span>{readings[0].mileageKm.toLocaleString('de-DE')} km</span>
        <span>{readings.at(-1)?.mileageKm.toLocaleString('de-DE')} km</span>
      </div>
    </div>
  );
}

function formatSpec(value: unknown, suffix = '') {
  if (value == null || value === '') return 'Keine Daten vorhanden';
  return `${String(value)}${suffix}`;
}

function coverageText(state: string, reason: string | null) {
  if (state === 'DATA') return 'Daten vorhanden';
  if (state === 'NO_DATA') return 'Quelle wurde geprüft, lieferte für diese Abfrage aber keine Daten. Das ist keine Aussage über Unfallfreiheit.';
  if (state === 'NOT_APPLICABLE') return `Für Markt/Abdeckung nicht anwendbar${reason ? ` (${reason})` : ''}.`;
  if (state === 'NOT_CONFIGURED') return `Quelle ist für diese Nutzung noch nicht vollständig freigeschaltet${reason ? ` (${reason})` : ''}.`;
  if (state === 'ERROR') return `Providerfehler bei dieser Abfrage${reason ? ` (${reason})` : ''}. Das Ergebnis darf nicht als NO_DATA behandelt werden.`;
  return `Quelle wurde nicht live aufgerufen${reason ? ` (${reason})` : ''}.`;
}

export default async function ReportPage({ params }: { params: Promise<{ vin: string }> }) {
  const { vin: rawVin } = await params;
  const vin = normalizeVin(rawVin);
  if (!isValidVin(vin)) {
    return (
      <main className="shell"><section className="resultCard"><h1>FIN ungültig</h1><p>Die FIN muss 17 gültige Zeichen enthalten.</p><Link href="/">Zur Suche</Link></section></main>
    );
  }

  const report = await getVehicleReport(vin, { hydrateNhtsa: true, hydrateDvsa: true });
  const vehicle = report.vehicle as Record<string, unknown>;
  const provenance = (vehicle.provenance ?? {}) as Record<string, { source?: { name?: string }; conflict?: boolean; mappingVersion?: string | null }>;
  const specs: Array<[string, string, string]> = [
    ['make', 'Hersteller / Marke', ''], ['model', 'Modell', ''], ['modelYear', 'Modelljahr', ''],
    ['bodyClass', 'Karosserie / Fahrzeugtyp', ''], ['fuelType', 'Kraftstoff', ''],
    ['engineDisplacement', 'Hubraum', ' l'], ['enginePowerKw', 'Leistung', ' kW'],
    ['transmission', 'Getriebe', ''], ['manufacturer', 'Hersteller', ''],
    ['plantCountry', 'Produktionsland', ''], ['vehicleType', 'Fahrzeugklasse', ''], ['market', 'Markt', '']
  ];
  const dvsaInspections = report.inspectionEvents.filter((event) => event.source.key === DVSA_SOURCE_KEY);

  return (
    <main className="shell reportShell">
      <section className="hero reportHero">
        <div>
          <span className="eyebrow">SCHADENDIREKT · FAHRZEUGBERICHT</span>
          <h1>{String(vehicle.make ?? '')} {String(vehicle.model ?? '')}</h1>
          <p className="vinLine">FIN {vin}</p>
        </div>
        <div className={`statusBadge status-${report.mileageAnalysis.status.toLowerCase()}`}>
          Kilometeranalyse: {report.mileageAnalysis.status}
        </div>
      </section>

      <section className="noticeBox"><strong>Hinweis zur Datenlage</strong><p>{report.disclaimer}</p></section>

      <section className="resultCard">
        <h2>Datenabdeckung dieser Abfrage</h2>
        <p>Die Einträge beschreiben, was technisch geprüft wurde. Es wird keine Prozent-Coverage geschätzt.</p>
        <div className="timeline">
          {report.coverage.map((item) => (
            <article key={item.providerKey}>
              <strong>{item.providerName}</strong>
              <span>{item.state} · {item.providerKey}</span>
              <p>{coverageText(item.state, item.reason)}</p>
              <small>Capabilities: {item.capabilities.join(', ')} · Mapping: {item.mappingVersion ?? 'nicht versioniert'}{item.market ? ` · Markt: ${item.market}` : ''}</small>
            </article>
          ))}
        </div>
      </section>

      {report.attributeConflicts.length > 0 && (
        <section className="noticeBox">
          <strong>Widersprüchliche Quelldaten</strong>
          <p>Mehrere freigegebene Quellen liefern unterschiedliche Werte. Schadendirekt behält alle Kandidaten und wählt für die Anzeige deterministisch; ein neuerer Wert gilt nicht automatisch als wahr.</p>
          {report.attributeConflicts.map((conflict) => (
            <p key={conflict.field}><strong>{conflict.field}:</strong> {conflict.candidates.map((candidate) => `${candidate.source.name} = ${candidate.value}`).join(' · ')}</p>
          ))}
        </section>
      )}

      <section className="reportGrid">
        <article className="resultCard reportPanel">
          <h2>Fahrzeugdaten</h2>
          <div className="specGrid">
            {specs.map(([field, label, suffix]) => (
              <div className="specItem" key={field}>
                <span>{label}</span>
                <strong>{formatSpec(vehicle[field], vehicle[field] == null ? '' : suffix)}</strong>
                {provenance[field]?.source?.name && <small>Quelle: {provenance[field].source?.name}{provenance[field].conflict ? ' · KONFLIKT' : ''}{provenance[field].mappingVersion ? ` · ${provenance[field].mappingVersion}` : ''}</small>}
              </div>
            ))}
          </div>
        </article>

        <article className="resultCard reportPanel">
          <h2>Kilometerstandsverlauf</h2>
          <MileageChart readings={report.mileageAnalysis.readings} />
          {report.mileageAnalysis.findings.length > 0 && (
            <div className="findingList">
              {report.mileageAnalysis.findings.map((finding, index) => (
                <div key={`${finding.code}-${index}`} className={`finding finding-${finding.severity.toLowerCase()}`}>
                  <strong>{finding.code}</strong><p>{finding.message}</p><small>Referenzierte Ereignisse: {finding.eventIds.join(', ')}</small>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="resultCard">
        <h2>UK MOT-Prüfungshistorie</h2>
        <p>DVSA-MOT-Daten sind technische Prüfungs- und Kilometerdaten für unterstützte Fahrzeuge aus Großbritannien. Sie sind keine Unfall- oder Versicherungshistorie.</p>
        {dvsaInspections.length === 0 ? <p>Keine veröffentlichbaren DVSA-MOT-Prüfungen vorhanden.</p> : (
          <div className="timeline">
            {dvsaInspections.map((event) => {
              const details = (event.details ?? {}) as MotDetails;
              const defects = details.defects ?? [];
              return (
                <article key={event.id}>
                  <strong>{event.title}</strong>
                  <span>{event.date ? new Date(event.date).toLocaleDateString('de-DE') : 'Datum unbekannt'}{details.expiryDate ? ` · gültig bis ${new Date(details.expiryDate).toLocaleDateString('de-DE')}` : ''}</span>
                  <p>{event.mileageKm != null ? `${event.mileageKm.toLocaleString('de-DE')} km normalisiert` : 'Kein sicher normalisierbarer Kilometerwert'}{details.odometer?.originalValue ? ` · Original: ${details.odometer.originalValue} ${details.odometer.originalUnit ?? ''}` : ''}</p>
                  {defects.length > 0 && <ul>{defects.map((defect, index) => <li key={`${event.id}-defect-${index}`}><strong>{defect.type ?? 'HINWEIS'}{defect.dangerous ? ' · GEFÄHRLICH' : ''}</strong>: {defect.text || 'Keine Beschreibung geliefert'}</li>)}</ul>}
                  <small>MOT-Test: {details.motTestNumber ?? 'nicht geliefert'} · Quelle: {event.source.name} · Qualität: {event.quality} · Mapping: {event.mappingVersion ?? '—'}</small>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="resultCard">
        <h2>Schadenereignisse</h2>
        {report.damageEvents.length === 0 ? <p>Keine veröffentlichbaren Schadenereignisse vorhanden. Das bedeutet nicht, dass das Fahrzeug unfallfrei ist.</p> : (
          <div className="timeline">
            {report.damageEvents.map((event) => (
              <article key={event.id}>
                <strong>{event.title}</strong>
                <span>{event.date ? new Date(event.date).toLocaleDateString('de-DE') : 'Datum unbekannt'}</span>
                <p>{event.description ?? 'Keine weitere Beschreibung vorhanden.'}</p>
                <small>Quelle: {event.source.name} · Qualität: {event.quality}</small>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="resultCard">
        <h2>Chronologische Timeline</h2>
        {report.timeline.length === 0 ? <p>Keine veröffentlichbaren Historienereignisse vorhanden.</p> : (
          <div className="timeline">
            {report.timeline.map((event) => (
              <article key={event.id}>
                <strong>{event.title}</strong>
                <span>{event.date ? new Date(event.date).toLocaleDateString('de-DE') : 'Datum unbekannt'} · {event.type}</span>
                <p>{event.description ?? (event.mileageKm != null ? `${event.mileageKm.toLocaleString('de-DE')} km` : 'Keine Zusatzinformation')}</p>
                <small>Quelle: {event.source.name} · Qualität: {event.quality}{event.conflict ? ' · KONFLIKT' : ''} · Mapping: {event.mappingVersion ?? '—'}</small>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="resultCard">
        <h2>Quellen</h2>
        {report.sources.length === 0 ? <p>Keine veröffentlichbaren Quellen vorhanden.</p> : (
          <ul className="sourceList">{report.sources.map((source) => <li key={source.key}><strong>{source.name}</strong><span>{source.key}</span></li>)}</ul>
        )}
      </section>

      <div className="reportFooterActions"><Link href="/">Andere FIN prüfen</Link><span>Berichtsmodell ist für spätere PDF-Ausgabe vorbereitet.</span></div>
    </main>
  );
}
