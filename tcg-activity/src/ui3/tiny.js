// UI-59 Small live view (v3 only, body.ui-v3, the tiny size class: Discord picture-in-picture, design.md 2.1, D-06).
// The markup and the pure logic of the one view of the tiny window: the live Hunt (boss, HP, the OPEN mark, Open full), the
// resting Hunt (the last boss, Next boss in) and no Hunt (the pack count and Open full only). There is no typing in this window
// (D-138). All styles are public/ui3/90-ui-59.css (tokens only). ui-v2.js paints it and wires Open full.
import { icon } from './icons.js';
import { button, counter, progressSegmented, esc } from './components.js';
import { breakable } from '../effects-ui.js';

export const tinyV3 = (body = globalThis.document?.body) => !!body && body.classList.contains('ui-v3') && body.dataset.size === 'tiny';

/** The state of the view from the /api/hunt answer: live (a hunt runs), rest (a last boss shows), none (no boss to show). */
export function tinyState(d) {
  if (d?.hunt) return 'live';
  return d?.lastResult ? 'rest' : 'none';
}

/** The HP percent, 0 to 100, from the hunt row. */
export function hpPercent(hunt) {
  const max = Number(hunt?.hp_max) || 0;
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((100 * (Number(hunt.hp_remaining) || 0)) / max)));
}

/** The lit HP segments as a fraction for the segment bar (the frame: 21 percent lights 3 of 10, so the last part of a segment counts). */
export const litFraction = (pct, segments = 10) => Math.ceil(Math.max(0, Math.min(100, pct)) / (100 / segments)) / segments;

export const TINY_MODES = ['is-tight', 'is-tighter'];
/** Keep the view inside the window (design.md 3.3): when the right column is taller than the window (a long boss name wraps to
 *  more lines), the layout mode is-tight (smaller type and disc), then is-tighter (the smallest). Measured on the elements (F-1).
 *  Returns the mode that stays ('' = the normal layout). */
export function fitTiny(root) {
  const view = root?.querySelector?.('.u3-tn');
  const info = view?.querySelector('.u3-tn__info');
  if (!view || !info) return '';
  view.classList.remove(...TINY_MODES);
  const over = () => info.scrollHeight > info.clientHeight + 1 || info.scrollWidth > info.clientWidth + 1 || view.scrollHeight > view.clientHeight + 1;
  let mode = '';
  for (const m of ['', ...TINY_MODES]) {
    if (m) view.classList.add(m);
    mode = m;
    if (!over()) break;
  }
  return mode;
}

/** The OPEN mark: a disc with the count badge (count only, no tap, D-80). It is dim when no pack waits. */
export function openMarkHTML(packs) {
  const n = Math.max(0, Number(packs) || 0);
  return `<span class="u3-tn__open${n ? '' : ' is-empty'}" role="img" aria-label="${n} pack${n === 1 ? '' : 's'} to open">`
    + `<span class="u3-tn__disc">${icon('package', { size: 'xl' })}<span class="u3-tn__openl">Open</span></span>`
    + `${n ? `<span class="u3-tn__count">${counter(n)}</span>` : ''}</span>`;
}

const actionHTML = (packs) => `<div class="u3-tn__act">${openMarkHTML(packs)}${button({ label: 'Open full', variant: 'primary', data: { tnfull: '1' } })}</div>`;

/** The whole view. d = the /api/hunt answer, h = { packs, hasModel }. */
export function tinyHTML(d, h = {}) {
  const st = tinyState(d);
  if (st === 'none') return `<div class="u3-tn is-none"><div class="u3-tn__info">${actionHTML(h.packs)}</div></div>`;
  if (st === 'live') {
    const hunt = d.hunt;
    const pct = hpPercent(hunt);
    return `<div class="u3-tn is-live"><div class="u3-tn__stage"><div class="u3-hm-boss"><canvas id="heroCanvas"></canvas></div></div><div class="u3-tn__info">`
      + `<span class="u3-hm-chip is-live"><i class="u3-hm-livedot"></i>The Hunt · Live now</span><h2 class="u3-hm-title u3-tn__title">${breakable(esc(hunt.name))}</h2>`
      + `<div class="u3-hm-hp"><span>${pct}% HP</span><span class="u3-hm-mono" data-closes="${esc(hunt.closes_at)}"></span></div>${progressSegmented({ value: litFraction(pct) })}`
      + `${actionHTML(h.packs)}</div></div>`;
  }
  const last = d.lastResult;
  const won = last.status === 'defeated';
  const stage = h.hasModel ? '<div class="u3-tn__stage"><div class="u3-hm-boss"><canvas id="restCanvas"></canvas></div></div>' : '';
  const next = d.nextSpawnAt ? `<div class="u3-hm-next"><span>Next boss in</span><b data-until="${esc(d.nextSpawnAt)}"></b></div>` : '';
  return `<div class="u3-tn is-rest${stage ? '' : ' is-nostage'}">${stage}<div class="u3-tn__info">`
    + `<span class="u3-hm-chip">The Hunt · Resting</span><h2 class="u3-hm-title u3-tn__title">${breakable(esc(last.name))}</h2>`
    + `<span class="u3-hm-res ${won ? 'is-won' : 'is-lost'}">${icon(won ? 'trophy' : 'skull')}<span>${won ? 'Defeated by the pride' : 'Escaped'}</span></span>`
    + `${next}${actionHTML(h.packs)}</div></div>`;
}
