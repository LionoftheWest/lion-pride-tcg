// UI-63 the Trade window: the rules that can be checked without a browser. node --test
// D-35 (actions), D-64 item 3 (extra copies first), the two-step server rule (server.js /api/trade/offer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderCards, filterCards, pageOf, actionsFor, planFor, canGift, canOffer, fitTradeGrid } from './trade-window.js';

const C = (id, quantity, extra = {}) => ({ id, name: `Card ${id}`, rarity: 'normal', quantity, ...extra });

test('D-64 item 3: extra copies first, the order inside each group stays', () => {
  const out = orderCards([C(1, 1), C(2, 3), C(3, 1), C(4, 2), C(5, 1)]);
  assert.deepEqual(out.map((c) => c.id), [2, 4, 1, 3, 5]);
  assert.deepEqual(orderCards(null), []);
  assert.deepEqual(orderCards([C(1, undefined), C(2, 2)]).map((c) => c.id), [2, 1]);
});

test('search by name, subject and traits; rarity filter', () => {
  const l = [C(1, 1, { name: 'Pika', subject: 'Mouse', tags: { traits: ['electric'] } }), C(2, 1, { name: 'Rob', rarity: 'full_art' })];
  assert.deepEqual(filterCards(l, { q: 'pik' }).map((c) => c.id), [1]);
  assert.deepEqual(filterCards(l, { q: 'ELECTR' }).map((c) => c.id), [1]);
  assert.deepEqual(filterCards(l, { q: 'mouse' }).map((c) => c.id), [1]);
  assert.deepEqual(filterCards(l, { rarity: 'full_art' }).map((c) => c.id), [2]);
  assert.deepEqual(filterCards(l, { q: 'zzz' }), []);
  assert.equal(filterCards(l, {}).length, 2);
});

test('the pager: the page stays inside 0..pages-1, an empty list is 1 page', () => {
  const l = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(pageOf(l, 3, 0), { items: [1, 2, 3], pages: 3, page: 0 });
  assert.deepEqual(pageOf(l, 3, 2), { items: [7], pages: 3, page: 2 });
  assert.equal(pageOf(l, 3, 9).page, 2);
  assert.equal(pageOf(l, 3, -4).page, 0);
  assert.deepEqual(pageOf([], 3, 0), { items: [], pages: 1, page: 0 });
});

test('card rules: no locked card to offer, no Gold or locked card to gift', () => {
  assert.equal(canOffer(C(1, 1)), true);
  assert.equal(canOffer(C(1, 1, { tradeable: false })), false);
  assert.equal(canGift(C(1, 1, { rarity: 'gold' })), false);
  assert.equal(canGift(C(1, 1, { tradeable: false })), false);
  assert.equal(canGift(C(1, 1)), true);
});

test('D-35 actions: your card = Gift + Offer, their card = Request, both = Offer, none = nothing', () => {
  const ids = (a) => a.map((x) => x.id);
  assert.deepEqual(actionsFor({}), []);
  assert.deepEqual(ids(actionsFor({ give: C(1, 1) })), ['gift', 'offer']);
  assert.deepEqual(ids(actionsFor({ get: C(2, 1) })), ['request']);
  assert.deepEqual(ids(actionsFor({ give: C(1, 1), get: C(2, 1) })), ['offer']);
  // one primary button (5.3)
  for (const s of [{ give: C(1, 1) }, { get: C(2, 1) }, { give: C(1, 1), get: C(2, 1) }]) assert.equal(actionsFor(s).filter((x) => x.primary).length, 1);
});

test('the server has no request of a card alone: Request is off with a reason; Gold cannot be gifted', () => {
  assert.equal(actionsFor({ get: C(2, 1) })[0].disabled, true);
  assert.ok(actionsFor({ get: C(2, 1) })[0].reason);
  const g = actionsFor({ give: C(1, 1, { rarity: 'gold' }) });
  assert.equal(g.find((a) => a.id === 'gift').disabled, true);
  assert.equal(g.find((a) => a.id === 'offer').disabled, false);
});

test('the old rule (two-step off): Offer needs both cards', () => {
  assert.equal(actionsFor({ give: C(1, 1), twoStep: false }).find((a) => a.id === 'offer').disabled, true);
  assert.equal(actionsFor({ give: C(1, 1), get: C(2, 1), twoStep: false })[0].disabled, false);
});

test('the calls: the paths and fields of server.js', () => {
  const give = C(7, 1), get = C(9, 1);
  assert.deepEqual(planFor('gift', { give, to: 'm1' }), { path: '/api/trade/gift', body: { toId: 'm1', cardId: 7 } });
  assert.deepEqual(planFor('pack', { to: 'm1' }), { path: '/api/gift', body: { toId: 'm1', amount: 1 } });
  // two-step on: only my card goes (the server refuses a request card then)
  assert.deepEqual(planFor('offer', { give, get, to: 'm1', twoStep: true }), { path: '/api/trade/offer', body: { toId: 'm1', offerCardId: 7 } });
  assert.deepEqual(planFor('offer', { give, get, to: 'm1', twoStep: false }), { path: '/api/trade/offer', body: { toId: 'm1', offerCardId: 7, requestCardId: 9 } });
  assert.equal(planFor('offer', { give, to: 'm1', twoStep: false }), null);
  assert.equal(planFor('request', { get, to: 'm1' }), null);
  assert.equal(planFor('gift', { to: 'm1' }), null);
});

test('the grid of the frames: 7 x 3 at 1280x720, a tile of 88 to 112, one tile size for a page', () => {
  // the right column of 1280x720: about 780 x 480
  const g = fitTradeGrid(780, 480, 6);
  assert.deepEqual([g.cols, g.rows], [7, 3]);
  assert.ok(g.tile >= 88 && g.tile <= 112);
  // never a tile outside the token range when the area allows one
  for (const [w, h] of [[384, 400], [330, 300], [600, 250], [1100, 560]]) { const f = fitTradeGrid(w, h, 6); assert.ok(f.tile >= 80 && f.tile <= 112, `${w}x${h}: ${f.tile}`); assert.ok(f.cols * f.tile + (f.cols - 1) * 6 <= w); }
  // an area 245 high cannot hold 2 rows of 88: 2 rows of 80 fill it (no empty band, 3.4)
  assert.equal(fitTradeGrid(480, 245, 6).rows, 2);
  assert.deepEqual(fitTradeGrid(0, 0, 6).cols, 1);
});
