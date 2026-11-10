# 給 Claude Code 的任務 — 予安所託獨立後台（anvia-admin）

老闆小安的指示流程：先在這個 repo（for-claude-code）的 `anvia-admin/` 資料夾裡把專案弄好，弄好之後再由你建立新的私有 repo `anvia-admin`，把專案搬過去成為正式專案。

## 背景
「予安所託」是大陸代購品牌（老闆小安一人經營，客群為台灣委託人，主要管道 LINE）。目前有一套在 Muse 平台上運作的管理後台取代 Notion，現在要重建成可獨立部署的一般網站專案，不再綁 Muse。

## 先讀這些文件（都在本資料夾）
- `README.md` — 專案總覽
- `ROADMAP.md` — 開發路線圖與分期
- `docs/deployment-blueprint.md` — 部署藍圖、資料表對照、搬遷原則
- `docs/notion-formulas.md` — 全部 31 條運費／利潤／二補公式（金額計算以此為準，不要自己發明）
- `docs/line-boost-feature-inventory.md` — LINE 模組功能盤點
- `docs/line-boost-phase-a-spec.md` — LINE 訊息中心 A 期規格（8 種訊息編輯器等）
- `db/schema.sql` — 資料庫 schema 草案

## 系統範圍
- 管理後台：總覽、訂單、客戶、抵台批次（集運包）、出貨對帳、付款、LINE 訊息中心、圖文選單、設定
- 客人會員頁：LINE 登入（LIFF），看自己的全部歷史訂單（含已寄出），不顯示利潤；「我的付款」區
- 金流：藍新 NewebPay，依訂單產生專屬付款連結（ATM +NT$15、超商代碼 +NT$25 含在金額內），NotifyURL 付款完成自動回寫狀態
- LINE Messaging API：推播訊息、發布圖文選單（需 Channel Access Token）

## 鐵則
- 匯率＝台銀人民幣中間價 ×1.08；國際運費計算基礎每公斤 NT$73；二補含 NT$15 包裝手續費，賣貨便最低 NT$20、好賣+最低 NT$25
- 訂單狀態只有 7 種：未付款／待處理／未發貨／在倉庫／已抵台／已寄出／取消・退款
- 金鑰（藍新 HashKey/HashIV、LINE token）只放環境變數或後台設定頁，絕不寫進程式碼、不 commit
- 客戶個資（data/ 底下的匯出檔）不進任何 repo；.gitignore 已排除 data/*.json
- 回應與文件用繁體中文

## 完成定義（這一階段）
專案骨架與主要功能可在本機跑起來 → 老闆確認 → 建立私有 repo `anvia-admin` 並把專案推上去，之後部署平台（Netlify＋Supabase 方向）另行確認再做。
