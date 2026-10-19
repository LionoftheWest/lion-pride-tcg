// monsters.mjs - the counter matrix of the 16 named Hunt bosses (monsters-v2.md, Nathan's answers of 2026-10-19).
// node card-studio/v2sim/run.mjs monsters [--runs N] [--seed S] [--tier Heroic|Mythic|Normal] [--tag name]
//
// The 20 teams of teams.json (the PRIVATE Set 1 actives, see teams.mjs) meet each boss of v2_bosses and the neutral boss,
// at casual and active investment: the Hunt day (net damage) and the Dungeon guardian with the same mechanics (resists,
// rules, params; no counter moves). Same seeds as the teams test (common random numbers).
// cut = (team / median team with the boss) / (team / median team with the neutral boss), the mean of casual and active.
// Checks: the counter cap (a Normal or Heroic boss cuts no team below v2_enemy.counter_cut_min), rule A (every team has
// at least 2 enemies at x0.80 or lower), rule B (every team is top 5 against at least 2 enemies). H and D count as 2 enemies.
// "Weak to: role" weeks: the neutral boss with each role tag (+v2_enemy.weak_role_x for that role).
import { makeCard, ROLES } from './cards.mjs';
import { huntDay, makeFoe, bossMechs, setFoeMech, bossKeys } from './modes.mjs';
import { Battle } from './engine.mjs';
import { POLICIES } from './policy.mjs';
import { mkRng, hash, mean, median, table, fmt, ratio } from './util.mjs';
import { withSet1, loadSet1, loadTeams, teamSpecs, ROOMS } from './teams.mjs';

const INVS = ['casual', 'active'];
export const RULE_A = 0.80, TOP = 5;
export { bossKeys };

// one guardian room with a fixed mechanic set; score as in the teams test (0..2)
export function guardRoom(cfg, squad, floor, N, runs, seed) {
  let s = 0;
  for (let i = 0; i < runs; i++) {
    const rng = mkRng(hash(seed, 'room', 'guardian', floor, i));
    const f = setFoeMech(makeFoe(cfg, floor, 5, 'guardian', rng), N ? N.mech : [], N ? { resists: N.resists, params: N.params } : {});
    const b = new Battle(cfg, { cards: squad.map(c => ({ ...c, hp: c.maxHp, shield: 0 })), enemies: [f], mode: 'dungeon', policy: POLICIES.best, seed: hash(seed, 'room', 'guardian', i) }).run();
    s += b.ended === 'won' ? 1 + (b.cap - b.step) / b.cap : 1 - Math.max(0, b.enemies[0].hp) / f.maxHp;
  }
  return s / runs;
}

// The pure part: cuts, ranks and the checks from a score matrix O[profile][team][content] (content = hunt|inv or guard|inv).
// The cap counts the Hunt boss only: the Dungeon guardian is the hard final room (Nathan 2026-10-19). accepted = 'team/boss' pairs that Nathan accepted as edge cases.
export function counterMatrix(O, { bosses, teams, mythic = false, capMin = 0.65, accepted = [] }) {
  const cells = { hunt: INVS.map(i => `hunt|${i}`), guard: INVS.map(i => `guard|${i}`) };
  const med = (p, c) => median(teams.map(t => O[p][t][c])) || 1e-9;
  const V = {};
  for (const p of bosses) { V[p] = {};
    for (const mode of ['hunt', 'guard']) { const rel = {}, cut = {};
      for (const t of teams) { rel[t] = mean(cells[mode].map(c => O[p][t][c] / med(p, c))); cut[t] = mean(cells[mode].map(c => (O[p][t][c] / med(p, c)) / (O.neutral[t][c] / med('neutral', c)))); }
      const rank = {}; for (const t of teams) rank[t] = 1 + teams.filter(o => rel[o] > rel[t]).length;
      V[p][mode] = { rel, cut, rank, medRaw: cells[mode].map(c => med(p, c) / med('neutral', c)) }; } }
  const per = {};
  for (const t of teams) { const en = [];
    for (const p of bosses) for (const mode of ['hunt', 'guard']) en.push({ p, mode, cut: V[p][mode].cut[t], rank: V[p][mode].rank[t] });
    per[t] = { low: en.filter(x => x.cut <= RULE_A).sort((a, b) => a.cut - b.cut), near: en.filter(x => x.cut > RULE_A && x.cut <= 0.85), top: en.filter(x => x.rank <= TOP).sort((a, b) => a.rank - b.rank), min: en.reduce((m, x) => (x.cut < m.cut ? x : m)) }; }
  const below = mythic ? [] : teams.flatMap(t => bosses.filter(p => V[p].hunt.cut[t] < capMin).map(p => ({ t, p, x: V[p].hunt.cut[t] })));
  const capFails = below.filter(b => !accepted.includes(`${b.t}/${b.p}`)).map(b => `${b.t} ${b.p}/H ${b.x.toFixed(2)}`);
  const capAccepted = below.filter(b => accepted.includes(`${b.t}/${b.p}`)).map(b => `${b.t} ${b.p}/H ${b.x.toFixed(2)}`);
  const checks = [
    { id: 'cap', what: `counter cap: no Normal or Heroic Hunt boss cuts a team below x${capMin} (the Dungeon guardian is the hard final room: not checked)${mythic ? ' (Mythic: not checked)' : ''}${capAccepted.length ? `; accepted edge cases: ${capAccepted.join(', ')}` : ''}`, fails: capFails },
    { id: 'A', what: `rule A: every team has at least 2 enemies (boss x Hunt or Dungeon) at x${RULE_A} or lower`, fails: teams.filter(t => per[t].low.length < 2) },
    { id: 'B', what: `rule B: every team is top ${TOP} against at least 2 enemies`, fails: teams.filter(t => per[t].top.length < 2) },
  ].map(c => ({ ...c, ok: !c.fails.length }));
  return { V, per, checks };
}

export function monsters(cfg0, { runs = 200, seed = 1, tier = 'Heroic', teamList, actives, bosses, weak = true } = {}) {
  const A = actives || loadSet1(); const cfg = withSet1(cfg0, A); const TM = teamList || loadTeams();
  const BK = bosses || bossKeys(cfg); const profiles = ['neutral', ...BK];
  const O = {}; for (const p of profiles) O[p] = {};
  const W = {}; const roles = weak ? ROLES : []; for (const r of roles) W[r] = {};
  for (const t of TM) {
    for (const p of profiles) O[p][t.id] = {};
    for (const r of roles) W[r][t.id] = {};
    for (const inv of INVS) {
      const I = cfg.v2_investment[inv];
      const h = teamSpecs(cfg, t.hunt, I).map(s => makeCard(cfg, s)), d = teamSpecs(cfg, t.dungeon, I).map(s => makeCard(cfg, s));
      const day = o => { const v = []; for (let i = 0; i < runs; i++) v.push(huntDay(cfg, h, { tier, sigs: [], seed: hash(seed, 'teams-hunt', inv, i), ...o }).net); return mean(v); };
      for (const p of profiles) {
        O[p][t.id][`hunt|${inv}`] = day(p === 'neutral' ? {} : { boss: p });
        O[p][t.id][`guard|${inv}`] = guardRoom(cfg, d, ROOMS[inv].guardian, p === 'neutral' ? null : bossMechs(cfg, p, tier), runs, hash(seed, inv));
      }
      for (const r of roles) W[r][t.id][`hunt|${inv}`] = day({ weakRole: r });
    }
  }
  const teams = TM.map(t => t.id), name = Object.fromEntries(TM.map(t => [t.id, t.name]));
  const R = counterMatrix(O, { bosses: BK, teams, mythic: tier === 'Mythic', capMin: cfg.v2_enemy.counter_cut_min, accepted: cfg.v2_enemy.counter_cap_accepted || [] });
  const bn = p => cfg.v2_bosses[p].name.replace(/^The /, '');
  const cell = (p, m, t) => { const x = R.V[p][m], c = x.cut[t].toFixed(2), r = x.rank[t]; return `${x.cut[t] < 0.8 ? `**${c}**` : c}${r <= TOP ? ` #${r}` : ''}`; };

  let md = `# Monsters: the counter matrix of the ${BK.length} named Hunt bosses (${tier})\n\n**Prototype estimates** (no weakness tags, element chart, set synergy, block or boons). Verify each decision in the Combat Lab.\n\n`;
  md += `${TM.length} teams (teams.json) with the private Set 1 actives, Normal rarity, policy best, ${runs} runs a cell, seed ${seed}. Casual ${cfg.v2_investment.casual.stars}* level ${cfg.v2_investment.casual.level}, active ${cfg.v2_investment.active.stars}* level ${cfg.v2_investment.active.level}.\n`;
  md += `H = Hunt day (${tier} boss with its resists, ${tier === 'Mythic' ? 'signature + Mythic rules' : 'signature rules'} and counter moves; HP = tier HP x ${cfg.v2_enemy.asc3_hp_x} x hp_factor). D = the Dungeon guardian (floor ${ROOMS.casual.guardian} casual, ${ROOMS.active.guardian} active) with the same resists and rules, no counter moves.\n`;
  md += `Cell = cut (field-relative, **bold** below x0.80), then #rank when the team is top ${TOP} against that enemy.\n\n`;
  md += `## Checks\n\n` + table(['check', 'what', 'result', 'failing'], R.checks.map(c => [c.id, c.what, c.ok ? 'PASS' : 'FAIL', c.fails.join(', ') || '-']));
  for (const m of ['hunt', 'guard']) {
    md += `\n## ${m === 'hunt' ? 'Hunt (H)' : 'Dungeon guardian (D)'} matrix\n\n` + table(['team', ...BK.map(bn)], TM.map(t => [t.name, ...BK.map(p => cell(p, m, t.id))]));
  }
  md += `\n## Per boss\n\n` + table(['boss', 'resists', 'rules', 'hp_factor (config)', 'median damage vs neutral H casual / active (= the measured factor)', 'D median vs neutral', 'cut <= 0.80 (H)', 'cut <= 0.80 (D)', 'favored H (cut >= 1.08)'], BK.map(p => {
    const N = bossMechs(cfg, p, tier), h = R.V[p].hunt, g = R.V[p].guard;
    const low = x => teams.filter(t => x.cut[t] <= RULE_A).sort((a, b) => x.cut[a] - x.cut[b]).map(t => `${name[t]} ${x.cut[t].toFixed(2)}`).join(', ') || '-';
    const fav = teams.filter(t => h.cut[t] >= 1.08).sort((a, b) => h.cut[b] - h.cut[a]).slice(0, 4).map(t => `${name[t]} ${h.cut[t].toFixed(2)}`).join(', ') || '-';
    return [cfg.v2_bosses[p].name, N.resists.join(', ') || '-', N.mech.join(', '), cfg.v2_bosses[p].hp_factor, `x${h.medRaw[0].toFixed(2)} / x${h.medRaw[1].toFixed(2)}`, `x${g.medRaw[0].toFixed(2)} / x${g.medRaw[1].toFixed(2)}`, low(h), low(g), fav];
  }));
  md += `\n## Per team (rule A: countered by; rule B: top ${TOP} against)\n\n` + table(['team', 'enemies at x0.80 or lower', 'x0.80-0.85', 'lowest', 'A', `top ${TOP} against`, 'B'], TM.map(t => { const x = R.per[t.id];
    const f = l => l.map(e => `${bn(e.p)} ${e.mode === 'hunt' ? 'H' : 'D'} ${e.cut.toFixed(2)}`).join(', ') || '-';
    return [t.name, f(x.low), f(x.near), `${bn(x.min.p)} ${x.min.mode === 'hunt' ? 'H' : 'D'} ${x.min.cut.toFixed(2)}`, x.low.length >= 2 ? 'PASS' : 'FAIL', x.top.slice(0, 6).map(e => `${bn(e.p)} ${e.mode === 'hunt' ? 'H' : 'D'} #${e.rank}`).join(', ') + (x.top.length > 6 ? ` (+${x.top.length - 6})` : '') || '-', x.top.length >= 2 ? 'PASS' : 'FAIL']; }));
  const weakOut = {};
  if (roles.length) {
    const wmed = (r, c) => median(teams.map(t => W[r][t][c]));
    const wrel = (r, t) => mean(INVS.map(i => W[r][t][`hunt|${i}`] / wmed(r, `hunt|${i}`)));
    const wcut = (r, t) => mean(INVS.map(i => (W[r][t][`hunt|${i}`] / wmed(r, `hunt|${i}`)) / (O.neutral[t][`hunt|${i}`] / median(teams.map(o => O.neutral[o][`hunt|${i}`])))));
    md += `\n## "Weak to: role" weeks (the neutral ${tier} boss, cards of the role deal +${Math.round(cfg.v2_enemy.weak_role_x * 100)}%)\n\nCell = the top ${TOP} teams of that week (gain = the relative score that week / the relative score vs the neutral boss). The bonus is on damage, so a support-role week changes almost nothing.\n\n`;
    md += table(['role week', `top ${TOP} (gain)`], roles.map(r => { const ord = [...teams].sort((a, b) => wrel(r, b) - wrel(r, a)).slice(0, TOP); return [r, ord.map(t => `${name[t]} ${wcut(r, t).toFixed(2)}`).join(', ')]; }));
    for (const t of teams) { const best = roles.map(r => ({ r, rank: 1 + teams.filter(o => wrel(r, o) > wrel(r, t)).length, gain: wcut(r, t) })).sort((a, b) => a.rank - b.rank || b.gain - a.gain)[0]; weakOut[t] = best; }
    md += `\nBest role week of each team: ` + teams.map(t => `${name[t]} ${weakOut[t].r} #${weakOut[t].rank} (x${weakOut[t].gain.toFixed(2)})`).join(', ') + '.\n';
  }
  md += `\n## Model notes\n\n` + BK.filter(p => cfg.v2_bosses[p]._approx).map(p => `- ${cfg.v2_bosses[p].name}: ${cfg.v2_bosses[p]._approx}`).join('\n') + `\n- ${cfg.v2_bosses._guard}\n- Weak-to rule tags (1-3 tags a boss) are not modelled: the cards have no rule tags in the simulator.\n`;
  const head = R.checks.map(c => `${c.ok ? 'PASS' : 'FAIL'} (${c.id}) ${c.what}${c.fails.length ? `: ${c.fails.slice(0, 8).join(', ')}${c.fails.length > 8 ? ` (+${c.fails.length - 8})` : ''}` : ''}.`);
  return { md, head, data: { O, W, tier, checks: R.checks, per: Object.fromEntries(teams.map(t => [t, { low: R.per[t].low.map(e => [e.p, e.mode, +e.cut.toFixed(3)]), top: R.per[t].top.map(e => [e.p, e.mode, e.rank]), min: [R.per[t].min.p, R.per[t].min.mode, +R.per[t].min.cut.toFixed(3)] }])),
    cut: Object.fromEntries(BK.map(p => [p, { hunt: R.V[p].hunt.cut, guard: R.V[p].guard.cut, medRaw: { hunt: R.V[p].hunt.medRaw, guard: R.V[p].guard.medRaw } }])), weak: weakOut } };
}
