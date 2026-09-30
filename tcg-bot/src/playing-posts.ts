import { AttachmentBuilder, escapeMarkdown, type Client } from 'discord.js';
import { getSupabase } from './supabase.js';
import { renderPlayingCard, RARITY } from './playing-card.js';
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

// What the member does now (the Activity sends it on each status change): the banner
// follows it. An activity older than ACTIVITY_TTL_MS falls back to "is playing".
export type Activity = { kind: 'opening' | 'fighting' | 'playing' | 'trading' | 'idle'; cards?: number[]; label?: string; image?: string };
const ACTIVITY_TTL_MS = 180_000;
const KINDS = new Set(['opening', 'fighting', 'playing', 'trading', 'idle']);
/** Allow-list the activity from the Activity server (the bot trusts nothing else). */
export function cleanActivity(a: unknown): (Activity & { at: number }) | null {
  if (!a || typeof a !== 'object') return null;
  const x = a as Record<string, unknown>;
  if (!KINDS.has(String(x.kind))) return null;
  const out: Activity & { at: number } = { kind: x.kind as Activity['kind'], at: Date.now() };
  if (Array.isArray(x.cards)) out.cards = x.cards.filter((v): v is number => Number.isInteger(v) && (v as number) > 0).slice(0, 5);
  if (typeof x.label === 'string' && x.label.trim()) out.label = x.label.trim().slice(0, 24);
  if (typeof x.image === 'string' && /^boss\/thumbs\/[a-z0-9_]+\.png$/.test(x.image)) out.image = x.image;
  return out;
}

type Job = { name: string; playing: boolean; lastAt: number; lastKey: string; timer: NodeJS.Timeout | null; endTimer: NodeJS.Timeout | null;
  activity: (Activity & { at: number }) | null; id: string };
const jobs = new Map<string, Job>();
let chain: Promise<void> = Promise.resolve(); // one Discord write at a time

const utcDay = (): string => new Date().toISOString().slice(0, 10);

/** Handle one event from the Activity. Returns false when the flag is off. */
export function onPlaying(client: Client, id: string, name: string, event: PlayingEvent, activity?: unknown): boolean {
  if (!playingPostsEnabled() || !/^\d{17,20}$/.test(id)) return false;
  let j = jobs.get(id);
  if (!j) { j = { id, name: name || 'A member', playing: false, lastAt: 0, lastKey: '', timer: null, endTimer: null, activity: null }; jobs.set(id, j); }
  if (name) j.name = name.slice(0, 40);
  const act = cleanActivity(activity);
  if (act) j.activity = act;
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

// The banner's right side and line for what the member does now (Nathan, 2026-09-30):
// opening packs -> the best card just pulled; fighting -> the boss; a prank or boon -> the
// card played (the kind comes from card_plays, not from the app); trading -> the card
// offered; else (or older than 3 minutes) -> the best pull of the day.
type Scene = { line: string; tag: string; color: string; url: string | null; pick: string };
type CardRow = { id: number; name: string; rarity: string; image_url: string | null };
const rarityColor = (r: string): string => (RARITY[r] ?? RARITY.normal!).color;
async function cardsById(ids: number[]): Promise<CardRow[]> {
  if (!ids.length) return [];
  const { data } = await getSupabase().from('cards').select('id, name, rarity, image_url').in('id', ids);
  return (data ?? []) as CardRow[];
}
async function sceneFor(j: Job, t: Today): Promise<Scene> {
  const best: Scene = t.best
    ? { line: 'is playing', tag: 'BEST PULL TODAY', color: rarityColor(String(t.best.rarity)), url: t.best.image_url, pick: `best:${t.best.id}` }
    : { line: 'is playing', tag: 'NO PULLS YET TODAY', color: '#2a2c3a', url: null, pick: 'none' };
  if (!j.playing) return { ...best, line: 'was playing' };
  const a = j.activity && Date.now() - j.activity.at < ACTIVITY_TTL_MS ? j.activity : null;
  if (!a || a.kind === 'idle') return best;
  const who = a.label ?? 'someone';
  if (a.kind === 'fighting') {
    const supa = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const url = a.image && supa ? `${supa}/storage/v1/object/public/card-art/${a.image}` : null;
    return url ? { line: `is fighting ${who}`, tag: 'RAID BOSS', color: '#FF6B7D', url, pick: `boss:${a.image}:${who}` } : { ...best, line: `is fighting ${who}` };
  }
  const cards = await cardsById(a.cards ?? []);
  if (a.kind === 'opening') {
    const top = cards.sort((x, y) => (RARITY[y.rarity]?.rank ?? 0) - (RARITY[x.rarity]?.rank ?? 0))[0];
    return top ? { line: 'is opening packs', tag: 'JUST PULLED', color: rarityColor(top.rarity), url: top.image_url, pick: `pull:${top.id}` } : { ...best, line: 'is opening packs' };
  }
  if (a.kind === 'trading') {
    const c = cards.find((x) => x.id === a.cards?.[0]);
    return c ? { line: `is trading with ${who}`, tag: 'TRADE OFFER', color: '#3ECF8E', url: c.image_url, pick: `trade:${c.id}:${who}` } : { ...best, line: `is trading with ${who}` };
  }
  // A card play: prank / boon / neutral from the real play row (the last 3 minutes).
  const c = cards.find((x) => x.id === a.cards?.[0]);
  const { data: play } = await getSupabase().from('card_plays').select('kind, created_at').eq('player_id', j.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  const kind = play && Date.now() - new Date(play.created_at as string).getTime() < ACTIVITY_TTL_MS ? String(play.kind) : 'neutral';
  const [line, tag, color] = kind === 'prank' ? [`is pranking ${who}`, 'PRANK CARD', '#B18CFF']
    : kind === 'boon' ? [`is boosting ${who}`, 'BOON CARD', '#F4B73C'] : [`is playing a card on ${who}`, 'CARD PLAYED', '#4DA3FF'];
  return c ? { line, tag, color, url: c.image_url, pick: `play:${c.id}:${who}:${kind}` } : { ...best, line };
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
  const scene = await sceneFor(j, t);
  // Only what the picture shows: the name, the avatar, the line, the tag and the picture.
  const key = JSON.stringify([day, j.name, t.avatar, scene.line, scene.tag, scene.pick]);
  if (row && key === j.lastKey) return; // nothing changed since the last post
  const [avatar, frameArt] = await Promise.all([
    buf(t.avatar ? `https://cdn.discordapp.com/avatars/${id}/${t.avatar}.png?size=256` : null),
    scene.url ? art(scene.url) : Promise.resolve(null),
  ]);
  const png = await renderPlayingCard({
    name: j.name, line: scene.line, live: j.playing, avatar, tag: scene.tag,
    frame: scene.url ? { art: frameArt, color: scene.color } : null,
  });
  const body = {
    content: `🦁 **${escapeMarkdown(j.name)}** ${scene.line}`,
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
