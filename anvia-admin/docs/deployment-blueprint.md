# 予安所託後台 — 獨立部署藍圖（脫離 Muse）

目的：把後台從 Muse 空間重建成一般網站專案，樂生自行掌控（自己的 GitHub、部署平台、網域），
Claude Code 可直接 clone 同一 repo 繼續開發與美化；Muse 負責規格、資料搬遷與金流/LINE 對接驗證。

## 建議架構
- 程式碼：GitHub 私有 repo（lesieann 帳號），例如 `anvia-admin`
- 部署：Netlify（與官網同一帳號；靜態前端＋Serverless Functions 做 API）
- 資料庫：Supabase（Postgres；起步免費額度足夠現行資料量）
- 網域：先用 Netlify 子網域，穩定後可綁自有網域
- 機密（藍新 HashKey/HashIV、LINE Channel Access Token）：只放平台環境變數，不進 repo

## 資料模型（對照現行後台，欄位與公式照裁決版）
customers / orders / batches / shipments / payments / settings / flex_templates / richmenu_projects
- 計算邏輯以 notion-formulas.md 的裁決版為準（每 kg NT$73、單位利潤 6.5%、辛苦費級距、二補公式）
- 訂單狀態 7 值：未付款/待處理/未發貨/在倉庫/已抵台/已寄出/取消・退款

## 資料搬遷
- 現有快照在 ~/workspace/yu-an-backend/：seed.json（customers/batches/orders/shipments）、data/*.json（Notion 原始匯出、私人用客戶檔案 318 筆等）
- 注意：快照不是最終來源。正式切換當下，必須從 Muse 後台重新匯出當時最新資料再匯入新庫，
  並核對筆數（基準：客戶 327、訂單 893、出貨 259 補齊後、批次 35）才算完成
- Notion 保留唯讀封存，不再寫入

## 功能切換清單
1. 管理端登入（樂生本人）＋總覽/訂單/客戶/批次/出貨對帳 CRUD
2. 藍新 NewebPay：建立交易（ATM +15／超商 +25 含在金額）、NotifyURL 回寫、QueryTradeInfo 對帳、二補付款連結
3. 客人會員頁：LINE Login channel 2012460987 切 Published，LIFF 取得 userId 對應 line_uid 查全部歷史訂單
4. LINE 工具：Flex 範本庫＋push 傳送、圖文選單專案＋一鍵發布（token 只存後端）
5. 官網 v2 下單表單改送新後台 API（取代 Make webhook），舊頁導向/下線

## 分工
- Claude Code：UI 視覺與前端實作（repo 同步）
- Muse：資料模型/公式規格、搬遷與核對、藍新與 LINE 串接驗證、上線檢查
- 樂生：平台帳號授權、金鑰貼入環境變數、LINE channel 切 Published、小額實測

## 切換原則
- 新舊並行到新站驗證通過才切；切換前舊流程（官網舊頁＋Notion）不受影響
- 每一步完成都核對筆數與抽測金額，通過才往下一步
