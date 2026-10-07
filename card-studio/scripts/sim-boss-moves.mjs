/**
 * Measure the boss counter moves (docs/hunt-boss-moves.md section 7) with NO lasting change. Run it on the LOCAL copy:
 *   LOCALDB=1 NODE_OPTIONS=--import=./scripts/localdb-preload.mjs node scripts/sim-boss-moves.mjs [days] [file.sql]
 * For each boss and each squad, it plays scripted squad-days through the real hunt_attack / hunt_support: first with
 * the counter moves off (share 0), then on (share 0.4; balance boss_counters). A day: every ready support plays (heal on the most hurt
 * attacker, shield / empower on the next attacker), then one attack; until every attacker is down or the round cap.
 * The result: the average boss damage per squad-day. Off and on use the same random seed for each day (paired).
 * One rolled-back block per boss.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https?:\/\/([a-z0-9]+)/)?.[1] || 'local';
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const DAYS = Number(process.argv[2] || 6);
// [file.sql]: a migration to run first (in the block). No file: the database as it is (hunt_boss_moves.sql is
// superseded; the shares and weights are balance boss_counters since hunt_counter_balance.sql).
const mig = !process.argv[3] ? '' : readFileSync(process.argv[3], 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const ALL_BOSSES = ['The Grind Vampire', 'The AFK Warzombie', 'The Smurf Brute', 'The Hardstuck Skeleton', 'Maw of the Meta', 'The Rage-Quit Warlord',
  'The Ranked Nightshade', 'The Lagspike Parasite', 'The Netcode Mutant', 'The Patch-Day Pumpkin', 'The Ban-Wave Demon', 'The Zerg-Rush Queen'];
// SIM_BOSSES / SIM_SQUADS (JSON) pick a subset, for a quick check.
const BOSSES = process.env.SIM_BOSSES ? JSON.parse(process.env.SIM_BOSSES) : ALL_BOSSES;
// Squads of 8: attackers (full_art) + supports by effect.
const SQUADS = process.env.SIM_SQUADS ? JSON.parse(process.env.SIM_SQUADS) : {
  'support-heavy (3 atk + heal, shield, empower, weaken, expose)': [3, ['heal', 'shield', 'empower', 'weaken', 'expose']],
  'mixed (5 atk + heal, shield, weaken)': [5, ['heal', 'shield', 'weaken']],
  'attackers only (8 atk)': [8, []],
};

function bossSQL(boss) {
  const squads = Object.entries(SQUADS).map(([name, [na, effs]]) => `jsonb_build_object('name', '${name}', 'na', ${na}, 'effs', '${JSON.stringify(effs)}'::jsonb)`).join(', ');
  return String.raw`do $t$ declare
  P text := 'tst_simbm'; d date := (now() at time zone 'America/Denver')::date; out jsonb := '[]';
  atks bigint[]; sq jsonb; share numeric; day int; h bigint; ids bigint[]; sup bigint[]; a bigint; s bigint; r jsonb; tg bigint;
  rounds int; total bigint; n int; eff text;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the database as it is'}
  select array_agg(id order by id) into atks from (select c.id from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character', 'Creature') and c.rarity = 'full_art' order by c.id limit 8) x;
  insert into players (id, username) values (P, 'tst sim');
  insert into player_cards (player_id, card_id, quantity) select P, x, 1 from unnest(atks) x;
  insert into player_cards (player_id, card_id, quantity)
    select P, min(c.id), 1 from cards c join subjects s on s.id = c.subject_id
    where s.ability->>'kind' = 'support' and c.rarity = 'normal' group by s.ability->>'effect';
  update balance set value = '8' where key = 'daily_card_cap';   -- the daily card cap (balance_table.sql)
  for sq in select * from jsonb_array_elements(jsonb_build_array(${squads})) loop
    select array_agg(x) into ids from (select unnest(atks[1:(sq->>'na')::int]) x) y;
    select coalesce(array_agg(pc.card_id), '{}') into sup from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
      where pc.player_id = P and s.ability->>'kind' = 'support' and s.ability->>'effect' in (select jsonb_array_elements_text(sq->'effs'));
    foreach share in array array[0, 0.4]::numeric[] loop
      update balance set value = jsonb_set(value, '{share}', to_jsonb(share)) where key = 'boss_counters';
      total := 0;
      for day in 1..${DAYS} loop
        insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
          values ('${boss}', 'Normal', '[]', '[]', '{"list": []}', 9000000, 9000000, now() + interval '1 day', 3000, '{"atk": 58}') returning id into h;
        perform hunt_state_round(h, P, d);
        perform setseed(day / 1000.0);   -- the same seed for off and on: a paired comparison (less noise)
        for rounds in 1..60 loop
          -- every ready support plays
          foreach s in array sup loop
            select s2.ability->>'effect' into eff from cards c join subjects s2 on s2.id = c.subject_id where c.id = s;
            select x.card_id into tg from hunt_card_hp x where x.hunt_id = h and x.player_id = P and x.card_id = any(ids) and not x.downed
              order by case when eff = 'heal' then x.hp_remaining::numeric / greatest(1, x.max_hp) else 0 end, x.card_id limit 1;
            if tg is null then tg := ids[1]; end if;
            r := hunt_support(P, h, s, tg);
          end loop;
          -- one attack: the first attacker that may attack
          r := null;
          foreach a in array ids loop
            r := hunt_attack(P, h, a);
            exit when coalesce((r->>'ok')::boolean, false) or r->>'error' in ('round_cap', 'hunt_over');
          end loop;
          exit when r is null or not coalesce((r->>'ok')::boolean, false);
        end loop;
        total := total + coalesce((select sum(damage) from hunt_hits where hunt_id = h and player_id = P), 0);
        update hunts set status = 'expired' where id = h;
      end loop;
      out := out || jsonb_build_object('boss', '${boss}', 'squad', sq->>'name', 'share', share, 'avg', round(total::numeric / ${DAYS}));
    end loop;
  end loop;
  raise exception 'SIM%', out;
end $t$;`;
}

const rows = [];
for (const boss of BOSSES) {
  const res = await q(bossSQL(boss));
  const m = String(res?.message || JSON.stringify(res)).match(/SIM(\[[\s\S]*?\])(\nCONTEXT|$)/);
  if (!m) { console.log('ERROR', boss, JSON.stringify(res).slice(0, 1500)); process.exit(1); }
  rows.push(...JSON.parse(m[1]));
  process.stderr.write(`${boss} done\n`);
}
console.log(`Average boss damage per squad-day (${DAYS} days each). Off = counter moves off, On = 40% of normal turns.\n`);
console.log('| Boss | Squad | Off | On | Change |\n|---|---|---|---|---|');
for (const boss of BOSSES) for (const sq of Object.keys(SQUADS)) {
  const off = rows.find((r) => r.boss === boss && r.squad === sq && Number(r.share) === 0)?.avg;
  const on = rows.find((r) => r.boss === boss && r.squad === sq && Number(r.share) === 0.4)?.avg;
  console.log(`| ${boss} | ${sq} | ${off} | ${on} | ${off ? Math.round((100 * (on - off)) / off) : '-'}% |`);
}
