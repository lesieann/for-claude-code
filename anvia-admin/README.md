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

## 狀態
規格與資料模型已定稿；程式本體開發中（詳見 ROADMAP.md）。
