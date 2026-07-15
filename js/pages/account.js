/* Account & Sync page — sign in, sync status, cloud data controls */
(function () {
  'use strict';
  var ui, calc, store, cloud;

  var STATUS_COPY = {
    unconfigured: ['Local only', 'Cloud sync is not configured on this deployment yet. Your journal lives safely in this browser — use CSV export for backups.'],
    signedOut: ['Not signed in', 'Sign in below to back up this journal and sync it across your devices.'],
    syncing: ['Syncing…', 'Pushing and pulling the latest changes.'],
    synced: ['Synced', 'Your journal is backed up and up to date.'],
    offline: ['Offline', 'Changes are saved locally and will sync when you are back online.'],
    error: ['Sync error', 'Something went wrong talking to the cloud — changes remain safe locally.']
  };

  function renderStatusCard(parent) {
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Sync status' }),
        ui.el('p', { class: 'card-sub', text: 'Your journal is local-first: every change lands in this browser instantly, then syncs when signed in.' })
      ])
    ]));
    var zone = ui.el('div', { id: 'statusZone' });
    card.appendChild(zone);
    parent.appendChild(card);

    cloud.onStatus(function (s, detail) {
      var copy = STATUS_COPY[s] || STATUS_COPY.unconfigured;
      var user = cloud.getUser();
      zone.innerHTML =
        '<div class="kpis" style="grid-template-columns:repeat(2,1fr)">' +
        '<div class="kpi"><div class="k-label">Status</div><div class="k-value" style="font-size:18px"><span class="sync-dot ' +
        (s === 'synced' ? 'green' : s === 'syncing' ? 'blue' : s === 'offline' ? 'amber' : s === 'error' ? 'red' : '') +
        '"></span>' + copy[0] + '</div><div class="k-sub">' + ui.esc(detail || copy[1]) + '</div></div>' +
        '<div class="kpi"><div class="k-label">Signed in as</div><div class="k-value" style="font-size:16px;word-break:break-all">' +
        (user ? ui.esc(user.email || user.id) : '—') + '</div><div class="k-sub">' +
        (user ? 'Journal follows this account.' : 'No account connected in this browser.') + '</div></div></div>';
    });
  }

  function renderSignIn(parent) {
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Sign in' }),
        ui.el('p', { class: 'card-sub', text: 'No password needed — we email you a one-time sign-in link.' })
      ])
    ]));

    if (!cloud.configured()) {
      card.appendChild(ui.emptyState({
        icon: '☁', title: 'Cloud not configured yet',
        message: 'This deployment runs in local-only mode. Once a Supabase project is connected (see SETUP-CLOUD.md in the repo), sign-in appears here automatically.'
      }));
      parent.appendChild(card);
      return;
    }

    var stack = ui.el('div', { class: 'stack', style: 'gap:12px;max-width:420px' });
    var email = ui.el('input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
    var emailLab = ui.el('label', { class: 'field' });
    emailLab.appendChild(ui.el('span', { text: 'Email address' }));
    emailLab.appendChild(email);
    stack.appendChild(emailLab);

    var sendBtn = ui.el('button', { class: 'btn primary', text: 'Email me a sign-in link' });
    sendBtn.addEventListener('click', function () {
      var v = email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { ui.toast('Enter a valid email address.', 'err'); return; }
      sendBtn.disabled = true;
      cloud.signInWithEmail(v).then(function () {
        ui.toast('Link sent — check your email and open it on this device');
        sendBtn.textContent = 'Link sent ✓ (check your inbox)';
      }).catch(function (err) {
        sendBtn.disabled = false;
        ui.toast(err.message || 'Could not send the link.', 'err');
      });
    });
    stack.appendChild(sendBtn);

    stack.appendChild(ui.el('div', { class: 'muted', style: 'text-align:center;font-size:12px', text: '— or —' }));
    var gBtn = ui.el('button', { class: 'btn', text: 'Continue with Google' });
    gBtn.addEventListener('click', function () {
      cloud.signInWithGoogle().catch(function (err) {
        ui.toast(err.message || 'Google sign-in is not enabled yet on this deployment.', 'err');
      });
    });
    stack.appendChild(gBtn);
    stack.appendChild(ui.el('p', { class: 'faint', style: 'font-size:11px;margin:0', text: 'By signing in you agree to the Terms of Service and Privacy Policy (linked in the footer).' }));

    card.appendChild(stack);
    parent.appendChild(card);
  }

  function renderSignedIn(parent) {
    var card = ui.el('div', { class: 'card' });
    card.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Your account' }),
        ui.el('p', { class: 'card-sub', text: 'Sync happens automatically a moment after every change; use Sync now to force it.' })
      ])
    ]));
    var row = ui.el('div', { class: 'row' });
    row.appendChild(ui.el('button', {
      class: 'btn primary', text: '⟳ Sync now',
      onclick: function () {
        cloud.syncNow().then(function (r) {
          ui.toast(r && r.error ? 'Sync failed — see status above' : 'Sync complete', r && r.error ? 'err' : 'ok');
        });
      }
    }));
    row.appendChild(ui.el('button', {
      class: 'btn', text: 'Sign out',
      onclick: function () {
        cloud.signOut().then(function () {
          ui.toast('Signed out — your journal stays available in this browser');
          rerender();
        });
      }
    }));
    card.appendChild(row);
    parent.appendChild(card);

    var danger = ui.el('div', { class: 'card', style: 'border-color:var(--cell-neg-line)' });
    danger.appendChild(ui.el('div', { class: 'card-head' }, [
      ui.el('div', {}, [
        ui.el('h2', { class: 'card-title', text: 'Delete cloud copy' }),
        ui.el('p', { class: 'card-sub', text: 'Removes your journal from the cloud. The copy in this browser is untouched.' })
      ]),
      ui.el('button', {
        class: 'btn danger', text: 'Delete cloud data',
        onclick: function () {
          ui.confirm({
            title: 'Delete your cloud journal?',
            message: 'All synced journal data tied to this account will be permanently removed from the server. Local data in this browser is kept.',
            okLabel: 'Delete from cloud', danger: true
          }).then(function (ok) {
            if (!ok) return;
            cloud.deleteCloudCopy().then(function () {
              ui.toast('Cloud copy deleted');
            }).catch(function (err) { ui.toast(err.message || 'Delete failed.', 'err'); });
          });
        }
      })
    ]));
    parent.appendChild(danger);
  }

  function renderPrivacyNote(parent) {
    var card = ui.el('div', { class: 'card' });
    card.innerHTML =
      '<div class="card-head"><div><h2 class="card-title">How your data is handled</h2></div></div>' +
      '<dl class="dl">' +
      '<dt>Local first</dt><dd>Every change saves to this browser instantly — the app works fully offline.</dd>' +
      '<dt>When signed in</dt><dd>Your journal is mirrored to your private row-level-secured cloud space; only your account can read it.</dd>' +
      '<dt>Your exit</dt><dd>Export everything as CSV from Trades and Expenses anytime, and delete the cloud copy above with one click.</dd>' +
      '<dt>Details</dt><dd><a href="../privacy.html">Privacy Policy</a> · <a href="../terms.html">Terms of Service</a></dd>' +
      '</dl>';
    parent.appendChild(card);
  }

  function rerender() {
    var root = ui.qs('#pageBody');
    root.innerHTML = '';
    build(root);
  }

  function build(root) {
    renderStatusCard(root);
    var cols = ui.el('div', { class: 'grid-2' });
    var left = ui.el('div', { class: 'stack' });
    var right = ui.el('div', { class: 'stack' });
    if (cloud.getUser()) renderSignedIn(left);
    else renderSignIn(left);
    renderPrivacyNote(right);
    cols.appendChild(left);
    cols.appendChild(right);
    root.appendChild(cols);
  }

  document.addEventListener('DOMContentLoaded', function () {
    ui = TH.ui; calc = TH.calc; store = TH.store; cloud = TH.cloud;
    build(ui.qs('#pageBody'));
    // re-render once when auth state flips (e.g. returning from a magic link)
    var was = !!cloud.getUser();
    cloud.onStatus(function () {
      var now = !!cloud.getUser();
      if (now !== was) { was = now; rerender(); }
    });
  });
})();
