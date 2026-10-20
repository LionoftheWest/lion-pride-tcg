// cards.mjs - the card factory: roles, placeholder unique actives, PP prices, point builds, card stats.
//
// Placeholder unique active (deterministic, documented in README.md):
//   template = templatesOf(role)[hash(subject key) mod count]. The numbers come from config v2_templates (10 PP each).
//   Rarity scales the numbers: support amounts x F (F = (CP_base / 25)^0.2, so rarity AND stars count),
//   and an enabler adds +1 stack at Full Art, Event and Gold. Attackers scale through CP.
import { F } from './formulas.mjs';
import { hash, loadFixture } from './util.mjs';

export const ATTACKER_ROLES = ['breaker', 'striker', 'flurry', 'finisher', 'survivor', 'cleaver'];
export const SUPPORT_ROLES = ['warden', 'medic', 'controller', 'spotter', 'herald', 'artillery'];
export const ROLES = [...ATTACKER_ROLES, ...SUPPORT_ROLES];
export const STATS = ['atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd'];
export const classOf = role => ATTACKER_ROLES.includes(role) ? 'attacker' : 'support';

export function roleOf(cfg, subj) {
  const M = cfg.v2_role_map;
  if (M.overrides[subj.key]) return M.overrides[subj.key];
  const r = subj.ability && M.effect[subj.ability.effect];
  if (r) return r;
  return ['Character', 'Creature'].includes(subj.type) ? 'striker' : 'artillery';
}

// All live subjects with their role and finishes.
export function cardPool(cfg) {
  const fx = loadFixture();
  return fx.subjects.map(s => ({ key: s.key, name: s.name, type: s.type, cp_mod: s.cp_mod, role: roleOf(cfg, s), traits: s.traits,
    finishes: s.finishes.map(f => f.rarity), pullable: s.finishes.filter(f => f.pool).map(f => f.rarity) }));
}

export function templatesOf(cfg, role) { return Object.keys(cfg.v2_templates).filter(k => !k.startsWith('_') && cfg.v2_templates[k].role === role).sort(); }
export function templateFor(cfg, subjKey, role) { const t = templatesOf(cfg, role); return t[hash('template', subjKey) % t.length]; }
export function chargeOf(cfg, tid) { const t = cfg.v2_templates[tid]; return t.charge ?? cfg.v2_charge[classOf(t.role)]; }

// ---------- PP prices (base numbers, before rarity scaling) ----------
// PR T1 (Nathan 2026-10-20): the attachments. An attachment follows the block it changes (its host, the block right before it; one each):
// the gates (the host works only while the condition holds; price = host x (share - 1), so the pair costs the host x share), target_has (the host
// amount x x while the enemy has a status), ally_below (x x while the ally is below the line), more_per (+v for each stack or status on the enemy)
// and coin (the host amount is v with the chance, else alt).
export const GATES = ['self_has', 'enemy_charging', 'foes_alive', 'self_shield'];
export const ATTACH = [...GATES, 'target_has', 'ally_below', 'more_per', 'coin'];
export const AMOUNT_FIELD = { shield: 'v', shield_all: 'v', heal: 'v', heal_all: 'v', empower: 'v', rally: 'v', quicken: 'v', focus: 'crit', apply: 'value' };
export const CONTROL_ST = ['stunned', 'frozen', 'sleep', 'paralyzed'];
// The numbers of a support block that the factor F scales in a fight (makeCard; SQL ability_blocks.scaled): v, x, value and alt, not the multipliers.
export const scaledFields = (b) => (['vs_status', 'consume', 'target_has', 'ally_below'].includes(b.k) ? [] : ['v', 'x', 'value', 'alt']);
export function blockPP(cfg, tid, b) {
  const t = cfg.v2_templates[tid]; const P = cfg.v2_pp, R = P.ref, A = cfg.ability_v2.pp; const C = chargeOf(cfg, tid) + 1;
  const att = classOf(t.role) === 'attacker';
  const k = A.att_k / C;                // attackers: att_k (40) x V / C   (config ability_v2 = balance ability_v2, PR E6)
  const sk = A.sup_cycle / C;           // supports: library price x sup_cycle (2) / C
  const strikes = (t.blocks.find(x => x.k === 'strikes') || { n: 1 }).n;
  const B = t.blocks; const i = B.indexOf(b); const host = i > 0 ? B[i - 1] : null;
  const sv = (st, b) => { const base = P.status_pp[st];
    if (['exposed', 'weakened', 'mark'].includes(st)) return base * (b.value ?? 0.1);
    if (['poison', 'burn', 'chill'].includes(st)) return base * (b.stacks || 1);
    if (st === 'slowed') return base; return base; };
  switch (b.k) {
    case 'hit': return k * (b.x - 1);
    case 'strikes': return k * (b.n * b.x - 1);
    case 'crit_add': if (att) return k * b.v; // support: crit chance on the smite, priced at the crit damage it adds (PR T1)
      return P.support_pp.smite * B.find(x => x.k === 'smite').x * b.v * (cfg.v2_stats.crd.base - 1) * sk;
    case 'per_ally': return k * b.v * cfg.ability_v2.ref.per_ally;
    case 'random_apply': return b.options.reduce((s, o) => s + sv(o.status, o), 0) / b.options.length * (b.chance ?? 1) * (att ? strikes / C : sk);
    case 'on_kill': return sv(b.status, b) * b.chance * cfg.ability_v2.share.on_kill * (att ? 1 / C : sk);
    case 'self_has': case 'enemy_charging': case 'foes_alive': case 'self_shield': return blockPP(cfg, tid, host) * (cfg.ability_v2.share[b.k] - 1);
    case 'target_has': { const sts = b.statuses || [b.status];
      return blockPP(cfg, tid, host) * (b.x - 1) * R.payoff * (sts.every(x => CONTROL_ST.includes(x)) ? R.frozen_share : 1); }
    case 'ally_below': return blockPP(cfg, tid, host) * (b.x - 1) * b.line;
    case 'more_per': return blockPP(cfg, tid, { ...host, [AMOUNT_FIELD[host.k]]: b.v }) * (b.status ? R.stacks : R.kinds) * R.payoff;
    case 'coin': return (blockPP(cfg, tid, { ...host, [AMOUNT_FIELD[host.k]]: b.alt }) - blockPP(cfg, tid, host)) * (1 - b.chance);
    case 'pierce': return k * b.v * R.enemy_def / (1 - R.enemy_def);
    case 'true_strike': return k * R.miss;
    case 'area': return att ? k * b.x * R.foes_other : P.support_pp.smite * b.x * R.foes_other * sk; // support area smite (P3): smite price x the other foes
    case 'cure': return P.support_pp.cure * sk; // Revision 5: the cure and its immunity are free (0 PP)
    case 'payoff_dmg': return att ? k * b.v * R.payoff : P.support_pp.smite * b.v * sk * R.payoff; // support: +v on the smite (PR T1)
    case 'payoff_crit': return k * b.v * R.payoff;
    case 'per_stack': return k * b.v * R.stacks * R.payoff;
    case 'per_kind': return k * b.v * R.kinds * R.payoff;
    case 'vs_status': return (att ? k : sk * A.sup_vs_k) * (b.x - 1) * R.frozen_share * R.payoff;
    case 'execute': return k * b.v * b.line;
    case 'line_status': return A.line_status * b.statuses.length;
    case 'lifesteal': case 'guard_up': return k * b.v * R.heal_value;
    case 'shield_break': return k * (b.x - 1) * R.shield_share * R.payoff;
    case 'on_crit': return sv(b.status, b) * b.chance * R.crit_share * (att ? 1 / C : sk) * (b.status === 'stunned' ? 1 : 1);
    case 'apply': {
      if (b.per) { // PR T1: the value x the count of stacks (or statuses) on the enemy: the count this active adds + the reference count x the payoff share
        const prev = B.slice(0, i).filter(x => x.k === 'apply' && x.chance >= 1);
        const own = b.per === 'kinds' ? new Set(prev.map(x => x.status).filter(x => x !== b.status)).size : prev.filter(x => x.status === b.per).reduce((s, x) => s + (x.stacks || 1), 0);
        return sv(b.status, b) * b.chance * sk * (own + (b.per === 'kinds' ? R.kinds : R.stacks) * R.payoff);
      }
      return sv(b.status, b) * b.chance * (att ? strikes / C : sk) * (b.all ? 1 + R.foes_other : 1); }
    case 'shield': return P.support_pp.shield * b.v * sk;
    case 'shield_all': return P.support_pp.shield_all * b.v * sk;
    case 'heal': return P.support_pp.heal * b.v * sk;
    case 'heal_all': return P.support_pp.heal_all * b.v * sk; // all_allies (PR E6)
    case 'empower': return P.support_pp.empower * b.v * sk;
    case 'rally': return P.support_pp.rally * b.v * sk;
    case 'quicken': return P.support_pp.quicken * b.v * sk * (b.all ? A.quicken_all_x : 1);
    case 'focus': return (P.support_pp.focus_crit * b.crit + P.support_pp.focus_crd * (b.crd || 0)) * sk;
    case 'smite': return P.support_pp.smite * b.x * sk;
    case 'cleanse': return P.support_pp.cleanse * sk;
    case 'dispel': return P.support_pp.dispel * sk;
    case 'consume': return P.support_pp.consume * b.x * sk;
    default: throw new Error(`blockPP: unknown block ${b.k} in ${tid}`);
  }
}
export function templatePP(cfg, tid) { return cfg.v2_templates[tid].blocks.reduce((s, b) => s + blockPP(cfg, tid, b), 0); }

// ---------- point builds ----------
export function allocate(cfg, weights, points) {
  const max = cfg.v2_stats.max_per_stat; const out = Object.fromEntries(STATS.map(s => [s, 0]));
  let left = points; const w = { ...weights };
  for (let guard = 0; left > 0 && guard < 20; guard++) {
    const keys = Object.keys(w).filter(k => w[k] > 0 && out[k] < max); if (!keys.length) break;
    const tot = keys.reduce((s, k) => s + w[k], 0);
    const share = keys.map(k => [k, left * w[k] / tot]);
    let used = 0;
    for (const [k, v] of share) { const n = Math.min(max - out[k], Math.floor(v)); out[k] += n; used += n; }
    let rem = left - used;
    const order = share.map(([k, v]) => [k, v - Math.floor(v)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [k] of order) { if (rem <= 0) break; if (out[k] < max) { out[k]++; rem--; } }
    left = rem;
  }
  return out;
}
export const buildFor = (cfg, role, level) => allocate(cfg, cfg.v2_builds[role], F.levelPoints(cfg, level));

// ---------- the card ----------
// spec: { key, name, role, rarity, stars, level, points?, template?, cp_mod? }
export function makeCard(cfg, spec) {
  const role = spec.role, cls = classOf(role);
  const points = spec.points || buildFor(cfg, role, spec.level || 0);
  const used = Object.values(points).reduce((s, x) => s + x, 0);
  if (used > F.levelPoints(cfg, spec.level || 0) && !spec.freePoints) throw new Error(`makeCard: ${used} points > level ${spec.level}`);
  const cpBase = F.converge(cfg, F.ascCp(cfg, spec.rarity, spec.stars || 0) * (spec.cp_mod || 1), spec.level || 0);
  const st = F.stats(cfg, cpBase, points);
  const tid = spec.template || templateFor(cfg, spec.key || role, role);
  const t = cfg.v2_templates[tid];
  const pw = cls === 'support' ? F.supportPower(cfg, cpBase) : 1;
  const extra = cfg.v2_support.enabler_extra_stack.includes(spec.rarity) ? 1 : 0;
  const blocks = t.blocks.map(b => {
    const c = { ...b };
    if (cls === 'support') for (const f of scaledFields(c)) if (typeof c[f] === 'number') c[f] = c[f] * pw;
    if (c.stacks) c.stacks += extra;
    return c;
  });
  return {
    key: spec.key || `${role}-${spec.rarity}`, name: spec.name || spec.key || role, role, cls, rarity: spec.rarity, stars: spec.stars || 0, level: spec.level || 0,
    points, cpBase, ...st, power: pw,
    speedBase: cfg.v2_speed.role_base[role],
    active: { id: tid, name: t.name, charge: chargeOf(cfg, tid), blocks },
  };
}

// Pick real cards of a role and rarity (seeded). Falls back to any card of the class with that finish.
export function pickCards(cfg, pool, roles, rarity, rng, opts = {}) {
  const out = []; const used = new Set();
  for (const role of roles) {
    let c = pool.filter(p => p.role === role && p.finishes.includes(rarity) && !used.has(p.key));
    if (!c.length) c = pool.filter(p => classOf(p.role) === classOf(role) && p.finishes.includes(rarity) && !used.has(p.key));
    const s = c[Math.floor(rng() * c.length)]; used.add(s.key);
    out.push({ key: s.key, name: s.name, role: s.role, cp_mod: s.cp_mod, rarity, stars: opts.stars || 0, level: opts.level || 0, template: opts.templates?.[role] });
  }
  return out;
}
