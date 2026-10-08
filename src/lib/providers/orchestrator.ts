import { Prisma, type VehicleOrigin } from '@prisma/client';
import { db } from '@/lib/db';
import { hasActiveContract } from '@/lib/contract-policy';
import { recomputeVehicleEventConflicts } from '@/lib/event-conflicts';
import { findLicenseForAction, retentionExpiry, type LicenseLike } from '@/lib/license-policy';
import { groupAttributeConflicts } from '@/lib/providers/conflicts';
import { evaluateProviderEligibility } from '@/lib/providers/eligibility';
import { selectProviders } from '@/lib/providers/registry';
import type {
  CoverageStatusName,
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

function groupedCoverageStatus(statuses: CoverageStatusName[]): CoverageStatusName {
  if (statuses.length === 0) return 'UNAVAILABLE';
  if (statuses.every((status) => status === 'LIVE')) return 'LIVE';
  if (statuses.every((status) => status === 'UNAVAILABLE')) return 'UNAVAILABLE';
  if (statuses.every((status) => status === 'PLANNED')) return 'PLANNED';
  return 'PARTIAL';
}

function operationalCoverage(
  provider: VehicleDataProvider,
  rows: Array<{
    market: string;
    capability: string;
    status: CoverageStatusName;
    earliestDate: Date | null;
    latestDate: Date | null;
    requirements: Prisma.JsonValue | null;
    qualityNote: string | null;
    freshnessSeconds: number | null;
    allowUnknownMarket: boolean;
  }>
): ProviderCoverageDefinition[] {
  const byMarket = new Map<string, typeof rows>();
  for (const row of rows) {
    const market = row.market.trim().toUpperCase();
    const group = byMarket.get(market) ?? [];
    group.push(row);
    byMarket.set(market, group);
  }

  return [...byMarket.entries()].map(([market, group]) => {
    const capabilities = [...new Set(group.map((row) => row.capability))]
      .filter((capability): capability is ProviderCapability => provider.capabilities.includes(capability as ProviderCapability));
    const requirements = [...new Set(group.flatMap((row) => parseRequirements(row.requirements)))];
    const earliest = group.map((row) => row.earliestDate).filter((value): value is Date => Boolean(value)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const latest = group.map((row) => row.latestDate).filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const freshness = group.map((row) => row.freshnessSeconds).filter((value): value is number => value != null && value >= 0);
    const qualityNotes = [...new Set(group.map((row) => row.qualityNote).filter((value): value is string => Boolean(value)))];
    return {
      market,
      capabilities,
      status: groupedCoverageStatus(group.map((row) => row.status)),
      earliestDate: earliest?.toISOString() ?? null,
      latestDate: latest?.toISOString() ?? null,
      requirements,
      qualityNote: qualityNotes.length > 0 ? qualityNotes.join(' | ') : null,
      allowUnknownMarket: group.some((row) => row.allowUnknownMarket),
      freshnessSeconds: freshness.length > 0 ? Math.min(...freshness) : null
    };
  });
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
    mappingVersion: provider.mappingVersion ?? null
  })));
  if (bootstrapRows.length > 0) {
    await db.providerCoverage.createMany({ data: bootstrapRows, skipDuplicates: true });
  }

  return db.dataSource.findUniqueOrThrow({
    where: { id: source.id },
    include: {
      licenses: true,
      contracts: true,
      coverages: true
    }
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
    update: {
      value: attribute.value,
      sourceField: attribute.sourceField,
      rawValue: attribute.rawValue ?? attribute.value,
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
      quality: attribute.quality,
      mappingVersion,
      fetchedAt: attribute.fetchedAt
    }
  }));

  const eventWrites = result.events.map((event) => db.vehicleEvent.upsert({
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
  const attributes = successful
    .flatMap((outcome) => outcome.attributes.map((attribute) => ({ providerKey: outcome.providerKey, ...attribute })))
    .sort((a, b) => a.field.localeCompare(b.field) || a.providerKey.localeCompare(b.providerKey) || b.fetchedAt.getTime() - a.fetchedAt.getTime());
  const events = successful
    .flatMap((outcome) => outcome.events.map((event) => ({ providerKey: outcome.providerKey, ...event })))
    .sort((a, b) => {
      const date = (a.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER);
      return date || a.providerKey.localeCompare(b.providerKey) || a.externalId.localeCompare(b.externalId);
    });
  return { attributes, events };
}

async function recordDecision(
  sourceId: string,
  vin: string,
  status: 'SKIPPED' | 'NOT_APPLICABLE',
  startedAt: Date,
  startedMs: number,
  reason: string,
  market: string | null,
  mappingVersion: string | null
) {
  await db.providerRun.create({
    data: {
      sourceId,
      vin,
      status,
      cached: false,
      durationMs: Date.now() - startedMs,
      decisionReason: reason,
      market,
      mappingVersion,
      startedAt,
      finishedAt: new Date()
    }
  });
}

async function latestSuccessfulRunForVin(sourceId: string, vin: string) {
  return db.providerRun.findFirst({
    where: {
      sourceId,
      vin,
      status: { in: ['SUCCESS', 'NO_DATA'] }
    },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true }
  });
}

async function markCoverageSuccessful(
  sourceId: string,
  finishedAt: Date,
  coverage: ProviderCoverageDefinition | null
) {
  if (!coverage) return;
  await db.providerCoverage.updateMany({
    where: {
      sourceId,
      market: coverage.market.toUpperCase(),
      capability: { in: [...coverage.capabilities] }
    },
    data: { lastSuccessfulAt: finishedAt }
  });
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
  const market = (options.market ?? vehicle.market)?.trim().toUpperCase() || null;

  const providers = options.providers
    ? [...options.providers]
    : selectProviders({ providerKeys: options.providerKeys, capabilities: options.capabilities });
  const outcomes: ProviderOutcome[] = [];

  for (const provider of providers) {
    const source = await ensureProviderSource(provider);
    const providerWithOperationalCoverage: VehicleDataProvider = {
      ...provider,
      coverage: operationalCoverage(provider, source.coverages)
    };
    const startedAt = new Date();
    const startedMs = Date.now();
    const configuration = provider.configurationStatus?.() ?? { configured: true, missing: [] };
    const publicUse = (options.origin ?? 'PUBLIC_LOOKUP') === 'PUBLIC_LOOKUP' || options.origin === 'REPORT_PURCHASE';
    const requiredLicense = publicUse
      ? findLicenseForAction(source.licenses, 'COMMERCIALIZE', startedAt)
      : findLicenseForAction(source.licenses, 'STORE', startedAt);
    const activeContract = hasActiveContract(source.contracts, startedAt);
    const lastSuccessfulRun = await latestSuccessfulRunForVin(source.id, vin);
    const eligibility = evaluateProviderEligibility({
      provider: providerWithOperationalCoverage,
      sourceActive: source.active,
      configured: configuration.configured,
      hasRequiredLicense: Boolean(requiredLicense),
      hasRequiredContract: activeContract,
      market,
      lastSuccessfulAt: lastSuccessfulRun?.finishedAt ?? null,
      now: startedAt
    });

    if (eligibility.action !== 'CALL') {
      const status = eligibility.action === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'SKIPPED';
      await recordDecision(source.id, vin, status, startedAt, startedMs, eligibility.reason, market, provider.mappingVersion ?? null);
      outcomes.push({
        providerKey: provider.key,
        status,
        cached: false,
        attributes: [],
        events: [],
        errorCode: null,
        decisionReason: eligibility.reason,
        market,
        mappingVersion: provider.mappingVersion ?? null
      });
      continue;
    }

    const storeLicense = findLicenseForAction(source.licenses, 'STORE', startedAt);
    try {
      const result = await provider.lookup(vin, { canStore: Boolean(storeLicense), now: startedAt, market });
      const availability = result.availability ?? (result.attributes.length > 0 || result.events.length > 0 ? 'DATA' : 'NO_DATA');
      const mappingVersion = result.mappingVersion ?? provider.mappingVersion ?? null;
      if (availability === 'DATA' && storeLicense) {
        await persistProviderResult(vehicle.id, source.id, result, storeLicense, mappingVersion);
      }

      const finishedAt = new Date();
      const runStatus = availability === 'DATA' ? 'SUCCESS' : 'NO_DATA';
      await db.providerRun.create({
        data: {
          sourceId: source.id,
          vin,
          status: runStatus,
          cached: result.cached,
          durationMs: Date.now() - startedMs,
          decisionReason: 'ELIGIBLE',
          market,
          mappingVersion,
          startedAt,
          finishedAt
        }
      });
      await markCoverageSuccessful(source.id, finishedAt, eligibility.coverage);
      outcomes.push({
        providerKey: provider.key,
        status: runStatus,
        cached: result.cached,
        attributes: result.attributes,
        events: result.events,
        errorCode: null,
        decisionReason: 'ELIGIBLE',
        market,
        mappingVersion
      });
    } catch (error) {
      const code = errorCode(error);
      const finishedAt = new Date();
      await db.providerRun.create({
        data: {
          sourceId: source.id,
          vin,
          status: 'FAILED',
          cached: false,
          durationMs: Date.now() - startedMs,
          errorCode: code,
          decisionReason: 'UPSTREAM_ERROR',
          market,
          mappingVersion: provider.mappingVersion ?? null,
          startedAt,
          finishedAt
        }
      });
      outcomes.push({ providerKey: provider.key, status: 'FAILED', cached: false, attributes: [], events: [], errorCode: code, decisionReason: 'UPSTREAM_ERROR', market, mappingVersion: provider.mappingVersion ?? null });
    }
  }

  return outcomes;
}

export type { ProviderEvent };
