(function () {
  "use strict";

  const STATE_KEY = "tsubin-auto-trading-sync-v1";

  function writeState(value) {
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...value, checkedAt: new Date().toISOString() }));
  }

  async function syncBrokerFills() {
    if (!window.FinanceCore?.importBrokerFills || !location.protocol.startsWith("http")) return null;
    try {
      const url = new URL("../auto_trading/data/finance-fills.json", location.href);
      url.searchParams.set("ts", Date.now());
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        if (response.status !== 404) writeState({ phase: "error", message: `HTTP ${response.status}` });
        return null;
      }
      const payload = await response.json();
      if (payload.mode === 'PAPER' || payload.schemaVersion === 1) {
        localStorage.setItem('tsubin-paper-trading-preview', JSON.stringify(payload));
        writeState({ phase: 'paper-preview', message: '模擬成交僅供預覽，不計入真實資產', generatedAt: payload.generatedAt });
        let preview = document.getElementById('paperTradingPreview');
        if (!preview) { preview = document.createElement('p'); preview.id = 'paperTradingPreview'; document.body.append(preview); }
        preview.textContent = `PAPER 模擬成交 ${(payload.paperFills || payload.fills || []).length} 筆｜獨立預覽，不計入真實資產`;
        return { imported: 0, paper: true };
      }
      const result = window.FinanceCore.importBrokerFills(payload);
      writeState({ phase: "synced", generatedAt: payload.generatedAt || "", ...result });
      if (result.imported) window.dispatchEvent(new CustomEvent("finance-broker-fills-imported", { detail: result }));
      return result;
    } catch (error) {
      writeState({ phase: "error", message: error?.message || "券商成交同步失敗" });
      return null;
    }
  }

  window.FinanceTradeSync = { syncBrokerFills };
  window.addEventListener("load", () => setTimeout(syncBrokerFills, 500));
  window.addEventListener("focus", () => syncBrokerFills());
})();
