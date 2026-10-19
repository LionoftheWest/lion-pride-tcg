// modes.mjs - enemies and the three modes: a Hunt day, a Dungeon run, a Gauntlet run.
import { Battle } from './engine.mjs';
import { makeCard } from './cards.mjs';
import { POLICIES } from './policy.mjs';
import { mkRng, hash } from './util.mjs';

const pickW = (rng, w) => { const e = Object.entries(w); const t = e.reduce((s, [, x]) => s + x, 0); let r = rng() * t; for (const [k, x] of e) { r -= x; if (r < 0) return k; } return e[e.length - 1][0]; };
const sample = (rng, arr, n) => { const a = [...arr], o = []; while (o.length < n && a.length) o.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return o; };

// ---------- the Hunt boss ----------
// boss = a key of v2_bosses (a named boss: resists, signature rules, Mythic rules, counter moves, hp_factor), else the
// tier boss with `sigs` (or random signatures). HP = tier HP x asc3_hp_x x hp_factor (Nathan approved 2026-10-19).
// weakRole = a "Weak to: role" week: cards of that role deal +weak_role_x.
export function bossMechs(cfg, boss, tier) {
  const B = cfg.v2_bosses[boss]; if (!B) throw new Error(`unknown boss ${boss}`);
  const my = tier === 'Mythic';
  return { B, mech: [...B.sig, ...(my ? B.mythic || [] : [])], resists: [...B.resists, ...(my ? B.mythic_resists || [] : [])], params: B.params || {} };
}
export function makeBoss(cfg, tier, { sigs, rng, startFrac, boss, weakRole } = {}) {
  const T = cfg.v2_enemy.hunt[tier]; if (!T) throw new Error(`makeBoss: tier ${tier}`);
  const r = rng || mkRng(1);
  const N = boss ? bossMechs(cfg, boss, tier) : null;
  const mech = N ? N.mech : (sigs ?? sample(r, cfg.v2_enemy.signature_pool, T.signatures));
  const [lo, hi] = cfg.v2_enemy.start_hp_frac; const f = startFrac ?? (lo + r() * (hi - lo));
  const hp = T.hp * (cfg.v2_enemy.asc3_hp_x ?? 1) * (N ? N.B.hp_factor ?? 1 : 1);
  return { key: boss ? `boss-${boss}` : `boss-${tier}`, name: N ? N.B.name : `${tier} boss`, maxHp: hp, hp: hp * f, atk: T.atk * T.atk_x * cfg.v2_enemy.hunt_atk_scale,
    def: T.def, evasion: T.evasion, resolve: T.resolve, keen: T.keen, speedBase: T.speed, spdMult: 1, mech, resists: N ? N.resists : [], params: N ? N.params : {},
    moves2: N ? N.B.moves : null, counterShare: N ? N.B.counter_share ?? 0.4 : 0, weakRole: weakRole || null, healer: mech.includes('regrowth') };
}

// ---------- Dungeon foes ----------
// The monster's own passive (monsters-v2.md 3.1) takes the first passive slot at elite, miniboss and guardian.
// The raptor gets Pack in hordes. The status moves of moves_v2 replace the old moves. own = the passives a room keeps.
export function ownPassives(cfg, key, kind) {
  const MP = cfg.v2_dungeon.monster_passives; if (!MP?.on) return { slot: [], extra: [] };
  const e = MP.list[key]; const slot = e && (e.kinds || MP.kinds).includes(kind) ? [e.mech] : [];
  const extra = MP.pack && MP.pack.monster === key && MP.pack.kinds.includes(kind) ? ['pack'] : [];
  return { slot, extra };
}
export function foeMoves(cfg, key) {
  const m = cfg.v2_dungeon.monsters[key].moves, V = cfg.v2_dungeon.moves_v2;
  if (!V?.on || !V.rename[key]) return m;
  return m.map(([mv, w]) => [V.rename[key][mv] || mv, w]);
}
export function makeFoe(cfg, floor, room, kind, rng, extraMech = []) {
  const D = cfg.v2_dungeon, G = D.growth, K = D.kinds[kind];
  const names = Object.keys(D.monsters); const key = names[Math.floor(rng() * names.length)]; const m = D.monsters[key];
  let hp = m.hp * Math.pow(G.hp, floor - 1) * (1 + G.room * (room - 1)) * K.hp * D.hp_x;
  let atk = m.atk * Math.pow(G.atk, floor - 1) * K.atk * D.atk_x;
  if (floor <= G.early_floors) { hp *= G.early_hp; atk *= G.early_atk; }
  const own = ownPassives(cfg, key, kind);
  const pool = D.passive_pool.filter(p => !own.slot.includes(p));
  const mech = [...own.slot, ...sample(rng, pool, Math.max(0, K.passives - own.slot.length)), ...own.extra, ...extraMech];
  const moves = foeMoves(cfg, key);
  return { key: `${key}-${kind}`, monster: key, name: `${key} (${kind}) F${floor}`, maxHp: hp, hp, atk: Math.max(1, atk), def: K.def,
    evasion: Math.min(D.foe_evasion_max, D.foe_evasion_per_floor * (floor - 1)), resolve: D.foe_resolve[kind] || 0, keen: 0,
    speedBase: K.speed, spdMult: 1, moves, cataclysm: !!K.charge, mech, own: [...own.slot, ...own.extra],
    healer: mech.includes('regrowth') || moves.some(([mv]) => mv === 'regenerate' || mv === 'drain') };
}
// A room foe with a fixed mechanic list (the teams test and the monsters matrix): the monster's own passives stay, the random ones go.
export function setFoeMech(f, mechs, extra = {}) {
  f.mech = [...(f.own || []), ...mechs.filter(m => !(f.own || []).includes(m))];
  Object.assign(f, extra);
  f.healer = f.mech.includes('regrowth') || f.moves.some(([mv]) => mv === 'regenerate' || mv === 'drain');
  return f;
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
export function huntDay(cfg, squad, { tier = 'Heroic', sigs, seed = 1, policy = 'best', startFrac, boss: bossKey, weakRole } = {}) {
  const rng = mkRng(hash(seed, 'hunt-day'));
  const boss = makeBoss(cfg, tier, { sigs, rng, startFrac, boss: bossKey, weakRole });
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
// The Gauntlet foes (monsters-v2.md 1.3, approved 2026-10-19): the Dungeon foes x foe_x, their own growth a floor, bigger heal rooms, more rest and choice rooms.
export function gauntletCfg(cfg) {
  const G = cfg.v2_gauntlet, D = cfg.v2_dungeon;
  return { ...cfg, v2_dungeon: { ...D, hp_x: D.hp_x * (G.foe_x?.hp ?? 1), atk_x: D.atk_x * (G.foe_x?.atk ?? 1), growth: { ...D.growth, ...(G.growth || {}) },
    rest_heal: G.rest_heal ?? D.rest_heal, rest_revive: G.rest_revive ?? D.rest_revive, choice_heal: G.choice_heal ?? D.choice_heal, room_weights: { ...D.room_weights, ...(G.room_weights || {}) } } };
}
export function gauntletRun(cfg, weeklySpecs, player = {}, { seed = 1, policy = 'best' } = {}) {
  const G = cfg.v2_gauntlet;
  void player; // the player's stars, level and points never reach the Gauntlet squad
  const squad = buildSquad(cfg, weeklySpecs.map(s => ({ ...s, stars: G.stars, level: G.level, points: null })));
  return dungeonRun(gauntletCfg(cfg), squad, { seed, policy, floors: G.floors });
}
