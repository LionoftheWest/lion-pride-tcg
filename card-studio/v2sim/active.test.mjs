// The built active factor of the Hunt auto-pick (plan 20.10; active.mjs, factors.mjs, auto.mjs pickBase): the pick term, the pool entry, the factors
// file and its checks. Synthetic actives only (teams-test-fixture.json and hand-made blocks): no private data. SQL = the simulator, the planted faults
// and the Set 1 pools are in scripts/test-combat-v2-autopick-active.mjs (it needs the local database).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, patch, HERE } from './util.mjs';
import { makeCard, classOf } from './cards.mjs';
import { withSet1 } from './teams.mjs';
import { pickBase, poolEntry, autoPick } from './auto.mjs';
import { measureFactors, factorSummary } from './active.mjs';
import { readFactors, activeHash, factorsPathOf, FACTOR_MIN, FACTOR_MAX } from './factors.mjs';

const cfg = loadConfig();
const SYN = JSON.parse(readFileSync(join(HERE, 'teams-test-fixture.json'), 'utf8')).cards;
const x1 = (ax) => patch(cfg, { auto_v2: { pick: { active_x: ax } } });
const entry = (id, role, atk, o = {}) => ({ id, role, class: classOf(role), atk, crt: 0, crd: 2, spd: 20, blocks: [], ...o });

test('the built value: config auto_v2.pick.active_x is 1 (balance auto_v2 has the same value; the DB test compares them)', () => {
  assert.equal(cfg.auto_v2.pick.active_x, 1);
});

test('the pick term: a support with a factor x pick_factor ^ active_x; an attacker, no factor and active_x 0 give 1', () => {
  const B = { mechanics: [] };
  const s = entry(1, 'medic', 100, { pick_factor: 1.25 }), a = entry(2, 'striker', 100, { pick_factor: 1.25 }), n = entry(3, 'medic', 100);
  assert.equal(pickBase(cfg, s, B).base, 2000 * 1.25);
  assert.equal(pickBase(cfg, s, B).act, 1.25);
  assert.equal(pickBase(x1(2), s, B).act, 1.5625);
  assert.equal(pickBase(x1(0), s, B).base, 2000);
  assert.equal(pickBase(cfg, a, B).act, 1);
  assert.equal(pickBase(cfg, a, B).base, 2000);
  assert.equal(pickBase(cfg, n, B).act, 1);
  assert.equal(pickBase(cfg, entry(4, 'medic', 100, { pick_factor: null }), B).act, 1);
  // an auto with no active_x (the row of the shape PR) = active_x 0
  const noX = JSON.parse(JSON.stringify(cfg)); delete noX.auto_v2.pick.active_x;
  assert.equal(pickBase(noX, s, B).act, 1);
});

test('the pick: a high factor swaps a support in, active_x 0 gives the live squad', () => {
  const A6 = ['breaker', 'striker', 'flurry', 'finisher', 'survivor', 'cleaver'].map((r, i) => entry(i + 1, r, 100 + 10 * i));
  const S = [['warden', 200], ['medic', 190], ['controller', 180], ['spotter', 100, 1.25], ['herald', 50], ['artillery', 40]].map(([r, at, f], i) => entry(i + 7, r, at, f ? { pick_factor: f } : {}));
  assert.deepEqual(autoPick(cfg, [...A6, ...S], { mechanics: [] }, 8).ids, [6, 5, 4, 3, 7, 8, 9, 10]);
  assert.deepEqual(autoPick(x1(0), [...A6, ...S], { mechanics: [] }, 8).ids, [6, 5, 4, 3, 2, 7, 8, 9]);
});

test('the pool entry carries the factor of its active (a template with pick_factor), and none without one', () => {
  const S = { 'syn-medic-1': { ...SYN['syn-medic-1'], pick_factor: 1.1 }, 'syn-medic-2': SYN['syn-medic-2'] };
  const c1 = withSet1(cfg, S);
  const mk = (k) => poolEntry(makeCard(c1, { key: k, role: 'medic', rarity: 'normal', template: `s1.${k}` }), 1);
  assert.equal(mk('syn-medic-1').pick_factor, 1.1);
  assert.equal('pick_factor' in mk('syn-medic-2'), false);
  // a placeholder template has no factor (a card with no v2 active has none in play)
  assert.equal('pick_factor' in poolEntry(makeCard(cfg, { key: 'x', role: 'medic', rarity: 'normal' }), 1), false);
});

test('measureFactors: supports only, rounded to 3 decimals, the role mean about 1, inside the stored range', () => {
  const S = Object.fromEntries(Object.entries(SYN).map(([k, v]) => [k, { role: v.role, active: v.active, blocks: v.blocks }]));
  const F = measureFactors(cfg, { set1: S, runs: 30 });
  const keys = Object.keys(F);
  assert.ok(keys.length > 0 && keys.every((t) => t.startsWith('s1.') && classOf(S[t.slice(3)].role) === 'support'));
  assert.equal(keys.length, Object.values(S).filter((v) => classOf(v.role) === 'support').length);
  assert.ok(Object.values(F).every((f) => Math.round(f * 1000) / 1000 === f && f >= FACTOR_MIN && f <= FACTOR_MAX));
  const sum = factorSummary(cfg, F, (t) => S[t.slice(3)].role);
  for (const s of Object.values(sum)) assert.ok(Math.abs(s.mean - 1) < 0.002, JSON.stringify(s));
  // the summary holds roles and numbers only (no card key)
  assert.ok(!JSON.stringify(sum).includes('syn-'));
});

test('the factors file: accepted when it matches the batch; refused for a changed active, an attacker row, a key not in the batch, a factor out of range', () => {
  const dir = mkdtempSync(join(tmpdir(), 'factors-'));
  try {
    const rows = [{ key: 'a', role: 'medic', ability: { name: 'A', blocks: [{ k: 'heal', v: 0.2 }] } }, { key: 'b', role: 'warden', ability: { name: 'B', blocks: [{ k: 'shield', v: 0.3 }] } },
      { key: 'c', role: 'striker', ability: { name: 'C', blocks: [{ k: 'hit', x: 1.4 }] } }];
    const f = factorsPathOf(join(dir, 'batch.json')); assert.equal(f, join(dir, 'batch.factors.json'));
    const row = (k, o = {}) => { const r = rows.find((x) => x.key === k); return { key: k, role: r.role, active: activeHash(r.role, r.ability.blocks), pick_factor: 1.05, ...o }; };
    const put = (rs) => writeFileSync(f, JSON.stringify({ rows: rs }));
    put([row('a')]);
    let r = readFactors(f, rows);
    assert.deepEqual(r.errors, []); assert.deepEqual(r.factors, { a: 1.05 }); assert.equal(r.supports, 2); assert.equal(r.missing, 1);
    // the name does not change the hash; the blocks do
    assert.equal(activeHash('medic', [{ k: 'heal', v: 0.2 }]), row('a').active);
    assert.notEqual(activeHash('medic', [{ k: 'heal', v: 0.25 }]), row('a').active);
    const bad = [
      [[row('a', { active: activeHash('medic', [{ k: 'heal', v: 0.25 }]) })], /the active changed/],
      [[{ ...row('c') }], /attacker/],
      [[{ ...row('a'), key: 'zz' }], /not in the batch/],
      [[row('a', { pick_factor: 2.5 })], /from 0.5 to 2/],
      [[row('a', { pick_factor: '1.1' })], /from 0.5 to 2/],
      [[row('a'), row('a')], /twice/],
    ];
    for (const [rs, re] of bad) { put(rs); r = readFactors(f, rows); assert.ok(r.errors.length === 1 && re.test(r.errors[0]), JSON.stringify(r.errors)); }
    rmSync(f); assert.match(readFactors(f, rows).errors[0], /missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
