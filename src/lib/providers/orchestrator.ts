import { Prisma, type VehicleOrigin } from '@prisma/client';
import { db } from '@/lib/db';
import { findLicenseForAction } from '@/lib/license-policy';
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

const CANONICAL_FIELDS = new Set([
  'make', 'model', 'modelYear', 'bodyClass', 'fuelType', 'engineDisplacement',
  'enginePowerKw', 'transmission', 'manufacturer', 'plantCountry', 'vehicleType', 'market'
]);
const NUMERIC_FIELDS = new Set(['modelYear', 'engineDisplacement', 'enginePowerKw']);

async function ensureProviderSource(provider: VehicleDataProvider) {
  return db.dataSource.upsert({
    where: { key: provider.key },
    update: { name: provider.name, description: provider.description },
    create: { key: provider.key, name: provider.name, description: provider.description, active: true },
    include: { licenses: true }
  });
}

function canonicalVehicleData(attributes: ProviderAttribute[]): Prisma.VehicleUpdateInput {
  const data: Record<string, string | number> = {};
  for (const attribute of attributes) {
    if (!CANONICAL_FIELDS.has(attribute.field)) continue;
    if (NUMERIC_FIELDS.has(attribute.field)) {
      const parsed = Number(attribute.value);
      if (!Number.isFinite(parsed)) continue;
      if (attribute.field === 'modelYear' && !Number.isInteger(parsed)) continue;
      data[attribute.field] = parsed;
    } else {
      data[attribute.field] = attribute.value;
    }
  }
  return data as Prisma.VehicleUpdateInput;
}

async function persistProviderResult(
  vehicleId: string,
  sourceId: string,
  result: ProviderLookupResult
) {
  const attributeWrites = result.attributes.map((attribute) => db.vehicleAttribute.upsert({
    where: { vehicleId_sourceId_field: { vehicleId, sourceId, field: attribute.field } },
    update: {
      value: attribute.value,
      sourceField: attribute.sourceField,
      rawValue: attribute.rawValue ?? attribute.value,
      quality: attribute.quality,
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
      rawPayload: event.rawPayload ? event.rawPayload as Prisma.InputJsonValue : undefined
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
      rawPayload: event.rawPayload ? event.rawPayload as Prisma.InputJsonValue : undefined
    }
  }));

  if (attributeWrites.length || eventWrites.length) {
    await db.$transaction([...attributeWrites, ...eventWrites]);
  }

  const canonical = canonicalVehicleData(result.attributes);
  if (Object.keys(canonical).length > 0) {
    await db.vehicle.update({ where: { id: vehicleId }, data: canonical });
  }
}

function errorCode(error: unknown): string {
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

    if (!source.active) {
      const finishedAt = new Date();
      await db.providerRun.create({
        data: {
          sourceId: source.id,
          vin,
          status: 'SKIPPED',
          cached: false,
          durationMs: Date.now() - startedMs,
          errorCode: 'SOURCE_INACTIVE',
          startedAt,
          finishedAt
        }
      });
      outcomes.push({ providerKey: provider.key, status: 'SKIPPED', cached: false, attributes: [], events: [], errorCode: 'SOURCE_INACTIVE' });
      continue;
    }

    const storeLicense = findLicenseForAction(source.licenses, 'STORE');
    try {
      const result = await provider.lookup(vin, { canStore: Boolean(storeLicense), now: startedAt });
      if (storeLicense) await persistProviderResult(vehicle.id, source.id, result);

      const finishedAt = new Date();
      await db.providerRun.create({
        data: {
          sourceId: source.id,
          vin,
          status: 'SUCCESS',
          cached: result.cached,
          durationMs: Date.now() - startedMs,
          startedAt,
          finishedAt
        }
      });
      outcomes.push({
        providerKey: provider.key,
        status: 'SUCCESS',
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
          startedAt,
          finishedAt
        }
      });
      outcomes.push({ providerKey: provider.key, status: 'FAILED', cached: false, attributes: [], events: [], errorCode: code });
    }
  }

  return outcomes;
}

export type { ProviderEvent };
