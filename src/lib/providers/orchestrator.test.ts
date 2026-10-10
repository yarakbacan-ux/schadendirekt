import { afterEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { runVehicleProviders } from '@/lib/providers/orchestrator';
import type { VehicleDataProvider } from '@/lib/providers/types';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const VIN = 'WBA12345678901234';
const SOURCE_KEY = 'ci-provider';
const CONTRACT_SOURCE_KEY = 'ci-contract-provider';

const provider: VehicleDataProvider = {
  key: SOURCE_KEY,
  name: 'CI Provider',
  description: 'Test provider',
  capabilities: ['VEHICLE_SPECS', 'ODOMETER'],
  authType: 'NONE',
  mappingVersion: 'ci-map-v1',
  coverage: [{ market: '*', capabilities: ['VEHICLE_SPECS', 'ODOMETER'], status: 'LIVE', allowUnknownMarket: true }],
  async lookup() {
    return {
      cached: false,
      availability: 'DATA',
      attributes: [{ field: 'make', value: 'BMW', sourceField: 'brand', rawValue: 'BMW', capability: 'VEHICLE_SPECS', quality: 'VERIFIED', fetchedAt: new Date('2026-01-01') }],
      events: [{ externalId: 'odo-1', eventType: 'ODOMETER_READING', eventDate: new Date('2025-01-01'), mileageKm: 12_345, title: 'Kilometerstand', quality: 'VERIFIED' }]
    };
  }
};

const contractProvider: VehicleDataProvider = {
  key: CONTRACT_SOURCE_KEY,
  name: 'CI Contract Provider',
  description: 'Provider requiring independent license and contract gates',
  capabilities: ['REGISTRATION'],
  authType: 'CONTRACT',
  mappingVersion: 'contract-map-v1',
  coverage: [{ market: 'DE', capabilities: ['REGISTRATION'], status: 'LIVE', requirements: ['LICENSE', 'CONTRACT'] }],
  async lookup() { return { cached: false, availability: 'NO_DATA', attributes: [], events: [] }; }
};

async function cleanupSource(key: string) {
  const source = await db.dataSource.findUnique({ where: { key } });
  if (!source) return;
  await db.vehicleEvent.deleteMany({ where: { sourceId: source.id } });
  await db.vehicleAttribute.deleteMany({ where: { sourceId: source.id } });
  await db.sourceLicense.deleteMany({ where: { sourceId: source.id } });
  await db.sourceContract.deleteMany({ where: { sourceId: source.id } });
  await db.providerRun.deleteMany({ where: { sourceId: source.id } });
  await db.dataSource.delete({ where: { id: source.id } });
}

async function cleanup() {
  await cleanupSource(SOURCE_KEY);
  await cleanupSource(CONTRACT_SOURCE_KEY);
  await db.vehicle.deleteMany({ where: { vin: VIN } });
}

async function createLicense(key: string, canStore = true) {
  const source = await db.dataSource.upsert({ where: { key }, update: {}, create: { key, name: key } });
  await db.sourceLicense.create({
    data: {
      sourceId: source.id,
      licenseName: 'CI reviewed license',
      canStore,
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

describeDb('provider orchestrator persistence policy', () => {
  it('returns commercially licensed live data without persisting when STORE is forbidden', async () => {
    await cleanup();
    await createLicense(SOURCE_KEY, false);
    const outcome = await runVehicleProviders(VIN, { providers: [provider], origin: 'PUBLIC_LOOKUP' });

    expect(outcome[0]).toMatchObject({ status: 'SUCCESS', persisted: false });
    expect(outcome[0]?.attributes).toHaveLength(1);
    expect(outcome[0]?.events).toHaveLength(1);
    expect(await db.vehicle.count({ where: { vin: VIN } })).toBe(1);
    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { vin: VIN }, include: { attributes: true, events: true } });
    expect(vehicle.make).toBeNull();
    expect(vehicle.attributes).toHaveLength(0);
    expect(vehicle.events).toHaveLength(0);
  });

  it('persists only STORE capabilities while returning COMMERCIALIZE-only capability data transiently', async () => {
    await cleanup();
    const source = await db.dataSource.create({ data: { key: SOURCE_KEY, name: SOURCE_KEY } });
    await db.sourceLicense.createMany({ data: [
      {
        sourceId: source.id,
        licenseName: 'Specs storage only',
        canStore: true,
        canRedistribute: false,
        canCommercialize: false,
        capabilities: ['VEHICLE_SPECS'],
        reviewedAt: new Date(),
        reviewedBy: 'CI'
      },
      {
        sourceId: source.id,
        licenseName: 'Odometer commercial only',
        canStore: false,
        canRedistribute: true,
        canCommercialize: true,
        capabilities: ['ODOMETER'],
        reviewedAt: new Date(),
        reviewedBy: 'CI'
      }
    ] });

    const outcome = await runVehicleProviders(VIN, { providers: [provider], origin: 'PUBLIC_LOOKUP' });
    expect(outcome[0]).toMatchObject({ status: 'SUCCESS', persisted: true });
    expect(outcome[0]?.attributes).toHaveLength(0);
    expect(outcome[0]?.events).toHaveLength(1);
    expect(outcome[0]?.events[0]).toMatchObject({ eventType: 'ODOMETER_READING', mileageKm: 12_345 });

    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { vin: VIN }, include: { attributes: true, events: true } });
    expect(vehicle.make).toBe('BMW');
    expect(vehicle.attributes).toHaveLength(1);
    expect(vehicle.attributes[0]).toMatchObject({ field: 'make', capability: 'VEHICLE_SPECS' });
    expect(vehicle.events).toHaveLength(0);
  });

  it('persists normalized data with mapping version and coverage after an explicit storage license exists', async () => {
    await cleanup();
    await createLicense(SOURCE_KEY, true);
    const outcome = await runVehicleProviders(VIN, { providers: [provider] });
    expect(outcome[0]?.status).toBe('SUCCESS');
    expect(outcome[0]?.mappingVersion).toBe('ci-map-v1');
    expect(outcome[0]?.persisted).toBe(true);

    const source = await db.dataSource.findUniqueOrThrow({ where: { key: SOURCE_KEY } });
    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { vin: VIN }, include: { attributes: true, events: true } });
    expect(vehicle.make).toBe('BMW');
    expect(vehicle.attributes).toHaveLength(1);
    expect(vehicle.attributes[0]).toMatchObject({ field: 'make', value: 'BMW', sourceField: 'brand', capability: 'VEHICLE_SPECS', mappingVersion: 'ci-map-v1' });
    expect(vehicle.events).toHaveLength(1);
    expect(vehicle.events[0]).toMatchObject({ eventType: 'ODOMETER_READING', mileageKm: 12_345, mappingVersion: 'ci-map-v1' });

    const coverage = await db.providerCoverage.findMany({ where: { sourceId: source.id } });
    expect(coverage).toHaveLength(2);
    expect(coverage.every((item) => item.mappingVersion === 'ci-map-v1')).toBe(true);
  });

  it('treats persisted DB coverage as operative source-of-truth and never re-enables an unavailable source', async () => {
    await cleanup();
    const source = await createLicense(SOURCE_KEY, true);
    await runVehicleProviders(VIN, { providers: [provider] });
    await db.providerCoverage.updateMany({ where: { sourceId: source.id }, data: { status: 'UNAVAILABLE' } });

    const outcome = await runVehicleProviders(VIN, { providers: [provider] });
    expect(outcome[0]).toMatchObject({ status: 'NOT_APPLICABLE', decisionReason: 'COVERAGE_UNAVAILABLE' });
    const coverage = await db.providerCoverage.findMany({ where: { sourceId: source.id } });
    expect(coverage).not.toHaveLength(0);
    expect(coverage.every((item) => item.status === 'UNAVAILABLE')).toBe(true);
  });

  it('requires an independently active contract and license when both are configured', async () => {
    await cleanup();
    const source = await createLicense(CONTRACT_SOURCE_KEY, true);
    const missingContract = await runVehicleProviders(VIN, { providers: [contractProvider], market: 'DE' });
    expect(missingContract[0]).toMatchObject({ status: 'SKIPPED', decisionReason: 'CONTRACT_REQUIRED' });

    await db.sourceContract.create({
      data: {
        sourceId: source.id,
        name: 'CI partner agreement',
        reference: 'CI-CONTRACT-1',
        active: true,
        reviewedAt: new Date(),
        reviewedBy: 'CI'
      }
    });
    const bothPresent = await runVehicleProviders(VIN, { providers: [contractProvider], market: 'DE' });
    expect(bothPresent[0]?.status).toBe('NO_DATA');

    await db.sourceLicense.deleteMany({ where: { sourceId: source.id } });
    const missingLicense = await runVehicleProviders(VIN, { providers: [contractProvider], market: 'DE' });
    expect(missingLicense[0]).toMatchObject({ status: 'SKIPPED', decisionReason: 'LICENSE_REQUIRED' });
  });

  it('records provider failure without inventing history when reviewed commercial rights exist', async () => {
    await cleanup();
    await createLicense(SOURCE_KEY, true);
    const failing: VehicleDataProvider = { ...provider, key: SOURCE_KEY, async lookup() { throw new Error('UPSTREAM_DOWN'); } };

    const outcome = await runVehicleProviders(VIN, { providers: [failing] });
    expect(outcome[0]).toMatchObject({ status: 'FAILED', errorCode: 'UPSTREAM_DOWN' });
    expect(await db.vehicleEvent.count({ where: { vehicle: { vin: VIN } } })).toBe(0);
    const source = await db.dataSource.findUniqueOrThrow({ where: { key: SOURCE_KEY } });
    const run = await db.providerRun.findFirstOrThrow({ where: { sourceId: source.id }, orderBy: { finishedAt: 'desc' } });
    expect(run.status).toBe('FAILED');
    expect(run.decisionReason).toBe('UPSTREAM_ERROR');
  });
});
