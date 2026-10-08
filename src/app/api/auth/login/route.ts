import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { createSession, CSRF_COOKIE, SESSION_COOKIE } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'ORIGIN_REJECTED' }, { status: 403 });
  }

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const limit = rateLimit(`login:${ip}:${email}`, 5, 15 * 60_000);
  if (!limit.allowed) {
    return NextResponse.redirect(new URL('/admin/login?error=rate', request.url), 303);
  }

  const user = await db.user.findUnique({ where: { email } });
  const valid = user?.active && await verifyPassword(password, user.passwordHash);
  if (!user || !valid) {
    return NextResponse.redirect(new URL('/admin/login?error=credentials', request.url), 303);
  }

  const session = await createSession(user.id);
  const response = NextResponse.redirect(new URL('/admin', request.url), 303);
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: session.expiresAt
  });
  response.cookies.set(CSRF_COOKIE, session.csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: session.expiresAt
  });
  return response;
}
