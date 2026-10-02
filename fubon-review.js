(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paper = r => /^(AI-)?PAPER-/.test(r.brokerFillId || '') || r.externalSource === 'auto-trading-center';
  const enumName = v => String(v || '').split('.').pop();
  const positive = v => Number.isFinite(Number(v)) && Number(v) > 0;
  const date = v => String(v || '').replaceAll('/', '-');
  function validSnapshot(snapshot) {
    if (snapshot?.mode !== 'READ_ONLY_PREVIEW' || !/^[a-f0-9]{24}$/.test(snapshot.accountRef || '') ||
        !Array.isArray(snapshot.fills) || !Array.isArray(snapshot.holdings) || !Number.isFinite(Date.parse(snapshot.queriedAt)))
      throw new Error('富邦預覽格式不完整，請重新查詢');
  }
  function accountValid(ledger, account) {
    return ledger.accounts.filter(r => r.name === account && r.currency === 'TWD' && r.type !== '信用卡').length === 1;
  }
  function preview(snapshot, bundle, account) {
    validSnapshot(snapshot);
    const records = bundle.assets.purchaseRecords.filter(r => !paper(r));
    const seen = new Set(records.map(r => r.brokerFillId).filter(Boolean));
    return snapshot.fills.map(raw => {
      const direction = enumName(raw.buy_sell), type = direction === 'Buy' ? 'buy' : direction === 'Sell' ? 'sell' : '';
      const fill = {brokerFillId: `FUBON-${snapshot.accountRef}-${date(raw.date)}-${raw.order_no}-${raw.filled_no}`,
        brokerOrderId: raw.order_no, date: date(raw.date), code: String(raw.stock_no || ''),
        type, market: 'TW', currency: 'TWD', shares: Number(raw.filled_qty), price: Number(raw.filled_price),
        filledAt: `${date(raw.date)}T${raw.filled_time}`, source:'fubon-readonly', cashAccount: account};
      let status = '待補費稅';
      if (!type || enumName(raw.order_type) !== 'Stock' || !raw.filled_no || !raw.order_no ||
          !/^\d{4}-\d{2}-\d{2}$/.test(fill.date) || !positive(fill.shares) || !Number.isInteger(fill.shares) || !positive(fill.price)) status = '資料／交易類型待人工處理';
      else if (seen.has(fill.brokerFillId)) status = '已記帳';
      else if (records.some(r => r.cashAccount === account && r.code === fill.code && r.type === type && r.date === fill.date &&
          Number(r.shares) === fill.shares && Number(r.price) === fill.price)) status = '疑似已有手動紀錄';
      if (status !== '已記帳' && seen.has(fill.brokerFillId)) status = '重複成交';
      seen.add(fill.brokerFillId);
      return {fill, status};
    });
  }
  function reconcile(snapshot, bundle, account, confirmed) {
    validSnapshot(snapshot);
    const stale = Date.now() - Date.parse(snapshot.queriedAt) > 5*60*1000 || Date.parse(snapshot.queriedAt) > Date.now()+5000;
    const totals = new Map(), broker = new Map(), uncertain = new Set();
    const today = window.FinanceCore.localDate();
    bundle.assets.purchaseRecords.filter(r => r.cashAccount === account && r.market === 'TW' && !paper(r) && r.date <= today).forEach(r => {
      const shares = Number(r.shares);
      if (!Number.isFinite(shares) || !['buy','sell'].includes(r.type)) uncertain.add(r.code);
      else totals.set(r.code, (totals.get(r.code)||0)+(r.type === 'sell' ? -shares : shares));
    });
    snapshot.holdings.forEach(r => {
      if (enumName(r.type) !== 'Stock' || !Number.isFinite(Number(r.quantity)) || Number(r.oddQuantity) !== 0) uncertain.add(r.code);
      if (broker.has(r.code)) uncertain.add(r.code);
      broker.set(r.code, Number(r.quantity));
    });
    return [...new Set([...totals.keys(), ...broker.keys()])].map(code => {
      const book = totals.get(code)||0, quantity = broker.get(code)||0;
      const status = !confirmed || !accountValid(bundle.ledger, account) ? '待確認帳號對應' : stale ? '快照過期，請重新查詢'
        : uncertain.has(code) ? '零股／融資融券口徑待核對' : book < 0 ? '帳本缺少買進紀錄'
        : book === quantity ? '一致' : quantity === 0 ? '帳本有持股，券商未回傳' : book === 0 ? '券商有持股，帳本未記錄' : '股數差異';
      return {code, book, quantity, difference: quantity-book, status};
    });
  }
  function importSelected(snapshot, selections, account, confirmed) {
    if (!confirmed) throw new Error('請確認券商帳號與財務帳戶對應');
    const core = window.FinanceCore, bundle = core.load();
    if (!accountValid(bundle.ledger, account)) throw new Error('請選擇唯一的台幣現金帳戶');
    const rows = preview(snapshot, bundle, account), available = new Map(rows.map(r => [r.fill.brokerFillId,r]));
    const ids = new Set(), fills = selections.map(selection => {
      const row = available.get(selection.id);
      if (!row || row.status !== '待補費稅' || ids.has(selection.id)) throw new Error('成交已記帳、疑似重複或不可匯入，請重新核對');
      ids.add(selection.id);
      if (selection.fee === '' || selection.tax === '' || !Number.isFinite(Number(selection.fee)) || !Number.isFinite(Number(selection.tax)) ||
          Number(selection.fee)<0 || Number(selection.tax)<0) throw new Error('每筆須填入已核對的手續費與交易稅（可為 0）');
      if (core.isMonthClosed(row.fill.date.slice(0,7))) throw new Error('成交月份已關帳，請先核對並重新開帳');
      return {...row.fill,fee:Number(selection.fee),tax:Number(selection.tax),note:'富邦成交預覽確認匯入；費稅人工核對'};
    });
    if (!fills.length) throw new Error('請勾選要匯入的成交');
    return core.importBrokerFills({mode:'LIVE',fills});
  }
  let snapshot = null, quotes = {}, chosenAccount='', accountConfirmed=false, importMessage='';
  function decorate(app, state) {
    if (state.domain !== 'investments' || !['portfolio','trades','holdings'].includes(state.tab)) return;
    const section = document.createElement('section'); section.className='panel'; section.id='fubonReview'; section.style.marginTop='16px';
    section.innerHTML=`<h3>富邦持股對帳與成交匯入預覽</h3><p>先在 <a href="http://127.0.0.1:8810/" target="_blank" rel="noopener">交易中心</a> 查詢富邦，再載入快照。此處使用目前財務帳本；不會自動修改股數。</p>
      <button type="button" class="action-btn" id="fubonLoad">載入最新富邦快照</button>
      <label>財務帳戶<select id="fubonAccount"><option value="">請選擇對應帳戶</option>${window.FinanceCore.load().ledger.accounts.filter(r=>r.currency==='TWD'&&r.type!=='信用卡').map(r=>`<option>${esc(r.name)}</option>`).join('')}</select></label>
      <label><input type="checkbox" id="fubonConfirmed">我已核對券商遮罩帳號與此財務帳戶的對應</label>
      <p id="fubonReviewMessage"></p><section id="fubonPortfolio" style="margin:16px 0"></section><div id="fubonReviewRows"></div>`;
    app.append(section);
    section.querySelector('#fubonAccount').value=chosenAccount;
    section.querySelector('#fubonConfirmed').checked=accountConfirmed;
    const render = () => {
      const message=section.querySelector('#fubonReviewMessage'), target=section.querySelector('#fubonReviewRows');
      if (!snapshot) return;
      const account=section.querySelector('#fubonAccount').value, confirmed=section.querySelector('#fubonConfirmed').checked;
      message.textContent=`券商 ${snapshot.account}｜查詢 ${new Date(snapshot.queriedAt).toLocaleString('zh-TW')}｜成交 ${snapshot.startDate}～${snapshot.endDate}。手動持倉未指定券商，需另行核對；零股與信用交易不判定一致。`;
      const bundle=window.FinanceCore.load(); window.FubonPortfolio?.render(section.querySelector('#fubonPortfolio'),snapshot,bundle,account,confirmed,quotes); const diffs=reconcile(snapshot,bundle,account,confirmed), rows=preview(snapshot,bundle,account);
      target.innerHTML=`<h4>持股核對</h4><div style="overflow:auto"><table><thead><tr><th>代號</th><th>帳本</th><th>券商一般股數</th><th>差額</th><th>結果</th></tr></thead><tbody>${diffs.map(r=>`<tr><td>${esc(r.code)}</td><td>${r.book}</td><td>${r.quantity}</td><td>${r.difference}</td><td>${esc(r.status)}</td></tr>`).join('')}</tbody></table></div>${diffs.length?'':'<p>目前沒有可核對持股；空清單不代表帳戶對帳已通過。</p>'}
        <h4>成交匯入預覽</h4><p>勾選後填入實際費稅；疑似手動紀錄請先在交易管理核對，不自動重複匯入。</p>
        <form id="fubonImport"><div style="overflow:auto"><table><thead><tr><th>選取</th><th>成交</th><th>股數 × 價格</th><th>狀態</th><th>手續費</th><th>交易稅</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td><input type="checkbox" data-select="${i}" ${r.status==='待補費稅'?'':'disabled'}></td><td>${esc(r.fill.date)} ${esc(r.fill.code)} ${esc(r.fill.type)}</td><td>${r.fill.shares} × ${r.fill.price}</td><td>${esc(r.status)}</td><td><input aria-label="手續費 ${esc(r.fill.code)}" data-fee="${i}" type="number" min="0" step="0.01" style="width:90px"></td><td><input aria-label="交易稅 ${esc(r.fill.code)}" data-tax="${i}" type="number" min="0" step="0.01" style="width:90px"></td></tr>`).join('')}</tbody></table></div><p id="fubonImportMessage" role="status" aria-live="polite">${esc(!rows.length?`此快照在 ${snapshot.startDate}～${snapshot.endDate} 沒有回傳成交資料，無法匯入。這與目前有沒有持股無關。請在交易中心確認成交查詢期間與結果，再重新載入快照；庫存快照不會補回歷史買進紀錄。`:importMessage||'請勾選成交並填妥實際費稅，再匯入。')}</p><button class="action-btn" type="submit" ${rows.some(r=>r.status==='待補費稅')?'':'disabled'}>${rows.length?'確認費稅並匯入勾選成交':'此快照無成交可匯入'}</button></form>`;
      target.querySelector('form').onsubmit=e=>{e.preventDefault();try{
        const selections=rows.flatMap((r,i)=>target.querySelector(`[data-select="${i}"]`).checked?[{id:r.fill.brokerFillId,fee:target.querySelector(`[data-fee="${i}"]`).value,tax:target.querySelector(`[data-tax="${i}"]`).value}]:[]);
        const result=importSelected(snapshot,selections,account,confirmed);importMessage=`已匯入 ${result.imported||0} 筆成交；請回交易紀錄核對。`;window.dispatchEvent(new CustomEvent('finance-broker-fills-imported',{detail:result}));
      }catch(error){target.querySelector('#fubonImportMessage').textContent=error.message;}};
    };
    section.querySelector('#fubonLoad').onclick=async()=>{try{
      const response=await fetch(new URL('../auto_trading/data/fubon-preview.json',location.href),{cache:'no-store'});
      if(!response.ok)throw new Error('沒有本機快照，請先在交易中心重新查詢；雲端頁面可使用下方檔案載入');
      const value=await response.json();validSnapshot(value);if(snapshot?.accountRef!==value.accountRef){accountConfirmed=false;section.querySelector('#fubonConfirmed').checked=false;}snapshot=value;importMessage='';quotes={};try { const q=await fetch(new URL('../auto_trading/data/quotes.json',location.href),{cache:'no-store'}); if(q.ok) quotes=(await q.json()).quotes||{}; } catch {} render();
    }catch(error){section.querySelector('#fubonReviewMessage').textContent=error.message;}};
    const input=document.createElement('input');input.type='file';input.accept='.json';input.setAttribute('aria-label','載入交易中心下載的富邦預覽 JSON');section.querySelector('#fubonLoad').after(input);
    input.onchange=async()=>{try{const value=JSON.parse(await input.files[0].text());validSnapshot(value);if(snapshot?.accountRef!==value.accountRef){accountConfirmed=false;section.querySelector('#fubonConfirmed').checked=false;}snapshot=value;importMessage='';quotes={};render();}catch(error){section.querySelector('#fubonReviewMessage').textContent=error.message;}};
    section.querySelector('#fubonAccount').onchange=()=>{chosenAccount=section.querySelector('#fubonAccount').value;accountConfirmed=false;section.querySelector('#fubonConfirmed').checked=false;render();};
    section.querySelector('#fubonConfirmed').onchange=()=>{accountConfirmed=section.querySelector('#fubonConfirmed').checked;render();};
    render();
  }
  window.FubonReview={preview,reconcile,importSelected,decorate};
})();
