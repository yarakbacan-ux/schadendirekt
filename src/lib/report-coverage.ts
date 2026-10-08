import type { ProviderOutcome, VehicleDataProvider } from '@/lib/providers/types';

export type ReportCoverageState = 'DATA' | 'NO_DATA' | 'NOT_APPLICABLE' | 'NOT_CONFIGURED' | 'ERROR' | 'SKIPPED';

export type ReportCoverageEntry = {
  providerKey: string;
  providerName: string;
  state: ReportCoverageState;
  reason: string | null;
  market: string | null;
  capabilities: readonly string[];
  mappingVersion: string | null;
};

export function buildReportCoverage(
  providers: readonly VehicleDataProvider[],
  outcomes: ProviderOutcome[],
  persistedSourceKeys: ReadonlySet<string>
): ReportCoverageEntry[] {
  const outcomeByProvider = new Map(outcomes.map((outcome) => [outcome.providerKey, outcome]));

  return providers.map((provider) => {
    const outcome = outcomeByProvider.get(provider.key);
    if (!outcome) {
      return {
        providerKey: provider.key,
        providerName: provider.name,
        state: persistedSourceKeys.has(provider.key) ? 'DATA' : 'SKIPPED',
        reason: 'NOT_REQUESTED',
        market: null,
        capabilities: provider.capabilities,
        mappingVersion: provider.mappingVersion ?? null
      };
    }

    let state: ReportCoverageState;
    if (outcome.status === 'SUCCESS') state = 'DATA';
    else if (outcome.status === 'NO_DATA') state = 'NO_DATA';
    else if (outcome.status === 'NOT_APPLICABLE') state = 'NOT_APPLICABLE';
    else if (outcome.status === 'FAILED') state = 'ERROR';
    else if (outcome.decisionReason === 'CREDENTIALS_MISSING' || outcome.decisionReason === 'LICENSE_REQUIRED') state = 'NOT_CONFIGURED';
    else if (outcome.decisionReason === 'FRESH_DATA' && persistedSourceKeys.has(provider.key)) state = 'DATA';
    else state = 'SKIPPED';

    return {
      providerKey: provider.key,
      providerName: provider.name,
      state,
      reason: outcome.decisionReason ?? outcome.errorCode,
      market: outcome.market ?? null,
      capabilities: provider.capabilities,
      mappingVersion: outcome.mappingVersion ?? provider.mappingVersion ?? null
    };
  });
}
