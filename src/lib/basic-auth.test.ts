import { afterEach, describe, expect, it } from 'vitest';
import { hasValidAdminCredentials, parseBasicAuth } from './basic-auth';

function basic(value: string) {
  return `Basic ${btoa(value)}`;
}

describe('Basic Auth helpers', () => {
  afterEach(() => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
  });

  it('parses valid credentials and preserves colons in the password', () => {
    expect(parseBasicAuth(basic('admin@example.test:pa:ss'))).toEqual({
      username: 'admin@example.test',
      password: 'pa:ss'
    });
  });

  it('rejects malformed authorization headers', () => {
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth('Bearer token')).toBeNull();
    expect(parseBasicAuth(basic('missing-separator'))).toBeNull();
  });

  it('requires configured and matching admin credentials', () => {
    process.env.ADMIN_EMAIL = 'admin@example.test';
    process.env.ADMIN_PASSWORD = 'secret';

    expect(hasValidAdminCredentials(basic('admin@example.test:secret'))).toBe(true);
    expect(hasValidAdminCredentials(basic('admin@example.test:wrong'))).toBe(false);
  });
});
