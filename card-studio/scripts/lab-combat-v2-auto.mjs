import './localdb-guard.mjs';
/**
 * The Combat Lab of PR E8 (plan 14.1 row E8, acceptance "Auto reaches 85% or more of a scripted best play"): Auto v2 on the BUILT functions.
 * LOCAL copy only; every request is one DO block, undone by its final RAISE (nothing is kept).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/lab-combat-v2-auto.mjs [--runs N] [--sql N] [--seed S] [--out file.md]
 * 1. THE TABLES (the simulator with the numbers of the database: balance auto_v2, roles.auto and every v2 key): v2sim auto.mjs autoLab: the fight (each
 *    archetype of plan 7.4, Hunt and Dungeon, Auto v2 / the scripted best play), the Hunt pick (the auto-pick + Auto v2 / a searched squad + the scripted
 *    best play, the 16 named bosses) and the 20 designed teams with the private Set 1 actives (aggregates only, when the private file is there).
 * 2. SQL = THE SIMULATOR ON THE LAB FIGHTS: --sql fights (default 4) of each archetype in each mode (the Hunt: the Heroic tier boss from the builder
 *    combat_v2_hunt_boss, 8 cards; the Dungeon: the floor 5 guardian, the 5 cards of dngPick), played in SQL by combat_v2_auto + combat_v2_card_act with
 *    ONE draw list a fight, and in the simulator by the policy autov2 with the same draws: the result, the steps, every HP and the number of actives.
 * 3. SQL = THE SIMULATOR ON THE LAB PICKS: combat_v2_autopick on every pool of table 2 = autoPick (the ids in order).
 * The tables go to card-studio/out/lab/combat-v2-auto.md (not committed); the head lines print.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { runBlock as runBlock1, assertLocal, sqlLit } from './lab-lib.mjs';
import { Battle } from '../v2sim/engine.mjs';
import { makeCard, cardPool } from '../v2sim/cards.mjs';
import { makeFoe, makeBoss, bossKeys } from '../v2sim/modes.mjs';
import { POLICIES } from '../v2sim/policy.mjs';
import { ARCHETYPES, dngPick } from '../v2sim/experiments.mjs';
import { autoLab, autoPick, poolEntry, pickBoss } from '../v2sim/auto.mjs';
import { loadConfig, patch, mkRng, hash } from '../v2sim/util.mjs';
assertLocal('lab-combat-v2-auto.mjs');
const runBlock = async (sql) => { for (let k = 0; ; k++) { try { return await runBlock1(sql); } catch (e) { if (k >= 4 || !/deadlock detected/.test(e.message)) throw e; } } };

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg('runs', 300)), SQLN = Number(arg('sql', 4)), SEED = Number(arg('seed', 1)), OUT = arg('out', 'out/lab/combat-v2-auto.md');
const rd = (f) => readFileSync(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const MIG = ['combat_v2_monsters.sql', 'combat_v2_monster_tuning.sql', 'combat_v2_e7_followup.sql', 'combat_v2_auto.sql'].map((f) => `execute $m$${rd(f)}$m$;`).join('\n');

// the numbers of the database (the balance values replace config.json), the Auto numbers and the role hints
const N = JSON.parse(await runBlock(String.raw`do $t$ begin ${MIG} raise exception 'RESULT:%', jsonb_build_object('b', combat_v2_enemy_numbers(), 'ab', ability_v2_numbers(),
  'auto', (select value from balance where key = 'auto_v2'), 'roles', (select jsonb_object_agg(r.key, r.auto) from public.roles r))::text; end $t$;`));
const B = { ...N.b }; delete B.enemy_v2;
const cfg = patch(loadConfig(), { ...B, v2_pp: N.ab.v2_pp }); cfg.ability_v2 = JSON.parse(JSON.stringify(N.ab.ability_v2));
cfg.auto_v2 = N.auto; cfg.v2_role_auto = N.roles;
const head = []; let md = '';

// ---------------------------------------------------------------------------------------------------------------- 1. the tables
const t0 = Date.now();
const L = autoLab(cfg, { runs: RUNS, seed: SEED });
head.push(...L.head, `The tables: the simulator with the numbers of the database, ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
md += L.md.replace(/^# [^\n]*\n/, '');

// ---------------------------------------------------------------------------------------------------------------- 2. SQL = the simulator on the Lab fights
const DRAWS = 5000;
const inv = cfg.v2_investment.casual;
const mk = (t) => makeCard(cfg, { key: t, role: t.split('.')[0], rarity: 'normal', template: t, ...inv });
function cardsOf(sq, meters) {
  return Object.fromEntries(sq.map((c, k) => [String(k + 1), {
    role: c.role, class: c.cls, atk: c.cp, crt: c.crit, crd: c.critx, abl: c.abl, acc: c.acc, def: c.def, ddg: c.ddg, max: c.maxHp, hp: c.maxHp, down: false,
    speed: c.speedBase, spd: c.points.spd || 0, power: c.power, extra_stack: cfg.v2_support.enabler_extra_stack.includes(c.rarity) ? 1 : 0,
    meter: meters[k], charge: 0, held: 0, status: {}, active: { blocks: cfg.v2_templates[c.active.id].blocks } }]));
}
function simRun(sp, mode, enemy) {
  const cards = sp.sq.map((c) => ({ ...c, hp: c.maxHp, shield: 0, active: { ...c.active, charge: cfg.v2_charge[c.cls] } })); // SQL charges by class (v2_charge)
  const b = new Battle(cfg, { cards, enemies: [enemy], mode, policy: POLICIES.autov2, seed: 1 });
  let qi = 0; const take = () => { if (qi >= sp.draws.length) throw new Error('out of draws'); return sp.draws[qi++]; };
  b.units.forEach((u, k) => { u.rng = take; u.meter = sp.meters[k]; });
  let nearTie = false;
  b.speedOf = function (u) { const s2 = Battle.prototype.speedOf.call(this, u); const m = u.meter + s2; if (!u.down && m >= 50 && Math.abs(m - 100 * Math.round(m / 100)) < 1e-6) nearTie = true; return s2; };
  const act0 = Battle.prototype.act;
  b.act = function (u) {
    const top = this.units.filter((x) => !x.down).map((x) => x.meter + (x === u ? 100 : 0)).filter((m) => m >= 100 - 1e-6).sort((p, q) => q - p);
    if (top.length > 1 && top[0] - top[1] < 1e-6) nearTie = true;
    return act0.call(this, u);
  };
  b.run();
  return { won: b.ended === 'won', steps: b.step, nearTie, actives: b.S.actives, hp: [...b.cards.map((c) => (c.down ? 0 : c.hp)), Math.max(0, b.enemies[0].hp)] };
}
const DRIVER = String.raw`
  create or replace function pg_temp.labauto(p_s jsonb, p_d jsonb, p_b jsonb) returns jsonb language plpgsql as $x$
  declare s jsonb := p_s; d jsonb := p_d; r jsonb; a jsonb; dec jsonb; ev text; nact int := 0;
  begin
    loop
      r := combat_v2_next(s, d, p_b); s := r->'state'; d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws')); ev := r->>'event';
      exit when ev <> 'act';
      continue when (r->>'skip')::boolean;
      if r->'actor'->>'side' = 'card' then
        dec := combat_v2_auto(s, r->'actor', p_b, null);
        a := combat_v2_card_act(s, r->'actor', jsonb_build_object('use', dec->'use', 'target', dec->'target', 'ally', dec->'ally', 'draws', d), p_b);
        if a->>'action' = 'active' then nact := nact + 1; end if;
      else
        a := combat_v2_enemy_act(s, r->'actor', jsonb_build_object('draws', d), p_b);
      end if;
      s := a->'state'; d := combat_v2_draws_rest(d, jsonb_array_length(a->'draws'));
    end loop;
    return jsonb_build_object('end', ev, 'steps', s->'clock', 'actives', nact, 'won', ev = 'end' and exists (select 1 from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id)),
      'hp', (select jsonb_agg(case when combat_v2_up(s #> case when q.side = 'card' then array['cards', q.id] else array['enemies', q.id] end)
                                   then (s #> case when q.side = 'card' then array['cards', q.id] else array['enemies', q.id] end)->'hp' else '0'::jsonb end order by q.n) from combat_v2_units(s) q));
  end $x$;`;
const t1 = Date.now();
const specs = [];
for (const a of Object.keys(ARCHETYPES)) for (const mode of ['hunt', 'dungeon']) for (let i = 0; i < SQLN; i++) {
  const rng = mkRng(hash(SEED, 'lab-e8-sql', a, mode, i));
  const draws = Array.from({ length: DRAWS }, () => Math.floor(rng() * 1e6) / 1e6);
  const sq = (mode === 'hunt' ? ARCHETYPES[a].hunt : dngPick(ARCHETYPES[a].hunt)).map(mk);
  const meters = [...sq, null].map(() => Math.floor(rng() * 9999) / 100);
  const start = Math.round((0.3 + 0.7 * rng()) * 1000) / 1000;
  specs.push({ a, mode, i, sq, draws, meters, start, foe: mode === 'dungeon' ? makeFoe(cfg, 5, cfg.v2_dungeon.rooms, 'guardian', mkRng(hash(SEED, 'lab-e8-foe', a, i))) : null });
}
const stateOf = (sp) => {
  const st = { v: 2, mode: sp.mode, round: 0, clock: 0, squad: sp.sq.map((_, k) => k + 1), cards: cardsOf(sp.sq, sp.meters), enemies: [], marks: {}, facts: { passives: [], cards: {} }, ext: {} };
  if (sp.foe) {
    const u = new Battle(cfg, { cards: [], enemies: [sp.foe], mode: 'dungeon', policy: POLICIES.autov2, seed: 1 }).enemies[0];
    st.enemies = [{ hp: u.maxHp, max: u.maxHp, down: false, atk: u.atk, def: u.def, evasion: u.evasion, resolve: u.resolve, keen: u.keen, speed: u.speedBase, meter: sp.meters[sp.sq.length],
      charge: 0, status: {}, turn: 0, mechanics: [...u.mech], moves: sp.foe.moves.map(([k, w]) => ({ k, w })), cataclysm: !!sp.foe.cataclysm, healer: !!sp.foe.healer, ...(u.brood ? { brood: u.brood } : {}) }];
  }
  return st;
};
let same = 0, ties = 0, n = 0, act = 0; const diffs = [];
for (let i = 0; i < specs.length; i += 12) {
  const part = specs.slice(i, i + 12);
  const out = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; s jsonb; begin
    ${MIG}
    ${DRIVER}
    b := combat_v2_enemy_numbers();
    for x in select v from jsonb_array_elements(${sqlLit(part.map((sp) => [stateOf(sp), sp.draws, sp.mode === 'hunt' ? ['Heroic', { sigs: [], start_frac: sp.start, meter: sp.meters[sp.sq.length] }] : null]))}::jsonb) v loop
      begin
        s := x->0;
        if jsonb_typeof(x->2) = 'array' then s := jsonb_set(s, '{enemies}', jsonb_build_array(combat_v2_hunt_boss(x->2->>0, null, x->2->1, b))); end if;
        out := out || jsonb_build_array(pg_temp.labauto(s, x->1, b));
      exception when others then out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
    end loop;
    raise exception 'RESULT:%', out::text; end $t$;`));
  out.forEach((q, j) => {
    const sp = part[j]; n++;
    if (q.error) { diffs.push(`${sp.a} ${sp.mode} #${sp.i}: SQL error ${q.error}`); return; }
    const s = simRun(sp, sp.mode, sp.mode === 'hunt' ? makeBoss(cfg, 'Heroic', { sigs: [], startFrac: sp.start }) : sp.foe);
    act += Number(q.actives);
    const eq = s.won === q.won && s.steps === Number(q.steps) && s.actives === Number(q.actives) && s.hp.length === q.hp.length && s.hp.every((h, k) => Math.abs(h - Number(q.hp[k])) <= 1e-6 * Math.max(1, h));
    if (eq) same++; else if (s.nearTie) ties++; else if (diffs.length < 8) diffs.push(`${sp.a} ${sp.mode} #${sp.i}: SQL ${q.won}/${q.steps}/${q.actives} actives, sim ${s.won}/${s.steps}/${s.actives}`);
  });
}
const h2 = `SQL = the simulator on the Lab fights: ${n} fights (${SQLN} for each archetype and mode) played by combat_v2_auto in SQL and by autov2 in the simulator with the same draws: ${same} equal (result, steps, every HP, ${act} actives), ${ties} differ only after a float near-tie, ${((Date.now() - t1) / 1000).toFixed(0)} s.${diffs.length ? ` DIFFERENT: ${diffs.join(' | ')}` : ''}`;
head.push(h2);
md += `\n## 4. SQL = the simulator (the built functions)\n\n- ${h2}\n`;

// ---------------------------------------------------------------------------------------------------------------- 3. SQL = the simulator on the Lab picks
const pool0 = cardPool(cfg).filter((p) => p.pullable.length);
const items = []; const want = [];
for (const key of bossKeys(cfg)) for (let pi = 0; pi < 2; pi++) {
  const rng = mkRng(hash(SEED, 'pick-pool', key, pi)); const used = new Set(); const pool = [];
  while (pool.length < 20) {
    const s = pool0[Math.floor(rng() * pool0.length)]; if (used.has(s.key)) continue; used.add(s.key);
    const rar = s.pullable[Math.floor(rng() * s.pullable.length)]; const iv = rng() < 0.5 ? cfg.v2_investment.casual : cfg.v2_investment.active;
    pool.push(poolEntry(makeCard(cfg, { key: s.key, role: s.role, rarity: rar, cp_mod: s.cp_mod, ...iv }), pool.length + 1));
  }
  const boss = pickBoss(cfg, key, 'Heroic');
  items.push({ pool: pool.map(({ card, ...c }) => ({ ...c, blocks: cfg.v2_templates[card.active.id].blocks })), boss, cap: 8 });
  want.push(autoPick(cfg, pool, boss, 8).ids);
}
const got = JSON.parse(await runBlock(String.raw`do $t$ declare out jsonb := '[]'; x jsonb; b jsonb; begin
  ${MIG}
  b := combat_v2_enemy_numbers();
  for x in select v from jsonb_array_elements(${sqlLit(items)}::jsonb) v loop
    begin out := out || jsonb_build_array(combat_v2_autopick(x->'pool', x->'boss', (x->>'cap')::int, b, null)->'ids');
    exception when others then out := out || jsonb_build_array(jsonb_build_object('error', sqlerrm)); end;
  end loop;
  raise exception 'RESULT:%', out::text; end $t$;`));
const pbad = want.map((w, i) => (JSON.stringify(w) === JSON.stringify(got[i]) ? null : `pool ${i}: SQL ${JSON.stringify(got[i])} sim ${JSON.stringify(w)}`)).filter(Boolean);
const h3 = `SQL = the simulator on the Lab picks: ${want.length - pbad.length} of ${want.length} pools give the same squad in the same order (combat_v2_autopick = autoPick).${pbad.length ? ` DIFFERENT: ${pbad.slice(0, 4).join(' | ')}` : ''}`;
head.push(h3);
md += `- ${h3}\n`;

mkdirSync(new URL('../out/lab/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../${OUT}`, import.meta.url), `# Combat Lab: Auto v2 (PR E8)\n\n${head.map((x) => `- ${x}`).join('\n')}\n\n${md}\n---\nRun: \`node scripts/lab-combat-v2-auto.mjs --runs ${RUNS} --sql ${SQLN} --seed ${SEED}\`.\n`);
for (const x of head) console.log(`- ${x}`);
console.log(`-> card-studio/${OUT}`);
process.exitCode = diffs.length || pbad.length ? 1 : 0;
