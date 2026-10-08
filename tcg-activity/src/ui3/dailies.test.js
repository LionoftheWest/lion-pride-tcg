// UI-36 the Dailies window (v3): the strings of the approved design, every number from the server view, the
// streak week, the reset text (FEEDBACK D-80 item 26), the claim rules and the pager. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailiesHTML, readyTasks, readyPacks, resetText, streakMarks } from './dailies.js';

const task = (k, o = {}) => ({ task: k, done: false, claimed: false, have: 0, need: 1, reward: 1, ...o });
const VIEW = {
  enabled: true, paused: false, cap: 5, earned: 3, shards: 40, shards_today: 120, streak_cycle: 7,
  resets_at: '2026-10-05T06:00:00Z',
  tasks: [
    task('checkin', { done: true, claimed: true, streak: 4 }),
    { task: 'chat', auto: true, have: 19, need: 25, packs: 1, max: 2, next: 1 },
    task('hunt', { live: false }), task('voice', { need: 30 }), task('social', { done: true, have: 1, claimed: true }),
    task('dungeon'), task('gauntlet'),
  ],
};
const NOW = Date.parse('2026-10-04T21:37:00Z');   // 8h 23m before the reset
const text = (html) => html.replace(/<wbr>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('UI-36 strings: the approved labels (sentence case in the string, caps from the label style)', () => {
  const t = text(dailiesHTML(VIEW, { now: NOW }));
  for (const s of ['Dailies', 'Resets in 8h 23m · midnight MT', 'Today', '3 / 5 packs', '120 Shards', '3 earned', '0 ready', '2 to go',
    'Check in', 'Day 4', 'Chat', '19/25 msgs', 'Auto', 'Hunt the boss', 'No boss', 'Voice with someone', '0/30 min',
    'Trade or boon', 'Dungeon run', '0/1', 'Gauntlet run']) assert.ok(t.includes(s), `missing "${s}" in: ${t}`);
  assert.doesNotMatch(t, /TODAY|DAY 4|AUTO|🔥|🎁|Raid|quest/);
  assert.doesNotMatch(dailiesHTML(VIEW, { now: NOW }), /…/);
});

test('UI-36 numbers come from the view: the cap, the Shards and the streak week are never a client copy', () => {
  const v = { ...VIEW, cap: 7, shards: 55, streak_cycle: 5 };
  const h = dailiesHTML(v, { now: NOW });
  assert.equal((h.match(/u3-dl-seg__s/g) || []).length, 7);           // 7 segments for cap 7
  assert.equal((h.match(/class="u3-dl-mark /g) || []).length, 5);     // 5 marks for a 5-day week
  assert.match(text(h), /3 \/ 7 packs/); assert.match(text(h), /\+55/); assert.doesNotMatch(text(h), /\+40/);
  // no streak week from the server: no marks (no invented 7)
  const { streak_cycle: _, ...noCycle } = VIEW;
  assert.equal((dailiesHTML(noCycle, { now: NOW }).match(/class="u3-dl-mark /g) || []).length, 0);
  // no Shards: no Shards chip and no Shards total
  assert.doesNotMatch(text(dailiesHTML({ ...VIEW, shards: 0 }, { now: NOW })), /Shards|\+40/);
});

test('UI-36 claim: the ready count, the button text, the cap and the pause', () => {
  const ready = { ...VIEW, earned: 0, shards_today: 0, tasks: [task('checkin', { done: true, streak: 0 }), task('voice', { done: true, have: 30, need: 30 })] };
  assert.equal(readyTasks(ready).length, 2); assert.equal(readyPacks(ready), 2);
  const h = dailiesHTML(ready, { now: NOW });
  assert.match(h, /data-task="checkin"/); assert.match(text(h), /Claim \+1/); assert.match(text(h), /Claim all \+2/); assert.match(text(h), /Day 1/);
  assert.match(h, /u3-counter[^>]*>2</);
  assert.match(text(dailiesHTML({ ...ready, earned: 5 }, { now: NOW })), /Claim(?! \+)/);        // at the cap: "Claim" (the Shards still pay)
  assert.equal(readyTasks({ ...ready, earned: 5, shards: 0 }).length, 0);                        // at the cap with no Shards: nothing to claim
  assert.equal(readyTasks({ ...ready, paused: true }).length, 0);
  assert.equal(resetText({ paused: true }), 'Paused');
  assert.equal(resetText({ resets_at: '2026-10-05T06:00:00Z' }, Date.parse('2026-10-05T05:40:00Z')), 'Resets in 20m · midnight MT');
});

test('UI-36 streak marks: done, today (ring) and to come, in a week of the server length', () => {
  assert.deepEqual(streakMarks({ streak: 3, claimed: false }, 7).marks, ['done', 'done', 'done', 'today', 'next', 'next', 'next']);
  assert.deepEqual(streakMarks({ streak: 4, claimed: true }, 7).marks, ['done', 'done', 'done', 'today done', 'next', 'next', 'next']);
  assert.equal(streakMarks({ streak: 7, claimed: false }, 7).day, 8);
  assert.deepEqual(streakMarks({ streak: 7, claimed: false }, 7).marks[0], 'today');               // day 8 = the first mark of week 2
});

test('UI-36 pager (3.5): a page holds perPage tasks, "1 / N" only when the tasks do not fit', () => {
  assert.doesNotMatch(dailiesHTML(VIEW, { now: NOW }), /u3-pager/);
  const p1 = dailiesHTML(VIEW, { now: NOW, perPage: 3 });
  assert.match(p1, /1 \/ 3/); assert.equal((p1.match(/class="u3-dl-task /g) || []).length, 3);
  const p3 = dailiesHTML(VIEW, { now: NOW, perPage: 3, page: 3 });
  assert.equal((p3.match(/class="u3-dl-task /g) || []).length, 1); assert.match(text(p3), /Gauntlet run/);
  assert.match(dailiesHTML(VIEW, { now: NOW, perPage: 3, page: 9 }), /3 \/ 3/);   // a page past the end shows the last page
});

test('UI-36 numbers: the compact form from 10,000 on the compact classes (10.5, G-168)', () => {
  const big = { ...VIEW, shards: 123456789, shards_today: 123456789 };
  assert.match(text(dailiesHTML(big, { now: NOW, size: 'compact-port' })), /\+123\.5M/);
  assert.match(text(dailiesHTML(big, { now: NOW, size: 'expanded' })), /123,456,789/);
});

test('UI-36 off: "Nothing here yet." and no reset chip', () => {
  const t = text(dailiesHTML({ enabled: false }));
  assert.match(t, /Dailies Nothing here yet\./); assert.doesNotMatch(t, /Resets/);
});
