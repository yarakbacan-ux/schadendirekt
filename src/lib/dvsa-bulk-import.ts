import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { parseDvsaNdjsonChunks, type DvsaBulkRecord } from '@/lib/dvsa-bulk';
import { mapDvsaVehicle } from '@/lib/dvsa-mapping';
import { recomputeVehicleEventConflicts } from '@/lib/event-conflicts';
import { attributeCapability, filterProviderResultByCapabilities } from '@/lib/providers/capability-filter';
import { groupAttributeConflicts } from '@/lib/providers/conflicts';
import { DVSA_MAPPING_VERSION, DVSA_SOURCE_KEY } from '@/lib/providers/dvsa-provider';
import type { ProviderCapability } from '@/lib/providers/types';
import { findLicenseForAction, retentionExpiry, type LicenseLike } from '@/lib/license-policy';
import { getImportMaxBytes, getImportStorage, type ImportByteStream } from '@/lib/import-storage';
import { cleanupExpiredRawData, processImportJob } from '@/lib/imports';
import { isValidVin, normalizeVin } from '@/lib/vin';

export const DVSA_IMPORT_FORMAT = 'DVSA_NDJSON';
const DVSA_BULK_CAPABILITIES: readonly ProviderCapability[] = ['VEHICLE_SPECS', 'ODOMETER', 'INSPECTION', 'REGISTRATION'];

const CANONICAL_FIELDS = new Set([
  'make', 'model', 'modelYear', 'bodyClass', 'fuelType', 'engineDisplacement',
  'enginePowerKw', 'transmission', 'manufacturer', 'plantCountry', 'vehicleType', 'market'
]);
const NUMERIC_FIELDS = new Set(['modelYear', 'engineDisplacement', 'enginePowerKw']);

type ClaimedJob = { id: string };
type DvsaImportError = { index: number; message: string; rows: number };

function canonicalValue(field: string, value: string): string | number | null {
  if (!NUMERIC_FIELDS.has(field)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (field === 'modelYear' && !Number.isInteger(parsed)) return null;
  return parsed;
}

function dvsaStoreLicenses(licenses: readonly LicenseLike[], at: Date) {
  return DVSA_BULK_CAPABILITIES.map((capability) => ({
    capability,
    license: findLicenseForAction(licenses, 'STORE', at, { market: 'GB', capability })
  }));
}

function mostRestrictiveLicense(rows: Array<{ capability: ProviderCapability; license: LicenseLike | null }>): LicenseLike | null {
  if (rows.some((row) => !row.license)) return null;
  return rows
    .map((row) => row.license as LicenseLike)
    .sort((a, b) => (a.retentionDays ?? Number.MAX_SAFE_INTEGER) - (b.retentionDays ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
}

async function auditImport(importJobId: string, action: string, details?: Prisma.InputJsonValue) {
  await db.importAuditLog.create({ data: { importJobId, action, details } });
}

async function recomputeCanonicalVehicle(vehicleId: string) {
  const attributes = await db.vehicleAttribute.findMany({
    where: { vehicleId, field: { in: [...CANONICAL_FIELDS] } },
    include: { source: { select: { key: true } } }
  });
  const conflicts = groupAttributeConflicts(attributes.map((attribute) => ({
    id: attribute.id,
    sourceKey: attribute.source.key,
    field: attribute.field,
    value: attribute.value,
    quality: attribute.quality,
    fetchedAt: attribute.fetchedAt
  })));

  await db.vehicleAttribute.updateMany({ where: { vehicleId }, data: { conflict: false } });
  const data: Record<string, string | number | null> = {};
  for (const field of CANONICAL_FIELDS) data[field] = null;
  for (const group of conflicts) {
    if (group.conflict) {
      await db.vehicleAttribute.updateMany({
        where: { id: { in: group.candidates.map((candidate) => candidate.id) } },
        data: { conflict: true }
      });
    }
    if (!group.selected || !CANONICAL_FIELDS.has(group.field)) continue;
    const value = canonicalValue(group.field, group.selected.value);
    if (value != null) data[group.field] = value;
  }
  await db.vehicle.update({ where: { id: vehicleId }, data: data as Prisma.VehicleUpdateInput });
}

async function clearSourceSnapshot(vehicleId: string, sourceId: string) {
  await db.$transaction([
    db.vehicleAttribute.deleteMany({ where: { vehicleId, sourceId } }),
    db.vehicleEvent.deleteMany({ where: { vehicleId, sourceId } })
  ]);
  await recomputeCanonicalVehicle(vehicleId);
  await recomputeVehicleEventConflicts(vehicleId);
}

async function replaceSourceSnapshot(
  vehicleId: string,
  sourceId: string,
  record: DvsaBulkRecord,
  storageLicense: LicenseLike,
  storeCapabilities: readonly ProviderCapability[],
  mappingVersion: string,
  importedAt: Date
) {
  const mapped = filterProviderResultByCapabilities(mapDvsaVehicle(record.vehicle, importedAt), storeCapabilities);
  const rawExpiresAt = retentionExpiry(storageLicense, importedAt);

  await clearSourceSnapshot(vehicleId, sourceId);

  const attributeWrites = mapped.attributes.flatMap((attribute) => {
    const capability = attributeCapability(attribute);
    if (!capability) return [];
    return [db.vehicleAttribute.upsert({
      where: { vehicleId_sourceId_field: { vehicleId, sourceId, field: attribute.field } },
      update: {
        value: attribute.value,
        sourceField: attribute.sourceField,
        rawValue: attribute.rawValue ?? attribute.value,
        capability,
        quality: attribute.quality,
        mappingVersion,
        fetchedAt: attribute.fetchedAt
      },
      create: {
        vehicleId,
        sourceId,
        field: attribute.field,
        value: attribute.value,
        sourceField: attribute.sourceField,
        rawValue: attribute.rawValue ?? attribute.value,
        capability,
        quality: attribute.quality,
        mappingVersion,
        fetchedAt: attribute.fetchedAt
      }
    })];
  });
  const eventWrites = mapped.events.map((event) => db.vehicleEvent.upsert({
    where: { sourceId_externalId: { sourceId, externalId: event.externalId } },
    update: {
      vehicleId,
      eventType: event.eventType,
      sourceEventType: event.sourceEventType ?? null,
      eventDate: event.eventDate ?? null,
      country: event.country ?? null,
      mileageKm: event.mileageKm ?? null,
      title: event.title,
      description: event.description ?? null,
      quality: event.quality,
      mappingVersion,
      rawPayload: event.rawPayload ? event.rawPayload as Prisma.InputJsonValue : Prisma.DbNull,
      rawPayloadExpiresAt: event.rawPayload ? rawExpiresAt : null
    },
    create: {
      vehicleId,
      sourceId,
      externalId: event.externalId,
      eventType: event.eventType,
      sourceEventType: event.sourceEventType ?? null,
      eventDate: event.eventDate ?? null,
      country: event.country ?? null,
      mileageKm: event.mileageKm ?? null,
      title: event.title,
      description: event.description ?? null,
      quality: event.quality,
      mappingVersion,
      rawPayload: event.rawPayload ? event.rawPayload as Prisma.InputJsonValue : undefined,
      rawPayloadExpiresAt: event.rawPayload ? rawExpiresAt : null
    }
  }));

  if (attributeWrites.length || eventWrites.length) await db.$transaction([...attributeWrites, ...eventWrites]);
  await recomputeCanonicalVehicle(vehicleId);
  await recomputeVehicleEventConflicts(vehicleId);
}

function objectKey(sourceKey: string, jobId: string): string {
  return `${sourceKey.replace(/[^a-zA-Z0-9._-]/g, '_')}/${jobId}.dvsa.ndjson`;
}

export async function queueDvsaBulkImportStream(
  stream: ImportByteStream,
  options: {
    sourceKey?: string;
    fileName: string;
    mappingVersion?: string;
    expectedChecksum?: string;
  }
) {
  const sourceKey = options.sourceKey ?? DVSA_SOURCE_KEY;
  const mappingVersion = options.mappingVersion?.trim() || DVSA_MAPPING_VERSION;
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(mappingVersion)) throw new Error('INVALID_MAPPING_VERSION');

  const source = await db.dataSource.findUnique({ where: { key: sourceKey }, include: { licenses: true } });
  if (!source || !source.active) throw new Error('SOURCE_NOT_FOUND_OR_INACTIVE');
  const licenseRows = dvsaStoreLicenses(source.licenses, new Date());
  const archiveLicense = mostRestrictiveLicense(licenseRows);
  // A raw DVSA archive contains fields from every supported bulk capability. It is therefore
  // retained only when STORE rights cover the complete raw archive, not merely one event type.
  if (!archiveLicense) throw new Error('SOURCE_STORAGE_NOT_LICENSED_FOR_DVSA_ARCHIVE');
  if (archiveLicense.retentionDays === 0) throw new Error('SOURCE_RETENTION_TOO_SHORT_FOR_ASYNC_IMPORT');

  const job = await db.importJob.create({
    data: {
      sourceId: source.id,
      status: 'PENDING',
      format: DVSA_IMPORT_FORMAT,
      checksum: null,
      fileName: options.fileName,
      mappingVersion
    }
  });
  const storage = getImportStorage();
  const key = objectKey(source.key, job.id);

  try {
    const stored = await storage.putStream(key, stream, { maxBytes: getImportMaxBytes() });
    if (options.expectedChecksum && options.expectedChecksum !== stored.checksum) throw new Error('CHECKSUM_MISMATCH');

    const duplicate = await db.importJob.findFirst({
      where: {
        id: { not: job.id },
        sourceId: source.id,
        checksum: stored.checksum,
        mappingVersion,
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
          sizeBytes: BigInt(stored.sizeBytes),
          checksum: stored.checksum,
          expiresAt: retentionExpiry(archiveLicense, job.createdAt)
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

function validateRecord(record: DvsaBulkRecord): string {
  if (record.modification === 'UNKNOWN') throw new Error('DVSA_BULK_UNKNOWN_MODIFICATION');
  const vin = normalizeVin(typeof record.vehicle.vin === 'string' ? record.vehicle.vin : '');
  if (!isValidVin(vin)) throw new Error('DVSA_BULK_INVALID_VIN');
  return vin;
}

async function applyRecord(
  record: DvsaBulkRecord,
  sourceId: string,
  license: LicenseLike,
  storeCapabilities: readonly ProviderCapability[],
  mappingVersion: string,
  importedAt: Date
) {
  const vin = validateRecord(record);
  const vehicle = await db.vehicle.upsert({ where: { vin }, update: {}, create: { vin, origin: 'SYSTEM' } });
  const subjectKey = `VIN:${vin}`;

  if (record.modification === 'DELETED') {
    await clearSourceSnapshot(vehicle.id, sourceId);
    await db.sourceTombstone.upsert({
      where: { sourceId_subjectKey: { sourceId, subjectKey } },
      update: {
        reason: 'DVSA_DELETED',
        mappingVersion,
        deletedAt: importedAt,
        metadata: { lineNumber: record.lineNumber, modification: 'DELETED' }
      },
      create: {
        sourceId,
        subjectKey,
        reason: 'DVSA_DELETED',
        mappingVersion,
        deletedAt: importedAt,
        metadata: { lineNumber: record.lineNumber, modification: 'DELETED' }
      }
    });
    return;
  }

  await replaceSourceSnapshot(vehicle.id, sourceId, record, license, storeCapabilities, mappingVersion, importedAt);
  await db.sourceTombstone.deleteMany({ where: { sourceId, subjectKey } });
}

async function claimPendingDvsaJobs(limit: number): Promise<ClaimedJob[]> {
  return db.$queryRaw<ClaimedJob[]>(Prisma.sql`
    WITH candidates AS (
      SELECT "id" FROM "ImportJob"
      WHERE "status" = 'PENDING'::"ImportStatus" AND "format" = ${DVSA_IMPORT_FORMAT}
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

async function claimPendingGenericJobs(limit: number): Promise<ClaimedJob[]> {
  return db.$queryRaw<ClaimedJob[]>(Prisma.sql`
    WITH candidates AS (
      SELECT "id" FROM "ImportJob"
      WHERE "status" = 'PENDING'::"ImportStatus" AND "format" <> ${DVSA_IMPORT_FORMAT}
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

async function deleteDvsaObjectForPolicy(job: { id: string; object: { provider: string; storageKey: string; deletedAt: Date | null } }) {
  if (job.object.deletedAt) return;
  const storage = getImportStorage();
  if (job.object.provider !== storage.provider) throw new Error('IMPORT_STORAGE_PROVIDER_UNAVAILABLE');
  await storage.delete(job.object.storageKey);
  await db.importObject.update({ where: { importJobId: job.id }, data: { deletedAt: new Date() } });
  await auditImport(job.id, 'DELETE_POLICY', { reason: 'DVSA_ARCHIVE_RIGHTS_NOT_AVAILABLE' });
}

export async function processDvsaImportJob(jobId: string, batchSize = 250) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) throw new Error('INVALID_BATCH_SIZE');
  const job = await db.importJob.findUnique({
    where: { id: jobId },
    include: { object: true, source: { include: { licenses: true } } }
  });
  if (!job?.object) throw new Error('DVSA_IMPORT_OBJECT_NOT_FOUND');
  if (job.object.deletedAt) throw new Error('DVSA_IMPORT_OBJECT_NOT_AVAILABLE');
  if (job.format !== DVSA_IMPORT_FORMAT) throw new Error('NOT_DVSA_IMPORT_JOB');
  if (job.status !== 'RUNNING') throw new Error('IMPORT_JOB_NOT_CLAIMED');

  const licenseRows = dvsaStoreLicenses(job.source.licenses, new Date());
  const archiveLicense = mostRestrictiveLicense(licenseRows);
  if (!archiveLicense || archiveLicense.retentionDays === 0) {
    const result = await db.importJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', finishedAt: new Date(), rowsFailed: 1, errorLog: [{ index: -1, message: 'SOURCE_STORAGE_NOT_LICENSED_FOR_DVSA_ARCHIVE', rows: 1 }] }
    });
    await deleteDvsaObjectForPolicy(job);
    return result;
  }

  const storeCapabilities = licenseRows.filter((row) => Boolean(row.license)).map((row) => row.capability);
  const storage = getImportStorage();
  if (job.object.provider !== storage.provider) throw new Error('IMPORT_STORAGE_PROVIDER_UNAVAILABLE');

  let rowsRead = 0;
  let rowsValidated = 0;
  let rowsWritten = 0;
  const errors: DvsaImportError[] = [];
  const batch: DvsaBulkRecord[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const current = batch.splice(0, batch.length);
    for (const record of current) {
      try {
        validateRecord(record);
        rowsValidated += 1;
        await applyRecord(record, job.sourceId, archiveLicense, storeCapabilities, job.mappingVersion, job.createdAt);
        rowsWritten += 1;
      } catch (error) {
        errors.push({
          index: record.lineNumber,
          message: error instanceof Error ? error.message : 'DVSA_RECORD_FAILED',
          rows: 1
        });
      }
    }
  };

  try {
    const stream = await storage.openReadStream(job.object.storageKey);
    for await (const record of parseDvsaNdjsonChunks(stream)) {
      rowsRead += 1;
      batch.push(record);
      if (batch.length >= batchSize) await flush();
    }
    await flush();

    const rowsFailed = Math.max(0, rowsRead - rowsWritten);
    const status = rowsFailed === 0 ? 'COMPLETED' : rowsWritten === 0 ? 'FAILED' : 'PARTIAL';
    return db.importJob.update({
      where: { id: job.id },
      data: { rowsRead, rowsValidated, rowsWritten, rowsFailed, errorLog: errors, status, finishedAt: new Date() }
    });
  } catch (error) {
    const rowsFailed = Math.max(rowsRead - rowsWritten, 1);
    errors.push({ index: -1, message: error instanceof Error ? error.message : 'DVSA_IMPORT_FAILED', rows: 1 });
    return db.importJob.update({
      where: { id: job.id },
      data: {
        rowsRead,
        rowsValidated,
        rowsWritten,
        rowsFailed,
        errorLog: errors,
        status: rowsWritten > 0 ? 'PARTIAL' : 'FAILED',
        finishedAt: new Date()
      }
    });
  }
}

export async function retryDvsaImportJob(jobId: string) {
  const job = await db.importJob.findUnique({ where: { id: jobId }, include: { object: true } });
  if (!job?.object || job.object.deletedAt) throw new Error('DVSA_IMPORT_OBJECT_NOT_AVAILABLE');
  if (job.object.expiresAt && job.object.expiresAt <= new Date()) throw new Error('DVSA_IMPORT_OBJECT_EXPIRED');
  if (job.format !== DVSA_IMPORT_FORMAT) throw new Error('NOT_DVSA_IMPORT_JOB');
  if (job.status !== 'PARTIAL' && job.status !== 'FAILED') throw new Error('DVSA_IMPORT_NOT_RETRYABLE');
  const result = await db.importJob.update({
    where: { id: job.id },
    data: {
      status: 'PENDING',
      rowsRead: 0,
      rowsValidated: 0,
      rowsWritten: 0,
      rowsFailed: 0,
      errorLog: Prisma.DbNull,
      startedAt: null,
      finishedAt: null
    }
  });
  await auditImport(job.id, 'RETRY', { retainedRawObject: true });
  return result;
}

export async function processPendingImportJobsUnified(dvsaLimit = 2, genericLimit = 2, batchSize = 250) {
  if (!Number.isInteger(dvsaLimit) || dvsaLimit < 0 || dvsaLimit > 100) throw new Error('INVALID_CLAIM_LIMIT');
  if (!Number.isInteger(genericLimit) || genericLimit < 0 || genericLimit > 100) throw new Error('INVALID_CLAIM_LIMIT');
  const results = [];

  if (dvsaLimit > 0) {
    const jobs = await claimPendingDvsaJobs(dvsaLimit);
    for (const job of jobs) results.push(await processDvsaImportJob(job.id, batchSize));
  }
  if (genericLimit > 0) {
    const jobs = await claimPendingGenericJobs(genericLimit);
    for (const job of jobs) results.push(await processImportJob(job.id, batchSize));
  }

  await cleanupExpiredRawData();
  return results;
}

export function checksumDvsaFixture(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
