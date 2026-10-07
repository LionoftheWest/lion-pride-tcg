/**
 * Does each boss cut the countered support's own value by at least 50%? (Nathan, 2026-10-06: "cut the support cards
 * ability itself and its viable part, not the whole squad".) Run it on the LOCAL copy, NO lasting change:
 *   LOCALDB=1 NODE_OPTIONS=--import=./scripts/localdb-preload.mjs node scripts/sim-support-value.mjs [days] [file.sql]
 * The value of a support type = the boss damage of the squad WITH it minus the same squad WITHOUT it (both with counters
 * off, then both with counters on). Heal adds almost no damage in these fights, so for heal the value is the HP that
 * heals restore, less the heals that also healed the boss (Undying). Decay and Siphon are not counted (a lower bound).
 * Every round reseeds the random numbers (day, round), so the four runs see the same luck.
 * The goal: value on <= 50% of value off, for every boss.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https?:\/\/([a-z0-9]+)/)?.[1] || 'local';
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const DAYS = Number(process.argv[2] || 30);
const mig = readFileSync(process.argv[3] || new URL('../../tcg-bot/supabase/hunt_boss_moves.sql', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const BASE = ['shield', 'empower', 'weaken', 'expose'];
// boss -> the countered support type ('all' = every support).
const BOSSES = JSON.parse(process.env.SIM_BOSSES || 'null') || {
  'The Grind Vampire': 'heal', 'The AFK Warzombie': 'heal', 'The Smurf Brute': 'shield', 'The Hardstuck Skeleton': 'shield',
  'Maw of the Meta': 'empower', 'The Rage-Quit Warlord': 'weaken', 'The Ranked Nightshade': 'expose', 'The Lagspike Parasite': 'stun',
  'The Netcode Mutant': 'smite', 'The Patch-Day Pumpkin': 'cleanse', 'The Ban-Wave Demon': 'all', 'The Zerg-Rush Queen': 'all' };

function squadsFor(type) {
  if (type === 'all') return [['with', 3, ['heal', ...BASE]], ['without', 3, []]];
  const full = BASE.includes(type) ? ['heal', ...BASE] : [type, ...BASE];
  return [['with', 3, full], ['without', 3, full.filter((e) => e !== type)]];
}

function bossSQL(boss, type, day0, days) {
  const squads = squadsFor(type).map(([name, na, effs]) => `jsonb_build_object('name', '${name}', 'na', ${na}, 'effs', '${JSON.stringify(effs)}'::jsonb)`).join(', ');
  return String.raw`do $t$ declare
  P text := 'tst_simsv'; d date := (now() at time zone 'America/Denver')::date; out jsonb := '[]';
  atks bigint[]; sq jsonb; share numeric; day int; h bigint; ids bigint[]; sup bigint[]; a bigint; s bigint; r jsonb; tg bigint;
  rounds int; total bigint; healed bigint; applied numeric; eff text; orig jsonb;
begin
  execute $m$${mig}$m$;
  select array_agg(id order by id) into atks from (select c.id from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character', 'Creature') and c.rarity = 'full_art' order by c.id limit 8) x;
  insert into players (id, username) values (P, 'tst sim');
  insert into player_cards (player_id, card_id, quantity) select P, x, 1 from unnest(atks) x;
  insert into player_cards (player_id, card_id, quantity)
    select P, min(c.id), 1 from cards c join subjects s on s.id = c.subject_id
    where s.ability->>'kind' = 'support' and c.rarity = 'normal' group by s.ability->>'effect';
  update balance set value = '8' where key = 'daily_card_cap';   -- the daily card cap (balance_table.sql)
  select value into orig from settings where key = 'hunt_boss_moves';
  for sq in select * from jsonb_array_elements(jsonb_build_array(${squads})) loop
    -- the attackers from the strongest to the weakest (the support targets and the attacks go in this order)
    select array_agg(x order by (card_combat('full_art', 0, s2.cp_mod, '{}'::jsonb)->>'cp')::int desc, x) into ids
      from unnest(atks[1:(sq->>'na')::int]) x join cards c on c.id = x join subjects s2 on s2.id = c.subject_id;
    select coalesce(array_agg(pc.card_id), '{}') into sup from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
      where pc.player_id = P and s.ability->>'kind' = 'support' and s.ability->>'effect' in (select jsonb_array_elements_text(sq->'effs'));
    foreach share in array array[0, 0.4]::numeric[] loop
      -- off: no counter move at all; on: the setting as built (the boss's own share, else _share)
      update settings set value = case when share = 0 then jsonb_set(jsonb_set(orig, '{_share}', '0'), '{${boss},share}', '0') else orig end where key = 'hunt_boss_moves';
      total := 0; healed := 0; applied := 0;
      for day in ${day0 + 1}..${day0 + days} loop
        insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
          values ('${boss}', 'Normal', '[]', '[]', '{"list": []}', 9000000, 9000000, now() + interval '1 day', 3000, '{"atk": 58}') returning id into h;
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
        applied := applied + coalesce((select sum((result->>'value')::numeric) from combat_actions where mode = 'hunt' and ref_id = h and effect = '${type}'), 0);   -- the effect the countered support applied
        update hunts set status = 'expired' where id = h;
      end loop;
      out := out || jsonb_build_object('squad', sq->>'name', 'share', share, 'dmg', total, 'healed', healed, 'applied', applied);   -- sums: the caller averages over every chunk
    end loop;
  end loop;
  raise exception 'SIM%', out;
end $t$;`;
}

console.log(`Support value per squad-day (${DAYS} days). Value = damage with the support - damage without it (heal: HP restored).\n`);
console.log('| Boss | Counters | Value, counters off | Value, counters on | Cut | Goal (>= 50%) |\n|---|---|---|---|---|---|');
for (const [boss, type] of Object.entries(BOSSES)) {
  const rows = [];   // 30-day chunks (one SQL block each: a long block hits the read timeout)
  for (let day0 = 0; day0 < DAYS; day0 += 30) {
    const res = await q(bossSQL(boss, type, day0, Math.min(30, DAYS - day0)));
    const m = String(res?.message || JSON.stringify(res)).match(/SIM(\[[\s\S]*?\])(\nCONTEXT|$)/);
    if (!m) { console.log('ERROR', boss, JSON.stringify(res).slice(0, 1500)); process.exit(1); }
    for (const r of JSON.parse(m[1])) {
      const o = rows.find((x) => x.squad === r.squad && Number(x.share) === Number(r.share));
      if (o) { o.dmg += Number(r.dmg); o.healed += Number(r.healed); o.applied += Number(r.applied); }
      else rows.push({ squad: r.squad, share: Number(r.share), dmg: Number(r.dmg), healed: Number(r.healed), applied: Number(r.applied) });
    }
  }
  for (const r of rows) { r.dmg = Math.round(r.dmg / DAYS); r.healed = Math.round(r.healed / DAYS); r.applied = Math.round((100 * r.applied) / DAYS) / 100; }
  const g = (sq, sh, k) => Number(rows.find((r) => r.squad === sq && Number(r.share) === sh)[k]);
  const off = type === 'heal' ? g('with', 0, 'healed') : g('with', 0, 'dmg') - g('without', 0, 'dmg');
  const on = type === 'heal' ? g('with', 0.4, 'healed') : g('with', 0.4, 'dmg') - g('without', 0.4, 'dmg');
  const cut = off > 0 ? Math.round(100 * (1 - on / off)) : null;
  console.log(`| ${boss} | ${type} | ${off} | ${on} | ${cut === null ? '-' : cut + '%'} | ${cut !== null && cut >= 50 ? 'yes' : 'NO'} |`);
  if (process.env.SIM_DEBUG) console.log(JSON.stringify(rows));
}
