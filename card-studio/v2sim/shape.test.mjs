// The Set 1 mode of the pick shape Lab (shape.mjs S1, poolSource, referencePools; plan 20.8): one check for each part of the Set 1 pool, and one
// planted fault for each part. The baseline runs first in the same process and is printed. Each fault must turn its own check red; the checks are
// green again after the faults (no leak). The synthetic checks use hand-made actives (no private data) and always run. The checks on the PRIVATE
// Set 1 batch skip with a message when the file is missing (CI has no file); they print counts only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, loadFixture, HERE } from './util.mjs';
import { ROLES, roleOf, cardPool } from './cards.mjs';
import { withSet1, set1FromRows, hasSet1Batch, loadSet1Batch, SET1_BATCH_PATH } from './teams.mjs';
import { S1, poolSource, referencePools, shapePickLab } from './shape.mjs';

const cfg = loadConfig();
const SYN = JSON.parse(readFileSync(join(HERE, 'teams-test-fixture.json'), 'utf8')).cards;
const FX = loadFixture().subjects;
// A live subject (public fixture data) with a hand-made active of a role that differs from its placeholder role.
const live = FX.find((s) => s.finishes.some((f) => f.pool) && roleOf(cfg, s) !== 'medic');
const liveNo = FX.find((s) => !s.finishes.some((f) => f.pool));
const HAND = {
  ...SYN,
  [live.key]: { role: 'medic', active: 'Hand heal', blocks: [{ k: 'heal', v: 0.3 }] },
  'hand-nopool': { role: 'striker', active: 'Hand hit', blocks: [{ k: 'hit', x: 1.5 }], subject: { name: 'Hand no pool', type: 'Synthetic', cp_mod: 1, finishes: [{ rarity: 'normal', pool: false }] } },
  'hand-cp': { role: 'striker', active: 'Hand hit', blocks: [{ k: 'hit', x: 1.5 }], subject: { name: 'Hand cp', type: 'Synthetic', cp_mod: 1.3, finishes: [{ rarity: 'gold', pool: true }] } },
  ...(liveNo ? { [liveNo.key]: { role: 'striker', active: 'Hand hit', blocks: [{ k: 'hit', x: 1.5 }] } } : {}),
};

function checks() {
  const out = []; const C = (id, what, ok, got) => out.push({ id, what, ok: !!ok, got });
  // a check that throws is a failing check (a planted fault may crash a part)
  const guard = (id, f) => { try { f(); } catch (e) { C(id, '(threw)', false, e.message); } };
  let c1, P, by;
  guard('pool.rule', () => { c1 = withSet1(cfg, HAND); P = S1.pool0(c1, HAND); by = new Map(P.map((s) => [s.key, s])); });
  // the draw list: each Set 1 card with a pullable finish, no other card
  guard('pool.rule', () => { const want = Object.keys(HAND).filter((k) => k !== 'hand-nopool' && k !== liveNo?.key).sort();
    C('pool.rule', 'the draw list = the Set 1 cards with a pullable finish (a card with no pullable finish is out; no placeholder card is in)',
      JSON.stringify(P.map((s) => s.key)) === JSON.stringify(want) && P.every((s) => s.pullable.length && s.template === `s1.${s.key}`), JSON.stringify({ got: P.length, want: want.length })); });
  // the role and the finishes of a live subject: the Set 1 role, the live pullable finishes and cp_mod
  guard('pool.role', () => { const s = by.get(live.key);
    C('pool.role', 'a live subject takes its Set 1 role (not the placeholder role) and its live pullable finishes and cp_mod',
      s && s.role === 'medic' && s.cp_mod === live.cp_mod && JSON.stringify(s.pullable) === JSON.stringify(live.finishes.filter((f) => f.pool).map((f) => f.rarity)), JSON.stringify(s)); });
  // the card: its own active, the cp_mod of its subject
  guard('pool.card', () => { const iv = cfg.v2_investment.casual; const s = by.get('hand-cp');
    const a = S1.card(c1, s, 'gold', iv); const b = S1.card(c1, { ...s, cp_mod: 1 }, 'gold', iv);
    const t = S1.card(cfg, { key: live.key, role: roleOf(cfg, live), cp_mod: live.cp_mod }, 'normal', iv);
    C('pool.card', 'a Set 1 pool card plays its own active (s1.<key>, its blocks) at the cp_mod of its subject; a template entry draws a placeholder',
      a.active.id === 's1.hand-cp' && JSON.stringify(a.active.blocks) === JSON.stringify(HAND['hand-cp'].blocks) && a.cpBase > b.cpBase * 1.2 && !t.active.id.startsWith('s1.'),
      JSON.stringify({ id: a.active.id, cp: [a.cpBase, b.cpBase], t: t.active.id })); });
  // the batch rows
  guard('batch.rows', () => { let dup = null; try { set1FromRows([{ key: 'a', role: 'medic', ability: { name: 'x', blocks: [] } }, { key: 'a', role: 'medic', ability: { name: 'y', blocks: [] } }]); } catch (e) { dup = e.message; }
    const m = set1FromRows([{ key: 'a', role: 'medic', ability: { name: 'x', blocks: [{ k: 'heal', v: 0.3 }] } }]);
    C('batch.rows', 'a batch row becomes {role, active, blocks}; a key twice is refused', m.a.role === 'medic' && m.a.active === 'x' && m.a.blocks[0].k === 'heal' && /twice/.test(dup || ''), JSON.stringify({ m, dup })); });
  // end to end: the pools of the Set 1 mode hold only Set 1 cards with their own actives; the same seed gives the same pools; the template mode does not
  guard('e2e.pools', () => { const src = poolSource(cfg, { set1: HAND }); const o = { seed: 7, pools: 1, poolSize: 20, searchDays: 2, evalDays: 3, bosses: ['camper_colossus'] };
    const R = referencePools(cfg, { ...o, src }); const R2 = referencePools(cfg, { ...o, src: poolSource(cfg, { set1: HAND }) });
    const T = referencePools(cfg, { ...o });
    const ids = (r) => r.pool.map((c) => c.card.active.id).join();
    const keys = new Set(R[0].pool.map((c) => c.card.key));
    C('e2e.pools', 'Set 1 pools: 20 different Set 1 cards, each with its own active s1.<key>; the same seed gives the same pools; the template pools hold no s1 active',
      src.mode === 'set1' && R[0].pool.length === 20 && keys.size === 20 && R[0].pool.every((c) => HAND[c.card.key] && c.card.active.id === `s1.${c.card.key}` && c.role === HAND[c.card.key].role)
        && ids(R[0]) === ids(R2[0]) && T[0].pool.every((c) => !c.card.active.id.startsWith('s1.')), JSON.stringify({ n: R[0].pool.length, keys: keys.size, tmpl: T[0].pool.length })); });
  guard('e2e.small', () => { let err = null; try { referencePools(cfg, { seed: 1, pools: 1, poolSize: 20, bosses: ['maw'], src: { cfg, pool0: cardPool(cfg).slice(0, 5) } }); } catch (e) { err = e.message; }
    C('e2e.small', 'a draw list smaller than the pool size is refused (no endless draw)', /fewer than the pool size/.test(err || ''), err); });
  return out;
}
const failing = () => checks().filter((x) => !x.ok).map((x) => x.id);

test('Set 1 pick pools baseline: every check is green', () => {
  const r = checks(); console.log(`  baseline: ${r.length} checks, failing: ${r.filter((x) => !x.ok).map((x) => x.id).join(' ') || 'none'}`);
  for (const c of r) assert.ok(c.ok, `${c.id}: ${c.what}: got ${c.got}`);
});

const swap = (key, make) => { const o = S1[key]; return [() => { S1[key] = make(o); }, () => { S1[key] = o; }]; };
const FAULTS = [
  ['pool.role', 'the draw list takes the placeholder role of the live subject', swap('pool0', (o) => (c1, set1) => o(c1, set1).map((s) => { const f = FX.find((x) => x.key === s.key); return f ? { ...s, role: roleOf(cfg, f) } : s; }))],
  ['pool.rule', 'the draw list ignores the pullable rule', swap('pool0', (o) => (c1, set1) => [...o(c1, set1), { key: 'hand-nopool', role: 'striker', cp_mod: 1, pullable: ['normal'], template: 's1.hand-nopool' }].sort((a, b) => (a.key < b.key ? -1 : 1)))],
  ['pool.card', 'the pool card drops its own active (a placeholder plays)', swap('card', (o) => (c, s, rar, iv) => o(c, { ...s, template: undefined }, rar, iv))],
  ['pool.card', 'the pool card ignores the cp_mod of its subject', swap('card', (o) => (c, s, rar, iv) => o(c, { ...s, cp_mod: 1 }, rar, iv))],
  ['e2e.pools', 'the pools are drawn from the template list in the Set 1 mode', swap('pool0', () => (c1) => cardPool(c1).filter((p) => p.pullable.length))],
];
for (const [id, name, [apply, undo]] of FAULTS) {
  test(`planted fault is caught: ${name}`, () => {
    apply(); let f; try { f = failing(); } finally { undo(); }
    console.log(`  ${name}: ${f.length} checks fail (${f.join(', ')})`);
    assert.ok(f.includes(id), `the check ${id} did not fail for the planted fault "${name}" (failing: ${f.join(', ') || 'none'})`);
  });
}
test('the checks are green again after the faults (no leak)', () => assert.deepEqual(failing(), []));

// The PRIVATE Set 1 batch: counts only. Skips when the file is missing (CI).
const skip = hasSet1Batch() ? false : `the private Set 1 batch is missing (${SET1_BATCH_PATH()}); set V2SIM_SET1_BATCH to run this test`;
test('the private Set 1 batch: the Set 1 pools hold only Set 1 cards with their own actives (counts only)', { skip }, () => {
  const S = loadSet1Batch(); const src = poolSource(cfg, { set1: S });
  const R = referencePools(cfg, { seed: 7, pools: 1, poolSize: 20, searchDays: 1, evalDays: 1, bosses: ['camper_colossus', 'maw'], src });
  const okPools = R.every((r) => r.pool.length === 20 && new Set(r.pool.map((c) => c.card.key)).size === 20 && r.pool.every((c) => S[c.card.key] && c.card.active.id === `s1.${c.card.key}` && c.role === S[c.card.key].role));
  const roles = {}; for (const s of src.pool0) roles[s.role] = (roles[s.role] || 0) + 1;
  console.log(`  batch: ${Object.keys(S).length} cards, ${src.pool0.length} in the draw list, roles ${ROLES.map((r) => `${r} ${roles[r] || 0}`).join(', ')}`);
  assert.ok(Object.keys(S).length > 0 && src.pool0.length >= 20 && src.pool0.every((s) => ROLES.includes(s.role)) && okPools, 'the Set 1 pools are not the Set 1 cards with their own actives');
  const L = shapePickLab(cfg, { set1: S, seed: 7, pools: 1, searchDays: 1, evalDays: 2, bosses: ['maw'], candidates: { 'E8': { supports: 4, max_same_support: 1 }, '3 to 5 by score (built)': { supports: 3, supports_max: 5, max_same_support: 1 } }, shapeSearch: false });
  assert.equal(L.data.mode, 'set1'); assert.equal(L.data.base, '3 to 5 by score (built)');
});
