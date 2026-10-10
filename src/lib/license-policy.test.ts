import { describe, expect, it } from 'vitest';
import { findLicenseForAction, isLicenseReviewed, permitsLicenseAction, retentionExpiry } from './license-policy';

const base = {
  licenseName: 'Reviewed fixture license',
  canStore: true,
  canRedistribute: true,
  canCommercialize: true,
  validFrom: null,
  validUntil: null,
  retentionDays: 30,
  reviewedAt: new Date('2026-01-01T00:00:00Z'),
  reviewedBy: 'CI'
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

  it('requires an actual reviewed and documented approval before any right is usable', () => {
    expect(isLicenseReviewed(base)).toBe(true);
    expect(permitsLicenseAction({ ...base, reviewedAt: null }, 'STORE')).toBe(false);
    expect(permitsLicenseAction({ ...base, reviewedBy: null }, 'STORE')).toBe(false);
    expect(permitsLicenseAction({ ...base, licenseName: '', termsUrl: null, notes: null }, 'STORE')).toBe(false);
  });

  it('enforces optional market and capability scopes', () => {
    const scoped = { ...base, markets: ['GB'], capabilities: ['INSPECTION', 'ODOMETER'] };
    expect(permitsLicenseAction(scoped, 'COMMERCIALIZE', new Date('2026-10-08T00:00:00Z'), { market: 'GB', capability: 'INSPECTION' })).toBe(true);
    expect(permitsLicenseAction(scoped, 'COMMERCIALIZE', new Date('2026-10-08T00:00:00Z'), { market: 'DE', capability: 'INSPECTION' })).toBe(false);
    expect(permitsLicenseAction(scoped, 'COMMERCIALIZE', new Date('2026-10-08T00:00:00Z'), { market: 'GB', capability: 'DAMAGE' })).toBe(false);
  });

  it('uses explicit fail-closed semantics for empty, malformed and unknown scopes', () => {
    const at = new Date('2026-10-08T00:00:00Z');
    expect(permitsLicenseAction({ ...base, markets: null, capabilities: null }, 'STORE', at, { market: 'DE', capability: 'INSPECTION' })).toBe(true);
    expect(permitsLicenseAction({ ...base, markets: ['*'], capabilities: ['*'] }, 'STORE', at, { market: 'DE', capability: 'INSPECTION' })).toBe(true);
    expect(permitsLicenseAction({ ...base, markets: [], capabilities: ['INSPECTION'] }, 'STORE', at, { market: 'DE', capability: 'INSPECTION' })).toBe(false);
    expect(permitsLicenseAction({ ...base, markets: ['DE'], capabilities: [] }, 'STORE', at, { market: 'DE', capability: 'INSPECTION' })).toBe(false);
    expect(permitsLicenseAction({ ...base, markets: 'DE' as unknown, capabilities: ['INSPECTION'] }, 'STORE', at, { market: 'DE', capability: 'INSPECTION' })).toBe(false);
    expect(permitsLicenseAction({ ...base, markets: ['DE'], capabilities: ['NOT_A_CAPABILITY'] }, 'STORE', at, { market: 'DE', capability: 'INSPECTION' })).toBe(false);
    expect(permitsLicenseAction({ ...base, markets: ['GERMANY'], capabilities: ['INSPECTION'] }, 'STORE', at, { market: 'DE', capability: 'INSPECTION' })).toBe(false);
    expect(permitsLicenseAction({ ...base, markets: null, capabilities: null }, 'STORE', at, { market: 'GERMANY', capability: 'INSPECTION' })).toBe(false);
    expect(permitsLicenseAction({ ...base, markets: null, capabilities: null }, 'STORE', at, { market: 'DE', capability: 'NOT_A_CAPABILITY' })).toBe(false);
  });

  it('calculates retention expiry', () => {
    const expiry = retentionExpiry(base, new Date('2026-01-01T00:00:00Z'));
    expect(expiry?.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
});
