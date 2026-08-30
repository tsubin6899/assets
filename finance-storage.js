(function () {
  "use strict";

  const DB_NAME = "tsubin-finance-center";
  const DB_VERSION = 1;
  const STORE = "revisions";
  let databasePromise = null;
  let saveTimer = 0;

  function supported() { return typeof indexedDB !== "undefined"; }
  function open() {
    if (!supported()) return Promise.reject(new Error("此瀏覽器不支援 IndexedDB"));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath:"id", autoIncrement:true });
          store.createIndex("createdAt", "createdAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("無法開啟本機資料庫"));
    });
    return databasePromise;
  }

  async function prune(db, keep = 20) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const request = store.openCursor(null, "prev");
      let index = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        index += 1;
        if (index > keep) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function save(bundle = window.FinanceCore?.exportBundle(), reason = "自動鏡像") {
    if (!supported() || !bundle) return false;
    const db = await open();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).add({ createdAt:new Date().toISOString(), reason, schemaVersion:bundle.schemaVersion, updatedAt:bundle.updatedAt, data:bundle });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    await prune(db);
    window.dispatchEvent(new CustomEvent("finance-storage-status"));
    return true;
  }

  async function revisions(limit = 20) {
    if (!supported()) return [];
    const db = await open();
    return new Promise((resolve, reject) => {
      const rows = [];
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).openCursor(null, "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= limit) { resolve(rows); return; }
        const { data, ...meta } = cursor.value;
        rows.push(meta);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function restore(id) {
    const db = await open();
    const row = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(Number(id));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!row?.data) throw new Error("找不到本機歷史版本");
    window.FinanceCore.importBundle(row.data);
    return row;
  }

  function schedule(reason = "資料更新") {
    if (!supported()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(window.FinanceCore.exportBundle(), reason).catch(() => {}), 600);
  }

  function init() {
    if (!supported() || !window.FinanceCore) return false;
    window.addEventListener("finance-core-change", event => schedule(event.detail?.reason || "資料更新"));
    schedule("啟動鏡像");
    return true;
  }

  window.FinanceStorage = Object.freeze({ supported, init, save, revisions, restore });
})();
