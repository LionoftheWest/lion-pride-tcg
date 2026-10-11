// UI-32 Auctions: the pure rules (src/ui3/auctions.js). node --test src/ui3/auctions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from './auctions.js';

test('start: the minimum rarity follows the card (Gold takes only Full Art, Promo, Event)', () => {
  let st = A.newStart();
  assert.equal(st.days, 3); assert.equal(st.minCount, 0);
  st = A.chooseCard(st, { id: 1, rarity: 'full_art' });
  assert.equal(st.minRarity, 'secret_rare');
  st = A.chooseCard({ ...st, minRarity: 'normal' }, { id: 2, rarity: 'gold' });
  assert.equal(st.minRarity, 'full_art', 'normal is not a Gold bid rarity');
  st = A.chooseCard({ ...st, minRarity: 'promo' }, { id: 2, rarity: 'gold' });
  assert.equal(st.minRarity, 'promo', 'a Gold bid rarity stays');
  const asked = A.chooseCard({ ...A.newStart(), minCards: [{ id: 9, rarity: 'normal' }, { id: 8, rarity: 'full_art' }] }, { id: 2, rarity: 'gold' });
  assert.deepEqual(asked.minCards.map((x) => x.id), [8], 'a Gold auction cannot ask for a Normal card');
});

test('start: counts and days stay in their limits; the body matches the server call', () => {
  assert.equal(A.clampCount(-1), 0); assert.equal(A.clampCount(9), 5);
  assert.equal(A.clampDays(0), 1); assert.equal(A.clampDays(99), 14);
  let st = A.chooseCard(A.newStart(), { id: 7, rarity: 'normal' });
  assert.equal(A.startReady(A.newStart()), false); assert.equal(A.startReady(st), true);
  assert.deepEqual(A.startBody(st), { cardId: 7, minRarity: null, minCount: 0, minCards: [], mode: 'and', days: 3 }, 'a minimum of 0 sends no rarity');
  st = A.setMinCount(st, 2);
  st = A.addAsk(st, { id: 11, rarity: 'normal' });
  assert.deepEqual(A.startBody(st), { cardId: 7, minRarity: 'secret_rare', minCount: 2, minCards: [11], mode: 'and', days: 3 });
});

test('start: at most 3 asked cards, no repeats; hits exclude asked cards and other rarities', () => {
  let st = A.chooseCard(A.newStart(), { id: 7, rarity: 'normal' });
  for (const id of [1, 2, 3, 4, 1]) st = A.addAsk(st, { id, rarity: 'normal' });
  assert.deepEqual(st.minCards.map((x) => x.id), [1, 2, 3]);
  assert.deepEqual(A.removeAsk(st, 2).minCards.map((x) => x.id), [1, 3]);
  const cat = [{ id: 1, name: 'Pikachu', rarity: 'normal' }, { id: 5, name: 'Pika Two', rarity: 'illustrated_rare' }, { id: 6, name: 'Pikachu Gold', rarity: 'gold' }, { id: 7, name: 'Mew', rarity: 'normal' }];
  assert.deepEqual(A.askHits(cat, A.bidRarities(false), 'pika', [{ id: 1 }]).map((x) => x.id), [5], 'asked and Gold are left out');
  assert.deepEqual(A.askHits(cat, A.bidRarities(false), '  '), []);
});

test('time: two largest units, soon under a day', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  assert.deepEqual(A.timeLeft('2026-10-03T22:30:00Z', now), { text: '2d 22h', soon: false });
  assert.deepEqual(A.timeLeft('2026-10-01T05:03:00Z', now), { text: '5h 3m', soon: true });
  assert.deepEqual(A.timeLeft('2026-09-30T00:00:00Z', now), { text: '0m', soon: true });
});

test('list: the caption under a card is the time and the bids, or the state', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const live = { status: 'live', ends_at: '2026-10-03T22:00:00Z', bids: 1 };
  assert.deepEqual(A.listCaption(live, now), { kind: 'live', text: '2d 22h', bids: 1 });
  assert.equal(A.listCaption({ ...live, ends_at: '2026-10-01T02:00:00Z' }, now).kind, 'soon');
  assert.equal(A.listCaption({ status: 'accepted', myBid: true, mine: false, bids: 2 }, now).text, 'Confirm');
  assert.equal(A.listCaption({ status: 'accepted', myBid: false, mine: true, bids: 2 }, now).text, 'Accepted');
  assert.equal(A.listCaption({ status: 'sold', bids: 0 }, now).text, 'Sold');
  assert.equal(A.waitingForMe([live, { status: 'accepted', myBid: true, mine: false, id: 3 }]).id, 3);
  assert.equal(A.waitingForMe([live]), null);
});

test('list: the empty texts end with a full stop and name the view', () => {
  assert.equal(A.emptyText('open', false), 'No auctions are open. Start one.');
  assert.equal(A.emptyText('mine', false), 'You have no auctions or bids.');
  assert.equal(A.emptyText('open', true), 'No cards match.');
  assert.deepEqual(A.asRows([{ seller: 'Ann', card: { id: 1 } }])[0].name, 'Ann');
});

test('minimum: the count line first, then each card with or / + in front', () => {
  const cards = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }];
  assert.deepEqual(A.minLines({ count: 5, rarity: 'normal', cards, mode: 'or' }).map((l) => [l.kind, l.lead]), [['count', ''], ['card', 'or'], ['card', 'or']]);
  assert.deepEqual(A.minLines({ count: 0, rarity: null, cards, mode: 'and' }).map((l) => [l.kind, l.lead]), [['card', ''], ['card', '+']]);
  assert.deepEqual(A.minLines({ count: 0, rarity: null, cards: [], mode: 'and' }), [], 'no minimum: the view says Any bid');
});

test('meets: the same rule as the SQL function (count of a rarity or better, asked cards, AND / OR)', () => {
  const a = { min: { count: 2, rarity: 'secret_rare', cards: [{ id: 9 }], mode: 'and' } };
  const sr = (id) => ({ id, rarity: 'secret_rare' });
  assert.equal(A.meetsMinimum(a, [sr(1), sr(2), { id: 9, rarity: 'normal' }]), true);
  assert.equal(A.meetsMinimum(a, [sr(1), sr(2)]), false, 'AND needs the asked card too');
  assert.equal(A.meetsMinimum({ min: { ...a.min, mode: 'or' } }, [sr(1), sr(2)]), true, 'OR: the count alone');
  assert.equal(A.meetsMinimum({ min: { ...a.min, mode: 'or' } }, [{ id: 9, rarity: 'normal' }]), true, 'OR: the card alone');
  assert.equal(A.meetsMinimum({ min: { count: 1, rarity: 'full_art', cards: [], mode: 'and' } }, [{ id: 1, rarity: 'event' }]), true, 'Event ranks as Full Art');
  assert.equal(A.meetsMinimum({ min: {} }, [sr(1)]), true, 'no minimum');
  assert.equal(A.bidStatus(a, []), ''); assert.equal(A.bidStatus(a, [sr(1)]), 'below');
});

test('bid picker: Gold bids only for Gold, the seller wishlist and asked cards first with the heart on the wishlist', () => {
  const owned = [
    { id: 1, rarity: 'normal', quantity: 1 }, { id: 2, rarity: 'full_art', quantity: 1 }, { id: 3, rarity: 'gold', quantity: 1 },
    { id: 4, rarity: 'normal', quantity: 1 }, { id: 5, rarity: 'normal', quantity: 2 }, { id: 6, rarity: 'normal', quantity: 1 },
  ];
  const a = { card: { rarity: 'normal' }, min: { cards: [{ id: 4 }] } };
  const out = A.bidCards(owned, a, { held: { 6: 1 }, sellerWish: [5] });
  assert.deepEqual(out.map((c) => c.id), [4, 5, 2, 1], 'asked and wished first, then best rarity; Gold and held cards left out');
  assert.deepEqual(out.map((c) => c.mark), ['', 'wish', '', ''], 'only the wishlist shows the heart (D-67 item 5)');
  const gold = A.bidCards(owned, { card: { rarity: 'gold' }, min: {} }, {});
  assert.deepEqual(gold.map((c) => c.id), [2], 'a Gold auction takes Full Art, Promo, Event');
});

test('bid picker: the copies of my own bid count as free', () => {
  assert.equal(A.bidCopies({ id: 1, quantity: 1 }, { 1: 1 }, []), 0);
  assert.equal(A.bidCopies({ id: 1, quantity: 1 }, { 1: 1 }, [{ id: 1 }]), 1);
  assert.deepEqual(A.setBid(['1', 2, 3, 4, 5, 6]), [1, 2, 3, 4, 5]);
  assert.equal(A.bidLabel(null), 'Place bid'); assert.equal(A.bidLabel({ id: 1 }), 'Update bid');
  assert.equal(A.canPlace({ status: 'live' }, []), false); assert.equal(A.canPlace({ status: 'accepted' }, [{}]), false); assert.equal(A.canPlace({ status: 'live' }, [{}]), true);
  assert.deepEqual(A.bidTotals([{ rarity: 'normal' }, { rarity: 'full_art' }, { rarity: 'normal' }]), [{ n: 1, rarity: 'full_art' }, { n: 2, rarity: 'normal' }]);
});

test('seller: the accepted bid first, then the bids that meet the minimum; the best is the first that meets', () => {
  const a = { accepted_bid_id: 3, bids: [{ id: 1, meets: false, score: 9 }, { id: 2, meets: true, score: 1 }, { id: 3, meets: false, score: 0 }, { id: 4, meets: true, score: 5 }] };
  const { rows, bestId } = A.sellerRows(a);
  assert.deepEqual(rows.map((b) => b.id), [3, 4, 2, 1]);
  assert.equal(bestId, 4);
  assert.deepEqual(A.sellerRows({ bids: [] }), { rows: [], bestId: null });
});

test('steps and texts', () => {
  assert.deepEqual(A.steps({ status: 'live' }, 'Ann').map((s) => [s.label, !!s.on, !!s.done]), [['You accept', true, false], ['Bidder confirms', false, false]]);
  assert.deepEqual(A.steps({ status: 'accepted' }, 'Ann').map((s) => [s.label, !!s.on, !!s.done]), [['You accept', false, true], ['Ann confirms', true, false]]);
  assert.deepEqual(A.bidderSteps('Bo').map((s) => s.label), ['Bo accepts', 'You confirm']);
  assert.equal(A.waitText('Ann', '1d 0h'), 'Waiting for Ann · 1d 0h left');
  assert.equal(A.closedText({ status: 'sold' }), 'This auction is sold.');
  assert.equal(A.placedText(false), 'Bid placed (below the minimum).');
  assert.equal(A.TEXT.closeTitle, 'Close early'); assert.equal(A.TEXT.closeLine, 'Every bid returns.');
  assert.equal(A.daysText(1), '1 day'); assert.equal(A.daysText(3), '3 days');
});

test('startable: free copies only, best rarity first', () => {
  const cards = [{ id: 1, rarity: 'normal', quantity: 1 }, { id: 2, rarity: 'gold', quantity: 1 }, { id: 3, rarity: 'full_art', quantity: 1 }];
  assert.deepEqual(A.startable(cards, { 3: 1 }).map((c) => c.id), [2, 1]);
});

test('list: with every auction on one page the cards grow to the largest tile that holds them with their caption', () => {
  const o = { min: 88, max: 112, ratio: 1.4, extra: 28 };
  assert.deepEqual(A.fitAllWithCaption(9, 1208, 400, 8, o), { cols: 10, rows: 1, tile: 112 });
  const r = A.fitAllWithCaption(9, 398, 520, 8, o);
  assert.ok(r.cols * r.rows >= 9 && r.tile >= 88 && r.rows * (r.tile * 1.4 + 28 + 8) - 8 <= 520, 'every card and its caption inside the box');
  assert.equal(A.fitAllWithCaption(30, 398, 300, 8, o), null, 'no tile of the minimum holds them all');
  assert.equal(A.fitAllWithCaption(0, 398, 300, 8, o), null);
});
