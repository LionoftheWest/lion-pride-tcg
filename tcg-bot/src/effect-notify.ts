import type { Client, MessageCreateOptions } from 'discord.js';
import { getSupabase } from './supabase.js';
import { announce } from './internal.js';
import { launchActivityRow } from './ui/launch.js';

// Every boon / prank / neutral play gets one post (Nathan, 2026-09-27), with the
// Open Lion Pride TCG button. play_card_effect() writes card_plays; the bot drains
// the rows whose posted_at is null, the same pattern as the hunt outbox.
// Flag: FEATURE_CARD_EFFECT_POSTS=1 (default OFF). It must stay off until
// card_effects.sql is applied, or the poll would query a missing table.
export const effectPostsEnabled = (): boolean => process.env.FEATURE_CARD_EFFECT_POSTS === '1';

const TICK_MS = 10_000;
const BATCH = 8;

export interface PlayRow {
  id: number;
  player_id: string;
  target_id: string;
  aimed_at: string;
  kind: 'boon' | 'prank' | 'neutral' | string;
  outcome: 'applied' | 'blocked' | 'reflected' | string;
  sender?: string | null;       // the sender's username
  card?: string | null;         // the card's name
  effect_name?: string | null;  // the card's effect name
  effect_desc?: string | null;  // the card's effect text
}

const KIND_EMOJI: Record<string, string> = { boon: '🎁', prank: '😈', neutral: '🌀' };

/** The post for one play: text + the button. */
export function effectPost(p: PlayRow): MessageCreateOptions {
  const who = `**${p.sender || 'Someone'}**`;
  const card = `**${p.card || 'a card'}**`;
  const name = p.effect_name ? `**${p.effect_name}**` : 'its effect';
  const desc = p.effect_desc ? ` ${p.effect_desc}` : '';
  let content: string;
  if (p.outcome === 'blocked') {
    content = `🛡️ ${who} played ${card} on <@${p.aimed_at}>... but it was blocked!`;
  } else if (p.outcome === 'reflected') {
    content = `🪞 ${who} played ${card} on <@${p.aimed_at}>... and it bounced back! ${who} got ${name}.${desc}`;
  } else {
    content = `${KIND_EMOJI[p.kind] ?? '🎴'} ${who} played ${card} on <@${p.target_id}>: ${name}.${desc}`;
  }
  return { content, components: [launchActivityRow()] };
}

let running = false;
async function drain(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    const supabase = getSupabase();
    const { data: rows, error } = await supabase
      .from('card_plays')
      .select('id, player_id, target_id, aimed_at, kind, outcome, sender:players!card_plays_player_id_fkey(username), card:cards(name), subject:subjects(effect)')
      .is('posted_at', null)
      .order('id', { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);
    for (const r of (rows ?? []) as never[]) {
      const row = r as {
        id: number; player_id: string; target_id: string; aimed_at: string; kind: string; outcome: string;
        sender?: { username?: string } | null; card?: { name?: string } | null;
        subject?: { effect?: { name?: string; desc?: string } | null } | null;
      };
      await announce(client, effectPost({
        ...row,
        sender: row.sender?.username, card: row.card?.name,
        effect_name: row.subject?.effect?.name, effect_desc: row.subject?.effect?.desc,
      }));
      await supabase.from('card_plays').update({ posted_at: new Date().toISOString() }).eq('id', row.id);
      await new Promise((res) => setTimeout(res, 1200)); // stay under the channel rate limit
    }
  } catch (error) {
    console.error('effect-notify drain error:', error);
  } finally {
    running = false;
  }
}

export function startEffectNotifier(client: Client): void {
  if (!effectPostsEnabled()) return;
  setInterval(() => { void drain(client); }, TICK_MS);
  console.log('Card effect notifier started (poll every 10s).');
}
