(function () {
  "use strict";

  function text(value) { return String(value || "").toLocaleLowerCase("zh-TW"); }
  function matches(query, values) { return values.some(value => text(value).includes(query)); }
  function search(snapshot, input, limit = 30) {
    const query = text(input).trim();
    if (!query) return [];
    const results = [];
    (snapshot.ledger?.entries || []).forEach(row => {
      if (matches(query, [row.date, row.category, row.item, row.merchant, row.account, row.note])) results.push({ type: "收支", title: row.merchant || row.item || row.category || "收支紀錄", detail: `${row.date || ""}｜${row.category || "未分類"}｜${row.account || "未指定帳戶"}`, amount: (row.type === "income" ? 1 : -1) * Number(row.amount || 0), route: "daily/records" });
    });
    (snapshot.ledger?.accounts || []).forEach(row => {
      if (matches(query, [row.name, row.type, row.currency])) results.push({ type: "帳戶", title: row.name || "未命名帳戶", detail: `${row.type || "帳戶"}｜${row.currency || "TWD"}`, route: "accounts/accounts" });
    });
    const positions = [...(snapshot.stockPositions?.active || []), ...(snapshot.stockPositions?.manualOnly || []), ...(snapshot.stockPositions?.closed || [])];
    positions.forEach(row => {
      if (matches(query, [row.code, row.name, row.market, row.currency])) results.push({ type: row.closed ? "已出清" : "投資", title: `${row.code || ""}${row.name ? `｜${row.name}` : ""}`, detail: `${row.market || ""}｜${Number(row.shares || 0).toLocaleString()} 股／單位`, amount: Number(row.value || 0), route: "investments/holdings" });
    });
    (snapshot.assets?.dividends || []).forEach(row => {
      if (matches(query, [row.date, row.source, row.cashAccount, row.note])) results.push({ type: "股息", title: row.source || "股息收入", detail: `${row.date || ""}｜${row.cashAccount || "未連動帳戶"}`, amount: Number(row.amount || 0), route: "investments/dividends" });
    });
    return results.sort((a, b) => String(b.detail).localeCompare(String(a.detail))).slice(0, limit);
  }

  window.FinanceSearch = Object.freeze({ search });
})();
