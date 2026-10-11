/**
 * Acceptance test for tcg-bot/supabase/perf_boards_once.sql, NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-boards-once.mjs        must PASS
 *   MUTATE=<name> ...                                                                         must FAIL, for every name:
 *     top3     the top 3 list holds 4 rows                 twice    the top 3 reads the board again (two board reads)
 *     rank     the member rank comes from the top 3 only   guard    the live-version guard accepts any version
 *   node scripts/test-boards-once.mjs --live   the same cases on the CURRENT functions (test-all-local.mjs: the file is applied already)
 * Invariants:
 *   1. dungeon_view_core(player, true|false) and gauntlet_view(player) answer EXACTLY as the live text of 2026-10-11 did (reference
 *      copies ref_dungeon_view_core and ref_gauntlet_view, made in the test), for members with a rank, members with no run, an unknown
 *      member and the real members of the database, on a board of 600 members (distinct results, so no ties).
 *   2. Each view call reads the board ONCE (a counting wrapper of dungeon_board / gauntlet_board); the reference text reads it twice.
 *   3. A closed mode answers {ok:false, error:disabled}; the file runs again on its own result; a changed live function stops it.
 * The timing (old text and new text over 30 calls on the 600-member board) is printed, not asserted.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

const live = process.argv.includes('--live');
let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/perf_boards_once.sql', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const MUT = {
  top3: ["where o <= 3),\n    'season_best'", "where o <= 4),\n    'season_best'"],
  twice: ["'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),\n    'prizes'", "'top', gauntlet_board(v_week, 3),\n    'prizes'"],
  rank: ["select (e->>'rank')::int into v_rank from jsonb_array_elements(v_board) e where", "select (e->>'rank')::int into v_rank from jsonb_array_elements(dungeon_board(v_day, 3)) e where"],
  guard: ["if m2 not in ('0b729835b6ce3b124f0c947b1098a8de',", "if m2 is null and 'x' not in ("],
};
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.replace(m[0], m[1]);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const body = String.raw`do $t$
declare bad text := ''; pid text; x jsonb; y jsonb; n int := 0; c int; t0 timestamptz; told numeric; tnew numeric; ids text[]; d date := dungeon_day(); info text;
begin
  create or replace function public.ref_dungeon_view_core(p_player text, p_mine boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $rf$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int; v_mine jsonb := '{}'::jsonb;
  v_b jsonb; v_cost jsonb; v_h0 int;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  d := dungeon_generate(v_day);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
  select (e->>'rank')::int into v_rank from jsonb_array_elements(dungeon_board(v_day, 1000)) e where e->>'player_id' = p_player;
  if p_mine then
    v_b := card_balance(); v_cost := balance_get('dungeon')->'cost'; v_h0 := card_max_hp(0);
    v_mine := jsonb_build_object('mine', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', s.type, 'rarity', c.rarity::text,
               'cost', coalesce((v_cost->>c.rarity::text)::numeric, balance_num('dungeon', 'cost', c.rarity::text))::int, 'cp', (x.cmb->>'cp')::int,
               'hp', case when s.type in ('Character', 'Creature') then (x.cmb->>'hp')::int else v_h0 end,
               'slugs', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)) order by (x.cmb->>'cp')::int desc), '[]'::jsonb)
             from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
             cross join lateral (select card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points, v_b) cmb) x
             where pc.player_id = p_player and pc.quantity > 0));
  end if;
  return jsonb_build_object('ok', true, 'day', v_day, 'next_at', (v_day + 1)::timestamp at time zone 'America/Denver',
    'name', d->>'name', 'rule', d->'rule', 'budget', coalesce((d->'rule'->>'budget')::int, balance_num('dungeon', 'budget')::int),
    'squad', balance_num('dungeon', 'squad')::int, 'cost', cfg->'cost', 'gate', adventure_gate(p_player), 'cap', balance_num('dungeon_rewards', 'run_shards_cap')::int,
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', v_rank) end,
    -- The rooms of the member's floor: a room ahead is "?" (only the guardian shows).
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(d->'floors'->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(d->'floors'),
    'runs_today', (select count(*) from dungeon_runs where day = v_day and mode = 'daily'),
    'top', dungeon_board(v_day, 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player and mode = 'daily'
                    order by floor desc, room desc, turns limit 1)) || v_mine;
end $rf$;
  create or replace function public.ref_gauntlet_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $rf$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); v_week date := gauntlet_week(dungeon_day()); w gauntlet_weeks; r dungeon_runs; b jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  w := gauntlet_generate(v_week);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet';
  select e into b from jsonb_array_elements(gauntlet_board(v_week, 100000)) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'mode', 'gauntlet', 'day', v_day, 'week', v_week,
    'next_at', (v_day + 1)::timestamp at time zone 'America/Denver', 'ends_at', (v_week + 7)::timestamp at time zone 'America/Denver',
    'name', w.name, 'theme', w.theme, 'gate', adventure_gate(p_player), 'cost', cfg->'cost',
    'budget', balance_num('gauntlet', 'budget')::int,
    'squad', (select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.c->>'type', 'rarity', x.c->>'rarity',
               'cost', balance_num('dungeon', 'cost', x.c->>'rarity')::int, 'cp', (x.c->'cmb'->>'cp')::int,
               'hp', case when x.c->>'type' in ('Character', 'Creature') then (x.c->'cmb'->>'hp')::int else card_max_hp(0) end,
               'slugs', x.c->'tags') order by x.o)
             from unnest(w.squad) with ordinality x0(id, o) cross join lateral (select x0.id, x0.o, dungeon_card_base(x0.id) c) x),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', 0, 'cards', '[]'::jsonb, 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', (b->>'rank')::int) end,
    'best', b,
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(w.floors->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(w.floors),
    'players_week', (select count(distinct player_id) from dungeon_runs where mode = 'gauntlet' and day between v_week and v_week + 6),
    'top', gauntlet_board(v_week, 3),
    'prizes', coalesce(dungeon_prizes_cfg()->'weekly', '[]'::jsonb));
end $rf$;
  ${live ? '-- the current functions' : 'execute $m$' + mig + '$m$;'}
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  perform dungeon_generate(d); perform gauntlet_generate(gauntlet_week(d));
  -- a board of 600 members: distinct floor / room / turns, so the order has no ties
  insert into players (id, username) select 'tst_bo_' || i, 'bo ' || i from generate_series(1, 600) i;
  insert into dungeon_runs (player_id, day, squad, state, mode, status, floor, room, turns)
    select 'tst_bo_' || i, d, '{1,2,3,4,5}', '{}', 'daily', 'over', 1 + (i % 9), 1 + (i % 5), i from generate_series(1, 600) i;
  insert into dungeon_runs (player_id, day, squad, state, mode, status, floor, room, turns)
    select 'tst_bo_' || i, d, '{1,2,3,4,5}', '{}', 'gauntlet', 'over', 1 + (i % 7), 1 + (i % 4), i from generate_series(1, 600) i;
  ids := array['tst_bo_1', 'tst_bo_7', 'tst_bo_300', 'tst_bo_599', 'tst_bo_600', 'tst_bo_nobody'] || array(select id from players where id not like 'tst_bo_%' order by id limit 10);

  -- 1. The same answer, key by key.
  foreach pid in array ids loop
    n := n + 1;
    if dungeon_view_core(pid, true) is distinct from ref_dungeon_view_core(pid, true) then bad := bad || 'dungeon_view_core(' || pid || ', true) differs: ' || left((dungeon_view_core(pid, true) - 'mine')::text, 300) || ' vs ' || left((ref_dungeon_view_core(pid, true) - 'mine')::text, 300) || '; '; end if;
    if dungeon_view_core(pid, false) is distinct from ref_dungeon_view_core(pid, false) then bad := bad || 'dungeon_view_core(' || pid || ', false) differs; '; end if;
    if gauntlet_view(pid) is distinct from ref_gauntlet_view(pid) then bad := bad || 'gauntlet_view(' || pid || ') differs: ' || left(gauntlet_view(pid)::text, 300) || ' vs ' || left(ref_gauntlet_view(pid)::text, 300) || '; '; end if;
  end loop;
  -- the ranks of the test members are what the board says
  if (dungeon_view_core('tst_bo_300', false)->'run'->>'rank')::int is distinct from (select (e->>'rank')::int from jsonb_array_elements(dungeon_board(d, 1000)) e where e->>'player_id' = 'tst_bo_300') then bad := bad || 'rank of tst_bo_300; '; end if;
  if jsonb_array_length(dungeon_view_core('tst_bo_1', false)->'top') <> 3 or jsonb_array_length(gauntlet_view('tst_bo_1')->'top') <> 3 then bad := bad || 'top is not 3 rows; '; end if;
  if dungeon_view_core('tst_bo_1', false)->'top' is distinct from dungeon_board(d, 3) or gauntlet_view('tst_bo_1')->'top' is distinct from gauntlet_board(gauntlet_week(d), 3) then bad := bad || 'top is not the board top 3; '; end if;
  if gauntlet_view('tst_bo_1')->'best' is null or (gauntlet_view('tst_bo_nobody')->'best') is not null and gauntlet_view('tst_bo_nobody')->'best' <> 'null'::jsonb then bad := bad || 'best; '; end if;

  -- timing (printed): 30 members, the old text and the new text
  t0 := clock_timestamp(); for i in 1..30 loop x := ref_dungeon_view_core('tst_bo_' || i, false); y := ref_gauntlet_view('tst_bo_' || i); end loop; told := extract(epoch from clock_timestamp() - t0) * 1000;
  t0 := clock_timestamp(); for i in 1..30 loop x := dungeon_view_core('tst_bo_' || i, false); y := gauntlet_view('tst_bo_' || i); end loop; tnew := extract(epoch from clock_timestamp() - t0) * 1000;
  info := format('30 x (dungeon_view_core lite + gauntlet_view) on 600 members: old %s ms, new %s ms', round(told), round(tnew));

  -- 2. One board read per call (counting wrappers of the two boards).
  alter function dungeon_board(date, integer) rename to dungeon_board_real;
  alter function gauntlet_board(date, integer) rename to gauntlet_board_real;
  create function dungeon_board(p_day date default null, p_limit integer default 20) returns jsonb language plpgsql as $f$
  begin perform set_config('tst.bn', (coalesce(nullif(current_setting('tst.bn', true), ''), '0')::int + 1)::text, true); return dungeon_board_real(p_day, p_limit); end $f$;
  create function gauntlet_board(p_week date default null, p_limit integer default 20) returns jsonb language plpgsql as $f$
  begin perform set_config('tst.gn', (coalesce(nullif(current_setting('tst.gn', true), ''), '0')::int + 1)::text, true); return gauntlet_board_real(p_week, p_limit); end $f$;
  perform set_config('tst.bn', '0', true); x := dungeon_view_core('tst_bo_5', false); c := current_setting('tst.bn')::int;
  if c <> 1 then bad := bad || 'dungeon_view_core(lite) read the board ' || c || ' times; '; end if;
  perform set_config('tst.bn', '0', true); x := dungeon_view_core('tst_bo_5', true); c := current_setting('tst.bn')::int;
  if c <> 1 then bad := bad || 'dungeon_view_core(full) read the board ' || c || ' times; '; end if;
  perform set_config('tst.gn', '0', true); y := gauntlet_view('tst_bo_5'); c := current_setting('tst.gn')::int;
  if c <> 1 then bad := bad || 'gauntlet_view read the board ' || c || ' times; '; end if;
  perform set_config('tst.bn', '0', true); x := ref_dungeon_view_core('tst_bo_5', false);
  if current_setting('tst.bn')::int <> 2 then bad := bad || 'the counting wrapper does not see the reference reads (' || current_setting('tst.bn') || '); '; end if;
  drop function dungeon_board(date, integer); drop function gauntlet_board(date, integer);
  alter function dungeon_board_real(date, integer) rename to dungeon_board;
  alter function gauntlet_board_real(date, integer) rename to gauntlet_board;

  -- 3. A closed mode.
  update settings set value = value || '{"enabled": false}' where key = 'gauntlet';
  if gauntlet_view('tst_bo_1') is distinct from '{"ok": false, "error": "disabled"}'::jsonb then bad := bad || 'closed gauntlet: ' || gauntlet_view('tst_bo_1')::text || '; '; end if;
  update settings set value = value || '{"enabled": false}' where key = 'dungeon';
  if dungeon_view_core('tst_bo_1', true) is distinct from '{"ok": false, "error": "disabled"}'::jsonb then bad := bad || 'closed dungeon; '; end if;

${!live && (!process.env.MUTATE || process.env.MUTATE === 'guard') ? `
  -- 4. The guard: the file runs again on its own result; a changed live function stops it.
  begin execute $m$${mig}$m$; exception when others then bad := bad || 'second run: ' || sqlerrm || '; '; end;
  execute replace(pg_get_functiondef('public.gauntlet_view(text)'::regprocedure), chr(10) || 'begin' || chr(10), chr(10) || 'begin -- changed by someone else' || chr(10));
  begin execute $m$${mig}$m$; bad := bad || 'the guard let a changed gauntlet_view through; ';
  exception when others then if sqlerrm not like '%changed since this file was built%' then bad := bad || 'guard: ' || sqlerrm || '; '; end if; end;
` : ''}
  raise exception 'RESULT:%', case when bad = '' then 'PASS (' || n || ' members compared; ' || info || ')' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS[^\n]*|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1].startsWith('PASS') ? 0 : 1);
