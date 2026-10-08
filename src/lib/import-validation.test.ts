import { describe, expect, it } from 'vitest';
import { validateImportRecord } from './import-validation';

describe('import validation', () => {
  it('normalizes and accepts valid data', () => {
    const value = validateImportRecord({
      vin: 'wba12345678901234',
      eventType: 'damage',
      eventDate: '2025-01-02',
      country: 'de',
      mileageKm: 123,
      title: 'Schaden'
    });
    expect(value.vin).toBe('WBA12345678901234');
    expect(value.country).toBe('DE');
  });

  it('rejects invalid dates, countries, mileage and empty required fields', () => {
    expect(() => validateImportRecord({ vin: 'WBA12345678901234', eventType: '', title: 'x' })).toThrow();
    expect(() => validateImportRecord({ vin: 'WBA12345678901234', eventType: 'x', title: 'x', country: 'XX' })).toThrow();
    expect(() => validateImportRecord({ vin: 'WBA12345678901234', eventType: 'x', title: 'x', eventDate: 'not-a-date' })).toThrow();
    expect(() => validateImportRecord({ vin: 'WBA12345678901234', eventType: 'x', title: 'x', mileageKm: -1 })).toThrow();
  });
});
