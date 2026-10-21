import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_monster_tuning.sql (combat v2 phase 4, the E7 follow-up: the monster tuning and the "Weak to" tags;
 * plan sections 7.4, 8.2, 8.4 and 20.2; Nathan's 7 decisions of 2026-10-21). NO lasting change: every request is one DO block, undone by its final RAISE.
 * V1, E1 to E6, T1, T1b, T1c, E7 (combat_v2_monsters.sql) and this file run inside each block (all idempotent), so the test passes before and after they
 * are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-monster-tuning.mjs     must PASS
 *   MUTATE=<name> ...                                                                                    must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                       the baseline (must PASS), then every mutation
 * The reference is the simulator card-studio/v2sim (engine.mjs cardHit and enemyHit with Ironhide crit_x and the Venom and Slowing chance; modes.mjs
 * makeBoss with the Weak to role of v2_bosses.<key>.weak_to) with the numbers of the database.
 * Invariants:
 *   1. No change in play: the md5 of every other public function is the same after the file (only the 6 replaced functions change); the callers of the
 *      replaced functions are the same v2 functions as before; the flag stays OFF. Volatility, server only, comments, the file runs twice.
 *   2. Data: the tuned balance values = config.json (Ironhide crit_x, the Venom and Slowing chance, Regrowth heal, Bulwark, Undying; the copy of Undying in
 *      v2_boss_rules is equal), the 3 mechanic texts name their numbers, hunt_bosses_v2.weak_to = config.json v2_bosses.<key>.weak_to (16 bosses, one role
 *      tag each, no support role without a week rule); the shape and the triggers refuse planted values and rows; the builders refuse a Hunt boss
 *      mechanic on a foe, a foe mechanic on a tier boss, and a caller weak_role.
 *   3. The replaced functions give the E7 answers with the E7 numbers (no crit_x, no chance): random fights with every enemy action, the same states and
 *      draws with and without this file.
 *   4. ONE SOURCE for the Weak to role: for each of the 16 bosses at each tier, the boss card line (hunt_boss_v2_card.weak_to), the fight unit
 *      (combat_v2_hunt_boss weak_role) and the simulator (makeBoss weakRole) name the same role, and a hit of that role deals + weak_role_x in SQL.
 *   5. SQL = the simulator on random fights with every enemy action (Hunt: the named bosses with their Weak to role, tier bosses; Dungeon: the monsters;
 *      Ironhide, Venom and Slowing forced), action by action: the actor, the skips, the move, the unit states and the draw counts.
 *   6. The fixed cases with explicit draws: the crit_x line, the Venom and Slowing chance draws, the tuned Bulwark, Undying and Regrowth numbers.
 *   7. The fuzz: random fights with random(): the state passes fight_state_check_v2; a replay with the draws of each action gives the same action.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { mini, dummyFoe } from '../v2sim/checks.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { ROLES, classOf } from '../v2sim/cards.mjs';
import { makeBoss, makeFoe, bossKeys, foeMoves, ownPassives, weakRoleOf } from '../v2sim/modes.mjs';
import { POLICIES } from '../v2sim/policy.mjs';
import { loadConfig, patch, mkRng } from '../v2sim/util.mjs';
assertLocal('test-combat-v2-monster-tuning.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const V1 = read('combat_v2_flags_balance.sql');
const E1 = read('combat_v2_statuses_roles.sql');
const E2 = read('combat_v2_turn_meter.sql');
const E3 = read('combat_v2_stats.sql');
const E4 = read('combat_v2_hit.sql');
const E5 = read('combat_v2_status_rules.sql');
const E6 = read('combat_v2_abilities.sql');
const T1 = read('combat_v2_ability_builder.sql');
const T1B = read('combat_v2_ability_prices.sql');
const T1C = read('combat_v2_min_share.sql');
const E7 = read('combat_v2_monsters.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_monster_tuning.sql');

const MUT = {
  // Ironhide crit_x (combat_v2_hit)
  ironhide_no_crit: ["then coalesce((combat_v2_mech(p_b, p_tgt, 'ironhide')->>'crit_x')::numeric, 0) else 1 end;", 'then 0 else 1 end;'],
  ironhide_full_crit: ["    critc := least((st->'crt'->>'cap')::numeric + foc, critc) * ihx;\n", "    critc := least((st->'crt'->>'cap')::numeric + foc, critc);\n"],
  ironhide_ignores_mark: ["    ihx := case when tmech ? 'ironhide' and not marked then", "    ihx := case when tmech ? 'ironhide' then"],
  // the Venom and Slowing chance (combat_v2_enemy_hit)
  venom_always: ['            continue when dv >= ch;\n', '            continue when false;\n'],
  // (a fault that keeps the used draw in the local list has no effect: nothing in the hit reads the list after Venom; the caller reads the count)
  venom_draw_uncounted: ['            dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);\n', '            dv := combat_v2_draw(d, 0); d := combat_v2_draws_rest(d, 1);\n'],
  slowing_always: ['and combat_v2_up(s #> tpath) and (ch >= 1 or dv < ch) then', 'and combat_v2_up(s #> tpath) then'],
  slowing_no_draw: ["      if ch < 1 then dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1); end if;\n", '      dv := 0;\n'],
  // ONE SOURCE for the Weak to role (combat_v2_hunt_boss)
  weak_from_table_off: ["    wr := (select regexp_replace(q.x, '^role:', '') from unnest(rw.weak_to) with ordinality q(x, n) where q.x like 'role:%' order by q.n limit 1);\n", ''],
  weak_role_not_on_unit: ["       || case when wr is not null then jsonb_build_object('weak_role', wr) else '{}'::jsonb end;\n", "       || '{}'::jsonb;\n"],
  weak_opt_allowed: ["  if o ? 'weak_role' then raise exception 'combat_v2_hunt_boss: no opts.weak_role (the Weak to role comes from hunt_bosses_v2.weak_to)'; end if;\n", ''],
  tier_boss_any_mech: ["      if not exists (select 1 from public.enemy_mechanics y where y.key = m #>> '{}' and y.on_boss) then", '      if false then'],
  // a foe takes only foe mechanics (combat_v2_dungeon_foe)
  foe_any_mech: ["    if not exists (select 1 from public.enemy_mechanics y where y.key = m and y.on_foe) then", '    if false then'],
  // the Weak to rows (hunt_bosses_v2_check and the 16 tags)
  weak_check_any_tag: ["    if k !~ '^role:' then raise exception", '    if false then raise exception'],
  weak_check_support: ["    if regexp_replace(k, '^role:', '') in ('warden', 'medic', 'spotter', 'herald') then", '    if false then'],
  weak_check_two_roles: ["  if (select count(*) from unnest(new.weak_to) x where x like 'role:%') > 1 then raise exception", '  if false then raise exception'],
  weak_check_unknown_role: ["    if not exists (select 1 from public.roles r where r.key = regexp_replace(k, '^role:', '')) then raise exception", '    if false then raise exception'],
  weak_tag_typo: ["update public.hunt_bosses_v2 set weak_to = '{role:cleaver}' where key = 'zerg'", "update public.hunt_bosses_v2 set weak_to = '{role:striker}' where key = 'zerg'"],
  weak_tag_missing: ["update public.hunt_bosses_v2 set weak_to = '{role:controller}' where key = 'warlord' and weak_to = '{}';\n", ''],
  weak_tag_overwrite: ["update public.hunt_bosses_v2 set weak_to = '{role:cleaver}' where key = 'zerg' and weak_to = '{}';", "update public.hunt_bosses_v2 set weak_to = '{role:cleaver}' where key = 'zerg';"],
  // the balance values and the shape
  value_crit_x: ['\'{"crit_x":0.7}\'', '\'{"crit_x":0.6}\''],
  value_venom_chance: ['\'{"chance":0.35}\'', '\'{"chance":0.5}\''],
  value_slowing_chance: ['\'{"chance":0.4}\'', '\'{"chance":1}\''],
  value_regrowth: ["'{mechanics,regrowth,heal}', '0.007')", "'{mechanics,regrowth,heal}', '0.01')"],
  value_bulwark: ['\'{passive_params,bulwark}\', \'{"every":3,"guard":0.18}\')', '\'{passive_params,bulwark}\', \'{"every":2,"guard":0.2}\')'],
  value_undying: ["'{passive_params,undying,hp}', '0.15')", "'{passive_params,undying,hp}', '0.25')"],
  value_guard_off: ["\n where key = 'v2_enemy' and not (value->'mechanics'->'ironhide' ? 'crit_x');", "\n where key = 'v2_enemy';"],
  spec_crit_x_wide: ['"ironhide": {"crit_x": "num 0 1"}', '"ironhide": {"crit_x": "num 0 9"}'],
  spec_chance_dropped: ['"slowing": {"chance": "num 0 1"}, "elusive": {}', '"slowing": {}, "elusive": {}'],
  text_no_leaf: ["update public.enemy_mechanics set text = 'Each single hit of this enemy has a {chance} chance to apply {poison} Poison to the card it hits.'\n where key = 'venom'",
    "update public.enemy_mechanics set text = 'Each single hit of this enemy applies {poison} Poison to the card it hits.'\n where key = 'venom'"],
  // play, rights, docs
  v1_touched: ['-- ============================================================ server only',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::int  $fn$;\n-- ============================================================ server only"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  stable_enemy_hit: ["create or replace function public.combat_v2_enemy_hit(p_state jsonb, p_att jsonb, p_tgt jsonb, p_x numeric, p_area boolean, p_opts jsonb, p_draws jsonb, p_b jsonb)\nreturns jsonb language plpgsql volatile",
    "create or replace function public.combat_v2_enemy_hit(p_state jsonb, p_att jsonb, p_tgt jsonb, p_x numeric, p_area boolean, p_opts jsonb, p_draws jsonb, p_b jsonb)\nreturns jsonb language plpgsql stable"],
  comment_missing: [/comment on function public\.combat_v2_enemy_hit\(jsonb, jsonb, jsonb, numeric, boolean, jsonb, jsonb, jsonb\) is \$cm\$[^\n]*\n/, ''],
};


if (process.env.MUTATE === 'all') {
  let ok = true;
  // one run at a time by default (MUT_JOBS=1): each block replaces the same functions (the chain runs again in it) and holds their locks until its
  // rollback, so parallel runs wait for each other and can deadlock (measured 2026-10-21: 4 jobs took 10 minutes for 4 runs; one run alone 88 s).
  // A deadlocked run FAILS for a reason that is not the mutation (a false catch): a run whose output names a deadlock runs again (at most 5
  // times), and a run that still has one counts as NOT caught.
  const runRaw = (name) => new Promise((res) => {
    const p = spawn(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' } });
    let stdout = '', stderr = ''; p.stdout.on('data', (x) => { stdout += x; }); p.stderr.on('data', (x) => { stderr += x; }); p.on('close', (status) => res({ status, stdout, stderr }));
  });
  const DEADLOCK = /deadlock detected/;
  const runOne = async (name) => {
    let r;
    for (let k = 0; k < 5; k++) { r = await runRaw(name); r.deadlock = DEADLOCK.test(r.stdout) || DEADLOCK.test(r.stderr); if (!r.deadlock) break; }
    return r;
  };
  const base = await runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)       ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  let caughtN = 0;
  const names = Object.keys(MUT); const results = new Array(names.length); let next = 0;
  await Promise.all(Array.from({ length: Number(process.env.MUT_JOBS || 1) }, async () => { while (next < names.length) { const i = next++; results[i] = await runOne(names[i]); } }));
  for (const [ix, name] of names.entries()) {
    const r = results[ix];
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line) && !r.deadlock;
    if (!caught) ok = false; else caughtN++;
    const fails = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5, 60));
    console.log(`mutation ${name.padEnd(28)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  first: ${(fails[0] || (r.stderr || '').trim().split(/\r?\n/).pop() || '').slice(0, 70)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${caughtN} of ${Object.keys(MUT).length} caught` : `mutations: FAIL (a red baseline or a mutation not caught: ${caughtN} of ${Object.keys(MUT).length} caught)`);
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  const n = !m ? 0 : m[0] instanceof RegExp ? (mig.match(new RegExp(m[0].source, 'g')) || []).length : mig.split(m[0]).length - 1;
  if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration exactly once (${n})`);
  mig = m[0] instanceof RegExp ? mig.replace(m[0], m[1]) : mig.split(m[0]).join(m[1]);
}
for (const t of [V1, E1, E2, E3, E4, E5, E6, T1, T1B, T1C, E7, mig]) if (['$m$', '$t$', '$d$', '$x$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$ or $x$');


// The functions of E7 (combat_v2_monsters.sql): the SETUP drops them and runs the chain again; the 6 functions that this file replaces (by signature).
const E7NEW = ['enemy_v2_spec', 'balance_check_enemy_v2', 'enemy_mechanics_check', 'dungeon_monsters_v2_check', 'hunt_bosses_v2_check', 'combat_v2_enemy_numbers',
  'combat_v2_mech', 'combat_v2_timed', 'combat_v2_timed_any', 'combat_v2_standing_rule', 'combat_v2_neg_kinds', 'combat_v2_healed', 'combat_v2_blocked', 'combat_v2_drop',
  'combat_v2_volatile', 'combat_v2_pick_card', 'combat_v2_enemy_mult', 'combat_v2_enemy_hit', 'combat_v2_boss_target', 'combat_v2_boss_move', 'combat_v2_enemy_act',
  'combat_v2_hunt_boss', 'combat_v2_dungeon_foe', 'hunt_boss_v2_card'];
const NEW_SIGS = ['combat_v2_step_end(jsonb,jsonb,jsonb)'];
export const TUNED = ['balance_v2_spec(text)', 'hunt_bosses_v2_check()', 'combat_v2_hit(jsonb,jsonb,jsonb,jsonb)', 'combat_v2_enemy_hit(jsonb,jsonb,jsonb,numeric,boolean,jsonb,jsonb,jsonb)',
  'combat_v2_hunt_boss(text,text,jsonb,jsonb)', 'combat_v2_dungeon_foe(text,integer,integer,text,jsonb,jsonb)'];
const TUNED_NAMES = TUNED.map((s) => s.split('(')[0]);
const T1NEW = ['ability_v2_pps', 'ability_v2_or', 'ability_v2_clause', 'ability_v2_ally_word', 'ability_v2_options', 'ability_v2_coin', 'combat_effect_v2_has',
  'combat_effect_v2_ally_to', 'combat_effect_v2_gate', 'combat_effect_v2_count', 'combat_effect_v2_amount', 'subjects_ability_v2_check'];
const E6NEW = ['ability_v2_spec', 'balance_check_ability_v2', 'ability_v2_field_types', 'ability_blocks_check', 'ability_v2_numbers', 'ability_v2_block_pp', 'ability_v2_pp',
  'ability_v2_pct', 'ability_v2_fill', 'ability_v2_cap', 'ability_v2_vals', 'ability_v2_verb', 'ability_v2_words', 'ability_v2_text', 'ability_v2_silver_text',
  'ability_v2_field_error', 'ability_v2_check', 'combat_v2_action_numbers', 'combat_v2_draws_rest', 'combat_effect_v2_blocks', 'combat_effect_v2_hit',
  'combat_effect_v2_basic', 'combat_effect_v2_active', 'combat_v2_card_act'];
const q = (a) => a.map((n) => `'${n}'`).join(', ');
// The state before the file, also when it is already applied: the E7 functions, tables and balance key go, v2_enemy and v2_dungeon go (V1 puts back the
// E7-era values), then the chain V1 to T1c and E7 runs again (the SETUP of the E7 test + E7).
const SETUP = String.raw`
  perform set_config('balance.by', 'test', true);
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
               and (p.proname in (${q(E7NEW)}) or p.oid::regprocedure::text in (${q(NEW_SIGS.map((s) => s.replace(/,/g, ', ')))})) loop
      execute 'drop function ' || f || ' cascade';
    end loop; end $x$$d$;
  drop table if exists public.hunt_bosses_v2;
  drop table if exists public.dungeon_monsters_v2;
  drop table if exists public.enemy_mechanics;
  alter table public.balance disable trigger user;
  delete from public.balance where key in ('enemy_v2', 'v2_enemy', 'v2_dungeon');
  alter table public.balance enable trigger user;
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
  execute $m$${T1}$m$;
  execute $m$${T1B}$m$;
  execute $m$${T1C}$m$;
  execute $m$${E7}$m$;`;
const md5s = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q(TUNED)}]))`;
// the callers of the replaced functions (other functions whose text names one)
const CALLERS = String.raw`(select coalesce(jsonb_agg(p.proname order by p.proname), '[]') from pg_proc p where p.pronamespace = 'public'::regnamespace
   and replace(p.oid::regprocedure::text, ' ', '') <> all (array[${q(TUNED)}]) and p.prosrc ~ '\m(${TUNED_NAMES.join('|')})\M')`;


// ---------------------------------------------------------------------------------------------------------------- random cards (the E6 generator)
const NEG_RIDERS = ['poison', 'burn', 'chill', 'stunned', 'sleep', 'paralyzed', 'blinded', 'confused', 'slowed', 'exposed', 'weakened', 'mark'];
const VALUE_ST = ['exposed', 'weakened', 'mark'], STACK_ST = ['poison', 'burn', 'chill'];
const ENEMY_ST = [...NEG_RIDERS, 'frozen'];
const CARD_NEG = NEG_RIDERS.filter((s) => s !== 'mark').concat(['frozen']);
function statusOpts(rng, st) { const o = {}; if (STACK_ST.includes(st) && rng() < 0.6) o.stacks = 1 + Math.floor(rng() * 3); if (VALUE_ST.includes(st)) o.value = [0.1, 0.2, 0.3, 0.45][Math.floor(rng() * 4)]; return o; }
function genAbility(rng, cls) {
  const pick = (a) => a[Math.floor(rng() * a.length)]; const r2 = (a, b) => Math.round((a + rng() * (b - a)) * 1000) / 1000; const ch = (p) => rng() < p;
  const B = [];
  if (cls === 'attacker') {
    if (ch(0.55)) B.push({ k: 'hit', x: r2(1.1, 1.8) }); else B.push({ k: 'strikes', n: 2 + Math.floor(rng() * 3), x: r2(0.35, 0.9) });
    const area = ch(0.35);
    if (ch(0.3)) B.push({ k: 'crit_add', v: r2(0.05, 0.35) });
    if (ch(0.15)) B.push({ k: 'pierce', v: pick([0.3, 0.5, 1]) });
    if (ch(0.15)) B.push({ k: 'true_strike' });
    if (area) B.push({ k: 'area', x: r2(0.3, 0.8) });
    if (ch(0.1)) B.push({ k: 'shield_break', x: pick([1.5, 2, 3]) });
    if (ch(0.15)) B.push({ k: 'lifesteal', v: r2(0.1, 0.6) });
    if (ch(0.1)) B.push({ k: 'guard_up', v: r2(0.1, 0.6) });
    const s1 = pick(ENEMY_ST);
    if (ch(0.3)) B.push({ k: 'payoff_dmg', status: s1, v: r2(0.1, 0.8) });
    if (ch(0.15)) B.push({ k: 'vs_status', status: pick(ENEMY_ST), x: pick([1.5, 2]) });
    if (ch(0.15)) { B.push({ k: 'execute', line: r2(0.2, 0.4), v: r2(0.5, 1.5) }); if (ch(0.5)) B.push({ k: 'line_status', statuses: [...new Set([pick(ENEMY_ST), pick(ENEMY_ST)])] }); }
    if (ch(0.6)) { const st = pick(NEG_RIDERS); B.push({ k: 'apply', status: st, chance: ch(0.4) ? 1 : r2(0.2, 0.8), ...statusOpts(rng, st), ...(area && ch(0.6) ? { all: true } : {}) }); }
    if (ch(0.25)) { const st = pick(NEG_RIDERS); B.push({ k: 'on_crit', status: st, chance: ch(0.3) ? 1 : r2(0.2, 0.9), ...statusOpts(rng, st) }); }
    return B;
  }
  const n = 1 + Math.floor(rng() * 4); const used = new Set();
  const add = (b) => { if (b.k !== 'apply' && used.has(b.k)) return; used.add(b.k); B.push(b); };
  for (let i = 0; i < n; i++) {
    const k = pick(['shield', 'shield_all', 'heal', 'heal_all', 'cleanse', 'cure', 'empower', 'rally', 'focus', 'quicken', 'dispel', 'smite', 'smite', 'consume', 'apply', 'apply', 'apply']);
    if (k === 'shield') add({ k, v: r2(0.1, 0.5), ...(used.has('cure') && ch(0.6) ? { to: 'cured' } : {}) });
    else if (['shield_all', 'heal_all'].includes(k)) add({ k, v: r2(0.05, 0.2) });
    else if (k === 'heal') add({ k, v: r2(0.2, 0.7) });
    else if (k === 'cure') add({ k, statuses: ch(0.3) ? ['all'] : [...new Set([pick(CARD_NEG), pick(CARD_NEG)])], immune: Math.floor(rng() * 9) });
    else if (['empower', 'rally'].includes(k)) add({ k, v: r2(0.1, 0.6) });
    else if (k === 'focus') add({ k, crit: r2(0.1, 0.5), crd: pick([0, 0.5]) });
    else if (k === 'quicken') add({ k, v: pick([0.3, 0.5]), ...(ch(0.5) ? { all: true } : {}) });
    else if (k === 'smite') { add({ k, x: r2(0.4, 2) }); if (ch(0.3)) add({ k: 'area', x: r2(0.2, 0.6) }); if (ch(0.3)) add({ k: 'vs_status', status: pick(ENEMY_ST), x: 2 }); }
    else if (k === 'consume') add({ k, status: 'burn', x: pick([1, 1.2]) });
    else if (k === 'apply') { const st = pick(NEG_RIDERS); add({ k, status: st, chance: ch(0.6) ? 1 : r2(0.3, 0.8), ...statusOpts(rng, st) }); }
    else add({ k });
  }
  if (!B.some((b) => b.k === 'smite') && B.some((b) => b.k === 'area' || b.k === 'vs_status')) B.push({ k: 'smite', x: 1 });
  return B;
}
// The simulator's view of a support's blocks (makeCard: v, x, value x F for a support except vs_status and consume; stacks + extra)
const simBlocks = (u) => u.active.blocks.map((b) => { const c = { ...b }; if (u.class === 'support') for (const f of ['v', 'x', 'value']) if (typeof c[f] === 'number' && c.k !== 'vs_status' && c.k !== 'consume') c[f] = c[f] * (u.power ?? 1); if (c.stacks) c.stacks += u.extra_stack || 0; return c; });

// ---------------------------------------------------------------------------------------------------------------- random enemies
const CONFIG = loadConfig();
const MECHS = [...Object.keys(CONFIG.v2_enemy.mechanics), ...Object.keys(CONFIG.v2_dungeon.passive_params), ...Object.keys(CONFIG.v2_boss_rules).filter((k) => k !== 'undying')].filter((k) => !k.startsWith('_'));
const BOSSES = bossKeys(CONFIG);
const MONSTERS = Object.keys(CONFIG.v2_dungeon.monsters);
// the words of a boss move + its numbers = the config move (the SQL builder merges the rows and balance the same way; block 1 proves the data equal)
const bossMoves = (key) => CONFIG.v2_bosses[key].moves.map((m) => JSON.parse(JSON.stringify(m)));

export function fightSpecs(n, seed, B, opts = {}) {
  const rng = mkRng(seed); const pick = (a) => a[Math.floor(rng() * a.length)]; const chance = (p) => rng() < p;
  const st0 = (side) => { const s = {}; if (chance(0.2)) s.poison = { stacks: pick([1, 2]), until: pick([2, 4, 8]) }; if (chance(0.2)) s.burn = { stacks: pick([1, 3]) };
    if (chance(0.12)) s.chill = { stacks: pick([1, 2]), until: pick([2, 5]) }; if (chance(0.1)) s.slowed = { until: pick([2, 5]) }; if (chance(0.1)) s.quickened = { until: pick([3, 6]), ...(chance(0.5) ? { value: 1.4 } : {}) };
    if (side === 'enemy' && chance(0.15)) s.mark = { value: 0.2, until: 6 }; if (chance(0.12)) s.exposed = { value: 0.15, until: 5 }; if (chance(0.1)) s.weakened = { value: 0.2, until: 5, ...(side === 'card' && chance(0.4) ? { locked: true } : {}) };
    if (chance(0.06)) s.confused = { until: 4 }; if (chance(0.06)) s.blinded = { until: 4 }; if (side === 'card' && chance(0.08)) s.focused = { value: 0.1, crd: 0.5, until: 9 };
    if (side === 'card' && chance(0.12)) s.empowered = { value: 0.3 }; if (chance(0.06)) s.sleep = { until: pick([2, 6]) }; else if (chance(0.06)) s.paralyzed = { until: pick([3, 6]) };
    else if (side === 'enemy' && chance(0.06)) s.stunned = { until: 9, ...(chance(0.5) ? { extra: 1 } : {}) };
    if (side === 'enemy' && chance(0.1)) s.guarded = { value: 60 }; if (side === 'card' && chance(0.2)) s.shielded = { value: 20 }; return s; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const mode = opts.mode || (chance(0.45) ? 'hunt' : 'dungeon');
    const nc = 2 + Math.floor(rng() * 4); const cards = {}; const ids = [];
    while (ids.length < nc) { const id = 1 + Math.floor(rng() * 30); if (!ids.includes(id)) ids.push(id); }
    for (const id of ids) {
      const role = opts.roles && chance(0.5) ? pick(opts.roles) : chance(0.2) ? pick(['medic', 'herald', 'spotter', 'artillery', 'flurry', 'cleaver', 'survivor', 'warden', 'controller']) : pick(ROLES); const cls = classOf(role); const max = pick([80, 150, 300]);
      cards[id] = { role, class: cls, speed: B.v2_speed.role_base[role], meter: Math.floor(rng() * 9999) / 100, max, hp: Math.round(max * (0.4 + 0.6 * rng())), atk: pick([40, 80, 150]),
        crt: pick([0.1, 0.3, 0.5]), crd: pick([2, 2.5]), abl: pick([1, 1.1, 1.25]), acc: pick([0, 0.04]), def: pick([0, 0.09]), ddg: pick([0, 0.06]),
        power: cls === 'support' ? pick([1, 1.1, 1.25]) : 1, extra_stack: chance(0.2) ? 1 : 0, charge: Math.floor(rng() * 3), held: 0, status: st0('card'),
        active: { blocks: genAbility(rng, cls) }, ...(chance(0.06) ? { banned: 1 } : {}) };
    }
    const mechs = (k) => { const m = opts.force ? [opts.force] : []; for (let j = 0; j < k; j++) { const x = pick(opts.mechs || MECHS); if (!m.includes(x)) m.push(x); } return m; };
    let enemies;
    if (mode === 'hunt') {
      const named = opts.boss ? true : opts.force ? chance(0.3) : chance(0.7); const key = opts.boss || pick(BOSSES); const B2 = CONFIG.v2_bosses[key]; const tier = pick(['Normal', 'Heroic', 'Mythic']);
      const mech = named ? [...B2.sig, ...(tier === 'Mythic' ? B2.mythic || [] : []), ...(opts.force || chance(0.4) ? mechs(1) : [])] : mechs(1 + Math.floor(rng() * 3));
      const e = { speed: pick([100, 110]), meter: Math.floor(rng() * 9999) / 100, max: 30000, hp: pick([30000, 20000, 12000, 1500]), atk: pick([40, 60]), def: pick([0.1, 0.2]), evasion: pick([0, 0.04]),
        resolve: pick([0, 0.1, 0.2]), keen: pick([0, 0.25]), status: st0('enemy'), mechanics: [...new Set(mech)], turn: Math.floor(rng() * 9), charging: false,
        healer: mech.includes('regrowth'), ...(chance(0.3) ? { weak_role: pick(ROLES) } : {}) };
      if (e.turn % CONFIG.v2_enemy.boss_moves.cycle === 0 && e.turn > 0) e.charging = true;
      // a named boss fights with its own Weak to role (hunt_bosses_v2.weak_to = config.json; the builder puts it on the unit)
      if (named) { const w = weakRoleOf(B2); if (w) e.weak_role = w; else delete e.weak_role; }
      if (named) Object.assign(e, { boss: key, resists: [...B2.resists, ...(tier === 'Mythic' ? B2.mythic_resists || [] : [])], params: B2.params || {}, moves2: bossMoves(key), counter_share: opts.boss || chance(0.5) ? 1 : B2.counter_share });
      if (e.mechanics.includes('brood')) e.brood = 1 + Math.floor(rng() * 5);
      if (chance(0.2)) e.timed = { [pick(['evade', 'emp_x', 'desync_control', 'desync_smite', 'mirror_smite', 'rubberband', 'steadfast_kinds', 'card_shield_x', 'heal_mirror', 'rot'])]: { v: pick([0.1, 0.5, 1]), until: pick([3, 9, null]) } };
      enemies = [e];
    } else {
      enemies = Array.from({ length: 1 + Math.floor(rng() * 3) }, () => {
        const mk = pick(MONSTERS); const max = pick([200, 600, 1500]);
        const mech = mechs(Math.floor(rng() * 3));
        const e = { speed: pick([45, 50, 55]), meter: Math.floor(rng() * 9999) / 100, max, hp: Math.min(max, pick([150, 400, 600])), atk: pick([10, 25]),
          def: pick([0, 0.05]), evasion: pick([0, 0.02]), resolve: pick([0, 0.1]), keen: 0, status: st0('enemy'), mechanics: mech, turn: Math.floor(rng() * 7),
          moves: foeMoves(CONFIG, mk).map(([k, w]) => ({ k, w })), cataclysm: chance(0.3), healer: mech.includes('regrowth') || chance(0.15), monster: mk };
        if (mech.includes('brood')) e.brood = 1 + Math.floor(rng() * 5);
        if (chance(0.15)) e.params = { purify: { every: 2 } };
        return e;
      });
    }
    const st = state({ mode, clock: 0, squad: ids, cards, enemies });
    const script = Array.from({ length: opts.len || 70 }, () => ({ draws: Array.from({ length: 160 }, () => Math.floor(rng() * 1e6) / 1e6), use: chance(0.7), tp: rng(), ap: rng() }));
    out.push([st, script]);
  }
  return out;
}

// a v2 fight state from a short spec
const card = (c) => ({ role: 'striker', class: 'attacker', atk: 100, crt: 0, crd: 2, abl: 1, acc: 0, def: 0, ddg: 0, hp: c.max ?? 100, max: 100, down: false, meter: 0, charge: 0, held: 0, status: {}, ...c,
  class: c.class ?? classOf(c.role || 'striker') });
export const state = (sc) => ({
  v: 2, mode: sc.mode || 'dungeon', round: 0, clock: sc.clock ?? 1, squad: sc.squad || Object.keys(sc.cards || {}).map(Number),
  cards: Object.fromEntries(Object.entries(sc.cards || {}).map(([id, c]) => [id, card(c)])),
  enemies: (sc.enemies || []).map((e) => ({ hp: e.max ?? 1000, max: 1000, down: false, meter: 0, charge: 0, speed: 50, atk: 20, def: 0, evasion: 0, resolve: 0, keen: 0, status: {}, ...e })),
  marks: {}, facts: { passives: [], cards: {} }, ext: sc.ext || {} });

// ---------------------------------------------------------------------------------------------------------------- the SQL fight driver
const FIGHT_DRIVER = String.raw`
  create or replace function pg_temp.e7sum(s jsonb) returns jsonb language sql as $x$
    select jsonb_build_object('clock', s->'clock',
      'cards', coalesce((select jsonb_object_agg(c.key, jsonb_build_object('hp', c.value->'hp', 'down', c.value->'down', 'status', c.value->'status',
                 'immune', coalesce(c.value->'immune', '{}'::jsonb), 'charge', c.value->'charge', 'held', coalesce(c.value->'held', '0'::jsonb),
                 'banned', coalesce(c.value->'banned', '0'::jsonb), 'timed', coalesce(c.value->'timed', '{}'::jsonb))) from jsonb_each(s->'cards') c), '{}'::jsonb),
      'enemies', coalesce((select jsonb_agg(jsonb_build_object('hp', e.v->'hp', 'down', e.v->'down', 'status', e.v->'status', 'immune', coalesce(e.v->'immune', '{}'::jsonb),
                 'turn', coalesce(e.v->'turn', '0'::jsonb), 'charging', coalesce(e.v->'charging', 'false'::jsonb), 'brood', coalesce(e.v->'brood', '0'::jsonb),
                 'blocked', coalesce(e.v->'blocked', '0'::jsonb), 'cleared', coalesce(e.v->'cleared', '0'::jsonb), 'undying_used', coalesce(e.v->'undying_used', 'false'::jsonb),
                 'last_smite', coalesce(e.v->'last_smite', '0'::jsonb), 'last_debuffer', e.v->'last_debuffer', 'timed', coalesce(e.v->'timed', '{}'::jsonb), 'meter', e.v->'meter') order by e.o)
                 from jsonb_array_elements(s->'enemies') with ordinality e(v, o)), '[]'::jsonb));
  $x$;
  create or replace function pg_temp.e7fight(p_s jsonb, p_script jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; r jsonb; a jsonb; sc jsonb; k int := 0; out jsonb := '[]'; nused int; lst text[]; t jsonb; al jsonb; u jsonb; usex boolean; dr jsonb; mv text;
  begin
    loop
      exit when k >= jsonb_array_length(p_script);
      sc := p_script->k;
      r := combat_v2_next(s, sc->'draws', p_b); s := r->'state';
      if r->>'event' <> 'act' then out := out || jsonb_build_array(jsonb_build_object('event', r->'event', 'u', pg_temp.e7sum(s))); exit; end if;
      nused := jsonb_array_length(r->'draws');
      dr := coalesce((select jsonb_agg(x.v order by x.o) from jsonb_array_elements(sc->'draws') with ordinality x(v, o) where x.o > nused), '[]'::jsonb);
      a := null; mv := null;
      if not (r->>'skip')::boolean then
        if r->'actor'->>'side' = 'card' then
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
          t := jsonb_build_object('side', 'enemy', 'id', lst[floor((sc->>'tp')::numeric * cardinality(lst))::int + 1]::numeric);
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
          al := jsonb_build_object('side', 'card', 'id', lst[floor((sc->>'ap')::numeric * cardinality(lst))::int + 1]::numeric);
          u := s #> combat_v2_unit_path(s, r->'actor');
          usex := (sc->>'use')::boolean and coalesce((u->>'charge')::int, 0) >= (p_b->'v2_charge'->>(u->>'class'))::int;
          a := combat_v2_card_act(s, r->'actor', jsonb_build_object('use', usex, 'target', t, 'ally', al, 'draws', dr), p_b);
          s := a->'state'; nused := nused + jsonb_array_length(a->'draws'); mv := a->>'action';
        else
          a := combat_v2_enemy_act(s, r->'actor', jsonb_build_object('draws', dr), p_b);
          s := a->'state'; nused := nused + jsonb_array_length(a->'draws'); mv := a->>'move';
        end if;
      end if;
      out := out || jsonb_build_array(jsonb_build_object('event', 'act', 'actor', r->'actor', 'skip', r->'skip', 'reason', r->'reason', 'n', nused, 'action', mv, 'u', pg_temp.e7sum(s)));
      k := k + 1;
    end loop;
    return out;
  end $x$;`;

// ---------------------------------------------------------------------------------------------------------------- the simulator side
const VALUE_KEYS = ['exposed', 'weakened', 'mark', 'empowered', 'focused', 'enraged', 'quickened'];
function cardOrder(st) {
  const sq = st.squad.map(String);
  return Object.keys(st.cards).sort((a, b) => { const ia = sq.indexOf(a), ib = sq.indexOf(b); if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); return Number(a) - Number(b); });
}
export function simBattle(cfg, st) {
  const ids = cardOrder(st);
  const cards = ids.map((id) => { const c = st.cards[id];
    return { key: `c${id}`, name: `c${id}`, role: c.role, cls: c.class, cp: c.atk, crit: c.crt, critx: c.crd, abl: c.abl, acc: c.acc, def: c.def, ddg: c.ddg, maxHp: c.max, hp: c.hp, resolve: 0,
      speedBase: c.speed, spdMult: 1, power: c.power, active: { id: `a${id}`, name: 'a', charge: cfg.v2_charge[c.class], blocks: c.active ? simBlocks(c) : [] } }; });
  const foes = st.enemies.map((e, i) => dummyFoe({ key: `e${i}`, maxHp: e.max, hp: e.hp, atk: e.atk, def: e.def ?? 0, evasion: e.evasion ?? 0, resolve: e.resolve ?? 0, keen: e.keen ?? 0,
    speedBase: e.speed, mech: e.mechanics || [], params: e.params || {}, resists: e.resists || [], healer: !!e.healer,
    moves: (e.moves || [{ k: 'idle', w: 1 }]).map((m) => [m.k, m.w]), moves2: e.moves2 || null, counterShare: e.counter_share ?? 0, weakRole: e.weak_role || null, cataclysm: !!e.cataclysm }));
  const b = mini(cfg, cards, foes, { mode: st.mode, cap: 1e9 });
  b.step = st.clock;
  const units = [...ids.map((id) => ['card', id, st.cards[id]]), ...st.enemies.map((e, i) => ['enemy', String(i), e])];
  units.forEach(([side, id, src], k) => {
    const u = side === 'card' ? b.cards[k] : b.enemies[k - ids.length];
    u.down = !!src.down || src.hp <= 0; u.meter = src.meter ?? 0; u.st = {}; u.shield = 0;
    if (side === 'card') { u.charge = src.charge ?? 0; u.held = src.held ?? 0; u.banned = src.banned || 0; }
    else { u.def = src.def ?? 0; u.evasion = src.evasion ?? 0; u.brood = src.brood || 0; u.turn = src.turn || 0; u.charging = !!src.charging; u.blockedN = src.blocked || 0; u.cleared = src.cleared || 0;
      u.undyingUsed = !!src.undying_used; u.lastSmite = src.last_smite || 0; }
    for (const [key, v] of Object.entries(src.timed || {})) u.ext[key] = { v: v.v, until: v.until === null || v.until === undefined ? Infinity : v.until };
    for (const [s, v] of Object.entries(src.status || {})) {
      if (s === 'shielded' || s === 'guarded') { u.shield = v.value; continue; }
      const o = {}; if (v.stacks !== undefined) o.stacks = v.stacks; if (v.until !== undefined) o.until = v.until;
      if (s === 'quickened') o.v = v.value ?? cfg.v2_status.quickened.x; else if (VALUE_KEYS.includes(s)) o.v = v.value; else if (s === 'slowed') o.v = cfg.v2_status.slowed.x; else if (!STACK_ST.includes(s)) o.v = 1;
      if (v.crd !== undefined) o.crd = v.crd; if (v.locked) o.locked = true; if (v.extra !== undefined) o.extra = v.extra;
      u.st[s] = o;
    }
    if (src.immune?.control !== undefined) u.immUntil = src.immune.control + 1;
    for (const [s, n] of Object.entries(src.immune || {})) if (s !== 'control') u.immuneTo[s] = n + 1;
  });
  st.enemies.forEach((e, i) => { if (e.last_debuffer !== undefined && e.last_debuffer !== null) b.enemies[i].lastDebuffer = b.cards[ids.indexOf(String(e.last_debuffer))]; });
  const ref = (u) => (u.side === 'card' ? { side: 'card', id: Number(ids[b.cards.indexOf(u)]) } : { side: 'enemy', id: b.enemies.indexOf(u) });
  return { b, ids, ref };
}
export function simSum(H) {
  const { b, ids } = H; const clk = b.step;
  const one = (u) => {
    const status = {};
    for (const [s, v] of Object.entries(u.st)) {
      const o = {}; if (v.stacks !== undefined) o.stacks = v.stacks; if (VALUE_KEYS.includes(s)) o.value = v.v; if (v.until !== undefined) o.until = v.until; if (s === 'focused') o.crd = v.crd || 0;
      if (v.locked) o.locked = true; if (v.extra) o.extra = v.extra;
      status[s] = o;
    }
    if (u.shield > 1e-9) status[u.side === 'card' ? 'shielded' : 'guarded'] = { value: u.shield };
    const immune = {};
    if (u.immUntil - 1 >= clk) immune.control = u.immUntil - 1;
    for (const [s, n] of Object.entries(u.immuneTo)) if (n - 1 >= clk) immune[s] = n - 1;
    const timed = {}; for (const [k, v] of Object.entries(u.ext)) if (v.until > clk) timed[k] = { v: v.v, until: v.until === Infinity ? null : v.until };
    const common = { hp: u.hp, down: !!u.down, status, immune, timed };
    return u.side === 'card' ? { ...common, charge: u.charge, held: u.held, banned: u.banned || 0 }
      : { ...common, turn: u.turn, charging: !!u.charging, brood: u.brood || 0, blocked: u.blockedN || 0, cleared: u.cleared || 0, undying_used: !!u.undyingUsed, last_smite: u.lastSmite || 0,
        last_debuffer: u.lastDebuffer ? Number(ids[b.cards.indexOf(u.lastDebuffer)]) : null, meter: u.meter };
  };
  return { clock: clk, cards: Object.fromEntries(ids.map((id, k) => [id, one(b.cards[k])])), enemies: b.enemies.map(one) };
}
function sqlSum(u0, cfg) {
  const clk = u0.clock;
  const tm = (t) => Object.fromEntries(Object.entries(t || {}).filter(([, v]) => v.until === null || v.until === undefined || v.until > clk));
  const f = (u, card) => {
    const status = {};
    for (const [s, v] of Object.entries(u.status || {})) { const o = { ...v }; if (s === 'quickened') o.value = v.value ?? cfg.v2_status.quickened.x; if (s === 'focused') o.crd = v.crd ?? 0; if (!o.locked) delete o.locked; if (!o.extra) delete o.extra; status[s] = o; }
    const common = { hp: Number(u.hp), down: !!u.down, status, immune: Object.fromEntries(Object.entries(u.immune || {}).filter(([, n]) => n >= clk)), timed: tm(u.timed) };
    return card ? { ...common, charge: u.charge, held: u.held, banned: u.banned || 0 }
      : { ...common, turn: u.turn, charging: !!u.charging, brood: u.brood || 0, blocked: u.blocked || 0, cleared: u.cleared || 0, undying_used: !!u.undying_used, last_smite: Number(u.last_smite || 0),
        last_debuffer: u.last_debuffer ?? null, meter: Number(u.meter) };
  };
  return { clock: clk, cards: Object.fromEntries(Object.entries(u0.cards).map(([k, u]) => [k, f(u, true)])), enemies: u0.enemies.map((u) => f(u, false)) };
}
function sameSum(a, b, rel = 1e-9) {
  const bad = [];
  const num = (x, y, at) => { if (Math.abs(Number(x) - Number(y)) > rel * Math.max(1, Math.abs(Number(y)))) bad.push(`${at}: SQL ${x} sim ${y}`); };
  if (a.clock !== b.clock) bad.push(`clock ${a.clock} ${b.clock}`);
  const unit = (x, y, at) => {
    num(x.hp, y.hp, `${at}.hp`); if (x.down !== y.down) bad.push(`${at}.down SQL ${x.down} sim ${y.down}`);
    for (const f of ['charge', 'held', 'banned', 'turn', 'charging', 'brood', 'blocked', 'cleared', 'undying_used', 'last_debuffer']) if (y[f] !== undefined && (x[f] ?? null) !== (y[f] ?? null)) bad.push(`${at}.${f} SQL ${x[f]} sim ${y[f]}`);
    if (y.last_smite !== undefined) num(x.last_smite, y.last_smite, `${at}.last_smite`);
    if (y.meter !== undefined) num(x.meter, y.meter, `${at}.meter`);
    const ks = [...new Set([...Object.keys(x.status), ...Object.keys(y.status)])];
    for (const k of ks) {
      const p = x.status[k], q2 = y.status[k];
      if (!p || !q2) { bad.push(`${at}.status.${k}: SQL ${JSON.stringify(p)} sim ${JSON.stringify(q2)}`); continue; }
      for (const f of ['stacks', 'value', 'until', 'crd', 'extra']) { if ((p[f] === undefined) !== (q2[f] === undefined)) bad.push(`${at}.${k}.${f}: SQL ${p[f]} sim ${q2[f]}`); else if (p[f] !== undefined) num(p[f], q2[f], `${at}.${k}.${f}`); }
      if (!!p.locked !== !!q2.locked) bad.push(`${at}.${k}.locked: SQL ${p.locked} sim ${q2.locked}`);
    }
    const ik = [...new Set([...Object.keys(x.immune), ...Object.keys(y.immune)])];
    for (const k of ik) if (x.immune[k] !== y.immune[k]) bad.push(`${at}.immune.${k}: SQL ${x.immune[k]} sim ${y.immune[k]}`);
    const tk = [...new Set([...Object.keys(x.timed), ...Object.keys(y.timed)])];
    for (const k of tk) { const p = x.timed[k], q2 = y.timed[k]; if (!p || !q2 || (p.until ?? null) !== (q2.until ?? null)) bad.push(`${at}.timed.${k}: SQL ${JSON.stringify(p)} sim ${JSON.stringify(q2)}`); else num(p.v, q2.v, `${at}.timed.${k}.v`); }
  };
  for (const k of Object.keys(b.cards)) unit(a.cards[k], b.cards[k], `card ${k}`);
  b.enemies.forEach((e, i) => unit(a.enemies[i], e, `enemy ${i}`));
  return bad;
}
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
// One fight in the simulator: the scripted card choices of the SQL driver, the full enemy AI, and ONE draw queue for each scripted entry: the step ends
// and the turn start before an action take the draws of that action's entry (SQL: combat_v2_next with the entry's draws, then the action).
export function simFight(cfg, st, script) {
  const H = simBattle(cfg, st); const { b } = H;
  b.cap = st.mode === 'hunt' ? cfg.v2_hunt.round_cap : cfg.v2_dungeon.round_cap;
  const out = []; let k = 0; let cur = script[0]; let qd = cur ? cur.draws : [], qi = 0; let nearTie = false;
  const take = () => { if (qi >= qd.length) throw new Error('simulator: out of draws'); return qd[qi++]; };
  for (const u of b.units) u.rng = take;
  const STOP = new Error('stop');
  b.policy = {
    useActive: () => cur.use,
    target: (bb) => { const a = bb.alive('enemy'); return a[Math.floor(cur.tp * a.length)]; },
    allyFor: (bb) => { const a = bb.alive('card'); return a[Math.floor(cur.ap * a.length)]; },
  };
  let action = null;
  const doActive0 = b.doActive.bind(b), doBasic0 = b.doBasic.bind(b), enemyAct0 = b.enemyAct.bind(b), bossMove0 = b.bossMove.bind(b);
  b.doActive = (u, t) => { action = 'active'; return doActive0(u, t); };
  b.doBasic = (u, t) => { action = 'basic'; return doBasic0(u, t); };
  b.bossMove = (e, m) => { action = m.id; return bossMove0(e, m); };
  b.enemyAct = (e) => { action = null; return enemyAct0(e); };
  b.speedOf = function (u) { const sp = Battle.prototype.speedOf.call(this, u); const m = u.meter + sp; if (!u.down && m >= 50 && Math.abs(m - 100 * Math.round(m / 100)) < 1e-6) nearTie = true; return sp; };
  const act0 = Battle.prototype.act;
  b.act = function (u) {
    if (k >= script.length) throw STOP;
    const ms = this.units.filter((x) => !x.down).map((x) => x.meter + (x === u ? 100 : 0));
    const top = ms.filter((m) => m >= 100 - 1e-6).sort((a, c) => c - a);
    if (ms.some((m) => Math.abs(m - 100) < 1e-6) || (top.length > 1 && top[0] - top[1] < 1e-6)) nearTie = true;
    action = null;
    const cs0 = this.S.controlSkips, pf0 = this.S.paraFail, bn0 = this.S.bans; const k0 = u.st.stunned ? 'stunned' : u.st.frozen ? 'frozen' : u.st.sleep ? 'sleep' : null;
    act0.call(this, u);
    const skip = this.S.controlSkips > cs0 || this.S.bans > bn0;
    out.push({ event: 'act', actor: H.ref(u), skip, reason: skip ? (this.S.bans > bn0 ? 'banned' : k0 || (this.S.paraFail > pf0 ? 'paralyzed' : '?')) : null, n: qi, action: skip ? null : action, u: simSum(H), nearTie });
    k++; cur = script[k]; if (cur) { qd = cur.draws; qi = 0; }
  };
  try { while (!b.ended) b.tickStep(); } catch (e) { if (e !== STOP) throw e; }
  if (b.ended) out.push({ event: b.ended === 'cap' ? 'cap' : 'end', u: simSum(H), nearTie });
  return out;
}


// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, data, triggers, rights
const VOL = { balance_v2_spec: 'i', hunt_bosses_v2_check: 'v', combat_v2_hit: 'v', combat_v2_enemy_hit: 'v', combat_v2_hunt_boss: 's', combat_v2_dungeon_foe: 's' };
const PLANT_BAL = [
  ['v2_enemy', 'crit_x above 1', "jsonb_set(value, '{mechanics,ironhide,crit_x}', '2')"], ['v2_enemy', 'no Venom chance', "value #- '{mechanics,venom,chance}'"],
  ['v2_enemy', 'a Slowing chance of the wrong type', "jsonb_set(value, '{mechanics,slowing,chance}', '\"0.4\"')"], ['v2_enemy', 'a Venom chance below 0', "jsonb_set(value, '{mechanics,venom,chance}', '-0.1')"],
  ['v2_dungeon', 'Bulwark every 1', "jsonb_set(value, '{passive_params,bulwark,every}', '1')"]];
const PLANT_ROWS = [
  ['an element weakness', "update public.hunt_bosses_v2 set weak_to = '{element:fire}' where key = 'maw'", 'not a role tag'],
  ['a family weakness', "update public.hunt_bosses_v2 set weak_to = '{origin:anime}' where key = 'maw'", 'not a role tag'],
  ['a support role with no week rule (Medic)', "update public.hunt_bosses_v2 set weak_to = '{role:medic}' where key = 'maw'", 'support role with no week rule'],
  ['a support role with no week rule (Herald)', "update public.hunt_bosses_v2 set weak_to = '{role:herald}' where key = 'maw'", 'support role with no week rule'],
  ['two role tags', "update public.hunt_bosses_v2 set weak_to = '{role:cleaver,role:striker}' where key = 'maw'", 'one role tag at most'],
  ['an unknown role', "update public.hunt_bosses_v2 set weak_to = '{role:wizard}' where key = 'maw'", 'not a role of roles'],
  ['a tag that is not a rule tag', "update public.hunt_bosses_v2 set weak_to = '{fire}' where key = 'maw'", 'not a rule tag'],
  ['a Hunt boss mechanic on a Dungeon foe (Steadfast)', "select combat_v2_dungeon_foe('slime', 3, 2, 'guardian', '[\"steadfast\"]'::jsonb)", 'not a foe mechanic'],
  ['a Hunt boss rule on a Dungeon foe (Brood)', "select combat_v2_dungeon_foe('golem', 3, 2, 'elite', '[\"brood\"]'::jsonb)", 'not a foe mechanic'],
  ['a Hunt boss rule on a Dungeon foe (Plated)', "select combat_v2_dungeon_foe('golem', 3, 2, 'guardian', '[\"plated\"]'::jsonb)", 'not a foe mechanic'],
  ['a Hunt boss rule on a Dungeon foe (Fade)', "select combat_v2_dungeon_foe('golem', 3, 2, 'guardian', '[\"fade\"]'::jsonb)", 'not a foe mechanic'],
  ['a foe-only mechanic on a tier boss (Burning)', "select combat_v2_hunt_boss('Heroic', null, '{\"sigs\": [\"burning\"]}'::jsonb)", 'not a Hunt boss mechanic'],
  ['a caller weak_role on a named boss', "select combat_v2_hunt_boss('Heroic', 'zerg', '{\"weak_role\": \"striker\"}'::jsonb)", 'no opts.weak_role'],
  ['a caller weak_role on a tier boss', "select combat_v2_hunt_boss('Heroic', null, '{\"weak_role\": \"striker\"}'::jsonb)", 'no opts.weak_role']];
const body1 = () => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; v jsonb; t1 jsonb; t2 jsonb; c1 jsonb; c2 jsonb; k text; ok boolean; e text; n int;
begin
  ${SETUP}
  before := ${md5s}; c1 := ${CALLERS};
  select jsonb_object_agg(replace(p.oid::regprocedure::text, ' ', ''), md5(pg_get_functiondef(p.oid))) into t1 from pg_proc p
   where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(TUNED)});
  execute $m$${mig}$m$;
  after := ${md5s}; c2 := ${CALLERS};
  select jsonb_object_agg(replace(p.oid::regprocedure::text, ' ', ''), md5(pg_get_functiondef(p.oid))) into t2 from pg_proc p
   where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(TUNED)});
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ') is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(before) k2 where before->k2 is distinct from after->k2));
  res := res || jsonb_build_object('case', 'the ${TUNED.length} replaced functions each have a new text', 'ok',
    (select count(*) from jsonb_object_keys(t1)) = ${TUNED.length} and (select bool_and(t1->>k2 <> t2->>k2) from jsonb_object_keys(t1) k2), 'got', jsonb_build_object('before', t1, 'after', t2));
  res := res || jsonb_build_object('case', 'the callers of the replaced functions are the same before and after, and each is a combat v2 function or a balance trigger (no v1 caller)', 'ok',
    c1 = c2 and (select bool_and(x ~ '^(combat_v2_|combat_effect_v2_|balance_check_|hunt_bosses_v2_check|fight_state_check_v2)') from jsonb_array_elements_text(c2) x), 'got', jsonb_build_object('before', c1, 'after', c2));
  select jsonb_object_agg(p.proname, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(TUNED)});
  res := res || jsonb_build_object('case', 'volatility: the hits VOLATILE (draws), the spec IMMUTABLE, the builders STABLE', 'ok', o = ${sqlLit(VOL)}::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(TUNED)}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the replaced functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and replace(p.oid::regprocedure::text, ' ', '') in (${q(TUNED)})
     and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '%combat_v2_monster_tuning.sql%';
  res := res || jsonb_build_object('case', 'every replaced function has a comment that names this file', 'ok', o = '[]'::jsonb, 'got', o);
  res := res || jsonb_build_object('case', 'the column comment of hunt_bosses_v2.weak_to names this file', 'ok',
    coalesce(col_description('public.hunt_bosses_v2'::regclass, (select attnum from pg_attribute where attrelid = 'public.hunt_bosses_v2'::regclass and attname = 'weak_to')), '') like '%combat_v2_monster_tuning.sql%');
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\(' and p.proname <> 'combat_v2_on';
  res := res || jsonb_build_object('case', 'the flag combat_v2 has no reader but combat_v2_on (flag OFF changes nothing)', 'ok', o = '[]'::jsonb, 'got', o);
  select value into o from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', o = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', o);
  -- the data
  res := res || jsonb_build_object('case', 'DATA', 'ok', true,
    'v2_enemy', (select value from balance where key = 'v2_enemy'), 'v2_dungeon', (select value from balance where key = 'v2_dungeon'),
    'notes', (select jsonb_object_agg(key, note) from balance where key in ('v2_enemy', 'v2_dungeon')),
    'logged', (select jsonb_object_agg(l.key, l.new_value) from balance_log l where l.key in ('v2_enemy', 'v2_dungeon') and l.changed_by = 'nathan' and l.op = 'update'
                 and l.id = (select max(l2.id) from balance_log l2 where l2.key = l.key)),
    'mechanics', (select jsonb_object_agg(m.key, jsonb_build_object('text', m.text, 'numbers', m.numbers, 'on_boss', m.on_boss, 'on_foe', m.on_foe)) from public.enemy_mechanics m),
    'bosses', (select jsonb_object_agg(x.key, x.weak_to) from public.hunt_bosses_v2 x),
    'cards', (select jsonb_object_agg(x.key, hunt_boss_v2_card(x.key, 'Mythic')->'weak_to') from public.hunt_bosses_v2 x));
  -- the fixed shape refuses planted values
  o := '[]';
  ${PLANT_BAL.map(([key, nm, ex]) => `begin update public.balance set value = ${ex} where key = '${key}'; o := o || to_jsonb('accepted: ${nm}'::text);
  exception when others then if sqlerrm not like 'balance ${key}:%' then o := o || to_jsonb('${nm}: ' || sqlerrm); end if; end;`).join('\n  ')}
  res := res || jsonb_build_object('case', 'the fixed shape refuses ${PLANT_BAL.length} planted values (${PLANT_BAL.map((x) => x[1]).join(', ')})', 'ok', o = '[]'::jsonb, 'got', o);
  o := '[]';
  ${PLANT_ROWS.map(([nm, ex, msg]) => `begin execute $q$${ex}$q$; o := o || to_jsonb('accepted: ${nm}'::text);
  exception when others then if sqlerrm not like '%${msg}%' then o := o || to_jsonb('${nm}: ' || sqlerrm); end if; end;`).join('\n  ')}
  res := res || jsonb_build_object('case', 'the trigger and the builders refuse ${PLANT_ROWS.length} planted rows and calls, each with its message (${PLANT_ROWS.map((x) => x[0]).join('; ')})', 'ok', o = '[]'::jsonb, 'got', o);
  -- the builders still take the foe pool, the boss signatures and the named boss without options
  begin
    perform combat_v2_dungeon_foe('slime', 3, 2, 'guardian', '["regrowth", "venom", "ironhide"]'::jsonb); perform combat_v2_hunt_boss('Mythic', null, '{"sigs": ["slowing", "ironhide", "venom"]}'::jsonb);
    perform combat_v2_hunt_boss('Heroic', 'zerg', '{"start_frac": 0.5}'::jsonb); ok := true;
  exception when others then ok := false; e := sqlerrm; end;
  res := res || jsonb_build_object('case', 'the builders still take the foe pool mechanics, the boss signature pool and a named boss with its options', 'ok', ok, 'got', e);
  -- idempotent: a second run keeps a changed value and a changed tag
  update public.balance set value = jsonb_set(value, '{mechanics,ironhide,crit_x}', '0.65') where key = 'v2_enemy';
  update public.balance set value = jsonb_set(value, '{passive_params,bulwark,guard}', '0.19') where key = 'v2_dungeon';
  update public.hunt_bosses_v2 set weak_to = '{role:striker}' where key = 'zerg';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'the file runs twice: a second run keeps a changed balance value, a changed tag, and the notes once', 'ok',
    (select (value->'mechanics'->'ironhide'->>'crit_x')::numeric = 0.65 from balance where key = 'v2_enemy') and (select (value->'passive_params'->'bulwark'->>'guard')::numeric = 0.19 from balance where key = 'v2_dungeon')
    and (select weak_to = '{role:striker}' from public.hunt_bosses_v2 where key = 'zerg')
    and (select bool_and((length(note) - length(replace(note, 'The E7 tuning', ''))) / length('The E7 tuning') = 1) from balance where key in ('v2_enemy', 'v2_dungeon')));
  raise exception 'RESULT:%', res::text;
end $t$;`;

// the data against config.json (one number, one home: the simulator and SQL read the same numbers)
function checkData(D) {
  const out = [];
  const M = CONFIG.v2_enemy.mechanics, P = CONFIG.v2_dungeon.passive_params, bm = D.v2_enemy.mechanics, bp = D.v2_dungeon.passive_params;
  const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'text' && !k.startsWith('_')));
  const pairs = [['mechanics.ironhide', bm.ironhide, strip(M.ironhide)], ['mechanics.venom', bm.venom, strip(M.venom)], ['mechanics.slowing', bm.slowing, strip(M.slowing)],
    ['mechanics.regrowth', bm.regrowth, strip(M.regrowth)], ['passive_params.bulwark', bp.bulwark, strip(P.bulwark)], ['passive_params.undying', bp.undying, strip(P.undying)]];
  const bad = pairs.filter(([, a, b]) => JSON.stringify(canon(a)) !== JSON.stringify(canon(b))).map(([k, a, b]) => `${k}: balance ${JSON.stringify(a)} config ${JSON.stringify(b)}`);
  out.push([bad.length === 0 && M.ironhide.crit_x > 0 && M.ironhide.crit_x < 1 && M.venom.chance < 1 && M.slowing.chance < 1 && P.bulwark.every > 2 && P.undying.hp < 0.25 && M.regrowth.heal < 0.01,
    `the tuned balance values = config.json (Ironhide crit_x ${bm.ironhide.crit_x}, Venom chance ${bm.venom.chance}, Slowing chance ${bm.slowing.chance}, Regrowth foe heal ${bm.regrowth.heal}, Bulwark every ${bp.bulwark.every} guard ${bp.bulwark.guard}, Undying ${bp.undying.hp}), and each is a cut of the E7 value`, bad.join(' | ')]);
  out.push([CONFIG.v2_boss_rules.undying.hp === P.undying.hp, `the copy of Undying in config.json v2_boss_rules equals its home v2_dungeon.passive_params.undying (${CONFIG.v2_boss_rules.undying.hp})`]);
  const tx = ['ironhide', 'venom', 'slowing'].map((k) => [k, D.mechanics[k].text, Object.keys(strip(M[k])).filter((f) => !D.mechanics[k].text.includes(`{${f}}`))]);
  out.push([tx.every(([, , miss]) => miss.length === 0), 'the texts of Ironhide, Venom and Slowing name every number of their balance object ({crit_x}, {chance} {poison}, {chance})', JSON.stringify(tx)]);
  const hunt = ['steadfast', 'plated', 'fade', 'brood'].filter((k) => D.mechanics[k].on_foe || !D.mechanics[k].on_boss);
  out.push([hunt.length === 0, 'Steadfast, Plated, Fade and Brood are Hunt boss mechanics only (on_boss true, on_foe false)', hunt.join(', ')]);
  const wb = [];
  for (const k of BOSSES) {
    const C = CONFIG.v2_bosses[k].weak_to || [], R = D.bosses[k] || [], card = D.cards[k] || [];
    if (JSON.stringify(R) !== JSON.stringify(C)) wb.push(`${k}: row ${JSON.stringify(R)} config ${JSON.stringify(C)}`);
    if (JSON.stringify(card) !== JSON.stringify(R)) wb.push(`${k}: card ${JSON.stringify(card)}`);
    if (R.length !== 1 || !/^role:[a-z]+$/.test(R[0]) || ['warden', 'medic', 'spotter', 'herald'].includes(R[0].slice(5)) || !ROLES.includes(R[0].slice(5))) wb.push(`${k}: tag ${JSON.stringify(R)}`);
  }
  out.push([wb.length === 0 && Object.keys(D.bosses).length === BOSSES.length, `hunt_bosses_v2.weak_to = config.json v2_bosses.<key>.weak_to = the card line, for the ${BOSSES.length} bosses: one role tag each (Nathan's 16 primary tags), no support role without a week rule`, wb.join(' | ')]);
  const notes = ['v2_enemy', 'v2_dungeon'].filter((k) => !/The E7 tuning \(2026-10-21, combat_v2_monster_tuning\.sql/.test(D.notes[k]));
  const logged = ['v2_enemy', 'v2_dungeon'].filter((k) => !D.logged || !D.logged[k]);
  out.push([notes.length === 0 && logged.length === 0, 'the notes of v2_enemy and v2_dungeon name the tuning, and the last change of each is logged by nathan', JSON.stringify({ notes, logged })]);
  return out;
}


// ---------------------------------------------------------------------------------------------------------------- the replaced functions = E7 with the E7 numbers
// The same random fights (every enemy action, the E7 driver) with the numbers of E7 (no crit_x, no chance; b is read before this file runs): the states and
// the draw counts are the same with and without this file.
const oldBlock = (specs, withMig) => String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
  ${SETUP}
  b := combat_v2_enemy_numbers();
  ${withMig ? `execute $m$${mig}$m$;` : ''}
  ${FIGHT_DRIVER}
  for x in select v from jsonb_array_elements(${sqlLit(specs)}::jsonb) v loop
    begin out := out || jsonb_build_array(pg_temp.e7fight(x->0, x->1, b));
    exception when others then out := out || jsonb_build_array(jsonb_build_array(jsonb_build_object('event', 'error', 'error', sqlerrm))); end;
  end loop;
  raise exception 'RESULT:%', out::text; end $t$;`;


// ---------------------------------------------------------------------------------------------------------------- the fixed cases (explicit draws, hand-computed answers)
const DRIVER = String.raw`
  create or replace function pg_temp.e7run(p_s jsonb, p_ops jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; op jsonb; r jsonb; out jsonb := '[]';
  begin
    for op in select v from jsonb_array_elements(p_ops) v loop
      begin
        r := case op->>'op'
          when 'next' then combat_v2_next(s, op->'d', p_b)
          when 'turn' then combat_v2_turn_start(s, op->'a', op->'d', p_b)
          when 'enemy' then combat_v2_enemy_act(s, op->'a', jsonb_build_object('draws', op->'d'), p_b)
          when 'card' then combat_v2_card_act(s, op->'a', op->'o', p_b)
          when 'move' then combat_v2_boss_move(s, op->'a', op->'m', op->'d', p_b)
          when 'apply' then combat_v2_status_apply(s, op->'t', op->>'k', op->'o', p_b)
          when 'damage' then combat_v2_damage(s, op->'t', (op->>'amt')::numeric, op->'o', p_b)
          when 'heal' then combat_v2_heal(s, op->'t', (op->>'amt')::numeric, p_b)
          when 'end' then combat_v2_step_end(s, p_b, op->'d')
          when 'cure' then combat_v2_status_cure(s, op->'t', op->'keys', coalesce((op->>'immune')::int, 0), p_b)
          when 'ehit' then combat_v2_enemy_hit(s, op->'a', op->'t', (op->>'x')::numeric, coalesce((op->>'area')::boolean, false), op->'o', op->'d', p_b)
          when 'hit' then jsonb_build_object('hit', combat_v2_hit(s #> combat_v2_unit_path(s, op->'a'), s #> combat_v2_unit_path(s, op->'t'),
                            op->'ctx' || jsonb_build_object('clock', s->'clock', 'mode', s->'mode'), p_b))
          when 'adv' then combat_v2_advance(s, p_b)
          when 'gate' then jsonb_build_object('gate', combat_effect_v2_gate(s, s #> combat_v2_unit_path(s, op->'u'), s #> combat_v2_unit_path(s, op->'t'), op->'att'))
          when 'set' then jsonb_build_object('state', jsonb_set(s, array(select jsonb_array_elements_text(op->'path')), op->'v'))
          when 'check' then jsonb_build_object('problems', to_jsonb(fight_state_check_v2(s)))
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
  b := combat_v2_enemy_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(cases)}::jsonb) v loop
    out := out || jsonb_build_array(pg_temp.e7run(x->0, x->1, b));
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`));
const Cr = (id) => ({ side: 'card', id }), En = (i = 0) => ({ side: 'enemy', id: i });
const mv = (boss, id) => CONFIG.v2_bosses[boss].moves.find((m) => m.id === id);
const C2 = () => ({ 1: { role: 'finisher', max: 1000 }, 2: { role: 'finisher', max: 1000 } });
const CS = () => ({ 1: { role: 'finisher', max: 1000 }, 2: { role: 'medic', max: 1000 }, 3: { role: 'warden', max: 1000 } });
const boss = (o = {}) => ({ hp: 30000, max: 30000, atk: 100, speed: 100, ...o });
const foe = (o = {}) => ({ hp: 1000, max: 1000, atk: 100, speed: 50, ...o });
const nearly = (a, b) => Math.abs(Number(a) - b) <= 1e-6 * Math.max(1, Math.abs(b));
const HP = (r, id) => Number(r.s.cards[id].hp), EHP = (r, i = 0) => Number(r.s.enemies[i].hp);

function fixedCases() {
  const F = [];
  const add = (name, sc, ops, check) => F.push([name, state(sc), ops, check]);
  const M = CONFIG.v2_enemy.mechanics, P = CONFIG.v2_dungeon.passive_params;
  const hitOf = (r) => r.hit || {};
  // ---- Ironhide: unless Marked, the crit chance x crit_x (crt 0.5 x 0.7 = 0.35); Marked: the full chance; crit_x 0 (the E7 rule): no crit and no draw
  add(`Ironhide: crit chance 0.5 x crit_x ${M.ironhide.crit_x} = 0.35 (draw 0.34 crits, 0.36 does not), 3 draws`, { cards: { 1: { role: 'finisher', crt: 0.5 } }, enemies: [foe({ mechanics: ['ironhide'] })] },
    [{ op: 'hit', a: Cr(1), t: En(), ctx: { side: 'card', draws: [0.9, 0.5, 0.34] } }, { op: 'hit', a: Cr(1), t: En(), ctx: { side: 'card', draws: [0.9, 0.5, 0.36] } }],
    (r) => (hitOf(r[0]).crit === true && hitOf(r[1]).crit === false && nearly(hitOf(r[0]).crit_chance, 0.35) && r[0].hit.draws.length === 3 && r[1].hit.draws.length === 3) || JSON.stringify(r.map((x) => [x.error, hitOf(x).crit, hitOf(x).crit_chance, hitOf(x).draws])));
  add('Ironhide + Mark: the full crit chance 0.5 (draw 0.45 crits; no miss draw)', { cards: { 1: { role: 'finisher', crt: 0.5 } }, enemies: [foe({ mechanics: ['ironhide'], status: { mark: { value: 0.1, until: 9 } } })] },
    [{ op: 'hit', a: Cr(1), t: En(), ctx: { side: 'card', draws: [0.5, 0.45] } }], (r) => (hitOf(r[0]).crit === true && nearly(hitOf(r[0]).crit_chance, 0.5)) || JSON.stringify([r[0].error, r[0].hit]));
  add('Ironhide with crit_x 0 (the unit params; the E7 rule): no crit and no crit draw (2 draws)', { cards: { 1: { role: 'finisher', crt: 0.5 } }, enemies: [foe({ mechanics: ['ironhide'], params: { ironhide: { crit_x: 0 } } })] },
    [{ op: 'hit', a: Cr(1), t: En(), ctx: { side: 'card', draws: [0.9, 0.5, 0] } }], (r) => (hitOf(r[0]).crit === false && r[0].hit.draws.length === 2 && Number(hitOf(r[0]).crit_chance) === 0) || JSON.stringify([r[0].error, r[0].hit]));
  add('no Ironhide: the crit chance stays 0.5 (draw 0.45 crits)', { cards: { 1: { role: 'finisher', crt: 0.5 } }, enemies: [foe()] },
    [{ op: 'hit', a: Cr(1), t: En(), ctx: { side: 'card', draws: [0.9, 0.5, 0.45] } }], (r) => hitOf(r[0]).crit === true || JSON.stringify([r[0].error, r[0].hit]));
  // ---- Venom: a single hit poisons with the chance venom.chance (one draw after the roll); chance 1 = always and no draw
  add(`Venom: chance ${M.venom.chance}: draw 0.34 poisons, draw 0.36 does not; 2 draws each`, { cards: C2(), enemies: [foe({ mechanics: ['venom'] })] },
    [{ op: 'ehit', a: En(), t: Cr(1), x: 1, d: [0.5, 0.34] }, { op: 'ehit', a: En(), t: Cr(2), x: 1, d: [0.5, 0.36] }],
    (r) => (r[0].s.cards[1].status.poison?.stacks === 1 && !r[1].s.cards[2].status.poison && r[0].draws.length === 2 && r[1].draws.length === 2) || JSON.stringify(r.map((x) => [x.error, x.draws, x.s.cards])).slice(0, 500));
  add('Venom with chance 1 (the unit params; the E7 rule): every single hit poisons, no chance draw (1 draw)', { cards: C2(), enemies: [foe({ mechanics: ['venom'], params: { venom: { chance: 1 } } })] },
    [{ op: 'ehit', a: En(), t: Cr(1), x: 1, d: [0.5] }], (r) => (r[0].s.cards[1].status.poison?.stacks === 1 && r[0].draws.length === 1) || JSON.stringify([r[0].error, r[0].draws, r[0].s.cards[1]]));
  add('Frost Aura, Venom, Burning in that order: the Venom chance draw comes after the roll; an area hit has no rider and no draw', { cards: C2(), enemies: [foe({ mechanics: ['frost_aura', 'venom', 'burning'] })] },
    [{ op: 'ehit', a: En(), t: Cr(1), x: 1, d: [0.5, 0.2] }, { op: 'ehit', a: En(), t: Cr(2), x: 1, area: true, d: [0.5] }],
    (r) => (r[0].s.cards[1].status.chill?.stacks === 1 && r[0].s.cards[1].status.poison?.stacks === 1 && r[0].s.cards[1].status.burn?.stacks === 2 && r[0].draws.length === 2
      && Object.keys(r[1].s.cards[2].status).length === 0 && r[1].draws.length === 1) || JSON.stringify(r.map((x) => [x.error, x.draws, x.s.cards])).slice(0, 500));
  // ---- Slowing: an area hit Slows with the chance slowing.chance; a single hit has no Slowing draw
  add(`Slowing: chance ${M.slowing.chance}: draw 0.39 Slows, draw 0.41 does not; a single hit has no Slowing draw`, { cards: { 1: { role: 'finisher', max: 1000 }, 2: { role: 'finisher', max: 1000 }, 3: { role: 'finisher', max: 1000 } }, enemies: [foe({ mechanics: ['slowing'] })] },
    [{ op: 'ehit', a: En(), t: Cr(1), x: 0.5, area: true, d: [0.5, 0.39] }, { op: 'ehit', a: En(), t: Cr(2), x: 0.5, area: true, d: [0.5, 0.41] }, { op: 'ehit', a: En(), t: Cr(3), x: 1, d: [0.5] }],
    (r) => (r[0].s.cards[1].status.slowed && !r[1].s.cards[2].status.slowed && !r[2].s.cards[3].status.slowed && r[0].draws.length === 2 && r[1].draws.length === 2 && r[2].draws.length === 1) || JSON.stringify(r.map((x) => [x.error, x.draws])));
  add('Slowing with chance 1 (the unit params; the E7 rule): every area hit Slows, no chance draw', { cards: C2(), enemies: [foe({ mechanics: ['slowing'], params: { slowing: { chance: 1 } } })] },
    [{ op: 'ehit', a: En(), t: Cr(1), x: 0.5, area: true, d: [0.5] }], (r) => (r[0].s.cards[1].status.slowed && r[0].draws.length === 1) || JSON.stringify([r[0].error, r[0].draws]));
  // ---- the tuned numbers: Bulwark, Undying, Regrowth
  add(`Bulwark: every ${P.bulwark.every}rd turn a Guard of ${P.bulwark.guard} x max HP (turn 2 is a move, turn 3 the Guard)`, { cards: C2(), enemies: [foe({ moves: [{ k: 'idle', w: 1 }], mechanics: ['bulwark'], turn: 1 })] },
    [{ op: 'turn', a: En() }, { op: 'enemy', a: En(), d: [0] }, { op: 'turn', a: En() }, { op: 'enemy', a: En(), d: [] }],
    (r) => (r[1].move === 'idle' && r[3].move === 'bulwark' && nearly(r[3].s.enemies[0].status.guarded?.value, 1000 * P.bulwark.guard) && nearly(1000 * P.bulwark.guard, 180)) || JSON.stringify(r.map((x) => [x.move, x.error])));
  add(`Undying: once a fight it comes back at ${P.undying.hp} x max HP (150 of 1000)`, { cards: C2(), enemies: [foe({ hp: 10, mechanics: ['undying'] })] }, [{ op: 'damage', t: En(0), amt: 50 }],
    (r) => (nearly(EHP(r[0], 0), 150) && r[0].s.enemies[0].undying_used && !r[0].s.enemies[0].down) || JSON.stringify([r[0].error, r[0].s.enemies[0]]));
  add(`Regrowth: a Dungeon foe heals ${M.regrowth.heal} x its max HP a step (7 of 1000); the Hunt boss keeps boss_heal`, { cards: C2(), enemies: [foe({ hp: 600, mechanics: ['regrowth'] })] }, [{ op: 'end', d: [] }],
    (r) => nearly(EHP(r[0]), 607) || EHP(r[0]));
  add('Regrowth on the Hunt boss: boss_heal x boss_heal_ref (12), not the foe number', { mode: 'hunt', cards: C2(), enemies: [boss({ hp: 20000, mechanics: ['regrowth'] })] }, [{ op: 'end', d: [] }],
    (r) => nearly(EHP(r[0]), 20012) || EHP(r[0]));
  return F;
}


// ---------------------------------------------------------------------------------------------------------------- the builders, the template and ONE SOURCE
// agree: the card line, the fight unit, and a hit of the weak role on the built boss with and without its weak_role (the ratio is 1 + the week bonus)
const buildBlock = (items) => String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; u jsonb; c jsonb; ctx jsonb; h1 jsonb; h2 jsonb; begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    if x->>0 = 'agree' then
      u := combat_v2_hunt_boss(x->>1, x->>2, '{"start_frac": 1}'::jsonb, b);
      c := jsonb_build_object('role', coalesce(u->>'weak_role', 'breaker'), 'class', 'attacker', 'atk', 100, 'crt', 0, 'crd', 2, 'abl', 1, 'acc', 0, 'def', 0, 'ddg', 0, 'hp', 100, 'max', 100, 'status', '{}'::jsonb);
      ctx := jsonb_build_object('side', 'card', 'x', 1, 'clock', 1, 'mode', 'hunt', 'foes_alive', 2, 'draws', '[0.99, 0.5, 0.99]'::jsonb);
      h1 := combat_v2_hit(c, u, ctx, b); h2 := combat_v2_hit(c, u - 'weak_role', ctx, b);
      out := out || jsonb_build_array(jsonb_build_object('card', hunt_boss_v2_card(x->>2, x->>1)->'weak_to', 'unit', u->'weak_role', 'd1', h1->'dmg', 'd2', h2->'dmg'));
    else
      out := out || jsonb_build_array(case x->>0 when 'boss' then combat_v2_hunt_boss(x->>1, x->>2, x->3, b)
                                                when 'foe' then combat_v2_dungeon_foe(x->>1, (x->>2)::int, (x->>3)::int, x->>4, x->5, b)
                                                else hunt_boss_v2_card(x->>1, x->>2) end);
    end if;
  end loop;
  raise exception 'RESULT:%', out::text; end $t$;`;


// ---------------------------------------------------------------------------------------------------------------- the fuzz and the draw replay (random() after setseed)
const fuzzBlock = (specs) => String.raw`do $t$
declare b jsonb; s jsonb; r jsonb; x jsonb; ac jsonb; f int := 0; j int; bad jsonb := '[]'; n int := 0; ne int := 0; lst text[]; t jsonb; al jsonb; u0 jsonb; usex boolean; c int; rp jsonb; same int := 0;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers();
  perform setseed(0.77);
  for x in select v from jsonb_array_elements(${sqlLit(specs)}::jsonb) v loop
    s := x; f := f + 1;
    for j in 1 .. 200 loop
      begin
        r := combat_v2_next(s, null, b);
        if r->>'event' = 'act' then
          -- the replay of next with its draws
          rp := combat_v2_next(s, r->'draws', b);
          if rp->'state' is distinct from r->'state' then bad := bad || to_jsonb('next replay differs'::text); end if;
        end if;
        s := r->'state';
        exit when r->>'event' <> 'act';
        continue when (r->>'skip')::boolean;
        ac := r->'actor';
        if ac->>'side' = 'enemy' then
          r := combat_v2_enemy_act(s, ac, '{}'::jsonb, b);
          rp := combat_v2_enemy_act(s, ac, jsonb_build_object('draws', r->'draws'), b);
          ne := ne + 1;
        else
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
          t := jsonb_build_object('side', 'enemy', 'id', lst[floor(random() * cardinality(lst))::int + 1]::numeric);
          lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
          al := jsonb_build_object('side', 'card', 'id', lst[floor(random() * cardinality(lst))::int + 1]::numeric);
          u0 := s #> combat_v2_unit_path(s, ac);
          c := (b->'v2_charge'->>(u0->>'class'))::int;
          usex := random() < 0.7 and coalesce((u0->>'charge')::int, 0) >= c;
          r := combat_v2_card_act(s, ac, jsonb_build_object('use', usex, 'target', t, 'ally', al), b);
          rp := combat_v2_card_act(s, ac, jsonb_build_object('use', usex, 'target', t, 'ally', al, 'draws', r->'draws'), b);
        end if;
        if rp->'state' = r->'state' and rp->'draws' = r->'draws' then same := same + 1; else bad := bad || to_jsonb('replay differs'::text); end if;
        s := r->'state'; n := n + 1;
      exception when others then bad := bad || to_jsonb('error: ' || sqlerrm); exit;
      end;
      if cardinality(fight_state_check_v2(s)) > 0 then bad := bad || to_jsonb('state: ' || array_to_string(fight_state_check_v2(s), '; ')); end if;
      for u0 in select v2 from jsonb_each(s->'cards') e(k2, v2) union all select v2 from jsonb_array_elements(s->'enemies') v2 loop
        if (u0->>'hp')::numeric < 0 or (u0->>'hp')::numeric > (u0->>'max')::numeric then bad := bad || to_jsonb('hp ' || u0::text); end if;
        if ((u0->>'down')::boolean or (u0->>'hp')::numeric <= 0) and (u0->'status' <> '{}'::jsonb or not (u0->>'down')::boolean) then bad := bad || to_jsonb('down ' || left(u0::text, 300)); end if;
      end loop;
      exit when jsonb_array_length(bad) > 5;
    end loop;
    exit when jsonb_array_length(bad) > 5;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('fights', f, 'actions', n, 'enemy', ne, 'replay_same', same, 'bad', bad)::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- run
const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - b) <= rel * Math.max(1, Math.abs(b));
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const NUMBERS = async () => JSON.parse(await runBlock(String.raw`do $t$ declare b jsonb; begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_enemy_numbers();
  raise exception 'RESULT:%', jsonb_build_object('b', b, 'ab', ability_v2_numbers())::text; end $t$;`));
// the simulator config with the numbers of the database (the balance values replace config.json; ability_v2 as a whole)
const simCfg = (N) => { const B = { ...N.b }; delete B.enemy_v2; const c = patch(CONFIG, { ...B, v2_pp: N.ab.v2_pp }); c.ability_v2 = JSON.parse(JSON.stringify(N.ab.ability_v2)); return c; };
export async function parity(FS, cfg) {
  let fsame = 0, ftie = 0, facts = 0; const fbad = []; const fev = { end: 0, cap: 0, skip: 0, active: 0, basic: 0, enemy: 0, counter: 0 };
  for (let i = 0; i < FS.length; i += 8) {
    const part = FS.slice(i, i + 8);
    const out = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
      ${SETUP}
      execute $m$${mig}$m$;
      ${FIGHT_DRIVER}
      b := combat_v2_enemy_numbers();
      for x in select v from jsonb_array_elements(${sqlLit(part)}::jsonb) v loop
        begin out := out || jsonb_build_array(pg_temp.e7fight(x->0, x->1, b));
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
          if (w.action !== null && (a.action ?? null) !== w.action) m.push(`action SQL ${a.action} sim ${w.action}`);
          if (a.n !== w.n) m.push(`draws SQL ${a.n} sim ${w.n}`);
        }
        m.push(...sameSum(sqlSum(a.u, cfg), w.u));
        if (m.length) { diff = { k, msg: m.slice(0, 4).join('; ') + ` [SQL action ${a.action}]`, tie: w.nearTie }; break; }
        if (a.event === 'act') {
          facts++; if (a.skip) fev.skip++; else if (a.actor.side === 'enemy') { fev.enemy++; if (w.action) fev.counter++; } else if (a.action) fev[a.action]++;
        } else fev[a.event] = (fev[a.event] || 0) + 1;
      }
      if (!diff) fsame++; else if (diff.tie) ftie++; else if (fbad.length < 6) fbad.push(`fight ${i + j} action ${diff.k}: ${diff.msg}`); else fbad.push('');
    });
  }
  return { fsame, ftie, facts, fbad, fev };
}


const isMain = /test-combat-v2-monster-tuning\.mjs$/.test(process.argv[1] || '');
if (isMain) {
try {
  const ONLY = process.env.ONLY || '';
  const N = await NUMBERS(); const B = N.b; const cfg = simCfg(N);
  if (!ONLY || ONLY === 'block1') {
    const R = JSON.parse(await runBlock(body1()));
    for (const r of R.filter((x) => x.case !== 'DATA')) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
    for (const [ok, name, extra] of checkData(R.find((x) => x.case === 'DATA'))) say(ok, name, String(extra).slice(0, 900));
  }
  if (!ONLY || ONLY === 'old') {
    const nf = Number(process.env.V2_OLD || 60);
    const PS = [...fightSpecs(nf, 4242, B), ...['ironhide', 'venom', 'slowing'].flatMap((m, j) => fightSpecs(Math.max(2, Math.round(nf / 10)), 4300 + j, B, { force: m, roles: ['cleaver', 'artillery', 'striker', 'warden'] }))];
    const A = [], Z = [];
    for (let i = 0; i < PS.length; i += 8) { A.push(...JSON.parse(await runBlock(oldBlock(PS.slice(i, i + 8), false)))); Z.push(...JSON.parse(await runBlock(oldBlock(PS.slice(i, i + 8), true)))); }
    const errs = A.flat().filter((x) => x.event === 'error').length + Z.flat().filter((x) => x.event === 'error').length;
    const diffs = A.map((a, i) => (JSON.stringify(canon(a)) === JSON.stringify(canon(Z[i])) ? null : i)).filter((x) => x !== null);
    const acts = A.flat().filter((x) => x.event === 'act').length;
    say(diffs.length === 0 && errs === 0 && acts > 15 * PS.length, `the replaced functions give the E7 answers with the E7 numbers (no crit_x, no chance) on ${PS.length} random fights with every enemy action (Ironhide, Venom and Slowing forced in ${PS.length - nf}; ${acts} actions, every state and draw count equal)`,
      JSON.stringify({ diffs: diffs.slice(0, 5), errs }));
  }
  if (!ONLY || ONLY === 'fixed') {
    const FIX = fixedCases();
    const rows = await runOps(FIX.map((f) => [f[1], f[2]]));
    FIX.forEach(([name, , , check], i) => {
      const r = rows[i]; let res; try { res = check(r, B); } catch (e) { res = `check raised: ${e.message} ${JSON.stringify(r.map((x) => x.error || Object.keys(x)))}`.slice(0, 600); }
      say(res === true, `fixed: ${name}`, String(res).slice(0, 900));
    });
  }
  if (!ONLY || ONLY === 'build') {
    const items = []; const want = [];
    const rng = mkRng(55);
    for (const k of BOSSES) for (const tier of ['Normal', 'Heroic', 'Mythic']) {
      const f = Math.round(rng() * 1000) / 1000; items.push(['boss', tier, k, { start_frac: f }]);
      const sb = makeBoss(cfg, tier, { boss: k, startFrac: f }); const u = new Battle(cfg, { cards: [], enemies: [sb], mode: 'hunt', policy: POLICIES.best, seed: 1 }).enemies[0]; want.push(['boss', k, tier, u]);
    }
    for (const tier of ['Normal', 'Heroic', 'Mythic']) { items.push(['boss', tier, null, { sigs: ['slowing', 'ironhide', 'venom', 'regrowth'], start_frac: 1 }]);
      const u = new Battle(cfg, { cards: [], enemies: [makeBoss(cfg, tier, { sigs: ['slowing', 'ironhide', 'venom', 'regrowth'], startFrac: 1 })], mode: 'hunt', policy: POLICIES.best, seed: 1 }).enemies[0]; want.push(['boss', null, tier, u]); }
    for (let i = 0; i < 120; i++) {
      const fl = 1 + Math.floor(rng() * 12), room = 1 + Math.floor(rng() * 5), kind = ['fight', 'horde', 'elite', 'miniboss', 'guardian'][Math.floor(rng() * 5)];
      const f = makeFoe(cfg, fl, room, kind, mkRng(1000 + i), i % 7 === 0 ? ['volatile_core'] : []);
      const own = ownPassives(cfg, f.monster, kind); const picked = f.mech.filter((m) => !own.slot.includes(m) && !own.extra.includes(m));
      items.push(['foe', f.monster, fl, room, kind, picked]);
      const u = new Battle(cfg, { cards: [], enemies: [f], mode: 'dungeon', policy: POLICIES.best, seed: 1 }).enemies[0]; want.push(['foe', f.monster, kind, u, f]);
    }
    for (const k of BOSSES) for (const tier of ['Normal', 'Heroic', 'Mythic']) items.push(['agree', tier, k]);
    const got = JSON.parse(await runBlock(buildBlock(items)));
    const bad = [];
    want.forEach((w, i) => {
      const g = got[i], u = w[3];
      const fields = [['max', u.maxHp], ['hp', u.hp], ['atk', u.atk], ['def', u.def], ['evasion', u.evasion], ['resolve', u.resolve], ['keen', u.keen], ['speed', u.speedBase], ['brood', u.brood || 0]];
      for (const [f, v] of fields) if (!near(g[f] ?? 0, v ?? 0)) bad.push(`${w[0]} ${w[1]} ${w[2]}: ${f} SQL ${g[f]} sim ${v}`);
      if (JSON.stringify([...u.mech]) !== JSON.stringify(g.mechanics)) bad.push(`${w[0]} ${w[1]}: mechanics SQL ${JSON.stringify(g.mechanics)} sim ${JSON.stringify([...u.mech])}`);
      if (!!g.healer !== !!u.healer) bad.push(`${w[0]} ${w[1]}: healer`);
      if (w[0] === 'boss' && (g.weak_role ?? null) !== (u.weakRole ?? null)) bad.push(`boss ${w[1]} ${w[2]}: weak_role SQL ${g.weak_role} sim ${u.weakRole}`);
      if (w[0] === 'boss' && w[1]) {
        if (JSON.stringify([...u.immune]) !== JSON.stringify(g.resists) || g.counter_share !== u.counterShare || JSON.stringify(canon(g.moves2)) !== JSON.stringify(canon(u.moves2))) bad.push(`boss ${w[1]} ${w[2]}: resists, counter_share or moves`);
      }
      if (w[0] === 'foe' && (JSON.stringify(g.moves.map((m) => [m.k, m.w])) !== JSON.stringify(u.moves) || !!g.cataclysm !== !!w[4].cataclysm)) bad.push(`foe ${w[1]}: moves or cataclysm`);
    });
    say(bad.length === 0, `the builders = the simulator: combat_v2_hunt_boss = makeBoss + Battle.unit for the ${BOSSES.length} named bosses at each tier (with the weak_role of the boss) and the tier boss with Slowing, Ironhide, Venom and Regrowth (no weak_role); combat_v2_dungeon_foe = makeFoe for 120 random foes (the pool picks, the own passives, Volatile Core)`, bad.slice(0, 6).join(' | '));
    const ag = got.slice(want.length); const ab = []; let n = 0;
    for (const k of BOSSES) for (const tier of ['Normal', 'Heroic', 'Mythic']) {
      const a = ag[n++]; const role = weakRoleOf(CONFIG.v2_bosses[k]); const simRole = makeBoss(cfg, tier, { boss: k }).weakRole;
      const x = 1 + (cfg.v2_enemy.weak_role_rules?.[role]?.damage_x ?? cfg.v2_enemy.weak_role_x);
      if (!role || a.unit !== role || simRole !== role || JSON.stringify(a.card) !== JSON.stringify([`role:${role}`])) ab.push(`${k} ${tier}: card ${JSON.stringify(a.card)} unit ${a.unit} sim ${simRole} config ${role}`);
      if (!near(Number(a.d1) / Number(a.d2), x, 1e-9)) ab.push(`${k} ${tier}: the ${role} hit x${(Number(a.d1) / Number(a.d2)).toFixed(4)}, want x${x}`);
    }
    say(ab.length === 0, `ONE SOURCE: for the ${BOSSES.length} bosses at each tier the card line (hunt_boss_v2_card.weak_to), the fight unit (combat_v2_hunt_boss weak_role), the simulator (makeBoss) and config.json name the same role, and a hit of that role on the built boss deals x (1 + weak_role_x) (the Controller x1: its own rule)`, ab.slice(0, 6).join(' | '));
  }
  if (!ONLY || ONLY === 'parity') {
    const nf = Number(process.env.V2_FIGHTS || 120);
    const FS = [...fightSpecs(nf, 7007, B),
      ...['ironhide', 'venom', 'slowing'].flatMap((m, j) => fightSpecs(Math.max(3, Math.round(nf / 8)), 9100 + j, B, { force: m, roles: ['cleaver', 'artillery', 'striker', 'warden', 'controller', 'medic'] })),
      ...BOSSES.flatMap((k, j) => fightSpecs(Math.max(2, Math.round(nf / 40)), 9300 + j, B, { boss: k, mode: 'hunt', roles: ['medic', 'controller', 'herald', 'warden', 'artillery', weakRoleOf(CONFIG.v2_bosses[k])] }))];
    const P = await parity(FS, cfg);
    say(P.fsame + P.ftie === FS.length && P.fbad.length === 0, `SQL = the simulator on ${FS.length} random fights with every enemy action (Hunt: the named bosses with their Weak to role and tier bosses, Dungeon: the monsters; Ironhide, Venom and Slowing forced in ${FS.length - nf - BOSSES.length * Math.max(2, Math.round(nf / 40))}): ${P.fsame} equal action by action (${P.facts} actions: ${P.fev.enemy} enemy actions of which ${P.fev.counter} counter moves, ${P.fev.active} actives, ${P.fev.basic} basic attacks, ${P.fev.skip} skips; ${P.fev.end} end, ${P.fev.cap} cap), ${P.ftie} differ only after a float near-tie of the simulator`,
      P.fbad.filter(Boolean).join(' | '));
    say(P.ftie <= Math.ceil(FS.length * 0.05), `the float near-ties are rare (${P.ftie} of ${FS.length} fights, at most 5%)`);
    say(P.fev.counter >= FS.length / 2 && P.fev.enemy >= 10 * FS.length / 2, `the fights reach the enemy actions and the counter moves (${JSON.stringify(P.fev)})`);
  }
  if (!ONLY || ONLY === 'fuzz') {
    const fz = JSON.parse(await runBlock(fuzzBlock(fightSpecs(Number(process.env.V2_FUZZ || 40), 808, B).map((x) => x[0]))));
    say(fz.bad.length === 0 && fz.actions >= 8 * fz.fights && fz.enemy >= 3 * fz.fights && fz.replay_same === fz.actions,
      `fuzz: ${fz.actions} random actions (${fz.enemy} enemy actions) with random(): the state passes fight_state_check_v2, HP in [0, max], a down unit has no status; a replay with the answer's draws gives the same action (${fz.replay_same}) and the same clock step (next)`,
      JSON.stringify(fz).slice(0, 900));
  }
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
}
