const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.resolve(__dirname,'..'),storage=new Map();
const ctx=vm.createContext({window:{dispatchEvent(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},CustomEvent:class{},Date,console});
for(const name of ['finance-core.js','finance-sync.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),ctx);
const C=ctx.window.FinanceCore,S=ctx.window.FinanceSync;
C.addAccount({name:'Card',type:'信用卡',currency:'TWD',openingBalance:0});
const values={date:C.localDate(),type:'expense',account:'Card',amount:25200,purchaseRegion:'foreign',merchant:'Blue Lagoon'};
C.addEntry(values);let b=C.load(),parent=b.ledger.entries.find(r=>!r.isForeignTransactionFee),oldFee=b.ledger.entries.find(r=>r.isForeignTransactionFee),stale=C.exportBundle();
assert.equal(oldFee.amount,378);
C.updateEntry(parent.id,{...values,amount:25089});b=C.load();assert.equal(b.ledger.entries.filter(r=>r.isForeignTransactionFee).length,1);assert.ok(b.ledger.recycleBin.some(r=>r.row.id===oldFee.id));
let merged=S.mergeBundles(C.exportBundle(),stale);assert.equal(merged.ledger.entries.filter(r=>r.isForeignTransactionFee).length,1);
stale=C.exportBundle();C.removeEntry(parent.id);assert.equal(C.load().ledger.entries.length,0);assert.equal(S.mergeBundles(C.exportBundle(),stale).ledger.entries.length,0);
// Legacy deletion retained only the parent tombstone, leaving the fee behind.
let legacy=C.exportBundle();legacy.ledger.recycleBin=legacy.ledger.recycleBin.filter(r=>r.row.id===parent.id);assert.equal(S.mergeBundles(legacy,stale).ledger.entries.length,0);
C.addEntry({...values,amount:25089});b=C.load();b.ledger.entries.push(oldFee,{id:'manual',account:'Card',date:values.date,type:'expense',amount:378,merchant:'Manual fee'});C.persist(b.ledger,b.assets,'seed orphan');
const before=C.listBackups().length,result=C.repairOrphanForeignCardFees();assert.equal(result.removed,1);b=C.load();assert.equal(b.ledger.entries.filter(r=>r.isForeignTransactionFee).length,1);assert.ok(b.ledger.entries.some(r=>r.id==='manual'));assert.ok(b.ledger.recycleBin.some(r=>r.row.id===oldFee.id));assert.ok(C.listBackups().length>=before);assert.equal(C.repairOrphanForeignCardFees().removed,0);
console.log('foreign fee lifecycle OK: edit, cascade delete, stale sync, orphan repair, manual fee preserved');
