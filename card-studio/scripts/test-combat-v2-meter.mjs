import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_turn_meter.sql (combat v2 phase 2, PR E2: the turn meter, plan section 3). NO lasting change: every
 * request is one DO block, undone by its final RAISE. combat_v2_flags_balance.sql, combat_v2_statuses_roles.sql and this file run inside each block
 * (all idempotent), so the test passes before and after they are applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-meter.mjs     must PASS
 *   MUTATE=<name> ...                                                                         must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                            the baseline (must PASS), then every mutation, one line each
 * The reference is the simulator card-studio/v2sim (engine.mjs: tickStep and speedOf; checks.mjs: meterChecks), with the numbers of the database
 * (the balance values replace the config.json values, so the test still holds after a Lab change of the numbers).
 * Invariants:
 *   1. The simulator meter checks, ported: an enemy of speed 100, 50, 200, 17 and 140 acts speed x 60 / 100 times in 60 steps (the simulator
 *      tolerance is 1; with meters that start at 0 the count is exact); two cards of speed 17 and 40 act in the ratio 40 / 17; Slowed, Quickened and
 *      Chill 2 for 100 steps give 100 x slowed.x, 100 x quickened.x and 100 x (1 - 2 x chill.spd) actions; the safety cap and the floor.
 *   2. The same answers as the simulator ENGINE on 60 seeded random fights (2 to 8 cards of every role with Speed points, 1 to 5 enemies, random start
 *      meters, Slowed / Quickened / Chill with an end step, down units, Hunt and Dungeon caps, a start clock above 0): the whole actor sequence with the
 *      step of each action is equal, and every state after every call passes fight_state_check_v2.
 *   3. The rules that the simulator does not show alone: the tie order (higher meter, then squad order (not the card id), then the other cards, then
 *      the enemies), the per-unit limit of max_actions_per_step actions in one step (and the acts key; the simulator has the same limit), down units do not fill and do not act, the
 *      step cap of each mode (Hunt v2_hunt.round_cap; Dungeon and Gauntlet v2_dungeon.round_cap), "none" with no standing unit, a status that ends
 *      in its "until" step, the turn-order strip = the advance sequence, and the refusals (a v1 state, a unit with no role and no speed, bad points).
 *   4. Pure and server only: combat_v2_speed and combat_v2_advance(state, numbers) are IMMUTABLE, the 1-argument forms STABLE, anon and authenticated
 *      cannot run them, and every function has a comment.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { POLICIES } from '../v2sim/policy.mjs';
import { loadConfig, patch, mkRng } from '../v2sim/util.mjs';
import { ROLES } from '../v2sim/cards.mjs';
assertLocal('test-combat-v2-meter.mjs');

const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const V1 = read('combat_v2_flags_balance.sql');
const E1 = read('combat_v2_statuses_roles.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('combat_v2_turn_meter.sql');

const MUT = {
  tie_later_wins: ['(best is null or u_meter[i] > u_meter[best])', '(best is null or u_meter[i] >= u_meter[best])'],
  act_above_only: ['if u_up[i] and u_meter[i] >= act_at and', 'if u_up[i] and u_meter[i] > act_at and'],
  meter_reset: ['u_meter[best] := u_meter[best] - act_at;', 'u_meter[best] := 0;'],
  fill_twice: ['u_meter[i] := u_meter[i] + combat_v2_speed(u_json[i], clk, p_b);', 'u_meter[i] := u_meter[i] + 2 * combat_v2_speed(u_json[i], clk, p_b);'],
  slowed_off: ["  if s is not null and coalesce((s->>'until')::int >= p_clock, true) then m := m * (ss->'slowed'->>'x')::numeric; end if;\n", ''],
  quickened_off: ["  if s is not null and coalesce((s->>'until')::int >= p_clock, true) then m := m * (ss->'quickened'->>'x')::numeric; end if;\n", ''],
  chill_one_stack: ["(1 - (ss->'chill'->>'spd')::numeric * coalesce((s->>'stacks')::numeric, 1))", "(1 - (ss->'chill'->>'spd')::numeric)"],
  until_edge: ["if s is not null and coalesce((s->>'until')::int >= p_clock, true) then m := m * (ss->'slowed'->>'x')::numeric;",
               "if s is not null and coalesce((s->>'until')::int > p_clock, true) then m := m * (ss->'slowed'->>'x')::numeric;"],
  no_safety_cap: ["return base * least((sp->>'safety_max_x')::numeric, greatest((sp->>'status_min_x')::numeric, x * m));",
                  "return base * greatest((sp->>'status_min_x')::numeric, x * m);"],
  no_floor: ["return base * least((sp->>'safety_max_x')::numeric, greatest((sp->>'status_min_x')::numeric, x * m));",
             "return base * least((sp->>'safety_max_x')::numeric, x * m);"],
  spd_uncapped: ["least(coalesce((p_unit->>'spd')::numeric, 0), (p_b->'v2_stats'->>'max_per_stat')::numeric)", "coalesce((p_unit->>'spd')::numeric, 0)"],
  spd_pct_off: ["x := 1 + (p_b->'v2_stats'->'spd'->>'pct')::numeric * pts;", 'x := 1;'],
  role_speed_ignored: ["else base := (sp->'role_base'->>(p_unit->>'role'))::numeric;", "else base := (sp->'role_base'->>'warden')::numeric;"],
  no_max_actions: ['and u_acts[i] < max_a and', 'and'],
  acts_no_reset: ['      u_acts[i] := 0;\n', ''],
  down_fills: ['if u_up[i] then u_meter[i] := u_meter[i] + combat_v2_speed', 'if true then u_meter[i] := u_meter[i] + combat_v2_speed'],
  down_acts: ['if u_up[i] and u_meter[i] >= act_at', 'if u_meter[i] >= act_at'],
  squad_order_off: ['order by min(q.o) nulls last, c.key::numeric', 'order by c.key::numeric'],
  enemies_first: ["for r in select 'enemy' as side, (x.o - 1)::text as k, x.v from jsonb_array_elements(coalesce(p->'enemies', '[]'::jsonb)) with ordinality x(v, o) order by x.o loop",
                  "for r in select 'enemy' as side, (x.o - 1)::text as k, x.v from jsonb_array_elements(coalesce(p->'enemies', '[]'::jsonb)) with ordinality x(v, o) order by x.o desc loop"],
  hunt_cap_dungeon: ["when p->>'mode' = 'hunt' then (p_b->'v2_hunt'->>'round_cap')::int", "when p->>'mode' = 'hunt' then (p_b->'v2_dungeon'->>'round_cap')::int"],
  cap_one_more: ['if clk >= cap then ev :=', 'if clk > cap then ev :='],
  order_skips_first: ["    s := a->'state';\n    out := out || jsonb_build_array(", "    s := combat_v2_advance(a->'state', b)->'state';\n    out := out || jsonb_build_array("],
  volatile: ['returns jsonb language plpgsql immutable set search_path = public as $fn$\ndeclare\n  act_at', 'returns jsonb language plpgsql volatile set search_path = public as $fn$\ndeclare\n  act_at'],
  grant_anon: ["    execute format('grant execute on function public.%s to service_role', f);", "    execute format('grant execute on function public.%s to service_role, anon', f);"],
  comment_missing: [/comment on function public\.combat_v2_turn_order\(jsonb, integer\) is \$cm\$[^\n]*\n/, ''],
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
for (const t of [V1, E1, mig]) if (['$m$', '$t$', '$q$'].some((x) => t.includes(x))) throw new Error('the migrations must not contain $m$, $t$ or $q$');

// ---------------------------------------------------------------------------------------------------------------- the scenarios
// A scenario: { id, mode, cap, clock, squad, cards: {id: {role | speed, spd, meter, down, status}}, enemies: [{speed, meter, down, status}] }
const state = (sc) => ({
  v: 2, mode: sc.mode, round: sc.clock || 0, clock: sc.clock || 0, squad: sc.squad,
  cards: Object.fromEntries(Object.entries(sc.cards).map(([id, c]) => [id, { hp: c.down ? 0 : 10, max: 10, down: !!c.down, meter: c.meter || 0, charge: 0, status: c.status || {},
    ...(c.role ? { role: c.role } : {}), ...(c.speed !== undefined ? { speed: c.speed } : {}), ...(c.spd !== undefined ? { spd: c.spd } : {}) }])),
  enemies: sc.enemies.map((e) => ({ hp: e.down ? 0 : 1000, max: 1000, meter: e.meter || 0, charge: 0, status: e.status || {}, speed: e.speed })),
  marks: {}, facts: { passives: [], cards: {} }, ext: {} });
const one = (speed, o = {}) => ({ mode: 'dungeon', squad: [1], cards: { 1: { speed: 1 } }, enemies: [{ speed, ...o }] });

// The simulator engine as the reference: the same units, the same start meters and statuses; an action only records who acted and in which step.
function simSeq(cfg0, sc) {
  const cfg = patch(cfg0, { v2_hunt: { round_cap: sc.cap }, v2_dungeon: { round_cap: sc.cap } });
  const S = cfg.v2_status;
  const st = (s = {}) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'chill' ? { stacks: v.stacks ?? 1, until: v.until } : { v: S[k].x, until: v.until }]));
  const unit = (u, isCard) => ({ key: 'u', hp: u.down ? 0 : (isCard ? 10 : 1000), maxHp: isCard ? 10 : 1000, role: u.role,
    speedBase: u.speed ?? cfg.v2_speed.role_base[u.role], spdMult: 1 + cfg.v2_stats.spd.pct * Math.min(u.spd || 0, cfg.v2_stats.max_per_stat) });
  const b = new Battle(cfg, { cards: sc.squad.map((id) => unit(sc.cards[id], true)), enemies: sc.enemies.map((e) => unit(e, false)), mode: sc.mode === 'hunt' ? 'hunt' : 'dungeon',
    policy: POLICIES.auto, seed: 1, cap: sc.cap });
  b.step = sc.clock || 0;
  b.cards.forEach((u, i) => { u.meter = sc.cards[sc.squad[i]].meter || 0; u.st = st(sc.cards[sc.squad[i]].status); });
  b.enemies.forEach((u, i) => { u.meter = sc.enemies[i].meter || 0; u.st = st(sc.enemies[i].status); });
  const seq = [];
  b.act = (u) => { u.turn++; seq.push(`${u.side}:${u.side === 'card' ? sc.squad[u.idx] : u.idx}@${b.step}`); };
  if (b.step >= sc.cap) return seq;
  while (!b.ended) b.tickStep();
  return seq;
}

// The simulator step loop (engine.mjs tickStep and speedOf) with EXACT decimal numbers (BigInt), the same as SQL numeric. The simulator uses float
// numbers: a speed like 24 x 1.6 is 38.400000000000006 there, so two meters that are equal in exact numbers can differ by 1e-14 and break a tie the
// other way. The exact replay shows where that happens; SQL must equal it in every fight, and the float simulator in every other fight.
const D = (v) => { const t = String(v); if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error(`not a plain decimal: ${t}`); const [i, fr = ''] = t.split('.'); return { n: BigInt(i + fr), s: fr.length }; };
const up = (a, sc) => a.n * 10n ** BigInt(sc - a.s);
const dAdd = (a, b) => { const sc = Math.max(a.s, b.s); return { n: up(a, sc) + up(b, sc), s: sc }; };
const dMul = (a, b) => ({ n: a.n * b.n, s: a.s + b.s });
const dCmp = (a, b) => { const sc = Math.max(a.s, b.s); const x = up(a, sc), y = up(b, sc); return x < y ? -1 : x > y ? 1 : 0; };
const dNeg = (a) => ({ n: -a.n, s: a.s });
function exactSeq(cfg, sc) {
  const V = cfg.v2_speed, P = cfg.v2_stats, S = cfg.v2_status, act = D(V.act_at);
  const mk = (u, side, id) => ({ side, id, down: !!u.down, st: u.status || {}, meter: D(u.meter || 0), base: D(u.speed ?? V.role_base[u.role]), acts: 0,
    x: dAdd(D(1), dMul(D(P.spd.pct), D(Math.min(u.spd || 0, P.max_per_stat)))) });
  const units = [...sc.squad.map((id) => mk(sc.cards[id], 'card', id)), ...sc.enemies.map((e, i) => mk(e, 'enemy', i))];
  const seq = []; let step = sc.clock || 0;
  while (step < sc.cap) {
    step++;
    for (const u of units) {
      u.acts = 0;
      if (u.down) continue;
      const on = (k) => u.st[k] && (u.st[k].until === undefined || u.st[k].until >= step);
      let m = D(1);
      if (on('slowed')) m = dMul(m, D(S.slowed.x));
      if (on('quickened')) m = dMul(m, D(S.quickened.x));
      if (on('chill')) m = dMul(m, dAdd(D(1), dNeg(dMul(D(S.chill.spd), D(u.st.chill.stacks ?? 1)))));
      let k = dMul(u.x, m); if (dCmp(k, D(V.status_min_x)) < 0) k = D(V.status_min_x); if (dCmp(k, D(V.safety_max_x)) > 0) k = D(V.safety_max_x);
      u.meter = dAdd(u.meter, dMul(u.base, k));
    }
    for (;;) {
      let best = null;
      for (const u of units) if (!u.down && dCmp(u.meter, act) >= 0 && u.acts < V.max_actions_per_step && (!best || dCmp(u.meter, best.meter) > 0)) best = u;
      if (!best) break;
      best.meter = dAdd(best.meter, dNeg(act)); best.acts++; seq.push(`${best.side}:${best.id}@${step}`);
    }
  }
  return seq;
}

// 60 seeded random fights (the fixed scenarios meter.limit* cover the units above max_actions_per_step x act_at)
function randomFights() {
  const out = [];
  for (let k = 0; k < 60; k++) {
    const rng = mkRng(1000 + k); const ri = (a, b) => a + Math.floor(rng() * (b - a + 1)); const pick = (a) => a[ri(0, a.length - 1)];
    const clock = k % 4 === 0 ? ri(1, 5) : 0;
    const status = () => {
      const s = {};
      if (rng() < 0.3) s.slowed = rng() < 0.3 ? {} : { until: clock + ri(1, 12) };
      if (rng() < 0.3) s.quickened = rng() < 0.3 ? {} : { until: clock + ri(1, 12) };
      if (rng() < 0.3) s.chill = rng() < 0.3 ? { stacks: ri(1, 2) } : { stacks: ri(1, 2), until: clock + ri(1, 12) };
      return s;
    };
    const nCards = ri(2, 8); const squad = []; const cards = {};
    for (let i = 0; i < nCards; i++) {
      let id; do { id = ri(1, 999); } while (cards[id]);
      squad.push(id);
      cards[id] = { role: pick(ROLES), spd: ri(0, 12), meter: rng() < 0.5 ? 0 : ri(0, 99), status: status(), down: i > 0 && rng() < 0.15 };
      if (rng() < 0.1) cards[id] = { speed: ri(10, 60), meter: ri(0, 99), status: status() };
    }
    const enemies = Array.from({ length: ri(1, 5) }, (_, i) => ({ speed: pick([45, 48, 50, 55, 100, 110, ri(20, 150)]), meter: rng() < 0.5 ? 0 : ri(0, 99), status: status(), down: i > 0 && rng() < 0.15 }));
    // a few exact ties: the same role and points, the same meter
    if (k % 5 === 1 && squad.length > 2) { cards[squad[2]] = { ...cards[squad[1]], status: { ...cards[squad[1]].status } }; }
    if (k % 7 === 2) enemies.push({ ...enemies[0], status: { ...enemies[0].status } });
    out.push({ id: `random ${k}`, mode: k % 3 === 0 ? 'hunt' : k % 3 === 1 ? 'dungeon' : 'gauntlet', cap: k % 2 ? 40 : ri(10, 60), clock, squad, cards, enemies });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the SQL block
const SETUP = String.raw`
  perform set_config('balance.by', 'test', true);
  execute $m$${V1}$m$;
  execute $m$${E1}$m$;
  -- the state before the file, also when the file is already applied on this copy: the 5 functions are dropped, so the checks below (comments,
  -- grants, volatility, no other overload) see what the file makes, not what an earlier run left (2026-10-19: comment_missing was NOT CAUGHT
  -- on a copy with the file applied)
  execute $d$do $x$ declare f text; begin
    for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('combat_v2_speed', 'combat_v2_advance', 'combat_v2_turn_order', 'combat_v2_numbers') loop
      execute 'drop function ' || f;
    end loop; end $x$$d$;
  execute $m$${mig}$m$;
  -- the runner: advance until the cap (or none); the actor sequence "side:id@clock" and the first problem of fight_state_check_v2
  execute $q$create function pg_temp.v2run(p jsonb, p_cap int) returns jsonb language plpgsql as $r$
    declare s jsonb := p; a jsonb; seq jsonb := '[]'; bad text; e text[]; n int := 0;
    begin
      update public.balance set value = jsonb_set(value, '{round_cap}', to_jsonb(p_cap)) where key in ('v2_hunt', 'v2_dungeon');
      loop
        a := combat_v2_advance(s);
        s := a->'state';
        e := fight_state_check_v2(s);
        if cardinality(e) > 0 and bad is null then bad := array_to_string(e, '; '); end if;
        exit when a->>'event' <> 'act';
        n := n + 1; exit when n > 100000;
        seq := seq || to_jsonb((a->'actor'->>'side') || ':' || (a->'actor'->>'id') || '@' || (s->>'clock'));
      end loop;
      return jsonb_build_object('seq', seq, 'event', a->>'event', 'clock', s->'clock', 'bad', bad, 'state', s);
    end $r$$q$;`;

const cfgSim = loadConfig();
const fixedScenarios = [];
for (const sp of [100, 50, 200, 17, 140]) fixedScenarios.push({ id: `meter.${sp}`, cap: 60, ...one(sp) });
fixedScenarios.push({ id: 'meter.ratio', cap: 200, mode: 'dungeon', squad: [1, 2], cards: { 1: { speed: 17 }, 2: { speed: 40 } }, enemies: [{ speed: 100 }] });
fixedScenarios.push({ id: 'meter.slowed', cap: 100, ...one(100, { status: { slowed: { until: 1000 } } }) });
fixedScenarios.push({ id: 'meter.quickened', cap: 100, ...one(100, { status: { quickened: { until: 1000 } } }) });
fixedScenarios.push({ id: 'meter.chill', cap: 100, ...one(100, { status: { chill: { stacks: 2, until: 1000 } } }) });
fixedScenarios.push({ id: 'meter.slowed_ends', cap: 20, ...one(100, { status: { slowed: { until: 10 } } }) });
fixedScenarios.push({ id: 'meter.no_until', cap: 30, ...one(100, { status: { slowed: {} } }) });
// the per-unit limit of max_actions_per_step actions in one step (the simulator limits each unit since 2026-10-21, the same as SQL)
fixedScenarios.push({ id: 'meter.limit', cap: 10, ...one(1000) });
fixedScenarios.push({ id: 'meter.limit_mixed', cap: 12, mode: 'hunt', squad: [4, 2], cards: { 4: { speed: 450, meter: 30 }, 2: { role: 'flurry', spd: 6 } }, enemies: [{ speed: 1000, meter: 99 }, { speed: 230 }] });
const randoms = randomFights();
const ALL = [...fixedScenarios, ...randoms];

const SPEED_CASES = [   // [name, unit, clock, expected speed as a function of the balance numbers B]
  ['role base speed (Warden, no points)', { role: 'warden' }, 1, (B) => B.v2_speed.role_base.warden],
  ['Speed 10 points: x (1 + 10 x spd.pct)', { role: 'striker', spd: 10 }, 1, (B) => B.v2_speed.role_base.striker * (1 + 10 * B.v2_stats.spd.pct)],
  ['Speed 25 points count as max_per_stat', { role: 'striker', spd: 25 }, 1, (B) => B.v2_speed.role_base.striker * (1 + B.v2_stats.max_per_stat * B.v2_stats.spd.pct)],
  ['the safety cap: 10 points and Quickened', { role: 'warden', spd: 10, status: { quickened: { until: 9 } } }, 1,
    (B) => B.v2_speed.role_base.warden * Math.min(B.v2_speed.safety_max_x, (1 + 10 * B.v2_stats.spd.pct) * B.v2_status.quickened.x)],
  ['the floor: Slowed and Chill 7 (a planted stack count)', { speed: 100, status: { slowed: {}, chill: { stacks: 7 } } }, 1,
    (B) => 100 * Math.max(B.v2_speed.status_min_x, B.v2_status.slowed.x * (1 - 7 * B.v2_status.chill.spd))],
  ['Chill with no stacks counts 1 stack', { speed: 100, status: { chill: {} } }, 1, (B) => 100 * (1 - B.v2_status.chill.spd)],
  ['a status in its until step counts', { speed: 100, status: { slowed: { until: 5 } } }, 5, (B) => 100 * B.v2_status.slowed.x],
  ['a status after its until step does not count', { speed: 100, status: { slowed: { until: 5 } } }, 6, () => 100],
  ['speed overrides the role', { role: 'warden', speed: 37 }, 1, () => 37],
];

const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; s jsonb; a jsonb; b jsonb; ok boolean; t text; i int; seq jsonb; o jsonb;
begin
  ${SETUP}
  b := combat_v2_numbers(array['v2_speed', 'v2_stats', 'v2_status', 'v2_hunt', 'v2_dungeon']);
  res := res || jsonb_build_object('case', 'NUMBERS', 'ok', true, 'b', b);
  -- 1 and 2: the scenarios
  for r in select x from jsonb_array_elements(${sqlLit(ALL.map((sc) => ({ id: sc.id, cap: sc.cap, state: state(sc) })))}::jsonb) x loop
    s := pg_temp.v2run(r->'state', (r->>'cap')::int);
    res := res || jsonb_build_object('case', 'RUN', 'id', r->>'id', 'ok', true, 'seq', s->'seq', 'event', s->'event', 'clock', s->'clock', 'bad', s->'bad');
  end loop;
  update public.balance set value = jsonb_set(value, '{round_cap}', '40') where key in ('v2_hunt', 'v2_dungeon');
  -- 3a. combat_v2_speed
  for r in select x from jsonb_array_elements(${sqlLit(SPEED_CASES.map(([n, u, c]) => ({ n, u: { meter: 0, charge: 0, status: {}, ...u }, c })))}::jsonb) x loop
    res := res || jsonb_build_object('case', 'SPEED', 'n', r->>'n', 'ok', true, 'got', combat_v2_speed(r->'u', (r->>'c')::int, b));
  end loop;
  -- 3b. the tie order. Two Wardens with the same meter: squad [12, 3] -> 12 acts first (squad order, not the card id).
  s := ${sqlLit(state({ mode: 'dungeon', squad: [12, 3], cards: { 3: { role: 'warden', meter: 100 }, 12: { role: 'warden', meter: 100 } }, enemies: [{ speed: 50, meter: 100 }] }))};
  a := combat_v2_advance(s); o := jsonb_build_array(a->'actor');
  a := combat_v2_advance(a->'state'); o := o || jsonb_build_array(a->'actor');
  a := combat_v2_advance(a->'state'); o := o || jsonb_build_array(a->'actor');
  res := res || jsonb_build_object('case', 'ties at the same meter: the squad order (12 before 3, not the id order), then the enemies',
    'ok', o = '[{"side": "card", "id": 12}, {"side": "card", "id": 3}, {"side": "enemy", "id": 0}]'::jsonb and (a->>'steps')::int = 0, 'got', o);
  -- a higher meter acts before the squad order; a card that is not in the squad comes after the squad, before the enemies
  s := ${sqlLit(state({ mode: 'dungeon', squad: [12, 3], cards: { 3: { role: 'warden', meter: 150 }, 12: { role: 'warden', meter: 120 }, 7: { role: 'warden', meter: 120 } }, enemies: [{ speed: 50, meter: 120 }] }))};
  o := '[]';
  for i in 1 .. 4 loop a := combat_v2_advance(s); s := a->'state'; o := o || jsonb_build_array(a->'actor'); end loop;
  res := res || jsonb_build_object('case', 'a higher meter first; then the squad, then the other cards, then the enemies',
    'ok', o = '[{"side": "card", "id": 3}, {"side": "card", "id": 12}, {"side": "card", "id": 7}, {"side": "enemy", "id": 0}]'::jsonb, 'got', o);
  -- the actor loses act_at: the meter keeps the rest
  s := ${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: { role: 'warden', meter: 0 } }, enemies: [{ speed: 130, meter: 0 }] }))};
  a := combat_v2_advance(s);
  res := res || jsonb_build_object('case', 'one step: the enemy of speed 130 acts in step 1 and keeps 30; the card keeps its speed',
    'ok', a->'actor' = '{"side": "enemy", "id": 0}' and (a->'state'->>'clock')::int = 1 and (a->>'steps')::int = 1
          and (a->'state'->'enemies'->0->>'meter')::numeric = 130 - (b->'v2_speed'->>'act_at')::numeric
          and (a->'state'->'cards'->'1'->>'meter')::numeric = (b->'v2_speed'->'role_base'->>'warden')::numeric, 'got', a);
  -- 3c. max_actions_per_step: an enemy of speed 1000 acts max_actions_per_step times in each step, then waits for the next step
  s := ${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: { speed: 1 } }, enemies: [{ speed: 1000 }] }))};
  o := '[]';
  for i in 1 .. 12 loop
    a := combat_v2_advance(s); s := a->'state';
    o := o || jsonb_build_array(jsonb_build_object('clock', s->'clock', 'acts', s->'enemies'->0->'acts'));
  end loop;
  res := res || jsonb_build_object('case', 'max_actions_per_step: a unit acts at most that many times in one step, with the acts count', 'ok', true, 'got', o,
    'max', b->'v2_speed'->'max_actions_per_step');
  update public.balance set value = jsonb_set(value, '{round_cap}', '10') where key = 'v2_dungeon';
  s := pg_temp.v2run(${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: { speed: 1 } }, enemies: [{ speed: 1000 }] }))}, 10);
  res := res || jsonb_build_object('case', 'speed 1000 for 10 steps: max_actions_per_step x 10 actions', 'ok',
    jsonb_array_length(s->'seq') = 10 * (b->'v2_speed'->>'max_actions_per_step')::int, 'got', jsonb_array_length(s->'seq'));
  update public.balance set value = jsonb_set(value, '{round_cap}', '40') where key = 'v2_dungeon';
  -- 3d. down units: no fill, no action; none with no standing unit
  s := ${sqlLit(state({ mode: 'dungeon', squad: [1, 2], cards: { 1: { role: 'warden', meter: 150, down: true }, 2: { role: 'medic', meter: 10 } }, enemies: [{ speed: 50, meter: 0 }, { speed: 100, meter: 250, down: true }] }))};
  a := combat_v2_advance(s);
  res := res || jsonb_build_object('case', 'a down card (meter 150) and a dead enemy (meter 250) neither act nor fill', 'ok',
    a->'actor' = '{"side": "enemy", "id": 0}' and (a->'state'->'cards'->'1'->>'meter')::numeric = 150 and (a->'state'->'enemies'->1->>'meter')::numeric = 250, 'got', a);
  s := ${sqlLit(state({ mode: 'dungeon', clock: 3, squad: [1], cards: { 1: { role: 'warden', meter: 150, down: true } }, enemies: [{ speed: 50, meter: 300, down: true }] }))};
  a := combat_v2_advance(s);
  res := res || jsonb_build_object('case', 'no standing unit: event none, the clock stays', 'ok', a->>'event' = 'none' and a->'actor' = 'null' and (a->'state'->>'clock')::int = 3 and (a->>'steps')::int = 0, 'got', a);
  -- 3e. the step cap of each mode
  update public.balance set value = jsonb_set(value, '{round_cap}', '7') where key = 'v2_hunt';
  update public.balance set value = jsonb_set(value, '{round_cap}', '9') where key = 'v2_dungeon';
  o := '{}';
  foreach t in array array['hunt', 'dungeon', 'gauntlet'] loop
    s := ${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: { speed: 1 } }, enemies: [{ speed: 100 }] }))} || jsonb_build_object('mode', t);
    i := 0;
    loop a := combat_v2_advance(s); s := a->'state'; exit when a->>'event' <> 'act'; i := i + 1; end loop;
    o := o || jsonb_build_object(t, jsonb_build_object('clock', s->'clock', 'event', a->'event', 'acts', i));
  end loop;
  res := res || jsonb_build_object('case', 'the step cap: Hunt v2_hunt.round_cap (7), Dungeon and Gauntlet v2_dungeon.round_cap (9); speed 100 acts in every step up to the cap', 'ok',
    o = '{"hunt": {"clock": 7, "event": "cap", "acts": 7}, "dungeon": {"clock": 9, "event": "cap", "acts": 9}, "gauntlet": {"clock": 9, "event": "cap", "acts": 9}}'::jsonb, 'got', o);
  -- a unit with a full meter still acts at the cap step; nothing moves past the cap
  s := ${sqlLit(state({ mode: 'dungeon', clock: 9, squad: [1], cards: { 1: { speed: 1, meter: 100 } }, enemies: [{ speed: 100 }] }))};
  a := combat_v2_advance(s); r := combat_v2_advance(a->'state');
  res := res || jsonb_build_object('case', 'at the cap: a full meter still acts, then event cap with no new step', 'ok',
    a->'actor' = '{"side": "card", "id": 1}' and r->>'event' = 'cap' and (r->'state'->>'clock')::int = 9 and (r->>'steps')::int = 0, 'got', jsonb_build_array(a, r));
  update public.balance set value = jsonb_set(value, '{round_cap}', '40') where key in ('v2_hunt', 'v2_dungeon');
  -- 3f. the acts key: set on the actor in its step, gone in a new step
  s := ${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: { role: 'warden' } }, enemies: [{ speed: 100 }] }))};
  a := combat_v2_advance(s); r := combat_v2_advance(a->'state');
  res := res || jsonb_build_object('case', 'acts = 1 on the enemy after its action in step 1; in step 2 the count starts again (acts 1, not 2); a card that did not act has no acts', 'ok',
    (a->'state'->'enemies'->0->>'acts')::int = 1 and (r->'state'->'enemies'->0->>'acts')::int = 1 and r->'actor' = '{"side": "enemy", "id": 0}'
    and (r->'state'->>'clock')::int = 2 and not (a->'state'->'cards'->'1' ? 'acts') and not (r->'state'->'cards'->'1' ? 'acts'), 'got', jsonb_build_array(a->'state'->'enemies', r->'state'->'enemies'));
  -- 3g. the turn-order strip = the advance sequence; it changes nothing; n = 0 gives []
  s := ${sqlLit(state({ mode: 'hunt', clock: 2, squad: [5, 9, 4], cards: { 5: { role: 'flurry', spd: 4, meter: 60 }, 9: { role: 'herald', meter: 90 }, 4: { role: 'cleaver', meter: 99, status: { slowed: { until: 6 } } } }, enemies: [{ speed: 100, meter: 30, status: { chill: { stacks: 2, until: 4 } } }] }))};
  o := combat_v2_turn_order(s, 12);
  seq := '[]'; r := s;
  for i in 1 .. 12 loop a := combat_v2_advance(r); r := a->'state'; seq := seq || jsonb_build_array(a->'actor' || jsonb_build_object('clock', r->'clock')); end loop;
  res := res || jsonb_build_object('case', 'combat_v2_turn_order(state, 12) = 12 calls of combat_v2_advance, with the clock of each action', 'ok', o = seq and jsonb_array_length(o) = 12, 'got', o, 'want', seq);
  res := res || jsonb_build_object('case', 'combat_v2_turn_order(state, 0) = [] ; up to the cap it is shorter', 'ok',
    combat_v2_turn_order(s, 0) = '[]'::jsonb and jsonb_array_length(combat_v2_turn_order(s || '{"clock": 40}', 50)) = 0
    and jsonb_array_length(combat_v2_turn_order(s, 500)) < 500, 'got', jsonb_array_length(combat_v2_turn_order(s, 500)));
  -- 3h. the refusals
  o := '[]';
  foreach t in array array[
      '{"v": 1, "mode": "dungeon", "round": 0, "squad": [], "cards": {}, "enemies": [], "marks": {}, "facts": {"passives": [], "cards": {}}, "ext": {}}',
      ${sqlLit({ ...state(one(50)), clock: -1 })},
      ${sqlLit({ ...state(one(50)), mode: 'arena' })},
      ${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: {} }, enemies: [{ speed: 50 }] }))},
      ${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: { role: 'paladin' } }, enemies: [{ speed: 50 }] }))},
      ${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: { role: 'warden', spd: -1 } }, enemies: [{ speed: 50 }] }))},
      ${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: { role: 'warden', spd: 1.5 } }, enemies: [{ speed: 50 }] }))},
      ${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: { role: 'warden' } }, enemies: [{ speed: 0 }] }))},
      ${sqlLit(state({ mode: 'dungeon', squad: [1], cards: { 1: { role: 'warden' } }, enemies: [{}] }))},
      ${sqlLit({ ...state(one(50)), enemies: [{ hp: 5, max: 5, charge: 0, status: {}, speed: 50 }] })}] loop
    begin
      perform combat_v2_advance(t::jsonb);
      o := o || to_jsonb('accepted: ' || left(t, 80));
    exception when others then null;
    end;
  end loop;
  res := res || jsonb_build_object('case', '10 bad inputs refused (a v1 state, clock -1, an unknown mode, a card with no role and no speed, an unknown role, Speed points -1 and 1.5, speed 0, an enemy with no speed, a unit with no meter)',
    'ok', o = '[]'::jsonb, 'got', o);
  -- 4. pure and server only
  select jsonb_object_agg(p.oid::regprocedure::text, p.provolatile) into o from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('combat_v2_speed', 'combat_v2_advance', 'combat_v2_turn_order', 'combat_v2_numbers');
  res := res || jsonb_build_object('case', 'volatility: combat_v2_speed and combat_v2_advance(state, numbers) IMMUTABLE; the readers of balance STABLE', 'ok',
    o = '{"combat_v2_speed(jsonb,integer,jsonb)": "i", "combat_v2_advance(jsonb,jsonb)": "i", "combat_v2_advance(jsonb)": "s", "combat_v2_turn_order(jsonb,integer)": "s", "combat_v2_numbers(text[])": "s"}'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text || ' ' || r2), '[]') into o
    from pg_proc p cross join unnest(array['anon', 'authenticated']) r2
   where p.pronamespace = 'public'::regnamespace and p.proname in ('combat_v2_speed', 'combat_v2_advance', 'combat_v2_turn_order', 'combat_v2_numbers')
     and has_function_privilege(r2, p.oid, 'execute');
  res := res || jsonb_build_object('case', 'server only: anon and authenticated cannot run the 5 functions', 'ok', o = '[]'::jsonb, 'got', o);
  select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') into o from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('combat_v2_speed', 'combat_v2_advance', 'combat_v2_turn_order', 'combat_v2_numbers')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') = '';
  res := res || jsonb_build_object('case', 'every function has a comment', 'ok', o = '[]'::jsonb, 'got', o);
  select count(*) into i from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('combat_v2_speed', 'combat_v2_advance', 'combat_v2_turn_order', 'combat_v2_numbers');
  res := res || jsonb_build_object('case', 'the 5 functions exist (no other overload)', 'ok', i = 5, 'got', i);
  -- idempotent: the file again
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'idempotent: the file runs a second time', 'ok', true);
  raise exception 'RESULT:%', res::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------------- the checks
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  const results = JSON.parse(await runBlock(body));
  const B = results.find((r) => r.case === 'NUMBERS').b;
  const cfg = patch(cfgSim, { v2_speed: B.v2_speed, v2_stats: B.v2_stats, v2_status: B.v2_status, v2_hunt: B.v2_hunt, v2_dungeon: B.v2_dungeon });
  const runs = Object.fromEntries(results.filter((r) => r.case === 'RUN').map((r) => [r.id, r]));
  const count = (id, who) => runs[id].seq.filter((x) => x.startsWith(who + '@')).length;
  const act = B.v2_speed.act_at;
  // 1. the simulator meter checks (checks.mjs meterChecks): the simulator tolerance, and the exact count with meters that start at 0
  for (const sp of [100, 50, 200, 17, 140]) {
    const got = count(`meter.${sp}`, 'enemy:0'); const exp = sp * 60 / act;
    say(Math.abs(got - exp) <= 1 && got === Math.floor(exp + 1e-9), `meter.${sp}: speed ${sp} acts ${got} times in 60 steps (simulator: ${exp} +/- 1; exact from 0: ${Math.floor(exp + 1e-9)})`, `got ${got}`);
  }
  { const a = count('meter.ratio', 'card:1'), b = count('meter.ratio', 'card:2'); const r = b / a;
    say(Math.abs(r - 40 / 17) <= 0.05, `meter.ratio: speeds 17 and 40 act ${a} and ${b} times in 200 steps, ratio ${r.toFixed(3)} (40/17 = ${(40 / 17).toFixed(3)} +/- 0.05)`, `got ${r}`); }
  for (const [s, x] of [['slowed', B.v2_status.slowed.x], ['quickened', B.v2_status.quickened.x], ['chill', 1 - 2 * B.v2_status.chill.spd]]) {
    const got = count(`meter.${s}`, 'enemy:0'); const exp = 100 * x;
    say(Math.abs(got - exp) <= 1.5 && got === Math.floor(exp + 1e-9), `meter.${s}: ${s === 'chill' ? 'Chill 2' : s} for 100 steps: ${got} actions (simulator: ${exp.toFixed(1)} +/- 1.5)`, `got ${got}`);
  }
  { const got = count('meter.slowed_ends', 'enemy:0'); const exp = Math.floor(10 * 100 * B.v2_status.slowed.x / act + 1e-9) + 10;
    say(got === exp, `Slowed until step 10, then free: ${got} actions in 20 steps (want ${exp})`, `got ${got}`); }
  { const got = count('meter.no_until', 'enemy:0'); const exp = Math.floor(30 * 100 * B.v2_status.slowed.x / act + 1e-9);
    say(got === exp, `Slowed with no until lasts: ${got} actions in 30 steps (want ${exp})`, `got ${got}`); }
  // 2. the simulator engine on every scenario (the fixed ones and the 60 random fights): the same actor sequence, step by step
  const diffs = []; const exactDiffs = []; const edges = []; const bad = []; let actions = 0, ties = 0;
  const first = (a, b) => { const i = a.findIndex((x, k) => x !== b[k]); return i < 0 ? a.length : i; };
  for (const sc of ALL) {
    const r = runs[sc.id]; const sim = simSeq(cfg, sc); const exact = exactSeq(cfg, sc);
    if (JSON.stringify(r.seq) !== JSON.stringify(exact)) { const i = first(r.seq, exact); exactDiffs.push(`${sc.id}: action ${i}: SQL ${r.seq[i]} exact ${exact[i]}`); }
    const edge = JSON.stringify(sim) !== JSON.stringify(exact);
    if (edge) { const i = first(sim, exact); edges.push(`${sc.id} (action ${i}: simulator ${sim[i]}, exact ${exact[i]})`); }
    const want = edge ? exact : sim;
    actions += r.seq.length;
    for (let i = 1; i < r.seq.length; i++) if (r.seq[i].split('@')[1] === r.seq[i - 1].split('@')[1]) ties++;
    if (JSON.stringify(r.seq) !== JSON.stringify(want)) {
      const i = r.seq.findIndex((x, k) => x !== want[k]);
      diffs.push(`${sc.id}: first difference at action ${i}: SQL ${r.seq[i]} simulator ${want[i]} (SQL ${r.seq.length}, simulator ${want.length})`);
    }
    if (r.event !== 'cap' || r.clock !== sc.cap) bad.push(`${sc.id}: ended with ${r.event} at clock ${r.clock} (cap ${sc.cap})`);
    if (r.bad) bad.push(`${sc.id}: fight_state_check_v2: ${r.bad}`);
  }
  say(exactDiffs.length === 0, `the simulator step loop in exact numbers: ${ALL.length} fights, the same actor and step for every action`, exactDiffs.slice(0, 4).join(' | '));
  say(edges.length <= 6, `float edges of the simulator (exact ties that float numbers break): ${edges.length} of ${ALL.length} fights${edges.length ? ': ' + edges.join(', ') : ''}`, 'too many: the exact replay may not follow the simulator rules');
  // the fixed scenarios have whole-number speeds and no float tie: an edge there is a rule difference (2026-10-21: the old simulator action limit for
  // all units together hid as an "edge" in meter.limit), not a float edge
  { const fe = edges.filter((x) => x.startsWith('meter.')); say(fe.length === 0, `no float edge in the ${fixedScenarios.length} fixed scenarios (whole-number speeds): the simulator = the exact replay there, also at the action limit`, fe.join(', ')); }
  say(diffs.length === 0, `the simulator engine (float): the other ${ALL.length - edges.length} of ${ALL.length} fights (${fixedScenarios.length} fixed + ${randoms.length} random), ${actions} actions (${ties} in a step with another action): the same actor and step for every action`, diffs.slice(0, 4).join(' | '));
  say(bad.length === 0, `every fight ends at its cap with event cap, and every state after every call passes fight_state_check_v2`, bad.slice(0, 4).join(' | '));
  // 3a. the speed of one unit
  const SP = results.filter((r) => r.case === 'SPEED');
  for (const [n, , , f] of SPEED_CASES) {
    const r = SP.find((x) => x.n === n); const want = f(B);
    say(r && Math.abs(Number(r.got) - want) <= 1e-9 * Math.max(1, want), `combat_v2_speed: ${n} = ${want}`, `got ${r?.got}`);
  }
  // 3b - 4. the rest
  for (const r of results.filter((x) => !['NUMBERS', 'RUN', 'SPEED'].includes(x.case))) {
    const { case: name, ok, ...rest } = r;
    if (name.startsWith('max_actions_per_step: a unit')) {
      const mx = r.max; const want = Array.from({ length: 12 }, (_, i) => ({ clock: Math.floor(i / mx) + 1, acts: (i % mx) + 1 }));
      say(JSON.stringify(r.got.map((x) => [x.clock, x.acts])) === JSON.stringify(want.map((x) => [x.clock, x.acts])), name, JSON.stringify(r.got).slice(0, 600));
      continue;
    }
    say(ok, name, JSON.stringify(rest).slice(0, 900));
  }
} catch (e) {
  fail++; total++;
  console.log(`FAIL the test block raised (a file did not apply?): ${String(e.message).slice(0, 900)}`);
}
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
