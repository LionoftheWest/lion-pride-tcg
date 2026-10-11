// UI-31 Offer on a listing and List a card (v3, body.ui-v3 only): the pure rules. Approved: design repo UI-31/approved
// (review-1, review-2); decisions D-64 item 7, D-67 items 5, 6 and 7, D-80 item 21.
// - An offer on a Hall listing opens the Trade window (UI-63) with the card chosen: no separate composer.
// - List a card: the five slots of "Your listings", the Card picker (UI-64, pick one) to add one, an X to take one off with Undo.
// ui-v2-hall.js paints the HTML and keeps every handler and API call (the server rules stay in src/hall-routes.js).

/** A member can list 5 cards at a time (hall-routes.js, list_for_trade). */
export const LIST_MAX = 5;
const RANK = { normal: 0, illustrated_rare: 1, secret_rare: 2, promo: 2, full_art: 3, event: 3, gold: 4 };

/** The five slots: each is the listing in it or null (an empty slot with a plus). */
export const slotsOf = (listings, max = LIST_MAX) => Array.from({ length: max }, (_, i) => (listings || [])[i] || null);

/** The free copies of a card: the copies I own less the ones a listing or an offer holds. */
export const freeOf = (card, held = {}) => Math.max(0, Number(card?.quantity || 0) - Number(held[card?.id] || 0));

/**
 * The cards the picker offers: tradeable, not Gold, a free copy, not listed already. Duplicates first (D-176: a card with two or
 * more free copies), then best rarity, then the most copies. cards = my collection, listings = my listings ({ card }), held = { cardId: copies held }.
 */
export function listable(cards, listings = [], held = {}) {
  const listed = new Set((listings || []).map((x) => Number(x.card?.id)));
  return (cards || []).filter((c) => c.tradeable !== false && c.rarity !== 'gold' && freeOf(c, held) > 0 && !listed.has(Number(c.id)))
    .sort((a, b) => (freeOf(b, held) > 1) - (freeOf(a, held) > 1) || (RANK[b.rarity] ?? 0) - (RANK[a.rarity] ?? 0) || freeOf(b, held) - freeOf(a, held));
}

/**
 * The size of the five slots in their box (the frames): one row of five or three and two, whichever gives the larger slot with
 * at least `min` width (a slot is as high as it is wide times `ratio`). A box too small for one slot of `min` gets
 * the largest slot that fits. Pure (unit-tested).
 */
export function listFit(width, height, gap, { n = LIST_MAX, min, ratio }) {
  if (!(width > 0 && height > 0)) return { cols: n, rows: 1, tile: min };
  const at = (cols) => {
    const rows = Math.ceil(n / cols);
    return { cols, rows, tile: Math.floor(Math.min((width - gap * (cols - 1)) / cols, ((height - gap * (rows - 1)) / rows) / ratio)) };
  };
  // the frames: one row of five, or three and two (a phone, a tablet); the layout with the larger slot wins
  const ok = [n, Math.ceil(n / 2)].map(at).filter((r) => r.tile >= min);
  if (ok.length) return ok.reduce((a, b) => (b.tile > a.tile ? b : a));
  return Array.from({ length: n }, (_, i) => at(i + 1)).reduce((a, b) => (b.tile > a.tile ? b : a));
}

/** The picker search and the rarity filter. Pure. */
export function applyListPick(cards, values = {}, q = '') {
  const w = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = (c) => [c.name, c.subject, ...(c.tags?.traits || [])].filter(Boolean).join(' ').toLowerCase();
  return (cards || []).filter((c) => (!values.rarity || values.rarity === 'all' || c.rarity === values.rarity) && w.every((x) => text(c).includes(x)));
}
export const listFilterCount = (v = {}) => (v.rarity && v.rarity !== 'all' ? 1 : 0);

/** The texts (10.2): a sentence with a full stop, the card name in the toast. */
export const unlistedText = (name) => `${name || 'The card'} unlisted.`;
export const LIST_FULL = 'You can list 5 cards at a time.';
export const listError = (r) => r?.message || 'Could not list that card.';

/**
 * What the Trade window opens with for a tap on a listing (D-64 item 7, D-80 item 21). A Wanted card: Your cards, the card
 * in GIVE when I own a free copy. A For trade card: Their cards, the card in GET (a Request, D-35). item = the Hall row.
 */
export function offerSeed(view, item) {
  const id = item?.card?.id ?? null;
  if (view === 'fortrade') return { view: 'their', giveId: null, getId: id };
  return { view: 'mine', giveId: Number(item?.mine) > 0 ? id : null, getId: null };
}

/**
 * The call for a Window action on a listing. A Wanted card: the same trade offer as the Trades tab. A For trade card: the
 * server has the one call of the Hall (the lister accepts or declines, hall-routes.js /api/hall/offer), so the Offer of my
 * card goes there with the listing. Gift and pack calls stay as they are. Pure.
 */
export function offerPlan(view, item, plan) {
  if (view === 'fortrade' && plan?.path === '/api/trade/offer') return { path: '/api/hall/offer', body: { listingId: item.id, cardId: plan.body.offerCardId } };
  return plan;
}
