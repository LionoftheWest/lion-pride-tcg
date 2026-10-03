import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePoller, IDLE_MS, IDLE_EVERY_MS } from './poll.js';

const setup = () => {
  const s = { t: 0, hidden: false, runs: 0 };
  const p = makePoller({ now: () => s.t, hidden: () => s.hidden });
  p.every(30_000, () => { s.runs += 1; });
  // Advance the clock in 1 s ticks, like the page.
  s.go = (ms) => { for (let i = 0; i < ms / 1000; i += 1) { s.t += 1000; p.tick(); } };
  return { s, p };
};

test('shown and active: the job runs at its own interval', () => {
  const { s, p } = setup();
  for (let m = 0; m < 4; m += 1) { s.go(60_000); p.input(); } // a tap every minute
  assert.equal(s.runs, 8); // 4 minutes / 30 s
});

test('hidden: no refresh at all; shown again: one refresh at once', () => {
  const { s, p } = setup();
  s.hidden = true; s.go(60 * 60_000);
  assert.equal(s.runs, 0);
  s.hidden = false; p.wake(); s.go(1000);
  assert.equal(s.runs, 1);
});

test('idle after 10 minutes: at most every 5 minutes; a tap refreshes at once', () => {
  const { s, p } = setup();
  s.go(IDLE_MS); const active = s.runs; // 10 minutes at 30 s
  assert.equal(active, 20);
  s.go(60 * 60_000); // one idle hour
  assert.equal(s.runs - active, 60 * 60_000 / IDLE_EVERY_MS);
  const before = s.runs; p.input(); s.go(1000);
  assert.equal(s.runs - before, 1);
});
