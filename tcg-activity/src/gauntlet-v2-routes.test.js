// node --test src/gauntlet-v2-routes.test.js      (a mutation: MUTATE=<name> node --test src/gauntlet-v2-routes.test.js)
// R1c: the Gauntlet v2 routes for testers (gauntlet-v2-routes.js). The gate of the R1c spec, conditions G-C1..G-C6:
//   G-C1 every v1 route gives the same status, JSON bytes and RPC calls with and without the v2 module (both orders).
//   G-C2 a non-tester gets 403 not_tester on every v2 route and no v2 write call; the member comes from the token only.
//   G-C3 D4: a member off the list with an active gauntlet_v2 run still plays it.
//   G-C4 the choice has only use, target, ally (the engine shapes); max is clamped by the v1 Auto rule; Finish = FINISH_MAX.
//   G-C5 every error code gives 400 with its message (403 for not_tester), detail kept; a transport error gives 500.
//   G-C6 ref (3 lists, ord order, named keys only, one read for 2 GETs); cards for every state.squad id.
// The fake app runs the handlers in registration order with next(), as Express does, and the caches are the real ttl-cache.js.
// A mutation is a copy of the real file with ONE text change (each text must match exactly once), loaded by this same test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerDungeonRoutes, AUTO_MAX } from './dungeon-routes.js';
import { makeTtlCache } from './ttl-cache.js';

const here = dirname(fileURLToPath(import.meta.url));
export const MUTATIONS = {
  no_tester_check: ['return data === true;', 'return true;'],
  player_from_body: ['const player = String(me.id);', 'const player = String(req.body?.player ?? req.query?.player ?? me.id);'],
  no_d4: ["if (data?.ok && data.active_mode === 'gauntlet_v2') return { player, view: data };", ''],
  choice_passthrough: ['p_choice: choiceOf(req.body)', 'p_choice: req.body'],
  no_max_clamp: ['p_max: autoMax(req.body?.max)', 'p_max: Number(req.body?.max)'],
  v1_touched: ['  // The tester bit of each member', "  app.get('/api/gauntlet', (req, res, next) => { const j = res.json.bind(res); res.json = (b) => j({ ...b, engine: 1 }); next(); });\n  // The tester bit of each member"],
  message_missing: [" bad_max: 'Auto failed.',", ''],
  ref_uncached: ["data.ref = await refs.get('ref', loadRef);", 'data.ref = await loadRef();'],
  cards_missing: ['if (!Array.isArray(squad)) return data;', 'return data;'],
  // Extra (not in the spec table): the module patches a shared dependency, so a v1 answer changes whatever the order.
  shared_dep_patched: ['  // The tester bit of each member', "  { const r0 = supabase.rpc; supabase.rpc = async (...a) => { const r = await r0(...a); if (a[0] === 'gauntlet_view' && r?.data) r.data = { ...r.data, v2: true }; return r; }; }\n  // The tester bit of each member"],
  // Extra: the raw ids reach the engine (combat_v2_card_act refuses a target that is not {side: enemy, id}).
  choice_raw_ids: ["c.target = { side: 'enemy', id: t };", 'c.target = t;'],
  // R1-ON (the cache drop after a v2 write): the spec mutation, and a board that is never dropped at a run end
  no_cache_clear: ['try { onRunChange?.(player, ended); }', 'try { /* no cache drop */ }'],
  board_not_cleared: ['try { onRunChange?.(player, ended); }', 'try { onRunChange?.(player, false); }'],
};
async function loadModule() {
  const name = process.env.MUTATE;
  if (!name) return import('./gauntlet-v2-routes.js');
  const m = MUTATIONS[name]; if (!m) throw new Error(`unknown mutation ${name}`);
  let src = readFileSync(join(here, 'gauntlet-v2-routes.js'), 'utf8');
  const n = src.split(m[0]).length - 1; if (n !== 1) throw new Error(`mutation ${name}: the text matches ${n} times, not once`);
  src = src.replace(m[0], m[1]).replace("'./dungeon-routes.js'", JSON.stringify(pathToFileURL(join(here, 'dungeon-routes.js')).href));
  const file = join(mkdtempSync(join(tmpdir(), 'r1c-mut-')), `gauntlet-v2-routes.${name}.mjs`);
  writeFileSync(file, src);
  console.log(`# MUTATE=${name} (${file})`);
  return import(pathToFileURL(file).href);
}
const { registerGauntletV2Routes, FINISH_MAX } = await loadModule();

// The messages of the spec (R1c SPEC 3.1 item 6), held here and not read from the module.
const SPEC_MSG = {
  disabled: 'The Gauntlet is closed.', no_run: 'You have no run in progress.', not_fighting: 'There is no fight in this room.',
  bad_state: 'This fight cannot go on. Tell an admin.', bad_choice: 'That move is not possible now.', bad_max: 'Auto failed.',
  not_choosing: 'There is nothing to choose.', bad_pick: 'Pick one of the rewards.',
  not_between_floors: 'You can leave only between floors, after the guardian.', not_tester: 'Combat v2 is for testers only.',
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const CATALOG = [
  { id: 11, name: 'Kroc Bot', rarity: 'rare', image_url: 'u11', type: 'robot', tags: ['x'], ability: 'a' },
  { id: 12, name: 'Water Golem', rarity: 'common', image_url: 'u12', type: 'golem', tags: [], ability: 'b' },
  { id: 13, name: 'Ember', rarity: 'epic', image_url: 'u13', type: 'fire', tags: [], ability: 'c' },
];
// The tables in a mixed order with every column (the route must order by ord and keep only the named keys).
const TABLES = {
  statuses: [
    { key: 'chill', ord: 2, kind: 'k', label: 'Chill', family: 'tempo', negative: true, icon: 'chill', rule: '-{chill.dmg} damage', note: 'n', verb: 'v' },
    { key: 'poison', ord: 1, kind: 'k', label: 'Poison', family: 'dot', negative: true, icon: 'poison', rule: '{poison.tick} a turn', note: 'n', verb: 'v' },
    { key: 'shielded', ord: 3, kind: 'k', label: 'Shielded', family: 'guard', negative: false, icon: 'shield', rule: 'absorbs {value}', note: null, verb: null },
  ],
  roles: [{ key: 'medic', ord: 2, class: 'support', label: 'Medic', purpose: 'p', auto: {} }, { key: 'striker', ord: 1, class: 'attacker', label: 'Striker', purpose: 'p', auto: {} }],
  enemy_mechanics: [{ key: 'wall', ord: 2, kind: 'rule', label: 'Wall', text: 't' }, { key: 'toxic', ord: 1, kind: 'passive', label: 'Toxic', text: 't' }],
};
const STATE = { engine: 2, squad: [11, 12, 13], phase: 'fight' };
// The answers of a member who is NOT a tester and has no v2 run, and of every v1 function.
const baseRpc = ({ tester = false, activeMode = null } = {}) => (name) => {
  if (name === 'combat_v2_on') return { data: tester, error: null };
  if (name === 'gauntlet_v2_view') return { data: { ok: true, tester, run: activeMode === 'gauntlet_v2' ? { id: 5, state: clone(STATE) } : null, runs_left: 1, active_mode: activeMode, can_start: !activeMode }, error: null };
  if (name.startsWith('gauntlet_v2_')) return { data: { ok: true, state: clone(STATE), status: 'active', log: [] }, error: null };
  if (name.endsWith('_board')) return { data: [{ player: '1', floor: 3 }], error: null };
  if (name === 'gauntlet_view') return { data: { ok: true, week: 7, squad: [{ id: 11 }, { id: 12 }], run: null }, error: null };
  return { data: { ok: true, run: { id: 9, cards: [12], state: { bank: { cards: [11] } } }, state: { phase: 'fight' }, rounds: [], status: 'active' }, error: null };
};

function harness({ rpc = baseRpc(), v1 = true, v2 = true, v2First = false, me = { id: '77' }, rateOk = true, on = true } = {}) {
  const stack = []; const calls = []; const reads = [];
  const add = (method) => (path, ...hs) => { for (const h of hs) stack.push({ method, path, h }); };
  const app = { get: add('GET'), post: add('POST'), use: (p, h) => (typeof p === 'function' ? stack.push({ method: '*', path: null, h: p }) : stack.push({ method: '*', path: p, h })) };
  const query = (table) => {
    const q = { cols: null, ord: null };
    const run = () => { reads.push({ table, cols: q.cols, ord: q.ord }); let rows = clone(TABLES[table]); if (q.ord) rows.sort((a, b) => a[q.ord] - b[q.ord]); return { data: rows, error: null }; };
    const api = { select(c) { q.cols = c; return api; }, order(c) { q.ord = c; return api; }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko); } };
    return api;
  };
  const supabase = { rpc: async (name, args) => { calls.push({ name, args: clone(args) }); return clone(rpc(name, args)); }, from: query };
  const deps = {
    supabase, caller: async () => me, rateLimit: () => rateOk, getCatalogBase: async () => clone(CATALOG), dungeonOn: () => on,
    onRun: (m, mode) => calls.push({ onRun: mode }), userCache: (o) => makeTtlCache(o), sharedCache: (_n, o) => makeTtlCache(o),
  };
  // R1-ON: the v2 module gets the cache hook of the v1 module, as server.js wires it (read at call time, so either order works)
  let v1h = null;
  const regV1 = () => v1 && (v1h = registerDungeonRoutes(app, deps));
  const regV2 = () => v2 && registerGauntletV2Routes(app, { ...deps, onRunChange: (...a) => v1h?.gauntletRunChanged(...a) });
  if (v2First) { regV2(); regV1(); } else { regV1(); regV2(); }
  const request = async (method, path, body = {}, q = {}) => {
    let status = 200, json, sent = false; const fin = [];
    const res = { status(s) { status = s; return this; }, json(j) { json = clone(j); sent = true; for (const f of fin) f(); return this; }, on(ev, f) { if (ev === 'finish') fin.push(f); } };
    const req = { method, path, body: clone(body), query: clone(q), headers: {} };
    const match = stack.filter((r) => (r.method === '*' || r.method === method) && (r.path === null || r.path === path));
    let i = 0;
    const next = async () => { const r = match[i++]; if (r) await r.h(req, res, next); };
    await next();
    return sent ? { status, json } : { status: 404, json: null };
  };
  return { calls, reads, stack, get: (p, q) => request('GET', p, undefined, q), post: (p, b, q) => request('POST', p, b, q) };
}

const V2_ROUTES = [['GET', '/api/gauntlet/v2'], ['POST', '/api/gauntlet/v2/act'], ['POST', '/api/gauntlet/v2/auto'], ['POST', '/api/gauntlet/v2/finish'], ['POST', '/api/gauntlet/v2/choose'], ['POST', '/api/gauntlet/v2/retreat']];
const call = (h, [m, p], body, q) => (m === 'GET' ? h.get(p, q) : h.post(p, body, q));
const rpcNames = (h) => h.calls.filter((c) => c.name).map((c) => c.name);

// ------------------------------------------------------------------ G-C1
const v1Routes = () => { const h = harness({ v2: false }); return h.stack.map((r) => [r.method, r.path]); };
const V1_BODY = { mode: 'gauntlet', cardId: 11, target: 0, targetCard: 12, targetFoe: 1, pick: 0, cards: [11, 12, 13, 14, 15], max: 3, player: '999' };
for (const tester of [false, true]) {
  for (const v2First of [false, true]) {
    test(`G-C1 v1 routes unchanged (${tester ? 'tester' : 'non-tester'}, v2 registered ${v2First ? 'before' : 'after'} v1)`, async () => {
      const routes = v1Routes();
      assert.ok(routes.length >= 13, `the v1 module registers ${routes.length} routes`);
      for (const r of routes) {
        for (const body of [V1_BODY, {}]) {
          const a = harness({ v2: false, rpc: baseRpc({ tester }) }); const b = harness({ v2First, rpc: baseRpc({ tester }) });
          const ra = await call(a, r, body, { lite: body === V1_BODY ? '1' : undefined }); const rb = await call(b, r, body, { lite: body === V1_BODY ? '1' : undefined });
          assert.equal(rb.status, ra.status, `${r[1]} status`);
          assert.equal(JSON.stringify(rb.json), JSON.stringify(ra.json), `${r[1]} JSON bytes`);
          assert.deepEqual(b.calls, a.calls, `${r[1]} RPC calls`);
        }
      }
    });
  }
}
test('G-C1 the v2 module registers only /api/gauntlet/v2 paths', () => {
  const h = harness({ v1: false });
  assert.deepEqual(h.stack.map((r) => [r.method, r.path]), V2_ROUTES);
});

// ------------------------------------------------------------------ G-C2
for (const r of V2_ROUTES) {
  test(`G-C2 non-tester ${r[0]} ${r[1]}: 403 not_tester, only combat_v2_on + gauntlet_v2_view, member from the token`, async () => {
    const h = harness();
    const out = await call(h, r, { player: '999', p_player: '999', use: 'basic', target: 0, pick: 0, max: 2 }, { player: '999', p_player: '999' });
    assert.equal(out.status, 403); assert.equal(out.json.error, 'not_tester'); assert.equal(out.json.message, SPEC_MSG.not_tester); assert.equal(out.json.ok, false);
    assert.deepEqual(rpcNames(h), ['combat_v2_on', 'gauntlet_v2_view']);
    assert.deepEqual(h.calls[0].args, { p_mode: 'gauntlet', p_player: '77' });
    for (const c of h.calls) assert.equal(c.args.p_player, '77');
    assert.equal(h.reads.length, 0, 'no ref read for a non-tester');
  });
}
test('G-C2 a tester: combat_v2_on then the one function, the member from the token, the tester bit cached', async () => {
  const h = harness({ rpc: baseRpc({ tester: true }) });
  for (const r of V2_ROUTES) await call(h, r, { player: '999', p_player: '999', use: 'basic', target: 0 }, { player: '999' });
  assert.deepEqual(rpcNames(h), ['combat_v2_on', 'gauntlet_v2_view', 'gauntlet_v2_act', 'gauntlet_v2_auto', 'gauntlet_v2_auto', 'gauntlet_v2_choose', 'gauntlet_v2_retreat']);
  for (const c of h.calls) assert.equal(c.args.p_player, '77');
});
test('G-C2 the gate order: 401, 403 off, 429 on a write, each with no RPC call', async () => {
  const a = harness({ me: null }); assert.equal((await a.post('/api/gauntlet/v2/act', {})).status, 401); assert.equal(a.calls.length, 0);
  const b = harness({ on: false }); const rb = await b.get('/api/gauntlet/v2'); assert.equal(rb.status, 403); assert.equal(rb.json.error, 'off'); assert.equal(b.calls.length, 0);
  const c = harness({ rateOk: false }); assert.equal((await c.post('/api/gauntlet/v2/auto', {})).status, 429); assert.equal(c.calls.length, 0);
});
test('G-C2 a failed tester read is a 500 and is not cached', async () => {
  let fail = true;
  const h = harness({ rpc: (n, a) => (n === 'combat_v2_on' && fail ? { data: null, error: { message: 'boom' } } : baseRpc({ tester: true })(n, a)) });
  const r1 = await h.get('/api/gauntlet/v2'); assert.equal(r1.status, 500); assert.equal(r1.json.error, 'boom');
  fail = false; const r2 = await h.get('/api/gauntlet/v2'); assert.equal(r2.status, 200);
});

// ------------------------------------------------------------------ G-C3
test('G-C3 D4: off the list with an active gauntlet_v2 run: /act reaches gauntlet_v2_act; a v1 run does not', async () => {
  const h = harness({ rpc: baseRpc({ tester: false, activeMode: 'gauntlet_v2' }) });
  const r = await h.post('/api/gauntlet/v2/act', { use: 'basic', target: 1 });
  assert.equal(r.status, 200); assert.deepEqual(rpcNames(h), ['combat_v2_on', 'gauntlet_v2_view', 'gauntlet_v2_act']);
  const g = harness({ rpc: baseRpc({ tester: false, activeMode: 'gauntlet_v2' }) });
  const rg = await g.get('/api/gauntlet/v2'); assert.equal(rg.status, 200); assert.equal(rg.json.active_mode, 'gauntlet_v2');
  assert.deepEqual(rpcNames(g), ['combat_v2_on', 'gauntlet_v2_view'], 'the D4 view answer is kept for the GET');
  const v1 = harness({ rpc: baseRpc({ tester: false, activeMode: 'gauntlet' }) });
  assert.equal((await v1.post('/api/gauntlet/v2/act', { use: 'basic', target: 1 })).status, 403);
});

// ------------------------------------------------------------------ G-C4
test('G-C4 the choice: only use, target, ally, in the engine shapes (no actor, no other key)', async () => {
  const h = harness({ rpc: baseRpc({ tester: true }) });
  await h.post('/api/gauntlet/v2/act', { use: 'active', target: 2, ally: 5, actor: 9, x: 1 });
  await h.post('/api/gauntlet/v2/act', { use: 'basic', target: '0' });
  await h.post('/api/gauntlet/v2/act', { use: 'charge', target: 'a', ally: -3 });
  await h.post('/api/gauntlet/v2/act', null);
  const ch = h.calls.filter((c) => c.name === 'gauntlet_v2_act').map((c) => c.args.p_choice);
  assert.deepEqual(ch, [
    { use: true, target: { side: 'enemy', id: 2 }, ally: { side: 'card', id: 5 } },
    { use: false, target: { side: 'enemy', id: 0 } },
    { use: null },
    { use: null },
  ]);
  for (const c of ch) for (const k of Object.keys(c)) assert.ok(['use', 'target', 'ally'].includes(k), k);
});
test('G-C4 max: 1..AUTO_MAX by the v1 Auto rule; Finish sends FINISH_MAX; pick by the idx rule', async () => {
  assert.equal(FINISH_MAX, 1000);
  for (const [sent, want] of [[undefined, AUTO_MAX], [0, AUTO_MAX], ['a', AUTO_MAX], [-4, 1], [1, 1], [3, 3], [99, AUTO_MAX], [2.5, 2]]) {
    const h = harness({ rpc: baseRpc({ tester: true }) }); await h.post('/api/gauntlet/v2/auto', { max: sent });
    assert.equal(h.calls.at(-1).args.p_max, want, `max ${sent}`);
  }
  const f = harness({ rpc: baseRpc({ tester: true }) }); await f.post('/api/gauntlet/v2/finish', { max: 2 });
  assert.deepEqual(f.calls.at(-1), { name: 'gauntlet_v2_auto', args: { p_player: '77', p_max: FINISH_MAX } });
  for (const [sent, want] of [[0, 0], [3, 3], ['9', 9], [10, null], ['x', null]]) {
    const h = harness({ rpc: baseRpc({ tester: true }) }); await h.post('/api/gauntlet/v2/choose', { pick: sent });
    assert.equal(h.calls.at(-1).args.p_pick, want, `pick ${sent}`);
  }
});

// ------------------------------------------------------------------ G-C5
const CODES = [
  ['disabled', 'GET', '/api/gauntlet/v2', 'gauntlet_v2_view'], ['no_run', 'POST', '/api/gauntlet/v2/act', 'gauntlet_v2_act'],
  ['not_fighting', 'POST', '/api/gauntlet/v2/act', 'gauntlet_v2_act'], ['bad_state', 'POST', '/api/gauntlet/v2/auto', 'gauntlet_v2_auto'],
  ['bad_choice', 'POST', '/api/gauntlet/v2/act', 'gauntlet_v2_act'], ['bad_max', 'POST', '/api/gauntlet/v2/finish', 'gauntlet_v2_auto'],
  ['not_choosing', 'POST', '/api/gauntlet/v2/choose', 'gauntlet_v2_choose'], ['bad_pick', 'POST', '/api/gauntlet/v2/choose', 'gauntlet_v2_choose'],
  ['not_between_floors', 'POST', '/api/gauntlet/v2/retreat', 'gauntlet_v2_retreat'],
];
for (const [code, m, p, fn] of CODES) {
  test(`G-C5 ${code}: HTTP 400, the spec message, detail kept`, async () => {
    const h = harness({ rpc: (n, a) => (n === fn ? { data: { ok: false, error: code, detail: 'engine text' }, error: null } : baseRpc({ tester: true })(n, a)) });
    const r = await call(h, [m, p], { use: 'basic', target: 0 });
    assert.equal(r.status, 400); assert.equal(r.json.ok, false); assert.equal(r.json.error, code);
    assert.equal(r.json.message, SPEC_MSG[code]); assert.equal(r.json.detail, 'engine text');
  });
}
test('G-C5 not_tester: HTTP 403 with the spec message (the 10th code)', async () => {
  const r = await harness().post('/api/gauntlet/v2/retreat', {});
  assert.equal(r.status, 403); assert.equal(r.json.message, SPEC_MSG.not_tester);
});
test('G-C5 a transport error gives 500 on every v2 route', async () => {
  for (const r of V2_ROUTES) {
    const h = harness({ rpc: (n, a) => (n.startsWith('gauntlet_v2_') ? { data: null, error: { message: 'down' } } : baseRpc({ tester: true })(n, a)) });
    const out = await call(h, r, {}); assert.equal(out.status, 500, r[1]); assert.equal(out.json.error, 'down');
  }
});

// ------------------------------------------------------------------ G-C6
test('G-C6 ref: 3 lists in ord order with only the named keys; one read for 2 GETs', async () => {
  const h = harness({ rpc: baseRpc({ tester: true }) });
  const r = await h.get('/api/gauntlet/v2');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.ref, {
    statuses: [
      { key: 'poison', label: 'Poison', icon: 'poison', family: 'dot', negative: true, rule: '{poison.tick} a turn' },
      { key: 'chill', label: 'Chill', icon: 'chill', family: 'tempo', negative: true, rule: '-{chill.dmg} damage' },
      { key: 'shielded', label: 'Shielded', icon: 'shield', family: 'guard', negative: false, rule: 'absorbs {value}' },
    ],
    roles: [{ key: 'striker', class: 'attacker', label: 'Striker' }, { key: 'medic', class: 'support', label: 'Medic' }],
    mechanics: [{ key: 'toxic', label: 'Toxic' }, { key: 'wall', label: 'Wall' }],
  });
  await h.get('/api/gauntlet/v2');
  assert.equal(h.reads.length, 3, 'one read of each table for 2 GETs');
  assert.deepEqual(h.reads.map((x) => x.ord), ['ord', 'ord', 'ord']);
});
test('G-C6 cards: the catalog fields for each state.squad id (write answers and the view), none on retreat', async () => {
  const want = {
    11: { id: 11, name: 'Kroc Bot', rarity: 'rare', image_url: 'u11', type: 'robot' },
    12: { id: 12, name: 'Water Golem', rarity: 'common', image_url: 'u12', type: 'golem' },
    13: { id: 13, name: 'Ember', rarity: 'epic', image_url: 'u13', type: 'fire' },
  };
  for (const r of V2_ROUTES.slice(1, 5)) {
    const h = harness({ rpc: baseRpc({ tester: true }) }); const out = await call(h, r, { use: 'basic', target: 0 });
    assert.deepEqual(out.json.cards, want, r[1]);
  }
  const v = await harness({ rpc: baseRpc({ tester: false, activeMode: 'gauntlet_v2' }) }).get('/api/gauntlet/v2');
  assert.deepEqual(v.json.cards, want, 'the view: run.state.squad');
  const rt = await harness({ rpc: baseRpc({ tester: true }) }).post('/api/gauntlet/v2/retreat', {});
  assert.equal(rt.json.cards, undefined);
});

// ------------------------------------------------------------------ R1-ON: a v2 write drops the cached Gauntlet view and, at a run end, the board
// The view (15 s) and the board (5 s) read member v2 runs since combat_v2_on_gauntlet.sql. A member who ends a v2 run and opens the
// lobby or the board within the cache time must see the new best (orchestrator KEEP from the R1e review r4 F-3; mutation no_cache_clear).
const liveRpc = (st) => (name) => {
  if (name === 'combat_v2_on') return { data: true, error: null };
  if (name === 'gauntlet_view') return { data: { ok: true, week: 7, best: { floor: st.best }, runs_left: st.left }, error: null };
  if (name === 'gauntlet_board') return { data: [{ player_id: '77', floor: st.best }], error: null };
  if (name === 'gauntlet_v2_retreat') { st.best = st.next; st.left = 0; return { data: { ok: true, floor: st.next, room: 1 }, error: null }; }
  if (name.startsWith('gauntlet_v2_')) {
    st.best = st.next; if (st.end) st.left = 0;
    return { data: { ok: true, state: clone(STATE), status: st.end ? 'over' : 'active', log: [] }, error: null };
  }
  return baseRpc({ tester: true })(name);
};
for (const [route, body, end] of [['/api/gauntlet/v2/finish', {}, true], ['/api/gauntlet/v2/auto', { max: 1 }, true], ['/api/gauntlet/v2/act', { use: 'basic', target: 0 }, true], ['/api/gauntlet/v2/retreat', {}, false]]) {
  test(`R1-ON a v2 run end by ${route.split('/').pop()} drops the cached GET /api/gauntlet and the board: the new best at once`, async () => {
    const st = { best: 2, next: 6, left: 1, end };
    const h = harness({ rpc: liveRpc(st) });
    assert.equal((await h.get('/api/gauntlet')).json.best.floor, 2);
    assert.equal((await h.get('/api/gauntlet/board')).json.board[0].floor, 2);
    assert.equal((await h.get('/api/gauntlet')).json.best.floor, 2, 'the second GET is the cached answer');
    const w = await h.post(route, body);
    assert.equal(w.status, 200);
    const v = await h.get('/api/gauntlet'); const b = await h.get('/api/gauntlet/board');
    assert.equal(v.json.best.floor, 6, 'the lobby best within the 15 s view cache');
    assert.equal(v.json.runs_left, 0, 'runs_left within the view cache');
    assert.equal(b.json.board[0].floor, 6, 'the board within the 5 s board cache');
  });
}
test('R1-ON a v2 write that does not end the run drops the member view only (the board stays cached)', async () => {
  const st = { best: 2, next: 3, left: 1, end: false };
  const h = harness({ rpc: liveRpc(st) });
  await h.get('/api/gauntlet'); await h.get('/api/gauntlet/board');
  await h.post('/api/gauntlet/v2/act', { use: 'basic', target: 0 });
  assert.equal((await h.get('/api/gauntlet')).json.best.floor, 3, 'the member view is read again');
  assert.equal(h.calls.filter((c) => c.name === 'gauntlet_board').length, 1, 'no second board read');
});
test('R1-ON a refused v2 write and a transport error never drop the shared board (the member view drop is the v1 rule of every write)', async () => {
  for (const bad of [{ data: { ok: false, error: 'not_fighting' }, error: null }, { data: null, error: { message: 'down' } }]) {
    const st = { best: 2, next: 6, left: 1, end: true };
    const r0 = liveRpc(st);
    const h = harness({ rpc: (n, a) => (n === 'gauntlet_v2_auto' ? bad : r0(n, a)) });
    await h.get('/api/gauntlet'); await h.get('/api/gauntlet/board');
    await h.post('/api/gauntlet/v2/finish', {});
    await h.get('/api/gauntlet'); await h.get('/api/gauntlet/board');
    assert.equal(h.calls.filter((c) => c.name === 'gauntlet_board').length, 1, 'the board stays cached');
  }
});
test('R1-ON server.js passes the v1 cache hook to the v2 routes', () => {
  const src = readFileSync(join(here, '..', 'server.js'), 'utf8');
  assert.ok(src.includes('const dungeonCaches = registerDungeonRoutes(app, '), 'server.js keeps the hooks of registerDungeonRoutes');
  assert.match(src, /registerGauntletV2Routes\(app, \{[^}]*onRunChange: dungeonCaches\.gauntletRunChanged \}\)/);
});
