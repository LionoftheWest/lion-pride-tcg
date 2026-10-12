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

// The PVE type of a card (subjects.type, NOT NULL since card_decisions.sql). card.type wins; a card made in
// the portal has only tags.type (lower case, set by Card Info), so that one counts too. Anything else = null.
export const CARD_TYPES = ['Character', 'Creature', 'Item', 'Place', 'Moment'];
export function subjectType(card) {
  for (const v of [card?.type, card?.tags?.type]) {
    const t = CARD_TYPES.find((x) => x.toLowerCase() === String(v ?? '').trim().toLowerCase());
    if (t) return t;
  }
  return null;
}

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

/** A set id as card_sets.id allows it (1 to 8 capitals or digits). */
export const isSetId = (v) => typeof v === 'string' && /^[A-Z0-9]{1,8}$/.test(v);

/**
 * The HOME set of a card (tcg-bot/supabase/card_sets.sql, F-2): cards.json `set`, for example "S2", REQUIRED.
 * There is no default (F-2 PR 3): a card with no set never lands in S1 by accident. One home set for every
 * tier of the card; push.js writes it to cards.set_id and the database gives the number in the set.
 * Other sets add the card to their pull pool (set_pool), not here. A missing or bad id stops the push.
 */
export function cardSetId(card) {
  const id = card?.set;
  if (id == null || id === '') throw new Error(`"${card?.name ?? card?.id}" has no set. Choose its set on the card page (Sets), then push again.`);
  if (!isSetId(id)) throw new Error(`card ${card?.id}: bad set id ${JSON.stringify(id)} (for example "S1")`);
  return id;
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
