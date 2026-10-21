/**
 * Acceptance test for tcg-bot/supabase/season_best_day_tie.sql, NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-season-best-day-tie.mjs   must PASS
 *   MUTATE=<name> ...                                                                             must FAIL, for every name in MUT below
 *   MUTATE=all ...      runs the baseline (must PASS) and then every mutation (each must FAIL), one line each
 * Invariant: the season best of dungeon_view_core (lite and full) is the member's best daily run by floor desc, room desc, fewer
 * turns, and for a tie of these three the EARLIEST day. So two calls always show the same day, under every plan.
 * The data (only daily runs, all over, on days before today):
 *   - members 01-30: the same floor, room and turns on 5 days. The runs are inserted latest day first (heap order), and the
 *     earliest day has the HIGHEST run id (so neither the heap order nor the run id alone gives the earliest day). The earliest
 *     day also has a second run with the same values (a full tie on one day; the output has no run id, so only the day is checked).
 *   - members 31-35: a higher floor on a later day (the floor comes before the day).
 *   - members 36-40: the same floor and room, fewer turns on a later day (the turns come before the day).
 * Each check runs under 8 planner settings.
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/season_best_day_tie.sql', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const KEY = 'order by floor desc, room desc, turns, day, id limit 1';
const MUT = {
  no_day: [KEY, 'order by floor desc, room desc, turns, id limit 1'],              // the planted fault: the day removed
  no_day_id: [KEY, 'order by floor desc, room desc, turns limit 1'],               // the old live text
  id_first: [KEY, 'order by floor desc, room desc, turns, id, day limit 1'],
  latest_day: [KEY, 'order by floor desc, room desc, turns, day desc, id limit 1'],
  day_first: [KEY, 'order by day, floor desc, room desc, turns, id limit 1'],
  no_turns: [KEY, 'order by floor desc, room desc, day, id limit 1'],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  const run = (env) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, ...env, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const last = (r) => (r.stdout || '').trim().split(/\r?\n/).pop() || '';
  const b = run({ MUTATE: '' });
  if (b.status !== 0) ok = false;
  console.log(`baseline              ${b.status === 0 ? 'PASS' : 'NOT GREEN'}  ${last(b).slice(0, 150)}`);
  for (const name of Object.keys(MUT)) {
    const r = run({ MUTATE: name });
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(last(r));
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(12)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${last(r).slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: baseline green, all caught' : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (!mig.includes(KEY)) throw new Error('the season_best order of the migration was not found');
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  mig = mig.replace(m[0], m[1]);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const body = String.raw`do $t$
declare bad text := ''; d date := dungeon_day(); cfgs text[] := array['', 'enable_hashjoin', 'enable_mergejoin', 'enable_nestloop',
  'enable_seqscan', 'enable_indexscan,enable_bitmapscan', 'enable_sort', 'enable_seqscan,enable_sort'];
  cfg text; s text; pid text; v jsonb; base bigint; j int; k int; exp date; n int := 0; lite boolean;
begin
  execute $m$${mig}$m$;
  update settings set value = value || '{"enabled": true}' where key = 'dungeon';
  perform dungeon_generate(d);
  insert into players (id, username) select 'tst_sb_' || lpad(i::text, 2, '0'), 'sb ' || i from generate_series(40, 1, -1) i on conflict (id) do nothing;
  delete from dungeon_runs where player_id like 'tst_sb_%';
  base := (select coalesce(max(id), 0) from dungeon_runs) + 1000;
  -- members 01-30: days d-1 .. d-5 tied (floor 9, room 5, turns 4), the latest day inserted first; the run id falls with the day.
  for k in 1..5 loop
    insert into dungeon_runs (id, player_id, day, squad, state, mode, status, floor, room, turns, ended_at, attempt) overriding system value
      select base + k * 100 + i, 'tst_sb_' || lpad(i::text, 2, '0'), d - k, '{1,2,3,4,5}', '{}', 'daily', 'over', 9, 5, 4,
             timestamptz '2026-01-01 12:00+00', 1
      from generate_series(1, 30) i;
  end loop;
  -- a full tie on the earliest day (attempt 2, the highest id of all), and a weaker run on d-6
  insert into dungeon_runs (id, player_id, day, squad, state, mode, status, floor, room, turns, ended_at, attempt) overriding system value
    select base + 600 + i, 'tst_sb_' || lpad(i::text, 2, '0'), d - 5, '{2,2,2,2,2}', '{}', 'daily', 'over', 9, 5, 4, timestamptz '2026-01-01 12:00+00', 2
    from generate_series(1, 30) i;
  insert into dungeon_runs (id, player_id, day, squad, state, mode, status, floor, room, turns, ended_at, attempt) overriding system value
    select base + 900 + i, 'tst_sb_' || lpad(i::text, 2, '0'), d - 6, '{1,2,3,4,5}', '{}', 'daily', 'over', 3, 1, 1, timestamptz '2026-01-01 12:00+00', 1
    from generate_series(1, 30) i;
  -- members 31-35: floor 9 on d-1, floor 8 on d-5 (expected d-1). members 36-40: turns 3 on d-1, turns 4 on d-5 (expected d-1).
  insert into dungeon_runs (id, player_id, day, squad, state, mode, status, floor, room, turns, ended_at, attempt) overriding system value
    select base + 1000 + i, 'tst_sb_' || i, d - 1, '{1,2,3,4,5}', '{}', 'daily', 'over', 9, 5, case when i <= 35 then 4 else 3 end, timestamptz '2026-01-01 12:00+00', 1
    from generate_series(31, 40) i;
  insert into dungeon_runs (id, player_id, day, squad, state, mode, status, floor, room, turns, ended_at, attempt) overriding system value
    select base + 1100 + i, 'tst_sb_' || i, d - 5, '{1,2,3,4,5}', '{}', 'daily', 'over', case when i <= 35 then 8 else 9 end, 5, 4, timestamptz '2026-01-01 12:00+00', 1
    from generate_series(31, 40) i;
  analyze dungeon_runs;

  foreach cfg in array cfgs loop
    foreach s in array string_to_array(cfg, ',') loop perform set_config(s, 'off', true); end loop;
    for j in 1..40 loop
      pid := 'tst_sb_' || lpad(j::text, 2, '0');
      exp := case when j <= 30 then d - 5 else d - 1 end;
      foreach lite in array array[false, true] loop
        v := dungeon_view_core(pid, not lite) -> 'season_best'; n := n + 1;
        if (v->>'day')::date is distinct from exp or (v->>'floor')::int <> 9 or (v->>'room')::int <> 5 then
          bad := bad || format('[%s] dungeon_view_core(%s, %s) season_best %s, expected day %s floor 9 room 5; ', cfg, pid, not lite, v, exp); end if;
      end loop;
    end loop;
    foreach s in array string_to_array(cfg, ',') loop perform set_config(s, 'on', true); end loop;
  end loop;

  raise exception 'RESULT:%', case when bad = '' then 'PASS (' || cardinality(cfgs) || ' planner settings, ' || n || ' view calls; 30 members with 5 tied days)' else 'FAIL ' || left(bad, 1500) end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS[^\n]*|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1].startsWith('PASS') ? 0 : 1);
