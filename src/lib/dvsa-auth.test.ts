import { describe, expect, it, vi } from 'vitest';
import { createDvsaTokenProvider, getDvsaConfigurationStatus, type DvsaConfig } from '@/lib/dvsa-auth';

const config: DvsaConfig = {
  clientId: 'client',
  clientSecret: 'secret',
  scope: 'scope/.default',
  tokenUrl: 'https://login.example/token',
  apiKey: 'api-key',
  baseUrl: 'https://history.example'
};

describe('DVSA configuration', () => {
  it('reports missing credential names without exposing values', () => {
    const status = getDvsaConfigurationStatus({ DVSA_CLIENT_ID: 'id' } as NodeJS.ProcessEnv);
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(expect.arrayContaining(['DVSA_CLIENT_SECRET', 'DVSA_API_KEY']));
  });
});

describe('DVSA access-token cache', () => {
  it('reuses a valid token and refreshes shortly before expiry', async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-1', expires_in: 120 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-2', expires_in: 120 }), { status: 200 }));
    const getToken = createDvsaTokenProvider({ fetchImpl, now: () => now, refreshSkewMs: 60_000 });

    expect(await getToken(config)).toBe('token-1');
    now += 30_000;
    expect(await getToken(config)).toBe('token-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 31_000;
    expect(await getToken(config)).toBe('token-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
