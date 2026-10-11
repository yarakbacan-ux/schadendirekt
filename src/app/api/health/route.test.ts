import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  rateHealth: vi.fn(),
  rateConsume: vi.fn(),
  storageHealth: vi.fn(),
  storagePut: vi.fn(),
  storageRead: vi.fn(),
  storageDelete: vi.fn()
}));

vi.mock('@/lib/db', () => ({ db: { $queryRaw: mocks.queryRaw } }));
vi.mock('@/lib/rate-limit', () => ({
  getRateLimitStoreHealth: mocks.rateHealth,
  getRateLimitStore: () => ({ consume: mocks.rateConsume })
}));
vi.mock('@/lib/import-storage', () => ({
  getImportStorageHealth: mocks.storageHealth,
  getImportStorage: () => ({
    put: mocks.storagePut,
    readText: mocks.storageRead,
    delete: mocks.storageDelete
  })
}));

async function requestHealth() {
  // The route caches probes per module instance, so isolate every test.
  vi.resetModules();
  const { GET } = await import('@/app/api/health/route');
  const response = await GET();
  return { response, body: await response.json() };
}

describe('GET /api/health readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([{ user_table: 'User', migrations_table: '_prisma_migrations' }])
      .mockResolvedValueOnce([{ missing: 0n, failed: 0n, latest: true }]);
    mocks.rateHealth.mockReturnValue({ ok: true, mode: 'redis-rest' });
    mocks.rateConsume.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 });
    mocks.storageHealth.mockReturnValue({ ok: true, provider: 's3' });
    mocks.storagePut.mockResolvedValue({ provider: 's3' });
    mocks.storageRead.mockImplementation(async () => {
      const args = mocks.storagePut.mock.calls.at(-1);
      // Return the exact marker written by the readiness probe.
      return args?.[1];
    });
    mocks.storageDelete.mockResolvedValue(undefined);
  });

  it('returns 200 only when database, schema, shared rate limit and object storage work', async () => {
    const { response, body } = await requestHealth();
    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.schema.ok).toBe(true);
    expect(body.checks.rateLimit.ok).toBe(true);
    expect(body.checks.objectStorage.connectivityVerified).toBe(true);
    expect(mocks.storageDelete).toHaveBeenCalledOnce();
  });

  it('fails closed when the database schema is missing', async () => {
    mocks.queryRaw.mockReset().mockResolvedValueOnce([{ '?column?': 1 }])
      .mockResolvedValueOnce([{ user_table: null, migrations_table: null }]);
    const { response, body } = await requestHealth();
    expect(response.status).toBe(503);
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.schema.ok).toBe(false);
  });

  it('fails closed when the shared rate-limit backend is not configured', async () => {
    mocks.rateHealth.mockReturnValue({ ok: false, mode: 'unavailable' });
    const { response, body } = await requestHealth();
    expect(response.status).toBe(503);
    expect(body.checks.rateLimit.ok).toBe(false);
    expect(mocks.rateConsume).not.toHaveBeenCalled();
  });

  it('fails closed when object storage cannot roundtrip the marker', async () => {
    mocks.storageRead.mockResolvedValue('wrong-marker');
    const { response, body } = await requestHealth();
    expect(response.status).toBe(503);
    expect(body.checks.objectStorage.ok).toBe(false);
    expect(mocks.storageDelete).toHaveBeenCalledOnce();
  });

  it('fails closed when probe object cleanup fails', async () => {
    mocks.storageDelete.mockRejectedValue(new Error('secret backend error'));
    const { response, body } = await requestHealth();
    expect(response.status).toBe(503);
    expect(body.checks.objectStorage.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain('secret backend error');
  });
  it('fails closed on database connection failure', async () => {
    mocks.queryRaw.mockReset().mockRejectedValue(new Error('secret database URL'));
    const { response, body } = await requestHealth();
    expect(response.status).toBe(503);
    expect(body.checks.database.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain('secret database URL');
  });

  it('fails closed on Redis connectivity failure', async () => {
    mocks.rateConsume.mockRejectedValue(new Error('secret redis URL'));
    const { response, body } = await requestHealth();
    expect(response.status).toBe(503);
    expect(body.checks.rateLimit.ok).toBe(false);
    expect(JSON.stringify(body)).not.toContain('secret redis URL');
  });

  it('does not claim readiness for an incomplete migration or schema', async () => {
    mocks.queryRaw.mockReset().mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{ user_table: 'User', migrations_table: '_prisma_migrations' }])
      .mockResolvedValueOnce([{ missing: 1n, failed: 1n, latest: false }]);
    const { response, body } = await requestHealth();
    expect(response.status).toBe(503);
    expect(body.checks.schema.ok).toBe(false);
  });

  it('reports missing optional provider credentials separately from infrastructure readiness', async () => {
    const { response, body } = await requestHealth();
    expect(response.status).toBe(200);
    expect(body.checks.providerConfiguration.required).toBe(false);
    expect(body.checks.providerConfiguration.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'dvsa-mot', configured: false })
    ]));
  });

});
