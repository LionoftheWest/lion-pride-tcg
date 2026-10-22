// power.mjs - the Power number (PR E9, plan 2.5 and decision 3; the twin of the SQL card_power_v2 and combat_v2_squad_value) and its Lab:
//   node card-studio/v2sim/run.mjs power [--runs N] [--seed S]     the k refit and the rank correlation report, about 15 minutes
//   node card-studio/v2sim/run.mjs powerpick [--seed S]             the Hunt auto-pick per boss: the E8 score vs the E9 Power score, about 25 minutes
// The numbers are config v2_power (= balance v2_power).
//
// THE POWER NUMBER of one card c = {role, class, atk, crt, crd, acc, spd, hp, def, ddg, abl, f (the support factor F), extra_stack, blocks}
// (the stats of card_combat_v2 and the BASE blocks of the active, before F and the extra stack):
//   crit factor  cx = 1 + crt x (crd - 1)
//   hit chance   h  = 1 - max(0, v2_hit.miss + v2_enemy.hunt.Heroic.evasion - acc)        (the reference boss of the fit: Heroic)
//   attacker  Offense = atk x cx x h x spd x (1 + abl_x x (abl - 1))
//   support   Offense = (v2_support.basic_x x atk x h + support_abl_ref x F x abl + F x abl x atk x u x V) x cx x spd
//             V = value.smite x PP(smite blocks) + value.dot x PP(dot blocks) + value.control x PP(control blocks)      (decision 3)
//             u = 1 / (v2_pp.support_pp.smite x ability_v2.pp.sup_cycle): the attack share of one PP (a smite of 1.0 x CP costs smite x sup_cycle / C PP)
//   Survival  = hp / (1 - def) / (1 - ddg_x x ddg)
//   Power     = Offense x Survival x k[role] x scale; the card shows round(Power).
// The families of the blocks of an active: smite = smite, area, vs_status, payoff_dmg, crit_add, consume of a support (the smite and what changes it); dot = a status
// block (apply, on_crit, on_kill; random_apply when every option is in the family) of a status of the family dot (Poison, Burn); control = the same for
// the family control (Stunned, Frozen, Sleep, Paralyzed); an attachment (attach gate or amount) counts in the family of its host; the rest is other.
// PP = the price of each block (cards.mjs blockPP = SQL ability_v2_pps), on the blocks with the extra stack. The attacker active is counted by its ABL term:
// every active costs the same budget, and the measured attacker k is in the target with no value term (the Lab).
// SQUAD VALUE = the sum of the Power of the cards x the pair score of each card in the squad (auto.mjs pairOf: pair_floor for a payoff card with no maker
// of its status among the other cards; plan 5.2).
import { blockPP, classOf, ROLES, STATS, templatesOf, makeCard, allocate, cardPool } from './cards.mjs';
import { huntDay, dungeonRun, bossKeys } from './modes.mjs';
import { mkRng, hash, mean, median, spearman, table, fmt, ratio } from './util.mjs';
import { autoPick, poolEntry, pickBoss } from './auto.mjs';

export const SMITE_BLOCKS = ['smite', 'area', 'vs_status', 'payoff_dmg', 'crit_add', 'consume'];
export const STATUS_BLOCKS = ['apply', 'on_crit', 'on_kill'];
// the family of a status (the statuses table: family dot or control; the test compares this copy with the table)
export const STATUS_FAMILY = { poison: 'dot', burn: 'dot', stunned: 'control', frozen: 'control', sleep: 'control', paralyzed: 'control' };
export const ATTACH_BLOCKS = ['self_has', 'enemy_charging', 'foes_alive', 'self_shield', 'target_has', 'ally_below', 'more_per', 'coin'];
export const FAMILIES = ['smite', 'dot', 'control', 'other'];

/** The family of each block of an active: ['smite' | 'dot' | 'control' | 'other']. */
export function blockFamilies(blocks, cls = 'support') {
  const out = []; let host = 'other';
  for (const b of blocks || []) {
    let f = 'other';
    if (ATTACH_BLOCKS.includes(b.k)) f = host;
    else if (cls === 'support' && SMITE_BLOCKS.includes(b.k)) f = 'smite';
    else if (STATUS_BLOCKS.includes(b.k)) f = STATUS_FAMILY[b.status] || 'other';
    else if (b.k === 'random_apply') { const fs = [...new Set((b.options || []).map((o) => STATUS_FAMILY[o.status] || 'other'))]; f = fs.length === 1 ? fs[0] : 'other'; }
    out.push(f); host = f;
  }
  return out;
}
/** The PP of each family of an active (base blocks + the extra stack of the finish; the class charge, as the SQL ability_v2_pps). */
export function familyPP(cfg, cls, blocks, extra = 0) {
  const B = (blocks || []).map((b) => (typeof b.stacks === 'number' ? { ...b, stacks: b.stacks + extra } : { ...b }));
  const out = { smite: 0, dot: 0, control: 0, other: 0 };
  if (!B.length) return out;
  const tid = '__power'; const role = cls === 'attacker' ? 'striker' : 'warden'; // the class decides the price rules and the charge (no template charge)
  const c2 = { ...cfg, v2_templates: { ...cfg.v2_templates, [tid]: { role, blocks: B } } };
  const fam = blockFamilies(B, cls);
  B.forEach((b, i) => { out[fam[i]] += blockPP(c2, tid, b); });
  return out;
}
/** The Power number of one card (see the head of this file): {power (rounded), value (exact), offense, survival, k, hit, cx, pp, v}. */
export function cardPower(cfg, c) {
  const P = cfg.v2_power; const cls = c.class;
  if (!P) throw new Error('cardPower: config has no v2_power');
  const k = P.k[c.role]; if (typeof k !== 'number') throw new Error(`cardPower: no k for the role ${c.role}`);
  const cx = 1 + c.crt * (c.crd - 1);
  const hit = 1 - Math.max(0, cfg.v2_hit.miss + cfg.v2_enemy.hunt.Heroic.evasion - c.acc);
  const pp = familyPP(cfg, cls, c.blocks, c.extra_stack || 0);
  let offense, v = 0;
  if (cls === 'attacker') offense = c.atk * cx * hit * c.spd * (1 + P.abl_x * (c.abl - 1));
  else {
    const u = 1 / (cfg.v2_pp.support_pp.smite * cfg.ability_v2.pp.sup_cycle);
    v = P.value.smite * pp.smite + P.value.dot * pp.dot + P.value.control * pp.control;
    offense = (cfg.v2_support.basic_x * c.atk * hit + P.support_abl_ref * c.f * c.abl + c.f * c.abl * c.atk * u * v) * cx * c.spd;
  }
  const survival = c.hp / (1 - c.def) / (1 - P.ddg_x * c.ddg);
  const value = offense * survival * k * P.scale;
  return { power: Math.round(value), value, offense, survival, k, hit, cx, pp, v };
}
/** A simulator card (makeCard) as the input of cardPower: the BASE blocks of its template. */
export function powerInput(cfg, sc) {
  return { role: sc.role, class: sc.cls, atk: sc.cp, crt: sc.crit, crd: sc.critx, acc: sc.acc, spd: sc.speedBase * Math.min(sc.spdMult, cfg.v2_speed.safety_max_x),
    hp: sc.maxHp, def: sc.def, ddg: sc.ddg, abl: sc.abl, f: sc.power, extra_stack: cfg.v2_support.enabler_extra_stack.includes(sc.rarity) ? 1 : 0,
    blocks: sc.active.base || cfg.v2_templates[sc.active.id]?.blocks || [] };
}
export const powerOf = (cfg, sc) => cardPower(cfg, powerInput(cfg, sc));

// ---------------------------------------------------------------------------------------------------------------- the Lab
const RAR = ['normal', 'full_art', 'gold'];
const REF = [['striker', 'striker.lockon'], ['flurry', 'flurry.storm'], ['warden', 'warden.shield'], ['spotter', 'spotter.expose']];
const refCards = (cfg) => REF.map(([role, t]) => makeCard(cfg, { key: `ref-${role}`, role, rarity: 'normal', template: t, stars: 2, level: 15 }));
/** The measured value of one card (the card + the 4 reference cards of experiment 4, policy autov2): Hunt Heroic net damage a day / Dungeon rooms a run. */
export function cardValue(cfg, card, mode, n, seed) {
  const ref = refCards(cfg); let s = 0;
  for (let i = 0; i < n; i++) s += mode === 'hunt' ? huntDay(cfg, [card, ...ref], { tier: 'Heroic', seed: hash(seed, i), sigs: [], policy: 'autov2' }).net
    : dungeonRun(cfg, [card, ...ref], { seed: hash(seed, 'd', i), policy: 'autov2' }).rooms;
  return s / n;
}
/** The plan 2.5 formula of V1 (no value term: decision 3 not applied), k = 1: the "before" of the refit. */
export function planPower(cfg, c) { return cardPower({ ...cfg, v2_power: { ...cfg.v2_power, value: { smite: 0, dot: 0, control: 0 }, k: Object.fromEntries(ROLES.map((r) => [r, 1])), scale: 1 } }, c).value; }
/** The raw formula (k = 1, scale 1) with the E9 value terms. */
export function rawPower(cfg, c) { return cardPower({ ...cfg, v2_power: { ...cfg.v2_power, k: Object.fromEntries(ROLES.map((r) => [r, 1])), scale: 1 } }, c).value; }
/** The role scale k: per role, the measured value of its reference cards (each template, Normal 2* level 15) / their raw formula value, / the mean of the roles. */
export function fitK(cfg, { runs = 1500, runsD = 300, seed = 9, formula = rawPower } = {}) {
  const kh = {}, kd = {}, tpl = [];
  for (const role of ROLES) {
    const cs = templatesOf(cfg, role).map((t) => makeCard(cfg, { key: t, role, rarity: 'normal', template: t, stars: 2, level: 15 }));
    const h = cs.map((c) => cardValue(cfg, c, 'hunt', runs, hash(seed, c.active.id))); const d = cs.map((c) => cardValue(cfg, c, 'dungeon', runsD, hash(seed, c.active.id)));
    const a = cs.map((c) => formula(cfg, powerInput(cfg, c)));
    kh[role] = mean(h) / mean(a); kd[role] = mean(d) / mean(a);
    cs.forEach((c, i) => tpl.push({ t: c.active.id, role, h: h[i], d: d[i], a: a[i] }));
  }
  const norm = (o) => { const m = mean(Object.values(o)); return Object.fromEntries(ROLES.map((r) => [r, o[r] / m])); };
  return { hunt: norm(kh), dungeon: norm(kd), tpl };
}
/** scale: the mean Power of a Normal card at 0 stars and level 0 of each placeholder template (k applied) = 100. */
export function fitScale(cfg, k) {
  const vals = ROLES.flatMap((role) => templatesOf(cfg, role).map((t) => rawPower(cfg, powerInput(cfg, makeCard(cfg, { key: t, role, rarity: 'normal', template: t, stars: 0, level: 0 }))) * k[role]));
  return 100 / mean(vals);
}
/** A random card (experiment 4: random role, finish, stars, level and build). */
function randomCard(cfg, rng, i) {
  const role = ROLES[i % ROLES.length]; const rarity = RAR[Math.floor(rng() * RAR.length)]; const stars = Math.floor(rng() * 6); const level = [0, 5, 10, 20, 30][Math.floor(rng() * 5)];
  const wts = Object.fromEntries(STATS.map((s) => [s, rng() < 0.5 ? 0 : 1 + Math.floor(rng() * 4)])); const pts = allocate(cfg, Object.values(wts).some((x) => x) ? wts : { atk: 1 }, level);
  const tl = templatesOf(cfg, role); const t = tl[Math.floor(rng() * tl.length)];
  return makeCard(cfg, { key: `pw${i}`, role, rarity, stars, level, points: pts, template: t });
}
/** The squad value (Power x the pair score, summed). cards = simulator cards; pairOf from auto.mjs (passed in to keep one source). */
export function squadValue(cfg, cards, pairOf) {
  const S = cards.map((c, i) => ({ id: i + 1, role: c.role, blocks: c.active.blocks }));
  let sum = 0; const rows = cards.map((c, i) => { const p = cardPower(cfg, powerInput(cfg, c)); const pr = pairOf(cfg, S[i], S); sum += p.value * pr; return { power: p.value, pair: pr }; });
  return { value: sum, rows };
}

export function powerLab(cfg, { runs = 1500, seed = 1, sample = 240, days = 300, dRuns = 60, squads = 120, squadDays = 120, pairOf } = {}) {
  const head = []; let md = '# The Power number (PR E9): the k refit and the rank correlation report\n\n';
  const P = cfg.v2_power;
  // 1. the k refit: fit seed 9, check seed 19 (fresh days)
  const before = fitK(cfg, { runs, seed: 9, formula: planPower });
  const fit = fitK(cfg, { runs, seed: 9 });
  const check = fitK({ ...cfg }, { runs, seed: 19, formula: (c, x) => rawPower(c, x) * P.k[x.role] });
  const rows = ROLES.map((r) => [r, fmt(before.hunt[r], 2), fmt(fit.hunt[r], 3), fmt(P.k[r], 3), fmt(check.hunt[r], 2), fmt(before.dungeon[r], 2), fmt(fit.dungeon[r], 2)]);
  const inR = (o) => Object.values(o).every((x) => x >= 0.85 && x <= 1.15);
  md += `## 1. The role scale k (target 0.85 to 1.15)\n\nk = the measured value of the role's reference cards (each placeholder template, Normal 2* level 15, the card + the 4 reference cards of experiment 4, policy autov2; Hunt Heroic net damage a day, ${runs} days a template) / their formula value, / the mean of the roles. "Before" = the plan 2.5 formula of V1 (no smite, dot or control value). "Fitted" = the E9 formula on seed 9 (stored in balance v2_power.k). "Check" = the E9 formula with the stored k on fresh days (seed 19): about 1 when the k holds. Dungeon (rooms a run, ${300} runs a template) is information: one Power number for both modes.\n\n`;
  md += table(['role', 'k before (plan 2.5, Hunt)', 'k fitted (E9, Hunt)', 'stored k', 'check: E9 x stored k (fresh days)', 'k before (Dungeon)', 'k E9 (Dungeon)'], rows);
  md += `\nIn the target: before ${inR(before.hunt) ? 'yes' : 'no'} (${fmt(Math.min(...Object.values(before.hunt)), 2)} to ${fmt(Math.max(...Object.values(before.hunt)), 2)}), E9 ${inR(fit.hunt) ? 'yes' : 'no'} (${fmt(Math.min(...Object.values(fit.hunt)), 2)} to ${fmt(Math.max(...Object.values(fit.hunt)), 2)}), check ${fmt(Math.min(...Object.values(check.hunt)), 2)} to ${fmt(Math.max(...Object.values(check.hunt)), 2)}.\n`;
  head.push(`k (Hunt) before ${fmt(Math.min(...Object.values(before.hunt)), 2)} to ${fmt(Math.max(...Object.values(before.hunt)), 2)}; E9 fitted ${fmt(Math.min(...Object.values(fit.hunt)), 2)} to ${fmt(Math.max(...Object.values(fit.hunt)), 2)} (target 0.85 to 1.15); fresh-day check of the stored k ${fmt(Math.min(...Object.values(check.hunt)), 2)} to ${fmt(Math.max(...Object.values(check.hunt)), 2)}.`);
  // 2. per card: random cards, measured in both modes
  const rng = mkRng(hash(seed, 'power-e9'));
  const cs = []; for (let i = 0; i < sample; i++) { const c = randomCard(cfg, rng, i); cs.push({ c, role: c.role, h: cardValue(cfg, c, 'hunt', days, hash(seed, 'pw', i)), d: cardValue(cfg, c, 'dungeon', dRuns, hash(seed, 'pwd', i)) }); }
  const F = {
    'naive CP x HP': (x) => x.c.cp * x.c.maxHp,
    'plan 2.5 (V1, k = 1)': (x) => planPower(cfg, powerInput(cfg, x.c)),
    'E9 Power (stored k)': (x) => powerOf(cfg, x.c).value,
  };
  const corr = []; const perRole = [];
  for (const mode of ['h', 'd']) for (const [name, fn] of Object.entries(F)) {
    const v = new Map(cs.map((x) => [x, fn(x)]));
    const sp = (s) => (s.length > 2 ? spearman(s.map((x) => v.get(x)), s.map((x) => x[mode])) : NaN);
    corr.push([mode === 'h' ? 'Hunt' : 'Dungeon', name, fmt(sp(cs), 3), fmt(sp(cs.filter((x) => x.c.cls === 'attacker')), 3), fmt(sp(cs.filter((x) => x.c.cls === 'support')), 3), fmt(mean(ROLES.map((r) => sp(cs.filter((x) => x.role === r)))), 3)]);
    if (name.startsWith('E9')) perRole.push([mode === 'h' ? 'Hunt' : 'Dungeon', ...ROLES.map((r) => fmt(sp(cs.filter((x) => x.role === r)), 2))]);
  }
  md += `\n## 2. Per card: Spearman rank correlation of the formula with the measured value (${sample} random cards: random role, finish, stars, level and build; Hunt ${days} days, Dungeon ${dRuns} runs a card; seed ${seed})\n\n`;
  md += table(['mode', 'formula', 'all cards', 'attackers', 'supports', 'mean within one role'], corr);
  md += `\n### E9 Power within each role\n\n` + table(['mode', ...ROLES], perRole);
  const e9h = corr.find((r) => r[0] === 'Hunt' && r[1].startsWith('E9')), e9d = corr.find((r) => r[0] === 'Dungeon' && r[1].startsWith('E9'));
  const plh = corr.find((r) => r[0] === 'Hunt' && r[1].startsWith('plan')), pld = corr.find((r) => r[0] === 'Dungeon' && r[1].startsWith('plan'));
  head.push(`Per card (Spearman, all / supports): Hunt E9 ${e9h[2]} / ${e9h[4]} (plan 2.5 ${plh[2]} / ${plh[4]}); Dungeon E9 ${e9d[2]} / ${e9d[4]} (plan 2.5 ${pld[2]} / ${pld[4]}).`);
  // 3. per squad: random squads of real cards (the fixture, random finishes and investment)
  const pool0 = cardPool(cfg).filter((p) => p.pullable.length);
  const sq = [];
  for (let i = 0; i < squads; i++) {
    const r2 = mkRng(hash(seed, 'power-squad', i)); const used = new Set(); const hs = [];
    while (hs.length < 8) { const s = pool0[Math.floor(r2() * pool0.length)]; if (used.has(s.key)) continue; used.add(s.key);
      const rar = s.pullable[Math.floor(r2() * s.pullable.length)]; const iv = [cfg.v2_investment.new, cfg.v2_investment.casual, cfg.v2_investment.active][Math.floor(r2() * 3)];
      hs.push(makeCard(cfg, { key: s.key, role: s.role, rarity: rar, cp_mod: s.cp_mod, ...iv })); }
    const ds = hs.slice(0, 5);
    let h = 0, d = 0; for (let j = 0; j < squadDays; j++) { h += huntDay(cfg, hs, { tier: 'Heroic', seed: hash(seed, 'sqh', i, j), policy: 'autov2' }).net; }
    for (let j = 0; j < Math.ceil(squadDays / 3); j++) d += dungeonRun(cfg, ds, { seed: hash(seed, 'sqd', i, j), policy: 'autov2' }).rooms;
    sq.push({ hs, ds, h: h / squadDays, d: d / Math.ceil(squadDays / 3) });
  }
  const SF = {
    'sum of CP': (cards) => cards.reduce((s, c) => s + c.cp, 0),
    'sum of plan 2.5 (k = 1)': (cards) => cards.reduce((s, c) => s + planPower(cfg, powerInput(cfg, c)), 0),
    'sum of E9 Power': (cards) => cards.reduce((s, c) => s + powerOf(cfg, c).value, 0),
    'squad value (E9 Power x pair score)': (cards) => squadValue(cfg, cards, pairOf).value,
  };
  const srow = Object.entries(SF).map(([n, fn]) => [n, fmt(spearman(sq.map((x) => fn(x.hs)), sq.map((x) => x.h)), 3), fmt(spearman(sq.map((x) => fn(x.ds)), sq.map((x) => x.d)), 3)]);
  md += `\n## 3. Per squad: Spearman rank correlation with the measured squad value (${squads} random squads of real cards: random finishes, investment new, casual or active; Hunt 8 cards ${squadDays} days, Dungeon the first 5 cards ${Math.ceil(squadDays / 3)} runs)\n\n`;
  md += table(['squad number', 'Hunt (net damage a day)', 'Dungeon (rooms a run)'], srow);
  head.push(`Per squad (Spearman, Hunt / Dungeon): ${srow.map((r) => `${r[0]} ${r[1]} / ${r[2]}`).join('; ')}.`);
  return { md, head, data: { before, fit, check, corr, perRole, squads: srow } };
}

// ---------------------------------------------------------------------------------------------------------------- the Hunt auto-pick per boss
// The E8 Lab protocol (auto.mjs autoLab part 2, the same pools, seeds and search): for each of the 16 named bosses at Heroic, random pools of real live
// cards (random finishes, casual or active investment). Each variant = a value for the pick score (autoPick: value x the role answers x the Weak to bonus
// x the pair score) + Auto v2. E8 = the offense (no power); E9 = the Power number; the other variants show which part of the Power helps or hurts.
// The reference = the searched squad (one swap at a time from the E8 pick and the top 8 by attack, searchDays days a squad, the best policy) + the best
// policy, evaluated on evalDays fresh days. The reference does not depend on the variant (the same squad for each variant).
export const PICK_VARIANTS = {
  'E8 offense': null,
  'E9 Power': (cfg, c) => powerOf(cfg, c).value,
  'Power without Survival': (cfg, c) => { const p = powerOf(cfg, c); return p.offense * p.k; },
  'Power for supports, E8 for attackers': (cfg, c) => (c.cls === 'support' ? powerOf(cfg, c).value : undefined),
  'Power for attackers, E8 for supports': (cfg, c) => (c.cls === 'attacker' ? powerOf(cfg, c).value : undefined),
};
export function powerPickLab(cfg, { seed = 1, pools = 2, poolSize = 20, searchDays = 24, evalDays = 150, bosses, variants = PICK_VARIANTS } = {}) {
  const head = []; let md = '# The Hunt auto-pick per boss (PR E9): the E8 offense score vs the E9 Power score\n\n';
  const pool0 = cardPool(cfg).filter((p) => p.pullable.length);
  const keys = bosses || bossKeys(cfg); const V = Object.keys(variants);
  const days = (sq, key, policy, n, tag) => { let s = 0; for (let i = 0; i < n; i++) s += huntDay(cfg, sq, { tier: 'Heroic', boss: key, seed: hash(seed, tag, i), policy }).net; return s / n; };
  const rows = []; const all = Object.fromEntries(V.map((v) => [v, []])); const per = {}; const mix = { best: {} }; const overlap = Object.fromEntries(V.map((v) => [v, []])); const detail = {};
  for (const v of V) mix[v] = {};
  for (const key of keys) {
    const boss = pickBoss(cfg, key, 'Heroic'); const r = Object.fromEntries(V.map((v) => [v, []])); const same = Object.fromEntries(V.map((v) => [v, 0]));
    for (let pi = 0; pi < pools; pi++) {
      const rng = mkRng(hash(seed, 'pick-pool', key, pi)); const used = new Set(); const pool = [];
      while (pool.length < poolSize) {
        const s = pool0[Math.floor(rng() * pool0.length)]; if (used.has(s.key)) continue; used.add(s.key);
        const rar = s.pullable[Math.floor(rng() * s.pullable.length)]; const iv = rng() < 0.5 ? cfg.v2_investment.casual : cfg.v2_investment.active;
        pool.push(poolEntry(makeCard(cfg, { key: s.key, role: s.role, rarity: rar, cp_mod: s.cp_mod, ...iv }), pool.length + 1));
      }
      const byId = new Map(pool.map((c) => [c.id, c.card])); const sq = (ids) => ids.map((id) => byId.get(id));
      const picks = Object.fromEntries(V.map((v) => [v, autoPick(cfg, variants[v] ? pool.map((c) => { const x = variants[v](cfg, c.card); return x === undefined ? c : { ...c, power: x }; }) : pool, boss, 8).ids]));
      const e8 = picks['E8 offense'] || autoPick(cfg, pool, boss, 8).ids;
      const top = [...pool].sort((a, b) => b.atk - a.atk || a.id - b.id).slice(0, 8).map((c) => c.id);
      const score = (ids) => days(sq(ids), key, 'best', searchDays, `search-${pi}`);
      let best = null, bestV = -Infinity;
      for (const start of [e8, top]) {
        let cur = [...start], cv = score(cur), improved = true, sweeps = 0;
        while (improved && sweeps < 6) {
          improved = false; sweeps++;
          const out = pool.map((c) => c.id).filter((id) => !cur.includes(id));
          for (let i = 0; i < cur.length && !improved; i++) for (const j of out) { const nx = cur.map((x, k) => (k === i ? j : x)); const v = score(nx); if (v > cv * 1.001) { cur = nx; cv = v; improved = true; break; } }
        }
        if (cv > bestV) { bestV = cv; best = cur; }
      }
      const vB = days(sq(best), key, 'best', evalDays, `eval-${pi}`); const memo = new Map();
      const roleOfId = new Map(pool.map((c) => [c.id, c.role])); const supRoles = (ids) => ids.map((id) => roleOfId.get(id)).filter((r) => classOf(r) === 'support');
      for (const r of supRoles(best)) mix.best[r] = (mix.best[r] || 0) + 1;
      for (const v of V) { for (const r of supRoles(picks[v])) mix[v][r] = (mix[v][r] || 0) + 1; overlap[v].push(picks[v].filter((id) => best.includes(id)).length); }
      (detail[key] ||= []).push({ best: best.map((id) => roleOfId.get(id)), ...Object.fromEntries(V.map((v) => [v, picks[v].map((id) => roleOfId.get(id))])) });
      for (const v of V) { const k = [...picks[v]].sort((a, b) => a - b).join(); if (!memo.has(k)) memo.set(k, days(sq(picks[v]), key, 'autov2', evalDays, `eval-${pi}`));
        r[v].push(memo.get(k) / vB); if (k === [...e8].sort((a, b) => a - b).join()) same[v]++; }
    }
    per[key] = Object.fromEntries(V.map((v) => [v, { mean: mean(r[v]), low: Math.min(...r[v]), same: same[v] }]));
    for (const v of V) all[v].push(...r[v]);
    rows.push([key, boss.weak_role || '-', boss.mechanics.join(', '), ...V.map((v) => ratio(mean(r[v]), 3))]);
  }
  md += `${pools} pools of ${poolSize} real cards a boss (seed ${seed}), Heroic; search ${searchDays} days a squad, evaluation ${evalDays} fresh days. Ratio = Auto (the pick of the variant + Auto v2) / the searched best squad with the scripted best play (the same reference for every variant).\n\n`;
  md += table(['boss', 'Weak to', 'mechanics', ...V.map((v) => `${v} (mean)`)], [...rows, ['MEAN', '', '', ...V.map((v) => ratio(mean(all[v]), 3))], ['bosses below x0.85', '', '', ...V.map((v) => String(keys.filter((k) => per[k][v].mean < 0.85).length))]]);
  md += `\nThe same squad as the E8 pick (pools): ${V.map((v) => `${v} ${keys.reduce((s, k) => s + per[k][v].same, 0)} of ${keys.length * pools}`).join(', ')}.\n`;
  const SR = ['warden', 'medic', 'controller', 'spotter', 'herald', 'artillery'];
  md += `
### The support roles picked (all pools) and the cards in common with the searched best squad (of 8)

` + table(['squad', ...SR, 'cards in common with the best (mean)'], [['searched best', ...SR.map((r) => String(mix.best[r] || 0)), '8'], ...V.map((v) => [v, ...SR.map((r) => String(mix[v][r] || 0)), fmt(mean(overlap[v]), 2)])]);
  head.push(`Pick per boss (${pools} pools a boss, seed ${seed}): ${V.map((v) => `${v} mean ${ratio(mean(all[v]), 3)}, below x0.85 ${keys.filter((k) => per[k][v].mean < 0.85).length}`).join('; ')}.`);
  head.push(`Support roles: best ${JSON.stringify(mix.best)}; ${V.map((v) => `${v} ${JSON.stringify(mix[v])} (in common with the best ${fmt(mean(overlap[v]), 2)})`).join('; ')}.`);
  return { md, head, data: { per, all, mix, overlap, detail } };
}
