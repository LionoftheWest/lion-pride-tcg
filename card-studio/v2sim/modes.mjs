// modes.mjs - enemies and the three modes: a Hunt day, a Dungeon run, a Gauntlet run.
import { Battle } from './engine.mjs';
import { makeCard } from './cards.mjs';
import { POLICIES } from './policy.mjs';
import { mkRng, hash } from './util.mjs';

const pickW = (rng, w) => { const e = Object.entries(w); const t = e.reduce((s, [, x]) => s + x, 0); let r = rng() * t; for (const [k, x] of e) { r -= x; if (r < 0) return k; } return e[e.length - 1][0]; };
const sample = (rng, arr, n) => { const a = [...arr], o = []; while (o.length < n && a.length) o.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return o; };

// ---------- the Hunt boss ----------
export function makeBoss(cfg, tier, { sigs, rng, startFrac } = {}) {
  const T = cfg.v2_enemy.hunt[tier]; if (!T) throw new Error(`makeBoss: tier ${tier}`);
  const r = rng || mkRng(1);
  const mech = sigs ?? sample(r, cfg.v2_enemy.signature_pool, T.signatures);
  const [lo, hi] = cfg.v2_enemy.start_hp_frac; const f = startFrac ?? (lo + r() * (hi - lo));
  return { key: `boss-${tier}`, name: `${tier} boss`, maxHp: T.hp, hp: T.hp * f, atk: T.atk * T.atk_x * cfg.v2_enemy.hunt_atk_scale,
    def: T.def, evasion: T.evasion, resolve: T.resolve, keen: T.keen, speedBase: T.speed, spdMult: 1, mech, healer: mech.includes('regrowth') };
}

// ---------- Dungeon foes ----------
export function makeFoe(cfg, floor, room, kind, rng, extraMech = []) {
  const D = cfg.v2_dungeon, G = D.growth, K = D.kinds[kind];
  const names = Object.keys(D.monsters); const key = names[Math.floor(rng() * names.length)]; const m = D.monsters[key];
  let hp = m.hp * Math.pow(G.hp, floor - 1) * (1 + G.room * (room - 1)) * K.hp * D.hp_x;
  let atk = m.atk * Math.pow(G.atk, floor - 1) * K.atk * D.atk_x;
  if (floor <= G.early_floors) { hp *= G.early_hp; atk *= G.early_atk; }
  const mech = [...sample(rng, D.passive_pool, K.passives), ...extraMech];
  return { key: `${key}-${kind}`, name: `${key} (${kind}) F${floor}`, maxHp: hp, hp, atk: Math.max(1, atk), def: K.def,
    evasion: Math.min(D.foe_evasion_max, D.foe_evasion_per_floor * (floor - 1)), resolve: D.foe_resolve[kind] || 0, keen: 0,
    speedBase: K.speed, spdMult: 1, moves: m.moves, charge: !!K.charge, mech,
    healer: mech.includes('regrowth') || m.moves.some(([mv]) => mv === 'regenerate' || mv === 'drain') };
}
export function floorPlan(cfg, floor, rng) {
  const D = cfg.v2_dungeon; const rooms = [];
  for (let r = 1; r <= D.rooms; r++) {
    const type = r === D.rooms ? 'guardian' : r === 1 ? 'fight' : pickW(rng, D.room_weights);
    let n = 1;
    if (type === 'fight') n = D.counts.fight_min + Math.floor(rng() * D.counts.fight_spread);
    if (type === 'horde') n = D.counts.horde_min + Math.floor(rng() * D.counts.horde_spread);
    rooms.push({ type, room: r, n });
  }
  return rooms;
}

// ---------- squads ----------
export const buildSquad = (cfg, specs) => specs.map(s => makeCard(cfg, s));
const fresh = c => ({ ...c, hp: c.hp ?? c.maxHp, shield: 0 });

// ---------- a Hunt day ----------
// The boss HP is shared by all players, so one day never kills it. The day starts at a random HP share (where in the week
// the player plays), which decides Finisher lines and the rage phase. Score = net damage (dealt minus boss heals).
export function huntDay(cfg, squad, { tier = 'Heroic', sigs, seed = 1, policy = 'best', startFrac } = {}) {
  const rng = mkRng(hash(seed, 'hunt-day'));
  const boss = makeBoss(cfg, tier, { sigs, rng, startFrac });
  const b = new Battle(cfg, { cards: squad.map(fresh), enemies: [boss], mode: 'hunt', policy: POLICIES[policy], seed, tier }).run();
  return { net: b.S.dealt - b.S.healedEnemy, dealt: b.S.dealt, healed: b.S.healedEnemy, steps: b.step, downs: b.cards.filter(c => c.down).length, b };
}

// ---------- one Dungeon fight ----------
export function dungeonFight(cfg, squadState, foes, { seed, policy = 'best', cap } = {}) {
  const b = new Battle(cfg, { cards: squadState.map(c => ({ ...c, shield: 0 })), enemies: foes, mode: 'dungeon', policy: POLICIES[policy], seed, cap }).run();
  return b;
}
// ---------- a Dungeon run ----------
export function dungeonRun(cfg, squad, { seed = 1, policy = 'best', floors, foeMech = [], cap } = {}) {
  const D = cfg.v2_dungeon; const maxF = floors ?? D.floors;
  const rng = mkRng(hash(seed, 'dungeon-plan'));
  let state = squad.map(c => ({ ...c, hp: c.maxHp }));
  let floor = 0, rooms = 0, end = 'cleared', steps = 0, fights = 0, capHits = 0;
  outer: for (let f = 1; f <= maxF; f++) {
    for (const rm of floorPlan(cfg, f, rng)) {
      if (rm.type === 'rest') { state = state.map(c => c.hp > 0 ? { ...c, hp: Math.min(c.maxHp, c.hp + D.rest_heal * c.maxHp) } : { ...c, hp: D.rest_revive * c.maxHp }); rooms++; continue; }
      if (rm.type === 'choice') { state = state.map(c => c.hp > 0 ? { ...c, hp: Math.min(c.maxHp, c.hp + D.choice_heal * c.maxHp) } : c); rooms++; continue; }
      if (rm.type === 'treasure') { rooms++; continue; }
      const foes = []; for (let i = 0; i < rm.n; i++) foes.push(makeFoe(cfg, f, rm.room, rm.type, rng, foeMech));
      const b = dungeonFight(cfg, state, foes, { seed: hash(seed, f, rm.room), policy, cap });
      fights++; steps += b.step;
      state = state.map((c, i) => ({ ...c, hp: b.cards[i].down ? 0 : b.cards[i].hp }));
      if (b.ended !== 'won') { end = b.ended; if (b.ended === 'cap') capHits++; break outer; }
      rooms++;
    }
    floor = f;
  }
  return { floor, rooms, end, steps, fights, capHits };
}

// ---------- the Gauntlet ----------
// One weekly squad for everyone: 0 stars, level 0, no points. The player's own investment is IGNORED by design.
export function gauntletSquadSpecs(cfg, pool, week) {
  const G = cfg.v2_gauntlet; const rng = mkRng(hash('gauntlet-week', week));
  const att = pool.filter(p => ['Character', 'Creature'].includes(p.type) && p.pullable.length);
  const sup = pool.filter(p => !['Character', 'Creature'].includes(p.type) && p.pullable.length);
  const one = p => { const r = p.pullable[Math.floor(rng() * p.pullable.length)]; return { key: p.key, name: p.name, role: p.role, cp_mod: p.cp_mod, rarity: r }; };
  return [...sample(rng, att, G.attackers).map(one), ...sample(rng, sup, G.supports).map(one)];
}
export function gauntletRun(cfg, weeklySpecs, player = {}, { seed = 1, policy = 'best' } = {}) {
  const G = cfg.v2_gauntlet;
  void player; // the player's stars, level and points never reach the Gauntlet squad
  const squad = buildSquad(cfg, weeklySpecs.map(s => ({ ...s, stars: G.stars, level: G.level, points: null })));
  return dungeonRun(cfg, squad, { seed, policy, floors: G.floors });
}
