const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.resolve(__dirname,'..'),store=new Map();
let dialog;
const document={addEventListener(){},body:{append(){}},createElement(){const handlers={};dialog={style:{},innerHTML:'',addEventListener:(name,fn)=>handlers[name]=fn,showModal(){},close(){},remove(){},choose(value){handlers.click({target:{closest:()=>({dataset:{decision:value}})}});}};return dialog;}};
const context=vm.createContext({document,window:{dispatchEvent(){}},localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,String(value))},Date,console,CustomEvent:class{}});
for(const name of ['finance-core.js','finance-intelligence.js','finance-sync.js','finance-intelligence-ui.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name});
const C=context.window.FinanceCore,UI=context.window.FinanceIntelligenceUI;
UI.init({refresh(){},toast(){}});
(async()=>{
  C.addAccount({name:'Existing',type:'銀行帳戶',currency:'TWD',openingBalance:100});
  let target=C.exportBundle();target.ledger.accounts[0].openingBalance=200;
  let pending=UI.restore(target,'Preview');assert.equal(C.load().ledger.accounts[0].openingBalance,100);assert.ok(dialog.innerHTML.includes('openingBalance'));dialog.choose('cancel');assert.equal(await pending,false);assert.equal(C.load().ledger.accounts[0].openingBalance,100);
  pending=UI.restore(target,'Apply');dialog.choose('apply');assert.equal(await pending,true);assert.equal(C.load().ledger.accounts[0].openingBalance,200);assert.ok(C.listBackups().length>0);
  target=C.exportBundle();target.ledger.accounts[0].openingBalance=300;
  pending=UI.restore(target,'Concurrent edit');C.addAccount({name:'New while reviewing',type:'銀行帳戶',currency:'TWD',openingBalance:50});dialog.choose('apply');await assert.rejects(pending,/預覽期間本機資料已變更/);assert.equal(C.load().ledger.accounts.length,2);assert.equal(C.load().ledger.accounts[0].openingBalance,200);
  console.log('restore flow regression OK: no write before approval, cancel, backup, apply, concurrent edit protection');
})().catch(error=>{console.error(error);process.exitCode=1;});
