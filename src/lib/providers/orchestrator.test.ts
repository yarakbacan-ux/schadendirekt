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
  if (source) {
    await db.vehicleEvent.deleteMany({ where: { sourceId: source.id } });
    await db.vehicleAttribute.deleteMany({ where: { sourceId: source.id } });
    await db.sourceLicense.deleteMany({ where: { sourceId: source.id } });
    await db.providerRun.deleteMany({ where: { sourceId: source.id } });
    await db.dataSource.delete({ where: { id: source.id } });
  }
  await db.vehicle.deleteMany({ where: { vin: VIN } });
}

afterEach(async () => {
  if (process.env.DATABASE_URL) await cleanup();
});

describeDb('provider orchestrator persistence policy', () => {
  it('creates one canonical vehicle but blocks provider data storage without STORE rights', async () => {
    await cleanup();
    await runVehicleProviders(VIN, { providers: [provider], origin: 'PUBLIC_LOOKUP' });
    await runVehicleProviders(VIN, { providers: [provider], origin: 'PUBLIC_LOOKUP' });

    expect(await db.vehicle.count({ where: { vin: VIN } })).toBe(1);
    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { vin: VIN }, include: { attributes: true, events: true } });
    expect(vehicle.make).toBeNull();
    expect(vehicle.attributes).toHaveLength(0);
    expect(vehicle.events).toHaveLength(0);
  });

  it('persists normalized attributes and events after an explicit storage license exists', async () => {
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
    expect(outcome[0]?.status).toBe('SUCCESS');

    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { vin: VIN }, include: { attributes: true, events: true } });
    expect(vehicle.make).toBe('BMW');
    expect(vehicle.attributes).toHaveLength(1);
    expect(vehicle.attributes[0]).toMatchObject({ field: 'make', value: 'BMW', sourceField: 'brand' });
    expect(vehicle.events).toHaveLength(1);
    expect(vehicle.events[0]).toMatchObject({ eventType: 'ODOMETER_READING', mileageKm: 12_345 });
  });

  it('records provider failure without inventing history', async () => {
    await cleanup();
    const failing: VehicleDataProvider = {
      ...provider,
      key: SOURCE_KEY,
      async lookup() { throw new Error('UPSTREAM_DOWN'); }
    };

    const outcome = await runVehicleProviders(VIN, { providers: [failing] });
    expect(outcome[0]).toMatchObject({ status: 'FAILED', errorCode: 'UPSTREAM_DOWN' });
    expect(await db.vehicleEvent.count({ where: { vehicle: { vin: VIN } } })).toBe(0);
    const source = await db.dataSource.findUniqueOrThrow({ where: { key: SOURCE_KEY } });
    const run = await db.providerRun.findFirstOrThrow({ where: { sourceId: source.id }, orderBy: { finishedAt: 'desc' } });
    expect(run.status).toBe('FAILED');
  });
});
