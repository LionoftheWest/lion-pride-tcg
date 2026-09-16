import type { Rarity } from './draw.js';

/** Human-readable rarity names for embeds and messages. */
export const RARITY_LABEL: Record<Rarity, string> = {
  normal: 'Normal',
  illustrated_rare: 'Illustrated Rare',
  secret_rare: 'Secret Rare',
  full_art: 'Full Art',
  gold: 'Gold',
};

/** Embed accent color per rarity. */
export const RARITY_COLOR: Record<Rarity, number> = {
  normal: 0x9ca3af,
  illustrated_rare: 0x3b82f6,
  secret_rare: 0x8b5cf6,
  full_art: 0xec4899,
  gold: 0xf59e0b,
};

/** A small marker for compact card lists. */
export const RARITY_EMOJI: Record<Rarity, string> = {
  normal: '⚪',
  illustrated_rare: '🔵',
  secret_rare: '🟣',
  full_art: '🌸',
  gold: '🟡',
};

/** A fixed display order, rarest last. */
export const RARITY_ORDER: Rarity[] = [
  'normal',
  'illustrated_rare',
  'secret_rare',
  'full_art',
  'gold',
];
