import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_progress_tables.sql (combat v2 step M1a: the tables card_progress_v2 and card_progress_v2_log).
 * NO lasting change: one DO block, undone by its final RAISE. The block first puts back the state before the file (no tables, no trigger
 * functions), so the test passes before and after the file is applied. The sample rows use a card that the sample player does not own
 * (an added player_cards row); nothing is printed about a member (aggregates and case names only).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-progress-tables.mjs     must PASS
 *   MUTATE=<name> ...                                                                                   must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                      the baseline (must PASS), then every mutation, one line each
 * Invariants:
 *   T1 (flag OFF identity): the md5 of every other public function does not change; combat_v2 (with progress = false) does not change;
 *      the triggers of player_cards do not change; no function except the two new triggers names the new tables or the new functions.
 *   T2 (the shape): the columns (name, type, not null, default), the keys (primary, unique, the foreign key to player_cards ON DELETE CASCADE),
 *      the triggers, a comment on each table, column and new function, RLS on with no policy, anon and authenticated have no table or
 *      function privilege, service_role has them. Both tables are empty after the file.
 *   The checks: the level, stat and budget limits and the XP of the level come from balance (a changed balance number moves each limit);
 *      negative counts, a key change, a missing player_cards row are refused; the ledger refuses a duplicate key, a bad reason, a bad stat,
 *      a bad xp ref, the wrong deltas of a reason, an update, a row with no progress row or another player; created_by = balance_who().
 *   The FK cascade: deleting the player_cards row deletes the progress row; the ledger rows stay.
 *   The file runs twice: the second run keeps the rows and adds no constraint, index or trigger.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-progress-tables.mjs');

const FILE = process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/combat_v2_progress_tables.sql', import.meta.url));
let mig = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');

const MUT = {
  fk_no_cascade: [' references public.player_cards (player_id, card_id) on delete cascade', ' references public.player_cards (player_id, card_id)'],
  no_rls: ['alter table public.card_progress_v2 enable row level security;\n', ''],
  log_no_rls: ['alter table public.card_progress_v2_log enable row level security;\n', ''],
  grant_anon: ['revoke all on public.card_progress_v2 from public, anon, authenticated;\n', 'revoke all on public.card_progress_v2 from public, anon, authenticated;\ngrant select on public.card_progress_v2 to anon;\n'],
  fn_exec_auth: ["execute format('grant execute on function public.%s to service_role', f);", "execute format('grant execute on function public.%s to service_role, authenticated', f);"],
  cap_fixed: ["v_cap int := balance_num('v2_stats', 'max_per_stat')::int;", 'v_cap int := 10;'],
  cap_off: ['new.acc_pts, new.spd_pts) > v_cap then', 'new.acc_pts, new.spd_pts) > v_cap + 100 then'],
  cap_skips_spd: ['new.ddg_pts, new.acc_pts, new.spd_pts) > v_cap then', 'new.ddg_pts, new.acc_pts) > v_cap then'],
  max_level_off: ['if new.level > v_max then', 'if new.level > v_max + 1 then'],
  ppl_fixed: ["v_ppl int := balance_num('v2_level', 'points_per_level')::int;", 'v_ppl int := 1;'],
  budget_no_bonus: ['if v_spent > new.level * v_ppl + new.bonus_points then', 'if v_spent > new.level * v_ppl then'],
  budget_off: ['if v_spent > new.level * v_ppl + new.bonus_points then', 'if false then'],
  budget_no_def: ['v_spent int := new.atk_pts + new.def_pts + new.hp_pts', 'v_spent int := new.atk_pts + new.hp_pts'],
  xp_low_ok: ['if new.xp < v_at or (', 'if false or ('],
  xp_high_ok: ['(new.level < v_max and new.xp >= v_next)', '(false)'],
  xp_cost_fixed: ["v_base numeric := balance_num('card_level', 'cost_base');", 'v_base numeric := 5;'],
  key_change_ok: ["if tg_op = 'UPDATE' and (new.id, new.player_id, new.card_id) is distinct from", "if false and (new.id, new.player_id, new.card_id) is distinct from"],
  neg_bonus_ok: ['bonus_points integer not null default 0 check (bonus_points >= 0),', 'bonus_points integer not null default 0,'],
  log_no_unique: ['  unique (progress_id, reason, stat, ref),\n', ''],
  log_unique_no_ref: ['unique (progress_id, reason, stat, ref),', 'unique (progress_id, reason, stat),'],
  log_reason_other: ["'xp', 'spend', 'reset')),", "'xp', 'spend', 'reset', 'other')),"],
  log_stat_v1: ["'ddg', 'acc', 'spd')),", "'ddg', 'acc', 'spd', 'potency')),"],
  log_reset_positive: ["when 'reset'       then d_points < 0", "when 'reset'       then d_points <> 0"],
  log_xp_any_ref: [" and ref ~ '^(hunt|dungeon):[0-9]{4}-[0-9]{2}-[0-9]{2}$'", ''],
  log_grant_points: ["when 'grant_level' then d_level > 0 and d_xp >= 0 and d_points = 0", "when 'grant_level' then d_level > 0 and d_xp >= 0"],
  log_convert_no_stat: ["else                    d_points > 0 and d_level = 0 and d_xp = 0 and d_bonus = 0 and stat <> ''", "else                    d_points > 0 and d_level = 0 and d_xp = 0 and d_bonus = 0"],
  log_update_ok: ["  if tg_op = 'UPDATE' then\n    raise exception 'card_progress_v2_log: a ledger row never changes", "  if false then\n    raise exception 'card_progress_v2_log: a ledger row never changes"],
  log_no_progress_check: ['if not exists (select 1 from public.card_progress_v2 p where p.id = new.progress_id and p.player_id = new.player_id', 'if not exists (select 1 from public.card_progress_v2 p where p.id = p.id and p.player_id = p.player_id'],
  log_fk_cascade: ['  progress_id bigint not null,\n', '  progress_id bigint not null references public.card_progress_v2 (id) on delete cascade,\n'],
  log_who_fixed: ['new.created_by := balance_who();', "new.created_by := 'unknown';"],
  comment_missing: ['comment on column public.card_progress_v2.bonus_points is', '-- comment on column public.card_progress_v2.bonus_points is'],
  flag_on: ['-- ============================================================ 3. server only', "update public.balance set value = jsonb_set(value, '{progress}', 'true') where key = 'combat_v2';\n-- ============================================================ 3. server only"],
  pc_trigger: ['-- ============================================================ 3. server only', 'create trigger card_progress_v2_probe after insert on public.player_cards for each row execute function public.card_progress_v2_check();\n-- ============================================================ 3. server only'],
  reader_fn: ['-- ============================================================ 3. server only', 'create or replace function public.card_progress_v2_probe() returns int language sql stable as $p$ select count(*)::int from public.card_progress_v2 $p$;\n-- ============================================================ 3. server only'],
  other_fn_changed: ['-- ============================================================ 3. server only', `create or replace function public.balance_who() returns text language sql stable set search_path to 'public' as $p$
  select coalesce(nullif(current_setting('balance.by', true), ''), session_user::text) || '';
$p$;
-- ============================================================ 3. server only`],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)        ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(22)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once`);
  mig = mig.split(m[0]).join(m[1]);
}
if (['$m$', '$t$'].some((x) => mig.includes(x))) throw new Error('the SQL must not contain $m$ or $t$');

const MINE = ['card_progress_v2_check()', 'card_progress_v2_log_check()'];
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
// the expected columns: name, type, not null, default (the identity columns have no default text)
const COLS = {
  card_progress_v2: [['id', 'bigint', true, null], ['player_id', 'text', true, null], ['card_id', 'bigint', true, null], ['level', 'integer', true, '0'], ['xp', 'integer', true, '0'],
    ...['atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd'].map((s) => [`${s}_pts`, 'smallint', true, '0']),
    ['bonus_points', 'integer', true, '0'], ['created_at', 'timestamp with time zone', true, 'now()'], ['updated_at', 'timestamp with time zone', true, 'now()']],
  card_progress_v2_log: [['id', 'bigint', true, null], ['progress_id', 'bigint', true, null], ['player_id', 'text', true, null], ['card_id', 'bigint', true, null],
    ['reason', 'text', true, null], ['stat', 'text', true, "''::text"], ['ref', 'text', true, null], ['d_level', 'integer', true, '0'], ['d_xp', 'integer', true, '0'],
    ['d_points', 'integer', true, '0'], ['d_bonus', 'integer', true, '0'], ['note', 'text', false, null], ['created_at', 'timestamp with time zone', true, 'now()'],
    ['created_by', 'text', true, "'unknown'::text"]],
};
const colsJson = JSON.stringify(Object.fromEntries(Object.entries(COLS).map(([t, cs]) => [t, cs.map(([n, ty, nn, d]) => ({ n, ty, nn, d }))])));

const body = String.raw`do $t$
declare res jsonb := '[]'; bad text[] := '{}'; ok boolean; md5a jsonb; md5b jsonb; flag_a jsonb; trg_a text[]; trg_b text[]; callers_a text[]; callers_b text[];
  mine text[] := array[${MINE.map(lit).join(', ')}]; v_p text; v_c bigint; v_c2 bigint; pid bigint; got jsonb; k text; rw record; n_con int; n_idx int; n_trg int;
  exp jsonb := ${lit(colsJson)}::jsonb;
begin
  -- 0. the state before the file (also when the file is applied on this copy)
  drop table if exists public.card_progress_v2_log;
  drop table if exists public.card_progress_v2;
  drop function if exists public.card_progress_v2_check();
  drop function if exists public.card_progress_v2_log_check();
  select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) into md5a from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text <> all (mine);
  select value into flag_a from public.balance where key = 'combat_v2';
  select coalesce(array_agg(tgname::text order by 1), '{}') into trg_a from pg_trigger where tgrelid = 'public.player_cards'::regclass and not tgisinternal;
  select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') into callers_a from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(';

  execute $m$${mig}$m$;

  -- T2. the shape
  bad := '{}';
  for k in select jsonb_object_keys(exp) loop
    select jsonb_agg(jsonb_build_object('n', a.attname, 'ty', format_type(a.atttypid, a.atttypmod), 'nn', a.attnotnull, 'd', pg_get_expr(d.adbin, d.adrelid)) order by a.attnum) into got
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = ('public.' || k)::regclass and a.attnum > 0 and not a.attisdropped;
    if got is distinct from exp->k then bad := bad || (k || ': ' || got::text); end if;
  end loop;
  res := res || jsonb_build_object('case', 'T2 the columns of both tables (name, type, not null, default)', 'ok', cardinality(bad) = 0, 'bad', bad);

  ok := (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.card_progress_v2'::regclass and c.contype = 'p') = 'PRIMARY KEY (player_id, card_id)'
    and (select count(*) from pg_constraint c where c.conrelid = 'public.card_progress_v2'::regclass and c.contype = 'u' and pg_get_constraintdef(c.oid) = 'UNIQUE (id)') = 1
    and (select count(*) from pg_constraint c where c.conrelid = 'public.card_progress_v2'::regclass and c.contype = 'f') = 1
    and (select c.confrelid = 'public.player_cards'::regclass and c.confdeltype = 'c' and pg_get_constraintdef(c.oid) ~ '^FOREIGN KEY \(player_id, card_id\) REFERENCES (public\.)?player_cards\(player_id, card_id\) ON DELETE CASCADE$'
           from pg_constraint c where c.conrelid = 'public.card_progress_v2'::regclass and c.contype = 'f')
    and (select count(*) from pg_constraint c where c.conrelid = 'public.card_progress_v2_log'::regclass and c.contype = 'f') = 0
    and (select count(*) from pg_constraint c where c.conrelid = 'public.card_progress_v2_log'::regclass and c.contype = 'u' and pg_get_constraintdef(c.oid) = 'UNIQUE (progress_id, reason, stat, ref)') = 1;
  res := res || jsonb_build_object('case', 'T2 the keys: progress PK (player, card), unique id, FK to player_cards ON DELETE CASCADE; ledger unique (progress_id, reason, stat, ref), no FK', 'ok', coalesce(ok, false));

  ok := (select array_agg(tgname::text order by 1) from pg_trigger where tgrelid = 'public.card_progress_v2'::regclass and not tgisinternal) = array['card_progress_v2_check']
    and (select array_agg(tgname::text order by 1) from pg_trigger where tgrelid = 'public.card_progress_v2_log'::regclass and not tgisinternal) = array['card_progress_v2_log_check'];
  res := res || jsonb_build_object('case', 'T2 the triggers: one check trigger on each table', 'ok', coalesce(ok, false));

  select coalesce(array_agg(x.what order by 1), '{}') into bad from (
    select 'table ' || c.relname as what from pg_class c where c.oid in ('public.card_progress_v2'::regclass, 'public.card_progress_v2_log'::regclass)
       and coalesce(obj_description(c.oid, 'pg_class'), '') = ''
    union all
    select a.attrelid::regclass::text || '.' || a.attname from pg_attribute a
     where a.attrelid in ('public.card_progress_v2'::regclass, 'public.card_progress_v2_log'::regclass) and a.attnum > 0 and not a.attisdropped
       and coalesce(col_description(a.attrelid, a.attnum), '') = ''
    union all
    select 'function ' || f from unnest(mine) f where coalesce(obj_description(('public.' || f)::regprocedure, 'pg_proc'), '') = '') x;
  res := res || jsonb_build_object('case', 'T2 a comment on each table, each column and each new function', 'ok', cardinality(bad) = 0, 'missing', bad);

  bad := '{}';
  foreach k in array array['public.card_progress_v2', 'public.card_progress_v2_log'] loop
    if not (select relrowsecurity from pg_class where oid = k::regclass) then bad := bad || (k || ': RLS off'); end if;
    if exists (select 1 from pg_policy where polrelid = k::regclass) then bad := bad || (k || ': has a policy'); end if;
    if has_table_privilege('anon', k, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then bad := bad || (k || ': anon has a privilege'); end if;
    if has_table_privilege('authenticated', k, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then bad := bad || (k || ': authenticated has a privilege'); end if;
    if not (has_table_privilege('service_role', k, 'SELECT') and has_table_privilege('service_role', k, 'INSERT') and has_table_privilege('service_role', k, 'UPDATE')
            and has_table_privilege('service_role', k, 'DELETE')) then bad := bad || (k || ': service_role lacks a privilege'); end if;
  end loop;
  foreach k in array mine loop
    if has_function_privilege('anon', 'public.' || k, 'execute') or has_function_privilege('authenticated', 'public.' || k, 'execute') then bad := bad || ('anon or authenticated can execute ' || k); end if;
  end loop;
  res := res || jsonb_build_object('case', 'T2 RLS on with no policy; anon and authenticated: no table or function privilege; service_role: select, insert, update, delete', 'ok', cardinality(bad) = 0, 'bad', bad);

  res := res || jsonb_build_object('case', 'T2 both tables are empty after the file', 'ok',
    (select count(*) from public.card_progress_v2) = 0 and (select count(*) from public.card_progress_v2_log) = 0);

  -- T1. no other change
  select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) into md5b from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text <> all (mine);
  res := res || jsonb_build_object('case', format('T1 the md5 of the %s other public functions does not change (no function added or changed)', (select count(*) from jsonb_object_keys(md5a))), 'ok', md5a = md5b,
    'changed', (select jsonb_agg(x.key) from jsonb_each_text(md5b) x where md5a->>x.key is distinct from x.value),
    'gone', (select jsonb_agg(x.key) from jsonb_each_text(md5a) x where not md5b ? x.key));
  res := res || jsonb_build_object('case', 'T1 the flag combat_v2 does not change (progress stays false)', 'ok',
    (select value from public.balance where key = 'combat_v2') = flag_a and flag_a->'progress' = 'false'::jsonb);
  select coalesce(array_agg(tgname::text order by 1), '{}') into trg_b from pg_trigger where tgrelid = 'public.player_cards'::regclass and not tgisinternal;
  res := res || jsonb_build_object('case', 'T1 the triggers of player_cards do not change', 'ok', trg_a = trg_b, 'now', trg_b);
  select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.oid::regprocedure::text <> all (mine) and p.prosrc ~ 'card_progress_v2';
  res := res || jsonb_build_object('case', 'T2 no function except the two new triggers names card_progress_v2 (no reader, no caller)', 'ok', cardinality(bad) = 0, 'names', bad);
  select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') into callers_b from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(';
  res := res || jsonb_build_object('case', 'T2 the readers of combat_v2_on do not change', 'ok', callers_a = callers_b, 'now', callers_b);

  -- the sample: a player and two cards that the player does not own, added as player_cards rows (rolled back)
  select p.id into v_p from public.players p where exists (select 1 from public.player_cards pc where pc.player_id = p.id) order by p.id limit 1;
  select c.id into v_c from public.cards c where not exists (select 1 from public.player_cards pc where pc.player_id = v_p and pc.card_id = c.id) order by c.id limit 1;
  select c.id into v_c2 from public.cards c where c.id > v_c and not exists (select 1 from public.player_cards pc where pc.player_id = v_p and pc.card_id = c.id) order by c.id limit 1;
  if v_p is null or v_c is null or v_c2 is null then raise exception 'the sample: no player or no free card'; end if;
  insert into public.player_cards (player_id, card_id, quantity, first_source) values (v_p, v_c, 1, 'admin'), (v_p, v_c2, 1, 'admin');

  -- the progress checks (today's balance: max_level 30, points_per_level 1, max_per_stat 10, cost 5 + L)
  bad := '{}';
  begin
    insert into public.card_progress_v2 (player_id, card_id, level, xp, atk_pts, def_pts, bonus_points) values (v_p, v_c, 3, 18, 2, 1, 0) returning id into pid;
  exception when others then bad := bad || ('refused a valid row: ' || sqlerrm);
  end;
  -- valid states (each must be accepted)
  for rw in select * from (values
      ('level 3, xp 25 (the last XP of level 3)', 3, 25, 3, 0, 0),
      ('level 0, xp 0', 0, 0, 0, 0, 0),
      ('level 0, xp 4', 0, 4, 0, 0, 0),
      ('level 1, xp 5', 1, 5, 1, 0, 0),
      ('level 3 + bonus 2: 5 points', 3, 18, 3, 2, 2),
      ('level 30, xp 585, 10 atk + 10 def + 10 spd', 30, 585, 10, 10, 0),
      ('level 30, xp 99999 (XP above the max level)', 30, 99999, 10, 0, 0),
      ('level 0 + bonus 7: 7 points', 0, 0, 7, 0, 7)) v(k, lvl, xpv, a, d, b) loop
    begin
      update public.card_progress_v2 set level = rw.lvl, xp = rw.xpv, atk_pts = rw.a, def_pts = rw.d, spd_pts = case when rw.lvl = 30 and rw.a = 10 and rw.d = 10 then 10 else 0 end,
        bonus_points = rw.b where id = pid;
    exception when others then bad := bad || ('refused: ' || rw.k || ': ' || sqlerrm);
    end;
  end loop;
  res := res || jsonb_build_object('case', 'the progress trigger accepts 9 valid states (level and XP pairs, the budget with bonus, the max level)', 'ok', cardinality(bad) = 0, 'bad', bad);

  bad := '{}';
  update public.card_progress_v2 set level = 3, xp = 18, atk_pts = 2, def_pts = 1, spd_pts = 0, bonus_points = 0 where id = pid;
  for k in select unnest(array[
      'level = 3, xp = 17',                       -- XP below level 3 (needs 18)
      'level = 3, xp = 26',                       -- XP of level 4
      'level = 0, xp = 5, atk_pts = 0, def_pts = 0',
      'level = 31, xp = 9999',                    -- above max_level
      'level = 30, xp = 585, atk_pts = 11',       -- above max_per_stat
      'level = 30, xp = 585, spd_pts = 11',
      'level = 30, xp = 585, hp_pts = 11',
      'atk_pts = 3',                              -- 4 points at level 3
      'def_pts = 2',                              -- 4 points at level 3 (the def column counts)
      'bonus_points = 1, crd_pts = 2',            -- 5 points with level 3 + bonus 1
      'level = -1, xp = 0',
      'xp = -1',
      'atk_pts = -1, def_pts = 4',
      'level = 30, xp = 585, bonus_points = -1',
      'crt_pts = -1, ddg_pts = 1',
      'card_id = ' || v_c2,                         -- a key change
      'player_id = player_id || ''x''']) loop
    begin
      execute 'update public.card_progress_v2 set ' || k || ' where id = ' || pid;
      bad := bad || ('accepted: ' || k);
    exception when others then null;
    end;
  end loop;
  begin
    insert into public.card_progress_v2 (player_id, card_id) values (v_p, v_c);
    bad := bad || 'accepted: a second row for the same player_cards row'::text;
  exception when others then null;
  end;
  begin
    insert into public.card_progress_v2 (player_id, card_id) values (v_p || 'x', v_c);
    bad := bad || 'accepted: a row with no player_cards row'::text;
  exception when others then null;
  end;
  res := res || jsonb_build_object('case', 'the progress table refuses 19 bad rows (XP not of the level, max level, max per stat, budget, negatives, key change, twice, no player_cards row)',
    'ok', cardinality(bad) = 0, 'bad', bad);

  -- the limits come from balance: a changed number moves each limit (the trigger reads balance, not a number in the code)
  bad := '{}';
  perform set_config('balance.by', 'test', true);
  update public.balance set value = jsonb_set(value, '{max_per_stat}', '12') where key = 'v2_stats';
  begin update public.card_progress_v2 set level = 30, xp = 585, atk_pts = 12, def_pts = 0 where id = pid;
  exception when others then bad := bad || ('v2_stats.max_per_stat 12: 12 points refused: ' || sqlerrm); end;
  begin update public.card_progress_v2 set atk_pts = 13 where id = pid; bad := bad || 'v2_stats.max_per_stat 12: 13 points accepted'::text;
  exception when others then null; end;
  update public.balance set value = jsonb_set(value, '{max_level}', '40') where key = 'v2_level';
  begin update public.card_progress_v2 set level = 31, xp = 620, atk_pts = 0 where id = pid;   -- level 31: 31 x 5 + 31 x 30 / 2 = 620
  exception when others then bad := bad || ('v2_level.max_level 40: level 31 refused: ' || sqlerrm); end;
  update public.balance set value = jsonb_set(value, '{points_per_level}', '2') where key = 'v2_level';
  begin update public.card_progress_v2 set level = 3, xp = 18, atk_pts = 6 where id = pid;
  exception when others then bad := bad || ('v2_level.points_per_level 2: 6 points at level 3 refused: ' || sqlerrm); end;
  begin update public.card_progress_v2 set atk_pts = 7 where id = pid; bad := bad || 'v2_level.points_per_level 2: 7 points at level 3 accepted'::text;
  exception when others then null; end;
  update public.balance set value = jsonb_set(jsonb_set(value, '{cost_base}', '6'), '{cost_per_level}', '2') where key = 'card_level';
  begin update public.card_progress_v2 set level = 3, xp = 24, atk_pts = 0 where id = pid;     -- level 3: 3 x 6 + 2 x 3 = 24
  exception when others then bad := bad || ('card_level 6 + 2L: level 3 at 24 XP refused: ' || sqlerrm); end;
  begin update public.card_progress_v2 set xp = 23 where id = pid; bad := bad || 'card_level 6 + 2L: level 3 at 23 XP accepted'::text;
  exception when others then null; end;
  begin update public.card_progress_v2 set xp = 36 where id = pid; bad := bad || 'card_level 6 + 2L: level 3 at 36 XP (level 4) accepted'::text;
  exception when others then null; end;
  update public.balance set value = jsonb_set(jsonb_set(value, '{cost_base}', '5'), '{cost_per_level}', '1') where key = 'card_level';
  update public.balance set value = jsonb_set(jsonb_set(value, '{max_level}', '30'), '{points_per_level}', '1') where key = 'v2_level';
  update public.balance set value = jsonb_set(value, '{max_per_stat}', '10') where key = 'v2_stats';
  update public.card_progress_v2 set level = 3, xp = 18, atk_pts = 2, def_pts = 1, bonus_points = 0 where id = pid;
  res := res || jsonb_build_object('case', 'the limits come from balance: v2_stats.max_per_stat, v2_level.max_level and points_per_level, card_level costs each move their limit', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- the ledger
  bad := '{}';
  perform set_config('balance.by', 'm1a-test', true);
  begin
    insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp, d_points, d_bonus) values
      (pid, v_p, v_c, 'grant_level', '',    'm1',               3, 18, 0, 0),
      (pid, v_p, v_c, 'convert',     'atk', 'm1',               0, 0,  1, 0),
      (pid, v_p, v_c, 'topup',       'atk', 'm1',               0, 0,  1, 0),
      (pid, v_p, v_c, 'dead_points', 'def', 'm1',               0, 0,  1, 0),
      (pid, v_p, v_c, 'refund',      'abl', 'm1',               0, 0,  0, 2),
      (pid, v_p, v_c, 'refund',      '',    'm1_extra',         0, 0,  0, 1),
      (pid, v_p, v_c, 'xp',          '',    'hunt:2026-10-24',  0, 10, 0, 0),
      (pid, v_p, v_c, 'xp',          '',    'dungeon:2026-10-24', 1, 10, 0, 0),
      (pid, v_p, v_c, 'spend',       'spd', 'v2:1',             0, 0,  1, 0),
      (pid, v_p, v_c, 'reset',       'spd', 'v2:2',             0, 0, -1, 0);
  exception when others then bad := bad || ('refused the valid ledger rows: ' || sqlerrm);
  end;
  res := res || jsonb_build_object('case', 'the ledger accepts one valid row of each of the 8 reasons; created_by = balance_who()', 'ok', cardinality(bad) = 0
    and (select count(*) from public.card_progress_v2_log where progress_id = pid) = 10
    and (select bool_and(created_by = 'm1a-test') from public.card_progress_v2_log where progress_id = pid), 'bad', bad);

  bad := '{}';
  for k in select unnest(array[
      $$'convert', 'atk', 'm1', 0, 0, 1, 0$$,               -- the same key again (idempotency)
      $$'grant_level', '', 'm1', 3, 18, 0, 0$$,
      $$'xp', '', 'hunt:2026-10-24', 0, 10, 0, 0$$,
      $$'other', 'atk', 'm1o', 0, 0, 1, 0$$,               -- an unknown reason (else a valid points row)
      $$'convert', 'potency', 'm1b', 0, 0, 1, 0$$,          -- a v1 stat name
      $$'convert', '', 'm1b', 0, 0, 1, 0$$,                 -- a points row with no stat
      $$'convert', 'atk', 'm1b', 0, 0, -1, 0$$,             -- a negative conversion
      $$'convert', 'atk', 'm1b', 1, 0, 1, 0$$,              -- a conversion that also gives a level
      $$'grant_level', '', 'm1b', 3, 18, 2, 0$$,            -- a level grant with points
      $$'grant_level', '', 'm1c', 0, 18, 0, 0$$,            -- a level grant with no level
      $$'grant_level', 'atk', 'm1d', 3, 18, 0, 0$$,         -- a level grant with a stat
      $$'refund', '', 'm1b', 0, 0, 0, 0$$,                  -- a refund of 0
      $$'refund', '', 'm1c', 0, 0, 1, 1$$,                  -- a refund with points
      $$'reset', 'spd', 'v2:3', 0, 0, 1, 0$$,               -- a reset that gives points
      $$'reset', '', 'v2:4', 0, 0, -1, 0$$,                 -- a reset with no stat
      $$'xp', '', 'hunt:2026-10-25', 0, 0, 0, 0$$,          -- xp of 0
      $$'xp', '', 'hunt', 0, 10, 0, 0$$,                    -- xp with no day
      $$'xp', '', 'gauntlet:2026-10-25', 0, 10, 0, 0$$,     -- xp from the Gauntlet
      $$'xp', '', 'm1', 0, 10, 0, 0$$,
      $$'xp', 'atk', 'hunt:2026-10-26', 0, 10, 0, 0$$,      -- xp with a stat
      $$'spend', 'atk', 'v2:5', 0, 0, 0, 0$$,               -- a spend of 0
      $$'spend', 'atk', 'V2 5', 0, 0, 1, 0$$,               -- a ref with capitals and a space
      $$'spend', 'atk', '', 0, 0, 1, 0$$]) loop
    begin
      execute format('insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp, d_points, d_bonus) values (%s, %L, %s, %s)', pid, v_p, v_c, k);
      bad := bad || ('accepted: ' || k);
    exception when others then null;
    end;
  end loop;
  begin
    insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_points) values (pid + 1000000, v_p, v_c, 'spend', 'atk', 'v2:9', 1);
    bad := bad || 'accepted: no progress row'::text;
  exception when others then null;
  end;
  begin
    insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_points) values (pid, v_p || 'x', v_c, 'spend', 'atk', 'v2:9', 1);
    bad := bad || 'accepted: another player'::text;
  exception when others then null;
  end;
  begin
    insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_points) values (pid, v_p, v_c2, 'spend', 'atk', 'v2:9', 1);
    bad := bad || 'accepted: another card'::text;
  exception when others then null;
  end;
  begin
    update public.card_progress_v2_log set d_points = 2 where progress_id = pid and reason = 'convert';
    if found then bad := bad || 'accepted: an update of a ledger row'::text; end if;
  exception when others then null;
  end;
  res := res || jsonb_build_object('case', 'the ledger refuses 27 bad rows (a duplicate key x3, reason, stat, the deltas of each reason, the xp ref, no progress row, another player or card, an update)',
    'ok', cardinality(bad) = 0, 'bad', bad);

  -- the FK cascade: the last copy leaves (the v1 rule of card_move) -> the progress row goes, the ledger stays
  delete from public.player_cards where player_id = v_p and card_id = v_c;
  res := res || jsonb_build_object('case', 'deleting the player_cards row deletes its progress row; the 10 ledger rows stay', 'ok',
    not exists (select 1 from public.card_progress_v2 where id = pid) and (select count(*) from public.card_progress_v2_log where progress_id = pid) = 10);
  -- a new copy starts a new history (a new id)
  insert into public.player_cards (player_id, card_id, quantity, first_source) values (v_p, v_c, 1, 'admin');
  insert into public.card_progress_v2 (player_id, card_id) values (v_p, v_c);
  res := res || jsonb_build_object('case', 'a new copy gets a new progress id (the old ledger rows do not name it)', 'ok',
    (select id from public.card_progress_v2 where player_id = v_p and card_id = v_c) <> pid);

  -- the file runs twice: the rows stay, no constraint, index or trigger is added
  select count(*) into n_con from pg_constraint where conrelid in ('public.card_progress_v2'::regclass, 'public.card_progress_v2_log'::regclass);
  select count(*) into n_idx from pg_index where indrelid in ('public.card_progress_v2'::regclass, 'public.card_progress_v2_log'::regclass);
  select count(*) into n_trg from pg_trigger where tgrelid in ('public.card_progress_v2'::regclass, 'public.card_progress_v2_log'::regclass) and not tgisinternal;
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'a second run keeps the rows (1 progress, 10 ledger) and adds no constraint, index or trigger', 'ok',
    (select count(*) from public.card_progress_v2) = 1 and (select count(*) from public.card_progress_v2_log) = 10
    and n_con = (select count(*) from pg_constraint where conrelid in ('public.card_progress_v2'::regclass, 'public.card_progress_v2_log'::regclass))
    and n_idx = (select count(*) from pg_index where indrelid in ('public.card_progress_v2'::regclass, 'public.card_progress_v2_log'::regclass))
    and n_trg = (select count(*) from pg_trigger where tgrelid in ('public.card_progress_v2'::regclass, 'public.card_progress_v2_log'::regclass) and not tgisinternal));

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
