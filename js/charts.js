/* TradeHarbor charts — hand-rolled SVG line/bar with tooltip, no libraries */
window.TH = window.TH || {};
TH.charts = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  /* read theme colors at render time so charts follow light/dark mode */
  function themeColor(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (span / count) / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var ticks = [];
    var start = Math.ceil(min / step) * step;
    for (var v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  }

  function shortMoney(n) {
    var abs = Math.abs(n);
    var s = abs >= 1000 ? (abs / 1000).toFixed(abs >= 10000 ? 0 : 1) + 'k' : String(Math.round(abs));
    return (n < 0 ? '−$' : '$') + s;
  }
  function shortDate(dateKey) {
    var p = dateKey.split('-');
    return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1] + ' ' + (+p[2]);
  }

  /* series: [{dateKey, cum, day, count}] — mode 'line' plots cumulative,
     mode 'bar' plots daily P/L bars around a zero line. */
  function plChart(container, series, mode) {
    container.innerHTML = '';
    container.classList.add('chart-frame');
    container._thChart = { series: series, mode: mode };

    // phone profile: smaller canvas + bigger relative type so axis text stays legible
    var phone = container.clientWidth > 0 && container.clientWidth < 520;
    var W = phone ? 430 : 860, H = phone ? 280 : 300;
    var padL = phone ? 46 : 62, padR = phone ? 10 : 14, padT = 16, padB = phone ? 26 : 30;
    var fontAxis = phone ? '12' : '10.5';
    var maxXLabels = phone ? 4 : 6;
    var innerW = W - padL - padR, innerH = H - padT - padB;

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Profit and loss chart' });
    container.appendChild(svg);

    if (!series.length) {
      var t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: themeColor('--muted', '#5f6b7d'), 'font-size': '13', 'font-family': 'inherit' });
      t.textContent = 'No trades in the selected range';
      svg.appendChild(t);
      return;
    }

    var values = series.map(function (p) { return mode === 'bar' ? p.day : p.cum; });
    var minV = Math.min(0, Math.min.apply(null, values));
    var maxV = Math.max(0, Math.max.apply(null, values));
    if (minV === maxV) { minV -= 50; maxV += 50; }
    var pad = (maxV - minV) * 0.08;
    minV -= pad; maxV += pad;

    function x(i) {
      if (series.length === 1) return padL + innerW / 2;
      return padL + (i / (series.length - 1)) * innerW;
    }
    function y(v) { return padT + (1 - (v - minV) / (maxV - minV)) * innerH; }

    /* gridlines + y labels */
    niceTicks(minV, maxV, 4).forEach(function (tv) {
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(tv), y2: y(tv), stroke: themeColor('--line', 'rgba(28,36,51,.09)'), 'stroke-width': 1 }));
      var lbl = svgEl('text', { x: padL - 8, y: y(tv) + 4, 'text-anchor': 'end', fill: themeColor('--muted', '#5f6b7d'), 'font-size': fontAxis, 'font-family': 'inherit' });
      lbl.textContent = shortMoney(tv);
      svg.appendChild(lbl);
    });
    /* zero line */
    if (minV < 0 && maxV > 0) {
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), stroke: themeColor('--line-strong', 'rgba(28,36,51,.2)'), 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
    }
    /* x labels — evenly sampled */
    var lblCount = Math.min(maxXLabels, series.length);
    for (var li = 0; li < lblCount; li++) {
      var idx = lblCount === 1 ? 0 : Math.round(li * (series.length - 1) / (lblCount - 1));
      var xl = svgEl('text', { x: x(idx), y: H - 8, 'text-anchor': 'middle', fill: themeColor('--muted', '#5f6b7d'), 'font-size': fontAxis, 'font-family': 'inherit' });
      xl.textContent = shortDate(series[idx].dateKey);
      svg.appendChild(xl);
    }

    if (mode === 'bar') {
      var bw = Math.max(2, Math.min(26, (innerW / series.length) * 0.66));
      series.forEach(function (p, i) {
        var v = p.day;
        var y0 = y(Math.max(0, v)), y1 = y(Math.min(0, v));
        svg.appendChild(svgEl('rect', {
          x: x(i) - bw / 2, y: y0,
          width: bw, height: Math.max(1.5, y1 - y0),
          rx: Math.min(3, bw / 3),
          fill: v >= 0 ? themeColor('--green', '#047857') : themeColor('--red', '#be123c'), 'fill-opacity': .72
        }));
      });
    } else {
      var defs = svgEl('defs');
      var gradId = 'thGrad' + Math.random().toString(36).slice(2, 7);
      var grad = svgEl('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': themeColor('--accent', '#a16207'), 'stop-opacity': .2 }));
      grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': themeColor('--accent', '#a16207'), 'stop-opacity': 0 }));
      defs.appendChild(grad);
      svg.appendChild(defs);

      var line = '', area = '';
      series.forEach(function (p, i) {
        var px = x(i), py = y(p.cum);
        line += (i === 0 ? 'M' : 'L') + px.toFixed(1) + ' ' + py.toFixed(1);
      });
      var baseY = y(Math.max(minV, Math.min(0, maxV)));
      area = line + 'L' + x(series.length - 1).toFixed(1) + ' ' + baseY.toFixed(1) +
        'L' + x(0).toFixed(1) + ' ' + baseY.toFixed(1) + 'Z';
      svg.appendChild(svgEl('path', { d: area, fill: 'url(#' + gradId + ')' }));
      svg.appendChild(svgEl('path', { d: line, fill: 'none', stroke: themeColor('--accent', '#a16207'), 'stroke-width': phone ? 2.6 : 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      var last = series[series.length - 1];
      svg.appendChild(svgEl('circle', { cx: x(series.length - 1), cy: y(last.cum), r: 3.6, fill: themeColor('--accent', '#a16207'), stroke: themeColor('--panel', '#fff'), 'stroke-width': 2 }));
    }

    /* tooltip + crosshair */
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    container.appendChild(tip);
    var cross = svgEl('line', { y1: padT, y2: H - padB, stroke: themeColor('--line-strong', 'rgba(28,36,51,.2)'), 'stroke-width': 1, visibility: 'hidden' });
    svg.appendChild(cross);
    var dot = svgEl('circle', { r: 4, fill: themeColor('--text', '#1c2433'), stroke: themeColor('--panel', '#fff'), 'stroke-width': 2, visibility: 'hidden' });
    svg.appendChild(dot);

    function showAt(clientX) {
      var rect = svg.getBoundingClientRect();
      var mx = (clientX - rect.left) * (W / rect.width);
      var frac = series.length === 1 ? 0 : (mx - padL) / innerW;
      var i = Math.max(0, Math.min(series.length - 1, Math.round(frac * (series.length - 1))));
      var p = series[i];
      var v = mode === 'bar' ? p.day : p.cum;
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(v));
      dot.setAttribute('visibility', 'visible');
      tip.style.display = 'block';
      tip.innerHTML = TH.ui.esc(TH.calc.fmtDateKey(p.dateKey)) + ' · ' + p.count + ' trade' + (p.count === 1 ? '' : 's') +
        '<b class="' + TH.ui.plClass(v) + '">' + TH.ui.fmtMoney(v) + (mode === 'bar' ? ' day' : ' cumulative') + '</b>';
      var cw = container.getBoundingClientRect();
      var px = (x(i) / W) * cw.width;
      tip.style.left = Math.min(cw.width - tip.offsetWidth - 6, Math.max(6, px + 12)) + 'px';
      tip.style.top = '10px';
    }
    function hideTip() {
      tip.style.display = 'none';
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
    }
    svg.addEventListener('mousemove', function (e) { showAt(e.clientX); });
    svg.addEventListener('mouseleave', hideTip);
    svg.addEventListener('touchstart', function (e) {
      if (e.touches.length) showAt(e.touches[0].clientX);
    }, { passive: true });
    svg.addEventListener('touchmove', function (e) {
      if (e.touches.length) showAt(e.touches[0].clientX);
    }, { passive: true });
    svg.addEventListener('touchend', hideTip, { passive: true });
    svg.addEventListener('touchcancel', hideTip, { passive: true });
  }

  /* re-render live charts when the viewport crosses the phone breakpoint */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      document.querySelectorAll('.chart-frame').forEach(function (el) {
        if (el._thChart && document.body.contains(el)) {
          plChart(el, el._thChart.series, el._thChart.mode);
        }
      });
    }, 180);
  });

  return { plChart: plChart };
})();
