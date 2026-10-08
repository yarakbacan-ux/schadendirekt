import type { ProviderCoverageDefinition, VehicleDataProvider } from '@/lib/providers/types';

export type EligibilityContext = {
  market: string | null;
  sourceActive: boolean;
  configured: boolean;
  hasActiveLicense: boolean;
  lastSuccessfulAt?: Date | null;
  now: Date;
};

export type EligibilityResult = {
  eligible: boolean;
  decision: 'CALL' | 'NOT_APPLICABLE' | 'NOT_CONFIGURED' | 'SKIP';
  reason: string;
  coverage: ProviderCoverageDefinition | null;
};

function normalizedMarket(value: string | null): string | null {
  const market = value?.trim().toUpperCase();
  return market || null;
}

function coverageFor(provider: VehicleDataProvider, market: string | null): ProviderCoverageDefinition | null {
  if (market) {
    return provider.coverage.find((item) => item.marketCode.toUpperCase() === market)
      ?? provider.coverage.find((item) => item.marketCode.toUpperCase() === 'GLOBAL')
      ?? null;
  }
  return provider.coverage.find((item) => item.marketCode.toUpperCase() === 'GLOBAL') ?? null;
}

export function evaluateProviderEligibility(provider: VehicleDataProvider, context: EligibilityContext): EligibilityResult {
  if (!context.sourceActive) {
    return { eligible: false, decision: 'SKIP', reason: 'SOURCE_INACTIVE', coverage: null };
  }

  const market = normalizedMarket(context.market);
  const coverage = coverageFor(provider, market);

  if (!market && !coverage) {
    return { eligible: false, decision: 'NOT_APPLICABLE', reason: 'MARKET_UNKNOWN', coverage: null };
  }
  if (!coverage) {
    return { eligible: false, decision: 'NOT_APPLICABLE', reason: 'MARKET_NOT_COVERED', coverage: null };
  }
  if (coverage.status === 'UNAVAILABLE') {
    return { eligible: false, decision: 'NOT_APPLICABLE', reason: 'COVERAGE_UNAVAILABLE', coverage };
  }
  if (coverage.status === 'PLANNED') {
    return { eligible: false, decision: 'NOT_APPLICABLE', reason: 'COVERAGE_PLANNED', coverage };
  }
  if (coverage.requiresCredentials && !context.configured) {
    return { eligible: false, decision: 'NOT_CONFIGURED', reason: 'CREDENTIALS_MISSING', coverage };
  }
  if ((coverage.requiresLicense || coverage.requiresContract) && !context.hasActiveLicense) {
    return { eligible: false, decision: 'NOT_CONFIGURED', reason: coverage.requiresContract ? 'CONTRACT_OR_LICENSE_REQUIRED' : 'LICENSE_REQUIRED', coverage };
  }

  if (coverage.freshnessHours && context.lastSuccessfulAt) {
    const ageMs = context.now.getTime() - context.lastSuccessfulAt.getTime();
    if (ageMs >= 0 && ageMs < coverage.freshnessHours * 60 * 60 * 1000) {
      return { eligible: false, decision: 'SKIP', reason: 'FRESH_ENOUGH', coverage };
    }
  }

  return { eligible: true, decision: 'CALL', reason: 'ELIGIBLE', coverage };
}
