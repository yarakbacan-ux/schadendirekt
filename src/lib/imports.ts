import { createHash } from 'node:crypto';
import { Readable, type Readable as NodeReadable } from 'node:stream';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { recomputeVehicleEventConflicts } from '@/lib/event-conflicts';
import { eventFingerprint } from '@/lib/fingerprint';
import { findLicenseForAction, retentionExpiry } from '@/lib/license-policy';
import { validateImportRecord, type ImportRecord } from '@/lib/import-validation';
import { normalizeEventType } from '@/lib/event-types';
import { getImportStorage, type ImportByteStream } from '@/lib/import-storage';
import { calculateImportAccounting } from '@/lib/import-accounting';
import { streamImportRecords } from '@/lib/import-stream';

export type ImportFormat = 'JSON' | 'CSV';
export const GENERIC_IMPORT_MAPPING_VERSION = 'generic-import-v1';

type ErrorEntry = { index: number; message: string; rows?: number };
type ClaimedJob = { id: string };

export function checksumPayload(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new Error('INVALID_BATCH_SIZE');
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function normalizedMappingVersion(value: string | undefined): string {
  const version = value?.trim() || GENERIC_IMPORT_MAPPING_VERSION;
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(version)) throw new Error('INVALID_MAPPING_VERSION');
  return version;
}

export function importObjectKey(sourceKey: string, jobId: string, format: ImportFormat): string {
  const safeSource = sourceKey.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safeSource}/${jobId}.${format.toLowerCase()}`;
}

async function importSourceForStorage(sourceKey: string) {
  const source = await db.dataSource.findUnique({ where: { key: sourceKey }, include: { licenses: true } });
  if (!source || !source.active) throw new Error('SOURCE_NOT_FOUND_OR_INACTIVE');
  const license = findLicenseForAction(source.licenses, 'STORE');
  if (!license) throw new Error('SOURCE_STORAGE_NOT_LICENSED');
  if (license.retentionDays === 0) throw new Error('SOURCE_RETENTION_TOO_SHORT_FOR_ASYNC_IMPORT');
  return { source, license };
}

export async function queueImportStream(
  sourceKey: string,
  stream: ImportByteStream,
  format: ImportFormat,
  fileName?: string,
  mappingVersion?: string,
  expectedChecksum?: string
) {
  const version = normalizedMappingVersion(mappingVersion);
  const { source, license } = await importSourceForStorage(sourceKey);
  const expiresAt = retentionExpiry(license);
  const job = await db.importJob.create({
    data: { sourceId: source.id, status: 'PENDING', format, checksum: null, fileName, mappingVersion: version }
  });

  const storage = getImportStorage();
  const key = importObjectKey(source.key, job.id, format);
  try {
    const stored = await storage.putStream(key, stream);
    if (expectedChecksum && expectedChecksum !== stored.checksum) throw new Error('CHECKSUM_MISMATCH');

    const duplicate = await db.importJob.findFirst({
      where: {
        id: { not: job.id },
        sourceId: source.id,
        checksum: stored.checksum,
        mappingVersion: version,
        status: { in: ['PENDING', 'RUNNING', 'PARTIAL', 'COMPLETED'] }
      },
      orderBy: { createdAt: 'desc' }
    });
    if (duplicate) {
      await storage.delete(stored.key).catch(() => undefined);
      await db.importJob.delete({ where: { id: job.id } });
      return duplicate;
    }

    await db.$transaction([
      db.importJob.update({ where: { id: job.id }, data: { checksum: stored.checksum } }),
      db.importObject.create({
        data: {
          importJobId: job.id,
          provider: stored.provider,
          storageKey: stored.key,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksum,
          expiresAt
        }
      })
    ]);
    return db.importJob.findUniqueOrThrow({ where: { id: job.id } });
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    await db.importJob.delete({ where: { id: job.id } }).catch(() => undefined);
    throw error;
  }
}

export async function queueImport(
  sourceKey: string,
  raw: string,
  format: ImportFormat,
  checksum = checksumPayload(raw),
  fileName?: string,
  mappingVersion?: string
) {
  return queueImportStream(sourceKey, Readable.from([raw]), format, fileName, mappingVersion, checksum);
}

async function processRecordBatch(
  sourceKey: string,
  sourceId: string,
  records: ImportRecord[],
  rawExpiresAt: Date | null,
  mappingVersion: string
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
      const eventType = normalizeEventType(record.eventType);
      return db.vehicleEvent.upsert({
        where: { sourceId_externalId: { sourceId, externalId } },
        update: {
          vehicleId,
          eventType,
          sourceEventType: record.eventType,
          eventDate: record.eventDate ? new Date(record.eventDate) : null,
          country: record.country,
          mileageKm: record.mileageKm,
          title: record.title,
          description: record.description,
          rawPayload: record,
          rawPayloadExpiresAt: rawExpiresAt,
          quality: 'UNVERIFIED',
          mappingVersion
        },
        create: {
          vehicleId,
          sourceId,
          externalId,
          eventType,
          sourceEventType: record.eventType,
          eventDate: record.eventDate ? new Date(record.eventDate) : null,
          country: record.country,
          mileageKm: record.mileageKm,
          title: record.title,
          description: record.description,
          rawPayload: record,
          rawPayloadExpiresAt: rawExpiresAt,
          quality: 'UNVERIFIED',
          mappingVersion
        }
      });
    })
  );

  for (const vehicle of vehicles) await recomputeVehicleEventConflicts(vehicle.id);
  return records.length;
}

async function openJobPayload(job: {
  object: { provider: string; storageKey: string } | null;
  payload: { content: string } | null;
}): Promise<NodeReadable> {
  if (job.object) {
    const storage = getImportStorage();
    if (job.object.provider !== storage.provider) throw new Error('IMPORT_STORAGE_PROVIDER_UNAVAILABLE');
    return storage.openReadStream(job.object.storageKey);
  }
  if (job.payload) return Readable.from([job.payload.content]);
  throw new Error('IMPORT_JOB_OR_PAYLOAD_NOT_FOUND');
}

async function disposeJobPayload(job: {
  id: string;
  object: { provider: string; storageKey: string } | null;
  payload: { importJobId: string } | null;
}) {
  if (job.object) {
    const storage = getImportStorage();
    if (job.object.provider === storage.provider) {
      await storage.delete(job.object.storageKey).catch(() => undefined);
      await db.importObject.updateMany({ where: { importJobId: job.id, deletedAt: null }, data: { deletedAt: new Date() } });
    }
  }
  if (job.payload) await db.importPayload.deleteMany({ where: { importJobId: job.id } });
}

export async function claimPendingImportJobs(limit = 1): Promise<ClaimedJob[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_CLAIM_LIMIT');
  return db.$queryRaw<ClaimedJob[]>(Prisma.sql`
    WITH candidates AS (
      SELECT "id" FROM "ImportJob"
      WHERE "status" = 'PENDING'::"ImportStatus"
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "ImportJob" AS job
    SET "status" = 'RUNNING'::"ImportStatus", "startedAt" = COALESCE(job."startedAt", NOW())
    FROM candidates
    WHERE job."id" = candidates."id"
    RETURNING job."id"
  `);
}

export async function processImportJob(jobId: string, batchSize = 250) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) throw new Error('INVALID_BATCH_SIZE');
  const job = await db.importJob.findUnique({
    where: { id: jobId },
    include: { payload: true, object: true, source: { include: { licenses: true } } }
  });
  if (!job || (!job.payload && !job.object)) throw new Error('IMPORT_JOB_OR_PAYLOAD_NOT_FOUND');
  if (job.status !== 'RUNNING') throw new Error('IMPORT_JOB_NOT_CLAIMED');

  const license = findLicenseForAction(job.source.licenses, 'STORE');
  if (!license) {
    const result = await db.importJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', finishedAt: new Date(), rowsFailed: 1, errorLog: [{ message: 'SOURCE_STORAGE_NOT_LICENSED', rows: 1 }] }
    });
    await disposeJobPayload(job);
    return result;
  }

  try {
    const stream = await openJobPayload(job);
    const errors: ErrorEntry[] = [];
    const batch: ImportRecord[] = [];
    let rowsRead = 0;
    let rowsValidated = 0;
    let written = 0;
    let failedBatchRows = 0;
    const rawExpiresAt = retentionExpiry(license, job.createdAt);

    const flush = async () => {
      if (batch.length === 0) return;
      const current = batch.splice(0, batch.length);
      try {
        written += await processRecordBatch(job.source.key, job.sourceId, current, rawExpiresAt, job.mappingVersion);
      } catch (error) {
        failedBatchRows += current.length;
        errors.push({ index: -1, message: error instanceof Error ? error.message : 'BATCH_FAILED', rows: current.length });
      }
    };

    for await (const input of streamImportRecords(stream, job.format as ImportFormat)) {
      const index = rowsRead;
      rowsRead += 1;
      try {
        batch.push(validateImportRecord(input));
        rowsValidated += 1;
      } catch (error) {
        errors.push({ index, message: error instanceof Error ? error.message : 'VALIDATION_FAILED', rows: 1 });
      }
      if (batch.length >= batchSize) await flush();
    }
    await flush();

    const accounting = calculateImportAccounting({ rowsRead, rowsValidated, rowsWritten: written, failedBatchRows });
    const status = accounting.rowsFailed === 0 ? 'COMPLETED' : accounting.rowsWritten === 0 ? 'FAILED' : 'PARTIAL';
    const result = await db.importJob.update({
      where: { id: job.id },
      data: { status, ...accounting, errorLog: errors, finishedAt: new Date() }
    });
    await disposeJobPayload(job);
    return result;
  } catch (error) {
    const result = await db.importJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        rowsFailed: Math.max(job.rowsFailed, 1),
        errorLog: [{ message: error instanceof Error ? error.message : 'IMPORT_FAILED', rows: 1 }],
        finishedAt: new Date()
      }
    });
    await disposeJobPayload(job);
    return result;
  }
}

export async function processPendingImportJobs(limit = 1, batchSize = 250) {
  const jobs = await claimPendingImportJobs(limit);
  const results = [];
  for (const job of jobs) results.push(await processImportJob(job.id, batchSize));
  await cleanupExpiredRawData();
  return results;
}

export async function cleanupExpiredRawData(now = new Date()) {
  await db.vehicleEvent.updateMany({ where: { rawPayloadExpiresAt: { lte: now } }, data: { rawPayload: Prisma.DbNull, rawPayloadExpiresAt: null } });
  await db.importPayload.deleteMany({ where: { expiresAt: { lte: now } } });
  const expiredObjects = await db.importObject.findMany({
    where: { expiresAt: { lte: now }, deletedAt: null },
    select: { id: true, provider: true, storageKey: true }
  });
  const storage = getImportStorage();
  for (const object of expiredObjects) {
    if (object.provider !== storage.provider) continue;
    await storage.delete(object.storageKey).catch(() => undefined);
    await db.importObject.update({ where: { id: object.id }, data: { deletedAt: now } });
  }
}
