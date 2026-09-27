/**
 * Acceptance test for tcg-bot/supabase/card_effects.sql, run against the LIVE database
 * with NO lasting change:  node scripts/test-card-effects.mjs [path-to-card_effects.sql]
 * One DO block applies the migration, builds test members + test effects, runs every
 * case, then RAISEs the results. The exception rolls back everything.
 * Exit code 1 if any case fails.
 */
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

dotenv.config({ override: true });
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = ((process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const file = process.argv[2] || fileURLToPath(new URL('../../tcg-bot/supabase/card_effects.sql', import.meta.url));
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return r.json();
};

const migration = readFileSync(file, 'utf8');
if (migration.includes('$mig$')) throw new Error('the migration must not contain $mig$');

const body = String.raw`
do $test$
declare
  s int[]; n bigint[]; g bigint; ir bigint; r jsonb; d interval; v int;
  res jsonb := '[]'::jsonb;
begin
  execute $mig$${migration}$mig$;
  update effect_primitives set enabled = true;
  update settings set value = '{"send_per_day":0,"prank_recv_per_day":0,"timeout_recv_per_day":0,"pair_per_day":0,"gift_pack_per_week":0}'::jsonb
   where key = 'card_effect_caps';

  -- Fixtures: 8 subjects that have a Normal card; the first one also needs Gold + IR.
  select array_agg(sid) into s from (
    select c.subject_id sid from cards c where c.rarity::text = 'normal'
     group by c.subject_id
    having bool_or(exists (select 1 from cards g where g.subject_id = c.subject_id and g.rarity::text = 'gold'))
    order by c.subject_id limit 1) a;
  s := s || (select array_agg(sid) from (select distinct subject_id sid from cards where rarity::text = 'normal'
                                           and subject_id <> s[1] order by 1 limit 7) b);
  select array_agg((select id from cards where subject_id = x and rarity::text = 'normal' order by id limit 1) order by ord)
    into n from unnest(s) with ordinality u(x, ord);
  select id into g  from cards where subject_id = s[1] and rarity::text = 'gold' order by id limit 1;
  select id into ir from cards where subject_id = s[1] and rarity::text = 'illustrated_rare' order by id limit 1;

  insert into players (id, username) select 'tst_' || x, 'tst ' || x from unnest(array['a','b','c','d','e','f','g','h']) x;
  -- s1 timeout 50s cd 48h | s2 sticker 1h cd 1h | s3 title | s4 lucky_pull | s5 gift_pack | s6 gift_pack | s7 cleanse | s8 rally (disabled below)
  update subjects set effect = '{"primitive":"timeout","base":{"duration_s":50},"cooldown_h":48}' where id = s[1];
  update subjects set effect = '{"primitive":"sticker","base":{"duration_s":3600},"cooldown_h":1}' where id = s[2];
  update subjects set effect = '{"primitive":"title","base":{"duration_s":3600},"cooldown_h":1}' where id = s[3];
  update subjects set effect = '{"primitive":"lucky_pull","base":{"amount":2},"cooldown_h":24}' where id = s[4];
  update subjects set effect = '{"primitive":"gift_pack","base":{"amount":1},"cooldown_h":24}' where id = s[5];
  update subjects set effect = '{"primitive":"gift_pack","base":{"amount":1},"cooldown_h":24}' where id = s[6];
  update subjects set effect = '{"primitive":"cleanse","cooldown_h":24}' where id = s[7];
  update subjects set effect = '{"primitive":"rally","base":{"amount":10},"cooldown_h":24}' where id = s[8];
  insert into player_cards (player_id, card_id, quantity) values
    ('tst_a', n[1], 1), ('tst_a', g, 1), ('tst_c', g, 1), ('tst_e', ir, 1),
    ('tst_a', n[2], 1), ('tst_c', n[2], 1), ('tst_e', n[2], 1),
    ('tst_a', n[3], 1), ('tst_a', n[4], 1),
    ('tst_f', n[5], 1), ('tst_f', n[6], 1), ('tst_g', n[7], 1), ('tst_h', n[8], 1);

  -- C1 a timeout on b (Normal): applied, 50s, one pending Discord action.
  r := play_card_effect('tst_a', n[1], 'tst_b');
  res := res || jsonb_build_object('case','C1 normal timeout applies 50s','ok',
    r->>'outcome' = 'applied' and (r->>'duration_s')::int = 50
    and (select count(*) from discord_effects where target_id='tst_b' and primitive='timeout' and status='pending') = 1,'r',r);
  -- C2 same card again: cooldown.
  r := play_card_effect('tst_a', n[1], 'tst_c');
  res := res || jsonb_build_object('case','C2 same card on cooldown','ok', r->>'error' = 'cooldown','r',r);
  -- C3 the Gold copy of the SAME subject: still on cooldown (cooldown is per subject).
  r := play_card_effect('tst_a', g, 'tst_c');
  res := res || jsonb_build_object('case','C3 other tier of same subject shares the cooldown','ok', r->>'error' = 'cooldown','r',r);
  -- C4 c plays Gold on a: 50*1.5=75 clamped to the 60s hard limit; cooldown 48*0.65 = 31.2h.
  r := play_card_effect('tst_c', g, 'tst_a');
  d := (r->>'ready_at')::timestamptz - now();
  res := res || jsonb_build_object('case','C4 gold is stronger but clamped to 60s, cooldown x0.65','ok',
    (r->>'duration_s')::int = 60 and d between interval '31.1 hours' and interval '31.3 hours','r',r);
  -- C5 IR: 50*1.15 = 57.5 -> 58s; cooldown 43.2h.
  r := play_card_effect('tst_e', ir, 'tst_c');
  d := (r->>'ready_at')::timestamptz - now();
  res := res || jsonb_build_object('case','C5 illustrated rare x1.15 + cd x0.9','ok',
    (r->>'duration_s')::int = 58 and d between interval '43.1 hours' and interval '43.3 hours','r',r);
  -- C6 self target, C7 not owned, C8 disabled primitive.
  r := play_card_effect('tst_a', n[2], 'tst_a');
  res := res || jsonb_build_object('case','C6 self target refused','ok', r->>'error' = 'self_target','r',r);
  r := play_card_effect('tst_b', n[2], 'tst_c');
  res := res || jsonb_build_object('case','C7 not owned refused','ok', r->>'error' = 'not_owned','r',r);
  update effect_primitives set enabled = false where primitive = 'rally';
  r := play_card_effect('tst_h', n[8], 'tst_a');
  res := res || jsonb_build_object('case','C8 disabled primitive refused','ok', r->>'error' = 'effect_disabled','r',r);
  update effect_primitives set enabled = true where primitive = 'rally';

  -- C9 ward blocks a prank, and the ward is used up.
  insert into player_effects (player_id, primitive) values ('tst_d', 'ward');
  r := play_card_effect('tst_a', n[2], 'tst_d');
  res := res || jsonb_build_object('case','C9 ward blocks the prank and is consumed','ok',
    r->>'outcome' = 'blocked' and not card_effect_active('tst_d','sticker') and not card_effect_active('tst_d','ward'),'r',r);
  -- C10 reflect bounces the prank to the sender.
  insert into player_effects (player_id, primitive) values ('tst_b', 'reflect');
  r := play_card_effect('tst_c', n[2], 'tst_b');
  res := res || jsonb_build_object('case','C10 reflect bounces to sender','ok',
    r->>'outcome' = 'reflected' and r->>'target' = 'tst_c' and card_effect_active('tst_c','sticker')
    and not card_effect_active('tst_b','sticker') and not card_effect_active('tst_b','reflect'),'r',r);
  -- C11 depth 1: a reflected prank ignores the SENDER's reflect.
  insert into player_effects (player_id, primitive) values ('tst_b', 'reflect'), ('tst_a', 'reflect');
  r := play_card_effect('tst_a', n[3], 'tst_b');
  res := res || jsonb_build_object('case','C11 a reflected prank cannot bounce again','ok',
    r->>'outcome' = 'reflected' and r->>'target' = 'tst_a' and card_effect_active('tst_a','title')
    and card_effect_active('tst_a','reflect'),'r',r);
  -- C12 a refused play (no stacking) does NOT use up the target's reflect.
  insert into player_effects (player_id, primitive) values ('tst_d', 'reflect');
  insert into player_effects (player_id, primitive, expires_at) values ('tst_e', 'sticker', now() + interval '1 hour');
  r := play_card_effect('tst_e', n[2], 'tst_d');
  res := res || jsonb_build_object('case','C12 refused play keeps the target reflect','ok',
    r->>'error' = 'already_active' and card_effect_active('tst_d','reflect')
    and not exists (select 1 from card_effect_cooldowns where player_id='tst_e' and subject_id=s[2]),'r',r);

  -- C13 sender cap.
  select count(*) into v from card_plays where player_id = 'tst_a' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  update settings set value = jsonb_set(value, '{send_per_day}', to_jsonb(v)) where key = 'card_effect_caps';
  r := play_card_effect('tst_a', n[4], 'tst_b');
  res := res || jsonb_build_object('case','C13 sender daily cap','ok', r->>'error' = 'send_cap','r',r);
  update settings set value = jsonb_set(value, '{send_per_day}', '0') where key = 'card_effect_caps';
  -- C14 target prank cap.
  select count(*) into v from card_plays where target_id = 'tst_c' and kind = 'prank' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  update settings set value = jsonb_set(value, '{prank_recv_per_day}', to_jsonb(v)) where key = 'card_effect_caps';
  r := play_card_effect('tst_e', n[2], 'tst_c');  -- e's sticker card is ready (C12 was refused)
  res := res || jsonb_build_object('case','C14 target daily prank cap','ok', r->>'error' = 'target_prank_cap','r',r);
  update settings set value = jsonb_set(value, '{prank_recv_per_day}', '0') where key = 'card_effect_caps';
  -- C15 gift_pack weekly cap (1): the first mints one pack, the second is refused.
  update settings set value = jsonb_set(value, '{gift_pack_per_week}', '1') where key = 'card_effect_caps';
  v := (select pack_balance from players where id = 'tst_g');
  r := play_card_effect('tst_f', n[5], 'tst_g');
  res := res || jsonb_build_object('case','C15a gift_pack mints one pack','ok',
    r->>'outcome' = 'applied' and (select pack_balance from players where id = 'tst_g') = v + 1,'r',r);
  r := play_card_effect('tst_f', n[6], 'tst_h');
  res := res || jsonb_build_object('case','C15b gift_pack weekly cap','ok', r->>'error' = 'gift_pack_cap','r',r);
  -- C16 cleanse removes pranks now (Activity + Discord), and leaves boons.
  insert into player_effects (player_id, primitive) values ('tst_b', 'lucky_pull');
  r := play_card_effect('tst_g', n[7], 'tst_b');
  res := res || jsonb_build_object('case','C16 cleanse removes pranks, keeps boons','ok',
    r->>'outcome' = 'applied' and not card_effect_active('tst_b','timeout') and card_effect_active('tst_b','lucky_pull'),'r',r);

  raise exception 'TEST_RESULTS %', res;
end $test$;`;

const out = await q(body);
const msg = JSON.stringify(out);
const m = msg.match(/TEST_RESULTS (\[.*\])/);
if (!m) { console.error('NO RESULTS:', msg.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\n.*$/, ''));
let fail = 0;
for (const x of results) { if (!x.ok) fail++; console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.case}${x.ok ? '' : '  ' + JSON.stringify(x.r)}`); }
const after = await q(`select to_regclass('public.card_plays') is null tables_gone, (select count(*) from players where id like 'tst\\_%') test_players`);
console.log(`\n${results.length - fail}/${results.length} passed | after rollback: ${JSON.stringify(after)}`);
process.exitCode = fail ? 1 : 0;
