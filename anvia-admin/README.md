# anvia-admin — 予安所託後台（獨立部署版）

大陸代購品牌「予安所託」（Anvia Yuan）的營運後台，從 Muse 空間重建為可自行部署的網站專案：
訂單、客戶、抵台批次、出貨對帳與二補、藍新 NewebPay 金流、LINE 會員登入與 LINE 行銷工具（訊息中心、圖文選單）。

## 架構（規劃）
- 前端＋API：Next.js，部署於 Netlify
- 資料庫：Supabase（Postgres），schema 見 `db/schema.sql`
- 機密（藍新 HashKey/HashIV、LINE Channel Access Token、Supabase service key）只放部署平台環境變數，不進 repo

## 文件
- `docs/deployment-blueprint.md` — 部署藍圖、搬遷步驟、上線切換清單
- `docs/notion-formulas.md` — 金額與運費公式（樂生裁決版，所有計算以此為準）
- `docs/line-boost-feature-inventory.md` — LINE 工具完整功能盤點
- `docs/line-boost-phase-a-spec.md` — LINE 工具 A 期（編輯器全套）規格

## 資料搬遷
客戶/訂單等個資快照不進 GitHub。正式切換時由搬遷腳本從來源匯出、直接寫入資料庫並核對筆數，見 `data/README.md`。

## 本機啟動

```bash
npm install
cp .env.example .env.local     # 至少填 ADMIN_PASSWORD、SESSION_SECRET
npm run seed:demo              # 產生虛構示範資料到 data/dev-db.json（可略過）
npm run dev                    # http://localhost:3000 → 登入後台
```

- 沒填 `SUPABASE_URL` 時，資料存在本機 `data/dev-db.json`（不進 git）；填了就連 Supabase（先在 SQL Editor 執行 `db/schema.sql`）。
- `npm test`：公式與藍新加解密測試；`npm run typecheck`、`npm run build`。

## 頁面
| 路徑 | 說明 |
|---|---|
| `/admin` | 總覽：本月金額／利潤／新客、7 種狀態、最新批次、待辦 |
| `/admin/orders` | 訂單：狀態分頁、搜尋篩選、勾選改狀態／放進批次／併成出貨單 |
| `/admin/customers` | 客戶：進行中／已抵台、累計獲利、LINE 綁定 |
| `/admin/batches` | 抵台批次：巧巧郎／台集運運費與每 kg 分攤 |
| `/admin/shipments` | 出貨對帳：辛苦費、二補（賣貨便／好賣+）、複製明細給客人、二補付款連結 |
| `/admin/payments` | 藍新付款連結與狀態 |
| `/admin/line` | LINE 推播（文字／Flex，`{{name}}` 變數） |
| `/admin/settings` | 金鑰（只顯示末 4 碼）、台銀中間價、管理員 LINE userId |
| `/pay/[編號]` | 客人的專屬付款頁 → 藍新 |
| `/api/newebpay/notify` | 藍新 NotifyURL：驗章、比對金額、回寫付款／訂單／出貨單 |
| `/member` | 客人會員頁（LIFF）：全部訂單＋我的付款，不顯示利潤 |

## 狀態
骨架與主要功能可在本機運作（詳見 ROADMAP.md）。
