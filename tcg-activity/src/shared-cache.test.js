// The shared (all members) caches of the Activity server: the Dungeon / Gauntlet boards and the balance table (2026-10-11).
// node --test src/shared-cache.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerDungeonRoutes } from './dungeon-routes.js';
import { makeTtlCache } from './ttl-cache.js';
import { createBalance } from '../balance.js';

function harness() {
  const routes = {}; const calls = []; const clock = { t: 1_000_000 };
  const app = { get: (p, h) => { routes[`GET ${p}`] = h; }, post: (p, h) => { routes[`POST ${p}`] = h; } };
  let who = { id: '1' };
  const supabase = { rpc: async (name, args) => { calls.push({ name, args }); if (name === 'dungeon_board' || name === 'gauntlet_board') return { data: [{ rank: 1, player_id: '9' }] }; return { data: { ok: true } }; } };
  registerDungeonRoutes(app, { supabase, caller: async () => who, rateLimit: () => true, dungeonOn: () => true, getCatalogBase: async () => [],
    userCache: (o) => makeTtlCache({ ...o, now: () => clock.t }), sharedCache: (name, o) => makeTtlCache({ ...o, now: () => clock.t }) });
  const run = async (key, { body = {}, path } = {}) => {
    let status = 200, json = null; const fin = [];
    const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, on(e, f) { if (e === 'finish') fin.push(f); } };
    await routes[key]({ body, query: {}, path: path || key.split(' ')[1] }, res); fin.forEach((f) => f());
    return { status, json };
  };
  return { run, calls, clock, setWho: (m) => { who = m; } };
}
const n = (calls, name) => calls.filter((c) => c.name === name).length;

test('boards: two members read one dungeon_board and one gauntlet_board (the answer is the same for everyone)', async () => {
  const h = harness();
  const a = await h.run('GET /api/dungeon/board'); h.setWho({ id: '2' }); const b = await h.run('GET /api/dungeon/board');
  await h.run('GET /api/gauntlet/board'); await h.run('GET /api/gauntlet/board');
  assert.equal(n(h.calls, 'dungeon_board'), 1); assert.equal(n(h.calls, 'gauntlet_board'), 1);
  assert.equal(a.json.me, '1'); assert.equal(b.json.me, '2', 'the member id is never shared');
  assert.deepEqual(a.json.board, b.json.board);
});
test('boards: expire after 5 s; a start or a retreat drops them at once; an attack does not', async () => {
  const h = harness();
  await h.run('GET /api/dungeon/board'); h.clock.t += 5001; await h.run('GET /api/dungeon/board');
  assert.equal(n(h.calls, 'dungeon_board'), 2, 'ttl over (stale value served, one refresh)');
  await h.run('GET /api/dungeon/board'); await h.run('POST /api/dungeon/attack', { body: { cardId: 5 } }); await h.run('GET /api/dungeon/board');
  const before = n(h.calls, 'dungeon_board');
  await h.run('POST /api/dungeon/start', { body: { cards: [1, 2, 3, 4, 5] } }); await h.run('GET /api/dungeon/board');
  assert.equal(n(h.calls, 'dungeon_board'), before + 1, 'a start drops the board');
  await h.run('POST /api/dungeon/retreat', {}); await h.run('GET /api/dungeon/board');
  assert.equal(n(h.calls, 'dungeon_board'), before + 2, 'a retreat drops the board');
});
test('boards: a failed read answers 500 and is not kept', async () => {
  const routes = {}; let fail = true; let calls = 0;
  const app = { get: (p, h) => { routes[`GET ${p}`] = h; }, post: () => {} };
  const supabase = { rpc: async () => { calls += 1; return fail ? { error: { message: 'boom' } } : { data: [] }; } };
  registerDungeonRoutes(app, { supabase, caller: async () => ({ id: '1' }), rateLimit: () => true, dungeonOn: () => true, getCatalogBase: async () => [],
    sharedCache: (name, o) => makeTtlCache(o) });
  const call = async () => { let s = 200; await routes['GET /api/dungeon/board']({ query: {}, path: '/api/dungeon/board' }, { status(x) { s = x; return this; }, json() { return this; } }); return s; };
  assert.equal(await call(), 500); fail = false; assert.equal(await call(), 200); assert.equal(calls, 2);
});

test('balance: an expired table is served at once and refreshed behind; a failed refresh keeps the copy; the first read waits', async () => {
  let t = 0; let loads = 0; let fail = false; let release = null;
  const load = () => { loads += 1; if (fail) return Promise.reject(new Error('down')); return new Promise((r) => { const v = { rarity_cp: { x: loads }, stars: {} }; if (loads === 1) r(v); else release = () => r(v); }); };
  const get = createBalance(load, { ttl: 60_000, now: () => t });
  assert.equal((await get()).rarity_cp.x, 1);
  t = 30_000; await get(); assert.equal(loads, 1, 'fresh');
  t = 61_000; assert.equal((await get()).rarity_cp.x, 1, 'stale copy served without waiting'); assert.equal(loads, 2);
  await get(); assert.equal(loads, 2, 'one refresh at a time');
  release(); await new Promise((r) => setImmediate(r)); assert.equal((await get()).rarity_cp.x, 2, 'the refresh landed');
  t = 130_000; fail = true; assert.equal((await get()).rarity_cp.x, 2, 'failed refresh keeps the copy'); await new Promise((r) => setImmediate(r));
  assert.equal((await get()).rarity_cp.x, 2);
});
test('balance: with no copy a failed load throws (fail closed)', async () => {
  const get = createBalance(async () => { throw new Error('down'); }, { now: () => 0 });
  await assert.rejects(get(), /down/);
});
