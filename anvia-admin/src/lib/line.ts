import 'server-only';
import { getSecret } from './secrets';

/** LINE Messaging API push。token 只在後端讀取。 */
export async function linePush(to: string, messages: unknown[]) {
  const token = await getSecret('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) throw new Error('尚未設定 LINE Channel Access Token（環境變數或設定頁）');
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) throw new Error(`LINE 回應 ${res.status}：${await res.text()}`);
}

/** 驗證 LIFF 取得的 ID token，回傳 LINE userId */
export async function verifyIdToken(idToken: string): Promise<string> {
  const clientId = await getSecret('LINE_LOGIN_CHANNEL_ID');
  if (!clientId) throw new Error('尚未設定 LINE Login Channel ID');
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
  });
  if (!res.ok) throw new Error('LINE 登入驗證失敗');
  const j = (await res.json()) as { sub?: string };
  if (!j.sub) throw new Error('LINE 登入驗證失敗');
  return j.sub;
}

/** {{name}} 變數帶入 */
export function fillName(text: string, name: string) {
  return text.replaceAll('{{name}}', name);
}
