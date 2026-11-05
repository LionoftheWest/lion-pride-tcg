// PACK-SET-B GB.1: the server rule for the set of a pack open (INV-B1, INV-B2). node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenSet } from './open-set.js';

test('a request set goes to the bot as today, with any number of pullable sets', () => {
  assert.deepEqual(resolveOpenSet('S2', ['S1']), { set: 'S2' });
  assert.deepEqual(resolveOpenSet('S1', null), { set: 'S1' }, 'no read is needed when the request names a set');
});
test('INV-B1: a request set with 2 pullable sets is that set, never the first set', () => {
  assert.deepEqual(resolveOpenSet('S2', ['S1', 'S2']), { set: 'S2' });
});
test('INV-B2: no set and exactly 1 pullable set: that set by name', () => {
  assert.deepEqual(resolveOpenSet(undefined, ['S1']), { set: 'S1' });
});
test('INV-B1: no set and 2 pullable sets: 400 set_required (no bot call, no pack spent)', () => {
  assert.deepEqual(resolveOpenSet(undefined, ['S1', 'S2']), { status: 400, error: 'set_required' });
});
test('INV-B1: no set and 3 pullable sets: 400 set_required', () => {
  assert.deepEqual(resolveOpenSet(undefined, ['S1', 'S2', 'S3']), { status: 400, error: 'set_required' });
});
test('no set and a read error: 503 sets_unavailable (no bot call)', () => {
  assert.deepEqual(resolveOpenSet(undefined, null), { status: 503, error: 'sets_unavailable' });
});
