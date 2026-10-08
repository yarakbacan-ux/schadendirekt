import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { serializeVehicleReport } from '@/lib/report';

const allowedLicense = {
  licenseName: 'Reviewed report fixture license',
  canStore: true,
  canRedistribute: true,
  canCommercialize: true,
  validFrom: null,
  validUntil: null,
  retentionDays: null,
  reviewedAt: new Date('2026-01-01T00:00:00Z'),
  reviewedBy: 'CI'
};

const blockedLicense = {
  ...allowedLicense,
  canCommercialize: false
};

type TestEvent = {
  id: string;
  eventType: string;
  sourceEventType: string | null;
  eventDate: Date | null;
  country: string | null;
  mileageKm: number | null;
  title: string;
  description: string | null;
  quality: string;
  rawPayload: Prisma.JsonValue | null;
  importedAt: Date;
  source: {
    key: string;
    name: string;
    licenses: Array<typeof allowedLicense>;
  };
};

function baseVehicle() {
  const events: TestEvent[] = [
    {
      id: 'allowed-event', eventType: 'ODOMETER_READING', sourceEventType: 'Mileage', eventDate: new Date('2025-01-01'),
      country: 'DE', mileageKm: 50_000, title: 'Kilometerstand', description: null, quality: 'VERIFIED', rawPayload: null, importedAt: new Date('2026-01-01'),
      source: { key: 'licensed-source', name: 'Licensed source', licenses: [allowedLicense] }
    },
    {
      id: 'blocked-event', eventType: 'DAMAGE_RECORD', sourceEventType: 'Damage', eventDate: new Date('2025-02-01'),
      country: 'DE', mileageKm: 51_000, title: 'Nicht veröffentlichbar', description: null, quality: 'VERIFIED', rawPayload: null, importedAt: new Date('2026-01-01'),
      source: { key: 'blocked-source', name: 'Blocked source', licenses: [blockedLicense] }
    }
  ];

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
        id: 'attr-make-nhtsa', field: 'make', value: 'BMW', sourceField: 'Make', quality: 'VERIFIED', fetchedAt: new Date('2026-01-01'),
        source: { key: 'nhtsa-vpic', name: 'NHTSA vPIC', licenses: [allowedLicense] }
      },
      {
        id: 'attr-model-nhtsa', field: 'model', value: 'X5', sourceField: 'Model', quality: 'VERIFIED', fetchedAt: new Date('2026-01-01'),
        source: { key: 'nhtsa-vpic', name: 'NHTSA vPIC', licenses: [allowedLicense] }
      }
    ],
    events
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

  it('emits value and provenance from the same deterministic candidate and does not let recency decide truth', () => {
    const input = baseVehicle();
    input.make = 'CANONICAL-OLD';
    input.attributes.push({
      id: 'attr-make-source-b',
      field: 'make',
      value: 'AUDI',
      sourceField: 'brand_name',
      quality: 'VERIFIED',
      fetchedAt: new Date('2026-02-01T00:00:00Z'),
      source: { key: 'source-b', name: 'Source B', licenses: [allowedLicense] }
    });
    input.attributes.push({
      id: 'attr-make-source-a',
      field: 'make',
      value: 'MERCEDES-BENZ',
      sourceField: 'manufacturer_name',
      quality: 'VERIFIED',
      fetchedAt: new Date('2026-02-01T00:00:00Z'),
      source: { key: 'source-a', name: 'Source A', licenses: [allowedLicense] }
    });

    const report = serializeVehicleReport(input, new Date('2026-02-02T00:00:00Z'));
    expect(report.vehicle.make).toBe('BMW');
    expect(report.vehicle.provenance).toMatchObject({
      make: {
        attributeId: 'attr-make-nhtsa',
        source: { key: 'nhtsa-vpic', name: 'NHTSA vPIC' },
        sourceField: 'Make',
        quality: 'VERIFIED',
        conflict: true
      }
    });
    expect(report.attributeConflicts.find((item) => item.field === 'make')?.candidates).toHaveLength(3);
  });

  it('never publishes the value of an unlicensed newer attribute', () => {
    const input = baseVehicle();
    input.attributes.push({
      id: 'blocked-newer',
      field: 'make',
      value: 'BLOCKED-BRAND',
      sourceField: 'Make',
      quality: 'VERIFIED',
      fetchedAt: new Date('2026-03-01'),
      source: { key: 'blocked-source', name: 'Blocked source', licenses: [blockedLicense] }
    });
    const report = serializeVehicleReport(input, new Date('2026-03-02T00:00:00Z'));
    expect(report.vehicle.make).toBe('BMW');
  });

  it('includes licensed DVSA MOT readings in inspection history and mileage analysis', () => {
    const input = baseVehicle();
    input.events.push({
      id: 'dvsa-mot-1',
      eventType: 'INSPECTION',
      sourceEventType: 'MOT_PASSED',
      eventDate: new Date('2025-06-01'),
      country: 'GB',
      mileageKm: 60_000,
      title: 'MOT-Prüfung bestanden',
      description: 'MOT-Ergebnis: PASSED.',
      quality: 'VERIFIED',
      rawPayload: { motTestNumber: '900000000001', testResult: 'PASSED', defects: [] },
      importedAt: new Date('2026-01-02'),
      source: { key: 'dvsa-mot', name: 'DVSA MOT History', licenses: [allowedLicense] }
    });

    const report = serializeVehicleReport(input, new Date('2026-02-01T00:00:00Z'));
    expect(report.inspectionEvents.map((event) => event.id)).toContain('dvsa-mot-1');
    expect(report.mileageAnalysis.readings.map((reading) => reading.mileageKm)).toEqual([50_000, 60_000]);
    expect(report.inspectionEvents[0]?.details).toMatchObject({ motTestNumber: '900000000001' });
  });

  it('does not publish DVSA inspection data when commercialization rights are missing', () => {
    const input = baseVehicle();
    input.events.push({
      id: 'dvsa-blocked', eventType: 'INSPECTION', sourceEventType: 'MOT_PASSED', eventDate: new Date('2025-06-01'),
      country: 'GB', mileageKm: 60_000, title: 'MOT', description: null, quality: 'VERIFIED', rawPayload: { testResult: 'PASSED' }, importedAt: new Date('2026-01-01'),
      source: { key: 'dvsa-mot', name: 'DVSA MOT History', licenses: [blockedLicense] }
    });
    const report = serializeVehicleReport(input, new Date('2026-02-01T00:00:00Z'));
    expect(report.inspectionEvents).toHaveLength(0);
    expect(report.timeline.map((event) => event.id)).not.toContain('dvsa-blocked');
  });
});
