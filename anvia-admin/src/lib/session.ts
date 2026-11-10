import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from './auth';

/** 每個 server action 開頭都要呼叫：未登入就導回登入頁 */
export async function requireAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token))) redirect('/login');
}
