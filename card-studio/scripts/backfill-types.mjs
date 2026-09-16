/**
 * Backfill the card "type" for the PVE typing system into cards.json.
 *
 * Type is a SUBJECT property (all rarity variants share it). This assigns a
 * best-effort type to every subject: explicit lists for the clear ones
 * (fighters -> Character, Pokemon/animals -> Creature, objects -> Item,
 * locations -> Place); everything else (the community in-jokes / events) falls
 * back to Moment. Nathan reviews the printed grouping and moves any misses.
 *
 *   node scripts/backfill-types.mjs          # dry run: print the grouping only
 *   node scripts/backfill-types.mjs --write  # write type into cards.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'cards.json');
const WRITE = process.argv.includes('--write');

const CHARACTER = new Set([
  'mztaken-s-kirby', 'brego-s-link', 'vioarr-s-link', 'beetle-s-cloud', 'wiifu-s-sora',
  'geno-s-megaman', 'piotr-s-little-mac', 'texafornia-s-richter', 'maddawg-s-wolf',
  'keeb-s-mii-gunner', 'ottozone-s-rob', 'wiifu-s-wiifit-trainer', 'chevynova-s-bowser',
  'e-mandarkstar-s-ganondorf', 'lazypie-s-zero-suit-samus', 'bonzan-s-donkey-kong',
  'rad-dad-s-ness', 'pringle-s-banjo-kazooie', 'notjosh-s-waluigi', 'grim-s-pokemon-trainer',
  'kaminari-s-krool', 'foxtrot-s-krool', 'baego', 'gym-rat-lion', 'memelord-lion',
  'the-dad-gaming', 'thechamp', 'zeoic-the-server-master', 'mrs-lionofthewest', 'kroc-bot',
  'kobedunk-s-lumberjack', 'mr-worldwide',
]);
const CREATURE = new Set([
  'mr-mob-s-mr-mime', 'blastninja-s-blastoise', 'noobeth-s-venusaur', 'heero-s-meowscarada',
  'broken-warden-s-umbreon', 'jelly-s-urshifu', 'lionofthewest-s-tsareena', 'gsnipes-cinderrace',
  'r2vq-s-talonflame', 'ling-ling-s-talonflame', 'mr-mobs-mew', 'lionofthewest-s-dodrio',
  'rotom-washed', 'kaminari-s-incineroar', 'grim-s-jigglypuff', 'lionofthewest-s-pichu',
  'lionofthewest-s-pikachu', 'bad-news-bears',
]);
const ITEM = new Set([
  'wiifu-s-bowling-ball', 'xeno-s-stone-shovel', 'xeno-s-blueprint', 'zeoic-s-redstone-machine',
  'xeno-s-unfinished-project', 'soggy-bread', 'blade-s-beans-on-toast',
]);
const PLACE = new Set([
  'alydoor-s-cafe', 'mr-mobs-dirt-house', 'palworld-mountain-base', 'polar-bear-build',
  'create-a-colony', 'mob-s-hiding-spot-meccha', 'king-of-the-swamp',
]);

function typeFor(id) {
  if (CHARACTER.has(id)) return 'Character';
  if (CREATURE.has(id)) return 'Creature';
  if (ITEM.has(id)) return 'Item';
  if (PLACE.has(id)) return 'Place';
  return 'Moment'; // default for events / memes / in-jokes
}

const cards = JSON.parse(readFileSync(FILE, 'utf8'));
const groups = { Character: [], Creature: [], Item: [], Place: [], Moment: [] };
for (const c of cards) {
  const t = typeFor(c.id);
  c.type = t;
  groups[t].push(c.name);
}

for (const [t, names] of Object.entries(groups)) {
  console.log(`\n=== ${t} (${names.length}) ===`);
  console.log(names.map((n) => `  - ${n}`).join('\n'));
}
console.log(`\nTotal subjects: ${cards.length}`);

if (WRITE) {
  writeFileSync(FILE, JSON.stringify(cards, null, 2) + '\n');
  console.log('\n[written] type added to every subject in cards.json');
} else {
  console.log('\n[dry run] re-run with --write to save into cards.json');
}
