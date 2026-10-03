// The tiered tracks: the look and the reward labels in achievements.js must match the rules in
// tcg-bot/supabase/achievement_tracks.sql (the SQL measures and pays; the client only shows).
//   node --test src/achievements.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACHIEVEMENTS, RETIRED, TRACK_LOOK, tierReward, tierNeed, tierName, frameInfo, tagBadge } from './achievements.js';

const sql = readFileSync(new URL('../../tcg-bot/supabase/achievement_tracks.sql', import.meta.url), 'utf8');
const tracks = [...sql.matchAll(/\('(\w+)',\s+(\d+), '(\w+)',\s+'([^']+)',\s+'\{([\d,]+)\}',\s+(null|\d+),\s+'\{([^}]+)\}'\)/g)]
  .map((m) => ({ key: m[1], tiers: m[5].split(',').map(Number), step: m[6] === 'null' ? null : Number(m[6]), titles: JSON.parse(`[${m[7].replace(/''/g, "'")}]`) }));

test('the SQL defines 24 tracks and each one has a look', () => {
  assert.equal(tracks.length, 24);
  assert.deepEqual(Object.keys(TRACK_LOOK).sort(), tracks.map((t) => t.key).sort());
  for (const t of tracks) assert.ok(t.tiers.every((n, i) => i === 0 || n > t.tiers[i - 1]), `${t.key} tiers go up`);
});

test('the reward labels match ach_tier_reward', () => {
  const block = sql.slice(sql.indexOf('function public.ach_tier_reward'), sql.indexOf('function public.ach_tier_paid_before'));
  const rows = [...block.matchAll(/when (\d) then jsonb_build_object\('packs', (\d+), 'shards', (\d+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  assert.equal(rows.length, 5);
  for (const [n, packs, shards] of rows) assert.deepEqual([tierReward(n).packs, tierReward(n).shards], [packs, shards], `tier ${n}`);
  const plus = block.match(/else jsonb_build_object\('packs', (\d+), 'shards', (\d+)/);
  assert.deepEqual([tierReward(7).packs, tierReward(7).shards], [Number(plus[1]), Number(plus[2])]);
  const t = tracks.find((x) => x.key === 'raider');
  assert.equal(tierReward(3, t.titles).title, 'Raider');
  assert.equal(tierReward(8, t.titles).title, 'Warlord +3');
  assert.equal(tierReward(4, t.titles).frame, 'diamond');
});

test('the +N steps: only the tracks with a step go on after Mythic', () => {
  const packs = { ...tracks.find((x) => x.key === 'packs') };
  assert.equal(tierNeed(packs, 5), 1000);
  assert.equal(tierNeed(packs, 6), 1250);
  assert.equal(tierNeed(tracks.find((x) => x.key === 'collector'), 6), null);
  assert.equal(tierName(6), 'Mythic +1');
});

test('the retired keys = the switch map, and 13 one-time badges stay', () => {
  const map = [...sql.slice(sql.indexOf('insert into public.achievement_switch_map'), sql.indexOf('on conflict (old_key)')).matchAll(/\('(\w+)', '(\w+)', (\d+), (true|false)\)/g)].map((m) => m[1]);
  assert.deepEqual([...RETIRED].sort(), [...map].sort());
  const keys = new Set(ACHIEVEMENTS.map((a) => a.key));
  for (const k of RETIRED) assert.ok(keys.has(k), `${k} is an old key`);
  const stay = ACHIEVEMENTS.filter((a) => !RETIRED.has(a.key)).map((a) => a.key).sort();
  assert.deepEqual(stay, ['beast10', 'dup2', 'dup5', 'item5', 'mc5', 'moment10', 'party5', 'place3', 'poke10', 's1', 'smash20', 'support10', 'royal10'].sort());
});

test('frames: the old ones and the track frames with the icon', () => {
  assert.equal(frameInfo('gold').cls, 'frame-gold');
  assert.deepEqual(frameInfo('mythic:raider'), { cls: 'frame-mythic', icon: TRACK_LOOK.raider.icon, label: 'Mythic frame' });
  assert.equal(frameInfo('diamond:nope'), null);
  assert.equal(frameInfo(null), null);
});

test('a tag badge shows the cards of its set (no Event card, the right season)', () => {
  const cards = [
    { id: 1, season: 'Season 1', rarity: 'normal', tags: { origin: ['smash'], type: 'character' } },
    { id: 2, season: 'Season 1', rarity: 'event', tags: { origin: ['smash'] } },
    { id: 3, season: 'Season 2', rarity: 'normal', tags: { origin: ['smash'] } },
    { id: 4, season: 'Season 1', rarity: 'gold', tags: { origin: ['pokemon'], type: 'character' } },
  ];
  const b = tagBadge({ key: 'tag:S1:origin:smash', season: 'Season 1', tag: 'origin:smash', label: 'Smash', title: 'Smash Master S1', need: 1, have: 1, packs: 2, claimed: false }, cards);
  assert.deepEqual(b.set.map((c) => c.id), [1]);
  assert.equal(b.done, true);
  assert.equal(b.reward.packs, 2);
  const t = tagBadge({ key: 'tag:S1:type:character', season: 'Season 1', tag: 'type:character', label: 'Character', title: 'Character Master S1', need: 2, have: 1, packs: 2 }, cards);
  assert.deepEqual(t.set.map((c) => c.id), [1, 4]);
  assert.equal(t.done, false);
});
