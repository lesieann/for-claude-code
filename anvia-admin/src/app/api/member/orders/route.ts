import { store } from '@/lib/store';
import { verifyIdToken } from '@/lib/line';
import { orderNumber } from '@/lib/formulas';

// 客人會員頁 API：以 LINE ID token 換 userId，回傳該客戶全部訂單（不含利潤）
export async function POST(req: Request) {
  const { idToken } = (await req.json().catch(() => ({}))) as { idToken?: string };
  let uid: string;
  const dev = process.env.NODE_ENV !== 'production' ? process.env.MEMBER_DEV_UID : undefined;
  try {
    uid = dev && idToken === 'dev' ? dev : await verifyIdToken(idToken ?? '');
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 401 });
  }
  const s = store();
  const c = (await s.list('customers')).find((x) => x.line_uid === uid);
  if (!c) return Response.json({ error: '查無會員資料，請聯繫小安綁定 LINE' }, { status: 404 });
  const [orders, batches, payments, shipments] = await Promise.all([s.list('orders'), s.list('batches'), s.list('payments'), s.list('shipments')]);
  const bname = new Map(batches.map((b) => [b.id, b.name]));
  const mine = orders.filter((o) => o.customer_id === c.id).sort((a, b) => b.id - a.id);
  const myShip = shipments.filter((x) => x.customer_id === c.id);
  const pays = payments.filter((p) => (p.kind === 'order' && mine.some((o) => o.id === p.ref_id)) || (p.kind === 'supplement' && myShip.some((x) => x.id === p.ref_id)));
  return Response.json({
    name: c.name,
    orders: mine.map((o) => ({ no: orderNumber(o.order_date || o.created_at, o.oid ?? o.id), title: o.title, platform: o.platform, price: o.price, status: o.status, batch: o.batch_id ? bname.get(o.batch_id) : null, date: o.order_date })),
    payments: pays.map((p) => ({ no: p.merchant_order_no, kind: p.kind, amount: p.amount, method: p.method, status: p.status, url: `/pay/${p.merchant_order_no}` })),
  });
}
