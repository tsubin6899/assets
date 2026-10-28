(function(){
 'use strict';
 const key='tsubin-finance-workflow-preferences-v1',esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const tracked='#quickEntryForm,#tradeForm,#holdingForm,#accountForm,#transferForm,#dividendForm,#creditBillForm,#budgetForm,#recurringForm,#installmentForm,#loanForm,#goalForm,#reconcileForm,#annualPlanForm,#decisionJournalForm';
 const drafts=new Map();
 let host,savedAt='',reason='',recoveryBundle=null,beforeDeletion=null,submitting=null,marketDismissed=false,lastReport;
 function preferences(){try{const p=JSON.parse(localStorage.getItem(key)||'{}');return p&&typeof p==='object'?p:{}}catch{return {}}}
 function remember(values){try{localStorage.setItem(key,JSON.stringify({...preferences(),...values}))}catch{/* Optional preferences must not prevent saving financial data. */}}
 function filter(){const f=preferences().filter||{};return Object.fromEntries(['code','start','end','type'].map(k=>[k,typeof f[k]==='string'?f[k]:'']));}
 function capture(form){if(!form?.matches(tracked))return;drafts.set(form.getAttribute('id'),{id:form.getAttribute('id'),values:[...new FormData(form)],open:[...form.querySelectorAll('details')].map(e=>e.open)});feedback();}
 function blockingDraftIds(){return [...drafts.values()].filter(d=>d.id!=='quickEntryForm'||new Map(d.values).get('id')).map(d=>d.id);}
 function leave(){const blocking=blockingDraftIds();if(!blocking.length)return true;if(!confirm('這個表單有尚未儲存的修改。確定放棄修改並離開？'))return false;blocking.forEach(id=>drafts.delete(id));feedback();return true;}
 function isEditing(){return !submitting&&Boolean(document.activeElement?.closest(tracked)||[...drafts.keys()].some(id=>document.getElementById(id)));}
 function saved(id){drafts.delete(id);feedback();}
 function decorate(root){
  const form=root.querySelector('#tradeForm'),p=preferences().trade||{};
  if(form&&!form.elements.id.value){for(const name of ['market','currency','cashAccount']){const field=form.elements[name],value=p[name];if(field&&typeof value==='string'&&[...field.options].some(o=>o.value===value))field.value=value;}if(p.market&&!p.currency)form.elements.currency.value=['US','USD_FUND'].includes(form.elements.market.value)?'USD':'TWD';}
  for(const draft of drafts.values()){const form=root.querySelector('#'+draft.id);if(form){const values=new Map(draft.values);for(const field of form.elements){if(!field.name||field.type==='file'||field.type==='submit')continue;if(field.type==='checkbox'||field.type==='radio')field.checked=draft.values.some(([k,v])=>k===field.name&&v===field.value);else if(values.has(field.name))field.value=values.get(field.name);}form.querySelectorAll('details').forEach((e,i)=>{e.open=Boolean(draft.open[i])});}}
  feedback();marketFeedback();
 }
 function feedback(){const node=document.getElementById('saveFeedback');if(!node)return;node.hidden=Boolean(document.getElementById('quickEntryForm'))||(!savedAt&&!drafts.size);if(node.hidden)return;const sync=window.FinanceSync?.read()||{},status=document.getElementById('cloudStatus'),synced=sync.lastSyncedAt&&sync.lastSyncedAt>=savedAt&&!sync.outbox?.length&&!['error','review','syncing'].includes(sync.phase);const message=drafts.size?'尚有未儲存修改；請先完成表單。':synced?'已儲存在本機，並已同步雲端。':document.getElementById('cloudLogout')?.hidden!==false?'已儲存在本機；登入後可同步雲端。':sync.phase==='error'?'已儲存在本機；雲端同步失敗，請至工具檢查。':'已儲存在本機；等待雲端同步。';node.innerHTML=`<span>${esc(message)} ${drafts.size?'':esc(reason)}</span>${recoveryBundle?`<button class="action-btn" data-workflow-restore>預覽刪除前版本</button><small>還原會先比較整份版本差異，確認後才套用。</small>`:''}`;}
 function marketFeedback(){const node=document.getElementById('marketFeedback'),state=window.FinanceMarket?.state||{},r=state.report;if(!node)return;if(r!==lastReport){lastReport=r;marketDismissed=false;}node.hidden=!r||marketDismissed;if(node.hidden)return;const labels={complete:'行情檢查完成',cached:'已讀取可取得行情；正在要求新報價',pending:'背景更新尚未完成；以下為目前可取得行情',error:'本次更新要求失敗；以下為已讀取行情'};node.innerHTML=`<div><strong>${esc(labels[r.status]||state.message)}</strong><p>檢查 ${r.checked} 檔｜價格更新 ${r.changed} 檔（含首次取得）｜維持原價 ${r.same} 檔｜未取得 ${r.failed} 檔</p><small>檢查時間：${esc(host.dateTime(r.checkedAt))}｜資料產出：${esc(host.dateTime(r.dataAt)||'無時間紀錄')}。包含持股、交易歷史與觀察清單；價格未變不代表更新失敗。</small>${r.failed?`<details><summary>查看未取得項目</summary>${r.items.filter(i=>i.status==='failed').map(i=>`<p>${esc(i.key)}：${esc(i.reason)}</p>`).join('')}</details>`:''}${r.status==='error'?`<p class="negative">${esc(state.message)}</p>`:''}</div><button class="action-btn" type="button" data-dismiss-market>收合結果</button>`;}
 function updateEntryViewport(){const editing=document.activeElement?.matches('#quickEntryForm input,#quickEntryForm select,#quickEntryForm textarea'),height=window.visualViewport?.height||innerHeight;document.body.classList.toggle('compact-entry-viewport',Boolean(editing&&height<600));}
 function init(callbacks){host=callbacks;
  document.addEventListener('focusin',updateEntryViewport);document.addEventListener('focusout',updateEntryViewport);window.addEventListener('resize',updateEntryViewport);window.visualViewport?.addEventListener('resize',updateEntryViewport);
  document.addEventListener('input',e=>{const f=e.target.closest('form');if(f?.matches(tracked))capture(f)});
  document.addEventListener('change',e=>{const f=e.target.closest('form');if(f?.matches(tracked)){capture(f);if(f.getAttribute('id')==='tradeForm'&&!f.elements.id.value)remember({trade:{market:f.elements.market.value,currency:f.elements.currency.value,cashAccount:f.elements.cashAccount.value}});}});
  document.addEventListener('submit',e=>{submitting=e.target;setTimeout(()=>{submitting=null},0)},true);
  document.addEventListener('click',e=>{if(e.target.closest('[data-dismiss-market]')){marketDismissed=true;marketFeedback();}const b=e.target.closest('button');if(b&&[...b.attributes].some(a=>a.name.startsWith('data-delete-'))){beforeDeletion=FinanceCore.exportBundle();setTimeout(()=>{beforeDeletion=null},0)}if(b?.hasAttribute('data-workflow-restore')){if(!leave())return;window.FinanceIntelligenceUI.restore(recoveryBundle,'刪除前版本預覽').catch(error=>host.toast(error.message));return;}if(drafts.size&&b&&[...b.attributes].some(a=>/^data-(edit|cancel)-/.test(a.name))){if(!leave()){e.preventDefault();e.stopImmediatePropagation();}}},true);
  window.addEventListener('beforeunload',e=>{if(blockingDraftIds().length){e.preventDefault();e.returnValue='';}});
  window.addEventListener('finance-core-change',e=>{if(/行情|市場/.test(e.detail?.reason||''))return;savedAt=e.detail?.updatedAt||new Date().toISOString();reason=e.detail?.reason||'';if(submitting)drafts.delete(submitting.getAttribute('id'));if(/刪除/.test(reason)&&beforeDeletion)recoveryBundle=beforeDeletion;if(!/刪除/.test(reason))recoveryBundle=null;feedback();});
  ['finance-sync-status','finance-storage-status'].forEach(type=>window.addEventListener(type,feedback));window.addEventListener('finance-market-status',marketFeedback);
 }
 window.FinanceWorkflow={preferences,remember,filter,decorate,leave,isEditing,saved,init};
})();

