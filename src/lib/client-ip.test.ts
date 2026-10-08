import { afterEach, describe, expect, it } from 'vitest';
import { getClientIp } from './client-ip';

const originalTrustProxy = process.env.TRUST_PROXY;

afterEach(() => {
  if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = originalTrustProxy;
});

describe('getClientIp', () => {
  it('does not trust forwarded headers by default', () => {
    delete process.env.TRUST_PROXY;
    expect(getClientIp(new Headers({ 'x-forwarded-for': '203.0.113.10' }))).toBe('untrusted-proxy');
  });

  it('accepts a valid first forwarded address only when proxy trust is enabled', () => {
    process.env.TRUST_PROXY = 'true';
    expect(getClientIp(new Headers({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }))).toBe('203.0.113.10');
    expect(getClientIp(new Headers({ 'x-forwarded-for': 'not-an-ip' }))).toBe('unknown');
  });
});
