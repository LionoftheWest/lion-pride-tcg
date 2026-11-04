import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_dungeon_run.sql (combat v2 step R2a: the v2 Dungeon run for testers; plan 20.18 R2,
 * pipeline item R2 SPEC v3, gate G1, cases D1-D12). NO lasting change: every request is one DO block, undone by its final RAISE.
 * Each block first drops the R2 objects (the dungeon_v2_ functions and the table dungeon_v2_runs), then runs the file, so the test passes
 * before and after the file is applied. Nothing is printed about a real member (the test members are made in the block).
 * SYN: the file calls combat_v2_synergy (SYN). When the copy has no SYN, each block makes a stand-in that returns the state unchanged, and
 * the SYN cases (D4b tags, D5b) and the SYN mutations print WAIT: the run is then NOT a gate result for them.
 *   LOCALDB=1 LOCALDB_ENV=... LOCALDB_LOCK_DIR=... node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-dungeon-run.mjs   must PASS
 *   MUTATE=<name> ...   must FAIL, for every name in MUT below
 *   MUTATE=all ...      the baseline (must PASS), then every mutation (each must FAIL); FAILS when a mutation named in the spec is missing
 *   FIGHTS=<n> ...      the seeded fights of D7 (default 20, the spec number)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-dungeon-run.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n') : read('../../tcg-bot/supabase/combat_v2_dungeon_run.sql');
mig = mig.replace(/notify pgrst[^\n]*\n/g, '');
const FIGHTS = Number(process.env.FIGHTS || 20);

// ---------------------------------------------------------------------------------------------------------- the mutations
const END13 = '-- ============================================================ 13. server only';
const SYN_CALL = '  s := combat_v2_synergy(s, b);\n';
const MUT = {
  // D1
  tester_ignored: ["  if not combat_v2_on('dungeon', p_player) then return jsonb_build_object('ok', false, 'error', 'not_tester'); end if;\n", ''],
  flag_on: [END13, "update public.balance set value = jsonb_set(value, '{dungeon}', 'true') where key = 'combat_v2';\n" + END13],
  v1_touched: [END13, "do $v$ begin execute replace(pg_get_functiondef('public.dungeon_start(text, bigint[])'::regprocedure), 'One run at a time', 'One run at a time (r2a)'); end $v$;\n" + END13],
  // D2
  budget_literal: ['  if v_cost > v_budget then', '  if v_cost > 12 then'],
  rule_budget_ignored: ["  v_budget := coalesce((d.rule->>'budget')::int, balance_num('dungeon', 'budget')::int);", "  v_budget := balance_num('dungeon', 'budget')::int;"],
  rule_skipped: ["    if d.rule ? 'types' and not (d.rule->'types' ? (c->>'type')) then return jsonb_build_object('ok', false, 'error', 'rule', 'card', x); end if;\n", ''],
  attacker_check_removed: ["  if v_att = 0 then return jsonb_build_object('ok', false, 'error', 'no_attacker'); end if;\n", ''],
  // D3
  d2_fallback: ["  if cardinality(bad) > 0 then return jsonb_build_object('ok', false, 'error', 'no_v2', 'cards', to_jsonb(bad)); end if;", '  if cardinality(bad) > 0 then return dungeon_start(p_player, p_cards); end if;'],
  no_v2_list_empty: ["'error', 'no_v2', 'cards', to_jsonb(bad))", "'error', 'no_v2', 'cards', '[]'::jsonb)"],
  // D4
  stars_zero: ['  cc := card_combat_v2(r.rarity, r.stars, r.cp_mod,', '  cc := card_combat_v2(r.rarity, 0, r.cp_mod,'],
  meter_zero: [["'status', '{}'::jsonb, 'meter', round((random() * act)::numeric, 2)));", "'status', '{}'::jsonb, 'meter', 0));"],
    ["    en := en || jsonb_build_array(fo->i || jsonb_build_object('meter', round((random() * act)::numeric, 2),", "    en := en || jsonb_build_array(fo->i || jsonb_build_object('meter', 0,"]],
  meter_not_rounded: ["'status', '{}'::jsonb, 'meter', round((random() * act)::numeric, 2)));", "'status', '{}'::jsonb, 'meter', (random() * act)::numeric));"],
  run_in_dungeon_runs: ['  insert into dungeon_v2_runs (player_id, day, squad, state, attempt)', '  insert into dungeon_runs (player_id, day, squad, state, attempt)'],
  // D4b (SYN)
  tags_dropped: ["  return u || jsonb_build_object('atk', cc->'stats'->'atk',", "  return (u - 'tags') || jsonb_build_object('atk', cc->'stats'->'atk',"],
  // D5
  door_list_gauntlet: ["dungeon_enter(jsonb_build_object('mode', 'daily', 'cards', '{}'::jsonb),", "dungeon_enter(jsonb_build_object('mode', 'gauntlet', 'cards', '{}'::jsonb),"],
  treasure_loot: ["    st := st || jsonb_build_object('room_type', 'treasure', 'phase', 'pass',", "    st := st || jsonb_build_object('room_type', 'treasure', 'chest', jsonb_build_object('tier', 1, 'shards', 5), 'phase', 'pass',"],
  gamble_always_pass: ["then 'treasure' else 'elite' end; end if;", "then 'treasure' else 'treasure' end; end if;"],
  rest_swapped: [["balance_num('dungeon', 'rest_revive')", "balance_num('dungeon', 'REST_X')"], ["balance_num('dungeon', 'rest_heal')", "balance_num('dungeon', 'rest_revive')"],
    ["balance_num('dungeon', 'REST_X')", "balance_num('dungeon', 'rest_heal')"]],
  // D5b (SYN; review r3 L-1: two mutations that change syn replace synergy_twice and synergy_before_carry)
  no_synergy: [SYN_CALL, ''],
  synergy_before_units: [SYN_CALL, "  s := jsonb_set(s, '{cards}', (s->'cards') || coalesce(combat_v2_synergy(s || jsonb_build_object('cards', '{}'::jsonb), b)->'cards', '{}'::jsonb));\n"],
  synergy_standing_only: [SYN_CALL, "  s := jsonb_set(s, '{cards}', (s->'cards') || (combat_v2_synergy(jsonb_set(s, '{cards}', (select coalesce(jsonb_object_agg(q.key, q.value), '{}'::jsonb) from jsonb_each(s->'cards') q where combat_v2_up(q.value))), b)->'cards'));\n"],
  // D6
  loot_offer_kept: ["where z->>'kind' not in ('shards', 'card'));", 'where true);'],
  buff_all_cards: ["    if (p_state->>'empower') is not null and up->>'class' = 'attacker' then", "    if (p_state->>'empower') is not null then"],
  buff_lost_on_rest: ["    st := st || jsonb_build_object('phase', 'rest', 'offers'", "    st := (st - 'empower') || jsonb_build_object('phase', 'rest', 'offers'"],
  ward_dropped: ["    if (p_state->>'ward') is not null then", '    if false then'],
  reset_zero: ["to_jsonb((b->'v2_charge'->>(st->'units'->x->>'class'))::int)", 'to_jsonb(0)'],
  // D7
  auto_one_less: ['    for i in 1 .. p_max loop', '    for i in 1 .. p_max - 1 loop'],
  hp_reset: ["    cards := cards || jsonb_build_object(x, u || jsonb_build_object('hp', cr->'hp', 'max'", "    cards := cards || jsonb_build_object(x, u || jsonb_build_object('hp', u->'max', 'max'"],
  charge_reset: ["      'charge', cr->'charge', 'held', cr->'held', 'status'", "      'charge', u->'charge', 'held', cr->'held', 'status'"],
  status_kept: ["'held', cr->'held', 'status', '{}'::jsonb, 'meter'", "'held', cr->'held', 'status', coalesce(cr->'status', '{}'::jsonb), 'meter'"],
  act_not_caught: ["    exception when raise_exception then\n      return jsonb_build_object('ok', false, 'error', 'bad_choice', 'detail', sqlerrm);\n", ''],
  state_check_in_catch: ["  if cardinality(bad) > 0 then return jsonb_build_object('ok', false, 'error', 'bad_state', 'detail', array_to_string(bad, '; ')); end if;\n", ''],
  // D8
  v2_loot: ["  st := jsonb_build_object('engine', '2'::jsonb, 'squad',", "  st := jsonb_build_object('bank', jsonb_build_object('shards', 0, 'cards', '[]'::jsonb), 'engine', '2'::jsonb, 'squad',"],
  writes_actions: ['  update dungeon_v2_runs set state = st, turns = turns', "  insert into combat_actions (mode, ref_id, player_id, kind, game_day) values ('dungeon', r.id, p_player, 'effect', r.day);\n  update dungeon_v2_runs set state = st, turns = turns"],
  stale_not_ended: ["  update dungeon_v2_runs set status = 'over', ended_by = 'abandoned', ended_at = now() where player_id = p_player and status = 'active' and day < v_day;\n", ''],
  // D9
  count_shared: ["    from dungeon_v2_runs where player_id = p_player and day = v_day;\n  if v_active > 0", "    from (select attempt, status from dungeon_v2_runs where player_id = p_player and day = v_day union all select attempt, status from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily') q;\n  if v_active > 0"],
  // D10
  play_reads_table: ['  b := coalesce(p_b, combat_v2_enemy_numbers());\n  bad := fight_state_check_v2(f);', '  b := coalesce(p_b, combat_v2_enemy_numbers());\n  perform 1 from dungeon_v2_runs limit 1;\n  bad := fight_state_check_v2(f);'],
  hp_changes_one_way: ["  where q.b->'hp' is distinct from q.a->'hp' or coalesce((q.b->>'down')::boolean, false) is distinct from coalesce((q.a->>'down')::boolean, false) or q.sb <> q.sa;", "  where q.b->'hp' is distinct from q.a->'hp';"],
  steps_from_dungeon_cap: ["'actor', r->'actor', 'steps_left', r->'steps_left',\n    'played', played", "'actor', r->'actor', 'steps_left', greatest(0, (b->'v2_dungeon'->>'round_cap')::int - (r->'state'->>'clock')::int),\n    'played', played"],
  // D11
  grant_authenticated: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, authenticated', f);"],
  table_grant_anon: ['grant all on table public.dungeon_v2_runs to service_role;', 'grant all on table public.dungeon_v2_runs to service_role;\ngrant select on table public.dungeon_v2_runs to anon;'],
  comment_missing: [/comment on function public\.dungeon_v2_view\(text\) is \$cm\$[^\n]*\n/, ''],
  // D12 and INV-2
  view_counts_daily: ["  v_left := greatest(0, game_var('dungeon_runs_per_day')::int - (select count(*) from dungeon_v2_runs where player_id = p_player and day = v_day)::int);",
    "  v_left := greatest(0, game_var('dungeon_runs_per_day')::int - (select count(*) from dungeon_v2_runs where player_id = p_player and day = v_day)::int - (select count(*) from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily')::int);"],
  can_start_ignores_active: ["'can_start', v_tester and not v_active and v_left > 0)", "'can_start', v_tester and v_left > 0)"],
  act_rechecks_tester: ["  if r.state->>'phase' is distinct from 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;\n  if p_auto",
    "  if not combat_v2_on('dungeon', p_player) then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;\n  if r.state->>'phase' is distinct from 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;\n  if p_auto"],
};
// every mutation that the spec G1 table names (SPEC v3; review r3 L-1: synergy_twice and synergy_before_carry are replaced by
// synergy_before_units and synergy_standing_only, which change syn)
const NAMED = `tester_ignored flag_on v1_touched budget_literal rule_budget_ignored rule_skipped attacker_check_removed d2_fallback no_v2_list_empty
  stars_zero meter_zero run_in_dungeon_runs tags_dropped door_list_gauntlet treasure_loot gamble_always_pass no_synergy synergy_before_units
  synergy_standing_only loot_offer_kept buff_all_cards reset_zero auto_one_less hp_reset charge_reset act_not_caught v2_loot writes_actions
  count_shared play_reads_table hp_changes_one_way steps_from_dungeon_cap grant_authenticated table_grant_anon comment_missing view_counts_daily
  can_start_ignores_active`.split(/\s+/).filter(Boolean);
// the mutations that only the SYN cases can catch (D4b, D5b): WAIT while the copy has no SYN
const SYN_ONLY = ['tags_dropped', 'no_synergy', 'synergy_before_units', 'synergy_standing_only'];
const pairs = (m) => (Array.isArray(m[0]) ? m : [m]);

if (process.env.MUTATE === 'all') {
  let ok = true;
  const missing = NAMED.filter((n) => !MUT[n]);
  console.log(`named mutations of the spec G1 table: ${NAMED.length}; in MUT: ${NAMED.length - missing.length}; missing: ${missing.length ? missing.join(' ') : 'none'}`);
  if (missing.length) ok = false;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
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
if (['$m$', '$t$', '$o$', '$x$', '$w$', '$q$'].some((x) => mig.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $o$, $x$, $w$ or $q$');

// ---------------------------------------------------------------------------------------------------------- the shared SQL
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const MD5 = `md5(replace(pg_get_functiondef(p.oid), chr(13), ''))`;
const SIG = `replace(p.oid::regprocedure::text, ', ', ',')`;
const NEW = ['dungeon_v2_unit(text,bigint,jsonb)', 'dungeon_v2_needs_ally(jsonb)', 'dungeon_v2_info(bigint)', 'dungeon_v2_hp(jsonb,jsonb)',
  'dungeon_v2_play(jsonb,jsonb,integer,jsonb)', 'dungeon_v2_amounts(text,jsonb,jsonb)', 'dungeon_v2_screen(jsonb,jsonb)',
  'dungeon_v2_fight(jsonb,jsonb,integer,integer,jsonb)', 'dungeon_v2_after(jsonb,jsonb,integer,integer)', 'dungeon_v2_room(jsonb,jsonb,integer,integer,text)',
  'dungeon_v2_pick(jsonb,jsonb,integer)', 'dungeon_v2_rooms(jsonb,integer,integer,boolean)', 'dungeon_v2_out(bigint,jsonb)', 'dungeon_v2_end(bigint,text)',
  'dungeon_v2_start(text,bigint[])', 'dungeon_v2_turns(text,jsonb,boolean,integer)', 'dungeon_v2_act(text,jsonb)', 'dungeon_v2_auto(text,integer)',
  'dungeon_v2_choose(text,integer)', 'dungeon_v2_retreat(text)', 'dungeon_v2_view(text)'];
const NEW_ARR = `array[${NEW.map(lit).join(', ')}]::text[]`;
const id = (k, i) => `9000000000000${k}${String(i).padStart(2, '0')}`;   // Discord-shaped ids (17 to 20 digits; balance combat_v2 testers)
const TESTERS = Array.from({ length: 18 }, (_, i) => id('031', i + 1));
const OTHERS = Array.from({ length: 4 }, (_, i) => id('032', i + 1));
const T = (i) => lit(TESTERS[i - 1]);
const O = (i) => lit(OTHERS[i - 1]);
const D4B = [94, 99, 227, 335, 355];

// the state before the file (no R2 object; a stand-in for SYN when the copy has none), then the file, then the test world
const PRE = String.raw`
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'dungeon\_v2\_%' loop
    execute 'drop function ' || f;
  end loop;
  drop table if exists public.dungeon_v2_runs;
  syn_on := to_regprocedure('public.combat_v2_card_tags(bigint)') is not null and to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is not null;
  if to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is null then
    execute 'create function public.combat_v2_synergy(p_state jsonb, p_b jsonb) returns jsonb language sql immutable as ''select p_state''';
  end if;`;
const WORLD = String.raw`
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_r2a_admin', true);
  update settings set value = value || '{"enabled": true}' where key = 'dungeon';
  update events set status = 'cancelled', ended_at = now() where status in ('scheduled', 'live') and vars ? 'dungeon_runs_per_day';
  update balance set value = '1' where key = 'dungeon_runs_per_day' and value <> '1'::jsonb;
  perform dungeon_generate(dungeon_day());
  update dungeon_days set rule = '{}'::jsonb where day = dungeon_day();
  fl := (select floors from dungeon_days where day = dungeon_day());
  b := combat_v2_enemy_numbers();
  -- the card pools: one card per subject, with a usable ability_v2 (a role of the roles table and a list of blocks)
  create temp table r2a_pool on commit drop as
    select distinct on (c.subject_id, c.rarity) c.id, c.rarity::text as rarity, s.type in ('Character', 'Creature') as att
      from cards c join subjects s on s.id = c.subject_id
     where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from roles x where x.key = s.ability_v2->>'role')
       and c.id <> all (array[${D4B.join(', ')}]::bigint[])
     order by c.subject_id, c.rarity, c.id;
  na := array(select id from r2a_pool where att and rarity = 'normal' order by id limit 12);
  sup := array(select id from r2a_pool where not att and rarity = 'normal' order by id limit 5);
  g1 := (select id from r2a_pool where att and rarity = 'gold' order by id limit 1);
  il := array(select id from r2a_pool where att and rarity = 'illustrated_rare' order by id limit 2);
  se1 := (select id from r2a_pool where att and rarity = 'secret_rare' order by id limit 1);
  nown := (select id from r2a_pool where att and rarity = 'normal' order by id offset 12 limit 1);
  sq := na[1:4] || sup[1];
  create function pg_temp.member(p text, cs bigint[]) returns void language plpgsql as $x$
  begin
    insert into players (id, username) values (p, 'tst ' || p);
    insert into player_cards (player_id, card_id, quantity) select p, z, 1 from unnest(cs) z on conflict do nothing;
  end $x$;
  perform pg_temp.member(x, na || sup || array[g1, se1] || il || array[${D4B.join(', ')}]::bigint[]) from unnest(array[${[...TESTERS, ...OTHERS].map(lit).join(', ')}]) x;
  -- the tester list of the block = the test testers only (the list has at most 20 ids)
  update balance set value = jsonb_set(value, '{testers}', ${lit(JSON.stringify(TESTERS))}::jsonb) where key = 'combat_v2';
  -- all_true: like bool_and, but a NULL term counts as false and an empty set gives NULL (bool_and skips NULL terms)
  create function pg_temp.all_true_s(p boolean, v boolean) returns boolean language sql immutable as $x$ select coalesce(p, true) and coalesce(v, false) $x$;
  create aggregate pg_temp.all_true(boolean) (sfunc = pg_temp.all_true_s, stype = boolean);
  create temp table r2a_spy (n serial, s jsonb, c jsonb) on commit drop;
  create temp table r2a_kv (k text primary key, v jsonb) on commit drop;
  insert into r2a_kv values ('fl', fl);
  -- a call that may raise: the answer, or {raised, sqlstate}
  create function pg_temp.call(q text) returns jsonb language plpgsql as $x$
  declare a jsonb;
  begin
    execute 'select (' || q || ')::jsonb' into a; return a;
  exception when others then return jsonb_build_object('raised', sqlerrm, 'sqlstate', sqlstate);
  end $x$;
  -- a call in a sub-block that is rolled back: the answer, the v2 rows and the v1 rows of the player of today
  create function pg_temp.sub(q text, p text default null) returns jsonb language plpgsql as $x$
  declare a jsonb; out jsonb;
  begin
    begin
      execute 'select (' || q || ')::jsonb' into a;
      out := jsonb_build_object('ans', a,
        'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.attempt), '[]'::jsonb) from dungeon_v2_runs r where r.player_id = p and r.day = dungeon_day()),
        'v1rows', (select count(*) from dungeon_runs r where r.player_id = p and r.day = dungeon_day()));
      raise exception 'r2a_rollback';
    exception when others then
      if sqlerrm <> 'r2a_rollback' then out := jsonb_build_object('ans', jsonb_build_object('raised', sqlerrm, 'sqlstate', sqlstate)); end if;
    end;
    return out;
  end $x$;
  -- the spy: every input of combat_v2_step with no choice (each fight at its room start) of one call; rolled back
  create function pg_temp.spy(q text, p text default null) returns jsonb language plpgsql as $x$
  declare a jsonb; out jsonb;
  begin
    begin
      delete from r2a_spy;
      alter function public.combat_v2_step(jsonb, jsonb, jsonb) rename to r2a_real_step;
      execute $w$create function public.combat_v2_step(p_state jsonb, p_choice jsonb, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $s$
        begin insert into r2a_spy (s, c) values (p_state, p_choice); return public.r2a_real_step(p_state, p_choice, p_b); end $s$$w$;
      execute 'select (' || q || ')::jsonb' into a;
      out := jsonb_build_object('ans', a, 'f0', (select coalesce(jsonb_agg(s order by n), '[]'::jsonb) from r2a_spy where c is null or c = 'null'::jsonb),
        'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.attempt), '[]'::jsonb) from dungeon_v2_runs r where r.player_id = p and r.day = dungeon_day()),
        'v1rows', (select count(*) from dungeon_runs r where r.player_id = p and r.day = dungeon_day()));
      raise exception 'r2a_rollback';
    exception when others then
      if sqlerrm <> 'r2a_rollback' then out := jsonb_build_object('raised', sqlerrm); end if;
    end;
    return out;
  end $x$;
  -- the Auto v2 choice of the card that has the turn
  create function pg_temp.autoc(f jsonb) returns jsonb language plpgsql as $x$
  declare d jsonb := combat_v2_auto(f, f->'ext'->'turn', combat_v2_enemy_numbers(), null);
  begin return jsonb_build_object('use', d->'use', 'target', d->'target', 'ally', d->'ally'); end $x$;
  -- the state of a run between rooms (from a fight state of a start answer)
  create function pg_temp.between(st jsonb) returns jsonb language sql as $x$ select st - 'fight' - 'turn' - 'offers' - 'last' - 'phase' $x$;
  -- the v2 run row of a player (the newest of today)
  create function pg_temp.vrow(p text) returns dungeon_v2_runs language sql as $x$
    select * from dungeon_v2_runs where player_id = p and day = dungeon_day() order by attempt desc limit 1 $x$;`;
const DECL = `f text; res jsonb := '[]'; fl jsonb; b jsonb; a jsonb; a2 jsonb; r jsonb; s jsonb; s2 jsonb; x jsonb; y jsonb; e jsonb; o jsonb; st jsonb; st2 jsonb;
  rid bigint; rw record; ok boolean; ok2 boolean; n int; m int; i int; j int; t text; t2 text; msg text; v numeric; syn_on boolean;
  sq bigint[]; na bigint[]; sup bigint[]; il bigint[]; g1 bigint; se1 bigint; nown bigint; arr bigint[]`;
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
const START = (p, arr = 'sq') => `format('dungeon_v2_start(%L, %L::bigint[])', ${p}, ${arr})`;

// ---------------------------------------------------------------------------------------------------------- B1: D1 (INV-1/2), D11 (INV-5/7)
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
   where c.connamespace = 'public'::regnamespace and c.conrelid <> 'public.dungeon_v2_runs'::regclass;
  select jsonb_object_agg(c.relname, coalesce(c.relacl::text, '')), array_agg(c.relname::text order by c.relname) into acl_b, tb_b
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') and c.relname <> 'dungeon_v2_runs';
  select value into fb from public.balance where key = 'combat_v2';
  ${add('D1 INV-1 every public function that existed keeps its md5 (none is gone); the file adds exactly the 21 dungeon_v2_ functions',
    `not exists (select 1 from jsonb_each_text(md5_a) q where md5_b->>q.key is distinct from q.value)
     and (select coalesce(array_agg(q.key order by q.key), '{}') from jsonb_each_text(md5_b) q where not md5_a ? q.key) = (select array_agg(z order by z) from unnest(${NEW_ARR}) z)`,
    `jsonb_build_object('changed', (select jsonb_agg(q.key) from jsonb_each_text(md5_a) q where md5_b->>q.key is distinct from q.value),
       'added', (select jsonb_agg(q.key) from jsonb_each_text(md5_b) q where not md5_a ? q.key))`)}
  ${add('D1 INV-1 every older constraint text is the same (the new table only adds its own)', 'con_a = con_b',
    `(select jsonb_agg(q.key) from jsonb_each_text(con_a) q where con_b->>q.key is distinct from q.value)`)}
  ${add('D1 INV-1 every older table and view keeps its grants (relacl); the only new relation is dungeon_v2_runs', 'acl_a = acl_b and tb_a = tb_b',
    `(select jsonb_agg(q.key) from jsonb_each_text(acl_a) q where acl_b->>q.key is distinct from q.value)`)}
  ${add('D1 INV-2 the file does not change balance combat_v2 (the four flags and the tester list)', 'fa = fb', 'jsonb_build_object(\'before\', fa - \'testers\', \'after\', fb - \'testers\')')}
  ${WORLD}
  a := pg_temp.sub(${START(O(1))}, ${O(1)});
  ${add('D1 INV-2 a non-tester gets not_tester, and no row in dungeon_v2_runs or dungeon_runs', `a->'ans'->>'error' = 'not_tester' and a->'rows' = '[]'::jsonb and (a->>'v1rows')::int = 0`, 'a')}
  -- D11 grants, RLS, search_path, comments
  ${add('D11 INV-5 every new function: no EXECUTE for PUBLIC, anon or authenticated; EXECUTE for service_role; search_path = public; a [combat] comment that names the file',
    `(select pg_temp.all_true(not has_function_privilege('anon', z::regprocedure, 'EXECUTE') and not has_function_privilege('authenticated', z::regprocedure, 'EXECUTE')
        and not exists (select 1 from pg_proc p, aclexplode(p.proacl) q where p.oid = z::regprocedure and q.grantee = 0)
        and has_function_privilege('service_role', z::regprocedure, 'EXECUTE')
        and (select proconfig from pg_proc where oid = z::regprocedure) = array['search_path=public']
        and coalesce(obj_description(z::regprocedure, 'pg_proc'), '') like '[combat]%combat_v2_dungeon_run.sql%') from unnest(${NEW_ARR}) z)`,
    `(select jsonb_agg(z) from unnest(${NEW_ARR}) z where has_function_privilege('anon', z::regprocedure, 'EXECUTE') or has_function_privilege('authenticated', z::regprocedure, 'EXECUTE')
        or not has_function_privilege('service_role', z::regprocedure, 'EXECUTE') or coalesce(obj_description(z::regprocedure, 'pg_proc'), '') not like '[combat]%')`)}
  ${add('D11 INV-5 the table dungeon_v2_runs: RLS on, no policy, no privilege for anon or authenticated, all for service_role, a [combat] comment',
    `(select relrowsecurity from pg_class where oid = 'public.dungeon_v2_runs'::regclass)
     and not exists (select 1 from pg_policy where polrelid = 'public.dungeon_v2_runs'::regclass)
     and not has_table_privilege('anon', 'public.dungeon_v2_runs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     and not has_table_privilege('authenticated', 'public.dungeon_v2_runs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     and has_table_privilege('service_role', 'public.dungeon_v2_runs', 'SELECT') and has_table_privilege('service_role', 'public.dungeon_v2_runs', 'INSERT')
     and has_table_privilege('service_role', 'public.dungeon_v2_runs', 'UPDATE') and has_table_privilege('service_role', 'public.dungeon_v2_runs', 'DELETE')
     and coalesce(obj_description('public.dungeon_v2_runs'::regclass, 'pg_class'), '') like '[combat]%'`,
    `(select jsonb_build_object('acl', relacl::text, 'rls', relrowsecurity) from pg_class where oid = 'public.dungeon_v2_runs'::regclass)`)}
  msg := null;
  begin execute $m$${mig}$m$; exception when others then msg := sqlerrm; end;
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_c from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  ${add('D11 INV-7 the file runs a second time with no error, and every function keeps its md5', 'msg is null and md5_b = md5_c', 'to_jsonb(msg)')}
  raise exception 'RESULT:%', jsonb_build_object('syn', syn_on, 'rows', res)::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------- B2: D2 (INV-4), D3 (QD4)
const B2 = block(String.raw`
  update balance set value = jsonb_set(value, '{budget}', '9') where key = 'dungeon';
  -- the same squad checks as dungeon_start, the same codes and keys; each call in a rolled-back sub-block
  for t, arr, st in select * from (values
      ('budget 9: an input at the budget (cost 9)', array[g1] || na[1:4], '{}'::jsonb),
      ('budget 9: an input just over the budget (cost 10)', array[g1, il[1]] || na[1:3], '{}'::jsonb),
      ('day rule budget 7: an input at the budget (cost 7)', il || na[1:3], '{"budget": 7}'::jsonb),
      ('day rule budget 7: an input just over the budget (cost 8)', array[se1, il[1]] || na[1:3], '{"budget": 7}'::jsonb),
      ('size 4', na[1:4], '{}'::jsonb), ('size 6', na[1:6], '{}'::jsonb), ('a duplicate card', array[na[1]] || na[1:4], '{}'::jsonb),
      ('a card not owned', array[nown] || na[1:4], '{}'::jsonb), ('a day rule type', na[1:5], '{"types": ["NoSuchType"]}'::jsonb),
      ('a day rule no_rarity', array[g1] || na[1:4], '{"no_rarity": ["gold"]}'::jsonb), ('0 attackers (5 supports)', sup, '{}'::jsonb),
      ('a valid squad', na[1:5], '{}'::jsonb)) q loop
    update dungeon_days set rule = st where day = dungeon_day();
    a := pg_temp.sub(format('dungeon_start(%L, %L::bigint[])', ${T(1)}, arr), ${T(1)});
    a2 := pg_temp.sub(format('dungeon_v2_start(%L, %L::bigint[])', ${T(1)}, arr), ${T(1)});
    res := res || jsonb_build_object('case', 'D2 INV-4 ' || t || ': dungeon_v2_start = dungeon_start (the code and every key; both ok on a valid input)',
      'ok', coalesce(case when (a->'ans'->>'ok')::boolean then (a2->'ans'->>'ok')::boolean and jsonb_array_length(a2->'rows') = 1
                          else a2->'ans' = a->'ans' and a2->'rows' = '[]'::jsonb end, false) and a->'ans' ? 'ok',
      'got', jsonb_build_object('v1', (a->'ans') - 'state', 'v2', (a2->'ans') - 'state' - 'units' - 'info' - 'log' - 'order' - 'rooms' - 'status_lines'));
  end loop;
  update dungeon_days set rule = '{}'::jsonb where day = dungeon_day();
  -- D3 QD4: one card with no usable ability_v2
  begin
    update subjects set ability_v2 = null where id = (select subject_id from cards where id = na[3]);
    a := pg_temp.sub(format('dungeon_v2_start(%L, %L::bigint[])', ${T(2)}, na[1:5]), ${T(2)});
    ${add('D3 QD4 a squad with one card with no ability_v2: no_v2, that id (only) in cards, and no row (dungeon_v2_runs or dungeon_runs)',
      `a->'ans'->>'error' = 'no_v2' and a->'ans'->'cards' = jsonb_build_array(na[3]) and a->'rows' = '[]'::jsonb and (a->>'v1rows')::int = 0`, 'a')}
    raise exception 'r2a_rollback';
  exception when others then
    if sqlerrm <> 'r2a_rollback' then ${add('D3 the block raised', 'false', 'to_jsonb(sqlerrm)')} end if;
  end;
`);

// ---------------------------------------------------------------------------------------------------------- B3: D4, D4b, D5, D5b, D6, D7 carry
const B3 = block(String.raw`
  -- D4 the start
  update balance set value = '2' where key = 'dungeon_runs_per_day';
  insert into dungeon_v2_runs (player_id, day, squad, state, status, ended_by, attempt) values (${T(3)}, dungeon_day(), '{}', '{}', 'over', 'fell', 1);
  update player_cards set ascension = 2 where player_id = ${T(3)} and card_id = na[2];
  x := pg_temp.spy(${START(T(3))}, ${T(3)});
  a := x->'ans'; s := x->'f0'->0;
  ${add('D4 the row is in dungeon_v2_runs (attempt = the last + 1 = 2, active, the answer run id); no dungeon_runs row',
    `(a->>'ok')::boolean and jsonb_array_length(x->'rows') = 2 and (x->'rows'->1->>'attempt')::int = 2 and x->'rows'->1->>'status' = 'active'
     and (x->'rows'->1->>'id') = (a->>'run') and (x->>'v1rows')::int = 0 and a->'state'->'engine' = '2'::jsonb`, `x - 'f0' - 'ans'`)}
  ${add('D4 the floors are the dungeon_days floors of the day: floors = their count, rooms = floor 1 masked, room_type = floor 1 room 1',
    `(a->>'floors')::int = jsonb_array_length(fl) and a->'state'->>'room_type' = fl->0->0->>'type'
     and (select jsonb_agg(z->>'type' order by o) from jsonb_array_elements(a->'rooms') with ordinality q(z, o))
       = (select jsonb_agg(case when o = 1 or z->>'type' = 'guardian' then z->>'type' else 'unknown' end order by o) from jsonb_array_elements(fl->0) with ordinality q(z, o))`,
    `jsonb_build_object('floors', a->'floors', 'rooms', a->'rooms')`)}
  ${add('D4 each unit (by id) = dungeon_v2_unit of the player; the 2-star card has the card_combat_v2 stats of 2 stars (not 0); the 0-star cards = combat_v2_card_unit',
    `(select pg_temp.all_true(a->'state'->'units'->(z::text) = dungeon_v2_unit(${T(3)}, z)) from unnest(sq) z)
     and (a->'state'->'units'->(na[2]::text)->'atk') = (select card_combat_v2(c.rarity::text, 2, s0.cp_mod, 0, '{}'::jsonb, s0.ability_v2->>'role')->'stats'->'atk'
            from cards c join subjects s0 on s0.id = c.subject_id where c.id = na[2])
     and (a->'state'->'units'->(na[2]::text)->>'atk')::numeric > (combat_v2_card_unit(na[2])->>'atk')::numeric
     and (select pg_temp.all_true(a->'state'->'units'->(z::text) = combat_v2_card_unit(z)) from unnest(sq) z where z <> na[2])`,
    `jsonb_build_object('u2', a->'state'->'units'->(na[2]::text)->'atk', 'base', combat_v2_card_unit(na[2])->'atk')`)}
  ${add('D4 the meters at the room start: each in [0, act_at] with 2 decimals; the cards not all 0; the foes not all 0',
    `s is not null and (select pg_temp.all_true((z->>'meter')::numeric between 0 and (b->'v2_speed'->>'act_at')::numeric and round((z->>'meter')::numeric, 2) = (z->>'meter')::numeric)
        from (select value z from jsonb_each(s->'cards') union all select value from jsonb_array_elements(s->'enemies')) q)
     and (select bool_or((z.value->>'meter')::numeric > 0) from jsonb_each(s->'cards') z) and (select bool_or((z->>'meter')::numeric > 0) from jsonb_array_elements(s->'enemies') z)`,
    `jsonb_build_object('cards', (select jsonb_agg(z.value->'meter') from jsonb_each(s->'cards') z), 'foes', (select jsonb_agg(z->'meter') from jsonb_array_elements(s->'enemies') z))`)}
  update player_cards set ascension = 0 where player_id = ${T(3)} and card_id = na[2];
  -- D4b the unit keeps every key of combat_v2_card_unit (cards 94, 99, 227, 335, 355)
  ${add('D4b 0 stars: dungeon_v2_unit = combat_v2_card_unit, key by key, for cards 94, 99, 227, 335, 355',
    `(select pg_temp.all_true(dungeon_v2_unit(${T(3)}, z) = combat_v2_card_unit(z)) from unnest(array[${D4B.join(', ')}]::bigint[]) z)`)}
  update player_cards set ascension = 2 where player_id = ${T(3)} and card_id = any(array[${D4B.join(', ')}]::bigint[]);
  ${add('D4b 2 stars: every key outside the 12 stat keys = combat_v2_card_unit; the 12 stat keys = card_combat_v2 with 2 stars (cards 94, 99, 227, 335, 355)',
    `(select pg_temp.all_true((dungeon_v2_unit(${T(3)}, z) - array['atk','crt','crd','abl','acc','def','ddg','max','hp','spd','power','extra_stack'])
                    = (combat_v2_card_unit(z) - array['atk','crt','crd','abl','acc','def','ddg','max','hp','spd','power','extra_stack'])
        and (dungeon_v2_unit(${T(3)}, z)->>'atk')::numeric > (combat_v2_card_unit(z)->>'atk')::numeric) from unnest(array[${D4B.join(', ')}]::bigint[]) z)`)}
  if syn_on then
    ${add('D4b SYN: tags = combat_v2_card_tags(card) on the 2-star unit (cards 94, 99, 227, 335, 355)',
      `(select pg_temp.all_true(dungeon_v2_unit(${T(3)}, z) ? 'tags' and dungeon_v2_unit(${T(3)}, z)->'tags' = to_jsonb(combat_v2_card_tags(z))) from unnest(array[${D4B.join(', ')}]::bigint[]) z)`)}
  else
    ${wait('D4b SYN: tags = combat_v2_card_tags(card) on the 2-star unit (cards 94, 99, 227, 335, 355)')}
  end if;
  update player_cards set ascension = 0 where player_id = ${T(3)} and card_id = any(array[${D4B.join(', ')}]::bigint[]);
  -- the run state between rooms (a support in the squad: sup[1])
  st := pg_temp.between(a->'state');
  insert into r2a_kv values ('st', st);
  -- D5 fight kinds: the foes of gauntlet_v2_foes with show level and kind
  ok := true; n := 0; o := '[]';
  for t in select unnest(array['fight', 'horde', 'elite', 'miniboss', 'guardian']) loop
    select fi, ri into i, j from (select fi, ri from jsonb_array_elements(fl) with ordinality f1(fv, fi), jsonb_array_elements(f1.fv) with ordinality r1(rv, ri) where r1.rv->>'type' = t order by fi, ri limit 1) z;
    continue when i is null;
    x := pg_temp.spy(format('dungeon_v2_room((select v from r2a_kv where k = %L), (select v from r2a_kv where k = %L), %s, %s, null)', 'st', 'fl', i, j));
    s := x->'f0'->0; e := gauntlet_v2_foes(fl->(i - 1)->(j - 1)->'foes', i, j, b);
    ok := ok and s is not null and s->>'mode' = 'dungeon' and jsonb_array_length(s->'enemies') = jsonb_array_length(e)
      and (select pg_temp.all_true((s->'enemies'->(k - 1)) - 'meter' - 'show' = (e->(k - 1)) - 'meter' - 'show'
            and s->'enemies'->(k - 1)->'show' = (e->(k - 1)->'show') || jsonb_build_object('level', fl->(i - 1)->(j - 1)->'foes'->(k - 1)->'level', 'kind', fl->(i - 1)->(j - 1)->'foes'->(k - 1)->'kind'))
           from generate_series(1, jsonb_array_length(e)) k);
    n := n + 1; o := o || to_jsonb(t);
  end loop;
  ${add('D5 each fight kind of the day (fight, horde, elite, miniboss, guardian): the fight foes = gauntlet_v2_foes of the room, show + level + kind; mode dungeon', 'ok and n >= 4', 'o')}
  -- D5 rest
  st2 := st;
  st2 := jsonb_set(st2, array['carry', sq[1]::text, 'hp'], '10');
  st2 := jsonb_set(st2, array['carry', sq[2]::text], (st2->'carry'->(sq[2]::text)) || '{"hp": 0, "down": true}'::jsonb);
  insert into r2a_kv values ('st_hurt', st2);
  y := dungeon_v2_room(st2, '[[{"type": "rest", "foes": []}]]'::jsonb, 1, 1, null);
  ${add('D5 rest: a standing card + round(max x dungeon.rest_heal) (at most max); a down card up at greatest(1, round(max x dungeon.rest_revive)); one continue',
    `(y->'state'->'carry'->(sq[1]::text)->>'hp')::numeric = least((st2->'carry'->(sq[1]::text)->>'max')::numeric, 10 + round((st2->'carry'->(sq[1]::text)->>'max')::numeric * balance_num('dungeon', 'rest_heal')))
     and (y->'state'->'carry'->(sq[2]::text)->>'hp')::numeric = greatest(1, round((st2->'carry'->(sq[2]::text)->>'max')::numeric * balance_num('dungeon', 'rest_revive')))
     and (y->'state'->'carry'->(sq[2]::text)->>'down')::boolean = false and y->'state'->>'phase' = 'rest'
     and y->'state'->'offers' = '[{"kind": "continue"}]'::jsonb`, `y->'state'->'carry'`)}
  -- D5 choice: 2 or 3 doors of the daily list; each of the 5 daily doors over 50 seeds
  ok := true; o := '[]';
  for i in 1 .. 50 loop
    perform setseed(i / 100.0);
    y := dungeon_v2_room(st, '[[{"type": "choice", "foes": []}]]'::jsonb, 1, 1, null);
    ok := ok and y->'state'->>'phase' = 'path' and jsonb_array_length(y->'state'->'offers') between 2 and 3
      and (select pg_temp.all_true(z->>'kind' = 'door' and z->>'to' in ('elite', 'rest', 'treasure', 'horde', 'gamble')) from jsonb_array_elements(y->'state'->'offers') z);
    o := o || (select jsonb_agg(z->'to') from jsonb_array_elements(y->'state'->'offers') z);
  end loop;
  ${add('D5 choice: 2 or 3 doors of the daily list each time; each of the 5 daily doors (elite, rest, treasure, horde, gamble) over 50 seeds',
    `ok and (select count(distinct z) from jsonb_array_elements_text(o) z) = 5`, `(select jsonb_agg(distinct z) from jsonb_array_elements_text(o) z)`)}
  -- D5 treasure: an empty pass room
  y := dungeon_v2_room(st, '[[{"type": "treasure", "foes": []}]]'::jsonb, 1, 1, null);
  ${add('D5 QD1 treasure: an empty chest pass room (room_type treasure, phase pass, no chest, no bank or pend, one continue)',
    `y->'state'->>'room_type' = 'treasure' and y->'state'->>'phase' = 'pass' and not (y->'state' ? 'chest') and not (y->'state' ? 'bank') and not (y->'state' ? 'pend')
     and y->'state'->'offers' = '[{"kind": "continue"}]'::jsonb and y->'step' = 'null'::jsonb`, `(y->'state') - 'units' - 'info' - 'carry'`)}
  -- D5 the gamble door (balance dungeon_rewards.door.gamble_rare set in the block)
  update balance set value = jsonb_set(value, '{door,gamble_rare}', '1') where key = 'dungeon_rewards';
  y := dungeon_v2_room(st || '{"door": "gamble"}'::jsonb, fl, 2, 3, 'door|7|2|3');
  ${add('D5 gamble with gamble_rare 1: the empty chest pass room', `y->'state'->>'room_type' = 'treasure' and y->'state'->>'phase' = 'pass' and not (y->'state' ? 'chest') and not (y->'state' ? 'door')`, `y->'state'->'room_type'`)}
  update balance set value = jsonb_set(value, '{door,gamble_rare}', '0') where key = 'dungeon_rewards';
  insert into r2a_kv values ('st_gamble', st || '{"door": "gamble"}'::jsonb), ('st_horde', st || '{"door": "horde"}'::jsonb);
  x := pg_temp.spy(format('dungeon_v2_room((select v from r2a_kv where k = %L), (select v from r2a_kv where k = %L), 2, 3, %L)', 'st_gamble', 'fl', 'door|7|2|3'));
  e := gauntlet_v2_foes(dungeon_room_foes('door|7|2|3', 2, 3, 'elite'), 2, 3, b);
  ${add('D5 gamble with gamble_rare 0: an elite fight room with the v1 door foes (dungeon_room_foes of the door key, elite)',
    `x->'ans'->'state'->>'room_type' = 'elite' and jsonb_array_length(x->'f0'->0->'enemies') = jsonb_array_length(e)
     and (select pg_temp.all_true((x->'f0'->0->'enemies'->(k - 1)) - 'meter' - 'show' = (e->(k - 1)) - 'meter' - 'show') from generate_series(1, jsonb_array_length(e)) k)`,
    `x->'ans'->'state'->'room_type'`)}
  x := pg_temp.spy(format('dungeon_v2_room((select v from r2a_kv where k = %L), (select v from r2a_kv where k = %L), 2, 3, %L)', 'st_horde', 'fl', 'door|7|2|3'));
  e := gauntlet_v2_foes(dungeon_room_foes('door|7|2|3', 2, 3, 'horde'), 2, 3, b);
  ${add('D5 the horde door: a horde fight room with the v1 door foes (dungeon_room_foes of the door key, horde)',
    `x->'ans'->'state'->>'room_type' = 'horde' and jsonb_array_length(x->'f0'->0->'enemies') = jsonb_array_length(e)
     and (select pg_temp.all_true((x->'f0'->0->'enemies'->(k - 1)) - 'meter' - 'show' = (e->(k - 1)) - 'meter' - 'show') from generate_series(1, jsonb_array_length(e)) k)`,
    `x->'ans'->'state'->'room_type'`)}
  -- D5b SYN: the synergy of the squad at each fight room start
  if syn_on then
    ${wait('D5b SYN: syn of every card at the start of 3 fight rooms = combat_v2_synergy of that state (the case is built when SYN is on the copy)')}
  else
    ${wait('D5b SYN: syn of every card at the start of 3 fight rooms = combat_v2_synergy of that state')}
  end if;
  -- D6 offers after a won room: the v1 daily offers minus shards and card (QD1), over 50 seeds
  ok := true; n := 0; m := 0;
  st2 := st || '{"room_type": "fight"}'::jsonb;
  r := jsonb_build_object('event', 'end', 'won', true, 'fight', a->'state'->'fight');
  for i in 1 .. 50 loop
    perform setseed(i / 50.0);
    o := dungeon_v2_after(st2, r, 1, jsonb_array_length(fl))->'offers';
    perform setseed(i / 50.0);
    e := dungeon_offers(jsonb_build_object('mode', 'daily', 'cards', (select jsonb_object_agg(q.key, jsonb_build_object('down', coalesce(q.value->'down', 'false'::jsonb))) from jsonb_each(r->'fight'->'cards') q),
           'last_pick', st2->'last_pick', 'heal_floor', st2->'heal_floor'), 1);
    e := (select coalesce(jsonb_agg(z order by k), '[]'::jsonb) from jsonb_array_elements(e) with ordinality q(z, k) where z->>'kind' not in ('shards', 'card'));
    if jsonb_array_length(e) = 0 then e := '[{"kind": "continue"}]'::jsonb; end if;
    ok := ok and o = e and not exists (select 1 from jsonb_array_elements(o) z where z->>'kind' in ('shards', 'card'));
    n := n + (select count(*) from jsonb_array_elements(dungeon_offers(jsonb_build_object('mode', 'daily', 'cards', '{}'::jsonb), 1)) z where z->>'kind' in ('shards', 'card'))::int;
  end loop;
  ${add('D6 QD1 over 50 seeds: the offers = the v1 daily offers (same draw) minus the kinds shards and card (none left = continue); no shards or card offer',
    'ok and n > 0', `jsonb_build_object('v1_loot_offers_seen', n, 'last', o)`)}
  -- D6 heal, revive, buff, ward, reset (R1b G1.9 rules)
  st2 := (select v from r2a_kv where k = 'st_hurt');
  y := dungeon_v2_pick(st2, '{"kind": "heal", "amount": 0.3}'::jsonb, 4);
  ${add('D6 heal: each standing card + round(max x amount) (at most max); a down card stays down; heal_floor = the floor; last_pick heal',
    `(y->'carry'->(sq[1]::text)->>'hp')::numeric = least((st2->'carry'->(sq[1]::text)->>'max')::numeric, 10 + round((st2->'carry'->(sq[1]::text)->>'max')::numeric * 0.3))
     and (y->'carry'->(sq[2]::text)->>'down')::boolean and (y->'carry'->(sq[2]::text)->>'hp')::numeric = 0 and (y->>'heal_floor')::int = 4 and y->>'last_pick' = 'heal'`, `y->'carry'`)}
  y := dungeon_v2_pick(st2, '{"kind": "revive", "amount": 0.5}'::jsonb, 4);
  ${add('D6 revive: a down card up at greatest(1, round(max x amount)); a standing card unchanged',
    `(y->'carry'->(sq[2]::text)->>'hp')::numeric = greatest(1, round((st2->'carry'->(sq[2]::text)->>'max')::numeric * 0.5)) and not (y->'carry'->(sq[2]::text)->>'down')::boolean
     and y->'carry'->(sq[1]::text) = st2->'carry'->(sq[1]::text)`, `y->'carry'`)}
  y := dungeon_v2_pick(dungeon_v2_pick(st2, '{"kind": "buff", "amount": 0.2}'::jsonb, 1), '{"kind": "buff", "amount": 0.1}'::jsonb, 1);
  y := dungeon_v2_pick(y, '{"kind": "ward", "amount": 0.3}'::jsonb, 1);
  insert into r2a_kv values ('st_pend', y);
  x := pg_temp.spy(format('dungeon_v2_room((select v from r2a_kv where k = %L), (select v from r2a_kv where k = %L), 1, 1, null)', 'st_pend', 'fl'));
  s := x->'f0'->0;
  ${add('D6 buff (Q4: the higher amount stays) = Empowered 0.2 on each STANDING ATTACKER at the next fight room only (not a support, not a down card); the run state drops it',
    `(y->>'empower')::numeric = 0.2 and (select pg_temp.all_true(case when (z.value->>'class') = 'attacker' and not coalesce((z.value->>'down')::boolean, false)
        then (z.value->'status'->'empowered'->>'value')::numeric = 0.2 else not (z.value->'status' ? 'empowered') end) from jsonb_each(s->'cards') z)
     and not (x->'ans'->'state' ? 'empower') and not (x->'ans'->'state' ? 'ward')
     and exists (select 1 from jsonb_each(s->'cards') z where z.value->>'class' = 'support')`,
    `(select jsonb_object_agg(z.key, jsonb_build_object('class', z.value->'class', 'down', z.value->'down', 'st', z.value->'status')) from jsonb_each(s->'cards') z)`)}
  ${add('D6 ward = Shielded round(max x 0.3) on each STANDING card at the next fight room (a down card none)',
    `(y->>'ward')::numeric = 0.3 and (select pg_temp.all_true(case when not coalesce((z.value->>'down')::boolean, false)
        then (z.value->'status'->'shielded'->>'value')::numeric = round((z.value->>'max')::numeric * 0.3) else not (z.value->'status' ? 'shielded') end) from jsonb_each(s->'cards') z)`,
    `(select jsonb_object_agg(z.key, z.value->'status') from jsonb_each(s->'cards') z)`)}
  y := dungeon_v2_room(y, '[[{"type": "rest", "foes": []}]]'::jsonb, 1, 1, null);
  ${add('D6 Q3 a rest room keeps the pending buff and ward (they wait for the next fight room)', `(y->'state'->>'empower')::numeric = 0.2 and (y->'state'->>'ward')::numeric = 0.3`, `(y->'state') - 'units' - 'info' - 'carry'`)}
  st2 := st;
  for t in select jsonb_object_keys(st2->'carry') loop st2 := jsonb_set(st2, array['carry', t, 'charge'], '0'); end loop;
  y := dungeon_v2_pick(st2, '{"kind": "reset", "tier": 3, "amount": 0}'::jsonb, 1);
  ${add('D6 D3 reset: every card charge = v2_charge of its class (live balance)',
    `(select pg_temp.all_true((y->'carry'->z.key->>'charge')::int = (b->'v2_charge'->>(st2->'units'->z.key->>'class'))::int and (b->'v2_charge'->>(st2->'units'->z.key->>'class'))::int > 0) from jsonb_each(st2->'carry') z)`,
    `y->'carry'`)}
  -- D7 the carry enters the next fight (HP, down, charge, held; no status: D5, Q1)
  st2 := st;
  st2 := jsonb_set(st2, array['carry', sq[1]::text], (st2->'carry'->(sq[1]::text)) || '{"hp": 7, "charge": 1, "held": 1, "status": {"burn": {"stacks": 1}}}'::jsonb);
  st2 := jsonb_set(st2, array['carry', sq[2]::text], (st2->'carry'->(sq[2]::text)) || '{"hp": 0, "down": true, "charge": 2}'::jsonb);
  insert into r2a_kv values ('st_carry', st2);
  x := pg_temp.spy(format('dungeon_v2_room((select v from r2a_kv where k = %L), (select v from r2a_kv where k = %L), 1, 1, null)', 'st_carry', 'fl'));
  s := x->'f0'->0;
  ${add('D7 the carry enters the fight (R1b G1.8): hp 7, charge 1, held 1 and NO status on the hurt card; the down card hp 0, down, charge 2',
    `(s->'cards'->(sq[1]::text)->>'hp')::numeric = 7 and (s->'cards'->(sq[1]::text)->>'charge')::int = 1 and (s->'cards'->(sq[1]::text)->>'held')::int = 1
     and s->'cards'->(sq[1]::text)->'status' = '{}'::jsonb
     and (s->'cards'->(sq[2]::text)->>'hp')::numeric = 0 and (s->'cards'->(sq[2]::text)->>'down')::boolean and (s->'cards'->(sq[2]::text)->>'charge')::int = 2`,
    `jsonb_build_object('c1', (s->'cards'->(sq[1]::text)) - 'active', 'c2', (s->'cards'->(sq[2]::text)) - 'active', 'raised', x->'raised')`)}
`);

// ---------------------------------------------------------------------------------------------------------- B4: D7 the fights (seeded)
const B4 = (from, to) => block(String.raw`
  out := '[]';
  for i in ${from} .. ${to} loop
    begin
      perform setseed(i / 100.0);
      a := dungeon_v2_start(${T(5)}, sq);
      if a->'state'->>'phase' is distinct from 'fight' then out := out || jsonb_build_array(jsonb_build_object('seed', i, 'skip', a->'state'->'phase')); raise exception 'r2a_rollback'; end if;
      rid := (a->>'run')::bigint; s0 := a->'state'; f0 := s0->'fight';
      row0 := jsonb_build_object('seed', i);
      -- auto 1000 = the replay of combat_v2_auto + combat_v2_step on the same fight and seed; the carry = the replay end
      begin
        perform setseed(0.5);
        x := dungeon_v2_auto(${T(5)}, 1000);
        rw := pg_temp.vrow(${T(5)});
        perform setseed(0.5);
        s := f0; lg := '[]'; n := 0;
        loop
          e := pg_temp.autoc(s); r := combat_v2_step(s, e, b); lg := lg || (r->'log'); s := r->'state';
          exit when r->>'event' <> 'choose';
        end loop;
        n := (select count(*) from jsonb_array_elements(lg) z where z->>'k' = 'act' and z->'actor'->>'side' = 'card');
        row0 := row0 || jsonb_build_object('auto', x->'log' = lg and x->>'event' = r->>'event' and (x->>'played')::int = n and rw.turns = n, 'n', n, 'end', r->'event', 'won', r->'won',
          'carry', (select pg_temp.all_true(rw.state->'carry'->q.key = jsonb_build_object('hp', q.value->'hp', 'max', q.value->'max', 'down', coalesce(q.value->'down', 'false'::jsonb),
                      'charge', q.value->'charge', 'held', q.value->'held')) from jsonb_each(s->'cards') q),
          'hpc', x->'hp_changes' = dungeon_v2_hp(f0, s));
        raise exception 'r2a_rollback';
      exception when others then if sqlerrm <> 'r2a_rollback' then row0 := row0 || jsonb_build_object('raised_auto', sqlerrm); end if;
      end;
      -- auto 1: exactly one card turn
      begin
        perform setseed(0.5);
        x := dungeon_v2_auto(${T(5)}, 1);
        row0 := row0 || jsonb_build_object('p1', (x->>'played')::int, 'p1ok', (x->>'ok')::boolean and jsonb_array_length(x->'auto') = 1);
        raise exception 'r2a_rollback';
      exception when others then if sqlerrm <> 'r2a_rollback' then row0 := row0 || jsonb_build_object('raised_p1', sqlerrm); end if;
      end;
      -- act: the player's choice = one combat_v2_step with the same seed
      begin
        e := pg_temp.autoc(f0);
        perform setseed(0.5);
        x := dungeon_v2_act(${T(5)}, e);
        perform setseed(0.5);
        r := combat_v2_step(f0, e, b);
        row0 := row0 || jsonb_build_object('act', x->'log' = r->'log' and x->>'event' = r->>'event' and (x->>'ok')::boolean
          and (case when r->>'event' = 'choose' then (pg_temp.vrow(${T(5)})).state->'fight' = r->'state' else true end));
        raise exception 'r2a_rollback';
      exception when others then if sqlerrm <> 'r2a_rollback' then row0 := row0 || jsonb_build_object('raised_act', sqlerrm); end if;
      end;
      -- refusals: bad_choice (+ detail), bad_state (+ detail), not_fighting, bad_max; no write
      begin
        x := dungeon_v2_act(${T(5)}, '{"use": 5}'::jsonb);
        y := dungeon_v2_auto(${T(5)}, 0);
        row0 := row0 || jsonb_build_object('bad_choice', x->>'error' = 'bad_choice' and x->>'detail' is not null and (pg_temp.vrow(${T(5)})).state = s0,
          'bad_max', y->>'error' = 'bad_max');
        update dungeon_v2_runs set state = jsonb_set(state, '{fight,v}', '3') where id = rid;
        x := dungeon_v2_act(${T(5)}, e); y := dungeon_v2_auto(${T(5)}, 3);
        row0 := row0 || jsonb_build_object('bad_state', x->>'error' = 'bad_state' and x->>'detail' is not null and y->>'error' = 'bad_state'
          and (pg_temp.vrow(${T(5)})).state->'fight'->'v' = '3'::jsonb);
        update dungeon_v2_runs set state = jsonb_set(state, '{phase}', '"choose"') where id = rid;
        x := dungeon_v2_act(${T(5)}, e);
        row0 := row0 || jsonb_build_object('not_fighting', x->>'error' = 'not_fighting');
        raise exception 'r2a_rollback';
      exception when others then if sqlerrm <> 'r2a_rollback' then row0 := row0 || jsonb_build_object('raised_ref', sqlerrm); end if;
      end;
      out := out || jsonb_build_array(row0);
      raise exception 'r2a_rollback';
    exception when others then if sqlerrm <> 'r2a_rollback' then out := out || jsonb_build_array(jsonb_build_object('seed', i, 'raised', sqlerrm)); end if;
    end;
  end loop;
  res := out;
`, 'out jsonb; s0 jsonb; f0 jsonb; row0 jsonb; lg jsonb;');

// ---------------------------------------------------------------------------------------------------------- B5: D8 (0 loot, no other table), D9 (INV-3)
const B5 = block(String.raw`
  create function pg_temp.snap() returns jsonb language plpgsql as $x$
  declare out jsonb := '{}'; tb text; v jsonb;
  begin
    for tb in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname not in ('dungeon_v2_runs', 'dungeon_days') order by 1 loop
      execute format('select jsonb_build_array(count(*), md5(coalesce(string_agg(t::text, %L order by t::text), %L))) from public.%I t', '|', '', tb) into v;
      out := out || jsonb_build_object(tb, v);
    end loop;
    return out;
  end $x$;
  -- one run: Auto and continue until the run is over (or the step limit); every answer state is kept for the bank / pend check
  create function pg_temp.play(p text, lim int, stop text default null) returns jsonb language plpgsql as $x$
  declare a jsonb; k int := 0; states jsonb := '[]'; r dungeon_v2_runs;
  begin
    loop
      r := pg_temp.vrow(p);
      exit when r.status <> 'active' or k >= lim or r.state->>'phase' = stop;
      k := k + 1;
      if r.state->>'phase' = 'fight' then a := dungeon_v2_auto(p, 1000); else a := dungeon_v2_choose(p, 0); end if;
      states := states || jsonb_build_array(a->'state');
      exit when (a->>'ok')::boolean is not true;
    end loop;
    r := pg_temp.vrow(p);
    return jsonb_build_object('status', r.status, 'ended_by', r.ended_by, 'ended_at', r.ended_at is not null, 'phase', r.state->>'phase', 'calls', k, 'states', states, 'last', a - 'state');
  end $x$;
  -- weak foes: one floor-1 fight foe as the guardian; floors are planted on the day row (dungeon_days is not compared)
  e := jsonb_build_array(jsonb_build_object('type', 'guardian', 'foes', jsonb_build_array(fl->0->0->'foes'->0)));
  insert into dungeon_v2_runs (player_id, day, squad, state, attempt) values (${T(9)}, dungeon_day() - 1, sq, '{"engine": 2}', 1);
  before := pg_temp.snap();
  -- fell: the cards at 1 HP, the foes at 100 x their HP
  a := dungeon_v2_start(${T(6)}, sq);
  rw := pg_temp.vrow(${T(6)});
  update dungeon_v2_runs set state = jsonb_set(jsonb_set(state, '{fight,cards}', (select jsonb_object_agg(q.key, q.value || '{"hp": 1}'::jsonb) from jsonb_each(state->'fight'->'cards') q)),
      '{fight,enemies}', (select jsonb_agg(z || jsonb_build_object('hp', (z->>'max')::numeric * 100, 'max', (z->>'max')::numeric * 100) order by k) from jsonb_array_elements(state->'fight'->'enemies') with ordinality q(z, k)))
    where id = rw.id and state->>'phase' = 'fight';
  p_fell := pg_temp.play(${T(6)}, 40);
  -- cleared: one floor with one weak guardian
  update dungeon_days set floors = jsonb_build_array(e) where day = dungeon_day();
  a := dungeon_v2_start(${T(7)}, sq);
  p_clear := pg_temp.play(${T(7)}, 40);
  -- retreat: two floors with one weak guardian each; retreat at floor_done
  update dungeon_days set floors = jsonb_build_array(e, e) where day = dungeon_day();
  a := dungeon_v2_start(${T(8)}, sq);
  p_ret := pg_temp.play(${T(8)}, 40, 'floor_done');
  y := dungeon_v2_retreat(${T(8)});
  update dungeon_days set floors = fl where day = dungeon_day();
  -- stale: the planted active run of yesterday ends as abandoned at the next start
  a := dungeon_v2_start(${T(9)}, sq);
  after := pg_temp.snap();
  ${add('D8 fell: status over, ended_by fell, ended_at set', `p_fell->>'status' = 'over' and p_fell->>'ended_by' = 'fell' and (p_fell->>'ended_at')::boolean`, `p_fell - 'states'`)}
  ${add('D8 cleared (the last floor shortened in the block): status over, ended_by cleared', `p_clear->>'status' = 'over' and p_clear->>'ended_by' = 'cleared' and (p_clear->>'ended_at')::boolean`, `p_clear - 'states'`)}
  ${add('D8 retreat at floor_done: ok, status over, ended_by retreat', `p_ret->>'phase' = 'floor_done' and (y->>'ok')::boolean and (pg_temp.vrow(${T(8)})).status = 'over' and (pg_temp.vrow(${T(8)})).ended_by = 'retreat'`, `jsonb_build_object('play', p_ret - 'states', 'retreat', y)`)}
  ${add('D8 stale: the active run of an earlier day ends as abandoned at the next start (status over, ended_at set)',
    `(a->>'ok')::boolean and exists (select 1 from dungeon_v2_runs where player_id = ${T(9)} and day = dungeon_day() - 1 and status = 'over' and ended_by = 'abandoned' and ended_at is not null)`,
    `(select jsonb_agg(to_jsonb(q) - 'state') from dungeon_v2_runs q where q.player_id = ${T(9)})`)}
  ${add('D8 L-2 the row count and the md5 of EVERY public table (except dungeon_v2_runs and dungeon_days) are the same before and after the 4 runs',
    `before = after and (select count(*) from jsonb_object_keys(before)) >= 80`,
    `jsonb_build_object('tables', (select count(*) from jsonb_object_keys(before)), 'diff', (select jsonb_agg(q.key) from jsonb_each(before) q where after->q.key is distinct from q.value))`)}
  ${add('D8 QD1 no bank and no pend in any saved state (every row) or any answer state of the 4 runs',
    `not exists (select 1 from dungeon_v2_runs q where q.state ? 'bank' or q.state ? 'pend')
     and not exists (select 1 from jsonb_array_elements(p_fell->'states' || (p_clear->'states') || (p_ret->'states')) z where z ? 'bank' or z ? 'pend')
     and jsonb_array_length(p_fell->'states') > 0`, `(select count(*) from dungeon_v2_runs q where q.state ? 'bank' or q.state ? 'pend')`)}
  -- D9 INV-3 / QD2: the v1 run and the v2 run of the same day
  a := dungeon_start(${T(10)}, sq);
  a2 := dungeon_v2_start(${T(10)}, sq);
  ${add('D9 QD2 after a v1 run today, the v2 start succeeds (an extra run: the v2 count does not read dungeon_runs)', `(a->>'ok')::boolean and (a2->>'ok')::boolean`, `jsonb_build_object('v1', a->'ok', 'v2', a2->'error')`)}
  a2 := dungeon_v2_start(${T(11)}, sq);
  a := dungeon_start(${T(11)}, sq);
  ${add('D9 INV-3 with an active v2 run, the v1 dungeon_start the same day succeeds', `(a2->>'ok')::boolean and (a->>'ok')::boolean`, `jsonb_build_object('v1', a->'error', 'v2', a2->'ok')`)}
  x := dungeon_view_core(${T(12)}, true); y := dungeon_board(dungeon_day(), 1000);
  a2 := dungeon_v2_start(${T(12)}, sq);
  ${add('D9 INV-3 dungeon_view_core (with mine) and dungeon_board give the same answer with and without the v2 row',
    `(a2->>'ok')::boolean and x = dungeon_view_core(${T(12)}, true) and y = dungeon_board(dungeon_day(), 1000)`, `jsonb_build_object('v2', a2->'ok')`)}
`, 'before jsonb; after jsonb; p_fell jsonb; p_clear jsonb; p_ret jsonb;');

// ---------------------------------------------------------------------------------------------------------- B6: D10 (helpers), D12 (view), INV-2
const B6 = block(String.raw`
  -- D10 a Hunt fight state (mode hunt, one boss), every card Shielded (so a boss hit can change only the shield).
  -- The seeds come BEFORE the state is built (the start meters, the first step): the state is the same in every run, so the last
  -- hp_changes condition (a shield-only change) always has its input. Without them, a run whose boss hits all broke the capped shield
  -- had no shield-only change and failed (1 of 4 runs on 2026-11-04).
  perform setseed(0.21);
  a := dungeon_v2_start(${T(18)}, sq);
  s := (a->'state'->'fight') || jsonb_build_object('mode', 'hunt', 'clock', 0, 'round', 0, 'ext', '{}'::jsonb,
         'enemies', jsonb_build_array(combat_v2_hunt_boss('Heroic', null, '{}'::jsonb, b) || '{"meter": 0}'::jsonb));
  for t in select jsonb_object_keys(s->'cards') loop
    s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', t::numeric), 'shielded', '{"value": 99999}'::jsonb, b)->'state';
  end loop;
  perform setseed(0.22);
  r := combat_v2_step(s, null, b);
  hs := r->'state';
  update balance set value = jsonb_set(value, '{round_cap}', '30') where key = 'v2_dungeon';
  b := combat_v2_enemy_numbers();
  begin
    alter table public.dungeon_v2_runs rename to r2a_moved_runs;
    alter table public.players rename to r2a_moved_players;
    c1 := pg_temp.autoc(hs);
    perform setseed(0.3); x := dungeon_v2_play(hs, c1, null, null);
    perform setseed(0.3); r := combat_v2_step(hs, c1, b);
    perform setseed(0.4); y := dungeon_v2_play(hs, null, 5, null);
    perform setseed(0.4);
    s2 := hs; lg := '[]';
    for i in 1 .. 5 loop
      c2 := pg_temp.autoc(s2); r2 := combat_v2_step(s2, c2, b); lg := lg || (r2->'log'); s2 := r2->'state';
      exit when r2->>'event' <> 'choose';
    end loop;
    sc := dungeon_v2_screen(hs, null);
    ok := true;
    raise exception 'r2a_rollback';
  exception when others then
    if sqlerrm <> 'r2a_rollback' then ok := false; msg := sqlerrm; end if;
  end;
  ${add('D10 L-2 dungeon_v2_play and dungeon_v2_screen run with dungeon_v2_runs and players renamed (no table read)', 'ok and x is not null', 'to_jsonb(msg)')}
  ${add('D10 dungeon_v2_play with a choice on a Hunt state = one combat_v2_step (the same seed): log, event, fight',
    `ok and hs->>'mode' = 'hunt' and (x->>'ok')::boolean and x->'log' = r->'log' and x->>'event' = r->>'event' and x->'fight' = r->'state' and (x->>'played')::int = 1`,
    `jsonb_build_object('x', x - 'fight' - 'log', 'ev', r->'event')`)}
  ${add('D10 dungeon_v2_play with no choice, p_max 5 = the replay of combat_v2_auto + combat_v2_step for up to 5 card turns',
    `ok and y->'log' = lg and y->>'event' = r2->>'event' and y->'fight' = s2 and jsonb_array_length(y->'auto') = (y->>'played')::int and (y->>'played')::int between 1 and 5`,
    `jsonb_build_object('played', y->'played', 'ev', y->'event')`)}
  ${add('D10 dungeon_v2_screen on the Hunt state = the R1b screen rules (need, targets, allies, order = the turn + combat_v2_turn_order 9, ready, status_lines)',
    `ok and sc->'need' = (select jsonb_object_agg(q.key, (b->'v2_charge'->>(q.value->>'class'))::int) from jsonb_each(hs->'cards') q)
     and sc->'targets' = '[0]'::jsonb
     and sc->'allies' = (select jsonb_agg(z.id::numeric order by z.n) from combat_v2_units(hs) z where z.side = 'card')
     and (select jsonb_agg(z - 'ready' order by k) from jsonb_array_elements(sc->'order') with ordinality q(z, k)) = jsonb_build_array(hs->'ext'->'turn') || combat_v2_turn_order(hs, 9)
     and (sc->'order'->0->>'ready')::boolean = ((hs->'cards'->(hs->'ext'->'turn'->>'id')->>'charge')::int >= (b->'v2_charge'->>(hs->'cards'->(hs->'ext'->'turn'->>'id')->>'class'))::int)
     and (select pg_temp.all_true(sc->'status_lines'->('card:' || q.key) @> jsonb_build_array(jsonb_build_object('key', 'shielded'))) from jsonb_each(hs->'cards') q)`,
    `sc - 'status_lines'`)}
  -- the hp changes of y, both ways: every unit whose hp, down or shield differs has one entry with its values, and every entry is such a unit
  ${add('D10 hp_changes = the diff of the two fight states, both ways (each changed unit once with before, after, down, shield; no unchanged unit); shield-only changes are listed',
    `ok and jsonb_array_length(y->'hp_changes') = (select count(*) from combat_v2_units(y->'fight') z cross join lateral (select
          case when z.side = 'card' then hs->'cards'->z.id else hs->'enemies'->(z.id::int) end as u0, case when z.side = 'card' then y->'fight'->'cards'->z.id else y->'fight'->'enemies'->(z.id::int) end as u1,
          case when z.side = 'card' then 'shielded' else 'guarded' end as sk) w
        where w.u0->'hp' is distinct from w.u1->'hp' or coalesce((w.u0->>'down')::boolean, false) <> coalesce((w.u1->>'down')::boolean, false)
           or coalesce((w.u0->'status'->w.sk->>'value')::numeric, 0) <> coalesce((w.u1->'status'->w.sk->>'value')::numeric, 0))
     and (select pg_temp.all_true(case when h->>'side' = 'card' then hs->'cards'->(h->>'id')->'hp' = h->'before' and y->'fight'->'cards'->(h->>'id')->'hp' = h->'after'
              and coalesce((y->'fight'->'cards'->(h->>'id')->'status'->'shielded'->>'value')::numeric, 0) = (h->>'shield_after')::numeric
              and coalesce((hs->'cards'->(h->>'id')->'status'->'shielded'->>'value')::numeric, 0) = (h->>'shield_before')::numeric
            else hs->'enemies'->((h->>'id')::int)->'hp' = h->'before' and y->'fight'->'enemies'->((h->>'id')::int)->'hp' = h->'after' end) from jsonb_array_elements(y->'hp_changes') h)
     and exists (select 1 from jsonb_array_elements(y->'hp_changes') h where h->'before' = h->'after' and h->'shield_before' <> h->'shield_after')`,
    `y->'hp_changes'`)}
  ${add('D10 L-3 steps_left = v2_hunt.round_cap - the clock of the last step (v2_dungeon.round_cap 30 in the block is not used)',
    `ok and (y->>'steps_left')::int = greatest(0, (b->'v2_hunt'->>'round_cap')::int - (y->'fight'->>'clock')::int)
     and (b->'v2_hunt'->>'round_cap')::int <> (b->'v2_dungeon'->>'round_cap')::int`,
    `jsonb_build_object('steps_left', y->'steps_left', 'clock', y->'fight'->'clock', 'hunt_cap', b->'v2_hunt'->'round_cap', 'dungeon_cap', b->'v2_dungeon'->'round_cap')`)}
  -- D12 the view in 4 states (and a non-tester)
  x := dungeon_v2_view(${T(14)});
  ${add('D12 no run: tester true, run null, runs_left 1, last_run null, can_start true; floors and rooms of the day',
    `(x->>'tester')::boolean and x->'run' = 'null'::jsonb and (x->>'runs_left')::int = 1 and x->'last_run' = 'null'::jsonb and (x->>'can_start')::boolean
     and (x->>'floors')::int = jsonb_array_length(fl) and jsonb_array_length(x->'rooms') = jsonb_array_length(fl->0)`, `x - 'rooms'`)}
  update balance set value = '2' where key = 'dungeon_runs_per_day';
  a := dungeon_v2_start(${T(14)}, sq);
  x := dungeon_v2_view(${T(14)});
  ${add('D12 an active run (runs per day 2): run = the active run, runs_left 1, can_start false', `x->'run'->>'status' = 'active' and (x->>'runs_left')::int = 1 and not (x->>'can_start')::boolean and (x->'run'->>'id') = (a->>'run')`, `x - 'rooms' - 'run' - 'units' - 'info' - 'order' - 'status_lines'`)}
  update balance set value = '1' where key = 'dungeon_runs_per_day';
  a := dungeon_v2_start(${T(15)}, sq);
  update dungeon_v2_runs set status = 'over', ended_by = 'fell', ended_at = now() where id = (a->>'run')::bigint;
  x := dungeon_v2_view(${T(15)});
  ${add('D12 an ended run (runs per day 1): runs_left 0, can_start false, last_run = that run (fell)', `(x->>'runs_left')::int = 0 and not (x->>'can_start')::boolean and (x->'last_run'->>'id') = (a->>'run') and x->'last_run'->>'ended_by' = 'fell'`, `x - 'rooms' - 'run' - 'units' - 'info'`)}
  a := dungeon_start(${T(16)}, sq);
  x := dungeon_v2_view(${T(16)});
  ${add('D12 QD2 only a v1 run today: runs_left 1, can_start true, last_run null (the v1 run is not counted)', `(a->>'ok')::boolean and (x->>'runs_left')::int = 1 and (x->>'can_start')::boolean and x->'last_run' = 'null'::jsonb`, `x - 'rooms'`)}
  x := dungeon_v2_view(${O(2)});
  ${add('D12 a non-tester: tester false, can_start false', `x->>'tester' = 'false' and not (x->>'can_start')::boolean`, `x - 'rooms'`)}
  -- INV-2 a tester removed during a run plays it to its end; a new start is refused
  a := dungeon_v2_start(${T(17)}, sq);
  update balance set value = jsonb_set(value, '{testers}', (select jsonb_agg(z) from jsonb_array_elements(value->'testers') z where z <> to_jsonb(${T(17)}::text))) where key = 'combat_v2';
  y := dungeon_v2_auto(${T(17)}, 1000);
  update dungeon_v2_runs set status = 'over', ended_by = 'fell', ended_at = now() where player_id = ${T(17)};
  update balance set value = '2' where key = 'dungeon_runs_per_day';
  a2 := dungeon_v2_start(${T(17)}, sq);
  ${add('D4 INV-2 a tester removed during a run plays it on (auto ok, D4); a new start is refused with not_tester', `(a->>'ok')::boolean and (y->>'ok')::boolean and a2->>'error' = 'not_tester'`, `jsonb_build_object('auto', y->'error', 'start', a2)`)}
`, 'hs jsonb; sc jsonb; lg jsonb; c1 jsonb; c2 jsonb; r2 jsonb;');

// ---------------------------------------------------------------------------------------------------------- run
let fail = 0, total = 0, waits = 0, synOn = null;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const show = (rows) => { for (const r of rows) { const { case: name, ok, wait: w, ...rest } = r; if (w) { waits++; console.log(`WAIT ${name} (SYN not on the copy)`); continue; } say(ok, name, JSON.stringify(rest).slice(0, 900)); } };
const run = async (label, sql) => {
  try { const j = JSON.parse(await runBlock(sql)); if (synOn === null) synOn = j.syn; return j.rows; }
  catch (e) { say(false, `${label}: the test block raised (the file did not apply?)`, String(e.message).slice(0, 1500)); return null; }
};
const r1 = await run('B1', B1); if (r1) show(r1);
console.log(`     SYN on the copy: ${synOn ? 'yes' : 'no (a stand-in combat_v2_synergy that returns the state; D4b tags and D5b WAIT)'}`);
const r2 = await run('B2', B2); if (r2) show(r2);
const r3 = await run('B3', B3); if (r3) show(r3);
const rows4 = [];
const CH = 10;
for (let a = 1; a <= FIGHTS; a += CH) { const r = await run(`B4 ${a}`, B4(a, Math.min(FIGHTS, a + CH - 1))); if (r) rows4.push(...r); }
const f4 = rows4.filter((r) => !r.skip && !r.raised);
const bad = (k) => f4.filter((r) => r[k] !== true);
say(f4.length >= FIGHTS - 2 && rows4.every((r) => !r.raised && !r.raised_auto) && bad('auto').length === 0,
  `D7 on ${f4.length} seeded fights: dungeon_v2_auto(1000) log, event and card turns (row turns too) = the replay of combat_v2_auto + combat_v2_step with the same fight and seed (${f4.reduce((s, r) => s + (r.n || 0), 0)} card turns; ends ${JSON.stringify(f4.reduce((o, r) => { const k = r.end === 'end' ? (r.won ? 'won' : 'lost') : r.end; o[k] = (o[k] || 0) + 1; return o; }, {}))})`,
  JSON.stringify(rows4.filter((r) => r.raised || r.raised_auto || r.auto !== true).slice(0, 2)).slice(0, 1200));
say(f4.length > 0 && bad('carry').length === 0, 'D7 G1.8 the carry after the fight = the replay end (hp, max, down, charge, held of each card)', JSON.stringify(bad('carry').slice(0, 2)));
say(f4.length > 0 && bad('hpc').length === 0, 'D7 hp_changes of the answer = dungeon_v2_hp(the fight before, the replay end)', JSON.stringify(bad('hpc').slice(0, 2)));
say(f4.length > 0 && f4.every((r) => r.p1 === 1 && r.p1ok === true), 'D7 dungeon_v2_auto(p, 1) plays exactly 1 card turn', JSON.stringify(f4.filter((r) => r.p1 !== 1 || r.p1ok !== true).slice(0, 3)));
say(f4.length > 0 && bad('act').length === 0, 'D7 dungeon_v2_act = one combat_v2_step with the same choice and seed (log, event, the saved fight)', JSON.stringify(bad('act').slice(0, 2)).slice(0, 800));
say(f4.length > 0 && bad('bad_choice').length === 0 && bad('bad_max').length === 0, 'D7 R1b G1.6 a bad choice gives bad_choice + detail and no write; auto(p, 0) gives bad_max', JSON.stringify(bad('bad_choice').slice(0, 2)).slice(0, 800));
say(f4.length > 0 && bad('bad_state').length === 0 && bad('not_fighting').length === 0, 'D7 R1b G1.6 a saved fight that fails fight_state_check_v2 gives bad_state + detail (act and auto) and no write; outside a fight: not_fighting', JSON.stringify(bad('bad_state').slice(0, 2)).slice(0, 800));
const r5 = await run('B5', B5); if (r5) show(r5);
const r6 = await run('B6', B6); if (r6) show(r6);
const waitTxt = waits ? `; ${waits} WAIT for SYN (not a gate result for D4b tags and D5b)` : '';
console.log(fail ? `${fail} of ${total} FAILED${waitTxt}` : `PASS all ${total}${waitTxt}`);
process.exitCode = fail ? 1 : 0;
