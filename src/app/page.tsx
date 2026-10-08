'use client';

import { FormEvent, useState } from 'react';

export default function HomePage() {
  const [vin, setVin] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    const response = await fetch(`/api/v1/vehicles/${encodeURIComponent(vin)}`);
    setResult(await response.json());
    setLoading(false);
  }

  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">SCHADENDIREKT</span>
        <h1>Fahrzeughistorie transparent prüfen</h1>
        <p>
          Gib die 17-stellige FIN ein. Wir zeigen nur Daten, deren Herkunft und
          Veröffentlichungsrechte nachvollziehbar sind.
        </p>
        <form onSubmit={submit} className="searchForm">
          <input
            value={vin}
            onChange={(event) => setVin(event.target.value.toUpperCase())}
            maxLength={17}
            placeholder="z. B. WBA00000000000000"
            aria-label="Fahrzeug-Identifizierungsnummer"
          />
          <button disabled={loading}>{loading ? 'Prüfe…' : 'FIN prüfen'}</button>
        </form>
      </section>

      {result && (
        <section className="resultCard">
          {result.error ? (
            <><h2>FIN ungültig</h2><p>{result.message}</p></>
          ) : result.status === 'NO_DATA' ? (
            <>
              <h2>Keine Daten vorhanden</h2>
              <p>
                Für diese FIN liegen derzeit keine veröffentlichbaren Daten vor.
                Das bedeutet ausdrücklich nicht, dass das Fahrzeug unfallfrei ist.
              </p>
            </>
          ) : (
            <>
              <h2>{result.events.length} Historieneinträge</h2>
              <div className="timeline">
                {result.events.map((item: any) => (
                  <article key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.date ? new Date(item.date).toLocaleDateString('de-DE') : 'Datum unbekannt'}</span>
                    <p>{item.description || item.type}</p>
                    <small>Quelle: {item.source.name} · Qualität: {item.quality}</small>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
