import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { hydrateVehicleFromNhtsa, NHTSA_SOURCE_KEY } from './nhtsa';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const VINS = ['WBA12345678901234', 'WVWZZZ1JZXW000001'];

async function cleanup() {
  const source = await db.dataSource.findUnique({ where: { key: NHTSA_SOURCE_KEY } });
  if (source) {
    await db.vehicleAttribute.deleteMany({ where: { sourceId: source.id } });
    await db.sourceLicense.deleteMany({ where: { sourceId: source.id } });
    await db.dataSource.deleteMany({ where: { id: source.id } });
  }
  await db.vinDecodeCache.deleteMany({ where: { vin: { in: VINS } } });
  await db.vehicle.deleteMany({ where: { vin: { in: VINS } } });
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (process.env.DATABASE_URL) await cleanup();
});

function mockNhtsa(make = 'BMW') {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    Results: [{ Make: make, Model: 'X5', ModelYear: '2021', VehicleType: 'MULTIPURPOSE PASSENGER VEHICLE (MPV)' }]
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
}

describeDb('NHTSA policy and public lookup persistence', () => {
  it('creates one canonical vehicle, persists provenance only with an explicit storage license and reuses cache', async () => {
    await cleanup();
    const source = await db.dataSource.create({
      data: { key: NHTSA_SOURCE_KEY, name: 'NHTSA vPIC', active: true }
    });
    await db.sourceLicense.create({
      data: {
        sourceId: source.id,
        licenseName: 'reviewed-test-license',
        termsUrl: 'https://example.test/reviewed-terms',
        canStore: true,
        canRedistribute: true,
        canCommercialize: true,
        reviewedAt: new Date(),
        reviewedBy: 'CI test',
        notes: 'Test-only reviewed license fixture'
      }
    });
    const fetchSpy = mockNhtsa();

    await hydrateVehicleFromNhtsa(VINS[0], 'PUBLIC_LOOKUP');
    await hydrateVehicleFromNhtsa(VINS[0], 'PUBLIC_LOOKUP');

    expect(await db.vehicle.count({ where: { vin: VINS[0] } })).toBe(1);
    const vehicle = await db.vehicle.findUniqueOrThrow({
      where: { vin: VINS[0] },
      include: { attributes: { include: { source: true } } }
    });
    expect(vehicle.origin).toBe('PUBLIC_LOOKUP');
    expect(vehicle.attributes.find((item) => item.field === 'make')).toMatchObject({
      value: 'BMW',
      sourceField: 'Make',
      quality: 'VERIFIED',
      source: { key: NHTSA_SOURCE_KEY }
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await db.vinDecodeCache.findUnique({ where: { vin: VINS[0] } })).not.toBeNull();
  });

  it('does not auto-create rights or persist decoded NHTSA data when no storage license exists', async () => {
    await cleanup();
    const fetchSpy = mockNhtsa('AUDI');

    await hydrateVehicleFromNhtsa(VINS[1], 'PUBLIC_LOOKUP');

    const vehicle = await db.vehicle.findUniqueOrThrow({ where: { vin: VINS[1] }, include: { attributes: true } });
    expect(vehicle.origin).toBe('PUBLIC_LOOKUP');
    expect(vehicle.make).toBeNull();
    expect(vehicle.attributes).toHaveLength(0);
    const source = await db.dataSource.findUniqueOrThrow({ where: { key: NHTSA_SOURCE_KEY }, include: { licenses: true } });
    expect(source.licenses).toHaveLength(0);
    expect(await db.vinDecodeCache.findUnique({ where: { vin: VINS[1] } })).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
