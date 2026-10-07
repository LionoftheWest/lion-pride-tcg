// Small SVG charts of the Admin view (no library). Rules (dataviz): one y-axis, 2px lines, recessive grid,
// a legend for 2+ series plus direct end labels, text in text colors (the colored mark carries identity),
// a crosshair + tooltip on lines, a tooltip per bar. Every value comes from the API.
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const div = (cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; if (text != null) d.textContent = text; return d; };

export const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(v * 100) / 100);
};
const niceMax = (m) => {
  if (!(m > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(m));
  for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= m) return f * p;
  return 10 * p;
};

function tooltip(host) {
  const t = div('chart-tip');
  t.hidden = true;
  host.append(t);
  return {
    show(x, y, title, rows) {
      t.replaceChildren(div('chart-tip-title', title));
      for (const r of rows) {
        const row = div('chart-tip-row');
        if (r.color) { const k = div('chart-tip-key'); k.style.background = r.color; row.append(k); }
        row.append(div('chart-tip-val num', r.value), div('chart-tip-name', r.name));
        t.append(row);
      }
      t.hidden = false;
      const hw = host.clientWidth, tw = t.offsetWidth;
      t.style.left = `${Math.max(0, Math.min(hw - tw, x + 12))}px`;
      t.style.top = `${Math.max(0, y)}px`;
    },
    hide() { t.hidden = true; },
  };
}

function legend(series) {
  const l = div('chart-legend');
  for (const se of series) {
    const it = div('chart-legend-item');
    const k = div('chart-legend-line'); k.style.background = se.color;
    it.append(k, document.createTextNode(se.name));
    l.append(it);
  }
  return l;
}

// Redraw at the box width (phone and desktop) and on resize.
function responsive(box, draw) {
  let last = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.floor(box.clientWidth);
    if (w > 0 && w !== last) { last = w; draw(w); }
  });
  ro.observe(box);
}

/**
 * Line chart. series: [{ name, short, color, values: number[] }], labels: string[] (x, same length), fmt (tooltip).
 */
export function lineChart({ series, labels, height = 240, fmt = (v) => v.toLocaleString('en-US'), endLabels = true }) {
  const wrap = div('chart');
  if (series.length > 1) wrap.append(legend(series));
  const box = div('chart-box');
  box.style.height = `${height}px`;
  wrap.append(box);
  const tip = tooltip(box);
  const n = labels.length;
  responsive(box, (W) => {
    box.querySelector('svg')?.remove();
    const H = height, L = 44, B = 24, T = 10;
    const maxLabel = endLabels ? Math.max(...series.map((se) => `${se.short || se.name} ${compact(se.values.at(-1) ?? 0)}`.length)) : 0;
    const R = endLabels ? Math.min(140, 16 + maxLabel * 7) : 12;
    const pw = Math.max(40, W - L - R), ph = H - T - B;
    const ymax = niceMax(Math.max(0, ...series.flatMap((se) => se.values.filter(Number.isFinite))));
    const X = (i) => L + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));
    const Y = (v) => T + ph - (v / ymax) * ph;
    const svg = s('svg', { width: W, height: H, role: 'img', 'aria-label': series.map((se) => se.name).join(' and ') });
    for (let k = 0; k <= 4; k++) {
      const v = (ymax * k) / 4, y = Y(v);
      svg.append(s('line', { x1: L, x2: L + pw, y1: y, y2: y, class: 'chart-grid' }));
      const tx = s('text', { x: L - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' }); tx.textContent = compact(v); svg.append(tx);
    }
    const ticks = Math.min(n, W < 500 ? 3 : 5);
    for (let k = 0; k < ticks; k++) {
      const i = ticks === 1 ? 0 : Math.round((k * (n - 1)) / (ticks - 1));
      const tx = s('text', { x: X(i), y: H - 6, 'text-anchor': k === 0 ? 'start' : k === ticks - 1 ? 'end' : 'middle', class: 'chart-axis' });
      tx.textContent = labels[i]; svg.append(tx);
    }
    const ends = [];
    for (const se of series) {
      const d = se.values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(Number.isFinite(v) ? v : 0).toFixed(1)}`).join('');
      svg.append(s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const lv = se.values.at(-1) ?? 0;
      svg.append(s('circle', { cx: X(n - 1), cy: Y(lv), r: 4, fill: se.color, stroke: 'var(--panel)', 'stroke-width': 2 }));
      ends.push({ se, y: Y(lv), v: lv });
    }
    if (endLabels) {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
      for (const e of ends) {
        const tx = s('text', { x: X(n - 1) + 10, y: e.y + 4, class: 'chart-end' });
        const a = s('tspan', { class: 'chart-end-name' }); a.textContent = `${e.se.short || e.se.name} `;
        const b = s('tspan', { class: 'chart-end-val' }); b.textContent = compact(e.v);
        tx.append(a, b); svg.append(tx);
      }
    }
    const cross = s('line', { y1: T, y2: T + ph, class: 'chart-cross', visibility: 'hidden' });
    svg.append(cross);
    const hit = s('rect', { x: L, y: T, width: pw, height: ph, fill: 'transparent', tabindex: 0 });
    let idx = n - 1;
    const at = (i) => {
      idx = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', X(idx)); cross.setAttribute('x2', X(idx)); cross.setAttribute('visibility', 'visible');
      tip.show(X(idx), T, labels[idx], series.map((se) => ({ color: se.color, name: se.name, value: Number.isFinite(se.values[idx]) ? fmt(se.values[idx]) : '-' })));
    };
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      at(Math.round(((e.clientX - r.left - L) / pw) * (n - 1)));
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hide(); });
    hit.addEventListener('focus', () => at(idx));
    hit.addEventListener('blur', () => { cross.setAttribute('visibility', 'hidden'); tip.hide(); });
    hit.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') at(idx - 1); if (e.key === 'ArrowRight') at(idx + 1); });
    svg.append(hit);
    box.prepend(svg);
  });
  return wrap;
}

/**
 * Bar chart (one series). bars: [{ label, value, tip }], color, highlightLast, valueLabels (auto: on when 12 bars or fewer and room).
 */
export function barChart({ bars, color = 'var(--hunt)', height = 160, fmt = (v) => v.toLocaleString('en-US'), highlightLast = false, name = '' }) {
  const wrap = div('chart');
  const box = div('chart-box');
  box.style.height = `${height}px`;
  wrap.append(box);
  const tip = tooltip(box);
  responsive(box, (W) => {
    box.querySelector('svg')?.remove();
    const H = height, T = 18, B = 22, n = Math.max(1, bars.length);
    // Values on the bars when there are few; else a y-axis (one axis) and the values in the tooltip.
    const showVals = n <= 12 && (W - 2 * (n - 1)) / n >= 28;
    const L = showVals ? 0 : 40, PW = W - L;
    const gap = 2, bw = Math.max(2, (PW - gap * (n - 1)) / n), ph = H - T - B;
    const ymax = niceMax(Math.max(0, ...bars.map((b) => b.value || 0)));
    const everyLabel = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(PW / 52))));
    const svg = s('svg', { width: W, height: H, role: 'img', 'aria-label': name });
    svg.append(s('line', { x1: L, x2: W, y1: T + ph, y2: T + ph, class: 'chart-grid' }));
    if (!showVals) {
      for (let k = 1; k <= 2; k++) {
        const v = (ymax * k) / 2, y = T + ph - (v / ymax) * ph;
        svg.append(s('line', { x1: L, x2: W, y1: y, y2: y, class: 'chart-grid' }));
        const tx = s('text', { x: L - 8, y: y + 4, 'text-anchor': 'end', class: 'chart-axis' }); tx.textContent = compact(v); svg.append(tx);
      }
    }
    bars.forEach((b, i) => {
      const x = L + i * (bw + gap), v = Math.max(0, b.value || 0), bh = (v / ymax) * ph, y = T + ph - bh;
      const r = Math.min(4, bw / 2, bh);
      const d = bh <= 0 ? '' : `M${x},${T + ph}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${T + ph}Z`;
      const g = s('g', { tabindex: 0, class: 'chart-bar' });
      if (d) g.append(s('path', { d, fill: color, opacity: highlightLast && i < n - 1 ? 0.72 : 1 }));
      g.append(s('rect', { x, y: T, width: bw + gap, height: ph, fill: 'transparent' }));
      const show = () => tip.show(x + bw / 2, 0, b.label, [{ color, name: b.tipName || name, value: fmt(v) }]);
      g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
      g.addEventListener('pointerleave', () => tip.hide()); g.addEventListener('blur', () => tip.hide());
      svg.append(g);
      if (showVals) {
        const tv = s('text', { x: x + bw / 2, y: y - 5, 'text-anchor': 'middle', class: 'chart-val' }); tv.textContent = fmt(v); svg.append(tv);
      }
      if ((i % everyLabel === 0 && n - 1 - i >= everyLabel) || i === n - 1) {
        const tl = s('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', class: `chart-axis${highlightLast && i === n - 1 ? ' chart-axis-strong' : ''}` });
        tl.textContent = b.short ?? b.label; svg.append(tl);
      }
    });
    box.prepend(svg);
  });
  return wrap;
}
