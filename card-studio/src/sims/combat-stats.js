/**
 * The Pride Hunt combat telemetry (was the body of scripts/combat-stats.mjs; the script is now its CLI): the roll rates
 * (miss / crit / block / weak / counter, downs, average damage) from hunt_combat_stats() and the fight length of each
 * Hunt from hunt_fight_summary(). READ ONLY: the recorded fights, so a scenario does not change it (the Test lab shows it
 * once, as the reference).
 */
import { runBlock, intParam } from './common.js';

export function params(p = {}) { return { limit: intParam(p.limit, 'limit', 1, 50, 15) }; }

/** In a rolled-back block, like the simulations (the lab runs every module the same way). */
export const sql = (p, { prelude = '' } = {}) => `do $t$ begin
  ${prelude || '-- (no prelude)'}
  raise exception 'SIMRES %', jsonb_build_object('stats', hunt_combat_stats(),
    'fights', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from (select * from hunt_fight_summary() limit ${p.limit}) f));
end $t$;`;

export function metrics(s) {
  const st = s.stats || {};
  return [['attacks', 'Attacks logged'], ['miss_pct', 'Miss %'], ['crit_pct', 'Crit %'], ['block_pct', 'Block %'], ['weak_pct', 'Weak-point %'],
    ['counter_pct', 'Counter %'], ['downs', 'Downs'], ['avg_damage', 'Average damage']].map(([k, label]) => ({ key: k, label, value: st[k] == null ? null : Number(st[k]) }));
}

export async function run(q, p, { prelude = '', onProgress } = {}) {
  onProgress?.(0, 1);
  const raw = await runBlock(q, sql(p, { prelude }));
  onProgress?.(1, 1);
  return { raw, summary: { stats: raw.stats || null, fights: raw.fights || [] } };
}
