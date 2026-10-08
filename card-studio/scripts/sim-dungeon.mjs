/**
 * The Dungeon simulation: seeded daily runs (squads from the local copy's real collections by power tier) and Gauntlet
 * runs through the real dungeon_* functions, NO lasting change, the LOCAL copy only:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/sim-dungeon.mjs [daily|gauntlet|both] [runs] [seed] [max floors]
 * The simulation itself is card-studio/src/sims/dungeon.js (the Admin Test lab runs the same module). --json prints the raw result.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { cliQuery } from '../src/sims/common.js';
import * as dg from '../src/sims/dungeon.js';

const q = cliQuery();
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const p = dg.params({ mode: args[0] || 'both', runs: args[1] || 2, seed: args[2], max_floors: args[3] });
const t0 = Date.now();
const { raw, summary } = await dg.run(q, p);
if (process.argv.includes('--json')) { console.log(JSON.stringify(raw, null, 1)); process.exit(0); }
console.log(`Dungeon ${summary.day} (${summary.rule || 'no rule'}), ${p.runs} run(s) per tier, seed ${p.seed}, ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
console.log('| Tier | Power | Runs | Floors | Fell | Cards down | Shards | Cards |\n|---|---|---|---|---|---|---|---|');
for (const g of summary.groups) {
  console.log(`| ${g.tier} | ${g.power ?? '-'} | ${g.runs}${g.failed ? ` (${g.failed} failed: ${g.errors.join(', ')})` : ''} | ${g.floors} | ${g.fell == null ? '-' : Math.round(100 * g.fell) + '%'} | ${g.downed} | ${g.shards} | ${g.cards} |`);
}
for (const g of summary.groups) console.log(`\n${g.tier}: damage per run ${g.card_damage.map((c) => `${c.name} ${c.damage}`).join(', ')}`);
