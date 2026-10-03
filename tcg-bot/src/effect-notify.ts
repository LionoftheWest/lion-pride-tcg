import { AttachmentBuilder, type Client, type MessageCreateOptions } from 'discord.js';
import { getSupabase } from './supabase.js';
import { announce } from './internal.js';
import { launchActivityRow } from './ui/launch.js';
import { art, buf } from './playing-posts.js';
import { renderPlay } from './post-pictures.js';
import { botWork } from './bot-work.js';

// The play picture (Nathan, 2026-10-02): the sender, the card flying to the target, the effect and
// the outcome. Flag: FEATURE_PLAY_PICTURES=1 (default OFF; a failed picture still posts the text).
export const playPicturesEnabled = (): boolean => process.env.FEATURE_PLAY_PICTURES === '1';
/** The member the picture shows as the target: the new target of a redirect / a delayed play, else the one aimed at. */
export const shownTarget = (p: { outcome: string; target_id: string; aimed_at: string }): string =>
  (p.outcome === 'redirected' || p.outcome === 'delayed' ? p.target_id : p.aimed_at);
const avatarUrl = (id: string, hash: string | null | undefined): string | null => (hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=256` : null);
async function playPicture(row: { player_id: string; target_id: string; aimed_at: string; kind: string; outcome: string; card?: { name?: string; rarity?: string; image_url?: string | null } | null },
  effect: { name?: string; desc?: string } | null | undefined): Promise<Buffer | null> {
  const to = shownTarget(row);
  const { data } = await getSupabase().from('players').select('id, username, avatar').in('id', [row.player_id, to]);
  const by = new Map(((data ?? []) as { id: string; username?: string; avatar?: string | null }[]).map((p) => [String(p.id), p]));
  const s = by.get(String(row.player_id)), t = by.get(String(to));
  const [sa, ta, cardArt] = await Promise.all([buf(avatarUrl(row.player_id, s?.avatar)), buf(avatarUrl(to, t?.avatar)), art(row.card?.image_url ?? null)]);
  return renderPlay({ kind: row.kind, outcome: row.outcome, sender: s?.username || 'Someone', senderAvatar: sa, target: t?.username || 'a member', targetAvatar: ta,
    card: row.card?.name || 'a card', art: cardArt, rarity: row.card?.rarity ?? null, effectName: effect?.name ?? null, effectDesc: effect?.desc ?? null });
}

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
  primitive?: string | null;   // the effect type (hype gets its own line)
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
  // When the effect has the card's own name (Patooie! / Patooie!), name it once.
  const same = !!p.effect_name && !!p.card && p.effect_name.trim().toLowerCase() === p.card.trim().toLowerCase();
  const name = p.effect_name && !same ? `**${p.effect_name}**` : null;
  const desc = p.effect_desc ? ` ${p.effect_desc}` : '';
  let content: string;
  if (p.outcome === 'blocked') {
    content = `🛡️ ${who} played ${card} on <@${p.aimed_at}>... but it was blocked!`;
  } else if (p.outcome === 'reflected') {
    content = `🪞 ${who} played ${card} on <@${p.aimed_at}>... and it bounced back! ${who} got ${name ?? 'it'}.${desc}`;
  } else if (p.outcome === 'decoyed') {
    content = `🎯 ${who} played ${card} on <@${p.aimed_at}>... Direct hit! 🪧 On a cardboard cutout.`;
  } else if (p.outcome === 'redirected') {
    content = `🔀 ${who} played ${card} on <@${p.aimed_at}>... but it went to <@${p.target_id}>${name ? `: ${name}` : ''}!`;
  } else if (p.outcome === 'delayed') {
    content = `⏳ ${who} played ${card} on <@${p.target_id}>... it lands in 1 hour.`;
  } else if (p.primitive === 'hype') {
    content = `🔥🔥🔥 ${who} is HYPING <@${p.target_id}> with ${card}${name ? `: ${name}` : ''}! 🔥🔥🔥`;
  } else {
    content = `${KIND_EMOJI[p.kind] ?? '🎴'} ${who} played ${card} on <@${p.target_id}>${name ? `: ${name}.` : '.'}${desc}`;
  }
  return { content, components: [launchActivityRow()] };
}

let running = false;
async function drain(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!(await botWork()).plays) return; // no unposted play (bot_work.sql)
    const supabase = getSupabase();
    const { data: rows, error } = await supabase
      .from('card_plays')
      .select('id, player_id, target_id, aimed_at, kind, outcome, primitive, sender:players!card_plays_player_id_fkey(username), card:cards(name, rarity, image_url), subject:subjects(effect)')
      .is('posted_at', null)
      .order('id', { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);
    for (const r of (rows ?? []) as never[]) {
      const row = r as {
        id: number; player_id: string; target_id: string; aimed_at: string; kind: string; outcome: string; primitive?: string | null;
        sender?: { username?: string } | null; card?: { name?: string; rarity?: string; image_url?: string | null } | null;
        subject?: { effect?: { name?: string; desc?: string } | null } | null;
      };
      const post = effectPost({
        ...row,
        sender: row.sender?.username, card: row.card?.name,
        effect_name: row.subject?.effect?.name, effect_desc: row.subject?.effect?.desc,
      });
      if (playPicturesEnabled()) {
        const png = await playPicture(row, row.subject?.effect).catch((e) => { console.error('play picture:', e); return null; });
        if (png) post.files = [new AttachmentBuilder(png, { name: 'card-play.png' })];
      }
      await announce(client, post, 'plays');
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
