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
export function blockPP(cfg, tid, b) {
  const t = cfg.v2_templates[tid]; const P = cfg.v2_pp, R = P.ref; const C = chargeOf(cfg, tid) + 1;
  const att = classOf(t.role) === 'attacker';
  const k = 40 / C;                     // attackers: 40 x V / C
  const sk = 2 / C;                     // supports: library price x 2 / C
  const strikes = (t.blocks.find(x => x.k === 'strikes') || { n: 1 }).n;
  const sv = (st, b) => { const base = P.status_pp[st];
    if (['exposed', 'weakened', 'mark'].includes(st)) return base * (b.value ?? 0.1);
    if (['poison', 'burn', 'chill'].includes(st)) return base * (b.stacks || 1);
    if (st === 'slowed') return base; return base; };
  switch (b.k) {
    case 'hit': return k * (b.x - 1);
    case 'strikes': return k * (b.n * b.x - 1);
    case 'crit_add': return k * b.v;
    case 'pierce': return k * b.v * R.enemy_def / (1 - R.enemy_def);
    case 'true_strike': return k * R.miss;
    case 'area': return k * b.x * R.foes_other;
    case 'payoff_dmg': case 'payoff_crit': return k * b.v * R.payoff;
    case 'per_stack': return k * b.v * R.stacks * R.payoff;
    case 'per_kind': return k * b.v * R.kinds * R.payoff;
    case 'vs_status': return (att ? k : sk * 10 / 3) * (b.x - 1) * R.frozen_share * R.payoff;
    case 'execute': return k * b.v * b.line;
    case 'line_status': return 0.5 * b.statuses.length;
    case 'lifesteal': case 'guard_up': return k * b.v * R.heal_value;
    case 'shield_break': return k * (b.x - 1) * R.shield_share * R.payoff;
    case 'on_crit': return sv(b.status, b) * b.chance * R.crit_share * (att ? 1 / C : sk) * (b.status === 'stunned' ? 1 : 1);
    case 'apply': return sv(b.status, b) * b.chance * (att ? strikes / C : sk) * (b.all ? 1 + R.foes_other : 1);
    case 'shield': return P.support_pp.shield * b.v * sk;
    case 'shield_all': return P.support_pp.shield_all * b.v * sk;
    case 'heal': return P.support_pp.heal * b.v * sk;
    case 'empower': return P.support_pp.empower * b.v * sk;
    case 'rally': return P.support_pp.rally * b.v * sk;
    case 'quicken': return P.support_pp.quicken * b.v * sk * (b.all ? 1.5 : 1);
    case 'focus': return (P.support_pp.focus_crit * b.crit + P.support_pp.focus_crd * b.crd) * sk;
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
    if (cls === 'support') for (const f of ['v', 'x', 'value']) if (typeof c[f] === 'number' && c.k !== 'vs_status' && c.k !== 'consume') c[f] = c[f] * pw;
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
