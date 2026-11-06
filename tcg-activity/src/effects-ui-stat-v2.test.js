// STAT-V2 G-C4 (SPEC v3 4.5 and section 11): the effect card (effects-ui.js scaled) shows the same bonus with the v2 c.stat as with the
// v1 c.stat. play_card_effect still uses the v1 points (play_card_effect.sql 145-149), so the v2 line keeps the v1 potency and haste.
//   node --test tcg-activity/src/effects-ui-stat-v2.test.js
// STATS_V2_MODULE=<path> runs the same test on another copy of stats-v2.js (the mutation runs of the REPORT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { initEffects, effectScaled } from './effects-ui.js';
import { V1, V2 } from './stats-v2.test.js';

const MOD = process.env.STATS_V2_MODULE ? pathToFileURL(resolve(process.env.STATS_V2_MODULE)).href : './stats-v2.js';
const { statsPayload } = await import(MOD);

test('the effect bonus of a card with v1 Support and Recharge points (potency 1.36, haste 0.7) is the same with the v1 and the v2 c.stat', async () => {
  // the effects state off (no DOM work); stat points on, as on live
  await initEffects({ api: async () => ({ enabled: false }), statsOn: () => true, lookup: () => null });
  const base = { id: 316, rarity: 'normal', ascension: 2, effect: { primitive: 'x', base: { amount: 10, duration_s: 60 }, cooldown_h: 24 } };
  const v1Card = { ...base, stat: structuredClone(V1.cards[316]) };
  const [v2Card] = statsPayload([{ ...base }], structuredClone(V1), structuredClone(V2)).cards;
  assert.equal(v2Card.stat.v2, true);
  const a = effectScaled(v1Card), b = effectScaled(v2Card);
  assert.deepEqual(b, a);
  assert.deepEqual(a.starBonus, { points: true, power: 36, cd: 30 });
  // a card with no v1 points: no bonus with either line
  const c1 = effectScaled({ ...base, id: 24, stat: structuredClone(V1.cards[24]) });
  const [c2card] = statsPayload([{ ...base, id: 24 }], null, structuredClone(V2)).cards;
  assert.deepEqual(effectScaled(c2card), c1);
  assert.equal(c1.starBonus, null);
});
