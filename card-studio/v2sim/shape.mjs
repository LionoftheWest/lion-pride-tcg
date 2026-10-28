// shape.mjs - the shape rule of the Hunt auto-pick (after PR E9, plan 20.6 Open item 1). The E8 Lab protocol (auto.mjs autoLab part 2, power.mjs
// powerPickLab): the same pools, seeds, searched reference and evaluation days. Each candidate = a patch of auto_v2.pick (the shape: how many supports, how
// many of one support role); the per-card score stays the E8 offense score. The reference (the searched best squad + the best policy) does not depend on
// the candidate. node card-studio/v2sim/run.mjs shapepick --seed 101|202|1 [--pools N]
// The Set 1 mode (plan 20.8): node card-studio/v2sim/run.mjs shapepick --set1 --seed N [--pools N] [--ref best|max]. The pools are drawn from the PRIVATE
// Set 1 batch (teams.mjs loadSet1Batch; never in this repo) with the real actives: the same pool size, the same rarity rule (a pullable finish of the
// live subject), the same investment rule, the same bosses, seeds, search and evaluation days. The report holds counts, roles and ratios only.
// --ref max: the reference play of a squad is the better of the policies best and autov2 (best scripts only the placeholder template ids).
import { makeCard, cardPool, classOf } from './cards.mjs';
import { huntDay, bossKeys } from './modes.mjs';
import { autoPick, poolEntry, pickBoss } from './auto.mjs';
import { mkRng, hash, mean, sd, table, ratio, patch } from './util.mjs';
import { subjects, withSet1, loadSets } from './teams.mjs';

// The parts of the Set 1 pool in one object, so that a test can plant a fault in one part (shape.test.mjs; the pattern of lab12.mjs K).
export const S1 = {
  /** The draw list of the Set 1 pools: each Set 1 card whose subject has a pullable finish (the rule of cards.mjs cardPool), with its Set 1 role and its
   * own active (template s1.<key>), in key order. cfg1 = withSet1(cfg, set1). */
  pool0: (cfg1, set1) => Object.keys(set1).sort().flatMap((key) => {
    const s = subjects(cfg1).get(key); const t = cfg1.v2_templates[`s1.${key}`];
    if (!s || !t) return [];
    const pullable = s.finishes.filter((f) => f.pool).map((f) => f.rarity);
    return pullable.length ? [{ key, role: t.role, cp_mod: s.cp_mod, pullable, template: `s1.${key}` }] : [];
  }),
  /** One pool card: the draw entry at a rarity and an investment (the template entry has no template: makeCard draws the placeholder). */
  card: (cfg, s, rar, iv) => makeCard(cfg, { key: s.key, role: s.role, rarity: rar, cp_mod: s.cp_mod, ...(s.template ? { template: s.template } : {}), ...iv }),
};
/** The pool source of a run: the template pools (cards.mjs cardPool, the placeholder actives) or the Set 1 pools (the real actives). */
export function poolSource(cfg, { set1, set2 } = {}) {
  if (!set1 && !set2) return { cfg, pool0: cardPool(cfg).filter((p) => p.pullable.length), mode: 'template' };
  const S = set1 && set1 !== true ? set1 : loadSets({ set2 }); const c1 = withSet1(cfg, S);
  // s2: the map holds Set 2 cards (a file name tag, so that a Set 1 cache is never read for Set 1 + Set 2 pools)
  return { cfg: c1, pool0: S1.pool0(c1, S), mode: 'set1', cards: Object.keys(S).length, s2: Object.values(S).some((a) => a.set === 2) };
}

/** One pool set: for each boss and pool the pool, the E8 pick, the searched best squad and its value (the E8 protocol). */
// ref: the reference play of a squad: 'best' (the E8 protocol) or 'max' (the better of best and autov2 on the same days, in the search and the evaluation).
// src: poolSource (default: the template pools). shapeSearch: also search the best squad that keeps the live shape rule (lo..hi supports, at most
// maxSame of one support role), from the live pick with no active factor (active_x 0, plan 20.10) (the ceiling of any per-card score under that shape). cache (score.mjs, plan 20.9): {get(key, pi),
// set(key, pi, v)} keeps the searched squads and their values (ids and numbers only), so that a second run skips the search; the pools are drawn again.
export function referencePools(cfg0, { seed = 1, pools = 2, poolSize = 20, searchDays = 24, evalDays = 150, bosses, src, ref = 'best', shapeSearch = false, cache } = {}) {
  const P = src || poolSource(cfg0); const cfg = P.cfg; const pool0 = P.pool0;
  if (pool0.length < poolSize) throw new Error(`referencePools: the draw list has ${pool0.length} cards, fewer than the pool size ${poolSize}`);
  if (!['best', 'max'].includes(ref)) throw new Error(`referencePools: ref must be best or max (${ref})`);
  const keys = bosses || bossKeys(cfg); const out = [];
  const days = (sq, key, policy, n, tag) => { let s = 0; for (let i = 0; i < n; i++) s += huntDay(cfg, sq, { tier: 'Heroic', boss: key, seed: hash(seed, tag, i), policy }).net; return s / n; };
  const refDays = (sq, key, n, tag) => (ref === 'best' ? days(sq, key, 'best', n, tag) : Math.max(days(sq, key, 'best', n, tag), days(sq, key, 'autov2', n, tag)));
  const live = cfg.auto_v2.pick; const lo = live.supports, hi = live.supports_max ?? live.supports, maxSame = live.max_same_support;
  for (const key of keys) {
    const boss = pickBoss(cfg, key, 'Heroic');
    for (let pi = 0; pi < pools; pi++) {
      const rng = mkRng(hash(seed, 'pick-pool', key, pi)); const used = new Set(); const pool = [];
      while (pool.length < poolSize) {
        const s = pool0[Math.floor(rng() * pool0.length)]; if (used.has(s.key)) continue; used.add(s.key);
        const rar = s.pullable[Math.floor(rng() * s.pullable.length)]; const iv = rng() < 0.5 ? cfg.v2_investment.casual : cfg.v2_investment.active;
        pool.push(poolEntry(S1.card(cfg, s, rar, iv), pool.length + 1));
      }
      const byId = new Map(pool.map((c) => [c.id, c.card])); const sq = (ids) => ids.map((id) => byId.get(id));
      const e8 = autoPick(patch(cfg, { auto_v2: { pick: E8 } }), pool, boss, 8).ids;   // the E8 start of the search (the reference of plan 20.5 and 20.6)
      const top = [...pool].sort((a, b) => b.atk - a.atk || a.id - b.id).slice(0, 8).map((c) => c.id);
      const score = (ids) => refDays(sq(ids), key, searchDays, `search-${pi}`);
      const search = (starts, ok = () => true) => {
        let best = null, bestV = -Infinity;
        for (const start of starts) {
          let cur = [...start], cv = score(cur), improved = true, sweeps = 0;
          while (improved && sweeps < 6) {
            improved = false; sweeps++;
            const outIds = pool.map((c) => c.id).filter((id) => !cur.includes(id));
            for (let i = 0; i < cur.length && !improved; i++) for (const j of outIds) { const nx = cur.map((x, k) => (k === i ? j : x)); if (!ok(nx)) continue; const v = score(nx); if (v > cv * 1.001) { cur = nx; cv = v; improved = true; break; } }
          }
          if (cv > bestV) { bestV = cv; best = cur; }
        }
        return best;
      };
      const hit = cache?.get(key, pi);
      const best = hit ? hit.best : search([e8, top]);
      const vB = hit ? hit.vB : refDays(sq(best), key, evalDays, `eval-${pi}`);
      const ev = (ids) => days(sq(ids), key, 'autov2', evalDays, `eval-${pi}`);
      const r = { key, pi, boss, pool, best, vB, eval: ev };
      if (shapeSearch) {   // the best squad inside the live shape rule (from the live pick), played by autov2 as the candidates are
        const keeps = (ids) => { const x = shapeOf(pool, ids); return x.supports >= lo && x.supports <= hi && x.maxSame <= maxSame; };
        if (hit?.inShape) { r.inShape = hit.inShape; r.vShape = hit.vShape; } else { r.inShape = search([autoPick(patch(cfg, { auto_v2: { pick: { active_x: 0 } } }), pool, boss, 8).ids], keeps); r.vShape = ev(r.inShape); }
      }
      if (cache && (!hit || (shapeSearch && !hit.inShape))) cache.set(key, pi, { best, vB, ...(shapeSearch ? { inShape: r.inShape, vShape: r.vShape } : {}) });
      out.push(r);
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
// active_x 0: the E8 score has no active factor (plan 20.10), so the searched reference does not depend on the factors of a run
const E8 = { supports: 4, supports_max: 4, max_same_support: 1, active_x: 0 };
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

// The bosses that the plan names in 20.7 and 20.8 (public boss keys).
export const NAMED = ['camper_colossus', 'maw', 'warzombie', 'skeleton', 'pumpkin', 'vampire'];
export const LIVE = '3 to 5 by score (built)';

/** Pick or pool (plan 20.8): for each boss, the share of the draw list with its Weak to role, the mean count of that role in a pool, in the searched
 * best and in the live pick, the searched best that breaks the live shape, and (with shapeSearch) the ratio of the best squad inside the live shape. */
export function pickOrPool(cfg, R, pool0, liveIds) {
  const P = cfg.auto_v2.pick; const lo = P.supports, hi = P.supports_max ?? P.supports;
  const keys = [...new Set(R.map((r) => r.key))];
  return keys.map((key) => {
    const rs = R.filter((r) => r.key === key); const w = rs[0].boss.weak_role;
    const roleOf = (r) => new Map(r.pool.map((c) => [c.id, c.role]));
    const nW = (r, ids) => { const m = roleOf(r); return ids.filter((id) => m.get(id) === w).length; };
    const sh = rs.map((r) => shapeOf(r.pool, r.best));
    return { key, weak: w || null, drawShare: w ? pool0.filter((s) => s.role === w).length / pool0.length : null,
      inPool: w ? mean(rs.map((r) => r.pool.filter((c) => c.role === w).length)) : null,
      inBest: w ? mean(rs.map((r) => nW(r, r.best))) : null, inLive: w ? mean(rs.map((r) => nW(r, liveIds.get(r)))) : null,
      bestSupports: mean(sh.map((x) => x.supports)), breaks: sh.filter((x) => x.supports < lo || x.supports > hi || x.maxSame > P.max_same_support).length, pools: rs.length,
      inShape: rs.every((r) => r.vShape !== undefined) ? mean(rs.map((r) => r.vShape / r.vB)) : null };
  });
}

/** The candidates on one pool set: mean ratio vs the searched best, the bosses below x0.85, per boss. set1: true (the private batch) or a {key: active}
 * map (a test) for the Set 1 pools; ref: the reference play (referencePools); base: the candidate of the paired column (default the first). */
export function shapePickLab(cfg, { seed = 1, pools = 2, candidates = SHAPE_CANDIDATES, refs, set1, set2, ref = 'best', base, shapeSearch, ...o } = {}) {
  const src = poolSource(cfg, { set1, set2 }); const c1 = src.cfg;
  const R = refs || referencePools(cfg, { seed, pools, src, ref, shapeSearch: shapeSearch ?? !!set1, ...o });
  const keys = [...new Set(R.map((r) => r.key))]; const C = Object.keys(candidates);
  const B0 = base || (set1 && C.includes(LIVE) ? LIVE : C[0]);
  const res = Object.fromEntries(C.map((c) => [c, {}])); const liveIds = new Map();
  for (const r of R) {
    const memo = new Map();
    for (const c of C) {
      const ids = autoPick(patch(c1, { auto_v2: { pick: candidates[c] } }), r.pool, r.boss, 8).ids;
      if (c === LIVE) liveIds.set(r, ids);
      const k = [...ids].sort((a, b) => a - b).join(); if (!memo.has(k)) memo.set(k, r.eval(ids) / r.vB);
      (res[c][r.key] ||= []).push(memo.get(k));
    }
    if (!liveIds.has(r)) liveIds.set(r, autoPick(c1, r.pool, r.boss, 8).ids);
  }
  const sum = Object.fromEntries(C.map((c) => { const per = Object.fromEntries(keys.map((k) => [k, mean(res[c][k])])); return [c, { mean: mean(Object.values(res[c]).flat()), below: keys.filter((k) => per[k] < 0.85).length, per }]; }));
  const flat = (c) => keys.flatMap((k) => res[c][k]); const baseV = flat(B0);
  const paired = Object.fromEntries(C.map((c) => { const d = flat(c).map((x, i) => x - baseV[i]); return [c, { d, m: mean(d), se: d.length > 1 ? sd(d) / Math.sqrt(d.length - 1) : 0 }]; }));
  const SIX = NAMED.filter((k) => keys.includes(k));
  const what = src.mode === 'set1' ? `the PRIVATE Set 1 batch (${src.cards} cards, ${src.pool0.length} with a pullable finish; counts only)` : 'the template actives';
  let md = `# The Hunt auto-pick shape (seed ${seed}, ${pools} pools a boss, ${R.length} pools; pools from ${what}; reference play ${ref})\n\n`;
  md += 'Ratio = the pick of the candidate + Auto v2 / the searched best squad + the reference play (the E8 reference: the search starts from the E8 pick and the top 8 by attack; play `best`, or with --ref max the better of `best` and `autov2`). ';
  md += `Paired = the mean over the pools of (candidate - ${B0}), with its standard error. The per-card score is the E8 offense score in every candidate.\n\n`;
  md += table(['candidate', 'mean', 'bosses below x0.85', 'paired', 'pools better / worse', 'lowest pool', ...SIX], C.map((c) => {
    const { d, m, se } = paired[c];
    return [c, ratio(sum[c].mean, 3), String(sum[c].below), `${m >= 0 ? '+' : ''}${m.toFixed(4)} (se ${se.toFixed(4)})`,
      `${d.filter((x) => x > 1e-12).length} / ${d.filter((x) => x < -1e-12).length}`, ratio(Math.min(...flat(c)), 3), ...SIX.map((k) => ratio(sum[c].per[k], 3))];
  }));
  md += '\n### Per boss (the mean of its pools)\n\n' + table(['boss', 'Weak to', ...C], [...keys.map((k) => [k, R.find((r) => r.key === k).boss.weak_role || '-', ...C.map((c) => ratio(sum[c].per[k], 3))]),
    ['MEAN', '', ...C.map((c) => ratio(sum[c].mean, 3))], ['bosses below x0.85', '', ...C.map((c) => String(sum[c].below))]]);
  const sh = R.map((r) => shapeOf(r.pool, r.best));
  const hist = {}; for (const x of sh) hist[x.supports] = (hist[x.supports] || 0) + 1;
  md += `\nThe searched best squads: pools by support count ${JSON.stringify(hist)}; a support role twice or more in ${sh.filter((x) => x.maxSame > 1).length} of ${sh.length} pools.\n`;
  const pp = pickOrPool(c1, R, src.pool0, liveIds);
  md += '\n### Pick or pool (each boss: its Weak to role in the draw list, in a pool, in the searched best and in the live pick; the best inside the live shape)\n\n';
  md += table(['boss', 'Weak to', 'share of the draw list', 'in a pool (of 20)', 'in the searched best', 'in the live pick', 'best: supports', 'best breaks the live shape', 'best inside the live shape / best'],
    pp.map((x) => [x.key, x.weak || '-', x.drawShare === null ? '-' : x.drawShare.toFixed(3), x.inPool === null ? '-' : x.inPool.toFixed(2), x.inBest === null ? '-' : x.inBest.toFixed(2),
      x.inLive === null ? '-' : x.inLive.toFixed(2), x.bestSupports.toFixed(2), `${x.breaks} of ${x.pools}`, x.inShape === null ? '-' : ratio(x.inShape, 3)]));
  const head = [`seed ${seed} (${R.length} pools, ${src.mode}, ref ${ref}): ${C.map((c) => `${c} ${ratio(sum[c].mean, 3)} (${sum[c].below} below)`).join('; ')}`];
  return { md, head, data: { sum, res, shapes: sh, paired: Object.fromEntries(C.map((c) => [c, { m: paired[c].m, se: paired[c].se }])), base: B0, pickOrPool: pp, mode: src.mode, ref } };
}
