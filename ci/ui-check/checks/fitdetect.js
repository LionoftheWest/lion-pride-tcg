() => {
  const vw = innerWidth, vh = innerHeight, out = [];
  const name = (e) => (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : e.tagName.toLowerCase());
  const path = (e) => { const p = []; for (let x = e; x && x !== document.body && p.length < 3; x = x.parentElement) p.unshift(name(x)); return p.join(' > '); };
  const vis = (e) => { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  for (const e of document.body.querySelectorAll('*')) {
    if (e.closest('#loader:not([data-measure]), #tutLayer, svg, canvas, #feed, .hidden, #topbar nav')) continue;
    // a0) text squashed to (almost) nothing inside a visible parent: a name column at 0 px
    { const cs0 = getComputedStyle(e); const pr = e.parentElement && vis(e.parentElement); if (pr && cs0.display !== 'none' && cs0.visibility !== 'hidden' && e.children.length === 0 && e.textContent.trim().length > 2 && e.getBoundingClientRect().width < 20 && e.scrollWidth > e.clientWidth + 2) out.push(['squashed', path(e), Math.round(e.getBoundingClientRect().width)]); }
    if (!vis(e)) continue;
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    // a) horizontal clipping (an ellipsis is a choice, not a defect)
    if (/(hidden|clip)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 2 && cs.textOverflow !== 'ellipsis') {
      const kids = [...e.children].filter(vis);
      const ell = kids.length && kids.every((k) => getComputedStyle(k).textOverflow === 'ellipsis');
      if (!ell) out.push(['clipX', path(e), e.scrollWidth - e.clientWidth]);
    }
    // a3) a button or a text line cut by a clipping parent (a button counts even when fully hidden;
    //     a list row fully below the box is a choice, a half-cut row is a defect)
    {
      const isBtn = /^(BUTTON|INPUT|SELECT|A)$/.test(e.tagName);
      const isText = !isBtn && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !/^inline/.test(cs.display);
      if (isBtn || isText) {
        for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
          const c = getComputedStyle(x);
          if (c.display === 'contents') continue; // a display: contents box has no box, so it clips nothing
          if (/(auto|scroll)/.test(c.overflowY + c.overflowX)) break; // reachable by scrolling
          if (/(hidden|clip)/.test(c.overflowY + c.overflowX)) {
            const pr = x.getBoundingClientRect();
            const partY = r.top < pr.bottom - 1 && r.bottom > pr.bottom + 2, fullY = r.top >= pr.bottom - 1;
            const partX = r.left < pr.right - 1 && r.right > pr.right + 2;
            if (partY || partX || (isBtn && fullY)) out.push([isBtn ? 'cutBtn' : 'cutText', path(e) + '  in ' + name(x), Math.round(Math.max(r.bottom - pr.bottom, r.right - pr.right))]);
            break;
          }
        }
      }
    }
    // a1) text that spills out of a box that does not clip it (PLAYER running into POWER)
    if (cs.overflowX === 'visible' && !/^inline/.test(cs.display) && e.textContent.trim() && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.scrollWidth > e.clientWidth + 3) out.push(['spill', path(e), e.scrollWidth - e.clientWidth]);
    // a2) text squashed by an ellipsis to almost nothing (a name column at 0 px)
    if (cs.textOverflow === 'ellipsis' && e.textContent.trim().length > 2 && e.clientWidth < 34 && e.scrollWidth > e.clientWidth + 2) out.push(['squashed', path(e), e.clientWidth]);
    // b) siblings in one flex/grid container that overlap
    if (/(flex|grid)/.test(cs.display)) {
      const kids = [...e.children].filter((k) => vis(k) && !/(absolute|fixed)/.test(getComputedStyle(k).position));
      // b2) a child that pokes out past the right or bottom edge of its flex/grid box
      for (const k of kids) { const kr = k.getBoundingClientRect(); const d = Math.max(kr.right - r.right, kr.bottom - r.bottom); if (d > 3 && /(visible)/.test(cs.overflow)) out.push(['pokeOut', path(k) + '  past ' + name(e), Math.round(d)]); }
      // b3) a shop card's absolute mark (the New chip) wider than its card: sticks out past the card's left or right edge (UI-43)
      if (e.classList.contains('u3-shopitem')) for (const k of [...e.children].filter((x) => vis(x) && getComputedStyle(x).position === 'absolute')) { const kr = k.getBoundingClientRect(); const d = Math.max(r.left - kr.left, kr.right - r.right); if (d > 1) out.push(['pokeOut', path(k) + '  past ' + name(e), Math.round(d)]); }
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 3 && oy > 3) out.push(['overlap', path(kids[i]) + '  ~  ' + name(kids[j]), Math.round(ox)]);
      }
    }
    // c) a box outside the window that no clipping parent hides
    if ((r.right > vw + 2 || r.left < -2 || r.bottom > vh + 2) && cs.position !== 'fixed') {
      let hidden = false;
      for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
        const c = getComputedStyle(x);
        if (/(hidden|clip|auto|scroll)/.test(c.overflow)) { const pr = x.getBoundingClientRect(); if (pr.right <= vw + 2 && pr.bottom <= vh + 2 && pr.left >= -2) { hidden = true; break; } }
      }
      if (!hidden) out.push(['offscreen', path(e), Math.round(Math.max(r.right - vw, r.bottom - vh, -r.left))]);
    }
  }
  const seen = new Set();
  return out.filter((o) => !(o[0] === 'overlap' && o[1].includes('.lb-place'))).filter((o) => { const k = o[0] + o[1]; if (seen.has(k)) return false; seen.add(k); return true; });
}
