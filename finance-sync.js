(function () {
  "use strict";

  const KEY = "tsubin-finance-sync-state-v1";
  const EMPTY = { outbox: [], phase: "idle", lastSyncedAt: "", lastRemoteUpdatedAt: "", lastError: "", retryCount: 0, remoteVersions: [] };

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
  function markSyncing() { const state = read(); return write({ ...state, phase: "syncing", lastError: "" }); }
  function markSynced({ remoteUpdatedAt = "" } = {}) {
    const state = read();
    return write({ ...state, phase: "synced", outbox: [], lastSyncedAt: new Date().toISOString(), lastRemoteUpdatedAt: remoteUpdatedAt, lastError: "", retryCount: 0 });
  }
  function markError(error) {
    const state = read();
    return write({ ...state, phase: "error", lastError: String(error?.message || error || "同步失敗"), retryCount: Number(state.retryCount || 0) + 1 });
  }
  function hasPending() { return read().outbox.length > 0; }
  function setRemoteVersions(versions = []) { const state=read();return write({ ...state, remoteVersions:versions.map(({ data, ...meta })=>meta).slice(0,5) }); }

  const LEDGER_COLLECTIONS = ["entries","transfers","accounts","creditBills","creditInstallments","templates","recurringRules","budgets","reconciliations","creditStatementChecks","loans","goals","annualPlans"];
  const ASSET_COLLECTIONS = ["tw","us","cash","cards","gold","silver","funds","usdFunds","purchaseRecords","dividends","assetSnapshots"];
  function clone(value) { return JSON.parse(JSON.stringify(value || {})); }
  function recordKey(row, index) { return String(row?.id || [row?.date,row?.name,row?.code,row?.account,row?.amount,index].join("|")); }
  function recordTime(row) { return new Date(row?.updatedAt || row?.createdAt || row?.checkedAt || row?.date || 0).getTime() || 0; }
  function compareCollection(localRows = [], remoteRows = []) {
    const localMap=new Map(localRows.map((row,index)=>[recordKey(row,index),row])),remoteMap=new Map(remoteRows.map((row,index)=>[recordKey(row,index),row]));
    let localOnly=0,remoteOnly=0,conflicts=0,same=0;
    new Set([...localMap.keys(),...remoteMap.keys()]).forEach(key=>{const local=localMap.get(key),remote=remoteMap.get(key);if(!remote)localOnly+=1;else if(!local)remoteOnly+=1;else if(JSON.stringify(local)===JSON.stringify(remote))same+=1;else conflicts+=1});
    return { localOnly, remoteOnly, conflicts, same };
  }
  function compareBundles(localBundle = {}, remoteBundle = {}) {
    const localLedger=localBundle.ledger||localBundle.accountingLedger||{},remoteLedger=remoteBundle.ledger||remoteBundle.accountingLedger||{},localAssets=localBundle.assets||localBundle,remoteAssets=remoteBundle.assets||remoteBundle;
    const details=[];
    LEDGER_COLLECTIONS.forEach(key=>{const row=compareCollection(localLedger[key],remoteLedger[key]);if(row.localOnly||row.remoteOnly||row.conflicts)details.push({scope:"ledger",collection:key,...row})});
    ASSET_COLLECTIONS.forEach(key=>{const row=compareCollection(localAssets[key],remoteAssets[key]);if(row.localOnly||row.remoteOnly||row.conflicts)details.push({scope:"assets",collection:key,...row})});
    return details.reduce((result,row)=>({localOnly:result.localOnly+row.localOnly,remoteOnly:result.remoteOnly+row.remoteOnly,conflicts:result.conflicts+row.conflicts,details}),{localOnly:0,remoteOnly:0,conflicts:0,details});
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
    LEDGER_COLLECTIONS.forEach(key=>{ledger[key]=mergeCollection(localLedger[key],remoteLedger[key])});
    ASSET_COLLECTIONS.forEach(key=>{assets[key]=mergeCollection(localAssets[key],remoteAssets[key])});
    ledger.categories={income:[...new Set([...(remoteLedger.categories?.income||[]),...(localLedger.categories?.income||[])])],expense:[...new Set([...(remoteLedger.categories?.expense||[]),...(localLedger.categories?.expense||[])])]};
    ledger.items={...(remoteLedger.items||{}),...(localLedger.items||{})};
    return { ledger, assets };
  }
  function label(state = read()) {
    if (state.phase === "syncing") return "同步中";
    if (state.phase === "error") return "同步失敗";
    if (state.outbox.length) return `${state.outbox.length} 項待同步`;
    if (state.lastSyncedAt) return "已同步";
    return "尚未同步";
  }

  window.FinanceSync = Object.freeze({ KEY, read, enqueue, markSyncing, markSynced, markError, hasPending, setRemoteVersions, compareBundles, mergeBundles, label });
})();
