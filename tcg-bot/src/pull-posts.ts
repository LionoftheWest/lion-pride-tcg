import { AttachmentBuilder, escapeMarkdown, type Client, type MessageCreateOptions } from 'discord.js';
import { getSupabase } from './supabase.js';
import { announce } from './internal.js';
import { art, buf } from './playing-posts.js';
import { renderRarePull } from './post-pictures.js';
import { RARITY } from './playing-card.js';
import { launchActivityRow } from './ui/launch.js';

// The rare pull post (Nathan, 2026-10-02): a Full Art or a Gold pull gets a post with a picture in
// #tcg-notifications. ONE post per open action (a 10-pack open with 2 rare cards = 1 post). It
// pings the member (their "packs" ping setting applies). Flag: FEATURE_PULL_POSTS=1 (default OFF).
export const pullPostsEnabled = (): boolean => process.env.FEATURE_PULL_POSTS === '1';
export const RARE_POST = new Set(['full_art', 'gold']);

type PullCard = { name: string; rarity: string; image_url: string | null };

/** The Full Art + Gold cards of one open action, the rarest first. */
export function rarePulls(packs: PullCard[][]): PullCard[] {
  // The one rarity order (RARITY.rank = SQL rarity_rank, both pinned to shared/rarity-rank.json).
  const rank = (r: string): number => RARITY[r]?.rank ?? 0;
  return packs.flat().filter((c) => RARE_POST.has(c.rarity)).sort((a, b) => rank(b.rarity) - rank(a.rarity));
}

/** The post text: the member is pinged, the cards are named. photobomb = the sender of a Photobomb
 *  used up on this open (Pull Photobomb, SPEC-outside-effects.md). */
export function pullPostText(id: string, cards: PullCard[], photobomb: string | null = null): string {
  const gold = cards.some((c) => c.rarity === 'gold');
  const names = cards.map((c) => `**${c.name}**`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  const bomb = photobomb ? `\n📸 photobombed by ${escapeMarkdown(photobomb)}` : '';
  return `${gold ? '🌟 **GOLD PULL!**' : '✨ **FULL ART PULL!**'} <@${id}> just pulled ${list}!${bomb}`;
}

/** A Photobomb counts for the rare pull post when it was used up at most this long ago. */
export const PHOTOBOMB_MS = 10 * 60_000;

/** The username of the member whose Photobomb was used up on this member in the last 10 minutes, else null.
 *  One small query (plus the sender's name), only when a rare pull is posted. */
export async function photobomber(sb: ReturnType<typeof getSupabase>, id: string, nowMs: number = Date.now()): Promise<string | null> {
  const { data } = await sb.from('player_effects').select('consumed_at, options').eq('player_id', id).eq('primitive', 'photobomb')
    .gte('consumed_at', new Date(nowMs - PHOTOBOMB_MS).toISOString()).order('consumed_at', { ascending: false }).limit(1).maybeSingle();
  const row = data as { consumed_at?: string | null; options?: Record<string, unknown> | null } | null;
  const at = row?.consumed_at ? new Date(row.consumed_at).getTime() : NaN;
  if (!(nowMs - at <= PHOTOBOMB_MS)) return null; // none, or too old (NaN fails too)
  const sender = String(row?.options?.sender_id ?? '');
  if (!sender) return null;
  const { data: p } = await sb.from('players').select('username').eq('id', sender).maybeSingle();
  return (p as { username?: string } | null)?.username || 'someone';
}

/** The outside world of the post (the tests swap in fakes). */
export const pullDeps = { store: () => getSupabase(), announce };

const avatarUrl = (id: string, hash: string | null | undefined): string | null => (hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=256` : null);

/** The cards to post for one open action: none when the flag is off or no card is rare. */
export function cardsToPost(packs: PullCard[][]): PullCard[] {
  return pullPostsEnabled() ? rarePulls(packs) : [];
}

/** Post the rare pulls of one open action (no post when there is none). Never throws. */
export async function postRarePulls(client: Client, id: string, name: string, packs: PullCard[][]): Promise<boolean> {
  const cards = cardsToPost(packs);
  if (!cards.length) return false;
  try {
    const sb = pullDeps.store();
    const [{ data: pl }, bomb] = await Promise.all([
      sb.from('players').select('username, avatar').eq('id', id).maybeSingle(),
      photobomber(sb, id).catch((e) => { console.error('photobomb line:', e); return null; }), // the post still goes
    ]);
    const p = pl as { username?: string; avatar?: string | null } | null;
    const shown = cards.slice(0, 3);
    const [avatar, ...arts] = await Promise.all([buf(avatarUrl(id, p?.avatar)), ...shown.map((c) => art(c.image_url))]);
    const msg: MessageCreateOptions = { content: pullPostText(id, cards, bomb), components: [launchActivityRow()] };
    try {
      const png = await renderRarePull({ name: p?.username || name || 'A member', avatar, cards: shown.map((c, i) => ({ name: c.name, rarity: c.rarity, art: arts[i] ?? null })) });
      msg.files = [new AttachmentBuilder(png, { name: 'rare-pull.png' })];
    } catch (e) { console.error('rare pull picture:', e); } // the text still posts
    return await pullDeps.announce(client, msg, 'packs');
  } catch (e) {
    console.error('rare pull post:', e);
    return false;
  }
}

