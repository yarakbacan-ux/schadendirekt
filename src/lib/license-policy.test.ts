import { describe, expect, it } from 'vitest';
import { findLicenseForAction, permitsLicenseAction, retentionExpiry } from './license-policy';

const base = {
  canStore: true,
  canRedistribute: true,
  canCommercialize: true,
  validFrom: null,
  validUntil: null,
  retentionDays: 30
};

describe('license policy', () => {
  it('requires redistribution and commercialization for commercial publication', () => {
    expect(permitsLicenseAction({ ...base, canCommercialize: false }, 'COMMERCIALIZE')).toBe(false);
    expect(permitsLicenseAction(base, 'COMMERCIALIZE')).toBe(true);
  });

  it('rejects expired licenses', () => {
    const expired = { ...base, validUntil: new Date('2020-01-01T00:00:00Z') };
    expect(findLicenseForAction([expired], 'STORE', new Date('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('calculates retention expiry', () => {
    const expiry = retentionExpiry(base, new Date('2026-01-01T00:00:00Z'));
    expect(expiry?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
});
