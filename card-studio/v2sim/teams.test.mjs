// The team test: data invariants, the pure no-meta checks (with planted faults on a green synthetic baseline),
// and one planted fault through the real simulation (baseline printed in the same run).
// The real Set 1 actives are PRIVATE (not in this repo). The simulation tests use the synthetic teams-test-fixture.json.
// The tests that check the real actives skip when the private file is missing (V2SIM_ACTIVES or ../discord-card-ideas/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, loadFixture, patch, HERE } from './util.mjs';
import { templatePP, classOf, ROLES, makeCard } from './cards.mjs';
import { loadTeams, loadSet1, hasSet1, ACTIVES_PATH, withSet1, teamSpecs, isCommon, contents, noMetaChecks, measureTeam, teams, BAND, MAX_FIRSTS } from './teams.mjs';

const cfg = loadConfig(), TM = loadTeams();
const SYN = JSON.parse(readFileSync(join(HERE, 'teams-test-fixture.json'), 'utf8'));
const PRIV = hasSet1(), S1 = PRIV ? loadSet1() : {};
const skipPriv = PRIV ? false : `the private actives file is missing (${ACTIVES_PATH()})`;
const subj = new Map(loadFixture().subjects.map(s => [s.key, s]));
const role = k => S1[k].role;

test('loadSet1 gives a clear message when the private file is missing', () => {
  const old = process.env.V2SIM_ACTIVES; process.env.V2SIM_ACTIVES = join(HERE, 'no-such-file.json');
  try { assert.throws(() => loadSet1(), /private Set 1 actives file is missing.*V2SIM_ACTIVES/); } finally { if (old === undefined) delete process.env.V2SIM_ACTIVES; else process.env.V2SIM_ACTIVES = old; }
});
test('the repo holds no real actives: the test fixture is synthetic only', () => {
  for (const k of Object.keys(SYN.cards)) { assert.ok(k.startsWith('syn-'), k); assert.ok(!subj.has(k), k); }
});

// ---------- data ----------
test('private actives: 130 approved actives, valid roles, every one at 10 +/- 0.6 PP (P1 price: shield every ally 100 PP per 1.0)', { skip: skipPriv }, () => {
  const c = withSet1(cfg, S1); const keys = Object.keys(S1);
  assert.equal(keys.length, 130);
  for (const k of keys) {
    assert.ok(subj.has(k), `${k} is not a fixture subject`);
    assert.ok(ROLES.includes(role(k)), `${k}: role ${role(k)}`);
    const pp = templatePP(c, `s1.${k}`);
    assert.ok(Math.abs(pp - cfg.v2_pp.budget) <= cfg.v2_pp.tolerance + 1e-9, `${k}: ${pp.toFixed(2)} PP`);
  }
});

test('teams.json: 20 teams of 8 (Hunt) and 5 (Dungeon) different real cards, no event-only card', () => {
  for (const t of TM) for (const k of [...t.hunt, ...t.dungeon]) assert.ok(subj.has(k), `${t.id}: ${k} is not a fixture subject`);
  assert.equal(TM.length, 20); assert.equal(new Set(TM.map(t => t.id)).size, 20);
  for (const t of TM) {
    assert.equal(t.hunt.length, 8, t.id); assert.equal(new Set(t.hunt).size, 8, t.id);
    assert.equal(t.dungeon.length, 5, t.id); assert.equal(new Set(t.dungeon).size, 5, t.id);
    for (const k of [...t.hunt, ...t.dungeon]) {
      if (PRIV) assert.ok(S1[k], `${t.id}: ${k} has no Set 1 active`);
      assert.ok(subj.get(k).finishes.some(f => f.rarity === 'normal' && f.pool), `${t.id}: ${k} has no pullable Normal finish`);
    }
    for (const k of [...t.combo.enablers, ...t.combo.payoffs]) assert.ok(t.hunt.includes(k) || t.dungeon.includes(k), `${t.id}: combo card ${k} is not in the team`);
    assert.ok(t.name && t.theme && t.plan.length === 2 && t.strengths && t.counters.length, `${t.id}: a text field is missing`);
  }
});

test('teams.json + private actives: diversity (a card in at most 4 teams, every role, the shape rules)', { skip: skipPriv }, () => {
  const use = {}; for (const t of TM) for (const k of new Set([...t.hunt, ...t.dungeon])) use[k] = (use[k] || 0) + 1;
  const over = Object.entries(use).filter(([, n]) => n > 4); assert.deepEqual(over, []);
  assert.ok(Object.keys(use).length >= 100, `only ${Object.keys(use).length} different cards`);
  for (const r of ROLES) assert.ok(Object.keys(use).some(k => role(k) === r), `no team uses a ${r}`);
  const att = keys => keys.filter(k => classOf(role(k)) === 'attacker').length;
  for (const t of TM) {
    assert.ok(att(t.hunt) >= 2 && att(t.hunt) <= 7, `${t.id}: Hunt ${att(t.hunt)}A`);
    assert.ok(att(t.dungeon) >= 2, `${t.id}: Dungeon ${att(t.dungeon)}A`);
  }
  const shapes = new Set(TM.map(t => att(t.hunt))); assert.ok(shapes.size >= 5, `only ${shapes.size} Hunt shapes`);
});

test('teams.json + private actives: every core status and boon is made by some team', { skip: skipPriv }, () => {
  const made = new Set();
  for (const t of TM) for (const k of t.hunt) for (const b of S1[k].blocks) {
    if (b.k === 'apply' || b.k === 'on_crit') made.add(b.status);
    if (['shield', 'shield_all', 'guard_up'].includes(b.k)) made.add('shielded');
    if (['empower', 'rally'].includes(b.k)) made.add('empowered');
    if (b.k === 'focus') made.add('focused'); if (b.k === 'quicken') made.add('quickened'); if (b.k === 'heal' || b.k === 'lifesteal') made.add('heal');
  }
  for (const s of ['poison', 'burn', 'chill', 'stunned', 'sleep', 'paralyzed', 'confused', 'blinded', 'slowed', 'exposed', 'weakened', 'mark', 'shielded', 'empowered', 'focused', 'quickened', 'heal'])
    assert.ok(made.has(s), `no team makes ${s}`);
});

test('teams.json: the casual flag follows the rule (6 of 8 and 4 of 5 common cards), at least 3 casual teams', () => {
  for (const t of TM) {
    const rule = t.hunt.filter(k => isCommon(subj.get(k))).length >= 6 && t.dungeon.filter(k => isCommon(subj.get(k))).length >= 4;
    if (t.casual) assert.ok(rule, `${t.id} is marked casual but breaks the rule`);
  }
  assert.ok(TM.filter(t => t.casual).length >= 3);
});

test('withSet1 keeps a what-if template from --patch, and the team cards use it (synthetic card)', () => {
  const what = patch(cfg, { v2_templates: { 's1.syn-striker-1': { role: 'striker', name: 'what-if', blocks: [{ k: 'hit', x: 3 }] } } });
  const c = withSet1(what, SYN.cards); assert.equal(c.v2_templates['s1.syn-striker-1'].name, 'what-if');
  const card = makeCard(c, teamSpecs(c, ['syn-striker-1'], { stars: 2, level: 10 })[0]); assert.equal(card.active.name, 'what-if');
  assert.equal(withSet1(cfg, SYN.cards).v2_templates['s1.syn-striker-1'].name, SYN.cards['syn-striker-1'].active);
});

test('measureTeam repeats with the same seed', () => {
  const c = withSet1(cfg, SYN.cards), C = contents(c), t = SYN.teams[0];
  const a = measureTeam(c, t, C, { runs: 3, seed: 7 }), b = measureTeam(c, t, C, { runs: 3, seed: 7 });
  assert.deepEqual(a, b);
});

// ---------- the pure checks on a synthetic matrix ----------
// 8 teams, 8 headline contents (3 Hunt, 3 Dungeon, 2 Gauntlet-mode) and 2 counters. Team i is best in content i (+30%)
// and weak in content i+1 (-25%): the baseline must be all PASS. Each planted fault must turn a check red.
function synth(mut = () => {}, clear3 = { t0: 0.9 }) {
  const modes = ['hunt', 'hunt', 'hunt', 'dungeon', 'dungeon', 'dungeon', 'gauntlet', 'gauntlet'];
  const head = modes.map((mode, j) => ({ id: `h${j}`, mode, inv: 'x', label: `h${j}` }));
  const counter = [{ id: 'c0', mode: 'hunt', base: 'h0', mech: 'm0', label: 'c0' }, { id: 'c1', mode: 'dungeon', base: 'h3', mech: 'm1', label: 'c1' }];
  const C = { head, counter, mechs: ['m0', 'm1'] }; const S = {};
  for (let i = 0; i < 8; i++) { S[`t${i}`] = {};
    for (let j = 0; j < 8; j++) S[`t${i}`][`h${j}`] = { score: 100 * (1 + (i === j ? 0.3 : 0) - ((i + 1) % 8 === j ? 0.25 : 0)) };
    S[`t${i}`].c0 = { score: S[`t${i}`].h0.score * 0.9 }; S[`t${i}`].c1 = { score: S[`t${i}`].h3.score * 0.9 }; }
  mut(S, C);
  return noMetaChecks(S, C, { casual: ['t0'], clear3 });
}
const fails = r => Object.fromEntries(r.checks.map(c => [c.id, c.fails]));

test('no-meta checks: the synthetic baseline is green', () => {
  const r = synth(); console.log(`  baseline: ${r.checks.map(c => `${c.id} ${c.ok ? 'PASS' : 'FAIL'}`).join(', ')}`);
  for (const c of r.checks) assert.ok(c.ok, `${c.id} ${c.fails}`);
});
test('planted fault: one team is +60% in every content -> (c) and (d) go red for it', () => {
  const r = synth(S => { for (const k of Object.keys(S.t2)) S.t2[k].score *= 1.6; }); const f = fails(r);
  console.log(`  t2 x1.6: c ${f.c.join(',') || '-'}, d ${f.d.join(',') || '-'}`);
  assert.ok(f.c.includes('t2')); assert.ok(f.d.includes('t2'));
});
test('planted fault: one team loses its weak content -> (b) goes red for it only', () => {
  const r = synth(S => { S.t4.h5.score = 100; }); const f = fails(r);
  console.log(`  t4 no weakness: b ${f.b.join(',') || '-'}`);
  assert.deepEqual(f.b, ['t4']);
});
test('planted fault: one team is weak everywhere -> (a) and (d) go red for it', () => {
  const r = synth(S => { for (const k of Object.keys(S.t6)) S.t6[k].score *= 0.5; }); const f = fails(r);
  assert.ok(f.a.includes('t6')); assert.ok(f.d.includes('t6'));
});
test('specialists: check d skips a designed specialist only (a weak-everywhere specialist still fails a)', () => {
  const weak = S => { for (const k of Object.keys(S.t6)) S.t6[k].score *= 0.5; };
  const modes = ['hunt', 'hunt', 'hunt', 'dungeon', 'dungeon', 'dungeon', 'gauntlet', 'gauntlet'];
  const head = modes.map((mode, j) => ({ id: `h${j}`, mode, inv: 'x', label: `h${j}` })), C = { head, counter: [], mechs: [] }, S = {};
  for (let i = 0; i < 8; i++) { S[`t${i}`] = {}; for (let j = 0; j < 8; j++) S[`t${i}`][`h${j}`] = { score: 100 * (1 + (i === j ? 0.3 : 0) - ((i + 1) % 8 === j ? 0.25 : 0)) }; }
  weak(S); for (const k of Object.keys(S.t2)) S.t2[k].score *= 1.6;
  const off = fails(noMetaChecks(S, C)), on = fails(noMetaChecks(S, C, { specialists: ['t6'] }));
  console.log(`  t6 weak + t2 x1.6: d without specialists ${off.d.join(',')}, with t6 specialist ${on.d.join(',')}; a ${on.a.join(',')}`);
  assert.ok(off.d.includes('t6') && off.d.includes('t2'));
  assert.ok(!on.d.includes('t6') && on.d.includes('t2'), 'd must skip the specialist only');
  assert.ok(on.a.includes('t6'), 'a still applies to a specialist');
});
test('teams.json: a specialist team has a reason, and at most 2 teams are specialists', () => {
  const sp = TM.filter(t => t.specialist); assert.ok(sp.length <= 2);
  for (const t of sp) assert.ok(t.specialist_note && t.specialist_note.length > 20, `${t.id}: specialist_note missing`);
});
test('planted fault: a casual team below the floor-3 clear rate -> (e) goes red', () => {
  const f = fails(synth(() => {}, { t0: 0.5 })); console.log(`  t0 clears floor 3 in 50%: e ${f.e.join(',') || '-'}`);
  assert.deepEqual(f.e, ['t0']);
});

// ---------- one planted fault through the real simulation ----------
test('planted fault in the simulation (synthetic teams): its attackers hit x25 -> that team breaks (c) or (d), on a green baseline for that team', () => {
  const runs = 15, seed = 3, opt = { runs, seed, teamList: SYN.teams, actives: SYN.cards };
  const per = teams(cfg, opt).data.per;
  const green = SYN.teams.find(t => per[t.id].vsMedian >= BAND[0] && per[t.id].vsMedian <= BAND[1] && per[t.id].firsts.length <= MAX_FIRSTS);
  assert.ok(green, 'no synthetic team is green at baseline');
  const base = per[green.id], key = green.dungeon[0];
  console.log(`  baseline ${green.id}: overall x${base.vsMedian.toFixed(2)}, #1 in ${base.firsts.length} headline contents`);
  // the fault: in this team only, every attacker active becomes a hit x25 (the other teams keep the normal cards)
  const cards = { ...SYN.cards }; const att = new Set([...green.hunt, ...green.dungeon].filter(k => classOf(SYN.cards[k].role) === 'attacker'));
  for (const k of att) cards[`${k}-planted`] = { ...SYN.cards[k], active: 'planted', blocks: [{ k: 'hit', x: 25 }] };
  const sw = l => l.map(k => att.has(k) ? `${k}-planted` : k);
  const list = SYN.teams.map(t => t.id === green.id ? { ...t, hunt: sw(t.hunt), dungeon: sw(t.dungeon) } : t);
  const p = teams(cfg, { ...opt, teamList: list, actives: cards }).data.per[green.id];
  console.log(`  planted ${green.id} (attackers x25): overall x${p.vsMedian.toFixed(2)}, #1 in ${p.firsts.length} headline contents`);
  assert.ok(p.vsMedian > BAND[1] || p.firsts.length > MAX_FIRSTS, 'the planted fault was not caught');
});
