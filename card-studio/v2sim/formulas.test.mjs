// node --test card-studio/v2sim/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './util.mjs';
import { formulaChecks } from './checks.mjs';
import { allocate, makeCard, cardPool, templateFor, ROLES } from './cards.mjs';

const cfg = loadConfig();
for (const c of formulaChecks(cfg)) test(`formula ${c.id}: ${c.what}`, () => assert.ok(c.ok, `expect ${c.expect}, got ${c.got}`));

test('allocate keeps the total and the 10-point cap', () => {
  const p = allocate(cfg, { atk: 5, crt: 1 }, 30);
  assert.equal(Object.values(p).reduce((s, x) => s + x, 0), 20, 'only 2 stats with weight: 2 x 10');
  assert.ok(Object.values(p).every(x => x <= cfg.v2_stats.max_per_stat));
  const q = allocate(cfg, cfg.v2_builds.striker, 17); assert.equal(Object.values(q).reduce((s, x) => s + x, 0), 17);
});
test('makeCard refuses more points than the level gives', () => {
  assert.throws(() => makeCard(cfg, { role: 'striker', rarity: 'normal', level: 2, points: { atk: 3 } }));
});
test('every live subject has a role and a deterministic placeholder active', () => {
  const pool = cardPool(cfg);
  assert.equal(pool.length, 133);
  for (const p of pool) { assert.ok(ROLES.includes(p.role), p.key); assert.equal(templateFor(cfg, p.key, p.role), templateFor(cfg, p.key, p.role)); }
  const roles = new Set(pool.map(p => p.role)); assert.equal(roles.size, 12, 'all 12 roles have live cards');
});
test('support amounts scale with rarity (F) and enablers get +1 stack at Gold', () => {
  const n = makeCard(cfg, { key: 'a', role: 'controller', rarity: 'normal', template: 'controller.envenom' });
  const g = makeCard(cfg, { key: 'a', role: 'controller', rarity: 'gold', template: 'controller.envenom' });
  assert.ok(g.power > n.power);
  assert.equal(g.active.blocks[0].stacks, n.active.blocks[0].stacks + 1);
});
