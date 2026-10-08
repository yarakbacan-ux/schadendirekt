import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { getVehicleReport } from '@/lib/report';
import { registerProvider } from '@/lib/providers/registry';
import type { VehicleDataProvider } from '@/lib/providers/types';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const GLOBAL_KEY = 'report-market-provider';
const REGIONAL_KEY = 'report-gb-provider';
const PROVENANCE_KEY = 'report-market-provenance';
const VIN_UNKNOWN = 'WBA12345678901237';
const VIN_GB = 'WBA12345678901238';
const VIN_DE = 'WBA12345678901239';
const disposers: Array<() => void> = [];

async function removeSource(key: string) {
  const source = await db.dataSource.findUnique({ where: { key } });
  if (!source) return;
  await db.vehicleEvent.deleteMany({ where: { sourceId: source.id } });
  await db.vehicleAttribute.deleteMany({ where: { sourceId: source.id } });
  await db.importJob.deleteMany({ where: { sourceId: source.id } });
  await db.sourceLicense.deleteMany({ where: { sourceId: source.id } });
  await db.sourceContract.deleteMany({ where: { sourceId: source.id } });
  await db.providerRun.deleteMany({ where: { sourceId: source.id } });
  await db.dataSource.delete({ where: { id: source.id } });
}

async function cleanup() {
  while (disposers.length) disposers.pop()?.();
  for (const key of [GLOBAL_KEY, REGIONAL_KEY, PROVENANCE_KEY]) await removeSource(key);
  await db.vehicle.deleteMany({ where: { vin: { in: [VIN_UNKNOWN, VIN_GB, VIN_DE] } } });
}

async function licensedSource(key: string) {
  const source = await db.dataSource.upsert({ where: { key }, update: {}, create: { key, name: key } });
  await db.sourceLicense.create({
    data: {
      sourceId: source.id,
      licenseName: 'CI reviewed rights',
      canStore: true,
      canRedistribute: true,
      canCommercialize: true,
      reviewedAt: new Date(),
      reviewedBy: 'CI'
    }
  });
  return source;
}

function regionalProvider(onLookup: () => void): VehicleDataProvider {
  return {
    key: REGIONAL_KEY,
    name: 'GB-only test provider',
    description: 'Market-specific test provider',
    capabilities: ['REGISTRATION'],
    mappingVersion: 'gb-test-v1',
    coverage: [{ market: 'GB', capabilities: ['REGISTRATION'], status: 'LIVE', requirements: ['LICENSE'] }],
    async lookup() {
      onLookup();
      return { cached: false, availability: 'NO_DATA', attributes: [], events: [] };
    }
  };
}

function marketProvider(market: 'GB' | 'DE'): VehicleDataProvider {
  return {
    key: GLOBAL_KEY,
    name: 'Provenance market test provider',
    description: 'Global provider returning a source-backed market attribute',
    capabilities: ['VEHICLE_SPECS'],
    mappingVersion: 'market-test-v1',
    coverage: [{ market: '*', capabilities: ['VEHICLE_SPECS'], status: 'LIVE', allowUnknownMarket: true }],
    async lookup() {
      return {
        cached: false,
        availability: 'DATA',
        attributes: [{
          field: 'market',
          value: market,
          sourceField: 'registrationMarket',
          rawValue: market,
          quality: 'VERIFIED',
          fetchedAt: new Date()
        }],
        events: []
      };
    }
  };
}

afterEach(async () => {
  if (process.env.DATABASE_URL) await cleanup();
});

describeDb('dynamic report provider flow', () => {
  it('keeps a market-specific provider at MARKET_UNKNOWN when no reliable market provenance exists', async () => {
    await cleanup();
    let calls = 0;
    const regional = regionalProvider(() => { calls += 1; });
    disposers.push(registerProvider(regional));
    await licensedSource(REGIONAL_KEY);

    const report = await getVehicleReport(VIN_UNKNOWN, { providerKeys: [REGIONAL_KEY] });
    expect(calls).toBe(0);
    expect(report.coverage).toContainEqual(expect.objectContaining({
      providerKey: REGIONAL_KEY,
      state: 'SKIPPED',
      reason: 'MARKET_UNKNOWN'
    }));
  });

  it('runs a newly registered market-specific provider after a global provider stores verified GB provenance', async () => {
    await cleanup();
    let regionalCalls = 0;
    const global = marketProvider('GB');
    const regional = regionalProvider(() => { regionalCalls += 1; });
    disposers.push(registerProvider(global), registerProvider(regional));
    await licensedSource(GLOBAL_KEY);
    await licensedSource(REGIONAL_KEY);

    const report = await getVehicleReport(VIN_GB, { providerKeys: [GLOBAL_KEY, REGIONAL_KEY] });
    expect(regionalCalls).toBe(1);
    expect(report.vehicle.market).toBe('GB');
    expect(report.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerKey: GLOBAL_KEY, state: 'DATA' }),
      expect.objectContaining({ providerKey: REGIONAL_KEY, state: 'NO_DATA', market: 'GB' })
    ]));
  });

  it('uses only provenance-backed DE market data and marks a GB provider NOT_APPLICABLE', async () => {
    await cleanup();
    let calls = 0;
    const regional = regionalProvider(() => { calls += 1; });
    disposers.push(registerProvider(regional));
    await licensedSource(REGIONAL_KEY);
    const provenanceSource = await licensedSource(PROVENANCE_KEY);
    const vehicle = await db.vehicle.create({ data: { vin: VIN_DE, market: 'DE' } });
    await db.vehicleAttribute.create({
      data: {
        vehicleId: vehicle.id,
        sourceId: provenanceSource.id,
        field: 'market',
        value: 'DE',
        sourceField: 'registrationMarket',
        quality: 'VERIFIED',
        mappingVersion: 'fixture-v1'
      }
    });

    const report = await getVehicleReport(VIN_DE, { providerKeys: [REGIONAL_KEY] });
    expect(calls).toBe(0);
    expect(report.coverage).toContainEqual(expect.objectContaining({
      providerKey: REGIONAL_KEY,
      state: 'NOT_APPLICABLE',
      reason: 'MARKET_NOT_COVERED',
      market: 'DE'
    }));
  });
});
