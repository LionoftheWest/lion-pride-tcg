/**
 * Remove ALL scratch data created by the open-path stress test (ids beginning
 * lt_open_). Deletes children before parents. Run ON THE VM.
 *
 * Run:  node --env-file=/home/ubuntu/activity/.env tools/cleanup_scratch.mjs
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const PREFIX = 'lt_open_';

async function wipe(table, col) {
  const { error, count } = await supabase.from(table).delete({ count: 'exact' }).like(col, `${PREFIX}%`);
  if (error) console.log(`  ${table}: ERROR ${error.message}`);
  else console.log(`  ${table}: deleted ${count ?? '?'}`);
}

// Child tables first (FK to players), then players.
for (const [t, c] of [
  ['player_cards', 'player_id'],
  ['pack_ledger', 'player_id'],
  ['daily_activity', 'player_id'],
  ['notifications', 'player_id'],
  ['trade_offers', 'from_id'],
  ['players', 'id'],
]) {
  await wipe(t, c); // some tables may not exist / not have the column — reported, not fatal
}
console.log('cleanup done');
