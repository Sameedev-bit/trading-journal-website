/* TradeHarbor cloud sync — Supabase auth + per-entity last-write-wins sync.
   Runs only when js/cloud-config.js has real values; otherwise the app is
   pure local mode and every function here degrades to a harmless no-op. */
window.TH = window.TH || {};
TH.cloud = (function () {
  'use strict';

  var META_KEY = 'th:cloud';           // {lastSync:{entity:iso}, dirty:[entity]}
  var PUSH_DEBOUNCE_MS = 1500;

  var client = null;
  var user = null;
  var status = 'unconfigured';          // unconfigured|signedOut|syncing|synced|offline|error
  var statusDetail = '';
  var listeners = [];
  var pushTimer = null;
  var booted = false;

  function configured() {
    return !!(window.TH_CLOUD && TH_CLOUD.url && TH_CLOUD.anonKey && window.supabase);
  }

  /* ---------- status plumbing ---------- */
  function setStatus(s, detail) {
    status = s;
    statusDetail = detail || '';
    listeners.forEach(function (cb) {
      try { cb(s, statusDetail); } catch (err) { /* listener errors are theirs */ }
    });
  }
  function onStatus(cb) {
    listeners.push(cb);
    cb(status, statusDetail);
  }

  /* ---------- sync bookkeeping ---------- */
  function meta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || { lastSync: {}, dirty: [] }; }
    catch (err) { return { lastSync: {}, dirty: [] }; }
  }
  function saveMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (err) { /* quota — sync meta is rebuildable */ }
  }
  function markDirty(entity) {
    var m = meta();
    if (m.dirty.indexOf(entity) === -1) {
      m.dirty.push(entity);
      saveMeta(m);
    }
    if (user) schedulePush();
  }
  function hasEverSynced() {
    return Object.keys(meta().lastSync).length > 0;
  }

  /* every syncable entity currently in local storage */
  function localEntities() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf('th:v1:') !== 0) continue;
      out.push(k.slice('th:v1:'.length)); // 'trades', 'meta', 'shots:t-abc', …
    }
    return out;
  }
  function readLocal(entity) {
    try { return JSON.parse(localStorage.getItem('th:v1:' + entity)); }
    catch (err) { return null; }
  }
  function writeLocal(entity, data) {
    try {
      if (data === null || data === undefined) localStorage.removeItem('th:v1:' + entity);
      else localStorage.setItem('th:v1:' + entity, JSON.stringify(data));
    } catch (err) { /* quota — surfaced by normal store paths */ }
    if (TH.store && TH.store.invalidate) TH.store.invalidate(entity);
  }

  /* ---------- push ---------- */
  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushDirty(); }, PUSH_DEBOUNCE_MS);
  }

  function pushEntities(entities) {
    if (!client || !user || !entities.length) return Promise.resolve(0);
    var now = new Date().toISOString();
    var rows = entities.map(function (e) {
      var data = readLocal(e);
      return { user_id: user.id, entity: e, data: data === null ? { __removed: true } : data, updated_at: now };
    });
    setStatus('syncing');
    return client.from('journal_data').upsert(rows).then(function (res) {
      if (res.error) throw res.error;
      var m = meta();
      entities.forEach(function (e) {
        m.lastSync[e] = now;
        var i = m.dirty.indexOf(e);
        if (i !== -1) m.dirty.splice(i, 1);
      });
      saveMeta(m);
      setStatus('synced', 'Last sync ' + new Date().toLocaleTimeString());
      return entities.length;
    }).catch(function (err) {
      setStatus(navigator.onLine === false ? 'offline' : 'error', err && err.message);
      return 0;
    });
  }

  function pushDirty() {
    return pushEntities(meta().dirty.slice());
  }
  function pushAll() {
    return pushEntities(localEntities());
  }

  /* ---------- pull ---------- */
  function fetchRemote() {
    return client.from('journal_data')
      .select('entity,data,updated_at')
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  }

  function applyRemoteRows(rows) {
    var m = meta();
    rows.forEach(function (row) {
      if (row.data && row.data.__removed) writeLocal(row.entity, null);
      else writeLocal(row.entity, row.data);
      m.lastSync[row.entity] = row.updated_at;
      var i = m.dirty.indexOf(row.entity);
      if (i !== -1) m.dirty.splice(i, 1);
    });
    saveMeta(m);
  }

  /* incremental sync: remote-newer rows win unless locally dirty (then local wins) */
  function syncNow() {
    if (!client || !user) return Promise.resolve();
    setStatus('syncing');
    return fetchRemote().then(function (rows) {
      var m = meta();
      var apply = rows.filter(function (row) {
        var seen = m.lastSync[row.entity];
        var newer = !seen || row.updated_at > seen;
        var dirty = m.dirty.indexOf(row.entity) !== -1;
        return newer && !dirty;
      });
      applyRemoteRows(apply);
      return pushDirty().then(function () {
        setStatus('synced', 'Last sync ' + new Date().toLocaleTimeString());
        return { pulled: apply.length };
      });
    }).catch(function (err) {
      setStatus(navigator.onLine === false ? 'offline' : 'error', err && err.message);
      return { pulled: 0, error: err };
    });
  }

  /* replace this browser's journal with the account copy, then reload */
  function adoptRemote() {
    return fetchRemote().then(function (rows) {
      // wipe local journal (keep theme + cloud meta)
      localEntities().forEach(function (e) { writeLocal(e, null); });
      saveMeta({ lastSync: {}, dirty: [] });
      applyRemoteRows(rows.filter(function (r) { return !(r.data && r.data.__removed); }));
      location.reload();
    });
  }

  /* first-login decision: empty cloud → upload local; cloud has data → ask */
  function reconcileOnLogin() {
    return fetchRemote().then(function (rows) {
      var live = rows.filter(function (r) { return !(r.data && r.data.__removed); });
      if (!live.length) {
        return pushAll().then(function (n) {
          if (n && TH.ui) TH.ui.toast('Journal uploaded to your account — it now follows you across devices');
        });
      }
      if (hasEverSynced()) return syncNow();
      // both sides have data and this browser never synced → user decides
      if (!TH.ui) return syncNow();
      TH.ui.modal({
        title: 'This account already has a journal',
        dismissable: false,
        body: '<p style="color:var(--text-soft)">Your account has journal data in the cloud, and this browser has its own local journal. Which one should win?</p>',
        actions: [
          {
            label: 'Use my account data (recommended)', kind: 'primary',
            onClick: function () { adoptRemote(); }
          },
          {
            label: 'Replace account with this browser', kind: 'danger',
            onClick: function () {
              pushAll().then(function () { TH.ui.toast('Account journal replaced with this browser’s data'); });
            }
          }
        ]
      });
    }).catch(function (err) {
      setStatus('error', err && err.message);
    });
  }

  /* ---------- auth ---------- */
  function signInWithEmail(email) {
    if (!client) return Promise.reject(new Error('Cloud is not configured.'));
    return client.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: location.href.split('#')[0] }
    }).then(function (res) {
      if (res.error) throw res.error;
      return true;
    });
  }
  function signInWithGoogle() {
    if (!client) return Promise.reject(new Error('Cloud is not configured.'));
    return client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.href.split('#')[0] }
    }).then(function (res) {
      if (res.error) throw res.error;
    });
  }
  function signOut() {
    if (!client) return Promise.resolve();
    return client.auth.signOut().then(function () {
      user = null;
      setStatus('signedOut');
    });
  }
  function deleteCloudCopy() {
    if (!client || !user) return Promise.reject(new Error('Not signed in.'));
    return client.from('journal_data').delete().eq('user_id', user.id).then(function (res) {
      if (res.error) throw res.error;
      saveMeta({ lastSync: {}, dirty: [] });
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    if (booted) return;
    booted = true;
    if (!configured()) { setStatus('unconfigured'); return; }
    try {
      client = supabase.createClient(TH_CLOUD.url, TH_CLOUD.anonKey);
    } catch (err) {
      setStatus('error', 'Bad cloud configuration: ' + err.message);
      return;
    }
    setStatus('signedOut');

    client.auth.onAuthStateChange(function (event, session) {
      var previously = !!user;
      user = session ? session.user : null;
      if (user && !previously) {
        if (event === 'SIGNED_IN' && !hasEverSynced()) reconcileOnLogin();
        else syncNow();
      }
      if (!user) setStatus('signedOut');
      listeners.forEach(function (cb) { try { cb(status, statusDetail); } catch (e) { /* noop */ } });
    });

    window.addEventListener('online', function () { if (user) syncNow(); });
    window.addEventListener('offline', function () { if (user) setStatus('offline'); });
    // best-effort flush when leaving the page
    window.addEventListener('pagehide', function () {
      if (user && meta().dirty.length) pushDirty();
    });

    // store notifies us about every save (registered lazily — store loads first)
    if (TH.store && TH.store.onChange) TH.store.onChange(markDirty);
  }

  return {
    boot: boot,
    configured: configured,
    onStatus: onStatus,
    getStatus: function () { return { status: status, detail: statusDetail }; },
    getUser: function () { return user; },
    signInWithEmail: signInWithEmail,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    syncNow: syncNow,
    pushAll: pushAll,
    adoptRemote: adoptRemote,
    deleteCloudCopy: deleteCloudCopy,
    _internals: { meta: meta, markDirty: markDirty, localEntities: localEntities } // for tests
  };
})();
