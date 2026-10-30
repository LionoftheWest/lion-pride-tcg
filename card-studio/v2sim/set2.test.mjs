// The Set 1 + Set 2 Lab (teams.mjs loadSets / loadSet2Batch, shape.mjs poolSource, active.mjs factorsExperiment, targets.mjs setPool): one check for each part, and one
// planted fault for each part. The baseline runs first in the same process and is printed. Each fault must turn its own check red; the checks are green again
// after the faults (no leak). The synthetic checks use hand-made batches in a temp folder (no private data) and always run. The check on the PRIVATE Set 2
// batch skips with a message when the file is missing (CI has no file); it prints counts only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, loadFixture } from './util.mjs';
import { withSet1, loadSets, loadSet2Batch, SET2, hasSet1Batch, hasSet2Batch, SET1_BATCH_PATH, SET2_BATCH_PATH } from './teams.mjs';
import { poolSource, S1 } from './shape.mjs';
import { SC, LIVE, actValue, scorePickLab } from './score.mjs';
import { pickCards } from './cards.mjs';
import { factorsExperiment } from './active.mjs';
import { factorsPathOf, readFactors } from './factors.mjs';
import { setPool, targets } from './targets.mjs';

const cfg = loadConfig();
const DIR = mkdtempSync(join(tmpdir(), 'v2sim-set2-'));
const row = (key, role, name, blocks) => ({ key, role, ability: { name, blocks } });
const STRIKE = [{ k: 'hit', x: 1.3 }, { k: 'payoff_dmg', status: 'poison', v: 0.5 }, { k: 'payoff_crit', status: 'poison', v: 0.25 }];
// "Set 2": three synthetic cards of a synthetic cards.json (one is event-only: no pullable finish).
// "Set 1": the first four cards of the public fixture that have a pullable finish (their keys are read at run time, never written here).
const K = loadFixture().subjects.filter((x) => x.finishes.some((f) => f.pool)).map((x) => x.key).sort().slice(0, 4);
const R1 = [row(K[0], 'medic', 'Zq Alpha', [{ k: 'heal', v: 0.05 }]), row(K[1], 'medic', 'Zq Beta', [{ k: 'heal', v: 1.2 }]),
  row(K[2], 'striker', 'Zq Gamma', STRIKE), row(K[3], 'warden', 'Zq Delta', [{ k: 'shield_all', v: 0.133 }])];
const R2 = [row('zz-two-a', 'medic', 'Zq Epsilon', [{ k: 'heal', v: 0.05 }]), row('zz-two-b', 'striker', 'Zq Zeta', STRIKE), row('zz-two-c', 'warden', 'Zq Eta', [{ k: 'shield_all', v: 0.133 }])];
const CARDS = [{ id: 'zz-two-a', name: 'Two A', type: 'Character', set: 'S2', finishes: ['normal', 'gold'] }, { id: 'zz-two-b', name: 'Two B', type: 'Creature', set: 'S2', finishes: ['normal', 'full_art', 'gold'] },
  { id: 'zz-two-c', name: 'Two C', type: 'Moment', set: 'S2', finishes: ['event'] }, { id: 'zz-one-x', name: 'One X', type: 'Character', set: 'S1', finishes: ['normal'] }];
const P1 = join(DIR, 's1.json'), P2 = join(DIR, 's2.json'), PC = join(DIR, 'cards.json');
writeFileSync(P1, JSON.stringify({ about: 'synthetic', rows: R1 })); writeFileSync(P2, JSON.stringify({ about: 'synthetic', rows: R2 })); writeFileSync(PC, JSON.stringify(CARDS));
const ENV = { V2SIM_SET1_BATCH: P1, V2SIM_SET2_BATCH: P2, V2SIM_CARDS: PC };
const withEnv = (env, f) => { const old = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]])); Object.assign(process.env, env);
  try { return f(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } } };
const WORDS = [...R1, ...R2].flatMap((r) => [r.key, r.ability.name]).filter((w) => w.length >= 4);
const leaks = (text) => WORDS.filter((w) => text.includes(w));

writeFileSync(join(DIR, 'c2.json'), JSON.stringify(CARDS.slice(1)));
const refused = () => { try { loadSet2Batch(join(DIR, 'c2.json')); return false; } catch { return true; } };

function checks() {
  const out = []; const C = (id, what, ok, got) => out.push({ id, what, ok: !!ok, got });
  const guard = (id, f) => { try { withEnv(ENV, f); } catch (e) { C(id, '(threw)', false, e.message); } };
  // the combined pool: the cards of both sets, the Set 2 card with a pullable finish only, cp_mod 1, and the Set 1 run holds no Set 2 card
  guard('pool.both', () => {
    const both = poolSource(cfg, { set1: true, set2: true }), one = poolSource(cfg, { set1: true });
    const k2 = both.pool0.map((p) => p.key).filter((k) => k.startsWith('zz-'));
    const b = both.pool0.find((p) => p.key === 'zz-two-b');
    C('pool.both', 'the combined pool holds both sets (7 cards, 6 with a pullable finish), the event-only Set 2 card is out, the Set 2 card keeps its pullable finishes with cp_mod 1, and Set 1 alone has no Set 2 card',
      both.cards === 7 && both.pool0.length === 6 && k2.join() === 'zz-two-a,zz-two-b' && b.cp_mod === 1 && b.pullable.join() === 'normal,full_art,gold' && b.template === 's1.zz-two-b' && b.role === 'striker'
      && one.pool0.length === 4 && one.pool0.every((p) => !p.key.startsWith('zz-')) && both.s2 === true && !one.s2, JSON.stringify({ cards: both.cards, n: both.pool0.length, k2, one: one.pool0.length }));
  });
  // the factor is relative to the mean of ALL actives of its role in the combined set
  guard('fact.relative', () => {
    const S = loadSets({ set2: true }); const c = withSet1(cfg, S); const S1only = loadSets({}); const c1 = withSet1(cfg, S1only);
    const med = Object.keys(S).filter((k) => S[k].role === 'medic').map((k) => SC.activeFactor(c, `s1.${k}`, 30));
    const strong = SC.activeFactor(c, `s1.${K[1]}`, 30), strong1 = SC.activeFactor(c1, `s1.${K[1]}`, 30);
    const m = med.reduce((s, x) => s + x, 0) / med.length;
    C('fact.relative', 'the factors of a role average 1 over the combined set (3 medics), and a Set 1 factor moves when Set 2 changes the role mean',
      med.length === 3 && Math.abs(m - 1) < 1e-9 && Math.abs(strong - strong1) > 0.02, JSON.stringify({ n: med.length, m, strong, strong1 }));
  });
  // the Set 2 subject: the event finish is not pullable, the card fact cp_mod is 1
  guard('s2.subject', () => {
    const S = loadSet2Batch(); const a = S['zz-two-a'];
    C('s2.subject', 'a Set 2 card is marked set 2, its finishes are the cards.json finishes without event, and its cp_mod is 1; a Set 2 key that is not a Set 2 card of cards.json is refused',
      a.set === 2 && a.subject.cp_mod === 1 && a.subject.finishes.map((f) => f.rarity).join() === 'normal,gold' && S['zz-two-c'].subject.finishes.length === 0
      && refused(), JSON.stringify(a.subject));
  });
  // the factors file: both sets, beside the Set 2 batch, and the report holds no card key or active name
  guard('fact.file', () => {
    const r = factorsExperiment(cfg, { set1: true, set2: true, runs: 10 }); const file = factorsPathOf(P2);
    const R = readFactors(file, [...R1, ...R2]); const text = r.md + r.head.join('\n') + JSON.stringify(r.data);
    C('fact.file', 'the factors file is beside the Set 2 batch, holds the supports of both sets (3 supports of Set 1 and 2 of Set 2), passes its check, and none is written beside the Set 1 batch',
      existsSync(file) && R.errors.length === 0 && Object.keys(R.factors).length === 5 && !existsSync(factorsPathOf(P1)) && r.data.roles.medic.n1 === 2 && r.data.roles.medic.n2 === 1, JSON.stringify({ n: Object.keys(R.factors).length, errors: R.errors.length }));
    const hits = leaks(text);
    C('out.private', 'the factors report holds roles, counts and ratios only: no card key and no active name of either batch', hits.length === 0 && /medic/.test(r.md), `${hits.length} private strings`);
  });
  // the scan itself sees a leak
  C('out.scan', 'the private-string scan finds a key and an active name', leaks('x zz-two-a y').length === 1 && leaks('Zq Zeta').length === 1 && leaks('nothing here').length === 0, '');
  // the targets pool: the real active of each batch card (template s1.<key>), the batch role; a Set 2 card is drawn with its own active
  guard('pool.targets', () => {
    const S = loadSets({ set2: true }); const c = withSet1(cfg, S); const P = setPool(c, S);
    const two = P.filter((p) => p.key.startsWith('zz-')); const batch = P.filter((p) => S[p.key]); const other = P.filter((p) => !S[p.key]);
    const picked = pickCards(c, two, ['striker'], 'gold', () => 0, {}).concat(pickCards(c, two, ['striker'], 'gold', () => 0, { templates: { striker: 'striker.lockon' } }));
    C('pool.targets', 'the targets pool holds the Set 2 cards with their own active, each batch card keeps its own template, the others keep a placeholder template, and a drawn card carries it',
      two.length === 3 && batch.every((p) => p.template === `s1.${p.key}`) && other.length > 100 && other.every((p) => p.template && !p.template.startsWith('s1.')) && picked.every((p) => p.template.startsWith('s1.')),
      JSON.stringify({ two: two.length, batch: batch.length, other: other.length, picked: picked.map((p) => p.template.startsWith('s1.')) }));
  });
  return out;
}
const failing = () => checks().filter((x) => !x.ok).map((x) => x.id);

test('Set 1 + Set 2 Lab baseline: every check is green', () => {
  const r = checks(); console.log(`  baseline: ${r.length} checks, failing: ${r.filter((x) => !x.ok).map((x) => x.id).join(' ') || 'none'}`);
  for (const c of r) assert.ok(c.ok, `${c.id}: ${c.what}: got ${c.got}`);
});

const swapIn = (obj, key, make) => { const o = obj[key]; return [() => { obj[key] = make(o); }, () => { obj[key] = o; }]; };
const FAULTS = [
  ['pool.both', 'the pool draw list drops the Set 2 cards', swapIn(S1, 'pool0', (o) => (c, s) => o(c, s).filter((p) => !p.key.startsWith('zz-')))],
  ['pool.both', 'an event-only finish is pullable', swapIn(SET2, 'subject', () => (c) => ({ name: c.name, type: c.type, cp_mod: 1, finishes: c.finishes.map((f) => ({ rarity: f, pool: true })) }))],
  ['s2.subject', 'the Set 2 cp_mod is 0.9', swapIn(SET2, 'subject', (o) => (c) => ({ ...o(c), cp_mod: 0.9 }))],
  ['fact.relative', 'the factor is not divided by the role mean', swapIn(SC, 'activeFactor', (o) => (c, t, n, s) => o(c, t, n, s) * 1.25)],
];
for (const [id, name, [apply, undo]] of FAULTS) {
  test(`planted fault is caught: ${name}`, () => {
    apply(); let f; try { f = failing(); } finally { undo(); }
    console.log(`  ${name}: ${f.length} checks fail (${f.join(', ')})`);
    assert.ok(f.includes(id), `the check ${id} did not fail for the planted fault "${name}" (failing: ${f.join(', ') || 'none'})`);
  });
}
test('the checks are green again after the faults (no leak)', () => assert.deepEqual(failing(), []));

test('targets with the Set 1 + Set 2 pool runs and names no card (synthetic batches)', () => withEnv(ENV, () => {
  const r = targets(cfg, { runs: 2, seed: 1, set1: true, set2: true });
  const hits = leaks(r.md + JSON.stringify(r.data));
  console.log(`  targets: ${r.rows.length} rows, ${r.head[r.head.length - 1]}; private strings: ${hits.length}`);
  assert.ok(r.rows.length >= 20 && /Set 1 \+ Set 2/.test(r.md)); assert.equal(hits.length, 0);
}));

// The PRIVATE Set 2 batch: counts only. Skips when a file is missing (CI).
const skip = hasSet1Batch() && hasSet2Batch() ? false : `a private batch is missing (${SET1_BATCH_PATH()}, ${SET2_BATCH_PATH()}); set V2SIM_SET1_BATCH and V2SIM_SET2_BATCH to run this test`;
test('the private Set 2 batch: every row is a Set 2 card of cards.json, the score Lab runs on both sets, and its output holds no card key or active name (counts only)', { skip }, () => {
  const S = loadSets({ set2: true }); const n2 = Object.values(S).filter((a) => a.set === 2).length;
  const L = scorePickLab(cfg, { set1: true, set2: true, seed: 7, pools: 1, searchDays: 1, evalDays: 2, bosses: ['camper_colossus'], cache: false, candidates: { [LIVE]: {}, 'offense + active x1 (supports)': { value: actValue(1) } } });
  const text = JSON.stringify(L.data) + L.md; const words = new Set(); for (const [k, a] of Object.entries(S)) { words.add(k); if (a.active) words.add(a.active); }
  const hits = [...words].filter((w) => w.length >= 4 && text.includes(w));
  console.log(`  batch: ${Object.keys(S).length} cards (${n2} Set 2), ${L.data.rows.length} pool; private strings in the output: ${hits.length}`);
  assert.ok(n2 > 0); assert.equal(L.data.mode, 'set1-s2'); assert.equal(hits.length, 0, 'the output holds a private card string');
});
test.after(() => rmSync(DIR, { recursive: true, force: true }));
