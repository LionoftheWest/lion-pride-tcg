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

// cards: [{ id, type, rarity, season, slugs, power, downed, used }] (used = it fought today).
// Returns the card ids, the strongest first. A downed card never goes in. A card that fought
// today and still stands is free; a new card needs a free daily slot (cap - cards used today).
export function bestSquad(cards, hunt, { cap = 8 } = {}) {
  const usedToday = cards.filter((c) => c.used);
  const newSlots = Math.max(0, cap - usedToday.length);
  const pool = cards.filter((c) => !c.downed);
  const atk = pool.filter((c) => ATTACKERS.has(c.type));
  const team = [];
  const fresh = () => team.filter((c) => !c.used).length;
  const fits = (c, out = null) => !c.used ? fresh() - (out && !out.used ? 1 : 0) < newSlots : true;
  const val = (t) => teamValue(t, hunt, usedToday);

  // 1. Greedy: add the attacker that raises the value most, until the squad is full.
  while (team.length < cap) {
    const base = val(team);
    let best = null, gain = -Infinity;
    for (const c of atk) {
      if (team.includes(c) || !fits(c)) continue;
      const g = val([...team, c]) - base;
      if (g > gain) { gain = g; best = c; }
    }
    if (!best) break;
    team.push(best);
  }
  // 2. Swaps: replace a member with a card outside while the value rises (synergy can make
  //    two weaker cards of one element beat one strong card).
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let i = 0; i < team.length; i++) {
      const base = val(team);
      let best = null, gain = 1e-9;
      for (const c of atk) {
        if (team.includes(c) || !fits(c, team[i])) continue;
        const t = team.slice(); t[i] = c;
        const g = val(t) - base;
        if (g > gain) { gain = g; best = c; }
      }
      if (best) { team[i] = best; improved = true; }
    }
    if (!improved) break;
  }
  // 3. Too few attackers: the support cards fill the rest (strongest first).
  const sup = pool.filter((c) => !ATTACKERS.has(c.type)).sort((a, b) => b.power - a.power);
  for (const c of sup) { if (team.length >= cap) break; if (fits(c)) team.push(c); }

  const own = (c) => teamValue([c], hunt, [...usedToday, ...team]);
  return team.sort((a, b) => own(b) - own(a)).map((c) => c.id);
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
