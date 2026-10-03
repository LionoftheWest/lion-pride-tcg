import type { Client, MessageCreateOptions } from 'discord.js';
import { getSupabase } from './supabase.js';
import { announce } from './internal.js';
import { launchActivityRow } from './ui/launch.js';
import { AttachmentBuilder } from 'discord.js';
import { renderRaidBoard, renderSquadSummary } from './raid-cards.js';
import { buf, art } from './playing-posts.js';
import { botWork } from './bot-work.js';

// Poll the hunt_events outbox and post each event to the notifications channel. The game
// logic (SQL) writes events; the bot is the only process that can post to Discord, so it
// drains the outbox here. Posts are paced to stay under the channel rate limit.
const TICK_MS = 15_000;   // how often to drain the outbox
const BATCH = 8;          // max posts per tick (rate-limit safety)

const epoch = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

// A tag key -> its label, as the app shows it: 'trait:ranged' -> 'Ranged',
// 'genre:party-games' -> 'Party Games'.
export function tagText(v: string): string {
  return String(v).split(':').pop()!.split(/[-_ ]+/).filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

// Weak-point list -> a short readable string.
function weakText(weak: unknown): string {
  if (!Array.isArray(weak)) return 'nothing';
  return weak.map((w: { value?: string }) => w?.value).filter(Boolean).map((v) => tagText(v!)).join(', ') || 'nothing';
}

// Top contributors from a settle payload's paid array.
function topPaid(settle: { paid?: Array<{ player_id: string; packs: number }> } | null): string {
  const paid = settle?.paid ?? [];
  return [...paid].sort((a, b) => b.packs - a.packs).slice(0, 3)
    .map((p) => `<@${p.player_id}> (${p.packs})`).join(', ');
}

// The same prizes when the boss falls and when it escapes (settle_hunt, hunt_prizes_fixed.sql).
function prizeLine(s: { participants?: number; total_packs?: number }): string {
  return `${s.participants ?? 0} hunters earned **${s.total_packs ?? 0}** packs: 1st 7, 2nd 5, 3rd 4, 4th-10th 3, every other hunter 1.`;
}

// The top 3 players by total damage dealt to the boss, as ranked lines.
function topDamage(top: unknown): string {
  if (!Array.isArray(top) || !top.length) return '';
  const medals = ['🥇', '🥈', '🥉'];
  return top.slice(0, 3)
    .map((x: { player_id: string; damage: number }, i) => `${medals[i] || '•'} <@${x.player_id}> — **${Number(x.damage).toLocaleString()}**`)
    .join('\n');
}

function format(ev: { kind: string; payload: Record<string, unknown> }): string | null {
  const p = ev.payload || {};
  switch (ev.kind) {
    case 'spawn': {
      const when = p.closes_at ? ` Beat it by <t:${epoch(String(p.closes_at))}:F> (<t:${epoch(String(p.closes_at))}:R>).` : '';
      return `🦁 **${p.name} has appeared!**  [${p.tier}] — ${Number(p.hp).toLocaleString()} HP.\n`
        + `Weak to **${weakText(p.weak)}**.${when} Press **Open Lion Pride TCG** to join the hunt!`;
    }
    case 'nudge': {
      const when = p.closes_at ? `<t:${epoch(String(p.closes_at))}:R>` : 'soon';
      return `⏰ **${p.name}** still stands — ${Number(p.hp_remaining).toLocaleString()} / ${Number(p.hp_max).toLocaleString()} HP left.\n`
        + `The hunt closes ${when}. Rally the pride before it escapes!`;
    }
    case 'defeat': {
      const s = (p.settle ?? {}) as { participants?: number; total_packs?: number };
      const top = topDamage(p.top);
      return `🏆 **${p.name} has been DESTROYED!**  [${p.tier}]\n`
        + prizeLine(s)
        + (top ? `\n**Top 3 damage:**\n${top}` : '');
    }
    case 'expired': {
      const s = (p.settle ?? {}) as { participants?: number; total_packs?: number };
      const top = topDamage(p.top);
      return `💀 **${p.name} escaped.** The pride did not defeat it in time.\n`
        + prizeLine(s) + ' A new boss appears Thursday.'
        + (top ? `\n**Top 3 damage:**\n${top}` : '');
    }
    // No 'attack' case: Nathan's rule (2026-09-27) is one summary when a member
    // finishes the day's hunt (player_done), never a post per hit. hunt_attack can
    // still emit 'attack' if settings.hunt_attack_feed is not 'off'; drain() marks
    // those events posted without posting them.
    case 'player_done': {
      const top = p.top_card ? `\nTop card: **${p.top_card}** (${Number(p.top_damage).toLocaleString()})` : '';
      const bossHp = (p.boss_hp !== undefined && p.boss_hp !== null)
        ? `\nBoss HP left: **${Number(p.boss_hp).toLocaleString()}** / ${Number(p.boss_hp_max).toLocaleString()}`
        : '';
      return `🦁 <@${p.player_id}> finished the hunt for today!\n`
        + `Daily damage: **${Number(p.total).toLocaleString()}** across ${p.cards_used} card${Number(p.cards_used) === 1 ? '' : 's'}.${top}${bossHp}`;
    }
    case 'leaderboard': {
      const rows = Array.isArray(p.top) ? (p.top as Array<{ username?: string; damage?: number }>) : [];
      const medals = ['🥇', '🥈', '🥉'];
      const top = rows.slice(0, 3).map((r, i) => `${medals[i]} ${escapeMd(String(r.username ?? 'A hunter'))} (${Number(r.damage ?? 0).toLocaleString()})`).join('  ');
      return `📊 **Daily raid leaderboard** · ${p.name}\n${top || 'No hunters yet. Be the first!'}`;
    }
    default:
      return null;
  }
}

// Markdown out of a member name (the leaderboard names members without pinging them).
const escapeMd = (s: string): string => s.replace(/([*_~`|>\\])/g, '\\$1');

const epochLeft = (iso: string): string => {
  const s = Math.max(0, (new Date(iso).getTime() - Date.now()) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${m}m`;
};
const avatarUrl = (id: string, hash: string | null | undefined): string | null => (hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128` : null);

/** The picture for a raid post (Nathan, 2026-10-02): the daily leaderboard and the squad summary. */
export async function huntPicture(ev: { kind: string; hunt_id?: number; created_at?: string; payload: Record<string, unknown> }): Promise<Buffer | null> {
  const p = ev.payload ?? {};
  const sb = getSupabase();
  if (ev.kind === 'leaderboard') {
    const rows = Array.isArray(p.top) ? (p.top as Array<{ player_id: string; username?: string; damage?: number; avatar?: string | null }>) : [];
    const avatars = await Promise.all(rows.map((r) => buf(avatarUrl(r.player_id, r.avatar))));
    return renderRaidBoard({ boss: String(p.name ?? 'The boss'), tier: String(p.tier ?? ''), hpLeft: Number(p.hp_remaining ?? 0), hpMax: Number(p.hp_max ?? 0),
      closesIn: p.closes_at ? epochLeft(String(p.closes_at)) : '-', rows: rows.map((r, i) => ({ name: String(r.username ?? 'A hunter'), damage: Number(r.damage ?? 0), avatar: avatars[i] ?? null })) });
  }
  if (ev.kind === 'player_done') {
    const id = String(p.player_id ?? '');
    const day = new Date(ev.created_at ?? Date.now()).toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
    const [{ data: pl }, { data: hunt }, { data: hits }] = await Promise.all([
      sb.from('players').select('username, avatar').eq('id', id).maybeSingle(),
      sb.from('hunts').select('name').eq('id', ev.hunt_id ?? 0).maybeSingle(),
      sb.from('hunt_hits').select('damage, card_id').eq('hunt_id', ev.hunt_id ?? 0).eq('player_id', id).eq('hit_date', day).order('damage', { ascending: false }).limit(1),
    ]);
    // hunt_hits has no link to cards: the card in a second lookup.
    const hit = (hits?.[0] as { damage?: number; card_id?: number } | undefined) ?? null;
    const { data: card } = hit?.card_id ? await sb.from('cards').select('name, rarity, image_url').eq('id', hit.card_id).maybeSingle() : { data: null };
    const top = hit ? { damage: hit.damage, card: (card ?? undefined) as { name?: string; rarity?: string; image_url?: string } | undefined } : null;
    const [avatar, topArt] = await Promise.all([buf(avatarUrl(id, (pl as { avatar?: string } | null)?.avatar)), art(top?.card?.image_url ?? null)]);
    return renderSquadSummary({ name: String((pl as { username?: string } | null)?.username ?? 'A hunter'), avatar, total: Number(p.total ?? 0), cards: Number(p.cards_used ?? 0),
      topCard: top?.card?.name ?? (p.top_card ? String(p.top_card) : null), topDamage: Number(top?.damage ?? p.top_damage ?? 0), topArt, topRarity: top?.card?.rarity ?? null,
      boss: String((hunt as { name?: string } | null)?.name ?? 'The boss'), hpLeft: Number(p.boss_hp ?? 0), hpMax: Number(p.boss_hp_max ?? 0) });
  }
  return null;
}

/** A raid post: the event text plus the button that opens the Activity (every kind). */
export function huntPost(ev: { kind: string; payload: Record<string, unknown> }): MessageCreateOptions | null {
  const content = format(ev);
  return content ? { content, components: [launchActivityRow()] } : null;
}

let running = false;
async function drain(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!(await botWork()).events) return; // no unposted event (bot_work.sql)
    const supabase = getSupabase();
    const { data: events } = await supabase
      .from('hunt_events')
      .select('id, kind, payload, hunt_id, created_at')
      .is('posted_at', null)
      .order('id', { ascending: true })
      .limit(BATCH);
    for (const ev of events ?? []) {
      const post = huntPost(ev as never);
      if (post) {
        // The leaderboard and the squad summary carry a picture (a failed picture still posts the text).
        const png = await huntPicture(ev as never).catch((e) => { console.error('hunt picture:', e); return null; });
        if (png) post.files = [new AttachmentBuilder(png, { name: ev.kind === 'leaderboard' ? 'raid-leaderboard.png' : 'squad-summary.png' })];
        await announce(client, post, ev.kind === 'leaderboard' ? undefined : 'raid');
      }
      await supabase.from('hunt_events').update({ posted_at: new Date().toISOString() }).eq('id', ev.id);
      await new Promise((r) => setTimeout(r, 1200)); // pace posts under the channel rate limit
    }
  } catch (error) {
    console.error('hunt-notify drain error:', error);
  } finally {
    running = false;
  }
}

export function startHuntNotifier(client: Client): void {
  setInterval(() => { void drain(client); }, TICK_MS);
  console.log('Hunt notifier started (outbox poll every 15s).');
}
