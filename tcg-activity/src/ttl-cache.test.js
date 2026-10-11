import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTtlCache } from './ttl-cache.js';

const mk = (o = {}) => { const s = { t: 0, calls: 0 }; const c = makeTtlCache({ ttl: 1000, now: () => s.t, ...o }); s.c = c; s.load = async () => { s.calls += 1; return s.calls; }; return s; };

test('a value is reused until its ttl, then loaded again', async () => {
  const s = mk();
  assert.equal(await s.c.get('a', s.load), 1);
  s.t = 999; assert.equal(await s.c.get('a', s.load), 1);
  s.t = 1000; assert.equal(await s.c.get('a', s.load), 2);
});
test('keys are separate (one member never reads the answer of another)', async () => {
  const s = mk();
  await s.c.get('a', async () => 'A');
  assert.equal(await s.c.get('b', async () => 'B'), 'B');
  assert.equal(await s.c.get('a', async () => 'x'), 'A');
});
test('single flight: 20 parallel readers cause one load', async () => {
  const s = mk();
  const r = await Promise.all(Array.from({ length: 20 }, () => s.c.get('a', s.load)));
  assert.equal(s.calls, 1); assert.ok(r.every((x) => x === 1));
});
test('bust drops the key at once', async () => {
  const s = mk();
  await s.c.get('a', s.load); s.c.bust('a');
  assert.equal(await s.c.get('a', s.load), 2);
});
test('a failed load is not kept and the next read tries again', async () => {
  const s = mk();
  await assert.rejects(s.c.get('a', async () => { throw new Error('x'); }));
  assert.equal(await s.c.get('a', s.load), 1);
});
test('valid() ends a value before its ttl', async () => {
  const s = mk({ valid: (v) => v < 2 });
  assert.equal(await s.c.get('a', s.load), 1);
  assert.equal(await s.c.get('a', s.load), 1);
  s.c.clear(); s.calls = 1;
  assert.equal(await s.c.get('a', s.load), 2);
  assert.equal(await s.c.get('a', s.load), 3, 'value 2 is not valid: load again');
});
test('stale-while-revalidate: an expired value is served at once, the refresh runs behind', async () => {
  const s = mk({ stale: true });
  assert.equal(await s.c.get('a', s.load), 1);
  s.t = 5000;
  assert.equal(await s.c.get('a', s.load), 1, 'the old value, no wait');
  await new Promise((r) => setImmediate(r));
  assert.equal(await s.c.get('a', s.load), 2, 'the refresh landed');
});
test('stale-while-revalidate: a failed refresh keeps the old value', async () => {
  const s = mk({ stale: true });
  await s.c.get('a', s.load); s.t = 5000;
  assert.equal(await s.c.get('a', async () => { throw new Error('x'); }), 1);
  await new Promise((r) => setImmediate(r));
  assert.equal(await s.c.get('a', async () => 'z'), 1);
});
