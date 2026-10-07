/**
 * Acceptance test for tcg-bot/supabase/dailies.sql against the LIVE database with NO
 * lasting change:  node scripts/test-dailies.mjs
 * One DO block applies the migration, drives every task, the flag, the pause, the streak,
 * the cap and the dial, then RAISEs the results. The exception rolls back everything.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/dailies.sql', import.meta.url)), 'utf8')
  .replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; v jsonb; ok boolean; h bigint; i int; c1 bigint; c2 bigint; sub bigint;
  d date := (now() at time zone 'utc')::date;
begin
  execute $m$${mig}$m$;
  -- This file's functions read the settings rows dailies (cap, shards, voice_minutes) and pack_earn_multiplier;
  -- balance_economy.sql moved those numbers to balance (the live functions read balance). The test restores the old
  -- rows inside its rolled-back block.
  insert into settings (key, value) values ('pack_earn_multiplier', '1') on conflict (key) do nothing;
  update settings set value = balance_get('daily') - 'tasks' - 'streak_days' || value where key = 'dailies';
  -- The migration keeps an existing setting: live has the flag ON, so set it OFF first.
  update settings set value = value || '{"enabled": false}' where key = 'dailies';
  update settings set value = '1'::jsonb where key = 'pack_earn_multiplier';
  insert into players (id, username) values ('tst_d1', 'tst d1'), ('tst_d2', 'tst d2'), ('tst_d3', 'tst d3'), ('tst_d4', 'tst d4');
  select id, subject_id into c1, sub from cards order by id limit 1;
  select id into c2 from cards where id <> c1 order by id limit 1;

  -- The flag.
  res := res || jsonb_build_object('case', 'flag off: the window is hidden and a claim is refused', 'ok',
    dailies_view('tst_d1') = '{"enabled": false}'::jsonb and claim_daily('tst_d1', 'checkin')->>'error' = 'disabled'
    and add_voice_minutes(array['tst_d1']) = 0);
  update settings set value = value || '{"enabled": true}' where key = 'dailies';

  -- The pause (dial 0).
  update settings set value = '0'::jsonb where key = 'pack_earn_multiplier';
  res := res || jsonb_build_object('case', 'paused: claims refused, voice minutes not counted, the view says paused', 'ok',
    claim_daily('tst_d1', 'checkin')->>'error' = 'paused' and add_voice_minutes(array['tst_d1']) = 0
    and (dailies_view('tst_d1')->>'paused')::boolean and not exists (select 1 from voice_minutes where player_id = 'tst_d1'));
  update settings set value = '1'::jsonb where key = 'pack_earn_multiplier';

  -- Check-in: once a day.
  r := claim_daily('tst_d1', 'checkin');
  res := res || jsonb_build_object('case', 'check-in pays 1 pack once a day (earned_checkin)', 'ok',
    (r->>'ok')::boolean and (r->>'packs')::int = 1 and (select pack_balance from players where id = 'tst_d1') = 1
    and (select count(*) from pack_ledger where player_id = 'tst_d1' and reason = 'earned_checkin') = 1
    and claim_daily('tst_d1', 'checkin')->>'error' = 'claimed' and (select pack_balance from players where id = 'tst_d1') = 1, 'r', r);

  -- Streak: 2 days before today -> today is day 3 = +1 bonus.
  insert into daily_claims (player_id, day, task, amount) values ('tst_d2', d - 1, 'checkin', 1), ('tst_d2', d - 2, 'checkin', 1), ('tst_d2', d - 4, 'checkin', 1);
  v := dailies_view('tst_d2');
  r := claim_daily('tst_d2', 'checkin');
  res := res || jsonb_build_object('case', 'streak day 3: 1 + 1 bonus (earned_checkin + earned_streak), streak 3; a gap breaks it', 'ok',
    (v->'tasks'->0->>'reward')::int = 2 and (r->>'packs')::int = 2
    and (select count(*) from pack_ledger where player_id = 'tst_d2' and reason in ('earned_checkin', 'earned_streak')) = 2
    and (r->'view'->'tasks'->0->>'streak')::int = 3, 'v', v->'tasks'->0, 'r', r->'view'->'tasks'->0);

  -- Voice: 30 minutes, a duplicate id in one tick counts once, an unknown id is ignored.
  for i in 1..29 loop perform add_voice_minutes(array['tst_d1', 'tst_d1', 'nobody_here']); end loop;
  ok := claim_daily('tst_d1', 'voice')->>'error' = 'not_done' and (select minutes from voice_minutes where player_id = 'tst_d1') = 29
    and not exists (select 1 from voice_minutes where player_id = 'nobody_here');
  perform add_voice_minutes(array['tst_d1']);
  r := claim_daily('tst_d1', 'voice');
  res := res || jsonb_build_object('case', 'voice: 29 min not done, 30 min pays 1 (duplicates once, unknown ignored)', 'ok',
    ok and (r->>'ok')::boolean and (r->>'packs')::int = 1, 'r', r);

  -- Hunt: 8 different cards on today's boss.
  h := spawn_hunt(3);
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
    select h, 'tst_d3', id, d, 10 from cards order by id limit 7;
  ok := claim_daily('tst_d3', 'hunt')->>'error' = 'not_done';
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
    select h, 'tst_d3', id, d, 10 from cards order by id offset 7 limit 1;
  r := claim_daily('tst_d3', 'hunt');
  res := res || jsonb_build_object('case', 'hunt: 7 different cards not done, 8 pays 1', 'ok',
    ok and (r->>'ok')::boolean and (r->>'packs')::int = 1, 'r', r);

  -- Social: a same-card trade and a prank do not count; a different-card trade does.
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id, status, resolved_at) values ('tst_d4', 'tst_d1', c1, c1, 'accepted', now());
  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome)
    values ('tst_d4', 'tst_d1', 'tst_d1', c1, sub, 'nickname', 'prank', 'normal', 'applied'),
           ('tst_d4', 'tst_d1', 'tst_d1', c1, sub, 'spotlight', 'boon', 'normal', 'blocked');
  ok := claim_daily('tst_d4', 'social')->>'error' = 'not_done';
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id, status, resolved_at) values ('tst_d4', 'tst_d1', c1, c2, 'accepted', now());
  r := claim_daily('tst_d4', 'social');
  res := res || jsonb_build_object('case', 'social: same-card trade, prank, blocked boon do not count; a real trade pays 1', 'ok',
    ok and (r->>'ok')::boolean and (r->>'packs')::int = 1, 'r', r);
  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome)
    values ('tst_d3', 'tst_d2', 'tst_d2', c1, sub, 'spotlight', 'boon', 'normal', 'applied');
  res := res || jsonb_build_object('case', 'social: a boon on another member counts', 'ok',
    (claim_daily('tst_d3', 'social')->>'ok')::boolean);

  -- The cap counts chat earnings too.
  update settings set value = value || '{"cap": 3}' where key = 'dailies';
  perform grant_packs('tst_d1', 1, 'earned_daily', null);   -- chat: tst_d1 has 1 + 1 + 1 = 3 earned
  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome)
    values ('tst_d1', 'tst_d2', 'tst_d2', c1, sub, 'spotlight', 'boon', 'normal', 'applied');
  r := claim_daily('tst_d1', 'social');
  res := res || jsonb_build_object('case', 'the cap (3) counts chat: the 4th earned pack is refused and not recorded', 'ok',
    r->>'error' = 'capped' and not exists (select 1 from daily_claims where player_id = 'tst_d1' and task = 'social')
    and (dailies_view('tst_d1')->>'earned')::int = 3, 'r', r);
  update settings set value = value || '{"cap": 7}' where key = 'dailies';

  -- The dial scales rewards; gifts do not count toward the cap.
  update settings set value = '2'::jsonb where key = 'pack_earn_multiplier';
  perform grant_packs('tst_d4', 5, 'gift_received', null);
  r := claim_daily('tst_d4', 'checkin');
  res := res || jsonb_build_object('case', 'dial 2 doubles a reward; a gift is not an earning', 'ok',
    (r->>'packs')::int = 2 and earned_today('tst_d4') = 3, 'r', r);

  res := res || jsonb_build_object('case', 'bad task and unknown member are refused', 'ok',
    claim_daily('tst_d1', 'chat')->>'error' = 'bad_task' and claim_daily('nobody_here', 'checkin')->>'error' = 'no_player');

  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) {
  const { case: name, ok, ...rest } = r;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 600)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like 'tst_d%') test_players, (select count(*) from information_schema.tables where table_name in ('daily_claims','voice_minutes')) tables_live, (select count(*) from settings where key='dailies') setting_live, (select value from settings where key='pack_earn_multiplier') dial")));
process.exitCode = fail ? 1 : 0;
