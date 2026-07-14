/* Expenses page — subscriptions (auto-renew) + one-time costs + net P&L tie-in */
(function () {
  'use strict';
  var ui, calc, store;

  var CATEGORIES = {
    'data-feed': { label: 'Data feed', badge: 'blue' },
    platform: { label: 'Platform', badge: 'teal' },
    'prop-eval': { label: 'Prop eval', badge: 'violet' },
    education: { label: 'Education', badge: 'amber' },
    hardware: { label: 'Hardware', badge: 'green' },
    other: { label: 'Other', badge: '' }
  };
  function catBadge(cat) {
    var m = CATEGORIES[cat] || CATEGORIES.other;
    return '<span class="badge ' + m.badge + '">' + m.label + '</span>';
  }
  function categoryOptions(sel) {
    return Object.keys(CATEGORIES).map(function (k) {
      return '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + CATEGORIES[k].label + '</option>';
    }).join('');
  }

  /* ---------- subscription CRUD ---------- */
  function subForm(existing) {
    var wrap = ui.el('div', { class: 'form-grid' });
    wrap.innerHTML =
      '<label class="field"><span>Name <b class="req">*</b></span><input type="text" id="sName" maxlength="48" placeholder="e.g. CME data bundle" value="' + ui.esc(existing ? existing.name : '') + '"></label>' +
      '<label class="field"><span>Amount ($) <b class="req">*</b></span><input type="number" id="sAmount" min="0" step="0.01" value="' + (existing ? existing.amount : '') + '"></label>' +
      '<label class="field"><span>Billing cycle</span><select id="sCycle"><option value="monthly"' + (existing && existing.cycle === 'monthly' ? ' selected' : '') + '>Monthly</option><option value="yearly"' + (existing && existing.cycle === 'yearly' ? ' selected' : '') + '>Yearly</option></select></label>' +
      '<label class="field"><span>Next renewal <b class="req">*</b></span><input type="date" id="sNext" value="' + (existing ? existing.nextRenewal : calc.addDays(calc.todayKey(), 30)) + '"></label>' +
      '<label class="field"><span>Category</span><select id="sCat">' + categoryOptions(existing ? existing.category : 'platform') + '</select></label>' +
      '<label class="field"><span>Auto-renew</span><div class="row" style="padding:8px 0"><label class="switch"><input type="checkbox" id="sAuto"' + (!existing || existing.autoRenew ? ' checked' : '') + '><span class="track"></span></label><span class="muted" style="font-size:12px">Log an expense automatically each cycle</span></div></label>' +
      '<p class="muted full" style="font-size:12px;margin:0">When a renewal date passes, TradeHarbor logs the expense for you and advances the date one cycle — so Net P&amp;L on Stats always includes your real costs.</p>';
    return wrap;
  }

  function readSubForm(body, existing) {
    var name = ui.qs('#sName', body).value.trim();
    var amount = parseFloat(ui.qs('#sAmount', body).value);
    var next = ui.qs('#sNext', body).value;
    if (!name) { ui.toast('Subscription name is required.', 'err'); return null; }
    if (!(amount >= 0)) { ui.toast('Amount must be zero or more.', 'err'); return null; }
    if (!next) { ui.toast('Pick the next renewal date.', 'err'); return null; }
    return {
      id: existing ? existing.id : store.newId('sub'),
      name: name, amount: amount,
      cycle: ui.qs('#sCycle', body).value,
      nextRenewal: next,
      autoRenew: ui.qs('#sAuto', body).checked,
      category: ui.qs('#sCat', body).value
    };
  }

  function openSubEditor(existing) {
    ui.modal({
      title: existing ? 'Edit subscription' : 'Add subscription',
      wide: true,
      body: subForm(existing),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: existing ? 'Save changes' : 'Add subscription', kind: 'primary',
          onClick: function (body) {
            var sub = readSubForm(body, existing);
            if (!sub) return false;
            var subs = store.get('subscriptions') || [];
            var i = subs.findIndex(function (s) { return s.id === sub.id; });
            if (i === -1) subs.push(sub); else subs[i] = sub;
            store.save('subscriptions', subs);
            ui.toast(existing ? 'Subscription updated' : 'Subscription added');
            rerender();
          }
        }
      ]
    });
  }

  function deleteSub(sub) {
    ui.confirm({
      title: 'Delete “' + sub.name + '”?',
      message: 'Future auto-renewals stop. Expenses already logged from past renewals stay in your history.',
      okLabel: 'Delete subscription', danger: true
    }).then(function (ok) {
      if (!ok) return;
      store.save('subscriptions', (store.get('subscriptions') || []).filter(function (s) { return s.id !== sub.id; }));
      ui.toast('Subscription deleted');
      rerender();
    });
  }

  function logRenewalNow(sub) {
    var expenses = store.get('expenses') || [];
    expenses.push({
      id: store.newId('exp'), name: sub.name, amount: sub.amount,
      dateKey: sub.nextRenewal, category: sub.category, subscriptionId: sub.id
    });
    var subs = store.get('subscriptions') || [];
    var s = subs.filter(function (x) { return x.id === sub.id; })[0];
    s.nextRenewal = calc.advanceCycle(s.nextRenewal, s.cycle);
    store.save('expenses', expenses);
    store.save('subscriptions', subs);
    ui.toast('Renewal logged — next due ' + calc.fmtDateKey(s.nextRenewal));
    rerender();
  }

  /* ---------- one-time expense CRUD ---------- */
  function expForm(existing) {
    var wrap = ui.el('div', { class: 'form-grid' });
    wrap.innerHTML =
      '<label class="field"><span>Name <b class="req">*</b></span><input type="text" id="eName" maxlength="48" placeholder="e.g. eval reset fee" value="' + ui.esc(existing ? existing.name : '') + '"></label>' +
      '<label class="field"><span>Amount ($) <b class="req">*</b></span><input type="number" id="eAmount" min="0" step="0.01" value="' + (existing ? existing.amount : '') + '"></label>' +
      '<label class="field"><span>Date</span><input type="date" id="eDate" value="' + (existing ? existing.dateKey : calc.todayKey()) + '"></label>' +
      '<label class="field"><span>Category</span><select id="eCat">' + categoryOptions(existing ? existing.category : 'other') + '</select></label>';
    return wrap;
  }

  function openExpEditor(existing) {
    ui.modal({
      title: existing ? 'Edit expense' : 'Add one-time expense',
      body: expForm(existing),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: existing ? 'Save changes' : 'Add expense', kind: 'primary',
          onClick: function (body) {
            var name = ui.qs('#eName', body).value.trim();
            var amount = parseFloat(ui.qs('#eAmount', body).value);
            var date = ui.qs('#eDate', body).value;
            if (!name) { ui.toast('Expense name is required.', 'err'); return false; }
            if (!(amount >= 0)) { ui.toast('Amount must be zero or more.', 'err'); return false; }
            if (!date) { ui.toast('Pick a date.', 'err'); return false; }
            var expenses = store.get('expenses') || [];
            if (existing) {
              var e = expenses.filter(function (x) { return x.id === existing.id; })[0];
              e.name = name; e.amount = amount; e.dateKey = date; e.category = ui.qs('#eCat', body).value;
            } else {
              expenses.push({ id: store.newId('exp'), name: name, amount: amount, dateKey: date, category: ui.qs('#eCat', body).value, subscriptionId: null });
            }
            store.save('expenses', expenses);
            ui.toast(existing ? 'Expense updated' : 'Expense added');
            rerender();
          }
        }
      ]
    });
  }

  function deleteExp(exp) {
    ui.confirm({
      title: 'Delete expense?',
      message: '“' + exp.name + '” (' + ui.fmtMoney(exp.amount, { plus: false }) + ' on ' + calc.fmtDateKey(exp.dateKey) + ') will be removed from your totals.',
      okLabel: 'Delete', danger: true
    }).then(function (ok) {
      if (!ok) return;
      store.save('expenses', (store.get('expenses') || []).filter(function (e) { return e.id !== exp.id; }));
      ui.toast('Expense deleted');
      rerender();
    });
  }

  /* ---------- sections ---------- */
  function renderKpis(root) {
    var subs = store.get('subscriptions') || [];
    var expenses = store.get('expenses') || [];
    var today = calc.todayKey();
    var monthStart = today.slice(0, 8) + '01';
    var yearStart = today.slice(0, 4) + '-01-01';
    var recurring = calc.monthlyRecurring(subs);
    var thisMonth = calc.expenseTotal(expenses, monthStart, today);
    var ytd = calc.expenseTotal(expenses, yearStart, today);
    var upcoming = calc.upcomingRenewals(subs, 30);

    var kpis = ui.el('div', { class: 'kpis' });
    kpis.innerHTML =
      '<div class="kpi"><div class="k-label">Monthly recurring</div><div class="k-value">' + ui.fmtMoney(recurring, { plus: false }) + '</div><div class="k-sub">' + subs.filter(function (s) { return s.autoRenew; }).length + ' auto-renewing subscription' + (subs.filter(function (s) { return s.autoRenew; }).length === 1 ? '' : 's') + ' (yearly ÷ 12).</div></div>' +
      '<div class="kpi"><div class="k-label">Spent this month</div><div class="k-value">' + ui.fmtMoney(thisMonth, { plus: false }) + '</div><div class="k-sub">Subscriptions + one-time costs since ' + calc.fmtDateKey(monthStart) + '.</div></div>' +
      '<div class="kpi"><div class="k-label">Spent year to date</div><div class="k-value">' + ui.fmtMoney(ytd, { plus: false }) + '</div><div class="k-sub">Every logged trading cost in ' + today.slice(0, 4) + '.</div></div>' +
      '<div class="kpi"><div class="k-label">Upcoming renewals</div><div class="k-value">' + upcoming.length + '</div><div class="k-sub">' + (upcoming.length ? 'Next: ' + ui.esc(upcoming[0].name) + ' ' + ui.relDate(upcoming[0].nextRenewal) + '.' : 'Nothing due in the next 30 days.') + '</div></div>';
    root.appendChild(kpis);

    /* net P&L context strip */
    var trades = calc.filterTrades(store.get('trades') || [], { from: monthStart, to: today }, {});
    var tradePL = trades.reduce(function (s, t) { return s + calc.net(t); }, 0);
    var netAfter = tradePL - thisMonth;
    var strip = ui.el('div', { class: 'kpis', style: 'grid-template-columns:repeat(3,1fr)' });
    strip.innerHTML =
      '<div class="kpi"><div class="k-label">Trading P/L · this month</div><div class="k-value ' + ui.plClass(tradePL) + '">' + ui.fmtMoney(tradePL) + '</div><div class="k-sub">' + trades.length + ' trade' + (trades.length === 1 ? '' : 's') + ' since ' + calc.fmtDateKey(monthStart) + '.</div></div>' +
      '<div class="kpi"><div class="k-label">Expenses · this month</div><div class="k-value pl-neg">' + ui.fmtMoney(-thisMonth) + '</div><div class="k-sub">What it cost to sit at the desk.</div></div>' +
      '<div class="kpi highlight"><div class="k-label">Net P&amp;L after expenses</div><div class="k-value ' + ui.plClass(netAfter) + '">' + ui.fmtMoney(netAfter) + '</div><div class="k-sub">What trading actually earned this month. Also shown on <a href="stats.html">Stats</a>.</div></div>';
    root.appendChild(strip);
  }

  function renderSubs(parent) {
    var subs = (store.get('subscriptions') || []).slice().sort(function (a, b) { return a.nextRenewal < b.nextRenewal ? -1 : 1; });
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Subscriptions' }),
        ui.el('p', { class: 'card-sub', text: 'Recurring costs. Auto-renew logs the expense for you every cycle.' })
      ]),
      ui.el('button', { class: 'btn primary', text: '+ Add subscription', onclick: function () { openSubEditor(null); } })
    ]));
    if (!subs.length) {
      card.appendChild(ui.emptyState({
        icon: '↻', title: 'No subscriptions tracked',
        message: 'Data feeds, platforms, eval fees — add them so your Net P&L tells the truth.'
      }));
      parent.appendChild(card);
      return;
    }
    var wrap = ui.el('div', { class: 'tbl-wrap' });
    var tbl = ui.el('table', { class: 'tbl' });
    tbl.innerHTML = '<thead><tr><th>Subscription</th><th>Category</th><th class="num">Amount</th><th>Cycle</th><th>Next renewal</th><th>Auto-renew</th><th></th></tr></thead>';
    var tbody = ui.el('tbody');
    subs.forEach(function (s) {
      var tr = ui.el('tr');
      tr.innerHTML =
        '<td><b>' + ui.esc(s.name) + '</b></td>' +
        '<td>' + catBadge(s.category) + '</td>' +
        '<td class="num">' + ui.fmtMoney(s.amount, { plus: false }) + '</td>' +
        '<td>' + (s.cycle === 'yearly' ? 'Yearly' : 'Monthly') + '</td>' +
        '<td>' + calc.fmtDateKey(s.nextRenewal) + '<br><span class="muted" style="font-size:11px">' + ui.relDate(s.nextRenewal) + '</span></td>';
      var tdAuto = ui.el('td');
      var sw = ui.el('label', { class: 'switch' });
      var cb = ui.el('input', { type: 'checkbox' });
      cb.checked = s.autoRenew;
      cb.addEventListener('change', function () {
        var list = store.get('subscriptions') || [];
        list.filter(function (x) { return x.id === s.id; })[0].autoRenew = cb.checked;
        store.save('subscriptions', list);
        ui.toast(cb.checked ? 'Auto-renew on — renewals will log themselves' : 'Auto-renew off — log renewals manually');
        rerender();
      });
      sw.appendChild(cb);
      sw.appendChild(ui.el('span', { class: 'track' }));
      tdAuto.appendChild(sw);
      tr.appendChild(tdAuto);
      var tdAct = ui.el('td', { class: 'right nowrap' });
      tdAct.appendChild(ui.el('button', { class: 'btn small ghost', text: 'Log now', title: 'Log this renewal as an expense today and advance the date', onclick: function () { logRenewalNow(s); } }));
      tdAct.appendChild(document.createTextNode(' '));
      tdAct.appendChild(ui.el('button', { class: 'btn small ghost', text: 'Edit', onclick: function () { openSubEditor(s); } }));
      tdAct.appendChild(document.createTextNode(' '));
      tdAct.appendChild(ui.el('button', { class: 'btn small danger', text: '✕', title: 'Delete subscription', onclick: function () { deleteSub(s); } }));
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    card.appendChild(wrap);
    parent.appendChild(card);
  }

  function renderUpcoming(parent) {
    var subs = store.get('subscriptions') || [];
    var upcoming = calc.upcomingRenewals(subs, 30);
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Upcoming renewals' }),
        ui.el('p', { class: 'card-sub', text: 'Next 30 days — cancel anything you no longer use before it bills.' })
      ])
    ]));
    if (!upcoming.length) {
      card.appendChild(ui.el('p', { class: 'muted', style: 'margin:0;font-size:13px', text: 'Nothing renews in the next 30 days.' }));
    } else {
      var list = ui.el('div', { class: 'stack', style: 'gap:8px' });
      upcoming.forEach(function (s) {
        var row = ui.el('div', { class: 'rule-item' });
        row.innerHTML =
          '<div style="flex:1"><b>' + ui.esc(s.name) + '</b> <span class="muted" style="font-size:12px">· ' + calc.fmtDateKey(s.nextRenewal) + ' (' + ui.relDate(s.nextRenewal) + ')</span></div>' +
          '<span class="' + (s.autoRenew ? '' : 'muted') + '" style="font-weight:700">' + ui.fmtMoney(s.amount, { plus: false }) + '</span>' +
          (s.autoRenew ? '<span class="badge teal">auto</span>' : '<span class="badge">manual</span>');
        list.appendChild(row);
      });
      card.appendChild(list);
    }
    parent.appendChild(card);
  }

  function renderExpenses(parent) {
    var expenses = (store.get('expenses') || []).slice().sort(function (a, b) { return a.dateKey < b.dateKey ? 1 : -1; });
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Expense history' }),
        ui.el('p', { class: 'card-sub', text: 'One-time costs plus every auto-logged subscription renewal, newest first.' })
      ]),
      ui.el('button', { class: 'btn primary', text: '+ Add one-time expense', onclick: function () { openExpEditor(null); } })
    ]));
    if (!expenses.length) {
      card.appendChild(ui.emptyState({
        icon: '¤', title: 'No expenses logged',
        message: 'Add a one-time cost or wait for a subscription to renew — it will appear here.'
      }));
      parent.appendChild(card);
      return;
    }
    var wrap = ui.el('div', { class: 'tbl-wrap' });
    var tbl = ui.el('table', { class: 'tbl' });
    tbl.innerHTML = '<thead><tr><th>Date</th><th>Expense</th><th>Category</th><th>Type</th><th class="num">Amount</th><th></th></tr></thead>';
    var tbody = ui.el('tbody');
    expenses.slice(0, 60).forEach(function (e) {
      var tr = ui.el('tr');
      tr.innerHTML =
        '<td class="nowrap">' + calc.fmtDateKey(e.dateKey) + '</td>' +
        '<td><b>' + ui.esc(e.name) + '</b></td>' +
        '<td>' + catBadge(e.category) + '</td>' +
        '<td>' + (e.subscriptionId ? '<span class="badge teal">renewal</span>' : '<span class="badge">one-time</span>') + '</td>' +
        '<td class="num pl-neg">' + ui.fmtMoney(-e.amount) + '</td>';
      var tdAct = ui.el('td', { class: 'right nowrap' });
      if (!e.subscriptionId) {
        tdAct.appendChild(ui.el('button', { class: 'btn small ghost', text: 'Edit', onclick: function () { openExpEditor(e); } }));
        tdAct.appendChild(document.createTextNode(' '));
      }
      tdAct.appendChild(ui.el('button', { class: 'btn small danger', text: '✕', title: 'Delete expense', onclick: function () { deleteExp(e); } }));
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    if (expenses.length > 60) card.appendChild(ui.el('p', { class: 'muted', style: 'font-size:12px;margin:8px 0 0', text: 'Showing the 60 most recent of ' + expenses.length + ' expenses.' }));
    card.appendChild(wrap);
    parent.appendChild(card);
  }

  /* ---------- page ---------- */
  function rerender() {
    var root = ui.qs('#pageBody');
    root.innerHTML = '';
    var side = ui.qs('#headSide');
    if (side) side.innerHTML = '';
    build(root);
  }

  function build(root) {
    var subs = store.get('subscriptions') || [];
    ui.headStat(ui.fmtMoney(calc.monthlyRecurring(subs), { plus: false, dec: 0 }), 'Monthly recurring');
    renderKpis(root);
    var cols = ui.el('div', { class: 'grid-2', style: 'grid-template-columns:1.4fr 1fr;align-items:start' });
    var left = ui.el('div', { class: 'stack' });
    var right = ui.el('div', { class: 'stack' });
    renderSubs(left);
    renderExpenses(left);
    renderUpcoming(right);
    cols.appendChild(left);
    cols.appendChild(right);
    root.appendChild(cols);
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    build(ui.qs('#pageBody'));
  });
})();
