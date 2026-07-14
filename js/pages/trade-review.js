/* Trade Review page — details, notes, screenshots, checklist, tags, reuse, delete */
(function () {
  'use strict';
  var ui, calc, store;
  var trade = null;

  var MAX_SHOTS = 3;
  var MAX_FILE_BYTES = 4 * 1024 * 1024;
  var MAX_EDGE = 1600;

  function getParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function accountName(id) {
    var a = (store.get('accounts') || []).filter(function (x) { return x.id === id; })[0];
    return a ? a.name : 'Unknown account';
  }

  function providerLabel(t) {
    if (t.source === 'manual') return 'Manual entry';
    if (t.source === 'csv') return 'CSV import';
    if (t.brokerTradeId && t.brokerTradeId.indexOf('NT-') === 0) return 'NinjaTrader';
    return 'Tradovate';
  }

  function save() { store.saveTrade(trade); }

  /* ---------- not found ---------- */
  function renderNotFound(root) {
    root.appendChild(ui.emptyState({
      icon: '∅', title: 'Trade not found',
      message: 'This trade may have been deleted, or the link is stale.',
      action: { href: 'trades.html', label: 'Back to trades' }
    }));
  }

  /* ---------- KPI strip ---------- */
  function renderKpis(root) {
    var net = calc.net(trade), r = calc.rMultiple(trade), pts = calc.points(trade);
    var pv = calc.POINT_VALUES[trade.symbol];
    var kpis = ui.el('div', { class: 'kpis' });
    kpis.innerHTML =
      '<div class="kpi"><div class="k-label">Net P/L</div><div class="k-value ' + ui.plClass(net) + '">' + ui.fmtMoney(net) + '</div><div class="k-sub">' + (net >= 0 ? 'This trade finished positive.' : 'This trade finished negative.') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Dollar risk</div><div class="k-value">' + (trade.riskAmount ? ui.fmtMoney(trade.riskAmount, { plus: false }) : '—') + '</div><div class="k-sub">' + trade.contracts + ' contract' + (trade.contracts === 1 ? '' : 's') + ' · $' + pv + ' / pt</div></div>' +
      '<div class="kpi"><div class="k-label">Result</div><div class="k-value ' + ui.plClass(net) + '">' + ui.fmtR(r) + '</div><div class="k-sub">' + (pts >= 0 ? '+' : '−') + Math.abs(pts).toFixed(2) + ' points captured.</div></div>' +
      '<div class="kpi"><div class="k-label">Trade date</div><div class="k-value" style="font-size:17px">' + calc.fmtDateKey(trade.dateKey) + '</div><div class="k-sub">' + calc.fmtTime(trade.entryTime) + ' · ' + providerLabel(trade) + '</div></div>';
    root.appendChild(kpis);
  }

  /* ---------- details ---------- */
  function renderDetails(parent) {
    var card = ui.el('div', { class: 'card' });
    var isManual = trade.source === 'manual';
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Trade details' }),
        ui.el('p', { class: 'card-sub', text: isManual ? 'Manually logged — edit anything below.' : 'Imported fills are locked so your journal always matches the broker.' })
      ]),
      ui.el('span', { class: 'badge ' + (isManual ? 'amber' : 'teal'), text: isManual ? 'Editable' : 'Read only' })
    ]));
    var dl = ui.el('dl', { class: 'dl' });
    var rows = [
      ['Account', ui.esc(accountName(trade.accountId))],
      ['Source', ui.esc(providerLabel(trade))],
      ['Instrument / direction', trade.symbol + ' / ' + (trade.direction === 'long' ? 'Long' : 'Short') + ' · ' + trade.contracts + ' contract' + (trade.contracts === 1 ? '' : 's')],
      ['Entry → exit', trade.entryPrice + ' → ' + trade.exitPrice],
      ['Entry / exit time', calc.fmtIso(trade.entryTime) + ' → ' + calc.fmtIso(trade.exitTime)],
      ['Gross P/L', '<span class="' + ui.plClass(calc.gross(trade)) + '">' + ui.fmtMoney(calc.gross(trade)) + '</span>'],
      ['Commissions & fees', ui.fmtMoney(trade.commissions || 0, { plus: false })]
    ];
    if (trade.brokerTradeId) rows.push(['Broker trade ID', '<span class="mono">' + ui.esc(trade.brokerTradeId) + '</span>']);
    if (trade.entryFillCount > 1) rows.push(['Entry fills', trade.entryFillCount + ' — <span class="badge violet dot">Pyramid detected</span>']);
    dl.innerHTML = rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('');
    card.appendChild(dl);
    if (isManual) {
      var editBtn = ui.el('button', { class: 'btn small', text: 'Edit fills', style: 'margin-top:12px' });
      editBtn.addEventListener('click', openEditFills);
      card.appendChild(editBtn);
    }
    parent.appendChild(card);
  }

  function openEditFills() {
    var body = ui.el('div', { class: 'form-grid' });
    body.innerHTML =
      '<label class="field"><span>Entry price</span><input type="number" step="0.25" id="eEntry" value="' + trade.entryPrice + '"></label>' +
      '<label class="field"><span>Exit price</span><input type="number" step="0.25" id="eExit" value="' + trade.exitPrice + '"></label>' +
      '<label class="field"><span>Contracts</span><input type="number" min="1" step="1" id="eCts" value="' + trade.contracts + '"></label>' +
      '<label class="field"><span>Dollar risk ($)</span><input type="number" min="0" step="1" id="eRisk" value="' + (trade.riskAmount || '') + '"></label>' +
      '<label class="field"><span>Commissions ($)</span><input type="number" min="0" step="0.01" id="eComm" value="' + (trade.commissions || 0) + '"></label>' +
      '<label class="field"><span>Direction</span><select id="eDir"><option value="long"' + (trade.direction === 'long' ? ' selected' : '') + '>Long</option><option value="short"' + (trade.direction === 'short' ? ' selected' : '') + '>Short</option></select></label>';
    ui.modal({
      title: 'Edit fills',
      body: body,
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Save', kind: 'primary',
          onClick: function (b) {
            var entry = parseFloat(ui.qs('#eEntry', b).value);
            var exit = parseFloat(ui.qs('#eExit', b).value);
            var cts = parseInt(ui.qs('#eCts', b).value, 10);
            if (isNaN(entry) || isNaN(exit) || !(cts > 0)) { ui.toast('Prices and contracts must be valid.', 'err'); return false; }
            trade.entryPrice = entry;
            trade.exitPrice = exit;
            trade.contracts = cts;
            var risk = parseFloat(ui.qs('#eRisk', b).value);
            trade.riskAmount = isNaN(risk) ? null : risk;
            var comm = parseFloat(ui.qs('#eComm', b).value);
            trade.commissions = isNaN(comm) ? 0 : comm;
            trade.direction = ui.qs('#eDir', b).value;
            save();
            ui.toast('Trade updated');
            rerender();
          }
        }
      ]
    });
  }

  /* ---------- notes ---------- */
  function renderNotes(parent) {
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Trade notes' }),
        ui.el('p', { class: 'card-sub', text: 'Autosaves as you type.' })
      ]),
      ui.el('span', { class: 'badge', id: 'noteState', text: 'Saved' })
    ]));
    var ta = ui.el('textarea', { placeholder: 'What did you see? What would you repeat — or never do again?', style: 'min-height:130px' });
    ta.value = trade.notes || '';
    var timer = null;
    ta.addEventListener('input', function () {
      ui.qs('#noteState').textContent = 'Typing…';
      clearTimeout(timer);
      timer = setTimeout(function () {
        trade.notes = ta.value;
        save();
        ui.qs('#noteState').textContent = 'Saved';
      }, 500);
    });
    card.appendChild(ta);
    parent.appendChild(card);
  }

  /* ---------- screenshots ---------- */
  function renderShots(parent) {
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Trade screenshots' }),
        ui.el('p', { class: 'card-sub', text: 'Up to ' + MAX_SHOTS + ' images. Large files are downscaled before saving to browser storage.' })
      ])
    ]));
    shotGridEl = ui.el('div', { class: 'shot-grid' });
    card.appendChild(shotGridEl);
    parent.appendChild(card);
    drawShots();
  }

  var shotGridEl = null;
  function drawShots() {
    var grid = shotGridEl;
    grid.innerHTML = '';
    var shots = store.getShots(trade.id);
    shots.forEach(function (s) {
      var box = ui.el('div', { class: 'shot' });
      var img = ui.el('img', { src: s.dataUrl, alt: s.name || 'Trade screenshot' });
      box.appendChild(img);
      box.addEventListener('click', function (e) {
        if (e.target.classList.contains('shot-x')) return;
        var big = ui.el('img', { src: s.dataUrl, alt: s.name || 'Trade screenshot', style: 'max-width:100%;border-radius:10px;display:block' });
        ui.modal({ title: s.name || 'Screenshot', wide: true, body: big });
      });
      var x = ui.el('button', { class: 'shot-x', text: '✕', title: 'Remove screenshot' });
      x.addEventListener('click', function () {
        ui.confirm({ title: 'Remove screenshot?', message: 'This image will be deleted from browser storage.', okLabel: 'Remove', danger: true })
          .then(function (ok) {
            if (!ok) return;
            var rest = store.getShots(trade.id).filter(function (z) { return z.id !== s.id; });
            store.saveShots(trade.id, rest);
            drawShots();
          });
      });
      box.appendChild(x);
      grid.appendChild(box);
    });
    if (shots.length < MAX_SHOTS) {
      var add = ui.el('button', { class: 'shot-add', html: '<span style="font-size:20px">＋</span><span>Add screenshot</span>' });
      var input = ui.el('input', { type: 'file', accept: 'image/*', class: 'hidden' });
      add.addEventListener('click', function () { input.click(); });
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
          ui.toast('That image is over 4 MB — please crop or compress it first.', 'err');
          return;
        }
        downscale(file, function (dataUrl) {
          var shots2 = store.getShots(trade.id);
          shots2.push({ id: store.newId('shot'), name: file.name, dataUrl: dataUrl, addedAt: new Date().toISOString() });
          var res = store.saveShots(trade.id, shots2);
          if (res.ok) { ui.toast('Screenshot saved'); drawShots(); }
        });
      });
      add.appendChild(input);
      grid.appendChild(add);
    }
  }

  function downscale(file, cb) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      var scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      cb(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      ui.toast('Could not read that image file.', 'err');
    };
    img.src = url;
  }

  /* ---------- checklist ---------- */
  function renderChecklist(parent) {
    var strategies = store.get('strategies') || [];
    var settings = store.get('settings') || {};
    if (!trade.checklist) {
      trade.checklist = { strategyId: settings.defaultStrategyId || (strategies[0] && strategies[0].id) || null, checked: {} };
    }
    var card = ui.el('div', { class: 'card' });
    var head = ui.el('div', { class: 'card-head' });
    head.appendChild(ui.el('div', {}, [
      ui.el('h2', { class: 'card-title', text: 'Trade checklist' }),
      ui.el('p', { class: 'card-sub', text: 'Definitions come from My Strategy; ticks save on this trade.' })
    ]));
    var sel = ui.el('select', { style: 'width:auto' });
    sel.innerHTML = strategies.map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === trade.checklist.strategyId ? ' selected' : '') + '>' + ui.esc(s.name) + '</option>';
    }).join('');
    sel.addEventListener('change', function () {
      trade.checklist.strategyId = sel.value;
      trade.checklist.checked = {};
      save();
      drawSections();
    });
    head.appendChild(sel);
    card.appendChild(head);
    var zone = ui.el('div', { class: 'stack', id: 'chkZone', style: 'gap:10px' });
    card.appendChild(zone);
    parent.appendChild(card);
    drawSections();

    function drawSections() {
      zone.innerHTML = '';
      var strat = strategies.filter(function (s) { return s.id === trade.checklist.strategyId; })[0];
      if (!strat) {
        zone.appendChild(ui.emptyState({ icon: '☑', title: 'No strategy defined', message: 'Create a strategy with rule sections to unlock the checklist.', action: { href: 'strategy.html', label: 'Open My Strategy' } }));
        return;
      }
      strat.sections.forEach(function (sec) {
        var checkedCount = sec.rules.filter(function (r) { return trade.checklist.checked[r.id]; }).length;
        var met = checkedCount >= sec.requiredCount;
        var box = ui.el('div', { class: 'chk-section' + (met ? ' met' : '') });
        box.appendChild(ui.el('div', { class: 'cs-head' }, [
          ui.el('span', { class: 'cs-name', text: sec.name }),
          ui.el('span', { class: 'badge ' + (met ? 'green' : ''), text: checkedCount + ' of ' + sec.requiredCount + ' required' })
        ]));
        sec.rules.forEach(function (r) {
          var cb = ui.el('input', { type: 'checkbox' });
          cb.checked = !!trade.checklist.checked[r.id];
          cb.addEventListener('change', function () {
            if (cb.checked) trade.checklist.checked[r.id] = true;
            else delete trade.checklist.checked[r.id];
            save();
            drawSections();
          });
          box.appendChild(ui.el('label', { class: 'chk-item' }, [cb, ui.el('span', { text: r.text })]));
        });
        zone.appendChild(box);
      });
    }
  }

  /* ---------- tags ---------- */
  function renderTags(parent) {
    var tags = store.get('tags') || [];
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Trade tags' }),
        ui.el('p', { class: 'card-sub', text: 'Pick the labels that describe this setup — Stats can filter on them.' })
      ]),
      ui.el('a', { class: 'btn small ghost', href: 'strategy.html', text: 'Manage tags' })
    ]));
    var rowEl = ui.el('div', { class: 'row' });
    if (!tags.length) rowEl.appendChild(ui.el('span', { class: 'muted', text: 'No tags defined yet — add some on My Strategy.' }));
    tags.forEach(function (tg) {
      var on = (trade.tagIds || []).indexOf(tg.id) !== -1;
      var chip = ui.el('button', { class: 'chip' + (on ? ' on' : '') }, [
        ui.el('span', { class: 'swatch', style: 'background:' + tg.color }),
        ui.el('span', { text: tg.label })
      ]);
      chip.addEventListener('click', function () {
        trade.tagIds = trade.tagIds || [];
        var i = trade.tagIds.indexOf(tg.id);
        if (i === -1) trade.tagIds.push(tg.id); else trade.tagIds.splice(i, 1);
        save();
        chip.classList.toggle('on');
      });
      rowEl.appendChild(chip);
    });
    card.appendChild(rowEl);
    parent.appendChild(card);
  }

  /* ---------- reuse across same-day accounts ---------- */
  function renderReuse(parent) {
    var all = store.get('trades') || [];
    var siblings = all.filter(function (t) {
      return t.id !== trade.id && t.dateKey === trade.dateKey && t.accountId !== trade.accountId;
    });
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Reuse review details' }),
        ui.el('p', { class: 'card-sub', text: 'Trading the same setup across several prop accounts? Copy this trade’s review onto its same-day siblings — the imported fills stay untouched.' })
      ])
    ]));
    if (!siblings.length) {
      card.appendChild(ui.el('p', { class: 'muted', style: 'font-size:13px;margin:0', text: 'No same-day trades in other accounts were found for this trade.' }));
      parent.appendChild(card);
      return;
    }
    var form = ui.el('div', { class: 'stack', style: 'gap:10px' });
    var optWrap = ui.el('div', { class: 'row' });
    var opts = [
      { key: 'notes', label: 'Notes' },
      { key: 'tags', label: 'Tags' },
      { key: 'checklist', label: 'Checklist' }
    ];
    var optState = { notes: true, tags: true, checklist: true };
    opts.forEach(function (o) {
      var cb = ui.el('input', { type: 'checkbox' });
      cb.checked = true;
      cb.addEventListener('change', function () { optState[o.key] = cb.checked; });
      optWrap.appendChild(ui.el('label', { class: 'chk-item', style: 'padding:4px 8px' }, [cb, ui.el('span', { text: o.label })]));
    });
    form.appendChild(optWrap);

    var picked = {};
    siblings.forEach(function (s) { picked[s.id] = true; });
    var list = ui.el('div', { class: 'stack', style: 'gap:6px' });
    siblings.forEach(function (s) {
      var cb = ui.el('input', { type: 'checkbox' });
      cb.checked = true;
      cb.addEventListener('change', function () { picked[s.id] = cb.checked; });
      list.appendChild(ui.el('label', { class: 'chk-item' }, [
        cb,
        ui.el('span', { html: '<b>' + s.symbol + ' ' + s.direction + '</b> · ' + ui.esc(accountName(s.accountId)) + ' · ' + calc.fmtTime(s.entryTime) + ' · <span class="' + ui.plClass(calc.net(s)) + '">' + ui.fmtMoney(calc.net(s)) + '</span>' })
      ]));
    });
    form.appendChild(list);

    var apply = ui.el('button', { class: 'btn primary', text: 'Apply to selected trades' });
    apply.addEventListener('click', function () {
      var targets = siblings.filter(function (s) { return picked[s.id]; });
      if (!targets.length) { ui.toast('Pick at least one target trade.', 'err'); return; }
      if (!optState.notes && !optState.tags && !optState.checklist) { ui.toast('Pick at least one detail to copy.', 'err'); return; }
      ui.confirm({
        title: 'Copy review details?',
        message: 'This will overwrite the selected review fields on ' + targets.length + ' trade' + (targets.length === 1 ? '' : 's') + ' from the same day.',
        okLabel: 'Copy details'
      }).then(function (ok) {
        if (!ok) return;
        var trades = store.get('trades') || [];
        targets.forEach(function (target) {
          var t = trades.filter(function (x) { return x.id === target.id; })[0];
          if (!t) return;
          if (optState.notes) t.notes = trade.notes;
          if (optState.tags) t.tagIds = (trade.tagIds || []).slice();
          if (optState.checklist && trade.checklist) {
            t.checklist = { strategyId: trade.checklist.strategyId, checked: JSON.parse(JSON.stringify(trade.checklist.checked)) };
          }
        });
        store.save('trades', trades);
        ui.toast('Review details copied to ' + targets.length + ' trade' + (targets.length === 1 ? '' : 's'));
      });
    });
    form.appendChild(ui.el('div', { class: 'row', style: 'justify-content:flex-end' }, [apply]));
    card.appendChild(form);
    parent.appendChild(card);
  }

  /* ---------- danger zone ---------- */
  function renderDanger(parent) {
    var card = ui.el('div', { class: 'card', style: 'border-color:rgba(190,18,60,.25)' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Delete trade' }),
        ui.el('p', { class: 'card-sub', text: 'Removes the trade, its notes, screenshots and checklist. This cannot be undone.' })
      ]),
      ui.el('button', {
        class: 'btn danger', text: 'Delete trade', onclick: function () {
          ui.confirm({
            title: 'Delete this trade?',
            message: 'The trade and its review data will be permanently removed from your journal.',
            okLabel: 'Delete forever', danger: true
          }).then(function (ok) {
            if (!ok) return;
            store.deleteTrade(trade.id);
            ui.toast('Trade deleted');
            setTimeout(function () { location.href = 'trades.html'; }, 350);
          });
        }
      })
    ]));
    parent.appendChild(card);
  }

  function rerender() {
    var root = ui.qs('#pageBody');
    root.innerHTML = '';
    var side = ui.qs('#headSide');
    if (side) side.innerHTML = '';
    build(root);
  }

  function build(root) {
    var net = calc.net(trade);
    ui.headStat(accountName(trade.accountId), 'Account');
    ui.headStat(ui.fmtMoney(net), 'Net P/L', ui.plClass(net));
    ui.headStat(ui.fmtR(calc.rMultiple(trade)), 'R multiple');

    renderKpis(root);
    var cols = ui.el('div', { class: 'grid-2' });
    var left = ui.el('div', { class: 'stack' });
    var right = ui.el('div', { class: 'stack' });
    renderDetails(left);
    renderNotes(left);
    renderShots(left);
    renderChecklist(right);
    renderTags(right);
    renderReuse(right);
    cols.appendChild(left);
    cols.appendChild(right);
    root.appendChild(cols);
    renderDanger(root);
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    var root = ui.qs('#pageBody');
    var id = getParam('id');
    trade = id ? store.getTrade(id) : null;
    if (!trade) {
      // fall back to the most recent trade so the nav link still shows something useful
      var all = (store.get('trades') || []).slice().sort(function (a, b) { return (b.entryTime || '') < (a.entryTime || '') ? -1 : 1; });
      if (id || !all.length) { renderNotFound(root); return; }
      trade = all[0];
    }
    build(root);
  });
})();
