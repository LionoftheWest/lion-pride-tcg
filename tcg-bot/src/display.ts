import type { Rarity } from './draw.js';

/** Every card rarity in the database: the 5 pack rarities + Promo and Event (never in a pack).
 *  The tables below cover all 7: an Event card showed "undefined" and /card failed (2026-10-01). */
export type CardRarity = Rarity | 'promo' | 'event';

/** Human-readable rarity names for embeds and messages. */
export const RARITY_LABEL: Record<CardRarity, string> = {
  normal: 'Normal',
  illustrated_rare: 'Illustrated Rare',
  secret_rare: 'Secret Rare',
  full_art: 'Full Art',
  gold: 'Gold',
  promo: 'Promo',
  event: 'Event',
};

/** Embed accent color per rarity. */
export const RARITY_COLOR: Record<CardRarity, number> = {
  normal: 0x9ca3af,
  illustrated_rare: 0x3b82f6,
  secret_rare: 0x8b5cf6,
  full_art: 0xec4899,
  gold: 0xf59e0b,
  promo: 0xc9ced8,
  event: 0x10b981,
};

/** A small marker for compact card lists. */
export const RARITY_EMOJI: Record<CardRarity, string> = {
  normal: '⚪',
  illustrated_rare: '🔵',
  secret_rare: '🟣',
  full_art: '🌸',
  gold: '🟡',
  promo: '⚪',
  event: '🟢',
};

/** A fixed display order, rarest last. */
export const RARITY_ORDER: Rarity[] = [
  'normal',
  'illustrated_rare',
  'secret_rare',
  'full_art',
  'gold',
];
