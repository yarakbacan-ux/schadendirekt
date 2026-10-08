import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { DataQuality, Prisma, VehicleEventType } from '@prisma/client';
import { db } from '@/lib/db';
import { getSession, roleAllowed } from '@/lib/auth';
import { analyzeMileage } from '@/lib/mileage-analysis';
import { VEHICLE_EVENT_TYPES } from '@/lib/event-types';
import { listProviders } from '@/lib/providers/registry';
import { findLicenseForAction } from '@/lib/license-policy';
import { DVSA_SOURCE_KEY } from '@/lib/providers/dvsa-provider';

export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default async function AdminPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const headerStore = await headers();
  const session = await getSession(headerStore.get('cookie'));
  if (!session || !roleAllowed(session.user.role, ['ADMIN', 'ANALYST', 'VIEWER'])) redirect('/admin/login');

  const params = await searchParams;
  const vin = first(params.vin).trim().toUpperCase();
  const sourceKey = first(params.source).trim();
  const eventType = first(params.eventType).trim();
  const quality = first(params.quality).trim();

  const eventWhere: Prisma.VehicleEventWhereInput = {};
  if (vin) eventWhere.vehicle = { vin: { contains: vin } };
  if (sourceKey) eventWhere.source = { key: sourceKey };
  if (VEHICLE_EVENT_TYPES.includes(eventType as (typeof VEHICLE_EVENT_TYPES)[number])) eventWhere.eventType = eventType as VehicleEventType;
  if (Object.values(DataQuality).includes(quality as DataQuality)) eventWhere.quality = quality as DataQuality;

  const [vehicleCount, eventCount, sources, imports, events, vehicles, dvsaImports] = await Promise.all([
    db.vehicle.count(),
    db.vehicleEvent.count(),
    db.dataSource.findMany({
      include: {
        licenses: true,
        providerRuns: { orderBy: { finishedAt: 'desc' }, take: 1 }
      },
      orderBy: { name: 'asc' }
    }),
    db.importJob.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { source: true } }),
    db.vehicleEvent.findMany({
      where: eventWhere,
      orderBy: [{ eventDate: 'desc' }, { importedAt: 'desc' }],
      take: 50,
      include: { vehicle: true, source: true }
    }),
    db.vehicle.findMany({
      where: vin ? { vin: { contains: vin } } : undefined,
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: {
        attributes: { include: { source: true }, orderBy: { fetchedAt: 'desc' } },
        events: { select: { id: true, eventDate: true, mileageKm: true } }
      }
    }),
    db.importJob.findMany({
      where: { source: { key: DVSA_SOURCE_KEY } },
      orderBy: { createdAt: 'desc' },
      take: 20
    })
  ]);

  const vehicleRows = vehicles.map((vehicle) => ({ vehicle, mileage: analyzeMileage(vehicle.events) }));
  const registeredProviders = listProviders();
  const providerByKey = new Map(registeredProviders.map((provider) => [provider.key, provider]));
  const now = new Date();
  const lastDvsaBulk = dvsaImports.find((job) => /bulk/i.test(job.fileName ?? ''));
  const lastDvsaDelta = dvsaImports.find((job) => /delta/i.test(job.fileName ?? ''));

  return (
    <main className="shell adminShell">
      <section className="hero">
        <span className="eyebrow">ADMIN · ROLE: {session.user.role}</span>
        <h1>Fahrzeuge, Quellen und Datenqualität</h1>
        <p>Kontrollzentrum für Stammdaten, Ereignisse, Importe, Providerstatus, Lizenzstatus und Kilometerwarnungen.</p>
      </section>

      <section className="adminStats">
        <div><strong>{vehicleCount}</strong><span>Fahrzeuge</span></div>
        <div><strong>{eventCount}</strong><span>Ereignisse</span></div>
        <div><strong>{registeredProviders.length}</strong><span>Provider</span></div>
        <div><strong>{imports.filter((job) => job.status === 'FAILED' || job.status === 'PARTIAL').length}</strong><span>Importe mit Hinweis</span></div>
      </section>

      <section className="resultCard">
        <h2>Filter</h2>
        <form className="adminFilters" method="get">
          <input name="vin" defaultValue={vin} placeholder="FIN" />
          <select name="source" defaultValue={sourceKey}>
            <option value="">Alle Quellen</option>
            {sources.map((source) => <option key={source.id} value={source.key}>{source.name}</option>)}
          </select>
          <select name="eventType" defaultValue={eventType}>
            <option value="">Alle Ereignistypen</option>
            {VEHICLE_EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select name="quality" defaultValue={quality}>
            <option value="">Alle Qualitätsstufen</option>
            {Object.values(DataQuality).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button>Filtern</button>
        </form>
      </section>

      <section className="resultCard">
        <h2>Provider & Health</h2>
        <div className="timeline">
          {registeredProviders.map((provider) => {
            const source = sources.find((item) => item.key === provider.key);
            const lastRun = source?.providerRuns[0];
            const storeAllowed = Boolean(source && findLicenseForAction(source.licenses, 'STORE', now));
            const commercialAllowed = Boolean(source && findLicenseForAction(source.licenses, 'COMMERCIALIZE', now));
            const configuration = provider.configurationStatus?.() ?? { configured: true, missing: [] };
            return (
              <article key={provider.key}>
                <strong>{provider.name}</strong>
                <span>{provider.key} · {source?.active === false ? 'INAKTIV' : 'REGISTRIERT'}</span>
                <p>Capabilities: {provider.capabilities.join(', ')}</p>
                <p>Credentials: {configuration.configured ? 'CONFIGURED ✓' : `MISSING (${configuration.missing.join(', ')})`}</p>
                <p>Lizenz: Store {storeAllowed ? '✓' : '✗'} · Commercial {commercialAllowed ? '✓' : '✗'}</p>
                <p>{lastRun
                  ? `Letzter Lauf: ${lastRun.status} · ${lastRun.cached ? 'Cache' : 'Live'} · ${lastRun.durationMs} ms · ${lastRun.finishedAt.toLocaleString('de-DE')}${lastRun.errorCode ? ` · ${lastRun.errorCode}` : ''}`
                  : 'Noch kein Provider-Lauf protokolliert.'}</p>
                {provider.key === DVSA_SOURCE_KEY && (
                  <p>Bulk: {lastDvsaBulk ? `${lastDvsaBulk.status} · ${lastDvsaBulk.fileName ?? 'Datei'} · ${lastDvsaBulk.createdAt.toLocaleString('de-DE')}` : 'noch nicht verarbeitet'} · Delta: {lastDvsaDelta ? `${lastDvsaDelta.status} · ${lastDvsaDelta.fileName ?? 'Datei'} · ${lastDvsaDelta.createdAt.toLocaleString('de-DE')}` : 'noch nicht verarbeitet'}</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="resultCard">
        <h2>Fahrzeuge & Grunddaten</h2>
        {vehicleRows.length === 0 ? <p>Keine Fahrzeuge für den Filter gefunden.</p> : (
          <div className="adminTableWrap"><table className="adminTable"><thead><tr><th>FIN</th><th>Fahrzeug</th><th>Stammdatenquellen</th><th>Kilometeranalyse</th><th></th></tr></thead><tbody>
            {vehicleRows.map(({ vehicle, mileage }) => (
              <tr key={vehicle.id}>
                <td><code>{vehicle.vin}</code></td>
                <td>{[vehicle.make, vehicle.model, vehicle.modelYear].filter(Boolean).join(' ') || 'Keine Stammdaten'}</td>
                <td>{[...new Set(vehicle.attributes.map((attribute) => attribute.source.name))].join(', ') || '—'}</td>
                <td><span className={`statusBadge status-${mileage.status.toLowerCase()}`}>{mileage.status}</span></td>
                <td><Link href={`/report/${vehicle.vin}`}>Bericht</Link></td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>

      <section className="resultCard">
        <h2>Fahrzeugereignisse</h2>
        {events.length === 0 ? <p>Keine Ereignisse gefunden.</p> : (
          <div className="adminTableWrap"><table className="adminTable"><thead><tr><th>FIN</th><th>Typ</th><th>Originaltyp</th><th>Datum</th><th>km</th><th>Quelle</th><th>Qualität</th></tr></thead><tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td><code>{event.vehicle.vin}</code></td>
                <td>{event.eventType}</td>
                <td>{event.sourceEventType ?? '—'}</td>
                <td>{event.eventDate ? event.eventDate.toLocaleDateString('de-DE') : '—'}</td>
                <td>{event.mileageKm?.toLocaleString('de-DE') ?? '—'}</td>
                <td>{event.source.name}</td>
                <td>{event.quality}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>

      <section className="reportGrid">
        <article className="resultCard reportPanel">
          <h2>Letzte Importjobs</h2>
          {imports.length === 0 ? <p>Noch keine Importe.</p> : <div className="timeline">{imports.map((job) => (
            <article key={job.id}><strong>{job.source.name}</strong><span>{job.status} · {job.format}</span><p>{job.rowsRead} gelesen · {job.rowsValidated} validiert · {job.rowsWritten} geschrieben · {job.rowsFailed} fehlgeschlagen</p></article>
          ))}</div>}
        </article>
        <article className="resultCard reportPanel">
          <h2>Datenquellen & Lizenzstatus</h2>
          <div className="timeline">{sources.map((source) => {
            const provider = providerByKey.get(source.key);
            return (
              <article key={source.id}>
                <strong>{source.name}</strong><span>{source.key} · {source.active ? 'AKTIV' : 'INAKTIV'}{provider ? ' · PROVIDER' : ''}</span>
                <p>{source.licenses.length === 0 ? 'Keine Lizenz dokumentiert.' : source.licenses.map((license) => `${license.licenseName}: Store ${license.canStore ? '✓' : '✗'}, Redistribute ${license.canRedistribute ? '✓' : '✗'}, Commercial ${license.canCommercialize ? '✓' : '✗'}`).join(' · ')}</p>
              </article>
            );
          })}</div>
        </article>
      </section>
    </main>
  );
}
