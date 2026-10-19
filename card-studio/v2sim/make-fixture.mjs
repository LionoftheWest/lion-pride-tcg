// make-fixture.mjs - builds v2sim/fixture.json from a read-only snapshot of PUBLIC card data.
// No player data: only subjects (card content), the finishes of each subject, and balance values.
//
// 1. Dump the snapshot (read-only SELECTs, from the main card-studio folder that holds the .env):
//      node q.local.mjs "select key, name, type, cp_mod, tags, ability from subjects order by key" > <dir>/subjects.jsonl
//      node q.local.mjs "select s.key, c.rarity::text rarity, bool_or(c.in_draw_pool) pool from cards c join subjects s on s.id=c.subject_id group by 1,2 order by 1,2" > <dir>/cards.jsonl
//      node q.local.mjs "select key, value from balance where key in ('boss_atk','boss_hp','boss_moves','boss_passives','boss_tiers','card_hp','combat','dungeon','pool_moves','rarity_cp','round_cap','daily_card_cap','stars','support','stat_points')" > <dir>/balance.jsonl
// 2. node card-studio/v2sim/make-fixture.mjs <dir> [--date YYYY-MM-DD]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || join(here, '..', 'out', 'v2sim-snap');
const date = process.argv.includes('--date') ? process.argv[process.argv.indexOf('--date') + 1] : new Date().toISOString().slice(0, 10);
const jsonl = f => readFileSync(join(dir, f), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));

const subjects = jsonl('subjects.jsonl');
const cards = jsonl('cards.jsonl');
const balance = Object.fromEntries(jsonl('balance.jsonl').map(r => [r.key, r.value]));
const fin = {};
for (const c of cards) (fin[c.key] ||= []).push({ rarity: c.rarity, pool: !!c.pool });

const out = {
  _note: `Public card data snapshot (live, read-only) of ${date}: subjects, their finishes, and the balance values that v2sim starts from. No player data.`,
  snapshot_date: date,
  subjects: subjects.map(s => ({
    key: s.key, name: s.name, type: s.type, cp_mod: Number(s.cp_mod) || 1,
    origin: s.tags?.origin || [], traits: s.tags?.traits || [],
    ability: s.ability ? { name: s.ability.name, effect: s.ability.effect, amount: s.ability.amount ?? null, threshold: s.ability.threshold ?? null } : null,
    finishes: (fin[s.key] || []).sort((a, b) => a.rarity.localeCompare(b.rarity)),
  })),
  balance_live: balance,
};
writeFileSync(join(here, 'fixture.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`fixture.json: ${out.subjects.length} subjects, ${cards.length} cards, ${Object.keys(balance).length} balance keys`);
