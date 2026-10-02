/**
 * Test hunt_loop_caps.sql against the live DB with NO lasting change:
 *   node scripts/test-hunt-loop-caps.mjs [file.sql]     (default: ../tcg-bot/supabase/hunt_loop_caps.sql)
 *   node scripts/test-hunt-loop-caps.mjs --baseline     (the live functions, no migration: every case must FAIL)
 * One DO block: apply the file, make a test boss + member, run the cases, then RAISE the results
 * (everything rolls back).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const baseline = process.argv[2] === '--baseline';
const mig = baseline ? 'alter table public.hunt_card_hp add column if not exists restored int not null default 0' // the column only: the live functions ignore it
  : readFileSync(process.argv[2] || new URL('../../tcg-bot/supabase/hunt_loop_caps.sql', import.meta.url), 'utf8');
const P = 'tst_loop';
const body = String.raw`do $t$ declare
  h bigint; d date := (now() at time zone 'America/Denver')::date;
  blast bigint := 63; heal bigint := 330; shl bigint; stun1 bigint; stun2 bigint; ls bigint;
  r jsonb; res jsonb := '[]'; v int; v2 int; mx int; tot int; n int; i int; ok boolean; cap int; hp0 int;
begin
  execute $m$${mig}$m$;
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
    values ('Test Boss', 'Normal', '[]', '[]', 9000000, 9000000, now() + interval '1 day') returning id into h;
  select c.id into shl from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'shield' limit 1;
  select c.id into stun1 from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'stun' order by c.id limit 1;
  select c.id into stun2 from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'stun' and c.id <> stun1 order by c.id limit 1;
  select c.id into ls from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'lifesteal' order by c.id limit 1;
  insert into players (id, username) values ('${P}', 'tst loop');
  insert into player_cards (player_id, card_id, quantity) values ('${P}', blast, 1), ('${P}', heal, 1), ('${P}', shl, 1), ('${P}', stun1, 1), ('${P}', stun2, 1), ('${P}', ls, 1);
  perform hunt_state_round(h, '${P}', d);

  -- 1. A support card that is down does nothing.
  perform hunt_commit_card(h, '${P}', heal, d, 60);
  perform hunt_commit_card(h, '${P}', blast, d, 239);
  update hunt_card_hp set hp_remaining = 0, downed = true where player_id = '${P}' and card_id = heal;
  update hunt_card_hp set hp_remaining = 10 where player_id = '${P}' and card_id = blast;
  r := hunt_support('${P}', h, heal, blast);
  select hp_remaining into v from hunt_card_hp where player_id = '${P}' and card_id = blast;
  res := res || jsonb_build_object('case', 'a downed heal card does not heal', 'ok', r->>'error' = 'support_downed' and v = 10, 'hp', v, 'r', r);
  update hunt_card_hp set hp_remaining = 60, downed = false where player_id = '${P}' and card_id = heal;

  -- 2. The Blastninja loop: heal Blastoise from 1 HP again and again. The total healed stops at its max HP.
  select max_hp into mx from hunt_card_hp where player_id = '${P}' and card_id = blast;
  tot := 0; n := 0;
  for i in 1..10 loop
    update hunt_card_hp set hp_remaining = 1 where player_id = '${P}' and card_id = blast;
    update hunt_combat_state set round = round + 2 where player_id = '${P}';   -- past the cooldown
    r := hunt_support('${P}', h, heal, blast);
    select hp_remaining into v from hunt_card_hp where player_id = '${P}' and card_id = blast;
    if (r->>'ok')::boolean then n := n + 1; tot := tot + (v - 1); end if;
  end loop;
  res := res || jsonb_build_object('case', 'heals on one card stop at 100% of its max HP a day', 'ok', tot = mx and n = 2 and r->>'error' = 'restore_cap',
    'healed', tot, 'max_hp', mx, 'casts', n, 'last', r);

  -- 3. A shield uses the same budget (Blastoise has none left).
  update hunt_combat_state set round = round + 2 where player_id = '${P}';
  perform hunt_commit_card(h, '${P}', shl, d, 60);
  r := hunt_support('${P}', h, shl, blast);
  select shield into v from hunt_card_hp where player_id = '${P}' and card_id = blast;
  res := res || jsonb_build_object('case', 'a shield cannot pass the budget', 'ok', r->>'error' = 'restore_cap' and v = 0, 'shield', v, 'r', r);

  -- 4. Lifesteal uses the budget: with a full budget it heals, with an empty one it does not.
  perform hunt_commit_card(h, '${P}', ls, d, 60);
  ok := false; v2 := 0;
  for i in 1..15 loop   -- a hit is random (misses): look for one hit that heals
    update hunt_card_hp set hp_remaining = 5, restored = 0, downed = false where player_id = '${P}' and card_id = ls;
    r := hunt_attack('${P}', h, ls);
    if coalesce((r->>'heal')::int, 0) > 0 then ok := true; exit; end if;
  end loop;
  n := 0;
  for i in 1..15 loop
    select max_hp into v from hunt_card_hp where player_id = '${P}' and card_id = ls;
    update hunt_card_hp set hp_remaining = 5, restored = v, downed = false where player_id = '${P}' and card_id = ls;
    r := hunt_attack('${P}', h, ls);
    if coalesce((r->>'damage')::int, 0) > 0 then n := n + 1; v2 := v2 + coalesce((r->>'heal')::int, 0); end if;
  end loop;
  res := res || jsonb_build_object('case', 'lifesteal heals with budget left, not with an empty budget', 'ok', ok and n > 0 and v2 = 0,
    'healed_with_budget', ok, 'hits_without', n, 'heal_without', v2);

  -- 5. Stun immunity: after a stun the boss cannot be stunned again for 2 rounds.
  perform hunt_commit_card(h, '${P}', stun1, d, 60);
  perform hunt_commit_card(h, '${P}', stun2, d, 60);
  update hunt_combat_state set round = 10, stunned_until = 0 where player_id = '${P}';
  r := hunt_support('${P}', h, stun1, null);
  ok := (r->>'ok')::boolean;
  r := hunt_support('${P}', h, stun2, null);
  ok := ok and r->>'error' = 'boss_stun_immune';
  update hunt_combat_state set round = 12 where player_id = '${P}';
  r := hunt_support('${P}', h, stun2, null);
  ok := ok and r->>'error' = 'boss_stun_immune';
  update hunt_combat_state set round = 13 where player_id = '${P}';
  r := hunt_support('${P}', h, stun2, null);
  res := res || jsonb_build_object('case', 'no second stun until 2 rounds after the stun ends', 'ok', ok and (r->>'ok')::boolean, 'r', r);

  -- 6. The round limit: the last round posts the summary, then attacks and supports stop.
  cap := coalesce((select (value #>> '{}')::int from settings where key = 'hunt_round_cap'), 40);
  update hunt_combat_state set round = cap - 1, stunned_until = 0 where player_id = '${P}';
  update hunt_card_hp set hp_remaining = max_hp, downed = false where player_id = '${P}' and card_id = blast;
  r := hunt_attack('${P}', h, blast);
  ok := (r->>'ok')::boolean and exists (select 1 from hunt_events where hunt_id = h and kind = 'player_done' and payload->>'player_id' = '${P}');
  r := hunt_attack('${P}', h, blast);
  ok := ok and r->>'error' = 'round_cap';
  update hunt_card_hp set cd_until_round = 0 where player_id = '${P}' and card_id = shl;
  r := hunt_support('${P}', h, shl, blast);
  select round into v from hunt_combat_state where player_id = '${P}';
  res := res || jsonb_build_object('case', 'round ' || cap || ' is the last: summary posts, then attack + support refuse', 'ok', ok and r->>'error' = 'round_cap' and v = cap, 'round', v, 'r', r);

  raise exception 'RES %', res;
end $t$;`;
const out = JSON.stringify(await q(body)); const m = out.match(/RES (\[.*\])/);
if (!m) { console.log(out.slice(0, 1500)); process.exitCode = 1; }
else {
  const rs = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, '')); let f = 0;
  console.log(baseline ? '--- BASELINE (live functions, no migration): each case should FAIL' : '--- WITH hunt_loop_caps.sql');
  for (const x of rs) { if (!x.ok) f++; console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.case}${x.ok ? '' : '  ' + JSON.stringify(x)}`); }
  process.exitCode = baseline ? (f === rs.length ? 0 : 1) : (f ? 1 : 0);
}
console.log('after:', JSON.stringify(await q(`select (select count(*) from players where id='${P}') test_player, (select count(*) from information_schema.columns where table_name='hunt_card_hp' and column_name='restored') restored_col`)));
