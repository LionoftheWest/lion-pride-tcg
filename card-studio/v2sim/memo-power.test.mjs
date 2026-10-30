// The memo key of the pick Lab of the Power PR (power.mjs powerPickLab): the key keeps the slot order of the picked squad (2026-10-23, plan 20.10 open item 3).
// The slot order changes the fight (each unit draws from hash(seed, slot)), so two variants that pick the same cards in two orders are two squads. The
// baseline runs first in the same process and is printed; the planted fault (the old sorted key) must turn the check red; the check is green again after it.
// Synthetic: the template pools, 1 pool of 8 cards, a few days (no private data).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, squadKey } from './util.mjs';
import { powerPickLab } from './power.mjs';

const cfg = loadConfig();
// A variant that sets the pick value of the attackers only, from the card key: "up" and "down" order the same 8 cards in two slot orders (the pool holds 8 cards, all picked).
const hk = (c) => [...c.key].reduce((s, ch) => s + ch.charCodeAt(0) * 7, 0) % 97;
const att = (f) => (cf, c) => (c.cls === 'attacker' ? 1000 * f(c) : undefined);
const UP = att((c) => 1 + 0.01 * hk(c)), DOWN = att((c) => 1 - 0.01 * hk(c));
const O = { seed: 1, pools: 1, poolSize: 8, searchDays: 1, evalDays: 3, bosses: ['camper_colossus'] };

function checks() {
  const full = powerPickLab(cfg, { ...O, variants: { up: UP, down: DOWN } }).data; const alone = powerPickLab(cfg, { ...O, variants: { down: DOWN } }).data;
  const roles = (v) => full.detail.camper_colossus[0][v];
  const ok = roles('up').join() !== roles('down').join() && [...roles('up')].sort().join() === [...roles('down')].sort().join()   // same cards, another slot order
    && full.all.up[0] !== full.all.down[0] && full.all.down[0] === alone.all.down[0];
  return [{ id: 'memo.order', ok, got: JSON.stringify({ full: full.all, alone: alone.all }) }];
}
const failing = () => checks().filter((x) => !x.ok).map((x) => x.id);

test('Power pick Lab memo baseline: the check is green', () => {
  const r = checks(); console.log(`  baseline: ${r.length} checks, failing: ${r.filter((x) => !x.ok).map((x) => x.id).join(' ') || 'none'}`);
  for (const c of r) assert.ok(c.ok, `${c.id}: got ${c.got}`);
});
test('planted fault is caught: the memo key is the sorted member list (the old key: a second order reuses the first value)', () => {
  const o = squadKey.of; squadKey.of = (ids) => [...ids].sort((a, b) => a - b).join(); let f; try { f = failing(); } finally { squadKey.of = o; }
  console.log(`  old sorted key: ${f.length} checks fail (${f.join(', ')})`);
  assert.ok(f.includes('memo.order'), 'the check memo.order did not fail for the old sorted key');
});
test('the check is green again after the fault (no leak)', () => assert.deepEqual(failing(), []));
