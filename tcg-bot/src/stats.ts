import 'dotenv/config';
import { getSupabase } from './supabase.js';

// A quick read of the live game state, for debugging.
//   npm run stats

const supabase = getSupabase();
const today = new Date().toISOString().slice(0, 10);

const cards = await supabase.from('cards').select('*', { count: 'exact', head: true });
const players = await supabase.from('players').select('*', { count: 'exact', head: true });
const activity = await supabase
  .from('daily_activity')
  .select('player_id, message_count, base_claimed, bonus_claimed')
  .eq('activity_date', today);

console.log(`UTC day: ${today}`);
console.log(`cards in catalog: ${cards.count}`);
console.log(`players known: ${players.count}`);
console.log('today activity rows:', JSON.stringify(activity.data, null, 2));
