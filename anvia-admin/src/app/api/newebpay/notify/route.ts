import { store } from '@/lib/store';
import { parseNotify } from '@/lib/newebpay';
import { newebKeys } from '@/lib/neweb-keys';
import { applyPaid } from '@/lib/payments';

// 藍新 NotifyURL：驗章 → 比對金額 → 回寫付款狀態
export async function POST(req: Request) {
  const keys = await newebKeys();
  if (!keys) return new Response('not configured', { status: 503 });
  const form = await req.formData();
  let n;
  try {
    n = parseNotify({ TradeInfo: String(form.get('TradeInfo') ?? ''), TradeSha: String(form.get('TradeSha') ?? '') }, keys);
  } catch {
    return new Response('bad signature', { status: 400 });
  }
  const p = (await store().list('payments')).find((x) => x.merchant_order_no === n.Result.MerchantOrderNo);
  if (!p) return new Response('unknown order', { status: 404 });
  if (n.Status !== 'SUCCESS') {
    await store().update('payments', p.id, { status: 'failed', raw_notify: n });
    return new Response('OK');
  }
  if (Number(n.Result.Amt) !== p.amount) return new Response('amount mismatch', { status: 400 });
  if (p.status !== 'paid') await applyPaid(p.id, { trade_no: n.Result.TradeNo, raw: n });
  return new Response('OK');
}
