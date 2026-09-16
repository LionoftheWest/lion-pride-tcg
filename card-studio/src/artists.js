/**
 * Artist credit per art slot (normal / illustrated_rare / secret_rare /
 * full_art). Each tier's art can have its own artist. Stored as
 * { [cardId]: { [slot]: "name" } } in art/_artists.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, '..', 'art', '_artists.json');

function readAll() {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  } catch {
    return {};
  }
}

/** The artist for one card's art slot, or ''. */
export function getArtist(id, slot) {
  return (readAll()[id] || {})[slot] || '';
}

/** All slot->artist entries for a card. */
export function artistsFor(id) {
  return readAll()[id] || {};
}

/** Set (or clear, if blank) the artist for a card's art slot. */
export function setArtist(id, slot, name) {
  const all = readAll();
  const value = (name || '').trim();
  all[id] = all[id] || {};
  if (value) all[id][slot] = value;
  else delete all[id][slot];
  if (Object.keys(all[id]).length === 0) delete all[id];
  writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
  return value;
}
