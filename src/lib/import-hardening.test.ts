import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { claimPendingImportJobs, cleanupExpiredRawData, queueImport } from './imports';
import { MemoryImportStorage, setImportStorageForTests } from './import-storage';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const createdSourceIds: string[] = [];

afterEach(async () => {
  setImportStorageForTests(null);
  for (const sourceId of createdSourceIds.splice(0)) {
    await db.importJob.deleteMany({ where: { sourceId } });
    await db.vehicleEvent.deleteMany({ where: { sourceId } });
    await db.sourceLicense.deleteMany({ where: { sourceId } });
    await db.dataSource.deleteMany({ where: { id: sourceId } });
  }
});

async function createSource(prefix: string) {
  const key = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const source = await db.dataSource.create({ data: { key, name: key } });
  createdSourceIds.push(source.id);
  await db.sourceLicense.create({
    data: {
      sourceId: source.id,
      licenseName: 'test',
      canStore: true,
      canRedistribute: true,
      canCommercialize: true,
      retentionDays: 1
    }
  });
  return source;
}

describeDb('import hardening', () => {
  it('atomically claims different pending jobs for concurrent workers', async () => {
    const source = await createSource('claim');
    await db.importJob.createMany({
      data: [
        { sourceId: source.id, status: 'PENDING', format: 'JSON', checksum: `a-${Date.now()}` },
        { sourceId: source.id, status: 'PENDING', format: 'JSON', checksum: `b-${Date.now()}` }
      ]
    });

    const [first, second] = await Promise.all([claimPendingImportJobs(1), claimPendingImportJobs(1)]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).not.toBe(second[0].id);

    const claimed = await db.importJob.findMany({ where: { sourceId: source.id, status: 'RUNNING' } });
    expect(claimed).toHaveLength(2);
  });

  it('stores new import payloads as object references instead of DB text', async () => {
    const source = await createSource('storage');
    const storage = new MemoryImportStorage();
    setImportStorageForTests(storage);

    const job = await queueImport(
      source.key,
      JSON.stringify([{ vin: 'WBA12345678901234', eventType: 'SERVICE', title: 'Test' }]),
      'JSON'
    );
    const persisted = await db.importJob.findUnique({ where: { id: job.id }, include: { object: true, payload: true } });
    expect(persisted?.object?.provider).toBe('memory');
    expect(persisted?.object?.storageKey).toBeTruthy();
    expect(persisted?.payload).toBeNull();
  });

  it('clears the retention timestamp after raw payload cleanup', async () => {
    const source = await createSource('retention');
    const vehicle = await db.vehicle.create({ data: { vin: `WBA${Math.random().toString().slice(2, 16).padEnd(14, '1').slice(0, 14)}` } });
    const event = await db.vehicleEvent.create({
      data: {
        vehicleId: vehicle.id,
        sourceId: source.id,
        externalId: `retention-${Date.now()}`,
        eventType: 'OTHER',
        title: 'Retention test',
        rawPayload: { secret: 'raw' },
        rawPayloadExpiresAt: new Date(Date.now() - 60_000)
      }
    });

    await cleanupExpiredRawData(new Date());
    const cleaned = await db.vehicleEvent.findUnique({ where: { id: event.id } });
    expect(cleaned?.rawPayload).toBeNull();
    expect(cleaned?.rawPayloadExpiresAt).toBeNull();

    await db.vehicle.delete({ where: { id: vehicle.id } });
  });
});
