// shares.mjs - the measured shares of the T1 ability parts (Nathan 2026-10-20, decisions 1 and 2): a condition costs its raw price x the share of the
// actives where it is true (plan 5.2), the trigger on_kill costs like on_crit with a kill share, and the scaler per_ally prices the mean number of
// standing ally attackers. One number each, in balance ability_v2.share (config.json ability_v2.share).
//   node card-studio/v2sim/run.mjs shares [--runs N] [--seed S]
// Method: the standard squads of the targets run (Hunt Heroic: 8 cards of HUNT_ROLES; Dungeon run: 5 cards of DNG_ROLES), real live cards of Normal
// rarity at the active investment, the placeholder actives, the policy "best". At EVERY active use (doActive) the probe records, before the blocks run:
//   enemy_charging = the target enemy is Charging (a Cataclysm comes); foes_alive = 2 or more enemies stand; self_shield = the card has a shield;
//   self_has.<status> = the card has the status; per_ally = the number of OTHER standing attackers (attacker actives);
// and after the blocks: on_kill = an attacker active downed its target AND another enemy still stands (the trigger then has a target).
// Each share = the mean of the Hunt share and the Dungeon share (one weight for each main content). The Gauntlet is not in it (it has the Dungeon rules).
import { cardPool, pickCards } from './cards.mjs';
import { buildSquad } from './modes.mjs';
import { Battle } from './engine.mjs';
import { huntMany, dungeonMany, HUNT_ROLES, DNG_ROLES } from './experiments.mjs';
import { hash, mean, table, fmt } from './util.mjs';

const CARD_STATUSES = ['empowered', 'focused', 'quickened', 'shield', 'poison', 'burn', 'chill', 'weakened', 'stunned', 'slowed', 'blinded', 'confused'];

export function measureShares(cfg, { runs = 200, seed = 1 } = {}) {
  const pool = cardPool(cfg); const A = cfg.v2_investment.active;
  const rec = { hunt: [], dungeon: [] }; let mode = null;
  const proto = Battle.prototype; const doActive0 = proto.doActive;
  proto.doActive = function (u, tgt) {
    const foes = this.alive('enemy');
    const r = { cls: u.cls, charging: !!tgt.charging, foes2: foes.length >= 2, shield: (u.shield || 0) > 0,
      st: Object.fromEntries(CARD_STATUSES.map((s) => [s, s === 'shield' ? (u.shield || 0) > 0 : !!u.st[s]])),
      allies: this.alive('card').filter((c) => c !== u && c.cls === 'attacker').length };
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
    actives: { hunt: rec.hunt.length, dungeon: rec.dungeon.length },
  };
  out.per_ally.mean = (out.per_ally.hunt + out.per_ally.dungeon) / 2;
  // self_has: one share for the condition (decision 2): the mean over the four boons that an ally gives (Empowered, Focused, Quickened) and a shield.
  const boons = ['empowered', 'focused', 'quickened'];
  out.self_has_one = (boons.reduce((s, k) => s + out.self_has[k].mean, 0) + out.self_shield.mean) / (boons.length + 1);
  return out;
}

export function shares(cfg, opts = {}) {
  const m = measureShares(cfg, opts);
  const row = (n, x) => [n, fmt(x.hunt, 3), fmt(x.dungeon, 3), fmt(x.mean, 3)];
  let md = `# The measured shares of the T1 ability parts\n\nStandard squads (Hunt Heroic 8 cards, Dungeon run 5 cards), Normal, active investment, policy best, ${opts.runs || 200} runs each. Actives probed: Hunt ${m.actives.hunt}, Dungeon ${m.actives.dungeon}.\n\n`;
  md += table(['Part', 'Hunt', 'Dungeon', 'Share (mean)'], [row('on_kill (attacker actives that down the target, another enemy stands)', m.on_kill), row('enemy_charging (the target is Charging)', m.enemy_charging),
    row('foes_alive (2 or more enemies stand)', m.foes_alive), row('self_shield (this card has a shield)', m.self_shield),
    ...Object.entries(m.self_has).map(([k, x]) => row(`self_has ${k}`, x)), ['per_ally (other standing attackers, attacker actives)', fmt(m.per_ally.hunt, 2), fmt(m.per_ally.dungeon, 2), fmt(m.per_ally.mean, 2)]]);
  md += `\nself_has (one share, decision 2): the mean of Empowered, Focused, Quickened and a shield = ${fmt(m.self_has_one, 3)}.\n`;
  const head = [`on_kill ${fmt(m.on_kill.mean, 3)}, enemy_charging ${fmt(m.enemy_charging.mean, 3)}, foes_alive ${fmt(m.foes_alive.mean, 3)}, self_shield ${fmt(m.self_shield.mean, 3)}, self_has ${fmt(m.self_has_one, 3)}, per_ally ${fmt(m.per_ally.mean, 2)}`];
  return { md, head, data: m };
}
