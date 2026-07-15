/* Accounts page — tracker account CRUD */
(function () {
  'use strict';
  var ui, calc, store;

  var TYPE_META = {
    eval: { label: 'Evaluation', badge: 'blue' },
    funded: { label: 'Funded', badge: 'green' },
    practice: { label: 'Practice', badge: 'violet' },
    manual: { label: 'Manual', badge: 'amber' }
  };

  function tradeCount(accountId) {
    return (store.get('trades') || []).filter(function (t) { return t.accountId === accountId; }).length;
  }

  function accountForm(existing) {
    var connections = store.get('connections') || [];
    var wrap = ui.el('div', { class: 'form-grid' });
    wrap.innerHTML =
      '<label class="field"><span>Account name <b class="req">*</b></span><input type="text" id="fName" maxlength="48" placeholder="e.g. Evaluation 150K" value="' + ui.esc(existing ? existing.name : '') + '"></label>' +
      '<label class="field"><span>Type</span><select id="fType">' +
      Object.keys(TYPE_META).map(function (k) {
        return '<option value="' + k + '"' + (existing && existing.type === k ? ' selected' : '') + '>' + TYPE_META[k].label + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field"><span>Broker connection</span><select id="fConn"><option value="">None (manual account)</option>' +
      connections.map(function (c) {
        return '<option value="' + c.id + '"' + (existing && existing.connectionId === c.id ? ' selected' : '') + '>' + ui.esc(c.name) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="field"><span>Broker account ref</span><input type="text" id="fRef" maxlength="24" placeholder="e.g. TVM-10221" value="' + ui.esc(existing && existing.brokerAccountRef ? existing.brokerAccountRef : '') + '"></label>' +
      '<label class="field"><span>Current balance ($)</span><input type="number" id="fBal" step="0.01" placeholder="optional" value="' + (existing && existing.balance != null ? existing.balance : '') + '"></label>' +
      '<label class="field"><span>Drawdown floor ($)</span><input type="number" id="fDD" step="0.01" placeholder="optional — for distance-to-DD" value="' + (existing && existing.drawdownLimit != null ? existing.drawdownLimit : '') + '"></label>';
    return wrap;
  }

  function readForm(body, existing) {
    var name = ui.qs('#fName', body).value.trim();
    if (!name) { ui.toast('Account name is required.', 'err'); return null; }
    var bal = ui.qs('#fBal', body).value;
    var dd = ui.qs('#fDD', body).value;
    return {
      id: existing ? existing.id : store.newId('acc'),
      name: name,
      type: ui.qs('#fType', body).value,
      connectionId: ui.qs('#fConn', body).value || null,
      brokerAccountRef: ui.qs('#fRef', body).value.trim() || null,
      balance: bal === '' ? null : parseFloat(bal),
      drawdownLimit: dd === '' ? null : parseFloat(dd),
      status: existing ? existing.status : 'active',
      lastSyncAt: existing ? existing.lastSyncAt : null
    };
  }

  function openEditor(existing) {
    ui.modal({
      title: existing ? 'Edit account' : 'Add account',
      wide: true,
      body: accountForm(existing),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: existing ? 'Save changes' : 'Add account', kind: 'primary',
          onClick: function (body) {
            var acc = readForm(body, existing);
            if (!acc) return false;
            var accounts = store.get('accounts') || [];
            var i = accounts.findIndex(function (a) { return a.id === acc.id; });
            if (i === -1) accounts.push(acc); else accounts[i] = acc;
            store.save('accounts', accounts);
            ui.toast(existing ? 'Account updated' : 'Account added');
            render();
          }
        }
      ]
    });
  }

  function toggleArchive(acc) {
    var accounts = store.get('accounts') || [];
    var target = accounts.filter(function (a) { return a.id === acc.id; })[0];
    target.status = target.status === 'active' ? 'archived' : 'active';
    store.save('accounts', accounts);
    ui.toast(target.status === 'archived' ? 'Account archived' : 'Account restored');
    render();
  }

  function removeAccount(acc) {
    var n = tradeCount(acc.id);
    if (n > 0) {
      ui.modal({
        title: 'Account has trade history',
        body: '<p style="color:var(--text-soft)">“' + ui.esc(acc.name) + '” still has <b>' + n + ' trade' + (n === 1 ? '' : 's') + '</b> attached. ' +
          'Deleting it would orphan that history, so TradeHarbor archives instead — the account disappears from pickers but its trades stay in your stats.</p>',
        actions: [
          { label: 'Keep active', kind: 'ghost' },
          { label: 'Archive account', kind: 'primary', onClick: function () { toggleArchive(acc); } }
        ]
      });
      return;
    }
    ui.confirm({
      title: 'Delete account?',
      message: '“' + acc.name + '” has no trades and will be permanently removed.',
      okLabel: 'Delete', danger: true
    }).then(function (ok) {
      if (!ok) return;
      store.save('accounts', (store.get('accounts') || []).filter(function (a) { return a.id !== acc.id; }));
      ui.toast('Account deleted');
      render();
    });
  }

  function render() {
    var root = ui.qs('#pageBody');
    root.innerHTML = '';
    var accounts = store.get('accounts') || [];
    var connections = store.get('connections') || [];
    var connIndex = {};
    connections.forEach(function (c) { connIndex[c.id] = c; });

    var active = accounts.filter(function (a) { return a.status === 'active'; });
    var kpis = ui.el('div', { class: 'kpis' });
    [
      { label: 'Tracker accounts', value: String(accounts.length), sub: 'All accounts in this workspace.' },
      { label: 'Active', value: String(active.length), sub: accounts.length - active.length + ' archived.' },
      { label: 'Broker-linked', value: String(active.filter(function (a) { return a.connectionId; }).length), sub: 'Fed by simulated broker sync.' },
      { label: 'Manual', value: String(active.filter(function (a) { return !a.connectionId; }).length), sub: 'Journal-only accounts.' }
    ].forEach(function (k) {
      kpis.appendChild(ui.el('div', { class: 'kpi', html: '<div class="k-label">' + k.label + '</div><div class="k-value">' + k.value + '</div><div class="k-sub">' + k.sub + '</div>' }));
    });
    root.appendChild(kpis);

    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Tracker accounts' }),
        ui.el('p', { class: 'card-sub', text: 'Stats, filters and trade history are organized around these accounts.' })
      ]),
      ui.el('button', { class: 'btn primary', text: '+ Add account', onclick: function () { openEditor(null); } })
    ]));

    if (!accounts.length) {
      card.appendChild(ui.emptyState({
        icon: '▤', title: 'No accounts yet',
        message: 'Add your first tracker account to start journaling trades against it.'
      }));
      root.appendChild(card);
      return;
    }

    var wrap = ui.el('div', { class: 'tbl-wrap' });
    var tbl = ui.el('table', { class: 'tbl' });
    tbl.innerHTML = '<thead><tr><th>Account</th><th>Type</th><th>Connection</th><th class="num">Balance</th><th class="num">Distance to DD</th><th class="num">Trades</th><th>Status</th><th></th></tr></thead>';
    var tbody = ui.el('tbody');
    accounts.slice().sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return a.name.localeCompare(b.name);
    }).forEach(function (a) {
      var meta = TYPE_META[a.type] || TYPE_META.manual;
      var conn = a.connectionId ? connIndex[a.connectionId] : null;
      var dist = (a.balance != null && a.drawdownLimit != null) ? a.balance - a.drawdownLimit : null;
      var tr = ui.el('tr');
      tr.innerHTML =
        '<td><b>' + ui.esc(a.name) + '</b>' + (a.brokerAccountRef ? '<br><span class="mono muted">' + ui.esc(a.brokerAccountRef) + '</span>' : '') + '</td>' +
        '<td><span class="badge ' + meta.badge + '">' + meta.label + '</span></td>' +
        '<td>' + (conn ? ui.esc(conn.name) : '<span class="faint">—</span>') + '</td>' +
        '<td class="num">' + (a.balance != null ? ui.fmtMoney(a.balance, { plus: false }) : '—') + '</td>' +
        '<td class="num ' + (dist != null ? (dist > 1500 ? 'pl-pos' : dist > 0 ? '' : 'pl-neg') : '') + '">' + (dist != null ? ui.fmtMoney(dist, { plus: false }) : '—') + '</td>' +
        '<td class="num">' + tradeCount(a.id) + '</td>' +
        '<td>' + (a.status === 'active' ? '<span class="badge green dot">Active</span>' : '<span class="badge">Archived</span>') + '</td>';
      var actions = ui.el('td', { class: 'right nowrap' });
      actions.appendChild(ui.el('a', { class: 'btn small ghost', href: 'compliance.html', title: 'Set prop-firm rules for this account', text: 'Rules' }));
      actions.appendChild(document.createTextNode(' '));
      actions.appendChild(ui.el('button', { class: 'btn small ghost', text: 'Edit', onclick: function () { openEditor(a); } }));
      actions.appendChild(document.createTextNode(' '));
      actions.appendChild(ui.el('button', {
        class: 'btn small ghost', text: a.status === 'active' ? 'Archive' : 'Restore',
        onclick: function () { toggleArchive(a); }
      }));
      actions.appendChild(document.createTextNode(' '));
      actions.appendChild(ui.el('button', { class: 'btn small danger', text: 'Delete', onclick: function () { removeAccount(a); } }));
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    card.appendChild(wrap);
    root.appendChild(card);
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    render();
  });
})();
