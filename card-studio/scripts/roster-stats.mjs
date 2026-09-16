/**
 * Print the community roster power and the boss it produces. This is the number that
 * scales the raid boss (see hunt_hp_roster_power.sql). Watch it grow as the community
 * collects and ascends cards. Reads roster_stats() + roster_top_players() live.
 *   node scripts/roster-stats.mjs [snapshot]
 * Pass "snapshot" to also record one roster_power_history row (do this at each spawn).
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

const [{ s }] = await q('select roster_stats() as s');
console.log('\n== Community roster power ==');
console.log(`  players:            ${s.players}`);
console.log(`  card owners:        ${s.owners}`);
console.log(`  owned cards:        ${s.owned_cards}`);
console.log(`  TOTAL ROSTER POWER: ${Number(s.total_power).toLocaleString()}`);
console.log(`  avg power / owner:  ${s.avg_power_owner}`);
console.log('\n== Projected boss HP (next spawn, per tier) ==');
console.log(`  Normal: ${Number(s.boss_hp.Normal).toLocaleString()}`);
console.log(`  Heroic: ${Number(s.boss_hp.Heroic).toLocaleString()}`);
console.log(`  Mythic: ${Number(s.boss_hp.Mythic).toLocaleString()}`);
console.log('\n== Cards by rarity ==');
for (const [k, v] of Object.entries(s.by_rarity || {})) console.log(`  ${k.padEnd(18)} ${v}`);
console.log('== Cards by ascension ==');
for (const [k, v] of Object.entries(s.by_ascension || {})) console.log(`  ${k}★ ${v}`);

const top = await q('select * from roster_top_players(15)');
console.log('\n== Strongest rosters ==');
if (!top.length) console.log('  (no owned cards yet)');
for (const p of top) {
  console.log(`  ${(p.username || p.player_id).padEnd(22)} power ${Number(p.total_power).toLocaleString().padStart(8)}  (${p.owned_cards} cards, best ${p.best_card})`);
}

if (process.argv[2] === 'snapshot') {
  const [{ roster_snapshot: id }] = await q('select roster_snapshot()');
  console.log(`\nRecorded history row #${id}.`);
}

const hist = await q('select captured_at, players, total_power, boss_hp_mythic from roster_power_history order by id desc limit 8');
if (hist.length) {
  console.log('\n== Roster power over time (newest first) ==');
  for (const h of hist) {
    const d = new Date(h.captured_at).toISOString().slice(0, 10);
    console.log(`  ${d}  players ${String(h.players).padStart(4)}  power ${Number(h.total_power).toLocaleString().padStart(9)}  Mythic HP ${Number(h.boss_hp_mythic).toLocaleString()}`);
  }
}
console.log('');
