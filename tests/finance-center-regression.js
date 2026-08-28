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
["finance-core.js", "finance-sync.js", "finance-search.js", "finance-center-routes.js"].forEach(file => vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file }));

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

console.log("finance center regression test OK");
