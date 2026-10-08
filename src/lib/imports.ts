import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { isValidVin, normalizeVin } from '@/lib/vin';

export type ImportRecord = {
  vin: string;
  externalId?: string;
  eventType: string;
  eventDate?: string;
  country?: string;
  mileageKm?: number;
  title: string;
  description?: string;
};

export function parseCsv(input: string): ImportRecord[] {
  const lines = input.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((value) => value.trim());
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = line.split(',').map((value) => value.trim());
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    return {
      vin: row.vin,
      externalId: row.externalId || undefined,
      eventType: row.eventType,
      eventDate: row.eventDate || undefined,
      country: row.country || undefined,
      mileageKm: row.mileageKm ? Number(row.mileageKm) : undefined,
      title: row.title,
      description: row.description || undefined
    };
  });
}

export function checksumPayload(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

export async function importRecords(sourceKey: string, records: ImportRecord[], format: 'JSON' | 'CSV', checksum?: string) {
  const source = await db.dataSource.findUnique({
    where: { key: sourceKey },
    include: { licenses: true }
  });
  if (!source || !source.active) throw new Error('SOURCE_NOT_FOUND_OR_INACTIVE');
  if (!source.licenses.some((license) => license.canStore)) throw new Error('SOURCE_STORAGE_NOT_LICENSED');

  if (checksum) {
    const previous = await db.importJob.findFirst({ where: { sourceId: source.id, checksum, status: 'COMPLETED' } });
    if (previous) return previous;
  }

  const job = await db.importJob.create({
    data: { sourceId: source.id, status: 'RUNNING', format, checksum, startedAt: new Date(), rowsRead: records.length }
  });

  let rowsWritten = 0;
  const errors: Array<{ index: number; message: string }> = [];

  for (const [index, record] of records.entries()) {
    try {
      const vin = normalizeVin(record.vin);
      if (!isValidVin(vin)) throw new Error('INVALID_VIN');
      const vehicle = await db.vehicle.upsert({ where: { vin }, update: {}, create: { vin } });
      await db.vehicleEvent.upsert({
        where: {
          sourceId_externalId: {
            sourceId: source.id,
            externalId: record.externalId || `${vin}:${record.eventType}:${record.eventDate || 'unknown'}:${index}`
          }
        },
        update: {
          eventType: record.eventType,
          eventDate: record.eventDate ? new Date(record.eventDate) : null,
          country: record.country?.toUpperCase().slice(0, 2),
          mileageKm: record.mileageKm,
          title: record.title,
          description: record.description,
          rawPayload: record,
          quality: 'UNVERIFIED'
        },
        create: {
          vehicleId: vehicle.id,
          sourceId: source.id,
          externalId: record.externalId || `${vin}:${record.eventType}:${record.eventDate || 'unknown'}:${index}`,
          eventType: record.eventType,
          eventDate: record.eventDate ? new Date(record.eventDate) : null,
          country: record.country?.toUpperCase().slice(0, 2),
          mileageKm: record.mileageKm,
          title: record.title,
          description: record.description,
          rawPayload: record,
          quality: 'UNVERIFIED'
        }
      });
      rowsWritten += 1;
    } catch (error) {
      errors.push({ index, message: error instanceof Error ? error.message : 'UNKNOWN_ERROR' });
    }
  }

  return db.importJob.update({
    where: { id: job.id },
    data: {
      status: errors.length === records.length && records.length > 0 ? 'FAILED' : 'COMPLETED',
      rowsWritten,
      errorLog: errors,
      finishedAt: new Date()
    }
  });
}
