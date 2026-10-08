import { describe, expect, it } from 'vitest';
import { mapDvsaVehicle, normalizeDvsaOdometer } from '@/lib/dvsa-mapping';

describe('normalizeDvsaOdometer', () => {
  it('converts miles to kilometres while retaining original input', () => {
    expect(normalizeDvsaOdometer('50000', 'MI')).toEqual({
      originalValue: '50000',
      originalUnit: 'MI',
      mileageKm: 80467
    });
  });

  it('keeps kilometres and does not guess unknown units', () => {
    expect(normalizeDvsaOdometer('12345', 'KM').mileageKm).toBe(12345);
    expect(normalizeDvsaOdometer('12345', 'MILES?').mileageKm).toBeNull();
  });
});

describe('mapDvsaVehicle', () => {
  it('maps PASSED/FAILED inspections, defects, provenance details and stable MOT IDs', () => {
    const result = mapDvsaVehicle({
      registration: 'TEST123',
      make: 'TEST MAKE',
      model: 'TEST MODEL',
      fuelType: 'Petrol',
      engineSize: '1998',
      motTests: [
        {
          completedDate: '2025-01-20 10:30:00',
          motTestNumber: 900000000001,
          expiryDate: '2026-01-19',
          testResult: 'PASSED',
          odometerValue: '50000',
          odometerUnit: 'MI',
          odometerResultType: 'READ',
          defects: [{ dangerous: false, text: 'TEST advisory', type: 'ADVISORY' }]
        },
        {
          completedDate: '2024-01-20 10:30:00',
          motTestNumber: 900000000002,
          testResult: 'FAILED',
          odometerValue: '47000',
          odometerUnit: 'MI',
          odometerResultType: 'READ',
          defects: [{ dangerous: true, text: 'TEST dangerous', type: 'DANGEROUS' }]
        }
      ]
    }, new Date('2026-01-01T00:00:00Z'));

    expect(result.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'make', value: 'TEST MAKE', sourceField: 'make' }),
      expect.objectContaining({ field: 'engineDisplacement', value: '1.998', sourceField: 'engineSize', rawValue: '1998' })
    ]));
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      externalId: 'mot:900000000001', eventType: 'INSPECTION', sourceEventType: 'MOT_PASSED', mileageKm: 80467
    });
    expect(result.events[1]).toMatchObject({
      externalId: 'mot:900000000002', eventType: 'INSPECTION', sourceEventType: 'MOT_FAILED'
    });
    expect(result.events[1]?.rawPayload).toMatchObject({
      defects: [{ dangerous: true, text: 'TEST dangerous', type: 'DANGEROUS' }]
    });
  });

  it('keeps fallback external IDs identical when MOT tests arrive in a different array order', () => {
    const first = {
      completedDate: '2025-05-01 09:00:00',
      expiryDate: '2026-04-30',
      testResult: 'PASSED',
      registrationAtTimeOfTest: 'TEST111',
      odometerValue: '51000',
      odometerUnit: 'MI',
      odometerResultType: 'READ',
      defects: [{ text: 'TEST advisory', type: 'ADVISORY', dangerous: false }]
    };
    const second = {
      completedDate: '2024-05-01 09:00:00',
      expiryDate: '2025-04-30',
      testResult: 'FAILED',
      registrationAtTimeOfTest: 'TEST111',
      odometerValue: '48000',
      odometerUnit: 'MI',
      odometerResultType: 'READ',
      defects: [{ text: 'TEST dangerous', type: 'DANGEROUS', dangerous: true }]
    };

    const a = mapDvsaVehicle({ registration: 'TEST111', motTests: [first, second] });
    const b = mapDvsaVehicle({ registration: 'TEST111', motTests: [second, first] });
    const idsA = a.events.map((event) => event.externalId).sort();
    const idsB = b.events.map((event) => event.externalId).sort();

    expect(idsA).toEqual(idsB);
    expect(idsA.every((id) => id.startsWith('mot:fallback:'))).toBe(true);
    expect(idsA.every((id) => !id.includes('TEST111'))).toBe(true);
  });
});
