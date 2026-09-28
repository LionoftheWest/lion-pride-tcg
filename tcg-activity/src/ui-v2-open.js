// Opening several packs at once (design/17-*, approved 2026-09-27): the chooser above the
// dock (x1 / x5 / x10, only what the member can afford) and the multi-pack reveal
// (every card face-down with the REAL card back, the rarest first, tap to flip or
// Reveal all, a celebration for Secret Rare and better, a New tag for first cards).

const RANK = { normal: 0, illustrated_rare: 1, secret_rare: 2, full_art: 3, gold: 4, event: 3, promo: 2 };
let d = null; // { el, esc, SFX, RARITY_LABEL, cardBack, onClose }

export function openChooser(deps, packs, onPick) {
  d = deps;
  const { el } = d;
  let box = el('openChooser');
  if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="openChooser" class="v2-chooser hidden"></div>'); box = el('openChooser'); }
  if (!box.classList.contains('hidden')) { closeChooser(); return; }
  const opt = (n) => `<button class="ch-opt${n === Math.max(...[1, 5, 10].filter((x) => x <= packs)) ? ' best' : ''}" data-n="${n}" ${n > packs ? 'disabled' : ''}>
      <span class="ch-stack s${Math.min(n, 3)}">${'<img src="/pack_still.png?v=2" alt="">'.repeat(Math.min(n, 3))}</span><b><i>×</i>${n}</b></button>`;
  box.innerHTML = `<div class="ch-head"><b>Open packs</b><span class="ch-count">🎴 <b>${packs}</b> packs</span></div>
    <div class="ch-opts">${[1, 5, 10].filter((n) => n <= packs).map(opt).join('')}</div>`;
  box.classList.remove('hidden');
  box.onclick = (e) => { const b = e.target.closest('.ch-opt'); if (b && !b.disabled) { closeChooser(); onPick(Number(b.dataset.n)); } };
  setTimeout(() => document.addEventListener('pointerdown', outside, { capture: true }), 0);
}
function outside(e) {
  const box = d?.el('openChooser');
  if (box && !box.contains(e.target) && !e.target.closest('#dockOpen')) closeChooser();
}
export function closeChooser() {
  d?.el('openChooser')?.classList.add('hidden');
  document.removeEventListener('pointerdown', outside, { capture: true });
}

// ---- The multi-pack reveal ----
let items = [];
let flipped = 0;

export function showMultiReveal(deps, packs) {
  d = deps;
  const { el, esc } = d;
  items = packs.flat().map((c) => ({ ...c })).sort((a, b) => (RANK[b.rarity] ?? 0) - (RANK[a.rarity] ?? 0) || (b.isNew - a.isNew));
  flipped = 0;
  const stage = el('stage');
  stage.className = 'open v2-multi';
  // Nathan: the cards are the whole window (no pack panel), and no "N NEW" count
  // before the flip; each card still shows NEW once it turns over.
  stage.innerHTML = `<div class="mr-wrap full">
    <section class="mr-main">
      <div class="mr-head"><h2>${items.length} cards</h2><span class="grow"></span>
        <span class="mr-flip mono" id="mrFlip">0 / ${items.length}</span>
        <button class="v2-btn gold" id="mrAll">Reveal all</button><button class="v2-icon" id="mrClose" aria-label="Close">✕</button></div>
      <div class="mr-grid" id="mrGrid">${items.map((c, i) => `<button class="mr-card r-${c.rarity}${(RANK[c.rarity] ?? 0) >= 2 ? ' hot' : ''}" data-i="${i}">
          <span class="mr-in"><span class="mr-face mr-back"><img src="${esc(d.cardBack())}" alt=""></span>
          <span class="mr-face mr-front"><img src="${c.image_url || ''}" alt="${esc(c.name)}">${c.isNew ? '<i class="mr-newtag">NEW</i>' : ''}</span></span></button>`).join('')}</div>
    </section>
  </div>`;
  fit();
  d.SFX?.play?.('reveal');
  el('mrGrid').addEventListener('click', (e) => { const b = e.target.closest('.mr-card'); if (b) flip(b); });
  el('mrAll').addEventListener('click', revealAll);
  el('mrClose').addEventListener('click', close);
  window.addEventListener('resize', fit);
}

// The biggest 5:7 card size that shows every card with no scrolling.
function fit() {
  const grid = d?.el('mrGrid');
  if (!grid) return;
  const w = grid.clientWidth, h = grid.clientHeight, n = items.length, gap = 8;
  let best = { cw: 40, cols: n };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = Math.floor(Math.min((w - (cols - 1) * gap) / cols, ((h - (rows - 1) * gap) / rows) * 5 / 7));
    if (cw > best.cw) best = { cw, cols };
  }
  grid.style.setProperty('--mw', `${best.cw}px`);
  grid.style.setProperty('--mc', best.cols);
}

function flip(b) {
  if (b.classList.contains('up')) return;
  b.classList.add('up');
  flipped += 1;
  const c = items[Number(b.dataset.i)];
  if ((RANK[c.rarity] ?? 0) >= 2) { b.classList.add('mr-burst'); d.SFX?.play?.('rare'); } else d.SFX?.play?.('flip');
  d.el('mrFlip').textContent = `${flipped} / ${items.length}`;
  if (flipped === items.length) { const a = d.el('mrAll'); a.textContent = 'Done'; a.onclick = close; a.removeEventListener('click', revealAll); }
}
function revealAll() {
  const rest = [...d.el('mrGrid').querySelectorAll('.mr-card:not(.up)')];
  rest.forEach((b, i) => setTimeout(() => flip(b), i * 35));
}
function close() {
  window.removeEventListener('resize', fit);
  const stage = d.el('stage');
  stage.classList.add('closing');
  setTimeout(() => { stage.className = 'hidden'; stage.innerHTML = ''; }, 260);
  d.onClose?.();
}
