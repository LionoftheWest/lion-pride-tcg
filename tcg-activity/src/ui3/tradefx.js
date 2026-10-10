// UI-26: the trade animation (docs/design.md 4.11; design repo UI-26/approved). The flag ui_v3 only: with the flag off the
// v2 animation (src/ui-v2-tradefx.js) plays. Three frames: the start (both cards and the swap badge, GIVE and GET), the
// swap (the card you get, "Trade complete", its name and rarity), and the landed state (the layer is gone: Pending without
// the accepted offer). The first part is pure (unit-tested): the phases and their timing, made from the motion tokens.
// The DOM glue (playTradeFxV3) is at the end. CSS: public/ui3/90-ui-26.css.
import { esc } from './components.js';
import { icon } from './icons.js';
import { TOKENS } from '../tokens.js';
import { revealThumb } from '../thumb.js';

const HOT = new Set(['secret_rare', 'full_art', 'gold', 'event']);

/** The timeline in ms, from the motion tokens. start = the cards enter and rest, swap = the card you get crosses to the center
 *  (a fade under reduced motion), tap = a tap closes from here on, close = the automatic close, gone = the layer is removed.
 *  Reduced motion (4.11): each movement is a fade of 200 ms or less, so the swap and the close are the same moments. */
export function timeline({ reduced = false } = {}) {
  const T = TOKENS;
  const swap = T['dur-celebrate'];
  const land = swap + (reduced ? T['dur-base'] : T['dur-reveal']);
  const close = land + T['dur-celebrate'] * 3;
  return { start: 0, enter: reduced ? T['dur-base'] : T['dur-slow'], swap, land, tap: land + T['dur-slow'], close, gone: close + T['dur-base'] };
}

/** The phase at a time t (ms after the layer opened): pre, start, swap, land, out, gone. */
export function phaseAt(t, tl) {
  if (t < tl.start) return 'pre';
  if (t < tl.swap) return 'start';
  if (t < tl.land) return 'swap';
  if (t < tl.close) return 'land';
  if (t < tl.gone) return 'out';
  return 'gone';
}

/** The rarity class of a card (an unknown rarity gets the normal look). */
export const rarityKey = (r) => (['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold', 'event', 'promo'].includes(r) ? r : 'normal');

/** The sound of the swap: a rare card gets the rare sound. */
export const swapSound = (rarity) => (HOT.has(rarity) ? 'rare' : 'flip');

/** The markup of the layer. give and get are { name, rarity, image_url }; label(rarity) is the rarity word. */
export function layerHTML({ give, get, label }) {
  const card = (c, side) => `<div class="u3-tfx__card u3-tfx__card--${side} u3-tfx-r-${rarityKey(c.rarity)}"><img src="${esc(revealThumb(c.image_url))}" alt="${esc(c.name)}"></div>`;
  return `<div class="u3-tfx__stage">${card(give, 'give')}${card(get, 'get')}<span class="u3-tfx__badge">${icon('arrow-left-right', { size: 'lg' })}</span></div>`
    + '<div class="u3-tfx__under"><div class="u3-tfx__tags"><span>Give</span><span>Get</span></div>'
    + `<div class="u3-tfx__done u3-tfx-r-${rarityKey(get.rarity)}" role="status"><span class="u3-tfx__k">Trade complete</span><b class="u3-tfx__name">${esc(get.name)}</b><span class="u3-tfx__rar">${esc(label(get.rarity))}</span></div></div>`;
}

// ---- DOM glue ----
/** Plays the animation; resolves when the layer is gone. A tap (after the swap) or the close time ends it. */
export function playTradeFxV3({ give, get, label, sfx }) {
  return new Promise((done) => {
    document.getElementById('u3Tfx')?.remove();
    // Reduced motion is a media preference, not a size or a layout decision.
    const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const tl = timeline({ reduced });
    const n = document.createElement('div');
    n.id = 'u3Tfx';
    n.className = 'u3-tfx';
    n.dataset.phase = 'pre';
    n.innerHTML = layerHTML({ give, get, label });
    document.body.appendChild(n);
    const timers = [];
    const at = (ms, f) => timers.push(setTimeout(f, ms));
    let closed = false;
    const onKey = (e) => { if (e.key === 'Escape' && n.dataset.phase !== 'start') close(); };
    const close = () => {
      if (closed) return;
      closed = true;
      timers.forEach(clearTimeout);
      document.removeEventListener('keydown', onKey);
      n.dataset.phase = 'out';
      setTimeout(() => { n.remove(); done(); }, tl.gone - tl.close);
    };
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!closed) { n.dataset.phase = 'start'; sfx?.('page'); } }));
    at(tl.swap, () => { n.dataset.phase = 'swap'; sfx?.(swapSound(get.rarity)); });
    at(tl.land, () => { n.dataset.phase = 'land'; });
    at(tl.tap, () => { n.addEventListener('click', close); document.addEventListener('keydown', onKey); });
    at(tl.close, close);
  });
}
