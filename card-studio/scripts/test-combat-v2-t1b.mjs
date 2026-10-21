import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_ability_prices.sql (combat v2 phase 3, PR T1b: the follow-up of T1, Nathan's 6 approved
 * recommendations of 2026-10-20). NO lasting change: every request is one DO block, undone by its final RAISE. V1, E1 to E6, T1 and this file run
 * inside each block (all idempotent), so the test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-t1b.mjs     must PASS
 *   MUTATE=<name> ...                                                                        must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                           the baseline (must PASS), then every mutation, one line each
 * The reference is the simulator card-studio/v2sim (cards.mjs blockPP, engine.mjs doActive) with the numbers of the database.
 * Invariants:
 *   1. No change in play: the md5 of every other public function is the same after the file; the 4 replaced functions (ability_v2_spec,
 *      ability_v2_block_pp, ability_v2_pps, combat_effect_v2_active) give the T1 answers (validator, PP, text, card action) on T1 abilities without the
 *      changed parts; no v1 function calls them; the flag stays OFF; volatility, server only, comments; the file runs twice.
 *   2. Balance: ability_v2 = config.json ability_v2 (every leaf: + pp.vs_smite, share.self_has_each, share.area_payoff, ref.list_extra;
 *      pp.sup_vs_k and share.self_has stay, a balance leaf is never removed), the fixed shape refuses planted values, the change is logged by nathan,
 *      a second run keeps a changed value.
 *   3. The prices of the 6 decisions, as numbers from the balance (1a support vs_status on the smite, 2 self_has per status, 3 the list share and its
 *      cap, 5 the payoff on area hits), and SQL = the simulator on the PP of every block of random abilities (also with changed numbers).
 *   4. The card action: a payoff counts on each area hit against THAT enemy (payoff_dmg and payoff_crit; a gate turns it off); on_kill keeps the
 *      next standing enemy in the fixed order (decision 4: not the lowest HP); SQL = the simulator on random fights.
 *   5. The private Set 1 actives (when the private batch file exists, never in this repo): the counts of accepted and of texts equal to the approved text.
 *   6. The fuzz: random actions with random(): fight_state_check_v2, HP in [0, max], a down unit has no status, a replay gives the same action.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { mini, dummyFoe } from '../v2sim/checks.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { ROLES, classOf, templatePP, blockPP, scaledFields } from '../v2sim/cards.mjs';
import { loadConfig, patch, mkRng, loadFixture } from '../v2sim/util.mjs';
assertLocal('test-combat-v2-t1b.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const V1 = read('combat_v2_flags_balance.sql');
const E1 = read('combat_v2_statuses_roles.sql');
const E2 = read('combat_v2_turn_meter.sql');
const E3 = read('combat_v2_stats.sql');
const E4 = read('combat_v2_hit.sql');
const E5 = read('combat_v2_status_rules.sql');
const E6 = read('combat_v2_abilities.sql');
const T1 = read('combat_v2_ability_builder.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_ability_prices.sql');

const MUT = {
  // 1a. the support vs_status on the smite
  pp_vs_smite_off: ["           * ((blk->>'x')::numeric - 1) * (av->'pp'->>'vs_smite')::numeric * least(", "           * ((blk->>'x')::numeric - 1) * least("],
  pp_vs_fixed_smite: ["      v := (su->>'smite')::numeric * (select (y->>'x')::numeric from jsonb_array_elements(p_blocks) y where y->>'k' = 'smite' limit 1)\n           * ((blk->>'x')::numeric - 1) * (av",
    "      v := (su->>'smite')::numeric * 1.5\n           * ((blk->>'x')::numeric - 1) * (av"],
  pp_vs_branch_off: ["    elsif k = 'vs_status' and p_class = 'support' then\n", "    elsif false then\n"],
  pp_vs_list_off: ["least(1, (r->>'frozen_share')::numeric * (r->>'payoff')::numeric + lx) * sk;", "least(1, (r->>'frozen_share')::numeric * (r->>'payoff')::numeric) * sk;"],
  // 2. self_has: one share for each status
  pp_self_has_one_share: ["sh := case when k = 'self_has' then (av->'share'->'self_has_each'->>(blk->>'status'))::numeric else", "sh := case when k = 'self_has' then (av->'share'->'self_has_each'->>'empowered')::numeric else"],
  pp_share_missing_silent: ["      if sh is null then raise exception 'ability_v2_pps: balance ability_v2 has no share for % %', k, coalesce(blk->>'status', ''); end if;\n", ''],
  // 3. the status lists
  pp_list_extra_off: ["  lx numeric := (p_b->'ability_v2'->'ref'->>'list_extra')::numeric * (", "  lx numeric := 0 * ("],
  pp_list_cap_off: ["    when 'payoff_crit' then k * v * least(1, (r->>'payoff')::numeric + lx)", "    when 'payoff_crit' then k * v * ((r->>'payoff')::numeric + lx)"],
  pp_list_count_all: ["    lx := (av->'ref'->>'list_extra')::numeric * (coalesce(jsonb_array_length(case when jsonb_typeof(blk->'statuses') = 'array' then blk->'statuses' end), 1) - 1);",
    "    lx := (av->'ref'->>'list_extra')::numeric * coalesce(jsonb_array_length(case when jsonb_typeof(blk->'statuses') = 'array' then blk->'statuses' end), 1);"],
  pp_target_has_list_off: ["then (r->>'frozen_share')::numeric else 1 end + lx);", "then (r->>'frozen_share')::numeric else 1 end);"],
  // 5. the payoff on the area hits
  pp_area_payoff_off: ["      v := ability_v2_block_pp(blk, p_class, strikes, p_b) * (1 + area * (r->>'foes_other')::numeric * (av->'share'->>'area_payoff')::numeric);",
    "      v := ability_v2_block_pp(blk, p_class, strikes, p_b);"],
  pp_area_payoff_dmg_only: ["    elsif k in ('payoff_dmg', 'payoff_crit') and p_class = 'attacker' and area is not null then", "    elsif k in ('payoff_dmg') and p_class = 'attacker' and area is not null then"],
  area_bonus_off: ["jsonb_build_object('x', area, 'bonus', abonus, 'crit_bonus', acrit)", "jsonb_build_object('x', area, 'bonus', 0, 'crit_bonus', acrit)"],
  area_crit_of_main: ["jsonb_build_object('x', area, 'bonus', abonus, 'crit_bonus', acrit)", "jsonb_build_object('x', area, 'bonus', abonus, 'crit_bonus', crit_bonus)"],
  area_status_of_main: ["          if combat_effect_v2_has(au, blk, clk) then\n", "          if combat_effect_v2_has(tu, blk, clk) then\n"],
  area_gate_ignored: ["      elsif k = 'payoff_dmg' then if combat_effect_v2_has(tu, blk, clk) then bonus := bonus + (blk->>'v')::numeric * ab; end if; pays := pays || jsonb_build_array(blk);\n",
    "      elsif k = 'payoff_dmg' then if combat_effect_v2_has(tu, blk, clk) then bonus := bonus + (blk->>'v')::numeric * ab; end if;\n"],
  // 4. on_kill: the next standing enemy in the fixed order
  on_kill_lowest_hp: ["combat_v2_up(s->'enemies'->(q.id::int)) order by q.n limit 1);\n        if nx is not null then", "combat_v2_up(s->'enemies'->(q.id::int)) order by (s->'enemies'->(q.id::int)->>'hp')::numeric, q.n limit 1);\n        if nx is not null then"],
  on_kill_on_target: ["              r := combat_v2_status_apply(s, nx, blk->>'status'", "              r := combat_v2_status_apply(s, p_target, blk->>'status'"],
  // balance, rights, comments
  balance_update_always: [" where key = 'ability_v2' and not value->'share' ? 'self_has_each';", " where key = 'ability_v2';"],
  spec_list_extra_wide: ['"ref": {"per_ally": "num 0 10", "list_extra": "num 0 1"}}', '"ref": {"per_ally": "num 0 10", "list_extra": "num 0 9"}}'],
  spec_self_has_extra: ['"self_has_each": {"empowered": "num 0 1", "focused": "num 0 1", "quickened": "num 0 1", "poison": "num 0 1", "burn": "num 0 1", "chill": "num 0 1",\n                                  "weakened": "num 0 1", "stunned": "num 0 1", "slowed": "num 0 1", "blinded": "num 0 1", "confused": "num 0 1", "frozen": "num 0 1",\n                                  "sleep": "num 0 1", "paralyzed": "num 0 1", "exposed": "num 0 1"},',
    '"self_has_each": {"empowered": "num 0 1", "focused": "num 0 1", "quickened": "num 0 1", "poison": "num 0 1", "burn": "num 0 1", "chill": "num 0 1",\n                                  "weakened": "num 0 1", "stunned": "num 0 1", "slowed": "num 0 1", "blinded": "num 0 1", "confused": "num 0 1", "frozen": "num 0 1",\n                                  "sleep": "num 0 1", "paralyzed": "num 0 1", "exposed": "num 0 1", "zz": "num 0 1"},'],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.ability_v2_pps\([^)]*\) is \$cm\$[^\n]*\n/, ''],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)       ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const fails = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5, 60));
    console.log(`mutation ${name.padEnd(28)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  first: ${(fails[0] || (r.stderr || '').trim().split(/\r?\n/).pop() || '').slice(0, 70)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  const n = !m ? 0 : m[0] instanceof RegExp ? (mig.match(new RegExp(m[0].source, 'g')) || []).length : mig.split(m[0]).length - 1;
  if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once (${n})`);
  mig = m[0] instanceof RegExp ? mig.replace(m[0], m[1]) : mig.split(m[0]).join(m[1]);
}
for (const t of [V1, E1, E2, E3, E4, E5, E6, T1, mig]) if (['$m$', '$t$', '$d$', '$x$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$ or $x$');

// The T1 functions that this file replaces (each answers the T1 answer on a T1 ability without the changed parts). It adds no function.
const REPLACED = ['ability_v2_spec', 'ability_v2_block_pp', 'ability_v2_pps', 'combat_effect_v2_active'];
const T1NEW = ['ability_v2_pps', 'ability_v2_or', 'ability_v2_clause', 'ability_v2_ally_word', 'ability_v2_options', 'ability_v2_coin', 'combat_effect_v2_has',
  'combat_effect_v2_ally_to', 'combat_effect_v2_gate', 'combat_effect_v2_count', 'combat_effect_v2_amount', 'subjects_ability_v2_check'];
const E6NEW = ['ability_v2_spec', 'balance_check_ability_v2', 'ability_v2_field_types', 'ability_blocks_check', 'ability_v2_numbers', 'ability_v2_block_pp', 'ability_v2_pp',
  'ability_v2_pct', 'ability_v2_fill', 'ability_v2_cap', 'ability_v2_vals', 'ability_v2_verb', 'ability_v2_words', 'ability_v2_text', 'ability_v2_silver_text',
  'ability_v2_field_error', 'ability_v2_check', 'combat_v2_action_numbers', 'combat_v2_draws_rest', 'combat_effect_v2_blocks', 'combat_effect_v2_hit',
  'combat_effect_v2_basic', 'combat_effect_v2_active', 'combat_v2_card_act'];
const q = (a) => a.map((n) => `'${n}'`).join(', ');
// The state before the file, also when it is already applied: the SETUP of the T1 test (E6's table, functions, columns and balance key go, then E6),
// then T1. This file adds no function, so nothing more goes.
const SETUP = String.raw`
  perform set_config('balance.by', 'test', true);
  execute $m$${V1}$m$;
  execute $m$${E1}$m$;
  execute $m$${E2}$m$;
  execute $m$${E3}$m$;
  execute $m$${E4}$m$;
  execute $m$${E5}$m$;
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q([...E6NEW, ...T1NEW])}) loop
      execute 'drop function ' || f || ' cascade';
    end loop; end $x$$d$;
  drop table if exists public.ability_blocks;
  alter table public.statuses drop column if exists verb, drop column if exists adj;
  alter table public.subjects drop column if exists ability_v2;
  alter table public.balance disable trigger user;
  delete from public.balance where key = 'ability_v2';
  alter table public.balance enable trigger user;
  update public.balance set value = jsonb_set(value, '{support_pp,shield_all}', '75') where key = 'v2_pp';
  execute $m$${E6}$m$;
  execute $m$${T1}$m$;`;
const md5s = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> all (array[${q(REPLACED)}]))`;

// ---------------------------------------------------------------------------------------------------------------- the fight state helpers (as E6)
const card = (c) => ({ role: 'striker', class: 'attacker', atk: 100, crt: 0, crd: 2, abl: 1, acc: 0, def: 0, ddg: 0, hp: c.max ?? 100, max: 100, down: false, meter: 0, charge: 0, held: 0, status: {}, ...c,
  class: c.class ?? classOf(c.role || 'striker') });
const state = (sc) => ({
  v: 2, mode: sc.mode || 'dungeon', round: 0, clock: sc.clock ?? 1, squad: sc.squad || Object.keys(sc.cards || {}).map(Number),
  cards: Object.fromEntries(Object.entries(sc.cards || {}).map(([id, c]) => [id, card(c)])),
  enemies: (sc.enemies || []).map((e) => ({ hp: e.max ?? 1000, max: 1000, down: false, meter: 0, charge: 0, speed: 50, atk: 20, def: 0, evasion: 0, resolve: 0, keen: 0, status: {}, ...e })),
  marks: {}, facts: { passives: [], cards: {} }, ext: sc.ext || {} });
const Cr = (id) => ({ side: 'card', id }), En = (i = 0) => ({ side: 'enemy', id: i });
const act = (a, o = {}) => ({ op: 'act', a, o });
const DRIVER = String.raw`
  create or replace function pg_temp.t1run(p_s jsonb, p_ops jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; op jsonb; r jsonb; out jsonb := '[]';
  begin
    for op in select v from jsonb_array_elements(p_ops) v loop
      begin
        r := case op->>'op'
          when 'act' then combat_v2_card_act(s, op->'a', op->'o', p_b)
          when 'set' then jsonb_build_object('state', jsonb_set(s, array(select jsonb_array_elements_text(op->'path')), op->'v'))
        end;
        if r ? 'state' then s := r->'state'; end if;
        out := out || jsonb_build_array((r - 'state') || jsonb_build_object('s', s));
      exception when others then
        out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm, 's', s));
      end;
    end loop;
    return out;
  end $x$;`;
const runOps = async (cases) => JSON.parse(await runBlock(String.raw`do $t$
declare out jsonb := '[]'; x jsonb; b jsonb;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  ${DRIVER}
  b := combat_v2_action_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(cases)}::jsonb) v loop
    out := out || jsonb_build_array(pg_temp.t1run(x->0, x->1, b));
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`));
// The validator / PP: [role, ability] -> answer; ['pps', class, blocks] -> {pps}
const runChecks = async (items) => JSON.parse(await runBlock(String.raw`do $t$
declare out jsonb := '[]'; x jsonb; b jsonb;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := ability_v2_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    out := out || jsonb_build_array(case when x->>0 = 'pps' then jsonb_build_object('pps', ability_v2_pps(x->>1, x->2, b))
                                         when x->>0 = 'ppsx' then jsonb_build_object('pps', ability_v2_pps(x->>1, x->2, jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(b, '{v2_pp,ref,kinds}', '2.1'), '{v2_stats,crd,base}', '2.4'), '{ability_v2,ref,list_extra}', '0.3'), '{ability_v2,share,area_payoff}', '0.2'), '{ability_v2,pp,vs_smite}', '0.7'), '{ability_v2,share,self_has_each,focused}', '0.5')))
                                         else ability_v2_check(x->>0, x->1, b) end);
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`));
const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);

// ---------------------------------------------------------------------------------------------------------------- random abilities (E6 parts and T1 parts)
const NEG_RIDERS = ['poison', 'burn', 'chill', 'stunned', 'sleep', 'paralyzed', 'blinded', 'confused', 'slowed', 'exposed', 'weakened', 'mark'];
const VALUE_ST = ['exposed', 'weakened', 'mark'], STACK_ST = ['poison', 'burn', 'chill'];
const PLAIN_RIDERS = NEG_RIDERS.filter((s) => !VALUE_ST.includes(s));
const ENEMY_ST = [...NEG_RIDERS, 'frozen'];
const CARD_NEG = NEG_RIDERS.filter((s) => s !== 'mark').concat(['frozen']);
// T1b: every card status that self_has takes (statuses.on_card, not a shield): each has its own share
const CARD_ST = ['empowered', 'focused', 'quickened', 'poison', 'burn', 'chill', 'weakened', 'stunned', 'slowed', 'blinded', 'confused', 'frozen', 'sleep', 'paralyzed', 'exposed'];
const GATES = ['self_has', 'enemy_charging', 'foes_alive', 'self_shield'];
const GATE_HOSTS = ['pierce', 'true_strike', 'shield_break', 'lifesteal', 'guard_up', 'payoff_dmg', 'vs_status', 'per_stack', 'per_kind', 'execute', 'apply', 'on_crit', 'on_kill',
  'random_apply', 'per_ally', 'shield', 'shield_all', 'heal', 'heal_all', 'cleanse', 'cure', 'empower', 'rally', 'focus', 'quicken', 'dispel', 'consume'];
const AMOUNT_HOSTS = ['shield', 'shield_all', 'heal', 'heal_all', 'empower', 'rally', 'focus', 'quicken', 'apply'];
function statusOpts(rng, st) { const o = {}; if (STACK_ST.includes(st) && rng() < 0.6) o.stacks = 1 + Math.floor(rng() * 3); if (VALUE_ST.includes(st)) o.value = [0.1, 0.2, 0.3, 0.45][Math.floor(rng() * 4)]; return o; }
function genAbility(rng, cls) {
  const pick = (a) => a[Math.floor(rng() * a.length)]; const r2 = (a, b) => Math.round((a + rng() * (b - a)) * 1000) / 1000; const ch = (p) => rng() < p;
  const list = () => [...new Set([pick(ENEMY_ST), pick(ENEMY_ST), pick(ENEMY_ST)])];
  const sOrList = () => (ch(0.35) ? { statuses: list() } : { status: pick(ENEMY_ST) });
  const options = () => { const s = [...new Set([pick(PLAIN_RIDERS), pick(PLAIN_RIDERS), pick(PLAIN_RIDERS), pick(PLAIN_RIDERS)])]; if (s.length < 2) s.push(s[0] === 'blinded' ? 'slowed' : 'blinded');
    return s.map((x) => ({ status: x, ...(STACK_ST.includes(x) && ch(0.5) ? { stacks: 1 + Math.floor(rng() * 2) } : {}) })); };
  const B = [];
  if (cls === 'attacker') {
    if (ch(0.55)) B.push({ k: 'hit', x: r2(1.1, 1.8) }); else B.push({ k: 'strikes', n: 2 + Math.floor(rng() * 3), x: r2(0.35, 0.9) });
    const area = ch(0.3);
    if (ch(0.3)) B.push({ k: 'crit_add', v: r2(0.05, 0.35) });
    if (ch(0.15)) B.push({ k: 'pierce', v: pick([0.3, 0.5, 1]) });
    if (ch(0.15)) B.push({ k: 'true_strike' });
    if (area) B.push({ k: 'area', x: r2(0.3, 0.8) });
    if (ch(0.1)) B.push({ k: 'shield_break', x: pick([1.5, 2, 3]) });
    if (ch(0.2)) B.push({ k: 'lifesteal', v: r2(0.1, 0.6), ...(ch(0.6) ? { to: pick(['most_hurt', 'strongest']) } : {}) });
    if (ch(0.1)) B.push({ k: 'guard_up', v: r2(0.1, 0.6) });
    if (ch(0.35)) B.push({ k: 'payoff_dmg', ...sOrList(), v: r2(0.1, 0.8) });
    if (ch(0.25)) B.push({ k: 'payoff_crit', ...sOrList(), v: r2(0.1, 0.4) }); // T1b: the area hits read it too
    if (ch(0.15)) B.push({ k: 'vs_status', ...sOrList(), x: pick([1.5, 2]) });
    if (ch(0.15)) B.push({ k: 'per_stack', status: pick(STACK_ST), v: r2(0.1, 0.3) });
    if (ch(0.1)) B.push({ k: 'per_kind', v: r2(0.1, 0.4) });
    if (ch(0.3)) B.push({ k: 'per_ally', v: r2(0.03, 0.2) });
    if (ch(0.15)) B.push({ k: 'execute', line: r2(0.2, 0.4), v: r2(0.5, 1.5) });
    if (ch(0.4)) { const st = pick(NEG_RIDERS); B.push({ k: 'apply', status: st, chance: ch(0.4) ? 1 : r2(0.2, 0.8), ...statusOpts(rng, st), ...(area && ch(0.6) ? { all: true } : {}) }); }
    if (ch(0.3)) B.push({ k: 'random_apply', options: options(), ...(ch(0.5) ? { chance: r2(0.3, 0.9) } : {}) });
    if (ch(0.2)) { const st = pick(NEG_RIDERS); B.push({ k: 'on_crit', status: st, chance: ch(0.3) ? 1 : r2(0.2, 0.9), ...statusOpts(rng, st) }); }
    if (ch(0.35)) { const st = pick(NEG_RIDERS); B.push({ k: 'on_kill', status: st, chance: ch(0.4) ? 1 : r2(0.2, 0.9), ...statusOpts(rng, st) }); }
  } else {
    const n = 1 + Math.floor(rng() * 4); const used = new Set();
    const add = (b) => { if (!['apply', 'shield', 'heal', 'empower', 'focus', 'quicken'].includes(b.k) && used.has(b.k)) return; used.add(b.k); B.push(b); };
    const to = () => (ch(0.35) ? { to: pick(['most_hurt', 'strongest']) } : {});
    for (let i = 0; i < n; i++) {
      const k = pick(['shield', 'shield_all', 'heal', 'heal_all', 'cleanse', 'cure', 'empower', 'rally', 'focus', 'quicken', 'dispel', 'smite', 'consume', 'apply', 'apply', 'apply', 'random_apply']);
      if (k === 'shield') add({ k, v: r2(0.1, 0.5), ...(used.has('cure') && ch(0.5) ? { to: 'cured' } : to()) });
      else if (['shield_all', 'heal_all'].includes(k)) add({ k, v: r2(0.05, 0.2) });
      else if (k === 'heal') add({ k, v: r2(0.2, 0.7), ...to() });
      else if (k === 'cure') add({ k, statuses: ch(0.3) ? ['all'] : [...new Set([pick(CARD_NEG), pick(CARD_NEG)])], immune: Math.floor(rng() * 9) });
      else if (k === 'empower') add({ k, v: r2(0.1, 0.6), ...to() });
      else if (k === 'rally') add({ k, v: r2(0.1, 0.6) });
      else if (k === 'focus') add({ k, crit: r2(0.1, 0.5), crd: pick([0, 0.5]), ...to() });
      else if (k === 'quicken') add({ k, v: pick([0.3, 0.5]), ...(ch(0.4) ? { all: true } : to()) });
      else if (k === 'smite') { add({ k, x: r2(0.4, 2) }); if (ch(0.3)) add({ k: 'area', x: r2(0.2, 0.6) }); if (ch(0.3)) add({ k: 'vs_status', ...sOrList(), x: 2 });
        if (ch(0.35)) add({ k: 'payoff_dmg', ...sOrList(), v: r2(0.2, 0.8) }); if (ch(0.3)) add({ k: 'crit_add', v: r2(0.1, 0.4) }); }
      else if (k === 'consume') add({ k, status: 'burn', x: pick([1, 1.2]) });
      else if (k === 'random_apply') add({ k, options: options(), ...(ch(0.4) ? { chance: r2(0.3, 0.9) } : {}) });
      else if (k === 'apply') { const st = pick(NEG_RIDERS); add({ k, status: st, chance: ch(0.6) ? 1 : r2(0.3, 0.8), ...statusOpts(rng, st), ...(VALUE_ST.includes(st) && ch(0.3) ? { per: ch(0.5) ? 'kinds' : pick(STACK_ST) } : {}) }); }
      else add({ k });
    }
  }
  // the attachments: one after a random host each (none after an attachment)
  for (let i = B.length - 1; i >= 0; i--) {
    const h = B[i]; if (!ch(cls === 'support' ? 0.45 : 0.3)) continue;
    const opts = [];
    if (GATE_HOSTS.includes(h.k)) opts.push('gate');
    if (cls === 'support' && AMOUNT_HOSTS.includes(h.k) && (h.k !== 'apply' || h.value !== undefined)) opts.push('target_has', ...(h.per ? [] : ['coin', 'more_per']), ...(['shield', 'heal'].includes(h.k) ? ['ally_below'] : []));
    if (!opts.length) continue;
    const o = pick(opts); let a;
    if (o === 'gate') { const g = pick(GATES); a = g === 'self_has' ? { k: g, status: pick(CARD_ST) } : { k: g }; }
    else if (o === 'target_has') a = { k: o, ...sOrList(), x: pick([1.5, 2]) };
    else if (o === 'coin') a = { k: o, alt: r2(0.05, 0.4), chance: pick([0.3, 0.5, 0.7]) };
    else if (o === 'more_per') a = { k: o, v: r2(0.05, 0.2), ...(ch(0.5) ? { status: pick(STACK_ST) } : {}) };
    else a = { k: o, line: r2(0.2, 0.6), x: pick([1.5, 2]) };
    B.splice(i + 1, 0, a);
  }
  return B;
}
const simBlocks = (u) => u.active.blocks.map((b) => { const c = { ...b }; if (u.class === 'support') for (const f of scaledFields(c)) if (typeof c[f] === 'number') c[f] = c[f] * (u.power ?? 1); if (c.stacks) c.stacks += u.extra_stack || 0; return c; });

// ---------------------------------------------------------------------------------------------------------------- random fights: SQL = the simulator (the E6 harness)
function fightSpecs(n, seed, B) {
  const rng = mkRng(seed); const pick = (a) => a[Math.floor(rng() * a.length)]; const chance = (p) => rng() < p;
  const st0 = (side) => { const s = {}; if (chance(0.25)) s.poison = { stacks: pick([1, 2]), until: pick([2, 4, 8]) }; if (chance(0.25)) s.burn = { stacks: pick([1, 3]) };
    if (chance(0.15)) s.chill = { stacks: pick([1, 2]), until: pick([2, 5]) }; if (chance(0.1)) s.slowed = { until: pick([2, 5]) }; if (chance(0.15)) s.quickened = { until: pick([3, 6]), ...(chance(0.5) ? { value: 1.4 } : {}) };
    if (side === 'enemy' && chance(0.2)) s.mark = { value: 0.2, until: 6 }; if (chance(0.15)) s.exposed = { value: 0.15, until: 5 }; if (chance(0.15)) s.weakened = { value: 0.2, until: 5 };
    if (chance(0.06)) s.confused = { until: 4 }; if (chance(0.08)) s.blinded = { until: 4 }; if (side === 'card' && chance(0.15)) s.focused = { value: 0.1, crd: 0.5, until: 9 };
    if (side === 'card' && chance(0.2)) s.empowered = { value: 0.3 }; if (chance(0.08)) s.sleep = { until: pick([2, 6]) }; else if (chance(0.08)) s.stunned = { until: pick([2, 4]) };
    if (side === 'enemy' && chance(0.1)) s.guarded = { value: 60 }; if (side === 'card' && chance(0.25)) s.shielded = { value: 20 }; return s; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const mode = chance(0.3) ? 'hunt' : 'dungeon';
    const nc = 2 + Math.floor(rng() * 4); const cards = {}; const ids = [];
    while (ids.length < nc) { const id = 1 + Math.floor(rng() * 30); if (!ids.includes(id)) ids.push(id); }
    for (const id of ids) {
      const role = pick(ROLES); const cls = classOf(role); const max = pick([80, 150, 300]);
      cards[id] = { role, class: cls, speed: B.v2_speed.role_base[role], meter: Math.floor(rng() * 9999) / 100, max, hp: Math.round(max * (0.2 + 0.8 * rng())), atk: pick([40, 80, 150]),
        crt: pick([0.1, 0.3, 0.5]), crd: pick([2, 2.5]), abl: pick([1, 1.1, 1.25]), acc: pick([0, 0.04]), def: pick([0, 0.09]), ddg: pick([0, 0.06]),
        power: cls === 'support' ? pick([1, 1.1, 1.25]) : 1, extra_stack: chance(0.2) ? 1 : 0, charge: Math.floor(rng() * 3), held: 0, status: st0('card'),
        active: { blocks: genAbility(rng, cls) } };
    }
    const enemies = mode === 'hunt' ? [{ speed: pick([100, 110]), meter: Math.floor(rng() * 9999) / 100, max: 30000, hp: 30000, atk: 40, def: pick([0.1, 0.2]), evasion: pick([0, 0.04]), resolve: pick([0, 0.1]), keen: 0, status: st0('enemy'), ...(chance(0.4) ? { cataclysm: true } : {}) }]
      : Array.from({ length: 1 + Math.floor(rng() * 3) }, () => { const max = pick([200, 600, 1500]); return { speed: pick([45, 50, 55]), meter: Math.floor(rng() * 9999) / 100, max, hp: Math.min(max, pick([60, 150, 400, 600])), atk: pick([10, 25]),
        def: pick([0, 0.05]), evasion: pick([0, 0.02]), resolve: pick([0, 0.1]), keen: 0, healer: chance(0.2), status: st0('enemy'), ...(chance(0.3) ? { cataclysm: true } : {}) }; });
    const st = state({ mode, clock: 0, squad: ids, cards, enemies });
    const script = Array.from({ length: 70 }, () => ({ draws: Array.from({ length: 110 }, () => Math.floor(rng() * 1e6) / 1e6), use: chance(0.75), tp: rng(), ap: rng(), hit: chance(0.7), cp: rng(), x: pick([0.6, 1, 1.5]) }));
    out.push([st, script]);
  }
  return out;
}
const FIGHT_DRIVER = String.raw`
  create or replace function pg_temp.t1sum(s jsonb) returns jsonb language sql as $x$
    select jsonb_build_object('clock', s->'clock',
      'cards', coalesce((select jsonb_object_agg(c.key, jsonb_build_object('hp', c.value->'hp', 'down', c.value->'down', 'status', c.value->'status',
                 'immune', coalesce(c.value->'immune', '{}'::jsonb), 'charge', c.value->'charge', 'held', coalesce(c.value->'held', '0'::jsonb))) from jsonb_each(s->'cards') c), '{}'::jsonb),
      'enemies', coalesce((select jsonb_agg(jsonb_build_object('hp', e.v->'hp', 'down', e.v->'down', 'status', e.v->'status', 'immune', coalesce(e.v->'immune', '{}'::jsonb)) order by e.o)
                 from jsonb_array_elements(s->'enemies') with ordinality e(v, o)), '[]'::jsonb));
  $x$;
  create or replace function pg_temp.t1fight(p_s jsonb, p_script jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; r jsonb; a jsonb; sc jsonb; k int := 0; out jsonb := '[]'; nused int; lst text[]; t jsonb; al jsonb; u jsonb; h jsonb; usex boolean; dr jsonb; w boolean;
  begin
    loop
      exit when k >= jsonb_array_length(p_script);
      sc := p_script->k;
      r := combat_v2_next(s, sc->'draws', p_b); s := r->'state';
      if r->>'event' <> 'act' then out := out || jsonb_build_array(jsonb_build_object('event', r->'event', 'u', pg_temp.t1sum(s))); exit; end if;
      nused := jsonb_array_length(r->'draws');
      dr := coalesce((select jsonb_agg(x.v order by x.o) from jsonb_array_elements(sc->'draws') with ordinality x(v, o) where x.o > nused), '[]'::jsonb);
      a := null;
      if not (r->>'skip')::boolean then
        if r->'actor'->>'side' = 'card' then
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
          t := jsonb_build_object('side', 'enemy', 'id', lst[floor((sc->>'tp')::numeric * cardinality(lst))::int + 1]::numeric);
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
          al := jsonb_build_object('side', 'card', 'id', lst[floor((sc->>'ap')::numeric * cardinality(lst))::int + 1]::numeric);
          u := s #> combat_v2_unit_path(s, r->'actor');
          usex := (sc->>'use')::boolean and coalesce((u->>'charge')::int, 0) >= (p_b->'v2_charge'->>(u->>'class'))::int;
          a := combat_v2_card_act(s, r->'actor', jsonb_build_object('use', usex, 'target', t, 'ally', al, 'draws', dr), p_b);
          s := a->'state'; nused := nused + jsonb_array_length(a->'draws');
        elsif (sc->>'hit')::boolean then
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
          t := jsonb_build_object('side', 'card', 'id', lst[floor((sc->>'cp')::numeric * cardinality(lst))::int + 1]::numeric);
          w := exists (select 1 from combat_v2_units(s) q where q.side = 'card' and q.id <> t->>'id' and s->'cards'->q.id->>'role' = 'warden' and combat_v2_up(s->'cards'->q.id));
          h := combat_v2_hit(s #> combat_v2_unit_path(s, r->'actor'), s #> combat_v2_unit_path(s, t),
                 jsonb_build_object('side', 'enemy', 'x', (sc->>'x')::numeric, 'warden', w, 'clock', s->'clock', 'mode', s->'mode', 'draws', dr), p_b);
          s := combat_v2_hit_apply(s, t, h, p_b)->'state'; nused := nused + jsonb_array_length(h->'draws');
        end if;
      end if;
      out := out || jsonb_build_array(jsonb_build_object('event', 'act', 'actor', r->'actor', 'skip', r->'skip', 'reason', r->'reason', 'n', nused, 'action', a->'action', 'u', pg_temp.t1sum(s)));
      k := k + 1;
    end loop;
    return out;
  end $x$;`;
const VALUE_KEYS = ['exposed', 'weakened', 'mark', 'empowered', 'focused', 'enraged', 'quickened'];
function cardOrder(st) {
  const sq = st.squad.map(String);
  return Object.keys(st.cards).sort((a, b) => { const ia = sq.indexOf(a), ib = sq.indexOf(b); if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); return Number(a) - Number(b); });
}
function simBattle(cfg, st) {
  const ids = cardOrder(st);
  const cards = ids.map((id) => { const c = st.cards[id];
    return { key: `c${id}`, name: `c${id}`, role: c.role, cls: c.class, cp: c.atk, crit: c.crt, critx: c.crd, abl: c.abl, acc: c.acc, def: c.def, ddg: c.ddg, maxHp: c.max, hp: c.hp, resolve: 0,
      speedBase: c.speed, spdMult: 1, power: c.power, active: { id: `a${id}`, name: 'a', charge: cfg.v2_charge[c.class], blocks: simBlocks(c) } }; });
  const foes = st.enemies.map((e, i) => dummyFoe({ key: `e${i}`, maxHp: e.max, hp: e.hp, atk: e.atk, def: e.def ?? 0, evasion: e.evasion ?? 0, resolve: e.resolve ?? 0, keen: e.keen ?? 0, speedBase: e.speed, mech: e.mechanics || [], healer: !!e.healer }));
  const b = mini(cfg, cards, foes, { mode: st.mode, cap: 1e9 });
  b.step = st.clock;
  const units = [...ids.map((id) => ['card', id, st.cards[id]]), ...st.enemies.map((e, i) => ['enemy', String(i), e])];
  units.forEach(([side, id, src], k) => {
    const u = side === 'card' ? b.cards[k] : b.enemies[k - ids.length];
    u.down = !!src.down || src.hp <= 0; u.meter = src.meter ?? 0; u.st = {}; u.shield = 0;
    if (side === 'card') { u.charge = src.charge ?? 0; u.held = src.held ?? 0; } else u.charging = !!src.cataclysm;
    for (const [s, v] of Object.entries(src.status || {})) {
      if (s === 'shielded' || s === 'guarded') { u.shield = v.value; continue; }
      const o = {}; if (v.stacks !== undefined) o.stacks = v.stacks; if (v.until !== undefined) o.until = v.until;
      if (s === 'quickened') o.v = v.value ?? cfg.v2_status.quickened.x; else if (VALUE_KEYS.includes(s)) o.v = v.value; else if (s === 'slowed') o.v = cfg.v2_status.slowed.x; else if (!STACK_ST.includes(s)) o.v = 1;
      if (v.crd !== undefined) o.crd = v.crd;
      u.st[s] = o;
    }
    if (src.immune?.control !== undefined) u.immUntil = src.immune.control + 1;
    for (const [s, n] of Object.entries(src.immune || {})) if (s !== 'control') u.immuneTo[s] = n + 1;
  });
  const ref = (u) => (u.side === 'card' ? { side: 'card', id: Number(ids[b.cards.indexOf(u)]) } : { side: 'enemy', id: b.enemies.indexOf(u) });
  return { b, ids, ref };
}
function simSum(H) {
  const { b, ids } = H; const clk = b.step;
  const one = (u) => {
    const status = {};
    for (const [s, v] of Object.entries(u.st)) {
      const o = {}; if (v.stacks !== undefined) o.stacks = v.stacks; if (VALUE_KEYS.includes(s)) o.value = v.v; if (v.until !== undefined) o.until = v.until; if (s === 'focused') o.crd = v.crd || 0;
      status[s] = o;
    }
    if (u.shield > 1e-9) status[u.side === 'card' ? 'shielded' : 'guarded'] = { value: u.shield };
    const immune = {};
    if (u.immUntil - 1 >= clk) immune.control = u.immUntil - 1;
    for (const [s, n] of Object.entries(u.immuneTo)) if (n - 1 >= clk) immune[s] = n - 1;
    return { hp: u.hp, down: !!u.down, status, immune, ...(u.side === 'card' ? { charge: u.charge, held: u.held } : {}) };
  };
  return { clock: clk, cards: Object.fromEntries(ids.map((id, k) => [id, one(b.cards[k])])), enemies: b.enemies.map(one) };
}
function sqlSum(u0, cfg) {
  const clk = u0.clock;
  const f = (u, cd) => {
    const status = {};
    for (const [s, v] of Object.entries(u.status || {})) { const o = { ...v }; if (s === 'quickened') o.value = v.value ?? cfg.v2_status.quickened.x; if (s === 'focused') o.crd = v.crd ?? 0; status[s] = o; }
    return { hp: Number(u.hp), down: !!u.down, status, immune: Object.fromEntries(Object.entries(u.immune || {}).filter(([, n]) => n >= clk)), ...(cd ? { charge: u.charge, held: u.held } : {}) };
  };
  return { clock: clk, cards: Object.fromEntries(Object.entries(u0.cards).map(([k, u]) => [k, f(u, true)])), enemies: u0.enemies.map((u) => f(u, false)) };
}
function sameSum(a, b, rel = 1e-9) {
  const bad = [];
  const num = (x, y, at) => { if (Math.abs(Number(x) - Number(y)) > rel * Math.max(1, Math.abs(Number(y)))) bad.push(`${at}: SQL ${x} sim ${y}`); };
  if (a.clock !== b.clock) bad.push(`clock ${a.clock} ${b.clock}`);
  const unit = (x, y, at) => {
    num(x.hp, y.hp, `${at}.hp`); if (x.down !== y.down) bad.push(`${at}.down SQL ${x.down} sim ${y.down}`);
    if (y.charge !== undefined && (x.charge !== y.charge || (x.held ?? 0) !== (y.held ?? 0))) bad.push(`${at}.charge SQL ${x.charge}/${x.held} sim ${y.charge}/${y.held}`);
    for (const k of new Set([...Object.keys(x.status), ...Object.keys(y.status)])) {
      const p = x.status[k], q2 = y.status[k];
      if (!p || !q2) { bad.push(`${at}.status.${k}: SQL ${JSON.stringify(p)} sim ${JSON.stringify(q2)}`); continue; }
      for (const f of ['stacks', 'value', 'until', 'crd']) { if ((p[f] === undefined) !== (q2[f] === undefined)) bad.push(`${at}.${k}.${f}: SQL ${p[f]} sim ${q2[f]}`); else if (p[f] !== undefined) num(p[f], q2[f], `${at}.${k}.${f}`); }
    }
    for (const k of new Set([...Object.keys(x.immune), ...Object.keys(y.immune)])) if (x.immune[k] !== y.immune[k]) bad.push(`${at}.immune.${k}: SQL ${x.immune[k]} sim ${y.immune[k]}`);
  };
  for (const k of Object.keys(b.cards)) unit(a.cards[k], b.cards[k], `card ${k}`);
  b.enemies.forEach((e, i) => unit(a.enemies[i], e, `enemy ${i}`));
  return bad;
}
function simFight(cfg, st, script) {
  const H = simBattle(cfg, st); const { b } = H;
  b.cap = st.mode === 'hunt' ? cfg.v2_hunt.round_cap : cfg.v2_dungeon.round_cap;
  const out = []; let k = 0; let cur = null; let qd = [], qi = 0; let nearTie = false;
  const take = () => { if (qi >= qd.length) throw new Error('simulator: out of draws'); return qd[qi++]; };
  for (const u of b.units) u.rng = take;
  const STOP = new Error('stop');
  b.policy = {
    useActive: () => cur.use,
    target: (bb) => { const a = bb.alive('enemy'); return a[Math.floor(cur.tp * a.length)]; },
    allyFor: (bb) => { const a = bb.alive('card'); return a[Math.floor(cur.ap * a.length)]; },
  };
  let action = null;
  const doActive0 = b.doActive.bind(b), doBasic0 = b.doBasic.bind(b);
  b.doActive = (u, t) => { action = 'active'; return doActive0(u, t); };
  b.doBasic = (u, t) => { action = 'basic'; return doBasic0(u, t); };
  b.enemyAct = (e) => { if (!cur.hit) return; const a = b.alive('card'); const t = a[Math.floor(cur.cp * a.length)]; b.enemyHit(e, t, cur.x); };
  b.speedOf = function (u) { const sp = Battle.prototype.speedOf.call(this, u); const m = u.meter + sp; if (!u.down && m >= 50 && Math.abs(m - 100 * Math.round(m / 100)) < 1e-6) nearTie = true; return sp; };
  const act0 = Battle.prototype.act;
  const charging = new Map(b.enemies.map((e) => [e, e.charging]));
  b.act = function (u) {
    if (k >= script.length) throw STOP;
    const ms = this.units.filter((x) => !x.down).map((x) => x.meter + (x === u ? 100 : 0));
    const top = ms.filter((m) => m >= 100 - 1e-6).sort((a, c) => c - a);
    if (ms.some((m) => Math.abs(m - 100) < 1e-6) || (top.length > 1 && top[0] - top[1] < 1e-6)) nearTie = true;
    cur = script[k]; qd = cur.draws; qi = 0; action = null;
    const cs0 = this.S.controlSkips, pf0 = this.S.paraFail; const k0 = u.st.stunned ? 'stunned' : u.st.frozen ? 'frozen' : u.st.sleep ? 'sleep' : null;
    act0.call(this, u);
    // the SQL state holds "cataclysm" fixed (the Charging rules of the foes come with E7): the harness keeps the simulator's charging fixed too
    for (const [e, c] of charging) e.charging = c;
    const skip = this.S.controlSkips > cs0;
    out.push({ event: 'act', actor: H.ref(u), skip, reason: skip ? (k0 || (this.S.paraFail > pf0 ? 'paralyzed' : '?')) : null, n: qi, action, u: simSum(H), nearTie });
    k++;
  };
  try { while (!b.ended) b.tickStep(); } catch (e) { if (e !== STOP) throw e; }
  if (b.ended) out.push({ event: b.ended === 'cap' ? 'cap' : 'end', u: simSum(H), nearTie });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, the T1 answers, balance
const body1 = (t1items, t1fights) => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; v jsonb; bad text[] := '{}'; k text; b jsonb; t1a jsonb; t1c jsonb; old jsonb;
  items jsonb := ${sqlLit(t1items)}; fights jsonb := ${sqlLit(t1fights)};
begin
  ${SETUP}
  ${DRIVER}
  select value into old from balance where key = 'ability_v2';
  before := ${md5s};
  -- the T1 answers: the validator (PP of each block, card text, Silver) of T1 abilities, and T1 card actions with explicit draws
  b := ability_v2_numbers();
  select jsonb_agg(ability_v2_check(i->>0, i->1, b) order by n) into t1a from jsonb_array_elements(items) with ordinality y(i, n);
  b := combat_v2_action_numbers();
  select jsonb_agg(pg_temp.t1run(f->0, f->1, b) order by n) into t1c from jsonb_array_elements(fights) with ordinality y(f, n);
  execute $m$${mig}$m$;
  after := ${md5s};
  b := ability_v2_numbers();
  select jsonb_agg(ability_v2_check(i->>0, i->1, b) order by n) into v from jsonb_array_elements(items) with ordinality y(i, n);
  res := res || jsonb_build_object('case', 'the replaced PP (each block), validator and card text give the T1 answer on ' || jsonb_array_length(items) || ' T1 abilities without the changed parts (the 42 templates but Frost Shell, and random T1 abilities)',
    'ok', v = t1a and jsonb_array_length(items) > 300, 'got', (select jsonb_agg(jsonb_build_object('n', n, 't1', t1a->(n::int - 1), 't1b', v->(n::int - 1))) from generate_series(1, jsonb_array_length(items)) n where v->(n::int - 1) is distinct from t1a->(n::int - 1) limit 3));
  b := combat_v2_action_numbers();
  select jsonb_agg(pg_temp.t1run(f->0, f->1, b) order by n) into v from jsonb_array_elements(fights) with ordinality y(f, n);
  res := res || jsonb_build_object('case', 'the replaced card action gives the T1 answer on ' || jsonb_array_length(fights) || ' random T1 card actions with explicit draws (no payoff on an attacker with an area block)',
    'ok', v = t1c and jsonb_array_length(fights) > 50, 'got', (select jsonb_agg(n) from generate_series(1, jsonb_array_length(fights)) n where v->(n::int - 1) is distinct from t1c->(n::int - 1)));
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ') is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(before) k2 where before->k2 is distinct from after->k2));
  res := res || jsonb_build_object('case', 'NUMBERS', 'ok', true, 'b', b, 'ab', ability_v2_numbers());
  select jsonb_object_agg(p.oid::regprocedure::text, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPLACED)});
  res := res || jsonb_build_object('case', 'volatility as T1: the spec and the PP IMMUTABLE, the card action VOLATILE', 'ok',
    o = '{"ability_v2_spec()": "i", "ability_v2_block_pp(jsonb,text,numeric,jsonb)": "i", "ability_v2_pps(text,jsonb,jsonb)": "i", "combat_effect_v2_active(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)": "v"}'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPLACED)}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the replaced functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPLACED)}) and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '%combat_v2_ability_prices.sql%';
  res := res || jsonb_build_object('case', 'every replaced function has a comment that names this file', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname <> all (array[${q(T1NEW)}, ${q(E6NEW)}])
     and (p.prosrc ~ '(ability_v2_spec|ability_v2_block_pp|ability_v2_pps|combat_effect_v2_active)' or p.prosrc ~ 'ability_v2[^_]')
     and p.proname <> 'balance_check_ability_v2';
  res := res || jsonb_build_object('case', 'no other function calls the replaced functions or reads subjects.ability_v2 (no v1 caller)', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\(' and p.proname <> 'combat_v2_on';
  select value into v from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability and has no reader but combat_v2_on', 'ok',
    o = '[]'::jsonb and v = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', jsonb_build_object('readers', o, 'flag', v));
  -- balance
  select value into v from balance where key = 'ability_v2';
  res := res || jsonb_build_object('case', 'ABILITY_V2', 'ok', true, 'v', v, 'old', old);
  res := res || jsonb_build_object('case', 'balance ability_v2: the note names the T1b measurement; a balance_log update by nathan ADDS pp.vs_smite, share.self_has_each, share.area_payoff and ref.list_extra; every T1 leaf keeps its value (pp.sup_vs_k and share.self_has too)', 'ok',
    (select note like '%PR T1b%run.mjs shares%' from balance where key = 'ability_v2')
    and exists (select 1 from balance_log where key = 'ability_v2' and op = 'update' and changed_by = 'nathan' and new_value->'share' ? 'self_has_each' and not old_value->'share' ? 'self_has_each')
    and (v - 'pp' - 'share' - 'ref') = (old - 'pp' - 'share' - 'ref') and (v->'pp') - 'vs_smite' = old->'pp'
    and (v->'share') - 'self_has_each' - 'area_payoff' = old->'share' and (v->'ref') - 'list_extra' = old->'ref', 'got', jsonb_build_object('v', v, 'old', old));
  update balance set value = jsonb_set(value, '{share,self_has_each,focused}', '0.05') where key = 'ability_v2';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: a second run keeps a changed share (self_has_each.focused 0.05)', 'ok', (select (value->'share'->'self_has_each'->>'focused')::numeric = 0.05 from balance where key = 'ability_v2'));
  update balance set value = v where key = 'ability_v2';
  for k, o in select x.k, x.p from (values ('a missing status share', v #- '{share,self_has_each,focused}'), ('self_has_each one number', jsonb_set(v, '{share,self_has_each}', '0.1')),
      ('no pp.sup_vs_k (a leaf is never removed)', v #- '{pp,sup_vs_k}'), ('no pp.vs_smite', v #- '{pp,vs_smite}'), ('list_extra 1.5', jsonb_set(v, '{ref,list_extra}', '1.5')),
      ('no area_payoff', v #- '{share,area_payoff}'), ('a string share', jsonb_set(v, '{share,self_has_each,burn}', '"0.1"')), ('an unknown status', jsonb_set(v, '{share,self_has_each,zz}', '0.1'))) x(k, p) loop
    begin update balance set value = o where key = 'ability_v2'; bad := bad || k; exception when others then if sqlerrm not like 'balance ability_v2:%' then bad := bad || (k || ': ' || sqlerrm); end if; end;
  end loop;
  res := res || jsonb_build_object('case', 'the fixed shape of ability_v2 refuses 8 planted values (a missing, a wrong or an unknown status share, no pp.sup_vs_k, list_extra 1.5)', 'ok', cardinality(bad) = 0, 'bad', bad);
  -- the PP fails closed on a status with no share (a later card status without a measured share)
  b := ability_v2_numbers();
  begin
    perform ability_v2_pps('support', '[{"k": "shield", "v": 0.3}, {"k": "self_has", "status": "focused"}]'::jsonb, b #- '{ability_v2,share,self_has_each,focused}');
    res := res || jsonb_build_object('case', 'the PP of a self_has with no share raises (it never prices as NULL)', 'ok', false);
  exception when others then
    res := res || jsonb_build_object('case', 'the PP of a self_has with no share raises (it never prices as NULL)', 'ok', sqlerrm like 'ability_v2_pps: balance ability_v2 has no share for self_has focused%', 'got', sqlerrm);
  end;
  -- the library: the price words of the 5 changed rows
  select jsonb_object_agg(key, price) into o from ability_blocks where key in ('vs_status', 'payoff_dmg', 'payoff_crit', 'target_has', 'self_has');
  res := res || jsonb_build_object('case', 'the library: the price words of vs_status, payoff_dmg, payoff_crit, target_has and self_has name the T1b numbers', 'ok',
    o->>'vs_status' like '%pp.vs_smite%list_extra%' and o->>'payoff_dmg' like '%area_payoff%list_extra%' and o->>'payoff_crit' like '%area_payoff%list_extra%'
    and o->>'target_has' like '%list_extra%' and o->>'self_has' like '%self_has_each.<status>%' and (select count(*) from ability_blocks) = 42, 'got', o);
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the fixed card actions of the T1b rules
function fixedCases(B) {
  const H = B.v2_hit;
  const near = (a, b) => Math.abs(Number(a) - b) <= 1e-9 * Math.max(1, Math.abs(b));
  const roll = (d) => H.roll_min + d * H.roll_span;
  const ok = (c, msg) => (c ? true : msg);
  const c1 = Cr(1), c2 = Cr(2), e0 = En(0), e1 = En(1);
  const stt = (r, i, id = 0) => r[i].s.enemies[id].status;
  const dg = (cards, enemies, o = {}) => ({ mode: 'dungeon', cards, enemies, ...o });
  const foe = (o = {}) => ({ max: 1000, ...o });
  const A = (blocks) => ({ blocks });
  const NOCRIT = [0.99, 0.5, 0.99], CRIT03 = [0.99, 0.5, 0.3];
  const burn = { burn: { stacks: 1 } }, blind = { blinded: { until: 9 } };
  return [
    ['payoff_dmg on an attacker with an area block: each area hit adds the payoff when THAT enemy has the status; an enemy without it gets none',
      dg({ 1: { role: 'breaker', charge: 2, active: A([{ k: 'hit', x: 1 }, { k: 'area', x: 0.5 }, { k: 'payoff_dmg', status: 'burn', v: 0.5 }]) } }, [foe({ status: burn }), foe({ status: burn }), foe()]),
      [act(c1, { target: e0, use: true, draws: [...NOCRIT, ...NOCRIT, ...NOCRIT] })],
      (r) => ok(r[0].hits.length === 3 && near(r[0].hits[0].dmg, 100 * roll(0.5) * 1.5) && near(r[0].hits[1].dmg, 100 * 0.5 * roll(0.5) * 1.5) && near(r[0].hits[2].dmg, 100 * 0.5 * roll(0.5)),
        JSON.stringify(r[0].hits))],
    ['the area payoff reads each enemy, not the main target: a main target with no Burn still pays on a Burning area enemy',
      dg({ 1: { role: 'breaker', charge: 2, active: A([{ k: 'hit', x: 1 }, { k: 'area', x: 0.5 }, { k: 'payoff_dmg', statuses: ['poison', 'burn'], v: 0.5 }]) } }, [foe(), foe({ status: burn })]),
      [act(c1, { target: e0, use: true, draws: [...NOCRIT, ...NOCRIT] })],
      (r) => ok(near(r[0].hits[0].dmg, 100 * roll(0.5)) && near(r[0].hits[1].dmg, 100 * 0.5 * roll(0.5) * 1.5), JSON.stringify(r[0].hits))],
    ['payoff_crit on an attacker with an area block: each area hit has the crit bonus only when THAT enemy has the status (E6 and T1: the bonus of the main target)',
      dg({ 1: { role: 'breaker', crt: 0, charge: 2, active: A([{ k: 'hit', x: 1 }, { k: 'area', x: 0.5 }, { k: 'payoff_crit', status: 'blinded', v: 0.5 }]) } }, [foe({ status: blind }), foe(), foe({ status: blind })]),
      [act(c1, { target: e0, use: true, draws: [...CRIT03, ...CRIT03, ...CRIT03] })],
      (r) => ok(r[0].hits.length === 3 && r[0].hits[0].crit && !r[0].hits[1].crit && r[0].hits[2].crit, JSON.stringify(r[0].hits))],
    ['a gate that does not hold turns the payoff off on the area hits too (self_has Empowered: the first card is not, the second card is)',
      dg({ 1: { role: 'breaker', charge: 2, active: A([{ k: 'hit', x: 1 }, { k: 'area', x: 0.5 }, { k: 'payoff_dmg', status: 'burn', v: 0.5 }, { k: 'self_has', status: 'empowered' }]) },
        2: { role: 'breaker', charge: 2, status: { empowered: { value: 0.2 } }, active: A([{ k: 'hit', x: 1 }, { k: 'area', x: 0.5 }, { k: 'payoff_dmg', status: 'burn', v: 0.5 }, { k: 'self_has', status: 'empowered' }]) } },
      [foe({ status: burn }), foe({ status: burn })]),
      [act(c1, { target: e0, use: true, draws: [...NOCRIT, ...NOCRIT] }), act(c2, { target: e0, use: true, draws: [...NOCRIT, ...NOCRIT] })],
      (r) => ok(near(r[0].hits[1].dmg, 100 * 0.5 * roll(0.5)) && near(r[1].hits[1].dmg, 100 * 0.5 * roll(0.5) * 1.2 * 1.5), JSON.stringify(r.map((x) => x.hits)))],
    ['on_kill (decision 4): the status goes to the next standing enemy in the FIXED order (here the first one), not to the enemy with the lowest HP',
      dg({ 1: { charge: 2, active: A([{ k: 'hit', x: 1.5 }, { k: 'on_kill', status: 'slowed', chance: 0.5 }]) } }, [foe(), foe({ hp: 10 }), foe({ hp: 50 })]),
      [act(c1, { target: e1, use: true, draws: [...NOCRIT, 0.1] })],
      (r) => ok(r[0].s.enemies[1].down && stt(r, 0, 0).slowed && !stt(r, 0, 2).slowed && r[0].draws.length === 4, JSON.stringify(r[0].s.enemies.map((e) => [e.hp, e.status])))],
  ];
}

// ---------------------------------------------------------------------------------------------------------------- the prices of the decisions, from the balance numbers
function priceCases(B, AB) {
  const P = AB.v2_pp, R = P.ref, A = AB.ability_v2, S = A.share;
  const C = (cls) => B.v2_charge[cls] + 1, k = A.pp.att_k / C('attacker'), sk = A.pp.sup_cycle / C('support');
  const L = (base, n) => Math.min(1, base + A.ref.list_extra * (n - 1));
  const fp = R.frozen_share * R.payoff;
  return [
    ['1a a support vs_status grows with the smite: smite price x 1.7 x (x - 1) x pp.vs_smite x the list share of 3 controls', 'artillery', [{ k: 'smite', x: 1.7 }, { k: 'vs_status', statuses: ['stunned', 'frozen', 'sleep'], x: 2 }],
      1, P.support_pp.smite * 1.7 * 1 * A.pp.vs_smite * L(fp, 3) * sk],
    ['1a the same rule on one status and a smaller smite (Frost Shell)', 'artillery', [{ k: 'smite', x: 1.52 }, { k: 'vs_status', status: 'frozen', x: 2 }, { k: 'apply', status: 'chill', chance: 1, stacks: 1 }],
      1, P.support_pp.smite * 1.52 * 1 * A.pp.vs_smite * fp * sk],
    ['2 self_has: the share of its status (Focused)', 'warden', [{ k: 'shield', v: 0.3 }, { k: 'self_has', status: 'focused' }], 1, P.support_pp.shield * 0.3 * sk * (S.self_has_each.focused - 1)],
    ['2 self_has: the share of its status (Empowered)', 'warden', [{ k: 'shield', v: 0.3 }, { k: 'self_has', status: 'empowered' }], 1, P.support_pp.shield * 0.3 * sk * (S.self_has_each.empowered - 1)],
    ['2 self_has: the share of its status (Weakened)', 'striker', [{ k: 'hit', x: 1.3 }, { k: 'pierce', v: 0.5 }, { k: 'self_has', status: 'weakened' }], 2,
      k * 0.5 * R.enemy_def / (1 - R.enemy_def) * (S.self_has_each.weakened - 1)],
    ['3 a list of 2 on payoff_dmg: payoff + list_extra', 'breaker', [{ k: 'hit', x: 1.45 }, { k: 'payoff_dmg', statuses: ['stunned', 'sleep'], v: 0.5 }], 1, k * 0.5 * L(R.payoff, 2)],
    ['3 a list of 3 on payoff_crit: payoff + 2 x list_extra', 'striker', [{ k: 'hit', x: 1.3 }, { k: 'payoff_crit', statuses: ['poison', 'burn', 'chill'], v: 0.3 }], 1, k * 0.3 * L(R.payoff, 3)],
    ['3 a list of 2 on target_has (not controls)', 'warden', [{ k: 'shield', v: 0.3 }, { k: 'target_has', statuses: ['slowed', 'blinded'], x: 1.5 }], 1, P.support_pp.shield * 0.3 * sk * 0.5 * L(R.payoff, 2)],
    ['3 a list of 2 controls on target_has: frozen_share x payoff + list_extra', 'warden', [{ k: 'shield', v: 0.3 }, { k: 'target_has', statuses: ['stunned', 'sleep'], x: 2 }], 1, P.support_pp.shield * 0.3 * sk * 1 * L(fp, 2)],
    ['3 a list of 1 costs as one status', 'breaker', [{ k: 'hit', x: 1.45 }, { k: 'payoff_dmg', statuses: ['burn'], v: 0.5 }], 1, k * 0.5 * R.payoff],
    ['5 payoff_dmg with an area block: x (1 + area x foes_other x area_payoff)', 'cleaver', [{ k: 'hit', x: 1.2 }, { k: 'area', x: 0.45 }, { k: 'payoff_dmg', status: 'burn', v: 0.3 }], 2,
      k * 0.3 * R.payoff * (1 + 0.45 * R.foes_other * S.area_payoff)],
    ['5 payoff_crit with an area block: the same factor', 'cleaver', [{ k: 'hit', x: 1.25 }, { k: 'area', x: 0.4 }, { k: 'payoff_crit', status: 'blinded', v: 0.3 }], 2,
      k * 0.3 * R.payoff * (1 + 0.4 * R.foes_other * S.area_payoff)],
    ['5 no area block: no factor', 'striker', [{ k: 'hit', x: 1.45 }, { k: 'payoff_dmg', status: 'exposed', v: 0.5 }], 1, k * 0.5 * R.payoff],
  ];
}
// The cap of the list share binds only with a bigger list_extra: the "changed numbers" run (list_extra 0.3): 0.6 + 2 x 0.3 > 1.
const CAP_CASE = ['striker', [{ k: 'hit', x: 1.3 }, { k: 'payoff_crit', statuses: ['poison', 'burn', 'chill'], v: 0.3 }]];

// ---------------------------------------------------------------------------------------------------------------- the fuzz and the replay
const fuzzBlock = (specs) => String.raw`do $t$
declare b jsonb; s jsonb; r jsonb; x jsonb; ac jsonb; f int := 0; j int; bad jsonb := '[]'; n int := 0; na int := 0; lst text[]; t jsonb; al jsonb; u0 jsonb; usex boolean; c int; rp jsonb; same int := 0;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_action_numbers();
  perform setseed(0.71);
  for x in select v from jsonb_array_elements(${sqlLit(specs)}::jsonb) v loop
    s := x; f := f + 1;
    for j in 1 .. 200 loop
      begin
        r := combat_v2_next(s, null, b); s := r->'state';
        exit when r->>'event' <> 'act';
        continue when (r->>'skip')::boolean or r->'actor'->>'side' <> 'card';
        ac := r->'actor';
        lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
        t := jsonb_build_object('side', 'enemy', 'id', lst[floor(random() * cardinality(lst))::int + 1]::numeric);
        lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
        al := jsonb_build_object('side', 'card', 'id', lst[floor(random() * cardinality(lst))::int + 1]::numeric);
        u0 := s #> combat_v2_unit_path(s, ac);
        c := (b->'v2_charge'->>(u0->>'class'))::int;
        usex := random() < 0.8 and coalesce((u0->>'charge')::int, 0) >= c;
        r := combat_v2_card_act(s, ac, jsonb_build_object('use', usex, 'target', t, 'ally', al), b);
        rp := combat_v2_card_act(s, ac, jsonb_build_object('use', usex, 'target', t, 'ally', al, 'draws', r->'draws'), b);
        if rp->'state' = r->'state' and rp->'draws' = r->'draws' then same := same + 1; else bad := bad || to_jsonb('replay differs'::text); end if;
        s := r->'state'; n := n + 1; if usex then na := na + 1; end if;
      exception when others then bad := bad || to_jsonb('error: ' || sqlerrm); exit;
      end;
      if cardinality(fight_state_check_v2(s)) > 0 then bad := bad || to_jsonb('state: ' || array_to_string(fight_state_check_v2(s), '; ')); end if;
      for u0 in select v2 from jsonb_each(s->'cards') e(k2, v2) union all select v2 from jsonb_array_elements(s->'enemies') v2 loop
        if (u0->>'hp')::numeric < 0 or (u0->>'hp')::numeric > (u0->>'max')::numeric then bad := bad || to_jsonb('hp ' || u0::text); end if;
        if ((u0->>'down')::boolean or (u0->>'hp')::numeric <= 0) and (u0->'status' <> '{}'::jsonb or not (u0->>'down')::boolean) then bad := bad || to_jsonb('down ' || u0::text); end if;
      end loop;
      exit when jsonb_array_length(bad) > 5;
    end loop;
    exit when jsonb_array_length(bad) > 5;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('fights', f, 'actions', n, 'actives', na, 'replay_same', same, 'bad', bad)::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- run
const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - b) <= rel * Math.max(1, Math.abs(b));
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
// The parts that this file changes: a support vs_status, a list of 2 or more statuses, self_has, and a payoff on an attacker with an area block.
const changed = (cls, blocks) => blocks.some((b) => (cls === 'support' && b.k === 'vs_status') || (Array.isArray(b.statuses) && b.statuses.length > 1 && b.k !== 'cure' && b.k !== 'line_status')
  || b.k === 'self_has' || (cls === 'attacker' && ['payoff_dmg', 'payoff_crit'].includes(b.k) && blocks.some((y) => y.k === 'area')));
try {
  const CONFIG = loadConfig();
  // T1 inputs for "the replaced functions answer the T1 answer": the templates and random T1 abilities without the changed parts; random T1 card actions
  const tids = Object.keys(CONFIG.v2_templates).filter((k) => !k.startsWith('_'));
  const rngT = mkRng(707); const t1abs = [];
  while (t1abs.length < 320) { const role = ROLES[t1abs.length % 12]; const bl = genAbility(rngT, classOf(role)); if (!changed(classOf(role), bl)) t1abs.push([role, { name: 'Zz', blocks: bl }]); }
  const t1items = [...tids.filter((t) => !changed(classOf(CONFIG.v2_templates[t].role), CONFIG.v2_templates[t].blocks)).map((t) => [CONFIG.v2_templates[t].role, { name: CONFIG.v2_templates[t].name, blocks: CONFIG.v2_templates[t].blocks }]), ...t1abs];
  const t1fights = fightSpecs(24, 919, { v2_speed: CONFIG.v2_speed }).flatMap(([st, script]) => {
    const s2 = JSON.parse(JSON.stringify(st));
    for (const c of Object.values(s2.cards)) { if (c.class === 'attacker' && c.active.blocks.some((b) => b.k === 'area')) c.active.blocks = c.active.blocks.filter((b) => !['payoff_dmg', 'payoff_crit'].includes(b.k)); c.charge = 2; }
    for (const e of s2.enemies) delete e.cataclysm;
    return Object.keys(s2.cards).map((id, j) => [s2, [act(Cr(Number(id)), { target: En(0), use: j % 3 !== 2, ally: Cr(Number(Object.keys(s2.cards)[0])), draws: script[j].draws })]]);
  });
  const results = JSON.parse(await runBlock(body1(t1items, t1fights)));
  const NUM = results.find((r) => r.case === 'NUMBERS'); const B = NUM.b, AB = NUM.ab;
  for (const r of results.filter((x) => !['NUMBERS', 'ABILITY_V2'].includes(x.case))) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
  const leaves = (o, p = []) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).filter(([k]) => !k.startsWith('_')).flatMap(([k, v]) => leaves(v, [...p, k])) : [[p.join('.'), JSON.stringify(o)]]);
  const bal = new Map(leaves(results.find((r) => r.case === 'ABILITY_V2').v)), cfgL = new Map(leaves(CONFIG.ability_v2).filter(([p]) => p !== 'limits.min_share')); // limits.min_share: combat_v2_min_share.sql
  const lp = [...bal].filter(([p, v]) => cfgL.get(p) !== v).concat([...cfgL].filter(([p]) => !bal.has(p)));
  say(lp.length === 0 && bal.size === 36 && bal.has('share.self_has_each.focused') && bal.has('pp.vs_smite') && bal.has('pp.sup_vs_k') && bal.has('share.self_has'),
    `balance ability_v2 = config.json ability_v2 (${bal.size} leaves equal: + pp.vs_smite, share.self_has_each for 15 statuses, share.area_payoff, ref.list_extra; one number, one home)`, JSON.stringify(lp));
  // the simulator takes the balance of the database (ability_v2 as a whole: its shape decides the rule)
  const cfg = patch(CONFIG, { ...B, v2_pp: AB.v2_pp, v2_stats: AB.v2_stats }); cfg.ability_v2 = JSON.parse(JSON.stringify(AB.ability_v2));

  // the fixed card actions
  const FIX = fixedCases(B);
  const rows = await runOps(FIX.map((f) => [state(f[1]), f[2]]));
  FIX.forEach(([name, , , check], i) => {
    const r = rows[i]; const err = r.find((x) => x.error && !/not charged/.test(x.error));
    let res; try { res = err ? `error ${err.error}` : check(r, B); } catch (e) { res = `check raised: ${e.message} ${JSON.stringify(r.map((x) => x.error || x.action))}`; }
    say(res === true, `fixed: ${name}`, String(res).slice(0, 900));
  });
  // the same fixed actions in the simulator: SQL = the simulator on every hit
  const simRows = FIX.map(([, sc, ops]) => { const st = state(sc); const H = simBattle(cfg, st); const out = [];
    for (const op of ops) { if (op.op !== 'act') continue; const u = H.b.cards[cardOrder(st).indexOf(String(op.a.id))]; const t = H.b.enemies[op.o.target.id]; const dr = [...op.o.draws]; let qi = 0;
      for (const x of H.b.units) x.rng = () => (qi < dr.length ? dr[qi++] : 0.5);
      const hits = []; const ch0 = Battle.prototype.cardHit; H.b.cardHit = function (src, tgt, o) { const r = ch0.call(this, src, tgt, o); if (src === u) hits.push({ dmg: r.dealt, crit: r.crit }); return r; };
      H.b.doActive(u, t); out.push(hits); }
    return out; });
  const sqlHits = rows.map((r) => r.filter((x) => x.hits).map((x) => x.hits.map((h) => ({ dmg: Number(h.dmg), crit: !!h.crit }))));
  const hbad = []; simRows.forEach((sr, i) => sr.forEach((hs, j) => { const sq = sqlHits[i][j] || []; if (hs.length !== sq.length || hs.some((h, k) => !near(h.dmg, sq[k].dmg) || h.crit !== sq[k].crit)) hbad.push(`${FIX[i][0].slice(0, 40)}: SQL ${JSON.stringify(sq)} sim ${JSON.stringify(hs)}`); }));
  say(hbad.length === 0, `the simulator gives the same hits (damage and crit) on the ${FIX.length} fixed card actions`, hbad.join(' | '));

  // the prices of the decisions from the balance numbers, and SQL = the simulator on random abilities
  const PC = priceCases(B, AB);
  const rng = mkRng(4712); const RAND = Array.from({ length: Number(process.env.V2_PP || 1500) }, (_, i) => { const role = ROLES[i % 12]; return { role, cls: classOf(role), blocks: genAbility(rng, classOf(role)) }; });
  const chk = await runChecks([...PC.map((x) => ['pps', classOf(x[1]), x[2]]), ...RAND.map((x) => ['pps', x.cls, x.blocks]), ...RAND.map((x) => ['ppsx', x.cls, x.blocks]), ['ppsx', 'attacker', CAP_CASE[1]]]);
  const cRes = chk.slice(0, PC.length), pRes = chk.slice(PC.length, PC.length + RAND.length), xRes = chk.slice(PC.length + RAND.length, PC.length + 2 * RAND.length), capRes = chk[chk.length - 1];
  const cwrong = PC.map(([name, , , j, want], i) => (near(cRes[i].pps[j], want) ? null : `${name}: SQL ${cRes[i].pps[j]} want ${want}`)).filter(Boolean);
  say(cwrong.length === 0, `the prices of the decisions from the balance numbers (${PC.length} cases: 1a the support vs_status on the smite, 2 self_has per status, 3 the list share, 5 the payoff on area hits)`, cwrong.join(' | '));
  say(near(capRes.pps[1], AB.ability_v2.pp.att_k / (B.v2_charge.attacker + 1) * 0.3 * 1), 'the list share is at most 1 (list_extra 0.3: 0.6 + 2 x 0.3 is priced as 1: a condition never costs more than the block with no condition)', JSON.stringify(capRes));
  let pmax = 0; const pbad = []; const kinds = new Set(); const feat = { sup_vs: 0, list: 0, self_has: new Set(), area_payoff: 0, area_crit: 0 };
  RAND.forEach((x, i) => {
    const id = `rand.${i}`; const c2 = { ...cfg, v2_templates: { ...cfg.v2_templates, [id]: { role: x.role, name: 'r', blocks: x.blocks } } };
    x.blocks.forEach((b, j) => { kinds.add(b.k); const a = blockPP(c2, id, b), s = Number(pRes[i].pps[j]); const d = Math.abs(a - s) / Math.max(1, Math.abs(a)); pmax = Math.max(pmax, d);
      if (!near(s, a)) pbad.push(`${id} block ${j + 1} ${b.k}: SQL ${s} sim ${a}`);
      if (x.cls === 'support' && b.k === 'vs_status') feat.sup_vs++; if (Array.isArray(b.statuses) && b.statuses.length > 1 && !['cure', 'line_status'].includes(b.k)) feat.list++;
      if (b.k === 'self_has') feat.self_has.add(b.status); if (x.cls === 'attacker' && x.blocks.some((y) => y.k === 'area')) { if (b.k === 'payoff_dmg') feat.area_payoff++; if (b.k === 'payoff_crit') feat.area_crit++; } });
    if (!near(pRes[i].pps.reduce((s, v) => s + Number(v), 0), templatePP(c2, id))) pbad.push(`${id} total`);
  });
  say(pbad.length === 0 && feat.sup_vs >= RAND.length / 75 && feat.list >= RAND.length / 30 && feat.self_has.size >= 14 && feat.area_payoff >= RAND.length / 75 && feat.area_crit >= RAND.length / 150,
    `SQL = the simulator on the PP of every block of ${RAND.length} random abilities (${kinds.size} block kinds; ${feat.sup_vs} support vs_status, ${feat.list} lists, self_has on ${feat.self_has.size} statuses, ${feat.area_payoff} payoff_dmg and ${feat.area_crit} payoff_crit with an area block; the largest relative difference ${pmax.toExponential(1)})`, pbad.slice(0, 5).join(' | '));
  // the same with changed numbers: every T1b number at another value (and ref.kinds, crd.base as in T1): a rule that reads the wrong number shows
  const cfgX = patch(cfg, { v2_pp: { ref: { kinds: 2.1 } }, v2_stats: { crd: { base: 2.4 } }, ability_v2: { ref: { list_extra: 0.3 }, share: { area_payoff: 0.2, self_has_each: { focused: 0.5 } }, pp: { vs_smite: 0.7 } } });
  const xbad = [];
  RAND.forEach((x, i) => { const id = `rand.${i}`; const c2 = { ...cfgX, v2_templates: { ...cfgX.v2_templates, [id]: { role: x.role, name: 'r', blocks: x.blocks } } };
    x.blocks.forEach((b, j) => { const a = blockPP(c2, id, b), sq = Number(xRes[i].pps[j]); if (!near(sq, a)) xbad.push(`${id} block ${j + 1} ${b.k}: SQL ${sq} sim ${a}`); }); });
  say(xbad.length === 0, 'SQL = the simulator on the same PP with changed numbers (list_extra 0.3, area_payoff 0.2, vs_smite 0.7, self_has_each.focused 0.5, ref.kinds 2.1, crd.base 2.4)', xbad.slice(0, 5).join(' | '));

  // the private Set 1 batch (never in this repo)
  const BATCH = process.env.T1_SET1_BATCH || 'C:/Users/vaugh/discord-card-ideas/batches/set1-t1.json';
  if (existsSync(BATCH)) {
    const rows1 = JSON.parse(readFileSync(BATCH, 'utf8')).rows;
    const r1 = await runChecks(rows1.map((r) => [r.role, r.ability]));
    const accepted = r1.filter((x) => x.ok).length;
    const md = 'C:/Users/vaugh/discord-card-ideas/card-texts-v2.md'; let same = null;
    if (existsSync(md)) {
      const names = new Map(loadFixture().subjects.map((s) => [s.key, s.name])); const ap = new Map();
      for (const line of readFileSync(md, 'utf8').split(/\r?\n/)) { const c = line.split('|').map((x) => x.trim()); if (c.length > 8 && /^\d+$/.test(c[1])) { const m = c[4].match(/^\*\*(.+?):\*\* (.*)$/); if (m) ap.set(c[2], m[2]); } }
      same = rows1.filter((r, i) => r1[i].text === ap.get(names.get(r.key))).length;
    }
    say(rows1.length === 130 && accepted >= 127,
      `the private Set 1 actives (the T1 batch with the numbers of 1b and 1c): the validator accepts ${accepted} of ${rows1.length}; the generated text equals the approved text for ${same ?? '?'} of ${rows1.length}`,
      JSON.stringify(r1.map((x, i) => (x.ok ? null : [rows1[i].role, x.errors])).filter(Boolean)));
  } else console.log('SKIP the private Set 1 actives: the private batch file is missing (it never goes into this repo)');

  // SQL = the simulator on random fights with T1b actives
  const FS = fightSpecs(Number(process.env.V2_FIGHTS || 120), 6262, B);
  const areaPayFights = FS.filter(([st]) => Object.values(st.cards).some((c) => c.class === 'attacker' && c.active.blocks.some((b) => b.k === 'area') && c.active.blocks.some((b) => ['payoff_dmg', 'payoff_crit'].includes(b.k)))).length;
  let fsame = 0, ftie = 0, facts = 0; const fbad = []; const fev = { end: 0, cap: 0, skip: 0, active: 0, basic: 0 };
  for (let i = 0; i < FS.length; i += 10) {
    const part = FS.slice(i, i + 10);
    const out = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
      ${SETUP}
      execute $m$${mig}$m$;
      ${FIGHT_DRIVER}
      b := combat_v2_action_numbers();
      for x in select v from jsonb_array_elements(${sqlLit(part)}::jsonb) v loop
        begin out := out || jsonb_build_array(pg_temp.t1fight(x->0, x->1, b));
        exception when others then out := out || jsonb_build_array(jsonb_build_array(jsonb_build_object('event', 'error', 'error', sqlerrm))); end;
      end loop;
      raise exception 'RESULT:%', out::text; end $t$;`));
    out.forEach((sq, j) => {
      const [st, script] = part[j]; let sim;
      try { sim = simFight(cfg, st, script); } catch (e) { fbad.push(`fight ${i + j}: simulator error ${e.message}`); return; }
      let diff = null;
      for (let k = 0; k < Math.max(sq.length, sim.length); k++) {
        const a = sq[k], w = sim[k];
        if (a && a.event === 'error') { diff = { k, msg: `SQL error ${a.error}`, tie: false }; break; }
        if (!a || !w) { diff = { k, msg: `length SQL ${sq.length} sim ${sim.length}`, tie: (sim[Math.min(k, sim.length - 1)] || {}).nearTie }; break; }
        const m = [];
        if (a.event !== w.event) m.push(`event SQL ${a.event} sim ${w.event}`);
        if (a.event === 'act') {
          if (JSON.stringify(canon(a.actor)) !== JSON.stringify(canon(w.actor))) m.push(`actor SQL ${JSON.stringify(a.actor)} sim ${JSON.stringify(w.actor)}`);
          if (!!a.skip !== !!w.skip || (a.skip && a.reason !== w.reason)) m.push(`skip SQL ${a.skip} ${a.reason} sim ${w.skip} ${w.reason}`);
          if ((a.action ?? null) !== (w.action ?? null)) m.push(`action SQL ${a.action} sim ${w.action}`);
          if (a.n !== w.n) m.push(`draws SQL ${a.n} sim ${w.n}`);
        }
        m.push(...sameSum(sqlSum(a.u, cfg), w.u));
        if (m.length) { diff = { k, msg: m.slice(0, 3).join('; '), tie: w.nearTie }; break; }
        if (a.event === 'act') { facts++; if (a.skip) fev.skip++; if (a.action) fev[a.action]++; }
        else fev[a.event] = (fev[a.event] || 0) + 1;
      }
      if (!diff) fsame++; else if (diff.tie) ftie++; else if (fbad.length < 5) fbad.push(`fight ${i + j} action ${diff.k}: ${diff.msg}`); else fbad.push('');
    });
  }
  say(fsame + ftie === FS.length && fbad.length === 0 && areaPayFights >= FS.length / 12, `SQL = the simulator on ${FS.length} random fights with T1b actives (${areaPayFights} with an area attacker that has a payoff): ${fsame} equal action by action (${facts} actions: ${fev.active} actives, ${fev.basic} basic attacks, ${fev.skip} skips; ${fev.end} end, ${fev.cap} cap), ${ftie} differ only after a float near-tie of the simulator`,
    fbad.filter(Boolean).join(' | '));
  say(ftie <= Math.ceil(FS.length * 0.05) && fev.active >= 2.5 * FS.length, `the fights reach many actives (${fev.active}) and the near-ties are rare (${ftie} of ${FS.length})`);

  // the fuzz and the replay
  const fz = JSON.parse(await runBlock(fuzzBlock(fightSpecs(Number(process.env.V2_FUZZ || 40), 779, B).map((x) => x[0]))));
  say(fz.bad.length === 0 && fz.actions >= 8 * fz.fights && fz.actives >= 2 * fz.fights && fz.replay_same === fz.actions,
    `fuzz: ${fz.actions} random card actions with T1b actives (${fz.actives} actives) with random(): fight_state_check_v2, HP in [0, max], a down unit has no status; a replay with the answer's draws gives the same action (${fz.replay_same})`,
    JSON.stringify(fz).slice(0, 900));
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
