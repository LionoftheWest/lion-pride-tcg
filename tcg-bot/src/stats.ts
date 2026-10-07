import 'dotenv/config';
import { getSupabase } from './supabase.js';
import { utcToday } from './store.js';

// A quick read of the live game state, for debugging.
//   npm run stats

const supabase = getSupabase();
// The game day (Mountain Time, the same day record_activity writes). It was the UTC day: after 6 PM MT
// (5 PM in winter) this read the next day's rows, so it showed no activity.
const today = utcToday();

const cards = await supabase.from('cards').select('*', { count: 'exact', head: true });
const players = await supabase.from('players').select('*', { count: 'exact', head: true });
const activity = await supabase
  .from('daily_activity')
  .select('player_id, message_count, base_claimed, bonus_claimed')
  .eq('activity_date', today);

console.log(`game day (MT): ${today}`);
console.log(`cards in catalog: ${cards.count}`);
console.log(`players known: ${players.count}`);
console.log('today activity rows:', JSON.stringify(activity.data, null, 2));
