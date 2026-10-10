import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  checksumDvsaFixture,
  processPendingImportJobsUnified,
  queueDvsaBulkImportStream,
  retryDvsaImportJob
} from '@/lib/dvsa-bulk-import';
import { MemoryImportStorage, setImportStorageForTests } from '@/lib/import-storage';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const sourceIds: string[] = [];
const vins = new Set<string>();

class StreamOnlyMemoryStorage extends MemoryImportStorage {
  override async readText(_key: string): Promise<string> {
    throw new Error('READ_TEXT_MUST_NOT_BE_USED_FOR_DVSA_BULK');
  }
}

async function createSource() {
  const key = `dvsa-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const source = await db.dataSource.create({ data: { key, name: key, active: true } });
  sourceIds.push(source.id);
  await db.sourceLicense.create({
    data: {
      sourceId: source.id,
      licenseName: 'CI reviewed DVSA fixture license',
      canStore: true,
      canRedistribute: false,
      canCommercialize: false,
      retentionDays: 1,
      markets: ['GB'],
      capabilities: ['VEHICLE_SPECS', 'ODOMETER', 'INSPECTION', 'REGISTRATION'],
      reviewedAt: new Date(),
      reviewedBy: 'CI'
    }
  });
  return source;
}

function chunked(content: string) {
  const bytes = Buffer.from(content, 'utf8');
  return Readable.from([
    bytes.subarray(0, Math.min(37, bytes.length)),
    bytes.subarray(Math.min(37, bytes.length), Math.min(113, bytes.length)),
    bytes.subarray(Math.min(113, bytes.length))
  ]);
}

afterEach(async () => {
  setImportStorageForTests(null);
  for (const sourceId of sourceIds.splice(0)) {
    await db.sourceTombstone.deleteMany({ where: { sourceId } });
    await db.vehicleEvent.deleteMany({ where: { sourceId } });
    await db.vehicleAttribute.deleteMany({ where: { sourceId } });
    await db.importJob.deleteMany({ where: { sourceId } });
    await db.sourceLicense.deleteMany({ where: { sourceId } });
    await db.dataSource.deleteMany({ where: { id: sourceId } });
  }
  if (vins.size > 0) {
    await db.vehicle.deleteMany({ where: { vin: { in: [...vins] } } });
    vins.clear();
  }
});

describeDb('DVSA bulk/delta import worker', () => {
  it('streams object storage through batches and applies CREATED, UPDATED and DELETED with a tombstone', async () => {
    const source = await createSource();
    const storage = new StreamOnlyMemoryStorage();
    setImportStorageForTests(storage);
    const vinUpdated = 'WBA12345678901234';
    const vinDeleted = 'WBA22345678901234';
    vins.add(vinUpdated);
    vins.add(vinDeleted);

    const content = [
      {
        vin: vinUpdated,
        registration: 'TEST001',
        modification: 'CREATED',
        make: 'TEST MAKE ORIGINAL',
        motTests: [{ motTestNumber: '1001', completedDate: '2024-01-01 10:00:00', testResult: 'PASSED', odometerValue: '10000', odometerUnit: 'MI' }]
      },
      {
        vin: vinUpdated,
        registration: 'TEST001',
        modification: 'UPDATED',
        make: 'TEST MAKE UPDATED',
        motTests: [{ motTestNumber: '1002', completedDate: '2025-01-01 10:00:00', testResult: 'PASSED', odometerValue: '12000', odometerUnit: 'MI' }]
      },
      {
        vin: vinDeleted,
        registration: 'TEST002',
        modification: 'CREATED',
        make: 'TEST DELETE',
        motTests: [{ motTestNumber: '2001', completedDate: '2025-02-01 10:00:00', testResult: 'FAILED', odometerValue: '20000', odometerUnit: 'MI' }]
      },
      { vin: vinDeleted, registration: 'TEST002', modification: 'DELETED', motTests: [] }
    ].map((row) => JSON.stringify(row)).join('\n');

    const job = await queueDvsaBulkImportStream(chunked(content), {
      sourceKey: source.key,
      fileName: 'TESTDATA-dvsa-delta.ndjson'
    });
    const results = await processPendingImportJobsUnified(10, 0, 2);
    expect(results.map((item) => item.id)).toContain(job.id);

    const persistedJob = await db.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { object: true } });
    expect(persistedJob).toMatchObject({
      status: 'COMPLETED',
      rowsRead: 4,
      rowsValidated: 4,
      rowsWritten: 4,
      rowsFailed: 0,
      fileName: 'TESTDATA-dvsa-delta.ndjson',
      mappingVersion: 'dvsa-mot-v1',
      checksum: checksumDvsaFixture(content)
    });
    expect(persistedJob.object).toMatchObject({
      provider: 'memory',
      checksum: checksumDvsaFixture(content),
      deletedAt: null
    });

    const updatedVehicle = await db.vehicle.findUniqueOrThrow({ where: { vin: vinUpdated } });
    const updatedEvents = await db.vehicleEvent.findMany({ where: { vehicleId: updatedVehicle.id, sourceId: source.id } });
    const updatedMake = await db.vehicleAttribute.findUnique({
      where: { vehicleId_sourceId_field: { vehicleId: updatedVehicle.id, sourceId: source.id, field: 'make' } }
    });
    expect(updatedEvents.map((event) => event.externalId)).toEqual(['mot:1002']);
    expect(updatedMake).toMatchObject({ value: 'TEST MAKE UPDATED', capability: 'VEHICLE_SPECS' });

    const deletedVehicle = await db.vehicle.findUniqueOrThrow({ where: { vin: vinDeleted } });
    expect(await db.vehicleEvent.count({ where: { vehicleId: deletedVehicle.id, sourceId: source.id } })).toBe(0);
    expect(await db.vehicleAttribute.count({ where: { vehicleId: deletedVehicle.id, sourceId: source.id } })).toBe(0);
    expect(await db.sourceTombstone.findUnique({
      where: { sourceId_subjectKey: { sourceId: source.id, subjectKey: `VIN:${vinDeleted}` } }
    })).toMatchObject({ reason: 'DVSA_DELETED', mappingVersion: 'dvsa-mot-v1' });
  });

  it('keeps the object retryable after a partial failure and reprocessing does not duplicate successful MOT data', async () => {
    const source = await createSource();
    const storage = new StreamOnlyMemoryStorage();
    setImportStorageForTests(storage);
    const vin = 'WBA32345678901234';
    vins.add(vin);

    const content = [
      JSON.stringify({
        vin,
        registration: 'TEST003',
        modification: 'CREATED',
        motTests: [{ motTestNumber: '3001', completedDate: '2025-03-01 10:00:00', testResult: 'PASSED', odometerValue: '30000', odometerUnit: 'MI' }]
      }),
      JSON.stringify({ vin: 'INVALID', registration: 'BROKEN', modification: 'UPDATED', motTests: [] })
    ].join('\n');

    const job = await queueDvsaBulkImportStream(chunked(content), {
      sourceKey: source.key,
      fileName: 'TESTDATA-dvsa-partial.ndjson'
    });
    await processPendingImportJobsUnified(10, 0, 1);

    let state = await db.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { object: true } });
    expect(state).toMatchObject({ status: 'PARTIAL', rowsRead: 2, rowsValidated: 1, rowsWritten: 1, rowsFailed: 1 });
    expect(state.object?.deletedAt).toBeNull();
    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { vin } });
    expect(await db.vehicleEvent.count({ where: { vehicleId: vehicle.id, sourceId: source.id, externalId: 'mot:3001' } })).toBe(1);

    await retryDvsaImportJob(job.id);
    await processPendingImportJobsUnified(10, 0, 1);
    state = await db.importJob.findUniqueOrThrow({ where: { id: job.id }, include: { object: true } });
    expect(state).toMatchObject({ status: 'PARTIAL', rowsRead: 2, rowsValidated: 1, rowsWritten: 1, rowsFailed: 1 });
    expect(await db.vehicleEvent.count({ where: { vehicleId: vehicle.id, sourceId: source.id, externalId: 'mot:3001' } })).toBe(1);
    expect(await db.importAuditLog.count({ where: { importJobId: job.id, action: 'RETRY' } })).toBe(1);
  });
});
