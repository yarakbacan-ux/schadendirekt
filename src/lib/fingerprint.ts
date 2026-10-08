import { createHash } from 'node:crypto';
import type { ImportRecord } from '@/lib/import-validation';
import { normalizeVin } from '@/lib/vin';

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function eventFingerprint(sourceKey: string, record: ImportRecord): string {
  const canonical = [
    sourceKey.trim().toLowerCase(),
    normalizeVin(record.vin),
    normalizeText(record.eventType),
    record.eventDate ?? '',
    record.mileageKm == null ? '' : String(record.mileageKm),
    (record.country ?? '').toUpperCase(),
    normalizeText(record.title),
    normalizeText(record.description)
  ].join('|');

  return `fp:${createHash('sha256').update(canonical).digest('hex')}`;
}
