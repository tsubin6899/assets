# 背景繳款提醒啟用

前端、訂閱 API、Service Worker 與每天台灣時間 08:00 的排程已加入。啟用前需完成下列伺服器設定，否則畫面會顯示「背景推播服務尚未完成設定」，不會假裝已啟用。

1. 在既有 Supabase 專案 SQL Editor 執行 `supabase-push.sql`。資料表與搶占發送函式只允許 service_role 存取；裝置透過驗證登入的 API 註冊。
2. 安裝專案依賴後執行 `pnpm exec web-push generate-vapid-keys`，把公私鑰分別加入 Vercel Production 的 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`；不可提交私鑰到 Git。
3. 在 Vercel 設定 `VAPID_SUBJECT`（管理者的 `mailto:` 地址）、隨機 `CRON_SECRET`、`SUPABASE_SERVICE_ROLE_KEY`。沿用 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`。service_role 只在 API 使用；公開設定只回傳公鑰。
4. 重新部署後，在「分析 → 資料管理」按「啟用背景繳款提醒」，允許瀏覽器通知。每個装置各自啟用；iPhone 請從加入主畫面的 App 操作。
5. 在 Vercel Cron 控制台檢查 `/api/payment-reminders` 排程結果，並用測試帳單（截止日在今天、明天或 3 天後）確認裝置收得到。已繳帳單不會發送，逾期帳單每天提醒一次。

## 行為與驗證

- 伺服器依最新雲端帳單判斷，所以本機完成繳款後須同步成功，才能停止背景提醒。
- 每個裝置每天最多一則背景繳款摘要，通知不顯示銀行或金額；點擊開啟信用卡核對頁。
- 原子資料庫搶占避免重複排程同時發送。過期訂閱會刪除；發送失敗解除當日標记，供管理者重試。
- 每次重新啟用訂閱會核對登入使用者；同一裝置重新啟用時，先移除舊使用者的相同 endpoint 訂閱，避免切換帳號後收到舊帳號摘要。
- 不承諾作業系統關機或禁止背景網路時準時送達；仍應以系統帳單清單為準。

已完成本機模擬與手機版驗證；真實推播須完成以上設定後驗證。

參考：[Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)、[web-push](https://github.com/web-push-libs/web-push)。
