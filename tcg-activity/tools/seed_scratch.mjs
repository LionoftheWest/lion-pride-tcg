/**
 * Seed scratch players for the open-path stress test. Upserts N players with a
 * clear "zzz_loadtest_" marker and a pack balance, so open (spend_pack) has
 * something to spend. Run ON THE VM with the service key in the environment.
 *
 * Run:  node --env-file=/home/ubuntu/activity/.env tools/seed_scratch.mjs 40 15
 *       (40 players, 15 packs each)
 */
import { createClient } from '@supabase/supabase-js';

const N = Number(process.argv[2] || 40);
const BAL = Number(process.argv[3] || 15);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const rows = [];
for (let i = 0; i < N; i += 1) rows.push({ id: `lt_open_${String(i).padStart(4, '0')}`, username: `zzz_loadtest_${i}`, pack_balance: BAL });

const { error } = await supabase.from('players').upsert(rows, { onConflict: 'id' });
if (error) { console.error('seed failed:', error.message); process.exit(1); }
console.log(`seeded ${rows.length} scratch players with ${BAL} packs each (ids lt_open_0000..lt_open_${String(N - 1).padStart(4, '0')})`);
