/* Manual Entry page — hand-log a trade with a live derived-P/L preview */
(function () {
  'use strict';
  var ui, calc, store;

  function nowLocalInput(offsetMin) {
    var d = new Date(Date.now() + (offsetMin || 0) * 60000);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function readTrade() {
    var g = function (id) { return ui.qs('#' + id); };
    var accountId = g('mAcc').value;
    var symbol = g('mSym').value;
    var contracts = parseInt(g('mCts').value, 10);
    var entryPrice = parseFloat(g('mEntry').value);
    var exitPrice = parseFloat(g('mExit').value);
    var entryTime = g('mEntryT').value;
    var exitTime = g('mExitT').value;
    var risk = parseFloat(g('mRisk').value);
    var comm = parseFloat(g('mComm').value);

    var errors = [];
    if (!accountId) errors.push('Pick an account.');
    if (!symbol) errors.push('Pick a symbol.');
    if (!(contracts > 0)) errors.push('Contracts must be at least 1.');
    if (isNaN(entryPrice)) errors.push('Entry price is required.');
    if (isNaN(exitPrice)) errors.push('Exit price is required.');
    if (!entryTime) errors.push('Entry time is required.');
    if (!exitTime) errors.push('Exit time is required.');
    if (entryTime && exitTime && exitTime < entryTime) errors.push('Exit time is before entry time.');
    if (g('mRisk').value !== '' && !(risk > 0)) errors.push('Risk must be a positive dollar amount.');

    var trade = {
      id: store.newId('t'),
      accountId: accountId,
      symbol: symbol,
      direction: g('mDir').value,
      contracts: contracts || 1,
      entryPrice: entryPrice,
      exitPrice: exitPrice,
      entryTime: entryTime ? entryTime + ':00' : null,
      exitTime: exitTime ? exitTime + ':00' : null,
      dateKey: entryTime ? entryTime.slice(0, 10) : null,
      commissions: isNaN(comm) ? 0 : comm,
      riskAmount: isNaN(risk) ? null : risk,
      source: 'manual',
      brokerTradeId: null,
      entryFillCount: 1,
      tagIds: [],
      notes: g('mNotes').value.trim(),
      checklist: null,
      confidence: g('mConf').value ? parseInt(g('mConf').value, 10) : null,
      emotions: g('mEmo').value ? [g('mEmo').value] : [],
      mistakes: []
    };
    return { trade: trade, errors: errors };
  }

  function updatePreview() {
    var res = readTrade();
    var t = res.trade;
    var box = ui.qs('#mPreview');
    if (isNaN(t.entryPrice) || isNaN(t.exitPrice) || !t.symbol) {
      box.innerHTML = '<div class="empty" style="padding:22px"><h4>Live preview</h4><p>Fill in symbol, prices and contracts to see derived P&L, points and R before saving.</p></div>';
      return;
    }
    var net = calc.net(t), pts = calc.points(t), r = calc.rMultiple(t), gross = calc.gross(t);
    var resLabel = calc.result(t);
    box.innerHTML =
      '<div class="kpis" style="grid-template-columns:repeat(2,1fr)">' +
      '<div class="kpi"><div class="k-label">Net P/L</div><div class="k-value ' + ui.plClass(net) + '">' + ui.fmtMoney(net) + '</div><div class="k-sub">Gross ' + ui.fmtMoney(gross) + ' − fees ' + ui.fmtMoney(t.commissions, { plus: false }) + '</div></div>' +
      '<div class="kpi"><div class="k-label">R multiple</div><div class="k-value ' + ui.plClass(r || 0) + '">' + ui.fmtR(r) + '</div><div class="k-sub">' + (t.riskAmount ? 'On $' + t.riskAmount + ' risk' : 'Add risk $ to compute R') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Points</div><div class="k-value">' + (pts >= 0 ? '+' : '−') + Math.abs(pts).toFixed(2) + '</div><div class="k-sub">' + t.symbol + ' · $' + calc.POINT_VALUES[t.symbol] + '/pt · ' + t.contracts + ' contract' + (t.contracts === 1 ? '' : 's') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Result</div><div class="k-value">' + (resLabel === 'win' ? '<span class="pl-pos">Win</span>' : resLabel === 'loss' ? '<span class="pl-neg">Loss</span>' : '<span class="pl-flat">Breakeven</span>') + '</div><div class="k-sub">' + (t.direction === 'long' ? 'Long' : 'Short') + ' ' + t.entryPrice + ' → ' + t.exitPrice + '</div></div>' +
      '</div>';
  }

  function render() {
    var root = ui.qs('#pageBody');
    var accounts = (store.get('accounts') || []).filter(function (a) { return a.status === 'active'; });
    var symbols = Object.keys(calc.POINT_VALUES);

    var grid = ui.el('div', { class: 'grid-2' });
    var formCard = ui.el('div', { class: 'card' });
    formCard.innerHTML =
      '<div class="card-head"><div><h2 class="card-title">Trade details</h2>' +
      '<p class="card-sub">Everything below stays editable later from Trade Review.</p></div></div>' +
      '<div class="form-grid">' +
      '<label class="field"><span>Account <b class="req">*</b></span><select id="mAcc">' +
      '<option value="">Choose account…</option>' +
      accounts.map(function (a) { return '<option value="' + a.id + '">' + ui.esc(a.name) + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="field"><span>Symbol <b class="req">*</b></span><select id="mSym">' +
      symbols.map(function (s) { return '<option value="' + s + '">' + s + ' — $' + calc.POINT_VALUES[s] + '/pt</option>'; }).join('') +
      '</select></label>' +
      '<label class="field"><span>Direction</span><select id="mDir"><option value="long">Long</option><option value="short">Short</option></select></label>' +
      '<label class="field"><span>Contracts <b class="req">*</b></span><input type="number" id="mCts" min="1" step="1" value="1"></label>' +
      '<label class="field"><span>Entry price <b class="req">*</b></span><input type="number" id="mEntry" step="0.25" placeholder="e.g. 6482.25"></label>' +
      '<label class="field"><span>Exit price <b class="req">*</b></span><input type="number" id="mExit" step="0.25" placeholder="e.g. 6495.50"></label>' +
      '<label class="field"><span>Entry time <b class="req">*</b></span><input type="datetime-local" id="mEntryT" value="' + nowLocalInput(-30) + '"></label>' +
      '<label class="field"><span>Exit time <b class="req">*</b></span><input type="datetime-local" id="mExitT" value="' + nowLocalInput(0) + '"></label>' +
      '<label class="field"><span>Dollar risk ($)</span><input type="number" id="mRisk" min="0" step="1" placeholder="planned risk — enables R"></label>' +
      '<label class="field"><span>Commissions &amp; fees ($)</span><input type="number" id="mComm" min="0" step="0.01" value="0"></label>' +
      '<label class="field"><span>Confidence going in</span><select id="mConf"><option value="">Not rated</option>' +
      [1, 2, 3, 4, 5].map(function (n) { return '<option value="' + n + '">' + n + ' / 5</option>'; }).join('') +
      '</select></label>' +
      '<label class="field"><span>Emotion</span><select id="mEmo"><option value="">None tagged</option>' +
      Object.keys(calc.EMOTIONS).map(function (k) { return '<option value="' + k + '">' + calc.EMOTIONS[k].label + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="field full"><span>Notes</span><textarea id="mNotes" placeholder="What was the setup? What did you see?"></textarea></label>' +
      '</div>' +
      '<div class="row" style="margin-top:16px;justify-content:flex-end">' +
      '<div id="mErrors" class="field-err" style="margin-right:auto"></div>' +
      '<button class="btn ghost" id="mClear">Clear</button>' +
      '<button class="btn primary" id="mSave">Save trade</button></div>';

    var side = ui.el('div', { class: 'stack' });
    var prev = ui.el('div', { class: 'card' });
    prev.innerHTML = '<div class="card-head"><div><h2 class="card-title">Derived values</h2><p class="card-sub">Computed live from your fills — the journal never stores stale math.</p></div></div><div id="mPreview"></div>';
    side.appendChild(prev);
    var help = ui.el('div', { class: 'card' });
    help.innerHTML = '<h3 class="card-title">Point values</h3><p class="card-sub" style="margin-bottom:10px">Used to convert points to dollars.</p>' +
      '<dl class="dl">' + symbols.map(function (s) { return '<dt>' + s + '</dt><dd>$' + calc.POINT_VALUES[s] + ' per point</dd>'; }).join('') + '</dl>';
    side.appendChild(help);

    grid.appendChild(formCard);
    grid.appendChild(side);
    root.appendChild(grid);

    ['mAcc', 'mSym', 'mDir', 'mCts', 'mEntry', 'mExit', 'mEntryT', 'mExitT', 'mRisk', 'mComm'].forEach(function (id) {
      ui.qs('#' + id).addEventListener('input', updatePreview);
    });
    updatePreview();

    ui.qs('#mClear').addEventListener('click', function () {
      ui.qsa('#pageBody input, #pageBody textarea').forEach(function (i) { i.value = i.id === 'mCts' ? '1' : i.id === 'mComm' ? '0' : ''; });
      ui.qs('#mEntryT').value = nowLocalInput(-30);
      ui.qs('#mExitT').value = nowLocalInput(0);
      ui.qs('#mErrors').textContent = '';
      updatePreview();
    });

    ui.qs('#mSave').addEventListener('click', function () {
      var res = readTrade();
      if (res.errors.length) {
        ui.qs('#mErrors').textContent = res.errors[0];
        ui.toast(res.errors[0], 'err');
        return;
      }
      ui.qs('#mErrors').textContent = '';
      var save = store.saveTrade(res.trade);
      if (!save.ok) return;
      ui.toast('Trade saved to journal');
      setTimeout(function () { location.href = 'trade-review.html?id=' + res.trade.id; }, 450);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    render();
  });
})();
