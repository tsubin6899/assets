# 背景繳款提醒伺服器驗證

驗證日期：2026-09-30（台灣時間）

- 正式網站：https://assets-olive-ten.vercel.app
- 正式 Supabase 專案：foxrssziuzeyktnobtrz（asset）
- Vercel 部署：https://vercel.com/tsubin-s-projects/assets/B8bjNq8Q25En6VweHxM4jc5xEN34
- finance_push_subscriptions 與 claim_finance_push_reminder 已建立。
- SUPABASE_SERVICE_ROLE_KEY、VAPID_PRIVATE_KEY、CRON_SECRET 使用 Production Secret。
- 已更正 SUPABASE_URL 與 SUPABASE_ANON_KEY，使伺服器指向已驗證的 asset 專案。
- public-config 顯示推播設定完成；授權 payment-reminders 回傳 HTTP 200、ok=true、sent=0、failed=0、expired=0。
- Vercel Cron Jobs 顯示 Enabled，路徑 /api/payment-reminders，每日 UTC 00:00；Hobby 有一小時彈性執行區間，相當於台灣上午 08:00–09:00。

## 資料確認

本機備份：E:\祖斌\投資理財\存檔\tsubin-finance-center-2026-09-30.json

SHA-256：e012540de4f0f9ce07300408ba2629765dc984c8aa2743824222fd3939d99bf4

asset 資料庫內已存在相同資料：483 筆交易、23 個帳戶、10 筆信用卡帳單、9 份帳單核對紀錄與 276 個核對勾選。

比對方式：物件鍵排序、陣列保持原序的標準化內容指紋。本機與雲端 ledger 指紋均為 92bf2dcd，assets 指紋均為 89c236a7。

因此未重新匯入、未覆寫財務資料。先前 wbohkuxjlcvwmrewsduj 是 Vercel 舊伺服器設定，並非這份備份所在的 asset 資料庫。

## 裝置仍需完成的步驟

在每個要接收通知的手機上，開啟財務中心，進入「分析 → 資料管理」，點「啟用背景繳款提醒」，並允許通知。

目前沒有訂閱裝置，尚未完成真實手機送達測試。
