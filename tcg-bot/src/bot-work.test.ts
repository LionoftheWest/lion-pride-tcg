import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBotWork, TTL_MS } from './bot-work.js';

const answer = (data: unknown, error: unknown = null) => async () => ({ data, error });

test('the timers share one answer for TTL_MS: one request, not one per timer', async () => {
  let calls = 0, t = 0;
  const work = makeBotWork(async () => { calls += 1; return { data: { fx: false, plays: true, events: false, auctions: false }, error: null }; }, () => t);
  const [a, b, c] = await Promise.all([work(), work(), work()]); // three timers at the same moment
  assert.equal(calls, 1);
  assert.deepEqual(a, { fx: false, plays: true, events: false, auctions: false });
  assert.deepEqual(b, a); assert.deepEqual(c, a);
  t = TTL_MS - 1; await work(); assert.equal(calls, 1);
  t = TTL_MS; await work(); assert.equal(calls, 2); // a new question after the TTL
});

test('a failed or odd answer means work everywhere (the timers run their own queries as before)', async () => {
  const ALL = { fx: true, plays: true, events: true, auctions: true };
  assert.deepEqual(await makeBotWork(answer(null, { message: 'down' }))(), ALL);
  assert.deepEqual(await makeBotWork(answer(null))(), ALL);
  assert.deepEqual(await makeBotWork(async () => { throw new Error('network'); })(), ALL);
  // A missing flag (an older function) is work too; only an explicit false skips.
  assert.deepEqual(await makeBotWork(answer({ fx: false }))(), { fx: false, plays: true, events: true, auctions: true });
});
