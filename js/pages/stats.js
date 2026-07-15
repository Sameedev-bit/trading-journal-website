/* Stats page — KPIs, Net P&L after expenses, chart, calendar/list */
(function () {
  'use strict';
  var ui, calc, store;

  var state = {
    accounts: [], tags: [], preset: 'last90', from: null, to: null,
    mode: 'day',           // 'day' | 'trade' — KPI aggregation unit
    chart: 'line',         // 'line' | 'bar'
    view: 'calendar',      // 'calendar' | 'list'
    calYear: null, calMonth: null
  };

  function loadSavedFilters() {
    var settings = store.get('settings') || {};
    var saved = settings.lastStatsFilters;
    if (saved) {
      ['accounts', 'tags', 'preset', 'from', 'to', 'mode', 'chart', 'view'].forEach(function (k) {
        if (saved[k] !== undefined) state[k] = saved[k];
      });
    }
    if (state.preset !== 'custom') {
      var r = calc.presetRange(state.preset);
      state.from = r.from; state.to = r.to;
    }
    var now = new Date();
    state.calYear = now.getFullYear();
    state.calMonth = now.getMonth();
  }

  function persistFilters() {
    var settings = store.get('settings') || {};
    settings.lastStatsFilters = {
      accounts: state.accounts, tags: state.tags, preset: state.preset,
      from: state.from, to: state.to, mode: state.mode, chart: state.chart, view: state.view
    };
    store.save('settings', settings);
  }

  function filtered() {
    var trades = store.get('trades') || [];
    return calc.filterTrades(trades, {
      accounts: state.accounts, from: state.from, to: state.to, tags: state.tags
    }, { accounts: store.get('accounts') || [], tags: store.get('tags') || [] });
  }

  /* ---------- sections ---------- */
  function renderFilterBar(root) {
    var accounts = store.get('accounts') || [];
    var tags = store.get('tags') || [];
    var bar = ui.el('div', { class: 'filterbar' });
    bar.appendChild(ui.el('span', { class: 'fb-label', text: 'Filter stats' }));

    bar.appendChild(ui.multiSelect({
      label: 'Accounts', allLabel: 'All',
      items: accounts.map(function (a) { return { value: a.id, label: a.name }; }),
      selected: state.accounts,
      onChange: function (vals) {
        state.accounts = vals.length === accounts.length ? [] : vals;
        persistFilters(); refresh();
      }
    }));

    var presetSel = ui.el('select', { style: 'width:auto' });
    presetSel.innerHTML =
      '<option value="month">Current month</option><option value="week">This week</option>' +
      '<option value="last30">Last 30 days</option><option value="last90">Last 90 days</option>' +
      '<option value="ytd">Year to date</option><option value="all">All results</option><option value="custom">Custom range…</option>';
    presetSel.value = state.preset;
    bar.appendChild(presetSel);
    var fromIn = ui.el('input', { type: 'date', class: state.preset === 'custom' ? '' : 'hidden', value: state.from || '' });
    var toIn = ui.el('input', { type: 'date', class: state.preset === 'custom' ? '' : 'hidden', value: state.to || '' });
    bar.appendChild(fromIn); bar.appendChild(toIn);
    presetSel.addEventListener('change', function () {
      state.preset = presetSel.value;
      var custom = state.preset === 'custom';
      fromIn.classList.toggle('hidden', !custom);
      toIn.classList.toggle('hidden', !custom);
      if (!custom) {
        var r = calc.presetRange(state.preset);
        state.from = r.from; state.to = r.to;
        persistFilters(); refresh();
      }
    });
    function customChange() {
      state.from = fromIn.value || null;
      state.to = toIn.value || null;
      persistFilters(); refresh();
    }
    fromIn.addEventListener('change', customChange);
    toIn.addEventListener('change', customChange);

    if (tags.length) {
      bar.appendChild(ui.multiSelect({
        label: 'Tags', allLabel: 'Any',
        items: tags.map(function (t) { return { value: t.id, label: t.label }; }),
        selected: state.tags,
        onChange: function (vals) {
          state.tags = vals.length === tags.length ? [] : vals;
          persistFilters(); refresh();
        }
      }));
    }

    var seg = ui.el('div', { class: 'seg' });
    [['day', 'Per day'], ['trade', 'Per trade']].forEach(function (m) {
      var b = ui.el('button', { class: state.mode === m[0] ? 'on' : '', text: m[1] });
      b.addEventListener('click', function () {
        state.mode = m[0];
        ui.qsa('button', seg).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        persistFilters(); refresh();
      });
      seg.appendChild(b);
    });
    bar.appendChild(seg);

    bar.appendChild(ui.el('span', { class: 'spacer' }));
    bar.appendChild(ui.el('button', {
      class: 'btn small ghost', text: 'Clear all', onclick: function () {
        state.accounts = []; state.tags = []; state.preset = 'last90'; state.mode = 'day';
        var r = calc.presetRange('last90');
        state.from = r.from; state.to = r.to;
        persistFilters();
        rerenderAll();
      }
    }));
    root.appendChild(bar);
  }

  function renderKpis(root) {
    root.appendChild(ui.el('div', { class: 'kpis', id: 'kpiRow1' }));
    root.appendChild(ui.el('div', { class: 'kpis', id: 'kpiRow2' }));
  }

  function fillKpis() {
    var trades = filtered();
    var k = calc.kpis(trades, { mode: state.mode });
    var unitNoun = state.mode === 'day' ? 'days' : 'trades';
    var expenses = calc.expenseTotal(store.get('expenses'), state.from, state.to);
    var netAfter = k.totalPL - expenses;

    ui.qs('#kpiRow1').innerHTML =
      '<div class="kpi"><div class="k-label">Total P/L</div><div class="k-value ' + ui.plClass(k.totalPL) + '">' + ui.fmtMoney(k.totalPL) + '</div><div class="k-sub">' + k.tradeCount + ' trades over ' + k.dayCount + ' trading days.</div></div>' +
      '<div class="kpi"><div class="k-label">Win rate</div><div class="k-value">' + ui.fmtPct(k.winRate) + '</div><div class="k-sub">' + k.wins + ' wins, ' + k.losses + ' losses, ' + k.be + ' B/E ' + unitNoun + '.</div></div>' +
      '<div class="kpi"><div class="k-label">Profit factor</div><div class="k-value">' + ui.fmtPF(k.profitFactor) + '</div><div class="k-sub">Gross ' + ui.fmtMoney(k.grossWins) + ' vs ' + ui.fmtMoney(-k.grossLosses) + '.</div></div>' +
      '<div class="kpi"><div class="k-label">R factor</div><div class="k-value ' + ui.plClass(k.rFactor || 0) + '">' + ui.fmtR(k.rFactor) + '</div><div class="k-sub">Net R on total risk ' + ui.fmtMoney(k.totalRisk, { plus: false, dec: 0 }) + '.</div></div>';

    ui.qs('#kpiRow2').innerHTML =
      '<div class="kpi highlight"><div class="k-label">Net P&amp;L after expenses</div><div class="k-value ' + ui.plClass(netAfter) + '">' + ui.fmtMoney(netAfter) + '</div><div class="k-sub">Trading ' + ui.fmtMoney(k.totalPL) + ' − <a href="expenses.html">expenses</a> ' + ui.fmtMoney(expenses, { plus: false }) + ' in range.</div></div>' +
      '<div class="kpi"><div class="k-label">Largest winning day</div><div class="k-value pl-pos">' + (k.largestWinDay ? ui.fmtMoney(k.largestWinDay.pl) : '—') + '</div><div class="k-sub">' + (k.largestWinDay ? calc.fmtDateKey(k.largestWinDay.dateKey) + ' · ' + k.largestWinDay.count + ' trade' + (k.largestWinDay.count === 1 ? '' : 's') : 'No winning day in range.') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Largest losing day</div><div class="k-value pl-neg">' + (k.largestLossDay ? ui.fmtMoney(k.largestLossDay.pl) : '—') + '</div><div class="k-sub">' + (k.largestLossDay ? calc.fmtDateKey(k.largestLossDay.dateKey) + ' · ' + k.largestLossDay.count + ' trade' + (k.largestLossDay.count === 1 ? '' : 's') : 'No losing day in range.') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Day streaks</div><div class="k-value"><span class="pl-pos">' + k.bestWinStreak + '</span> <span class="faint" style="font-size:13px">win</span> · <span class="pl-neg">' + k.bestLossStreak + '</span> <span class="faint" style="font-size:13px">loss</span></div><div class="k-sub">Longest consecutive green / red days.</div></div>';
  }

  function renderChart(root) {
    var card = ui.el('div', { class: 'card' });
    var head = ui.el('div', { class: 'card-head' });
    head.appendChild(ui.el('div', {}, [
      ui.el('h2', { class: 'card-title', id: 'chartTitle', text: 'Cumulative P/L' }),
      ui.el('p', { class: 'card-sub', text: 'Hover the chart for day-by-day detail.' })
    ]));
    var seg = ui.el('div', { class: 'seg' });
    [['line', 'Cumulative line'], ['bar', 'Daily bars']].forEach(function (m) {
      var b = ui.el('button', { class: state.chart === m[0] ? 'on' : '', text: m[1] });
      b.addEventListener('click', function () {
        state.chart = m[0];
        ui.qsa('button', seg).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        persistFilters();
        fillChart();
      });
      seg.appendChild(b);
    });
    head.appendChild(seg);
    card.appendChild(head);
    card.appendChild(ui.el('div', { id: 'chartZone' }));
    root.appendChild(card);
  }

  function fillChart() {
    var series = calc.cumulativeSeries(filtered());
    ui.qs('#chartTitle').textContent = state.chart === 'bar' ? 'Daily P/L' : 'Cumulative P/L';
    TH.charts.plChart(ui.qs('#chartZone'), series, state.chart);
  }

  function renderResults(root) {
    var card = ui.el('div', { class: 'card' });
    var head = ui.el('div', { class: 'card-head' });
    head.appendChild(ui.el('div', {}, [
      ui.el('h2', { class: 'card-title', text: 'Results display' }),
      ui.el('p', { class: 'card-sub', id: 'resultsSub', text: '' })
    ]));
    var controls = ui.el('div', { class: 'row' });
    var seg = ui.el('div', { class: 'seg' });
    [['calendar', 'Calendar'], ['list', 'List']].forEach(function (m) {
      var b = ui.el('button', { class: state.view === m[0] ? 'on' : '', text: m[1] });
      b.addEventListener('click', function () {
        state.view = m[0];
        ui.qsa('button', seg).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        persistFilters();
        fillResults();
      });
      seg.appendChild(b);
    });
    controls.appendChild(seg);
    head.appendChild(controls);
    card.appendChild(head);
    card.appendChild(ui.el('div', { id: 'resultsZone' }));
    root.appendChild(card);
  }

  function fillResults() {
    var zone = ui.qs('#resultsZone');
    zone.innerHTML = '';
    var trades = filtered();
    ui.qs('#resultsSub').textContent = trades.length + ' trade' + (trades.length === 1 ? '' : 's') + ' in the selected range.';
    if (state.view === 'calendar') drawCalendar(zone, trades);
    else drawList(zone, trades);
  }

  function drawCalendar(zone, trades) {
    var daily = calc.dailyAggregates(trades);
    var today = calc.todayKey();

    var head = ui.el('div', { class: 'cal-head' });
    var nav = ui.el('div', { class: 'cal-nav' });
    var prev = ui.el('button', { text: '‹', 'aria-label': 'Previous month' });
    var next = ui.el('button', { text: '›', 'aria-label': 'Next month' });
    var lbl = ui.el('span', { class: 'cal-month', text: calc.monthLabel(state.calYear, state.calMonth) });
    nav.appendChild(prev); nav.appendChild(lbl); nav.appendChild(next);
    head.appendChild(nav);
    var jump = ui.el('button', { class: 'btn small ghost', text: 'Today' });
    head.appendChild(jump);
    zone.appendChild(head);
    prev.addEventListener('click', function () { shiftMonth(-1); });
    next.addEventListener('click', function () { shiftMonth(1); });
    jump.addEventListener('click', function () {
      var now = new Date();
      state.calYear = now.getFullYear(); state.calMonth = now.getMonth();
      fillResults();
    });
    function shiftMonth(d) {
      state.calMonth += d;
      if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
      if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
      fillResults();
    }

    var grid = ui.el('div', { class: 'cal-grid' });
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (d) {
      grid.appendChild(ui.el('div', { class: 'cal-dow', text: d }));
    });
    grid.appendChild(ui.el('div', { class: 'cal-dow', text: 'Week' }));

    calc.monthMatrix(state.calYear, state.calMonth).forEach(function (week) {
      var weekPL = 0, weekCount = 0;
      week.forEach(function (cell) {
        var d = daily[cell.dateKey];
        var cls = 'cal-cell' + (cell.inMonth ? '' : ' out') + (cell.dateKey === today ? ' today' : '');
        if (d && cell.inMonth) {
          cls += d.pl > 0.5 ? ' pos' : d.pl < -0.5 ? ' neg' : '';
          weekPL += d.pl; weekCount += d.count;
        }
        var box = ui.el('div', { class: cls });
        box.appendChild(ui.el('div', { class: 'c-day', text: String(cell.day) }));
        if (d && cell.inMonth) {
          var r = d.risk > 0 ? d.pl / d.risk : null;
          if (r !== null) box.appendChild(ui.el('div', { class: 'c-r ' + ui.plClass(d.pl), text: ui.fmtR(r) }));
          box.appendChild(ui.el('div', { class: 'c-pl ' + ui.plClass(d.pl), text: ui.fmtMoney(d.pl, { dec: 0 }) }));
          box.appendChild(ui.el('div', { class: 'c-n', text: d.count + ' trade' + (d.count === 1 ? '' : 's') }));
        }
        grid.appendChild(box);
      });
      var wk = ui.el('div', { class: 'cal-week' });
      wk.appendChild(ui.el('div', { class: 'c-day', text: 'Week' }));
      if (weekCount > 0) {
        wk.appendChild(ui.el('div', { class: 'c-pl ' + ui.plClass(weekPL), text: ui.fmtMoney(weekPL, { dec: 0 }) }));
        wk.appendChild(ui.el('div', { class: 'c-n', text: weekCount + ' trade' + (weekCount === 1 ? '' : 's') }));
      } else {
        wk.appendChild(ui.el('div', { class: 'c-n faint', text: '—' }));
      }
      grid.appendChild(wk);
    });
    zone.appendChild(grid);
  }

  function drawList(zone, trades) {
    if (!trades.length) {
      zone.appendChild(ui.emptyState({
        icon: '⊘', title: 'No trades in range',
        message: 'Widen the date range or clear filters to see results here.',
        action: { href: 'trades.html', label: 'Open trades' }
      }));
      return;
    }
    var accIdx = {};
    (store.get('accounts') || []).forEach(function (a) { accIdx[a.id] = a; });
    var wrap = ui.el('div', { class: 'tbl-wrap' });
    var tbl = ui.el('table', { class: 'tbl' });
    tbl.innerHTML = '<thead><tr><th>Date</th><th>Trade</th><th>Account</th><th class="num">Risk</th><th class="num">P/L</th><th class="num">R</th><th></th></tr></thead>';
    var tbody = ui.el('tbody');
    trades.slice().sort(function (a, b) { return (b.entryTime || '') < (a.entryTime || '') ? -1 : 1; })
      .forEach(function (t) {
        var net = calc.net(t);
        var tr = ui.el('tr');
        tr.innerHTML =
          '<td class="nowrap">' + calc.fmtDateKey(t.dateKey) + '<br><span class="muted" style="font-size:11px">' + calc.fmtTime(t.entryTime) + '</span></td>' +
          '<td><b>' + t.symbol + '</b> ' + (t.direction === 'long' ? '<span class="badge green">long</span>' : '<span class="badge red">short</span>') + ' · ' + t.contracts + 'x' + (t.entryFillCount > 1 ? ' <span class="badge violet">pyramid</span>' : '') + '</td>' +
          '<td>' + ui.esc(accIdx[t.accountId] ? accIdx[t.accountId].name : '—') + '</td>' +
          '<td class="num">' + (t.riskAmount ? ui.fmtMoney(t.riskAmount, { plus: false, dec: 0 }) : '—') + '</td>' +
          '<td class="num ' + ui.plClass(net) + '"><b>' + ui.fmtMoney(net) + '</b></td>' +
          '<td class="num">' + ui.fmtR(calc.rMultiple(t)) + '</td>' +
          '<td class="right"><a class="btn small ghost" href="trade-review.html?id=' + encodeURIComponent(t.id) + '">Review</a></td>';
        tbody.appendChild(tr);
      });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    zone.appendChild(wrap);
  }

  function refresh() {
    fillKpis();
    fillChart();
    fillResults();
  }

  function rerenderAll() {
    var root = ui.qs('#pageBody');
    root.innerHTML = '';
    var side = ui.qs('#headSide');
    if (side) side.innerHTML = '';
    build(root);
  }

  /* first-steps checklist shown on fresh (non-demo) journals until dismissed */
  function renderGettingStarted(root) {
    var settings = store.get('settings') || {};
    if (!settings.gettingStarted) return;
    var trades = store.get('trades') || [];
    var accounts = (store.get('accounts') || []).filter(function (a) { return a.status === 'active'; });
    var steps = [
      { label: 'Add your trading account(s)', done: accounts.length > 1 || accounts.some(function (a) { return a.name !== 'My Account'; }), href: 'accounts.html' },
      { label: 'Set prop-firm rules (if you trade evals)', done: accounts.some(function (a) { return a.rules && a.rules.startingBalance != null; }), href: 'compliance.html' },
      { label: 'Log or import your first trade', done: trades.length > 0, href: 'manual-entry.html' },
      { label: 'Write your first pre-market prep', done: (store.get('prep') || []).length > 0, href: 'prep-review.html' }
    ];
    var doneCount = steps.filter(function (s) { return s.done; }).length;
    var card = ui.el('div', { class: 'card', style: 'border-color:rgba(161,98,7,.3)' });
    var head = ui.el('div', { class: 'card-head' });
    head.appendChild(ui.el('div', {}, [
      ui.el('h2', { class: 'card-title', text: 'Getting started — ' + doneCount + ' of ' + steps.length }),
      ui.el('p', { class: 'card-sub', text: 'A journal only works if it gets fed. Four steps and you’re rolling.' })
    ]));
    head.appendChild(ui.el('button', {
      class: 'btn small ghost', text: 'Dismiss',
      onclick: function () {
        var s = store.get('settings') || {};
        s.gettingStarted = false;
        store.save('settings', s);
        card.remove();
      }
    }));
    card.appendChild(head);
    var list = ui.el('div', { class: 'stack', style: 'gap:6px' });
    steps.forEach(function (s) {
      list.appendChild(ui.el('a', {
        class: 'rule-item', href: s.href, style: 'text-decoration:none;color:inherit',
        html: '<span style="width:20px;flex:none;font-weight:800;color:' + (s.done ? 'var(--green)' : 'var(--faint)') + '">' + (s.done ? '✓' : '○') + '</span>' +
          '<span class="ri-txt"' + (s.done ? ' style="text-decoration:line-through;color:var(--muted)"' : '') + '>' + ui.esc(s.label) + '</span><span class="faint">›</span>'
      }));
    });
    card.appendChild(list);
    root.appendChild(card);
  }

  function renderAlerts(root) {
    var trades = store.get('trades') || [];
    var accounts = (store.get('accounts') || []).filter(function (a) { return a.status === 'active'; });
    var breached = accounts.map(function (a) {
      var c = calc.compliance(a, trades);
      return c && c.breaches.length ? { account: a, c: c } : null;
    }).filter(Boolean);
    if (breached.length) {
      var banner = ui.el('div', {
        class: 'card',
        style: 'border-color:var(--cell-neg-line);background:linear-gradient(170deg,var(--cell-neg-bg),var(--panel2));padding:12px 16px'
      });
      var row = ui.el('div', { class: 'row between' });
      row.appendChild(ui.el('div', {
        html: '<b class="pl-neg">⚠ Prop-rule breach</b> <span class="muted" style="font-size:12.5px">— ' +
          breached.map(function (b) {
            return ui.esc(b.account.name) + ' (' + b.c.breaches[b.c.breaches.length - 1].type.replace('-', ' ') + ')';
          }).join(', ') + '</span>'
      }));
      row.appendChild(ui.el('a', { class: 'btn small', href: 'compliance.html', text: 'Review rules' }));
      banner.appendChild(row);
      root.appendChild(banner);
    }

    /* goal streak chips */
    var streaks = calc.goalStreaks(store.get('goals'), {
      trades: trades, prep: store.get('prep') || [], accounts: accounts
    });
    if (streaks.length) {
      var chipRow = ui.el('div', { class: 'row', style: 'gap:6px' });
      streaks.forEach(function (s) {
        chipRow.appendChild(ui.el('a', {
          class: 'badge ' + (s.current > 0 ? 'teal' : ''),
          href: 'prep-review.html',
          style: 'text-decoration:none',
          title: s.label + ' — best streak ' + s.best + ' days',
          html: s.icon + ' ' + ui.esc(s.label) + ' · <b>' + s.current + 'd</b>'
        }));
      });
      root.appendChild(chipRow);
    }
  }

  function build(root) {
    var trades = store.get('trades') || [];
    var accounts = (store.get('accounts') || []).filter(function (a) { return a.status === 'active'; });
    ui.headStat(String(accounts.length), 'Accounts');
    ui.headStat(String(trades.length), 'Trades');
    renderGettingStarted(root);
    renderAlerts(root);
    renderFilterBar(root);
    renderKpis(root);
    renderChart(root);
    renderResults(root);
    refresh();
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    loadSavedFilters();
    build(ui.qs('#pageBody'));
  });
})();
