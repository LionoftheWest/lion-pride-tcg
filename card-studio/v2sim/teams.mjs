// teams.mjs - the "no meta" team test (Nathan 2026-10-18: "I don't want a 'meta' team comp, every team should be strong in its own way").
// node card-studio/v2sim/run.mjs teams [--runs N] [--seed S] [--patch json] [--tag name]
//
// 20 fixed teams (teams.json: card keys only) play with the 130 approved Set 1 actives (the PRIVATE file set1-actives.json, see ACTIVES_PATH) at Normal rarity:
//   Hunt (8 cards, Heroic, a neutral boss and each of the 16 named bosses of v2_bosses), the Dungeon (5 cards: a full run,
//   a horde room, a guardian room, and the guardian with the mechanics of each named boss), at the casual and active investment,
//   and the Gauntlet (the 5 cards at 0 stars, level 0). Every team meets the same seeds (common random numbers).
// Score of a content: Hunt = net damage a day. Run = floors cleared. Gauntlet = floors cleared.
//   Room = 1 + share of the step cap left when the squad wins, else the share of foe HP removed (0..2, higher is better).
// rel = score / the median of the 20 teams in that content. The no-meta checks read only the matrix (noMetaChecks).
// A what-if on one card: --patch '{"v2_templates":{"s1.kroc-bot":{"role":"striker","name":"x","blocks":[...]}}}'.
// PROTOTYPE ESTIMATES: see the approximations in the private actives file ("approx") and the report.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeCard, classOf, ROLES } from './cards.mjs';
import { huntDay, dungeonRun, gauntletRun, makeFoe, setFoeMech, bossKeys, bossMechs } from './modes.mjs';
import { Battle } from './engine.mjs';
import { POLICIES } from './policy.mjs';
import { HERE, loadFixture, mkRng, hash, mean, median, table, fmt, pct, ratio } from './util.mjs';
import { CLEAR_THRESHOLD } from './targets.mjs';

export const BAND = [0.8, 1.2];        // (d) overall average / median of the teams
export const WEAK_X = 0.8;             // (b) some content (a mode, a room kind or a counter) drops the team below 0.8 of its own overall average
export const TOP_N = 5, MAX_FIRSTS = 2; // (a) top 5 somewhere, (c) #1 in at most 2 headline contents
export const ROOMS = { casual: { horde: 6, guardian: 7 }, active: { horde: 9, guardian: 9 } }; // room floors: the median team wins about 65-90%
export const WALL = 0.25;              // a counter content whose median is below 25% of its base median cuts EVERY team: a wall, not a weakness (b skips it)
const INVS = ['casual', 'active'];

export const loadTeams = () => JSON.parse(readFileSync(join(HERE, 'teams.json'), 'utf8')).teams;
// The approved Set 1 actives are UNRELEASED card designs: they stay in the PRIVATE notes folder, never in this public repo (Nathan 2026-10-18).
// Path: env V2SIM_ACTIVES, else the local default <repo parent>/discord-card-ideas/set1-actives.json (the private folder beside the repo).
export const ACTIVES_PATH = () => process.env.V2SIM_ACTIVES || join(HERE, '..', '..', '..', 'discord-card-ideas', 'set1-actives.json');
export const hasSet1 = () => existsSync(ACTIVES_PATH());
export function loadSet1() {
  const p = ACTIVES_PATH();
  if (!existsSync(p)) throw new Error(`teams: the private Set 1 actives file is missing (${p}). Set V2SIM_ACTIVES to its path. It is private: never commit it to this repo.`);
  return JSON.parse(readFileSync(p, 'utf8')).cards;
}

// The Set 1 batch (PR T1: the 130 actives as ability_v2 rows, the 20 approximations rebuilt with the T1 blocks; the file that push-abilities.mjs pushes).
// PRIVATE too. Path: env V2SIM_SET1_BATCH, else <repo parent>/discord-card-ideas/batches/set1-t1.json. Returns the shape of loadSet1: {key: {role, active, blocks}}.
export const SET1_BATCH_PATH = () => process.env.V2SIM_SET1_BATCH || join(HERE, '..', '..', '..', 'discord-card-ideas', 'batches', 'set1-t1.json');
export const hasSet1Batch = () => existsSync(SET1_BATCH_PATH());
export function set1FromRows(rows) {
  const out = {};
  for (const r of rows) {
    if (!r.key || !r.role || !Array.isArray(r.ability?.blocks)) throw new Error('teams: a Set 1 batch row needs key, role and ability.blocks');
    if (out[r.key]) throw new Error('teams: a Set 1 batch has a card key twice');
    out[r.key] = { role: r.role, active: r.ability.name, blocks: r.ability.blocks };
  }
  return out;
}
export function loadSet1Batch() {
  const p = SET1_BATCH_PATH();
  if (!existsSync(p)) throw new Error(`teams: the private Set 1 batch is missing (${p}). Set V2SIM_SET1_BATCH to its path. It is private: never commit it to this repo.`);
  return set1FromRows(JSON.parse(readFileSync(p, 'utf8')).rows);
}

// The Set 2 batch (Double Team; lane 3): the same private format, a second file. Path: env V2SIM_SET2_BATCH, else <repo parent>/discord-card-ideas/batches/set2-t1.json.
// Set 2 is not in fixture.json (the live snapshot), so each Set 2 card gets a synthetic subject from the PUBLIC card-studio/cards.json: its name, type, every
// finish except event as a pullable finish (the rule of the Set 1 fixture: 128 of 128 cards with a normal finish match; 2 are event-only), and cp_mod 1 (the Set 1 mean is 1.00; the real value is set when the card is pushed).
export const SET2_BATCH_PATH = () => process.env.V2SIM_SET2_BATCH || join(HERE, '..', '..', '..', 'discord-card-ideas', 'batches', 'set2-t1.json');
export const hasSet2Batch = () => existsSync(SET2_BATCH_PATH());
export const CARDS_PATH = () => process.env.V2SIM_CARDS || join(HERE, '..', 'cards.json');
// The synthetic subject of a Set 2 card (an object, so that a test can plant a fault in it).
export const SET2 = { subject: (c) => ({ name: c.name, type: c.type, cp_mod: 1, finishes: c.finishes.filter((f) => f !== 'event').map((f) => ({ rarity: f, pool: true })) }) };
export function loadSet2Batch(cardsPath = CARDS_PATH()) {
  const p = SET2_BATCH_PATH();
  if (!existsSync(p)) throw new Error(`teams: the private Set 2 batch is missing (${p}). Set V2SIM_SET2_BATCH to its path. It is private: never commit it to this repo.`);
  const S = set1FromRows(JSON.parse(readFileSync(p, 'utf8')).rows);
  const byId = new Map(JSON.parse(readFileSync(cardsPath, 'utf8')).filter((c) => c.set === 'S2').map((c) => [c.id, c]));
  for (const [k, a] of Object.entries(S)) {
    const c = byId.get(k);
    if (!c) throw new Error('teams: a Set 2 batch row is not a Set 2 card of cards.json');
    a.set = 2; a.subject = SET2.subject(c);
  }
  return S;
}
/** The batch map of a run: Set 1, or Set 1 + Set 2 together (set2 true). A key in both sets is an error. */
export function loadSets({ set2 = false } = {}) {
  const S1 = loadSet1Batch(); if (!set2) return S1;
  const S2 = loadSet2Batch(); const dup = Object.keys(S2).filter((k) => S1[k]);
  if (dup.length) throw new Error(`teams: ${dup.length} card keys are in both batches`);
  return { ...S1, ...S2 };
}
/** The rows of the batch files of a run and the path of the batch that holds the factors file beside it (the Set 2 file when Set 2 is in). */
export function loadSetRows({ set2 = false } = {}) {
  const r1 = JSON.parse(readFileSync(SET1_BATCH_PATH(), 'utf8')).rows;
  return set2 ? { rows: [...r1, ...JSON.parse(readFileSync(SET2_BATCH_PATH(), 'utf8')).rows], path: SET2_BATCH_PATH() } : { rows: r1, path: SET1_BATCH_PATH() };
}

// The config with every Set 1 active as template "s1.<card key>". A template that the config already has (a --patch what-if) wins.
export function withSet1(cfg, set1 = loadSet1()) {
  const out = { ...cfg, v2_templates: { ...cfg.v2_templates } };
  out.v2_s1_subjects = {};
  for (const [k, a] of Object.entries(set1)) {
    // + pick_factor: the measured active factor of the Hunt auto-pick (plan 20.10), when the Lab loaded the private factors file (active.mjs)
    if (!out.v2_templates[`s1.${k}`]) out.v2_templates[`s1.${k}`] = { role: a.role, name: a.active, blocks: a.blocks, ...(typeof a.pick_factor === 'number' ? { pick_factor: a.pick_factor } : {}) };
    if (a.subject) out.v2_s1_subjects[k] = { key: k, ...a.subject }; // a synthetic card (the test fixture): its own name, cp_mod and finishes
  }
  return out;
}
// Card specs for one team version. Normal rarity (the team test compares teams, not rarities). An event-only card uses its own finish.
export function teamSpecs(cfg, keys, inv = {}) {
  const subj = subjects(cfg);
  return keys.map(k => {
    const s = subj.get(k), t = cfg.v2_templates[`s1.${k}`];
    if (!s || !t) throw new Error(`teamSpecs: unknown card ${k}`);
    const rar = s.finishes.some(f => f.rarity === 'normal') ? 'normal' : s.finishes[0].rarity;
    return { key: k, name: s.name, role: t.role, cp_mod: s.cp_mod, rarity: rar === 'event' ? 'full_art' : rar, template: `s1.${k}`, stars: inv.stars || 0, level: inv.level || 0 };
  });
}
export const subjects = cfg => new Map([...loadFixture().subjects.map(s => [s.key, s]), ...Object.entries(cfg.v2_s1_subjects || {})]);
export const isCommon = s => !s.finishes.some(f => ['full_art', 'gold', 'event'].includes(f.rarity));

// ---------- contents ----------
export function contents(cfg) {
  // The counter contents are the 16 named Hunt bosses (Nathan 2026-10-19): the Hunt day vs the boss, and the Dungeon guardian with its mechanics.
  const M = bossKeys(cfg), head = [], counter = [];
  for (const inv of INVS) head.push({ id: `hunt|${inv}`, mode: 'hunt', inv, label: `Hunt ${inv}` });
  for (const inv of INVS) head.push({ id: `run|${inv}`, mode: 'dungeon', inv, label: `Dungeon run ${inv}` });
  for (const inv of INVS) head.push({ id: `horde|${inv}`, mode: 'dungeon', inv, label: `Horde F${ROOMS[inv].horde} ${inv}` });
  for (const inv of INVS) head.push({ id: `guard|${inv}`, mode: 'dungeon', inv, label: `Guardian F${ROOMS[inv].guardian} ${inv}` });
  head.push({ id: 'gauntlet', mode: 'gauntlet', inv: 'none', label: 'Gauntlet' });
  for (const inv of INVS) for (const m of M) {
    const nm = cfg.v2_bosses[m].name.replace(/^The /, '');
    counter.push({ id: `hunt|${inv}|${m}`, mode: 'hunt', inv, mech: m, base: `hunt|${inv}`, label: `Hunt ${inv} vs ${nm}` });
    counter.push({ id: `guard|${inv}|${m}`, mode: 'dungeon', inv, mech: m, base: `guard|${inv}`, label: `Guardian ${inv} vs ${nm}` });
  }
  return { head, counter, mechs: M };
}

// N = null (no mechanic) or bossMechs(...) (the mechanics, resists and params of a named boss).
export function room(cfg, squad, kind, floor, N, runs, seed) {
  const n = kind === 'horde' ? 4 : 1; let s = 0, won = 0;
  for (let i = 0; i < runs; i++) {
    const rng = mkRng(hash(seed, 'room', kind, floor, i));
    const foes = Array.from({ length: n }, () => setFoeMech(makeFoe(cfg, floor, kind === 'horde' ? 3 : 5, kind, rng), N ? N.mech : [], N ? { resists: N.resists, params: N.params } : {}));
    const tot = foes.reduce((a, f) => a + f.maxHp, 0);
    const b = new Battle(cfg, { cards: squad.map(c => ({ ...c, hp: c.maxHp, shield: 0 })), enemies: foes, mode: 'dungeon', policy: POLICIES.best, seed: hash(seed, 'room', kind, i) }).run();
    if (b.ended === 'won') { won++; s += 1 + (b.cap - b.step) / b.cap; }
    else s += 1 - b.enemies.reduce((a, e) => a + Math.max(0, e.hp), 0) / tot;
  }
  return { score: s / runs, win: won / runs };
}

// One team in every content. Returns { [content id]: { score, ...detail } }.
export function measureTeam(cfg, team, C, { runs = 200, seed = 1 } = {}) {
  const out = {};
  for (const inv of INVS) {
    const I = cfg.v2_investment[inv];
    const hSq = teamSpecs(cfg, team.hunt, I).map(s => makeCard(cfg, s)), dSq = teamSpecs(cfg, team.dungeon, I).map(s => makeCard(cfg, s));
    const hunt = boss => { const v = []; for (let i = 0; i < runs; i++) v.push(huntDay(cfg, hSq, { tier: 'Heroic', sigs: [], boss: boss || undefined, seed: hash(seed, 'teams-hunt', inv, i) }).net); return { score: mean(v) }; };
    out[`hunt|${inv}`] = hunt(null);
    for (const m of C.mechs) out[`hunt|${inv}|${m}`] = hunt(m);
    const fl = []; for (let i = 0; i < runs; i++) fl.push(dungeonRun(cfg, dSq, { seed: hash(seed, 'teams-run', inv, i) }).floor);
    out[`run|${inv}`] = { score: mean(fl), clear3: fl.filter(f => f >= 3).length / runs, clear5: fl.filter(f => f >= 5).length / runs };
    out[`horde|${inv}`] = room(cfg, dSq, 'horde', ROOMS[inv].horde, null, runs, hash(seed, inv));
    out[`guard|${inv}`] = room(cfg, dSq, 'guardian', ROOMS[inv].guardian, null, runs, hash(seed, inv));
    for (const m of C.mechs) out[`guard|${inv}|${m}`] = room(cfg, dSq, 'guardian', ROOMS[inv].guardian, bossMechs(cfg, m, 'Heroic'), runs, hash(seed, inv));
  }
  const gs = teamSpecs(cfg, team.dungeon); const gf = [];
  for (let i = 0; i < runs; i++) gf.push(gauntletRun(cfg, gs, {}, { seed: hash(seed, 'teams-gauntlet', i) }).floor);
  out.gauntlet = { score: mean(gf) };
  return out;
}

// ---------- the no-meta checks (pure: they read only the score matrix) ----------
// S = { [team id]: { [content id]: { score } } }, C = contents(cfg), casual = [team ids], clear3 = { [team id]: share }.
// specialists = designed specialist teams (teams.json "specialist"): check d skips them (Nathan 2026-10-19, Field Hospital).
export function noMetaChecks(S, C, { casual = [], clear3 = {}, specialists = [] } = {}) {
  const T = Object.keys(S), all = [...C.head, ...C.counter];
  const rel = {}; for (const t of T) rel[t] = {};
  const rank = {}; for (const t of T) rank[t] = {};
  for (const c of all) {
    const m = median(T.map(t => S[t][c.id].score)) || 1e-9;
    for (const t of T) rel[t][c.id] = S[t][c.id].score / m;
    const order = [...T].sort((a, b) => S[b][c.id].score - S[a][c.id].score);
    for (const t of T) rank[t][c.id] = 1 + order.filter(o => S[o][c.id].score > S[t][c.id].score).length;
  }
  const walls = C.counter.filter(c => median(T.map(t => S[t][c.id].score)) < WALL * median(T.map(t => S[t][c.base].score)));
  const real = all.filter(c => !walls.includes(c)), counters = C.counter.filter(c => !walls.includes(c));
  const modeAvg = (t, mode) => mean(C.head.filter(c => c.mode === mode).map(c => rel[t][c.id]));
  const overall = {}; for (const t of T) overall[t] = mean(['hunt', 'dungeon', 'gauntlet'].map(m => modeAvg(t, m)));
  const medO = median(Object.values(overall));
  const per = {};
  for (const t of T) {
    const best = real.reduce((b, c) => (!b || rank[t][c.id] < rank[t][b.id] || (rank[t][c.id] === rank[t][b.id] && rel[t][c.id] > rel[t][b.id]) ? c : b), null);
    const bestHead = C.head.reduce((b, c) => (!b || rank[t][c.id] < rank[t][b.id] ? c : b), null);
    const w = counters.map(c => ({ c, w: rel[t][c.id] / rel[t][c.base], raw: S[t][c.id].score / S[t][c.base].score })).sort((a, b) => a.w - b.w);
    const low = real.map(c => ({ c, x: rel[t][c.id] / overall[t] })).sort((a, b) => a.x - b.x);
    const firsts = C.head.filter(c => rank[t][c.id] === 1).map(c => c.id);
    per[t] = { best, bestRank: rank[t][best.id], bestHead, bestHeadRank: rank[t][bestHead.id], weak: w[0], weakList: w.slice(0, 3), low: low[0], lowList: low.slice(0, 3), firsts,
      overall: overall[t], vsMedian: overall[t] / medO, modes: { hunt: modeAvg(t, 'hunt'), dungeon: modeAvg(t, 'dungeon'), gauntlet: modeAvg(t, 'gauntlet') } };
  }
  const res = (id, what, fails, detail) => ({ id, what, ok: !fails.length, fails, detail });
  const checks = [
    res('a', `strong somewhere: every team is in the top ${TOP_N} of at least one content (mode or enemy type)`, T.filter(t => per[t].bestRank > TOP_N), T.map(t => `${t} #${per[t].bestRank} ${per[t].best.id}`)),
    res('b', `has a weakness: every team has a content (a mode, a room kind or a counter) where its relative score is below x${WEAK_X} of its own overall average`, T.filter(t => per[t].low.x >= WEAK_X), T.map(t => `${t} ${ratio(per[t].low.x)} ${per[t].low.c.id}`)),
    res('c', `not best everywhere: no team is #1 in more than ${MAX_FIRSTS} of the ${C.head.length} headline contents`, T.filter(t => per[t].firsts.length > MAX_FIRSTS), T.filter(t => per[t].firsts.length).map(t => `${t} ${per[t].firsts.length}`)),
    res('d', `balanced: every overall average within x${BAND[0]}-x${BAND[1]} of the median team (designed specialists skipped)`, T.filter(t => !specialists.includes(t) && (per[t].vsMedian < BAND[0] || per[t].vsMedian > BAND[1])), T.map(t => `${t} ${ratio(per[t].vsMedian)}${specialists.includes(t) ? ' (specialist, skipped)' : ''}`)),
    res('e', `casual-friendly teams clear Dungeon floor 3 at casual investment in ${pct(CLEAR_THRESHOLD, 0)} of runs`, casual.filter(t => !(clear3[t] >= CLEAR_THRESHOLD)), casual.map(t => `${t} ${pct(clear3[t] ?? NaN, 0)}`)),
  ];
  return { rel, rank, per, checks, medianOverall: medO, walls };
}

// ---------- the experiment ----------
export function teams(cfg0, { runs = 200, seed = 1, teamList, actives } = {}) {
  const A = actives || loadSet1(); const cfg = withSet1(cfg0, A); const TM = teamList || loadTeams(); const C = contents(cfg);
  const subj = subjects(cfg);
  const S = {}, clear3 = {}, autoClear3 = {};
  for (const t of TM) {
    S[t.id] = measureTeam(cfg, t, C, { runs, seed }); clear3[t.id] = S[t.id]['run|casual'].clear3;
    if (t.casual) { const sq = teamSpecs(cfg, t.dungeon, cfg.v2_investment.casual).map(s => makeCard(cfg, s)); let n = 0;
      for (let i = 0; i < runs; i++) if (dungeonRun(cfg, sq, { seed: hash(seed, 'teams-run', 'casual', i), policy: 'auto' }).floor >= 3) n++; autoClear3[t.id] = n / runs; }
  }
  const casual = TM.filter(t => t.casual).map(t => t.id);
  const specialists = TM.filter(t => t.specialist).map(t => t.id);
  const R = noMetaChecks(S, C, { casual, clear3, specialists });
  const nm = k => subj.get(k)?.name ?? k, byId = Object.fromEntries(TM.map(t => [t.id, t]));
  const shape = keys => { const a = keys.filter(k => classOf(cfg.v2_templates[`s1.${k}`].role) === 'attacker').length; return `${a}A+${keys.length - a}S`; };

  // card usage and meta risk
  const use = {}; for (const t of TM) for (const k of new Set([...t.hunt, ...t.dungeon])) (use[k] ||= []).push(t.id);
  const topTeams = Object.entries(R.per).sort((a, b) => b[1].overall - a[1].overall).slice(0, 5).map(([t]) => t);
  const metaCards = Object.entries(use).map(([k, ts]) => ({ k, n: ts.length, top: ts.filter(t => topTeams.includes(t)).length, avg: mean(ts.map(t => R.per[t].vsMedian)) }))
    .filter(x => x.n >= 2).sort((a, b) => b.top - a.top || b.avg - a.avg);

  let md = `# Team test: 20 teams, no meta\n\n**Prototype estimates** from a simplified model (no weakness, element, set synergy, block or boons). Use them for direction. Verify each decision in the Combat Lab.\n\n`;
  md += `${TM.length} teams (teams.json) with the approved Set 1 actives (private file, ${Object.keys(A).length} cards), Normal rarity, policy best. ${runs} runs a cell, seed ${seed}, the same seeds for every team.\n`;
  md += `Investment: casual ${cfg.v2_investment.casual.stars}* level ${cfg.v2_investment.casual.level}, active ${cfg.v2_investment.active.stars}* level ${cfg.v2_investment.active.level}. Gauntlet: the 5 Dungeon cards at 0 stars, level 0, ${cfg.v2_gauntlet.floors} floors.\n`;
  md += `Hunt = Heroic boss, net damage a day. Run = floors cleared (of ${cfg.v2_dungeon.floors}). Room = 1 + share of the step cap left on a win, else the share of foe HP removed. Horde = 4 foes, guardian = 1 foe, no random passive. A counter content = one of the ${C.mechs.length} named Hunt bosses (Heroic): the Hunt day vs that boss, and the guardian with its resists and rules.\n`;
  md += `Relative score = the team / the median of the ${TM.length} teams in that content.\n\n`;

  md += `## The no-meta checks\n\n` + table(['check', 'what', 'result', 'failing teams'], R.checks.map(c => [c.id, c.what, c.ok ? 'PASS' : 'FAIL', c.fails.join(', ') || '-']));
  const H = C.head;
  md += `\n## Team x content matrix (relative score; **bold** = #1, (n) = rank in the top ${TOP_N})\n\n`;
  md += table(['team', 'shape H / D', ...H.map(c => c.label), 'Hunt avg', 'Dungeon avg', 'overall / median'], TM.map(t => {
    const p = R.per[t.id];
    return [t.name + (t.casual ? ' (casual)' : ''), `${shape(t.hunt)} / ${shape(t.dungeon)}`, ...H.map(c => { const r = R.rank[t.id][c.id], v = fmt(R.rel[t.id][c.id], 2); return r === 1 ? `**${v}**` : r <= TOP_N ? `${v} (${r})` : v; }),
      fmt(p.modes.hunt, 2), fmt(p.modes.dungeon, 2), ratio(p.vsMedian)];
  }));
  md += `\nMedian raw scores: ${H.map(c => `${c.label} ${fmt(median(TM.map(t => S[t.id][c.id].score)), 2)}`).join(', ')}.\n`;
  if (R.walls.length) md += `\n**Walls** (the median team keeps less than ${pct(WALL, 0)} of its score, so every team is cut and checks a and b skip them): ${R.walls.map(c => `${c.label} (median ${fmt(median(TM.map(t => S[t.id][c.id].score)), 2)} vs ${fmt(median(TM.map(t => S[t.id][c.base].score)), 2)} without)`).join(', ')}.\n`;
  md += `\n## Weaknesses (check b): the 3 lowest contents of each team (relative score / the team's own overall average)\n\n`;
  md += table(['team', 'overall', 'lowest', 'second', 'third'], TM.map(t => { const p = R.per[t.id]; const f = x => `${x.c.label} ${ratio(x.x)}`;
    return [t.name, ratio(p.vsMedian), f(p.lowList[0]), f(p.lowList[1]), f(p.lowList[2])]; }));
  md += `\n## Counters: the 3 named bosses that cut each team most (field-relative: rel with the counter / rel in the same content without it; raw = score with / without)\n\n`;
  md += table(['team', 'designed counters', 'worst', 'second', 'third', 'designed counters: the bosses that carry them (worst cut, Hunt + guardian)'], TM.map(t => {
    const p = R.per[t.id]; const f = x => `${x.c.label.replace(' vs ', ': ')} ${ratio(x.w)} (raw ${ratio(x.raw)})`;
    const carries = (b, m) => { const N = bossMechs(cfg, b, 'Heroic'), im = cfg.v2_enemy.mechanics[m]?.immune || []; return N.mech.includes(m) || (im.length > 0 && im.every(s => N.resists.includes(s))); };
    const des = (t.counters || []).map(m => { const ws = C.counter.filter(c => carries(c.mech, m) && !R.walls.includes(c)).map(c => R.rel[t.id][c.id] / R.rel[t.id][c.base]); return ws.length ? `${m} ${ratio(Math.min(...ws))}` : `${m}: no boss`; }).join(', ');
    return [t.name, (t.counters || []).join(', '), f(p.weakList[0]), f(p.weakList[1]), f(p.weakList[2]), des];
  }));
  md += `\n## Strong somewhere: the best rank of each team\n\n` + table(['team', 'best content (all)', 'rank', 'best headline content', 'rank', '#1 in (headline)'], TM.map(t => { const p = R.per[t.id];
    return [t.name, p.best.label, p.bestRank, p.bestHead.label, p.bestHeadRank, p.firsts.join(', ') || '-']; }));
  md += `\n## Casual-friendly teams (Dungeon floor 3 at casual investment)\n\n` + table(['team', 'common cards H / D', 'clears floor 3 (best)', 'clears floor 3 (auto policy)', 'floors (casual)'], TM.filter(t => t.casual).map(t =>
    [t.name, `${t.hunt.filter(k => isCommon(subj.get(k))).length}/8, ${t.dungeon.filter(k => isCommon(subj.get(k))).length}/5`, pct(clear3[t.id], 0), pct(autoClear3[t.id], 0), fmt(S[t.id]['run|casual'].score, 2)]));
  md += `\n## Card usage and meta risk (cards in 2+ teams; top teams = the 5 best overall: ${topTeams.map(t => byId[t].name).join(', ')})\n\n`;
  md += table(['card', 'role', 'teams', 'in top-5 teams', 'mean overall of its teams'], metaCards.slice(0, 20).map(x => [nm(x.k), cfg.v2_templates[`s1.${x.k}`].role, use[x.k].map(t => byId[t].name).join(', '), x.top, ratio(x.avg)]));
  const roles = Object.fromEntries(ROLES.map(r => [r, Object.keys(use).filter(k => cfg.v2_templates[`s1.${k}`].role === r).length]));
  md += `\n${Object.keys(use).length} different cards in the 20 teams, at most ${Math.max(...Object.values(use).map(v => v.length))} teams a card. Cards a role: ${ROLES.map(r => `${r} ${roles[r]}`).join(', ')}.\n`;
  md += `\n## The teams\n\n`;
  for (const t of TM) md += `### ${t.name}${t.casual ? ' (casual-friendly)' : ''}\n\n${t.theme}\n\n- Plan: ${t.plan.join(' ')}\n- Core combo: ${t.combo.enablers.map(nm).join(', ')} -> ${t.combo.payoffs.map(nm).join(', ')}\n- Hunt (${shape(t.hunt)}): ${t.hunt.map(k => `${nm(k)} (${cfg.v2_templates[`s1.${k}`].role})`).join(', ')}\n- Dungeon and Gauntlet (${shape(t.dungeon)}): ${t.dungeon.map(nm).join(', ')}\n- Expected strengths: ${t.strengths}\n- Expected counters: ${(t.counters || []).join(', ')}\n\n`;
  const ap = Object.entries(A).filter(([k, a]) => a.approx && use[k]);
  md += `## Approximations (cards in the teams whose active the simulator cannot run exactly)\n\n` + ap.map(([k, a]) => `- ${nm(k)}: ${a.approx}`).join('\n') + '\n';
  md += `\nNot modelled for every card: weakness, element chart, set synergy, block, boons and pranks. The best policy holds a payoff active only for the placeholder ids, so the Set 1 payoffs fire as soon as they are charged.\n`;

  const head = R.checks.map(c => `${c.ok ? 'PASS' : 'FAIL'} (${c.id}) ${c.what}${c.fails.length ? `: ${c.fails.join(', ')}` : ''}.`);
  const ord = Object.entries(R.per).sort((a, b) => b[1].vsMedian - a[1].vsMedian);
  head.push(`Overall / median: best ${ord.slice(0, 3).map(([t, p]) => `${byId[t].name} ${ratio(p.vsMedian)}`).join(', ')}; worst ${ord.slice(-3).map(([t, p]) => `${byId[t].name} ${ratio(p.vsMedian)}`).join(', ')}.`);
  return { md, head, data: { S, rel: R.rel, rank: R.rank, per: Object.fromEntries(Object.entries(R.per).map(([t, p]) => [t, { overall: p.overall, vsMedian: p.vsMedian, modes: p.modes, best: p.best.id, bestRank: p.bestRank, weak: p.weak.c.id, weakX: p.weak.w, low: p.low.c.id, lowX: p.low.x, firsts: p.firsts }])), checks: R.checks.map(c => ({ id: c.id, ok: c.ok, fails: c.fails })), clear3, autoClear3 } };
}
