// engine.mjs - one combat v2 fight: speed meter with a hidden clock, statuses, the damage pipeline, card and enemy actions.
//
// Clock step ("round"): every standing unit adds its speed to its meter. A unit with meter >= 100 acts and loses 100
// (highest meter first). Speed 100 = one action a step. After the actions: ticks (Poison, Burn, regrowth), expiry.
// Durations, the 40-step cap and the Hunt daily cap count clock steps. Each unit has its own random stream
// (hash of the fight seed and its slot), so a change on one card moves the other units' draws as little as possible.
import { F } from './formulas.mjs';
import { mkRng, hash } from './util.mjs';

export const CONTROL = ['stunned', 'frozen', 'sleep', 'paralyzed'];
const BOONS = ['shielded', 'empowered', 'focused', 'quickened', 'enraged'];

export class Battle {
  constructor(cfg, { cards, enemies, mode = 'hunt', policy, seed = 1, cap, tier = null }) {
    this.cfg = cfg; this.mode = mode; this.policy = policy; this.tier = tier; this.step = 0;
    this.cap = cap ?? (mode === 'hunt' ? cfg.v2_hunt.round_cap : cfg.v2_dungeon.round_cap);
    this.rng = mkRng(hash(seed, 'battle'));
    this.cards = cards.map((c, i) => this.unit('card', c, i, seed));
    this.enemies = enemies.map((e, i) => this.unit('enemy', e, i, seed));
    this.units = [...this.cards, ...this.enemies];
    this.S = { dealt: 0, healedEnemy: 0, taken: 0, applied: {}, resisted: {}, immuneBlocked: {}, controlSkips: 0, enemyTurns: 0, enemyActs: 0,
      actives: 0, basics: 0, misses: 0, attacks: 0, crits: 0, bursts: 0, freezes: 0, wrongTarget: 0, wake: 0, paraFail: 0, byCard: {}, hitsTaken: {} };
    this.ended = null;
  }
  unit(side, d, idx, seed) {
    const rng = mkRng(hash(seed, side, idx, d.key || d.name || ''));
    const u = { ...d, side, idx, id: `${side}${idx}`, rng, st: {}, down: (d.hp ?? 1) <= 0, immUntil: -1, meter: rng() * 100, charge: this.cfg.v2_charge.start,
      shield: d.shield || 0, mech: new Set(d.mech || []), turn: 0, charging: false, held: 0 };
    if (u.hp === undefined) u.hp = u.maxHp;
    return u;
  }
  alive(side) { return (side === 'card' ? this.cards : this.enemies).filter(u => !u.down); }
  has(u, s) { return !!u.st[s]; }
  val(u, s) { return u.st[s] ? (u.st[s].v ?? u.st[s].stacks ?? 1) : 0; }
  negKinds(u) { return this.cfg.v2_status.negative.filter(s => u.st[s]).length; }
  refHp(u) { return u.side === 'enemy' && this.mode === 'hunt' ? this.cfg.v2_status.hunt_ref_hp : u.maxHp; }
  isBoss(u) { return u.side === 'enemy' && this.mode === 'hunt'; }
  ablOf(u) { return u.abl || 1; }

  // ---------- speed ----------
  speedOf(u) {
    const S = this.cfg.v2_status; let m = 1;
    if (u.st.slowed) m *= u.st.slowed.v; if (u.st.quickened) m *= u.st.quickened.v;
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
  apply(src, tgt, name, o = {}) {
    if (!tgt || tgt.down) return false;
    const cfg = this.cfg, S = cfg.v2_status, M = cfg.v2_enemy.mechanics;
    const neg = S.negative.includes(name) || name === 'stunned';
    for (const m of tgt.mech) if (M[m]?.immune?.includes(name)) { this.S.immuneBlocked[name] = (this.S.immuneBlocked[name] || 0) + 1; return false; }
    if (neg && src && src.side !== tgt.side) {
      let res = tgt.resolve || 0;
      if (src.side === 'card') res = Math.max(0, res * (src.role === 'controller' ? 1 - cfg.v2_roles.controller.resolve_ignore : 1) - (src.acc || 0) * cfg.v2_hit.resolve_acc / cfg.v2_stats.acc.pct);
      if (res > 0 && src.rng() < res) { this.S.resisted[name] = (this.S.resisted[name] || 0) + 1; return false; }
    }
    if (CONTROL.includes(name) && tgt.mech.has('unstoppable') && (src || tgt).rng() < M.unstoppable.control_fail) { this.S.resisted[name] = (this.S.resisted[name] || 0) + 1; return false; }
    if (CONTROL.includes(name)) {
      if (CONTROL.some(c => tgt.st[c]) || this.step < tgt.immUntil) { this.S.immuneBlocked[name] = (this.S.immuneBlocked[name] || 0) + 1; return false; }
      const life = name === 'stunned' || name === 'frozen' ? (tgt.side === 'card' ? S[name].max_life_card : S[name].max_life) : this.dur(tgt, name, src);
      tgt.st[name] = { until: this.step + (this.isBoss(tgt) && name !== 'stunned' && name !== 'frozen' ? cfg.v2_control.boss_max_dur : life) };
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
      const cap = tgt.mech.has('thick_hide') ? M.thick_hide.expose_cap : S.exposed.cap;
      const cur = tgt.st.exposed ? tgt.st.exposed.v : 0; tgt.st.exposed = { v: Math.min(cap, cur + o.value * (tgt.mech.has('dispeller') ? M.dispeller.x : 1)), until: this.step + this.dur(tgt, 'exposed', src) };
    } else if (name === 'weakened') {
      const cur = tgt.st.weakened ? tgt.st.weakened.v : 0; tgt.st.weakened = { v: Math.min(S.weakened.cap, cur + o.value), until: this.step + this.dur(tgt, 'weakened', src) };
    } else if (name === 'mark') {
      const cur = tgt.st.mark ? tgt.st.mark.v : 0; tgt.st.mark = { v: Math.max(cur, o.value), until: this.step + S.mark.dur };
    } else if (name === 'slowed' || name === 'quickened') {
      tgt.st[name] = { v: o.value ?? S[name].x, until: this.step + this.dur(tgt, name, src) };
    } else if (name === 'blinded' || name === 'confused' || name === 'enraged' || name === 'focused') {
      tgt.st[name] = { v: o.value ?? 1, crd: o.crd, until: this.step + (o.dur ?? this.dur(tgt, name, src)) };
    } else if (name === 'empowered') {
      const cur = tgt.st.empowered ? tgt.st.empowered.v : 0; tgt.st.empowered = { v: Math.min(S.empowered.cap, Math.max(cur, o.value)) };
    } else throw new Error(`apply: unknown status ${name}`);
    this.S.applied[name] = (this.S.applied[name] || 0) + 1;
    return true;
  }
  remove(u, name) {
    if (!u.st[name]) return;
    delete u.st[name];
    if (CONTROL.includes(name)) { const C = this.cfg.v2_control; u.immUntil = this.step + (u.side === 'card' ? C.immune_card : this.isBoss(u) ? C.boss_immune : C.immune); }
  }
  cleanseNeg(u) { for (const s of this.cfg.v2_status.negative) this.remove(u, s); }
  vuln(t) { return 1 + (t.st.exposed ? t.st.exposed.v : 0); }

  // ---------- damage ----------
  // amount = raw damage before the target's Defense. o: { pierce, ignoreShield, shieldX, tick, kind }
  damage(src, tgt, amount, o = {}) {
    if (tgt.down || amount <= 0) return 0;
    let a = F.afterDefense(amount, tgt.def || 0, o.pierce || 0);
    if (tgt.side === 'card') {
      const w = this.cards.find(c => c.role === 'warden' && !c.down && c !== tgt);
      if (w) a *= 1 - this.cfg.v2_roles.warden.ally_dr;
    }
    if (tgt.mech.has('steadfast') && this.negKinds(tgt) < this.cfg.v2_enemy.mechanics.steadfast.kinds) a *= 1 - this.cfg.v2_enemy.mechanics.steadfast.dr;
    if (!o.tick) a = Math.max(this.cfg.v2_hit.min_dmg, a);
    let absorbed = 0;
    if (tgt.shield > 0 && !o.ignoreShield) {
      const sx = o.shieldX || 1; const cap = tgt.shield / sx; absorbed = Math.min(a, cap);
      tgt.shield = Math.max(0, tgt.shield - absorbed * sx); a -= absorbed;
    }
    const hpLoss = Math.min(tgt.hp, a); tgt.hp -= a;
    if (tgt.st.sleep && !o.tick) { this.remove(tgt, 'sleep'); this.S.wake++; }
    const tot = absorbed + hpLoss;
    if (tgt.side === 'enemy') { this.S.dealt += tot; if (src && src.side === 'card') this.S.byCard[src.idx] = (this.S.byCard[src.idx] || 0) + tot; }
    else { this.S.taken += tot; if (!o.tick) this.S.hitsTaken[tgt.idx] = (this.S.hitsTaken[tgt.idx] || 0) + 1; }
    if (tgt.hp <= 0) { tgt.hp = 0; tgt.down = true; tgt.st = {}; tgt.shield = 0; }
    return tot;
  }
  heal(u, amount) {
    if (u.down || amount <= 0) return 0;
    const h = Math.min(u.maxHp - u.hp, F.healAmount(this.cfg, amount, !!u.st.burn)); u.hp += h;
    if (u.side === 'enemy') this.S.healedEnemy += h; return h;
  }
  addShield(u, amount) { if (u.down) return; u.shield = Math.min(u.maxHp * this.cfg.v2_status.shielded.cap_maxhp, u.shield + amount); }

  // One hit of a card on an enemy (or on an ally when Confused). o: { x, critAdd, pierce, trueStrike, bonus, critBonus, vsX, shieldX }
  cardHit(src, tgt, o) {
    const cfg = this.cfg, R = cfg.v2_roles, ab = this.ablOf(src);
    this.S.attacks++;
    const marked = !!tgt.st.mark;
    if (!o.trueStrike && !marked) {
      const miss = F.missChance(cfg.v2_hit.miss, tgt.evasion || 0, src.st.blinded ? cfg.v2_status.blinded.miss : 0, src.acc || 0);
      if (src.rng() < miss) { this.S.misses++; return { dealt: 0, crit: false, miss: true }; }
    }
    let mult = o.x * (cfg.v2_hit.roll_min + src.rng() * cfg.v2_hit.roll_span);
    const canCrit = !(tgt.mech.has('ironhide') && !marked);
    let critC = src.crit + (o.critAdd || 0) + (o.critBonus || 0) + (src.st.focused ? src.st.focused.v : 0);
    if (src.role === 'striker') critC += R.striker.crit_add * ab;
    critC = F.critChance(0, critC, cfg.v2_stats.crt.cap + (src.st.focused ? src.st.focused.v : 0));
    const crit = canCrit && src.rng() < critC;
    if (crit) { this.S.crits++; mult *= src.critx + (src.role === 'striker' ? R.striker.critx_add * ab : 0) + (src.st.focused?.crd || 0); }
    if (src.st.empowered) mult *= 1 + src.st.empowered.v * (tgt.mech.has('dispeller') ? cfg.v2_enemy.mechanics.dispeller.x : 1);
    if (src.st.weakened) mult *= 1 - src.st.weakened.v;
    if (src.st.chill) mult *= 1 - cfg.v2_status.chill.dmg * src.st.chill.stacks;
    mult *= this.vuln(tgt);
    if (marked) mult *= 1 + tgt.st.mark.v;
    let bonus = o.bonus || 0;
    if (src.role === 'finisher' && tgt.hp / tgt.maxHp < R.finisher.line) bonus += R.finisher.bonus * ab;
    if (src.role === 'cleaver' && this.alive('enemy').length === 1) bonus += R.cleaver.hunt_bonus * ab;
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
    return m;
  }
  enemyHit(e, tgt, x, area = false) {
    const cfg = this.cfg; if (!tgt || tgt.down) return 0;
    if (e.st.blinded && e.rng() < cfg.v2_status.blinded.miss) { this.S.misses++; return 0; }
    if (!e.mech.has('true_strike')) {
      const dg = F.dodgeChance(tgt.ddg || 0, e.keen || 0, area ? cfg.v2_stats.ddg.area_x : 1);
      if (dg > 0 && tgt.rng() < dg) return 0;
    }
    const raw = e.atk * x * (cfg.v2_hit.roll_min + e.rng() * cfg.v2_hit.roll_span) * this.enemyMult(e) * this.vuln(tgt);
    const M = cfg.v2_enemy.mechanics;
    const dealt = this.damage(e, tgt, raw, { pierce: e.mech.has('sunder') ? M.sunder.pierce : 0, shieldX: e.mech.has('shatter') ? M.shatter.shield_x : 1 });
    if (!area && !tgt.down) {
      if (e.mech.has('frost_aura')) this.apply(e, tgt, 'chill', { stacks: M.frost_aura.chill });
      if (e.mech.has('venom')) this.apply(e, tgt, 'poison', { stacks: M.venom.poison });
      if (e.mech.has('burning')) this.apply(e, tgt, 'burn', { stacks: M.burning.burn });
    }
    if (area && e.mech.has('slowing') && !tgt.down) this.apply(e, tgt, 'slowed', {});
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
    this.step++;
    for (const u of this.units) if (!u.down) u.meter += F.meterGain(this.speedOf(u));
    const maxA = this.cfg.v2_speed.max_actions_per_step;
    for (let guard = 0; guard < this.units.length * maxA; guard++) {
      let best = null; for (const u of this.units) if (!u.down && u.meter >= 100 && (!best || u.meter > best.meter)) best = u;
      if (!best) break;
      best.meter -= 100; this.act(best);
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
    const cfg = this.cfg, S = cfg.v2_status, M = cfg.v2_enemy.mechanics;
    for (const u of this.units) {
      if (u.down) continue;
      if (u.st.poison) this.damage(null, u, F.poisonTick(cfg, u.st.poison.stacks, this.refHp(u)) * this.vuln(u), { tick: true, ignoreShield: true, kind: 'poison' });
      if (!u.down && u.st.burn) {
        const healer = u.mech.has('regrowth') || u.healer;
        this.damage(null, u, F.burnTick(cfg, u.st.burn.stacks, this.refHp(u)) * this.vuln(u) * (healer ? S.burn.vs_healer_x : 1), { tick: true, ignoreShield: true, kind: 'burn' });
        if (u.st.burn) { u.st.burn.stacks -= S.burn.decay; if (u.st.burn.stacks <= 0) delete u.st.burn; }
      }
      if (!u.down && u.mech.has('regrowth')) {
        const ref = this.isBoss(u) ? cfg.v2_enemy.boss_heal_ref : u.maxHp;
        this.heal(u, ref * M.regrowth.heal * (u.hp / u.maxHp < 0.5 ? M.regrowth.below_half_x : 1));
      }
      for (const [k, s] of Object.entries(u.st)) if (s.until !== undefined && s.until <= this.step) this.remove(u, k);
    }
  }

  // ---------- actions ----------
  act(u) {
    u.turn++;
    if (u.side === 'enemy') {
      this.S.enemyTurns++;
      if (u.mech.has('purify') && u.turn % this.cfg.v2_enemy.mechanics.purify.every === 0) this.cleanseNeg(u);
      if (u.mech.has('elusive')) delete u.st.mark;
    }
    if (u.st.stunned || u.st.frozen) { this.remove(u, u.st.stunned ? 'stunned' : 'frozen'); this.S.controlSkips++; if (u.side === 'enemy') u.charging = false; return; }
    if (u.st.sleep) { this.S.controlSkips++; if (u.side === 'enemy') u.charging = false; return; }
    if (u.st.paralyzed && u.rng() < this.cfg.v2_status.paralyzed.fail) { this.S.controlSkips++; this.S.paraFail++; if (u.side === 'enemy') u.charging = false; return; }
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
      const x = u.role === 'artillery' ? R.artillery.basic_x : this.cfg.v2_support.basic_x;
      const r = this.cardHit(u, tgt, { x, trueStrike: u.role === 'artillery' && R.artillery.true_strike });
      if (r.dealt > 0) this.consumeMark(tgt);
      if (u.role === 'spotter' && r.dealt > 0) this.apply(u, tgt, 'exposed', { value: R.spotter.basic_expose * ab });
      if (u.role === 'herald') { const b = this.bestAttacker(); if (b) this.apply(u, b, 'empowered', { value: R.herald.basic_empower * ab }); }
      return;
    }
    const r = this.cardHit(u, tgt, { x: 1 });
    if (u.role === 'flurry' && u.rng() < R.flurry.extra_chance * ab && !tgt.down) this.cardHit(u, tgt, { x: R.flurry.extra_x });
    if (u.role === 'cleaver') for (const e of this.alive('enemy')) if (e !== tgt) this.cardHit(u, e, { x: R.cleaver.splash * ab });
    delete u.st.empowered; this.consumeMark(tgt);
  }

  // The unique active. Attacker blocks shape the hit. Support blocks are effects.
  doActive(u, tgt) {
    const cfg = this.cfg, ab = this.ablOf(u), B = u.active.blocks;
    if (u.cls === 'attacker') {
      const wrong = this.confusedRedirect(u);
      if (wrong) { this.damage(u, wrong, u.cp * cfg.v2_status.confused.self_x); return; }
      const o = { x: 1, n: 1, critAdd: 0, pierce: 0, trueStrike: false, bonus: 0, critBonus: 0, shieldX: 1 };
      let area = 0, lifesteal = 0, guardUp = 0; const rid = [], onCrit = [];
      for (const b of B) switch (b.k) {
        case 'hit': o.x = 1 + (b.x - 1) * ab; break;
        case 'strikes': o.n = b.n; o.x = (1 + (b.n * b.x - 1) * ab) / b.n; break;
        case 'crit_add': o.critAdd += b.v * ab; break;
        case 'pierce': o.pierce = Math.max(o.pierce, b.v); break;
        case 'true_strike': o.trueStrike = true; break;
        case 'area': area = b.x * ab; break;
        case 'payoff_dmg': if (this.has(tgt, b.status)) o.bonus += b.v * ab; break;
        case 'payoff_crit': if (this.has(tgt, b.status)) o.critBonus += b.v * ab; break;
        case 'per_stack': o.bonus += b.v * ab * (tgt.st[b.status]?.stacks || 0); break;
        case 'per_kind': o.bonus += b.v * ab * this.negKinds(tgt); break;
        case 'vs_status': if (this.has(tgt, b.status)) o.vsX = b.x; break;
        case 'execute': {
          const line = B.find(x => x.k === 'line_status');
          if (tgt.hp / tgt.maxHp < b.line || (line && line.statuses.some(s => this.has(tgt, s)))) o.bonus += b.v * ab; break; }
        case 'line_status': break;
        case 'lifesteal': lifesteal = b.v * ab; break;
        case 'guard_up': guardUp = b.v * ab; break;
        case 'shield_break': o.shieldX = b.x; break;
        case 'apply': rid.push(b); break;
        case 'on_crit': onCrit.push(b); break;
        default: throw new Error(`doActive: block ${b.k} not for attackers`);
      }
      if (this.alive('enemy').length === 1 && area) { o.bonus += area * 0.5; area = 0; }
      let dealt = 0, anyCrit = false;
      const ridersOn = (t, all) => { for (const b of rid) if ((!all || b.all) && u.rng() < Math.min(1, b.chance * (b.chance < 1 ? ab : 1))) this.apply(u, t, b.status, b); };
      for (let i = 0; i < o.n && !tgt.down; i++) {
        const r = this.cardHit(u, tgt, o); dealt += r.dealt; anyCrit ||= r.crit;
        if (!r.miss) ridersOn(tgt, false);
        if (r.crit) for (const b of onCrit) if (u.rng() < b.chance) this.apply(u, tgt, b.status, b);
      }
      if (area) for (const e of this.alive('enemy')) if (e !== tgt) { const r = this.cardHit(u, e, { ...o, x: area, bonus: 0, vsX: null }); dealt += r.dealt; if (!r.miss) ridersOn(e, true); }
      if (lifesteal && dealt > 0) this.heal(u, lifesteal * dealt);
      if (guardUp && dealt > 0) this.addShield(u, guardUp * dealt);
      delete u.st.empowered; this.consumeMark(tgt);
      return;
    }
    // support
    const critRoll = () => (u.rng() < u.crit ? u.critx : 1);
    let smiteX = 0, vsX = 1, dealt = 0;
    for (const b of B) {
      switch (b.k) {
        case 'shield': { const t = this.policy.allyFor(this, u, 'shield'); if (t) this.addShield(t, b.v * ab * critRoll() * t.maxHp); break; }
        case 'shield_all': { const c = critRoll(); for (const t of this.alive('card')) this.addShield(t, b.v * ab * c * t.maxHp); break; }
        case 'heal': { const t = this.policy.allyFor(this, u, 'heal'); if (t) this.heal(t, b.v * ab * critRoll() * t.maxHp); break; }
        case 'cleanse': for (const t of this.alive('card')) this.cleanseNeg(t); break;
        case 'empower': { const t = this.policy.allyFor(this, u, 'empower'); if (t) this.apply(u, t, 'empowered', { value: b.v * ab * critRoll() }); break; }
        case 'rally': { const c = critRoll(); for (const t of this.alive('card')) if (t.cls === 'attacker') this.apply(u, t, 'empowered', { value: b.v * ab * c }); break; }
        case 'focus': { const t = this.policy.allyFor(this, u, 'empower'); if (t) this.apply(u, t, 'focused', { value: b.crit * ab, crd: b.crd * ab }); break; }
        case 'quicken': { const ts = b.all ? this.alive('card').filter(c => c.cls === 'attacker') : [this.policy.allyFor(this, u, 'empower')]; for (const t of ts) if (t) this.apply(u, t, 'quickened', { value: 1 + b.v * ab }); break; }
        case 'dispel': for (const s of BOONS) delete tgt.st[s]; tgt.shield = 0; break;
        case 'smite': smiteX = b.x * ab; break;
        case 'vs_status': if (this.has(tgt, b.status)) vsX = b.x; break;
        case 'consume': {
          if (tgt.st.burn) { let s = tgt.st.burn.stacks, tot = 0; while (s > 0) { tot += F.burnTick(cfg, s, this.refHp(tgt)); s -= cfg.v2_status.burn.decay; }
            delete tgt.st.burn; dealt += this.damage(u, tgt, tot * b.x * this.vuln(tgt), { tick: true, ignoreShield: true, kind: 'detonate' }); }
          break; }
        case 'apply': {
          if (u.rng() >= Math.min(1, b.chance * (b.chance < 1 ? ab : 1))) break;
          const amt = b.value !== undefined ? { ...b, value: b.value * ab * (['exposed', 'weakened', 'mark'].includes(b.status) ? critRoll() : 1) } : b;
          this.apply(u, tgt, b.status, amt); break; }
        default: throw new Error(`doActive: block ${b.k} not for supports`);
      }
    }
    if (smiteX) { const r = this.cardHit(u, tgt, { x: smiteX, trueStrike: true, vsX }); dealt += r.dealt; this.consumeMark(tgt); }
  }

  // ---------- enemy AI ----------
  enemyAct(e) {
    const cfg = this.cfg;
    if (this.isBoss(e)) {
      const B = cfg.v2_enemy.boss_moves; const k = e.turn % B.cycle;
      if (k === B.cycle - 1) { e.charging = true; return; }
      if (k === 0) { e.charging = false; for (const c of this.alive('card')) this.enemyHit(e, c, B.cataclysm_x, true); return; }
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
    if (e.charge) {
      const k = e.turn % P.cycle;
      if (k === P.cycle - 1) { e.charging = true; return; }
      if (k === 0) { e.charging = false; for (const c of this.alive('card')) this.enemyHit(e, c, P.cataclysm_x, true); return; }
    }
    const tot = e.moves.reduce((s, m) => s + m[1], 0); let r = e.rng() * tot, mv = e.moves[0][0];
    for (const [m, w] of e.moves) { r -= w; if (r < 0) { mv = m; break; } }
    const wrong = this.confusedRedirect(e);
    if (wrong && ['strike', 'heavy', 'flurry', 'drain', 'stun', 'poison'].includes(mv)) { this.damage(e, wrong, e.atk * cfg.v2_status.confused.self_x * this.enemyMult(e)); return; }
    switch (mv) {
      case 'strike': return this.enemyHit(e, this.pickCard(e), 1);
      case 'heavy': return this.enemyHit(e, this.pickCard(e), P.heavy_x);
      case 'flurry': { const c = this.pickCard(e); this.enemyHit(e, c, P.flurry_x); return this.enemyHit(e, c, P.flurry_x); }
      case 'slam': for (const c of this.alive('card')) this.enemyHit(e, c, P.slam_x, true); return;
      case 'drain': { const d = this.enemyHit(e, this.pickCard(e), P.drain_x); this.heal(e, e.maxHp * P.drain_heal); return d; }
      case 'stun': { const c = this.pickCard(e); this.enemyHit(e, c, P.stun_x); if (c && !c.down) this.apply(e, c, 'stunned'); return; }
      case 'poison': { const c = this.pickCard(e); this.enemyHit(e, c, P.poison_x); if (c && !c.down) this.apply(e, c, 'poison', { stacks: 1 }); return; }
      case 'regenerate': this.heal(e, e.maxHp * (e.hp / e.maxHp < 0.5 ? P.regenerate_heal_rage : P.regenerate_heal)); return;
      case 'guard': this.addShield(e, e.maxHp * P.guard); return;
      case 'enrage': this.apply(e, e, 'enraged', { value: cfg.v2_status.enraged.x, dur: cfg.v2_status.enraged.dur }); return;
      case 'curse': { const c = this.pickCard(e); if (c) this.apply(e, c, 'weakened', { value: P.curse_weaken }); return; }
      case 'idle': return;
      default: throw new Error(`enemyAct: move ${mv}`);
    }
  }
}
