// auto.mjs - Auto v2 (PR E8, plan 14.1 row E8): the Hunt auto-pick (autoPick, the twin of the SQL combat_v2_autopick) and the Lab of Auto v2:
//   node card-studio/v2sim/run.mjs auto [--runs N] [--seed S]            the acceptance tables (Auto vs the scripted best play), about 10 minutes
//   node card-studio/v2sim/run.mjs answers [--runs N] [--seed S]         measures auto_v2.pick.answers (the role answers), about 2 minutes
// The fight policy is POLICIES.autov2 (policy.mjs). The numbers are config auto_v2 (= balance auto_v2).
//
// THE PICK (one squad for a Hunt day from a pool of the member's cards; boss = {mechanics, weak_role}): each card has a score =
//   its value: the Power number of the card (PR E9: the pool card's power, SQL card_power_v2 / power.mjs cardPower) when the pool card has one, else (E8)
//   its offense value (plan 2.5 Offense without the hit chance: attack (CP with the ATK points) x (1 + crit chance x (crit damage - 1)) x speed)
//   x answers[m][role] for each boss mechanic m (the measured role value against m; 1 when absent)
//   x (1 + the Weak to bonus of the boss for its role: v2_enemy.weak_role_rules[role].damage_x, else weak_role_x)
//   x the pair score: pair_floor for a payoff card with no maker of its status among the other picked cards (plan 5.2 floor rule, the effect library
//     6.2 "pair score"), else 1.
// The squad: the best `supports` supports (at most max_same_support of one support role) and the best attackers for the other slots; a class that is
// short fills from the other. The pair score needs the squad, so the pick runs again with the pair scores of the last squad, at most `passes` times
// (it stops when the squad does not change). Ties: the lower card id first. No random number.
import { ROLES, makeCard, templatesOf, cardPool } from './cards.mjs';
import { huntDay, dungeonRun, bossKeys, weakRoleOf, bossMechs } from './modes.mjs';
import { paysOf, makesOf } from './policy.mjs';
import { ARCHETYPES, dngPick, strength } from './experiments.mjs';
import { mkRng, hash, mean, median, table, ratio, fmt } from './util.mjs';
import { hasSet1, withSet1, loadTeams, teamSpecs } from './teams.mjs';
import { buildSquad } from './modes.mjs';

/** The score parts of one pool card. c = {id, role, class, atk, crt, crd, spd, blocks, power?}; boss = {mechanics, weak_role}. val = c.power (PR E9) when it
 * is a number, else the offense (E8). */
export function pickBase(cfg, c, boss) {
  const P = cfg.auto_v2.pick; const E = cfg.v2_enemy;
  const off = c.atk * (1 + c.crt * (c.crd - 1)) * c.spd;
  let ans = 1;
  for (const m of boss.mechanics || []) { const x = P.answers[m]?.[c.role]; if (x !== undefined) ans *= x; }
  const weak = c.role === boss.weak_role ? 1 + (E.weak_role_rules?.[c.role]?.damage_x ?? E.weak_role_x) : 1;
  const val = typeof c.power === 'number' ? c.power : off;
  return { off, power: typeof c.power === 'number' ? c.power : null, val, ans, weak, base: val * ans * weak };
}
/** The pair score of a card in a squad S (the other picked cards make one of the statuses that it pays off, else pair_floor). */
export function pairOf(cfg, c, S) {
  const pays = paysOf(c.blocks);
  if (!pays.length) return 1;
  return S.some((o) => o.id !== c.id && makesOf(cfg, o.role, o.blocks).some((s) => pays.includes(s))) ? 1 : cfg.auto_v2.pick.pair_floor;
}
function choose(cfg, pool, score, cap) {
  const P = cfg.auto_v2.pick;
  const ord = (a, b) => score(b) - score(a) || a.id - b.id;
  const att = pool.filter((c) => c.class === 'attacker').sort(ord);
  const sup = []; const per = {};
  for (const c of pool.filter((x) => x.class === 'support').sort(ord)) { if ((per[c.role] || 0) >= P.max_same_support) continue; per[c.role] = (per[c.role] || 0) + 1; sup.push(c); }
  let nS = Math.min(P.supports, sup.length, cap); const nA = Math.max(0, Math.min(cap - nS, att.length));
  if (nS + nA < cap) nS = Math.min(sup.length, cap - nA);
  return [...att.slice(0, nA), ...sup.slice(0, nS)];
}
/** The Hunt auto-pick: {ids (attackers first, each class by score), rows [{id, role, score, base, off, ans, weak, pair}], passes}. */
export function autoPick(cfg, pool, boss, cap) {
  const B = new Map(pool.map((c) => [c.id, pickBase(cfg, c, boss)]));
  let S = choose(cfg, pool, (c) => B.get(c.id).base, cap); let passes = 0;
  for (let p = 0; p < cfg.auto_v2.pick.passes; p++) {
    const prev = S;
    const sc = new Map(pool.map((c) => [c.id, B.get(c.id).base * pairOf(cfg, c, prev)]));
    S = choose(cfg, pool, (c) => sc.get(c.id), cap); passes = p + 1;
    if (S.map((c) => c.id).sort((a, b) => a - b).join() === prev.map((c) => c.id).sort((a, b) => a - b).join()) break;
  }
  const rows = S.map((c) => { const b = B.get(c.id); const pr = pairOf(cfg, c, S); return { id: c.id, role: c.role, ...b, pair: pr, score: b.base * pr }; });
  return { ids: S.map((c) => c.id), rows, passes };
}
/** A simulator card as a pool entry of the pick. */
export const poolEntry = (c, id) => ({ id, role: c.role, class: c.cls, atk: c.cp, crt: c.crit, crd: c.critx, spd: c.speedBase * c.spdMult, blocks: c.active.blocks, card: c });
/** The boss of a pick (a named Hunt boss at a tier). */
export function pickBoss(cfg, key, tier) { const N = bossMechs(cfg, key, tier); return { mechanics: N.mech, weak_role: weakRoleOf(N.B) }; }

// ---------------------------------------------------------------------------------------------------------------- the role answers (measured)
// For each mechanic that a Hunt boss can have (the tier boss signature pool and the sig and Mythic rules of the 16 named bosses): the strength of a card of each role (experiments.mjs strength: the net Hunt Heroic damage a day
// of the card + 4 reference cards, each template of the role, common seeds) with the mechanic alone on the tier boss / with no mechanic; answer = that ratio
// / the median ratio of the 12 roles (the role's value against the mechanic relative to the field), rounded to 2 decimals and held inside [lo, hi] (the
// limits of the balance shape); 1 when it differs from 1 by less than min_dev. A full table: every mechanic x every role (the fixed balance shape). The ratio is the mean of the seeds (default 1 and 7: one seed alone
// moves a cell by up to 0.06 at 800 runs).
export function measureAnswers(cfg, { runs = 800, seed = 1, seeds = [seed, seed + 6], minDev = 0.05, lo = 0.5, hi = 2 } = {}) {
  const mechs = [...new Set([...cfg.v2_enemy.signature_pool, ...bossKeys(cfg).flatMap((k) => [...cfg.v2_bosses[k].sig, ...(cfg.v2_bosses[k].mythic || [])])])].sort();
  const inv = cfg.v2_investment.casual;
  const card = (t) => makeCard(cfg, { key: t, role: t.split('.')[0], rarity: 'normal', template: t, ...inv });
  const val = (role, sigs, sd) => mean(templatesOf(cfg, role).map((t) => strength(cfg, card(t), runs, hash(sd, 'answers', t), { sigs })));
  const v0 = seeds.map((sd) => Object.fromEntries(ROLES.map((r) => [r, val(r, [], sd)])));
  const out = {}; const raw = {};
  for (const m of mechs) {
    const per = seeds.map((sd, k) => { const rr = Object.fromEntries(ROLES.map((r) => [r, val(r, [m], sd) / v0[k][r]])); const md = median(Object.values(rr)); return Object.fromEntries(ROLES.map((r) => [r, rr[r] / md])); });
    raw[m] = Object.fromEntries(ROLES.map((r) => [r, mean(per.map((x) => x[r]))]));
    for (const r of ROLES) {
      const a = Math.min(hi, Math.max(lo, Math.round(raw[m][r] * 100) / 100));
      (out[m] ||= {})[r] = Math.abs(a - 1) >= minDev ? a : 1;
    }
  }
  return { answers: out, raw, mechs };
}
export function answersExperiment(cfg, opts = {}) {
  const r = measureAnswers(cfg, opts);
  let md = `# Auto v2: the measured role answers (auto_v2.pick.answers)\n\nEach mechanic of the 16 named Hunt bosses alone on the Heroic tier boss. Cell = the role's strength ratio (with / without the mechanic) / the median ratio of the 12 roles. Runs ${opts.runs || 800} a template, the mean of seeds ${opts.seed || 1} and ${(opts.seed || 1) + 6}. Stored: rounded, inside [0.5, 2], 1 when |x - 1| < 0.05.\n\n`;
  md += table(['mechanic', ...ROLES], r.mechs.map((m) => [m, ...ROLES.map((x) => fmt(r.raw[m][x]))]));
  md += `\n\nThe JSON for config.json auto_v2.pick.answers (and balance auto_v2.pick.answers):\n\n\`\`\`\n${JSON.stringify(r.answers)}\n\`\`\`\n`;
  const kept = Object.values(r.answers).reduce((s, o) => s + Object.values(o).filter((x) => x !== 1).length, 0);
  return { md, head: [`${r.mechs.length} mechanics x ${ROLES.length} roles; ${kept} cells differ from 1 (${Object.values(r.answers).filter((o) => Object.values(o).some((x) => x !== 1)).length} mechanics).`], data: r };
}

// ---------------------------------------------------------------------------------------------------------------- the acceptance Lab
// 1. THE FIGHT: each archetype of plan 7.4 (experiments.mjs ARCHETYPES, Normal at the casual investment), Hunt Heroic (8 cards, net damage a day) and the
//    Dungeon run (the 5 cards of dngPick, floors): Auto v2 (autov2) / the scripted best play (best: per template id it holds payoffs for their status, kills,
//    and times control on a Charging boss) and the old simple Auto (auto) / best. The same seeds for every policy.
// 2. THE PICK (Hunt): random pools of real live cards (the fixture, random finishes, casual or active investment), each of the 16 named bosses at Heroic.
//    Auto = autoPick + autov2. The scripted best play = the best squad that a local search finds (swap one card for one card, first improvement, on
//    `searchDays` days with the best policy, from two starts: the auto-pick and the top 8 by attack) + the best policy. Both on `evalDays` fresh days.
//    Also shown: the old pick of the Admin Lab (the top 8 by attack) with the old simple Auto.
export function autoLab(cfg, { runs = 300, seed = 1, pools = 2, poolSize = 20, searchDays = 24, evalDays = 150, bosses } = {}) {
  const head = []; let md = '# Auto v2 (PR E8): Auto vs a scripted best play\n\n';
  const inv = cfg.v2_investment.casual;
  const mk = (t) => makeCard(cfg, { key: t, role: t.split('.')[0], rarity: 'normal', template: t, ...inv });
  // 1. the fight
  const rows = []; const fr = { hunt: [], dungeon: [] };
  for (const [name, A] of Object.entries(ARCHETYPES)) {
    const sq = A.hunt.map(mk), dq = dngPick(A.hunt).map(mk); const r = {};
    for (const p of ['best', 'autov2', 'auto']) {
      let h = 0, d = 0;
      for (let i = 0; i < runs; i++) { h += huntDay(cfg, sq, { tier: 'Heroic', seed: hash(seed, 'auto-h', i), policy: p }).net; d += dungeonRun(cfg, dq, { seed: hash(seed, 'auto-d', i), policy: p }).floor; }
      r[p] = { h: h / runs, d: d / runs };
    }
    fr.hunt.push(r.autov2.h / r.best.h); fr.dungeon.push(r.autov2.d / r.best.d);
    rows.push([name, fmt(r.best.h), ratio(r.autov2.h / r.best.h), ratio(r.auto.h / r.best.h), fmt(r.best.d), ratio(r.autov2.d / r.best.d), ratio(r.auto.d / r.best.d)]);
  }
  md += `## 1. The fight (Normal ${inv.stars}* level ${inv.level}; ${runs} Hunt days and ${runs} Dungeon runs a cell, the same seeds for each policy)\n\n`;
  md += table(['archetype', 'Hunt best net/day', 'Hunt Auto v2 / best', 'Hunt old Auto / best', 'Dungeon best floors', 'Dungeon Auto v2 / best', 'Dungeon old Auto / best'], rows);
  head.push(`Fight, Auto v2 / scripted best: Hunt ${ratio(Math.min(...fr.hunt), 3)} to ${ratio(Math.max(...fr.hunt), 3)}, Dungeon ${ratio(Math.min(...fr.dungeon), 3)} to ${ratio(Math.max(...fr.dungeon), 3)} over the ${rows.length} archetypes (target x0.85 or more).`);
  // 2. the pick
  const evalN = evalDays;
  const pool0 = cardPool(cfg).filter((p) => p.pullable.length);
  const keys = bosses || bossKeys(cfg);
  const prow = []; const pr = []; const po = [];
  const days = (sq, key, policy, n, tag) => { let s = 0; for (let i = 0; i < n; i++) s += huntDay(cfg, sq, { tier: 'Heroic', boss: key, seed: hash(seed, tag, i), policy }).net; return s / n; };
  for (const key of keys) {
    const boss = pickBoss(cfg, key, 'Heroic'); const rs = [], os = [];
    for (let pi = 0; pi < pools; pi++) {
      const rng = mkRng(hash(seed, 'pick-pool', key, pi)); const used = new Set(); const pool = [];
      while (pool.length < poolSize) {
        const s = pool0[Math.floor(rng() * pool0.length)]; if (used.has(s.key)) continue; used.add(s.key);
        const rar = s.pullable[Math.floor(rng() * s.pullable.length)]; const iv = rng() < 0.5 ? cfg.v2_investment.casual : cfg.v2_investment.active;
        pool.push(poolEntry(makeCard(cfg, { key: s.key, role: s.role, rarity: rar, cp_mod: s.cp_mod, ...iv }), pool.length + 1));
      }
      const byId = new Map(pool.map((c) => [c.id, c.card]));
      const sq = (ids) => ids.map((id) => byId.get(id));
      const auto = autoPick(cfg, pool, boss, 8).ids;
      const top = [...pool].sort((a, b) => b.atk - a.atk || a.id - b.id).slice(0, 8).map((c) => c.id);
      // the search (best policy, searchDays days, common seeds)
      const score = (ids) => days(sq(ids), key, 'best', searchDays, `search-${pi}`);
      let best = null, bestV = -Infinity;
      for (const start of [auto, top]) {
        let cur = [...start], cv = score(cur), improved = true, sweeps = 0;
        while (improved && sweeps < 6) {
          improved = false; sweeps++;
          const out = pool.map((c) => c.id).filter((id) => !cur.includes(id));
          for (let i = 0; i < cur.length && !improved; i++) for (const j of out) {
            const nx = cur.map((x, k) => (k === i ? j : x)); const v = score(nx);
            if (v > cv * 1.001) { cur = nx; cv = v; improved = true; break; }
          }
        }
        if (cv > bestV) { bestV = cv; best = cur; }
      }
      const vA = days(sq(auto), key, 'autov2', evalN, `eval-${pi}`), vB = days(sq(best), key, 'best', evalN, `eval-${pi}`), vO = days(sq(top), key, 'auto', evalN, `eval-${pi}`);
      rs.push(vA / vB); os.push(vO / vB);
    }
    pr.push(...rs); po.push(...os);
    prow.push([key, boss.weak_role || '-', boss.mechanics.join(', '), ratio(mean(rs), 3), ratio(Math.min(...rs), 3), ratio(mean(os), 3)]);
  }
  md += `\n## 2. The Hunt pick (${pools} pools of ${poolSize} real cards a boss, Heroic; search ${searchDays} days a squad, evaluation ${evalN} fresh days)\n\n`;
  md += 'Auto = the auto-pick + Auto v2. Best = the searched squad + the scripted best play. Old = the top 8 by attack + the old simple Auto.\n\n';
  md += table(['boss', 'Weak to', 'mechanics', 'Auto / best (mean)', 'Auto / best (lowest pool)', 'old / best (mean)'], prow);
  head.push(`Hunt pick + fight, Auto / scripted best: mean ${ratio(mean(pr), 3)}, lowest ${ratio(Math.min(...pr), 3)} (${pr.length} pools over ${keys.length} bosses; the old Lab pick ${ratio(mean(po), 3)}).`);
  // 3. the 20 designed teams with the PRIVATE Set 1 actives (only when the private file is there; aggregates only: the actives are unreleased)
  const tr = { hunt: [], dungeon: [], huntOld: [], dungeonOld: [] };
  if (hasSet1()) {
    const c1 = withSet1(cfg);
    for (const t of loadTeams()) {
      const hs = buildSquad(c1, teamSpecs(c1, t.hunt, inv)), ds = buildSquad(c1, teamSpecs(c1, t.dungeon, inv)); const r = {};
      for (const p of ['best', 'autov2', 'auto']) {
        let h = 0, d = 0;
        for (let i = 0; i < runs; i++) { h += huntDay(c1, hs, { tier: 'Heroic', seed: hash(seed, 'auto-th', i), policy: p }).net; d += dungeonRun(c1, ds, { seed: hash(seed, 'auto-td', i), policy: p }).floor; }
        r[p] = { h: h / runs, d: d / runs };
      }
      tr.hunt.push(r.autov2.h / r.best.h); tr.dungeon.push(r.autov2.d / r.best.d); tr.huntOld.push(r.auto.h / r.best.h); tr.dungeonOld.push(r.auto.d / r.best.d);
    }
    const q = (a) => `${ratio(Math.min(...a), 3)} / ${ratio(median(a), 3)} / ${ratio(Math.max(...a), 3)}`;
    md += `\n## 3. The ${tr.hunt.length} designed teams (teams.json) with the private Set 1 actives (aggregates only)\n\n`;
    md += 'The policy best scripts only the placeholder template ids, so on the real actives it plays like the old Auto. Lowest / median / highest over the teams.\n\n';
    md += table(['mode', 'Auto v2 / best', 'old Auto / best'], [['Hunt Heroic net/day', q(tr.hunt), q(tr.huntOld)], ['Dungeon run floors', q(tr.dungeon), q(tr.dungeonOld)]]);
    head.push(`The ${tr.hunt.length} designed teams with the private Set 1 actives, Auto v2 / best: Hunt lowest ${ratio(Math.min(...tr.hunt), 3)}, Dungeon lowest ${ratio(Math.min(...tr.dungeon), 3)}.`);
  }
  return { md, head, data: { fight: rows, pick: prow, fr, pr, po, teams: tr } };
}
