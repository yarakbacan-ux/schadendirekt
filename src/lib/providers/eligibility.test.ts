import { describe, expect, it } from 'vitest';
import { evaluateProviderEligibility } from '@/lib/providers/eligibility';
import type { VehicleDataProvider } from '@/lib/providers/types';

const provider: VehicleDataProvider = {
  key: 'eu-test',
  name: 'EU Test',
  description: 'fixture',
  capabilities: ['ODOMETER'],
  authType: 'API_KEY',
  refreshPolicy: '24h',
  rateLimitPolicy: 'fixture',
  mappingVersion: 'v1',
  coverage: [{
    marketCode: 'DE', capabilities: ['ODOMETER'], status: 'LIVE', requiresCredentials: true,
    requiresLicense: true, freshnessHours: 24
  }],
  mapping: { mileage: 'mileageKm' },
  async lookup() { return { cached: false, attributes: [], events: [] }; }
};

const base = {
  sourceActive: true,
  configured: true,
  hasActiveLicense: true,
  lastSuccessfulAt: null,
  now: new Date('2026-10-08T12:00:00Z')
};

describe('provider eligibility', () => {
  it('calls only when market, credentials and license are eligible', () => {
    expect(evaluateProviderEligibility(provider, { ...base, market: 'DE' })).toMatchObject({ eligible: true, decision: 'CALL', reason: 'ELIGIBLE' });
  });

  it('does not guess when market is unknown', () => {
    expect(evaluateProviderEligibility(provider, { ...base, market: null })).toMatchObject({ eligible: false, decision: 'NOT_APPLICABLE', reason: 'MARKET_UNKNOWN' });
  });

  it('distinguishes unsupported markets from missing configuration', () => {
    expect(evaluateProviderEligibility(provider, { ...base, market: 'FR' })).toMatchObject({ decision: 'NOT_APPLICABLE', reason: 'MARKET_NOT_COVERED' });
    expect(evaluateProviderEligibility(provider, { ...base, market: 'DE', configured: false })).toMatchObject({ decision: 'NOT_CONFIGURED', reason: 'CREDENTIALS_MISSING' });
    expect(evaluateProviderEligibility(provider, { ...base, market: 'DE', hasActiveLicense: false })).toMatchObject({ decision: 'NOT_CONFIGURED', reason: 'LICENSE_REQUIRED' });
  });

  it('skips a redundant live call while the previous success is fresh', () => {
    expect(evaluateProviderEligibility(provider, {
      ...base,
      market: 'DE',
      lastSuccessfulAt: new Date('2026-10-08T00:30:00Z')
    })).toMatchObject({ eligible: false, decision: 'SKIP', reason: 'FRESH_ENOUGH' });
  });
});
