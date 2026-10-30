// shares.mjs - the measured shares of the T1 ability parts (Nathan 2026-10-20, decisions 1 and 2): a condition costs its raw price x the share of the
// actives where it is true (plan 5.2), the trigger on_kill costs like on_crit with a kill share, and the scaler per_ally prices the mean number of
// standing ally attackers. One number each, in balance ability_v2.share (config.json ability_v2.share).
//   node card-studio/v2sim/run.mjs shares [--runs N] [--seed S]
// Method: the standard squads of the targets run (Hunt Heroic: 8 cards of HUNT_ROLES; Dungeon run: 5 cards of DNG_ROLES), real live cards of Normal
// rarity at the active investment, the placeholder actives, the policy "best". At EVERY active use (doActive) the probe records, before the blocks run:
//   enemy_charging = the target enemy is Charging (a Cataclysm comes); foes_alive = 2 or more enemies stand; self_shield = the card has a shield;
//   self_has.<status> = the card has the status; per_ally = the number of OTHER standing attackers (attacker actives);
//   the harmful statuses on the target enemy (PR T1b: list_extra);
// and after the blocks: on_kill = an attacker active downed its target AND another enemy still stands (the trigger then has a target).
// Each share = the mean of the Hunt share and the Dungeon share (one weight for each main content). The Gauntlet is not in it (it has the Dungeon rules).
//
// PR T1b (Nathan 2026-10-20, the 6 approved recommendations), three more numbers:
//   share.self_has_each: one share for EACH card status (the probe above; recommendation 2), not the mean of four (share.self_has, T1, stays in
//     balance because a balance leaf is never removed, but no function reads it after T1b).
//   ref.list_extra (status lists, "any of"): the share that each ADDED status of a list adds to the share of the first status = the mean share of the
//     actives whose target has one given harmful status (every status of v2_status.negative, the mean of Hunt and Dungeon). A list of n statuses costs
//     the one-status share + list_extra x (n - 1), at most 1 (a condition never costs more than the block with no condition).
//   share.area_payoff (a payoff on the area hits of an attacker, T1b): at every attacker active with an area block while 2 or more enemies stand, in the
//     Dungeon (the run, and a horde room of 4 foes at floor 9, where most area hits are), the share of the OTHER standing enemies with a status / the
//     share of the main targets with that status, summed over the harmful statuses (one ratio). The payoff on the area hits costs the payoff x area.x x
//     ref.foes_other x this ratio.
//   pp.vs_smite (a support vs_status, T1b recommendation 1a): the RAW value of "x times the damage" on a support smite, measured with the value of a card
//     (strength: net Hunt Heroic damage of the card + 4 reference cards, the targets row 6): an Artillery card [sure Chill 1, smite S] against the same
//     card with vs_status Chill x2 (its own Chill is on the enemy at every smite, so the condition always holds: the raw value) and against the card with
//     smite S + 1 (5 PP more: the PP per value). vs_smite = (the measured PP of the vs_status) / (the smite price x S x (x - 1)), the mean over S = 1.2,
//     1.52 and 1.7. The support vs_status then costs smite price x S x (x - 1) x vs_smite x the condition share (frozen_share x payoff, as an attacker).
import { cardPool, pickCards, makeCard } from './cards.mjs';
import { buildSquad } from './modes.mjs';
import { Battle } from './engine.mjs';
import { huntMany, dungeonMany, strength, HUNT_ROLES, DNG_ROLES } from './experiments.mjs';
import { room } from './teams.mjs';
import { hash, mkRng, mean, table, fmt } from './util.mjs';

// The card statuses (statuses.on_card, not a shield: a shield is self_shield). 'shield' is the probe of self_shield.
export const CARD_STATUSES = ['empowered', 'focused', 'quickened', 'shield', 'poison', 'burn', 'chill', 'weakened', 'stunned', 'slowed', 'blinded', 'confused',
  'frozen', 'sleep', 'paralyzed', 'exposed'];
export const HORDE_FLOOR = 9;
export const STATUS_KINDS = [2, 3, 4, 5]; // the counts that a kinds condition may name (balance ability_v2.share.status_kinds has one share for each)
export const VS_SMITES = [1.2, 1.52, 1.7];

export function measureShares(cfg, { runs = 200, seed = 1 } = {}) {
  const pool = cardPool(cfg); const A = cfg.v2_investment.active; const NEG = cfg.v2_status.negative;
  const rec = { hunt: [], dungeon: [] }; let mode = null;
  const proto = Battle.prototype; const doActive0 = proto.doActive;
  proto.doActive = function (u, tgt) {
    const foes = this.alive('enemy');
    const r = { cls: u.cls, charging: !!tgt.charging, foes2: foes.length >= 2, shield: (u.shield || 0) > 0,
      st: Object.fromEntries(CARD_STATUSES.map((s) => [s, s === 'shield' ? (u.shield || 0) > 0 : !!u.st[s]])),
      allies: this.alive('card').filter((c) => c !== u && c.cls === 'attacker').length,
      tst: Object.fromEntries(NEG.map((s) => [s, !!tgt.st[s]])), kinds: this.negKinds(tgt) };
    const res = doActive0.call(this, u, tgt);
    r.kill = u.cls === 'attacker' && tgt.down && this.alive('enemy').length > 0;
    rec[mode].push(r);
    return res;
  };
  try {
    mode = 'hunt';
    huntMany(cfg, (rng) => buildSquad(cfg, pickCards(cfg, pool, HUNT_ROLES, 'normal', rng, A)), runs, hash(seed, 'shares-h'), { tier: 'Heroic' });
    mode = 'dungeon';
    dungeonMany(cfg, (rng) => buildSquad(cfg, pickCards(cfg, pool, DNG_ROLES, 'normal', rng, A)), runs, hash(seed, 'shares-d'));
  } finally { proto.doActive = doActive0; }
  const share = (rows, f) => (rows.length ? rows.filter(f).length / rows.length : 0);
  const both = (f, only) => {
    const h = share(rec.hunt.filter(only || (() => true)), f), d = share(rec.dungeon.filter(only || (() => true)), f);
    return { hunt: h, dungeon: d, mean: (h + d) / 2 };
  };
  const att = (r) => r.cls === 'attacker';
  const out = {
    on_kill: both((r) => r.kill, att),
    enemy_charging: both((r) => r.charging),
    foes_alive: both((r) => r.foes2),
    self_shield: both((r) => r.shield),
    self_has: Object.fromEntries(CARD_STATUSES.filter((s) => s !== 'shield').map((s) => [s, both((r) => r.st[s])])),
    per_ally: { hunt: mean(rec.hunt.filter(att).map((r) => r.allies)), dungeon: mean(rec.dungeon.filter(att).map((r) => r.allies)) },
    target_status: Object.fromEntries(NEG.map((s) => [s, both((r) => r.tst[s])])),
    // Set 2 part (c): status_kinds.<N> = the target has N or more different harmful statuses (the share of ALL actives, attackers and supports)
    status_kinds: Object.fromEntries(STATUS_KINDS.map((n) => [n, both((r) => r.kinds >= n)])),
    actives: { hunt: rec.hunt.length, dungeon: rec.dungeon.length },
  };
  out.per_ally.mean = (out.per_ally.hunt + out.per_ally.dungeon) / 2;
  // self_has: one share for the condition (decision 2): the mean over the four boons that an ally gives (Empowered, Focused, Quickened) and a shield.
  const boons = ['empowered', 'focused', 'quickened'];
  out.self_has_one = (boons.reduce((s, k) => s + out.self_has[k].mean, 0) + out.self_shield.mean) / (boons.length + 1);
  // T1b: list_extra = the mean share of the actives whose target has ONE given harmful status
  const ts = Object.values(out.target_status);
  out.list_extra = { hunt: mean(ts.map((x) => x.hunt)), dungeon: mean(ts.map((x) => x.dungeon)) };
  out.list_extra.mean = (out.list_extra.hunt + out.list_extra.dungeon) / 2;
  return out;
}

// T1b: the payoff on the area hits. At every attacker active with an area block while 2 or more enemies stand (the area hits happen), before the blocks
// run: for each harmful status, main = 1 when the target has it, other = the share of the other standing enemies with it. Ratio of the sums.
export function measureAreaPayoff(cfg, { runs = 200, seed = 1 } = {}) {
  const pool = cardPool(cfg); const A = cfg.v2_investment.active; const NEG = cfg.v2_status.negative;
  const acc = { run: { main: 0, other: 0, n: 0, others: 0 }, horde: { main: 0, other: 0, n: 0, others: 0 } }; let where = null;
  const proto = Battle.prototype; const doActive0 = proto.doActive;
  proto.doActive = function (u, tgt) {
    const foes = this.alive('enemy');
    if (u.cls === 'attacker' && u.active.blocks.some((b) => b.k === 'area') && foes.length >= 2) {
      const o = foes.filter((e) => e !== tgt); const a = acc[where];
      for (const s of NEG) { a.main += tgt.st[s] ? 1 : 0; a.other += o.filter((e) => e.st[s]).length / o.length; }
      a.n++; a.others += o.length;
    }
    return doActive0.call(this, u, tgt);
  };
  try {
    where = 'run';
    dungeonMany(cfg, (rng) => buildSquad(cfg, pickCards(cfg, pool, DNG_ROLES, 'normal', rng, A)), runs, hash(seed, 'area-run'));
    where = 'horde';
    const n = Math.max(1, Math.round(runs / 10));
    for (let i = 0; i < n; i++) room(cfg, buildSquad(cfg, pickCards(cfg, pool, DNG_ROLES, 'normal', mkRng(hash(seed, 'area-sq', i)), A)), 'horde', HORDE_FLOOR, null, 10, hash(seed, 'area-horde', i));
  } finally { proto.doActive = doActive0; }
  const main = acc.run.main + acc.horde.main, other = acc.run.other + acc.horde.other;
  return { ratio: main ? other / main : 0, run: acc.run, horde: acc.horde };
}

// T1b: the raw value of a support vs_status, in PP of the smite price (see the file head).
export function measureVsSmite(cfg, { runs = 200, seed = 1 } = {}) {
  const ap = { k: 'apply', status: 'chill', stacks: 1, chance: 1 };
  const val = (blocks, sd) => { const c2 = { ...cfg, v2_templates: { ...cfg.v2_templates, 'probe.vs': { role: 'artillery', name: 'probe', blocks } } };
    return strength(c2, makeCard(c2, { key: 'probe-vs', role: 'artillery', rarity: 'normal', template: 'probe.vs', stars: 2, level: 15 }), runs, sd); };
  const rows = VS_SMITES.map((S) => {
    const sd = hash(seed, 'vs-smite');
    const a = val([ap, { k: 'smite', x: S }], sd), b = val([ap, { k: 'smite', x: S }, { k: 'vs_status', status: 'chill', x: 2 }], sd), c = val([ap, { k: 'smite', x: S + 1 }], sd);
    const perPP = (c - a) / cfg.v2_pp.support_pp.smite; const pp = (b - a) / perPP; const formula = cfg.v2_pp.support_pp.smite * S * (2 - 1);
    return { S, pp, formula, ratio: pp / formula };
  });
  return { rows, ratio: mean(rows.map((r) => r.ratio)) };
}

export function shares(cfg, opts = {}) {
  const m = measureShares(cfg, opts); const ar = measureAreaPayoff(cfg, opts); const vs = measureVsSmite(cfg, opts);
  const row = (n, x) => [n, fmt(x.hunt, 3), fmt(x.dungeon, 3), fmt(x.mean, 3)];
  let md = `# The measured shares of the T1 ability parts\n\nStandard squads (Hunt Heroic 8 cards, Dungeon run 5 cards), Normal, active investment, policy best, ${opts.runs || 200} runs each. Actives probed: Hunt ${m.actives.hunt}, Dungeon ${m.actives.dungeon}.\n\n`;
  md += table(['Part', 'Hunt', 'Dungeon', 'Share (mean)'], [row('on_kill (attacker actives that down the target, another enemy stands)', m.on_kill), row('enemy_charging (the target is Charging)', m.enemy_charging),
    row('foes_alive (2 or more enemies stand)', m.foes_alive), row('self_shield (this card has a shield)', m.self_shield),
    ...Object.entries(m.self_has).map(([k, x]) => row(`self_has ${k}`, x)), ['per_ally (other standing attackers, attacker actives)', fmt(m.per_ally.hunt, 2), fmt(m.per_ally.dungeon, 2), fmt(m.per_ally.mean, 2)]]);
  md += `\nself_has (one share, decision 2 of T1): the mean of Empowered, Focused, Quickened and a shield = ${fmt(m.self_has_one, 3)}. PR T1b: one share for each status (the rows above): share.self_has_each.\n`;
  md += `\n## PR T1b\n\n### The status lists (ref.list_extra)\n\nThe share of the actives whose target has the status:\n\n` + table(['Status', 'Hunt', 'Dungeon', 'Share (mean)'], Object.entries(m.target_status).map(([k, x]) => row(k, x)));
  md += `\nlist_extra = the mean over the ${Object.keys(m.target_status).length} statuses = ${fmt(m.list_extra.hunt, 4)} (Hunt), ${fmt(m.list_extra.dungeon, 4)} (Dungeon), mean **${fmt(m.list_extra.mean, 4)}**.\n`;
  md += `\n### The payoff on the area hits (share.area_payoff)\n\n` + table(['Where', 'area actives', 'mean other enemies', 'main targets with a status (sum)', 'other enemies with it (sum of shares)'],
    [['Dungeon run', ar.run.n, fmt(ar.run.n ? ar.run.others / ar.run.n : 0, 2), fmt(ar.run.main, 0), fmt(ar.run.other, 2)], [`Horde room, floor ${HORDE_FLOOR}`, ar.horde.n, fmt(ar.horde.n ? ar.horde.others / ar.horde.n : 0, 2), fmt(ar.horde.main, 0), fmt(ar.horde.other, 2)]]);
  md += `\n## Set 2 part (c): the status count condition (share.status_kinds)\n\nThe share of the actives (attackers and supports, before their blocks run) whose target has N or more different harmful statuses (the count of per_kind):\n\n` + table(['N or more statuses', 'Hunt', 'Dungeon', 'Share (mean)'], STATUS_KINDS.map((n) => row(String(n), m.status_kinds[n])));
  md += `\narea_payoff = the ratio of the sums = **${fmt(ar.ratio, 4)}**.\n`;
  md += `\n### The raw value of a support vs_status (pp.vs_smite)\n\n` + table(['Smite S', 'measured PP of vs_status x2 (always true)', 'smite price x S x (x - 1)', 'ratio'], vs.rows.map((r) => [fmt(r.S, 2), fmt(r.pp, 3), fmt(r.formula, 2), fmt(r.ratio, 3)]));
  md += `\nvs_smite = the mean ratio = **${fmt(vs.ratio, 4)}**.\n`;
  const head = [`on_kill ${fmt(m.on_kill.mean, 3)}, enemy_charging ${fmt(m.enemy_charging.mean, 3)}, foes_alive ${fmt(m.foes_alive.mean, 3)}, self_shield ${fmt(m.self_shield.mean, 3)}, self_has ${fmt(m.self_has_one, 3)}, per_ally ${fmt(m.per_ally.mean, 2)}`,
    `T1b: self_has_each ${Object.entries(m.self_has).map(([k, x]) => `${k} ${fmt(x.mean, 3)}`).join(', ')}`,
    `Set 2 (c): status_kinds ${STATUS_KINDS.map((n) => `${n}+ ${fmt(m.status_kinds[n].mean, 4)}`).join(', ')}`,
    `T1b: list_extra ${fmt(m.list_extra.mean, 4)}, area_payoff ${fmt(ar.ratio, 4)} (${ar.run.n + ar.horde.n} area actives), vs_smite ${fmt(vs.ratio, 4)}`];
  return { md, head, data: { ...m, area_payoff: ar, vs_smite: vs } };
}
