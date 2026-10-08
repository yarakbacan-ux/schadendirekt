import { Prisma, type VehicleOrigin } from '@prisma/client';
import { db } from '@/lib/db';
import { findLicenseForAction, retentionExpiry, type LicenseLike } from '@/lib/license-policy';
import { evaluateProviderEligibility } from '@/lib/providers/eligibility';
import { selectProviders } from '@/lib/providers/registry';
import type {
  ProviderAttribute,
  ProviderCapability,
  ProviderEvent,
  ProviderOutcome,
  ProviderLookupResult,
  VehicleDataProvider
} from '@/lib/providers/types';
import { isValidVin, normalizeVin } from '@/lib/vin';

const CANONICAL_FIELDS = [
  'make', 'model', 'modelYear', 'bodyClass', 'fuelType', 'engineDisplacement',
  'enginePowerKw', 'transmission', 'manufacturer', 'plantCountry', 'vehicleType', 'market'
] as const;
type CanonicalField = (typeof CANONICAL_FIELDS)[number];
const NUMERIC_FIELDS = new Set<CanonicalField>(['modelYear', 'engineDisplacement', 'enginePowerKw']);

function parseOptionalDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function ensureProviderSource(provider: VehicleDataProvider) {
  const source = await db.dataSource.upsert({
    where: { key: provider.key },
    update: {
      name: provider.name,
      description: provider.description,
      authType: provider.authType,
      refreshPolicy: provider.refreshPolicy,
      rateLimitPolicy: provider.rateLimitPolicy,
      mappingVersion: provider.mappingVersion
    },
    create: {
      key: provider.key,
      name: provider.name,
      description: provider.description,
      authType: provider.authType,
      refreshPolicy: provider.refreshPolicy,
      rateLimitPolicy: provider.rateLimitPolicy,
      mappingVersion: provider.mappingVersion,
      active: true
    }
  });

  await Promise.all(provider.coverage.map((coverage) => db.providerCoverage.upsert({
    where: { sourceId_marketCode: { sourceId: source.id, marketCode: coverage.marketCode.toUpperCase() } },
    update: {
      capabilities: [...coverage.capabilities],
      status: coverage.status,
      earliestDate: parseOptionalDate(coverage.earliestDate),
      latestDate: parseOptionalDate(coverage.latestDate),
      requiresCredentials: coverage.requiresCredentials ?? false,
      requiresContract: coverage.requiresContract ?? false,
      requiresLicense: coverage.requiresLicense ?? false,
      freshnessHours: coverage.freshnessHours ?? null,
      qualityNote: coverage.qualityNote ?? null,
      notes: coverage.notes ?? null
    },
    create: {
      sourceId: source.id,
      marketCode: coverage.marketCode.toUpperCase(),
      capabilities: [...coverage.capabilities],
      status: coverage.status,
      earliestDate: parseOptionalDate(coverage.earliestDate),
      latestDate: parseOptionalDate(coverage.latestDate),
      requiresCredentials: coverage.requiresCredentials ?? false,
      requiresContract: coverage.requiresContract ?? false,
      requiresLicense: coverage.requiresLicense ?? false,
      freshnessHours: coverage.freshnessHours ?? null,
      qualityNote: coverage.qualityNote ?? null,
      notes: coverage.notes ?? null
    }
  })));

  await db.sourceMappingVersion.upsert({
    where: { sourceId_version: { sourceId: source.id, version: provider.mappingVersion } },
    update: { mapping: provider.mapping as Prisma.InputJsonValue },
    create: {
      sourceId: source.id,
      version: provider.mappingVersion,
      mapping: provider.mapping as Prisma.InputJsonValue,
      reprocessingNotes: 'Bei Mapping-Änderungen neue Version anlegen; bestehende Datensätze nicht still umdeuten.'
    }
  });

  return db.dataSource.findUniqueOrThrow({
    where: { id: source.id },
    include: { licenses: true }
  });
}

function canonicalValue(field: CanonicalField, value: string): string | number | null {
  if (!NUMERIC_FIELDS.has(field)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (field === 'modelYear' && !Number.isInteger(parsed)) return null;
  return parsed;
}

function normalizedCandidate(field: CanonicalField, value: string): string {
  const parsed = canonicalValue(field, value);
  if (parsed == null) return '';
  return typeof parsed === 'number' ? String(parsed) : parsed.trim().toLocaleUpperCase('en-US');
}

async function reconcileCanonicalVehicle(vehicleId: string) {
  const attributes = await db.vehicleAttribute.findMany({
    where: { vehicleId, quality: { not: 'REJECTED' } },
    orderBy: [{ field: 'asc' }, { sourceId: 'asc' }, { fetchedAt: 'desc' }]
  });

  const update: Record<string, string | number | null> = {};
  for (const field of CANONICAL_FIELDS) {
    const candidates = attributes.filter((attribute) => attribute.field === field);
    if (candidates.length === 0) continue;
    const distinct = new Map<string, string>();
    for (const candidate of candidates) {
      const normalized = normalizedCandidate(field, candidate.value);
      if (normalized) distinct.set(normalized, candidate.value);
    }
    if (distinct.size === 1) {
      update[field] = canonicalValue(field, [...distinct.values()][0]!) as string | number | null;
    } else if (distinct.size > 1) {
      update[field] = null;
    }
  }
  if (Object.keys(update).length > 0) await db.vehicle.update({ where: { id: vehicleId }, data: update });
}

async function persistProviderResult(
  vehicleId: string,
  sourceId: string,
  result: ProviderLookupResult,
  storageLicense: LicenseLike,
  mappingVersion: string
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

  if (attributeWrites.length || eventWrites.length) await db.$transaction([...attributeWrites, ...eventWrites]);
  await reconcileCanonicalVehicle(vehicleId);
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

async function recordSkipped(sourceId: string, vin: string, startedAt: Date, startedMs: number, reason: string, mappingVersion: string) {
  await db.providerRun.create({
    data: {
      sourceId,
      vin,
      status: 'SKIPPED',
      cached: false,
      durationMs: Date.now() - startedMs,
      errorCode: reason,
      decisionReason: reason,
      mappingVersion,
      startedAt,
      finishedAt: new Date()
    }
  });
}

export async function runVehicleProviders(
  rawVin: string,
  options: {
    origin?: VehicleOrigin;
    providerKeys?: readonly string[];
    capabilities?: readonly ProviderCapability[];
    providers?: readonly VehicleDataProvider[];
  } = {}
): Promise<ProviderOutcome[]> {
  const vin = normalizeVin(rawVin);
  if (!isValidVin(vin)) throw new Error('INVALID_VIN');

  const vehicle = await db.vehicle.upsert({
    where: { vin },
    update: {},
    create: { vin, origin: options.origin ?? 'PUBLIC_LOOKUP' }
  });

  const providers = options.providers
    ? [...options.providers]
    : selectProviders({ providerKeys: options.providerKeys, capabilities: options.capabilities });
  const outcomes: ProviderOutcome[] = [];

  for (const provider of providers) {
    const source = await ensureProviderSource(provider);
    const startedAt = new Date();
    const startedMs = Date.now();
    const configuration = provider.configurationStatus?.() ?? { configured: true, missing: [] };
    const storeLicense = findLicenseForAction(source.licenses, 'STORE', startedAt);
    const commercialLicense = findLicenseForAction(source.licenses, 'COMMERCIALIZE', startedAt);
    const lastSuccessfulRun = await db.providerRun.findFirst({
      where: { sourceId: source.id, vin, status: 'SUCCESS' },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true }
    });

    const eligibility = evaluateProviderEligibility(provider, {
      market: vehicle.market,
      sourceActive: source.active,
      configured: configuration.configured,
      hasActiveLicense: Boolean(storeLicense || commercialLicense),
      lastSuccessfulAt: lastSuccessfulRun?.finishedAt ?? null,
      now: startedAt
    });

    if (!eligibility.eligible) {
      await recordSkipped(source.id, vin, startedAt, startedMs, eligibility.reason, provider.mappingVersion);
      const decision = eligibility.decision === 'NOT_APPLICABLE'
        ? 'NOT_APPLICABLE'
        : eligibility.decision === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'SKIPPED';
      outcomes.push({
        providerKey: provider.key,
        status: 'SKIPPED',
        decision,
        decisionReason: eligibility.reason,
        mappingVersion: provider.mappingVersion,
        cached: false,
        attributes: [],
        events: [],
        errorCode: eligibility.reason
      });
      continue;
    }

    try {
      const result = await provider.lookup(vin, { canStore: Boolean(storeLicense), now: startedAt });
      if (storeLicense) await persistProviderResult(vehicle.id, source.id, result, storeLicense, provider.mappingVersion);

      const finishedAt = new Date();
      await db.providerRun.create({
        data: {
          sourceId: source.id,
          vin,
          status: 'SUCCESS',
          cached: result.cached,
          durationMs: Date.now() - startedMs,
          decisionReason: 'CALLED',
          mappingVersion: provider.mappingVersion,
          startedAt,
          finishedAt
        }
      });
      if (eligibility.coverage) {
        await db.providerCoverage.updateMany({
          where: { sourceId: source.id, marketCode: eligibility.coverage.marketCode.toUpperCase() },
          data: { lastSuccessfulAt: finishedAt }
        });
      }
      const hasData = result.attributes.length > 0 || result.events.length > 0;
      outcomes.push({
        providerKey: provider.key,
        status: 'SUCCESS',
        decision: hasData ? 'DATA' : 'NO_DATA',
        decisionReason: hasData ? 'PROVIDER_RETURNED_DATA' : 'PROVIDER_RETURNED_NO_DATA',
        mappingVersion: provider.mappingVersion,
        cached: result.cached,
        attributes: result.attributes,
        events: result.events,
        errorCode: null
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
          decisionReason: 'PROVIDER_ERROR',
          mappingVersion: provider.mappingVersion,
          startedAt,
          finishedAt
        }
      });
      outcomes.push({
        providerKey: provider.key,
        status: 'FAILED',
        decision: 'ERROR',
        decisionReason: 'PROVIDER_ERROR',
        mappingVersion: provider.mappingVersion,
        cached: false,
        attributes: [],
        events: [],
        errorCode: code
      });
    }
  }

  return outcomes;
}

export type { ProviderEvent };
