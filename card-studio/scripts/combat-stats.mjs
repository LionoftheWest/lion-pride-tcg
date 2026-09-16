/**
 * Print Pride Hunt combat telemetry for balance tuning.
 *   node scripts/combat-stats.mjs
 * Roll rates (miss/crit/block/weak/counter, downs, avg damage) + per-hunt fight length
 * (attacks, hunters, minutes-to-kill). Reads hunt_combat_log via the Management API.
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || '';
const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (!token || !ref) { console.error('Missing SUPABASE_ACCESS_TOKEN / SUPABASE_URL in .env'); process.exit(1); }

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`query failed ${r.status}:`, JSON.stringify(j)); process.exit(1); }
  return j;
}

const [{ s }] = await q('select hunt_combat_stats() as s');
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

const fights = await q('select * from hunt_fight_summary() limit 15');
console.log('\n== Per-hunt fight length (newest first) ==');
if (!fights.length) console.log('  (no hunts yet)');
for (const f of fights) {
  const kill = f.status === 'defeated' ? `killed in ${f.minutes}m` : `${f.status} (${f.minutes}m elapsed)`;
  console.log(`  #${f.hunt_id} ${f.name} [${f.tier}] hp ${f.hp_max} — ${f.attacks} attacks, ${f.hunters} hunters — ${kill}`);
}
console.log('');
