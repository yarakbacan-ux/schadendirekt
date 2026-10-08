import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDvsaClient, DvsaApiError } from '@/lib/dvsa-client';

afterEach(() => vi.unstubAllEnvs());

function configure() {
  vi.stubEnv('DVSA_CLIENT_ID', 'client');
  vi.stubEnv('DVSA_CLIENT_SECRET', 'secret');
  vi.stubEnv('DVSA_SCOPE_URL', 'scope');
  vi.stubEnv('DVSA_TOKEN_URL', 'https://login.example/token');
  vi.stubEnv('DVSA_API_KEY', 'api-key');
  vi.stubEnv('DVSA_BASE_URL', 'https://history.example');
}

describe('DVSA API error semantics', () => {
  it('treats the official vehicle-not-found code as a real empty result', async () => {
    configure();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errorCode: 'MOTH-NF-01' }), { status: 404 }));
    const client = createDvsaClient({ fetchImpl, tokenProvider: async () => 'token', retries: 0 });
    await expect(client.getVehicleByVin('WBA12345678901234')).resolves.toBeNull();
  });

  it.each([
    [401, 'MOTH-UD-01'],
    [403, 'MOTH-FB-01']
  ])('does not convert HTTP 5s into no-data', async (status, code) => {
    configure();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errorCode: code }), { status }));
    const client = createDvsaClient({ fetchImpl, tokenProvider: async () => 'token', retries: 0 });
    await expect(client.getVehicleByVin('WBA12345678901234')).rejects.toMatchObject({ status, code });
  });

  it('retries 429 with backoff and keeps it an explicit error when exhausted', async () => {
    configure();
    const fetchImpl = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ errorCode: 'MOTH-RL-02' }), { status: 429 })
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createDvsaClient({ fetchImpl, tokenProvider: async () => 'token', sleep, retries: 1 });
    try {
      await client.getVehicleByVin('WBA12345678901234');
      throw new Error('expected DVSA error');
    } catch (error) {
      expect(error).toBeInstanceOf(DvsaApiError);
      expect(error).toMatchObject({ status: 429, code: 'MOTH-RL-02', retryable: true });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
