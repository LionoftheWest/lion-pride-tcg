/**
 * One-time normalize pass: collapse every card's traits onto the locked palette
 * (13 elements + the core kinds), fold the one-off kinds into their nearest core,
 * and strip the legacy leftovers (the game slug and the type, which the seed had
 * dumped into the trait bag). Writes cards.json + pushes every live subject.
 *
 *   node scripts/normalize-tags.mjs --dry   # cards.json only, show the changes
 *   node scripts/normalize-tags.mjs         # cards.json + push live subjects
 *
 * Element assignment stays a by-hand job (set-tags.mjs). This only cleans kinds.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACKER_TYPES, ELEMENT_ALIAS, ELEMENTS, KINDS } from './taxonomy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CARDS = join(here, '..', 'cards.json');
const DRY = process.argv.includes('--dry');

const ELSET = new Set(Object.keys(ELEMENTS)); // canonical element keys

// One-off kind -> nearest core kind.
const FOLD = {
  human: 'humanoid', boxer: 'melee', whip: 'melee', mercenary: 'humanoid',
  trickster: 'humanoid', trainer: 'humanoid', copy: 'caster', duo: 'beast',
  tool: 'object', heavy: 'object', food: 'object', tech: 'object',
  mechanical: 'robot', dragon: 'monster', villain: 'monster', tank: 'armored',
  undead: 'spirit',
  // element aliases -> canonical element word (so the trait bag reads canonical)
  fairy: 'arcane', poison: 'toxic', electric: 'lightning', frost: 'ice',
  grass: 'nature', wind: 'air', dark: 'shadow', holy: 'light', ghost: 'spirit',
};

// Traits that belong to another facet (game / type) — drop from the bag.
const DROP = new Set([
  'smash', 'pokemon', 'minecraft', 'party', 'meme', 'event',
  'character', 'creature', 'item', 'place', 'moment',
  'blocky', 'cozy', 'swamp', 'mountain', 'ice-biome',
]);

function cleanTraits(traits) {
  const out = [];
  const dropped = [];
  for (const raw of traits || []) {
    const s = String(raw).toLowerCase().trim();
    if (!s) continue;
    if (DROP.has(s)) { dropped.push(s); continue; }
    const folded = FOLD[s] || s;
    if (ELSET.has(folded) || KINDS.has(folded)) { if (!out.includes(folded)) out.push(folded); }
    else dropped.push(s); // unknown, no core home -> drop (report it)
  }
  return { out, dropped };
}

const cards = JSON.parse(readFileSync(CARDS, 'utf8'));
let changed = 0;
const droppedAll = new Set();
const live = [];
for (const card of cards) {
  const type = card.type || 'Character';
  const prev = card.tags || {};
  const { out, dropped } = cleanTraits(prev.traits);
  dropped.forEach((d) => droppedAll.add(d));
  const tags = {
    class: ATTACKER_TYPES.has(type) ? 'attacker' : 'support',
    type: type.toLowerCase(),
    origin: prev.origin || [],
    traits: out,
  };
  const before = JSON.stringify(prev);
  const after = JSON.stringify(tags);
  if (before !== after) { card.tags = tags; card.updatedAt = Date.now(); changed += 1; live.push(card); }
}
writeFileSync(CARDS, `${JSON.stringify(cards, null, 2)}\n`);
console.log(`cards.json: ${changed} card(s) normalized.`);
console.log(`dropped/­folded away: ${[...droppedAll].sort().join(', ') || '(none)'}`);

if (DRY) { console.log('--dry: skipped the DB push.'); process.exit(0); }

const { supabase } = await import('../src/supabase.js');
let ok = 0; let miss = 0; let fail = 0;
for (const card of live) {
  const { data, error } = await supabase.from('subjects').update({ tags: card.tags }).eq('key', card.id).select('id');
  if (error) { fail += 1; console.error(`  ! ${card.id}: ${error.message}`); }
  else if (!data || !data.length) miss += 1;
  else ok += 1;
}
console.log(`Supabase: ${ok} updated, ${miss} not-live, ${fail} failed.`);
