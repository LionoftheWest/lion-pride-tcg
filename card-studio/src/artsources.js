/**
 * "Pull art from another card" — a per-slot pointer to another card's art slot,
 * so a tier can reuse another card/tier's illustration instead of its own upload.
 * Stored as { [cardId]: { [slot]: { fromId, fromSlot } } } in art/_sources.json.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ART = join(here, '..', 'art');
const FILE = join(ART, '_sources.json');

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

// The art file of a card's slot (art/<id>-<slot>.*), or null. Moved unchanged from server.js, so the studio and
// scripts/push-set.mjs use one resolver (S2-PUB).
export const artFile = (id, slot) => {
  const f = readdirSync(ART).find((n) => n.startsWith(`${id}-${slot}.`));
  return f ? join(ART, f) : null;
};
// The art file for a slot, following a "pull from another card" source if set.
export const resolveArtFile = (id, slot) => {
  const src = getSource(id, slot);
  return src ? artFile(src.fromId, src.fromSlot) : artFile(id, slot);
};
