/* TradeHarbor demo seed data — deterministic generator (seeded PRNG) */
window.TH = window.TH || {};
TH.seed = (function () {
  'use strict';

  // mulberry32 seeded PRNG — same seed, same demo data every fresh install
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var SYMBOLS = {
    ES:  { base: 6480,  tick: 0.25, pv: 50, comm: 4.2,  maxCts: 3 },
    MES: { base: 6480,  tick: 0.25, pv: 5,  comm: 1.24, maxCts: 5 },
    NQ:  { base: 23650, tick: 0.25, pv: 20, comm: 4.2,  maxCts: 2 },
    MNQ: { base: 23650, tick: 0.25, pv: 2,  comm: 1.24, maxCts: 5 }
  };
  var SYMBOL_KEYS = Object.keys(SYMBOLS);

  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function between(rng, lo, hi) { return lo + rng() * (hi - lo); }
  function intBetween(rng, lo, hi) { return Math.floor(between(rng, lo, hi + 1)); }
  function roundTick(price, tick) { return Math.round(price / tick) * tick; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function isoLocal(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00';
  }

  var seq = 0;
  function sid(prefix) { return prefix + '-' + (++seq); }

  /* Build one trade. Works backwards from a target R multiple so P/L, points
     and prices stay mutually consistent (all display values derive from prices). */
  function makeTrade(rng, opts) {
    var symbol = opts.symbol || pick(rng, SYMBOL_KEYS);
    var spec = SYMBOLS[symbol];
    var direction = rng() < 0.55 ? 'long' : 'short';
    var contracts = intBetween(rng, 1, spec.maxCts);
    var risk = Math.round(between(rng, 80, 260));
    var roll = rng();
    var r;
    if (roll < 0.52)      r = between(rng, 0.3, 2.1);    // win
    else if (roll < 0.92) r = -between(rng, 0.3, 1.42);  // loss
    else                  r = between(rng, -0.05, 0.05); // scratch
    var commissions = +(contracts * spec.comm).toFixed(2);
    var targetNet = r * risk;
    var gross = targetNet + commissions;
    var points = gross / (spec.pv * contracts);
    var dirSign = direction === 'long' ? 1 : -1;

    var entryPrice = roundTick(spec.base + between(rng, -spec.base * 0.012, spec.base * 0.012), spec.tick);
    var exitPrice = roundTick(entryPrice + dirSign * points, spec.tick);
    if (exitPrice === entryPrice) exitPrice = entryPrice + dirSign * spec.tick;

    var entry = new Date(opts.day.getTime());
    entry.setHours(intBetween(rng, 8, 13), intBetween(rng, 0, 59), 0, 0);
    var exit = new Date(entry.getTime() + intBetween(rng, 4, 52) * 60000);

    return {
      id: opts.id || sid('t'),
      accountId: opts.accountId,
      symbol: symbol,
      direction: direction,
      contracts: contracts,
      entryPrice: entryPrice,
      exitPrice: exitPrice,
      entryTime: isoLocal(entry),
      exitTime: isoLocal(exit),
      dateKey: dateKey(entry),
      commissions: commissions,
      riskAmount: risk,
      source: opts.source || 'sync',
      brokerTradeId: opts.brokerTradeId || null,
      entryFillCount: rng() < 0.12 ? intBetween(rng, 2, 3) : 1,
      tagIds: [],
      notes: '',
      checklist: null
    };
  }

  function generate() {
    seq = 0;
    var rng = mulberry32(0x7EADE5);
    var now = new Date();

    /* ---- connections ---- */
    var connections = [
      { id: 'conn-1', name: 'Tradovate Main',      provider: 'tradovate',   mode: 'live', status: 'connected', lastSyncAt: null, createdAt: null },
      { id: 'conn-2', name: 'Tradovate Evals',     provider: 'tradovate',   mode: 'live', status: 'connected', lastSyncAt: null, createdAt: null },
      { id: 'conn-3', name: 'NinjaTrader Practice', provider: 'ninjatrader', mode: 'demo', status: 'connected', lastSyncAt: null, createdAt: null }
    ];

    /* ---- tracker accounts (rules = prop-firm limits for the compliance page) ---- */
    var accounts = [
      { id: 'acc-1', name: 'Evaluation 50K',  type: 'eval',     connectionId: 'conn-2', brokerAccountRef: 'TVE-50110', balance: 51840,  drawdownLimit: 48000,  status: 'active', lastSyncAt: null,
        rules: { startingBalance: 50000, maxDrawdown: 2500, drawdownType: 'trailing', dailyLossLimit: 1250, profitTarget: 3000, consistencyPct: 40 } },
      { id: 'acc-2', name: 'Evaluation 100K', type: 'eval',     connectionId: 'conn-1', brokerAccountRef: 'TVM-10221', balance: 101960, drawdownLimit: 97000,  status: 'active', lastSyncAt: null,
        rules: { startingBalance: 100000, maxDrawdown: 3500, drawdownType: 'trailing', dailyLossLimit: 2200, profitTarget: 6000, consistencyPct: 40 } },
      { id: 'acc-3', name: 'Funded 50K',      type: 'funded',   connectionId: 'conn-1', brokerAccountRef: 'TVM-77045', balance: 52410,  drawdownLimit: 50000,  status: 'active', lastSyncAt: null,
        rules: { startingBalance: 50000, maxDrawdown: 2500, drawdownType: 'trail-lock', dailyLossLimit: 1100, profitTarget: null, consistencyPct: 50 } },
      { id: 'acc-4', name: 'Practice Sim',    type: 'practice', connectionId: 'conn-3', brokerAccountRef: 'NT-SIM101', balance: 25230,  drawdownLimit: null,   status: 'active', lastSyncAt: null,
        rules: { startingBalance: 25000, maxDrawdown: null, drawdownType: 'static', dailyLossLimit: null, profitTarget: null, consistencyPct: null } },
      { id: 'acc-5', name: 'Manual Journal',  type: 'manual',   connectionId: null,     brokerAccountRef: null,        balance: null,   drawdownLimit: null,   status: 'active', lastSyncAt: null,
        rules: null }
    ];

    /* ---- strategies ---- */
    var strategies = [
      {
        id: 'strat-1', name: 'Opening Drive Continuation', isDefault: true,
        description: 'Trade the first clean continuation once the opening balance sets a direction. Skip entries straight into obvious resting liquidity.',
        sections: [
          {
            id: 'sec-1', name: 'Market Context', requiredCount: 2,
            rules: [
              { id: 'r-1', text: 'Higher-timeframe trend and session bias agree' },
              { id: 'r-2', text: 'Economic calendar checked — no red news inside 15 min' },
              { id: 'r-3', text: 'Overnight high/low and key levels marked before open' }
            ]
          },
          {
            id: 'sec-2', name: 'Entry Quality', requiredCount: 2,
            rules: [
              { id: 'r-4', text: 'Price accepted back above/below the trigger level' },
              { id: 'r-5', text: 'Hard stop placed before entry, never widened' },
              { id: 'r-6', text: 'First target offers at least 1.5R of realistic room' }
            ]
          }
        ]
      },
      {
        id: 'strat-2', name: 'Midday Mean Reversion', isDefault: false,
        description: 'Fade stretched moves back to value during the lunch lull. Small size, quick targets, no averaging down.',
        sections: [
          {
            id: 'sec-3', name: 'Location', requiredCount: 2,
            rules: [
              { id: 'r-7', text: 'Price is extended 2+ standard deviations from VWAP' },
              { id: 'r-8', text: 'A clear exhaustion signal printed on entry timeframe' },
              { id: 'r-9', text: 'No fresh catalyst driving the move' }
            ]
          },
          {
            id: 'sec-4', name: 'Execution', requiredCount: 2,
            rules: [
              { id: 'r-10', text: 'Half normal size or less' },
              { id: 'r-11', text: 'Target is the mean, not a home run' }
            ]
          }
        ]
      }
    ];

    /* ---- tags ---- */
    var tags = [
      { id: 'tag-1', label: 'A+ setup',     color: '#047857' },
      { id: 'tag-2', label: 'Breakout',     color: '#1e40af' },
      { id: 'tag-3', label: 'Pullback',     color: '#a16207' },
      { id: 'tag-4', label: 'Fade',         color: '#6d28d9' },
      { id: 'tag-5', label: 'News day',     color: '#b45309' },
      { id: 'tag-6', label: 'Late entry',   color: '#c2410c' },
      { id: 'tag-7', label: 'Overtraded',   color: '#be123c' },
      { id: 'tag-8', label: 'Needs review', color: '#64748b' }
    ];
    var tagIds = tags.map(function (t) { return t.id; });

    /* ---- trades: ~90 days of weekday history ---- */
    var trades = [];
    var syncAccounts = ['acc-1', 'acc-2', 'acc-3', 'acc-4'];
    for (var off = 90; off >= 1; off--) {
      var day = new Date(now.getTime());
      day.setDate(day.getDate() - off);
      var dow = day.getDay();
      if (dow === 0 || dow === 6) continue;
      var count = pick(rng, [0, 0, 1, 1, 1, 2, 2, 3]);
      for (var i = 0; i < count; i++) {
        var accId = pick(rng, syncAccounts);
        var acc = accounts.filter(function (a) { return a.id === accId; })[0];
        var conn = connections.filter(function (c) { return c.id === acc.connectionId; })[0];
        var t = makeTrade(rng, {
          day: day,
          accountId: accId,
          source: rng() < 0.08 ? 'csv' : 'sync',
          brokerTradeId: (conn.provider === 'tradovate' ? 'TV-' : 'NT-') + intBetween(rng, 100000, 999999)
        });
        // light journaling on some history so the app looks lived-in
        if (rng() < 0.45) {
          var n = rng() < 0.7 ? 1 : 2, chosen = [];
          while (chosen.length < n) {
            var tg = pick(rng, tagIds);
            if (chosen.indexOf(tg) === -1) chosen.push(tg);
          }
          t.tagIds = chosen;
        }
        if (rng() < 0.3) {
          var checked = {};
          strategies[0].sections.forEach(function (s) {
            s.rules.forEach(function (r) { if (rng() < 0.75) checked[r.id] = true; });
          });
          t.checklist = { strategyId: 'strat-1', checked: checked };
        }
        if (rng() < 0.18) {
          t.notes = pick(rng, [
            'Waited for acceptance before entering — clean execution.',
            'Entry was fine, exit was early. Let the runner work next time.',
            'Chased this one. It was not on the plan.',
            'Textbook setup. Screenshot the context for the playbook.',
            'Stop was too tight for the volatility today.'
          ]);
        }
        // psychology layer on roughly half the history
        if (rng() < 0.55) {
          t.confidence = intBetween(rng, 2, 5);
          var isWin = (t.exitPrice - t.entryPrice) * (t.direction === 'long' ? 1 : -1) > 0;
          t.emotions = [isWin
            ? pick(rng, ['calm', 'calm', 'confident', 'confident', 'autopilot', 'anxious'])
            : pick(rng, ['calm', 'anxious', 'fomo', 'hesitant', 'revenge', 'overconfident'])];
          if (!isWin && rng() < 0.4) {
            t.mistakes = [pick(rng, ['chased', 'early-exit', 'moved-stop', 'oversized', 'broke-plan', 'traded-news'])];
          }
        }
        trades.push(t);
      }
      // occasional manual-journal entry
      if (rng() < 0.18) {
        trades.push(makeTrade(rng, { day: day, accountId: 'acc-5', source: 'manual' }));
      }
    }

    var lastSync = new Date(now.getTime() - 1000 * 60 * intBetween(rng, 20, 240));
    connections.forEach(function (c) { c.lastSyncAt = lastSync.toISOString(); c.createdAt = new Date(now.getTime() - 86400000 * 120).toISOString(); });
    accounts.forEach(function (a) { if (a.connectionId) a.lastSyncAt = lastSync.toISOString(); });

    /* ---- prep & review entries (past ~5 weeks) ---- */
    var prep = [];
    var biases = ['long', 'short', 'chop'];
    for (var p = 35; p >= 0; p--) {
      var pd = new Date(now.getTime());
      pd.setDate(pd.getDate() - p);
      var pk = dateKey(pd);
      var pdow = pd.getDay();
      if (pdow === 0) {
        if (rng() < 0.8) prep.push({
          id: sid('prep'), dateKey: pk, kind: 'weeklyPrep', savedAt: pk,
          fields: { theme: 'Stay patient through the first 30 minutes.', goals: 'Max 3 trades per day. Only A and B setups.', watchlist: 'ES, NQ — watch CPI reaction levels.' }
        });
      } else if (pdow === 6) {
        if (rng() < 0.65) prep.push({
          id: sid('prep'), dateKey: pk, kind: 'weeklyRecap', savedAt: pk,
          fields: { wentWell: 'Respected the daily stop every session.', needsWork: 'Cut two winners early on trend days.', adherenceNote: 'Followed the playbook 4 of 5 sessions.' }
        });
      } else {
        if (rng() < 0.6) prep.push({
          id: sid('prep'), dateKey: pk, kind: 'premarket', savedAt: pk,
          fields: { bias: pick(rng, biases), keyLevels: 'ONH ' + Math.round(6480 + between(rng, -20, 20)) + ' / ONL ' + Math.round(6450 + between(rng, -20, 20)), plan: 'Wait for the opening drive to settle, then trade the first pullback with trend.', focus: 'One good entry beats three average ones.' }
        });
        if (rng() < 0.5) prep.push({
          id: sid('prep'), dateKey: pk, kind: 'live', savedAt: pk,
          fields: { checks: { sized: true, stopSet: true, newsChecked: rng() < 0.8, levelsMarked: rng() < 0.9, journalOpen: rng() < 0.7 }, notes: '' }
        });
        if (rng() < 0.55) prep.push({
          id: sid('prep'), dateKey: pk, kind: 'recap', savedAt: pk,
          fields: { biasCorrect: rng() < 0.62, followedPlan: rng() < 0.68, grade: pick(rng, ['A', 'B', 'B', 'C']), lessons: pick(rng, ['Best trades came from planned levels.', 'Stopped trading after two losses — good discipline.', 'Sized up too fast after the first winner.', 'Patience paid off in the afternoon.']) }
        });
      }
    }

    /* ---- subscriptions ---- */
    function futureKey(days) {
      var d = new Date(now.getTime());
      d.setDate(d.getDate() + days);
      return dateKey(d);
    }
    var subscriptions = [
      { id: 'sub-1', name: 'CME Market Data Bundle', amount: 39,     cycle: 'monthly', nextRenewal: futureKey(4),  autoRenew: true,  category: 'data-feed' },
      { id: 'sub-2', name: 'Charting Platform Pro',  amount: 59.95,  cycle: 'monthly', nextRenewal: futureKey(11), autoRenew: true,  category: 'platform' },
      { id: 'sub-3', name: 'Prop Eval — 100K Plan',  amount: 165,    cycle: 'monthly', nextRenewal: futureKey(17), autoRenew: true,  category: 'prop-eval' },
      { id: 'sub-4', name: 'Trading VPS',            amount: 25,     cycle: 'monthly', nextRenewal: futureKey(23), autoRenew: false, category: 'other' },
      { id: 'sub-5', name: 'Futures Education Hub',  amount: 199,    cycle: 'yearly',  nextRenewal: futureKey(148), autoRenew: true, category: 'education' }
    ];

    /* ---- expenses: past renewals + one-time items ---- */
    var expenses = [];
    subscriptions.forEach(function (s) {
      if (s.cycle !== 'monthly') return;
      for (var m = 1; m <= 3; m++) {
        var ed = new Date(s.nextRenewal + 'T12:00:00');
        ed.setMonth(ed.getMonth() - m);
        expenses.push({ id: sid('exp'), name: s.name, amount: s.amount, dateKey: dateKey(ed), category: s.category, subscriptionId: s.id });
      }
    });
    function pastKey(days) {
      var d = new Date(now.getTime());
      d.setDate(d.getDate() - days);
      return dateKey(d);
    }
    expenses.push(
      { id: sid('exp'), name: 'Eval account reset fee', amount: 85,  dateKey: pastKey(19), category: 'prop-eval', subscriptionId: null },
      { id: sid('exp'), name: 'Second monitor',         amount: 179, dateKey: pastKey(41), category: 'hardware',  subscriptionId: null },
      { id: sid('exp'), name: 'Order-flow course',      amount: 129, dateKey: pastKey(66), category: 'education', subscriptionId: null }
    );

    return {
      settings: { defaultStrategyId: 'strat-1', workspaceName: 'Main Workspace', traderName: 'Demo Trader', lastStatsFilters: null },
      accounts: accounts,
      connections: connections,
      trades: trades,
      strategies: strategies,
      tags: tags,
      prep: prep,
      subscriptions: subscriptions,
      expenses: expenses,
      jobs: [],
      goals: [
        { id: 'g-recap', kind: 'recap-daily', enabled: true, param: null },
        { id: 'g-prep', kind: 'prep-daily', enabled: true, param: null },
        { id: 'g-stop', kind: 'respect-stop', enabled: true, param: null },
        { id: 'g-max', kind: 'max-trades', enabled: true, param: 3 }
      ]
    };
  }

  /* Minimal starter dataset for real users: playbook scaffolding and one
     account, but zero trades/history — the journal starts truly theirs. */
  function generateFresh() {
    var demo = generate(); // reuse strategies/tags/goals definitions
    return {
      settings: {
        defaultStrategyId: 'strat-1',
        workspaceName: 'My Workspace',
        traderName: 'Trader',
        lastStatsFilters: null,
        gettingStarted: true
      },
      accounts: [
        { id: 'acc-main', name: 'My Account', type: 'manual', connectionId: null, brokerAccountRef: null, balance: null, drawdownLimit: null, status: 'active', lastSyncAt: null, rules: null }
      ],
      connections: [],
      trades: [],
      strategies: demo.strategies,
      tags: demo.tags,
      prep: [],
      subscriptions: [],
      expenses: [],
      jobs: [],
      goals: demo.goals
    };
  }

  /* Runtime generator for simulated broker syncs / older-trade imports.
     Not seeded — each sync should feel like fresh data. */
  function generateSyncedTrades(connection, accounts, range, countHint) {
    var rng = Math.random;
    var out = [];
    var linked = accounts.filter(function (a) { return a.connectionId === connection.id && a.status === 'active'; });
    if (!linked.length) return out;
    var count = countHint || (3 + Math.floor(rng() * 9));
    var from = new Date(range.from + 'T00:00:00');
    var to = new Date(range.to + 'T00:00:00');
    var span = Math.max(1, Math.round((to - from) / 86400000));
    var guard = 0;
    while (out.length < count && guard++ < count * 6) {
      var day = new Date(from.getTime() + Math.floor(rng() * (span + 1)) * 86400000);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      var acc = linked[Math.floor(rng() * linked.length)];
      out.push(makeTrade(rng, {
        id: 'ts-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        day: day,
        accountId: acc.id,
        source: 'sync',
        brokerTradeId: (connection.provider === 'tradovate' ? 'TV-' : 'NT-') + Math.floor(100000 + rng() * 900000)
      }));
    }
    return out;
  }

  return { generate: generate, generateFresh: generateFresh, generateSyncedTrades: generateSyncedTrades, SYMBOLS: SYMBOLS };
})();
