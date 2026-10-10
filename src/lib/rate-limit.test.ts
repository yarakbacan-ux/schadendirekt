import { describe, expect, it } from 'vitest';
import {
  InMemoryRateLimitStore,
  RedisRateLimitStore,
  createRateLimitStoreFromEnv,
  getRateLimitStoreHealth,
  type RedisEvalClient
} from './rate-limit';

describe('RateLimitStore', () => {
  it('enforces limits and resets after the window', async () => {
    const store = new InMemoryRateLimitStore();
    expect((await store.consume('client', 2, 1000, 1000)).allowed).toBe(true);
    expect((await store.consume('client', 2, 1000, 1100)).allowed).toBe(true);
    expect((await store.consume('client', 2, 1000, 1200)).allowed).toBe(false);
    expect((await store.consume('client', 2, 1000, 2000)).allowed).toBe(true);
  });

  it('blocks mass public VIN lookups after the configured threshold', async () => {
    const store = new InMemoryRateLimitStore();
    for (let index = 0; index < 120; index += 1) {
      expect((await store.consume('vin:203.0.113.10', 120, 60_000, 1_000 + index)).allowed).toBe(true);
    }
    expect((await store.consume('vin:203.0.113.10', 120, 60_000, 2_000)).allowed).toBe(false);
  });

  it('shares Redis counters across independent store instances', async () => {
    let count = 0;
    const client: RedisEvalClient = {
      async eval() {
        count += 1;
        return [count, 60_000];
      }
    };
    const first = new RedisRateLimitStore(client);
    const second = new RedisRateLimitStore(client);
    expect((await first.consume('provider:dvsa', 1, 60_000)).allowed).toBe(true);
    expect((await second.consume('provider:dvsa', 1, 60_000)).allowed).toBe(false);
  });

  it('fails production closed when no shared store is configured', () => {
    expect(() => createRateLimitStoreFromEnv({ NODE_ENV: 'production' })).toThrow('RATE_LIMIT_SHARED_STORE_REQUIRED');
    expect(getRateLimitStoreHealth({ NODE_ENV: 'production' })).toEqual({
      ok: false,
      mode: 'unavailable',
      reason: 'RATE_LIMIT_SHARED_STORE_REQUIRED'
    });
  });

  it('allows in-memory only outside production and validates Redis configuration', () => {
    expect(createRateLimitStoreFromEnv({ NODE_ENV: 'test' })).toBeInstanceOf(InMemoryRateLimitStore);
    expect(() => createRateLimitStoreFromEnv({ NODE_ENV: 'production', RATE_LIMIT_STORE: 'redis-rest' })).toThrow('RATE_LIMIT_REDIS_CONFIG_MISSING');
    expect(createRateLimitStoreFromEnv({
      NODE_ENV: 'production',
      RATE_LIMIT_STORE: 'redis-rest',
      REDIS_REST_URL: 'https://redis.example.test',
      REDIS_REST_TOKEN: 'test-only-token'
    })).toBeInstanceOf(RedisRateLimitStore);
  });
});
