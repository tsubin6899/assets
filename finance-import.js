(function () {
  "use strict";

  function parseCsv(source) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    const text = String(source || "").replace(/^\uFEFF/, "");
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') { value += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === "," && !quoted) { row.push(value.trim()); value = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[index + 1] === "\n") index += 1;
        row.push(value.trim()); value = "";
        if (row.some(cell => cell !== "")) rows.push(row);
        row = [];
      } else value += char;
    }
    row.push(value.trim());
    if (row.some(cell => cell !== "")) rows.push(row);
    return rows;
  }

  function normalizeHeader(value) { return String(value || "").trim().toLowerCase().replace(/[\s_／/()-]/g, ""); }
  function findColumn(headers, aliases) { return headers.findIndex(header => aliases.includes(header)); }
  function number(value) {
    const parsed = Number(String(value || "").replace(/[,$NT＄元\s]/gi, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function date(value) {
    const normalized = String(value || "").trim().replace(/[./]/g, "-");
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return match ? `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` : normalized.slice(0, 10);
  }
  function entriesFromCsv(source) {
    const rows = parseCsv(source);
    if (rows.length < 2) throw new Error("CSV 沒有可匯入的資料");
    const headers = rows[0].map(normalizeHeader);
    const columns = {
      date: findColumn(headers, ["date", "日期", "交易日期", "入帳日期"]),
      type: findColumn(headers, ["type", "類型", "收支", "交易類型"]),
      amount: findColumn(headers, ["amount", "金額", "交易金額"]),
      income: findColumn(headers, ["income", "收入", "存入", "貸方"]),
      expense: findColumn(headers, ["expense", "支出", "提出", "借方"]),
      category: findColumn(headers, ["category", "分類", "收支分類"]),
      item: findColumn(headers, ["item", "項目", "品項"]),
      account: findColumn(headers, ["account", "帳戶", "卡片", "付款帳戶"]),
      merchant: findColumn(headers, ["merchant", "商家", "來源", "交易說明", "摘要"]),
      note: findColumn(headers, ["note", "備註", "說明"])
    };
    if (columns.date < 0 || (columns.amount < 0 && columns.income < 0 && columns.expense < 0)) throw new Error("CSV 至少需要日期與金額欄位");
    return rows.slice(1).map(cells => {
      const income = columns.income >= 0 ? number(cells[columns.income]) : 0;
      const expense = columns.expense >= 0 ? number(cells[columns.expense]) : 0;
      const signedAmount = columns.amount >= 0 ? number(cells[columns.amount]) : income || expense;
      const typeText = columns.type >= 0 ? String(cells[columns.type] || "").toLowerCase() : "";
      const type = /收入|income|存入|貸方/.test(typeText) || income > 0 ? "income" : "expense";
      const cell = key => columns[key] >= 0 ? cells[columns[key]] || "" : "";
      return { date: date(cell("date")), type, amount: Math.abs(signedAmount), category: cell("category") || (type === "income" ? "其他收入" : "其他支出"), item: cell("item"), account: cell("account"), merchant: cell("merchant"), note: cell("note"), importSource: "CSV" };
    }).filter(row => row.date || row.amount);
  }

  window.FinanceImport = Object.freeze({ parseCsv, entriesFromCsv });
})();
