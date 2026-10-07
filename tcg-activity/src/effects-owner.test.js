import { test } from 'node:test';
import assert from 'node:assert/strict';

// effects_spread (Nathan, 2026-10-03): the server owner is a target like anyone; only what Discord forbids
// on the owner (a nickname layer, a Name Swap, a timeout) is refused BEFORE the play (no rpc = nothing spent).
// A poll card sends the index of the picked question (play_card_effect_choice); a bad index is refused.
// A refunded play counts in no daily limit, and the sender gets it in /api/effects/me "refunds".
process.env.FEATURE_CARD_EFFECTS = '1';
const { registerEffectRoutes, OWNER_FORBIDDEN } = await import('../effects.js');

/** A fake supabase: every chain answers from `answer(table)`; the log keeps every call. */
function fakeSupabase({ owner = 'OWNER', prim = 'title', polls = prim === 'hot_take_poll' } = {}) {
  const log = [];
  const answer = (table, ops) => {
    if (table === 'settings') return ops.includes('maybeSingle') ? { data: { value: [owner] }, error: null } : { data: [], error: null };
    if (table === 'cards') return { data: { subject: { effect: { primitive: prim, ...(polls ? { options: { polls: [{}, {}, {}] } } : {}) } } }, error: null };
    return { data: [], error: null, count: 0 };
  };
  const chain = (table) => {
    const ops = [];
    const p = new Proxy({}, {
      get(_, op) {
        if (op === 'then') return (ok, bad) => Promise.resolve(answer(table, ops)).then(ok, bad);
        return (...args) => { ops.push(op); log.push({ table, op, args }); return p; };
      },
    });
    return p;
  };
  return {
    log,
    from: (table) => { log.push({ table, op: 'from' }); return chain(table); },
    rpc: async (name, args) => { log.push({ op: 'rpc', name, args }); return { data: { ok: true, rpc: name }, error: null }; },
  };
}
function routes(sb) {
  const r = {};
  const app = { get: (p, fn) => { r[p] = fn; }, post: (p, fn) => { r[p] = fn; } };
  registerEffectRoutes(app, { supabase: sb, caller: async () => ({ id: 'S1' }), rateLimit: () => true, toProxyImg: (u) => u,
    getBalance: async () => ({ effect_tiers: {}, effect_ascension: {}, effect_cooldown_scale: 1 }) });
  return r;
}
async function call(fn, body) {
  let out = null, status = 200;
  const res = { status(s) { status = s; return res; }, json(b) { out = b; return res; } };
  await fn({ query: {}, body }, res);
  return { body: out, status };
}
const rpcs = (sb) => sb.log.filter((x) => x.op === 'rpc').map((x) => x.name);

for (const prim of OWNER_FORBIDDEN) {
  test(`${prim} on the owner: refused before the play (owner_forbidden), nothing is spent`, async () => {
    const sb = fakeSupabase({ prim });
    const { body } = await call(routes(sb)['/api/effects/play'], { cardId: 5, targetId: 'OWNER' });
    assert.deepEqual(body, { ok: false, error: 'owner_forbidden', primitive: prim });
    assert.deepEqual(rpcs(sb), [], 'play_card_effect is never called');
  });
}

for (const prim of ['reaction_storm', 'ping_parade', 'hype', 'heckle', 'parrot', 'spongebob', 'fanfare', 'squeaky', 'hot_take_poll', 'slowmode', 'clown_role', 'spotlight_role', 'color_role', 'vc_mute', 'vc_deafen']) {
  test(`${prim} on the owner: played like on anyone`, async () => {
    const sb = fakeSupabase({ prim });
    const { body } = await call(routes(sb)['/api/effects/play'], { cardId: 5, targetId: 'OWNER' });
    assert.equal(body.ok, true);
    assert.deepEqual(rpcs(sb), [prim === 'hot_take_poll' ? 'play_card_effect_choice' : 'play_card_effect']);
  });
}

test('a nickname card on a member who is not the owner is played', async () => {
  const sb = fakeSupabase({ prim: 'nickname' });
  const { body } = await call(routes(sb)['/api/effects/play'], { cardId: 5, targetId: 'T1' });
  assert.equal(body.ok, true);
});

test('a poll card with no pick from the client (the current Play screen) plays question 0', async () => {
  const sb = fakeSupabase({ prim: 'hot_take_poll', polls: true });
  await call(routes(sb)['/api/effects/play'], { cardId: 5, targetId: 'T1' });
  const r = sb.log.find((x) => x.op === 'rpc');
  assert.deepEqual([r.name, r.args.p_choice], ['play_card_effect_choice', 0]);
});

test('a card that is not a poll ignores a pick (play_card_effect)', async () => {
  const sb = fakeSupabase({ prim: 'title' });
  await call(routes(sb)['/api/effects/play'], { cardId: 5, targetId: 'T1', choice: 1 });
  assert.deepEqual(rpcs(sb), ['play_card_effect']);
});

test('a poll pick goes to play_card_effect_choice with the index', async () => {
  const sb = fakeSupabase({ prim: 'hot_take_poll' });
  await call(routes(sb)['/api/effects/play'], { cardId: 5, targetId: 'T1', choice: 2 });
  const r = sb.log.find((x) => x.op === 'rpc');
  assert.equal(r.name, 'play_card_effect_choice');
  assert.deepEqual(r.args, { p_player: 'S1', p_card: 5, p_target: 'T1', p_choice: 2 });
});

for (const bad of [-1, 1.5, 'x', 10, 99]) {
  test(`a bad poll index (${JSON.stringify(bad)}) is refused (400 bad_choice), nothing is spent`, async () => {
    const sb = fakeSupabase({ prim: 'hot_take_poll' });
    const { body, status } = await call(routes(sb)['/api/effects/play'], { cardId: 5, targetId: 'T1', choice: bad });
    assert.deepEqual([status, body.error], [400, 'bad_choice']);
    assert.deepEqual(rpcs(sb), []);
  });
}

test('/api/effects/me: a refunded play counts in no daily limit, and my unseen refunds come back', async () => {
  const sb = fakeSupabase();
  await call(routes(sb)['/api/effects/me'], {});
  const plays = sb.log.filter((x) => x.table === 'card_plays');
  const reads = plays.filter((x) => x.op === 'select').length;
  const excluded = plays.filter((x) => x.op === 'neq' && x.args[0] === 'outcome' && x.args[1] === 'refunded').length;
  assert.equal(reads, 5, 'incoming, plays today, pairs, pranked, refunds');
  assert.equal(excluded, 4, 'every count leaves the refunded plays out');
  assert.ok(plays.some((x) => x.op === 'eq' && x.args[0] === 'outcome' && x.args[1] === 'refunded'), 'the refunds read');
  assert.ok(plays.some((x) => x.op === 'is' && x.args[0] === 'refund_seen_at'), 'only the unseen ones');
});
