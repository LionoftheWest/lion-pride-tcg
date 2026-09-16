/**
 * The card store — the SOURCE OF TRUTH for cards (cards.json). Each card has a
 * STABLE id that never changes, so renaming a card updates its name in place
 * without orphaning its art, framing, or live database rows. Every card is
 * created and edited in the Card Portal (no external sheet).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, '..', 'cards.json');

export function getCards() {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
  } catch {
    return [];
  }
}

function save(cards) {
  writeFileSync(FILE, JSON.stringify(cards, null, 2), 'utf8');
}

export function getCard(id) {
  return getCards().find((c) => c.id === id) || null;
}

/**
 * The subject / description / season / event for ONE tier of a card. Each tier
 * has its own (stored in card.tierDetails[slot]); a tier with no override falls
 * back to the card-level value, so existing cards keep their text until a tier
 * is edited.
 */
export function slotDetails(card, slot) {
  const d = (card && card.tierDetails && card.tierDetails[slot]) || {};
  // Gold never trades (a hard rule in trades.sql). Every other tier defaults to
  // tradeable, and can be locked per tier. Fall back to the old card-level flag
  // so cards edited before per-tier tradeability keep their setting.
  const tradeable = slot === 'gold'
    ? false
    : (d.tradeable ?? card.tradeable ?? true) !== false;
  return {
    genre: d.genre ?? card.genre ?? '',
    lore: d.lore ?? card.lore ?? '',
    season: d.season ?? card.season ?? 'Season 1',
    event: d.event ?? card.event ?? '',
    tradeable,
  };
}

/** Set (merge) the per-tier details for one slot. Returns the updated card. */
export function setSlotDetails(id, slot, patch) {
  const card = getCard(id);
  if (!card) return null;
  const tierDetails = { ...(card.tierDetails || {}) };
  tierDetails[slot] = { ...(tierDetails[slot] || {}), ...patch };
  return updateCard(id, { tierDetails });
}

export function addCard(card) {
  const cards = getCards();
  cards.push(card);
  save(cards);
  return card;
}

/** Update a card in place. The id is immutable — a rename only changes `name`. */
export function updateCard(id, patch) {
  const cards = getCards();
  const i = cards.findIndex((c) => c.id === id);
  if (i < 0) return null;
  cards[i] = { ...cards[i], ...patch, id };
  save(cards);
  return cards[i];
}

export function deleteCard(id) {
  const cards = getCards();
  const next = cards.filter((c) => c.id !== id);
  if (next.length === cards.length) return false;
  save(next);
  return true;
}
