/**
 * The activity limit is for ACTIVITY packs only (Nathan, 2026-09-30): at most 5 a day from
 * chat + the dailies, while gifts, the raid reward, boon packs and achievements never count
 * toward it and are never blocked by it. Rolled back:  node scripts/test-activity-cap.mjs
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const A = '999999999999999951', F = '999999999999999952';
const body = String.raw`do $t$
declare res jsonb := '[]'; d date := (now() at time zone 'America/Denver')::date; r jsonb; g int; bal int;
begin
  update settings set value = '1'::jsonb where key = 'pack_earn_multiplier';
  update settings set value = value || '{"enabled": true, "cap": 5}' where key = 'dailies';
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username, pack_balance) values ('${A}', 'tst act', 0), ('${F}', 'tst friend', 50);
  -- Outside packs FIRST (a big amount): they must not use up the activity room.
  perform gift_packs('${F}', '${A}', 20);
  perform grant_packs('${A}', 3, 'hunt_reward', null);
  perform grant_packs('${A}', 2, 'boon', null);
  r := claim_achievement('${A}', 'tst_ach', 4, null, null);
  res := res || jsonb_build_object('case', 'gifts, the raid reward, a boon and an achievement (29 packs) count 0 toward the activity limit', 'ok',
    earned_today('${A}') = 0 and (select pack_balance from players where id = '${A}') = 29, 'earned', earned_today('${A}'), 'ach', r);
  -- Activity: chat 2 + check-in 1 + voice 1 + trade 1 = 5, then the limit holds.
  insert into daily_activity (player_id, activity_date, message_count) values ('${A}', d, 25);
  g := claim_daily_earn('${A}', d, 1, 1, 25);
  perform claim_daily('${A}', 'checkin');
  insert into voice_minutes (player_id, day, minutes) values ('${A}', d, 30);
  perform claim_daily('${A}', 'voice');
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id, status, resolved_at)
    select '${A}', '${F}', (select id from cards order by id limit 1), (select id from cards order by id offset 1 limit 1), 'accepted', now();
  perform claim_daily('${A}', 'social');
  res := res || jsonb_build_object('case', 'the full 5 activity packs are still earned after the 29 outside packs', 'ok',
    g = 2 and earned_today('${A}') = 5 and (select pack_balance from players where id = '${A}') = 34, 'earned', earned_today('${A}'));
  -- After the activity limit: outside packs still arrive in full.
  perform gift_packs('${F}', '${A}', 5);
  perform grant_packs('${A}', 6, 'hunt_reward', null);
  select pack_balance into bal from players where id = '${A}';
  res := res || jsonb_build_object('case', 'at the activity limit, a gift (5) and a raid reward (6) still arrive in full', 'ok', bal = 45 and earned_today('${A}') = 5, 'balance', bal);
  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 500)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like '99999999999999995%') test_players, (select value from settings where key='pack_earn_multiplier') dial")));
process.exitCode = fail ? 1 : 0;
