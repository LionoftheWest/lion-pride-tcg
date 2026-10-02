// The Shop routes: the flag gate, the login, and the member always from the verified token.
// node --test shop-routes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerShopRoutes } from './src/shop-routes.js';

// A fake express app and a fake Supabase that records every RPC call.
function setup({ on = true, me = { id: '111111111111111111' } } = {}) {
  const routes = {};
  const app = { get: (p, h) => { routes[`GET ${p}`] = h; }, post: (p, h) => { routes[`POST ${p}`] = h; } };
  const calls = [];
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'shop_today') return { data: { ok: true, balance: 300, stock: [{ slot: 1, card_id: 7, rarity: 'normal', price: 150, bought: false }] } };
      if (name === 'convertible_copies') return { data: 2 };
      return { data: { ok: true, balance: 150 } };
    },
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: [{ card_id: 7, quantity: 2 }] }) }) }) }),
  };
  const busted = [];
  registerShopRoutes(app, {
    supabase, caller: async () => me, rateLimit: () => true, bustUser: (id) => busted.push(id),
    getCatalogBase: async () => [{ id: 7, name: 'Test Card', rarity: 'normal', image_url: '/x.webp', power: 10 }],
    shardsOn: () => on,
  });
  const run = async (key, { body = {}, query = {} } = {}) => {
    let status = 200, json = null;
    const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; } };
    await routes[key]({ body, query }, res);
    return { status, json };
  };
  return { run, calls, busted };
}

test('the flag OFF: every route answers 403 and calls no RPC', async () => {
  const { run, calls } = setup({ on: false });
  for (const key of ['GET /api/shop', 'POST /api/shop/buy', 'POST /api/shards/convert', 'GET /api/shards/convertible']) {
    assert.equal((await run(key, { body: { kind: 'pack' } })).status, 403, key);
  }
  assert.equal(calls.length, 0);
});

test('no login: 401', async () => {
  const { run, calls } = setup({ me: null });
  assert.equal((await run('POST /api/shop/buy', { body: { kind: 'pack' } })).status, 401);
  assert.equal(calls.length, 0);
});

test('a buy uses the verified member, never an id in the body', async () => {
  const { run, calls, busted } = setup();
  const r = await run('POST /api/shop/buy', { body: { kind: 'card', slot: 1, player: '999', p_player: '999' } });
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0], { name: 'buy_shop_item', args: { p_player: '111111111111111111', p_kind: 'card', p_slot: 1, p_card: null, p_qty: 1 } });
  assert.deepEqual(busted, ['111111111111111111']);
});

test('a bad kind or a non-integer amount is refused before any RPC', async () => {
  const { run, calls } = setup();
  assert.equal((await run('POST /api/shop/buy', { body: { kind: 'gold' } })).json.error, 'bad_kind');
  assert.equal((await run('POST /api/shop/buy', { body: { kind: 'pack', qty: 2.5 } })).json.error, 'bad_qty');
  assert.equal((await run('POST /api/shop/buy', { body: { kind: 'card', slot: '1' } })).json.error, 'no_slot');
  assert.equal((await run('POST /api/shards/convert', { body: { cardId: 7, count: '3' } })).json.error, 'bad_count');
  assert.equal(calls.length, 0);
});

test('the Shop view adds the card details and my owned count to the stock', async () => {
  const { run } = setup();
  const r = await run('GET /api/shop');
  assert.equal(r.json.balance, 300);
  assert.deepEqual(r.json.stock[0].card, { id: 7, name: 'Test Card', rarity: 'normal', image_url: '/x.webp', power: 10 });
  assert.equal(r.json.stock[0].owned, 2);
});

test('an RPC refusal becomes a 400 with a readable message', async () => {
  const routes = {};
  registerShopRoutes({ get: (p, h) => { routes[p] = h; }, post: (p, h) => { routes[p] = h; } }, {
    supabase: { rpc: async () => ({ data: { ok: false, error: 'not_enough', balance: 10, price: 150 } }) },
    caller: async () => ({ id: '1' }), rateLimit: () => true, bustUser: () => {}, getCatalogBase: async () => [], shardsOn: () => true,
  });
  let status = 0, json = null;
  await routes['/api/shop/buy']({ body: { kind: 'pack', qty: 1 } }, { status(s) { status = s; return this; }, json(j) { json = j; return this; } });
  assert.equal(status, 400);
  assert.equal(json.message, 'You do not have enough Shards.');
  assert.equal(json.price, 150);
});
