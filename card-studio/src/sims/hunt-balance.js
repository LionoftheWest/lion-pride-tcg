/**
 * Hunt balance (was the body of scripts/sim-hunt-balance.mjs; the script is now its CLI): the REAL engine (hunt_attack),
 * NO lasting change, the LOCAL copy only.
 * One DO block builds test members whose cards are drawn at the pull rates of balance pulls (light 5 / regular 15 /
 * heavy 40 packs) and lets each member fight one day against PRIVATE boss rows of the tier (inserted in the block like
 * spawn_hunt makes them: the tier ATK x the boss multiplier, the tier's passive count; their HP raised so nothing dies;
 * never the live boss row): the 8 strongest attackers (by card_combat), each attacking until it is downed.
 * The result: the damage per member-day, the boss HP of the tier (balance boss_hp, read after the prelude), and the
 * kill odds of a crew (an ESTIMATE: member-days drawn from the measured ones with a seeded generator).
 * Supports are not played (a floor, not a ceiling).
 */
import { runBlock, lit, intParam, numParam, oneOf, rng, median, mean } from './common.js';

export const TIERS = ['Normal', 'Heroic', 'Mythic'];
export const GROUPS = ['light', 'regular', 'heavy'];
const BOSSES = ['The Rage-Quit Warlord', 'The Netcode Mutant', 'Maw of the Meta', 'The Lagspike Parasite', 'The Patch-Day Pumpkin', 'The Ranked Nightshade',
  'The Grind Vampire', 'The Ban-Wave Demon', 'The Smurf Brute', 'The AFK Warzombie', 'The Hardstuck Skeleton', 'The Zerg-Rush Queen'];
const PASSIVES = ['armored', 'shrouded', 'flaming', 'volatile', 'regenerating', 'thorns', 'frenzied'];

export function params(p = {}) {
  return {
    tier: oneOf(p.tier, 'tier', TIERS, 'Normal'),
    spawns: intParam(p.spawns, 'spawns', 1, 6, 2),
    members: intParam(p.members, 'members', 1, 8, 4),            // test members per group (light, regular, heavy)
    floor: intParam(p.floor, 'floor', 0, 1000, 0),               // a test card HP floor (0 = the live card_max_hp)
    crew: intParam(p.crew, 'crew', 1, 60, 10),                   // the kill odds: a crew of this size ...
    days: intParam(p.days, 'days', 1, 7, 4),                     // ... over this many days
    seed: numParam(p.seed, 'seed', -1, 1, 0.42),
  };
}

export function sql(p, { prelude = '', realPlayer = '' } = {}) {
  if (realPlayer && !/^\d{17,20}$/.test(realPlayer)) throw new Error('SIM_REAL_PLAYER_ID must be a Discord id');
  const prof = GROUPS.flatMap((g) => Array.from({ length: p.members }, () => g));
  const T = lit(p.tier);
  return String.raw`set statement_timeout = '8min';
do $t$
declare
  res jsonb := '[]'; h bigint; pl record; c record; r jsonb; n int; dmg bigint; atks int; k int; sp int;
  prof text[] := array[${prof.map(lit).join(', ')}];
  packs int; roll numeric; rar text; cid bigint; boss text; downed int; crits int; misses int; rates jsonb; plist jsonb;
begin
  -- the scenario (the Test lab): it rolls back with the rest
  ${prelude || '-- (no prelude)'}
  perform set_config('tcg.skip_welcome', 'on', true);
  perform setseed(${p.seed});
  ${p.floor ? `create or replace function public.card_max_hp(p_cp integer) returns integer language sql immutable set search_path to 'public' as $f$ select greatest(${p.floor}, round(p_cp * 1.8))::int; $f$;` : ''}
  rates := balance_get('pulls')->'rates';
  -- The test members: 5 cards a pack at the pull rates of balance pulls (the draw of tcg-bot/src/draw.ts).
  for k in 1..array_length(prof, 1) loop
    insert into players (id, username) values ('tst_bal_' || k, 'tst ' || prof[k]);
    packs := case prof[k] when 'light' then 5 when 'regular' then 15 else 40 end;
    for n in 1..packs * 5 loop
      roll := random();
      rar := case when roll < (rates->>'normal')::numeric then 'normal'
                  when roll < (rates->>'normal')::numeric + (rates->>'illustrated_rare')::numeric then 'illustrated_rare'
                  when roll < (rates->>'normal')::numeric + (rates->>'illustrated_rare')::numeric + (rates->>'secret_rare')::numeric then 'secret_rare'
                  when roll < 1 - (rates->>'gold')::numeric then 'full_art' else 'gold' end;
      select id into cid from cards where in_draw_pool and rarity::text = rar order by random(), id limit 1;
      if cid is null then select id into cid from cards where in_draw_pool and rarity::text = 'normal' order by random(), id limit 1; end if;
      insert into player_cards (player_id, card_id, quantity) values ('tst_bal_' || k, cid, 1)
        on conflict (player_id, card_id) do update set quantity = player_cards.quantity + 1;
    end loop;
  end loop;

  for sp in 1..${p.spawns} loop
    -- A PRIVATE boss row (never the live boss): a boss of the list, the tier ATK x its multiplier, the tier's passives.
    boss := (array[${BOSSES.map(lit).join(', ')}])[1 + floor(random() * ${BOSSES.length})::int];
    select coalesce(jsonb_agg(jsonb_build_object('kind', x)), '[]') into plist from (select x from unnest(array[${PASSIVES.map(lit).join(', ')}]) x
      order by random(), x limit balance_num('boss_tiers', ${T}, 'passives')::int) y;
    insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
      values (boss, ${T}, '[]', '[]', jsonb_build_object('kind', plist->0->>'kind', 'list', plist), 100000000, 100000000,
              now() + interval '1 day', 10000000, jsonb_build_object('atk', round(balance_num('boss_atk', ${T})
                * coalesce((balance_get('boss_stats')->boss->>'atk_mult')::numeric, 1)))) returning id into h;
    for pl in select id, username from players where id like 'tst_bal_%' or id = ${lit(realPlayer || 'none')} order by id loop
      dmg := 0; atks := 0; downed := 0; crits := 0; misses := 0;
      for c in select pc.card_id from player_cards pc join cards cc on cc.id = pc.card_id join subjects s on s.id = cc.subject_id
                where pc.player_id = pl.id and s.type in ('Character', 'Creature')
                order by (card_combat(cc.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'cp')::int desc, pc.card_id limit 8 loop
        for n in 1..40 loop
          r := hunt_attack(pl.id, h, c.card_id);
          exit when not (r->>'ok')::boolean;
          atks := atks + 1; dmg := dmg + (r->>'damage')::int;
          if (r->>'crit')::boolean then crits := crits + 1; end if;
          if r->>'outcome' = 'miss' then misses := misses + 1; end if;
          if (r->>'card_downed')::boolean then downed := downed + 1; exit; end if;
        end loop;
      end loop;
      res := res || jsonb_build_object('spawn', sp, 'boss', boss, 'player', case when pl.id = ${lit(realPlayer || 'none')} then 'real' else substr(pl.username, 5) end,
        'damage', dmg, 'attacks', atks, 'downed', downed, 'crits', crits, 'misses', misses);
    end loop;
  end loop;
  raise exception 'SIMRES %', jsonb_build_object('rows', res, 'boss_hp', balance_num('boss_hp', ${T}), 'crew_cfg', balance_num('boss_hp', 'crew'));
end $t$;`;
}

/** The summary of the rows: per group, the boss HP, the crew days and the kill odds (seeded resampling). */
export function summarize(raw, p) {
  const rows = raw.rows || [];
  const groups = [...GROUPS, 'real'].map((g) => {
    const x = rows.filter((r) => r.player === g);
    if (!x.length) return null;
    const att = x.reduce((t, r) => t + r.attacks, 0);
    const d = median(x.map((r) => r.damage));
    return { group: g, member_days: x.length, damage_median: d, damage_mean: Math.round(mean(x.map((r) => r.damage))),
      attacks_median: median(x.map((r) => r.attacks)), crit_pct: att ? Math.round((1000 * x.reduce((t, r) => t + r.crits, 0)) / att) / 10 : 0,
      miss_pct: att ? Math.round((1000 * x.reduce((t, r) => t + r.misses, 0)) / att) / 10 : 0,
      crew_days: Math.round((10 * Number(raw.boss_hp)) / (p.crew * Math.max(1, d))) / 10 };
  }).filter(Boolean);
  // Kill odds (an estimate): a crew of p.crew members, the groups in equal parts, each member-day drawn from the measured
  // member-days of its group; the boss dies when the sum over p.days reaches the boss HP. 2,000 seeded trials.
  const pools = GROUPS.map((g) => rows.filter((r) => r.player === g).map((r) => r.damage)).filter((a) => a.length);
  const rand = rng(p.seed || 0.42);
  let kills = 0; const TRIALS = 2000;
  if (pools.length) {
    for (let t = 0; t < TRIALS; t++) {
      let sum = 0;
      for (let m = 0; m < p.crew; m++) { const pool = pools[m % pools.length]; for (let d = 0; d < p.days; d++) sum += pool[Math.floor(rand() * pool.length)]; }
      if (sum >= Number(raw.boss_hp)) kills++;
    }
  }
  return { tier: p.tier, boss_hp: Number(raw.boss_hp), crew: p.crew, days: p.days, bosses: [...new Set(rows.map((r) => r.boss))],
    groups, kill_odds: pools.length ? kills / TRIALS : null };
}

/** The numbers the Test lab compares (baseline vs scenario). */
export function metrics(s) {
  return [
    { key: 'boss_hp', label: `${s.tier} boss HP`, value: s.boss_hp },
    { key: 'kill_odds', label: `Kill odds, crew of ${s.crew}, ${s.days} days (estimate)`, value: s.kill_odds, fmt: 'pct' },
    ...s.groups.map((g) => ({ key: `dmg_${g.group}`, label: `Damage per member-day, ${g.group}`, value: g.damage_median, chart: 'Damage per member-day', short: g.group })),
    ...s.groups.map((g) => ({ key: `days_${g.group}`, label: `Days for a crew of ${s.crew}, all ${g.group}`, value: g.crew_days })),
  ];
}

export async function run(q, p, { prelude = '', realPlayer = '', onProgress } = {}) {
  onProgress?.(0, 1);
  const raw = await runBlock(q, sql(p, { prelude, realPlayer }));
  onProgress?.(1, 1);
  return { raw, summary: summarize(raw, p) };
}
