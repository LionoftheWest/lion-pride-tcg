/**
 * Acceptance test for tcg-bot/supabase/perf_prepare_day.sql, NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-prepare-day.mjs        must PASS
 *   MUTATE=<name> ...                                                                         must FAIL, for every name:
 *     noflag    dungeon_prepare_day makes the day while the Dungeon is closed   gflag    ... makes the week while the Gauntlet is closed
 *     noisolate a failing Gauntlet stops the Dungeon of the day                 cron     the job runs at the wrong hours
 *   node scripts/test-prepare-day.mjs --live   the same cases on the CURRENT function and job (test-all-local.mjs: the file is applied)
 * Invariants:
 *   1. With the Dungeon open and no row for today, dungeon_prepare_day() makes today's dungeon_days row, and it is the row that the lazy
 *      call (dungeon_generate) makes: the same name, rule and floors. A second call changes nothing (idempotent).
 *   2. With the Gauntlet open it makes the week's gauntlet_weeks row too. A closed mode makes nothing.
 *   3. A Gauntlet that cannot be made (no squad fits) does not stop the Dungeon of the day; the answer names the error.
 *   4. The job 'dungeon-prepare-day' exists (06:02 and 07:02 UTC = 00:02 Denver in summer and winter time) and calls the function.
 *   5. anon and authenticated cannot run the function; service_role can.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

const live = process.argv.includes('--live');
let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/perf_prepare_day.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const MUT = {
  noflag: ["if coalesce((dungeon_cfg()->>'enabled')::boolean, false) then", 'if true then'],
  gflag: ["if coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then", 'if true then'],
  noisolate: ['exception when others then', 'exception when no_data_found then'],
  cron: ["'2 6,7 * * *'", "'2 8 * * *'"],
};
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.replace(m[0], m[1]);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const body = String.raw`do $t$
declare bad text := ''; d date := dungeon_day(); w date := gauntlet_week(dungeon_day()); r jsonb; before jsonb; after jsonb; lazy jsonb; j record;
begin
  ${live ? '-- the current function and job' : 'execute $m$' + mig + '$m$;'}
  delete from dungeon_days where day = d; delete from gauntlet_weeks where week = w;

  -- 2. Both modes closed: nothing is made.
  update settings set value = value || '{"enabled": false}' where key in ('dungeon', 'gauntlet');
  r := dungeon_prepare_day();
  if exists (select 1 from dungeon_days where day = d) or exists (select 1 from gauntlet_weeks where week = w) or (r->>'dungeon')::boolean or (r->>'gauntlet')::boolean then bad := bad || 'closed: made something ' || r::text || '; '; end if;
  -- the Dungeon open, the Gauntlet closed: only the day.
  update settings set value = value || '{"enabled": true}' where key = 'dungeon';
  r := dungeon_prepare_day();
  if not exists (select 1 from dungeon_days where day = d) or exists (select 1 from gauntlet_weeks where week = w) or not (r->>'dungeon')::boolean or (r->>'gauntlet')::boolean then bad := bad || 'dungeon only: ' || r::text || '; '; end if;

  -- 1. The row is the lazy row; a second call changes nothing.
  select to_jsonb(x) into before from dungeon_days x where day = d;
  r := dungeon_prepare_day();
  select to_jsonb(x) into after from dungeon_days x where day = d;
  if before is distinct from after then bad := bad || 'second call changed the day; '; end if;
  delete from dungeon_days where day = d;
  lazy := dungeon_generate(d);
  if lazy is distinct from before then bad := bad || 'the prepared row is not the lazy row; '; end if;
  delete from dungeon_days where day = d;

  -- 2. Both open: the day and the week.
  update settings set value = value || '{"enabled": true}' where key = 'gauntlet';
  r := dungeon_prepare_day();
  if not exists (select 1 from dungeon_days where day = d) or not exists (select 1 from gauntlet_weeks where week = w) or not (r->>'gauntlet')::boolean then bad := bad || 'both open: ' || r::text || '; '; end if;
  select to_jsonb(x) into before from gauntlet_weeks x where week = w;
  perform dungeon_prepare_day();
  select to_jsonb(x) into after from gauntlet_weeks x where week = w;
  if before is distinct from after then bad := bad || 'second call changed the week; '; end if;

  -- 3. A Gauntlet that cannot be made does not stop the Dungeon.
  delete from dungeon_days where day = d; delete from gauntlet_weeks where week = w;
  create or replace function gauntlet_generate(p_week date) returns gauntlet_weeks language plpgsql as $f$ begin raise exception 'gauntlet_generate: no squad fits the budget'; end $f$;
  begin
    r := dungeon_prepare_day();
    if not exists (select 1 from dungeon_days where day = d) or not (r->>'dungeon')::boolean or (r->>'gauntlet')::boolean or r->>'gauntlet_error' is null then bad := bad || 'gauntlet failure: ' || r::text || '; '; end if;
  exception when others then bad := bad || 'a failing Gauntlet raised: ' || sqlerrm || '; '; end;

  -- 4. The job.
  select * into j from cron.job where jobname = 'dungeon-prepare-day';
  if j.jobid is null then bad := bad || 'no cron job; ';
  elsif j.schedule <> '2 6,7 * * *' or j.command not like '%dungeon_prepare_day()%' or not j.active then bad := bad || 'cron job wrong: ' || j.schedule || ' ' || j.command || '; '; end if;

  -- 5. The grants.
  if has_function_privilege('anon', 'public.dungeon_prepare_day()', 'execute') or has_function_privilege('authenticated', 'public.dungeon_prepare_day()', 'execute')
     or not has_function_privilege('service_role', 'public.dungeon_prepare_day()', 'execute') then bad := bad || 'grants; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
