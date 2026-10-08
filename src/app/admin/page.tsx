import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const [vehicles, events, sources, imports] = await Promise.all([
    db.vehicle.count(),
    db.vehicleEvent.count(),
    db.dataSource.count(),
    db.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { source: true }
    })
  ]);

  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">ADMIN · ROLE: ADMIN</span>
        <h1>Import- und Datenstatus</h1>
        <p>Geschützter Bereich für Datenquellen, Importe und Qualitätskontrolle.</p>
      </section>

      <section className="resultCard">
        <h2>Übersicht</h2>
        <p>Fahrzeuge: {vehicles} · Historieneinträge: {events} · Datenquellen: {sources}</p>
      </section>

      <section className="resultCard">
        <h2>Letzte Importjobs</h2>
        {imports.length === 0 ? (
          <p>Noch keine Importe.</p>
        ) : (
          <div className="timeline">
            {imports.map((job) => (
              <article key={job.id}>
                <strong>{job.source.name}</strong>
                <span>{job.status} · {job.format}</span>
                <p>{job.rowsWritten} von {job.rowsRead} Datensätzen geschrieben</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
