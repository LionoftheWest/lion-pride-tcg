import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_testers.sql (combat v2: the tester list, balance combat_v2.testers, and combat_v2_on(mode, player)).
 * NO lasting change: one DO block, undone by its final RAISE. The block first puts back the state before the file (no tester list, the V1 shape
 * walker, the E7b shapes, no reader with a player), so the test passes before and after the file is applied. Sample ids only (no member id).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-testers.mjs     must PASS
 *   MUTATE=<name> ...                                                                           must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                              the baseline (must PASS), then every mutation, one line each
 * Invariants:
 *   1. The value: combat_v2 keeps the four modes false and gets testers = [] (a balance_log row by nathan); the note names the list.
 *   2. combat_v2_on(mode, player): a tester is on in each of the four modes while every mode is off; a member who is not a tester is off; a mode on
 *      for everyone is on for every member and for a NULL player; an unknown mode, a NULL mode and a NULL player (modes off) are off.
 *   3. It FAILS CLOSED for the tester part: a list that is a string, a number id, an object id, an id of 16 digits, a list of 21, a list with an id twice,
 *      no list, a mode that is the string "true", an extra key, no row and a read error (the table renamed) all give false for a listed id.
 *   4. combat_v2_on(mode) does not change: its md5, and its answers on the same states (the tester list never turns it on).
 *   5. The shape: balance_check_combat_v2 refuses a list of 21, an id twice, a non-digit id, a number, 16 and 21 digits, no list, an object and a
 *      string; it accepts [] and 20 ids.
 *   6. No other function changes (md5 of every other public function) and no function calls combat_v2_on except the new reader itself.
 *   7. Server only: anon and authenticated cannot execute combat_v2_on(text, text); service_role can.
 *   8. Idempotent: a second run keeps a tester list.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-testers.mjs');

const rd = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const FILE = process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/combat_v2_testers.sql', import.meta.url));
let mig = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
// the state before the file: the shape walker of V1 and the balance_v2_spec of the E7 tuning (their whole create statements)
const fnText = (src, head, end) => { const i = src.indexOf(head); const j = src.indexOf(end, i); if (i < 0 || j < 0) throw new Error(`no ${head}`); return src.slice(i, j + end.length); };
const WALKER_V1 = fnText(rd('combat_v2_flags_balance.sql'), 'create or replace function public.balance_shape_errors(', '\nend $fn$;\n');
const SPEC_E7B = fnText(rd('combat_v2_monster_tuning.sql'), 'create or replace function public.balance_v2_spec(', '\n$fn$;\n');
// the generic balance trigger before the file (balance_table.sql; its $$ quotes become $fn$ so the block can run it)
const CHECK_OLD = fnText(rd('balance_table.sql'), 'create or replace function public.balance_check()', '\nend $$;\n').replace("as $$\n", 'as $fn$\n').replace('\nend $$;\n', '\nend $fn$;\n');
if (!CHECK_OLD.includes('lost or changed the type') || CHECK_OLD.includes('testers') || CHECK_OLD.includes('$$')) throw new Error('balance_table.sql balance_check is not the text before this file');
if (!WALKER_V1.includes("raise exception 'balance_shape_errors: unknown spec %'") || !SPEC_E7B.includes('"crit_x"')) throw new Error('the earlier function texts were not found');

const MUT = {
  reader_no_one_arg: ['  if combat_v2_on(p_mode) then return true; end if;\n', ''],
  reader_error_open: ['exception when others then\n  return false;\nend $fn$;\n\n-- ============================================================ 5.', 'exception when others then\n  return true;\nend $fn$;\n\n-- ============================================================ 5.'],
  reader_any_mode: ["  if p_mode is null or p_mode not in ('gauntlet', 'dungeon', 'hunt', 'progress') or p_player is null then return false; end if;", '  if p_player is null then return false; end if;'],
  reader_no_shape: ["  if v is null or cardinality(balance_shape_errors(v, balance_v2_spec('combat_v2'), '')) > 0 then return false; end if;", '  if v is null then return false; end if;'],
  reader_any_tester: ["  return coalesce(v->'testers' ? p_player, false);", "  return coalesce(jsonb_array_length(v->'testers') > 0, false);"],
  spec_no_testers: ['"progress": "bool", "testers": ["set", "discord_id", 0, 20]}', '"progress": "bool"}'],
  spec_max_wide: ['"testers": ["set", "discord_id", 0, 20]', '"testers": ["set", "discord_id", 0, 21]'],
  spec_list_not_set: ['"testers": ["set", "discord_id", 0, 20]', '"testers": ["list", "discord_id", 0, 20]'],
  walker_id_any: ["      if jsonb_typeof(p_val) is distinct from 'string' or (p_val #>> '{}') !~ '^[0-9]{17,20}$' then", '      if false then'],
  walker_id_short: ["(p_val #>> '{}') !~ '^[0-9]{17,20}$' then", "(p_val #>> '{}') !~ '^[0-9]{1,20}$' then"],
  walker_id_number: ["      if jsonb_typeof(p_val) is distinct from 'string' or (p_val #>> '{}') !~ '^[0-9]{17,20}$' then", "      if (p_val #>> '{}') !~ '^[0-9]{17,20}$' then"],
  value_not_empty: [`value || '{"testers": []}'::jsonb`, `value || '{"testers": ["100000000000000009"]}'::jsonb`],
  value_overwrite: [" where key = 'combat_v2' and not value ? 'testers';", " where key = 'combat_v2';"],
  value_mode_on: [`value || '{"testers": []}'::jsonb`, `value || '{"testers": [], "hunt": true}'::jsonb`],
  check_no_exempt: ["       and not (new.key = 'combat_v2' and o.path[1] = 'testers')   -- combat_v2_testers.sql: the tester ids may go\n", ''],
  check_exempt_all: ["and not (new.key = 'combat_v2' and o.path[1] = 'testers')", "and not (o.path[1] = 'testers' or o.typ = 'string')"],
  grant_anon: ["comment on function public.combat_v2_on(text, text) is", 'grant execute on function public.combat_v2_on(text, text) to anon;\ncomment on function public.combat_v2_on(text, text) is'],
};
// a planted change of ANOTHER function (the md5 cases must catch it): the file also replaces combat_v2_on(text)
MUT.other_fn_changed = ['-- ============================================================ 5. server only', `create or replace function public.combat_v2_on(p_mode text) returns boolean language plpgsql stable set search_path = public as $fn$
declare v jsonb;
begin
  if p_mode is null or p_mode not in ('gauntlet', 'dungeon', 'hunt', 'progress') then return false; end if;
  select b.value -> p_mode into v from balance b where b.key = 'combat_v2';
  return coalesce(v = 'true'::jsonb, false) or false;
exception when others then
  return false;
end $fn$;
-- ============================================================ 5. server only`];

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
    console.log(`mutation ${name.padEnd(20)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once`);
  mig = mig.split(m[0]).join(m[1]);
}
if (['$m$', '$t$'].some((x) => mig.includes(x) || WALKER_V1.includes(x) || SPEC_E7B.includes(x))) throw new Error('the SQL must not contain $m$ or $t$');

// sample ids only: 18 digits, not members
const T1 = '100000000000000001', T2 = '100000000000000002', NT = '100000000000000003';
const MINE = ['balance_shape_errors(jsonb,jsonb,text)', 'balance_v2_spec(text)', 'combat_v2_on(text,text)', 'balance_check()'];
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const body = String.raw`do $t$
declare res jsonb := '[]'; bad text[] := '{}'; ok boolean; v jsonb; v0 jsonb; md5a jsonb; md5b jsonb; one_a text; one_b text; c text; k text; pl jsonb;
  caps text[] := array['gauntlet', 'dungeon', 'hunt', 'progress']; mine text[] := array[${MINE.map(lit).join(', ')}];
  T1 text := ${lit(T1)}; T2 text := ${lit(T2)}; NT text := ${lit(NT)}; twenty jsonb; n int;
begin
  -- 0. the state before the file (also when the file is applied on this copy)
  execute $m$${WALKER_V1}$m$;
  execute $m$${SPEC_E7B}$m$;
  execute $m$${CHECK_OLD}$m$;
  drop function if exists public.combat_v2_on(text, text);
  alter table public.balance disable trigger user;
  update public.balance set value = (value - 'testers') || '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}' where key = 'combat_v2';
  alter table public.balance enable trigger user;
  select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) into md5a from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text <> all (mine);
  select md5(pg_get_functiondef('public.combat_v2_on(text)'::regprocedure)) into one_a;
  n := (select count(*) from public.balance_log);

  execute $m$${mig}$m$;

  -- 1. the value
  select value into v from public.balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'combat_v2 = the four modes false and testers = []', 'ok',
    v = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false, "testers": []}'::jsonb, 'value', v);
  res := res || jsonb_build_object('case', 'the change wrote one balance_log row by nathan; the note names the tester list', 'ok',
    (select count(*) from public.balance_log where key = 'combat_v2' and changed_by = 'nathan') >= 1 and (select count(*) from public.balance_log) = n + 1
    and (select note like '%testers%combat_v2_on(mode, player)%' from public.balance where key = 'combat_v2'));

  -- 2. the reader with a player (the trigger is on: valid values only)
  bad := '{}';
  foreach c in array caps loop
    if combat_v2_on(c, T1) then bad := bad || ('empty list: ' || c); end if;
  end loop;
  update public.balance set value = jsonb_set(value, '{testers}', jsonb_build_array(T1, T2)) where key = 'combat_v2';
  foreach c in array caps loop
    if not combat_v2_on(c, T1) then bad := bad || ('tester T1 off in ' || c); end if;
    if not combat_v2_on(c, T2) then bad := bad || ('tester T2 off in ' || c); end if;
    if combat_v2_on(c, NT) then bad := bad || ('not a tester on in ' || c); end if;
    if combat_v2_on(c) then bad := bad || ('the one-argument reader on in ' || c || ' (a tester list must not turn a mode on for everyone)'); end if;
    if combat_v2_on(c, null) then bad := bad || ('a NULL player on in ' || c); end if;
  end loop;
  foreach c in array array['arena', 'testers', 'Hunt', ''] loop
    if combat_v2_on(c, T1) then bad := bad || ('the unknown mode ' || quote_literal(c) || ' on for a tester'); end if;
  end loop;
  if combat_v2_on(null, T1) then bad := bad || 'a NULL mode on for a tester'::text; end if;
  if combat_v2_on(T1, T1) then bad := bad || 'the id as the mode'::text; end if;
  -- a mode on for everyone
  update public.balance set value = jsonb_set(jsonb_set(value, '{hunt}', 'true'), '{testers}', '[]') where key = 'combat_v2';
  if not combat_v2_on('hunt', NT) then bad := bad || 'hunt on for everyone: off for a member'::text; end if;
  if not combat_v2_on('hunt', null) then bad := bad || 'hunt on for everyone: off for a NULL player'::text; end if;
  if combat_v2_on('dungeon', NT) then bad := bad || 'hunt on for everyone: dungeon on for a member'::text; end if;
  update public.balance set value = jsonb_set(value, '{hunt}', 'false') where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'combat_v2_on(mode, player): testers on in each mode, others off, a mode on for everyone, unknown / NULL modes off', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- 3. fails closed (the triggers are off, so a bad value can be stored; the listed id must read as OFF)
  bad := '{}';
  alter table public.balance disable trigger user;
  select value into v0 from public.balance where key = 'combat_v2';
  for k, pl in select x.k, x.v from (values
      ('a string list',       jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers', T1)),
      ('a number id',         jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers', jsonb_build_array(T1::numeric))),
      ('an object id',        jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers', jsonb_build_array(jsonb_build_object('id', T1)))),
      ('an id twice',         jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers', jsonb_build_array(T1, T1))),
      ('21 ids',              jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers',
                                (select jsonb_agg(case when g = 1 then T1 else (200000000000000000 + g)::text end) from generate_series(1, 21) g))),
      ('no list',             jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false)),
      ('a mode "true"',       jsonb_build_object('gauntlet', 'true', 'dungeon', false, 'hunt', false, 'progress', false, 'testers', jsonb_build_array(T1))),
      ('an extra key',        jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers', jsonb_build_array(T1), 'arena', true)),
      ('a list',              jsonb_build_array(T1)),
      ('a scalar',            to_jsonb(T1))) x(k, v) loop
    update public.balance set value = pl where key = 'combat_v2';
    foreach c in array caps loop
      if combat_v2_on(c, T1) then bad := bad || (k || ': on in ' || c); exit; end if;
    end loop;
  end loop;
  -- a short id: the player '1234567890123456' (16 digits) listed with a bad shape
  update public.balance set value = jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers', jsonb_build_array('1234567890123456')) where key = 'combat_v2';
  if combat_v2_on('hunt', '1234567890123456') then bad := bad || 'an id of 16 digits'::text; end if;
  -- no row, then a read error (the table renamed): the list holds T1
  update public.balance set value = jsonb_set(v0, '{testers}', jsonb_build_array(T1)) where key = 'combat_v2';
  if not combat_v2_on('hunt', T1) then bad := bad || 'the control: a valid list must read on'::text; end if;
  alter table public.balance rename to balance_v2test_off;
  begin
    if combat_v2_on('hunt', T1) then bad := bad || 'a read error'::text; end if;
  exception when others then bad := bad || ('a read error raised: ' || sqlerrm);
  end;
  alter table public.balance_v2test_off rename to balance;
  delete from public.balance where key = 'combat_v2';
  if combat_v2_on('hunt', T1) then bad := bad || 'no row'::text; end if;
  insert into public.balance (key, value, note) values ('combat_v2', v0, 'the test row');
  alter table public.balance enable trigger user;
  res := res || jsonb_build_object('case', 'the tester part fails closed (13 cases: string list, number, object, twice, 21, no list, mode "true", extra key, list, scalar, 16 digits, read error, no row)',
    'ok', cardinality(bad) = 0, 'bad', bad);

  -- 4. the one-argument reader does not change
  select md5(pg_get_functiondef('public.combat_v2_on(text)'::regprocedure)) into one_b;
  res := res || jsonb_build_object('case', 'combat_v2_on(mode) is the same function (md5)', 'ok', one_a = one_b);

  -- 5. the shape
  bad := '{}';
  select jsonb_agg((200000000000000000 + g)::text) into twenty from generate_series(1, 20) g;
  for k, pl in select x.k, x.v from (values
      ('21 ids', twenty || jsonb_build_array(T1)), ('an id twice', jsonb_build_array(T1, T1)), ('a non-digit id', jsonb_build_array('10000000000000000a')),
      ('a number', jsonb_build_array(T1::numeric)), ('16 digits', '["1234567890123456"]'::jsonb), ('21 digits', '["123456789012345678901"]'::jsonb),
      ('an object', '{}'::jsonb), ('a string', to_jsonb(T1)), ('null', 'null'::jsonb)) x(k, v) loop
    begin
      update public.balance set value = jsonb_set(v0, '{testers}', pl) where key = 'combat_v2';
      bad := bad || ('accepted: ' || k);
    exception when others then
      if sqlerrm not like 'balance combat_v2:%' then bad := bad || (k || ': ' || sqlerrm); end if;
    end;
  end loop;
  begin
    update public.balance set value = v0 - 'testers' where key = 'combat_v2';
    bad := bad || 'accepted: no list'::text;
  exception when others then null;
  end;
  begin
    update public.balance set value = jsonb_set(v0, '{testers}', '[]') where key = 'combat_v2';
    update public.balance set value = jsonb_set(v0, '{testers}', twenty) where key = 'combat_v2';
  exception when others then bad := bad || ('refused a valid list: ' || sqlerrm);
  end;
  res := res || jsonb_build_object('case', 'balance_check_combat_v2 refuses 10 bad tester lists and accepts [] and 20 ids', 'ok', cardinality(bad) = 0, 'bad', bad);
  -- a tester can be removed (balance_check: the ids of combat_v2.testers may go), and no other list item may go
  bad := '{}';
  update public.balance set value = jsonb_set(v0, '{testers}', jsonb_build_array(T1, T2)) where key = 'combat_v2';
  begin
    update public.balance set value = jsonb_set(v0, '{testers}', jsonb_build_array(T2)) where key = 'combat_v2';
    update public.balance set value = jsonb_set(v0, '{testers}', '[]') where key = 'combat_v2';
  exception when others then bad := bad || ('a tester could not be removed: ' || sqlerrm);
  end;
  begin
    update public.balance set value = jsonb_set(value, '{enabler_extra_stack}', (value->'enabler_extra_stack') - 0) where key = 'v2_support';
    bad := bad || 'v2_support.enabler_extra_stack lost an item and was accepted'::text;
  exception when others then if sqlerrm not like '%lost or changed the type%' then bad := bad || ('another error: ' || sqlerrm); end if;
  end;
  begin
    update public.balance set value = jsonb_set(v0, '{testers}', '[]') - 'hunt' where key = 'combat_v2';
    bad := bad || 'combat_v2 lost the leaf hunt and was accepted'::text;
  exception when others then null;
  end;
  res := res || jsonb_build_object('case', 'a tester can be removed; another list item (v2_support) and another combat_v2 leaf still cannot go', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- 6. no other function changes; no caller
  select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) into md5b from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and p.oid::regprocedure::text <> all (mine);
  res := res || jsonb_build_object('case', format('the md5 of the %s other public functions does not change', (select count(*) from jsonb_object_keys(md5a))), 'ok', md5a = md5b,
    'changed', (select jsonb_agg(x.key) from jsonb_each_text(md5b) x where md5a->>x.key is distinct from x.value),
    'gone', (select jsonb_agg(x.key) from jsonb_each_text(md5a) x where not md5b ? x.key));
  select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(' and p.oid::regprocedure::text <> 'combat_v2_on(text,text)'
     and p.proname <> all (array['spend_card_points_v2', 'reset_card_points_v2']);   -- M1c combat_v2_progress_spend.sql: the v2 spend and reset read the 2-argument form (a tester or everyone)
  res := res || jsonb_build_object('case', 'no function calls combat_v2_on (either form) except the new reader', 'ok', cardinality(bad) = 0, 'callers', bad);

  -- 7. server only
  ok := not has_function_privilege('anon', 'public.combat_v2_on(text, text)', 'execute') and not has_function_privilege('authenticated', 'public.combat_v2_on(text, text)', 'execute')
    and has_function_privilege('service_role', 'public.combat_v2_on(text, text)', 'execute');
  res := res || jsonb_build_object('case', 'anon and authenticated cannot execute combat_v2_on(text, text); service_role can', 'ok', ok);

  -- 8. idempotent
  update public.balance set value = jsonb_set(v0, '{testers}', jsonb_build_array(T1)) where key = 'combat_v2';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'a second run keeps a tester list', 'ok', (select value->'testers' = jsonb_build_array(T1) from public.balance where key = 'combat_v2'));

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
