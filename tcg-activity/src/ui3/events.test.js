// UI-62 the Events page: the pure rules. node --test src/ui3/events.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, norm, covers, dayKey, monthDays, lanes, dayEvents, firstEvent, left, monthEmpty, KINDS } from './events.js';

const ev = (id, kind, s, e, changes = []) => norm({ id, kind, title: id, starts_at: new Date(s).toISOString(), ends_at: new Date(e).toISOString(), changes, theme: {} });
const D = (m, d, h = 0) => new Date(2026, m - 1, d, h).getTime();

test('the display kind follows the server kind and the variable keys (D-186)', () => {
  assert.equal(kindOf({ kind: 'hunt' }), 'hunt');
  assert.equal(kindOf({ kind: 'modifier', changes: [{ key: 'pull_rare_mult' }] }), 'modifier');
  assert.equal(kindOf({ kind: 'modifier', changes: [{ key: 'dungeon_runs_per_day' }, { key: 'dungeon_shards_mult' }] }), 'dungeon');
  assert.equal(kindOf({ kind: 'modifier', changes: [{ key: 'gauntlet_runs_per_day' }] }), 'gauntlet');
  assert.equal(kindOf({ kind: 'modifier', changes: [{ key: 'dungeon_runs_per_day' }, { key: 'pull_rare_mult' }] }), 'modifier');
  assert.equal(kindOf({ kind: 'drop' }), 'community');
  for (const k of Object.values(KINDS)) assert.match(k.color, /^var\(--[a-z-]+\)$/);   // tokens only
});

test('an event covers its start day to the day of (end - 1 ms)', () => {
  const e = ev('a', 'modifier', D(10, 2), D(10, 5));
  assert.equal(covers(e, '2026-10-02'), true);
  assert.equal(covers(e, '2026-10-04'), true);
  assert.equal(covers(e, '2026-10-05'), false);   // ends at 12:00 AM of the 5th
  assert.equal(covers(e, '2026-10-01'), false);
});

test('the month is 6 weeks, Sunday first, and October 2026 starts on Thursday', () => {
  const d = monthDays(2026, 10);
  assert.equal(d.length, 42);
  assert.equal(d[0].key, '2026-09-27');
  assert.equal(d[4].key, '2026-10-01');
  assert.equal(d[4].out, false);
  assert.equal(d[0].out, true);
  assert.equal(dayKey(D(10, 4, 23)), '2026-10-04');
});

test('lanes: overlapping events get different lanes, a later event reuses a free lane', () => {
  const a = ev('a', 'hunt', D(10, 1), D(10, 5)); const b = ev('b', 'modifier', D(10, 2), D(10, 4)); const c = ev('c', 'hunt', D(10, 5), D(10, 6));
  const l = lanes([c, b, a]);
  assert.equal(l.get(a), 0); assert.equal(l.get(b), 1); assert.equal(l.get(c), 0);
});

test('the day list: live first by end time, then upcoming by start', () => {
  const now = D(10, 4, 12);
  const live2 = ev('live-late', 'hunt', D(10, 1), D(10, 8)); const live1 = ev('live-soon', 'modifier', D(10, 3), D(10, 5)); const up = ev('up', 'hunt', D(10, 4, 15), D(10, 6));
  assert.deepEqual(dayEvents([up, live2, live1], '2026-10-04', now).map((e) => e.id), ['live-soon', 'live-late', 'up']);
  assert.equal(firstEvent([up, live2, live1], now).id, 'live-soon');
  assert.equal(firstEvent([up], now).id, 'up');
  assert.equal(firstEvent([], now), null);
});

test('countdown shows the two largest units (10.5)', () => {
  assert.equal(left(3 * 86400000 + 2 * 3600000 + 5 * 60000), '3d 2h');
  assert.equal(left(2 * 3600000 + 24 * 60000), '2h 24m');
  assert.equal(left(45 * 60000), '45m');
});

test('an empty month: no event on any shown day', () => {
  const e = ev('a', 'hunt', D(10, 8), D(10, 12));
  assert.equal(monthEmpty([e], 2026, 10), false);
  assert.equal(monthEmpty([e], 2026, 12), true);
  assert.equal(monthEmpty([], 2026, 10), true);
});
