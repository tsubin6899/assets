const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
  const message='伺服器的 GitHub 行情更新授權已失效或權限不足，需更新伺服器設定；現有行情資料仍保留。';
  let applied=0;
  const context={location:{protocol:'https:'},document:{querySelector:()=>null},setTimeout,Date,CustomEvent:class{},window:{MARKET_DATA_UPDATE_ENDPOINT:'/api/trigger-price-update',dispatchEvent(){}},FinanceCore:{marketSymbols:()=>({tw:[],us:[]}),applyMarketSnapshot:()=>{applied++;return{}}},fetch:async(url)=>({ok:!url.startsWith('/api/'),status:url.includes('trigger-price-update')?503:404,json:async()=>url.includes('trigger-price-update')?{error:message}:{generatedAt:'fixture'}})};
  context.window.FinanceCore=context.FinanceCore;
  vm.runInNewContext(fs.readFileSync('finance-market.js','utf8'),context);
  await assert.rejects(context.window.FinanceMarket.refresh(),e=>e.message===message);
  assert.equal(context.window.FinanceMarket.state.busy,false);
  assert.equal(applied,1);
  let clock=0,reads=0;const appliedPayloads=[],phases=[];
  const fakeDate=class extends Date{static now(){return clock}};
  const slowContext={...context,Date:fakeDate,setTimeout:fn=>{clock+=4000;fn()},window:{MARKET_DATA_UPDATE_ENDPOINT:'/api/trigger-price-update',dispatchEvent:e=>phases.push(e.detail?.phase)},CustomEvent:class{constructor(type,init){this.detail=init.detail}},FinanceCore:{marketSymbols:()=>({tw:[],us:[]}),applyMarketSnapshot:p=>{appliedPayloads.push(p);return {pricesUpdated:1,ratesUpdated:0}}},fetch:async url=>{
    if(url==='/api/update-prices')return {ok:false,status:404,json:async()=>({})};
    if(url==='/api/trigger-price-update')return {ok:true,status:202,json:async()=>({mode:'github-actions'})};
    if(url.startsWith('latest-prices')){reads++;return {ok:true,json:async()=>({generatedAt:reads>30?'new-price':'old-price',prices:{'TW:0050':{price:reads>30?109:108.9}}})};}
    return {ok:true,json:async()=>({generatedAt:'rates-'+clock})};
  }};slowContext.window.FinanceCore=slowContext.FinanceCore;vm.runInNewContext(fs.readFileSync('finance-market.js','utf8'),slowContext);await slowContext.window.FinanceMarket.refresh();
  assert.equal(appliedPayloads.length,2);assert.equal(appliedPayloads[0].prices.generatedAt,'old-price');assert.equal(appliedPayloads[1].prices.generatedAt,'new-price');assert.ok(clock>90000);assert.ok(phases.indexOf('applied')<phases.indexOf('waiting'));assert.equal(slowContext.window.FinanceMarket.state.busy,false);
  clock=0;reads=0;appliedPayloads.length=0;slowContext.fetch=async url=>url==='/api/update-prices'?{ok:false,status:404,json:async()=>({})}:url==='/api/trigger-price-update'?{ok:true,json:async()=>({})}:{ok:true,json:async()=>url.startsWith('latest-prices')?{generatedAt:'old'}:{generatedAt:'rate-'+clock}};
  const pending=await slowContext.window.FinanceMarket.refresh();assert.equal(pending.pending,true);assert.equal(appliedPayloads.length,1);assert.equal(clock,240000);
  const saved={...process.env},originalFetch=global.fetch;
  try{
    Object.assign(process.env,{GITHUB_TOKEN:'fixture',GITHUB_OWNER:'fixture',GITHUB_REPO:'fixture'});
    global.fetch=async()=>({ok:false,status:401});
    const handler=(await import('../api/trigger-price-update.js')).default;
    const response={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body}};
    await handler({method:'POST',body:{tw:[],us:[]}},response);
    assert.equal(response.code,503);assert.equal(response.body.code,'MARKET_UPDATE_CREDENTIALS_INVALID');
    assert.equal(response.body.error,message);
  }finally{global.fetch=originalFetch;for(const k of ['GITHUB_TOKEN','GITHUB_OWNER','GITHUB_REPO'])if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
  console.log('market refresh regression OK: actionable credential error, preserved data, busy reset');
})().catch(e=>{console.error(e);process.exitCode=1});
