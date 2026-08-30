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
["finance-core.js", "finance-upgrades.js", "finance-sync.js", "finance-search.js", "finance-import.js", "finance-center-routes.js"].forEach(file => vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file }));

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
core.addEntry({ type: "expense", date: today, amount: 30, purchaseRegion: "domestic", category: "旅遊", item: "交通", account: "美元帳戶", merchant: "美國交通" });
snapshot = core.insights();
assert.equal(snapshot.assetsSummary.accounts.find(row => row.name === "美元帳戶").balance, 70, "USD account must stay in its native currency");
assert.equal(snapshot.ledger.entries.find(row => row.merchant === "美國交通").transactionCurrency, "USD", "quick entry currency must follow the selected account");
assert.equal(snapshot.ledger.items.expense["旅遊"].includes("交通"), true, "category should remember its item options");
core.saveExpenseCategory({ name: "測試分類" });
core.saveExpenseItem({ category: "測試分類", name: "測試項目" });
core.addEntry({ type: "expense", date: today, amount: 1, category: "測試分類", item: "測試項目", account: "生活帳戶", merchant: "分類編輯測試" });
core.saveExpenseCategory({ originalName: "測試分類", name: "更新分類" });
assert.equal(core.insights().ledger.entries.find(row => row.merchant === "分類編輯測試").category, "更新分類", "renaming an expense category must update linked entries");
core.saveExpenseItem({ originalCategory: "更新分類", originalName: "測試項目", category: "更新分類", name: "更新項目" });
assert.equal(core.insights().ledger.entries.find(row => row.merchant === "分類編輯測試").item, "更新項目", "renaming an expense item must update linked entries");
core.removeExpenseItem("更新分類", "更新項目");
assert.equal(core.insights().ledger.entries.find(row => row.merchant === "分類編輯測試").item, "", "deleting an expense item must preserve the entry and clear only its item field");
core.removeExpenseCategory("更新分類");
assert.equal(core.insights().ledger.entries.find(row => row.merchant === "分類編輯測試").category, "未分類", "deleting an expense category must preserve the entry under 未分類");
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
assert.equal(window.FinanceCenterRoutes.daily.tabs.some(([id]) => id === "taxonomy"), true, "expense taxonomy management route must exist");
assert.equal(window.FinanceCenterRoutes.accounts.tabs.some(([id]) => id === "reconcile"), true, "account reconciliation route must exist");
assert.equal(window.FinanceCenterRoutes.accounts.tabs.some(([id]) => id === "statements"), true, "credit card statement check route must be separate");
assert.equal(window.FinanceCenterRoutes.accounts.tabs.some(([id]) => id === "loans"), true, "loan manager route must exist");
assert.equal(window.FinanceCenterRoutes.analysis.tabs.some(([id]) => id === "audit"), true, "data audit route must exist");
assert.equal(window.FinanceCenterRoutes.analysis.tabs.some(([id]) => id === "planning"), true, "financial planning route must exist");

const upgrades = window.FinanceUpgrades;
const livingAccount = core.insights().ledger.accounts.find(row => row.name === "生活帳戶");
upgrades.setAccountArchived(livingAccount.id, true);
assert.equal(core.insights().ledger.accounts.find(row => row.id === livingAccount.id).archived, true, "archiving an account must preserve it for history");
upgrades.setAccountArchived(livingAccount.id, false);
upgrades.saveLoan({ name:"測試房貸", lender:"測試銀行", principal:1000000, balance:800000, annualRate:2, monthlyPayment:10000, nextDueDate:futureDate, account:"生活帳戶" });
assert.equal(core.insights().assetsSummary.loanDebt, 800000, "loan balance must be included in liabilities");
assert.equal(core.insights().assetsSummary.liabilities >= 800000, true, "total liabilities must include loan debt");
upgrades.saveGoal({ name:"緊急預備金", targetAmount:120000, currentAmount:30000, targetDate:futureDate, linkedAccount:"生活帳戶" });
upgrades.saveAnnualPlan({ year:String(new Date().getFullYear()), expectedIncome:900000, spendingLimit:600000, emergencyFundTarget:180000, investmentTarget:200000, benchmarkRate:6 });
assert.equal(core.insights().ledger.goals.length, 1, "saving goal must persist it");
assert.equal(upgrades.benchmark(String(new Date().getFullYear())).targetRate, 6, "benchmark must use the annual plan target");
const lunch = core.insights().ledger.entries.find(row => row.merchant === "今日午餐");
assert.equal(upgrades.bulkUpdateEntries({ ids:[lunch.id], category:"外食" }), 1, "bulk editing must update selected entries");
assert.equal(core.insights().ledger.entries.find(row => row.id === lunch.id).category, "外食", "bulk category must be persisted");
assert.equal(Array.isArray(upgrades.audit(core.insights()).issues), true, "data audit must return a list of issues");
assert.equal(upgrades.taxSummary(String(new Date().getFullYear())).year, String(new Date().getFullYear()), "tax summary must support a selected year");

assert.equal(window.FinanceSync.enqueue({ reason: "財務中心啟動" }).outbox.length, 0);
assert.equal(window.FinanceSync.enqueue({ reason: "新增支出", updatedAt: new Date().toISOString() }).outbox.length, 1);
window.FinanceSync.markError(new Error("offline"));
assert.equal(window.FinanceSync.hasPending(), true);
window.FinanceSync.markSynced({ remoteUpdatedAt: new Date().toISOString() });
assert.equal(window.FinanceSync.hasPending(), false);
const localBundle = core.exportBundle();
const remoteBundle = JSON.parse(JSON.stringify(localBundle));
remoteBundle.ledger.entries.push({ id:"remote-only", date:today, type:"income", amount:100, category:"其他收入", account:"生活帳戶", createdAt:new Date().toISOString() });
const comparison = window.FinanceSync.compareBundles(localBundle, remoteBundle);
assert.equal(comparison.remoteOnly >= 1, true, "sync comparison must detect remote-only records");
assert.equal(window.FinanceSync.mergeBundles(localBundle, remoteBundle).ledger.entries.some(row => row.id === "remote-only"), true, "incremental merge must retain remote-only records");

const preview = window.FinanceImport.previewCsv("日期,類型,金額,交易說明\n" + `${today},支出,120,捷運加值`, core.insights().ledger);
assert.equal(preview.rows[0].category, "交通", "smart CSV import must suggest a category from merchant keywords");
assert.equal(preview.rows[0].account, "生活帳戶", "smart CSV import must map an active default account");

const financeCenterHtml = fs.readFileSync("finance-center.html", "utf8");
assert.equal(financeCenterHtml.includes('event.target.id==='), false, "form handlers must not use a shadowable form.id property");
assert.equal(financeCenterHtml.includes('event.target.getAttribute("id")'), true, "form handlers must read the form id attribute explicitly");
assert.equal(financeCenterHtml.includes('[hidden]{display:none!important}'), true, "hidden import inputs must never appear in the page layout");
assert.equal(financeCenterHtml.includes('<label>幣別<select name="currency">${option("TWD","台幣 TWD"'), true, "manual holding currency must use a TWD and USD select menu");
assert.equal(financeCenterHtml.includes('data-card-region ${creditAccount?"":"hidden"}'), true, "card region must be hidden unless the selected account is a credit card");
const quickFormSource = financeCenterHtml.slice(financeCenterHtml.indexOf("function quickEntryForm"), financeCenterHtml.indexOf("function uniqueCategories"));
assert.equal(quickFormSource.includes('name="currency"'), false, "quick entry must not expose a manual transaction currency selector");
assert.equal(quickFormSource.includes("data-account-currency-note"), true, "quick entry must explain that currency follows the selected account");
assert.equal(financeCenterHtml.includes('event.target.name==="account"){syncQuickEntryAccount(form)'), true, "card region and currency note must update when the account changes");
assert.equal(financeCenterHtml.includes('state.tab==="reconcile"||state.tab==="statements"'), true, "account inventory and credit card checks must render as separate tabs");
assert.equal(financeCenterHtml.includes('id="expenseCategoryForm"'), true, "expense category editor must exist");
assert.equal(financeCenterHtml.includes('id="expenseItemForm"'), true, "expense item editor must exist");
assert.equal(financeCenterHtml.includes('const accountTypeOrder=accountGroupDefinitions.map(row=>row.type)'), true, "account overview and selectors must share one stable type order");
assert.equal(financeCenterHtml.includes('class="account-group ${groupVisual.cls}"'), true, "accounts of the same type must render inside a shared group");
assert.equal(financeCenterHtml.includes('localeCompare(String(b.name||""),"zh-TW")'), true, "accounts within each type must be sorted by name");
assert.equal(financeCenterHtml.includes('id="loanForm"'), true, "loan management form must exist");
assert.equal(financeCenterHtml.includes('id="goalForm"'), true, "goal management form must exist");
assert.equal(financeCenterHtml.includes('id="bulkEntryForm"'), true, "entry batch editing form must exist");
assert.equal(financeCenterHtml.includes('FinanceStorage.init()'), true, "IndexedDB mirror must initialize with the app");
assert.equal(financeCenterHtml.includes("<optgroup label="), true, "account selectors must group accounts by type");
assert.equal(financeCenterHtml.includes("decorateAccountSelects(app)"), true, "account selectors must receive their visual type treatment after render");
assert.equal(financeCenterHtml.includes("select.account-select{display:block;width:100%;min-width:0;max-width:100%;height:36px"), true, "mobile account selectors must stay on one compact row");
assert.equal(financeCenterHtml.includes("font-size:75%"), true, "mobile account selector text must be reduced by 25 percent");
assert.equal(fs.readFileSync("service-worker.js", "utf8").includes("tsubin-finance-center-v110"), true, "service worker cache must be bumped for compact mobile account selectors");

console.log("finance center regression test OK");
