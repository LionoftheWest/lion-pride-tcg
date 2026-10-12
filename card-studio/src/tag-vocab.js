/**
 * The tag library of the card editor (F-2 item 7, Nathan 2026-10-11: "drop down menus for things to select already in the
 * library ... and the ability to add a new tag/genre/etc. rather than typing it in").
 *
 * The vocabulary is DATA: card-studio/tag-vocab.json, next to cards.json (the studio's source of truth for the card
 * design data). It was seeded from scripts/taxonomy.mjs (the 13 elements, the core kinds, the games) and the values
 * that cards.json uses. "+ Add new" in the editor writes to it (POST /api/tag-vocab). The combat reads the tags of
 * each card (subjects.tags -> subjects.tag_slugs), not this list; the element list of the combat stays the SQL
 * element_aliases() (F-3 moves it to an elements table).
 *
 * Facets: origin, genre, realm, traits (slugs, several per card) and subject (the subject line of a tier, display
 * text, one per tier). class and type are fixed lists (subjects.type allows 5 types), so they stay plain selects.
 * A new value is checked first: the same value after normalizing (case, accents, spaces, - and _) is the existing
 * one; a near duplicate (also plural -s / -es, no hyphen, an element alias such as flame = fire) is refused with the
 * existing value as the suggestion. So the library never splits into "nature" and "Nature " or "natures".
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const VOCAB_FILE = join(here, '..', 'tag-vocab.json');

/** The exact key: no accents, lower case, words joined by "-", only a-z 0-9 and "-". "Pokémon  Unite" -> "pokemon-unite". */
export const normKey = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  .replace(/[\s_-]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');

/** A near duplicate: the same exact key with no "-", or one is the other plus a plural "s" or "es" ("natures", "boxes"). */
export const nearSame = (a, b) => {
  const x = normKey(a).replace(/-/g, ''), y = normKey(b).replace(/-/g, '');
  return Boolean(x && y) && (x === y || x + 's' === y || y + 's' === x || x + 'es' === y || y + 'es' === x);
};

/** A display label: trimmed, single spaces. */
export const cleanLabel = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function loadVocab(file = VOCAB_FILE) {
  if (!existsSync(file)) throw new Error(`the tag library ${file} is missing`);
  return JSON.parse(readFileSync(file, 'utf8'));
}
export function saveVocab(vocab, file = VOCAB_FILE) {
  writeFileSync(file, `${JSON.stringify(vocab, null, 2)}\n`, 'utf8');
}

// The value of one card for a facet, as a list.
function cardValues(card, facet) {
  if (facet === 'subject') return [card.genre, ...Object.values(card.tierDetails || {}).map((d) => d && d.genre)].map(cleanLabel).filter(Boolean);
  const v = card.tags ? card.tags[facet] : null;
  return (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
}
const keyOf = (facet, v) => (facet === 'subject' ? normKey(v) : normKey(v));

/**
 * The library for the pickers: each facet with its values (the library, then any value that cards use but the
 * library does not have) and how many cards use each one. A used value that is a near duplicate of a library value
 * says so (near), so the editor can show the split.
 */
export function vocabView(vocab, cards) {
  const out = {};
  for (const [facet, def] of Object.entries(vocab.facets)) {
    const text = def.kind === 'text';
    const counts = new Map(); // exact key -> { value, cards }
    for (const c of cards) {
      const seen = new Set();
      for (const v of cardValues(c, facet)) {
        const k = keyOf(facet, v);
        if (seen.has(k)) continue;
        seen.add(k);
        const e = counts.get(k) || { value: text ? v : v, cards: 0 };
        e.cards += 1;
        counts.set(k, e);
      }
    }
    const values = def.values.map((x) => {
      const value = text ? x.label : x.slug;
      return { value, label: x.label || x.slug, group: x.group || null, cards: counts.get(keyOf(facet, value))?.cards || 0, library: true };
    });
    const libKeys = new Map(values.map((x) => [keyOf(facet, x.value), x.value]));
    for (const [k, e] of counts) {
      if (libKeys.has(k)) continue;
      values.push({ value: e.value, label: e.value, group: null, cards: e.cards, library: false, near: values.find((x) => x.library && nearSame(x.value, e.value))?.value || aliasOf(def, e.value) || null });
    }
    out[facet] = { label: def.label, multi: def.multi !== false, kind: def.kind || 'slug', note: def.note || '', values };
  }
  return out;
}

// An element alias (traits: flame -> fire), from the facet's aliases.
function aliasOf(def, raw) {
  const a = def.aliases && def.aliases[normKey(raw)];
  return a && a !== normKey(raw) ? a : null;
}

/**
 * Add a value to a facet. Returns { ok, value, existed } or { ok: false, error, suggest }.
 * The vocab object changes in place; the caller saves it.
 */
export function addValue(vocab, facet, raw) {
  const def = vocab.facets[facet];
  if (!def) return { ok: false, error: `no facet ${facet}` };
  const text = def.kind === 'text';
  const value = text ? cleanLabel(raw) : normKey(raw);
  if (!value || value.length > 40) return { ok: false, error: 'a value is 1 to 40 letters or digits' };
  const list = def.values.map((x) => (text ? x.label : x.slug));
  const same = list.find((x) => normKey(x) === normKey(value));
  if (same) return { ok: true, value: same, existed: true };
  const near = list.find((x) => nearSame(x, value)) || aliasOf(def, value);
  if (near) return { ok: false, error: `"${cleanLabel(raw)}" is too close to "${near}", which the library has. Use "${near}".`, suggest: near };
  def.values.push(text ? { label: value } : { slug: value });
  return { ok: true, value, existed: false };
}
