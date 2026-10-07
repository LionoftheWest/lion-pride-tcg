// GET /api/effects/preview: the numbers come from the SQL effect_preview (one_source_rules.sql), for the
// verified member only. node --test effects-preview.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CARD_EFFECTS_USERS = '111111111111111111';   // the flag ON for this member only
delete process.env.FEATURE_CARD_EFFECTS;
const { registerEffectRoutes } = await import('./effects.js');

const SQL_ANSWER = { 42: { primitive: 'confetti', kind: 'boon', enabled: true, amount: 1.15, duration_s: 30, cooldown_h: 18.4 } };
function setup({ me = { id: '111111111111111111' }, rpcError = null } = {}) {
  const routes = {};
  const app = { get: (p, h) => { routes[`GET ${p}`] = h; }, post: (p, h) => { routes[`POST ${p}`] = h; } };
  const calls = [];
  const supabase = { rpc: async (name, args) => { calls.push({ name, args }); return rpcError ? { data: null, error: { message: rpcError } } : { data: SQL_ANSWER, error: null }; } };
  registerEffectRoutes(app, { supabase, caller: async () => me, rateLimit: () => true, toProxyImg: (u) => u, getBalance: async () => ({}) });
  const run = async (query = {}) => {
    let status = 200, json = null;
    const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; } };
    await routes['GET /api/effects/preview']({ query, body: {} }, res);
    return { status, json };
  };
  return { run, calls };
}

test('the answer is the SQL effect_preview of the verified member, unchanged', async () => {
  const { run, calls } = setup();
  const r = await run({ player: '999' }); // a query cannot pick another member
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { enabled: true, cards: SQL_ANSWER });
  assert.deepEqual(calls, [{ name: 'effect_preview', args: { p_player: '111111111111111111' } }]);
});

test('not logged in: 401 and no RPC', async () => {
  const { run, calls } = setup({ me: null });
  assert.equal((await run()).status, 401);
  assert.equal(calls.length, 0);
});

test('the flag OFF for the member: enabled false, no RPC', async () => {
  const { run, calls } = setup({ me: { id: '222222222222222222' } });
  const r = await run();
  assert.deepEqual(r.json, { enabled: false, cards: {} });
  assert.equal(calls.length, 0);
});

test('the function not live: 503, no numbers made up', async () => {
  const { run } = setup({ rpcError: 'function effect_preview does not exist' });
  const r = await run();
  assert.equal(r.status, 503);
  assert.equal(r.json.cards, undefined);
});
