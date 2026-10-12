/**
 * F-2 item 7: the tag library of the card editor (src/tag-vocab.js, tag-vocab.json). No database:
 *   node scripts/test-tag-vocab.mjs
 * Invariants:
 *   - "+ Add new" never splits the library: case, accents, spaces, "-" / "_" give the existing value; a plural, a
 *     missing hyphen or an element alias (flame = fire) is refused with the existing value as the suggestion;
 *   - a really new value is added once (as a slug, or as a label for the subject line);
 *   - the view counts the cards of each value, lists a used value that the library lacks, and names its near twin;
 *   - tag-vocab.json has every element of scripts/taxonomy.mjs and every value that the five facets need.
 */
import { addValue, vocabView, loadVocab, normKey, nearSame } from '../src/tag-vocab.js';
import { ELEMENT_ORDER, KINDS, GAMES } from './taxonomy.mjs';

const res = [];
const check = (name, ok, extra = '') => res.push({ name, ok: Boolean(ok), extra });
const fresh = () => JSON.parse(JSON.stringify(loadVocab()));

check('normKey folds case, accents, spaces, - and _', normKey(' Pokémon  Unite ') === 'pokemon-unite' && normKey('Nature ') === 'nature' && normKey('super_smash-bros') === 'super-smash-bros');
check('nearSame folds plurals and hyphens, not other words', nearSame('Natures', 'nature') && nearSame('pokemon-world', 'pokemonworld') && nearSame('boxes', 'box') && !nearSame('fire', 'firework') && !nearSame('ice', 'nice'));

let v = fresh();
let r = addValue(v, 'traits', 'Nature ');
check('"Nature " = the existing nature (no new value)', r.ok && r.existed && r.value === 'nature' && v.facets.traits.values.filter((x) => x.slug === 'nature').length === 1, JSON.stringify(r));
r = addValue(v, 'traits', 'natures');
check('"natures" is refused, suggest nature', !r.ok && r.suggest === 'nature', JSON.stringify(r));
r = addValue(v, 'traits', 'Flame');
check('"Flame" (an element alias) is refused, suggest fire', !r.ok && r.suggest === 'fire', JSON.stringify(r));
r = addValue(v, 'subject', 'pokémon unite');
check('subject "pokémon unite" = the existing "Pokemon Unite"', r.ok && r.existed && r.value === 'Pokemon Unite', JSON.stringify(r));
r = addValue(v, 'subject', 'Party Game');
check('subject "Party Game" is refused, suggest "Party Games"', !r.ok && r.suggest === 'Party Games', JSON.stringify(r));
const before = v.facets.traits.values.length;
r = addValue(v, 'traits', 'Swamp  Dweller');
const again = addValue(v, 'traits', 'swamp-dweller');
check('a new trait is added once, as a slug', r.ok && !r.existed && r.value === 'swamp-dweller' && again.existed && v.facets.traits.values.length === before + 1, JSON.stringify(r));
r = addValue(v, 'subject', '  Lion   Pride  TCG ');
check('a new subject is added as a clean label', r.ok && r.value === 'Lion Pride TCG', JSON.stringify(r));
check('an empty value or an unknown facet is refused', !addValue(v, 'traits', '  !! ').ok && !addValue(v, 'colour', 'x').ok);

const cards = [
  { id: 'a', genre: 'Pokémon Unite', tags: { traits: ['fire', 'beast'], origin: ['pokemon'] } },
  { id: 'b', genre: 'Pokemon Unite', tierDetails: { gold: { genre: 'Party Games' } }, tags: { traits: ['fire', 'natures'], origin: ['lion pride tcg'] } },
];
const view = vocabView(fresh(), cards);
const val = (f, x) => view[f].values.find((y) => y.value === x);
check('the view counts the cards of each value (accents folded)', val('traits', 'fire').cards === 2 && val('subject', 'Pokemon Unite').cards === 2 && val('subject', 'Party Games').cards === 1);
check('a used value that the library lacks is listed, with its near twin', val('traits', 'natures')?.library === false && val('traits', 'natures')?.near === 'nature'
  && val('origin', 'lion pride tcg')?.library === false);

const lib = loadVocab().facets;
check('tag-vocab.json has every element, kind and game of taxonomy.mjs',
  ELEMENT_ORDER.every((e) => lib.traits.values.some((x) => x.slug === e && x.group === 'element'))
  && [...KINDS].every((k) => lib.traits.values.some((x) => x.slug === k))
  && Object.keys(GAMES).every((g) => lib.origin.values.some((x) => x.slug === g)));
check('the five facets: origin, genre, realm, traits (several) and subject (one, text)',
  ['origin', 'genre', 'realm', 'traits'].every((f) => lib[f] && lib[f].multi) && lib.subject.multi === false && lib.subject.kind === 'text');

let fails = 0;
for (const x of res) { if (!x.ok) fails += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.ok ? '' : `  ${x.extra}`}`); }
console.log(`\n${process.env.MUTATE ? `MUTATE=${process.env.MUTATE} ` : ''}${res.length - fails}/${res.length} pass, FAILS ${fails}`);
process.exitCode = fails ? 1 : 0;
