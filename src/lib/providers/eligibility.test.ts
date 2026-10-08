import { describe, expect, it } from 'vitest';
import { evaluateProviderEligibility } from '@/lib/providers/eligibility';
import type { VehicleDataProvider } from '@/lib/providers/types';

const provider: VehicleDataProvider = {
  key: 'eu-test',
  name: 'EU Test',
  description: 'test',
  capabilities: ['ODOMETER'],
  authType: 'API_KEY',
  mappingVersion: 'v2',
  refreshPolicy: { mode: 'CACHE', maxAgeSeconds: 3600 },
  coverage: [{ market: 'DE', capabilities: ['ODOMETER'], status: 'LIVE', requirements: ['CREDENTIALS', 'LICENSE'] }],
  async lookup() { return { cached: false, availability: 'NO_DATA', attributes: [], events: [] }; }
};

const base = {
  provider,
  sourceActive: true,
  configured: true,
  hasRequiredLicense: true,
  market: 'DE',
  now: new Date('2026-10-08T12:00:00Z')
};

describe('provider eligibility', () => {
  it('calls only when market, configuration and license are eligible', () => {
    expect(evaluateProviderEligibility(base)).toMatchObject({ action: 'CALL', reason: 'ELIGIBLE' });
  });

  it('does not guess a market when provider coverage is market-specific', () => {
    expect(evaluateProviderEligibility({ ...base, market: null })).toMatchObject({ action: 'SKIP', reason: 'MARKET_UNKNOWN' });
  });

  it('distinguishes not applicable market from no data', () => {
    expect(evaluateProviderEligibility({ ...base, market: 'FR' })).toMatchObject({ action: 'NOT_APPLICABLE', reason: 'MARKET_NOT_COVERED' });
  });

  it('reports market inapplicability before missing credentials', () => {
    expect(evaluateProviderEligibility({ ...base, market: 'FR', configured: false }))
      .toMatchObject({ action: 'NOT_APPLICABLE', reason: 'MARKET_NOT_COVERED' });
  });

  it('blocks missing credentials and license before a live call', () => {
    expect(evaluateProviderEligibility({ ...base, configured: false })).toMatchObject({ action: 'SKIP', reason: 'CREDENTIALS_MISSING' });
    expect(evaluateProviderEligibility({ ...base, hasRequiredLicense: false })).toMatchObject({ action: 'SKIP', reason: 'LICENSE_REQUIRED' });
  });

  it('treats a contractual coverage requirement as a hard eligibility gate', () => {
    const contractProvider: VehicleDataProvider = {
      ...provider,
      key: 'contract-test',
      coverage: [{ market: 'DE', capabilities: ['ODOMETER'], status: 'LIVE', requirements: ['CONTRACT'] }]
    };
    expect(evaluateProviderEligibility({ ...base, provider: contractProvider, hasRequiredLicense: false }))
      .toMatchObject({ action: 'SKIP', reason: 'CONTRACT_REQUIRED' });
  });

  it('uses freshness to avoid unnecessary live calls', () => {
    expect(evaluateProviderEligibility({ ...base, lastSuccessfulAt: new Date('2026-10-08T11:30:00Z') }))
      .toMatchObject({ action: 'SKIP', reason: 'FRESH_DATA' });
    expect(evaluateProviderEligibility({ ...base, lastSuccessfulAt: new Date('2026-10-08T10:00:00Z') }))
      .toMatchObject({ action: 'CALL' });
  });
});
