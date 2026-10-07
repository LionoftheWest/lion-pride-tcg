import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOT_KEYS, balanceInt, createBalance } from './balance.js';

const ROWS = { pulls: { pack_size: 5, rates: {} }, daily: { chat_bonus_at: 25 }, pack_earn_multiplier: 1, hunt_prizes: { base: 1, ranks: [7] } };

test('the bot balance cache reads once per minute, keeps the last good values, and fails closed with none', async () => {
  let calls = 0; let fail = false; let t = 0;
  const get = createBalance(async () => { calls += 1; if (fail) throw new Error('db down'); return ROWS; }, { ttl: 60_000, now: () => t });
  assert.deepEqual(await get(), ROWS);
  await get();
  assert.equal(calls, 1, 'a second read inside the minute uses the cache');
  t = 61_000; fail = true;
  assert.deepEqual(await get(), ROWS, 'a failed refresh keeps the last good values');
  const cold = createBalance(async () => { throw new Error('db down'); });
  await assert.rejects(cold(), /db down/, 'no values at all: the call fails (no invented number)');
});

test('a missing key fails closed', async () => {
  for (const k of BOT_KEYS) {
    const rows: Record<string, unknown> = { ...ROWS }; delete rows[k];
    await assert.rejects(createBalance(async () => rows)(), new RegExp(`no value for the key ${k}`));
  }
});

test('balanceInt reads a whole number or refuses', () => {
  assert.equal(balanceInt(25, 'x'), 25);
  assert.throws(() => balanceInt(undefined, 'daily.chat_bonus_at'), /daily.chat_bonus_at/);
  assert.throws(() => balanceInt(-1, 'x'), /not a number/);
});
