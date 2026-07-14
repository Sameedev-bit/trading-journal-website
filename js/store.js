/* TradeHarbor persistence layer — localStorage, seeding, sweeps, sim jobs */
window.TH = window.TH || {};
TH.store = (function () {
  'use strict';

  var VERSION = 1;
  var PREFIX = 'th:v' + VERSION + ':';
  var ENTITIES = ['meta', 'settings', 'accounts', 'connections', 'trades',
    'strategies', 'tags', 'prep', 'subscriptions', 'expenses', 'jobs'];
  var cache = {};

  function key(entity) { return PREFIX + entity; }

  function readRaw(entity) {
    try {
      var raw = localStorage.getItem(key(entity));
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('TH.store: failed to parse', entity, err);
      return null;
    }
  }

  function get(entity) {
    if (!(entity in cache)) cache[entity] = readRaw(entity);
    return cache[entity];
  }

  function isQuotaError(err) {
    return err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014);
  }

  function save(entity, data) {
    cache[entity] = data;
    try {
      localStorage.setItem(key(entity), JSON.stringify(data));
      return { ok: true };
    } catch (err) {
      var msg = isQuotaError(err)
        ? 'Browser storage is full — remove some screenshots to free space.'
        : 'Could not save data (' + (err && err.name) + ').';
      if (TH.ui && TH.ui.toast) TH.ui.toast(msg, 'err');
      return { ok: false, error: err };
    }
  }

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- seeding / reset ---------- */
  function seedAll() {
    var data = TH.seed.generate();
    ENTITIES.forEach(function (e) {
      if (e === 'meta') return;
      save(e, data[e] !== undefined ? data[e] : []);
    });
    save('meta', { schemaVersion: VERSION, seededAt: new Date().toISOString(), lastRenewalSweep: null });
  }

  function resetToDemo() {
    var doomed = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('th:') === 0) doomed.push(k);
    }
    doomed.forEach(function (k) { localStorage.removeItem(k); });
    cache = {};
    seedAll();
  }

  /* ---------- auto-renew sweep (Expenses feature) ----------
     Any auto-renew subscription whose renewal date has passed generates one
     expense record per elapsed cycle, then its next-renewal date advances.
     Deduped on subscriptionId+dateKey so re-running is always safe. */
  function renewalSweep() {
    var meta = get('meta');
    var today = TH.calc.todayKey();
    if (!meta || meta.lastRenewalSweep === today) return 0;
    var subs = get('subscriptions') || [];
    var expenses = get('expenses') || [];
    var created = 0;
    subs.forEach(function (s) {
      if (!s.autoRenew || !s.nextRenewal) return;
      var guard = 0;
      while (s.nextRenewal <= today && guard++ < 80) {
        var dupe = expenses.some(function (e) { return e.subscriptionId === s.id && e.dateKey === s.nextRenewal; });
        if (!dupe) {
          expenses.push({
            id: newId('exp'), name: s.name, amount: s.amount,
            dateKey: s.nextRenewal, category: s.category, subscriptionId: s.id
          });
          created++;
        }
        s.nextRenewal = TH.calc.advanceCycle(s.nextRenewal, s.cycle);
      }
    });
    if (created > 0) { save('expenses', expenses); save('subscriptions', subs); }
    meta.lastRenewalSweep = today;
    save('meta', meta);
    return created;
  }

  /* ---------- stale sim-job sweep ----------
     Timers die with the page; any job still marked running on load is
     fast-forwarded to completion so history never shows a stuck job. */
  function staleJobSweep() {
    var jobs = get('jobs') || [];
    var swept = 0;
    jobs.forEach(function (job) {
      if (job.status !== 'running') return;
      finishJob(job);
      swept++;
    });
    if (swept) save('jobs', jobs);
    return swept;
  }

  function finishJob(job) {
    var connections = get('connections') || [];
    var accounts = get('accounts') || [];
    var conn = connections.filter(function (c) { return c.id === job.connectionId; })[0];
    if (!conn) { job.status = 'failed'; job.error = 'Connection no longer exists.'; job.finishedAt = new Date().toISOString(); return; }
    if (job.kind === 'import' && Math.random() < 0.1) {
      job.status = 'failed';
      job.error = 'Broker rate limit hit — try this range again in a few minutes.';
      job.progress = 100;
      job.finishedAt = new Date().toISOString();
      return;
    }
    var trades = get('trades') || [];
    var existingIds = {};
    trades.forEach(function (t) { if (t.brokerTradeId) existingIds[t.brokerTradeId] = true; });
    var fresh = TH.seed.generateSyncedTrades(conn, accounts, job.range, job.countHint)
      .filter(function (t) { return !existingIds[t.brokerTradeId]; });
    trades = trades.concat(fresh);
    save('trades', trades);

    var nowIso = new Date().toISOString();
    conn.lastSyncAt = nowIso;
    accounts.forEach(function (a) { if (a.connectionId === conn.id) a.lastSyncAt = nowIso; });
    save('connections', connections);
    save('accounts', accounts);

    job.status = 'done';
    job.progress = 100;
    job.resultCount = fresh.length;
    job.finishedAt = nowIso;
  }

  /* Simulated async job engine (broker sync + older-trade imports).
     Progress persists on every tick so a mid-job reload is recoverable. */
  function startJob(opts) {
    var jobs = get('jobs') || [];
    var job = {
      id: newId('job'),
      connectionId: opts.connectionId,
      kind: opts.kind || 'sync', // 'sync' | 'import'
      range: opts.range,
      countHint: opts.countHint || null,
      status: 'running',
      progress: 0,
      resultCount: 0,
      error: null,
      createdAt: new Date().toISOString(),
      finishedAt: null
    };
    jobs.unshift(job);
    if (jobs.length > 25) jobs.length = 25;
    save('jobs', jobs);

    var timer = setInterval(function () {
      job.progress = Math.min(96, job.progress + 6 + Math.random() * 14);
      if (job.progress >= 96) {
        clearInterval(timer);
        finishJob(job);
      }
      save('jobs', jobs);
      if (opts.onTick) opts.onTick(job);
      if (job.status !== 'running' && opts.onDone) opts.onDone(job);
    }, 320);
    return job;
  }

  /* ---------- screenshots (per-trade keys for quota isolation) ---------- */
  function shotKey(tradeId) { return PREFIX + 'shots:' + tradeId; }
  function getShots(tradeId) {
    try {
      var raw = localStorage.getItem(shotKey(tradeId));
      return raw ? JSON.parse(raw) : [];
    } catch (err) { return []; }
  }
  function saveShots(tradeId, shots) {
    try {
      if (!shots || !shots.length) localStorage.removeItem(shotKey(tradeId));
      else localStorage.setItem(shotKey(tradeId), JSON.stringify(shots));
      return { ok: true };
    } catch (err) {
      if (TH.ui && TH.ui.toast) {
        TH.ui.toast(isQuotaError(err)
          ? 'Storage is full — this screenshot could not be saved.'
          : 'Could not save screenshot.', 'err');
      }
      return { ok: false, error: err };
    }
  }

  /* ---------- typed helpers ---------- */
  function getTrade(id) {
    return (get('trades') || []).filter(function (t) { return t.id === id; })[0] || null;
  }
  function saveTrade(trade) {
    var trades = get('trades') || [];
    var i = trades.findIndex(function (t) { return t.id === trade.id; });
    if (i === -1) trades.push(trade); else trades[i] = trade;
    return save('trades', trades);
  }
  function deleteTrade(id) {
    var trades = (get('trades') || []).filter(function (t) { return t.id !== id; });
    save('trades', trades);
    try { localStorage.removeItem(shotKey(id)); } catch (err) { /* noop */ }
  }

  /* ---------- init ---------- */
  var initialized = false;
  var initInfo = null;
  function init() {
    if (initialized) return initInfo;
    initialized = true;
    var meta = get('meta');
    if (!meta || !meta.schemaVersion) seedAll();
    // future migrations run here, keyed off meta.schemaVersion
    initInfo = {
      renewed: renewalSweep(),
      staleJobs: staleJobSweep()
    };
    return initInfo;
  }

  return {
    init: init, get: get, save: save, newId: newId,
    resetToDemo: resetToDemo,
    startJob: startJob,
    getShots: getShots, saveShots: saveShots,
    getTrade: getTrade, saveTrade: saveTrade, deleteTrade: deleteTrade
  };
})();
