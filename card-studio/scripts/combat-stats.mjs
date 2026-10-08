/**
 * Print Pride Hunt combat telemetry for balance tuning.
 *   node scripts/combat-stats.mjs                                                        (live, read only)
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/combat-stats.mjs        (the local copy)
 * Roll rates (miss/crit/block/weak/counter, downs, avg damage) + per-hunt fight length (attacks, hunters,
 * minutes-to-kill). The report itself is card-studio/src/sims/combat-stats.js (the Admin Test lab runs it too).
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { cliQuery } from '../src/sims/common.js';
import * as cs from '../src/sims/combat-stats.js';

if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_URL) { console.error('Missing SUPABASE_ACCESS_TOKEN / SUPABASE_URL in .env'); process.exit(1); }
const q = cliQuery({ allowLive: true });   // read only: hunt_combat_stats() and hunt_fight_summary()
let s, fights;
try { ({ summary: { stats: s, fights } } = await cs.run(q, cs.params({}))); } catch (e) { console.error('query failed:', e.message); process.exit(1); }

console.log('\n== Roll rates (all hunts) ==');
if (!s || !s.attacks) console.log('  (no attacks logged yet)');
else {
  console.log(`  attacks:     ${s.attacks}`);
  console.log(`  miss:        ${s.miss_pct}%   (target ~8)`);
  console.log(`  crit:        ${s.crit_pct}%   (target ~10, 20 on weak)`);
  console.log(`  block:       ${s.block_pct}%  (target ~12)`);
  console.log(`  weak-point:  ${s.weak_pct}%`);
  console.log(`  counter:     ${s.counter_pct}% (target ~30)`);
  console.log(`  downs:       ${s.downs}`);
  console.log(`  avg damage:  ${s.avg_damage}`);
  console.log(`  total dmg:   ${s.total_damage}`);
}

console.log('\n== Per-hunt fight length (newest first) ==');
if (!fights.length) console.log('  (no hunts yet)');
for (const f of fights) {
  const kill = f.status === 'defeated' ? `killed in ${f.minutes}m` : `${f.status} (${f.minutes}m elapsed)`;
  console.log(`  #${f.hunt_id} ${f.name} [${f.tier}] hp ${f.hp_max} — ${f.attacks} attacks, ${f.hunters} hunters — ${kill}`);
}
console.log('');
