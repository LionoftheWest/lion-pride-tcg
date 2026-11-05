// UI-68: the combat v2 face data of a card, read from the target database at render time (the push and the studio
// "Render real look" use the same path: src/push.js renderTier).
//   role, ability    subjects.ability_v2 (key = card.id)
//   active text      ability_v2_check(role, {name, blocks, silver}) -> text        (the one SQL text generator)
//   Silver line      ability_v2_check(...) -> silver_text                          (the bonus only, Nathan 2026-10-20)
//   Makes / Uses     ability_v2_check(...) -> enables + the boon blocks / pays    (no "Cures" chip, Nathan 2026-10-20)
//   element          card_element(tags.traits)
// Returns card.v2 = { role, element, active: {name, text}, silver, makes, uses } for src/face-v2.js, or null (no v2 data:
// the face renders exactly as before UI-68).
//
// FACE_V2=0        never look up (the face renders as before UI-68).
// FACE_V2_FILE     a JSON file { rows: [{ key, role, ability: {name, blocks, silver} }] } (the shape of the approved actives
//                  file, for example set2-act73.approved.json). It gives role + ability for a card whose subject has no
//                  ability_v2 yet (S2-PUB pushes the new cards before it writes their actives). When the subject has an
//                  ability_v2 too and the two differ, the render stops: a face never shows text the game does not use.
import { readFileSync } from 'node:fs';

// The boon blocks: they give a boon status, but they are not "apply" blocks, so ability_v2_check does not list them in enables.
export const BOON_BLOCKS = { shield: 'shielded', shield_all: 'shielded', guard_up: 'shielded', quicken: 'quickened', empower: 'empowered', focus: 'focused' };
// The verb of a boon in the card text (the statuses table has no verb for a boon).
const BOON_VERB = { shielded: 'Shield', quickened: 'Quicken', empowered: 'Empower', focused: 'Focus' };

/** The status keys that the blocks of an ability name (status, statuses, per, options[].status) and the boons that it gives. */
export function blockStatuses(blocks) {
  const out = new Set();
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (typeof b?.status === 'string') out.add(b.status);
    if (Array.isArray(b?.statuses)) for (const s of b.statuses) if (typeof s === 'string') out.add(s);
    if (typeof b?.per === 'string') out.add(b.per);
    if (Array.isArray(b?.options)) for (const o of b.options) if (typeof o?.status === 'string') out.add(o.status);
    if (BOON_BLOCKS[b?.k]) out.add(BOON_BLOCKS[b.k]);
  }
  return out;
}

/** Makes = the statuses the ability applies (SQL enables) + the boons of its boon blocks, in block order, no duplicates. */
export function makesOf(blocks, enables) {
  const set = new Set(enables || []);
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    const ks = [];
    if (['apply', 'on_crit', 'on_kill'].includes(b?.k) && typeof b.status === 'string') ks.push(b.status);
    if (b?.k === 'random_apply' && Array.isArray(b.options)) for (const o of b.options) if (o?.status) ks.push(o.status);
    if (BOON_BLOCKS[b?.k]) ks.push(BOON_BLOCKS[b.k]);
    for (const k of ks) if ((set.has(k) || BOON_BLOCKS[b.k] === k) && !out.includes(k)) out.push(k);
  }
  for (const k of set) if (!out.includes(k)) out.push(k); // an enables key that no block order gave (never expected)
  return out;
}

/** Uses = SQL pays, in block order. */
export function usesOf(blocks, pays) {
  const set = new Set(pays || []);
  const out = [];
  for (const k of blockStatuses(blocks)) if (set.has(k) && !out.includes(k)) out.push(k);
  for (const k of set) if (!out.includes(k)) out.push(k);
  return out;
}

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mark the status words of a card text as "{key:Word}" (src/face-v2.js richText draws the UI-67 icon + the word).
 * Only the statuses that the card's blocks name are marked, and only their capitalized words (the style guide writes every
 * status word with a capital): the label, the adjective, the first word of the verb, the boon verb, each with an optional "s".
 * statuses: rows of the statuses table { key, label, adj, verb }.
 */
export function markStatuses(text, keys, statuses) {
  if (!text) return text;
  const words = []; // [word, key], the longest first so "Poisoned" wins over "Poison"
  for (const key of keys) {
    const s = statuses.find((r) => r.key === key);
    const cand = new Set([s?.label, s?.adj, s?.verb ? String(s.verb).split(' ')[0] : null, BOON_VERB[key]].filter((w) => w && /^[A-Z]/.test(w)));
    for (const w of cand) words.push([w, key]);
  }
  if (!words.length) return text;
  words.sort((a, b) => b[0].length - a[0].length);
  const re = new RegExp(`\\b(${words.map(([w]) => reEsc(w)).join('|')})(s?)\\b`, 'g');
  return text.replace(re, (m, w, s) => `{${words.find(([x]) => x === w)[1]}:${w}${s}}`);
}

let statusCache = null;
async function statusRows(db) {
  if (statusCache) return statusCache;
  const { data, error } = await db.from('statuses').select('key, label, adj, verb');
  if (error) throw new Error(`face v2: statuses: ${error.message}`);
  statusCache = data || [];
  return statusCache;
}

let fileCache = null;
/** role + ability of a card from FACE_V2_FILE, or null. */
export function fileAbility(key, path = process.env.FACE_V2_FILE) {
  if (!path) return null;
  if (!fileCache || fileCache.path !== path) {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    const rows = Array.isArray(j) ? j : j.rows;
    if (!Array.isArray(rows)) throw new Error(`face v2: ${path} has no rows`);
    fileCache = { path, map: new Map(rows.map((r) => [r.key, { role: r.role, ability: r.ability }])) };
  }
  return fileCache.map.get(key) || null;
}

const sameAbility = (a, b) => JSON.stringify({ r: a.role, n: a.ability?.name, b: a.ability?.blocks, s: a.ability?.silver ?? null })
  === JSON.stringify({ r: b.role, n: b.ability?.name, b: b.ability?.blocks, s: b.ability?.silver ?? null });

/**
 * The v2 face data of a card from the database `db` (a supabase client), or null when the card has no v2 ability.
 * Throws when the database cannot answer or the ability is not valid: a push stops before it uploads a wrong face.
 */
export async function loadFaceV2(db, card) {
  if (process.env.FACE_V2 === '0') return null;
  const { data: subj, error } = await db.from('subjects').select('ability_v2, tags').eq('key', card.id).maybeSingle();
  if (error) throw new Error(`face v2 ${card.id}: subjects: ${error.message}`);
  const dbv = subj?.ability_v2 ? { role: subj.ability_v2.role, ability: { name: subj.ability_v2.name, blocks: subj.ability_v2.blocks, silver: subj.ability_v2.silver } } : null;
  const fv = fileAbility(card.id);
  if (dbv && fv && !sameAbility(dbv, fv)) {
    throw new Error(`face v2 ${card.id}: subjects.ability_v2 and FACE_V2_FILE differ (role, name, blocks or silver). Fix one of them before the render.`);
  }
  const src = dbv || fv;
  if (!src) return null;
  const ability = { name: src.ability.name, blocks: src.ability.blocks };
  if (src.ability.silver) ability.silver = src.ability.silver;
  const { data: chk, error: ce } = await db.rpc('ability_v2_check', { p_role: src.role, p_ability: ability });
  if (ce) throw new Error(`face v2 ${card.id}: ability_v2_check: ${ce.message}`);
  if (!chk?.ok || !chk.text) throw new Error(`face v2 ${card.id}: the ability is not valid: ${(chk?.errors || []).join('; ') || 'no text'}`);
  const traits = card.tags?.traits ?? subj?.tags?.traits ?? [];
  const { data: el, error: ee } = await db.rpc('card_element', { p_tags: Array.isArray(traits) ? traits : [] });
  if (ee) throw new Error(`face v2 ${card.id}: card_element: ${ee.message}`);
  const st = await statusRows(db);
  const keys = blockStatuses(ability.blocks);
  return {
    role: src.role,
    element: el || null,
    active: { name: ability.name, text: markStatuses(chk.text, keys, st) },
    silver: chk.silver_text ? markStatuses(chk.silver_text, keys, st) : null,
    makes: makesOf(ability.blocks, chk.enables),
    uses: usesOf(ability.blocks, chk.pays),
  };
}
