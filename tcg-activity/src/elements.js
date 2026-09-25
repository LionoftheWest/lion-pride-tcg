/**
 * The element visual table — the ONE place a card's element and its battle look
 * live on the client. Read by the hunt combat animations (main.js) and the card
 * viewer. Keep the element keys in sync with card-studio/scripts/taxonomy.mjs.
 *
 * A card's element = the first ELEMENT_ORDER key present in its traits (aliases
 * resolved). No element trait => null ("physical"), which keeps the rarity color.
 */

// Element key -> look. color = the bolt/aura core, color2 = the trail/secondary,
// glyph = the emoji shown on the bolt + scattered on impact.
export const ELEMENTS = {
  fire:      { name: 'Fire',      color: '#ff6a3c', color2: '#ffd23e', glyph: '🔥' },
  water:     { name: 'Water',     color: '#3fb0ff', color2: '#8fe0ff', glyph: '💧' },
  lightning: { name: 'Lightning', color: '#ffe23e', color2: '#fff6a0', glyph: '⚡' },
  ice:       { name: 'Ice',       color: '#7fe0ff', color2: '#dffbff', glyph: '❄' },
  nature:    { name: 'Nature',    color: '#5ddb7a', color2: '#c8ff9a', glyph: '🌿' },
  earth:     { name: 'Earth',     color: '#c79a5a', color2: '#efd39a', glyph: '⛰' },
  air:       { name: 'Air',       color: '#bfeaff', color2: '#ffffff', glyph: '🌪' },
  shadow:    { name: 'Shadow',    color: '#9a5cff', color2: '#c9a6ff', glyph: '🌑' },
  light:     { name: 'Light',     color: '#ffe27a', color2: '#ffffff', glyph: '✨' },
  arcane:    { name: 'Arcane',    color: '#e06aff', color2: '#ffc0ff', glyph: '🔮' },
  psychic:   { name: 'Psychic',   color: '#ff6ad0', color2: '#ffd0ef', glyph: '🌀' },
  toxic:     { name: 'Toxic',     color: '#9cd93c', color2: '#e0ff9a', glyph: '☣' },
  metal:     { name: 'Metal',     color: '#a8bccf', color2: '#e6f0fa', glyph: '⚙' },
};

// Priority order — earlier wins when a card carries several element traits.
export const ELEMENT_ORDER = [
  'fire', 'water', 'lightning', 'ice', 'nature', 'earth', 'air',
  'shadow', 'light', 'arcane', 'psychic', 'toxic', 'metal',
];

// Raw trait slug -> canonical element (aliases resolve to a palette element).
const ELEMENT_ALIAS = {
  fire: 'fire', flame: 'fire', burning: 'fire',
  water: 'water', aqua: 'water', ocean: 'water',
  lightning: 'lightning', electric: 'lightning', thunder: 'lightning',
  ice: 'ice', frost: 'ice', frozen: 'ice',
  nature: 'nature', grass: 'nature', plant: 'nature', wood: 'nature',
  earth: 'earth', rock: 'earth', stone: 'earth', ground: 'earth',
  air: 'air', wind: 'air', flying: 'air',
  shadow: 'shadow', dark: 'shadow', ghost: 'shadow',
  light: 'light', holy: 'light', radiant: 'light',
  arcane: 'arcane', magic: 'arcane', fairy: 'arcane', mystic: 'arcane',
  psychic: 'psychic', psi: 'psychic',
  toxic: 'toxic', poison: 'toxic', venom: 'toxic',
  metal: 'metal', robot: 'metal', mechanical: 'metal', tech: 'metal', steel: 'metal',
};

// A card's tags object (or a bare traits[]) -> the dominant element key, or null.
export function cardElement(tags) {
  const traits = Array.isArray(tags) ? tags : (tags && tags.traits) || [];
  const present = new Set();
  for (const t of traits) { const e = ELEMENT_ALIAS[String(t).toLowerCase()]; if (e) present.add(e); }
  for (const e of ELEMENT_ORDER) if (present.has(e)) return e;
  return null;
}

// The look for an element key (with a physical fallback caller can override).
export function elementLook(key) {
  return ELEMENTS[key] || null;
}
