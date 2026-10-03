import { test } from 'node:test';
import assert from 'node:assert/strict';

// ARM ON OPEN (effects_outside.sql, 2026-10-03): GET /api/effects/me starts the screen pranks that
// wait for the member (arm_player_effects) BEFORE it reads the active effects, so a googly-eyes prank
// starts when the target opens the game and shows in that same answer.
process.env.FEATURE_CARD_EFFECTS = '1';
const { registerEffectRoutes } = await import('../effects.js');

// A fake supabase client: every query is a chain that ends in an empty answer; the log keeps the order.
function fakeSupabase({ rpcFails = false } = {}) {
  const log = [];
  const chain = (table) => {
    const p = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (ok, bad) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok, bad);
        return (...args) => { log.push({ table, op: prop, args, at: Date.now() }); return p; };
      },
    });
    return p;
  };
  return {
    log,
    from: (table) => { log.push({ table, op: 'from', at: Date.now() }); return chain(table); },
    rpc: async (name, args) => {
      log.push({ op: 'rpc', name, args, at: Date.now() });
      if (rpcFails) throw new Error('function arm_player_effects does not exist');
      return { data: 1, error: null };
    },
  };
}

async function callMe(supabase) {
  const routes = {};
  const app = { get: (p, fn) => { routes[p] = fn; }, post: (p, fn) => { routes[p] = fn; } };
  registerEffectRoutes(app, { supabase, caller: async () => ({ id: '123' }), rateLimit: () => true, toProxyImg: (u) => u });
  let body = null, status = 200;
  const res = { status(s) { status = s; return res; }, json(b) { body = b; return res; } };
  await routes['/api/effects/me']({ query: {}, body: {} }, res);
  return { body, status };
}

test('GET /api/effects/me arms my waiting screen pranks before it reads the active effects', async () => {
  const sb = fakeSupabase();
  const { body, status } = await callMe(sb);
  assert.equal(status, 200);
  assert.equal(body.enabled, true);
  const arm = sb.log.findIndex((x) => x.op === 'rpc' && x.name === 'arm_player_effects');
  const read = sb.log.findIndex((x) => x.table === 'player_effects' && x.op === 'from');
  assert.ok(arm >= 0, 'arm_player_effects is called');
  assert.deepEqual(sb.log[arm].args, { p_player: '123' });
  assert.ok(read > arm, 'the player_effects read comes after the arm');
  // The read's "starts_at <= now" uses a time from after the arm (a prank armed now is in the answer).
  const lte = sb.log.find((x) => x.table === 'player_effects' && x.op === 'lte' && x.args[0] === 'starts_at');
  assert.ok(Date.parse(lte.args[1]) >= sb.log[arm].at, 'the read time is after the arm');
});

test('a failed arm does not break my state (the read still runs)', async () => {
  const sb = fakeSupabase({ rpcFails: true });
  const { body, status } = await callMe(sb);
  assert.equal(status, 200);
  assert.equal(body.enabled, true);
  assert.ok(sb.log.some((x) => x.table === 'player_effects' && x.op === 'from'));
});
