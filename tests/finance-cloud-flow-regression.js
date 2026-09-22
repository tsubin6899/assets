const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'finance-center.html'),'utf8');
const source=html.slice(html.indexOf('    let cloudSyncBusy=false;'),html.indexOf('    async function loadCloud(){'));
const clone=value=>JSON.parse(JSON.stringify(value));
function setup(options={}){
  const storage=new Map(),window={dispatchEvent(){}};
  let local={ledger:{entries:[{id:'local',amount:10}]},assets:{}},imports=0,writes=0;
  const remote=options.remote||clone(local),reviews=[],filters=[];
  const context=vm.createContext({window,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},CustomEvent:class{},Date,console});
  vm.runInContext(fs.readFileSync(path.join(root,'finance-sync.js'),'utf8'),context);
  const S=window.FinanceSync;S.enqueue({reason:'initial'});
  Object.assign(context,{FinanceSync:S,FinanceCore:{VERSION:7,exportBundle:()=>clone(local),importBundle:b=>{imports++;local=clone(b);}},FinanceIntelligenceUI:{review:async(before,after,title)=>{reviews.push({before,after,title});return options.accept!==false;}},cloudUser:{id:'user'},cloudApplying:false,ui:{},showToast(){},refresh(){},updateAuthenticatedSyncUi(){},fetchCloudRow:async()=>({data:remote,updated_at:'remote-version'}),cloudDataToBundle:clone});
  const request={eq:(...args)=>{filters.push(args);return request;},select:async()=>{writes++;if(options.duringUpload){local.ledger.entries.push({id:'late',amount:20});S.enqueue({reason:'during-upload'});}return {data:options.casFailure?[]:[{updated_at:'new'}]};}};
  context.supabaseClient={from:()=>({update:()=>request,insert:()=>request})};
  vm.runInContext(source,context);
  return {context,S,reviews,filters,get local(){return local;},get imports(){return imports;},get writes(){return writes;}};
}
(async()=>{
  let t=setup({duringUpload:true});assert.equal(await t.context.saveCloud(false),true);assert.equal(t.local.ledger.entries.length,2);assert.equal(t.imports,0);assert.equal(t.S.read().outbox.length,1);assert.equal(t.S.read().outbox[0].reason,'during-upload');assert.ok(t.filters.some(([key,value])=>key==='updated_at'&&value==='remote-version'));
  t=setup({casFailure:true});assert.equal(await t.context.saveCloud(false),false);assert.equal(t.S.read().outbox.length,1);assert.equal(t.imports,0);assert.match(t.S.read().lastError,/其他裝置/);
  t=setup({accept:false});assert.equal(await t.context.saveCloud(false),false);assert.equal(t.writes,0);assert.equal(t.S.read().outbox.length,1);
  t=setup({remote:{ledger:{entries:[{id:'remote',amount:30}]},assets:{}}});assert.equal(await t.context.saveCloud(true),false);assert.equal(t.writes,0);assert.equal(await t.context.saveCloud(false),true);assert.equal(t.reviews.length,2);assert.equal(t.local.ledger.entries.length,2);assert.equal(t.S.read().outbox.length,0);
  t=setup({remote:{ledger:{entries:[{id:'local',amount:10}]},assets:{fxHistory:{'2026-01-01':{USD:30}}}}});assert.equal(await t.context.saveCloud(true),false);assert.equal(t.writes,0);
  assert.throws(()=>t.S.mergeBundles({ledger:{loanPayments:[{id:'a',loanId:'loan'}]},assets:{}},{ledger:{loanPayments:[{id:'b',loanId:'loan'}]},assets:{}}),/兩端各有新增還款/);
  console.log('cloud flow regression OK: preview, cancellation, compare-and-swap, concurrent edit, settings conflict, loan conflict');
})().catch(error=>{console.error(error);process.exitCode=1;});
