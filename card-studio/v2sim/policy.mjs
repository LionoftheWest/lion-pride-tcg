// policy.mjs - who does what. "auto" = a simple rule set (the Auto button). "best" = auto + holding payoffs for their
// status, kill targeting and control timed on a Charging enemy. A policy never sees future random draws.
const MAIN_STATUS = b => (b.find(x => x.k === 'apply') || {}).status;
const CONTROL = ['stunned', 'frozen', 'sleep', 'paralyzed'];
const needsStatus = { 'striker.bloom': ['poison'], 'breaker.shatter': ['chill', 'frozen'], 'flurry.frenzy': ['exposed'], 'artillery.detonate': ['burn'], 'artillery.frostshell': ['frozen', 'chill'] };
const makes = (u, s) => u.active.blocks.some(b => (b.k === 'apply' || b.k === 'on_crit') && (b.status === s || (s === 'frozen' && b.status === 'chill')));

function front(b) { return b.alive('enemy')[0]; }
function lowest(b) { return b.alive('enemy').reduce((m, e) => (!m || e.hp < m.hp ? e : m), null); }
function threat(b) { return b.alive('enemy').reduce((m, e) => (!m || e.atk > m.atk ? e : m), null); }

function supportUseful(b, u, tgt) {
  const B = u.active.blocks, k = B[0].k; const cards = b.alive('card');
  const charging = b.alive('enemy').some(e => e.charging);
  if (k === 'shield') return charging || cards.some(c => c.hp / c.maxHp < 0.75 && c.shield < 0.1 * c.maxHp);
  if (k === 'shield_all') return charging || cards.filter(c => c.hp / c.maxHp < 0.9).length >= 2;
  if (k === 'heal') return cards.some(c => c.hp / c.maxHp < 0.6) || (B.some(x => x.k === 'cleanse') && cards.some(c => b.cfg.v2_status.negative.some(s => c.st[s])));
  if (['empower', 'rally', 'focus', 'quicken'].includes(k)) return cards.some(c => c.cls === 'attacker');
  if (k === 'smite' || k === 'dispel') return true;
  if (k === 'apply') {
    const s = MAIN_STATUS(B);
    if (CONTROL.includes(s)) return !CONTROL.some(c => tgt.st[c]) && b.step >= tgt.immUntil;
    if (['exposed', 'weakened', 'mark', 'blinded', 'slowed'].includes(s)) return !tgt.st[s] || (tgt.st[s].until - b.step) <= 1;
    return true;
  }
  return true;
}

export const auto = {
  name: 'auto',
  target(b, u) { return b.mode === 'hunt' ? b.enemies[0] : front(b); },
  useActive(b, u) {
    if (u.cls === 'attacker') return true;
    const tgt = this.target(b, u), A = b.cfg.v2_auto;
    // Lab item (config v2_auto, default OFF): hold a control active for a Charging enemy (a Stun on the Charging turn cancels the Cataclysm).
    if (A?.hold_control_for_charging && CONTROL.includes(MAIN_STATUS(u.active.blocks)) && (b.isBoss(tgt) || tgt.cataclysm) && !tgt.charging && u.held < A.hold_max && b.step >= tgt.immUntil) return false;
    return supportUseful(b, u, tgt);
  },
  allyFor(b, u, kind, list) {
    const cards = b.alive('card');
    if (kind === 'cure') { // the ally with the most of the listed statuses (not locked), else the most hurt ally
      const n = c => list.filter(s => c.st[s] && !c.st[s].locked).length; const t = cards.reduce((m, c) => (!m || n(c) > n(m) ? c : m), null);
      return t && n(t) > 0 ? t : (b.mostHurt() || cards[0]); }
    if (kind === 'shield') return cards.reduce((m, c) => (!m || (c.hp + c.shield) / c.maxHp < (m.hp + m.shield) / m.maxHp ? c : m), null);
    if (kind === 'heal') return b.mostHurt() || cards[0];
    const a = cards.filter(c => c.cls === 'attacker' && !c.st.empowered); return (a.length ? a : cards.filter(c => c.cls === 'attacker')).reduce((m, c) => (!m || c.cp > m.cp ? c : m), null);
  },
};

export const best = {
  name: 'best',
  target(b, u, use) {
    if (b.mode === 'hunt') return b.enemies[0];
    const foes = b.alive('enemy');
    if (u.cls === 'support') { const s = MAIN_STATUS(u.active.blocks); return use && (CONTROL.includes(s) || s === 'weakened' || s === 'blinded') ? threat(b) : lowest(b); }
    const need = needsStatus[u.active.id];
    if (use && need) { const t = foes.find(e => need.some(s => e.st[s])); if (t) return t; }
    const kill = foes.find(e => e.hp + e.shield <= u.cp * 0.9); return kill || lowest(b);
  },
  useActive(b, u) {
    const tgt = this.target(b, u, true);
    if (u.cls === 'support') {
      const s = MAIN_STATUS(u.active.blocks);
      if (b.cfg.v2_auto?.best_holds_control !== false && CONTROL.includes(s) && b.mode === 'hunt' && !b.enemies[0].charging && u.held < 2 && b.step >= tgt.immUntil) return false;
      return supportUseful(b, u, tgt);
    }
    if (u.held >= 2) return true;
    const id = u.active.id, need = needsStatus[id];
    if (need) { const squadMakes = b.alive('card').some(c => need.some(s => makes(c, s))); return !squadMakes || need.some(s => tgt.st[s]); }
    if (id === 'finisher.execute' || id === 'finisher.ko') {
      const blk = u.active.blocks; const ex = blk.find(x => x.k === 'execute'), line = blk.find(x => x.k === 'line_status');
      return tgt.hp / tgt.maxHp < ex.line || (line && line.statuses.some(s => tgt.st[s]));
    }
    if (id === 'finisher.pileon') return b.negKinds(tgt) >= 2;
    return true;
  },
  allyFor(b, u, kind, list) {
    if (kind === 'empower') { const a = b.alive('card').filter(c => c.cls === 'attacker' && !c.st.empowered);
      if (a.length) return a.reduce((m, c) => { const sc = c.cp * (c.charge >= c.active.charge ? 1.6 : 1) * (c.meter + 1); const sm = m ? m.cp * (m.charge >= m.active.charge ? 1.6 : 1) * (m.meter + 1) : -1; return sc > sm ? c : m; }, null); }
    return auto.allyFor(b, u, kind, list);
  },
};
export const POLICIES = { auto, best };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Auto v2 (PR E8, plan 14.1 row E8; tcg-bot/supabase/combat_v2_auto.sql combat_v2_auto is the SQL twin, decision for decision). Generic: it reads the
// blocks of each active (what it makes and what it pays off: the ability_v2_check "Makes / Uses" rule), the role hint roles.auto (config v2_role_auto =
// the roles table) and the numbers of balance auto_v2.fight (config auto_v2). It never reads a template id and never draws a random number. One decision
// for each card action: use the charged active or the basic attack, the enemy target, and ONE ally for every single-ally block of the active.
// The decision is made before the action (the SQL caller passes it to combat_v2_card_act), so allyFor returns the ally of that decision.
export const PAY_KEYS = ['payoff_dmg', 'payoff_crit', 'vs_status', 'per_stack', 'target_has', 'more_per', 'consume'];
const PAY_LISTS = ['line_status', 'payoff_dmg', 'payoff_crit', 'vs_status', 'target_has'];
const VALUE_ST = ['exposed', 'weakened', 'mark', 'blinded', 'slowed'];
const THREAT_ST = [...CONTROL, 'weakened', 'blinded'];
const ALLY_KEYS = ['cure', 'shield', 'heal', 'empower', 'focus', 'quicken'];
const GATE_KEYS = ['self_has', 'enemy_charging', 'foes_alive', 'self_shield'];
const ATTACH_KEYS = [...GATE_KEYS, 'target_has', 'ally_below', 'more_per', 'coin'];
/** The statuses that an active pays off: ability_v2_check "pays", and the status that a consume block uses up (Detonate needs Burn). */
export function paysOf(blocks) {
  const out = [];
  const add = (s) => { if (s && !out.includes(s)) out.push(s); };
  for (const x of blocks || []) {
    if (PAY_KEYS.includes(x.k)) add(x.status);
    if (x.k === 'apply' && x.per && x.per !== 'kinds') add(x.per);
    if (PAY_LISTS.includes(x.k) && Array.isArray(x.statuses)) x.statuses.forEach(add);
  }
  return out;
}
/** The statuses that an active makes (ability_v2_check "enables"), Frozen for a Chill maker (Chill ends in Frozen), and the role passive
 * (auto_v2.fight.passive_makes, for example the Spotter basic attack Exposes). */
export function makesOf(cfg, role, blocks) {
  const out = [];
  const add = (s) => { if (s && !out.includes(s)) out.push(s); };
  for (const x of blocks || []) {
    if (['apply', 'on_crit', 'on_kill'].includes(x.k)) add(x.status);
    if (x.k === 'random_apply') for (const o of x.options || []) add(o.status);
  }
  if (out.includes('chill')) add('frozen');
  for (const s of cfg.auto_v2.fight.passive_makes[role] || []) add(s);
  return out;
}
const lowestFoe = (foes) => foes.reduce((m, e) => (!m || e.hp < m.hp ? e : m), null);
const threatFoe = (foes) => foes.reduce((m, e) => (!m || e.atk > m.atk ? e : m), null);
function autoTarget(b, u, use) {
  const A = b.cfg.auto_v2.fight; const foes = b.alive('enemy');
  if (b.mode === 'hunt') return foes[0];
  const B = u.active.blocks;
  if (u.cls === 'support') return use && B.some((x) => x.k === 'apply' && THREAT_ST.includes(x.status)) ? threatFoe(foes) : lowestFoe(foes);
  if (use) { const P = paysOf(B); if (P.length) { const t = foes.find((e) => P.some((s) => e.st[s])); if (t) return t; } }
  return foes.find((e) => e.hp + e.shield <= u.cp * A.kill_x) || lowestFoe(foes);
}
function blockUseful(b, u, tgt, x) {
  const A = b.cfg.auto_v2.fight; const cards = b.alive('card');
  const charging = b.alive('enemy').some((e) => e.charging);
  const has = (c, list) => list.some((s) => c.st[s] && !c.st[s].locked);
  switch (x.k) {
    case 'shield': return charging || cards.some((c) => c.hp / c.maxHp < A.shield_below && c.shield < A.shield_have * c.maxHp);
    case 'shield_all': return charging || cards.filter((c) => c.hp / c.maxHp < A.shield_all_below).length >= A.shield_all_count;
    case 'heal': case 'heal_all': return cards.some((c) => c.hp / c.maxHp < A.heal_below);
    case 'cleanse': return cards.some((c) => has(c, b.cfg.v2_status.negative));
    case 'cure': return cards.some((c) => has(c, x.statuses.includes('all') ? b.cfg.v2_status.negative : x.statuses));
    case 'empower': case 'rally': case 'focus': case 'quicken': return cards.some((c) => c.cls === 'attacker');
    case 'apply': {
      if (CONTROL.includes(x.status)) return !CONTROL.some((c) => tgt.st[c]) && b.step >= tgt.immUntil;
      if (VALUE_ST.includes(x.status)) return !tgt.st[x.status] || (tgt.st[x.status].until - b.step) <= A.refresh;
      return true;
    }
    default: return !ATTACH_KEYS.includes(x.k);
  }
}
function autoUse(b, u) {
  const A = b.cfg.auto_v2.fight; const B = u.active.blocks;
  if (u.held >= A.hold_max) return { use: true, why: 'held' };
  const tgt = autoTarget(b, u, true);
  if (u.cls === 'support') {
    const hint = b.cfg.v2_role_auto?.[u.role] || {};
    if (hint.hold_for === 'charging' && B.some((x) => x.k === 'apply' && CONTROL.includes(x.status)) && (b.isBoss(tgt) || tgt.cataclysm) && !tgt.charging && b.step >= tgt.immUntil)
      return { use: false, why: 'hold_charging' };
    return B.some((x) => blockUseful(b, u, tgt, x)) ? { use: true, why: 'useful' } : { use: false, why: 'not_useful' };
  }
  const ex = B.find((x) => x.k === 'execute');
  if (ex) {
    const ls = B.find((x) => x.k === 'line_status');
    return tgt.hp / tgt.maxHp < ex.line || (ls && ls.statuses.some((s) => tgt.st[s])) ? { use: true, why: 'execute' } : { use: false, why: 'hold_execute' };
  }
  for (let j = 0; j + 1 < B.length; j++) if (GATE_KEYS.includes(B[j + 1].k) && !b.gateOn(u, tgt, B[j + 1])) return { use: false, why: 'hold_gate' };
  const P = paysOf(B);
  if (P.length && !P.some((s) => tgt.st[s]) && b.alive('card').some((c) => c !== u && makesOf(b.cfg, c.role, c.active.blocks).some((s) => P.includes(s)))) return { use: false, why: 'hold_pay' };
  if (B.some((x) => x.k === 'per_kind') && b.negKinds(tgt) < A.per_kind_min) return { use: false, why: 'hold_kinds' };
  return { use: true, why: 'ready' };
}
function autoAlly(b, u, use) {
  const A = b.cfg.auto_v2.fight; const cards = b.alive('card');
  const hurt = () => b.mostHurt() || cards[0];
  const x = use ? u.active.blocks.find((y) => ALLY_KEYS.includes(y.k) && !(y.k === 'quicken' && y.all) && (!y.to || y.to === 'cured')) : null;
  const kind = x ? (x.k === 'focus' || x.k === 'quicken' ? 'empower' : x.k) : null;
  if (kind === 'cure') {
    const list = x.statuses.includes('all') ? b.cfg.v2_status.negative : x.statuses;
    const n = (c) => list.filter((s) => c.st[s] && !c.st[s].locked).length; const t = cards.reduce((m, c) => (!m || n(c) > n(m) ? c : m), null);
    return t && n(t) > 0 ? t : hurt();
  }
  if (kind === 'shield') return cards.reduce((m, c) => (!m || (c.hp + c.shield) / c.maxHp < (m.hp + m.shield) / m.maxHp ? c : m), null);
  if (kind === 'empower') {
    const sc = (c) => c.cp * (c.charge >= c.active.charge ? A.ready_x : 1) * (c.meter + 1);
    const free = cards.filter((c) => c.cls === 'attacker' && !c.st.empowered); const att = cards.filter((c) => c.cls === 'attacker');
    if (free.length) return free.reduce((m, c) => (!m || sc(c) > sc(m) ? c : m), null);
    if (att.length) return att.reduce((m, c) => (!m || c.cp > m.cp ? c : m), null);
  }
  return hurt();
}
/** The whole decision of one card action (the SQL combat_v2_auto answer): {use, why, target, ally}. */
export function autoDecide(b, u) {
  const ready = u.charge >= u.active.charge;
  const d = ready ? autoUse(b, u) : { use: false, why: 'charging' };
  return { u, use: d.use, why: d.why, target: autoTarget(b, u, d.use), ally: autoAlly(b, u, d.use) };
}
export const autov2 = {
  name: 'autov2',
  useActive(b, u) { b._auto = autoDecide(b, u); b._auto.fresh = true; return b._auto.use; },
  target(b, u) { if (!b._auto || b._auto.u !== u || !b._auto.fresh) b._auto = autoDecide(b, u); b._auto.fresh = false; return b._auto.target; },
  allyFor(b, u) { return b._auto && b._auto.u === u ? b._auto.ally : autoDecide(b, u).ally; },
};
POLICIES.autov2 = autov2;
