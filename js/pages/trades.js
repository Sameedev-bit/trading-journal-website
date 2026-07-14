/* Trades page — filterable trade list + simulated sync */
(function () {
  'use strict';
  var ui, calc, store;

  var filters = { accounts: [], from: null, to: null, preset: 'all', sources: [], result: '', symbol: '', tags: [], search: '' };

  var SOURCE_LABEL = { sync: 'Broker sync', csv: 'CSV import', manual: 'Manual entry' };
  var SOURCE_BADGE = { sync: 'teal', csv: 'blue', manual: 'amber' };

  function accountIndex() {
    var idx = {};
    (store.get('accounts') || []).forEach(function (a) { idx[a.id] = a; });
    return idx;
  }

  function applyFilters() {
    var trades = store.get('trades') || [];
    var ctx = { accounts: store.get('accounts') || [], tags: store.get('tags') || [] };
    return calc.filterTrades(trades, filters, ctx).sort(function (a, b) {
      return (b.entryTime || '') < (a.entryTime || '') ? -1 : 1;
    });
  }

  function renderList() {
    var listEl = ui.qs('#tradeList');
    var accIdx = accountIndex();
    var visible = applyFilters();
    listEl.innerHTML = '';

    var k = calc.kpis(visible, { mode: 'trade' });
    ui.qs('#tSummary').innerHTML =
      '<div class="kpi"><div class="k-label">Trades shown</div><div class="k-value">' + visible.length + '</div><div class="k-sub">of ' + (store.get('trades') || []).length + ' in the workspace.</div></div>' +
      '<div class="kpi"><div class="k-label">Net P/L</div><div class="k-value ' + ui.plClass(k.totalPL) + '">' + ui.fmtMoney(k.totalPL) + '</div><div class="k-sub">For the visible trades.</div></div>' +
      '<div class="kpi"><div class="k-label">Win rate</div><div class="k-value">' + ui.fmtPct(k.winRate) + '</div><div class="k-sub">' + k.wins + ' wins · ' + k.losses + ' losses · ' + k.be + ' B/E.</div></div>' +
      '<div class="kpi"><div class="k-label">R factor</div><div class="k-value ' + ui.plClass(k.rFactor || 0) + '">' + ui.fmtR(k.rFactor) + '</div><div class="k-sub">Net R on total risk ' + ui.fmtMoney(k.totalRisk, { plus: false, dec: 0 }) + '.</div></div>';

    if (!visible.length) {
      listEl.appendChild(ui.emptyState({
        icon: '⌕', title: 'No trades match these filters',
        message: 'Widen the date range, clear a filter, or sync/log a new trade.',
        action: { href: 'manual-entry.html', label: 'Add a trade manually' }
      }));
      return;
    }

    visible.forEach(function (t) {
      var acc = accIdx[t.accountId];
      var net = calc.net(t), r = calc.rMultiple(t), pts = calc.points(t);
      var row = ui.el('div', { class: 'trade-row' });
      var main = ui.el('div', { class: 't-main' });
      var line1 = ui.el('div', { class: 't-line1' });
      line1.appendChild(ui.el('span', { class: 't-sym', text: t.symbol }));
      line1.appendChild(ui.el('span', { class: 'badge ' + (t.direction === 'long' ? 'green' : 'red'), text: t.direction }));
      line1.appendChild(ui.el('span', { class: 'badge', text: acc ? acc.name : 'Unknown account' }));
      line1.appendChild(ui.el('span', { class: 'badge ' + (SOURCE_BADGE[t.source] || ''), text: SOURCE_LABEL[t.source] || t.source }));
      if (t.entryFillCount > 1) line1.appendChild(ui.el('span', { class: 'badge violet dot', text: 'Pyramid detected' }));
      main.appendChild(line1);
      main.appendChild(ui.el('div', {
        class: 't-meta',
        text: calc.fmtIso(t.entryTime) + ' · ' + t.contracts + ' contract' + (t.contracts === 1 ? '' : 's') +
          (t.riskAmount ? ' · risk $' + t.riskAmount : '') +
          ' · ' + (pts >= 0 ? '+' : '−') + Math.abs(pts).toFixed(2) + ' pts' +
          (r !== null ? ' · ' + ui.fmtR(r) : '')
      }));
      row.appendChild(main);
      row.appendChild(ui.el('div', { class: 't-pl ' + ui.plClass(net), text: ui.fmtMoney(net) }));
      row.appendChild(ui.el('div', { class: 't-r', text: ui.fmtR(r) }));
      var act = ui.el('div', { class: 't-act' });
      act.appendChild(ui.el('a', { class: 'btn small', href: 'trade-review.html?id=' + encodeURIComponent(t.id), text: 'Review' }));
      row.appendChild(act);
      listEl.appendChild(row);
    });
  }

  function openSyncModal() {
    var connections = (store.get('connections') || []).filter(function (c) { return c.status === 'connected'; });
    if (!connections.length) {
      ui.toast('No connected brokers — add one on the Broker Connections page.', 'err');
      return;
    }
    var body = ui.el('div', { class: 'stack' });
    body.appendChild(ui.el('p', { class: 'card-sub', text: 'Pull the latest fills from a connected broker (simulated in this demo).' }));
    connections.forEach(function (c) {
      var tile = ui.el('button', { class: 'conn-tile' });
      tile.innerHTML = '<span class="badge green dot">Connected</span><div class="ct-name">' + ui.esc(c.name) + '</div>' +
        '<div class="ct-meta">' + (c.provider === 'tradovate' ? 'Tradovate' : 'NinjaTrader') + ' · ' + c.mode + ' · last sync ' + ui.relTime(c.lastSyncAt) + '</div>';
      tile.addEventListener('click', function () {
        m.close();
        runSync(c);
      });
      body.appendChild(tile);
    });
    var m = ui.modal({ title: 'Sync recent trades', body: body });
  }

  function runSync(conn) {
    var body = ui.el('div', { class: 'stack' });
    body.innerHTML = '<p class="card-sub">Syncing <b>' + ui.esc(conn.name) + '</b>…</p><div class="prog"><i style="width:4%"></i></div><div class="muted" id="syncPct" style="font-size:12px">Starting…</div>';
    var m = ui.modal({ title: 'Sync in progress', body: body, dismissable: false });
    var today = calc.todayKey();
    store.startJob({
      connectionId: conn.id,
      kind: 'sync',
      range: { from: calc.addDays(today, -2), to: today },
      countHint: 2 + Math.floor(Math.random() * 4),
      onTick: function (job) {
        var bar = body.querySelector('.prog>i');
        if (bar) bar.style.width = job.progress + '%';
        var pct = body.querySelector('#syncPct');
        if (pct) pct.textContent = Math.round(job.progress) + '% — checking fills…';
      },
      onDone: function (job) {
        m.close();
        if (job.status === 'done') ui.toast('Sync complete — ' + job.resultCount + ' new trade' + (job.resultCount === 1 ? '' : 's') + ' imported');
        else ui.toast(job.error || 'Sync failed', 'err');
        renderList();
      }
    });
  }

  function render() {
    var root = ui.qs('#pageBody');
    var accounts = (store.get('accounts') || []);
    var tags = store.get('tags') || [];
    var trades = store.get('trades') || [];
    var symbols = Object.keys(calc.POINT_VALUES).filter(function (s) {
      return trades.some(function (t) { return t.symbol === s; });
    });

    ui.headStat(String(trades.length), 'Trades');
    ui.headStat(String(accounts.filter(function (a) { return a.status === 'active'; }).length), 'Accounts');

    /* filter bar */
    var bar = ui.el('div', { class: 'filterbar' });
    bar.appendChild(ui.el('span', { class: 'fb-label', text: 'Filter' }));

    bar.appendChild(ui.multiSelect({
      label: 'Accounts', allLabel: 'All',
      items: accounts.map(function (a) { return { value: a.id, label: a.name + (a.status === 'archived' ? ' (archived)' : '') }; }),
      selected: [],
      onChange: function (vals) { filters.accounts = vals.length === accounts.length ? [] : vals; renderList(); }
    }));

    var presetSel = ui.el('select', {
      style: 'width:auto',
      html: '<option value="all">All dates</option><option value="today">Today</option><option value="week">This week</option>' +
        '<option value="month">This month</option><option value="last30">Last 30 days</option><option value="ytd">Year to date</option><option value="custom">Custom…</option>'
    });
    bar.appendChild(presetSel);
    var fromIn = ui.el('input', { type: 'date', class: 'hidden' });
    var toIn = ui.el('input', { type: 'date', class: 'hidden' });
    bar.appendChild(fromIn); bar.appendChild(toIn);
    presetSel.addEventListener('change', function () {
      filters.preset = presetSel.value;
      var custom = presetSel.value === 'custom';
      fromIn.classList.toggle('hidden', !custom);
      toIn.classList.toggle('hidden', !custom);
      if (!custom) {
        var r = calc.presetRange(presetSel.value);
        filters.from = r.from; filters.to = r.to;
        renderList();
      }
    });
    function customChange() {
      filters.from = fromIn.value || null;
      filters.to = toIn.value || null;
      renderList();
    }
    fromIn.addEventListener('change', customChange);
    toIn.addEventListener('change', customChange);

    var srcSel = ui.el('select', {
      style: 'width:auto',
      html: '<option value="">All sources</option><option value="sync">Broker sync</option><option value="csv">CSV import</option><option value="manual">Manual</option>'
    });
    srcSel.addEventListener('change', function () { filters.sources = srcSel.value ? [srcSel.value] : []; renderList(); });
    bar.appendChild(srcSel);

    var resSel = ui.el('select', {
      style: 'width:auto',
      html: '<option value="">All results</option><option value="win">Wins</option><option value="loss">Losses</option><option value="be">Breakeven</option>'
    });
    resSel.addEventListener('change', function () { filters.result = resSel.value; renderList(); });
    bar.appendChild(resSel);

    var symSel = ui.el('select', {
      style: 'width:auto',
      html: '<option value="">All symbols</option>' + symbols.map(function (s) { return '<option>' + s + '</option>'; }).join('')
    });
    symSel.addEventListener('change', function () { filters.symbol = symSel.value; renderList(); });
    bar.appendChild(symSel);

    if (tags.length) {
      bar.appendChild(ui.multiSelect({
        label: 'Tags', allLabel: 'Any',
        items: tags.map(function (t) { return { value: t.id, label: t.label }; }),
        selected: [],
        onChange: function (vals) { filters.tags = vals.length === tags.length ? [] : vals; renderList(); }
      }));
    }

    var search = ui.el('input', { type: 'search', placeholder: 'Search notes, symbols…' });
    var searchTimer = null;
    search.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { filters.search = search.value; renderList(); }, 180);
    });
    bar.appendChild(search);

    bar.appendChild(ui.el('span', { class: 'spacer' }));
    bar.appendChild(ui.el('button', {
      class: 'btn small ghost', text: 'Clear all', onclick: function () {
        filters = { accounts: [], from: null, to: null, preset: 'all', sources: [], result: '', symbol: '', tags: [], search: '' };
        render0();
      }
    }));
    bar.appendChild(ui.el('button', { class: 'btn primary', text: '⟳ Sync trades', onclick: openSyncModal }));
    root.appendChild(bar);

    root.appendChild(ui.el('div', { class: 'kpis', id: 'tSummary' }));

    var listCard = ui.el('div', { class: 'card' });
    listCard.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Trade list' }),
        ui.el('p', { class: 'card-sub', text: 'Newest first. Open any trade to review notes, screenshots and checklist.' })
      ]),
      ui.el('a', { class: 'btn', href: 'manual-entry.html', text: '+ Manual entry' })
    ]));
    listCard.appendChild(ui.el('div', { class: 'stack', id: 'tradeList', style: 'gap:8px' }));
    root.appendChild(listCard);

    renderList();
  }

  function render0() {
    ui.qs('#pageBody').innerHTML = '';
    var side = ui.qs('#headSide');
    if (side) side.innerHTML = '';
    render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    render();
  });
})();
