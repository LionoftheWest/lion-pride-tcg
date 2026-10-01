// The trade animation (Nathan, 2026-10-01: "an animation of trading happening and then the
// cards actually being traded"). On Accept the two cards slide in, meet in the middle, swap
// with a burst, and the card the member gets lands in the center. A tap (or 6 s) closes it.
import { thumb } from './thumb.js';

const HOT = new Set(['secret_rare', 'full_art', 'gold', 'event']);

export function playTradeFx({ give, get, esc, label, sfx }) {
  return new Promise((done) => {
    document.getElementById('txLayer')?.remove();
    const card = (c, cls, tag) => `<div class="tx-card ${cls} r-${esc(c.rarity)}"><img src="${thumb(c.image_url)}" alt=""><span class="tx-tag">${tag}</span></div>`;
    const n = document.createElement('div');
    n.id = 'txLayer';
    n.className = 'tx-layer';
    n.innerHTML = `<div class="tx-stage">${card(give, 'give', 'Give')}<div class="tx-burst"><i></i><b>⇄</b></div>${card(get, 'get', 'Get')}</div>
      <div class="tx-done"><span class="tx-k">Trade complete</span><b class="r-${esc(get.rarity)}">${esc(get.name)}</b><span class="tx-r">${esc(label(get.rarity))}</span></div>`;
    document.body.appendChild(n);
    const timers = [];
    const at = (ms, f) => timers.push(setTimeout(f, ms));
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      timers.forEach(clearTimeout);
      n.classList.add('out');
      setTimeout(() => { n.remove(); done(); }, 280);
    };
    requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('in')));
    at(750, () => { n.classList.add('meet'); sfx?.('page'); });
    at(1300, () => { n.classList.add('swap'); sfx?.(HOT.has(get.rarity) ? 'rare' : 'flip'); });
    at(2050, () => n.classList.add('land'));
    at(2400, () => n.addEventListener('click', close));
    at(6000, close);
  });
}
