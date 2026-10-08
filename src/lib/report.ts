import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { findLicenseForAction, type LicenseLike } from '@/lib/license-policy';
import { analyzeMileage } from '@/lib/mileage-analysis';
import { analyzeAttributeConflict } from '@/lib/providers/conflicts';
import { runVehicleProviders } from '@/lib/providers/orchestrator';
import { buildReportCoverage } from '@/lib/report-coverage';
import { selectProviders } from '@/lib/providers/registry';
import type { ProviderCapability, ProviderOutcome, VehicleDataProvider } from '@/lib/providers/types';
import { isValidVin, normalizeVin } from '@/lib/vin';
import type { VehicleEventTypeName } from '@/lib/event-types';

export type ReportSource = { key: string; name: string };
type SourceInput = ReportSource & { licenses: LicenseLike[]; preauthorizedCommercialUse?: boolean };

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
    rawPayload: Prisma.JsonValue | null;
    importedAt: Date;
    conflict?: boolean;
    mappingVersion?: string | null;
    source: SourceInput;
  }>;
  attributes: Array<{
    id: string;
    field: string;
    value: string;
    sourceField: string | null;
    quality: string;
    fetchedAt: Date;
    conflict?: boolean;
    mappingVersion?: string | null;
    source: SourceInput;
  }>;
};

export type VehicleReportOptions = {
  hydrateProviders?: boolean;
  providerKeys?: readonly string[];
  excludeProviderKeys?: readonly string[];
  /** Backwards-compatible explicit trusted market supplied by a server-side caller. */
  market?: string | null;
  /** Preferred explicit market hint. It is only used when trusted=true. */
  marketHint?: { market: string; trusted: boolean; provenance: string } | null;
};

const SPEC_FIELDS = [
  'make', 'model', 'modelYear', 'bodyClass', 'fuelType', 'engineDisplacement',
  'enginePowerKw', 'transmission', 'manufacturer', 'plantCountry', 'vehicleType', 'market'
] as const;
type SpecField = (typeof SPEC_FIELDS)[number];
const NUMERIC_FIELDS = new Set<SpecField>(['modelYear', 'engineDisplacement', 'enginePowerKw']);

function normalizeMarket(value: string | null | undefined): string | null {
  const market = value?.trim().toUpperCase() ?? '';
  return /^[A-Z]{2}$/.test(market) ? market : null;
}

function eventCapability(eventType: string): ProviderCapability | null {
  if (eventType === 'ODOMETER_READING') return 'ODOMETER';
  if (eventType === 'DAMAGE_RECORD') return 'DAMAGE';
  if (eventType === 'INSPECTION') return 'INSPECTION';
  if (eventType === 'REGISTRATION' || eventType === 'IMPORT_EXPORT') return 'REGISTRATION';
  if (eventType === 'RECALL') return 'RECALLS';
  return null;
}

function sourceAllowed(source: SourceInput, now: Date, capability: ProviderCapability | null, market: string | null) {
  if (source.preauthorizedCommercialUse) return true;
  if (capability && findLicenseForAction(source.licenses, 'COMMERCIALIZE', now, { market, capability })) return true;
  if (!capability && findLicenseForAction(source.licenses, 'COMMERCIALIZE', now, { market })) return true;
  return false;
}

function attributeCapability(field: string): ProviderCapability {
  return field === 'market' ? 'REGISTRATION' : 'VEHICLE_SPECS';
}

function selectedPublishableAttributes(input: ReportInput, now: Date) {
  const grouped = new Map<string, ReportInput['attributes']>();
  for (const attribute of input.attributes) {
    const policyMarket = attribute.field === 'market' ? normalizeMarket(attribute.value) : normalizeMarket(input.market);
    if (!sourceAllowed(attribute.source, now, attributeCapability(attribute.field), policyMarket) || attribute.quality === 'REJECTED') continue;
    const list = grouped.get(attribute.field) ?? [];
    list.push(attribute);
    grouped.set(attribute.field, list);
  }

  const selected = new Map<string, ReportInput['attributes'][number]>();
  const conflicts: Array<{
    field: string;
    candidates: Array<{ source: ReportSource; value: string; quality: string; fetchedAt: string; mappingVersion: string | null }>;
  }> = [];

  for (const [field, candidates] of grouped) {
    const analysis = analyzeAttributeConflict(candidates.map((candidate) => ({
      id: candidate.id,
      sourceKey: candidate.source.key,
      field: candidate.field,
      value: candidate.value,
      quality: candidate.quality,
      fetchedAt: candidate.fetchedAt
    })));
    if (analysis.selected) {
      const winner = candidates.find((candidate) => candidate.id === analysis.selected?.id);
      if (winner) selected.set(field, winner);
    }
    if (analysis.conflict) {
      conflicts.push({
        field,
        candidates: candidates.slice().sort((a, b) => a.source.key.localeCompare(b.source.key) || a.id.localeCompare(b.id)).map((candidate) => ({
          source: { key: candidate.source.key, name: candidate.source.name },
          value: candidate.value,
          quality: candidate.quality,
          fetchedAt: candidate.fetchedAt.toISOString(),
          mappingVersion: candidate.mappingVersion ?? null
        }))
      });
    }
  }
  return { selected, conflicts };
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

export function serializeVehicleReport(input: ReportInput, now = new Date()) {
  const attributeSelection = selectedPublishableAttributes(input, now);
  const attributes = attributeSelection.selected;
  const reportMarket = normalizeMarket(input.market) ?? normalizeMarket(attributes.get('market')?.value);
  const timeline = input.events
    .filter((event) => sourceAllowed(event.source, now, eventCapability(event.eventType), reportMarket ?? normalizeMarket(event.country)) && event.quality !== 'REJECTED')
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
      conflict: event.conflict ?? false,
      mappingVersion: event.mappingVersion ?? null,
      details: event.rawPayload,
      source: { key: event.source.key, name: event.source.name }
    }));

  const provenance: Record<string, { source: ReportSource; sourceField: string | null; quality: string; fetchedAt: string; attributeId: string; conflict: boolean; mappingVersion: string | null }> = {};
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
      conflict: attributeSelection.conflicts.some((item) => item.field === field),
      mappingVersion: attribute.mappingVersion ?? null
    };
  }
  vehicle.provenance = provenance;

  const mileage = analyzeMileage(timeline.map((event) => ({ id: event.id, eventDate: event.date, mileageKm: event.mileageKm })));
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
    attributeConflicts: attributeSelection.conflicts,
    sources: [...sourceMap.values()],
    generatedAt: now.toISOString(),
    disclaimer: status === 'NO_DATA'
      ? 'Für diese FIN liegen derzeit keine veröffentlichbaren Daten vor. Das bedeutet nicht, dass das Fahrzeug unfallfrei ist oder der Kilometerstand korrekt ist.'
      : 'Der Bericht bildet ausschließlich die verfügbaren und lizenzrechtlich freigegebenen Daten ab. Fehlende Einträge beweisen weder Unfallfreiheit noch einen korrekten Kilometerstand.'
  } as const;
}

async function reliableStoredMarket(vin: string, now = new Date()): Promise<string | null> {
  const vehicle = await db.vehicle.findUnique({
    where: { vin },
    select: {
      market: true,
      attributes: {
        where: { field: 'market', conflict: false, quality: { in: ['VERIFIED', 'TECHNICALLY_VALID'] } },
        orderBy: { fetchedAt: 'desc' },
        include: { source: { include: { licenses: true } } }
      }
    }
  });
  const canonical = normalizeMarket(vehicle?.market);
  if (!canonical) return null;
  const provenance = vehicle?.attributes.find((attribute) => {
    if (normalizeMarket(attribute.value) !== canonical || !attribute.source.active) return false;
    return Boolean(
      findLicenseForAction(attribute.source.licenses, 'STORE', now, { market: canonical, capability: 'REGISTRATION' })
      ?? findLicenseForAction(attribute.source.licenses, 'STORE', now, { market: canonical, capability: 'VEHICLE_SPECS' })
    );
  });
  return provenance ? canonical : null;
}

export function reliableMarketFromOutcomes(outcomes: readonly ProviderOutcome[]): string | null {
  const candidates = outcomes
    .filter((outcome) => outcome.status === 'SUCCESS')
    .flatMap((outcome) => outcome.attributes)
    .filter((attribute) => attribute.field === 'market' && (attribute.quality === 'VERIFIED' || attribute.quality === 'TECHNICALLY_VALID'))
    .map((attribute) => normalizeMarket(attribute.value))
    .filter((market): market is string => Boolean(market));
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
}

function replaceProviderOutcomes(initial: ProviderOutcome[], retry: ProviderOutcome[]): ProviderOutcome[] {
  const retryByKey = new Map(retry.map((outcome) => [outcome.providerKey, outcome]));
  return initial.map((outcome) => retryByKey.get(outcome.providerKey) ?? outcome);
}

async function hydrateReportProviders(vin: string, providers: readonly VehicleDataProvider[], options: VehicleReportOptions): Promise<ProviderOutcome[]> {
  if (options.hydrateProviders === false || providers.length === 0) return [];

  const trustedHint = options.marketHint?.trusted ? normalizeMarket(options.marketHint.market) : null;
  const legacyExplicit = Object.prototype.hasOwnProperty.call(options, 'market') ? normalizeMarket(options.market) : null;
  const explicitMarketSupplied = Boolean(trustedHint || legacyExplicit || Object.prototype.hasOwnProperty.call(options, 'market'));
  const explicitMarket = trustedHint ?? legacyExplicit;
  const storedMarket = explicitMarketSupplied ? null : await reliableStoredMarket(vin);
  const initialMarket = explicitMarketSupplied ? (explicitMarket ?? '') : (storedMarket ?? '');

  const initial = await runVehicleProviders(vin, { origin: 'PUBLIC_LOOKUP', providers, market: initialMarket });
  if (initialMarket) return initial;

  const discoveredMarket = reliableMarketFromOutcomes(initial) ?? await reliableStoredMarket(vin);
  if (!discoveredMarket) return initial;
  const retryProviders = providers.filter((provider) => {
    const outcome = initial.find((item) => item.providerKey === provider.key);
    return outcome?.status === 'SKIPPED' && outcome.decisionReason === 'MARKET_UNKNOWN';
  });
  if (retryProviders.length === 0) return initial;
  const retry = await runVehicleProviders(vin, { origin: 'PUBLIC_LOOKUP', providers: retryProviders, market: discoveredMarket });
  return replaceProviderOutcomes(initial, retry);
}

function withEphemeralOutcomes(input: ReportInput, outcomes: readonly ProviderOutcome[]): ReportInput {
  const ephemeral = outcomes.filter((outcome) => outcome.status === 'SUCCESS' && outcome.persisted !== true);
  if (ephemeral.length === 0) return input;
  const attributes = [...input.attributes];
  const events = [...input.events];
  for (const outcome of ephemeral) {
    const source: SourceInput = {
      key: outcome.providerKey,
      name: outcome.providerName ?? outcome.providerKey,
      licenses: [],
      preauthorizedCommercialUse: true
    };
    outcome.attributes.forEach((attribute, index) => attributes.push({
      id: `ephemeral:${outcome.providerKey}:attribute:${attribute.field}:${index}`,
      field: attribute.field,
      value: attribute.value,
      sourceField: attribute.sourceField,
      quality: attribute.quality,
      fetchedAt: attribute.fetchedAt,
      conflict: false,
      mappingVersion: outcome.mappingVersion ?? null,
      source
    }));
    outcome.events.forEach((event, index) => events.push({
      id: `ephemeral:${outcome.providerKey}:event:${event.externalId}:${index}`,
      eventType: event.eventType,
      sourceEventType: event.sourceEventType ?? null,
      eventDate: event.eventDate ?? null,
      country: event.country ?? null,
      mileageKm: event.mileageKm ?? null,
      title: event.title,
      description: event.description ?? null,
      quality: event.quality,
      rawPayload: event.rawPayload ? event.rawPayload as Prisma.JsonObject : null,
      importedAt: new Date(),
      conflict: false,
      mappingVersion: outcome.mappingVersion ?? null,
      source
    }));
  }
  return { ...input, attributes, events };
}

export async function getVehicleReport(rawVin: string, options: VehicleReportOptions = {}) {
  const vin = normalizeVin(rawVin);
  if (!isValidVin(vin)) throw new Error('INVALID_VIN');
  const selectedProviders = selectProviders({ providerKeys: options.providerKeys, excludeProviderKeys: options.excludeProviderKeys });
  const outcomes = await hydrateReportProviders(vin, selectedProviders, options);

  const vehicle = await db.vehicle.findUnique({
    where: { vin },
    include: {
      attributes: { include: { source: { include: { licenses: true } } }, orderBy: { fetchedAt: 'desc' } },
      events: { include: { source: { include: { licenses: true } } }, orderBy: [{ eventDate: 'asc' }, { importedAt: 'asc' }] }
    }
  });

  const persistedSourceKeys = new Set<string>();
  for (const attribute of vehicle?.attributes ?? []) persistedSourceKeys.add(attribute.source.key);
  for (const event of vehicle?.events ?? []) persistedSourceKeys.add(event.source.key);
  const coverage = buildReportCoverage(selectedProviders, outcomes, persistedSourceKeys);
  const providerIssues = outcomes
    .filter((outcome) => outcome.status === 'FAILED' || (outcome.status === 'SKIPPED' && outcome.decisionReason !== 'FRESH_DATA'))
    .map((outcome) => ({ providerKey: outcome.providerKey, status: outcome.status, errorCode: outcome.errorCode ?? outcome.decisionReason ?? null }));

  const base: ReportInput = vehicle ?? {
    vin,
    make: null,
    model: null,
    modelYear: null,
    bodyClass: null,
    fuelType: null,
    engineDisplacement: null,
    enginePowerKw: null,
    transmission: null,
    manufacturer: null,
    plantCountry: null,
    vehicleType: null,
    market: null,
    attributes: [],
    events: []
  };
  const combined = withEphemeralOutcomes(base, outcomes);
  return { ...serializeVehicleReport(combined), coverage, providerIssues };
}
