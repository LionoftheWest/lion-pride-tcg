/**
 * The economy what-if (an ESTIMATE, simple arithmetic): the balance numbers pulls (rates, pack size) and shards (the dupe
 * values, the pack price) read in a rolled-back block AFTER the prelude (so a scenario shows), and the daily averages of
 * admin_economy over the last N days (packs earned and opened, Shards earned and spent; the same in the baseline and the
 * scenario: they are what members did).
 *   - expected cards per rarity per 1,000 packs = 1,000 x pack size x rate;
 *   - expected cards per rarity per day = the average packs opened per day x pack size x rate;
 *   - the Shard value of 1,000 packs if every card is turned into Shards = sum of cards x dupe value (a ceiling);
 *   - packs the average Shards earned per day can buy = Shards earned per day / pack price.
 */
import { runBlock, intParam } from './common.js';
import { RARITIES } from '../admin-write.js';

export function params(p = {}) { return { days: intParam(p.days, 'days', 1, 90, 14) }; }

export const sql = (p, { prelude = '' } = {}) => `do $t$ begin
  ${prelude || '-- (no prelude)'}
  raise exception 'SIMRES %', jsonb_build_object('pulls', balance_get('pulls'), 'shards', balance_get('shards'),
    'economy', admin_economy(((now() at time zone 'America/Denver')::date - ${p.days - 1}), (now() at time zone 'America/Denver')::date, 'day'));
end $t$;`;

export function summarize(raw, p) {
  const rates = raw.pulls?.rates || {}, size = Number(raw.pulls?.pack_size) || 0;
  const dupe = raw.shards?.dupe_values || {}, price = Number(raw.shards?.pack_price) || 0;
  const days = (raw.economy?.ratios || []);
  const n = Math.max(1, days.length);
  const avg = (k) => days.reduce((s, d) => s + (Number(d[k]) || 0), 0) / n;
  const flows = { packs_earned: avg('packs_earned'), packs_opened: avg('packs_opened'), shards_earned: avg('shards_earned'), shards_spent: avg('shards_spent') };
  const rows = RARITIES.map((r) => {
    const rate = Number(rates[r]) || 0;
    return { rarity: r, rate, per_1000_packs: 1000 * size * rate, per_day: flows.packs_opened * size * rate, dupe_value: Number(dupe[r]) || 0 };
  });
  const shardValue = rows.reduce((s, x) => s + x.per_1000_packs * x.dupe_value, 0);
  const sum = rows.reduce((s, x) => s + x.rate, 0);
  return { days: p.days, pack_size: size, rate_sum: sum, rate_sum_ok: Math.abs(sum - 1) <= 1e-9, rows, flows, pack_price: price,
    shard_value_1000_packs: Math.round(shardValue), packs_from_daily_shards: price ? Math.round((100 * flows.shards_earned) / price) / 100 : null };
}

export function metrics(s) {
  return [
    ...s.rows.map((r) => ({ key: `p1000_${r.rarity}`, label: `Cards per 1,000 packs: ${r.rarity.replace(/_/g, ' ')} (estimate)`, value: Math.round(100 * r.per_1000_packs) / 100,
      chart: 'Cards per 1,000 packs (estimate)', short: r.rarity.replace(/_/g, ' '), rarity: r.rarity })),
    ...s.rows.map((r) => ({ key: `day_${r.rarity}`, label: `Cards per day: ${r.rarity.replace(/_/g, ' ')} (estimate)`, value: Math.round(100 * r.per_day) / 100 })),
    { key: 'shard_value', label: 'Shard value of 1,000 packs, every card turned in (estimate)', value: s.shard_value_1000_packs },
    { key: 'packs_from_shards', label: 'Packs the average daily Shards buy (estimate)', value: s.packs_from_daily_shards },
    { key: 'rate_sum', label: 'Sum of the pull rates', value: s.rate_sum, fmt: 'pct3' },
  ];
}

export async function run(q, p, { prelude = '', onProgress } = {}) {
  onProgress?.(0, 1);
  const raw = await runBlock(q, sql(p, { prelude }));
  onProgress?.(1, 1);
  return { raw: { pulls: raw.pulls, shards: raw.shards, ratios: raw.economy?.ratios || [] }, summary: summarize(raw, p) };
}
