import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_progress_spend.sql (combat v2 step M1c: spend_card_points_v2, reset_card_points_v2,
 * stat_reset_gift_use_v2, card_progress_v2_view and the sequence card_progress_v2_ref_seq; plan 2.2 to 2.4, 11, 20.11 and 20.13).
 * NO lasting change: one DO block, undone by its final RAISE. The block first puts back the state before the file (the new functions and the
 * sequence dropped), so the test passes before and after the file is applied. The sample rows use cards that the sample players do not own
 * (added player_cards rows); nothing is printed about a member (case names and counts only).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-progress-spend.mjs     must PASS
 *   MUTATE=<name> ...                                                                                   must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                      the baseline (must PASS), then every mutation, one line each
 * Invariants:
 *   T1 (flag OFF identity): the md5 of every other public function does not change; exactly the 4 new functions are added; the flag
 *      combat_v2 does not change (progress false); the readers of combat_v2_on = before + spend_card_points_v2 and reset_card_points_v2;
 *      no other function names a new function.
 *   T2 (server only): no execute for public, anon and authenticated; no sequence privilege for anon and authenticated; search_path set;
 *      a [combat] comment on each function and a comment on the sequence.
 *   The gate: flag OFF, and a non-tester with the tester list on: both functions answer disabled and write nothing. A tester with progress
 *      for testers only, and everyone with progress ON: both work.
 *   The spend: each error code with its answer and no write; each cap boundary (the stat cap, the level budget, the bonus points); the limits
 *      move with balance (v2_stats.max_per_stat, v2_level.points_per_level); the answer (progress and stats = card_combat_v2 of the card).
 *   The ledger: written FIRST (a ref collision raises and changes no row), one ref for each call, never shared; T6: the ledger deltas of each
 *      progress row sum to the stored row after a series of spends and resets.
 *   The reset: the weekly free one (the marker players.stat_reset_week), then the v2 gifts (the earliest deadline first; never a v1 gift,
 *      a 'v2x' key, an expired or a used gift), then reset_used with next; the level, the XP and the bonus do not change.
 *   The file runs twice: the rows stay and the sequence goes on.
 *   Added by M1d (plan 20.13 "Open for M1d" item 6, 20.17): each of the 9 stats spent twice (the + write, not an absolute write), and the
 *      reset at 6 fixed instants (the Mountain week boundary in summer and winter time: now() of the reset is read from a test clock).
 *      The concurrency case (two sessions) is test-combat-v2-progress-concurrency.mjs (it needs two real connections and committed rows).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-progress-spend.mjs');

const FILE = process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/combat_v2_progress_spend.sql', import.meta.url));
let mig = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');

const SPEND_LEDGER = `  v_ref := 'spend:' || nextval('public.card_progress_v2_ref_seq');
  insert into card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_points)
  select r.id, p_player, p_card, 'spend', x.key, v_ref, (x.value #>> '{}')::int from jsonb_each(p_add) x;
  get diagnostics v_n = row_count;
  if v_n <> (select count(*) from jsonb_object_keys(p_add)) then
    raise exception 'spend_card_points_v2: the ledger took % of % rows', v_n, (select count(*) from jsonb_object_keys(p_add)); end if;
`;
const SPEND_UPDATE = `  update card_progress_v2 set
    atk_pts = atk_pts + coalesce((p_add->>'atk')::int, 0), def_pts = def_pts + coalesce((p_add->>'def')::int, 0),
    hp_pts = hp_pts + coalesce((p_add->>'hp')::int, 0), crd_pts = crd_pts + coalesce((p_add->>'crd')::int, 0),
    crt_pts = crt_pts + coalesce((p_add->>'crt')::int, 0), abl_pts = abl_pts + coalesce((p_add->>'abl')::int, 0),
    ddg_pts = ddg_pts + coalesce((p_add->>'ddg')::int, 0), acc_pts = acc_pts + coalesce((p_add->>'acc')::int, 0),
    spd_pts = spd_pts + coalesce((p_add->>'spd')::int, 0)
   where id = r.id;
`;
const MARK = '-- ============================================================ 6. server only';
const MUT = {
  spend_no_gate: ["  if not combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;\n  if p_add is null", '  if p_add is null'],
  reset_no_gate: ["  if not combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;\n  -- the lock order", '  -- the lock order'],
  spend_flag_one_arg: ["  if not combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;\n  if p_add is null", "  if not combat_v2_on('progress') then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;\n  if p_add is null"],
  reset_flag_one_arg: ["  if not combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;\n  -- the lock order", "  if not combat_v2_on('progress') then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;\n  -- the lock order"],
  update_first_on_conflict: [SPEND_LEDGER + SPEND_UPDATE, SPEND_UPDATE + SPEND_LEDGER.replace(" from jsonb_each(p_add) x;\n", " from jsonb_each(p_add) x\n  on conflict do nothing;\n").replace(/  get diagnostics[\s\S]*$/, '')],
  shared_ref: ["v_ref := 'spend:' || nextval('public.card_progress_v2_ref_seq');", "v_ref := 'spend:' || p_card;"],
  reset_shared_ref: ["v_ref := 'reset:' || nextval('public.card_progress_v2_ref_seq');", "v_ref := 'reset:' || p_card;"],
  cap_fixed: ["v_cap := balance_num('v2_stats', 'max_per_stat')::int;", 'v_cap := 10;'],
  cap_skips_spd: ["\n     or r.spd_pts + coalesce((p_add->>'spd')::int, 0) > v_cap then", ' then'],
  ppl_fixed: ["v_ppl := balance_num('v2_level', 'points_per_level')::int;", 'v_ppl := 1;'],
  bonus_ignored: ['if v_spent + v_add > r.level * v_ppl + r.bonus_points then', 'if v_spent + v_add > r.level * v_ppl then'],
  free_no_bonus: ["'error', 'not_enough', 'free', r.level * v_ppl + r.bonus_points - v_spent)", "'error', 'not_enough', 'free', r.level * v_ppl - v_spent)"],
  amount_zero_ok: ["(v #>> '{}') !~ '^[1-9][0-9]?$'", "(v #>> '{}') !~ '^[0-9]{1,2}$'"],
  bad_stat_v1_ok: ["if k not in ('atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd') then", "if k not in ('atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd', 'attack') then"],
  no_role_skipped: ["  if v_role is null or not exists (select 1 from roles where key = v_role) then\n    return jsonb_build_object('ok', false, 'error', 'no_role'); end if;\n  v_cap", '  v_cap'],
  stats_no_bonus: ["combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed']), r.bonus_points));", "combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed']), r.bonus_points + 1));"],
  stats_no_stars: ['card_combat_v2(v_rar, v_asc, v_mod, r.level, v_pts, v_role,', 'card_combat_v2(v_rar, 0, v_mod, r.level, v_pts, v_role,'],
  reset_clears_bonus: ['  update card_progress_v2 set atk_pts = 0, def_pts = 0, hp_pts = 0,', '  update card_progress_v2 set bonus_points = 0, atk_pts = 0, def_pts = 0, hp_pts = 0,'],
  reset_one_row: [`  select r.id, p_player, p_card, 'reset', x.stat, v_ref, -x.n
    from (values ('atk', r.atk_pts), ('def', r.def_pts), ('hp', r.hp_pts), ('crd', r.crd_pts), ('crt', r.crt_pts),
                 ('abl', r.abl_pts), ('ddg', r.ddg_pts), ('acc', r.acc_pts), ('spd', r.spd_pts)) x(stat, n)
   where x.n > 0;
  get diagnostics v_n = row_count;
  if v_n <> v_want then raise exception 'reset_card_points_v2: the ledger took % of % rows', v_n, v_want; end if;`,
  `  values (r.id, p_player, p_card, 'reset', 'atk', v_ref, -(r.atk_pts + r.def_pts + r.hp_pts + r.crd_pts + r.crt_pts + r.abl_pts + r.ddg_pts + r.acc_pts + r.spd_pts));`],
  reset_takes_v1_gift: ["where player_id = p_player and starts_with(gift, 'v2_') and used_at", 'where player_id = p_player and used_at'],
  gift_like_wildcard: ["starts_with(gift, 'v2_')", "gift like 'v2_%'"],
  gift_expired_ok: ["and used_at is null and expires_at > now()\n     order by expires_at, gift", "and used_at is null\n     order by expires_at, gift"],
  gift_latest_first: ['order by expires_at, gift limit 1 for update)', 'order by expires_at desc, gift limit 1 for update)'],
  no_weekly_marker: ["  if v_how = 'week' then update players set stat_reset_week = v_week where id = p_player; end if;\n", ''],
  gift_before_week: ["  if v_used is distinct from v_week then\n    v_how := 'week';\n  else\n    if not stat_reset_gift_use_v2(p_player, p_card) then",
    "  if stat_reset_gift_use_v2(p_player, p_card) then\n    v_how := 'gift';\n  elsif v_used is distinct from v_week then\n    v_how := 'week';\n  else\n    if true then"],
  week_not_mountain: ["v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');", "v_week text := to_char(now(), 'YYYY-MM');"],
  // M1d: the planted faults of the M1c review (plan 20.13 item 6): the week in UTC, and an absolute write in place of + (all stats, then each stat)
  rev_week_utc: ["v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');", "v_week text := to_char(now(), 'IYYY-IW');"],
  rev_spend_abs_update: [SPEND_UPDATE, SPEND_UPDATE.replace(/(\w+)_pts = \1_pts \+ coalesce\(\(p_add->>'(\w+)'\)::int, 0\)/g, "$1_pts = coalesce((p_add->>'$2')::int, $1_pts)")],
  ...Object.fromEntries(['atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd'].map((k) => [`rev_spend_abs_${k}`,
    [`${k}_pts = ${k}_pts + coalesce((p_add->>'${k}')::int, 0)`, `${k}_pts = coalesce((p_add->>'${k}')::int, ${k}_pts)`]])),
  nothing_spent_off: ["  if v_want = 0 then return jsonb_build_object('ok', false, 'error', 'nothing_spent'); end if;\n", ''],
  not_owned_skipped: ["  if not exists (select 1 from player_cards where player_id = p_player and card_id = p_card and quantity > 0) then\n    return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;\n  select * into r from card_progress_v2 where player_id = p_player and card_id = p_card for update;\n  if not found then return jsonb_build_object('ok', false, 'error', 'no_progress'); end if;\n  select s.ability_v2->>'role' into v_role from cards c left join subjects s on s.id = c.subject_id where c.id = p_card;\n  if v_role is null or not exists (select 1 from roles where key = v_role) then\n    return jsonb_build_object('ok', false, 'error', 'no_role'); end if;\n  v_cap",
    "  select * into r from card_progress_v2 where player_id = p_player and card_id = p_card for update;\n  if not found then return jsonb_build_object('ok', false, 'error', 'no_progress'); end if;\n  select s.ability_v2->>'role' into v_role from cards c left join subjects s on s.id = c.subject_id where c.id = p_card;\n  if v_role is null or not exists (select 1 from roles where key = v_role) then\n    return jsonb_build_object('ok', false, 'error', 'no_role'); end if;\n  v_cap"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  seq_grant_auth: ['grant usage, select, update on sequence public.card_progress_v2_ref_seq to service_role;', 'grant usage, select, update on sequence public.card_progress_v2_ref_seq to service_role, authenticated;'],
  no_search_path: ['returns boolean\nlanguage plpgsql set search_path = public as $fn$', 'returns boolean\nlanguage plpgsql as $fn$'],
  comment_missing: [/comment on function public\.stat_reset_gift_use_v2\(text, bigint\) is \$cm\$[^\n]*\n/, ''],
  flag_on: [MARK, `update public.balance set value = jsonb_set(value, '{progress}', 'true') where key = 'combat_v2';\n${MARK}`],
  other_fn_changed: [MARK, `create or replace function public.balance_who() returns text language sql stable set search_path to 'public' as $p$
  select coalesce(nullif(current_setting('balance.by', true), ''), session_user::text) || '';
$p$;
${MARK}`],
  other_reader: [MARK, `create or replace function public.card_progress_v2_probe() returns boolean language sql stable set search_path = public as $p$ select combat_v2_on('progress') $p$;\n${MARK}`],
  other_caller: [MARK, `create or replace function public.card_progress_v2_probe2(p text) returns jsonb language sql set search_path = public as $p$ select reset_card_points_v2(p, 1) $p$;\n${MARK}`],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)          ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const out = (r.stdout || '').trim().split(/\r?\n/);
    const line = out.pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const first = out.find((l) => l.startsWith('FAIL')) || '';
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  ${first.slice(0, 110)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once`);
  mig = mig.split(m[0]).join(m[1]);
}
if (['$m$', '$t$', '$q$'].some((x) => mig.includes(x))) throw new Error('the SQL must not contain $m$, $t$ or $q$');

const MINE = ['card_progress_v2_view(text,bigint)', 'spend_card_points_v2(text,bigint,jsonb)', 'stat_reset_gift_use_v2(text,bigint)', 'reset_card_points_v2(text,bigint)'];
const READERS = ['spend_card_points_v2(text,bigint,jsonb)', 'reset_card_points_v2(text,bigint)'];
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const sig = "replace(p.oid::regprocedure::text, ', ', ',')";

const body = String.raw`do $t$
declare res jsonb := '[]'; bad text[] := '{}'; ok boolean; md5a jsonb; md5b jsonb; flag_a jsonb; callers_a text[]; callers_b text[]; fns_a text[]; fns_b text[];
  mine text[] := array[${MINE.map(lit).join(', ')}]; readers text[] := array[${READERS.map(lit).join(', ')}];
  v_p text; v_q text; c1 bigint; c2 bigint; c3 bigint; c4 bigint; c5 bigint; c6 bigint; p6 bigint; ck jsonb; pa bigint; pb bigint; pc3 bigint; pq bigint;
  r jsonb; s0 jsonb; s1 jsonb; k text; rw record; n int; v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
  refs text[] := '{}'; nxt bigint; exp jsonb; flag_off jsonb; flag_testers jsonb; flag_all jsonb; marker_p text; ncalls int := 0;
begin
  -- 0. the state before the file (also when the file is applied on this copy)
  drop function if exists public.spend_card_points_v2(text, bigint, jsonb);
  drop function if exists public.reset_card_points_v2(text, bigint);
  drop function if exists public.stat_reset_gift_use_v2(text, bigint);
  drop function if exists public.card_progress_v2_view(text, bigint);
  drop sequence if exists public.card_progress_v2_ref_seq;
  select jsonb_object_agg(${sig}, md5(pg_get_functiondef(p.oid))) into md5a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into fns_a from pg_proc p where p.pronamespace = 'public'::regnamespace;
  select value into flag_a from public.balance where key = 'combat_v2';
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into callers_a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(';

  execute $m$${mig}$m$;

  -- T1. no other change
  select jsonb_object_agg(${sig}, md5(pg_get_functiondef(p.oid))) into md5b from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and ${sig} <> all (mine);
  res := res || jsonb_build_object('case', format('T1 the md5 of the %s other public functions does not change', (select count(*) from jsonb_object_keys(md5a))), 'ok', md5a = md5b,
    'changed', (select jsonb_agg(x.key) from jsonb_each_text(md5b) x where md5a->>x.key is distinct from x.value),
    'gone', (select jsonb_agg(x.key) from jsonb_each_text(md5a) x where not md5b ? x.key));
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into fns_b from pg_proc p where p.pronamespace = 'public'::regnamespace and ${sig} <> all (fns_a);
  res := res || jsonb_build_object('case', 'T1 exactly the 4 new functions are added', 'ok', fns_b = (select array_agg(x order by x) from unnest(mine) x), 'added', fns_b);
  res := res || jsonb_build_object('case', 'T1 the flag combat_v2 does not change (progress stays false)', 'ok',
    (select value from public.balance where key = 'combat_v2') = flag_a and flag_a->'progress' = 'false'::jsonb);
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into callers_b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(';
  res := res || jsonb_build_object('case', 'T1 the readers of combat_v2_on = before + spend_card_points_v2 and reset_card_points_v2', 'ok',
    callers_b = (select array_agg(x order by x) from (select unnest(callers_a) x union select unnest(readers)) q), 'now', (select array_agg(x) from unnest(callers_b) x where x <> all (callers_a)));
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and ${sig} <> all (mine) and p.prosrc ~ '(spend_card_points_v2|reset_card_points_v2|stat_reset_gift_use_v2|card_progress_v2_view|card_progress_v2_ref_seq)'
     and p.proname <> 'card_progress_v2_reset';   -- M1d combat_v2_progress_freeze_v1.sql: the v2 reset, shared by reset_card_points_v2 and the Shop (its own test)
  res := res || jsonb_build_object('case', 'T1 no other function names a new function or the sequence', 'ok', cardinality(bad) = 0, 'names', bad);

  -- T2. server only
  bad := '{}';
  foreach k in array mine loop
    if has_function_privilege('anon', 'public.' || k, 'execute') or has_function_privilege('authenticated', 'public.' || k, 'execute') then bad := bad || ('anon or authenticated can execute ' || k); end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = ('public.' || k)::regprocedure and a.grantee = 0) or (select proacl is null from pg_proc where oid = ('public.' || k)::regprocedure) then bad := bad || ('public can execute ' || k); end if;
    if not has_function_privilege('service_role', 'public.' || k, 'execute') then bad := bad || ('service_role cannot execute ' || k); end if;
    if not exists (select 1 from pg_proc p where p.oid = ('public.' || k)::regprocedure and 'search_path=public' = any(p.proconfig)) then bad := bad || ('no search_path: ' || k); end if;
    if coalesce(obj_description(('public.' || k)::regprocedure, 'pg_proc'), '') !~ '^\[combat\] ' then bad := bad || ('no [combat] comment: ' || k); end if;
  end loop;
  if has_sequence_privilege('anon', 'public.card_progress_v2_ref_seq', 'USAGE,SELECT,UPDATE') or has_sequence_privilege('authenticated', 'public.card_progress_v2_ref_seq', 'USAGE,SELECT,UPDATE') then bad := bad || 'anon or authenticated has a sequence privilege'::text; end if;
  if not has_sequence_privilege('service_role', 'public.card_progress_v2_ref_seq', 'USAGE') then bad := bad || 'service_role cannot use the sequence'::text; end if;
  if coalesce(obj_description('public.card_progress_v2_ref_seq'::regclass, 'pg_class'), '') = '' then bad := bad || 'no comment on the sequence'::text; end if;
  res := res || jsonb_build_object('case', 'T2 server only: no execute for public, anon, authenticated; no sequence privilege; search_path; a [combat] comment each', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- the helpers of this block (pg_temp, gone with the rollback): a call that never raises, and a snapshot of every row the calls may write
  create function pg_temp.sp(p text, c bigint, a jsonb) returns jsonb language plpgsql as $q$
  begin return public.spend_card_points_v2(p, c, a); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.rs(p text, c bigint) returns jsonb language plpgsql as $q$
  begin return public.reset_card_points_v2(p, c); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.snap(p text, q text) returns jsonb language sql as $q$
    select jsonb_build_object(
      'log', (select count(*) from public.card_progress_v2_log),
      'rows', (select coalesce(jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id), '[]') from public.card_progress_v2 x where x.player_id in (p, q)),
      'gifts', (select coalesce(jsonb_agg(to_jsonb(g) order by g.player_id, g.gift), '[]') from public.stat_reset_gifts g where g.player_id in (p, q)),
      'week', (select jsonb_agg(stat_reset_week order by id) from public.players where id in (p, q))) $q$;
  -- T6: the ledger deltas of each progress row sum to the stored row (every column of the 9 stats, level, XP, bonus)
  create function pg_temp.t6(p text, q text) returns text[] language sql as $q$
    select coalesce(array_agg(x.id::text), '{}') from public.card_progress_v2 x
     where x.player_id in (p, q) and row(x.level, x.xp, x.bonus_points, x.atk_pts, x.def_pts, x.hp_pts, x.crd_pts, x.crt_pts, x.abl_pts, x.ddg_pts, x.acc_pts, x.spd_pts)::text
       is distinct from (select row(coalesce(sum(l.d_level), 0), coalesce(sum(l.d_xp), 0), coalesce(sum(l.d_bonus), 0),
          coalesce(sum(l.d_points) filter (where l.stat = 'atk'), 0), coalesce(sum(l.d_points) filter (where l.stat = 'def'), 0),
          coalesce(sum(l.d_points) filter (where l.stat = 'hp'), 0), coalesce(sum(l.d_points) filter (where l.stat = 'crd'), 0),
          coalesce(sum(l.d_points) filter (where l.stat = 'crt'), 0), coalesce(sum(l.d_points) filter (where l.stat = 'abl'), 0),
          coalesce(sum(l.d_points) filter (where l.stat = 'ddg'), 0), coalesce(sum(l.d_points) filter (where l.stat = 'acc'), 0),
          coalesce(sum(l.d_points) filter (where l.stat = 'spd'), 0))::text
        from public.card_progress_v2_log l where l.progress_id = x.id) $q$;
  -- the expected stats: card_combat_v2 of the card, from its own source (rarity, stars, cp_mod, the role of subjects.ability_v2)
  create function pg_temp.want(p text, c bigint) returns jsonb language sql as $q$
    select public.card_combat_v2(cc.rarity::text, pc.ascension, s.cp_mod, x.level,
      jsonb_build_object('atk', x.atk_pts, 'def', x.def_pts, 'hp', x.hp_pts, 'crd', x.crd_pts, 'crt', x.crt_pts, 'abl', x.abl_pts, 'ddg', x.ddg_pts, 'acc', x.acc_pts, 'spd', x.spd_pts),
      s.ability_v2->>'role', public.combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed']), x.bonus_points)
      from public.card_progress_v2 x join public.player_cards pc on pc.player_id = x.player_id and pc.card_id = x.card_id
      join public.cards cc on cc.id = x.card_id left join public.subjects s on s.id = cc.subject_id
     where x.player_id = p and x.card_id = c $q$;

  -- the sample: two players and five cards that neither owns (added player_cards rows, rolled back)
  select p.id into v_p from public.players p where p.id ~ '^[0-9]{17,20}$' and exists (select 1 from public.player_cards pc where pc.player_id = p.id) order by p.id limit 1;
  select p.id into v_q from public.players p where p.id ~ '^[0-9]{17,20}$' and p.id > v_p and exists (select 1 from public.player_cards pc where pc.player_id = p.id) order by p.id limit 1;
  select c.id into c1 from public.cards c join public.subjects s on s.id = c.subject_id
   where s.ability_v2 is not null and not exists (select 1 from public.player_cards pc where pc.card_id = c.id and pc.player_id in (v_p, v_q)) order by c.id limit 1;
  select c.id into c5 from public.cards c join public.subjects s on s.id = c.subject_id
   where s.ability_v2 is not null and c.id > c1 and not exists (select 1 from public.player_cards pc where pc.card_id = c.id and pc.player_id in (v_p, v_q)) order by c.id limit 1;
  select c.id into c2 from public.cards c join public.subjects s on s.id = c.subject_id
   where s.ability_v2 is not null and c.id > c5 and not exists (select 1 from public.player_cards pc where pc.card_id = c.id and pc.player_id in (v_p, v_q)) order by c.id limit 1;
  select c.id into c3 from public.cards c
   where c.id > c2 and c.subject_id not in (select subject_id from public.cards where id in (c1, c2, c5))
     and not exists (select 1 from public.player_cards pc where pc.card_id = c.id and pc.player_id in (v_p, v_q)) order by c.id limit 1;
  select c.id into c4 from public.cards c where c.id > c3 and not exists (select 1 from public.player_cards pc where pc.card_id = c.id and pc.player_id in (v_p, v_q)) order by c.id limit 1;
  select c.id into c6 from public.cards c join public.subjects s on s.id = c.subject_id
   where s.ability_v2 is not null and c.id > c4 and c.subject_id <> (select subject_id from public.cards where id = c3)
     and not exists (select 1 from public.player_cards pc where pc.card_id = c.id and pc.player_id in (v_p, v_q)) order by c.id limit 1;
  if v_p is null or v_q is null or c1 is null or c2 is null or c3 is null or c4 is null or c5 is null or c6 is null then raise exception 'the sample: no players or no free cards'; end if;
  update public.subjects set ability_v2 = null where id = (select subject_id from public.cards where id = c3);   -- c3: a card with no v2 role
  insert into public.player_cards (player_id, card_id, quantity, first_source, ascension) values
    (v_p, c1, 1, 'admin', 2), (v_p, c5, 1, 'admin', 0), (v_p, c2, 1, 'admin', 0), (v_p, c3, 1, 'admin', 0), (v_q, c1, 1, 'admin', 1), (v_p, c6, 1, 'admin', 0);
  -- the progress rows, each with the ledger rows of its start (so T6 holds from the start)
  insert into public.card_progress_v2 (player_id, card_id, level, xp, bonus_points) values (v_p, c1, 5, card_level_xp_at(5), 3) returning id into pa;   -- budget 5 + 3
  insert into public.card_progress_v2 (player_id, card_id, level, xp) values (v_p, c5, 30, card_level_xp_at(30)) returning id into pb;               -- budget 30
  insert into public.card_progress_v2 (player_id, card_id, level, xp) values (v_p, c3, 2, card_level_xp_at(2)) returning id into pc3;
  insert into public.card_progress_v2 (player_id, card_id, level, xp, atk_pts) values (v_q, c1, 8, card_level_xp_at(8), 2) returning id into pq;
  insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp, d_points, d_bonus) values
    (pa, v_p, c1, 'grant_level', '', 'm1ctest', 5, card_level_xp_at(5), 0, 0), (pa, v_p, c1, 'refund', '', 'm1ctest', 0, 0, 0, 3),
    (pb, v_p, c5, 'grant_level', '', 'm1ctest', 30, card_level_xp_at(30), 0, 0),
    (pc3, v_p, c3, 'grant_level', '', 'm1ctest', 2, card_level_xp_at(2), 0, 0),
    (pq, v_q, c1, 'grant_level', '', 'm1ctest', 8, card_level_xp_at(8), 0, 0), (pq, v_q, c1, 'convert', 'atk', 'm1ctest', 0, 0, 2, 0);
  -- the gifts: the v1 gifts of the players stay as they are; a known v1 gift, a 'v2x' key (not v2_), an expired and a used v2 gift, and two open v2 gifts
  insert into public.stat_reset_gifts (player_id, gift, expires_at) values (v_p, 'r_test_2026_10', now() + interval '1 day') on conflict do nothing;
  insert into public.stat_reset_gifts (player_id, gift, granted_at, expires_at, used_at, used_card) values
    (v_p, 'v2xtest', now() - interval '2 days', now() + interval '1 hour', null, null),
    (v_p, 'v2_test_old', now() - interval '20 days', now() - interval '1 day', null, null),
    (v_p, 'v2_test_used', now() - interval '2 days', now() + interval '2 hours', now() - interval '1 day', c4),
    (v_p, 'v2_test_b', now() - interval '2 days', now() + interval '20 days', null, null),
    (v_p, 'v2_test_a', now() - interval '2 days', now() + interval '10 days', null, null);
  update public.players set stat_reset_week = null where id in (v_p, v_q);
  perform set_config('balance.by', 'm1c-test', true);
  flag_off := jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers', '[]'::jsonb);
  flag_testers := jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers', jsonb_build_array(v_p));
  flag_all := jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', true, 'testers', '[]'::jsonb);

  -- the gate: flag OFF -> disabled for both, nothing written
  update public.balance set value = flag_off where key = 'combat_v2';
  s0 := pg_temp.snap(v_p, v_q); bad := '{}';
  for rw in select * from (values (v_p, c1), (v_q, c1)) x(p, c) loop
    r := pg_temp.sp(rw.p, rw.c, '{"atk": 1}'); if r is distinct from '{"ok": false, "error": "disabled"}'::jsonb then bad := bad || ('spend: ' || coalesce(r->>'error', r->>'raised', 'ok')); end if;
    r := pg_temp.rs(rw.p, rw.c); if r is distinct from '{"ok": false, "error": "disabled"}'::jsonb then bad := bad || ('reset: ' || coalesce(r->>'error', r->>'raised', 'ok')); end if;
  end loop;
  res := res || jsonb_build_object('case', 'flag OFF: spend and reset answer disabled for every player and write nothing', 'ok', cardinality(bad) = 0 and pg_temp.snap(v_p, v_q) = s0, 'bad', bad);

  -- the tester list on (progress false): the non-tester is refused, the tester works
  update public.balance set value = flag_testers where key = 'combat_v2';
  s0 := pg_temp.snap(v_p, v_q); bad := '{}';
  r := pg_temp.sp(v_q, c1, '{"def": 1}'); if r is distinct from '{"ok": false, "error": "disabled"}'::jsonb then bad := bad || ('spend: ' || coalesce(r->>'error', r->>'raised', 'ok')); end if;
  r := pg_temp.rs(v_q, c1); if r is distinct from '{"ok": false, "error": "disabled"}'::jsonb then bad := bad || ('reset: ' || coalesce(r->>'error', r->>'raised', 'ok')); end if;
  res := res || jsonb_build_object('case', 'testers only: a non-tester gets disabled from spend and reset, nothing written', 'ok', cardinality(bad) = 0 and pg_temp.snap(v_p, v_q) = s0, 'bad', bad);
  -- the tester passes the gate of both (the card with no progress row: the answer no_progress, nothing written)
  bad := '{}';
  r := pg_temp.sp(v_p, c2, '{"atk": 1}'); if r is distinct from '{"ok": false, "error": "no_progress"}'::jsonb then bad := bad || ('spend: ' || r::text); end if;
  r := pg_temp.rs(v_p, c2); if r is distinct from '{"ok": false, "error": "no_progress"}'::jsonb then bad := bad || ('reset: ' || r::text); end if;
  res := res || jsonb_build_object('case', 'testers only: the tester passes the gate of spend and reset (no_progress on a card with no row, nothing written)', 'ok', cardinality(bad) = 0 and pg_temp.snap(v_p, v_q) = s0, 'bad', bad);
  r := pg_temp.sp(v_p, c1, '{"atk": 2, "spd": 1}'); ncalls := ncalls + 1;
  exp := jsonb_build_object('ok', true, 'progress', jsonb_build_object('level', 5, 'xp', card_level_xp_at(5), 'bonus', 3,
    'points', '{"atk": 2, "def": 0, "hp": 0, "crd": 0, "crt": 0, "abl": 0, "ddg": 0, "acc": 0, "spd": 1}'::jsonb, 'free', 5), 'stats', pg_temp.want(v_p, c1));
  res := res || jsonb_build_object('case', 'testers only: the tester spends (the answer: progress {level, xp, bonus, points, free} and stats = card_combat_v2 of the card)',
    'ok', r = exp and (r->'stats'->>'stars')::int = 2 and (r->'stats'->>'points_free')::int = 5, 'got', r - 'stats');
  select coalesce(array_agg(distinct ref), '{}') into refs from public.card_progress_v2_log where progress_id = pa and reason = 'spend';
  res := res || jsonb_build_object('case', 'the spend wrote one ledger row for each stat (atk 2, spd 1), one ref spend:<n> (the M1a ref rule)', 'ok',
    (select count(*) from public.card_progress_v2_log where progress_id = pa and reason = 'spend') = 2 and cardinality(refs) = 1 and refs[1] ~ '^spend:[0-9]+$'
    and (select d_points from public.card_progress_v2_log where progress_id = pa and reason = 'spend' and stat = 'atk') = 2
    and (select d_points from public.card_progress_v2_log where progress_id = pa and reason = 'spend' and stat = 'spd') = 1
    and (select bool_and(created_by = 'm1c-test') from public.card_progress_v2_log where progress_id = pa and reason = 'spend'));

  -- everyone ON: the player who is not a tester works
  update public.balance set value = flag_all where key = 'combat_v2';
  r := pg_temp.sp(v_q, c1, '{"def": 1}'); ncalls := ncalls + 1;
  res := res || jsonb_build_object('case', 'progress ON for everyone: the non-tester spends', 'ok', (r->>'ok')::boolean is true and r->'progress'->'points'->>'def' = '1' and (r->'progress'->>'free')::int = 5, 'got', r - 'stats');

  -- the spend refusals: each answer, and nothing written
  s0 := pg_temp.snap(v_p, v_q); bad := '{}';
  for rw in select * from (values
      ('null', null::text, c1, '{"ok": false, "error": "bad_request"}'), ('a list', '[1]', c1, '{"ok": false, "error": "bad_request"}'),
      ('empty', '{}', c1, '{"ok": false, "error": "bad_request"}'), ('a string', '"atk"', c1, '{"ok": false, "error": "bad_request"}'),
      ('a v1 stat', '{"attack": 1}', c1, '{"ok": false, "error": "bad_stat", "stat": "attack"}'),
      ('an unknown stat', '{"atk": 1, "luck": 1}', c1, '{"ok": false, "error": "bad_stat", "stat": "luck"}'),
      ('a capital', '{"ATK": 1}', c1, '{"ok": false, "error": "bad_stat", "stat": "ATK"}'),
      ('0', '{"atk": 0}', c1, '{"ok": false, "error": "bad_amount", "stat": "atk"}'), ('-1', '{"atk": -1}', c1, '{"ok": false, "error": "bad_amount", "stat": "atk"}'),
      ('1.5', '{"atk": 1.5}', c1, '{"ok": false, "error": "bad_amount", "stat": "atk"}'), ('a text 2', '{"atk": "2"}', c1, '{"ok": false, "error": "bad_amount", "stat": "atk"}'),
      ('100', '{"hp": 100}', c1, '{"ok": false, "error": "bad_amount", "stat": "hp"}'), ('true', '{"hp": true}', c1, '{"ok": false, "error": "bad_amount", "stat": "hp"}'),
      ('null amount', '{"hp": null}', c1, '{"ok": false, "error": "bad_amount", "stat": "hp"}'),
      ('one bad of two', '{"atk": 1, "def": 0}', c1, '{"ok": false, "error": "bad_amount", "stat": "def"}'),
      ('not owned', '{"atk": 1}', c4, '{"ok": false, "error": "not_owned"}'),
      ('no progress row', '{"atk": 1}', c2, '{"ok": false, "error": "no_progress"}'),
      ('no v2 role', '{"atk": 1}', c3, '{"ok": false, "error": "no_role"}'),
      ('above the budget (5 + 3 bonus, 3 spent: 6)', '{"crd": 6}', c1, '{"ok": false, "error": "not_enough", "free": 5}'),
      ('above the budget with two stats', '{"crd": 3, "acc": 3}', c1, '{"ok": false, "error": "not_enough", "free": 5}'),
      ('a stat above the cap (11)', '{"def": 11}', c5, '{"ok": false, "error": "stat_cap", "cap": 10}'),
      ('spd above the cap (11)', '{"spd": 11}', c5, '{"ok": false, "error": "stat_cap", "cap": 10}'),
      ('ddg above the cap (11)', '{"ddg": 11}', c5, '{"ok": false, "error": "stat_cap", "cap": 10}')) x(name, a, c, want) loop
    r := pg_temp.sp(v_p, rw.c, rw.a::jsonb);
    if r is distinct from rw.want::jsonb then bad := bad || (rw.name || ': ' || r::text); end if;
  end loop;
  res := res || jsonb_build_object('case', 'the spend refuses 23 bad calls with the answer of each error code (no raised error) and writes nothing', 'ok', cardinality(bad) = 0 and pg_temp.snap(v_p, v_q) = s0, 'bad', bad);

  -- the boundaries: the bonus points, the level budget, the stat cap
  bad := '{}';
  r := pg_temp.sp(v_p, c1, '{"crd": 4, "acc": 1}'); ncalls := ncalls + 1;   -- 3 + 5 = 8 = level 5 + bonus 3: uses the bonus
  if (r->>'ok')::boolean is not true or (r->'progress'->>'free')::int <> 0 then bad := bad || ('the last free point with the bonus: ' || r::text); end if;
  if r->'stats' is distinct from pg_temp.want(v_p, c1) then bad := bad || 'the stats with the bonus are not card_combat_v2 of the card'::text; end if;
  r := pg_temp.sp(v_p, c1, '{"hp": 1}');
  if r is distinct from '{"ok": false, "error": "not_enough", "free": 0}'::jsonb then bad := bad || ('one point above the budget: ' || r::text); end if;
  r := pg_temp.sp(v_p, c5, '{"def": 10, "spd": 9}'); ncalls := ncalls + 1;   -- the cap 10
  if (r->>'ok')::boolean is not true then bad := bad || ('10 points (the cap): ' || r::text); end if;
  r := pg_temp.sp(v_p, c5, '{"def": 1}');
  if r is distinct from '{"ok": false, "error": "stat_cap", "cap": 10}'::jsonb then bad := bad || ('the 11th point: ' || r::text); end if;
  r := pg_temp.sp(v_p, c5, '{"spd": 1}'); ncalls := ncalls + 1;
  if (r->>'ok')::boolean is not true or r->'progress'->'points'->>'spd' <> '10' then bad := bad || ('spd to the cap: ' || r::text); end if;
  r := pg_temp.sp(v_p, c5, '{"spd": 1}');
  if r is distinct from '{"ok": false, "error": "stat_cap", "cap": 10}'::jsonb then bad := bad || ('spd 11: ' || r::text); end if;
  r := pg_temp.sp(v_p, c5, '{"atk": 10, "hp": 1}');   -- 10 + 10 + 10 + 1 = 31 points at level 30
  if r is distinct from '{"ok": false, "error": "not_enough", "free": 10}'::jsonb then bad := bad || ('31 points at level 30: ' || r::text); end if;
  res := res || jsonb_build_object('case', 'the boundaries: the last point of level + bonus spends, one more is not_enough (free 0); 10 points in a stat spend, the 11th is stat_cap; level 30 gives 30', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- the limits come from balance
  bad := '{}';
  update public.balance set value = jsonb_set(value, '{max_per_stat}', '12') where key = 'v2_stats';
  r := pg_temp.sp(v_p, c5, '{"def": 2}'); ncalls := ncalls + 1;
  if (r->>'ok')::boolean is not true then bad := bad || ('max_per_stat 12: 12 refused: ' || r::text); end if;
  r := pg_temp.sp(v_p, c5, '{"def": 1}');
  if r is distinct from '{"ok": false, "error": "stat_cap", "cap": 12}'::jsonb then bad := bad || ('max_per_stat 12: 13: ' || r::text); end if;
  update public.balance set value = jsonb_set(value, '{max_per_stat}', '10') where key = 'v2_stats';
  update public.balance set value = jsonb_set(value, '{points_per_level}', '2') where key = 'v2_level';
  r := pg_temp.sp(v_p, c1, '{"hp": 5}'); ncalls := ncalls + 1;   -- level 5 x 2 + 3 = 13
  if (r->>'ok')::boolean is not true or (r->'progress'->>'free')::int <> 0 then bad := bad || ('points_per_level 2: 13 points refused: ' || r::text); end if;
  r := pg_temp.sp(v_p, c1, '{"hp": 1}');
  if r is distinct from '{"ok": false, "error": "not_enough", "free": 0}'::jsonb then bad := bad || ('points_per_level 2: 14: ' || r::text); end if;
  update public.balance set value = jsonb_set(value, '{points_per_level}', '1') where key = 'v2_level';
  res := res || jsonb_build_object('case', 'the limits come from balance: v2_stats.max_per_stat 12 and v2_level.points_per_level 2 each move their limit', 'ok', cardinality(bad) = 0, 'bad', bad);
  -- back to today's balance: the c1 row has 13 points spent, above the budget of 8 now. Reset it later (the reset needs no budget).

  -- the ledger FIRST: a ref collision raises and changes no row (an update first, then an insert with "on conflict do nothing", would change
  -- the row and lose the ledger row: a retry gives a double)
  nxt := nextval('public.card_progress_v2_ref_seq');
  insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_points) values (pq, v_q, c1, 'spend', 'crt', 'spend:' || (nxt + 1), 1);
  s0 := pg_temp.snap(v_p, v_q);
  r := pg_temp.sp(v_q, c1, '{"crt": 1}');
  s1 := pg_temp.snap(v_p, v_q);
  delete from public.card_progress_v2_log where progress_id = pq and ref = 'spend:' || (nxt + 1);
  res := res || jsonb_build_object('case', 'the ledger first: a spend whose ref is taken raises and changes no row', 'ok', r ? 'raised' and s1 = s0, 'got', r - 'stats');

  -- one ref for each call, never shared: the same stat twice in a row
  r := pg_temp.sp(v_q, c1, '{"crt": 1}'); ncalls := ncalls + 1;
  s1 := pg_temp.sp(v_q, c1, '{"crt": 1}'); ncalls := ncalls + 1;
  res := res || jsonb_build_object('case', 'the same stat spent twice: both work, with two refs', 'ok', (r->>'ok')::boolean is true and (s1->>'ok')::boolean is true
    and (select count(distinct ref) from public.card_progress_v2_log where progress_id = pq and reason = 'spend' and stat = 'crt') = 2, 'got', jsonb_build_array(r - 'stats', s1 - 'stats'));

  -- the reset
  bad := '{}';
  update public.players set stat_reset_week = null where id = v_p;
  s0 := pg_temp.snap(v_p, v_q);
  r := pg_temp.rs(v_p, c4); if r is distinct from '{"ok": false, "error": "not_owned"}'::jsonb then bad := bad || ('not owned: ' || r::text); end if;
  r := pg_temp.rs(v_p, c2); if r is distinct from '{"ok": false, "error": "no_progress"}'::jsonb then bad := bad || ('no progress: ' || r::text); end if;
  r := pg_temp.rs(v_p, c3); if r is distinct from '{"ok": false, "error": "no_role"}'::jsonb then bad := bad || ('no role: ' || r::text); end if;
  r := pg_temp.rs('m1c-no-such-player', c1); if r is distinct from '{"ok": false, "error": "no_player"}'::jsonb then bad := bad || ('no player: ' || r::text); end if;
  res := res || jsonb_build_object('case', 'the reset refuses not_owned, no_progress, no_role, no_player and writes nothing (the week stays free)', 'ok', cardinality(bad) = 0 and pg_temp.snap(v_p, v_q) = s0, 'bad', bad);

  -- nothing spent: a row with no points (c3 has no role, so a new row on c2)
  insert into public.card_progress_v2 (player_id, card_id, level, xp, bonus_points) values (v_p, c2, 1, card_level_xp_at(1), 0);
  insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp) select id, v_p, c2, 'grant_level', '', 'm1ctest', 1, card_level_xp_at(1) from public.card_progress_v2 where player_id = v_p and card_id = c2;
  s0 := pg_temp.snap(v_p, v_q);
  r := pg_temp.rs(v_p, c2);
  res := res || jsonb_build_object('case', 'nothing spent: the answer nothing_spent, the weekly reset stays free, nothing written', 'ok', r = '{"ok": false, "error": "nothing_spent"}'::jsonb and pg_temp.snap(v_p, v_q) = s0, 'got', r);

  -- 1. the weekly free reset (c1: 13 points, level 5, bonus 3)
  select to_jsonb(x) - 'updated_at' into s0 from public.card_progress_v2 x where id = pa;
  r := pg_temp.rs(v_p, c1); ncalls := ncalls + 1;
  select to_jsonb(x) - 'updated_at' into s1 from public.card_progress_v2 x where id = pa;
  select stat_reset_week into marker_p from public.players where id = v_p;
  exp := jsonb_build_object('ok', true, 'used', 'week', 'progress', jsonb_build_object('level', 5, 'xp', card_level_xp_at(5), 'bonus', 3,
    'points', '{"atk": 0, "def": 0, "hp": 0, "crd": 0, "crt": 0, "abl": 0, "ddg": 0, "acc": 0, "spd": 0}'::jsonb, 'free', 8), 'stats', pg_temp.want(v_p, c1));
  res := res || jsonb_build_object('case', 'reset 1: the weekly free reset; 9 stats to 0; level, XP and bonus unchanged; the marker = this Mountain week; no gift used', 'ok',
    r = exp and s1 = s0 || '{"atk_pts": 0, "def_pts": 0, "hp_pts": 0, "crd_pts": 0, "crt_pts": 0, "abl_pts": 0, "ddg_pts": 0, "acc_pts": 0, "spd_pts": 0}'::jsonb
    and marker_p = v_week and not exists (select 1 from public.stat_reset_gifts where player_id = v_p and used_card = c1), 'got', r - 'stats');
  res := res || jsonb_build_object('case', 'reset 1 ledger: one row for each stat above 0 (atk, spd, crd, acc, hp), d_points = minus the count, one ref reset:<n>', 'ok',
    (select count(*) = 5 and count(distinct ref) = 1 and min(ref) ~ '^reset:[0-9]+$' and sum(d_points) = -13 and bool_and(d_points < 0)
       and string_agg(stat || d_points, ',' order by stat) = 'acc-1,atk-2,crd-4,hp-5,spd-1' from public.card_progress_v2_log where progress_id = pa and reason = 'reset'));

  -- 2. and 3. the week is used: the v2 gifts, the earliest deadline first (never 'v2xtest', the expired, the used or a v1 gift)
  bad := '{}';
  r := pg_temp.sp(v_p, c1, '{"atk": 1}'); ncalls := ncalls + 1;
  r := pg_temp.rs(v_p, c1); ncalls := ncalls + 1;
  if r->>'used' is distinct from 'gift' or (select used_card from public.stat_reset_gifts where player_id = v_p and gift = 'v2_test_a') is distinct from c1
     or (select used_at from public.stat_reset_gifts where player_id = v_p and gift = 'v2_test_b') is not null then bad := bad || ('reset 2: ' || r::text); end if;
  r := pg_temp.sp(v_p, c1, '{"def": 2}'); ncalls := ncalls + 1;
  r := pg_temp.rs(v_p, c1); ncalls := ncalls + 1;
  if r->>'used' is distinct from 'gift' or (select used_card from public.stat_reset_gifts where player_id = v_p and gift = 'v2_test_b') is distinct from c1 then bad := bad || ('reset 3: ' || r::text); end if;
  res := res || jsonb_build_object('case', 'resets 2 and 3: the week is used, so the open v2 gifts, the earliest deadline first, each marked with the card', 'ok', cardinality(bad) = 0
    and (select stat_reset_week from public.players where id = v_p) = v_week, 'bad', bad);

  -- 4. no free reset left: reset_used with next; nothing written; the v1 gifts, 'v2xtest', the expired and the used gift are untouched
  r := pg_temp.sp(v_p, c1, '{"abl": 1}'); ncalls := ncalls + 1;
  s0 := pg_temp.snap(v_p, v_q);
  r := pg_temp.rs(v_p, c1);
  res := res || jsonb_build_object('case', 'reset 4: reset_used with next (the next Mountain week), nothing written', 'ok',
    r = jsonb_build_object('ok', false, 'error', 'reset_used', 'next', (date_trunc('week', now() at time zone 'America/Denver') + interval '7 days') at time zone 'America/Denver')
    and pg_temp.snap(v_p, v_q) = s0, 'got', r);
  res := res || jsonb_build_object('case', 'the v2 reset never takes a v1 gift (r_*), a v2x key, an expired or a used v2 gift', 'ok',
    not exists (select 1 from public.stat_reset_gifts where player_id = v_p and gift !~ '^v2_test_[ab]$' and used_card = c1)
    and exists (select 1 from public.stat_reset_gifts where player_id = v_p and gift = 'r_test_2026_10' and used_at is null)
    and (select used_card from public.stat_reset_gifts where player_id = v_p and gift = 'v2_test_used') = c4);
  -- a v1 gift alone never gives a v2 reset
  delete from public.stat_reset_gifts where player_id = v_p and gift like 'v2%';
  r := pg_temp.rs(v_p, c1);
  res := res || jsonb_build_object('case', 'with only v1 gifts open (and the week used): reset_used, the v1 gifts stay open', 'ok', r->>'error' = 'reset_used'
    and (select count(*) from public.stat_reset_gifts where player_id = v_p and used_at is null and expires_at > now()) >= 1
    and not exists (select 1 from public.stat_reset_gifts where player_id = v_p and used_card = c1));
  -- a new week: the weekly reset again
  update public.players set stat_reset_week = '2000-01' where id = v_p;
  r := pg_temp.rs(v_p, c1); ncalls := ncalls + 1;
  res := res || jsonb_build_object('case', 'an older week in the marker: the weekly reset again, the marker = this week', 'ok', r->>'used' = 'week'
    and (select stat_reset_week from public.players where id = v_p) = v_week, 'got', r - 'stats');
  -- the reset of the other player (progress ON): its own week marker
  r := pg_temp.rs(v_q, c1); ncalls := ncalls + 1;
  res := res || jsonb_build_object('case', 'the reset of a second player uses its own week (the first player''s marker does not count)', 'ok', r->>'used' = 'week'
    and (select stat_reset_week from public.players where id = v_q) = v_week and (select atk_pts + crt_pts + def_pts from public.card_progress_v2 where id = pq) = 0, 'got', r - 'stats');

  -- M1d: each of the 9 stats spent twice (1, then 2): every stat must be 3 (an absolute write gives 2)
  insert into public.card_progress_v2 (player_id, card_id, level, xp) values (v_p, c6, 30, card_level_xp_at(30)) returning id into p6;
  insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp) values (p6, v_p, c6, 'grant_level', '', 'm1ctest', 30, card_level_xp_at(30));
  r := pg_temp.sp(v_p, c6, '{"atk": 1, "def": 1, "hp": 1, "crd": 1, "crt": 1, "abl": 1, "ddg": 1, "acc": 1, "spd": 1}'); ncalls := ncalls + 1;
  s1 := pg_temp.sp(v_p, c6, '{"atk": 2, "def": 2, "hp": 2, "crd": 2, "crt": 2, "abl": 2, "ddg": 2, "acc": 2, "spd": 2}'); ncalls := ncalls + 1;
  res := res || jsonb_build_object('case', 'each of the 9 stats spent twice (1, then 2): each stat is 3 in the answer and in the stored row (the + write)', 'ok',
    (r->>'ok')::boolean is true and s1->'progress'->'points' = '{"atk": 3, "def": 3, "hp": 3, "crd": 3, "crt": 3, "abl": 3, "ddg": 3, "acc": 3, "spd": 3}'::jsonb
    and (select row(atk_pts, def_pts, hp_pts, crd_pts, crt_pts, abl_pts, ddg_pts, acc_pts, spd_pts)::text from public.card_progress_v2 where id = p6) = '(3,3,3,3,3,3,3,3,3)'
    and (s1->'progress'->>'free')::int = 3, 'got', s1->'progress');

  -- T6 and the refs: the ledger sums to the stored rows; one ref for each call that wrote, never shared
  res := res || jsonb_build_object('case', 'T6: the ledger deltas of each progress row sum to the stored row (level, XP, bonus, the 9 stats) after the spends and resets', 'ok',
    cardinality(pg_temp.t6(v_p, v_q)) = 0, 'rows', pg_temp.t6(v_p, v_q));
  res := res || jsonb_build_object('case', format('each spend and reset call has its own ref (%s calls wrote: %s refs; no ref on two progress rows)', ncalls,
      (select count(distinct ref) from public.card_progress_v2_log where reason in ('spend', 'reset') and ref ~ '^(spend|reset):' and player_id in (v_p, v_q))), 'ok',
    (select count(distinct ref) from public.card_progress_v2_log where reason in ('spend', 'reset') and ref ~ '^(spend|reset):[0-9]+$' and player_id in (v_p, v_q)) = ncalls
    and not exists (select 1 from public.card_progress_v2_log where reason in ('spend', 'reset') and player_id in (v_p, v_q) group by ref having count(distinct progress_id) > 1)
    and not exists (select 1 from public.card_progress_v2_log where reason in ('spend', 'reset') and player_id in (v_p, v_q) and ref !~ '^(spend|reset):[0-9]+$'));

  -- the file runs twice: the rows stay, the sequence goes on (never back to 1)
  s0 := pg_temp.snap(v_p, v_q);
  nxt := nextval('public.card_progress_v2_ref_seq');
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'a second run of the file keeps the rows and the sequence goes on', 'ok',
    pg_temp.snap(v_p, v_q) = s0 and nextval('public.card_progress_v2_ref_seq') = nxt + 1);

  -- M1d: the reset at 6 fixed instants. now() cannot be set in Postgres, so the block makes the reset and the v2 gift use again with now()
  -- read from a test clock (the setting m1c.now) and the session in UTC (the server time zone of live). The Mountain week 43 ends on Sunday
  -- 2026-10-25 at 24:00 MDT = Monday 06:00 UTC; week 45 ends on Sunday 2026-11-08 at 24:00 MST = Monday 07:00 UTC. A week in UTC differs
  -- only on Sunday 18:00 (17:00 in winter) to 24:00 Mountain time: the instants 19:00 MDT and 18:30 MST are in that window.
  perform set_config('timezone', 'UTC', true);
  create function pg_temp.m1c_now() returns timestamptz language sql stable as $q$ select current_setting('m1c.now')::timestamptz $q$;
  execute replace(pg_get_functiondef('public.reset_card_points_v2(text, bigint)'::regprocedure), 'now()', 'pg_temp.m1c_now()');
  execute replace(pg_get_functiondef('public.stat_reset_gift_use_v2(text, bigint)'::regprocedure), 'now()', 'pg_temp.m1c_now()');
  update public.balance set value = flag_all where key = 'combat_v2';
  update public.players set stat_reset_week = null where id = v_q;
  insert into public.stat_reset_gifts (player_id, gift, expires_at) values (v_q, 'v2_m1c_clock', '2026-12-31 00:00:00+00');
  ck := '[]';
  foreach k in array array['2026-10-25 17:59:00-06', '2026-10-25 19:00:00-06', '2026-10-25 19:00:00-06', '2026-10-26 00:00:00-06', '2026-11-08 17:30:00-07', '2026-11-08 18:30:00-07'] loop
    perform set_config('m1c.now', k, true);
    r := pg_temp.sp(v_q, c1, '{"atk": 1}');
    r := pg_temp.rs(v_q, c1);
    ck := ck || jsonb_build_array(jsonb_build_array(coalesce(r->>'used', r->>'error', r->>'raised'), (select stat_reset_week from public.players where id = v_q), r->'next'));
  end loop;
  res := res || jsonb_build_object('case', 'the Mountain week at 6 fixed instants: week (Sun 17:59 MDT), gift and reset_used (Sun 19:00 MDT: still week 43, UTC is Monday), week 44 (Mon 00:00 MDT), week 45 (Sun 17:30 MST), reset_used (Sun 18:30 MST); next = the Monday 00:00 MT', 'ok',
    ck = jsonb_build_array(jsonb_build_array('week', '2026-43', null), jsonb_build_array('gift', '2026-43', null),
      jsonb_build_array('reset_used', '2026-43', to_jsonb('2026-10-26 06:00:00+00'::timestamptz)), jsonb_build_array('week', '2026-44', null),
      jsonb_build_array('week', '2026-45', null), jsonb_build_array('reset_used', '2026-45', to_jsonb('2026-11-09 07:00:00+00'::timestamptz))), 'got', ck);

  raise exception 'RESULT:%', res::text;
end $t$;`;

let results;
try { results = JSON.parse(await runBlock(body)); }
catch (e) { console.log(`FAIL the test block raised (the file did not apply?): ${String(e.message).slice(0, 600)}`); console.log('1 of 1 FAILED'); process.exit(1); }
let fail = 0;
for (const r of results) {
  const { case: name, ok, ...rest } = r;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 900)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
