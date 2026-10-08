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
  hasRequiredContract: true,
  market: 'DE',
  now: new Date('2026-10-08T12:00:00Z')
};

describe('provider eligibility', () => {
  it('calls only when market, configuration and required rights are eligible', () => {
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

  it('separates contract state from license state', () => {
    const contractProvider: VehicleDataProvider = {
      ...provider,
      key: 'contract-test',
      coverage: [{ market: 'DE', capabilities: ['ODOMETER'], status: 'LIVE', requirements: ['LICENSE', 'CONTRACT'] }]
    };
    expect(evaluateProviderEligibility({ ...base, provider: contractProvider, hasRequiredContract: false, hasRequiredLicense: true }))
      .toMatchObject({ action: 'SKIP', reason: 'CONTRACT_REQUIRED' });
    expect(evaluateProviderEligibility({ ...base, provider: contractProvider, hasRequiredContract: true, hasRequiredLicense: false }))
      .toMatchObject({ action: 'SKIP', reason: 'LICENSE_REQUIRED' });
    expect(evaluateProviderEligibility({ ...base, provider: contractProvider, hasRequiredContract: true, hasRequiredLicense: true }))
      .toMatchObject({ action: 'CALL', reason: 'ELIGIBLE' });
  });

  it('uses operational coverage freshness before provider defaults', () => {
    const operationalProvider: VehicleDataProvider = {
      ...provider,
      coverage: [{ market: 'DE', capabilities: ['ODOMETER'], status: 'LIVE', requirements: ['LICENSE'], freshnessSeconds: 60 }]
    };
    expect(evaluateProviderEligibility({ ...base, provider: operationalProvider, lastSuccessfulAt: new Date('2026-10-08T11:58:30Z') }))
      .toMatchObject({ action: 'CALL' });
    expect(evaluateProviderEligibility({ ...base, provider: operationalProvider, lastSuccessfulAt: new Date('2026-10-08T11:59:30Z') }))
      .toMatchObject({ action: 'SKIP', reason: 'FRESH_DATA' });
  });

  it('evaluates status, requirements and freshness independently per capability', () => {
    const multi: VehicleDataProvider = {
      ...provider,
      key: 'multi-cap',
      capabilities: ['VEHICLE_SPECS', 'ODOMETER', 'DAMAGE'],
      coverage: [
        { market: 'DE', capabilities: ['VEHICLE_SPECS'], status: 'LIVE', requirements: ['LICENSE'], freshnessSeconds: 3600 },
        { market: 'DE', capabilities: ['ODOMETER'], status: 'LIVE', requirements: ['CONTRACT'], freshnessSeconds: 0 },
        { market: 'DE', capabilities: ['DAMAGE'], status: 'UNAVAILABLE' }
      ]
    };
    const decision = evaluateProviderEligibility({
      ...base,
      provider: multi,
      requestedCapabilities: ['VEHICLE_SPECS', 'ODOMETER', 'DAMAGE'],
      hasRequiredLicenseByCapability: { VEHICLE_SPECS: true, ODOMETER: true, DAMAGE: true },
      hasRequiredContractByCapability: { VEHICLE_SPECS: true, ODOMETER: true, DAMAGE: true },
      lastSuccessfulAtByCapability: { VEHICLE_SPECS: new Date('2026-10-08T11:30:00Z'), ODOMETER: null, DAMAGE: null }
    });
    expect(decision.action).toBe('CALL');
    expect(decision.eligibleCapabilities).toEqual(['ODOMETER']);
    expect(decision.scopes).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'VEHICLE_SPECS', action: 'SKIP', reason: 'FRESH_DATA' }),
      expect.objectContaining({ capability: 'ODOMETER', action: 'CALL', reason: 'ELIGIBLE' }),
      expect.objectContaining({ capability: 'DAMAGE', action: 'NOT_APPLICABLE', reason: 'COVERAGE_UNAVAILABLE' })
    ]));
  });
});
