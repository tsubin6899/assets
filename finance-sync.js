(function () {
  "use strict";

  const KEY = "tsubin-finance-sync-state-v1";
  const EMPTY = { outbox: [], phase: "idle", lastSyncedAt: "", lastRemoteUpdatedAt: "", lastError: "", retryCount: 0 };

  function read() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      return saved && typeof saved === "object" ? { ...EMPTY, ...saved, outbox: Array.isArray(saved.outbox) ? saved.outbox : [] } : { ...EMPTY };
    } catch { return { ...EMPTY }; }
  }
  function write(next) {
    const state = { ...EMPTY, ...next, outbox: (next.outbox || []).slice(-20) };
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
  function label(state = read()) {
    if (state.phase === "syncing") return "同步中";
    if (state.phase === "error") return "同步失敗";
    if (state.outbox.length) return `${state.outbox.length} 項待同步`;
    if (state.lastSyncedAt) return "已同步";
    return "尚未同步";
  }

  window.FinanceSync = Object.freeze({ KEY, read, enqueue, markSyncing, markSynced, markError, hasPending, label });
})();
