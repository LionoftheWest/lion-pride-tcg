// node --test src/finish-route.test.js
// POST /api/dungeon/finish (dungeon_finish_room.sql): the member comes from the token, never the body; the mode reaches the function (daily or gauntlet,
// anything else is daily); the call has one rpc and no round count (the room is played to its end); the rate limit is the one of Auto (a write); a refusal keeps
// the single-call shape (HTTP 400 with the message); the code before the migration answers a clear "finish_unavailable" (404); the answer keeps every round in order
// and the end of the room (ended, outcome won / lost / limit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerDungeonRoutes } from './dungeon-routes.js';

function harness(rpcAnswer, { limited = false, who = { id: '77' } } = {}) {
  const routes = {}; const calls = [];
  const app = { get: (p, h) => { routes[`GET ${p}`] = h; }, post: (p, h) => { routes[`POST ${p}`] = h; } };
  const supabase = { rpc: async (name, args) => { calls.push({ name, args }); return rpcAnswer(name, args); } };
  const limits = [];
  registerDungeonRoutes(app, { supabase, caller: async () => who, rateLimit: (id) => { limits.push(id); return !limited; }, dungeonOn: () => true, getCatalogBase: async () => [] });
  return {
    calls, limits,
    post: async (path, body) => {
      let status = 200, json = null; const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; }, on() {} };
      await routes[`POST ${path}`]({ body, query: {}, path }, res);
      return { status, json };
    },
  };
}
const ok = (extra = {}) => () => ({ data: { ok: true, rounds: [], played: 0, stopped: 'phase', error: null, state: { phase: 'choose' }, status: 'active', ended: false, outcome: 'won', calls: 1, ...extra }, error: null });

test('the member comes from the token and the mode from the body; one rpc, no round count', async () => {
  const h = harness(ok());
  await h.post('/api/dungeon/finish', { mode: 'gauntlet', player: '999', p_player: '999', max: 3 });
  assert.deepEqual(h.calls, [{ name: 'dungeon_finish_room', args: { p_player: '77', p_mode: 'gauntlet' } }]);
  const d = harness(ok()); await d.post('/api/dungeon/finish', { mode: 'whatever' });
  assert.equal(d.calls[0].args.p_mode, 'daily');
  const e = harness(ok()); await e.post('/api/dungeon/finish', undefined);
  assert.equal(e.calls[0].args.p_mode, 'daily');
});

test('the rate limit is the write limit of Auto: a limited member gets 429 and nothing is played; an unknown caller gets 401', async () => {
  const h = harness(ok(), { limited: true });
  const r = await h.post('/api/dungeon/finish', {});
  assert.equal(r.status, 429); assert.equal(h.calls.length, 0); assert.deepEqual(h.limits, ['77']);
  const u = harness(ok(), { who: null });
  assert.equal((await u.post('/api/dungeon/finish', {})).status, 401); assert.equal(u.calls.length, 0);
});

test('the answer keeps every round in order and the end of the room', async () => {
  const rounds = [{ atk: { ok: true, card: 1, damage: 5, kill: false, state: { phase: 'fight' } } }, { pass: { ok: true, round: 2, enemy: [] } }, { atk: { ok: true, card: 2, damage: 9, kill: true, state: { phase: 'choose' } } }];
  for (const [outcome, ended, status] of [['won', false, 'active'], ['lost', true, 'over'], ['limit', true, 'over']]) {
    const h = harness(ok({ rounds, played: 3, outcome, ended, status }));
    const r = await h.post('/api/dungeon/finish', {});
    assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.outcome, outcome); assert.equal(r.json.ended, ended); assert.equal(r.json.status, status);
    assert.deepEqual(r.json.rounds.map((x) => Object.keys(x)[0]), ['atk', 'pass', 'atk']);
  }
});

test('a refusal keeps the shape of a single call: HTTP 400, the message of the error', async () => {
  for (const [code, text] of [['not_fighting', 'There is no fight in this room.'], ['no_run', 'You have no run in progress.'], ['disabled', 'The Dungeon is closed.']]) {
    const h = harness(() => ({ data: { ok: false, error: code }, error: null }));
    const r = await h.post('/api/dungeon/finish', {});
    assert.equal(r.status, 400); assert.equal(r.json.ok, false); assert.equal(r.json.message, text);
  }
});

test('the code before the migration: 404 finish_unavailable; any other database error is a 500', async () => {
  const h = harness(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.dungeon_finish_room' } }));
  const r = await h.post('/api/dungeon/finish', {});
  assert.equal(r.status, 404); assert.equal(r.json.error, 'finish_unavailable');
  const e = harness(() => ({ data: null, error: { code: '57014', message: 'canceling statement' } }));
  assert.equal((await e.post('/api/dungeon/finish', {})).status, 500);
});

test('a refused action after some rounds: ok with the rounds, and the message of the error', async () => {
  const h = harness(ok({ rounds: [{ atk: { ok: true, card: 1, state: {} } }], stopped: 'error', outcome: null, error: { ok: false, error: 'stunned' } }));
  const r = await h.post('/api/dungeon/finish', {});
  assert.equal(r.status, 200); assert.equal(r.json.rounds.length, 1); assert.equal(r.json.error.message, 'That card is stunned for a round.'); assert.equal(r.json.outcome, null);
});
