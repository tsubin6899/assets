const fs=require('fs'),vm=require('vm'),assert=require('assert');
const store=new Map(),window={dispatchEvent(){}};
const context={window,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
  CustomEvent:class {},console,Date,Intl,JSON,Math,Number,Object,String,Array,Map,Set};
vm.createContext(context);
for(const file of ['finance-core.js','fubon-review.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
const core=window.FinanceCore,review=window.FubonReview;
core.addAccount({name:'富邦測試',type:'銀行',currency:'TWD',openingBalance:100000});
const snapshot={mode:'READ_ONLY_PREVIEW',accountRef:'a'.repeat(24),account:'***123',queriedAt:new Date().toISOString(),
  holdings:[{code:'2330',type:'Stock',quantity:100,oddQuantity:0}],fills:[{date:'2026/09/01',stock_no:'2330',buy_sell:'Buy',order_type:'Stock',
    order_no:'order1',filled_no:'1',filled_qty:100,filled_price:500,filled_time:'10:00:00'}]};
let rows=review.preview(snapshot,core.load(),'富邦測試');
assert.equal(rows[0].status,'待補費稅');
assert.equal(review.reconcile(snapshot,core.load(),'富邦測試',false)[0].status,'待確認帳號對應');
assert.equal(review.reconcile(snapshot,core.load(),'富邦測試',true)[0].status,'券商有持股，帳本未記錄');
const id=rows[0].fill.brokerFillId;
assert.throws(()=>review.importSelected(snapshot,[{id,fee:'',tax:'0'}],'富邦測試',true),/手續費/);
assert.equal(core.load().assets.purchaseRecords.length,0);
assert.throws(()=>review.importSelected(snapshot,[{id,fee:'20',tax:'0'}],'富邦測試',false),/對應/);
assert.equal(review.importSelected(snapshot,[{id,fee:'20',tax:'0'}],'富邦測試',true).imported,1);
assert.equal(review.preview(snapshot,core.load(),'富邦測試')[0].status,'已記帳');
assert.throws(()=>review.importSelected(snapshot,[{id,fee:'20',tax:'0'}],'富邦測試',true),/已記帳/);
assert.equal(core.load().assets.purchaseRecords.length,1);
assert.equal(review.reconcile(snapshot,core.load(),'富邦測試',true)[0].status,'一致');
snapshot.holdings[0].oddQuantity=10;
assert.match(review.reconcile(snapshot,core.load(),'富邦測試',true)[0].status,/口徑/);
snapshot.queriedAt='2020-01-01T00:00:00Z';
assert.match(review.reconcile(snapshot,core.load(),'富邦測試',true)[0].status,/過期/);
snapshot.fills[0].filled_no='2';snapshot.fills[0].order_no='order2';
assert.equal(review.preview(snapshot,core.load(),'富邦測試')[0].status,'疑似已有手動紀錄');
snapshot.fills[0].order_type='Margin';
assert.match(review.preview(snapshot,core.load(),'富邦測試')[0].status,/人工處理/);
console.log('Fubon review regression OK: confirmation, fee validation, duplicate guard, reconciliation, stale/odd-lot safeguards');
