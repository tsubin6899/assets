(function () {
  "use strict";

  const VERSION = 4;
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
    marketPrices: {}, marketDataMeta: {}, valuationCache: {},
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
  function shiftMonthValue(month = monthOf(), offset = 0) {
    const [year, monthNumber] = String(month).split("-").map(Number);
    const date = new Date(year, monthNumber - 1 + number(offset), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  function daysInMonth(month = monthOf()) {
    const [year, monthNumber] = String(month).split("-").map(Number);
    return new Date(year, monthNumber, 0).getDate();
  }
  function recurringDatesForMonth(rule, month = monthOf()) {
    const cycle = ["weekly", "monthly", "yearly"].includes(rule?.cycle) ? rule.cycle : "monthly";
    const endDate = String(rule?.endDate || "");
    const startMonth = String(rule?.startMonth || rule?.createdAt || "").slice(0, 7);
    const startDate = String(rule?.startDate || rule?.createdAt || "").slice(0, 10);
    if (startMonth && month < startMonth) return [];
    const dates = [];
    if (cycle === "weekly") {
      const targetDow = number(rule?.day) >= 7 ? 0 : Math.max(1, number(rule?.day) || 1);
      for (let day = 1; day <= daysInMonth(month); day += 1) {
        const date = `${month}-${String(day).padStart(2, "0")}`;
        if (new Date(`${date}T00:00:00`).getDay() === targetDow && (!startDate || date >= startDate) && (!endDate || date <= endDate)) dates.push(date);
      }
      return dates;
    }
    if (cycle === "yearly") {
      const annualMonth = String(rule?.startMonth || rule?.createdAt || month).slice(5, 7);
      if (month.slice(5, 7) !== annualMonth) return [];
    }
    const date = `${month}-${String(Math.min(Math.max(1, number(rule?.day) || 1), daysInMonth(month))).padStart(2, "0")}`;
    return (!startDate || date >= startDate) && (!endDate || date <= endDate) ? [date] : [];
  }
  function recurringScheduledDate(entry) { return String(entry?.scheduledDate || entry?.date || ""); }
  function recurringOccurrences(ledger, month = monthOf(), asOf = localDate()) {
    const entries = Array.isArray(ledger?.entries) ? ledger.entries : [];
    return (ledger?.recurringRules || []).flatMap(rule => recurringDatesForMonth(rule, month).map(scheduledDate => {
      const existing = entries.find(row => row.recurringId === rule.id && recurringScheduledDate(row) === scheduledDate);
      if (existing?.recurringSkipped) return null;
      const date = String(existing?.date || scheduledDate);
      return {
        id: existing?.id || `projected:${rule.id}:${scheduledDate}`, sourceId: existing?.id || "", ruleId: rule.id,
        type: existing ? (existing.type === "income" ? "income" : "expense") : (rule.type === "income" ? "income" : "expense"), date, scheduledDate,
        amount: number(existing?.amount ?? rule.amount), category: existing?.category || rule.category || "未分類",
        item: existing?.item || rule.item || "", account: existing?.account || rule.account || "",
        merchant: existing?.merchant || rule.name || "固定收支", note: existing?.note || "固定收支預定項目",
        pending: Boolean(date > asOf), virtual: !existing, recurringId: rule.id
      };
    }).filter(Boolean));
  }
  function materializeDueRecurring(ledger, asOf = localDate()) {
    if (!ledger || !Array.isArray(ledger.entries)) return 0;
    const month = monthOf(asOf);
    let created = 0;
    (ledger.recurringRules || []).forEach(rule => recurringDatesForMonth(rule, month).forEach(scheduledDate => {
      if (scheduledDate > asOf) return;
      const exists = ledger.entries.some(row => row.recurringId === rule.id && recurringScheduledDate(row) === scheduledDate);
      if (exists) return;
      ledger.entries.push({
        id: uid("entry"), type: rule.type === "income" ? "income" : "expense", date: scheduledDate,
        amount: Math.max(0, number(rule.amount)), category: rule.category || "未分類", item: rule.item || "",
        account: rule.account || "", merchant: rule.name || "固定收支", note: "固定收支到期自動入帳",
        recurringId: rule.id, scheduledDate, recurringRealizedAt: nowIso(), createdAt: nowIso()
      });
      created += 1;
    }));
    return created;
  }
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
    result.marketPrices = value.marketPrices && typeof value.marketPrices === "object" ? value.marketPrices : {};
    result.marketDataMeta = value.marketDataMeta && typeof value.marketDataMeta === "object" ? value.marketDataMeta : {};
    result.valuationCache = value.valuationCache && typeof value.valuationCache === "object" ? value.valuationCache : {};
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
        pending: Boolean(row.date && String(row.date) > localDate()), note: row.note || "", raw: row
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

  function stockTradeKey(row) {
    const market = String(row.market || "TW").trim().toUpperCase() === "US" ? "US" : "TW";
    const code = String(row.code || "").trim().toUpperCase();
    const currency = normalizeCurrency(row.currency || (market === "US" ? "USD" : "TWD"));
    return code ? `${market}:${code}:${currency}` : "";
  }

  function marketQuoteKey(market, code) {
    const normalizedMarket = String(market || "TW").trim().toUpperCase() === "US" ? "US" : "TW";
    const normalizedCode = String(code || "").trim().toUpperCase();
    return normalizedCode ? `${normalizedMarket}:${normalizedCode}` : "";
  }

  function marketQuote(assets, market, code) {
    return assets.marketPrices?.[marketQuoteKey(market, code)] || null;
  }

  function manualStockRows(assets) {
    return [
      ...(assets.tw || []).map(row => ({ ...row, assetClass: "tw", market: "TW", currency: normalizeCurrency(row.currency || "TWD"), manualId: row.id || "" })),
      ...(assets.us || []).map(row => ({ ...row, assetClass: "us", market: "US", currency: normalizeCurrency(row.currency || "USD"), manualId: row.id || "" }))
    ].map(row => ({ ...row, key: stockTradeKey(row) }));
  }

  function stockPositionSummary(assets) {
    const epsilon = 0.000001;
    const manual = manualStockRows(assets);
    const manualByKey = new Map();
    manual.forEach(row => { if (row.key && !manualByKey.has(row.key)) manualByKey.set(row.key, row); });
    const positions = new Map();
    const tradeDetails = [];
    (assets.purchaseRecords || []).map((row, index) => ({ row, index })).sort((a, b) => String(a.row.date || "").localeCompare(String(b.row.date || "")) || a.index - b.index).forEach(({ row, index }) => {
      const key = stockTradeKey(row);
      const shares = Math.max(0, number(row.shares));
      if (!key || !shares) return;
      const type = row.type === "sell" ? "sell" : "buy";
      const position = positions.get(key) || {
        key, market: String(row.market || "TW").toUpperCase() === "US" ? "US" : "TW",
        assetClass: String(row.market || "TW").toUpperCase() === "US" ? "us" : "tw",
        currency: normalizeCurrency(row.currency || (row.market === "US" ? "USD" : "TWD")),
        code: String(row.code || "").trim().toUpperCase(), name: row.name || "", bought: 0, sold: 0,
        rawShares: 0, basis: 0, realized: 0, lastPrice: 0, lastDate: ""
      };
      const gross = shares * Math.max(0, number(row.price));
      const fees = Math.max(0, number(row.fee)) + Math.max(0, number(row.tax));
      position.name = row.name || position.name;
      if (number(row.price) > 0) position.lastPrice = number(row.price);
      position.lastDate = String(row.date || position.lastDate);
      if (type === "sell") {
        const available = Math.max(0, position.rawShares);
        const appliedShares = Math.min(shares, available);
        const averageCost = available > epsilon ? position.basis / available : 0;
        const soldBasis = averageCost * appliedShares;
        const proceeds = Math.max(0, gross - fees);
        const realized = proceeds - soldBasis;
        position.sold += shares;
        position.rawShares -= shares;
        position.basis = Math.max(0, position.basis - soldBasis);
        position.realized += realized;
        tradeDetails.push({
          ...row, sourceId: row.id || "", originalIndex: index, key, type, shares,
          price: Math.max(0, number(row.price)), fee: Math.max(0, number(row.fee)), tax: Math.max(0, number(row.tax)),
          gross, fees, netAmount: proceeds, twdNetAmount: proceeds * fxRate(assets, row.currency), averageCost, soldBasis, realized,
          twdRealized: realized * fxRate(assets, row.currency),
          realizedRate: soldBasis > epsilon ? realized / soldBasis * 100 : 0,
          remainingShares: Math.max(0, position.rawShares), oversold: shares > available + epsilon
        });
      } else {
        const totalCost = gross + fees;
        position.bought += shares;
        position.rawShares += shares;
        position.basis += totalCost;
        tradeDetails.push({
          ...row, sourceId: row.id || "", originalIndex: index, key, type, shares,
          price: Math.max(0, number(row.price)), fee: Math.max(0, number(row.fee)), tax: Math.max(0, number(row.tax)),
          gross, fees, netAmount: totalCost, twdNetAmount: totalCost * fxRate(assets, row.currency),
          averageCost: position.rawShares > epsilon ? position.basis / position.rawShares : 0,
          soldBasis: 0, realized: null, realizedRate: null,
          remainingShares: Math.max(0, position.rawShares), oversold: false
        });
      }
      positions.set(key, position);
    });
    const rows = [...positions.values()].map(position => {
      const manualRow = manualByKey.get(position.key);
      const shares = Math.max(0, position.rawShares);
      const manualShares = Math.max(0, number(manualRow?.shares ?? manualRow?.units ?? manualRow?.quantity));
      const quote = marketQuote(assets, position.market, position.code);
      const currentPrice = number(quote?.price) || number(manualRow?.currentPrice ?? manualRow?.price ?? manualRow?.marketPrice) || position.lastPrice;
      const averageCost = shares > epsilon ? position.basis / shares : 0;
      return {
        ...position, shares, manualShares, currentPrice, averageCost,
        value: shares * currentPrice * fxRate(assets, position.currency),
        closed: position.bought > 0 && shares <= epsilon,
        oversold: position.rawShares < -epsilon,
        manualId: manualRow?.manualId || "",
        manualAssetClass: manualRow?.assetClass || position.assetClass,
        discrepancy: Boolean(manualRow && Math.abs(manualShares - shares) > epsilon),
        source: "trades"
      };
    });
    const managedKeys = new Set(rows.map(row => row.key));
    const manualOnly = manual.filter(row => !row.key || !managedKeys.has(row.key)).map(row => {
      const shares = Math.max(0, number(row.shares ?? row.units ?? row.quantity));
      const quote = marketQuote(assets, row.market, row.code);
      const currentPrice = number(quote?.price) || number(row.currentPrice ?? row.price ?? row.marketPrice);
      return { ...row, shares, currentPrice, value: shares * currentPrice * fxRate(assets, row.currency), closed: shares <= epsilon, source: "manual" };
    });
    return {
      active: rows.filter(row => !row.closed),
      closed: rows.filter(row => row.closed),
      manualOnly: manualOnly.filter(row => !row.closed),
      discrepancies: rows.filter(row => row.discrepancy || row.oversold),
      managedKeys: [...managedKeys],
      trades: tradeDetails.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || b.originalIndex - a.originalIndex)
    };
  }

  function assetSummary(ledger, assets) {
    const accounts = accountBalances(ledger, assets);
    const regularCash = accounts.filter(row => row.type !== "信用卡").reduce((sum, row) => sum + row.twdBalance, 0);
    const knownNames = new Set(accounts.map(row => row.name));
    const manualCash = (assets.cash || []).filter(row => !knownNames.has(row.bank)).reduce((sum, row) => sum + number(row.amount) * fxRate(assets, row.currency), 0);
    const creditDebt = accounts.filter(row => row.type === "信用卡").reduce((sum, row) => sum + Math.max(0, row.twdBalance), 0);
    const legacyCards = (assets.cards || []).filter(row => !knownNames.has(row.card)).reduce((sum, row) => sum + Math.max(0, number(row.amount)), 0);
    const stockPositions = stockPositionSummary(assets);
    const activeStocks = [...stockPositions.active, ...stockPositions.manualOnly];
    const tw = activeStocks.filter(row => row.market === "TW").reduce((sum, row) => sum + number(row.value), 0);
    const us = activeStocks.filter(row => row.market === "US").reduce((sum, row) => sum + number(row.value), 0);
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
    const materialized = materializeDueRecurring(ledger);
    if (materialized) writeJson(KEYS.ledger, ledger);
    return {
      schemaVersion: VERSION,
      updatedAt: materialized ? nowIso() : (previous.updatedAt || nowIso()),
      deviceId: preferences().deviceId,
      ledger, assets,
      events: buildEvents(ledger, assets),
      ...(materialized ? { lastMutation: `固定收支到期自動入帳 ${materialized} 筆` } : {})
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

  function updateEntry(id, values) {
    const { ledger, assets } = load();
    const row = ledger.entries.find(item => item.id === id);
    if (!row) throw new Error("找不到這筆收支紀錄");
    const type = values.type === "income" ? "income" : "expense";
    Object.assign(row, {
      type, date: values.date || row.date || localDate(), amount: Math.max(0, number(values.amount)),
      category: values.category || "未分類", item: values.item || "", account: values.account || "",
      merchant: values.merchant || "", note: values.note || "", updatedAt: nowIso()
    });
    ledger.categories[type] = unique([...(ledger.categories[type] || []), row.category]);
    return persist(ledger, assets, "修改收支紀錄");
  }

  function recycle(ledger, kind, row) {
    ledger.recycleBin.unshift({ id: uid("trash"), kind, removedAt: nowIso(), row: clone(row) });
    ledger.recycleBin = ledger.recycleBin.slice(0, 100);
  }

  function removeEntry(id) {
    const { ledger, assets } = load();
    const index = ledger.entries.findIndex(item => item.id === id);
    if (index < 0) throw new Error("找不到這筆收支紀錄");
    recycle(ledger, "entry", ledger.entries[index]);
    ledger.entries.splice(index, 1);
    return persist(ledger, assets, "刪除收支紀錄");
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

  function updateTransfer(id, values) {
    const { ledger, assets } = load();
    const row = ledger.transfers.find(item => item.id === id);
    if (!row) throw new Error("找不到這筆轉帳");
    const amount = Math.max(0, number(values.amount ?? values.fromAmount));
    Object.assign(row, {
      date: values.date || row.date || localDate(), fromAccount: values.fromAccount || "", toAccount: values.toAccount || "",
      fromAmount: amount, toAmount: Math.max(0, number(values.toAmount) || amount),
      feeAmount: Math.max(0, number(values.feeAmount)), feeAccount: values.feeAccount || values.fromAccount || "",
      note: values.note || "", updatedAt: nowIso()
    });
    return persist(ledger, assets, "修改帳戶轉帳");
  }

  function removeTransfer(id) {
    const { ledger, assets } = load();
    const index = ledger.transfers.findIndex(item => item.id === id);
    if (index < 0) throw new Error("找不到這筆轉帳");
    const row = ledger.transfers[index];
    recycle(ledger, "transfer", row);
    ledger.transfers.splice(index, 1);
    ledger.creditBills.forEach(bill => {
      if (bill.transferId === id) Object.assign(bill, { paid: false, paidAt: "", transferId: "" });
    });
    return persist(ledger, assets, "刪除帳戶轉帳");
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

  function replaceAccountReferences(ledger, assets, from, to) {
    if (!from || from === to) return;
    ledger.entries.forEach(row => { if (row.account === from) row.account = to; });
    ledger.transfers.forEach(row => ["fromAccount", "toAccount", "feeAccount"].forEach(key => { if (row[key] === from) row[key] = to; }));
    ledger.creditBills.forEach(row => { if (row.card === from) row.card = to; if (row.payAccount === from) row.payAccount = to; });
    ledger.creditInstallments.forEach(row => { if (row.card === from) row.card = to; });
    ledger.templates.forEach(row => { if (row.account === from) row.account = to; });
    ledger.recurringRules.forEach(row => { if (row.account === from) row.account = to; });
    ledger.reconciliations.forEach(row => { if (row.account === from) row.account = to; });
    ledger.creditStatementChecks.forEach(row => { if (row.card === from) row.card = to; });
    assets.purchaseRecords.forEach(row => { if (row.cashAccount === from) row.cashAccount = to; });
    assets.dividends.forEach(row => { if (row.cashAccount === from) row.cashAccount = to; });
    assets.cash.forEach(row => { if (row.bank === from) row.bank = to; });
  }

  function updateAccount(id, values) {
    const { ledger, assets } = load();
    const row = ledger.accounts.find(item => item.id === id);
    const name = String(values.name || "").trim();
    if (!row) throw new Error("找不到這個帳戶");
    if (!name || ledger.accounts.some(item => item.id !== id && item.name === name)) throw new Error("帳戶名稱不可空白或重複");
    const oldName = row.name;
    Object.assign(row, {
      name, type: values.type || "銀行帳戶", currency: normalizeCurrency(values.currency || "TWD"),
      openingBalance: number(values.openingBalance), statementDay: number(values.statementDay),
      paymentDay: number(values.paymentDay), updatedAt: nowIso()
    });
    replaceAccountReferences(ledger, assets, oldName, name);
    return persist(ledger, assets, "修改財務帳戶");
  }

  function addCreditBill(values) {
    const { ledger, assets } = load();
    if (!values.card || !values.payAccount || !values.billMonth || number(values.amount) <= 0) throw new Error("請完整填寫帳單資料");
    ledger.creditBills.push({
      id: uid("bill"), card: values.card, billMonth: String(values.billMonth).slice(0, 7), dueDate: values.dueDate || "",
      amount: Math.max(0, number(values.amount)), payAccount: values.payAccount, paid: false, paidAt: "", transferId: "", createdAt: nowIso()
    });
    return persist(ledger, assets, "新增信用卡帳單");
  }

  function updateCreditBill(id, values) {
    const { ledger, assets } = load();
    const row = ledger.creditBills.find(item => item.id === id);
    if (!row) throw new Error("找不到這筆信用卡帳單");
    Object.assign(row, { card: values.card, billMonth: String(values.billMonth || row.billMonth).slice(0, 7), dueDate: values.dueDate || "", amount: Math.max(0, number(values.amount)), payAccount: values.payAccount, updatedAt: nowIso() });
    return persist(ledger, assets, "修改信用卡帳單");
  }

  function removeCreditBill(id) {
    const { ledger, assets } = load();
    const index = ledger.creditBills.findIndex(item => item.id === id);
    if (index < 0) throw new Error("找不到這筆信用卡帳單");
    const bill = ledger.creditBills[index];
    if (bill.transferId) ledger.transfers = ledger.transfers.filter(row => row.id !== bill.transferId);
    recycle(ledger, "creditBill", bill);
    ledger.creditBills.splice(index, 1);
    return persist(ledger, assets, "刪除信用卡帳單");
  }

  function setCreditBillPaid(id, paid = true) {
    const { ledger, assets } = load();
    const bill = ledger.creditBills.find(row => row.id === id);
    if (!bill) throw new Error("找不到這筆信用卡帳單");
    if (paid && !bill.paid) {
      if (!ledger.accounts.some(row => row.name === bill.card) || !ledger.accounts.some(row => row.name === bill.payAccount)) throw new Error("找不到信用卡或繳款帳戶");
      const transferId = uid("transfer");
      ledger.transfers.push({ id: transferId, date: localDate(), fromAccount: bill.payAccount, toAccount: bill.card, fromAmount: number(bill.amount), toAmount: number(bill.amount), feeAmount: 0, feeAccount: bill.payAccount, creditBillId: bill.id, note: `${bill.billMonth} ${bill.card} 信用卡帳單繳款`, createdAt: nowIso() });
      Object.assign(bill, { paid: true, paidAt: nowIso(), transferId });
    } else if (!paid && bill.paid) {
      ledger.transfers = ledger.transfers.filter(row => row.id !== bill.transferId);
      Object.assign(bill, { paid: false, paidAt: "", transferId: "" });
    }
    return persist(ledger, assets, paid ? "記錄信用卡繳款" : "取消信用卡繳款");
  }

  function addRecurring(values) {
    const { ledger, assets } = load();
    const row = {
      id: uid("recurring"), type: values.type === "income" ? "income" : "expense", name: String(values.name || "").trim(),
      amount: Math.max(0, number(values.amount)), category: values.category || "未分類", item: values.item || "",
      account: values.account || "", cycle: ["weekly", "monthly", "yearly"].includes(values.cycle) ? values.cycle : "monthly",
      day: Math.min(31, Math.max(1, number(values.day) || 1)), endDate: values.endDate || "", startMonth: monthOf(), startDate: localDate(), createdAt: nowIso()
    };
    if (!row.name || !row.amount || !row.account) throw new Error("請完整填寫固定收支");
    ledger.recurringRules.push(row);
    ledger.categories[row.type] = unique([...(ledger.categories[row.type] || []), row.category]);
    return persist(ledger, assets, "新增固定收支");
  }

  function updateRecurring(id, values) {
    const { ledger, assets } = load();
    const row = ledger.recurringRules.find(item => item.id === id);
    if (!row) throw new Error("找不到這筆固定收支");
    Object.assign(row, { type: values.type === "income" ? "income" : "expense", name: String(values.name || "").trim(), amount: Math.max(0, number(values.amount)), category: values.category || "未分類", item: values.item || "", account: values.account || "", cycle: ["weekly", "monthly", "yearly"].includes(values.cycle) ? values.cycle : "monthly", day: Math.min(31, Math.max(1, number(values.day) || 1)), endDate: values.endDate || "", updatedAt: nowIso() });
    return persist(ledger, assets, "修改固定收支");
  }

  function removeRecurring(id) {
    const { ledger, assets } = load();
    const index = ledger.recurringRules.findIndex(item => item.id === id);
    if (index < 0) throw new Error("找不到這筆固定收支");
    recycle(ledger, "recurring", ledger.recurringRules[index]);
    ledger.recurringRules.splice(index, 1);
    return persist(ledger, assets, "刪除固定收支");
  }

  function upsertBudget(values) {
    const { ledger, assets } = load();
    const category = String(values.category || "").trim();
    const amount = Math.max(0, number(values.amount));
    if (!category || !amount) throw new Error("請選擇分類並輸入預算");
    const row = ledger.budgets.find(item => item.id === values.id || item.category === category);
    if (row) Object.assign(row, { category, amount, updatedAt: nowIso() });
    else ledger.budgets.push({ id: uid("budget"), category, amount, createdAt: nowIso() });
    return persist(ledger, assets, row ? "修改分類預算" : "新增分類預算");
  }

  function removeBudget(id) {
    const { ledger, assets } = load();
    const index = ledger.budgets.findIndex(item => item.id === id);
    if (index < 0) throw new Error("找不到這筆分類預算");
    recycle(ledger, "budget", ledger.budgets[index]);
    ledger.budgets.splice(index, 1);
    return persist(ledger, assets, "刪除分類預算");
  }

  function addInstallment(values) {
    const { ledger, assets } = load();
    const row = { id: uid("installment"), card: values.card || "", purchaseDate: values.purchaseDate || localDate(), merchant: values.merchant || "", category: values.category || "其他支出", item: values.item || "", totalAmount: Math.max(0, number(values.totalAmount)), months: Math.max(2, number(values.months) || 2), startMonth: String(values.startMonth || monthOf()).slice(0, 7), note: values.note || "", createdAt: nowIso() };
    if (!row.card || !row.totalAmount) throw new Error("請完整填寫分期資料");
    ledger.creditInstallments.push(row);
    return persist(ledger, assets, "新增信用卡分期");
  }

  function updateInstallment(id, values) {
    const { ledger, assets } = load();
    const row = ledger.creditInstallments.find(item => item.id === id);
    if (!row) throw new Error("找不到這筆分期");
    Object.assign(row, { card: values.card || "", purchaseDate: values.purchaseDate || localDate(), merchant: values.merchant || "", category: values.category || "其他支出", item: values.item || "", totalAmount: Math.max(0, number(values.totalAmount)), months: Math.max(2, number(values.months) || 2), startMonth: String(values.startMonth || monthOf()).slice(0, 7), note: values.note || "", updatedAt: nowIso() });
    return persist(ledger, assets, "修改信用卡分期");
  }

  function removeInstallment(id) {
    const { ledger, assets } = load();
    const index = ledger.creditInstallments.findIndex(item => item.id === id);
    if (index < 0) throw new Error("找不到這筆分期");
    recycle(ledger, "installment", ledger.creditInstallments[index]); ledger.creditInstallments.splice(index, 1);
    return persist(ledger, assets, "刪除信用卡分期");
  }

  function addReconciliation(values) {
    const { ledger, assets } = load();
    const account = accountBalances(ledger, assets, values.date || localDate()).find(row => row.name === values.account);
    if (!account) throw new Error("找不到盤點帳戶");
    const actual = number(values.actualBalance), book = number(account.balance), diff = actual - book, date = values.date || localDate();
    let entryId = "";
    if (diff) {
      entryId = uid("entry"); ledger.entries.push({ id: entryId, type: diff > 0 ? "income" : "expense", date, amount: Math.abs(diff), category: "現金盤點調整", item: diff > 0 ? "現金多出" : "現金短少", account: account.name, merchant: "帳戶盤點", note: `盤點調整：帳面 ${book}，實際 ${actual}`, createdAt: nowIso() });
    }
    ledger.reconciliations.push({ id: uid("reconcile"), date, account: account.name, bookBalance: book, actualBalance: actual, diff, entryId, createdAt: nowIso() });
    return persist(ledger, assets, "建立帳戶盤點");
  }

  function removeReconciliation(id) {
    const { ledger, assets } = load();
    const index = ledger.reconciliations.findIndex(item => item.id === id);
    if (index < 0) throw new Error("找不到這筆盤點");
    const row = ledger.reconciliations[index]; if (row.entryId) ledger.entries = ledger.entries.filter(item => item.id !== row.entryId);
    recycle(ledger, "reconciliation", row); ledger.reconciliations.splice(index, 1);
    return persist(ledger, assets, "刪除帳戶盤點");
  }

  function closeMonth(month = monthOf()) {
    const { ledger, assets } = load();
    const snapshot = clone(ledger); snapshot.monthCloseouts = [];
    ledger.monthCloseouts = ledger.monthCloseouts.filter(row => row.month !== month);
    ledger.monthCloseouts.unshift({ month, closedAt: nowIso(), ledger: snapshot });
    return persist(ledger, assets, `完成 ${month} 月結`);
  }

  function reopenMonth(month = monthOf()) {
    const { ledger, assets } = load(); ledger.monthCloseouts = ledger.monthCloseouts.filter(row => row.month !== month);
    return persist(ledger, assets, `重新開啟 ${month} 月結`);
  }

  function saveCreditStatementCheck(values) {
    const { ledger, assets } = load();
    const billMonth = String(values.billMonth || monthOf()).slice(0, 7), card = values.card || "";
    const entries = ledger.entries.filter(row => row.account === card && String(row.billMonth || row.statementMonthOverride || row.date || "").startsWith(billMonth));
    const appAmount = entries.reduce((sum, row) => sum + (row.type === "expense" ? number(row.amount) : -number(row.amount)), 0);
    const statementAmount = number(values.statementAmount), existing = ledger.creditStatementChecks.find(row => row.card === card && row.billMonth === billMonth);
    const matchedEntries = entries.map(row => ({ id: row.id || "", date: row.date || "", type: row.type === "income" ? "income" : "expense", category: row.category || "未分類", item: row.item || "", merchant: row.merchant || "", amount: number(row.amount), note: row.note || "" }));
    const data = { id: existing?.id || uid("statement"), card, billMonth, statementAmount, appAmount, diff: statementAmount - appAmount, matchedKeys: matchedEntries.map(row => row.id).filter(Boolean), matchedEntries, rowCount: entries.length, matchedAmount: appAmount, note: values.note || "", checkedAt: nowIso(), updatedAt: nowIso() };
    if (existing) Object.assign(existing, data); else ledger.creditStatementChecks.push(data);
    return persist(ledger, assets, "儲存信用卡對帳");
  }

  function removeCreditStatementCheck(id) {
    const { ledger, assets } = load(); ledger.creditStatementChecks = ledger.creditStatementChecks.filter(row => row.id !== id);
    return persist(ledger, assets, "刪除信用卡對帳");
  }

  function updatePurchase(id, values) {
    const { ledger, assets } = load(); const row = assets.purchaseRecords.find(item => item.id === id); if (!row) throw new Error("找不到這筆投資交易");
    Object.assign(row, { date: values.date || localDate(), type: values.type === "sell" ? "sell" : "buy", market: values.market === "US" ? "US" : "TW", code: String(values.code || "").trim().toUpperCase(), name: values.name || "", shares: Math.max(0, number(values.shares)), price: Math.max(0, number(values.price)), fee: Math.max(0, number(values.fee)), tax: Math.max(0, number(values.tax)), currency: normalizeCurrency(values.currency || (values.market === "US" ? "USD" : "TWD")), cashAccount: values.cashAccount || "", note: values.note || "", updatedAt: nowIso() });
    return persist(ledger, assets, "修改投資交易");
  }

  function removePurchase(id) { const { ledger, assets } = load(); const index=assets.purchaseRecords.findIndex(row=>row.id===id); if(index<0)throw new Error("找不到這筆投資交易"); assets.purchaseRecords.splice(index,1); return persist(ledger,assets,"刪除投資交易"); }
  function updateDividend(id, values) { const { ledger, assets }=load(); const row=assets.dividends.find(item=>item.id===id); if(!row)throw new Error("找不到這筆股息"); Object.assign(row,{date:values.date||localDate(),source:values.source||"",currency:normalizeCurrency(values.currency||"TWD"),amount:Math.max(0,number(values.amount)),cashAccount:values.cashAccount||"",note:values.note||"",updatedAt:nowIso()}); return persist(ledger,assets,"修改股息收入"); }
  function removeDividend(id) { const {ledger,assets}=load(); const index=assets.dividends.findIndex(row=>row.id===id); if(index<0)throw new Error("找不到這筆股息"); assets.dividends.splice(index,1); return persist(ledger,assets,"刪除股息收入"); }

  function holdingCollection(assets, assetClass) { return ({tw:assets.tw,us:assets.us,funds:assets.funds,usdFunds:assets.usdFunds,gold:assets.gold,silver:assets.silver})[assetClass] || assets.tw; }
  function addHolding(values) { const {ledger,assets}=load(); const rows=holdingCollection(assets,values.assetClass); rows.push({id:uid("holding"),code:String(values.code||"").trim().toUpperCase(),name:values.name||"",shares:Math.max(0,number(values.shares)),units:Math.max(0,number(values.shares)),price:Math.max(0,number(values.price)),currency:normalizeCurrency(values.currency||((values.assetClass==="us"||values.assetClass==="usdFunds")?"USD":"TWD")),createdAt:nowIso()}); return persist(ledger,assets,"新增投資持倉"); }
  function updateHolding(assetClass,id,values) { const {ledger,assets}=load(); const source=holdingCollection(assets,assetClass),index=source.findIndex(item=>item.id===id),row=source[index]; if(!row)throw new Error("找不到這筆持倉"); Object.assign(row,{code:String(values.code||"").trim().toUpperCase(),name:values.name||"",shares:Math.max(0,number(values.shares)),units:Math.max(0,number(values.shares)),price:Math.max(0,number(values.price)),currency:normalizeCurrency(values.currency||row.currency||"TWD"),updatedAt:nowIso()}); if(values.assetClass&&values.assetClass!==assetClass){source.splice(index,1);holdingCollection(assets,values.assetClass).push(row);} return persist(ledger,assets,"修改投資持倉"); }
  function removeHolding(assetClass,id) { const {ledger,assets}=load(); const rows=holdingCollection(assets,assetClass),index=rows.findIndex(row=>row.id===id); if(index<0)throw new Error("找不到這筆持倉"); rows.splice(index,1); return persist(ledger,assets,"刪除投資持倉"); }
  function syncLegacyHolding(key) {
    const { ledger, assets } = load();
    const summary = stockPositionSummary(assets);
    const position = [...summary.active, ...summary.closed].find(row => row.key === key);
    if (!position || !position.manualId) throw new Error("找不到可同步的舊持倉");
    const rows = holdingCollection(assets, position.manualAssetClass);
    const row = rows.find(item => item.id === position.manualId);
    if (!row) throw new Error("找不到舊持倉資料");
    if (row.legacySharesBeforeTradeSync === undefined) row.legacySharesBeforeTradeSync = number(row.shares ?? row.units ?? row.quantity);
    row.shares = position.shares;
    if ("units" in row) row.units = position.shares;
    if ("quantity" in row) row.quantity = position.shares;
    row.tradeManaged = true;
    row.reconciledAt = nowIso();
    return persist(ledger, assets, position.closed ? "同步已出清持倉" : "同步交易持股");
  }
  function addAssetSnapshot(values={}) { const {ledger,assets}=load(); const summary=assetSummary(ledger,assets); const date=values.date||localDate(); assets.assetSnapshots=assets.assetSnapshots.filter(row=>row.date!==date); assets.assetSnapshots.push({id:uid("snapshot"),date,total:summary.totalAssets,liabilities:summary.liabilities,net:summary.netWorth,createdAt:nowIso()}); return persist(ledger,assets,"建立資產快照"); }

  function listBackups() { return readJson(KEYS.backups, []).map(({ data, ...meta }) => meta); }
  function restoreBackup(id) {
    const backup = readJson(KEYS.backups, []).find(row => row.id === id);
    if (!backup?.data) throw new Error("找不到指定還原點");
    createBackup("還原前自動備份");
    return persist(backup.data.ledger, backup.data.assets, `還原：${backup.reason}`, { backup: false });
  }

  function marketSymbols(assetsInput) {
    const assets = ensureAssets(assetsInput || load().assets);
    const rows = [
      ...(assets.tw || []).map(row => ({ ...row, market: "TW" })),
      ...(assets.us || []).map(row => ({ ...row, market: "US" })),
      ...(assets.purchaseRecords || []),
      ...(assets.twWatchlist || []).map(row => ({ ...row, market: "TW" })),
      ...(assets.usWatchlist || []).map(row => ({ ...row, market: "US" }))
    ];
    const uniqueSymbols = new Map();
    rows.forEach(row => {
      const market = String(row.market || "TW").toUpperCase() === "US" ? "US" : "TW";
      const code = String(row.code || "").trim().toUpperCase();
      if (!code) return;
      uniqueSymbols.set(`${market}:${code}`, { code, name: row.name || "" });
    });
    const values = [...uniqueSymbols.entries()];
    return {
      generatedAt: nowIso(),
      tw: values.filter(([key]) => key.startsWith("TW:")).map(([, row]) => row),
      us: values.filter(([key]) => key.startsWith("US:")).map(([, row]) => row)
    };
  }

  function marketDocument(payload, key) {
    const nested = payload?.[key];
    return nested && typeof nested === "object" && nested[key] && typeof nested[key] === "object" ? nested : payload || {};
  }

  function applyMarketSnapshot(payload = {}) {
    const { ledger, assets } = load();
    const priceDocument = marketDocument(payload, "prices");
    const rateDocument = marketDocument(payload, "rates");
    const valuationDocument = marketDocument(payload, "valuations");
    const prices = priceDocument.prices && typeof priceDocument.prices === "object" ? priceDocument.prices : {};
    const rates = rateDocument.rates && typeof rateDocument.rates === "object" ? rateDocument.rates : {};
    const valuations = valuationDocument.valuations && typeof valuationDocument.valuations === "object" ? valuationDocument.valuations : {};
    const stamp = [priceDocument.generatedAt || "", rateDocument.generatedAt || "", valuationDocument.generatedAt || ""].join("|");
    if (stamp && assets.marketDataMeta?.stamp === stamp) {
      return { unchanged: true, pricesUpdated: 0, ratesUpdated: 0, valuationsUpdated: 0, generatedAt: assets.marketDataMeta.generatedAt || "" };
    }

    let pricesUpdated = 0;
    let ratesUpdated = 0;
    assets.marketPrices = { ...(assets.marketPrices || {}) };
    Object.entries(prices).forEach(([rawKey, rawQuote]) => {
      const quote = rawQuote && typeof rawQuote === "object" ? rawQuote : { price: rawQuote };
      const market = String(quote.market || String(rawKey).split(":")[0] || "TW").toUpperCase() === "US" ? "US" : "TW";
      const code = String(quote.symbol || String(rawKey).split(":").pop() || "").trim().toUpperCase();
      const price = number(quote.price);
      const key = marketQuoteKey(market, code);
      if (!key || price <= 0) return;
      assets.marketPrices[key] = {
        ...quote, market, symbol: code, price,
        currency: normalizeCurrency(quote.currency || (market === "US" ? "USD" : "TWD")),
        fetchedAt: quote.fetchedAt || priceDocument.generatedAt || nowIso()
      };
      const collection = market === "US" ? assets.us : assets.tw;
      collection.filter(row => String(row.code || "").trim().toUpperCase() === code).forEach(row => {
        row.price = price;
        row.currentPrice = price;
        row.priceUpdatedAt = quote.fetchedAt || priceDocument.generatedAt || nowIso();
      });
      const watchlist = market === "US" ? assets.usWatchlist : assets.twWatchlist;
      (watchlist || []).filter(row => String(row.code || "").trim().toUpperCase() === code).forEach(row => { row.price = price; });
      pricesUpdated += 1;
    });
    Object.entries(rates).forEach(([currency, rawRate]) => {
      const code = normalizeCurrency(currency);
      const rate = number(rawRate);
      if (!code || code === "TWD" || rate <= 0) return;
      assets.fxRates[code] = rate;
      if (code === "USD") assets.rates.usd = rate;
      ratesUpdated += 1;
    });
    assets.fxRates.TWD = 1;
    if (Object.keys(valuations).length) assets.valuationCache = { ...(assets.valuationCache || {}), ...valuations };
    const generatedAt = priceDocument.generatedAt || rateDocument.generatedAt || valuationDocument.generatedAt || nowIso();
    assets.fxRateMeta = ratesUpdated ? { generatedAt: rateDocument.generatedAt || generatedAt, source: rateDocument.source || "自動匯率" } : assets.fxRateMeta;
    assets.marketDataMeta = {
      stamp, generatedAt,
      priceGeneratedAt: priceDocument.generatedAt || "",
      rateGeneratedAt: rateDocument.generatedAt || "",
      valuationGeneratedAt: valuationDocument.generatedAt || "",
      priceSource: Object.values(prices)[0]?.source || priceDocument.source || "市場行情",
      rateSource: rateDocument.source || "匯率資料",
      pricesUpdated, ratesUpdated, valuationsUpdated: Object.keys(valuations).length
    };
    if (!pricesUpdated && !ratesUpdated && !Object.keys(valuations).length) {
      return { unchanged: true, pricesUpdated: 0, ratesUpdated: 0, valuationsUpdated: 0, generatedAt };
    }
    persist(ledger, assets, "更新股價與匯率", { backup: false });
    return { unchanged: false, pricesUpdated, ratesUpdated, valuationsUpdated: Object.keys(valuations).length, generatedAt };
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
      stockPositions: stockPositionSummary(assets),
      month: monthSummary(ledger, assets),
      alerts: alerts(ledger, assets),
      averageMonthlyExpense: averageMonthlyExpense(ledger, assets)
    };
  }

  window.FinanceCore = {
    VERSION, KEYS, load, touch, persist, insights, buildEvents, accountBalances, assetSummary, monthSummary, alerts,
    recurringDatesForMonth, recurringOccurrences, materializeDueRecurring,
    addEntry, updateEntry, removeEntry, addTransfer, updateTransfer, removeTransfer, addPurchase, addDividend,
    addAccount, updateAccount, addCreditBill, updateCreditBill, removeCreditBill, setCreditBillPaid,
    addRecurring, updateRecurring, removeRecurring, upsertBudget, removeBudget,
    addInstallment, updateInstallment, removeInstallment, addReconciliation, removeReconciliation, closeMonth, reopenMonth,
    saveCreditStatementCheck, removeCreditStatementCheck, updatePurchase, removePurchase, updateDividend, removeDividend,
    addHolding, updateHolding, removeHolding, syncLegacyHolding, addAssetSnapshot, stockPositionSummary,
    marketSymbols, applyMarketSnapshot,
    createBackup, listBackups, restoreBackup, importBundle,
    exportBundle, localDate, monthOf, fxRate
  };
})();
