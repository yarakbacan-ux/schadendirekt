import { describe, expect, it } from 'vitest';
import { InMemoryRateLimitStore } from './rate-limit';

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
});
