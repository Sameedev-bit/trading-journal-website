/* Monthly Report page — printable month-end summary */
(function () {
  'use strict';
  var ui, calc, store;
  var year, month0;

  function monthRange() {
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var from = year + '-' + pad(month0 + 1) + '-01';
    var last = new Date(year, month0 + 1, 0).getDate();
    return { from: from, to: from.slice(0, 8) + pad(last) };
  }

  function build(root) {
    root.innerHTML = '';
    var r = monthRange();
    var allTrades = store.get('trades') || [];
    var trades = calc.filterTrades(allTrades, { from: r.from, to: r.to }, {});
    var accounts = (store.get('accounts') || []).filter(function (a) { return a.status === 'active'; });
    var k = calc.kpis(trades, { mode: 'day' });
    var e = calc.edgeStats(trades);
    var expenses = calc.expenseTotal(store.get('expenses'), r.from, r.to);
    var netAfter = k.totalPL - expenses;
    var prep = calc.prepStats(store.get('prep'), r.from, r.to);

    /* controls (hidden in print) */
    var controls = ui.el('div', { class: 'card no-print' });
    var head = ui.el('div', { class: 'cal-head', style: 'margin:0' });
    var nav = ui.el('div', { class: 'cal-nav' });
    var prev = ui.el('button', { text: '‹', 'aria-label': 'Previous month' });
    var next = ui.el('button', { text: '›', 'aria-label': 'Next month' });
    nav.appendChild(prev);
    nav.appendChild(ui.el('span', { class: 'cal-month', text: calc.monthLabel(year, month0) }));
    nav.appendChild(next);
    head.appendChild(nav);
    head.appendChild(ui.el('button', {
      class: 'btn primary', text: '⎙ Print / Save as PDF',
      onclick: function () { window.print(); }
    }));
    controls.appendChild(head);
    root.appendChild(controls);
    prev.addEventListener('click', function () { shift(-1); });
    next.addEventListener('click', function () { shift(1); });
    function shift(d) {
      month0 += d;
      if (month0 < 0) { month0 = 11; year--; }
      if (month0 > 11) { month0 = 0; year++; }
      build(root);
    }

    /* report sheet */
    var sheet = ui.el('div', { class: 'card report-sheet' });
    sheet.appendChild(ui.el('div', { class: 'row between', style: 'margin-bottom:14px' }, [
      ui.el('div', {}, [
        ui.el('h2', { style: 'font-family:var(--font-display);margin:0', text: 'TradeHarbor — Monthly Report' }),
        ui.el('p', { class: 'muted', style: 'margin:2px 0 0;font-size:13px', text: calc.monthLabel(year, month0) + ' · generated ' + calc.fmtDateKey(calc.todayKey()) })
      ]),
      ui.el('img', { src: '../assets/logo.svg', alt: '', style: 'width:38px;height:38px' })
    ]));

    var kpis = ui.el('div', { class: 'kpis' });
    kpis.innerHTML =
      '<div class="kpi"><div class="k-label">Trading P/L</div><div class="k-value ' + ui.plClass(k.totalPL) + '">' + ui.fmtMoney(k.totalPL) + '</div><div class="k-sub">' + k.tradeCount + ' trades · ' + k.dayCount + ' trading days.</div></div>' +
      '<div class="kpi"><div class="k-label">Win rate (days)</div><div class="k-value">' + ui.fmtPct(k.winRate) + '</div><div class="k-sub">' + k.wins + ' green, ' + k.losses + ' red, ' + k.be + ' flat.</div></div>' +
      '<div class="kpi"><div class="k-label">Expectancy</div><div class="k-value ' + ui.plClass(e.expectancy || 0) + '">' + ui.fmtMoney(e.expectancy) + '</div><div class="k-sub">Per trade' + (e.payoff !== null ? ' · payoff ' + e.payoff.toFixed(2) : '') + '.</div></div>' +
      '<div class="kpi highlight"><div class="k-label">Net after expenses</div><div class="k-value ' + ui.plClass(netAfter) + '">' + ui.fmtMoney(netAfter) + '</div><div class="k-sub">Expenses ' + ui.fmtMoney(expenses, { plus: false }) + ' this month.</div></div>';
    sheet.appendChild(kpis);

    /* equity curve for the month */
    var chartCard = ui.el('div', { style: 'margin-top:14px' });
    chartCard.appendChild(ui.el('h3', { text: 'Cumulative P/L' }));
    var zone = ui.el('div');
    chartCard.appendChild(zone);
    sheet.appendChild(chartCard);
    TH.charts.plChart(zone, calc.cumulativeSeries(trades), 'line');

    /* calendar */
    var calWrap = ui.el('div', { style: 'margin-top:16px' });
    calWrap.appendChild(ui.el('h3', { text: 'Daily results' }));
    var daily = calc.dailyAggregates(trades);
    var grid = ui.el('div', { class: 'cal-grid no-week' });
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (d) {
      grid.appendChild(ui.el('div', { class: 'cal-dow', text: d }));
    });
    calc.monthMatrix(year, month0).forEach(function (week) {
      week.forEach(function (cell) {
        var d = daily[cell.dateKey];
        var cls = 'cal-cell' + (cell.inMonth ? '' : ' out') + (d && cell.inMonth ? (d.pl > 0.5 ? ' pos' : d.pl < -0.5 ? ' neg' : '') : '');
        var box = ui.el('div', { class: cls, style: 'min-height:52px' });
        box.appendChild(ui.el('div', { class: 'c-day', text: String(cell.day) }));
        if (d && cell.inMonth) box.appendChild(ui.el('div', { class: 'c-pl ' + ui.plClass(d.pl), text: ui.fmtMoney(d.pl, { dec: 0 }) }));
        grid.appendChild(box);
      });
    });
    calWrap.appendChild(grid);
    sheet.appendChild(calWrap);

    /* breakdowns + process + compliance */
    var cols = ui.el('div', { class: 'grid-2', style: 'margin-top:16px' });

    var bySym = ui.el('div');
    bySym.appendChild(ui.el('h3', { text: 'By symbol' }));
    var symRows = calc.breakdown(trades, function (t) { return { key: t.symbol, label: t.symbol }; });
    var tbl = ui.el('table', { class: 'tbl' });
    tbl.innerHTML = '<thead><tr><th>Symbol</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">P/L</th></tr></thead>' +
      '<tbody>' + (symRows.length ? symRows.map(function (b) {
        var decided = b.wins + b.losses;
        return '<tr><td><b>' + ui.esc(b.label) + '</b></td><td class="num">' + b.count + '</td><td class="num">' + ui.fmtPct(decided ? b.wins / decided : null) + '</td><td class="num ' + ui.plClass(b.pl) + '"><b>' + ui.fmtMoney(b.pl, { dec: 0 }) + '</b></td></tr>';
      }).join('') : '<tr><td colspan="4" class="muted">No trades this month.</td></tr>') + '</tbody>';
    bySym.appendChild(tbl);
    cols.appendChild(bySym);

    var proc = ui.el('div');
    proc.appendChild(ui.el('h3', { text: 'Process & compliance' }));
    var dl = ui.el('dl', { class: 'dl' });
    var complianceLines = accounts.map(function (a) {
      var c = calc.compliance(a, trades);
      if (!c) return null;
      return '<span>' + ui.esc(a.name) + ': ' + (c.breaches.length
        ? '<b class="pl-neg">' + c.breaches.length + ' breach' + (c.breaches.length === 1 ? '' : 'es') + '</b>'
        : '<b class="pl-pos">clean</b>') + '</span>';
    }).filter(Boolean);
    dl.innerHTML =
      '<dt>Plan adherence</dt><dd>' + ui.fmtPct(prep.planAdherence) + (prep.planKnownCount ? ' <span class="muted">(' + prep.planKnownCount + ' scored recaps)</span>' : '') + '</dd>' +
      '<dt>Bias accuracy</dt><dd>' + ui.fmtPct(prep.biasAccuracy) + '</dd>' +
      '<dt>Recaps logged</dt><dd>' + prep.recaps + ' daily · ' + prep.weeklyRecaps + ' weekly</dd>' +
      '<dt>Rule compliance</dt><dd>' + (complianceLines.length ? complianceLines.join('<br>') : '<span class="muted">No rule-tracked accounts.</span>') + '</dd>' +
      '<dt>Largest win day</dt><dd class="pl-pos">' + (k.largestWinDay ? ui.fmtMoney(k.largestWinDay.pl) + ' · ' + calc.fmtDateKey(k.largestWinDay.dateKey) : '—') + '</dd>' +
      '<dt>Largest loss day</dt><dd class="pl-neg">' + (k.largestLossDay ? ui.fmtMoney(k.largestLossDay.pl) + ' · ' + calc.fmtDateKey(k.largestLossDay.dateKey) : '—') + '</dd>';
    proc.appendChild(dl);
    cols.appendChild(proc);

    sheet.appendChild(cols);
    sheet.appendChild(ui.el('p', {
      class: 'faint', style: 'font-size:10px;margin:18px 0 0',
      text: 'Generated by TradeHarbor. Journaling data only — not financial advice. Past performance is not indicative of future results.'
    }));
    root.appendChild(sheet);
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    var now = new Date();
    year = now.getFullYear();
    month0 = now.getMonth();
    build(ui.qs('#pageBody'));
  });
})();
