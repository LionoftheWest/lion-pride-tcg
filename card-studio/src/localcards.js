/**
 * Cards created in the portal (not from the Google Sheet). Kept in
 * cards.local.json so a sheet sync never overwrites them. Same shape as a sheet
 * card: { id, name, genre, lore, finishes }.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, '..', 'cards.local.json');

export function getLocalCards() {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : [];
  } catch {
    return [];
  }
}

function save(cards) {
  writeFileSync(FILE, JSON.stringify(cards, null, 2), 'utf8');
}

export function addLocalCard(card) {
  const cards = getLocalCards();
  cards.push(card);
  save(cards);
  return card;
}

/** Add or replace a local card by id (used to edit sheet or portal cards). */
export function upsertLocalCard(card) {
  const cards = getLocalCards().filter((c) => c.id !== card.id);
  cards.push(card);
  save(cards);
  return card;
}

export function deleteLocalCard(id) {
  const cards = getLocalCards();
  const next = cards.filter((c) => c.id !== id);
  if (next.length === cards.length) return false;
  save(next);
  return true;
}
