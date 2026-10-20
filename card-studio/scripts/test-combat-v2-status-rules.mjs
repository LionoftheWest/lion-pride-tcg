import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_status_rules.sql (combat v2 phase 3, PR E5: the 16 statuses; plan sections 3.1, 3.2, 6 and 14). NO lasting
 * change: every request is one DO block, undone by its final RAISE. V1, E1, E2, E3, E4 and this file run inside each block (all idempotent), so the test
 * passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-status-rules.mjs     must PASS
 *   MUTATE=<name> ...                                                                                  must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                     the baseline (must PASS), then every mutation, one line each
 * The reference is the simulator card-studio/v2sim (engine.mjs Battle.apply, remove, cure, damage, heal, endStep, act, confusedRedirect, tickStep;
 * checks.mjs statusChecks; lab-checks.mjs cure and empower), with the numbers of the database (the balance values replace the config.json values).
 * Invariants:
 *   1. No change in play: the md5 of every other public function is the same after the file, except combat_v2_turn_order (the one v2 function it
 *      replaces), whose answer is the same as the E2 answer when no control status is on a unit. No other function calls the new ones. Volatility,
 *      server only, every function has a comment, the file runs twice.
 *   2. The fixed cases: each rule of plan 6 with explicit draws (the simulator status checks ported, the Lab cure and Empower checks, and every rule that
 *      the simulator does not show alone: durations on each side, the Controller, the Hunt boss limit, the one control immunity and its lengths, the cure
 *      immunity, resolve and Accuracy, Unstoppable, the mechanic immunities, the caps, the tick order and the Warden, the once-only step end, the driver
 *      with the step end between the steps, the turn-order strip), and the refusals, each with its own message.
 *   3. The ported simulator rates with random() after setseed: Paralyzed fails 50%, Unstoppable 10%, resolve 20%, Confused 30% (the simulator tolerances).
 *   4. The no-lock bound (plan 6.2): all 4 controls before every action: the Hunt boss skips at most 1 / (1 + boss_immune) of its turns; a foe and a card
 *      still act (share below 0.7).
 *   5. SQL = the simulator on a GRID of random status sequences (apply, remove, damage, heal, turn start, cure, strip, Confused, step end, clock) with the same
 *      draws: after every op the HP, down, every status (stacks, value, until), the shields, the control and cure immunities, the answer (applied, reason,
 *      burst, Frozen, skip, the Confused target, healed, cured) and the number of draws are equal (numbers within a relative 1e-9).
 *   6. SQL = the simulator on random FIGHTS: combat_v2_next (the step end between the steps, the turn start) against Battle.tickStep with the same scripted
 *      actions and draws: the actor of each action with its step, the skips and the unit states after each action, and the end (end / cap). A difference
 *      is accepted only where the simulator had a float near-tie (a meter within 1e-6 of act_at or of another meter: the simulator adds floats, SQL is exact;
 *      E2 found the same).
 *   7. The fuzz: random op sequences with random(): the state passes fight_state_check_v2 after every op, HP in [0, max], a down unit has no status, the
 *      stacks and values stay under their caps, at most one control status.
 *   8. The draws: a replay with the answer's draws gives the same answer; with random() after setseed the slots take the stream in order.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { mini, dummyCard, dummyFoe } from '../v2sim/checks.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { ROLES, classOf } from '../v2sim/cards.mjs';
import { loadConfig, patch, mkRng } from '../v2sim/util.mjs';
assertLocal('test-combat-v2-status-rules.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const V1 = read('combat_v2_flags_balance.sql');
const E1 = read('combat_v2_statuses_roles.sql');
const E2 = read('combat_v2_turn_meter.sql');
const E3 = read('combat_v2_stats.sql');
const E4 = read('combat_v2_hit.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_status_rules.sql');

const MUT = {
  // the one control immunity
  immunity_off: ['    if n > 0 then\n      u := jsonb_set(u, \'{immune}\'', '    if false then\n      u := jsonb_set(u, \'{immune}\''],
  immunity_one_short: ["greatest(coalesce((u->'immune'->>'control')::int, p_clock + n - 1), p_clock + n - 1)", "greatest(coalesce((u->'immune'->>'control')::int, p_clock + n - 2), p_clock + n - 2)"],
  immunity_not_checked: ["    if clk <= coalesce((u->'immune'->>'control')::int, clk - 1)\n       or exists", '    if exists'],
  two_controls_at_once: ["\n       or exists (select 1 from jsonb_each(b->'statuses') x where x.value->>'immunity' = 'control' and combat_v2_status_on(u, x.key, clk) is not null) then", ' then'],
  card_immunity_short: ["n := case when p_side = 'card' then (c->>'immune_card')::int", "n := case when p_side = 'card' then (c->>'immune')::int"],
  boss_immunity_wrong: ["when p_boss then (c->>'boss_immune')::int else", "when p_boss then (c->>'immune_card')::int else"],
  // the Hunt boss limit
  boss_limit_off: ["  if ctrl and boss then dur := least(dur, (ctl->>'boss_max_dur')::int); end if;\n", ''],
  boss_limit_exact: ["else (ss->p_key->>'max_life')::int end;\n    end if;", "else (ss->p_key->>'max_life')::int end;\n    elsif boss then\n      dur := (ctl->>'boss_max_dur')::int;\n    end if;"],
  boss_stun_life_card: ["dur := case when boss then (ss->p_key->>'max_life')::int when side = 'card'", "dur := case when boss then (ss->p_key->>'max_life_card')::int when side = 'card'"],
  // Poison and the Toxic burst
  burst_at_plus_one: ["if n >= (ss->'poison'->>'burst_at')::int then", "if n > (ss->'poison'->>'burst_at')::int then"],
  burst_amount_tick: ["(ss->'poison'->>'burst')::numeric * case when boss", "(ss->'poison'->>'tick')::numeric * case when boss"],
  burst_no_reset: ["s := jsonb_set(p_state, path, jsonb_set(u, '{status}', (u->'status') - 'poison'));", "s := jsonb_set(p_state, path, jsonb_set(u, '{status,poison}', jsonb_build_object('stacks', n, 'until', clk + dur)));"],
  burst_no_exposed: ["             * (1 + coalesce((combat_v2_status_on(u, 'exposed', clk)->>'value')::numeric, 0)),\n             jsonb_build_object('tick', true", "             ,\n             jsonb_build_object('tick', true"],
  burst_ref_hp_boss_max: ["(ss->'poison'->>'burst')::numeric * case when boss then (ss->>'hunt_ref_hp')::numeric", "(ss->'poison'->>'burst')::numeric * case when false then (ss->>'hunt_ref_hp')::numeric"],
  poison_tick_one_stack: ["amt := (u->'status'->'poison'->>'stacks')::numeric * (ss->'poison'->>'tick')::numeric", "amt := (ss->'poison'->>'tick')::numeric"],
  poison_dur_card_off: ["dur := case when side = 'card' then coalesce((ss->p_key->>'dur_card')::int, (ss->p_key->>'dur')::int)", "dur := case when side = 'card' then (ss->p_key->>'dur')::int"],
  // Burn
  burn_max_off: ["jsonb_build_object('stacks', least((ss->'burn'->>'max')::int, coalesce((u->'status'->'burn'->>'stacks')::int, 0) + stacks))", "jsonb_build_object('stacks', coalesce((u->'status'->'burn'->>'stacks')::int, 0) + stacks)"],
  burn_no_decay: ["jsonb_set(u, '{status,burn,stacks}', to_jsonb((u->'status'->'burn'->>'stacks')::int - (ss->'burn'->>'decay')::int))", "u"],
  burn_heal_full: ["then (b->'v2_status'->'burn'->>'heal_x')::numeric else 1 end);", 'then 1 else 1 end);'],
  burn_vs_healer_off: ["then (ss->'burn'->>'vs_healer_x')::numeric else 1 end;", 'then 1 else 1 end;'],
  burn_tick_x_off: ["* (ss->'poison'->>'tick')::numeric * (ss->'burn'->>'tick_x')::numeric", "* (ss->'poison'->>'tick')::numeric"],
  regrowth_not_healer: ["or coalesce(u->'mechanics' ? 'regrowth', false) then (ss->'burn'", "or false then (ss->'burn'"],
  // Chill and Frozen
  chill_no_freeze: ["if n >= (ss->'chill'->>'freeze_at')::int then", 'if false then'],
  frozen_keeps_chill: ["      u := jsonb_set(u, '{status}', (u->'status') - k);\n    end loop;\n    return", "      null;\n    end loop;\n    return"],
  chill_overflows: ["      n := (ss->'chill'->>'freeze_at')::int - 1;\n", '\n'],
  frozen_with_source: ["r := combat_v2_status_apply(p_state, p_target, srow->>'end_state', case when rest is null then '{}'::jsonb else jsonb_build_object('draws', rest) end, b);",
    "r := combat_v2_status_apply(p_state, p_target, srow->>'end_state', case when rest is null then jsonb_build_object('src', o->'src') else jsonb_build_object('draws', rest, 'src', o->'src') end, b);"],
  // Sleep, Stunned, Paralyzed (the turn start)
  sleep_not_waking: ['  if st is not null and not tick then', '  if false then'],
  sleep_wakes_on_tick: ['  if st is not null and not tick then', '  if st is not null then'],
  hit_no_wake: ["  if (p_hit->>'raw')::numeric > 0 and combat_v2_status_on(u, 'sleep', clk) is not null then", '  if false then'],
  sleep_no_skip: ["  if combat_v2_status_on(u, 'sleep', clk) is not null then\n    return jsonb_build_object('state', p_state, 'skip', true", "  if false then\n    return jsonb_build_object('state', p_state, 'skip', true"],
  stun_not_consumed: ["    u := combat_v2_status_drop(u, k, side, side = 'enemy' and p_state->>'mode' = 'hunt', clk, b);\n    return jsonb_build_object('state', jsonb_set(p_state, path, u), 'skip', true", "    return jsonb_build_object('state', jsonb_set(p_state, path, u), 'skip', true"],
  paralyzed_never_fails: ["    if d < (b->'v2_status'->'paralyzed'->>'fail')::numeric then", '    if false then'],
  paralyzed_at_boundary: ["    if d < (b->'v2_status'->'paralyzed'->>'fail')::numeric then", "    if d <= (b->'v2_status'->'paralyzed'->>'fail')::numeric then"],
  // Exposed, Weakened, Mark, boons
  exposed_cap_off: ["else (ss->'exposed'->>'cap')::numeric end;", 'else 1000 end;'],
  thick_hide_off: ["cap := case when coalesce(u->'mechanics' ? 'thick_hide', false) then", 'cap := case when false then'],
  dispeller_off: ["case when coalesce(u->'mechanics' ? 'dispeller', false) then (me->'dispeller'->>'x')::numeric else 1 end), 'until', clk + dur));", "1), 'until', clk + dur));"],
  weakened_cap_off: ["jsonb_build_object('value', least((ss->'weakened'->>'cap')::numeric, cur + v), 'until', clk + dur)", "jsonb_build_object('value', cur + v, 'until', clk + dur)"],
  mark_adds: ["jsonb_build_object('value', greatest(cur, v), 'until', clk + (ss->'mark'->>'dur')::int)", "jsonb_build_object('value', cur + v, 'until', clk + (ss->'mark'->>'dur')::int)"],
  mark_controller_dur: ["'until', clk + (ss->'mark'->>'dur')::int)", "'until', clk + dur)"],
  empowered_adds: ["else least((ss->'empowered'->>'cap')::numeric, greatest(cur, v)) end));", "else least((ss->'empowered'->>'cap')::numeric, cur + v) end));"],
  empowered_stack_ignored: ["case when (ss->'empowered'->>'stack')::boolean then", 'case when false then'],
  shield_cap_off: ["least((u->>'max')::numeric * (ss->'shielded'->>'cap_maxhp')::numeric, cur + v)", 'cur + v'],
  // resolve, Accuracy, the Controller, Unstoppable, immunities
  resolve_off: ['    if res > 0 then\n      d := combat_v2_draw(draws', '    if false then\n      d := combat_v2_draw(draws'],
  resolve_same_side: ['  if neg and src is not null and sside <> side then', '  if neg and src is not null then'],
  controller_resolve_off: ["case when srole = 'controller' then 1 - (b->'v2_roles'->'controller'->>'resolve_ignore')::numeric else 1 end", '1'],
  accuracy_off: ["- coalesce((src->>'acc')::numeric, 0) * (b->'v2_hit'->>'resolve_acc')::numeric / (b->'v2_stats'->'acc'->>'pct')::numeric);", ');'],
  controller_dur_off: ["+ case when srole = 'controller' and sside <> side then (b->'v2_roles'->'controller'->>'dur_add')::int else 0 end;", ';'],
  unstoppable_off: ["  if ctrl and coalesce(u->'mechanics' ? 'unstoppable', false) then", '  if false then'],
  unstoppable_slot_skips: ["    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);\n    if d < (me->'unstoppable'", "    d := combat_v2_draw(draws, jsonb_array_length(used) + 1); used := used || to_jsonb(d);\n    if d < (me->'unstoppable'"],
  mech_immune_off: ["    if coalesce(me->m->'immune' ? p_key, false) then return", '    if false then return'],
  cure_immunity_ignored: ["  if neg and side = 'card' and coalesce((u->'immune'->>p_key)::int >= clk, false) then", '  if false then'],
  cure_gives_no_immunity: ['  if p_immune > 0 then\n    im :=', '  if false then\n    im :='],
  cure_ignores_keys: ['  if kin is null then\n    select array_agg(x.key order by (x.value->>\'ord\')::int) into keys from jsonb_each(b->\'statuses\') x where (x.value->>\'negative\')::boolean;',
    "  if true then\n    select array_agg(x.key order by (x.value->>'ord')::int) into keys from jsonb_each(b->'statuses') x where (x.value->>'negative')::boolean;"],
  strip_takes_negatives: ["select array_agg(x.key order by (x.value->>'ord')::int) into keys from jsonb_each(b->'statuses') x where not (x.value->>'negative')::boolean;",
    "select array_agg(x.key order by (x.value->>'ord')::int) into keys from jsonb_each(b->'statuses') x;"],
  // damage, ticks, fall, heal
  warden_off: ["    a := a * (1 - (b->'v2_roles'->'warden'->>'ally_dr')::numeric);", ''],
  warden_self: ["x.side = 'card' and x.id <> p_target->>'id' and p_state->'cards'->x.id->>'role' = 'warden'", "x.side = 'card' and p_state->'cards'->x.id->>'role' = 'warden'"],
  min_dmg_on_ticks: ["  if not tick then a := greatest((b->'v2_hit'->>'min_dmg')::numeric, a); end if;", "  a := greatest((b->'v2_hit'->>'min_dmg')::numeric, a);"],
  defense_off: ["a := p_amount * (1 - coalesce((u->>'def')::numeric, 0) * (1 - least(1, coalesce((o->>'pierce')::numeric, 0))));", 'a := p_amount;'],
  ticks_hit_shields: ["r := combat_v2_damage(s, ref, amt, jsonb_build_object('tick', true, 'ignore_shield', (ss->'poison'->>'ignore_shield')::boolean), b);", "r := combat_v2_damage(s, ref, amt, jsonb_build_object('tick', true), b);"],
  tick_no_exposed: ["             * (1 + coalesce((combat_v2_status_on(u, 'exposed', clk)->>'value')::numeric, 0));\n      r := combat_v2_damage(s, ref, amt, jsonb_build_object('tick', true, 'ignore_shield', (ss->'poison'", ";\n      r := combat_v2_damage(s, ref, amt, jsonb_build_object('tick', true, 'ignore_shield', (ss->'poison'"],
  fall_keeps_status: ["select p_unit || jsonb_build_object('hp', 0, 'down', true, 'status', '{}'::jsonb);", "select p_unit || jsonb_build_object('hp', 0, 'down', true);"],
  shield_x_ignored: ['    sx := coalesce((o->>\'shield_x\')::numeric, 1);', '    sx := 1;'],
  heal_over_max: ["  h := least((u->>'max')::numeric - (u->>'hp')::numeric,\n", '  h := least(1e9,\n'],
  // the step end and the driver
  step_end_twice: ["  if coalesce((p_state->'ext'->>'step_end')::int >= clk, false) then", '  if false then'],
  expiry_late: ["(y.value->>'until')::int <= clk", "(y.value->>'until')::int < clk"],
  expiry_early: ["(y.value->>'until')::int <= clk", "(y.value->>'until')::int <= clk + 1"],
  expiry_no_immunity: ["        u := combat_v2_status_drop(u, k, x.side, boss, clk, b);\n        ended", "        u := jsonb_set(u, '{status}', (u->'status') - k);\n        ended"],
  next_no_step_end: ['      e := combat_v2_step_end(s, b); s := e->\'state\';', "      e := jsonb_build_object('state', s, 'ticks', '[]'::jsonb, 'ended', '[]'::jsonb); s := e->'state';"],
  next_many_steps: ["    a := combat_v2_advance(s, jsonb_set(b, array[ckey, 'round_cap'], to_jsonb((s->>'clock')::int + 1)));", '    a := combat_v2_advance(s, b);'],
  next_step_end_at_zero: ["    if (s->>'clock')::int > 0 then\n      e := combat_v2_step_end", "    if true then\n      e := combat_v2_step_end"],
  next_no_end_event: ["         or not exists (select 1 from combat_v2_units(s) x where x.side = 'enemy' and combat_v2_up(s->'enemies'->x.id::int)) then\n        a := jsonb_build_object('state', s, 'event', 'end'); exit;\n      end if;\n    end if;",
    '      end if;\n    end if;'],
  next_no_turn_start: ["  t := combat_v2_turn_start(a->'state', a->'actor', p_draws, b);", "  t := jsonb_build_object('state', a->'state', 'skip', false, 'draws', '[]'::jsonb);"],
  // the turn-order strip
  order_no_skip: ["    if k is not null then e := e || jsonb_build_object('skip', k); end if;", ''],
  order_stun_forever: ["    if k in ('stunned', 'frozen') then s := jsonb_set(s, path, jsonb_set(u, '{status}', (u->'status') - k)); end if;", ''],
  order_no_may_fail: ["    if k is null and combat_v2_status_on(u, 'paralyzed', clk) is not null then e := e || jsonb_build_object('may_fail', true); end if;", ''],
  // Confused
  confused_never: ["  if d >= (b->'v2_status'->'confused'->>'chance')::numeric then return", '  if true then return'],
  confused_other_side: ['   where x.side = aside and combat_v2_up(', '   where x.side <> aside and combat_v2_up('],
  // play, rights, docs
  v1_touched: ['-- ============================================================ 12. server only',
    "create or replace function public.card_max_hp(p_cp integer, p_floor numeric, p_per_cp numeric) returns integer language sql immutable set search_path = public as $fn$ select greatest(p_floor, round(p_cp * p_per_cp))::int  $fn$;\n-- ============================================================ 12. server only"],
  stable_apply: ["returns jsonb language plpgsql volatile set search_path = public as $fn$\ndeclare\n  b jsonb := coalesce(p_b, combat_v2_status_numbers());\n  ss jsonb", "returns jsonb language plpgsql stable set search_path = public as $fn$\ndeclare\n  b jsonb := coalesce(p_b, combat_v2_status_numbers());\n  ss jsonb"],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.combat_v2_step_end\(jsonb, jsonb\) is \$cm\$[^\n]*\n/, ''],
  refuse_value_slowed_off: ["  if o ? 'value' and p_key in ('slowed', 'quickened') then\n    raise", "  if false then\n    raise"],
  refuse_dur_off: ["  if o ? 'dur' and p_key not in ('blinded', 'confused', 'enraged', 'focused') then\n    raise", '  if false then\n    raise'],
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
    const fails = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5, 60));
    console.log(`mutation ${name.padEnd(26)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  first: ${(fails[0] || (r.stderr || '').trim().split(/\r?\n/).pop() || '').slice(0, 70)}`);
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
for (const t of [V1, E1, E2, E3, E4, mig]) if (['$m$', '$t$', '$d$', '$x$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$, $d$ or $x$');

const NEW = ['combat_v2_status_numbers', 'combat_v2_unit_path', 'combat_v2_units', 'combat_v2_up', 'combat_v2_status_check', 'combat_v2_status_drop', 'combat_v2_fall',
  'combat_v2_status_remove', 'combat_v2_damage', 'combat_v2_hit_apply', 'combat_v2_heal', 'combat_v2_status_apply', 'combat_v2_status_cure', 'combat_v2_status_strip',
  'combat_v2_step_end', 'combat_v2_turn_start', 'combat_v2_confused_target', 'combat_v2_next'];
const REPLACED = 'combat_v2_turn_order';
// the combat v2 functions of the later PRs that call these on purpose (v2 callers, not v1; every one is named here)
const V2_CALLERS = ['combat_v2_action_numbers', 'combat_effect_v2_hit', 'combat_effect_v2_basic', 'combat_effect_v2_active', 'combat_v2_card_act'];   // E6 combat_v2_abilities.sql
const q = (a) => a.map((n) => `'${n}'`).join(', ');
const SETUP = String.raw`
  perform set_config('balance.by', 'test', true);
  execute $m$${V1}$m$;
  execute $m$${E1}$m$;
  execute $m$${E2}$m$;
  execute $m$${E3}$m$;
  execute $m$${E4}$m$;
  -- the state before the file, also when the file is already applied on this copy: its functions are dropped (E2 above put combat_v2_turn_order back)
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)}) loop
      execute 'drop function ' || f;
    end loop; end $x$$d$;`;
const md5s = String.raw`(select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> all (array[${q(NEW)}, '${REPLACED}']))`;

// The SQL driver: runs ops on a state, one answer per op (without the state) and a summary of the units after it.
const DRIVER = String.raw`
  create or replace function pg_temp.e5sum(s jsonb) returns jsonb language sql as $x$
    select jsonb_build_object('clock', s->'clock',
      'cards', coalesce((select jsonb_object_agg(c.key, jsonb_build_object('hp', c.value->'hp', 'down', c.value->'down', 'status', c.value->'status',
                 'immune', coalesce(c.value->'immune', '{}'::jsonb))) from jsonb_each(s->'cards') c), '{}'::jsonb),
      'enemies', coalesce((select jsonb_agg(jsonb_build_object('hp', e.v->'hp', 'down', e.v->'down', 'status', e.v->'status', 'immune', coalesce(e.v->'immune', '{}'::jsonb)) order by e.o)
                 from jsonb_array_elements(s->'enemies') with ordinality e(v, o)), '[]'::jsonb));
  $x$;
  create or replace function pg_temp.e5run(p_s jsonb, p_ops jsonb, p_b jsonb, p_full boolean) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; op jsonb; r jsonb; out jsonb := '[]'; h jsonb;
  begin
    for op in select v from jsonb_array_elements(p_ops) v loop
      begin
        r := case op->>'op'
          when 'apply' then combat_v2_status_apply(s, op->'t', op->>'key', op->'o', p_b)
          when 'remove' then combat_v2_status_remove(s, op->'t', op->>'key', p_b)
          when 'step_end' then combat_v2_step_end(s, p_b)
          when 'clock' then jsonb_build_object('state', jsonb_set(s, '{clock}', to_jsonb((s->>'clock')::int + coalesce((op->>'n')::int, 1))))
          when 'turn' then combat_v2_turn_start(s, op->'t', op->'draws', p_b)
          when 'cure' then combat_v2_status_cure(s, op->'t', op->'keys', coalesce((op->>'immune')::int, 0), p_b)
          when 'strip' then combat_v2_status_strip(s, op->'t', op->'keys', p_b)
          when 'damage' then combat_v2_damage(s, op->'t', (op->>'amount')::numeric, op->'o', p_b)
          when 'heal' then combat_v2_heal(s, op->'t', (op->>'amount')::numeric, p_b)
          when 'confused' then combat_v2_confused_target(s, op->'t', op->'draws', p_b)
          when 'next' then combat_v2_next(s, op->'draws', p_b)
          when 'order' then jsonb_build_object('order', combat_v2_turn_order(s, (op->>'n')::int))
          when 'set' then jsonb_build_object('state', jsonb_set(s, array(select jsonb_array_elements_text(op->'path')), op->'v'))
          when 'hit' then jsonb_build_object('hit', combat_v2_hit(s #> combat_v2_unit_path(s, op->'a'), s #> combat_v2_unit_path(s, op->'t'),
                            op->'ctx' || jsonb_build_object('clock', s->'clock', 'mode', s->'mode')))
        end;
        if op->>'op' = 'hit' then h := r->'hit'; r := combat_v2_hit_apply(s, op->'t', h, p_b) || jsonb_build_object('hit', h); end if;
        if r ? 'state' then s := r->'state'; end if;
        out := out || jsonb_build_array((r - 'state') || jsonb_build_object('u', pg_temp.e5sum(s)) || case when p_full then jsonb_build_object('s', s) else '{}'::jsonb end);
      exception when others then
        out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm, 'u', pg_temp.e5sum(s)));
      end;
    end loop;
    return out;
  end $x$;`;

// a v2 fight state from a short spec
const state = (sc) => ({
  v: 2, mode: sc.mode || 'dungeon', round: 0, clock: sc.clock ?? 1, squad: sc.squad || Object.keys(sc.cards || {}).map(Number),
  cards: Object.fromEntries(Object.entries(sc.cards || {}).map(([id, c]) => [id, { role: 'striker', class: 'attacker', atk: 50, hp: c.max ?? 100, max: 100, down: false, meter: 0, charge: 0, status: {}, ...c }])),
  enemies: (sc.enemies || []).map((e) => ({ hp: e.max ?? 1000, max: 1000, down: false, meter: 0, charge: 0, speed: 50, status: {}, ...e })),
  marks: {}, facts: { passives: [], cards: {} }, ext: sc.ext || {} });
const Cr = (id) => ({ side: 'card', id }), En = (i = 0) => ({ side: 'enemy', id: i });
const apply = (t, key, o = {}) => ({ op: 'apply', t, key, o });

const runOps = async (cases, b = 'b', full = false) => JSON.parse(await runBlock(String.raw`do $t$
declare out jsonb := '[]'; x jsonb; b jsonb;
begin
  ${SETUP}
  execute $m$${mig}$m$;
  ${DRIVER}
  b := combat_v2_status_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(cases)}::jsonb) v loop
    out := out || jsonb_build_array(pg_temp.e5run(x->0, x->1, case when jsonb_typeof(x->2) = 'object' then b || (x->2) else b end, ${full}));
  end loop;
  raise exception 'RESULT:%', out::text;
end $t$;`));

// ---------------------------------------------------------------------------------------------------------------- block 1: no change in play, the numbers, rights
const ORDER_STATES = [
  state({ mode: 'dungeon', clock: 0, squad: [5, 2], cards: { 5: { role: 'flurry', meter: 40 }, 2: { role: 'warden', meter: 90, status: { slowed: { until: 6 } } } }, enemies: [{ speed: 50, meter: 70, status: { chill: { stacks: 2, until: 3 } } }, { speed: 55, meter: 10 }] }),
  state({ mode: 'hunt', clock: 3, squad: [1, 9, 4], cards: { 1: { role: 'striker', meter: 99 }, 9: { role: 'herald', meter: 20, status: { quickened: { until: 9 } } }, 4: { role: 'cleaver', meter: 5 } }, enemies: [{ speed: 100, meter: 30 }] }),
];
const body1 = String.raw`do $t$
declare res jsonb := '[]'; before jsonb; after jsonb; o jsonb; o1 jsonb; o2 jsonb; t1 text; t2 text; s jsonb; st jsonb := ${sqlLit(ORDER_STATES)};
begin
  ${SETUP}
  before := ${md5s};
  select md5(pg_get_functiondef('public.combat_v2_turn_order(jsonb, integer)'::regprocedure)) into t1;
  select jsonb_agg(combat_v2_turn_order(x, 12)) into o1 from jsonb_array_elements(st) x;
  execute $m$${mig}$m$;
  after := ${md5s};
  select md5(pg_get_functiondef('public.combat_v2_turn_order(jsonb, integer)'::regprocedure)) into t2;
  select jsonb_agg(combat_v2_turn_order(x, 12)) into o2 from jsonb_array_elements(st) x;
  res := res || jsonb_build_object('case', 'no change in play: the md5 of every other public function (' || (select count(*) from jsonb_object_keys(before)) || ') is the same after the file', 'ok',
    before = after and (select count(*) from jsonb_object_keys(before)) > 400, 'got', (select jsonb_agg(k2) from jsonb_object_keys(before) k2 where before->k2 is distinct from after->k2));
  res := res || jsonb_build_object('case', 'combat_v2_turn_order is replaced (a new text), and with no control status its answer is the E2 answer', 'ok', t1 <> t2 and o1 = o2 and jsonb_array_length(o1->0) = 12, 'got', jsonb_build_object('e2', o1, 'e5', o2));
  res := res || jsonb_build_object('case', 'NUMBERS', 'ok', true, 'b', combat_v2_status_numbers());
  select jsonb_object_agg(p.oid::regprocedure::text, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)}, '${REPLACED}');
  res := res || jsonb_build_object('case', 'volatility: apply, turn_start, confused_target and next VOLATILE (draws); the pure helpers IMMUTABLE; the readers STABLE', 'ok',
    o = '{"combat_v2_status_numbers()": "s", "combat_v2_unit_path(jsonb,jsonb)": "i", "combat_v2_units(jsonb)": "i", "combat_v2_up(jsonb)": "i", "combat_v2_status_check(jsonb,jsonb,text)": "i",
          "combat_v2_status_drop(jsonb,text,text,boolean,integer,jsonb)": "i", "combat_v2_fall(jsonb)": "i", "combat_v2_status_remove(jsonb,jsonb,text,jsonb)": "s",
          "combat_v2_damage(jsonb,jsonb,numeric,jsonb,jsonb)": "s", "combat_v2_hit_apply(jsonb,jsonb,jsonb,jsonb)": "s", "combat_v2_heal(jsonb,jsonb,numeric,jsonb)": "s",
          "combat_v2_status_apply(jsonb,jsonb,text,jsonb,jsonb)": "v", "combat_v2_status_cure(jsonb,jsonb,jsonb,integer,jsonb)": "s", "combat_v2_status_strip(jsonb,jsonb,jsonb,jsonb)": "s",
          "combat_v2_step_end(jsonb,jsonb)": "s", "combat_v2_turn_start(jsonb,jsonb,jsonb,jsonb)": "v", "combat_v2_confused_target(jsonb,jsonb,jsonb,jsonb)": "v",
          "combat_v2_next(jsonb,jsonb,jsonb)": "v", "combat_v2_turn_order(jsonb,integer)": "s"}'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2x), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2x
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)}, '${REPLACED}') and has_function_privilege(r2x, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the 19 functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in (${q(NEW)}, '${REPLACED}') and coalesce(obj_description(p.oid, 'pg_proc'), '') = '';
  res := res || jsonb_build_object('case', 'every function has a comment', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname <> all (array[${q(NEW)}, '${REPLACED}', ${q(V2_CALLERS)}])
     and p.prosrc ~ '(combat_v2_status_(numbers|check|drop|remove|apply|cure|strip)|combat_v2_unit_path|combat_v2_units|combat_v2_up\(|combat_v2_damage|combat_v2_hit_apply|combat_v2_heal|combat_v2_step_end|combat_v2_turn_start|combat_v2_confused_target|combat_v2_next|combat_v2_fall|combat_v2_turn_order)';
  res := res || jsonb_build_object('case', 'no other function calls the new functions or the strip (no v1 caller)', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.proname), '[]') into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\(' and p.proname <> 'combat_v2_on';
  res := res || jsonb_build_object('case', 'the flag combat_v2 has no reader but combat_v2_on (flag OFF changes nothing)', 'ok', o = '[]'::jsonb, 'got', o);
  select value into o from balance where key = 'combat_v2';
  res := res || jsonb_build_object('case', 'the flag combat_v2 is OFF for every capability', 'ok', o = '{"gauntlet": false, "dungeon": false, "hunt": false, "progress": false}'::jsonb, 'got', o);
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: the file runs a second time', 'ok', true);
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the fixed cases
// each case: [name, state spec, ops, check(results, B) -> true | text, p_b patch?]
function fixedCases(B) {
  const S = B.v2_status, CT = B.v2_control, R = B.v2_roles, M = B.v2_enemy.mechanics, H = B.v2_hit;
  const near = (a, b) => Math.abs(Number(a) - b) <= 1e-9 * Math.max(1, Math.abs(b));
  const foe = (o = {}) => ({ max: 1000, ...o }), hunt = (o = {}) => ({ mode: 'hunt', cards: { 1: {} }, enemies: [{ max: 50000, hp: 50000, speed: 100, ...o }] });
  const dg = (cards, enemies, o = {}) => ({ mode: 'dungeon', cards, enemies, ...o });
  const st = (r, i, side = 'enemies', id = 0) => (side === 'cards' ? r[i].u.cards[id] : r[i].u.enemies[id]).status;
  const im = (r, i, side = 'enemies', id = 0) => (side === 'cards' ? r[i].u.cards[id] : r[i].u.enemies[id]).immune;
  const hp = (r, i, side = 'enemies', id = 0) => Number((side === 'cards' ? r[i].u.cards[id] : r[i].u.enemies[id]).hp);
  const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const ok = (c, msg) => (c ? true : msg);
  const c1 = Cr(1), c2 = Cr(2), e0 = En(0), e1 = En(1);
  const ctl = { src: c1 };
  return [
    // ---- the simulator status checks (checks.mjs statusChecks), ported
    ['poison.tick (sim): Poison 2 ticks 2 x tick x 1000 at the end of the step', dg({ 1: {} }, [foe({ speed: 1 })]), [apply(e0, 'poison', { stacks: 2 }), { op: 'step_end' }],
      (r) => ok(near(r[1].ticks[0].dmg, 2 * S.poison.tick * 1000) && near(hp(r, 1), 1000 - 2 * S.poison.tick * 1000), JSON.stringify(r[1]))],
    ['poison.burst (sim): the 3rd stack makes a Toxic burst (burst x ref HP), then Poison resets', dg({ 1: {} }, [foe({ speed: 1 })]), [apply(e0, 'poison', { stacks: 2 }), apply(e0, 'poison', { stacks: 1 })],
      (r) => ok(near(r[1].burst, S.poison.burst * 1000) && !st(r, 1).poison && near(hp(r, 1), 1000 - S.poison.burst * 1000), JSON.stringify(r[1]))],
    ['burn.tick (sim): Burn 3 ticks 3 x tick_x x Poison tick x 1000, then decays to 2', dg({ 1: {} }, [foe({ hp: 500 })]), [apply(e0, 'burn', { stacks: 3 }), { op: 'step_end' }],
      (r) => ok(near(r[1].ticks[0].dmg, 3 * S.poison.tick * S.burn.tick_x * 1000) && st(r, 1).burn.stacks === 3 - S.burn.decay, JSON.stringify(r[1]))],
    ['burn.healer (sim): Burn deals x vs_healer_x to a healing enemy', dg({ 1: {} }, [foe({ hp: 500, healer: true })]), [apply(e0, 'burn', { stacks: 3 }), { op: 'step_end' }],
      (r) => ok(near(r[1].ticks[0].dmg, 3 * S.poison.tick * S.burn.tick_x * 1000 * S.burn.vs_healer_x), JSON.stringify(r[1]))],
    ['burn.antiheal (sim): a Burning unit heals x heal_x', dg({ 1: {} }, [foe({ hp: 500 })]), [apply(e0, 'burn', { stacks: 1 }), { op: 'heal', t: e0, amount: 100 }],
      (r) => ok(near(r[1].healed, 100 * S.burn.heal_x), JSON.stringify(r[1]))],
    ['stun.skip (sim): a Stunned enemy skips its next action, and the Stun ends', dg({ 1: {} }, [foe()]), [apply(e0, 'stunned'), { op: 'turn', t: e0 }, { op: 'turn', t: e0 }],
      (r) => ok(r[1].skip === true && r[1].reason === 'stunned' && !st(r, 1).stunned && r[2].skip === false, JSON.stringify(r.slice(1)))],
    ['control.immune (sim): after a control ends, Stun and Sleep fail during the immunity (immune steps), then land', dg({ 1: {} }, [foe()], { clock: 4 }),
      [apply(e0, 'stunned'), { op: 'turn', t: e0 }, apply(e0, 'stunned'), apply(e0, 'sleep'), { op: 'clock', n: CT.immune - 1 }, apply(e0, 'paralyzed'), { op: 'clock' }, apply(e0, 'stunned')],
      (r) => ok(r[2].reason === 'control_immune' && r[3].reason === 'control_immune' && r[5].reason === 'control_immune' && r[7].applied === true && im(r, 1).control === 4 + CT.immune - 1, JSON.stringify(r.map((x) => [x.applied, x.reason])))],
    ['chill.frozen (sim): Chill 2 is not Frozen; the 3rd stack Freezes and clears Chill; then Stun fails (one immunity)', dg({ 1: {} }, [foe()]),
      [apply(e0, 'chill', { stacks: 2 }), apply(e0, 'chill', { stacks: 1 }), { op: 'turn', t: e0 }, apply(e0, 'stunned')],
      (r) => ok(!st(r, 0).frozen && st(r, 0).chill.stacks === 2 && r[1].frozen === true && st(r, 1).frozen && !st(r, 1).chill && r[2].reason === 'frozen' && r[3].reason === 'control_immune', JSON.stringify(r))],
    ['sleep.wake (sim): Sleep skips actions until the unit takes damage', dg({ 1: {} }, [foe()]), [apply(e0, 'sleep'), { op: 'turn', t: e0 }, { op: 'turn', t: e0 }, { op: 'damage', t: e0, amount: 10 }, { op: 'turn', t: e0 }],
      (r) => ok(r[1].skip && r[2].skip && r[3].woke === true && !st(r, 3).sleep && r[4].skip === false && im(r, 3).control === 1 + CT.immune - 1, JSON.stringify(r))],
    ['shield (sim): a shield of 50 absorbs 50 of 80; shield break x2 absorbs 25', dg({ 1: { status: { shielded: { value: 50 } } }, 2: { status: { shielded: { value: 50 } } } }, [foe()]),
      [{ op: 'damage', t: c1, amount: 80 }, { op: 'damage', t: c2, amount: 80, o: { shield_x: 2 } }],
      (r) => ok(hp(r, 0, 'cards', 1) === 70 && hp(r, 1, 'cards', 2) === 45 && !st(r, 1, 'cards', 1).shielded && !st(r, 1, 'cards', 2).shielded, JSON.stringify(r))],
    ['purify (sim): a cure of every negative status on an enemy (immune 0): kinds 2 -> 0, the boosts stay', dg({ 1: {} }, [foe({ status: { exposed: { value: 0.3, until: 9 }, poison: { stacks: 1, until: 9 }, enraged: { value: 1.4, until: 9 } } })]),
      [{ op: 'cure', t: e0, keys: null, immune: 0 }], (r) => ok(r[0].cured === 2 && eq(Object.keys(st(r, 0)), ['enraged']) && eq(im(r, 0), {}), JSON.stringify(r))],
    ['elementborn (sim): Toxic-born is immune to Poison, Fireborn to Burn, Frostborn to Chill and Frozen', dg({ 1: {} }, [foe({ mechanics: ['toxic_born', 'fireborn'] }), foe({ mechanics: ['frostborn'] })]),
      [apply(e0, 'poison'), apply(e0, 'burn'), apply(e1, 'chill'), apply(e1, 'frozen'), apply(e1, 'poison')],
      (r) => ok(r.slice(0, 4).every((x) => x.reason === 'immune') && r[4].applied === true, JSON.stringify(r.map((x) => x.reason)))],
    ['cure.one (Lab): cure Poison: ONE ally loses its Poison, its Weakened stays, the other ally keeps its Poison', dg({ 1: { status: { poison: { stacks: 1, until: 9 }, weakened: { value: 0.2, until: 9 } } }, 2: { status: { poison: { stacks: 1, until: 9 } } } }, [foe()]),
      [{ op: 'cure', t: c1, keys: ['poison'], immune: 5 }], (r) => ok(r[0].cured === 1 && !st(r, 0, 'cards', 1).poison && st(r, 0, 'cards', 1).weakened && st(r, 0, 'cards', 2).poison, JSON.stringify(r))],
    ['cure.immune (Lab): the cured ally is immune to Poison for 5 steps, then Poison lands', dg({ 1: { status: { poison: { stacks: 1, until: 9 } } } }, [foe()]),
      [{ op: 'cure', t: c1, keys: ['poison'], immune: 5 }, apply(c1, 'poison', { src: e0 }), { op: 'clock', n: 4 }, apply(c1, 'poison', { src: e0 }), { op: 'clock' }, apply(c1, 'poison', { src: e0 })],
      (r) => ok(r[1].reason === 'cure_immune' && r[3].reason === 'cure_immune' && r[5].applied === true && im(r, 0, 'cards', 1).poison === 1 + 5 - 1, JSON.stringify(r.map((x) => [x.applied, x.reason])))],
    ['empower.default (Lab): stack false: the higher Empower stays (0.3, then 0.2 -> 0.3)', dg({ 1: {} }, [foe()]), [apply(c1, 'empowered', { value: 0.3 }), apply(c1, 'empowered', { value: 0.2 })],
      (r) => ok(S.empowered.stack === false && near(st(r, 1, 'cards', 1).empowered.value, 0.3), JSON.stringify(r))],
    // ---- durations and the stacking rules
    ['Poison lasts dur on a foe and dur_card on a card; a Controller adds dur_add on the other side only', dg({ 1: { role: 'controller' }, 2: {} }, [foe()], { clock: 3 }),
      [apply(e0, 'poison'), apply(c2, 'poison', { src: e0 }), apply(e1 === null ? e0 : e0, 'poison', ctl), apply(c2, 'poison', ctl)],
      (r) => ok(st(r, 0).poison.until === 3 + S.poison.dur && st(r, 1, 'cards', 2).poison.until === 3 + S.poison.dur_card && st(r, 2).poison.until === 3 + S.poison.dur + R.controller.dur_add
        && st(r, 3, 'cards', 2).poison.until === 3 + S.poison.dur_card && st(r, 2).poison.stacks === 2, JSON.stringify(r.map((x) => x.u)))],
    ['Burn adds up to max and has no end step; at 1 stack its tick ends it', dg({ 1: {} }, [foe(), foe()]), [apply(e0, 'burn', { stacks: 4 }), apply(e0, 'burn', { stacks: 3 }), apply(e1, 'burn'), { op: 'step_end' }],
      (r) => ok(eq(st(r, 1).burn, { stacks: S.burn.max }) && !st(r, 3, 'enemies', 1).burn && r[3].ticks.length === 2, JSON.stringify(r))],
    ['Chill on a card lasts dur_card; Chill on a Frostborn is refused', dg({ 1: {} }, [foe({ mechanics: ['frostborn'] })], { clock: 2 }), [apply(c1, 'chill', { src: e0 }), apply(e0, 'chill', ctl)],
      (r) => ok(eq(st(r, 0, 'cards', 1).chill, { stacks: 1, until: 2 + S.chill.dur_card }) && r[1].reason === 'immune', JSON.stringify(r))],
    ['Chill to freeze_at while the control immunity counts: Frozen fails, Chill stays at freeze_at - 1 (no lock)', dg({ 1: {} }, [foe({ immune: { control: 5 } })], { clock: 3 }),
      [apply(e0, 'chill', { stacks: S.chill.freeze_at + 1 })], (r) => ok(r[0].applied === true && !r[0].frozen && st(r, 0).chill.stacks === S.chill.freeze_at - 1 && !st(r, 0).frozen, JSON.stringify(r))],
    ['a direct Frozen clears Chill too (the end state)', dg({ 1: {} }, [foe({ status: { chill: { stacks: 2, until: 9 } } })]), [apply(e0, 'frozen')],
      (r) => ok(!st(r, 0).chill && st(r, 0).frozen.until === 1 + S.frozen.max_life, JSON.stringify(r))],
    ['Exposed adds up to cap; Thick Hide caps at expose_cap; a Dispeller takes x dispeller.x', dg({ 1: {} }, [foe(), foe({ mechanics: ['thick_hide'] }), foe({ mechanics: ['dispeller'] })]),
      [apply(e0, 'exposed', { value: 0.6 }), apply(e0, 'exposed', { value: 0.6 }), apply(e1, 'exposed', { value: 0.6 }), apply(En(2), 'exposed', { value: 0.5 })],
      (r) => ok(near(st(r, 1).exposed.value, Math.min(S.exposed.cap, 1.2)) && near(st(r, 2, 'enemies', 1).exposed.value, M.thick_hide.expose_cap) && near(st(r, 3, 'enemies', 2).exposed.value, 0.5 * M.dispeller.x), JSON.stringify(r.map((x) => x.u.enemies)))],
    ['Weakened adds up to cap; an expired one starts again from 0', dg({ 1: {} }, [foe({ status: { weakened: { value: 0.5, until: 0 } } }), foe()], { clock: 2 }),
      [apply(e0, 'weakened', { value: 0.2 }), apply(e1, 'weakened', { value: 0.4 }), apply(e1, 'weakened', { value: 0.4 })],
      (r) => ok(near(st(r, 0).weakened.value, 0.2) && near(st(r, 2, 'enemies', 1).weakened.value, S.weakened.cap), JSON.stringify(r.map((x) => x.u.enemies)))],
    ['Mark: the higher value stays, mark.dur (no Controller add); Mark on a card is refused', dg({ 1: { role: 'controller' } }, [foe()], { clock: 2 }),
      [apply(e0, 'mark', { value: 0.5, src: c1 }), apply(e0, 'mark', { value: 0.2, src: c1 }), apply(c1, 'mark', { value: 0.2 })],
      (r) => ok(eq(st(r, 1).mark, { value: 0.5, until: 2 + S.mark.dur }) && /does not apply to a card/.test(r[2].error || ''), JSON.stringify(r))],
    ['Slowed and Quickened last dur / dur_card; a value is refused', dg({ 1: {} }, [foe()], { clock: 2 }), [apply(e0, 'slowed'), apply(c1, 'quickened'), apply(e0, 'slowed', { value: 0.5 })],
      (r) => ok(eq(st(r, 0).slowed, { until: 2 + S.slowed.dur }) && eq(st(r, 1, 'cards', 1).quickened, { until: 2 + S.quickened.dur_card }) && /has no value/.test(r[2].error || ''), JSON.stringify(r))],
    ['Blinded and Confused take a dur; Enraged has the default value enraged.x and dur; Focused value and dur_card / dur', dg({ 1: {} }, [foe()], { clock: 2 }),
      [apply(e0, 'blinded', { dur: 5 }), apply(c1, 'confused', { src: e0 }), apply(e0, 'enraged'), apply(c1, 'focused', { value: 0.1 })],
      (r) => ok(eq(st(r, 0).blinded, { until: 7 }) && eq(st(r, 1, 'cards', 1).confused, { until: 2 + S.confused.dur_card }) && eq(st(r, 2).enraged, { value: S.enraged.x, until: 2 + S.enraged.dur })
        && eq(st(r, 3, 'cards', 1).focused, { value: 0.1, until: 2 + (S.focused.dur_card ?? S.focused.dur) }), JSON.stringify(r.map((x) => x.u)))],
    ['Empowered: the higher value stays, up to cap', dg({ 1: {} }, [foe()]), [apply(c1, 'empowered', { value: 9 })],
      (r) => ok(near(st(r, 0, 'cards', 1).empowered.value, S.empowered.cap), JSON.stringify(r))],
    ['Empowered with empowered.stack true (a balance switch): they add up to stack_cap', dg({ 1: {} }, [foe()]), [apply(c1, 'empowered', { value: 0.3 }), apply(c1, 'empowered', { value: 0.3 })],
      (r) => ok(near(st(r, 1, 'cards', 1).empowered.value, Math.min(S.empowered.stack_cap, 0.6)) && near(st(r, 0, 'cards', 1).empowered.value, 0.3), JSON.stringify(r)),
      { v2_status: { ...S, empowered: { ...S.empowered, stack: true } } }],
    ['Shielded (card) and Guarded (enemy) add up to cap_maxhp x max', dg({ 1: { max: 200, hp: 200 } }, [foe()]), [apply(c1, 'shielded', { value: 150 }), apply(c1, 'shielded', { value: 150 }), apply(e0, 'guarded', { value: 300 })],
      (r) => ok(near(st(r, 1, 'cards', 1).shielded.value, Math.min(300, 200 * S.shielded.cap_maxhp)) && near(st(r, 2).guarded.value, 300), JSON.stringify(r))],
    // ---- control: durations, the boss limit, one at a time, the immunity lengths
    ['Stunned: until = clock + max_life (foe) / max_life_card (card); on the Hunt boss max_life; Sleep and Paralyzed on the boss boss_max_dur, even from a Controller',
      { mode: 'hunt', clock: 5, cards: { 1: { role: 'controller' }, 2: {} }, enemies: [{ max: 50000, hp: 50000, speed: 100 }] },
      [apply(c2, 'stunned', { src: e0 }), apply(e0, 'stunned', ctl), { op: 'turn', t: e0 }, { op: 'clock', n: CT.boss_immune }, apply(e0, 'sleep', ctl), { op: 'set', path: ['enemies', '0', 'status'], v: {} }, { op: 'set', path: ['enemies', '0', 'immune'], v: {} }, apply(e0, 'paralyzed', ctl)],
      (r) => ok(st(r, 0, 'cards', 2).stunned.until === 5 + S.stunned.max_life_card && st(r, 1).stunned.until === 5 + S.stunned.max_life && im(r, 2).control === 5 + CT.boss_immune - 1
        && st(r, 4).sleep.until === 5 + CT.boss_immune + CT.boss_max_dur && st(r, 7).paralyzed.until === 5 + CT.boss_immune + CT.boss_max_dur, JSON.stringify(r.map((x) => [x.reason, x.u.enemies[0]])))],
    ['the Hunt boss limit is AT MOST boss_max_dur (the v2_control note): with boss_max_dur above dur, Sleep and Paralyzed on the boss last dur (+ dur_add), not boss_max_dur',
      { mode: 'hunt', clock: 5, cards: { 1: { role: 'controller' } }, enemies: [{ max: 50000, hp: 50000, speed: 100 }] },
      [apply(e0, 'sleep'), { op: 'set', path: ['enemies', '0', 'status'], v: {} }, apply(e0, 'paralyzed', ctl)],
      (r, b) => ok(st(r, 0).sleep.until === 5 + Math.min(S.sleep.dur, 10) && st(r, 2).paralyzed.until === 5 + Math.min(S.paralyzed.dur + R.controller.dur_add, 10)
        && S.sleep.dur < 10, JSON.stringify(r.map((x) => [x.reason, x.u.enemies[0]]))),
      { v2_control: { ...CT, boss_max_dur: 10 } }],
    ['Sleep and Paralyzed on a foe: dur + the Controller dur_add; on a card: dur_card', dg({ 1: { role: 'controller' }, 2: {} }, [foe(), foe()], { clock: 1 }),
      [apply(e0, 'sleep', ctl), apply(e1, 'paralyzed'), apply(c2, 'sleep', { src: e0 })],
      (r) => ok(st(r, 0).sleep.until === 1 + S.sleep.dur + R.controller.dur_add && st(r, 1, 'enemies', 1).paralyzed.until === 1 + S.paralyzed.dur && st(r, 2, 'cards', 2).sleep.until === 1 + S.sleep.dur_card, JSON.stringify(r.map((x) => x.u)))],
    ['one control at a time: Sleep on a Stunned foe is refused (control_immune) and changes nothing', dg({ 1: {} }, [foe()]), [apply(e0, 'stunned'), apply(e0, 'sleep'), apply(e0, 'paralyzed')],
      (r) => ok(r[1].reason === 'control_immune' && r[2].reason === 'control_immune' && eq(Object.keys(st(r, 2)), ['stunned']), JSON.stringify(r))],
    ['the control immunity lasts immune_card steps on a card, boss_immune on the Hunt boss, immune on a foe (the last step is clock + n - 1)',
      { mode: 'hunt', clock: 2, cards: { 1: {} }, enemies: [{ max: 50000, hp: 50000, speed: 100 }] },
      [apply(c1, 'stunned', { src: e0 }), { op: 'turn', t: c1 }, apply(e0, 'stunned'), { op: 'turn', t: e0 }, { op: 'set', path: ['mode'], v: 'dungeon' }, { op: 'set', path: ['enemies', '0', 'immune'], v: {} }, { op: 'clock', n: 10 }, apply(e0, 'stunned'), { op: 'turn', t: e0 }],
      (r) => ok(im(r, 1, 'cards', 1).control === 2 + CT.immune_card - 1 && im(r, 3).control === 2 + CT.boss_immune - 1 && im(r, 8).control === 12 + CT.immune - 1, JSON.stringify(r.map((x) => x.u)))],
    ['the Stun safety limit: an unused Stun ends at the end of its max_life step, and the immunity starts', dg({ 1: {} }, [foe()], { clock: 1 }),
      [apply(e0, 'stunned'), { op: 'step_end' }, { op: 'clock', n: S.stunned.max_life }, { op: 'step_end' }],
      (r) => ok(st(r, 1).stunned && !st(r, 3).stunned && r[3].ended.length === 1 && im(r, 3).control === 1 + S.stunned.max_life + CT.immune - 1, JSON.stringify(r))],
    ['remove: ending a control status starts the immunity; removing a missing status changes nothing', dg({ 1: {} }, [foe()], { clock: 3 }),
      [apply(e0, 'sleep'), { op: 'remove', t: e0, key: 'sleep' }, { op: 'remove', t: e0, key: 'poison' }],
      (r) => ok(r[1].removed === true && im(r, 1).control === 3 + CT.immune - 1 && r[2].removed === false, JSON.stringify(r))],
    // ---- resolve, Accuracy, Unstoppable and the draw slots
    ['resolve: a draw below res resists (1 draw); a draw at res lands', dg({ 1: {} }, [foe({ resolve: 0.2 })]),
      [apply(e0, 'weakened', { value: 0.1, src: c1, draws: [0.2 - 1e-9] }), apply(e0, 'weakened', { value: 0.1, src: c1, draws: [0.2] })],
      (r) => ok(r[0].reason === 'resisted' && r[0].draws.length === 1 && r[1].applied === true && r[1].draws.length === 1, JSON.stringify(r))],
    ['resolve: the Controller ignores resolve_ignore of it; Accuracy removes resolve_acc a point (acc / acc.pct points)', dg({ 1: { role: 'controller' }, 2: { acc: 2 * B.v2_stats.acc.pct } }, [foe({ resolve: 0.2 })]),
      [apply(e0, 'weakened', { value: 0.1, src: c1, draws: [0.2 * (1 - R.controller.resolve_ignore) - 1e-9] }), apply(e0, 'weakened', { value: 0.1, src: c1, draws: [0.2 * (1 - R.controller.resolve_ignore)] }),
        apply(e0, 'weakened', { value: 0.1, src: c2, draws: [0.2 - 2 * H.resolve_acc - 1e-9] }), apply(e0, 'weakened', { value: 0.1, src: c2, draws: [0.2 - 2 * H.resolve_acc] })],
      (r) => ok(r[0].reason === 'resisted' && r[1].applied && r[2].reason === 'resisted' && r[3].applied, JSON.stringify(r.map((x) => [x.applied, x.reason])))],
    ['resolve draws only for a negative status from the other side with res above 0', dg({ 1: {} }, [foe({ resolve: 0.2 }), foe()]),
      [apply(e0, 'weakened', { value: 0.1, draws: [] }), apply(e1, 'weakened', { value: 0.1, src: c1, draws: [] }), apply(e0, 'enraged', { src: e1, draws: [] }), apply(c1, 'weakened', { value: 0.1, src: e0, draws: [] })],
      (r) => ok(r.every((x) => x.applied === true && x.draws.length === 0), JSON.stringify(r))],
    ['Unstoppable: a control draws after the resolve draw; below control_fail it resists', dg({ 1: {} }, [foe({ resolve: 0.2, mechanics: ['unstoppable'] })]),
      [apply(e0, 'stunned', { src: c1, draws: [0.5, M.unstoppable.control_fail - 1e-9] }), apply(e0, 'stunned', { src: c1, draws: [0.5, M.unstoppable.control_fail] }), apply(e0, 'poison', { src: c1, draws: [0.5] })],
      (r) => ok(r[0].reason === 'resisted' && r[0].draws.length === 2 && r[1].applied && r[1].draws.length === 2 && r[2].draws.length === 1, JSON.stringify(r))],
    ['Chill to Frozen on Unstoppable: the slots are [resolve of Chill, Unstoppable of Frozen]; a resisted Frozen keeps Chill at freeze_at - 1', dg({ 1: {} }, [foe({ resolve: 0.1, mechanics: ['unstoppable'] })]),
      [apply(e0, 'chill', { stacks: S.chill.freeze_at, src: c1, draws: [0.5, 0.01] }), apply(e0, 'chill', { stacks: 1, src: c1, draws: [0.5, 0.99] })],
      (r) => ok(r[0].draws.length === 2 && !r[0].frozen && st(r, 0).chill.stacks === S.chill.freeze_at - 1 && r[1].frozen === true && st(r, 1).frozen, JSON.stringify(r))],
    ['the cure immunity counts on cards only, and only for negative statuses (the simulator rule)', dg({ 1: { immune: { quickened: 9 } } }, [foe({ immune: { poison: 9 } })]),
      [apply(e0, 'poison'), apply(c1, 'quickened')], (r) => ok(r[0].applied && r[1].applied, JSON.stringify(r))],
    // ---- damage, ticks, the Warden, fall, heal, the hit
    ['ticks: Defense counts, shields do not, Exposed raises them; the Warden cuts a tick on an ally, not on itself', dg({ 1: { def: 0.3, status: { shielded: { value: 500 }, poison: { stacks: 1, until: 9 }, exposed: { value: 0.5, until: 9 } } }, 2: { role: 'warden', status: { poison: { stacks: 1, until: 9 } } } }, [foe()]),
      [{ op: 'step_end' }],
      (r) => ok(near(r[0].ticks[0].dmg, S.poison.tick * 100 * 1.5 * 0.7 * (1 - R.warden.ally_dr)) && near(r[0].ticks[1].dmg, S.poison.tick * 100) && st(r, 0, 'cards', 1).shielded.value === 500, JSON.stringify(r))],
    ['the Hunt boss ticks on hunt_ref_hp; a card in the Hunt on its max', hunt({ status: { poison: { stacks: 2, until: 9 } } }), [{ op: 'set', path: ['cards', '1', 'status'], v: { burn: { stacks: 1 } } }, { op: 'step_end' }],
      (r) => ok(near(r[1].ticks[1].dmg, 2 * S.poison.tick * S.hunt_ref_hp) && near(r[1].ticks[0].dmg, S.poison.tick * S.burn.tick_x * 100), JSON.stringify(r[1].ticks))],
    ['a tick does not wake Sleep; damage does; a hit with damage does; a missed hit does not', dg({ 1: {} }, [foe({ status: { sleep: { until: 9 }, poison: { stacks: 1, until: 9 } } }), foe({ status: { sleep: { until: 9 } } }), foe({ status: { sleep: { until: 9 } } })]),
      [{ op: 'step_end' }, { op: 'hit', a: c1, t: e1, ctx: { side: 'card', draws: [0.99, 0.5, 0.99] } }, { op: 'hit', a: c1, t: En(2), ctx: { side: 'card', draws: [0] } }, { op: 'damage', t: e0, amount: 5 }],
      (r) => ok(st(r, 0).sleep && !st(r, 1, 'enemies', 1).sleep && r[1].woke === true && st(r, 2, 'enemies', 2).sleep && r[2].woke === false && !st(r, 3).sleep, JSON.stringify(r.map((x) => [x.woke, x.u.enemies.map((e) => Object.keys(e.status))])))],
    ['the hit answer is written: HP, the shield (gone at 0), down with no status', dg({ 1: { atk: 2000, crt: 0 } }, [foe({ hp: 300, status: { guarded: { value: 50 }, exposed: { value: 0.1, until: 9 } } }), foe({ status: { guarded: { value: 5000 } } })]),
      [{ op: 'hit', a: c1, t: e1, ctx: { side: 'card', draws: [0.99, 0.5, 0.99] } }, { op: 'hit', a: c1, t: e0, ctx: { side: 'card', draws: [0.99, 0.5, 0.99] } }],
      (r) => ok(near(st(r, 0, 'enemies', 1).guarded.value, 5000 - 2000) && hp(r, 0, 'enemies', 1) === 1000 && r[1].u.enemies[0].down === true && hp(r, 1) === 0 && eq(st(r, 1), {}), JSON.stringify(r))],
    ['damage: min_dmg for damage that is not a tick, none for a tick; a down unit takes nothing', dg({ 1: {} }, [foe(), foe({ hp: 0, down: true })]),
      [{ op: 'damage', t: e0, amount: 0.01 }, { op: 'damage', t: e0, amount: 0.01, o: { tick: true } }, { op: 'damage', t: e1, amount: 50 }],
      (r) => ok(near(r[0].dmg, H.min_dmg) && near(r[1].dmg, 0.01) && r[2].dmg === 0 && hp(r, 2, 'enemies', 1) === 0, JSON.stringify(r))],
    ['a tick kills: down, 0 HP, no status (the immunity stays as data)', dg({ 1: { hp: 1, status: { poison: { stacks: 1, until: 9 }, stunned: { until: 9 } } } }, [foe()]), [{ op: 'step_end' }],
      (r) => ok(r[0].u.cards[1].down === true && hp(r, 0, 'cards', 1) === 0 && eq(st(r, 0, 'cards', 1), {}), JSON.stringify(r))],
    ['heal: up to max; a down unit is not healed', dg({ 1: { hp: 90 }, 2: { hp: 0, down: true } }, [foe()]), [{ op: 'heal', t: c1, amount: 50 }, { op: 'heal', t: c2, amount: 50 }],
      (r) => ok(r[0].healed === 10 && hp(r, 0, 'cards', 1) === 100 && r[1].healed === 0 && hp(r, 1, 'cards', 2) === 0, JSON.stringify(r))],
    ['the mechanic regrowth counts as a healer for Burn', dg({ 1: {} }, [foe({ mechanics: ['regrowth'], status: { burn: { stacks: 2 } } })]), [{ op: 'step_end' }],
      (r) => ok(near(r[0].ticks[0].dmg, 2 * S.poison.tick * S.burn.tick_x * 1000 * S.burn.vs_healer_x), JSON.stringify(r))],
    // ---- the turn start and Confused
    ['Paralyzed: a draw below fail skips (1 draw); at fail it acts; no draw without Paralyzed', dg({ 1: {} }, [foe({ status: { paralyzed: { until: 9 } } }), foe()]),
      [{ op: 'turn', t: e0, draws: [S.paralyzed.fail - 1e-9] }, { op: 'turn', t: e0, draws: [S.paralyzed.fail] }, { op: 'turn', t: e1, draws: [] }],
      (r) => ok(r[0].skip && r[0].reason === 'paralyzed' && r[0].draws.length === 1 && !r[1].skip && r[2].draws.length === 0 && st(r, 0).paralyzed, JSON.stringify(r))],
    ['an expired status does not skip (Stunned until 2 at clock 3)', dg({ 1: {} }, [foe({ status: { stunned: { until: 2 } } })], { clock: 3 }), [{ op: 'turn', t: e0 }],
      (r) => ok(r[0].skip === false, JSON.stringify(r))],
    ['Confused: a draw below chance picks a unit of its OWN side (a second draw, the fixed order, itself included); at chance: no wrong target', dg({ 1: {}, 7: {}, 3: {} }, [foe()], { squad: [7, 1, 3] }),
      [apply(c1, 'confused', { src: e0 }), { op: 'confused', t: c1, draws: [S.confused.chance - 1e-9, 0.0] }, { op: 'confused', t: c1, draws: [0, 0.99] }, { op: 'confused', t: c1, draws: [S.confused.chance] }, { op: 'confused', t: En(0), draws: [] }],
      (r) => ok(r[1].wrong && eq(r[1].target, { side: 'card', id: 7 }) && near(r[1].x, S.confused.self_x) && eq(r[2].target, { side: 'card', id: 3 }) && !r[3].wrong && r[3].draws.length === 1 && !r[4].wrong && r[4].draws.length === 0, JSON.stringify(r))],
    // ---- cure and strip
    ['strip (dispel): every boost and both shields go, the negative statuses stay', dg({ 1: { status: { shielded: { value: 40 }, empowered: { value: 0.3 }, focused: { value: 0.1, until: 9 }, quickened: { until: 9 }, poison: { stacks: 1, until: 9 } } } },
      [foe({ status: { guarded: { value: 40 }, enraged: { value: 1.4, until: 9 }, quickened: { until: 9 }, weakened: { value: 0.2, until: 9 } } })]),
      [{ op: 'strip', t: c1, keys: null }, { op: 'strip', t: e0, keys: null }, { op: 'strip', t: c1, keys: ['poison'] }],
      (r) => ok(eq(Object.keys(st(r, 0, 'cards', 1)), ['poison']) && eq(Object.keys(st(r, 1)), ['weakened']) && /not a boost/.test(r[2].error || ''), JSON.stringify(r))],
    ['strip of one boost (the boss move strip): only that one', dg({ 1: { status: { empowered: { value: 0.3 }, quickened: { until: 9 } } } }, [foe()]), [{ op: 'strip', t: c1, keys: ['quickened'] }],
      (r) => ok(eq(r[0].removed, ['quickened']) && st(r, 0, 'cards', 1).empowered, JSON.stringify(r))],
    ['cure: a control status removed by a cure starts the control immunity; keys must be negative statuses', dg({ 1: { status: { sleep: { until: 9 } } } }, [foe()], { clock: 2 }),
      [{ op: 'cure', t: c1, keys: ['sleep'], immune: 0 }, { op: 'cure', t: c1, keys: ['quickened'] }],
      (r) => ok(im(r, 0, 'cards', 1).control === 2 + CT.immune_card - 1 && /not a negative status/.test(r[1].error || ''), JSON.stringify(r))],
    // ---- the step end
    ['the step end runs once a step (ext.step_end): a second call ticks nothing', dg({ 1: {} }, [foe({ status: { poison: { stacks: 1, until: 9 } } })], { clock: 4 }), [{ op: 'step_end' }, { op: 'step_end' }],
      (r) => ok(r[0].ticks.length === 1 && r[1].ticks.length === 0 && r[1].done === true && hp(r, 1) === 1000 - S.poison.tick * 1000, JSON.stringify(r))],
    ['a status ends at the end of its until step, not before', dg({ 1: {} }, [foe({ status: { blinded: { until: 4 }, slowed: { until: 5 } } })], { clock: 4 }), [{ op: 'step_end' }],
      (r) => ok(!st(r, 0).blinded && st(r, 0).slowed && eq(r[0].ended, [{ side: 'enemy', id: 0, status: 'blinded' }]), JSON.stringify(r))],
    ['the tick order is the fixed order: a Warden that falls to its Poison no longer cuts the next card', dg({ 1: { role: 'warden', hp: 1, status: { poison: { stacks: 1, until: 9 } } }, 2: { status: { poison: { stacks: 1, until: 9 } } } }, [foe()], { squad: [1, 2] }),
      [{ op: 'step_end' }], (r) => ok(r[0].u.cards[1].down && near(r[0].ticks[1].dmg, S.poison.tick * 100), JSON.stringify(r))],
    // ---- the driver: the step end between the steps
    ['next: the step end runs between the steps (one Poison tick for each step crossed), the steps count, then the actor', dg({ 1: { speed: 1 } }, [foe({ speed: 25, meter: 0, status: { poison: { stacks: 1, until: 99 } } })], { clock: 0 }),
      [{ op: 'next' }, { op: 'next' }],
      (r) => ok(r[0].event === 'act' && r[0].steps === 4 && r[0].ticks.length === 3 && r[0].u.clock === 4 && r[1].ticks.length === 4 && r[1].u.clock === 8 && hp(r, 1) === 1000 - 7 * S.poison.tick * 1000, JSON.stringify(r.map((x) => [x.event, x.steps, x.ticks.length, x.u.clock])))],
    ['next: the turn start of the actor (a Stunned actor skips, with its reason)', dg({ 1: { speed: 1 } }, [foe({ speed: 100, status: { stunned: { until: 9 } } })], { clock: 0 }),
      [{ op: 'next' }, { op: 'next' }],
      (r) => ok(r[0].skip === true && r[0].reason === 'stunned' && r[1].skip === false && eq(r[0].actor, { side: 'enemy', id: 0 }), JSON.stringify(r))],
    ['next: end when a Poison tick takes the last foe; cap at the step cap of the mode', dg({ 1: { speed: 1 } }, [foe({ hp: 5, speed: 1, status: { poison: { stacks: 2, until: 99 } } })], { clock: 0 }),
      [{ op: 'next' }, { op: 'set', path: ['enemies', '0'], v: { hp: 1000, max: 1000, down: false, meter: 0, charge: 0, speed: 1, status: {} } }, { op: 'set', path: ['ext'], v: {} }, { op: 'next' }],
      (r) => ok(r[0].event === 'end' && r[0].u.enemies[0].down && r[3].event === 'cap' && r[3].u.clock === B.v2_dungeon.round_cap, JSON.stringify(r.map((x) => [x.event, x.u.clock])))],
    // ---- the turn-order strip
    ['turn order: a Stunned unit shows skip on its next entry only; Sleep on each entry until its end; Paralyzed may_fail', dg({ 1: { speed: 1 } }, [foe({ speed: 100, status: { stunned: { until: 99 } } }), foe({ speed: 100, status: { sleep: { until: 2 } } }), foe({ speed: 100, status: { paralyzed: { until: 99 } } })], { clock: 0 }),
      [{ op: 'order', n: 6 }],
      (r) => ok(eq(r[0].order, [{ side: 'enemy', id: 0, clock: 1, skip: 'stunned' }, { side: 'enemy', id: 1, clock: 1, skip: 'sleep' }, { side: 'enemy', id: 2, clock: 1, may_fail: true },
        { side: 'enemy', id: 0, clock: 2 }, { side: 'enemy', id: 1, clock: 2, skip: 'sleep' }, { side: 'enemy', id: 2, clock: 2, may_fail: true }]), JSON.stringify(r[0].order))],
    ['turn order redraws in place: Slowed and Quickened applied by combat_v2_status_apply change the strip', dg({ 1: { speed: 30 } }, [foe({ speed: 50 })], { clock: 0 }),
      [{ op: 'order', n: 8 }, apply(e0, 'slowed'), { op: 'order', n: 8 }, apply(c1, 'quickened'), { op: 'order', n: 8 }],
      (r) => ok(!eq(r[0].order, r[2].order) && !eq(r[2].order, r[4].order), JSON.stringify(r.map((x) => x.order)))],
    ['turn order = the actual sequence of next with no actions (skips included)', dg({ 1: { speed: 23, meter: 40 }, 2: { speed: 17, meter: 90, status: { sleep: { until: 4 } } } }, [foe({ speed: 50, meter: 60, status: { stunned: { until: 99 } } }), foe({ speed: 45, meter: 10 })], { clock: 0 }),
      [{ op: 'order', n: 10 }, ...Array.from({ length: 10 }, () => ({ op: 'next' }))],
      (r) => { const seq = r.slice(1).map((x) => ({ ...x.actor, clock: x.u.clock, ...(x.skip ? { skip: x.reason } : {}) })); return ok(eq(r[0].order, seq), JSON.stringify({ order: r[0].order, seq })); }],
  ];
}
// each refusal: [name, state spec, op, words]
const BAD = [
  ['an unknown status', { cards: { 1: {} }, enemies: [{}] }, apply(En(0), 'petrified'), 'unknown status'],
  ['Empowered on an enemy', { cards: { 1: {} }, enemies: [{}] }, apply(En(0), 'empowered', { value: 0.2 }), 'does not apply to a enemy'],
  ['stacks 0', { cards: { 1: {} }, enemies: [{}] }, apply(En(0), 'poison', { stacks: 0 }), 'stacks must be a whole number'],
  ['stacks 1.5', { cards: { 1: {} }, enemies: [{}] }, apply(En(0), 'poison', { stacks: 1.5 }), 'stacks must be a whole number'],
  ['a negative value', { cards: { 1: {} }, enemies: [{}] }, apply(En(0), 'exposed', { value: -0.1 }), 'value must be a number of 0 or more'],
  ['no value for Exposed', { cards: { 1: {} }, enemies: [{}] }, apply(En(0), 'exposed'), 'needs a value'],
  ['a dur for Poison', { cards: { 1: {} }, enemies: [{}] }, apply(En(0), 'poison', { dur: 3 }), 'takes its duration from balance'],
  ['a dur of 0', { cards: { 1: {} }, enemies: [{}] }, apply(En(0), 'blinded', { dur: 0 }), 'dur must be a whole number'],
  ['a value for Quickened', { cards: { 1: {} }, enemies: [{}] }, apply(Cr(1), 'quickened', { value: 1.3 }), 'has no value'],
  ['a missing unit', { cards: { 1: {} }, enemies: [{}] }, apply(En(3), 'poison'), 'the state has no enemy 3'],
  ['a bad side', { cards: { 1: {} }, enemies: [{}] }, apply({ side: 'boss', id: 0 }, 'poison'), 'a unit is {side: card or enemy, id}'],
  ['an unknown source', { cards: { 1: {} }, enemies: [{}] }, apply(En(0), 'poison', { src: Cr(9) }), 'the state has no card 9'],
  ['draws not a list', { cards: { 1: {} }, enemies: [{ resolve: 0.2 }] }, apply(En(0), 'poison', { src: Cr(1), draws: { a: 1 } }), 'opts.draws must be a list'],
  ['a missing draw slot', { cards: { 1: {} }, enemies: [{ resolve: 0.2 }] }, apply(En(0), 'poison', { src: Cr(1), draws: [] }), 'the draw slot 1 is missing'],
  ['an unknown mechanic', { cards: { 1: {} }, enemies: [{ mechanics: ['flying'] }] }, apply(En(0), 'poison'), 'is not a mechanic of v2_enemy.mechanics'],
  ['a v1 state', null, apply(En(0), 'poison'), 'must be a fight state v 2'],
  ['cure keys not a list', { cards: { 1: {} }, enemies: [{}] }, { op: 'cure', t: Cr(1), keys: 'poison' }, 'keys must be a list'],
  ['cure immune below 0', { cards: { 1: {} }, enemies: [{}] }, { op: 'cure', t: Cr(1), keys: null, immune: -1 }, 'immune must be a whole number'],
  ['strip of an unknown key', { cards: { 1: {} }, enemies: [{}] }, { op: 'strip', t: Cr(1), keys: ['halo'] }, 'is not a boost'],
  ['remove of an unknown status', { cards: { 1: {} }, enemies: [{}] }, { op: 'remove', t: Cr(1), key: 'halo' }, 'unknown status'],
  ['a hit on its own side', { cards: { 1: {} }, enemies: [{}] }, { op: 'hit', a: Cr(1), t: Cr(1), ctx: { side: 'card', draws: [0.99, 0.5, 0.99] } }, 'lands on the other side'],
  ['turn draws not a list', { cards: { 1: {} }, enemies: [{ status: { paralyzed: { until: 9 } } }] }, { op: 'turn', t: En(0), draws: 5 }, 'draws must be a list'],
  ['a damage amount NULL', { cards: { 1: {} }, enemies: [{}] }, { op: 'damage', t: En(0), amount: null }, 'the amount must be a number'],
];

// ---------------------------------------------------------------------------------------------------------------- the rates (random() after setseed), the no-lock bound, the draws
const N = 4000;
const statBlock = (B) => String.raw`do $t$
declare res jsonb := '{}'; b jsonb; s jsonb; r jsonb; i int; n int; turns int; skips int; a jsonb; c record; r1 jsonb; r2 jsonb; x numeric[]; k int; nx numeric;
  base jsonb := ${sqlLit(state({ cards: { 1: { role: 'striker', hp: 1e9, max: 1e9 } }, enemies: [{ hp: 1e9, max: 1e9 }] }))};
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_status_numbers();
  -- Paralyzed: each action fails with fail
  perform setseed(0.21); n := 0;
  s := jsonb_set(base, '{enemies,0,status}', '{"paralyzed": {"until": 99}}');
  for i in 1 .. ${N} loop if (combat_v2_turn_start(s, '{"side": "enemy", "id": 0}', null, b)->>'skip')::boolean then n := n + 1; end if; end loop;
  res := res || jsonb_build_object('paralyzed', n::numeric / ${N});
  -- Unstoppable: control fails control_fail
  perform setseed(0.22); n := 0;
  s := jsonb_set(base, '{enemies,0,mechanics}', '["unstoppable"]');
  for i in 1 .. ${N} loop if (combat_v2_status_apply(s, '{"side": "enemy", "id": 0}', 'stunned', '{}', b)->>'applied')::boolean then n := n + 1; end if; end loop;
  res := res || jsonb_build_object('unstoppable', n::numeric / ${N});
  -- resolve 20%: a debuff fails 20%
  perform setseed(0.23); n := 0;
  s := jsonb_set(base, '{enemies,0,resolve}', '0.2');
  for i in 1 .. ${N} loop if (combat_v2_status_apply(s, '{"side": "enemy", "id": 0}', 'weakened', '{"value": 0.1, "src": {"side": "card", "id": 1}}', b)->>'applied')::boolean then n := n + 1; end if; end loop;
  res := res || jsonb_build_object('resolve', n::numeric / ${N});
  -- Confused: the wrong target
  perform setseed(0.24); n := 0;
  s := jsonb_set(base, '{enemies,0,status}', '{"confused": {"until": 99}}');
  for i in 1 .. ${N} loop if (combat_v2_confused_target(s, '{"side": "enemy", "id": 0}', null, b)->>'wrong')::boolean then n := n + 1; end if; end loop;
  res := res || jsonb_build_object('confused', n::numeric / ${N});
  -- the no-lock bound: all 4 controls on the enemy (or the card) before every action, to the step cap
  for c in select * from (values ('hunt', 'enemy', 100), ('dungeon', 'enemy', 100), ('dungeon', 'card', 100), ('hunt', 'enemy', 110)) v(mode, who, spd) loop
    perform setseed(0.25);
    s := base || jsonb_build_object('mode', c.mode, 'clock', 0);
    s := jsonb_set(jsonb_set(s, '{enemies,0,speed}', to_jsonb(case when c.who = 'enemy' then c.spd else 1 end)), '{cards,1,speed}', to_jsonb(case when c.who = 'card' then c.spd else 1 end));
    turns := 0; skips := 0;
    for i in 1 .. 2000 loop
      foreach a in array array['"stunned"', '"frozen"', '"sleep"', '"paralyzed"']::jsonb[] loop
        r := combat_v2_status_apply(s, case when c.who = 'enemy' then '{"side": "enemy", "id": 0}'::jsonb else '{"side": "card", "id": 1}'::jsonb end, a #>> '{}',
               jsonb_build_object('src', case when c.who = 'enemy' then '{"side": "card", "id": 1}'::jsonb else '{"side": "enemy", "id": 0}'::jsonb end), b);
        s := r->'state';
      end loop;
      r := combat_v2_next(s, null, b); s := r->'state';
      exit when r->>'event' <> 'act';
      if r->'actor'->>'side' = c.who then turns := turns + 1; if (r->>'skip')::boolean then skips := skips + 1; end if; end if;
    end loop;
    res := res || jsonb_build_object('nolock_' || c.mode || '_' || c.who || '_' || c.spd, jsonb_build_object('turns', turns, 'skips', skips, 'clock', s->'clock'));
  end loop;
  -- the draws: a replay with the answer's draws gives the same answer; with random() after setseed the slots take the stream in order
  s := jsonb_set(jsonb_set(base, '{enemies,0,resolve}', '0.0001'), '{enemies,0,mechanics}', '["unstoppable"]');
  perform setseed(0.42); r1 := combat_v2_status_apply(s, '{"side": "enemy", "id": 0}', 'chill', '{"stacks": 9, "src": {"side": "card", "id": 1}}', b); nx := random()::numeric;
  perform setseed(0.42); x := array[random()::numeric, random()::numeric, random()::numeric, random()::numeric];
  k := jsonb_array_length(r1->'draws');
  r2 := combat_v2_status_apply(s, '{"side": "enemy", "id": 0}', 'chill', jsonb_build_object('stacks', 9, 'src', '{"side": "card", "id": 1}'::jsonb, 'draws', r1->'draws'), b);
  res := res || jsonb_build_object('replay', jsonb_build_object('same', r1 = r2, 'k', k, 'slots', r1->'draws' = to_jsonb(x[1:k]), 'next', nx = x[k + 1]));
  s := jsonb_set(base, '{cards,1,status}', '{"confused": {"until": 99}}');
  perform setseed(0.43); r1 := combat_v2_confused_target(s, '{"side": "card", "id": 1}', null, b);
  r2 := combat_v2_confused_target(s, '{"side": "card", "id": 1}', r1->'draws', b);
  res := res || jsonb_build_object('replay_confused', r1 = r2);
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the fuzz (random() after setseed)
const fuzzBlock = (B, fights, ops) => String.raw`do $t$
declare b jsonb; s jsonb; r jsonb; f int; j int; bad jsonb := '[]'; n int := 0; d numeric; t jsonb; k text; side text; keys text[]; p text[]; u jsonb; nd int := 0; nb int := 0; nf int := 0;
  cardk text[] := array['poison', 'burn', 'stunned', 'chill', 'frozen', 'sleep', 'paralyzed', 'blinded', 'confused', 'slowed', 'quickened', 'exposed', 'weakened', 'shielded', 'empowered', 'focused'];
  foek text[] := array['poison', 'burn', 'stunned', 'chill', 'frozen', 'sleep', 'paralyzed', 'blinded', 'confused', 'slowed', 'quickened', 'exposed', 'weakened', 'mark', 'enraged', 'guarded'];
  base jsonb := ${sqlLit(state({ clock: 0, squad: [1, 2, 3], cards: { 1: { role: 'warden', speed: 24, max: 300, hp: 300, def: 0.09 }, 2: { role: 'controller', speed: 20, max: 150, hp: 150, acc: 0.04 }, 3: { role: 'striker', speed: 17, max: 200, hp: 200 } },
    enemies: [{ speed: 50, max: 900, hp: 900, resolve: 0.1, mechanics: ['thick_hide'] }, { speed: 55, max: 400, hp: 400, healer: true }, { speed: 45, max: 1500, hp: 1500, def: 0.2, mechanics: ['unstoppable'] }] }))};
begin
  ${SETUP}
  execute $m$${mig}$m$;
  b := combat_v2_status_numbers();
  perform setseed(0.61);
  for f in 1 .. ${fights} loop
    s := base;
    for j in 1 .. ${ops} loop
      d := random();
      side := case when random() < 0.5 then 'card' else 'enemy' end;
      t := case when side = 'card' then jsonb_build_object('side', 'card', 'id', 1 + floor(random() * 3)) else jsonb_build_object('side', 'enemy', 'id', floor(random() * 3)) end;
      begin
        if d < 0.5 then
          k := case when side = 'card' then cardk[1 + floor(random() * 16)::int] else foek[1 + floor(random() * 16)::int] end;
          r := combat_v2_status_apply(s, t, k, jsonb_strip_nulls(jsonb_build_object('stacks', 1 + floor(random() * 4),
                 'value', case when k in ('exposed', 'weakened', 'mark', 'empowered', 'focused', 'shielded', 'guarded') then round((random() * 1.5)::numeric, 3) when k = 'enraged' then 1.4 end,
                 'src', case when random() < 0.5 then jsonb_build_object('side', 'card', 'id', 1 + floor(random() * 3)) else jsonb_build_object('side', 'enemy', 'id', floor(random() * 3)) end)), b);
        elsif d < 0.6 then r := combat_v2_damage(s, t, round((random() * 120)::numeric, 2), jsonb_build_object('tick', random() < 0.5, 'ignore_shield', random() < 0.5), b);
        elsif d < 0.65 then r := combat_v2_heal(s, t, round((random() * 80)::numeric, 2), b);
        elsif d < 0.7 then r := combat_v2_status_cure(s, t, null, floor(random() * 6)::int, b);
        elsif d < 0.73 then r := combat_v2_status_strip(s, t, null, b);
        else
          r := combat_v2_next(s, null, b); nf := nf + 1;
          if r->>'event' <> 'act' then nb := nb + 1; s := base; continue; end if;
        end if;
        s := r->'state'; n := n + 1;
      exception when others then bad := bad || jsonb_build_array('error: ' || sqlerrm); exit;
      end;
      -- the invariants
      if cardinality(fight_state_check_v2(s)) > 0 then bad := bad || to_jsonb('state: ' || array_to_string(fight_state_check_v2(s), '; ')); end if;
      for u in select x from jsonb_each(s->'cards') c(k2, x) union all select x from jsonb_array_elements(s->'enemies') x loop
        if (u->>'hp')::numeric < 0 or (u->>'hp')::numeric > (u->>'max')::numeric then bad := bad || to_jsonb('hp ' || u::text); end if;
        if ((u->>'down')::boolean or (u->>'hp')::numeric <= 0) and (u->'status' <> '{}'::jsonb or not (u->>'down')::boolean) then bad := bad || to_jsonb('down ' || u::text); end if;
        if coalesce((u->'status'->'poison'->>'stacks')::int >= (b->'v2_status'->'poison'->>'burst_at')::int, false)
           or coalesce((u->'status'->'chill'->>'stacks')::int >= (b->'v2_status'->'chill'->>'freeze_at')::int, false)
           or coalesce((u->'status'->'burn'->>'stacks')::int > (b->'v2_status'->'burn'->>'max')::int, false)
           or coalesce((u->'status'->'exposed'->>'value')::numeric > (b->'v2_status'->'exposed'->>'cap')::numeric, false)
           or coalesce((u->'status'->'weakened'->>'value')::numeric > (b->'v2_status'->'weakened'->>'cap')::numeric, false)
           or coalesce((u->'status'->'empowered'->>'value')::numeric > greatest((b->'v2_status'->'empowered'->>'cap')::numeric, (b->'v2_status'->'empowered'->>'stack_cap')::numeric), false)
           or coalesce((u->'status'->'shielded'->>'value')::numeric > (u->>'max')::numeric * (b->'v2_status'->'shielded'->>'cap_maxhp')::numeric, false)
           or coalesce((u->'status'->'guarded'->>'value')::numeric > (u->>'max')::numeric * (b->'v2_status'->'shielded'->>'cap_maxhp')::numeric, false)
           or (select count(*) from jsonb_object_keys(u->'status') z where z in ('stunned', 'frozen', 'sleep', 'paralyzed')) > 1 then
          bad := bad || to_jsonb('cap ' || (u->'status')::text);
        end if;
        if (u->'status'->'chill') is not null then nd := nd + 1; end if;
      end loop;
      if (s->>'clock')::int > greatest((b->'v2_dungeon'->>'round_cap')::int, (b->'v2_hunt'->>'round_cap')::int) then bad := bad || to_jsonb('clock ' || (s->>'clock')); end if;
      exit when jsonb_array_length(bad) > 5;
    end loop;
    exit when jsonb_array_length(bad) > 5;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('ops', n, 'next', nf, 'ends', nb, 'chill_seen', nd, 'bad', bad)::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the simulator harness
const VALUE_KEYS = ['exposed', 'weakened', 'mark', 'empowered', 'focused', 'enraged'];
const BOONS_SIM = ['shielded', 'empowered', 'focused', 'quickened', 'enraged'];
function cardOrder(st) {
  const sq = st.squad.map(String);
  return Object.keys(st.cards).sort((a, b) => { const ia = sq.indexOf(a), ib = sq.indexOf(b); if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); return Number(a) - Number(b); });
}
function simBattle(cfg, st) {
  const ids = cardOrder(st);
  const cards = ids.map((id) => { const c = st.cards[id]; return { ...dummyCard(cfg, { role: c.role }), key: `c${id}`, role: c.role, cls: classOf(c.role), maxHp: c.max, hp: c.hp,
    acc: c.acc ?? 0, def: c.def ?? 0, resolve: c.resolve ?? 0, speedBase: c.speed ?? cfg.v2_speed.role_base[c.role], spdMult: 1 }; });
  const foes = st.enemies.map((e, i) => dummyFoe({ key: `e${i}`, maxHp: e.max, hp: e.hp, def: e.def ?? 0, resolve: e.resolve ?? 0, speedBase: e.speed, mech: e.mechanics || [], healer: !!e.healer }));
  const b = mini(cfg, cards, foes, { mode: st.mode, cap: 1e9 });
  b.step = st.clock;
  const units = [...ids.map((id) => ['card', id, st.cards[id]]), ...st.enemies.map((e, i) => ['enemy', String(i), e])];
  units.forEach(([side, id, src], k) => {
    const u = side === 'card' ? b.cards[k] : b.enemies[k - ids.length];
    u.down = !!src.down || src.hp <= 0; u.meter = src.meter ?? 0; u.st = {}; u.shield = 0;
    for (const [s, v] of Object.entries(src.status || {})) {
      if (s === 'shielded' || s === 'guarded') { u.shield = v.value; continue; }
      const o = {}; if (v.stacks !== undefined) o.stacks = v.stacks; if (v.until !== undefined) o.until = v.until;
      if (VALUE_KEYS.includes(s)) o.v = v.value; else if (s === 'slowed' || s === 'quickened') o.v = cfg.v2_status[s].x; else if (s !== 'poison' && s !== 'burn' && s !== 'chill') o.v = 1;
      u.st[s] = o;
    }
    if (src.immune?.control !== undefined) u.immUntil = src.immune.control + 1;
    for (const [s, n] of Object.entries(src.immune || {})) if (s !== 'control') u.immuneTo[s] = n + 1;
  });
  const unit = (ref) => (ref.side === 'card' ? b.cards[ids.indexOf(String(ref.id))] : b.enemies[Number(ref.id)]);
  const ref = (u) => (u.side === 'card' ? { side: 'card', id: Number(ids[b.cards.indexOf(u)]) } : { side: 'enemy', id: b.enemies.indexOf(u) });
  return { b, ids, unit, ref, lastEnd: st.ext?.step_end ?? null };
}
function simSum(H) {
  const { b, ids } = H; const clk = b.step;
  const one = (u) => {
    const status = {};
    for (const [s, v] of Object.entries(u.st)) {
      const o = {}; if (v.stacks !== undefined) o.stacks = v.stacks; if (VALUE_KEYS.includes(s)) o.value = v.v; if (v.until !== undefined) o.until = v.until;
      status[s] = o;
    }
    if (u.shield > 1e-9) status[u.side === 'card' ? 'shielded' : 'guarded'] = { value: u.shield };   // below 1e-9: the float rest of shield - absorbed x shield_x
    const immune = {};
    if (u.immUntil - 1 >= clk) immune.control = u.immUntil - 1;
    for (const [s, n] of Object.entries(u.immuneTo)) if (n - 1 >= clk) immune[s] = n - 1;
    return { hp: u.hp, down: !!u.down, status, immune };
  };
  return { clock: clk, cards: Object.fromEntries(ids.map((id, k) => [id, one(b.cards[k])])), enemies: b.enemies.map(one) };
}
// the SQL summary at its clock (an immunity that no longer counts is dropped, as the simulator has no record of it)
function sqlSum(u0) {
  const clk = u0.clock; const f = (u) => ({ hp: Number(u.hp), down: !!u.down, status: u.status, immune: Object.fromEntries(Object.entries(u.immune || {}).filter(([, n]) => n >= clk)) });
  return { clock: clk, cards: Object.fromEntries(Object.entries(u0.cards).map(([k, u]) => [k, f(u)])), enemies: u0.enemies.map(f) };
}
function sameSum(a, b, rel = 1e-9) {
  const bad = [];
  const num = (x, y, at) => { if (Math.abs(Number(x) - Number(y)) > rel * Math.max(1, Math.abs(Number(y)))) bad.push(`${at}: SQL ${x} sim ${y}`); };
  if (a.clock !== b.clock) bad.push(`clock ${a.clock} ${b.clock}`);
  const unit = (x, y, at) => {
    num(x.hp, y.hp, `${at}.hp`); if (x.down !== y.down) bad.push(`${at}.down SQL ${x.down} sim ${y.down}`);
    const ks = [...new Set([...Object.keys(x.status), ...Object.keys(y.status)])];
    for (const k of ks) {
      const p = x.status[k], q2 = y.status[k];
      if (!p || !q2) { bad.push(`${at}.status.${k}: SQL ${JSON.stringify(p)} sim ${JSON.stringify(q2)}`); continue; }
      for (const f of ['stacks', 'value', 'until']) { if ((p[f] === undefined) !== (q2[f] === undefined)) bad.push(`${at}.${k}.${f}: SQL ${p[f]} sim ${q2[f]}`); else if (p[f] !== undefined) num(p[f], q2[f], `${at}.${k}.${f}`); }
    }
    const ik = [...new Set([...Object.keys(x.immune), ...Object.keys(y.immune)])];
    for (const k of ik) if (x.immune[k] !== y.immune[k]) bad.push(`${at}.immune.${k}: SQL ${x.immune[k]} sim ${y.immune[k]}`);
  };
  for (const k of Object.keys(b.cards)) unit(a.cards[k], b.cards[k], `card ${k}`);
  b.enemies.forEach((e, i) => unit(a.enemies[i], e, `enemy ${i}`));
  return bad;
}
// one op in the simulator, with the op's draws as the one shared stream
function simOp(H, cfg, op) {
  const { b } = H; const qd = op.draws || op.o?.draws || []; let qi = 0;
  const take = () => { if (qi >= qd.length) throw new Error('simulator: out of draws'); return qd[qi++]; };
  for (const u of b.units) u.rng = take;
  const c0 = { ib: sumObj(b.S.immuneBlocked), rs: sumObj(b.S.resisted), cb: b.S.cureBlocked, bu: b.S.bursts, fr: b.S.freezes, cs: b.S.controlSkips, pf: b.S.paraFail, wk: b.S.wake };
  const out = {};
  switch (op.op) {
    case 'apply': {
      const t = H.unit(op.t), src = op.o?.src ? H.unit(op.o.src) : null;
      if (op.key === 'shielded' || op.key === 'guarded') { const was = t.down; b.addShield(t, op.o.value); out.applied = !was; if (was) out.reason = 'down'; break; }
      const ok = b.apply(src, t, op.key, { stacks: op.o?.stacks, value: op.o?.value, dur: op.o?.dur });
      out.applied = ok;
      if (!ok) out.reason = t.down ? 'down' : b.S.cureBlocked > c0.cb ? 'cure_immune' : sumObj(b.S.resisted) > c0.rs ? 'resisted' : sumObj(b.S.immuneBlocked) > c0.ib ? 'immune' : '?';
      out.burst = b.S.bursts > c0.bu; out.frozen = b.S.freezes > c0.fr;
      break;
    }
    case 'remove': b.remove(H.unit(op.t), op.key); break;
    case 'step_end': if (H.lastEnd === null || H.lastEnd < b.step) { b.endStep(); H.lastEnd = b.step; } break;
    case 'clock': b.step += op.n ?? 1; break;
    case 'turn': {
      const u = H.unit(op.t);
      const k0 = u.st.stunned ? 'stunned' : u.st.frozen ? 'frozen' : u.st.sleep ? 'sleep' : null;
      b.cardAct = () => {}; b.enemyAct = () => {};
      b.act(u);
      out.skip = b.S.controlSkips > c0.cs; out.reason = out.skip ? (k0 || (b.S.paraFail > c0.pf ? 'paralyzed' : '?')) : undefined;
      break;
    }
    case 'cure': { const t = H.unit(op.t); b.policy = { allyFor: () => t }; const n0 = b.S.cured; b.cure(null, { statuses: op.keys ?? ['all'], immune: op.immune || 0 }); out.cured = b.S.cured - n0; break; }
    case 'strip': {
      const t = H.unit(op.t); const keys = op.keys ?? [...BOONS_SIM, 'guarded'];
      for (const k of keys) { if (k === 'shielded' || k === 'guarded') t.shield = 0; else delete t.st[k]; }
      break;
    }
    case 'damage': out.dmg = b.damage(null, H.unit(op.t), op.amount, { tick: op.o?.tick, ignoreShield: op.o?.ignore_shield, pierce: op.o?.pierce, shieldX: op.o?.shield_x }); out.woke = b.S.wake > c0.wk; break;
    case 'heal': out.healed = b.heal(H.unit(op.t), op.amount); break;
    case 'confused': { const w = b.confusedRedirect(H.unit(op.t)); out.wrong = !!w; if (w) out.target = H.ref(w); break; }
    default: throw new Error(`simOp: ${op.op}`);
  }
  out.n = qi;
  return out;
}
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const sumObj = (o) => Object.values(o).reduce((s, x) => s + x, 0);

// ---------------------------------------------------------------------------------------------------------------- the grid of status sequences
const NEG_KEYS = ['poison', 'burn', 'stunned', 'chill', 'frozen', 'sleep', 'paralyzed', 'blinded', 'confused', 'slowed', 'exposed', 'weakened'];
const CARD_KEYS = [...NEG_KEYS, 'quickened', 'shielded', 'empowered', 'focused'];
const FOE_KEYS = [...NEG_KEYS, 'quickened', 'mark', 'enraged', 'guarded'];
const GRID_MECHS = ['toxic_born', 'fireborn', 'frostborn', 'unstoppable', 'thick_hide', 'dispeller'];
function gridSeqs(n, seed) {
  const rng = mkRng(seed); const pick = (a) => a[Math.floor(rng() * a.length)]; const chance = (p) => rng() < p;
  const out = [];
  for (let i = 0; i < n; i++) {
    const mode = chance(0.3) ? 'hunt' : 'dungeon';
    const nc = 1 + Math.floor(rng() * 3); const ids = []; while (ids.length < nc) { const id = 1 + Math.floor(rng() * 20); if (!ids.includes(id)) ids.push(id); }
    const cards = {};
    for (const id of ids) {
      const role = chance(0.25) ? 'controller' : chance(0.2) ? 'warden' : pick(ROLES); const max = pick([60, 100, 200, 400]);
      cards[id] = { role, class: classOf(role), max, hp: Math.round(max * (0.2 + 0.8 * rng())), acc: pick([0, 0, 0.04, 0.1]), def: pick([0, 0, 0.09, 0.3]), resolve: pick([0, 0, 0.1]) };
    }
    const ne = mode === 'hunt' ? 1 : 1 + Math.floor(rng() * 3);
    const enemies = Array.from({ length: ne }, () => { const max = mode === 'hunt' ? pick([5000, 20000]) : pick([150, 400, 1000]);
      return { max, hp: Math.round(max * (0.2 + 0.8 * rng())), speed: 50, def: pick([0, 0.05, 0.2]), resolve: pick([0, 0, 0.1, 0.2]), mechanics: GRID_MECHS.filter(() => chance(0.1)), healer: chance(0.2) }; });
    const clock = Math.floor(rng() * 5);
    const sq = ids.slice().sort(() => rng() - 0.5).slice(0, Math.max(1, nc - (chance(0.3) ? 1 : 0)));
    const st = state({ mode, clock, squad: sq, cards, enemies });
    const refs = [...ids.map((id) => Cr(id)), ...enemies.map((_, k) => En(k))];
    const ops = []; const steps = 4 + Math.floor(rng() * 5);
    const d3 = () => [rng(), rng(), rng()].map((x) => Math.floor(x * 1e6) / 1e6);
    for (let s = 0; s < steps; s++) {
      const k = 2 + Math.floor(rng() * 6);
      for (let j = 0; j < k; j++) {
        const t = pick(refs); const r = rng();
        if (r < 0.55) {
          const key = pick(t.side === 'card' ? [...CARD_KEYS, 'chill', 'chill', 'confused'] : [...FOE_KEYS, 'chill', 'chill', 'confused']);
          const o = { draws: d3() };
          const sr = rng(); if (sr < 0.45) o.src = Cr(pick(ids)); else if (sr < 0.8) o.src = En(Math.floor(rng() * ne));
          if (['poison', 'burn', 'chill'].includes(key)) o.stacks = pick([1, 1, 2, 3]);
          if (key === 'exposed') o.value = pick([0.1, 0.15, 0.3, 0.5]);
          if (key === 'weakened') o.value = pick([0.1, 0.2, 0.3]);
          if (key === 'mark') o.value = pick([0.1, 0.3, 0.5]);
          if (key === 'empowered') o.value = pick([0.15, 0.3, 0.6, 1.5, 2]);
          if (key === 'focused') o.value = pick([0.05, 0.1]);
          if (key === 'enraged') o.value = pick([1.25, 1.4]);
          if (key === 'shielded' || key === 'guarded') o.value = pick([5, 30, 100, 400]);
          if (['blinded', 'confused', 'enraged', 'focused'].includes(key) && chance(0.4)) o.dur = pick([1, 2, 5]);
          ops.push(apply(t, key, o));
        } else if (r < 0.65) { const o = {}; if (chance(0.5)) { o.tick = true; o.ignore_shield = chance(0.8); } if (chance(0.15)) o.pierce = pick([0.3, 1]); if (chance(0.15)) o.shield_x = pick([1.5, 2]); ops.push({ op: 'damage', t, amount: pick([1, 5, 20, 60, 200]), o }); }
        else if (r < 0.71) ops.push({ op: 'heal', t, amount: pick([5, 30, 200]) });
        else if (r < 0.81) ops.push({ op: 'turn', t, draws: d3() });
        else if (r < 0.86) ops.push({ op: 'cure', t, keys: chance(0.5) ? null : NEG_KEYS.filter(() => chance(0.25)), immune: pick([0, 3, 5, 8]) });
        else if (r < 0.90) ops.push({ op: 'strip', t, keys: chance(0.5) ? null : (t.side === 'card' ? ['shielded', 'empowered', 'focused', 'quickened'] : ['guarded', 'enraged', 'quickened']).filter(() => chance(0.5)) });
        else if (r < 0.94) ops.push({ op: 'remove', t, key: pick(NEG_KEYS.concat(['quickened'])) });
        else ops.push({ op: 'confused', t, draws: d3() });
      }
      ops.push({ op: 'step_end' }); if (chance(0.1)) ops.push({ op: 'step_end' });
      ops.push({ op: 'clock', n: 1 });
    }
    out.push([st, ops]);
  }
  return out;
}
const sqlReason = (r) => (r === 'control_immune' ? 'immune' : r);

// ---------------------------------------------------------------------------------------------------------------- the fights: combat_v2_next vs Battle.tickStep
function fightSpecs(n, seed, B) {
  const rng = mkRng(seed); const pick = (a) => a[Math.floor(rng() * a.length)]; const chance = (p) => rng() < p;
  const out = [];
  const st0 = () => { const s = {}; if (chance(0.25)) s.poison = { stacks: pick([1, 2]), until: pick([2, 4, 8]) }; if (chance(0.2)) s.burn = { stacks: pick([1, 3]) };
    if (chance(0.2)) s.slowed = { until: pick([2, 5]) }; if (chance(0.15)) s.quickened = { until: pick([3, 6]) }; if (chance(0.15)) s.chill = { stacks: pick([1, 2]), until: pick([2, 5]) };
    if (chance(0.1)) s.sleep = { until: pick([2, 6]) }; else if (chance(0.1)) s.paralyzed = { until: pick([3, 6]) }; else if (chance(0.08)) s.stunned = { until: 9 }; return s; };
  for (let i = 0; i < n; i++) {
    const mode = chance(0.3) ? 'hunt' : 'dungeon';
    const nc = 2 + Math.floor(rng() * 3); const cards = {}; const ids = [];
    while (ids.length < nc) { const id = 1 + Math.floor(rng() * 30); if (!ids.includes(id)) ids.push(id); }
    for (const id of ids) { const role = pick(ROLES); const max = pick([80, 150, 300]);
      cards[id] = { role, class: classOf(role), speed: B.v2_speed.role_base[role], meter: Math.floor(rng() * 9999) / 100, max, hp: Math.round(max * (0.5 + 0.5 * rng())), acc: pick([0, 0.04]), def: pick([0, 0.09]), status: st0() }; }
    const enemies = mode === 'hunt' ? [{ speed: pick([100, 110]), meter: Math.floor(rng() * 9999) / 100, max: 30000, hp: 30000, resolve: pick([0, 0.1, 0.2]), status: st0() }]
      : Array.from({ length: 1 + Math.floor(rng() * 3) }, () => ({ speed: pick([45, 48, 50, 55]), meter: Math.floor(rng() * 9999) / 100, max: pick([200, 600, 1500]), hp: pick([200, 600]), resolve: pick([0, 0.1]), healer: chance(0.2), status: st0() }));
    const st = state({ mode, clock: 0, squad: ids, cards, enemies });
    const script = Array.from({ length: 160 }, () => {
      const r = rng(); const draws = [rng(), rng(), rng(), rng()].map((x) => Math.floor(x * 1e6) / 1e6);
      const keyc = pick(CARD_KEYS), keye = pick(FOE_KEYS);
      const opt = (key) => { const o = {}; if (['poison', 'burn', 'chill'].includes(key)) o.stacks = pick([1, 2]);
        if (['exposed', 'weakened', 'mark', 'empowered', 'focused'].includes(key)) o.value = pick([0.1, 0.3]); if (key === 'enraged') o.value = 1.4; if (key === 'shielded' || key === 'guarded') o.value = pick([20, 80]); return o; };
      return { draws, kind: r < 0.55 ? 'apply' : r < 0.8 ? 'damage' : 'none', side: chance(0.75) ? 'other' : 'own', pick: rng(), keyc, keye, oc: opt(keyc), oe: opt(keye), amount: pick([5, 20, 60]) };
    });
    out.push([st, script]);
  }
  return out;
}
const FIGHT_DRIVER = String.raw`
  create or replace function pg_temp.e5fight(p_s jsonb, p_script jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; r jsonb; a jsonb; act jsonb; k int := 0; out jsonb := '[]'; tside text; units text[]; tref jsonb; key text; o jsonb; dr jsonb; nused int;
  begin
    loop
      exit when k >= jsonb_array_length(p_script);
      act := p_script->k;
      r := combat_v2_next(s, act->'draws', p_b); s := r->'state';
      if r->>'event' <> 'act' then out := out || jsonb_build_array(jsonb_build_object('event', r->'event', 'u', pg_temp.e5sum(s))); exit; end if;
      nused := jsonb_array_length(r->'draws');
      if not (r->>'skip')::boolean and act->>'kind' <> 'none' then
        tside := case when act->>'side' = 'own' then r->'actor'->>'side' when r->'actor'->>'side' = 'card' then 'enemy' else 'card' end;
        select array_agg(x.id order by x.n) into units from combat_v2_units(s) x where x.side = tside;
        tref := jsonb_build_object('side', tside, 'id', units[floor((act->>'pick')::numeric * cardinality(units))::int + 1]::numeric);
        if act->>'kind' = 'apply' then
          key := case when tside = 'card' then act->>'keyc' else act->>'keye' end; o := case when tside = 'card' then act->'oc' else act->'oe' end;
          dr := coalesce((select jsonb_agg(x.v order by x.o) from jsonb_array_elements(act->'draws') with ordinality x(v, o) where x.o > nused), '[]'::jsonb);
          a := combat_v2_status_apply(s, tref, key, o || jsonb_build_object('src', r->'actor', 'draws', dr), p_b);
          nused := nused + jsonb_array_length(a->'draws');
        else
          a := combat_v2_damage(s, tref, (act->>'amount')::numeric, null, p_b);
        end if;
        s := a->'state';
      end if;
      out := out || jsonb_build_array(jsonb_build_object('event', 'act', 'actor', r->'actor', 'skip', r->'skip', 'reason', r->'reason', 'n', nused, 'u', pg_temp.e5sum(s)));
      k := k + 1;
    end loop;
    if k >= jsonb_array_length(p_script) then
      r := combat_v2_next(s, null, p_b);
      if r->>'event' <> 'act' then out := out || jsonb_build_array(jsonb_build_object('event', r->'event', 'u', pg_temp.e5sum(r->'state'))); end if;
    end if;
    return out;
  end $x$;`;
function simFight(cfg, st, script) {
  const H = simBattle(cfg, st); const { b } = H;
  b.cap = st.mode === 'hunt' ? cfg.v2_hunt.round_cap : cfg.v2_dungeon.round_cap;
  const out = []; let k = 0; let cur = null; let qd = [], qi = 0; let nearTie = false;
  const take = () => { if (qi >= qd.length) throw new Error('simulator: out of draws'); return qd[qi++]; };
  for (const u of b.units) u.rng = take;
  const STOP = new Error('stop');
  const scripted = (u) => {
    const ent = cur; if (ent.kind === 'none') return;
    const tside = ent.side === 'own' ? u.side : (u.side === 'card' ? 'enemy' : 'card');
    const list = tside === 'card' ? b.cards : b.enemies;
    const t = list[Math.floor(ent.pick * list.length)];
    if (ent.kind === 'apply') { const key = tside === 'card' ? ent.keyc : ent.keye; const o = tside === 'card' ? ent.oc : ent.oe;
      if (key === 'shielded' || key === 'guarded') b.addShield(t, o.value); else b.apply(u, t, key, { ...o }); }
    else b.damage(u, t, ent.amount);
  };
  b.cardAct = scripted; b.enemyAct = scripted;
  // a meter that lands within 1e-6 of a multiple of act_at after the fill: a float near-tie (the simulator adds floats, SQL is exact)
  b.speedOf = function (u) { const sp = Battle.prototype.speedOf.call(this, u); const m = u.meter + sp; if (!u.down && m >= 50 && Math.abs(m - 100 * Math.round(m / 100)) < 1e-6) nearTie = true; return sp; };
  const act0 = Battle.prototype.act;
  b.act = function (u) {
    if (k >= script.length) throw STOP;
    // a float near-tie at this pick: a meter within 1e-6 of act_at, or two standing meters at or above act_at within 1e-6
    const ms = this.units.filter((x) => !x.down).map((x) => x.meter + (x === u ? 100 : 0));
    const top = ms.filter((m) => m >= 100 - 1e-6).sort((a, c) => c - a);
    if (ms.some((m) => Math.abs(m - 100) < 1e-6) || (top.length > 1 && top[0] - top[1] < 1e-6)) nearTie = true;
    cur = script[k]; qd = cur.draws; qi = 0;
    const cs0 = this.S.controlSkips, pf0 = this.S.paraFail; const k0 = u.st.stunned ? 'stunned' : u.st.frozen ? 'frozen' : u.st.sleep ? 'sleep' : null;
    act0.call(this, u);
    const skip = this.S.controlSkips > cs0;
    out.push({ event: 'act', actor: H.ref(u), skip, reason: skip ? (k0 || (this.S.paraFail > pf0 ? 'paralyzed' : '?')) : null, n: qi, u: simSum(H), nearTie });
    k++;
  };
  try { while (!b.ended) b.tickStep(); } catch (e) { if (e !== STOP) throw e; }
  if (b.ended) out.push({ event: b.ended === 'cap' ? 'cap' : 'end', u: simSum(H), nearTie });
  return out;
}

const near = (a, b, rel = 1e-9) => Math.abs(Number(a) - b) <= rel * Math.max(1, Math.abs(b));
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  // 1. no change in play, the numbers, rights
  const results = JSON.parse(await runBlock(body1));
  const B = results.find((r) => r.case === 'NUMBERS').b;
  for (const r of results.filter((x) => x.case !== 'NUMBERS')) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); }
  const cfg = patch(loadConfig(), B);

  // 2. the fixed cases and the refusals
  const FIX = fixedCases(B);
  const rows = await runOps([...FIX.map((f) => [state(f[1]), f[2], f[4] || null]), ...BAD.map((x) => [x[1] ? state(x[1]) : { v: 1 }, [x[2]], null])]);
  FIX.forEach(([name, , , check], i) => {
    const r = rows[i]; const err = r.find((x) => x.error && !/does not apply|has no value|not a boost|not a negative status/.test(x.error));
    let res; try { res = err ? `error ${err.error}` : check(r, B); } catch (e) { res = `check raised: ${e.message} ${JSON.stringify(r).slice(0, 300)}`; }
    say(res === true, `fixed: ${name}`, String(res).slice(0, 900));
  });
  const ref = rows.slice(FIX.length).map((r, i) => (!r[0].error ? `accepted: ${BAD[i][0]}` : !r[0].error.includes(BAD[i][3]) ? `refused for another reason: ${BAD[i][0]}: ${r[0].error}` : null)).filter(Boolean);
  say(ref.length === 0, `${BAD.length} bad inputs refused, each with its own message (${BAD.map((x) => x[0]).join(', ')})`, ref.join(' | '));

  // 3. and 4. the rates, the no-lock bound, the draws
  const s = JSON.parse(await runBlock(statBlock(B)));
  say(Math.abs(s.paralyzed - B.v2_status.paralyzed.fail) <= 0.06, `paralyzed.fail (sim): each action fails ${B.v2_status.paralyzed.fail} (${s.paralyzed.toFixed(3)} of ${N})`);
  say(Math.abs(s.unstoppable - (1 - B.v2_enemy.mechanics.unstoppable.control_fail)) <= 0.02, `unstoppable (sim): control lands ${(1 - B.v2_enemy.mechanics.unstoppable.control_fail).toFixed(2)} (${s.unstoppable.toFixed(3)})`);
  say(Math.abs(s.resolve - 0.8) <= 0.025, `resolve (sim): resolve 20% - a debuff lands 80% (${s.resolve.toFixed(3)})`);
  say(Math.abs(s.confused - B.v2_status.confused.chance) <= 0.025, `confused (sim): ${B.v2_status.confused.chance} of single attacks hit the wrong target (${s.confused.toFixed(3)})`);
  const bound = 1 / (1 + B.v2_control.boss_immune);
  for (const [k, lim, what] of [['nolock_hunt_enemy_100', bound + 0.02, 'the Hunt boss (speed 100)'], ['nolock_hunt_enemy_110', bound + 0.02, 'the Mythic Hunt boss (speed 110)'],
    ['nolock_dungeon_enemy_100', 0.7, 'a foe'], ['nolock_dungeon_card_100', 0.7, 'a card']]) {
    const v = s[k]; const share = v.skips / v.turns;
    say(v.turns >= 30 && share <= lim, `control.nolock (sim): all 4 controls before every action on ${what}: skipped ${v.skips} of ${v.turns} turns = ${share.toFixed(3)} <= ${lim.toFixed(3)} (to step ${v.clock})`, JSON.stringify(v));
  }
  say(s.replay.same && s.replay.slots && s.replay.next && s.replay.k === 2 && s.replay_confused, `draws: a replay gives the same answer; with setseed the slots [resolve, Unstoppable of Frozen] take the stream in order, and the next random() follows (${JSON.stringify(s.replay)})`);

  // 5. the grid vs the simulator
  const G = gridSeqs(Number(process.env.V2_GRID || 600), 4711);
  const CH = 100; let nops = 0, nseq = 0; const bad = {}; const first = []; const cov = { applied: 0, resisted: 0, immune: 0, cure_immune: 0, down: 0, burst: 0, frozen: 0, skip: 0, wake: 0, wrong: 0, cured: 0, tick: 0, ended: 0 };
  for (let i = 0; i < G.length; i += CH) {
    const part = G.slice(i, i + CH);
    const out = await runOps(part.map(([st, ops]) => [st, ops, null]));
    out.forEach((res, j) => {
      nseq++;
      const [st, ops] = part[j]; const H = simBattle(cfg, st);
      for (let k = 0; k < ops.length; k++) {
        nops++; const op = ops[k]; const r = res[k]; let w;
        const rec = (what, msg) => { bad[what] = (bad[what] || 0) + 1; if (first.length < 6) first.push(`seq ${i + j} op ${k} ${JSON.stringify(op).slice(0, 200)}: ${msg}`); };
        try { w = simOp(H, cfg, op); } catch (e) { rec('sim_error', e.message); break; }
        if (r.error) { rec('sql_error', r.error); break; }
        const diff = sameSum(sqlSum(r.u), simSum(H));
        if (diff.length) { rec('state', diff.slice(0, 4).join('; ')); break; }
        const nd = (r.draws || []).length;
        if (nd !== w.n) rec('draws', `SQL ${nd} sim ${w.n}`);
        if (op.op === 'apply') {
          if (!!r.applied !== !!w.applied || (!r.applied && sqlReason(r.reason) !== w.reason)) rec('apply', `SQL ${r.applied} ${r.reason} sim ${w.applied} ${w.reason}`);
          if ((r.burst !== undefined) !== !!w.burst) rec('burst', `SQL ${r.burst} sim ${w.burst}`);
          if (!!r.frozen !== !!w.frozen && !(op.key === 'frozen')) rec('frozen', `SQL ${r.frozen} sim ${w.frozen}`);
          if (r.applied) cov.applied++; else cov[r.reason === 'control_immune' ? 'immune' : r.reason]++;
          if (r.burst !== undefined) cov.burst++; if (r.frozen) cov.frozen++;
        }
        if (op.op === 'turn') { if (!!r.skip !== !!w.skip || (r.skip && r.reason !== w.reason)) rec('turn', `SQL ${r.skip} ${r.reason} sim ${w.skip} ${w.reason}`); if (r.skip) cov.skip++; }
        if (op.op === 'damage') { if (!near(r.dmg, w.dmg)) rec('damage', `SQL ${r.dmg} sim ${w.dmg}`); if (!!r.woke !== !!w.woke) rec('wake', `SQL ${r.woke} sim ${w.woke}`); if (r.woke) cov.wake++; }
        if (op.op === 'heal' && !near(r.healed, w.healed)) rec('heal', `SQL ${r.healed} sim ${w.healed}`);
        if (op.op === 'cure') { if (r.cured !== w.cured) rec('cure', `SQL ${r.cured} sim ${w.cured}`); if (r.cured) cov.cured++; }
        if (op.op === 'confused') { if (!!r.wrong !== w.wrong || (r.wrong && JSON.stringify(canon(r.target)) !== JSON.stringify(canon(w.target)))) rec('confused', `SQL ${JSON.stringify(r)} sim ${JSON.stringify(w)}`); if (r.wrong) cov.wrong++; }
        if (op.op === 'step_end') { cov.tick += (r.ticks || []).length; cov.ended += (r.ended || []).length; }
      }
    });
  }
  say(Object.keys(bad).length === 0 && nseq === G.length, `SQL = the simulator on ${nseq} random status sequences (${nops} ops: apply, remove, damage, heal, turn start, cure, strip, Confused, step end, clock) with the same draws: the unit states after every op, the answers and the draw counts are equal (numbers within a relative 1e-9)`,
    `${JSON.stringify(bad)} ${first.join(' | ')}`);
  say(Object.values(cov).every((v) => v >= 20), `the grid reaches every outcome (each at least 20 times): ${JSON.stringify(cov)}`, JSON.stringify(cov));

  // 6. the fights: combat_v2_next vs Battle.tickStep
  const FS = fightSpecs(Number(process.env.V2_FIGHTS || 120), 977, B);
  let fsame = 0, ftie = 0, facts = 0; const fbad = []; const fev = { end: 0, cap: 0, skip: 0 };
  for (let i = 0; i < FS.length; i += 20) {
    const part = FS.slice(i, i + 20);
    const out = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
      ${SETUP}
      execute $m$${mig}$m$;
      ${DRIVER}
      ${FIGHT_DRIVER}
      b := combat_v2_status_numbers();
      for x in select v from jsonb_array_elements(${sqlLit(part)}::jsonb) v loop out := out || jsonb_build_array(pg_temp.e5fight(x->0, x->1, b)); end loop;
      raise exception 'RESULT:%', out::text; end $t$;`));
    out.forEach((sq, j) => {
      const [st, script] = part[j]; const sim = simFight(cfg, st, script);
      let diff = null;
      for (let k = 0; k < Math.max(sq.length, sim.length); k++) {
        const a = sq[k], w = sim[k];
        if (!a || !w) { diff = { k, msg: `length SQL ${sq.length} sim ${sim.length}`, tie: (sim[Math.min(k, sim.length - 1)] || {}).nearTie }; break; }
        const m = [];
        if (a.event !== w.event) m.push(`event SQL ${a.event} sim ${w.event}`);
        if (a.event === 'act') {
          if (JSON.stringify(canon(a.actor)) !== JSON.stringify(canon(w.actor))) m.push(`actor SQL ${JSON.stringify(a.actor)} sim ${JSON.stringify(w.actor)}`);
          if (!!a.skip !== !!w.skip || (a.skip && a.reason !== w.reason)) m.push(`skip SQL ${a.skip} ${a.reason} sim ${w.skip} ${w.reason}`);
          if (a.n !== w.n) m.push(`draws SQL ${a.n} sim ${w.n}`);
        }
        m.push(...sameSum(sqlSum(a.u), w.u));
        if (m.length) { diff = { k, msg: m.slice(0, 3).join('; '), tie: w.nearTie }; break; }
        if (a.event === 'act') { facts++; if (a.skip) fev.skip++; }
        else fev[a.event] = (fev[a.event] || 0) + 1;
      }
      if (!diff) fsame++; else if (diff.tie) ftie++; else if (fbad.length < 5) fbad.push(`fight ${i + j} action ${diff.k}: ${diff.msg}`); else fbad.push('');
    });
  }
  say(fsame + ftie === FS.length && fbad.length === 0, `SQL = the simulator on ${FS.length} random fights (combat_v2_next with the step end between the steps vs Battle.tickStep, scripted status actions, the same draws): ${fsame} equal action by action (${facts} actions, ${fev.skip} skips, ${fev.end} end, ${fev.cap} cap), ${ftie} differ only after a float near-tie of the simulator`,
    fbad.filter(Boolean).join(' | '));
  say(ftie <= Math.ceil(FS.length * 0.05), `the float near-ties are rare (${ftie} of ${FS.length} fights, at most 5%)`);
  say(fev.end >= 5 && fev.cap >= 5 && fev.skip >= 20, `the fights reach the end, the cap and the skips (${JSON.stringify(fev)})`);

  // 7. the fuzz
  const fz = JSON.parse(await runBlock(fuzzBlock(B, Number(process.env.V2_FUZZ || 40), 80)));
  say(fz.bad.length === 0 && fz.ops > 2000 && fz.next > 300, `fuzz: ${fz.ops} random ops (${fz.next} clock calls, ${fz.ends} ends) with random(): the state passes fight_state_check_v2, HP in [0, max], a down unit has no status, stacks and values under their caps, one control at most`,
    JSON.stringify(fz).slice(0, 900));
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 1500)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
