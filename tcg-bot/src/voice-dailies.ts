import type { Client } from 'discord.js';
import { getSupabase } from './supabase.js';
import { ensurePlayer } from './store.js';
// The env var, not config.ts: config throws without the token, and the tests import this file.
const GUILD_ID = (): string => process.env.DISCORD_GUILD_ID ?? '';

// The Dailies voice task (dailies.sql): once a minute, +1 voice minute for each member who
// is in a voice channel with at least one other person, not in the AFK channel, and not
// deafened. The SQL counts nothing while the Dailies flag is off or earning is paused.
const TICK_MS = 60_000;

export type VoiceStateLite = { id: string; channelId: string | null; deaf: boolean; bot: boolean; name?: string; avatar?: string | null };

/** The member ids that earn a voice minute this tick. */
export function eligibleVoiceIds(states: VoiceStateLite[], afkChannelId: string | null): string[] {
  const humans = new Map<string, VoiceStateLite[]>();
  for (const s of states) {
    if (!s.channelId || s.bot || s.channelId === afkChannelId) continue;
    humans.set(s.channelId, [...(humans.get(s.channelId) ?? []), s]);
  }
  const out: string[] = [];
  for (const list of humans.values()) {
    if (list.length < 2) continue;
    for (const s of list) if (!s.deaf) out.push(s.id);
  }
  return out;
}

async function tick(client: Client): Promise<void> {
  const guild = client.guilds.cache.get(GUILD_ID());
  if (!guild) return;
  const states: VoiceStateLite[] = guild.voiceStates.cache.map((v) => ({
    id: v.id, channelId: v.channelId, deaf: Boolean(v.deaf), bot: Boolean(v.member?.user.bot), name: v.member?.user.username, avatar: v.member?.user.avatar,
  }));
  const ids = eligibleVoiceIds(states, guild.afkChannelId);
  if (!ids.length) return;
  for (const s of states) if (ids.includes(s.id)) await ensurePlayer(s.id, s.name ?? 'player', s.avatar).catch(() => {});
  const { error } = await getSupabase().rpc('add_voice_minutes', { p_ids: ids });
  if (error) console.error('voice-dailies:', error.message);
}

export function startVoiceDailies(client: Client): void {
  setInterval(() => { void tick(client).catch((e) => console.error('voice-dailies tick:', e)); }, TICK_MS);
  console.log('Voice dailies started (tick every 60s).');
}
