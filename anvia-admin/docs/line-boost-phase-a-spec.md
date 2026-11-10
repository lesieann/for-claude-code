# LINE Boost 工具 A 期規格（編輯器全套，併入後台 LINE 模組）

依據 line-boost-feature-inventory.md。原則：在現有「Flex 訊息」「圖文選單」兩頁上擴充，不另起爐灶；
資料模型沿用後台 collections，新增 messages_library 與 welcome_flows，金鑰/token 規則比照既有設定頁（只存後台、末 4 碼）。

## 1. 訊息編輯器升級（現 Flex 訊息頁擴充）
- 訊息類型 8 種：文字（{{name}} 變數預覽）、圖片、熱區圖片（imagemap：上傳圖＋拖曳切區，每區 URI/文字動作）、影片（URL＋預覽圖 URL）、YouTube 卡片（貼網址自動解析 videoId、抓 i.ytimg 縮圖、產生 Flex 播放卡）、單頁 Flex（現有編輯器）、多頁 Flex（carousel ≤12 張，每張沿用單頁編輯）、範本訊息（buttons/confirm/image carousel 三種簡易產生器）
- 每則訊息可加：Quick Reply（≤13 顆；動作：傳送文字/開連結/分享）、隨附文字（一則純文字跟著送）
- 產出：標準 Messaging API message JSON 預覽/複製；存入訊息庫（messages_library：name/type/payload/quickReply/attachedText/updatedAt）
- 發送：選客戶 push（現有機制）；測試發送給自己（需先在設定頁綁管理員 userId，未綁時提示）

## 2. 圖文選單升級（現圖文選單頁擴充）
- 範本庫：預置 20+ 版型骨架（大張 2500×1686／小張 2500×843 常見切格：1/2/3/4/6 格與混合版），套用後再改圖與動作
- 動作新增「貼標（預留）」：A 期僅記錄設定值，實際貼標等 B 期 webhook 上線後生效，UI 明示
- 發布排程：專案可設上架/下架時間；A 期以排程清單呈現＋到時提醒（自動發布需常駐排程，移到獨立部署後啟用，先做「預約清單＋手動一鍵發布」）
- 多層切換：沿用現有專案多頁＋alias 切換（已具備），範本預置「主頁/分類頁/返回」結構

## 3. 歡迎流程（新頁籤或併入訊息頁）
- welcome_flows：最多 3 則，從訊息庫挑選排序、啟用/停用、{{name}} 預覽
- A 期僅編輯與保存；實際在加好友時自動發送需 webhook（B 期），UI 明示「部署後生效」，避免誤以為已啟用

## 4. 驗證標準
- 每種訊息類型各做一則範例，JSON 通過結構檢查（type/必填欄位），YouTube 解析支援 watch/youtu.be/shorts
- 熱區 imagemap baseSize 與 areas 座標換算正確（1040 基準）
- 既有資料（訂單/客戶/出貨/付款/設定）與既有 Flex 範本、選單專案不變
- 沙盒驗證後回讀確認筆數與專案存在才回報完成
