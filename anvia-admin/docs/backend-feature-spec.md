# 現行後台功能規格對照表 — 給 Claude Code 重建時逐項對照

來源：Muse 現行後台「予安所託後台」（slug `yu-an-suo-tuo-hou-tai`）的實際功能清查，2026-11-10。
注意：現行後台的程式碼綁在 Muse 的運行環境（space-sdk），無法整包搬出；本表是重建的驗收標準，功能與行為要逐項對齊，金額公式以 `notion-formulas.md` 為準，資料表以 `db/schema.sql` 為準。

## 資料模型（8+2 張表）
customers、orders、batches、shipments、payments、settings（藍新＋LINE 設定，金鑰只存後端、前端只看末 4 碼）、flex_templates、richmenu_projects、messages_library、welcome_flows。
外部鍵：每筆資料有 `k`（原 Notion 頁面 id）供匯入 upsert 對應；訂單另有流水號 `oid`，訂單編號＝建立日 YYYYMMDD-三位數 oid。

## 管理端功能（後端動作逐項對照）
### 總覽
- getdashboard：本月新客數、訂單金額、概算利潤、各狀態進行中訂單數、最新批次、待處理清單。

### 訂單
- listorders（可篩狀態／客戶／文字）：每筆帶單位利潤、兩種國際運費（巧巧郎／台集運）。
- saveorder（新增自動給 oid 與今日建立日）、deleteorder、setorderstatus（一鍵推進狀態）。
- bulkassignbatch：多筆訂單一次指定／清除抵台批次。

### 客戶
- listcustomers：每位客戶的訂單數、進行中數、總金額、總單位利潤、是否有商品已抵台。
- getcustomer：單一客戶統計＋全部訂單（新→舊）。savecustomer、deletecustomer（有訂單者不可刪，回報原因）。

### 批次
- listbatches：每批次的巧巧郎／台集運總運費、每公斤分攤、訂單數、總重量。
- getbatch：單一批次運費明細＋其訂單。savebatch（latest=true 時清除其他批次的 latest）、deletebatch（同時解除訂單指派）。

### 出貨對帳
- listshipments：每張出貨單的物品總額、基礎運費、辛苦費、欠款、兩種二補（賣貨便／好賣+）、本單利潤、本單總價。
- getshipment：單張完整明細。createshipmentfromorders：由同一客戶的選取訂單建出貨單並連結。saveshipment（可改編號／客戶／日期／實際包裹數，物品清單以傳入集合為準）、deleteshipment（解除訂單連結）。

### 付款（藍新 NewebPay）
- createpayment：type=order 合併同一客戶多筆未付款訂單（基礎額＝Σ代購單價）；type=shipment 收一張出貨單的總二補（賣貨便）。手續費依設定加在金額上（ATM +15、超商代碼 +25）。MerchantOrderNo＝YA＋類型碼＋序號＋時間尾碼，唯一。
- getcheckout：組 MPG 結帳 payload（gateway URL＋MerchantID/TradeInfo/TradeSha/Version）；TradeInfo 只啟用該筆選定的付款方式，且必帶 ReturnURL＋NotifyURL（用設定值，未設則系統預設路徑）。
- handlepaymentnotify：回呼驗 TradeSha、解 TradeInfo；Status=SUCCESS 才標記已付款，並連動：出貨單二補標記已收款／被涵蓋的未付款訂單推進為待處理。
- syncpaymentstatus：用 QueryTradeInfo（v1.3）查單對帳，TradeStatus=1 視同已付款走同一連動；2=失敗、3=取消、0=維持待付款。
- cancelpayment：取消仍為待付款的付款單（如重發連結取代舊單時）。listpayments（可篩狀態）。
- getpaymentsettings / savepaymentsettings：HashKey/HashIV 只回末 4 碼遮罩；空白欄位不覆寫已存金鑰。

### LINE 訊息中心（A 期已完成）
- 訊息庫：savelibrarymessage / listlibrarymessages / deletelibrarymessage（8 種訊息格式，含 payload、quickReply、隨附文字 attachedText）。
- sendlibrarymessage：推播給選取客戶（有存 LINE userId 者），{{name}} 逐人代入客戶名；無 token 時回 tokenConfigured=false 且不發送。
- Flex 範本：saveflextemplate / listflextemplates / deleteflextemplate；sendflexmessage 逐人 push。
- getshipmentflexprefill：由出貨單預填二補通知卡（客戶名、是否有 userId、品項與金額、該出貨單待付款的二補付款 k）。
- 歡迎流程：getwelcomeflow / savewelcomeflow（最多 3 則、含排序與啟停；A 期只存不發，Webhook 部署後才自動發送）。
- LINE 設定：getlinesettings / savelinesettings（token 只存後端、只回遮罩末 4 碼；空白不覆寫）。

### 圖文選單
- saverichmenuproject / listrichmenuprojects / deleterichmenuproject（專案 JSON：多頁、熱區、圖片 blob key）。
- saverichmenuimage（base64 存圖回 blob key）/ getrichmenuimageurl。
- publishrichmenu：用已存 token 發布——可先刪既有選單與別名，再逐頁建立選單、上傳圖片、建別名，最後設為預設選單。

## 客人端（會員視角）
- memberlogin：登入鍵＝LINE userId（line_uid），由 LINE Login channel「予安所託 客戶登錄」（Channel ID 2012460987）的 LIFF 取得；原型備援：客戶 k 選人、用手機號精確比對。
- memberdirectory：選人清單只給姓名＋是否有 userId，不給電話與訂單資料。
- getmemberorders：該客戶全部訂單（含已寄出與取消紀錄），只給金額、重量、批次名、欠款、狀態——絕不給利潤與運費內部數字。
- memberpayments：該客戶的付款紀錄（類型、涵蓋訂單／出貨單標示、金額、方式、狀態），不給利潤與任何金鑰資料。

## 資料匯入
- importseed：以 `k` upsert 批次匯入 customers/batches/orders/shipments；訂單的客戶／批次／出貨單關聯與出貨單物品都用 `k` 解析（Notion 原始 URL 會正規化為頁面 id）；無客戶的訂單會被略過。重建版需要等價的匯入機制，切換時從 Muse 後台重新匯出最新資料再匯入（見藍圖）。

## 重建驗收重點
1. 上述每個動作都要有等價功能，名稱可不同、行為要一致。
2. 金額抽測：任選一張出貨單，物品總額／基礎運費／辛苦費／二補／利潤／總價須與現行後台同單數字一致。
3. 客人端任何畫面與 API 回應都不得出現利潤、運費成本、任何金鑰。
4. 無 LINE token／無藍新金鑰時，發送與結帳要安全擋下並提示先去設定頁填寫，不可報錯崩潰。
