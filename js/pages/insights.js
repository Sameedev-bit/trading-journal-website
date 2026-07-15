/* Insights page — edge + psychology breakdowns */
(function () {
  'use strict';
  var ui, calc, store;
  var state = { accounts: [], preset: 'last90', from: null, to: null };

  function filtered() {
    return calc.filterTrades(store.get('trades') || [], {
      accounts: state.accounts, from: state.from, to: state.to
    }, { accounts: store.get('accounts') || [], tags: store.get('tags') || [] });
  }

  /* horizontal div-bar rows: [{label, value($), count, extra?}] */
  function barList(items, opts) {
    opts = opts || {};
    var wrap = ui.el('div', { class: 'stack', style: 'gap:7px' });
    if (!items.length) {
      wrap.appendChild(ui.el('p', { class: 'muted', style: 'font-size:12px;margin:0', text: 'Not enough data in this range.' }));
      return wrap;
    }
    var maxAbs = Math.max.apply(null, items.map(function (i) { return Math.abs(i.pl); })) || 1;
    items.forEach(function (i) {
      var row = ui.el('div', { style: 'display:grid;grid-template-columns:110px 1fr 92px;gap:10px;align-items:center' });
      row.appendChild(ui.el('div', { style: 'font-size:12px;font-weight:600;color:var(--text-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: i.label }));
      var track = ui.el('div', { style: 'height:14px;border-radius:7px;background:var(--bg2);border:1px solid var(--line);overflow:hidden' });
      var pct = Math.max(3, Math.round(Math.abs(i.pl) / maxAbs * 100));
      track.appendChild(ui.el('div', {
        style: 'height:100%;width:' + pct + '%;border-radius:7px;background:' + (i.pl >= 0 ? 'var(--green)' : 'var(--red)') + ';opacity:.75'
      }));
      row.appendChild(track);
      row.appendChild(ui.el('div', {
        class: 'right',
        html: '<b class="' + ui.plClass(i.pl) + '" style="font-size:12.5px">' + ui.fmtMoney(i.pl, { dec: 0 }) + '</b>' +
          '<span class="faint" style="font-size:10.5px"> · ' + i.count + (opts.unit || ' trades') + '</span>'
      }));
      wrap.appendChild(row);
    });
    return wrap;
  }

  function sectionCard(title, sub, content) {
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: title }),
        ui.el('p', { class: 'card-sub', text: sub })
      ])
    ]));
    card.appendChild(content);
    return card;
  }

  function hourLabel(h) {
    var ap = h >= 12 ? 'PM' : 'AM';
    var hr = h % 12 || 12;
    return hr + ' ' + ap;
  }

  function refresh() {
    var zone = ui.qs('#insightZone');
    zone.innerHTML = '';
    var trades = filtered();
    var e = calc.edgeStats(trades);
    var tags = store.get('tags') || [];
    var tagIdx = {};
    tags.forEach(function (t) { tagIdx[t.id] = t; });

    /* KPIs */
    var kpis = ui.el('div', { class: 'kpis' });
    kpis.innerHTML =
      '<div class="kpi highlight"><div class="k-label">Expectancy</div><div class="k-value ' + ui.plClass(e.expectancy || 0) + '">' + ui.fmtMoney(e.expectancy) + '</div><div class="k-sub">' + (e.expectancyR !== null ? ui.fmtR(e.expectancyR) + ' per trade on average.' : 'Per trade, over ' + trades.length + ' trades.') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Avg win vs loss</div><div class="k-value"><span class="pl-pos">' + ui.fmtMoney(e.avgWin, { plus: false, dec: 0 }) + '</span> <span class="faint" style="font-size:14px">/</span> <span class="pl-neg">' + ui.fmtMoney(e.avgLoss ? -Math.abs(e.avgLoss) : null, { dec: 0 }) + '</span></div><div class="k-sub">Average winning vs losing trade.</div></div>' +
      '<div class="kpi"><div class="k-label">Payoff ratio</div><div class="k-value">' + (e.payoff !== null ? e.payoff.toFixed(2) : '—') + '</div><div class="k-sub">Dollar won per dollar lost.</div></div>' +
      '<div class="kpi"><div class="k-label">Median hold</div><div class="k-value">' + (e.medianHoldMin !== null ? Math.round(e.medianHoldMin) + '<span class="muted" style="font-size:13px"> min</span>' : '—') + '</div><div class="k-sub">Typical time in a trade.</div></div>';
    zone.appendChild(kpis);

    var cols = ui.el('div', { class: 'grid-2' });
    var left = ui.el('div', { class: 'stack' });
    var right = ui.el('div', { class: 'stack' });

    /* edge breakdowns */
    left.appendChild(sectionCard('P/L by time of day', 'Entry hour, local time — when the market pays you.',
      barList(calc.breakdown(trades, function (t) {
        if (!t.entryTime) return null;
        var h = new Date(t.entryTime).getHours();
        return { key: 'h' + h, label: hourLabel(h), order: h };
      }))));

    left.appendChild(sectionCard('P/L by day of week', 'Some days deserve smaller size — or none.',
      barList(calc.breakdown(trades, function (t) {
        var d = calc.keyToDate(t.dateKey).getDay();
        return { key: 'd' + d, label: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d], order: d };
      }))));

    left.appendChild(sectionCard('P/L by symbol', 'Which markets are actually yours.',
      barList(calc.breakdown(trades, function (t) { return { key: t.symbol, label: t.symbol }; }))));

    left.appendChild(sectionCard('P/L by hold time', 'Scalps vs holds — where your patience pays.',
      barList(calc.breakdown(trades, function (t) {
        var m = calc.holdMinutes(t);
        if (m === null) return null;
        if (m < 5) return { key: 'b0', label: '< 5 min', order: 0 };
        if (m < 15) return { key: 'b1', label: '5–15 min', order: 1 };
        if (m < 30) return { key: 'b2', label: '15–30 min', order: 2 };
        if (m < 60) return { key: 'b3', label: '30–60 min', order: 3 };
        return { key: 'b4', label: '1 hr +', order: 4 };
      }))));

    /* setup + psychology */
    right.appendChild(sectionCard('P/L by tag', 'Setups from your strategy playbook.',
      barList(calc.breakdown(trades, function (t) {
        return (t.tagIds || []).map(function (id) {
          return tagIdx[id] ? { key: id, label: tagIdx[id].label } : null;
        }).filter(Boolean);
      }))));

    right.appendChild(sectionCard('P/L by emotion', 'What each state of mind costs — or earns.',
      barList(calc.breakdown(trades, function (t) {
        return (t.emotions || []).map(function (k) {
          return calc.EMOTIONS[k] ? { key: k, label: calc.EMOTIONS[k].label } : null;
        }).filter(Boolean);
      }))));

    /* confidence calibration */
    var confRows = calc.breakdown(trades, function (t) {
      if (!t.confidence) return null;
      return { key: 'c' + t.confidence, label: 'Confidence ' + t.confidence, order: t.confidence };
    });
    var confWrap = ui.el('div', { class: 'stack', style: 'gap:7px' });
    if (!confRows.length) confWrap.appendChild(ui.el('p', { class: 'muted', style: 'font-size:12px;margin:0', text: 'Rate confidence on trade reviews to calibrate this.' }));
    confRows.forEach(function (b) {
      var decided = b.wins + b.losses;
      var wr = decided ? b.wins / decided : null;
      var row = ui.el('div', { style: 'display:grid;grid-template-columns:110px 1fr 92px;gap:10px;align-items:center' });
      row.appendChild(ui.el('div', { style: 'font-size:12px;font-weight:600;color:var(--text-soft)', text: b.label }));
      var track = ui.el('div', { style: 'height:14px;border-radius:7px;background:var(--bg2);border:1px solid var(--line);overflow:hidden' });
      track.appendChild(ui.el('div', { style: 'height:100%;width:' + Math.round((wr || 0) * 100) + '%;border-radius:7px;background:var(--accent);opacity:.8' }));
      row.appendChild(track);
      row.appendChild(ui.el('div', { class: 'right', html: '<b style="font-size:12.5px">' + ui.fmtPct(wr) + '</b><span class="faint" style="font-size:10.5px"> · ' + b.count + ' trades</span>' }));
      confWrap.appendChild(row);
    });
    right.appendChild(sectionCard('Confidence calibration', 'Does feeling sure actually predict winning? Bars show win rate.', confWrap));

    /* mistakes */
    var mistakeRows = calc.breakdown(trades, function (t) {
      return (t.mistakes || []).map(function (k) {
        return calc.MISTAKES[k] ? { key: k, label: calc.MISTAKES[k].label } : null;
      }).filter(Boolean);
    }).sort(function (a, b) { return a.pl - b.pl; });
    right.appendChild(sectionCard('Cost of mistakes', 'Tagged on trade reviews. The same mistake ten times is a pattern, not bad luck.',
      barList(mistakeRows, { unit: ' times' })));

    cols.appendChild(left);
    cols.appendChild(right);
    zone.appendChild(cols);
  }

  function build(root) {
    var accounts = store.get('accounts') || [];
    var r = calc.presetRange(state.preset);
    state.from = r.from; state.to = r.to;

    var bar = ui.el('div', { class: 'filterbar' });
    bar.appendChild(ui.el('span', { class: 'fb-label', text: 'Filter insights' }));
    bar.appendChild(ui.multiSelect({
      label: 'Accounts', allLabel: 'All',
      items: accounts.map(function (a) { return { value: a.id, label: a.name }; }),
      selected: [],
      onChange: function (vals) { state.accounts = vals.length === accounts.length ? [] : vals; refresh(); }
    }));
    var presetSel = ui.el('select', {
      style: 'width:auto',
      html: '<option value="month">Current month</option><option value="last30">Last 30 days</option>' +
        '<option value="last90" selected>Last 90 days</option><option value="ytd">Year to date</option><option value="all">All results</option>'
    });
    presetSel.addEventListener('change', function () {
      state.preset = presetSel.value;
      var pr = calc.presetRange(state.preset);
      state.from = pr.from; state.to = pr.to;
      refresh();
    });
    bar.appendChild(presetSel);
    root.appendChild(bar);
    root.appendChild(ui.el('div', { class: 'stack', id: 'insightZone' }));

    var trades = store.get('trades') || [];
    ui.headStat(String(trades.length), 'Trades analyzed');
    refresh();
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    build(ui.qs('#pageBody'));
  });
})();
