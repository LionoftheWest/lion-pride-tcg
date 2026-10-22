// score.mjs - the per-card score of the Hunt auto-pick with the real Set 1 actives (plan 20.9; after plan 20.8: the live shape permits a good squad, the
// per-card score does not find it). Measurement only: no SQL, no balance number. The live shape rule (3 to 5 supports by score, max_same_support 1) stays
// in every candidate; each candidate changes one part of the per-card score (auto.mjs pickBase: value x role answers x Weak to bonus x pair score):
//   node card-studio/v2sim/run.mjs scorepick --set1 --seed N     the candidates and the "why it misses" diagnosis on the Set 1 pools of one seed
//   node card-studio/v2sim/run.mjs scorepick --seed N            the same on the template pools (no diagnosis)
//   node card-studio/v2sim/run.mjs answers1                      the role answers measured again with the Set 1 actives (the candidate "answers Set 1")
//   node card-studio/v2sim/run.mjs scoresum                      the table over the seeds (reads the JSON of each scorepick run)
// The protocol is the one of plan 20.7 and 20.8 (shape.mjs referencePools): the same pools, the same searched reference (play best), the same 150
// evaluation days. The searched squads are kept in out/v2sim/score-ref-<mode>-<seed>.json (ids and numbers only), so a second run skips the search.
// The Set 1 actives are PRIVATE: every output holds roles, terms, counts and ratios only (no card key, no card name, no active text).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { classOf, ROLES, makeCard } from './cards.mjs';
import { huntDay, bossKeys } from './modes.mjs';
import { autoPick, pickBase, pairOf, pickBoss } from './auto.mjs';
import { powerInput, familyPP, powerOf } from './power.mjs';
import { referencePools, poolSource } from './shape.mjs';
import { hash, mean, median, sd, table, ratio, fmt, patch, HERE } from './util.mjs';
import { loadSet1Batch, withSet1 } from './teams.mjs';

export const OUT = () => join(HERE, '..', 'out', 'v2sim');
const ACT = new WeakMap(); const ACT_RUNS = 400;
const REF = [['striker', 'striker.lockon'], ['flurry', 'flurry.storm'], ['warden', 'warden.shield'], ['spotter', 'spotter.expose']];

// The parts of a candidate score in one object, so that a test can plant a fault in one part (score.test.mjs; the pattern of shape.mjs S1).
export const SC = {
  /** The active value share of a card (the E9 decision-3 term, power.mjs cardPower): F x ABL x u x V with V = value.smite x PP(smite) + value.dot x
   * PP(dot) + value.control x PP(control) and u = 1 / (support_pp.smite x sup_cycle). The E9 support offense adds atk x this share for the active. An
   * attacker counts its status families only (power.mjs blockFamilies), and F = 1. sc = a simulator card (makeCard). */
  actShare(cfg, sc) {
    const x = powerInput(cfg, sc); const pp = familyPP(cfg, x.class, x.blocks, x.extra_stack); const P = cfg.v2_power;
    const V = P.value.smite * pp.smite + P.value.dot * pp.dot + P.value.control * pp.control;
    return x.f * x.abl * V / (cfg.v2_pp.support_pp.smite * cfg.ability_v2.pp.sup_cycle);
  },
  /** The measured active factor of a template: the strength of a Normal card of its role at the casual investment with this active (cp_mod 1; the card
   * + the 4 reference cards of plan experiment 4, Hunt Heroic net damage a day, no mechanic, policy autov2, the same days for every card) / the mean of
   * the templates of the same set (Set 1 or placeholder) and role. One number for each active, measured once (a card fact, as cp_mod). */
  activeFactor(cfg, tid, runs = ACT_RUNS, seed = 'active-factor') {
    let m = ACT.get(cfg); if (!m) { m = new Map(); ACT.set(cfg, m); }
    const role = cfg.v2_templates[tid].role; const s1 = tid.startsWith('s1.'); const gk = `${s1 ? 's1' : 'tpl'}:${role}:${runs}:${seed}`;
    if (!m.has(gk)) {
      const ref = REF.map(([r, t]) => makeCard(cfg, { key: `ref-${r}`, role: r, rarity: 'normal', template: t, stars: 2, level: 15 }));
      const ts = Object.keys(cfg.v2_templates).filter((k) => !k.startsWith('_') && cfg.v2_templates[k].role === role && k.startsWith('s1.') === s1).sort();
      const v = ts.map((t) => { const card = makeCard(cfg, { key: `actf-${role}`, role, rarity: 'normal', template: t, ...cfg.v2_investment.casual }); let x = 0;
        for (let i = 0; i < runs; i++) x += huntDay(cfg, [card, ...ref], { tier: 'Heroic', seed: hash(seed, i), sigs: [], policy: 'autov2' }).net; return x / runs; });
      const mu = mean(v); m.set(gk, new Map(ts.map((t, i) => [t, v[i] / mu])));
    }
    return m.get(gk).get(tid);
  },
  /** The pool and the config of the pick of one candidate: cand.value(cfg, poolCard) sets the card's pick value (auto.mjs pickBase reads `power`);
   * cand.pick and cand.enemy patch auto_v2.pick and v2_enemy for the PICK only (the fight keeps the live numbers). */
  prepare(cfg, pool, cand) {
    const pc = cand.pick || cand.enemy ? patch(cfg, { ...(cand.pick ? { auto_v2: { pick: cand.pick } } : {}), ...(cand.enemy ? { v2_enemy: cand.enemy } : {}) }) : cfg;
    const p2 = cand.value ? pool.map((c) => { const v = cand.value(cfg, c); return typeof v === 'number' ? { ...c, power: v } : c; }) : pool;
    return { cfg: pc, pool: p2 };
  },
};
const off = (c) => c.atk * (1 + c.crt * (c.crd - 1)) * c.spd;
/** The value "offense x (1 + lam x the active value share)" (cls: 'support' = supports only, else every card). */
export const actValue = (lam, cls = 'support') => (cfg, c) => (cls === 'all' || c.class === cls ? off(c) * (1 + lam * SC.actShare(cfg, c.card)) : undefined);
/** The value "offense x the measured active factor ^ g" (cls: 'support' = supports only, else every card). */
export const measuredValue = (g, cls = 'all') => (cfg, c) => (cls === 'all' || c.class === cls ? off(c) * SC.activeFactor(cfg, c.card.active.id) ** g : undefined);
/** The Weak to bonus of the pick: 1 + w for the Weak to role, every role the same (Controller included: the live Controller has damage_x 0). */
const weakAll = (w) => ({ weak_role_x: w, weak_role_rules: { controller: { damage_x: w } } });

// The answers measured on the Set 1 actives (run.mjs answers1 writes the file); the candidate is skipped when the file is missing.
export const ANSWERS1 = () => join(OUT(), 'answers-set1.json');
const answers1 = () => (existsSync(ANSWERS1()) ? JSON.parse(readFileSync(ANSWERS1(), 'utf8')).answers : null);
const noAnswers = (cfg) => Object.fromEntries(Object.entries(cfg.auto_v2.pick.answers).map(([m, o]) => [m, Object.fromEntries(Object.keys(o).map((r) => [r, 1]))]));

export const LIVE = 'live (E8 offense score)';
// the paired base, the diagnosis and the summary are parts of SC too (score.test.mjs plants a fault in each)
SC.base = LIVE; SC.why = (...a) => whyMisses(...a); SC.summarize = (...a) => summarize(...a);
/** The candidates (functions of the config, so that the measured tables load at run time). Each is general: no per-boss rule. */
export function scoreCandidates(cfg) {
  const A1 = answers1();
  return {
    [LIVE]: {},
    'offense + active x0.5 (supports)': { value: actValue(0.5) },
    'offense + active x1 (supports)': { value: actValue(1) },
    'offense + active x2 (supports)': { value: actValue(2) },
    'offense + active x1 (all cards)': { value: actValue(1, 'all') },
    'offense x measured active (all cards)': { value: measuredValue(1) },
    'offense x measured active ^0.5 (all cards)': { value: measuredValue(0.5) },
    'offense x measured active ^2 (all cards)': { value: measuredValue(2) },
    'offense x measured active (supports)': { value: measuredValue(1, 'support') },
    'E9 Power': { value: (c, x) => powerOf(c, x.card).value },
    'E9 Power without Survival': { value: (c, x) => { const p = powerOf(c, x.card); return p.offense * p.k; } },
    'Weak to +0.5, every role': { enemy: weakAll(0.5) },
    'Weak to +1.0, every role': { enemy: weakAll(1) },
    'Weak to +0.25, every role': { enemy: weakAll(0.25) },
    'no Weak to bonus': { enemy: weakAll(0) },
    'no role answers': { pick: { answers: noAnswers(cfg) } },
    ...(A1 ? { 'answers Set 1': { pick: { answers: A1 } } } : {}),
    'no pair score': { pick: { pair_floor: 1 } },
    ...(A1 ? { 'answers Set 1 + Weak to +0.5, every role': { pick: { answers: A1 }, enemy: weakAll(0.5) } } : {}),
    'offense + active x1 (supports) + Weak to +0.5, every role': { value: actValue(1), enemy: weakAll(0.5) },
  };
}

// ---------------------------------------------------------------------------------------------------------------- why the score misses
const TERMS = ['off', 'ans', 'weak', 'pair'];
/** One pool: the live pick L against the best squad inside the live shape S. The cards of S that L misses (X) and the cards of L that S does not take
 * (Y) are matched in pairs: in the same class first (the highest scores together), then the cards left across the class (a support count that
 * differs). For each pair: log(Y / X) of each score term (offense, answers, Weak to, pair; the pair score of X in S and of Y in L), the term that
 * favors Y the most (the term that ranks the pair wrong; "none" when no term favors Y), the roles of Y and X and the active value share of each.
 * Roles and terms only: no card id leaves this function. */
export function whyMisses(cfg, r, L, S) {
  const by = new Map(r.pool.map((c) => [c.id, c])); const B = new Map(r.pool.map((c) => [c.id, pickBase(cfg, c, r.boss)]));
  const sqL = L.map((id) => by.get(id)), sqS = S.map((id) => by.get(id)); const cls = (id) => classOf(by.get(id).role);
  const term = (id, sq) => ({ ...B.get(id), pair: pairOf(cfg, by.get(id), sq) }); const sc = (t) => t.off * t.ans * t.weak * t.pair;
  const desc = (a, b) => sc(b.t) - sc(a.t);
  const X = S.filter((id) => !L.includes(id)).map((id) => ({ id, t: term(id, sqS) })).sort(desc), Y = L.filter((id) => !S.includes(id)).map((id) => ({ id, t: term(id, sqL) })).sort(desc);
  const used = new Set(); const pairs = [];
  const mk = (x, y, cross) => {
    used.add(x.id); used.add(y.id);
    const lr = Object.fromEntries(TERMS.map((k) => [k, Math.log(y.t[k] / x.t[k])])); const w = TERMS.reduce((a, k) => (lr[k] > lr[a] ? k : a), 'off');
    const xr = by.get(x.id).role, yr = by.get(y.id).role;
    const kind = cross ? 'cross class' : xr === yr ? 'same role' : 'same class';
    // no term favors Y: the same score (a tie: the lower card id wins), or the missed card scores higher and the live rule left it out by the role
    // limit (its role is full in L) or by the fill order
    const full = classOf(xr) === 'support' && sqL.filter((c) => c.role === xr).length >= cfg.auto_v2.pick.max_same_support;
    pairs.push({ cross, kind, missed: xr, picked: yr, lr, wrong: lr[w] > 1e-9 ? w : Math.abs(TERMS.reduce((q, k) => q + lr[k], 0)) < 1e-9 ? 'none: tie' : (full ? 'none: role limit' : 'none: order'),
      actMissed: SC.actShare(cfg, by.get(x.id).card), actPicked: SC.actShare(cfg, by.get(y.id).card), weakMissed: by.get(x.id).role === r.boss.weak_role, weakPicked: by.get(y.id).role === r.boss.weak_role });
  };
  for (const k of ['attacker', 'support']) { const xs = X.filter((x) => cls(x.id) === k), ys = Y.filter((y) => cls(y.id) === k); for (let i = 0; i < Math.min(xs.length, ys.length); i++) mk(xs[i], ys[i], false); }
  const xl = X.filter((x) => !used.has(x.id)), yl = Y.filter((y) => !used.has(y.id)); for (let i = 0; i < Math.min(xl.length, yl.length); i++) mk(xl[i], yl[i], true);
  return { pairs, supL: L.filter((i) => cls(i) === 'support').length, supS: S.filter((i) => cls(i) === 'support').length };
}

// ---------------------------------------------------------------------------------------------------------------- one seed
function refCache(file) {
  const m = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}; let dirty = false;
  return { get: (k, pi) => m[`${k}:${pi}`], set: (k, pi, v) => { m[`${k}:${pi}`] = v; dirty = true; }, save: () => { if (dirty) { mkdirSync(OUT(), { recursive: true }); writeFileSync(file, JSON.stringify(m)); } } };
}
/** The candidates on the pools of one seed. set1: true (the private batch) or a {key: active} map (a test). Returns per pool: the boss, the ratio of each
 * candidate, the live / in-shape diagnosis (Set 1 mode). */
export function scorePickLab(cfg, { seed = 101, pools = 2, set1, candidates, refs, cache = true, save = false, ...o } = {}) {
  const src = poolSource(cfg, { set1 }); const c1 = src.cfg; const mode = src.mode;
  const C = candidates || scoreCandidates(c1); const names = Object.keys(C);
  if (!names.includes(LIVE)) throw new Error(`scorePickLab: the candidates need the live score "${LIVE}"`);
  const refTag = o.ref && o.ref !== 'best' ? `-ref${o.ref}` : '';
  const rc = cache && !refs ? refCache(join(OUT(), `score-ref-${mode}${refTag}-${seed}${o.bosses ? `-${o.bosses.join('_')}` : ''}.json`)) : null;
  const R = refs || referencePools(cfg, { seed, pools, src, shapeSearch: mode === 'set1', cache: rc || undefined, ...o });
  rc?.save();
  const rows = [];
  for (const r of R) {
    const memo = new Map(); const ratios = {}; let liveIds;
    for (const n of names) {
      const p = SC.prepare(c1, r.pool, C[n]); const ids = autoPick(p.cfg, p.pool, r.boss, 8).ids;
      if (n === LIVE) liveIds = ids;
      const k = [...ids].sort((a, b) => a - b).join(); if (!memo.has(k)) memo.set(k, r.eval(ids) / r.vB);
      ratios[n] = memo.get(k);
    }
    const row = { key: r.key, pi: r.pi, weak: r.boss.weak_role || null, ratios };
    if (r.inShape) { row.inShape = r.vShape / r.vB; row.why = SC.why(c1, r, liveIds, r.inShape); }
    rows.push(row);
  }
  const sum = SC.summarize(rows, names);
  let md = `# The per-card score of the Hunt auto-pick (seed ${seed}, ${R.length} pools, ${mode === 'set1' ? `the PRIVATE Set 1 actives (${src.cards} cards, ${src.pool0.length} in the draw list; roles, terms and ratios only)` : 'the template actives'})\n\n`;
  md += 'Ratio = the pick of the candidate + Auto v2 / the searched best squad + play best (plan 20.7 and 20.8). The live shape rule in every candidate. Paired = candidate - live over the pools (standard error).\n\n';
  md += table(['candidate', 'mean', 'bosses below x0.85', 'paired vs live', 'pools better / worse', 'hydra', 'camper_colossus', 'warlord'], names.map((n) => {
    const s = sum[n]; return [n, ratio(s.mean, 3), String(s.below), `${s.m >= 0 ? '+' : ''}${s.m.toFixed(4)} (${s.se.toFixed(4)})`, `${s.better} / ${s.worse}`, ...['hydra', 'camper_colossus', 'warlord'].map((k) => (s.per[k] === undefined ? '-' : ratio(s.per[k], 3)))];
  }));
  md += `\nBosses below x0.85 (live): ${sum[LIVE].lowKeys.join(', ') || 'none'}.\n`;
  if (mode === 'set1') md += '\n' + whyReport(rows, sum[LIVE]).md;
  const head = [`seed ${seed} (${mode}): ${names.map((n) => `${n} ${ratio(sum[n].mean, 3)} (${sum[n].below})`).join('; ')}`];
  const data = { seed, mode, pools: R.length, names, rows };
  if (save) { mkdirSync(OUT(), { recursive: true }); writeFileSync(join(OUT(), `scorepick-${mode}${refTag}-${seed}.json`), JSON.stringify(data)); }
  return { md, head, data };
}
export function summarize(rows, names) {
  const keys = [...new Set(rows.map((r) => r.key))];
  return Object.fromEntries(names.map((n) => {
    const per = Object.fromEntries(keys.map((k) => [k, mean(rows.filter((r) => r.key === k).map((r) => r.ratios[n]))]));
    const d = rows.map((r) => r.ratios[n] - r.ratios[SC.base]);
    return [n, { mean: mean(rows.map((r) => r.ratios[n])), per, below: keys.filter((k) => per[k] < 0.85).length, lowKeys: keys.filter((k) => per[k] < 0.85),
      m: mean(d), se: d.length > 1 ? sd(d) / Math.sqrt(d.length - 1) : 0, better: d.filter((x) => x > 1e-12).length, worse: d.filter((x) => x < -1e-12).length }];
  }));
}
/** The diagnosis over the pools of the low boss cells (live boss mean below x0.85) and over all pools: the support count, the kind of each card pair
 * (the same role, another role of the same class, across the class), the term that ranks the pair wrong, the role moves, the active value share of
 * the missed and the picked cards, the Weak to role. */
const WRONG = ['off', 'ans', 'weak', 'pair', 'none: tie', 'none: role limit', 'none: order'];
const KINDS = ['same role', 'same class', 'cross class'];
export function whyReport(rows, liveSum) {
  const low = rows.filter((r) => r.why && (r.low ?? liveSum.lowKeys.includes(r.key))); const all = rows.filter((r) => r.why);   // r.low: set by scoreSum (the low cells of the row's own seed)
  const agg = (rs) => {
    const P = rs.flatMap((r) => r.why.pairs); const cnt = (ps, f) => { const o = {}; for (const p of ps) o[f(p)] = (o[f(p)] || 0) + 1; return o; };
    return { n: rs.length, pairs: P.length, kinds: Object.fromEntries(KINDS.map((k) => { const ps = P.filter((p) => p.kind === k);
        return [k, { n: ps.length, wrong: cnt(ps, (p) => p.wrong), lr: Object.fromEntries(TERMS.map((t) => [t, ps.length ? mean(ps.map((p) => p.lr[t])) : 0])),
          actMissed: ps.length ? mean(ps.map((p) => p.actMissed)) : 0, actPicked: ps.length ? mean(ps.map((p) => p.actPicked)) : 0,
          weakMissed: ps.filter((p) => p.weakMissed).length, weakPicked: ps.filter((p) => p.weakPicked).length }]; })),
      moves: Object.entries(cnt(P, (p) => `${p.picked} -> ${p.missed}`)).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)),
      supL: rs.length ? mean(rs.map((r) => r.why.supL)) : 0, supS: rs.length ? mean(rs.map((r) => r.why.supS)) : 0,
      liveR: rs.length ? mean(rs.map((r) => r.ratios[LIVE])) : 0, shapeR: rs.length ? mean(rs.map((r) => r.inShape)) : 0 };
  };
  const A = { low: agg(low), all: agg(all) };
  let md = '### Why the score misses (the live pick against the best squad inside the live shape; roles and terms only)\n\n';
  md += table(['pools', 'n', 'live / best', 'in-shape best / best', 'supports: live / in-shape best', 'card pairs: same role / same class / cross class'],
    Object.entries(A).map(([k, a]) => [k === 'low' ? 'low boss cells' : 'all pools', String(a.n), ratio(a.liveR, 3), ratio(a.shapeR, 3), `${fmt(a.supL, 2)} / ${fmt(a.supS, 2)}`, KINDS.map((x) => a.kinds[x].n).join(' / ')]));
  md += '\nPer kind of pair: the term that favors the picked card the most (the wrong term; "none: tie" = the same score, the lower card id wins; other "none" = the missed card scores higher, left out by the role limit or the fill order), the mean log(picked / missed) of each term, the active value share and the Weak to role of each side.\n\n';
  md += table(['pools', 'kind', 'pairs', `wrong term: ${WRONG.join(' / ')}`, 'mean log(picked / missed): off, ans, weak, pair', 'active share: missed / picked', 'Weak to role: missed / picked'],
    Object.entries(A).flatMap(([k, a]) => KINDS.map((x) => { const q = a.kinds[x]; return [k === 'low' ? 'low boss cells' : 'all pools', x, String(q.n), WRONG.map((t) => q.wrong[t] || 0).join(' / '),
      TERMS.map((t) => fmt(q.lr[t], 3)).join(', '), `${fmt(q.actMissed, 3)} / ${fmt(q.actPicked, 3)}`, `${q.weakMissed} / ${q.weakPicked}`]; })));
  md += `\nRole moves in the low boss cells (picked -> missed, count): ${A.low.moves.slice(0, 14).map(([k, v]) => `${k} ${v}`).join('; ') || 'none'}.\n`;
  md += `\nRole moves in all pools: ${A.all.moves.slice(0, 14).map(([k, v]) => `${k} ${v}`).join('; ') || 'none'}.\n`;
  return { md, data: A };
}

// ---------------------------------------------------------------------------------------------------------------- the sum over the seeds
/** The table over the seeds: each candidate, each seed (mean, bosses below x0.85), the paired gain vs live over all pools (standard error), the
 * named bosses, and the rule "better = the mean up and the count below x0.85 not higher on the tuning seed AND every held-out seed". */
export function scoreSum(cfg, { mode = 'set1', seeds = [101, 1, 202, 303, 404], tuning = 101, named = ['hydra', 'camper_colossus', 'warlord'], ref = 'best' } = {}) {
  const D = seeds.map((s) => { const f = join(OUT(), `scorepick-${mode}${ref !== 'best' ? `-ref${ref}` : ''}-${s}.json`); if (!existsSync(f)) throw new Error(`scoresum: run scorepick for seed ${s} first (${f})`); return JSON.parse(readFileSync(f, 'utf8')); });
  const names = D[0].names.filter((n) => D.every((d) => d.names.includes(n)));
  const S = D.map((d) => SC.summarize(d.rows, names)); const allRows = D.flatMap((d) => d.rows);
  const tot = SC.summarize(allRows, names);
  const better = (n) => S.every((s) => s[n].mean > s[LIVE].mean + 1e-12 && s[n].below <= s[LIVE].below);
  let md = `# The per-card score over the seeds (${mode}; tuning seed ${tuning}; held-out ${seeds.filter((s) => s !== tuning).join(', ')})\n\n"x0.881 (3)" = the mean ratio and the bosses below x0.85. Paired = candidate - live over the ${allRows.length} pools (standard error). Better = the mean up and the count below x0.85 not higher on every seed.\n\n`;
  md += table(['candidate', ...seeds.map((s) => `seed ${s}`), `paired vs live, ${allRows.length} pools`, 'better / worse pools', 'better on every seed'], names.map((n) => [n, ...S.map((s) => `${ratio(s[n].mean, 3)} (${s[n].below})`),
    `${tot[n].m >= 0 ? '+' : ''}${tot[n].m.toFixed(4)} (${tot[n].se.toFixed(4)})`, `${tot[n].better} / ${tot[n].worse}`, n === LIVE ? '-' : (better(n) ? 'YES' : 'no')]));
  const lowAny = [...new Set(S.flatMap((s) => s[LIVE].lowKeys))].filter((k) => !named.includes(k));
  const show = [...named, ...lowAny];
  md += `\n### The named bosses and every boss below x0.85 with the live score (per seed: ${seeds.join(' / ')})\n\n`;
  md += table(['candidate', ...show], names.map((n) => [n, ...show.map((k) => S.map((s) => (s[n].per[k] === undefined ? '-' : s[n].per[k].toFixed(3).slice(1))).join('/'))]));
  if (mode === 'set1') { const flagged = D.flatMap((d, i) => d.rows.map((r) => ({ ...r, low: S[i][LIVE].lowKeys.includes(r.key) })));
    md += '\n' + whyReport(flagged, { lowKeys: [] }).md.replace('### ', '### (all seeds) '); }
  const head = [`${mode}: ${names.map((n) => `${n} ${tot[n].m >= 0 ? '+' : ''}${tot[n].m.toFixed(4)} (${tot[n].se.toFixed(4)})${n !== LIVE && better(n) ? ' BETTER' : ''}`).join('; ')}`];
  return { md, head, data: { seeds, names, per: S.map((s) => Object.fromEntries(names.map((n) => [n, { mean: s[n].mean, below: s[n].below, per: s[n].per }]))), total: Object.fromEntries(names.map((n) => [n, { m: tot[n].m, se: tot[n].se }])), better: names.filter((n) => n !== LIVE && better(n)) } };
}

// ---------------------------------------------------------------------------------------------------------------- the role answers on Set 1
// The protocol of auto.mjs measureAnswers with the Set 1 actives in place of the placeholder templates and the fight policy autov2 (the policy best
// scripts only the placeholder ids): for each mechanic of the 16 named bosses at Heroic, the strength of each Set 1 card (Normal, casual; the card + the
// 4 reference cards, Hunt Heroic net damage a day) with the mechanic alone on the tier boss / with no mechanic; the role mean of that ratio / the median
// role. Rounded, inside [0.5, 2], 1 when it differs from 1 by less than 0.05 (the stored rule).
export function measureAnswersSet1(cfg, { runs = 300, seeds = [1, 7], minDev = 0.05, lo = 0.5, hi = 2, set1 } = {}) {
  const S = set1 || loadSet1Batch(); const c1 = withSet1(cfg, S);
  const mechs = [...new Set(bossKeys(c1).flatMap((k) => pickBoss(c1, k, 'Heroic').mechanics))].sort();
  const inv = c1.v2_investment.casual; const ref = REF.map(([role, t]) => makeCard(c1, { key: `ref-${role}`, role, rarity: 'normal', template: t, stars: 2, level: 15 }));
  const byRole = Object.fromEntries(ROLES.map((r) => [r, Object.keys(S).filter((k) => S[k].role === r).sort().map((k) => makeCard(c1, { key: `s1-${r}`, role: r, rarity: 'normal', template: `s1.${k}`, ...inv }))]));
  const str = (card, sigs, sd) => { let s = 0; for (let i = 0; i < runs; i++) s += huntDay(c1, [card, ...ref], { tier: 'Heroic', seed: hash(sd, 'answers1', i), sigs, policy: 'autov2' }).net; return s / runs; };
  const v0 = seeds.map((sd) => Object.fromEntries(ROLES.map((r) => [r, byRole[r].map((c, j) => str(c, [], hash(sd, r, j)))])));
  const raw = {}, out = {};
  for (const m of mechs) {
    const per = seeds.map((sd, i) => { const rr = Object.fromEntries(ROLES.map((r) => [r, mean(byRole[r].map((c, j) => str(c, [m], hash(sd, r, j)) / v0[i][r][j]))])); const md = median(Object.values(rr)); return Object.fromEntries(ROLES.map((r) => [r, rr[r] / md])); });
    raw[m] = Object.fromEntries(ROLES.map((r) => [r, mean(per.map((x) => x[r]))]));
    out[m] = Object.fromEntries(ROLES.map((r) => { const a = Math.min(hi, Math.max(lo, Math.round(raw[m][r] * 100) / 100)); return [r, Math.abs(a - 1) >= minDev ? a : 1]; }));
  }
  // the full stored shape: every mechanic of the live table; a mechanic that no named boss has keeps its live row
  const answers = Object.fromEntries(Object.entries(cfg.auto_v2.pick.answers).map(([m, o]) => [m, out[m] || o]));
  return { answers, raw, mechs, counts: Object.fromEntries(ROLES.map((r) => [r, byRole[r].length])) };
}
export function answersSet1Experiment(cfg, opts = {}) {
  const r = measureAnswersSet1(cfg, opts);
  mkdirSync(OUT(), { recursive: true }); writeFileSync(ANSWERS1(), JSON.stringify({ answers: r.answers, raw: r.raw, mechs: r.mechs }));
  const live = cfg.auto_v2.pick.answers;
  let md = `# The role answers measured with the Set 1 actives (the mechanics of the 16 named bosses; ${opts.runs || 300} days a card; roles and numbers only)\n\nCell = the stored value (the live value in brackets when it differs).\n\n`;
  md += table(['mechanic', ...ROLES], r.mechs.map((m) => [m, ...ROLES.map((x) => (r.answers[m][x] === live[m]?.[x] ? fmt(r.answers[m][x], 2) : `${fmt(r.answers[m][x], 2)} (${fmt(live[m]?.[x] ?? 1, 2)})`))]));
  const diff = r.mechs.reduce((s, m) => s + ROLES.filter((x) => r.answers[m][x] !== (live[m]?.[x] ?? 1)).length, 0);
  return { md, head: [`${r.mechs.length} mechanics x ${ROLES.length} roles; ${diff} cells differ from the live table; cards a role ${JSON.stringify(r.counts)}.`], data: { answers: r.answers, mechs: r.mechs } };
}
