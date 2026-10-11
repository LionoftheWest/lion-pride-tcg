// node --test src/achievements.test.js
// The answer of GET /api/achievements: the view of the SQL plus the tier rewards of the balance table (withRewards).
import test from 'node:test';
import assert from 'node:assert/strict';
import { withRewards } from './achievements.js';

const tiers = [{ packs: 1, shards: 50 }, { packs: 1, shards: 150 }, { packs: 2, shards: 200 }, { packs: 3, shards: 400 }, { packs: 5, shards: 800 }];
const step = { packs: 5, shards: 200 };

test('withRewards adds the balance tiers and step, and leaves the cached view as it was', () => {
  const view = Object.freeze({ enabled: true, tracks: [], badges: [], ready: 3 });
  const out = withRewards(view, { achievement_rewards: { tiers, step, tag_badge: { cards_per_pack: 10 } } });
  assert.deepEqual(out.rewards, { tiers, step });
  assert.equal(out.ready, 3);
  assert.equal(view.rewards, undefined, 'the input is not changed');
});

test('withRewards gives rewards: null for a missing or malformed balance value', () => {
  const view = { enabled: true };
  for (const bal of [null, undefined, {}, { achievement_rewards: {} }, { achievement_rewards: { tiers: tiers.slice(0, 3), step } }, { achievement_rewards: { tiers } }]) {
    assert.equal(withRewards(view, bal).rewards, null);
  }
  assert.deepEqual(withRewards(null, null), { enabled: false, rewards: null });
});
