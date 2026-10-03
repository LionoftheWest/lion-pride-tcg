/**
 * Acceptance test for tcg-bot/supabase/daily_cap_5.sql against the LIVE database with NO
 * lasting change:  node scripts/test-daily-cap.mjs
 * At most 5 EARNED packs a day, chat included, in any order. RAISEs the results, so
 * everything rolls back.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/daily_cap_5.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const A = '999999999999999941', B = '999999999999999942', X = '999999999999999943';
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; g int; d date; c1 bigint; c2 bigint; h bigint;
begin
  ${process.argv.includes('--apply-migrations') ? 'execute $m$' + mig + '$m$;' : '-- the CURRENT functions (daily_cap_5.sql was replaced by the Shards dailies)'}
  update settings set value = '1'::jsonb where key = 'pack_earn_multiplier';
  update settings set value = value || '{"enabled": true}' where key = 'dailies';
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${A}', 'tst a'), ('${B}', 'tst b'), ('${X}', 'tst x');
  d := (now() at time zone 'America/Denver')::date;
  select id into c1 from cards order by id limit 1;
  select id into c2 from cards where id <> c1 order by id limit 1;
  res := res || jsonb_build_object('case', 'the daily limit is 5', 'ok', (dailies_view('${A}')->>'cap')::int = 5);

  -- A: chat first (2), then the dailies until the limit.
  insert into daily_activity (player_id, activity_date, message_count) values ('${A}', d, 25);
  g := claim_daily_earn('${A}', d, 1, 1, 25);
  perform claim_daily('${A}', 'checkin');
  insert into voice_minutes (player_id, day, minutes) values ('${A}', d, 30);
  perform claim_daily('${A}', 'voice');
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id, status, resolved_at) values ('${A}', '${X}', c1, c2, 'accepted', now());
  perform claim_daily('${A}', 'social');
  h := spawn_hunt(3);
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) select h, '${A}', id, d, 5 from cards order by id limit 8;
  r := claim_daily('${A}', 'hunt');
  -- At the limit a daily pays 0 packs and still its Shards (shards_dailies_gifts.sql, 2026-10-02).
  res := res || jsonb_build_object('case', 'chat first: 2 chat + 3 dailies = 5, the 6th (hunt) pays 0 packs + its Shards', 'ok',
    g = 2 and earned_today('${A}') = 5 and (r->>'ok')::boolean and (r->>'packs')::int = 0 and (r->>'shards')::int > 0
    and (select pack_balance from players where id = '${A}') = 5, 'g', g, 'r', r, 'earned', earned_today('${A}'));

  -- B: 4 dailies first, then chat: only 1 chat pack fits; the chat row shows 1, not 2.
  perform claim_daily('${B}', 'checkin');
  insert into voice_minutes (player_id, day, minutes) values ('${B}', d, 30);
  perform claim_daily('${B}', 'voice');
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id, status, resolved_at) values ('${B}', '${X}', c1, c2, 'accepted', now());
  perform claim_daily('${B}', 'social');
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) select h, '${B}', id, d, 5 from cards order by id limit 8;
  perform claim_daily('${B}', 'hunt');
  insert into daily_activity (player_id, activity_date, message_count) values ('${B}', d, 25);
  g := claim_daily_earn('${B}', d, 1, 1, 25);
  res := res || jsonb_build_object('case', 'dailies first: 4 + only 1 chat pack = 5 (was 6)', 'ok',
    g = 1 and earned_today('${B}') = 5 and (select pack_balance from players where id = '${B}') = 5, 'g', g, 'earned', earned_today('${B}'));
  res := res || jsonb_build_object('case', 'the chat row shows the chat packs really paid (1 of 2)', 'ok',
    (select (x->>'packs')::int from jsonb_array_elements(dailies_tasks('${B}')) x where x->>'task' = 'chat') = 1);
  res := res || jsonb_build_object('case', 'at the limit a chat earn pays 0 and records no ledger row', 'ok',
    claim_daily_earn('${B}', d, 1, 1, 25) = 0 and (select count(*) from pack_ledger where player_id = '${B}' and amount = 0) = 0);

  -- X: a member under the limit gets both chat packs as before.
  insert into daily_activity (player_id, activity_date, message_count) values ('${X}', d, 25);
  res := res || jsonb_build_object('case', 'under the limit, chat still pays 1 + 1', 'ok', claim_daily_earn('${X}', d, 1, 1, 25) = 2);
  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 600)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like '99999999999999994%') test_players, (select value->>'cap' from settings where key='dailies') live_cap, (select value from settings where key='pack_earn_multiplier') dial")));
process.exitCode = fail ? 1 : 0;
