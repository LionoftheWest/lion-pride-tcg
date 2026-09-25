/**
 * The canonical tag vocabulary for the Lion Pride TCG card/battle engine.
 *
 * A card's tags are FACETED:
 *   class   attacker | support            (derived from type; attackers = Character/Creature)
 *   type    character|creature|item|place|moment
 *   origin  the franchise slug            (smash, pokemon, minecraft, party, meme, community)
 *   genre   broad genre bag              (fighting, moba, sandbox, survival, party, meme, ...)
 *   realm   setting bag                 (crossover, pokemon-world, blocky, real-world, ...)
 *   traits  the free bag of ELEMENTS + KINDS — this is what combat reads.
 *
 * ELEMENTS drive the battle animation + elemental synergy. A card has ONE dominant
 * element = the first ELEMENT_ORDER entry present in its traits (aliases resolved).
 * A card with no element trait is "physical" (its attack keeps the rarity color).
 *
 * KINDS drive kind-synergy + boss passives (armored, beast, robot, royal, ...).
 *
 * Keep the element list in sync with tcg-activity/src/elements.js (the client twin).
 */

// Element key -> display glyph. Priority order is the array order below.
export const ELEMENTS = {
  fire:      '🔥',
  water:     '💧',
  lightning: '⚡',
  ice:       '❄',
  nature:    '🌿',
  earth:     '⛰',
  air:       '🌪',
  shadow:    '🌑',
  light:     '✨',
  arcane:    '🔮',
  psychic:   '🌀',
  toxic:     '☣',
  metal:     '⚙',
};
export const ELEMENT_ORDER = Object.keys(ELEMENTS);

// Raw trait slug -> canonical element. Lets human-friendly traits still resolve.
export const ELEMENT_ALIAS = {
  fire: 'fire', flame: 'fire', burning: 'fire',
  water: 'water', aqua: 'water', ocean: 'water',
  lightning: 'lightning', electric: 'lightning', thunder: 'lightning',
  ice: 'ice', frost: 'ice', frozen: 'ice',
  nature: 'nature', grass: 'nature', plant: 'nature', wood: 'nature',
  earth: 'earth', rock: 'earth', stone: 'earth', ground: 'earth',
  air: 'air', wind: 'air', flying: 'air',
  shadow: 'shadow', dark: 'shadow', spirit: 'shadow', ghost: 'shadow',
  light: 'light', holy: 'light', radiant: 'light',
  arcane: 'arcane', magic: 'arcane', fairy: 'arcane', mystic: 'arcane',
  psychic: 'psychic', psi: 'psychic',
  toxic: 'toxic', poison: 'toxic', venom: 'toxic',
  metal: 'metal', robot: 'metal', mechanical: 'metal', tech: 'metal', steel: 'metal',
};

// The lean CORE kind vocabulary (locked). Every card draws from this closed set,
// so kinds are reused, never unique. Not required per card, but a trait outside
// this set (and outside the element list) is flagged in the by-hand pass.
export const KINDS = new Set([
  // body (8)
  'humanoid', 'beast', 'bird', 'monster', 'robot', 'spirit', 'object', 'location',
  // combat style (7)
  'melee', 'ranged', 'caster', 'armored', 'strong', 'agile', 'stealth',
  // role / flavor (6)
  'royal', 'hero', 'legendary', 'cute', 'support', 'community',
]);

// The Game facet (origin) — the franchise tag. slug -> display label.
export const GAMES = {
  smash: 'Super Smash Bros',
  pokemon: 'Pokemon',
  minecraft: 'Minecraft',
  party: 'Party Games',
  meme: 'Memes',
  community: 'Community',
};

export const ATTACKER_TYPES = new Set(['Character', 'Creature']);

// A traits[] bag -> the dominant element key, or null (physical).
export function dominantElement(traits) {
  const present = new Set();
  for (const t of traits || []) {
    const e = ELEMENT_ALIAS[String(t).toLowerCase()];
    if (e) present.add(e);
  }
  for (const e of ELEMENT_ORDER) if (present.has(e)) return e;
  return null;
}

// Warn (do not block) on any trait that is neither a known element alias nor a kind.
export function unknownTraits(traits) {
  return (traits || []).filter((t) => {
    const s = String(t).toLowerCase();
    return !ELEMENT_ALIAS[s] && !KINDS.has(s);
  });
}
