'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { store } from '@/lib/store';
import * as F from '@/lib/formulas';
import { batchPerKgMap, shipmentLines } from '@/lib/data';
import { newMerchantOrderNo } from '@/lib/newebpay';
import { linePush, fillName } from '@/lib/line';
import { SECRET_KEYS, type SecretKey } from '@/lib/secrets';
import { requireAdmin } from '@/lib/session';
import { applyPaid } from '@/lib/payments';
import { ORDER_STATUSES, type Order, type OrderStatus } from '@/lib/types';

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === null ? null : Number(v);
};
const bool = (f: FormData, k: string) => f.get(k) === 'on';
const ids = (f: FormData, k = 'ids') => f.getAll(k).map(Number).filter(Boolean);

function back(path: string, msg?: string): never {
  revalidatePath('/admin', 'layout');
  redirect(msg ? `${path}${path.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}` : path);
}

/* ── 客戶 ───────────────────────────── */
export async function saveCustomer(f: FormData) {
  await requireAdmin();
  const id = num(f, 'id');
  const data = {
    name: str(f, 'name') ?? '',
    real_name: str(f, 'real_name'),
    line_uid: str(f, 'line_uid'),
    line_id: str(f, 'line_id'),
    phone: str(f, 'phone'),
    email: str(f, 'email'),
    location: str(f, 'location'),
    source_date: str(f, 'source_date'),
  };
  if (!data.name) back('/admin/customers', '暱稱必填');
  const all = await store().list('customers');
  if (data.line_uid && all.some((c) => c.line_uid === data.line_uid && c.id !== id)) back('/admin/customers', '此 LINE userId 已屬於其他客戶');
  if (id) {
    await store().update('customers', id, data);
    back(`/admin/customers/${id}`, '已儲存');
  }
  const c = await store().insert('customers', data);
  back(`/admin/customers/${c.id}`, '已新增客戶');
}

export async function deleteCustomer(f: FormData) {
  await requireAdmin();
  const id = num(f, 'id')!;
  const orders = await store().list('orders');
  if (orders.some((o) => o.customer_id === id)) back(`/admin/customers/${id}`, '此客戶還有訂單，無法刪除');
  await store().remove('customers', id);
  back('/admin/customers', '已刪除');
}

/* ── 訂單 ───────────────────────────── */
export async function saveOrder(f: FormData) {
  await requireAdmin();
  const id = num(f, 'id');
  const status = (str(f, 'status') ?? '待處理') as OrderStatus;
  if (!ORDER_STATUSES.includes(status)) back('/admin/orders', '狀態不正確');
  const data = {
    customer_id: num(f, 'customer_id'),
    title: str(f, 'title') ?? '',
    platform: str(f, 'platform'),
    url: str(f, 'url'),
    price: num(f, 'price'),
    weight_kg: num(f, 'weight_kg'),
    debt: num(f, 'debt') ?? 0,
    status,
    order_date: str(f, 'order_date'),
    batch_id: num(f, 'batch_id'),
    note: str(f, 'note'),
    purchased: bool(f, 'purchased'),
    stocked: bool(f, 'stocked'),
    arrived: bool(f, 'arrived'),
    shipped: bool(f, 'shipped'),
  };
  if (!data.title) back('/admin/orders', '商品名稱必填');
  if (id) {
    await store().update('orders', id, data);
    back(`/admin/orders/${id}`, '已儲存');
  }
  const all = await store().list('orders');
  const oid = Math.max(0, ...all.map((o) => o.oid ?? o.id)) + 1;
  const o = await store().insert('orders', { ...data, oid, shipment_id: null });
  back(`/admin/orders/${o.id}`, '已新增訂單');
}

export async function deleteOrder(f: FormData) {
  await requireAdmin();
  await store().remove('orders', num(f, 'id')!);
  back('/admin/orders', '已刪除');
}

/** 批次操作：改狀態 / 放進批次 */
export async function bulkOrders(f: FormData) {
  await requireAdmin();
  const list = ids(f);
  const ret = str(f, 'return') ?? '/admin/orders';
  if (!list.length) back(ret, '請先勾選訂單');
  const status = str(f, 'status') as OrderStatus | null;
  const batch = str(f, 'batch_id');
  const patch: Partial<Order> = {};
  if (status && ORDER_STATUSES.includes(status)) patch.status = status;
  if (batch) patch.batch_id = batch === 'none' ? null : Number(batch);
  if (!Object.keys(patch).length) back(ret, '請選擇要套用的狀態或批次');
  for (const id of list) await store().update('orders', id, patch);
  back(ret, `已更新 ${list.length} 筆`);
}

/* ── 批次 ───────────────────────────── */
export async function saveBatch(f: FormData) {
  await requireAdmin();
  const id = num(f, 'id');
  const actual = num(f, 'actual_weight');
  const carrier = (str(f, 'carrier') ?? '巧巧郎') as '台集運' | '巧巧郎';
  const data = {
    name: str(f, 'name') ?? '',
    actual_weight: actual,
    carrier,
    status: (str(f, 'status') ?? '進行中') as '進行中' | '歸檔',
    is_latest: bool(f, 'is_latest'),
    total_freight: actual ? (carrier === '台集運' ? F.freightTaiji(actual) : F.freightQiao(actual)) : null,
  };
  if (!data.name) back('/admin/batches', '批次名稱必填');
  if (data.is_latest) {
    for (const b of await store().list('batches')) if (b.is_latest && b.id !== id) await store().update('batches', b.id, { is_latest: false });
  }
  if (id) {
    await store().update('batches', id, data);
    back(`/admin/batches/${id}`, '已儲存');
  }
  const b = await store().insert('batches', data);
  back(`/admin/batches/${b.id}`, '已新增批次');
}

/* ── 出貨對帳 ───────────────────────── */
async function recalcShipment(id: number) {
  const s = store();
  const [sh, orders, batches] = await Promise.all([s.get('shipments', id), s.list('orders'), s.list('batches')]);
  if (!sh) return;
  const mine = orders.filter((o) => o.shipment_id === id);
  const c = F.shipmentCalc(shipmentLines(mine, batchPerKgMap(batches)), sh.parcel_count);
  await s.update('shipments', id, {
    total_weight: c.weightKg,
    labor_fee: c.labor,
    base_freight: c.baseFreight,
    total_due: c.due[sh.channel ?? '賣貨便'],
  });
}

export async function createShipment(f: FormData) {
  await requireAdmin();
  const list = ids(f);
  const ret = str(f, 'return') ?? '/admin/shipments';
  if (!list.length) back(ret, '請先勾選要出貨的訂單');
  const orders = (await store().list('orders')).filter((o) => list.includes(o.id));
  const custs = new Set(orders.map((o) => o.customer_id));
  if (custs.size !== 1) back(ret, '一張出貨單只能放同一位客戶的商品');
  if (orders.some((o) => o.shipment_id)) back(ret, '有訂單已在其他出貨單');
  const first = orders[0];
  const sh = await store().insert('shipments', {
    order_no: F.orderNumber(new Date(), (await store().list('shipments')).length + 1),
    customer_id: first.customer_id ?? null,
    parcel_count: null,
    channel: (str(f, 'channel') as '賣貨便' | '好賣+') ?? '賣貨便',
    paid: false,
    total_weight: null,
    labor_fee: null,
    base_freight: null,
    total_due: null,
  });
  for (const o of orders) await store().update('orders', o.id, { shipment_id: sh.id });
  await recalcShipment(sh.id);
  back(`/admin/shipments/${sh.id}`, '已建立出貨單');
}

export async function saveShipment(f: FormData) {
  await requireAdmin();
  const id = num(f, 'id')!;
  await store().update('shipments', id, {
    parcel_count: num(f, 'parcel_count'),
    channel: (str(f, 'channel') as '賣貨便' | '好賣+') ?? '賣貨便',
    paid: bool(f, 'paid'),
  });
  await recalcShipment(id);
  back(`/admin/shipments/${id}`, '已儲存並重新計算');
}

export async function removeFromShipment(f: FormData) {
  await requireAdmin();
  const id = num(f, 'id')!;
  const orderId = num(f, 'order_id')!;
  await store().update('orders', orderId, { shipment_id: null });
  await recalcShipment(id);
  back(`/admin/shipments/${id}`, '已移出');
}

export async function markShipped(f: FormData) {
  await requireAdmin();
  const id = num(f, 'id')!;
  for (const o of await store().list('orders')) if (o.shipment_id === id) await store().update('orders', o.id, { status: '已寄出', shipped: true });
  back(`/admin/shipments/${id}`, '出貨單內訂單已標記為已寄出');
}

/* ── 付款連結 ───────────────────────── */
export async function createPayment(f: FormData) {
  await requireAdmin();
  const kind = str(f, 'kind') as 'order' | 'supplement';
  const refId = num(f, 'ref_id')!;
  const method = (str(f, 'method') ?? 'ATM') as 'ATM' | 'CVS';
  const base = num(f, 'base') ?? 0;
  const ret = str(f, 'return') ?? '/admin/payments';
  if (!(base > 0)) back(ret, '金額需大於 0');
  const p = await store().insert('payments', {
    kind,
    ref_id: refId,
    merchant_order_no: newMerchantOrderNo(kind === 'order' ? 'AV' : 'AS'),
    amount: F.payAmount(base, method),
    method,
    status: 'pending',
    trade_no: null,
    paid_at: null,
    raw_notify: null,
  });
  back(ret, `已產生付款連結 ${p.merchant_order_no}`);
}

export async function markPaymentPaid(f: FormData) {
  await requireAdmin();
  const id = num(f, 'id')!;
  const p = await store().get('payments', id);
  if (!p) back('/admin/payments', '找不到付款');
  await applyPaid(p.id);
  back('/admin/payments', '已手動標記為已付款');
}

/* ── 設定 ───────────────────────────── */
export async function saveSettings(f: FormData) {
  await requireAdmin();
  const s = store();
  const mid = num(f, 'mid_rate');
  const biz = (await s.getSetting<Record<string, unknown>>('business')) ?? {};
  await s.setSetting('business', { ...biz, mid_rate: mid, admin_line_uid: str(f, 'admin_line_uid') });
  const secrets = (await s.getSetting<Record<string, string>>('secrets')) ?? {};
  for (const k of Object.keys(SECRET_KEYS) as SecretKey[]) {
    const v = str(f, k);
    if (v) secrets[k] = v; // 空白代表不變
    if (f.get(`clear_${k}`) === 'on') delete secrets[k];
  }
  await s.setSetting('secrets', secrets);
  back('/admin/settings', '設定已儲存');
}

/* ── LINE 推播 ───────────────────────── */
export async function sendLine(f: FormData) {
  await requireAdmin();
  const ret = '/admin/line';
  const text = str(f, 'text');
  const json = str(f, 'json');
  const target = str(f, 'target');
  if (!target) back(ret, '請選擇收件人');
  let to: string, name: string;
  if (target === 'me') {
    const biz = await store().getSetting<{ admin_line_uid?: string }>('business');
    if (!biz?.admin_line_uid) back(ret, '請先在設定頁綁定管理員 LINE userId');
    to = biz.admin_line_uid;
    name = '小安';
  } else {
    const c = await store().get('customers', Number(target));
    if (!c?.line_uid) back(ret, '此客戶沒有 LINE userId');
    to = c.line_uid;
    name = c.name;
  }
  let messages: unknown[];
  try {
    messages = json ? [JSON.parse(fillName(json, name))].flat() : [{ type: 'text', text: fillName(text ?? '', name) }];
  } catch {
    back(ret, 'JSON 格式錯誤');
  }
  if (!json && !text) back(ret, '訊息內容是空的');
  try {
    await linePush(to, messages);
  } catch (e) {
    back(ret, (e as Error).message);
  }
  back(ret, `已傳送給 ${name}`);
}
