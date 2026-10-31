import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_ability_builder.sql (combat v2 phase 3, PR T1: the new ability blocks of 2026-10-20 and subjects.ability_v2).
 * NO lasting change: every request is one DO block, undone by its final RAISE. V1, E1 to E6 and this file run inside each block (all idempotent), so the
 * test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-t1.mjs     must PASS
 *   MUTATE=<name> ...                                                                       must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                          the baseline (must PASS), then every mutation, one line each
 * The reference is the simulator card-studio/v2sim (cards.mjs blockPP, engine.mjs doActive) with the numbers of the database.
 * Invariants:
 *   1. No change in play: the md5 of every other public function is the same after the file, except the E6 functions that it replaces, whose answers on
 *      E6 abilities (the 42 templates, random E6 abilities, random E6 card actions) are the E6 answers. No v1 function calls a new or replaced function
 *      or reads subjects.ability_v2. The flag stays OFF. Volatility, server only, comments, the file runs twice.
 *   2. Balance: ability_v2 = config.json ability_v2 (every leaf, with share and ref), the fixed shape refuses planted shares, a second run keeps a change.
 *   3. The library: no reserved row is left; every T1 part is a row; attach and hosts.
 *   4. The validator refuses every planted bad T1 ability with its own message.
 *   5. SQL = the simulator: the PP of every block of random T1 abilities; random FIGHTS with T1 actives action by action (actor, skips, unit states,
 *      draw counts).
 *   6. The fixed cases with explicit draws: each T1 rule (on_kill, random_apply, the 4 gates, target_has, ally_below, more_per, coin, apply per, "to",
 *      lifesteal to, per_ally, status lists, the support payoff and crit chance on the smite).
 *   7. The card text of every T1 pattern (synthetic abilities).
 *   8. The storage: subjects.ability_v2 takes a valid ability, refuses a bad one, NULL passes.
 *   9. The private Set 1 actives (when the private batch file exists, never in this repo): the counts of accepted and of texts equal to the approved text.
 *  10. The fuzz: random T1 actions with random(): fight_state_check_v2, HP in [0, max], a down unit has no status, a replay gives the same action.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { mini, dummyFoe } from '../v2sim/checks.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { ROLES, classOf, templatePP, blockPP, scaledFields } from '../v2sim/cards.mjs';
import { loadConfig, patch, mkRng, loadFixture } from '../v2sim/util.mjs';
assertLocal('test-combat-v2-t1.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const V1 = read('combat_v2_flags_balance.sql');
const E1 = read('combat_v2_statuses_roles.sql');
const E2 = read('combat_v2_turn_meter.sql');
const E3 = read('combat_v2_stats.sql');
const E4 = read('combat_v2_hit.sql');
const E5 = read('combat_v2_status_rules.sql');
const E6 = read('combat_v2_abilities.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_ability_builder.sql');

const MUT = {
  // the PP
  pp_gate_share: ["      v := hp * ((av->'share'->>k)::numeric - 1);", "      v := hp * ((av->'share'->>k)::numeric);"],
  pp_target_has_control: ["where coalesce(p_b->'statuses'->z->>'immunity', '') <> 'control') then (r->>'frozen_share')::numeric else 1 end;", "where false) then (r->>'frozen_share')::numeric else 1 end;"],
  pp_ally_below_line: ["      v := hp * ((blk->>'x')::numeric - 1) * (blk->>'line')::numeric;", "      v := hp * ((blk->>'x')::numeric - 1);"],
  pp_more_per_ref: ["* case when blk ? 'status' then (r->>'stacks')::numeric else (r->>'kinds')::numeric end * (r->>'payoff')::numeric;", "* (r->>'stacks')::numeric * (r->>'payoff')::numeric;"],
  pp_coin_chance: ["- hp) * (1 - (blk->>'chance')::numeric);", "- hp) * (blk->>'chance')::numeric;"],
  pp_crit_add_crd: ["* (blk->>'v')::numeric * ((p_b->'v2_stats'->'crd'->>'base')::numeric - 1) * sk;", "* (blk->>'v')::numeric * sk;"],
  pp_per_own: ["           * (own + case when blk->>'per' = 'kinds'", "           * (0 + case when blk->>'per' = 'kinds'"],
  pp_per_ally_ref: ["when 'per_ally' then k * v * (p_b->'ability_v2'->'ref'->>'per_ally')::numeric", "when 'per_ally' then k * v"],
  pp_on_kill_share: ["when 'on_kill' then sv * ch * (p_b->'ability_v2'->'share'->>'on_kill')::numeric", "when 'on_kill' then sv * ch * (r->>'crit_share')::numeric"],
  pp_random_mean: ["    select avg((p_b->'v2_pp'->'status_pp'->>(o->>'status'))::numeric", "    select max((p_b->'v2_pp'->'status_pp'->>(o->>'status'))::numeric"],
  pp_support_payoff: ["else (su->>'smite')::numeric * v * sk * (r->>'payoff')::numeric end", "else (su->>'smite')::numeric * v * sk end"],
  // the validator
  host_rule_off: ["      elsif not row->'hosts' ? hk then errs := errs ||", "      elsif false then errs := errs ||"],
  attach_first_off: ["      if host is null then errs := errs || format('%s: needs a block before it (its host)', at);", "      if host is null then null;"],
  one_attach_off: ["      elsif bl->hk->>'attach' is not null then errs := errs || format('%s: one attachment for each block (block %s is one)', at, i);", "      elsif false then null;"],
  status_or_list_off: ["    if row->'fields' ? 'statuses' and (blk ? 'status') = (blk ? 'statuses') then", "    if false then"],
  random_rider_off: ["    if k = 'random_apply' then riders := riders + 1; end if;", ''],
  support_smite_off: ["    if cls = 'support' and k in ('payoff_dmg', 'crit_add') and not exists", "    if false and not exists"],
  per_value_off: ["      if k = 'apply' and blk ? 'per' and (cls <> 'support' or not blk ? 'value') then", "      if false then"],
  options_value_off: ["      if p_st->s->>'stacking' in ('add_cap', 'higher') then return format('an option: %s needs a value (not in a random option)', s); end if;\n", ''],
  self_has_shield_off: ["    return case when s in ('shielded', 'guarded') then 'a shield: use the block self_shield' end;", '    return null;'],
  // the card action
  gate_ignored_attacker: ["      continue when att is not null and p_b->'blocks'->(att->>'k')->>'attach' = 'gate' and not combat_effect_v2_gate(s, u, tu, att);\n      if k = 'hit'", "      if k = 'hit'"],
  gate_ignored_support: ["    continue when att is not null and p_b->'blocks'->(att->>'k')->>'attach' = 'gate' and not combat_effect_v2_gate(s, u, tu, att);\n    -- the ally", "    -- the ally"],
  charging_inverted: ["    when 'enemy_charging' then coalesce((p_tgt->>'cataclysm')::boolean, false)", "    when 'enemy_charging' then not coalesce((p_tgt->>'cataclysm')::boolean, false)"],
  foes_alive_ge1: ["combat_v2_up(p_state->'enemies'->(q.id::int))) > 1\n", "combat_v2_up(p_state->'enemies'->(q.id::int))) > 0\n"],
  on_kill_on_target: ["              r := combat_v2_status_apply(s, nx, blk->>'status'", "              r := combat_v2_status_apply(s, p_target, blk->>'status'"],
  on_kill_off: ["      if jsonb_array_length(onkill) > 0 and not combat_v2_up(s #> tpath) then", "      if false then"],
  random_first_option: ["              op := blk->'options'->(floor(dv * jsonb_array_length(blk->'options'))::int);\n              r := combat_v2_status_apply(s, p_target, op->>'status', (op - 'status')",
    "              op := blk->'options'->0;\n              r := combat_v2_status_apply(s, p_target, op->>'status', (op - 'status')"],
  coin_after_crit: ["  if ak = 'coin' then\n    d := combat_v2_draw(p_draws, 0); used := used || to_jsonb(d);\n    if d >= (p_att->>'chance')::numeric then v := (p_att->>'alt')::numeric; end if;",
    "  if ak = 'coin' then\n    d := combat_v2_draw(p_draws, 0); used := used || to_jsonb(d);\n    if d < (p_att->>'chance')::numeric then v := (p_att->>'alt')::numeric; end if;"],
  more_per_except_off: ["combat_effect_v2_count(p_tgt, p_att->>'status', case when p_blk->>'k' = 'apply' then p_blk->>'status' end, p_clk, p_b);", "combat_effect_v2_count(p_tgt, p_att->>'status', null, p_clk, p_b);"],
  target_has_off: ["  if ak = 'target_has' and combat_effect_v2_has(p_tgt, p_att, p_clk) then v := v * (p_att->>'x')::numeric; end if;\n", ''],
  ally_below_off: ["  if ak = 'ally_below' and p_ally is not null and (p_ally->>'hp')::numeric / (p_ally->>'max')::numeric < (p_att->>'line')::numeric then v := v * (p_att->>'x')::numeric; end if;\n", ''],
  most_hurt_highest: ["   order by case when p_to = 'most_hurt' then (p_state->'cards'->q.id->>'hp')::numeric / (p_state->'cards'->q.id->>'max')::numeric", "   order by case when p_to = 'most_hurt' then -(p_state->'cards'->q.id->>'hp')::numeric / (p_state->'cards'->q.id->>'max')::numeric"],
  per_zero_applies: ["        if cnt > 0 then\n          if blk ? 'value' then\n            cr := 1;", "        if true then\n          if blk ? 'value' then\n            cr := 1;"],
  per_ally_self: ["where q.side = 'card' and q.id <> p_actor->>'id' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker');", "where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker');"],
  list_first_only: ["              then exists (select 1 from jsonb_array_elements_text(p_blk->'statuses') z where combat_v2_status_on(p_unit, z, p_clk) is not null)", "              then combat_v2_status_on(p_unit, p_blk->'statuses'->>0, p_clk) is not null"],
  smite_bonus_lost: ["jsonb_build_object('x', smite_x, 'true_strike', true, 'vs_x', svs, 'bonus', sbonus, 'crit_add', scrit)", "jsonb_build_object('x', smite_x, 'true_strike', true, 'vs_x', svs)"],
  steal_to_self: ["      t := case when steal_to is null then p_actor else combat_effect_v2_ally_to(s, steal_to) end;", '      t := p_actor;'],
  // the card text
  text_gate_clause_off: ["        s := ability_v2_clause(s, ability_v2_fill(bl->(att->>'k')->'text'->>'clause', jsonb_build_object('A', st->(att->>'status')->>'adj')));", '        null;'],
  text_more_off: ["when k = 'heal' and prevk = 'heal_all' and blk ? 'to' then 'more' else 'one' end;", "else 'one' end;"],
  text_or_and: ["              else array_to_string(p[1:cardinality(p) - 1], ', ') || ', or ' || p[cardinality(p)] end;", "              else array_to_string(p[1:cardinality(p) - 1], ', ') || ', and ' || p[cardinality(p)] end;"],
  // storage, balance, rights
  storage_check_off: ["  if not (r->>'ok')::boolean then\n    raise exception 'subjects.ability_v2 of %: %'", "  if false then\n    raise exception 'subjects.ability_v2 of %: %'"],
  share_added_always: [" where key = 'ability_v2' and not value ? 'share';", " where key = 'ability_v2';"],
  spec_share_off: ['"share": {"on_kill": "num 0 1", "enemy_charging": "num 0 1", "foes_alive": "num 0 1", "self_shield": "num 0 1", "self_has": "num 0 1"},', '"share": {"on_kill": "num 0 9", "enemy_charging": "num 0 9", "foes_alive": "num 0 9", "self_shield": "num 0 9", "self_has": "num 0 9"},'],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.combat_effect_v2_amount\([^)]*\) is \$cm\$[^\n]*\n/, ''],
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
for (const t of [V1, E1, E2, E3, E4, E5, E6, mig]) if (['$m$', '$t$', '$d$', '$x$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$ or $x$');

// The functions that this file adds, and the E6 functions that it replaces (each answers the E6 answer on an E6 ability).
const NEW = ['ability_v2_pps', 'ability_v2_or', 'ability_v2_clause', 'ability_v2_ally_word', 'ability_v2_options', 'ability_v2_coin', 'combat_effect_v2_has',
  'combat_effect_v2_ally_to', 'combat_effect_v2_gate', 'combat_effect_v2_count', 'combat_effect_v2_amount', 'subjects_ability_v2_check'];
const REPLACED = ['ability_v2_spec', 'ability_v2_field_types', 'ability_v2_field_error', 'ability_v2_numbers', 'ability_v2_block_pp', 'ability_v2_pp', 'ability_v2_text',
  'ability_v2_silver_text', 'ability_v2_check', 'combat_v2_action_numbers', 'combat_effect_v2_active'];
const E6NEW = ['ability_v2_spec', 'balance_check_ability_v2', 'ability_v2_field_types', 'ability_blocks_check', 'ability_v2_numbers', 'ability_v2_block_pp', 'ability_v2_pp',
  'ability_v2_pct', 'ability_v2_fill', 'ability_v2_cap', 'ability_v2_vals', 'ability_v2_verb', 'ability_v2_words', 'ability_v2_text', 'ability_v2_silver_text',
  'ability_v2_field_error', 'ability_v2_check', 'combat_v2_action_numbers', 'combat_v2_draws_rest', 'combat_effect_v2_blocks', 'combat_effect_v2_hit',
  'combat_effect_v2_basic', 'combat_effect_v2_active', 'combat_v2_card_act'];
// The functions of PR E8 (combat_v2_auto.sql) on a copy where it is applied: Auto v2 reads the earlier v2 functions by design (not a v1 caller).
// The functions of PR E9 (combat_v2_power.sql) on a copy where it is applied: the Power number reads the block prices (ability_v2_pps) by design.
const E9_POWER = ['card_power_v2_numbers', 'card_power_v2_families', 'card_power_v2', 'combat_v2_squad_value'];
const E8_AUTO = ['combat_v2_auto', 'combat_v2_auto_target', 'combat_v2_auto_charging', 'combat_v2_auto_pays', 'combat_v2_auto_makes', 'combat_v2_autopick', 'combat_v2_autopick_choose', 'combat_v2_autopick_pair', 'auto_v2_spec', 'balance_check_auto_v2'];
const q = (a) => a.map((n) => `'${n}'`).join(', ');
// The state before the file, also when it is already applied: E6's own SETUP (its table, functions, columns and balance key go), then E6, then this
// file's functions and the column subjects.ability_v2 go.
const SETUP = String.raw`
  perform set_config('balance.by', 'test', true);
  execute $m$${V1}$m$;
  execute $m$${E1}$m$;
  execute $m$${E2}$m$;
  execute $m$${E3}$m$;
  execute $m$${E4}$m$;
  execute $m$${E5}$m$;
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q([...E6NEW, ...NEW])}) loop
      execute 'drop function ' || f || ' cascade';
    end loop; end $x$$d$;
  drop table if exists public.ability_blocks;
  alter table public.statuses drop column if exists verb, drop column if exists adj;
  alter table public.subjects drop column if exists ability_v2;
  alter table public.balance disable trigger user;
  delete from public.balance where key = 'ability_v2';
  alter table public.balance enable trigger user;
  update public.balance set value = jsonb_set(value, '{support_pp,shield_all}', '75') where key = 'v2_pp';
  execute $m$${E6}$m$;`;
const md5s = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> all (array[${q(NEW)}, ${q(REPLACED)}]))`;

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
                                         when x->>0 = 'ppsx' then jsonb_build_object('pps', ability_v2_pps(x->>1, x->2, jsonb_set(jsonb_set(b, '{v2_pp,ref,kinds}', '2.1'), '{v2_stats,crd,base}', '2.4')))
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
const CARD_ST = ['empowered', 'focused', 'quickened', 'poison', 'burn', 'chill', 'weakened', 'slowed', 'blinded', 'exposed'];
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

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, E6 answers, balance, the library, storage
const body1 = (e6items, e6fights) => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; v jsonb; bad text[] := '{}'; k text; b jsonb; e6a jsonb; e6b jsonb; x jsonb; ok boolean;
  items jsonb := ${sqlLit(e6items)}; fights jsonb := ${sqlLit(e6fights)};
begin
  ${SETUP}
  ${DRIVER}
  before := ${md5s};
  -- the E6 answers: the validator and the card text of E6 abilities, and E6 card actions with explicit draws
  b := ability_v2_numbers();
  select jsonb_agg(ability_v2_check(i->>0, i->1, b) - 'pps' order by n) into e6a from jsonb_array_elements(items) with ordinality y(i, n);
  b := combat_v2_action_numbers();
  select jsonb_agg(pg_temp.t1run(f->0, f->1, b) order by n) into e6b from jsonb_array_elements(fights) with ordinality y(f, n);
  execute $m$${mig}$m$;
  after := ${md5s};
  b := ability_v2_numbers();
  select jsonb_agg(ability_v2_check(i->>0, i->1, b) - 'pps' order by n) into v from jsonb_array_elements(items) with ordinality y(i, n);
  res := res || jsonb_build_object('case', 'the replaced E6 validator, PP and card text give the E6 answer on ' || jsonb_array_length(items) || ' E6 abilities (the 42 templates and random E6 abilities)',
    'ok', v = e6a, 'got', (select jsonb_agg(jsonb_build_object('n', n, 'e6', e6a->(n::int - 1), 't1', v->(n::int - 1))) from generate_series(1, jsonb_array_length(items)) n where v->(n::int - 1) is distinct from e6a->(n::int - 1) limit 3));
  b := combat_v2_action_numbers();
  select jsonb_agg(pg_temp.t1run(f->0, f->1, b) order by n) into v from jsonb_array_elements(fights) with ordinality y(f, n);
  res := res || jsonb_build_object('case', 'the replaced E6 card action gives the E6 answer on ' || jsonb_array_length(fights) || ' random E6 card actions with explicit draws (state, hits, draws)',
    'ok', v = e6b and jsonb_array_length(fights) > 50, 'got', (select jsonb_agg(n) from generate_series(1, jsonb_array_length(fights)) n where v->(n::int - 1) is distinct from e6b->(n::int - 1)));
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ') is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(before) k2 where before->k2 is distinct from after->k2));
  res := res || jsonb_build_object('case', 'NUMBERS', 'ok', true, 'b', b, 'ab', ability_v2_numbers());
  select jsonb_object_agg(p.oid::regprocedure::text, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)}, ${q(REPLACED)});
  res := res || jsonb_build_object('case', 'volatility: the action parts with draws VOLATILE; the PP, the text helpers and the unit reads IMMUTABLE; the readers STABLE', 'ok',
    o = '{"ability_v2_pps(text,jsonb,jsonb)": "i", "ability_v2_or(text[])": "i", "ability_v2_clause(text,text)": "i", "ability_v2_ally_word(text)": "i", "ability_v2_options(jsonb,jsonb)": "i",
          "ability_v2_coin(text,jsonb,jsonb,jsonb)": "i", "combat_effect_v2_has(jsonb,jsonb,integer)": "i", "combat_effect_v2_ally_to(jsonb,text)": "i", "combat_effect_v2_gate(jsonb,jsonb,jsonb,jsonb)": "i",
          "combat_effect_v2_count(jsonb,text,text,integer,jsonb)": "i", "combat_effect_v2_amount(jsonb,jsonb,jsonb,jsonb,integer,jsonb,jsonb)": "v", "subjects_ability_v2_check()": "v",
          "ability_v2_spec()": "i", "ability_v2_field_types()": "i", "ability_v2_field_error(text,jsonb,jsonb)": "i", "ability_v2_numbers()": "s", "ability_v2_block_pp(jsonb,text,numeric,jsonb)": "i",
          "ability_v2_pp(text,jsonb,jsonb)": "i", "ability_v2_text(text,jsonb,jsonb)": "s", "ability_v2_silver_text(text,jsonb,jsonb,jsonb)": "s", "ability_v2_check(text,jsonb,jsonb)": "s",
          "combat_v2_action_numbers()": "s", "combat_effect_v2_active(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)": "v"}'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)}, ${q(REPLACED)}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the new and the replaced functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)}, ${q(REPLACED)}) and coalesce(obj_description(p.oid, 'pg_proc'), '') = '';
  res := res || jsonb_build_object('case', 'every new and replaced function has a comment; the columns attach, hosts and subjects.ability_v2 too', 'ok', o = '[]'::jsonb
    and coalesce(col_description('public.subjects'::regclass, (select attnum from pg_attribute where attrelid = 'public.subjects'::regclass and attname = 'ability_v2')), '') <> ''
    and coalesce(col_description('public.ability_blocks'::regclass, (select attnum from pg_attribute where attrelid = 'public.ability_blocks'::regclass and attname = 'attach')), '') <> ''
    and coalesce(col_description('public.ability_blocks'::regclass, (select attnum from pg_attribute where attrelid = 'public.ability_blocks'::regclass and attname = 'hosts')), '') <> '', 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname <> all (array[${q(NEW)}, ${q(E6NEW)}, ${q(E8_AUTO)}, ${q(E9_POWER)}, 'card_progress_v2_view', 'spend_card_points_v2', 'reset_card_points_v2', 'card_progress_v2_reset', 'combat_v2_card_unit', 'combat_effect_v2_holds'])   -- + M1c: the v2 spend and reset read the role of subjects.ability_v2   -- + R1a combat_v2_gauntlet_builders.sql: the v2 unit of a card reads subjects.ability_v2   -- + Set 2 (combat_v2_set2_parts.sql): the holds function calls has and count   -- + M1d combat_v2_progress_freeze_v1.sql: the v2 reset is card_progress_v2_reset
     and (p.prosrc ~ '(ability_v2_pps|ability_v2_or|ability_v2_clause|ability_v2_ally_word|ability_v2_options|ability_v2_coin|combat_effect_v2_has|combat_effect_v2_ally_to|combat_effect_v2_gate|combat_effect_v2_count|combat_effect_v2_amount)'
          or p.prosrc ~ 'ability_v2[^_]' or p.prosrc ~ '(ability_v2_check|ability_v2_text|ability_v2_pp|combat_effect_v2_active)');
  res := res || jsonb_build_object('case', 'no other function calls the new or the replaced functions or reads subjects.ability_v2 (no v1 caller; only the T1 and E6 functions)', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\(' and p.proname <> 'combat_v2_on'
    and p.proname <> all (array['spend_card_points_v2', 'reset_card_points_v2'])   -- M1c combat_v2_progress_spend.sql: the v2 spend and reset are gated by the flag (progress)
    and p.proname <> all (array['spend_stat_points', 'reset_stat_points', 'buy_shop_item', 'shop_today']);   -- M1d combat_v2_progress_freeze_v1.sql: the v1 spend and reset refuse, the Shop reset routes to v2 and shop_today shows its free reset, when progress is ON (2-argument form)
  select value into v from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability and has no reader but combat_v2_on', 'ok',
    o = '[]'::jsonb and (v - 'testers') = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', jsonb_build_object('readers', o, 'flag', v));
  -- balance
  select value into v from balance where key = 'ability_v2';
  res := res || jsonb_build_object('case', 'ABILITY_V2', 'ok', true, 'v', v);
  res := res || jsonb_build_object('case', 'balance ability_v2: the note names the shares and their measurement; a balance_log update by nathan adds share and ref', 'ok',
    (select note like '%run.mjs shares%' from balance where key = 'ability_v2')
    and exists (select 1 from balance_log where key = 'ability_v2' and op = 'update' and changed_by = 'nathan' and new_value ? 'share' and not old_value ? 'share'));
  update balance set value = jsonb_set(value, '{share,on_kill}', '0.05') where key = 'ability_v2';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: a second run keeps a changed share (on_kill 0.05)', 'ok', (select (value->'share'->>'on_kill')::numeric = 0.05 from balance where key = 'ability_v2'));
  update balance set value = v where key = 'ability_v2';
  for k, o in select x.k, x.p from (values ('a missing share', v #- '{share,self_has}'), ('a share above 1', jsonb_set(v, '{share,foes_alive}', '1.5')), ('a string share', jsonb_set(v, '{share,on_kill}', '"0.02"')),
      ('a missing ref', v - 'ref'), ('ref.per_ally 20', jsonb_set(v, '{ref,per_ally}', '20')), ('an extra share', jsonb_set(v, '{share,zz}', '0.1'))) x(k, p) loop
    begin update balance set value = o where key = 'ability_v2'; bad := bad || k; exception when others then if sqlerrm not like 'balance ability_v2:%' then bad := bad || (k || ': ' || sqlerrm); end if; end;
  end loop;
  res := res || jsonb_build_object('case', 'the fixed shape of ability_v2 refuses 6 planted share and ref values', 'ok', cardinality(bad) = 0, 'bad', bad);
  -- the library
  res := res || jsonb_build_object('case', 'LIBRARY', 'ok', true, 'rows', (select jsonb_agg(jsonb_build_object('key', key, 'reserved', reserved is not null, 'attach', attach, 'hosts', hosts, 'classes', classes) order by ord) from ability_blocks));
  -- the storage
  bad := '{}';
  x := (select jsonb_build_object('id', id, 'key', key) from subjects order by id limit 1);
  for k, o in select y.k, y.p from (values
      ('a valid ability', '{"role": "warden", "name": "Zz", "blocks": [{"k": "shield", "v": 0.3, "to": "most_hurt"}, {"k": "ally_below", "line": 0.3, "x": 2}]}'::jsonb),
      ('null', 'null'::jsonb)) y(k, p) loop
    begin update subjects set ability_v2 = case when o = 'null'::jsonb then null else o end where id = (x->>'id')::bigint;
    exception when others then bad := bad || (k || ' refused: ' || sqlerrm); end;
  end loop;
  for k, o in select y.k, y.p from (values
      ('over budget', '{"role": "warden", "name": "Zz", "blocks": [{"k": "shield", "v": 0.9}]}'::jsonb), ('no role', '{"name": "Zz", "blocks": [{"k": "shield", "v": 0.4}]}'),
      ('a wrong class', '{"role": "striker", "name": "Zz", "blocks": [{"k": "shield", "v": 0.4}]}'), ('a list', '[1]')) y(k, p) loop
    begin update subjects set ability_v2 = o where id = (x->>'id')::bigint; bad := bad || (k || ' accepted');
    exception when others then if sqlerrm not like 'subjects.ability_v2 of %' then bad := bad || (k || ': ' || sqlerrm); end if; end;
  end loop;
  res := res || jsonb_build_object('case', 'subjects.ability_v2: a valid ability and NULL pass; over budget, no role, a wrong class and a list are refused by the trigger (ability_v2_check)', 'ok', cardinality(bad) = 0, 'bad', bad);
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the fixed cases of the T1 rules
function fixedCases(B, AB) {
  const H = B.v2_hit, S = B.v2_status;
  const near = (a, b) => Math.abs(Number(a) - b) <= 1e-9 * Math.max(1, Math.abs(b));
  const roll = (d) => H.roll_min + d * H.roll_span;
  const ok = (c, msg) => (c ? true : msg);
  const c1 = Cr(1), c2 = Cr(2), c3 = Cr(3), e0 = En(0), e1 = En(1);
  const hp = (r, i, side = 'enemies', id = 0) => Number((side === 'cards' ? r[i].s.cards[id] : r[i].s.enemies[id]).hp);
  const stt = (r, i, side = 'enemies', id = 0) => (side === 'cards' ? r[i].s.cards[id] : r[i].s.enemies[id]).status;
  const dg = (cards, enemies, o = {}) => ({ mode: 'dungeon', cards, enemies, ...o });
  const foe = (o = {}) => ({ max: 1000, ...o });
  const A = (blocks) => ({ blocks });
  const NOCRIT = [0.99, 0.5, 0.99];
  return [
    ['on_kill: the hit that downs the target puts the status on the NEXT standing enemy (a draw only when one stands); no kill = no draw',
      dg({ 1: { charge: 2, active: A([{ k: 'hit', x: 1.5 }, { k: 'on_kill', status: 'slowed', chance: 0.5 }]) } }, [foe({ hp: 10 }), foe({ hp: 0, down: true }), foe()]),
      [act(c1, { target: e0, use: true, draws: [...NOCRIT, 0.4] }), { op: 'set', path: ['cards', '1', 'charge'], v: 2 }, act(c1, { target: En(2), use: true, draws: NOCRIT })],
      (r) => ok(r[0].s.enemies[0].down && stt(r, 0, 'enemies', 2).slowed && r[0].draws.length === 4 && r[2].draws.length === 3, JSON.stringify(r.map((x) => [x.draws, x.error])))],
    ['on_kill: with no other standing enemy there is no draw', dg({ 1: { charge: 2, active: A([{ k: 'hit', x: 1.5 }, { k: 'on_kill', status: 'slowed', chance: 1 }]) } }, [foe({ hp: 10 })]),
      [act(c1, { target: e0, use: true, draws: NOCRIT })], (r) => ok(r[0].draws.length === 3 && r[0].s.enemies[0].down, JSON.stringify(r[0]))],
    ['random_apply (attacker): after the hit, the chance draw, then the pick draw floor(d x n) chooses the option',
      dg({ 1: { charge: 2, active: A([{ k: 'hit', x: 1.5 }, { k: 'random_apply', options: [{ status: 'poison', stacks: 2 }, { status: 'blinded' }, { status: 'slowed' }] }]) } }, [foe()]),
      [act(c1, { target: e0, use: true, draws: [...NOCRIT, 0.1, 0.4] })], (r) => ok(stt(r, 0).blinded && !stt(r, 0).poison && r[0].draws.length === 5, JSON.stringify(r[0]))],
    ['random_apply (support): the chance draw (ABL raises it below one), then the pick', dg({ 1: { role: 'artillery', charge: 1, abl: 1.2, active: A([{ k: 'random_apply', chance: 0.5, options: [{ status: 'burn', stacks: 2 }, { status: 'slowed' }] }]) } }, [foe()]),
      [act(c1, { target: e0, use: true, draws: [0.59, 0.2] })], (r) => ok(stt(r, 0).burn?.stacks === 2 && r[0].draws.length === 2, JSON.stringify(r[0]))],
    ['the gates on an attacker: a gate that does not hold turns its host off (payoff_dmg while this card is Empowered; per_ally while two or more enemies stand)',
      dg({ 1: { charge: 2, active: A([{ k: 'hit', x: 1 }, { k: 'payoff_dmg', status: 'burn', v: 0.5 }, { k: 'self_has', status: 'empowered' }]) },
        2: { charge: 2, active: A([{ k: 'hit', x: 1 }, { k: 'payoff_dmg', status: 'burn', v: 0.5 }, { k: 'self_has', status: 'empowered' }]), status: { empowered: { value: 0.2 } } }, 3: { role: 'warden' } },
        [foe({ status: { burn: { stacks: 1 } } })]),
      [act(c1, { target: e0, use: true, draws: NOCRIT }), act(c2, { target: e0, use: true, draws: NOCRIT })],
      (r) => ok(near(r[0].hits[0].dmg, 100 * roll(0.5)) && near(r[1].hits[0].dmg, 100 * roll(0.5) * 1.2 * 1.5), JSON.stringify(r.map((x) => x.hits)))],
    ['the gates on a support: enemy_charging (the target cataclysm), foes_alive (more than one enemy), self_shield (this card has a shield)',
      dg({ 1: { role: 'warden', charge: 1, active: A([{ k: 'shield', v: 0.2, to: 'most_hurt' }, { k: 'enemy_charging' }, { k: 'heal', v: 0.2, to: 'most_hurt' }, { k: 'foes_alive' }, { k: 'empower', v: 0.2, to: 'strongest' }, { k: 'self_shield' }]) },
        2: { hp: 50, max: 100 }, 3: { role: 'breaker' } }, [foe({ cataclysm: true })]),
      [act(c1, { target: e0, use: true, draws: [0.9, 0.9, 0.9] })],
      (r) => ok(near(stt(r, 0, 'cards', 2).shielded.value, 20) && hp(r, 0, 'cards', 2) === 50 && !stt(r, 0, 'cards', 3).empowered && r[0].draws.length === 1, JSON.stringify(r[0]))],
    ['target_has: the host amount x x while the enemy has the status (a list: any of it); ally_below: x x while ITS ally is below the line',
      dg({ 1: { role: 'warden', charge: 1, active: A([{ k: 'shield', v: 0.2, to: 'most_hurt' }, { k: 'target_has', statuses: ['stunned', 'weakened'], x: 1.5 }, { k: 'heal', v: 0.2, to: 'most_hurt' }, { k: 'ally_below', line: 0.25, x: 2 }]) },
        2: { hp: 20, max: 100 }, 3: { hp: 90 } }, [foe({ status: { weakened: { value: 0.2, until: 9 } } })]),
      [act(c1, { target: e0, use: true, draws: [0.9, 0.9] })],
      (r) => ok(near(stt(r, 0, 'cards', 2).shielded.value, 0.2 * 1.5 * 100) && near(hp(r, 0, 'cards', 2), 20 + 0.2 * 2 * 100), JSON.stringify(r[0].s.cards))],
    ['more_per: +v for each stack of the status on the enemy; no status: for each OTHER harmful status (the host apply status does not count)',
      dg({ 1: { role: 'herald', charge: 1, active: A([{ k: 'empower', v: 0.3 }, { k: 'more_per', v: 0.1, status: 'burn' }, { k: 'apply', status: 'exposed', chance: 1, value: 0.2 }, { k: 'more_per', v: 0.05 }]) }, 2: {} },
        [foe({ status: { burn: { stacks: 3 }, exposed: { value: 0.1, until: 9 }, slowed: { until: 9 }, poison: { stacks: 1, until: 9 } } })]),
      [act(c1, { target: e0, use: true, ally: c2, draws: [0.9, 0.5, 0.9] })],
      (r) => ok(near(stt(r, 0, 'cards', 2).empowered.value, 0.3 + 0.3) && near(stt(r, 0).exposed.value, 0.1 + 0.2 + 0.05 * 3) && r[0].draws.length === 3, JSON.stringify(r[0]))],
    ['coin: ONE draw before the crit roll: below the chance the own amount, else alt',
      dg({ 1: { role: 'herald', charge: 1, active: A([{ k: 'empower', v: 0.7 }, { k: 'coin', alt: 0.3, chance: 0.5 }]) }, 2: {} }, [foe()]),
      [act(c1, { target: e0, use: true, ally: c2, draws: [0.49, 0.9] }), { op: 'set', path: ['cards', '1', 'charge'], v: 1 }, { op: 'set', path: ['cards', '2', 'status'], v: {} }, act(c1, { target: e0, use: true, ally: c2, draws: [0.5, 0.9] })],
      (r) => ok(near(stt(r, 0, 'cards', 2).empowered.value, 0.7) && near(stt(r, 3, 'cards', 2).empowered.value, 0.3) && r[0].draws.length === 2, JSON.stringify(r.map((x) => x.draws)))],
    ['apply per: the value x the stacks of a status (or the other harmful statuses) on the enemy; a count of 0 puts nothing (no crit draw)',
      dg({ 1: { role: 'controller', charge: 1, active: A([{ k: 'apply', status: 'poison', chance: 1, stacks: 2 }, { k: 'apply', status: 'weakened', chance: 1, value: 0.05, per: 'poison' }]) }, 2: { role: 'controller', charge: 1, active: A([{ k: 'apply', status: 'weakened', chance: 1, value: 0.1, per: 'kinds' }]) } },
        [foe(), foe()]),
      [act(c1, { target: e0, use: true, draws: [0.5, 0.5, 0.9] }), act(c2, { target: e1, use: true, draws: [0.5] }), { op: 'set', path: ['cards', '2', 'charge'], v: 1 }, act(c2, { target: e0, use: true, draws: [0.5, 0.9] })],
      (r) => ok(near(stt(r, 0).weakened.value, 0.05 * 2) && !stt(r, 1, 'enemies', 1).weakened && r[1].draws.length === 1 && near(stt(r, 3).weakened.value, 0.1 + 0.1) && r[3].draws.length === 2, JSON.stringify(r.map((x) => [x.draws, x.error, x.s.enemies.map((e) => e.status)])))],
    ['to: most_hurt = the lowest HP share (the first on a tie), strongest = the attacker with the most atk; strongest with no attacker = nothing and no draw',
      dg({ 1: { role: 'medic', charge: 1, active: A([{ k: 'heal', v: 0.1, to: 'most_hurt' }, { k: 'focus', crit: 0.2, to: 'strongest' }]) }, 2: { hp: 50, max: 100, atk: 90 }, 3: { hp: 50, max: 100, atk: 120 }, 4: { role: 'warden', hp: 30, max: 50 } }, [foe()], { squad: [1, 2, 3, 4] }),
      [act(c1, { target: e0, use: true, draws: [0.9] })],
      (r) => ok(hp(r, 0, 'cards', 2) === 60 && stt(r, 0, 'cards', 3).focused && !stt(r, 0, 'cards', 2).focused && hp(r, 0, 'cards', 4) === 30, JSON.stringify(r[0].s.cards))],
    ['to strongest with no standing attacker: the block does nothing and draws nothing', dg({ 1: { role: 'herald', charge: 1, active: A([{ k: 'empower', v: 0.3, to: 'strongest' }, { k: 'smite', x: 1 }]) }, 2: { role: 'warden' } }, [foe()]),
      [act(c1, { target: e0, use: true, draws: [0.5, 0.99] })], (r) => ok(r[0].draws.length === 2 && !stt(r, 0, 'cards', 2).empowered, JSON.stringify(r[0]))],
    ['lifesteal to most_hurt heals the most hurt ally (not this card); per_ally adds v x ABL for each OTHER standing attacker',
      dg({ 1: { role: 'survivor', hp: 90, charge: 2, abl: 1, active: A([{ k: 'hit', x: 1 }, { k: 'lifesteal', v: 0.2, to: 'most_hurt' }, { k: 'per_ally', v: 0.1 }]) }, 2: { hp: 20, role: 'breaker' }, 3: { role: 'striker' }, 4: { role: 'warden' }, 5: { role: 'striker', hp: 0, down: true } }, [foe({ max: 100000, hp: 100000 })]),
      [act(c1, { target: e0, use: true, draws: [0.99, 0.5, 0.99] })],
      (r) => ok(near(r[0].hits[0].dmg, 100 * roll(0.5) * 1.2) && hp(r, 0, 'cards', 2) > 20 && near(hp(r, 0, 'cards', 2), 20 + 0.2 * r[0].hits[0].dmg) && hp(r, 0, 'cards', 1) > 90, JSON.stringify(r[0]))],
    ['the status list: payoff_dmg on Paralyzed or Asleep counts an Asleep target', dg({ 1: { charge: 2, active: A([{ k: 'hit', x: 1 }, { k: 'payoff_dmg', statuses: ['paralyzed', 'sleep'], v: 0.5 }]) } }, [foe({ status: { sleep: { until: 9 } } })]),
      [act(c1, { target: e0, use: true, draws: [0.99, 0.5, 0.99] })], (r) => ok(near(r[0].hits[0].dmg, 100 * roll(0.5) * 1.5), JSON.stringify(r[0].hits))],
    ['a support payoff_dmg and crit_add shape the smite: +v vs the status, +v x ABL crit chance', dg({ 1: { role: 'artillery', crt: 0, charge: 1, abl: 1, active: A([{ k: 'smite', x: 1.5 }, { k: 'payoff_dmg', status: 'mark', v: 0.7 }, { k: 'crit_add', v: 0.4 }]) } },
      [foe({ status: { mark: { value: 0.1, until: 9 } } })]),
      [act(c1, { target: e0, use: true, draws: [0.5, 0.39] })], (r) => ok(r[0].hits[0].crit && near(r[0].hits[0].dmg, 100 * 1.5 * roll(0.5) * 2 * 1.1 * 1.7), JSON.stringify(r[0]))],
  ];
}

// ---------------------------------------------------------------------------------------------------------------- the validator: planted bad T1 abilities
function badAbilities() {
  const W = (blocks) => ({ name: 'Zz', blocks });
  return [
    ['an attachment first', 'warden', W([{ k: 'ally_below', line: 0.25, x: 2 }, { k: 'shield', v: 0.4 }]), 'needs a block before it'],
    ['two attachments on one host', 'warden', W([{ k: 'shield', v: 0.3 }, { k: 'target_has', status: 'weakened', x: 1.5 }, { k: 'foes_alive' }]), 'one attachment for each block'],
    ['ally_below after a smite (not a host)', 'artillery', W([{ k: 'smite', x: 1.8 }, { k: 'ally_below', line: 0.25, x: 2 }]), 'cannot follow a smite block'],
    ['a gate after the main hit', 'striker', W([{ k: 'hit', x: 1.7 }, { k: 'enemy_charging' }]), 'cannot follow a hit block'],
    ['more_per after an apply with no value', 'controller', W([{ k: 'apply', status: 'stunned', chance: 1 }, { k: 'more_per', v: 0.1 }]), 'needs a value'],
    ['coin after an apply per', 'controller', W([{ k: 'apply', status: 'stunned', chance: 1 }, { k: 'apply', status: 'weakened', chance: 1, value: 0.05, per: 'kinds' }, { k: 'coin', alt: 0.03, chance: 0.5 }]), 'has per already'],
    ['payoff_dmg with status AND statuses', 'striker', W([{ k: 'hit', x: 1.45 }, { k: 'payoff_dmg', status: 'burn', statuses: ['stunned'], v: 0.5 }]), 'needs status or statuses'],
    ['payoff_dmg with neither', 'striker', W([{ k: 'hit', x: 1.45 }, { k: 'payoff_dmg', v: 0.5 }]), 'needs status or statuses'],
    ['a support payoff_dmg with no smite', 'artillery', W([{ k: 'apply', status: 'stunned', chance: 1 }, { k: 'payoff_dmg', status: 'mark', v: 0.6 }]), 'needs a smite block'],
    ['a support crit_add with no smite', 'medic', W([{ k: 'heal', v: 0.5 }, { k: 'crit_add', v: 0.3 }]), 'needs a smite block'],
    ['random_apply with a value status option', 'artillery', W([{ k: 'smite', x: 1.3 }, { k: 'random_apply', options: [{ status: 'exposed' }, { status: 'burn', stacks: 2 }] }]), 'needs a value'],
    ['random_apply with one option', 'artillery', W([{ k: 'smite', x: 1.3 }, { k: 'random_apply', options: [{ status: 'burn' }] }]), 'list of 2 to 6 options'],
    ['random_apply + an apply rider on an attacker (two riders)', 'striker', W([{ k: 'hit', x: 1.4 }, { k: 'apply', status: 'slowed', chance: 0.5 }, { k: 'random_apply', options: [{ status: 'burn' }, { status: 'slowed' }] }]), 'riders: at most'],
    ['on_kill on a support (attackers only)', 'artillery', W([{ k: 'smite', x: 1.8 }, { k: 'on_kill', status: 'slowed', chance: 1 }]), 'not a block of a support'],
    ['on_kill + on_crit (two riders)', 'striker', W([{ k: 'hit', x: 1.5 }, { k: 'on_crit', status: 'slowed', chance: 0.5 }, { k: 'on_kill', status: 'slowed', chance: 0.5 }]), 'riders: at most'],
    ['self_has a shield (use self_shield)', 'warden', W([{ k: 'shield', v: 0.4 }, { k: 'self_has', status: 'shielded' }]), 'use the block self_shield'],
    ['apply per on an attacker', 'striker', W([{ k: 'hit', x: 1.4 }, { k: 'apply', status: 'weakened', chance: 1, value: 0.1, per: 'kinds' }]), 'per is for a support'],
    ['apply per with a status with no stacks', 'controller', W([{ k: 'apply', status: 'weakened', chance: 1, value: 0.1, per: 'stunned' }]), 'has no stacks on an enemy'],
    ['to "cured" on a heal (shield only)', 'medic', W([{ k: 'heal', v: 0.6, to: 'cured' }]), 'must be "most_hurt"'],
    ['target_has with x 1', 'warden', W([{ k: 'shield', v: 0.4 }, { k: 'target_has', status: 'weakened', x: 1 }]), 'x must be above 1'],
    ['a gate on a payoff that shares its sentence', 'striker', W([{ k: 'hit', x: 1.2 }, { k: 'payoff_dmg', status: 'burn', v: 0.3 }, { k: 'foes_alive' }, { k: 'payoff_crit', status: 'burn', v: 0.2 }]), 'shares its sentence'],
    ['over budget with a gate (share counted)', 'warden', W([{ k: 'shield', v: 0.4 }, { k: 'shield_all', v: 0.1 }, { k: 'enemy_charging' }]), 'the blocks cost'],
  ];
}

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
try {
  const CONFIG = loadConfig();
  // E6 inputs for "the replaced functions answer the E6 answer": the 42 templates, random E6-only abilities, random E6-only card actions
  const tids = Object.keys(CONFIG.v2_templates).filter((k) => !k.startsWith('_'));
  const e6only = (B) => B.every((b) => !['per_ally', 'random_apply', 'on_kill', ...GATES, 'target_has', 'ally_below', 'more_per', 'coin'].includes(b.k) && !b.to && !b.statuses && !b.per
    && !(b.k === 'payoff_dmg' || b.k === 'crit_add') || false);
  const rngE = mkRng(606); const e6abs = [];
  while (e6abs.length < 300) { const role = ROLES[e6abs.length % 12]; const bl = genAbility(rngE, classOf(role)).filter((b) => !['per_ally', 'random_apply', 'on_kill', ...GATES, 'target_has', 'ally_below', 'more_per', 'coin'].includes(b.k))
    .map((b) => { const c = { ...b }; delete c.to; delete c.per; if (c.statuses) { c.status = c.statuses[0]; delete c.statuses; } return c; })
    .filter((b) => !(classOf(role) === 'support' && ['payoff_dmg', 'crit_add'].includes(b.k)));
    if (bl.length && e6only(bl.filter((b) => !['payoff_dmg', 'crit_add'].includes(b.k)))) e6abs.push([role, { name: 'Zz', blocks: bl }]); }
  const e6items = [...tids.map((t) => [CONFIG.v2_templates[t].role, { name: CONFIG.v2_templates[t].name, blocks: CONFIG.v2_templates[t].blocks }]), ...e6abs];
  const e6fights = fightSpecs(24, 909, { v2_speed: CONFIG.v2_speed }).flatMap(([st, script]) => {
    // one card action of each card of the start state, with E6 blocks only and explicit draws
    const s2 = JSON.parse(JSON.stringify(st));
    for (const c of Object.values(s2.cards)) { c.active.blocks = c.active.blocks.filter((b) => !['per_ally', 'random_apply', 'on_kill', ...GATES, 'target_has', 'ally_below', 'more_per', 'coin'].includes(b.k) && !(c.class === 'support' && ['payoff_dmg', 'crit_add'].includes(b.k)))
      .map((b) => { const x = { ...b }; delete x.to; delete x.per; if (x.statuses) { x.status = x.statuses[0]; delete x.statuses; } return x; });
      if (c.class === 'attacker' && !c.active.blocks.some((b) => b.k === 'hit' || b.k === 'strikes')) c.active.blocks.unshift({ k: 'hit', x: 1.3 });
      if (!c.active.blocks.length) c.active.blocks.push({ k: 'smite', x: 1 }); c.charge = 2; }
    for (const e of s2.enemies) delete e.cataclysm;
    return Object.keys(s2.cards).map((id, j) => [s2, [act(Cr(Number(id)), { target: En(0), use: j % 3 !== 2, ally: Cr(Number(Object.keys(s2.cards)[0])), draws: script[j].draws })]]);
  });
  const results = JSON.parse(await runBlock(body1(e6items, e6fights)));
  const NUM = results.find((r) => r.case === 'NUMBERS'); const B = NUM.b, AB = NUM.ab;
  for (const r of results.filter((x) => !['NUMBERS', 'ABILITY_V2', 'LIBRARY'].includes(x.case))) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
  const leaves = (o, p = []) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).filter(([k]) => !k.startsWith('_')).flatMap(([k, v]) => leaves(v, [...p, k])) : [[p.join('.'), JSON.stringify(o)]]);
  // pp.vs_smite, share.self_has_each, share.area_payoff and ref.list_extra are the keys of PR T1b (combat_v2_ability_prices.sql, test-combat-v2-t1b.mjs)
  const bal = new Map(leaves(results.find((r) => r.case === 'ABILITY_V2').v)),
    cfgL = new Map(leaves(CONFIG.ability_v2).filter(([p]) => !/^(pp\.vs_smite|share\.area_payoff|ref\.list_extra|limits\.min_share)$|^share\.(self_has_each|status_kinds)\./.test(p)));   // + share.status_kinds: combat_v2_set2_parts.sql
  const lp = [...bal].filter(([p, v]) => cfgL.get(p) !== v).concat([...cfgL].filter(([p]) => !bal.has(p)));
  say(lp.length === 0 && bal.size === 18, `balance ability_v2 = config.json ability_v2 (${bal.size} leaves equal, with share and ref; one number, one home)`, JSON.stringify(lp));
  const LIB = results.find((r) => r.case === 'LIBRARY').rows;
  const T1KEYS = ['on_kill', 'self_has', 'enemy_charging', 'foes_alive', 'self_shield', 'per_ally', 'random_apply', 'target_has', 'ally_below', 'more_per', 'coin'];
  const lk = new Map(LIB.map((r) => [r.key, r]));
  say(LIB.every((r) => !r.reserved) && T1KEYS.every((k) => lk.has(k)) && LIB.length === 42 && GATES.every((g) => lk.get(g).attach === 'gate')
      && ['target_has', 'ally_below', 'more_per', 'coin'].every((k) => lk.get(k).attach === 'amount') && LIB.filter((r) => r.attach).length === 8 && eq(lk.get('on_kill').classes, ['attacker']),
    `the block library: ${LIB.length} rows, none reserved; the T1 parts are rows (${T1KEYS.join(', ')}); 4 gates and 4 amount attachments with their hosts; on_kill is for attackers`, JSON.stringify(LIB.filter((r) => r.reserved || r.attach)));
  // the simulator takes ability_v2 of this file as a whole (a patch would keep the T1b keys of config.json, whose presence turns on the T1b rules)
  const cfg = patch(CONFIG, { ...B, v2_pp: AB.v2_pp, v2_stats: AB.v2_stats }); cfg.ability_v2 = JSON.parse(JSON.stringify(AB.ability_v2));

  // the fixed cases
  const FIX = fixedCases(B, AB);
  const rows = await runOps(FIX.map((f) => [state(f[1]), f[2]]));
  FIX.forEach(([name, , , check], i) => {
    const r = rows[i]; const err = r.find((x) => x.error && !/not charged/.test(x.error));
    let res; try { res = err ? `error ${err.error}` : check(r, B); } catch (e) { res = `check raised: ${e.message} ${JSON.stringify(r.map((x) => x.error || x.action))}`; }
    say(res === true, `fixed: ${name}`, String(res).slice(0, 900));
  });

  // the validator, the PP and the texts
  const BADS = badAbilities();
  const rng = mkRng(4711); const RAND = Array.from({ length: Number(process.env.V2_PP || 1500) }, (_, i) => { const role = ROLES[i % 12]; return { role, cls: classOf(role), blocks: genAbility(rng, classOf(role)) }; });
  const TX = [
    ['warden', [{ k: 'shield', v: 0.3, to: 'most_hurt' }, { k: 'ally_below', line: 0.3, x: 2 }], 'Shield the most hurt ally for 30% of max HP. Shield twice as much if it is below 30% HP.'],
    ['warden', [{ k: 'shield', v: 0.32 }, { k: 'target_has', statuses: ['slowed', 'blinded'], x: 1.5 }], 'Shield an ally for 32% of max HP. Shield 1.5 times as much if the enemy is Slowed or Blinded.'],
    ['medic', [{ k: 'heal_all', v: 0.12 }, { k: 'heal', v: 0.17, to: 'most_hurt' }], 'Heal every ally for 12% of its max HP. Heal the most hurt ally for 17% more.'],
    ['herald', [{ k: 'empower', v: 0.7 }, { k: 'coin', alt: 0.3, chance: 0.5 }], 'Empower an ally for +70% or +30% damage, with a 50% chance of each.'],
    ['herald', [{ k: 'empower', v: 0.4 }, { k: 'more_per', v: 0.1, status: 'poison' }], 'Empower an ally for +40% damage, +10% more for each Poison stack on the enemy.'],
    ['spotter', [{ k: 'apply', status: 'exposed', chance: 1, value: 0.3 }, { k: 'more_per', v: 0.1 }], 'Expose the enemy to +30% damage, +10% more for each other status on it.'],
    ['controller', [{ k: 'apply', status: 'stunned', chance: 1 }, { k: 'apply', status: 'weakened', chance: 1, value: 0.05, per: 'kinds' }], 'Stun the enemy. Weaken it by 5% for each status on it.'],
    ['herald', [{ k: 'focus', crit: 0.45, crd: 0.2, to: 'strongest' }], 'Focus the strongest attacker for +45% crit chance and +0.2 crit damage.'],
    ['artillery', [{ k: 'smite', x: 1.5 }, { k: 'payoff_dmg', status: 'stunned', v: 0.7 }], 'Deal 150% damage to the enemy. Deals +70% damage to a Stunned enemy.'],
    ['artillery', [{ k: 'smite', x: 1.4 }, { k: 'crit_add', v: 0.4 }], 'Deal 140% damage to the enemy with +40% crit chance.'],
    ['artillery', [{ k: 'smite', x: 1.4 }, { k: 'random_apply', options: [{ status: 'burn', stacks: 1 }, { status: 'slowed' }, { status: 'blinded' }] }], 'Deal 140% damage to the enemy. Add one at random: 1 Burn, Slowed, or Blinded.'],
    ['breaker', [{ k: 'hit', x: 1.4 }, { k: 'payoff_dmg', statuses: ['paralyzed', 'frozen'], v: 0.6 }], 'Hit the target for 140%. Deals +60% damage to Paralyzed or Frozen targets.'],
    ['flurry', [{ k: 'strikes', n: 3, x: 0.5 }, { k: 'per_ally', v: 0.1 }], 'Strike 3 times for 50% each. Deals +10% damage for each ally attacker still standing.'],
    ['survivor', [{ k: 'hit', x: 1.5 }, { k: 'lifesteal', v: 0.6, to: 'most_hurt' }], 'Hit the target for 150%. Heal the most hurt ally for 60% of the damage dealt.'],
    ['striker', [{ k: 'hit', x: 1.4 }, { k: 'on_kill', status: 'stunned', chance: 0.5 }], 'Hit the target for 140%. Kills have a 50% chance to Stun the next enemy.'],
    ['striker', [{ k: 'hit', x: 1.4 }, { k: 'on_kill', status: 'burn', chance: 1, stacks: 2 }], 'Hit the target for 140%. Kills apply 2 Burn to the next enemy.'],
    ['striker', [{ k: 'hit', x: 1.3 }, { k: 'payoff_dmg', status: 'burn', v: 0.4 }, { k: 'self_has', status: 'empowered' }], 'Hit the target for 130%. Deals +40% damage to Burning targets while this card is Empowered.'],
    ['striker', [{ k: 'strikes', n: 2, x: 0.7 }, { k: 'random_apply', chance: 0.4, options: [{ status: 'slowed' }, { status: 'blinded' }] }], 'Strike twice for 70% each. Each strike has a 40% chance to add one at random: Slowed or Blinded.'],
    ['warden', [{ k: 'shield', v: 0.3 }, { k: 'enemy_charging' }, { k: 'shield_all', v: 0.05 }, { k: 'self_shield' }], 'Shield an ally for 30% of max HP if the enemy is Charging. Shield every ally for 5% of max HP while this card has a shield.'],
    ['artillery', [{ k: 'smite', x: 1.6 }, { k: 'vs_status', statuses: ['paralyzed', 'blinded', 'slowed'], x: 2 }], 'Deal 160% damage to the enemy. Deals double damage to a Paralyzed, Blinded, or Slowed enemy.'],
    ['cleaver', [{ k: 'hit', x: 1.1 }, { k: 'area', x: 0.5 }, { k: 'apply', status: 'burn', chance: 0.5, stacks: 1, all: true }, { k: 'foes_alive' }], null],
  ];
  const chk = await runChecks([...BADS.map((x) => [x[1], x[2]]), ...RAND.map((x) => ['pps', x.cls, x.blocks]), ...TX.map(([role, blocks]) => [role, { name: 'Zz', blocks }]),
    ...RAND.map((x) => ['ppsx', x.cls, x.blocks])]);
  const bRes = chk.slice(0, BADS.length), pRes = chk.slice(BADS.length, BADS.length + RAND.length), tRes = chk.slice(BADS.length + RAND.length, BADS.length + RAND.length + TX.length);
  const xRes = chk.slice(BADS.length + RAND.length + TX.length);
  const bwrong = BADS.map((x, i) => (bRes[i].ok ? `accepted: ${x[0]}` : !bRes[i].errors.some((e) => e.includes(x[3])) ? `refused for another reason: ${x[0]}: ${bRes[i].errors.join(' | ')}` : null)).filter(Boolean);
  say(bwrong.length === 0, `${BADS.length} planted bad T1 abilities refused, each with its own message (${BADS.map((x) => x[0]).join('; ')})`, bwrong.join(' || '));
  let pmax = 0; const pbad = []; const kinds = new Set();
  RAND.forEach((x, i) => {
    const id = `rand.${i}`; const c2 = { ...cfg, v2_templates: { ...cfg.v2_templates, [id]: { role: x.role, name: 'r', blocks: x.blocks } } };
    x.blocks.forEach((b, j) => { kinds.add(b.k); const a = blockPP(c2, id, b), s = Number(pRes[i].pps[j]); const d = Math.abs(a - s) / Math.max(1, Math.abs(a)); pmax = Math.max(pmax, d);
      if (!near(s, a)) pbad.push(`${id} block ${j + 1} ${b.k}: SQL ${s} sim ${a}`); });
    if (!near(pRes[i].pps.reduce((s, v) => s + Number(v), 0), templatePP(c2, id))) pbad.push(`${id} total`);
  });
  say(pbad.length === 0 && RAND.length >= 300 && T1KEYS.every((k) => kinds.has(k)),
    `SQL = the simulator on the PP of every block of ${RAND.length} random T1 abilities (${kinds.size} block kinds, every T1 part; the largest relative difference ${pmax.toExponential(1)})`, pbad.slice(0, 5).join(' | '));
  // the same with changed numbers: ref.kinds 2.1 (today = ref.stacks) and crd.base 2.4 (today 2, so crd.base - 1 = 1): a rule that reads the wrong number shows
  const cfgX = patch(cfg, { v2_pp: { ref: { kinds: 2.1 } }, v2_stats: { crd: { base: 2.4 } } });
  const xbad = [];
  RAND.forEach((x, i) => { const id = `rand.${i}`; const c2 = { ...cfgX, v2_templates: { ...cfgX.v2_templates, [id]: { role: x.role, name: 'r', blocks: x.blocks } } };
    x.blocks.forEach((b, j) => { const a = blockPP(c2, id, b), sq = Number(xRes[i].pps[j]); if (!near(sq, a)) xbad.push(`${id} block ${j + 1} ${b.k}: SQL ${sq} sim ${a}`); }); });
  say(xbad.length === 0, `SQL = the simulator on the same PP with changed numbers (ref.kinds 2.1, crd.base 2.4: every rule reads its own number)`, xbad.slice(0, 5).join(' | '));
  const twrong = TX.map(([role, , want], i) => (want === null ? (tRes[i].text.includes(' while two or more enemies stand.') ? null : `gate on an area rider: "${tRes[i].text}"`) : tRes[i].text !== want ? `${role}: "${tRes[i].text}"` : null)).filter(Boolean);
  say(twrong.length === 0, `the card text of every T1 pattern (${TX.length} synthetic abilities: to, ally_below, target_has, a "more" heal, coin, more_per, apply per, the support smite parts, random_apply, lists, per_ally, on_kill, the gate clauses)`, twrong.join(' | '));
  const silver = await runChecks([['warden', { name: 'Zz', blocks: TX[0][1], silver: { block: 1, field: 'v', value: 0.4 } }],
    ['breaker', { name: 'Zz', blocks: TX[11][1], silver: { block: 1, field: 'x', value: 1.4 + 0.225 } }],
    ['flurry', { name: 'Zz', blocks: [{ k: 'strikes', n: 3, x: 0.5 }, { k: 'per_ally', v: 0.12 }], silver: { block: 2, field: 'v', value: 0.214 } }],
    ['herald', { name: 'Zz', blocks: TX[3][1], silver: { block: 2, field: 'alt', value: 0.4 } }]]);
  say(silver[0].ok && silver[0].silver_text === '+10% Shield' && Math.abs(silver[0].silver_pp - 13) <= 0.6 && silver[1].ok && silver[1].silver_text === '+23% damage'
      && silver[2].ok && silver[2].silver_text === '+10% damage for each ally attacker' && !silver[3].ok && silver[3].errors.some((e) => /only the amount/.test(e)),
    'Silver type 1 on a T1 ability: the host amount of an attachment (ally_below follows it: +0.1 Shield = +3 PP), a list payoff, per_ally (+0.094 = +3 PP); the amount of an attachment cannot grow', JSON.stringify(silver.map((x) => [x.ok, x.silver_text, x.silver_pp, x.errors])));

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
    say(rows1.length === 130 && accepted >= 127 && (same === null || same >= 121),
      `the private Set 1 actives (the T1 batch): the validator accepts ${accepted} of ${rows1.length}; the generated text equals the approved text for ${same ?? '?'} of ${rows1.length}`,
      JSON.stringify(r1.map((x, i) => (x.ok ? null : [rows1[i].key.length, x.errors])).filter(Boolean)));
  } else console.log('SKIP the private Set 1 actives: the private batch file is missing (it never goes into this repo)');

  // SQL = the simulator on random fights with T1 actives
  const FS = fightSpecs(Number(process.env.V2_FIGHTS || 120), 5151, B);
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
  say(fsame + ftie === FS.length && fbad.length === 0, `SQL = the simulator on ${FS.length} random fights with T1 actives (every T1 part; the same choices and draws): ${fsame} equal action by action (${facts} actions: ${fev.active} actives, ${fev.basic} basic attacks, ${fev.skip} skips; ${fev.end} end, ${fev.cap} cap), ${ftie} differ only after a float near-tie of the simulator`,
    fbad.filter(Boolean).join(' | '));
  say(ftie <= Math.ceil(FS.length * 0.05) && fev.active >= 2.5 * FS.length, `the fights reach many actives (${fev.active}) and the near-ties are rare (${ftie} of ${FS.length})`);

  // the fuzz and the replay
  const fz = JSON.parse(await runBlock(fuzzBlock(fightSpecs(Number(process.env.V2_FUZZ || 40), 778, B).map((x) => x[0]))));
  say(fz.bad.length === 0 && fz.actions >= 8 * fz.fights && fz.actives >= 2 * fz.fights && fz.replay_same === fz.actions,
    `fuzz: ${fz.actions} random card actions with T1 actives (${fz.actives} actives) with random(): fight_state_check_v2, HP in [0, max], a down unit has no status; a replay with the answer's draws gives the same action (${fz.replay_same})`,
    JSON.stringify(fz).slice(0, 900));
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
