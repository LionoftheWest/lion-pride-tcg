/**
 * Measure the boss counter moves (docs/hunt-boss-moves.md section 7) with NO lasting change. Run it on the LOCAL copy:
 *   LOCALDB=1 NODE_OPTIONS=--import=./scripts/localdb-preload.mjs node scripts/sim-boss-moves.mjs [days] [file.sql]
 * The simulation itself is card-studio/src/sims/boss-moves.js (the Admin Test lab runs the same module).
 * [file.sql]: a migration to run first (in the block). No file: the database as it is (hunt_boss_moves.sql is
 * superseded; the shares and weights are balance boss_counters since hunt_counter_balance.sql).
 * SIM_BOSSES / SIM_SQUADS (JSON) pick a subset, for a quick check.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { cliQuery } from '../src/sims/common.js';
import * as bm from '../src/sims/boss-moves.js';

const q = cliQuery();
const migration = !process.argv[3] ? '' : readFileSync(process.argv[3], 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const p = bm.params({ days: process.argv[2] || 6, bosses: process.env.SIM_BOSSES ? JSON.parse(process.env.SIM_BOSSES) : null,
  squads: process.env.SIM_SQUADS ? JSON.parse(process.env.SIM_SQUADS) : null });
const { summary } = await bm.run(q, p, { migration, onProgress: (i, n, boss) => { if (i > 0) process.stderr.write(`${p.bosses[i - 1]} done\n`); } });
console.log(`Average boss damage per squad-day (${p.days} days each). Off = counter moves off, On = 40% of normal turns.\n`);
console.log('| Boss | Squad | Off | On | Change |\n|---|---|---|---|---|');
for (const r of summary.rows) console.log(`| ${r.boss} | ${r.squad} | ${r.off} | ${r.on} | ${r.change == null ? '-' : r.change}% |`);
