import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMEOUT_MS, TEXT, initialState, next, view, readHint, writeHint, createLoader } from './loader.js';

test('the texts are the approved strings (10.6, 11.3)', () => {
  assert.equal(TEXT.error, 'Something went wrong. Try again.');
  assert.equal(TEXT.timeout, 'This took too long. Try again.');
  assert.equal(TEXT.connecting, 'Connecting to Discord…');
  assert.equal(TIMEOUT_MS, 15000);
});

test('loading shows the bar and no retry; the phase picks the text', () => {
  assert.deepEqual(view(initialState()), { state: 'loading', text: TEXT.connecting, bar: true, retry: false });
  assert.equal(view(next(initialState(), { type: 'phase', phase: 'shuffling' })).text, TEXT.shuffling);
});

test('timeout keeps the bar and adds retry; a phase message does not replace the timeout text', () => {
  const t = next(initialState(), { type: 'timeout' });
  assert.deepEqual(view(t), { state: 'timeout', text: TEXT.timeout, bar: true, retry: true });
  assert.equal(view(next(t, { type: 'phase', phase: 'shuffling' })).text, TEXT.timeout);
});

test('error stops the bar, shows retry, never shows raw text; a late timeout does not replace it', () => {
  const e = next(initialState(), { type: 'fail' });
  assert.deepEqual(view(e), { state: 'error', text: TEXT.error, bar: false, retry: true });
  assert.equal(next(e, { type: 'timeout' }), e);
  assert.equal(view(next(next(initialState(), { type: 'timeout' }), { type: 'fail' })).state, 'error');
});

test('done stays done', () => {
  const d = next(initialState(), { type: 'done' });
  assert.equal(next(d, { type: 'fail' }), d);
  assert.equal(next(d, { type: 'timeout' }), d);
});

test('the hint: only "1" is v3; a blocked store is no hint', () => {
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
  const s = mem();
  assert.equal(readHint(s), false);
  writeHint(s, true); assert.equal(readHint(s), true);
  writeHint(s, false); assert.equal(readHint(s), false);
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readHint(bad), false);
  assert.doesNotThrow(() => writeHint(bad, true));
  assert.equal(readHint(null), false);
});

test('the controller fires the timeout at 15 s, and stops the timer on done and on fail', () => {
  let fire = null; let cleared = 0; const seen = [];
  const mk = () => createLoader({ paint: (v) => seen.push(v.state), setTimer: (fn, ms) => { assert.equal(ms, TIMEOUT_MS); fire = fn; return 1; }, clearTimer: () => { cleared++; } });
  let l = mk(); fire(); assert.equal(l.state().kind, 'timeout'); assert.deepEqual(seen, ['loading', 'timeout']);
  l = mk(); l.send({ type: 'done' }); assert.equal(cleared, 1); fire(); assert.equal(l.state().kind, 'done');
  l = mk(); l.send({ type: 'fail' }); assert.equal(cleared, 2); fire(); assert.equal(l.state().kind, 'error');
});
