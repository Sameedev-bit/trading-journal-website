/* Prep & Review page — daily/weekly process calendar with entry forms */
(function () {
  'use strict';
  var ui, calc, store;
  var calYear, calMonth;

  var KINDS = {
    premarket: { label: 'Pre-market prep', short: 'Prep' },
    live: { label: 'Live checklist', short: 'Live' },
    recap: { label: 'Day recap', short: 'Recap' },
    weeklyPrep: { label: 'Weekly prep', short: 'Wk prep' },
    weeklyRecap: { label: 'Weekly recap', short: 'Wk recap' }
  };

  var LIVE_CHECKS = [
    ['sized', 'Position size confirmed before first order'],
    ['stopSet', 'Hard stop working in the market'],
    ['newsChecked', 'News window checked'],
    ['levelsMarked', 'Key levels on the chart'],
    ['journalOpen', 'Journal open next to the DOM']
  ];

  function entryFor(dateKey, kind) {
    return (store.get('prep') || []).filter(function (e) { return e.dateKey === dateKey && e.kind === kind; })[0] || null;
  }

  function saveEntry(dateKey, kind, fields) {
    var prep = store.get('prep') || [];
    var existing = prep.filter(function (e) { return e.dateKey === dateKey && e.kind === kind; })[0];
    if (existing) existing.fields = fields;
    else prep.push({ id: store.newId('prep'), dateKey: dateKey, kind: kind, fields: fields, savedAt: calc.todayKey() });
    store.save('prep', prep);
    ui.toast(KINDS[kind].label + ' saved for ' + calc.fmtDateKey(dateKey));
    rerender();
  }

  function deleteEntry(dateKey, kind) {
    var prep = (store.get('prep') || []).filter(function (e) { return !(e.dateKey === dateKey && e.kind === kind); });
    store.save('prep', prep);
    ui.toast('Entry removed');
    rerender();
  }

  /* ---------- forms per kind ---------- */
  function formBody(kind, existing) {
    var f = existing ? existing.fields : {};
    var wrap = ui.el('div', { class: 'stack', style: 'gap:12px' });
    function field(label, inner) {
      var l = ui.el('label', { class: 'field' });
      l.appendChild(ui.el('span', { text: label }));
      l.appendChild(inner);
      return l;
    }
    if (kind === 'premarket') {
      var bias = ui.el('select', { id: 'pBias', html: '<option value="long">Long bias</option><option value="short">Short bias</option><option value="chop">Chop / two-way</option>' });
      bias.value = f.bias || 'long';
      wrap.appendChild(field('Session bias', bias));
      wrap.appendChild(field('Key levels', ui.el('input', { type: 'text', id: 'pLevels', value: f.keyLevels || '', placeholder: 'e.g. ONH 6491 / ONL 6462 / VWAP' })));
      wrap.appendChild(field('Plan for the open', ui.el('textarea', { id: 'pPlan', text: f.plan || '', placeholder: 'What has to happen before you take a trade?' })));
      wrap.appendChild(field('One focus for today', ui.el('input', { type: 'text', id: 'pFocus', value: f.focus || '', placeholder: 'e.g. no trades in the first 5 minutes' })));
    } else if (kind === 'live') {
      var checks = f.checks || {};
      LIVE_CHECKS.forEach(function (c) {
        var cb = ui.el('input', { type: 'checkbox', id: 'lc-' + c[0] });
        cb.checked = !!checks[c[0]];
        wrap.appendChild(ui.el('label', { class: 'chk-item' }, [cb, ui.el('span', { text: c[1] })]));
      });
      wrap.appendChild(field('Session notes', ui.el('textarea', { id: 'lNotes', text: f.notes || '', placeholder: 'Anything worth remembering mid-session…' })));
    } else if (kind === 'recap') {
      var bc = ui.el('select', { id: 'rBias', html: '<option value="">Not scored</option><option value="yes">Yes — bias played out</option><option value="no">No — bias was wrong</option>' });
      bc.value = f.biasCorrect === true ? 'yes' : f.biasCorrect === false ? 'no' : '';
      wrap.appendChild(field('Was your pre-market bias correct?', bc));
      var fp = ui.el('select', { id: 'rPlan', html: '<option value="">Not scored</option><option value="yes">Yes — followed the plan</option><option value="no">No — broke the plan</option>' });
      fp.value = f.followedPlan === true ? 'yes' : f.followedPlan === false ? 'no' : '';
      wrap.appendChild(field('Did you follow your plan?', fp));
      var gr = ui.el('select', { id: 'rGrade', html: '<option>A</option><option>B</option><option>C</option><option>D</option>' });
      gr.value = f.grade || 'B';
      wrap.appendChild(field('Execution grade (process, not P/L)', gr));
      wrap.appendChild(field('Lessons', ui.el('textarea', { id: 'rLessons', text: f.lessons || '', placeholder: 'What did today teach you?' })));
    } else if (kind === 'weeklyPrep') {
      wrap.appendChild(field('Theme for the week', ui.el('input', { type: 'text', id: 'wTheme', value: f.theme || '', placeholder: 'e.g. patience through the open' })));
      wrap.appendChild(field('Goals', ui.el('textarea', { id: 'wGoals', text: f.goals || '', placeholder: 'Process goals, not P/L goals.' })));
      wrap.appendChild(field('Watchlist / calendar', ui.el('textarea', { id: 'wWatch', text: f.watchlist || '', placeholder: 'Key events and levels for the week ahead.' })));
    } else if (kind === 'weeklyRecap') {
      wrap.appendChild(field('What went well', ui.el('textarea', { id: 'wWell', text: f.wentWell || '' })));
      wrap.appendChild(field('What needs work', ui.el('textarea', { id: 'wWork', text: f.needsWork || '' })));
      wrap.appendChild(field('Adherence notes', ui.el('textarea', { id: 'wAdh', text: f.adherenceNote || '', placeholder: 'How closely did the week follow the plan?' })));
    }
    return wrap;
  }

  function readForm(kind, body) {
    var g = function (id) { return ui.qs('#' + id, body); };
    if (kind === 'premarket') return { bias: g('pBias').value, keyLevels: g('pLevels').value.trim(), plan: g('pPlan').value.trim(), focus: g('pFocus').value.trim() };
    if (kind === 'live') {
      var checks = {};
      LIVE_CHECKS.forEach(function (c) { checks[c[0]] = g('lc-' + c[0]).checked; });
      return { checks: checks, notes: g('lNotes').value.trim() };
    }
    if (kind === 'recap') {
      var bc = g('rBias').value, fp = g('rPlan').value;
      return {
        biasCorrect: bc === '' ? null : bc === 'yes',
        followedPlan: fp === '' ? null : fp === 'yes',
        grade: g('rGrade').value,
        lessons: g('rLessons').value.trim()
      };
    }
    if (kind === 'weeklyPrep') return { theme: g('wTheme').value.trim(), goals: g('wGoals').value.trim(), watchlist: g('wWatch').value.trim() };
    return { wentWell: g('wWell').value.trim(), needsWork: g('wWork').value.trim(), adherenceNote: g('wAdh').value.trim() };
  }

  function openForm(dateKey, kind) {
    var existing = entryFor(dateKey, kind);
    var actions = [{ label: 'Cancel', kind: 'ghost' }];
    if (existing) {
      actions.push({
        label: 'Delete entry', kind: 'danger',
        onClick: function () {
          ui.confirm({ title: 'Delete entry?', message: 'Remove this ' + KINDS[kind].label.toLowerCase() + ' from ' + calc.fmtDateKey(dateKey) + '?', okLabel: 'Delete', danger: true })
            .then(function (ok) { if (ok) deleteEntry(dateKey, kind); });
        }
      });
    }
    actions.push({
      label: existing ? 'Save changes' : 'Save entry', kind: 'primary',
      onClick: function (body) { saveEntry(dateKey, kind, readForm(kind, body)); }
    });
    ui.modal({
      title: KINDS[kind].label + ' — ' + calc.fmtDateKey(dateKey),
      body: formBody(kind, existing),
      actions: actions
    });
  }

  /* ---------- calendar ---------- */
  function drawCalendar(zone) {
    zone.innerHTML = '';
    var today = calc.todayKey();

    var head = ui.el('div', { class: 'cal-head' });
    var nav = ui.el('div', { class: 'cal-nav' });
    var prev = ui.el('button', { text: '‹', 'aria-label': 'Previous month' });
    var next = ui.el('button', { text: '›', 'aria-label': 'Next month' });
    nav.appendChild(prev);
    nav.appendChild(ui.el('span', { class: 'cal-month', text: calc.monthLabel(calYear, calMonth) }));
    nav.appendChild(next);
    head.appendChild(nav);
    head.appendChild(ui.el('span', { class: 'muted', style: 'font-size:12px', text: 'Weekdays: prep · live · recap — Sundays plan the week, Saturdays close it.' }));
    zone.appendChild(head);
    prev.addEventListener('click', function () { shift(-1); });
    next.addEventListener('click', function () { shift(1); });
    function shift(d) {
      calMonth += d;
      if (calMonth < 0) { calMonth = 11; calYear--; }
      if (calMonth > 11) { calMonth = 0; calYear++; }
      drawCalendar(zone);
    }

    var grid = ui.el('div', { class: 'cal-grid no-week' });
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (d) {
      grid.appendChild(ui.el('div', { class: 'cal-dow', text: d }));
    });
    calc.monthMatrix(calYear, calMonth).forEach(function (week) {
      week.forEach(function (cell) {
        var box = ui.el('div', { class: 'cal-cell' + (cell.inMonth ? '' : ' out') + (cell.dateKey === today ? ' today' : '') });
        box.appendChild(ui.el('div', { class: 'c-day', text: String(cell.day) }));
        if (cell.inMonth) {
          var pills = ui.el('div', { class: 'prep-pills' });
          if (cell.dow === 0) pills.appendChild(pill(cell.dateKey, 'weeklyPrep', true));
          else if (cell.dow === 6) pills.appendChild(pill(cell.dateKey, 'weeklyRecap', true));
          else {
            pills.appendChild(pill(cell.dateKey, 'premarket'));
            pills.appendChild(pill(cell.dateKey, 'live'));
            pills.appendChild(pill(cell.dateKey, 'recap'));
          }
          box.appendChild(pills);
        }
        grid.appendChild(box);
      });
    });
    zone.appendChild(grid);
  }

  function pill(dateKey, kind, weekly) {
    var done = !!entryFor(dateKey, kind);
    var b = ui.el('button', {
      class: 'prep-pill' + (weekly ? ' wk' : '') + (done ? ' done' : ''),
      text: KINDS[kind].short,
      title: KINDS[kind].label + (done ? ' — saved' : ' — empty')
    });
    b.addEventListener('click', function () { openForm(dateKey, kind); });
    return b;
  }

  /* ---------- KPIs ---------- */
  function monthRange() {
    var from = calYear + '-' + (calMonth + 1 < 10 ? '0' : '') + (calMonth + 1) + '-01';
    var lastDay = new Date(calYear, calMonth + 1, 0).getDate();
    var to = from.slice(0, 8) + (lastDay < 10 ? '0' : '') + lastDay;
    return { from: from, to: to };
  }

  function fillKpis() {
    var r = monthRange();
    var s = calc.prepStats(store.get('prep'), r.from, r.to);
    ui.qs('#prepKpis').innerHTML =
      '<div class="kpi"><div class="k-label">Bias accuracy</div><div class="k-value">' + ui.fmtPct(s.biasAccuracy) + '</div><div class="k-sub">' + (s.biasKnownCount ? 'From ' + s.biasKnownCount + ' scored recap' + (s.biasKnownCount === 1 ? '' : 's') + ' this month.' : 'Score your bias in day recaps to track this.') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Plan adherence</div><div class="k-value">' + ui.fmtPct(s.planAdherence) + '</div><div class="k-sub">' + (s.planKnownCount ? s.planKnownCount + ' recap' + (s.planKnownCount === 1 ? '' : 's') + ' scored for plan-following.' : 'Score plan-following in day recaps.') + '</div></div>' +
      '<div class="kpi"><div class="k-label">Weekly preps</div><div class="k-value">' + s.weeklyPreps + '</div><div class="k-sub">' + s.weeklyRecaps + ' weekly recap' + (s.weeklyRecaps === 1 ? '' : 's') + ' logged too.</div></div>' +
      '<div class="kpi"><div class="k-label">Day recaps</div><div class="k-value">' + s.recaps + '</div><div class="k-sub">' + s.premarkets + ' pre-market prep' + (s.premarkets === 1 ? '' : 's') + ' this month.</div></div>';
  }

  function rerender() {
    fillKpis();
    drawCalendar(ui.qs('#prepCal'));
  }

  function build(root) {
    root.appendChild(ui.el('div', { class: 'kpis', id: 'prepKpis' }));

    var quick = ui.el('div', { class: 'card' });
    quick.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Start with the plan. Finish with the truth.' }),
        ui.el('p', { class: 'card-sub', text: 'Jump straight into today’s entries, or click any pill on the calendar below.' })
      ])
    ]));
    var row = ui.el('div', { class: 'row' });
    var today = calc.todayKey();
    var dow = new Date().getDay();
    var todayKinds = dow === 0 ? ['weeklyPrep'] : dow === 6 ? ['weeklyRecap'] : ['premarket', 'live', 'recap'];
    todayKinds.forEach(function (k) {
      var done = !!entryFor(today, k);
      var b = ui.el('button', { class: 'btn' + (done ? '' : ' primary'), text: (done ? '✓ ' : '') + KINDS[k].label });
      b.addEventListener('click', function () { openForm(today, k); });
      row.appendChild(b);
    });
    quick.appendChild(row);
    root.appendChild(quick);

    var calCard = ui.el('div', { class: 'card' });
    calCard.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Prep calendar' }),
        ui.el('p', { class: 'card-sub', text: 'Filled pills are saved entries. Empty pills are gaps in your process.' })
      ])
    ]));
    calCard.appendChild(ui.el('div', { id: 'prepCal' }));
    root.appendChild(calCard);

    rerender();
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    var s = calc.prepStats(store.get('prep'), null, null);
    ui.headStat(String(s.recaps), 'Recaps all-time');
    ui.headStat(ui.fmtPct(s.planAdherence), 'Plan adherence');
    build(ui.qs('#pageBody'));
  });
})();
