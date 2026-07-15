// Functional test: auto-renew sweep + calc math, run against the real source files
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// minimal browser stubs
const storage = {};
const ctx = {
  console,
  localStorage: {
    getItem: k => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; },
    key: i => Object.keys(storage)[i],
    get length() { return Object.keys(storage).length; }
  },
  setInterval: () => 0, clearInterval: () => {},
  setTimeout, clearTimeout,
  navigator: { onLine: true },
  location: { href: 'http://localhost/app/account.html', reload: () => {} },
  addEventListener: () => {},
  Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, isNaN, parseFloat, parseInt, Infinity, NaN
};
ctx.window = ctx; // window === global, like a browser
vm.createContext(ctx);
for (const f of ['js/seed-data.js', 'js/calc.js', 'js/store.js']) {
  vm.runInContext(fs.readFileSync(ROOT + '/' + f, 'utf8'), ctx, { filename: f });
}
const TH = vm.runInContext('window.TH', ctx);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : '→ ' + JSON.stringify(extra)); }
}

// ---- 1. seeding ----
TH.store.init();
const trades = TH.store.get('trades');
check('seed creates trades', trades.length > 50, trades.length);
check('seed creates 5 accounts', TH.store.get('accounts').length === 5);
check('seed creates 3 connections', TH.store.get('connections').length === 3);
check('seed creates subscriptions', TH.store.get('subscriptions').length === 5);
check('seed creates past expenses', TH.store.get('expenses').length >= 12, TH.store.get('expenses').length);

// ---- 2. calc consistency on a sample trade ----
const t = trades[0];
const net = TH.calc.net(t), gross = TH.calc.gross(t);
check('net = gross - commissions', Math.abs(net - (gross - t.commissions)) < 1e-9);
const r = TH.calc.rMultiple(t);
check('R = net / risk', t.riskAmount > 0 ? Math.abs(r - net / t.riskAmount) < 1e-9 : r === null);

// KPI cross-check: totalPL equals sum of nets
const k = TH.calc.kpis(trades, { mode: 'trade' });
const manualTotal = trades.reduce((s, x) => s + TH.calc.net(x), 0);
check('kpis.totalPL matches manual sum', Math.abs(k.totalPL - manualTotal) < 1e-6);
check('win rate in [0,1]', k.winRate > 0 && k.winRate < 1, k.winRate);
check('profit factor positive', k.profitFactor > 0, k.profitFactor);

// ---- 3. auto-renew sweep: backdate a subscription 3 months ----
const subs = TH.store.get('subscriptions');
const today = TH.calc.todayKey();
const backdated = TH.calc.addDays(today, -65); // ~2 elapsed monthly cycles + current
subs[0].nextRenewal = backdated;
subs[0].autoRenew = true;
TH.store.save('subscriptions', subs);
// force sweep to run again
const meta = TH.store.get('meta');
meta.lastRenewalSweep = null;
TH.store.save('meta', meta);
const before = TH.store.get('expenses').length;

// re-run sweep via a fresh store pass (renewalSweep is internal; init is memoized, so re-load scripts)
vm.runInContext(fs.readFileSync(ROOT + '/js/store.js', 'utf8'), ctx, { filename: 'store2' });
const TH2 = vm.runInContext('window.TH', ctx);
const info = TH2.store.init();
const after = TH2.store.get('expenses');
check('sweep generated 3 renewal expenses', info.renewed === 3, info.renewed);
check('expense count grew by 3', after.length === before + 3, after.length - before);
const sub0 = TH2.store.get('subscriptions')[0];
check('nextRenewal advanced into the future', sub0.nextRenewal > today, sub0.nextRenewal);
const dupes = after.filter(e => e.subscriptionId === sub0.id)
  .map(e => e.dateKey).sort()
  .filter((d, i, a) => a.indexOf(d) !== i);
check('no duplicate renewal dates for the sub', dupes.length === 0, dupes);

// ---- 4. idempotency: second sweep same day generates nothing ----
const meta2 = TH2.store.get('meta');
meta2.lastRenewalSweep = null; // even forcing it, dedupe must hold
TH2.store.save('meta', meta2);
vm.runInContext(fs.readFileSync(ROOT + '/js/store.js', 'utf8'), ctx, { filename: 'store3' });
const TH3 = vm.runInContext('window.TH', ctx);
const info3 = TH3.store.init();
check('re-running sweep creates 0 new expenses', info3.renewed === 0, info3.renewed);

// ---- 5. net P&L after expenses math ----
const monthStart = today.slice(0, 8) + '01';
const expTotal = TH3.calc.expenseTotal(TH3.store.get('expenses'), monthStart, today);
check('expenseTotal positive after sweep', expTotal > 0, expTotal);

// ---- 6. month-end clamp: Jan 31 monthly -> Feb 28 ----
check('advanceCycle clamps Jan 31 → Feb 28', TH3.calc.advanceCycle('2026-01-31', 'monthly') === '2026-02-28');
check('advanceCycle Dec → Jan rolls year', TH3.calc.advanceCycle('2026-12-15', 'monthly') === '2027-01-15');
check('advanceCycle yearly leap clamp', TH3.calc.advanceCycle('2028-02-29', 'yearly') === '2029-02-28');

// ---- 7. stale job sweep ----
const jobs = TH3.store.get('jobs');
jobs.unshift({ id: 'job-x', connectionId: TH3.store.get('connections')[0].id, kind: 'sync', range: { from: TH3.calc.addDays(today, -2), to: today }, countHint: 3, status: 'running', progress: 40, resultCount: 0, createdAt: new Date().toISOString(), finishedAt: null });
TH3.store.save('jobs', jobs);
vm.runInContext(fs.readFileSync(ROOT + '/js/store.js', 'utf8'), ctx, { filename: 'store4' });
const TH4 = vm.runInContext('window.TH', ctx);
TH4.store.init();
const jobX = TH4.store.get('jobs').find(j => j.id === 'job-x');
check('stale running job fast-forwarded', jobX.status === 'done' || jobX.status === 'failed', jobX.status);


// ---- 8. v2: compliance engine ----
const acc1 = TH4.store.get('accounts')[0];
check('seed account has rules', !!acc1.rules && acc1.rules.startingBalance === 50000, acc1.rules);
const comp = TH4.calc.compliance(acc1, TH4.store.get('trades'));
check('compliance computes', comp !== null && typeof comp.equity === 'number');
check('buffer = equity - floor', comp.floor === null || Math.abs(comp.buffer - (comp.equity - comp.floor)) < 1e-6);

const synthAcc = { id: 'syn', rules: { startingBalance: 10000, maxDrawdown: 1000, drawdownType: 'trailing', dailyLossLimit: 500, profitTarget: 2000, consistencyPct: 50 } };
function synthTrade(dateKey, pl) {
  return { accountId: 'syn', symbol: 'ES', direction: 'long', contracts: 1,
    entryPrice: 5000, exitPrice: 5000 + pl / 50, entryTime: dateKey + 'T09:30:00',
    exitTime: dateKey + 'T10:00:00', dateKey: dateKey, commissions: 0, riskAmount: 100 };
}
const synth = [synthTrade('2026-01-05', 1000), synthTrade('2026-01-06', -1200), synthTrade('2026-01-07', 800)];
const sc = TH4.calc.compliance(synthAcc, synth);
check('trailing floor rises with equity', sc.breaches.some(b => b.type === 'drawdown' && b.dateKey === '2026-01-06'), sc.breaches);
check('daily loss breach detected', sc.breaches.some(b => b.type === 'daily-loss' && b.dateKey === '2026-01-06'));
check('final equity correct', Math.abs(sc.equity - 10600) < 1e-6, sc.equity);
check('consistency: best day 1000 of 600 profit fails 50%', sc.consistency && sc.consistency.pass === false, sc.consistency);

const staticAcc = { id: 'syn', rules: { startingBalance: 10000, maxDrawdown: 1000, drawdownType: 'static', dailyLossLimit: null, profitTarget: null, consistencyPct: null } };
const sc2 = TH4.calc.compliance(staticAcc, synth);
check('static floor: no breach at 9800 vs 9000 floor', sc2.breaches.length === 0, sc2.breaches);

// ---- 9. v2: edge stats + breakdown ----
const es = TH4.calc.edgeStats(synth);
check('expectancy = 600/3', Math.abs(es.expectancy - 200) < 1e-6, es.expectancy);
const bd = TH4.calc.breakdown(synth, t => ({ key: t.symbol, label: t.symbol }));
check('breakdown groups by symbol', bd.length === 1 && bd[0].count === 3 && Math.abs(bd[0].pl - 600) < 1e-6);

// ---- 10. v2: csv round trip ----
const rowsIn = [['a', 'b,with comma', 'c"quote'], ['1', 'line\nbreak', '']];
const csvText = TH4.calc.csvSerialize(rowsIn);
const back = TH4.calc.csvParse('h1,h2,h3\r\n' + csvText);
check('csv round-trips quotes/commas/newlines',
  back.rows.length === 2 && back.rows[0][1] === 'b,with comma' && back.rows[0][2] === 'c"quote' && back.rows[1][1] === 'line\nbreak',
  back.rows);

// ---- 11. v2: goals streaks ----
const streaks = TH4.calc.goalStreaks(TH4.store.get('goals'), {
  trades: TH4.store.get('trades'), prep: TH4.store.get('prep'), accounts: TH4.store.get('accounts')
});
check('4 enabled goals have streaks', streaks.length === 4 && streaks.every(s => s.best >= s.current), streaks.map(s => s.kind + ':' + s.current + '/' + s.best));

// ---- 12. v2: migration v1 -> v2 re-applies ----
{
  const meta = TH4.store.get('meta');
  meta.schemaVersion = 1;
  TH4.store.save('meta', meta);
  const accs = TH4.store.get('accounts');
  accs.forEach(a => { delete a.rules; });
  TH4.store.save('accounts', accs);
  ctx.localStorage.removeItem('th:v1:goals');
}
vm.runInContext(fs.readFileSync(ROOT + '/js/store.js', 'utf8'), ctx, { filename: 'store5' });
const TH5 = vm.runInContext('window.TH', ctx);
TH5.store.init();
const migAcc = TH5.store.get('accounts')[0];
check('migration restores rules from balance/drawdown', !!migAcc.rules && migAcc.rules.startingBalance !== null, migAcc.rules);
check('migration seeds default goals', (TH5.store.get('goals') || []).length === 4);
check('schemaVersion bumped to 2', TH5.store.get('meta').schemaVersion === 2);

// ---- 13. v3: fresh seed mode ----
const fresh = TH5.seed.generateFresh();
check('fresh seed: zero trades/expenses', fresh.trades.length === 0 && fresh.expenses.length === 0);
check('fresh seed: one manual account', fresh.accounts.length === 1 && fresh.accounts[0].type === 'manual');
check('fresh seed: keeps playbook scaffolding', fresh.strategies.length === 2 && fresh.tags.length === 8 && fresh.goals.length === 4);
check('fresh seed: gettingStarted flag on', fresh.settings.gettingStarted === true);

// resetTo('fresh') keeps the theme preference
ctx.localStorage.setItem('th:theme', 'dark');
TH5.store.resetTo('fresh');
check('resetTo fresh: journal reseeded empty', (TH5.store.get('trades') || []).length === 0);
check('resetTo fresh: theme survives', ctx.localStorage.getItem('th:theme') === 'dark');
check('meta.seedMode = fresh', TH5.store.get('meta').seedMode === 'fresh');

// ---- 14. v3: store change notifications ----
let notified = [];
TH5.store.onChange(e => notified.push(e));
TH5.store.save('tags', TH5.store.get('tags'));
check('save() notifies listeners', notified.indexOf('tags') !== -1, notified);

// ---- 16. v4: symbol normalization ----
[
  ['ESU6', 'ES'], ['ESU2026', 'ES'], ['MESZ5', 'MES'], ['ES 09-26', 'ES'],
  ['ES SEP26', 'ES'], ['MNQZ2026', 'MNQ'], ['CLX5', 'CL'], ['6EU6', '6E'],
  ['M6EU6', 'M6E'], ['GC 12-26', 'GC'], ['ES', 'ES']
].forEach(([raw, want]) => {
  const got = TH5.calc.normalizeSymbol(raw);
  check(`normalizeSymbol ${raw} -> ${want}`, got.symbol === want && got.known === true, got);
});
check('normalizeSymbol unknown passes through', TH5.calc.normalizeSymbol('XYZU6').known === false);

// ---- 17. v4: fill pairing ----
function fill(sym, ts, side, qty, price, id) {
  return { symbol: sym, ts, side, qty, price, commission: 1, execId: id };
}
// simple round trip
let pf = TH5.calc.pairFills([
  fill('ES', '2026-03-02T09:30:00', 'buy', 2, 5000, 'a'),
  fill('ES', '2026-03-02T09:45:00', 'sell', 2, 5010, 'b')
]);
check('pair: one round trip', pf.trades.length === 1 && pf.open.length === 0);
check('pair: direction/qty/prices', (() => {
  const t = pf.trades[0];
  return t.direction === 'long' && t.contracts === 2 && t.entryPrice === 5000 && t.exitPrice === 5010;
})(), pf.trades[0]);

// scale-in: weighted entry + pyramid count
pf = TH5.calc.pairFills([
  fill('NQ', '2026-03-02T10:00:00', 'buy', 1, 18000, 'c'),
  fill('NQ', '2026-03-02T10:05:00', 'buy', 1, 18010, 'd'),
  fill('NQ', '2026-03-02T10:20:00', 'sell', 2, 18030, 'e')
]);
check('pair: scale-in weighted entry', pf.trades.length === 1 && pf.trades[0].entryPrice === 18005 && pf.trades[0].entryFillCount === 2, pf.trades[0]);

// flip long -> short splits into two trades
pf = TH5.calc.pairFills([
  fill('ES', '2026-03-03T09:30:00', 'buy', 2, 5000, 'f'),
  fill('ES', '2026-03-03T09:40:00', 'sell', 5, 5008, 'g'),
  fill('ES', '2026-03-03T09:55:00', 'buy', 3, 5004, 'h')
]);
check('pair: flip splits into two trades', pf.trades.length === 2, pf.trades.length);
check('pair: flip trade 1 long 2 lots', pf.trades[0].direction === 'long' && pf.trades[0].contracts === 2);
check('pair: flip trade 2 short 3 lots', pf.trades[1].direction === 'short' && pf.trades[1].contracts === 3 && pf.trades[1].entryPrice === 5008 && pf.trades[1].exitPrice === 5004);

// open position at end is reported, not emitted
pf = TH5.calc.pairFills([fill('GC', '2026-03-04T09:00:00', 'buy', 1, 2400, 'i')]);
check('pair: open position not emitted', pf.trades.length === 0 && pf.open.length === 1 && pf.open[0].position === 1);

// interleaved symbols pair independently
pf = TH5.calc.pairFills([
  fill('ES', '2026-03-05T09:00:00', 'buy', 1, 5000, 'j'),
  fill('NQ', '2026-03-05T09:01:00', 'sell', 1, 18000, 'k'),
  fill('ES', '2026-03-05T09:10:00', 'sell', 1, 5002, 'l'),
  fill('NQ', '2026-03-05T09:12:00', 'buy', 1, 17990, 'm')
]);
check('pair: interleaved symbols', pf.trades.length === 2 && pf.trades.every(t => t.contracts === 1));

// ---- 18. v4: broker preset auto-mapping (NT8 Trade Performance fixture) ----
const ntCsv = 'Trade number,Instrument,Account,Strategy,Market pos.,Qty,Entry price,Exit price,Entry time,Exit time,Entry name,Exit name,Profit,Cum. profit,Commission,MAE,MFE\r\n' +
  '1,ES 09-26,Sim101,,Long,2,5000.25,5008.50,3/2/2026 9:30:00 AM,3/2/2026 9:45:00 AM,Entry,Exit,$823.00,$823.00,$4.20,$100.00,$900.00';
const ntParsed = TH5.calc.csvParse(ntCsv);
const ntMap = TH5.calc.autoMapHeaders(ntParsed.headers, TH5.calc.BROKER_PRESETS['nt8-trades'].hints);
check('NT8 preset maps all key columns', ['symbol','direction','contracts','entryPrice','exitPrice','entryTime','exitTime','commissions'].every(k => ntMap[k] !== -1), ntMap);
check('NT8 instrument normalizes', TH5.calc.normalizeSymbol(ntParsed.rows[0][ntMap.symbol]).symbol === 'ES');
check('parseSide handles Long/Sell/B', TH5.calc.parseSide('Long') === 'buy' && TH5.calc.parseSide('Sell') === 'sell' && TH5.calc.parseSide('B') === 'buy');

// expanded point values sanity
check('point values: CL/GC/YM/6E present', TH5.calc.POINT_VALUES.CL === 1000 && TH5.calc.POINT_VALUES.GC === 100 && TH5.calc.POINT_VALUES.YM === 5 && TH5.calc.POINT_VALUES['6E'] === 125000);

// ---- 15. v3: cloud sync with mocked supabase ----
(async function () {
  // mock supabase client
  const calls = { upserts: [], deletes: 0, authCb: null };
  const remote = { rows: [] };
  ctx.supabase = {
    createClient: function () {
      return {
        auth: {
          onAuthStateChange: function (cb) { calls.authCb = cb; },
          signOut: function () { return Promise.resolve({}); }
        },
        from: function () {
          return {
            select: function () { return Promise.resolve({ data: remote.rows, error: null }); },
            upsert: function (rows) { calls.upserts.push(rows); return Promise.resolve({ error: null }); },
            delete: function () { return { eq: function () { calls.deletes++; return Promise.resolve({ error: null }); } }; }
          };
        }
      };
    }
  };
  ctx.TH_CLOUD = { url: 'https://mock.local', anonKey: 'mock-key' };
  vm.runInContext(fs.readFileSync(ROOT + '/js/cloud.js', 'utf8'), ctx, { filename: 'cloud.js' });
  const cloud = vm.runInContext('window.TH.cloud', ctx);

  check('cloud reports configured', cloud.configured() === true);
  cloud.boot();
  check('boot lands in signedOut', cloud.getStatus().status === 'signedOut');
  check('auth listener registered', typeof calls.authCb === 'function');

  // sign in with an empty cloud → local journal auto-uploads
  calls.authCb('SIGNED_IN', { user: { id: 'user-1', email: 't@example.com' } });
  await new Promise(r => setTimeout(r, 50));
  check('first login uploads local journal', calls.upserts.length >= 1, calls.upserts.length);
  const uploaded = calls.upserts.flat();
  check('upload rows carry user_id + entities', uploaded.length > 5 && uploaded.every(r => r.user_id === 'user-1'), uploaded.length);
  check('trades entity included in upload', uploaded.some(r => r.entity === 'trades'));
  check('status synced after upload', cloud.getStatus().status === 'synced');

  // dirty tracking → syncNow pushes just the dirty entity
  const before = calls.upserts.length;
  TH5.store.save('tags', TH5.store.get('tags'));           // marks dirty via onChange
  await cloud.syncNow();
  const pushed = calls.upserts.slice(before).flat();
  check('syncNow pushes dirty entity', pushed.some(r => r.entity === 'tags'), pushed.map(r => r.entity));
  check('dirty set drained after push', cloud._internals.meta().dirty.length === 0);

  // remote-newer row wins when not dirty locally
  remote.rows = [{ entity: 'settings', data: { workspaceName: 'From Cloud', traderName: 'Cloud T' }, updated_at: '2999-01-01T00:00:00Z' }];
  await cloud.syncNow();
  check('remote-newer settings applied locally', (TH5.store.get('settings') || {}).workspaceName === 'From Cloud');

  // delete cloud copy
  await cloud.deleteCloudCopy();
  check('deleteCloudCopy issues delete', calls.deletes === 1);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

