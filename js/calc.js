/* TradeHarbor pure calculation helpers — no DOM, no storage */
window.TH = window.TH || {};
TH.calc = (function () {
  'use strict';

  /* $ per 1.0 price point, standard quoting — majors + micros */
  var POINT_VALUES = {
    // equity indices
    ES: 50, MES: 5, NQ: 20, MNQ: 2, YM: 5, MYM: 0.5, RTY: 50, M2K: 5,
    // energy
    CL: 1000, MCL: 100, QM: 500, NG: 10000, QG: 2500, RB: 42000, HO: 42000,
    // metals
    GC: 100, MGC: 10, SI: 5000, SIL: 1000, HG: 25000, MHG: 2500, PL: 50,
    // treasuries
    ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000, UB: 1000, TN: 1000,
    // grains
    ZC: 50, ZS: 50, ZW: 50, ZL: 600, ZM: 100,
    // fx
    '6E': 125000, '6B': 62500, '6A': 100000, '6C': 100000, '6J': 12500000, '6S': 125000,
    M6E: 12500, M6A: 10000, M6B: 6250,
    // crypto
    BTC: 5, MBT: 0.1, ETH: 50, MET: 0.1
  };
  var BE_BAND = 0.5; // |net| <= $0.50 counts as breakeven

  /* platform-specific product codes → canonical roots (ProjectX/CQG style) */
  var SYMBOL_ALIASES = {
    EP: 'ES', ENQ: 'NQ', MNQ: 'MNQ', MES: 'MES', // CME index (EP/ENQ are CQG codes)
    YM2: 'YM', MYM2: 'MYM',
    CLE: 'CL', MCLE: 'MCL', NGE: 'NG',
    GCE: 'GC', MGC2: 'MGC', SIE: 'SI',
    EU6: '6E', GBP6: '6B', JY6: '6J', AD6: '6A', CD6: '6C',
    ZBE: 'ZB', ZNE: 'ZN'
  };

  /* "ESU6", "ESU2026", "ES 09-26", "ES SEP26", "MESZ5", "CON.F.US.EP.U25"
     → {symbol:'ES'|'MES'|…, known:true} */
  var MONTH_CODES = 'FGHJKMNQUVXZ';
  function normalizeSymbol(raw) {
    if (!raw) return { symbol: '', known: false };
    var s = String(raw).toUpperCase().trim();
    // dotted contract ids (ProjectX): CON.F.US.EP.U25 → product token before the expiry part
    if (s.indexOf('.') !== -1) {
      var toks = s.split('.').filter(Boolean);
      // drop a trailing expiry-looking token (month code + digits)
      if (toks.length > 1 && /^[FGHJKMNQUVXZ]?\d{1,4}$/.test(toks[toks.length - 1])) toks.pop();
      s = toks[toks.length - 1] || s;
    }
    // drop expiry tokens after whitespace: "ES 09-26", "ES SEP26", "ES DEC 2026"
    var parts = s.split(/\s+/);
    if (parts.length > 1 && /^(\d{2}-\d{2,4}|[A-Z]{3}\.?\s?\d{2,4}|\d{4})$/.test(parts.slice(1).join(' '))) {
      s = parts[0];
    } else {
      s = parts[0];
    }
    if (SYMBOL_ALIASES[s]) return { symbol: SYMBOL_ALIASES[s], known: true };
    if (POINT_VALUES[s] !== undefined) return { symbol: s, known: true };
    // strip trailing month-code + year digits: ESU6, ESU26, MESZ2026
    var m = s.match(/^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,4})$/);
    if (m && MONTH_CODES.indexOf(m[2]) !== -1 && POINT_VALUES[m[1]] !== undefined) {
      return { symbol: m[1], known: true };
    }
    // strip trailing digits only (e.g. "ES1")
    var d = s.match(/^([A-Z0-9]*[A-Z])(\d{1,4})$/);
    if (d && POINT_VALUES[d[1]] !== undefined) return { symbol: d[1], known: true };
    return { symbol: s, known: POINT_VALUES[s] !== undefined };
  }

  /* Pair raw executions into flat-to-flat round-trip trades.
     fills: [{symbol, ts (ISO), side 'buy'|'sell', qty>0, price, commission?, execId?}]
     Position flips split into two trades; still-open positions are reported, not emitted. */
  function pairFills(fills) {
    var state = {}; // per symbol
    var trades = [];
    var sorted = fills.slice().sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });

    function fresh() {
      return { pos: 0, dir: null, entrySum: 0, entryQty: 0, exitSum: 0, exitQty: 0, entryFills: 0, comm: 0, firstTs: null, firstId: null };
    }
    function emit(sym, st, ts) {
      if (!st.entryQty || !st.exitQty) return;
      trades.push({
        symbol: sym,
        direction: st.dir,
        contracts: st.entryQty,
        entryPrice: +(st.entrySum / st.entryQty).toFixed(6),
        exitPrice: +(st.exitSum / st.exitQty).toFixed(6),
        entryTime: st.firstTs,
        exitTime: ts,
        dateKey: String(st.firstTs).slice(0, 10),
        commissions: +st.comm.toFixed(2),
        riskAmount: null,
        entryFillCount: st.entryFills,
        brokerTradeId: st.firstId ? 'PF-' + st.firstId : null
      });
    }

    sorted.forEach(function (f) {
      var st = state[f.symbol] || (state[f.symbol] = fresh());
      var remaining = f.qty;
      var signed = f.side === 'buy' ? 1 : -1;
      var commPerUnit = (f.commission || 0) / f.qty;
      while (remaining > 0) {
        if (st.pos === 0) {
          // opening a new position with everything left in this fill
          st.dir = signed > 0 ? 'long' : 'short';
          st.firstTs = st.firstTs === null || st.entryQty === 0 ? f.ts : st.firstTs;
          st.firstId = st.firstId || f.execId || null;
          st.entrySum += f.price * remaining;
          st.entryQty += remaining;
          st.entryFills += 1;
          st.comm += commPerUnit * remaining;
          st.pos = signed * remaining;
          remaining = 0;
        } else if ((st.pos > 0) === (signed > 0)) {
          // adding to the open position
          st.entrySum += f.price * remaining;
          st.entryQty += remaining;
          st.entryFills += 1;
          st.comm += commPerUnit * remaining;
          st.pos += signed * remaining;
          remaining = 0;
        } else {
          // reducing / closing (and possibly flipping)
          var closing = Math.min(remaining, Math.abs(st.pos));
          st.exitSum += f.price * closing;
          st.exitQty += closing;
          st.comm += commPerUnit * closing;
          st.pos += signed * closing;
          remaining -= closing;
          if (st.pos === 0) {
            emit(f.symbol, st, f.ts);
            state[f.symbol] = st = fresh();
          }
        }
      }
    });

    var open = Object.keys(state).filter(function (sym) { return state[sym].pos !== 0; })
      .map(function (sym) { return { symbol: sym, position: state[sym].pos }; });
    return { trades: trades, open: open };
  }

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

  /* ---------- psychology constants ---------- */
  var EMOTIONS = {
    calm: { label: 'Calm', color: '#047857' },
    confident: { label: 'Confident', color: '#1e40af' },
    autopilot: { label: 'Autopilot', color: '#64748b' },
    anxious: { label: 'Anxious', color: '#b45309' },
    hesitant: { label: 'Hesitant', color: '#a16207' },
    fomo: { label: 'FOMO', color: '#c2410c' },
    revenge: { label: 'Revenge', color: '#be123c' },
    overconfident: { label: 'Overconfident', color: '#6d28d9' }
  };
  var MISTAKES = {
    'moved-stop': { label: 'Moved the stop' },
    oversized: { label: 'Oversized' },
    chased: { label: 'Chased entry' },
    'early-exit': { label: 'Exited early' },
    'no-stop': { label: 'No stop in market' },
    'revenge-add': { label: 'Revenge re-entry' },
    'broke-plan': { label: 'Broke the plan' },
    'traded-news': { label: 'Traded into news' }
  };

  /* ---------- prop-firm compliance ----------
     EOD equity model: rules are evaluated on end-of-day equity built from
     daily net P/L, so intraday drawdown breaches are not detectable here. */
  function compliance(account, trades) {
    var rules = account && account.rules;
    if (!rules || rules.startingBalance == null) return null;
    var mine = trades.filter(function (t) { return t.accountId === account.id; });
    var days = sortedDays(dailyAggregates(mine));
    var equity = rules.startingBalance;
    var floor = rules.maxDrawdown != null ? rules.startingBalance - rules.maxDrawdown : null;
    var breaches = [];
    var bestDay = 0;
    days.forEach(function (d) {
      if (rules.dailyLossLimit != null && d.pl < -rules.dailyLossLimit) {
        breaches.push({ type: 'daily-loss', dateKey: d.dateKey, amount: d.pl, limit: rules.dailyLossLimit });
      }
      equity += d.pl;
      if (d.pl > bestDay) bestDay = d.pl;
      if (floor != null && equity < floor) {
        breaches.push({ type: 'drawdown', dateKey: d.dateKey, amount: equity - floor, limit: rules.maxDrawdown });
      }
      if (floor != null && rules.drawdownType !== 'static') {
        var trailed = equity - rules.maxDrawdown;
        if (trailed > floor) floor = trailed;
        if (rules.drawdownType === 'trail-lock' && floor > rules.startingBalance) floor = rules.startingBalance;
      }
    });
    var profit = equity - rules.startingBalance;
    var consistency = null;
    if (rules.consistencyPct != null && profit > 0 && bestDay > 0) {
      var score = bestDay / profit;
      consistency = {
        score: score,
        pass: score * 100 <= rules.consistencyPct,
        bestDay: bestDay,
        neededProfit: score * 100 > rules.consistencyPct
          ? (bestDay * 100 / rules.consistencyPct) - profit
          : 0
      };
    }
    return {
      equity: equity, profit: profit, floor: floor,
      buffer: floor != null ? equity - floor : null,
      targetProgress: rules.profitTarget ? Math.max(0, Math.min(1, profit / rules.profitTarget)) : null,
      consistency: consistency,
      breaches: breaches,
      dayCount: days.length
    };
  }

  /* ---------- deeper analytics ---------- */
  function holdMinutes(t) {
    if (!t.entryTime || !t.exitTime) return null;
    var m = (new Date(t.exitTime) - new Date(t.entryTime)) / 60000;
    return isNaN(m) ? null : Math.max(0, m);
  }
  function edgeStats(trades) {
    var wins = [], losses = [], rs = [], holds = [];
    var total = 0;
    trades.forEach(function (t) {
      var n = net(t);
      total += n;
      var res = result(t);
      if (res === 'win') wins.push(n);
      else if (res === 'loss') losses.push(n);
      var r = rMultiple(t);
      if (r !== null) rs.push(r);
      var h = holdMinutes(t);
      if (h !== null) holds.push(h);
    });
    function avg(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
    function median(a) {
      if (!a.length) return null;
      var s = a.slice().sort(function (x, y) { return x - y; });
      var mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    var avgWin = avg(wins), avgLoss = avg(losses);
    return {
      expectancy: trades.length ? total / trades.length : null,
      expectancyR: avg(rs),
      avgWin: avgWin, avgLoss: avgLoss,
      payoff: (avgWin != null && avgLoss != null && avgLoss !== 0) ? avgWin / -avgLoss : null,
      medianHoldMin: median(holds)
    };
  }
  /* Group trades by keyFn(trade) -> {key,label} or null to skip */
  function breakdown(trades, keyFn) {
    var map = {};
    trades.forEach(function (t) {
      var k = keyFn(t);
      if (!k) return;
      (Array.isArray(k) ? k : [k]).forEach(function (item) {
        var b = map[item.key] || (map[item.key] = { key: item.key, label: item.label, order: item.order !== undefined ? item.order : null, pl: 0, count: 0, wins: 0, losses: 0 });
        b.pl += net(t);
        b.count += 1;
        var res = result(t);
        if (res === 'win') b.wins++;
        else if (res === 'loss') b.losses++;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      if (a.order !== null && b.order !== null) return a.order - b.order;
      return b.pl - a.pl;
    });
  }

  /* ---------- goals & streaks ---------- */
  function goalStreaks(goals, ctx) {
    var daily = dailyAggregates(ctx.trades || []);
    var tradingDays = Object.keys(daily).sort();
    var prepByDay = {};
    (ctx.prep || []).forEach(function (e) {
      (prepByDay[e.dateKey] = prepByDay[e.dateKey] || {})[e.kind] = true;
    });
    var dllByAccount = {};
    (ctx.accounts || []).forEach(function (a) {
      if (a.rules && a.rules.dailyLossLimit != null) dllByAccount[a.id] = a.rules.dailyLossLimit;
    });
    var perAccountDay = {};
    (ctx.trades || []).forEach(function (t) {
      if (!(t.accountId in dllByAccount)) return;
      var k = t.accountId + '|' + t.dateKey;
      perAccountDay[k] = (perAccountDay[k] || 0) + net(t);
    });

    var META = {
      'recap-daily': { label: 'Recap every trading day', icon: '✎' },
      'prep-daily': { label: 'Prep before every session', icon: '☀' },
      'respect-stop': { label: 'Respect the daily stop', icon: '⛨' },
      'max-trades': { label: 'Stay under N trades/day', icon: '≤' }
    };
    function dayOk(goal, dateKey) {
      switch (goal.kind) {
        case 'recap-daily': return !!(prepByDay[dateKey] && prepByDay[dateKey].recap);
        case 'prep-daily': return !!(prepByDay[dateKey] && prepByDay[dateKey].premarket);
        case 'respect-stop':
          return Object.keys(dllByAccount).every(function (accId) {
            var pl = perAccountDay[accId + '|' + dateKey];
            return pl === undefined || pl >= -dllByAccount[accId];
          });
        case 'max-trades': return daily[dateKey].count <= (goal.param || 3);
        default: return true;
      }
    }
    return (goals || []).filter(function (g) { return g.enabled; }).map(function (g) {
      var current = 0, best = 0, run = 0;
      tradingDays.forEach(function (d) {
        if (dayOk(g, d)) { run++; if (run > best) best = run; }
        else run = 0;
      });
      current = run; // streak ending at the most recent trading day
      var meta = META[g.kind] || { label: g.kind, icon: '•' };
      var label = g.kind === 'max-trades' ? 'Max ' + (g.param || 3) + ' trades/day' : meta.label;
      return { id: g.id, kind: g.kind, label: label, icon: meta.icon, current: current, best: best, days: tradingDays.length };
    });
  }

  /* ---------- CSV (quote-aware, pure & testable) ---------- */
  function csvParse(text) {
    var rows = [], row = [], cell = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQ = false;
        } else cell += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return { headers: rows.length ? rows[0] : [], rows: rows.slice(1) };
  }
  function csvSerialize(rows) {
    return rows.map(function (r) {
      return r.map(function (v) {
        var s = v === null || v === undefined ? '' : String(v);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  /* ---------- broker import presets (pure data + helpers; UI lives in trades.js) ----------
     kind 'trades': rows are already round-trips.  kind 'fills': rows are executions → pairFills. */
  var BROKER_PRESETS = {
    generic: { label: 'Generic CSV (map columns manually)', kind: 'trades', hints: null },
    'nt8-trades': {
      label: 'NinjaTrader 8 — Trade Performance export', kind: 'trades',
      hints: {
        symbol: ['instrument'], direction: ['market pos.', 'market pos', 'position'],
        contracts: ['qty', 'quantity'], entryPrice: ['entry price'], exitPrice: ['exit price'],
        entryTime: ['entry time'], exitTime: ['exit time'], commissions: ['commission'],
        brokerTradeId: ['trade number', 'trade #']
      }
    },
    'nt8-executions': {
      label: 'NinjaTrader 8 — Executions export', kind: 'fills',
      hints: {
        symbol: ['instrument'], time: ['time'], side: ['b/s', 'action', 'buy/sell'],
        qty: ['quantity', 'qty'], price: ['price'], commission: ['commission'],
        id: ['id', 'execution id', 'exec id']
      }
    },
    'tradovate-fills': {
      label: 'Tradovate — Fills export', kind: 'fills',
      hints: {
        symbol: ['contract', 'symbol', 'instrument'], time: ['fill time', 'timestamp', 'time', 'date'],
        side: ['b/s', 'side', 'action', 'buy/sell'], qty: ['qty', 'quantity', 'filled qty'],
        price: ['price', 'fill price', 'avg price', 'avg fill price'], commission: ['commission', 'fees'],
        id: ['fill id', 'id', 'order id']
      }
    },
    'rithmic-orders': {
      label: 'Rithmic R|Trader — order history export', kind: 'fills',
      hints: {
        symbol: ['symbol', 'instrument'],
        time: ['update time (cst)', 'update time', 'fill time', 'create time', 'time'],
        side: ['buy/sell', 'b/s', 'side'],
        qty: ['filled qty', 'qty filled', 'quantity filled', 'filled', 'qty'],
        price: ['avg fill price', 'fill price', 'price'],
        commission: ['commission fill rate', 'commission', 'fees'],
        id: ['order number', 'order id', 'exchange order id', 'basket id']
      }
    },
    'topstepx-trades': {
      label: 'TopstepX (ProjectX) — trades export', kind: 'fills',
      hints: {
        symbol: ['contractname', 'contract name', 'contract', 'symbol', 'contractid', 'contract id'],
        time: ['creationtimestamp', 'creation timestamp', 'created', 'entered', 'timestamp', 'time'],
        side: ['side', 'type', 'b/s', 'buy/sell'],
        qty: ['size', 'qty', 'quantity'],
        price: ['price', 'fillprice', 'fill price'],
        commission: ['fees', 'fee', 'commission'],
        id: ['id', 'tradeid', 'trade id']
      }
    }
  };
  function autoMapHeaders(headers, hints) {
    var lower = headers.map(function (h) { return String(h || '').trim().toLowerCase(); });
    var map = {};
    Object.keys(hints || {}).forEach(function (field) {
      map[field] = -1;
      for (var i = 0; i < hints[field].length; i++) {
        var at = lower.indexOf(hints[field][i]);
        if (at !== -1) { map[field] = at; break; }
      }
    });
    return map;
  }
  function parseSide(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (s === '0') return 'buy';   // ProjectX side codes
    if (s === '1') return 'sell';
    if (/^(b|buy|bot|bought|long)/.test(s)) return 'buy';
    if (/^(s|sell|sld|sold|short)/.test(s)) return 'sell';
    return null;
  }

  return {
    POINT_VALUES: POINT_VALUES, EMOTIONS: EMOTIONS, MISTAKES: MISTAKES,
    BROKER_PRESETS: BROKER_PRESETS, autoMapHeaders: autoMapHeaders, parseSide: parseSide,
    normalizeSymbol: normalizeSymbol, pairFills: pairFills,
    toDateKey: toDateKey, todayKey: todayKey, keyToDate: keyToDate, addDays: addDays,
    daysBetween: daysBetween, advanceCycle: advanceCycle,
    monthLabel: monthLabel, monthMatrix: monthMatrix, fmtDateKey: fmtDateKey, fmtIso: fmtIso, fmtTime: fmtTime,
    gross: gross, net: net, points: points, rMultiple: rMultiple, result: result,
    filterTrades: filterTrades, presetRange: presetRange,
    dailyAggregates: dailyAggregates, cumulativeSeries: cumulativeSeries, kpis: kpis,
    expensesInRange: expensesInRange, expenseTotal: expenseTotal,
    monthlyRecurring: monthlyRecurring, upcomingRenewals: upcomingRenewals,
    prepStats: prepStats,
    compliance: compliance, edgeStats: edgeStats, breakdown: breakdown, holdMinutes: holdMinutes,
    goalStreaks: goalStreaks, csvParse: csvParse, csvSerialize: csvSerialize
  };
})();
