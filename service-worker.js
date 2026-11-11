const CACHE_NAME = "tsubin-finance-center-v227";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./finance-center.html",
  "./island-art/cozy/accounts.webp",
  "./island-art/cozy/analysis.webp",
  "./island-art/cozy/daily.webp",
  "./island-art/cozy/dog-steps.webp",
  "./island-art/cozy/duck-steps.webp",
  "./island-art/cozy/fish.webp",
  "./island-art/cozy/home.webp",
  "./island-art/cozy/home-desktop.webp",
  "./island-art/cozy/swimmer-frames.webp",
  "./island-art/cozy/gardener-frames.webp",
  "./island-art/cozy/potter-frames.webp",
  "./island-art/cozy/lookout-frames.webp",
  "./island-art/cozy/vendor-frames.webp",
  "./island-art/cozy/balloon-turn.webp",
  "./island-art/cozy/balloon-blue-turn.webp",
  "./island-art/cozy/cloud-drift.webp",
  "./island-art/cozy/investments.webp",
  "./island-art/cozy/planning.webp",
  "./island-art/cozy/rabbit-steps.webp",
  "./island-art/cozy/traveler-steps.webp",
  "./combined-dashboard.html",
  "./market-data-config.js",
  "./finance-center-routes.js",
  "./finance-core.js",
  "./finance-intelligence.js",
  "./finance-intelligence-ui.js",
  "./finance-upgrades.js",
  "./finance-storage.js",
  "./finance-market.js",
  "./finance-sync.js",
  "./finance-experience.js",
  "./finance-workflow.js",
  "./finance-charts.js",
  "./finance-trade-sync.js",
  "./fubon-review.js",
  "./investment-operations.js",
  "./portfolio-lab.js",
  "./investment-cards.js",
  "./investment-cards.css",
  "./security-names.js",
  "./finance-notifications.js",
  "./finance-search.js",
  "./finance-import.js",
  "./manifest.webmanifest",
  "./latest-prices.json",
  "./latest-rates.json",
  "./latest-valuations.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener('push',event=>{
  let payload={};try{payload=event.data?.json()||{}}catch{}
  event.waitUntil(self.registration.showNotification(payload.title||'繳款提醒',{body:payload.body||'請開啟個人財務中心確認待繳帳單',tag:payload.tag||'finance-payment-reminder',icon:'./icons/icon-192.png',data:{url:'./finance-center.html#accounts/credit'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const url=new URL('./finance-center.html#accounts/credit',self.location.href).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{const existing=windows.find(w=>new URL(w.url).origin===self.location.origin);if(existing){await existing.navigate(url);return existing.focus();}return clients.openWindow(url);}));
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('tsubin-finance-center-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.includes("/api/") || url.pathname.includes("/auto_trading/data/")) return;
  if (url.pathname.endsWith("/latest-prices.json") || url.pathname.endsWith("/latest-rates.json") || url.pathname.endsWith("/latest-valuations.json")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request,{ignoreSearch:true}).then(async cached => cached || (event.request.mode==='navigate'?await caches.match('./finance-center.html'):null) || Response.error()))
  );
});
