// The per-card score Lab of the Hunt auto-pick (score.mjs SC; plan 20.9): one check for each part, and one planted fault for each part. The baseline
// runs first in the same process and is printed. Each fault must turn its own check red; the checks are green again after the faults (no leak). The
// synthetic checks use hand-made actives (no private data) and always run. The check on the PRIVATE Set 1 batch skips with a message when the file is
// missing (CI has no file); it prints counts only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, HERE } from './util.mjs';
import { makeCard } from './cards.mjs';
import { withSet1, hasSet1Batch, loadSet1Batch, SET1_BATCH_PATH } from './teams.mjs';
import { poolEntry, pickBase, pickBoss } from './auto.mjs';
import { powerOf, powerInput } from './power.mjs';
import { SC, LIVE, actValue, scorePickLab } from './score.mjs';

const cfg = loadConfig();
const SYN = JSON.parse(readFileSync(join(HERE, 'teams-test-fixture.json'), 'utf8')).cards;
const sub = (name) => ({ name, type: 'Synthetic', cp_mod: 1, finishes: [{ rarity: 'normal', pool: true }] });
const HAND = { ...SYN,
  'hand-medic-weak': { role: 'medic', active: 'Hand small heal', blocks: [{ k: 'heal', v: 0.05 }], subject: sub('Hand medic weak') },
  'hand-medic-strong': { role: 'medic', active: 'Hand big heal', blocks: [{ k: 'heal', v: 1.2 }], subject: sub('Hand medic strong') } };
const c1 = withSet1(cfg, HAND);
const IV = cfg.v2_investment.casual;
const card = (key) => makeCard(c1, { key, role: HAND[key].role, rarity: 'normal', cp_mod: 1, template: `s1.${key}`, ...IV });
const POOL = ['syn-striker-1', 'syn-striker-2', 'syn-flurry-1', 'syn-breaker-1', 'syn-medic-1', 'syn-medic-2', 'syn-warden-1', 'syn-spotter-1', 'syn-herald-1', 'syn-controller-1', 'syn-cleaver-1', 'syn-artillery-2']
  .map((k, i) => poolEntry(card(k), i + 1));
const BOSS = pickBoss(c1, 'camper_colossus', 'Heroic');   // Weak to Controller
const PAIR_KEYS = ['cross', 'kind', 'missed', 'picked', 'lr', 'wrong', 'actMissed', 'actPicked', 'weakMissed', 'weakPicked'];

function checks() {
  const out = []; const C = (id, what, ok, got) => out.push({ id, what, ok: !!ok, got });
  const guard = (id, f) => { try { f(); } catch (e) { C(id, '(threw)', false, e.message); } };
  // the active value share = the E9 support offense term of the active, / (atk x crit factor x speed); a heal-only support has 0
  guard('act.share', () => {
    const a = card('syn-artillery-2'); const x = powerInput(c1, a); const p = powerOf(c1, a); const P = c1.v2_power;
    const rest = (c1.v2_support.basic_x * x.atk * p.hit + P.support_abl_ref * x.f * x.abl) * p.cx * x.spd;
    const want = (p.offense - rest) / (x.atk * p.cx * x.spd); const got = SC.actShare(c1, a);
    C('act.share', 'the active share is the E9 support offense term of the active per attack (power.mjs); a heal-only support has 0',
      want > 0 && Math.abs(got - want) < 1e-9 * want && SC.actShare(c1, card('syn-medic-1')) === 0, JSON.stringify({ got, want }));
  });
  // the measured active factor: the role mean is 1; a bigger heal has a higher factor
  guard('act.factor', () => {
    const ts = Object.keys(c1.v2_templates).filter((t) => t.startsWith('s1.') && c1.v2_templates[t].role === 'medic');
    const f = ts.map((t) => SC.activeFactor(c1, t, 40)); const m = f.reduce((s, x) => s + x, 0) / f.length;
    const w = SC.activeFactor(c1, 's1.hand-medic-weak', 40), s = SC.activeFactor(c1, 's1.hand-medic-strong', 40);
    C('act.factor', 'the measured active factor: the mean over the Set 1 actives of a role is 1, and a stronger active has a higher factor', Math.abs(m - 1) < 1e-9 && s > w, JSON.stringify({ m, w, s }));
  });
  // a value candidate sets the pick value of the supports only; the pick reads it
  guard('prep.value', () => {
    const p = SC.prepare(c1, POOL, { value: actValue(1) }); const a = p.pool.find((c) => c.role === 'artillery'), t = p.pool.find((c) => c.role === 'striker');
    const o = POOL.find((c) => c.id === a.id); const off = o.atk * (1 + o.crt * (o.crd - 1)) * o.spd;
    C('prep.value', 'a value candidate gives a support offense x (1 + the active share) and leaves an attacker on the offense; the pick reads the value',
      Math.abs(pickBase(p.cfg, a, BOSS).val - off * (1 + SC.actShare(c1, o.card))) < 1e-9 * off && t.power === undefined && SC.actShare(c1, o.card) > 0, JSON.stringify({ v: a.power, off }));
  });
  // an enemy patch changes the Weak to bonus of the pick only
  guard('prep.enemy', () => {
    const p = SC.prepare(c1, POOL, { enemy: { weak_role_x: 0.5, weak_role_rules: { controller: { damage_x: 0.5 } } } }); const ctl = POOL.find((c) => c.role === 'controller');
    C('prep.enemy', 'an enemy patch gives the Weak to role its bonus in the pick config only (the live config keeps damage_x 0 for the Controller)',
      pickBase(p.cfg, ctl, BOSS).weak === 1.5 && pickBase(c1, ctl, BOSS).weak === 1 && c1.v2_enemy.weak_role_rules.controller.damage_x === 0, JSON.stringify({ pick: pickBase(p.cfg, ctl, BOSS).weak, live: pickBase(c1, ctl, BOSS).weak }));
  });
  // the diagnosis: a tie inside one role; a pair across the class; no card id in the output
  guard('why.pairs', () => {
    const r = { pool: POOL, boss: BOSS }; const L = [1, 2, 3, 4, 11, 5, 7, 10];
    const tie = SC.why(c1, r, L, [1, 2, 3, 4, 11, 6, 7, 10]); const cross = SC.why(c1, r, L, [1, 2, 3, 4, 9, 5, 7, 10]);
    const t = tie.pairs[0], x = cross.pairs[0];
    C('why.pairs', 'two Medics with the same stats are a same-role tie; a herald (the higher offense) missed for a cleaver is a cross-class pair left out by the fill order; no card id leaves the diagnosis',
      tie.pairs.length === 1 && t.kind === 'same role' && t.wrong === 'none: tie' && t.picked === 'medic' && t.missed === 'medic'
        && cross.pairs.length === 1 && x.kind === 'cross class' && x.picked === 'cleaver' && x.missed === 'herald' && x.wrong === 'none: order' && x.lr.off < 0 && cross.supL === 3 && cross.supS === 4
        && [...tie.pairs, ...cross.pairs].every((p) => Object.keys(p).every((k) => PAIR_KEYS.includes(k))), JSON.stringify({ t, x }));
  });
  // the summary: paired to the live score, with its standard error and the bosses below x0.85
  guard('sum.paired', () => {
    const rows = [{ key: 'a', ratios: { [LIVE]: 0.8, c: 0.9, z: 0.7 } }, { key: 'a', ratios: { [LIVE]: 0.84, c: 0.86, z: 0.9 } }, { key: 'b', ratios: { [LIVE]: 0.9, c: 0.9, z: 0.9 } }];
    const s = SC.summarize(rows, [LIVE, 'c', 'z']); const d = [0.1, 0.02, 0]; const m = (0.12) / 3; const se = Math.sqrt(d.reduce((q, x) => q + (x - m) ** 2, 0) / 3) / Math.sqrt(2);
    C('sum.paired', 'the paired gain is candidate - live over the pools with sd / sqrt(n - 1); a boss below x0.85 counts once',
      Math.abs(s.c.m - m) < 1e-12 && Math.abs(s.c.se - se) < 1e-12 && s[LIVE].below === 1 && s.c.below === 0 && s.c.better === 2 && s.c.worse === 0, JSON.stringify(s.c));
  });
  return out;
}
const failing = () => checks().filter((x) => !x.ok).map((x) => x.id);

test('per-card score Lab baseline: every check is green', () => {
  const r = checks(); console.log(`  baseline: ${r.length} checks, failing: ${r.filter((x) => !x.ok).map((x) => x.id).join(' ') || 'none'}`);
  for (const c of r) assert.ok(c.ok, `${c.id}: ${c.what}: got ${c.got}`);
});

const swap = (key, make) => { const o = SC[key]; return [() => { SC[key] = make(o); }, () => { SC[key] = o; }]; };
const FAULTS = [
  ['act.share', 'the active share ignores the support factor F', swap('actShare', (o) => (c, sc) => o(c, sc) / powerInput(c, sc).f)],
  ['act.factor', 'the active factor is not divided by the role mean', swap('activeFactor', (o) => (c, t, n) => o(c, t, n) * 1.25)],
  ['prep.value', 'the candidate value is dropped (the pick keeps the offense)', swap('prepare', (o) => (c, p, cand) => o(c, p, { ...cand, value: undefined }))],
  ['prep.enemy', 'the Weak to patch is dropped', swap('prepare', (o) => (c, p, cand) => o(c, p, { ...cand, enemy: undefined }))],
  ['why.pairs', 'the diagnosis does not see a tie (the tie counts as the offense)', swap('why', (o) => (...a) => { const w = o(...a); return { ...w, pairs: w.pairs.map((p) => (p.wrong === 'none: tie' ? { ...p, wrong: 'off' } : p)) }; })],
  ['why.pairs', 'the diagnosis puts a card id in a pair', swap('why', (o) => (...a) => { const w = o(...a); return { ...w, pairs: w.pairs.map((p, i) => ({ ...p, id: i })) }; })],
  ['sum.paired', 'the paired gain is taken against another candidate, not the live score', swap('base', () => 'z')],
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
test('the private Set 1 batch: the score Lab runs on the real actives and its output holds no card key, name or active name (counts only)', { skip }, () => {
  const S = loadSet1Batch();
  const L = scorePickLab(cfg, { set1: S, seed: 7, pools: 1, searchDays: 1, evalDays: 2, bosses: ['camper_colossus'], cache: false,
    candidates: { [LIVE]: {}, 'offense + active x1 (supports)': { value: actValue(1) } } });
  const text = JSON.stringify(L.data) + L.md; const words = new Set();
  for (const [k, a] of Object.entries(S)) { words.add(k); if (a.active) words.add(a.active); }
  const hits = [...words].filter((w) => w.length >= 4 && text.includes(w));
  console.log(`  batch: ${Object.keys(S).length} cards; ${L.data.rows.length} pool, ${L.data.rows[0].why.pairs.length} diagnosis pairs; private strings in the output: ${hits.length}`);
  assert.equal(L.data.mode, 'set1'); assert.equal(hits.length, 0, 'the output holds a private card string');
});
