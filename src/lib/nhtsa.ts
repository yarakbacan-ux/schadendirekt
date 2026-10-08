import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { isValidVin, normalizeVin } from '@/lib/vin';
import { rateLimit } from '@/lib/rate-limit';

export const NHTSA_SOURCE_KEY = 'nhtsa-vpic';
export const NHTSA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type NhtsaMappedSpecs = {
  make?: string;
  model?: string;
  modelYear?: number;
  bodyClass?: string;
  fuelType?: string;
  engineDisplacement?: number;
  enginePowerKw?: number;
  transmission?: string;
  manufacturer?: string;
  plantCountry?: string;
  vehicleType?: string;
};

export type NhtsaFlatResult = Record<string, unknown>;

const FIELD_SOURCES: Record<keyof NhtsaMappedSpecs, string> = {
  make: 'Make',
  model: 'Model',
  modelYear: 'ModelYear',
  bodyClass: 'BodyClass',
  fuelType: 'FuelTypePrimary',
  engineDisplacement: 'DisplacementL',
  enginePowerKw: 'EngineKW',
  transmission: 'TransmissionStyle',
  manufacturer: 'Manufacturer',
  plantCountry: 'PlantCountry',
  vehicleType: 'VehicleType'
};

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  if (!normalized || /^(null|not applicable|n\/a)$/i.test(normalized)) return undefined;
  return normalized;
}

function cleanNumber(value: unknown): number | undefined {
  const stringValue = cleanString(value);
  if (!stringValue) return undefined;
  const parsed = Number(stringValue.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function mapNhtsaResult(result: NhtsaFlatResult): NhtsaMappedSpecs {
  const modelYear = cleanNumber(result.ModelYear);
  const engineKw = cleanNumber(result.EngineKW);
  const engineHp = cleanNumber(result.EngineHP);
  const inferredKw = engineKw ?? (engineHp != null ? Math.round(engineHp * 0.745699872 * 10) / 10 : undefined);

  return {
    make: cleanString(result.Make),
    model: cleanString(result.Model),
    modelYear: modelYear != null && Number.isInteger(modelYear) && modelYear >= 1886 && modelYear <= new Date().getUTCFullYear() + 2
      ? modelYear
      : undefined,
    bodyClass: cleanString(result.BodyClass),
    fuelType: cleanString(result.FuelTypePrimary),
    engineDisplacement: cleanNumber(result.DisplacementL),
    enginePowerKw: inferredKw,
    transmission: cleanString(result.TransmissionStyle),
    manufacturer: cleanString(result.Manufacturer),
    plantCountry: cleanString(result.PlantCountry),
    vehicleType: cleanString(result.VehicleType)
  };
}

function hasDecodedValues(mapped: NhtsaMappedSpecs): boolean {
  return Object.values(mapped).some((value) => value !== undefined && value !== null && value !== '');
}

async function ensureNhtsaSource() {
  const source = await db.dataSource.upsert({
    where: { key: NHTSA_SOURCE_KEY },
    update: {
      name: 'NHTSA vPIC',
      active: true,
      description: 'NHTSA Product Information Catalog / Vehicle Listing. Technische Identifikations- und Stammdaten, keine Unfallhistorie.'
    },
    create: {
      key: NHTSA_SOURCE_KEY,
      name: 'NHTSA vPIC',
      active: true,
      description: 'NHTSA Product Information Catalog / Vehicle Listing. Technische Identifikations- und Stammdaten, keine Unfallhistorie.'
    }
  });

  const existingLicense = await db.sourceLicense.findFirst({
    where: { sourceId: source.id, licenseName: 'NHTSA Open Data / vPIC public API' }
  });

  if (!existingLicense) {
    await db.sourceLicense.create({
      data: {
        sourceId: source.id,
        licenseName: 'NHTSA Open Data / vPIC public API',
        termsUrl: 'https://vpic.nhtsa.dot.gov/api/Home/Index/faq',
        canStore: true,
        canRedistribute: true,
        canCommercialize: true,
        retentionDays: null,
        reviewedAt: new Date(),
        notes: 'NHTSA vPIC FAQ: öffentliche Open-Data-API, keine Registrierung oder Lizenzanforderung. Stammdaten bleiben als NHTSA-Herkunft gekennzeichnet.'
      }
    });
  }

  return source;
}

async function fetchNhtsaFlatResult(vin: string): Promise<NhtsaFlatResult> {
  const limited = rateLimit('nhtsa-vpic:global', 500, 60_000);
  if (!limited.allowed) throw new Error('NHTSA_RATE_LIMITED');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`,
      { signal: controller.signal, headers: { accept: 'application/json' }, cache: 'no-store' }
    );
    if (!response.ok) throw new Error(`NHTSA_HTTP_${response.status}`);

    const payload = await response.json() as { Results?: unknown[] };
    const first = Array.isArray(payload.Results) ? payload.Results[0] : null;
    if (!first || typeof first !== 'object') throw new Error('NHTSA_INVALID_RESPONSE');
    return first as NhtsaFlatResult;
  } finally {
    clearTimeout(timeout);
  }
}

export async function decodeVinWithNhtsa(rawVin: string): Promise<{ mapped: NhtsaMappedSpecs; cached: boolean }> {
  const vin = normalizeVin(rawVin);
  if (!isValidVin(vin)) throw new Error('INVALID_VIN');

  const cached = await db.vinDecodeCache.findUnique({ where: { vin } });
  if (cached && cached.expiresAt > new Date()) {
    return { mapped: mapNhtsaResult(cached.payload as NhtsaFlatResult), cached: true };
  }

  const flat = await fetchNhtsaFlatResult(vin);
  await db.vinDecodeCache.upsert({
    where: { vin },
    update: {
      payload: flat as Prisma.InputJsonValue,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + NHTSA_CACHE_TTL_MS)
    },
    create: {
      vin,
      payload: flat as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + NHTSA_CACHE_TTL_MS)
    }
  });

  return { mapped: mapNhtsaResult(flat), cached: false };
}

export async function hydrateVehicleFromNhtsa(rawVin: string) {
  const vin = normalizeVin(rawVin);
  if (!isValidVin(vin)) throw new Error('INVALID_VIN');

  const { mapped } = await decodeVinWithNhtsa(vin);
  if (!hasDecodedValues(mapped)) return null;

  const source = await ensureNhtsaSource();
  const current = await db.vehicle.findUnique({ where: { vin } });
  const baseData = {
    make: mapped.make,
    model: mapped.model,
    modelYear: mapped.modelYear,
    bodyClass: mapped.bodyClass,
    fuelType: mapped.fuelType,
    engineDisplacement: mapped.engineDisplacement,
    enginePowerKw: mapped.enginePowerKw,
    transmission: mapped.transmission,
    manufacturer: mapped.manufacturer,
    plantCountry: mapped.plantCountry,
    vehicleType: mapped.vehicleType
  };

  const vehicle = current
    ? await db.vehicle.update({
        where: { id: current.id },
        data: Object.fromEntries(
          Object.entries(baseData).filter(([key, value]) => value !== undefined && current[key as keyof typeof current] == null)
        ) as Prisma.VehicleUpdateInput
      })
    : await db.vehicle.create({ data: { vin, ...baseData } });

  const writes = Object.entries(mapped)
    .filter((entry): entry is [keyof NhtsaMappedSpecs, string | number] => entry[1] !== undefined)
    .map(([field, value]) => db.vehicleAttribute.upsert({
      where: { vehicleId_sourceId_field: { vehicleId: vehicle.id, sourceId: source.id, field } },
      update: {
        value: String(value),
        sourceField: FIELD_SOURCES[field],
        rawValue: String(value),
        quality: 'VERIFIED',
        fetchedAt: new Date()
      },
      create: {
        vehicleId: vehicle.id,
        sourceId: source.id,
        field,
        value: String(value),
        sourceField: FIELD_SOURCES[field],
        rawValue: String(value),
        quality: 'VERIFIED'
      }
    }));

  if (writes.length > 0) await db.$transaction(writes);
  return vehicle;
}
