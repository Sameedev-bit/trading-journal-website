/* My Strategy page — playbook library, rule sections, tag management */
(function () {
  'use strict';
  var ui, calc, store;
  var viewingId = null;

  function strategies() { return store.get('strategies') || []; }
  function viewing() {
    return strategies().filter(function (s) { return s.id === viewingId; })[0] || strategies()[0] || null;
  }

  function completeness(s) {
    if (!s) return 0;
    var score = 0;
    if (s.description && s.description.trim()) score += 25;
    if (s.sections.length) score += 25;
    if (s.sections.length && s.sections.every(function (sec) { return sec.rules.length > 0; })) score += 25;
    if ((store.get('tags') || []).length) score += 25;
    return score;
  }

  /* ---------- strategy CRUD ---------- */
  function saveStrategies(list) { store.save('strategies', list); }

  function newStrategy() {
    var list = strategies();
    var s = {
      id: store.newId('strat'), name: 'New strategy', isDefault: list.length === 0,
      description: '',
      sections: [{ id: store.newId('sec'), name: 'Entry criteria', requiredCount: 1, rules: [] }]
    };
    list.push(s);
    saveStrategies(list);
    viewingId = s.id;
    rerender();
    ui.toast('Strategy created — define its rules below');
  }

  function setDefault(id) {
    var list = strategies();
    list.forEach(function (s) { s.isDefault = s.id === id; });
    saveStrategies(list);
    var settings = store.get('settings') || {};
    settings.defaultStrategyId = id;
    store.save('settings', settings);
    rerender();
    ui.toast('Default strategy updated');
  }

  function deleteStrategy(s) {
    var refs = (store.get('trades') || []).filter(function (t) { return t.checklist && t.checklist.strategyId === s.id; }).length;
    ui.confirm({
      title: 'Delete “' + s.name + '”?',
      message: refs
        ? refs + ' trade review' + (refs === 1 ? '' : 's') + ' reference this strategy — their checklists will be cleared. This cannot be undone.'
        : 'This strategy will be permanently removed.',
      okLabel: 'Delete strategy', danger: true
    }).then(function (ok) {
      if (!ok) return;
      var list = strategies().filter(function (x) { return x.id !== s.id; });
      if (s.isDefault && list.length) list[0].isDefault = true;
      saveStrategies(list);
      var trades = store.get('trades') || [];
      trades.forEach(function (t) { if (t.checklist && t.checklist.strategyId === s.id) t.checklist = null; });
      store.save('trades', trades);
      viewingId = list.length ? list[0].id : null;
      rerender();
      ui.toast('Strategy deleted');
    });
  }

  /* ---------- editor ---------- */
  function renderEditor(parent) {
    var s = viewing();
    var card = ui.el('div', { class: 'card' });
    if (!s) {
      card.appendChild(ui.emptyState({
        icon: '⛭', title: 'No strategies yet',
        message: 'A strategy is a named playbook: rule sections, required counts, and the tags you review trades with.'
      }));
      var btn = ui.el('button', { class: 'btn primary', text: '+ New strategy', onclick: newStrategy });
      card.appendChild(ui.el('div', { class: 'row', style: 'justify-content:center;margin-top:10px' }, [btn]));
      parent.appendChild(card);
      return;
    }

    var head = ui.el('div', { class: 'card-head' });
    head.appendChild(ui.el('div', {}, [
      ui.el('h2', { class: 'card-title', text: 'Strategy rules' }),
      ui.el('p', { class: 'card-sub', text: 'Rules appear as the checklist on every trade review that uses this strategy.' })
    ]));
    head.appendChild(ui.el('span', { class: 'badge teal', text: 'Editing: ' + s.name }));
    card.appendChild(head);

    var nameIn = ui.el('input', { type: 'text', value: s.name, maxlength: '48' });
    nameIn.addEventListener('change', function () {
      if (!nameIn.value.trim()) { nameIn.value = s.name; return; }
      s.name = nameIn.value.trim();
      saveStrategies(strategies());
      rerender();
    });
    var descIn = ui.el('textarea', { text: s.description || '', placeholder: 'One paragraph: when does this setup exist, and when do you leave it alone?' });
    descIn.addEventListener('change', function () {
      s.description = descIn.value.trim();
      saveStrategies(strategies());
      fillSnapshot();
    });
    var meta = ui.el('div', { class: 'form-grid', style: 'margin-bottom:14px' });
    var f1 = ui.el('label', { class: 'field' }); f1.appendChild(ui.el('span', { text: 'Strategy name' })); f1.appendChild(nameIn);
    var f2 = ui.el('label', { class: 'field full' }); f2.appendChild(ui.el('span', { text: 'Description' })); f2.appendChild(descIn);
    meta.appendChild(f1);
    meta.appendChild(f2);
    card.appendChild(meta);

    var zone = ui.el('div', { class: 'stack', style: 'gap:10px' });
    s.sections.forEach(function (sec) { zone.appendChild(sectionEditor(s, sec)); });
    card.appendChild(zone);

    var addSec = ui.el('button', {
      class: 'btn small', text: '+ Add section', style: 'margin-top:12px',
      onclick: function () {
        s.sections.push({ id: store.newId('sec'), name: 'New section', requiredCount: 1, rules: [] });
        saveStrategies(strategies());
        rerender();
      }
    });
    card.appendChild(addSec);
    parent.appendChild(card);
  }

  function sectionEditor(s, sec) {
    var box = ui.el('div', { class: 'chk-section' });
    var head = ui.el('div', { class: 'cs-head' });
    var nameIn = ui.el('input', { type: 'text', value: sec.name, maxlength: '36', style: 'width:200px;padding:6px 9px;font-weight:700' });
    nameIn.addEventListener('change', function () {
      sec.name = nameIn.value.trim() || sec.name;
      nameIn.value = sec.name;
      saveStrategies(strategies());
    });
    head.appendChild(nameIn);

    var right = ui.el('div', { class: 'row', style: 'gap:6px' });
    var reqWrap = ui.el('span', { class: 'muted', style: 'font-size:12px' });
    function reqLabel() { return 'require ' + sec.requiredCount + ' of ' + sec.rules.length; }
    var minus = ui.el('button', { class: 'btn small ghost', text: '−', title: 'Require one fewer' });
    var plus = ui.el('button', { class: 'btn small ghost', text: '+', title: 'Require one more' });
    reqWrap.textContent = reqLabel();
    minus.addEventListener('click', function () {
      sec.requiredCount = Math.max(0, sec.requiredCount - 1);
      saveStrategies(strategies());
      reqWrap.textContent = reqLabel();
    });
    plus.addEventListener('click', function () {
      sec.requiredCount = Math.min(sec.rules.length || 1, sec.requiredCount + 1);
      saveStrategies(strategies());
      reqWrap.textContent = reqLabel();
    });
    var delSec = ui.el('button', {
      class: 'btn small danger', text: 'Remove',
      onclick: function () {
        ui.confirm({ title: 'Remove section?', message: '“' + sec.name + '” and its ' + sec.rules.length + ' rule' + (sec.rules.length === 1 ? '' : 's') + ' will be removed from this strategy.', okLabel: 'Remove', danger: true })
          .then(function (ok) {
            if (!ok) return;
            s.sections = s.sections.filter(function (x) { return x.id !== sec.id; });
            saveStrategies(strategies());
            rerender();
          });
      }
    });
    right.appendChild(minus); right.appendChild(reqWrap); right.appendChild(plus); right.appendChild(delSec);
    head.appendChild(right);
    box.appendChild(head);

    var list = ui.el('div', { class: 'stack', style: 'gap:6px' });
    sec.rules.forEach(function (r) {
      var item = ui.el('div', { class: 'rule-item' });
      var txt = ui.el('input', { type: 'text', value: r.text, class: 'ri-txt', style: 'border:0;background:transparent;padding:2px 0' });
      txt.addEventListener('change', function () {
        r.text = txt.value.trim() || r.text;
        txt.value = r.text;
        saveStrategies(strategies());
      });
      var x = ui.el('button', {
        class: 'btn small ghost', text: '✕', title: 'Delete rule',
        onclick: function () {
          sec.rules = sec.rules.filter(function (z) { return z.id !== r.id; });
          if (sec.requiredCount > sec.rules.length) sec.requiredCount = sec.rules.length;
          saveStrategies(strategies());
          rerender();
        }
      });
      item.appendChild(txt);
      item.appendChild(x);
      list.appendChild(item);
    });
    box.appendChild(list);

    var addRow = ui.el('div', { class: 'row', style: 'margin-top:8px' });
    var newRule = ui.el('input', { type: 'text', placeholder: 'New rule — press Enter to add', style: 'flex:1' });
    function addRule() {
      var v = newRule.value.trim();
      if (!v) return;
      sec.rules.push({ id: store.newId('r'), text: v });
      if (sec.requiredCount === 0) sec.requiredCount = 1;
      newRule.value = '';
      saveStrategies(strategies());
      rerender();
    }
    newRule.addEventListener('keydown', function (e) { if (e.key === 'Enter') addRule(); });
    addRow.appendChild(newRule);
    addRow.appendChild(ui.el('button', { class: 'btn small', text: 'Add', onclick: addRule }));
    box.appendChild(addRow);
    return box;
  }

  /* ---------- library + snapshot ---------- */
  function renderLibrary(parent) {
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Strategy library' }),
        ui.el('p', { class: 'card-sub', text: 'The default strategy pre-fills new trade reviews.' })
      ]),
      ui.el('button', { class: 'btn primary small', text: '+ New', onclick: newStrategy })
    ]));
    var list = ui.el('div', { class: 'stack', style: 'gap:8px' });
    strategies().forEach(function (s) {
      var row = ui.el('div', { class: 'strat-card' + (viewing() && viewing().id === s.id ? ' sel' : '') });
      var left = ui.el('div', {}, [
        ui.el('div', { style: 'font-weight:700', text: s.name }),
        ui.el('div', { class: 'muted', style: 'font-size:11px', text: s.sections.length + ' sections · ' + s.sections.reduce(function (n, x) { return n + x.rules.length; }, 0) + ' rules' })
      ]);
      row.appendChild(left);
      var right = ui.el('div', { class: 'row', style: 'gap:6px' });
      if (s.isDefault) right.appendChild(ui.el('span', { class: 'badge teal', text: 'Default' }));
      else right.appendChild(ui.el('button', { class: 'btn small ghost', text: 'Make default', onclick: function () { setDefault(s.id); } }));
      right.appendChild(ui.el('button', {
        class: 'btn small', text: viewing() && viewing().id === s.id ? 'Viewing' : 'View',
        onclick: function () { viewingId = s.id; rerender(); }
      }));
      right.appendChild(ui.el('button', { class: 'btn small danger', text: '✕', title: 'Delete strategy', onclick: function () { deleteStrategy(s); } }));
      row.appendChild(right);
      list.appendChild(row);
    });
    if (!strategies().length) list.appendChild(ui.el('p', { class: 'muted', text: 'No strategies saved yet.' }));
    card.appendChild(list);
    parent.appendChild(card);
  }

  var snapCardEl = null;
  function renderSnapshot(parent) {
    snapCardEl = ui.el('div', { class: 'card' });
    parent.appendChild(snapCardEl);
    fillSnapshot();
  }
  function fillSnapshot() {
    var card = snapCardEl;
    if (!card) return;
    var s = viewing();
    var pct = completeness(s);
    card.innerHTML =
      '<div class="card-head"><div><h2 class="card-title">Completion snapshot</h2>' +
      '<p class="card-sub">Description, sections, rule items and tags all in place = ready to review against.</p></div>' +
      '<span class="badge ' + (pct === 100 ? 'green' : 'amber') + '">' + (pct === 100 ? 'Ready' : 'In progress') + '</span></div>' +
      '<div class="k-value" style="font-size:28px;font-weight:800">' + pct + '<span class="muted" style="font-size:15px">%</span></div>' +
      '<div class="prog" style="margin-top:8px"><i style="width:' + pct + '%"></i></div>';
  }

  /* ---------- tags ---------- */
  function renderTags(parent) {
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Trade tags' }),
        ui.el('p', { class: 'card-sub', text: 'Defined here, selected on trade reviews, and used by Stats filters downstream.' })
      ])
    ]));
    var list = ui.el('div', { class: 'row', id: 'tagList' });
    card.appendChild(list);

    var addRow = ui.el('div', { class: 'row', style: 'margin-top:12px' });
    var labelIn = ui.el('input', { type: 'text', placeholder: 'New tag label', maxlength: '24', style: 'width:180px' });
    var colorIn = ui.el('input', { type: 'color', value: '#a16207' });
    function addTag() {
      var v = labelIn.value.trim();
      if (!v) return;
      var tags = store.get('tags') || [];
      if (tags.some(function (t) { return t.label.toLowerCase() === v.toLowerCase(); })) {
        ui.toast('A tag with that label already exists.', 'err');
        return;
      }
      tags.push({ id: store.newId('tag'), label: v, color: colorIn.value });
      store.save('tags', tags);
      labelIn.value = '';
      drawTags();
      fillSnapshot();
      ui.toast('Tag added');
    }
    labelIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') addTag(); });
    addRow.appendChild(labelIn);
    addRow.appendChild(colorIn);
    addRow.appendChild(ui.el('button', { class: 'btn small', text: 'Add tag', onclick: addTag }));
    card.appendChild(addRow);
    parent.appendChild(card);
    drawTags();

    function drawTags() {
      var tags = store.get('tags') || [];
      list.innerHTML = '';
      if (!tags.length) list.appendChild(ui.el('span', { class: 'muted', text: 'No tags yet — add your first one below.' }));
      tags.forEach(function (tg) {
        var used = (store.get('trades') || []).filter(function (t) { return (t.tagIds || []).indexOf(tg.id) !== -1; }).length;
        var chip = ui.el('button', { class: 'chip', title: used + ' trade' + (used === 1 ? '' : 's') + ' use this tag — click to edit' }, [
          ui.el('span', { class: 'swatch', style: 'background:' + tg.color }),
          ui.el('span', { text: tg.label }),
          ui.el('span', { class: 'faint', text: String(used) })
        ]);
        chip.addEventListener('click', function () { editTag(tg, used); });
        list.appendChild(chip);
      });
    }

    function editTag(tg, used) {
      var body = ui.el('div', { class: 'form-grid' });
      body.innerHTML =
        '<label class="field"><span>Label</span><input type="text" id="tgLabel" maxlength="24" value="' + ui.esc(tg.label) + '"></label>' +
        '<label class="field"><span>Color</span><input type="color" id="tgColor" value="' + tg.color + '"></label>';
      ui.modal({
        title: 'Edit tag',
        body: body,
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          {
            label: 'Delete tag', kind: 'danger',
            onClick: function () {
              ui.confirm({
                title: 'Delete “' + tg.label + '”?',
                message: used ? 'It will be removed from ' + used + ' trade' + (used === 1 ? '' : 's') + '.' : 'This tag is unused.',
                okLabel: 'Delete', danger: true
              }).then(function (ok) {
                if (!ok) return;
                store.save('tags', (store.get('tags') || []).filter(function (x) { return x.id !== tg.id; }));
                var trades = store.get('trades') || [];
                trades.forEach(function (t) { t.tagIds = (t.tagIds || []).filter(function (id) { return id !== tg.id; }); });
                store.save('trades', trades);
                drawTags();
                ui.toast('Tag deleted');
              });
            }
          },
          {
            label: 'Save', kind: 'primary',
            onClick: function (b) {
              var v = ui.qs('#tgLabel', b).value.trim();
              if (!v) { ui.toast('Label cannot be empty.', 'err'); return false; }
              var tags = store.get('tags') || [];
              var target = tags.filter(function (x) { return x.id === tg.id; })[0];
              target.label = v;
              target.color = ui.qs('#tgColor', b).value;
              store.save('tags', tags);
              drawTags();
              ui.toast('Tag updated');
            }
          }
        ]
      });
    }
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
    var list = strategies();
    var totalSections = list.reduce(function (n, s) { return n + s.sections.length; }, 0);
    var totalRules = list.reduce(function (n, s) { return n + s.sections.reduce(function (m, x) { return m + x.rules.length; }, 0); }, 0);
    var tags = store.get('tags') || [];

    ui.headStat(String(list.length), 'Strategies');
    ui.headStat(String(totalRules), 'Rule items');

    var kpis = ui.el('div', { class: 'kpis' });
    kpis.innerHTML =
      '<div class="kpi"><div class="k-label">Saved strategies</div><div class="k-value">' + list.length + '</div><div class="k-sub">Playbooks in this workspace.</div></div>' +
      '<div class="kpi"><div class="k-label">Sections</div><div class="k-value">' + totalSections + '</div><div class="k-sub">Across all strategies.</div></div>' +
      '<div class="kpi"><div class="k-label">Rule items</div><div class="k-value">' + totalRules + '</div><div class="k-sub">Checklist lines available in review.</div></div>' +
      '<div class="kpi"><div class="k-label">Trade tags</div><div class="k-value">' + tags.length + '</div><div class="k-sub">Shared across every strategy.</div></div>';
    root.appendChild(kpis);

    var cols = ui.el('div', { class: 'grid-2' });
    var left = ui.el('div', { class: 'stack' });
    var right = ui.el('div', { class: 'stack' });
    renderEditor(left);
    renderLibrary(right);
    renderSnapshot(right);
    renderTags(right);
    cols.appendChild(left);
    cols.appendChild(right);
    root.appendChild(cols);
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store;
    var def = strategies().filter(function (s) { return s.isDefault; })[0];
    viewingId = def ? def.id : (strategies()[0] ? strategies()[0].id : null);
    build(ui.qs('#pageBody'));
  });
})();
