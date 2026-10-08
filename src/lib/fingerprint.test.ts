import { describe, expect, it } from 'vitest';
import { eventFingerprint } from './fingerprint';

const record = {
  vin: 'WBA12345678901234',
  eventType: 'damage',
  eventDate: '2025-01-02T00:00:00.000Z',
  country: 'DE',
  mileageKm: 12345,
  title: 'Frontschaden',
  description: 'Stoßfänger beschädigt'
};

describe('event fingerprint', () => {
  it('is deterministic and independent from row position', () => {
    expect(eventFingerprint('source-a', record)).toBe(eventFingerprint('source-a', { ...record }));
  });

  it('changes when a fachliches Feld changes', () => {
    expect(eventFingerprint('source-a', record)).not.toBe(eventFingerprint('source-a', { ...record, mileageKm: 12346 }));
  });
});
