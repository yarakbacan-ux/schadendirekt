import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { InMemoryRateLimitStore, setRateLimitStore } from '@/lib/rate-limit';
import { runVehicleProviders } from '@/lib/providers/orchestrator';
import type { VehicleDataProvider } from '@/lib/providers/types';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const KEY = 'ci-central-rate-provider';
const VIN_A = 'WBA12345678901243';
const VIN_B = 'WBA12345678901244';

async function cleanup() {
  const source = await db.dataSource.findUnique({ where: { key: KEY } });
  if (source) {
    await db.providerRun.deleteMany({ where: { sourceId: source.id } });
    await db.sourceLicense.deleteMany({ where: { sourceId: source.id } });
    await db.dataSource.delete({ where: { id: source.id } });
  }
  await db.vehicle.deleteMany({ where: { vin: { in: [VIN_A, VIN_B] } } });
  setRateLimitStore(new InMemoryRateLimitStore());
}

afterEach(async () => {
  if (process.env.DATABASE_URL) await cleanup();
});

describeDb('central provider rate limit', () => {
  it('blocks lookup in the orchestrator after the configured provider budget is consumed', async () => {
    await cleanup();
    const source = await db.dataSource.create({ data: { key: KEY, name: KEY } });
    await db.sourceLicense.create({
      data: {
        sourceId: source.id,
        licenseName: 'Reviewed rate-limit fixture',
        canStore: true,
        canRedistribute: true,
        canCommercialize: true,
        reviewedAt: new Date(),
        reviewedBy: 'CI'
      }
    });
    let calls = 0;
    const provider: VehicleDataProvider = {
      key: KEY,
      name: 'Rate Provider',
      description: 'Central rate limit fixture',
      capabilities: ['VEHICLE_SPECS'],
      mappingVersion: 'rate-v1',
      rateLimit: { requestsPerMinute: 1 },
      coverage: [{ market: '*', capabilities: ['VEHICLE_SPECS'], status: 'LIVE', allowUnknownMarket: true, freshnessSeconds: 0 }],
      async lookup() {
        calls += 1;
        return { cached: false, availability: 'NO_DATA', attributes: [], events: [] };
      }
    };

    const first = await runVehicleProviders(VIN_A, { providers: [provider] });
    const second = await runVehicleProviders(VIN_B, { providers: [provider] });
    expect(first[0]).toMatchObject({ status: 'NO_DATA' });
    expect(second[0]).toMatchObject({ status: 'SKIPPED', decisionReason: 'RATE_LIMITED' });
    expect(second[0]?.retryAfterSeconds).toBeGreaterThan(0);
    expect(calls).toBe(1);
  });
});
