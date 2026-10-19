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
