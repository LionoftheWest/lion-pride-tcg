// active.mjs - the measured active factor of the Hunt auto-pick, as built (plan 20.10; the measurement of plan 20.9). The pick score of a support with a
// factor = its offense x pick_factor ^ auto_v2.pick.active_x (auto.mjs pickBase; SQL combat_v2_autopick). The factor is a card fact of the active (as
// cp_mod): stored in subjects.ability_v2.pick_factor, written by scripts/push-abilities.mjs --v2 <batch> --factors <file>.
//   node card-studio/v2sim/run.mjs factors --set1 [--runs N]     measure the factor of each Set 1 support active and write the PRIVATE factors file
//                                                                beside the batch (<batch>.factors.json; factors.mjs). The report holds roles and ranges only.
//   node card-studio/v2sim/run.mjs factors [--runs N]            the same for the placeholder templates (out/v2sim/factors-template.json; Lab only:
//                                                                a card with no v2 active has no factor in play)
//   node card-studio/v2sim/run.mjs activepick [--set1] --seed N  the built pick on the Lab pools of plan 20.9 (the same pools, the same searched
//                                                                reference): active_x 0 (the live score), active_x 1 with the stored factors (built), the
//                                                                20.9 form (the unrounded factor, measured in the run), active_x 0.5 and 2
//   node card-studio/v2sim/run.mjs activesum [--set1] [--seeds 101,1,...]   the table over the seeds (reads the JSON of each activepick run)
// The method of a factor (plan 20.9, score.mjs SC.activeFactor): the strength of a Normal casual card of its role with this active (cp_mod 1, the card +
// the 4 reference cards, Hunt Heroic net damage a day, no mechanic, policy autov2, 400 days) / the mean of the actives of its role in the same set. It
// is relative to the other actives of the role: measure again when an active of the role changes.
// The Set 1 actives are PRIVATE: every output of this file holds roles, counts, ranges and ratios only (no card key, no card name, no active text).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { classOf, SUPPORT_ROLES, ROLES } from './cards.mjs';
import { SC, LIVE, OUT, measuredValue, scorePickLab, scoreSum } from './score.mjs';
import { loadSets, loadSetRows, withSet1, SET1_BATCH_PATH } from './teams.mjs';
import { activeHash, factorsPathOf, readFactors, FACTOR_MIN, FACTOR_MAX } from './factors.mjs';
import { table, fmt, ratio, mean, median } from './util.mjs';

export const FACTOR_DIGITS = 3;          // the stored factor: 3 decimals (the noise of a factor is about 0.01, plan 20.9)
export const FACTOR_RUNS = 400;
export const TEMPLATE_FACTORS = () => join(OUT(), 'factors-template.json');
const round = (x) => Math.round(x * 10 ** FACTOR_DIGITS) / 10 ** FACTOR_DIGITS;
const batchRows = (p) => JSON.parse(readFileSync(p, 'utf8')).rows;

/** The factors of the support actives: {template id: rounded factor}. set1 = a {key: active} map (the batch) or null (the placeholder templates). */
export function measureFactors(cfg, { set1, runs = FACTOR_RUNS, seed = 'active-factor', built = false } = {}) {
  const c = set1 && !built ? withSet1(cfg, set1) : cfg;   // built: cfg already holds the templates (withSet1), so that the role means are shared with roleBalance
  const tids = Object.keys(c.v2_templates).filter((t) => !t.startsWith('_') && (set1 ? t.startsWith('s1.') && set1[t.slice(3)] : !t.startsWith('s1.')) && classOf(c.v2_templates[t].role) === 'support').sort();
  const out = {};
  for (const t of tids) {
    const f = round(SC.activeFactor(c, t, runs, seed));
    if (!(f >= FACTOR_MIN && f <= FACTOR_MAX)) throw new Error(`measureFactors: a factor of the role ${c.v2_templates[t].role} is ${f}, outside ${FACTOR_MIN} to ${FACTOR_MAX} (the stored range)`);
    out[t] = f;
  }
  return out;
}
/** Roles and ranges only: {role: {n, min, max, mean}}. */
export function factorSummary(cfg, F, roleOf) {
  const by = {};
  for (const [k, f] of Object.entries(F)) { const r = roleOf(k); (by[r] = by[r] || []).push(f); }
  return Object.fromEntries(SUPPORT_ROLES.filter((r) => by[r]).map((r) => [r, { n: by[r].length, min: Math.min(...by[r]), max: Math.max(...by[r]), mean: by[r].reduce((s, x) => s + x, 0) / by[r].length }]));
}
const summaryMd = (S) => table(['role', 'actives', 'factor min', 'factor max', 'mean'], Object.entries(S).map(([r, s]) => [r, String(s.n), fmt(s.min, 3), fmt(s.max, 3), fmt(s.mean, 3)]));

/** Per role: the actives of Set 1 and of Set 2 and the mean strength of Set 2 / Set 1 (the same active-factor method: each factor is a strength / the role mean of
 * the combined set, so the mean of the factors of a set is its mean strength in the same unit). Roles, counts and ratios only. c = withSet1(cfg, S), S = the map
 * with the cards of Set 2 marked set: 2. */
export function roleBalance(c, S, runs = FACTOR_RUNS, seed = 'active-factor') {
  const out = {};
  for (const role of ROLES) {
    const ks = Object.keys(S).filter((k) => S[k].role === role).sort();
    const f1 = ks.filter((k) => S[k].set !== 2).map((k) => SC.activeFactor(c, `s1.${k}`, runs, seed)), f2 = ks.filter((k) => S[k].set === 2).map((k) => SC.activeFactor(c, `s1.${k}`, runs, seed));
    out[role] = { n1: f1.length, n2: f2.length, m1: mean(f1), m2: mean(f2), ratio: f1.length && f2.length ? mean(f2) / mean(f1) : null };
  }
  return out;
}
const roleMd = (R) => table(['role', 'class', 'Set 1 actives', 'Set 2 actives', 'mean strength Set 2 / Set 1'], Object.entries(R).map(([r, x]) => [r, classOf(r), String(x.n1), String(x.n2), x.ratio === null ? '-' : ratio(x.ratio, 3)]));

/** run.mjs factors: measure and write the factors file. Set 1: the PRIVATE file beside the batch; Set 1 + Set 2 (set2): the PRIVATE file beside the Set 2 batch
 * with the factors of both sets (a Set 1 factor changes when the role mean changes); template: out/v2sim (not committed). */
export function factorsExperiment(cfg, { set1, set2, runs = FACTOR_RUNS } = {}) {
  if (set1 || set2) {
    const { rows, path: bp } = loadSetRows({ set2 }); const S = loadSets({ set2 }); const c = withSet1(cfg, S);
    const T = measureFactors(c, { set1: S, runs, built: true });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const out = Object.entries(T).map(([t, f]) => { const r = byKey.get(t.slice(3)); return { key: r.key, role: r.role, active: activeHash(r.role, r.ability.blocks), pick_factor: f }; });
    const file = factorsPathOf(bp);
    writeFileSync(file, JSON.stringify({ about: `PRIVATE. The measured active factor of each ${set2 ? 'Set 1 + Set 2 (provisional batch)' : 'Set 1'} support active (the Hunt auto-pick, plan 20.10). Written by node card-studio/v2sim/run.mjs factors --set1${set2 ? ' --set2' : ''}. Push: node scripts/push-abilities.mjs --v2 <batch> --factors <this file>. Never commit to the public repo.`,
      method: { runs, seed: 'active-factor', digits: FACTOR_DIGITS, batch: basename(bp), sets: set2 ? 'set1+set2' : 'set1' }, rows: out }, null, 1));
    const chk = readFactors(file, rows);
    const F = Object.fromEntries(out.map((x) => [x.key, x.pick_factor]));
    const S2 = factorSummary(cfg, F, (k) => byKey.get(k).role);
    let md = `# The measured active factors of the ${set2 ? 'Set 1 + Set 2 (provisional)' : 'Set 1'} support actives (PRIVATE file beside the batch; roles and ranges only)\n\n${runs} days an active. ${out.length} support actives; the file check: ${chk.errors.length} errors.\n\n${summaryMd(S2)}`;
    const head = [`${out.length} support factors written beside the batch (${basename(file)}), ${chk.errors.length} check errors; range ${fmt(Math.min(...out.map((x) => x.pick_factor)), 3)} to ${fmt(Math.max(...out.map((x) => x.pick_factor)), 3)}`];
    const data = { runs, n: out.length };
    if (set2) {
      // Set 2 factors by role, and how far the Set 1 factors move against the Set 1 file (the role mean changes)
      const only2 = Object.fromEntries(out.filter((x) => S[x.key].set === 2).map((x) => [x.key, x.pick_factor])); const SS2 = factorSummary(cfg, only2, (k) => byKey.get(k).role);
      const p1 = factorsPathOf(SET1_BATCH_PATH()); const r1 = readFactors(p1, JSON.parse(readFileSync(SET1_BATCH_PATH(), 'utf8')).rows);
      const d = out.filter((x) => S[x.key].set !== 2 && r1.factors[x.key] !== undefined).map((x) => ({ role: x.role, d: x.pick_factor - r1.factors[x.key] }));
      const ad = d.map((x) => Math.abs(x.d)); const roles = [...new Set(d.map((x) => x.role))].sort();
      md += `\n\n### The Set 2 support factors (relative to the mean of all actives of the role in Set 1 + Set 2)\n\n${summaryMd(SS2)}\n`;
      md += `\n### How far the Set 1 factors move against the Set 1 file (${r1.errors.length ? `file check: ${r1.errors.length} errors` : `${d.length} support actives`})\n\n` + (d.length ? table(['role', 'Set 1 actives', 'max change', 'median change', 'mean change (signed)'], roles.map((r) => { const x = d.filter((q) => q.role === r).map((q) => q.d); return [r, String(x.length), fmt(Math.max(...x.map(Math.abs)), 3), fmt(median(x.map(Math.abs)), 3), (mean(x) >= 0 ? '+' : '') + fmt(mean(x), 3)]; })) + `\nAll roles: max ${fmt(Math.max(...ad), 3)}, median ${fmt(median(ad), 3)}.\n` : 'The Set 1 factors file is missing: no comparison.\n');
      const R = roleBalance(c, S, runs); md += `\n### Per role: the strength of the Set 2 actives against the Set 1 actives\n\n${roleMd(R)}`;
      Object.assign(data, { set2: SS2, move: d.length ? { max: Math.max(...ad), median: median(ad) } : null, roles: R });
      head.push(`Set 2 support factor range ${fmt(Math.min(...Object.values(only2)), 3)} to ${fmt(Math.max(...Object.values(only2)), 3)}; Set 1 factors move at most ${d.length ? fmt(Math.max(...ad), 3) : '-'} (median ${d.length ? fmt(median(ad), 3) : '-'})`);
    }
    return { md, head, data };
  }
  const T = measureFactors(cfg, { runs });
  mkdirSync(OUT(), { recursive: true }); writeFileSync(TEMPLATE_FACTORS(), JSON.stringify({ about: 'The measured active factors of the placeholder templates (Lab only).', method: { runs, digits: FACTOR_DIGITS }, factors: T }, null, 1));
  return { md: `# The measured active factors of the placeholder support templates (Lab only)\n\n${summaryMd(factorSummary(cfg, T, (t) => cfg.v2_templates[t].role))}`, head: [`${Object.keys(T).length} template factors -> ${TEMPLATE_FACTORS()}`], data: T };
}

/** The pool source of the built pick: the Set 1 (+ Set 2) map with the stored factors (the private file, checked against the batch rows), or the config with the
 * template factors (the file of run.mjs factors, else measured now). */
export function withFactors(cfg, { set1, set2 } = {}) {
  if (set1 || set2) {
    const { rows, path: bp } = loadSetRows({ set2 }); const r = readFactors(factorsPathOf(bp), rows);
    if (r.errors.length) throw new Error(`activepick: the factors file does not match the batch (${r.errors.length} errors; run: node card-studio/v2sim/run.mjs factors --set1${set2 ? ' --set2' : ''}): ${r.errors[0]}`);
    const S = loadSets({ set2 });
    return { set1: Object.fromEntries(Object.entries(S).map(([k, a]) => [k, r.factors[k] !== undefined ? { ...a, pick_factor: r.factors[k] } : a])), cfg, n: Object.keys(r.factors).length, missing: r.missing };
  }
  const T = existsSync(TEMPLATE_FACTORS()) ? JSON.parse(readFileSync(TEMPLATE_FACTORS(), 'utf8')).factors : measureFactors(cfg);
  const c = { ...cfg, v2_templates: { ...cfg.v2_templates } };
  for (const [t, f] of Object.entries(T)) c.v2_templates[t] = { ...c.v2_templates[t], pick_factor: f };
  return { set1: undefined, cfg: c, n: Object.keys(T).length, missing: 0 };
}

export const BUILT = 'built: x pick_factor ^ active_x (balance active_x 1, the stored factors)';
/** The candidates of the built check. LIVE (the score name of score.mjs) = active_x 0: the score that is live today. */
export const activeCandidates = () => ({
  [LIVE]: { pick: { active_x: 0 } },
  [BUILT]: {},
  '20.9: x the measured factor, unrounded (Lab)': { pick: { active_x: 0 }, value: measuredValue(1, 'support') },
  'active_x 0.5': { pick: { active_x: 0.5 } },
  'active_x 2': { pick: { active_x: 2 } },
});
/** run.mjs activepick: the built pick on the pools of one seed (score.mjs scorePickLab with the stored factors on the pool cards). */
export function activePickLab(cfg, { seed = 101, pools = 2, set1, set2, ...o } = {}) {
  if (cfg.auto_v2.pick.active_x !== 1) throw new Error(`activepick: config auto_v2.pick.active_x is ${cfg.auto_v2.pick.active_x}, the built value is 1`);
  const W = withFactors(cfg, { set1, set2 });
  const r = scorePickLab(W.cfg, { seed, pools, set1: W.set1, candidates: activeCandidates(), ...o });
  const mode = W.set1 ? 'set1' + (Object.values(W.set1).some((a) => a.set === 2) ? '-s2' : '') : 'template';
  mkdirSync(OUT(), { recursive: true }); writeFileSync(join(OUT(), `scorepick-active-${mode}-${seed}.json`), JSON.stringify({ ...r.data, mode: `active-${mode}` }));
  return { md: r.md.replace('# The per-card score of the Hunt auto-pick', `# The built active factor of the Hunt auto-pick (${W.n} stored factors, ${W.missing} supports with none)`), head: r.head, data: r.data };
}
/** run.mjs activesum: the table over the seeds (score.mjs scoreSum on the activepick files). */
export const activeSum = (cfg, { set1, set2, seeds } = {}) => scoreSum(cfg, { mode: `active-${set1 ? 'set1' + (set2 ? '-s2' : '') : 'template'}`, ...(seeds ? { seeds } : {}) });
