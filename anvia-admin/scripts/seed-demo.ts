/**
 * 產生示範資料到 data/dev-db.json（全部是虛構資料，不含真實客戶個資）。
 * 用法：npm run seed:demo        （已有資料時不覆蓋，加 --force 才覆蓋）
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as F from '../src/lib/formulas.ts';

const file = path.join(process.cwd(), 'data', 'dev-db.json');
const force = process.argv.includes('--force');

async function main() {
  try {
    await fs.access(file);
    if (!force) { console.log('data/dev-db.json 已存在，未覆蓋（要重建請加 --force）'); return; }
  } catch {}

  const now = new Date();
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 864e5).toISOString();
  const d = (daysAgo: number) => iso(daysAgo).slice(0, 10);

  const names = ['小米粒', '布丁', '阿嬤的貓', '奶茶', '小熊軟糖', '芋圓', '橘子汽水', '咕嚕'];
  const customers = names.map((name, i) => ({
    id: i + 1, notion_key: null, name, real_name: null, line_uid: i < 5 ? `Udemo${String(i + 1).padStart(28, '0')}` : null,
    line_id: `demo_${i + 1}`, phone: `09000000${String(i + 10)}`, email: null, source_date: d(i * 9), location: null, created_at: iso(i * 9),
  }));
  const batches = [
    { id: 1, notion_key: null, name: F.orderNumber(new Date(iso(40)), 0).slice(0, 8), actual_weight: 12.4, is_latest: false, status: '歸檔', carrier: '巧巧郎', total_freight: F.freightQiao(12.4), created_at: iso(40) },
    { id: 2, notion_key: null, name: F.orderNumber(new Date(iso(12)), 0).slice(0, 8), actual_weight: 8.7, is_latest: true, status: '進行中', carrier: '台集運', total_freight: F.freightTaiji(8.7), created_at: iso(12) },
  ];
  const items = ['卡套 三入', '壓克力立牌', '徽章 盲盒', '吧唧收納包', '透卡 套組', '毛絨掛件', '手機殼', '貼紙本', '馬克杯', '帆布袋', '絲巾', '髮夾 兩入'];
  const platforms = ['淘寶', '閑魚', '拼多多', '微店', '摩點', '小紅書'];
  const statuses = ['已寄出', '已寄出', '已抵台', '已抵台', '在倉庫', '未發貨', '待處理', '未付款'] as const;
  const orders = Array.from({ length: 28 }, (_, i) => {
    const status = statuses[i % statuses.length];
    const daysAgo = 45 - i * 1.5;
    const batch_id = status === '已寄出' ? 1 : status === '已抵台' ? 2 : null;
    return {
      id: i + 1, notion_key: null, oid: i + 1, customer_id: (i % names.length) + 1,
      title: items[i % items.length], platform: platforms[i % platforms.length], url: null,
      price: [120, 260, 89, 450, 199, 330, 75, 610][i % 8], weight_kg: [0.12, 0.35, 0.08, 0.6, 0.22, 0.4, 0.05, 0.9][i % 8],
      debt: i % 9 === 4 ? 12 : 0, status, order_date: d(daysAgo), batch_id, shipment_id: null,
      purchased: status !== '未付款' && status !== '待處理', stocked: ['在倉庫', '已抵台', '已寄出'].includes(status),
      arrived: ['已抵台', '已寄出'].includes(status), shipped: status === '已寄出', note: null, created_at: iso(daysAgo),
    };
  });
  const db = { customers, batches, orders, shipments: [], payments: [], settings: { business: { mid_rate: 4.42 } }, seq: {} };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(db, null, 1));
  console.log(`已寫入示範資料：客戶 ${customers.length}、批次 ${batches.length}、訂單 ${orders.length}`);
}
main();
