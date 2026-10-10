// The two checks of docs/design.md 12.6 that fitdetect.js, cutdetect.js and walk-checks.js do not cover:
//   iconNoName  an icon-only control (no visible text) with no aria-label or aria-labelledby (5.3, 9.3)
//   contrast    text below 4.5:1 on its surface, or below 3:1 for large text (18 px, or 14 px bold) (9.4)
// Contrast is measured on solid backgrounds only. A text over a gradient or an image is counted in
// contrastSkipped (design.md 4.4 asks for a scrim there; the design review checks it). Disabled controls are exempt.
() => {
  const vw = innerWidth, vh = innerHeight;
  const name = (e) => (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : e.tagName.toLowerCase());
  const path = (e) => { const p = []; for (let x = e; x && x !== document.body && p.length < 3; x = x.parentElement) p.unshift(name(x)); return p.join(' > '); };
  const visDeep = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const inView = (r) => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
  const skip = (e) => e.closest('#loader:not([data-measure]), #tutLayer, svg, canvas, .hidden');
  const out = { iconNoName: [], contrast: [], contrastSkipped: 0 };

  // 1) icon-only controls
  for (const e of document.querySelectorAll('button, a[href], [role=button], [role=tab], input[type=button], input[type=submit]')) {
    if (skip(e) || !visDeep(e) || !inView(e.getBoundingClientRect())) continue;
    const text = (e.tagName === 'INPUT' ? e.value : e.innerText || '').replace(/\s+/g, '');
    if (/[\p{L}\p{N}]/u.test(text)) continue;
    const label = (e.getAttribute('aria-label') || '').trim() || (e.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join('').trim();
    if (!label) out.iconNoName.push([path(e), e.title ? `title only: "${e.title.slice(0, 30)}"` : 'no name']);
  }

  // 2) contrast
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const seen = new Set();
  for (const e of document.body.querySelectorAll('*')) {
    if (skip(e) || seen.has(e)) continue;
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    if (e.closest('[disabled], [aria-disabled="true"], .v2-card')) continue;
    const r = e.getBoundingClientRect(); if (!inView(r) || !visDeep(e)) continue;
    seen.add(e);
    const cs = getComputedStyle(e);
    let fg = parse(cs.color); if (!fg) continue;
    // the surface: blend every background up to the first opaque one; give up on a gradient or an image
    const layers = []; let unknown = false;
    for (let x = e; x; x = x.parentElement) {
      const xs = getComputedStyle(x);
      if (xs.backgroundImage && xs.backgroundImage !== 'none') { unknown = true; break; }
      const bg = parse(xs.backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
    }
    if (unknown) { out.contrastSkipped++; continue; }
    let bg = { r: 10, g: 10, b: 18, a: 1 };   // --bg-base #0A0A12 under everything
    for (const l of layers.reverse()) bg = over(l, bg);
    fg = over(fg, bg);
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const fs = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const need = fs >= 18 || (fs >= 14 && bold) ? 3 : 4.5;
    if (ratio + 0.01 < need) out.contrast.push([path(e) + ' "' + e.textContent.trim().slice(0, 20) + '"', +ratio.toFixed(2), need, cs.color]);
  }
  return out;
}
