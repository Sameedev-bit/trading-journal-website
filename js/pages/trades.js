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

  /* ---------- CSV export ---------- */
  function exportCsv() {
    var visible = applyFilters();
    if (!visible.length) { ui.toast('Nothing to export with these filters.', 'err'); return; }
    var accIdx = accountIndex();
    var rows = [['date', 'time', 'account', 'symbol', 'direction', 'contracts', 'entry_price', 'exit_price', 'entry_time', 'exit_time', 'risk', 'commissions', 'gross_pl', 'net_pl', 'r_multiple', 'source', 'broker_trade_id', 'tags', 'notes']];
    var tagIdx = {};
    (store.get('tags') || []).forEach(function (t) { tagIdx[t.id] = t.label; });
    visible.forEach(function (t) {
      rows.push([
        t.dateKey, calc.fmtTime(t.entryTime), accIdx[t.accountId] ? accIdx[t.accountId].name : '',
        t.symbol, t.direction, t.contracts, t.entryPrice, t.exitPrice, t.entryTime, t.exitTime,
        t.riskAmount != null ? t.riskAmount : '', t.commissions || 0,
        calc.gross(t).toFixed(2), calc.net(t).toFixed(2),
        calc.rMultiple(t) !== null ? calc.rMultiple(t).toFixed(2) : '',
        t.source, t.brokerTradeId || '',
        (t.tagIds || []).map(function (id) { return tagIdx[id] || ''; }).join('; '),
        t.notes || ''
      ]);
    });
    var blob = new Blob([calc.csvSerialize(rows)], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tradeharbor-trades-' + calc.todayKey() + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    ui.toast(visible.length + ' trades exported');
  }

  /* ---------- CSV import ---------- */
  var IMPORT_FIELDS = [
    ['symbol', 'Symbol', true], ['direction', 'Direction (long/short)', false],
    ['contracts', 'Contracts', false], ['entryPrice', 'Entry price', true],
    ['exitPrice', 'Exit price', true], ['entryTime', 'Entry time', true],
    ['exitTime', 'Exit time', false], ['riskAmount', 'Risk $', false],
    ['commissions', 'Commissions $', false], ['brokerTradeId', 'Broker trade ID', false]
  ];

  function guessColumn(headers, field) {
    var hints = {
      symbol: ['symbol', 'instrument', 'contract', 'market'],
      direction: ['direction', 'side', 'buy/sell', 'b/s'],
      contracts: ['contracts', 'qty', 'quantity', 'size', 'lots'],
      entryPrice: ['entry price', 'entryprice', 'buy price', 'boughtprice', 'entry', 'avg entry'],
      exitPrice: ['exit price', 'exitprice', 'sell price', 'soldprice', 'exit', 'avg exit'],
      entryTime: ['entry time', 'entrytime', 'bought timestamp', 'open time', 'date', 'entry date'],
      exitTime: ['exit time', 'exittime', 'sold timestamp', 'close time', 'exit date'],
      riskAmount: ['risk', 'risk $', 'dollar risk'],
      commissions: ['commission', 'commissions', 'fees', 'comm'],
      brokerTradeId: ['id', 'trade id', 'order id', 'position id', 'fill id']
    };
    var lower = headers.map(function (h) { return h.trim().toLowerCase(); });
    var list = hints[field] || [];
    for (var i = 0; i < list.length; i++) {
      var at = lower.indexOf(list[i]);
      if (at !== -1) return at;
    }
    return -1;
  }

  function parseTimeCell(v) {
    if (!v) return null;
    var d = new Date(v);
    if (isNaN(d)) {
      d = new Date(v.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/, '$3-$1-$2'));
    }
    if (isNaN(d)) return null;
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00';
  }

  function openImportModal() {
    var accounts = (store.get('accounts') || []).filter(function (a) { return a.status === 'active'; });
    if (!accounts.length) { ui.toast('Create an account first.', 'err'); return; }
    var body = ui.el('div', { class: 'stack' });

    var presetSel = ui.el('select', {
      html: Object.keys(calc.BROKER_PRESETS).map(function (k) {
        return '<option value="' + k + '">' + ui.esc(calc.BROKER_PRESETS[k].label) + '</option>';
      }).join('')
    });
    var presetLab = ui.el('label', { class: 'field' });
    presetLab.appendChild(ui.el('span', { text: 'Broker / format' }));
    presetLab.appendChild(presetSel);
    body.appendChild(presetLab);

    var fileIn = ui.el('input', { type: 'file', accept: '.csv,text/csv' });
    var fld = ui.el('label', { class: 'field' }, [ui.el('span', { text: 'CSV file (max 2 MB, first row = headers)' }), fileIn]);
    body.appendChild(fld);
    var zone = ui.el('div', { class: 'stack' });
    body.appendChild(zone);
    var parsed = null;

    function preset() { return calc.BROKER_PRESETS[presetSel.value]; }

    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { ui.toast('File is over 2 MB.', 'err'); fileIn.value = ''; return; }
      var reader = new FileReader();
      reader.onload = function () {
        parsed = calc.csvParse(String(reader.result));
        if (!parsed.headers.length || !parsed.rows.length) {
          ui.toast('Could not find rows in that file.', 'err');
          parsed = null;
          return;
        }
        drawZone();
      };
      reader.readAsText(f);
    });
    presetSel.addEventListener('change', function () { if (parsed) drawZone(); });

    function accountPicker(grid) {
      var accSel = ui.el('select', { id: 'map-account', html: accounts.map(function (a) { return '<option value="' + a.id + '">' + ui.esc(a.name) + '</option>'; }).join('') });
      var accLab = ui.el('label', { class: 'field' });
      accLab.appendChild(ui.el('span', { text: 'Import into account' }));
      accLab.appendChild(accSel);
      grid.appendChild(accLab);
    }

    function drawZone() {
      zone.innerHTML = '';
      var p = preset();
      if (p.kind === 'fills') {
        // executions file: columns are auto-detected, rows get paired into round trips
        var map = calc.autoMapHeaders(parsed.headers, p.hints);
        var missing = ['symbol', 'time', 'side', 'qty', 'price'].filter(function (k) { return map[k] === -1; });
        if (missing.length) {
          zone.appendChild(ui.el('p', {
            class: 'field-err', style: 'margin:0',
            text: 'This file doesn’t look like a ' + p.label + ' — missing column(s): ' + missing.join(', ') + '. Try the Generic format instead.'
          }));
          return;
        }
        zone.appendChild(ui.el('p', {
          class: 'muted', style: 'font-size:12px;margin:0',
          text: parsed.rows.length + ' execution rows detected. They’ll be paired into round-trip trades automatically (scale-ins become one trade with pyramid detection).'
        }));
        var grid = ui.el('div', { class: 'form-grid' });
        accountPicker(grid);
        zone.appendChild(grid);
        return;
      }
      // trades file: manual mapping grid, pre-filled from the preset's header hints
      var presetMap = p.hints ? calc.autoMapHeaders(parsed.headers, p.hints) : {};
      zone.appendChild(ui.el('p', { class: 'muted', style: 'font-size:12px;margin:0', text: parsed.rows.length + ' data rows found. Map your columns:' }));
      var grid2 = ui.el('div', { class: 'form-grid' });
      var colOpts = '<option value="-1">— not in file —</option>' + parsed.headers.map(function (h, i) {
        return '<option value="' + i + '">' + ui.esc(h || ('column ' + (i + 1))) + '</option>';
      }).join('');
      IMPORT_FIELDS.forEach(function (fdef) {
        var sel = ui.el('select', { id: 'map-' + fdef[0], html: colOpts });
        var fromPreset = presetMap[fdef[0]];
        sel.value = String(fromPreset !== undefined && fromPreset !== -1 ? fromPreset : guessColumn(parsed.headers, fdef[0]));
        var lab = ui.el('label', { class: 'field' });
        lab.appendChild(ui.el('span', { html: fdef[1] + (fdef[2] ? ' <b class="req">*</b>' : '') }));
        lab.appendChild(sel);
        grid2.appendChild(lab);
      });
      accountPicker(grid2);
      zone.appendChild(grid2);
    }

    /* fills-kind import: map → fill rows → pairFills → trades */
    function importFills(b) {
      var p = preset();
      var map = calc.autoMapHeaders(parsed.headers, p.hints);
      var accountId = ui.qs('#map-account', b).value;
      var unknownRoots = {};
      var fills = [], bad = 0;
      parsed.rows.forEach(function (row) {
        function cell(field) { return map[field] === -1 ? '' : (row[map[field]] || '').trim(); }
        var side = calc.parseSide(cell('side'));
        var qty = parseInt(cell('qty'), 10);
        var price = parseFloat(String(cell('price')).replace(/[$,]/g, ''));
        var ts = parseTimeCell(cell('time'));
        var norm = calc.normalizeSymbol(cell('symbol'));
        if (!side || !(qty > 0) || isNaN(price) || !ts || !norm.symbol) { bad++; return; }
        if (!norm.known) unknownRoots[norm.symbol] = true;
        var comm = parseFloat(String(cell('commission')).replace(/[$,]/g, ''));
        fills.push({
          symbol: norm.symbol, ts: ts, side: side, qty: qty, price: price,
          commission: isNaN(comm) ? 0 : Math.abs(comm),
          execId: cell('id') || null
        });
      });
      var paired = calc.pairFills(fills);
      var existing = store.get('trades') || [];
      var seenIds = {}, seenSig = {};
      existing.forEach(function (t) {
        if (t.brokerTradeId) seenIds[t.brokerTradeId] = true;
        seenSig[t.symbol + '|' + t.entryTime + '|' + t.contracts] = true;
      });
      var added = 0, skipped = 0;
      paired.trades.forEach(function (pt) {
        var sig = pt.symbol + '|' + pt.entryTime + '|' + pt.contracts;
        if ((pt.brokerTradeId && seenIds[pt.brokerTradeId]) || seenSig[sig]) { skipped++; return; }
        seenSig[sig] = true;
        if (pt.brokerTradeId) seenIds[pt.brokerTradeId] = true;
        existing.push({
          id: store.newId('t'), accountId: accountId,
          symbol: pt.symbol, direction: pt.direction, contracts: pt.contracts,
          entryPrice: pt.entryPrice, exitPrice: pt.exitPrice,
          entryTime: pt.entryTime, exitTime: pt.exitTime, dateKey: pt.dateKey,
          commissions: pt.commissions, riskAmount: null,
          source: 'csv', brokerTradeId: pt.brokerTradeId,
          entryFillCount: pt.entryFillCount, tagIds: [], notes: '', checklist: null
        });
        added++;
      });
      store.save('trades', existing);
      var msg = added + ' trades imported from ' + fills.length + ' executions · ' + skipped + ' duplicates skipped' +
        (bad ? ' · ' + bad + ' unreadable rows' : '') +
        (paired.open.length ? ' · ' + paired.open.length + ' still-open position(s) not imported' : '');
      var roots = Object.keys(unknownRoots);
      if (roots.length) msg += ' · unknown symbols (' + roots.join(', ') + ') — P/L may be off';
      ui.toast(msg, added ? 'ok' : 'err');
      renderList();
    }

    ui.modal({
      title: 'Import trades from CSV',
      wide: true,
      body: body,
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Import trades', kind: 'primary',
          onClick: function (b) {
            if (!parsed) { ui.toast('Pick a CSV file first.', 'err'); return false; }
            if (preset().kind === 'fills') {
              if (!ui.qs('#map-account', b)) { ui.toast('This file doesn’t match the selected format.', 'err'); return false; }
              importFills(b);
              return;
            }
            var map = {};
            IMPORT_FIELDS.forEach(function (fdef) {
              map[fdef[0]] = parseInt(ui.qs('#map-' + fdef[0], b).value, 10);
            });
            var missing = IMPORT_FIELDS.filter(function (fdef) { return fdef[2] && map[fdef[0]] === -1; });
            if (missing.length) { ui.toast('Map the required column: ' + missing[0][1], 'err'); return false; }
            var accountId = ui.qs('#map-account', b).value;

            var existing = store.get('trades') || [];
            var seenIds = {}, seenSig = {};
            existing.forEach(function (t) {
              if (t.brokerTradeId) seenIds[t.brokerTradeId] = true;
              seenSig[t.symbol + '|' + t.entryTime + '|' + t.contracts] = true;
            });

            var added = 0, skipped = 0, bad = 0;
            var unknownRoots = {};
            parsed.rows.forEach(function (row) {
              function cell(field) { return map[field] === -1 ? '' : (row[map[field]] || '').trim(); }
              var entryTime = parseTimeCell(cell('entryTime'));
              var norm = calc.normalizeSymbol(cell('symbol'));
              var symbol = norm.symbol.replace(/[^A-Z0-9]/g, '').slice(0, 6);
              if (symbol && !norm.known) unknownRoots[symbol] = true;
              var entryPrice = parseFloat(String(cell('entryPrice')).replace(/[$,]/g, ''));
              var exitPrice = parseFloat(String(cell('exitPrice')).replace(/[$,]/g, ''));
              if (!symbol || !entryTime || isNaN(entryPrice) || isNaN(exitPrice)) { bad++; return; }
              var contracts = parseInt(cell('contracts'), 10);
              if (!(contracts > 0)) contracts = 1;
              var dirRaw = cell('direction').toLowerCase();
              var direction = /s|short|sell/.test(dirRaw) && !/long|buy/.test(dirRaw) ? 'short' : 'long';
              var brokerTradeId = cell('brokerTradeId') || null;
              var sig = symbol + '|' + entryTime + '|' + contracts;
              if ((brokerTradeId && seenIds[brokerTradeId]) || seenSig[sig]) { skipped++; return; }
              seenSig[sig] = true;
              if (brokerTradeId) seenIds[brokerTradeId] = true;
              var risk = parseFloat(cell('riskAmount'));
              var comm = parseFloat(cell('commissions'));
              existing.push({
                id: store.newId('t'),
                accountId: accountId,
                symbol: symbol, direction: direction, contracts: contracts,
                entryPrice: entryPrice, exitPrice: exitPrice,
                entryTime: entryTime,
                exitTime: parseTimeCell(cell('exitTime')) || entryTime,
                dateKey: entryTime.slice(0, 10),
                commissions: isNaN(comm) ? 0 : comm,
                riskAmount: isNaN(risk) ? null : risk,
                source: 'csv', brokerTradeId: brokerTradeId,
                entryFillCount: 1, tagIds: [], notes: '', checklist: null
              });
              added++;
            });
            store.save('trades', existing);
            var doneMsg = added + ' imported · ' + skipped + ' duplicates skipped' + (bad ? ' · ' + bad + ' unreadable rows' : '');
            var roots = Object.keys(unknownRoots);
            if (roots.length) doneMsg += ' · unknown symbols (' + roots.join(', ') + ') — P/L may be off';
            ui.toast(doneMsg, added ? 'ok' : 'err');
            renderList();
          }
        }
      ]
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
      ui.el('div', { class: 'row', style: 'gap:6px' }, [
        ui.el('button', { class: 'btn small ghost', text: '⇪ Import CSV', onclick: openImportModal }),
        ui.el('button', { class: 'btn small ghost', text: '⇩ Export CSV', onclick: exportCsv }),
        ui.el('a', { class: 'btn small', href: 'manual-entry.html', text: '+ Manual entry' })
      ])
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
    if (/[?&]import=1/.test(location.search)) {
      history.replaceState(null, '', location.pathname);
      openImportModal();
    }
  });
})();
