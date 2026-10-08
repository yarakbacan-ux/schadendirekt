import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { parseCsv } from '@/lib/csv';
import { eventFingerprint } from '@/lib/fingerprint';
import { findLicenseForAction, retentionExpiry } from '@/lib/license-policy';
import { validateImportRecord, type ImportRecord } from '@/lib/import-validation';

export type ImportFormat = 'JSON' | 'CSV';

export function checksumPayload(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function parsePayload(raw: string, format: ImportFormat): unknown[] {
  if (format === 'CSV') return parseCsv(raw);
  const parsed = JSON.parse(raw);
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records)) throw new Error('INVALID_IMPORT_PAYLOAD');
  return records;
}

export async function queueImport(
  sourceKey: string,
  raw: string,
  format: ImportFormat,
  checksum = checksumPayload(raw),
  fileName?: string
) {
  const source = await db.dataSource.findUnique({
    where: { key: sourceKey },
    include: { licenses: true }
  });
  if (!source || !source.active) throw new Error('SOURCE_NOT_FOUND_OR_INACTIVE');

  const license = findLicenseForAction(source.licenses, 'STORE');
  if (!license) throw new Error('SOURCE_STORAGE_NOT_LICENSED');
  if (license.retentionDays === 0) throw new Error('SOURCE_RETENTION_TOO_SHORT_FOR_ASYNC_IMPORT');

  const duplicate = await db.importJob.findFirst({
    where: { sourceId: source.id, checksum, status: { in: ['PENDING', 'RUNNING', 'PARTIAL', 'COMPLETED'] } },
    orderBy: { createdAt: 'desc' }
  });
  if (duplicate) return duplicate;

  const expiresAt = retentionExpiry(license);
  return db.$transaction(async (tx) => {
    const job = await tx.importJob.create({
      data: { sourceId: source.id, status: 'PENDING', format, checksum, fileName }
    });
    await tx.importPayload.create({
      data: { importJobId: job.id, content: raw, expiresAt }
    });
    return job;
  });
}

async function processRecordBatch(
  sourceKey: string,
  sourceId: string,
  records: ImportRecord[],
  rawExpiresAt: Date | null
): Promise<number> {
  const vins = [...new Set(records.map((record) => record.vin))];
  await db.vehicle.createMany({ data: vins.map((vin) => ({ vin })), skipDuplicates: true });
  const vehicles = await db.vehicle.findMany({ where: { vin: { in: vins } }, select: { id: true, vin: true } });
  const byVin = new Map(vehicles.map((vehicle) => [vehicle.vin, vehicle.id]));

  await db.$transaction(
    records.map((record) => {
      const vehicleId = byVin.get(record.vin);
      if (!vehicleId) throw new Error('VEHICLE_UPSERT_FAILED');
      const externalId = record.externalId ?? eventFingerprint(sourceKey, record);
      return db.vehicleEvent.upsert({
        where: { sourceId_externalId: { sourceId, externalId } },
        update: {
          vehicleId,
          eventType: record.eventType,
          eventDate: record.eventDate ? new Date(record.eventDate) : null,
          country: record.country,
          mileageKm: record.mileageKm,
          title: record.title,
          description: record.description,
          rawPayload: record,
          rawPayloadExpiresAt: rawExpiresAt,
          quality: 'UNVERIFIED'
        },
        create: {
          vehicleId,
          sourceId,
          externalId,
          eventType: record.eventType,
          eventDate: record.eventDate ? new Date(record.eventDate) : null,
          country: record.country,
          mileageKm: record.mileageKm,
          title: record.title,
          description: record.description,
          rawPayload: record,
          rawPayloadExpiresAt: rawExpiresAt,
          quality: 'UNVERIFIED'
        }
      });
    })
  );
  return records.length;
}

export async function processImportJob(jobId: string, batchSize = 250) {
  const job = await db.importJob.findUnique({
    where: { id: jobId },
    include: { payload: true, source: { include: { licenses: true } } }
  });
  if (!job || !job.payload) throw new Error('IMPORT_JOB_OR_PAYLOAD_NOT_FOUND');

  const license = findLicenseForAction(job.source.licenses, 'STORE');
  if (!license) {
    return db.importJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', finishedAt: new Date(), errorLog: [{ message: 'SOURCE_STORAGE_NOT_LICENSED' }] }
    });
  }

  await db.importJob.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date() } });

  try {
    const inputs = parsePayload(job.payload.content, job.format as ImportFormat);
    const valid: ImportRecord[] = [];
    const errors: Array<{ index: number; message: string }> = [];

    inputs.forEach((input, index) => {
      try {
        valid.push(validateImportRecord(input));
      } catch (error) {
        errors.push({ index, message: error instanceof Error ? error.message : 'VALIDATION_FAILED' });
      }
    });

    let written = 0;
    const rawExpiresAt = retentionExpiry(license, job.createdAt);
    for (const batch of chunkArray(valid, batchSize)) {
      try {
        written += await processRecordBatch(job.source.key, job.sourceId, batch, rawExpiresAt);
      } catch (error) {
        for (const record of batch) {
          errors.push({ index: inputs.indexOf(record), message: error instanceof Error ? error.message : 'BATCH_FAILED' });
        }
      }
    }

    const failed = errors.length;
    const status = failed === 0 ? 'COMPLETED' : written === 0 ? 'FAILED' : 'PARTIAL';
    return db.importJob.update({
      where: { id: job.id },
      data: {
        status,
        rowsRead: inputs.length,
        rowsWritten: written,
        rowsFailed: failed,
        errorLog: errors,
        finishedAt: new Date()
      }
    });
  } catch (error) {
    return db.importJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        rowsFailed: 1,
        errorLog: [{ message: error instanceof Error ? error.message : 'IMPORT_FAILED' }],
        finishedAt: new Date()
      }
    });
  }
}

export async function processPendingImportJobs(limit = 1, batchSize = 250) {
  const jobs = await db.importJob.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true }
  });
  const results = [];
  for (const job of jobs) results.push(await processImportJob(job.id, batchSize));
  await cleanupExpiredRawData();
  return results;
}

export async function cleanupExpiredRawData(now = new Date()) {
  await db.vehicleEvent.updateMany({
    where: { rawPayloadExpiresAt: { lte: now }, rawPayload: { not: undefined } },
    data: { rawPayload: undefined }
  });
  await db.importPayload.deleteMany({ where: { expiresAt: { lte: now } } });
}
