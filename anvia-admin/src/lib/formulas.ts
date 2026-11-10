/**
 * 予安所託 — 金額與運費公式
 * 來源：docs/notion-formulas.md（裁決版）。這裡只翻譯公式，不自創算法。
 * 所有函式皆為純函式，方便測試（tests/formulas.test.ts）。
 */

export const PER_KG = 73;                 // 國際運費計算基礎：每公斤 NT$73
export const OLD_PER_KG = 53;             // 运费（舊）
export const UNIT_PROFIT_RATE = 0.065;    // 單位利潤 = 代購單價 × 6.5%
export const RATE_MULTIPLIER = 1.08;      // 匯率 = 台銀人民幣中間價 × 1.08
export const PACKING_FEE = 15;            // 二補包裝手續費
export const MIN_DUE = { 賣貨便: 20, '好賣+': 25 } as const;
export const PAY_FEE = { ATM: 15, CVS: 25 } as const; // 藍新付款手續費，含在金額內

export type Channel = keyof typeof MIN_DUE;
export type Carrier = '台集運' | '巧巧郎';

/** 匯率 = 台銀中間價 × 1.08 */
export function exchangeRate(midRate: number): number {
  return midRate * RATE_MULTIPLIER;
}

/** 訂單編號 = YYYYMMDD-NNN（ID 未滿 10 補 00、未滿 100 補 0） */
export function orderNumber(created: Date | string, id: number): string {
  const d = typeof created === 'string' ? new Date(created) : created;
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const pad = id < 10 ? '00' : id < 100 ? '0' : '';
  return `${ymd}-${pad}${id}`;
}

/** 單位利潤 = 代購單價 × 0.065 */
export function unitProfit(price: number): number {
  return price * UNIT_PROFIT_RATE;
}

/** 欠款拉取 = 欠款 > 0 才計入 */
export function debtPull(debt: number): number {
  return debt > 0 ? debt : 0;
}

/* ── 抵台批次（集運包） ───────────────────────────── */

/** 巧巧郎運費 = ceil(實際重量) × 73 */
export function freightQiao(actualKg: number): number {
  return Math.ceil(actualKg) * PER_KG;
}

/** 台集運總運費 = ceil( (ceil(實際重量×2)/2) × 73 )（以 0.5kg 進位） */
export function freightTaiji(actualKg: number): number {
  return Math.ceil((Math.ceil(actualKg * 2) / 2) * PER_KG);
}

/** 运费（舊） = ceil(實際重量) × 53 */
export function freightOld(actualKg: number): number {
  return Math.ceil(actualKg) * OLD_PER_KG;
}

/** 分攤運費（每 kg 均攤）= ceil(總運費 / 實際重量) */
export function perKgAllocation(totalFreight: number, actualKg: number): number {
  if (!actualKg) return 0;
  return Math.ceil(((totalFreight / actualKg) * 100) / 100);
}

export interface BatchCalc {
  freightQiao: number;
  freightTaiji: number;
  perKgQiao: number;
  perKgTaiji: number;
}

export function batchCalc(actualKg: number): BatchCalc {
  const fq = freightQiao(actualKg);
  const ft = freightTaiji(actualKg);
  return {
    freightQiao: fq,
    freightTaiji: ft,
    perKgQiao: perKgAllocation(fq, actualKg),
    perKgTaiji: perKgAllocation(ft, actualKg),
  };
}

/** 單一批次依集運商取每 kg 分攤 */
export function batchPerKg(actualKg: number, carrier: Carrier | string | null | undefined): number {
  const c = batchCalc(actualKg);
  return carrier === '台集運' ? c.perKgTaiji : c.perKgQiao;
}

/** 訂單應A運費 = ceil(批次每 kg 分攤 × 包裹重量) */
export function orderFreight(perKg: number, weightKg: number): number {
  return Math.ceil(perKg * weightKg);
}

/* ── 出貨對帳 ─────────────────────────────────────── */

/** 包裹數量級距：<4:0, <7:10, <10:25, <12:40, 其餘 50 */
export function laborByCount(count: number): number {
  if (count < 4) return 0;
  if (count < 7) return 10;
  if (count < 10) return 25;
  if (count < 12) return 40;
  return 50;
}

/** 重量級距：<1:0, <2:5, <3:15, <4:35, <5:50, 其餘 60 */
export function laborByWeight(kg: number): number {
  if (kg < 1) return 0;
  if (kg < 2) return 5;
  if (kg < 3) return 15;
  if (kg < 4) return 35;
  if (kg < 5) return 50;
  return 60;
}

/** 運費｜辛苦費 = 包裹數量級距 + 重量級距 */
export function laborFee(parcelCount: number, weightKg: number): number {
  return laborByCount(parcelCount) + laborByWeight(weightKg);
}

/** 包裹數量 = 實際包裹數量 > 0 ? 實際 : 不重複商品名稱數 */
export function parcelCount(actual: number | null | undefined, titles: string[]): number {
  if (actual && actual > 0) return actual;
  return new Set(titles).size;
}

/** 總二補 = (基礎運費 + 辛苦費 + 15 + Σ欠款) 未達最低則取最低，否則無條件進位 */
export function supplementDue(baseFreight: number, labor: number, debtSum: number, channel: Channel): number {
  const raw = baseFreight + labor + PACKING_FEE + debtSum;
  const min = MIN_DUE[channel];
  return raw < min ? min : Math.ceil(raw);
}

export interface ShipmentLine {
  title: string;
  price: number;
  weightKg: number;
  debt: number;
  perKg: number; // 所屬批次的每 kg 分攤（未入批次為 0）
}

export interface ShipmentCalc {
  itemsTotal: number;   // Σ 代購單價
  profit: number;       // Σ 單位利潤
  weightKg: number;     // 物品重量 kg
  baseFreight: number;  // 基礎運費（Σ 應A運費）
  parcels: number;
  labor: number;
  debtSum: number;
  due: Record<Channel, number>;
}

export function shipmentCalc(lines: ShipmentLine[], actualParcels?: number | null): ShipmentCalc {
  const weightKg = round2(lines.reduce((s, l) => s + (l.weightKg || 0), 0));
  const baseFreight = lines.reduce((s, l) => s + orderFreight(l.perKg, l.weightKg || 0), 0);
  const parcels = parcelCount(actualParcels, lines.map((l) => l.title));
  const labor = laborFee(parcels, weightKg);
  const debtSum = lines.reduce((s, l) => s + debtPull(l.debt || 0), 0);
  return {
    itemsTotal: lines.reduce((s, l) => s + (l.price || 0), 0),
    profit: round2(lines.reduce((s, l) => s + unitProfit(l.price || 0), 0)),
    weightKg,
    baseFreight,
    parcels,
    labor,
    debtSum,
    due: {
      賣貨便: supplementDue(baseFreight, labor, debtSum, '賣貨便'),
      '好賣+': supplementDue(baseFreight, labor, debtSum, '好賣+'),
    },
  };
}

/** 藍新付款金額（手續費含在金額內） */
export function payAmount(base: number, method: keyof typeof PAY_FEE): number {
  return Math.ceil(base) + PAY_FEE[method];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
