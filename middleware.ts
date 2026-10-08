import { NextRequest, NextResponse } from 'next/server';
import { hasValidAdminCredentials } from '@/lib/basic-auth';

function unauthorized() {
  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Schadendirekt Admin"' }
  });
}

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/admin')) return NextResponse.next();

  if (!hasValidAdminCredentials(request.headers.get('authorization'))) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*'] };
