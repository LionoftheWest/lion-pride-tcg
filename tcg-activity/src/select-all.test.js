import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAll } from './select-all.js';

// A fake PostgREST query: it returns at most `cap` rows per call, like max-rows.
function fakeTable(rows, cap, calls) {
  return () => {
    let order = null;
    const q = {
      order(c) { order = c; return q; },
      async range(a, b) {
        calls.push([a, b, order]);
        return { data: rows.slice(a, Math.min(b + 1, a + cap)), error: null };
      },
    };
    return q;
  };
}

test('reads every row past the 1,000-row cap (3,681 card rows)', async () => {
  const rows = Array.from({ length: 3681 }, (_, i) => ({ id: i }));
  const calls = [];
  const { data, error } = await selectAll(fakeTable(rows, 1000, calls), ['id']);
  assert.equal(error, null);
  assert.equal(data.length, 3681);
  assert.deepEqual(data.map((r) => r.id), rows.map((r) => r.id), 'each row once, in order');
  assert.ok(calls.every((c) => c[2] === 'id'), 'every page is ordered');
});

test('a cap lower than the page size still reads every row', async () => {
  const rows = Array.from({ length: 1234 }, (_, i) => ({ id: i }));
  const { data } = await selectAll(fakeTable(rows, 300, []), ['id']);
  assert.equal(data.length, 1234);
});

test('an empty table and an error', async () => {
  assert.deepEqual((await selectAll(fakeTable([], 1000, []), ['id'])).data, []);
  const bad = () => { const q = { order: () => q, range: async () => ({ data: null, error: { message: 'boom' } }) }; return q; };
  assert.equal((await selectAll(bad, ['id'])).error.message, 'boom');
});
