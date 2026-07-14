/* Broker Connections page — simulated sync, older-trade imports, job history */
(function () {
  'use strict';
  var ui, calc, store;
  var selectedId = null;

  var PROVIDER_LABEL = { tradovate: 'Tradovate', ninjatrader: 'NinjaTrader' };

  function connections() { return store.get('connections') || []; }
  function selected() {
    return connections().filter(function (c) { return c.id === selectedId; })[0] || connections()[0] || null;
  }
  function linkedAccounts(connId) {
    return (store.get('accounts') || []).filter(function (a) { return a.connectionId === connId; });
  }

  /* ---------- connection CRUD ---------- */
  function openAddConnection() {
    var body = ui.el('div', { class: 'form-grid' });
    body.innerHTML =
      '<label class="field"><span>Connection name</span><input type="text" id="cName" maxlength="40" placeholder="e.g. Tradovate — prop firm B"></label>' +
      '<label class="field"><span>Provider</span><select id="cProv"><option value="tradovate">Tradovate</option><option value="ninjatrader">NinjaTrader</option></select></label>' +
      '<label class="field"><span>Mode</span><select id="cMode"><option value="live">Live</option><option value="demo">Demo</option></select></label>' +
      '<p class="muted full" style="font-size:12px;margin:0">This demo runs fully in your browser — the connection is simulated, no real broker credentials are collected.</p>';
    ui.modal({
      title: 'Add broker connection',
      body: body,
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Connect', kind: 'primary',
          onClick: function (b) {
            var name = ui.qs('#cName', b).value.trim();
            if (!name) { ui.toast('Give the connection a name.', 'err'); return false; }
            var list = connections();
            list.push({
              id: store.newId('conn'), name: name,
              provider: ui.qs('#cProv', b).value, mode: ui.qs('#cMode', b).value,
              status: 'connected', lastSyncAt: null, createdAt: new Date().toISOString()
            });
            store.save('connections', list);
            selectedId = list[list.length - 1].id;
            ui.toast('Broker connected');
            rerender();
          }
        }
      ]
    });
  }

  function renameConnection(conn) {
    var body = ui.el('div', {}, [ui.el('label', { class: 'field' }, [
      ui.el('span', { text: 'Connection name' }),
      ui.el('input', { type: 'text', id: 'rnName', value: conn.name, maxlength: '40' })
    ])]);
    ui.modal({
      title: 'Rename connection',
      body: body,
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Save', kind: 'primary',
          onClick: function (b) {
            var v = ui.qs('#rnName', b).value.trim();
            if (!v) return false;
            var list = connections();
            list.filter(function (c) { return c.id === conn.id; })[0].name = v;
            store.save('connections', list);
            rerender();
          }
        }
      ]
    });
  }

  function toggleConnected(conn) {
    var list = connections();
    var c = list.filter(function (x) { return x.id === conn.id; })[0];
    c.status = c.status === 'connected' ? 'disconnected' : 'connected';
    store.save('connections', list);
    ui.toast(c.status === 'connected' ? 'Reconnected — syncs are available again' : 'Disconnected — no trades will sync until you reconnect');
    rerender();
  }

  function removeConnection(conn) {
    var linked = linkedAccounts(conn.id);
    if (linked.length) {
      ui.modal({
        title: 'Accounts still linked',
        body: '<p style="color:var(--text-soft)">' + linked.length + ' tracker account' + (linked.length === 1 ? ' is' : 's are') + ' still linked to <b>' + ui.esc(conn.name) + '</b>. Unlink them (Accounts page → edit → connection “None”) before removing the connection. Trade history always stays.</p>',
        actions: [{ label: 'Got it', kind: 'primary' }]
      });
      return;
    }
    ui.confirm({
      title: 'Remove connection?',
      message: '“' + conn.name + '” will be removed. Past synced trades stay in your journal.',
      okLabel: 'Remove', danger: true
    }).then(function (ok) {
      if (!ok) return;
      store.save('connections', connections().filter(function (c) { return c.id !== conn.id; }));
      selectedId = null;
      rerender();
      ui.toast('Connection removed');
    });
  }

  /* ---------- jobs ---------- */
  function runJob(conn, kind, range, countHint) {
    if (conn.status !== 'connected') {
      ui.toast('Reconnect this broker before syncing.', 'err');
      return;
    }
    store.startJob({
      connectionId: conn.id, kind: kind, range: range, countHint: countHint,
      onTick: function () { drawJobs(); },
      onDone: function (job) {
        if (job.status === 'done') ui.toast((kind === 'sync' ? 'Sync' : 'Import') + ' complete — ' + job.resultCount + ' new trade' + (job.resultCount === 1 ? '' : 's'));
        else ui.toast(job.error || 'Job failed', 'err');
        rerender();
      }
    });
    drawJobs();
    ui.toast(kind === 'sync' ? 'Sync started…' : 'Older-trade import started — it keeps running if you leave this page', 'info');
  }

  function suggestOlderRange(conn) {
    var accIds = linkedAccounts(conn.id).map(function (a) { return a.id; });
    var oldest = null;
    (store.get('trades') || []).forEach(function (t) {
      if (accIds.indexOf(t.accountId) === -1) return;
      if (!oldest || t.dateKey < oldest) oldest = t.dateKey;
    });
    var end = oldest ? calc.addDays(oldest, -1) : calc.todayKey();
    return { from: calc.addDays(end, -59), to: end };
  }

  function drawJobs() {
    var zone = ui.qs('#jobZone');
    if (!zone) return;
    zone.innerHTML = '';
    var jobs = store.get('jobs') || [];
    if (!jobs.length) {
      zone.appendChild(ui.el('p', { class: 'muted', style: 'font-size:13px;margin:0', text: 'No sync activity yet — run a sync or an older-trade import above.' }));
      return;
    }
    var connIdx = {};
    connections().forEach(function (c) { connIdx[c.id] = c; });
    jobs.slice(0, 8).forEach(function (job) {
      var conn = connIdx[job.connectionId];
      var row = ui.el('div', { class: 'rule-item', style: 'align-items:flex-start;flex-wrap:wrap' });
      var badge = job.status === 'running' ? '<span class="badge blue dot">Running</span>'
        : job.status === 'done' ? '<span class="badge green">Completed</span>'
          : '<span class="badge red">Failed</span>';
      var left = ui.el('div', { style: 'flex:1;min-width:220px' });
      left.innerHTML =
        '<div style="font-weight:700;font-size:13px">' + (job.kind === 'sync' ? 'Recent sync' : 'Older trade import') +
        ' <span class="muted" style="font-weight:500">· ' + (conn ? ui.esc(conn.name) : 'removed connection') + '</span></div>' +
        '<div class="muted" style="font-size:11px">' + calc.fmtDateKey(job.range.from) + ' → ' + calc.fmtDateKey(job.range.to) +
        ' · started ' + ui.relTime(job.createdAt) +
        (job.status === 'done' ? ' · ' + job.resultCount + ' new trade' + (job.resultCount === 1 ? '' : 's') : '') +
        (job.status === 'failed' ? ' · ' + ui.esc(job.error || '') : '') + '</div>';
      if (job.status === 'running') {
        var bar = ui.el('div', { class: 'prog', style: 'margin-top:6px' });
        bar.innerHTML = '<i style="width:' + job.progress + '%"></i>';
        left.appendChild(bar);
      }
      row.appendChild(left);
      var right = ui.el('div', { class: 'row', style: 'gap:6px' });
      right.innerHTML = badge;
      if (job.status === 'done' && job.resultCount > 0) {
        right.appendChild(ui.el('a', { class: 'btn small ghost', href: 'stats.html', text: 'View stats' }));
      }
      row.appendChild(right);
      zone.appendChild(row);
    });
  }

  /* ---------- management panel ---------- */
  function renderManage(parent) {
    var conn = selected();
    if (!conn) return;
    var linked = linkedAccounts(conn.id);
    var card = ui.el('div', { class: 'card' });
    var head = ui.el('div', { class: 'card-head' });
    head.appendChild(ui.el('div', {}, [
      ui.el('h2', { class: 'card-title', text: conn.name }),
      ui.el('p', { class: 'card-sub', text: 'Sync trades, import history, or manage this broker login.' })
    ]));
    head.appendChild(ui.el('span', {
      class: 'badge ' + (conn.status === 'connected' ? 'green dot' : 'red dot'),
      text: conn.status === 'connected' ? 'Connected' : 'Disconnected'
    }));
    card.appendChild(head);

    var dl = ui.el('dl', { class: 'dl' });
    dl.innerHTML =
      '<dt>Provider</dt><dd>' + PROVIDER_LABEL[conn.provider] + ' · ' + conn.mode + '</dd>' +
      '<dt>Linked accounts</dt><dd>' + linked.length + '</dd>' +
      '<dt>Last sync</dt><dd>' + (conn.lastSyncAt ? ui.relTime(conn.lastSyncAt) + ' · ' + calc.fmtIso(conn.lastSyncAt) : 'Never') + '</dd>';
    card.appendChild(dl);

    var actions = ui.el('div', { class: 'row', style: 'margin-top:14px' });
    var today = calc.todayKey();
    actions.appendChild(ui.el('button', {
      class: 'btn primary', text: '⟳ Sync recent trades',
      onclick: function () { runJob(conn, 'sync', { from: calc.addDays(today, -2), to: today }, 2 + Math.floor(Math.random() * 4)); }
    }));
    actions.appendChild(ui.el('button', { class: 'btn', text: 'Rename', onclick: function () { renameConnection(conn); } }));
    actions.appendChild(ui.el('button', {
      class: 'btn', text: conn.status === 'connected' ? 'Disconnect' : 'Reconnect',
      onclick: function () { toggleConnected(conn); }
    }));
    actions.appendChild(ui.el('button', { class: 'btn danger', text: 'Remove', onclick: function () { removeConnection(conn); } }));
    card.appendChild(actions);
    parent.appendChild(card);

    /* older import */
    var imp = ui.el('div', { class: 'card' });
    imp.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Import older trades' }),
        ui.el('p', { class: 'card-sub', text: 'Backfill history one date range at a time. Imports keep running even if you leave this page.' })
      ])
    ]));
    var sug = suggestOlderRange(conn);
    var form = ui.el('div', { class: 'row' });
    var fromIn = ui.el('input', { type: 'date', value: sug.from });
    var toIn = ui.el('input', { type: 'date', value: sug.to });
    form.appendChild(ui.el('span', { class: 'muted', style: 'font-size:12px', text: 'Suggested next range:' }));
    form.appendChild(fromIn);
    form.appendChild(ui.el('span', { class: 'faint', text: '→' }));
    form.appendChild(toIn);
    form.appendChild(ui.el('button', {
      class: 'btn', text: 'Start import',
      onclick: function () {
        if (!fromIn.value || !toIn.value || fromIn.value > toIn.value) {
          ui.toast('Pick a valid from/to range.', 'err');
          return;
        }
        runJob(conn, 'import', { from: fromIn.value, to: toIn.value }, 4 + Math.floor(Math.random() * 9));
      }
    }));
    imp.appendChild(form);
    parent.appendChild(imp);
  }

  function renderAccountsTable(parent) {
    var conn = selected();
    if (!conn) return;
    var linked = linkedAccounts(conn.id);
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Linked broker accounts' }),
        ui.el('p', { class: 'card-sub', text: 'Every broker account under the selected connection, and the tracker account it feeds.' })
      ]),
      ui.el('a', { class: 'btn small', href: 'accounts.html', text: 'Manage accounts' })
    ]));
    if (!linked.length) {
      card.appendChild(ui.emptyState({
        icon: '⛓', title: 'No accounts linked',
        message: 'Link a tracker account to this connection from the Accounts page to start syncing trades into it.',
        action: { href: 'accounts.html', label: 'Open Accounts' }
      }));
      parent.appendChild(card);
      return;
    }
    var wrap = ui.el('div', { class: 'tbl-wrap' });
    var tbl = ui.el('table', { class: 'tbl' });
    tbl.innerHTML = '<thead><tr><th>Broker account</th><th>Tracker account</th><th class="num">Balance</th><th class="num">Distance to DD</th><th>Status</th><th>Last sync</th></tr></thead>';
    var tbody = ui.el('tbody');
    linked.forEach(function (a) {
      var dist = (a.balance != null && a.drawdownLimit != null) ? a.balance - a.drawdownLimit : null;
      var tr = ui.el('tr');
      tr.innerHTML =
        '<td><span class="mono">' + ui.esc(a.brokerAccountRef || '—') + '</span><br><span class="muted" style="font-size:11px">' + PROVIDER_LABEL[conn.provider] + ' broker-linked</span></td>' +
        '<td><b>' + ui.esc(a.name) + '</b></td>' +
        '<td class="num">' + (a.balance != null ? ui.fmtMoney(a.balance, { plus: false }) : '—') + '</td>' +
        '<td class="num ' + (dist != null ? (dist > 1500 ? 'pl-pos' : dist > 0 ? '' : 'pl-neg') : '') + '">' + (dist != null ? ui.fmtMoney(dist, { plus: false }) : '—') + '</td>' +
        '<td>' + (a.status === 'active' ? '<span class="badge green dot">Linked</span>' : '<span class="badge">Archived</span>') + '</td>' +
        '<td class="muted">' + (a.lastSyncAt ? ui.relTime(a.lastSyncAt) : 'never') + '</td>';
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    card.appendChild(wrap);
    parent.appendChild(card);
  }

  /* ---------- page ---------- */
  function rerender() {
    var root = ui.qs('#pageBody');
    root.innerHTML = '';
    var side = ui.qs('#headSide');
    if (side) side.innerHTML = '';
    build(root);
  }

  function build(root) {
    var conns = connections();
    var allLinked = (store.get('accounts') || []).filter(function (a) { return a.connectionId; });
    var reconnect = conns.filter(function (c) { return c.status !== 'connected'; }).length;
    var lastSync = conns.reduce(function (m, c) { return c.lastSyncAt && (!m || c.lastSyncAt > m) ? c.lastSyncAt : m; }, null);

    ui.headStat(String(conns.length), 'Connections');
    ui.headStat(String(allLinked.length), 'Linked accounts');

    var kpis = ui.el('div', { class: 'kpis' });
    kpis.innerHTML =
      '<div class="kpi"><div class="k-label">Broker connections</div><div class="k-value">' + conns.length + '</div><div class="k-sub">Broker logins connected to this workspace.</div></div>' +
      '<div class="kpi"><div class="k-label">Linked accounts</div><div class="k-value">' + allLinked.length + '</div><div class="k-sub">Attached to tracker accounts and ready to sync.</div></div>' +
      '<div class="kpi"><div class="k-label">Reconnect needed</div><div class="k-value ' + (reconnect ? 'pl-neg' : '') + '">' + reconnect + '</div><div class="k-sub">' + (reconnect ? 'Fresh broker auth needed before more syncs.' : 'All connections are healthy.') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Last sync</div><div class="k-value" style="font-size:17px">' + (lastSync ? ui.relTime(lastSync) : '—') + '</div><div class="k-sub">' + (lastSync ? calc.fmtIso(lastSync) : 'Run your first sync below.') + '</div></div>';
    root.appendChild(kpis);

    var switcher = ui.el('div', { class: 'card' });
    switcher.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Connection switcher' }),
        ui.el('p', { class: 'card-sub', text: 'Pick a broker tile to control the workspace below.' })
      ]),
      ui.el('button', { class: 'btn primary', text: '+ Add broker connection', onclick: openAddConnection })
    ]));
    var tiles = ui.el('div', { class: 'conn-tiles' });
    if (!conns.length) {
      switcher.appendChild(ui.emptyState({
        icon: '⇄', title: 'No brokers connected',
        message: 'Add a (simulated) Tradovate or NinjaTrader connection to start syncing trades automatically.'
      }));
    }
    conns.forEach(function (c) {
      var isSel = selected() && selected().id === c.id;
      var tile = ui.el('button', { class: 'conn-tile' + (isSel ? ' sel' : '') });
      tile.innerHTML =
        '<span class="badge ' + (c.status === 'connected' ? 'green dot' : 'red dot') + '">' + (c.status === 'connected' ? 'Connected' : 'Disconnected') + '</span>' +
        (isSel ? ' <span class="badge teal">Selected</span>' : '') +
        '<div class="ct-name">' + ui.esc(c.name) + '</div>' +
        '<div class="ct-meta">' + PROVIDER_LABEL[c.provider] + ' · ' + c.mode + ' · ' + linkedAccounts(c.id).length + ' linked · last sync ' + (c.lastSyncAt ? ui.relTime(c.lastSyncAt) : 'never') + '</div>';
      tile.addEventListener('click', function () { selectedId = c.id; rerender(); });
      tiles.appendChild(tile);
    });
    switcher.appendChild(tiles);
    root.appendChild(switcher);

    renderManage(root);
    renderAccountsTable(root);

    var jobs = ui.el('div', { class: 'card' });
    jobs.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Sync activity' }),
        ui.el('p', { class: 'card-sub', text: 'Recent and older-trade sync jobs. Anything still running when you left the page completes automatically.' })
      ])
    ]));
    jobs.appendChild(ui.el('div', { class: 'stack', id: 'jobZone', style: 'gap:8px' }));
    root.appendChild(jobs);
    drawJobs();
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    build(ui.qs('#pageBody'));
  });
})();
