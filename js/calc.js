/* TradeHarbor pure calculation helpers — no DOM, no storage */
window.TH = window.TH || {};
TH.calc = (function () {
  'use strict';

  var POINT_VALUES = { ES: 50, MES: 5, NQ: 20, MNQ: 2 };
  var BE_BAND = 0.5; // |net| <= $0.50 counts as breakeven

  /* ---------- dates ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toDateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayKey() { return toDateKey(new Date()); }
  function keyToDate(key) { return new Date(key + 'T12:00:00'); } // noon avoids DST edges
  function addDays(key, n) {
    var d = keyToDate(key);
    d.setDate(d.getDate() + n);
    return toDateKey(d);
  }
  function daysBetween(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / 86400000); }
  function clampDay(y, m, day) { // m is 1-based
    var last = new Date(y, m, 0).getDate();
    return y + '-' + pad(m) + '-' + pad(Math.min(day, last));
  }
  function advanceCycle(key, cycle) {
    var parts = key.split('-').map(Number), y = parts[0], m = parts[1], d = parts[2];
    if (cycle === 'yearly') return clampDay(y + 1, m, d);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    return clampDay(y, m, d);
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTHS_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthLabel(y, m0) { return MONTHS[m0] + ' ' + y; }
  function fmtDateKey(key) {
    if (!key) return '—';
    var p = key.split('-');
    return MONTHS_S[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
  }
  function fmtIso(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return MONTHS_S[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' · ' + h + ':' + pad(d.getMinutes()) + ' ' + ap;
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + pad(d.getMinutes()) + ' ' + ap;
  }

  /* 6x7 month grid; weeks start Sunday. Returns [{dateKey, day, inMonth}] rows. */
  function monthMatrix(year, month0) {
    var first = new Date(year, month0, 1);
    var start = new Date(year, month0, 1 - first.getDay());
    var weeks = [];
    for (var w = 0; w < 6; w++) {
      var row = [];
      for (var i = 0; i < 7; i++) {
        var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
        row.push({ dateKey: toDateKey(d), day: d.getDate(), dow: d.getDay(), inMonth: d.getMonth() === month0 });
      }
      weeks.push(row);
    }
    // drop a trailing all-out-of-month week
    if (weeks[5].every(function (c) { return !c.inMonth; })) weeks.pop();
    return weeks;
  }

  /* ---------- per-trade derived values ---------- */
  function pointValue(symbol) { return POINT_VALUES[symbol] || 1; }
  function gross(t) {
    var sign = t.direction === 'long' ? 1 : -1;
    return (t.exitPrice - t.entryPrice) * sign * pointValue(t.symbol) * (t.contracts || 1);
  }
  function net(t) { return gross(t) - (t.commissions || 0); }
  function points(t) {
    var sign = t.direction === 'long' ? 1 : -1;
    return (t.exitPrice - t.entryPrice) * sign;
  }
  function rMultiple(t) {
    if (!t.riskAmount || t.riskAmount <= 0) return null;
    return net(t) / t.riskAmount;
  }
  function result(t) {
    var n = net(t);
    if (n > BE_BAND) return 'win';
    if (n < -BE_BAND) return 'loss';
    return 'be';
  }

  /* ---------- filtering ---------- */
  function filterTrades(trades, f, ctx) {
    f = f || {};
    ctx = ctx || {};
    var accIndex = {};
    (ctx.accounts || []).forEach(function (a) { accIndex[a.id] = a; });
    var tagIndex = {};
    (ctx.tags || []).forEach(function (t) { tagIndex[t.id] = t; });
    var q = (f.search || '').trim().toLowerCase();
    return trades.filter(function (t) {
      if (f.accounts && f.accounts.length && f.accounts.indexOf(t.accountId) === -1) return false;
      if (f.from && t.dateKey < f.from) return false;
      if (f.to && t.dateKey > f.to) return false;
      if (f.sources && f.sources.length && f.sources.indexOf(t.source) === -1) return false;
      if (f.symbol && t.symbol !== f.symbol) return false;
      if (f.result && result(t) !== f.result) return false;
      if (f.tags && f.tags.length) {
        var hit = (t.tagIds || []).some(function (id) { return f.tags.indexOf(id) !== -1; });
        if (!hit) return false;
      }
      if (q) {
        var acc = accIndex[t.accountId];
        var hay = [t.symbol, t.direction, t.source, t.notes || '', acc ? acc.name : '']
          .concat((t.tagIds || []).map(function (id) { return tagIndex[id] ? tagIndex[id].label : ''; }))
          .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /* Date-range presets shared by stats + trades pages */
  function presetRange(preset) {
    var today = todayKey();
    var d = new Date();
    switch (preset) {
      case 'today': return { from: today, to: today };
      case 'week': {
        var start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
        return { from: toDateKey(start), to: today };
      }
      case 'month': return { from: toDateKey(new Date(d.getFullYear(), d.getMonth(), 1)), to: today };
      case 'last30': return { from: addDays(today, -29), to: today };
      case 'last90': return { from: addDays(today, -89), to: today };
      case 'ytd': return { from: d.getFullYear() + '-01-01', to: today };
      default: return { from: null, to: null }; // all
    }
  }

  /* ---------- aggregation ---------- */
  function dailyAggregates(trades) {
    var map = {};
    trades.forEach(function (t) {
      var d = map[t.dateKey] || (map[t.dateKey] = { dateKey: t.dateKey, pl: 0, risk: 0, count: 0 });
      d.pl += net(t);
      d.risk += (t.riskAmount > 0 ? t.riskAmount : 0);
      d.count += 1;
    });
    return map;
  }
  function sortedDays(daily) {
    return Object.keys(daily).sort().map(function (k) { return daily[k]; });
  }
  function cumulativeSeries(trades) {
    var days = sortedDays(dailyAggregates(trades));
    var cum = 0;
    return days.map(function (d) {
      cum += d.pl;
      return { dateKey: d.dateKey, day: d.pl, cum: cum, count: d.count };
    });
  }

  function kpis(trades, opts) {
    opts = opts || {};
    var mode = opts.mode || 'trade'; // 'trade' | 'day'
    var out = {
      totalPL: 0, totalRisk: 0, wins: 0, losses: 0, be: 0,
      grossWins: 0, grossLosses: 0, profitFactor: null, winRate: null, rFactor: null,
      largestWinDay: null, largestLossDay: null, bestWinStreak: 0, bestLossStreak: 0,
      tradeCount: trades.length, dayCount: 0
    };
    trades.forEach(function (t) {
      var n = net(t);
      out.totalPL += n;
      if (t.riskAmount > 0) out.totalRisk += t.riskAmount;
    });

    var daily = dailyAggregates(trades);
    var days = sortedDays(daily);
    out.dayCount = days.length;

    var units = mode === 'day'
      ? days.map(function (d) { return d.pl; })
      : trades.map(function (t) { return net(t); });
    units.forEach(function (n) {
      if (n > BE_BAND) { out.wins++; out.grossWins += n; }
      else if (n < -BE_BAND) { out.losses++; out.grossLosses += -n; }
      else out.be++;
    });
    var decided = out.wins + out.losses;
    if (decided > 0) out.winRate = out.wins / decided;
    if (out.grossLosses > 0) out.profitFactor = out.grossWins / out.grossLosses;
    else if (out.grossWins > 0) out.profitFactor = Infinity;
    if (out.totalRisk > 0) out.rFactor = out.totalPL / out.totalRisk;

    days.forEach(function (d) {
      if (!out.largestWinDay || d.pl > out.largestWinDay.pl) out.largestWinDay = d;
      if (!out.largestLossDay || d.pl < out.largestLossDay.pl) out.largestLossDay = d;
    });
    if (out.largestWinDay && out.largestWinDay.pl <= 0) out.largestWinDay = null;
    if (out.largestLossDay && out.largestLossDay.pl >= 0) out.largestLossDay = null;

    var ws = 0, ls = 0;
    days.forEach(function (d) {
      if (d.pl > BE_BAND) { ws++; ls = 0; }
      else if (d.pl < -BE_BAND) { ls++; ws = 0; }
      else { ws = 0; ls = 0; }
      if (ws > out.bestWinStreak) out.bestWinStreak = ws;
      if (ls > out.bestLossStreak) out.bestLossStreak = ls;
    });
    return out;
  }

  /* ---------- expenses ---------- */
  function expensesInRange(expenses, from, to) {
    return (expenses || []).filter(function (e) {
      if (from && e.dateKey < from) return false;
      if (to && e.dateKey > to) return false;
      return true;
    });
  }
  function expenseTotal(expenses, from, to) {
    return expensesInRange(expenses, from, to).reduce(function (s, e) { return s + (e.amount || 0); }, 0);
  }
  function monthlyRecurring(subs) {
    return (subs || []).reduce(function (s, x) {
      if (!x.autoRenew) return s;
      return s + (x.cycle === 'yearly' ? x.amount / 12 : x.amount);
    }, 0);
  }
  function upcomingRenewals(subs, days) {
    var today = todayKey();
    var limit = addDays(today, days || 30);
    return (subs || [])
      .filter(function (s) { return s.nextRenewal >= today && s.nextRenewal <= limit; })
      .sort(function (a, b) { return a.nextRenewal < b.nextRenewal ? -1 : 1; });
  }

  /* ---------- prep & review ---------- */
  function prepStats(entries, from, to) {
    var inRange = (entries || []).filter(function (e) {
      if (from && e.dateKey < from) return false;
      if (to && e.dateKey > to) return false;
      return true;
    });
    var recaps = inRange.filter(function (e) { return e.kind === 'recap'; });
    var biasKnown = recaps.filter(function (e) { return typeof e.fields.biasCorrect === 'boolean'; });
    var planKnown = recaps.filter(function (e) { return typeof e.fields.followedPlan === 'boolean'; });
    return {
      biasAccuracy: biasKnown.length ? biasKnown.filter(function (e) { return e.fields.biasCorrect; }).length / biasKnown.length : null,
      planAdherence: planKnown.length ? planKnown.filter(function (e) { return e.fields.followedPlan; }).length / planKnown.length : null,
      planKnownCount: planKnown.length,
      biasKnownCount: biasKnown.length,
      weeklyPreps: inRange.filter(function (e) { return e.kind === 'weeklyPrep'; }).length,
      weeklyRecaps: inRange.filter(function (e) { return e.kind === 'weeklyRecap'; }).length,
      premarkets: inRange.filter(function (e) { return e.kind === 'premarket'; }).length,
      recaps: recaps.length
    };
  }

  return {
    POINT_VALUES: POINT_VALUES,
    toDateKey: toDateKey, todayKey: todayKey, keyToDate: keyToDate, addDays: addDays,
    daysBetween: daysBetween, advanceCycle: advanceCycle,
    monthLabel: monthLabel, monthMatrix: monthMatrix, fmtDateKey: fmtDateKey, fmtIso: fmtIso, fmtTime: fmtTime,
    gross: gross, net: net, points: points, rMultiple: rMultiple, result: result,
    filterTrades: filterTrades, presetRange: presetRange,
    dailyAggregates: dailyAggregates, cumulativeSeries: cumulativeSeries, kpis: kpis,
    expensesInRange: expensesInRange, expenseTotal: expenseTotal,
    monthlyRecurring: monthlyRecurring, upcomingRenewals: upcomingRenewals,
    prepStats: prepStats
  };
})();
