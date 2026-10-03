/**
 * daily_cap_default.sql: when settings.dailies has no 'cap', the dailies (claim_daily, dailies_view)
 * and the chat packs (claim_daily_earn) use the SAME default limit, 5.
 * Rolled back:  node scripts/test-daily-cap-default.mjs [path/to/daily_cap_default.sql]
 * Without an argument it tests the LIVE functions (the baseline: 7 vs 5 fails).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv[2] ? readFileSync(process.argv[2], 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';
const A = '999999999999999951', B = '999999999999999952';
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; g int; d date := (now() at time zone 'America/Denver')::date;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the live functions'}
  update settings set value = '1'::jsonb where key = 'pack_earn_multiplier';
  update settings set value = (value - 'cap') || '{"enabled": true}' where key = 'dailies'; -- the default applies
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${A}', 'tst cap a'), ('${B}', 'tst cap b');
  res := res || jsonb_build_object('case', 'with no cap set, the Dailies window shows the limit 5', 'ok',
    (dailies_view('${A}')->>'cap')::int = 5, 'r', dailies_view('${A}')->'cap');
  -- A has earned 5 today: a daily pays no packs (the same limit as the chat packs).
  perform grant_packs('${A}', 5, 'earned_daily', null);
  r := claim_daily('${A}', 'checkin');
  res := res || jsonb_build_object('case', 'with no cap set, a daily at 5 earned pays 0 packs', 'ok',
    coalesce((r->>'packs')::int, 0) = 0, 'r', r);
  -- B has earned 5 today: the chat packs pay nothing either (claim_daily_earn, already 5).
  perform grant_packs('${B}', 5, 'earned_checkin', null);
  insert into daily_activity (player_id, activity_date, message_count) values ('${B}', d, 50);
  g := claim_daily_earn('${B}', d, 1, 1, 20);
  res := res || jsonb_build_object('case', 'with no cap set, the chat packs at 5 earned pay 0', 'ok', g = 0, 'r', g);
  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('FAIL NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const x of results) { if (!x.ok) fail++; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok ? '' : ` ${JSON.stringify(x.r)}`}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
