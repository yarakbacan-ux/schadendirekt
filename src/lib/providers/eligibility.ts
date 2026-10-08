import type { ProviderCoverageDefinition, VehicleDataProvider } from '@/lib/providers/types';

export type EligibilityDecision =
  | { action: 'CALL'; reason: 'ELIGIBLE'; coverage: ProviderCoverageDefinition | null }
  | { action: 'SKIP'; reason: string; coverage: ProviderCoverageDefinition | null }
  | { action: 'NOT_APPLICABLE'; reason: string; coverage: ProviderCoverageDefinition | null };

export type EligibilityInput = {
  provider: VehicleDataProvider;
  sourceActive: boolean;
  configured: boolean;
  hasRequiredLicense: boolean;
  market: string | null;
  lastSuccessfulAt?: Date | null;
  now?: Date;
};

function normalizedMarket(value: string | null | undefined) {
  const market = value?.trim().toUpperCase();
  return market || null;
}

function coverageFor(provider: VehicleDataProvider, market: string | null): ProviderCoverageDefinition | null {
  const coverage = provider.coverage ?? [];
  if (coverage.length === 0) return null;
  if (market) {
    return coverage.find((item) => normalizedMarket(item.market) === market)
      ?? coverage.find((item) => item.market === '*')
      ?? null;
  }
  return coverage.find((item) => item.market === '*' && item.allowUnknownMarket !== false) ?? null;
}

export function evaluateProviderEligibility(input: EligibilityInput): EligibilityDecision {
  const now = input.now ?? new Date();
  const market = normalizedMarket(input.market);
  const configured = input.configured;

  if (!input.sourceActive) return { action: 'SKIP', reason: 'SOURCE_INACTIVE', coverage: null };
  if (!configured) return { action: 'SKIP', reason: 'CREDENTIALS_MISSING', coverage: null };

  const coverage = coverageFor(input.provider, market);
  if ((input.provider.coverage?.length ?? 0) > 0 && !coverage) {
    if (!market) return { action: 'SKIP', reason: 'MARKET_UNKNOWN', coverage: null };
    return { action: 'NOT_APPLICABLE', reason: 'MARKET_NOT_COVERED', coverage: null };
  }

  if (coverage?.status === 'PLANNED') return { action: 'NOT_APPLICABLE', reason: 'COVERAGE_PLANNED', coverage };
  if (coverage?.status === 'UNAVAILABLE') return { action: 'NOT_APPLICABLE', reason: 'COVERAGE_UNAVAILABLE', coverage };

  const requiresLicense = coverage?.requirements?.includes('LICENSE') ?? false;
  if (requiresLicense && !input.hasRequiredLicense) {
    return { action: 'SKIP', reason: 'LICENSE_REQUIRED', coverage };
  }

  const maxAgeSeconds = input.provider.refreshPolicy?.maxAgeSeconds;
  if (maxAgeSeconds && maxAgeSeconds > 0 && input.lastSuccessfulAt) {
    const ageMs = now.getTime() - input.lastSuccessfulAt.getTime();
    if (ageMs >= 0 && ageMs < maxAgeSeconds * 1000) {
      return { action: 'SKIP', reason: 'FRESH_DATA', coverage };
    }
  }

  return { action: 'CALL', reason: 'ELIGIBLE', coverage };
}
