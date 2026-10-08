import { describe, expect, it } from 'vitest';
import { hasActiveContract, isContractActive } from '@/lib/contract-policy';

const now = new Date('2026-10-08T20:00:00Z');

function contract(overrides: Partial<Parameters<typeof isContractActive>[0]> = {}) {
  return {
    active: true,
    validFrom: null,
    validUntil: null,
    reviewedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides
  };
}

describe('contract policy', () => {
  it('requires active and reviewed contract inside its validity window', () => {
    expect(isContractActive(contract(), now)).toBe(true);
    expect(isContractActive(contract({ active: false }), now)).toBe(false);
    expect(isContractActive(contract({ reviewedAt: null }), now)).toBe(false);
    expect(isContractActive(contract({ validFrom: new Date('2026-10-09T00:00:00Z') }), now)).toBe(false);
    expect(isContractActive(contract({ validUntil: new Date('2026-10-07T00:00:00Z') }), now)).toBe(false);
  });

  it('finds an active reviewed contract independently from license state', () => {
    expect(hasActiveContract([contract({ active: false }), contract()], now)).toBe(true);
    expect(hasActiveContract([contract({ active: false })], now)).toBe(false);
  });

  it('enforces optional market and capability scopes', () => {
    const scoped = contract({ markets: ['GB'], capabilities: ['INSPECTION'] });
    expect(isContractActive(scoped, now, { market: 'GB', capability: 'INSPECTION' })).toBe(true);
    expect(isContractActive(scoped, now, { market: 'DE', capability: 'INSPECTION' })).toBe(false);
    expect(isContractActive(scoped, now, { market: 'GB', capability: 'DAMAGE' })).toBe(false);
  });
});
