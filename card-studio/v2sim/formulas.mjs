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
  // The point budget of a card: the level points + the bonus points of a refund (plan 20.11 decision 3; SQL card_combat_v2 with p_bonus).
  pointBudget(cfg, level, bonus = 0) { return F.levelPoints(cfg, level) + bonus; },
  // Card levels (plan 2.4; SQL card_level_xp_at, card_level_of_xp, card_level_xp_award). Level L to L + 1 costs cost_base + cost_per_level x L.
  xpAt(cfg, level) {
    const C = cfg.card_level, max = cfg.v2_level.max_level;
    if (!Number.isInteger(level) || level < 0 || level > max) throw new Error(`xpAt: level ${level} is not 0 to ${max}`);
    let xp = 0; for (let k = 0; k < level; k++) xp += C.cost_base + C.cost_per_level * k;
    return xp;
  },
  levelOfXp(cfg, xp) {
    if (!Number.isInteger(xp) || xp < 0) throw new Error(`levelOfXp: xp ${xp}`);
    let lv = 0; while (lv < cfg.v2_level.max_level && F.xpAt(cfg, lv + 1) <= xp) lv++;
    return lv;
  },
  // The XP of one fight-day: x catchup_x (rounded down) when the level is below the mean of the player's top catchup_top levels.
  xpAward(cfg, source, level, levels) {
    const C = cfg.card_level;
    const base = source === 'hunt' ? C.xp_hunt_day : source === 'dungeon' ? C.xp_dungeon_run : undefined;
    if (base === undefined) throw new Error(`xpAward: the source must be hunt or dungeon, not ${source}`);
    const top = [...levels].sort((a, b) => b - a).slice(0, C.catchup_top);
    const sum = top.reduce((s, x) => s + x, 0);
    // level x n < sum (exact in whole numbers); the product rounded to 9 decimals first, so a float like 1.57 x 100 = 156.99999 gives 157 as SQL numeric
    return top.length > 0 && level * top.length < sum ? Math.floor(+(base * C.catchup_x).toFixed(9)) : base;
  },
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
