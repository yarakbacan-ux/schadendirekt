import { NextResponse } from 'next/server';
import { CSRF_COOKIE, SESSION_COOKIE, requireRequestRole, revokeUserSessions, verifyCsrf } from '@/lib/auth';

export async function POST(request: Request) {
  const session = await requireRequestRole(request, ['ADMIN', 'ANALYST', 'VIEWER']);
  if (!session) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (!verifyCsrf(request, session.csrfTokenHash)) {
    return NextResponse.json({ error: 'CSRF_REJECTED' }, { status: 403 });
  }

  const revoked = await revokeUserSessions(session.userId);
  const response = NextResponse.json({ ok: true, revoked });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0
  });
  response.cookies.set(CSRF_COOKIE, '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0
  });
  return response;
}
