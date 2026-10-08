import type { ProviderCapability, ProviderCoverageDefinition, VehicleDataProvider } from '@/lib/providers/types';

export type CapabilityEligibilityDecision = {
  capability: ProviderCapability;
  action: 'CALL' | 'SKIP' | 'NOT_APPLICABLE';
  reason: string;
  coverage: ProviderCoverageDefinition | null;
};

export type EligibilityDecision =
  | { action: 'CALL'; reason: 'ELIGIBLE'; coverage: ProviderCoverageDefinition | null; scopes: CapabilityEligibilityDecision[]; eligibleCapabilities: ProviderCapability[] }
  | { action: 'SKIP'; reason: string; coverage: ProviderCoverageDefinition | null; scopes: CapabilityEligibilityDecision[]; eligibleCapabilities: ProviderCapability[] }
  | { action: 'NOT_APPLICABLE'; reason: string; coverage: ProviderCoverageDefinition | null; scopes: CapabilityEligibilityDecision[]; eligibleCapabilities: ProviderCapability[] };

export type EligibilityInput = {
  provider: VehicleDataProvider;
  sourceActive: boolean;
  configured: boolean;
  hasRequiredLicense: boolean;
  hasRequiredContract: boolean;
  hasRequiredLicenseByCapability?: Partial<Record<ProviderCapability, boolean>>;
  hasRequiredContractByCapability?: Partial<Record<ProviderCapability, boolean>>;
  requireLicenseForAll?: boolean;
  market: string | null;
  requestedCapabilities?: readonly ProviderCapability[];
  lastSuccessfulAt?: Date | null;
  lastSuccessfulAtByCapability?: Partial<Record<ProviderCapability, Date | null>>;
  now?: Date;
};

function normalizedMarket(value: string | null | undefined) {
  const market = value?.trim().toUpperCase();
  return market || null;
}

export function coverageForCapability(
  provider: VehicleDataProvider,
  market: string | null,
  capability: ProviderCapability
): ProviderCoverageDefinition | null {
  const candidates = (provider.coverage ?? []).filter((item) => item.capabilities.includes(capability));
  if (candidates.length === 0) return null;
  if (market) {
    return candidates.find((item) => normalizedMarket(item.market) === market)
      ?? candidates.find((item) => item.market === '*')
      ?? null;
  }
  return candidates.find((item) => item.market === '*' && item.allowUnknownMarket !== false) ?? null;
}

function evaluateCapability(input: EligibilityInput, capability: ProviderCapability, now: Date, market: string | null): CapabilityEligibilityDecision {
  const coverage = coverageForCapability(input.provider, market, capability);
  const providerHasCoverage = (input.provider.coverage ?? []).some((item) => item.capabilities.includes(capability));

  if (providerHasCoverage && !coverage) {
    return !market
      ? { capability, action: 'SKIP', reason: 'MARKET_UNKNOWN', coverage: null }
      : { capability, action: 'NOT_APPLICABLE', reason: 'MARKET_NOT_COVERED', coverage: null };
  }
  if (coverage?.status === 'PLANNED') return { capability, action: 'NOT_APPLICABLE', reason: 'COVERAGE_PLANNED', coverage };
  if (coverage?.status === 'UNAVAILABLE') return { capability, action: 'NOT_APPLICABLE', reason: 'COVERAGE_UNAVAILABLE', coverage };
  if (!input.configured) return { capability, action: 'SKIP', reason: 'CREDENTIALS_MISSING', coverage };

  const requirements = coverage?.requirements ?? [];
  const contractAllowed = input.hasRequiredContractByCapability?.[capability] ?? input.hasRequiredContract;
  const licenseAllowed = input.hasRequiredLicenseByCapability?.[capability] ?? input.hasRequiredLicense;
  if (requirements.includes('CONTRACT') && !contractAllowed) {
    return { capability, action: 'SKIP', reason: 'CONTRACT_REQUIRED', coverage };
  }
  if ((input.requireLicenseForAll || requirements.includes('LICENSE')) && !licenseAllowed) {
    return { capability, action: 'SKIP', reason: 'LICENSE_REQUIRED', coverage };
  }

  const maxAgeSeconds = coverage?.freshnessSeconds ?? input.provider.refreshPolicy?.maxAgeSeconds;
  const lastSuccessfulAt = input.lastSuccessfulAtByCapability?.[capability] ?? input.lastSuccessfulAt ?? null;
  if (maxAgeSeconds && maxAgeSeconds > 0 && lastSuccessfulAt) {
    const ageMs = now.getTime() - lastSuccessfulAt.getTime();
    if (ageMs >= 0 && ageMs < maxAgeSeconds * 1000) {
      return { capability, action: 'SKIP', reason: 'FRESH_DATA', coverage };
    }
  }

  return { capability, action: 'CALL', reason: 'ELIGIBLE', coverage };
}

export function evaluateProviderEligibility(input: EligibilityInput): EligibilityDecision {
  const now = input.now ?? new Date();
  const market = normalizedMarket(input.market);
  const requested = (input.requestedCapabilities ?? input.provider.capabilities)
    .filter((capability): capability is ProviderCapability => input.provider.capabilities.includes(capability));

  if (!input.sourceActive) {
    const scopes = requested.map((capability) => ({ capability, action: 'SKIP' as const, reason: 'SOURCE_INACTIVE', coverage: null }));
    return { action: 'SKIP', reason: 'SOURCE_INACTIVE', coverage: null, scopes, eligibleCapabilities: [] };
  }

  const scopes = requested.map((capability) => evaluateCapability(input, capability, now, market));
  const callable = scopes.filter((scope) => scope.action === 'CALL');
  if (callable.length > 0) {
    return {
      action: 'CALL',
      reason: 'ELIGIBLE',
      coverage: callable[0].coverage,
      scopes,
      eligibleCapabilities: callable.map((scope) => scope.capability)
    };
  }

  if (scopes.length > 0 && scopes.every((scope) => scope.action === 'NOT_APPLICABLE')) {
    const reason = scopes.every((scope) => scope.reason === scopes[0].reason) ? scopes[0].reason : 'NO_APPLICABLE_CAPABILITY';
    return { action: 'NOT_APPLICABLE', reason, coverage: scopes[0].coverage, scopes, eligibleCapabilities: [] };
  }

  const preferred = scopes.find((scope) => scope.reason !== 'FRESH_DATA') ?? scopes[0];
  return {
    action: 'SKIP',
    reason: preferred?.reason ?? 'NO_REQUESTED_CAPABILITY',
    coverage: preferred?.coverage ?? null,
    scopes,
    eligibleCapabilities: []
  };
}
