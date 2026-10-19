// experiments.mjs - the 7 v2sim experiments. Each returns { md, head } (the report and the headline lines).
// All results are PROTOTYPE ESTIMATES from a simplified model, not Combat Lab numbers.
import { cardPool, pickCards, makeCard, buildFor, templatesOf, templatePP, blockPP, classOf, ATTACKER_ROLES, SUPPORT_ROLES, ROLES, STATS, allocate } from './cards.mjs';
import { buildSquad, huntDay, dungeonRun, gauntletRun, gauntletSquadSpecs, makeBoss, makeFoe, setFoeMech } from './modes.mjs';
import { Battle } from './engine.mjs';
import { POLICIES } from './policy.mjs';
import { allChecks } from './checks.mjs';
import { F } from './formulas.mjs';
import { mkRng, hash, mean, se, median, spearman, table, fmt, pct, ratio, patch } from './util.mjs';

const RAR = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold'];
const SHORT = { normal: 'Normal', illustrated_rare: 'IR', secret_rare: 'SR', full_art: 'FA', gold: 'Gold', event: 'Event', promo: 'Promo' };
const INV = ['new', 'casual', 'active'];
const HUNT_ROLES = ['striker', 'flurry', 'breaker', 'finisher', 'survivor', 'warden', 'spotter', 'herald'];
const DNG_ROLES = ['striker', 'flurry', 'cleaver', 'warden', 'spotter'];
const pm = (a, d = 0) => `${fmt(+mean(a).toFixed(d))} ± ${fmt(+(1.96 * se(a)).toFixed(d))}`;
const invLabel = (cfg, k) => `${k} (${cfg.v2_investment[k].stars}*, level ${cfg.v2_investment[k].level})`;
const PROTO = '**Prototype estimates** from a simplified model (no weakness, element, synergy, block or boons). Use them for direction. Verify each decision in the Combat Lab.\n';

function huntMany(cfg, mkSquad, n, seed, o = {}) {
  const net = [], dealt = [], steps = [], downs = [];
  for (let i = 0; i < n; i++) { const s = hash(seed, i); const sq = mkSquad(mkRng(hash(s, 'squad')), i); const h = huntDay(cfg, sq, { ...o, seed: s }); net.push(h.net); dealt.push(h.dealt); steps.push(h.steps); downs.push(h.downs); }
  return { net, dealt, steps, downs };
}
function dungeonMany(cfg, mkSquad, n, seed, o = {}) {
  const fl = [], cap = [];
  for (let i = 0; i < n; i++) { const s = hash(seed, i); const sq = mkSquad(mkRng(hash(s, 'squad')), i); const r = dungeonRun(cfg, sq, { ...o, seed: s }); fl.push(r.floor); cap.push(r.end === 'cap' ? 1 : 0); }
  return { fl, cap };
}
const clearRate = (fl, f) => fl.filter(x => x >= f).length / fl.length;
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

// ============ 1. fairness ============
export function fairness(cfg, { runs = 300, seed = 1 } = {}) {
  const pool = cardPool(cfg); const head = []; let md = `# Experiment 1: fairness (rarity x investment)\n\n${PROTO}\n`;
  const main = cfg.v2_dungeon.main_floor;
  md += `Squads: Hunt 8 cards (${HUNT_ROLES.join(', ')}), Dungeon 5 cards (${DNG_ROLES.join(', ')}). Each run draws REAL live cards of that role and finish (seeded), with the role build of v2_builds. Policy: best. ${runs} runs a cell, seed ${seed}.\n`;
  md += `The Dungeon budget (12, Gold costs 5) is ignored in the pure-rarity rows: it is a power comparison. The last row is a budget-legal mix.\n\n`;
  const rows = [], dRows = [], res = {};
  for (const inv of INV) for (const r of RAR) {
    const I = cfg.v2_investment[inv];
    const hk = {}; for (const tier of ['Normal', 'Heroic', 'Mythic']) hk[tier] = huntMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, HUNT_ROLES, r, rng, I)), runs, hash(seed, 'h', tier, inv, r), { tier });
    const d = dungeonMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, DNG_ROLES, r, rng, I)), runs, hash(seed, 'd', inv, r));
    res[`${inv}|${r}`] = { hk, d };
    rows.push([invLabel(cfg, inv), SHORT[r], pm(hk.Normal.net), pm(hk.Heroic.net), pm(hk.Mythic.net), fmt(mean(hk.Heroic.steps)), fmt(mean(hk.Heroic.dealt))]);
    dRows.push([invLabel(cfg, inv), SHORT[r], pm(d.fl, 2), fmt(median(d.fl)), q(d.fl, 0.9), pct(clearRate(d.fl, main), 0), pct(clearRate(d.fl, main + 3), 0), pct(mean(d.cap), 1)]);
  }
  // budget-legal mix
  for (const inv of INV) {
    const I = cfg.v2_investment[inv];
    const mix = rng => buildSquad(cfg, [...pickCards(cfg, pool, ['striker'], 'gold', rng, I), ...pickCards(cfg, pool, ['flurry', 'cleaver'], 'illustrated_rare', rng, I), ...pickCards(cfg, pool, ['warden', 'spotter'], 'normal', rng, I)]);
    const d = dungeonMany(cfg, mix, runs, hash(seed, 'mix', inv)); res[`${inv}|mix`] = { d };
    dRows.push([invLabel(cfg, inv), 'mix: 1 Gold + 2 IR + 2 Normal (cost 11)', pm(d.fl, 2), fmt(median(d.fl)), q(d.fl, 0.9), pct(clearRate(d.fl, main), 0), pct(clearRate(d.fl, main + 3), 0), pct(mean(d.cap), 1)]);
  }
  md += `## Hunt: net damage per day (dealt minus boss heals), mean ± 95% CI\n\n` + table(['investment', 'rarity', 'Normal tier', 'Heroic', 'Mythic', 'Heroic: steps alive', 'Heroic: dealt'], rows);
  md += `\n## Dungeon: floors cleared (main content = floor ${main} cleared)\n\n` + table(['investment', 'squad', 'floors cleared', 'median', 'p90', `clears floor ${main}`, `clears floor ${main + 3}`, 'fights at the step cap'], dRows);
  // ratios
  const rr = []; for (const inv of INV) { const n = res[`${inv}|normal`], g = res[`${inv}|gold`], i2 = res[`${inv}|illustrated_rare`];
    rr.push([invLabel(cfg, inv), ratio(mean(g.hk.Heroic.net) / mean(n.hk.Heroic.net)), ratio(mean(i2.hk.Heroic.net) / mean(n.hk.Heroic.net)), ratio(mean(g.hk.Heroic.dealt) / mean(n.hk.Heroic.dealt)), fmt(mean(g.d.fl) - mean(n.d.fl)), fmt(mean(i2.d.fl) - mean(n.d.fl))]); }
  md += `\n## Gaps\n\n` + table(['investment', 'Hunt Heroic net: Gold / Normal', 'IR / Normal', 'Hunt dealt: Gold / Normal', 'Dungeon floors: Gold - Normal', 'IR - Normal'], rr);
  // investment grid (stars x level), Dungeon, Normal vs Gold
  const grid = [];
  for (const stars of [0, 2, 5]) for (const level of [0, 10, 30]) {
    const cell = [`${stars}*`, `level ${level}`];
    for (const r of ['normal', 'gold']) { const d = dungeonMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, DNG_ROLES, r, rng, { stars, level })), Math.ceil(runs / 2), hash(seed, 'g', stars, level, r)); cell.push(fmt(mean(d.fl)), pct(clearRate(d.fl, main), 0)); }
    grid.push(cell);
  }
  md += `\n## Investment grid (Dungeon, ${Math.ceil(runs / 2)} runs a cell)\n\n` + table(['stars', 'level', 'Normal floors', `Normal clears ${main}`, 'Gold floors', `Gold clears ${main}`], grid);
  // Gauntlet
  const gl = []; let same = true;
  for (let w = 1; w <= 3; w++) {
    const specs = gauntletSquadSpecs(cfg, pool, w); const ref = gauntletRun(cfg, specs, {}, { seed: hash(seed, 'gw', w) }).floor; const got = [];
    for (const inv of INV) for (const r of ['normal', 'gold']) { const f = gauntletRun(cfg, specs, { ...cfg.v2_investment[inv], rarity: r }, { seed: hash(seed, 'gw', w) }).floor; got.push(f); if (f !== ref) same = false; }
    gl.push([`week ${w}`, specs.map(s => `${s.role} ${SHORT[s.rarity]}`).join(', '), ref, got.join(' ')]);
  }
  md += `\n## Gauntlet (one weekly squad, 0 stars, level 0): the result for 6 player profiles\n\n` + table(['week', 'weekly squad', 'floors (reference)', 'floors per profile (new/casual/active x Normal/Gold player)'], gl);
  md += `\nGauntlet unaffected by player investment: **${same ? 'yes' : 'NO'}**.\n`;
  // policy check
  const pa = huntMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, HUNT_ROLES, 'normal', rng, cfg.v2_investment.casual)), runs, hash(seed, 'pol'), { tier: 'Heroic', policy: 'auto' });
  const pb = huntMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, HUNT_ROLES, 'normal', rng, cfg.v2_investment.casual)), runs, hash(seed, 'pol'), { tier: 'Heroic', policy: 'best' });
  const da = dungeonMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, DNG_ROLES, 'normal', rng, cfg.v2_investment.casual)), runs, hash(seed, 'pold'), { policy: 'auto' });
  const db = dungeonMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, DNG_ROLES, 'normal', rng, cfg.v2_investment.casual)), runs, hash(seed, 'pold'), { policy: 'best' });
  md += `\n## Auto vs best policy (casual Normal squads)\n\n` + table(['mode', 'auto', 'best', 'auto / best'], [['Hunt Heroic net', fmt(mean(pa.net)), fmt(mean(pb.net)), ratio(mean(pa.net) / mean(pb.net))], ['Dungeon floors', fmt(mean(da.fl)), fmt(mean(db.fl)), ratio(mean(da.fl) / mean(db.fl))]]);
  // tuning probes: the same cells under one changed number each
  const probes = { 'defaults': {}, 'converge_d 0.36': { v2_level: { converge_d: 0.36 } }, 'Dungeon foe ATK x0.8': { v2_dungeon: { atk_x: 0.8 } }, 'Dungeon foe HP x0.8': { v2_dungeon: { hp_x: 0.8 } }, 'Hunt boss ATK x0.8': { v2_enemy: { hunt_atk_scale: 0.8 } }, 'HP point +12 (not +8)': { v2_stats: { hp: { flat: 12 } } },
    'Normal base CP 40 (not 25)': { v2_asc: { base: { normal: 40 } } }, 'D 0.36 + foe ATK x0.8 + Normal base 40': { v2_level: { converge_d: 0.36 }, v2_dungeon: { atk_x: 0.8 }, v2_asc: { base: { normal: 40 } } } };
  const pr = []; const pn = Math.max(20, Math.ceil(runs / 2));
  for (const [pname, p] of Object.entries(probes)) { const c2 = patch(cfg, p); const row = [pname];
    for (const inv of ['casual', 'active']) for (const r of ['normal', 'gold']) { const I = c2.v2_investment[inv];
      const d = dungeonMany(c2, rng => buildSquad(c2, pickCards(c2, pool, DNG_ROLES, r, rng, I)), pn, hash(seed, 'pr', inv, r)); row.push(pct(clearRate(d.fl, main), 0)); }
    for (const inv of ['casual', 'active']) { const n = mean(huntMany(c2, rng => buildSquad(c2, pickCards(c2, pool, HUNT_ROLES, 'normal', rng, c2.v2_investment[inv])), pn, hash(seed, 'prh', inv), { tier: 'Heroic' }).dealt);
      const g = mean(huntMany(c2, rng => buildSquad(c2, pickCards(c2, pool, HUNT_ROLES, 'gold', rng, c2.v2_investment[inv])), pn, hash(seed, 'prh', inv), { tier: 'Heroic' }).dealt); row.push(ratio(g / n, 1)); }
    pr.push(row); }
  md += `
## Tuning probes (${pn} runs a cell; one number changed per row)

` + table(['probe', `casual Normal clears ${main}`, 'casual Gold', 'active Normal', 'active Gold', 'Hunt dealt Gold / Normal, casual', 'active'], pr);
  const nA = res['active|normal'], gA = res['active|gold'], nC = res['casual|normal'], gC = res['casual|gold'];
  head.push(`Dungeon: a Normal squad clears floor ${main} in ${pct(clearRate(nC.d.fl, main), 0)} of runs at casual and ${pct(clearRate(nA.d.fl, main), 0)} at active. Gold: ${pct(clearRate(gC.d.fl, main), 0)} and ${pct(clearRate(gA.d.fl, main), 0)}.`);
  head.push(`Dungeon floors cleared, active: Normal ${fmt(mean(nA.d.fl))}, Gold ${fmt(mean(gA.d.fl))}. Casual: Normal ${fmt(mean(nC.d.fl))}, Gold ${fmt(mean(gC.d.fl))}.`);
  head.push(`Hunt Heroic damage dealt a day, Gold / Normal: new ${ratio(mean(res['new|gold'].hk.Heroic.dealt) / mean(res['new|normal'].hk.Heroic.dealt), 1)}, casual ${ratio(mean(gC.hk.Heroic.dealt) / mean(nC.hk.Heroic.dealt), 1)}, active ${ratio(mean(gA.hk.Heroic.dealt) / mean(nA.hk.Heroic.dealt), 1)}. Normal squads stay alive ${fmt(mean(res['new|normal'].hk.Heroic.steps))} / ${fmt(mean(nC.hk.Heroic.steps))} / ${fmt(mean(nA.hk.Heroic.steps))} of 40 steps (new / casual / active).`);
  head.push(`Probes: ${pr.slice(1).map(r => `${r[0]}: casual Normal ${r[1]}, active Normal ${r[3]}, Hunt Gold/Normal ${r[5]} / ${r[6]}`).join('; ')}.`);
  head.push(`Gauntlet unaffected by investment: ${same ? 'yes' : 'NO'}. Auto / best: Hunt ${ratio(mean(pa.net) / mean(pb.net))}, Dungeon ${ratio(mean(da.fl) / mean(db.fl))}.`);
  return { md, head };
}

// ============ 2. shapes ============
const randRoles = (rng, roles, n) => Array.from({ length: n }, () => roles[Math.floor(rng() * roles.length)]);
export function shapes(cfg, { runs = 300, seed = 1 } = {}) {
  const pool = cardPool(cfg); const head = []; let md = `# Experiment 2: squad shapes\n\n${PROTO}\n`;
  md += `Each run draws random roles for the attacker and support slots and real cards of those roles (Normal), policy best. ${runs} runs a cell, seed ${seed}. Value relative to the best shape of the same column.\n\n`;
  const H = [[8, 0], [7, 1], [6, 2], [5, 3], [4, 4], [3, 5], [2, 6], [1, 7]], D = [[5, 0], [4, 1], [3, 2], [2, 3], [1, 4]];
  const cols = [['casual', 'Heroic'], ['active', 'Heroic'], ['active', 'Mythic']];
  const hv = {};
  for (const [inv, tier] of cols) for (const [a, s] of H) hv[`${inv}|${tier}|${a}`] = mean(huntMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, [...randRoles(rng, ATTACKER_ROLES, a), ...randRoles(rng, SUPPORT_ROLES, s)], 'normal', rng, cfg.v2_investment[inv])), runs, hash(seed, 'hs', inv, tier, a), { tier }).net);
  const rowsH = H.map(([a, s]) => [`${a}A+${s}S`, ...cols.map(([inv, tier]) => { const best = Math.max(...H.map(([x]) => hv[`${inv}|${tier}|${x}`])); return `${fmt(hv[`${inv}|${tier}|${a}`])} (${ratio(hv[`${inv}|${tier}|${a}`] / best)})`; })]);
  md += `## Hunt (8 cards), net damage a day (share of the best shape)\n\n` + table(['shape', ...cols.map(([i, t]) => `${i}, ${t}`)], rowsH);
  const dv = {};
  for (const inv of ['casual', 'active']) for (const [a, s] of D) dv[`${inv}|${a}`] = dungeonMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, [...randRoles(rng, ATTACKER_ROLES, a), ...randRoles(rng, SUPPORT_ROLES, s)], 'normal', rng, cfg.v2_investment[inv])), runs, hash(seed, 'ds', inv, a)).fl;
  const rowsD = D.map(([a, s]) => [`${a}A+${s}S`, ...['casual', 'active'].map(inv => { const best = Math.max(...D.map(([x]) => mean(dv[`${inv}|${x}`]))); return `${fmt(mean(dv[`${inv}|${a}`]))} (${ratio(mean(dv[`${inv}|${a}`]) / best)})`; })]);
  md += `\n## Dungeon (5 cards), floors cleared (share of the best shape)\n\n` + table(['shape', 'casual', 'active'], rowsD);
  // verdict: band 3A+5S..6A+2S within 15% of the best?
  for (const [inv, tier] of cols) {
    const vals = H.map(([a]) => [a, hv[`${inv}|${tier}|${a}`]]); const best = vals.reduce((m, x) => x[1] > m[1] ? x : m); const second = vals.filter(x => x !== best).reduce((m, x) => x[1] > m[1] ? x : m);
    const band = vals.filter(([a]) => a >= 3 && a <= 6).map(([, v]) => v / best[1]);
    head.push(`Hunt ${inv} ${tier}: best ${best[0]}A+${8 - best[0]}S, next ${second[0]}A+${8 - second[0]}S at ${ratio(second[1] / best[1])}. Shapes 6A+2S to 3A+5S: ${ratio(Math.min(...band))} to ${ratio(Math.max(...band))} of the best.`);
  }
  for (const inv of ['casual', 'active']) { const vals = D.map(([a]) => [a, mean(dv[`${inv}|${a}`])]); const best = vals.reduce((m, x) => x[1] > m[1] ? x : m);
    head.push(`Dungeon ${inv}: best ${best[0]}A+${5 - best[0]}S (${fmt(best[1])} floors); ${vals.map(([a, v]) => `${a}A ${ratio(v / best[1])}`).join(', ')}.`); }
  md += `\nRule of thumb (8-stat study 6.4): no shape is dominant when 6A+2S to 3A+5S are within 15% of the best.\n`;
  return { md, head };
}

// ============ 3. survival ============
export function survival(cfg, { runs = 400, seed = 1 } = {}) {
  const head = []; let md = `# Experiment 3: survival (hits to down)\n\n${PROTO}\n`;
  md += `Each cell = the mean number of enemy hits of that kind that a fresh card takes before it is down. Defense and Dodge count. The Warden aura does not (one card alone). No boss signature. ${runs} trials a cell.\n\n`;
  const B = cfg.v2_enemy.boss_moves, P = cfg.v2_dungeon.pool_moves;
  const enemies = [];
  for (const t of ['Normal', 'Heroic', 'Mythic']) { enemies.push([`Hunt ${t} strike`, () => makeBoss(cfg, t, { sigs: [], startFrac: 1 }), B.strike_x]); enemies.push([`Hunt ${t} rage strike`, () => makeBoss(cfg, t, { sigs: [], startFrac: 0.3 }), B.strike_x]); }
  for (const f of [3, 6, 9]) { enemies.push([`Dungeon F${f} fight strike`, r => makeFoe(cfg, f, 1, 'fight', r), 1]); enemies.push([`Dungeon F${f} guardian heavy`, r => makeFoe(cfg, f, 5, 'guardian', r), P.heavy_x]); }
  const cards = [];
  for (const [r, inv] of [['normal', 'new'], ['normal', 'casual'], ['normal', 'active'], ['gold', 'new'], ['gold', 'active']])
    for (const role of ['striker', 'survivor', 'warden', 'herald']) cards.push([`${SHORT[r]} ${invLabel(cfg, inv)} ${role}`, () => makeCard(cfg, { key: role, role, rarity: r, ...cfg.v2_investment[inv] })]);
  for (const r of ['normal', 'gold']) cards.push([`${SHORT[r]} active, tank build (HP 10, DEF 10, DDG 10) warden`, () => makeCard(cfg, { key: 'tank', role: 'warden', rarity: r, ...cfg.v2_investment.active, points: { hp: 10, def: 10, ddg: 10 } })]);
  const rows = [];
  for (const [lbl, mk] of cards) {
    const c0 = mk(); const row = [lbl, fmt(c0.maxHp), pct(c0.def, 0), pct(c0.ddg, 0)];
    for (const [, mkE, x] of enemies) {
      const hitsArr = [];
      for (let i = 0; i < runs; i++) { const rng = mkRng(hash(seed, lbl, i)); const e = mkE(rng); e.mech = []; const b = new Battle(cfg, { cards: [mk()], enemies: [e], mode: e.key.startsWith('boss') ? 'hunt' : 'dungeon', policy: POLICIES.auto, seed: hash(seed, lbl, i) });
        const c = b.cards[0], en = b.enemies[0]; let k = 0; while (!c.down && k < 200) { b.enemyHit(en, c, x); k++; } hitsArr.push(k); }
      row.push(fmt(mean(hitsArr), 1));
    }
    rows.push(row);
  }
  md += table(['card', 'HP', 'DEF', 'DDG', ...enemies.map(e => e[0])], rows);
  // in-fight: share of support and attacker downs in real Hunt days
  const pool = cardPool(cfg); const fr = [];
  for (const inv of INV) for (const tier of ['Heroic', 'Mythic']) {
    let aDown = 0, sDown = 0, aN = 0, sN = 0, st = [];
    for (let i = 0; i < Math.ceil(runs / 4); i++) { const s = hash(seed, 'f', inv, tier, i); const sq = buildSquad(cfg, pickCards(cfg, pool, HUNT_ROLES, 'normal', mkRng(s), cfg.v2_investment[inv])); const h = huntDay(cfg, sq, { tier, seed: s });
      for (const c of h.b.cards) { if (c.cls === 'attacker') { aN++; if (c.down) aDown++; } else { sN++; if (c.down) sDown++; } } st.push(h.steps); }
    fr.push([invLabel(cfg, inv), tier, pct(aDown / aN, 0), pct(sDown / sN, 0), fmt(mean(st))]);
  }
  md += `\n## In real Hunt days (Normal squads, 5A+3S): share of cards down at the end of the day\n\n` + table(['investment', 'tier', 'attackers down', 'supports down', 'steps alive (of 40)'], fr);
  const cell = (lbl, col) => { const r = rows.find(x => x[0] === lbl); return r ? r[4 + enemies.findIndex(e => e[0] === col)] : '-'; };
  const L = (r, inv, role) => `${SHORT[r]} ${invLabel(cfg, inv)} ${role}`;
  for (const col of ['Hunt Heroic strike', 'Hunt Mythic rage strike', 'Dungeon F6 guardian heavy'])
    head.push(`Hits to down vs ${col}: support (Warden) Normal new ${cell(L('normal', 'new', 'warden'), col)}, casual ${cell(L('normal', 'casual', 'warden'), col)}, active ${cell(L('normal', 'active', 'warden'), col)}, active tank build ${cell('Normal active, tank build (HP 10, DEF 10, DDG 10) warden', col)}; Gold new ${cell(L('gold', 'new', 'warden'), col)}, Gold active ${cell(L('gold', 'active', 'warden'), col)}. Attacker (Striker) Normal casual ${cell(L('normal', 'casual', 'striker'), col)}.`);
  head.push(`Hunt days (Normal squads): ${fr.map(r => `${r[0].split(' ')[0]} ${r[1]}: ${r[2]} of attackers and ${r[3]} of supports down, ${r[4]} steps`).join('; ')}.`);
  return { md, head };
}

// ============ 4. stat weights + the Power formula ============
const REF_SQUAD = [['striker', 'striker.lockon'], ['flurry', 'flurry.storm'], ['warden', 'warden.shield'], ['spotter', 'spotter.expose']];
function refCards(cfg, inv) { return REF_SQUAD.map(([role, t]) => makeCard(cfg, { key: `ref-${role}`, role, rarity: 'normal', template: t, ...inv })); }
// strength of one card = net Hunt Heroic damage a day of (the card + 4 reference cards), common seeds.
function strength(cfg, card, n, seed, o = {}) {
  const ref = refCards(cfg, o.refInv || { stars: 2, level: 15 }); let s = 0;
  for (let i = 0; i < n; i++) s += huntDay(cfg, [card, ...ref], { tier: o.tier || 'Heroic', seed: hash(seed, i), sigs: o.sigs ?? [], startFrac: o.startFrac }).net;
  return s / n;
}
export function statWeights(cfg, { runs = 1000, seed = 1 } = {}) {
  const head = []; let md = `# Experiment 4: stat weights per role and a Power formula\n\n${PROTO}\n`;
  const base = { stars: 2, level: 15 }; const K = 3;
  md += `Reference card: Normal ${base.stars}*, level ${base.level}, the role build of v2_builds, each template of the role (averaged). Strength = net Hunt Heroic damage a day of the card + 4 fixed reference cards (${REF_SQUAD.map(r => r[1]).join(', ')}), no boss signature, ${runs} days with common seeds.\n`;
  md += `Marginal value = the gain from +${K} points in one stat, per point (a stat at the cap uses -${K}).\n\n`;
  const W = {}; const rows = []; const V0 = {}, BASE = {};
  for (const role of ROLES) {
    const tps = templatesOf(cfg, role); W[role] = {};
    const pts0 = buildFor(cfg, role, base.level);
    const v0 = mean(tps.map(t => strength(cfg, makeCard(cfg, { key: 'sw', role, rarity: 'normal', template: t, ...base, points: pts0 }), runs, hash(seed, role, t))));
    V0[role] = v0; BASE[role] = tps.map(t => makeCard(cfg, { key: 'sw', role, rarity: 'normal', template: t, ...base, points: pts0 }));
    for (const s of STATS) {
      const up = pts0[s] + K <= cfg.v2_stats.max_per_stat; const p = { ...pts0, [s]: pts0[s] + (up ? K : -K) };
      const v = mean(tps.map(t => strength(cfg, makeCard(cfg, { key: 'sw', role, rarity: 'normal', template: t, ...base, points: p, freePoints: true }), runs, hash(seed, role, t))));
      W[role][s] = up ? (v / v0 - 1) / K : (v0 / v - 1) / K;
    }
    rows.push([role, fmt(v0), ...STATS.map(s => pct(W[role][s], 2))]);
  }
  md += `## Marginal value of one point (share of the squad's net damage)\n\n` + table(['role', 'strength (net/day)', ...STATS.map(s => s.toUpperCase())], rows);
  // proposed weights: per role, normalised to the role's best stat = 1.00
  const wr = ROLES.map(role => { const mx = Math.max(...STATS.map(s => Math.max(0, W[role][s]))); return [role, ...STATS.map(s => fmt(Math.max(0, W[role][s]) / (mx || 1), 2))]; });
  md += `\n## Proposed per-role power weights (best stat of the role = 1.00; negative = 0)\n\n` + table(['role', ...STATS.map(s => s.toUpperCase())], wr);
  // Power formulas vs simulated strength on random cards
  const N = Math.max(60, Math.round(runs / 3)), M = 144; const rng = mkRng(hash(seed, 'power'));
  const sample = [];
  for (let i = 0; i < M; i++) {
    const role = ROLES[i % ROLES.length]; const rarity = RAR[Math.floor(rng() * RAR.length)]; const stars = Math.floor(rng() * 6); const level = [0, 5, 10, 20, 30][Math.floor(rng() * 5)];
    const wts = Object.fromEntries(STATS.map(s => [s, rng() < 0.5 ? 0 : 1 + Math.floor(rng() * 4)])); const pts = allocate(cfg, Object.values(wts).some(x => x) ? wts : { atk: 1 }, level);
    const t = templatesOf(cfg, role)[Math.floor(rng() * templatesOf(cfg, role).length)];
    const c = makeCard(cfg, { key: `pw${i}`, role, rarity, stars, level, points: pts, template: t });
    sample.push({ c, role, sim: strength(cfg, c, N, hash(seed, 'pw', i)) });
  }
  const off = c => { const cx = 1 + c.crit * (c.critx - 1), hit = (1 - Math.max(0, cfg.v2_hit.miss + 0.04 - c.acc)); const sp = c.speedBase * Math.min(c.spdMult, cfg.v2_speed.safety_max_x);
    return c.cls === 'attacker' ? c.cp * cx * hit * sp * (1 + 0.25 * (c.abl - 1)) : (cfg.v2_support.basic_x * c.cp * cx * hit + c.cpBase * 0 + 25 * c.power * c.abl * cx) * sp; };
  const sur = c => c.maxHp / (1 - c.def) / (1 - 0.7 * c.ddg);
  // role-weighted: analytic base at 0 points x prod(1 + w x points), w = measured marginal; k_role from the reference strength
  // k_role is fitted on the reference cards of the marginal step (Normal 2* level 15), NOT on the random sample (out of sample).
  const ref0 = {}; for (const role of ROLES) ref0[role] = V0[role] / mean(BASE[role].map(c => off(c) * sur(c)));
  const P = {
    'naive CP x HP': x => x.c.cp * x.c.maxHp,
    'Offense x Survival (analytic)': x => off(x.c) * sur(x.c),
    'base(rarity, stars) x role weights': x => { const b = makeCard(cfg, { key: 'b', role: x.role, rarity: x.c.rarity, stars: x.c.stars, level: x.c.level, points: {}, template: x.c.active.id }); return off(b) * sur(b) * STATS.reduce((m, s) => m * (1 + Math.max(0, W[x.role][s]) * x.c.points[s]), 1); },
    'Offense x Survival x role scale k': x => ref0[x.role] * off(x.c) * sur(x.c),
  };
  const corr = [];
  for (const [name, fn] of Object.entries(P)) {
    const all = sample.map(fn), sim = sample.map(x => x.sim);
    const sub = cls => { const s = sample.filter(x => classOf(x.role) === cls); return spearman(s.map(fn), s.map(x => x.sim)); };
    const within = mean(ROLES.map(role => { const s = sample.filter(x => x.role === role); return spearman(s.map(fn), s.map(x => x.sim)); }));
    corr.push([name, fmt(spearman(all, sim), 3), fmt(sub('attacker'), 3), fmt(sub('support'), 3), fmt(within, 3)]);
  }
  md += `\n## Power formula vs simulated strength (${M} random cards: random role, rarity, stars, level, build; ${N} days each)\n\n` + table(['formula', 'Spearman, all cards', 'attackers', 'supports', 'mean within one role'], corr);
  md += `\nOffense (attacker) = CP x (1 + crit x (crit damage - 1)) x hit chance x speed x (1 + 0.25 x (ABL - 1)). Offense (support) = (basic hit + 25 x F x ABL) x crit term x speed. Survival = HP / (1 - DEF) / (1 - 0.7 x DDG). Role scale k = simulated strength / analytic value of the role's reference card (fitted on the reference cards, not on this sample).\n`;
  md += `\nRole scale k (strength per analytic unit, relative to the mean): ${ROLES.map(r => `${r} ${fmt(ref0[r] / mean(Object.values(ref0)), 2)}`).join(', ')}.\n`;
  const top = role => STATS.slice().sort((a, b) => W[role][b] - W[role][a]).slice(0, 3).map(s => `${s.toUpperCase()} ${pct(W[role][s], 1)}`).join(', ');
  head.push(`Top stats per point: ${ROLES.map(r => `${r}: ${top(r)}`).join('; ')}.`);
  head.push(`CRT per point: Striker ${pct(W.striker.crt, 2)} vs Survivor ${pct(W.survivor.crt, 2)} vs Warden ${pct(W.warden.crt, 2)}.`);
  head.push(`Power formula rank correlation (Spearman, all cards): ${corr.map(c => `${c[0]} ${c[1]}`).join('; ')}.`);
  return { md, head, W };
}

// ============ 5. speed ============
export function speed(cfg, { runs = 600, seed = 1 } = {}) {
  const head = []; let md = `# Experiment 5: does Speed dominate?\n\n${PROTO}\n`;
  const base = { stars: 2, level: 10 };
  md += `A card with 10 points (level 10, Normal ${base.stars}*) in ONE stat, the card + 4 reference cards, Hunt Heroic. "counter" = a boss with Slowing (area hits Slow) and Frost Aura (single hits Chill). ${runs} days a cell, common seeds.\n\n`;
  const rows = []; const res = {};
  const roles = ['striker', 'flurry', 'breaker', 'survivor', 'warden', 'controller', 'herald', 'artillery'];
  for (const role of roles) {
    const t = templatesOf(cfg, role)[0]; const row = [role];
    for (const sigs of [[], ['slowing', 'frost_aura']]) {
      const v = {}; for (const s of ['none', 'spd', 'atk', 'crt', 'hp', 'def', 'abl']) { const pts = s === 'none' ? {} : { [s]: 10 }; v[s] = strength(cfg, makeCard(cfg, { key: 'sp', role, rarity: 'normal', template: t, ...base, points: pts }), runs, hash(seed, role), { sigs }); }
      const gain = s => v[s] / v.none - 1; res[`${role}|${sigs.length}`] = v;
      const rank = ['spd', 'atk', 'crt', 'hp', 'def', 'abl'].sort((a, b) => gain(b) - gain(a)).indexOf('spd') + 1;
      row.push(pct(gain('spd'), 1), pct(Math.max(gain('atk'), gain('crt'), gain('hp'), gain('def'), gain('abl')), 1), `${rank} of 6`);
    }
    rows.push(row);
  }
  md += table(['role', 'neutral: +10 SPD', 'neutral: best other +10', 'SPD rank', 'counter: +10 SPD', 'counter: best other', 'SPD rank'], rows);
  // squad level: all-speed builds vs all-attack builds, level 30
  const pool = cardPool(cfg); const sq = (build, rng) => pickCards(cfg, pool, HUNT_ROLES, 'normal', rng, { stars: 2, level: 30 }).map(s => makeCard(cfg, { ...s, points: allocate(cfg, build, 30) }));
  const bl = { 'balanced (role builds)': null, 'speed first (SPD 10 + role build)': 'spd', 'attack first (ATK 10 + role build)': 'atk' };
  const sr = [];
  for (const sigs of [[], ['slowing', 'frost_aura']]) for (const [name, k] of Object.entries(bl)) {
    const h = huntMany(cfg, rng => k ? pickCards(cfg, pool, HUNT_ROLES, 'normal', rng, { stars: 2, level: 30 }).map(s => makeCard(cfg, { ...s, points: (() => { const p = allocate(cfg, cfg.v2_builds[s.role], 20); p[k] = Math.min(10, p[k] + 10); return p; })(), freePoints: true })) : buildSquad(cfg, pickCards(cfg, pool, HUNT_ROLES, 'normal', rng, { stars: 2, level: 30 })), runs, hash(seed, 'sq', sigs.length), { tier: 'Heroic', sigs });
    sr.push([sigs.length ? 'counter boss' : 'neutral boss', name, fmt(mean(h.net)), fmt(mean(h.steps))]);
  }
  md += `\n## Squads of 8 (Normal 2*, level 30)\n\n` + table(['boss', 'build', 'net damage a day', 'steps alive'], sr);
  md += `\nSpeed points give x${(1 + 10 * cfg.v2_stats.spd.pct).toFixed(2)} actions at 10 points (safety cap x${cfg.v2_speed.safety_max_x}). The daily cap stays 40 clock steps.\n`;
  const spdWins = rows.filter(r => r[3] === '1 of 6').length, spdWinsC = rows.filter(r => r[6] === '1 of 6').length;
  head.push(`+10 SPD is the best single stat for ${spdWins} of ${roles.length} roles on a neutral boss, and ${spdWinsC} of ${roles.length} vs the Slow/Chill counter boss.`);
  head.push(`Squads (level 30): ${sr.map(r => `${r[0]} ${r[1].split(' (')[0]} ${r[2]}`).join('; ')}.`);
  return { md, head };
}

// ============ 6. statuses ============
export function statuses(cfg, { runs = 300, seed = 1 } = {}) {
  const head = []; let md = `# Experiment 6: statuses and counters do what they say\n\n${PROTO}\n## Sanity checks (the same checks as the unit tests)\n\n`;
  const ch = allChecks(cfg).filter(c => !c.id.startsWith('pp.'));
  md += table(['check', 'what', 'expect', 'got', 'result'], ch.map(c => [c.id, c.what, String(c.expect), String(c.got), c.ok ? 'PASS' : 'FAIL']));
  // real fights: control share, bursts, freezes
  const T = (role, t) => makeCard(cfg, { key: `${t}`, role, rarity: 'normal', stars: 2, level: 10, template: t });
  const squads = {
    'Lockdown (4 controllers)': [T('controller', 'controller.stun'), T('controller', 'controller.lull'), T('controller', 'controller.paralyze'), T('controller', 'controller.coldsnap'), T('striker', 'striker.lockon'), T('flurry', 'flurry.storm'), T('finisher', 'finisher.ko'), T('breaker', 'breaker.crush')],
    'Toxic (2 Envenom + Poison riders)': [T('controller', 'controller.envenom'), T('controller', 'controller.envenom'), T('flurry', 'flurry.storm'), T('striker', 'striker.bloom'), T('cleaver', 'cleaver.plague'), T('finisher', 'finisher.pileon'), T('medic', 'medic.mend'), T('herald', 'herald.empower')],
    'Shatter (Chill makers + Shatter)': [T('controller', 'controller.coldsnap'), T('warden', 'warden.icefort'), T('flurry', 'flurry.frost'), T('breaker', 'breaker.shatter'), T('breaker', 'breaker.shatter'), T('artillery', 'artillery.frostshell'), T('finisher', 'finisher.ko'), T('striker', 'striker.lockon')],
  };
  const rows = [];
  for (const [name, sq] of Object.entries(squads)) for (const [mode, tier] of [['hunt', 'Heroic'], ['hunt', 'Mythic'], ['dungeon', 'F5 guardian']]) {
    let skip = 0, turns = 0, bursts = 0, freezes = 0, days = 0;
    for (let i = 0; i < runs; i++) {
      let b;
      if (mode === 'hunt') b = huntDay(cfg, sq, { tier, sigs: [], seed: hash(seed, name, tier, i) }).b;
      else { const rng = mkRng(hash(seed, name, i)); const foe = makeFoe(cfg, 5, 5, 'guardian', rng); foe.mech = []; b = new Battle(cfg, { cards: sq.slice(0, 5).map(c => ({ ...c })), enemies: [foe], mode: 'dungeon', policy: POLICIES.best, seed: hash(seed, name, i) }).run(); }
      skip += b.S.controlSkips; turns += b.S.enemyTurns; bursts += b.S.bursts; freezes += b.S.freezes; days++;
    }
    rows.push([name, mode === 'hunt' ? `Hunt ${tier}` : `Dungeon ${tier} (first 5 cards)`, pct(skip / turns, 1), fmt(bursts / days, 2), fmt(freezes / days, 2)]);
  }
  md += `\n## Real fights (Normal 2*, level 10; ${runs} fights a row; policy best)\n\n` + table(['squad', 'fight', 'enemy turns skipped by control', 'Toxic bursts a fight', 'Freezes a fight'], rows);
  const fails = ch.filter(c => !c.ok);
  head.push(`Sanity checks: ${ch.length - fails.length} of ${ch.length} PASS${fails.length ? ` (FAIL: ${fails.map(f => f.id).join(', ')})` : ''}.`);
  const lk = rows.filter(r => r[0].startsWith('Lockdown'));
  head.push(`Control lock: 4 controllers skip ${lk.map(r => `${r[2]} (${r[1]})`).join(', ')} of enemy turns. No permanent lock.`);
  head.push(`Toxic bursts a Hunt Heroic day: ${rows.find(r => r[0].startsWith('Toxic') && r[1] === 'Hunt Heroic')[3]}. Freezes a Shatter Hunt Heroic day: ${rows.find(r => r[0].startsWith('Shatter') && r[1] === 'Hunt Heroic')[4]}.`);
  return { md, head };
}

// ============ 7. archetypes ============
export const ARCHETYPES = {
  'Neutral (control)': { hunt: ['striker.lockon', 'breaker.crush', 'finisher.execute', 'survivor.leech', 'flurry.frenzy', 'warden.shield', 'herald.empower', 'spotter.expose'], counter: [] },
  'Toxic': { hunt: ['controller.envenom', 'controller.envenom', 'flurry.storm', 'striker.bloom', 'cleaver.plague', 'finisher.pileon', 'medic.mend', 'herald.empower'], counter: ['toxic_born', 'purify'] },
  'Wildfire': { hunt: ['artillery.ignite', 'artillery.detonate', 'cleaver.wildfire', 'striker.lockon', 'finisher.pileon', 'flurry.storm', 'herald.empower', 'warden.shield'], counter: ['fireborn', 'purify'] },
  'Shatter': { hunt: ['controller.coldsnap', 'warden.icefort', 'flurry.frost', 'breaker.shatter', 'breaker.shatter', 'artillery.frostshell', 'finisher.ko', 'striker.lockon'], counter: ['frostborn', 'unstoppable'] },
  'Mark and Hunt': { hunt: ['spotter.mark', 'spotter.mark', 'striker.trueaim', 'finisher.ko', 'striker.lockon', 'breaker.crush', 'herald.focus', 'flurry.frenzy'], counter: ['elusive'] },
  'Wall': { hunt: ['warden.shield', 'warden.bulwark', 'survivor.guardup', 'survivor.leech', 'breaker.bash', 'survivor.sap', 'medic.heal', 'striker.lockon'], counter: ['shatter', 'venom'] },
  'Crit Chain': { hunt: ['herald.focus', 'herald.focus', 'spotter.mark', 'striker.lockon', 'striker.thunder', 'striker.trueaim', 'finisher.ko', 'flurry.frenzy'], counter: ['ironhide'] },
  'Cleave': { hunt: ['cleaver.cleave', 'cleaver.wildfire', 'cleaver.plague', 'spotter.expose', 'controller.weaken', 'finisher.execute', 'artillery.ignite', 'warden.shield'], counter: [] },
  'Lockdown': { hunt: ['controller.stun', 'controller.lull', 'controller.paralyze', 'controller.coldsnap', 'finisher.ko', 'breaker.shatter', 'striker.thunder', 'warden.shield'], counter: ['unstoppable', 'purify'] },
  'Pile On': { hunt: ['spotter.expose', 'controller.envenom', 'controller.haze', 'controller.coldsnap', 'finisher.pileon', 'finisher.pileon', 'striker.lockon', 'flurry.frenzy'], counter: ['purify', 'thick_hide'] },
  "Herald's Court": { hunt: ['herald.empower', 'herald.rally', 'herald.quicken', 'herald.focus', 'striker.lockon', 'breaker.crush', 'finisher.execute', 'survivor.leech'], counter: ['dispeller'] },
};
const dngPick = t => { const a = t.filter(x => ATTACKER_ROLES.includes(x.split('.')[0])), s = t.filter(x => SUPPORT_ROLES.includes(x.split('.')[0])); return [...a.slice(0, 3), ...s.slice(0, 2)].concat(t).slice(0, 5); };
export function archetypes(cfg, { runs = 400, seed = 1 } = {}) {
  const head = []; let md = `# Experiment 7: archetypes vs neutral and vs their counters\n\n${PROTO}\n`;
  const inv = cfg.v2_investment.casual;
  md += `Each archetype = 8 fixed templates on Normal ${inv.stars}* level ${inv.level} cards (Dungeon: 3 attackers + 2 supports of the list). Policy best. Hunt Heroic, ${runs} days; Dungeon runs ${Math.ceil(runs / 2)}. "counter" = the same boss with the archetype's counter signature; Dungeon counter = the same signature on every foe.\n\n`;
  const mk = t => makeCard(cfg, { key: t, role: t.split('.')[0], rarity: 'normal', template: t, ...inv });
  const res = {};
  for (const [name, A] of Object.entries(ARCHETYPES)) {
    const sq = A.hunt.map(mk); const dq = dngPick(A.hunt).map(mk);
    const hN = huntMany(cfg, () => sq, runs, hash(seed, 'arch'), { tier: 'Heroic', sigs: [] });
    const hC = A.counter.length ? huntMany(cfg, () => sq, runs, hash(seed, 'arch'), { tier: 'Heroic', sigs: A.counter }) : null;
    const dN = dungeonMany(cfg, () => dq, Math.ceil(runs / 2), hash(seed, 'archd'));
    const dC = A.counter.length ? dungeonMany(cfg, () => dq, Math.ceil(runs / 2), hash(seed, 'archd'), { foeMech: A.counter }) : null;
    res[name] = { hN: mean(hN.net), hC: hC ? mean(hC.net) : null, dN: mean(dN.fl), dC: dC ? mean(dC.fl) : null, A };
  }
  const neutral = res['Neutral (control)'];
  const medH = median(Object.entries(res).filter(([n]) => !n.startsWith('Neutral')).map(([, r]) => r.hN)), medD = median(Object.entries(res).filter(([n]) => !n.startsWith('Neutral')).map(([, r]) => r.dN));
  const rows = Object.entries(res).map(([n, r]) => [n, r.A.counter.join(' + ') || '-', fmt(r.hN), ratio(r.hN / neutral.hN), ratio(r.hN / medH), r.hC === null ? '-' : ratio(r.hC / r.hN), fmt(r.dN), ratio(r.dN / medD), r.dC === null ? '-' : ratio(r.dC / Math.max(0.01, r.dN))]);
  md += table(['archetype', 'counter', 'Hunt net/day', 'vs Neutral', 'vs median archetype', 'counter / neutral boss', 'Dungeon floors', 'vs median', 'counter / neutral foes'], rows);
  // horde vs single big foe for Cleave
  const cl = ARCHETYPES.Cleave.hunt, ne = ARCHETYPES['Neutral (control)'].hunt; const roomT = [];
  for (const [nm, list] of [['Cleave', cl], ['Neutral', ne]]) for (const [kind, n] of [['horde', 4], ['guardian', 1]]) {
    let won = 0, steps = 0; for (let i = 0; i < runs; i++) { const rng = mkRng(hash(seed, 'room', nm, kind, i)); const foes = Array.from({ length: n }, () => { return setFoeMech(makeFoe(cfg, 5, 3, kind, rng), []); });
      const b = new Battle(cfg, { cards: dngPick(list).map(mk), enemies: foes, mode: 'dungeon', policy: POLICIES.best, seed: hash(seed, 'room', i) }).run(); if (b.ended === 'won') { won++; steps += b.step; } }
    roomT.push([nm, `${kind} x${n} (floor 5)`, pct(won / runs, 0), fmt(won ? steps / won : NaN)]);
  }
  md += `\n## Cleave: horde rooms vs one big foe (Dungeon floor 5)\n\n` + table(['squad', 'room', 'win rate', 'steps to win'], roomT);
  // template value at 10 PP (appendix)
  const tv = [];
  for (const role of ROLES) for (const t of templatesOf(cfg, role)) { const v = strength(cfg, makeCard(cfg, { key: t, role, rarity: 'normal', template: t, stars: 2, level: 15 }), Math.ceil(runs / 2), hash(seed, 'tv', role)); tv.push([role, t, fmt(templatePP(cfg, t), 1), v]); }
  const byRole = {}; for (const r of tv) (byRole[r[0]] ||= []).push(r[3]);
  md += `\n## Appendix: each placeholder active at 10 PP (Normal 2* level 15 + 4 reference cards, Hunt Heroic, neutral boss)\n\n` + table(['role', 'template', 'PP', 'net/day', 'vs role mean'], tv.map(r => [r[0], r[1], r[2], fmt(r[3]), ratio(r[3] / mean(byRole[r[0]]))]));
  const top = Object.entries(res).filter(([n]) => !n.startsWith('Neutral')).sort((a, b) => b[1].hN - a[1].hN);
  head.push(`Hunt, archetype / median archetype: best ${top[0][0]} ${ratio(top[0][1].hN / medH)}, worst ${top[top.length - 1][0]} ${ratio(top[top.length - 1][1].hN / medH)}.`);
  const drops = Object.entries(res).filter(([, r]) => r.hC !== null).map(([n, r]) => `${n} ${ratio(r.hC / r.hN)}`);
  head.push(`Hunt vs its counter boss (counter / neutral): ${drops.join(', ')}.`);
  const silver = Object.entries(res).filter(([n, r]) => !n.startsWith('Neutral') && r.hN / medH > 1.3 && (r.hC === null || r.hC / r.hN > 0.9)).map(([n]) => n);
  head.push(`Silver bullet test (> x1.30 the median AND loses < 10% vs its counter): ${silver.length ? silver.join(', ') : 'none'}.`);
  const tvs = tv.map(r => r[3] / mean(byRole[r[0]])); head.push(`Templates at 10 PP: value within the role from ${ratio(Math.min(...tvs))} to ${ratio(Math.max(...tvs))} of the role mean.`);
  return { md, head };
}

// ============ PP table ============
export function ppTable(cfg) {
  const rows = []; for (const role of ROLES) for (const t of templatesOf(cfg, role)) { const T = cfg.v2_templates[t]; rows.push([role, t, T.name, T.charge ?? cfg.v2_charge[classOf(role)], T.blocks.map(b => `${b.k}${b.status ? ' ' + b.status : ''} ${fmt(blockPP(cfg, t, b), 1)}`).join('; '), fmt(templatePP(cfg, t), 2)]); }
  return { md: `# PP prices of the placeholder actives\n\n${cfg.v2_pp._rule}\n\n` + table(['role', 'template', 'name', 'charge', 'blocks (PP)', 'total PP'], rows), head: [`${rows.length} templates, all at ${cfg.v2_pp.budget} ± ${cfg.v2_pp.tolerance} PP.`] };
}

export const EXPERIMENTS = { fairness, shapes, survival, 'stat-weights': statWeights, speed, statuses, archetypes, pp: ppTable };

export { huntMany, dungeonMany, clearRate, randRoles, strength, dngPick, HUNT_ROLES, DNG_ROLES, PROTO };
