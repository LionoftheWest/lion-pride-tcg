// Check the 50 achievements against the real catalog: there are exactly 50, the keys
// are unique, and every card-set goal is attainable with Season 1 cards (the set has at
// least `need` cards). An empty collection shows 0 done; a full collection of every
// card with max stats shows all 50 done. Run: node tools/check-achievements.mjs <catalog.json>
import { readFileSync } from 'node:fs';
import { ACHIEVEMENTS, measure } from '../src/achievements.js';

const catalog = JSON.parse(readFileSync(process.argv[2], 'utf8')).cards;
let bad = 0;
const fail = (m) => { console.log('FAIL', m); bad++; };

if (ACHIEVEMENTS.length !== 50) fail(`count is ${ACHIEVEMENTS.length}, not 50`);
const keys = new Set();
for (const a of ACHIEVEMENTS) { if (keys.has(a.key)) fail(`duplicate key ${a.key}`); keys.add(a.key); }

const none = catalog.map((c) => ({ ...c, owned: false, quantity: 0, ascension: 0 }));
const all = catalog.map((c) => ({ ...c, owned: true, quantity: 5, ascension: 5 }));
const maxStats = { packsOpened: 99, packsGifted: 9, huntsJoined: 9, totalDamage: 1e6, bestHit: 1e5, bossesDefeated: 9, boonsPlayed: 9, pranksPlayed: 9, tradesDone: 9 };

const empty = measure(none, {});
const full = measure(all, maxStats);
if (empty.some((a) => a.done)) fail(`done with an empty collection: ${empty.filter((a) => a.done).map((a) => a.key)}`);
for (const a of full) {
  if (!a.done) fail(`${a.key} (${a.name}) is not attainable: ${a.have}/${a.need}`);
  if (a.set && a.set.length < a.need) fail(`${a.key} set has ${a.set.length} cards, needs ${a.need}`);
}
// Season 1 Complete = every Season 1 base (normal) card, and no other rarity (Nathan, 2026-10-03).
const s1Base = catalog.filter((c) => (c.season || 'Season 1') === 'Season 1' && c.rarity === 'normal');
const onlyBase = measure(catalog.map((c) => ({ ...c, owned: s1Base.includes(c), quantity: s1Base.includes(c) ? 1 : 0, ascension: 0 })), {}).find((a) => a.key === 's1');
const allButOne = measure(catalog.map((c) => ({ ...c, owned: c !== s1Base[0], quantity: c !== s1Base[0] ? 1 : 0, ascension: 0 })), {}).find((a) => a.key === 's1');
if (!s1Base.length) fail('the catalog has no Season 1 base cards');
if (!onlyBase.done || onlyBase.need !== s1Base.length) fail(`s1 with only the ${s1Base.length} base cards: ${onlyBase.have}/${onlyBase.need}, not done`);
if (allButOne.done) fail('s1 is done with one base card missing');
console.log(full.map((a) => `${a.done ? 'ok ' : 'NO '} ${a.group.padEnd(11)} ${a.name.padEnd(18)} ${a.desc}`).join('\n'));
console.log(bad ? `${bad} FAILED` : `PASS ${ACHIEVEMENTS.length} achievements, all attainable`);
if (bad) process.exit(1);

// Every achievement has a reward, and no reward key is unknown.
const { REWARDS } = await import('../src/achievements.js');
let rbad = 0;
for (const a of ACHIEVEMENTS) if (!REWARDS[a.key]) { console.log('FAIL no reward for', a.key); rbad++; }
for (const k of Object.keys(REWARDS)) if (!ACHIEVEMENTS.some((a) => a.key === k)) { console.log('FAIL reward for unknown', k); rbad++; }
const total = Object.values(REWARDS).reduce((t, r) => t + (r.packs || 0), 0);
console.log(rbad ? `${rbad} REWARD FAILS` : `PASS rewards: ${Object.keys(REWARDS).length}, ${total} packs in total`);
if (rbad) process.exit(1);
