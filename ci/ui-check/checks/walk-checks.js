// Visual walkthrough checks (dimension 4). Returns one object; the runner adds fitdetect + cutdetect.
(opts) => {
  const vw = innerWidth, vh = innerHeight, touch = opts.touch, phone = opts.phone;
  const name = (e) => (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : e.tagName.toLowerCase());
  const path = (e) => { const p = []; for (let x = e; x && x !== document.body && p.length < 3; x = x.parentElement) p.unshift(name(x)); return p.join(' > '); };
  const visDeep = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const inView = (r) => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
  const label = (e) => (e.getAttribute('aria-label') || e.title || e.textContent || e.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 28);
  const out = { vw, vh };
  // 1) page scroll
  const se = document.scrollingElement;
  out.pageScroll = { x: Math.max(0, se.scrollWidth - vw), y: Math.max(0, se.scrollHeight - vh) };
  // 2) the window: the top fixed box that covers > 8% of the window (not the bars), else #main
  const SKIP = '#topbar, #dock, #effectBanners, #feed, #loader, #status, #tutLayer';
  let win = null, wz = -1;
  for (const e of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (cs.position !== 'fixed' || e.closest(SKIP) || /^(BUTTON|A|INPUT)$/.test(e.tagName) || !visDeep(e)) continue;
    const r = e.getBoundingClientRect(); if (r.width * r.height < vw * vh * 0.03 || r.width < 120 || r.height < 80) continue;
    const z = parseInt(cs.zIndex) || 0;
    // a full-window backdrop: use its biggest dialog child when one exists
    if (z >= wz) { wz = z; win = e; }
  }
  const winRoot = win;
  const hadWin = !!win;
  if (win) {
    const r = win.getBoundingClientRect();
    if (r.width >= vw - 2 && r.height >= vh - 2) {
      const kid = [...win.querySelectorAll('[role=dialog], .sh-confirm, .v2-dialog, .modal, .md-box, .box')].find(visDeep);
      if (kid) win = kid;
    }
  }
  if (!win) win = document.getElementById('main');
  document.querySelectorAll('[data-audit-win]').forEach((x) => x.removeAttribute('data-audit-win')); win.setAttribute('data-audit-win', '1');
  const wr = win.getBoundingClientRect();
  out.window = { sel: path(win), rect: [wr.left, wr.top, wr.width, wr.height].map(Math.round) };
  // 3) bars over the window: elementFromPoint at the center and the 4 corners (8 px inside)
  const clampX = (x) => Math.min(vw - 1, Math.max(0, x)), clampY = (y) => Math.min(vh - 1, Math.max(0, y));
  const pts = { center: [wr.left + wr.width / 2, wr.top + wr.height / 2], tl: [wr.left + 8, wr.top + 8], tr: [wr.right - 8, wr.top + 8], bl: [wr.left + 8, wr.bottom - 8], br: [wr.right - 8, wr.bottom - 8] };
  out.covered = [];
  for (const [k, [x, y]] of Object.entries(pts)) {
    const cx = clampX(x), cy = clampY(y);
    if (cx !== x || cy !== y) out.covered.push([k, 'window corner outside the viewport', Math.round(Math.max(x - cx, cx - x, y - cy, cy - y))]);
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !win.contains(hit) && !hit.contains(win)) out.covered.push([k, path(hit), 0]);
  }
  out.windowOutside = Math.round(Math.max(0, -wr.left, -wr.top, wr.right - vw, wr.bottom - vh));
  // the window box itself keeps out of the Discord corner zone on a phone (2.3: Discord puts its buttons over the corner; a window under them is cut off)
  if (phone && hadWin && wr.right > vw - 120 && wr.left < vw && wr.bottom > 0 && wr.top < 60) out.windowCorner = [Math.round(Math.min(wr.right, vw) - Math.max(wr.left, vw - 120)), Math.round(Math.min(wr.bottom, 60) - Math.max(wr.top, 0))];
  // 4) interactive elements: tap size, covered buttons, corner zone, keys for the desktop compare
  const ISEL = 'button, a[href], input, select, textarea, [role=button], [role=tab], .v2-cell, [data-member], [data-buy], [data-tab], [data-adv], [data-pane]';
  const small = [], tiny = [], coveredBtns = [], corner = [], keys = {};
  const zone = { l: vw - 120, t: 0, r: vw, b: 60 };
  const keyOf = (e) => (e.id ? '#' + e.id : e.dataset.tab ? 'tab:' + e.dataset.tab : e.dataset.adv ? 'adv:' + e.dataset.adv : e.dataset.pane ? 'pane:' + e.dataset.pane
    : (e.title && !/\d/.test(e.title)) ? 'title:' + e.title : (!e.closest('.v2-cell, [data-member], .lb-row, .tr-mem, .hl-card, li') && label(e) && !/\d/.test(label(e))) ? 'text:' + label(e) : null);
  for (const e of document.querySelectorAll(ISEL)) {
    if (!visDeep(e) || e.closest('#loader, #tutLayer')) continue;
    if (e.parentElement?.closest(ISEL) && e.tagName !== 'BUTTON' && e.tagName !== 'INPUT') continue;
    const r = e.getBoundingClientRect();
    const key = keyOf(e);
    // P1: a row of a named scroll area (design.md 3.3, D-07: data-scroll-area) is reachable when the area itself is in the view:
    // the area scrolls to it on purpose (the FAQ list, UI-38), as a control in a tab panel is reachable through its tab (below)
    const sa0 = key && e.closest('[data-scroll-area]'); const sar = sa0 && visDeep(sa0) && sa0.getBoundingClientRect();
    const inArea = !!(sar && sar.width > 0 && sar.height > 0 && sar.left >= -1 && sar.top >= -1 && sar.right <= vw + 1 && sar.bottom <= vh + 1);
    if (key) { const k2 = keys[key] || { inView: false }; k2.inView = k2.inView || inArea || (r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1); keys[key] = k2; }
    if (!inView(r)) continue;
    { const na = e.closest('[data-scroll-area]'); if (na) { const nr = na.getBoundingClientRect(); const my = r.top + r.height / 2; if (my < nr.top || my > nr.bottom) continue; } }   // a row the named scroll area scrolled out of view (design.md 3.3, D-07)
    // covered: the center hit is not the element (a bar or a banner lies on it)
    const cx = clampX(r.left + r.width / 2), cy = clampY(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !e.contains(hit) && !hit.contains(e) && !hit.closest(ISEL)?.contains(e) && !(winRoot && winRoot !== win.ownerDocument && !winRoot.contains(e) && winRoot.contains(hit))) {
      // ignore an element hidden under its own scroll container edge: a named scroll area (design.md 3.3, D-07:
      // data-scroll-area) has its rows scrolled out of view on purpose; their center lies outside the area
      const sa = e.closest('[data-scroll-area]');
      const sr = sa && sa.getBoundingClientRect();
      if (!(sr && (cy < sr.top || cy > sr.bottom))) coveredBtns.push([path(e) + ' "' + label(e) + '"', 'under ' + path(hit)]);
    }
    if (touch && (r.width < 44 || r.height < 44)) { (r.width < 32 || r.height < 32 ? tiny : small).push([path(e) + ' "' + label(e) + '"', Math.round(r.width) + 'x' + Math.round(r.height)]); }
    if (phone && r.right > zone.l && r.left < zone.r && r.bottom > zone.t && r.top < zone.b) corner.push([path(e) + ' "' + label(e) + '"', [r.left, r.top, r.width, r.height].map(Math.round).join(',')]);
  }
  // P1: a size class can move content into a tab. A control in a hidden tab panel (role=tabpanel, hidden, id) counts as
  // reachable when the visible tab that controls it (aria-controls) is on the screen. Removed content still counts as missing.
  for (const p of document.querySelectorAll('[role="tabpanel"][hidden][id]')) {
    const tab = document.querySelector(`[aria-controls~="${CSS.escape(p.id)}"]`);
    if (!tab || !visDeep(tab)) continue;
    for (const e of p.querySelectorAll(ISEL)) { const k = keyOf(e); if (k) keys[k] = { inView: true, inTab: true }; }
  }
  out.tapSmall = small; out.tapTiny = tiny; out.coveredBtns = coveredBtns; out.corner = corner; out.keys = keys;
  // 5) text under 11 px (inside the window)
  const tinyText = {};
  for (const e of document.body.querySelectorAll('*')) {
    if (e.closest('svg, #loader, #tutLayer, .v2-card, canvas')) continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if (fs < 1 || fs >= 11) continue;
    const r = e.getBoundingClientRect(); if (!inView(r) || !visDeep(e)) continue;
    const k = fs.toFixed(1); (tinyText[k] = tinyText[k] || []).push(path(e) + ' "' + e.textContent.trim().slice(0, 20) + '"');
  }
  out.tinyText = tinyText;
  // 6) empty space in the window: the content box and the largest empty band (24 x 24 grid)
  const leaves = [];
  for (const e of win.querySelectorAll('*')) {
    if (!visDeep(e)) continue;
    const t = e.tagName;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const bg = getComputedStyle(e).backgroundImage;
    // The library Switch (UI-00 5.2) hides its input (1 px, opacity 0): its visible track is the control's ink.
    if (own || /^(IMG|CANVAS|VIDEO|INPUT|BUTTON|SELECT|svg)$/i.test(t) || (bg && bg !== 'none' && !/gradient/.test(bg)) || e.classList.contains('u3-switch__track')) {
      const r = e.getBoundingClientRect();
      const l = Math.max(r.left, wr.left, 0), tp = Math.max(r.top, wr.top, 0), rt = Math.min(r.right, wr.right, vw), bt = Math.min(r.bottom, wr.bottom, vh);
      if (rt > l && bt > tp) leaves.push([l, tp, rt, bt]);
    }
  }
  const W0 = Math.max(0, wr.left), T0 = Math.max(0, wr.top), W1 = Math.min(vw, wr.right), T1 = Math.min(vh, wr.bottom);
  if (leaves.length && W1 > W0 && T1 > T0) {
    const minL = Math.min(...leaves.map((x) => x[0])), minT = Math.min(...leaves.map((x) => x[1])), maxR = Math.max(...leaves.map((x) => x[2])), maxB = Math.max(...leaves.map((x) => x[3]));
    out.contentUse = +(((maxR - minL) * (maxB - minT)) / ((W1 - W0) * (T1 - T0))).toFixed(2);
    const N = 24, rows = Array(N).fill(false), cols = Array(N).fill(false); let cov = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = W0 + (j + 0.5) * (W1 - W0) / N, y = T0 + (i + 0.5) * (T1 - T0) / N;
      if (leaves.some((q) => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3])) { rows[i] = true; cols[j] = true; cov++; }
    }
    const band = (a) => { let best = 0, cur = 0; for (const v of a) { cur = v ? 0 : cur + 1; best = Math.max(best, cur); } return +(best / N).toFixed(2); };
    out.emptyBandY = band(rows); out.emptyBandX = band(cols); out.inkCover = +(cov / (N * N)).toFixed(2);
  } else { out.contentUse = 0; out.emptyBandY = 1; out.emptyBandX = 1; out.inkCover = 0; }
  // 7) inner scroll boxes (information: content the member must scroll to reach)
  out.scrollBoxes = [];
  for (const e of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (!/(auto|scroll)/.test(cs.overflowY + cs.overflowX) || !visDeep(e)) continue;
    const dy = e.scrollHeight - e.clientHeight, dx = e.scrollWidth - e.clientWidth;
    if ((dy > 4 && /(auto|scroll)/.test(cs.overflowY)) || (dx > 4 && /(auto|scroll)/.test(cs.overflowX))) out.scrollBoxes.push([path(e), dx > 4 ? dx : 0, dy > 4 ? dy : 0]);
  }
  return out;
}
