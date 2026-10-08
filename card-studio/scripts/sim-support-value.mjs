/**
 * Does each boss cut the countered support's own value by at least 50%? (Nathan, 2026-10-06: "cut the support cards
 * ability itself and its viable part, not the whole squad".) Run it on the LOCAL copy, NO lasting change:
 *   LOCALDB=1 NODE_OPTIONS=--import=./scripts/localdb-preload.mjs node scripts/sim-support-value.mjs [days] [file.sql]
 * The simulation itself is card-studio/src/sims/support-value.js (the Admin Test lab runs the same module).
 * [file.sql]: a migration to run first (in the block). SIM_BOSSES (JSON {boss: type}) picks a subset. SIM_DEBUG prints the rows.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { cliQuery } from '../src/sims/common.js';
import * as sv from '../src/sims/support-value.js';

const q = cliQuery();
const migration = !process.argv[3] ? '' : readFileSync(process.argv[3], 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const p = sv.params({ days: process.argv[2] || 30, bosses: JSON.parse(process.env.SIM_BOSSES || 'null') });
console.log(`Support value per squad-day (${p.days} days). Value = damage with the support - damage without it (heal: HP restored).\n`);
console.log('| Boss | Counters | Value, counters off | Value, counters on | Cut | Goal (>= 50%) |\n|---|---|---|---|---|---|');
const { raw } = await sv.run(q, p, { migration });
for (const r of raw) {
  console.log(`| ${r.boss} | ${r.type} | ${r.off} | ${r.on} | ${r.cut === null ? '-' : r.cut + '%'} | ${r.goal ? 'yes' : 'NO'} |`);
  if (process.env.SIM_DEBUG) console.log(JSON.stringify(r.rows));
}
