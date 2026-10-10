import { describe, expect, it } from 'vitest';
import { filterProviderResultByCapabilities } from '@/lib/providers/capability-filter';
import type { ProviderLookupResult } from '@/lib/providers/types';

function result(): ProviderLookupResult {
  return {
    cached: false,
    attributes: [
      { field: 'make', value: 'Test', sourceField: 'make', capability: 'VEHICLE_SPECS', quality: 'VERIFIED', fetchedAt: new Date() },
      { field: 'registration', value: 'AB12CDE', sourceField: 'registration', capability: 'REGISTRATION', quality: 'VERIFIED', fetchedAt: new Date() },
      { field: 'providerPrivateField', value: 'secret', sourceField: 'private', quality: 'VERIFIED', fetchedAt: new Date() }
    ],
    events: [{
      externalId: 'mot-1',
      eventType: 'INSPECTION',
      eventDate: new Date('2026-01-01T00:00:00Z'),
      mileageKm: 12345,
      title: 'Inspection',
      quality: 'VERIFIED',
      rawPayload: { testResult: 'PASSED', odometer: { value: 12345 }, registrationAtTimeOfTest: 'AB12CDE', unclassified: 'drop' },
      rawPayloadCapabilities: { testResult: 'INSPECTION', odometer: 'ODOMETER', registrationAtTimeOfTest: 'REGISTRATION' }
    }]
  };
}

describe('provider capability filtering', () => {
  it('does not treat every attribute as generic specs', () => {
    const specs = filterProviderResultByCapabilities(result(), ['VEHICLE_SPECS']);
    expect(specs.attributes.map((item) => item.field)).toEqual(['make']);
    expect(specs.events).toHaveLength(0);

    const registration = filterProviderResultByCapabilities(result(), ['REGISTRATION']);
    expect(registration.attributes.map((item) => item.field)).toEqual(['registration']);
    expect(registration.attributes.some((item) => item.field === 'providerPrivateField')).toBe(false);
  });

  it('filters raw payload fields and odometer independently from the inspection capability', () => {
    const inspection = filterProviderResultByCapabilities(result(), ['INSPECTION']);
    expect(inspection.events).toHaveLength(1);
    expect(inspection.events[0]?.mileageKm).toBeNull();
    expect(inspection.events[0]?.rawPayload).toEqual({ testResult: 'PASSED' });

    const odometerOnly = filterProviderResultByCapabilities(result(), ['ODOMETER']);
    expect(odometerOnly.events).toHaveLength(1);
    expect(odometerOnly.events[0]).toMatchObject({
      externalId: 'mot-1:odometer',
      eventType: 'ODOMETER_READING',
      mileageKm: 12345,
      title: 'Kilometerstand',
      rawPayload: { odometer: { value: 12345 } }
    });
    expect(odometerOnly.events[0]?.rawPayload).not.toHaveProperty('testResult');

    const combined = filterProviderResultByCapabilities(result(), ['INSPECTION', 'ODOMETER', 'REGISTRATION']);
    expect(combined.events[0]?.mileageKm).toBe(12345);
    expect(combined.events[0]?.rawPayload).toEqual({
      testResult: 'PASSED',
      odometer: { value: 12345 },
      registrationAtTimeOfTest: 'AB12CDE'
    });
    expect(combined.events[0]?.rawPayload).not.toHaveProperty('unclassified');
  });
});
