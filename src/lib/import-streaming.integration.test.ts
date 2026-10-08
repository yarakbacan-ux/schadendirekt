import { afterEach, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { db } from '@/lib/db';
import { MemoryImportStorage, setImportStorageForTests } from '@/lib/import-storage';
import { processImportJob, queueImportStream } from '@/lib/imports';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const SOURCE_KEY = 'streaming-import-ci';
const VIN_A = 'WBA12345678901241';
const VIN_B = 'WBA12345678901242';

class StreamingOnlyStorage extends MemoryImportStorage {
  override async readText(): Promise<string> {
    throw new Error('READ_TEXT_MUST_NOT_BE_USED');
  }
}

async function cleanup() {
  const source = await db.dataSource.findUnique({ where: { key: SOURCE_KEY } });
  if (source) {
    await db.vehicleEvent.deleteMany({ where: { sourceId: source.id } });
    await db.importJob.deleteMany({ where: { sourceId: source.id } });
    await db.sourceLicense.deleteMany({ where: { sourceId: source.id } });
    await db.dataSource.delete({ where: { id: source.id } });
  }
  await db.vehicle.deleteMany({ where: { vin: { in: [VIN_A, VIN_B] } } });
  setImportStorageForTests(null);
}

async function setupSource() {
  await cleanup();
  const source = await db.dataSource.create({ data: { key: SOURCE_KEY, name: 'Streaming import CI' } });
  await db.sourceLicense.create({
    data: {
      sourceId: source.id,
      licenseName: 'Reviewed streaming fixture rights',
      canStore: true,
      canRedistribute: false,
      canCommercialize: false,
      retentionDays: 7,
      reviewedAt: new Date(),
      reviewedBy: 'CI'
    }
  });
  return source;
}

afterEach(async () => {
  if (process.env.DATABASE_URL) await cleanup();
});

describeDb('streaming import pipeline', () => {
  it('uploads and processes JSON through streams without calling readText()', async () => {
    await setupSource();
    setImportStorageForTests(new StreamingOnlyStorage());
    const body = Readable.from([
      '[{"vin":"', VIN_A, '","eventType":"SERVICE","title":"A"},',
      '{"vin":"', VIN_B, '","eventType":"SERVICE","title":"B"}]'
    ]);
    const job = await queueImportStream(SOURCE_KEY, body, 'JSON', 'large-fixture.json', 'stream-map-v1');
    await db.importJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    const result = await processImportJob(job.id, 1);

    expect(result).toMatchObject({ status: 'COMPLETED', rowsRead: 2, rowsValidated: 2, rowsWritten: 2, rowsFailed: 0 });
    expect(await db.vehicleEvent.count({ where: { source: { key: SOURCE_KEY } } })).toBe(2);
  });

  it('streams CSV in worker-sized batches and keeps accounting correct', async () => {
    await setupSource();
    setImportStorageForTests(new StreamingOnlyStorage());
    const body = Readable.from([
      'vin,eventType,title\r\n',
      `${VIN_A},SERVICE,First\r\n`,
      `${VIN_B},INSPECTION,Second\r\n`
    ]);
    const job = await queueImportStream(SOURCE_KEY, body, 'CSV', 'large-fixture.csv', 'stream-map-v1');
    await db.importJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    const result = await processImportJob(job.id, 1);
    expect(result).toMatchObject({ status: 'COMPLETED', rowsRead: 2, rowsValidated: 2, rowsWritten: 2, rowsFailed: 0 });
  });
});
