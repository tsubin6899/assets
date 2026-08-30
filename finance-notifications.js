(function () {
  "use strict";

  const KEY = "tsubin-finance-notification-state-v1";
  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; } }
  function write(value) { localStorage.setItem(KEY, JSON.stringify(value)); return value; }
  function supported() { return typeof Notification !== "undefined"; }

  async function request() {
    if (!supported()) throw new Error("此瀏覽器不支援系統通知");
    const permission = await Notification.requestPermission();
    write({ ...read(), enabled:permission === "granted", permission, updatedAt:new Date().toISOString() });
    return permission;
  }

  function check(alerts = []) {
    if (!supported() || Notification.permission !== "granted") return 0;
    const state = read();
    const today = new Date().toISOString().slice(0, 10);
    if (state.lastNotifiedDate === today) return 0;
    const rows = alerts.filter(row => ["danger", "warning"].includes(row.level)).slice(0, 3);
    rows.forEach(row => new Notification(row.title || "個人財務提醒", { body:row.detail || "請開啟個人財務中心查看", tag:`tsubin-${row.title}` }));
    write({ ...state, enabled:true, permission:"granted", lastNotifiedDate:today, updatedAt:new Date().toISOString() });
    return rows.length;
  }

  function status() { const state=read();return { supported:supported(), permission:supported()?Notification.permission:"unsupported", enabled:Boolean(state.enabled) }; }
  window.FinanceNotifications = Object.freeze({ supported, request, check, status });
})();
