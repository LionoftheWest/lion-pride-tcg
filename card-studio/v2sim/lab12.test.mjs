// The Combat Lab measurements L1 and L2 (lab12.mjs, plan 19.5): one check for each part of the measurement, and one planted fault for each part.
// The baseline runs first in the same process and is printed. Each fault must turn at least one check red, and its own check; the checks are
// green again after the faults (no leak). The real Set 1 actives are PRIVATE: the end-to-end checks use the synthetic teams-test-fixture.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, HERE, mkRng } from './util.mjs';
import { makeCard, templatePP } from './cards.mjs';
import { makeFoe } from './modes.mjs';
import { Battle, CONTROL } from './engine.mjs';
import { POLICIES } from './policy.mjs';
import { withSet1 } from './teams.mjs';
import { K, emptyTally, recordActive, withProbe, probeTeams, l12Numbers, measureL12, l12Summary, pairTeams, controlPays, priceEffect } from './lab12.mjs';

const cfg = loadConfig();
const SYN = JSON.parse(readFileSync(join(HERE, 'teams-test-fixture.json'), 'utf8'));
const near = (a, b) => a !== null && Math.abs(a - b) < 1e-12;

// ---------- hand-made state (no fight) ----------
const card = (role, cls, blocks, key = role) => ({ role, cls, key, active: { blocks }, st: {} });
const foe = (st = []) => ({ st: Object.fromEntries(st.map((s) => [s, { until: 99 }])) });
const field = (cards, foes) => ({ cards, alive: (side) => (side === 'card' ? cards : foes) });
const one = (u, squad, tgt, foes = [tgt]) => { const T = emptyTally(); recordActive(T, 'run', cfg, field(squad, foes), u, tgt); return T; };
const STUNNER = () => card('controller', 'support', [{ k: 'apply', status: 'stunned', chance: 1 }], 'stunner');
const ATT = () => card('striker', 'attacker', [{ k: 'hit', x: 1.5 }], 'att');

function checks() {
  const out = []; const C = (id, what, ok, got) => out.push({ id, what, ok: !!ok, got });
  // L1: the target has a control status, for each of the four, and not for a non-control status
  { const each = CONTROL.map((s) => { const u = ATT(); return one(u, [u, STUNNER()], foe([s])).l1.run.attacker.control; });
    const none = (() => { const u = ATT(); return one(u, [u, STUNNER()], foe(['chill', 'poison', 'slowed'])).l1.run.attacker.control; })();
    C('l1.each', 'each control status counts (n 1, ctl 1); Chill, Poison and Slowed do not', each.every((x) => x.n === 1 && x.ctl === 1) && none.n === 1 && none.ctl === 0, JSON.stringify({ each, none })); }
  // L1: the partner is ANOTHER card; a Chill maker is a control partner (Chill ends in Frozen); controller = the role controller
  { const u = STUNNER(); const T = one(u, [u, ATT()], foe(['stunned']));
    C('l1.partner.self', 'a card is not its own partner: a lone control maker has no control partner (all n 1, control n 0)', T.l1.run.support.all.n === 1 && T.l1.run.support.control.n === 0, JSON.stringify(T.l1.run.support)); }
  { const chiller = card('warden', 'support', [{ k: 'shield', v: 0.3 }, { k: 'apply', status: 'chill', stacks: 1, chance: 1 }]);
    const u = ATT(); const T = one(u, [u, chiller], foe([]));
    const ctrlChill = card('controller', 'support', [{ k: 'apply', status: 'chill', stacks: 1, chance: 1 }]); const u2 = ATT(); const T2 = one(u2, [u2, ctrlChill], foe([]));
    const healer = card('medic', 'support', [{ k: 'heal', v: 0.3 }]); const u3 = ATT(); const T3 = one(u3, [u3, healer], foe(['stunned']));
    C('l1.partner.chill', 'a Chill maker is a control partner, a Controller only with the role controller, a healer is none',
      T.l1.run.attacker.control.n === 1 && T.l1.run.attacker.controller.n === 0 && T2.l1.run.attacker.controller.n === 1 && T3.l1.run.attacker.control.n === 0 && T3.l1.run.attacker.all.ctl === 1,
      JSON.stringify([T.l1.run.attacker, T2.l1.run.attacker, T3.l1.run.attacker])); }
  // L1: the groups
  { const sm = card('artillery', 'support', [{ k: 'smite', x: 1.5 }, { k: 'vs_status', status: 'stunned', x: 2 }]); const T = one(sm, [sm, STUNNER()], foe(['frozen']));
    const sh = card('warden', 'support', [{ k: 'shield', v: 0.3 }]); const T2 = one(sh, [sh, STUNNER()], foe(['frozen']));
    C('l1.groups', 'a support smite counts in support and support_smite; a support with no smite in support only; an attacker in attacker only',
      T.l1.run.support.control.ctl === 1 && T.l1.run.support_smite.control.ctl === 1 && T.l1.run.attacker.all.n === 0 && T2.l1.run.support.control.n === 1 && T2.l1.run.support_smite.all.n === 0,
      JSON.stringify([T.l1.run, T2.l1.run.support_smite])); }
  // the control payers
  { const sm = card('artillery', 'support', [{ k: 'smite', x: 1.5 }, { k: 'vs_status', status: 'stunned', x: 2 }]); const T = one(sm, [sm, STUNNER()], foe(['stunned']));
    const T2 = one(sm, [sm, STUNNER()], foe(['frozen']));
    C('l1.pay', 'a control payer counts its actives and the actives where the target has ITS status (Stunned yes, Frozen no)',
      T.pay.run.n === 1 && T.pay.run.hit === 1 && T2.pay.run.n === 1 && T2.pay.run.hit === 0 && controlPays([{ k: 'payoff_dmg', statuses: ['burn', 'paralyzed'] }]).join() === 'paralyzed', JSON.stringify([T.pay.run, T2.pay.run])); }
  // L2: the row, the gate, the ratio
  { const cl = card('cleaver', 'attacker', [{ k: 'hit', x: 1.2 }, { k: 'area', x: 0.5 }, { k: 'payoff_dmg', status: 'burn', v: 0.3 }]);
    const t = foe(['burn', 'poison']), f2 = foe(['burn']), f3 = foe([]); const T = one(cl, [cl], t, [t, f2, f3]); const N = l12Numbers(T);
    C('l2.row', 'main target Burn + Poison, the 2 others: one Burn: main 2, other 0.5, ratio 0.25; 2 other enemies',
      T.l2.run.main === 2 && near(T.l2.run.other, 0.5) && T.l2.run.n === 1 && T.l2.run.others === 2 && near(N.l2.run, 0.25) && near(N.l2.pooled, 0.25), JSON.stringify([T.l2.run, N.l2.run]));
    C('l2.pay', 'the payoff card on its paid status only (Burn): main 1, other 0.5, ratio 0.5', T.l2pay.run.main === 1 && near(T.l2pay.run.other, 0.5) && near(N.l2pay.all.ratio, 0.5), JSON.stringify([T.l2pay.run, N.l2pay])); }
  { const cl = card('cleaver', 'attacker', [{ k: 'hit', x: 1.2 }, { k: 'area', x: 0.5 }]); const t = foe(['burn']);
    const T1 = one(cl, [cl], t, [t]); const u = ATT(); const T2 = one(u, [u], t, [t, foe(['burn'])]);
    const sm = card('artillery', 'support', [{ k: 'smite', x: 1.2 }, { k: 'area', x: 0.5 }]); const T3 = one(sm, [sm], t, [t, foe(['burn'])]);
    C('l2.gate', 'no L2 row with one enemy, for an attacker with no area block, or for a support area smite', T1.l2.run.n === 0 && T2.l2.run.n === 0 && T3.l2.run.n === 0, JSON.stringify([T1.l2.run, T2.l2.run, T3.l2.run])); }
  { const T = emptyTally(); T.l2.horde.main = 4; T.l2.horde.other = 1; T.l2.run.main = 0; T.l2.gauntlet.main = 1; T.l2.gauntlet.other = 1;
    const N = l12Numbers(T);
    C('l2.ratio', 'the ratio of the sums: horde 1/4, run null (no main), pooled run + horde 0.25, all contents 2/5', near(N.l2.horde, 0.25) && N.l2.run === null && near(N.l2.pooled, 0.25) && near(N.l2.all, 0.4), JSON.stringify(N.l2)); }
  // the probe reads the state BEFORE the blocks run (a real fight state: the active Stuns the target, the probe must not see that Stun)
  { const c = { ...cfg, v2_templates: { ...cfg.v2_templates, 'probe.stun': { role: 'controller', name: 'p', blocks: [{ k: 'apply', status: 'stunned', chance: 1 }] } } };
    const mk = (key) => makeCard(c, { key, role: 'controller', rarity: 'normal', template: 'probe.stun', stars: 2, level: 15 });
    const f = { ...makeFoe(c, 1, 1, 'horde', mkRng(5)), resolve: 0, mech: [] };
    const b = new Battle(c, { cards: [mk('p1'), mk('p2')], enemies: [f], mode: 'dungeon', policy: POLICIES.best, seed: 1 });
    const T = emptyTally(); withProbe(T, () => 'run', () => b.doActive(b.cards[0], b.enemies[0]));
    C('probe.before', 'the probe reads the target before the blocks: the Stun of this active is not seen (ctl 0), but it is on the target after', T.l1.run.support.control.n === 1 && T.l1.run.support.control.ctl === 0 && !!b.enemies[0].st.stunned,
      JSON.stringify({ l1: T.l1.run.support.control, stunned: !!b.enemies[0].st.stunned })); }
  // end to end on the synthetic teams: every active is recorded once, the same seed gives the same numbers, the shares are shares
  { const c = withSet1(cfg, SYN.cards); const TM = SYN.teams.slice(0, 3); let calls = 0;
    const proto = Battle.prototype, d0 = proto.doActive; proto.doActive = function (...a) { calls++; return d0.apply(this, a); };
    let T; try { T = probeTeams(c, TM, { runs: 2, seed: 4, policy: 'autov2' }); } finally { proto.doActive = d0; }
    const rec = Object.values(T.l1).reduce((s, g) => s + g.attacker.all.n + g.support.all.n, 0);
    const N = l12Numbers(T), N2 = l12Numbers(probeTeams(c, TM, { runs: 2, seed: 4, policy: 'autov2' }));
    const shares = Object.values(N.l1).flatMap((g) => Object.values(g).flatMap((p) => Object.values(p))).filter((x) => x !== null);
    C('e2e.count', 'every active of every fight is recorded once (attacker + support, partner all)', calls > 50 && rec === calls, `${rec} recorded of ${calls}`);
    C('e2e.repeat', 'the same seed gives the same numbers; every L1 share is in 0..1; Battle.doActive is restored', JSON.stringify(N) === JSON.stringify(N2) && shares.every((x) => x >= 0 && x <= 1) && Battle.prototype.doActive === d0, `${shares.length} shares`); }
  // the summary over the seeds and the pairing
  { const M = measureL12(cfg, { runs: 2, seeds: 2, seed: 4, teamList: SYN.teams.slice(0, 4), actives: SYN.cards, standard: false });
    const S = l12Summary(M); const x = S.autov2.l1.all.attacker.all; const rows = M.policies.autov2.map((r) => r.l1.all.attacker.all);
    const P = pairTeams(withSet1(cfg, SYN.cards), SYN.cards, SYN.teams);
    C('summary', 'the summary = the mean, the lowest and the highest seed; the pairing puts a Set 1 Artillery card beside a Controller that makes a control',
      near(x.mean, (rows[0] + rows[1]) / 2) && near(x.lo, Math.min(...rows)) && near(x.hi, Math.max(...rows)) && Array.isArray(P) && M.seeds.join() === '4,5',
      JSON.stringify({ x, rows, pairs: P.length })); }
  // the price effect (lab12prices): a vs_status on one control status is linear in frozen_share; the other ability does not change
  { const vs = { role: 'striker', blocks: [{ k: 'hit', x: 1.5 }, { k: 'vs_status', status: 'stunned', x: 2 }] }, plain = { role: 'striker', blocks: [{ k: 'hit', x: 1.5 }] };
    const pp = (a) => templatePP({ ...cfg, v2_templates: { ...cfg.v2_templates, 'probe.p': { ...a, name: 'p' } } }, 'probe.p');
    const vsPart = pp(vs) - pp(plain); const R = cfg.v2_pp.ref;
    const e = priceEffect(cfg, [vs, plain], { att: { v2_pp: { ref: { frozen_share: R.frozen_share * 2 } } } }), z = priceEffect(cfg, [vs, plain], {});
    C('price', 'twice frozen_share: 1 of 2 abilities changes, by the vs_status part; no patch: none changes; the PP rule counts match',
      e.n === 2 && e.changed === 1 && vsPart > 0 && Math.abs(e.largest.delta - vsPart) < 1e-9 && z.changed === 0 && z.acceptedBefore === z.acceptedAfter && e.acceptedBefore === z.acceptedBefore,
      JSON.stringify({ e, z, vsPart })); }
  return out;
}
const failing = () => checks().filter((x) => !x.ok).map((x) => x.id);

test('L1/L2 baseline: every check is green', () => {
  const r = checks(); console.log(`  baseline: ${r.length} checks, failing: ${r.filter((x) => !x.ok).map((x) => x.id).join(' ') || 'none'}`);
  for (const c of r) assert.ok(c.ok, `${c.id}: ${c.what}: got ${c.got}`);
});

const swap = (key, make) => { const o = K[key]; return [() => { K[key] = make(o); }, () => { K[key] = o; }]; };
const FAULTS = [
  ['l1.each', 'the control list misses Frozen', swap('hasControl', () => (x) => (['stunned', 'sleep', 'paralyzed'].some((s) => x.st[s]) ? 1 : 0))],
  ['l1.each', 'Chill counts as a control on the target', swap('hasControl', (o) => (x) => (x.st.chill ? 1 : o(x)))],
  ['l1.partner.self', 'the card is its own partner', swap('partnerOf', () => (c, u, cards) => ({ all: true, control: cards.some((x) => K.makesControl(c, x)), controller: cards.some((x) => x.role === 'controller' && K.makesControl(c, x)) }))],
  ['l1.partner.chill', 'a Chill maker is not a control partner', swap('makesControl', () => (c, x) => x.active.blocks.some((b) => b.k === 'apply' && CONTROL.includes(b.status) && b.status !== 'frozen'))],
  ['l1.partner.chill', 'any card is a Controller partner (the role ignored)', swap('partnerOf', (o) => (c, u, cards) => { const p = o(c, u, cards); return { ...p, controller: p.control }; })],
  ['l1.groups', 'the support smites are not a group of their own', swap('groupsOf', () => (u) => [u.cls])],
  ['l2.row', 'the main target counts among the other enemies', swap('areaRow', () => (tgt, foes, statuses) => { let main = 0, other = 0; for (const s of statuses) { main += tgt.st[s] ? 1 : 0; other += foes.filter((e) => e.st[s]).length / foes.length; } return { main, other, others: foes.length }; })],
  ['l2.ratio', 'the ratio is inverted (main / other)', swap('ratio', () => (m, o) => (o ? m / o : null))],
  ['l2.gate', 'a single enemy makes an L2 row', swap('areaNow', () => (u, foes) => u.cls === 'attacker' && u.active.blocks.some((b) => b.k === 'area') && foes.length >= 1)],
  ['l2.gate', 'a support area smite makes an L2 row', swap('areaNow', () => (u, foes) => u.active.blocks.some((b) => b.k === 'area') && foes.length >= 2)],
  ['probe.before', 'the probe reads the state after the blocks', swap('before', () => false)],
  ['e2e.count', 'the probe drops the support actives', swap('groupsOf', (o) => (u) => (u.cls === 'support' ? [] : o(u)))],
];
for (const [id, name, [apply, undo]] of FAULTS) {
  test(`planted fault is caught: ${name}`, () => {
    apply(); let f; try { f = failing(); } finally { undo(); }
    console.log(`  ${name}: ${f.length} checks fail (${f.join(', ')})`);
    assert.ok(f.includes(id), `the check ${id} did not fail for the planted fault "${name}" (failing: ${f.join(', ') || 'none'})`);
  });
}
test('the checks are green again after the faults (no leak)', () => assert.deepEqual(failing(), []));
