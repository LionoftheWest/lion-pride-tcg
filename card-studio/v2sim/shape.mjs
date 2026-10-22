// shape.mjs - the shape rule of the Hunt auto-pick (after PR E9, plan 20.6 Open item 1). The E8 Lab protocol (auto.mjs autoLab part 2, power.mjs
// powerPickLab): the same pools, seeds, searched reference and evaluation days. Each candidate = a patch of auto_v2.pick (the shape: how many supports, how
// many of one support role); the per-card score stays the E8 offense score. The reference (the searched best squad + the best policy) does not depend on
// the candidate. node card-studio/v2sim/run.mjs shapepick --seed 101|202|1 [--pools N]
import { makeCard, cardPool, classOf } from './cards.mjs';
import { huntDay, bossKeys } from './modes.mjs';
import { autoPick, poolEntry, pickBoss } from './auto.mjs';
import { mkRng, hash, mean, sd, table, ratio, patch } from './util.mjs';

/** One pool set: for each boss and pool the pool, the E8 pick, the searched best squad and its value (the E8 protocol). */
export function referencePools(cfg, { seed = 1, pools = 2, poolSize = 20, searchDays = 24, evalDays = 150, bosses } = {}) {
  const pool0 = cardPool(cfg).filter((p) => p.pullable.length);
  const keys = bosses || bossKeys(cfg); const out = [];
  const days = (sq, key, policy, n, tag) => { let s = 0; for (let i = 0; i < n; i++) s += huntDay(cfg, sq, { tier: 'Heroic', boss: key, seed: hash(seed, tag, i), policy }).net; return s / n; };
  for (const key of keys) {
    const boss = pickBoss(cfg, key, 'Heroic');
    for (let pi = 0; pi < pools; pi++) {
      const rng = mkRng(hash(seed, 'pick-pool', key, pi)); const used = new Set(); const pool = [];
      while (pool.length < poolSize) {
        const s = pool0[Math.floor(rng() * pool0.length)]; if (used.has(s.key)) continue; used.add(s.key);
        const rar = s.pullable[Math.floor(rng() * s.pullable.length)]; const iv = rng() < 0.5 ? cfg.v2_investment.casual : cfg.v2_investment.active;
        pool.push(poolEntry(makeCard(cfg, { key: s.key, role: s.role, rarity: rar, cp_mod: s.cp_mod, ...iv }), pool.length + 1));
      }
      const byId = new Map(pool.map((c) => [c.id, c.card])); const sq = (ids) => ids.map((id) => byId.get(id));
      const e8 = autoPick(patch(cfg, { auto_v2: { pick: E8 } }), pool, boss, 8).ids;   // the E8 start of the search (the reference of plan 20.5 and 20.6)
      const top = [...pool].sort((a, b) => b.atk - a.atk || a.id - b.id).slice(0, 8).map((c) => c.id);
      const score = (ids) => days(sq(ids), key, 'best', searchDays, `search-${pi}`);
      let best = null, bestV = -Infinity;
      for (const start of [e8, top]) {
        let cur = [...start], cv = score(cur), improved = true, sweeps = 0;
        while (improved && sweeps < 6) {
          improved = false; sweeps++;
          const outIds = pool.map((c) => c.id).filter((id) => !cur.includes(id));
          for (let i = 0; i < cur.length && !improved; i++) for (const j of outIds) { const nx = cur.map((x, k) => (k === i ? j : x)); const v = score(nx); if (v > cv * 1.001) { cur = nx; cv = v; improved = true; break; } }
        }
        if (cv > bestV) { bestV = cv; best = cur; }
      }
      const vB = days(sq(best), key, 'best', evalDays, `eval-${pi}`);
      out.push({ key, pi, boss, pool, best, vB, eval: (ids) => days(sq(ids), key, 'autov2', evalDays, `eval-${pi}`) });
    }
  }
  return out;
}

/** The searched best shape of a pool: the support count and the most cards of one support role. */
export function shapeOf(pool, ids) {
  const role = new Map(pool.map((c) => [c.id, c.role])); const sup = ids.map((id) => role.get(id)).filter((r) => classOf(r) === 'support');
  const per = {}; for (const r of sup) per[r] = (per[r] || 0) + 1;
  return { supports: sup.length, maxSame: Math.max(0, ...Object.values(per)), roles: sup };
}

// The candidates (patches of auto_v2.pick; lab = Lab-only options of auto.mjs choose, not in balance and not in SQL). E8 = 4 supports, 1 of a role.
const E8 = { supports: 4, supports_max: 4, max_same_support: 1 };
export const SHAPE_CANDIDATES = {
  'E8: 4 supports, 1 a role': E8,
  'Weak to role twice': { ...E8, lab: { weak_same: 2 } },
  'a role twice': { ...E8, max_same_support: 2 },
  '3 supports': { ...E8, supports: 3, supports_max: 3 },
  '5 supports': { ...E8, supports: 5, supports_max: 5 },
  'by Weak to: attacker 3, support 5': { ...E8, lab: { by_weak: { attacker: 3, support: 5 } } },
  'by Weak to: attacker 3, support 4': { ...E8, lab: { by_weak: { attacker: 3, support: 4 } } },
  'by Weak to 3 / 4 + Weak to role twice': { ...E8, lab: { by_weak: { attacker: 3, support: 4 }, weak_same: 2 } },
  '3 to 5 by score (built)': { ...E8, supports: 3, supports_max: 5 },
  '3 to 5, supports x0.8': { ...E8, supports: 3, supports_max: 5, lab: { w: 0.8 } },
  '3 to 5, supports x1.2': { ...E8, supports: 3, supports_max: 5, lab: { w: 1.2 } },
  '3 to 5 + Weak to role twice': { ...E8, supports: 3, supports_max: 5, lab: { weak_same: 2 } },
  '2 to 6 by score': { ...E8, supports: 2, supports_max: 6 },
  '2 to 5 by score': { ...E8, supports: 2, supports_max: 5 },
  '3 to 4 by score': { ...E8, supports: 3, supports_max: 4 },
  '4 to 5 by score': { ...E8, supports: 4, supports_max: 5 },
};

/** The candidates on one pool set: mean ratio vs the searched best, the bosses below x0.85, per boss. */
export function shapePickLab(cfg, { seed = 1, pools = 2, candidates = SHAPE_CANDIDATES, refs, ...o } = {}) {
  const R = refs || referencePools(cfg, { seed, pools, ...o });
  const keys = [...new Set(R.map((r) => r.key))]; const C = Object.keys(candidates);
  const res = Object.fromEntries(C.map((c) => [c, {}]));
  for (const r of R) {
    const memo = new Map();
    for (const c of C) {
      const ids = autoPick(patch(cfg, { auto_v2: { pick: candidates[c] } }), r.pool, r.boss, 8).ids;
      const k = [...ids].sort((a, b) => a - b).join(); if (!memo.has(k)) memo.set(k, r.eval(ids) / r.vB);
      (res[c][r.key] ||= []).push(memo.get(k));
    }
  }
  const sum = Object.fromEntries(C.map((c) => { const per = Object.fromEntries(keys.map((k) => [k, mean(res[c][k])])); return [c, { mean: mean(Object.values(res[c]).flat()), below: keys.filter((k) => per[k] < 0.85).length, per }]; }));
  const flat = (c) => keys.flatMap((k) => res[c][k]); const base = flat(C[0]);
  const FOUR = ['camper_colossus', 'maw', 'skeleton', 'pumpkin'].filter((k) => keys.includes(k));
  let md = `# The Hunt auto-pick shape (seed ${seed}, ${pools} pools a boss, ${R.length} pools)\n\n`;
  md += 'Ratio = the pick of the candidate + Auto v2 / the searched best squad + the scripted best play (the E8 reference: the search starts from the E8 pick and the top 8 by attack). ';
  md += `Paired = the mean over the pools of (candidate - ${C[0]}), with its standard error. The per-card score is the E8 offense score in every candidate.\n\n`;
  md += table(['candidate', 'mean', 'bosses below x0.85', 'paired', 'pools better / worse', 'lowest pool', ...FOUR], C.map((c) => {
    const d = flat(c).map((x, i) => x - base[i]); const m = mean(d); const e = d.length > 1 ? sd(d) / Math.sqrt(d.length - 1) : 0;
    return [c, ratio(sum[c].mean, 3), String(sum[c].below), `${m >= 0 ? '+' : ''}${m.toFixed(4)} (se ${e.toFixed(4)})`,
      `${d.filter((x) => x > 1e-12).length} / ${d.filter((x) => x < -1e-12).length}`, ratio(Math.min(...flat(c)), 3), ...FOUR.map((k) => ratio(sum[c].per[k], 3))];
  }));
  md += '\n### Per boss (the mean of its pools)\n\n' + table(['boss', 'Weak to', ...C], [...keys.map((k) => [k, R.find((r) => r.key === k).boss.weak_role || '-', ...C.map((c) => ratio(sum[c].per[k], 3))]),
    ['MEAN', '', ...C.map((c) => ratio(sum[c].mean, 3))], ['bosses below x0.85', '', ...C.map((c) => String(sum[c].below))]]);
  const sh = R.map((r) => shapeOf(r.pool, r.best));
  const hist = {}; for (const x of sh) hist[x.supports] = (hist[x.supports] || 0) + 1;
  md += `\nThe searched best squads: pools by support count ${JSON.stringify(hist)}; a support role twice or more in ${sh.filter((x) => x.maxSame > 1).length} of ${sh.length} pools.\n`;
  const head = [`seed ${seed} (${R.length} pools): ${C.map((c) => `${c} ${ratio(sum[c].mean, 3)} (${sum[c].below} below)`).join('; ')}`];
  return { md, head, data: { sum, res, shapes: sh } };
}
