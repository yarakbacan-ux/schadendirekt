import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createSession, destroySession, revokeUserSessions, SESSION_COOKIE } from './auth';

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const userIds: string[] = [];

afterEach(async () => {
  for (const id of userIds.splice(0)) await db.user.deleteMany({ where: { id } });
});

async function createUser() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await db.user.create({
    data: {
      email: `auth-${suffix}@example.test`,
      passwordHash: 'test-only-hash',
      role: 'ADMIN'
    }
  });
  userIds.push(user.id);
  return user;
}

describeDb('session revoke', () => {
  it('destroySession removes the server-side session used by logout', async () => {
    const user = await createUser();
    const session = await createSession(user.id);
    await destroySession(`${SESSION_COOKIE}=${encodeURIComponent(session.token)}`);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('revokes all active sessions for the current user', async () => {
    const user = await createUser();
    await createSession(user.id);
    await createSession(user.id);
    expect(await revokeUserSessions(user.id)).toBe(2);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });
});
