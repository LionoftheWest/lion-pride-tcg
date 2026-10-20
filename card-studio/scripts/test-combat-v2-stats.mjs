import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_stats.sql (combat v2 phase 2, PR E3: the 9 stats, ASC-3, the level points, the catch-up dial D,
 * the support factor and the role passive lookup; plan sections 2.1 to 2.4). NO lasting change: every request is one DO block, undone by its final
 * RAISE. combat_v2_flags_balance.sql (V1), combat_v2_statuses_roles.sql (E1), combat_v2_turn_meter.sql (E2) and this file run inside each block (all
 * idempotent), so the test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-stats.mjs     must PASS
 *   MUTATE=<name> ...                                                                         must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                            the baseline (must PASS), then every mutation, one line each
 * The reference is the simulator card-studio/v2sim (formulas.mjs F.ascCp, F.converge, F.levelPoints, F.stats, F.supportPower; cards.mjs makeCard and
 * buildFor), with the numbers of the database (the balance values replace the config.json values).
 * Invariants:
 *   1. The simulator formula checks, ported (checks.mjs formulaChecks: asc.*, stat.*, converge.off, converge.full, level.points).
 *   2. SQL = the simulator on a GRID: every rarity (7, with the aliases promo and event) x stars -1 to 6 (-1 and 6 are clamped) x 10 levels (0 to 45; above 30
 *      is clamped) x the 12 roles x 3 cp_mod values, with the simulator point build of the role and the level (17,640 cards), and 3,000 random cards
 *      with random points (some above the 10-point cap). Every number of the stat line (cp_asc, cp_base, the 9 stats, spd_x, the support factor, the
 *      extra stack, the class, the capped points, the free points) is equal within a relative 1e-9 (SQL numeric is exact; the simulator uses float).
 *   3. The role lookup: for each of the 12 roles the class, label, passive text, passive numbers (balance v2_roles.<key>) and base speed.
 *   4. The refusals: an unknown rarity or role, a negative level, an unknown stat, max_per_stat as a stat, points -1, 1.5 and a string, more points
 *      than the level gives.
 *   5. v1 is not changed: the md5 of both card_combat functions (and card_cp_exact, card_max_hp) is the same before and after the file.
 *   6. Pure and server only: combat_v2_stats IMMUTABLE, card_combat_v2 STABLE, anon and authenticated cannot run them, every function has a comment.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { F } from '../v2sim/formulas.mjs';
import { makeCard, buildFor, ROLES, STATS } from '../v2sim/cards.mjs';
import { loadConfig, patch, mkRng } from '../v2sim/util.mjs';
assertLocal('test-combat-v2-stats.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const V1 = read('combat_v2_flags_balance.sql');
const E1 = read('combat_v2_statuses_roles.sql');
const E2 = read('combat_v2_turn_meter.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_stats.sql');

const MUT = {
  asc_off_by_one: ["(a->'curve'->>s)::numeric", "(a->'curve'->>least(s + 1, 5))::numeric"],
  atk_flat_4: ["p_cp_base + (st->'atk'->>'flat')::numeric * (p->>'atk')::numeric", "p_cp_base + 4 * (p->>'atk')::numeric"],
  hp_flat_off: ["+ (st->'hp'->>'flat')::numeric * (p->>'hp')::numeric", ''],
  hp_per_cp_asc: ['o := combat_v2_stats(cp_base, p_pts, p_role, p_b);', 'o := combat_v2_stats(cp_asc, p_pts, p_role, p_b);'],
  dial_off: ["cp_base := cp_asc + (lv->>'converge_d')::numeric * lvl", "cp_base := cp_asc + 0 * lvl"],
  dial_level_unclamped: ["lvl := least(p_level, (lv->>'max_level')::int);", 'lvl := p_level;'],
  def_uncapped: ["'def', least((st->'def'->>'cap')::numeric, (st->'def'->>'pct')::numeric * (p->>'def')::numeric),", "'def', (st->'def'->>'pct')::numeric * (p->>'def')::numeric,"],
  crt_uncapped: ["'crt', least((st->'crt'->>'cap')::numeric, (st->'crt'->>'base')::numeric + (st->'crt'->>'pct')::numeric * (p->>'crt')::numeric),",
                 "'crt', (st->'crt'->>'base')::numeric + (st->'crt'->>'pct')::numeric * (p->>'crt')::numeric,"],
  ddg_uncapped: ["'ddg', least((st->'ddg'->>'cap')::numeric, (st->'ddg'->>'pct')::numeric * (p->>'ddg')::numeric),", "'ddg', (st->'ddg'->>'pct')::numeric * (p->>'ddg')::numeric,"],
  crd_no_base: ["'crd', (st->'crd'->>'base')::numeric + ", "'crd', "],
  abl_double: ["'abl', 1 + (st->'abl'->>'pct')::numeric", "'abl', 1 + 2 * (st->'abl'->>'pct')::numeric"],
  acc_off: ["'acc', (st->'acc'->>'pct')::numeric * (p->>'acc')::numeric,", "'acc', 0,"],
  point_cap_off: ['least(coalesce((pts->>k)::numeric, 0), mx)', 'coalesce((pts->>k)::numeric, 0)'],
  overspend_ok: ['if spent > lpts then raise', 'if false then raise'],
  power_for_attackers: ["case when ro.class = 'support' then power(", 'case when true then power('],
  power_exp_double: ["(su->>'power_exp')::numeric)", "(su->>'power_exp')::numeric * 2)"],
  alias_off: ["r := coalesce(a->'alias'->>p_rarity, p_rarity);", 'r := p_rarity;'],
  extra_stack_off: ["case when su->'enabler_extra_stack' ? p_rarity then 1 else 0 end", '0'],
  spd_points_ignored: ["combat_v2_speed(jsonb_build_object('role', p_role, 'spd', (p->>'spd')::numeric), 0, p_b)", "combat_v2_speed(jsonb_build_object('role', p_role), 0, p_b)"],
  class_fixed: ["'role', ro.key, 'class', ro.class,", "'role', ro.key, 'class', 'attacker',"],
  stars_unclamped: ["s := greatest(0, least(coalesce(p_stars, 0), jsonb_array_length(a->'curve') - 1));", "s := least(coalesce(p_stars, 0), jsonb_array_length(a->'curve') - 1);"],
  mod_ignored: ["(a->'curve'->>s)::numeric) * coalesce(p_mod, 1);", "(a->'curve'->>s)::numeric);"],
  unknown_stat_ok: ["if not st ? k or k = 'max_per_stat' then raise", 'if false then raise'],
  negative_level_ok: ['if p_level is null or p_level < 0 then raise', 'if p_level is null then raise'],
  passive_numbers: ["'numbers', balance_path(ro.numbers)", "'numbers', balance_path('v2_roles.breaker')"],
  v1_touched: ['-- ============================================================ 3. server only',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::int  $fn$;\n-- ============================================================ 3. server only"],
  volatile: ["returns jsonb\nlanguage plpgsql immutable set search_path = public as $fn$\ndeclare\n  st jsonb", "returns jsonb\nlanguage plpgsql volatile set search_path = public as $fn$\ndeclare\n  st jsonb"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.combat_v2_stats\(numeric, jsonb, text, jsonb\) is \$cm\$[^\n]*\n/, ''],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)       ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
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
  const n = !m ? 0 : m[0] instanceof RegExp ? (mig.match(new RegExp(m[0].source, 'g')) || []).length : mig.split(m[0]).length - 1;
  if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once`);
  mig = m[0] instanceof RegExp ? mig.replace(m[0], m[1]) : mig.split(m[0]).join(m[1]);
}
for (const t of [V1, E1, E2, mig]) if (['$m$', '$t$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$ or $t$');

const SETUP = String.raw`
  perform set_config('balance.by', 'test', true);
  execute $m$${V1}$m$;
  execute $m$${E1}$m$;
  execute $m$${E2}$m$;
  -- the state before the file, also when the file is already applied on this copy: its functions are dropped, so the checks (comments, grants,
  -- volatility) see what the file makes, not what an earlier run left (2026-10-19: comment_missing was NOT CAUGHT on a copy with the file applied)
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('combat_v2_stats', 'card_combat_v2') loop
      execute 'drop function ' || f;
    end loop; end $x$$d$;`;
const V1FNS = ['card_combat(text,integer,numeric,jsonb)', 'card_combat(text,integer,numeric,jsonb,jsonb)', 'card_cp_exact(text,integer,numeric)', 'card_cp_exact(text,integer,numeric,jsonb,jsonb)', 'card_max_hp(integer)', 'card_max_hp(integer,numeric,numeric)'];
const md5s = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('card_combat', 'card_cp_exact', 'card_max_hp'))`;
// the compact answer of one card: [cp_asc, cp_base, atk, def, hp, crd, crt, abl, ddg, acc, spd, spd_x, power, extra_stack, class, points, points_free]
const ROW = `jsonb_build_array(c->'cp_asc', c->'cp_base', c->'stats'->'atk', c->'stats'->'def', c->'stats'->'hp', c->'stats'->'crd', c->'stats'->'crt', c->'stats'->'abl',
  c->'stats'->'ddg', c->'stats'->'acc', c->'stats'->'spd', c->'spd_x', c->'power', c->'extra_stack', c->'class', c->'points', c->'points_free')`;
const gridBlock = (cards) => String.raw`do $t$
declare out jsonb := '[]'; x jsonb; c jsonb;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  for x in select v from jsonb_array_elements(${sqlLit(cards)}::jsonb) v loop
    c := card_combat_v2(x->>0, (x->>1)::int, (x->>2)::numeric, (x->>3)::int, x->4, x->>5);
    out := out || jsonb_build_array(${ROW});
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the fixed checks
const ALLPTS = { atk: 10, hp: 10, def: 12, crt: 10, crd: 10, abl: 10, ddg: 10, acc: 10, spd: 10 };   // checks.mjs formulaChecks
const ASC = [['normal', 0, 25], ['normal', 5, 75], ['gold', 0, 149.333], ['gold', 5, 224], ['illustrated_rare', 3, 40 * (1 + 2.5 * 0.678)], ['promo', 2, 50], ['event', 5, 187.5]];
// each refusal with the words its message must have (a refusal for another reason does not count)
const BAD = [
  ['an unknown rarity', ['mythic', 0, 1, 0, {}, 'breaker'], 'unknown rarity'], ['an unknown role', ['normal', 0, 1, 0, {}, 'paladin'], 'unknown role'],
  ['no role', ['normal', 0, 1, 0, {}, null], 'unknown role'], ['a negative level', ['normal', 0, 1, -1, {}, 'breaker'], 'the level must be 0 or more'],
  ['an unknown stat', ['normal', 0, 1, 30, { luck: 1 }, 'breaker'], 'is not one of the 9 stats'],
  ['max_per_stat as a stat', ['normal', 0, 1, 30, { max_per_stat: 1 }, 'breaker'], 'is not one of the 9 stats'],
  ['points -1', ['normal', 0, 1, 30, { atk: -1 }, 'breaker'], 'must be a whole number of 0 or more'],
  ['points 1.5', ['normal', 0, 1, 30, { atk: 1.5 }, 'breaker'], 'must be a whole number of 0 or more'],
  ['points as a string', ['normal', 0, 1, 30, { atk: '3' }, 'breaker'], 'must be a whole number of 0 or more'],
  ['points as a list', ['normal', 0, 1, 30, [3], 'breaker'], 'must be an object'],
  ['more points than the level gives (3 at level 2)', ['normal', 0, 1, 2, { atk: 3 }, 'breaker'], 'points spent, the level 2 gives 2'],
];
const body1 = String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; c jsonb; r record; o jsonb; x jsonb; t text; ok boolean;
begin
  ${SETUP}
  before := ${md5s};
  execute $m$${mig}$m$;
  after := ${md5s};
  res := res || jsonb_build_object('case', 'v1 is not changed: the md5 of the 6 functions card_combat, card_cp_exact and card_max_hp (2 each) are the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) = ${V1FNS.length}, 'got', jsonb_build_object('before', before, 'after', after));
  res := res || jsonb_build_object('case', 'NUMBERS', 'ok', true, 'b', combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed']));
  -- 1. the simulator formula checks
  o := '[]';
  for x in select v from jsonb_array_elements(${sqlLit(ASC)}::jsonb) v loop
    o := o || jsonb_build_array(card_combat_v2(x->>0, (x->>1)::int, 1, 0, '{}', 'breaker')->'cp_asc');
  end loop;
  res := res || jsonb_build_object('case', 'ASC', 'ok', true, 'got', o);
  res := res || jsonb_build_object('case', 'STAT50', 'ok', true, 'got', combat_v2_stats(50, ${sqlLit(ALLPTS)}, 'striker', combat_v2_numbers(array['v2_stats', 'v2_card_hp', 'v2_speed'])));
  -- the caps of Defense, Crit % and Dodge: with today's numbers 10 points never pass them (10 x 3% = the 30% cap), so raise the pct for this check
  update public.balance set value = jsonb_set(jsonb_set(jsonb_set(value, '{def,pct}', '0.05'), '{ddg,pct}', '0.05'), '{crt,pct}', '0.06') where key = 'v2_stats';
  res := res || jsonb_build_object('case', 'CAPS', 'ok', true, 'got', combat_v2_stats(50, ${sqlLit(ALLPTS)}, 'striker', combat_v2_numbers(array['v2_stats', 'v2_card_hp', 'v2_speed'])),
    'stats', (select value from balance where key = 'v2_stats'));
  update public.balance set value = jsonb_set(jsonb_set(jsonb_set(value, '{def,pct}', '0.03'), '{ddg,pct}', '0.03'), '{crt,pct}', '0.04') where key = 'v2_stats';
  update public.balance set value = jsonb_set(value, '{converge_d}', '0') where key = 'v2_level';
  o := jsonb_build_object('d0', card_combat_v2('normal', 0, 1, 30, '{}', 'breaker')->'cp_base');
  update public.balance set value = jsonb_set(value, '{converge_d}', '1') where key = 'v2_level';
  o := o || jsonb_build_object('d1', card_combat_v2('normal', 0, 1, 30, '{}', 'breaker')->'cp_base', 'd1_l15', card_combat_v2('normal', 0, 1, 15, '{}', 'breaker')->'cp_base',
    'target', (select value->'target_cp' from balance where key = 'v2_level'));
  update public.balance set value = jsonb_set(value, '{converge_d}', '0.22') where key = 'v2_level';
  res := res || jsonb_build_object('case', 'CONVERGE', 'ok', true, 'got', o);
  res := res || jsonb_build_object('case', 'LEVEL30', 'ok', true, 'got', card_combat_v2('normal', 0, 1, 30, '{}', 'breaker')->'points_level');
  -- 3. the role lookup
  for r in select * from public.roles order by ord loop
    c := card_combat_v2('normal', 0, 1, 0, '{}', r.key);
    res := res || jsonb_build_object('case', 'ROLE ' || r.key, 'ok',
      c->'passive' = jsonb_build_object('key', r.key, 'label', r.label, 'class', r.class, 'text', r.passive, 'numbers', balance_path(r.numbers), 'speed', balance_path(r.speed))
      and c->>'class' = r.class and (c->'stats'->>'spd')::numeric = (balance_path(r.speed) #>> '{}')::numeric, 'got', c->'passive');
  end loop;
  -- 4. the refusals
  o := '[]';
  for x in select v from jsonb_array_elements(${sqlLit(BAD.map(([n, a, m]) => ({ n, a, m })))}::jsonb) v loop
    begin
      perform card_combat_v2(x->'a'->>0, (x->'a'->>1)::int, (x->'a'->>2)::numeric, (x->'a'->>3)::int, x->'a'->4, x->'a'->>5);
      o := o || to_jsonb('accepted: ' || (x->>'n'));
    exception when others then
      if position(x->>'m' in sqlerrm) = 0 then o := o || to_jsonb('refused for another reason: ' || (x->>'n') || ': ' || sqlerrm); end if;
    end;
  end loop;
  res := res || jsonb_build_object('case', '${BAD.length} bad inputs refused, each with its own message (${BAD.map((b) => b[0]).join(', ')})', 'ok', o = '[]'::jsonb, 'got', o);
  -- the exact spend is fine: 30 points at level 30, 2 at level 2
  res := res || jsonb_build_object('case', 'the exact spend is accepted: 30 points at level 30 (free 0), 2 points at level 2 (free 0)', 'ok',
    (card_combat_v2('gold', 5, 1, 30, '{"atk": 10, "hp": 10, "spd": 10}', 'flurry')->>'points_free')::numeric = 0
    and (card_combat_v2('normal', 0, 1, 2, '{"atk": 2}', 'flurry')->>'points_free')::numeric = 0);
  -- 6. pure and server only
  select jsonb_object_agg(p.oid::regprocedure::text, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('combat_v2_stats', 'card_combat_v2');
  res := res || jsonb_build_object('case', 'volatility: combat_v2_stats IMMUTABLE; card_combat_v2 STABLE (it reads the roles table and balance); 3 functions', 'ok',
    o = '{"combat_v2_stats(numeric,jsonb,text,jsonb)": "i", "card_combat_v2(text,integer,numeric,integer,jsonb,text,jsonb)": "s", "card_combat_v2(text,integer,numeric,integer,jsonb,text)": "s"}'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2
   where p.pronamespace = 'public'::regnamespace and p.proname in ('combat_v2_stats', 'card_combat_v2') and has_function_privilege(r2, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the 3 functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('combat_v2_stats', 'card_combat_v2') and coalesce(obj_description(p.oid, 'pg_proc'), '') = '';
  res := res || jsonb_build_object('case', 'every function has a comment', 'ok', o = '[]'::jsonb, 'got', o);
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: the file runs a second time', 'ok', true);
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the grid
const RARITIES = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold', 'promo', 'event'];
const LEVELS = [0, 1, 5, 10, 15, 22, 29, 30, 31, 45];
const MODS = [1, 0.9, 1.25];
function grid(cfg) {
  const out = [];
  for (const rarity of RARITIES) for (let stars = -1; stars <= 6; stars++) for (const level of LEVELS) for (const role of ROLES) for (const cp_mod of MODS) {
    out.push({ rarity, stars, level, role, cp_mod, points: buildFor(cfg, role, level) });
  }
  const rng = mkRng(4242); const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  for (let i = 0; i < 3000; i++) {
    const level = ri(0, 34); let left = Math.min(level, cfg.v2_level.max_level) * cfg.v2_level.points_per_level; const points = {};
    for (const s of STATS) { if (rng() < 0.55 && left > 0) { const n = Math.min(left, ri(0, 13)); if (n || rng() < 0.3) points[s] = n; left -= n; } }
    out.push({ rarity: RARITIES[ri(0, 6)], stars: ri(0, 5), level, role: ROLES[ri(0, 11)], cp_mod: [1, 1, 0.8, 1.1, 1.333][ri(0, 4)], points, random: true });
  }
  return out;
}
function simRow(cfg, g) {
  const c = makeCard(cfg, { key: 'grid', role: g.role, rarity: g.rarity, stars: g.stars, level: g.level, points: g.points, cp_mod: g.cp_mod });
  const max = cfg.v2_stats.max_per_stat;
  return [F.ascCp(cfg, g.rarity, g.stars) * g.cp_mod, c.cpBase, c.cp, c.def, c.maxHp, c.critx, c.crit, c.abl, c.ddg, c.acc, c.speedBase * c.spdMult, c.spdMult, c.power,
    cfg.v2_support.enabler_extra_stack.includes(g.rarity) ? 1 : 0, c.cls, Object.fromEntries(STATS.map((s) => [s, Math.min(max, g.points[s] || 0)])),
    F.levelPoints(cfg, g.level) - Object.values(g.points).reduce((s, x) => s + x, 0)];
}
const NAMES = ['cp_asc', 'cp_base', 'atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd', 'spd_x', 'power', 'extra_stack', 'class', 'points', 'points_free'];
const near = (a, b) => Math.abs(Number(a) - b) <= 1e-9 * Math.max(1, Math.abs(b));

let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  const results = JSON.parse(await runBlock(body1));
  const B = results.find((r) => r.case === 'NUMBERS').b;
  const cfg = patch(loadConfig(), B);
  const get = (n) => results.find((r) => r.case === n).got;
  // 1. the ported formula checks (the expected values of checks.mjs, and the same values from the simulator formulas with the database numbers)
  const asc = get('ASC');
  ASC.forEach(([r, s, v], i) => say(Math.abs(Number(asc[i]) - v) <= 0.01 && near(asc[i], F.ascCp(cfg, r, s)), `asc.${r}.${s}: ASC-3 CP of ${r} ${s}* = ${v} (got ${Number(asc[i]).toFixed(4)})`, `got ${asc[i]}`));
  const st = get('STAT50'); const sim = F.stats(cfg, 50, ALLPTS);
  for (const [id, what, want, got, simv] of [['stat.atk', 'flat Attack: +3 CP a point (10 points)', 80, st.atk, sim.cp], ['stat.hp', 'HP = 50 + 1.5 x CP_base + 8 a point', 205, st.hp, sim.maxHp],
    ['stat.def', 'Defense 3% a point, cap 30% (12 points)', 0.30, st.def, sim.def], ['stat.crt', 'crit 10% + 4% a point', 0.50, st.crt, sim.crit],
    ['stat.crd', 'crit damage 2.0 + 0.1 a point', 3.0, st.crd, sim.critx], ['stat.ddg', 'Dodge 3% a point, cap 30%', 0.30, st.ddg, sim.ddg],
    ['stat.spd', 'Speed +3% a point', 1.30, st.spd_x, sim.spdMult], ['stat.abl', 'Ability +5% a point', 1.5, st.abl, sim.abl], ['stat.acc', 'Accuracy 2% a point', 0.2, st.acc, sim.acc]]) {
    say(near(got, want) && near(got, simv), `${id}: ${what} = ${want}`, `got ${got}, simulator ${simv}`);
  }
  { const r = results.find((x) => x.case === 'CAPS'); const c2 = patch(cfg, { v2_stats: r.stats }); const sm = F.stats(c2, 50, ALLPTS); const S = r.stats;
    const want = { def: S.def.cap, ddg: S.ddg.cap, crt: S.crt.cap };
    say(near(r.got.def, want.def) && near(r.got.ddg, want.ddg) && near(r.got.crt, want.crt) && near(r.got.def, sm.def) && near(r.got.ddg, sm.ddg) && near(r.got.crt, sm.crit),
      `the caps bind (pct raised for the check: Defense 5%, Dodge 5%, Crit 6% a point, 10 points): def ${want.def}, ddg ${want.ddg}, crt ${want.crt}, as the simulator`, JSON.stringify(r.got)); }
  const cv = get('CONVERGE');
  say(near(cv.d0, 25), 'converge.off: D = 0 keeps CP (Normal 0*, level 30: 25)', JSON.stringify(cv));
  say(near(cv.d1, Number(cv.target)) && near(cv.d1_l15, 25 + 0.5 * (Number(cv.target) - 25)), `converge.full: D = 1 at max level reaches the target (${cv.target}); at level 15 half the way`, JSON.stringify(cv));
  say(Number(get('LEVEL30')) === F.levelPoints(cfg, 30) && F.levelPoints(cfg, 30) === 30, 'level.points: level 30 = 30 points', `got ${get('LEVEL30')}`);
  // 3 - 6. the rest of block 1
  const roles = results.filter((r) => r.case.startsWith('ROLE '));
  say(roles.length === 12 && roles.every((r) => r.ok), `the role lookup: the 12 roles give their class, label, passive text, v2_roles numbers and base speed`, JSON.stringify(roles.filter((r) => !r.ok)).slice(0, 600));
  for (const r of results.filter((x) => !['NUMBERS', 'ASC', 'STAT50', 'CAPS', 'CONVERGE', 'LEVEL30'].includes(x.case) && !x.case.startsWith('ROLE '))) {
    const { case: name, ok, ...rest } = r;
    say(ok, name, JSON.stringify(rest).slice(0, 900));
  }
  // 2. the grid
  const G = grid(cfg);
  const CHUNK = Number(process.env.V2_CHUNK || 2500);
  const bad = {}; let n = 0, firstBad = [], worst = 0;
  for (let i = 0; i < G.length; i += CHUNK) {
    const part = G.slice(i, i + CHUNK);
    const rows = JSON.parse(await runBlock(gridBlock(part.map((g) => [g.rarity, g.stars, g.cp_mod, g.level, g.points, g.role]))));
    rows.forEach((row, j) => {
      const want = simRow(cfg, part[j]); n++;
      NAMES.forEach((name, k) => {
        if (typeof want[k] === 'number' && want[k] !== 0) worst = Math.max(worst, Math.abs(Number(row[k]) - want[k]) / Math.abs(want[k]));
        const ok = typeof want[k] === 'number' ? near(row[k], want[k]) : JSON.stringify(typeof want[k] === 'object' ? STATS.map((x) => Number(row[k]?.[x])) : row[k]) === JSON.stringify(typeof want[k] === 'object' ? STATS.map((x) => want[k][x]) : want[k]) && (typeof want[k] !== 'object' || Object.keys(row[k]).length === STATS.length);
        if (!ok) { bad[name] = (bad[name] || 0) + 1; if (firstBad.length < 4) firstBad.push(`${JSON.stringify(part[j]).slice(0, 160)} ${name}: SQL ${JSON.stringify(row[k])} simulator ${JSON.stringify(want[k])}`); }
      });
    });
  }
  const nGrid = G.filter((g) => !g.random).length;
  say(n === G.length && Object.keys(bad).length === 0, `SQL = the simulator on ${n} cards (${nGrid} grid: ${RARITIES.length} rarities x 8 stars x ${LEVELS.length} levels x 12 roles x ${MODS.length} cp_mod with the role build; ${n - nGrid} random point builds): all ${NAMES.length} numbers within a relative 1e-9`,
    `${JSON.stringify(bad)} ${firstBad.join(' | ')}`);
  say(worst <= 1e-9, `the largest relative difference SQL vs simulator over all ${n} cards: ${worst.toExponential(2)} (float noise of the simulator)`, `${worst}`);
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 900)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
