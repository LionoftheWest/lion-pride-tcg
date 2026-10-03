import { test } from 'node:test';
import assert from 'node:assert/strict';
import { payNow } from './dailies-pay.js';

test('a streak-day check-in with 1 pack left under the cap pays 1, not 2', () => {
  assert.equal(payNow(2, 5, 4), 1);
});

test('under the cap the full reward, at or past the cap nothing', () => {
  assert.equal(payNow(2, 5, 0), 2);
  assert.equal(payNow(1, 5, 4), 1);
  assert.equal(payNow(2, 5, 5), 0);
  assert.equal(payNow(1, 5, 7), 0);
});
