// The walkthrough check (UI-37), run only on a spec with walk: true. The other checks skip #tutLayer (the v2 card was
// outside their rules), so this one measures the v3 card itself (design.md 2.3, 3.3, 9.1; UI-37 approval: "a step card never
// covers its spotlighted control and never sits in the Discord corner zone"). It returns [rule, where, value] rows that
// evaluate.mjs turns into defects with the rules of the other checks (overlap, corner-safe, covered, tap, bleed, small-text).
// A missing card is a row too: a walkthrough that did not open must not pass as "nothing found".
(args) => {
  const vw = innerWidth, vh = innerHeight, touch = !!(args && args.touch);
  const rows = [];
  const layer = document.getElementById('tutLayer');
  const card = layer && layer.querySelector('.u3-wt__card');
  const spot = layer && layer.querySelector('.u3-wt__spot');
  if (!card || !spot) return [['missing', '#tutLayer .u3-wt__card', 'the walkthrough did not open']];
  const R = (e) => e.getBoundingClientRect();
  const c = R(card), s = R(spot);
  const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
  const px = (n) => parseFloat(getComputedStyle(document.body).getPropertyValue(n)) || 0;
  const f = { l: px('--u3-sa-l'), t: px('--u3-sa-t'), r: px('--u3-sa-r'), b: px('--u3-sa-b') };
  const label = (layer.querySelector('.u3-wt__step') || {}).textContent || '';
  if (!/^STEP \d+ OF \d+$/.test(label.trim())) rows.push(['bleed', '.u3-wt__step', 'the step label is "' + label.trim() + '"']);
  // the card in the usable frame
  if (c.left < f.l - 0.5 || c.top < f.t - 0.5 || c.right > vw - f.r + 0.5 || c.bottom > vh - f.b + 0.5)
    rows.push(['bleed', 'offscreen: .u3-wt__card', Math.round(c.left) + ',' + Math.round(c.top) + ',' + Math.round(c.right) + ',' + Math.round(c.bottom)]);
  // the card never covers the spotlighted control (the ring box) ...
  if (hit(c, s)) rows.push(['overlap', '.u3-wt__card over the spotlighted control', Math.round(s.left) + ',' + Math.round(s.top) + ',' + Math.round(s.width) + 'x' + Math.round(s.height)]);
  // ... and never sits in the Discord corner zone (the right 120 of the top 60)
  if (hit(c, { left: vw - 120, top: 0, right: vw, bottom: 60 })) rows.push(['corner-safe', 'corner zone: .u3-wt__card', Math.round(c.left) + ',' + Math.round(c.top)]);
  // ... and covers no control of the shell (top bar, dock) other than the spotlighted one
  for (const e of document.querySelectorAll('#topbar button, #dock button, #dockOpen')) {
    const r = R(e); if (r.width < 2 || r.height < 2 || hit(r, s)) continue;
    if (hit(c, r)) rows.push(['covered', '.u3-wt__card over ' + (e.id ? '#' + e.id : e.getAttribute('data-view') || e.className), 'covers a shell control']);
  }
  // Skip and Next: 44 px on touch (9.1); the text is whole inside the card
  for (const b of card.querySelectorAll('button')) {
    const r = R(b);
    if (touch && (r.width < 43.5 || r.height < 43.5)) rows.push(['tap', '.u3-wt__card button[data-wt=' + b.getAttribute('data-wt') + ']', Math.round(r.width) + 'x' + Math.round(r.height)]);
    if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.bottom > c.bottom + 0.5) rows.push(['bleed', 'offscreen: .u3-wt__card button[data-wt=' + b.getAttribute('data-wt') + ']', 'outside the card']);
  }
  const nm = (e) => '.' + (String(e.className).split(/\s+/)[0] || e.tagName.toLowerCase());
  for (const e of card.querySelectorAll('*')) {
    if (e.classList.contains('u3-wt__arrow')) continue;   // the tip sits on the card edge by design
    const r = R(e);
    if (r.right > c.right + 0.5 || r.bottom > c.bottom + 0.5 || r.left < c.left - 0.5) rows.push(['bleed', 'clipped: ' + nm(e), 'outside the card']);
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1) && fs < 11) rows.push(['small-text', nm(e), fs + 'px']);
  }
  return rows;
}
