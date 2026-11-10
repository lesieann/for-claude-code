import 'server-only';
import { store } from './store';

/**
 * 金鑰讀取：環境變數優先，其次是後台「設定」頁存入資料庫的值。
 * 金鑰絕不寫進程式碼；畫面上只顯示末 4 碼。
 */
export const SECRET_KEYS = {
  NEWEBPAY_MERCHANT_ID: '藍新 MerchantID',
  NEWEBPAY_HASH_KEY: '藍新 HashKey',
  NEWEBPAY_HASH_IV: '藍新 HashIV',
  LINE_CHANNEL_ACCESS_TOKEN: 'LINE Channel Access Token',
  LINE_LOGIN_CHANNEL_ID: 'LINE Login Channel ID',
} as const;
export type SecretKey = keyof typeof SECRET_KEYS;

export async function getSecret(k: SecretKey): Promise<string | null> {
  const env = process.env[k];
  if (env) return env;
  const saved = await store().getSetting<Record<string, string>>('secrets');
  return saved?.[k] || null;
}

export async function secretStatus() {
  const saved = (await store().getSetting<Record<string, string>>('secrets')) ?? {};
  return (Object.keys(SECRET_KEYS) as SecretKey[]).map((k) => {
    const env = process.env[k];
    const v = env || saved[k];
    return { key: k, label: SECRET_KEYS[k], source: env ? '環境變數' : saved[k] ? '後台設定' : null, tail: v ? v.slice(-4) : null };
  });
}

export function mask(v: string | null | undefined) {
  return v ? `••••${v.slice(-4)}` : '未設定';
}
