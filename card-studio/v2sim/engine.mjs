// engine.mjs - one combat v2 fight: speed meter with a hidden clock, statuses, the damage pipeline, card and enemy actions.
//
// Clock step ("round"): every standing unit adds its speed to its meter. A unit with meter >= 100 acts and loses 100
// (highest meter first), at most v2_speed.max_actions_per_step times in one step (each unit). Speed 100 = one action a step. After the actions: ticks (Poison, Burn, regrowth), expiry.
// Durations, the 40-step cap and the Hunt daily cap count clock steps. Each unit has its own random stream
// (hash of the fight seed and its slot), so a change on one card moves the other units' draws as little as possible.
//
// Enemy rules: a unit's mechanics (mech) read their numbers from v2_enemy.mechanics, v2_dungeon.passive_params or
// v2_boss_rules, merged with the unit's own params (u.P). A named Hunt boss (v2_bosses) adds resists (immune statuses),
// counter moves (bossMove) and rules. Timed enemy states (Fade, Calcify, ...) live in u.ext = { key: { v, until } }.
import { F } from './formulas.mjs';
import { mkRng, hash } from './util.mjs';
import { ATTACH, GATES, AMOUNT_FIELD } from './cards.mjs';

export const CONTROL = ['stunned', 'frozen', 'sleep', 'paralyzed'];
const BOONS = ['shielded', 'empowered', 'focused', 'quickened', 'enraged'];
const SINGLE_MOVES = ['strike', 'heavy', 'flurry', 'drain', 'stun', 'poison', 'hellfire', 'frost_punch', 'squeeze', 'infect'];

export class Battle {
  constructor(cfg, { cards, enemies, mode = 'hunt', policy, seed = 1, cap, tier = null }) {
    this.cfg = cfg; this.mode = mode; this.policy = policy; this.tier = tier; this.step = 0;
    this.cap = cap ?? (mode === 'hunt' ? cfg.v2_hunt.round_cap : cfg.v2_dungeon.round_cap);
    this.rng = mkRng(hash(seed, 'battle'));
    this.cards = cards.map((c, i) => this.unit('card', c, i, seed));
    this.enemies = enemies.map((e, i) => this.unit('enemy', e, i, seed));
    this.units = [...this.cards, ...this.enemies];
    this.S = { dealt: 0, healedEnemy: 0, taken: 0, applied: {}, resisted: {}, immuneBlocked: {}, controlSkips: 0, enemyTurns: 0, enemyActs: 0,
      actives: 0, basics: 0, misses: 0, attacks: 0, crits: 0, bursts: 0, freezes: 0, wrongTarget: 0, wake: 0, paraFail: 0, byCard: {}, hitsTaken: {},
      cured: 0, cureBlocked: 0, healedCards: 0, reflected: 0, counterMoves: {}, cardStatuses: {}, cataclysms: 0, bans: 0 };
    this.healedStep = 0; this.lastSupport = null;
    this.ended = null;
  }
  // The numbers of one mechanic: the global params, then the unit's own (a per-boss value, for example purify every 2).
  mechParams(name, own) {
    const c = this.cfg; const base = c.v2_enemy.mechanics[name] || c.v2_dungeon.passive_params?.[name] || c.v2_boss_rules?.[name] || {};
    return own ? { ...base, ...own } : base;
  }
  unit(side, d, idx, seed) {
    const rng = mkRng(hash(seed, side, idx, d.key || d.name || ''));
    const u = { ...d, side, idx, id: `${side}${idx}`, rng, st: {}, down: (d.hp ?? 1) <= 0, immUntil: -1, meter: rng() * 100, charge: this.cfg.v2_charge.start,
      shield: d.shield || 0, mech: new Set(d.mech || []), turn: 0, charging: false, held: 0, immune: new Set(d.resists || []), ext: {}, immuneTo: {}, P: {} };
    for (const m of u.mech) u.P[m] = this.mechParams(m, d.params?.[m]);
    if (u.mech.has('plated')) u.def = Math.max(u.def || 0, u.P.plated.def);
    if (u.mech.has('fade')) u.evasion = (u.evasion || 0) + u.P.fade.evasion_add;
    if (u.mech.has('brood')) u.brood = u.P.brood.start;
    if (u.hp === undefined) u.hp = u.maxHp;
    return u;
  }
  alive(side) { return (side === 'card' ? this.cards : this.enemies).filter(u => !u.down); }
  has(u, s) { return !!u.st[s]; }
  val(u, s) { return u.st[s] ? (u.st[s].v ?? u.st[s].stacks ?? 1) : 0; }
  negKinds(u) { return this.cfg.v2_status.negative.filter(s => u.st[s]).length; }
  // PR T1: a status or any status of a list (the field status or statuses of a block)
  // Set 2 part (c): a block may also name kinds = N: the unit has N or more different harmful statuses (negKinds), an OR next to its statuses
  hasAny(u, b) { return (b.statuses ? b.statuses.some(s => this.has(u, s)) : b.status !== undefined && this.has(u, b.status)) || (b.kinds !== undefined && this.negKinds(u) >= b.kinds); }
  // PR T1: the ally of a block with a target: most_hurt = the lowest HP share (the first in the fixed order on a tie), strongest = the attacker with the most power
  allyTo(to) {
    const a = this.alive('card');
    if (to === 'most_hurt') return a.reduce((m, c) => (!m || c.hp / c.maxHp < m.hp / m.maxHp ? c : m), null);
    if (to === 'strongest') return a.filter(c => c.cls === 'attacker').reduce((m, c) => (!m || c.cp > m.cp ? c : m), null);
    throw new Error(`allyTo: unknown target ${to}`);
  }
  // PR T1: a gate (a condition on the block before it) holds now
  gateOn(u, tgt, a) {
    switch (a.k) {
      case 'self_has': return this.has(u, a.status);
      case 'self_shield': return (u.shield || 0) > 0;
      case 'enemy_charging': return !!tgt.charging;
      case 'foes_alive': return this.alive('enemy').length >= 2;
      default: throw new Error(`gateOn: ${a.k}`);
    }
  }
  // PR T1: the count of a "for each": the stacks of a status on the enemy, or its harmful statuses other than the one the host block applies
  countOn(tgt, status, except) { return status ? (tgt.st[status]?.stacks || 0) : this.negKinds(tgt) - (except && this.cfg.v2_status.negative.includes(except) && tgt.st[except] ? 1 : 0); }
  refHp(u) { return u.side === 'enemy' && this.mode === 'hunt' ? this.cfg.v2_status.hunt_ref_hp : u.maxHp; }
  isBoss(u) { return u.side === 'enemy' && this.mode === 'hunt'; }
  ablOf(u) { return u.abl || 1; }
  // a rule of a standing enemy (bloodrot, brittle, time_lock): its params, else null
  standing(name) { for (const e of this.enemies) if (!e.down && e.mech.has(name)) return e.P[name]; return null; }
  // a timed state of a unit (u.ext[key]), else the default
  ext(u, key, dflt = null) { const s = u.ext[key]; return s && s.until > this.step ? s.v : dflt; }
  // a timed state of any standing enemy
  extAny(key) { for (const e of this.enemies) if (!e.down) { const v = this.ext(e, key); if (v !== null) return { e, v }; } return null; }

  // ---------- speed ----------
  speedOf(u) {
    const S = this.cfg.v2_status; let m = 1;
    if (u.st.slowed) m *= u.st.slowed.v;
    if (u.st.quickened && !(u.side === 'card' && this.standing('time_lock'))) m *= u.st.quickened.v;
    if (u.st.chill) m *= 1 - S.chill.spd * u.st.chill.stacks;
    return F.effSpeed(this.cfg, u.speedBase, u.spdMult || 1, m);
  }

  // ---------- statuses ----------
  dur(tgt, name, src, extra = 0) {
    const S = this.cfg.v2_status[name]; let d = tgt.side === 'card' ? (S.dur_card ?? S.dur) : S.dur;
    if (src && src.role === 'controller' && tgt.side !== src.side) d += this.cfg.v2_roles.controller.dur_add;
    if (CONTROL.includes(name) && this.isBoss(tgt)) d = Math.min(d, this.cfg.v2_control.boss_max_dur);
    return d + extra;
  }
  // a negative status that the target blocked: counts for Tilt and Rage Spiral
  blocked(src, tgt, name, kind) {
    this.S[kind][name] = (this.S[kind][name] || 0) + 1;
    if (tgt.side === 'enemy' && src && src.side === 'card') {
      tgt.blockedN = (tgt.blockedN || 0) + 1;
      if (tgt.mech.has('tilt')) this.apply(tgt, tgt, 'enraged', { value: tgt.P.tilt.x, dur: tgt.P.tilt.dur });
      if (CONTROL.includes(name) && (tgt.mech.has('rubberband') || this.ext(tgt, 'rubberband')) && tgt.rubberStep !== this.step) { tgt.rubberStep = this.step; tgt.meter += 100; }
    }
    return false;
  }
  apply(src, tgt, name, o = {}) {
    if (!tgt || tgt.down) return false;
    const cfg = this.cfg, S = cfg.v2_status;
    const neg = S.negative.includes(name) || name === 'stunned';
    if (name === 'chill' && tgt.mech.has('permafrost_heart') && src && src.side === 'card' && !src.down) { this.S.reflected++; this.apply(null, src, 'chill', { stacks: o.stacks || 1 }); }
    if (tgt.immune.has(name)) return this.blocked(src, tgt, name, 'immuneBlocked');
    for (const m of tgt.mech) if (tgt.P[m]?.immune?.includes(name)) return this.blocked(src, tgt, name, 'immuneBlocked');
    if (neg && tgt.side === 'card' && (tgt.immuneTo[name] ?? -1) > this.step) { this.S.cureBlocked++; return false; }
    if (neg && src && src.side !== tgt.side) {
      let res = tgt.resolve || 0;
      if (src.side === 'card') res = Math.max(0, res * (src.role === 'controller' ? 1 - cfg.v2_roles.controller.resolve_ignore : 1) - (src.acc || 0) * cfg.v2_hit.resolve_acc / cfg.v2_stats.acc.pct);
      if (res > 0 && src.rng() < res) return this.blocked(src, tgt, name, 'resisted');
    }
    if (CONTROL.includes(name) && tgt.mech.has('unstoppable') && (src || tgt).rng() < tgt.P.unstoppable.control_fail) return this.blocked(src, tgt, name, 'resisted');
    if (CONTROL.includes(name) && src && src.side === 'card' && this.ext(tgt, 'desync_control')) { delete tgt.ext.desync_control; return this.blocked(src, tgt, name, 'resisted'); }
    if (CONTROL.includes(name)) {
      if (CONTROL.some(c => tgt.st[c]) || this.step < tgt.immUntil) return this.blocked(src, tgt, name, 'immuneBlocked');
      const life = name === 'stunned' || name === 'frozen' ? (tgt.side === 'card' ? S[name].max_life_card : S[name].max_life) : this.dur(tgt, name, src);
      // the Hunt boss limit is "at most" boss_max_dur (the v2_control note): dur() takes the min, so a Sleep never lasts longer on the boss than on a foe
      tgt.st[name] = { until: this.step + life };
      // a "Weak to: Controllers" week (weak_role_rules.controller.control_add): the control lasts N more actions of the target
      const add = src && tgt.weakRole && src.role === tgt.weakRole ? cfg.v2_enemy.weak_role_rules?.[src.role]?.control_add || 0 : 0;
      if (add) { if (name === 'stunned' || name === 'frozen') tgt.st[name].extra = add; else tgt.st[name].until += add; }
      if (name === 'frozen') { delete tgt.st.chill; this.S.freezes++; }
    } else if (name === 'poison') {
      const cur = tgt.st.poison ? tgt.st.poison.stacks : 0; const n = cur + (o.stacks || 1);
      if (n >= S.poison.burst_at) {
        delete tgt.st.poison; this.S.bursts++;
        this.damage(src, tgt, F.toxicBurst(cfg, this.refHp(tgt)) * this.vuln(tgt), { tick: true, ignoreShield: true, kind: 'burst' });
      } else tgt.st.poison = { stacks: n, until: this.step + this.dur(tgt, 'poison', src) };
    } else if (name === 'burn') {
      const cur = tgt.st.burn ? tgt.st.burn.stacks : 0; tgt.st.burn = { stacks: Math.min(S.burn.max, cur + (o.stacks || 1)) };
    } else if (name === 'chill') {
      const cur = tgt.st.chill ? tgt.st.chill.stacks : 0; let n = cur + (o.stacks || 1);
      if (n >= S.chill.freeze_at) {
        if (this.apply(null, tgt, 'frozen')) { this.S.applied.chill = (this.S.applied.chill || 0) + 1; return true; }
        n = S.chill.freeze_at - 1;
      }
      tgt.st.chill = { stacks: n, until: this.step + this.dur(tgt, 'chill', src) };
    } else if (name === 'exposed') {
      const cap = tgt.mech.has('thick_hide') ? tgt.P.thick_hide.expose_cap : S.exposed.cap;
      const cur = tgt.st.exposed ? tgt.st.exposed.v : 0; tgt.st.exposed = { v: Math.min(cap, cur + o.value * (tgt.mech.has('dispeller') ? tgt.P.dispeller.x : 1)), until: this.step + this.dur(tgt, 'exposed', src) };
    } else if (name === 'weakened') {
      const cur = tgt.st.weakened ? tgt.st.weakened.v : 0; tgt.st.weakened = { v: Math.min(S.weakened.cap, cur + o.value), until: this.step + this.dur(tgt, 'weakened', src) };
    } else if (name === 'mark') {
      const cur = tgt.st.mark ? tgt.st.mark.v : 0; tgt.st.mark = { v: Math.max(cur, o.value), until: this.step + S.mark.dur };
    } else if (name === 'slowed' || name === 'quickened') {
      tgt.st[name] = { v: o.value ?? S[name].x, until: this.step + this.dur(tgt, name, src) };
    } else if (name === 'blinded' || name === 'confused' || name === 'enraged' || name === 'focused') {
      tgt.st[name] = { v: o.value ?? 1, crd: o.crd, until: this.step + (o.dur ?? this.dur(tgt, name, src)) };
    } else if (name === 'empowered') {
      // P4 (Lab item): stack = false -> the higher value stays (today). stack = true -> Empowers add up to stack_cap (+50% = x1.5).
      const E = S.empowered, cur = tgt.st.empowered ? tgt.st.empowered.v : 0;
      tgt.st.empowered = { v: E.stack ? Math.min(E.stack_cap ?? E.cap, cur + o.value) : Math.min(E.cap, Math.max(cur, o.value)) };
    } else throw new Error(`apply: unknown status ${name}`);
    if (o.locked && tgt.st[name]) tgt.st[name].locked = true;
    if (neg && src && src.side === 'card' && tgt.side === 'enemy') tgt.lastDebuffer = src;
    if (neg && tgt.side === 'card' && src && src.side === 'enemy') this.S.cardStatuses[name] = (this.S.cardStatuses[name] || 0) + 1;
    this.S.applied[name] = (this.S.applied[name] || 0) + 1;
    return true;
  }
  remove(u, name) {
    if (!u.st[name]) return;
    delete u.st[name];
    if (CONTROL.includes(name)) { const C = this.cfg.v2_control; u.immUntil = this.step + (u.side === 'card' ? C.immune_card : this.isBoss(u) ? C.boss_immune : C.immune); }
  }
  cleanseNeg(u) { for (const s of this.cfg.v2_status.negative) if (!u.st[s]?.locked) this.remove(u, s); }
  vuln(t) { return 1 + (t.st.exposed ? t.st.exposed.v : 0); }
  // Free cure (Revision 5): remove the listed statuses from one ally and make it immune to them for `immune` steps.
  cure(u, b) {
    const S = this.cfg.v2_status; const list = b.statuses.includes('all') ? S.negative : b.statuses;
    const t = this.policy.allyFor(this, u, 'cure', list); if (!t) return null;
    let n = 0; for (const s of list) if (t.st[s] && !t.st[s].locked) { this.remove(t, s); n++; }
    for (const s of list) t.immuneTo[s] = Math.max(t.immuneTo[s] ?? -1, this.step + (b.immune || 0));
    if (n && this.extAny('rot')) { for (const s of BOONS) delete t.st[s]; t.shield = 0; }
    this.S.cured += n; return t;
  }

  // ---------- damage ----------
  // amount = raw damage before the target's Defense. o: { pierce, ignoreShield, shieldX, tick, kind }
  damage(src, tgt, amount, o = {}) {
    this.lastShieldLost = 0;
    if (tgt.down || amount <= 0) return 0;
    let a = F.afterDefense(amount, tgt.def || 0, o.pierce || 0);
    if (tgt.side === 'card') {
      const w = this.cards.find(c => c.role === 'warden' && !c.down && c !== tgt);
      if (w) a *= 1 - this.cfg.v2_roles.warden.ally_dr;
    }
    if (tgt.mech.has('steadfast') && this.negKinds(tgt) < this.ext(tgt, 'steadfast_kinds', tgt.P.steadfast.kinds)) a *= 1 - tgt.P.steadfast.dr;
    if (tgt.brood) {
      a *= 1 - tgt.P.brood.dr * tgt.brood;
      if ((src && src.role === 'cleaver' && !o.tick) || o.kind === 'burn') tgt.brood--;
    }
    if (!o.tick) a = Math.max(this.cfg.v2_hit.min_dmg, a);
    let absorbed = 0;
    if (tgt.shield > 0 && !o.ignoreShield) {
      const sx = o.shieldX || 1; const cap = tgt.shield / sx; absorbed = Math.min(a, cap);
      tgt.shield = Math.max(0, tgt.shield - absorbed * sx); a -= absorbed; this.lastShieldLost = absorbed * sx;
    }
    const hpLoss = Math.min(tgt.hp, a); tgt.hp -= a;
    if (tgt.st.sleep && !o.tick) { this.remove(tgt, 'sleep'); this.S.wake++; }
    const tot = absorbed + hpLoss;
    if (tgt.side === 'enemy') { this.S.dealt += tot; if (src && src.side === 'card') this.S.byCard[src.idx] = (this.S.byCard[src.idx] || 0) + tot; }
    else { this.S.taken += tot; if (!o.tick) this.S.hitsTaken[tgt.idx] = (this.S.hitsTaken[tgt.idx] || 0) + 1; }
    if (tgt.hp <= 0) this.fall(tgt);
    return tot;
  }
  fall(tgt) {
    if (tgt.mech.has('undying') && !tgt.undyingUsed && !tgt.st.burn && !tgt.st.poison) { tgt.undyingUsed = true; tgt.hp = tgt.P.undying.hp * tgt.maxHp; return; }
    const volatile = tgt.mech.has('volatile_core') && !tgt.st.stunned && !tgt.st.frozen;
    tgt.hp = 0; tgt.down = true; tgt.st = {}; tgt.shield = 0;
    if (volatile) for (const c of this.alive('card')) this.enemyHit(tgt, c, tgt.P.volatile_core.x, true);
  }
  heal(u, amount) {
    if (u.down || amount <= 0) return 0;
    if (u.side === 'card') {
      const br = this.standing('bloodrot'); if (br) amount *= br.card_heal_x;
      const cut = this.ext(u, 'heal_cut'); if (cut !== null) amount *= cut;
    }
    const h = Math.min(u.maxHp - u.hp, F.healAmount(this.cfg, amount, !!u.st.burn)); u.hp += h;
    if (u.side === 'enemy') this.S.healedEnemy += h;
    else if (h > 0) {
      this.S.healedCards += h; this.healedStep += h; u.healedStep = (u.healedStep || 0) + h;
      const m = this.extAny('heal_mirror'); if (m) this.heal(m.e, h * m.v);
    }
    return h;
  }
  addShield(u, amount) {
    if (u.down) return;
    if (u.side === 'card') {
      const br = this.standing('brittle'); if (br) amount *= br.card_shield_x;
      const cal = this.extAny('card_shield_x'); if (cal) amount *= cal.v;
    }
    u.shield = Math.min(u.maxHp * this.cfg.v2_status.shielded.cap_maxhp, u.shield + amount);
  }

  // One hit of a card on an enemy (or on an ally when Confused). o: { x, critAdd, pierce, trueStrike, bonus, critBonus, vsX, shieldX, kind }
  // kind: 'extra' (a Flurry second strike), 'splash' (a Cleaver splash), 'area' (an area hit): Mirror Hide cuts them.
  cardHit(src, tgt, o) {
    const cfg = this.cfg, R = cfg.v2_roles, ab = this.ablOf(src);
    if (o.kind && tgt.mech.has('mirror_hide')) { const mx = o.kind === 'extra' ? tgt.P.mirror_hide.extra_x : tgt.P.mirror_hide.splash_x; if (!mx) return { dealt: 0, crit: false, miss: false }; o = { ...o, x: o.x * mx }; }
    this.S.attacks++;
    const marked = !!tgt.st.mark;
    if (!o.trueStrike && !marked) {
      const miss = F.missChance(cfg.v2_hit.miss, (tgt.evasion || 0) + this.ext(tgt, 'evade', 0), src.st.blinded ? cfg.v2_status.blinded.miss : 0, src.acc || 0);
      if (src.rng() < miss) { this.S.misses++; return { dealt: 0, crit: false, miss: true }; }
    }
    let mult = o.x * (cfg.v2_hit.roll_min + src.rng() * cfg.v2_hit.roll_span);
    // Ironhide (E7 tuning): unless Marked, the crit chance is x crit_x (0 = no crit and no crit draw: the E7 rule)
    const ihx = tgt.mech.has('ironhide') && !marked ? tgt.P.ironhide.crit_x || 0 : 1;
    const canCrit = ihx > 0;
    let critC = src.crit + (o.critAdd || 0) + (o.critBonus || 0) + (src.st.focused ? src.st.focused.v : 0);
    if (src.role === 'striker') critC += R.striker.crit_add * ab;
    critC = F.critChance(0, critC, cfg.v2_stats.crt.cap + (src.st.focused ? src.st.focused.v : 0)) * ihx;
    const crit = canCrit && src.rng() < critC;
    if (crit) { this.S.crits++; mult *= src.critx + (src.role === 'striker' ? R.striker.critx_add * ab : 0) + (src.st.focused?.crd || 0); }
    if (src.st.empowered) mult *= 1 + src.st.empowered.v * (tgt.mech.has('dispeller') ? tgt.P.dispeller.x : 1) * this.ext(tgt, 'emp_x', 1);
    if (src.st.weakened) mult *= 1 - src.st.weakened.v;
    if (src.st.chill) mult *= 1 - cfg.v2_status.chill.dmg * src.st.chill.stacks;
    mult *= this.vuln(tgt);
    if (marked) mult *= 1 + tgt.st.mark.v;
    let bonus = o.bonus || 0;
    if (src.role === 'finisher' && tgt.hp / tgt.maxHp < R.finisher.line) bonus += R.finisher.bonus * ab;
    if (src.role === 'cleaver' && this.alive('enemy').length === 1) bonus += R.cleaver.hunt_bonus * ab;
    if (tgt.weakRole && src.role === tgt.weakRole) bonus += cfg.v2_enemy.weak_role_rules?.[src.role]?.damage_x ?? cfg.v2_enemy.weak_role_x;
    mult *= 1 + bonus;
    if (o.vsX) mult *= o.vsX;
    const pierce = Math.max(o.pierce || 0, src.role === 'breaker' ? R.breaker.pierce : 0);
    const shieldX = Math.max(o.shieldX || 1, src.role === 'breaker' ? R.breaker.shield_x : 1);
    const dealt = this.damage(src, tgt, src.cp * mult, { pierce, shieldX });
    if (src.role === 'survivor' && dealt > 0) this.heal(src, Math.min(R.survivor.lifesteal * ab * dealt, R.survivor.cap_maxhp * ab * src.maxHp));
    return { dealt, crit, miss: false };
  }
  consumeMark(t) { if (t.st.mark) delete t.st.mark; }

  // ---------- enemy hits on cards ----------
  enemyMult(e) {
    const B = this.cfg.v2_enemy.boss_moves; let m = 1;
    if (e.st.enraged) m *= e.st.enraged.v;
    if (this.isBoss(e) && e.hp / e.maxHp < B.rage_at) m *= B.rage_x;
    if (e.st.weakened) m *= 1 - e.st.weakened.v;
    if (e.st.chill) m *= 1 - this.cfg.v2_status.chill.dmg * e.st.chill.stacks;
    if (e.mech.has('pack')) m *= 1 + e.P.pack.atk_per_foe * this.alive('enemy').length;
    return m;
  }
  enemyHit(e, tgt, x, area = false, o = {}) {
    const cfg = this.cfg; if (!tgt || tgt.down) return 0;
    if (e.st.blinded && e.rng() < cfg.v2_status.blinded.miss) { this.S.misses++; return 0; }
    if (!e.mech.has('true_strike')) {
      const dg = F.dodgeChance(tgt.ddg || 0, e.keen || 0, area ? cfg.v2_stats.ddg.area_x : 1);
      if (dg > 0 && tgt.rng() < dg) return 0;
    }
    if (area && e.mech.has('swarm') && tgt.cls === 'support') x *= e.P.swarm.x;
    const raw = e.atk * x * (cfg.v2_hit.roll_min + e.rng() * cfg.v2_hit.roll_span) * this.enemyMult(e) * this.vuln(tgt);
    const dealt = this.damage(e, tgt, raw, { pierce: e.mech.has('sunder') ? e.P.sunder.pierce : 0, shieldX: e.mech.has('shatter') ? e.P.shatter.shield_x : 1, ignoreShield: !!o.ignoreShield });
    const lost = this.lastShieldLost;
    if (e.mech.has('crush') && lost > 0 && !tgt.down) this.damage(e, tgt, lost * e.P.crush.x, { tick: true, ignoreShield: true, pierce: 1, kind: 'crush' });
    if (!area && !tgt.down) {
      if (e.mech.has('frost_aura')) this.apply(e, tgt, 'chill', { stacks: e.P.frost_aura.chill });
      // Venom (E7 tuning): a single hit poisons with the chance venom.chance (1 or no chance = always, with no draw: the E7 rule)
      if (e.mech.has('venom') && ((e.P.venom.chance ?? 1) >= 1 || e.rng() < e.P.venom.chance)) this.apply(e, tgt, 'poison', { stacks: e.P.venom.poison });
      if (e.mech.has('burning')) this.apply(e, tgt, 'burn', { stacks: e.P.burning.burn });
    }
    // Slowing (E7 tuning): an area hit Slows with the chance slowing.chance (1 or no chance = always, with no draw: the E7 rule)
    if (area && e.mech.has('slowing') && !tgt.down && ((e.P.slowing.chance ?? 1) >= 1 || e.rng() < e.P.slowing.chance)) this.apply(e, tgt, 'slowed', {});
    return dealt;
  }
  pickCard(e) {
    const a = this.alive('card'); if (!a.length) return null;
    const w = a.map(c => c.role === 'warden' ? this.cfg.v2_roles.warden.taunt_w : 1); const tot = w.reduce((s, x) => s + x, 0);
    let r = e.rng() * tot; for (let i = 0; i < a.length; i++) { r -= w[i]; if (r < 0) return a[i]; } return a[a.length - 1];
  }

  // ---------- the clock ----------
  run() { while (!this.ended) this.tickStep(); return this; }
  tickStep() {
    this.step++; this.healedStep = 0;
    for (const u of this.units) { u.healedStep = 0; u.acts = 0; if (!u.down) u.meter += F.meterGain(this.speedOf(u)); }
    // The action limit counts for EACH unit, the same as SQL combat_v2_advance: a unit acts at most max_actions_per_step times in one
    // step (u.acts), and the rest of its meter waits for the next step. Only an extra_action move (the Hydra's New Head) can reach it.
    // A unit that comes in during the step starts at 0 actions. Each unit has a limited number of actions, so the loop ends.
    const maxA = this.cfg.v2_speed.max_actions_per_step;
    for (;;) {
      let best = null; for (const u of this.units) if (!u.down && u.meter >= 100 && (u.acts || 0) < maxA && (!best || u.meter > best.meter)) best = u;
      if (!best) break;
      best.meter -= 100; best.acts = (best.acts || 0) + 1; this.act(best);
      if (this.checkEnd()) return;
    }
    this.endStep();
    this.checkEnd();
    if (!this.ended && this.step >= this.cap) this.ended = 'cap';
  }
  checkEnd() {
    if (!this.alive('card').length) { this.ended = 'lost'; return true; }
    if (!this.alive('enemy').length) { this.ended = 'won'; return true; }
    return false;
  }
  endStep() {
    const cfg = this.cfg, S = cfg.v2_status;
    for (const u of this.units) {
      if (u.down) continue;
      if (u.st.poison) {
        this.damage(null, u, F.poisonTick(cfg, u.st.poison.stacks, this.refHp(u)) * this.vuln(u), { tick: true, ignoreShield: true, kind: 'poison' });
        if (!u.down && u.mech.has('plaguebearer')) { const a = this.alive('card'); if (a.length) this.apply(u, a[Math.floor(u.rng() * a.length)], 'poison', { stacks: u.P.plaguebearer.poison }); }
      }
      if (!u.down && u.st.burn) {
        const healer = u.mech.has('regrowth') || u.healer;
        this.damage(null, u, F.burnTick(cfg, u.st.burn.stacks, this.refHp(u)) * this.vuln(u) * (healer ? S.burn.vs_healer_x : 1), { tick: true, ignoreShield: true, kind: 'burn' });
        if (u.st.burn) { u.st.burn.stacks -= S.burn.decay; if (u.st.burn.stacks <= 0) delete u.st.burn; }
      }
      if (!u.down && u.mech.has('regrowth')) {
        const R = u.P.regrowth; const ref = this.isBoss(u) ? cfg.v2_enemy.boss_heal_ref * (R.boss_heal ?? R.heal) : u.maxHp * R.heal;
        this.heal(u, ref * (u.hp / u.maxHp < cfg.v2_enemy.boss_moves.rage_at ? R.below_half_x : 1)); // the HP line of v1 (boss_moves.rage_at), not a literal (PR E7)
      }
      if (!u.down && u.mech.has('siphon') && this.healedStep > 0) this.heal(u, this.healedStep * u.P.siphon.x);
      for (const [k, s] of Object.entries(u.st)) if (s.until !== undefined && s.until <= this.step) this.remove(u, k);
    }
  }

  // ---------- actions ----------
  act(u) {
    u.turn++;
    if (u.side === 'enemy') {
      this.S.enemyTurns++;
      if (u.mech.has('purify') && u.turn % u.P.purify.every === 0) this.cleanseNeg(u);
      if (u.mech.has('elusive')) delete u.st.mark;
    }
    if (u.st.stunned || u.st.frozen) { const k = u.st.stunned ? 'stunned' : 'frozen'; if (u.st[k].extra > 0) u.st[k].extra--; else this.remove(u, k); this.S.controlSkips++; if (u.side === 'enemy') u.charging = false; return; }
    if (u.st.sleep) { this.S.controlSkips++; if (u.side === 'enemy') u.charging = false; return; }
    if (u.st.paralyzed && u.rng() < this.cfg.v2_status.paralyzed.fail) { this.S.controlSkips++; this.S.paraFail++; if (u.side === 'enemy') u.charging = false; return; }
    if (u.side === 'card' && u.banned > 0) { u.banned--; this.S.bans++; return; }
    if (u.side === 'enemy') { this.S.enemyActs++; return this.enemyAct(u); }
    return this.cardAct(u);
  }

  cardAct(u) {
    if (!this.alive('enemy').length) return;
    const ready = u.charge >= u.active.charge;
    const use = ready && this.policy.useActive(this, u);
    const tgt = this.policy.target(this, u, use);
    if (use) { this.S.actives++; this.doActive(u, tgt); u.charge = 0; u.held = 0; }
    else { this.S.basics++; this.doBasic(u, tgt); if (ready) u.held++; else u.charge++; }
    if (u.role === 'medic') { const h = this.mostHurt(); if (h) this.heal(h, this.cfg.v2_roles.medic.heal_after * this.ablOf(u) * h.maxHp); }
    if (u.cls === 'support') this.lastSupport = u;
  }
  mostHurt() { const a = this.alive('card'); let b = null; for (const c of a) if (c.hp < c.maxHp && (!b || c.hp / c.maxHp < b.hp / b.maxHp)) b = c; return b; }
  bestAttacker(exclude) { let b = null; for (const c of this.alive('card')) if (c.cls === 'attacker' && c !== exclude && (!b || c.cp > b.cp)) b = c; return b; }
  confusedRedirect(u) {
    if (u.st.confused && u.rng() < this.cfg.v2_status.confused.chance) {
      this.S.wrongTarget++; const own = u.side === 'card' ? this.alive('card') : this.alive('enemy');
      return own[Math.floor(u.rng() * own.length)];
    }
    return null;
  }

  doBasic(u, tgt) {
    const R = this.cfg.v2_roles, ab = this.ablOf(u);
    const wrong = this.confusedRedirect(u);
    if (wrong) { this.damage(u, wrong, u.cp * (u.cls === 'support' ? this.cfg.v2_support.basic_x : 1) * this.cfg.v2_status.confused.self_x); return; }
    if (u.cls === 'support') {
      let x = u.role === 'artillery' ? R.artillery.basic_x : this.cfg.v2_support.basic_x, ts = u.role === 'artillery' && R.artillery.true_strike;
      if (u.role === 'artillery' && tgt.mech.has('rollback')) { x = tgt.P.rollback.artillery_basic_x; ts = tgt.P.rollback.artillery_true_strike; }
      const r = this.cardHit(u, tgt, { x, trueStrike: ts });
      if (r.dealt > 0) this.consumeMark(tgt);
      if (u.role === 'spotter' && r.dealt > 0) this.apply(u, tgt, 'exposed', { value: R.spotter.basic_expose * ab });
      if (u.role === 'herald') { const b = this.bestAttacker(); if (b) this.apply(u, b, 'empowered', { value: R.herald.basic_empower * ab }); }
      return;
    }
    const r = this.cardHit(u, tgt, { x: 1 });
    if (u.role === 'flurry' && u.rng() < R.flurry.extra_chance * ab && !tgt.down) this.cardHit(u, tgt, { x: R.flurry.extra_x, kind: 'extra' });
    if (u.role === 'cleaver') for (const e of this.alive('enemy')) if (e !== tgt) this.cardHit(u, e, { x: R.cleaver.splash * ab, kind: 'splash' });
    delete u.st.empowered; this.consumeMark(tgt);
  }

  // A support smite on its target: Rollback (x0.5), Hitbox Desync (the next smite misses), Mirror (the next smite hits its caster).
  smite(u, tgt, x, vsX, more = {}) {
    if (tgt.down) return 0; // the target fell to an earlier block of the same active (a Toxic burst): no hit and no draw (PR E6, the same rule in SQL)
    if (tgt.mech.has('rollback')) x *= tgt.P.rollback.smite_x;
    if (this.ext(tgt, 'desync_smite')) { delete tgt.ext.desync_smite; this.S.misses++; return 0; }
    if (this.ext(tgt, 'mirror_smite')) { delete tgt.ext.mirror_smite; this.damage(tgt, u, u.cp * x * vsX); return 0; }
    const r = this.cardHit(u, tgt, { x, trueStrike: true, vsX, bonus: more.bonus || 0, critAdd: more.critAdd || 0 }); this.consumeMark(tgt); tgt.lastSmite = r.dealt;
    return r.dealt;
  }

  // The unique active. Attacker blocks shape the hit. Support blocks are effects.
  doActive(u, tgt) {
    const cfg = this.cfg, ab = this.ablOf(u), B = u.active.blocks;
    if (u.cls === 'attacker') {
      const wrong = this.confusedRedirect(u);
      if (wrong) { this.damage(u, wrong, u.cp * cfg.v2_status.confused.self_x); return; }
      const o = { x: 1, n: 1, critAdd: 0, pierce: 0, trueStrike: false, bonus: 0, critBonus: 0, shieldX: 1 };
      let area = 0, lifesteal = 0, guardUp = 0, stealTo = null; const rid = [], onCrit = [], onKill = [], pays = [], post = [];
      // PR T1: an attachment is read with its host; a gate that does not hold now turns its host off for this active
      for (let j = 0; j < B.length; j++) { const b = B[j]; if (ATTACH.includes(b.k)) continue;
      const a = ATTACH.includes(B[j + 1]?.k) ? B[j + 1] : null;
      if (a && GATES.includes(a.k) && !this.gateOn(u, tgt, a)) continue;
      switch (b.k) {
        case 'hit': o.x = 1 + (b.x - 1) * ab; break;
        case 'strikes': o.n = b.n; o.x = (1 + (b.n * b.x - 1) * ab) / b.n; break;
        case 'crit_add': o.critAdd += b.v * ab; break;
        case 'pierce': o.pierce = Math.max(o.pierce, b.v); break;
        case 'true_strike': o.trueStrike = true; break;
        case 'area': area = b.x * ab; break;
        case 'payoff_dmg': if (this.hasAny(tgt, b)) o.bonus += b.v * ab; pays.push(b); break;
        case 'payoff_crit': if (this.hasAny(tgt, b)) o.critBonus += b.v * ab; pays.push(b); break;
        case 'per_ally': o.bonus += b.v * ab * this.alive('card').filter(c => c !== u && c.cls === 'attacker').length; break;
        case 'per_stack': o.bonus += b.v * ab * (tgt.st[b.status]?.stacks || 0); break;
        case 'per_kind': o.bonus += b.v * ab * this.negKinds(tgt); break;
        case 'vs_status': if (this.hasAny(tgt, b)) o.vsX = b.x; break;
        case 'execute': {
          const line = B.find(x => x.k === 'line_status');
          if (tgt.hp / tgt.maxHp < b.line || (line && this.hasAny(tgt, line))) o.bonus += b.v * ab; break; }
        case 'line_status': break;
        case 'lifesteal': lifesteal = b.v * ab; stealTo = b.to || null; break;
        case 'guard_up': guardUp = b.v * ab; break;
        case 'shield_break': o.shieldX = b.x; break;
        case 'apply': case 'random_apply': rid.push(b); break;
        case 'on_crit': onCrit.push(b); break;
        case 'on_kill': onKill.push(b); break;
        // Set 2 part (b): support blocks on an attacker. dispel strips the target when its block comes (before the hits; a later payoff reads the stripped
        // target); heal_all and quicken (self) run after the hits, with no crit roll (the hits have their own)
        case 'dispel': for (const s of BOONS) delete tgt.st[s]; tgt.shield = 0; break;
        case 'heal_all': case 'quicken': post.push(b); break;
        default: throw new Error(`doActive: block ${b.k} not for attackers`);
      } }
      if (this.alive('enemy').length === 1 && area) { o.bonus += area * cfg.v2_roles.cleaver.hunt_area_x; area = 0; }
      if (o.n > 1 && tgt.mech.has('mirror_hide')) o.x *= tgt.P.mirror_hide.strikes_x;
      let dealt = 0, anyCrit = false;
      const ridersOn = (t, all) => { for (const b of rid) { const ch = b.chance ?? 1;
        if ((!all || b.all) && u.rng() < Math.min(1, ch * (ch < 1 ? ab : 1))) {
          if (b.k === 'random_apply') { const op = b.options[Math.floor(u.rng() * b.options.length)]; this.apply(u, t, op.status, op); } // PR T1: one random status
          else this.apply(u, t, b.status, b);
        } } };
      for (let i = 0; i < o.n && !tgt.down; i++) {
        const r = this.cardHit(u, tgt, o); dealt += r.dealt; anyCrit ||= r.crit;
        if (!r.miss) ridersOn(tgt, false);
        if (r.crit) for (const b of onCrit) if (u.rng() < b.chance) this.apply(u, tgt, b.status, b);
        // PR T1: on_kill: the target is down after this hit (and its riders): a chance to put the status on the next standing enemy
        if (onKill.length && tgt.down) { const nx = this.alive('enemy')[0]; if (nx) for (const b of onKill) if (u.rng() < b.chance) this.apply(u, nx, b.status, b); }
      }
      // PR T1b (5): the payoffs count on each area hit against THAT enemy's statuses (before its hit). The balance shape decides: with no
      // share.area_payoff (the E6 and T1 files) an area hit has no payoff_dmg and keeps the crit bonus of the main target.
      const areaPay = cfg.ability_v2?.share?.area_payoff !== undefined;
      const payOn = (e) => { let bo = 0, cb = 0; for (const b of pays) if (this.hasAny(e, b)) { if (b.k === 'payoff_dmg') bo += b.v * ab; else cb += b.v * ab; } return { bonus: bo, critBonus: cb }; };
      if (area) for (const e of this.alive('enemy')) if (e !== tgt) { const r = this.cardHit(u, e, { ...o, x: area, bonus: 0, vsX: null, kind: 'area', ...(areaPay ? payOn(e) : {}) }); dealt += r.dealt; if (!r.miss) ridersOn(e, true); }
      if (lifesteal && dealt > 0) { const t = stealTo ? this.allyTo(stealTo) : u; if (t) this.heal(t, lifesteal * dealt); }
      if (guardUp && dealt > 0) this.addShield(u, guardUp * dealt);
      for (const b of post) {
        if (b.k === 'heal_all') { for (const t of this.alive('card')) this.heal(t, b.v * ab * t.maxHp); }
        else this.apply(u, u, 'quickened', { value: 1 + b.v * ab });
      }
      delete u.st.empowered; this.consumeMark(tgt);
      return;
    }
    // support
    const critRoll = () => (u.rng() < u.crit ? u.critx : 1);
    let smiteX = 0, vsX = 1, areaX = 0, cured = null, sBonus = 0, sCrit = 0;
    for (let j = 0; j < B.length; j++) {
      const b = B[j]; if (ATTACH.includes(b.k)) continue;
      // PR T1: the attachment of this block (the next block): a gate turns it off; coin, more_per, target_has and ally_below change its amount
      const a = ATTACH.includes(B[j + 1]?.k) ? B[j + 1] : null;
      if (a && GATES.includes(a.k) && !this.gateOn(u, tgt, a)) continue;
      const amount = (t) => { let v = b[AMOUNT_FIELD[b.k]];
        if (a?.k === 'coin') v = u.rng() < a.chance ? v : a.alt;
        if (a?.k === 'more_per') v += a.v * this.countOn(tgt, a.status, b.k === 'apply' ? b.status : null);
        if (a?.k === 'target_has' && this.hasAny(tgt, a)) v *= a.x;
        if (a?.k === 'ally_below' && t && t.hp / t.maxHp < a.line) v *= a.x;
        return v; };
      const ally = (kind) => (b.to && b.to !== 'cured' ? this.allyTo(b.to) : this.policy.allyFor(this, u, kind));
      switch (b.k) {
        case 'shield': { const t = b.to === 'cured' && cured && !cured.down ? cured : ally('shield'); if (t) this.addShield(t, amount(t) * ab * critRoll() * t.maxHp); break; }
        case 'shield_all': { const v = amount(null), c = critRoll(); for (const t of this.alive('card')) this.addShield(t, v * ab * c * t.maxHp); break; }
        case 'heal': { const t = ally('heal'); if (t) this.heal(t, amount(t) * ab * critRoll() * t.maxHp); break; }
        case 'heal_all': { const v = amount(null), c = critRoll(); for (const t of this.alive('card')) this.heal(t, v * ab * c * t.maxHp); break; } // all_allies (PR E6)
        case 'cleanse': for (const t of this.alive('card')) this.cleanseNeg(t); break;
        case 'cure': cured = this.cure(u, b); break;
        case 'empower': { const t = ally('empower'); if (t) this.apply(u, t, 'empowered', { value: amount(t) * ab * critRoll() }); break; }
        case 'rally': { const v = amount(null), c = critRoll(); for (const t of this.alive('card')) if (t.cls === 'attacker') this.apply(u, t, 'empowered', { value: v * ab * c }); break; }
        case 'focus': { const t = ally('empower'); if (t) this.apply(u, t, 'focused', { value: amount(t) * ab, crd: b.crd * ab }); break; }
        case 'quicken': { if (b.all) { const v = amount(null); for (const t of this.alive('card').filter(c => c.cls === 'attacker')) this.apply(u, t, 'quickened', { value: 1 + v * ab }); }
          else { const t = ally('empower'); if (t) this.apply(u, t, 'quickened', { value: 1 + amount(t) * ab }); } break; }
        case 'dispel': for (const s of BOONS) delete tgt.st[s]; tgt.shield = 0; break;
        case 'smite': smiteX = b.x * ab; break;
        case 'area': areaX = b.x * ab; break;
        case 'vs_status': if (this.hasAny(tgt, b)) vsX = b.x; break;
        case 'payoff_dmg': if (this.hasAny(tgt, b)) sBonus += b.v * ab; break; // PR T1: +v on the smite
        case 'crit_add': sCrit += b.v * ab; break; // PR T1: crit chance on the smite
        case 'consume': {
          if (tgt.st.burn) { let s = tgt.st.burn.stacks, tot = 0; while (s > 0) { tot += F.burnTick(cfg, s, this.refHp(tgt)); s -= cfg.v2_status.burn.decay; }
            delete tgt.st.burn; this.damage(u, tgt, tot * b.x * this.vuln(tgt), { tick: true, ignoreShield: true, kind: 'detonate' }); }
          break; }
        case 'apply': {
          if (u.rng() >= Math.min(1, b.chance * (b.chance < 1 ? ab : 1))) break;
          if (b.value === undefined) { this.apply(u, tgt, b.status, b); break; }
          let v = amount(null);
          if (b.per) { const n = this.countOn(tgt, b.per === 'kinds' ? null : b.per, b.status); if (!n) break; v *= n; } // PR T1: x the count; none = no status
          this.apply(u, tgt, b.status, { ...b, value: v * ab * (['exposed', 'weakened', 'mark'].includes(b.status) ? critRoll() : 1) }); break; }
        case 'random_apply': { const ch = b.chance ?? 1; // PR T1: one random status of the options
          if (u.rng() >= Math.min(1, ch * (ch < 1 ? ab : 1))) break;
          const op = b.options[Math.floor(u.rng() * b.options.length)]; this.apply(u, tgt, op.status, op); break; }
        default: throw new Error(`doActive: block ${b.k} not for supports`);
      }
    }
    // Support area smite (P3): the smite on the target, the area value on every other foe. One foe: + area_one_foe_x of the area value.
    if (areaX && !smiteX) throw new Error(`doActive: ${u.active.id}: an area block needs a smite block`);
    const others = areaX ? this.alive('enemy').filter(e => e !== tgt) : [];
    if (areaX && !others.length) smiteX += areaX * cfg.v2_support.area_one_foe_x;
    if (smiteX) this.smite(u, tgt, smiteX, vsX, { bonus: sBonus, critAdd: sCrit });
    for (const e of others) this.cardHit(u, e, { x: areaX, trueStrike: true, kind: 'area' });
  }

  // ---------- enemy AI ----------
  enemyAct(e) {
    const cfg = this.cfg;
    if (this.isBoss(e)) {
      const B = cfg.v2_enemy.boss_moves; const k = e.turn % B.cycle;
      if (k === B.cycle - 1) { e.charging = true; return; }
      if (k === 0) { e.charging = false; this.S.cataclysms++; for (const c of this.alive('card')) this.enemyHit(e, c, B.cataclysm_x, true);
        if (e.mech.has('rollout')) for (const c of this.alive('card')) this.apply(e, c, 'weakened', { value: e.P.rollout.weaken }); return; }
      if (e.moves2 && e.moves2.length && e.rng() < e.counterShare) return this.bossMove(e, e.moves2[Math.floor(e.rng() * e.moves2.length)]);
      const r = e.rng(); let t = 0; const pick = n => { t += B[n]; return r < t; };
      const single = r < B.strike + B.slam + B.drain + B.stun && !(r >= B.strike && r < B.strike + B.slam);
      if (single) { const w = this.confusedRedirect(e); if (w) { this.damage(e, w, e.atk * cfg.v2_status.confused.self_x * this.enemyMult(e)); return; } }
      if (pick('strike')) return this.enemyHit(e, this.pickCard(e), B.strike_x);
      if (pick('slam')) { for (const c of this.alive('card')) this.enemyHit(e, c, B.slam_x, true); return; }
      if (pick('drain')) { this.enemyHit(e, this.pickCard(e), B.drain_x); this.heal(e, cfg.v2_enemy.boss_heal_ref * B.drain_heal); return; }
      if (pick('stun')) { const c = this.pickCard(e); this.enemyHit(e, c, B.stun_x); if (c && !c.down) this.apply(e, c, 'stunned'); return; }
      if (pick('enrage')) { this.apply(e, e, 'enraged', { value: B.enrage_x, dur: B.enrage_dur }); return; }
      if (pick('curse')) { const c = this.pickCard(e); if (c) this.apply(e, c, 'weakened', { value: B.curse_weaken }); return; }
      this.heal(e, cfg.v2_enemy.boss_heal_ref * (e.hp / e.maxHp < B.rage_at ? B.regenerate_heal_rage : B.regenerate_heal));
      return;
    }
    const P = cfg.v2_dungeon.pool_moves;
    if (e.cataclysm) {
      const k = e.turn % P.cycle;
      if (k === P.cycle - 1) { e.charging = true; return; }
      if (k === 0) { e.charging = false; this.S.cataclysms++; for (const c of this.alive('card')) this.enemyHit(e, c, P.cataclysm_x, true); return; }
    }
    if (e.mech.has('bulwark') && e.turn % e.P.bulwark.every === 0) { this.addShield(e, e.maxHp * e.P.bulwark.guard); return; }
    const tot = e.moves.reduce((s, m) => s + m[1], 0); let r = e.rng() * tot, mv = e.moves[0][0];
    for (const [m, w] of e.moves) { r -= w; if (r < 0) { mv = m; break; } }
    const wrong = this.confusedRedirect(e);
    if (wrong && SINGLE_MOVES.includes(mv)) { this.damage(e, wrong, e.atk * cfg.v2_status.confused.self_x * this.enemyMult(e)); return; }
    const V = cfg.v2_dungeon.moves_v2;
    switch (mv) {
      case 'strike': return this.enemyHit(e, this.pickCard(e), 1);
      case 'heavy': return this.enemyHit(e, this.pickCard(e), P.heavy_x);
      case 'flurry': { const c = this.pickCard(e); this.enemyHit(e, c, P.flurry_x); return this.enemyHit(e, c, P.flurry_x); }
      case 'slam': for (const c of this.alive('card')) this.enemyHit(e, c, P.slam_x, true); return;
      case 'drain': { const d = this.enemyHit(e, this.pickCard(e), P.drain_x); this.heal(e, e.maxHp * P.drain_heal); return d; }
      case 'stun': { const c = this.pickCard(e); this.enemyHit(e, c, P.stun_x); if (c && !c.down) this.apply(e, c, 'stunned'); return; }
      case 'poison': { const c = this.pickCard(e); this.enemyHit(e, c, P.poison_x); if (c && !c.down) this.apply(e, c, 'poison', { stacks: 1 }); return; }
      case 'regenerate': this.heal(e, e.maxHp * (e.hp / e.maxHp < cfg.v2_enemy.boss_moves.rage_at ? P.regenerate_heal_rage : P.regenerate_heal)); return; // the v1 line (PR E7)
      case 'guard': this.addShield(e, e.maxHp * P.guard); return;
      case 'enrage': this.apply(e, e, 'enraged', { value: cfg.v2_status.enraged.x, dur: cfg.v2_status.enraged.dur }); return;
      case 'curse': { const c = this.pickCard(e); if (c) this.apply(e, c, 'weakened', { value: P.curse_weaken }); return; }
      // monsters-v2.md 3.1 status moves (v2_dungeon.moves_v2)
      case 'hellfire': { const c = this.pickCard(e); this.enemyHit(e, c, V.hellfire.x); if (c && !c.down) this.apply(e, c, 'burn', { stacks: V.hellfire.burn }); return; }
      case 'frost_punch': { const c = this.pickCard(e); this.enemyHit(e, c, V.frost_punch.x); if (c && !c.down) this.apply(e, c, 'chill', { stacks: V.frost_punch.chill }); return; }
      case 'squeeze': { const c = this.pickCard(e); this.enemyHit(e, c, V.squeeze.x); if (c && !c.down) this.apply(e, c, V.squeeze.status, {}); return; }
      case 'rattle': { const c = this.pickCard(e); if (c) this.apply(e, c, 'exposed', { value: V.rattle.exposed }); return; }
      case 'infect': { const c = this.pickCard(e); this.enemyHit(e, c, V.infect.x); if (c && !c.down) { this.apply(e, c, 'poison', { stacks: V.infect.poison }); c.ext.heal_cut = { v: 0, until: this.step + V.infect.no_heal }; } return; }
      case 'idle': return;
      default: throw new Error(`enemyAct: move ${mv}`);
    }
  }

  // ---------- named boss counter moves (v2_bosses.*.moves) ----------
  bossTarget(e, m) {
    const a = this.alive('card'); if (!a.length) return null;
    const sup = a.filter(c => c.cls === 'support'); const low = l => l.reduce((b, c) => (!b || c.hp / c.maxHp < b.hp / b.maxHp ? c : b), null);
    switch (m.tgt || 'random') {
      case 'random': return this.pickCard(e);
      case 'lowest': return low(a);
      case 'support': return sup.length ? sup[Math.floor(e.rng() * sup.length)] : this.pickCard(e);
      case 'weakest_support': return sup.length ? low(sup) : this.pickCard(e);
      case 'strongest_attacker': return this.bestAttacker() || this.pickCard(e);
      case 'empowered': { const em = a.filter(c => c.st.empowered); return em.length ? em.reduce((b, c) => (c.cp > b.cp ? c : b)) : this.pickCard(e); }
      case 'shielded': case 'biggest_shield': { const s = a.filter(c => c.shield > 0); return s.length ? s.reduce((b, c) => (c.shield > b.shield ? c : b)) : this.pickCard(e); }
      case 'frozen': { const f = a.filter(c => c.st.frozen); return f.length ? f[0] : this.pickCard(e); }
      case 'last_support': return this.lastSupport && !this.lastSupport.down ? this.lastSupport : this.pickCard(e);
      default: throw new Error(`bossTarget: ${m.tgt}`);
    }
  }
  bossMove(e, m) {
    const cfg = this.cfg, ref = cfg.v2_enemy.boss_heal_ref;
    this.S.counterMoves[m.id] = (this.S.counterMoves[m.id] || 0) + 1;
    const targets = () => { const a = this.alive('card'); if (m.tgt === 'all') return a; if (m.tgt === 'n') { const p = [...a], o = []; while (o.length < m.n && p.length) o.push(p.splice(Math.floor(e.rng() * p.length), 1)[0]); return o; } const t = this.bossTarget(e, m); return t ? [t] : []; };
    switch (m.k) {
      case 'hit': {
        const w = this.confusedRedirect(e); if (w) { this.damage(e, w, e.atk * cfg.v2_status.confused.self_x * this.enemyMult(e)); return; }
        const t = this.bossTarget(e, m); if (!t) return;
        const x = m.x * (m.vs_shielded && t.shield > 0 ? m.vs_shielded : 1) * (m.vs_frozen && t.st.frozen ? m.vs_frozen : 1);
        for (let i = 0; i < (m.n || 1) && !t.down; i++) this.enemyHit(e, t, x, false, { ignoreShield: m.ignore_shield });
        if (t.down) { if (m.enrage_on_kill) this.apply(e, e, 'enraged', { value: cfg.v2_enemy.boss_moves.enrage_x, dur: cfg.v2_enemy.boss_moves.enrage_dur }); return; }
        if (m.apply) this.apply(e, t, m.apply.status, m.apply);
        if (m.heal_cut) t.ext.heal_cut = { v: m.heal_cut.x, until: this.step + m.heal_cut.dur };
        if (m.decay && t.healedStep > 0) this.damage(e, t, t.healedStep, { tick: true, ignoreShield: true, pierce: 1, kind: 'decay' });
        return;
      }
      case 'area': for (const c of this.alive('card')) this.enemyHit(e, c, m.x * (m.vs_role?.[c.role] || 1) * (m.vs_cls?.[c.cls] || 1) * (m.vs_last_debuffer && c === e.lastDebuffer ? m.vs_last_debuffer : 1), true); return;
      case 'apply': for (const t of targets()) this.apply(e, t, m.status, m); return;
      case 'guard': this.addShield(e, m.v * ref); return;
      case 'heal': this.heal(e, m.v * ref); return;
      case 'cleanse_self': { const list = m.statuses || cfg.v2_status.negative; for (const s of list) if (e.st[s]) { this.remove(e, s); e.cleared = (e.cleared || 0) + 1; } return; }
      case 'cash_out': this.heal(e, ref * Math.min(m.max, m.per * (e.cleared || 0))); e.cleared = 0; return;
      case 'enrage': this.apply(e, e, 'enraged', { value: m.x, dur: m.dur }); return;
      case 'spiral': { const n = Math.min(m.max, e.blockedN || 0); if (n) this.apply(e, e, 'enraged', { value: 1 + m.per * n, dur: m.dur }); return; }
      case 'evade': e.ext.evade = { v: m.v, until: this.step + m.dur }; return;
      case 'charge': for (const c of this.alive('card')) if ((!m.role || c.role === m.role) && (!m.cls || c.cls === m.cls)) c.charge = Math.max(0, c.charge - m.n); return;
      case 'strip': for (const c of this.alive('card')) delete c.st[m.status]; return;
      case 'strip_shields': for (const c of this.alive('card')) { const lost = c.shield; c.shield = 0; if (m.crush && lost > 0) this.damage(e, c, lost * m.crush, { tick: true, ignoreShield: true, pierce: 1, kind: 'crush' }); } return;
      case 'skip': { const p = this.alive('card'); for (let i = 0; i < m.n && p.length; i++) { const c = p.splice(Math.floor(e.rng() * p.length), 1)[0]; c.banned = (c.banned || 0) + 1; } return; }
      case 'extra_action': e.meter += 100; return;
      case 'brood': e.brood = Math.min(e.P.brood?.max ?? 5, (e.brood || 0) + m.n); return;
      case 'state': e.ext[m.key] = { v: m.v, until: this.step + m.dur }; return;
      case 'undo_smite': if (e.lastSmite > 0) { this.heal(e, e.lastSmite); e.lastSmite = 0; } return;
      case 'desync_smite': e.ext.desync_smite = { v: 1, until: Infinity }; return;
      case 'mirror_smite': e.ext.mirror_smite = { v: 1, until: Infinity }; return;
      case 'siphon': if (this.healedStep > 0) this.heal(e, this.healedStep); return;
      default: throw new Error(`bossMove: kind ${m.k}`);
    }
  }
}
