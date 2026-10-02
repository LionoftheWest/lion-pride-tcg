/**
 * Test hunt_loop_caps.sql against the live DB with NO lasting change:
 *   node scripts/test-hunt-loop-caps.mjs [file.sql]     (default: ../tcg-bot/supabase/hunt_loop_caps.sql)
 *   node scripts/test-hunt-loop-caps.mjs --baseline     (the live functions, no migration: every
 *                                                        "guard" case must FAIL, the "keep" case must PASS)
 * One DO block: apply the file, make a test boss + member, run the cases, then RAISE the results
 * (everything rolls back).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const baseline = process.argv[2] === '--baseline';
const mig = baseline ? 'select 1' : readFileSync(process.argv[2] || new URL('../../tcg-bot/supabase/hunt_loop_caps.sql', import.meta.url), 'utf8');
const P = 'tst_loop';
const body = String.raw`do $t$ declare
  h bigint; d date := (now() at time zone 'America/Denver')::date;
  blast bigint := 63; heal bigint := 330; shl bigint; stun1 bigint; stun2 bigint;
  r jsonb; res jsonb := '[]'; v int; mx int; n int; i int; ok boolean; cap int;
begin
  execute $m$${mig}$m$;
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
    values ('Test Boss', 'Normal', '[]', '[]', 9000000, 9000000, now() + interval '1 day') returning id into h;
  select c.id into shl from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'shield' limit 1;
  select c.id into stun1 from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'stun' order by c.id limit 1;
  select c.id into stun2 from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'stun' and c.id <> stun1 order by c.id limit 1;
  insert into players (id, username) values ('${P}', 'tst loop');
  insert into player_cards (player_id, card_id, quantity) values ('${P}', blast, 1), ('${P}', heal, 1), ('${P}', shl, 1), ('${P}', stun1, 1), ('${P}', stun2, 1);
  perform hunt_state_round(h, '${P}', d);

  -- 1. A support card that is down does nothing.
  perform hunt_commit_card(h, '${P}', heal, d, 60);
  perform hunt_commit_card(h, '${P}', blast, d, 239);
  update hunt_card_hp set hp_remaining = 0, downed = true where player_id = '${P}' and card_id = heal;
  update hunt_card_hp set hp_remaining = 10 where player_id = '${P}' and card_id = blast;
  r := hunt_support('${P}', h, heal, blast);
  select hp_remaining into v from hunt_card_hp where player_id = '${P}' and card_id = blast;
  res := res || jsonb_build_object('guard', true, 'case', 'a downed heal card does not heal', 'ok', r->>'error' = 'support_downed' and v = 10, 'hp', v, 'r', r);

  -- 2. A living heal card keeps the percentage heal: 54% of Blastoise's max HP on every cast.
  update hunt_card_hp set hp_remaining = 60, downed = false where player_id = '${P}' and card_id = heal;
  select max_hp into mx from hunt_card_hp where player_id = '${P}' and card_id = blast;
  n := 0;
  for i in 1..4 loop
    update hunt_card_hp set hp_remaining = 1 where player_id = '${P}' and card_id = blast;
    update hunt_combat_state set round = round + 2 where player_id = '${P}';   -- past the cooldown
    r := hunt_support('${P}', h, heal, blast);
    select hp_remaining into v from hunt_card_hp where player_id = '${P}' and card_id = blast;
    if v = 1 + round(mx * 0.54) then n := n + 1; end if;
  end loop;
  res := res || jsonb_build_object('guard', false, 'case', 'a living heal card heals 54% on every cast', 'ok', n = 4, 'full_heals', n, 'max_hp', mx, 'last', r);

  -- 3. Stun immunity: after a stun the boss cannot be stunned again for 2 rounds.
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
  res := res || jsonb_build_object('guard', true, 'case', 'no second stun until 2 rounds after the stun ends', 'ok', ok and (r->>'ok')::boolean, 'r', r);

  -- 4. The round limit: the last round posts the summary, then attacks and supports stop.
  cap := coalesce((select (value #>> '{}')::int from settings where key = 'hunt_round_cap'), 40);
  update hunt_combat_state set round = cap - 1, stunned_until = 0 where player_id = '${P}';
  update hunt_card_hp set hp_remaining = max_hp, downed = false where player_id = '${P}' and card_id = blast;
  r := hunt_attack('${P}', h, blast);
  ok := (r->>'ok')::boolean and exists (select 1 from hunt_events where hunt_id = h and kind = 'player_done' and payload->>'player_id' = '${P}');
  r := hunt_attack('${P}', h, blast);
  ok := ok and r->>'error' = 'round_cap';
  perform hunt_commit_card(h, '${P}', shl, d, 60);
  r := hunt_support('${P}', h, shl, blast);
  select round into v from hunt_combat_state where player_id = '${P}';
  res := res || jsonb_build_object('guard', true, 'case', 'round ' || cap || ' is the last: summary posts, then attack + support refuse', 'ok', ok and r->>'error' = 'round_cap' and v = cap, 'round', v, 'r', r);

  raise exception 'RES %', res;
end $t$;`;
const out = JSON.stringify(await q(body)); const m = out.match(/RES (\[.*\])/);
if (!m) { console.log(out.slice(0, 1500)); process.exitCode = 1; }
else {
  const rs = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, '')); let bad = 0;
  console.log(baseline ? '--- BASELINE (live functions, no migration): guard cases FAIL, the keep case PASSES' : '--- WITH hunt_loop_caps.sql');
  for (const x of rs) {
    const want = baseline ? !x.guard : true;
    if (x.ok !== want) bad++;
    console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.guard ? '[guard]' : '[keep] '} ${x.case}${x.ok ? '' : '  ' + JSON.stringify(x)}`);
  }
  process.exitCode = bad ? 1 : 0;
}
console.log('after:', JSON.stringify(await q(`select (select count(*) from players where id='${P}') test_player`)));
