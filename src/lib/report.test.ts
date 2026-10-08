import { describe, expect, it } from 'vitest';
import { serializeVehicleReport } from '@/lib/report';

const allowedLicense = {
  canStore: true,
  canRedistribute: true,
  canCommercialize: true,
  validFrom: null,
  validUntil: null,
  retentionDays: null
};

const blockedLicense = {
  ...allowedLicense,
  canCommercialize: false
};

function baseVehicle() {
  return {
    vin: 'WBA00000000000000',
    make: 'BMW',
    model: 'X5',
    modelYear: 2021,
    bodyClass: null,
    fuelType: null,
    engineDisplacement: null,
    enginePowerKw: null,
    transmission: null,
    manufacturer: null,
    plantCountry: null,
    vehicleType: null,
    market: null,
    attributes: [
      {
        field: 'make', value: 'BMW', sourceField: 'Make', quality: 'VERIFIED', fetchedAt: new Date('2026-01-01'),
        source: { key: 'nhtsa-vpic', name: 'NHTSA vPIC', licenses: [allowedLicense] }
      },
      {
        field: 'model', value: 'X5', sourceField: 'Model', quality: 'VERIFIED', fetchedAt: new Date('2026-01-01'),
        source: { key: 'nhtsa-vpic', name: 'NHTSA vPIC', licenses: [allowedLicense] }
      }
    ],
    events: [
      {
        id: 'allowed-event', eventType: 'ODOMETER_READING', sourceEventType: 'Mileage', eventDate: new Date('2025-01-01'),
        country: 'DE', mileageKm: 50_000, title: 'Kilometerstand', description: null, quality: 'VERIFIED', importedAt: new Date('2026-01-01'),
        source: { key: 'licensed-source', name: 'Licensed source', licenses: [allowedLicense] }
      },
      {
        id: 'blocked-event', eventType: 'DAMAGE_RECORD', sourceEventType: 'Damage', eventDate: new Date('2025-02-01'),
        country: 'DE', mileageKm: 51_000, title: 'Nicht veröffentlichbar', description: null, quality: 'VERIFIED', importedAt: new Date('2026-01-01'),
        source: { key: 'blocked-source', name: 'Blocked source', licenses: [blockedLicense] }
      }
    ]
  };
}

describe('serializeVehicleReport', () => {
  it('returns a stable report shape and filters events without commercial publication rights', () => {
    const report = serializeVehicleReport(baseVehicle(), new Date('2026-02-01T00:00:00Z'));
    expect(report.status).toBe('DATA_AVAILABLE');
    expect(report.vehicle).toMatchObject({ vin: 'WBA00000000000000', make: 'BMW', model: 'X5' });
    expect(report.timeline.map((event) => event.id)).toEqual(['allowed-event']);
    expect(report.damageEvents).toHaveLength(0);
    expect(report.sources.map((source) => source.key)).toContain('nhtsa-vpic');
  });

  it('does not expose a vehicle field without publishable provenance', () => {
    const input = baseVehicle();
    input.attributes = input.attributes.filter((attribute) => attribute.field !== 'model');
    const report = serializeVehicleReport(input, new Date('2026-02-01T00:00:00Z'));
    expect(report.vehicle.model).toBeNull();
  });
});
