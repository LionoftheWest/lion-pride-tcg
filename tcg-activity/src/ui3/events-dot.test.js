// UI-05 / UI-60 the daily Events Dot (D-198). node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { denverDay, seenToday, setEventsLive, eventsDotOn, markEventsSeen, resetEventsDot, SEEN_KEY } from './events-dot.js';

const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const T1 = Date.parse('2026-10-14T20:00:00Z');   // 14:00 MDT, Oct 14

test('the day is the America/Denver day (a night UTC time is still the day before in Denver)', () => {
  assert.equal(denverDay(T1), '2026-10-14');
  assert.equal(denverDay(Date.parse('2026-10-15T05:30:00Z')), '2026-10-14');
  assert.equal(denverDay(Date.parse('2026-10-15T06:30:00Z')), '2026-10-15');
});
test('no live event or flag off: no Dot', () => {
  resetEventsDot();
  assert.equal(eventsDotOn(T1, store()), false);
  setEventsLive(0);
  assert.equal(eventsDotOn(T1, store()), false);
});
test('the first visit of the day shows the Dot, opening the page or a slide ends it, the next Denver day shows it again', () => {
  resetEventsDot(); const s = store();
  setEventsLive(2);
  assert.equal(eventsDotOn(T1, s), true);
  markEventsSeen(T1, s);
  assert.equal(s.getItem(SEEN_KEY), '2026-10-14');
  assert.equal(eventsDotOn(T1 + 3600e3, s), false, 'same day: gone');
  assert.equal(eventsDotOn(Date.parse('2026-10-15T07:00:00Z'), s), true, 'next day in Denver: back');
});
test('storage off: the Dot still ends for this visit', () => {
  resetEventsDot();
  const off = { getItem() { throw new Error('off'); }, setItem() { throw new Error('off'); } };
  setEventsLive(1);
  assert.equal(eventsDotOn(T1, off), true);
  markEventsSeen(T1, off);
  assert.equal(eventsDotOn(T1, off), false);
  assert.equal(seenToday(T1, off), true);
});
