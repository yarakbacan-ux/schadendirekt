import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { runVehicleProviders } from '@/lib/providers/orchestrator';
import type { VehicleDataProvider } from '@/lib/providers/types';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const VIN = 'WBA12345678901234';
const SOURCE_KEY = 'ci-provider';

const provider: VehicleDataProvider = {
  key: SOURCE_KEY,
  name: 'CI Provider',
  description: 'Test provider',
  capabilities: ['VEHICLE_SPECS', 'ODOMETER'],
  authType: 'NONE',
  refreshPolicy: 'Always for test',
  rateLimitPolicy: 'None for test',
  mappingVersion: 'ci-map-v1',
  coverage: [{ marketCode: 'GLOBAL', capabilities: ['VEHICLE_SPECS', 'ODOMETER'], status: 'LIVE' }],
  mapping: { brand: 'make', mileage: 'mileageKm' },
  async lookup() {
    return {
      cached: false,
      attributes: [{
        field: 'make', value: 'BMW', sourceField: 'brand', rawValue: 'BMW', quality: 'VERIFIED', fetchedAt: new Date('2026-01-01')
      }],
      events: [{
        externalId: 'odo-1', eventType: 'ODOMETER_READING', eventDate: new Date('2025-01-01'), mileageKm: 12_345,
        title: 'Kilometerstand', quality: 'VERIFIED'
      }]
    };
  }
};

async function cleanup() {
  const source = await db.dataSource.findUnique({ where: { key: SOURCE_KEY } });
  if (source) await db.dataSource.delete({ where: { id: source.id } });
  await db.vehicle.deleteMany({ where: { vin: VIN } });
}

afterEach(async () => {
  if (process.env.DATABASE_URL) await cleanup();
});

describeDb('provider orchestrator persistence policy', () => {
  it('creates one canonical vehicle but blocks provider data storage without STORE rights', async () => {
    await cleanup();
    const outcome = await runVehicleProviders(VIN, { providers: [provider], origin: 'PUBLIC_LOOKUP' });
    expect(outcome[0]).toMatchObject({ status: 'SUCCESS', decision: 'DATA', mappingVersion: 'ci-map-v1' });

    expect(await db.vehicle.count({ where: { vin: VIN } })).toBe(1);
    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { vin: VIN }, include: { attributes: true, events: true } });
    expect(vehicle.make).toBeNull();
    expect(vehicle.attributes).toHaveLength(0);
    expect(vehicle.events).toHaveLength(0);

    const source = await db.dataSource.findUniqueOrThrow({ where: { key: SOURCE_KEY }, include: { coverages: true, mappings: true } });
    expect(source.coverages).toHaveLength(1);
    expect(source.coverages[0]).toMatchObject({ marketCode: 'GLOBAL', status: 'LIVE' });
    expect(source.mappings[0]?.version).toBe('ci-map-v1');
  });

  it('persists normalized attributes and events with their mapping version after explicit storage rights', async () => {
    await cleanup();
    await runVehicleProviders(VIN, { providers: [provider] });
    const source = await db.dataSource.findUniqueOrThrow({ where: { key: SOURCE_KEY } });
    await db.sourceLicense.create({
      data: {
        sourceId: source.id,
        licenseName: 'CI reviewed license',
        canStore: true,
        canRedistribute: true,
        canCommercialize: true,
        reviewedAt: new Date(),
        reviewedBy: 'CI'
      }
    });

    const outcome = await runVehicleProviders(VIN, { providers: [provider] });
    expect(outcome[0]).toMatchObject({ status: 'SUCCESS', decision: 'DATA', mappingVersion: 'ci-map-v1' });

    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { vin: VIN }, include: { attributes: true, events: true } });
    expect(vehicle.make).toBe('BMW');
    expect(vehicle.attributes[0]).toMatchObject({ field: 'make', value: 'BMW', sourceField: 'brand', mappingVersion: 'ci-map-v1' });
    expect(vehicle.events[0]).toMatchObject({ eventType: 'ODOMETER_READING', mileageKm: 12_345, mappingVersion: 'ci-map-v1' });
  });

  it('records provider failure without inventing history', async () => {
    await cleanup();
    const failing: VehicleDataProvider = {
      ...provider,
      async lookup() { throw new Error('UPSTREAM_DOWN'); }
    };

    const outcome = await runVehicleProviders(VIN, { providers: [failing] });
    expect(outcome[0]).toMatchObject({ status: 'FAILED', decision: 'ERROR', errorCode: 'UPSTREAM_DOWN' });
    expect(await db.vehicleEvent.count({ where: { vehicle: { vin: VIN } } })).toBe(0);
    const source = await db.dataSource.findUniqueOrThrow({ where: { key: SOURCE_KEY } });
    const run = await db.providerRun.findFirstOrThrow({ where: { sourceId: source.id }, orderBy: { finishedAt: 'desc' } });
    expect(run).toMatchObject({ status: 'FAILED', decisionReason: 'PROVIDER_ERROR', mappingVersion: 'ci-map-v1' });
  });
});
