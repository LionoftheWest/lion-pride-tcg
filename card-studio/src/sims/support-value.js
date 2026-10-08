/**
 * Does each boss cut the countered support's own value by at least 50%? (Nathan, 2026-10-06.) NO lasting change, the
 * LOCAL copy only (was the body of scripts/sim-support-value.mjs; the script is now its CLI).
 * The value of a support type = the boss damage of the squad WITH it minus the same squad WITHOUT it (both with counters
 * off, then both with counters on). For heal the value is the HP that heals restore, less the heals that also healed the
 * boss (Undying). Decay and Siphon are not counted (a lower bound). Every round reseeds the random numbers (day, round),
 * so the four runs see the same luck. PRIVATE boss rows only. The goal: value on <= 50% of value off, for every boss.
 */
import { runBlock, lit, intParam } from './common.js';

const BASE = ['shield', 'empower', 'weaken', 'expose'];
// boss -> the countered support type ('all' = every support).
export const DEFAULT_BOSSES = {
  'The Grind Vampire': 'heal', 'The AFK Warzombie': 'heal', 'The Smurf Brute': 'shield', 'The Hardstuck Skeleton': 'shield',
  'Maw of the Meta': 'empower', 'The Rage-Quit Warlord': 'weaken', 'The Ranked Nightshade': 'expose', 'The Lagspike Parasite': 'stun',
  'The Netcode Mutant': 'smite', 'The Patch-Day Pumpkin': 'cleanse', 'The Ban-Wave Demon': 'all', 'The Zerg-Rush Queen': 'all' };

export function params(p = {}) {
  let bosses = DEFAULT_BOSSES;
  if (p.bosses != null && p.bosses !== '') {
    const list = Array.isArray(p.bosses) ? p.bosses : typeof p.bosses === 'string' ? [p.bosses] : null;
    if (list) bosses = Object.fromEntries(list.map((b) => { if (!DEFAULT_BOSSES[b]) throw new Error(`bosses: ${String(b).slice(0, 40)} is not a boss`); return [b, DEFAULT_BOSSES[b]]; }));
    else {
      for (const [b, t] of Object.entries(p.bosses)) if (!/^[\w '-]{2,40}$/.test(b) || !/^[a-z]{2,20}$/.test(t)) throw new Error('bosses: not allowed');
      bosses = p.bosses;
    }
  }
  return { days: intParam(p.days, 'days', 1, 300, 30), bosses };
}

function squadsFor(type) {
  if (type === 'all') return [['with', 3, ['heal', ...BASE]], ['without', 3, []]];
  const full = BASE.includes(type) ? ['heal', ...BASE] : [type, ...BASE];
  return [['with', 3, full], ['without', 3, full.filter((e) => e !== type)]];
}

export function bossSQL(boss, type, day0, days, { prelude = '', migration = '' } = {}) {
  const squads = squadsFor(type).map(([name, na, effs]) => `jsonb_build_object('name', '${name}', 'na', ${na}, 'effs', ${lit(JSON.stringify(effs))}::jsonb)`).join(', ');
  return String.raw`do $t$ declare
  P text := 'tst_simsv'; d date := (now() at time zone 'America/Denver')::date; out jsonb := '[]';
  atks bigint[]; sq jsonb; share numeric; day int; h bigint; ids bigint[]; sup bigint[]; a bigint; s bigint; r jsonb; tg bigint;
  rounds int; total bigint; healed bigint; applied numeric; eff text; orig jsonb;
begin
  ${migration ? 'execute $m$' + migration + '$m$;' : '-- the database as it is'}
  -- the scenario (the Test lab): it rolls back with the rest
  ${prelude || '-- (no prelude)'}
  perform set_config('tcg.skip_welcome', 'on', true);
  select array_agg(id order by id) into atks from (select c.id from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character', 'Creature') and c.rarity = 'full_art' order by c.id limit 8) x;
  insert into players (id, username) values (P, 'tst sim');
  insert into player_cards (player_id, card_id, quantity) select P, x, 1 from unnest(atks) x;
  insert into player_cards (player_id, card_id, quantity)
    select P, min(c.id), 1 from cards c join subjects s on s.id = c.subject_id
    where s.ability->>'kind' = 'support' and c.rarity = 'normal' group by s.ability->>'effect';
  update balance set value = '8' where key = 'daily_card_cap';   -- the daily card cap (balance_table.sql)
  select value into orig from balance where key = 'boss_counters';
  for sq in select * from jsonb_array_elements(jsonb_build_array(${squads})) loop
    -- the attackers from the strongest to the weakest (the support targets and the attacks go in this order)
    select array_agg(x order by (card_combat('full_art', 0, s2.cp_mod, '{}'::jsonb)->>'cp')::int desc, x) into ids
      from unnest(atks[1:(sq->>'na')::int]) x join cards c on c.id = x join subjects s2 on s2.id = c.subject_id;
    select coalesce(array_agg(pc.card_id order by pc.card_id), '{}') into sup from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
      where pc.player_id = P and s.ability->>'kind' = 'support' and s.ability->>'effect' in (select jsonb_array_elements_text(sq->'effs'));
    foreach share in array array[0, 0.4]::numeric[] loop
      -- off: no counter move at all; on: balance boss_counters as it is (the boss's own share, else share)
      update balance set value = case when share = 0 then jsonb_set(jsonb_set(orig, '{share}', '0'), array['boss_share', ${lit(boss)}], '0') else orig end where key = 'boss_counters';
      total := 0; healed := 0; applied := 0;
      for day in ${day0 + 1}..${day0 + days} loop
        insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
          values (${lit(boss)}, 'Normal', '[]', '[]', '{"list": []}', 9000000, 9000000, now() + interval '1 day', 3000, '{"atk": 58}') returning id into h;
        perform hunt_state_round(h, P, d);
        for rounds in 1..60 loop
          perform setseed((day * 97 + rounds) / 100000.0);   -- the same luck in the four runs
          foreach s in array sup loop
            select s2.ability->>'effect' into eff from cards c join subjects s2 on s2.id = c.subject_id where c.id = s;
            select x.card_id into tg from hunt_card_hp x where x.hunt_id = h and x.player_id = P and x.card_id = any(ids) and not x.downed
              order by case when eff = 'heal' then x.hp_remaining::numeric / greatest(1, x.max_hp) else 0 end, x.card_id limit 1;
            if tg is null then tg := ids[1]; end if;
            r := hunt_support(P, h, s, tg);
          end loop;
          r := null;
          foreach a in array ids loop
            r := hunt_attack(P, h, a);
            exit when coalesce((r->>'ok')::boolean, false) or r->>'error' in ('round_cap', 'hunt_over');
          end loop;
          exit when r is null or not coalesce((r->>'ok')::boolean, false);
        end loop;
        total := total + coalesce((select sum(damage) from hunt_hits where hunt_id = h and player_id = P), 0);
        -- a heal that also healed the boss (Undying) has no value
        healed := healed + coalesce((select sum(case when result->'countered' ? 'undying' then 0 else (result->>'gained')::int end) from combat_actions where mode = 'hunt' and ref_id = h and effect = 'heal'), 0);
        applied := applied + coalesce((select sum((result->>'value')::numeric) from combat_actions where mode = 'hunt' and ref_id = h and effect = ${lit(type)}), 0);   -- the effect the countered support applied
        update hunts set status = 'expired' where id = h;
      end loop;
      out := out || jsonb_build_object('squad', sq->>'name', 'share', share, 'dmg', total, 'healed', healed, 'applied', applied);   -- sums: the caller averages over every chunk
    end loop;
  end loop;
  raise exception 'SIMRES %', out;
end $t$;`;
}

/** One boss: the value off and on and the cut. rows = the summed chunks. */
export function bossRow(boss, type, rows, days) {
  const r2 = rows.map((r) => ({ ...r, dmg: Math.round(r.dmg / days), healed: Math.round(r.healed / days), applied: Math.round((100 * r.applied) / days) / 100 }));
  const g = (sq, sh, k) => Number(r2.find((r) => r.squad === sq && Number(r.share) === sh)?.[k]);
  const off = type === 'heal' ? g('with', 0, 'healed') : g('with', 0, 'dmg') - g('without', 0, 'dmg');
  const on = type === 'heal' ? g('with', 0.4, 'healed') : g('with', 0.4, 'dmg') - g('without', 0.4, 'dmg');
  const cut = off > 0 ? Math.round(100 * (1 - on / off)) : null;
  return { boss, type, off, on, cut, goal: cut !== null && cut >= 50, rows: r2 };
}

export function metrics(s) {
  return s.rows.flatMap((r) => [
    { key: `on_${r.boss}`, label: `${r.boss} (${r.type}): value, counters on`, value: r.on, chart: 'Support value per squad-day, counters on', short: r.boss.replace(/^The /, '') },
    { key: `cut_${r.boss}`, label: `${r.boss} (${r.type}): cut`, value: r.cut, fmt: 'pctint' },
  ]);
}

export async function run(q, p, { prelude = '', migration = '', onProgress, isCancelled } = {}) {
  const list = Object.entries(p.bosses);
  const chunks = Math.ceil(p.days / 30);
  const out = [];
  let done = 0;
  for (const [boss, type] of list) {
    const rows = [];   // 30-day chunks (one SQL block each: a long block hits the read timeout)
    for (let day0 = 0; day0 < p.days; day0 += 30) {
      if (isCancelled?.()) throw new Error('cancelled');
      onProgress?.(done++, list.length * chunks, boss);
      for (const r of await runBlock(q, bossSQL(boss, type, day0, Math.min(30, p.days - day0), { prelude, migration }))) {
        const o = rows.find((x) => x.squad === r.squad && Number(x.share) === Number(r.share));
        if (o) { o.dmg += Number(r.dmg); o.healed += Number(r.healed); o.applied += Number(r.applied); }
        else rows.push({ squad: r.squad, share: Number(r.share), dmg: Number(r.dmg), healed: Number(r.healed), applied: Number(r.applied) });
      }
    }
    out.push(bossRow(boss, type, rows, p.days));
  }
  onProgress?.(done, list.length * chunks);
  return { raw: out, summary: { days: p.days, rows: out.map(({ rows, ...x }) => x) } };
}
