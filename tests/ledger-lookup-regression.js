const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../finance-center.html'), 'utf8');
const start = html.indexOf('    function ledgerLookupRows()');
const end = html.indexOf('\n    function ', html.indexOf('    function renderLedgerLookup(', start) + 10);
assert(start >= 0 && end > start);
const context = {
  ui: { lookup: { query: '', type: 'all', account: 'Card A', startDate: '', endDate: '', submitted: true } },
  current: { ledger: { entries: [
    { id: 'a', date: '2026-08-16', account: 'Card A', type: 'expense', merchant: 'Insurance', amount: 100 },
    { id: 'b', date: '2026-08-30', account: 'Card A', type: 'income', merchant: 'Refund', amount: 20 },
    { id: 'c', date: '2026-08-30', account: 'Card B', type: 'expense', amount: 50 },
    { id: 'd', date: '2026-08-31', account: 'Card A', type: 'expense', recurringSkipped: true, amount: 90 }
  ] } },
  esc: String, signed: String, money: String, option: () => '', accountOptions: () => '', metric: (...args) => args.join(' ')
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);
const ids = () => Array.from(context.ledgerLookupRows(), row => row.id);
assert.deepEqual(ids(), ['b', 'a']);
assert(context.renderLedgerLookup('').includes('data-edit-entry="a"'));
context.ui.lookup.startDate = '2026-08-20';
assert.deepEqual(ids(), ['b']);
context.ui.lookup = { query: '', type: 'all', account: 'all', startDate: '', endDate: '', submitted: true };
assert(context.renderLedgerLookup('').includes('data-edit-entry="c"'));
context.ui.lookup.query = 'insurance';
assert.deepEqual(ids(), ['a']);
context.ui.lookup.query = 'missing';
assert.deepEqual(ids(), []);
assert(context.renderLedgerLookup('').includes('找不到符合的消費紀錄'));
console.log('ledger lookup regression OK');
const statusStart = html.indexOf('    function creditEntryPaymentStatus(');
const statusEnd = html.indexOf('    function decorateLookupPaymentStatus(', statusStart);
vm.runInContext(html.slice(statusStart, statusEnd), context);
const ledger = { accounts: [{name: 'Card A', type: '信用卡'}], creditBills: [{id: 'bill', card: 'Card A', billMonth: '2026-08', paid: true, reconciled: true}] };
const entry = {account: 'Card A', statementChecks: {bill: {checkedAt: '2026-09-01'}}};
assert.equal(context.creditEntryPaymentStatus(entry, ledger).text, '已繳費・對帳完成');
ledger.creditBills[0].paid = false;
assert.equal(context.creditEntryPaymentStatus(entry, ledger).text, '已核對・尚未繳費');
entry.statementChecks = {};
assert.equal(context.creditEntryPaymentStatus(entry, ledger).text, '尚未確認繳費');
assert.equal(context.creditEntryPaymentStatus({account: 'Cash'}, ledger), null);
console.log('credit payment status regression OK');
