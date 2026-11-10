import crypto from 'node:crypto';

/**
 * 藍新 NewebPay MPG（幕前支付）。
 * TradeInfo = AES-256-CBC(querystring) hex；TradeSha = SHA256("HashKey=..&{TradeInfo}&HashIV=..") 大寫。
 */
export interface NewebKeys {
  merchantId: string;
  hashKey: string;
  hashIV: string;
  env: 'sandbox' | 'production';
}

export const gatewayUrl = (env: NewebKeys['env']) =>
  env === 'production' ? 'https://core.newebpay.com/MPG/mpg_gateway' : 'https://ccore.newebpay.com/MPG/mpg_gateway';

export const queryUrl = (env: NewebKeys['env']) =>
  env === 'production' ? 'https://core.newebpay.com/API/QueryTradeInfo' : 'https://ccore.newebpay.com/API/QueryTradeInfo';

export function encryptTradeInfo(params: Record<string, string | number>, k: Pick<NewebKeys, 'hashKey' | 'hashIV'>): string {
  const qs = new URLSearchParams(Object.entries(params).map(([a, b]) => [a, String(b)])).toString();
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(k.hashKey), Buffer.from(k.hashIV));
  return c.update(qs, 'utf8', 'hex') + c.final('hex');
}

export function decryptTradeInfo(hex: string, k: Pick<NewebKeys, 'hashKey' | 'hashIV'>): string {
  const d = crypto.createDecipheriv('aes-256-cbc', Buffer.from(k.hashKey), Buffer.from(k.hashIV));
  d.setAutoPadding(false);
  const raw = Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]);
  const pad = raw[raw.length - 1];
  const body = pad > 0 && pad <= 32 ? raw.subarray(0, raw.length - pad) : raw;
  return body.toString('utf8').replace(/[\x00-\x1f]+$/, '');
}

export function tradeSha(tradeInfo: string, k: Pick<NewebKeys, 'hashKey' | 'hashIV'>): string {
  return crypto.createHash('sha256').update(`HashKey=${k.hashKey}&${tradeInfo}&HashIV=${k.hashIV}`).digest('hex').toUpperCase();
}

/** 藍新訂單編號：英數與底線、≤30 字 */
export function newMerchantOrderNo(prefix = 'AV'): string {
  const t = new Date();
  const ts = `${t.getFullYear() % 100}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}`;
  return `${prefix}${ts}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

export interface MpgForm {
  action: string;
  fields: { MerchantID: string; TradeInfo: string; TradeSha: string; Version: string };
}

export function buildMpgForm(
  k: NewebKeys,
  o: { merchantOrderNo: string; amount: number; itemDesc: string; method: 'ATM' | 'CVS'; notifyUrl: string; returnUrl: string; email?: string },
): MpgForm {
  const params: Record<string, string | number> = {
    MerchantID: k.merchantId,
    RespondType: 'JSON',
    TimeStamp: Math.floor(Date.now() / 1000),
    Version: '2.0',
    MerchantOrderNo: o.merchantOrderNo,
    Amt: o.amount,
    ItemDesc: o.itemDesc.slice(0, 50),
    NotifyURL: o.notifyUrl,
    ReturnURL: o.returnUrl,
    Email: o.email ?? '',
    EmailModify: 1,
    LoginType: 0,
    ...(o.method === 'ATM' ? { VACC: 1 } : { CVS: 1 }),
  };
  const TradeInfo = encryptTradeInfo(params, k);
  return { action: gatewayUrl(k.env), fields: { MerchantID: k.merchantId, TradeInfo, TradeSha: tradeSha(TradeInfo, k), Version: '2.0' } };
}

export interface NotifyResult {
  Status: string;
  Message: string;
  Result: { MerchantOrderNo: string; Amt: number; TradeNo: string; PaymentType?: string; PayTime?: string };
}

/** 驗證並解開 NotifyURL 回傳；TradeSha 不符時丟出例外 */
export function parseNotify(body: { TradeInfo?: string; TradeSha?: string }, k: Pick<NewebKeys, 'hashKey' | 'hashIV'>): NotifyResult {
  if (!body.TradeInfo || !body.TradeSha) throw new Error('缺少 TradeInfo/TradeSha');
  if (tradeSha(body.TradeInfo, k) !== body.TradeSha) throw new Error('TradeSha 驗證失敗');
  const text = decryptTradeInfo(body.TradeInfo, k);
  const data = JSON.parse(text) as NotifyResult & { Result: string | NotifyResult['Result'] };
  if (typeof data.Result === 'string') data.Result = JSON.parse(data.Result);
  return data as NotifyResult;
}

/** QueryTradeInfo 的 CheckValue */
export function queryCheckValue(k: NewebKeys, merchantOrderNo: string, amount: number): string {
  const s = `IV=${k.hashIV}&Amt=${amount}&MerchantID=${k.merchantId}&MerchantOrderNo=${merchantOrderNo}&Key=${k.hashKey}`;
  return crypto.createHash('sha256').update(s).digest('hex').toUpperCase();
}
