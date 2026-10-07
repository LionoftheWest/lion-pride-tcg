import fs from 'fs';
// Acceptance test for hunt_squad_done.sql (live DB, rolled back): node scripts/test-hunt-squad-done.mjs [live]
//   live (or old): the CURRENT functions, no migration (test-all-local.mjs runs this mode).
//   MUTATE=nosummary|done node scripts/test-hunt-squad-done.mjs live   must FAIL.
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { fileURLToPath } from 'node:url';
import { GATE, mutation } from './fixtures.mjs';
const ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const mig = ['old', 'live'].includes(process.argv[2]) ? '' : fs.readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/hunt_squad_done.sql', import.meta.url)), 'utf8');
const MUT = mutation({
  nosummary: ['public.hunt_attack(text,bigint,bigint)', '(v_downed and hunt_squad_done(p_hunt, p_player, v_day, v_cap))', '(v_downed and false)'],
  done: ['public.hunt_squad_done(bigint,text,date,integer)', '    return not exists (', '    return exists ('],
});
const body = `do $t$
declare bad text := ''; h bigint; atk bigint[]; sup bigint; r jsonb; n int; c bigint; ev int; i int;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  ${MUT}
  -- Its own boss (rolled back): the live boss can be defeated or closed.
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at) values ('Test Boss', 'Normal', '[]', '[]', 500000, 500000, now() + interval '1 day') returning id into h;
  select array_agg(id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id where s.type in ('Character','Creature') and c.rarity = 'normal' order by c.id limit 3) x;
  select c.id into sup from cards c join subjects s on s.id = c.subject_id where s.type not in ('Character','Creature') and s.ability->>'kind' = 'support' limit 1;
  insert into players (id, username) values ('tst_dn_a', 'a');
  insert into player_cards (player_id, card_id, quantity) select 'tst_dn_a', x, 1 from unnest(atk || sup) x;
  ${GATE('tst_dn_a')}
  r := lock_hunt_squad('tst_dn_a', h, atk || sup); -- a short squad: 3 attackers + 1 support
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'lock ' || r::text || '; '; end if;
  -- A fixed seed (as in test-launch-event-cards.mjs): the fight is random. A card whose every hit missed
  -- (0 damage, no hunt_hits row) is not in cards_used, and a stun on the last attacker kept it stunned
  -- (the round moves only on an attack), so about 1 run in 6 failed (2026-10-06).
  perform setseed(0.42);
  for i in 1..4 loop
    foreach c in array atk loop
      for n in 1..60 loop
        r := hunt_attack('tst_dn_a', h, c);
        exit when not coalesce((r->>'ok')::boolean, false) or coalesce((r->>'card_downed')::boolean, false);
      end loop;
    end loop;
  end loop;
  select count(*) into ev from hunt_events where hunt_id = h and kind = 'player_done' and payload->>'player_id' = 'tst_dn_a';
  if ev <> 1 then bad := bad || 'player_done events ' || ev || ' (want 1); '; end if;
  -- It posts after the LAST attacker is down, not the first: the summary counts all 3 attackers.
  select (payload->>'cards_used')::int into n from hunt_events where hunt_id = h and kind = 'player_done' and payload->>'player_id' = 'tst_dn_a' order by id limit 1;
  if n is distinct from 3 then bad := bad || 'the summary counts ' || coalesce(n::text, 'null') || ' cards (want 3: it posted before the last attacker was down); '; end if;
  raise exception 'RESULTS [%]', bad;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS [error: % / %]', sqlerrm, bad;
end $t$;`;
const out = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: body }) })).text();
const m = out.match(/RESULTS \[([^\]]*)\]/);
console.log(m ? (m[1] ? 'FAIL ' + m[1] : 'PASS: a short squad (3 attackers + 1 support) posts ONE end-of-day summary when its attackers are down') : 'NO RESULTS ' + out.slice(0, 400));
