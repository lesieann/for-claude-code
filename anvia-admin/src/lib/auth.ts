// 管理端登入：單一密碼（ADMIN_PASSWORD），以 HMAC 簽章 cookie 維持登入。
// 使用 Web Crypto，middleware（Edge）與 Node 都能用。

export const SESSION_COOKIE = 'anvia_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 14;

const enc = new TextEncoder();

async function hmac(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSessionToken(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  return `${exp}.${await hmac(String(exp))}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token || !process.env.ADMIN_PASSWORD) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = await hmac(exp);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export const sessionMaxAge = MAX_AGE_SEC;
