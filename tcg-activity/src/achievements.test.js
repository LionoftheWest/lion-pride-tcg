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

// ---- "<set name> Set Complete" (D-190) ----
import { achievementList, measure, setKey, rewardOf, BASE_ACHIEVEMENTS, setRewardFor, setRewardsFrom, frameBase, rewardLabel, REWARDS } from './achievements.js';

const S1 = { id: 'S1', name: 'Origins' };
const S2 = { id: 'S2', name: 'Double Team' };
const card = (id, set_id, rarity, have = true) => ({ id, set_id, rarity, season: 'Season 1', tags: {}, owned: have, quantity: have ? 1 : 0, ascension: 0 });
const cat = [card(1, 'S1', 'normal'), card(2, 'S1', 'normal'), card(3, 'S1', 'gold', false), card(4, 'S2', 'normal', false), card(5, 'S2', 'normal', false)];
const find = (list, key) => list.find((a) => a.key === key);

test('S1 keeps the key s1 and is named from the set: "Origins Set Complete"', () => {
  const a = find(achievementList([S1]), 's1');
  assert.equal(a.name, 'Origins Set Complete');
  assert.equal(a.desc, 'Own every Origins base card');
  assert.equal(setKey('S1'), 's1');
  assert.equal(setKey('S2'), 'set:S2');
});

test('a set that is not pullable has no achievement (S2 hidden), and the count stays 50', () => {
  const list = achievementList([S1]);
  assert.equal(list.length, 50);
  assert.equal(find(list, 'set:S2'), undefined);
  assert.equal(measure(cat, {}, [S1]).some((a) => a.key === 'set:S2'), false);
});

test('S2 shows by itself, named "Double Team Set Complete", when its set is in the released list', () => {
  const list = achievementList([S1, S2]);
  assert.equal(list.length, 51);
  assert.equal(find(list, 'set:S2').name, 'Double Team Set Complete');
  assert.equal(find(list, 's1').name, 'Origins Set Complete');
  assert.equal(list.filter((a) => a.key === 's1' || a.key === 'set:S2').length, 2);
  assert.equal(new Set(list.map((a) => a.key)).size, list.length, 'the keys are unique');
});

test('the rule: every base (normal) card of the set by set_id; other rarities and other sets do not count', () => {
  const m = measure(cat, {}, [S1, S2]);
  const s1 = find(m, 's1'); const s2 = find(m, 'set:S2');
  assert.deepEqual([s1.have, s1.need, s1.done], [2, 2, true], 'the gold card is not needed');
  assert.deepEqual([s2.have, s2.need, s2.done], [0, 2, false]);
  const part = measure(cat.map((c) => (c.id === 2 ? { ...c, owned: false } : c)), {}, [S1]);
  assert.equal(find(part, 's1').done, false);
  const season = measure(cat.map((c) => ({ ...c, season: 'Season 2' })), {}, [S1]); // the season TEXT is not read
  assert.equal(find(season, 's1').done, true);
});

const RW = { badges: { s1: { packs: 5, title: 'Origins Champion', frame: 'holo' } }, set_complete: { packs: 5, title: '{name} Champion', frame: 'holo:{id}' } };
test('the reward of a set: S1 from its own row, a later set from the rule set_complete (D-191, D-192), no rule = nothing', () => {
  assert.deepEqual(setRewardFor(RW, { id: 'S1', name: 'Origins' }), { packs: 5, title: 'Origins Champion', frame: 'holo' });
  assert.deepEqual(setRewardFor(RW, { id: 'S2', name: 'Double Team' }), { packs: 5, title: 'Double Team Champion', frame: 'holo:S2' });
  assert.deepEqual(setRewardFor({ ...RW, badges: { ...RW.badges, 'set:S2': { packs: 9 } } }, { id: 'S2', name: 'Double Team' }), { packs: 9 }, 'a row of its own wins');
  assert.deepEqual(setRewardFor({ badges: {} }, { id: 'S2', name: 'Double Team' }), {});
  assert.deepEqual(setRewardFor(null, { id: 'S1', name: 'Origins' }), {});
});
test('the client holds no set reward: rewardOf reads what the server sent (setRewardsFrom), the other keys are unchanged', () => {
  setRewardsFrom([]);
  assert.deepEqual(rewardOf('s1'), {}, 'nothing sent: nothing shown');
  assert.deepEqual(rewardOf('set:S2'), {});
  setRewardsFrom([{ id: 'S1', name: 'Origins', reward: RW.badges.s1 }, { id: 'S2', name: 'Double Team', reward: setRewardFor(RW, { id: 'S2', name: 'Double Team' }) }]);
  assert.deepEqual(rewardOf('s1'), { packs: 5, title: 'Origins Champion', frame: 'holo' });
  assert.deepEqual(rewardOf('set:S2'), { packs: 5, title: 'Double Team Champion', frame: 'holo:S2' });
  assert.deepEqual(rewardOf('first'), { packs: 1 });
  assert.equal(REWARDS.s1, undefined);
  setRewardsFrom([]);
});
test('a set frame key falls back to the holo look and label (no design yet)', () => {
  assert.equal(frameBase('holo:S2'), 'holo');
  assert.equal(frameBase('holo'), 'holo');
  assert.equal(rewardLabel({ packs: 5, title: 'Double Team Champion', frame: 'holo:S2' }), '5 packs + "Double Team Champion" title + Holo frame');
});

test('without a set list the one claimed set keeps its key (no answer yet, never a lost achievement)', () => {
  for (const none of [undefined, null, []]) assert.ok(find(achievementList(none), 's1'));
  assert.equal(BASE_ACHIEVEMENTS.length, 49);
});
