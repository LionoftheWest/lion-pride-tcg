// The per-member view caches of the Shop and the Dungeon / Gauntlet routes (2026-10-11 database load).
// node --test src/view-cache.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerShopRoutes } from './shop-routes.js';
import { registerDungeonRoutes, viewValid } from './dungeon-routes.js';
import { makeTtlCache } from './ttl-cache.js';

function harness(register, extra, rpcs) {
  const routes = {}; const calls = [];
  const app = { get: (p, h) => { routes[`GET ${p}`] = h; }, post: (p, h) => { routes[`POST ${p}`] = h; } };
  const caches = []; const clock = { t: 1_000_000 };
  const userCache = (o) => { const c = makeTtlCache({ ...o, now: () => clock.t }); caches.push(c); return c; };
  const bustUser = (id) => caches.forEach((c) => c.bust(String(id)));
  let who = { id: '1' };
  const supabase = { rpc: async (name, args) => { calls.push({ name, args }); return (rpcs[name] || (() => ({ data: { ok: true } })))(args); },
    from: (t) => ({ select: (...a) => { calls.push({ name: 'from:' + t }); return { eq: () => ({ in: async () => ({ data: [] }) }) }; }, _unused: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }) }) };
  register(app, { supabase, caller: async () => who, rateLimit: () => true, bustUser, userCache, shardsOn: () => true, dungeonOn: () => true, getCatalogBase: async () => [], ...extra });
  const run = async (key, { body = {}, query = {} } = {}) => {
    let status = 200, json = null; const fin = [];
    const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, on(e, f) { if (e === 'finish') fin.push(f); } };
    await routes[key]({ body, query, path: key.split(' ')[1] }, res); fin.forEach((f) => f());
    return { status, json };
  };
  return { run, calls, clock, setWho: (m) => { who = m; }, bustUser };
}
const n = (calls, name) => calls.filter((c) => c.name === name).length;

test('shop: the second read within 10 s does not call shop_today; a buy or a bustUser drops it', async () => {
  const h = harness(registerShopRoutes, {}, { shop_today: () => ({ data: { ok: true, balance: 5, stock: [], next_at: new Date(2_000_000 + 9e7).toISOString() } }), shard_cfg: () => ({ data: { enabled: true } }) });
  await h.run('GET /api/shop'); await h.run('GET /api/shop');
  assert.equal(n(h.calls, 'shop_today'), 1);
  h.clock.t += 10_001; await h.run('GET /api/shop');
  assert.equal(n(h.calls, 'shop_today'), 2, 'ttl over');
  await h.run('POST /api/shop/buy', { body: { kind: 'pack', qty: 1 } }); await h.run('GET /api/shop');
  assert.equal(n(h.calls, 'shop_today'), 3, 'a buy drops the answer');
});
test('shop: a cache hit reads neither shop_today nor player_cards (the owned counts are in the cached answer)', async () => {
  const h = harness(registerShopRoutes, {}, { shop_today: () => ({ data: { ok: true, balance: 5, stock: [{ slot: 1, card_id: 7 }] } }) });
  await h.run('GET /api/shop'); await h.run('GET /api/shop'); await h.run('GET /api/shop');
  assert.equal(n(h.calls, 'shop_today'), 1); assert.equal(n(h.calls, 'from:player_cards'), 1);
});
test('shop: one member never reads the answer of another', async () => {
  const h = harness(registerShopRoutes, {}, { shop_today: (a) => ({ data: { ok: true, balance: Number(a.p_player), stock: [] } }) });
  const a = await h.run('GET /api/shop'); h.setWho({ id: '2' }); const b = await h.run('GET /api/shop');
  assert.equal(a.json.balance, 1); assert.equal(b.json.balance, 2);
});
test('shop: a refused answer is not kept', async () => {
  let ok = false;
  const h = harness(registerShopRoutes, {}, { shop_today: () => ({ data: ok ? { ok: true, stock: [] } : { ok: false, error: 'disabled' } }) });
  assert.equal((await h.run('GET /api/shop')).status, 400);
  ok = true; assert.equal((await h.run('GET /api/shop')).status, 200);
});
test('shop: an answer past next_at is not served', async () => {
  const h = harness(registerShopRoutes, {}, { shop_today: () => ({ data: { ok: true, stock: [], next_at: new Date(1_000_000 + 5000).toISOString() } }) });
  await h.run('GET /api/shop'); h.clock.t += 6000; await h.run('GET /api/shop');
  assert.equal(n(h.calls, 'shop_today'), 2);
});

const dvl = { dungeon_view_lite: () => ({ data: { ok: true, next_at: new Date(9e12).toISOString(), run: null } }), dungeon_view: () => ({ data: { ok: true, next_at: new Date(9e12).toISOString(), mine: [{ id: 1 }], run: null } }) };
test('dungeon: ?lite=1 reads dungeon_view_lite (no mine), has its own cache entry and a write drops both', async () => {
  const h = harness(registerDungeonRoutes, {}, { ...dvl, dungeon_start: () => ({ data: { ok: true } }) });
  const a = await h.run('GET /api/dungeon', { query: { lite: '1' } }); await h.run('GET /api/dungeon', { query: { lite: '1' } });
  assert.equal(n(h.calls, 'dungeon_view_lite'), 1); assert.equal(n(h.calls, 'dungeon_view'), 0); assert.equal(a.json.mine, undefined);
  const b = await h.run('GET /api/dungeon'); assert.equal(n(h.calls, 'dungeon_view'), 1); assert.ok(b.json.mine);
  await h.run('POST /api/dungeon/start', { body: { cards: [1, 2, 3, 4, 5] } });
  await h.run('GET /api/dungeon', { query: { lite: '1' } }); await h.run('GET /api/dungeon');
  assert.equal(n(h.calls, 'dungeon_view_lite'), 2); assert.equal(n(h.calls, 'dungeon_view'), 2);
});
test('dungeon: ?lite=1 falls back to dungeon_view while the migration is not live', async () => {
  const h = harness(registerDungeonRoutes, {}, { dungeon_view_lite: () => ({ error: { code: 'PGRST202', message: 'no function' } }), dungeon_view: () => ({ data: { ok: true, mine: [] } }) });
  const a = await h.run('GET /api/dungeon', { query: { lite: '1' } });
  assert.equal(a.status, 200); assert.deepEqual(a.json.mine, []);
});

const dv = { dungeon_view: () => ({ data: { ok: true, next_at: new Date(9e12).toISOString(), mine: [{ id: 1 }], run: null } }), gauntlet_view: () => ({ data: { ok: true, ends_at: new Date(9e12).toISOString(), squad: [] } }) };
test('dungeon: Home and the lobby share one view for 15 s; every write drops it', async () => {
  const h = harness(registerDungeonRoutes, {}, { ...dv, dungeon_start: () => ({ data: { ok: true } }) });
  await h.run('GET /api/dungeon'); await h.run('GET /api/dungeon'); await h.run('GET /api/gauntlet'); await h.run('GET /api/gauntlet');
  assert.equal(n(h.calls, 'dungeon_view'), 1); assert.equal(n(h.calls, 'gauntlet_view'), 1);
  await h.run('POST /api/dungeon/start', { body: { cards: [1, 2, 3, 4, 5] } });
  await h.run('GET /api/dungeon');
  assert.equal(n(h.calls, 'dungeon_view'), 2, 'the start dropped the cached view');
  h.clock.t += 15_001; await h.run('GET /api/dungeon');
  assert.equal(n(h.calls, 'dungeon_view'), 3);
});
test('dungeon: the view of one member is never given to another', async () => {
  const h = harness(registerDungeonRoutes, {}, { dungeon_view: (a) => ({ data: { ok: true, who: a.p_player, mine: [] } }) });
  const a = await h.run('GET /api/dungeon'); h.setWho({ id: '2' }); const b = await h.run('GET /api/dungeon');
  assert.equal(a.json.who, '1'); assert.equal(b.json.who, '2');
});
test('dungeon: a day that ended is not served again, an error is not kept', async () => {
  assert.equal(viewValid({ status: 200, body: { next_at: new Date(1000).toISOString() } }, 2000), false);
  assert.equal(viewValid({ status: 200, body: { next_at: new Date(5000).toISOString() } }, 2000), true);
  assert.equal(viewValid({ status: 200, body: { ends_at: new Date(1000).toISOString() } }, 2000), false);
  assert.equal(viewValid({ status: 400, body: { ok: false } }, 2000), false);
  let ok = false;
  const h = harness(registerDungeonRoutes, {}, { dungeon_view: () => ({ data: ok ? { ok: true, mine: [] } : { ok: false, error: 'disabled' } }) });
  assert.equal((await h.run('GET /api/dungeon')).status, 400);
  ok = true; assert.equal((await h.run('GET /api/dungeon')).status, 200);
  assert.equal(n(h.calls, 'dungeon_view'), 2);
});
