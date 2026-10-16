const fs=require('fs'),vm=require('vm'),assert=require('assert');const store=new Map(),w={dispatchEvent(){}};vm.runInNewContext(fs.readFileSync('finance-core.js','utf8'),{window:w,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},CustomEvent:class{},console,Date,Intl});const c=w.FinanceCore;
c.addAccount({name:'Broker',type:'銀行帳戶',currency:'TWD',openingBalance:1455729});
const buy={date:'2026-10-15',type:'buy',code:'AMAT',market:'US',currency:'USD',shares:10,price:418.8,fee:2.51,tax:0,cashAccount:'Broker',actualSettlementAmount:135919,settlementDate:'2026-10-16',settlementStatus:'pending'};
c.addPurchase(buy);const id=c.load().assets.purchaseRecords[0].id;
const summary=()=>c.stockPositionSummary(c.load().assets),cash=()=>{const b=c.load();return c.accountBalances(b.ledger,b.assets)[0]};
assert.equal(summary().active[0].basis,4190.51);assert.equal(summary().active[0].twdBasis,135919);assert.equal(summary().trades[0].twdNetAmount,135919);assert.equal(cash().balance,1319810);assert.equal(cash().settlementBalance,1455729);assert.equal(cash().pendingBuy,135919);
c.setTradeSettlement(id,'settled');assert.equal(cash().balance,1319810);assert.equal(cash().settlementBalance,1319810);
let b=c.load();b.assets.fx={...(b.assets.fx||{}),USD:50};b.assets.fxRates={...(b.assets.fxRates||{}),USD:50};c.persist(b.ledger,b.assets);assert.equal(summary().active[0].twdBasis,135919);assert.equal(cash().balance,1319810);
c.addPurchase({...buy,date:'2026-10-16',type:'sell',shares:4,price:450,fee:1,tax:.5,actualSettlementAmount:60000,settlementStatus:'settled'});
assert.ok(Math.abs(summary().active[0].twdBasis-81551.4)<.00001);const sell=summary().trades.find(t=>t.type==='sell');assert.ok(Math.abs(sell.twdSoldBasis-54367.6)<.00001);assert.ok(Math.abs(sell.twdRealized-5632.4)<.00001);assert.equal(cash().balance,1379810);
const before=JSON.stringify(c.load().assets);assert.throws(()=>c.updatePurchase(id,{...buy,actualSettlementAmount:-1}));assert.equal(JSON.stringify(c.load().assets),before);assert.throws(()=>c.updatePurchase(id,{...buy,cashAccount:'unknown'}));assert.throws(()=>c.updatePurchase(id,{...buy,tradeExchangeRate:'NaN'}));
c.updatePurchase(id,{...buy,date:'2026-10-14',fee:3,settlementStatus:'settled'});assert.equal(summary().active[0].twdBasis,81551.4);assert.equal(c.load().assets.purchaseRecords[0].bookedFxRate,135919/4191);
// The real intelligence hook must preserve a supplied settlement rate while changing the trade date.
vm.runInNewContext(fs.readFileSync('finance-intelligence.js','utf8'),{window:w,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},CustomEvent:class{},console,Date,Intl,document:{addEventListener(){}}});
c.updatePurchase(id,{...buy,date:'2026-10-15',settlementStatus:'settled'});assert.equal(c.load().assets.purchaseRecords[0].bookedFxRate,135919/4190.51);assert.equal(cash().balance,1379810);
assert.equal(c.buildEvents(c.load().ledger,c.load().assets).find(e=>e.sourceId===id).twdAmount,135919);
console.log('Foreign settlement OK: receipt fees, fixed TWD cost, cash, partial-sale basis, realized FX gain, date edit, no double debit');
