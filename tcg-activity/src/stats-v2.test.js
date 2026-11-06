// STAT-V2 G-C3 (SPEC v3 4.4): statsPayload (the stats part of /api/collection) and parseSpendV2 (the v2 spend body).
//   node --test tcg-activity/src/stats-v2.test.js
// STATS_V2_MODULE=<path> runs the same test on another copy of the module (the mutation runs of the REPORT).
// The samples are REAL answers of the local copy of live after the switch (2026-11-06, one converted player, 3 cards; rolled back):
// card_stats_for (v1) and card_stats_v2_for (v2, stat_v2.sql). Card 316 has v1 Support and Recharge points (potency 1.36, haste 0.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const MOD = process.env.STATS_V2_MODULE ? pathToFileURL(resolve(process.env.STATS_V2_MODULE)).href : './stats-v2.js';
const { statsPayload, parseSpendV2, statV2Allowed, V2_STAT_KEYS } = await import(MOD);

export const V1 = { on: true, week: '2026-45', reset_week: '2026-41', cards: {
  24: { cp: 40, hp: 72, on: true, crit: 0.00, free: 6, haste: 1.0, points: {}, potency: 1.00 },
  316: { cp: 43, hp: 77, on: true, crit: 0.00, free: 0, haste: 0.7, points: { haste: 3, potency: 3 }, potency: 1.36 } } };
export const V2 = { on: true, week: '2026-45', reset_week: '2026-41', cards: {
  24: { cp: 56.372, hp: 134.558, v2: true, cap: 10, crit: 0.00, free: 6, bonus: 0, haste: 1.0, level: 6,
    points: { hp: 0, abl: 0, acc: 0, atk: 0, crd: 0, crt: 0, ddg: 0, def: 0, spd: 0 }, potency: 1.00 },
  28: { cp: 140.37302, hp: 260.55953, v2: true, cap: 10, crit: 0.00, free: 0, bonus: 0, haste: 1, level: 0,
    points: { hp: 0, abl: 0, acc: 0, atk: 0, crd: 0, crt: 0, ddg: 0, def: 0, spd: 0 }, potency: 1 },
  316: { cp: 59.24, hp: 138.86, v2: true, cap: 10, crit: 0.00, free: 0, bonus: 12, haste: 0.7, level: 6,
    points: { hp: 0, abl: 8, acc: 0, atk: 0, crd: 0, crt: 0, ddg: 0, def: 0, spd: 10 }, potency: 1.36 } } };
const CARDS = () => [{ id: 316, name: 'a' }, { id: 24, name: 'b' }, { id: 28, name: 'c' }];

// The code of tcg-activity/server.js at 37f3025b (lines 631-638), copied: the flag-off payload must stay exactly this.
function before(cards, st) {
  let stats = null;
  if (st?.on) {
    stats = { on: true, week: st.week, resetUsed: st.reset_week === st.week };
    for (const c of cards) { const x = st.cards?.[String(c.id)]; if (x) c.stat = x; }
  }
  return { stats, cards };
}

test('flag off (no v2 answer, {on: false}, a failed read): the payload equals the code of before for the recorded v1 answer', () => {
  for (const v2 of [null, undefined, { on: false }, { on: 'true' }]) {
    const a = CARDS(), b = CARDS();
    assert.deepEqual(statsPayload(a, structuredClone(V1), v2), before(b, structuredClone(V1)));
  }
  // v1 off as well: no stats, no c.stat (as before)
  const a = CARDS();
  assert.deepEqual(statsPayload(a, { on: false }, { on: false }), { stats: null, cards: CARDS() });
});

test('flag on: stats {on, v2, week, resetUsed}; every card of the answer gets its v2 line with v2, cp, hp, crit, potency, haste', () => {
  const r = statsPayload(CARDS(), structuredClone(V1), structuredClone(V2));
  assert.deepEqual(r.stats, { on: true, v2: true, week: '2026-45', resetUsed: false });
  for (const c of r.cards) {
    for (const k of ['v2', 'cp', 'hp', 'crit', 'potency', 'haste', 'level', 'free', 'cap', 'bonus', 'points']) assert.ok(c.stat && k in c.stat, `card ${c.id} has ${k}`);
    assert.equal(c.stat.v2, true);
    assert.deepEqual(c.stat, V2.cards[c.id]);
    for (const k of ['cp', 'hp', 'crit', 'potency', 'haste']) assert.ok(Number.isFinite(c.stat[k]), `card ${c.id} ${k} is a number`);
  }
  // the v1 potency and haste ride along (play_card_effect still uses the v1 points)
  assert.equal(r.cards.find((c) => c.id === 316).stat.potency, 1.36);
  assert.equal(r.cards.find((c) => c.id === 316).stat.haste, 0.7);
  // resetUsed when the week is used
  assert.equal(statsPayload(CARDS(), null, { ...V2, reset_week: '2026-45' }).stats.resetUsed, true);
});

test('parseSpendV2: the 9 v2 keys, each a whole number 1..cap; refuses 0, cap + 1, a v1 key, a float, an empty or a bad body', () => {
  assert.deepEqual(V2_STAT_KEYS, ['atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd']);
  assert.deepEqual(parseSpendV2({ cardId: 316, add: { atk: 1, spd: 10 } }, 10), { cardId: 316, add: { atk: 1, spd: 10 } });
  for (const k of V2_STAT_KEYS) assert.deepEqual(parseSpendV2({ cardId: 5, add: { [k]: 2 } }, 10), { cardId: 5, add: { [k]: 2 } });
  assert.deepEqual(parseSpendV2({ cardId: 316, add: { atk: 0 } }, 10), { error: 'bad amount' });
  assert.deepEqual(parseSpendV2({ cardId: 316, add: { atk: 11 } }, 10), { error: 'bad amount' });
  assert.deepEqual(parseSpendV2({ cardId: 316, add: { atk: 1.5 } }, 10), { error: 'bad amount' });
  assert.deepEqual(parseSpendV2({ cardId: 316, add: { atk: '2' } }, 10), { error: 'bad amount' });
  assert.deepEqual(parseSpendV2({ cardId: 316, add: { attack: 1 } }, 10), { error: 'bad stat' });
  assert.deepEqual(parseSpendV2({ cardId: 316, add: {} }, 10), { error: 'bad request' });
  assert.deepEqual(parseSpendV2({ cardId: 316, add: [1] }, 10), { error: 'bad request' });
  assert.deepEqual(parseSpendV2({ cardId: 316 }, 10), { error: 'bad request' });
  assert.deepEqual(parseSpendV2({ cardId: 316, add: { atk: 1 } }, undefined), { error: 'bad request' });
  assert.deepEqual(parseSpendV2({ add: { atk: 1 } }, 10), { error: 'bad card' });
  assert.deepEqual(parseSpendV2({ cardId: 1.5, add: { atk: 1 } }, 10), { error: 'bad card' });
});

test('statV2Allowed: the SQL rule stat_v2_on (global progress AND (enabled OR listed)); a bad shape = off', () => {
  const id = '111111111111111111';
  assert.equal(statV2Allowed(true, { enabled: false, users: [id] }, id), true);
  assert.equal(statV2Allowed(true, { enabled: true, users: [] }, id), true);
  assert.equal(statV2Allowed(true, { enabled: false, users: [] }, id), false);
  assert.equal(statV2Allowed(false, { enabled: true, users: [id] }, id), false);   // progress off: never (a tester alone is not on)
  assert.equal(statV2Allowed(undefined, { enabled: true, users: [id] }, id), false);
  assert.equal(statV2Allowed(true, { enabled: 'true', users: [id] }, id), false);
  assert.equal(statV2Allowed(true, { enabled: false, users: id }, id), false);
  assert.equal(statV2Allowed(true, null, id), false);
});
