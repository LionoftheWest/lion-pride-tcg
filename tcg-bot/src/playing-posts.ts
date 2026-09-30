import { AttachmentBuilder, escapeMarkdown, type Client } from 'discord.js';
import { getSupabase } from './supabase.js';
import { renderPlayingCard } from './playing-card.js';
import { launchActivityRow } from './ui/launch.js';

// The "is playing" post (design 20, option B, Nathan 2026-09-30). The Activity tells the bot
// when a member starts, does something, and leaves (/playing). ONE post per member per UTC
// day in #tcg-notifications, edited in place: at most once a minute and only on a change,
// "was playing" 2 minutes after they leave. It names the member but pings nobody. A member
// turns it off in the bell > Settings (notify_prefs.playing = false).
// Flag: FEATURE_PLAYING_POSTS=1 (default OFF).
export const playingPostsEnabled = (): boolean => process.env.FEATURE_PLAYING_POSTS === '1';
export type PlayingEvent = 'start' | 'update' | 'end';

const MIN_GAP_MS = 60_000;
const DEBOUNCE_MS = 8_000;
const END_GRACE_MS = 120_000;
const NOTIF_CHANNEL = (): string => process.env.NOTIF_CHANNEL_ID ?? '';
const ACTIVITY = (): string => (process.env.ACTIVITY_INTERNAL_URL || 'http://127.0.0.1:4441').replace(/\/+$/, '');

type Job = { name: string; playing: boolean; lastAt: number; lastKey: string; timer: NodeJS.Timeout | null; endTimer: NodeJS.Timeout | null };
const jobs = new Map<string, Job>();
let chain: Promise<void> = Promise.resolve(); // one Discord write at a time

const utcDay = (): string => new Date().toISOString().slice(0, 10);

/** Handle one event from the Activity. Returns false when the flag is off. */
export function onPlaying(client: Client, id: string, name: string, event: PlayingEvent): boolean {
  if (!playingPostsEnabled() || !/^\d{17,20}$/.test(id)) return false;
  let j = jobs.get(id);
  if (!j) { j = { name: name || 'A member', playing: false, lastAt: 0, lastKey: '', timer: null, endTimer: null }; jobs.set(id, j); }
  if (name) j.name = name.slice(0, 40);
  if (event === 'end') {
    if (j.endTimer) clearTimeout(j.endTimer);
    j.endTimer = setTimeout(() => { j!.endTimer = null; j!.playing = false; schedule(client, id, 0); }, END_GRACE_MS);
    return true;
  }
  if (j.endTimer) { clearTimeout(j.endTimer); j.endTimer = null; }
  const fresh = !j.playing;
  j.playing = true;
  schedule(client, id, fresh ? 0 : DEBOUNCE_MS);
  return true;
}

function schedule(client: Client, id: string, delay: number): void {
  const j = jobs.get(id);
  if (!j || j.timer) return;
  const wait = Math.max(delay, j.lastAt + MIN_GAP_MS - Date.now(), 0);
  j.timer = setTimeout(() => {
    j.timer = null;
    chain = chain.then(() => render(client, id)).catch((e) => console.error('playing-posts:', e));
  }, wait);
}

async function buf(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch { return null; }
}
// Card art through the Activity's image cache (no new Supabase egress), else direct.
async function art(imageUrl: string | null): Promise<Buffer | null> {
  if (!imageUrl) return null;
  const supa = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const cached = supa && imageUrl.startsWith(supa) ? `${ACTIVITY()}/api/img/${imageUrl.slice(supa.length + 1)}` : null;
  return (cached && (await buf(cached))) || buf(imageUrl);
}

type Today = { name?: string; avatar?: string | null; playing_pref?: string; packs?: number; damage?: number;
  best?: { id: number; name: string; rarity: string; image_url: string | null } | null };

async function render(client: Client, id: string): Promise<void> {
  const j = jobs.get(id);
  if (!j || !playingPostsEnabled() || !NOTIF_CHANNEL()) return;
  const sb = getSupabase();
  const { data, error } = await sb.rpc('playing_today', { p_player: id });
  if (error || !data) return;
  const t = data as Today;
  if (t.playing_pref === 'false') return;
  const day = utcDay();
  const { data: row } = await sb.from('playing_posts').select('message_id').eq('player_id', id).eq('day', day).maybeSingle();
  // Only what the picture shows (Nathan: just the card; no tier, name, packs or damage line).
  const key = JSON.stringify([day, j.playing, t.best?.id ?? null, j.name, t.avatar]);
  if (row && key === j.lastKey) return; // nothing changed since the last post
  const [avatar, cardArt] = await Promise.all([
    buf(t.avatar ? `https://cdn.discordapp.com/avatars/${id}/${t.avatar}.png?size=256` : null),
    art(t.best?.image_url ?? null),
  ]);
  const png = await renderPlayingCard({
    name: j.name, playing: j.playing, avatar,
    card: t.best ? { name: t.best.name, rarity: String(t.best.rarity), art: cardArt } : null,
    packs: Number(t.packs) || 0, damage: Number(t.damage) || 0,
  });
  const body = {
    content: `🦁 **${escapeMarkdown(j.name)}** ${j.playing ? 'is playing' : 'was playing'}`,
    files: [new AttachmentBuilder(png, { name: 'playing.png' })],
    components: [launchActivityRow()],
    allowedMentions: { parse: [] as never[] },
  };
  const channel = await client.channels.fetch(NOTIF_CHANNEL());
  if (!channel || !channel.isTextBased() || !('send' in channel)) return;
  let messageId = row?.message_id as string | undefined;
  if (messageId) {
    try { const m = await channel.messages.fetch(messageId); await m.edit({ ...body, attachments: [] }); }
    catch { messageId = undefined; } // deleted: post a new one
  }
  if (!messageId) {
    const m = await channel.send(body);
    await sb.from('playing_posts').upsert({ player_id: id, day, message_id: m.id, updated_at: new Date().toISOString() }, { onConflict: 'player_id,day' });
  } else {
    await sb.from('playing_posts').update({ updated_at: new Date().toISOString() }).eq('player_id', id).eq('day', day);
  }
  j.lastAt = Date.now();
  j.lastKey = key;
}
