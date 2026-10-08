import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/admin')) return NextResponse.next();

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) {
    return new NextResponse('Authentication required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Schadendirekt Admin"' }
    });
  }

  const decoded = atob(auth.slice(6));
  const separator = decoded.indexOf(':');
  const email = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (
    email !== process.env.ADMIN_EMAIL ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Schadendirekt Admin"' }
    });
  }

  return NextResponse.next();
}

export const config = { matcher: ['/admin/:path*'] };
