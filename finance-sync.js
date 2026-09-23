(function () {
  "use strict";

  const KEY = "tsubin-finance-sync-state-v1";
  const EMPTY = { outbox: [], phase: "idle", lastSyncedAt: "", lastRemoteUpdatedAt: "", lastError: "", retryCount: 0, remoteVersions: [], lastComparison:null };

  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      return saved && typeof saved === "object" ? { ...EMPTY, ...saved, outbox: Array.isArray(saved.outbox) ? saved.outbox : [], remoteVersions:Array.isArray(saved.remoteVersions)?saved.remoteVersions:[] } : { ...EMPTY };
    } catch { return { ...EMPTY }; }
  }
  function write(next) {
    const state = { ...EMPTY, ...next, outbox: (next.outbox || []).slice(-50), remoteVersions:(next.remoteVersions || []).slice(0, 5) };
    localStorage.setItem(KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("finance-sync-status", { detail: state }));
    return state;
  }
  function enqueue(change = {}) {
    const reason = String(change.reason || "財務資料更新");
    if (/財務中心啟動/.test(reason)) return read();
    const state = read();
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, reason, updatedAt: change.updatedAt || new Date().toISOString() };
    return write({ ...state, phase: "pending", lastError: "", outbox: [...state.outbox, item] });
  }
  function markSyncing() { const state = read(); return write({ ...state, phase: "syncing", inFlightIds:state.outbox.map(row=>row.id), lastError: "" }); }
  function markSynced({ remoteUpdatedAt = "", comparison = null, acknowledgedIds } = {}) {
    const state = read();
    const sent=new Set(acknowledgedIds || state.inFlightIds || []),outbox=state.outbox.filter(row=>!sent.has(row.id));
    return write({ ...state, phase: outbox.length?"pending":"synced", outbox, inFlightIds:[], lastSyncedAt: new Date().toISOString(), lastRemoteUpdatedAt: remoteUpdatedAt, lastComparison:comparison || state.lastComparison, lastError: "", retryCount: 0 });
  }
  function markError(error) {
    const state = read();
    return write({ ...state, phase: "error", lastError: String(error?.message || error || "同步失敗"), retryCount: Number(state.retryCount || 0) + 1 });
  }
  function hasPending() { return read().outbox.length > 0; }
  function markReview(message) { const state=read();return write({...state,phase:"review",lastError:String(message),inFlightIds:[]}); }
  function setRemoteVersions(versions = []) { const state=read();return write({ ...state, remoteVersions:versions.map(({ data, ...meta })=>meta).slice(0,5) }); }

  const LEDGER_COLLECTIONS = ["entries","transfers","accounts","creditBills","creditInstallments","templates","recurringRules","budgets","reconciliations","creditStatementChecks","loans","loanPayments","goals","goalAllocationHistory","importTemplates","importReconciliations","annualPlans","monthCloseouts","categoryRules"];
  const ASSET_COLLECTIONS = ["tw","us","cash","cards","gold","silver","funds","usdFunds","purchaseRecords","dividends","assetSnapshots","financialSnapshots"];
  const RECYCLE_KIND_BY_COLLECTION = { entries:"entry", transfers:"transfer", accounts:"account", creditBills:"creditBill", creditInstallments:"installment", templates:"template", recurringRules:"recurring", budgets:"budget", reconciliations:"reconciliation", creditStatementChecks:"creditStatementCheck", loans:"loan",goals:"goal",loanPayments:"loanPayment",importReconciliations:"importReconciliation" };
  function clone(value) { return JSON.parse(JSON.stringify(value || {})); }
  function stable(value) { if(Array.isArray(value))return value.map(stable);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value; }
  function equalData(a,b) { return JSON.stringify(stable(a))===JSON.stringify(stable(b)); }
  function recordKey(row, index) { return String(row?.id || row?.month || row?.year || [row?.date,row?.name,row?.code,row?.account,row?.amount,index].join("|")); }
  function recordTime(row) {
    const nested=[...Object.values(row?.statementChecks||{}).map(value=>value?.checkedAt),...Object.values(row?.statementExclusions||{}).map(value=>value?.excludedAt)];
    return Math.max(0,...[row?.updatedAt,row?.reconciledAt,row?.paidAt,row?.capturedAt,row?.createdAt,row?.checkedAt,row?.date,...nested].map(value=>new Date(value||0).getTime()||0));
  }
  function compareCollection(localRows = [], remoteRows = []) {
    const localMap=new Map(localRows.map((row,index)=>[recordKey(row,index),row])),remoteMap=new Map(remoteRows.map((row,index)=>[recordKey(row,index),row]));
    let localOnly=0,remoteOnly=0,localNewer=0,remoteNewer=0,conflicts=0,same=0;
    new Set([...localMap.keys(),...remoteMap.keys()]).forEach(key=>{const local=localMap.get(key),remote=remoteMap.get(key);if(!remote)localOnly+=1;else if(!local)remoteOnly+=1;else if(equalData(local,remote))same+=1;else{const lt=recordTime(local),rt=recordTime(remote);if(lt>rt)localNewer+=1;else if(rt>lt)remoteNewer+=1;else conflicts+=1;}});
    return { localOnly, remoteOnly, localNewer, remoteNewer, conflicts, same };
  }
  function compareBundles(localBundle = {}, remoteBundle = {}) {
    const localLedger=localBundle.ledger||localBundle.accountingLedger||{},remoteLedger=remoteBundle.ledger||remoteBundle.accountingLedger||{},localAssets=localBundle.assets||localBundle,remoteAssets=remoteBundle.assets||remoteBundle;
    const details=[];
    LEDGER_COLLECTIONS.forEach(key=>{const row=compareCollection(localLedger[key],remoteLedger[key]);if(row.localOnly||row.remoteOnly||row.localNewer||row.remoteNewer||row.conflicts)details.push({scope:"ledger",collection:key,...row})});
    ASSET_COLLECTIONS.forEach(key=>{const row=compareCollection(localAssets[key],remoteAssets[key]);if(row.localOnly||row.remoteOnly||row.localNewer||row.remoteNewer||row.conflicts)details.push({scope:"assets",collection:key,...row})});
    const safelyMerged={ledger:new Set(["categories","items"]),assets:new Set(["fxHistory","fxRates","rates","marketPrices","marketDataMeta","valuationCache"])};
    for(const scope of ["ledger","assets"]){const a=scope==="ledger"?localLedger:localAssets,b=scope==="ledger"?remoteLedger:remoteAssets;for(const key of new Set([...Object.keys(a),...Object.keys(b)])){if(["updatedAt","auditJournal","version"].includes(key)||safelyMerged[scope].has(key)||Array.isArray(a[key])||Array.isArray(b[key]))continue;if(!equalData(a[key],b[key]))details.push({scope,collection:key,localOnly:0,remoteOnly:0,localNewer:0,remoteNewer:0,conflicts:1,same:0});}}
    return details.reduce((result,row)=>({localOnly:result.localOnly+row.localOnly,remoteOnly:result.remoteOnly+row.remoteOnly,localNewer:result.localNewer+(row.localNewer||0),remoteNewer:result.remoteNewer+(row.remoteNewer||0),conflicts:result.conflicts+row.conflicts,details}),{localOnly:0,remoteOnly:0,localNewer:0,remoteNewer:0,conflicts:0,details});
  }
  function mergeCollection(localRows = [], remoteRows = []) {
    const merged=new Map();
    remoteRows.forEach((row,index)=>merged.set(recordKey(row,index),clone(row)));
    localRows.forEach((row,index)=>{const key=recordKey(row,index),remote=merged.get(key);if(!remote||recordTime(row)>=recordTime(remote))merged.set(key,clone(row))});
    return [...merged.values()];
  }
  function mergeBundles(localBundle = {}, remoteBundle = {}) {
    const localLedger=clone(localBundle.ledger||localBundle.accountingLedger||{}),remoteLedger=clone(remoteBundle.ledger||remoteBundle.accountingLedger||{}),localAssets=clone(localBundle.assets||localBundle),remoteAssets=clone(remoteBundle.assets||remoteBundle);
    const ledger={...remoteLedger,...localLedger},assets={...remoteAssets,...localAssets};
    const localPayments=localLedger.loanPayments||[],remotePayments=remoteLedger.loanPayments||[];
    const localNew=localPayments.filter(p=>!remotePayments.some(r=>r.id===p.id)),remoteNew=remotePayments.filter(p=>!localPayments.some(r=>r.id===p.id));
    if(localNew.some(p=>remoteNew.some(r=>r.loanId===p.loanId)))throw new Error("同一貸款在兩端各有新增還款，無法安全合併本金；請先匯出備份並核對兩端還款紀錄");
    // Deletions are data too. Without these tombstones, an older cloud copy can
    // resurrect a transfer or entry that was deliberately removed on this device.
    ledger.recycleBin=mergeCollection(localLedger.recycleBin,remoteLedger.recycleBin);
    const deletedIds=new Set(ledger.recycleBin.map(row=>`${row.kind}:${row.row?.id||""}`).filter(value=>!value.endsWith(":")));
    LEDGER_COLLECTIONS.forEach(key=>{
      const kind=RECYCLE_KIND_BY_COLLECTION[key];
      ledger[key]=mergeCollection(localLedger[key],remoteLedger[key]).filter(row=>!kind||!deletedIds.has(`${kind}:${row.id||""}`));
    });
    // A stale device may still carry the generated fee after its parent was deleted.
    ledger.entries=ledger.entries.filter(row=>!(row.isForeignTransactionFee&&row.derivedFromEntryId&&deletedIds.has(`entry:${row.derivedFromEntryId}`)));
    ASSET_COLLECTIONS.forEach(key=>{assets[key]=mergeCollection(localAssets[key],remoteAssets[key]).filter(row=>key!=="purchaseRecords"||!deletedIds.has(`purchase:${row.id||""}`))});
    // Older asset and ledger arrays are still present in saved cloud bundles.
    // Empty defaults on a newer device must not erase those remote records.
    for(const [result,local,remote,handled] of [
      [ledger,localLedger,remoteLedger,new Set([...LEDGER_COLLECTIONS,"recycleBin","auditJournal"])],
      [assets,localAssets,remoteAssets,new Set([...ASSET_COLLECTIONS,"auditJournal"])]
    ]){
      for(const key of new Set([...Object.keys(local),...Object.keys(remote)])){
        if(handled.has(key)||!Array.isArray(local[key])&&!Array.isArray(remote[key]))continue;
        const left=Array.isArray(local[key])?local[key]:[],right=Array.isArray(remote[key])?remote[key]:[];
        if(!left.length)result[key]=clone(right);
        else if(!right.length||equalData(left,right))result[key]=clone(left);
        else throw new Error(`舊版資料 ${key} 在本機與雲端皆有不同內容，請先核對後再同步`);
      }
    }
    assets.fxHistory={...(remoteAssets.fxHistory||{}),...(localAssets.fxHistory||{})};
    for(const date of Object.keys(assets.fxHistory))assets.fxHistory[date]={...(remoteAssets.fxHistory?.[date]||{}),...(localAssets.fxHistory?.[date]||{})};
    ledger.categories={income:[...new Set([...(remoteLedger.categories?.income||[]),...(localLedger.categories?.income||[])])],expense:[...new Set([...(remoteLedger.categories?.expense||[]),...(localLedger.categories?.expense||[])])]};
    ledger.items={...(remoteLedger.items||{}),...(localLedger.items||{})};
    return { ledger, assets };
  }
  function label(state = read()) {
    if (state.phase === "syncing") return "同步中";
    if (state.phase === "error") return "同步失敗";
    if (state.phase === "review") return "待確認差異";
    if (state.outbox.length) return `${state.outbox.length} 項待同步`;
    if (state.lastSyncedAt) return "已同步";
    return "尚未同步";
  }

  function fingerprint(bundle) { return JSON.stringify(stable({ledger:bundle.ledger,assets:bundle.assets})); }
  function diffBundles(before, after) {
    const rows=[];
    for(const scope of ["ledger","assets"]){const a=before[scope]||{},b=after[scope]||{};
      for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
        if(["auditJournal"].includes(key))continue;
        if(Array.isArray(a[key])||Array.isArray(b[key])){
          const left=new Map((Array.isArray(a[key])?a[key]:[]).map((r,i)=>[recordKey(r,i),r])),right=new Map((Array.isArray(b[key])?b[key]:[]).map((r,i)=>[recordKey(r,i),r]));
          for(const id of new Set([...left.keys(),...right.keys()])){const old=left.get(id),next=right.get(id);if(equalData(old,next))continue;rows.push({scope,collection:key,id,action:!old?"新增":!next?"刪除":"修改",before:old||null,after:next||null,title:next?.merchant||old?.merchant||next?.name||old?.name||next?.code||old?.code||id});}
        }else if(!equalData(a[key],b[key]))rows.push({scope,collection:key,id:key,action:"修改",before:a[key]??null,after:b[key]??null,title:key});
      }
    }
    return rows;
  }
  window.FinanceSync = Object.freeze({ KEY, read, enqueue, markSyncing, markSynced, markError, markReview, hasPending, setRemoteVersions, compareBundles, mergeBundles, diffBundles, fingerprint, label });
})();
