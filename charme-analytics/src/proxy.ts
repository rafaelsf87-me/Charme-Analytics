import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const cookie = request.cookies.get('charme_auth');

  if (!cookie?.value) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/chat/:path*', '/home/:path*', '/criativos/:path*', '/avaliacoes/:path*'],
};
