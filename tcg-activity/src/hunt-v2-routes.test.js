// node --test src/hunt-v2-routes.test.js      (a mutation: MUTATE=<name> node --test src/hunt-v2-routes.test.js; all: MUTATE=all node src/hunt-v2-routes.test.js)
// R3b: the Hunt v2 practice routes for testers (hunt-v2-routes.js). The gate G6 of R3 SPEC v3 section 6:
//   G6-1 a non-tester gets 403 not_tester on every route after ONE hunt_v2_view call and 0 other RPC calls.
//   G6-2 only the token id is passed (p_player), never a body or query value.
//   G6-3 D4: a member off the list with an active practice day still plays it (act, auto).
//   G6-4 the choice has only use, target, ally (the engine shapes); the own pick is a list of ids or null (the auto-pick); max is clamped.
//   G6-5 every error code gives 400 with its message, every key kept; a transport error gives 500; off gives 403 with no RPC call.
//   G6-6 the answer has the R1e run shape (run.state.fight / info / squad), the label, cards for every squad id, and ref (one read for 2 GETs).
//   G6-7 the module registers only /api/hunt/v2 paths (no v1 route changes).
//   G6-8 (ON SPEC v6 3.4, r5 L-2) the retry: a start, act or auto aborted with SQLSTATE 40P01 or 40001 runs once more (ok after exactly
//        2 calls); two aborts answer 409 busy; any other error answers 500 after 1 call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTtlCache } from './ttl-cache.js';

const here = dirname(fileURLToPath(import.meta.url));
export const MUTATIONS = {
  no_tester_check: ["if (data?.ok && (data.tester === true || data.day?.status === 'active')) return { player, view: data };", 'if (data?.ok) return { player, view: data };'],
  player_from_body: ['const player = String(me.id);', 'const player = String(req.body?.player ?? req.query?.player ?? me.id);'],
  no_d4: ["(data.tester === true || data.day?.status === 'active')", '(data.tester === true)'],
  rpc_before_gate: ["    const { data, error } = await supabase.rpc('hunt_v2_view', { p_player: player });",
    "    await supabase.rpc('combat_v2_on', { p_mode: 'hunt', p_player: player });\n    const { data, error } = await supabase.rpc('hunt_v2_view', { p_player: player });"],
  choice_passthrough: ['p_choice: choiceOf(req.body)', 'p_choice: req.body'],
  cards_passthrough: ['p_cards: cardsOf(req.body)', 'p_cards: req.body?.cards ?? null'],
  no_max_clamp: ['p_max: autoMax(req.body?.max)', 'p_max: Number(req.body?.max)'],
  message_missing: [" hunt_over: 'The Hunt ended.',", ''],
  no_run_shape: ['  if (!data || !data.fight) return data;', '  return data;'],
  no_retry: ['    if (r.error && RETRY_CODES.has(r.error.code)) r = await supabase.rpc(fn, args);\n', ''],
  v1_touched: ['  const refs = sharedCache', "  app.get('/api/hunt', (req, res, next) => next());\n  const refs = sharedCache"],
};

if (process.env.MUTATE === 'all') {
  const names = Object.keys(MUTATIONS);
  const run = (name) => spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], { env: { ...process.env, MUTATE: name }, encoding: 'utf8' });
  const base = run('');
  console.log(`baseline (no mutation) ${base.status === 0 ? 'PASS' : 'FAIL'}  ${(base.stdout.match(/# pass \d+/) || [''])[0]} ${(base.stdout.match(/# fail \d+/) || [''])[0]}`);
  let ok = base.status === 0;
  for (const n of names) {
    const r = run(n);
    const caught = r.status !== 0;
    if (!caught) ok = false;
    console.log(`mutation ${n.padEnd(20)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${(r.stdout.match(/# fail \d+/) || [''])[0]}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${names.length} caught` : 'mutations: FAIL');
  process.exit(ok ? 0 : 1);
}

async function loadModule() {
  const name = process.env.MUTATE;
  if (!name) return import('./hunt-v2-routes.js');
  const m = MUTATIONS[name]; if (!m) throw new Error(`unknown mutation ${name}`);
  let src = readFileSync(join(here, 'hunt-v2-routes.js'), 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(m[0]).length - 1; if (n !== 1) throw new Error(`mutation ${name}: the text matches ${n} times, not once`);
  src = src.replace(m[0], m[1]);
  const file = join(mkdtempSync(join(tmpdir(), 'r3b-mut-')), `hunt-v2-routes.${name}.mjs`);
  writeFileSync(file, src);
  console.log(`# MUTATE=${name} (${file})`);
  return import(pathToFileURL(file).href);
}
const { registerHuntV2Routes, AUTO_MAX, LABEL } = await loadModule();

// The messages of the spec errors (R3 SPEC 3.4), held here and not read from the module.
const CODES = ['no_hunt', 'no_v2_boss', 'already', 'squad_size', 'not_owned', 'no_v2', 'no_day', 'not_fighting', 'hunt_over', 'bad_state', 'bad_choice', 'bad_max'];
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const CATALOG = [
  { id: 11, name: 'Kroc Bot', rarity: 'rare', image_url: 'u11', type: 'robot', tags: ['x'] },
  { id: 12, name: 'Water Golem', rarity: 'common', image_url: 'u12', type: 'golem', tags: [] },
];
const TABLES = {
  statuses: [{ key: 'poison', ord: 1, label: 'Poison', family: 'dot', negative: true, icon: 'poison', rule: '{poison.tick}', note: 'n' }],
  roles: [{ key: 'striker', ord: 1, class: 'attacker', label: 'Striker', purpose: 'p' }],
  enemy_mechanics: [{ key: 'wall', ord: 1, label: 'Wall', text: 't' }],
};
const FIGHT = { v: 2, mode: 'hunt', squad: [11, 12], cards: { 11: { hp: 5 }, 12: { hp: 6 } }, enemies: [{ hp: 100, max: 200 }], clock: 3 };
const DAY = (status) => ({ hunt_id: 7, day: '2026-11-05', squad: [11, 12], status, ended_by: status === 'over' ? 'cap' : null, damage: 40, steps: 3 });
const ANSWER = { ok: true, engine: 2, practice: true, day: DAY('active'), status: 'active', damage: 40, fight: FIGHT, info: { 11: { class: 'attacker' } }, units: { 11: {} }, order: [], status_lines: {} };
const viewOf = ({ tester = false, day = null } = {}) => ({ ok: true, tester, practice: true, hunt: { id: 7, live_frac: 0.4 }, day, can_start: tester && !day,
  ...(day?.status === 'active' ? { fight: FIGHT, info: ANSWER.info, units: ANSWER.units, order: [], status_lines: {} } : {}) });
const baseRpc = (opts = {}) => (name) => {
  if (name === 'hunt_v2_view') return { data: viewOf(opts), error: null };
  if (name.startsWith('hunt_v2_')) return { data: clone(ANSWER), error: null };
  return { data: { ok: true }, error: null };
};

function harness({ rpc = baseRpc(), me = { id: '77' }, rateOk = true, on = true } = {}) {
  const stack = []; const calls = []; const reads = [];
  const add = (method) => (path, ...hs) => { for (const h of hs) stack.push({ method, path, h }); };
  const app = { get: add('GET'), post: add('POST'), use: () => { throw new Error('the module must not add middleware'); } };
  const query = (table) => {
    const q = { cols: null, ord: null };
    const run = () => { reads.push({ table, cols: q.cols, ord: q.ord }); let rows = clone(TABLES[table]); if (q.ord) rows.sort((a, b) => a[q.ord] - b[q.ord]); return { data: rows, error: null }; };
    const o = { select(c) { q.cols = c; return o; }, order(c) { q.ord = c; return o; }, then(r, j) { return Promise.resolve(run()).then(r, j); } };
    return o;
  };
  const supabase = { rpc: async (name, args) => { calls.push({ name, args: clone(args) }); return rpc(name, args); }, from: query };
  const sharedCache = (name, { ttl }) => makeTtlCache({ ttl });
  registerHuntV2Routes(app, { supabase, caller: async () => me, rateLimit: () => rateOk, getCatalogBase: async () => clone(CATALOG), huntOn: () => on, sharedCache });
  const call = async (method, path, { body = {}, query = {} } = {}) => {
    const out = { status: 200, body: undefined };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = clone(b); return res; } };
    const hs = stack.filter((s) => s.method === method && s.path === path);
    if (!hs.length) return { status: 404 };
    for (const s of hs) await s.h({ body, query, headers: {} }, res, () => {});
    return out;
  };
  return { call, calls, reads, stack };
}
const ROUTES = [['GET', '/api/hunt/v2/view'], ['POST', '/api/hunt/v2/start'], ['POST', '/api/hunt/v2/act'], ['POST', '/api/hunt/v2/auto']];

test('G6-7 the module registers only the 4 /api/hunt/v2 paths', () => {
  const h = harness();
  assert.deepEqual(h.stack.map((s) => `${s.method} ${s.path}`).sort(), ROUTES.map(([m, p]) => `${m} ${p}`).sort());
});

test('G6-1 G6-2 a non-tester: 403 not_tester on every route, ONE hunt_v2_view call with the token id, 0 other RPC calls', async () => {
  for (const [m, p] of ROUTES) {
    const h = harness();
    const r = await h.call(m, p, { body: { player: '999', cards: [11], use: 'basic', target: 0, max: 5 }, query: { player: '999' } });
    assert.equal(r.status, 403, p);
    assert.equal(r.body.error, 'not_tester', p);
    assert.equal(r.body.message, 'Combat v2 is for testers only.', p);
    assert.deepEqual(h.calls, [{ name: 'hunt_v2_view', args: { p_player: '77' } }], p);
  }
});

test('G6-2 a tester: every RPC gets p_player = the token id only (a body or query player is ignored)', async () => {
  for (const [m, p] of ROUTES) {
    const h = harness({ rpc: baseRpc({ tester: true, day: DAY('active') }) });
    const r = await h.call(m, p, { body: { player: '999', p_player: '999' }, query: { player: '999' } });
    assert.equal(r.status, 200, p);
    assert.ok(h.calls.length >= 1 && h.calls.every((c) => c.args.p_player === '77'), JSON.stringify(h.calls));
    assert.equal(h.calls[0].name, 'hunt_v2_view');
  }
});

test('G6-3 D4: off the tester list with an active practice day: act and auto play on; with an over day: 403', async () => {
  for (const p of ['/api/hunt/v2/act', '/api/hunt/v2/auto']) {
    const h = harness({ rpc: baseRpc({ tester: false, day: DAY('active') }) });
    const r = await h.call('POST', p, { body: { use: 'basic', target: 0 } });
    assert.equal(r.status, 200, p);
    assert.deepEqual(h.calls.map((c) => c.name), ['hunt_v2_view', p.endsWith('act') ? 'hunt_v2_act' : 'hunt_v2_auto']);
    const h2 = harness({ rpc: baseRpc({ tester: false, day: DAY('over') }) });
    assert.equal((await h2.call('POST', p, { body: {} })).status, 403);
    assert.equal(h2.calls.length, 1);
  }
});

test('G6-4 the choice (use, target, ally only, engine shapes), the own pick (ids or null), the max clamp', async () => {
  const h = harness({ rpc: baseRpc({ tester: true }) });
  await h.call('POST', '/api/hunt/v2/act', { body: { use: 'active', target: 0, ally: 12, actor: 11, hp: 9 } });
  assert.deepEqual(h.calls[1], { name: 'hunt_v2_act', args: { p_player: '77', p_choice: { use: true, target: { side: 'enemy', id: 0 }, ally: { side: 'card', id: 12 } } } });
  await h.call('POST', '/api/hunt/v2/act', { body: { use: 'basic', target: 'x' } });
  assert.deepEqual(h.calls[3].args.p_choice, { use: false });
  await h.call('POST', '/api/hunt/v2/start', { body: {} });
  assert.deepEqual(h.calls[5], { name: 'hunt_v2_start', args: { p_player: '77', p_cards: null } });
  await h.call('POST', '/api/hunt/v2/start', { body: { cards: [11, '12', -3, 'x', 1.5] } });
  assert.deepEqual(h.calls[7].args.p_cards, [11, 12]);
  await h.call('POST', '/api/hunt/v2/auto', { body: { max: 99999 } });
  await h.call('POST', '/api/hunt/v2/auto', { body: { max: -4 } });
  await h.call('POST', '/api/hunt/v2/auto', { body: {} });
  assert.deepEqual([h.calls[9], h.calls[11], h.calls[13]].map((c) => c.args.p_max), [AUTO_MAX, 1, 1]);
});

test('G6-5 every error code: 400 with its message, every key kept; a transport error: 500; off: 403 with no RPC; no token: 401; rate: 429', async () => {
  for (const code of CODES) {
    const h = harness({ rpc: (name) => (name === 'hunt_v2_view' ? { data: viewOf({ tester: true }), error: null } : { data: { ok: false, error: code, detail: 'd', cards: [1] }, error: null }) });
    const r = await h.call('POST', '/api/hunt/v2/start', { body: {} });
    assert.equal(r.status, 400, code);
    assert.equal(r.body.error, code);
    assert.ok(typeof r.body.message === 'string' && r.body.message.length > 3 && r.body.message !== code, `${code}: ${r.body.message}`);
    assert.equal(r.body.detail, 'd'); assert.deepEqual(r.body.cards, [1]);
  }
  const t = harness({ rpc: (name) => (name === 'hunt_v2_view' ? { data: viewOf({ tester: true }), error: null } : { data: null, error: { message: 'boom' } }) });
  assert.equal((await t.call('POST', '/api/hunt/v2/act', { body: {} })).status, 500);
  const off = harness({ on: false });
  const o = await off.call('GET', '/api/hunt/v2/view');
  assert.equal(o.status, 403); assert.equal(o.body.error, 'off'); assert.equal(off.calls.length, 0);
  const anon = harness({ me: null });
  assert.equal((await anon.call('POST', '/api/hunt/v2/start')).status, 401); assert.equal(anon.calls.length, 0);
  const slow = harness({ rateOk: false, rpc: baseRpc({ tester: true }) });
  assert.equal((await slow.call('POST', '/api/hunt/v2/auto')).status, 429); assert.equal(slow.calls.length, 0);
});

test('G6-6 the R1e run shape, the label, the cards and the ref (one read of each table for 2 GETs)', async () => {
  const h = harness({ rpc: baseRpc({ tester: true, day: DAY('active') }) });
  const r = await h.call('GET', '/api/hunt/v2/view');
  await h.call('GET', '/api/hunt/v2/view');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.run.state.fight, FIGHT);
  assert.deepEqual(r.body.run.state.squad, [11, 12]);
  assert.equal(r.body.run.state.phase, 'fight');
  assert.equal(r.body.label, LABEL);
  assert.equal(LABEL, 'Practice (v2 test): no rewards');
  assert.deepEqual(r.body.cards[11], { id: 11, name: 'Kroc Bot', rarity: 'rare', image_url: 'u11', type: 'robot' });
  assert.deepEqual(r.body.ref.roles, [{ key: 'striker', class: 'attacker', label: 'Striker' }]);
  assert.equal(h.reads.length, 3);
  assert.deepEqual(h.calls.map((c) => c.name), ['hunt_v2_view', 'hunt_v2_view']);
  const a = await h.call('POST', '/api/hunt/v2/auto', { body: { max: 3 } });
  assert.equal(a.body.run.state.phase, 'fight'); assert.equal(a.body.damage, 40);
  const n = harness({ rpc: baseRpc({ tester: true }) });
  const v = await n.call('GET', '/api/hunt/v2/view');
  assert.equal(v.body.run, undefined); assert.equal(v.body.can_start, true); assert.equal(v.body.label, LABEL);
});

test('G6-8 the retry: 40P01 then ok, 40001 then ok (exactly 2 calls); two aborts: 409 busy; another error: 500 after 1 call', async () => {
  for (const [p, fn] of [['/api/hunt/v2/start', 'hunt_v2_start'], ['/api/hunt/v2/act', 'hunt_v2_act'], ['/api/hunt/v2/auto', 'hunt_v2_auto']]) {
    for (const code of ['40P01', '40001']) {
      let n = 0;
      const h = harness({ rpc: (name) => (name === 'hunt_v2_view' ? { data: viewOf({ tester: true, day: DAY('active') }), error: null }
        : (++n === 1 ? { data: null, error: { code, message: 'deadlock detected' } } : { data: clone(ANSWER), error: null })) });
      const r = await h.call('POST', p, { body: { use: 'basic', target: 0 } });
      assert.equal(r.status, 200, `${p} ${code}`);
      assert.equal(h.calls.filter((c) => c.name === fn).length, 2, `${p} ${code}: exactly 2 calls`);
    }
    const two = harness({ rpc: (name) => (name === 'hunt_v2_view' ? { data: viewOf({ tester: true, day: DAY('active') }), error: null } : { data: null, error: { code: '40P01', message: 'deadlock detected' } }) });
    const r2 = await two.call('POST', p, { body: {} });
    assert.equal(r2.status, 409); assert.equal(r2.body.error, 'busy'); assert.equal(r2.body.message, 'The Hunt is busy. Try again.');
    assert.equal(two.calls.filter((c) => c.name === fn).length, 2);
    const other = harness({ rpc: (name) => (name === 'hunt_v2_view' ? { data: viewOf({ tester: true, day: DAY('active') }), error: null } : { data: null, error: { code: 'XX000', message: 'boom' } }) });
    assert.equal((await other.call('POST', p, { body: {} })).status, 500);
    assert.equal(other.calls.filter((c) => c.name === fn).length, 1);
  }
});
