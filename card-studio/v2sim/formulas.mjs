// formulas.mjs - every combat v2 formula in one object F, so a test can plant a fault in one formula
// (see faults.test.mjs) and prove that a check catches it. The engine and the card factory call F only.
export const F = {
  // ASC-3: catch-up base + one shared tier curve.
  ascCp(cfg, rarity, stars) {
    const A = cfg.v2_asc; const r = A.alias[rarity] || rarity; const b = A.base[r], top = A.top[r];
    if (b === undefined) throw new Error(`ascCp: unknown rarity ${rarity}`);
    const s = Math.max(0, Math.min(5, stars | 0));
    return b * (1 + (top / b - 1) * A.curve[s]);
  },
  // Convergence dial D (0 = off): move CP toward the target by D x level share.
  converge(cfg, cp, level) {
    const L = cfg.v2_level; const f = L.converge_d * Math.min(level, L.max_level) / L.max_level;
    return cp + f * (L.target_cp - cp);
  },
  levelPoints(cfg, level) { const L = cfg.v2_level; return Math.max(0, Math.min(level, L.max_level)) * L.points_per_level; },
  // The 9 stats from the base CP and the spent points. Flat ATK and HP, rates for the rest.
  stats(cfg, cpBase, pts) {
    const S = cfg.v2_stats; const p = k => Math.min(S.max_per_stat, pts[k] || 0); const H = cfg.v2_card_hp;
    return {
      cp: cpBase + S.atk.flat * p('atk'),
      maxHp: H.base + H.per_cp * cpBase + S.hp.flat * p('hp'),
      def: Math.min(S.def.cap, S.def.pct * p('def')),
      critx: S.crd.base + S.crd.pct * p('crd'),
      crit: Math.min(S.crt.cap, S.crt.base + S.crt.pct * p('crt')),
      abl: 1 + S.abl.pct * p('abl'),
      ddg: Math.min(S.ddg.cap, S.ddg.pct * p('ddg')),
      acc: S.acc.pct * p('acc'),
      spdMult: 1 + S.spd.pct * p('spd'),
    };
  },
  supportPower(cfg, cpBase) { const S = cfg.v2_support; return Math.pow(cpBase / S.power_ref, S.power_exp); },
  // Damage taken after Defense. pierce = share of Defense ignored.
  afterDefense(raw, def, pierce = 0) { return raw * (1 - def * (1 - Math.min(1, pierce))); },
  critChance(base, add, cap) { return Math.min(cap, base + add); },
  missChance(baseMiss, evasion, blind, acc) { return Math.max(0, baseMiss + evasion + blind - acc); },
  dodgeChance(ddg, keen, areaX) { return Math.max(0, ddg * (1 - keen) * areaX); },
  // Speed meter: the unit gains speed each clock step and acts at 100.
  meterGain(speed) { return speed; },
  effSpeed(cfg, base, spdMult, mods) {
    const V = cfg.v2_speed; // one loose safety cap on points x statuses, and a floor for Slowed / Chill
    return base * Math.min(V.safety_max_x, Math.max(V.status_min_x, spdMult * mods));
  },
  poisonTick(cfg, stacks, refHp) { return stacks * cfg.v2_status.poison.tick * refHp; },
  toxicBurst(cfg, refHp) { return cfg.v2_status.poison.burst * refHp; },
  burnTick(cfg, stacks, refHp) { const s = cfg.v2_status; return stacks * s.poison.tick * s.burn.tick_x * refHp; },
  healAmount(cfg, amount, burning) { return burning ? amount * cfg.v2_status.burn.heal_x : amount; },
};
