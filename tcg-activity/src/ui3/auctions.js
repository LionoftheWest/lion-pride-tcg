// UI-32 Auctions (v3, body.ui-v3 only): the pure rules. Approved: design repo UI-32/approved (review-1 to review-3), decisions
// D-67 and D-74. ui-v2-hall.js paints the HTML and keeps every handler and API call; the server rules (bids, the minimum, the 24 h
// confirm) stay in src/hall-routes.js and hall_auctions.sql. This module holds what a test can check: the start rules, the
// minimum lines, the bid cards of the picker, the seller rows and the texts (10.2).

const RANK = { normal: 0, illustrated_rare: 1, secret_rare: 2, promo: 2, full_art: 3, event: 3, gold: 4 };
export const RARITY_NAMES = { normal: 'Normal', illustrated_rare: 'Illustrated Rare', secret_rare: 'Secret Rare', full_art: 'Full Art', promo: 'Promo', event: 'Event', gold: 'Gold' };
export const rarityName = (r) => RARITY_NAMES[r] || String(r || '').replace(/_/g, ' ');
/** A Gold auction takes only these bids (hall_auctions.sql); any other auction takes any card but Gold. */
export const BID_GOLD = ['full_art', 'promo', 'event'];
export const BID_ANY = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'promo', 'event'];
export const bidRarities = (gold) => (gold ? BID_GOLD : BID_ANY);
export const BID_MAX = 5;
export const MIN_MAX = 5;
export const ASK_MAX = 3;
export const DAYS_MIN = 1;
export const DAYS_MAX = 14;
export const DAYS_DEFAULT = 3;

export const TEXT = {
  noneOpen: 'No auctions are open. Start one.', noneMine: 'You have no auctions or bids.', noMatch: 'No cards match.',
  anyButGold: 'Any card but Gold.', goldBids: 'A Gold auction takes Full Art, Promo and Event cards.', noBids: 'No bids yet.',
  withdrawn: 'Bid withdrawn.', closeTitle: 'Close early', closeLine: 'Every bid returns.', startError: 'Could not start the auction.',
  accepted: 'Accepted. The bidder confirms next.', pickCard: 'Pick the card to auction.', anyBid: 'Any bid',
};

// ---- Start an auction --------------------------------------------------------------------------
export const newStart = () => ({ card: null, minRarity: null, minCount: 0, minCards: [], mode: 'and', days: DAYS_DEFAULT, q: '', msg: '' });
export const clampCount = (n) => Math.min(MIN_MAX, Math.max(0, n | 0));
export const clampDays = (n) => Math.min(DAYS_MAX, Math.max(DAYS_MIN, n | 0));
/** The minimum rarity the card asks for when the member has not chosen one: Secret Rare, or Full Art for a Gold auction. */
export const defaultMinRarity = (gold) => (gold ? 'full_art' : 'secret_rare');
/** The state after a card is chosen: the minimum rarity must be one a bid can hold (a Gold auction takes only Full Art, Promo, Event). */
export function chooseCard(st, card) {
  const gold = card?.rarity === 'gold';
  const allowed = bidRarities(gold);
  const minRarity = st.minRarity && allowed.includes(st.minRarity) ? st.minRarity : defaultMinRarity(gold);
  const minCards = (st.minCards || []).filter((x) => allowed.includes(x.rarity));
  return { ...st, card, minRarity, minCards, msg: '' };
}
export const setMinCount = (st, n) => { const minCount = clampCount(n); return { ...st, minCount, minRarity: minCount && !st.minRarity ? defaultMinRarity(st.card?.rarity === 'gold') : st.minRarity }; };
export const startReady = (st) => !!st?.card;
/** The cards a member can ask for: a card a bid can hold whose name has the text, not asked yet, at most `limit`. */
export function askHits(catalog, allowed, q, asked = [], limit = 4) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return [];
  const have = new Set(asked.map((x) => Number(x.id)));
  return (catalog || []).filter((x) => allowed.includes(x.rarity) && String(x.name).toLowerCase().includes(needle) && !have.has(Number(x.id))).slice(0, limit);
}
export const addAsk = (st, card) => (st.minCards.length >= ASK_MAX || st.minCards.some((x) => Number(x.id) === Number(card.id)) ? st : { ...st, minCards: [...st.minCards, card] });
export const removeAsk = (st, id) => ({ ...st, minCards: st.minCards.filter((x) => Number(x.id) !== Number(id)) });
/** The body of POST /api/auction/start (the same fields as the v2 view). */
export const startBody = (st) => ({ cardId: st.card.id, minRarity: st.minCount ? st.minRarity : null, minCount: st.minCount, minCards: st.minCards.map((x) => x.id), mode: st.mode, days: st.days });
const SHORT_DAY = { weekday: 'short' }, SHORT_TIME = { hour: 'numeric', minute: '2-digit' };
export const endsText = (iso, now = Date.now(), prefix = 'ends') => {
  const d = new Date(iso ?? now);
  return `${prefix} ${d.toLocaleDateString(undefined, SHORT_DAY)} ${d.toLocaleTimeString(undefined, SHORT_TIME)}`;
};
export const daysText = (n) => `${n} day${n === 1 ? '' : 's'}`;
/** The cards the start picker offers: the member's free copies, best rarity first (as the v2 view). */
export function startable(cards, held = {}) {
  return (cards || []).filter((c) => Math.max(0, Number(c.quantity || 0) - Number(held[c.id] || 0)) > 0)
    .sort((a, b) => (RANK[b.rarity] ?? 0) - (RANK[a.rarity] ?? 0) || (b.power || 0) - (a.power || 0));
}

// ---- Time and the list -------------------------------------------------------------------------
/** Two largest units: "2d 22h", "5h 3m", "12m"; soon = under a day. */
export function timeLeft(iso, now = Date.now()) {
  const s = Math.max(0, (new Date(iso) - now) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return { text: d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`, soon: s < 86400 };
}
/** The line under an auction card in the list: the time left (or the state) and the bid count. */
export function listCaption(a, now = Date.now()) {
  const waitMe = a.status === 'accepted' && a.myBid && !a.mine;
  if (a.status === 'live') { const t = timeLeft(a.ends_at, now); return { kind: t.soon ? 'soon' : 'live', text: t.text, bids: a.bids | 0 }; }
  if (waitMe) return { kind: 'confirm', text: 'Confirm', bids: a.bids | 0 };
  return { kind: 'done', text: a.status === 'accepted' ? 'Accepted' : a.status === 'sold' ? 'Sold' : 'Ended', bids: a.bids | 0 };
}
/**
 * When every auction fits one page, the largest tile (up to max) that still shows them all in the box; each cell is the card with its caption
 * (extra px) under it. Returns { cols, rows, tile } or null when no tile of min or more fits them all. Pure.
 */
export function fitAllWithCaption(n, width, height, gap, { min, max, ratio, extra = 0 }) {
  if (!(n > 0 && width > 0 && height > 0)) return null;
  for (let tile = Math.floor(max); tile >= min; tile--) {
    const cols = Math.max(1, Math.floor((width + gap) / (tile + gap)));
    const rows = Math.ceil(n / cols);
    if (rows * (tile * ratio + extra + gap) - gap <= height) return { cols, rows, tile };
  }
  return null;
}
/** The search and the Filters over the auctions (the card, the seller): the shape of src/ui3/hall.js applyHall (rows have .card and .name). */
export const asRows = (list) => (list || []).map((a) => ({ ...a, name: a.seller }));
export const emptyText = (view, filtered) => (filtered ? TEXT.noMatch : view === 'mine' ? TEXT.noneMine : TEXT.noneOpen);
/** From the bell's Confirm: the auction that waits for me (accepted, my bid, not mine). */
export const waitingForMe = (list) => (list || []).find((a) => a.status === 'accepted' && a.myBid && !a.mine) || null;

// ---- The minimum, the bids ---------------------------------------------------------------------
/** The lines of a minimum: the count line, then each asked card; each line after the first starts with "or" or "+". */
export function minLines(min) {
  const lines = [];
  if (min?.count > 0 && min.rarity) lines.push({ kind: 'count', count: min.count, rarity: min.rarity });
  for (const c of min?.cards || []) lines.push({ kind: 'card', card: c });
  const lead = min?.mode === 'or' ? 'or' : '+';
  return lines.map((l, i) => ({ ...l, lead: i ? lead : '' }));
}
/** The counts of a bid by rarity, best rarity first: [{ n, rarity }]. */
export function bidTotals(cards) {
  const by = {};
  for (const c of cards || []) by[c.rarity] = (by[c.rarity] || 0) + 1;
  return Object.entries(by).sort((a, b) => (RANK[b[0]] ?? 0) - (RANK[a[0]] ?? 0)).map(([rarity, n]) => ({ n, rarity }));
}
/** The same rule as auction_meets() in SQL, for the live "meets" mark while picking (the server decides). */
export function meetsMinimum(a, cards) {
  const m = a?.min || {};
  const n = (cards || []).filter((c) => m.rarity && (RANK[c.rarity] ?? 0) >= (RANK[m.rarity] ?? 0)).length;
  const countOk = !m.count || !m.rarity || n >= m.count;
  const ids = new Set((cards || []).map((c) => Number(c.id)));
  const cardsOk = !(m.cards || []).length || m.cards.every((c) => ids.has(Number(c.id)));
  if (m.mode === 'or' && m.count > 0 && m.rarity && (m.cards || []).length) return countOk || cardsOk;
  return countOk && cardsOk;
}
export const closedText = (a) => (a.status === 'accepted' ? 'The seller accepted a bid. Bids are closed.' : a.status === 'sold' ? 'This auction is sold.' : 'This auction ended.');
/** The copies of a card a bid can use: free copies plus the copies my own bid holds. */
export const bidCopies = (card, held = {}, myBidCards = []) => Math.max(0, Number(card?.quantity || 0) - Number(held[card?.id] || 0)) + (myBidCards || []).filter((x) => Number(x.id) === Number(card?.id)).length;

/**
 * The cards of the bid picker (D-67 item 5): the cards a bid can hold, the seller's wishlist cards and the asked cards first, then the
 * best rarity. mark = 'wish' for a card on the seller's wishlist (the heart; only the heart is drawn, a card that is also asked shows it).
 */
export function bidCards(owned, a, { held = {}, myBidCards = [], sellerWish = [] } = {}) {
  const allowed = bidRarities(a?.card?.rarity === 'gold');
  const asked = new Set((a?.min?.cards || []).map((x) => Number(x.id)));
  const wish = new Set((sellerWish || []).map(Number));
  return (owned || []).filter((c) => allowed.includes(c.rarity) && bidCopies(c, held, myBidCards) > 0)
    .map((c) => ({ ...c, mark: wish.has(Number(c.id)) ? 'wish' : '', _first: asked.has(Number(c.id)) || wish.has(Number(c.id)) }))
    .sort((x, y) => (Number(y._first) - Number(x._first)) || (RANK[y.rarity] ?? 0) - (RANK[x.rarity] ?? 0));
}
/** The bid state after the picker confirms: the ids in pick order, at most BID_MAX. */
export const setBid = (ids) => (ids || []).map(Number).slice(0, BID_MAX);
/** The status mark of a bid: 'meets', 'below' or '' (no cards). */
export const bidStatus = (a, cards) => (cards.length ? (meetsMinimum(a, cards) ? 'meets' : 'below') : '');
export const bidLabel = (my) => (my ? 'Update bid' : 'Place bid');
export const canPlace = (a, cards) => a?.status === 'live' && cards.length > 0;
export const placedText = (meets) => (meets ? 'Bid placed. It meets the minimum.' : 'Bid placed (below the minimum).');

// ---- The seller view ---------------------------------------------------------------------------
/** The bids in order: the accepted one first, then the ones that meet the minimum, then the best score. best = the first that meets. */
export function sellerRows(a) {
  const rows = [...(a?.bids || [])].sort((x, y) => (Number(y.id === a.accepted_bid_id) - Number(x.id === a.accepted_bid_id)) || (Number(y.meets) - Number(x.meets)) || (y.score - x.score));
  return { rows, bestId: rows.find((b) => b.meets)?.id ?? null };
}
/** The two steps of an accepted bid: the seller accepts, the bidder confirms. */
export function steps(a, bidderName) {
  const accepted = a?.status === 'accepted';
  return accepted ? [{ n: 1, label: 'You accept', done: true }, { n: 2, label: `${bidderName || 'The bidder'} confirms`, on: true }]
    : [{ n: 1, label: 'You accept', on: true }, { n: 2, label: 'Bidder confirms' }];
}
export const bidderSteps = (sellerName) => [{ n: 1, label: `${sellerName} accepts`, done: true }, { n: 2, label: 'You confirm', on: true }];
export const waitText = (name, left) => `Waiting for ${name}${left ? ` · ${left} left` : ''}`;
export const confirmDeadline = (left) => `Confirm within ${left}. After that the bid is declined and your cards are free again.`;
