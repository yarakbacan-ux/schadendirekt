'use client';

import { FormEvent, useState } from 'react';

type SearchResult = {
  error?: string;
  message?: string;
  vin?: string;
  status?: 'DATA_AVAILABLE' | 'NO_DATA';
  vehicle?: Record<string, unknown>;
  timeline?: Array<{
    id: string;
    title: string;
    date: string | null;
    description: string | null;
    type: string;
    quality: string;
    source: { name: string };
  }>;
  disclaimer?: string;
};

export default function HomePage() {
  const [vin, setVin] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch(`/api/v1/vehicles/${encodeURIComponent(vin)}`);
      setResult(await response.json());
    } finally {
      setLoading(false);
    }
  }

  const timeline = result?.timeline ?? [];
  const vehicle = result?.vehicle ?? {};

  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">SCHADENDIREKT</span>
        <h1>Fahrzeughistorie transparent prüfen</h1>
        <p>
          Gib die 17-stellige FIN ein. Schadendirekt trennt technische Fahrzeugstammdaten,
          Historienereignisse und Datenquellen klar voneinander und zeigt nur Daten mit
          dokumentierter Veröffentlichungsfreigabe.
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
            <><h2>FIN konnte nicht geprüft werden</h2><p>{result.message ?? result.error}</p></>
          ) : result.status === 'NO_DATA' ? (
            <>
              <h2>Keine veröffentlichbaren Daten vorhanden</h2>
              <p>{result.disclaimer ?? 'Das bedeutet ausdrücklich nicht, dass das Fahrzeug unfallfrei ist oder der Kilometerstand korrekt ist.'}</p>
              {result.vin && <a className="reportLink" href={`/report/${result.vin}`}>Leeren Bericht mit Datenhinweisen öffnen</a>}
            </>
          ) : (
            <>
              <span className="eyebrow">ERSTE TREFFER</span>
              <h2>{[vehicle.make, vehicle.model, vehicle.modelYear].filter(Boolean).join(' ') || result.vin}</h2>
              <p>{timeline.length} veröffentlichbare Historienereignisse · technische Stammdaten werden separat ausgewiesen.</p>
              {timeline.length > 0 && <div className="timeline">{timeline.slice(0, 3).map((item) => (
                <article key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.date ? new Date(item.date).toLocaleDateString('de-DE') : 'Datum unbekannt'} · {item.type}</span>
                  <p>{item.description || 'Keine Zusatzbeschreibung vorhanden.'}</p>
                  <small>Quelle: {item.source.name} · Qualität: {item.quality}</small>
                </article>
              ))}</div>}
              {result.vin && <a className="reportLink" href={`/report/${result.vin}`}>Vollständigen Fahrzeugbericht öffnen</a>}
            </>
          )}
        </section>
      )}
    </main>
  );
}
