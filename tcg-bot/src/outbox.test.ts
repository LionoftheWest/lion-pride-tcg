import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIVE_UP_MS, outboxDone } from './outbox.js';

const now = Date.parse('2026-10-03T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

test('a row is marked posted when the post went out', () => {
  assert.equal(outboxDone(true, ago(0), now), true);
});

test('a failed post stays unposted, so the next poll retries it', () => {
  assert.equal(outboxDone(false, ago(10_000), now), false);
  assert.equal(outboxDone(false, ago(GIVE_UP_MS - 1), now), false);
});

test('a row that keeps failing is given up after about 1 hour (no endless retry)', () => {
  assert.equal(GIVE_UP_MS, 60 * 60 * 1000);
  assert.equal(outboxDone(false, ago(GIVE_UP_MS), now), true);
  assert.equal(outboxDone(false, ago(3 * GIVE_UP_MS), now), true);
});

test('a failed row with no usable created_at is given up, not retried for ever', () => {
  assert.equal(outboxDone(false, null, now), true);
  assert.equal(outboxDone(false, 'not a date', now), true);
});
