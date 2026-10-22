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
import { classOf, SUPPORT_ROLES } from './cards.mjs';
import { SC, LIVE, OUT, measuredValue, scorePickLab, scoreSum } from './score.mjs';
import { loadSet1Batch, withSet1, SET1_BATCH_PATH } from './teams.mjs';
import { activeHash, factorsPathOf, readFactors, FACTOR_MIN, FACTOR_MAX } from './factors.mjs';
import { table, fmt, ratio } from './util.mjs';

export const FACTOR_DIGITS = 3;          // the stored factor: 3 decimals (the noise of a factor is about 0.01, plan 20.9)
export const FACTOR_RUNS = 400;
export const TEMPLATE_FACTORS = () => join(OUT(), 'factors-template.json');
const round = (x) => Math.round(x * 10 ** FACTOR_DIGITS) / 10 ** FACTOR_DIGITS;
const batchRows = (p) => JSON.parse(readFileSync(p, 'utf8')).rows;

/** The factors of the support actives: {template id: rounded factor}. set1 = a {key: active} map (the batch) or null (the placeholder templates). */
export function measureFactors(cfg, { set1, runs = FACTOR_RUNS, seed = 'active-factor' } = {}) {
  const c = set1 ? withSet1(cfg, set1) : cfg;
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

/** run.mjs factors: measure and write the factors file. Set 1: the PRIVATE file beside the batch; template: out/v2sim (not committed). */
export function factorsExperiment(cfg, { set1, runs = FACTOR_RUNS } = {}) {
  if (set1) {
    const bp = SET1_BATCH_PATH(); const rows = batchRows(bp); const S = loadSet1Batch();
    const T = measureFactors(cfg, { set1: S, runs });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const out = Object.entries(T).map(([t, f]) => { const r = byKey.get(t.slice(3)); return { key: r.key, role: r.role, active: activeHash(r.role, r.ability.blocks), pick_factor: f }; });
    const file = factorsPathOf(bp);
    writeFileSync(file, JSON.stringify({ about: 'PRIVATE. The measured active factor of each Set 1 support active (the Hunt auto-pick, plan 20.10). Written by node card-studio/v2sim/run.mjs factors --set1. Push: node scripts/push-abilities.mjs --v2 <batch> --factors <this file>. Never commit to the public repo.',
      method: { runs, seed: 'active-factor', digits: FACTOR_DIGITS, batch: basename(bp) }, rows: out }, null, 1));
    const chk = readFactors(file, rows);
    const S2 = factorSummary(cfg, Object.fromEntries(out.map((x) => [x.key, x.pick_factor])), (k) => byKey.get(k).role);
    return { md: `# The measured active factors of the Set 1 support actives (PRIVATE file beside the batch; roles and ranges only)\n\n${runs} days an active. ${out.length} support actives; the file check: ${chk.errors.length} errors.\n\n${summaryMd(S2)}`,
      head: [`${out.length} support factors written beside the batch (${basename(file)}), ${chk.errors.length} check errors; range ${fmt(Math.min(...out.map((x) => x.pick_factor)), 3)} to ${fmt(Math.max(...out.map((x) => x.pick_factor)), 3)}`] };
  }
  const T = measureFactors(cfg, { runs });
  mkdirSync(OUT(), { recursive: true }); writeFileSync(TEMPLATE_FACTORS(), JSON.stringify({ about: 'The measured active factors of the placeholder templates (Lab only).', method: { runs, digits: FACTOR_DIGITS }, factors: T }, null, 1));
  return { md: `# The measured active factors of the placeholder support templates (Lab only)\n\n${summaryMd(factorSummary(cfg, T, (t) => cfg.v2_templates[t].role))}`, head: [`${Object.keys(T).length} template factors -> ${TEMPLATE_FACTORS()}`], data: T };
}

/** The pool source of the built pick: the Set 1 map with the stored factors (the private file, checked against the batch), or the config with the
 * template factors (the file of run.mjs factors, else measured now). */
export function withFactors(cfg, { set1 } = {}) {
  if (set1) {
    const bp = SET1_BATCH_PATH(); const rows = batchRows(bp); const r = readFactors(factorsPathOf(bp), rows);
    if (r.errors.length) throw new Error(`activepick: the factors file does not match the batch (${r.errors.length} errors; run: node card-studio/v2sim/run.mjs factors --set1): ${r.errors[0]}`);
    const S = loadSet1Batch();
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
export function activePickLab(cfg, { seed = 101, pools = 2, set1, ...o } = {}) {
  if (cfg.auto_v2.pick.active_x !== 1) throw new Error(`activepick: config auto_v2.pick.active_x is ${cfg.auto_v2.pick.active_x}, the built value is 1`);
  const W = withFactors(cfg, { set1 });
  const r = scorePickLab(W.cfg, { seed, pools, set1: W.set1, candidates: activeCandidates(), ...o });
  const mode = W.set1 ? 'set1' : 'template';
  mkdirSync(OUT(), { recursive: true }); writeFileSync(join(OUT(), `scorepick-active-${mode}-${seed}.json`), JSON.stringify({ ...r.data, mode: `active-${mode}` }));
  return { md: r.md.replace('# The per-card score of the Hunt auto-pick', `# The built active factor of the Hunt auto-pick (${W.n} stored factors, ${W.missing} supports with none)`), head: r.head, data: r.data };
}
/** run.mjs activesum: the table over the seeds (score.mjs scoreSum on the activepick files). */
export const activeSum = (cfg, { set1, seeds } = {}) => scoreSum(cfg, { mode: `active-${set1 ? 'set1' : 'template'}`, ...(seeds ? { seeds } : {}) });
