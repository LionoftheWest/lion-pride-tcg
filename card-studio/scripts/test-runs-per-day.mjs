/**
 * Acceptance test for tcg-bot/supabase/runs_per_day.sql (F-1 PR 3), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-runs-per-day.mjs     must PASS (the file is applied twice: idempotent)
 *   MUTATE=<name> ...                                                                       must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                          runs every mutation and prints one line each
 * Invariants (docs/foundations.md F-1 item 6, acceptance test 4):
 *   1. No event (the flag-off state): game_var = balance = 1; the second Dungeon run of the day is refused (already), and the
 *      second Gauntlet run (already_gauntlet); the view shows the ended run, runs_left 0.
 *   2. A live event dungeon_runs_per_day = 2, gauntlet_runs_per_day = 2: a member starts 2 runs of each mode, the third is
 *      refused; a new run is refused while one is active; the runs are attempt 1 and 2. Between them the view has run null,
 *      runs_left 1 and last_run (the screen offers the start); during run 2 the view shows run 2.
 *   3. The Dungeon board lists a member with 2 runs once (the best run).
 *   4. The balance keys are whole numbers from 1 to 10; an event value above 10 is refused; the unique index is
 *      (player_id, day, mode, attempt) and the old one-a-day index is gone.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/runs_per_day.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const MUT = {
  nogamevar: ["v_runs >= game_var('dungeon_runs_per_day')", 'v_runs >= 1'],
  gnogamevar: ["v_runs >= game_var('gauntlet_runs_per_day')", 'v_runs >= 1'],
  noactive: ["if v_active > 0 or v_runs >= game_var('dungeon_runs_per_day')", "if v_runs >= game_var('dungeon_runs_per_day')"],
  noattempt: ["values (p_player, v_day, p_cards, st, v_last + 1)", 'values (p_player, v_day, p_cards, st, 1)'],
  board: ["select distinct on (x.player_id) x.* from dungeon_runs x", 'select x.* from dungeon_runs x'],
  viewnull: ["v_lastrun := jsonb_build_object('id', r.id, 'attempt', r.attempt, 'ended_by', r.ended_by, 'floor', r.floor, 'room', r.room, 'turns', r.turns);\n    r := null;",
    "v_lastrun := jsonb_build_object('id', r.id, 'attempt', r.attempt, 'ended_by', r.ended_by, 'floor', r.floor, 'room', r.room, 'turns', r.turns);"],
  viewlatest: ["mode = 'daily' order by attempt desc limit 1;", "mode = 'daily' order by attempt limit 1;"],
  balcheck: ['not between 1 and 10 or', 'not between 1 and 100 or'],
  oldindex: ['drop index if exists public.dungeon_runs_one_a_day_mode;', ''],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(11)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.split(m[0]).join(m[1]);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const P = 'tst_rpd_', A = 'tst_rpd_admin';
const body = String.raw`do $t$
declare bad text := ''; T timestamptz := date_trunc('second', now()); v_day date; r jsonb; v jsonb; ev bigint; sq bigint[]; r1 bigint; r2 bigint; n int;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', '${A}', true);
  -- the live state that the file changes: the one-a-day index (the rehearsal dropped it on the local copy)
  create unique index if not exists dungeon_runs_one_a_day_mode on dungeon_runs (player_id, day, mode);
  execute $m$${mig}$m$;
  execute $m$${mig}$m$; -- two times: idempotent
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  v_day := dungeon_day();
  perform dungeon_generate(v_day);
  update dungeon_days set rule = '{}'::jsonb where day = v_day;
  -- No other event may change the runs during the test.
  update events set status = 'cancelled', ended_at = T where status in ('scheduled', 'live') and (vars ? 'dungeon_runs_per_day' or vars ? 'gauntlet_runs_per_day');
  -- Two members who pass the Adventure gate, with 3 attackers and 2 supports (the setup of test-dungeon-auto-rounds.mjs).
  select array_agg(id order by o) into sq from (
    (select c.id, 1 o from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 3)
    union all
    (select min(c.id), 2 from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature')
      and s.ability->>'effect' in ('heal', 'smite') group by s.ability->>'effect')) z;
  create function pg_temp.member(p text) returns void language plpgsql as $f$
  begin
    insert into players (id, username) values (p, 'tst ' || p);
    insert into player_cards (player_id, card_id, quantity)
      select p, z, 1 from unnest((select array_agg(id order by id) from (select c.id from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 10) w)
        || array(select min(c.id) from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') group by s.ability->>'effect')) z
      on conflict do nothing;
  end $f$;
  perform pg_temp.member('${P}1'); perform pg_temp.member('${P}2');
  -- end the active run of a mode (dungeon_settle, as a fall or a retreat does)
  create function pg_temp.endrun(p text, m text) returns void language sql as $f$
    select dungeon_settle(id, 'retreat', false) from dungeon_runs where player_id = p and status = 'active' and mode = m $f$;

  -- 1. No event: one run of each mode a day.
  if game_var('dungeon_runs_per_day') <> 1 or game_var('gauntlet_runs_per_day') <> 1 or (balance_get('dungeon_runs_per_day') #>> '{}')::numeric <> 1 then bad := bad || '1: the base is not 1; '; end if;
  r := dungeon_start('${P}1', sq);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'RESULT:FAIL 1: the first run was refused: % (squad %)', r, sq; end if;
  r1 := (r->>'run')::bigint;
  if (dungeon_start('${P}1', sq)->>'error') is distinct from 'already' then bad := bad || '1: a run started while one is active; '; end if;
  perform pg_temp.endrun('${P}1', 'daily');
  if (select status from dungeon_runs where id = r1) <> 'over' then raise exception 'RESULT:FAIL 1: the run did not end'; end if;
  r := dungeon_start('${P}1', sq);
  if (r->>'error') is distinct from 'already' then bad := bad || '1: no event, but the second Dungeon run was not refused: ' || r::text || '; '; end if;
  v := dungeon_view('${P}1');
  if (v->'run'->>'id')::bigint is distinct from r1 or (v->>'runs_left')::int <> 0 then bad := bad || '1: the view: ' || jsonb_build_object('run', v->'run'->'id', 'left', v->'runs_left')::text || '; '; end if;
  r := gauntlet_start('${P}1');
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'RESULT:FAIL 1: the first Gauntlet run was refused: %', r; end if;
  perform pg_temp.endrun('${P}1', 'gauntlet');
  if (gauntlet_start('${P}1')->>'error') is distinct from 'already_gauntlet' then bad := bad || '1: no event, but the second Gauntlet run was not refused; '; end if;

  -- 2. A live event: 2 runs of each mode.
  r := admin_event_save(jsonb_build_object('key', 'tst_rpd_ev', 'kind', 'modifier', 'title', 'Double runs', 'starts_at', T - interval '1 minute', 'ends_at', T + interval '1 day',
         'vars', '{"dungeon_runs_per_day": 2, "gauntlet_runs_per_day": 2}'::jsonb), null, '${A}', null);
  ev := (r->'event'->>'id')::bigint;
  if ev is null then raise exception 'RESULT:FAIL 2: the event was refused: %', r; end if;
  perform admin_event_schedule(ev, (select updated_at from events where id = ev), '${A}', true);
  perform event_tick(T);
  if game_var('dungeon_runs_per_day') <> 2 or game_var('gauntlet_runs_per_day') <> 2 then bad := bad || '2: game_var is not 2 while the event is live; '; end if;
  r := dungeon_start('${P}2', sq); r1 := (r->>'run')::bigint;
  if r1 is null then raise exception 'RESULT:FAIL 2: run 1 was refused: %', r; end if;
  if (dungeon_start('${P}2', sq)->>'error') is distinct from 'already' then bad := bad || '2: a second run started while the first is active; '; end if;
  perform pg_temp.endrun('${P}2', 'daily');
  v := dungeon_view('${P}2');
  if v->'run' <> 'null'::jsonb or (v->>'runs_left')::int <> 1 or (v->'last_run'->>'id')::bigint is distinct from r1 or (v->'last_run'->>'attempt')::int <> 1 then
    bad := bad || '2: between the runs the view is ' || jsonb_build_object('run', v->'run'->'id', 'left', v->'runs_left', 'last', v->'last_run')::text || '; ';
  end if;
  r := dungeon_start('${P}2', sq); r2 := (r->>'run')::bigint;
  if r2 is null then bad := bad || '2: the second run was refused: ' || r::text || '; ';
  else
    if (select attempt from dungeon_runs where id = r2) <> 2 or (select attempt from dungeon_runs where id = r1) <> 1 then bad := bad || '2: the attempts are not 1 and 2; '; end if;
    v := dungeon_view('${P}2');
    if (v->'run'->>'id')::bigint is distinct from r2 or (v->'run'->>'status') <> 'active' then bad := bad || '2: during run 2 the view shows ' || coalesce(v->'run'->>'id', 'null') || '; '; end if;
    perform pg_temp.endrun('${P}2', 'daily');
    -- the board: the member is on it once
    select count(*) into n from jsonb_array_elements(dungeon_board(v_day, 1000)) e where e->>'player_id' = '${P}2';
    if n <> 1 then bad := bad || format('3: the board lists the member %s times; ', n); end if;
  end if;
  if (dungeon_start('${P}2', sq)->>'error') is distinct from 'already' then bad := bad || '2: the third run was not refused; '; end if;
  v := dungeon_view('${P}2');
  if (v->'run'->>'id')::bigint is distinct from r2 or (v->>'runs_left')::int <> 0 then bad := bad || '2: after the last run the view does not show it; '; end if;
  -- member 1 had one run before the event: one more now
  if not coalesce((dungeon_start('${P}1', sq)->>'ok')::boolean, false) then bad := bad || '2: member 1 did not get the second run of the event; '; end if;
  -- the Gauntlet
  if not coalesce((gauntlet_start('${P}2')->>'ok')::boolean, false) then bad := bad || '2: Gauntlet run 1 was refused; '; end if;
  if (gauntlet_start('${P}2')->>'error') is distinct from 'already_gauntlet' then bad := bad || '2: a Gauntlet run started while one is active; '; end if;
  perform pg_temp.endrun('${P}2', 'gauntlet');
  v := gauntlet_view('${P}2');
  if v->'run' <> 'null'::jsonb or (v->>'runs_left')::int <> 1 then bad := bad || '2: the Gauntlet view between the runs; '; end if;
  if not coalesce((gauntlet_start('${P}2')->>'ok')::boolean, false) then bad := bad || '2: Gauntlet run 2 was refused; '; end if;
  perform pg_temp.endrun('${P}2', 'gauntlet');
  if (gauntlet_start('${P}2')->>'error') is distinct from 'already_gauntlet' then bad := bad || '2: the third Gauntlet run was not refused; '; end if;
  if (select jsonb_agg(attempt order by attempt) from dungeon_runs where player_id = '${P}2' and mode = 'gauntlet' and day = v_day) <> '[1, 2]' then bad := bad || '2: the Gauntlet attempts; '; end if;

  -- 4. Limits and the index.
  begin update balance set value = '11' where key = 'dungeon_runs_per_day'; bad := bad || '4: balance 11 accepted; '; exception when raise_exception then null; end;
  begin update balance set value = '1.5' where key = 'gauntlet_runs_per_day'; bad := bad || '4: balance 1.5 accepted; '; exception when raise_exception then null; end;
  r := admin_event_save(jsonb_build_object('key', 'tst_rpd_bad', 'kind', 'modifier', 'title', 'Bad', 'starts_at', T, 'ends_at', T + interval '1 day', 'vars', '{"dungeon_runs_per_day": 11}'::jsonb), null, '${A}', null);
  if coalesce((r->>'ok')::boolean, true) then bad := bad || '4: an event value of 11 was accepted; '; end if;
  if to_regclass('public.dungeon_runs_one_a_day_mode') is not null then bad := bad || '4: the one-a-day index is still there; '; end if;
  if not exists (select 1 from pg_indexes where indexname = 'dungeon_runs_attempt' and indexdef like '%UNIQUE%(player_id, day, mode, attempt)%') then bad := bad || '4: the attempt index; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
