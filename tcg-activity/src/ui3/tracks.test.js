// node --test src/ui3/tracks.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as T from './tracks.js';

const track = { key: 'collector', name: 'Collector', tiers: [25, 75, 150, 250, 350], step: null, titles: ['Collector', 'Archivist', 'Living Library'], value: 161, reached: 3, claimed: 0, next: 250 };
const stepTrack = { key: 'podium', name: 'Podium', tiers: [1, 3, 8, 15, 30], step: 10, titles: ['Podium Finisher', 'Champion', 'Hall of Famer'], value: 35, reached: 5, claimed: 5, next: 40 };

test('tier names follow D-74 and run on as Obsidian +N', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(T.tierName), ['Bronze', 'Silver', 'Platinum', 'Diamond', 'Obsidian']);
  assert.equal(T.tierName(6), 'Obsidian +1');
  assert.equal(T.tierName(9), 'Obsidian +4');
  assert.equal(T.tierKey(7), 'obsidian');
  assert.equal(T.tierKey(1), 'bronze');
});

// invented numbers: the amounts must come from the rewards that the view carries, not from the client
const rewards = { tiers: [{ packs: 7, shards: 11 }, { packs: 1, shards: 22 }, { packs: 2, shards: 33 }, { packs: 3, shards: 44 }, { packs: 9, shards: 55 }], step: { packs: 4, shards: 66 } };

test('the amounts of each tier come from the given rewards, with the title and the frame', () => {
  const txt = (n) => T.rewardText(T.tierReward(n, track.titles, rewards));
  assert.equal(txt(1), '7 packs + 11 Shards');
  assert.equal(txt(2), '1 pack + 22 Shards');
  assert.equal(txt(3), '2 packs + 33 Shards + "Collector"');
  assert.equal(txt(4), '3 packs + 44 Shards + "Archivist" + Diamond frame');
  assert.equal(txt(5), '9 packs + 55 Shards + "Living Library" + Obsidian frame');
  assert.equal(T.rewardShort(4, track.titles, rewards), 'Diamond · 3 packs · 44 Shards · title · frame');
  assert.equal(T.rewardShort(1, track.titles, rewards), 'Bronze · 7 packs · 11 Shards');
  assert.equal(T.trackRows(track, rewards)[0].reward, '7 packs + 11 Shards');
});

test('tier 6 and later use the step reward and a "+N" title', () => {
  assert.equal(T.rewardText(T.tierReward(6, stepTrack.titles, rewards)), '4 packs + 66 Shards + "Hall of Famer +1"');
  assert.equal(T.rewardText(T.tierReward(8, stepTrack.titles, rewards)), '4 packs + 66 Shards + "Hall of Famer +3"');
});

test('missing or malformed rewards give no amounts (fail closed): the title and the frame only', () => {
  for (const bad of [null, undefined, {}, { tiers: [], step: {} }, { tiers: rewards.tiers }, { tiers: rewards.tiers.slice(0, 4), step: rewards.step }, 'x']) {
    assert.equal(T.rewardText(T.tierReward(1, track.titles, bad)), '', 'tier 1 shows nothing');
    assert.equal(T.rewardText(T.tierReward(4, track.titles, bad)), '"Archivist" + Diamond frame');
    assert.equal(T.rewardText(T.tierReward(6, stepTrack.titles, bad)), '"Hall of Famer +1"');
    assert.equal(T.rewardShort(2, track.titles, bad), 'Silver');
    assert.equal(T.rewardShort(5, track.titles, bad), 'Obsidian · title · frame');
  }
  assert.equal(T.rewardText(T.tierReward(1, track.titles)), '', 'no rewards argument at all');
  const junk = { tiers: [{ packs: -3, shards: 'x' }, {}, null, { packs: 1.9, shards: 2 }, { packs: 1, shards: 1 }], step: { packs: 1, shards: 1 } };
  assert.equal(T.rewardText(T.tierReward(1, track.titles, junk)), '', 'a bad number is no amount');
  assert.equal(T.rewardText(T.tierReward(4, track.titles, junk)), '1 pack + 2 Shards + "Archivist" + Diamond frame');
});

test('the client holds no reward amount', () => {
  assert.equal(T.TIER_REWARDS, undefined);
  assert.equal(T.STEP_REWARD, undefined);
});

test('every track of the SQL has a look', () => {
  const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tcg-bot', 'supabase', 'achievement_tracks.sql'), 'utf8');
  const keys = [...sql.matchAll(/^\s*\('([a-z]+)',\s*\d+,\s*'[A-Za-z ]+',\s*'/gm)].map((x) => x[1]);
  assert.ok(keys.length >= 20, `found ${keys.length} tracks in the SQL`);
  for (const k of keys) assert.ok(T.TRACK_LOOK[k], `track ${k} has a look`);
});

test('ready, claim label and the goal of a track', () => {
  assert.equal(T.readyOf(track), 3);
  assert.equal(T.readyOf(stepTrack), 0);
  assert.equal(T.claimLabel(3), 'Claim 3');
  assert.equal(T.claimLabel(1), 'Claim');
  assert.equal(T.claimLine(43), '43 to claim');
  assert.deepEqual(T.trackGoal(track), { need: 250, done: false });
  assert.ok(Math.abs(T.trackFill(track) - 161 / 250) < 1e-9);
  assert.equal(T.trackFill({ ...track, next: null, reached: 5 }), 1);
});

test('the window rows: states, needs and the step of a track that goes on', () => {
  const rows = T.trackRows(track);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.state), ['ready', 'ready', 'ready', 'locked', 'locked']);
  assert.equal(rows[3].need, 250);
  const srows = T.trackRows(stepTrack);
  assert.equal(srows.length, 6);
  assert.equal(srows[5].name, 'Obsidian +1');
  assert.equal(srows[5].need, 40);
  assert.deepEqual(srows.map((r) => r.state), ['claimed', 'claimed', 'claimed', 'claimed', 'claimed', 'locked']);
});

test('tracks with a reward ready come first, the rest keep their order', () => {
  const a = { ...track, key: 'a', reached: 0, claimed: 0 }; const b = { ...track, key: 'b' }; const c = { ...track, key: 'c', reached: 0, claimed: 0 }; const d = { ...track, key: 'd' };
  assert.deepEqual(T.trackOrder([a, b, c, d]).map((t) => t.key), ['b', 'd', 'a', 'c']);
});

test('a tag badge row and the badge list order (ready, progress, claimed)', () => {
  const b = { key: 'tag:S1:origin:smash', tag: 'origin:smash', have: 52, need: 53, label: 'Smash', packs: 7, short: 'S1', title: 'Smash Master S1', season: 'Season 1', claimed: false };
  const cards = [{ season: 'Season 1', rarity: 'normal', tags: { origin: ['smash'] } }, { season: 'Season 1', rarity: 'event', tags: { origin: ['smash'] } }, { season: 'Season 1', rarity: 'normal', tags: { origin: ['pokemon'] } }];
  const row = T.tagBadge(b, cards);
  assert.equal(row.set.length, 1);
  assert.equal(row.have, 52);
  assert.equal(row.done, false);
  assert.equal(row.iconName, 'swords');
  assert.equal(T.badgeReward(row.reward), '7 packs + "Smash Master S1" title');
  const done = { ...row, key: 'x', done: true, have: 53 }; const claimed = { ...row, key: 'y', done: true, claimed: true }; const half = { ...row, key: 'z', have: 10 };
  const old = [{ key: 'first', have: 1, need: 1, done: true }, { key: 's1', have: 3, need: 10, done: false }];
  const list = T.badgeList([claimed, half, done, row], old, new Set(), new Set(['first']));
  assert.deepEqual(list.map((a) => a.key), ['x', 'tag:S1:origin:smash', 's1', 'z', 'y']);
});

test('the gallery rows: titles and frames, owned first, D-74 words', () => {
  const view = { tracks: [track], badges: [{ key: 'tag:S1:origin:pokemon', title: 'Pokemon Master S1', label: 'Pokemon', season: 'Season 1' }] };
  const gallery = { members: 29, items: [
    { kind: 'title', value: 'Collector', track: 'collector', tier: 3, need: 150, owners: 0, mine: false },
    { kind: 'title', value: 'Archivist', track: 'collector', tier: 4, need: 250, owners: 28, mine: true },
    { kind: 'frame', value: 'diamond:collector', track: 'collector', tier: 4, need: 250, owners: 0, mine: false },
    { kind: 'frame', value: 'mythic:collector', track: 'collector', tier: 5, need: 350, owners: 0, mine: false },
    { kind: 'title', value: 'Pokemon Master S1', badge: 'tag:S1:origin:pokemon', owners: 3, mine: true },
    { kind: 'title', value: 'Rare Hunter', badge: 'ir10', name: 'Rare Hunter', how: 'Own 10 Illustrated Rares', retired: true, owners: 27, mine: true },
    { kind: 'frame', value: 'silver', badge: 'own50', name: 'Collector', how: 'Own 50 different cards', retired: true, owners: 28, mine: true },
  ] };
  const titles = T.galleryRows(gallery, view, 'title', { equipped: 'Archivist' });
  assert.deepEqual(titles.map((r) => r.label), ['Archivist', 'Pokemon Master S1', 'Rare Hunter', 'Collector']);
  assert.equal(titles[0].desc, 'Diamond Collector: Own different cards (250)');
  assert.equal(titles[0].source, 'Diamond');
  assert.equal(titles[0].equipped, true);
  assert.equal(titles[1].desc, 'Pokemon Master S1: Own every Pokemon card in Season 1');
  assert.equal(titles[2].desc, 'Rare Hunter: Own 10 Illustrated Rares (no longer available)');
  assert.equal(titles[3].locked, true);
  assert.equal(T.membersLine(28, 29), '28 of 29 members');
  const frames = T.galleryRows(gallery, view, 'frame');
  assert.deepEqual(frames.map((r) => r.label), ['Silver frame', 'Diamond frame', 'Obsidian frame']);
  assert.equal(frames[2].desc, 'Obsidian Collector: Own different cards (350)');
});

// D-183: tiers 1..old_paid were paid by an old achievement: no packs, the Shards, title and frame stay, the row says why
test('old_paid 0, 2, 5 and missing: no packs only on the tiers 1..old_paid, in the rows and the tile foot', () => {
  const rowsOf = (op) => T.trackRows({ ...track, ...(op === undefined ? {} : { old_paid: op }) }, rewards);
  const missing = rowsOf(undefined);
  assert.deepEqual(rowsOf(0).map((r) => r.reward), missing.map((r) => r.reward));
  assert.equal(missing[0].reward, '7 packs + 11 Shards');
  assert.ok(missing.every((r) => !r.oldPaid));
  const two = rowsOf(2);
  assert.deepEqual(two.map((r) => r.oldPaid), [true, true, false, false, false]);
  assert.equal(two[0].reward, '11 Shards');
  assert.equal(two[1].reward, '22 Shards');
  assert.equal(two[2].reward, '2 packs + 33 Shards + "Collector"');
  const five = rowsOf(5);
  assert.equal(five[3].reward, '44 Shards + "Archivist" + Diamond frame');
  assert.equal(five[4].reward, '55 Shards + "Living Library" + Obsidian frame');
  assert.ok(five.every((r) => r.oldPaid));
  assert.equal(T.OLD_PAID_NOTE, 'Pack paid by an old achievement');
  // claimed and unclaimed rows alike
  assert.equal(T.trackRows({ ...track, old_paid: 2, claimed: 2, reached: 3 }, rewards)[0].oldPaid, true);
  // the tile foot
  assert.equal(T.rewardShort(2, track.titles, rewards, T.tierOldPaid({ old_paid: 2 }, 2)), 'Silver · 22 Shards');
  assert.equal(T.rewardShort(2, track.titles, rewards, T.tierOldPaid({ old_paid: 1 }, 2)), 'Silver · 1 pack · 22 Shards');
  assert.equal(T.rewardShort(2, track.titles, rewards, T.tierOldPaid({}, 2)), 'Silver · 1 pack · 22 Shards');
  // a step tier (n > 5) is never an old-paid tier
  assert.equal(T.tierOldPaid({ old_paid: 9 }, 6), false);
});

import { setRewardsFrom } from '../achievements.js';
test('the frame label of a set frame is "<set name> Frame" (D-191); the old labels are unchanged; an unknown set is "Holo frame"', () => {
  setRewardsFrom([{ id: 'S1', name: 'Origins', pack_color: '#ff8d4d' }, { id: 'S2', name: 'Double Team', pack_color: '#3366cc' }]);
  assert.equal(T.frameLabel('holo:S1'), 'Origins Frame');
  assert.equal(T.frameLabel('holo:S2'), 'Double Team Frame');
  assert.equal(T.frameLabel('holo:S9'), 'Holo frame');
  assert.equal(T.frameLabel('holo'), 'Holo frame');
  assert.equal(T.frameLabel('diamond:collector'), 'Diamond frame');
  assert.equal(T.rewardText({ packs: 5, title: 'Origins Champion', frame: 'holo:S1' }), '5 packs + "Origins Champion" + Origins Frame');
  const rows = T.galleryRows({ items: [{ kind: 'frame', value: 'holo:S1', badge: 's1', how: 'Origins Set Complete', name: 'Origins Set Complete' }] }, { tracks: [], badges: [] }, 'frame');
  assert.equal(rows[0].label, 'Origins Frame');
  setRewardsFrom([]);
});
