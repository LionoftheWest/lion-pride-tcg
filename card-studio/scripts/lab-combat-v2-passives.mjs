import './localdb-guard.mjs';
/**
 * The Combat Lab item of PR E7 (plan 14.1, row E7: "Lab: each passive x each archetype"), with the E7 follow-up (combat_v2_monster_tuning.sql, Nathan's
 * decisions of 2026-10-21): every enemy mechanic of combat v2 against every archetype of plan 7.4, WHERE IT CAN APPEAR, and the "Weak to" size.
 * LOCAL copy only; every request is one DO block, undone by its final RAISE (nothing is kept).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/lab-combat-v2-passives.mjs [--runs N] [--sql N] [--hunt-runs N] [--hunt-sql N]
 *       [--weak-runs N] [--only dungeon|hunt|weak] [--before] [--out file.md]
 * 1. THE DUNGEON TABLE: the mechanics that a foe can have (enemy_mechanics.on_foe), each alone on the Dungeon guardian of floor ROOMS.casual.guardian, built
 *    by the simulator makeFoe with exactly ONE mechanic, against each archetype squad of v2sim experiments.mjs ARCHETYPES (the 3 attackers and 2 supports of
 *    dngPick, Normal cards at the casual investment). The simulator, policy best, --runs fights a cell (default 200): win rate and the mean steps of a won
 *    fight; cut = the win rate / the win rate of the same archetype with no mechanic. Out of line: a median cut below CUT_LOW (it walls every squad), above
 *    CUT_HIGH (it helps the squads), or one archetype below CUT_ONE (a hard counter; plan 7.4: a counter cuts its archetype to x0.63-0.93).
 *    SQL: --sql fights a cell (default 2) in the database (combat_v2_next, combat_v2_card_act, combat_v2_enemy_act) with a simple shared policy and ONE draw
 *    list a fight; the simulator runs the same fights with the same policy and draws (result, steps, every HP).
 * 2. THE HUNT TABLE: the mechanics that a Hunt boss can have (enemy_mechanics.on_boss), each alone on the Heroic tier boss (makeBoss with sigs [m]), against
 *    each archetype (the 8 Hunt cards), casual and active, --hunt-runs days a cell (default 200, the same seeds for every row). cut = the net damage of a day
 *    / the net damage with no mechanic (the mean of casual and active); rel = cut / the median cut (the field-relative counter: plan 7.4 [T] is the Hunt
 *    value vs the median archetype). Out of line: the lowest rel below REL_ONE (0.63, a hard counter). The raw median is shown: a Hunt boss with a named
 *    rule pays it back with its hp_factor. SQL: --hunt-sql days a cell (default 1) with combat_v2_hunt_boss (the builder) and the shared simple policy.
 * 3. THE WEAK TO SIZE (decision 5): the 16 named bosses at Heroic with their Weak to tag (config.json v2_bosses.<key>.weak_to = hunt_bosses_v2.weak_to),
 *    the 11 archetypes, casual and active, --weak-runs days a cell (default 300), for weak_role_x 0.3, 0.5 and 0.7 and with no tag: the favored squad of each
 *    boss (Nathan's table of 2026-10-21) gains (its damage with the tag / with no tag) and its rank among the 11 squads (field-relative score).
 * 4. THE WARLORD'S IRONHIDE (the E7 follow-up, combat_v2_e7_followup.sql): the Rage-Quit Warlord at Heroic, the 11 archetypes, casual and active,
 *    --weak-runs days a cell, with its own crit_x 0 (after) and with the global crit_x (before); cut = the net damage / the net damage on the same boss
 *    with no Ironhide; rel = cut / the median cut. --only warlord runs this part alone.
 * --before: the E7 numbers and rules (no crit_x, no chance; the E7 Regrowth, Bulwark and Undying numbers) for the "before" table: only combat_v2_monsters.sql
 * runs in the blocks, and the copy must not have combat_v2_monster_tuning.sql applied (the script checks it).
 * The tables go to card-studio/out/lab/combat-v2-passives.md (not committed); the head lines print.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { runBlock as runBlock1, assertLocal, sqlLit } from './lab-lib.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { makeCard, ATTACKER_ROLES, SUPPORT_ROLES } from '../v2sim/cards.mjs';
import { makeFoe, makeBoss, huntDay, bossKeys, weakRoleOf } from '../v2sim/modes.mjs';
import { POLICIES } from '../v2sim/policy.mjs';
import { ARCHETYPES } from '../v2sim/experiments.mjs';
import { ROOMS } from '../v2sim/teams.mjs';
import { loadConfig, patch, mkRng, hash, mean, median, table } from '../v2sim/util.mjs';
assertLocal('lab-combat-v2-passives.mjs');
// a request that meets a deadlock (another rolled-back run of DDL on the same copy) runs again, at most 5 times
const runBlock = async (sql) => { for (let k = 0; ; k++) { try { return await runBlock1(sql); } catch (e) { if (k >= 4 || !/deadlock detected/.test(e.message)) throw e; } } };

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BEFORE = process.argv.includes('--before');
const RUNS = Number(arg('runs', 200)), SQLN = Number(arg('sql', 2)), HRUNS = Number(arg('hunt-runs', 200)), HSQL = Number(arg('hunt-sql', 1)), WRUNS = Number(arg('weak-runs', 300));
const ONLY = arg('only', ''), OUT = arg('out', BEFORE ? 'out/lab/combat-v2-passives-before.md' : 'out/lab/combat-v2-passives.md');
const CUT_LOW = 0.6, CUT_HIGH = 1.15, CUT_ONE = 0.5, REL_ONE = 0.63;
const WEAK_X = [0.3, 0.5, 0.7];
// Nathan's table of 2026-10-21 (ui-audit E7-weak-to, the primary tags): the archetype that each boss's Weak to tag favors
const FAVORED = { warlord: 'Lockdown', nightshade: "Herald's Court", netcode: 'Wall', vampire: 'Wildfire', warzombie: 'Mark and Hunt', maw: 'Cleave', smurf: 'Toxic',
  skeleton: 'Shatter', pumpkin: 'Wall', lagspike: 'Pile On', banwave: 'Crit Chain', zerg: 'Cleave', salt_miner: "Herald's Court", frost_lich: 'Toxic', camper_colossus: 'Lockdown', hydra: 'Wildfire' };

// the files that run in each block (idempotent, rolled back), so the Lab works before and after they are applied
const rd = (f) => readFileSync(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const MIG = (BEFORE ? [rd('combat_v2_monsters.sql')] : [rd('combat_v2_monsters.sql'), rd('combat_v2_monster_tuning.sql'), rd('combat_v2_e7_followup.sql')]).map((m) => `execute $m$${m}$m$;`).join('\n');

// the numbers of the database (the balance values replace config.json) and the places of each mechanic (enemy_mechanics.on_boss / on_foe)
const N = JSON.parse(await runBlock(String.raw`do $t$ begin ${MIG} raise exception 'RESULT:%', jsonb_build_object('b', combat_v2_enemy_numbers(), 'ab', ability_v2_numbers(),
  'where', (select jsonb_object_agg(key, jsonb_build_object('boss', on_boss, 'foe', on_foe)) from public.enemy_mechanics))::text; end $t$;`));
if (BEFORE && N.b.v2_enemy.mechanics.ironhide.crit_x !== undefined) throw new Error('--before: this copy has combat_v2_monster_tuning.sql applied (crit_x in balance): run --before on a copy without it');
const CONFIG = loadConfig();
const B = { ...N.b }; delete B.enemy_v2;
const cfg = patch(CONFIG, { ...B, v2_pp: N.ab.v2_pp }); cfg.ability_v2 = JSON.parse(JSON.stringify(N.ab.ability_v2));
if (BEFORE) { const M = cfg.v2_enemy.mechanics; M.ironhide = { ...M.ironhide, crit_x: 0 }; delete M.venom.chance; delete M.slowing.chance; }   // the E7 rules
const ALL = [...Object.keys(cfg.v2_enemy.mechanics), ...Object.keys(cfg.v2_dungeon.passive_params), ...Object.keys(cfg.v2_boss_rules).filter((k) => k !== 'undying')].filter((k) => !k.startsWith('_'));
const FOE_M = ALL.filter((m) => N.where[m]?.foe), BOSS_M = ALL.filter((m) => N.where[m]?.boss);
const ARCH = Object.keys(ARCHETYPES);
const INV = cfg.v2_investment.casual; const FLOOR = ROOMS.casual.guardian;
const dngPick = (t) => { const a = t.filter((x) => ATTACKER_ROLES.includes(x.split('.')[0])), s = t.filter((x) => SUPPORT_ROLES.includes(x.split('.')[0])); return [...a.slice(0, 3), ...s.slice(0, 2)].concat(t).slice(0, 5); };
const mk = (c, inv) => (t) => makeCard(c, { key: t, role: t.split('.')[0], rarity: 'normal', template: t, ...c.v2_investment[inv] });
const squadOf = (arch) => dngPick(ARCHETYPES[arch].hunt).map(mk(cfg, 'casual'));
const huntSquad = (c, arch, inv) => ARCHETYPES[arch].hunt.map(mk(c, inv));
const short = (a) => ({ 'Neutral (control)': 'Neutral', "Herald's Court": 'Court', 'Mark and Hunt': 'Mark' }[a] || a);
// the guardian of one fight with exactly the mechanic m (or none)
function guardian(m, i) {
  const f = makeFoe(cfg, FLOOR, cfg.v2_dungeon.rooms, 'guardian', mkRng(hash('lab-e7', i)));
  f.mech = m ? [m] : []; f.own = []; f.healer = (m === 'regrowth') || f.moves.some(([mv]) => mv === 'regenerate' || mv === 'drain');
  return f;
}
const head = []; let md = '';

// ---------------------------------------------------------------------------------------------------------------- the shared SQL driver
const simple = {
  name: 'lab-simple',
  target: (b) => b.alive('enemy')[0],
  useActive: () => true,
  allyFor: (b) => b.alive('card').reduce((m, c) => (!m || c.hp / c.maxHp < m.hp / m.maxHp ? c : m), null),
};
const DRAWS = 2500;
// the v2 state of a fight: the cards with the stat line and the BASE template blocks (SQL scales a support's numbers by power and adds extra_stack)
function cardsOf(sq, meters) {
  return Object.fromEntries(sq.map((c, k) => [String(k + 1), {
    role: c.role, class: c.cls, atk: c.cp, crt: c.crit, crd: c.critx, abl: c.abl, acc: c.acc, def: c.def, ddg: c.ddg, max: c.maxHp, hp: c.maxHp, down: false,
    speed: c.speedBase, spd: c.points.spd || 0, power: c.power, extra_stack: cfg.v2_support.enabler_extra_stack.includes(c.rarity) ? 1 : 0,
    meter: meters[k], charge: 0, held: 0, status: {}, active: { blocks: cfg.v2_templates[c.active.id].blocks } }]));
}
function simRun(sp, mode, enemy) {
  const cards = sp.sq.map((c) => ({ ...c, hp: c.maxHp, shield: 0, active: { ...c.active, charge: cfg.v2_charge[c.cls] } })); // SQL charges by class (v2_charge)
  const b = new Battle(cfg, { cards, enemies: [enemy], mode, policy: simple, seed: 1 });
  let qi = 0; const take = () => { if (qi >= sp.draws.length) throw new Error('out of draws'); return sp.draws[qi++]; };
  b.units.forEach((u, k) => { u.rng = take; u.meter = sp.meters[k]; });
  // a float near-tie: the simulator meter lands within 1e-6 of a multiple of 100 (SQL has exact numbers, so the order can break the other way; plan 18.1)
  let nearTie = false;
  b.speedOf = function (u) { const s2 = Battle.prototype.speedOf.call(this, u); const m = u.meter + s2; if (!u.down && m >= 50 && Math.abs(m - 100 * Math.round(m / 100)) < 1e-6) nearTie = true; return s2; };
  // the other float near-tie (the same check as test-combat-v2-monsters.mjs simFight): two units over the act line with meters within 1e-6
  const act0 = Battle.prototype.act;
  b.act = function (u) {
    const top = this.units.filter((x) => !x.down).map((x) => x.meter + (x === u ? 100 : 0)).filter((m) => m >= 100 - 1e-6).sort((p, q) => q - p);
    if (top.length > 1 && top[0] - top[1] < 1e-6) nearTie = true;
    return act0.call(this, u);
  };
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
// run the SQL fights (x = [state or a builder call, draws]) in parts, compare each with the simulator fight
async function sqlCompare(specs, toSql, simOf) {
  const R = {}; let same = 0, ties = 0, n = 0; const diffs = [];
  for (let i = 0; i < specs.length; i += 12) {
    const part = specs.slice(i, i + 12);
    const out = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; s jsonb; begin
      ${MIG}
      ${DRIVER}
      b := combat_v2_enemy_numbers();
      ${BEFORE ? '' : ''}
      for x in select v from jsonb_array_elements(${sqlLit(part.map(toSql))}::jsonb) v loop
        begin
          s := x->0;
          if jsonb_typeof(x->2) = 'array' then s := jsonb_set(s, '{enemies}', jsonb_build_array(combat_v2_hunt_boss(x->2->>0, null, x->2->1, b))); end if;
          out := out || jsonb_build_array(pg_temp.labfight(s, x->1, b));
        exception when others then out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
      end loop;
      raise exception 'RESULT:%', out::text; end $t$;`));
    out.forEach((q, j) => {
      const sp = part[j]; const key = sp.m || 'none'; (R[key] ||= {}); (R[key][sp.a] ||= { won: 0, n: 0, steps: 0 });
      const c = R[key][sp.a]; n++;
      if (q.error) { diffs.push(`${key} x ${sp.a} #${sp.i}: SQL error ${q.error}`); return; }
      c.n++; if (q.won) { c.won++; c.steps += q.steps; }
      let s; try { s = simOf(sp); } catch (e) { diffs.push(`${key} x ${sp.a} #${sp.i}: simulator ${e.message}`); return; }
      const eq = s.won === q.won && s.steps === q.steps && s.hp.length === q.hp.length && s.hp.every((h, k) => Math.abs(h - Number(q.hp[k])) <= 1e-6 * Math.max(1, h));
      if (eq) same++; else if (s.nearTie) ties++; else if (diffs.length < 8) diffs.push(`${key} x ${sp.a} #${sp.i}: SQL ${q.won}/${q.steps} sim ${s.won}/${s.steps}; HP SQL ${JSON.stringify(q.hp.map((h) => +Number(h).toFixed(3)))} sim ${JSON.stringify(s.hp.map((h) => +h.toFixed(3)))}`);
    });
  }
  return { R, same, ties, n, diffs };
}
const allDiffs = [];

// ---------------------------------------------------------------------------------------------------------------- 1. the Dungeon table (foe mechanics)
if (!ONLY || ONLY === 'dungeon') {
  const t0 = Date.now(); const SIM = {};
  for (const m of [null, ...FOE_M]) {
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
  const specOf = (m, a, i) => {
    const rng = mkRng(hash('lab-e7-sql', m || 'none', a, i));
    const draws = Array.from({ length: DRAWS }, () => Math.floor(rng() * 1e6) / 1e6);
    const sq = squadOf(a); const f = guardian(m, 1000 + i);
    const meters = [...sq, f].map(() => Math.floor(rng() * 9999) / 100);
    return { m, a, i, sq, f, draws, meters };
  };
  const stateOf = (sp) => {
    const u = new Battle(cfg, { cards: [], enemies: [sp.f], mode: 'dungeon', policy: simple, seed: 1 }).enemies[0];
    const e = { hp: u.maxHp, max: u.maxHp, down: false, atk: u.atk, def: u.def, evasion: u.evasion, resolve: u.resolve, keen: u.keen, speed: u.speedBase, meter: sp.meters[sp.sq.length],
      charge: 0, status: {}, turn: 0, mechanics: [...u.mech], moves: sp.f.moves.map(([k, w]) => ({ k, w })), cataclysm: !!sp.f.cataclysm, healer: !!sp.f.healer, ...(u.brood ? { brood: u.brood } : {}) };
    return { v: 2, mode: 'dungeon', round: 0, clock: 0, squad: sp.sq.map((_, k) => k + 1), cards: cardsOf(sp.sq, sp.meters), enemies: [e], marks: {}, facts: { passives: [], cards: {} }, ext: {} };
  };
  const t1 = Date.now();
  const specs = []; for (const m of [null, ...FOE_M]) for (const a of ARCH) for (let i = 0; i < SQLN; i++) specs.push(specOf(m, a, i));
  const S = await sqlCompare(specs, (sp) => [stateOf(sp), sp.draws, null], (sp) => simRun(sp, 'dungeon', sp.f));
  const sqlSec = (Date.now() - t1) / 1000;
  const cell = (x) => (Number.isFinite(x.steps) ? `${Math.round(x.win * 100)}/${Math.round(x.steps)}` : `${Math.round(x.win * 100)}/-`);
  const rows = [], flags = [];
  for (const m of [null, ...FOE_M]) {
    const k = m || 'none'; const cuts = ARCH.map((a) => (SIM.none[a].win > 0 ? SIM[k][a].win / SIM.none[a].win : NaN)).filter(Number.isFinite);
    const med = median(cuts), lo = Math.min(...cuts); const worst = ARCH.reduce((w, a) => (SIM[k][a].win / SIM.none[a].win < SIM[k][w].win / SIM.none[w].win ? a : w), ARCH[0]);
    const why = [];
    if (m && med < CUT_LOW) why.push(`walls every squad (median cut ${med.toFixed(2)})`);
    if (m && med > CUT_HIGH) why.push(`helps the squads (median cut ${med.toFixed(2)})`);
    if (m && lo < CUT_ONE) why.push(`hard counter of ${short(worst)} (x${lo.toFixed(2)})`);
    if (why.length) flags.push(`${k}: ${why.join('; ')}`);
    const sq = S.R[k] || {}; const sw = ARCH.reduce((s2, a) => s2 + (sq[a]?.won || 0), 0), sn = ARCH.reduce((s2, a) => s2 + (sq[a]?.n || 0), 0);
    rows.push([k, ...ARCH.map((a) => cell(SIM[k][a])), m ? `x${med.toFixed(2)}` : '-', m ? `${short(worst)} x${lo.toFixed(2)}` : '-', sn ? `${Math.round((100 * sw) / sn)}%` : '-', why.length ? 'OUT' : '']);
  }
  const dh = [
    `Dungeon: ${FOE_M.length} foe mechanics (enemy_mechanics.on_foe) x ${ARCH.length} archetypes, the Dungeon guardian of floor ${FLOOR} with one mechanic, Normal ${INV.stars}* level ${INV.level} squads${BEFORE ? ' (BEFORE: the E7 numbers and rules)' : ''}.`,
    `Dungeon simulator (policy best): ${RUNS} fights a cell, ${simSec.toFixed(0)} s. SQL (the shared simple policy, one draw list a fight): ${S.n} fights, ${S.same} equal to the simulator fight by fight (result, steps, every HP), ${S.ties} differ only after a float near-tie of the simulator, ${sqlSec.toFixed(0)} s.`,
    flags.length ? `Dungeon out of line (median cut below ${CUT_LOW} or above ${CUT_HIGH}, or one archetype below ${CUT_ONE}): ${flags.join(' | ')}` : 'Dungeon out of line: none.',
    ...(S.diffs.length ? [`Dungeon SQL differs from the simulator: ${S.diffs.join(' | ')}`] : [])];
  allDiffs.push(...S.diffs); head.push(...dh);
  md += `## 1. Dungeon: each foe mechanic x each archetype\n\n${dh.map((h) => `- ${h}`).join('\n')}\n\nCell = win rate % / mean steps of a won fight (the simulator, policy best). cut = win rate / win rate with no mechanic. SQL win = the SQL sample with the simple policy (all archetypes).\n\n`;
  md += table(['mechanic', ...ARCH.map(short), 'median cut', 'lowest', 'SQL win', 'flag'], rows) + '\n';
}

// ---------------------------------------------------------------------------------------------------------------- 2. the Hunt table (boss mechanics)
if (!ONLY || ONLY === 'hunt') {
  const t0 = Date.now(); const H = {};
  for (const m of [null, ...BOSS_M]) {
    H[m || 'none'] = {};
    for (const a of ARCH) {
      H[m || 'none'][a] = {};
      for (const inv of ['casual', 'active']) { const sq = huntSquad(cfg, a, inv); const v = []; for (let i = 0; i < HRUNS; i++) v.push(huntDay(cfg, sq, { tier: 'Heroic', sigs: m ? [m] : [], seed: hash('lab-e7-hunt', a, inv, i) }).net); H[m || 'none'][a][inv] = mean(v); }
    }
  }
  const simSec = (Date.now() - t0) / 1000;
  // SQL: the Heroic tier boss from the builder combat_v2_hunt_boss (sigs [m], start_frac, meter), a casual squad, the shared simple policy
  const specOf = (m, a, i) => {
    const rng = mkRng(hash('lab-e7-hunt-sql', m || 'none', a, i));
    const draws = Array.from({ length: DRAWS * 2 }, () => Math.floor(rng() * 1e6) / 1e6);
    const sq = huntSquad(cfg, a, 'casual'); const start = Math.round((0.3 + 0.7 * rng()) * 1000) / 1000;
    const meters = [...sq, null].map(() => Math.floor(rng() * 9999) / 100);
    return { m, a, i, sq, start, draws, meters };
  };
  const huntState = (sp) => ({ v: 2, mode: 'hunt', round: 0, clock: 0, squad: sp.sq.map((_, k) => k + 1), cards: cardsOf(sp.sq, sp.meters), enemies: [], marks: {}, facts: { passives: [], cards: {} }, ext: {} });
  const t1 = Date.now();
  const specs = []; for (const m of [null, ...BOSS_M]) for (const a of ARCH) for (let i = 0; i < HSQL; i++) specs.push(specOf(m, a, i));
  const S = await sqlCompare(specs, (sp) => [huntState(sp), sp.draws, ['Heroic', { sigs: sp.m ? [sp.m] : [], start_frac: sp.start, meter: sp.meters[sp.sq.length] }]],
    (sp) => simRun(sp, 'hunt', makeBoss(cfg, 'Heroic', { sigs: sp.m ? [sp.m] : [], startFrac: sp.start })));
  const sqlSec = (Date.now() - t1) / 1000;
  const rows = [], flags = [];
  for (const m of BOSS_M) {
    const cut = Object.fromEntries(ARCH.map((a) => [a, mean(['casual', 'active'].map((inv) => H[m][a][inv] / H.none[a][inv]))]));
    const med = median(Object.values(cut)); const rel = Object.fromEntries(ARCH.map((a) => [a, cut[a] / med]));
    const lo = ARCH.reduce((w, a) => (rel[a] < rel[w] ? a : w), ARCH[0]), hi = ARCH.reduce((w, a) => (rel[a] > rel[w] ? a : w), ARCH[0]);
    const why = []; if (rel[lo] < REL_ONE) why.push(`hard counter of ${short(lo)} (rel x${rel[lo].toFixed(2)})`);
    if (why.length) flags.push(`${m}: ${why.join('; ')}`);
    const n = N.where[m]?.foe ? '' : ' (Hunt only)';
    rows.push([m + n, ...ARCH.map((a) => cut[a].toFixed(2)), `x${med.toFixed(2)}`, `${short(lo)} x${rel[lo].toFixed(2)}`, `${short(hi)} x${rel[hi].toFixed(2)}`, why.length ? 'OUT' : '']);
  }
  const hh = [
    `Hunt: ${BOSS_M.length} boss mechanics (enemy_mechanics.on_boss) x ${ARCH.length} archetypes, the Heroic tier boss with one mechanic, the 8-card squads at casual and active${BEFORE ? ' (BEFORE: the E7 numbers and rules)' : ''}.`,
    `Hunt simulator (policy best): ${HRUNS} days a cell and investment, ${simSec.toFixed(0)} s. SQL (combat_v2_hunt_boss, the simple policy, casual): ${S.n} days, ${S.same} equal to the simulator day by day (steps, every HP), ${S.ties} differ only after a float near-tie, ${sqlSec.toFixed(0)} s.`,
    flags.length ? `Hunt out of line (the lowest rel below ${REL_ONE}): ${flags.join(' | ')}` : `Hunt out of line (the lowest rel below ${REL_ONE}): none.`,
    ...(S.diffs.length ? [`Hunt SQL differs from the simulator: ${S.diffs.join(' | ')}`] : [])];
  allDiffs.push(...S.diffs); head.push(...hh);
  md += `## 2. Hunt: each boss mechanic x each archetype\n\n${hh.map((h) => `- ${h}`).join('\n')}\n\nCell = cut: the net damage of a Heroic day with the mechanic / with no mechanic (the mean of casual and active). median = the raw median cut (a named boss pays it back with its hp_factor). rel = cut / median cut (the field-relative counter of plan 7.4).\n\n`;
  md += table(['mechanic', ...ARCH.map(short), 'median cut', 'lowest rel', 'highest rel', 'flag'], rows) + '\n';
}

// ---------------------------------------------------------------------------------------------------------------- 3. the Weak to size (weak_role_x)
if (!BEFORE && (!ONLY || ONLY === 'weak')) {
  const t0 = Date.now(); const BK = bossKeys(cfg);
  const variants = [['none', patch(cfg, { v2_bosses: Object.fromEntries(BK.map((k) => [k, { weak_to: [] }])) })], ...WEAK_X.map((x) => [`x${x}`, patch(cfg, { v2_enemy: { weak_role_x: x } })])];
  const V = {};
  for (const [vk, c] of variants) {
    V[vk] = {};
    for (const k of BK) { V[vk][k] = {};
      for (const a of ARCH) { V[vk][k][a] = {};
        for (const inv of ['casual', 'active']) { const sq = huntSquad(c, a, inv); const v = []; for (let i = 0; i < WRUNS; i++) v.push(huntDay(c, sq, { tier: 'Heroic', boss: k, seed: hash('lab-weak', k, a, inv, i) }).net); V[vk][k][a][inv] = mean(v); } } }
  }
  const rel = (vk, k, a) => mean(['casual', 'active'].map((inv) => V[vk][k][a][inv] / median(ARCH.map((o) => V[vk][k][o][inv]))));
  const rank = (vk, k, a) => 1 + ARCH.filter((o) => rel(vk, k, o) > rel(vk, k, a)).length;
  const gain = (vk, k, a) => mean(['casual', 'active'].map((inv) => V[vk][k][a][inv] / V.none[k][a][inv]));
  const rows = []; const sum = Object.fromEntries(WEAK_X.map((x) => [x, { g: [], inBand: 0, up: [], top3: 0 }]));
  for (const k of BK) {
    const fav = FAVORED[k], role = weakRoleOf(cfg.v2_bosses[k]); const r0 = rank('none', k, fav);
    const cells = WEAK_X.map((x) => { const g = gain(`x${x}`, k, fav), r = rank(`x${x}`, k, fav); const S2 = sum[x];
      if (!cfg.v2_enemy.weak_role_rules?.[role]) { S2.g.push(g); if (g >= 1.1 && g <= 1.2) S2.inBand++; S2.up.push(r0 - r); if (r <= 3) S2.top3++; }
      return `x${g.toFixed(2)}, #${r0} to #${r}`; });
    const others = WEAK_X.map((x) => median(ARCH.filter((a) => a !== fav).map((a) => gain(`x${x}`, k, a))));
    rows.push([cfg.v2_bosses[k].name, `role:${role}${cfg.v2_enemy.weak_role_rules?.[role] ? ' (own rule)' : ''}`, short(fav), ...cells, others.map((g) => `x${g.toFixed(2)}`).join(' / ')]);
  }
  const srows = WEAK_X.map((x) => { const S2 = sum[x]; return [`${x}`, `x${median(S2.g).toFixed(2)}`, `x${Math.min(...S2.g).toFixed(2)} to x${Math.max(...S2.g).toFixed(2)}`, `${S2.inBand} of ${S2.g.length}`, `${median(S2.up)}`, `${S2.top3} of ${S2.g.length}`]; });
  const pick = WEAK_X.find((x) => median(sum[x].g) >= 1.1);
  const wh = [`Weak to: the ${BK.length} named bosses at Heroic with their tag, the ${ARCH.length} archetypes (8 cards, casual and active), ${WRUNS} days a cell, the same seeds for each value; ${((Date.now() - t0) / 1000).toFixed(0)} s.`,
    `Weak to: the favored squad's median gain at weak_role_x ${WEAK_X.map((x) => `${x} x${median(sum[x].g).toFixed(2)}`).join(', ')} (the ${sum[WEAK_X[0]].g.length} bosses with a damage week; the 2 Controller weeks have their own rule). The smallest value with a median gain of x1.10 or more: ${pick ?? 'none'}.`];
  head.push(...wh);
  md += `## 3. Weak to: the size of weak_role_x (decision 5)\n\n${wh.map((h) => `- ${h}`).join('\n')}\n\nGain = the favored squad's net damage with the tag / with no tag (the mean of casual and active). Rank = its place among the 11 squads (field-relative score), with no tag to with the tag. Others = the median gain of the 10 other squads.\n\n`;
  md += table(['weak_role_x', 'median gain (favored)', 'range', 'gain in x1.10-x1.20', 'median rank gain', 'favored in the top 3'], srows) + '\n';
  md += table(['boss', 'Weak to', 'favored', ...WEAK_X.map((x) => `x = ${x}: gain, rank`), `others ${WEAK_X.join(' / ')}`], rows) + '\n';
}

// ---------------------------------------------------------------------------------------------------------------- 4. the Warlord's own Ironhide
if (!BEFORE && (!ONLY || ONLY === 'warlord')) {
  const t0 = Date.now(); const W = cfg.v2_bosses.warlord;
  const variant = (params, sig) => { const c = JSON.parse(JSON.stringify(cfg)); c.v2_bosses.warlord.params = params; c.v2_bosses.warlord.sig = sig; return c; };
  const own = W.params?.ironhide?.crit_x;
  const V = { after: cfg, before: variant({}, W.sig), none: variant({}, W.sig.filter((m) => m !== 'ironhide')) };
  const D = {};
  for (const [vk, c] of Object.entries(V)) { D[vk] = {};
    for (const a of ARCH) { D[vk][a] = {};
      for (const inv of ['casual', 'active']) { const sq = huntSquad(c, a, inv); const v = []; for (let i = 0; i < WRUNS; i++) v.push(huntDay(c, sq, { tier: 'Heroic', boss: 'warlord', seed: hash('lab-warlord', a, inv, i) }).net); D[vk][a][inv] = mean(v); } } }
  const cut = (vk, a) => mean(['casual', 'active'].map((inv) => D[vk][a][inv] / D.none[a][inv]));
  const rows = []; const res = {};
  for (const vk of ['before', 'after']) {
    const cuts = Object.fromEntries(ARCH.map((a) => [a, cut(vk, a)])); const med = median(Object.values(cuts));
    const lo = ARCH.reduce((w, a) => (cuts[a] < cuts[w] ? a : w), ARCH[0]);
    res[vk] = { cc: cuts['Crit Chain'], rel: cuts['Crit Chain'] / med, med };
    rows.push([vk === 'before' ? `before (global crit_x ${cfg.v2_enemy.mechanics.ironhide.crit_x})` : `after (own crit_x ${own})`, ...ARCH.map((a) => cuts[a].toFixed(2)), `x${med.toFixed(2)}`, `${short(lo)} x${(cuts[lo] / med).toFixed(2)}`]);
  }
  const wh = [`Warlord: the Rage-Quit Warlord at Heroic, ${ARCH.length} archetypes (8 cards, casual and active), ${WRUNS} days a cell, the same seeds for each variant; ${((Date.now() - t0) / 1000).toFixed(0)} s.`,
    `Warlord: Crit Chain cut (net damage / no Ironhide) x${res.before.cc.toFixed(2)} -> x${res.after.cc.toFixed(2)}, field-relative x${res.before.rel.toFixed(2)} -> x${res.after.rel.toFixed(2)}; the median cut x${res.before.med.toFixed(2)} -> x${res.after.med.toFixed(2)}.`];
  head.push(...wh);
  md += `## 4. The Warlord's own Ironhide (the E7 follow-up)\n\n${wh.map((h) => `- ${h}`).join('\n')}\n\nCell = cut: the net damage of a Heroic day on the Warlord / on the Warlord with no Ironhide (the mean of casual and active). rel = cut / the median cut.\n\n`;
  md += table(['variant', ...ARCH.map(short), 'median cut', 'lowest rel'], rows) + '\n';
}

mkdirSync(new URL('../out/lab/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../${OUT}`, import.meta.url), `# Lab E7: the enemy mechanics x the archetypes${BEFORE ? ' (BEFORE: the E7 numbers and rules)' : ''}\n\n${md}`);
for (const h of head) console.log(h);
console.log(`report: card-studio/${OUT}`);
process.exitCode = allDiffs.length ? 1 : 0;
