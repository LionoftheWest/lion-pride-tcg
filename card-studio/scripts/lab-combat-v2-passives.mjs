import './localdb-guard.mjs';
/**
 * The Combat Lab item of PR E7 (plan 14.1, row E7: "Lab: each passive x each archetype"): every enemy mechanic of combat v2 against every archetype of
 * plan 7.4. LOCAL copy only; every request is one DO block, undone by its final RAISE (nothing is kept).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/lab-combat-v2-passives.mjs [--runs N] [--sql N] [--out file.md]
 * The room: the Dungeon guardian of floor ROOMS.casual.guardian (the floor of the teams and monsters experiments, where the median team wins about 65-90%),
 * built by the simulator makeFoe with exactly ONE mechanic (the passive of the row; no own passive, no pool passive), against each archetype squad of
 * v2sim experiments.mjs ARCHETYPES (the 3 attackers and 2 supports of dngPick, Normal cards at the casual investment).
 *   1. The simulator, policy best, --runs fights a cell (default 200): win rate and the mean steps of a won fight, and the cut = the win rate / the win rate
 *      of the same archetype with no passive. A passive is out of line when its median cut over the archetypes is below CUT_LOW (it walls every squad) or
 *      above CUT_HIGH (it helps the squads), or when one archetype falls below CUT_ONE (a hard counter of one archetype; plan 7.4: a counter boss cuts its
 *      archetype to x0.63-0.93, the cap of a Normal or Heroic boss is x0.65).
 *   2. SQL: --sql fights a cell (default 2) run in the database (combat_v2_next, combat_v2_card_act, combat_v2_enemy_act) with a simple shared policy (an
 *      active when it is charged, the first standing enemy, the most hurt ally) and ONE draw list a fight; the simulator runs the same fights with the same
 *      policy and draws. The report shows the SQL win rate and steps of that sample and how many fights are equal in both (result, steps, every HP).
 * The tables go to card-studio/out/lab/combat-v2-passives.md (not committed); the head lines print.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { runBlock as runBlock1, assertLocal, sqlLit } from './lab-lib.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { makeCard, classOf, ATTACKER_ROLES, SUPPORT_ROLES } from '../v2sim/cards.mjs';
import { makeFoe } from '../v2sim/modes.mjs';
import { POLICIES } from '../v2sim/policy.mjs';
import { ARCHETYPES } from '../v2sim/experiments.mjs';
import { ROOMS } from '../v2sim/teams.mjs';
import { loadConfig, patch, mkRng, hash, mean, median, table } from '../v2sim/util.mjs';
assertLocal('lab-combat-v2-passives.mjs');
// a request that meets a deadlock (another rolled-back run of DDL on the same copy) runs again, at most 5 times
const runBlock = async (sql) => { for (let k = 0; ; k++) { try { return await runBlock1(sql); } catch (e) { if (k >= 4 || !/deadlock detected/.test(e.message)) throw e; } } };
// the E7 file runs inside each block (idempotent, rolled back), so the Lab works before and after it is applied
const MIG = readFileSync(new URL('../../tcg-bot/supabase/combat_v2_monsters.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg('runs', 200)), SQLN = Number(arg('sql', 2)), OUT = arg('out', 'out/lab/combat-v2-passives.md');
const CUT_LOW = 0.6, CUT_HIGH = 1.15, CUT_ONE = 0.5;

// the numbers of the database (the balance values replace config.json; enemy_v2 equals config.json v2_boss_rules and v2_bosses: test-combat-v2-monsters.mjs)
const N = JSON.parse(await runBlock(String.raw`do $t$ begin execute $m$${MIG}$m$; raise exception 'RESULT:%', jsonb_build_object('b', combat_v2_enemy_numbers(), 'ab', ability_v2_numbers())::text; end $t$;`));
const CONFIG = loadConfig();
const B = { ...N.b }; delete B.enemy_v2;
const cfg = patch(CONFIG, { ...B, v2_pp: N.ab.v2_pp }); cfg.ability_v2 = JSON.parse(JSON.stringify(N.ab.ability_v2));
const MECHS = [...Object.keys(cfg.v2_enemy.mechanics), ...Object.keys(cfg.v2_dungeon.passive_params), ...Object.keys(cfg.v2_boss_rules).filter((k) => k !== 'undying')].filter((k) => !k.startsWith('_'));
const ARCH = Object.keys(ARCHETYPES);
const INV = cfg.v2_investment.casual; const FLOOR = ROOMS.casual.guardian;
const dngPick = (t) => { const a = t.filter((x) => ATTACKER_ROLES.includes(x.split('.')[0])), s = t.filter((x) => SUPPORT_ROLES.includes(x.split('.')[0])); return [...a.slice(0, 3), ...s.slice(0, 2)].concat(t).slice(0, 5); };
const squadOf = (arch) => dngPick(ARCHETYPES[arch].hunt).map((t) => makeCard(cfg, { key: t, role: t.split('.')[0], rarity: 'normal', template: t, ...INV }));
// the guardian of one fight with exactly the passive m (or none)
function guardian(m, i) {
  const f = makeFoe(cfg, FLOOR, cfg.v2_dungeon.rooms, 'guardian', mkRng(hash('lab-e7', i)));
  f.mech = m ? [m] : []; f.own = []; f.healer = (m === 'regrowth') || f.moves.some(([mv]) => mv === 'regenerate' || mv === 'drain');
  return f;
}

// ---------------------------------------------------------------- 1. the simulator, policy best
const t0 = Date.now();
const SIM = {};
for (const m of [null, ...MECHS]) {
  SIM[m || 'none'] = {};
  for (const a of ARCH) {
    const sq = squadOf(a); let won = 0, steps = 0;
    for (let i = 0; i < RUNS; i++) {
      const b = new Battle(cfg, { cards: sq.map((c) => ({ ...c, hp: c.maxHp, shield: 0 })), enemies: [guardian(m, i)], mode: 'dungeon', policy: POLICIES.best, seed: hash('lab-e7', a, i) }).run();
      if (b.ended === 'won') { won++; steps += b.step; }
    }
    SIM[m || 'none'][a] = { win: won / RUNS, steps: won ? steps / won : NaN };
  }
}
const simSec = (Date.now() - t0) / 1000;

// ---------------------------------------------------------------- 2. SQL with the shared simple policy and one draw list a fight
const simple = {
  name: 'lab-simple',
  target: (b) => b.alive('enemy')[0],
  useActive: () => true,
  allyFor: (b) => b.alive('card').reduce((m, c) => (!m || c.hp / c.maxHp < m.hp / m.maxHp ? c : m), null),
};
const DRAWS = 2500;
function specOf(m, a, i) {
  const rng = mkRng(hash('lab-e7-sql', m || 'none', a, i));
  const draws = Array.from({ length: DRAWS }, () => Math.floor(rng() * 1e6) / 1e6);
  const sq = squadOf(a); const f = guardian(m, 1000 + i);
  const meters = [...sq, f].map(() => Math.floor(rng() * 9999) / 100);
  return { m, a, i, sq, f, draws, meters };
}
// the v2 state of a spec: the cards with the stat line and the BASE template blocks (SQL scales a support's numbers by power and adds extra_stack)
function stateOf(sp) {
  const ids = sp.sq.map((_, k) => k + 1);
  const cards = Object.fromEntries(sp.sq.map((c, k) => [String(k + 1), {
    role: c.role, class: c.cls, atk: c.cp, crt: c.crit, crd: c.critx, abl: c.abl, acc: c.acc, def: c.def, ddg: c.ddg, max: c.maxHp, hp: c.maxHp, down: false,
    speed: c.speedBase, spd: c.points.spd || 0, power: c.power, extra_stack: cfg.v2_support.enabler_extra_stack.includes(c.rarity) ? 1 : 0,
    meter: sp.meters[k], charge: 0, held: 0, status: {}, active: { blocks: cfg.v2_templates[c.active.id].blocks } }]));
  const u = new Battle(cfg, { cards: [], enemies: [sp.f], mode: 'dungeon', policy: simple, seed: 1 }).enemies[0];
  const e = { hp: u.maxHp, max: u.maxHp, down: false, atk: u.atk, def: u.def, evasion: u.evasion, resolve: u.resolve, keen: u.keen, speed: u.speedBase, meter: sp.meters[sp.sq.length],
    charge: 0, status: {}, turn: 0, mechanics: [...u.mech], moves: sp.f.moves.map(([k, w]) => ({ k, w })), cataclysm: !!sp.f.cataclysm, healer: !!sp.f.healer, ...(u.brood ? { brood: u.brood } : {}) };
  return { v: 2, mode: 'dungeon', round: 0, clock: 0, squad: ids, cards, enemies: [e], marks: {}, facts: { passives: [], cards: {} }, ext: {} };
}
function simRun(sp) {
  const cards = sp.sq.map((c) => ({ ...c, hp: c.maxHp, shield: 0, active: { ...c.active, charge: cfg.v2_charge[c.cls] } })); // SQL charges by class (v2_charge)
  const b = new Battle(cfg, { cards, enemies: [sp.f], mode: 'dungeon', policy: simple, seed: 1 });
  let qi = 0; const take = () => { if (qi >= sp.draws.length) throw new Error('out of draws'); return sp.draws[qi++]; };
  b.units.forEach((u, k) => { u.rng = take; u.meter = sp.meters[k]; });
  // a float near-tie: the simulator meter lands within 1e-6 of a multiple of 100 (SQL has exact numbers, so the order can break the other way; plan 18.1)
  let nearTie = false;
  b.speedOf = function (u) { const s2 = Battle.prototype.speedOf.call(this, u); const m = u.meter + s2; if (!u.down && m >= 50 && Math.abs(m - 100 * Math.round(m / 100)) < 1e-6) nearTie = true; return s2; };
  b.run();
  return { won: b.ended === 'won', end: b.ended, steps: b.step, nearTie, hp: [...b.cards.map((c) => (c.down ? 0 : c.hp)), Math.max(0, b.enemies[0].hp)] };
}
const DRIVER = String.raw`
  create or replace function pg_temp.labfight(p_s jsonb, p_d jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; d jsonb := p_d; r jsonb; a jsonb; t jsonb; al jsonb; u jsonb; ev text; n int := 0; id text; best text;
  begin
    loop
      r := combat_v2_next(s, d, p_b); s := r->'state'; d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws')); ev := r->>'event';
      exit when ev <> 'act';
      n := n + 1;
      continue when (r->>'skip')::boolean;
      if r->'actor'->>'side' = 'card' then
        t := (select jsonb_build_object('side', 'enemy', 'id', q.id::numeric) from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n limit 1);
        best := null;
        for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
          if best is null or (s->'cards'->id->>'hp')::numeric / (s->'cards'->id->>'max')::numeric < (s->'cards'->best->>'hp')::numeric / (s->'cards'->best->>'max')::numeric then best := id; end if;
        end loop;
        al := jsonb_build_object('side', 'card', 'id', best::numeric);
        u := s #> combat_v2_unit_path(s, r->'actor');
        a := combat_v2_card_act(s, r->'actor', jsonb_build_object('use', coalesce((u->>'charge')::int, 0) >= (p_b->'v2_charge'->>(u->>'class'))::int, 'target', t, 'ally', al, 'draws', d), p_b);
      else
        a := combat_v2_enemy_act(s, r->'actor', jsonb_build_object('draws', d), p_b);
      end if;
      s := a->'state'; d := combat_v2_draws_rest(d, jsonb_array_length(a->'draws'));
    end loop;
    return jsonb_build_object('end', ev, 'steps', s->'clock', 'won', ev = 'end' and exists (select 1 from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id)),
      'hp', (select jsonb_agg(case when combat_v2_up(s #> case when q.side = 'card' then array['cards', q.id] else array['enemies', q.id] end)
                                   then (s #> case when q.side = 'card' then array['cards', q.id] else array['enemies', q.id] end)->'hp' else '0'::jsonb end order by q.n) from combat_v2_units(s) q));
  end $x$;`;
const t1 = Date.now();
const SQL = {}; let same = 0, ties = 0, nsql = 0; const diffs = [];
const specs = []; for (const m of [null, ...MECHS]) for (const a of ARCH) for (let i = 0; i < SQLN; i++) specs.push(specOf(m, a, i));
for (let i = 0; i < specs.length; i += 12) {
  const part = specs.slice(i, i + 12);
  const out = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
    execute $m$${MIG}$m$;
    ${DRIVER}
    b := combat_v2_enemy_numbers();
    for x in select v from jsonb_array_elements(${sqlLit(part.map((sp) => [stateOf(sp), sp.draws]))}::jsonb) v loop
      begin out := out || jsonb_build_array(pg_temp.labfight(x->0, x->1, b));
      exception when others then out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
    end loop;
    raise exception 'RESULT:%', out::text; end $t$;`));
  out.forEach((q, j) => {
    const sp = part[j]; const key = sp.m || 'none'; (SQL[key] ||= {}); (SQL[key][sp.a] ||= { won: 0, n: 0, steps: 0 });
    const c = SQL[key][sp.a]; nsql++;
    if (q.error) { diffs.push(`${key} x ${sp.a} #${sp.i}: SQL error ${q.error}`); return; }
    c.n++; if (q.won) { c.won++; c.steps += q.steps; }
    let s; try { s = simRun(sp); } catch (e) { diffs.push(`${key} x ${sp.a} #${sp.i}: simulator ${e.message}`); return; }
    const eq = s.won === q.won && s.steps === q.steps && s.hp.length === q.hp.length && s.hp.every((h, k) => Math.abs(h - Number(q.hp[k])) <= 1e-6 * Math.max(1, h));
    if (eq) same++; else if (s.nearTie) ties++; else if (diffs.length < 8) diffs.push(`${key} x ${sp.a} #${sp.i}: SQL ${q.won}/${q.steps} sim ${s.won}/${s.steps}`);
  });
}
const sqlSec = (Date.now() - t1) / 1000;

// ---------------------------------------------------------------- the report
const short = (a) => ({ 'Neutral (control)': 'Neutral', "Herald's Court": 'Court', 'Mark and Hunt': 'Mark' }[a] || a);
const cell = (x) => (Number.isFinite(x.steps) ? `${Math.round(x.win * 100)}/${Math.round(x.steps)}` : `${Math.round(x.win * 100)}/-`);
const rows = [], flags = [];
for (const m of [null, ...MECHS]) {
  const k = m || 'none'; const cuts = ARCH.map((a) => (SIM.none[a].win > 0 ? SIM[k][a].win / SIM.none[a].win : NaN)).filter(Number.isFinite);
  const med = median(cuts), lo = Math.min(...cuts); const worst = ARCH.reduce((w, a) => (SIM[k][a].win / SIM.none[a].win < SIM[k][w].win / SIM.none[w].win ? a : w), ARCH[0]);
  const why = [];
  if (m && med < CUT_LOW) why.push(`walls every squad (median cut ${med.toFixed(2)})`);
  if (m && med > CUT_HIGH) why.push(`helps the squads (median cut ${med.toFixed(2)})`);
  if (m && lo < CUT_ONE) why.push(`hard counter of ${short(worst)} (x${lo.toFixed(2)})`);
  if (why.length) flags.push(`${k}: ${why.join('; ')}`);
  const sq = SQL[k] || {}; const sw = ARCH.reduce((s2, a) => s2 + (sq[a]?.won || 0), 0), sn = ARCH.reduce((s2, a) => s2 + (sq[a]?.n || 0), 0);
  rows.push([k, ...ARCH.map((a) => cell(SIM[k][a])), m ? `x${med.toFixed(2)}` : '-', m ? `${short(worst)} x${lo.toFixed(2)}` : '-', sn ? `${Math.round((100 * sw) / sn)}%` : '-', why.length ? 'OUT' : '']);
}
const head = [
  `Lab E7: ${MECHS.length} passives x ${ARCH.length} archetypes, the Dungeon guardian of floor ${FLOOR} with one passive, Normal ${INV.stars}* level ${INV.level} squads.`,
  `Simulator (policy best): ${RUNS} fights a cell, ${simSec.toFixed(0)} s. SQL (the shared simple policy, one draw list a fight): ${nsql} fights, ${same} equal to the simulator fight by fight (result, steps, every HP), ${ties} differ only after a float near-tie of the simulator, ${sqlSec.toFixed(0)} s.`,
  flags.length ? `Out of line (median cut below ${CUT_LOW} or above ${CUT_HIGH}, or one archetype below ${CUT_ONE}): ${flags.join(' | ')}` : 'Out of line: none.',
  ...(diffs.length ? [`SQL differs from the simulator: ${diffs.join(' | ')}`] : []),
];
let md = `# Lab E7: each enemy passive x each archetype\n\n${head.map((h) => `- ${h}`).join('\n')}\n\nCell = win rate % / mean steps of a won fight (the simulator, policy best). cut = win rate / win rate with no passive. SQL win = the SQL sample with the simple policy (all archetypes).\n\n`;
md += table(['passive', ...ARCH.map(short), 'median cut', 'lowest', 'SQL win', 'flag'], rows);
mkdirSync(new URL('../out/lab/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../${OUT}`, import.meta.url), md);
for (const h of head) console.log(h);
console.log(`report: card-studio/${OUT}`);
process.exitCode = diffs.length ? 1 : 0;
