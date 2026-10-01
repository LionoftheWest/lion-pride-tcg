/**
 * player_reports.sql (Nathan, 2026-10-01; design 23): the in-game report button. Rolled back
 * against the LIVE database:  node scripts/test-player-reports.mjs
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/player_reports.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const X = '999999999999999961', Y = '999999999999999962';
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
begin
  execute $m$${mig}$m$;
  insert into players (id, username) values ('${X}', 'tst rep x'), ('${Y}', 'tst rep y');
  r := submit_report('${X}', 'bug', '  The pack would not open  ', '{"screen": "home", "version": "abc1234"}');
  res := res || jsonb_build_object('case', 'a bug report is stored, trimmed, with its context, not yet synced', 'ok',
    (r->>'ok')::boolean and exists (select 1 from player_reports where id = (r->>'id')::bigint and player_id = '${X}' and kind = 'bug'
      and body = 'The pack would not open' and context->>'screen' = 'home' and synced_at is null and issue_number is null), 'r', r);
  res := res || jsonb_build_object('case', 'an unknown kind is refused', 'ok', submit_report('${X}', 'rant', 'hello there', null)->>'error' = 'kind');
  res := res || jsonb_build_object('case', 'under 5 characters (after trim) is refused', 'ok', submit_report('${X}', 'idea', '  hey  ', null)->>'error' = 'short');
  res := res || jsonb_build_object('case', 'over 1500 characters is refused', 'ok', submit_report('${X}', 'idea', repeat('a', 1501), null)->>'error' = 'long');
  res := res || jsonb_build_object('case', 'exactly 1500 characters is accepted', 'ok', (submit_report('${X}', 'idea', repeat('a', 1500), null)->>'ok')::boolean);
  r3 := submit_report('${X}', 'feedback', 'third report today', null);
  r4 := submit_report('${X}', 'feedback', 'fourth report today', null);
  res := res || jsonb_build_object('case', '3 a day: the 3rd is accepted (0 left), the 4th is refused', 'ok',
    (r3->>'ok')::boolean and (r3->>'left')::int = 0 and r4->>'error' = 'limit'
    and (select count(*) from player_reports where player_id = '${X}') = 3, 'r3', r3, 'r4', r4);
  -- Reports from an earlier MT day do not count.
  insert into player_reports (player_id, kind, body, created_at) select '${Y}', 'bug', 'an old report', now() - interval '2 days' from generate_series(1, 3);
  res := res || jsonb_build_object('case', 'another member, and an earlier MT day, do not count toward the limit', 'ok',
    (submit_report('${Y}', 'bug', 'a report from today', null)->>'ok')::boolean);
  res := res || jsonb_build_object('case', 'an unknown member is refused', 'ok', submit_report('999999999999999969', 'bug', 'who am i', null)->>'error' = 'player');
  update settings set value = '{"per_day": 0}' where key = 'reports';
  res := res || jsonb_build_object('case', 'per_day 0 turns reports off', 'ok', submit_report('${Y}', 'bug', 'reports are off', null)->>'error' = 'off');
  res := res || jsonb_build_object('case', 'RLS is on with no policy (no member can read a report)', 'ok',
    (select relrowsecurity from pg_class where oid = 'public.player_reports'::regclass)
    and not exists (select 1 from pg_policies where tablename = 'player_reports'));
  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2000)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 500)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after (live unchanged):', JSON.stringify(await q("select (select count(*) from information_schema.tables where table_name='player_reports') table_live, (select count(*) from players where id like '99999999999999996%') test_players")));
process.exit(fail ? 1 : 0);
