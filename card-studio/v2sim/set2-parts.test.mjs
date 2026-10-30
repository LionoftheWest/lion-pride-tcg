// Set 2 engine parts (b) and (c) (Nathan 2026-10-28, plan 20.16): the simulator side. SQL = the simulator: card-studio/scripts/test-combat-v2-set2-parts.mjs
// (SQL: tcg-bot/supabase/combat_v2_set2_parts.sql).
//   (b) dispel, heal_all and quicken (self) on an attacker: the price is the support library price x sup_cycle / C (plan 5.2), the execution is in engine.mjs doActive.
//   (c) kinds = N (the target has N or more different harmful statuses) on a line_status and a payoff_dmg: the price is the raw price x the measured share
//       share.status_kinds.<N> (the T1c rule), and the minimum share rule counts it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, patch } from './util.mjs';
import { dummyCard, dummyFoe, mini } from './checks.mjs';
import { blockPP, minShareErrors, classOf } from './cards.mjs';
import { Battle } from './engine.mjs';

const cfg = loadConfig();
const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t * Math.max(1, Math.abs(b));
const K = cfg.ability_v2.pp.att_k / (cfg.v2_charge.attacker + 1);     // an attacker: att_k / C
const SK = cfg.ability_v2.pp.sup_cycle / (cfg.v2_charge.attacker + 1); // the support price at the attacker cycle
const SS = cfg.ability_v2.pp.sup_cycle / (cfg.v2_charge.support + 1);
const mk = (role, blocks, o = {}) => { const c = dummyCard(cfg, { role, ...o }); c.active = { id: 'x', name: 'x', charge: 2, blocks }; return c; };
const ppOf = (c, role, blocks) => { const cc = patch(c, {}); cc.v2_templates = { ...c.v2_templates, zz: { role, name: 'zz', blocks } }; return blocks.map((b) => blockPP(cc, 'zz', b)); };
// one active of card 0 on foe 0 with the hit stubbed: the calls of cardHit (target state at the call, the options)
function fight(c, cards, foes, tweak = () => {}) {
  const b = mini(c, cards, foes); tweak(b);
  const calls = [];
  b.cardHit = (u, t, o) => { calls.push({ t: t.idx, side: t.side, shield: t.shield, st: Object.keys(t.st), o: { ...o } }); return { dealt: 0, miss: false, crit: false }; };
  b.doActive(b.cards[0], b.enemies[0]);
  return { b, calls };
}

test('config: share.status_kinds has a share for 2 to 5 statuses, falling', () => {
  const s = cfg.ability_v2.share.status_kinds;
  assert.deepEqual(Object.keys(s), ['2', '3', '4', '5']);
  for (const n of ['2', '3', '4', '5']) assert.equal(typeof s[n], 'number', n);
  assert.ok(s[2] > s[3] && s[3] > s[4] && s[4] >= s[5]);
});

test('(b) the price of dispel, heal_all and quicken on an attacker = the support library price x sup_cycle / C (C = the attacker cycle)', () => {
  const P = cfg.v2_pp.support_pp;
  const pp = ppOf(cfg, 'striker', [{ k: 'dispel' }, { k: 'hit', x: 1.55 }, { k: 'heal_all', v: 0.05 }, { k: 'quicken', v: 0.3, self: true }]);
  assert.ok(near(pp[0], P.dispel * SK), `dispel ${pp[0]}`);
  assert.ok(near(pp[1], K * 0.55), `hit ${pp[1]}`);
  assert.ok(near(pp[2], P.heal_all * 0.05 * SK), `heal_all ${pp[2]}`);
  assert.ok(near(pp[3], P.quicken * 0.3 * SK), `quicken ${pp[3]}`);
  // the same blocks on a support cost the support price at its own cycle
  const ps = ppOf(cfg, 'medic', [{ k: 'dispel' }, { k: 'heal_all', v: 0.05 }]);
  assert.ok(near(ps[0], P.dispel * SS) && near(ps[1], P.heal_all * 0.05 * SS));
  assert.ok(SK < SS, 'the attacker cycle is longer than the support cycle, so the price is lower');
});

test('(b) an attacker dispel strips the shield and the boosts of the target BEFORE the hit; it keeps the harmful statuses', () => {
  const { calls } = fight(cfg, [mk('striker', [{ k: 'dispel' }, { k: 'hit', x: 1.55 }])], [dummyFoe()], (b) => {
    const f = b.enemies[0]; f.shield = 50; f.st.empowered = { value: 0.3 }; f.st.quickened = { value: 1.3 }; f.st.poison = { stacks: 1 };
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].shield, 0);
  assert.deepEqual(calls[0].st, ['poison']);
  // control: no dispel, the shield and the boosts stay at the hit
  const c2 = fight(cfg, [mk('striker', [{ k: 'hit', x: 1.55 }])], [dummyFoe()], (b) => { const f = b.enemies[0]; f.shield = 50; f.st.empowered = { value: 0.3 }; });
  assert.equal(c2.calls[0].shield, 50); assert.deepEqual(c2.calls[0].st, ['empowered']);
});

test('(b) an attacker heal_all heals every standing ally v x max HP (this card too, a downed ally not), after the hits; ABL scales it', () => {
  const cards = [mk('survivor', [{ k: 'hit', x: 1.6 }, { k: 'heal_all', v: 0.05 }]), mk('medic', [{ k: 'heal', v: 0.3 }]), mk('striker', [{ k: 'hit', x: 1.2 }])];
  const { b } = fight(cfg, cards, [dummyFoe()], (bb) => {
    for (const c of bb.cards) c.hp = c.maxHp * 0.5;
    bb.cards[2].down = true; bb.cards[2].hp = 0; bb.cards[0].abl = 1.2;
  });
  const [a, m, d] = b.cards;
  assert.ok(near(a.hp, a.maxHp * 0.5 + 0.05 * 1.2 * a.maxHp, 1e-6), `self ${a.hp}`);
  assert.ok(near(m.hp, m.maxHp * 0.5 + 0.05 * 1.2 * m.maxHp, 1e-6), `ally ${m.hp}`);
  assert.equal(d.hp, 0);
});

test('(b) an attacker quicken self: this card gets Quickened with value 1 + v x ABL after the hits, no other card does', () => {
  const cards = [mk('finisher', [{ k: 'hit', x: 1.4 }, { k: 'quicken', v: 0.3, self: true }]), mk('striker', [{ k: 'hit', x: 1.2 }])];
  const { b } = fight(cfg, cards, [dummyFoe()], (bb) => { bb.cards[0].abl = 1.1; });
  assert.ok(near(b.cards[0].st.quickened.v, 1 + 0.3 * 1.1, 1e-9));
  assert.equal(b.cards[1].st.quickened, undefined);
});

test('(b) a Confused attacker hits its own side and does none of the new blocks (the redirect returns first)', () => {
  const cards = [mk('finisher', [{ k: 'dispel' }, { k: 'hit', x: 1.4 }, { k: 'heal_all', v: 0.05 }, { k: 'quicken', v: 0.3, self: true }]), mk('medic', [{ k: 'heal', v: 0.3 }])];
  let n = 0;
  for (let seed = 1; seed < 60; seed++) {
    const b = mini(cfg, cards.map((c) => ({ ...c })), [dummyFoe()], { seed }); const f = b.enemies[0]; f.shield = 50; b.cards[0].st.confused = { until: 99 };
    const before = b.cards[1].hp; b.cards[1].hp = b.cards[1].maxHp * 0.5; const h0 = b.cards[1].hp;
    const wrong = (() => { const orig = b.confusedRedirect.bind(b); let hit = false; b.confusedRedirect = (u) => { const r = orig(u); if (r) hit = true; return r; }; return () => hit; })();
    b.doActive(b.cards[0], f);
    if (wrong()) { n++; assert.equal(f.shield, 50, 'no dispel'); assert.equal(b.cards[0].st.quickened, undefined, 'no quicken'); assert.ok(b.cards[1].hp <= h0, 'no heal_all'); }
    void before;
  }
  assert.ok(n > 0, 'a confused redirect happened');
});

test('(c) kinds: hasAny counts the different harmful statuses of the target (a boon does not count), as an OR next to the statuses', () => {
  const b = mini(cfg, [mk('striker', [{ k: 'hit', x: 1.2 }])], [dummyFoe()]); const f = b.enemies[0];
  assert.equal(b.hasAny(f, { kinds: 2 }), false);
  f.st.poison = { stacks: 3 }; assert.equal(b.hasAny(f, { kinds: 2 }), false);
  f.st.empowered = { value: 0.2 }; assert.equal(b.hasAny(f, { kinds: 2 }), false, 'a boon is not harmful');
  f.st.burn = { stacks: 1 }; assert.equal(b.hasAny(f, { kinds: 2 }), true); assert.equal(b.hasAny(f, { kinds: 3 }), false);
  f.st.slowed = { until: 9 }; assert.equal(b.hasAny(f, { kinds: 3 }), true);
  assert.equal(b.hasAny(f, { statuses: ['sleep'], kinds: 3 }), true, 'the kinds alternative');
  assert.equal(b.hasAny(f, { statuses: ['poison'], kinds: 5 }), true, 'the named status alternative');
  assert.equal(b.hasAny(f, { statuses: ['sleep'], kinds: 5 }), false);
  assert.equal(b.hasAny(f, { status: 'poison' }), true); assert.equal(b.hasAny(f, { status: 'sleep' }), false);
});

test('(c) an attacker payoff_dmg with kinds adds its bonus only while the target has that many statuses; an area hit reads the OTHER enemy', () => {
  const blocks = [{ k: 'hit', x: 1.3 }, { k: 'area', x: 0.5 }, { k: 'payoff_dmg', kinds: 2, v: 0.4 }];
  const run = (st0, st1) => fight(cfg, [mk('cleaver', blocks)], [dummyFoe(), dummyFoe()], (b) => { Object.assign(b.enemies[0].st, st0); Object.assign(b.enemies[1].st, st1); }).calls;
  let c = run({}, {}); assert.equal(c[0].o.bonus, 0); assert.equal(c[1].o.bonus, 0);
  c = run({ poison: { stacks: 1 }, burn: { stacks: 1 } }, {}); assert.ok(near(c[0].o.bonus, 0.4)); assert.equal(c[1].o.bonus, 0);
  c = run({}, { poison: { stacks: 1 }, slowed: { until: 9 } }); assert.equal(c[0].o.bonus, 0); assert.ok(near(c[1].o.bonus, 0.4), 'the area hit has its own enemy');
});

test('(c) an execute line with kinds: the bonus holds below the HP line OR with that many statuses OR with a named status', () => {
  const run = (line, hpShare, st) => fight(cfg, [mk('finisher', [{ k: 'hit', x: 1.5 }, { k: 'execute', line: 0.3, v: 0.7 }, line])], [dummyFoe()], (b) => { const f = b.enemies[0]; f.hp = f.maxHp * hpShare; Object.assign(f.st, st); }).calls[0].o.bonus;
  const K3 = { k: 'line_status', kinds: 3 }, KS = { k: 'line_status', statuses: ['sleep'], kinds: 3 };
  assert.equal(run(K3, 0.9, {}), 0);
  assert.equal(run(K3, 0.9, { poison: { stacks: 1 }, burn: { stacks: 1 } }), 0, '2 statuses are not 3');
  assert.ok(near(run(K3, 0.9, { poison: { stacks: 1 }, burn: { stacks: 1 }, slowed: { until: 9 } }), 0.7));
  assert.ok(near(run(K3, 0.2, {}), 0.7), 'below the line');
  assert.ok(near(run(KS, 0.9, { sleep: { until: 9 } }), 0.7), 'a named status');
  assert.ok(near(run(KS, 0.9, { poison: { stacks: 1 }, burn: { stacks: 1 }, slowed: { until: 9 } }), 0.7), 'kinds with a list');
  assert.equal(run(KS, 0.9, { poison: { stacks: 1 } }), 0);
});

test('(c) the price: payoff_dmg kinds = the raw price x the measured share (an attacker and a support smite); the assumed 0.6 share is not used', () => {
  const s3 = cfg.ability_v2.share.status_kinds[3], s2 = cfg.ability_v2.share.status_kinds[2];
  const a = ppOf(cfg, 'striker', [{ k: 'hit', x: 1.3 }, { k: 'payoff_dmg', kinds: 2, v: 0.4 }, { k: 'payoff_dmg', statuses: ['poison'], v: 0.4 }]);
  assert.ok(near(a[1], K * 0.4 * s2), `kinds ${a[1]}`);
  assert.ok(near(a[2], K * 0.4 * cfg.v2_pp.ref.payoff), `named ${a[2]}`);
  const s = ppOf(cfg, 'artillery', [{ k: 'smite', x: 1.65 }, { k: 'payoff_dmg', kinds: 3, v: 0.4 }]);
  assert.ok(near(s[1], cfg.v2_pp.support_pp.smite * 0.4 * SS * s3), `support ${s[1]}`);
  // the numbers come from the config
  const c2 = patch(cfg, { ability_v2: { share: { status_kinds: { 3: 0.2 } } } });
  assert.ok(near(ppOf(c2, 'artillery', [{ k: 'smite', x: 1.65 }, { k: 'payoff_dmg', kinds: 3, v: 0.4 }])[1], cfg.v2_pp.support_pp.smite * 0.4 * SS * 0.2));
  // a missing share throws (never a silent 0)
  const c3 = patch(cfg, {}); delete c3.ability_v2.share.status_kinds;
  assert.throws(() => ppOf(c3, 'striker', [{ k: 'hit', x: 1.3 }, { k: 'payoff_dmg', kinds: 2, v: 0.4 }]), /no share\.status_kinds/);
});

test('(c) the price: line_status kinds = its named statuses (the flat price) + att_k / C x the execute bonus x the measured share', () => {
  const s3 = cfg.ability_v2.share.status_kinds[3];
  const p = ppOf(cfg, 'finisher', [{ k: 'hit', x: 1.5 }, { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: 3 }, { k: 'line_status', statuses: ['sleep', 'paralyzed'] }, { k: 'line_status', statuses: ['sleep'], kinds: 3 }]);
  assert.ok(near(p[2], K * 0.7 * s3), `kinds only ${p[2]}`);
  assert.ok(near(p[3], cfg.ability_v2.pp.line_status * 2), `two named ${p[3]}`);
  assert.ok(near(p[4], cfg.ability_v2.pp.line_status + K * 0.7 * s3), `both ${p[4]}`);
});

test('(c) the minimum share rule counts kinds: 3 or more (0.0059) is below 0.01, 2 or more is not; the numbers come from the config', () => {
  const blocks = (n) => [{ k: 'hit', x: 1.5 }, { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: n }];
  assert.deepEqual(minShareErrors(cfg, blocks(3)).map((e) => [e.block, e.k, e.kinds]), [[3, 'line_status', 3]]);
  assert.deepEqual(minShareErrors(cfg, blocks(2)), []);
  assert.deepEqual(minShareErrors(cfg, [{ k: 'smite', x: 1.65 }, { k: 'payoff_dmg', kinds: 4, v: 0.4 }]).map((e) => [e.block, e.k, e.kinds]), [[2, 'payoff_dmg', 4]]);
  assert.deepEqual(minShareErrors(patch(cfg, { ability_v2: { share: { status_kinds: { 3: 0.043 } } } }), blocks(3)), [], 'a measured share of 0.043 passes');
  assert.deepEqual(minShareErrors(cfg, [{ k: 'smite', x: 1.65 }, { k: 'payoff_dmg', statuses: ['poison'], v: 0.4 }]), [], 'a named status has no measured share');
});

test('planted faults: the engine tests catch an engine that ignores kinds, skips the heal, or quickens an ally', () => {
  const proto = Battle.prototype; const orig = { hasAny: proto.hasAny, doActive: proto.doActive };
  try {
    proto.hasAny = function (u, b) { return b.statuses ? b.statuses.some((s) => this.has(u, s)) : this.has(u, b.status); };
    const calls = fight(cfg, [mk('finisher', [{ k: 'hit', x: 1.5 }, { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: 1 }])], [dummyFoe()], (b) => { b.enemies[0].st.poison = { stacks: 1 }; }).calls;
    assert.equal(calls[0].o.bonus, 0, 'the fault: kinds ignored, so the bonus is lost (the real engine gives 0.7)');
  } finally { proto.hasAny = orig.hasAny; proto.doActive = orig.doActive; }
  const real = fight(cfg, [mk('finisher', [{ k: 'hit', x: 1.5 }, { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: 1 }])], [dummyFoe()], (b) => { b.enemies[0].st.poison = { stacks: 1 }; }).calls;
  assert.ok(near(real[0].o.bonus, 0.7));
  assert.equal(classOf('finisher'), 'attacker');
});
