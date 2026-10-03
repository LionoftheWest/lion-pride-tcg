import { AttachmentBuilder, type Client, type MessageCreateOptions } from 'discord.js';
import { getSupabase } from './supabase.js';
import { announce } from './internal.js';
import { art, buf } from './playing-posts.js';
import { renderAuction, type AuctionInput } from './post-pictures.js';
import { launchActivityRow } from './ui/launch.js';
import { RARITY } from './playing-card.js';
import { botWork } from './bot-work.js';

// Auction posts (Nathan, 2026-10-02): a picture when an auction starts and when it ends, in
// #tcg-notifications. The bot reads the auctions table every minute (an auction ends in the SQL
// expiry job too, so the Activity cannot post the end). hall_auctions.sql columns:
// - notice_message_id: null = no start post yet; set after the start post ('skip' = none).
// - notice_dirty: the SQL sets it on every change; an ended auction with notice_dirty posts the end.
// Flag: FEATURE_AUCTION_POSTS=1 (default OFF). An auction older than START_WINDOW_MS gets no start
// post (a test auction made while the flag was off).
export const auctionPostsEnabled = (): boolean => process.env.FEATURE_AUCTION_POSTS === '1';
const TICK_MS = 60_000;
export const START_WINDOW_MS = 60 * 60 * 1000;

type Row = { id: number; seller_id: string; card_id: number; min_rarity: string | null; min_count: number; min_cards: number[]; min_mode: string;
  status: string; accepted_bid_id: number | null; created_at: string; ends_at: string; settled_at: string | null; notice_message_id: string | null; notice_dirty: boolean };
const FINAL = new Set(['sold', 'closed', 'expired']);

/** What a row needs now: a start post, an end post, a skip mark, or nothing. */
export function nextPost(a: Pick<Row, 'status' | 'created_at' | 'settled_at' | 'notice_message_id' | 'notice_dirty'>, now = Date.now()): 'start' | 'end' | 'skip' | 'skip-end' | null {
  if (FINAL.has(a.status)) {
    if (!a.notice_dirty) return null;
    return now - new Date(a.settled_at || a.created_at).getTime() <= START_WINDOW_MS ? 'end' : 'skip-end';
  }
  if (a.notice_message_id) return null;
  return now - new Date(a.created_at).getTime() <= START_WINDOW_MS ? 'start' : 'skip';
}

const label = (r: string | null | undefined): string => (r && RARITY[r]?.label) || String(r || '');
/** The minimum as one line: "2x Full Art + Coral Siren", "Any bid". */
export function minLine(a: Pick<Row, 'min_rarity' | 'min_count' | 'min_mode'>, cardNames: string[]): string {
  const parts: string[] = [];
  if (a.min_count > 0 && a.min_rarity) parts.push(`${a.min_count}× ${label(a.min_rarity)}`);
  parts.push(...cardNames);
  return parts.length ? parts.join(a.min_mode === 'or' ? ' or ' : ' + ') : 'Any bid';
}
export function leftText(iso: string, now = Date.now()): string {
  const s = Math.max(0, (new Date(iso).getTime() - now) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
const avatarUrl = (id: string, hash: string | null | undefined): string | null => (hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=256` : null);

async function post(client: Client, a: Row, phase: 'start' | 'end'): Promise<boolean> {
  const sb = getSupabase();
  const won = phase === 'end' && a.status === 'sold' && a.accepted_bid_id
    ? ((await sb.from('auction_bids').select('bidder_id, cards').eq('id', a.accepted_bid_id).maybeSingle()).data as { bidder_id: string; cards: number[] } | null) : null;
  const { count: bidCount } = await sb.from('auction_bids').select('id', { count: 'exact', head: true }).eq('auction_id', a.id);
  const ids = [a.card_id, ...(a.min_cards || []), ...(won?.cards || [])];
  const [{ data: cards }, { data: players }] = await Promise.all([
    sb.from('cards').select('id, name, rarity, image_url').in('id', ids),
    sb.from('players').select('id, username, avatar').in('id', [a.seller_id, won?.bidder_id].filter(Boolean) as string[]),
  ]);
  const cd = new Map(((cards ?? []) as { id: number; name: string; rarity: string; image_url: string | null }[]).map((c) => [c.id, c]));
  const pl = new Map(((players ?? []) as { id: string; username?: string; avatar?: string | null }[]).map((p) => [String(p.id), p]));
  const c = cd.get(a.card_id); if (!c) return false;
  const s = pl.get(String(a.seller_id)), w = won ? pl.get(String(won.bidder_id)) : undefined;
  const wonCards = (won?.cards || []).map((x) => cd.get(x)).filter((x): x is NonNullable<typeof x> => !!x);
  const [sa, cardArt, wa, ...wArts] = await Promise.all([buf(avatarUrl(a.seller_id, s?.avatar)), art(c.image_url), w && won ? buf(avatarUrl(won.bidder_id, w.avatar)) : Promise.resolve(null), ...wonCards.map((x) => art(x.image_url))]);
  const input: AuctionInput = { phase, seller: s?.username || 'A member', sellerAvatar: sa, card: { name: c.name, rarity: c.rarity, art: cardArt },
    min: minLine(a, (a.min_cards || []).map((x) => cd.get(x)?.name).filter(Boolean) as string[]), endsIn: leftText(a.ends_at), bids: bidCount ?? 0,
    result: phase === 'end' ? { kind: a.status as 'sold' | 'closed' | 'expired', winner: w?.username, winnerAvatar: wa, cards: wonCards.map((x, i) => ({ name: x.name, rarity: x.rarity, art: wArts[i] ?? null })) } : undefined };
  const seller = `**${s?.username || 'A member'}**`;
  const content = phase === 'start'
    ? `🔨 ${seller} put **${c.name}** up for auction! Bid in the Trading Hall. Ends in ${input.endsIn}.`
    : a.status === 'sold' ? `🔨 ${seller}'s auction for **${c.name}** is sold to **${w?.username || 'a member'}**!`
      : `🔨 ${seller}'s auction for **${c.name}** ended with no sale.`;
  const msg: MessageCreateOptions = { content, components: [launchActivityRow()] };
  try { msg.files = [new AttachmentBuilder(await renderAuction(input), { name: phase === 'start' ? 'auction.png' : 'auction-end.png' })]; }
  catch (e) { console.error('auction picture:', e); } // the text still posts
  return announce(client, msg); // names, no pings
}

let running = false;
async function tick(client: Client): Promise<void> {
  if (running || !auctionPostsEnabled()) return;
  running = true;
  try {
    if (!(await botWork()).auctions) return; // no auction post due (bot_work.sql)
    const sb = getSupabase();
    const { data, error } = await sb.from('auctions')
      .select('id, seller_id, card_id, min_rarity, min_count, min_cards, min_mode, status, accepted_bid_id, created_at, ends_at, settled_at, notice_message_id, notice_dirty')
      .or('notice_message_id.is.null,and(status.in.(sold,closed,expired),notice_dirty.eq.true)').order('id').limit(20);
    if (error) throw new Error(error.message);
    for (const a of (data ?? []) as Row[]) {
      const what = nextPost(a);
      if (!what) continue;
      if (what === 'skip') { await sb.from('auctions').update({ notice_message_id: 'skip' }).eq('id', a.id); continue; }
      if (what === 'skip-end') { await sb.from('auctions').update({ notice_dirty: false, notice_message_id: a.notice_message_id || 'skip' }).eq('id', a.id); continue; }
      const ok = await post(client, a, what);
      // A failed post is not retried in a loop: the row is marked either way (one try per change).
      const patch = what === 'start' ? { notice_message_id: ok ? 'posted' : 'failed', notice_dirty: false, notice_at: new Date().toISOString() }
        : { notice_dirty: false, notice_message_id: a.notice_message_id || 'ended', notice_at: new Date().toISOString() };
      await sb.from('auctions').update(patch).eq('id', a.id);
      await new Promise((r) => setTimeout(r, 1200));
    }
  } catch (e) {
    console.error('auction-posts:', e);
  } finally {
    running = false;
  }
}

export function startAuctionPosts(client: Client): void {
  setInterval(() => { void tick(client); }, TICK_MS);
}
