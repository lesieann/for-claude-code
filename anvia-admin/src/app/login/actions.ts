'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE, createSessionToken, sessionMaxAge } from '@/lib/auth';

export async function login(f: FormData) {
  const pw = String(f.get('password') ?? '');
  const expected = process.env.ADMIN_PASSWORD ?? '';
  const next = String(f.get('next') ?? '/admin');
  const a = Buffer.from(pw), b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) redirect('/login?err=1');
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: sessionMaxAge,
  });
  redirect(next.startsWith('/admin') ? next : '/admin');
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
