/**
 * Acceptance test for tcg-bot/supabase/hunt_boss_difficulty.sql against the LIVE database
 * with NO lasting change:  node scripts/test-boss-difficulty.mjs
 * One DO block applies the migration, spawns bosses, fights a test player, checks every new
 * rule, then RAISEs the results. The exception rolls back everything (the live hunt too).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
// The combat migration + the HP retune on top (spawn_hunt is replaced by the second file).
const mig = ['hunt_boss_difficulty.sql', 'hunt_boss_hp_up.sql'].map((f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8')).join(String.fromCharCode(10));
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const body = String.raw`do $t$
declare
  h bigint; r jsonb; res jsonb := '[]'; v int; k text; ids bigint[]; c bigint; i int; d date := (now() at time zone 'utc')::date;
  hp bigint; mx int; kinds text[] := '{}'; bad_cycle int := 0; strikes numeric[] := '{}'; heals jsonb := '[]'; hunters int; dp bigint;
  rec record; ok boolean; n int; ph text; prev bigint;
begin
  execute $m$${mig}$m$;

  -- 1. Spawns: passives per tier (1/2/3, all different), HP x 9/10/9, hp_share = HP / hunters.
  insert into players (id, username) values ('tst_boss', 'tst boss');
  select array_agg(id) into ids from (select c.id from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character','Creature') and c.rarity::text = 'gold' order by c.id limit 8) x;
  insert into player_cards (player_id, card_id, quantity) select 'tst_boss', unnest(ids), 1;
  select greatest(1, count(distinct pc.player_id)) into hunters from player_cards pc join cards c on c.id = pc.card_id
    join subjects s on s.id = c.subject_id where pc.quantity >= 1 and s.type in ('Character','Creature');
  dp := deployable_power();
  ok := true; n := 0;
  for i in 1..24 loop
    h := spawn_hunt(3);
    select * into rec from hunts where id = h;
    n := n + 1;
    if jsonb_array_length(rec.passive->'list') <> (case rec.tier when 'Normal' then 1 when 'Heroic' then 2 else 3 end)
       or (select count(distinct x->>'kind') from jsonb_array_elements(rec.passive->'list') x) <> jsonb_array_length(rec.passive->'list')
       or rec.hp_max <> greatest(500, round(dp * (case rec.tier when 'Normal' then 22 when 'Heroic' then 30 else 44 end)))
       or rec.hp_share <> greatest(1, round(rec.hp_max::numeric / hunters)) then ok := false; end if;
  end loop;
  res := res || jsonb_build_object('case', 'spawn: passives 1/2/3 distinct, HP x22/30/44, hp_share = HP/hunters (24 spawns)', 'ok', ok, 'hunters', hunters, 'dp', dp);

  -- 2. A long fight on a quiet test boss (no passives, big HP) to sample the boss turn.
  insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share)
    values ('Test Boss', 'Normal', '[]', '[]', '{"list": []}', 1000000, 1000000, now() + interval '1 day', 100000) returning id into h;
  for i in 1..400 loop
    select card_id into c from unnest(ids) card_id
      where not exists (select 1 from hunt_card_hp x where x.hunt_id = h and x.player_id = 'tst_boss' and x.card_id = card_id and x.hit_date = d
                        and (x.downed or coalesce(x.cd_until_round, 0) >= hunt_state_round(h, 'tst_boss', d) + 1))
      order by random() limit 1;
    if c is null then  -- a new "day": clear the squad and the round counter
      delete from hunt_card_hp where hunt_id = h and player_id = 'tst_boss';
      delete from hunt_combat_state where hunt_id = h and player_id = 'tst_boss';
      continue;
    end if;
    r := hunt_attack('tst_boss', h, c);
    if not (r->>'ok')::boolean then continue; end if;
    k := r->'boss_action'->>'kind';
    if k is null then continue; end if;
    kinds := array_append(kinds, k);
    v := (r->'boss_action'->>'round')::int;
    if (k = 'charging') <> (v % 8 = 7) or (k = 'cataclysm') <> (v % 8 = 0 and k <> 'stunned') then bad_cycle := bad_cycle + 1; end if;
    if k = 'strike' and (r->>'card_max_hp')::int > 0 then
      strikes := array_append(strikes, round((r->>'counter_dmg')::numeric / (r->>'card_max_hp')::numeric, 3));
    end if;
    if k in ('drain', 'regenerate') then heals := heals || jsonb_build_object('k', k, 'heal', (r->>'boss_heal')::int); end if;
  end loop;
  res := res || jsonb_build_object('case', 'every boss move shows up', 'ok',
    (select bool_and(m = any(kinds)) from unnest(array['strike','slam','drain','stun','enrage','curse','regenerate','charging','cataclysm']) m),
    'counts', (select jsonb_object_agg(m, cnt) from (select m, count(*) cnt from unnest(kinds) m group by m) z));
  res := res || jsonb_build_object('case', 'Charging exactly on round 8n-1, Cataclysm on 8n', 'ok', bad_cycle = 0, 'bad', bad_cycle);
  res := res || jsonb_build_object('case', 'strike = 18-28% of the card HP (x1.4 when enraged)', 'ok',
    (select min(s) >= 0.17 and max(s) <= 0.40 and percentile_cont(0.5) within group (order by s) between 0.18 and 0.28 from unnest(strikes) s),
    'min', (select min(s) from unnest(strikes) s), 'median', (select percentile_cont(0.5) within group (order by s) from unnest(strikes) s), 'max', (select max(s) from unnest(strikes) s));
  res := res || jsonb_build_object('case', 'drain heals 1.5% and regenerate 3% of the player share (100000)', 'ok',
    (select bool_and((x->>'heal')::int = case x->>'k' when 'drain' then 1500 else 3000 end) from jsonb_array_elements(heals) x) and jsonb_array_length(heals) > 0,
    'heals', (select jsonb_agg(distinct x) from jsonb_array_elements(heals) x));

  -- 3. Stun: the stunned card waits while another card can attack; the day never sticks.
  delete from hunt_card_hp where hunt_id = h and player_id = 'tst_boss';
  delete from hunt_combat_state where hunt_id = h and player_id = 'tst_boss';
  perform hunt_attack('tst_boss', h, ids[1]);
  update hunt_card_hp set cd_until_round = hunt_state_round(h, 'tst_boss', d) + 1 where hunt_id = h and player_id = 'tst_boss' and card_id = ids[1];
  r := hunt_attack('tst_boss', h, ids[1]);
  res := res || jsonb_build_object('case', 'a stunned card waits (other cards can attack)', 'ok', r->>'error' = 'stunned', 'r', r);
  for i in 2..8 loop perform hunt_attack('tst_boss', h, ids[i]); end loop;           -- 8 cards committed (the cap)
  update hunt_card_hp set downed = true, hp_remaining = 0 where hunt_id = h and player_id = 'tst_boss' and card_id <> ids[1];
  update hunt_card_hp set downed = false, hp_remaining = 50, cd_until_round = hunt_state_round(h, 'tst_boss', d) + 1 where hunt_id = h and player_id = 'tst_boss' and card_id = ids[1];
  r := hunt_attack('tst_boss', h, ids[1]);
  res := res || jsonb_build_object('case', 'the last card standing can attack even when stunned', 'ok', (r->>'ok')::boolean, 'r', r->>'error');

  -- 4. Phases: below 50% the rage phase is reported; below 25% the boss gains a passive.
  delete from hunt_card_hp where hunt_id = h and player_id = 'tst_boss';
  delete from hunt_combat_state where hunt_id = h and player_id = 'tst_boss';
  update hunts set hp_remaining = 500001, passive = '{"list": []}' where id = h;
  ph := null;
  for i in 1..8 loop
    select hp_remaining into prev from hunts where id = h;
    r := hunt_attack('tst_boss', h, ids[i]);
    if r->>'phase' = 'rage' then ph := 'rage'; exit; end if;
    exit when prev < 500000;
  end loop;
  res := res || jsonb_build_object('case', 'the hit that crosses 50% reports the rage phase', 'ok', ph = 'rage', 'r', r->>'phase', 'hp', r->>'hp_remaining');
  delete from hunt_card_hp where hunt_id = h and player_id = 'tst_boss';
  delete from hunt_combat_state where hunt_id = h and player_id = 'tst_boss';
  update hunts set hp_remaining = 250001 where id = h;
  for i in 1..8 loop r := hunt_attack('tst_boss', h, ids[i]); exit when r->>'phase' is not null; end loop;
  select jsonb_array_length(passive->'list') into v from hunts where id = h;
  res := res || jsonb_build_object('case', 'below 25% the boss gains one passive (once)', 'ok', v = 1 and (select (passive->>'phase2')::boolean from hunts where id = h), 'list', (select passive->'list' from hunts where id = h), 'phase', r->>'phase');

  -- 5. Thorns: 10% of the damage comes back to the attacking card (the boss is stunned, so no other hit).
  delete from hunt_card_hp where hunt_id = h and player_id = 'tst_boss';
  delete from hunt_combat_state where hunt_id = h and player_id = 'tst_boss';
  update hunts set hp_remaining = 1000000, passive = '{"list": [{"kind": "thorns"}], "phase2": true}' where id = h;
  perform hunt_state_round(h, 'tst_boss', d);
  insert into hunt_combat_state (hunt_id, player_id, hit_date, round, stunned_until) values (h, 'tst_boss', d, 0, 999)
    on conflict (hunt_id, player_id, hit_date) do update set stunned_until = 999;
  mx := card_max_hp(card_power('gold', 0, (select s.cp_mod from cards c join subjects s on s.id = c.subject_id where c.id = ids[2])));
  r := hunt_attack('tst_boss', h, ids[2]);
  res := res || jsonb_build_object('case', 'thorns: the card loses 10% of its own damage', 'ok',
    (r->>'damage')::int = 0 and (r->>'card_hp')::int = mx or (r->>'card_hp')::int = mx - greatest(1, round((r->>'damage')::int * 0.10)),
    'damage', r->>'damage', 'card_hp', r->>'card_hp', 'max', mx, 'boss', r->'boss_action'->>'kind');

  raise exception 'RES %', res;
end $t$;`;
const out = JSON.stringify(await q(body)); const m = out.match(/RES (\[.*\])/);
if (!m) { console.log(out.slice(0, 2500)); process.exitCode = 1; }
else {
  const rs = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, '')); let f = 0;
  for (const x of rs) { if (!x.ok) f++; const { case: c, ok, ...rest } = x; console.log(`${ok ? 'PASS' : 'FAIL'}  ${c}  ${JSON.stringify(rest)}`); }
  process.exitCode = f ? 1 : 0;
}
console.log('after:', JSON.stringify(await q(`select (select count(*) from players where id='tst_boss') test_player, (select count(*) from hunts where status='active') active_hunts, (select name from hunts where status='active' limit 1) live, to_regclass('public.hunts') is not null ok, (select count(*) from information_schema.columns where table_name='hunts' and column_name='hp_share') hp_share_col`)));
