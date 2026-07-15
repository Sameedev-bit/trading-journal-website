/* TradeHarbor shared UI — app shell, modal, toast, formatters */
window.TH = window.TH || {};
TH.ui = (function () {
  'use strict';

  /* ---------- tiny DOM helpers ---------- */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- formatters ---------- */
  function fmtMoney(n, opts) {
    opts = opts || {};
    if (n === null || n === undefined || isNaN(n)) return '—';
    var sign = n > 0 ? (opts.plus === false ? '' : '+') : n < 0 ? '−' : '';
    var abs = Math.abs(n);
    var str = abs.toLocaleString('en-US', { minimumFractionDigits: opts.dec !== undefined ? opts.dec : 2, maximumFractionDigits: opts.dec !== undefined ? opts.dec : 2 });
    return sign + '$' + str;
  }
  function plClass(n) { return n > 0.005 ? 'pl-pos' : n < -0.005 ? 'pl-neg' : 'pl-flat'; }
  function fmtR(r) {
    if (r === null || r === undefined || isNaN(r)) return '—';
    return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(2) + 'R';
  }
  function fmtPct(x, dec) {
    if (x === null || x === undefined || isNaN(x)) return '—';
    return (x * 100).toFixed(dec === undefined ? 0 : dec) + '%';
  }
  function fmtPF(pf) {
    if (pf === null || pf === undefined) return '—';
    if (pf === Infinity) return '∞';
    return pf.toFixed(2);
  }
  function relDate(dateKey) {
    var diff = TH.calc.daysBetween(TH.calc.todayKey(), dateKey);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    if (diff > 1) return 'in ' + diff + ' days';
    return Math.abs(diff) + ' days ago';
  }
  function relTime(iso) {
    if (!iso) return '—';
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var h = Math.round(mins / 60);
    if (h < 24) return h + ' hr ago';
    return Math.round(h / 24) + ' d ago';
  }

  /* ---------- toast ---------- */
  var toastWrap = null;
  function toast(msg, kind) {
    if (!toastWrap) {
      toastWrap = el('div', { class: 'toast-wrap' });
      document.body.appendChild(toastWrap);
    }
    var t = el('div', { class: 'toast ' + (kind || 'ok'), text: msg });
    toastWrap.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 3400);
    setTimeout(function () { t.remove(); }, 3750);
  }

  /* ---------- modal ---------- */
  var openModals = [];
  function modal(opts) {
    var overlay = el('div', { class: 'modal-overlay' });
    var box = el('div', { class: 'modal' + (opts.wide ? ' wide' : '') });
    var head = el('div', { class: 'modal-head' }, [
      el('h3', { text: opts.title || '' }),
      el('button', { class: 'modal-x', 'aria-label': 'Close', text: '✕', onclick: close })
    ]);
    var body = el('div', { class: 'modal-body' });
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    box.appendChild(head);
    box.appendChild(body);
    if (opts.actions && opts.actions.length) {
      var foot = el('div', { class: 'modal-foot' });
      opts.actions.forEach(function (a) {
        foot.appendChild(el('button', {
          class: 'btn ' + (a.kind || ''),
          text: a.label,
          onclick: function () {
            var keep = a.onClick ? a.onClick(body, close) : undefined;
            if (keep !== false && !a.keepOpen) close();
          }
        }));
      });
      box.appendChild(foot);
    }
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay && opts.dismissable !== false) close(); });
    document.body.appendChild(overlay);
    openModals.push(close);
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      overlay.remove();
      var i = openModals.indexOf(close);
      if (i !== -1) openModals.splice(i, 1);
      if (opts.onClose) opts.onClose();
    }
    return { close: close, body: body, box: box };
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && openModals.length) openModals[openModals.length - 1]();
  });

  function confirmBox(opts) {
    if (typeof opts === 'string') opts = { message: opts };
    return new Promise(function (resolve) {
      modal({
        title: opts.title || 'Are you sure?',
        body: '<p style="margin:0;color:var(--text-soft)">' + esc(opts.message || '') + '</p>',
        onClose: function () { resolve(false); },
        actions: [
          { label: opts.cancelLabel || 'Cancel', kind: 'ghost' },
          {
            label: opts.okLabel || 'Confirm', kind: opts.danger ? 'danger' : 'primary',
            onClick: function () { resolve(true); }
          }
        ]
      });
    });
  }

  /* ---------- multiselect dropdown ---------- */
  /* items: [{value,label,group?}] — onChange(selectedValues[]) */
  function multiSelect(opts) {
    var selected = (opts.selected || []).slice();
    var dd = el('details', { class: 'dd' });
    var sum = el('summary');
    var menu = el('div', { class: 'dd-menu' });
    dd.appendChild(sum);
    dd.appendChild(menu);
    // open right-aligned when the menu would spill past the viewport edge
    dd.addEventListener('toggle', function () {
      if (!dd.open) return;
      menu.classList.remove('dd-right');
      var r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth - 12) menu.classList.add('dd-right');
    });

    function labelText() {
      if (!selected.length || selected.length === opts.items.length) return opts.allLabel || 'All';
      if (selected.length === 1) {
        var only = opts.items.filter(function (i) { return i.value === selected[0]; })[0];
        return only ? only.label : '1 selected';
      }
      return selected.length + ' selected';
    }
    function render() {
      sum.textContent = (opts.label ? opts.label + ': ' : '') + labelText();
      menu.innerHTML = '';
      var lastGroup = null;
      opts.items.forEach(function (item) {
        if (item.group && item.group !== lastGroup) {
          lastGroup = item.group;
          menu.appendChild(el('div', { class: 'dd-group', text: item.group }));
        }
        var cb = el('input', { type: 'checkbox' });
        cb.checked = selected.indexOf(item.value) !== -1;
        var rowEl = el('label', { class: 'dd-item' }, [cb, el('span', { text: item.label })]);
        cb.addEventListener('change', function () {
          var i = selected.indexOf(item.value);
          if (cb.checked && i === -1) selected.push(item.value);
          if (!cb.checked && i !== -1) selected.splice(i, 1);
          sum.textContent = (opts.label ? opts.label + ': ' : '') + labelText();
          opts.onChange(selected.slice());
        });
        menu.appendChild(rowEl);
      });
      var actions = el('div', { class: 'dd-actions' }, [
        el('button', {
          class: 'btn small ghost', text: 'All', onclick: function () {
            selected = opts.items.map(function (i) { return i.value; });
            render(); opts.onChange(selected.slice());
          }
        }),
        el('button', {
          class: 'btn small ghost', text: 'None', onclick: function () {
            selected = [];
            render(); opts.onChange(selected.slice());
          }
        })
      ]);
      menu.appendChild(actions);
    }
    render();
    dd.getSelected = function () { return selected.slice(); };
    dd.setSelected = function (vals) { selected = (vals || []).slice(); render(); };
    return dd;
  }
  // close any open dropdown when clicking elsewhere
  document.addEventListener('click', function (e) {
    qsa('details.dd[open]').forEach(function (dd) {
      if (!dd.contains(e.target)) dd.removeAttribute('open');
    });
  });

  /* ---------- app shell ---------- */
  var NAV = [
    { group: 'Overview' },
    { id: 'stats', label: 'Stats', hint: 'KPIs', href: 'stats.html' },
    { id: 'insights', label: 'Insights', hint: 'Edge', href: 'insights.html', isNew: true },
    { id: 'trades', label: 'Trades', hint: 'List', href: 'trades.html' },
    { group: 'Journal' },
    { id: 'prep-review', label: 'Prep & Review', hint: 'Daily', href: 'prep-review.html' },
    { id: 'strategy', label: 'My Strategy', hint: 'Rules', href: 'strategy.html' },
    { group: 'Risk & Capital' },
    { id: 'compliance', label: 'Prop Rules', hint: 'Limits', href: 'compliance.html', isNew: true },
    { id: 'expenses', label: 'Expenses', hint: 'P&L', href: 'expenses.html' },
    { group: 'Reports' },
    { id: 'report', label: 'Monthly Report', hint: 'Print', href: 'report.html', isNew: true },
    { group: 'Data' },
    { id: 'manual-entry', label: 'Manual Entry', hint: 'Form', href: 'manual-entry.html' },
    { id: 'brokers', label: 'Broker Connections', hint: 'Sync', href: 'brokers.html' },
    { id: 'accounts', label: 'Accounts', hint: 'Manage', href: 'accounts.html' }
  ];

  function renderShell() {
    var page = document.body.dataset.page || '';
    var title = document.body.dataset.title || '';
    var sub = document.body.dataset.sub || '';
    var settings = TH.store.get('settings') || {};

    /* sidebar */
    var sb = qs('#thSidebar');
    if (sb) {
      sb.innerHTML = '';
      sb.appendChild(el('a', { class: 'sb-brand', href: '../index.html' }, [
        el('img', { src: '../assets/logo.svg', alt: 'TradeHarbor logo' }),
        el('span', { class: 'b-name', html: 'Trade<em>Harbor</em>' })
      ]));
      var initials = (settings.traderName || 'T H').split(/\s+/).map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
      sb.appendChild(el('div', { class: 'sb-user' }, [
        el('div', { class: 'avatar', text: initials }),
        el('div', {}, [
          el('div', { class: 'u-name', text: settings.traderName || 'Trader' }),
          el('div', { class: 'u-ws', text: settings.workspaceName || 'Workspace' })
        ])
      ]));
      NAV.forEach(function (item) {
        if (item.group) { sb.appendChild(el('div', { class: 'sb-group', text: item.group })); return; }
        var link = el('a', {
          class: 'sb-link' + (item.id === page ? ' active' : ''),
          href: item.href
        }, [
          el('span', { text: item.label }),
          item.isNew ? el('span', { class: 'sb-new', text: 'New' }) : el('span', { class: 'sb-hint', text: item.hint })
        ]);
        sb.appendChild(link);
      });
      var isDark = document.documentElement.dataset.theme === 'dark';
      var foot = el('div', { class: 'sb-foot' }, [
        el('div', { class: 'sb-links' }, [
          el('button', {
            text: isDark ? '☀ Light mode' : '◐ Dark mode',
            onclick: function () {
              try { localStorage.setItem('th:theme', isDark ? 'light' : 'dark'); } catch (err) { /* noop */ }
              location.reload();
            }
          }),
          el('button', {
            text: 'Reset demo data', onclick: function () {
              confirmBox({
                title: 'Reset demo data?',
                message: 'This clears every trade, note, screenshot, expense and setting in this browser and reloads the original demo dataset.',
                okLabel: 'Reset everything', danger: true
              }).then(function (ok) {
                if (!ok) return;
                TH.store.resetToDemo();
                location.reload();
              });
            }
          }),
          el('a', { href: '../legal.html', text: 'Legal' })
        ]),
        el('div', { class: 'sb-copy', text: '© 2026 TradeHarbor · demo build' })
      ]);
      sb.appendChild(foot);
    }

    /* page head */
    var head = qs('#thPageHead');
    if (head) {
      var left = el('div', {}, [
        el('div', { class: 'crumb', html: 'Workspace <span class="faint">/</span> <b>' + esc(title) + '</b>' }),
        el('h1', { text: title }),
        sub ? el('p', { class: 'head-sub', text: sub }) : null
      ]);
      head.appendChild(left);
      var side = el('div', { class: 'head-side', id: 'headSide' });
      head.appendChild(side);
    }

    /* footer */
    var foot2 = qs('#thFoot');
    if (foot2) {
      foot2.innerHTML =
        '<div class="f-disc"><b>Risk disclosure:</b> Futures and forex trading involves substantial risk of loss ' +
        'and is not suitable for every investor. You can lose more than your initial investment. Trade only with ' +
        'risk capital. Past performance is not indicative of future results. TradeHarbor is a journaling tool, ' +
        'not financial advice.</div>' +
        '<div class="f-links"><a href="../legal.html">Disclaimer</a><a href="../legal.html#privacy">Privacy</a>' +
        '<a href="../legal.html">Legal</a></div>';
    }

    /* mobile top bar */
    var mob = el('div', { class: 'mob-bar' }, [
      el('button', { class: 'burger', 'aria-label': 'Open menu', text: '☰' }),
      el('span', { class: 'm-title', text: 'TradeHarbor — ' + title })
    ]);
    var main = qs('.main');
    if (main) main.insertBefore(mob, main.firstChild);
    var scrim = null;
    mob.querySelector('.burger').addEventListener('click', function () {
      sb.classList.add('open');
      scrim = el('div', { class: 'sb-scrim' });
      scrim.addEventListener('click', function () {
        sb.classList.remove('open');
        scrim.remove();
      });
      document.body.appendChild(scrim);
    });
    if (sb) sb.addEventListener('click', function (e) {
      if (e.target.closest('a') && scrim) { sb.classList.remove('open'); scrim.remove(); }
    });
  }

  function headStat(value, label, cls) {
    var side = qs('#headSide');
    if (!side) return;
    side.appendChild(el('div', { class: 'head-stat' }, [
      el('b', { class: cls || '', text: value }),
      el('span', { text: label })
    ]));
  }

  function emptyState(opts) {
    return el('div', { class: 'empty' }, [
      el('div', { class: 'e-icon', text: opts.icon || '◎' }),
      el('h4', { text: opts.title || 'Nothing here yet' }),
      el('p', { text: opts.message || '' }),
      opts.action ? el('a', { class: 'btn small', href: opts.action.href, text: opts.action.label }) : null
    ]);
  }

  /* boot: init store + shell before page scripts run their init */
  document.addEventListener('DOMContentLoaded', function () {
    var isApp = !!document.body.dataset.page;
    if (!isApp) return;
    var info = TH.store.init();
    renderShell();
    if (info && info.renewed > 0) {
      toast(info.renewed + ' subscription renewal' + (info.renewed > 1 ? 's' : '') + ' auto-logged to Expenses', 'info');
    }
  });

  return {
    qs: qs, qsa: qsa, el: el, esc: esc,
    fmtMoney: fmtMoney, plClass: plClass, fmtR: fmtR, fmtPct: fmtPct, fmtPF: fmtPF,
    relDate: relDate, relTime: relTime,
    toast: toast, modal: modal, confirm: confirmBox, multiSelect: multiSelect,
    headStat: headStat, emptyState: emptyState
  };
})();
