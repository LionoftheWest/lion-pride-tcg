/**
 * Acceptance test for tcg-bot/supabase/hunt_schedule_mt.sql (rolled back, no lasting change):
 *   node scripts/test-hunt-schedule-mt.mjs ../tcg-bot/supabase/hunt_schedule_mt.sql
 * The MT slots, the next spawn / close across the Nov 1 time change, and the cron jobs.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(process.argv[2], 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const body = `do $t$ declare res jsonb := '[]'; begin
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'spawn slot: Thu 21 UTC in MDT, 22 UTC in MST, not the other hour', 'ok',
    hunt_mt_slot('spawn', '2026-10-01 21:00:05+00') and not hunt_mt_slot('spawn', '2026-10-01 22:00:05+00')
    and hunt_mt_slot('spawn', '2026-11-05 22:00:05+00') and not hunt_mt_slot('spawn', '2026-11-05 21:00:05+00'));
  res := res || jsonb_build_object('case', 'close slot: Mon 23 UTC in MDT, Tue 00 UTC in MST', 'ok',
    hunt_mt_slot('close', '2026-10-05 23:00:05+00') and not hunt_mt_slot('close', '2026-10-06 00:00:05+00')
    and hunt_mt_slot('close', '2026-11-10 00:00:05+00') and not hunt_mt_slot('close', '2026-11-09 23:00:05+00'));
  res := res || jsonb_build_object('case', 'nudge slot: Mon 17 UTC in MDT, 18 UTC in MST', 'ok',
    hunt_mt_slot('nudge', '2026-10-05 17:00:05+00') and hunt_mt_slot('nudge', '2026-11-09 18:00:05+00') and not hunt_mt_slot('nudge', '2026-11-09 17:00:05+00'));
  res := res || jsonb_build_object('case', 'next spawn from today = Thu 10-01 3 PM MDT (21:00 UTC); across the time change = 22:00 UTC', 'ok',
    hunt_next_mt(4, 15, '2026-09-29 21:00+00') = '2026-10-01 21:00+00' and hunt_next_mt(4, 15, '2026-10-29 22:00+00') = '2026-11-05 22:00+00',
    'a', hunt_next_mt(4, 15, '2026-09-29 21:00+00'), 'b', hunt_next_mt(4, 15, '2026-10-29 22:00+00'));
  res := res || jsonb_build_object('case', 'next close: Mon 10-05 5 PM MDT; after the change Mon 11-02 5 PM MST = Tue 00:00 UTC', 'ok',
    hunt_next_mt(1, 17, '2026-10-01 21:00+00') = '2026-10-05 23:00+00' and hunt_next_mt(1, 17, '2026-10-31 12:00+00') = '2026-11-03 00:00+00');
  res := res || jsonb_build_object('case', 'the live functions agree: next_hunt_spawn / next_hunt_close', 'ok',
    next_hunt_spawn() = hunt_next_mt(4, 15, now()) and next_hunt_close() = hunt_next_mt(1, 17, now()), 'spawn', next_hunt_spawn(), 'close', next_hunt_close());
  res := res || jsonb_build_object('case', 'the jobs: 4 MT jobs, the 3 UTC jobs gone', 'ok',
    (select count(*) from cron.job where jobname like 'hunt-%-mt%') = 4 and (select count(*) from cron.job where jobname in ('spawn-weekly-boss','nudge-weekly-boss','close-weekly-boss')) = 0,
    'jobs', (select jsonb_agg(jobname || ' ' || schedule) from cron.job));
  res := res || jsonb_build_object('case', 'the tick does nothing outside its hour', 'ok', weekly_boss_tick('spawn')->>'note' = 'not_this_hour');
  raise exception 'RESULTS %', res; end $t$;`;
const out = JSON.stringify(await q(body)); const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log(out.slice(0, 1500)); process.exit(1); }
const rows = JSON.parse(m[1].replace(/\\"/g, '"')); let f = 0;
for (const r of rows) { const { case: c, ok, ...x } = r; if (!ok) f++; console.log(`${ok ? 'PASS' : 'FAIL'} ${c}${ok ? '' : ' ' + JSON.stringify(x)}`); }
console.log(f ? `${f} FAILED` : `PASS all ${rows.length}`);
console.log('after:', JSON.stringify(await q("select jsonb_agg(jobname) j from cron.job")));
