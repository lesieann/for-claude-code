import 'server-only';
import { store } from './store';

/** 付款完成：回寫付款、訂單（未付款→待處理）或出貨單（二補已付）。NotifyURL 與手動標記共用。 */
export async function applyPaid(paymentId: number, extra: { trade_no?: string; raw?: unknown } = {}) {
  const s = store();
  const p = await s.update('payments', paymentId, {
    status: 'paid',
    paid_at: new Date().toISOString(),
    ...(extra.trade_no ? { trade_no: extra.trade_no } : {}),
    ...(extra.raw ? { raw_notify: extra.raw } : {}),
  });
  if (p.kind === 'order') {
    const o = await s.get('orders', p.ref_id);
    if (o && o.status === '未付款') await s.update('orders', o.id, { status: '待處理' });
  } else {
    await s.update('shipments', p.ref_id, { paid: true });
  }
}
