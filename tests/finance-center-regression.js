const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const values = new Map();
const localStorage = {
  getItem(key) { return values.has(key) ? values.get(key) : null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); }
};
const window = { dispatchEvent() {} };
const context = {
  window,
  localStorage,
  CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  console, Date, Intl, JSON, Math, Number, Object, String, Array, Map, Set
};
vm.createContext(context);
["finance-core.js", "finance-sync.js", "finance-search.js", "finance-import.js", "finance-center-routes.js"].forEach(file => vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file }));

const core = window.FinanceCore;
const today = core.localDate();
const future = new Date(`${today}T00:00:00`);
future.setDate(future.getDate() + 7);
const futureDate = core.localDate(future);

core.addAccount({ name: "生活帳戶", type: "銀行帳戶", currency: "TWD", openingBalance: 10000 });
core.addAccount({ name: "測試信用卡", type: "信用卡", currency: "TWD", openingBalance: 0 });
core.addEntry({ type: "expense", date: futureDate, amount: 1000, category: "餐飲", account: "生活帳戶", merchant: "未來支出" });
assert.equal(core.insights().assetsSummary.accounts.find(row => row.name === "生活帳戶").balance, 10000, "future expense must not reduce current balance");
assert.equal(core.insights().events.find(row => row.title === "未來支出").pending, true, "future expense must be pending");

core.addEntry({ type: "expense", date: today, amount: 500, category: "餐飲", account: "生活帳戶", merchant: "今日午餐" });
core.addEntry({ type: "expense", date: today, amount: 300, category: "交通", account: "測試信用卡", merchant: "交通費" });
let snapshot = core.insights();
assert.equal(snapshot.assetsSummary.accounts.find(row => row.name === "生活帳戶").balance, 9500);
assert.equal(snapshot.assetsSummary.liabilities, 300, "credit liability must be a positive debt value");

core.applyMarketSnapshot({ rates: { rates: { USD: 30 }, generatedAt: new Date().toISOString(), source: "regression" } });
core.addAccount({ name: "美元帳戶", type: "外幣銀行帳戶", currency: "USD", openingBalance: 100 });
core.addEntry({ type: "expense", date: today, amount: 30, currency: "USD", purchaseRegion: "domestic", category: "旅遊", item: "交通", account: "美元帳戶", merchant: "美國交通" });
snapshot = core.insights();
assert.equal(snapshot.assetsSummary.accounts.find(row => row.name === "美元帳戶").balance, 70, "USD account must stay in its native currency");
assert.equal(snapshot.ledger.items.expense["旅遊"].includes("交通"), true, "category should remember its item options");
core.addEntry({ type: "expense", date: today, amount: 300, currency: "TWD", purchaseRegion: "domestic", category: "旅遊", item: "換匯支出", account: "美元帳戶", merchant: "台幣扣款" });
assert.equal(core.insights().assetsSummary.accounts.find(row => row.name === "美元帳戶").balance, 60, "TWD transaction on a USD account must convert to the account currency");

const foreignEntryResult = core.addEntry({ type: "expense", date: today, amount: 100, currency: "USD", purchaseRegion: "foreign", category: "購物", item: "網購", account: "測試信用卡", merchant: "海外商店" });
snapshot = core.insights();
let foreignEntry = snapshot.ledger.entries.find(row => row.merchant === "海外商店");
let foreignFee = snapshot.ledger.entries.find(row => row.isForeignTransactionFee && row.derivedFromEntryId === foreignEntry.id);
assert.equal(foreignEntry.amount, 3000, "foreign USD card purchase must book in the TWD card currency");
assert.equal(foreignFee.amount, 45, "foreign card fee must equal 1.5 percent");
core.saveEntryTemplate(foreignEntry.id);
assert.equal(core.insights().ledger.templates.find(row => row.name === "海外商店").amount, 100, "template must keep the original transaction amount");
core.updateEntry(foreignEntry.id, { ...foreignEntry, amount: 200, currency: "USD", purchaseRegion: "foreign" });
snapshot = core.insights();
foreignFee = snapshot.ledger.entries.find(row => row.isForeignTransactionFee && row.derivedFromEntryId === foreignEntry.id);
assert.equal(foreignFee.amount, 90, "linked fee must update with its source transaction");
assert.equal(snapshot.ledger.entries.filter(row => row.isForeignTransactionFee && row.derivedFromEntryId === foreignEntry.id).length, 1, "linked fee must not duplicate");
core.removeEntry(foreignEntry.id);
assert.equal(core.insights().ledger.entries.some(row => row.derivedFromEntryId === foreignEntry.id), false, "deleting source must delete linked fee");

core.addEntry({ type: "expense", date: today, amount: 100, currency: "USD", purchaseRegion: "domestic", category: "購物", account: "測試信用卡", merchant: "國內美元交易" });
assert.equal(core.insights().ledger.entries.some(row => row.isForeignTransactionFee && row.merchant.startsWith("國內美元交易")), false, "domestic purchase must not add foreign fee");

core.addPurchase({ type: "buy", date: today, market: "FUND", code: "TWFUND", name: "台幣基金", shares: 10, price: 100, currency: "TWD" });
core.addPurchase({ type: "buy", date: today, market: "USD_FUND", code: "USDFUND", name: "美元基金", shares: 1, price: 10, currency: "USD" });
snapshot = core.insights();
assert.equal(snapshot.assetsSummary.allocation.funds >= 1300, true, "TWD and USD fund trades must be included in fund allocation");
assert.equal(core.marketSymbols(snapshot.assets).tw.some(row => row.code === "TWFUND"), false, "fund codes must not be sent to stock quote refresh");

const csvRows = window.FinanceImport.entriesFromCsv("日期,類型,金額,分類,項目,帳戶,幣別,刷卡地區,商家\n" + `${today},支出,80,餐飲,晚餐,生活帳戶,TWD,國內,便當店`);
const csvResult = core.importEntries(csvRows);
assert.equal(csvResult.imported, 1, "CSV row should import");
assert.equal(core.importEntries(csvRows).duplicates, 1, "same CSV row should be skipped as duplicate");

core.addRecurring({ type: "income", name: "固定收入", amount: 2000, category: "薪資", account: "生活帳戶", cycle: "monthly", day: 1 });
snapshot = core.insights();
assert.equal(snapshot.forecast.rows.length, 3);
assert.equal(snapshot.forecast.rows.every(row => Number.isFinite(row.projectedCash)), true);
assert.equal(snapshot.health.score >= 0 && snapshot.health.score <= 100, true);

const searchResults = window.FinanceSearch.search(snapshot, "午餐");
assert.equal(searchResults.some(row => row.title === "今日午餐"), true, "global search must find ledger entries");
assert.equal(window.FinanceCenterRoutes.analysis.tabs.some(([id]) => id === "forecast"), true, "forecast route must exist");

assert.equal(window.FinanceSync.enqueue({ reason: "財務中心啟動" }).outbox.length, 0);
assert.equal(window.FinanceSync.enqueue({ reason: "新增支出", updatedAt: new Date().toISOString() }).outbox.length, 1);
window.FinanceSync.markError(new Error("offline"));
assert.equal(window.FinanceSync.hasPending(), true);
window.FinanceSync.markSynced({ remoteUpdatedAt: new Date().toISOString() });
assert.equal(window.FinanceSync.hasPending(), false);

const financeCenterHtml = fs.readFileSync("finance-center.html", "utf8");
assert.equal(financeCenterHtml.includes('event.target.id==='), false, "form handlers must not use a shadowable form.id property");
assert.equal(financeCenterHtml.includes('event.target.getAttribute("id")'), true, "form handlers must read the form id attribute explicitly");
assert.equal(financeCenterHtml.includes('[hidden]{display:none!important}'), true, "hidden import inputs must never appear in the page layout");

console.log("finance center regression test OK");
