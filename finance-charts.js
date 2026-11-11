(function(){
 'use strict';
 const n=v=>Number.isFinite(Number(v))?Number(v):0,esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>n(v).toLocaleString('zh-TW',{maximumFractionDigits:2}),allocationColors={tw:'#22634b',us:'#b75922',funds:'#7642a6',gold:'#9c7711',cash:'#295eac'};
 let host;
 function shiftMonth(month,offset){const [y,m]=month.split('-').map(Number),d=new Date(y,m-1+offset,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
 function filters(){const q=new URLSearchParams(location.search),value=q.get('chartMonth'),today=FinanceCore.monthOf();return {month:/^\d{4}-(0[1-9]|1[0-2])$/.test(value||'')&&value<=today?value:today,span:[3,6,12].includes(Number(q.get('chartSpan')))?Number(q.get('chartSpan')):6};}
 const holdingCost=(row,assets)=>row.source==='trades'?n(row.twdBasis):Number(row.cost)>0?n(row.cost)*row.shares*FinanceCore.fxRate(assets,row.currency):null;
 function model(bundle,{month=FinanceCore.monthOf(),span=6}={}){
  const core=window.FinanceCore,today=core.localDate(),events=(bundle.assetsSummary&&bundle.events||core.buildEvents(bundle.ledger,bundle.assets)).filter(r=>!r.pending&&!r.isReconciliationAdjustment&&r.date<=today);
  const months=Array.from({length:span},(_,i)=>({month:shiftMonth(month,i-span+1),income:0,expense:0,count:0})),byMonth=new Map(months.map(r=>[r.month,r]));
  for(const e of events){const row=byMonth.get(e.date?.slice(0,7));if(!row)continue;if(['income','dividend'].includes(e.kind)){row.income+=n(e.twdAmount);row.count++;}else if(e.kind==='expense'){row.expense+=n(e.twdAmount);row.count++;}}
  months.forEach(r=>r.balance=r.income-r.expense);
  const expenses=events.filter(r=>r.kind==='expense'&&r.date.startsWith(month)),categories=new Map();
  for(const row of expenses)categories.set(row.category,(categories.get(row.category)||0)+n(row.twdAmount));
  const categoryRows=[...categories].map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value),expense=expenses.reduce((s,r)=>s+n(r.twdAmount),0);
  const budgets=new Map();for(const b of bundle.ledger.budgets||[])budgets.set(b.category,(budgets.get(b.category)||0)+n(b.amount));
  const budgetRows=[...new Set([...budgets.keys(),...categories.keys()])].map(name=>({name,limit:budgets.has(name)?budgets.get(name):null,spent:categories.get(name)||0})).sort((a,b)=>(b.spent-(b.limit??Infinity))-(a.spent-(a.limit??Infinity))||b.spent-a.spent||a.name.localeCompare(b.name));
  const summary=bundle.assetsSummary||core.assetSummary(bundle.ledger,bundle.assets),labels={cash:'現金',tw:'台股',us:'美股',funds:'基金',gold:'貴金屬'},allocation=Object.entries(summary.allocation).filter(([,value])=>value>0).map(([key,value])=>({key,name:labels[key]||key,value,color:allocationColors[key]}));
  const positions=bundle.stockPositions||core.stockPositionSummary(bundle.assets),holdings=[...positions.active,...positions.manualOnly].filter(r=>r.shares>0).map(r=>({...r,cost:holdingCost(r,bundle.assets)})).sort((a,b)=>b.value-a.value);
  const snapshots=snapshotRows(bundle.assets).filter(r=>r.date>=months[0].month+'-01'&&r.date.slice(0,7)<=month);
  return {month,span,months,expenses,categoryRows,expense,budgetRows,summary,allocation,holdings,snapshots};
 }
 function toolbar(f){return `<form id="analysisChartFilter" class="fc-toolbar"><h3 class="chart-filter-title">趨勢篩選</h3><label>分析月份<input type="month" name="month" max="${FinanceCore.monthOf()}" value="${esc(f.month)}" required></label><label>趨勢期間<select name="span"><option value="3" ${f.span===3?'selected':''}>最近 3 個月</option><option value="6" ${f.span===6?'selected':''}>最近 6 個月</option><option value="12" ${f.span===12?'selected':''}>最近 12 個月</option></select></label><button class="action-btn blue" type="submit">更新圖表</button><small>收支依月份篩選；目前資產與持股維持最新帳本估值。單位：新台幣 TWD。</small></form>`;}
 function panel(key,title,note,body){return `<section class="panel fc-panel" data-chart="${key}"><header><h3>${esc(title)}</h3><p>${esc(note)}</p></header>${body}</section>`;}
 function empty(text){return `<p class="empty">${esc(text)}</p>`;}
 function legend(rows){return `<div class="fc-legend">${rows.map(([name,color])=>`<span><i style="background:${color}"></i>${esc(name)}</span>`).join('')}</div>`;}
 function table(headers,rows){return `<div class="fc-table-wrap"><table class="fc-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((c,i)=>`<${i?'td':'th'} ${i?'':'scope="row"'}>${c}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
 function scaleTick(v){return Math.abs(v)>=10000?money(v/10000)+'萬':money(v);}
 function cashflow(m){
  const max=Math.max(1,...m.months.flatMap(r=>[r.income,r.expense])),w=m.months.length*76+80,plot=w-80,h=220,step=plot/m.months.length;
  const ticks=[0,max/2,max].map(v=>`<line x1="66" x2="${w-8}" y1="${180-v/max*150}" y2="${180-v/max*150}" stroke="#dbe2d8"/><text x="58" y="${185-v/max*150}" text-anchor="end">${scaleTick(v)}</text>`).join('');
  const bars=m.months.map((r,i)=>{const x=68+step*i;return `<g><title>${esc(r.month)}：收入 ${money(r.income)}，支出 ${money(r.expense)}，結餘 ${money(r.balance)}</title><rect x="${x+step*.15}" y="${180-r.income/max*150}" width="${step*.24}" height="${r.income/max*150}" fill="#517759"/><rect x="${x+step*.46}" y="${180-r.expense/max*150}" width="${step*.24}" height="${r.expense/max*150}" fill="#a4544c"/><text x="${x+step*.45}" y="207" text-anchor="middle">${r.month.slice(5)}月</text></g>`;}).join('');
  return panel('cashflow','每月收入、支出與結餘',`${m.months[0].month}～${m.month}；收入含已記錄股息，排除轉帳、投資買賣與盤點調整。`,legend([['收入','#517759'],['支出','#a4544c']])+(!m.months.some(r=>r.count)?empty('此期間沒有已發生的收支紀錄。'):`<div class="fc-chart-scroll"><svg class="fc-svg fc-months ${m.span===12?'fc-wide-chart':''}" viewBox="0 0 ${w} ${h}" role="img" aria-label="每月收入與支出長條圖；精確金額見下方表格">${ticks}${bars}</svg></div>`)+table(['月份','收入','支出','結餘'],m.months.map(r=>[`<button class="fc-link" data-chart-month="${r.month}" type="button">${r.month}</button>`,money(r.income),money(r.expense),`<span class="${r.balance<0?'negative':'positive'}">${money(r.balance)}</span>`]))+`<p class="fc-footnote">無紀錄月份顯示 0；選取月份查看分類與預算。外幣收支依系統目前匯率換算，非歷史匯損益。</p>`);
 }
 function categoryIncrease(bundle,m){
  const previous=new Map(model(bundle,{month:shiftMonth(m.month,-1)}).categoryRows.map(row=>[row.name,row.value]));
  let largest=null;
  for(const {name,value} of m.categoryRows){
   const before=previous.get(name)||0,delta=value-before;
   if(delta>(largest?.delta||0))largest={category:name,delta,percent:before>0?Math.round(delta/before*100):0};
  }
  return largest?{...largest,label:largest.percent>0?`${largest.category}比上月多 ${largest.percent}%`:`${largest.category}支出增加`}:null;
 }
 function categoryGuide(change){
  const sprite='<span class="island-inline-character island-inline-character--lookout" aria-hidden="true"></span>';
  return change?`<button type="button" class="fc-category-guide" data-chart-category="${esc(change.category)}">${sprite}<span>${esc(change.label)}<small>查看交易明細</small></span></button>`
   :`<p class="fc-category-guide">${sprite}<span>本月沒有支出分類比上月增加</span></p>`;
 }
 function categories(m,change){const max=Math.max(1,...m.categoryRows.map(r=>r.value));return panel('categories',`${m.month} 支出分類排行`,'點選分類查看該月原始交易；圖中金額只計一般支出。',categoryGuide(change)+(m.categoryRows.length?`<ol class="fc-bars">${m.categoryRows.map(r=>`<li><div class="fc-row-heading"><button class="fc-link" type="button" data-chart-category="${esc(r.name)}">${esc(r.name)}</button><strong>${money(r.value)} <small>／${m.expense>0?(r.value/m.expense*100).toFixed(1):0}%</small></strong></div><div class="fc-track"><i style="width:${Math.max(0,r.value/max*100)}%;background:#245fba"></i></div></li>`).join('')}</ol>`:empty('本月沒有已發生的支出紀錄。')));}
 function budget(m){const rows=m.budgetRows;return panel('budgets',`${m.month} 預算與實際支出`,'預算依目前設定；藍色為預算內，超支以文字與紅色標示。',rows.length?`<ol class="fc-bars">${rows.map(r=>{const ratio=r.limit>0?r.spent/r.limit:null,over=r.limit!==null&&r.spent>r.limit;return `<li><div class="fc-row-heading"><button class="fc-link" type="button" data-chart-category="${esc(r.name)}">${esc(r.name)}</button><strong>${money(r.spent)} <small>／${r.limit===null?'未設定預算':money(r.limit)}</small></strong></div><div class="fc-track"><i style="width:${ratio===null?0:Math.max(0,Math.min(100,ratio*100))}%;background:${over?'#a4544c':'#245fba'}"></i></div><p class="${over?'negative':'fc-footnote'}">${r.limit===null?'未設定預算，無法計算使用率':r.limit===0?(over?'預算為 0，超支 '+money(r.spent):'預算為 0，目前無支出'):(ratio*100).toFixed(1)+'%｜'+(over?'超支 '+money(r.spent-r.limit):'剩餘 '+money(r.limit-r.spent))}</p></li>`;}).join('')}</ol>`:empty('尚無支出與預算資料。可在「日常記帳 → 分類預算」設定。'));}
 function snapshotRows(assets){
  const rows=new Map(),today=FinanceCore.localDate();
  for(const r of [...(assets.financialSnapshots||[]),...(assets.assetSnapshots||[])]){
   const value=Number(r.net??r.total);
   if(/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&Number.isFinite(value)&&Number.isFinite(Date.parse(r.date+'T00:00:00Z'))&&r.date<=today)rows.set(r.date,{date:r.date,value});
  }
  return [...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
 }
 const amountTone=value=>value<0?'negative':value>0?'positive':'';
 function snapshotPlot(rows,{left,right,top,bottom}){
  const values=rows.map(r=>r.value),min=Math.min(...values),max=Math.max(...values);
  const padding=Math.max((max-min)*.14,Math.abs(max)*.002,1);
  const low=min-padding,high=max+padding;
  const dates=rows.map(r=>Date.parse(r.date+'T00:00:00Z'));
  const duration=Math.max(86400000,dates.at(-1)-dates[0]);
  const x=i=>rows.length===1?right:left+(dates[i]-dates[0])/duration*(right-left);
  const y=value=>bottom-(value-low)/(high-low)*(bottom-top);
  const points=rows.map((r,i)=>`${x(i)},${y(r.value)}`).join(' ');
  const area=rows.length>1?`<polygon points="${left},${bottom} ${points} ${right},${bottom}" fill="currentColor" opacity=".10"/>`:'';
  const lines=rows.slice(1).map((r,i)=>`<line x1="${x(i)}" x2="${x(i+1)}" y1="${y(rows[i].value)}" y2="${y(r.value)}" stroke="currentColor" stroke-width="2" ${dates[i+1]-dates[i]>86400000?'stroke-dasharray="5 5"':''}/>`).join('');
  return {x,y,low,high,area,lines};
 }
 function homeSnapshot(assets,current){
  const rows=snapshotRows(assets).slice(-12),last=rows.at(-1),previous=rows.at(-2);
  const change=previous?last.value-previous.value:null;
  const plot=last?snapshotPlot(rows,{left:12,right:588,top:9,bottom:80}):null;
  return `<div class="net-summary"><small>目前淨資產</small><strong class="money-value">NT$ ${money(current)}</strong><span>${change===null?'尚無可比較的快照':`較前次快照 <b class="money-value ${amountTone(change)}">${signedTwd(change)}</b>`}</span></div>${plot?`<svg class="net-sparkline" viewBox="0 0 600 87" role="img" aria-label="最近 ${rows.length} 次資產快照；虛線表示未記錄日期">${plot.area}${plot.lines}<circle cx="${plot.x(rows.length-1)}" cy="${plot.y(last.value)}" r="4" fill="currentColor"/></svg><small class="fc-footnote net-latest">最新快照 ${last.date}</small>`:'<p class="fc-footnote">尚無資產快照。</p>'}`;
 }
 function networth(m){
  const rows=m.snapshots;if(!rows.length)return panel('networth','淨資產走勢','只顯示已保存的估值；未記錄日期不補造。',empty('此期間尚無資產快照；可在資產配置建立，或在下方補齊歷史估值。'));
  const {x,y,low,high,area,lines}=snapshotPlot(rows,{left:80,right:580,top:35,bottom:185});
  const last=rows.at(-1),first=rows[0],delta=last.value-first.value;
  const percent=first.value>0?delta/first.value*100:null;
  const ticks=[low,(low+high)/2,high].map(v=>`<line x1="80" x2="580" y1="${y(v)}" y2="${y(v)}" stroke="#dbe2d8"/><text class="money-value" x="72" y="${y(v)+5}" text-anchor="end">${scaleTick(v)}</text>`).join('');
  const summary=rows.length>1?`<strong class="money-value ${amountTone(delta)}">${signedTwd(delta)}</strong>${percent===null?'':`<b class="money-value ${amountTone(delta)}">${percent>0?'+':''}${percent.toFixed(2)}%</b>`}`:'尚無可比較的前期估值';
  const points=rows.map((r,i)=>`<circle class="snapshot-point${i===rows.length-1?' selected':''}" cx="${x(i)}" cy="${y(r.value)}" r="4" fill="currentColor" tabindex="0" data-snapshot-date="${r.date}" data-snapshot-value="${money(r.value)}" aria-label="查看 ${r.date} 快照"/>`).join('');
  const body=`<figure class="snapshot-figure"><figcaption class="net-summary"><small>期間增減 · ${rows.length} 次紀錄</small><span class="net-change">${summary}</span></figcaption><div class="net-point-readout" aria-live="polite"><span data-snapshot-output-date>${last.date}</span><strong data-snapshot-output-value class="money-value">NT$ ${money(last.value)}</strong></div><svg class="fc-svg net-detail-chart" viewBox="0 0 600 235" role="group" aria-label="淨資產快照走勢，依實際日期間隔排列">${ticks}${area}${lines}${points}<text x="80" y="222">${rows.length>1?first.date.slice(5):''}</text><text x="580" y="222" text-anchor="end">${last.date.slice(5)}</text></svg><p class="fc-footnote">快照差額含資金進出，不代表投資報酬。虛線代表中間有未記錄日期。</p><button class="action-btn" type="button" data-chart-table="snapshot" aria-expanded="false" aria-controls="fc-snapshot-data">查看日期與金額明細</button><div id="fc-snapshot-data" hidden>${table(['快照日期','淨資產（TWD）'],rows.map(r=>[esc(r.date),`<span class="money-value">${money(r.value)}</span>`]))}</div></figure>`;
  return panel('networth','淨資產走勢',`${m.months[0].month}～${m.month}；合併已保存的財務估值與手動資產快照，同一天只列一次。`,body);
 }
 function allocationDonut(rows,label,unit,centerAmount,centerTone,animal){
  const total=rows.reduce((sum,row)=>sum+row.value,0);
  if(!total)return empty('目前沒有正值可計算占比。');
  const circumference=2*Math.PI*72;
  let offset=0;
  const arcs=rows.map(row=>{
   const length=row.value/total*circumference;
   const arc=`<circle cx="100" cy="100" r="72" fill="none" stroke="${row.color}" stroke-width="24" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)"><title>${esc(row.name)} ${(row.value/total*100).toFixed(1)}%</title></circle>`;
   offset+=length;
   return arc;
  }).join('');
  const decoration=animal?`<foreignObject x="4" y="164" width="34" height="34" aria-hidden="true" pointer-events="none"><span class="fc-donut-animal" style="background-image:url(island-art/cozy/${animal}-steps.webp)"></span></foreignObject>`:"";
  return `<div class="fc-allocation"><svg viewBox="0 0 200 200" role="img" aria-label="${label}；各項金額與占比見旁側列表">${arcs}${decoration}<text x="100" y="95" text-anchor="middle" class="fc-donut-title">${label}</text><text x="100" y="120" text-anchor="middle" class="fc-donut-count">${centerAmount===undefined?`${rows.length} ${unit}`:`<tspan class="money-value ${amountTone(centerTone??0)}" font-size="14">${esc(centerAmount)}</tspan>`}</text></svg><ul class="fc-allocation-list">${rows.map(r=>`<li><span><i style="background:${r.color}"></i>${esc(r.name)}</span><strong><span class="money-value ${amountTone(r.amount??0)}">${r.amount===undefined?money(r.value):signedTwd(r.amount)}</span><small>${(r.value/total*100).toFixed(1)}%</small></strong></li>`).join('')}</ul></div>`;
 }
 function allocation(m){
  const total=m.allocation.reduce((sum,row)=>sum+row.value,0);
  const footnote=total?`<p class="fc-footnote">圖中正值資產合計 ${money(total)}；負債 ${money(m.summary.liabilities)} 另列。${m.summary.cash<0?'現金餘額為負 '+money(m.summary.cash)+'，未放入圓環占比。':''}</p>`:'';
  return panel('allocation','目前資產配置','按目前帳本估值計算，與月份篩選無關。',allocationDonut(m.allocation,'資產分布','類')+footnote);
 }
 const holdingColors=['#26714e','#c36d26','#3264ad','#8753a1','#b44659','#167d8b','#8b7325'];
 const holdingColor=index=>holdingColors[index]||'#646b74';
 const signedTwd=value=>`${value<0?'−':value>0?'+':''}NT$ ${money(Math.abs(value))}`;
 function holdingsAllocation(positions,assets){
  const rows=positions.map((row,index)=>({
   name:[row.code,row.name].filter(Boolean).join(' ')||'未命名',
   value:Number(row.value),
   color:holdingColor(index),
   cost:holdingCost(row,assets)
  }));
  const visible=rows.slice(0,7);
  if(rows.length>holdingColors.length)visible.push({name:'其他持倉',value:rows.slice(holdingColors.length).reduce((sum,row)=>sum+row.value,0),color:holdingColor(holdingColors.length)});
  const allocationTotal=rows.reduce((sum,row)=>sum+row.value,0);
  const gains=rows.filter(row=>row.cost!==null).map(row=>{
   const amount=row.value-row.cost;
   return {...row,amount,value:Math.abs(amount)};
  });
  const net=gains.reduce((sum,row)=>sum+row.amount,0);
  const missing=rows.length-gains.length;
  const allocation=panel('portfolio-holdings','股票持倉占比','按目前持倉的正值市值計算，金額以新台幣顯示。',allocationDonut(visible,'市值合計','組',`NT$ ${money(allocationTotal)}`,undefined,"rabbit"));
  const gainsChart=gains.some(row=>row.value>0)?allocationDonut(gains.filter(row=>row.value>0),'未實現損益','組',signedTwd(net),net,"dog"):empty(gains.length?'目前已知成本的持倉損益為零。':'目前沒有可計算損益的持倉。');
  const performance=panel('portfolio-gains','投資損益狀況','圓環按各持倉未實現損益的絕對值分配，金額保留正負號。',gainsChart+(missing?`<p class="fc-footnote">${missing} 檔持倉缺少成本，未計入損益。</p>`:''));
  return allocation+performance;
 }
 function holdings(m){const max=Math.max(1,...m.holdings.flatMap(r=>[r.value,r.cost||0]));return panel('holdings','各股票與基金：成本對照市值','目前持倉；統一折合台幣，成本含已記錄買入費稅。',legend([['持有成本','#245fba'],['目前市值','#7954ad']])+(m.holdings.length?`<ol class="fc-bars">${m.holdings.map(r=>`<li><div class="fc-row-heading"><button type="button" class="fc-link" data-chart-trade="${esc(r.code)}">${esc(r.code||r.name)} ${esc(r.name||'')}</button><small>${n(r.shares).toLocaleString()} 股／單位 · ${esc(r.currency)}</small></div><div class="fc-pair"><span>成本</span><div class="fc-track"><i style="width:${r.cost===null?0:r.cost/max*100}%;background:#245fba"></i></div><strong>${r.cost===null?'成本不足':money(r.cost)}</strong><span>市值</span><div class="fc-track"><i style="width:${Math.max(0,r.value/max*100)}%;background:#7954ad"></i></div><strong>${money(r.value)}</strong></div><p class="${r.cost===null?'fc-footnote':r.value-r.cost<0?'negative':'positive'}">${r.cost===null?'缺少持有成本，暫不計算損益':'未實現損益 '+money(r.value-r.cost)+(r.cost>0?'（'+((r.value-r.cost)/r.cost*100).toFixed(2)+'%）':'')}${r.source!=='trades'?'｜手動持倉成本估算':r.twdBasisEstimated?'｜成本含匯率估算':''}</p><small class="fc-footnote">行情時間：${esc(r.quoteFetchedAt||'未記錄')}；損益未扣未來賣出費稅。</small></li>`).join('')}</ol>`:empty('目前沒有持有股票或基金。')));}
 function render(bundle,tab,prepared){const f=filters(),m=prepared||model(bundle,f);return toolbar(f)+`<div class="fc-grid">${tab==='spending'?cashflow(m)+categories(m,categoryIncrease(bundle,m))+budget(m):networth(m)+allocation(m)+holdings(m)}</div><section id="fc-records" class="panel" hidden aria-label="圖表交易明細"></section>`;}
 function selectMonth(month,span=filters().span){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month>FinanceCore.monthOf())return;const u=new URL(location.href);u.searchParams.set('chartMonth',month);u.searchParams.set('chartSpan',String(span));history.replaceState(null,'',u.pathname+u.search+u.hash);host.refresh();}
 function showSnapshot(event){
  const point=event.target.closest('[data-snapshot-date]');
  if(!point)return;
  const figure=point.closest('.snapshot-figure');
  figure.querySelector('.snapshot-point.selected')?.classList.remove('selected');
  point.classList.add('selected');
  figure.querySelector('[data-snapshot-output-date]').textContent=point.dataset.snapshotDate;
  figure.querySelector('[data-snapshot-output-value]').textContent='NT$ '+point.dataset.snapshotValue;
 }
 function init(callbacks){host=callbacks;
  for(const event of ['pointerover','focusin','click'])document.addEventListener(event,showSnapshot);
  document.addEventListener('submit',e=>{if(e.target.id!=='analysisChartFilter')return;e.preventDefault();const values=new FormData(e.target);selectMonth(values.get('month'),Number(values.get('span')));});document.addEventListener('click',e=>{
  const month=e.target.closest('[data-chart-month]');if(month){selectMonth(month.dataset.chartMonth);return;}
  const toggle=e.target.closest('[data-chart-table]');if(toggle){const box=document.getElementById(toggle.getAttribute('aria-controls'));box.hidden=!box.hidden;toggle.setAttribute('aria-expanded',String(!box.hidden));return;}
  const trade=e.target.closest('[data-chart-trade]');if(trade){host.trade(trade.dataset.chartTrade);return;}
  const category=e.target.closest('[data-chart-category]');if(category){const m=model(host.bundle(),filters()),rows=m.expenses.filter(r=>r.category===category.dataset.chartCategory),box=document.getElementById('fc-records');box.hidden=false;box.innerHTML=`<h3>${esc(m.month)} · ${esc(category.dataset.chartCategory)}交易明細</h3><p>${rows.length} 筆，台幣合計 ${money(rows.reduce((s,r)=>s+n(r.twdAmount),0))}。排除盤點調整與未來交易。</p>${table(['日期','商家／說明','帳戶','原幣金額','折合台幣'],rows.sort((a,b)=>b.date.localeCompare(a.date)).map(r=>[esc(r.date),esc(r.title),esc(r.account),esc(r.currency)+' '+money(r.amount),money(r.twdAmount)]))}`;box.scrollIntoView({block:'start',behavior:'auto'});}
 });}
 window.FinanceCharts={model,categoryIncrease,render,filters,init,holdingsAllocation,holdingColor,homeSnapshot};
})();
