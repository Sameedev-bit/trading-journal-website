/* Prop Rules page — per-account compliance against prop-firm limits */
(function () {
  'use strict';
  var ui, calc, store;

  var DD_LABEL = { trailing: 'Trailing (EOD)', 'trail-lock': 'Trailing, locks at start', static: 'Static' };

  function ruleForm(account) {
    var r = account.rules || {};
    var wrap = ui.el('div', { class: 'form-grid' });
    wrap.innerHTML =
      '<label class="field"><span>Starting balance ($) <b class="req">*</b></span><input type="number" id="rStart" step="1" value="' + (r.startingBalance != null ? r.startingBalance : '') + '"></label>' +
      '<label class="field"><span>Max drawdown ($)</span><input type="number" id="rDD" min="0" step="1" placeholder="e.g. 2500" value="' + (r.maxDrawdown != null ? r.maxDrawdown : '') + '"></label>' +
      '<label class="field"><span>Drawdown type</span><select id="rDDType">' +
      Object.keys(DD_LABEL).map(function (k) {
        return '<option value="' + k + '"' + ((r.drawdownType || 'trailing') === k ? ' selected' : '') + '>' + DD_LABEL[k] + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field"><span>Daily loss limit ($)</span><input type="number" id="rDLL" min="0" step="1" placeholder="e.g. 1100" value="' + (r.dailyLossLimit != null ? r.dailyLossLimit : '') + '"></label>' +
      '<label class="field"><span>Profit target ($)</span><input type="number" id="rTarget" min="0" step="1" placeholder="e.g. 3000" value="' + (r.profitTarget != null ? r.profitTarget : '') + '"></label>' +
      '<label class="field"><span>Consistency rule (%)</span><input type="number" id="rCons" min="1" max="100" step="1" placeholder="best day ≤ % of profit" value="' + (r.consistencyPct != null ? r.consistencyPct : '') + '"></label>' +
      '<p class="muted full" style="font-size:12px;margin:0">Rules are checked on end-of-day equity built from your logged trades. Intraday drawdown breaches can’t be detected from fills alone.</p>';
    return wrap;
  }

  function openEditor(account) {
    ui.modal({
      title: 'Rules — ' + account.name,
      wide: true,
      body: ruleForm(account),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Save rules', kind: 'primary',
          onClick: function (body) {
            function num(id) {
              var v = ui.qs('#' + id, body).value;
              return v === '' ? null : parseFloat(v);
            }
            var start = num('rStart');
            if (start === null || isNaN(start)) { ui.toast('Starting balance is required to evaluate rules.', 'err'); return false; }
            var accounts = store.get('accounts') || [];
            var a = accounts.filter(function (x) { return x.id === account.id; })[0];
            a.rules = {
              startingBalance: start,
              maxDrawdown: num('rDD'),
              drawdownType: ui.qs('#rDDType', body).value,
              dailyLossLimit: num('rDLL'),
              profitTarget: num('rTarget'),
              consistencyPct: num('rCons')
            };
            store.save('accounts', accounts);
            ui.toast('Rules saved');
            rerender();
          }
        }
      ]
    });
  }

  function gauge(pct, kind) {
    var p = Math.max(0, Math.min(100, Math.round(pct * 100)));
    return '<div class="prog" style="margin-top:6px"><i style="width:' + p + '%' +
      (kind === 'danger' ? ';background:linear-gradient(90deg,var(--red),var(--amber))' : '') + '"></i></div>';
  }

  function accountCard(account, trades) {
    var c = calc.compliance(account, trades);
    var card = ui.el('div', { class: 'card' + ((c && c.breaches.length) ? '' : '') });
    var head = ui.el('div', { class: 'card-head' });
    head.appendChild(ui.el('div', {}, [
      ui.el('h2', { class: 'card-title', text: account.name }),
      ui.el('p', { class: 'card-sub', text: account.rules && account.rules.maxDrawdown != null ? DD_LABEL[account.rules.drawdownType || 'trailing'] + ' drawdown · rules checked over ' + (c ? c.dayCount : 0) + ' trading days.' : 'No limits set for this account yet.' })
    ]));
    var right = ui.el('div', { class: 'row', style: 'gap:6px' });
    if (c) {
      right.appendChild(ui.el('span', {
        class: 'badge ' + (c.breaches.length ? 'red dot' : 'green dot'),
        text: c.breaches.length ? 'Breached' : 'In compliance'
      }));
    }
    right.appendChild(ui.el('button', { class: 'btn small', text: 'Edit rules', onclick: function () { openEditor(account); } }));
    head.appendChild(right);
    card.appendChild(head);

    if (!c) {
      card.appendChild(ui.el('p', { class: 'muted', style: 'font-size:13px;margin:0', text: 'Set a starting balance and limits to track this account against prop-firm rules.' }));
      return card;
    }

    if (c.breaches.length) {
      var alert = ui.el('div', {
        style: 'border:1px solid var(--cell-neg-line);background:var(--cell-neg-bg);border-radius:10px;padding:10px 14px;margin-bottom:12px'
      });
      c.breaches.slice(0, 3).forEach(function (b) {
        alert.appendChild(ui.el('div', {
          style: 'font-size:12.5px;font-weight:600;color:var(--red)',
          text: (b.type === 'daily-loss'
            ? 'Daily loss limit broken on ' + calc.fmtDateKey(b.dateKey) + ' (' + ui.fmtMoney(b.amount) + ' vs −' + ui.fmtMoney(b.limit, { plus: false, dec: 0 }).replace('$', '$') + ' cap)'
            : 'Drawdown floor crossed on ' + calc.fmtDateKey(b.dateKey) + ' (' + ui.fmtMoney(b.amount) + ' below the floor)')
        }));
      });
      if (c.breaches.length > 3) alert.appendChild(ui.el('div', { class: 'muted', style: 'font-size:11px', text: '+' + (c.breaches.length - 3) + ' more breach(es)' }));
      card.appendChild(alert);
    }

    var rules = account.rules;
    var grid = ui.el('div', { class: 'kpis', style: 'grid-template-columns:repeat(2,1fr)' });

    var eq = '<div class="kpi"><div class="k-label">Equity (EOD)</div><div class="k-value">' + ui.fmtMoney(c.equity, { plus: false, dec: 0 }) + '</div>' +
      '<div class="k-sub ' + ui.plClass(c.profit) + '">' + ui.fmtMoney(c.profit) + ' since start</div></div>';

    var target = '<div class="kpi"><div class="k-label">Profit target</div>';
    if (rules.profitTarget) {
      target += '<div class="k-value">' + Math.round((c.targetProgress || 0) * 100) + '%</div>' +
        '<div class="k-sub">' + ui.fmtMoney(Math.max(0, c.profit)) + ' of ' + ui.fmtMoney(rules.profitTarget, { plus: false, dec: 0 }) + '</div>' + gauge(c.targetProgress || 0);
    } else target += '<div class="k-value faint">—</div><div class="k-sub">No target set (funded account).</div>';
    target += '</div>';

    var dd = '<div class="kpi"><div class="k-label">Drawdown buffer</div>';
    if (c.buffer != null) {
      var frac = rules.maxDrawdown ? c.buffer / rules.maxDrawdown : 0;
      dd += '<div class="k-value ' + (frac < 0.25 ? 'pl-neg' : frac < 0.5 ? '' : 'pl-pos') + '">' + ui.fmtMoney(c.buffer, { plus: false, dec: 0 }) + '</div>' +
        '<div class="k-sub">Floor at ' + ui.fmtMoney(c.floor, { plus: false, dec: 0 }) + '.</div>' + gauge(frac, frac < 0.25 ? 'danger' : '');
    } else dd += '<div class="k-value faint">—</div><div class="k-sub">No max drawdown set.</div>';
    dd += '</div>';

    var cons = '<div class="kpi"><div class="k-label">Consistency</div>';
    if (rules.consistencyPct == null) cons += '<div class="k-value faint">—</div><div class="k-sub">No consistency rule.</div>';
    else if (!c.consistency) cons += '<div class="k-value faint">—</div><div class="k-sub">Needs positive total profit to score.</div>';
    else {
      cons += '<div class="k-value ' + (c.consistency.pass ? 'pl-pos' : 'pl-neg') + '">' + Math.round(c.consistency.score * 100) + '%</div>' +
        '<div class="k-sub">Best day ' + ui.fmtMoney(c.consistency.bestDay) + ' · limit ' + rules.consistencyPct + '%.' +
        (c.consistency.pass ? '' : ' Earn ' + ui.fmtMoney(c.consistency.neededProfit, { plus: false, dec: 0 }) + ' more to dilute it.') + '</div>';
    }
    cons += '</div>';

    grid.innerHTML = eq + target + dd + cons;
    card.appendChild(grid);

    if (rules.dailyLossLimit != null) {
      card.appendChild(ui.el('p', {
        class: 'muted', style: 'font-size:12px;margin:10px 0 0',
        html: 'Daily loss limit: <b>−' + ui.fmtMoney(rules.dailyLossLimit, { plus: false, dec: 0 }) + '</b> per day' +
          (c.breaches.some(function (b) { return b.type === 'daily-loss'; }) ? ' — <span class="pl-neg">broken at least once, see above</span>.' : ' — never broken in this history. ✓')
      }));
    }
    return card;
  }

  function rerender() {
    var root = ui.qs('#pageBody');
    root.innerHTML = '';
    var side = ui.qs('#headSide');
    if (side) side.innerHTML = '';
    build(root);
  }

  function build(root) {
    var accounts = (store.get('accounts') || []).filter(function (a) { return a.status === 'active'; });
    var trades = store.get('trades') || [];
    var tracked = accounts.filter(function (a) { return calc.compliance(a, trades); });
    var breached = tracked.filter(function (a) { return calc.compliance(a, trades).breaches.length; });

    ui.headStat(String(tracked.length), 'Tracked accounts');
    ui.headStat(String(breached.length), breached.length === 1 ? 'Breach' : 'Breaches', breached.length ? 'pl-neg' : 'pl-pos');

    var kpis = ui.el('div', { class: 'kpis' });
    kpis.innerHTML =
      '<div class="kpi"><div class="k-label">Accounts with rules</div><div class="k-value">' + tracked.length + '</div><div class="k-sub">of ' + accounts.length + ' active accounts.</div></div>' +
      '<div class="kpi"><div class="k-label">In compliance</div><div class="k-value pl-pos">' + (tracked.length - breached.length) + '</div><div class="k-sub">No rule broken in logged history.</div></div>' +
      '<div class="kpi"><div class="k-label">Breached</div><div class="k-value ' + (breached.length ? 'pl-neg' : '') + '">' + breached.length + '</div><div class="k-sub">' + (breached.length ? 'Review the red cards below.' : 'Nothing to worry about.') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Evaluation basis</div><div class="k-value" style="font-size:17px">End of day</div><div class="k-sub">Built from logged fills, not tick data.</div></div>';
    root.appendChild(kpis);

    accounts.forEach(function (a) {
      root.appendChild(accountCard(a, trades));
    });

    if (!accounts.length) {
      root.appendChild(ui.emptyState({
        icon: '⛨', title: 'No active accounts',
        message: 'Add a tracker account first, then set its prop-firm rules here.',
        action: { href: 'accounts.html', label: 'Open Accounts' }
      }));
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    build(ui.qs('#pageBody'));
  });
})();
