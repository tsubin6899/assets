(function () {
  "use strict";

  const VERSION = 3;
  const KEYS = {
    ledger: "personal-accounting-tsubin-v1",
    assets: "personal-assets-dashboard-tsubin-v2",
    unified: "tsubin-personal-finance-center-v3",
    backups: "tsubin-personal-finance-backups-v1",
    preferences: "tsubin-personal-finance-preferences-v1"
  };

  const emptyLedger = {
    entries: [], transfers: [], creditBills: [], creditInstallments: [], templates: [], recurringRules: [],
    budgets: [], reconciliations: [], creditStatementChecks: [], recycleBin: [], monthCloseouts: [],
    budgetRollovers: {}, categories: { income: [], expense: [] }, items: { income: {}, expense: {} },
    accounts: [], methods: []
  };
  const emptyAssets = {
    rates: { usd: 1, goldGram: 0, silverOz: 0, reserve: 0 }, fxRates: { TWD: 1 },
    tw: [], us: [], cash: [], cards: [], gold: [], silver: [], funds: [], usdFunds: [], dca: [],
    dcaTargets: [], dcaSchedules: [], purchaseRecords: [], dividends: [], assetSnapshots: [], budget: [],
    pnlCalendar: [], safety: { monthlyExpense: 0, safetyMonths: 6 },
    targetAllocation: { tw: 40, us: 20, cash: 20, gold: 10, silver: 0, fund: 10 }, allocation: []
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" ? value : clone(fallback);
    } catch { return clone(fallback); }
  }
  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function uid(prefix = "fin") { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function nowIso() { return new Date().toISOString(); }
  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function monthOf(date = localDate()) { return String(date).slice(0, 7); }
  function number(value) { const result = Number(value); return Number.isFinite(result) ? result : 0; }
  function normalizeCurrency(value) { return String(value || "TWD").trim().toUpperCase() || "TWD"; }
  function unique(list) { return [...new Set((list || []).filter(Boolean))]; }

  function ensureLedger(input) {
    const value = input && typeof input === "object" ? input : {};
    return {
      ...clone(emptyLedger), ...value,
      entries: Array.isArray(value.entries) ? value.entries : [],
      transfers: Array.isArray(value.transfers) ? value.transfers : [],
      creditBills: Array.isArray(value.creditBills) ? value.creditBills : [],
      creditInstallments: Array.isArray(value.creditInstallments) ? value.creditInstallments : [],
      templates: Array.isArray(value.templates) ? value.templates : [],
      recurringRules: Array.isArray(value.recurringRules) ? value.recurringRules : [],
      budgets: Array.isArray(value.budgets) ? value.budgets : [],
      reconciliations: Array.isArray(value.reconciliations) ? value.reconciliations : [],
      creditStatementChecks: Array.isArray(value.creditStatementChecks) ? value.creditStatementChecks : [],
      recycleBin: Array.isArray(value.recycleBin) ? value.recycleBin : [],
      monthCloseouts: Array.isArray(value.monthCloseouts) ? value.monthCloseouts : [],
      budgetRollovers: value.budgetRollovers && typeof value.budgetRollovers === "object" ? value.budgetRollovers : {},
      categories: value.categories && typeof value.categories === "object" ? value.categories : { income: [], expense: [] },
      items: value.items && typeof value.items === "object" ? value.items : { income: {}, expense: {} },
      accounts: Array.isArray(value.accounts) ? value.accounts : [],
      methods: Array.isArray(value.methods) ? value.methods : []
    };
  }

  function ensureAssets(input) {
    const value = input && typeof input === "object" ? input : {};
    const result = { ...clone(emptyAssets), ...value };
    ["tw", "us", "cash", "cards", "gold", "silver", "funds", "usdFunds", "dca", "dcaTargets", "dcaSchedules", "purchaseRecords", "dividends", "assetSnapshots", "budget", "pnlCalendar"].forEach(key => {
      if (!Array.isArray(result[key])) result[key] = [];
    });
    result.fxRates = { TWD: 1, ...(value.fxRates || {}) };
    result.rates = { ...emptyAssets.rates, ...(value.rates || {}) };
    return result;
  }

  function preferences() {
    const value = readJson(KEYS.preferences, {});
    if (!value.deviceId) {
      value.deviceId = uid("device");
      value.createdAt = nowIso();
      writeJson(KEYS.preferences, value);
    }
    return value;
  }

  function fxRate(assets, currency) {
    const code = normalizeCurrency(currency);
    if (code === "TWD") return 1;
    return number(assets.fxRates?.[code] ?? (code === "USD" ? assets.rates?.usd : 1)) || 1;
  }

  function buildEvents(ledger, assets) {
    const accountMap = new Map((ledger.accounts || []).map(row => [row.name, row]));
    const entries = (ledger.entries || []).filter(row => !row.recurringSkipped).map(row => {
      const account = accountMap.get(row.account);
      const currency = normalizeCurrency(account?.currency || row.currency || "TWD");
      const amount = number(row.amount);
      return {
        id: `entry:${row.id || uid("legacy")}`, sourceId: row.id || "", kind: row.type === "income" ? "income" : "expense",
        date: row.date || "", title: row.merchant || row.item || row.category || (row.type === "income" ? "收入" : "支出"),
        category: row.category || "未分類", account: row.account || "", currency, amount,
        twdAmount: amount * fxRate(assets, currency), direction: row.type === "income" ? 1 : -1,
        pending: Boolean(row.recurringId && String(row.date || "") > localDate()), note: row.note || "", raw: row
      };
    });
    const transfers = (ledger.transfers || []).map(row => ({
      id: `transfer:${row.id || uid("legacy")}`, sourceId: row.id || "", kind: "transfer", date: row.date || "",
      title: `${row.fromAccount || "來源帳戶"} → ${row.toAccount || "目的帳戶"}`, category: "帳戶移轉",
      account: row.fromAccount || "", toAccount: row.toAccount || "", currency: "TWD", amount: number(row.fromAmount),
      twdAmount: number(row.fromAmount), direction: 0, note: row.note || "", raw: row
    }));
    const investments = (assets.purchaseRecords || []).map(row => {
      const currency = normalizeCurrency(row.currency || (row.market === "US" ? "USD" : "TWD"));
      const gross = number(row.price) * number(row.shares);
      const total = row.type === "sell" ? gross - number(row.fee) - number(row.tax) : gross + number(row.fee) + number(row.tax);
      return {
        id: `trade:${row.id || [row.date, row.market, row.code, row.type, row.shares, row.price].join(":")}`,
        sourceId: row.id || "", kind: row.type === "sell" ? "investment_sell" : "investment_buy", date: row.date || "",
        title: `${row.type === "sell" ? "賣出" : "買入"} ${row.code || row.name || "投資標的"}`, category: "投資交易",
        account: row.cashAccount || "", currency, amount: total, twdAmount: total * fxRate(assets, currency),
        direction: row.type === "sell" ? 1 : -1, note: row.note || "", raw: row
      };
    });
    const dividends = (assets.dividends || []).map(row => {
      const currency = normalizeCurrency(row.currency || "TWD");
      return {
        id: `dividend:${row.id || [row.date, row.source, row.amount].join(":")}`, sourceId: row.id || "", kind: "dividend",
        date: row.date || "", title: `${row.source || "投資標的"} 股息`, category: "股息", account: row.cashAccount || "",
        currency, amount: number(row.amount), twdAmount: number(row.amount) * fxRate(assets, currency), direction: 1,
        note: row.note || "", raw: row
      };
    });
    return [...entries, ...transfers, ...investments, ...dividends].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  }

  function accountBalances(ledger, assets, asOf = localDate()) {
    const balances = new Map();
    const accountMap = new Map();
    (ledger.accounts || []).forEach(account => {
      accountMap.set(account.name, account);
      balances.set(account.name, number(account.openingBalance));
    });
    (ledger.entries || []).filter(row => !row.recurringSkipped && (!row.date || String(row.date) <= asOf)).forEach(row => {
      if (!balances.has(row.account)) return;
      const account = accountMap.get(row.account);
      const amount = number(row.amount);
      const multiplier = account?.type === "信用卡" ? (row.type === "income" ? -1 : 1) : (row.type === "income" ? 1 : -1);
      balances.set(row.account, number(balances.get(row.account)) + amount * multiplier);
    });
    (ledger.transfers || []).filter(row => !row.date || String(row.date) <= asOf).forEach(row => {
      const from = accountMap.get(row.fromAccount);
      const to = accountMap.get(row.toAccount);
      if (from) balances.set(from.name, number(balances.get(from.name)) + number(row.fromAmount) * (from.type === "信用卡" ? 1 : -1));
      if (to) balances.set(to.name, number(balances.get(to.name)) + number(row.toAmount) * (to.type === "信用卡" ? -1 : 1));
      const feeAccount = accountMap.get(row.feeAccount);
      if (feeAccount && number(row.feeAmount)) balances.set(feeAccount.name, number(balances.get(feeAccount.name)) - number(row.feeAmount));
    });
    (assets.purchaseRecords || []).filter(row => row.cashAccount && (!row.date || String(row.date) <= asOf)).forEach(row => {
      if (!balances.has(row.cashAccount)) return;
      const gross = number(row.price) * number(row.shares);
      const cashFlow = row.type === "sell" ? gross - number(row.fee) - number(row.tax) : -(gross + number(row.fee) + number(row.tax));
      balances.set(row.cashAccount, number(balances.get(row.cashAccount)) + cashFlow);
    });
    (assets.dividends || []).filter(row => row.cashAccount && (!row.date || String(row.date) <= asOf)).forEach(row => {
      if (balances.has(row.cashAccount)) balances.set(row.cashAccount, number(balances.get(row.cashAccount)) + number(row.amount));
    });
    return (ledger.accounts || []).map(account => ({ ...account, balance: number(balances.get(account.name)), twdBalance: number(balances.get(account.name)) * fxRate(assets, account.currency) }));
  }

  function holdingValue(row, assets, fallbackCurrency) {
    const currency = normalizeCurrency(row.currency || fallbackCurrency || "TWD");
    const direct = number(row.marketValue ?? row.value ?? row.currentValue);
    const units = number(row.shares ?? row.units ?? row.quantity ?? row.weight ?? row.grams ?? row.ounces);
    const price = number(row.price ?? row.currentPrice ?? row.nav ?? row.unitPrice);
    return (direct || units * price) * fxRate(assets, currency);
  }

  function assetSummary(ledger, assets) {
    const accounts = accountBalances(ledger, assets);
    const regularCash = accounts.filter(row => row.type !== "信用卡").reduce((sum, row) => sum + row.twdBalance, 0);
    const knownNames = new Set(accounts.map(row => row.name));
    const manualCash = (assets.cash || []).filter(row => !knownNames.has(row.bank)).reduce((sum, row) => sum + number(row.amount) * fxRate(assets, row.currency), 0);
    const creditDebt = accounts.filter(row => row.type === "信用卡").reduce((sum, row) => sum + Math.max(0, row.twdBalance), 0);
    const legacyCards = (assets.cards || []).filter(row => !knownNames.has(row.card)).reduce((sum, row) => sum + Math.max(0, number(row.amount)), 0);
    const tw = (assets.tw || []).reduce((sum, row) => sum + holdingValue(row, assets, "TWD"), 0);
    const us = (assets.us || []).reduce((sum, row) => sum + holdingValue(row, assets, "USD"), 0);
    const funds = [...(assets.funds || []), ...(assets.usdFunds || [])].reduce((sum, row) => sum + holdingValue(row, assets, row.currency || "TWD"), 0);
    const gold = (assets.gold || []).reduce((sum, row) => sum + (holdingValue(row, assets, "TWD") || number(row.grams ?? row.quantity) * number(assets.rates?.goldGram)), 0);
    const silver = (assets.silver || []).reduce((sum, row) => sum + (holdingValue(row, assets, "TWD") || number(row.ounces ?? row.quantity) * number(assets.rates?.silverOz)), 0);
    const cash = regularCash + manualCash;
    const investment = tw + us + funds + gold + silver;
    const liabilities = creditDebt + legacyCards;
    const totalAssets = cash + investment;
    return { accounts, cash, investment, totalAssets, liabilities, netWorth: totalAssets - liabilities, allocation: { tw, us, funds, gold: gold + silver, cash } };
  }

  function monthSummary(ledger, assets, month = monthOf()) {
    const rows = buildEvents(ledger, assets).filter(row => String(row.date || "").startsWith(month) && !row.pending);
    const income = rows.filter(row => ["income", "dividend"].includes(row.kind)).reduce((sum, row) => sum + row.twdAmount, 0);
    const expense = rows.filter(row => row.kind === "expense").reduce((sum, row) => sum + row.twdAmount, 0);
    const investmentNet = rows.filter(row => row.kind.startsWith("investment_")).reduce((sum, row) => sum + row.twdAmount * row.direction, 0);
    const categorySpend = {};
    rows.filter(row => row.kind === "expense").forEach(row => { categorySpend[row.category] = number(categorySpend[row.category]) + row.twdAmount; });
    const budget = (ledger.budgets || []).reduce((sum, row) => sum + number(row.amount), 0);
    return { month, rows, income, expense, investmentNet, balance: income - expense, budget, budgetRemaining: budget ? budget - expense : null, categorySpend };
  }

  function averageMonthlyExpense(ledger, assets, count = 3) {
    const now = new Date();
    const months = Array.from({ length: count }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    });
    const values = months.map(month => monthSummary(ledger, assets, month).expense).filter(value => value > 0);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : number(assets.safety?.monthlyExpense);
  }

  function alerts(ledger, assets) {
    const today = localDate();
    const inSevenDays = new Date(`${today}T00:00:00`); inSevenDays.setDate(inSevenDays.getDate() + 7);
    const seven = localDate(inSevenDays);
    const result = [];
    const summary = monthSummary(ledger, assets);
    (ledger.budgets || []).forEach(budget => {
      const spent = number(summary.categorySpend[budget.category]);
      const limit = number(budget.amount);
      if (limit && spent >= limit) result.push({ level: "danger", title: `${budget.category}已超出預算`, detail: `本月已使用 ${Math.round(spent).toLocaleString("zh-TW")}／${Math.round(limit).toLocaleString("zh-TW")}` });
      else if (limit && spent / limit >= 0.8) result.push({ level: "warning", title: `${budget.category}接近預算上限`, detail: `目前已使用 ${Math.round(spent / limit * 100)}%` });
    });
    (ledger.creditBills || []).filter(row => !row.paid && row.dueDate && row.dueDate <= seven).forEach(row => {
      result.push({ level: row.dueDate < today ? "danger" : "warning", title: `${row.card}帳單${row.dueDate < today ? "已逾期" : "即將到期"}`, detail: `${row.dueDate}｜${Math.round(number(row.amount)).toLocaleString("zh-TW")} 元` });
    });
    const summaryAssets = assetSummary(ledger, assets);
    const avgExpense = averageMonthlyExpense(ledger, assets);
    const safetyMonths = avgExpense > 0 ? summaryAssets.cash / avgExpense : null;
    if (safetyMonths !== null && safetyMonths < 3) result.push({ level: "danger", title: "現金安全水位偏低", detail: `約可支應 ${safetyMonths.toFixed(1)} 個月支出` });
    else if (safetyMonths !== null && safetyMonths < 6) result.push({ level: "warning", title: "現金安全水位需留意", detail: `約可支應 ${safetyMonths.toFixed(1)} 個月支出` });
    const allocationTotal = Object.values(summaryAssets.allocation).reduce((a, b) => a + b, 0);
    Object.entries(summaryAssets.allocation).forEach(([key, value]) => {
      if (allocationTotal && key !== "cash" && value / allocationTotal > 0.55) result.push({ level: "warning", title: "資產配置集中", detail: `${({ tw: "台股", us: "美股", funds: "基金", gold: "貴金屬" })[key] || key}占比約 ${Math.round(value / allocationTotal * 100)}%` });
    });
    accountBalances(ledger, assets).filter(row => row.type !== "信用卡" && row.twdBalance < 0).forEach(row => result.push({ level: "danger", title: `${row.name}餘額為負`, detail: `請檢查漏記轉帳或期初餘額` }));
    if (!(assets.assetSnapshots || []).length) result.push({ level: "info", title: "尚未建立資產快照", detail: "建立快照後才能追蹤淨資產變化" });
    return result.slice(0, 12);
  }

  function buildEnvelope() {
    const previous = readJson(KEYS.unified, {});
    const ledger = ensureLedger(readJson(KEYS.ledger, emptyLedger));
    const assets = ensureAssets(readJson(KEYS.assets, emptyAssets));
    return {
      schemaVersion: VERSION,
      updatedAt: previous.updatedAt || nowIso(),
      deviceId: preferences().deviceId,
      ledger, assets,
      events: buildEvents(ledger, assets)
    };
  }

  function backupSafe(value) {
    return JSON.parse(JSON.stringify(value, (key, item) => /^(receiptDataUrl|imageDataUrl|photoDataUrl)$/i.test(key) ? "" : item));
  }

  function createBackup(reason = "自動還原點") {
    const current = buildEnvelope();
    const backups = readJson(KEYS.backups, []);
    const item = { id: uid("backup"), createdAt: nowIso(), reason, schemaVersion: VERSION, data: backupSafe(current) };
    backups.unshift(item);
    try { writeJson(KEYS.backups, backups.slice(0, 12)); }
    catch {
      try { writeJson(KEYS.backups, backups.slice(0, 4)); } catch {}
    }
    return item;
  }

  function persist(ledger, assets, reason = "資料更新", options = {}) {
    const normalizedLedger = ensureLedger(ledger);
    const normalizedAssets = ensureAssets(assets);
    if (options.backup !== false) createBackup(reason);
    writeJson(KEYS.ledger, normalizedLedger);
    writeJson(KEYS.assets, normalizedAssets);
    const envelope = {
      schemaVersion: VERSION, updatedAt: nowIso(), deviceId: preferences().deviceId,
      ledger: normalizedLedger, assets: normalizedAssets, events: buildEvents(normalizedLedger, normalizedAssets),
      lastMutation: reason
    };
    writeJson(KEYS.unified, envelope);
    window.dispatchEvent(new CustomEvent("finance-core-change", { detail: { reason, updatedAt: envelope.updatedAt } }));
    return envelope;
  }

  function touch(source = "legacy-app") {
    const current = buildEnvelope();
    current.updatedAt = nowIso();
    current.lastMutation = source;
    current.events = buildEvents(current.ledger, current.assets);
    try { writeJson(KEYS.unified, current); } catch {}
    window.dispatchEvent(new CustomEvent("finance-core-change", { detail: { reason: source, updatedAt: current.updatedAt } }));
    return current;
  }

  function load() {
    const data = buildEnvelope();
    try { writeJson(KEYS.unified, data); } catch {}
    return data;
  }

  function addEntry(values) {
    const { ledger, assets } = load();
    const row = {
      id: uid("entry"), type: values.type === "income" ? "income" : "expense", date: values.date || localDate(),
      amount: Math.max(0, number(values.amount)), category: values.category || "未分類", item: values.item || "",
      account: values.account || ledger.accounts[0]?.name || "", merchant: values.merchant || "", note: values.note || "",
      createdAt: nowIso(), purchaseRegion: "", postedDate: "", statementMonthOverride: "", statementStatus: "estimated",
      isForeignTransactionFee: false, derivedFromEntryId: "", feeRate: 0
    };
    ledger.entries.push(row);
    ledger.categories[row.type] = unique([...(ledger.categories[row.type] || []), row.category]);
    return persist(ledger, assets, row.type === "income" ? "新增收入" : "新增支出");
  }

  function addTransfer(values) {
    const { ledger, assets } = load();
    const amount = Math.max(0, number(values.amount));
    ledger.transfers.push({
      id: uid("transfer"), date: values.date || localDate(), fromAccount: values.fromAccount || "",
      toAccount: values.toAccount || "", fromAmount: amount, toAmount: Math.max(0, number(values.toAmount) || amount),
      feeAmount: Math.max(0, number(values.feeAmount)), feeAccount: values.feeAccount || values.fromAccount || "",
      creditBillId: values.creditBillId || "", note: values.note || "", createdAt: nowIso()
    });
    return persist(ledger, assets, "新增帳戶轉帳");
  }

  function addPurchase(values) {
    const { ledger, assets } = load();
    assets.purchaseRecords.push({
      id: uid("trade"), date: values.date || localDate(), type: values.type === "sell" ? "sell" : "buy",
      market: values.market === "US" ? "US" : "TW", code: String(values.code || "").trim().toUpperCase(), name: values.name || "",
      shares: Math.max(0, number(values.shares)), price: Math.max(0, number(values.price)), fee: Math.max(0, number(values.fee)),
      tax: Math.max(0, number(values.tax)), currency: normalizeCurrency(values.currency || (values.market === "US" ? "USD" : "TWD")),
      cashAccount: values.cashAccount || "", note: values.note || "", createdAt: nowIso()
    });
    return persist(ledger, assets, values.type === "sell" ? "新增投資賣出" : "新增投資買入");
  }

  function addDividend(values) {
    const { ledger, assets } = load();
    assets.dividends.push({
      id: uid("dividend"), date: values.date || localDate(), source: values.source || "", currency: normalizeCurrency(values.currency || "TWD"),
      amount: Math.max(0, number(values.amount)), cashAccount: values.cashAccount || "", note: values.note || "", createdAt: nowIso()
    });
    return persist(ledger, assets, "新增股息收入");
  }

  function addAccount(values) {
    const { ledger, assets } = load();
    if (!values.name || ledger.accounts.some(row => row.name === values.name)) throw new Error("帳戶名稱不可空白或重複");
    ledger.accounts.push({ id: uid("account"), name: values.name, type: values.type || "銀行帳戶", currency: normalizeCurrency(values.currency || "TWD"), openingBalance: number(values.openingBalance), statementDay: number(values.statementDay), paymentDay: number(values.paymentDay) });
    return persist(ledger, assets, "新增財務帳戶");
  }

  function listBackups() { return readJson(KEYS.backups, []).map(({ data, ...meta }) => meta); }
  function restoreBackup(id) {
    const backup = readJson(KEYS.backups, []).find(row => row.id === id);
    if (!backup?.data) throw new Error("找不到指定還原點");
    createBackup("還原前自動備份");
    return persist(backup.data.ledger, backup.data.assets, `還原：${backup.reason}`, { backup: false });
  }

  function importBundle(payload) {
    const current = load();
    let ledger = current.ledger;
    let assets = current.assets;
    if (payload?.ledger || payload?.assets) {
      ledger = payload.ledger || ledger; assets = payload.assets || assets;
    } else if (payload?.accountingLedger || payload?.tw || payload?.purchaseRecords) {
      assets = payload;
      if (payload.accountingLedger) ledger = payload.accountingLedger;
    } else if (payload?.entries || payload?.accounts) ledger = payload;
    else throw new Error("無法辨識此財務存檔格式");
    return persist(ledger, assets, "匯入完整財務存檔");
  }

  function exportBundle() {
    const current = load();
    return { product: "TSUBIN Personal Finance Center", exportedAt: nowIso(), schemaVersion: VERSION, ...current };
  }

  function insights() {
    const { ledger, assets, events, updatedAt, deviceId } = load();
    return {
      ledger, assets, events, updatedAt, deviceId,
      assetsSummary: assetSummary(ledger, assets),
      month: monthSummary(ledger, assets),
      alerts: alerts(ledger, assets),
      averageMonthlyExpense: averageMonthlyExpense(ledger, assets)
    };
  }

  window.FinanceCore = {
    VERSION, KEYS, load, touch, persist, insights, buildEvents, accountBalances, assetSummary, monthSummary, alerts,
    addEntry, addTransfer, addPurchase, addDividend, addAccount, createBackup, listBackups, restoreBackup, importBundle,
    exportBundle, localDate, monthOf, fxRate
  };
})();
