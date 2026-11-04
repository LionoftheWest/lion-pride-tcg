// node --test src/dungeon-v2-routes.test.js      (a mutation: MUTATE=<name> node --test src/dungeon-v2-routes.test.js; MUTATE=all runs each)
// R2b: the Dungeon v2 routes for testers (dungeon-v2-routes.js). The gate of R2 SPEC v3 G6 and the R2b rows of 3.4:
//   G6a a non-tester gets 403 not_tester on every v2 route after ONE dungeon_v2_view call and 0 other RPC calls.
//   G6b every route passes only p_player from the token (a body or query player is ignored).
//   G6c v1 unchanged: every v1 Dungeon / Gauntlet route (and the R1c Gauntlet v2 routes) gives the same status, JSON bytes and RPC calls
//       with and without the module, in both orders; the module registers only /api/dungeon/v2 paths.
//   G6d D4: off the list with an active v2 run, the run plays on (not the start); a tester bit is cached 60 s.
//   G6e the bodies: the start cards (the v1 rule), the choice (only use, target, ally), max, Finish = FINISH_MAX, pick.
//   G6f every R2a error code: 400 with its message and every key kept (detail, cards, need, cost, budget); transport error 500.
//   G6g ref (3 lists, ord order, one read for 2 GETs) and cards for every state.squad id.
// A mutation is a copy of the real file with ONE text change (each text must match exactly once), loaded by this same test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { registerDungeonRoutes, AUTO_MAX } from './dungeon-routes.js';
import { registerGauntletV2Routes } from './gauntlet-v2-routes.js';
import { makeTtlCache } from './ttl-cache.js';

const here = dirname(fileURLToPath(import.meta.url));
export const MUTATIONS = {
  // R2 SPEC G6: a route that trusts body.player.
  player_from_body: ['const player = String(me.id);', 'const player = String(req.body?.player ?? req.query?.player ?? me.id);'],
  no_tester_check: ['if (data.tester === true) {', 'if (true) {'],
  extra_rpc: ["const { data, error } = await supabase.rpc('dungeon_v2_view', { p_player: player });", "await supabase.rpc('combat_v2_on', { p_mode: 'dungeon', p_player: player }); const { data, error } = await supabase.rpc('dungeon_v2_view', { p_player: player });"],
  no_d4: ["if (!start && data.run?.status === 'active') return { player, view: data };", ''],
  d4_on_start: ["if (!start && data.run?.status === 'active')", "if (data.run?.status === 'active')"],
  choice_passthrough: ['p_choice: choiceOf(req.body)', 'p_choice: req.body'],
  no_max_clamp: ['p_max: autoMax(req.body?.max)', 'p_max: Number(req.body?.max)'],
  cards_unparsed: ['p_cards: cardsOf(req.body)', 'p_cards: req.body?.cards'],
  v1_touched: ['  // The tester bit of each member', "  app.get('/api/dungeon', (req, res, next) => { const j = res.json.bind(res); res.json = (b) => j({ ...b, engine: 1 }); next(); });\n  // The tester bit of each member"],
  message_missing: [" no_v2: 'A card in your squad has no v2 active yet.',", ''],
  keys_dropped: ['res.status(400).json({ ...data, ok: false,', 'res.status(400).json({ error: data?.error, ok: false,'],
  ref_uncached: ["data.ref = await refs.get('ref', loadRef);", 'data.ref = await loadRef();'],
  cards_missing: ['if (!Array.isArray(squad)) return data;', 'return data;'],
};

// MUTATE=all: run this file once for each mutation, after the baseline, in the same run; each must FAIL.
if (process.env.MUTATE === 'all') {
  const self = fileURLToPath(import.meta.url);
  // A clean child: no NODE_TEST_CONTEXT (else the child reports to this runner and exits 0), the TAP reporter.
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const run = (name) => spawnSync(process.execPath, ['--test', '--test-reporter=tap', self], { env: { ...env, MUTATE: name }, encoding: 'utf8' });
  const tap = (out) => { const p = /# pass (\d+)/.exec(out)?.[1]; const f = /# fail (\d+)/.exec(out)?.[1]; return `pass ${p} fail ${f}`; };
  test('MUTATE=all: the baseline passes and every mutation fails', () => {
    const base = run('');
    console.log(`# baseline: ${tap(base.stdout)} -> ${base.status === 0 ? 'PASS' : 'FAIL'}`);
    assert.equal(base.status, 0, 'baseline');
    const missed = [];
    for (const name of Object.keys(MUTATIONS)) {
      const r = run(name);
      const failed = r.status !== 0 && !/the text matches/.test(r.stdout + r.stderr);
      console.log(`# ${name}: ${tap(r.stdout)} -> ${failed ? 'FAILS (caught)' : 'PASSES (NOT caught)'}`);
      if (!failed) missed.push(name);
    }
    console.log(`# all ${Object.keys(MUTATIONS).length - missed.length} of ${Object.keys(MUTATIONS).length} caught`);
    assert.deepEqual(missed, []);
  });
} else {
  await suite();
}

async function loadModule() {
  const name = process.env.MUTATE;
  if (!name) return import('./dungeon-v2-routes.js');
  const m = MUTATIONS[name]; if (!m) throw new Error(`unknown mutation ${name}`);
  let src = readFileSync(join(here, 'dungeon-v2-routes.js'), 'utf8');
  const n = src.split(m[0]).length - 1; if (n !== 1) throw new Error(`mutation ${name}: the text matches ${n} times, not once`);
  src = src.replace(m[0], m[1]);
  for (const f of ['dungeon-routes.js', 'gauntlet-v2-routes.js']) src = src.replace(`'./${f}'`, JSON.stringify(pathToFileURL(join(here, f)).href));
  const file = join(mkdtempSync(join(tmpdir(), 'r2b-mut-')), `dungeon-v2-routes.${name}.mjs`);
  writeFileSync(file, src);
  console.log(`# MUTATE=${name} (${file})`);
  return import(pathToFileURL(file).href);
}

async function suite() {
const { registerDungeonV2Routes } = await loadModule();
const { FINISH_MAX } = await import('./gauntlet-v2-routes.js');

// The messages (held here, not read from the module): the R2 codes of 3.4.
const SPEC_MSG = {
  disabled: 'The Dungeon is closed.', locked: 'Finish the steps to unlock the Dungeon.', not_tester: 'Combat v2 is for testers only.',
  already: 'You used today\'s v2 test run.', squad_size: 'Pick 5 cards.', not_owned: 'You do not own that card.',
  rule: 'That card breaks today\'s rule.', no_attacker: 'Your squad needs an attacker.', budget: 'Your squad is over the budget.',
  no_v2: 'A card in your squad has no v2 active yet.', no_run: 'You have no run in progress.', not_fighting: 'There is no fight in this room.',
  bad_state: 'This fight cannot go on. Tell an admin.', bad_choice: 'That move is not possible now.', bad_max: 'Auto failed.',
  not_choosing: 'There is nothing to choose.', bad_pick: 'Pick one of the rewards.',
  not_between_floors: 'You can leave only between floors, after the guardian.',
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const CATALOG = [
  { id: 11, name: 'Kroc Bot', rarity: 'rare', image_url: 'u11', type: 'robot', tags: ['x'], ability: 'a' },
  { id: 12, name: 'Water Golem', rarity: 'common', image_url: 'u12', type: 'golem', tags: [], ability: 'b' },
  { id: 13, name: 'Ember', rarity: 'epic', image_url: 'u13', type: 'fire', tags: [], ability: 'c' },
];
const TABLES = {
  statuses: [
    { key: 'chill', ord: 2, kind: 'k', label: 'Chill', family: 'tempo', negative: true, icon: 'chill', rule: '-{chill.dmg} damage', note: 'n' },
    { key: 'poison', ord: 1, kind: 'k', label: 'Poison', family: 'dot', negative: true, icon: 'poison', rule: '{poison.tick} a turn', note: 'n' },
  ],
  roles: [{ key: 'medic', ord: 2, class: 'support', label: 'Medic', purpose: 'p' }, { key: 'striker', ord: 1, class: 'attacker', label: 'Striker', purpose: 'p' }],
  enemy_mechanics: [{ key: 'wall', ord: 2, kind: 'rule', label: 'Wall', text: 't' }, { key: 'toxic', ord: 1, kind: 'passive', label: 'Toxic', text: 't' }],
};
const STATE = { engine: 2, squad: [11, 12, 13], phase: 'fight' };
// The answers of the SQL: tester / active (the member's v2 run of today is active), and every v1 and R1c function.
const baseRpc = ({ tester = false, active = false } = {}) => (name) => {
  if (name === 'dungeon_v2_view') return { data: { ok: true, tester, run: active ? { id: 5, status: 'active', state: clone(STATE) } : null, runs_left: 1, can_start: tester && !active }, error: null };
  if (name === 'dungeon_v2_retreat') return { data: { ok: true, floor: 2, room: 6 }, error: null };
  if (name.startsWith('dungeon_v2_')) return { data: { ok: true, run: 5, state: clone(STATE), status: 'active', log: [] }, error: null };
  if (name === 'combat_v2_on') return { data: tester, error: null };
  if (name === 'gauntlet_v2_view') return { data: { ok: true, tester, run: null, active_mode: null }, error: null };
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
    const run = () => { reads.push({ table, cols: q.cols, ord: q.ord }); const rows = clone(TABLES[table]); if (q.ord) rows.sort((a, b) => a[q.ord] - b[q.ord]); return { data: rows, error: null }; };
    const api = { select(c) { q.cols = c; return api; }, order(c) { q.ord = c; return api; }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko); } };
    return api;
  };
  const supabase = { rpc: async (name, args) => { calls.push({ name, args: clone(args) }); return clone(rpc(name, args)); }, from: query };
  const deps = {
    supabase, caller: async () => me, rateLimit: () => rateOk, getCatalogBase: async () => clone(CATALOG), dungeonOn: () => on,
    onRun: (m, mode) => calls.push({ onRun: mode }), userCache: (o) => makeTtlCache(o), sharedCache: (_n, o) => makeTtlCache(o),
  };
  // v1 = the routes of today: the v1 Dungeon / Gauntlet module and the R1c Gauntlet v2 module.
  const regV1 = () => { if (v1) { registerDungeonRoutes(app, deps); registerGauntletV2Routes(app, deps); } };
  const regV2 = () => v2 && registerDungeonV2Routes(app, deps);
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

const V2_ROUTES = [['GET', '/api/dungeon/v2/view'], ['POST', '/api/dungeon/v2/start'], ['POST', '/api/dungeon/v2/act'], ['POST', '/api/dungeon/v2/auto'],
  ['POST', '/api/dungeon/v2/finish'], ['POST', '/api/dungeon/v2/choose'], ['POST', '/api/dungeon/v2/retreat']];
const FN = { '/api/dungeon/v2/start': 'dungeon_v2_start', '/api/dungeon/v2/act': 'dungeon_v2_act', '/api/dungeon/v2/auto': 'dungeon_v2_auto',
  '/api/dungeon/v2/finish': 'dungeon_v2_auto', '/api/dungeon/v2/choose': 'dungeon_v2_choose', '/api/dungeon/v2/retreat': 'dungeon_v2_retreat' };
const call = (h, [m, p], body, q) => (m === 'GET' ? h.get(p, q) : h.post(p, body, q));
const rpcNames = (h) => h.calls.filter((c) => c.name).map((c) => c.name);
const EVIL = { player: '999', p_player: '999', cards: [11, 12, 13, 14, 15], use: 'basic', target: 0, pick: 0, max: 2 };

// ------------------------------------------------------------------ G6a, G6b
for (const r of V2_ROUTES) {
  test(`G6a non-tester ${r[0]} ${r[1]}: 403 not_tester after one dungeon_v2_view call, 0 other calls, member from the token`, async () => {
    const h = harness();
    const out = await call(h, r, EVIL, { player: '999', p_player: '999' });
    assert.equal(out.status, 403); assert.equal(out.json.error, 'not_tester'); assert.equal(out.json.message, SPEC_MSG.not_tester); assert.equal(out.json.ok, false);
    assert.deepEqual(h.calls, [{ name: 'dungeon_v2_view', args: { p_player: '77' } }]);
    assert.equal(h.reads.length, 0, 'no ref read for a non-tester');
  });
}
test('G6a a non-tester asks twice: one view call each time (no cached refusal can let a later call through)', async () => {
  const h = harness();
  await h.post('/api/dungeon/v2/act', EVIL); await h.post('/api/dungeon/v2/act', EVIL);
  assert.deepEqual(rpcNames(h), ['dungeon_v2_view', 'dungeon_v2_view']);
});
test('G6b a tester: the view, then one function per route, p_player = the token member on every call', async () => {
  const h = harness({ rpc: baseRpc({ tester: true }) });
  for (const r of V2_ROUTES) await call(h, r, EVIL, { player: '999', p_player: '999' });
  assert.deepEqual(rpcNames(h), ['dungeon_v2_view', 'dungeon_v2_start', 'dungeon_v2_act', 'dungeon_v2_auto', 'dungeon_v2_auto', 'dungeon_v2_choose', 'dungeon_v2_retreat'],
    'the tester bit is cached: one view call for 7 routes');
  for (const c of h.calls) assert.equal(c.args.p_player, '77');
});
test('G6b the gate order: 401, 403 off, 429 on a write, each with no RPC call', async () => {
  const a = harness({ me: null }); assert.equal((await a.post('/api/dungeon/v2/act', {})).status, 401); assert.equal(a.calls.length, 0);
  const b = harness({ on: false }); const rb = await b.get('/api/dungeon/v2/view'); assert.equal(rb.status, 403); assert.equal(rb.json.error, 'off'); assert.equal(b.calls.length, 0);
  const c = harness({ rateOk: false }); assert.equal((await c.post('/api/dungeon/v2/start', {})).status, 429); assert.equal(c.calls.length, 0);
});

// ------------------------------------------------------------------ G6c
const v1Routes = () => harness({ v2: false }).stack.map((r) => [r.method, r.path]);
const V1_BODY = { mode: 'gauntlet', cardId: 11, target: 0, targetCard: 12, targetFoe: 1, pick: 0, cards: [11, 12, 13, 14, 15], max: 3, player: '999', use: 'basic' };
for (const tester of [false, true]) {
  for (const v2First of [false, true]) {
    test(`G6c v1 routes unchanged (${tester ? 'tester' : 'non-tester'}, v2 registered ${v2First ? 'before' : 'after'} v1)`, async () => {
      const routes = v1Routes();
      assert.ok(routes.length >= 19, `the v1 modules register ${routes.length} routes`);
      for (const r of routes) {
        for (const body of [V1_BODY, {}]) {
          const q = { lite: body === V1_BODY ? '1' : undefined };
          const a = harness({ v2: false, rpc: baseRpc({ tester }) }); const b = harness({ v2First, rpc: baseRpc({ tester }) });
          const ra = await call(a, r, body, q); const rb = await call(b, r, body, q);
          assert.equal(rb.status, ra.status, `${r[1]} status`);
          assert.equal(JSON.stringify(rb.json), JSON.stringify(ra.json), `${r[1]} JSON bytes`);
          assert.deepEqual(b.calls, a.calls, `${r[1]} RPC calls`);
        }
      }
    });
  }
}
test('G6c the module registers only the /api/dungeon/v2 paths', () => {
  assert.deepEqual(harness({ v1: false }).stack.map((r) => [r.method, r.path]), V2_ROUTES);
});

// ------------------------------------------------------------------ G6d
test('G6d D4: off the list with an active v2 run: act, auto, finish, choose, retreat and the view play on; the start is refused', async () => {
  for (const r of V2_ROUTES) {
    const h = harness({ rpc: baseRpc({ tester: false, active: true }) });
    const out = await call(h, r, EVIL);
    if (r[1].endsWith('/start')) { assert.equal(out.status, 403, 'start'); assert.deepEqual(rpcNames(h), ['dungeon_v2_view']); continue; }
    assert.equal(out.status, 200, r[1]);
    assert.deepEqual(rpcNames(h), r[0] === 'GET' ? ['dungeon_v2_view'] : ['dungeon_v2_view', FN[r[1]]], `${r[1]}: the D4 view answer is kept for the GET`);
  }
});
test('G6d an over run (not active) of a non-tester is refused', async () => {
  const h = harness({ rpc: (n, a) => (n === 'dungeon_v2_view' ? { data: { ok: true, tester: false, run: { id: 5, status: 'over' } }, error: null } : baseRpc()(n, a)) });
  assert.equal((await h.post('/api/dungeon/v2/act', { use: 'basic' })).status, 403);
});
test('G6d a view refusal (disabled) is a 400 with its message; a transport error in the gate is a 500; neither is cached', async () => {
  let mode = 'disabled';
  const h = harness({ rpc: (n, a) => {
    if (n === 'dungeon_v2_view' && mode === 'disabled') return { data: { ok: false, error: 'disabled' }, error: null };
    if (n === 'dungeon_v2_view' && mode === 'down') return { data: null, error: { message: 'boom' } };
    return baseRpc({ tester: true })(n, a);
  } });
  const r1 = await h.post('/api/dungeon/v2/act', {}); assert.equal(r1.status, 400); assert.equal(r1.json.message, SPEC_MSG.disabled);
  mode = 'down'; const r2 = await h.post('/api/dungeon/v2/act', {}); assert.equal(r2.status, 500); assert.equal(r2.json.error, 'boom');
  mode = 'ok'; const r3 = await h.post('/api/dungeon/v2/act', {}); assert.equal(r3.status, 200);
});

// ------------------------------------------------------------------ G6e
test('G6e the start: the cards of the body by the v1 rule (positive integers, at most 5), nothing else', async () => {
  const cases = [
    [{ cards: [11, '12', 13, 14, 15, 16] }, [11, 12, 13, 14, 15]],
    [{ cards: [0, -1, 'x', 2.5, null, 12] }, [12]],
    [{ cards: 'x' }, []], [{}, []], [null, []],
  ];
  for (const [body, want] of cases) {
    const h = harness({ rpc: baseRpc({ tester: true }) }); await h.post('/api/dungeon/v2/start', body);
    assert.deepEqual(h.calls.at(-1), { name: 'dungeon_v2_start', args: { p_player: '77', p_cards: want } }, JSON.stringify(body));
  }
});
test('G6e the choice: only use, target, ally, in the engine shapes (no actor, no other key)', async () => {
  const h = harness({ rpc: baseRpc({ tester: true }) });
  await h.post('/api/dungeon/v2/act', { use: 'active', target: 2, ally: 5, actor: 9, x: 1, player: '1' });
  await h.post('/api/dungeon/v2/act', { use: 'basic', target: '0' });
  await h.post('/api/dungeon/v2/act', { use: 'charge', target: 'a', ally: -3 });
  const ch = h.calls.filter((c) => c.name === 'dungeon_v2_act').map((c) => c.args);
  assert.deepEqual(ch, [
    { p_player: '77', p_choice: { use: true, target: { side: 'enemy', id: 2 }, ally: { side: 'card', id: 5 } } },
    { p_player: '77', p_choice: { use: false, target: { side: 'enemy', id: 0 } } },
    { p_player: '77', p_choice: { use: null } },
  ]);
});
test('G6e max: 1..AUTO_MAX by the v1 Auto rule; Finish sends FINISH_MAX; pick by the idx rule', async () => {
  for (const [sent, want] of [[undefined, AUTO_MAX], [0, AUTO_MAX], ['a', AUTO_MAX], [-4, 1], [1, 1], [3, 3], [99, AUTO_MAX], [2.5, 2]]) {
    const h = harness({ rpc: baseRpc({ tester: true }) }); await h.post('/api/dungeon/v2/auto', { max: sent });
    assert.deepEqual(h.calls.at(-1).args, { p_player: '77', p_max: want }, `max ${sent}`);
  }
  const f = harness({ rpc: baseRpc({ tester: true }) }); await f.post('/api/dungeon/v2/finish', { max: 2 });
  assert.deepEqual(f.calls.at(-1), { name: 'dungeon_v2_auto', args: { p_player: '77', p_max: FINISH_MAX } });
  for (const [sent, want] of [[0, 0], [3, 3], ['9', 9], [10, null], ['x', null]]) {
    const h = harness({ rpc: baseRpc({ tester: true }) }); await h.post('/api/dungeon/v2/choose', { pick: sent });
    assert.deepEqual(h.calls.at(-1).args, { p_player: '77', p_pick: want }, `pick ${sent}`);
  }
  const r = harness({ rpc: baseRpc({ tester: true }) }); await r.post('/api/dungeon/v2/retreat', { mode: 'gauntlet', floor: 9 });
  assert.deepEqual(r.calls.at(-1).args, { p_player: '77' });
});

// ------------------------------------------------------------------ G6f
const CODES = [
  ['disabled', '/api/dungeon/v2/start', {}], ['locked', '/api/dungeon/v2/start', { gate: { ok: false } }], ['already', '/api/dungeon/v2/start', {}],
  ['squad_size', '/api/dungeon/v2/start', { need: 5 }], ['not_owned', '/api/dungeon/v2/start', { card: 12 }], ['rule', '/api/dungeon/v2/start', { card: 13 }],
  ['no_attacker', '/api/dungeon/v2/start', {}], ['budget', '/api/dungeon/v2/start', { cost: 14, budget: 12 }], ['no_v2', '/api/dungeon/v2/start', { cards: [12, 13] }],
  ['no_run', '/api/dungeon/v2/act', {}], ['not_fighting', '/api/dungeon/v2/act', {}], ['bad_state', '/api/dungeon/v2/auto', { detail: 'engine text' }],
  ['bad_choice', '/api/dungeon/v2/act', { detail: 'engine text' }], ['bad_max', '/api/dungeon/v2/finish', {}],
  ['not_choosing', '/api/dungeon/v2/choose', {}], ['bad_pick', '/api/dungeon/v2/choose', {}], ['not_between_floors', '/api/dungeon/v2/retreat', {}],
];
for (const [code, p, keys] of CODES) {
  test(`G6f ${code} (${p}): HTTP 400, the message, every key kept`, async () => {
    const h = harness({ rpc: (n, a) => (n === FN[p] ? { data: { ok: false, error: code, ...keys }, error: null } : baseRpc({ tester: true })(n, a)) });
    const r = await h.post(p, { use: 'basic', target: 0, cards: [11] });
    assert.equal(r.status, 400); assert.equal(r.json.ok, false); assert.equal(r.json.error, code); assert.equal(r.json.message, SPEC_MSG[code]);
    for (const [k, v] of Object.entries(keys)) assert.deepEqual(r.json[k], v, k);
  });
}
test('G6f a transport error gives 500 on every v2 route', async () => {
  for (const r of V2_ROUTES) {
    const h = harness({ rpc: (n, a) => (n.startsWith('dungeon_v2_') && n !== 'dungeon_v2_view' ? { data: null, error: { message: 'down' } } : baseRpc({ tester: true })(n, a)) });
    if (r[0] === 'GET') continue;
    const out = await call(h, r, {}); assert.equal(out.status, 500, r[1]); assert.equal(out.json.error, 'down');
  }
  const g = harness({ rpc: (n, a) => (n === 'dungeon_v2_view' ? { data: null, error: { message: 'down' } } : baseRpc()(n, a)) });
  assert.equal((await g.get('/api/dungeon/v2/view')).status, 500);
});

// ------------------------------------------------------------------ G6g
test('G6g ref: 3 lists in ord order with only the named keys; one read for 2 GETs', async () => {
  const h = harness({ rpc: baseRpc({ tester: true }) });
  const r = await h.get('/api/dungeon/v2/view');
  assert.equal(r.status, 200); assert.equal(r.json.tester, true);
  assert.deepEqual(r.json.ref, {
    statuses: [
      { key: 'poison', label: 'Poison', icon: 'poison', family: 'dot', negative: true, rule: '{poison.tick} a turn' },
      { key: 'chill', label: 'Chill', icon: 'chill', family: 'tempo', negative: true, rule: '-{chill.dmg} damage' },
    ],
    roles: [{ key: 'striker', class: 'attacker', label: 'Striker' }, { key: 'medic', class: 'support', label: 'Medic' }],
    mechanics: [{ key: 'toxic', label: 'Toxic' }, { key: 'wall', label: 'Wall' }],
  });
  await h.get('/api/dungeon/v2/view');
  assert.equal(h.reads.length, 3, 'one read of each table for 2 GETs');
});
test('G6g cards: the catalog fields for each state.squad id (write answers and the view), none on retreat', async () => {
  const want = {
    11: { id: 11, name: 'Kroc Bot', rarity: 'rare', image_url: 'u11', type: 'robot' },
    12: { id: 12, name: 'Water Golem', rarity: 'common', image_url: 'u12', type: 'golem' },
    13: { id: 13, name: 'Ember', rarity: 'epic', image_url: 'u13', type: 'fire' },
  };
  for (const r of V2_ROUTES.slice(1, 6)) {
    const out = await call(harness({ rpc: baseRpc({ tester: true }) }), r, { use: 'basic', target: 0, cards: [11, 12, 13] });
    assert.deepEqual(out.json.cards, want, r[1]);
  }
  const v = await harness({ rpc: baseRpc({ tester: false, active: true }) }).get('/api/dungeon/v2/view');
  assert.deepEqual(v.json.cards, want, 'the view: run.state.squad');
  const rt = await harness({ rpc: baseRpc({ tester: true }) }).post('/api/dungeon/v2/retreat', {});
  assert.equal(rt.json.cards, undefined);
});
}
