/* TradeHarbor service worker — offline app shell.
   Bump CACHE_VERSION whenever site files change so clients pick up the update. */
var CACHE_VERSION = 'th-v3.0.0';
var SHELL = [
  './',
  './index.html',
  './legal.html',
  './privacy.html',
  './terms.html',
  './manifest.webmanifest',
  './css/tokens.css', './css/base.css', './css/app.css', './css/landing.css',
  './js/vendor/supabase.js', './js/cloud-config.js', './js/cloud.js',
  './js/seed-data.js', './js/store.js', './js/calc.js', './js/ui.js', './js/charts.js',
  './js/pages/stats.js', './js/pages/insights.js', './js/pages/trades.js',
  './js/pages/trade-review.js', './js/pages/prep-review.js', './js/pages/strategy.js',
  './js/pages/compliance.js', './js/pages/report.js', './js/pages/expenses.js',
  './js/pages/manual-entry.js', './js/pages/brokers.js', './js/pages/accounts.js',
  './js/pages/account.js',
  './app/stats.html', './app/insights.html', './app/trades.html', './app/trade-review.html',
  './app/prep-review.html', './app/strategy.html', './app/compliance.html', './app/report.html',
  './app/expenses.html', './app/manual-entry.html', './app/brokers.html', './app/accounts.html',
  './app/account.html',
  './assets/logo.svg', './assets/favicon.svg', './assets/icon-192.png', './assets/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // best-effort: a single missing file must not break install
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { /* skip */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // never intercept cross-origin (e.g. Supabase API) requests
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    // pages: network first (fresh content), cache fallback (offline)
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./app/stats.html');
        });
      })
    );
    return;
  }

  // static assets: cache first, then network (and backfill the cache)
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
