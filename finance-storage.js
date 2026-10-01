(function () {
  "use strict";

  const DB_NAME = "tsubin-finance-center";
  const DB_VERSION = 1;
  const STORE = "revisions";
  let databasePromise = null;
  let saveTimer = 0;
  const HEALTH_KEY='tsubin-finance-backup-health-v1';
  let memoryHealth={};
  function health(){try{return {...JSON.parse(localStorage.getItem(HEALTH_KEY)||'{}'),...memoryHealth}}catch{return memoryHealth}}
  function report(values){memoryHealth={...health(),...values};try{localStorage.setItem(HEALTH_KEY,JSON.stringify(memoryHealth))}catch{}window.dispatchEvent(new CustomEvent('finance-storage-status'));}
  function checksum(bundle){let hash=2166136261;for(const char of JSON.stringify(bundle)){hash=Math.imul(hash^char.charCodeAt(0),16777619)}return (hash>>>0).toString(16);}

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
    if (!supported() || !bundle){report({lastError:'此裝置無法建立本機鏡像'});return false;}
    try {
    const db = await open();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).add({ createdAt:new Date().toISOString(), reason, schemaVersion:bundle.schemaVersion, updatedAt:bundle.updatedAt, checksum:checksum(bundle), data:bundle });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    await prune(db);
    report({lastSavedAt:new Date().toISOString(),lastError:''});
    return true;
    }catch(error){report({lastError:error.message||'本機備份失敗'});throw error;}
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

  async function readRevision(id) {
    const db = await open();
    const row = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(Number(id));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!row?.data) throw new Error("找不到本機歷史版本");
    if(row.checksum&&row.checksum!==checksum(row.data))throw new Error('備份校驗不符，請勿還原此版本');
    return row;
  }
  async function restore(id) { const row=await readRevision(id);window.FinanceCore.importBundle(row.data);return row; }
  async function verify(id){
    try{
      const row=await readRevision(id);
      if(row.checksum&&row.checksum!==checksum(row.data))throw new Error('備份校驗不符，請勿還原此版本');
      if(!row.data.ledger||!row.data.assets||!Array.isArray(row.data.ledger.entries)||!Array.isArray(row.data.ledger.accounts))throw new Error('備份資料結構不完整');
      window.FinanceCore.previewBundle(row.data);
      const result={verifiedAt:new Date().toISOString(),verifiedId:row.id,verificationError:'',verification:row.checksum?'內容校驗與還原預覽通過':'舊版結構檢查通過（無校驗碼）'};report(result);return result;
    }catch(error){report({verificationError:error.message});throw error;}
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

  async function prepareLocalWrite() {
    if (!await save(window.FinanceCore.exportBundle(), '同步套用前備份'))
      throw new Error('無法保留本機備份，請先匯出完整存檔');
    const key = window.FinanceCore.KEYS.backups;
    const backups = JSON.parse(localStorage.getItem(key) || '[]');
    if (!backups.length) return;
    // Preserve every existing restore point in IndexedDB before reclaiming
    // the much smaller localStorage quota. Never remove transaction stores.
    for (const row of backups) {
      if (row.data && !await save(row.data, row.reason || '舊版本備份移轉'))
        throw new Error('無法保留本機備份，請先匯出完整存檔');
    }
    localStorage.removeItem(key);
  }

  window.FinanceStorage = Object.freeze({ supported, init, save, revisions, readRevision, restore, health, verify, checksum, prepareLocalWrite });
})();
