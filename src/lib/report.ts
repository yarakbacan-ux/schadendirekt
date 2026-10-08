import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { analyzeFieldConflicts, compareConflictCandidates } from '@/lib/conflicts';
import { findLicenseForAction, type LicenseLike } from '@/lib/license-policy';
import { analyzeMileage } from '@/lib/mileage-analysis';
import { runVehicleProviders } from '@/lib/providers/orchestrator';
import { getProvider } from '@/lib/providers/registry';
import { NHTSA_SOURCE_KEY } from '@/lib/nhtsa';
import { DVSA_SOURCE_KEY } from '@/lib/providers/dvsa-provider';
import { isValidVin, normalizeVin } from '@/lib/vin';
import type { VehicleEventTypeName } from '@/lib/event-types';
import type { ProviderOutcome } from '@/lib/providers/types';

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
    mappingVersion?: string;
    rawPayload: Prisma.JsonValue | null;
    importedAt: Date;
    source: SourceInput;
  }>;
  attributes: Array<{
    id: string;
    field: string;
    value: string;
    sourceField: string | null;
    quality: string;
    mappingVersion?: string;
    fetchedAt: Date;
    source: SourceInput;
  }>;
};

const SPEC_FIELDS = [
  'make', 'model', 'modelYear', 'bodyClass', 'fuelType', 'engineDisplacement',
  'enginePowerKw', 'transmission', 'manufacturer', 'plantCountry', 'vehicleType', 'market'
] as const;

type SpecField = (typeof SPEC_FIELDS)[number];
const NUMERIC_FIELDS = new Set<SpecField>(['modelYear', 'engineDisplacement', 'enginePowerKw']);

function sourceAllowed(source: SourceInput, now: Date) {
  return Boolean(findLicenseForAction(source.licenses, 'COMMERCIALIZE', now));
}

function selectedPublishableAttributes(input: ReportInput, now: Date) {
  const grouped = new Map<string, ReportInput['attributes']>();
  for (const attribute of input.attributes) {
    if (!sourceAllowed(attribute.source, now) || attribute.quality === 'REJECTED') continue;
    const list = grouped.get(attribute.field) ?? [];
    list.push(attribute);
    grouped.set(attribute.field, list);
  }

  const selected = new Map<string, ReportInput['attributes'][number]>();
  for (const [field, candidates] of grouped) {
    candidates.sort((a, b) => compareConflictCandidates(a, b));
    if (candidates[0]) selected.set(field, candidates[0]);
  }
  return selected;
}

function reportAttributeValue(field: SpecField, value: string): string | number | null {
  if (!NUMERIC_FIELDS.has(field)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (field === 'modelYear' && !Number.isInteger(parsed)) return null;
  return parsed;
}

function eventDateSort(a: ReportInput['events'][number], b: ReportInput['events'][number]) {
  const aTime = a.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return aTime - bTime || a.importedAt.getTime() - b.importedAt.getTime();
}

function coverageFromOutcomes(outcomes: ProviderOutcome[]) {
  return outcomes.map((outcome) => {
    const provider = getProvider(outcome.providerKey);
    return {
      providerKey: outcome.providerKey,
      providerName: provider?.name ?? outcome.providerKey,
      decision: outcome.decision,
      reason: outcome.decisionReason,
      mappingVersion: outcome.mappingVersion,
      configuredCoverage: provider?.coverage.map((item) => ({
        marketCode: item.marketCode,
        status: item.status,
        capabilities: [...item.capabilities]
      })) ?? []
    };
  });
}

export function serializeVehicleReport(input: ReportInput, now = new Date()) {
  const publishableAttributes = input.attributes.filter((attribute) => sourceAllowed(attribute.source, now) && attribute.quality !== 'REJECTED');
  const attributes = selectedPublishableAttributes(input, now);
  const conflicts = analyzeFieldConflicts(publishableAttributes);
  const conflictingFields = new Set(conflicts.map((conflict) => conflict.field));

  const timeline = input.events
    .filter((event) => sourceAllowed(event.source, now) && event.quality !== 'REJECTED')
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
      mappingVersion: event.mappingVersion ?? 'legacy',
      details: event.rawPayload,
      source: { key: event.source.key, name: event.source.name }
    }));

  const provenance: Record<string, { source: ReportSource; sourceField: string | null; quality: string; fetchedAt: string; attributeId: string; mappingVersion: string; conflict: boolean }> = {};
  const vehicle: Record<string, string | number | null | Record<string, unknown>> = { vin: input.vin };

  for (const field of SPEC_FIELDS) {
    const attribute = attributes.get(field);
    if (!attribute) {
      vehicle[field] = null;
      continue;
    }

    const selectedValue = reportAttributeValue(field, attribute.value);
    if (selectedValue == null) {
      vehicle[field] = null;
      continue;
    }

    vehicle[field] = selectedValue;
    provenance[field] = {
      source: { key: attribute.source.key, name: attribute.source.name },
      sourceField: attribute.sourceField,
      quality: attribute.quality,
      fetchedAt: attribute.fetchedAt.toISOString(),
      attributeId: attribute.id,
      mappingVersion: attribute.mappingVersion ?? 'legacy',
      conflict: conflictingFields.has(field)
    };
  }
  vehicle.provenance = provenance;

  const mileage = analyzeMileage(timeline.map((event) => ({
    id: event.id,
    eventDate: event.date,
    mileageKm: event.mileageKm
  })));

  const damageEvents = timeline.filter((event) => event.type === 'DAMAGE_RECORD');
  const inspectionEvents = timeline.filter((event) => event.type === 'INSPECTION');
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
    inspectionEvents,
    conflicts,
    sources: [...sourceMap.values()],
    generatedAt: now.toISOString(),
    disclaimer: status === 'NO_DATA'
      ? 'Für diese FIN liegen derzeit keine veröffentlichbaren Daten vor. Das bedeutet nicht, dass das Fahrzeug unfallfrei ist oder der Kilometerstand korrekt ist.'
      : 'Der Bericht bildet ausschließlich die verfügbaren und lizenzrechtlich freigegebenen Daten ab. Fehlende Einträge beweisen weder Unfallfreiheit noch einen korrekten Kilometerstand.'
  } as const;
}

export async function getVehicleReport(rawVin: string, options: { hydrateNhtsa?: boolean; hydrateDvsa?: boolean } = {}) {
  const vin = normalizeVin(rawVin);
  if (!isValidVin(vin)) throw new Error('INVALID_VIN');

  const providerKeys: string[] = [];
  if (options.hydrateNhtsa !== false) providerKeys.push(NHTSA_SOURCE_KEY);
  if (options.hydrateDvsa !== false) providerKeys.push(DVSA_SOURCE_KEY);

  const outcomes = providerKeys.length > 0
    ? await runVehicleProviders(vin, { origin: 'PUBLIC_LOOKUP', providerKeys })
    : [];
  const providerIssues = outcomes
    .filter((outcome) => outcome.decision === 'ERROR' || outcome.decision === 'NOT_CONFIGURED')
    .map((outcome) => ({ providerKey: outcome.providerKey, status: outcome.status, errorCode: outcome.errorCode, decision: outcome.decision }));
  const coverage = coverageFromOutcomes(outcomes);

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
      inspectionEvents: [],
      mileageAnalysis: { status: 'INSUFFICIENT_DATA' as const, readings: [], findings: [] },
      damageEvents: [],
      conflicts: [],
      sources: [],
      coverage,
      providerIssues,
      generatedAt: new Date().toISOString(),
      disclaimer: 'Für diese FIN liegen derzeit keine veröffentlichbaren Daten vor. Das bedeutet nicht, dass das Fahrzeug unfallfrei ist oder der Kilometerstand korrekt ist.'
    };
  }

  return { ...serializeVehicleReport(vehicle), coverage, providerIssues };
}
