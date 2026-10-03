/**
 * prune_old_rows (prune_old_rows.sql) deletes ONLY the old rows that no reader uses, and the daily
 * pg_cron job exists once. Old and new rows of each table go in; the test checks which are left.
 * Rolled back:  node scripts/test-prune-old-rows.mjs [path/to/prune_old_rows.sql]
 * Without an argument it tests the LIVE function (the baseline: it fails while the function is missing).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv[2] ? readFileSync(process.argv[2], 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';
const P = 'tst_prune_p';
// Each test row: [label, table, the insert (it returns the id), should it be deleted?]
const ROWS = [
  ['a read note 31 days old', 'notifications', `insert into notifications (player_id, kind, message, read, created_at) values ('${P}', 'tst', 'x', true, now() - interval '31 days') returning id`, true],
  ['a read note 29 days old', 'notifications', `insert into notifications (player_id, kind, message, read, created_at) values ('${P}', 'tst', 'x', true, now() - interval '29 days') returning id`, false],
  ['an unread note 89 days old', 'notifications', `insert into notifications (player_id, kind, message, read, created_at) values ('${P}', 'tst', 'x', false, now() - interval '89 days') returning id`, false],
  ['an unread note 91 days old', 'notifications', `insert into notifications (player_id, kind, message, read, created_at) values ('${P}', 'tst', 'x', false, now() - interval '91 days') returning id`, true],
  ['a hunt event posted 31 days ago', 'hunt_events', `insert into hunt_events (hunt_id, kind, created_at, posted_at) values (v_hunt, 'tst', now() - interval '32 days', now() - interval '31 days') returning id`, true],
  ['a hunt event posted 29 days ago', 'hunt_events', `insert into hunt_events (hunt_id, kind, created_at, posted_at) values (v_hunt, 'tst', now() - interval '29 days', now() - interval '29 days') returning id`, false],
  ['an UNPOSTED hunt event 60 days old', 'hunt_events', `insert into hunt_events (hunt_id, kind, created_at) values (v_hunt, 'tst', now() - interval '60 days') returning id`, false],
  ['a reverted Discord effect, 31 days', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at) values (v_play, '${P}', 'nickname', 'reverted', now() - interval '32 days', now() - interval '31 days') returning id`, true],
  ['a failed Discord effect, 31 days', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at) values (v_play, '${P}', 'nickname', 'failed', now() - interval '31 days', now() - interval '31 days') returning id`, true],
  ['a done Discord effect, 29 days', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at) values (v_play, '${P}', 'nickname', 'done', now() - interval '29 days', now() - interval '29 days') returning id`, false],
  ['a reverted Discord effect created 40 days ago, changed 2 days ago', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at) values (v_play, '${P}', 'nickname', 'reverted', now() - interval '40 days', now() - interval '2 days') returning id`, false],
  ['an ACTIVE Discord effect 60 days old', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at, revert_at) values (v_play, '${P}', 'nickname', 'active', now() - interval '60 days', now() - interval '60 days', now() - interval '59 days') returning id`, false],
  ['a PENDING Discord effect 60 days old', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at) values (v_play, '${P}', 'vc_mute', 'pending', now() - interval '60 days', now() - interval '60 days') returning id`, false],
  ['a cron run that ended 15 days ago', 'cron.job_run_details', `insert into cron.job_run_details (runid, jobid, status, start_time, end_time) values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details), v_job, 'succeeded', now() - interval '15 days', now() - interval '15 days') returning runid`, true],
  ['a cron run that ended 13 days ago', 'cron.job_run_details', `insert into cron.job_run_details (runid, jobid, status, start_time, end_time) values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details), v_job, 'succeeded', now() - interval '13 days', now() - interval '13 days') returning runid`, false],
  ['a fight log row 60 days old (hunt_combat_log is never pruned)', 'hunt_combat_log', `insert into hunt_combat_log (hunt_id, player_id, card_id, ts, cp, outcome, damage) values (v_hunt, '${P}', v_card, now() - interval '60 days', 1, 'hit', 1) returning id`, false],
];
const idCol = (tbl) => (tbl === 'cron.job_run_details' ? 'runid' : 'id');
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; v_hunt bigint; v_play bigint; v_job bigint; v_card bigint; ids bigint[] := '{}'; i bigint;
begin
  ${mig ? `execute $m$${mig}$m$;\n  execute $m$${mig}$m$; -- twice: the schedule must stay one job` : '-- the live function'}
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${P}', 'tst prune');
  select id into v_hunt from hunts order by id desc limit 1;
  select id into v_play from card_plays order by id limit 1;
  select jobid into v_job from cron.job order by jobid limit 1;
  select id into v_card from cards order by id limit 1;
${ROWS.map(([, , ins]) => `  ${ins} into i; ids := ids || i;`).join('\n')}
  r := prune_old_rows();
${ROWS.map(([label, tbl, , gone], k) => `  res := res || jsonb_build_object('case', ${`'${(gone ? 'deleted: ' : 'kept: ') + label.replace(/'/g, "''")}'`}, 'ok',
    ${gone ? 'not ' : ''}exists (select 1 from ${tbl} where ${idCol(tbl)} = ids[${k + 1}]));`).join('\n')}
  res := res || jsonb_build_object('case', 'the result counts each table (at least the test rows)', 'ok',
    (r->>'notifications')::int >= 2 and (r->>'hunt_events')::int >= 1 and (r->>'discord_effects')::int >= 2 and (r->>'cron_job_run_details')::int >= 1, 'r', r);
  res := res || jsonb_build_object('case', 'one daily pg_cron job prune-old-rows runs select prune_old_rows()', 'ok',
    (select count(*) from cron.job where jobname = 'prune-old-rows' and command ilike '%prune_old_rows()%') = 1);
  res := res || jsonb_build_object('case', 'the API roles cannot run it', 'ok',
    not has_function_privilege('anon', 'public.prune_old_rows()', 'execute') and not has_function_privilege('authenticated', 'public.prune_old_rows()', 'execute'));
  res := res || jsonb_build_object('case', 'security invoker with a fixed search_path', 'ok',
    (select not prosecdef and proconfig is not null from pg_proc where oid = 'public.prune_old_rows()'::regprocedure));
  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('FAIL NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const x of results) { if (!x.ok) fail++; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok || !x.r ? '' : ` ${JSON.stringify(x.r)}`}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
