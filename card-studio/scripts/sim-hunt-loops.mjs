/**
 * Raid loop finder (live DB, everything rolls back). Plays one attacker (Blastninja's Blastoise, card 63)
 * with heal / shield supports for up to 300 rounds, with the round limit OFF, and counts the rounds
 * until the attacker is down. An endless loop reaches 300.
 *   node scripts/sim-hunt-loops.mjs <A|B|C|D> [trials]           with hunt_loop_caps.sql
 *   LIVE=1 node scripts/sim-hunt-loops.mjs <A|B|C|D> [trials]    the live functions (the control)
 * Squads: A = Blastoise + the Pokemon heal card (330, Blastninja's squad), B = + a second heal card,
 * C = 330 + 2 shield cards, D = 3 heal + 3 shield cards. The squad is filled to 8 with downed attackers,
 * so a stunned Blastoise can still attack (as in a real late fight).
 * Best play each round: every ready support casts (a heal on Blastoise first, else on the weakest card),
 * then Blastoise attacks.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.env.LIVE ? 'select 1' : readFileSync(new URL('../../tcg-bot/supabase/hunt_loop_caps.sql', import.meta.url), 'utf8');
const [cfg = 'A', trials = 10] = process.argv.slice(2);
const pick = (eff, n, extra = '') => `(select array_agg(id) from (select c.id from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = '${eff}' ${extra} order by c.id limit ${n}) x)`;
const SUP = {
  A: `array[330::bigint]`,
  B: `array[330::bigint] || ${pick('heal', 1, 'and c.id <> 330')}`,
  C: `array[330::bigint] || ${pick('shield', 2)}`,
  D: `array[330::bigint] || ${pick('heal', 2, 'and c.id <> 330')} || ${pick('shield', 3)}`,
}[cfg];
if (!SUP) { console.error('squad must be A, B, C or D'); process.exit(2); }
const body = String.raw`do $t$ declare
  h bigint; d date := (now() at time zone 'America/Denver')::date; P text := 'tst_sim';
  sups bigint[]; s bigint; tg bigint; r jsonb; tr int; rd int; lastrd int; supdown int; dmg bigint; eff text; res jsonb := '[]';
begin
  execute $m$${mig}$m$;
  insert into settings (key, value) values ('hunt_round_cap', '1000'::jsonb) on conflict (key) do update set value = excluded.value;
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at, passive)
    values ('Sim Boss', 'Normal', '[]', '[]', 30000, 30000, now() + interval '1 day', '{}'::jsonb) returning id into h;
  sups := ${SUP};
  insert into players (id, username) values (P, 'tst sim');
  insert into player_cards (player_id, card_id, quantity) select P, x, 1 from unnest(array[63::bigint] || sups) x;
  for tr in 1..${Number(trials)} loop
    delete from hunt_card_hp where player_id = P; delete from hunt_combat_state where player_id = P; delete from hunt_hits where player_id = P;
    update hunts set hp_remaining = 30000, status = 'active' where id = h;
    perform hunt_state_round(h, P, d);
    perform hunt_commit_card(h, P, 63, d, 239);
    foreach s in array sups loop perform hunt_commit_card(h, P, s, d, 60); end loop;
    insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)
      select h, P, c.id, d, 0, 60, true from cards c join subjects sb on sb.id = c.subject_id
       where sb.type in ('Character', 'Creature') and c.id <> 63 order by c.id limit greatest(0, 7 - cardinality(sups));
    supdown := null; dmg := 0;
    for rd in 1..300 loop
      foreach s in array sups loop
        select sb.ability->>'effect' into eff from cards c join subjects sb on sb.id = c.subject_id where c.id = s;
        select card_id into tg from hunt_card_hp where player_id = P and not downed and card_id = any(array[63::bigint] || sups)
          order by (card_id = 63 and hp_remaining < max_hp) desc,
                   (hp_remaining + case when eff = 'shield' then shield else 0 end)::numeric / max_hp, card_id = 63 desc limit 1;
        r := hunt_support(P, h, s, tg);
      end loop;
      if supdown is null and (select bool_and(downed) from hunt_card_hp where player_id = P and card_id = any(sups)) then supdown := rd; end if;
      lastrd := rd;
      r := hunt_attack(P, h, 63);
      dmg := dmg + coalesce((r->>'damage')::int, 0);
      exit when coalesce((r->>'card_downed')::boolean, false) or r->>'error' is not null;
    end loop;
    res := res || jsonb_build_object('rounds', lastrd, 'supports_down', supdown, 'damage', dmg, 'end', case when coalesce((r->>'card_downed')::boolean, false) then 'downed' else coalesce(r->>'error', 'round 300') end);
  end loop;
  raise exception 'RES %', res;
end $t$;`;
const out = JSON.stringify(await q(body)); const m = out.match(/RES (\[.*?\])/);
if (!m) { console.log(out.slice(0, 1200)); process.exit(1); }
const rs = JSON.parse(m[1].replace(/\\"/g, '"'));
const sorted = (k) => rs.map((x) => x[k]).sort((a, b) => a - b);
const r = sorted('rounds');
console.log(`${process.env.LIVE ? 'LIVE' : 'hunt_loop_caps.sql'} squad ${cfg}: rounds ${r.join(',')} | median ${r[r.length >> 1]} | damage median ${sorted('damage')[rs.length >> 1]}`
  + ` | supports all down at ${rs.map((x) => x.supports_down ?? '-').join(',')} | ended by ${[...new Set(rs.map((x) => x.end))].join(',')}`);
