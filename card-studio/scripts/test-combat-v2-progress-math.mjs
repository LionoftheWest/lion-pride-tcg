import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_progress_math.sql (combat v2 step M1b: the XP of a level, the level of an XP, the XP award with
 * the catch-up rule, the M1a trigger with the one XP formula, and card_combat_v2 with bonus points; plan 2.4, 11, 20.11 and 20.12).
 * NO lasting change: every request is one DO block, undone by its final RAISE. Each block first puts back the state before the file (the new
 * functions dropped, the M1a body of the trigger and the E3 body of card_combat_v2 put back; the test checks their md5 against main), so the
 * test passes before and after the file is applied. The sample rows use a card that the sample player does not own (an added player_cards
 * row); nothing is printed about a member (counts and case names only).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-progress-math.mjs     must PASS
 *   MUTATE=<name> ...                                                                                  must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                     the baseline (must PASS), then every mutation, one line each
 * The reference is the simulator card-studio/v2sim (formulas.mjs F.xpAt, F.levelOfXp, F.xpAward, F.pointBudget; cards.mjs makeCard with bonus).
 * Invariants:
 *   T1 (flag OFF identity): the md5 of every other public function does not change; exactly card_combat_v2 (7 arguments) and
 *      card_progress_v2_check are replaced and exactly the 7 new functions are added; the callers of card_combat_v2 and of the trigger,
 *      and the readers of combat_v2_on, do not change; no other function calls a new function; the flag combat_v2 does not change
 *      (progress false); both progress tables stay empty.
 *   Old = new: card_combat_v2 (6 and 7 arguments, and the new form with bonus 0) gives the same answer or the same error text as the E3 body
 *      on a grid of every rarity x stars -1 to 6 x 10 levels x 12 roles with the simulator build, random point builds and bad inputs.
 *      The trigger accepts and refuses the same rows as the M1a body on every level -1 to max + 1, the XP boundaries of each level and 4
 *      point layouts, with today's balance and with changed numbers (cost 6 + 2L, max level 40, 2 points a level, 12 a stat); the error
 *      texts are the same after the decimals of the M1a texts are removed.
 *   The math: fixed hand-computed XP, levels, awards and budgets; SQL = the simulator on 2,000 random balance sets and 1,500 random cards
 *      with bonus points; a missing balance number REFUSES with its text (never a null that passes a check), also with the balance row gone.
 *   Pure and server only: IMMUTABLE pure forms, STABLE balance forms, search_path set, no execute for anon and authenticated, a comment each.
 *   The trigger has one XP formula (it calls card_level_xp_at and names no card_level cost). The file runs twice.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { F } from '../v2sim/formulas.mjs';
import { makeCard, buildFor, ROLES, STATS } from '../v2sim/cards.mjs';
import { loadConfig, patch, mkRng } from '../v2sim/util.mjs';
assertLocal('test-combat-v2-progress-math.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_progress_math.sql');
// the bodies before this file: card_combat_v2 (7 arguments) of E3 and the trigger of M1a, with their md5 on main (db/schema/functions.md5)
const pick = (text, re, what) => { const m = text.match(re); if (!m) throw new Error(`the old body of ${what} was not found`); return m[0]; };
const OLD_CC7 = pick(read('combat_v2_stats.sql'), /create or replace function public\.card_combat_v2\(p_rarity text, p_stars int, p_mod numeric, p_level int, p_pts jsonb, p_role text, p_b jsonb\) returns jsonb\n[\s\S]*?\nend \$fn\$;\n/, 'card_combat_v2 (7)');
const OLD_TRG = pick(read('combat_v2_progress_tables.sql'), /create or replace function public\.card_progress_v2_check\(\) returns trigger[\s\S]*?\nend \$fn\$;\n/, 'card_progress_v2_check');
const OLD_MD5 = { 'card_combat_v2(text,integer,numeric,integer,jsonb,text,jsonb)': 'e80dee0298940fbbb0ae6be47f848915', 'card_progress_v2_check()': 'cd71df2603e54c449ce2d7bb99061f71' };
const REPLACED = Object.keys(OLD_MD5);
const NEW = ['card_level_xp_at(integer,jsonb)', 'card_level_xp_at(integer)', 'card_level_of_xp(integer,jsonb)', 'card_level_of_xp(integer)',
  'card_level_xp_award(text,integer,integer[],jsonb)', 'card_level_xp_award(text,integer,integer[])', 'card_combat_v2(text,integer,numeric,integer,jsonb,text,jsonb,integer)'];
const PURE = ['card_level_xp_at(integer,jsonb)', 'card_level_of_xp(integer,jsonb)', 'card_level_xp_award(text,integer,integer[],jsonb)'];

const MUT = {
  xp_cost_plus_one: ['select coalesce(sum(base + per * k), 0)', 'select coalesce(sum(base + per * k + 1), 0)'],
  xp_series_off_by_one: ['from generate_series(0, p_level - 1) k', 'from generate_series(0, p_level) k'],
  xp_null_fails_open: [["(p_b->'card_level'->>'cost_base')::numeric;", "(p_b->'card_level'->>'cost_basis')::numeric;"], ['  if base is null or per is null or mx is null then\n', '  if false then\n']],
  xp_negative_ok: ["if p_level is null or p_level < 0 then raise exception 'card_level_xp_at", "if p_level is null then raise exception 'card_level_xp_at"],
  xp_above_max_ok: ["  if p_level > mx then raise exception 'card_level_xp_at: level % is above v2_level.max_level %', p_level, mx; end if;\n", ''],
  xp_fraction_ok: ["  if base <> trunc(base) or per <> trunc(per) then raise exception 'card_level_xp_at: the card_level costs must be whole numbers'; end if;\n", ''],
  level_boundary: ['card_level_xp_at(lv + 1, p_b) <= p_xp', 'card_level_xp_at(lv + 1, p_b) < p_xp'],
  level_null_fails_open: ["if mx is null then raise exception 'card_level_of_xp", "if false then raise exception 'card_level_of_xp"],
  award_top_all: ['order by v desc limit top) t;', 'order by v desc) t;'],
  award_at_mean: ['if n > 0 and p_level * n < s then', 'if n > 0 and p_level * n <= s then'],
  award_rounds: ['return floor(base * x)::int;', 'return (base * x)::int;'],
  award_sources_swapped: ["case p_source when 'hunt' then (c->>'xp_hunt_day')::numeric else (c->>'xp_dungeon_run')::numeric end", "case p_source when 'hunt' then (c->>'xp_dungeon_run')::numeric else (c->>'xp_hunt_day')::numeric end"],
  award_gauntlet_ok: ["p_source not in ('hunt', 'dungeon') then", "p_source not in ('hunt', 'dungeon', 'gauntlet') then"],
  award_bad_list_ok: ['  if p_levels is null or array_position(p_levels, null) is not null or exists (select 1 from unnest(p_levels) v where v < 0) then\n', '  if p_levels is null then\n'],
  award_null_fails_open: [["x numeric := (c->>'catchup_x')::numeric;", "x numeric := (c->>'catchup_xx')::numeric;"], ['  if base is null or x is null or top is null then\n', '  if base is null or top is null then\n']],
  trg_next_null_fails_open: ['if new.level < v_max then v_next := card_level_xp_at(new.level + 1); end if;', "if new.level < v_max then v_next := (select (value->>'cost_next')::int from public.balance where key = 'card_level'); end if;"],
  trg_xp_plus_one: ['v_at := card_level_xp_at(new.level);', 'v_at := card_level_xp_at(new.level) + 1;'],
  trg_inline_formula: ['v_at := card_level_xp_at(new.level);', "v_at := new.level * balance_num('card_level', 'cost_base')::int + balance_num('card_level', 'cost_per_level')::int * new.level * (new.level - 1) / 2;"],
  trg_budget_no_bonus: ['if v_spent > new.level * v_ppl + new.bonus_points then', 'if v_spent > new.level * v_ppl then'],
  cc_bonus_ignored: ['if spent > lpts + p_bonus then', 'if spent > lpts then'],
  cc_bonus_negative_ok: ["  if p_bonus is null or p_bonus < 0 then raise exception 'card_combat_v2: the bonus points must be 0 or more'; end if;\n", ''],
  cc_free_no_bonus: ["'points_free', lpts + p_bonus - spent,", "'points_free', lpts - spent,"],
  cc7_bonus_one: ['select card_combat_v2(p_rarity, p_stars, p_mod, p_level, p_pts, p_role, p_b, 0);', 'select card_combat_v2(p_rarity, p_stars, p_mod, p_level, p_pts, p_role, p_b, 1);'],
  cc_old_text_gone: ["    if p_bonus = 0 then raise exception 'card_combat_v2: % points spent, the level % gives %', spent, p_level, lpts; end if;\n", ''],
  cc_dial_off: ["cp_base := cp_asc + (lv->>'converge_d')::numeric * lvl", 'cp_base := cp_asc + 0 * lvl'],
  cc_default_arg: ['p_role text, p_b jsonb, p_bonus int) returns jsonb', 'p_role text, p_b jsonb, p_bonus int default 0) returns jsonb'],
  pure_volatile: ["returns int\nlanguage plpgsql immutable set search_path = public as $fn$\ndeclare\n  base numeric", "returns int\nlanguage plpgsql volatile set search_path = public as $fn$\ndeclare\n  base numeric"],
  no_search_path: ["returns int\nlanguage plpgsql immutable set search_path = public as $fn$\ndeclare\n  mx numeric", "returns int\nlanguage plpgsql immutable as $fn$\ndeclare\n  mx numeric"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.card_level_of_xp\(integer\) is \$cm\$[^\n]*\n/, ''],
  flag_on: ['-- ============================================================ 5. server only', "update public.balance set value = jsonb_set(value, '{progress}', 'true') where key = 'combat_v2';\n-- ============================================================ 5. server only"],
  v1_touched: ['-- ============================================================ 5. server only',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::int  $fn$;\n-- ============================================================ 5. server only"],
  extra_caller: ['-- ============================================================ 5. server only',
    "create or replace function public.card_level_probe() returns int language sql stable set search_path = public as $p$ select card_level_xp_at(3) $p$;\n-- ============================================================ 5. server only"],
};
const pairs = (m) => (Array.isArray(m[0]) ? m : [m]);

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)         ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  for (const [a, b] of pairs(m)) {
    const n = a instanceof RegExp ? (mig.match(new RegExp(a.source, 'g')) || []).length : mig.split(a).length - 1;
    if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once`);
    mig = a instanceof RegExp ? mig.replace(a, b) : mig.split(a).join(b);
  }
}
for (const t of [mig, OLD_CC7, OLD_TRG]) if (['$m$', '$t$', '$s$'].some((x) => t.includes(x))) throw new Error('the SQL must not contain $m$, $t$ or $s$');

const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(lit).join(', ')}]::text[]`;
const MD5 = `md5(replace(pg_get_functiondef(p.oid), chr(13), ''))`;
const SIG = `replace(p.oid::regprocedure::text, ', ', ',')`;
const NUMS6 = `combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed'])`;
// the state before the file (also when the file is applied on this copy): the new functions dropped, the old bodies put back, the comments
// of the replaced functions cleared (so the comment check sees what the file makes)
const BEFORE = String.raw`
  perform set_config('balance.by', 'test', true);
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
             and (p.proname in ('card_level_xp_at', 'card_level_of_xp', 'card_level_xp_award') or (p.proname = 'card_combat_v2' and p.pronargs = 8)) loop
    execute 'drop function ' || f;
  end loop;
  execute $m$${OLD_CC7}$m$;
  execute $m$${OLD_TRG}$m$;
  comment on function public.card_combat_v2(text, integer, numeric, integer, jsonb, text, jsonb) is null;
  comment on function public.card_progress_v2_check() is null;`;

// the sweep of the trigger: every level -1 to max + 1, 5 XP values at the boundaries (closed formula of the test), 4 point layouts.
// One text per update: 'ok' or 'ERR <message>'.
const SWEEP = (into) => String.raw`
  for bs in 1..2 loop
    if bs = 2 then
      update public.balance set value = jsonb_set(jsonb_set(value, '{max_level}', '40'), '{points_per_level}', '2') where key = 'v2_level';
      update public.balance set value = jsonb_set(jsonb_set(value, '{cost_base}', '6'), '{cost_per_level}', '2') where key = 'card_level';
      update public.balance set value = jsonb_set(value, '{max_per_stat}', '12') where key = 'v2_stats';
    end if;
    mx := balance_num('v2_level', 'max_level')::int; ppl := balance_num('v2_level', 'points_per_level')::int; cap := balance_num('v2_stats', 'max_per_stat')::int;
    cb := balance_num('card_level', 'cost_base')::int; cpl := balance_num('card_level', 'cost_per_level')::int;
    for lv in -1 .. mx + 1 loop
      at0 := lv * cb + cpl * lv * (lv - 1) / 2; at1 := (lv + 1) * cb + cpl * (lv + 1) * lv / 2;
      foreach xv in array array[at0 - 1, at0, at1 - 1, at1, at0 + 100000] loop
        for pc in 0..3 loop
          pa := least(greatest(lv, 0) * ppl, cap); pd := least(greatest(lv, 0) * ppl - pa, cap);
          ph := case pc when 1 then 1 when 2 then 2 else 0 end; bo := case pc when 2 then 2 when 3 then 50 else 0 end;
          if pc = 3 then pa := cap + 1; pd := 0; end if;
          begin
            update public.card_progress_v2 set level = lv, xp = xv, atk_pts = pa, def_pts = pd, hp_pts = ph, bonus_points = bo where id = pid;
            ${into} := array_append(${into}, 'ok');
          exception when others then ${into} := array_append(${into}, 'ERR ' || sqlerrm);
          end;
        end loop;
      end loop;
    end loop;
  end loop;
  update public.balance set value = jsonb_set(jsonb_set(value, '{max_level}', '30'), '{points_per_level}', '1') where key = 'v2_level';
  update public.balance set value = jsonb_set(jsonb_set(value, '{cost_base}', '5'), '{cost_per_level}', '1') where key = 'card_level';
  update public.balance set value = jsonb_set(value, '{max_per_stat}', '10') where key = 'v2_stats';`;

// the old = new grid of card_combat_v2 (bonus 0): md5 of the answer, or the error text
const CC = (into6, into7, into8) => String.raw`
  for x in select v from jsonb_array_elements(inp) v loop
    begin h := md5(card_combat_v2(x->>0, (x->>1)::int, (x->>2)::numeric, (x->>3)::int, x->4, x->>5)::text); exception when others then h := 'ERR ' || sqlerrm; end;
    ${into6} := array_append(${into6}, h);
    begin h := md5(card_combat_v2(x->>0, (x->>1)::int, (x->>2)::numeric, (x->>3)::int, x->4, x->>5, nums)::text); exception when others then h := 'ERR ' || sqlerrm; end;
    ${into7} := array_append(${into7}, h);
    ${into8 ? String.raw`begin h := md5(card_combat_v2(x->>0, (x->>1)::int, (x->>2)::numeric, (x->>3)::int, x->4, x->>5, nums, 0)::text); exception when others then h := 'ERR ' || sqlerrm; end;
    ${into8} := array_append(${into8}, h);` : ''}
  end loop;`;

// ---------------------------------------------------------------------------------------------------------------- the inputs
const cfg0 = loadConfig();
const RARITIES = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold', 'promo', 'event'];
const LEVELS = [0, 1, 5, 10, 15, 22, 29, 30, 31, 45];
function ccInputs() {
  const out = [];
  for (const r of RARITIES) for (let s = -1; s <= 6; s++) for (const l of LEVELS) for (const role of ROLES) out.push([r, s, 1, l, buildFor(cfg0, role, l), role]);
  const rng = mkRng(5151); const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  for (let i = 0; i < 2000; i++) {
    const level = ri(0, 34); let left = Math.min(level, 30) + (rng() < 0.15 ? ri(1, 3) : 0); const pts = {};   // some above the level budget
    for (const s of STATS) { if (rng() < 0.55 && left > 0) { const n = Math.min(left, ri(0, 13)); if (n || rng() < 0.3) pts[s] = n; left -= n; } }
    out.push([RARITIES[ri(0, 6)], ri(0, 5), [1, 1, 0.8, 1.1, 1.333, null][ri(0, 5)], level, pts, ROLES[ri(0, 11)]]);
  }
  out.push(['mythic', 0, 1, 0, {}, 'breaker'], ['normal', 0, 1, 0, {}, 'paladin'], ['normal', 0, 1, 0, {}, null], ['normal', 0, 1, -1, {}, 'breaker'],
    ['normal', 0, 1, null, {}, 'breaker'], ['normal', 0, 1, 30, { luck: 1 }, 'breaker'], ['normal', 0, 1, 30, { atk: -1 }, 'breaker'], ['normal', 0, 1, 30, { atk: 1.5 }, 'breaker'],
    ['normal', 0, 1, 30, { atk: '3' }, 'breaker'], ['normal', 0, 1, 30, [3], 'breaker'], ['normal', 0, 1, 2, { atk: 3 }, 'breaker'], ['gold', 5, 1, 30, null, 'medic']);
  return out;
}
const INPUTS = ccInputs();

// ---------------------------------------------------------------------------------------------------------------- block 1
const body1 = String.raw`do $t$
declare res jsonb := '[]'; bad text[] := '{}'; o jsonb := '[]'; f text; ok boolean; md5_all_a jsonb; md5_all_b jsonb; md5_old jsonb; flag_a jsonb;
  callers_a text[]; callers_b text[]; on_a text[]; on_b text[]; nums jsonb; inp jsonb := ${sqlLit(INPUTS)}::jsonb; x jsonb; h text;
  o6 text[] := '{}'; o7 text[] := '{}'; n6 text[] := '{}'; n7 text[] := '{}'; n8 text[] := '{}'; so text[] := '{}'; sn text[] := '{}';
  v_p text; v_c bigint; pid bigint; bs int; lv int; xv int; pc int; mx int; ppl int; cap int; cb int; cpl int; at0 int; at1 int; pa int; pd int; ph int; bo int;
  b jsonb; t text; i int; n int;
  mine text[] := ${arr([...REPLACED, ...NEW])}; replaced text[] := ${arr(REPLACED)}; newf text[] := ${arr(NEW)};
begin
  ${BEFORE}
  -- the state before = main (the md5 of the 2 bodies that the file replaces)
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_old from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(replaced);
  res := res || jsonb_build_object('case', 'the state before the file = main: the md5 of card_combat_v2 (7 arguments) and card_progress_v2_check are those of db/schema on main', 'ok',
    md5_old = ${sqlLit(OLD_MD5)}::jsonb, 'got', md5_old);
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_all_a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and ${SIG} <> all (mine);
  select value into flag_a from public.balance where key = 'combat_v2';
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into callers_a from pg_proc p
   where p.pronamespace = 'public'::regnamespace and ${SIG} <> all (mine) and p.prosrc ~ '(card_combat_v2|card_progress_v2_check)\s*\(';
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into on_a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(';
  nums := ${NUMS6};

  -- the old answers: card_combat_v2 on the grid, and the M1a trigger on the sweep
  ${CC('o6', 'o7', null)}
  select p.id into v_p from public.players p where exists (select 1 from public.player_cards pc where pc.player_id = p.id) order by p.id limit 1;
  select c.id into v_c from public.cards c where not exists (select 1 from public.player_cards pc where pc.player_id = v_p and pc.card_id = c.id) order by c.id limit 1;
  if v_p is null or v_c is null then raise exception 'the sample: no player or no free card'; end if;
  res := res || jsonb_build_object('case', 'T1 both progress tables are empty before the sample row', 'ok',
    (select count(*) from public.card_progress_v2) = 0 and (select count(*) from public.card_progress_v2_log) = 0);
  insert into public.player_cards (player_id, card_id, quantity, first_source) values (v_p, v_c, 1, 'admin');
  insert into public.card_progress_v2 (player_id, card_id) values (v_p, v_c) returning id into pid;
  ${SWEEP('so')}

  execute $m$${mig}$m$;

  -- T1. no other change
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_all_b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p') and ${SIG} <> all (mine);
  res := res || jsonb_build_object('case', format('T1 the md5 of the %s other public functions does not change (no other function added, changed or gone)', (select count(*) from jsonb_object_keys(md5_all_a))),
    'ok', md5_all_a = md5_all_b,
    'changed', (select jsonb_agg(x2.key) from jsonb_each_text(md5_all_b) x2 where md5_all_a->>x2.key is distinct from x2.value),
    'gone', (select jsonb_agg(x2.key) from jsonb_each_text(md5_all_a) x2 where not md5_all_b ? x2.key));
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into bad from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(newf);
  res := res || jsonb_build_object('case', 'T1 exactly the 7 new functions are added', 'ok', bad @> newf and newf @> bad and cardinality(bad) = cardinality(newf), 'got', bad);
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into bad from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(replaced) and ${MD5} <> md5_old->>(${SIG});
  res := res || jsonb_build_object('case', 'T1 exactly card_combat_v2 (7 arguments) and card_progress_v2_check are replaced (their md5 changes)', 'ok', cardinality(bad) = 2, 'got', bad);
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into callers_b from pg_proc p
   where p.pronamespace = 'public'::regnamespace and ${SIG} <> all (mine) and p.prosrc ~ '(card_combat_v2|card_progress_v2_check)\s*\(';
  res := res || jsonb_build_object('case', 'T1 the callers of card_combat_v2 and of the trigger do not change (no v1 caller)', 'ok', callers_a = callers_b, 'now', callers_b);
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and ${SIG} <> all (mine) and p.prosrc ~ 'card_level_(xp_at|of_xp|xp_award)\s*\(';
  res := res || jsonb_build_object('case', 'T1 no other function calls a new card_level function', 'ok', cardinality(bad) = 0, 'callers', bad);
  select coalesce(array_agg(${SIG} order by ${SIG}), '{}') into on_b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(';
  res := res || jsonb_build_object('case', 'T1 the readers of combat_v2_on do not change', 'ok', on_a = on_b, 'now', on_b);
  res := res || jsonb_build_object('case', 'T1 the flag combat_v2 does not change (progress stays false)', 'ok',
    (select value from public.balance where key = 'combat_v2') = flag_a and flag_a->'progress' = 'false'::jsonb);
  res := res || jsonb_build_object('case', 'T1 the trigger has one XP formula: it calls card_level_xp_at and names no card_level number', 'ok',
    (select prosrc ~ 'card_level_xp_at\(new\.level\)' and prosrc !~ 'card_level''|cost_base|cost_per_level' from pg_proc where oid = 'public.card_progress_v2_check()'::regprocedure));

  -- old = new: card_combat_v2
  ${CC('n6', 'n7', 'n8')}
  select count(*) into n from generate_subscripts(o7, 1) k where o6[k] is distinct from n6[k] or o7[k] is distinct from n7[k] or o7[k] is distinct from n8[k];
  select coalesce(jsonb_agg(jsonb_build_object('in', inp->(k - 1), 'old', o7[k], 'new7', n7[k], 'new8', n8[k])), '[]') into o from
    (select k from generate_subscripts(o7, 1) k where o6[k] is distinct from n6[k] or o7[k] is distinct from n7[k] or o7[k] is distinct from n8[k] limit 3) z;
  res := res || jsonb_build_object('case', format('old = new: card_combat_v2 with 6 and 7 arguments and the new form with bonus 0 give the E3 answer or error text on %s inputs (%s refused)',
    cardinality(o7), (select count(*) from unnest(o7) z where z like 'ERR %')), 'ok', n = 0 and cardinality(o7) = jsonb_array_length(inp) and cardinality(n8) = cardinality(o7), 'first', o);

  -- old = new: the trigger
  ${SWEEP('sn')}
  select count(*) into n from generate_subscripts(so, 1) k where left(so[k], 2) is distinct from left(sn[k], 2);
  select coalesce(jsonb_agg(jsonb_build_object('k', k, 'old', so[k], 'new', sn[k])), '[]') into o from
    (select k from generate_subscripts(so, 1) k where left(so[k], 2) is distinct from left(sn[k], 2) limit 3) z;
  res := res || jsonb_build_object('case', format('old = new: the trigger accepts and refuses the same rows as the M1a body (%s updates: %s accepted; levels -1 to max + 1 x 5 XP boundaries x 4 point layouts, today and with cost 6 + 2L, max 40, 2 a level, 12 a stat)',
    cardinality(so), (select count(*) from unnest(so) z where z = 'ok')), 'ok', n = 0 and cardinality(so) = cardinality(sn) and cardinality(so) > 1000, 'first', o);
  select count(*) into n from generate_subscripts(so, 1) k where regexp_replace(so[k], '\.0+\y', '', 'g') is distinct from sn[k];
  select coalesce(jsonb_agg(jsonb_build_object('old', so[k], 'new', sn[k])), '[]') into o from
    (select k from generate_subscripts(so, 1) k where regexp_replace(so[k], '\.0+\y', '', 'g') is distinct from sn[k] limit 3) z;
  res := res || jsonb_build_object('case', format('the trigger error texts are the M1a texts with whole numbers (%s M1a texts had decimals like 18.0000000000000000)',
    (select count(*) from unnest(so) z where z ~ '\.0{4}')), 'ok', n = 0 and not exists (select 1 from unnest(sn) z where z ~ '\d\.\d'), 'first', o);

  -- the fixed cases (the script compares them with the hand values and the simulator)
  select jsonb_agg(card_level_xp_at(k) order by u.ord) into o from unnest(array[0, 1, 2, 3, 10, 29, 30]) with ordinality u(k, ord);
  res := res || jsonb_build_object('case', 'XPAT', 'ok', true, 'got', o);
  select jsonb_agg(card_level_of_xp(k) order by u.ord) into o from unnest(array[0, 4, 5, 10, 11, 17, 18, 584, 585, 99999]) with ordinality u(k, ord);
  res := res || jsonb_build_object('case', 'LEVELOF', 'ok', true, 'got', o);
  res := res || jsonb_build_object('case', 'AWARD', 'ok', true, 'got', jsonb_build_array(
    card_level_xp_award('hunt', 5, array[5, 5, 5]), card_level_xp_award('hunt', 4, array[5, 5, 5, 4]), card_level_xp_award('dungeon', 0, '{}'),
    card_level_xp_award('hunt', 19, array[20, 20, 20, 20, 20, 20, 20, 20] || array_fill(0, array[20])), card_level_xp_award('dungeon', 30, array[30, 2])));
  b := combat_v2_numbers(array['card_level', 'v2_level']);
  res := res || jsonb_build_object('case', 'PURE', 'ok', true, 'nums', b, 'got', jsonb_build_array(
    card_level_xp_at(3, jsonb_set(jsonb_set(b, '{card_level,cost_base}', '6'), '{card_level,cost_per_level}', '2')),
    card_level_xp_at(4, jsonb_set(jsonb_set(b, '{card_level,cost_base}', '6'), '{card_level,cost_per_level}', '2')),
    card_level_of_xp(35, jsonb_set(jsonb_set(b, '{card_level,cost_base}', '6'), '{card_level,cost_per_level}', '2')),
    card_level_xp_at(40, jsonb_set(b, '{v2_level,max_level}', '40')),
    card_level_xp_award('hunt', 1, array[5, 1], jsonb_set(b, '{card_level,catchup_x}', '1.25')),
    card_level_xp_award('hunt', 1, array[5, 1], jsonb_set(b, '{card_level,catchup_x}', '1.5')),
    card_level_xp_award('hunt', 7, array[9, 7, 1], jsonb_set(b, '{card_level,catchup_top}', '2')),
    card_level_xp_award('hunt', 8, array[9, 7, 1], jsonb_set(b, '{card_level,catchup_top}', '2')),
    card_level_xp_award('hunt', 9, array[9, 9], jsonb_set(jsonb_set(b, '{card_level,xp_hunt_day}', '7'), '{card_level,xp_dungeon_run}', '12')),
    card_level_xp_award('dungeon', 9, array[9, 9], jsonb_set(jsonb_set(b, '{card_level,xp_hunt_day}', '7'), '{card_level,xp_dungeon_run}', '12'))));

  -- the refusals, each with its text (a missing number never passes: fails closed)
  o := '[]';
  for x in select v from jsonb_array_elements(${sqlLit([
    ['xp_at level -1', "select card_level_xp_at(-1)", 'card_level_xp_at: the level must be 0 or more'],
    ['xp_at level null', "select card_level_xp_at(null::int)", 'card_level_xp_at: the level must be 0 or more'],
    ['xp_at level 31', "select card_level_xp_at(31)", 'card_level_xp_at: level 31 is above v2_level.max_level 30'],
    ['xp_at a fraction cost', "select card_level_xp_at(3, jsonb_set(combat_v2_numbers(array['card_level', 'v2_level']), '{card_level,cost_base}', '5.5'))", 'the card_level costs must be whole numbers'],
    ['xp_at no numbers', "select card_level_xp_at(3, '{}'::jsonb)", 'card_level_xp_at: no balance value for card_level.cost_base'],
    ['xp_at no cost_base', "select card_level_xp_at(3, combat_v2_numbers(array['card_level', 'v2_level']) #- '{card_level,cost_base}')", 'card_level_xp_at: no balance value'],
    ['xp_at cost_per_level JSON null', "select card_level_xp_at(3, jsonb_set(combat_v2_numbers(array['card_level', 'v2_level']), '{card_level,cost_per_level}', 'null'))", 'card_level_xp_at: no balance value'],
    ['xp_at no v2_level', "select card_level_xp_at(3, combat_v2_numbers(array['card_level']))", 'card_level_xp_at: no balance value'],
    ['of_xp -1', "select card_level_of_xp(-1)", 'card_level_of_xp: the XP must be 0 or more'],
    ['of_xp null', "select card_level_of_xp(null::int)", 'card_level_of_xp: the XP must be 0 or more'],
    ['of_xp no max_level', "select card_level_of_xp(50, combat_v2_numbers(array['card_level']))", 'card_level_of_xp: no balance value for v2_level.max_level'],
    ['of_xp no card_level', "select card_level_of_xp(50, combat_v2_numbers(array['v2_level']))", 'card_level_xp_at: no balance value'],
    ['award gauntlet', "select card_level_xp_award('gauntlet', 0, '{}')", 'the source must be hunt or dungeon'],
    ['award no source', "select card_level_xp_award(null, 0, '{}')", 'the source must be hunt or dungeon'],
    ['award level -1', "select card_level_xp_award('hunt', -1, '{}')", 'card_level_xp_award: the level must be 0 or more'],
    ['award no list', "select card_level_xp_award('hunt', 1, null)", 'the levels of the player must be a list of levels of 0 or more'],
    ['award a null level in the list', "select card_level_xp_award('hunt', 1, array[3, null])", 'the levels of the player must be a list of levels of 0 or more'],
    ['award a level -1 in the list', "select card_level_xp_award('hunt', 1, array[3, -1])", 'the levels of the player must be a list of levels of 0 or more'],
    ['award no catchup_x', "select card_level_xp_award('hunt', 1, array[5], combat_v2_numbers(array['card_level']) #- '{card_level,catchup_x}')", 'card_level_xp_award: no balance value'],
    ['award xp_dungeon_run JSON null', "select card_level_xp_award('dungeon', 1, array[5], jsonb_set(combat_v2_numbers(array['card_level']), '{card_level,xp_dungeon_run}', 'null'))", 'card_level_xp_award: no balance value'],
    ['award no catchup_top', "select card_level_xp_award('hunt', 1, array[5], combat_v2_numbers(array['card_level']) #- '{card_level,catchup_top}')", 'card_level_xp_award: no balance value'],
    ['card_combat_v2 bonus -1', `select card_combat_v2('normal', 0, 1, 3, '{}', 'striker', ${NUMS6}, -1)`, 'card_combat_v2: the bonus points must be 0 or more'],
    ['card_combat_v2 bonus null', `select card_combat_v2('normal', 0, 1, 3, '{}', 'striker', ${NUMS6}, null)`, 'card_combat_v2: the bonus points must be 0 or more'],
    ['card_combat_v2 6 points at level 3 + bonus 2', `select card_combat_v2('normal', 0, 1, 3, '{"atk": 6}', 'striker', ${NUMS6}, 2)`, 'card_combat_v2: 6 points spent, the level 3 gives 3 and the bonus is 2'],
    ['card_combat_v2 4 points at level 3 + bonus 0 (the E3 text)', `select card_combat_v2('normal', 0, 1, 3, '{"atk": 4}', 'striker', ${NUMS6}, 0)`, 'card_combat_v2: 4 points spent, the level 3 gives 3'],
    ['card_combat_v2 34 points at level 45 (clamped 30) + bonus 3', `select card_combat_v2('gold', 5, 1, 45, '{"atk": 10, "hp": 10, "spd": 10, "abl": 4}', 'medic', ${NUMS6}, 3)`, '34 points spent, the level 45 gives 30 and the bonus is 3'],
  ].map(([n, q, m]) => ({ n, q, m })))}::jsonb) v loop
    begin
      execute x->>'q';
      o := o || to_jsonb('accepted: ' || (x->>'n'));
    exception when others then
      if position(x->>'m' in sqlerrm) = 0 then o := o || to_jsonb('refused for another reason: ' || (x->>'n') || ': ' || sqlerrm); end if;
    end;
  end loop;
  res := res || jsonb_build_object('case', 'the refusals: 26 bad inputs and missing numbers refused, each with its own text (a missing balance number fails closed)', 'ok', o = '[]'::jsonb, 'got', o);

  -- the balance row card_level cannot go and cannot lose a number (the balance guard and balance_check refuse), so the STABLE forms and the
  -- trigger always read a full row; a missing number is refused by the pure forms (the refusals above). Each attempt is undone.
  o := '[]';
  foreach t in array array['delete from public.balance where key = ''card_level''',
                           'update public.balance set value = value - ''cost_base'' where key = ''card_level''',
                           'update public.balance set value = jsonb_set(value, ''{cost_per_level}'', ''null'') where key = ''card_level''',
                           'update public.balance set value = value - ''max_level'' where key = ''v2_level'''] loop
    begin
      execute t;
      o := o || to_jsonb('accepted: ' || t);
      raise exception 'UNDO';
    exception when others then if sqlerrm = 'UNDO' then null; end if;
    end;
  end loop;
  res := res || jsonb_build_object('case', 'the balance row card_level cannot be deleted and card_level / v2_level cannot lose a number (the balance guard refuses 4 tries), so a STABLE form never reads a null', 'ok', o = '[]'::jsonb, 'got', o);

  -- the budget with bonus points (card_combat_v2 and the trigger)
  res := res || jsonb_build_object('case', 'card_combat_v2 with bonus: level 3 + bonus 2 takes 5 points (free 0), 4 points (free 1); level 0 + bonus 7 takes 7; level 45 + bonus 3 takes 33; the stats do not change with the bonus', 'ok',
    (card_combat_v2('normal', 0, 1, 3, '{"atk": 5}', 'striker', nums, 2)->>'points_free')::numeric = 0
    and (card_combat_v2('normal', 0, 1, 3, '{"atk": 4}', 'striker', nums, 2)->>'points_free')::numeric = 1
    and (card_combat_v2('normal', 0, 1, 0, '{"atk": 7}', 'striker', nums, 7)->>'points_free')::numeric = 0
    and (card_combat_v2('gold', 5, 1, 45, '{"atk": 10, "hp": 10, "spd": 10, "abl": 3}', 'medic', nums, 3)->>'points_free')::numeric = 0
    and card_combat_v2('gold', 2, 1.04, 12, '{"atk": 3, "crt": 2}', 'flurry', nums, 6) - 'points_free'
        = card_combat_v2('gold', 2, 1.04, 12, '{"atk": 3, "crt": 2}', 'flurry', nums) - 'points_free'
    and (card_combat_v2('gold', 2, 1.04, 12, '{"atk": 3, "crt": 2}', 'flurry', nums, 6)->>'points_free')::numeric = 13);
  bad := '{}';
  begin update public.card_progress_v2 set level = 3, xp = 18, atk_pts = 3, def_pts = 0, hp_pts = 2, bonus_points = 2 where id = pid;
  exception when others then bad := bad || ('level 3 + bonus 2 with 5 points refused: ' || sqlerrm); end;
  begin update public.card_progress_v2 set hp_pts = 3 where id = pid; bad := bad || 'level 3 + bonus 2 with 6 points accepted'::text;
  exception when others then null; end;
  begin update public.card_progress_v2 set xp = 17, hp_pts = 0 where id = pid; bad := bad || 'level 3 at 17 XP accepted'::text;
  exception when others then if position('17 XP is not level 3 (card_level: level 3 needs 18 to 25 XP)' in sqlerrm) = 0 then bad := bad || ('another text: ' || sqlerrm); end if; end;
  res := res || jsonb_build_object('case', 'the trigger: level 3 + bonus 2 takes 5 points, not 6; 17 XP is refused with "level 3 needs 18 to 25 XP" (whole numbers)', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- pure and server only
  select jsonb_object_agg(${SIG}, p.provolatile::text) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine);
  res := res || jsonb_build_object('case', 'volatility: the 3 pure forms IMMUTABLE; the balance forms and both card_combat_v2 STABLE; the trigger VOLATILE', 'ok',
    o = (select jsonb_object_agg(z, case when z = any(${arr(PURE)}) then 'i' when z = 'card_progress_v2_check()' then 'v' else 's' end) from unnest(mine) z), 'got', o);
  select coalesce(jsonb_agg(${SIG}), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine)
     and not coalesce('search_path=public' = any(p.proconfig), false);
  res := res || jsonb_build_object('case', 'search_path = public on the 9 functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(${SIG} || ' ' || r2), '[]') into o from pg_proc p cross join unnest(array['anon', 'authenticated', 'public']) r2
   where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine)
     and (case when r2 = 'public' then exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
          else has_function_privilege(r2, p.oid, 'execute') end);
  res := res || jsonb_build_object('case', 'server only: anon, authenticated and public cannot run the 9 functions; service_role can', 'ok', o = '[]'::jsonb
    and (select bool_and(has_function_privilege('service_role', p.oid, 'execute')) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine)), 'got', o);
  select coalesce(jsonb_agg(${SIG}), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine) and coalesce(obj_description(p.oid, 'pg_proc'), '') = '';
  res := res || jsonb_build_object('case', 'a comment on each of the 9 functions', 'ok', o = '[]'::jsonb, 'got', o);

  -- the file runs twice
  select jsonb_object_agg(${SIG}, ${MD5}) into md5_old from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine);
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: the file runs a second time and changes no function', 'ok',
    md5_old = (select jsonb_object_agg(${SIG}, ${MD5}) from pg_proc p where p.pronamespace = 'public'::regnamespace and ${SIG} = any(mine)));
  res := res || jsonb_build_object('case', 'NUMBERS', 'ok', true, 'b', ${NUMS6} || combat_v2_numbers(array['card_level']));
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- block 2: SQL = the simulator (fuzz)
const body2 = (pureCases, cards) => String.raw`do $t$
declare f text; x jsonb; out jsonb := '[]'; c jsonb; nums jsonb; b jsonb;
begin
  ${BEFORE}
  execute $m$${mig}$m$;
  for x in select v from jsonb_array_elements(${sqlLit(pureCases)}::jsonb) v loop
    b := x->'n';
    out := out || jsonb_build_array(jsonb_build_array(card_level_xp_at((x->>'l')::int, b), card_level_of_xp((x->>'xp')::int, b),
      card_level_xp_award(x->>'src', (x->>'lv')::int, array(select jsonb_array_elements_text(x->'ls')::int), b)));
  end loop;
  nums := ${NUMS6};
  for x in select v from jsonb_array_elements(${sqlLit(cards)}::jsonb) v loop
    begin
      c := card_combat_v2(x->>0, (x->>1)::int, (x->>2)::numeric, (x->>3)::int, x->4, x->>5, nums, (x->>6)::int);
      out := out || jsonb_build_array(jsonb_build_array(c->'points_free', c->'cp_base', c->'stats'->'atk', c->'stats'->'hp', c->'stats'->'abl', c->'spd_x', c->'power'));
    exception when others then out := out || to_jsonb('ERR ' || sqlerrm);
    end;
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`;

let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const near = (a, b) => Math.abs(Number(a) - b) <= 1e-9 * Math.max(1, Math.abs(b));
try {
  const results = JSON.parse(await runBlock(body1));
  const B = results.find((r) => r.case === 'NUMBERS').b;
  const cfg = patch(loadConfig(), B);
  const get = (n) => results.find((r) => r.case === n);
  for (const r of results.filter((x) => !['NUMBERS', 'XPAT', 'LEVELOF', 'AWARD', 'PURE'].includes(x.case))) {
    const { case: name, ok, ...rest } = r;
    say(ok, name, JSON.stringify(rest).slice(0, 900));
  }
  // the fixed cases: the hand values (5 + L: 0, 5, 11, 18, 95, 551, 585) and the simulator with the numbers of the database
  const xa = get('XPAT').got; const L1 = [0, 1, 2, 3, 10, 29, 30];
  say(JSON.stringify(xa) === '[0,5,11,18,95,551,585]' && xa.every((v, i) => v === F.xpAt(cfg, L1[i])), 'the XP of levels 0, 1, 2, 3, 10, 29, 30 = 0, 5, 11, 18, 95, 551, 585 (5 + L a level), as the simulator', JSON.stringify(xa));
  const lo = get('LEVELOF').got; const X1 = [0, 4, 5, 10, 11, 17, 18, 584, 585, 99999];
  say(JSON.stringify(lo) === '[0,0,1,1,2,2,3,29,30,30]' && lo.every((v, i) => v === F.levelOfXp(cfg, X1[i])), 'the level of XP 0, 4, 5, 10, 11, 17, 18, 584, 585, 99999 = 0, 0, 1, 1, 2, 2, 3, 29, 30, 30 (each boundary), as the simulator', JSON.stringify(lo));
  const aw = get('AWARD').got;
  const awSim = [F.xpAward(cfg, 'hunt', 5, [5, 5, 5]), F.xpAward(cfg, 'hunt', 4, [5, 5, 5, 4]), F.xpAward(cfg, 'dungeon', 0, []), F.xpAward(cfg, 'hunt', 19, [...Array(8).fill(20), ...Array(20).fill(0)]), F.xpAward(cfg, 'dungeon', 30, [30, 2])];
  say(JSON.stringify(aw) === '[10,20,10,20,10]' && JSON.stringify(aw) === JSON.stringify(awSim),
    'the award: at the top-8 mean 10; below it (4 < 4.75) 20; no cards 10; below the mean of the top 8 (not of all 28) 20; the top card 10; as the simulator', `${JSON.stringify(aw)} simulator ${JSON.stringify(awSim)}`);
  const pu = get('PURE'); const nb = pu.nums; const c2 = (p) => patch(cfg, p);
  const puSim = [F.xpAt(c2({ card_level: { cost_base: 6, cost_per_level: 2 } }), 3), F.xpAt(c2({ card_level: { cost_base: 6, cost_per_level: 2 } }), 4),
    F.levelOfXp(c2({ card_level: { cost_base: 6, cost_per_level: 2 } }), 35), F.xpAt(c2({ v2_level: { max_level: 40 } }), 40),
    F.xpAward(c2({ card_level: { catchup_x: 1.25 } }), 'hunt', 1, [5, 1]), F.xpAward(c2({ card_level: { catchup_x: 1.5 } }), 'hunt', 1, [5, 1]),
    F.xpAward(c2({ card_level: { catchup_top: 2 } }), 'hunt', 7, [9, 7, 1]), F.xpAward(c2({ card_level: { catchup_top: 2 } }), 'hunt', 8, [9, 7, 1]),
    F.xpAward(c2({ card_level: { xp_hunt_day: 7, xp_dungeon_run: 12 } }), 'hunt', 9, [9, 9]), F.xpAward(c2({ card_level: { xp_hunt_day: 7, xp_dungeon_run: 12 } }), 'dungeon', 9, [9, 9])];
  say(nb.card_level.cost_base === 5 && JSON.stringify(pu.got) === '[24,36,3,980,12,15,20,10,7,12]' && JSON.stringify(pu.got) === JSON.stringify(puSim),
    'the pure forms with other numbers: cost 6 + 2L: level 3 = 24, level 4 = 36, 35 XP = level 3; max 40: level 40 = 980; catch-up x1.25 = 12 (rounded down), x1.5 = 15; top 2: level 7 < 8 gets 20, level 8 = the mean gets 10; Hunt 7, Dungeon 12; as the simulator',
    `${JSON.stringify(pu.got)} simulator ${JSON.stringify(puSim)}`);

  // SQL = the simulator on random balance sets (within the limits of balance_v2_spec) and random cards with bonus points
  const rng = mkRng(9090); const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pureCases = [];
  for (let i = 0; i < 2000; i++) {
    const n = { card_level: { cost_base: ri(1, 100), cost_per_level: ri(0, 20), xp_hunt_day: ri(0, 100), xp_dungeon_run: ri(0, 100), catchup_x: ri(100, 500) / 100, catchup_top: ri(1, 20) },
      v2_level: { max_level: ri(1, 100) } };
    const cn = patch(cfg, n); const mx = n.v2_level.max_level;
    const l = ri(0, mx); const xp = rng() < 0.4 ? Math.max(0, F.xpAt(cn, ri(0, mx)) - ri(0, 1)) : ri(0, F.xpAt(cn, mx) + 50);
    const ls = Array.from({ length: ri(0, 25) }, () => ri(0, mx));
    pureCases.push({ n, l, xp, src: rng() < 0.5 ? 'hunt' : 'dungeon', lv: rng() < 0.3 && ls.length ? ls[ri(0, ls.length - 1)] : ri(0, mx), ls });
  }
  const cards = [];
  for (let i = 0; i < 1500; i++) {
    const level = ri(0, 34), bonus = rng() < 0.2 ? 0 : ri(0, 15); let left = Math.min(level, 30) + bonus + (rng() < 0.2 ? ri(1, 3) : 0); const pts = {};
    for (const s of STATS) { if (rng() < 0.6 && left > 0) { const k = Math.min(left, ri(0, 13)); if (k || rng() < 0.3) pts[s] = k; left -= k; } }
    cards.push([RARITIES[ri(0, 6)], ri(0, 5), [1, 0.92, 1.06, 1.25][ri(0, 3)], level, pts, ROLES[ri(0, 11)], bonus]);
  }
  const rows = JSON.parse(await runBlock(body2(pureCases, cards)));
  let badPure = 0, firstPure = [];
  pureCases.forEach((c, i) => {
    const cn = patch(cfg, c.n); const want = [F.xpAt(cn, c.l), F.levelOfXp(cn, c.xp), F.xpAward(cn, c.src, c.lv, c.ls)];
    if (JSON.stringify(rows[i]) !== JSON.stringify(want)) { badPure++; if (firstPure.length < 3) firstPure.push(`${JSON.stringify(c).slice(0, 300)} SQL ${JSON.stringify(rows[i])} simulator ${JSON.stringify(want)}`); }
  });
  const nCatch = pureCases.filter((c) => { const cn = patch(cfg, c.n); return F.xpAward(cn, c.src, c.lv, c.ls) !== (c.src === 'hunt' ? c.n.card_level.xp_hunt_day : c.n.card_level.xp_dungeon_run); }).length;
  say(badPure === 0 && rows.length === pureCases.length + cards.length,
    `SQL = the simulator on ${pureCases.length} random balance sets (cost_base 1-100, cost_per_level 0-20, max_level 1-100, catchup_x 1.00-5.00, catchup_top 1-20): the XP of a level, the level of an XP and the award are equal (${nCatch} awards with catch-up)`,
    `${badPure} differ: ${firstPure.join(' | ')}`);
  let badCard = 0, firstCard = [], nRef = 0, nBonusUsed = 0;
  cards.forEach((c, j) => {
    const got = rows[pureCases.length + j]; let want;
    try {
      const k = makeCard(cfg, { key: 'fuzz', role: c[5], rarity: c[0], stars: c[1], cp_mod: c[2], level: c[3], points: c[4], bonus: c[6] });
      const used = Object.values(c[4]).reduce((s, v) => s + v, 0);
      if (used > F.levelPoints(cfg, c[3])) nBonusUsed++;
      want = [F.pointBudget(cfg, c[3], c[6]) - used, k.cpBase, k.cp, k.maxHp, k.abl, k.spdMult, k.power];
    } catch { want = 'ERR'; nRef++; }
    const ok = want === 'ERR' ? typeof got === 'string' && got.startsWith('ERR ') && /points spent, the level/.test(got)
      : Array.isArray(got) && want.every((v, i) => near(got[i], v));
    if (!ok) { badCard++; if (firstCard.length < 3) firstCard.push(`${JSON.stringify(c)} SQL ${JSON.stringify(got)} simulator ${JSON.stringify(want)}`); }
  });
  say(badCard === 0, `SQL = the simulator (makeCard with bonus) on ${cards.length} random cards with bonus 0 to 15: the same refusals (${nRef} over the budget), points_free, cp_base, atk, hp, abl, spd_x and power (${nBonusUsed} accepted cards use bonus points)`,
    `${badCard} differ: ${firstCard.join(' | ')}`);
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (the file did not apply?): ${String(e.message).slice(0, 900)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
