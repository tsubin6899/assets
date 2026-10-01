const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
  const message='伺服器的 GitHub 行情更新授權已失效或權限不足，需更新伺服器設定；現有行情資料仍保留。';
  let applied=0;
  const context={location:{protocol:'https:'},document:{querySelector:()=>null},setTimeout,Date,CustomEvent:class{},window:{MARKET_DATA_UPDATE_ENDPOINT:'/api/trigger-price-update',dispatchEvent(){}},FinanceCore:{marketSymbols:()=>({tw:[],us:[]}),applyMarketSnapshot:()=>{applied++;return{}}},fetch:async(url)=>({ok:!url.startsWith('/api/'),status:url.includes('trigger-price-update')?503:404,json:async()=>url.includes('trigger-price-update')?{error:message}:{generatedAt:'fixture'}})};
  context.window.FinanceCore=context.FinanceCore;
  vm.runInNewContext(fs.readFileSync('finance-market.js','utf8'),context);
  await assert.rejects(context.window.FinanceMarket.refresh(),e=>e.message===message);
  assert.equal(context.window.FinanceMarket.state.busy,false);
  assert.equal(applied,0);
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
