import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import { db } from '@/lib/db';

export const SESSION_COOKIE = 'sd_session';
export const CSRF_COOKIE = 'sd_csrf';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfTokenHash: sha256(csrfToken),
      expiresAt
    }
  });
  return { token, csrfToken, expiresAt };
}

export async function getSession(cookieHeader: string | null) {
  const token = cookieValue(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true }
  });
  if (!session || !session.user.active || session.expiresAt <= new Date()) return null;
  return session;
}

export async function destroySession(cookieHeader: string | null): Promise<void> {
  const token = cookieValue(cookieHeader, SESSION_COOKIE);
  if (!token) return;
  await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function cleanupExpiredSessions(): Promise<void> {
  await db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
}

export function roleAllowed(role: UserRole, allowed: UserRole[]): boolean {
  return allowed.includes(role);
}

export function verifyCsrf(request: Request, csrfTokenHash: string): boolean {
  const method = request.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;

  const requestOrigin = request.headers.get('origin');
  if (!requestOrigin || requestOrigin !== new URL(request.url).origin) return false;

  const headerToken = request.headers.get('x-csrf-token');
  const cookieToken = cookieValue(request.headers.get('cookie'), CSRF_COOKIE);
  if (!headerToken || !cookieToken || headerToken !== cookieToken) return false;

  const expected = Buffer.from(csrfTokenHash, 'hex');
  const actual = Buffer.from(sha256(headerToken), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function requireRequestRole(request: Request, allowed: UserRole[]) {
  const session = await getSession(request.headers.get('cookie'));
  if (!session || !roleAllowed(session.user.role, allowed)) return null;
  return session;
}
