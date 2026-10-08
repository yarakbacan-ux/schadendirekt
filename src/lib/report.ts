import { db } from '@/lib/db';
import { findLicenseForAction, type LicenseLike } from '@/lib/license-policy';
import { analyzeMileage } from '@/lib/mileage-analysis';
import { hydrateVehicleFromNhtsa } from '@/lib/nhtsa';
import { isValidVin, normalizeVin } from '@/lib/vin';
import type { VehicleEventTypeName } from '@/lib/event-types';

export type ReportSource = { key: string; name: string };

type SourceInput = ReportSource & { licenses: LicenseLike[] };

type ReportInput = {
  vin: string;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  bodyClass: string | null;
  fuelType: string | null;
  engineDisplacement: number | null;
  enginePowerKw: number | null;
  transmission: string | null;
  manufacturer: string | null;
  plantCountry: string | null;
  vehicleType: string | null;
  market: string | null;
  events: Array<{
    id: string;
    eventType: string;
    sourceEventType: string | null;
    eventDate: Date | null;
    country: string | null;
    mileageKm: number | null;
    title: string;
    description: string | null;
    quality: string;
    importedAt: Date;
    source: SourceInput;
  }>;
  attributes: Array<{
    field: string;
    value: string;
    sourceField: string | null;
    quality: string;
    fetchedAt: Date;
    source: SourceInput;
  }>;
};

const SPEC_FIELDS = [
  'make', 'model', 'modelYear', 'bodyClass', 'fuelType', 'engineDisplacement',
  'enginePowerKw', 'transmission', 'manufacturer', 'plantCountry', 'vehicleType', 'market'
] as const;

type SpecField = (typeof SPEC_FIELDS)[number];

function sourceAllowed(source: SourceInput, now: Date) {
  return Boolean(findLicenseForAction(source.licenses, 'COMMERCIALIZE', now));
}

function latestPublishableAttributes(input: ReportInput, now: Date) {
  const result = new Map<string, ReportInput['attributes'][number]>();
  for (const attribute of input.attributes) {
    if (!sourceAllowed(attribute.source, now)) continue;
    const current = result.get(attribute.field);
    if (!current || attribute.fetchedAt > current.fetchedAt) result.set(attribute.field, attribute);
  }
  return result;
}

function eventDateSort(a: ReportInput['events'][number], b: ReportInput['events'][number]) {
  const aTime = a.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return aTime - bTime || a.importedAt.getTime() - b.importedAt.getTime();
}

export function serializeVehicleReport(input: ReportInput, now = new Date()) {
  const attributes = latestPublishableAttributes(input, now);
  const timeline = input.events
    .filter((event) => sourceAllowed(event.source, now))
    .sort(eventDateSort)
    .map((event) => ({
      id: event.id,
      type: event.eventType as VehicleEventTypeName,
      sourceType: event.sourceEventType,
      date: event.eventDate?.toISOString() ?? null,
      country: event.country,
      mileageKm: event.mileageKm,
      title: event.title,
      description: event.description,
      quality: event.quality,
      source: { key: event.source.key, name: event.source.name }
    }));

  const provenance: Record<string, { source: ReportSource; sourceField: string | null; quality: string; fetchedAt: string }> = {};
  const vehicle: Record<string, string | number | null | Record<string, unknown>> = { vin: input.vin };

  for (const field of SPEC_FIELDS) {
    const attribute = attributes.get(field);
    const directValue = input[field];
    if (!attribute || directValue == null) {
      vehicle[field] = null;
      continue;
    }
    vehicle[field] = directValue;
    provenance[field] = {
      source: { key: attribute.source.key, name: attribute.source.name },
      sourceField: attribute.sourceField,
      quality: attribute.quality,
      fetchedAt: attribute.fetchedAt.toISOString()
    };
  }
  vehicle.provenance = provenance;

  const mileage = analyzeMileage(timeline.map((event) => ({
    id: event.id,
    eventDate: event.date,
    mileageKm: event.mileageKm
  })));

  const damageEvents = timeline.filter((event) => event.type === 'DAMAGE_RECORD');
  const sourceMap = new Map<string, ReportSource>();
  for (const event of timeline) sourceMap.set(event.source.key, event.source);
  for (const attribute of attributes.values()) sourceMap.set(attribute.source.key, { key: attribute.source.key, name: attribute.source.name });

  const hasSpecs = SPEC_FIELDS.some((field) => vehicle[field] != null);
  const status = timeline.length > 0 || hasSpecs ? 'DATA_AVAILABLE' : 'NO_DATA';

  return {
    vin: input.vin,
    found: status === 'DATA_AVAILABLE',
    status,
    vehicle,
    timeline,
    events: timeline,
    mileageAnalysis: mileage,
    damageEvents,
    sources: [...sourceMap.values()],
    generatedAt: now.toISOString(),
    disclaimer: status === 'NO_DATA'
      ? 'Für diese FIN liegen derzeit keine veröffentlichbaren Daten vor. Das bedeutet nicht, dass das Fahrzeug unfallfrei ist oder der Kilometerstand korrekt ist.'
      : 'Der Bericht bildet ausschließlich die verfügbaren und lizenzrechtlich freigegebenen Daten ab. Fehlende Einträge beweisen weder Unfallfreiheit noch einen korrekten Kilometerstand.'
  } as const;
}

export async function getVehicleReport(rawVin: string, options: { hydrateNhtsa?: boolean } = {}) {
  const vin = normalizeVin(rawVin);
  if (!isValidVin(vin)) throw new Error('INVALID_VIN');

  if (options.hydrateNhtsa !== false) {
    try {
      await hydrateVehicleFromNhtsa(vin);
    } catch (error) {
      console.warn('NHTSA hydration failed', { vin, error: error instanceof Error ? error.message : 'UNKNOWN' });
    }
  }

  const vehicle = await db.vehicle.findUnique({
    where: { vin },
    include: {
      attributes: {
        include: { source: { include: { licenses: true } } },
        orderBy: { fetchedAt: 'desc' }
      },
      events: {
        include: { source: { include: { licenses: true } } },
        orderBy: [{ eventDate: 'asc' }, { importedAt: 'asc' }]
      }
    }
  });

  if (!vehicle) {
    return {
      vin,
      found: false,
      status: 'NO_DATA' as const,
      vehicle: { vin, provenance: {} },
      timeline: [],
      events: [],
      mileageAnalysis: { status: 'INSUFFICIENT_DATA' as const, readings: [], findings: [] },
      damageEvents: [],
      sources: [],
      generatedAt: new Date().toISOString(),
      disclaimer: 'Für diese FIN liegen derzeit keine veröffentlichbaren Daten vor. Das bedeutet nicht, dass das Fahrzeug unfallfrei ist oder der Kilometerstand korrekt ist.'
    };
  }

  return serializeVehicleReport(vehicle);
}
