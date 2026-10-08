import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { createSession, CSRF_COOKIE, SESSION_COOKIE } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

async function auditLogin(input: {
  userId?: string;
  email: string;
  success: boolean;
  reason?: string;
  ip: string;
  userAgent: string | null;
}) {
  await db.authAuditLog.create({
    data: {
      userId: input.userId,
      email: input.email,
      success: input.success,
      reason: input.reason,
      ip: input.ip,
      userAgent: input.userAgent
    }
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'ORIGIN_REJECTED' }, { status: 403 });
  }

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get('user-agent');
  const limit = await rateLimit(`login:${ip}:${email}`, 5, 15 * 60_000);
  if (!limit.allowed) {
    await auditLogin({ email, success: false, reason: 'RATE_LIMITED', ip, userAgent });
    return NextResponse.redirect(new URL('/admin/login?error=rate', request.url), 303);
  }

  const user = await db.user.findUnique({ where: { email } });
  const valid = Boolean(user?.active) && Boolean(user && await verifyPassword(password, user.passwordHash));
  if (!user || !valid) {
    await auditLogin({ userId: user?.id, email, success: false, reason: 'INVALID_CREDENTIALS', ip, userAgent });
    return NextResponse.redirect(new URL('/admin/login?error=credentials', request.url), 303);
  }

  const session = await createSession(user.id);
  await auditLogin({ userId: user.id, email, success: true, ip, userAgent });

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
