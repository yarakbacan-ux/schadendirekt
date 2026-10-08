import { isIP } from 'node:net';

export function getClientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY !== 'true') return 'untrusted-proxy';

  const forwarded = headers.get('x-forwarded-for');
  const candidate = forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || '';
  return isIP(candidate) ? candidate : 'unknown';
}
