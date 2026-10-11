// node --test src/auto-route.test.js
// POST /api/dungeon/auto (dungeon_auto_rounds.sql): the member comes from the token, never the body; the rounds are clamped to 1..5; the mode
// reaches the function; a refusal keeps the single-call shape (HTTP 400 with the message); the code before the migration answers a clear
// "auto_unavailable" (404) that the client turns into the old one-request-per-action play; a refused action after some rounds carries its message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerDungeonRoutes, AUTO_MAX } from './dungeon-routes.js';

function harness(rpcAnswer) {
  const routes = {}; const calls = [];
  const app = { get: (p, h) => { routes[`GET ${p}`] = h; }, post: (p, h) => { routes[`POST ${p}`] = h; } };
  const supabase = { rpc: async (name, args) => { calls.push({ name, args }); return rpcAnswer(name, args); } };
  registerDungeonRoutes(app, { supabase, caller: async () => ({ id: '77' }), rateLimit: () => true, dungeonOn: () => true, getCatalogBase: async () => [] });
  return {
    calls,
    post: async (path, body) => {
      let status = 200, json = null; const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, on() {} };
      await routes[`POST ${path}`]({ body, query: {}, path }, res);
      return { status, json };
    },
  };
}
const ok = (extra = {}) => () => ({ data: { ok: true, rounds: [], played: 0, stopped: 'max', state: { phase: 'fight' }, status: 'active', ...extra }, error: null });

test('the member comes from the token and the mode from the body; the call has one rpc', async () => {
  const h = harness(ok());
  await h.post('/api/dungeon/auto', { mode: 'gauntlet', max: 3, player: '999', p_player: '999' });
  assert.deepEqual(h.calls, [{ name: 'dungeon_auto_rounds', args: { p_player: '77', p_mode: 'gauntlet', p_max: 3 } }]);
  const d = harness(ok()); await d.post('/api/dungeon/auto', { mode: 'whatever' });
  assert.equal(d.calls[0].args.p_mode, 'daily');
});

test('the rounds are clamped: 1 to AUTO_MAX, a missing or bad number gives AUTO_MAX, a fraction is cut', async () => {
  assert.equal(AUTO_MAX, 5);
  for (const [sent, want] of [[undefined, 5], [0, 5], [-4, 1], [1, 1], [4, 4], [5, 5], [99, 5], ['x', 5], [2.5, 2]]) {
    const h = harness(ok()); await h.post('/api/dungeon/auto', { max: sent });
    assert.equal(h.calls[0].args.p_max, want, `max ${sent}`);
  }
});

test('a refusal keeps the shape of a single call: HTTP 400, the message of the error', async () => {
  const h = harness(() => ({ data: { ok: false, error: 'round_cap' }, error: null }));
  const r = await h.post('/api/dungeon/auto', {});
  assert.equal(r.status, 400); assert.equal(r.json.ok, false); assert.equal(r.json.message, 'The fight ran out of rounds.');
});

test('the code before the migration: 404 auto_unavailable (the client plays one request for each action)', async () => {
  const h = harness(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.dungeon_auto_rounds' } }));
  const r = await h.post('/api/dungeon/auto', {});
  assert.equal(r.status, 404); assert.equal(r.json.error, 'auto_unavailable');
  const e = harness(() => ({ data: null, error: { code: '57014', message: 'canceling statement' } }));
  assert.equal((await e.post('/api/dungeon/auto', {})).status, 500);
});

test('a refused action after some rounds: ok with the rounds, and the message of the error', async () => {
  const h = harness(ok({ rounds: [{ atk: { ok: true, card: 1, target: 0, damage: 5, kill: false, state: { phase: 'fight' } } }], played: 1, stopped: 'error', error: { ok: false, error: 'stunned' } }));
  const r = await h.post('/api/dungeon/auto', {});
  assert.equal(r.status, 200); assert.equal(r.json.rounds.length, 1); assert.equal(r.json.error.message, 'That card is stunned for a round.');
});
