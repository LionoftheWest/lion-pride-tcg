/**
 * First-pass faceted tags for every card (Phase 1 of the card-tags engine).
 * See discord/docs/card-tags-and-battle-engine.md.
 *
 *   node scripts/seed-tags.mjs           # write cards.json + push to Supabase
 *   node scripts/seed-tags.mjs --dry     # compute + write cards.json only
 *   node scripts/seed-tags.mjs --force   # overwrite existing hand-tuned tags
 *
 * By default a card that already has a `tags` object is LEFT ALONE (so your
 * hand tweaks survive a re-run). Use --force to recompute every card.
 *
 * Facets: class (attacker|support), type, origin, genre[], realm[], traits[].
 * The traits are a first pass — tune them in the portal later.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CARDS = join(here, '..', 'cards.json');
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

const ATTACKER_TYPES = new Set(['Character', 'Creature']);

// The source game (card.genre) -> origin slug + broad genre + realm.
function originOf(genre) {
  const g = (genre || '').toLowerCase();
  if (g.includes('smash')) return { origin: 'smash', genre: ['fighting', 'crossover'], realm: ['crossover'] };
  if (g.includes('okemon') || g.includes('okémon')) return { origin: 'pokemon', genre: ['creature-battler', 'moba'], realm: ['pokemon-world'] };
  if (g.includes('minecraft')) return { origin: 'minecraft', genre: ['sandbox', 'survival'], realm: ['blocky'] };
  if (g.includes('party')) return { origin: 'party', genre: ['party'], realm: ['real-world'] };
  if (g.includes('meme')) return { origin: 'meme', genre: ['meme'], realm: ['internet'] };
  return { origin: 'community', genre: ['community'], realm: ['community'] };
}

// Default traits by card type (a floor every card gets before the curated map).
function defaultTraits(type) {
  switch (type) {
    case 'Character': return ['humanoid', 'melee'];
    case 'Creature': return ['beast'];
    case 'Item': return ['object'];
    case 'Place': return ['location'];
    case 'Moment': return ['event'];
    default: return [];
  }
}

// Curated first-pass traits for the recognizable subjects (id -> traits[]).
// These REPLACE the default traits for that card. Everything else keeps the
// type default plus the origin trait. Tune freely in the portal.
const TRAITS = {
  // --- Pokemon creatures (element + kind + style) ---
  'mr-mob-s-mr-mime': ['arcane', 'fairy', 'caster'],
  'blastninja-s-blastoise': ['water', 'armored'],
  'noobeth-s-venusaur': ['nature', 'poison'],
  'heero-s-meowscarada': ['nature', 'shadow', 'stealth'],
  'broken-warden-s-umbreon': ['shadow', 'beast'],
  'jelly-s-urshifu': ['fighting', 'water', 'melee'],
  'lionofthewest-s-tsareena': ['nature', 'royal', 'melee'],
  'gsnipes-cinderrace': ['fire', 'ranged'],
  'r2vq-s-talonflame': ['fire', 'air', 'ranged'],
  'ling-ling-s-talonflame': ['fire', 'air', 'ranged'],
  'lionofthewest-s-pichu': ['lightning', 'cute'],
  'lionofthewest-s-pikachu': ['lightning'],
  'kaminari-s-incineroar': ['fire', 'beast', 'melee'],
  'grim-s-jigglypuff': ['arcane', 'fairy', 'cute'],
  'mr-mobs-mew': ['arcane', 'legendary'],
  'lionofthewest-s-dodrio': ['air', 'beast', 'ranged'],
  'rotom-washed': ['water', 'lightning', 'spirit'],
  'bad-news-bears': ['earth', 'beast'],
  // --- Smash characters (franchise + kind + style) ---
  'mztaken-s-kirby': ['arcane', 'cute', 'copy'],
  'brego-s-link': ['hero', 'melee', 'royal'],
  'vioarr-s-link': ['hero', 'melee', 'royal'],
  'beetle-s-cloud': ['human', 'melee', 'mercenary'],
  'wiifu-s-sora': ['light', 'melee', 'hero'],
  'geno-s-megaman': ['robot', 'ranged'],
  'grim-s-pokemon-trainer': ['human', 'trainer'],
  'piotr-s-little-mac': ['human', 'boxer', 'melee'],
  'texafornia-s-richter': ['human', 'light', 'whip'],
  'maddawg-s-wolf': ['beast', 'ranged'],
  'keeb-s-mii-gunner': ['armored', 'ranged'],
  'kaminari-s-krool': ['monster', 'royal', 'armored'],
  'foxtrot-s-krool': ['monster', 'royal', 'armored'],
  'ottozone-s-rob': ['robot', 'ranged'],
  'wiifu-s-wiifit-trainer': ['human', 'support'],
  'chevynova-s-bowser': ['monster', 'royal', 'fire'],
  'e-mandarkstar-s-ganondorf': ['shadow', 'royal', 'melee'],
  'lazypie-s-zero-suit-samus': ['human', 'armored', 'ranged'],
  'bonzan-s-donkey-kong': ['beast', 'strong', 'melee'],
  'rad-dad-s-ness': ['arcane', 'psychic'],
  'pringle-s-banjo-kazooie': ['beast', 'bird', 'duo'],
  'notjosh-s-waluigi': ['human', 'trickster'],
  'baego': ['human', 'community'],
  'kobedunk-s-lumberjack': ['human', 'melee', 'strong'],
  // --- Community / meme characters ---
  'zeoic-the-server-master': ['human', 'tech', 'community'],
  'mr-worldwide': ['human', 'meme'],
  'gym-rat-lion': ['human', 'strong', 'community'],
  'memelord-lion': ['human', 'meme', 'community'],
  'the-dad-gaming': ['human', 'community'],
  'mrs-lionofthewest': ['human', 'community'],
  'kroc-bot': ['robot', 'community'],
  'thechamp': ['human', 'community'],
  // --- Items ---
  'wiifu-s-bowling-ball': ['object', 'heavy'],
  'xeno-s-blueprint': ['object', 'tech'],
  'zeoic-s-redstone-machine': ['object', 'tech', 'mechanical'],
  'xeno-s-stone-shovel': ['object', 'tool'],
  'xeno-s-unfinished-project': ['object', 'tech'],
  'blade-s-beans-on-toast': ['object', 'food'],
  'soggy-bread': ['object', 'food'],
  // --- Places ---
  'alydoor-s-cafe': ['location', 'cozy'],
  'king-of-the-swamp': ['location', 'swamp'],
  'mr-mobs-dirt-house': ['location', 'blocky'],
  'create-a-colony': ['location', 'blocky'],
  'polar-bear-build': ['location', 'ice'],
  'palworld-mountain-base': ['location', 'mountain'],
};

function tagsFor(card) {
  const type = card.type || 'Character';
  const cls = ATTACKER_TYPES.has(type) ? 'attacker' : 'support';
  const o = originOf(card.genre);
  const curated = TRAITS[card.id];
  const base = curated ? curated.slice() : defaultTraits(type);
  // Add the origin as a trait too, so a boss can be weak to a whole franchise.
  const traits = [...new Set([...base, o.origin])];
  return {
    class: cls,
    type: type.toLowerCase(),
    origin: [o.origin],
    genre: o.genre,
    realm: o.realm,
    traits,
  };
}

// --- Run ---
const cards = JSON.parse(readFileSync(CARDS, 'utf8'));
let computed = 0; let skipped = 0;
for (const card of cards) {
  if (card.tags && !FORCE) { skipped += 1; continue; }
  card.tags = tagsFor(card);
  computed += 1;
}
writeFileSync(CARDS, `${JSON.stringify(cards, null, 2)}\n`);
console.log(`cards.json: ${computed} tagged, ${skipped} kept (use --force to recompute).`);

if (DRY) { console.log('--dry: skipped the Supabase push.'); process.exit(0); }

const { supabase } = await import('../src/supabase.js');
let ok = 0; let missing = 0; let failed = 0;
for (const card of cards) {
  const { data, error } = await supabase
    .from('subjects')
    .update({ tags: card.tags })
    .eq('key', card.id)
    .select('id');
  if (error) { failed += 1; console.error(`  ! ${card.id}: ${error.message}`); }
  else if (!data || !data.length) { missing += 1; }
  else { ok += 1; }
}
console.log(`Supabase: ${ok} updated, ${missing} not-in-db, ${failed} failed.`);
