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
      account: findColumn(headers, ["account", "帳戶", "卡片", "付款帳戶", "扣款帳號", "銀行帳戶"]),
      currency: findColumn(headers, ["currency", "幣別", "交易幣別", "貨幣"]),
      purchaseRegion: findColumn(headers, ["purchaseregion", "刷卡地區", "交易地區", "國內外"]),
      merchant: findColumn(headers, ["merchant", "商家", "來源", "交易說明", "摘要", "交易內容", "備註摘要"]),
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
      const regionText = String(cell("purchaseRegion") || "").toLowerCase();
      return { date: date(cell("date")), type, amount: Math.abs(signedAmount), category: cell("category"), item: cell("item"), account: cell("account"), currency: String(cell("currency")||"").toUpperCase(), purchaseRegion: /國外|foreign|海外/.test(regionText)?"foreign":"domestic", merchant: cell("merchant"), note: cell("note"), importSource: "CSV" };
    }).filter(row => row.date || row.amount);
  }

  const KEYWORDS = [
    [/薪資|薪水|salary|payroll/i,"薪資"],[/利息|interest/i,"利息收入"],[/股息|配息|dividend/i,"投資收入"],
    [/全聯|家樂福|超市|市場|食品/i,"日用品"],[/uber|計程車|高鐵|台鐵|捷運|加油|停車/i,"交通"],
    [/醫院|診所|藥局|醫療/i,"醫療"],[/電信|水費|電費|瓦斯|網路/i,"生活繳費"],[/餐|咖啡|便當|早餐|午餐|晚餐|food/i,"餐飲"],
    [/飯店|旅館|航空|旅行|booking/i,"旅遊"],[/保險|insurance/i,"保險"],[/學費|課程|書店/i,"教育"]
  ];
  function suggestCategory(row, ledger = {}) {
    if (row.category) return row.category;
    const merchant=String(row.merchant||row.note||"").trim();
    const custom=(ledger.categoryRules||[]).find(rule=>rule.type===(row.type==="income"?"income":"expense")&&merchant.toLowerCase().includes(String(rule.keyword||"").toLowerCase()));
    if (custom?.category) return custom.category;
    const learned=(ledger.entries||[]).filter(item=>item.type===row.type&&item.category&&item.merchant).sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))).find(item=>merchant&&String(item.merchant).toLowerCase()===merchant.toLowerCase());
    if (learned) return learned.category;
    const keyword=KEYWORDS.find(([pattern])=>pattern.test(merchant));
    if (keyword) return keyword[1];
    return row.type==="income"?"其他收入":"其他支出";
  }
  function prepareEntries(rows, ledger = {}, options = {}) {
    const activeAccounts=(ledger.accounts||[]).filter(row=>!row.archived),defaultAccount=options.defaultAccount||activeAccounts[0]?.name||"";
    return rows.map(row=>{
      const account=(ledger.accounts||[]).find(item=>item.name===row.account&&!item.archived)?.name||defaultAccount;
      const accountCurrency=(ledger.accounts||[]).find(item=>item.name===account)?.currency||"TWD";
      return {...row,account,category:suggestCategory(row,ledger),currency:row.currency||accountCurrency,importSuggested:!row.category};
    });
  }
  function previewCsv(source, ledger = {}, options = {}) {
    const signature=row=>[String(row.date||"").slice(0,10),row.type==="income"?"income":"expense",Math.round(Number((row.transactionAmount??row.amount)||0)*100)/100,String(row.account||"").trim(),String(row.merchant||"").trim(),String(row.item||"").trim()].join("|").toLocaleLowerCase("zh-TW");
    const existing=new Set((ledger.entries||[]).map(signature)),seen=new Set(existing);
    const rows=prepareEntries(entriesFromCsv(source),ledger,options).map(row=>{const key=signature(row),importDuplicate=seen.has(key);seen.add(key);return{...row,importDuplicate}});
    return {rows,stats:{total:rows.length,suggested:rows.filter(row=>row.importSuggested).length,duplicates:rows.filter(row=>row.importDuplicate).length,income:rows.filter(row=>row.type==="income").length,expense:rows.filter(row=>row.type!=="income").length}};
  }

  window.FinanceImport = Object.freeze({ parseCsv, entriesFromCsv, suggestCategory, prepareEntries, previewCsv });
})();
