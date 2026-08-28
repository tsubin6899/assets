# 個人財務中心架構

## 主要入口

- `finance-center.html`：原生單頁財務中心，提供首頁、日常記帳、帳戶與負債、投資資產、分析與報表。
- `finance-core.js`：共用資料契約、舊資料遷移、財務事件、分析、備份、還原與寫入操作。
- `accounting-app.html`、`personal-assets-dashboard.html`：保留完整進階功能，寫入後會通知共用資料層。

## 相容資料來源

- 記帳：`personal-accounting-tsubin-v1`
- 資產：`personal-assets-dashboard-tsubin-v2`
- 統一索引：`tsubin-personal-finance-center-v3`
- 還原點：`tsubin-personal-finance-backups-v1`

舊資料仍是可讀寫的相容來源；財務中心不要求使用者重新匯入或重新建檔。

## 統一財務事件

- `income`、`expense`：一般收入與支出。
- `transfer`：帳戶間移轉，不納入收入或支出。
- `investment_buy`、`investment_sell`：投資現金流，不納入一般消費預算。
- `dividend`：投資收入，可連動入款帳戶。

信用卡消費增加負債；繳款以轉帳降低負債，不重複計算支出。

## 資料安全

- 每次主要寫入、匯入與還原前建立還原點，最多保留 12 份。
- 自動還原點不保存大型發票影像，完整 JSON 匯出仍保留原始資料。
- 雲端資料使用既有 Supabase 使用者資料列與 RLS；載入較舊雲端版本前會提示衝突。
- 離開頁面或閒置五分鐘會自動隱藏金額。

## 後續開發原則

新增財務功能時，先在 `finance-core.js` 定義資料與事件，再由頁面渲染。避免在不同頁面各自重新計算餘額、淨資產或現金流。
