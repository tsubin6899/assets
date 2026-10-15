(function(){
  'use strict';
  const core=window.FinanceCore,I=window.FinanceIntelligence,ops=window.InvestmentOperations;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v==null||!Number.isFinite(Number(v))?'資料不足':Number(v).toLocaleString('zh-TW',{maximumFractionDigits:2});
  const stamp=()=>new Date().toISOString();
  const rerender=()=>window.dispatchEvent(new Event("portfolio-lab-ready"));
  const paper=r=>/^(AI-)?PAPER-/.test(r.brokerFillId||'')||r.externalSource==='auto-trading-center';
  const real=b=>({...b,assets:{...b.assets,purchaseRecords:(b.assets.purchaseRecords||[]).filter(r=>!paper(r))}});
  const table=(headers,rows)=>`<div style="overflow:auto"><table><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  let source={securities:{}},funds=[],service=null,sourceMessage='來源資料尚未載入',repair=null,dayAttempt='',personalQuoteMessage='';
  function positions(b){const s=core.stockPositionSummary(real(b).assets);return [...s.active,...s.manualOnly];}
  function tradeRows(b){return (b.assets.purchaseRecords||[]).map((r,index)=>({...r,_repairKey:r.id||`legacy:${index}`})).filter(r=>!paper(r));}
  function quality(b){
    const records=tradeRows(b),issues=[],seen=new Map();
    for(const r of records){const flags=[];
      if(!I.validDate(r.date)||!['buy','sell'].includes(r.type)||!Number.isFinite(Number(r.price))||!Number.isFinite(Number(r.shares))||!(Number(r.price)>0)||!(Number(r.shares)>0))flags.push('日期、買賣、股數或價格待核對');
      if(r.fee==null||r.tax==null||!Number.isFinite(Number(r.fee))||Number(r.fee)<0||!Number.isFinite(Number(r.tax))||Number(r.tax)<0)flags.push('缺少有效費稅');
      if(!r.cashAccount||!b.ledger.accounts.some(a=>a.name===r.cashAccount&&!a.archived))flags.push('現金帳戶未對應');
      const key=[r.date,r.code,r.market,r.type,r.shares,r.price,r.cashAccount].join('|');
      if(seen.has(key)){flags.push('疑似重複交易，須查核成交編號');issues.push({id:seen.get(key),code:r.code,kind:'trade',detail:'有另一筆相同日期／股數／價格紀錄，請人工核對'});}else seen.set(key,r._repairKey);
      if(flags.length)issues.push({id:r._repairKey,code:r.code,kind:'trade',detail:flags.join('；')});
    }
    const p=core.stockPositionSummary(real(b).assets);
    p.discrepancies.forEach(r=>issues.push({code:r.code,kind:'holding',detail:r.oversold?'賣出超過已記錄買進，請補齊原始買進':'手動持股與交易股數不同'}));
    p.manualOnly.filter(r=>!(Number(r.cost??r.totalCost)>0)).forEach(r=>issues.push({code:r.code,kind:'holding',detail:'手動持股缺少成本'}));
    const archived=new Set((b.assets.reviewAcknowledgements||[]).map(r=>r.signature));
    return issues.filter(row=>!archived.has(reviewSignature(b,row)));
  }
  function reviewSignature(b,row){const trade=tradeRows(b).find(r=>r._repairKey===row.id);return JSON.stringify([row.id,row.code,row.kind,row.detail,trade?[trade.date,trade.type,trade.shares,trade.price,trade.fee,trade.tax,trade.cashAccount]:positions(b).filter(r=>r.code===row.code).map(r=>[r.shares,r.cost])]);}
  function cleanConfirmedHoldings(){
    const b=core.load(),removed=[];
    for(const [code,date] of [['00919','2023-12-20'],['2603','2024-06-21']]){
      const rows=b.assets.purchaseRecords.filter(r=>r.code===code&&r.date===date&&r.type==='buy'&&!paper(r));
      if(rows.length!==2)continue;
      const signature=r=>JSON.stringify([r.market,r.currency||'TWD',Number(r.shares),Number(r.price),Number(r.fee),Number(r.tax),r.cashAccount||'']);
      if(signature(rows[0])!==signature(rows[1]))throw new Error(code+' 兩筆交易內容不同，未自動刪除');
      const row=[...rows].reverse().find(r=>r.id);if(!row)throw new Error(code+' 缺少交易識別碼，無法安全移除');
      removed.push(row);b.assets.purchaseRecords=b.assets.purchaseRecords.filter(r=>r!==row);
    }
    const current=positions(b);
    if(current.length!==1||current[0].code!=='0050'||current[0].shares!==10000)throw new Error('清理後股數未符合 0050 10,000 股，尚未儲存，請進一步核對');
    b.ledger.recycleBin||=[];
    for(const row of removed)b.ledger.recycleBin.unshift({id:'confirmed-duplicate-'+row.id,kind:'purchase',row,removedAt:stamp()});
    const issues=quality(b),at=stamp();
    b.assets.reviewAcknowledgements=[...(b.assets.reviewAcknowledgements||[]),...issues.map(row=>({id:'review-'+Math.random().toString(36).slice(2),signature:reviewSignature(b,row),reason:'使用者確認歷史資料不再待辦',updatedAt:at}))];
    core.persist(b.ledger,b.assets,'使用者確認僅保留0050一萬股並封存目前歷史待辦');rerender();return {removed:removed.length,archived:issues.length};
  }
  function prepareRepair(id,values){
    const b=core.load(),legacy=/^legacy:(\d+)$/.exec(id),before=legacy?b.assets.purchaseRecords[Number(legacy[1])]:b.assets.purchaseRecords.find(r=>r.id===id);
    if(!before||paper(before))throw new Error('找不到可核對的真實交易');
    const after={...before,...values};if(legacy)after.id='repaired-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    if(!I.validDate(after.date)||!['buy','sell'].includes(after.type)||!Number.isFinite(Number(after.shares))||Number(after.shares)<=0||!Number.isFinite(Number(after.price))||Number(after.price)<=0||!Number.isFinite(Number(after.fee))||Number(after.fee)<0||!Number.isFinite(Number(after.tax))||Number(after.tax)<0||after.fee===''||after.tax==='')throw new Error('請填有效日期、股數、價格及已核對費稅');
    if(!b.ledger.accounts.some(r=>r.name===after.cashAccount&&!r.archived&&r.type!=='信用卡'))throw new Error('請選擇有效的現金帳戶');
    if(core.isMonthClosed(after.date.slice(0,7))||core.isMonthClosed(String(before.date).slice(0,7)))throw new Error('交易月份已關帳，請先核對並重新開帳');
    const cash=r=>r.type==='sell'?Number(r.shares)*Number(r.price)-Number(r.fee||0)-Number(r.tax||0):-Number(r.shares)*Number(r.price)-Number(r.fee||0)-Number(r.tax||0);
    return {id,before:JSON.parse(JSON.stringify(before)),after,fingerprint:JSON.stringify([b.ledger,b.assets]),cashBefore:cash(before),cashAfter:cash(after)};
  }
  function assignReviewAccount(account='台北富邦證券分帳戶'){
    const b=core.load();
    if(!b.ledger.accounts.some(r=>r.name===account&&!r.archived&&r.type!=='信用卡'))throw new Error('找不到可用的「'+account+'」，請先確認帳戶名稱');
    const ids=new Set(quality(b).filter(r=>r.kind==='trade').map(r=>r.id));
    const rows=b.assets.purchaseRecords.filter((r,index)=>!paper(r)&&ids.has(r.id||`legacy:${index}`)&&r.cashAccount!==account);
    if(rows.some(r=>core.isMonthClosed(String(r.date).slice(0,7))))throw new Error('待核對交易包含已關帳月份，請先重新開帳後再批次設定');
    if(!rows.length)return 0;
    core.createBackup('批次指定證券分帳戶前');
    for(const row of rows){row.cashAccount=account;row.updatedAt=stamp();}
    core.persist(b.ledger,b.assets,'待核對交易批次指定'+account);rerender();return rows.length;
  }
  function applyRepair(preview){
    if(!preview||JSON.stringify([core.load().ledger,core.load().assets])!==preview.fingerprint)throw new Error('預覽後帳本已變更，請重新預覽');
    core.createBackup('核對工作台修正前');const legacy=/^legacy:(\d+)$/.exec(preview.id);if(legacy){const b=core.load();b.assets.purchaseRecords[Number(legacy[1])]={...preview.after,shares:Number(preview.after.shares),price:Number(preview.after.price),fee:Number(preview.after.fee),tax:Number(preview.after.tax),updatedAt:stamp()};const result=core.persist(b.ledger,b.assets,'修正舊格式投資交易');rerender();return result;}const result=core.updatePurchase(preview.id,preview.after);rerender();return result;
  }
  function captureDaily(replace=false){
    const b=core.load(),today=core.localDate(),existing=(b.assets.investmentDailySnapshots||[]).find(r=>r.date===today);
    if(existing&&!replace)return existing;
    const clean=real(b),snapshot=I.capture(clean.ledger,clean.assets);
    const row={...snapshot,id:'investment-daily-'+today,updatedAt:stamp(),positions:positions(b).map(r=>({code:r.code,market:r.market,currency:r.currency,shares:r.shares,price:r.currentPrice,value:r.value,source:clean.assets.marketPrices?.[r.key]?.source||'帳本／手動參考價',quoteTime:clean.assets.marketPrices?.[r.key]?.quoteTime||clean.assets.marketPrices?.[r.key]?.date||null})),issues:quality(b).length};
    b.assets.investmentDailySnapshots=[...(b.assets.investmentDailySnapshots||[]).filter(r=>r.date!==today),row].sort((a,b)=>a.date.localeCompare(b.date));
    core.persist(b.ledger,b.assets,'保存每日投資估值');rerender();return row;
  }
  function history(b){
    const snapshots=[...(b.assets.investmentDailySnapshots||[])].sort((a,b)=>a.date.localeCompare(b.date));
    const records=real(b).assets.purchaseRecords||[],dividends=b.assets.dividends||[];
    return snapshots.map((end,index)=>{const start=snapshots[index-1];if(!start)return {...end,change:null,contribution:null,dividend:null,gain:null,priceGain:null,fxGain:null,reason:'尚無前次估值'};
      let contribution=0,dividend=0,complete=true;const native=new Map();
      for(const r of records.filter(r=>r.date>start.date&&r.date<=end.date)){
        const rate=I.historicalRate(b.assets,r,r.currency||(['US','USD_FUND'].includes(r.market)?'USD':'TWD')),gross=Number(r.shares)*Number(r.price),fees=Number(r.fee)+Number(r.tax),amount=r.type==='sell'?-(gross-fees):gross+fees;
        if(rate==null||!Number.isFinite(amount)||!['buy','sell'].includes(r.type)){complete=false;continue;}
        contribution+=amount*rate;const currency=r.currency||(['US','USD_FUND'].includes(r.market)?'USD':'TWD');native.set(currency,(native.get(currency)||0)+amount);
      }
      for(const r of dividends.filter(r=>r.date>start.date&&r.date<=end.date)){const rate=I.historicalRate(b.assets,r,r.currency||'TWD');if(rate==null)complete=false;else dividend+=Number(r.amount)*rate;}
      let priceGain=0,fxGain=0,attributable=complete&&Array.isArray(start.investmentCurrencies)&&Array.isArray(end.investmentCurrencies);
      const currencies=new Set([...(start.investmentCurrencies||[]),...(end.investmentCurrencies||[])].map(r=>r.currency));native.forEach((v,k)=>currencies.add(k));
      currencies.forEach(currency=>{const a=(start.investmentCurrencies||[]).find(r=>r.currency===currency),z=(end.investmentCurrencies||[]).find(r=>r.currency===currency),rate=a?.rate||(currency==='TWD'?1:start.fxRates?.[currency]);if(!(rate>0)){attributable=false;return;}const flow=native.get(currency)||0;priceGain+=((z?.nativeValue||0)-(a?.nativeValue||0)-flow)*rate;});
      if(attributable)fxGain=end.investment-start.investment-contribution-priceGain;
      let quantityMismatch=false;
      if(Array.isArray(start.positions)&&Array.isArray(end.positions)){const expected=new Map(start.positions.map(r=>[r.market+':'+r.code,Number(r.shares)||0]));for(const r of records.filter(r=>r.date>start.date&&r.date<=end.date)){const key=(r.market||'TW')+':'+r.code;expected.set(key,(expected.get(key)||0)+(r.type==='sell'?-1:1)*Number(r.shares));}const actual=new Map(end.positions.map(r=>[r.market+':'+r.code,Number(r.shares)||0]));for(const key of new Set([...expected.keys(),...actual.keys()]))if(Math.abs((expected.get(key)||0)-(actual.get(key)||0))>0.000001)quantityMismatch=true;}
      const bad=quality(b).length>0||start.issues>0||end.issues>0||quantityMismatch;if(bad){complete=false;attributable=false;}
      return {...end,startDate:start.date,change:end.investment-start.investment,contribution:complete?contribution:null,dividend:complete?dividend:null,gain:complete?end.investment-start.investment-contribution+dividend:null,priceGain:attributable?priceGain:null,fxGain:attributable?fxGain:null,reason:quantityMismatch?'持股數量改變缺少對應交易／公司行動紀錄，保留未解釋差額':bad?'帳本／估值有待核對資料':complete?'依實際保存估值；非完整日線，含費稅':'缺少歷史匯率或有效交易資料'};
    });
  }
  function saveJournal(values){
    if(!I.validDate(values.date)||values.date>core.localDate()||!String(values.code||'').trim()||!String(values.thesis||'').trim())throw new Error('請填已發生日期、標的及決策理由');
    const b=core.load(),trade=values.tradeId?b.assets.purchaseRecords.find(r=>String(r.id)===String(values.tradeId)&&!paper(r)):null;
    if(values.tradeId&&!trade)throw new Error('所選交易已不存在，請重新選擇關聯交易');
    const input=String(values.code).trim().toUpperCase(),code=String(trade?.code||input).trim().toUpperCase();
    if(trade&&input!==code){
      const names=[trade.name,...['tw','us','funds','usdFunds'].flatMap(key=>(b.assets[key]||[]).filter(r=>String(r.code).trim().toUpperCase()===code).map(r=>r.name))].filter(Boolean).map(v=>String(v).trim().toUpperCase());
      if(!names.includes(input))throw new Error(`標的與所選交易不一致，請填入 ${code} 或重新選擇交易`);
    }
    const row={id:'journal-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),date:values.date,code,thesis:values.thesis.trim(),exitCondition:String(values.exitCondition||''),signalDate:values.signalDate||'',tradeId:values.tradeId||'',review:String(values.review||''),createdAt:stamp(),updatedAt:stamp()};
    if(row.signalDate&&!I.validDate(row.signalDate))throw new Error('訊號日期不正確');
    const prior=values.id?(b.assets.investmentJournal||[]).find(r=>r.id===values.id):null;
    if(values.id&&!prior)throw new Error('日誌已不存在，請重新整理');
    if(prior){const {editHistory,...original}=prior;Object.assign(row,{id:prior.id,createdAt:prior.createdAt,review:values.review??prior.review,reviewedAt:prior.reviewedAt,editHistory:[...(editHistory||[]),original]});}
    b.assets.investmentJournal=prior?b.assets.investmentJournal.map(r=>r.id===prior.id?row:r):[...(b.assets.investmentJournal||[]),row];core.persist(b.ledger,b.assets,prior?'編輯投資決策與檢討':'保存投資決策理由');rerender();return row;
  }
  function reviewJournal(id,review){const b=core.load(),row=(b.assets.investmentJournal||[]).find(r=>r.id===id);if(!row)throw new Error('日誌不存在');row.review=String(review);row.reviewedAt=stamp();row.updatedAt=stamp();core.persist(b.ledger,b.assets,'補記決策檢討');rerender();}
  function exposure(rows,metadata,etfs,today=core.localDate()){
    const total=rows.reduce((n,r)=>n+Math.max(0,Number(r.value)||0),0),stocks=new Map(),industries=new Map(),details=[],fundRows=[],unknown={value:0};
    function add(code,market,value,name){const key=market+':'+code,meta=market==='TW'?metadata.securities?.[code]:null;const s=stocks.get(key)||{key,code,market,name:name||meta?.name||code,value:0};s.value+=value;stocks.set(key,s);const sector=meta?.industry&&meta.industry!=='未分類'?meta.industry:'未分類／缺資料';industries.set(sector,(industries.get(sector)||0)+value);}
    for(const r of rows){const value=Math.max(0,Number(r.value)||0),meta=r.market==='TW'?metadata.securities?.[r.code]:null,etf=etfs.find(f=>f.code===r.code);
      if(etf||meta?.type==='ETF'){
        if(!etf||!I.validDate(etf.asOf)||etf.asOf>today){unknown.value+=value;details.push({code:r.code,detail:'ETF 成分缺漏或日期無效',coverage:0});continue;}
        let covered=0;const weights=new Map();for(const h of etf.holdings){const weight=Number(h.weight);if(!(weight>0)||!Number.isFinite(weight))continue;covered+=weight;weights.set((h.market||'TW')+':'+h.code,weight);add(h.code,h.market||'TW',value*weight/100,h.name);}
        unknown.value+=value*Math.max(0,1-covered/100);fundRows.push({code:r.code,weights,asOf:etf.asOf});details.push({code:r.code,detail:`${etf.asOf}｜${etf.source}｜${etf.partial?'部分成分':'公告股票成分'}${I.day(etf.asOf,7)<today?'（超過 7 日，需更新）':''}`,coverage:covered});
      }else add(r.code,r.market,value,r.name);
    }
    const overlap=[];for(let i=0;i<fundRows.length;i++)for(let j=i+1;j<fundRows.length;j++){const a=fundRows[i],b=fundRows[j];let pct=0;a.weights.forEach((w,k)=>pct+=Math.min(w,b.weights.get(k)||0));overlap.push({a:a.code,b:b.code,percent:pct,dates:a.asOf+'／'+b.asOf});}
    return {total,unknown:unknown.value,stocks:[...stocks.values()].sort((a,b)=>b.value-a.value),industries:[...industries].sort((a,b)=>b[1]-a[1]),details,overlap};
  }
  function validateFund(value){
    if(!value||value.example||!/^\d{4,6}[A-Z]?$/.test(value.code)||!I.validDate(value.asOf)||value.asOf>core.localDate()||!/^https:\/\//.test(value.sourceUrl||'')||!value.source||!Array.isArray(value.holdings)||value.holdings.length>2000)throw new Error('ETF 需有效代號、公告日期、HTTPS 來源網址及成分清單');
    const seen=new Set();let total=0;for(const h of value.holdings){const key=(h.market||'TW')+':'+h.code;if(!/^[A-Z0-9.-]{1,15}$/.test(h.code||'')||!['TW','US'].includes(h.market||'TW')||seen.has(key)||!(Number(h.weight)>0)||!Number.isFinite(Number(h.weight)))throw new Error('成分代號／市場／權重不正確或重複');seen.add(key);total+=Number(h.weight);}
    if(!(total>0)||total>100.1)throw new Error('成分權重總和必須大於 0 且不超過 100%');return {...value,coveragePercent:total};
  }
  function importFund(value){const row=validateFund(value),b=core.load();row.id='etf-reference-'+row.code;row.updatedAt=stamp();b.assets.etfReferences=[...(b.assets.etfReferences||[]).filter(r=>r.code!==row.code),row];core.persist(b.ledger,b.assets,'保存已核對 ETF 成分來源');rerender();}
  async function request(url,body){const r=await fetch(url,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),d=await r.json().catch(()=>({error:r.status===404?'正式網站尚未提供此服務，既有資料保持不變':'服務未回傳有效資料，請稍後再試'}));if(!r.ok)throw new Error(d.error||'本機服务未回應');return d;}
  async function personalQuotes(){
    if(location.hostname.endsWith('.vercel.app')){
      const result=await window.FinanceMarket.refresh();
      return {applied:result.pricesUpdated||0,missing:[],pending:Boolean(result.pending),provider:'cloud'};
    }
    const b=core.load(),p=positions(b),watch=(b.assets.twWatchlist||[]).map(r=>typeof r==='string'?r:r.code);let snapshot={};try{snapshot=await fetch('../auto_trading/data/fubon-preview.json',{cache:'no-store'}).then(r=>r.ok?r.json():{});}catch{}
    const codes=[...new Set([...p.filter(r=>r.market==='TW').map(r=>String(r.code||'').toUpperCase()),...watch,...(snapshot.holdings||[]).map(r=>r.code)].filter(c=>/^[A-Z0-9]{4,8}$/.test(c)))].slice(0,100);
    const d=await request('/api/investment-quotes',{codes}),current=core.load();let applied=0;
    for(const [code,q] of Object.entries(d.quotes||{})){if(!q||!(q.price>0)||!Number.isFinite(Date.parse(q.quoteTime))||Date.parse(q.quoteTime)>Date.now()+5000)continue;
      const old=current.assets.marketPrices?.['TW:'+code];if(old?.quoteTime&&Date.parse(old.quoteTime)>Date.parse(q.quoteTime))continue;
      current.assets.marketPrices||={};current.assets.marketPrices['TW:'+code]={...q,currency:'TWD'};applied++;}
    if(applied)core.persist(current.ledger,current.assets,'更新持股專屬富邦行情');
    return {...d,applied};
  }
  function summary(b){const p=ops.performance(b,String(new Date().getFullYear())),historyRows=history(b),last=historyRows.at(-1),plans=ops.calendar(b).filter(r=>r.source==='手動確認日程'&&!r.completed&&r.date<=I.day(core.localDate(),7));
    const quoteRows=positions(b).map(r=>{const q=b.assets.marketPrices?.[r.key],age=Date.now()-Date.parse(q?.quoteTime||q?.date);return [esc(r.market+':'+r.code),money(r.currentPrice),esc(q?.source||'帳本／手動參考價'),esc(q?.quoteTime||q?.date||'缺少行情時間'),q?.priceKind==='TRADE'&&Number.isFinite(age)&&age>=-5000&&age<=180000?'180 秒內成交快照':'參考價／時間缺漏或過期'];});
    return `<h3>每日投資摘要</h3><p>日期 ${esc(core.localDate())}｜真實帳本持股 ${positions(b).length} 個｜待核對 ${quality(b).length} 項｜七日內／逾期日程 ${plans.length} 項</p><p>已核對年度已實現損益 ${money(p.realized)} TWD｜帳本未實現損益 ${money(p.unrealized)} TWD｜本年股息 ${money(p.p.dividendIncome)} TWD</p><p>最近投資估值變動 ${money(last?.change)} TWD｜期間投入／取回淨額 ${money(last?.contribution)} TWD｜期間含息損益 ${money(last?.gain)} TWD</p><p>數字依真實帳本與已保存估值；缺成本或漏帳保留資料不足。${esc(last?.reason||'開啟頁面後才開始每日紀錄，未重建歷史。')}</p><a href="#investments/review">處理待核對</a> · <a href="#investments/history">查看歷史</a> · <a href="#investments/journal">記錄決策</a> · <a href="#investments/health">服務與備份</a><p><button data-personal-quotes class="action-btn">更新持股／觀察清單行情</button> <span id="personalQuoteResult">${esc(personalQuoteMessage)}</span></p><details><summary>持股行情來源與時效</summary>${table(["標的","帳本估值價格","來源","資料時間","口徑"],quoteRows)}</details>`;
  }
  function decorate(app,state){
    const tabs=['review','journal','history','exposure','health'],isSummary=(state.domain==='home'&&state.tab==='overview')||(state.domain==='investments'&&state.tab==='portfolio');
    if(!isSummary&&!(state.domain==='investments'&&tabs.includes(state.tab)))return;
    const section=document.createElement('section');section.id='portfolioLab';section.className='panel';section.style.marginTop='16px';app.append(section);
    const b=core.load();let html=isSummary?summary(b):'';
    if(state.tab==='review'){
      const issues=quality(b),records=tradeRows(b);html+=`<h3>資料核對工作台</h3><button type="button" class="action-btn" data-clean-confirmed-holdings>依已確認持股整理：只保留0050一萬股並封存歷史待辦</button><p data-clean-result role="status"></p><button type="button" class="action-btn" data-batch-review-account>待核對交易全部設為台北富邦證券分帳戶</button><p>只更新待核對交易的現金帳戶；日期、股數、價格及費稅維持原值，其他問題仍需核對。</p><p>修正前顯示原始紀錄與現金影響，確認後留下還原點。券商股數差異請在持股對帳確認帳戶；疑似重複不自動刪除。</p>${table(['標的','待辦','處理'],issues.map(r=>[esc(r.code),esc(r.detail),r.kind==='trade'&&r.id?`<button data-repair-trade="${esc(r.id)}">預覽修正</button>`:'<a href="#investments/holdings">核對持有部位</a>']))}<details open><summary>選擇要核對的交易</summary><select id="repairTradeSelect"><option value="">請選擇</option>${records.map(r=>`<option value="${esc(r._repairKey)}">${esc(r.date)} ${esc(r.code)} ${r.type==='sell'?'賣出':'買入'} ${esc(r.shares)} 股</option>`).join('')}</select></details><div id="repairEditor"></div><a href="#analysis/data">修正後如需還原，前往資料管理的還原點</a>`;
    }
    if(state.tab==='history'){
      const rows=history(b).slice().sort((a,b)=>b.date.localeCompare(a.date));html+=`<h3>每日資產歷史與變化解釋</h3><p>每日首次開啟摘要／工作台時保存帳本估值；服務未開啟的日期不補造。新增投入不視為獲利。價格及匯率拆解按幣別期初估值與已記錄買賣，費稅包含在內。</p><button id="captureInvestmentDay" class="action-btn">更新今日估值</button>${table(['日期／範圍','淨資產／投資估值','投資估值變動','投入／取回','價格／匯率損益','股息／含息損益','口徑'],rows.map(r=>[esc(r.date)+'<br>'+esc(r.startDate||''),money(r.net)+'／'+money(r.investment),money(r.change),money(r.contribution),money(r.priceGain)+'／'+money(r.fxGain),money(r.dividend)+'／'+money(r.gain),esc(r.reason)+`<br>待核對 ${r.issues||0} 項`]))}<a href="#analysis/trends">完整資產趨勢與月結歸因</a>`;
    }
    if(state.tab==='journal')html+=`<h3>投資決策日誌</h3><form id="decisionJournalForm" class="form-grid"><input type="hidden" name="id"><label>決策日期<input name="date" type="date" value="${core.localDate()}" required></label><label>標的<input name="code" required></label><label>關聯訊號日期<input name="signalDate" type="date"></label><label>關聯真實交易<select name="tradeId"><option value="">不連結交易</option>${b.assets.purchaseRecords.filter(r=>r.id&&!paper(r)).map(r=>`<option value="${esc(r.id)}">${esc(r.date)} ${esc(r.code)}</option>`).join('')}</select></label><label>當時理由<textarea name="thesis" required maxlength="2000"></textarea></label><label>預期／退出條件<textarea name="exitCondition" maxlength="2000"></textarea></label><label>檢討紀錄<textarea name="review" maxlength="4000"></textarea></label><button class="action-btn">儲存決策紀錄</button></form><p>可編輯既有紀錄，修改前內容會保留於版本紀錄。關聯訊號可至交易中心查看。</p>${table(['日期／標的','當時理由／退出條件','關聯','後續檢討'],[...(b.assets.investmentJournal||[])].reverse().map(r=>[esc(r.date)+' '+esc(r.code),esc(r.thesis)+'<br>'+esc(r.exitCondition)+`<br><button type="button" data-edit-journal="${esc(r.id)}">編輯整筆紀錄</button>`,esc(r.signalDate||'無訊號日期')+'<br>'+esc(r.tradeId||'無交易連結'),`<textarea data-journal-review="${esc(r.id)}" aria-label="檢討 ${esc(r.code)}">${esc(r.review)}</textarea><button data-save-review="${esc(r.id)}">保存檢討</button>`]))}`;
    if(state.tab==='exposure'){
      const byCode=new Map(funds.map(f=>[f.code,f]));(b.assets.etfReferences||[]).forEach(f=>{try{if(!byCode.has(f.code)||f.asOf>=byCode.get(f.code).asOf)byCode.set(f.code,validateFund(f));}catch{}});const a=exposure(positions(b),source,[...byCode.values()]);
      html+=`<h3>產業與 ETF 分析</h3><p>這裡幫你看資金實際集中在哪些產業與公司。例如同時持有 0050 和台積電，0050 裡的台積電也會加進曝險，避免低估集中度。</p><p>「更新官方 ETF 成分」更新的是 ETF 持有哪些股票、各占多少比例，並非更新股價。目前支援 0050、006208；公告日期與已取得權重會列在下方，缺少的資料保留未知。</p><button id="updateOfficialEtfs" class="action-btn">更新官方 ETF 成分</button><p id="officialEtfMessage"></p><p>${esc(sourceMessage)}。依真實帳本市值估計；資料過期或成本未核對時仍須參照持股對帳。</p><p>投資估值 ${money(a.total)} TWD｜ETF 未穿透部位 ${money(a.unknown)} TWD。${a.industries.filter(([k,v])=>k!=="未分類／缺資料"&&a.total>0&&v/a.total>=0.3).map(([k,v])=>`<strong> ${esc(k)} 已知曝險達 ${(v/a.total*100).toFixed(1)}%，請檢視集中度。</strong>`).join("")}未分類仍保留於總額，未將已知成分重新放大至 100%。</p>${table(['產業','已知曝險市值','占整體投資估值'],a.industries.map(([k,v])=>[esc(k),money(v),a.total?(v/a.total*100).toFixed(2)+'%':'—']))}${table(['穿透個股','市值／占比'],a.stocks.slice(0,30).map(r=>[esc(r.market+':'+r.code)+' '+esc(r.name),money(r.value)+'／'+(a.total?(r.value/a.total*100).toFixed(2)+'%':'—')]))}${table(['ETF','來源與日期','已取得權重'],a.details.map(r=>[esc(r.code),esc(r.detail),r.coverage.toFixed(2)+'%']))}${table(['ETF 組合','已知共同持股權重（下限）','資料日期'],a.overlap.map(r=>[esc(r.a+'／'+r.b),r.percent.toFixed(2)+'%',esc(r.dates)]))}<p>共同持股權重＝相同個股權重的較小值加總，部分成分僅給下限；不衡量期貨、槓桿或波動風險。其他 ETF 可匯入經核對、有日期與來源的 JSON。</p><details><summary>匯入其他 ETF 成分（預覽後保存）</summary><input id="etfReferenceFile" type="file" accept=".json" aria-label="ETF 成分 JSON"><div id="etfReferencePreview"></div><a href="portfolio-reference-template.json" download>下載格式範本</a></details><details><summary>已載入來源資料</summary>${table(['ETF','公告日期','權重覆蓋','來源'],[...byCode.values()].map(r=>[esc(r.code),esc(r.asOf),money(r.coveragePercent)+'%',/^https:\/\//.test(r.sourceUrl)?`<a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(r.source)}</a>`:'來源網址待核對']))}</details>`;
    }
    if(state.tab==='health'){
      const backups=core.listBackups(),latest=backups[0],sync=window.FinanceSync?.read()||{};html+=`<h3>備份與服務健康中心</h3><button id="refreshPortfolioHealth" class="action-btn">重新檢查服務</button><p>${service?`交易中心運作中｜行情背景更新 ${service.quoteUpdaterActive?'啟用':'未運作'}｜富邦 ${service.brokerConnected?'已連線':'未連線'}｜最近行情成功 ${esc(service.lastQuoteSuccess||'尚無紀錄')}`:'交易中心狀態未取得；請啟動本機 8810 服務並重新整理。'}</p><p>${esc(service?.quoteReason||'')}｜資料庫備份 ${esc(service?.backup?.name||'尚無')} ${esc(service?.backup?.createdAt||'')}</p><p>財務帳本本機還原點 ${backups.length} 個｜最近 ${esc(latest?.createdAt||'尚無')}｜雲端待同步 ${sync.outbox?.length||0} 項｜最後同步 ${esc(sync.lastSyncedAt||'尚無')}</p><button id="createPortfolioBackup" class="action-btn">建立帳本還原點</button> <button id="downloadPortfolioBackup" class="action-btn">下載完整帳本備份</button> <button id="backupTradingDatabase" class="action-btn">備份交易資料庫</button><p id="portfolioHealthMessage"></p><p>本機還原點與原資料在同一瀏覽器，下載 JSON 才能保留獨立副本。交易服務運作時每日檢查資料庫備份；財務帳本每日紀錄需開啟頁面。</p><a href="#analysis/data">預覽備份、比較差異與還原帳本</a><p>行情停更時查看交易中心健康狀態；重啟請執行 auto_trading 的啟動批次檔。憑證與密碼不包含在帳本下載。</p>`;
    }
    section.innerHTML=html;
    const message=error=>window.alert(error.message||String(error));
    section.querySelector('[data-personal-quotes]')?.addEventListener('click',async e=>{const button=e.target,result=section.querySelector('#personalQuoteResult');button.disabled=true;result.textContent='更新中，請稍候…';try{const r=await personalQuotes();personalQuoteMessage=r.pending?"更新已送出，背景行情尚在處理，請稍後重新整理。":`已更新 ${r.applied} 筆行情；${r.missing.map(x=>x.code+'：'+x.reason).join('；')||'無未確認市場'}。各筆依成交時間判斷時效。`;captureDaily(true);}catch(error){result.textContent=error.message;}finally{button.disabled=false;}});
    section.querySelector('#captureInvestmentDay')?.addEventListener('click',()=>{try{captureDaily(true);}catch(error){message(error);}});
    function edit(id){const r=tradeRows(core.load()).find(r=>r._repairKey===id);if(!r){if(id)message(new Error('找不到這筆交易，請重新選擇'));return;}repair=null;const host=section.querySelector('#repairEditor');host.innerHTML=`<h4>核對 ${esc(r.code)}</h4><form id="tradeRepairForm" class="form-grid"><label>日期<input name="date" type="date" value="${esc(r.date)}" required></label><label>買賣<select name="type"><option value="buy" ${r.type==='buy'?'selected':''}>買入</option><option value="sell" ${r.type==='sell'?'selected':''}>賣出</option></select></label><label>股數<input name="shares" type="number" step="any" value="${esc(r.shares)}" required></label><label>價格<input name="price" type="number" step="any" value="${esc(r.price)}" required></label><label>費用<input name="fee" type="number" step="0.01" min="0" value="${esc(r.fee)}" required></label><label>交易稅<input name="tax" type="number" step="0.01" min="0" value="${esc(r.tax)}" required></label><label>現金帳戶<select name="cashAccount" required><option value="">請選擇現金帳戶</option>${core.load().ledger.accounts.filter(a=>a.type!=='信用卡'&&!a.archived).map(a=>`<option ${a.name===r.cashAccount?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label><button class="action-btn">產生修正預覽</button></form><div id="tradeRepairPreview"></div>`;host.querySelector('form').onsubmit=e=>{e.preventDefault();try{repair=prepareRepair(id,Object.fromEntries(new FormData(e.target)));host.querySelector('#tradeRepairPreview').innerHTML=`<p>原現金影響 ${money(repair.cashBefore)} → 修正後 ${money(repair.cashAfter)} ${esc(r.currency||'TWD')}；${esc(r.cashAccount||'無')} → ${esc(repair.after.cashAccount)}。不同帳戶幣別依帳本匯率換算。</p><details><summary>檢視原始與修正資料</summary><pre>${esc(JSON.stringify({before:repair.before,after:repair.after},null,2))}</pre></details><button id="applyTradeRepair" class="action-btn">確認預覽並套用修正</button>`;host.querySelector('#applyTradeRepair').onclick=()=>{try{applyRepair(repair);repair=null;window.alert('核對修正已儲存，持股與現金已重新計算。');}catch(error){message(error);}};}catch(error){message(error);}};}
    section.querySelector('[data-clean-confirmed-holdings]')?.addEventListener('click',()=>{try{const result=cleanConfirmedHoldings();const output=document.querySelector('[data-clean-result]');if(output)output.textContent='已移除 '+result.removed+' 筆重複交易，封存 '+result.archived+' 項歷史待辦；目前僅0050 10,000股。';}catch(error){section.querySelector('[data-clean-result]').textContent=error.message;}});
    section.querySelector('[data-batch-review-account]')?.addEventListener('click',()=>{try{const count=assignReviewAccount();window.alert(count?'已將 '+count+' 筆待核對交易設為台北富邦證券分帳戶，已保留修改前備份。':'待核對交易均已使用此帳戶，沒有需要修改的項目。');}catch(error){message(error);}});
    section.querySelectorAll('[data-repair-trade]').forEach(button=>button.onclick=event=>{event.preventDefault();event.stopPropagation();edit(button.dataset.repairTrade);});section.querySelector('#repairTradeSelect')?.addEventListener('change',e=>edit(e.target.value));
    section.querySelector('#decisionJournalForm select[name="tradeId"]')?.addEventListener('change',e=>{const trade=core.load().assets.purchaseRecords.find(r=>String(r.id)===e.target.value&&!paper(r));if(trade)e.target.form.elements.code.value=trade.code;});
    section.querySelector('#decisionJournalForm')?.addEventListener('submit',e=>{e.preventDefault();try{saveJournal(Object.fromEntries(new FormData(e.target)));}catch(error){message(error);}});
    section.querySelectorAll('[data-edit-journal]').forEach(button=>button.addEventListener('click',()=>{const row=core.load().assets.investmentJournal.find(r=>r.id===button.dataset.editJournal),form=section.querySelector('#decisionJournalForm');if(!row)return;for(const key of ['id','date','code','signalDate','tradeId','thesis','exitCondition','review'])form.elements[key].value=row[key]||'';form.scrollIntoView({behavior:'smooth',block:'start'});}));
    section.querySelectorAll('[data-save-review]').forEach(button=>button.onclick=()=>{const field=[...section.querySelectorAll('[data-journal-review]')].find(r=>r.dataset.journalReview===button.dataset.saveReview);reviewJournal(button.dataset.saveReview,field.value);});
    section.querySelector('#updateOfficialEtfs')?.addEventListener('click',async e=>{const button=e.target,output=section.querySelector('#officialEtfMessage');button.disabled=true;output.textContent='正在讀取投信官方成分資料…';try{const d=await request('/api/investment-etf-refresh',{});const valid=(d.funds||[]).map(validateFund);if(!valid.length)throw new Error(d.error||'未取得有效 ETF 成分，保留原資料');const current=core.load();for(const row of valid){row.id='etf-reference-'+row.code;row.updatedAt=stamp();current.assets.etfReferences=[...(current.assets.etfReferences||[]).filter(r=>r.code!==row.code),row];}core.persist(current.ledger,current.assets,'更新官方 ETF 成分');funds=valid;sourceMessage='更新成功：'+valid.map(r=>r.code+' 公告 '+r.asOf+'，'+r.holdings.length+' 檔，權重 '+r.coveragePercent+'%').join('；')+(d.warnings?.length?'；'+d.warnings.join('；'):'');rerender();}catch(error){output.textContent='更新失敗：'+error.message+'。既有資料保留。';}finally{button.disabled=false;}});
    section.querySelector('#etfReferenceFile')?.addEventListener('change',async e=>{const host=section.querySelector('#etfReferencePreview');try{const row=validateFund(JSON.parse(await e.target.files[0].text()));host.innerHTML=`<p>${esc(row.code)}｜${esc(row.asOf)}｜${row.holdings.length} 個成分｜權重 ${money(row.coveragePercent)}%｜${esc(row.sourceUrl)}</p><button class="action-btn">保存此 ETF 成分</button>`;host.querySelector('button').onclick=()=>importFund(row);}catch(error){host.textContent=error.message;}});
    section.querySelector('#refreshPortfolioHealth')?.addEventListener('click',()=>init());
    section.querySelector('#createPortfolioBackup')?.addEventListener('click',()=>{core.createBackup('使用者建立投資帳本還原點');section.querySelector('#portfolioHealthMessage').textContent='已建立帳本還原點，可至資料管理預覽還原。';});
    section.querySelector('#downloadPortfolioBackup')?.addEventListener('click',()=>{const blob=new Blob([JSON.stringify(core.exportBundle(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='investment-backup-'+core.localDate()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    section.querySelector('#backupTradingDatabase')?.addEventListener('click',async e=>{e.target.disabled=true;try{const d=await request('/api/investment-backup',{});section.querySelector('#portfolioHealthMessage').textContent='資料庫備份完成：'+d.name;}catch(error){message(error);}finally{e.target.disabled=false;}});
    if(dayAttempt!==core.localDate()){dayAttempt=core.localDate();try{captureDaily(false);}catch{dayAttempt='';}}
  }
  async function init(){const results=await Promise.allSettled([request('/api/investment-reference'),fetch('../auto_trading/data/etf-reference.json',{cache:'no-store'}).then(r=>r.ok?r.json():{funds:[]}),request('/api/investment-service')]);if(results[0].status==='fulfilled'){source=results[0].value;sourceMessage=`產業分類 ${Object.keys(source.securities||{}).length} 個｜資料產出 ${source.generatedAt}，個別分類日期保留於來源`;}else sourceMessage='產業來源未連線，未分類部分保留未知';if(results[1].status==='fulfilled')funds=(results[1].value.funds||[]).filter(r=>{try{validateFund(r);return true;}catch{return false;}});if(results[2].status==='fulfilled')service=results[2].value;window.dispatchEvent(new Event('portfolio-lab-ready'));}
  window.PortfolioLab={cleanConfirmedHoldings,assignReviewAccount,positions,quality,prepareRepair,applyRepair,captureDaily,history,saveJournal,reviewJournal,exposure,validateFund,importFund,personalQuotes,decorate,init};
})();



