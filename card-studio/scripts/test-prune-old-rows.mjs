/**
 * prune_old_rows (prune_old_rows.sql) deletes ONLY the old rows that no reader uses, and the daily
 * pg_cron job exists once. Old and new rows of each table go in; the test checks which are left.
 * Rolled back:  node scripts/test-prune-old-rows.mjs [path/to/dbmem_cron_history_7d.sql] [--mutate]   (the newest file with prune_old_rows)
 * --mutate: after the baseline (printed in the same run), each mutation of the file must turn a case red.
 * Without an argument it tests the LIVE function (the baseline: it fails while the function is missing).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const MIG = file ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n?/g, '') : '';
const P = 'tst_prune_p';
// Each test row: [label, table, the insert (it returns the id), should it be deleted?]
const ROWS = [
  // logs_sql.sql (2026-10-07, Nathan: "as much data as possible"): notes, posted hunt_events and ended discord_effects
  // stay 365 days (was 30 / 90), cron run details 90 days (was 14).
  ['a read note 31 days old (was deleted before 2026-10-07)', 'notifications', `insert into notifications (player_id, kind, message, read, created_at) values ('${P}', 'tst', 'x', true, now() - interval '31 days') returning id`, false],
  ['an unread note 91 days old (was deleted before 2026-10-07)', 'notifications', `insert into notifications (player_id, kind, message, read, created_at) values ('${P}', 'tst', 'x', false, now() - interval '91 days') returning id`, false],
  ['a read note 364 days old', 'notifications', `insert into notifications (player_id, kind, message, read, created_at) values ('${P}', 'tst', 'x', true, now() - interval '364 days') returning id`, false],
  ['a read note 366 days old', 'notifications', `insert into notifications (player_id, kind, message, read, created_at) values ('${P}', 'tst', 'x', true, now() - interval '366 days') returning id`, true],
  ['an unread note 366 days old', 'notifications', `insert into notifications (player_id, kind, message, read, created_at) values ('${P}', 'tst', 'x', false, now() - interval '366 days') returning id`, true],
  ['a hunt event posted 31 days ago', 'hunt_events', `insert into hunt_events (hunt_id, kind, created_at, posted_at) values (v_hunt, 'nudge', now() - interval '32 days', now() - interval '31 days') returning id`, false],
  ['a hunt event posted 366 days ago', 'hunt_events', `insert into hunt_events (hunt_id, kind, created_at, posted_at) values (v_hunt, 'nudge', now() - interval '367 days', now() - interval '366 days') returning id`, true],
  ['an UNPOSTED hunt event 400 days old', 'hunt_events', `insert into hunt_events (hunt_id, kind, created_at) values (v_hunt, 'nudge', now() - interval '400 days') returning id`, false],
  ['a reverted Discord effect, 31 days', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at) values (v_play, '${P}', 'nickname', 'reverted', now() - interval '32 days', now() - interval '31 days') returning id`, false],
  ['a reverted Discord effect, 366 days', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at) values (v_play, '${P}', 'nickname', 'reverted', now() - interval '367 days', now() - interval '366 days') returning id`, true],
  ['a failed Discord effect, 366 days', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at) values (v_play, '${P}', 'nickname', 'failed', now() - interval '366 days', now() - interval '366 days') returning id`, true],
  ['a reverted Discord effect created 400 days ago, changed 2 days ago', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at) values (v_play, '${P}', 'nickname', 'reverted', now() - interval '400 days', now() - interval '2 days') returning id`, false],
  ['an ACTIVE Discord effect 400 days old', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at, revert_at) values (v_play, '${P}', 'nickname', 'active', now() - interval '400 days', now() - interval '400 days', now() - interval '399 days') returning id`, false],
  ['a PENDING Discord effect 400 days old', 'discord_effects', `insert into discord_effects (play_id, target_id, primitive, status, created_at, updated_at) values (v_play, '${P}', 'vc_mute', 'pending', now() - interval '400 days', now() - interval '400 days') returning id`, false],
  // dbmem_cron_history_7d.sql (DB-MEM A7, 2026-11-06): cron run details 7 days (was 90).
  ['a cron run that ended 91 days ago', 'cron.job_run_details', `insert into cron.job_run_details (runid, jobid, status, start_time, end_time) values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details), v_job, 'succeeded', now() - interval '91 days', now() - interval '91 days') returning runid`, true],
  ['a cron run that ended 8 days ago (kept 90 days before 2026-11-06)', 'cron.job_run_details', `insert into cron.job_run_details (runid, jobid, status, start_time, end_time) values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details), v_job, 'succeeded', now() - interval '8 days', now() - interval '8 days') returning runid`, true],
  ['a FAILED cron run that ended 8 days ago', 'cron.job_run_details', `insert into cron.job_run_details (runid, jobid, status, start_time, end_time) values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details), v_job, 'failed', now() - interval '8 days', now() - interval '8 days') returning runid`, true],
  ['a cron run that ended 6 days ago', 'cron.job_run_details', `insert into cron.job_run_details (runid, jobid, status, start_time, end_time) values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details), v_job, 'succeeded', now() - interval '6 days', now() - interval '6 days') returning runid`, false],
  ['a FAILED cron run that ended 6 days ago (the data health reads 7 days of failures)', 'cron.job_run_details', `insert into cron.job_run_details (runid, jobid, status, start_time, end_time) values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details), v_job, 'failed', now() - interval '6 days', now() - interval '6 days') returning runid`, false],
  ['a RUNNING cron run that started 30 days ago', 'cron.job_run_details', `insert into cron.job_run_details (runid, jobid, status, start_time) values ((select coalesce(max(runid), 0) + 1 from cron.job_run_details), v_job, 'running', now() - interval '30 days') returning runid`, false],
  ['a fight log row 400 days old (hunt_combat_log is never pruned)', 'hunt_combat_log', `insert into hunt_combat_log (hunt_id, player_id, card_id, ts, cp, outcome, damage) values (v_hunt, '${P}', v_card, now() - interval '400 days', 1, 'hit', 1) returning id`, false],
];
const idCol = (tbl) => (tbl === 'cron.job_run_details' ? 'runid' : 'id');
const body = (mig) => String.raw`do $t$
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
const run = async (mig) => {
  const out = JSON.stringify(await q(body(mig)));
  const m = out.match(/RESULTS (\[.*\])/);
  if (!m) return { error: out.slice(0, 1500) };
  return { results: JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, '')) };
};
const base = await run(MIG);
if (base.error) { console.log('FAIL NO RESULTS:', base.error); process.exit(1); }
let fail = 0;
for (const x of base.results) { if (!x.ok) fail++; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok || !x.r ? '' : ` ${JSON.stringify(x.r)}`}`); }
console.log(fail ? `${fail} of ${base.results.length} FAILED` : `PASS all ${base.results.length}`);

// Mutations of the migration file (DB-MEM A7): each one must turn at least one case red. Valid only on a green baseline.
if (args.includes('--mutate') && MIG) {
  if (fail) { console.log('FAIL mutations not run: the baseline is red'); process.exit(1); }
  const CRON_DEL = "  delete from cron.job_run_details\n   where status <> 'running' and coalesce(end_time, start_time) < now() - interval '7 days';\n";
  const MUT = [
    ['cron kept 90 days again', "< now() - interval '7 days'", "< now() - interval '90 days'"],
    ['cron kept 5 days (deletes failures that the data health reads)', "< now() - interval '7 days'", "< now() - interval '5 days'"],
    ['a running row is deleted too', "where status <> 'running' and ", 'where '],
    ['only succeeded rows are deleted', "where status <> 'running' and ", "where status = 'succeeded' and "],
    ['no cron delete', CRON_DEL, ''],
    ['notes 7 days too', "where created_at < now() - interval '365 days'", "where created_at < now() - interval '7 days'"],
    ['security definer', ' security invoker', ' security definer'],
    ['API roles keep execute', 'revoke execute on function public.prune_old_rows() from public, anon, authenticated;', 'grant execute on function public.prune_old_rows() to anon, authenticated;'],
  ];
  let caught = 0;
  for (const [name, from, to] of MUT) {
    if (!MIG.includes(from)) { console.log(`FAIL mutation text not found: ${name}`); fail++; continue; }
    const r = await run(MIG.split(from).join(to));
    const red = Boolean(r.error) || r.results.some((x) => !x.ok);
    if (red) caught++; else fail++;
    console.log(`${red ? 'PASS' : 'FAIL'} mutation caught: ${name}${r.error ? ' (error)' : red ? ` (${r.results.filter((x) => !x.ok).map((x) => x.case).join('; ')})` : ''}`);
  }
  console.log(`mutations caught ${caught}/${MUT.length}`);
}
process.exitCode = fail ? 1 : 0;
