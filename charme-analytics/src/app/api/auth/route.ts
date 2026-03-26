import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

const COOKIE_NAME = 'charme_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 dias

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.password) {
    return NextResponse.json({ error: 'Senha obrigatória' }, { status: 400 });
  }

  const expectedPassword = process.env.AUTH_PASSWORD;
  if (!expectedPassword) {
    return NextResponse.json({ error: 'Servidor mal configurado' }, { status: 500 });
  }

  if (body.password !== expectedPassword) {
    return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 });
  }

  const cookieValue = hashPassword(expectedPassword);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });

  return response;
}
