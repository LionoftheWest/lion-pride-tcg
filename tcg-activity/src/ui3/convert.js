// UI-44 Convert extra copies (lion-pride-tcg-design UI-44/approved, review-1; D-80). Only under body.ui-v3.
// The pure logic of the window; the window itself is the Shop confirm (shop.js confirmHTML, the library Dialog), and the
// calls stay in ui-v2-shop.js. Every rate (Shards for each copy, the number of extra copies) comes from the server answer
// of /api/shards/convertible (balance shards.dupe_values and convertible_copies): this module holds no rate.

import { stepper } from './components.js';

/** The last ascension step: a card at this step cannot ascend, so the note does not offer it (same rule as v2). */
export const MAX_ASCENSION = 5;

/** The count that the stepper may show: a whole number from 1 to max. */
export function clampCount(n, max) {
  const top = Math.max(1, Math.floor(Number(max) || 1));
  const v = Math.floor(Number(n));
  return Math.min(top, Math.max(1, Number.isFinite(v) ? v : 1));
}

/** The next count after a stepper press (dir is -1 or +1). */
export const stepCount = (n, dir, max) => clampCount(Number(n) + Number(dir), max);

/** The numbers of the window: what you get, and the balance now and after. Nothing here is a fixed rate. */
export function convertTotals({ n, each, balance }) {
  const get = Math.max(0, Number(n) || 0) * Math.max(0, Number(each) || 0);
  const now = Number(balance) || 0;
  return { get, now, after: now + get };
}

/** The keep note: the server keeps one copy; the second sentence shows while the card can still ascend. */
export function keepNote(card) {
  return `You keep 1 copy.${(card?.ascension || 0) < MAX_ASCENSION ? ' These copies can also ascend this card.' : ''}`;
}

/** The quantity block of the window: the label and the rate on the left, the Stepper with its limits on the right. */
export const convertControl = ({ n, max, each }) => `<div class="u3-scvt"><div class="u3-scvt__text"><b class="u3-scvt__label">Copies to convert</b>`
  + `<span class="u3-scvt__each">${Number(each).toLocaleString('en-US')} Shards each</span></div>${stepper({ value: n, min: 1, max })}</div>`;

/** The server answer of /api/shards/convertible as a modal state, or null when nothing can convert. */
export function convertState(r, card) {
  if (!r || !(r.count > 0) || !(r.each > 0)) return null;
  return { kind: 'convert', card, max: Math.floor(r.count), each: Number(r.each), n: Math.floor(r.count) };
}
