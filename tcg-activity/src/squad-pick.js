// Auto-pick (Nathan, 2026-10-01): the squad with the HIGHEST TEAM CP the member can field today.
// The old pick sorted by a matchup score only, so it could pick cards that were knocked out
// today and more new cards than the daily limit allows: squads went in short.
// The value mirrors the engine (hunt_attack): card power (with stat points) x the weakness /
// resistance multiplier (the weakness bonus falls off after 3 weak cards) x the squad synergy
// (element, origin, trait), x 0.72 for a melee card on an armored boss. Pure: the server and
// the tests call it.

const ELEMENTS = ['fire', 'water', 'lightning', 'ice', 'nature', 'earth', 'air',
  'shadow', 'light', 'arcane', 'psychic', 'toxic', 'metal'];
const ELEMENT_SLUGS = new Set(ELEMENTS.map((e) => `trait:${e}`));
export const ATTACKERS = new Set(['Character', 'Creature']);

const has = (entry, c) => {
  if (entry.kind === 'tag') return c.slugs.includes(entry.value);
  if (entry.kind === 'type') return c.type === entry.value;
  if (entry.kind === 'rarity') return c.rarity === entry.value;
  if (entry.kind === 'season') return c.season === entry.value;
  return false;
};
const count = (entries, c) => (entries || []).reduce((n, e) => n + (has(e, c) ? 1 : 0), 0);
const elementOf = (c) => ELEMENTS.find((e) => c.slugs.includes(`trait:${e}`)) || null;
const originOf = (c) => c.slugs.find((t) => t.startsWith('origin:')) || null;
const kindsOf = (c) => c.slugs.filter((t) => t.startsWith('trait:') && !ELEMENT_SLUGS.has(t));

// The squad value: the sum of each attacker's expected damage factor (power x multipliers).
// `committed` = the cards already in today's fight (they count for the synergy and the weak stack).
export function teamValue(team, hunt, committed = []) {
  const all = [...new Map([...committed, ...team].map((c) => [c.id, c])).values()];
  const weakTags = (hunt.weak_points || []).filter((w) => w.kind === 'tag').map((w) => w.value);
  const stack = weakTags.length ? all.filter((c) => c.slugs.some((t) => weakTags.includes(t))).length : 0;
  const armored = (hunt.passives || []).includes('armored');
  let v = 0;
  for (const c of team) {
    if (!ATTACKERS.has(c.type)) continue;
    const wm = count(hunt.weak_points, c), rm = count(hunt.resist_points, c);
    let w = 1 + (1 - 0.5 ** wm) * (stack <= 3 ? 1 : 0.5 ** (stack - 3)) - 0.8 * (1 - 0.5 ** rm);
    w = Math.max(0.25, Math.min(2.5, w));
    const e = elementOf(c), o = originOf(c);
    const ne = e ? all.filter((x) => x.slugs.includes(`trait:${e}`)).length : 0;
    const no = o ? all.filter((x) => x.slugs.includes(o)).length : 0;
    const nk = Math.max(0, ...kindsOf(c).map((k) => all.filter((x) => x.slugs.includes(k)).length));
    const syn = Math.min(1.6, (ne >= 5 ? 1.2 : ne >= 3 ? 1.12 : 1) * (no >= 5 ? 1.18 : no >= 3 ? 1.1 : 1) * (nk >= 5 ? 1.14 : nk >= 3 ? 1.08 : 1));
    v += c.power * w * syn * (armored && c.slugs.includes('trait:melee') ? 0.72 : 1);
  }
  return v;
}

// Supports (Nathan, 2026-10-01: "supports are integral to battles"). A support's strength is
// its effect amount x its Potency points x the affinity bonus (+15% for each committed card with
// its affinity tag, up to x2, hunt_support). One support that keeps the squad alive (heal, shield,
// weaken) and one that adds damage beats two of one kind: a repeat effect counts half.
export const SUPPORT_SLOTS = 2;
const SUSTAIN = new Set(['heal', 'shield', 'weaken']);
const EFFECT_WEIGHT = { cleanse: 0.6 }; // cleanse only helps against a debuff; the rest 1
export function supportValue(sups, committed) {
  const one = (x) => {
    const n = x.affinity ? committed.filter((c) => c.slugs.includes(x.affinity)).length : 0;
    return (EFFECT_WEIGHT[x.effect] ?? 1) * (x.potency || 1) * Math.min(2, 1 + 0.15 * n);
  };
  const seen = [];
  let v = 0;
  for (const x of [...sups].sort((a, b) => one(b) - one(a))) {
    let w = one(x);
    if (seen.includes(x.effect)) w *= 0.5;
    else if (seen.some((e) => SUSTAIN.has(e) === SUSTAIN.has(x.effect))) w *= 0.85;
    seen.push(x.effect); v += w;
  }
  return v;
}

// cards: [{ id, type, rarity, season, slugs, power, downed, used, effect, affinity, potency }]
// (used = it fought today). Returns the card ids, attackers (strongest first) then supports.
// A downed card never goes in. A card that fought today and still stands is free; a new card
// needs a free daily slot (cap - cards used today). The squad: 2 supports (the best pair for
// this squad) + the attackers with the highest team CP; supports fill more slots only when the
// attackers run out.
export function bestSquad(cards, hunt, { cap = 8 } = {}) {
  const usedToday = cards.filter((c) => c.used);
  const newSlots = Math.max(0, cap - usedToday.length);
  const pool = cards.filter((c) => !c.downed);
  const atk = pool.filter((c) => ATTACKERS.has(c.type));
  const sup = pool.filter((c) => !ATTACKERS.has(c.type));
  const room = openSlots(cards, [], { cap });
  const team = [], sups = [];
  const all = () => [...team, ...sups];
  const fresh = () => all().filter((c) => !c.used).length;
  const fits = (c, out = null) => (!c.used ? fresh() - (out && !out.used ? 1 : 0) < newSlots : true);
  const val = (t) => teamValue(t, hunt, [...usedToday, ...sups]);
  const want = Math.min(SUPPORT_SLOTS, sup.length);
  // New daily slots kept for the supports while they are not picked yet (a support that
  // already fought today and stands needs none).
  const keep = () => (sups.length ? 0 : Math.max(0, want - sup.filter((c) => c.used).length));
  const fitsAtk = (c, out = null) => (!c.used ? fresh() - (out && !out.used ? 1 : 0) + keep() < newSlots : true);

  const addAttackers = (limit) => {
    while (team.length < limit && all().length < cap) {
      const base = val(team);
      let best = null, gain = -Infinity;
      for (const c of atk) {
        if (team.includes(c) || !fitsAtk(c)) continue;
        const g = val([...team, c]) - base;
        if (g > gain) { gain = g; best = c; }
      }
      if (!best) break;
      team.push(best);
    }
  };
  // Swaps: replace an attacker with one outside while the value rises (synergy can make two
  // weaker cards of one element beat one strong card).
  const swapAttackers = () => {
    for (let pass = 0; pass < 20; pass++) {
      let improved = false;
      for (let i = 0; i < team.length; i++) {
        const base = val(team);
        let best = null, gain = 1e-9;
        for (const c of atk) {
          if (team.includes(c) || !fitsAtk(c, team[i])) continue;
          const t = team.slice(); t[i] = c;
          const g = val(t) - base;
          if (g > gain) { gain = g; best = c; }
        }
        if (best) { team[i] = best; improved = true; }
      }
      if (!improved) break;
    }
  };
  // The supports with the highest support value for this squad (every pair is tried).
  const pickSupports = (k) => {
    sups.length = 0;
    const ok = sup.filter((c) => fits(c));
    let best = [], bestV = -1;
    const tryset = (set) => {
      const freshN = set.filter((c) => !c.used).length + team.filter((c) => !c.used).length;
      if (freshN > newSlots) return;
      const v = supportValue(set, [...usedToday, ...team, ...set]);
      if (v > bestV + 1e-9) { bestV = v; best = set; }
    };
    if (k >= 2) { for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) tryset([ok[i], ok[j]]); }
    if (!best.length && k >= 1) ok.forEach((c) => tryset([c]));
    sups.push(...best);
  };

  addAttackers(Math.max(0, room - want));      // 1. attackers, leaving the support slots
  pickSupports(Math.min(want, room - team.length)); // 2. the best supports for these attackers
  swapAttackers();                             // 3. attackers again, with the support synergy
  pickSupports(sups.length);                   //    and the supports again for the final squad
  addAttackers(cap);                           // 4. a slot left (fewer supports): an attacker
  for (const c of [...sup].sort((a, b) => supportValue([b], all()) - supportValue([a], all()))) { // 5. too few attackers
    if (all().length >= cap) break;
    if (!sups.includes(c) && fits(c)) sups.push(c);
  }
  const own = (c) => teamValue([c], hunt, [...usedToday, ...all()]);
  return [...team.sort((a, b) => own(b) - own(a)), ...sups].map((c) => c.id);
}

// A squad needs at least 1 attacker (Nathan, 2026-10-03): supports alone deal no damage, so the
// member would get no raid prize. lock_hunt_squad refuses it too ('no_attacker').
export function hasAttacker(cards, selectedIds) {
  const sel = new Set(selectedIds);
  return cards.some((c) => sel.has(c.id) && ATTACKERS.has(c.type));
}

// How many more cards the member could still add to `selected` today (the lock-in warning).
export function openSlots(cards, selectedIds, { cap = 8 } = {}) {
  const sel = new Set(selectedIds);
  const used = cards.filter((c) => c.used).length;
  const freshIn = cards.filter((c) => sel.has(c.id) && !c.used).length;
  const room = cap - sel.size;
  if (room <= 0) return 0;
  const freeOld = cards.filter((c) => c.used && !c.downed && !sel.has(c.id)).length;
  const freshLeft = Math.max(0, cap - used - freshIn);
  const freshAvail = cards.filter((c) => !c.used && !c.downed && !sel.has(c.id)).length;
  return Math.min(room, freeOld + Math.min(freshLeft, freshAvail));
}

// Is the squad down? (Nathan, 2026-10-02: "halfway through my squad, when one of my cards got
// knocked out, it said my squad was wiped out completely". The old check looked only at the
// cards that had FOUGHT: the first card downed before the others attacked was 1 of 1 down.)
// One squad of 8 a day (attackers + supports), locked in (hunt_squads on the server). The squad is
// down when every ATTACKER of it is down: the boss acts only after an attack, so once the attackers
// are down nothing can hit the supports or move the rounds their cooldowns wait on (2026-10-02: an
// every-card rule could never end a squad). A card of the squad that has not fought yet is alive.
// Without a locked squad (a member who fought before hunt_squads.sql), the cards that fought count.
export function squadDown(cards, selIds) {
  const sel = new Set((selIds || []).map(Number));
  const squad = cards.filter((c) => ATTACKERS.has(c.type) && (sel.has(Number(c.id)) || c.used));
  return squad.length > 0 && squad.every((c) => c.downed);
}
