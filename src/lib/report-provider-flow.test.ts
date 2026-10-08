import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { getVehicleReport } from '@/lib/report';
import { registerProvider } from '@/lib/providers/registry';
import type { VehicleDataProvider } from '@/lib/providers/types';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const GLOBAL_KEY = 'report-market-provider';
const REGIONAL_KEY = 'report-gb-provider';
const PROVENANCE_KEY = 'report-market-provenance';
const EPHEMERAL_KEY = 'report-commercial-no-store';
const VIN_UNKNOWN = 'WBA12345678901237';
const VIN_GB = 'WBA12345678901238';
const VIN_DE = 'WBA12345678901239';
const VIN_EPHEMERAL = 'WBA12345678901240';
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
  for (const key of [GLOBAL_KEY, REGIONAL_KEY, PROVENANCE_KEY, EPHEMERAL_KEY]) await removeSource(key);
  await db.vehicle.deleteMany({ where: { vin: { in: [VIN_UNKNOWN, VIN_GB, VIN_DE, VIN_EPHEMERAL] } } });
}

async function licensedSource(key: string, canStore = true) {
  const source = await db.dataSource.upsert({ where: { key }, update: {}, create: { key, name: key } });
  await db.sourceLicense.create({
    data: {
      sourceId: source.id,
      licenseName: 'CI reviewed rights',
      canStore,
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
        attributes: [{ field: 'market', value: market, sourceField: 'registrationMarket', rawValue: market, quality: 'VERIFIED', fetchedAt: new Date() }],
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
    expect(report.coverage).toContainEqual(expect.objectContaining({ providerKey: REGIONAL_KEY, state: 'SKIPPED', reason: 'MARKET_UNKNOWN' }));
  });

  it('runs a regional provider after a global provider returns one verified market in the same request', async () => {
    await cleanup();
    let regionalCalls = 0;
    const global = marketProvider('GB');
    const regional = regionalProvider(() => { regionalCalls += 1; });
    disposers.push(registerProvider(global), registerProvider(regional));
    await licensedSource(GLOBAL_KEY);
    await licensedSource(REGIONAL_KEY);

    const report = await getVehicleReport(VIN_GB, { providerKeys: [GLOBAL_KEY, REGIONAL_KEY] });
    const reportVehicle = report.vehicle as Record<string, unknown>;
    expect(regionalCalls).toBe(1);
    expect(reportVehicle.market).toBe('GB');
    expect(report.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerKey: GLOBAL_KEY, state: 'DATA' }),
      expect.objectContaining({ providerKey: REGIONAL_KEY, state: 'NO_DATA', market: 'GB' })
    ]));
  });

  it('accepts an explicitly trusted market hint and never uses an untrusted hint', async () => {
    await cleanup();
    let trustedCalls = 0;
    const regional = regionalProvider(() => { trustedCalls += 1; });
    disposers.push(registerProvider(regional));
    await licensedSource(REGIONAL_KEY);

    const untrusted = await getVehicleReport(VIN_UNKNOWN, {
      providerKeys: [REGIONAL_KEY],
      marketHint: { market: 'GB', trusted: false, provenance: 'untrusted-client-input' }
    });
    expect(trustedCalls).toBe(0);
    expect(untrusted.coverage).toContainEqual(expect.objectContaining({ providerKey: REGIONAL_KEY, reason: 'MARKET_UNKNOWN' }));

    const trusted = await getVehicleReport(VIN_UNKNOWN, {
      providerKeys: [REGIONAL_KEY],
      marketHint: { market: 'GB', trusted: true, provenance: 'server-verified-registration' }
    });
    expect(trustedCalls).toBe(1);
    expect(trusted.coverage).toContainEqual(expect.objectContaining({ providerKey: REGIONAL_KEY, state: 'NO_DATA', market: 'GB' }));
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
    expect(report.coverage).toContainEqual(expect.objectContaining({ providerKey: REGIONAL_KEY, state: 'NOT_APPLICABLE', reason: 'MARKET_NOT_COVERED', market: 'DE' }));
  });

  it('uses COMMERCIALIZE-only live data in the report without persisting it', async () => {
    await cleanup();
    const ephemeral: VehicleDataProvider = {
      key: EPHEMERAL_KEY,
      name: 'Commercial no-store provider',
      description: 'Fixture for transient report data',
      capabilities: ['VEHICLE_SPECS'],
      mappingVersion: 'ephemeral-v1',
      coverage: [{ market: '*', capabilities: ['VEHICLE_SPECS'], status: 'LIVE', allowUnknownMarket: true }],
      async lookup() {
        return {
          cached: false,
          availability: 'DATA',
          attributes: [{ field: 'make', value: 'TRANSIENT', sourceField: 'make', quality: 'VERIFIED', fetchedAt: new Date() }],
          events: []
        };
      }
    };
    disposers.push(registerProvider(ephemeral));
    await licensedSource(EPHEMERAL_KEY, false);

    const report = await getVehicleReport(VIN_EPHEMERAL, { providerKeys: [EPHEMERAL_KEY] });
    expect(report.status).toBe('DATA_AVAILABLE');
    expect((report.vehicle as Record<string, unknown>).make).toBe('TRANSIENT');
    expect(report.coverage).toContainEqual(expect.objectContaining({ providerKey: EPHEMERAL_KEY, state: 'DATA' }));

    const source = await db.dataSource.findUniqueOrThrow({ where: { key: EPHEMERAL_KEY } });
    expect(await db.vehicleAttribute.count({ where: { sourceId: source.id } })).toBe(0);
    expect(await db.vehicleEvent.count({ where: { sourceId: source.id } })).toBe(0);
  });
});
