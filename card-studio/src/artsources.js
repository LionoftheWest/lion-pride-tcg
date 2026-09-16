/**
 * "Pull art from another card" — a per-slot pointer to another card's art slot,
 * so a tier can reuse another card/tier's illustration instead of its own upload.
 * Stored as { [cardId]: { [slot]: { fromId, fromSlot } } } in art/_sources.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, '..', 'art', '_sources.json');

function readAll() {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  } catch {
    return {};
  }
}

/** { fromId, fromSlot } for a card's slot, or null. */
export function getSource(id, slot) {
  return (readAll()[id] || {})[slot] || null;
}

/** Set (or clear, if fromId is blank) the art source for a card's slot. */
export function setSource(id, slot, fromId, fromSlot) {
  const all = readAll();
  all[id] = all[id] || {};
  if (fromId && fromSlot) all[id][slot] = { fromId, fromSlot };
  else delete all[id][slot];
  if (Object.keys(all[id]).length === 0) delete all[id];
  writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
  return all[id] ? all[id][slot] || null : null;
}
