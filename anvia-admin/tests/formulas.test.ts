import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../src/lib/formulas.ts';

test('訂單編號補零', () => {
  assert.equal(F.orderNumber(new Date(2026, 10, 10), 7), '20261110-007');
  assert.equal(F.orderNumber(new Date(2026, 10, 10), 42), '20261110-042');
  assert.equal(F.orderNumber(new Date(2026, 10, 10), 893), '20261110-893');
});

test('匯率 ×1.08、單位利潤 6.5%', () => {
  assert.equal(F.round2(F.exchangeRate(4.4)), 4.75);
  assert.equal(F.unitProfit(200), 13);
});

test('批次運費：巧巧郎整 kg 進位、台集運 0.5kg 進位', () => {
  assert.equal(F.freightQiao(4.6), 5 * 73);
  assert.equal(F.freightTaiji(4.6), 365);  // ceil(9.2)/2 = 5 → 365
  assert.equal(F.freightTaiji(4.3), 329);  // 4.5 × 73 = 328.5 → 329
  assert.equal(F.perKgAllocation(365, 4.6), 80); // 79.35 → 80
  assert.equal(F.perKgAllocation(0, 0), 0);
});

test('訂單應A運費 = ceil(每kg × 重量)', () => {
  assert.equal(F.orderFreight(80, 0.2), 16);
  assert.equal(F.orderFreight(80, 0.33), 27); // 26.4 → 27
});

test('辛苦費級距', () => {
  assert.equal(F.laborFee(3, 0.9), 0);
  assert.equal(F.laborFee(4, 1), 15);
  assert.equal(F.laborFee(7, 2.5), 40);
  assert.equal(F.laborFee(10, 3), 75);
  assert.equal(F.laborFee(12, 4.2), 100);
  assert.equal(F.laborFee(20, 9), 110);
});

test('包裹數量：手填優先，否則不重複商品名稱數', () => {
  assert.equal(F.parcelCount(5, ['a']), 5);
  assert.equal(F.parcelCount(0, ['a', 'b', 'a']), 2);
});

test('二補：+15 包裝費、最低 20/25、無條件進位', () => {
  assert.equal(F.supplementDue(0, 0, 0, '賣貨便'), 20);
  assert.equal(F.supplementDue(0, 0, 0, '好賣+'), 25);
  assert.equal(F.supplementDue(8, 0, 0, '賣貨便'), 23);
  assert.equal(F.supplementDue(8, 0, 0, '好賣+'), 25);
  assert.equal(F.supplementDue(30.2, 5, 10, '賣貨便'), 61);
});

test('出貨單彙總', () => {
  const r = F.shipmentCalc([
    { title: 'A', price: 300, weightKg: 0.5, debt: 0, perKg: 80 },
    { title: 'B', price: 100, weightKg: 0.7, debt: 12, perKg: 80 },
    { title: 'B', price: 100, weightKg: 0, debt: -5, perKg: 80 },
  ]);
  assert.equal(r.weightKg, 1.2);
  assert.equal(r.baseFreight, 40 + 56);
  assert.equal(r.parcels, 2);
  assert.equal(r.labor, 5);
  assert.equal(r.debtSum, 12);
  assert.equal(r.profit, 32.5);
  assert.equal(r.due['賣貨便'], 96 + 5 + 15 + 12);
});

test('藍新手續費含在金額', () => {
  assert.equal(F.payAmount(500, 'ATM'), 515);
  assert.equal(F.payAmount(499.2, 'CVS'), 525);
});
