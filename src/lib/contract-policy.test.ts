import { describe, expect, it } from 'vitest';
import { hasActiveContract, isContractActive, isContractReviewed } from '@/lib/contract-policy';

const now = new Date('2026-10-08T20:00:00Z');

function contract(overrides: Partial<Parameters<typeof isContractActive>[0]> = {}) {
  return {
    name: 'Reviewed contract',
    reference: 'REF-2026-001',
    active: true,
    validFrom: null,
    validUntil: null,
    reviewedAt: new Date('2026-10-01T00:00:00Z'),
    reviewedBy: 'CI',
    ...overrides
  };
}

describe('contract policy', () => {
  it('requires documented review and validity', () => {
    expect(isContractReviewed(contract())).toBe(true);
    expect(isContractActive(contract(), now)).toBe(true);
    expect(isContractActive(contract({ active: false }), now)).toBe(false);
    expect(isContractActive(contract({ reviewedAt: null }), now)).toBe(false);
    expect(isContractActive(contract({ reviewedBy: null }), now)).toBe(false);
    expect(isContractActive(contract({ reference: null }), now)).toBe(false);
    expect(isContractActive(contract({ name: '' }), now)).toBe(false);
  });

  it('finds only active reviewed contracts', () => {
    expect(hasActiveContract([contract({ active: false }), contract()], now)).toBe(true);
    expect(hasActiveContract([contract({ active: false })], now)).toBe(false);
  });

  it('fails closed for empty scopes and supports explicit wildcard', () => {
    expect(isContractActive(contract({ markets: ['GB'], capabilities: ['INSPECTION'] }), now, { market: 'GB', capability: 'INSPECTION' })).toBe(true);
    expect(isContractActive(contract({ markets: [], capabilities: ['INSPECTION'] }), now, { market: 'GB', capability: 'INSPECTION' })).toBe(false);
    expect(isContractActive(contract({ markets: ['GB'], capabilities: [] }), now, { market: 'GB', capability: 'INSPECTION' })).toBe(false);
    expect(isContractActive(contract({ markets: ['*'], capabilities: ['*'] }), now, { market: 'GB', capability: 'INSPECTION' })).toBe(true);
  });
});
