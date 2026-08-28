(function () {
  "use strict";

  const DATA_FILES = {
    prices: "latest-prices.json",
    rates: "latest-rates.json",
    valuations: "latest-valuations.json"
  };
  const state = { busy: false, phase: "idle", message: "", lastResult: null };

  function isHttp() { return location.protocol === "http:" || location.protocol === "https:"; }
  function wait(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
  function stamp(payload) {
    return [payload?.prices?.generatedAt || "", payload?.rates?.generatedAt || "", payload?.valuations?.generatedAt || ""].join("|");
  }
  function notify(phase, message, detail = {}) {
    Object.assign(state, { phase, message, ...detail });
    window.dispatchEvent(new CustomEvent("finance-market-status", { detail: { ...state } }));
  }
  async function requestJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function fetchLatest() {
    if (!isHttp()) throw new Error("本機檔案模式無法讀取行情資料");
    const token = Date.now();
    const [prices, rates, valuations] = await Promise.all([
      requestJson(`${DATA_FILES.prices}?ts=${token}`, { cache: "no-store" }),
      requestJson(`${DATA_FILES.rates}?ts=${token}`, { cache: "no-store" }).catch(() => ({})),
      requestJson(`${DATA_FILES.valuations}?ts=${token}`, { cache: "no-store" }).catch(() => ({}))
    ]);
    return { prices, rates, valuations };
  }
  function apply(payload) {
    if (!window.FinanceCore?.applyMarketSnapshot) throw new Error("財務核心尚未載入");
    const result = FinanceCore.applyMarketSnapshot(payload);
    state.lastResult = result;
    return result;
  }
  async function loadLatest({ silent = false } = {}) {
    if (!isHttp()) return { skipped: true };
    if (!silent) notify("loading", "正在讀取最新行情…");
    try {
      const result = apply(await fetchLatest());
      if (!silent) notify("ready", result.unchanged ? "行情已是最新版本" : `已更新 ${result.pricesUpdated} 筆股價、${result.ratesUpdated} 個匯率`, { lastResult: result });
      return result;
    } catch (error) {
      if (!silent) notify("error", error.message || "讀取行情失敗");
      throw error;
    }
  }
  function updateEndpoint() {
    return window.MARKET_DATA_UPDATE_ENDPOINT
      || document.querySelector('meta[name="market-data-update-endpoint"]')?.content
      || "/.netlify/functions/trigger-price-update";
  }
  async function postUpdate(url, symbols) {
    return requestJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(symbols)
    });
  }
  async function waitForFresh(previousStamp) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await wait(4000);
      const payload = await fetchLatest();
      if (!previousStamp || stamp(payload) !== previousStamp) return payload;
    }
    return null;
  }
  async function refresh() {
    if (state.busy) return state.lastResult || { busy: true };
    if (!isHttp()) throw new Error("請從網站版執行行情更新");
    state.busy = true;
    notify("triggering", "正在更新股價與匯率…", { busy: true });
    try {
      const before = await fetchLatest().catch(() => null);
      const symbols = FinanceCore.marketSymbols();
      let immediate = false;
      try {
        await postUpdate("/api/update-prices", symbols);
        immediate = true;
      } catch {
        await postUpdate(updateEndpoint(), symbols);
      }
      notify("waiting", immediate ? "正在套用最新行情…" : "更新已送出，正在等待市場資料…", { busy: true });
      const payload = immediate ? await fetchLatest() : await waitForFresh(before ? stamp(before) : "");
      if (!payload) {
        const fallback = before ? apply(before) : { pricesUpdated: 0, ratesUpdated: 0, pending: true };
        notify("pending", "更新已送出，稍後可再按一次讀取最新資料", { busy: false, lastResult: fallback });
        return fallback;
      }
      const result = apply(payload);
      notify("ready", `行情完成：${result.pricesUpdated} 筆股價、${result.ratesUpdated} 個匯率`, { busy: false, lastResult: result });
      return result;
    } catch (error) {
      notify("error", error.message || "行情更新失敗", { busy: false });
      throw error;
    } finally {
      state.busy = false;
    }
  }

  window.FinanceMarket = Object.freeze({ fetchLatest, loadLatest, refresh, stamp, state });
})();
