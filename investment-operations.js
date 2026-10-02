(function(){
  'use strict';
  const core=window.FinanceCore,I=window.FinanceIntelligence;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v==null?'資料不足':Number(v).toLocaleString('zh-TW',{maximumFractionDigits:2});
  const paper=r=>/^(AI-)?PAPER-/.test(r.brokerFillId||'')||r.externalSource==='auto-trading-center';
  const prefsKey='tsubin-investment-alert-preferences-v1';
  function preferences(){try{return JSON.parse(localStorage.getItem(prefsKey)||'{}');}catch{return {};}}
  function realBundle(b){return {...b,assets:{...b.assets,purchaseRecords:(b.assets.purchaseRecords||[]).filter(r=>!paper(r))}};}
  function calendar(b,today=core.localDate()){
    const plans=(b.assets.investmentSchedule||[]).filter(r=>!r.deletedAt).map(r=>({...r,source:'手動確認日程',status:r.completed?'已核對完成':r.date<today?'逾期待核對':'待處理'}));
    const dividends=(b.assets.dividends||[]).map(r=>({id:'dividend:'+r.id,date:r.date,title:r.source,kind:'DIVIDEND',amount:r.amount,currency:r.currency||'TWD',account:r.cashAccount,status:r.date>today?'已登錄未來股息':'帳本股息紀錄',source:'股息帳本'}));
    return [...plans,...dividends].sort((a,b)=>a.date.localeCompare(b.date));
  }
  function savePlan(values){
    const b=core.load(),amount=Number(values.amount);
    if(!I.validDate(values.date)||!['DIVIDEND','PAY','RECEIVE'].includes(values.kind)||!Number.isFinite(amount)||amount<=0||!String(values.title||'').trim())throw new Error('請填有效日期、類型、標的及正數金額');
    const account=b.ledger.accounts.find(r=>r.name===values.account&&!r.archived&&r.type!=='信用卡');
    if(!account)throw new Error('請選擇有效收付款帳戶');
    const row={id:'investment-plan-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),date:values.date,kind:values.kind,title:values.title.trim(),amount,currency:account.currency||'TWD',account:account.name,completed:false,updatedAt:new Date().toISOString()};
    b.assets.investmentSchedule=[...(b.assets.investmentSchedule||[]),row];core.persist(b.ledger,b.assets,'新增投資交割／股息日程');return row;
  }
  function completePlan(id){const b=core.load(),r=(b.assets.investmentSchedule||[]).find(r=>r.id===id&&!r.deletedAt);if(!r)throw new Error('日程已變更');r.completed=!r.completed;r.updatedAt=new Date().toISOString();core.persist(b.ledger,b.assets,'核對投資日程狀態');}
  function performance(b,year){
    b=realBundle(b);const p=I.performance(year,b),positions=core.stockPositionSummary(b.assets);
    const records=b.assets.purchaseRecords.filter(r=>!r.date||r.date<=core.localDate());
    const invalid=records.some(r=>!I.validDate(r.date)||!['buy','sell'].includes(r.type)||!(Number(r.price)>0)||!(Number(r.shares)>0)||r.fee==null||r.tax==null||!Number.isFinite(Number(r.fee))||Number(r.fee)<0||!Number.isFinite(Number(r.tax))||Number(r.tax)<0)||positions.trades.some(r=>r.oversold);
    const missingCost=positions.manualOnly.some(r=>!(Number(r.cost??r.totalCost)>0));
    const costs=new Map();records.filter(r=>String(r.date||'').startsWith(year)).forEach(r=>{const k=r.currency||(['US','USD_FUND'].includes(r.market)?'USD':'TWD'),v=costs.get(k)||{fee:0,tax:0};v.fee+=Number(r.fee)||0;v.tax+=Number(r.tax)||0;costs.set(k,v);});
    return {p,invalid,missingCost,costs:[...costs],realized:invalid?null:p.realized,unrealized:invalid||missingCost?null:p.unrealized};
  }
  function alerts(b,monitor,snapshot,now=Date.now()){
    const health=performance(b,String(new Date().getFullYear()));
    const rows=core.insights().alerts.map(r=>({id:'finance:'+r.title+'|'+r.detail,title:r.title,detail:r.detail,priority:r.level==='danger'?3:2}));
    if(health.invalid||health.missingCost)rows.push({id:'investment-quality',title:'投資成本／交易資料待核對',detail:'存在缺少成本或費稅、無效交易或超賣紀錄；部分績效無法計算。',priority:3});
    calendar(b).filter(r=>!r.completed&&r.source==='手動確認日程'&&r.date<=I.day(core.localDate(),7)).forEach(r=>rows.push({id:r.id,title:r.kind==='DIVIDEND'?'股息待核對':'交割款待核對',detail:`${r.date} ${r.title} ${r.currency} ${money(r.amount)}｜${r.account}；${r.status}`,priority:r.status==='逾期待核對'?3:2}));
    if(snapshot&&now-Date.parse(snapshot.queriedAt)>300000)rows.push({id:'broker-stale:'+snapshot.queriedAt,title:'富邦庫存快照過期',detail:'請到交易中心重新查詢，再載入快照。',priority:2});
    if(monitor){const stale=now-Date.parse(monitor.generatedAt)>300000; if(stale)rows.push({id:'monitor-stale:'+monitor.generatedAt,title:'盤中提醒資料過期',detail:'以下為上次保存資料，請確認交易中心服務。',priority:2});
      (monitor.events||[]).filter(r=>!r.acknowledged).forEach(r=>rows.push({id:'monitor:'+r.id,title:r.kind==='MA20'&&!r.detail.startsWith('採樣價格由')?'月線以上（初始觀察）':'盤中條件提醒',detail:`${r.code} ${r.name}｜${r.detail}｜${r.quote_time}${stale?'（舊快照）':''}`,priority:1}));}
    return rows.sort((a,b)=>b.priority-a.priority);
  }
  function table(headers,rows){return `<div style="overflow:auto"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
  function decorate(app,state){
    const showCalendar=state.domain==='investments'&&['portfolio','dividends'].includes(state.tab);
    const showPerformance=state.domain==='investments'&&state.tab==='portfolio';
    const showAlerts=(state.domain==='analysis'&&state.tab==='events')||showPerformance;
    if(!showCalendar&&!showPerformance&&!showAlerts)return;
    const section=document.createElement('section');section.className='panel';section.id='investmentOperations';section.style.marginTop='16px';app.append(section);
    let monitor=null,snapshot=null,loadStatus='讀取本機提醒資料…',year=String(new Date().getFullYear());
    const draw=()=>{
      const b=core.load(),plans=calendar(b),pref=preferences(),now=Date.now();let html='';
      if(showCalendar){const pending=plans.filter(r=>r.source==='手動確認日程'&&!r.completed);const totals=new Map();pending.filter(r=>r.date<=I.day(core.localDate(),30)).forEach(r=>{const k=r.currency+'／'+r.account;const t=totals.get(k)||{pay:0,receive:0};t[r.kind==='PAY'?'pay':'receive']+=Number(r.amount);totals.set(k,t);});
        html+=`<h3>股息與交割日曆</h3><p>未來 30 日（含逾期）待核對金額：${[...totals].map(([k,t])=>`${esc(k)} 需付款 ${money(t.pay)}／預計收款 ${money(t.receive)}`).join('；')||'尚無已登錄日程'}。</p><p>日期與金額請依券商或配息通知填寫；日程只作提醒，不會移動現金或自動入帳。已核對完成也不代表已記帳。已登錄未來股息不重複加入日程合計。</p>
        <details><summary>新增已確認交割／預計股息</summary><form id="investmentScheduleForm" class="form-grid"><label>日期<input name="date" type="date" required></label><label>類型<select name="kind"><option value="PAY">交割付款</option><option value="RECEIVE">交割收款</option><option value="DIVIDEND">預計股息</option></select></label><label>標的／說明<input name="title" required maxlength="100"></label><label>金額<input name="amount" type="number" min="0.01" step="0.01" required></label><label>帳戶<select name="account">${b.ledger.accounts.filter(r=>!r.archived&&r.type!=='信用卡').map(r=>`<option>${esc(r.name)}</option>`).join('')}</select></label><button class="action-btn">儲存日程</button></form></details>
        ${table(['日期','標的／來源','類型','金額／帳戶','狀態'],plans.map(r=>[esc(r.date),esc(r.title)+'<br>'+esc(r.source),esc({PAY:'交割付款',RECEIVE:'交割收款',DIVIDEND:'股息'}[r.kind]),esc(r.currency)+' '+money(r.amount)+'<br>'+esc(r.account||'未指定'),esc(r.status)+(r.source==='手動確認日程'?` <button data-plan="${esc(r.id)}">${r.completed?'恢復待核對':'標記已核對'}</button>`:'')]))}`;
      }
      if(showPerformance){const a=performance(b,year),p=a.p;html+=`<h3>真實投資績效與費用</h3><label>年度<select id="investmentPerformanceYear">${[0,1,2,3,4].map(n=>{const y=String(new Date().getFullYear()-n);return `<option ${y===year?'selected':''}>${y}</option>`;}).join('')}</select></label><p>年度已實現損益：${money(a.realized)} TWD｜目前未實現損益：${money(a.unrealized)} TWD｜年度股息：${money(p.dividendIncome)} TWD</p><p>年度總損益（含股息）：${money(a.invalid?null:p.annual.gain)} TWD｜年度年化報酬：${a.invalid||p.annual.annualizedRate==null?'無法計算':p.annual.annualizedRate.toFixed(2)+'%'}｜${esc(a.invalid?'買賣／費稅紀錄不完整或曾超賣，請先核對':p.annual.reason||'依期初、期末估值及投資現金流計算')}</p><p>${a.missingCost?'部分手動持股缺少成本，未顯示合計未實現損益。':''}已排除模擬交易。未實現損益使用帳本估值來源，可能為手動或上次價格；最新富邦估值請看持股總覽。新增投入不當成獲利。未實現損益為目前累計，並非年度損益。</p>${table(['交易幣別','本年手續費','本年交易稅'],a.costs.map(([k,v])=>[esc(k),money(v.fee),money(v.tax)]))}<p>費稅已含在交易成本／淨收入，以上明細不再次扣除；不同幣別分開列示。</p><a href="#analysis/tax">歷史估值、匯率與年度績效明細</a>`;}
      if(showAlerts){const all=alerts(b,monitor,snapshot),visible=all.filter(r=>!(pref[r.id]>now));html+=`<h3>整合提醒中心</h3><p>${esc(loadStatus)}｜${visible.length} 筆顯示，${all.length-visible.length} 筆暫停。暫停僅影響此瀏覽器，不變更交易中心已讀狀態。</p><button id="refreshInvestmentAlerts" class="action-btn">更新提醒資料</button><button id="restoreInvestmentAlerts" class="action-btn">恢復所有暫停提醒</button>${table(['優先級','提醒','依據','操作'],visible.map(r=>[r.priority===3?'高':r.priority===2?'中':'一般',esc(r.title),esc(r.detail),`<button data-snooze="${esc(r.id)}">暫停 24 小時</button>`]))}`;}
      section.innerHTML=html;
      section.querySelector('#investmentScheduleForm')?.addEventListener('submit',e=>{e.preventDefault();try{savePlan(Object.fromEntries(new FormData(e.target)));draw();}catch(error){window.alert(error.message);}});
      section.querySelectorAll('[data-plan]').forEach(button=>button.onclick=()=>{completePlan(button.dataset.plan);draw();});
      section.querySelector('#investmentPerformanceYear')?.addEventListener('change',e=>{year=e.target.value;draw();});
      section.querySelectorAll('[data-snooze]').forEach(button=>button.onclick=()=>{localStorage.setItem(prefsKey,JSON.stringify({...preferences(),[button.dataset.snooze]:Date.now()+86400000}));draw();});
      section.querySelector('#refreshInvestmentAlerts')?.addEventListener('click',loadReminders);
      section.querySelector('#restoreInvestmentAlerts')?.addEventListener('click',()=>{localStorage.removeItem(prefsKey);draw();});
    };draw();
    function loadReminders(){return Promise.allSettled(['monitor-summary.json','fubon-preview.json'].map(async file=>{const r=await fetch(new URL('../auto_trading/data/'+file,location.href),{cache:'no-store'});if(!r.ok)throw new Error('本機資料未建立');return r.json();})).then(results=>{monitor=results[0].status==='fulfilled'?results[0].value:null;snapshot=results[1].status==='fulfilled'?results[1].value:null;loadStatus=monitor?'已載入交易中心保存的提醒':'交易中心提醒尚未取得；此處仍顯示帳本及日程提醒';if(section.isConnected)draw();});}
    if(showAlerts)loadReminders();
  }
  window.InvestmentOperations={calendar,savePlan,completePlan,performance,alerts,decorate};
})();
