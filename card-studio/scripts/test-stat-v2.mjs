import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/stat_v2.sql (STAT-V2: the v2 stat screen server part; SPEC v3 sections 4.2, 4.3 and 6).
 * NO lasting change: one DO block, undone by its final RAISE. The block first puts back the state before the file (the new functions,
 * the trigger, the settings row and the balance key removed; buy_shop_item, shop_today, combat_v2_convert_check and combat_v2_convert_fix
 * as the M1e file combat_v2_convert.sql; each md5 must be the "old" md5 of the guard), so the test passes before and after the file is
 * applied. Run it on a copy of live AFTER the switch (combat_v2_switch_log has an on row; combat_v2.progress true). Test players have ids
 * of 18 digits (99999999999999998x); nothing is printed about a member (case names and counts only).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-stat-v2.mjs     must PASS
 *   MUTATE=<name> ...                                                                 must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                    the baseline (must PASS), then every mutation, one line each
 * "Flag on" = combat_v2.progress true (global) AND the player in settings stat_v2.users (SPEC 6). A tester entry alone is not "flag on".
 * Cases: T0 (G-S0 M0) the M1e lines of the 4 replaced functions are kept; T1 no other function changes; T2 server only; G-S1 to G-S11 and
 *   G-S13 of SPEC 6 (G-S12, the two sessions, is test-stat-v2-concurrency.mjs). G-S9 spends every free point of EVERY owned card of the copy.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-stat-v2.mjs');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILE = process.env.MIG || `${ROOT}tcg-bot/supabase/stat_v2.sql`;
let mig = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const m1e = readFileSync(`${ROOT}tcg-bot/supabase/combat_v2_convert.sql`, 'utf8').replace(/\r\n/g, '\n');

const SYNC_CALL = '  perform card_progress_v2_sync(p_player, p_card, v_lv);\n';
const MUT = {
  // G-S0 / T0: an M1e line of a replaced function changes
  m0_m1e_line: ["  v_v2 jsonb;   -- M1d: the answer of the v2 reset (card_progress_v2_reset)\n", "  v_v2 jsonb;   -- M1d: the answer of the v2 reset\n"],
  // G-S1
  m1_no_sync: [SYNC_CALL, ''],
  // G-S2
  m2_stored_budget: ['  v_budget := v_lv * v_ppl + coalesce(r.bonus_points, 0);\n', '  v_budget := coalesce(r.level, 0) * v_ppl + coalesce(r.bonus_points, 0);\n'],
  // G-S3
  m3_cap_plus_one: ["if coalesce(r.atk_pts, 0) + coalesce((p_add->>'atk')::int, 0) > v_cap or", "if coalesce(r.atk_pts, 0) + coalesce((p_add->>'atk')::int, 0) > v_cap + 1 or"],
  // G-S4
  m4_budget_plus_one: ['  v_budget := v_lv * v_ppl + coalesce(r.bonus_points, 0);\n', '  v_budget := v_lv * v_ppl + coalesce(r.bonus_points, 0) + 1;\n'],
  // G-S5
  m5_on_always: ["  if v->'enabled' = 'true'::jsonb then return true; end if;\n  return p_player is not null and v->'users' ? p_player;\n", '  return true;\n'],
  // G-S5b
  m5b_no_progress_term: ["  if not combat_v2_on('progress') then return false; end if;\n  select s.value into v from settings", '  select s.value into v from settings'],
  m5c_tester_form: ["  if not combat_v2_on('progress') then return false; end if;\n  select s.value into v from settings", "  if not combat_v2_on('progress', p_player) then return false; end if;\n  select s.value into v from settings"],
  // G-S6
  m6_pause_kept: ["  if p_kind = 'stat_reset' and combat_v2_on('progress', p_player) and not stat_v2_on(p_player) then   -- STAT-V2\n", "  if p_kind = 'stat_reset' and combat_v2_on('progress', p_player) then   -- STAT-V2\n"],
  // G-S7
  m7_stored_level: ["  v_lv := (f->>'level')::int; v_bonus := coalesce((f->>'bonus')::int, 0);\n", "  v_lv := coalesce((select level from card_progress_v2 where player_id = p_player and card_id = p_card), 0); v_bonus := coalesce((f->>'bonus')::int, 0);\n"],
  m7b_crit_with_base: ["'crit', to_jsonb((s->>'crt')::numeric - (b->'v2_stats'->'crt'->>'base')::numeric),", "'crit', s->'crt',"],
  // G-S8
  m8_second_grant: ['  if r.level < p_level then\n', '  if r.level <= p_level then\n'],
  // G-S9
  m9_free_stored: ["    'free', v_lv * (b->'v2_level'->>'points_per_level')::int + v_bonus - v_spent,", "    'free', coalesce((select level from card_progress_v2 where player_id = p_player and card_id = p_card), 0) * (b->'v2_level'->>'points_per_level')::int + v_bonus - v_spent,"],
  m9b_no_later_ledger: ['      if lt_n > 0 then   -- STAT-V2\n', '      if false then   -- STAT-V2\n'],
  // G-S10
  m10_v1_answer: ["'message', 'Stat reset returns with the v2 stats screen.'", "'message', 'Stat reset returns soon.'"],
  // G-S11
  m11_sync_first: [[SYNC_CALL, ''], ['  -- 6. the cap of each stat, then the budget\n', '  -- 6. the cap of each stat, then the budget\n' + SYNC_CALL]],
  // G-S13
  m13_total_only: [`            or p.atk_pts <> (e->'points'->>'atk')::int or p.def_pts <> (e->'points'->>'def')::int or p.hp_pts <> (e->'points'->>'hp')::int
            or p.crd_pts <> (e->'points'->>'crd')::int or p.crt_pts <> (e->'points'->>'crt')::int or p.abl_pts <> (e->'points'->>'abl')::int
            or p.ddg_pts <> (e->'points'->>'ddg')::int or p.acc_pts <> (e->'points'->>'acc')::int or p.spd_pts <> (e->'points'->>'spd')::int)) then`,
  `            or p.atk_pts + p.def_pts + p.hp_pts + p.crd_pts + p.crt_pts + p.abl_pts + p.ddg_pts + p.acc_pts + p.spd_pts
               <> (select sum(x.value::int) from jsonb_each_text(e->'points') x))) then`],
  // T2
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);\n  end loop;\nend $g$;\n\ncomment on function public.stat_v2_on", "    execute format('grant execute on function public.%s to service_role, anon', f);\n  end loop;\nend $g$;\n\ncomment on function public.stat_v2_on"],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)          ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) { ok = false; console.log((base.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('FAIL')).join('\n').slice(0, 3000)); }
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const out = (r.stdout || '').trim().split(/\r?\n/);
    const line = out.pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const fails = out.filter((l) => l.startsWith('FAIL')).map((l) => l.slice(5, 60));
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  ${fails.join(' | ').slice(0, 300)}${r.stderr && !caught ? ' stderr: ' + r.stderr.slice(0, 300) : ''}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  for (const [a, b] of Array.isArray(m[0]) ? m : [m]) {
    if (mig.split(a).length !== 2) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once`);
    mig = mig.split(a).join(b);
  }
}
if (['$m$', '$t$', '$q$', '$s$'].some((x) => mig.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $q$ or $s$');

// the guard (its md5 pairs) and the 4 replaced functions: in this file and in the M1e file
const GUARD_RE = /\ndo \$g\$[\s\S]*?-- GUARD-END\n/;
const guard = (mig.match(GUARD_RE) || [])[0];
if (!guard) throw new Error('the file has no guard');
const MD5 = Object.fromEntries([...guard.matchAll(/\('public\.([a-z0-9_]+)\([^']*\)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], { old: m[2], new: m[3] }]));
if (Object.keys(MD5).length !== 4) throw new Error('the guard must name 4 functions with an old and a new md5');
const fnText = (src, name) => {
  const re = new RegExp(`^(CREATE OR REPLACE FUNCTION|create or replace function) public\\.${name}\\([\\s\\S]*?^end \\$(function|fn)\\$;\\n`, 'm');
  const m = src.match(re); if (!m) throw new Error(`no function ${name}`); return m[0];
};
const REPLACED = ['buy_shop_item', 'shop_today', 'combat_v2_convert_check', 'combat_v2_convert_fix'];
const OLD_FNS = REPLACED.map((n) => fnText(m1e, n)).join('\n');
// T0 (G-S0, M0): each replaced function = the M1e text plus the lines with the mark "-- STAT-V2", except these exact M1e lines that a STAT-V2
// line replaces (one in each Shop function). A changed M1e line, a removed one, or an unmarked added line fails.
const SWAPPED = {
  buy_shop_item: ["  if p_kind = 'stat_reset' and combat_v2_on('progress', p_player) then   -- M1e"],
  shop_today: ["    'stat_reset_paused', v_v2,   -- M1e: the Shop stat reset refuses stat_reset_paused (buy_shop_item) while v2 progress is ON for this player"],
  combat_v2_convert_check: [], combat_v2_convert_fix: [],
};
const t0 = REPLACED.map((n) => {
  const mine = fnText(mig, n).split('\n').filter((l) => !l.includes('-- STAT-V2'));
  const old = fnText(m1e, n).split('\n');
  const swappedOnce = SWAPPED[n].every((l) => old.filter((x) => x === l).length === 1);
  const want = old.filter((l) => !SWAPPED[n].includes(l));
  const added = fnText(mig, n).split('\n').filter((l) => l.includes('-- STAT-V2')).length;
  return { n, ok: swappedOnce && mine.join('\n') === want.join('\n') && added > 0, added };
});

const NEW = ['stat_v2_on(text)', 'card_progress_v2_sync(text,bigint,integer)', 'card_stats_v2_entry(text,bigint,jsonb)', 'card_stats_v2_for(text)',
  'stat_v2_spend(text,bigint,jsonb)', 'stat_v2_reset(text,bigint)', 'balance_check_stat_labels_v2()'];
const CHANGED = ['buy_shop_item(text,text,integer,bigint,integer)', 'shop_today(text)', 'combat_v2_convert_check(bigint[])', 'combat_v2_convert_fix(bigint[])'];
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const sig = "replace(p.oid::regprocedure::text, ', ', ',')";
const md5lit = lit(JSON.stringify(MD5));
const P1 = '999999999999999981', P2 = '999999999999999982', P3 = '999999999999999983', P4 = '999999999999999984';
const ZERO9 = `jsonb_build_object('atk', 0, 'def', 0, 'hp', 0, 'crd', 0, 'crt', 0, 'abl', 0, 'ddg', 0, 'acc', 0, 'spd', 0)`;

const body = String.raw`do $t$
declare res jsonb := '[]'; bad text[] := '{}'; md5a jsonb; md5b jsonb; fns_a text[]; fns_b text[]; k text; m text; ok boolean; n int; n2 int;
  newf text[] := array[${NEW.map(lit).join(', ')}]; chg text[] := array[${CHANGED.map(lit).join(', ')}];
  c1 bigint; c2 bigint; c3 bigint; c4 bigint; c5 bigint; c6 bigint; c7 bigint; c8 bigint; px text; r jsonb; r2 jsonb; s0 jsonb; s1 jsonb;
  pid bigint; v1a jsonb; v1b jsonb; tst jsonb; rw record; e jsonb; e2 jsonb; add jsonb; left_ int; room int; cap int; nok int; nbad int; fails jsonb;
  b jsonb; xc bigint; xp text; cnt int; sv jsonb;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'stat-v2-test', true);
  if not exists (select 1 from public.combat_v2_switch_log where action = 'on') then raise exception 'this copy has no switch on row (refresh it from live after the switch)'; end if;
  -- 0. the state before the file (also when the file is applied on this copy)
  drop trigger if exists balance_check_stat_labels_v2 on public.balance;
  drop function if exists public.balance_check_stat_labels_v2();
  drop function if exists public.stat_v2_spend(text, bigint, jsonb);
  drop function if exists public.stat_v2_reset(text, bigint);
  drop function if exists public.card_stats_v2_for(text);
  drop function if exists public.card_stats_v2_entry(text, bigint, jsonb);
  drop function if exists public.card_progress_v2_sync(text, bigint, integer);
  drop function if exists public.stat_v2_on(text);
  delete from public.settings where key = 'stat_v2';
  alter table public.balance disable trigger balance_check;
  delete from public.balance where key = 'stat_labels_v2';
  alter table public.balance enable trigger balance_check;
  execute $m$${OLD_FNS}$m$;
  bad := '{}';
  foreach k in array chg loop
    m := md5(replace(pg_get_functiondef(('public.' || k)::regprocedure), chr(13), ''));
    if m is distinct from (${md5lit}::jsonb -> split_part(k, '(', 1) ->> 'old') then bad := bad || k; end if;
  end loop;
  res := res || jsonb_build_object('case', 'G-S0 the state before: the 4 functions of the M1e file have the old md5 of the guard (= main 37f3025b)', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- the sample: 4 test players, cards with a v2 role that they get only here
  select array_agg(id order by id) into fns_a from (select c.id from public.cards c join public.subjects s on s.id = c.subject_id
    where s.ability_v2->>'role' in (select key from public.roles) and c.rarity::text not in ('event', 'promo') order by c.id limit 8) q;
  c1 := fns_a[1]; c2 := fns_a[2]; c3 := fns_a[3]; c4 := fns_a[4]; c5 := fns_a[5]; c6 := fns_a[6]; c7 := fns_a[7]; c8 := fns_a[8];
  if c8 is null then raise exception 'the sample: fewer than 8 cards with a v2 role'; end if;
  insert into public.players (id, username) values ('${P1}', 'stat v2 test 1'), ('${P2}', 'stat v2 test 2'), ('${P3}', 'stat v2 test 3'), ('${P4}', 'stat v2 test 4');
  insert into public.player_cards (player_id, card_id, quantity, first_source, ascension) values
    ('${P1}', c1, 1, 'admin', 3), ('${P1}', c2, 1, 'admin', 2), ('${P1}', c3, 1, 'admin', 4), ('${P1}', c4, 1, 'admin', 2), ('${P1}', c5, 1, 'admin', 1),
    ('${P1}', c6, 1, 'admin', 3), ('${P1}', c7, 1, 'admin', 0), ('${P2}', c1, 1, 'admin', 2), ('${P3}', c1, 1, 'admin', 3), ('${P4}', c8, 1, 'admin', 3);
  -- c2: a row of level 6 (2 stars at the conversion) with atk 6; c3: level 12, atk 9; P4 c8: a row of level 3 (1 star) with atk 1, the card now has 3 stars
  insert into public.card_progress_v2 (player_id, card_id, level, xp, atk_pts) values ('${P1}', c2, 6, card_level_xp_at(6), 6) returning id into pid;
  insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp, d_points) values
    (pid, '${P1}', c2, 'grant_level', '', 'statv2test', 6, card_level_xp_at(6), 0), (pid, '${P1}', c2, 'convert', 'atk', 'statv2test', 0, 0, 6);
  insert into public.card_progress_v2 (player_id, card_id, level, xp, atk_pts) values ('${P1}', c3, 12, card_level_xp_at(12), 9) returning id into pid;
  insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp, d_points) values
    (pid, '${P1}', c3, 'grant_level', '', 'statv2test', 12, card_level_xp_at(12), 0), (pid, '${P1}', c3, 'convert', 'atk', 'statv2test', 0, 0, 9);
  insert into public.card_progress_v2 (player_id, card_id, level, xp, atk_pts) values ('${P4}', c8, 3, card_level_xp_at(3), 1) returning id into pid;
  insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp, d_points) values
    (pid, '${P4}', c8, 'grant_level', '', 'statv2test', 3, card_level_xp_at(3), 0), (pid, '${P4}', c8, 'convert', 'atk', 'statv2test', 0, 0, 1);
  update public.players set stat_reset_week = null where id in ('${P1}', '${P2}', '${P3}', '${P4}');
  -- a real converted player (an M1e input row, a progress row, v1 potency or haste points if any)
  select i.player_id into xp from public.combat_v2_convert_input i join public.card_progress_v2 p on p.player_id = i.player_id and p.card_id = i.card_id
   order by (i.stat_points ? 'potency' or i.stat_points ? 'haste') desc, i.player_id limit 1;

  -- the helpers of this block (pg_temp, gone with the rollback): calls that never raise, counts of the rows a call may write
  create function pg_temp.sp(p text, c bigint, a jsonb) returns jsonb language plpgsql as $q$
  begin return public.stat_v2_spend(p, c, a); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.rs(p text, c bigint) returns jsonb language plpgsql as $q$
  begin return public.stat_v2_reset(p, c); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.sh(p text, kind text, c bigint) returns jsonb language plpgsql as $q$
  begin return public.buy_shop_item(p, kind, null, c, 1); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.v1(p text, c bigint) returns jsonb language plpgsql as $q$
  declare o jsonb := '[]';
  begin
    begin o := o || jsonb_build_array(public.spend_stat_points(p, c, '{"attack": 1}')); exception when others then o := o || jsonb_build_array(sqlerrm); end;
    begin o := o || jsonb_build_array(public.reset_stat_points(p, c)); exception when others then o := o || jsonb_build_array(sqlerrm); end;
    begin o := o || jsonb_build_array(public.buy_shop_item(p, 'stat_reset', null, c, 1)); exception when others then o := o || jsonb_build_array(sqlerrm); end;
    begin o := o || jsonb_build_array(public.buy_shop_item(p, 'stat_reset', null, -1, 1)); exception when others then o := o || jsonb_build_array(sqlerrm); end;
    begin o := o || jsonb_build_array(public.shop_today(p) - 'stock'); exception when others then o := o || jsonb_build_array(sqlerrm); end;
    begin o := o || jsonb_build_array(public.card_stats_for(p)); exception when others then o := o || jsonb_build_array(sqlerrm); end;
    return o;
  end $q$;
  create function pg_temp.snap(p text, c bigint) returns jsonb language sql as $q$
    select jsonb_build_object('rows', (select coalesce(jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id), '[]') from public.card_progress_v2 x where x.player_id = p and x.card_id = c),
      'log', (select count(*) from public.card_progress_v2_log l where l.player_id = p and l.card_id = c),
      'buys', (select count(*) from public.shop_purchases s where s.player_id = p), 'week', (select stat_reset_week from public.players where id = p)) $q$;
  -- T6: the ledger deltas of each progress row sum to the stored row (every stat column, level, XP, bonus); p null = every row
  create function pg_temp.t6(p text) returns int language sql as $q$
    select count(*)::int from public.card_progress_v2 x
     where (p is null or x.player_id = p) and row(x.level, x.xp, x.bonus_points, x.atk_pts, x.def_pts, x.hp_pts, x.crd_pts, x.crt_pts, x.abl_pts, x.ddg_pts, x.acc_pts, x.spd_pts)::text
       is distinct from (select row(coalesce(sum(l.d_level), 0), coalesce(sum(l.d_xp), 0), coalesce(sum(l.d_bonus), 0),
          coalesce(sum(l.d_points) filter (where l.stat = 'atk'), 0), coalesce(sum(l.d_points) filter (where l.stat = 'def'), 0),
          coalesce(sum(l.d_points) filter (where l.stat = 'hp'), 0), coalesce(sum(l.d_points) filter (where l.stat = 'crd'), 0),
          coalesce(sum(l.d_points) filter (where l.stat = 'crt'), 0), coalesce(sum(l.d_points) filter (where l.stat = 'abl'), 0),
          coalesce(sum(l.d_points) filter (where l.stat = 'ddg'), 0), coalesce(sum(l.d_points) filter (where l.stat = 'acc'), 0),
          coalesce(sum(l.d_points) filter (where l.stat = 'spd'), 0))::text
        from public.card_progress_v2_log l where l.progress_id = x.id) $q$;

  -- G-S10 before: 6 v1 calls of a player with the flag off, each rolled back (a sub-block), BEFORE the file
  begin v1a := pg_temp.v1('${P2}', c1); raise exception 'SCN'; exception when raise_exception then if sqlerrm <> 'SCN' then raise; end if; end;
  select jsonb_object_agg(${sig}, md5(pg_get_functiondef(p.oid))) into md5a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into fns_a from pg_proc p where p.pronamespace = 'public'::regnamespace;
  select value->'testers' into tst from public.balance where key = 'combat_v2';

  execute $m$${mig}$m$;

  -- T1. no other change; the file runs twice
  select jsonb_object_agg(${sig}, md5(pg_get_functiondef(p.oid))) into md5b from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and ${sig} <> all (newf) and ${sig} <> all (chg);
  res := res || jsonb_build_object('case', 'T1 the md5 of every other public function does not change', 'ok', md5a - chg = md5b,
    'changed', (select jsonb_agg(x.key) from jsonb_each_text(md5b) x where md5a->>x.key is distinct from x.value), 'gone', (select jsonb_agg(x) from jsonb_object_keys(md5a - chg) x where not md5b ? x));
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into fns_b from pg_proc p where p.pronamespace = 'public'::regnamespace and ${sig} <> all (fns_a);
  res := res || jsonb_build_object('case', 'T1 exactly the 7 new functions are added', 'ok', fns_b = (select array_agg(x order by x) from unnest(newf) x), 'added', fns_b);
  bad := '{}';
  foreach k in array chg loop
    if md5(replace(pg_get_functiondef(('public.' || k)::regprocedure), chr(13), '')) is distinct from (${md5lit}::jsonb -> split_part(k, '(', 1) ->> 'new') then bad := bad || k; end if;
  end loop;
  res := res || jsonb_build_object('case', 'T1 the 4 replaced functions have the new md5 of the guard', 'ok', cardinality(bad) = 0, 'bad', bad);
  select value into sv from public.settings where key = 'stat_v2';
  res := res || jsonb_build_object('case', 'T1 settings stat_v2 = {enabled: false, users: the combat_v2 tester list}', 'ok', sv = jsonb_build_object('enabled', false, 'users', coalesce(tst, '[]'::jsonb)), 'got', sv);
  select jsonb_object_agg(${sig}, md5(pg_get_functiondef(p.oid))) into md5b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  -- the second run in a sub-block: a refusal (the guard refuses a text that is not the new md5) is a FAIL of this case, not of the block
  begin
    execute $m$${mig}$m$;
    ok := md5b = (select jsonb_object_agg(${sig}, md5(pg_get_functiondef(p.oid))) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p'))
      and (select value from public.settings where key = 'stat_v2') = sv and (select count(*) from public.balance where key = 'stat_labels_v2') = 1;
    m := null;
  exception when others then ok := false; m := sqlerrm;
  end;
  res := res || jsonb_build_object('case', 'T1 the file runs twice: no function, no settings value and no label value changes', 'ok', ok, 'raised', m);
  -- the guard refuses another text of a replaced function
  begin
    execute replace(pg_get_functiondef('public.shop_today(text)'::regprocedure), 'declare cfg jsonb', E'-- another text\ndeclare cfg jsonb');
    execute $m$${guard}$m$;
    ok := false;
    raise exception 'SCN';
  exception when raise_exception then ok := sqlerrm like 'stat_v2.sql: the live public.shop_today(text) changed%'; end;
  res := res || jsonb_build_object('case', 'T1 the guard refuses another text of a replaced function', 'ok', ok);
  -- the label key and its limits
  r := (select value from public.balance where key = 'stat_labels_v2');
  res := res || jsonb_build_object('case', 'T1 balance stat_labels_v2 has the 9 stats with the UI-67 names', 'ok',
    (select string_agg(x.key || '=' || (x.value->>'label') || '/' || (x.value->>'short'), ',' order by x.key) from jsonb_each(r) x)
      = 'abl=Ability/ABL,acc=Accuracy/ACC,atk=Attack/ATK,crd=Crit Damage/CRD,crt=Crit %/CRT,ddg=Dodge/DDG,def=Defense/DEF,hp=HP/HP,spd=Speed/SPD', 'got', r);
  n := 0;
  foreach k in array array['{"atk", "label"}=""', '{"atk", "short"}="ATTACK"', '{"zzz"}={"label": "Z", "short": "Z"}'] loop
    begin
      update public.balance set value = jsonb_set(value, split_part(k, '=', 1)::text[], split_part(k, '=', 2)::jsonb, true) where key = 'stat_labels_v2';
    exception when others then n := n + 1; end;
  end loop;
  res := res || jsonb_build_object('case', 'T1 balance_check_stat_labels_v2 refuses an empty label, a long short and a 10th stat', 'ok', n = 3, 'refused', n);

  -- T2. server only
  bad := '{}';
  foreach k in array newf loop
    if has_function_privilege('anon', 'public.' || k, 'execute') or has_function_privilege('authenticated', 'public.' || k, 'execute') then bad := bad || ('anon or authenticated can execute ' || k); end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = ('public.' || k)::regprocedure and a.grantee = 0) or (select proacl is null from pg_proc where oid = ('public.' || k)::regprocedure) then bad := bad || ('public can execute ' || k); end if;
    if not exists (select 1 from pg_proc p where p.oid = ('public.' || k)::regprocedure and 'search_path=public' = any(p.proconfig)) then bad := bad || ('no search_path: ' || k); end if;
    if coalesce(obj_description(('public.' || k)::regprocedure, 'pg_proc'), '') !~ (case when k like 'balance_check%' then '^Trigger' else '^\[combat\] STAT-V2' end) then bad := bad || ('no comment: ' || k); end if;
  end loop;
  res := res || jsonb_build_object('case', 'T2 server only: no execute for public, anon, authenticated; search_path; a comment each', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- "flag on": the global progress flag and the test players (and the real converted player) in stat_v2.users
  update public.balance set value = jsonb_set(value, '{progress}', 'true') where key = 'combat_v2';
  update public.settings set value = jsonb_build_object('enabled', false, 'users', jsonb_build_array('${P1}', '${P4}', xp)) where key = 'stat_v2';

  -- G-S1: no row, 3 stars
  r := pg_temp.sp('${P1}', c1, '{"hp": 2}');
  select to_jsonb(x) - 'updated_at' - 'created_at' - 'id' into s1 from public.card_progress_v2 x where x.player_id = '${P1}' and x.card_id = c1;
  res := res || jsonb_build_object('case', 'G-S1 no row, 3 stars: spend hp 2 = ok; row level 9, xp of level 9, hp 2; ledger 1 grant_level (d_level 9, ref stars:n) + 1 spend hp 2; T6', 'ok',
    r->>'ok' = 'true' and (s1->>'level')::int = 9 and (s1->>'xp')::int = card_level_xp_at(9) and (s1->>'hp_pts')::int = 2
    and (select count(*) from public.card_progress_v2_log where player_id = '${P1}' and card_id = c1) = 2
    and exists (select 1 from public.card_progress_v2_log where player_id = '${P1}' and card_id = c1 and reason = 'grant_level' and d_level = 9 and d_xp = card_level_xp_at(9) and ref ~ '^stars:[0-9]+$')
    and exists (select 1 from public.card_progress_v2_log where player_id = '${P1}' and card_id = c1 and reason = 'spend' and stat = 'hp' and d_points = 2)
    and pg_temp.t6('${P1}') = 0, 'got', jsonb_build_object('r', r, 'row', s1));

  -- G-S2: a row of level 6 (atk 6), the card goes from 2 to 4 stars: spend def 6
  update public.player_cards set ascension = 4 where player_id = '${P1}' and card_id = c2;
  r := pg_temp.sp('${P1}', c2, '{"def": 6}');
  res := res || jsonb_build_object('case', 'G-S2 row level 6 with atk 6, stars 2 -> 4: spend def 6 = ok; level 12; one new grant_level d_level 6', 'ok',
    r->>'ok' = 'true' and (select level from public.card_progress_v2 where player_id = '${P1}' and card_id = c2) = 12
    and (select count(*) from public.card_progress_v2_log where player_id = '${P1}' and card_id = c2 and reason = 'grant_level' and starts_with(ref, 'stars:') and d_level = 6) = 1
    and (select count(*) from public.card_progress_v2_log where player_id = '${P1}' and card_id = c2 and reason = 'grant_level') = 2, 'got', r);

  -- G-S3: level 12, atk 9: atk 1 (exactly the cap), then atk 1 again
  r := pg_temp.sp('${P1}', c3, '{"atk": 1}');
  s0 := pg_temp.snap('${P1}', c3);
  r2 := pg_temp.sp('${P1}', c3, '{"atk": 1}');
  res := res || jsonb_build_object('case', 'G-S3 atk 9 -> 10 = ok (the cap); then atk 1 = stat_cap with cap 10 (v2_stats.max_per_stat), 0 rows written', 'ok',
    r->>'ok' = 'true' and r->'progress'->'points'->>'atk' = '10' and r2->>'error' = 'stat_cap' and (r2->>'cap')::int = balance_num('v2_stats', 'max_per_stat')::int
    and pg_temp.snap('${P1}', c3) = s0, 'got', jsonb_build_object('first', r, 'second', r2));

  -- G-S4: level 12, 10 spent, free 2: spend 3
  s0 := pg_temp.snap('${P1}', c3);
  r := pg_temp.sp('${P1}', c3, '{"def": 3}');
  res := res || jsonb_build_object('case', 'G-S4 spend free + 1 = not_enough with free 2, 0 rows written', 'ok',
    r->>'error' = 'not_enough' and (r->>'free')::int = 2 and pg_temp.snap('${P1}', c3) = s0, 'got', r);

  -- G-S5: the flag off for P2 (enabled false, not in users; a member of live)
  s0 := pg_temp.snap('${P2}', c1);
  r := jsonb_build_object('spend', pg_temp.sp('${P2}', c1, '{"atk": 1}'), 'read', public.card_stats_v2_for('${P2}'), 'shop', pg_temp.sh('${P2}', 'stat_reset', c1),
    'today', public.shop_today('${P2}')->'stat_reset_paused', 'reset', pg_temp.rs('${P2}', c1));
  res := res || jsonb_build_object('case', 'G-S5 flag off: stat_v2_spend and stat_v2_reset = disabled; card_stats_v2_for = {on: false}; Shop stat_reset = stat_reset_paused; shop_today.stat_reset_paused true; 0 rows', 'ok',
    r->'spend'->>'error' = 'disabled' and r->'reset'->>'error' = 'disabled' and r->'read' = '{"on": false}'::jsonb and r->'shop'->>'error' = 'stat_reset_paused'
    and r->'today' = 'true'::jsonb and pg_temp.snap('${P2}', c1) = s0, 'got', r);

  -- G-S5b: (a) P1 in users, global progress false; (b) P3 in users AND in the tester list, global progress false
  update public.balance set value = jsonb_set(jsonb_set(value, '{progress}', 'false'), '{testers}', (value->'testers') || to_jsonb('${P3}'::text)) where key = 'combat_v2';
  update public.settings set value = jsonb_set(value, '{users}', (value->'users') || to_jsonb('${P3}'::text)) where key = 'stat_v2';
  s0 := pg_temp.snap('${P3}', c1);
  r := jsonb_build_object('a', public.stat_v2_on('${P1}'), 'b', public.stat_v2_on('${P3}'), 'b_tester', public.combat_v2_on('progress', '${P3}'),
    'b_spend', pg_temp.sp('${P3}', c1, '{"atk": 1}'), 'b_shop', pg_temp.sh('${P3}', 'stat_reset', c1));
  res := res || jsonb_build_object('case', 'G-S5b progress false: (a) a stat_v2 user and (b) a stat_v2 user who is a combat_v2 tester: stat_v2_on false; (b) spend disabled, Shop stat_reset_paused, 0 rows', 'ok',
    r->'a' = 'false'::jsonb and r->'b' = 'false'::jsonb and r->'b_tester' = 'true'::jsonb and r->'b_spend'->>'error' = 'disabled' and r->'b_shop'->>'error' = 'stat_reset_paused'
    and pg_temp.snap('${P3}', c1) = s0, 'got', r);
  update public.balance set value = jsonb_set(value, '{progress}', 'true') where key = 'combat_v2';

  -- G-S6: the flag on, the week free: the Shop stat reset of a spent card (c1: hp 2)
  s0 := pg_temp.snap('${P1}', c1);
  n := (select count(*) from public.card_progress_v2_log where player_id = '${P1}' and card_id = c1 and reason = 'reset');
  r := pg_temp.sh('${P1}', 'stat_reset', c1);
  res := res || jsonb_build_object('case', 'G-S6 flag on, the week free: Shop stat_reset of a spent card = ok, price 0, points 0, 1 reset ledger row, 1 shop_purchases row', 'ok',
    r->>'ok' = 'true' and (r->>'price')::int = 0 and r->'progress'->'points' = ${ZERO9}
    and (select count(*) from public.card_progress_v2_log where player_id = '${P1}' and card_id = c1 and reason = 'reset') = n + 1
    and (pg_temp.snap('${P1}', c1)->>'buys')::int = (s0->>'buys')::int + 1, 'got', r);
  r := public.shop_today('${P1}');
  res := res || jsonb_build_object('case', 'G-S6 shop_today of a player with the flag on: stat_reset_paused false', 'ok', r->'stat_reset_paused' = 'false'::jsonb, 'got', r->'stat_reset_paused');

  -- G-S8: one card: spend, ascend, spend, spend
  r := pg_temp.sp('${P1}', c5, '{"atk": 1}');
  update public.player_cards set ascension = 2 where player_id = '${P1}' and card_id = c5;
  r2 := pg_temp.sp('${P1}', c5, '{"atk": 1}');
  n := (select count(*) from public.card_progress_v2_log where player_id = '${P1}' and card_id = c5 and reason = 'grant_level');
  s1 := pg_temp.sp('${P1}', c5, '{"def": 1}');
  res := res || jsonb_build_object('case', 'G-S8 spend (1 star), ascend to 2, spend, spend: exactly one grant_level per raise (2, each d_level 3); the last spend adds 0 grant rows', 'ok',
    r->>'ok' = 'true' and r2->>'ok' = 'true' and s1->>'ok' = 'true' and n = 2
    and (select count(*) from public.card_progress_v2_log where player_id = '${P1}' and card_id = c5 and reason = 'grant_level' and d_level = 3) = 2, 'got', jsonb_build_array(r, r2, s1));

  -- G-S11: no row, 3 stars: a stat_cap and a not_enough refusal write nothing (I6)
  r := jsonb_build_object('cap', pg_temp.sp('${P1}', c6, '{"atk": 11}'), 'budget', pg_temp.sp('${P1}', c6, '{"hp": 10}'));
  res := res || jsonb_build_object('case', 'G-S11 no row, 3 stars: atk 11 = stat_cap, hp 10 = not_enough (free 9); no card_progress_v2 row and no ledger row for the card', 'ok',
    r->'cap'->>'error' = 'stat_cap' and r->'budget'->>'error' = 'not_enough' and (r->'budget'->>'free')::int = 9
    and not exists (select 1 from public.card_progress_v2 where player_id = '${P1}' and card_id = c6)
    and not exists (select 1 from public.card_progress_v2_log where player_id = '${P1}' and card_id = c6), 'got', r);

  -- the checks of the answers: input words of M1c, no role, not owned
  r := jsonb_build_array(pg_temp.sp('${P1}', c1, '{}'), pg_temp.sp('${P1}', c1, '{"attack": 1}'), pg_temp.sp('${P1}', c1, '{"atk": 0}'), pg_temp.sp('${P1}', c1, '{"atk": 1.5}'),
    pg_temp.sp('${P1}', c8, '{"atk": 1}'));
  res := res || jsonb_build_object('case', 'the input refusals (M1c words): bad_request, bad_stat, bad_amount (0 and 1.5); a card not owned = not_owned', 'ok',
    r->0->>'error' = 'bad_request' and r->1->>'error' = 'bad_stat' and r->2->>'error' = 'bad_amount' and r->3->>'error' = 'bad_amount' and r->4->>'error' = 'not_owned', 'got', r);

  -- G-S7: the read for P1 (synced rows, no row with stars, no row with 0 stars, an ascended row), P4 (a row of level 3, 3 stars now) and a real converted player
  bad := '{}'; cnt := 0;
  b := combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed']);
  foreach px in array array['${P1}', '${P4}', xp] loop
    r := public.card_stats_v2_for(px);
    s0 := public.card_stats_for(px);
    if r->>'on' <> 'true' or r->>'week' is distinct from s0->>'week' or r->'reset_week' is distinct from s0->'reset_week' then bad := bad || (px || ' on/week'); end if;
    n := (select count(*) from public.player_cards pc join public.cards c on c.id = pc.card_id join public.subjects s on s.id = c.subject_id
           where pc.player_id = px and pc.quantity > 0 and s.ability_v2->>'role' in (select key from public.roles));
    if (select count(*) from jsonb_object_keys(r->'cards')) <> n then bad := bad || (px || ' count'); end if;
    for rw in select pc.card_id, pc.ascension, c.rarity::text as rarity, s.cp_mod, s.ability_v2->>'role' as role from public.player_cards pc join public.cards c on c.id = pc.card_id
               join public.subjects s on s.id = c.subject_id where pc.player_id = px and pc.quantity > 0 and s.ability_v2->>'role' in (select key from public.roles) loop
      cnt := cnt + 1;
      e := r->'cards'->(rw.card_id::text);
      e2 := public.card_progress_v2_fight(px, rw.card_id);
      s1 := public.card_combat_v2(rw.rarity, rw.ascension, rw.cp_mod, (e2->>'level')::int, ${ZERO9} || coalesce(e2->'points', '{}'), rw.role, b, (e2->>'bonus')::int)->'stats';
      if e is null or (e->>'level')::int <> (e2->>'level')::int or e->'points' <> (${ZERO9} || coalesce(e2->'points', '{}')) or (e->>'bonus')::int <> (e2->>'bonus')::int
         or e->'cp' <> s1->'atk' or e->'hp' <> s1->'hp' or (e->>'crit')::numeric <> (s1->>'crt')::numeric - (select (value->'crt'->>'base')::numeric from public.balance where key = 'v2_stats')
         or (e->>'potency')::numeric <> coalesce((s0->'cards'->(rw.card_id::text)->>'potency')::numeric, 1)
         or (e->>'haste')::numeric <> coalesce((s0->'cards'->(rw.card_id::text)->>'haste')::numeric, 1)
         or (e->>'free')::int <> (e2->>'level')::int * balance_num('v2_level', 'points_per_level')::int + (e2->>'bonus')::int - (select coalesce(sum(x.value::int), 0) from jsonb_each_text(e2->'points') x)
         or (e->>'cap')::int <> balance_num('v2_stats', 'max_per_stat')::int or e->'v2' <> 'true'::jsonb then
        bad := bad || (px || ':' || rw.card_id);
      end if;
    end loop;
  end loop;
  res := res || jsonb_build_object('case', format('G-S7 the read of %s cards (3 players: synced rows, no row, an ascended row, a real converted player): level/points/bonus = card_progress_v2_fight, cp/hp/crit = card_combat_v2 of that line (crit minus crt.base), potency/haste = card_stats_for, free, cap; week/reset_week = card_stats_for', cnt),
    'ok', cardinality(bad) = 0 and cnt > 10 and xp is not null, 'bad', bad[1:5]);
  -- the spend answer carries the screen line (stats = card_stats_v2_entry)
  r := pg_temp.sp('${P1}', c4, '{"spd": 1}');
  res := res || jsonb_build_object('case', 'the spend answer: ok, progress (M1c) and stats = card_stats_v2_entry of the card', 'ok',
    r->>'ok' = 'true' and r->'stats' = public.card_stats_v2_entry('${P1}', c4) and r->'progress'->'points'->>'spd' = '1', 'got', r);
  -- the reset with the flag: the M1c / M1d reset (the week was used by G-S6, no v2 gift: reset_used)
  r := pg_temp.rs('${P1}', c4);
  res := res || jsonb_build_object('case', 'stat_v2_reset with the flag on = reset_card_points_v2 (the week used by G-S6, no v2 gift: reset_used with next)', 'ok', r->>'error' = 'reset_used' and r ? 'next', 'got', r);

  -- G-S10: the same 6 v1 calls of the flag-off player, after the file
  begin v1b := pg_temp.v1('${P2}', c1); raise exception 'SCN'; exception when raise_exception then if sqlerrm <> 'SCN' then raise; end if; end;
  res := res || jsonb_build_object('case', 'G-S10 flag off: spend_stat_points, reset_stat_points, 2 Shop stat_reset calls, shop_today and card_stats_for answer as before the file', 'ok', v1a = v1b, 'before', v1a, 'after', v1b);

  -- G-S9: the flag on for everyone; every owned card with a fight level above 0 spends ALL its free points over the stats
  update public.settings set value = jsonb_set(value, '{enabled}', 'true') where key = 'stat_v2';
  nok := 0; nbad := 0; fails := '[]'; n2 := 0;
  cap := balance_num('v2_stats', 'max_per_stat')::int;
  b := combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_convert']) || jsonb_build_object('v1', card_balance());
  for rw in select pc.player_id, pc.card_id from public.player_cards pc join public.cards c on c.id = pc.card_id join public.subjects s on s.id = c.subject_id
             where pc.quantity > 0 and s.ability_v2->>'role' in (select key from public.roles) order by pc.player_id, pc.card_id loop
    e := public.card_stats_v2_entry(rw.player_id, rw.card_id, b);
    if (e->>'free')::int < 0 then nbad := nbad + 1; fails := fails || jsonb_build_object('neg', rw.card_id); continue; end if;
    if (e->>'level')::int = 0 or (e->>'free')::int = 0 then continue; end if;
    n2 := n2 + 1;
    add := '{}'; left_ := (e->>'free')::int;
    foreach k in array array['atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd'] loop
      room := least(cap - (e->'points'->>k)::int, left_);
      if room > 0 then add := add || jsonb_build_object(k, room); left_ := left_ - room; end if;
    end loop;
    if add = '{}'::jsonb then continue; end if;
    r := pg_temp.sp(rw.player_id, rw.card_id, add);
    e2 := public.card_stats_v2_entry(rw.player_id, rw.card_id, b);
    if r->>'ok' = 'true' and (e2->>'free')::int = left_ then nok := nok + 1;
    else nbad := nbad + 1; if jsonb_array_length(fails) < 5 then fails := fails || jsonb_build_object('r', coalesce(r->>'error', r->>'raised'), 'free_before', e->'free', 'free_after', e2->'free', 'left', left_); end if; end if;
  end loop;
  r := public.combat_v2_convert_check();
  res := res || jsonb_build_object('case', format('G-S9 flag on for all: %s cards with a fight level and free points spend every free point: every answer ok and free after = 0 (or every stat at the cap); T6 for every row; combat_v2_convert_check ok', n2),
    'ok', nbad = 0 and nok = n2 and n2 > 100 and pg_temp.t6(null) = 0 and r->>'ok' = 'true',
    'spent_ok', nok, 'bad', nbad, 'fails', fails, 't6_bad', pg_temp.t6(null), 'check', r - 'items', 'items', r->'items'->0);

  -- G-S13: one converted and spent row (an M1e input row; def >= 1, atk below the cap): atk + 1, def - 1 with the row trigger off (test only)
  select p.player_id, p.card_id into px, xc from public.card_progress_v2 p
   where exists (select 1 from public.combat_v2_convert_input i where i.player_id = p.player_id and i.card_id = p.card_id)
     and exists (select 1 from public.card_progress_v2_log l where l.progress_id = p.id and l.reason = 'spend')
     and p.def_pts >= 1 and p.atk_pts < cap order by p.player_id, p.card_id limit 1;
  if xc is null then
    -- G-S9 gives none (it fills atk first): the seed of SPEC G-S13: a card converted from v1 attack 3 at 4 stars (its input row, the M1e write),
    -- then a stat screen spend of def 2
    px := '${P4}'; xc := c7;
    insert into public.player_cards (player_id, card_id, quantity, first_source, ascension, stat_points) values (px, xc, 1, 'admin', 4, '{"attack": 3}');
    insert into public.combat_v2_convert_input (ref, player_id, card_id, stars, stat_points) values ('statv2t', px, xc, 4, '{"attack": 3}') returning id into pid;
    perform public.combat_v2_convert_write(pid);
    r := pg_temp.sp(px, xc, '{"def": 2}');
    ok := r->>'ok' = 'true' and (select level from public.card_progress_v2 where player_id = px and card_id = xc) = 12
       and (select atk_pts from public.card_progress_v2 where player_id = px and card_id = xc) < cap
       and (public.combat_v2_convert_check(array[xc])->>'ok') = 'true';
    res := res || jsonb_build_object('case', 'G-S13 seed: a clean converted row of level 12 (attack 3 at 4 stars) with a stat screen spend of def 2; the check finds nothing', 'ok', coalesce(ok, false), 'got', r);
  end if;
  alter table public.card_progress_v2 disable trigger card_progress_v2_check;
  update public.card_progress_v2 set atk_pts = atk_pts + 1, def_pts = def_pts - 1 where player_id = px and card_id = xc and def_pts >= 1 and atk_pts < cap;
  alter table public.card_progress_v2 enable trigger card_progress_v2_check;
  r := public.combat_v2_convert_check(array[xc]);
  res := res || jsonb_build_object('case', 'G-S13 a converted and spent row (def >= 1, atk below the cap; the SPEC seed when G-S9 gives none) with atk + 1 and def - 1 (the total equal, so the T6 total sum of the check holds): combat_v2_convert_check reports progress_mismatch for it (I7)', 'ok',
    xc is not null and exists (select 1 from jsonb_array_elements(r->'items') i where i->>'player_id' = px and (i->>'card_id')::bigint = xc and i->'why' ? 'progress_mismatch'),
    'got', r - 'items');
  -- the fix reports a spent or synced row and never deletes it
  r := public.combat_v2_convert_fix(array[xc]);
  res := res || jsonb_build_object('case', 'combat_v2_convert_fix: the changed row is reported (reported_spent), not deleted', 'ok',
    (r->>'reported_spent')::int >= 1 and (r->>'fixed')::int = 0 and exists (select 1 from public.card_progress_v2 where player_id = px and card_id = xc), 'got', r);

  raise exception 'RESULT:%', res::text;
end $t$;`;

let results;
try { results = JSON.parse(await runBlock(body)); }
catch (e) { console.log(`FAIL the test block raised (the file did not apply?): ${String(e.message).slice(0, 1500)}`); console.log('1 of 1 FAILED'); process.exit(1); }
results = [...t0.map((x) => ({ case: `G-S0 T0 ${x.n}: the M1e text is kept; only lines with the mark -- STAT-V2 are added (${x.added}) or swapped for the named M1e lines`, ok: x.ok })), ...results];
let fail = 0;
for (const r of results) {
  const { case: name, ok, ...rest } = r;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
