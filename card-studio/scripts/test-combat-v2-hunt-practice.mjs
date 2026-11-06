import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_hunt_practice.sql (combat v2 step R3a: the v2 Hunt practice for testers; plan 20.20 R3,
 * pipeline item R3 SPEC v3, gate G1, cases H1-H11).
 * H1, H2, H4-H11: NO lasting change. Every request is one DO block, undone by its final RAISE. Each block first drops the R3 objects (the
 *   hunt_v2_ functions and the table hunt_v2_days), then runs the file, so the test passes before and after the file is applied. The block
 *   makes its own live Hunt (every other active Hunt expires in the block) at hp_remaining / hp_max = 0.4, its own members and testers.
 * H3 (no lock on the boss row): two REAL connections (the M1d concurrency method). It COMMITS a sample (4 test testers, their cards, one
 *   active Hunt row marked weak_points ["r3a_h3_sample"], the file under test) and removes all of it in a finally step. When the file was
 *   applied on the copy before the run, the finally step applies the clean file again (no row of a real member is lost: the run refuses a
 *   copy with a practice row of a non-test player). Take the local database lock first.
 * SYN: the file calls combat_v2_synergy (SYN). When the copy has no SYN, each block (and H3) makes a stand-in that returns the state
 *   unchanged, and H5b and the SYN mutation no_synergy print WAIT: the run is then NOT a gate result for them.
 *   LOCALDB=1 LOCALDB_ENV=... LOCALDB_LOCK_DIR=... node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-hunt-practice.mjs   must PASS
 *   MUTATE=<name> ...   must FAIL, for every name in MUT below
 *   MUTATE=all ...      the baseline (must PASS), then every mutation (each must FAIL); FAILS when a mutation named in the spec is missing
 *   FIGHTS=<n> ...      the seeded days of H8 (default 20, the spec number)
 *   H3=0 ...            skip H3 (a development run; the last line then says it is NOT a gate result)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, rawQuery, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-hunt-practice.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const CLEAN = (process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n') : read('../../tcg-bot/supabase/combat_v2_hunt_practice.sql')).replace(/notify pgrst[^\n]*\n/g, '');
let mig = CLEAN;
const FIGHTS = Number(process.env.FIGHTS || 20);
const RUN_H3 = process.env.H3 !== '0';
// Review R3-ON r1 F-1: H3 drops every hunt_v2_ object and applies the R3a file again. On a copy with R3-ON (combat_v2_on_hunt.sql: hunt_v2_shared,
// the columns live/credited, the v1 refusal in hunt_attack/hunt_support) that removed R3-ON, and every later test of a rehearsal failed. The final
// step now applies R3-ON again when it was on the copy before the run, and the cleanup check compares the objects before and after.
const ON_FILE = read('../../tcg-bot/supabase/combat_v2_on_hunt.sql').replace(/notify pgrst[^\n]*\n/g, '');
// HBP (combat_v2_hunt_boons.sql) replaces 3 R3-ON functions and adds hunt_v2_boon_plan: the final step applies it again after R3-ON when it was on
// the copy before the run (the same F-1 lesson). HBP_MUT=h3_no_reapply (the HBP gate G-12 mutation) leaves it out, so the shape check must FAIL.
// R3-ON-FIX (combat_v2_hunt_out_live.sql) replaces hunt_v2_out (an R3a function): the final step applies it again, last, when it was on the copy.
const OUT_FILE = read('../../tcg-bot/supabase/combat_v2_hunt_out_live.sql').replace(/notify pgrst[^\n]*\n/g, '');
const HBP_FILE = process.env.HBP_MUT === 'h3_no_reapply' ? '' : read('../../tcg-bot/supabase/combat_v2_hunt_boons.sql').replace(/notify pgrst[^\n]*\n/g, '');
// HUNT-V2-NATIVE (review r1 M2): hunt_v2_native_units.sql replaces hunt_v2_start, hunt_v2_live_credit, hunt_attack and hunt_support after HBP.
// The final step applies it again, last, when it was on the copy before the run (the F-1 lesson); SHAPE reads it (native_applied).
// HBP_MUT=h3_no_native (a mutation of this gate) leaves it out, so the shape check must FAIL.
const NATIVE_FILE = process.env.HBP_MUT === 'h3_no_native' ? '' : read('../../tcg-bot/supabase/hunt_v2_native_units.sql').replace(/notify pgrst[^\n]*\n/g, '');
const NATIVE_LC = (read('../../tcg-bot/supabase/hunt_v2_native_units.sql').match(/\('public\.hunt_v2_live_credit\(bigint, text, date, jsonb\)', '[0-9a-f]{32}', '([0-9a-f]{32})'\)/) || [])[1];
if (!NATIVE_LC) throw new Error('the guard of hunt_v2_native_units.sql must name hunt_v2_live_credit with its md5');
// HUNT-V2-NATIVE (review r1 M2/M3): hunt_v2_native_units.sql changes hunt_attack and hunt_support, which the R3-ON guard lists. Before R3-ON
// is applied again, V1_ORIGIN (the origin/main text of the two functions, from the native undo file) is applied when the native file is on
// (NATIVE_ON: the md5 of hunt_attack is the native one).
const NATIVE_TXT = read('../../tcg-bot/supabase/hunt_v2_native_units.sql').replace(/notify pgrst[^\n]*\n/g, '');
const NATIVE_UNDO_TXT = read('../../tcg-bot/supabase/hunt_v2_native_units_undo.sql');
const V1_ORIGIN = ['hunt_attack', 'hunt_support'].map((n) => {
  const i = NATIVE_UNDO_TXT.indexOf('create or replace function public.' + n + '(');
  const j = NATIVE_UNDO_TXT.indexOf('$fn$;', NATIVE_UNDO_TXT.indexOf('AS $fn$', i) + 7);
  if (i < 0 || j < 0) throw new Error('the native undo file has no ' + n);
  return NATIVE_UNDO_TXT.slice(i, j + 5);
}).join('\n\n');
const NATIVE_ATTACK = (NATIVE_TXT.match(/\('public\.hunt_attack\(text, bigint, bigint\)', '[0-9a-f]{32}', '([0-9a-f]{32})'\)/) || [])[1];
if (!NATIVE_ATTACK) throw new Error('the guard of hunt_v2_native_units.sql must name hunt_attack with its md5');
const NATIVE_ON = `md5(replace(pg_get_functiondef('public.hunt_attack(text, bigint, bigint)'::regprocedure), chr(13), '')) = '${NATIVE_ATTACK}'`;
const SHAPE = `select coalesce((select string_agg(p.oid::regprocedure::text || '=' || md5(replace(pg_get_functiondef(p.oid), chr(13), '')), ' ' order by p.oid::regprocedure::text)
    from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'hunt\\_v2\\_%' or p.proname in ('hunt_attack', 'hunt_support'))), '') ||
  ' | ' || coalesce((select string_agg(column_name || ':' || data_type, ' ' order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'hunt_v2_days'), '') as shape,
  to_regprocedure('public.hunt_v2_shared(bigint, text, date, jsonb)') is not null as on_applied,
  to_regprocedure('public.hunt_v2_boon_plan(jsonb, jsonb, numeric, jsonb, numeric)') is not null as hbp_applied,
  coalesce(obj_description(to_regprocedure('public.hunt_v2_out(bigint, text, date, jsonb)'), 'pg_proc'), '') like '%combat_v2_hunt_out_live.sql%' as out_applied,
  coalesce(md5(replace(pg_get_functiondef(to_regprocedure('public.hunt_v2_live_credit(bigint, text, date, jsonb)')), chr(13), '')) = '${NATIVE_LC}', false) as native_applied;`;
// H3 COMMITS the file on the copy. Only these mutations (each changes only hunt_v2_ objects, which the finally step drops) go into the H3
// file; every other mutation is caught in the rolled-back blocks, and H3 then commits the CLEAN file. (Run 1 committed flag_on, v1_touched and
// tags_dropped, which changed the copy outside R3: REPORT-r1 section 'Test defects'.)
const H3_MUTS = ['locks_boss', 'share_lock_start', 'fk_to_hunts'];

// ---------------------------------------------------------------------------------------------------------- the mutations
const END7 = '-- ============================================================ 7. server only';
const SAVE_END = '   where hunt_id = p_hunt and player_id = p_player and day = p_day;\nend $fn$;';
const MUT = {
  // H1
  tester_ignored: ["  if not combat_v2_on('hunt', p_player) then return jsonb_build_object('ok', false, 'error', 'not_tester'); end if;\n", ''],
  v1_touched: [END7, "do $v$ begin execute regexp_replace(pg_get_functiondef((select p.oid from pg_proc p where p.proname = 'hunt_view' and p.pronamespace = 'public'::regnamespace order by p.oid limit 1)), 'AS [$]function[$]', 'AS $function$ '); end $v$;\n" + END7],
  flag_on: [END7, "update public.balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';\n" + END7],
  // H2
  writes_shared_hp: [SAVE_END, SAVE_END.replace('end $fn$;', '  update public.hunts set hp_remaining = hp_remaining - 1 where id = p_hunt;\nend $fn$;')],
  writes_hits: [SAVE_END, SAVE_END.replace('end $fn$;', '  insert into public.hunt_hits (hunt_id, player_id, card_id, hit_date, damage) select p_hunt, p_player, d.squad[1], p_day, 1 from public.hunt_v2_days d where d.hunt_id = p_hunt and d.player_id = p_player and d.day = p_day;\nend $fn$;')],
  writes_actions: [SAVE_END, SAVE_END.replace('end $fn$;', "  insert into public.combat_actions (mode, ref_id, player_id, kind, game_day) values ('hunt', p_hunt, p_player, 'effect', p_day);\nend $fn$;")],
  // H3
  locks_boss: ['  select * into h from public.hunts where id = r.hunt_id;', '  select * into h from public.hunts where id = r.hunt_id for update;'],
  share_lock_start: ["  select * into h from public.hunts where status = 'active' and now() < closes_at order by opens_at desc limit 1;\n  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;",
    "  select * into h from public.hunts where status = 'active' and now() < closes_at order by opens_at desc limit 1 for share;\n  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;"],
  fk_to_hunts: ['  hunt_id bigint not null,\n', '  hunt_id bigint not null references public.hunts(id),\n'],
  // H4
  map_exact_name: ["   where lower(x.name) = lower(regexp_replace(p_name, '^The ', '', 'i')) or lower(x.name) = lower(p_name);", '   where x.name = p_name;'],
  // H5, H5b
  start_full_hp: ["jsonb_build_object('start_frac', v_frac,", "jsonb_build_object('start_frac', 1,"],
  stars_zero: ['      u := dungeon_v2_unit(p_player, x);', '      u := combat_v2_card_unit(x);'],
  mode_dungeon: ["  s := jsonb_build_object('v', '2'::jsonb, 'mode', 'hunt',", "  s := jsonb_build_object('v', '2'::jsonb, 'mode', 'dungeon',"],
  no_synergy: ['  s := combat_v2_synergy(s, b);\n', ''],
  tags_dropped: [END7, "do $v$ begin execute replace(pg_get_functiondef('public.dungeon_v2_unit(text, bigint, jsonb)'::regprocedure), 'return u || jsonb_build_object(', 'return (u - ''tags'') || jsonb_build_object('); end $v$;\n" + END7],
  // H6
  no_day_key: [" where d.hunt_id = h.id and d.player_id = p_player and d.day = v_day) then\n    return jsonb_build_object('ok', false, 'error', 'already');",
    " where d.hunt_id = h.id and d.player_id = p_player) then\n    return jsonb_build_object('ok', false, 'error', 'already');"],
  // H7
  cap_literal_8: ['cardinality(p_cards) > v_cap', 'cardinality(p_cards) > 8'],
  autopick_ignores_boss: ["'weak_role', boss->'weak_role'), v_cap, b, null)", "'weak_role', null), v_cap, b, null)"],
  // H8
  auto_one_less: ['case when p_auto then p_max else 1 end', 'case when p_auto then p_max - 1 else 1 end'],
  damage_from_max: ["         damage = start_hp - (p_fight->'enemies'->0->>'hp')::numeric,", "         damage = (p_fight->'enemies'->0->>'max')::numeric - (p_fight->'enemies'->0->>'hp')::numeric,"],
  // H9
  cap_ignored: ["              when p_event = 'cap' then 'cap'\n", "              when p_event = 'cap' then null\n"],
  after_close_plays: ["  if not found or h.status <> 'active' or now() >= h.closes_at then", '  if false then'],
  old_day_left_active: ["   where player_id = p_player and status = 'active' and day < p_day;", "   where player_id = p_player and status = 'active' and false;"],
  // H10
  grant_authenticated: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, authenticated', f);"],
  table_grant_anon: ['grant all on table public.hunt_v2_days to service_role;', 'grant all on table public.hunt_v2_days to service_role;\ngrant select on table public.hunt_v2_days to anon;'],
  comment_missing: [/comment on function public\.hunt_v2_view\(text\) is \$cm\$[^\n]*\n/, ''],
  // H11
  can_start_ignores_row: ["    'can_start', v_tester and v_has and v_key is not null\n                 and not exists (select 1 from public.hunt_v2_days d where d.hunt_id = h.id and d.player_id = p_player and d.day = v_day));",
    "    'can_start', v_tester and v_has and v_key is not null);"],
  view_no_live_frac: ["              'live_frac', h.hp_remaining::numeric / h.hp_max) end,", "              'live_frac', 1) end,"],
  can_start_ignores_tester: ["    'can_start', v_tester and v_has and v_key is not null", "    'can_start', v_has and v_key is not null"],
};
// every mutation that the spec G1 table names (SPEC v3 section 6)
const NAMED = `tester_ignored v1_touched flag_on writes_shared_hp writes_hits writes_actions locks_boss share_lock_start fk_to_hunts map_exact_name
  start_full_hp stars_zero mode_dungeon no_synergy tags_dropped no_day_key cap_literal_8 autopick_ignores_boss auto_one_less damage_from_max
  cap_ignored after_close_plays old_day_left_active grant_authenticated table_grant_anon can_start_ignores_row view_no_live_frac
  can_start_ignores_tester`.split(/\s+/).filter(Boolean);
// the mutations that only the SYN case can catch (H5b): WAIT while the copy has no SYN
const SYN_ONLY = ['no_synergy'];
const pairs = (m) => (Array.isArray(m[0]) ? m : [m]);

if (process.env.MUTATE === 'all') {
  let ok = true;
  const missing = NAMED.filter((n) => !MUT[n]);
  console.log(`named mutations of the spec G1 table: ${NAMED.length}; in MUT: ${NAMED.length - missing.length}; missing: ${missing.length ? missing.join(' ') : 'none'}`);
  if (missing.length) ok = false;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, H3: '1', LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  const synOn = /SYN on the copy: yes/.test(base.stdout || '');
  console.log(`baseline (no mutation)            ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 160)}`);
  if (base.status !== 0) { ok = false; console.log((base.stdout || '').split(/\r?\n/).filter((l) => /^FAIL/.test(l)).join('\n').slice(0, 3000) + (base.stderr || '').slice(0, 2000)); }
  const ran = []; const waits = [];
  for (const name of Object.keys(MUT)) {
    const t0 = Date.now();
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    const why = (r.stdout || '').split(/\r?\n/).find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '';
    let tag = caught ? 'caught (test FAILS)' : 'NOT CAUGHT';
    if (!caught && !synOn && SYN_ONLY.includes(name)) { tag = 'WAIT (SYN not on the copy)'; waits.push(name); }
    else if (!caught) ok = false;
    if (caught) ran.push(name);
    console.log(`mutation ${name.padEnd(26)} ${tag}  ${line.slice(0, 40)}  ${Math.round((Date.now() - t0) / 1000)}s  ${why.slice(0, 150)}`);
  }
  const notRun = NAMED.filter((n) => !ran.includes(n) && !waits.includes(n));
  if (notRun.length) { ok = false; console.log(`named mutations not caught or not run: ${notRun.join(' ')}`); }
  const n = Object.keys(MUT).length;
  if (!ok) console.log('mutations: FAIL (a red baseline, a mutation not caught, or a named mutation not run)');
  else if (waits.length) console.log(`mutations: baseline PASS, ${ran.length} of ${n} caught; ${waits.length} WAIT for SYN (${waits.join(' ')}): NOT a full gate result`);
  else console.log(`mutations: baseline PASS, all ${n} caught (${NAMED.length} named in the spec, each run)`);
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  for (const [a, b] of pairs(m)) {
    const n = a instanceof RegExp ? (mig.match(new RegExp(a.source, 'g')) || []).length : mig.split(a).length - 1;
    if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once (${n})`);
    mig = a instanceof RegExp ? mig.replace(a, b) : mig.split(a).join(b);
  }
}
for (const s of [mig, CLEAN]) if (['$m$', '$t$', '$x$', '$w$', '$q$', '$h3$'].some((x) => s.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $x$, $w$, $q$ or $h3$');

// ---------------------------------------------------------------------------------------------------------- the shared SQL
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const MD5 = `md5(replace(pg_get_functiondef(p.oid), chr(13), ''))`;
const SIG = `replace(p.oid::regprocedure::text, ', ', ',')`;
const NEW = ['hunt_v2_boss_key(text)', 'hunt_v2_today()', 'hunt_v2_abandon(text,date)', 'hunt_v2_end_of(text,jsonb)', 'hunt_v2_save(bigint,text,date,jsonb,text,jsonb)',
  'hunt_v2_day_json(hunt_v2_days)', 'hunt_v2_out(bigint,text,date,jsonb)', 'hunt_v2_start(text,bigint[])', 'hunt_v2_turns(text,jsonb,boolean,integer)',
  'hunt_v2_act(text,jsonb)', 'hunt_v2_auto(text,integer)', 'hunt_v2_view(text)'];
const NEW_ARR = `array[${NEW.map(lit).join(', ')}]::text[]`;
const id = (k, i) => `9000000000000${k}${String(i).padStart(2, '0')}`;   // Discord-shaped ids (balance combat_v2 testers)
const TESTERS = Array.from({ length: 18 }, (_, i) => id('033', i + 1));
const OTHERS = Array.from({ length: 3 }, (_, i) => id('034', i + 1));
const T = (i) => lit(TESTERS[i - 1]);
const O = (i) => lit(OTHERS[i - 1]);

// the state before the file (no R3 object; a stand-in for SYN when the copy has none), then the file, then the test world
const PRE = String.raw`
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'hunt\_v2\_%' loop
    execute 'drop function ' || f;
  end loop;
  drop table if exists public.hunt_v2_days;
  syn_on := to_regprocedure('public.combat_v2_card_tags(bigint)') is not null and to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is not null;
  if to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is null then
    execute 'create function public.combat_v2_synergy(p_state jsonb, p_b jsonb) returns jsonb language sql immutable as ''select p_state''';
  end if;`;
const WORLD = String.raw`
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_r3a_admin', true);
  -- the live Hunt of the block: every other active Hunt expires; one active Heroic Hunt of a mapped boss ("The " + the v2 name) at 0.4
  update hunts set status = 'expired' where status = 'active';
  select x.key, x.name into bk, bn from hunt_bosses_v2 x
   where exists (select 1 from unnest(x.weak_to) w join roles r on w = 'role:' || r.key where r.class = 'attacker') order by x.ord limit 1;   -- a Weak to role of an attacker (H7: the pick can change)
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || bn, 'Heroic', '[]'::jsonb, 80000, 32000, now() - interval '1 hour', now() + interval '2 days', 'active') returning id into hid;
  b := combat_v2_enemy_numbers();
  -- the card pools: one card per subject and rarity, with a usable ability_v2 (a role of the roles table and a list of blocks)
  create temp table r3a_pool on commit drop as
    select distinct on (c.subject_id, c.rarity) c.id, c.rarity::text as rarity, s.type in ('Character', 'Creature') as att, s.ability_v2->>'role' as role
      from cards c join subjects s on s.id = c.subject_id
     where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from roles x where x.key = s.ability_v2->>'role')
     order by c.subject_id, c.rarity, c.id;
  na := array(select id from r3a_pool where att and rarity = 'normal' order by id limit 12);
  sup := array(select id from r3a_pool where not att and rarity = 'normal' order by id limit 5);
  nown := (select id from r3a_pool where att and rarity = 'normal' order by id offset 12 limit 1);
  sq := na[1:4] || sup[1:2];
  create function pg_temp.member(p text, cs bigint[]) returns void language plpgsql as $x$
  begin
    insert into players (id, username) values (p, 'tst ' || p);
    insert into player_cards (player_id, card_id, quantity) select p, z, 1 from unnest(cs) z on conflict do nothing;
  end $x$;
  perform pg_temp.member(x, na || sup) from unnest(array[${[...TESTERS, ...OTHERS].map(lit).join(', ')}]) x;
  update balance set value = jsonb_set(value, '{testers}', ${lit(JSON.stringify(TESTERS))}::jsonb) where key = 'combat_v2';
  create function pg_temp.all_true_s(p boolean, v boolean) returns boolean language sql immutable as $x$ select coalesce(p, true) and coalesce(v, false) $x$;
  create aggregate pg_temp.all_true(boolean) (sfunc = pg_temp.all_true_s, stype = boolean);
  create temp table r3a_spy (n serial, s jsonb, c jsonb) on commit drop;
  -- a call in a sub-block that is rolled back: the answer and the practice rows of the player
  create function pg_temp.sub(q text, p text default null) returns jsonb language plpgsql as $x$
  declare a jsonb; out jsonb;
  begin
    begin
      execute 'select (' || q || ')::jsonb' into a;
      out := jsonb_build_object('ans', a, 'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.day), '[]'::jsonb) from hunt_v2_days r where r.player_id = p));
      raise exception 'r3a_rollback';
    exception when others then
      if sqlerrm <> 'r3a_rollback' then out := jsonb_build_object('ans', jsonb_build_object('raised', sqlerrm, 'sqlstate', sqlstate)); end if;
    end;
    return out;
  end $x$;
  -- the spy: every input of combat_v2_step with no choice (the fight at its start) of one call; rolled back
  create function pg_temp.spy(q text, p text default null) returns jsonb language plpgsql as $x$
  declare a jsonb; out jsonb;
  begin
    begin
      delete from r3a_spy;
      alter function public.combat_v2_step(jsonb, jsonb, jsonb) rename to r3a_real_step;
      execute $w$create function public.combat_v2_step(p_state jsonb, p_choice jsonb, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $s$
        begin insert into r3a_spy (s, c) values (p_state, p_choice); return public.r3a_real_step(p_state, p_choice, p_b); end $s$$w$;
      execute 'select (' || q || ')::jsonb' into a;
      out := jsonb_build_object('ans', a, 'f0', (select coalesce(jsonb_agg(s order by n), '[]'::jsonb) from r3a_spy where c is null or c = 'null'::jsonb),
        'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.day), '[]'::jsonb) from hunt_v2_days r where r.player_id = p));
      raise exception 'r3a_rollback';
    exception when others then
      if sqlerrm <> 'r3a_rollback' then out := jsonb_build_object('raised', sqlerrm); end if;
    end;
    return out;
  end $x$;
  -- the Auto v2 choice of the card that has the turn
  create function pg_temp.autoc(f jsonb) returns jsonb language plpgsql as $x$
  declare d jsonb := combat_v2_auto(f, f->'ext'->'turn', combat_v2_enemy_numbers(), null);
  begin return jsonb_build_object('use', d->'use', 'target', d->'target', 'ally', d->'ally'); end $x$;
  -- the practice row of a player today
  create function pg_temp.vrow(p text) returns hunt_v2_days language sql as $x$
    select * from hunt_v2_days where player_id = p and day = hunt_v2_today() order by started_at desc limit 1 $x$;`;
const DECL = `f text; res jsonb := '[]'; b jsonb; a jsonb; a2 jsonb; r jsonb; s jsonb; s2 jsonb; x jsonb; y jsonb; e jsonb; o jsonb;
  rw record; ok boolean; n int; i int; t text; t2 text; msg text; v numeric; sh numeric; syn_on boolean; bk text; bn text; hid bigint;
  sq bigint[]; na bigint[]; sup bigint[]; nown bigint; arr bigint[]; w0 jsonb; w1 jsonb; pl jsonb; lg jsonb; out jsonb; row0 jsonb; f0 jsonb`;
const block = (body, extra = '') => String.raw`do $t$
#variable_conflict use_column
declare ${DECL}; ${extra}
begin
  ${PRE}
  execute $m$${mig}$m$;
  ${WORLD}
  ${body}
  raise exception 'RESULT:%', jsonb_build_object('syn', syn_on, 'rows', res)::text;
end $t$;`;
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;
const wait = (name) => `res := res || jsonb_build_object('case', ${lit(name)}, 'wait', true);`;
const START = (p, arr = 'sq') => `format('hunt_v2_start(%L, %L::bigint[])', ${p}, ${arr})`;
const BOSS_HP = `(s->'enemies'->0->>'hp')::numeric`;

// ---------------------------------------------------------------------------------------------------------- B1: H1 (INV-1/3), H10 (INV-5)
const B1 = String.raw`do $t$
#variable_conflict use_column
declare ${DECL}; md5_a jsonb; md5_b jsonb; md5_c jsonb; con_a jsonb; con_b jsonb; acl_a jsonb; acl_b jsonb; fa jsonb; fb jsonb; tb_a text[]; tb_b text[];
begin
  ${PRE}
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  select jsonb_object_agg(c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid)) into con_a from pg_constraint c where c.connamespace = 'public'::regnamespace;
  select jsonb_object_agg(c.relname, coalesce(c.relacl::text, '')), array_agg(c.relname::text order by c.relname) into acl_a, tb_a
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p');
  select value into fa from public.balance where key = 'combat_v2';
  execute $m$${mig}$m$;
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  select jsonb_object_agg(c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid)) into con_b from pg_constraint c
   where c.connamespace = 'public'::regnamespace and c.conrelid <> 'public.hunt_v2_days'::regclass;
  select jsonb_object_agg(c.relname, coalesce(c.relacl::text, '')), array_agg(c.relname::text order by c.relname) into acl_b, tb_b
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') and c.relname <> 'hunt_v2_days';
  select value into fb from public.balance where key = 'combat_v2';
  ${add('H1 INV-1 every public function that existed keeps its md5 (none is gone); the file adds exactly the 12 hunt_v2_ functions',
    `not exists (select 1 from jsonb_each_text(md5_a) q where md5_b->>q.key is distinct from q.value)
     and (select coalesce(array_agg(q.key order by q.key), '{}') from jsonb_each_text(md5_b) q where not md5_a ? q.key) = (select array_agg(z order by z) from unnest(${NEW_ARR}) z)`,
    `jsonb_build_object('changed', (select jsonb_agg(q.key) from jsonb_each_text(md5_a) q where md5_b->>q.key is distinct from q.value),
       'added', (select jsonb_agg(q.key) from jsonb_each_text(md5_b) q where not md5_a ? q.key))`)}
  ${add('H1 INV-1 every older constraint text is the same (the new table only adds its own)', 'con_a = con_b',
    `(select jsonb_agg(q.key) from jsonb_each_text(con_a) q where con_b->>q.key is distinct from q.value)`)}
  ${add('H1 INV-1 every older table and view keeps its grants (relacl); the only new relation is hunt_v2_days', 'acl_a = acl_b and tb_a = tb_b',
    `(select jsonb_agg(q.key) from jsonb_each_text(acl_a) q where acl_b->>q.key is distinct from q.value)`)}
  ${add('H1 the file does not change balance combat_v2 (the four flags and the tester list)', 'fa = fb', `jsonb_build_object('before', fa - 'testers', 'after', fb - 'testers')`)}
  ${WORLD}
  a := pg_temp.sub(${START(O(1))}, ${O(1)});
  ${add('H1 INV-3 a non-tester gets not_tester and no practice row', `a->'ans'->>'error' = 'not_tester' and a->'rows' = '[]'::jsonb`, 'a')}
  a := pg_temp.sub(format('hunt_v2_start(%L)', ${O(1)}), ${O(1)});
  ${add('H1 INV-3 a non-tester with the auto-pick (no cards) gets not_tester and no practice row', `a->'ans'->>'error' = 'not_tester' and a->'rows' = '[]'::jsonb`, 'a')}
  -- H10 grants, RLS, search_path, comments
  ${add('H10 INV-5 every new function: no EXECUTE for PUBLIC, anon or authenticated; EXECUTE for service_role; search_path = public; a [combat] comment that names the file',
    `(select pg_temp.all_true(not has_function_privilege('anon', z::regprocedure, 'EXECUTE') and not has_function_privilege('authenticated', z::regprocedure, 'EXECUTE')
        and not exists (select 1 from pg_proc p, aclexplode(p.proacl) q where p.oid = z::regprocedure and q.grantee = 0)
        and has_function_privilege('service_role', z::regprocedure, 'EXECUTE')
        and (select proconfig from pg_proc where oid = z::regprocedure) = array['search_path=public']
        and coalesce(obj_description(z::regprocedure, 'pg_proc'), '') like '[combat]%combat_v2_hunt_practice.sql%') from unnest(${NEW_ARR}) z)`,
    `(select jsonb_agg(z) from unnest(${NEW_ARR}) z where has_function_privilege('anon', z::regprocedure, 'EXECUTE') or has_function_privilege('authenticated', z::regprocedure, 'EXECUTE')
        or not has_function_privilege('service_role', z::regprocedure, 'EXECUTE') or coalesce(obj_description(z::regprocedure, 'pg_proc'), '') not like '[combat]%')`)}
  ${add('H10 INV-5 the table hunt_v2_days: RLS on, no policy, no privilege for anon or authenticated, all for service_role, a [combat] comment on the table and every column; no foreign key to hunts',
    `(select relrowsecurity from pg_class where oid = 'public.hunt_v2_days'::regclass)
     and not exists (select 1 from pg_policy where polrelid = 'public.hunt_v2_days'::regclass)
     and not has_table_privilege('anon', 'public.hunt_v2_days', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     and not has_table_privilege('authenticated', 'public.hunt_v2_days', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     and has_table_privilege('service_role', 'public.hunt_v2_days', 'SELECT') and has_table_privilege('service_role', 'public.hunt_v2_days', 'INSERT')
     and has_table_privilege('service_role', 'public.hunt_v2_days', 'UPDATE') and has_table_privilege('service_role', 'public.hunt_v2_days', 'DELETE')
     and coalesce(obj_description('public.hunt_v2_days'::regclass, 'pg_class'), '') like '[combat]%'
     and not exists (select 1 from pg_attribute where attrelid = 'public.hunt_v2_days'::regclass and attnum > 0 and not attisdropped and coalesce(col_description(attrelid, attnum), '') = '')
     and not exists (select 1 from pg_constraint where conrelid = 'public.hunt_v2_days'::regclass and contype = 'f' and confrelid = 'public.hunts'::regclass)`,
    `(select jsonb_build_object('acl', relacl::text, 'rls', relrowsecurity) from pg_class where oid = 'public.hunt_v2_days'::regclass)`)}
  msg := null;
  begin execute $m$${mig}$m$; exception when others then msg := sqlerrm; end;
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_c from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  ${add('H10 the file runs a second time with no error, and every function keeps its md5', 'msg is null and md5_b = md5_c', 'to_jsonb(msg)')}
  raise exception 'RESULT:%', jsonb_build_object('syn', syn_on, 'rows', res)::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------- B2: H4 map, H5 start, H5b SYN, H6 one day, H7 squad
const B2 = block(String.raw`
  -- H4 every v2 boss name, with and without "The ": its key; an unknown name: null and no_v2_boss
  ok := true; n := 0; o := '[]';
  for t, t2 in select x.key, x.name from hunt_bosses_v2 x order by x.ord loop
    n := n + 1;
    if hunt_v2_boss_key(t2) is distinct from t or hunt_v2_boss_key('The ' || t2) is distinct from t then ok := false; o := o || to_jsonb(t2); end if;
  end loop;
  ${add('H4 all v2 boss names (16 on the copy), each also with "The " added: the right key', `ok and n >= 16 and n = (select count(*) from hunt_bosses_v2)`, `jsonb_build_object('n', n, 'wrong', o)`)}
  update hunts set name = 'The Nobody Of This Name' where id = hid;
  a := pg_temp.sub(${START(T(1))}, ${T(1)});
  ${add('H4 an unknown live name: hunt_v2_boss_key null; the start answers no_v2_boss and writes no row',
    `hunt_v2_boss_key('The Nobody Of This Name') is null and a->'ans'->>'error' = 'no_v2_boss' and a->'rows' = '[]'::jsonb`, 'a')}
  update hunts set name = 'The ' || bn where id = hid;
  -- H5 INV-4 the start at live frac 0.4; one card with 2 stars; v2_dungeon.round_cap 30 in the block
  update player_cards set ascension = 2 where player_id = ${T(2)} and card_id = na[2];
  update balance set value = jsonb_set(value, '{round_cap}', '30') where key = 'v2_dungeon';
  b := combat_v2_enemy_numbers();
  x := pg_temp.spy(${START(T(2))}, ${T(2)});
  a := x->'ans'; s := x->'f0'->0; e := combat_v2_hunt_boss('Heroic', bk, '{"start_frac": 0.4}'::jsonb, b);
  ${add('H5 the start: ok, one row (this Hunt, the mapped boss, today, active), the squad in pick order',
    `(a->>'ok')::boolean and jsonb_array_length(x->'rows') = 1 and (x->'rows'->0->>'hunt_id')::bigint = hid and x->'rows'->0->>'boss' = bk
     and x->'rows'->0->>'status' = 'active' and (x->'rows'->0->>'day')::date = hunt_v2_today() and x->'rows'->0->'squad' = to_jsonb(sq)`, `x - 'f0'`)}
  ${add('H5 INV-4 the boss at the start = combat_v2_hunt_boss(live tier, mapped key, start_frac 0.4) (all keys but the meter): hp = max x 0.4; start_hp = that hp',
    `s is not null and (s->'enemies'->0) - 'meter' = e - 'meter' and ${BOSS_HP} = (e->>'max')::numeric * 0.4 and (e->>'max')::numeric > 0
     and (x->'rows'->0->>'start_hp')::numeric = ${BOSS_HP} and jsonb_array_length(s->'enemies') = 1`,
    `jsonb_build_object('hp', s->'enemies'->0->'hp', 'max', s->'enemies'->0->'max', 'start_hp', x->'rows'->0->'start_hp')`)}
  ${add('H5 QH3 each unit (by id) = dungeon_v2_unit of the player; the 2-star card has the card_combat_v2 attack of 2 stars (above the 0-star attack)',
    `(select pg_temp.all_true(a->'units'->(z::text) = dungeon_v2_unit(${T(2)}, z)) from unnest(sq) z)
     and (a->'units'->(na[2]::text)->'atk') = (select card_combat_v2(c.rarity::text, 2, s0.cp_mod, 0, '{}'::jsonb, s0.ability_v2->>'role')->'stats'->'atk'
            from cards c join subjects s0 on s0.id = c.subject_id where c.id = na[2])
     and (a->'units'->(na[2]::text)->>'atk')::numeric > (combat_v2_card_unit(na[2])->>'atk')::numeric`,
    `jsonb_build_object('u2', a->'units'->(na[2]::text)->'atk', 'base', combat_v2_card_unit(na[2])->'atk')`)}
  ${add('H5 the fight: mode hunt; each card = its unit + a meter in [0, act_at] with 2 decimals; the boss meter in [0, act_at]',
    `s->>'mode' = 'hunt' and (select pg_temp.all_true((s->'cards'->(z::text)) - 'meter' - 'syn' = (a->'units'->(z::text)) - 'meter' - 'syn'
        and (s->'cards'->(z::text)->>'meter')::numeric between 0 and (b->'v2_speed'->>'act_at')::numeric
        and round((s->'cards'->(z::text)->>'meter')::numeric, 2) = (s->'cards'->(z::text)->>'meter')::numeric) from unnest(sq) z)
     and (s->'enemies'->0->>'meter')::numeric between 0 and (b->'v2_speed'->>'act_at')::numeric`, `jsonb_build_object('mode', s->'mode')`)}
  ${add('H5 the cap is v2_hunt.round_cap: steps_left = v2_hunt.round_cap - the clock (v2_dungeon.round_cap 30 in the block is not used)',
    `(a->>'steps_left')::int = (b->'v2_hunt'->>'round_cap')::int - (a->'fight'->>'clock')::int and (b->'v2_hunt'->>'round_cap')::int <> 30`,
    `jsonb_build_object('steps_left', a->'steps_left', 'clock', a->'fight'->'clock', 'cap', b->'v2_hunt'->'round_cap')`)}
  ${add('H5 the start answer: engine 2, practice, boss = hunt_boss_v2_card, damage = start_hp - boss hp, status, the screen fields (need, order, targets [0], allies, squad_hp)',
    `a->'engine' = '2'::jsonb and (a->>'practice')::boolean and a->'boss' = hunt_boss_v2_card(bk, 'Heroic')
     and (a->>'damage')::numeric = (x->'rows'->0->>'start_hp')::numeric - (a->'fight'->'enemies'->0->>'hp')::numeric
     and a->>'status' = 'active' and a ? 'need' and a ? 'order' and a->'targets' = '[0]'::jsonb and a ? 'allies' and a ? 'squad_hp' and a->>'event' = 'choose'`,
    `a - 'fight' - 'units' - 'info' - 'log' - 'order' - 'status_lines' - 'boss'`)}
  -- H5b SYN: the synergy once at the start, and the tags of the units
  if syn_on then
    begin
      update balance set value = jsonb_set(jsonb_set(jsonb_set(jsonb_set(value, '{element,small_at}', '2'), '{element,big_at}', '2'), '{element,small}', '1.2'), '{element,big}', '1.2')
       where key = 'v2_synergy';
      b := combat_v2_enemy_numbers();
      t := (select combat_v2_card_tags(p.id)->>'element' from r3a_pool p where p.att and combat_v2_card_tags(p.id)->>'element' is not null
             group by 1 having count(*) >= 2 order by 1 limit 1);
      arr := array(select p.id from r3a_pool p where p.att and combat_v2_card_tags(p.id)->>'element' = t order by p.id limit 2);
      insert into player_cards (player_id, card_id, quantity) select ${T(3)}, z, 1 from unnest(arr) z on conflict do nothing;
      arr := arr || array(select z from unnest(sup[1:2]) z where combat_v2_card_tags(z)->>'element' is distinct from t);
      x := pg_temp.spy(${START(T(3), 'arr')}, ${T(3)});
      s := x->'f0'->0;
      s2 := jsonb_set(s, '{cards}', (select jsonb_object_agg(q.key, q.value - 'syn') from jsonb_each(s->'cards') q));
      y := combat_v2_synergy(s2, b);
      ${add('H5b SYN: in the saved start state every card syn = combat_v2_synergy(that state minus syn), card by card; the 2 attackers of one element have elem_x <> 1',
        `(x->'ans'->>'ok')::boolean and (select pg_temp.all_true(q.value ? 'syn' and q.value->'syn' = y->'cards'->q.key->'syn') from jsonb_each(s->'cards') q)
         and (select pg_temp.all_true((s->'cards'->(z::text)->'syn'->>'elem_x')::numeric <> 1) from unnest(arr[1:2]) z)`,
        `jsonb_build_object('element', t, 'syn', (select jsonb_object_agg(q.key, q.value->'syn') from jsonb_each(s->'cards') q), 'raised', x->'raised')`)}
      ${add('H5b SYN: each unit tags = combat_v2_card_tags(card), by id',
        `(select pg_temp.all_true(x->'ans'->'units'->(z::text) ? 'tags' and x->'ans'->'units'->(z::text)->'tags' = to_jsonb(combat_v2_card_tags(z))) from unnest(arr) z)`,
        `(select jsonb_object_agg(z::text, x->'ans'->'units'->(z::text)->'tags') from unnest(arr) z)`)}
      raise exception 'r3a_rollback';
    exception when others then
      if sqlerrm <> 'r3a_rollback' then ${add('H5b the SYN block raised', 'false', 'to_jsonb(sqlerrm)')} end if;
    end;
  else
    ${wait('H5b SYN: in the saved start state every card syn = combat_v2_synergy(that state minus syn); the 2 attackers of one element have elem_x <> 1')}
    ${wait('H5b SYN: each unit tags = combat_v2_card_tags(card), by id')}
  end if;
  -- H6 QH2 one day: a row of yesterday (same Hunt) does not block today; a second start today is already
  insert into hunt_v2_days (hunt_id, player_id, day, boss, squad, state, start_hp, status, ended_by)
    values (hid, ${T(4)}, hunt_v2_today() - 1, bk, sq, '{"engine": 2}'::jsonb, 1, 'over', 'cap');
  a := hunt_v2_start(${T(4)}, sq);
  a2 := pg_temp.sub(${START(T(4))}, ${T(4)});
  ${add('H6 QH2 with a row of yesterday: a start today succeeds; a second start today answers already and writes nothing (2 rows: yesterday, today)',
    `(a->>'ok')::boolean and a2->'ans'->>'error' = 'already' and jsonb_array_length(a2->'rows') = 2`, `jsonb_build_object('first', a->'error', 'second', a2->'ans')`)}
  -- H7 QH4 the auto-pick with the boss mechanics and Weak to role
  e := combat_v2_hunt_boss('Heroic', bk, '{}'::jsonb, b);
  for i in 1 .. 4 loop
    pl := (select coalesce(jsonb_agg(jsonb_build_object('id', pc.card_id, 'role', cc->>'role', 'class', cc->>'class', 'atk', cc->'stats'->'atk', 'crt', cc->'stats'->'crt',
             'crd', cc->'stats'->'crd', 'spd', cc->'stats'->'spd', 'blocks', s0.ability_v2->'blocks', 'pick_factor', s0.ability_v2->'pick_factor') order by pc.card_id), '[]'::jsonb)
           from player_cards pc join cards c on c.id = pc.card_id join subjects s0 on s0.id = c.subject_id
           cross join lateral (select card_combat_v2(c.rarity::text, coalesce(pc.ascension, 0), s0.cp_mod, 0, '{}'::jsonb, s0.ability_v2->>'role') cc) z
          where pc.player_id = ${T(5)} and pc.quantity > 0 and c.id in (select id from r3a_pool));
    w1 := combat_v2_autopick(pl, jsonb_build_object('mechanics', coalesce(e->'mechanics', '[]'::jsonb), 'weak_role', e->'weak_role'), hunt_card_cap(), b, null)->'ids';
    w0 := combat_v2_autopick(pl, jsonb_build_object('mechanics', coalesce(e->'mechanics', '[]'::jsonb), 'weak_role', null), hunt_card_cap(), b, null)->'ids';
    exit when w1 is distinct from w0;
    -- L-3: plant one more card of the Weak to role (the next one, by rarity then id)
    insert into player_cards (player_id, card_id, quantity)
      select ${T(5)}, p.id, 1 from r3a_pool p where p.role = e->>'weak_role' and not exists (select 1 from player_cards q where q.player_id = ${T(5)} and q.card_id = p.id)
       order by case p.rarity when 'secret_rare' then 1 when 'illustrated_rare' then 2 when 'gold' then 3 else 4 end, p.id limit 1;
  end loop;
  a := pg_temp.sub(format('hunt_v2_start(%L)', ${T(5)}), ${T(5)});
  ${add('H7 L-3 combat_v2_autopick with and without the boss weak_role gives different ids for the pool; the start with no cards = the with-boss ids',
    `w1 is distinct from w0 and (a->'ans'->>'ok')::boolean and a->'rows'->0->'squad' = w1`, `jsonb_build_object('weak_role', e->'weak_role', 'with', w1, 'without', w0, 'squad', a->'rows'->0->'squad', 'err', a->'ans'->'error')`)}
  update balance set value = '3' where key = 'daily_card_cap';
  for t, arr, t2 in select * from (values
      ('4 cards (hunt_card_cap() 3)', na[1:4], 'squad_size'), ('3 cards', na[1:3], 'ok'), ('a duplicate', array[na[1], na[1], na[2]], 'squad_size'),
      ('0 cards', '{}'::bigint[], 'squad_size'), ('a card not owned', array[nown, na[1]], 'not_owned')) q loop
    a := pg_temp.sub(format('hunt_v2_start(%L, %L::bigint[])', ${T(6)}, arr), ${T(6)});
    res := res || jsonb_build_object('case', 'H7 own pick, ' || t || ': ' || t2 || case when t2 = 'ok' then ' and one row' else ' and no row' end,
      'ok', coalesce(case when t2 = 'ok' then (a->'ans'->>'ok')::boolean and jsonb_array_length(a->'rows') = 1
                          else a->'ans'->>'error' = t2 and a->'rows' = '[]'::jsonb and (t2 <> 'not_owned' or (a->'ans'->>'card')::bigint = nown)
                               and (t2 <> 'squad_size' or (a->'ans'->>'cap')::int = 3) end, false),
      'got', (a->'ans') - 'fight' - 'units' - 'info' - 'log' - 'order' - 'status_lines' - 'boss');
  end loop;
  begin
    update subjects set ability_v2 = null where id = (select subject_id from cards where id = na[3]);
    a := pg_temp.sub(format('hunt_v2_start(%L, %L::bigint[])', ${T(6)}, na[1:3]), ${T(6)});
    ${add('H7 QD4 a card with no ability_v2 in the own pick: no_v2, that id (only) in cards, no row',
      `a->'ans'->>'error' = 'no_v2' and a->'ans'->'cards' = jsonb_build_array(na[3]) and a->'rows' = '[]'::jsonb`, 'a')}
    raise exception 'r3a_rollback';
  exception when others then
    if sqlerrm <> 'r3a_rollback' then ${add('H7 the no_v2 block raised', 'false', 'to_jsonb(sqlerrm)')} end if;
  end;
`, 'cc jsonb;');

// ---------------------------------------------------------------------------------------------------------- B3: H8 the fights (seeded days)
const B3 = (from, to) => block(String.raw`
  out := '[]';
  for i in ${from} .. ${to} loop
    begin
      perform setseed(i / 100.0);
      a := hunt_v2_start(${T(7)}, sq);
      if a->>'status' is distinct from 'active' then out := out || jsonb_build_array(jsonb_build_object('seed', i, 'skip', a->'status', 'err', a->'error')); raise exception 'r3a_rollback'; end if;
      f0 := a->'fight'; rw := pg_temp.vrow(${T(7)}); sh := rw.start_hp;
      row0 := jsonb_build_object('seed', i, 'start', sh = (combat_v2_hunt_boss('Heroic', bk, '{}'::jsonb, b)->>'max')::numeric * 0.4
        and (a->>'damage')::numeric = sh - (f0->'enemies'->0->>'hp')::numeric and rw.damage = (a->>'damage')::numeric);
      -- auto 1000 = the replay of combat_v2_auto + combat_v2_step on the same fight and seed; damage = start_hp - the boss hp
      begin
        perform setseed(0.5);
        x := hunt_v2_auto(${T(7)}, 1000);
        rw := pg_temp.vrow(${T(7)});
        perform setseed(0.5);
        s := f0; lg := '[]'; n := 0;
        loop
          e := pg_temp.autoc(s); r := combat_v2_step(s, e, b); lg := lg || (r->'log'); s := r->'state';
          exit when r->>'event' <> 'choose';
        end loop;
        n := (select count(*) from jsonb_array_elements(lg) z where z->>'k' = 'act' and z->'actor'->>'side' = 'card');
        row0 := row0 || jsonb_build_object('auto', x->'log' = lg and x->>'event' = r->>'event' and (x->>'played')::int = n and rw.state->'fight' = s,
          'n', n, 'end', r->'event', 'won', r->'won', 'ended_by', rw.ended_by,
          'dmg', (x->>'damage')::numeric = sh - ${BOSS_HP} and rw.damage = sh - ${BOSS_HP} and rw.steps = (s->>'clock')::int,
          'over', rw.status = 'over' and rw.ended_by = case when r->>'event' = 'cap' then 'cap' when not combat_v2_up(s->'enemies'->0) then 'boss_down' else 'squad_down' end);
        raise exception 'r3a_rollback';
      exception when others then if sqlerrm <> 'r3a_rollback' then row0 := row0 || jsonb_build_object('raised_auto', sqlerrm); end if;
      end;
      -- auto 3: exactly the replay of up to 3 card turns; damage at that call
      begin
        perform setseed(0.6);
        x := hunt_v2_auto(${T(7)}, 3);
        rw := pg_temp.vrow(${T(7)});
        perform setseed(0.6);
        s := f0; lg := '[]';
        for j in 1 .. 3 loop
          e := pg_temp.autoc(s); r := combat_v2_step(s, e, b); lg := lg || (r->'log'); s := r->'state';
          exit when r->>'event' <> 'choose';
        end loop;
        row0 := row0 || jsonb_build_object('auto3', x->'log' = lg and rw.state->'fight' = s and jsonb_array_length(x->'auto') = (x->>'played')::int,
          'dmg3', (x->>'damage')::numeric = sh - ${BOSS_HP} and rw.damage = sh - ${BOSS_HP});
        raise exception 'r3a_rollback';
      exception when others then if sqlerrm <> 'r3a_rollback' then row0 := row0 || jsonb_build_object('raised_auto3', sqlerrm); end if;
      end;
      -- act: the player's choice = one combat_v2_step with the same seed; damage at that call
      begin
        e := pg_temp.autoc(f0);
        perform setseed(0.5);
        x := hunt_v2_act(${T(7)}, e);
        rw := pg_temp.vrow(${T(7)});
        perform setseed(0.5);
        r := combat_v2_step(f0, e, b); s := r->'state';
        row0 := row0 || jsonb_build_object('act', x->'log' = r->'log' and x->>'event' = r->>'event' and (x->>'ok')::boolean and rw.state->'fight' = s,
          'dmga', (x->>'damage')::numeric = sh - ${BOSS_HP} and rw.damage = sh - ${BOSS_HP});
        raise exception 'r3a_rollback';
      exception when others then if sqlerrm <> 'r3a_rollback' then row0 := row0 || jsonb_build_object('raised_act', sqlerrm); end if;
      end;
      -- refusals: bad_choice (+ detail), bad_max, bad_state (+ detail); no write
      begin
        rw := pg_temp.vrow(${T(7)});
        x := hunt_v2_act(${T(7)}, '{"use": 5}'::jsonb);
        y := hunt_v2_auto(${T(7)}, 0);
        row0 := row0 || jsonb_build_object('bad_choice', x->>'error' = 'bad_choice' and x->>'detail' is not null and (pg_temp.vrow(${T(7)})).state = rw.state,
          'bad_max', y->>'error' = 'bad_max' and (pg_temp.vrow(${T(7)})).state = rw.state);
        update hunt_v2_days set state = jsonb_set(state, '{fight,v}', '3') where player_id = ${T(7)} and day = hunt_v2_today();
        x := hunt_v2_act(${T(7)}, e); y := hunt_v2_auto(${T(7)}, 3);
        row0 := row0 || jsonb_build_object('bad_state', x->>'error' = 'bad_state' and x->>'detail' is not null and y->>'error' = 'bad_state'
          and (pg_temp.vrow(${T(7)})).state->'fight'->'v' = '3'::jsonb);
        raise exception 'r3a_rollback';
      exception when others then if sqlerrm <> 'r3a_rollback' then row0 := row0 || jsonb_build_object('raised_ref', sqlerrm); end if;
      end;
      out := out || jsonb_build_array(row0);
      raise exception 'r3a_rollback';
    exception when others then if sqlerrm <> 'r3a_rollback' then out := out || jsonb_build_array(jsonb_build_object('seed', i, 'raised', sqlerrm)); end if;
    end;
  end loop;
  res := out;
`, 'j int;');

// ---------------------------------------------------------------------------------------------------------- B4: H2 (no shared write), H9 (the end)
const B4 = block(String.raw`
  create function pg_temp.snap() returns jsonb language plpgsql as $x$
  declare out jsonb := '{}'; tb text; v jsonb;
  begin
    for tb in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'hunt_v2_days' order by 1 loop
      execute format('select jsonb_build_array(count(*), md5(coalesce(string_agg(t::text, %L order by t::text), %L))) from public.%I t', '|', '', tb) into v;
      out := out || jsonb_build_object(tb, v);
    end loop;
    return out;
  end $x$;
  -- H2 INV-2 a full Auto day (start, act, auto to the end, view)
  before := pg_temp.snap(); hb := (select to_jsonb(h) from hunts h where h.id = hid);
  a := hunt_v2_start(${T(8)}, sq);
  x := hunt_v2_act(${T(8)}, pg_temp.autoc(a->'fight'));
  y := hunt_v2_auto(${T(8)}, 1000);
  o := hunt_v2_view(${T(8)});
  after := pg_temp.snap(); ha := (select to_jsonb(h) from hunts h where h.id = hid);
  rw := pg_temp.vrow(${T(8)});
  ${add('H2 the full Auto day ran: start ok, act ok, auto to the end (the row is over), view ok', `(a->>'ok')::boolean and (x->>'ok')::boolean and (y->>'ok')::boolean and rw.status = 'over' and (o->>'ok')::boolean`,
    `jsonb_build_object('start', a->'error', 'act', x->'error', 'auto', y->'error', 'ended_by', rw.ended_by)`)}
  ${add('H2 INV-2 the row count and the md5 of EVERY public table except hunt_v2_days are the same before and after the day',
    `before = after and (select count(*) from jsonb_object_keys(before)) >= 80`,
    `jsonb_build_object('tables', (select count(*) from jsonb_object_keys(before)), 'diff', (select jsonb_agg(q.key) from jsonb_each(before) q where after->q.key is distinct from q.value))`)}
  ${add('H2 INV-2 every column of the live hunts row is the same before and after (hp_remaining, status, stats, ...)', 'hb = ha', `jsonb_build_object('before', hb, 'after', ha)`)}
  -- H9 cap: v2_hunt.round_cap 5 in a sub-block
  begin
    update balance set value = jsonb_set(value, '{round_cap}', '5') where key = 'v2_hunt';
    a := hunt_v2_start(${T(9)}, sq);
    -- run 8: the squad fell in 5 steps once (squad_down). The cards and the boss get 100 x their HP, so only the cap can end the day
    update hunt_v2_days set state = jsonb_set(jsonb_set(state, '{fight,enemies,0}', (state->'fight'->'enemies'->0) || jsonb_build_object('hp', (state->'fight'->'enemies'->0->>'max')::numeric * 100, 'max', (state->'fight'->'enemies'->0->>'max')::numeric * 100)),
        '{fight,cards}', (select jsonb_object_agg(q.key, q.value || jsonb_build_object('hp', (q.value->>'max')::numeric * 100, 'max', (q.value->>'max')::numeric * 100)) from jsonb_each(state->'fight'->'cards') q))
     where player_id = ${T(9)} and day = hunt_v2_today() and status = 'active';
    if (pg_temp.vrow(${T(9)})).status = 'active' then y := hunt_v2_auto(${T(9)}, 1000); end if;
    rw := pg_temp.vrow(${T(9)});
    res := res || jsonb_build_object('case', 'H9 cap (v2_hunt.round_cap 5 in the block): the day ends over, ended_by cap, steps = 5, ended_at set',
      'ok', coalesce(rw.status = 'over' and rw.ended_by = 'cap' and rw.steps = 5 and rw.ended_at is not null, false),
      'got', jsonb_build_object('status', rw.status, 'ended_by', rw.ended_by, 'steps', rw.steps, 'start', a->'error'));
    raise exception 'r3a_rollback';
  exception when others then if sqlerrm <> 'r3a_rollback' then ${add('H9 cap: the block raised', 'false', 'to_jsonb(sqlerrm)')} end if;
  end;
  -- H9 squad_down: every card at 1 HP, the boss at 100 x its HP
  begin
    a := hunt_v2_start(${T(10)}, sq);
    update hunt_v2_days set state = jsonb_set(jsonb_set(state, '{fight,cards}', (select jsonb_object_agg(q.key, q.value || '{"hp": 1}'::jsonb) from jsonb_each(state->'fight'->'cards') q)),
        '{fight,enemies,0}', (state->'fight'->'enemies'->0) || jsonb_build_object('hp', (state->'fight'->'enemies'->0->>'max')::numeric * 100, 'max', (state->'fight'->'enemies'->0->>'max')::numeric * 100))
     where player_id = ${T(10)} and day = hunt_v2_today();
    y := hunt_v2_auto(${T(10)}, 1000);
    rw := pg_temp.vrow(${T(10)});
    res := res || jsonb_build_object('case', 'H9 squad_down (cards at 1 HP): the day ends over, ended_by squad_down',
      'ok', coalesce((y->>'ok')::boolean and rw.status = 'over' and rw.ended_by = 'squad_down' and y->>'ended_by' = 'squad_down', false),
      'got', jsonb_build_object('status', rw.status, 'ended_by', rw.ended_by, 'err', y->'error'));
    raise exception 'r3a_rollback';
  exception when others then if sqlerrm <> 'r3a_rollback' then ${add('H9 squad_down: the block raised', 'false', 'to_jsonb(sqlerrm)')} end if;
  end;
  -- H9 boss_down: the boss at 1 HP, evasion 0, no mechanics and no heal; the cards at 100 x their HP (a card hit always ends it first)
  begin
    a := hunt_v2_start(${T(11)}, sq);
    update hunt_v2_days set state = jsonb_set(jsonb_set(state, '{fight,enemies,0}', (state->'fight'->'enemies'->0) || '{"hp": 1, "evasion": 0, "mechanics": [], "healer": false}'::jsonb),
        '{fight,cards}', (select jsonb_object_agg(q.key, q.value || jsonb_build_object('hp', (q.value->>'max')::numeric * 100, 'max', (q.value->>'max')::numeric * 100)) from jsonb_each(state->'fight'->'cards') q))
     where player_id = ${T(11)} and day = hunt_v2_today();
    y := hunt_v2_auto(${T(11)}, 1000);
    rw := pg_temp.vrow(${T(11)});
    res := res || jsonb_build_object('case', 'H9 boss_down (the boss at 1 HP): the day ends over, ended_by boss_down, damage = start_hp',
      'ok', coalesce((y->>'ok')::boolean and rw.status = 'over' and rw.ended_by = 'boss_down' and rw.damage = rw.start_hp, false),
      'got', jsonb_build_object('status', rw.status, 'ended_by', rw.ended_by, 'damage', rw.damage, 'start_hp', rw.start_hp, 'err', y->'error'));
    raise exception 'r3a_rollback';
  exception when others then if sqlerrm <> 'r3a_rollback' then ${add('H9 boss_down: the block raised', 'false', 'to_jsonb(sqlerrm)')} end if;
  end;
  -- H9 hunt_over: closes_at = now() (the start of this transaction); act and auto: hunt_over, the row over, no fight call
  begin
    a := hunt_v2_start(${T(12)}, sq);
    s := (pg_temp.vrow(${T(12)})).state->'fight';
    update hunts set closes_at = now() where id = hid;
    delete from r3a_spy;
    alter function public.combat_v2_step(jsonb, jsonb, jsonb) rename to r3a_real_step;
    execute $w$create function public.combat_v2_step(p_state jsonb, p_choice jsonb, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $s$
      begin insert into r3a_spy (s, c) values (p_state, p_choice); return public.r3a_real_step(p_state, p_choice, p_b); end $s$$w$;
    x := hunt_v2_act(${T(12)}, pg_temp.autoc(s));
    y := hunt_v2_auto(${T(12)}, 3);
    rw := pg_temp.vrow(${T(12)});
    res := res || jsonb_build_object('case', 'H9 hunt_over (the Hunt closed): act answers hunt_over with no fight call; the row ends over, hunt_over, the fight unchanged; then auto: not_fighting',
      'ok', coalesce((a->>'ok')::boolean and x->>'error' = 'hunt_over' and rw.status = 'over' and rw.ended_by = 'hunt_over' and rw.state->'fight' = s
                     and y->>'error' = 'not_fighting' and (select count(*) from r3a_spy) = 0, false),
      'got', jsonb_build_object('act', x, 'auto', y->'error', 'ended_by', rw.ended_by, 'steps_called', (select count(*) from r3a_spy)));
    raise exception 'r3a_rollback';
  exception when others then if sqlerrm <> 'r3a_rollback' then ${add('H9 hunt_over: the block raised', 'false', 'to_jsonb(sqlerrm)')} end if;
  end;
  -- H9 L-4 an active row of yesterday ends abandoned at the next start, and at the next view
  insert into hunt_v2_days (hunt_id, player_id, day, boss, squad, state, start_hp) values (hid, ${T(13)}, hunt_v2_today() - 1, bk, sq, '{"engine": 2}'::jsonb, 1);
  insert into hunt_v2_days (hunt_id, player_id, day, boss, squad, state, start_hp) values (hid, ${T(14)}, hunt_v2_today() - 1, bk, sq, '{"engine": 2}'::jsonb, 1);
  a := hunt_v2_start(${T(13)}, sq);
  o := hunt_v2_view(${T(14)});
  ${add('H9 L-4 an active row of yesterday ends over, abandoned, ended_at set: at the next start',
    `(a->>'ok')::boolean and exists (select 1 from hunt_v2_days where player_id = ${T(13)} and day = hunt_v2_today() - 1 and status = 'over' and ended_by = 'abandoned' and ended_at is not null)`,
    `(select jsonb_agg(to_jsonb(q) - 'state') from hunt_v2_days q where q.player_id = ${T(13)})`)}
  ${add('H9 L-4 ... and at the next view',
    `(o->>'ok')::boolean and exists (select 1 from hunt_v2_days where player_id = ${T(14)} and day = hunt_v2_today() - 1 and status = 'over' and ended_by = 'abandoned' and ended_at is not null)`,
    `(select jsonb_agg(to_jsonb(q) - 'state') from hunt_v2_days q where q.player_id = ${T(14)})`)}
`, 'before jsonb; after jsonb; hb jsonb; ha jsonb;');

// ---------------------------------------------------------------------------------------------------------- B5: H11 the view
const B5 = block(String.raw`
  begin
    update hunts set status = 'expired' where id = hid;
    x := hunt_v2_view(${T(15)});
    res := res || jsonb_build_object('case', 'H11 no active Hunt: hunt null, boss null, can_start false (tester true)',
      'ok', coalesce((x->>'ok')::boolean and x->'hunt' = 'null'::jsonb and x->'boss' = 'null'::jsonb and not (x->>'can_start')::boolean and (x->>'tester')::boolean, false), 'got', x);
    raise exception 'r3a_rollback';
  exception when others then if sqlerrm <> 'r3a_rollback' then ${add('H11 no hunt: the block raised', 'false', 'to_jsonb(sqlerrm)')} end if;
  end;
  x := hunt_v2_view(${T(15)});
  ${add('H11 no row: can_start true; hunt = {id, name, tier, closes_at, live_frac = hp_remaining / hp_max = 0.4}; boss = hunt_boss_v2_card; day null',
    `(x->>'can_start')::boolean and (x->'hunt'->>'id')::bigint = hid and x->'hunt'->>'tier' = 'Heroic' and x->'hunt'->>'name' = 'The ' || bn
     and (x->'hunt'->>'live_frac')::numeric = (select hp_remaining::numeric / hp_max from hunts where id = hid) and (x->'hunt'->>'live_frac')::numeric = 0.4
     and x->'boss' = hunt_boss_v2_card(bk, 'Heroic') and x->'day' = 'null'::jsonb and x ? 'hunt' and (x->'hunt' ? 'closes_at')`, `x - 'boss'`)}
  a := hunt_v2_start(${T(15)}, sq);
  x := hunt_v2_view(${T(15)});
  rw := pg_temp.vrow(${T(15)});
  ${add('H11 an active row: can_start false; day.status active; the screen fields = dungeon_v2_screen of the saved fight; the fight, units and info',
    `not (x->>'can_start')::boolean and x->'day'->>'status' = 'active' and x->'fight' = rw.state->'fight'
     and x->'order' = dungeon_v2_screen(rw.state->'fight')->'order' and x->'need' = dungeon_v2_screen(rw.state->'fight')->'need'
     and x->'targets' = '[0]'::jsonb and x->'squad_hp' = dungeon_v2_screen(rw.state->'fight')->'squad_hp' and x->'units' = rw.state->'units' and x->'info' = rw.state->'info'
     and (x->'hunt'->>'live_frac')::numeric = 0.4`,
    `x - 'fight' - 'units' - 'info' - 'boss' - 'order' - 'status_lines'`)}
  update hunt_v2_days set status = 'over', ended_by = 'cap', ended_at = now() where player_id = ${T(15)};
  x := hunt_v2_view(${T(15)});
  ${add('H11 an over row: can_start false; day.status over, day.ended_by cap; no screen fields', `not (x->>'can_start')::boolean and x->'day'->>'ended_by' = 'cap' and x->'day'->>'status' = 'over' and not (x ? 'order')`, `x - 'boss'`)}
  x := hunt_v2_view(${O(2)});
  ${add('H11 a non-tester: tester false, can_start false (the hunt is shown)', `x->>'tester' = 'false' and not (x->>'can_start')::boolean and (x->'hunt'->>'id')::bigint = hid`, `x - 'boss'`)}
`);

// ---------------------------------------------------------------------------------------------------------- H3: no lock on the boss row (two real connections)
const H3P = Array.from({ length: 4 }, (_, i) => id('035', i + 1));
const H3MARK = '["r3a_h3_sample"]';
const BY = 'r3a-h3-test';
async function q(sql) {
  const t = await rawQuery(sql);
  let j; try { j = JSON.parse(t); } catch { return { error: t }; }
  if (!Array.isArray(j)) return { error: j.message || j.error || t };
  return { rows: j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dropR3 = String.raw`
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'hunt\_v2\_%' loop execute 'drop function ' || f; end loop;
  drop table if exists public.hunt_v2_days;`;
// final: false = the cleanup before the run (the file stays); true = the end of the run: drop the R3 objects, then apply the clean file when it was applied before
const h3Cleanup = (final, restoreClean) => String.raw`do $h3$
declare f text; tb text;
begin
  perform set_config('balance.by', '${BY}', true);
  update public.balance set value = jsonb_set(value, '{testers}', coalesce((select jsonb_agg(t) from jsonb_array_elements(value->'testers') t where not (t #>> '{}') = any(array[${H3P.map(lit).join(', ')}])), '[]'::jsonb))
   where key = 'combat_v2';
  delete from public.balance_log where changed_by = '${BY}';
  if to_regclass('public.hunt_v2_days') is not null then delete from public.hunt_v2_days where player_id = any(array[${H3P.map(lit).join(', ')}]); end if;
  for tb in select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
             where c.table_schema = 'public' and c.column_name = 'player_id' and t.table_type = 'BASE TABLE' and c.table_name <> 'players' loop
    execute format('delete from public.%I where player_id = any(%L::text[])', tb, array[${H3P.map(lit).join(', ')}]);
  end loop;
  delete from public.hunt_hits where hunt_id in (select id from public.hunts where weak_points = '${H3MARK}'::jsonb);
  delete from public.hunts where weak_points = '${H3MARK}'::jsonb;
  delete from public.players where id = any(array[${H3P.map(lit).join(', ')}]);
  if to_regprocedure('public.r3a_h3_synstub()') is not null then
    drop function public.combat_v2_synergy(jsonb, jsonb); drop function public.r3a_h3_synstub();
  end if;
  ${final ? dropR3 : ''}
end $h3$;
${final && restoreClean ? restoreClean : ''}`;

async function runH3() {
  const out = [];
  const add3 = (name, ok, got) => out.push({ name, ok, got });
  // the state of the copy before the run: was the file applied, and does the table hold a row of a real player?
  const st = await q(`select to_regclass('public.hunt_v2_days') is not null as applied;`);
  if (st.error) { add3(`H3 the state of the copy could be read (${String(st.error).slice(0, 200)})`, false, null); return out; }
  const applied = st.rows[0].applied;
  const rr = applied ? await q(`select count(*)::int n from public.hunt_v2_days where player_id <> all(array[${H3P.map(lit).join(', ')}]);`) : { rows: [{ n: 0 }] };
  if (rr.error) { add3(`H3 the practice rows could be counted (${String(rr.error).slice(0, 200)})`, false, null); return out; }
  const realRows = Number(rr.rows[0].n);
  if (realRows > 0) { add3('H3 the copy has no practice row of a real player (the run drops the table)', false, { realRows }); return out; }
  const sh0 = await q(SHAPE);
  if (sh0.error) { add3(`H3 the hunt_v2_ objects could be read (${String(sh0.error).slice(0, 200)})`, false, null); return out; }
  const onApplied = sh0.rows[0].on_applied;
  const hbpApplied = sh0.rows[0].hbp_applied;
  const outApplied = sh0.rows[0].out_applied;
  const nativeApplied = sh0.rows[0].native_applied;
  const restore = applied ? CLEAN + (onApplied && nativeApplied ? '\n' + V1_ORIGIN : '') + (onApplied ? '\n' + ON_FILE : '') + (onApplied && hbpApplied ? '\n' + HBP_FILE : '') + (onApplied && outApplied ? '\n' + OUT_FILE : '') + (onApplied && hbpApplied && nativeApplied ? '\n' + NATIVE_FILE : '') : null;
  const T3 = (i) => lit(H3P[i - 1]);
  let squad;
  try {
    const pre = await q(h3Cleanup(false));
    if (pre.error) throw new Error('cleanup: ' + pre.error);
    // the sample (committed): the file under test, 4 testers with 6 cards each, one active Hunt of a mapped boss, tester 1 has a day
    const setup = await q(String.raw`do $h3$
declare f text; bn text; sq bigint[];
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', '${BY}', true);
  ${dropR3}
  if to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is null then
    execute 'create function public.combat_v2_synergy(p_state jsonb, p_b jsonb) returns jsonb language sql immutable as ''select p_state''';
    execute 'create function public.r3a_h3_synstub() returns void language sql as ''select null''';
  end if;
  execute $m$${H3_MUTS.includes(process.env.MUTATE) ? mig : CLEAN}$m$;
  sq := array(select c.id from cards c join subjects s on s.id = c.subject_id
               where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from roles x where x.key = s.ability_v2->>'role')
                 and c.rarity::text = 'normal' order by s.type in ('Character', 'Creature') desc, c.id limit 6);
  insert into public.players (id, username) select z, 'r3a h3 ' || z from unnest(array[${H3P.map(lit).join(', ')}]) z;
  insert into public.player_cards (player_id, card_id, quantity, first_source) select p, c, 1, 'admin' from unnest(array[${H3P.map(lit).join(', ')}]) p, unnest(sq) c;
  update public.balance set value = jsonb_set(value, '{testers}', (value->'testers') || ${lit(JSON.stringify(H3P))}::jsonb) where key = 'combat_v2';
  select x.name into bn from hunt_bosses_v2 x order by x.ord limit 1;
  insert into public.hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || bn, 'Heroic', '${H3MARK}'::jsonb, 80000, 32000, now() + interval '1 hour', now() + interval '2 days', 'active');
end $h3$;
select (select id from public.hunts where weak_points = '${H3MARK}'::jsonb) as hunt,
       (select array_agg(card_id order by card_id) from public.player_cards where player_id = ${T3(1)}) as squad,
       hunt_v2_start(${T3(1)}, (select array_agg(card_id order by card_id) from public.player_cards where player_id = ${T3(1)})) as start1;`);
    if (setup.error) throw new Error('setup: ' + setup.error);
    const H = setup.rows[0].hunt; squad = setup.rows[0].squad; const s1 = setup.rows[0].start1;
    add3('H3 the sample: a committed active Hunt (opens_at newest), tester 1 started its day (ok, active)', H != null && s1?.ok === true && s1?.status === 'active', { hunt: H, start1: s1?.ok ? 'ok' : s1 });
    const SQ = `'{${squad.join(',')}}'::bigint[]`;
    const timeoutCte = "with z as materialized (select set_config('lock_timeout', '500ms', true) v)";
    // The time limit reads the SERVER time of B's statement (clock_timestamp - statement_timestamp): a lock wait is inside it, the wait of the
    // local proxy for a pooled connection is not (run 5: a plain select 1 took 5282 ms on the client while it opened a new connection).
    const timed = (call) => `/* r3a_h3_B */ ${timeoutCte}, s as materialized (select ${call} r from z) select s.r, round(extract(epoch from clock_timestamp() - statement_timestamp()) * 1000)::int as server_ms, clock_timestamp() as b_end from s;`;
    // A lock case (run 5: A had not taken the lock yet when B ran, because A waited for a pooled connection). A holds the hunts row FOR UPDATE for
    // 6 s; B starts only when A is SEEN holding it (A sleeping after its FOR UPDATE, with an xid); the case asserts that A still held it when B
    // ended; a third connection samples the wait events of B (the evidence of a lock wait, or of none).
    // The warm-up (as fight-timing.mjs drops its first call): 4 parallel rolled-back calls of the start and the act, so that the pooled
    // backends have the engine functions compiled (run 6: a cold backend took 40.7 s of CPU for one act; the same act takes 32-47 ms warm).
    const warm = () => Promise.all([1, 2, 3, 4].map(() => rawQuery(`do $h3$ begin perform hunt_v2_act(${T3(1)}, '{"use": false, "target": {"side": "enemy", "id": 0}}'::jsonb); perform hunt_v2_start(${T3(3)}, ${SQ}); raise exception 'r3a_warm'; end $h3$;`)));
    const lockCase = async (call) => {
      await warm();
      const A = q(`/* r3a_h3_A */ do $h3$ begin perform 1 from public.hunts where id = ${H} for update; perform pg_sleep(6); end $h3$; select clock_timestamp() as a_end;`);
      const held = await q(String.raw`do $h3$
declare k int := 0;
begin
  loop
    perform pg_stat_clear_snapshot();
    exit when exists (select 1 from pg_stat_activity a where a.pid <> pg_backend_pid() and a.wait_event = 'PgSleep' and a.backend_xid is not null and a.query like '%/* r3a_h3_A */%');
    k := k + 1;
    if k > 300 then raise exception 'A did not hold the lock within 15 s'; end if;
    perform pg_sleep(0.05);
  end loop;
end $h3$;
select clock_timestamp() as held_at;`);
      const S = rawQuery(String.raw`do $h3$
declare ev text[] := '{}'; e text; k int;
  seen int := 0; gone int := 0;
begin
  for k in 1 .. 1200 loop
    perform pg_stat_clear_snapshot();
    e := null;
    for e in select coalesce(a.wait_event_type, 'cpu') || ':' || coalesce(a.wait_event, '-') from pg_stat_activity a where a.pid <> pg_backend_pid() and a.query like '%/* r3a_h3_B */%' and a.state = 'active' loop
      if not e = any(ev) then ev := ev || e; end if;
    end loop;
    if e is not null then seen := seen + 1; gone := 0; else gone := gone + 1; end if;
    exit when seen > 0 and gone >= 10;
    perform pg_sleep(0.05);
  end loop;
  raise exception 'RESULT:%', array_to_string(ev, ' ');
end $h3$;`).then((t) => { const i = t.indexOf('RESULT:'); return i < 0 ? `? ${t.slice(0, 120)}` : t.slice(i + 7).split(/["\\\n]/)[0]; });
      const tb = Date.now();
      const B = await q(timed(call));
      const client = Date.now() - tb; const a = await A; const waits = await S;
      const ms = Number(B.rows?.[0]?.server_ms ?? 1e9);
      const stillHeld = !!(B.rows?.[0]?.b_end && a.rows?.[0]?.a_end && new Date(a.rows[0].a_end) > new Date(B.rows[0].b_end));
      return { B, a, ms, client, waits, held: !held.error, stillHeld, r: B.rows?.[0]?.r };
    };
    // the reference (review r3 L-1): the same two-connection pattern with NO lock: A sleeps 2 s, B starts tester 4 0.3 s later
    const A0 = q(`select pg_sleep(2) as done;`);
    await sleep(300);
    const t0 = Date.now();
    const ref = await q(timed(`hunt_v2_start(${T3(4)}, ${SQ})`));
    const tRef = Number(ref.rows?.[0]?.server_ms ?? 1e9); const tRefClient = Date.now() - t0;
    await A0;
    add3(`H3 reference: the start of tester 4 with no lock held: ok (server ${tRef} ms, client ${tRefClient} ms)`, ref.rows?.[0]?.r?.ok === true, ref.error || ref.rows?.[0]?.r?.error);
    // a: A holds the boss row for update 2 s; B (tester 1) acts
    {
      const { B, a, ms, client, waits, held, stillHeld, r } = await lockCase(`hunt_v2_act(${T3(1)}, '{"use": false, "target": {"side": "enemy", "id": 0}}'::jsonb)`);
      add3(`H3 a: A holds the hunts row FOR UPDATE (seen held, still held when B ended: ${stillHeld}); B hunt_v2_act (lock_timeout 500 ms): no lock error, ok, ends in ${ms} ms server time (< 1000; client ${client} ms; B wait events: ${waits || 'none'})`,
        held && stillHeld && !B.error && r?.ok === true && ms < 1000 && !a.error, B.error ? `raised: ${String(B.error).slice(0, 200)}` : { ms, client, held, stillHeld, waits, r: r?.ok ? 'ok' : r });
    }
    // b: A holds the boss row for update 2 s; B (tester 2, no row today) starts
    {
      const { B, a, ms, client, waits, held, stillHeld, r } = await lockCase(`hunt_v2_start(${T3(2)}, ${SQ})`);
      const row = await q(`select count(*)::int n from public.hunt_v2_days where player_id = ${T3(2)} and hunt_id = ${H};`);
      const lim = 1000;   // SPEC v3 H3: "b: the same" as a (B ends < 1 s); the no-lock reference is printed as a record only
      add3(`H3 b: A holds the hunts row FOR UPDATE (seen held, still held when B ended: ${stillHeld}); B hunt_v2_start of a second tester (lock_timeout 500 ms): no lock error, ok, a new row, ends in ${ms} ms server time (< 1000; the no-lock start: ${tRef} ms; client ${client} ms; B wait events: ${waits || 'none'})`,
        held && stillHeld && !B.error && r?.ok === true && row.rows?.[0]?.n === 1 && ms < lim && !a.error, B.error ? `raised: ${String(B.error).slice(0, 200)}` : { ms, lim, client, held, stillHeld, waits, r: r?.ok ? 'ok' : r, rows: row.rows?.[0]?.n });
    }
    // c: B (tester 3) holds an open hunt_v2_start transaction after its ok answer; A takes the boss row FOR UPDATE NOWAIT
    {
      const B = q(`with a as materialized (select hunt_v2_start(${T3(3)}, ${SQ}) r) select a.r, pg_sleep(3) from a;`);
      // A waits until B's transaction has written (an xid: the insert of its row), then tries the lock with NOWAIT
      const A = await q(String.raw`do $h3$
declare k int := 0;
begin
  loop
    perform pg_stat_clear_snapshot();   -- pg_stat_activity is a snapshot for the whole transaction: read it again each time
    exit when exists (select 1 from pg_stat_activity a where a.pid <> pg_backend_pid() and a.backend_xid is not null and a.query like '%hunt_v2_start(''${H3P[2]}''%');
    k := k + 1;
    if k > 200 then raise exception 'B did not write within 10 s'; end if;
    perform pg_sleep(0.05);
  end loop;
end $h3$;
select 1 as locked from public.hunts where id = ${H} for update nowait;`);
      const b = await B;
      const row = await q(`select count(*)::int n from public.hunt_v2_days where player_id = ${T3(3)} and hunt_id = ${H};`);
      add3('H3 c: B holds an open hunt_v2_start transaction after its insert; A takes the hunts row FOR UPDATE NOWAIT: A succeeds; B ok and its row exists',
        !A.error && A.rows?.[0]?.locked === 1 && b.rows?.[0]?.r?.ok === true && row.rows?.[0]?.n === 1,
        { a: A.error ? `A raised: ${String(A.error).slice(0, 200)}` : A.rows?.[0], b: b.error ? String(b.error).slice(0, 300) : (b.rows?.[0]?.r?.ok ? 'ok' : b.rows?.[0]?.r), rows: row.rows?.[0]?.n });
    }
  } catch (err) {
    add3(`H3 the test ran (${String(err.message).slice(0, 300)})`, false, null);
  } finally {
    const c = await q(h3Cleanup(true, restore));
    const left = await q(`select (select count(*) from public.players where id = any(array[${H3P.map(lit).join(', ')}])) + (select count(*) from public.hunts where weak_points = '${H3MARK}'::jsonb)
      + (select count(*) from public.balance_log where changed_by = '${BY}') + (select count(*) from public.balance where key = 'combat_v2' and value->'testers' ?| array[${H3P.map(lit).join(', ')}])
      + (select count(*) from pg_proc where proname = 'r3a_h3_synstub') n,
      to_regclass('public.hunt_v2_days') is not null as applied_after;`);
    const sh1 = await q(SHAPE);
    add3(`H3 the copy keeps its hunt_v2_ objects, hunt_attack and hunt_support (the md5 of every function, the hunt_v2_days columns) as before the run${onApplied ? ' (R3-ON was applied: applied again)' : ''}${nativeApplied ? ' (hunt_v2_native_units.sql was applied: applied again)' : ''}`,
      !sh1.error && sh1.rows?.[0]?.shape === sh0.rows[0].shape, sh1.error || { on_before: onApplied, on_after: sh1.rows?.[0]?.on_applied, same: sh1.rows?.[0]?.shape === sh0.rows[0].shape, native_before: nativeApplied, native_after: sh1.rows?.[0]?.native_applied });
    add3(`H3 the cleanup removed every sample row (players, cards, the Hunt row, balance_log, the tester entries) and left the file ${applied ? 'applied (the clean file again)' : 'not applied'} as before`,
      !c.error && Number(left.rows?.[0]?.n) === 0 && left.rows?.[0]?.applied_after === applied, c.error || left.rows?.[0]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------- run
let fail = 0, total = 0, waits = 0, synOn = null;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const show = (rows) => { for (const r of rows) { const { case: name, ok, wait: w, ...rest } = r; if (w) { waits++; console.log(`WAIT ${name} (SYN not on the copy)`); continue; } say(ok, name, JSON.stringify(rest).slice(0, 900)); } };
const run = async (label, sql) => {
  try { const j = JSON.parse(await runBlock(sql)); if (synOn === null) synOn = j.syn; return j.rows; }
  catch (e) { say(false, `${label}: the test block raised (the file did not apply?)`, String(e.message).slice(0, 1500)); return null; }
};
const r1 = await run('B1', B1); if (r1) show(r1);
console.log(`     SYN on the copy: ${synOn ? 'yes' : 'no (a stand-in combat_v2_synergy that returns the state; H5b WAIT)'}`);
const r2 = await run('B2', B2); if (r2) show(r2);
const rows3 = [];
const CH = 10;
for (let a = 1; a <= FIGHTS; a += CH) { const r = await run(`B3 ${a}`, B3(a, Math.min(FIGHTS, a + CH - 1))); if (r) rows3.push(...r); }
const f3 = rows3.filter((r) => !r.skip && !r.raised);
const bad = (k) => f3.filter((r) => r[k] !== true);
say(f3.length >= FIGHTS - 2 && rows3.every((r) => !r.raised && !r.raised_auto) && bad('auto').length === 0,
  `H8 on ${f3.length} seeded days at live frac 0.4: hunt_v2_auto(1000) log, event, card turns and the saved fight = the replay of combat_v2_auto + combat_v2_step with the same fight and seed (${f3.reduce((s, r) => s + (r.n || 0), 0)} card turns; ends ${JSON.stringify(f3.reduce((o, r) => { const k = r.ended_by || r.end; o[k] = (o[k] || 0) + 1; return o; }, {}))})`,
  JSON.stringify(rows3.filter((r) => r.raised || r.raised_auto || r.auto !== true).slice(0, 2)).slice(0, 1200));
say(f3.length > 0 && bad('start').length === 0, 'H8 M-3 at the start: start_hp = the v2 boss max x 0.4; damage = start_hp - the boss hp (answer and row)', JSON.stringify(bad('start').slice(0, 2)));
say(f3.length > 0 && bad('dmg').length === 0 && bad('dmg3').length === 0 && bad('dmga').length === 0,
  'H8 M-3 at every call (act, auto 3, auto 1000): damage = start_hp - the boss hp (answer and row); steps = the fight clock', JSON.stringify(f3.filter((r) => !r.dmg || !r.dmg3 || !r.dmga).slice(0, 2)));
say(f3.length > 0 && bad('over').length === 0, 'H8 the end of each day: status over, ended_by = cap / boss_down / squad_down from the last step', JSON.stringify(bad('over').slice(0, 2)));
say(f3.length > 0 && bad('auto3').length === 0 && f3.every((r) => !r.raised_auto3), 'H8 hunt_v2_auto(p, 3) = the replay of up to 3 card turns (log, saved fight, auto list)', JSON.stringify(f3.filter((r) => r.auto3 !== true).slice(0, 2)).slice(0, 800));
say(f3.length > 0 && bad('act').length === 0, 'H8 hunt_v2_act = one combat_v2_step with the same choice and seed (log, event, the saved fight)', JSON.stringify(bad('act').slice(0, 2)).slice(0, 800));
say(f3.length > 0 && bad('bad_choice').length === 0 && bad('bad_max').length === 0 && bad('bad_state').length === 0,
  'H8 a bad choice: bad_choice + detail, auto(p, 0): bad_max, a broken saved fight: bad_state + detail (act and auto); no write', JSON.stringify(f3.filter((r) => !r.bad_choice || !r.bad_max || !r.bad_state).slice(0, 2)).slice(0, 800));
const r4 = await run('B4', B4); if (r4) show(r4);
const r5 = await run('B5', B5); if (r5) show(r5);
if (RUN_H3) { for (const r of await runH3()) say(r.ok, r.name, String(JSON.stringify(r.got ?? null)).slice(0, 600)); }
else console.log('SKIP H3 (H3=0): NOT a gate result');
const waitTxt = waits ? `; ${waits} WAIT for SYN (not a gate result for H5b)` : '';
console.log(fail ? `${fail} of ${total} FAILED${waitTxt}` : `PASS all ${total}${waitTxt}${RUN_H3 ? '' : '; H3 skipped'}`);
process.exitCode = fail ? 1 : 0;
