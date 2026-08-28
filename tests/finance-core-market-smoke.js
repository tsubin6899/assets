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
  console,
  Date,
  Intl,
  JSON,
  Math,
  Number,
  Object,
  String,
  Array,
  Map,
  Set
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("finance-core.js", "utf8"), context, { filename: "finance-core.js" });

const core = window.FinanceCore;
assert.equal(core.VERSION, 4);
core.addPurchase({ date: "2026-08-01", type: "buy", market: "US", code: "ABC", name: "Example", shares: 10, price: 100, currency: "USD" });
const applied = core.applyMarketSnapshot({
  prices: { generatedAt: "2026-08-29T00:00:00Z", prices: { "US:ABC": { market: "US", symbol: "ABC", price: 120, currency: "USD", source: "test" } } },
  rates: { generatedAt: "2026-08-29T00:00:00Z", source: "test rates", rates: { TWD: 1, USD: 32 } },
  valuations: {}
});
assert.equal(applied.pricesUpdated, 1);
assert.equal(applied.ratesUpdated, 1);
let snapshot = core.insights();
assert.equal(snapshot.stockPositions.active.length, 1);
assert.equal(snapshot.stockPositions.active[0].currentPrice, 120);
assert.equal(snapshot.stockPositions.active[0].value, 38400);
assert.equal(core.fxRate(snapshot.assets, "USD"), 32);
assert.equal(core.marketSymbols().us.some(row => row.code === "ABC"), true);
assert.equal(core.applyMarketSnapshot({
  prices: { generatedAt: "2026-08-29T00:00:00Z", prices: { "US:ABC": { market: "US", symbol: "ABC", price: 120, currency: "USD" } } },
  rates: { generatedAt: "2026-08-29T00:00:00Z", rates: { TWD: 1, USD: 32 } },
  valuations: {}
}).unchanged, true);

core.addPurchase({ date: "2026-08-20", type: "sell", market: "US", code: "ABC", name: "Example", shares: 10, price: 110, currency: "USD" });
snapshot = core.insights();
assert.equal(snapshot.stockPositions.active.length, 0);
assert.equal(snapshot.stockPositions.closed.length, 1);
assert.equal(snapshot.assetsSummary.allocation.us, 0);
assert.equal(snapshot.events.filter(row => row.kind.startsWith("investment_")).length, 2);

console.log("finance core market smoke test OK");
