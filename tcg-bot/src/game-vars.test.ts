import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GAME_VARS_TTL_MS, createGameVars, parseGameVars, setGameVarsLoader } from './game-vars.js';
import { pulls } from './store.js';
import { packRateReply } from './commands/packrate.js';

// The shape of bot_game_vars() (game_vars_readers.sql): game_vars() and game_pull_rates(). BASE = no live event; DOUBLE = a
// live pull_rare_mult = 2 event (every rate that is not normal x 2, normal = the rest), as game_pull_rates returns it.
const BASE = { vars: { pack_earn_mult: 1, pull_rare_mult: 1 }, pulls: { pack_size: 5, rare_mult: 1,
  rates: { normal: 0.75, illustrated_rare: 0.15, secret_rare: 0.06, full_art: 0.03, gold: 0.01 } } };
const DOUBLE = { vars: { pack_earn_mult: 2, pull_rare_mult: 2 }, pulls: { pack_size: 5, rare_mult: 2,
  rates: { normal: 0.5, illustrated_rare: 0.3, secret_rare: 0.12, full_art: 0.06, gold: 0.02 } } };

test('the cache is 30 s, keeps the last good values, and fails closed with none', async () => {
  assert.equal(GAME_VARS_TTL_MS, 30_000);
  let calls = 0; let fail = false; let t = 0;
  const get = createGameVars(async () => { calls += 1; if (fail) throw new Error('db down'); return BASE; }, { now: () => t });
  assert.equal((await get()).packEarnMult, 1);
  t = 29_999; await get();
  assert.equal(calls, 1, 'a second read inside 30 s uses the cache');
  t = 30_000; await get();
  assert.equal(calls, 2, 'after 30 s it reads again');
  t = 61_000; fail = true;
  assert.equal((await get()).packEarnMult, 1, 'a failed refresh keeps the last good values');
  await assert.rejects(createGameVars(async () => { throw new Error('db down'); })(), /db down/, 'no values at all: the call fails');
});

test('a bad answer is refused (no invented number)', () => {
  assert.throws(() => parseGameVars(null), /no vars/);
  assert.throws(() => parseGameVars({ vars: { pull_rare_mult: 1 }, pulls: BASE.pulls }), /pack_earn_mult/);
  assert.throws(() => parseGameVars({ vars: { pack_earn_mult: -1 }, pulls: BASE.pulls }), /pack_earn_mult/);
  assert.throws(() => parseGameVars({ vars: { pack_earn_mult: '2' }, pulls: BASE.pulls }), /not a number/);
  assert.throws(() => parseGameVars({ vars: { pack_earn_mult: 1 }, pulls: { pack_size: 5, rates: { ...BASE.pulls.rates, normal: 0.7 } } }), /add up/);
  assert.throws(() => parseGameVars({ vars: { pack_earn_mult: 1 } }), /pack_size/);
});

test('a live 2x event changes the rates the bot rolls (store pulls reads bot_game_vars, it does not calculate them)', async () => {
  let answer: unknown = BASE;
  setGameVarsLoader(async () => answer);
  assert.deepEqual((await pulls()).rates, BASE.pulls.rates);
  answer = DOUBLE;
  setGameVarsLoader(async () => answer); // a new cache: the next read after the 30 s
  const r = (await pulls()).rates;
  assert.deepEqual(r, DOUBLE.pulls.rates);
  for (const k of ['illustrated_rare', 'secret_rare', 'full_art', 'gold'] as const) assert.equal(r[k], 2 * BASE.pulls.rates[k], k);
  setGameVarsLoader(null);
});

test('the /packrate reply', () => {
  assert.match(packRateReply(2, { ok: true, event: { key: 'packrate_x', ends_at: '2026-10-18T00:00:00Z' } }), /×2.*<t:1792281600:F>.*packrate_x/);
  assert.match(packRateReply(1, { ok: true, note: 'none' }), /No \/packrate event/);
  assert.match(packRateReply(1, { ok: true, ended: true }), /ended/);
  assert.match(packRateReply(9, { ok: false, errors: ['vars: pack_earn_mult must be from 0 to 5'] }), /not changed: vars: pack_earn_mult/);
});
