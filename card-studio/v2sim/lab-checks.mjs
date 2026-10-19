// lab-checks.mjs - unit checks of the Combat Lab items of 2026-10-19 (each returns { id, what, expect, got, ok }).
// lab.test.mjs runs them on the config (all must pass) and plants one fault for each mechanic (its check must fail).
import { Battle } from './engine.mjs';
import { makeCard, templatePP, blockPP } from './cards.mjs';
import { makeBoss, makeFoe, foeMoves, gauntletCfg, gauntletRun, setFoeMech, bossMechs } from './modes.mjs';
import { counterMatrix, bossKeys } from './monsters.mjs';
import { POLICIES } from './policy.mjs';
import { dummyFoe, dummyCard } from './checks.mjs';
import { patch, mean, hash } from './util.mjs';

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const C = (id, what, expect, got, ok) => ({ id, what, expect, got, ok: !!ok });
const flat = cfg => patch(cfg, { v2_hit: { roll_span: 0, roll_min: 1, miss: 0 } }); // no damage roll, no base miss
const fight = (cfg, cards, foes, o = {}) => new Battle(cfg, { cards, enemies: foes, mode: o.mode || 'dungeon', policy: POLICIES[o.policy || 'best'], seed: o.seed || 7, cap: o.cap || 1e9 });
const big = (o = {}) => dummyFoe({ maxHp: 1e6, hp: 1e6, def: 0, ...o });
const tank = (cfg, o = {}) => dummyCard(cfg, { maxHp: 1e6, hp: 1e6, ddg: 0, def: 0, ...o });
const T = {
  'lab.bowl': { role: 'artillery', name: 'area smite', blocks: [{ k: 'smite', x: 1.5 }, { k: 'area', x: 0.6 }] },
  'lab.smite': { role: 'artillery', name: 'smite', blocks: [{ k: 'smite', x: 1.5 }] },
  'lab.cure': { role: 'medic', name: 'cure', blocks: [{ k: 'cure', statuses: ['poison'], immune: 5 }, { k: 'shield', v: 0.2, to: 'cured' }] },
  'lab.stun': { role: 'controller', name: 'stun', blocks: [{ k: 'apply', status: 'stunned', chance: 1 }] },
};

export function labChecks(cfg0) {
  const out = []; const cfg = patch(cfg0, { v2_templates: T }); const F0 = flat(cfg);
  const mk = (tid, o = {}) => ({ ...makeCard(F0, { key: tid, role: T[tid].role, rarity: 'normal', template: tid }), crit: 0, abl: 1, ...o });

  // ---------- 1. support area smite (P3) ----------
  { const pp = templatePP(cfg, 'lab.bowl'), exp = cfg.v2_pp.support_pp.smite * (1.5 + 0.6 * cfg.v2_pp.ref.foes_other);
    out.push(C('area.pp', 'support area smite 150% + 60% area (synthetic): PP = smite price x (1.5 + 0.6 x 0.75), inside the 10 PP budget', +exp.toFixed(3), +pp.toFixed(3), near(pp, exp, 1e-6) && Math.abs(pp - cfg.v2_pp.budget) <= cfg.v2_pp.tolerance)); }
  { const u = mk('lab.bowl'); const b = fight(F0, [u], [big(), big(), big()]); const [a, x, y] = b.enemies; b.doActive(b.cards[0], a);
    const d = [a, x, y].map(e => e.maxHp - e.hp); const r = d[1] / d[0];
    out.push(C('area.multi', 'area smite on 3 foes: each other foe takes 60/150 of the target damage', `${(0.6 / 1.5).toFixed(3)} x2`, `${r.toFixed(3)}, ${(d[2] / d[0]).toFixed(3)}`, near(r, 0.6 / 1.5, 1e-6) && near(d[2] / d[0], 0.6 / 1.5, 1e-6))); }
  { const one = t => { const b = fight(F0, [mk(t)], [big()], { mode: 'hunt' }); b.doActive(b.cards[0], b.enemies[0]); return b.enemies[0].maxHp - b.enemies[0].hp; };
    const r = one('lab.bowl') / one('lab.smite'), exp = (1.5 + 0.6 * cfg.v2_roles.cleaver.hunt_area_x) / 1.5;
    out.push(C('area.one', 'one foe (Hunt): the area adds 20% of its value to the smite (the plan area rule, the same value as an attacker area active)', +exp.toFixed(4), +r.toFixed(4), near(r, exp, 1e-6))); }

  // ---------- 2. free cure (Revision 5) ----------
  { const p = blockPP(cfg, 'lab.cure', { k: 'cure', statuses: ['poison'], immune: 5 });
    out.push(C('cure.pp', 'the cure and its immunity cost 0 PP', 0, p, p === 0)); }
  { const m = mk('lab.cure'); const A = tank(F0), Bc = tank(F0); const b = fight(F0, [m, A, Bc], [big()]);
    const [, a, c] = b.cards; b.apply(b.enemies[0], a, 'poison', { stacks: 1 }); b.apply(b.enemies[0], a, 'weakened', { value: 0.2 }); b.apply(b.enemies[0], c, 'poison', { stacks: 1 });
    b.doActive(b.cards[0], b.enemies[0]);
    const cured = [a, c].filter(x => !x.st.poison).length, kept = !!a.st.weakened;
    out.push(C('cure.one', 'cure Poison: ONE ally loses its Poison, other statuses stay', 'cured 1, Weakened kept', `cured ${cured}, Weakened ${kept ? 'kept' : 'removed'}`, cured === 1 && kept));
    const t = !a.st.poison ? a : c; const blocked = !b.apply(b.enemies[0], t, 'poison', { stacks: 1 });
    b.step += 6; const later = b.apply(b.enemies[0], t, 'poison', { stacks: 1 });
    out.push(C('cure.immune', 'the cured ally is immune to Poison for 5 steps, then Poison lands', 'blocked, then lands', `${blocked ? 'blocked' : 'landed'}, then ${later ? 'lands' : 'blocked'}`, blocked && later));
    out.push(C('cure.shield', 'the shield (to: cured) goes to the cured ally', '> 0 on the cured ally only', `${t.shield.toFixed(1)} / ${(t === a ? c : a).shield.toFixed(1)}`, t.shield > 0 && (t === a ? c : a).shield === 0)); }

  // ---------- 3. Empower stacking (P4) ----------
  { const run = c => { const b = fight(c, [tank(c)], [big()]); const u = b.cards[0]; b.apply(null, u, 'empowered', { value: 0.3 }); b.apply(null, u, 'empowered', { value: 0.2 }); const v1 = u.st.empowered.v; b.apply(null, u, 'empowered', { value: 0.3 }); return [v1, u.st.empowered.v]; };
    const off = run(cfg), on = run(patch(cfg, { v2_status: { empowered: { stack: true } } }));
    out.push(C('empower.default', 'stack false (default): the higher Empower stays (0.3, 0.2 -> 0.3)', 'false, 0.30', `${cfg.v2_status.empowered.stack}, ${off[0].toFixed(2)}`, cfg.v2_status.empowered.stack === false && near(off[0], 0.3, 1e-9)));
    out.push(C('empower.stack', 'stack true: Empowers add up to stack_cap (0.3 + 0.2 = 0.5, + 0.3 stays 0.5)', '0.50, 0.50', `${on[0].toFixed(2)}, ${on[1].toFixed(2)}`, near(on[0], 0.5, 1e-9) && near(on[1], 0.5, 1e-9))); }

  // ---------- 4. enemies put statuses on cards (Dungeon status moves, passives, Hunt counter moves) ----------
  { const exp = { demon: ['hellfire', 'burn'], yeti: ['frost_punch', 'chill'], squid: ['squeeze', 'blinded'], skeleton: ['rattle', 'exposed'], zombie: ['infect', 'poison'], ooze: ['poison', 'poison'] };
    const got = {};
    for (const [mon, [mv, st]] of Object.entries(exp)) {
      const has = foeMoves(cfg, mon).some(([m]) => m === mv);
      const b = fight(cfg, [tank(cfg, { speedBase: 1 })], [big({ atk: 10, moves: [[mv, 1]], speedBase: 100 })], { seed: 3 }); b.enemies[0].meter = 100;
      let n = 0; while (!b.cards[0].st[st] && n++ < 4) b.tickStep();
      got[mon] = has && !!b.cards[0].st[st];
    }
    out.push(C('foe.moves', 'monster status moves: demon Burn, yeti Chill, squid Blinded, skeleton Exposed, zombie Poison + no heal, ooze Poison', 'all', Object.entries(got).filter(([, v]) => !v).map(([k]) => k).join(',') || 'all', Object.values(got).every(Boolean))); }
  { let poison = 0, burn = 0, fights = 0;
    for (let i = 0; i < 60; i++) { const rng = (() => { let s = hash('lab-foes', i) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
      const foes = [0, 1, 2].map(() => makeFoe(cfg, 4, 3, 'fight', rng)); const b = fight(cfg, ['striker', 'warden', 'medic', 'flurry', 'herald'].map((r, k) => ({ ...makeCard(cfg, { key: `lf${k}`, role: r, rarity: 'normal', stars: 2, level: 10 }) })), foes, { seed: i + 1, cap: 40 }).run();
      poison += b.S.cardStatuses.poison || 0; burn += b.S.cardStatuses.burn || 0; fights++; }
    out.push(C('foe.statuses', `${fights} floor-4 fights: Dungeon foes put Poison and Burn on cards (cures have targets)`, 'both > 0', `poison ${poison}, burn ${burn}`, poison > 0 && burn > 0)); }
  { const f = setFoeMech(dummyFoe({ moves: [['idle', 1]], own: [] }), ['plaguebearer']); const b = fight(cfg, [tank(cfg)], [f]); b.enemies[0].st.poison = { stacks: 1, until: 99 }; b.step = 1; b.endStep();
    out.push(C('foe.plaguebearer', 'Plaguebearer: a Poison tick on it puts Poison 1 on a card', 'card Poison 1', `card Poison ${b.cards[0].st.poison?.stacks || 0}`, b.cards[0].st.poison?.stacks === 1)); }
  { const b = fight(cfg, [tank(cfg)], [big({ maxHp: 1000, hp: 1000, mech: ['undying'] }), big({ maxHp: 1000, hp: 1000, mech: ['undying'] })]); const [u1, u2] = b.enemies;
    b.damage(null, u1, 5000, { tick: true }); const rev = !u1.down && near(u1.hp, 250, 1e-6); b.damage(null, u1, 5000, { tick: true }); const second = u1.down;
    u2.st.poison = { stacks: 1, until: 99 }; b.damage(null, u2, 5000, { tick: true });
    out.push(C('foe.undying', 'Undying: revives once at 25%, not twice, not when Poisoned', 'revive, falls, falls', `${rev ? 'revive' : 'no'}, ${second ? 'falls' : 'stands'}, ${u2.down ? 'falls' : 'stands'}`, rev && second && u2.down)); }
  { const vc = stun => { const b = fight(cfg, [tank(cfg), tank(cfg)], [big({ maxHp: 100, hp: 100, atk: 50, mech: ['volatile_core'] }), big()]); if (stun) b.enemies[0].st.stunned = { until: 99 }; b.damage(null, b.enemies[0], 500, { tick: true }); return b.cards.filter(c => c.hp < c.maxHp).length; };
    const a = vc(false), s = vc(true); out.push(C('foe.volatile', 'Volatile Core: on death it hits every card, unless Stunned', '2, 0', `${a}, ${s}`, a === 2 && s === 0)); }
  { const b = fight(cfg, [tank(cfg, { speedBase: 1 })], [big({ maxHp: 1000, hp: 1000, mech: ['bulwark'], moves: [['idle', 1]], speedBase: 100 })]); b.enemies[0].meter = 0;
    b.tickStep(); const s1 = b.enemies[0].shield; b.tickStep(); const s2 = b.enemies[0].shield;
    out.push(C('foe.bulwark', 'Bulwark: every 2nd action is a Guard of 20% max HP', '0, 200', `${s1}, ${s2}`, s1 === 0 && near(s2, 200, 1e-6))); }
  { const b = fight(cfg, [tank(cfg)], [big({ mech: ['pack'] }), big(), big()]); const m = b.enemyMult(b.enemies[0]);
    out.push(C('foe.pack', 'Pack: +5% ATK per living foe (3 foes = x1.15)', 1.15, +m.toFixed(4), near(m, 1.15, 1e-9))); }
  { const boss = { ...makeBoss(cfg, 'Heroic', { boss: 'nightshade', startFrac: 1 }), counterShare: 1, moves2: [{ id: 'nightshade', k: 'hit', x: 1, tgt: 'random', apply: { status: 'poison', stacks: 1 } }] };
    const bb = fight(cfg, [tank(cfg, { speedBase: 1 })], [boss], { mode: 'hunt' }); bb.enemies[0].meter = 100; bb.enemies[0].turn = 1; let n = 0; while (!bb.cards[0].st.poison && n++ < 3) bb.tickStep();
    out.push(C('boss.statuses', 'Hunt counter move (Ranked Nightshade, Nightshade): Poison 1 on the hit card', 'card Poison', bb.cards[0].st.poison ? 'card Poison' : 'none', !!bb.cards[0].st.poison)); }

  // ---------- 5. Auto holds control for the Charging turn (switch) ----------
  { const use = (c, charging) => { const b = fight(c, [{ ...mk('lab.stun'), charge: 9 }], [big()], { mode: 'hunt', policy: 'auto' }); const u = b.cards[0]; u.charge = 9; b.enemies[0].charging = charging; b.step = 5; return POLICIES.auto.useActive(b, u); };
    const on = patch(cfg, { v2_auto: { hold_control_for_charging: true } });
    const r = [use(cfg, false), use(on, false), use(on, true)];
    out.push(C('auto.hold', 'Auto: OFF uses a ready Stun at once; ON holds it until the boss is Charging', 'use, hold, use', r.map(x => (x ? 'use' : 'hold')).join(', '), r[0] && !r[1] && r[2])); }

  // ---------- 6. the monsters ----------
  { const bk = 'skeleton', B = makeBoss(cfg, 'Heroic', { boss: bk }), exp = cfg.v2_enemy.hunt.Heroic.hp * cfg.v2_enemy.asc3_hp_x * cfg.v2_bosses[bk].hp_factor;
    out.push(C('boss.hp', 'boss HP = tier HP x ASC-3 factor x boss hp_factor', +exp.toFixed(1), +B.maxHp.toFixed(1), near(B.maxHp, exp, 1e-6))); }
  { const ok = bossKeys(cfg).length === 16 && bossKeys(cfg).every(k => { const N = bossMechs(cfg, k, 'Mythic'); return N.mech.length >= 1 && (cfg.v2_bosses[k].moves || []).length >= 3; });
    out.push(C('boss.roster', '16 named bosses, each with a rule and at least 3 counter moves', 16, bossKeys(cfg).length, ok)); }
  { const b = fight(cfg, [tank(cfg)], [makeBoss(cfg, 'Heroic', { boss: 'warlord', startFrac: 1 })], { mode: 'hunt' }); const w = b.enemies[0];
    const r = b.apply(b.cards[0], w, 'exposed', { value: 0.2 }); const tilt = !!w.st.enraged;
    const bm = fight(cfg, [tank(cfg)], [makeBoss(cfg, 'Mythic', { boss: 'warlord', startFrac: 1 })], { mode: 'hunt' }); bm.apply(bm.cards[0], bm.enemies[0], 'exposed', { value: 0.2 });
    out.push(C('boss.resists', 'Resists: Exposed on the Warlord is blocked; Tilt (Mythic only) Enrages it', 'blocked, Heroic calm, Mythic Enraged', `${r ? 'landed' : 'blocked'}, Heroic ${tilt ? 'Enraged' : 'calm'}, Mythic ${bm.enemies[0].st.enraged ? 'Enraged' : 'calm'}`, !r && !tilt && !!bm.enemies[0].st.enraged)); }
  { const b = fight(cfg, [tank(cfg)], [makeBoss(cfg, 'Heroic', { sigs: ['regrowth'], startFrac: 0.3 })], { mode: 'hunt' }), d = fight(cfg, [tank(cfg)], [big({ maxHp: 1000, hp: 300, mech: ['regrowth'] })]);
    const bo = b.enemies[0], fo = d.enemies[0]; const h0 = bo.hp, f0 = fo.hp; b.step = 1; b.endStep(); d.step = 1; d.endStep(); const hb = bo.hp - h0, hf = fo.hp - f0;
    out.push(C('regrowth', 'Regrowth: Hunt boss 0.4% of 3,000 a step (12) and no x2 below half; foe 1% of its max HP', '12, 10', `${hb.toFixed(2)}, ${hf.toFixed(2)}`, near(hb, 12, 1e-6) && near(hf, 10, 1e-6))); }
  { const dmg = (bk, tid) => { const e = bk ? makeBoss(cfg, 'Heroic', { boss: bk, startFrac: 1 }) : big(); e.def = 0; e.evasion = 0; const b = fight(F0, [mk(tid)], [e], { mode: 'hunt' }); const h0 = b.enemies[0].hp; b.doActive(b.cards[0], b.enemies[0]); return h0 - b.enemies[0].hp; };
    const r = dmg('netcode', 'lab.smite') / dmg(null, 'lab.smite');
    out.push(C('boss.rollback', 'Rollback (Netcode Mutant): smites on it deal 50%', 0.5, +r.toFixed(4), near(r, 0.5, 1e-6))); }
  { const healed = bk => { const b = fight(cfg, [tank(cfg, { hp: 1000, maxHp: 2000 })], [bk ? makeBoss(cfg, 'Heroic', { boss: bk, startFrac: 1 }) : big()], { mode: 'hunt' }); return b.heal(b.cards[0], 100); };
    const r = healed('vampire') / healed(null); out.push(C('boss.bloodrot', 'Bloodrot (Grind Vampire): card heals work at 60% while it stands (approved 2026-10-19, was 40%)', 0.6, +r.toFixed(4), near(r, 0.6, 1e-9))); }
  { const sh = bk => { const b = fight(cfg, [tank(cfg)], [bk ? makeBoss(cfg, 'Heroic', { boss: bk, startFrac: 1 }) : big()], { mode: 'hunt' }); b.addShield(b.cards[0], 100); return b.cards[0].shield; };
    const r = sh('smurf') / sh(null); out.push(C('boss.brittle', 'Smurf Brute: card shields work at 40% while it stands', 0.4, +r.toFixed(4), near(r, 0.4, 1e-9))); }
  { const sp = bk => { const b = fight(cfg, [tank(cfg)], [bk ? makeBoss(cfg, 'Heroic', { boss: bk, startFrac: 1 }) : big()], { mode: 'hunt' }); b.apply(null, b.cards[0], 'quickened', {}); return b.speedOf(b.cards[0]) / b.cards[0].speedBase; };
    const a = sp(null), t = sp('banwave'); out.push(C('boss.time_lock', 'Time Lock (Ban-Wave Demon): Quickened does nothing while it stands', `x${cfg.v2_status.quickened.x}, x1`, `x${a.toFixed(2)}, x${t.toFixed(2)}`, near(a, cfg.v2_status.quickened.x, 1e-6) && near(t, 1, 1e-6))); }
  { const e = setFoeMech(big({ moves: [['idle', 1]] }), ['mirror_hide']); const b = fight(F0, [mk('lab.smite')], [e]); const u = b.cards[0];
    const x = b.cardHit(u, b.enemies[0], { x: 0.5, kind: 'extra' }).dealt, s = b.cardHit(u, b.enemies[0], { x: 0.6, kind: 'splash' }).dealt, n = b.cardHit(u, b.enemies[0], { x: 1 }).dealt;
    out.push(C('boss.mirror_hide', 'Mirror Hide: second strikes and splash on it deal 0, a normal hit lands', '0, 0, > 0', `${x}, ${s}, ${n.toFixed(1)}`, x === 0 && s === 0 && n > 0)); }
  { const sk = makeBoss(cfg, 'Heroic', { boss: 'skeleton' }), ns = makeBoss(cfg, 'Heroic', { boss: 'nightshade' }); const b = fight(cfg, [tank(cfg)], [sk, ns], { mode: 'hunt' });
    out.push(C('boss.stats', 'Plated: Defense 50%. Fade: Evasion +30%', '0.50, +0.30', `${b.enemies[0].def}, +${(b.enemies[1].evasion - cfg.v2_enemy.hunt.Heroic.evasion).toFixed(2)}`, b.enemies[0].def === 0.5 && near(b.enemies[1].evasion - cfg.v2_enemy.hunt.Heroic.evasion, 0.3, 1e-9))); }
  { const z = makeBoss(cfg, 'Heroic', { boss: 'zerg', startFrac: 1 }); z.def = 0; const b = fight(F0, [mk('lab.smite')], [z], { mode: 'hunt' }); const q = b.enemies[0];
    const h0 = q.hp; b.damage(null, q, 100, { tick: true }); const d = h0 - q.hp; const st0 = q.brood; b.damage({ role: 'cleaver', side: 'card', idx: 0 }, q, 10);
    out.push(C('boss.brood', 'Brood (Zerg-Rush Queen): 5 stacks take 30% less; a Cleaver hit removes 1', '70, 5 -> 4', `${d.toFixed(1)}, ${st0} -> ${q.brood}`, near(d, 70, 1e-6) && st0 === 5 && q.brood === 4)); }
  { const b = fight(cfg, [tank(cfg)], [makeBoss(cfg, 'Heroic', { boss: 'frost_lich', startFrac: 1 })], { mode: 'hunt' }); const r = b.apply(b.cards[0], b.enemies[0], 'chill', { stacks: 1 });
    out.push(C('boss.permafrost_heart', 'Permafrost Heart (Frame-Freeze Lich): a Chill on it is blocked and comes back to the card', 'blocked, card Chill 1', `${r ? 'landed' : 'blocked'}, card Chill ${b.cards[0].st.chill?.stacks || 0}`, !r && b.cards[0].st.chill?.stacks === 1)); }
  { const b = fight(cfg, [tank(cfg, { hp: 1000, maxHp: 2000 })], [makeBoss(cfg, 'Mythic', { boss: 'vampire', startFrac: 0.5 })], { mode: 'hunt' }); const v = b.enemies[0]; b.step = 1;
    b.heal(b.cards[0], 100); const hv = v.hp; b.endStep(); const reg = cfg.v2_enemy.boss_heal_ref * cfg.v2_enemy.mechanics.regrowth.boss_heal, gain = v.hp - hv - reg;
    out.push(C('boss.siphon', 'Siphon (Mythic Grind Vampire): it heals what the squad healed in the step (60 after Bloodrot)', 60, +gain.toFixed(3), near(gain, 60, 1e-6))); }
  { const run = mech => { const e = big({ atk: 100, mech }); const b = fight(F0, [tank(F0)], [e]); b.cards[0].shield = 30; const h0 = b.cards[0].hp; b.enemyHit(b.enemies[0], b.cards[0], 0.2); return h0 - b.cards[0].hp; };
    const a = run([]), c = run(['crush']); out.push(C('boss.crush', 'Crush: the hit card also takes 50% of the shield the hit removed', '0, 10', `${a.toFixed(1)}, ${c.toFixed(1)}`, near(a, 0, 1e-6) && near(c, 10, 1e-6))); }
  { const hit = (role, weak) => { const e = big(); e.weakRole = weak; const b = fight(F0, [{ ...dummyCard(F0, { role }), role, crit: 0, acc: 1 }], [e]); return b.cardHit(b.cards[0], b.enemies[0], { x: 1, trueStrike: true }).dealt; };
    const r = hit('spotter', 'spotter') / hit('spotter', null), o = hit('spotter', 'herald') / hit('spotter', null);
    out.push(C('boss.weak_role', '"Weak to: role" week: that role deals +30%, the other roles do not', '1.30, 1.00', `${r.toFixed(3)}, ${o.toFixed(3)}`, near(r, 1.3, 1e-6) && near(o, 1, 1e-6))); }
  { const skips = weak => { const boss = { ...makeBoss(cfg, 'Heroic', { boss: undefined, sigs: [], startFrac: 1, weakRole: weak }), resolve: 0 }; const b = fight(cfg, [{ ...tank(cfg, { role: 'controller', speedBase: 1 }), role: 'controller' }], [boss], { mode: 'hunt' });
      const e = b.enemies[0]; e.meter = 0; b.apply(b.cards[0], e, 'stunned'); for (let i = 0; i < 4; i++) b.tickStep(); return b.S.controlSkips; };
    const hit = weak => { const e = big(); e.weakRole = weak; const b = fight(F0, [{ ...dummyCard(F0, { role: 'controller' }), role: 'controller', crit: 0 }], [e]); return b.cardHit(b.cards[0], b.enemies[0], { x: 1, trueStrike: true }).dealt; };
    const s0 = skips(null), s1 = skips('controller'), dmg = hit('controller') / hit(null);
    out.push(C('boss.weak_controller', 'a Controller week boosts control, not damage: a Stun skips 2 boss actions (1 normally), Controller hits x1.00', '1, 2, 1.00', `${s0}, ${s1}, ${dmg.toFixed(2)}`, s0 === 1 && s1 === 2 && near(dmg, 1, 1e-9))); }
  { const B = cfg.v2_bosses, mv = (b, id) => (B[b].moves || []).find(m => m.id === id);
    const got = { hydra_regrow: mv('hydra', 'regrow')?.v, hydra_regrowth: B.hydra.params?.regrowth?.boss_heal, netcode_heal_move: !!mv('netcode', 'rollback'), vampire_cut: mv('vampire', 'bloodrot')?.heal_cut, warzombie_infect: mv('warzombie', 'infect')?.heal_cut?.dur, warzombie_echo: mv('warzombie', 'undying')?.v };
    const ok = got.hydra_regrow === 0.015 && got.hydra_regrowth === 0.004 && !got.netcode_heal_move && got.vampire_cut?.x === 0.4 && got.vampire_cut?.dur === 4 && got.warzombie_infect === 4 && got.warzombie_echo === 0.1;
    out.push(C('boss.cap_numbers', 'the approved counter-cap numbers: Hydra Regrow 1.5% + Regrowth 0.4%, Netcode without its Rollback heal, Vampire cut 40%/4, Warzombie no-heal 4 + echo 10%', 'all', ok ? 'all' : JSON.stringify(got), ok)); }
  { let bad = 0, err = '', used = new Set(); const all = new Set(bossKeys(cfg).flatMap(k => cfg.v2_bosses[k].moves.map(m => `${k}.${m.id}`)));
    for (const k of bossKeys(cfg)) for (const tier of ['Heroic', 'Mythic']) for (let s = 1; s <= 6; s++) {
      const roles = ['striker', 'warden', 'medic', 'controller', 'artillery', 'herald', 'cleaver', 'flurry'];
      const cards = roles.map((r, i) => makeCard(cfg, { key: `fz${i}`, role: r, rarity: 'normal', stars: 2, level: 10 }));
      const boss = { ...makeBoss(cfg, tier, { boss: k, seed: s, startFrac: 0.6 }), counterShare: 0.9 };
      const b = fight(cfg, cards, [boss], { mode: 'hunt', seed: s, cap: 40 });
      try { while (!b.ended) { b.tickStep(); for (const u of b.units) if (!(u.hp >= 0 && u.hp <= u.maxHp + 1e-6 && u.shield >= 0 && Number.isFinite(u.hp) && Number.isFinite(u.meter))) bad++; } } catch (e) { bad++; err ||= `${k}: ${e.message}`; }
      for (const id of Object.keys(b.S.counterMoves)) used.add(`${k}.${id}`);
    }
    const miss = [...all].filter(x => !used.has(x));
    out.push(C('boss.moves', 'every counter move of the 16 bosses runs (Heroic and Mythic, 40 steps): no error, HP in [0, max], every move used', '0 bad, 0 unused', `${bad} bad${err ? ` (${err})` : ''}, ${miss.length} unused${miss.length ? ` (${miss.slice(0, 3).join(', ')})` : ''}`, bad === 0 && !miss.length)); }
  { const f = makeFoe(cfg, 5, 5, 'guardian', (() => { let s = 9; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })());
    const b = fight(cfg, [tank(cfg, { speedBase: 1 })], [setFoeMech(f, [])], { cap: 60 }); let ch = 0; while (!b.ended) { b.tickStep(); if (b.enemies[0].charging) ch++; }
    out.push(C('dungeon.cataclysm', 'a Dungeon guardian charges and makes its Cataclysm (the foe flag was overwritten before 2026-10-19)', '> 0, > 0', `${ch}, ${b.S.cataclysms}`, ch > 0 && b.S.cataclysms > 0)); }
  { const G = gauntletCfg(cfg), D = G.v2_dungeon, g = cfg.v2_gauntlet;
    const ok = near(D.hp_x, cfg.v2_dungeon.hp_x * g.foe_x.hp, 1e-9) && near(D.atk_x, cfg.v2_dungeon.atk_x * g.foe_x.atk, 1e-9) && D.growth.hp === g.growth.hp && D.growth.atk === g.growth.atk && D.rest_heal === g.rest_heal && D.choice_heal === g.choice_heal && D.room_weights.rest === g.room_weights.rest && g.floors === 10;
    out.push(C('gauntlet.cfg', 'Gauntlet: foes x0.4, growth x1.15 / x1.07, rest 80% / revive 50%, choice 60%, rest and choice weight 20, 10 floors', 'all', ok ? 'all' : JSON.stringify({ hp_x: D.hp_x, growth: D.growth, rest: D.rest_heal, floors: g.floors }), ok));
    const specs = ['striker', 'breaker', 'flurry', 'warden', 'medic'].map((r, i) => ({ key: `g${i}`, role: r, rarity: 'normal' }));
    const fl = mean(Array.from({ length: 30 }, (_, i) => gauntletRun(cfg, specs, {}, { seed: hash('lab-g', i) }).floor));
    out.push(C('gauntlet.depth', 'a 0-star weekly squad reaches floor 4+ on average (the Dungeon foes gave about 1.2)', '>= 4', +fl.toFixed(2), fl >= 4)); }
  { const teams = ['t0', 't1', 't2', 't3'], O = { neutral: {}, b1: {} };
    for (const t of teams) { O.neutral[t] = { 'hunt|casual': 100, 'hunt|active': 100, 'guard|casual': 1, 'guard|active': 1 }; O.b1[t] = { ...O.neutral[t] }; }
    O.b1.t0 = { 'hunt|casual': 60, 'hunt|active': 60, 'guard|casual': 1, 'guard|active': 1 };
    const capMin = cfg.v2_enemy.counter_cut_min, h = counterMatrix(O, { bosses: ['b1'], teams, capMin }), m = counterMatrix(O, { bosses: ['b1'], teams, capMin, mythic: true });
    const cap = c => c.checks.find(x => x.id === 'cap').ok;
    out.push(C('counter.cap', 'counter cap check: a Heroic cut x0.60 FAILS, the same cut at Mythic is allowed', 'FAIL, PASS', `${cap(h) ? 'PASS' : 'FAIL'}, ${cap(m) ? 'PASS' : 'FAIL'}`, !cap(h) && cap(m))); }

  // ---------- 7. Flurry ----------
  { const f = cfg.v2_roles.flurry, pc = `${Math.round(f.extra_chance * 100)}%`;
    out.push(C('flurry.text', 'the Flurry passive text shows the configured chance', pc, f.text.match(/\d+%/)?.[0], f.text.includes(`${pc} chance`))); }
  return out;
}
