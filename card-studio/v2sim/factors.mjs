// factors.mjs - the file of the measured active factors of the Hunt auto-pick (plan 20.10; measured in plan 20.9). Light: no simulator import, so that
// scripts/push-abilities.mjs --v2 --factors can read and check a file.
// A factors file is PRIVATE (it holds card keys): it lives beside its batch (<batch>.factors.json in discord-card-ideas/batches), never in this repo.
//   {about, method: {runs, seed, digits, batch}, rows: [{key, role, active, pick_factor}]}
// active = activeHash(role, blocks) of the batch row when the factor was measured. A factor is a card fact of ONE active: when the active changes, the
// hash differs and the file is refused (measure again: node card-studio/v2sim/run.mjs factors --set1). Supports only: the pick ignores the factor of an
// attacker (plan 20.9: the attackers keep the offense), so a file with an attacker row is refused.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { classOf } from './cards.mjs';

// The range of a stored factor: the trigger subjects_ability_v2_check (combat_v2_autopick_active.sql) refuses a factor outside it. The Set 1 factors
// are 0.89 to 1.18 (plan 20.9).
export const FACTOR_MIN = 0.5, FACTOR_MAX = 2;
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
/** The hash of an active (the role and the blocks; the name and the Silver line do not change the factor). */
export const activeHash = (role, blocks) => createHash('sha256').update(JSON.stringify(canon({ role, blocks }))).digest('hex').slice(0, 16);
/** The factors file of a batch file: <batch>.factors.json beside it. */
export const factorsPathOf = (batchPath) => String(batchPath).replace(/\.json$/i, '') + '.factors.json';

/** Read a factors file and check it against the rows of its batch ([{key, role, ability: {blocks}}]). Returns {factors: {key: f}, errors: [text],
 * supports, missing}: supports = the support rows of the batch, missing = the support rows with no factor (the pick uses 1). The errors hold row
 * numbers and reasons; a key shows only in an error of a row that is not in the batch (the caller prints errors locally, never to the repo). */
export function readFactors(file, rows) {
  const out = { factors: {}, errors: [], supports: 0, missing: 0 };
  if (!existsSync(file)) { out.errors.push(`the factors file is missing (${file})`); return out; }
  let F; try { F = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { out.errors.push(`the factors file does not read: ${e.message}`); return out; }
  if (!Array.isArray(F?.rows)) { out.errors.push('the factors file has no rows ([{key, role, active, pick_factor}])'); return out; }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  F.rows.forEach((x, i) => {
    const at = `factor row ${i + 1}`;
    const r = byKey.get(x?.key);
    if (!r) { out.errors.push(`${at}: the key ${x?.key} is not in the batch`); return; }
    if (out.factors[x.key] !== undefined) { out.errors.push(`${at}: the key is twice in the file`); return; }
    if (classOf(r.role) !== 'support') { out.errors.push(`${at}: the batch row is an attacker (the pick reads a factor of a support only)`); return; }
    if (x.role !== r.role || x.active !== activeHash(r.role, r.ability?.blocks)) { out.errors.push(`${at}: the active changed after the measurement (measure again: run.mjs factors --set1)`); return; }
    if (typeof x.pick_factor !== 'number' || !(x.pick_factor >= FACTOR_MIN && x.pick_factor <= FACTOR_MAX)) { out.errors.push(`${at}: pick_factor must be a number from ${FACTOR_MIN} to ${FACTOR_MAX}`); return; }
    out.factors[x.key] = x.pick_factor;
  });
  for (const r of rows) if (classOf(r.role) === 'support') { out.supports++; if (out.factors[r.key] === undefined) out.missing++; }
  return out;
}
