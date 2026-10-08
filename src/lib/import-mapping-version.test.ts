import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { MemoryImportStorage, setImportStorageForTests } from '@/lib/import-storage';
import { processImportJob, queueImport } from '@/lib/imports';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const SOURCE_KEY = 'generic-map-test';
const VIN = 'WBA12345678901236';

async function cleanup() {
  const source = await db.dataSource.findUnique({ where: { key: SOURCE_KEY } });
  if (source) {
    await db.vehicleEvent.deleteMany({ where: { sourceId: source.id } });
    await db.importJob.deleteMany({ where: { sourceId: source.id } });
    await db.sourceLicense.deleteMany({ where: { sourceId: source.id } });
    await db.dataSource.delete({ where: { id: source.id } });
  }
  await db.vehicle.deleteMany({ where: { vin: VIN } });
  setImportStorageForTests(null);
}

async function setupSource() {
  await cleanup();
  const source = await db.dataSource.create({ data: { key: SOURCE_KEY, name: 'Generic mapping test' } });
  await db.sourceLicense.create({
    data: {
      sourceId: source.id,
      licenseName: 'test',
      canStore: true,
      canRedistribute: true,
      canCommercialize: true,
      reviewedAt: new Date(),
      reviewedBy: 'CI'
    }
  });
  setImportStorageForTests(new MemoryImportStorage());
  return source;
}

afterEach(async () => {
  if (process.env.DATABASE_URL) await cleanup();
});

describeDb('generic import mapping versions', () => {
  it('persists the ImportJob mapping version on every created event', async () => {
    const source = await setupSource();
    const raw = JSON.stringify([{
      vin: VIN,
      externalId: 'generic-event-v2',
      eventType: 'SERVICE',
      eventDate: '2026-01-02T00:00:00.000Z',
      title: 'Testservice'
    }]);
    const job = await queueImport(source.key, raw, 'JSON', undefined, 'fixture.json', 'partner-map-v2');
    await db.importJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    await processImportJob(job.id);

    const persistedJob = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    const event = await db.vehicleEvent.findUniqueOrThrow({
      where: { sourceId_externalId: { sourceId: source.id, externalId: 'generic-event-v2' } }
    });
    expect(persistedJob.mappingVersion).toBe('partner-map-v2');
    expect(event.mappingVersion).toBe('partner-map-v2');
  });

  it('allows the same source payload to be reprocessed under a new mapping version', async () => {
    const source = await setupSource();
    const raw = JSON.stringify([{ vin: VIN, eventType: 'SERVICE', title: 'Versioned fixture' }]);
    const first = await queueImport(source.key, raw, 'JSON', undefined, 'fixture.json', 'partner-map-v1');
    const second = await queueImport(source.key, raw, 'JSON', undefined, 'fixture.json', 'partner-map-v2');
    expect(second.id).not.toBe(first.id);
    expect(first.mappingVersion).toBe('partner-map-v1');
    expect(second.mappingVersion).toBe('partner-map-v2');
  });
});
