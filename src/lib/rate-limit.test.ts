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
});
