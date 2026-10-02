(function () {
  'use strict';
  const positive = v => v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v)>0;
  const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => v === null ? '待核對' : Number(v).toLocaleString('zh-TW',{maximumFractionDigits:0});
  function analyze(snapshot,bundle,account,confirmed,quotes={},now=Date.now(),limit=30) {
    const diffs=window.FubonReview.reconcile(snapshot,bundle,account,confirmed);
    const records=bundle.assets.purchaseRecords.filter(r=>r.cashAccount===account && r.market==='TW' && !/^(AI-)?PAPER-/.test(r.brokerFillId||'') && r.externalSource!=='auto-trading-center');
    const positions=window.FinanceCore.stockPositionSummary({...bundle.assets,purchaseRecords:records});
    const rows=diffs.map(diff=>{
      const holding=snapshot.holdings.find(r=>r.code===diff.code), p=positions.active.find(r=>r.code===diff.code);
      const history=records.filter(r=>r.code===diff.code && (!r.date || r.date<=window.FinanceCore.localDate()));
      const incomplete=history.some(r=>(r.currency&&r.currency!=='TWD')||!positive(r.price)||!positive(r.shares)||!['buy','sell'].includes(r.type)||!r.date||r.fee===undefined||r.tax===undefined||!Number.isFinite(Number(r.fee??0))||Number(r.fee??0)<0||!Number.isFinite(Number(r.tax??0))||Number(r.tax??0)<0) || positions.trades.some(r=>r.code===diff.code&&r.oversold);
      const supported=holding && String(holding.type).split('.').pop()==='Stock' && Number(holding.oddQuantity)===0 && Number.isFinite(diff.quantity)&&diff.quantity>=0;
      const q=quotes[diff.code], age=now-Date.parse(q?.quoteTime), usable=positive(q?.price)&&Number.isFinite(age)&&age>=-5000;
      const price=usable?Number(q.price):null, value=supported&&price!==null?diff.quantity*price:null;
      const basis=diff.status==='一致' && !incomplete && p && p.basis>0 ? p.basis:null;
      return {...diff,name:q?.name||p?.name||'',price,value,basis,pnl:basis!==null&&value!==null?value-basis:null,
        pnlPercent:basis!==null&&value!==null?(value-basis)/basis*100:null,
        quoteTime:usable?q.quoteTime:'',source:usable?q.source:'',stale:usable&&age>180000,
        costStatus:basis!==null?'帳本加權成本（含已記錄費稅）':incomplete?'買賣／費稅紀錄待核對':'股數／成本待核對',
        industry:p?.industry||'',supported};
    });
    const held=rows.filter(r=>r.quantity>0), valued=held.filter(r=>r.value!==null), total=valued.reduce((n,r)=>n+r.value,0);
    rows.forEach(r=>r.weight=total>0&&r.value!==null?r.value/total*100:null);
    const costed=held.filter(r=>r.basis!==null&&r.value!==null);
    const sectors=new Map();valued.forEach(r=>{const k=r.industry||'未分類';sectors.set(k,(sectors.get(k)||0)+r.value);});
    const warnings=[];
    if(rows.some(r=>r.status!=='一致'))warnings.push(`${rows.filter(r=>r.status!=='一致').length} 檔帳本／券商部位尚未核對一致，請查看核對狀態。`);
    if(!confirmed)warnings.push('請先確認券商帳號與財務帳戶對應，才會計算成本及損益。');
    if(now-Date.parse(snapshot.queriedAt)>300000)warnings.push('庫存快照超過 5 分鐘，請重新查詢富邦。');
    if(valued.length<held.length)warnings.push(`${held.length-valued.length} 檔庫存無法估值；比例僅按可估值部位計算。`);
    if(costed.length<held.length)warnings.push(`${held.length-costed.length} 檔庫存的成本／股數待核對，未納入損益。`);
    held.filter(r=>r.weight!==null&&r.weight>=limit).forEach(r=>warnings.push(`${r.code} 占可估值部位 ${r.weight.toFixed(1)}%，達集中度檢查門檻 ${limit}%。`));
    if(held.some(r=>r.stale))warnings.push('部分行情超過 180 秒，僅供參考估值，不代表即時成交價。');
    warnings.push('此總覽範圍為選定富邦帳戶的普通股庫存；零股／信用交易需另外核對，其他券商、美股、基金與現金未納入比例。');
    warnings.push('未分類產業不作集中度判斷；ETF 成分與重疊曝險尚無資料，不能據此判定已充分分散。');
    return {rows,total:valued.length?total:null,held:held.length,valued:valued.length,costed:costed.length,
      basis:costed.length?costed.reduce((n,r)=>n+r.basis,0):null,pnl:costed.length?costed.reduce((n,r)=>n+r.pnl,0):null,
      sectors:[...sectors],warnings};
  }
  function render(target,snapshot,bundle,account,confirmed,quotes) {
    let limit=30;
    const draw=()=>{
      const a=analyze(snapshot,bundle,account,confirmed,quotes,Date.now(),limit);
      target.innerHTML=`<h3>真實持股總覽與風險檢查</h3><p>庫存快照：${esc(new Date(snapshot.queriedAt).toLocaleString('zh-TW'))}｜${esc(snapshot.account)}｜帳戶：${esc(account||'尚未對應')}</p>
      <div class="four-col grid"><div>可估值市值（TWD）<strong class="money-value">${money(a.total)}</strong></div><div>已核對部位成本<strong class="money-value">${money(a.basis)}</strong></div><div>已核對部位未實現損益<strong class="money-value">${money(a.pnl)}</strong></div><div>資料覆蓋<strong>${a.valued}/${a.held} 檔可估值；${a.costed} 檔可計算損益</strong></div></div>
      <p>集中度檢查門檻 <select aria-label="集中度檢查門檻">${[20,30,40,50].map(n=>`<option value="${n}" ${n===limit?'selected':''}>${n}%</option>`).join('')}</select>。比例依可估值市值計算，損益尚未扣除未來賣出費稅。</p>
      <div style="overflow:auto"><table><thead><tr><th>標的</th><th>券商／帳本股數</th><th>參考行情／時間</th><th>市值／比例</th><th>成本／損益</th><th>核對狀態</th></tr></thead><tbody>${a.rows.map(r=>`<tr><td>${esc(r.code)} ${esc(r.name)}</td><td>${r.quantity}／${r.book}</td><td>${r.price===null?'缺少行情':esc(r.price)}<br>${esc(r.quoteTime?new Date(r.quoteTime).toLocaleString('zh-TW'):'')}<br>${esc(r.source)} ${r.stale?'（過期參考價）':''}</td><td>${money(r.value)}<br>${r.weight===null?'—':r.weight.toFixed(1)+'%'}</td><td>${money(r.basis)}／${money(r.pnl)}<br>${r.pnlPercent===null?'—':r.pnlPercent.toFixed(2)+'%'}</td><td>${esc(r.status)}<br>${esc(r.costStatus)}</td></tr>`).join('')}</tbody></table></div>
      ${a.rows.length?'':'<p>快照沒有回傳持股；空清單不代表帳本與券商對帳已通過。</p>'}<h4>風險與資料待辦</h4><ul>${a.warnings.map(r=>`<li>${esc(r)}</li>`).join('')}</ul><p>產業配置：${a.sectors.map(([k,v])=>`${esc(k)} ${money(v)} TWD`).join('；')||'尚無可估值資料'}</p>`;
      target.querySelector('select').onchange=e=>{limit=Number(e.target.value);draw();};
    };draw();
  }
  window.FubonPortfolio={analyze,render};
})();
