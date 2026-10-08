import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { runVehicleProviders } from '@/lib/providers/orchestrator';
import type { VehicleDataProvider } from '@/lib/providers/types';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const VIN_A = 'WBA12345678901234';
const VIN_B = 'WBA12345678901235';
const FRESHNESS_SOURCE = 'ci-freshness-provider';
const MARKET_SOURCE = 'ci-market-provider';

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
  await db.vehicle.deleteMany({ where: { vin: { in: [VIN_A, VIN_B] } } });
}

afterEach(async () => {
  if (process.env.DATABASE_URL) await cleanup();
});

describeDb('Phase 4.1 provider freshness and coverage health', () => {
  it('applies freshness per VIN instead of suppressing another VIN lookup', async () => {
    await cleanup();
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

  it('updates lastSuccessfulAt only for the coverage market that was actually eligible', async () => {
    await cleanup();
    const provider: VehicleDataProvider = {
      key: MARKET_SOURCE,
      name: 'CI Market Provider',
      description: 'Market coverage health test provider',
      capabilities: ['VEHICLE_SPECS'],
      authType: 'NONE',
      mappingVersion: 'market-v1',
      coverage: [
        { market: 'DE', capabilities: ['VEHICLE_SPECS'], status: 'LIVE' },
        { market: 'GB', capabilities: ['VEHICLE_SPECS'], status: 'LIVE' }
      ],
      async lookup() {
        return { cached: false, availability: 'NO_DATA', attributes: [], events: [] };
      }
    };

    const outcome = await runVehicleProviders(VIN_A, { providers: [provider], market: 'DE' });
    expect(outcome[0]).toMatchObject({ status: 'NO_DATA', market: 'DE' });

    const source = await db.dataSource.findUniqueOrThrow({ where: { key: MARKET_SOURCE } });
    const coverage = await db.providerCoverage.findMany({ where: { sourceId: source.id } });
    const de = coverage.find((item) => item.market === 'DE');
    const gb = coverage.find((item) => item.market === 'GB');

    expect(de?.lastSuccessfulAt).not.toBeNull();
    expect(gb?.lastSuccessfulAt).toBeNull();
  });
});
