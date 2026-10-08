import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { runVehicleProviders } from '@/lib/providers/orchestrator';
import type { VehicleDataProvider } from '@/lib/providers/types';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const VIN_A = 'WBA12345678901234';
const VIN_B = 'WBA12345678901235';
const FRESHNESS_SOURCE = 'ci-freshness-provider';
const MARKET_SOURCE = 'ci-market-provider';
const CAPABILITY_SOURCE = 'ci-capability-freshness-provider';

async function cleanupSource(key: string) {
  const source = await db.dataSource.findUnique({ where: { key } });
  if (!source) return;
  await db.providerRun.deleteMany({ where: { sourceId: source.id } });
  await db.providerCoverage.deleteMany({ where: { sourceId: source.id } });
  await db.sourceLicense.deleteMany({ where: { sourceId: source.id } });
  await db.vehicleEvent.deleteMany({ where: { sourceId: source.id } });
  await db.vehicleAttribute.deleteMany({ where: { sourceId: source.id } });
  await db.dataSource.delete({ where: { id: source.id } });
}

async function cleanup() {
  await cleanupSource(FRESHNESS_SOURCE);
  await cleanupSource(MARKET_SOURCE);
  await cleanupSource(CAPABILITY_SOURCE);
  await db.vehicle.deleteMany({ where: { vin: { in: [VIN_A, VIN_B] } } });
}

async function approveCommercialSource(key: string) {
  const source = await db.dataSource.upsert({ where: { key }, update: {}, create: { key, name: key } });
  await db.sourceLicense.create({
    data: {
      sourceId: source.id,
      licenseName: 'CI reviewed provider rights',
      canStore: true,
      canRedistribute: true,
      canCommercialize: true,
      reviewedAt: new Date(),
      reviewedBy: 'CI'
    }
  });
  return source;
}

afterEach(async () => {
  if (process.env.DATABASE_URL) await cleanup();
});

describeDb('Phase 4.3 provider freshness and coverage health', () => {
  it('applies freshness per provider and VIN instead of suppressing another VIN lookup', async () => {
    await cleanup();
    await approveCommercialSource(FRESHNESS_SOURCE);
    let calls = 0;
    const provider: VehicleDataProvider = {
      key: FRESHNESS_SOURCE,
      name: 'CI Freshness Provider',
      description: 'Freshness scope test provider',
      capabilities: ['VEHICLE_SPECS'],
      authType: 'NONE',
      mappingVersion: 'freshness-v1',
      refreshPolicy: { mode: 'CACHE', maxAgeSeconds: 3600 },
      coverage: [{ market: '*', capabilities: ['VEHICLE_SPECS'], status: 'LIVE', allowUnknownMarket: true }],
      async lookup() {
        calls += 1;
        return { cached: false, availability: 'NO_DATA', attributes: [], events: [] };
      }
    };

    const first = await runVehicleProviders(VIN_A, { providers: [provider] });
    const repeated = await runVehicleProviders(VIN_A, { providers: [provider] });
    const otherVin = await runVehicleProviders(VIN_B, { providers: [provider] });

    expect(first[0]).toMatchObject({ status: 'NO_DATA' });
    expect(repeated[0]).toMatchObject({ status: 'SKIPPED', decisionReason: 'FRESH_DATA' });
    expect(otherVin[0]).toMatchObject({ status: 'NO_DATA' });
    expect(calls).toBe(2);
  });

  it('scopes freshness to VIN + market + mapping version', async () => {
    await cleanup();
    const source = await approveCommercialSource(FRESHNESS_SOURCE);
    let calls = 0;
    const provider: VehicleDataProvider = {
      key: FRESHNESS_SOURCE,
      name: 'CI Scoped Freshness Provider',
      description: 'Market and mapping freshness scope',
      capabilities: ['VEHICLE_SPECS'],
      mappingVersion: 'map-v1',
      refreshPolicy: { mode: 'CACHE', maxAgeSeconds: 3600 },
      coverage: [
        { market: 'DE', capabilities: ['VEHICLE_SPECS'], status: 'LIVE', freshnessSeconds: 3600 },
        { market: 'GB', capabilities: ['VEHICLE_SPECS'], status: 'LIVE', freshnessSeconds: 3600 }
      ],
      async lookup() {
        calls += 1;
        return { cached: false, availability: 'NO_DATA', attributes: [], events: [] };
      }
    };

    await runVehicleProviders(VIN_A, { providers: [provider], market: 'DE' });
    expect((await runVehicleProviders(VIN_A, { providers: [provider], market: 'DE' }))[0]).toMatchObject({ decisionReason: 'FRESH_DATA' });
    expect((await runVehicleProviders(VIN_A, { providers: [provider], market: 'GB' }))[0]).toMatchObject({ status: 'NO_DATA' });

    await db.providerCoverage.updateMany({ where: { sourceId: source.id, market: 'DE' }, data: { mappingVersion: 'map-v2' } });
    expect((await runVehicleProviders(VIN_A, { providers: [provider], market: 'DE' }))[0]).toMatchObject({ status: 'NO_DATA' });
    expect(calls).toBe(3);
  });

  it('keeps freshness independent per capability within the same market', async () => {
    await cleanup();
    await approveCommercialSource(CAPABILITY_SOURCE);
    const calls: string[][] = [];
    const provider: VehicleDataProvider = {
      key: CAPABILITY_SOURCE,
      name: 'CI Capability Freshness Provider',
      description: 'Per capability freshness',
      capabilities: ['VEHICLE_SPECS', 'ODOMETER'],
      mappingVersion: 'cap-v1',
      coverage: [
        { market: 'DE', capabilities: ['VEHICLE_SPECS'], status: 'LIVE', freshnessSeconds: 3600 },
        { market: 'DE', capabilities: ['ODOMETER'], status: 'LIVE', freshnessSeconds: 0 }
      ],
      async lookup(_vin, context) {
        calls.push([...context.capabilities]);
        return { cached: false, availability: 'NO_DATA', attributes: [], events: [] };
      }
    };

    await runVehicleProviders(VIN_A, { providers: [provider], market: 'DE' });
    const second = await runVehicleProviders(VIN_A, { providers: [provider], market: 'DE' });
    expect(second[0]).toMatchObject({ status: 'NO_DATA', capabilities: ['ODOMETER'] });
    expect(calls).toEqual([['VEHICLE_SPECS', 'ODOMETER'], ['ODOMETER']]);
  });

  it('updates lastSuccessfulAt only for the coverage market and capability actually called', async () => {
    await cleanup();
    await approveCommercialSource(MARKET_SOURCE);
    const provider: VehicleDataProvider = {
      key: MARKET_SOURCE,
      name: 'CI Market Provider',
      description: 'Market coverage health test provider',
      capabilities: ['VEHICLE_SPECS', 'ODOMETER'],
      authType: 'NONE',
      mappingVersion: 'market-v1',
      coverage: [
        { market: 'DE', capabilities: ['VEHICLE_SPECS'], status: 'LIVE' },
        { market: 'DE', capabilities: ['ODOMETER'], status: 'UNAVAILABLE' },
        { market: 'GB', capabilities: ['VEHICLE_SPECS'], status: 'LIVE' }
      ],
      async lookup() { return { cached: false, availability: 'NO_DATA', attributes: [], events: [] }; }
    };

    const outcome = await runVehicleProviders(VIN_A, { providers: [provider], market: 'DE' });
    expect(outcome[0]).toMatchObject({ status: 'NO_DATA', market: 'DE', capabilities: ['VEHICLE_SPECS'] });

    const source = await db.dataSource.findUniqueOrThrow({ where: { key: MARKET_SOURCE } });
    const coverage = await db.providerCoverage.findMany({ where: { sourceId: source.id } });
    expect(coverage.find((item) => item.market === 'DE' && item.capability === 'VEHICLE_SPECS')?.lastSuccessfulAt).not.toBeNull();
    expect(coverage.find((item) => item.market === 'DE' && item.capability === 'ODOMETER')?.lastSuccessfulAt).toBeNull();
    expect(coverage.find((item) => item.market === 'GB' && item.capability === 'VEHICLE_SPECS')?.lastSuccessfulAt).toBeNull();
  });
});
