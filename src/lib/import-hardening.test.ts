import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { claimPendingImportJobs, cleanupExpiredRawData, processImportJob, queueImport, reprocessImportJob } from './imports';
import { MemoryImportStorage, setImportStorageForTests } from './import-storage';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const createdSourceIds: string[] = [];
const REPROCESS_VIN = 'WBA82345678901234';

afterEach(async () => {
  setImportStorageForTests(null);
  for (const sourceId of createdSourceIds.splice(0)) {
    await db.importJob.deleteMany({ where: { sourceId } });
    await db.vehicleEvent.deleteMany({ where: { sourceId } });
    await db.sourceLicense.deleteMany({ where: { sourceId } });
    await db.dataSource.deleteMany({ where: { id: sourceId } });
  }
  await db.vehicle.deleteMany({ where: { vin: REPROCESS_VIN } });
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
      retentionDays: 1,
      reviewedAt: new Date(),
      reviewedBy: 'CI'
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

  it('stores new import payloads as object references using BIGINT-compatible size values', async () => {
    const source = await createSource('storage');
    const storage = new MemoryImportStorage();
    setImportStorageForTests(storage);

    const job = await queueImport(
      source.key,
      JSON.stringify([{ vin: 'WBA72345678901234', eventType: 'SERVICE', title: 'Test' }]),
      'JSON'
    );
    const persisted = await db.importJob.findUnique({ where: { id: job.id }, include: { object: true, payload: true } });
    expect(persisted?.object?.provider).toBe('memory');
    expect(persisted?.object?.storageKey).toBeTruthy();
    expect(typeof persisted?.object?.sizeBytes).toBe('bigint');
    expect(persisted?.payload).toBeNull();

    await db.importObject.update({ where: { importJobId: job.id }, data: { sizeBytes: 5_000_000_000n } });
    const large = await db.importObject.findUniqueOrThrow({ where: { importJobId: job.id } });
    expect(large.sizeBytes).toBe(5_000_000_000n);
  });

  it('retains successful raw files through retention and reprocesses the same object with a new mapping version', async () => {
    const source = await createSource('reprocess');
    const storage = new MemoryImportStorage();
    setImportStorageForTests(storage);
    const job = await queueImport(
      source.key,
      JSON.stringify([{ vin: REPROCESS_VIN, eventType: 'SERVICE', title: 'Retained import', externalId: `raw-${Date.now()}` }]),
      'JSON',
      undefined,
      'retained.json',
      'mapping-v1'
    );
    const [claimed] = await claimPendingImportJobs(1);
    expect(claimed?.id).toBe(job.id);
    const processed = await processImportJob(job.id);
    expect(processed.status).toBe('COMPLETED');

    const retained = await db.importObject.findUniqueOrThrow({ where: { importJobId: job.id } });
    expect(retained.deletedAt).toBeNull();
    expect(await storage.readText(retained.storageKey)).toContain('Retained import');

    const reprocessed = await reprocessImportJob(job.id, 'mapping-v2');
    expect(reprocessed.status).toBe('PENDING');
    expect(reprocessed.mappingVersion).toBe('mapping-v2');
    expect(reprocessed.object?.storageKey).toBe(retained.storageKey);
    expect(reprocessed.auditLogs[0]).toMatchObject({ action: 'REPROCESS', fromMappingVersion: 'mapping-v1', toMappingVersion: 'mapping-v2' });

    await cleanupExpiredRawData(new Date(Date.now() + 2 * 86_400_000));
    const expired = await db.importObject.findUniqueOrThrow({ where: { importJobId: job.id } });
    expect(expired.deletedAt).not.toBeNull();
    const audit = await db.importAuditLog.findMany({ where: { importJobId: job.id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining(['REPROCESS', 'DELETE_RETENTION']));
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
