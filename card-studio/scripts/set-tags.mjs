/**
 * Set one card's faceted tags by hand, then apply everywhere at once:
 *   - writes cards.json (the source of truth for all 118 cards), and
 *   - upserts subjects.tags for that card IF it is live in the DB
 *     (the DB trigger re-flattens tag_slugs; the other 84 cards get their tags
 *      when they are first pushed from the portal).
 *
 * Usage:
 *   node scripts/set-tags.mjs <card-id> game=pokemon traits=water,armored,beast
 *   node scripts/set-tags.mjs <card-id> game=smash traits=fire,ranged
 *   node scripts/set-tags.mjs <card-id> traits=... --dry     # cards.json only, no DB
 *
 * The model = Type + one Game + one Element (or physical) + a few Kinds.
 *   game    the franchise slug (smash|pokemon|minecraft|party|meme|community)
 *   traits  the combat bag: the element + the kinds (order does not matter)
 * class + type come from the card's existing type (attacker = Character/Creature).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTACKER_TYPES, dominantElement, ELEMENTS, GAMES, unknownTraits } from './taxonomy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CARDS = join(here, '..', 'cards.json');
const DRY = process.argv.includes('--dry');

const [id, ...rest] = process.argv.slice(2).filter((a) => a !== '--dry');
if (!id) {
  console.error('usage: node scripts/set-tags.mjs <card-id> traits=a,b,c [origin=x] [genre=a,b] [realm=a,b] [--dry]');
  process.exit(1);
}
const kv = {};
for (const a of rest) {
  const m = a.match(/^(\w+)=(.*)$/);
  if (m) kv[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
}

const cards = JSON.parse(readFileSync(CARDS, 'utf8'));
const card = cards.find((c) => c.id === id);
if (!card) { console.error(`! no card with id "${id}" in cards.json`); process.exit(1); }

const type = card.type || 'Character';
const prev = card.tags || {};
// Game slug: `game=` wins, else keep the previous origin. Validate against GAMES.
const game = kv.game ? kv.game : (kv.origin || prev.origin || []);
const origin = Array.isArray(game) ? game : [game];
for (const g of origin) if (g && !GAMES[g]) console.warn(`  ~ note: unknown game slug "${g}" (known: ${Object.keys(GAMES).join(', ')})`);
// The tighter model writes ONLY class + type + origin(game) + traits — the old
// genre/realm sprawl is dropped, so re-tagging a card cleans it off the DB row.
const tags = {
  class: ATTACKER_TYPES.has(type) ? 'attacker' : 'support',
  type: type.toLowerCase(),
  origin,
  traits: kv.traits || prev.traits || [],
};
tags.traits = [...new Set(tags.traits.map((t) => String(t).toLowerCase()))];

const unknown = unknownTraits(tags.traits);
if (unknown.length) console.warn(`  ~ note: unrecognized trait(s) kept as-is: ${unknown.join(', ')}`);
const elem = dominantElement(tags.traits);

card.tags = tags;
card.updatedAt = Date.now();
writeFileSync(CARDS, `${JSON.stringify(cards, null, 2)}\n`);
console.log(`cards.json: ${id} -> element ${elem ? `${elem} ${ELEMENTS[elem]}` : 'physical'} | traits [${tags.traits.join(', ')}]`);

if (DRY) { console.log('--dry: skipped the DB push.'); process.exit(0); }

const { supabase } = await import('../src/supabase.js');
const { data, error } = await supabase.from('subjects').update({ tags }).eq('key', id).select('id');
if (error) console.error(`  ! DB: ${error.message}`);
else if (!data || !data.length) console.log('  · not live in the DB yet — cards.json holds the tags until the card is pushed.');
else { card.pushedAt = Date.now(); writeFileSync(CARDS, `${JSON.stringify(cards, null, 2)}\n`); console.log('  ✓ DB subject updated (tag_slugs re-flattened by the trigger).'); }
