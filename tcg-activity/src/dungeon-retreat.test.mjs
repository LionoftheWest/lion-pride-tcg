// Dungeon Retreat (fix/dungeon-retreat): the client must (1) show that the request runs, (2) refresh the top bar Shards pill
// when a run ends and pays. The view needs a browser, so this reads the source of the two functions; the live behavior is
// checked in the browser (see the PR). It fails if refreshShards or the busy guard is removed from retreat(), or from act().
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./ui-v2-dungeon.js', import.meta.url), 'utf8');
const body = (re) => { const i = src.search(re); assert.ok(i >= 0, `${re} not found`); return src.slice(i, i + 2200); };

test('retreat: busy guard, busy feedback, Shards pill refresh on success', () => {
  const f = body(/async function retreat\(\)/);
  assert.match(f, /if \(dg\.busy\) return;/);
  assert.match(f, /aria-busy/);
  assert.match(f, /refreshShards\(\)/);
  assert.ok(f.indexOf('refreshShards()') > f.indexOf('if (!r?.ok)'), 'refresh only after a successful retreat');
});

test('act: a run that ends (cleared, fell) refreshes the Shards pill', () => {
  assert.match(src, /if \(r\.status === 'over'\) refreshShards\(\);/);
  assert.match(src, /import \{ COIN, refreshShards \} from '\.\/ui-v2-shop\.js';/);
});
