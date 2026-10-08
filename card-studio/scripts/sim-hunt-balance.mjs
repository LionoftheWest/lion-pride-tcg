/**
 * Boss balance, measured with the REAL engine (hunt_attack) and NO lasting change, on the LOCAL copy only:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/sim-hunt-balance.mjs [Normal|Heroic|Mythic] [spawns] [card HP floor] [seed]
 * The simulation itself is card-studio/src/sims/hunt-balance.js (the Admin Test lab runs the same module).
 * Optional: SIM_REAL_PLAYER_ID (from .env, no member id in the repo) adds one real collection to compare.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { cliQuery } from '../src/sims/common.js';
import * as hb from '../src/sims/hunt-balance.js';

const q = cliQuery();
const p = hb.params({ tier: process.argv[2] || 'Normal', spawns: process.argv[3] || 2, floor: process.argv[4] || 0, seed: process.argv[5] });
const { summary: s } = await hb.run(q, p, { realPlayer: process.env.SIM_REAL_PLAYER_ID || '' });
console.log(`== ${s.tier}${p.floor ? ` card HP floor ${p.floor}` : ''} (HP ${s.boss_hp.toLocaleString()}), ${p.spawns} spawn(s): ${s.bosses.join(', ')}`);
for (const g of s.groups) {
  console.log(`${g.group.padEnd(8)} damage/day median ${String(g.damage_median).padStart(6)} | attacks ${g.attacks_median} | ${g.crit_pct.toFixed(0)}% crit | ${g.miss_pct.toFixed(0)}% miss | a crew of ${s.crew} needs ${g.crew_days.toFixed(1)} days`);
}
console.log(`kill odds (estimate): a crew of ${s.crew} (the groups in equal parts) in ${s.days} days: ${(100 * s.kill_odds).toFixed(1)}%`);
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like 'tst_bal_%') test_players, (select count(*) from hunts where name like 'The %' and hp_max = 100000000) sim_hunts")));
