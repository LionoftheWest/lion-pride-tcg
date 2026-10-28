import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_set2_parts.sql (combat v2, Set 2 engine parts (b) and (c); plan 20.15; Nathan 2026-10-28). NO lasting
 * change: every request is one DO block, undone by its final RAISE. V1, E1 to E7 and this file run inside each block (all idempotent), so the test passes
 * before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-set2-parts.mjs     must PASS
 *   MUTATE=<name> ...                                                                              must FAIL, for every name in MUT and SIM_MUT below
 *   MUTATE=all ...                                                                                 the baseline (must PASS), then every mutation, one line each
 * The reference is the simulator card-studio/v2sim (cards.mjs blockPP and minShareErrors, engine.mjs doActive and hasAny) with the numbers of the database.
 * Knobs: V2_FIGHTS (random fights, 80), V2_PP (random abilities for the PP, 500), V2_OLD (fights before and after the file, 24).
 * Invariants:
 *   1. No change in play: the md5 of every other public function is the same after the file (6 replaced, 1 added); the flag stays OFF; server only; comments;
 *      no v1 caller; the md5 guard stops a live function that changed (before and after the file); the file runs twice; the balance leaf is new and logged.
 *      An ability with none of the new parts has the same validator answer (PP, text, errors, Silver) and the same fights as before (the old answers).
 *   2. (b) dispel, heal_all and quicken (self) are blocks of an attacker: the rules (self only on an attacker quicken, once; no gate after a dispel), the
 *      price (the support library price x sup_cycle / C), the text, the action (dispel before the hits, heal_all and quicken after them, no draw).
 *   3. (c) kinds on line_status and payoff_dmg: the field rules, the price (raw x the measured share status_kinds.<N>), the minimum share rule, the text,
 *      the action (the execute line, the payoffs on the main hit, on each area hit and on a support smite).
 *   4. SQL = the simulator: the PP of every block of random abilities that use the parts (also with changed numbers), and 120 random fights action by action.
 *   5. The 5 private Set 2 actives (when the private file exists, never in this repo): the counts of accepted actives and the PP.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { blockPP, templatePP } from '../v2sim/cards.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { loadConfig, patch, mkRng } from '../v2sim/util.mjs';
import { SETUP, setMig, runOps, parity, simCfg, fightSpecs, state, genAbility, FIGHT_DRIVER, simFight } from './test-combat-v2-monster-tuning.mjs';
assertLocal('test-combat-v2-set2-parts.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_set2_parts.sql');
const CONFIG = loadConfig();

// Planted faults in the SQL (each must make the test FAIL). Each pattern matches the file exactly once.
const MUT = {
  // (b) the action
  dispel_not_done: ["      elsif k = 'dispel' then s := combat_v2_status_strip(s, p_target, null, p_b)->'state';\n", "      elsif k = 'dispel' then null;\n"],
  heal_all_skips_self: ["        for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop\n          s := combat_v2_heal(",
    "        for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and q.id <> p_actor->>'id' order by q.n loop\n          s := combat_v2_heal("],
  heal_all_no_abl: ["(blk->>'v')::numeric * ab * (s->'cards'->id->>'max')::numeric, p_b)->'state';\n        end loop;\n      else", "(blk->>'v')::numeric * (s->'cards'->id->>'max')::numeric, p_b)->'state';\n        end loop;\n      else"],
  heal_all_not_collected: ["      elsif k in ('heal_all', 'quicken') then post := post || jsonb_build_array(blk);", "      elsif k in ('quicken') then post := post || jsonb_build_array(blk);"],
  quicken_not_collected: ["      elsif k in ('heal_all', 'quicken') then post := post || jsonb_build_array(blk);", "      elsif k in ('heal_all') then post := post || jsonb_build_array(blk);"],
  quicken_target: ["combat_v2_status_apply(s, p_actor, 'quickened', jsonb_build_object('value', 1 + (blk->>'v')::numeric * ab, 'src', p_actor), p_b)->'state';\n      end if;\n    end loop;\n",
    "combat_v2_status_apply(s, p_target, 'quickened', jsonb_build_object('value', 1 + (blk->>'v')::numeric * ab, 'src', p_actor), p_b)->'state';\n      end if;\n    end loop;\n"],
  quicken_value: ["jsonb_build_object('value', 1 + (blk->>'v')::numeric * ab, 'src', p_actor), p_b)->'state';\n      end if;\n    end loop;\n", "jsonb_build_object('value', (blk->>'v')::numeric * ab, 'src', p_actor), p_b)->'state';\n      end if;\n    end loop;\n"],
  // (c) the action
  holds_ignores_kinds: ["      or (p_blk ? 'kinds' and combat_effect_v2_count(p_unit, null, null, p_clk, p_b) >= (p_blk->>'kinds')::numeric);", "      or false;"],
  holds_kinds_strict: ["combat_effect_v2_count(p_unit, null, null, p_clk, p_b) >= (p_blk->>'kinds')::numeric", "combat_effect_v2_count(p_unit, null, null, p_clk, p_b) > (p_blk->>'kinds')::numeric"],
  holds_status_dropped: ["  select ((p_blk ? 'status' or p_blk ? 'statuses') and combat_effect_v2_has(p_unit, p_blk, p_clk))", "  select false"],
  execute_old_line: ["           or exists (select 1 from jsonb_array_elements(blocks) y where y->>'k' = 'line_status' and combat_effect_v2_holds(tu, y, clk, p_b)) then",
    "           or exists (select 1 from jsonb_array_elements(blocks) y, jsonb_array_elements_text(y->'statuses') z where y->>'k' = 'line_status' and combat_v2_status_on(tu, z, clk) is not null) then"],
  area_pays_old_has: ["combat_effect_v2_holds(au, blk, clk, p_b)", "combat_effect_v2_has(au, blk, clk)"],
  // the prices
  price_kinds_assumed: ["k * v * case when p_block ? 'kinds' then ks else least(1, (r->>'payoff')::numeric + lx) end\n", "k * v * least(1, (r->>'payoff')::numeric + lx)\n"],
  price_kinds_support_assumed: ["else (su->>'smite')::numeric * v * sk * case when p_block ? 'kinds' then ks else least(1, (r->>'payoff')::numeric + lx) end end", "else (su->>'smite')::numeric * v * sk * least(1, (r->>'payoff')::numeric + lx) end"],
  price_line_kinds_dropped: ["             * (select (y->>'v')::numeric from jsonb_array_elements(p_blocks) y where y->>'k' = 'execute' limit 1) * sh;", "             * 0;"],
  price_line_kinds_not_att_k: ["      v := ability_v2_block_pp(blk, p_class, strikes, p_b)\n           + (av->'pp'->>'att_k')::numeric / ((p_b->'v2_charge'->>p_class)::numeric + 1)", "      v := ability_v2_block_pp(blk, p_class, strikes, p_b)\n           + (av->'pp'->>'sup_cycle')::numeric / ((p_b->'v2_charge'->>p_class)::numeric + 1)"],
  price_line_status_null: ["coalesce(jsonb_array_length(case when jsonb_typeof(p_block->'statuses') = 'array' then p_block->'statuses' end), 0)", "jsonb_array_length(case when jsonb_typeof(p_block->'statuses') = 'array' then p_block->'statuses' end)"],
  price_share_unchecked: ["  if p_block ? 'kinds' and ks is null then raise exception 'ability_v2_block_pp: balance ability_v2 has no share.status_kinds for % statuses', p_block->>'kinds'; end if;\n", ''],
  // the validator
  kinds_range_off: ["      if not kns ? (blk->>'kinds') then\n", "      if false then\n"],
  kinds_alone_off: ["      if k = 'payoff_dmg' and (blk ? 'status' or blk ? 'statuses') then errs := errs || format('%s: kinds stands alone (no status or statuses)', at); end if;\n", ''],
  line_needs_off: ["      errs := errs || format('%s: needs %s', at, case when k = 'line_status' then 'statuses or kinds' else 'status or statuses (one of the two)' end);", "      if k <> 'line_status' then errs := errs || format('%s: needs %s', at, 'status or statuses (one of the two)'); end if;"],
  self_not_required: ["      if blk->'self' is distinct from 'true'::jsonb then errs := errs", "      if false then errs := errs"],
  support_self_allowed: ["    elsif k = 'quicken' and blk ? 'self' then\n      errs := errs || format('%s: self is for an attacker quicken (a support picks an ally)', at);\n", "    elsif false then\n      errs := errs || format('%s: self is for an attacker quicken (a support picks an ally)', at);\n"],
  self_all_allowed: ["      elsif blk ? 'all' or blk ? 'to' then errs := errs || format('%s: a self quicken has no all and no to', at); end if;", "      elsif false then errs := errs || format('%s: a self quicken has no all and no to', at); end if;"],
  one_quicken_off: ["      if (select count(*) from jsonb_array_elements(blocks) x where x->>'k' = 'quicken') > 1 then", "      if false then"],
  dispel_gate_allowed: ["      elsif cls = 'attacker' and hk = 'dispel' then errs", "      elsif false then errs"],
  min_share_ignores_kinds: ["               when k in ('line_status', 'payoff_dmg') and blk ? 'kinds' then (kns->>(blk->>'kinds'))::numeric\n", ''],
  min_share_message: ["when k in ('line_status', 'payoff_dmg') and blk ? 'kinds' then format('block %s (%s kinds %s)', i + 1, k, blk->>'kinds') else at end", "else at end"],
  // the text
  text_dispel_last: ["    if exists (select 1 from jsonb_array_elements(p_blocks) x where x->>'k' = 'dispel') then outs := outs || ability_v2_fill(bl->'dispel'->'text'->>'attacker', '{}'::jsonb); end if;\n    outs := outs || (s || '.');\n",
    "    outs := outs || (s || '.');\n    if exists (select 1 from jsonb_array_elements(p_blocks) x where x->>'k' = 'dispel') then outs := outs || ability_v2_fill(bl->'dispel'->'text'->>'attacker', '{}'::jsonb); end if;\n"],
  text_kinds_list_dropped: ["          if o ? 'kinds' then lst := lst || ability_v2_fill(bl->'line_status'->'text'->>'kinds', ability_v2_vals(o)); end if;", "          if false then lst := lst; end if;"],
  text_self_faster: ["tx->>case when (blk->>'v')::numeric + 1 = (b->'v2_status'->'quickened'->>'x')::numeric then 'self' else 'self_faster' end", "tx->>'self'"],
  text_support_kinds: ["tx->>case when blk ? 'kinds' then 'kinds_support' else 'support' end", "tx->>'support'"],
  // the data
  row_dispel_support_only: ["  classes = '{attacker,support}',\n  price = 'v2_pp.support_pp.dispel", "  classes = '{support}',\n  price = 'v2_pp.support_pp.dispel"],
  row_heal_all_support_only: ["  classes = '{attacker,support}',\n  rule = 'Heals every standing ally", "  classes = '{support}',\n  rule = 'Heals every standing ally"],
  row_quicken_no_self: ["fields = fields || '{\"self\": {\"type\": \"flag\", \"required\": false}}'::jsonb,", "fields = fields,"],
  row_self_text: ['"self": "Quicken this card."', '"self": "Quicken itself."'],
  row_dispel_text: ['"attacker": "First, remove the target\'\'s shield and boosts."', '"attacker": "Remove the target\'\'s shield and boosts."'],
  row_kinds_text: ['"kinds": "with {kinds#} or more statuses"', '"kinds": "with {kinds#} statuses"'],
  balance_share_value: ['\'{"2": 0.0757, "3": 0.0059, "4": 0.0002, "5": 0}\'', '\'{"2": 0.0757, "3": 0.5, "4": 0.0002, "5": 0}\''],
  balance_update_always: ["\n where key = 'ability_v2' and not value->'share' ? 'status_kinds';", "\n where key = 'ability_v2';"],
  spec_kinds_wide: ['"3": "num 0 1"', '"3": "num 0 9"'],
  spec_kinds_missing: ['"status_kinds": {"2": "num 0 1", "3": "num 0 1", "4": "num 0 1", "5": "num 0 1"}}', '"status_kinds": {"2": "num 0 1", "4": "num 0 1", "5": "num 0 1"}}'],
  // the guard, the rights, the comments, the play
  guard_off: ["    if m not in (r.md5_from, r.md5_own) then\n", "    if false then\n"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.combat_effect_v2_holds\([^)]*\) is \$cm\$[^\n]*\n/, ''],
  flag_on: ['-- ============================================================ 7. server only, and the comments of the generated docs', "update public.balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';\n-- ============================================================ 7. server only, and the comments of the generated docs"],
  v1_touched: ['-- ============================================================ 7. server only, and the comments of the generated docs',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::integer $fn$;\n-- ============================================================ 7. server only, and the comments of the generated docs"],
};
// Planted faults in the simulator and its config (in this process): SQL = the simulator must catch each
const SIM_MUT = {
  sim_kinds_ignored: () => { Battle.prototype.hasAny = function (u, b) { return b.statuses ? b.statuses.some((s) => this.has(u, s)) : this.has(u, b.status); }; },
  sim_kinds_strict: () => { Battle.prototype.hasAny = function (u, b) { return (b.statuses ? b.statuses.some((s) => this.has(u, s)) : b.status !== undefined && this.has(u, b.status)) || (b.kinds !== undefined && this.negKinds(u) > b.kinds); }; },
  sim_share_old: () => { CONFIG.ability_v2.share.status_kinds[3] = 0.5; },
  sim_dispel_late: () => {
    const d0 = Battle.prototype.doActive;
    Battle.prototype.doActive = function (u, tgt) { const strip = u.cls === 'attacker' && u.active.blocks.some((b) => b.k === 'dispel'); const blocks = u.active.blocks;
      if (!strip) return d0.call(this, u, tgt);
      u.active = { ...u.active, blocks: blocks.filter((b) => b.k !== 'dispel') }; const r = d0.call(this, u, tgt); u.active = { ...u.active, blocks };
      for (const s of ['shielded', 'empowered', 'focused', 'quickened', 'enraged']) delete tgt.st[s]; tgt.shield = 0; return r; };
  },
  sim_heal_all_crit: () => {
    const d0 = Battle.prototype.doActive;
    Battle.prototype.doActive = function (u, tgt) { const had = u.cls === 'attacker' && u.active.blocks.some((b) => b.k === 'heal_all'); const r = d0.call(this, u, tgt); if (had) u.rng(); return r; };
  },
  sim_quicken_ally: () => {
    const d0 = Battle.prototype.doActive;
    Battle.prototype.doActive = function (u, tgt) { const b = u.active.blocks.find((x) => x.k === 'quicken'); const r = d0.call(this, u, tgt);
      if (u.cls === 'attacker' && b && u.st.quickened) { const o = this.alive('card').find((c) => c !== u); if (o) { o.st.quickened = u.st.quickened; delete u.st.quickened; } } return r; };
  },
};

if (process.env.MUT_CHECK) {   // no database: every planted fault must match the file exactly once
  let bad = 0;
  for (const [name, m] of Object.entries(MUT)) {
    const n = m[0] instanceof RegExp ? (mig.match(new RegExp(m[0].source, 'g')) || []).length : mig.split(m[0]).length - 1;
    if (n !== 1) { bad++; console.log(`FAIL ${name}: ${n} matches`); }
  }
  console.log(bad ? `${bad} mutation patterns do not match once` : `all ${Object.keys(MUT).length} mutation patterns match the file exactly once (+ ${Object.keys(SIM_MUT).length} simulator faults)`);
  process.exit(bad ? 1 : 0);
}
if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)       ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  let caughtN = 0; const names = [...Object.keys(MUT), ...Object.keys(SIM_MUT)];
  for (const name of names) {
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line) && !/deadlock detected/.test((r.stdout || '') + (r.stderr || ''));
    if (!caught) ok = false; else caughtN++;
    const fails = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5, 60));
    console.log(`mutation ${name.padEnd(28)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  first: ${(fails[0] || (r.stderr || '').trim().split(/\r?\n/).pop() || '').slice(0, 70)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${caughtN} of ${names.length} caught` : `mutations: FAIL (a red baseline or a mutation not caught: ${caughtN} of ${names.length})`);
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const name = process.env.MUTATE;
  if (SIM_MUT[name]) SIM_MUT[name]();
  else {
    const m = MUT[name];
    if (!m) throw new Error(`unknown mutation ${name}`);
    const n = m[0] instanceof RegExp ? (mig.match(new RegExp(m[0].source, 'g')) || []).length : mig.split(m[0]).length - 1;
    if (n !== 1) throw new Error(`the mutation ${name} does not match the migration exactly once (${n})`);
    mig = m[0] instanceof RegExp ? mig.replace(m[0], m[1]) : mig.split(m[0]).join(m[1]);
  }
}
if (['$m$', '$t$', '$d$', '$x$'].some((x) => mig.includes(x))) throw new Error('the migration must not contain $m$, $t$, $d$ or $x$');
// The fights and the simulator already carry the E7 tuning and its follow-up (config.json): so each block runs them between E7 and this file, as the E7 follow-up
// test does. They change no function of this file (the md5 guard proves it: the live text of the 6 functions is the text before them).
const PRE = `${read('combat_v2_monster_tuning.sql')}
${read('combat_v2_e7_followup.sql')}`;
if (['$m$', '$t$', '$d$', '$x$', '$q$'].some((x) => PRE.includes(x))) throw new Error('the tuning files must not contain $m$, $t$, $d$, $x$ or $q$');
// (the new function of this file goes first, so that the state before the file is the same when the file is already applied)
const SETUP2 = `drop function if exists public.combat_effect_v2_holds(jsonb, jsonb, integer, jsonb);
  ${SETUP}
  execute $m$${PRE}$m$;`;
// A planted fault in a function body changes the md5 that the guard of the file expects ("own"). So a mutated run first applies the mutated file once in a scratch block,
// reads the md5 of the 6 functions, and writes them into the guard rows of the mutated file: the guard stays ON and the file stays idempotent, so only the
// targeted check can catch the fault (and the guard tests themselves still run on their own). The mutation guard_off turns the guard off, as it should.
if (process.env.MUTATE && !SIM_MUT[process.env.MUTATE]) {
  try {
    const own = JSON.parse(await runBlock(String.raw`do $t$ begin
      ${SETUP2}
      execute $m$${mig}$m$;
      raise exception 'RESULT:%', (select jsonb_object_agg('public.' || p.oid::regprocedure::text, md5(replace(pg_get_functiondef(p.oid), chr(13), ''))) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('ability_v2_check', 'ability_v2_spec', 'ability_v2_block_pp', 'ability_v2_pps', 'ability_v2_text', 'combat_effect_v2_active'))::text; end $t$;`));
    mig = mig.replace(/\('(public\.[a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g, (m, sig, from) => (own[sig] ? `('${sig}', '${from}', '${own[sig]}')` : m));
  } catch (e) { /* the mutated file does not apply: the checks below fail on it */ }
}
setMig(`${PRE}
${mig}`);

let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - b) <= rel * Math.max(1, Math.abs(b));
const q = (a) => a.map((n) => `'${n}'`).join(', ');
const REPLACED = ['ability_v2_spec()', 'ability_v2_check(text,jsonb,jsonb)', 'ability_v2_block_pp(jsonb,text,numeric,jsonb)', 'ability_v2_pps(text,jsonb,jsonb)', 'ability_v2_text(text,jsonb,jsonb)',
  'combat_effect_v2_active(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'];
const ADDED = ['combat_effect_v2_holds(jsonb,jsonb,integer,jsonb)'];
const REPL_NAMES = [...REPLACED, ...ADDED].map((s) => s.split('(')[0]);
const ENEMY_ST = ['poison', 'burn', 'chill', 'stunned', 'sleep', 'paralyzed', 'blinded', 'confused', 'slowed', 'exposed', 'weakened', 'mark', 'frozen'];
const NEW_BLOCKS = ['dispel', 'heal_all', 'quicken'];

// ---------------------------------------------------------------------------------------------------------------- random abilities that use the parts
export function genNew(rng, cls) {
  const pick = (a) => a[Math.floor(rng() * a.length)]; const r2 = (a, b) => Math.round((a + rng() * (b - a)) * 1000) / 1000; const ch = (p) => rng() < p;
  const B = genAbility(rng, cls);
  if (cls === 'attacker') {
    if (ch(0.35)) B.unshift({ k: 'dispel' });
    if (ch(0.35)) B.push({ k: 'heal_all', v: r2(0.03, 0.12) });
    if (ch(0.35)) B.push({ k: 'quicken', v: pick([0.3, 0.5]), self: true });
    const i = B.findIndex((b) => b.k === 'payoff_dmg');
    if (ch(0.45)) { if (i >= 0 && ch(0.5)) B[i] = { k: 'payoff_dmg', kinds: pick([2, 3, 4]), v: B[i].v }; else B.push({ k: 'payoff_dmg', kinds: pick([2, 3]), v: r2(0.2, 0.8) }); }
    let ex = B.some((b) => b.k === 'execute');
    if (!ex && ch(0.3)) { B.push({ k: 'execute', line: r2(0.2, 0.4), v: r2(0.5, 1.5) }); ex = true; }
    if (ex && ch(0.6)) {
      const j = B.findIndex((b) => b.k === 'line_status'); const ls = { k: 'line_status', kinds: pick([2, 3, 4]), ...(ch(0.4) ? { statuses: [pick(ENEMY_ST)] } : {}) };
      if (j >= 0) B[j] = ls; else B.push(ls);
    }
    return B;
  }
  if (B.some((b) => b.k === 'smite') && ch(0.55)) B.push({ k: 'payoff_dmg', kinds: pick([2, 3, 4]), v: r2(0.2, 0.8) });
  return B;
}

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, data, shape, rights, the guard
const OLD_MD5 = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')`;
const body1 = (items) => String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; v jsonb; old jsonb; b jsonb; bad text[] := '{}'; k text; p jsonb; r1 jsonb; r2 jsonb; rows0 jsonb; rows1 jsonb; n1 int;
  items jsonb := ${sqlLit(items)};
begin
  ${SETUP2}
  select value into old from balance where key = 'ability_v2';
  before := ${OLD_MD5};
  select jsonb_object_agg(a.key, md5(to_jsonb(a)::text)) into rows0 from public.ability_blocks a where a.key <> all (array['dispel', 'quicken', 'heal_all', 'line_status', 'payoff_dmg']);
  b := ability_v2_numbers();
  select jsonb_agg(jsonb_build_object('c', ability_v2_check(i->>0, i->1, b), 'p', ability_v2_pps(case when i->>0 in ('breaker', 'striker', 'flurry', 'finisher', 'survivor', 'cleaver') then 'attacker' else 'support' end, i->1->'blocks', b)) order by n)
    into r1 from jsonb_array_elements(items) with ordinality y(i, n);
  -- the guard before the file: a live function that changed (here ability_v2_block_pp, one word) stops the file
  begin
    execute replace(pg_get_functiondef('public.ability_v2_block_pp(jsonb,text,numeric,jsonb)'::regprocedure), 'ability_v2_block_pp: the class', 'ability_v2_block_pp: THE class');
    execute $m$${mig}$m$;
    res := res || jsonb_build_object('case', 'the md5 guard stops the file when a live function changed (before the file)', 'ok', false);
  exception when others then
    res := res || jsonb_build_object('case', 'the md5 guard stops the file when a live function changed (before the file)', 'ok', sqlerrm like '%combat_v2_set2_parts.sql: the live function public.ability_v2_block_pp(jsonb,text,numeric,jsonb) changed since this file was built%', 'got', sqlerrm);
  end;
  execute $m$${mig}$m$;
  after := ${OLD_MD5};
  b := ability_v2_numbers();
  select jsonb_agg(jsonb_build_object('c', ability_v2_check(i->>0, i->1, b), 'p', ability_v2_pps(case when i->>0 in ('breaker', 'striker', 'flurry', 'finisher', 'survivor', 'cleaver') then 'attacker' else 'support' end, i->1->'blocks', b)) order by n)
    into r2 from jsonb_array_elements(items) with ordinality y(i, n);
  select jsonb_object_agg(a.key, md5(to_jsonb(a)::text)) into rows1 from public.ability_blocks a where a.key <> all (array['dispel', 'quicken', 'heal_all', 'line_status', 'payoff_dmg']);
  res := res || jsonb_build_object('case', 'DATA', 'ok', true, 'old_answers', r1, 'new_answers', r2, 'b', b,
    'diff', (select coalesce(jsonb_agg(k2), '[]') from jsonb_object_keys(after) k2 where before->k2 is distinct from after->k2), 'n_funcs', (select count(*) from jsonb_object_keys(before)),
    'n_after', (select count(*) from jsonb_object_keys(after)));
  res := res || jsonb_build_object('case', 'the other ability_blocks rows are unchanged (the same row text, 37 rows) and the library still has 42 rows, none reserved', 'ok',
    rows0 = rows1 and (select count(*) from jsonb_object_keys(rows1)) = 37 and (select count(*) from public.ability_blocks) = 42 and not exists (select 1 from public.ability_blocks where reserved is not null),
    'got', (select count(*) from public.ability_blocks));
  select jsonb_object_agg(p.oid::regprocedure::text, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPL_NAMES)});
  res := res || jsonb_build_object('case', 'volatility: the spec, block_pp, pps and holds IMMUTABLE, the validator and the text STABLE, the active VOLATILE', 'ok',
    o = '{"ability_v2_spec()": "i", "ability_v2_check(text,jsonb,jsonb)": "s", "ability_v2_block_pp(jsonb,text,numeric,jsonb)": "i", "ability_v2_pps(text,jsonb,jsonb)": "i", "ability_v2_text(text,jsonb,jsonb)": "s", "combat_effect_v2_active(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)": "v", "combat_effect_v2_holds(jsonb,jsonb,integer,jsonb)": "i"}'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPL_NAMES)}) and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the 7 functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(REPL_NAMES)}) and coalesce(obj_description(p.oid, 'pg_proc'), '') not like '%combat_v2_set2_parts.sql%';
  res := res || jsonb_build_object('case', 'every replaced or new function has a comment that names this file', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname !~ 'v2' and p.prosrc ~ '(${REPL_NAMES.join('|')})';
  res := res || jsonb_build_object('case', 'no v1 function (a name without v2) calls a replaced or new function', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname order by p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_effect_v2_holds' and p.proname <> 'combat_effect_v2_holds';
  res := res || jsonb_build_object('case', 'only combat_effect_v2_active calls combat_effect_v2_holds', 'ok', o = '["combat_effect_v2_active"]'::jsonb, 'got', o);
  select value into v from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', (v - 'testers') = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', v);
  -- balance
  select value into v from balance where key = 'ability_v2';
  res := res || jsonb_build_object('case', 'ABILITY_V2', 'ok', true, 'v', v);
  res := res || jsonb_build_object('case', 'balance ability_v2: a balance_log update by nathan ADDS share.status_kinds; every other leaf keeps its value; the note names the rule and the minimum share', 'ok',
    (v - 'share') = (old - 'share') and (v->'share') - 'status_kinds' = old->'share' and v->'share' ? 'status_kinds' and not old->'share' ? 'status_kinds'
    and exists (select 1 from balance_log where key = 'ability_v2' and op = 'update' and changed_by = 'nathan' and new_value->'share' ? 'status_kinds' and not old_value->'share' ? 'status_kinds')
    and (select note like '%status_kinds%' and note like '%limits.min_share%' and note like '%combat_v2_set2_parts.sql%' from balance where key = 'ability_v2'), 'got', jsonb_build_object('v', v->'share'->'status_kinds', 'old', old->'share'));
  update balance set value = jsonb_set(value, '{share,status_kinds,3}', '0.5') where key = 'ability_v2';
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: a second run keeps a changed share (status_kinds.3 = 0.5), the 7 functions keep their md5, and the note names the file once', 'ok',
    (select (value->'share'->'status_kinds'->>'3')::numeric = 0.5 from balance where key = 'ability_v2') and ${OLD_MD5} = after
    and (select (length(note) - length(replace(note, 'combat_v2_set2_parts.sql', ''))) / length('combat_v2_set2_parts.sql') = 1 from balance where key = 'ability_v2'));
  update balance set value = v where key = 'ability_v2';
  for k, p in select x.k, x.p from (values ('no status_kinds', v #- '{share,status_kinds}'), ('no leaf 3', v #- '{share,status_kinds,3}'), ('a leaf 6', jsonb_set(v, '{share,status_kinds,6}', '0.1')),
      ('3 above 1', jsonb_set(v, '{share,status_kinds,3}', '1.5')), ('3 below 0', jsonb_set(v, '{share,status_kinds,3}', '-0.1')), ('3 a string', jsonb_set(v, '{share,status_kinds,3}', '"0.1"'))) x(k, p) loop
    begin update balance set value = p where key = 'ability_v2'; bad := bad || k; exception when others then if sqlerrm not like 'balance ability_v2:%' then bad := bad || (k || ': ' || sqlerrm); end if; end;
  end loop;
  res := res || jsonb_build_object('case', 'the fixed shape of ability_v2 refuses 6 planted status_kinds values (missing, missing 3, a leaf 6, above 1, below 0, a string)', 'ok', cardinality(bad) = 0, 'bad', bad);
  -- a price with no measured share raises (never a silent 0): the block price and the list price
  begin
    perform ability_v2_block_pp('{"k": "payoff_dmg", "kinds": 2, "v": 0.4}'::jsonb, 'attacker', 1, b #- '{ability_v2,share,status_kinds}');
    res := res || jsonb_build_object('case', 'ability_v2_block_pp raises when balance has no share.status_kinds for a kinds block', 'ok', false);
  exception when others then
    res := res || jsonb_build_object('case', 'ability_v2_block_pp raises when balance has no share.status_kinds for a kinds block', 'ok', sqlerrm = 'ability_v2_block_pp: balance ability_v2 has no share.status_kinds for 2 statuses', 'got', sqlerrm);
  end;
  begin
    perform ability_v2_pps('attacker', '[{"k": "hit", "x": 1.5}, {"k": "execute", "line": 0.3, "v": 0.7}, {"k": "line_status", "kinds": 3}]'::jsonb, b #- '{ability_v2,share,status_kinds,3}');
    res := res || jsonb_build_object('case', 'ability_v2_pps raises when balance has no share.status_kinds for a line_status kinds block', 'ok', false);
  exception when others then
    res := res || jsonb_build_object('case', 'ability_v2_pps raises when balance has no share.status_kinds for a line_status kinds block', 'ok', sqlerrm in ('ability_v2_pps: balance ability_v2 has no share.status_kinds for 3 statuses', 'ability_v2_block_pp: balance ability_v2 has no share.status_kinds for 3 statuses'), 'got', sqlerrm);
  end;
  -- the guard after the file
  begin
    execute replace(pg_get_functiondef('public.ability_v2_text(text,jsonb,jsonb)'::regprocedure), 'Hit the target for', 'Hit THE target for');
    execute $m$${mig}$m$;
    res := res || jsonb_build_object('case', 'the md5 guard stops the file when a live function changed (after the file)', 'ok', false);
  exception when others then
    res := res || jsonb_build_object('case', 'the md5 guard stops the file when a live function changed (after the file)', 'ok', sqlerrm like '%the live function public.ability_v2_text(text,jsonb,jsonb) changed since this file was built%', 'got', sqlerrm);
  end;
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the validator after the file
const runChecks = async (items) => JSON.parse(await runBlock(String.raw`do $t$
declare out jsonb := '[]'; x jsonb; b jsonb; bx jsonb;
begin
  ${SETUP2}
  execute $m$${mig}$m$;
  b := ability_v2_numbers();
  bx := jsonb_set(jsonb_set(b, '{ability_v2,share,status_kinds,3}', '0.043'), '{ability_v2,limits,min_share}', '0.05');
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    out := out || jsonb_build_array(case when x->>2 = 'x' then ability_v2_check(x->>0, x->1, bx)
                                         when x->>2 = 'k3' then ability_v2_check(x->>0, x->1, jsonb_set(b, '{ability_v2,share,status_kinds,3}', '0.043'))
                                         when x->>2 = 'zero' then ability_v2_check(x->>0, x->1, jsonb_set(b, '{ability_v2,limits,min_share}', '0'))
                                         when x->>2 = 'nokinds' then ability_v2_check(x->>0, x->1, b #- '{ability_v2,share,status_kinds}')
                                         else ability_v2_check(x->>0, x->1, b) end);
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`));

const ppBlock = (items) => String.raw`do $t$
declare out jsonb := '[]'; x jsonb; b jsonb; bx jsonb; cls text;
begin
  ${SETUP2}
  execute $m$${mig}$m$;
  b := ability_v2_numbers();
  bx := jsonb_set(jsonb_set(jsonb_set(b, '{ability_v2,share,status_kinds,2}', '0.15'), '{ability_v2,share,status_kinds,3}', '0.2'), '{ability_v2,pp,line_status}', '0.9');
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    cls := x->>0;
    out := out || jsonb_build_array(jsonb_build_array(ability_v2_pps(cls, x->1, b), ability_v2_pps(cls, x->1, bx)));
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the fixed card actions (draws explicit)
const Cr = (id) => ({ side: 'card', id }), En = (i = 0) => ({ side: 'enemy', id: i });
const foe = (o = {}) => ({ hp: 1000, max: 1000, atk: 100, speed: 50, ...o });
const HIT = [0.9, 0.5, 0.9];          // one hit: no miss, no crit
const att = (role, blocks, o = {}) => ({ role, charge: 2, atk: 100, max: 1000, hp: 1000, crt: 0, abl: 1, active: { blocks }, ...o });
const loss = (r, i = 0) => 1000 - Number(r.s.enemies[i].hp);
const ESt = (r, i = 0) => r.s.enemies[i].status;
const act = (o) => ({ op: 'card', a: Cr(1), o: { use: true, target: En(0), ally: Cr(1), draws: [...HIT, ...HIT, ...HIT, ...HIT, 0.5, 0.5, 0.5, 0.5], ...o } });
// the actions of one card in a row: after each active the charge is full again (set), so the next action may use it too
const seq = (targets, o = {}) => targets.flatMap((t, i) => [act({ target: En(t), ...o }), ...(i < targets.length - 1 ? [{ op: 'set', path: ['cards', '1', 'charge'], v: 2 }] : [])]);
const RES = (r, i) => r[2 * i];     // the answer of the i-th active of seq
function fixedCases() {
  const F = []; const add = (name, sc, ops, check) => F.push([name, state(sc), ops, check]);
  // an enemy shield is the status guarded (the shield of a card is shielded); the dispel strips both and every boost
  const ES = { guarded: { value: 400 }, empowered: { value: 0.3 }, poison: { stacks: 1 } };
  add('control: the same hit with no dispel meets the shield (the Guard stays, the hit does less)', { cards: { 1: att('breaker', [{ k: 'hit', x: 1.5 }]) }, enemies: [foe({ status: ES })] }, [act({})],
    (r) => { fixedRun.set('A1', r[0]); return (!!ESt(r[0]).guarded && !!ESt(r[0]).empowered) || JSON.stringify(ESt(r[0])); });
  add('attacker dispel: the shield and the boost of the target go BEFORE the hit (it takes the whole hit), the Poison stays, and it draws nothing',
    { cards: { 1: att('breaker', [{ k: 'dispel' }, { k: 'hit', x: 1.5 }]) }, enemies: [foe({ status: ES })] }, [act({})],
    (r) => { const c = fixedRun.get('A1'); return (!ESt(r[0]).guarded && !ESt(r[0]).empowered && ESt(r[0]).poison?.stacks === 1 && c && loss(c) < loss(r[0]) && near(loss(r[0]), 150, 1e-9) && r[0].draws.length === c.draws.length)
      || JSON.stringify([r[0].error, ESt(r[0]), loss(r[0]), c && loss(c)]); });
  const H = (blocks, o = {}) => ({ cards: { 1: att('striker', blocks, { hp: 400, abl: 1.25, ...o.c1 }), 2: { role: 'medic', max: 1000, hp: 500 }, 3: { role: 'striker', max: 1000, hp: 0, down: true }, 4: { role: 'warden', max: 1000, hp: 1000 } }, enemies: [foe()] });
  add('control: the same hit with no heal_all (no ally heals)', H([{ k: 'hit', x: 1.6 }]), [act({})], (r) => { fixedRun.set('H0', r[0]); return Number(r[0].s.cards[2].hp) === 500 || r[0].error; });
  add('attacker heal_all: every standing ally (this card too) heals v x ABL x max HP after the hit, a downed ally and a full ally do not change, no draw', H([{ k: 'hit', x: 1.6 }, { k: 'heal_all', v: 0.05 }]),
    [act({})], (r) => { const c = fixedRun.get('H0'); const h = (id) => Number(r[0].s.cards[id].hp);
      return (near(h(1), 400 + 0.05 * 1.25 * 1000, 1e-6) && near(h(2), 500 + 0.05 * 1.25 * 1000, 1e-6) && h(3) === 0 && h(4) === 1000 && c && r[0].draws.length === c.draws.length) || JSON.stringify([r[0].error, [1, 2, 3, 4].map(h)]); });
  add('attacker heal_all with a gate that does not hold (self_has Empowered): nobody heals', H([{ k: 'hit', x: 1.6 }, { k: 'heal_all', v: 0.05 }, { k: 'self_has', status: 'empowered' }]),
    [act({})], (r) => Number(r[0].s.cards[2].hp) === 500 || JSON.stringify([r[0].error, r[0].s.cards[2].hp]));
  add('... the gate holds (the card is Empowered): the ally heals', H([{ k: 'hit', x: 1.6 }, { k: 'heal_all', v: 0.05 }, { k: 'self_has', status: 'empowered' }], { c1: { status: { empowered: { value: 0.2 } } } }),
    [act({})], (r) => near(r[0].s.cards[2].hp, 562.5, 1e-6) || JSON.stringify([r[0].error, r[0].s.cards[2].hp]));
  const Q = (blocks) => ({ cards: { 1: att('finisher', blocks, { abl: 1.1 }), 2: { role: 'striker', max: 1000, hp: 1000 } }, enemies: [foe()] });
  add('attacker quicken self: this card is Quickened with 1 + v x ABL after the hit, the other card is not', Q([{ k: 'hit', x: 1.4 }, { k: 'quicken', v: 0.3, self: true }]), [act({})],
    (r) => (near(r[0].s.cards[1].status.quickened?.value, 1 + 0.3 * 1.1, 1e-9) && !r[0].s.cards[2].status.quickened) || JSON.stringify([r[0].error, r[0].s.cards[1].status, r[0].s.cards[2].status]));
  add('attacker quicken self with a gate that does not hold: not Quickened', Q([{ k: 'hit', x: 1.4 }, { k: 'quicken', v: 0.3, self: true }, { k: 'self_shield' }]), [act({})],
    (r) => !r[0].s.cards[1].status.quickened || JSON.stringify(r[0].s.cards[1].status));
  // (c) kinds: the damage is x (1 + bonus) of the hit
  const PK = [{ k: 'hit', x: 1.5 }, { k: 'payoff_dmg', kinds: 2, v: 0.4 }];
  const S1 = { poison: { stacks: 1 }, empowered: { value: 0.2 } }, S2 = { poison: { stacks: 1 }, burn: { stacks: 1 } }, S3 = { poison: { stacks: 1 }, burn: { stacks: 1 }, slowed: { until: 9 } };
  add('attacker payoff_dmg kinds 2: one status (a boon is not a status) = no bonus, two statuses = x (1 + 0.4), three = the same bonus', { cards: { 1: att('striker', PK) }, enemies: [foe({ status: S1 }), foe({ status: S2 }), foe({ status: S3 })] },
    seq([0, 1, 2]), (r) => (near(loss(RES(r, 0), 0), 150, 1e-9) && near(loss(RES(r, 1), 1), 150 * 1.4, 1e-9) && near(loss(RES(r, 2), 2), 150 * 1.4, 1e-9)) || JSON.stringify([r.map((x) => x.error), loss(RES(r, 0), 0), loss(RES(r, 1), 1), loss(RES(r, 2), 2)]));
  add('payoff_dmg kinds on each area hit: the OTHER enemy is read on its own (the area hit has the bonus only against two statuses)', { cards: { 1: att('cleaver', [{ k: 'hit', x: 1.3 }, { k: 'area', x: 0.6 }, { k: 'payoff_dmg', kinds: 2, v: 0.5 }]) }, enemies: [foe(), foe({ status: S2 }), foe({ status: { poison: { stacks: 1 } } })] },
    [act({})], (r) => { const l1 = loss(r[0], 1), l2 = loss(r[0], 2); return (near(l1, 60 * 1.5, 1e-9) && near(l2, 60, 1e-9) && near(loss(r[0], 0), 130, 1e-9)) || JSON.stringify([r[0].error, loss(r[0], 0), l1, l2]); });
  const XL = (line) => [{ k: 'hit', x: 1.5 }, { k: 'execute', line: 0.3, v: 0.7 }, line];
  add('execute line with kinds 3 and a named status: above the HP line, 2 statuses = no bonus, 3 statuses = x (1 + 0.7), a named status (sleep) = the bonus, below the line = the bonus',
    { cards: { 1: att('finisher', XL({ k: 'line_status', statuses: ['sleep'], kinds: 3 })) }, enemies: [foe({ hp: 900, status: S2 }), foe({ hp: 900, status: S3 }), foe({ hp: 900, status: { sleep: { until: 9 } } }), foe({ hp: 280 })] },
    seq([0, 1, 2, 3]), (r) => { const d = (i, hp) => hp - Number(RES(r, i).s.enemies[i].hp); return (near(d(0, 900), 150, 1e-9) && near(d(1, 900), 150 * 1.7, 1e-9) && near(d(2, 900), 150 * 1.7, 1e-9) && d(3, 280) >= 150 * 1.7 - 1e-9)   // below the line the Finisher passive adds its own bonus, so this one is at least the execute bonus
      || JSON.stringify([r.map((x) => x.error), d(0, 900), d(1, 900), d(2, 900), d(3, 280)]); });
  add('execute line with kinds only: 2 statuses with kinds 2 = the bonus', { cards: { 1: att('finisher', XL({ k: 'line_status', kinds: 2 })) }, enemies: [foe({ hp: 900, status: S2 }), foe({ hp: 900, status: { poison: { stacks: 1 } } })] },
    seq([0, 1]), (r) => { const d = (i) => 900 - Number(RES(r, i).s.enemies[i].hp); return (near(d(0), 150 * 1.7, 1e-9) && near(d(1), 150, 1e-9)) || JSON.stringify([r.map((x) => x.error), d(0), d(1)]); });
  add('support smite with payoff_dmg kinds 2 (the smite is a sure hit): 2 statuses = x (1 + 0.4), one status = none',
    { cards: { 1: { role: 'artillery', charge: 1, atk: 100, max: 1000, hp: 1000, power: 1, abl: 1, crt: 0, active: { blocks: [{ k: 'smite', x: 1.65 }, { k: 'payoff_dmg', kinds: 2, v: 0.4 }] } } }, enemies: [foe({ status: { poison: { stacks: 1 } } }), foe({ status: S2 })] },
    [{ op: 'card', a: Cr(1), o: { use: true, target: En(0), ally: Cr(1), draws: [0.9, 0.5, 0.9, 0.9] } }, { op: 'set', path: ['cards', '1', 'charge'], v: 1 }, { op: 'card', a: Cr(1), o: { use: true, target: En(1), ally: Cr(1), draws: [0.9, 0.5, 0.9, 0.9] } }],
    (r) => (loss(r[0], 0) > 0 && near(loss(r[2], 1) / loss(r[0], 0), 1.4, 1e-9)) || JSON.stringify([r.map((x) => x.error), loss(r[0], 0), loss(r[2], 1)]));
  add('a Confused attacker (the redirect to its own side): no dispel, no heal_all and no quicken run (the target keeps its Guard)', { cards: { 1: att('breaker', [{ k: 'dispel' }, { k: 'hit', x: 1.5 }, { k: 'heal_all', v: 0.05 }, { k: 'quicken', v: 0.3, self: true }], { status: { confused: { until: 9 } } }), 2: { role: 'medic', max: 1000, hp: 500 } }, enemies: [foe({ status: { guarded: { value: 400 } } })] },
    [act({ draws: [0.0, 0.0, 0.9, 0.5, 0.9, 0.9, 0.5, 0.9] })], (r) => (r[0].s.enemies[0].status.guarded && !r[0].s.cards[1].status.quickened && Number(r[0].s.cards[2].hp) <= 500) || JSON.stringify([r[0].error, r[0].s.enemies[0].status, r[0].s.cards[1].status, r[0].s.cards[2].hp]));
  return F;
}
const fixedRun = new Map();

// ---------------------------------------------------------------------------------------------------------------- the validator cases and the card texts
const fit = (cfg, role, blocks, i = 0, target = cfg.v2_pp.budget) => {         // the amount of block i that makes the simulator PP = target (a hit x, a smite x)
  const id = '_fit'; const bl = blocks.map((b) => ({ ...b })); const f = 'x'; const price = (b) => templatePP({ ...cfg, v2_templates: { ...cfg.v2_templates, [id]: { role, name: 'fit', blocks: b } } }, id);
  const p0 = price(bl); const per = (() => { const t = bl.map((b) => ({ ...b })); t[i][f] += 0.1; return (price(t) - p0) / 0.1; })();
  bl[i][f] = Math.round((bl[i][f] + (target - p0) / per) * 1000) / 1000; return bl;
};
function validatorCases(cfg) {
  const C = []; const add = (name, role, blocks, expect, tag = '') => C.push({ name, role, ability: { name: 'Zz', blocks }, expect, tag });
  const hit = (x = 1.5) => ({ k: 'hit', x });
  const A = (role, blocks, i) => fit(cfg, role, blocks, i);
  // accepted, with the exact text
  add('(b) dispel + hit', 'breaker', A('breaker', [{ k: 'dispel' }, hit()], 1), { ok: true, text: /^First, remove the target's shield and boosts\. Hit the target for \d+%\.$/ });
  add('(b) hit + heal_all', 'survivor', A('survivor', [hit(), { k: 'heal_all', v: 0.05 }], 0), { ok: true, text: /^Hit the target for \d+%\. Heal every ally for 5% of its max HP\.$/ });
  add('(b) hit + execute + quicken self (the standard 30%)', 'finisher', A('finisher', [hit(), { k: 'execute', line: 0.3, v: 0.6 }, { k: 'quicken', v: 0.3, self: true }], 0), { ok: true, text: /^Hit the target for \d+%\. Deals \+60% damage to targets below 30% HP\. Quicken this card\.$/ });
  add('(b) quicken self with another amount (50%)', 'finisher', A('finisher', [hit(), { k: 'quicken', v: 0.5, self: true }], 0), { ok: true, text: /^Hit the target for \d+%\. Quicken this card\. It acts 50% faster\.$/ });
  add('(b) dispel + hit + quicken self', 'striker', A('striker', [{ k: 'dispel' }, hit(), { k: 'quicken', v: 0.3, self: true }], 1), { ok: true, text: /^First, remove the target's shield and boosts\. Hit the target for \d+%\. Quicken this card\.$/ });
  add('(b) hit + heal_all + quicken self', 'survivor', A('survivor', [hit(), { k: 'heal_all', v: 0.04 }, { k: 'quicken', v: 0.3, self: true }], 0), { ok: true, text: /^Hit the target for \d+%\. Heal every ally for 4% of its max HP\. Quicken this card\.$/ });
  add('(b) a gate on heal_all (self_has Empowered)', 'survivor', A('survivor', [hit(), { k: 'heal_all', v: 0.12 }, { k: 'self_has', status: 'empowered' }], 0), { ok: true, text: /Heal every ally for 12% of its max HP while this card is Empowered\.$/ });
  add('(c) execute + line_status kinds 2', 'finisher', A('finisher', [hit(), { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: 2 }], 0), { ok: true, text: /^Hit for \d+%\. Deals \+70% damage to targets that are below 30% HP or with 2 or more statuses\.$/ });
  add('(c) line_status with a status and kinds 2', 'finisher', A('finisher', [hit(), { k: 'execute', line: 0.3, v: 0.6 }, { k: 'line_status', statuses: ['sleep'], kinds: 2 }], 0), { ok: true, text: /below 30% HP, Asleep, or with 2 or more statuses\.$/ });
  add('(c) an attacker payoff_dmg kinds 2', 'striker', A('striker', [hit(), { k: 'payoff_dmg', kinds: 2, v: 0.6 }], 0), { ok: true, text: /^Hit the target for \d+%\. Deals \+60% damage to targets with 2 or more statuses\.$/ });
  add('(c) a support smite with payoff_dmg kinds 2', 'artillery', A('artillery', [{ k: 'smite', x: 1.65 }, { k: 'payoff_dmg', kinds: 2, v: 0.6 }], 0), { ok: true, text: /^Deal \d+% damage to the enemy\. Deals \+60% damage to an enemy with 2 or more statuses\.$/ });
  add('(c) kinds 3 with a share above the minimum (0.043: a changed number) is accepted', 'finisher', A('finisher', [hit(), { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: 3 }], 0), { ok: true, text: /with 3 or more statuses\.$/ }, 'k3');
  // refused (b)
  add('an attacker quicken must be self', 'striker', [hit(), { k: 'quicken', v: 0.3 }], { err: /block 2 \(quicken\): an attacker quicken is self \(this card\): set self$/ });
  add('a self quicken has no all', 'striker', [hit(), { k: 'quicken', v: 0.3, self: true, all: true }], { err: /block 2 \(quicken\): a self quicken has no all and no to$/ });
  add('a self quicken has no to', 'striker', [hit(), { k: 'quicken', v: 0.3, self: true, to: 'most_hurt' }], { err: /block 2 \(quicken\): a self quicken has no all and no to$/ });
  add('self is for an attacker (a support quicken)', 'warden', [{ k: 'quicken', v: 0.3, self: true }], { err: /block 1 \(quicken\): self is for an attacker quicken \(a support picks an ally\)$/ });
  add('self must be true (a number)', 'striker', [hit(), { k: 'quicken', v: 0.3, self: 1 }], { err: /block 2 \(quicken\): self /i });
  add('at most one quicken on an attacker', 'striker', [hit(), { k: 'quicken', v: 0.3, self: true }, { k: 'quicken', v: 0.5, self: true }], { err: /at most one quicken block on an attacker/ });
  add('no gate after an attacker dispel', 'breaker', [{ k: 'dispel' }, { k: 'self_has', status: 'empowered' }, hit()], { err: /block 2 \(self_has\): cannot follow a dispel block on an attacker \(its text is the first sentence\)$/ });
  add('a support dispel keeps its gate (the rule is for an attacker)', 'warden', [{ k: 'shield', v: 0.3 }, { k: 'dispel' }, { k: 'self_has', status: 'empowered' }], { noerr: /cannot follow a dispel/ });
  add('one dispel on an attacker', 'breaker', [{ k: 'dispel' }, { k: 'dispel' }, hit()], { err: /at most one dispel block/ });
  // refused (c)
  add('a line_status needs statuses or kinds', 'finisher', [hit(), { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status' }], { err: /block 3 \(line_status\): needs statuses or kinds$/ });
  add('kinds 1 is not a counted share', 'finisher', [hit(), { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: 1 }], { err: /block 3 \(line_status\): kinds must be one of 2, 3, 4, 5 /, noerr: /the condition is true at only/ });
  add('kinds 6 is not a counted share', 'striker', [hit(), { k: 'payoff_dmg', kinds: 6, v: 0.4 }], { err: /block 2 \(payoff_dmg\): kinds must be one of 2, 3, 4, 5 / });
  add('kinds must be a whole number (2.5)', 'striker', [hit(), { k: 'payoff_dmg', kinds: 2.5, v: 0.4 }], { err: /block 2 \(payoff_dmg\): kinds must be a whole number/ });
  add('kinds as a string', 'striker', [hit(), { k: 'payoff_dmg', kinds: '2', v: 0.4 }], { err: /block 2 \(payoff_dmg\): kinds / });
  add('payoff_dmg: kinds stands alone (with status)', 'striker', [hit(), { k: 'payoff_dmg', kinds: 2, status: 'poison', v: 0.4 }], { err: /block 2 \(payoff_dmg\): kinds stands alone \(no status or statuses\)$/ });
  add('payoff_dmg: kinds stands alone (with statuses)', 'striker', [hit(), { k: 'payoff_dmg', kinds: 2, statuses: ['poison', 'burn'], v: 0.4 }], { err: /kinds stands alone/ });
  add('payoff_dmg: no condition at all', 'striker', [hit(), { k: 'payoff_dmg', v: 0.4 }], { err: /block 2 \(payoff_dmg\): needs status or statuses \(one of the two\)$/ });
  add('kinds is not a field of payoff_crit', 'striker', [hit(), { k: 'payoff_crit', kinds: 2, v: 0.2 }], { err: /block 2 \(payoff_crit\): unknown field kinds$/ });
  add('kinds is not a field of vs_status', 'striker', [hit(), { k: 'vs_status', kinds: 2, x: 2 }], { err: /block 2 \(vs_status\): unknown field kinds$/ });
  add('a support payoff_dmg with kinds needs a smite', 'artillery', [{ k: 'payoff_dmg', kinds: 2, v: 0.4 }], { err: /a support payoff_dmg needs a smite block/ });
  add('the minimum share: 3 or more (0.0059) is refused with its own message (an attacker)', 'finisher', [hit(), { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: 3 }], { err: /^block 3 \(line_status kinds 3\): the condition is true at only 0\.0059 of the actives \(the measured share\), below the minimum 0\.01 \(limits\.min_share\): it costs almost 0 PP and almost never works$/ });
  add('the minimum share: payoff_dmg kinds 4 (0.0002) is refused', 'striker', A('striker', [hit(), { k: 'payoff_dmg', kinds: 4, v: 0.4 }], 0), { err: /block 2 \(payoff_dmg kinds 4\): the condition is true at only 0\.0002 of the actives/ });
  add('the minimum share: kinds 5 (0) is refused', 'striker', [hit(), { k: 'payoff_dmg', kinds: 5, v: 0.4 }], { err: /block 2 \(payoff_dmg kinds 5\): the condition is true at only 0 of the actives/ });
  add('the minimum share is read from balance (min_share 0: kinds 3 passes the rule)', 'finisher', [hit(), { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: 3 }], { noerr: /the condition is true at only/ }, 'zero');
  add('balance without share.status_kinds: kinds is refused (never accepted by a missing number)', 'striker', [hit(), { k: 'payoff_dmg', kinds: 2, v: 0.4 }], { err: /kinds must be one of  \(/ }, 'nokinds');
  add('the minimum share with changed numbers (min_share 0.05, kinds 3 = 0.043): refused; kinds 2 (0.0757) passes', 'finisher', [hit(), { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: 3 }], { err: /block 3 \(line_status kinds 3\): the condition is true at only 0\.043 of the actives/ }, 'x');
  add('... and kinds 2 passes the rule with min_share 0.05', 'finisher', [hit(), { k: 'execute', line: 0.3, v: 0.7 }, { k: 'line_status', kinds: 2 }], { noerr: /the condition is true at only/ }, 'x');
  return C;
}
const checkCase = (c, r) => {
  const e = c.expect; const errs = r.errors || [];
  if (e.ok !== undefined && !!r.ok !== e.ok) return `ok ${r.ok} want ${e.ok}: ${errs.join(' | ')}`;
  if (e.text && !e.text.test(r.text || '')) return `text "${r.text}"`;
  if (e.err && !errs.some((x) => e.err.test(x))) return `no error like ${e.err}: ${errs.join(' | ')}`;
  if (e.noerr && errs.some((x) => e.noerr.test(x))) return `an unexpected error ${errs.filter((x) => e.noerr.test(x)).join(' | ')}`;
  return null;
};

// ---------------------------------------------------------------------------------------------------------------- run
try {
  const items = [];
  // the abilities with none of the new parts: the 42 templates and random actives of the old generator
  for (const t of Object.keys(CONFIG.v2_templates).filter((k) => !k.startsWith('_')).sort()) items.push([CONFIG.v2_templates[t].role, { name: CONFIG.v2_templates[t].name, blocks: CONFIG.v2_templates[t].blocks }]);
  { const rng = mkRng(2026102801); for (let i = 0; i < Number(process.env.V2_OLD_AB || 150); i++) { const cls = i % 2 ? 'support' : 'attacker'; const role = cls === 'attacker' ? ['striker', 'breaker', 'finisher', 'cleaver', 'flurry', 'survivor'][i % 6] : ['warden', 'medic', 'controller', 'spotter', 'herald', 'artillery'][i % 6];
    items.push([role, { name: 'Zz', blocks: genAbility(rng, cls) }]); } }
  const R = JSON.parse(await runBlock(body1(items)));
  const D = R.find((x) => x.case === 'DATA'); const B = R.find((x) => x.case === 'DATA').b;
  for (const r of R.filter((x) => !['DATA', 'ABILITY_V2'].includes(x.case))) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
  const expDiff = [...REPLACED, ...ADDED].sort();
  say(JSON.stringify([...D.diff].sort()) === JSON.stringify(expDiff) && D.n_funcs > 400 && D.n_after === D.n_funcs + 1,
    `no change in play: of the ${D.n_funcs} public functions only the 6 replaced ones have a new text, 1 function is new (the md5 of every other is the same)`, JSON.stringify({ diff: D.diff, n: D.n_funcs, after: D.n_after }));
  // an ability with none of the new parts: the same validator answer and PP list as before
  const same = []; D.old_answers.forEach((o, i) => { if (JSON.stringify(o) !== JSON.stringify(D.new_answers[i])) same.push(`${i} ${items[i][0]} ${JSON.stringify(items[i][1].blocks.map((x) => x.k))}`); });
  say(same.length === 0 && items.length > 150, `an ability with none of the new parts has the same validator answer (ok, errors, PP, pps, text, Silver, enables, pays) as before the file, on ${items.length} abilities (the 42 templates and random actives)`, same.slice(0, 4).join(' | '));
  const leaves = (o, p = []) => (o !== null && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o).filter(([k]) => !k.startsWith('_')).flatMap(([k, v]) => leaves(v, [...p, k])) : [[p.join('.'), JSON.stringify(o)]]);
  const bal = new Map(leaves(R.find((x) => x.case === 'ABILITY_V2').v)), cfgL = new Map(leaves(CONFIG.ability_v2));
  const lp = [...bal].filter(([p, v]) => cfgL.get(p) !== v).concat([...cfgL].filter(([p]) => !bal.has(p)));
  say(lp.length === 0 && bal.get('share.status_kinds.3') === '0.0059' && bal.size === 41, `balance ability_v2 = config.json ability_v2 (${bal.size} leaves equal, + the 4 share.status_kinds leaves; one number, one home)`, JSON.stringify(lp));
  const cfg = patch(CONFIG, {}); cfg.ability_v2 = JSON.parse(JSON.stringify(B.ability_v2)); cfg.v2_pp = JSON.parse(JSON.stringify(B.v2_pp)); cfg.v2_status = { ...cfg.v2_status };
  const numbers = JSON.parse(await runBlock(String.raw`do $t$ declare b jsonb; begin
    ${SETUP2}
    execute $m$${mig}$m$;
    b := combat_v2_enemy_numbers();
    raise exception 'RESULT:%', jsonb_build_object('b', b, 'ab', ability_v2_numbers())::text; end $t$;`));
  const sim = simCfg(numbers);

  // 2. + 3. the validator: accepted, refused, the card texts, PP = the simulator
  const VC = validatorCases(sim);
  const vr = await runChecks(VC.map((c) => [c.role, c.ability, c.tag]));
  VC.forEach((c, i) => {
    const bad = checkCase(c, vr[i]);
    let ppOk = true, why = '';
    if (c.expect.ok && vr[i].ok) { const id = '_v'; const s2 = patch(c.tag === 'k3' ? patch(sim, { ability_v2: { share: { status_kinds: { 3: 0.043 } } } }) : sim, {}); s2.v2_templates = { ...sim.v2_templates, [id]: { role: c.role, name: 'v', blocks: c.ability.blocks } };
      const pp = templatePP(s2, id); ppOk = near(vr[i].pp, pp, 1e-12); why = ` PP SQL ${vr[i].pp} sim ${pp}`; }
    say(!bad && ppOk, `validator: ${c.name}`, (bad || '') + (ppOk ? '' : why));
  });

  // 4. the PP of every block of random abilities that use the parts = the simulator, also with changed numbers
  const nPP = Number(process.env.V2_PP || 500); const rngP = mkRng(77123);
  const abil = []; for (let i = 0; i < nPP; i++) { const cls = i % 3 === 2 ? 'support' : 'attacker'; abil.push([cls, genNew(rngP, cls)]); }
  const simX = patch(sim, { ability_v2: { share: { status_kinds: { 2: 0.15, 3: 0.2 } }, pp: { line_status: 0.9 } } });
  const pr = JSON.parse(await runBlock(ppBlock(abil)));
  const roleOf = (cls) => (cls === 'attacker' ? 'striker' : 'artillery');
  const pbad = []; let nNew = 0, nKinds = 0;
  const tpl = (cfgX, i) => { cfgX.v2_templates[`_p${i}`] = { role: roleOf(abil[i][0]), name: 'p', blocks: abil[i][1] }; return `_p${i}`; };
  const s1 = patch(sim, {}), s2 = patch(simX, {});
  abil.forEach(([cls, blocks], i) => {
    const t1 = tpl(s1, i), t2 = tpl(s2, i);
    if (blocks.some((b) => NEW_BLOCKS.includes(b.k))) nNew++; if (blocks.some((b) => b.kinds !== undefined)) nKinds++;
    blocks.forEach((b, j) => { const a = blockPP(s1, t1, b), c = blockPP(s2, t2, b);
      if (!near(pr[i][0][j], a, 1e-9)) pbad.push(`${i}.${j} ${b.k}: SQL ${pr[i][0][j]} sim ${a}`); if (!near(pr[i][1][j], c, 1e-9)) pbad.push(`${i}.${j} ${b.k} changed: SQL ${pr[i][1][j]} sim ${c}`); });
  });
  say(pbad.length === 0 && nNew > nPP / 4 && nKinds > nPP / 4, `SQL = the simulator on the PP of every block of ${nPP} random abilities (${nNew} with dispel, heal_all or quicken, ${nKinds} with kinds), also with changed numbers (status_kinds 2 and 3, line_status)`, pbad.slice(0, 5).join(' | '));

  // 5. the fixed card actions
  const FIX = fixedCases();
  const rows = await runOps(FIX.map((f) => [f[1], f[2]]));
  FIX.forEach(([, , , check], i) => { try { check(rows[i]); } catch { /* the first pass only stores the control runs */ } });
  FIX.forEach(([name, , , check], i) => { let r; try { r = check(rows[i]); } catch (e) { r = String(e.message); } say(r === true, `fixed: ${name}`, String(r).slice(0, 600)); });

  // 6. SQL = the simulator on random fights with the parts
  const nF = Number(process.env.V2_FIGHTS || 120);
  // the enemy mechanics Venom and Toxic Born are left out: on origin/main the simulator and SQL differ on them (a basic attack and an enemy move draw a different
  // number of times; found by this test, with no part of this file in the fight; reported in plan 20.15). The parts of this file do not depend on a mechanic.
  const MECHS = [...Object.keys(CONFIG.v2_enemy.mechanics), ...Object.keys(CONFIG.v2_dungeon.passive_params), ...Object.keys(CONFIG.v2_boss_rules).filter((k) => k !== 'undying')].filter((k) => !k.startsWith('_') && !['venom', 'toxic_born'].includes(k));
  const FS0 = fightSpecs(nF, 20261028, numbers.b, { mechs: MECHS }); const rngF = mkRng(551177);
  let withNew = 0, withKinds = 0;
  // enemies that meet the parts: statuses (so that kinds 2 to 4 are sometimes true and sometimes exactly met) and a Guard (so that a dispel matters)
  for (const [st] of FS0) for (const e of st.enemies) {
    if (rngF() < 0.5) Object.assign(e.status, { poison: { stacks: 1, until: 7 }, burn: { stacks: 2 } });
    if (rngF() < 0.3) Object.assign(e.status, { slowed: { until: 6 }, chill: { stacks: 1, until: 6 } });
    if (rngF() < 0.4) e.status.guarded = { value: Math.round((50 + rngF() * 70) * 1000) / 1000 };   // not a round number: a shield that a hit uses up to 1e-17 differs in SQL and the simulator
  }
  for (const [st] of FS0) for (const id of Object.keys(st.cards)) { const c = st.cards[id]; if (rngF() < 0.75) { c.active = { blocks: genNew(rngF, c.class) }; if (c.active.blocks.some((b) => NEW_BLOCKS.includes(b.k))) withNew++; if (c.active.blocks.some((b) => b.kinds !== undefined)) withKinds++; } }
  const FP = await parity(FS0, sim);
  for (const m of FP.fbad.slice(0, 2)) { const f = /^fight (\d+)/.exec(m); if (f) console.log(`  fight ${f[1]} cards: ${JSON.stringify(Object.entries(FS0[Number(f[1])][0].cards).map(([id, c]) => [id, c.role, c.active.blocks.map((b) => ({ ...b }))]))}`); }
  if (process.env.DEBUG_FIGHT) {   // the two logs of one fight, around an action: DEBUG_FIGHT=<fight>:<action>
    const [fi, ak] = process.env.DEBUG_FIGHT.split(':').map(Number);
    const sq = JSON.parse(await runBlock(String.raw`do $t$ declare a jsonb; b jsonb; begin
      ${SETUP2}
      execute $m$${mig}$m$;
      ${FIGHT_DRIVER}
      b := combat_v2_enemy_numbers();
      a := pg_temp.e7fight(${sqlLit(FS0[fi][0])}::jsonb, ${sqlLit(FS0[fi][1])}::jsonb, b);
      raise exception 'RESULT:%', a::text; end $t$;`));
    const sm = simFight(sim, FS0[fi][0], FS0[fi][1]);
    for (let k = Math.max(0, ak - 2); k <= ak; k++) console.log(`  DEBUG ${fi}:${k}
   SQL ${JSON.stringify(sq[k]).slice(0, 1800)}
   SIM ${JSON.stringify(sm[k]).slice(0, 1800)}`);
  }
  say(FP.fbad.length === 0 && FP.facts > 20 * nF && FP.fev.active > nF * 2 && withNew > nF && withKinds > nF / 2, `SQL = the simulator on ${nF} random fights with the parts (${FP.fsame} equal action by action, ${FP.ftie} float near-ties; ${FP.facts} actions, ${FP.fev.active} actives; ${withNew} cards with dispel, heal_all or quicken, ${withKinds} with kinds)`, JSON.stringify(FP.fbad.slice(0, 4)));

  // 7. the old fights: the same SQL answers before and after the file
  const nO = Number(process.env.V2_OLD || 24);
  const OS = fightSpecs(nO, 20261029, numbers.b);
  const oldRes = [];
  for (let i = 0; i < OS.length; i += 8) oldRes.push(JSON.parse(await runBlock(String.raw`do $t$ declare a jsonb := '[]'; z jsonb := '[]'; x jsonb; b jsonb; begin
    ${SETUP2}
    ${FIGHT_DRIVER}
    b := combat_v2_enemy_numbers();
    for x in select v from jsonb_array_elements(${sqlLit(OS.slice(i, i + 8))}::jsonb) v loop a := a || jsonb_build_array(pg_temp.e7fight(x->0, x->1, b)); end loop;
    execute $m$${mig}$m$;
    b := combat_v2_enemy_numbers();
    for x in select v from jsonb_array_elements(${sqlLit(OS.slice(i, i + 8))}::jsonb) v loop z := z || jsonb_build_array(pg_temp.e7fight(x->0, x->1, b)); end loop;
    raise exception 'RESULT:%', jsonb_build_object('a', a, 'z', z)::text; end $t$;`)));
  const oldDiff = oldRes.flatMap((o, k) => o.a.map((x, j) => (JSON.stringify(x) === JSON.stringify(o.z[j]) ? null : k * 8 + j)).filter((x) => x !== null));
  const oldActs = oldRes.reduce((s, o) => s + o.a.flat().filter((e) => e.event === 'act').length, 0);
  say(oldDiff.length === 0 && oldActs > 15 * nO, `an ability with none of the new parts fights as before the file: ${nO} random fights (${oldActs} actions) give the same answers before and after`, JSON.stringify(oldDiff.slice(0, 5)));

  // 8. the private Set 2 actives (when the private file exists; never in this repo): the counts only
  const PRIV = process.env.SET2_PARTS_BC || 'C:/Users/vaugh/discord-card-ideas/batches/set2-parts-bc.json';
  if (existsSync(PRIV)) {
    const rows5 = JSON.parse(readFileSync(PRIV, 'utf8')).rows;
    const items5 = rows5.flatMap((r) => [[r.role, r.ability, ''], [r.role, r.ability, 'k3']]);
    const r5 = await runChecks(items5);
    const base = rows5.map((_, i) => r5[2 * i]), k3 = rows5.map((_, i) => r5[2 * i + 1]);
    const accepted = base.filter((x) => x.ok).length, acc3 = k3.filter((x) => x.ok).length;
    const partB = rows5.map((r, i) => (r.part === 'b' ? base[i].ok : true)).every(Boolean);
    const lowOnly = rows5.map((r, i) => (r.part === 'c' ? base[i].errors.filter((e) => !/measured share/.test(e)) : [])).map((e) => e.length);
    const ppRows = rows5.map((r, i) => `${r.part}:${near(base[i].pp, templatePP((() => { const s2 = patch(sim, {}); s2.v2_templates = { ...sim.v2_templates, _c: { role: r.role, name: 'c', blocks: r.ability.blocks } }; return s2; })(), '_c'), 1e-12) ? 'pp=sim' : 'PP DIFFERS'}`);
    say(rows5.length === 5 && partB && ppRows.every((x) => x.endsWith('pp=sim')), `the 5 private Set 2 actives: the 3 of part (b) are accepted; the validator PP = the simulator for all 5; accepted ${accepted} of 5 now (the 2 of part (c) refused for the measured share of 3 or more: ${rows5.filter((r, i) => r.part === 'c' && !base[i].ok && base[i].errors.some((e) => /measured share/.test(e))).length}), ${acc3} of 5 with a share of 0.043`, JSON.stringify(ppRows));
    if (process.env.SET2_SHOW) rows5.forEach((r, i) => console.log(`  [private] ${r.key} ${r.part} ok=${base[i].ok} pp=${base[i].pp?.toFixed(3)} silver=${base[i].silver_pp?.toFixed(3)} text="${base[i].text}" errors=${JSON.stringify(base[i].errors)} | share 0.043: ok=${k3[i].ok} pp=${k3[i].pp?.toFixed(3)} errors=${JSON.stringify(k3[i].errors)}`));
    void lowOnly; void acc3;
  } else console.log('SKIP the private Set 2 actives: the private file is missing (it never goes into this repo)');
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.stack || e.message).slice(0, 1800)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
