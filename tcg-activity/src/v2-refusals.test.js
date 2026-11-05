// ON-UI (ON SPEC 3.5, G-UI): the v1 routes answer 409 with a message for v2_on, v2_today, v1_today. node --test src/v2-refusals.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { V2_REFUSAL, sendV2Refusal } from './v2-refusals.js';

const res = () => { const o = { s: 200, b: null, status(c) { o.s = c; return o; }, json(b) { o.b = b; return o; } }; return o; };
test('v2_on, v2_today, v1_today: 409 with the message, every key kept', () => {
  for (const code of ['v2_on', 'v2_today', 'v1_today']) {
    const r = res();
    assert.equal(sendV2Refusal(r, { ok: false, error: code, hunt: 5 }), true);
    assert.equal(r.s, 409); assert.equal(r.b.message, V2_REFUSAL[code]); assert.equal(r.b.hunt, 5);
  }
});
test('another refusal or an ok answer: not sent', () => {
  const r = res();
  assert.equal(sendV2Refusal(r, { ok: false, error: 'already' }), false);
  assert.equal(sendV2Refusal(r, { ok: true }), false);
  assert.equal(r.b, null);
});
