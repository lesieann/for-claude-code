---
title: 閒魚撿漏監控工具
date: 2026-10-18
tags: [閒魚, 自動化, playwright, 撿漏]
---

# 閒魚撿漏監控

在電腦上定時搜尋閒魚關鍵字。出現**新上架**而且符合價格與關鍵字條件的商品時，會推播到手機，並依設定開好商品頁或直接下單到「待付款」。**付款由你在手機上完成**。

## 運作方式

```
每 90～150 秒 → 依序搜尋每個關鍵字 → 和上次比對，找出新商品
    → 篩選價格與關鍵字 → 依 action 處理：
        notify：只推播
        open  ：推播，並在電腦開好商品頁（預設）
        order ：自動按「立即购买 → 提交订单」，推播「請付款」
                → 你打開閒魚 App →「我的」→「我买到的」→「待付款」→ 付款
```

- 第一次搜尋某個關鍵字時，只把當下的結果記為基準，不會通知。之後只通知新出現的商品。
- 出現滑塊驗證或「非法访问」時，程式會暫停並通知你。你在瀏覽器裡手動處理完，它會自動繼續。程式**不會**自動破解驗證碼。

## 安裝（Windows）

1. 安裝 [Python 3.11 以上](https://www.python.org/downloads/)，安裝時勾選「Add Python to PATH」。
2. 在這個資料夾開啟命令提示字元，執行：
   ```
   pip install -r requirements.txt
   copy config.example.toml config.toml
   ```
   程式預設使用電腦上已安裝的 Chrome。如果沒裝 Chrome，就執行 `playwright install chromium`，或把設定檔裡的 `browser_channel` 改成 `"msedge"`。
3. 編輯 `config.toml`，填入要監控的關鍵字和手機通知方式。
4. 第一次使用要先登入：
   ```
   python xianyu_monitor.py --login
   ```
   在跳出的瀏覽器裡用閒魚 App 掃碼登入，完成後回到命令視窗按 Enter。登入狀態會保存在 `browser-profile` 資料夾。
5. 測試通知：`python xianyu_monitor.py --test-notify`
6. 開始監控：`python xianyu_monitor.py`，按 Ctrl+C 停止。

監控期間瀏覽器視窗要保持開著，可以縮小。閒魚會擋無頭（看不到視窗的）瀏覽器，所以不能隱藏。

## 手機通知設定

選一種就夠了：

| 方式 | 手機 | 設定 |
|---|---|---|
| ntfy | Android／iPhone | 安裝 ntfy App，訂閱一個不容易被猜到的主題名稱，再把同一個名稱填到 `ntfy_topic` |
| Telegram | 皆可 | 用 @BotFather 建立機器人，填入 `telegram_token` 和 `telegram_chat_id` |
| Bark | iPhone | 填入 App 顯示的 `bark_key` |

## 設定建議

- 關鍵字和 `include`／`exclude` 請用**簡體字**，例如「坏」、「求购」，因為閒魚標題多為簡體。
- `exclude` 建議加上：`坏`、`故障`、`配件`、`求购`、`回收`、`租`、`仅盒`。
- 設 `min_price` 可以擋掉價格低得不合理的商品，這類多半是假貨、配件或詐騙。
- 間隔不要設太短，`interval_min` 不能小於 30 秒。關鍵字愈多，每輪花的時間愈長。

## 注意事項

- **自動下單（`order`）請謹慎使用**。下單後賣家會看到訂單，不付款會自動取消。常常下單不付款，可能影響帳號信用。`max_orders_per_day` 預設每天最多 3 筆。
- 撿漏常遇到詐騙，例如要你私下轉帳、加微信，或價格低得離譜。**一律只在閒魚 App 內付款**。
- 用自動化工具操作閒魚可能違反平台規範，帳號被限制的風險由你自己承擔。`open` 模式最安全，最後一步由你自己按。
- 閒魚改版後，按鈕文字或頁面結構可能變動。下單按鈕找不到時，可以修改 `config.toml` 裡的 `buy_button_texts`、`submit_button_texts`，預設值寫在程式的 `Config` 類別裡。
