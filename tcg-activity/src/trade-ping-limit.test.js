import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePingLimiter, PING_WINDOW_MS } from './trade-ping-limit.js';

const clock = () => { const c = { t: 1_000_000 }; c.now = () => c.t; return c; };

test('the window is 10 minutes', () => {
  assert.equal(PING_WINDOW_MS, 10 * 60 * 1000);
});

test('one public ping per sender -> target pair in 10 minutes (an offer/cancel loop pings once)', () => {
  const c = clock();
  const lim = makePingLimiter({ now: c.now });
  assert.equal(lim.allow('A', 'B'), true);
  for (let i = 0; i < 20; i += 1) { c.t += 20_000; assert.equal(lim.allow('A', 'B'), false, `loop ${i}`); }
});

test('the pair pings again after 10 minutes from the last public ping', () => {
  const c = clock();
  const lim = makePingLimiter({ now: c.now });
  assert.equal(lim.allow('A', 'B'), true);
  c.t += PING_WINDOW_MS - 1; assert.equal(lim.allow('A', 'B'), false);
  c.t += 1; assert.equal(lim.allow('A', 'B'), true);
});

test('other pairs are independent (another target, the reverse direction, another sender)', () => {
  const lim = makePingLimiter({ now: clock().now });
  assert.equal(lim.allow('A', 'B'), true);
  assert.equal(lim.allow('A', 'C'), true);
  assert.equal(lim.allow('B', 'A'), true);
  assert.equal(lim.allow('C', 'B'), true);
  assert.equal(lim.allow('A', 'B'), false);
});

test('ids are compared as strings (a number id and a string id are the same member)', () => {
  const lim = makePingLimiter({ now: clock().now });
  assert.equal(lim.allow(123, '456'), true);
  assert.equal(lim.allow('123', 456), false);
});

test('the map is bounded: expired pairs go first, then the oldest pair', () => {
  const c = clock();
  const lim = makePingLimiter({ now: c.now, max: 3 });
  lim.allow('A', '1'); c.t += 1000; lim.allow('A', '2'); c.t += 1000; lim.allow('A', '3');
  assert.equal(lim.size(), 3);
  lim.allow('A', '4'); // full, nothing expired: the oldest (A>1) goes
  assert.equal(lim.size(), 3);
  assert.equal(lim.allow('A', '2'), false, 'A>2 is still limited');
  c.t += PING_WINDOW_MS + 5000; // all expired
  lim.allow('B', '1');
  assert.equal(lim.size(), 1, 'the expired pairs were dropped');
  for (let i = 0; i < 1000; i += 1) lim.allow('X', String(i));
  assert.ok(lim.size() <= 3);
});
