(function () {
  "use strict";

  const routes = {
    home: { label: "首頁", tabs: [["overview", "今日總覽"], ["actions", "行動中心"]] },
    daily: { label: "日常記帳", tabs: [["quick", "快速記帳"], ["lookup", "查帳"], ["calendar", "月份行事曆"], ["records", "收支明細"], ["taxonomy", "分類與項目"], ["budgets", "分類預算"], ["recurring", "固定收支"], ["closeout", "月結"]] },
    accounts: { label: "帳戶與負債", tabs: [["accounts", "帳戶總覽"], ["transfer", "帳戶轉帳"], ["credit", "信用卡帳單"], ["installments", "信用卡分期"], ["loans", "貸款管理"], ["reconcile", "帳戶盤點"], ["statements", "信用卡核對"]] },
    investments: { label: "投資資產", tabs: [["portfolio", "資產配置"], ["holdings", "持有部位"], ["trades", "交易紀錄"], ["dividends", "股息收入"]] },
    analysis: { label: "分析與報表", tabs: [["trends", "資產趨勢"], ["forecast", "財務預測"], ["spending", "支出分析"], ["planning", "目標與年度計畫"], ["tax", "稅務與投資基準"], ["audit", "資料稽核"], ["events", "財務事件"], ["data", "資料管理"]] }
  };

  window.FinanceCenterRoutes = Object.freeze(routes);
})();
