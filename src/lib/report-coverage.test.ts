import { describe, expect, it } from 'vitest';
import { buildReportCoverage } from '@/lib/report-coverage';
import type { ProviderOutcome, VehicleDataProvider } from '@/lib/providers/types';

const provider: VehicleDataProvider = {
  key: 'provider-a',
  name: 'Provider A',
  description: 'test',
  capabilities: ['DAMAGE'],
  mappingVersion: 'map-v3',
  async lookup() { return { cached: false, attributes: [], events: [] }; }
};

function outcome(status: ProviderOutcome['status'], decisionReason: string | null = null): ProviderOutcome {
  return {
    providerKey: provider.key,
    status,
    cached: false,
    attributes: [],
    events: [],
    errorCode: status === 'FAILED' ? 'UPSTREAM_DOWN' : null,
    decisionReason,
    market: 'DE',
    mappingVersion: 'map-v3'
  };
}

describe('report coverage output', () => {
  it('keeps NO_DATA separate from NOT_APPLICABLE and provider errors', () => {
    expect(buildReportCoverage([provider], [outcome('NO_DATA')], new Set())[0]?.state).toBe('NO_DATA');
    expect(buildReportCoverage([provider], [outcome('NOT_APPLICABLE', 'MARKET_NOT_COVERED')], new Set())[0]?.state).toBe('NOT_APPLICABLE');
    expect(buildReportCoverage([provider], [outcome('FAILED', 'UPSTREAM_ERROR')], new Set())[0]?.state).toBe('ERROR');
  });

  it('marks missing credentials or license as not configured', () => {
    expect(buildReportCoverage([provider], [outcome('SKIPPED', 'CREDENTIALS_MISSING')], new Set())[0]?.state).toBe('NOT_CONFIGURED');
    expect(buildReportCoverage([provider], [outcome('SKIPPED', 'LICENSE_REQUIRED')], new Set())[0]?.state).toBe('NOT_CONFIGURED');
  });

  it('treats a fresh-cache skip as data only when persisted source data exists', () => {
    expect(buildReportCoverage([provider], [outcome('SKIPPED', 'FRESH_DATA')], new Set([provider.key]))[0]?.state).toBe('DATA');
    expect(buildReportCoverage([provider], [outcome('SKIPPED', 'FRESH_DATA')], new Set())[0]?.state).toBe('SKIPPED');
  });
});
