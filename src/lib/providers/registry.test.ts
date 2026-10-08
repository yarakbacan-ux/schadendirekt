import { describe, expect, it } from 'vitest';
import { getProvider, getProvidersForCapability, listProviders } from '@/lib/providers/registry';
import { mergeProviderResults } from '@/lib/providers/orchestrator';
import type { ProviderOutcome } from '@/lib/providers/types';

describe('provider registry', () => {
  it('registers NHTSA for VIN decode and vehicle specs', () => {
    expect(listProviders().map((provider) => provider.key)).toContain('nhtsa-vpic');
    expect(getProvider('nhtsa-vpic')?.capabilities).toEqual(expect.arrayContaining(['VIN_DECODE', 'VEHICLE_SPECS']));
    expect(getProvidersForCapability('VIN_DECODE').map((provider) => provider.key)).toContain('nhtsa-vpic');
    expect(getProvidersForCapability('DAMAGE').map((provider) => provider.key)).not.toContain('nhtsa-vpic');
  });
});

describe('mergeProviderResults', () => {
  it('merges successful provider results deterministically and ignores failed outcomes', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const outcomes: ProviderOutcome[] = [
      {
        providerKey: 'z-provider', status: 'SUCCESS', cached: false, errorCode: null,
        attributes: [{ field: 'make', value: 'Z', sourceField: 'make', quality: 'VERIFIED', fetchedAt: at }],
        events: [{ externalId: '2', eventType: 'ODOMETER_READING', eventDate: new Date('2025-02-01'), mileageKm: 20, title: 'B', quality: 'VERIFIED' }]
      },
      {
        providerKey: 'a-provider', status: 'SUCCESS', cached: false, errorCode: null,
        attributes: [{ field: 'make', value: 'A', sourceField: 'make', quality: 'VERIFIED', fetchedAt: at }],
        events: [{ externalId: '1', eventType: 'ODOMETER_READING', eventDate: new Date('2025-01-01'), mileageKm: 10, title: 'A', quality: 'VERIFIED' }]
      },
      { providerKey: 'failed', status: 'FAILED', cached: false, errorCode: 'DOWN', attributes: [], events: [] }
    ];

    const merged = mergeProviderResults(outcomes);
    expect(merged.attributes.map((item) => `${item.providerKey}:${item.value}`)).toEqual(['a-provider:A', 'z-provider:Z']);
    expect(merged.events.map((item) => `${item.providerKey}:${item.externalId}`)).toEqual(['a-provider:1', 'z-provider:2']);
  });
});
