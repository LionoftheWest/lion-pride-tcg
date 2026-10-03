// Wishlists, the Trading Hall and Auctions (Nathan, 2026-10-01/02; designs 26 + 27, all approved).
// The rules live in SQL (tcg-bot/supabase/hall_auctions.sql); these routes read the views and call
// the RPCs. Privacy: another member's WISHLIST and LISTED cards show, never their collection.
// Flag: hallOn(id) (HALL_USERS = Nathan first, FEATURE_HALL=1 = everyone). Every route checks it.
import { selectAll } from './select-all.js';

const RANK = { normal: 0, illustrated_rare: 1, secret_rare: 2, promo: 2, full_art: 3, event: 3, gold: 4 };
const ERR = {
  not_tradeable: 'That card cannot be traded.', no_copy: 'You have no free copy of that card.', too_many: 'You can list 5 cards at a time.',
  already_listed: 'That card is listed already.', not_found: 'Not found.', listing_closed: 'That listing is closed.', own_listing: 'That is your own listing.',
  not_on_wishlist: 'Offer a card from their wishlist.', listing_gone: 'They do not have that card any more.', already_offered: 'You offered on this listing already.',
  cannot_trade: 'Those two cards cannot be traded (the same rarity, both tradeable).', bad_length: 'An auction lasts 1 to 14 days.', bad_min: 'The minimum is 0 to 5 cards.',
  too_many_cards: 'Ask for at most 3 specific cards.', bad_mode: 'Pick AND or OR.', no_card: 'Unknown card.', one_live: 'You can run one auction at a time.',
  bad_rarity: 'Unknown rarity.', gold_min: 'A Gold auction takes only Full Art, Promo or Event bids.', no_gold_bids: 'Gold cards cannot be bid.',
  bad_min_card: 'A minimum card must be a card a bid can hold.', no_auction: 'Unknown auction.', not_live: 'That auction is not open.', own_auction: 'That is your own auction.',
  bad_count: 'A bid holds 1 to 5 cards.', gold_bid_rarity: 'A Gold auction takes only Full Art, Promo or Event cards.', no_bid: 'No bid.', not_seller: 'Only the seller can do that.',
  not_accepted: 'No accepted bid.', empty_slot: 'Put a card in that slot first.', not_your_bid: 'That is not your bid.', cards_gone: 'A card in the trade is gone; nothing moved.', bad_slot: 'Pick a slot 1 to 5.',
};
const fail = (res, code) => res.status(400).json({ ok: false, error: code, message: ERR[code] || code });

// A real member (a Discord id) never sees the automated test members (ids tst_*).
const realCaller = (id) => /^\d{17,20}$/.test(String(id));
const testId = (id) => String(id).startsWith('tst_');

// The top want of each member (hall_top_want.sql): the starred slot, else the first filled slot.
export function topWants(rows) {
  const best = new Map();
  for (const w of rows || []) {
    const k = String(w.player_id), b = best.get(k);
    if (!b || (w.top && !b.top) || (!!w.top === !!b.top && w.slot < b.slot)) best.set(k, w);
  }
  return [...best.values()];
}

// A member's held copies per card (free_copies in SQL): trade offers, their auction, their open /
// accepted bids. Also used by the collection's "can ascend" (server.js).
export async function heldCopies(supabase, id) {
  const [o1, o2, au, bids] = await Promise.all([
    supabase.from('trade_offers').select('offer_card_id').eq('from_id', id).in('status', ['pending', 'countered']),
    supabase.from('trade_offers').select('request_card_id').eq('to_id', id).eq('status', 'countered'),
    supabase.from('auctions').select('card_id').eq('seller_id', id).in('status', ['live', 'accepted']),
    supabase.from('auction_bids').select('cards').eq('bidder_id', id).in('status', ['open', 'accepted']),
  ]);
  const m = new Map(); const add = (c) => m.set(Number(c), (m.get(Number(c)) || 0) + 1);
  (o1.data || []).forEach((r) => add(r.offer_card_id)); (o2.data || []).forEach((r) => add(r.request_card_id));
  (au.data || []).forEach((r) => add(r.card_id)); (bids.data || []).forEach((r) => (r.cards || []).forEach(add));
  return m;
}

export function registerHallRoutes(app, { supabase, caller, rateLimit, notify, announce, bustUser, getCatalogBase, hallOn, postsOn }) {
  const gate = async (req, res, write = false) => {
    const me = await caller(req);
    if (!me) { res.status(401).json({ error: 'not authenticated' }); return null; }
    if (!hallOn(me.id)) { res.status(403).json({ error: 'off' }); return null; }
    if (write && !rateLimit(me.id)) { res.status(429).json({ error: 'slow down' }); return null; }
    return me;
  };
  const catalog = async () => new Map((await getCatalogBase()).map((c) => [Number(c.id), c]));
  const card = (cat, id) => { const c = cat.get(Number(id)); return c ? { id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, power: c.power } : null; };
  const names = async (ids) => {
    const u = [...new Set(ids.filter(Boolean).map(String))];
    if (!u.length) return new Map();
    const { data } = await supabase.from('players').select('id, username').in('id', u);
    return new Map((data || []).map((p) => [String(p.id), p.username]));
  };
  const held = (id) => heldCopies(supabase, id);
  const owned = async (id) => {
    const { data } = await supabase.from('player_cards').select('card_id, quantity').eq('player_id', id).gte('quantity', 1);
    return new Map((data || []).map((r) => [Number(r.card_id), r.quantity]));
  };
  const freeOf = (own, hold) => (c) => Math.max(0, (own.get(Number(c)) || 0) - (hold.get(Number(c)) || 0));

  // ---- Wishlists ---------------------------------------------------------------------------
  app.get('/api/wishlist', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    const id = String(req.query.id || me.id);
    const [{ data }, cat, own, hold] = await Promise.all([supabase.from('wishlists').select('slot, card_id, top').eq('player_id', id).order('slot'),
      catalog(), owned(String(me.id)), held(String(me.id))]);
    const free = freeOf(own, hold);
    const top = topWants(data)[0]?.slot ?? null; // the starred slot, else the first filled slot
    res.json({ id, top, slots: [1, 2, 3, 4, 5].map((s) => { const r = (data || []).find((x) => x.slot === s); return { slot: s, card: r ? card(cat, r.card_id) : null, mine: r ? free(r.card_id) : 0, top: s === top }; }) });
  });
  app.post('/api/wishlist', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const slot = Number(req.body?.slot), cardId = req.body?.cardId == null ? null : Number(req.body.cardId);
    if (!Number.isInteger(slot) || (cardId !== null && !Number.isInteger(cardId))) return fail(res, 'bad_slot');
    const { data, error } = await supabase.rpc('set_wishlist', { p_player: String(me.id), p_slot: slot, p_card: cardId });
    if (error) return res.status(500).json({ error: error.message });
    return data?.ok ? res.json(data) : fail(res, data?.error);
  });
  // Star one wishlist slot as the top want (the card the Wanted view shows).
  app.post('/api/wishlist/top', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const slot = Number(req.body?.slot);
    if (!Number.isInteger(slot)) return fail(res, 'bad_slot');
    const { data, error } = await supabase.rpc('set_wish_top', { p_player: String(me.id), p_slot: slot });
    if (error) return res.status(500).json({ error: error.message });
    return data?.ok ? res.json(data) : fail(res, data?.error);
  });

  // ---- The Trading Hall -------------------------------------------------------------------
  // Wanted = one card for each member, their top want (mine included, tagged yours); For trade = their open listings (a listing whose
  // card the lister no longer owns does not show). mine = my free copies; match = how many of the
  // lister's wishlist cards I can offer.
  app.get('/api/hall', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    const myId = String(me.id);
    const [wish, listings, cat, own, hold] = await Promise.all([
      selectAll(() => supabase.from('wishlists').select('player_id, slot, card_id, top'), ['player_id', 'slot']),
      selectAll(() => supabase.from('trade_listings').select('id, player_id, card_id, created_at').eq('status', 'open'), ['id']),
      catalog(), owned(myId), held(myId)]);
    if (wish.error || listings.error) return res.status(500).json({ error: (wish.error || listings.error).message });
    const free = freeOf(own, hold);
    if (realCaller(myId)) { wish.data = (wish.data || []).filter((w) => !testId(w.player_id)); listings.data = (listings.data || []).filter((l) => !testId(l.player_id)); }
    const others = listings.data || []; // every listing, mine included (tagged mine)
    // The listers still own the card (a listing does not hold a copy).
    const listerIds = [...new Set(others.map((l) => String(l.player_id)))];
    const { data: lc } = listerIds.length ? await supabase.from('player_cards').select('player_id, card_id').in('player_id', listerIds).gte('quantity', 1)
      .in('card_id', [...new Set(others.map((l) => l.card_id))]) : { data: [] };
    const has = new Set((lc || []).map((r) => `${r.player_id}:${r.card_id}`));
    const wishBy = new Map();
    for (const w of wish.data || []) { const k = String(w.player_id); if (!wishBy.has(k)) wishBy.set(k, []); wishBy.get(k).push(Number(w.card_id)); }
    const nm = await names([...(wish.data || []).map((w) => w.player_id), ...others.map((l) => l.player_id)]);
    const wanted = topWants(wish.data).filter((w) => cat.has(Number(w.card_id)))
      .map((w) => ({ player_id: String(w.player_id), name: nm.get(String(w.player_id)) || 'A member', card: card(cat, w.card_id),
        yours: String(w.player_id) === myId, mine: String(w.player_id) === myId ? 0 : free(w.card_id) }))
      .sort((a, b) => (b.yours - a.yours) || (b.mine > 0) - (a.mine > 0) || (RANK[b.card.rarity] ?? 0) - (RANK[a.card.rarity] ?? 0));
    const forTrade = others.filter((l) => has.has(`${l.player_id}:${l.card_id}`) && cat.has(Number(l.card_id)))
      .map((l) => ({ id: l.id, player_id: String(l.player_id), name: nm.get(String(l.player_id)) || 'A member', card: card(cat, l.card_id), mine: String(l.player_id) === myId,
        match: String(l.player_id) === myId ? 0 : (wishBy.get(String(l.player_id)) || []).filter((c) => free(c) > 0).length, at: l.created_at }))
      .sort((a, b) => (b.mine - a.mine) || (b.match > 0) - (a.match > 0) || String(b.at).localeCompare(String(a.at)));
    const mine = (listings.data || []).filter((l) => String(l.player_id) === myId).map((l) => ({ id: l.id, card: card(cat, l.card_id), at: l.created_at }));
    res.json({ wanted, forTrade, mine });
  });
  app.get('/api/hall/held', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    res.json({ held: Object.fromEntries(await held(String(me.id))) });
  });
  app.post('/api/hall/list', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const cardId = Number(req.body?.cardId);
    if (!Number.isInteger(cardId)) return fail(res, 'no_card');
    const { data, error } = await supabase.rpc('list_for_trade', { p_player: String(me.id), p_card: cardId });
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.ok) return fail(res, data?.error);
    if (postsOn()) {
      const cat = await catalog(); const c = card(cat, cardId);
      announce(`🏷️ **${me.global_name || me.username}** put **${c?.name || 'a card'}** up for trade in the Trading Hall!`, 'trades', { type: 'listing', listingId: Number(data.id) });
    }
    res.json(data);
  });
  app.post('/api/hall/unlist', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const { data, error } = await supabase.rpc('unlist_for_trade', { p_player: String(me.id), p_listing: Number(req.body?.listingId) });
    if (error) return res.status(500).json({ error: error.message });
    return data?.ok ? res.json(data) : fail(res, data?.error);
  });
  // An offer on a For trade card: a card from the lister's wishlist (the lister accepts in Trades).
  app.post('/api/hall/offer', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const { data, error } = await supabase.rpc('offer_on_listing', { p_from: String(me.id), p_listing: Number(req.body?.listingId), p_offer: Number(req.body?.cardId) });
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.ok) return fail(res, data?.error);
    const from = me.global_name || me.username;
    notify(data.to, 'trade_offer', `🔄 ${from} made an offer on your Trading Hall card! Open Trades to accept.`);
    if (postsOn()) announce(`🔄 <@${data.to}> — **${from}** made an offer on your Trading Hall card! Open Lion Pride TCG to accept or decline.`, 'trades', { type: 'trade', kind: 'offer', offerId: Number(data.id) });
    res.json(data);
  });

  // ---- Auctions -----------------------------------------------------------------------------
  const minOf = (a, cat) => ({ rarity: a.min_rarity, count: a.min_count, cards: (a.min_cards || []).map((x) => card(cat, x)).filter(Boolean), mode: a.min_mode });
  const score = (cards, cat) => cards.reduce((t, x) => t + (RANK[cat.get(Number(x))?.rarity] ?? 0) * 10 + 1, 0);
  // All live auctions (open) or mine (I sell or bid on them), newest first.
  app.get('/api/auctions', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    const myId = String(me.id), view = req.query.view === 'mine' ? 'mine' : 'open';
    const live = await selectAll(() => supabase.from('auctions').select('id, seller_id, card_id, min_rarity, min_count, min_cards, min_mode, status, ends_at, created_at')
      .in('status', ['live', 'accepted']), ['id']); // only live auctions show (Nathan, 2026-10-02)
    if (live.error) return res.status(500).json({ error: live.error.message });
    let rows = (live.data || []).filter((a) => !realCaller(myId) || !testId(a.seller_id));
    const ids = rows.map((a) => a.id);
    const bids = ids.length ? await selectAll(() => supabase.from('auction_bids').select('auction_id, bidder_id, status').in('auction_id', ids).in('status', ['open', 'accepted', 'won']), ['id']) : { data: [] };
    const myBid = new Set((bids.data || []).filter((b) => String(b.bidder_id) === myId).map((b) => b.auction_id));
    if (view === 'mine') rows = rows.filter((a) => String(a.seller_id) === myId || myBid.has(a.id));
    const cat = await catalog(); const nm = await names(rows.map((a) => a.seller_id));
    const count = (id) => (bids.data || []).filter((b) => b.auction_id === id && b.status !== 'won').length;
    res.json({ view, auctions: rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((a) => ({
      id: a.id, seller_id: String(a.seller_id), seller: nm.get(String(a.seller_id)) || 'A member', card: card(cat, a.card_id), min: minOf(a, cat),
      status: a.status, ends_at: a.ends_at, bids: count(a.id), mine: String(a.seller_id) === myId, myBid: myBid.has(a.id) })) });
  });
  // One auction: the seller sees every bid; a bidder sees their bid; everyone sees the best bid.
  app.get('/api/auction', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    const id = Number(req.query.id), myId = String(me.id);
    const { data: a } = await supabase.from('auctions').select('*').eq('id', id).maybeSingle();
    if (!a) return res.status(404).json({ error: 'no_auction' });
    const { data: bs } = await supabase.from('auction_bids').select('id, bidder_id, cards, status, created_at').eq('auction_id', id).in('status', ['open', 'accepted', 'won']).order('created_at');
    const cat = await catalog(); const nm = await names([a.seller_id, ...(bs || []).map((b) => b.bidder_id)]);
    const meets = await Promise.all((bs || []).map((b) => supabase.rpc('auction_meets', { p_auction: id, p_cards: b.cards }).then((r) => !!r.data)));
    const bids = (bs || []).map((b, i) => ({ id: b.id, bidder_id: String(b.bidder_id), bidder: nm.get(String(b.bidder_id)) || 'A member', cards: b.cards.map((x) => card(cat, x)).filter(Boolean),
      status: b.status, meets: meets[i], at: b.created_at, score: score(b.cards, cat) }));
    const best = [...bids].sort((x, y) => (y.meets - x.meets) || (y.score - x.score))[0] || null;
    const seller = String(a.seller_id) === myId;
    res.json({ id: a.id, seller_id: String(a.seller_id), seller: nm.get(String(a.seller_id)) || 'A member', card: card(cat, a.card_id), min: minOf(a, cat),
      status: a.status, ends_at: a.ends_at, accepted_bid_id: a.accepted_bid_id,
      confirm_by: a.accepted_at ? new Date(new Date(a.accepted_at).getTime() + 24 * 3600e3).toISOString() : null, isSeller: seller, bidsCount: bids.length,
      bids: seller ? bids : undefined, myBid: bids.find((b) => b.bidder_id === myId) || null,
      best: best && { cards: best.cards, meets: best.meets, mine: best.bidder_id === myId } });
  });
  const rpc = async (res, name, args) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) { res.status(500).json({ error: error.message }); return null; }
    if (!data?.ok) { fail(res, data?.error); return null; }
    return data;
  };
  app.post('/api/auction/start', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const b = req.body || {};
    const minCards = Array.isArray(b.minCards) ? b.minCards.map(Number).filter(Number.isInteger).slice(0, 3) : [];
    const d = await rpc(res, 'start_auction', { p_seller: String(me.id), p_card: Number(b.cardId), p_min_rarity: b.minRarity || null,
      p_min_count: Number(b.minCount) || 0, p_min_cards: minCards, p_mode: b.mode === 'or' ? 'or' : 'and', p_days: Number(b.days) || 3 });
    if (d) { bustUser(me.id); res.json(d); }
  });
  app.post('/api/auction/bid', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const cards = Array.isArray(req.body?.cards) ? req.body.cards.map(Number).filter(Number.isInteger) : [];
    const id = Number(req.body?.auctionId);
    const d = await rpc(res, 'place_bid', { p_bidder: String(me.id), p_auction: id, p_cards: cards });
    if (!d) return;
    const { data: a } = await supabase.from('auctions').select('seller_id, card_id').eq('id', id).maybeSingle();
    if (a) { const c = card(await catalog(), a.card_id); notify(String(a.seller_id), 'auction_bid', `🔨 ${me.global_name || me.username} bid on your auction for ${c?.name || 'your card'}.`); }
    res.json(d);
  });
  app.post('/api/auction/withdraw', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const d = await rpc(res, 'withdraw_bid', { p_bidder: String(me.id), p_auction: Number(req.body?.auctionId) });
    if (d) res.json(d);
  });
  app.post('/api/auction/accept', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const d = await rpc(res, 'accept_bid', { p_seller: String(me.id), p_bid: Number(req.body?.bidId) });
    if (!d) return;
    const who = me.global_name || me.username;
    notify(d.bidder, 'auction_accepted', `🔨 ${who} accepted your auction bid! Confirm the trade within 24 hours.`);
    if (postsOn()) announce(`🔨 <@${d.bidder}> — **${who}** accepted your auction bid! Open Lion Pride TCG to confirm the trade within 24 hours.`, 'trades');
    res.json(d);
  });
  app.post('/api/auction/close', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const id = Number(req.body?.auctionId);
    const { data: bs } = await supabase.from('auction_bids').select('bidder_id').eq('auction_id', id).in('status', ['open', 'accepted']);
    const d = await rpc(res, 'close_auction', { p_seller: String(me.id), p_auction: id });
    if (!d) return;
    for (const b of bs || []) notify(String(b.bidder_id), 'auction_closed', '🔨 An auction you bid on closed early. Your bid cards are free again.');
    bustUser(me.id); res.json(d);
  });
  app.post('/api/auction/confirm', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const d = await rpc(res, 'confirm_bid', { p_bidder: String(me.id), p_auction: Number(req.body?.auctionId) });
    if (!d) return;
    bustUser(me.id); bustUser(d.seller);
    notify(d.seller, 'auction_sold', `🔨 ${me.global_name || me.username} confirmed: your auction is sold. The bid cards are in your collection.`);
    res.json(d);
  });
  app.post('/api/auction/decline', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const d = await rpc(res, 'decline_accepted_bid', { p_bidder: String(me.id), p_auction: Number(req.body?.auctionId) });
    if (!d) return;
    notify(d.seller, 'auction_declined', `🔨 ${me.global_name || me.username} declined your accepted bid. Your auction is open again.`);
    res.json(d);
  });
}
