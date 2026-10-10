// UI-30 Trade Hall (v3, body.ui-v3 only): the pure rules of the Hall lists (Wanted, For trade). Approved: design repo
// UI-30/approved (review-1, review-2), decisions D-67 and D-80 item 21. ui-v2-hall.js paints the HTML and keeps every
// handler and API call; this module holds what a test can check: the one switch, the filters (no counts, no "Can ascend",
// D-80 item 21), the search, the empty texts and the pager state.
import { segmented } from './components.js';

/** The one switch (D-67 item 1): Wanted, For trade and Auctions, with the UI-00 line icons (Nathan, Shell review 2026-10-08). */
export const HALL_SWITCH = [
  { id: 'wanted', label: 'Wanted', icon: 'heart' },
  { id: 'fortrade', label: 'For trade', icon: 'tag' },
  { id: 'auctions', label: 'Auctions', icon: 'gavel' },
];
/** The id of the active segment: the Auctions list, else the Trade Hall list that shows. */
export const activeSwitch = (sub, view) => (sub === 'auctions' ? 'auctions' : view === 'fortrade' ? 'fortrade' : 'wanted');
/** The state a segment sets: { sub, view }. Auctions keeps the Trade Hall view for the way back. */
export const switchTarget = (id, view) => (id === 'auctions' ? { sub: 'auctions', view } : { sub: 'hall', view: id === 'fortrade' ? 'fortrade' : 'wanted' });
export const switchHTML = (sub, view) => segmented(HALL_SWITCH.map((s) => ({ ...s, active: s.id === activeSwitch(sub, view) })), { label: 'Trade Hall lists' });

/** The Filters panel of the Trade Hall = the Collection Filters panel (D-67 item 10) with no counts and no "Can ascend" (D-80 item 21). */
export const OWN_OPTIONS = [['all', 'All'], ['owned', 'Owned'], ['missing', 'Missing']];
export const RARITY_CHIPS = [['normal', 'Normal'], ['illustrated_rare', 'Illustrated Rare'], ['secret_rare', 'Secret Rare'], ['full_art', 'Full Art'], ['gold', 'Gold']];
export const TYPE_CHIPS = [['character', 'Character'], ['creature', 'Creature'], ['moment', 'Moment'], ['item', 'Item'], ['place', 'Place']];
export const GAME_CHIPS = [['smash', 'Smash Bros'], ['pokemon', 'Pokemon'], ['party', 'Party'], ['minecraft', 'Minecraft'], ['meme', 'Memes'], ['community', 'Community']];
export const NO_FILTERS = Object.freeze({ own: 'all', rarity: null, element: null, type: null, game: null });
/** The number on the Filters button: the groups that narrow the list. */
export const filterCount = (f = NO_FILTERS) => ['rarity', 'element', 'type', 'game'].filter((k) => f[k]).length + (f.own && f.own !== 'all' ? 1 : 0);
/** A tap on a chip: it turns the group on, a second tap turns it off. */
export const toggleFilter = (f, key, value) => ({ ...f, [key]: f[key] === value ? null : value });

/**
 * The listings the search and the Filters leave. list = [{ card, name (the member), ... }]. tagsOf(card) -> the tags of the
 * catalog card (the listing has none), elementOf(tags) -> the element key, owns(card) -> the member owns a copy.
 */
export function applyHall(list, { q = '', filters = NO_FILTERS, tagsOf = () => ({}), elementOf = () => null, owns = () => false } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return list.filter((x) => {
    const c = x.card || {};
    const t = tagsOf(c) || {};
    if (filters.rarity && c.rarity !== filters.rarity) return false;
    if (filters.element && elementOf(t) !== filters.element) return false;
    if (filters.type && t.type !== filters.type) return false;
    if (filters.game && ![].concat(t.origin || []).includes(filters.game)) return false;
    if (filters.own === 'owned' && !owns(c)) return false;
    if (filters.own === 'missing' && owns(c)) return false;
    if (needle) {
      const hay = [c.name, x.name, t.type, t.class, t.origin, ...(t.traits || []), ...(t.genre || [])].flat().filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/** The empty state: a search or a filter with no result differs from a first-use empty (7.2, UI-30 review-1 item 9). */
export function emptyState(view, { q = '', filters = NO_FILTERS } = {}) {
  if (String(q || '').trim() || filterCount(filters)) return { title: 'No cards match.', line: null };
  return view === 'fortrade' ? { title: 'No cards are listed yet.', line: 'List one with Manage my listings.' }
    : { title: 'No member has a wishlist yet.', line: 'Set yours with My wishlist.' };
}

/** A Wanted card the member owns no copy of shows the Not owned recipe (4.9); a For trade card never does. */
export const notOwned = (view, it) => view === 'wanted' && !it.yours && Number(it.mine) === 0;

/** The page after a pager tap or a swipe, kept inside the pages. */
export const clampPage = (page, pages) => Math.min(Math.max(0, page | 0), Math.max(1, pages | 0) - 1);
export const pagesOf = (n, per) => Math.max(1, Math.ceil(n / Math.max(1, per)));

/** The Manage my listings label with its limit (10.3 decision fact "2/5"). */
export const manageLabel = (n) => `Manage my listings ${n | 0}/5`;

/**
 * When every card fits one page, the largest tile (up to max) that still shows them all in the box: the cards fill the
 * area instead of the 88 px minimum (8.1). Returns { cols, rows, tile } or null when no tile of min or more fits them all.
 */
export function fitAll(n, width, height, gap, { min, max, ratio }) {
  if (!(n > 0 && width > 0 && height > 0)) return null;
  for (let tile = Math.floor(max); tile >= min; tile--) {
    const cols = Math.max(1, Math.floor((width + gap) / (tile + gap)));
    const rows = Math.ceil(n / cols);
    if (rows * (tile * ratio + gap) - gap <= height) return { cols, rows, tile };
  }
  return null;
}
