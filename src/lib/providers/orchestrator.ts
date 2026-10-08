import { Prisma, type VehicleOrigin } from '@prisma/client';
import { db } from '@/lib/db';
import { hasActiveContract } from '@/lib/contract-policy';
import { recomputeVehicleEventConflicts } from '@/lib/event-conflicts';
import { findLicenseForAction, retentionExpiry, type LicenseLike } from '@/lib/license-policy';
import { rateLimit } from '@/lib/rate-limit';
import { groupAttributeConflicts } from '@/lib/providers/conflicts';
import { coverageForCapability, evaluateProviderEligibility, type CapabilityEligibilityDecision } from '@/lib/providers/eligibility';
import { selectProviders } from '@/lib/providers/registry';
import type {
  ProviderAttribute,
  ProviderCapability,
  ProviderCoverageDefinition,
  ProviderEvent,
  ProviderOutcome,
  ProviderLookupResult,
  ProviderRequirement,
  VehicleDataProvider
} from '@/lib/providers/types';
import { isValidVin, normalizeVin } from '@/lib/vin';

const CANONICAL_FIELDS = new Set([
  'make', 'model', 'modelYear', 'bodyClass', 'fuelType', 'engineDisplacement',
  'enginePowerKw', 'transmission', 'manufacturer', 'plantCountry', 'vehicleType', 'market'
]);
const NUMERIC_FIELDS = new Set(['modelYear', 'engineDisplacement', 'enginePowerKw']);
const REQUIREMENTS = new Set<ProviderRequirement>(['CREDENTIALS', 'LICENSE', 'CONTRACT']);

function parseCoverageDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseRequirements(value: Prisma.JsonValue | null): ProviderRequirement[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ProviderRequirement => typeof item === 'string' && REQUIREMENTS.has(item as ProviderRequirement));
}

function operationalCoverage(
  provider: VehicleDataProvider,
  rows: Array<{
    market: string;
    capability: string;
    status: 'LIVE' | 'PARTIAL' | 'PLANNED' | 'UNAVAILABLE';
    earliestDate: Date | null;
    latestDate: Date | null;
    requirements: Prisma.JsonValue | null;
    qualityNote: string | null;
    freshnessSeconds: number | null;
    allowUnknownMarket: boolean;
    mappingVersion: string | null;
  }>
): ProviderCoverageDefinition[] {
  return rows
    .filter((row): row is typeof row & { capability: ProviderCapability } => provider.capabilities.includes(row.capability as ProviderCapability))
    .map((row) => ({
      market: row.market.trim().toUpperCase(),
      capabilities: [row.capability],
      status: row.status,
      earliestDate: row.earliestDate?.toISOString() ?? null,
      latestDate: row.latestDate?.toISOString() ?? null,
      requirements: parseRequirements(row.requirements),
      qualityNote: row.qualityNote,
      allowUnknownMarket: row.allowUnknownMarket,
      freshnessSeconds: row.freshnessSeconds,
      mappingVersion: row.mappingVersion ?? provider.mappingVersion ?? null
    }));
}

async function ensureProviderSource(provider: VehicleDataProvider) {
  const source = await db.dataSource.upsert({
    where: { key: provider.key },
    update: { name: provider.name, description: provider.description },
    create: { key: provider.key, name: provider.name, description: provider.description, active: true }
  });

  const bootstrapRows = (provider.coverage ?? []).flatMap((coverage) => coverage.capabilities.map((capability) => ({
    sourceId: source.id,
    market: coverage.market.toUpperCase(),
    capability,
    status: coverage.status,
    earliestDate: parseCoverageDate(coverage.earliestDate),
    latestDate: parseCoverageDate(coverage.latestDate),
    requirements: coverage.requirements ? [...coverage.requirements] : undefined,
    qualityNote: coverage.qualityNote ?? null,
    authType: provider.authType ?? 'NONE',
    freshnessSeconds: coverage.freshnessSeconds ?? provider.refreshPolicy?.maxAgeSeconds ?? null,
    allowUnknownMarket: coverage.allowUnknownMarket ?? false,
    mappingVersion: coverage.mappingVersion ?? provider.mappingVersion ?? null
  })));
  if (bootstrapRows.length > 0) await db.providerCoverage.createMany({ data: bootstrapRows, skipDuplicates: true });

  return db.dataSource.findUniqueOrThrow({
    where: { id: source.id },
    include: { licenses: true, contracts: true, coverages: true }
  });
}

function canonicalValue(field: string, value: string): string | number | null {
  if (!NUMERIC_FIELDS.has(field)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (field === 'modelYear' && !Number.isInteger(parsed)) return null;
  return parsed;
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

async function persistProviderResult(
  vehicleId: string,
  sourceId: string,
  result: ProviderLookupResult,
  storageLicense: LicenseLike,
  mappingVersion: string | null
) {
  const rawExpiresAt = retentionExpiry(storageLicense);
  const attributeWrites = result.attributes.map((attribute) => db.vehicleAttribute.upsert({
    where: { vehicleId_sourceId_field: { vehicleId, sourceId, field: attribute.field } },
    update: { value: attribute.value, sourceField: attribute.sourceField, rawValue: attribute.rawValue ?? attribute.value, quality: attribute.quality, mappingVersion, fetchedAt: attribute.fetchedAt },
    create: { vehicleId, sourceId, field: attribute.field, value: attribute.value, sourceField: attribute.sourceField, rawValue: attribute.rawValue ?? attribute.value, quality: attribute.quality, mappingVersion, fetchedAt: attribute.fetchedAt }
  }));
  const eventWrites = result.events.map((event) => db.vehicleEvent.upsert({
    where: { sourceId_externalId: { sourceId, externalId: event.externalId } },
    update: {
      vehicleId, eventType: event.eventType, sourceEventType: event.sourceEventType ?? null, eventDate: event.eventDate ?? null,
      country: event.country ?? null, mileageKm: event.mileageKm ?? null, title: event.title, description: event.description ?? null,
      quality: event.quality, mappingVersion, rawPayload: event.rawPayload ? event.rawPayload as Prisma.InputJsonValue : Prisma.DbNull,
      rawPayloadExpiresAt: event.rawPayload ? rawExpiresAt : null
    },
    create: {
      vehicleId, sourceId, externalId: event.externalId, eventType: event.eventType, sourceEventType: event.sourceEventType ?? null,
      eventDate: event.eventDate ?? null, country: event.country ?? null, mileageKm: event.mileageKm ?? null, title: event.title,
      description: event.description ?? null, quality: event.quality, mappingVersion,
      rawPayload: event.rawPayload ? event.rawPayload as Prisma.InputJsonValue : undefined,
      rawPayloadExpiresAt: event.rawPayload ? rawExpiresAt : null
    }
  }));
  if (attributeWrites.length || eventWrites.length) {
    await db.$transaction([...attributeWrites, ...eventWrites]);
    await recomputeCanonicalVehicle(vehicleId);
    await recomputeVehicleEventConflicts(vehicleId);
  }
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code.slice(0, 160);
  }
  if (error instanceof Error && error.message) return error.message.slice(0, 160);
  return 'PROVIDER_FAILED';
}

export function mergeProviderResults(outcomes: ProviderOutcome[]) {
  const successful = outcomes.filter((outcome) => outcome.status === 'SUCCESS');
  const attributes = successful.flatMap((outcome) => outcome.attributes.map((attribute) => ({ providerKey: outcome.providerKey, ...attribute })))
    .sort((a, b) => a.field.localeCompare(b.field) || a.providerKey.localeCompare(b.providerKey) || b.fetchedAt.getTime() - a.fetchedAt.getTime());
  const events = successful.flatMap((outcome) => outcome.events.map((event) => ({ providerKey: outcome.providerKey, ...event })))
    .sort((a, b) => ((a.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER)) || a.providerKey.localeCompare(b.providerKey) || a.externalId.localeCompare(b.externalId));
  return { attributes, events };
}

function normalizedMarket(value: string | null | undefined): string | null {
  const market = value?.trim().toUpperCase();
  return market || null;
}

function scopeMarket(market: string | null, coverage: ProviderCoverageDefinition | null): string {
  return normalizedMarket(market) ?? normalizedMarket(coverage?.market) ?? '*';
}

function scopeMappingVersion(provider: VehicleDataProvider, coverage: ProviderCoverageDefinition | null): string {
  return coverage?.mappingVersion?.trim() || provider.mappingVersion?.trim() || 'unversioned';
}

async function latestSuccessfulScope(
  sourceId: string,
  vin: string,
  capability: ProviderCapability,
  market: string,
  mappingVersion: string
): Promise<Date | null> {
  const row = await db.providerRunCapability.findFirst({
    where: {
      capability,
      market,
      mappingVersion,
      status: { in: ['SUCCESS', 'NO_DATA'] },
      providerRun: { sourceId, vin }
    },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true }
  });
  return row?.finishedAt ?? null;
}

function capabilityStatus(scope: CapabilityEligibilityDecision): 'SKIPPED' | 'NOT_APPLICABLE' {
  return scope.action === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'SKIPPED';
}

async function recordRun(input: {
  sourceId: string;
  vin: string;
  status: 'SUCCESS' | 'NO_DATA' | 'FAILED' | 'SKIPPED' | 'NOT_APPLICABLE';
  cached: boolean;
  startedAt: Date;
  startedMs: number;
  reason: string;
  market: string | null;
  mappingVersion: string;
  errorCode?: string | null;
  scopes: Array<{ capability: ProviderCapability; status: 'SUCCESS' | 'NO_DATA' | 'FAILED' | 'SKIPPED' | 'NOT_APPLICABLE'; reason: string; market: string; mappingVersion: string }>;
}) {
  const finishedAt = new Date();
  const run = await db.providerRun.create({
    data: {
      sourceId: input.sourceId,
      vin: input.vin,
      status: input.status,
      cached: input.cached,
      durationMs: Date.now() - input.startedMs,
      errorCode: input.errorCode ?? null,
      decisionReason: input.reason,
      market: input.market,
      mappingVersion: input.mappingVersion,
      startedAt: input.startedAt,
      finishedAt
    }
  });
  if (input.scopes.length > 0) {
    await db.providerRunCapability.createMany({
      data: input.scopes.map((scope) => ({
        providerRunId: run.id,
        capability: scope.capability,
        market: scope.market,
        mappingVersion: scope.mappingVersion,
        status: scope.status,
        decisionReason: scope.reason,
        finishedAt
      }))
    });
  }
  return { run, finishedAt };
}

async function markCoverageSuccessful(sourceId: string, finishedAt: Date, scopes: CapabilityEligibilityDecision[]) {
  for (const scope of scopes.filter((item) => item.action === 'CALL' && item.coverage)) {
    await db.providerCoverage.updateMany({
      where: {
        sourceId,
        market: scope.coverage!.market.toUpperCase(),
        capability: scope.capability
      },
      data: { lastSuccessfulAt: finishedAt }
    });
  }
}

export async function enforceProviderRateLimit(provider: VehicleDataProvider) {
  const minute = provider.rateLimit?.requestsPerMinute;
  if (minute && minute > 0) {
    const result = await rateLimit(`provider:${provider.key}:minute`, minute, 60_000);
    if (!result.allowed) return result;
  }
  const day = provider.rateLimit?.requestsPerDay;
  if (day && day > 0) {
    const result = await rateLimit(`provider:${provider.key}:day`, day, 86_400_000);
    if (!result.allowed) return result;
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function eventCapability(event: ProviderEvent): ProviderCapability | null {
  if (event.eventType === 'ODOMETER_READING') return 'ODOMETER';
  if (event.eventType === 'DAMAGE_RECORD') return 'DAMAGE';
  if (event.eventType === 'INSPECTION') return 'INSPECTION';
  if (event.eventType === 'REGISTRATION' || event.eventType === 'IMPORT_EXPORT') return 'REGISTRATION';
  if (event.eventType === 'RECALL') return 'RECALLS';
  return null;
}

function filterResultByCapabilities(result: ProviderLookupResult, capabilities: readonly ProviderCapability[]): ProviderLookupResult {
  const allowed = new Set(capabilities);
  const allowSpecs = allowed.has('VEHICLE_SPECS') || allowed.has('VIN_DECODE');
  const events = result.events
    .filter((event) => {
      const capability = eventCapability(event);
      return capability ? allowed.has(capability) : false;
    })
    .map((event) => {
      if (event.eventType === 'INSPECTION' && !allowed.has('ODOMETER') && event.mileageKm != null) {
        return { ...event, mileageKm: null, rawPayload: null };
      }
      return event;
    });
  return {
    ...result,
    attributes: allowSpecs ? result.attributes : [],
    events
  };
}

function mostRestrictiveRetentionLicense(licenses: LicenseLike[]): LicenseLike {
  return licenses.slice().sort((a, b) => (a.retentionDays ?? Number.MAX_SAFE_INTEGER) - (b.retentionDays ?? Number.MAX_SAFE_INTEGER))[0];
}

export async function runVehicleProviders(
  rawVin: string,
  options: {
    origin?: VehicleOrigin;
    providerKeys?: readonly string[];
    capabilities?: readonly ProviderCapability[];
    providers?: readonly VehicleDataProvider[];
    market?: string | null;
  } = {}
): Promise<ProviderOutcome[]> {
  const vin = normalizeVin(rawVin);
  if (!isValidVin(vin)) throw new Error('INVALID_VIN');

  const vehicle = await db.vehicle.upsert({
    where: { vin },
    update: {},
    create: { vin, origin: options.origin ?? 'PUBLIC_LOOKUP' }
  });
  const market = normalizedMarket(options.market ?? vehicle.market);
  const providers = options.providers ? [...options.providers] : selectProviders({ providerKeys: options.providerKeys, capabilities: options.capabilities });
  const outcomes: ProviderOutcome[] = [];

  for (const provider of providers) {
    const source = await ensureProviderSource(provider);
    const operationalProvider: VehicleDataProvider = { ...provider, coverage: operationalCoverage(provider, source.coverages) };
    const requestedCapabilities = (options.capabilities ?? provider.capabilities).filter((capability): capability is ProviderCapability => provider.capabilities.includes(capability));
    const startedAt = new Date();
    const startedMs = Date.now();
    const configuration = provider.configurationStatus?.() ?? { configured: true, missing: [] };
    const publicUse = (options.origin ?? 'PUBLIC_LOOKUP') === 'PUBLIC_LOOKUP' || options.origin === 'REPORT_PURCHASE';
    const rightsAction = publicUse ? 'COMMERCIALIZE' : 'STORE';
    const hasRequiredLicenseByCapability: Partial<Record<ProviderCapability, boolean>> = {};
    const hasRequiredContractByCapability: Partial<Record<ProviderCapability, boolean>> = {};
    const lastSuccessfulAtByCapability: Partial<Record<ProviderCapability, Date | null>> = {};

    for (const capability of requestedCapabilities) {
      const coverage = coverageForCapability(operationalProvider, market, capability);
      const policyScope = { market, capability };
      hasRequiredLicenseByCapability[capability] = Boolean(findLicenseForAction(source.licenses, rightsAction, startedAt, policyScope));
      hasRequiredContractByCapability[capability] = hasActiveContract(source.contracts, startedAt, policyScope);
      lastSuccessfulAtByCapability[capability] = await latestSuccessfulScope(
        source.id,
        vin,
        capability,
        scopeMarket(market, coverage),
        scopeMappingVersion(provider, coverage)
      );
    }

    const eligibility = evaluateProviderEligibility({
      provider: operationalProvider,
      sourceActive: source.active,
      configured: configuration.configured,
      hasRequiredLicense: false,
      hasRequiredContract: false,
      hasRequiredLicenseByCapability,
      hasRequiredContractByCapability,
      requireLicenseForAll: true,
      market,
      requestedCapabilities,
      lastSuccessfulAtByCapability,
      now: startedAt
    });

    const decisionScopes = eligibility.scopes.map((scope) => ({
      capability: scope.capability,
      status: capabilityStatus(scope),
      reason: scope.reason,
      market: scopeMarket(market, scope.coverage),
      mappingVersion: scopeMappingVersion(provider, scope.coverage)
    }));

    if (eligibility.action !== 'CALL') {
      const status = eligibility.action === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'SKIPPED';
      await recordRun({
        sourceId: source.id, vin, status, cached: false, startedAt, startedMs, reason: eligibility.reason, market,
        mappingVersion: provider.mappingVersion ?? 'unversioned', scopes: decisionScopes
      });
      outcomes.push({ providerKey: provider.key, providerName: provider.name, status, cached: false, persisted: false, attributes: [], events: [], errorCode: null, decisionReason: eligibility.reason, market, mappingVersion: provider.mappingVersion ?? null, capabilities: [] });
      continue;
    }

    const rate = await enforceProviderRateLimit(provider);
    if (!rate.allowed) {
      const rateScopes = eligibility.scopes.map((scope) => ({
        capability: scope.capability,
        status: scope.action === 'CALL' ? 'SKIPPED' as const : capabilityStatus(scope),
        reason: scope.action === 'CALL' ? 'RATE_LIMITED' : scope.reason,
        market: scopeMarket(market, scope.coverage),
        mappingVersion: scopeMappingVersion(provider, scope.coverage)
      }));
      await recordRun({
        sourceId: source.id, vin, status: 'SKIPPED', cached: false, startedAt, startedMs, reason: 'RATE_LIMITED', market,
        mappingVersion: provider.mappingVersion ?? 'unversioned', scopes: rateScopes
      });
      outcomes.push({ providerKey: provider.key, providerName: provider.name, status: 'SKIPPED', cached: false, persisted: false, attributes: [], events: [], errorCode: null, decisionReason: 'RATE_LIMITED', market, mappingVersion: provider.mappingVersion ?? null, capabilities: [], retryAfterSeconds: rate.retryAfterSeconds });
      continue;
    }

    const eligibleCapabilities = eligibility.eligibleCapabilities;
    const storeLicenses = eligibleCapabilities.map((capability) => findLicenseForAction(source.licenses, 'STORE', startedAt, { market, capability }));
    const canStore = storeLicenses.length > 0 && storeLicenses.every(Boolean);

    try {
      const rawResult = await provider.lookup(vin, { canStore, now: startedAt, market, capabilities: eligibleCapabilities });
      const result = filterResultByCapabilities(rawResult, eligibleCapabilities);
      const availability = result.availability ?? (result.attributes.length > 0 || result.events.length > 0 ? 'DATA' : 'NO_DATA');
      const mappingVersion = result.mappingVersion ?? provider.mappingVersion ?? 'unversioned';
      let persisted = false;
      if (availability === 'DATA' && canStore) {
        const license = mostRestrictiveRetentionLicense(storeLicenses.filter((item): item is NonNullable<typeof item> => Boolean(item)));
        await persistProviderResult(vehicle.id, source.id, result, license, mappingVersion);
        persisted = true;
      }

      const runStatus: 'SUCCESS' | 'NO_DATA' = availability === 'DATA' ? 'SUCCESS' : 'NO_DATA';
      const runScopes = eligibility.scopes.map((scope) => ({
        capability: scope.capability,
        status: scope.action === 'CALL' ? runStatus : capabilityStatus(scope),
        reason: scope.action === 'CALL' ? 'ELIGIBLE' : scope.reason,
        market: scopeMarket(market, scope.coverage),
        mappingVersion: scope.action === 'CALL' ? (scope.coverage?.mappingVersion ?? mappingVersion) : scopeMappingVersion(provider, scope.coverage)
      }));
      const recorded = await recordRun({
        sourceId: source.id, vin, status: runStatus, cached: result.cached, startedAt, startedMs, reason: 'ELIGIBLE', market,
        mappingVersion, scopes: runScopes
      });
      await markCoverageSuccessful(source.id, recorded.finishedAt, eligibility.scopes);
      outcomes.push({
        providerKey: provider.key, providerName: provider.name, status: runStatus, cached: result.cached, persisted,
        attributes: result.attributes, events: result.events, errorCode: null, decisionReason: 'ELIGIBLE', market,
        mappingVersion, capabilities: eligibleCapabilities
      });
    } catch (error) {
      const code = errorCode(error);
      const failedScopes = eligibility.scopes.map((scope) => ({
        capability: scope.capability,
        status: scope.action === 'CALL' ? 'FAILED' as const : capabilityStatus(scope),
        reason: scope.action === 'CALL' ? 'UPSTREAM_ERROR' : scope.reason,
        market: scopeMarket(market, scope.coverage),
        mappingVersion: scopeMappingVersion(provider, scope.coverage)
      }));
      await recordRun({
        sourceId: source.id, vin, status: 'FAILED', cached: false, startedAt, startedMs, reason: 'UPSTREAM_ERROR', market,
        mappingVersion: provider.mappingVersion ?? 'unversioned', errorCode: code, scopes: failedScopes
      });
      outcomes.push({ providerKey: provider.key, providerName: provider.name, status: 'FAILED', cached: false, persisted: false, attributes: [], events: [], errorCode: code, decisionReason: 'UPSTREAM_ERROR', market, mappingVersion: provider.mappingVersion ?? null, capabilities: eligibleCapabilities });
    }
  }
  return outcomes;
}

export type { ProviderEvent };
