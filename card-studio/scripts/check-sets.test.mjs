// node --test scripts/check-sets.test.mjs  (no network, no files: small fixtures of invented cards)
// Each rule of scripts/check-sets.mjs has a test that FAILS when that rule is broken. MUTATE=<rule> node --test ... runs the
// same tests against a copy of the script with the rule removed (the mutation evidence), see the MUTANTS table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MUTANTS = {
  set: ["if (!c.set) add(set, c.id, 'set', 'the card has no set');", 'if (false) 0;'],
  'set-db': ["else if (dbSets && !dbSets.has(c.set)) add(set, c.id, 'set-db'", 'else if (false) add(set, c.id, \'set-db\''],
  'set-db-row': ["if (!row) add(fset, c.id, 'set-db'", "if (false) add(fset, c.id, 'set-db'"],
  art: ["if (!has) add(fset, c.id, 'art'", "if (false) add(fset, c.id, 'art'"],
  'tier-set': ["const finishSet = (c, f) => c.tierDetails?.[f]?.set || c.set;", 'const finishSet = (c, f) => c.set;'],
  'tier-set-count': ["cards.filter((c) => setsOf(c).includes(id)).length", "cards.filter((c) => (c.set || '(none)') === id).length"],
  'tier-set-exists': ["if (fs && fs !== c.set && dbSets && !dbSets.has(fs))", 'if (false)'],
  class: ["if (!CLASSES.includes(t.class)) add(", 'if (false) add('],
  origin: ["if (list(t.origin).length === 0) add(", 'if (false) add('],
  vocab: ["if (!have.has(String(v))) add(", 'if (false) add('],
  gap: ["if (gaps.length) add(", 'if (false) add('],
  dup: ["if (seen.has(n)) add(sid", 'if (false) add(sid'],
  inprogress: ["const strict = Boolean(only) || strictAll || pullable || !inProgress.includes(id);", 'const strict = true;'],
  pullable: ['|| pullable ||', '||'],
};
let mod = './check-sets.mjs';
if (process.env.MUTATE) {
  const [from, to] = MUTANTS[process.env.MUTATE];
  const src = readFileSync(join(here, 'check-sets.mjs'), 'utf8');
  assert.ok(src.includes(from), `the mutation ${process.env.MUTATE} no longer matches the script`);
  const f = join(mkdtempSync(join(tmpdir(), 'check-sets-')), 'check-sets.mjs');
  writeFileSync(f, src.replace(from, to).replace("const root = join(dirname(fileURLToPath(import.meta.url)), '..');", "const root = '.';"));
  mod = pathToFileURL(f).href;
}
const { checkSets, formatReport } = await import(mod);

const vocab = {
  facets: {
    origin: { values: [{ slug: 'smash' }, { slug: 'pokemon' }] },
    genre: { values: [{ slug: 'fighting' }] },
    realm: { values: [{ slug: 'crossover' }] },
    traits: { values: [{ slug: 'fire' }, { slug: 'caster' }] },
    subject: { kind: 'text', values: [{ label: 'Pokemon Unite' }] },
  },
};
const card = (id, over = {}) => ({
  id, name: id, genre: 'Pokemon Unite', type: 'Character', set: 'T1', finishes: ['normal', 'gold'],
  tags: { class: 'attacker', type: 'character', origin: ['smash'], traits: ['fire'], genre: [], realm: [] }, ...over,
});
const dbRows = (key, set, n, over = {}) => ['normal', 'gold'].map((r, i) => ({ key, rarity: r, set_id: set, set_number: n + i, image_url: 'http://x/' + key + r, ...over }));
const run = (cards, extra = {}) => checkSets({ cards, vocab, art: () => true, ...extra });
const rules = (res, id = 'T1') => res.sets.find((s) => s.id === id).findings.map((f) => f.rule);

test('a clean set is OK and does not fail', () => {
  const res = run([card('a'), card('b')]);
  assert.equal(res.defects, 0);
  assert.equal(res.failing, false);
  assert.match(formatReport(res), /RESULT: OK/);
});

test('rule set: a card with no set is a defect', () => {
  const res = run([card('a', { set: undefined })]);
  assert.deepEqual(rules(res, '(none)'), ['set']);
  assert.equal(res.failing, true);
});

test('rule art: a finish with no art is a defect, and the finish is named', () => {
  const res = run([card('a')], { art: (id, f) => f !== 'gold' });
  assert.deepEqual(rules(res), ['art']);
  assert.match(res.sets[0].findings[0].msg, /gold/);
});

test('rule art: not checked (said in the report) when there is no art source and no database', () => {
  const res = checkSets({ cards: [card('a')], vocab });
  assert.equal(res.defects, 0);
  assert.match(formatReport(res), /art: not checked/);
});

test('rule tag: class, origin and the library values', () => {
  assert.deepEqual(rules(run([card('a', { tags: { ...card('a').tags, class: 'tank' } })])), ['tag']);
  assert.deepEqual(rules(run([card('a', { tags: { ...card('a').tags, origin: [] } })])), ['tag']);
  for (const [facet, value] of [['origin', 'mario'], ['traits', 'swamp'], ['genre', 'racing'], ['realm', 'void']]) {
    const res = run([card('a', { tags: { ...card('a').tags, [facet]: [value] } })]);
    assert.deepEqual(rules(res), ['tag'], facet);
    assert.match(res.sets[0].findings[0].msg, new RegExp(facet));
  }
});

test('rule tag: the tag type must match the card type; the subject line is compared without accents and case', () => {
  assert.deepEqual(rules(run([card('a', { tags: { ...card('a').tags, type: 'moment' } })])), ['tag']);
  assert.equal(run([card('a', { genre: 'POKÉMON  unite' })]).defects, 0);
  assert.deepEqual(rules(run([card('a', { genre: 'Mario Kart' })])), ['tag']);
});

const dbOk = () => ({ sets: [{ id: 'T1', pullable: false }], cards: [...dbRows('a', 'T1', 1), ...dbRows('b', 'T1', 3)] });

test('DB mode: a clean set has no defect', () => {
  const res = checkSets({ cards: [card('a'), card('b')], vocab, db: dbOk() });
  assert.equal(res.defects, 0);
});

test('rule set-db: a set that is not in card_sets', () => {
  const res = checkSets({ cards: [card('a', { set: 'T9' })], vocab, db: dbOk() });
  assert.ok(rules(res, 'T9').includes('set-db'));
});

test('rule set-db: a finish with no cards row, and a row in another set', () => {
  const db = dbOk();
  db.cards = db.cards.filter((r) => !(r.key === 'a' && r.rarity === 'gold'));
  assert.deepEqual(rules(checkSets({ cards: [card('a')], vocab, db })).filter((r) => r === 'set-db'), ['set-db']);
  const db2 = { sets: [{ id: 'T1', pullable: false }, { id: 'T2', pullable: false }], cards: dbRows('a', 'T2', 1) };
  assert.deepEqual(rules(checkSets({ cards: [card('a')], vocab, db: db2 })), ['set-db', 'set-db']);
});

test('rule art (DB mode): a row with no image_url is a finish with no art', () => {
  const db = { sets: [{ id: 'T1', pullable: false }], cards: dbRows('a', 'T1', 1, { image_url: null }) };
  assert.deepEqual(rules(checkSets({ cards: [card('a')], vocab, db })), ['art', 'art']);
});

test('rule number: a gap and a duplicate in the set numbers', () => {
  const gap = { sets: [{ id: 'T1', pullable: false }], cards: [...dbRows('a', 'T1', 1), ...dbRows('b', 'T1', 4)] }; // 1 2 4 5
  const g = checkSets({ cards: [card('a'), card('b')], vocab, db: gap });
  assert.deepEqual(rules(g), ['number']);
  assert.match(g.sets[0].findings[0].msg, /gap.*3/);
  const dup = { sets: [{ id: 'T1', pullable: false }], cards: [...dbRows('a', 'T1', 1), ...dbRows('b', 'T1', 2)] }; // 1 2 2 3
  assert.ok(rules(checkSets({ cards: [card('a'), card('b')], vocab, db: dup })).includes('number'));
});

test('in progress: a listed set shows its defects but does not fail; a clean set beside it still decides', () => {
  const cards = [card('a'), card('w', { set: 'T2', tags: {} })];
  const res = run(cards, { inProgress: ['T2'] });
  const t2 = res.sets.find((s) => s.id === 'T2');
  assert.equal(t2.status, 'IN PROGRESS');
  assert.ok(t2.findings.length > 0);
  assert.equal(res.failing, false);
  assert.match(formatReport(res), /IN PROGRESS/);
  // the same data, the set not listed: it fails
  assert.equal(run(cards, { inProgress: [] }).failing, true);
});

test('in progress: --set and strictAll check the set strictly; a pullable set in the database is always strict', () => {
  const cards = [card('w', { set: 'T2', tags: {} })];
  assert.equal(run(cards, { inProgress: ['T2'], only: 'T2' }).failing, true);
  assert.equal(run(cards, { inProgress: ['T2'], strictAll: true }).failing, true);
  const db = { sets: [{ id: 'T2', pullable: true }], cards: dbRows('w', 'T2', 1) };
  assert.equal(checkSets({ cards, vocab, inProgress: ['T2'], db }).failing, true);
});

// ---- a set for each tier (cards.json tierDetails[finish].set) ----
const s1Card = () => card('old', { set: 'T1', finishes: ['normal', 'illustrated_rare'], tierDetails: { illustrated_rare: { set: 'T2' } } });
const twoSets = [{ id: 'T1', pullable: false }, { id: 'T2', pullable: false }];

test('tier set: a tier in another set counts for THAT set, the home set does not require its row', () => {
  const db = { sets: twoSets, cards: [
    { key: 'old', rarity: 'normal', set_id: 'T1', set_number: 1, image_url: 'u' },
    { key: 'old', rarity: 'illustrated_rare', set_id: 'T2', set_number: 1, image_url: 'u' }] };
  const res = checkSets({ cards: [s1Card()], vocab, db });
  assert.equal(res.defects, 0, JSON.stringify(res.sets.map((x) => x.findings)));
  assert.equal(res.sets.find((x) => x.id === 'T2').cards, 1, 'the card counts in T2');
  assert.equal(res.sets.find((x) => x.id === 'T1').cards, 1, 'and in its home set T1');
});

test('tier set: the tier row is missing = a defect of T2 (not of the home set T1); a row in the wrong set too', () => {
  const only = { sets: twoSets, cards: [{ key: 'old', rarity: 'normal', set_id: 'T1', set_number: 1, image_url: 'u' }] };
  const res = checkSets({ cards: [s1Card()], vocab, db: only });
  assert.deepEqual(rules(res, 'T2'), ['set-db', 'art']); // no row = no art either
  assert.match(res.sets.find((x) => x.id === 'T2').findings[0].msg, /illustrated_rare/);
  assert.deepEqual(rules(res, 'T1'), []);
  const wrong = { sets: twoSets, cards: [
    { key: 'old', rarity: 'normal', set_id: 'T1', set_number: 1, image_url: 'u' },
    { key: 'old', rarity: 'illustrated_rare', set_id: 'T1', set_number: 2, image_url: 'u' }] };
  const w = checkSets({ cards: [s1Card()], vocab, db: wrong });
  assert.match(w.sets.find((x) => x.id === 'T2').findings[0].msg, /is in set T1 in the database, not T2/);
});

test('tier set: a tier with no art is a defect of ITS set', () => {
  const res = run([s1Card()], { art: (id, f) => f !== 'illustrated_rare' });
  assert.deepEqual(rules(res, 'T2'), ['art']);
  assert.deepEqual(rules(res, 'T1'), []);
});

test('tier set: a tier set that is not in card_sets is a defect of that set; a card with no tier set is unchanged', () => {
  const db = { sets: [{ id: 'T1', pullable: false }], cards: [
    { key: 'old', rarity: 'normal', set_id: 'T1', set_number: 1, image_url: 'u' },
    { key: 'old', rarity: 'illustrated_rare', set_id: 'T1', set_number: 2, image_url: 'u' }] };
  assert.ok(rules(checkSets({ cards: [s1Card()], vocab, db }), 'T2').includes('set-db'));
  const plain = checkSets({ cards: [card('a'), card('b')], vocab, db: dbOk() });
  assert.deepEqual(plain.sets.map((x) => [x.id, x.cards, x.defects ?? x.findings.length]), [['T1', 2, 0]]);
});

test('tier set: a tier set equal to the home set is the home set', () => {
  const c = card('a', { tierDetails: { gold: { set: 'T1' } } });
  const res = checkSets({ cards: [c], vocab, db: dbOk() });
  assert.deepEqual(res.sets.map((x) => x.id), ['T1']);
  assert.equal(res.defects, 0);
});
