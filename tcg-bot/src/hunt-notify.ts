import type { Client } from 'discord.js';
import { getSupabase } from './supabase.js';
import { announce } from './internal.js';

// Poll the hunt_events outbox and post each event to the notifications channel. The game
// logic (SQL) writes events; the bot is the only process that can post to Discord, so it
// drains the outbox here. Posts are paced to stay under the channel rate limit.
const TICK_MS = 15_000;   // how often to drain the outbox
const BATCH = 8;          // max posts per tick (rate-limit safety)

const epoch = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

// Weak-point list -> a short readable string.
function weakText(weak: unknown): string {
  if (!Array.isArray(weak)) return 'nothing';
  return weak.map((w: { value?: string }) => w?.value).filter(Boolean).join(', ') || 'nothing';
}

// Top contributors from a settle payload's paid array.
function topPaid(settle: { paid?: Array<{ player_id: string; packs: number }> } | null): string {
  const paid = settle?.paid ?? [];
  return [...paid].sort((a, b) => b.packs - a.packs).slice(0, 3)
    .map((p) => `<@${p.player_id}> (${p.packs})`).join(', ');
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
      return `🦁 **A wild ${p.name} appeared!**  [${p.tier}] — ${Number(p.hp).toLocaleString()} HP.\n`
        + `Weak to **${weakText(p.weak)}**.${when} Open the Activity and join the hunt!`;
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
        + `${s.participants ?? 0} hunters shared **${s.total_packs ?? 0}** packs by damage dealt.`
        + (top ? `\n**Top 3 damage:**\n${top}` : '');
    }
    case 'expired': {
      const s = (p.settle ?? {}) as { participants?: number; total_packs?: number };
      const top = topDamage(p.top);
      return `💀 **${p.name} escaped.** The pride did not defeat it in time.\n`
        + `Consolation: **${s.total_packs ?? 0}** packs to ${s.participants ?? 0} hunters. A new boss appears Thursday.`
        + (top ? `\n**Top 3 damage:**\n${top}` : '');
    }
    case 'attack': {
      const tags = [p.crit ? '💥 CRIT' : '', p.bonus ? '×2 weak' : '', p.downed ? 'card downed' : '']
        .filter(Boolean).join(' · ');
      return `⚔️ <@${p.player_id}> hit for **${Number(p.damage).toLocaleString()}** with ${p.card}`
        + (tags ? `  — ${tags}` : '');
    }
    case 'player_done': {
      const top = p.top_card ? `\nTop card: **${p.top_card}** (${Number(p.top_damage).toLocaleString()})` : '';
      const bossHp = (p.boss_hp !== undefined && p.boss_hp !== null)
        ? `\nBoss HP left: **${Number(p.boss_hp).toLocaleString()}** / ${Number(p.boss_hp_max).toLocaleString()}`
        : '';
      return `🦁 <@${p.player_id}> finished the hunt for today!\n`
        + `Daily damage: **${Number(p.total).toLocaleString()}** across ${p.cards_used} card${Number(p.cards_used) === 1 ? '' : 's'}.${top}${bossHp}`;
    }
    default:
      return null;
  }
}

let running = false;
async function drain(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    const supabase = getSupabase();
    const { data: events } = await supabase
      .from('hunt_events')
      .select('id, kind, payload')
      .is('posted_at', null)
      .order('id', { ascending: true })
      .limit(BATCH);
    for (const ev of events ?? []) {
      const msg = format(ev as never);
      if (msg) await announce(client, msg);
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
