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
    const status = getDvsaConfigurationStatus({ NODE_ENV: 'test', DVSA_CLIENT_ID: 'id' });
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

  it('retries token timeouts with a bounded retry count', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    });
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const getToken = createDvsaTokenProvider({ fetchImpl: fetchImpl as typeof fetch, timeoutMs: 5, maxRetries: 1, sleep });

    await expect(getToken(config)).rejects.toThrow('DVSA_TOKEN_TIMEOUT');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('honours retryable 429/5xx responses and Retry-After before succeeding', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token-after-retry', expires_in: 120 }), { status: 200 }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const getToken = createDvsaTokenProvider({ fetchImpl, maxRetries: 2, baseRetryDelayMs: 1, sleep });

    await expect(getToken(config)).resolves.toBe('token-after-retry');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]?.[0]).toBe(0);
  });

  it.each([400, 401])('does not retry permanent credential HTTP %s errors', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const getToken = createDvsaTokenProvider({ fetchImpl, maxRetries: 3, sleep });

    await expect(getToken(config)).rejects.toThrow(`DVSA_TOKEN_HTTP_${status}`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
