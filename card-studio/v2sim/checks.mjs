// checks.mjs - invariant and sanity checks of the formulas, the turn meter and the statuses.
// Used by the unit tests (node --test) and by experiment 6 (statuses). Each check returns { id, what, expect, got, ok }.
import { Battle, CONTROL } from './engine.mjs';
import { F } from './formulas.mjs';
import { makeCard, templatePP, templatesOf, ROLES, minShareErrors } from './cards.mjs';
import { POLICIES } from './policy.mjs';
import { mkRng, mean } from './util.mjs';

export const dummyFoe = (o = {}) => ({ key: 'dummy', name: 'dummy', maxHp: 1e6, hp: 1e6, atk: 10, def: 0, evasion: 0, resolve: 0, keen: 0, speedBase: 100, spdMult: 1, moves: [['idle', 1]], mech: [], ...o });
export const dummyCard = (cfg, o = {}) => ({ ...makeCard(cfg, { key: 'probe', role: o.role || 'flurry', rarity: 'normal', stars: 2, level: 0 }), ...o });
export const mini = (cfg, cards, foes, o = {}) => new Battle(cfg, { cards, enemies: foes, mode: o.mode || 'dungeon', policy: POLICIES[o.policy || 'auto'], seed: o.seed || 7, cap: o.cap || 1e9 });
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const C = (id, what, expect, got, ok) => ({ id, what, expect, got, ok: !!ok });

export function formulaChecks(cfg) {
  const out = [];
  const asc = [['normal', 0, 25], ['normal', 5, 75], ['gold', 0, 149.333], ['gold', 5, 224], ['illustrated_rare', 3, 40 * (1 + 2.5 * 0.678)], ['promo', 2, 50], ['event', 5, 187.5]];
  for (const [r, s, v] of asc) { const g = F.ascCp(cfg, r, s); out.push(C(`asc.${r}.${s}`, `ASC-3 CP of ${r} ${s}*`, v, g, near(g, v, 0.01))); }
  const st = F.stats(cfg, 50, { atk: 10, hp: 10, def: 12, crt: 10, crd: 10, abl: 10, ddg: 10, acc: 10, spd: 10 });
  out.push(C('stat.atk', 'flat Attack: +3 CP a point (10 points)', 80, st.cp, near(st.cp, 80, 1e-9)));
  out.push(C('stat.hp', 'HP = 50 + 1.5 x CP_base + 8 a point', 50 + 75 + 80, st.maxHp, near(st.maxHp, 205, 1e-9)));
  out.push(C('stat.def', 'Defense 3% a point, cap 30%', 0.30, st.def, near(st.def, 0.30, 1e-9)));
  out.push(C('stat.crt', 'crit 10% + 4% a point', 0.50, st.crit, near(st.crit, 0.50, 1e-9)));
  out.push(C('stat.crd', 'crit damage 2.0 + 0.1 a point', 3.0, st.critx, near(st.critx, 3.0, 1e-9)));
  out.push(C('stat.ddg', 'Dodge 3% a point, cap 30%', 0.30, st.ddg, near(st.ddg, 0.30, 1e-9)));
  out.push(C('stat.spd', 'Speed +3% a point', 1.30, st.spdMult, near(st.spdMult, 1.30, 1e-9)));
  out.push(C('def.apply', 'damage after Defense 30% (no pierce) = 70%', 70, F.afterDefense(100, 0.3, 0), near(F.afterDefense(100, 0.3, 0), 70, 1e-9)));
  out.push(C('def.pierce', 'Pierce 100% ignores Defense', 100, F.afterDefense(100, 0.3, 1), near(F.afterDefense(100, 0.3, 1), 100, 1e-9)));
  out.push(C('def.pierce30', 'Breaker pierce 30% vs Defense 20% = 86%', 86, F.afterDefense(100, 0.2, 0.3), near(F.afterDefense(100, 0.2, 0.3), 86, 1e-9)));
  const c0 = F.converge({ ...cfg, v2_level: { ...cfg.v2_level, converge_d: 0 } }, 25, 30), c1 = F.converge({ ...cfg, v2_level: { ...cfg.v2_level, converge_d: 1 } }, 25, 30);
  out.push(C('converge.off', 'D = 0 keeps CP', 25, c0, near(c0, 25, 1e-9)));
  out.push(C('converge.full', 'D = 1 at max level reaches the target', cfg.v2_level.target_cp, c1, near(c1, cfg.v2_level.target_cp, 1e-9)));
  out.push(C('level.points', 'level 30 = 30 points', 30, F.levelPoints(cfg, 30), F.levelPoints(cfg, 30) === 30));
  const P = F.poisonTick(cfg, 2, 1000); out.push(C('poison.tick', 'Poison tick = stacks x 2% x ref HP', 40, P, near(P, 40, 1e-9)));
  const Bt = F.burnTick(cfg, 3, 1000); out.push(C('burn.tick', 'Burn tick = stacks x 1.5 x Poison tick', 90, Bt, near(Bt, 90, 1e-9)));
  for (const role of ROLES) for (const t of templatesOf(cfg, role)) { const pp = templatePP(cfg, t); const low = minShareErrors(cfg, cfg.v2_templates[t].blocks).length;
    out.push(C(`pp.${t}`, `${t} costs the 10 PP budget and has no condition below limits.min_share`, cfg.v2_pp.budget, +pp.toFixed(2), Math.abs(pp - cfg.v2_pp.budget) <= cfg.v2_pp.tolerance && low === 0)); }
  return out;
}

export function meterChecks(cfg) {
  const out = [];
  for (const sp of [100, 50, 200, 17, 140]) {
    const b = mini(cfg, [dummyCard(cfg, { speedBase: 1 })], [dummyFoe({ speedBase: sp })], { cap: 60 }); b.run();
    const exp = sp * 60 / 100; out.push(C(`meter.${sp}`, `speed ${sp}: actions in 60 steps`, exp, b.enemies[0].turn, Math.abs(b.enemies[0].turn - exp) <= 1));
  }
  // relative rate of two units: actions follow the speed ratio
  const b = mini(cfg, [dummyCard(cfg, { speedBase: 17 }), dummyCard(cfg, { speedBase: 40 })], [dummyFoe()], { cap: 300 }); b.run();
  const r = b.cards[1].turn / b.cards[0].turn; out.push(C('meter.ratio', 'action ratio = speed ratio 40/17', 40 / 17, +r.toFixed(3), near(r, 40 / 17, 0.05)));
  for (const [s, x] of [['slowed', cfg.v2_status.slowed.x], ['quickened', cfg.v2_status.quickened.x]]) {
    const bb = mini(cfg, [dummyCard(cfg, { speedBase: 1 })], [dummyFoe()], { cap: 100 });
    while (!bb.ended) { bb.apply(null, bb.enemies[0], s, {}); bb.tickStep(); }
    const exp = 100 * x; out.push(C(`meter.${s}`, `${s} (x${x}) for 100 steps`, exp, bb.enemies[0].turn, Math.abs(bb.enemies[0].turn - exp) <= 1.5));
  }
  const bc = mini(cfg, [dummyCard(cfg, { speedBase: 1 })], [dummyFoe({ mech: ['frostborn'] })], { cap: 100 });
  bc.enemies[0].mech.delete('frostborn');
  while (!bc.ended) { bc.enemies[0].st.chill = { stacks: 2, until: bc.step + 5 }; bc.tickStep(); }
  const expC = 100 * (1 - 2 * cfg.v2_status.chill.spd); out.push(C('meter.chill', 'Chill 2 slows by 2 x 8%', expC, bc.enemies[0].turn, Math.abs(bc.enemies[0].turn - expC) <= 1.5));
  const cap = F.effSpeed(cfg, 100, 5, 1); out.push(C('speed.cap', 'Speed from points is capped (safety cap)', 100 * cfg.v2_speed.safety_max_x, cap, near(cap, 100 * cfg.v2_speed.safety_max_x, 1e-9)));
  return out;
}

export function statusChecks(cfg, n = 4000) {
  const out = []; const S = cfg.v2_status;
  // Poison and the Toxic burst
  { const b = mini(cfg, [dummyCard(cfg)], [dummyFoe({ maxHp: 1000, hp: 1000, speedBase: 1 })]); const e = b.enemies[0];
    b.apply(b.cards[0], e, 'poison', { stacks: 2 }); b.step = 1; const h0 = e.hp; b.endStep(); const t = h0 - e.hp;
    out.push(C('poison.tick', 'Poison 2 ticks 2 x 2% x 1000 at the end of the step', 40, +t.toFixed(2), near(t, 40, 1e-6)));
    const h1 = e.hp; b.apply(b.cards[0], e, 'poison', { stacks: 1 }); const burst = h1 - e.hp;
    out.push(C('poison.burst', 'the 3rd stack makes a Toxic burst (12% ref HP), then Poison resets', `120, stacks 0`, `${+burst.toFixed(2)}, stacks ${e.st.poison?.stacks || 0}`, near(burst, 120, 1e-6) && !e.st.poison)); }
  // Burn: tick, decay, anti-heal, more vs healers
  { const b = mini(cfg, [dummyCard(cfg)], [dummyFoe({ maxHp: 1000, hp: 500, speedBase: 1 }), dummyFoe({ maxHp: 1000, hp: 500, speedBase: 1, healer: true })]);
    const [e, h] = b.enemies; b.apply(null, e, 'burn', { stacks: 3 }); b.apply(null, h, 'burn', { stacks: 3 }); b.step = 1;
    const a0 = e.hp, b0 = h.hp; b.endStep(); const te = a0 - e.hp, th = b0 - h.hp;
    out.push(C('burn.tick', 'Burn 3 ticks 3 x 1.5 x 2% x 1000, then decays to 2', '90, 2 stacks', `${+te.toFixed(2)}, ${e.st.burn?.stacks} stacks`, near(te, 90, 1e-6) && e.st.burn?.stacks === 2));
    out.push(C('burn.healer', 'Burn deals x1.5 to a healing enemy', 135, +th.toFixed(2), near(th, 135, 1e-6)));
    const hh = b.heal(e, 100); out.push(C('burn.antiheal', 'a Burning unit heals half', 50, hh, near(hh, 50, 1e-9))); }
  // Stun: skip the next action, then the family immunity
  { const b = mini(cfg, [dummyCard(cfg, { speedBase: 1 })], [dummyFoe()], { cap: 40 }); const e = b.enemies[0]; const c = b.cards[0];
    b.apply(c, e, 'stunned'); b.tickStep(); const skipped = b.S.controlSkips;
    const again = b.apply(c, e, 'stunned'); const asleep = b.apply(c, e, 'sleep');
    for (let i = 0; i < cfg.v2_control.immune + 1; i++) b.tickStep(); const later = b.apply(c, e, 'stunned');
    out.push(C('stun.skip', 'a Stunned enemy skips its next action', 1, skipped, skipped === 1));
    out.push(C('control.immune', 'after a control status ends, Stun and Sleep fail during the immunity, then land', 'fail, fail, land', `${again ? 'land' : 'fail'}, ${asleep ? 'land' : 'fail'}, ${later ? 'land' : 'fail'}`, !again && !asleep && later)); }
  // Chill 3 = Frozen (shares the control immunity)
  { const b = mini(cfg, [dummyCard(cfg, { speedBase: 1 })], [dummyFoe()], { cap: 40 }); const e = b.enemies[0];
    b.apply(null, e, 'chill', { stacks: 2 }); const f1 = !!e.st.frozen; b.apply(null, e, 'chill', { stacks: 1 }); const f2 = !!e.st.frozen && !e.st.chill;
    b.tickStep(); const stun = b.apply(b.cards[0], e, 'stunned');
    out.push(C('chill.frozen', 'Chill 2 is not Frozen; the 3rd stack Freezes and clears Chill; then Stun fails (one immunity)', 'no, yes, fail', `${f1 ? 'yes' : 'no'}, ${f2 ? 'yes' : 'no'}, ${stun ? 'land' : 'fail'}`, !f1 && f2 && !stun)); }
  // Sleep wakes on damage
  { const b = mini(cfg, [dummyCard(cfg, { speedBase: 1 })], [dummyFoe()], { cap: 40 }); const e = b.enemies[0];
    b.apply(b.cards[0], e, 'sleep'); b.tickStep(); const s1 = b.S.controlSkips; b.damage(b.cards[0], e, 10); const awake = !e.st.sleep;
    out.push(C('sleep.wake', 'Sleep skips actions until the unit takes damage', 'skip 1, awake', `skip ${s1}, ${awake ? 'awake' : 'asleep'}`, s1 === 1 && awake)); }
  // Paralyzed: 50% fail
  { let fails = 0, acts = 0; for (let i = 0; i < n / 10; i++) { const b = mini(cfg, [dummyCard(cfg, { speedBase: 1 })], [dummyFoe()], { cap: 1e9, seed: 100 + i }); const e = b.enemies[0];
      b.apply(b.cards[0], e, 'paralyzed'); const until = e.st.paralyzed.until; while (b.step < until) { b.tickStep(); } acts += e.turn; fails += b.S.paraFail; }
    const r = fails / acts; out.push(C('paralyzed.fail', 'Paralyzed: each action fails 50%', 0.5, +r.toFixed(3), near(r, 0.5, 0.06))); }
  // Control cannot lock the Hunt boss: stun every step, skipped share <= 1 / (1 + boss_immune)
  { const b = mini(cfg, [dummyCard(cfg, { speedBase: 1, maxHp: 1e9, hp: 1e9 })], [dummyFoe()], { mode: 'hunt', cap: 400 }); const e = b.enemies[0];
    while (!b.ended) { for (const s of CONTROL) b.apply(b.cards[0], e, s); b.tickStep(); }
    const share = b.S.controlSkips / e.turn; const bound = 1 / (1 + cfg.v2_control.boss_immune);
    out.push(C('control.nolock', 'all 4 controls every step on the Hunt boss: skipped share <= 1 / (1 + boss immunity)', `<= ${bound.toFixed(3)}`, +share.toFixed(3), share <= bound + 0.02)); }
  { const b = mini(cfg, [dummyCard(cfg, { speedBase: 1 })], [dummyFoe()], { cap: 400 }); const e = b.enemies[0];
    while (!b.ended) { for (const s of CONTROL) b.apply(b.cards[0], e, s); b.tickStep(); }
    const share = b.S.controlSkips / e.turn;
    out.push(C('control.nolock.foe', 'all 4 controls every step on a foe: it still acts (no permanent lock)', '< 0.7', +share.toFixed(3), share < 0.7)); }
  // hit-level statuses (many hits with a fixed seed)
  const hits = (setup, o = {}, k = n) => { const b = mini(cfg, [dummyCard(cfg, { crit: 0, ...o.card })], [dummyFoe(o.foe)], { seed: o.seed || 11 }); const c = b.cards[0], e = b.enemies[0];
    let d = 0, landed = 0, crits = 0; for (let i = 0; i < k; i++) { setup(b, c, e); const r = b.cardHit(c, e, { x: 1, ...o.hit }); d += r.dealt; if (!r.miss) landed++; if (r.crit) crits++; b.consumeMark(e); delete c.st.empowered; }
    return { mean: d / k, landed: landed / k, crits: landed ? crits / landed : 0 }; };
  const base = hits(() => {});
  const exp = hits((b, c, e) => { e.st.exposed = { v: 0.3, until: 1e9 }; });
  out.push(C('exposed', 'Exposed 30%: +30% damage taken', 1.3, +(exp.mean / base.mean).toFixed(3), near(exp.mean / base.mean, 1.3, 0.03)));
  const wk = hits((b, c) => { c.st.weakened = { v: 0.3, until: 1e9 }; });
  out.push(C('weakened', 'Weakened 30%: deals 30% less', 0.7, +(wk.mean / base.mean).toFixed(3), near(wk.mean / base.mean, 0.7, 0.03)));
  const emp = hits((b, c) => { c.st.empowered = { v: 0.5 }; });
  out.push(C('empowered', 'Empowered 50%: the next attack +50%', 1.5, +(emp.mean / base.mean).toFixed(3), near(emp.mean / base.mean, 1.5, 0.03)));
  const ev = hits(() => {}, { foe: { evasion: 0.22 } }); const mk = hits((b, c, e) => b.apply(c, e, 'mark', { value: 0.3 }), { foe: { evasion: 0.22 } });
  out.push(C('mark', 'Mark 30%: the hit cannot miss and deals +30% (vs 30% total miss)', 'landed 1.00, x1.30 of an unmarked landed hit', `landed ${mk.landed.toFixed(2)}, x${(mk.mean / (ev.mean / ev.landed)).toFixed(3)}`, mk.landed === 1 && near(mk.mean / (ev.mean / ev.landed), 1.3, 0.04)));
  out.push(C('miss.base', 'base miss 8% + evasion 22% = 30%', 0.70, +ev.landed.toFixed(3), near(ev.landed, 0.70, 0.025)));
  const acc = hits(() => {}, { card: { acc: 0.08 } }); out.push(C('accuracy', 'Accuracy 0.08 (4 points) removes the base miss of 8%', 1.0, acc.landed, acc.landed === 1));
  const bl = hits((b, c) => { c.st.blinded = { v: 1, until: 1e9 }; }); out.push(C('blinded', 'Blinded: +25% miss (8% + 25%)', 0.67, +bl.landed.toFixed(3), near(bl.landed, 0.67, 0.025)));
  const ts = hits(() => {}, { foe: { evasion: 0.3 }, hit: { trueStrike: true } }); out.push(C('true_strike', 'True strike never misses (30% evasion)', 1.0, ts.landed, ts.landed === 1));
  const dfn = hits(() => {}, { foe: { def: 0.3 } }); const pr = hits(() => {}, { foe: { def: 0.3 }, hit: { pierce: 1 } });
  out.push(C('defense', 'enemy Defense 30%: 70% damage. Pierce 100%: full damage', '0.70, 1.00', `${(dfn.mean / base.mean).toFixed(3)}, ${(pr.mean / base.mean).toFixed(3)}`, near(dfn.mean / base.mean, 0.7, 0.03) && near(pr.mean / base.mean, 1.0, 0.03)));
  const cr = hits(() => {}, { card: { crit: 0.5 } }); const ih = hits(() => {}, { card: { crit: 0.5 }, foe: { mech: ['ironhide'] } }); const ihm = hits((b, c, e) => b.apply(c, e, 'mark', { value: 0.0001 }), { card: { crit: 0.5 }, foe: { mech: ['ironhide'] } });
  out.push(C('ironhide', 'Ironhide: no crit, unless Marked (crits per landed hit)', '0.50, 0.00, 0.50', `${cr.crits.toFixed(2)}, ${ih.crits.toFixed(2)}, ${ihm.crits.toFixed(2)}`, near(cr.crits, 0.5, 0.03) && ih.crits === 0 && near(ihm.crits, 0.5, 0.03)));
  // enemy side: dodge, true strike, Weakened enemy, shields, shield break
  const eh = (o = {}, k = n) => { const b = mini(cfg, [dummyCard(cfg, { maxHp: 1e7, hp: 1e7, def: 0, ...o.card })], [dummyFoe({ atk: 100, ...o.foe })], { seed: 5 }); const c = b.cards[0], e = b.enemies[0];
    let land = 0, d = 0; for (let i = 0; i < k; i++) { o.setup?.(b, c, e); const x = b.enemyHit(e, c, 1); d += x; if (x > 0) land++; } return { land: land / k, mean: d / k }; };
  const dg = eh({ card: { ddg: 0.3 } }), dgt = eh({ card: { ddg: 0.3 }, foe: { mech: ['true_strike'] } });
  out.push(C('dodge', 'card Dodge 30%: 70% of single hits land. Enemy true strike: all land', '0.70, 1.00', `${dg.land.toFixed(3)}, ${dgt.land.toFixed(3)}`, near(dg.land, 0.7, 0.025) && dgt.land === 1));
  const e0 = eh(), ew = eh({ setup: (b, c, e) => { e.st.weakened = { v: 0.3, until: 1e9 }; } });
  out.push(C('weakened.enemy', 'a Weakened enemy deals 30% less', 0.7, +(ew.mean / e0.mean).toFixed(3), near(ew.mean / e0.mean, 0.7, 0.03)));
  const cd = eh({ card: { def: 0.3 } }), cs = eh({ card: { def: 0.3 }, foe: { mech: ['sunder'] } });
  out.push(C('defense.card', 'card Defense 30%: 70%. Enemy Sunder ignores half: 85%', '0.70, 0.85', `${(cd.mean / e0.mean).toFixed(3)}, ${(cs.mean / e0.mean).toFixed(3)}`, near(cd.mean / e0.mean, 0.7, 0.03) && near(cs.mean / e0.mean, 0.85, 0.03)));
  { const b = mini(cfg, [dummyCard(cfg)], [dummyFoe()]); const c = b.cards[0]; c.shield = 50; const h0 = c.hp; b.damage(null, c, 80); const a = h0 - c.hp;
    const b2 = mini(cfg, [dummyCard(cfg)], [dummyFoe()]); const c2 = b2.cards[0]; c2.shield = 50; const h2 = c2.hp; b2.damage(null, c2, 80, { shieldX: 2 }); const a2 = h2 - c2.hp;
    out.push(C('shield', 'a shield of 50 absorbs 50 of 80. Shield break x2: absorbs 25', 'HP -30, -55', `HP -${a}, -${a2}`, a === 30 && a2 === 55)); }
  // enemy mechanics
  { const b = mini(cfg, [dummyCard(cfg, { speedBase: 1 })], [dummyFoe({ mech: ['purify'] })], { cap: 3 }); const e = b.enemies[0];
    for (let i = 0; i < 2; i++) { b.apply(null, e, 'exposed', { value: 0.3 }); b.apply(null, e, 'poison', { stacks: 1 }); b.tickStep(); }
    const before = b.negKinds(e); b.apply(null, e, 'exposed', { value: 0.3 }); b.tickStep(); const after = b.negKinds(e);
    out.push(C('purify', 'Purify: the 3rd action removes all negative statuses', 'kinds 2 -> 0', `kinds ${before} -> ${after}`, before === 2 && after === 0)); }
  { const b = mini(cfg, [dummyCard(cfg)], [dummyFoe({ mech: ['toxic_born'] })]); const ok = !b.apply(b.cards[0], b.enemies[0], 'poison', { stacks: 1 });
    out.push(C('elementborn', 'Toxic-born: immune to Poison', 'refused', ok ? 'refused' : 'landed', ok)); }
  { let land = 0; const k = 2000; for (let i = 0; i < k; i++) { const b = mini(cfg, [dummyCard(cfg)], [dummyFoe({ mech: ['unstoppable'] })], { seed: i + 1 }); if (b.apply(b.cards[0], b.enemies[0], 'stunned')) land++; }
    out.push(C('unstoppable', 'Unstoppable: control fails 90%', 0.10, +(land / k).toFixed(3), near(land / k, 0.10, 0.02))); }
  { let land = 0; const k = 2000; for (let i = 0; i < k; i++) { const b = mini(cfg, [dummyCard(cfg)], [dummyFoe({ resolve: 0.2 })], { seed: i + 1 }); if (b.apply(b.cards[0], b.enemies[0], 'weakened', { value: 0.1 })) land++; }
    out.push(C('resolve', 'resolve 20%: a debuff fails 20%', 0.80, +(land / k).toFixed(3), near(land / k, 0.80, 0.025))); }
  { let wrong = 0, acts = 0; const b = mini(cfg, [dummyCard(cfg)], [dummyFoe({ moves: [['strike', 1]], speedBase: 100 })], { seed: 3 }); const e = b.enemies[0];
    for (let i = 0; i < n; i++) { e.st.confused = { v: 1, until: 1e9 }; if (b.confusedRedirect(e)) wrong++; acts++; }
    out.push(C('confused', 'Confused: 30% of single attacks hit the wrong target', 0.30, +(wrong / acts).toFixed(3), near(wrong / acts, 0.30, 0.025))); }
  return out;
}

// Random fights must keep HP in [0, max], shields >= 0 and every number finite.
export function fuzzChecks(cfg, n = 40) {
  const out = []; let bad = 0, fights = 0; const rng = mkRng(99);
  for (let i = 0; i < n; i++) {
    const roles = ROLES.slice().sort(() => rng() - 0.5).slice(0, 5);
    const cards = roles.map((r, k) => makeCard(cfg, { key: `fz${i}-${k}`, role: r, rarity: ['normal', 'gold', 'secret_rare'][k % 3], stars: k % 6, level: (i * 7) % 31, template: templatesOf(cfg, r)[i % templatesOf(cfg, r).length] }));
    const foes = [0, 1, 2].map(k => dummyFoe({ maxHp: 400 + 50 * k, hp: 400 + 50 * k, atk: 20, moves: [['strike', 3], ['slam', 1], ['poison', 1], ['stun', 1], ['guard', 1], ['curse', 1], ['drain', 1]], mech: [['venom', 'frost_aura', 'purify'][k]] }));
    const b = mini(cfg, cards, foes, { seed: i + 1, cap: 60, policy: i % 2 ? 'best' : 'auto' });
    while (!b.ended) { b.tickStep(); for (const u of b.units) if (!(u.hp >= 0 && u.hp <= u.maxHp + 1e-6 && u.shield >= 0 && Number.isFinite(u.hp) && Number.isFinite(u.meter))) bad++; }
    fights++;
  }
  out.push(C('fuzz', `${fights} random fights: HP in [0, max], shield >= 0, finite numbers`, 0, bad, bad === 0));
  return out;
}

export const allChecks = cfg => [...formulaChecks(cfg), ...meterChecks(cfg), ...statusChecks(cfg), ...fuzzChecks(cfg)];
