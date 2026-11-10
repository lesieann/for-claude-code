import 'server-only';
import { store } from './store';
import * as F from './formulas';
import { CLOSED_STATUSES, type Batch, type Customer, type Order, type Shipment } from './types';

export async function loadAll() {
  const s = store();
  const [customers, batches, orders, shipments, payments] = await Promise.all([
    s.list('customers'),
    s.list('batches'),
    s.list('orders'),
    s.list('shipments'),
    s.list('payments'),
  ]);
  return { customers, batches, orders, shipments, payments };
}

export function batchPerKgMap(batches: Batch[]) {
  return new Map(batches.map((b) => [b.id, b.actual_weight ? F.batchPerKg(b.actual_weight, b.carrier) : 0]));
}

export function orderNo(o: Order) {
  return F.orderNumber(o.order_date || o.created_at, o.oid ?? o.id);
}

export function orderFreight(o: Order, perKg: Map<number, number>) {
  return o.batch_id ? F.orderFreight(perKg.get(o.batch_id) ?? 0, o.weight_kg || 0) : 0;
}

export function shipmentLines(orders: Order[], perKg: Map<number, number>): F.ShipmentLine[] {
  return orders.map((o) => ({
    title: o.title,
    price: o.price || 0,
    weightKg: o.weight_kg || 0,
    debt: o.debt || 0,
    perKg: o.batch_id ? perKg.get(o.batch_id) ?? 0 : 0,
  }));
}

export function calcShipment(sh: Shipment, orders: Order[], perKg: Map<number, number>) {
  const mine = orders.filter((o) => o.shipment_id === sh.id);
  return { orders: mine, calc: F.shipmentCalc(shipmentLines(mine, perKg), sh.parcel_count) };
}

export const isOpen = (o: Order) => !CLOSED_STATUSES.includes(o.status);

export function customerSummary(c: Customer, orders: Order[]) {
  const mine = orders.filter((o) => o.customer_id === c.id);
  const profit = mine.filter((o) => o.status !== '取消・退款').reduce((s, o) => s + F.unitProfit(o.price || 0), 0);
  const last = mine.map((o) => o.order_date || o.created_at.slice(0, 10)).sort().at(-1) ?? null;
  return {
    total: mine.length,
    open: mine.filter(isOpen).length,
    shipped: mine.filter((o) => o.status === '已寄出').length,
    arrived: mine.filter((o) => o.status === '已抵台').length,
    profit: F.round2(profit),
    last,
  };
}

export function monthKey(d: string | null | undefined) {
  return (d || '').slice(0, 7);
}
