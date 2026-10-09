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

import { dailyExtras } from './dailies-pay.js';
const DAILY = { cap: 5, chat: 1, chat_bonus: 2, streak_cycle: 7 };
const view = (chat) => ({ enabled: true, cap: 5, tasks: [{ task: 'checkin', streak: 3 }, { task: 'chat', auto: true, ...chat }] });

test('dailyExtras: the streak week and the next chat reward come from balance daily (UI-36)', () => {
  const v = dailyExtras(view({ packs: 0, max: 3 }), DAILY);
  assert.equal(v.streak_cycle, 7);
  assert.equal(v.tasks[1].next, 1);                                         // no chat pack yet: daily.chat
  assert.equal(dailyExtras(view({ packs: 1, max: 3 }), DAILY).tasks[1].next, 2);   // the first paid: daily.chat_bonus
  assert.equal(dailyExtras(view({ packs: 3, max: 3 }), DAILY).tasks[1].next, 0);   // both paid
  assert.equal(dailyExtras(view({ packs: 0, max: 3 }), { ...DAILY, streak_cycle: 5 }).streak_cycle, 5);
  assert.deepEqual(v.tasks[0], { task: 'checkin', streak: 3 });             // other tasks unchanged
});

test('dailyExtras: an off view or no balance row is returned unchanged', () => {
  const off = { enabled: false };
  assert.equal(dailyExtras(off, DAILY), off);
  const v = view({ packs: 0, max: 3 });
  assert.equal(dailyExtras(v, null), v);
  assert.equal(dailyExtras(null, DAILY), null);
  assert.equal('streak_cycle' in dailyExtras(v, { chat: 1, chat_bonus: 1 }), false);
});
