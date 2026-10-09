// Cut text (Nathan, 2026-10-01: "I don't want names squished/cut off"). Inside `root`, every text
// must show in full: no ellipsis, no clip by an ancestor with overflow hidden, no placeholder wider
// than its input. Returns [[kind, where, text], ...].
(root) => {
  const out = [];
  const base = document.querySelector(root || 'body'); if (!base) return [['missing', root, '']];
  const name = (e) => (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : e.tagName.toLowerCase());
  const vis = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; } const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n; (n = walker.nextNode());) {
    const t = n.textContent.trim(); if (t.length < 2) continue;
    const e = n.parentElement; if (!e || seen.has(e) || !vis(e) || e.closest('svg, .v2-card, .tx-layer')) continue;
    if (parseFloat(getComputedStyle(e).fontSize) < 1) continue;
    seen.add(e);
    const rg = document.createRange(); rg.selectNodeContents(n);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 0);
    if (!rects.length) continue;
    // Not a text marked data-trunc: design.md 10.4 permits "…" on notification bodies, offer notes and feed lines that
    // show their full text on tap (the bell rows, UI-24). Its clipped part is not cut text.
    if (e.closest('[data-trunc]')) continue;
    // An ellipsis on this element or an ancestor that clips it.
    for (let x = e; x && x !== document.body; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (cs.textOverflow === 'ellipsis' && x.scrollWidth > x.clientWidth + 1) { out.push(['ellipsis', name(x), t.slice(0, 40)]); break; }
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const b = x.getBoundingClientRect();
        const cut = rects.some((r) => r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1);
        if (cut) { out.push(['clipped', name(x) + ' > ' + name(e), t.slice(0, 40)]); break; }
      }
      if (cs.position === 'fixed') break; // a fixed box escapes the clip of its ancestors
    }
    // A word broken across two lines (a squished name).
    const raw = n.textContent;
    for (const m of raw.matchAll(/\S{2,}/g)) {
      const wr = document.createRange(); wr.setStart(n, m.index); wr.setEnd(n, m.index + m[0].length);
      const tops = new Set([...wr.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      if (tops.size > 1) { out.push(['midword', name(e), m[0].slice(0, 40)]); break; }
    }
    // Off the window.
    if (rects.some((r) => r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)) out.push(['offscreen', name(e), t.slice(0, 40)]);
  }
  // Placeholders: the whole placeholder fits in the input.
  const cv = document.createElement('canvas').getContext('2d');
  for (const i of base.querySelectorAll('input[placeholder]')) {
    if (!vis(i) || i.value) continue;
    const cs = getComputedStyle(i); cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (cv.measureText(i.placeholder).width > room + 1) out.push(['placeholder', name(i), i.placeholder]);
  }
  return out;
}
