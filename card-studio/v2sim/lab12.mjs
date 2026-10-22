// lab12.mjs - the Combat Lab measurements L1 and L2 (plan 19.5, Nathan 2026-10-20: "before Set 1 goes live, no number changes until they run").
//   node card-studio/v2sim/run.mjs lab12 [--runs N] [--seed S] [--seeds K]
// The 20 designed teams of teams.json with the PRIVATE Set 1 actives (teams.mjs loadSet1; never in this repo), Normal rarity, in every main
// content: the Hunt day (Heroic, the neutral boss), the Dungeon run, a horde room (4 foes) and a guardian room (casual and active investment, the
// room floors of teams.mjs ROOMS), and the Gauntlet (the 5 Dungeon cards, 0 stars, level 0). Two policies: "best" (the policy of the team test; it
// holds no Set 1 payoff) and "autov2" (the Auto of PR E8: it holds a payoff active while a partner makes its status, at most hold_max turns).
// K seeds (default 5): every share is reported as the mean over the seeds and the spread (lowest to highest seed).
//
// L1 the vs_status share. Today the price of a vs_status block (and of a target_has on a control list) uses the ASSUMED share
//   v2_pp.ref.frozen_share x v2_pp.ref.payoff = 0.2 x 0.6 = 0.12. At EVERY active use (doActive, before the blocks run) the probe records whether the
//   target has a control status (Stunned, Frozen, Sleep, Paralyzed: engine CONTROL), for the attackers, the supports and the supports with a smite (a
//   support vs_status works on its smite). The squad has a "control partner" when ANOTHER card of the squad makes a control status (policy makesOf:
//   apply, on_crit, on_kill, random_apply; a Chill maker makes Frozen); "Controller partner" = such a card with the role controller.
//   L1 = the share at the actives of the squads with a control partner. Also: the share at the actives of the cards that pay off a control (a
//   vs_status, payoff_dmg, payoff_crit or target_has on a control status) - the cards that the price is for.
// L2 the area payoff share (balance ability_v2.share.area_payoff, today 0.003 from the standard squads). The method of shares.mjs measureAreaPayoff:
//   at every attacker active with an area block while 2 or more enemies stand, for each harmful status (v2_status.negative): main = 1 when the
//   target has it, other = the share of the OTHER standing enemies with it. L2 = the sum of other / the sum of main (pooled over the actives).
//   The T1b number pooled the Dungeon run and a horde room: L2 here pools the same two contents ("Dungeon run + horde"), and gives each content alone.
import { makeCard, classOf, templatePP } from './cards.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { huntDay, dungeonRun, gauntletRun, makeFoe } from './modes.mjs';
import { Battle, CONTROL } from './engine.mjs';
import { POLICIES, makesOf } from './policy.mjs';
import { loadTeams, loadSet1, withSet1, teamSpecs, ROOMS } from './teams.mjs';
import { measureAreaPayoff } from './shares.mjs';
import { hash, mkRng, mean, table, fmt, patch, HERE } from './util.mjs';

export const CONTENTS = ['hunt', 'run', 'horde', 'guardian', 'gauntlet'];
export const GROUPS = ['attacker', 'support', 'support_smite'];
export const PARTNERS = ['all', 'control', 'controller'];
export const PAY_KEYS = ['vs_status', 'payoff_dmg', 'payoff_crit', 'target_has'];
export const ASSUMED = { l1: 0.12, l2: 0.003 };
const INVS = ['casual', 'active'];
const statusesOf = (b) => b.statuses || (b.status ? [b.status] : []);
/** The control statuses that an active pays off (a vs_status, payoff_dmg, payoff_crit or target_has on a control status). */
export const controlPays = (blocks) => [...new Set(blocks.filter((b) => PAY_KEYS.includes(b.k)).flatMap(statusesOf).filter((s) => CONTROL.includes(s)))];

/** Empty tallies. l1[content][group][partner] = { n, ctl }; pay[content] = { n, hit }; l2[content] = { main, other, n, others };
 * l2pay[content] = { main, other, n } (L2 at the area actives of the cards with a payoff, on their paid statuses only);
 * focus[content] = { n, ctl } (the pairing: the actives of the card focusKey while a Controller partner is in its squad). */
export function emptyTally() {
  const l1 = {}, pay = {}, l2 = {}, l2pay = {}, focus = {};
  for (const c of CONTENTS) {
    l1[c] = Object.fromEntries(GROUPS.map((g) => [g, Object.fromEntries(PARTNERS.map((p) => [p, { n: 0, ctl: 0 }]))]));
    pay[c] = { n: 0, hit: 0 }; l2[c] = { main: 0, other: 0, n: 0, others: 0 }; l2pay[c] = { main: 0, other: 0, n: 0 }; focus[c] = { n: 0, ctl: 0 };
  }
  return { l1, pay, l2, l2pay, focus, focusKey: null };
}

// The parts of the measurement in one object, so that a test can plant a fault in one part (lab12.test.mjs; the pattern of formulas.mjs F).
export const K = {
  /** 1 when the unit has a control status (Stunned, Frozen, Sleep, Paralyzed). */
  hasControl: (x) => (CONTROL.some((s) => x.st[s]) ? 1 : 0),
  /** Does a card make a control status (its active: apply, on_crit, on_kill, random_apply; a Chill maker makes Frozen)? */
  makesControl: (cfg, c) => makesOf(cfg, c.role, c.active.blocks).some((s) => CONTROL.includes(s)),
  /** The partner flags of a card in its squad: ANOTHER card makes a control status (control), and such a card is a Controller (controller). */
  partnerOf: (cfg, u, cards) => {
    const others = cards.filter((c) => c !== u);
    return { all: true, control: others.some((c) => K.makesControl(cfg, c)), controller: others.some((c) => c.role === 'controller' && K.makesControl(cfg, c)) };
  },
  /** The L1 groups of an active: attacker, or support (+ support_smite when the active has a smite: a support vs_status works on its smite). */
  groupsOf: (u) => (u.cls === 'attacker' ? ['attacker'] : u.active.blocks.some((b) => b.k === 'smite') ? ['support', 'support_smite'] : ['support']),
  /** One L2 row: main = 1 for each status the target has, other = the share of the OTHER standing enemies with it, summed over the statuses. */
  areaRow: (tgt, foes, statuses) => {
    const o = foes.filter((e) => e !== tgt); let main = 0, other = 0;
    for (const s of statuses) { main += tgt.st[s] ? 1 : 0; other += o.filter((e) => e.st[s]).length / o.length; }
    return { main, other, others: o.length };
  },
  /** Does an attacker active make area hits now (an area block, 2 or more enemies standing)? */
  areaNow: (u, foes) => u.cls === 'attacker' && u.active.blocks.some((b) => b.k === 'area') && foes.length >= 2,
  /** The L2 ratio of the sums (null = no main target with a status). */
  ratio: (main, other) => (main ? other / main : null),
  /** The probe runs BEFORE the blocks of the active (a block reads its condition before it runs). */
  before: true,
};
export const partnerOf = (cfg, u, cards) => K.partnerOf(cfg, u, cards);

/** One active use: adds it to the tally T of content c. Reads the battle state only. */
export function recordActive(T, c, cfg, battle, u, tgt) {
  if (!u._l12) u._l12 = { partner: K.partnerOf(cfg, u, battle.cards), pays: controlPays(u.active.blocks),
    areaPays: u.cls === 'attacker' && u.active.blocks.some((b) => b.k === 'area') ? [...new Set(u.active.blocks.filter((b) => b.k === 'payoff_dmg' || b.k === 'payoff_crit').flatMap(statusesOf))] : [] };
  const ctl = K.hasControl(tgt);
  for (const g of K.groupsOf(u)) for (const p of PARTNERS) if (u._l12.partner[p]) { const x = T.l1[c][g][p]; x.n++; x.ctl += ctl; }
  if (u._l12.pays.length) { T.pay[c].n++; T.pay[c].hit += u._l12.pays.some((s) => tgt.st[s]) ? 1 : 0; }
  if (T.focusKey && u.key === T.focusKey && u._l12.partner.controller) { T.focus[c].n++; T.focus[c].ctl += ctl; }
  const foes = battle.alive('enemy');
  if (!K.areaNow(u, foes)) return;
  const r = K.areaRow(tgt, foes, cfg.v2_status.negative); const a = T.l2[c];
  a.main += r.main; a.other += r.other; a.n++; a.others += r.others;
  if (u._l12.areaPays.length) { const p = K.areaRow(tgt, foes, u._l12.areaPays); const b = T.l2pay[c]; b.main += p.main; b.other += p.other; b.n++; }
}

/** Runs fn with the probe on Battle.prototype.doActive: each active adds to T under the content where() (null = not recorded). */
export function withProbe(T, where, fn) {
  const proto = Battle.prototype; const doActive0 = proto.doActive;
  proto.doActive = function (u, tgt) {
    const c = where();
    if (!c) return doActive0.call(this, u, tgt);
    if (K.before) { recordActive(T, c, this.cfg, this, u, tgt); return doActive0.call(this, u, tgt); }
    const res = doActive0.call(this, u, tgt); recordActive(T, c, this.cfg, this, u, tgt); return res;
  };
  try { return fn(); } finally { proto.doActive = doActive0; }
}

/** A horde or guardian room with a chosen policy (teams.mjs room() uses the policy best only). */
function roomRun(cfg, squad, kind, floor, runs, seed, policy) {
  const n = kind === 'horde' ? 4 : 1;
  for (let i = 0; i < runs; i++) {
    const rng = mkRng(hash(seed, 'room', kind, floor, i));
    const foes = Array.from({ length: n }, () => makeFoe(cfg, floor, kind === 'horde' ? 3 : 5, kind, rng));
    new Battle(cfg, { cards: squad.map((c) => ({ ...c, hp: c.maxHp, shield: 0 })), enemies: foes, mode: 'dungeon', policy: POLICIES[policy], seed: hash(seed, 'room', kind, i) }).run();
  }
}

/** The probe over the designed teams for one seed and one policy. cfg must hold the Set 1 templates (withSet1). Returns the tally. */
export function probeTeams(cfg, teamList, { runs = 40, seed = 1, policy = 'best', contents = CONTENTS } = {}) {
  const T = emptyTally(); let where = null;
  withProbe(T, () => where, () => {
    for (const t of teamList) {
      T.focusKey = t.focus || null;
      for (const inv of INVS) {
        const I = cfg.v2_investment[inv];
        const hSq = teamSpecs(cfg, t.hunt, I).map((s) => makeCard(cfg, s)), dSq = teamSpecs(cfg, t.dungeon, I).map((s) => makeCard(cfg, s));
        if (contents.includes('hunt')) { where = 'hunt'; for (let i = 0; i < runs; i++) huntDay(cfg, hSq, { tier: 'Heroic', sigs: [], policy, seed: hash(seed, 'l12-hunt', t.id, inv, i) }); }
        if (contents.includes('run')) { where = 'run'; for (let i = 0; i < runs; i++) dungeonRun(cfg, dSq, { policy, seed: hash(seed, 'l12-run', t.id, inv, i) }); }
        if (contents.includes('horde')) { where = 'horde'; roomRun(cfg, dSq, 'horde', ROOMS[inv].horde, runs, hash(seed, 'l12-horde', t.id, inv), policy); }
        if (contents.includes('guardian')) { where = 'guardian'; roomRun(cfg, dSq, 'guardian', ROOMS[inv].guardian, runs, hash(seed, 'l12-guard', t.id, inv), policy); }
      }
      if (contents.includes('gauntlet')) { where = 'gauntlet'; const gs = teamSpecs(cfg, t.dungeon); for (let i = 0; i < runs; i++) gauntletRun(cfg, gs, {}, { policy, seed: hash(seed, 'l12-gauntlet', t.id, i) }); }
      where = null;
    }
  });
  return T;
}

/** The pairing (L1 for the support smites): the 20 designed teams never put an Artillery card beside a Controller partner. For each Set 1
 * Artillery card (a support with a smite) and each designed squad (Hunt 8 or Dungeon 5) with a Controller that makes a control status, the squad
 * with its LAST support that is not a Controller replaced by that card. The tally focus measures that card only. Card keys only. */
export function pairTeams(cfg, set1, teamList) {
  const roleOf = (k) => set1[k]?.role;
  const makesCtl = (k) => roleOf(k) === 'controller' && K.makesControl(cfg, { role: 'controller', active: { blocks: set1[k].blocks } });
  const arts = Object.keys(set1).filter((k) => set1[k].role === 'artillery' && set1[k].blocks.some((b) => b.k === 'smite'));
  const swap = (keys, k) => { if (!keys.some(makesCtl) || keys.includes(k)) return null;
    const i = keys.map((x, j) => [x, j]).filter(([x]) => roleOf(x) && cfg.v2_templates[`s1.${x}`] && roleOf(x) !== 'controller' && classOf(roleOf(x)) === 'support').map(([, j]) => j).pop();
    return i === undefined ? null : keys.map((x, j) => (j === i ? k : x)); };
  const out = [];
  for (const k of arts) for (const t of teamList) {
    const hunt = swap(t.hunt, k), dungeon = swap(t.dungeon, k);
    if (hunt || dungeon) out.push({ id: `${t.id}+${k}`, focus: k, hunt: hunt || t.hunt, dungeon: dungeon || t.dungeon });
  }
  return out;
}

const sumOver = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
/** The numbers of one tally. l1[content|'all'][group][partner] = share (null = no actives); l2[content|'pooled'|'all'] = ratio. */
export function l12Numbers(T) {
  const l1 = {}, n1 = {}, pay = {}, l2 = {}, n2 = {}, l2pay = {}, focus = {};
  const cs = [...CONTENTS, 'all'];
  for (const c of cs) {
    const src = c === 'all' ? CONTENTS : [c]; l1[c] = {}; n1[c] = {};
    for (const g of GROUPS) { l1[c][g] = {}; n1[c][g] = {};
      for (const p of PARTNERS) { const n = sumOver(src, (k) => T.l1[k][g][p].n), x = sumOver(src, (k) => T.l1[k][g][p].ctl); l1[c][g][p] = n ? x / n : null; n1[c][g][p] = n; } }
    const pn = sumOver(src, (k) => T.pay[k].n); pay[c] = { share: pn ? sumOver(src, (k) => T.pay[k].hit) / pn : null, n: pn };
    const fn = sumOver(src, (k) => T.focus[k].n); focus[c] = { share: fn ? sumOver(src, (k) => T.focus[k].ctl) / fn : null, n: fn };
  }
  const ratio = (src) => K.ratio(sumOver(src, (k) => T.l2[k].main), sumOver(src, (k) => T.l2[k].other));
  for (const c of CONTENTS) { l2[c] = ratio([c]); n2[c] = T.l2[c].n; }
  l2.pooled = ratio(['run', 'horde']); n2.pooled = T.l2.run.n + T.l2.horde.n;   // the T1b contents (Dungeon run + horde room)
  l2.all = ratio(CONTENTS); n2.all = sumOver(CONTENTS, (k) => T.l2[k].n);
  l2pay.all = { ratio: K.ratio(sumOver(CONTENTS, (k) => T.l2pay[k].main), sumOver(CONTENTS, (k) => T.l2pay[k].other)), n: sumOver(CONTENTS, (k) => T.l2pay[k].n) };
  return { l1, n1, pay, l2, n2, l2pay, focus };
}

/** Mean and spread over the seeds of one number (nulls skipped). */
export const spread = (xs) => { const v = xs.filter((x) => typeof x === 'number'); return v.length ? { mean: mean(v), lo: Math.min(...v), hi: Math.max(...v), n: v.length } : null; };

/** The measurement: K seeds x the two policies. Returns { policies: { [policy]: { seeds: [numbers], ... } }, standard } (plain data, no text). */
export function measureL12(cfg0, { runs = 40, seed = 1, seeds = 5, teamList, actives, policies = ['best', 'autov2'], contents = CONTENTS, standard = true, pairing = true } = {}) {
  const A = actives || loadSet1(); const cfg = withSet1(cfg0, A); const TM = teamList || loadTeams();
  const PT = pairing ? pairTeams(cfg, A, TM) : [], pruns = Math.max(1, Math.round(runs / 4));
  const out = { runs, seeds: Array.from({ length: seeds }, (_, i) => seed + i), teams: TM.length, pairs: PT.length, pairRuns: pruns, policies: {}, pairing: {} };
  for (const pol of policies) out.policies[pol] = out.seeds.map((s) => l12Numbers(probeTeams(cfg, TM, { runs, seed: s, policy: pol, contents })));
  if (PT.length) for (const pol of policies) out.pairing[pol] = out.seeds.map((s) => l12Numbers(probeTeams(cfg, PT, { runs: pruns, seed: s, policy: pol, contents })).focus);
  // the T1b reference: the standard squads (placeholder actives), the same method (shares.mjs), one seed
  if (standard) out.standard = measureAreaPayoff(cfg0, { runs: Math.max(200, runs * 5), seed }).ratio;
  return out;
}

/** The headline numbers (mean and spread over the seeds) of a measurement. */
export function l12Summary(M) {
  const S = {};
  for (const [pol, rows] of Object.entries(M.policies)) {
    const s = { l1: {}, pay: {}, l2: {}, n1: {}, n2: {} };
    for (const c of [...CONTENTS, 'all']) {
      s.l1[c] = {}; s.n1[c] = {};
      for (const g of GROUPS) { s.l1[c][g] = {}; s.n1[c][g] = {}; for (const p of PARTNERS) { s.l1[c][g][p] = spread(rows.map((r) => r.l1[c][g][p])); s.n1[c][g][p] = mean(rows.map((r) => r.n1[c][g][p])); } }
      s.pay[c] = { ...spread(rows.map((r) => r.pay[c].share)), actives: mean(rows.map((r) => r.pay[c].n)) };
      const pr = M.pairing?.[pol]; s.pair ||= {}; s.pair[c] = pr ? { ...spread(pr.map((r) => r[c].share)), actives: mean(pr.map((r) => r[c].n)) } : null;
    }
    s.l2pay = { ...spread(rows.map((r) => r.l2pay.all.ratio)), actives: mean(rows.map((r) => r.l2pay.all.n)) };
    for (const c of [...CONTENTS, 'pooled', 'all']) { s.l2[c] = spread(rows.map((r) => r.l2[c])); s.n2[c] = mean(rows.map((r) => r.n2[c])); }
    S[pol] = s;
  }
  return S;
}

/** The rows of the Admin Lab report (src/combat-lab-routes.js GET /l12): one row for each headline number, with the number that the price uses
 * today (cfg) and the mean and spread of each policy. S = l12Summary(M). Plain numbers only (no card key, no card text). */
export function l12Rows(S, cfg) {
  const R = cfg.v2_pp.ref, now1 = R.frozen_share * R.payoff, now2 = cfg.ability_v2.share?.area_payoff ?? null;
  const pick = (f) => Object.fromEntries(Object.entries(S).map(([p, s]) => { const x = f(s); return [p, x && typeof x.mean === 'number' ? { mean: x.mean, lo: x.lo, hi: x.hi } : null]; }));
  const L1 = (label, f) => ({ id: 'L1', label, now: now1, by: pick(f) });
  const L2 = (label, f) => ({ id: 'L2', label, now: now2, by: pick(f) });
  return [
    L1('Attackers, squad with a control partner (all contents)', (s) => s.l1.all.attacker.control),
    L1('Supports, squad with a control partner (all contents)', (s) => s.l1.all.support.control),
    L1('Support smites, squad with a control partner (all contents)', (s) => s.l1.all.support_smite.control),
    L1('Attackers, squad with a Controller partner (all contents)', (s) => s.l1.all.attacker.controller),
    L1('Supports, squad with a Controller partner (all contents)', (s) => s.l1.all.support.controller),
    L1('Cards that pay off a control, on their own status (all contents)', (s) => s.pay.all),
    L1('Pairing: an Artillery card beside a Controller (all contents)', (s) => s.pair?.all),
    ...CONTENTS.map((c) => L1(`Attackers, control partner: ${c}`, (s) => s.l1[c].attacker.control)),
    L2('Dungeon run + horde room (the T1b contents)', (s) => s.l2.pooled),
    L2('Dungeon run', (s) => s.l2.run), L2('Horde room', (s) => s.l2.horde), L2('Gauntlet', (s) => s.l2.gauntlet), L2('All contents', (s) => s.l2.all),
    L2('Area attackers with a payoff, on their paid statuses', (s) => s.l2pay),
  ];
}

const f3 = (x) =>(x ? `${fmt(x.mean, 4)} (${fmt(x.lo, 4)}-${fmt(x.hi, 4)})` : '-');
export function lab12(cfg, opts = {}) {
  const seeds = opts.seeds ?? 5, runs = opts.runs ?? 40;
  const M = measureL12(cfg, { ...opts, runs, seeds }); const S = l12Summary(M);
  const pols = Object.keys(S); const lab = { hunt: 'Hunt (Heroic)', run: 'Dungeon run', horde: 'Horde room', guardian: 'Guardian room', gauntlet: 'Gauntlet', all: 'All contents', pooled: 'Dungeon run + horde (the T1b contents)' };
  let md = `# Combat Lab L1 and L2 (plan 19.5)\n\nThe ${M.teams} designed teams (teams.json) with the private Set 1 actives, Normal rarity, casual and active investment. ${runs} runs a team, content and investment for each seed; seeds ${M.seeds.join(', ')}. A cell = the mean over the seeds (the lowest seed - the highest seed).\n\n`;
  md += `## L1 the vs_status share (assumed today: frozen_share x payoff = ${ASSUMED.l1})\n\nThe share of the actives where the target has a control status (Stunned, Frozen, Sleep, Paralyzed). Control partner = another card of the squad makes a control status (a Chill maker makes Frozen). Controller partner = such a card with the role controller.\n\n`;
  for (const pol of pols) {
    md += `### Policy ${pol}\n\n` + table(['Content', 'Attackers, control partner', 'Supports, control partner', 'Support smites, control partner', 'Attackers, Controller partner', 'Supports, Controller partner', 'All actives (any squad)', 'Actives probed (attacker / support, control partner)'],
      [...CONTENTS, 'all'].map((c) => { const x = S[pol].l1[c], n = S[pol].n1[c];
        const allA = x.attacker.all && x.support.all ? { mean: (x.attacker.all.mean * n.attacker.all + x.support.all.mean * n.support.all) / (n.attacker.all + n.support.all), lo: NaN, hi: NaN } : null;
        return [lab[c], f3(x.attacker.control), f3(x.support.control), f3(x.support_smite.control), f3(x.attacker.controller), f3(x.support.controller), allA ? fmt(allA.mean, 4) : '-', `${fmt(n.attacker.control, 0)} / ${fmt(n.support.control, 0)}`]; }));
    md += `\nThe cards that pay off a control (a vs_status, payoff_dmg, payoff_crit or target_has on a control status): the share of their actives where the target has the paid status: ` +
      [...CONTENTS, 'all'].map((c) => `${lab[c]} ${f3(S[pol].pay[c].mean !== undefined ? S[pol].pay[c] : null)} (${fmt(S[pol].pay[c].actives, 0)} actives)`).join(', ') + '.\n\n';
  }
  md += `### Pairing: the support smites beside a Controller\n\nThe ${M.teams} designed teams never put an Artillery card (a support smite) beside a Controller partner that makes a control. The pairing puts each Set 1 Artillery card in place of the last support (not a Controller) of each designed squad with such a Controller (${M.pairs} squads, ${M.pairRuns} runs each a content and investment) and measures that card only: the share of its actives where the target has a control status.\n\n`;
  md += table(['Content', ...pols.map((p) => `policy ${p}`), ...pols.map((p) => `actives, ${p}`)], [...CONTENTS, 'all'].map((c) => [lab[c], ...pols.map((p) => f3(S[p].pair?.[c]?.mean !== undefined ? S[p].pair[c] : null)), ...pols.map((p) => fmt(S[p].pair?.[c]?.actives ?? 0, 0))])) + '\n';
  md += `## L2 the area payoff share (today share.area_payoff = ${ASSUMED.l2}; the standard squads measured now: ${fmt(M.standard, 4)})\n\nAt the attacker actives with an area block while 2 or more enemies stand: the sum over the harmful statuses of the share of the other enemies with the status / the sum of the main targets with it.\n\n`;
  md += table(['Content', ...pols.map((p) => `L2, policy ${p}`), ...pols.map((p) => `area actives, ${p}`)],
    ['run', 'horde', 'guardian', 'gauntlet', 'hunt', 'pooled', 'all'].map((c) => [lab[c], ...pols.map((p) => f3(S[p].l2[c])), ...pols.map((p) => fmt(S[p].n2[c], 0))]));
  md += `\nThe same ratio at the area actives of the attackers that have a payoff (payoff_dmg or payoff_crit), on their paid statuses only (all contents): ` + pols.map((p) => `${p} ${f3(S[p].l2pay.mean !== undefined ? S[p].l2pay : null)} (${fmt(S[p].l2pay.actives, 0)} actives)`).join(', ') + '.\n';
  const P = S[pols[0]];
  const head = [
    `L1 (${pols[0]}, all contents, control partner): attackers ${f3(P.l1.all.attacker.control)}, supports ${f3(P.l1.all.support.control)}, support smites ${f3(P.l1.all.support_smite.control)}; assumed ${ASSUMED.l1}`,
    ...pols.map((p) => `L1 control payers (${p}): ${f3(S[p].pay.all.mean !== undefined ? S[p].pay.all : null)} of ${fmt(S[p].pay.all.actives, 0)} actives; support smites beside a Controller (pairing): ${f3(S[p].pair?.all?.mean !== undefined ? S[p].pair.all : null)} of ${fmt(S[p].pair?.all?.actives ?? 0, 0)} actives`),
    ...pols.map((p) => `L2 (${p}): Dungeon run + horde ${f3(S[p].l2.pooled)}, all contents ${f3(S[p].l2.all)}, area payoff cards only ${f3(S[p].l2pay.mean !== undefined ? S[p].l2pay : null)}; assumed ${ASSUMED.l2}, standard squads now ${fmt(M.standard, 4)}`),
  ];
  return { md, head, data: { measure: M, summary: S } };
}

// ---------------------------------------------------------------------------------------------------- the price effect of a recommendation
// node card-studio/v2sim/run.mjs lab12prices   (after run.mjs lab12: it reads out/v2sim/lab12.json)
// The PP of each ability (cards.mjs templatePP = SQL ability_v2_block_pp, proven equal by the T1b test) and the validator PP rule (|PP - budget| <=
// tolerance; the other rules of ability_v2_check do not read these numbers) with today's numbers and with each variant. The abilities: the 42
// placeholder templates (public) and the PRIVATE Set 1 validator batch ($T1_SET1_BATCH, default ../discord-card-ideas/batches/set1-t1.json; COUNTS
// ONLY, never a card key or text). A variant = a config patch for the attackers and one for the supports (a split needs a new balance leaf).
export const SET1_BATCH = () => process.env.T1_SET1_BATCH || join(HERE, '..', '..', '..', 'discord-card-ideas', 'batches', 'set1-t1.json');
/** abilities = [{role, blocks}]. Returns {changed, largest: {delta, rel}, acceptedBefore, acceptedAfter, n} (counts only). */
export function priceEffect(cfg, abilities, { att = {}, sup = {} } = {}) {
  const ca = patch(cfg, att), cs = patch(cfg, sup); let changed = 0, okB = 0, okA = 0, largest = { delta: 0, rel: 0 };
  const P = cfg.v2_pp; const ok = (pp) => Math.abs(pp - P.budget) <= P.tolerance + 1e-9;
  abilities.forEach((a, i) => {
    const id = `l12.${i}`; const t = { role: a.role, name: 'x', blocks: a.blocks };
    const pp0 = templatePP({ ...cfg, v2_templates: { ...cfg.v2_templates, [id]: t } }, id);
    const c1 = classOf(a.role) === 'attacker' ? ca : cs; const pp1 = templatePP({ ...c1, v2_templates: { ...c1.v2_templates, [id]: t } }, id);
    if (Math.abs(pp1 - pp0) > 1e-9) changed++;
    if (Math.abs(pp1 - pp0) > Math.abs(largest.delta)) largest = { delta: pp1 - pp0, rel: pp1 / pp0 - 1 };
    okB += ok(pp0) ? 1 : 0; okA += ok(pp1) ? 1 : 0;
  });
  return { n: abilities.length, changed, largest, acceptedBefore: okB, acceptedAfter: okA };
}
/** The variants of the recommendation from a lab12 summary S (the shares that the prices would use). */
export function l12Variants(cfg, S) {
  const R = cfg.v2_pp.ref; const fs = (share) => ({ v2_pp: { ref: { frozen_share: share / R.payoff } } }); const ap = (x) => ({ ability_v2: { share: { area_payoff: x } } });
  const payA = S.autov2.pay.all.mean, pairA = S.autov2.pair.all.mean, l2a = S.autov2.l2.pooled.mean, l2b = S.best.l2.pooled.mean, l2p = S.autov2.l2pay.mean;
  return [
    { id: 'L1-att', what: `vs_status / target_has control share = the control payers, Auto v2 (${fmt(payA, 3)}), one number for both classes`, att: fs(payA), sup: fs(payA) },
    { id: 'L1-att-best', what: `vs_status / target_has control share = the control payers, policy best (${fmt(S.best.pay.all.mean, 3)}), one number for both classes`, att: fs(S.best.pay.all.mean), sup: fs(S.best.pay.all.mean) },
    { id: 'L1-sup', what: `vs_status / target_has control share = the support smites beside a Controller, Auto v2 (${fmt(pairA, 3)}), one number`, att: fs(pairA), sup: fs(pairA) },
    { id: 'L1-split', what: `a split: attackers ${fmt(payA, 3)}, supports ${fmt(pairA, 3)} (a new balance leaf)`, att: fs(payA), sup: fs(pairA) },
    { id: 'L2-autov2', what: `share.area_payoff = Dungeon run + horde, Auto v2 (${fmt(l2a, 4)})`, att: ap(l2a), sup: ap(l2a) },
    { id: 'L2-best', what: `share.area_payoff = Dungeon run + horde, policy best (${fmt(l2b, 4)}, the T1b probe)`, att: ap(l2b), sup: ap(l2b) },
    { id: 'L2-paycards', what: `share.area_payoff = the area payoff cards on their paid statuses, Auto v2 (${fmt(l2p, 4)})`, att: ap(l2p), sup: ap(l2p) },
  ];
}
export function lab12prices(cfg) {
  const f = join(HERE, '..', 'out', 'v2sim', 'lab12.json');
  if (!existsSync(f)) throw new Error(`lab12prices: run node card-studio/v2sim/run.mjs lab12 first (${f} is missing)`);
  const S = JSON.parse(readFileSync(f, 'utf8')).summary;
  const sets = { 'placeholder templates': Object.keys(cfg.v2_templates).filter((t) => !t.startsWith('_')).map((t) => ({ role: cfg.v2_templates[t].role, blocks: cfg.v2_templates[t].blocks })) };
  if (existsSync(SET1_BATCH())) sets['Set 1 (private, counts only)'] = JSON.parse(readFileSync(SET1_BATCH(), 'utf8')).rows.map((r) => ({ role: r.role, blocks: r.ability.blocks }));
  const V = l12Variants(cfg, S); const rows = [];
  for (const v of V) for (const [name, list] of Object.entries(sets)) { const e = priceEffect(cfg, list, v); rows.push([v.id, v.what, name, e.n, e.changed, `${fmt(e.largest.delta, 2)} PP (${fmt(e.largest.rel * 100, 1)}%)`, `${e.acceptedBefore} -> ${e.acceptedAfter}`]); }
  const md = `# The price effect of the L1 and L2 variants\n\nToday: frozen_share x payoff = ${fmt(cfg.v2_pp.ref.frozen_share * cfg.v2_pp.ref.payoff, 3)}, share.area_payoff = ${cfg.ability_v2.share.area_payoff}. The validator PP rule: ${cfg.v2_pp.budget} +/- ${cfg.v2_pp.tolerance} PP.\n\n` +
    table(['Variant', 'What', 'Abilities', 'n', 'price changes', 'largest change', 'validator PP rule: accepted today -> with the variant'], rows);
  return { md, head: rows.map((r) => `${r[0]} ${r[2]}: ${r[4]} of ${r[3]} change, largest ${r[5]}, accepted ${r[6]}`), data: { rows } };
}
