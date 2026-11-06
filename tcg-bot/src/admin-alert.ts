import type { Client } from 'discord.js';

// A private alert to the bot admins (ADMIN_USER_IDS) by direct message. The VM jobs use it
// through the internal API (POST /admin-alert), for example when the nightly database backup
// fails (ops/backup/backup.sh). It is a DM, not a channel post: the notifications channel is
// public, and an ops alert is for the owner only.

const MAX = 1800; // under the 2000-character Discord limit, with room for the prefix

export function adminIdsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d{5,25}$/.test(s));
}

export function adminAlertText(message: string): string {
  const body = String(message).replace(/\s+$/g, '').slice(0, MAX);
  return `**[Lion Pride TCG ops]** ${body}`;
}

// Sends the alert to each admin. Returns how many DMs were sent (0 = nobody got it).
export async function dmAdmins(client: Pick<Client, 'users'>, ids: string[], message: string): Promise<number> {
  const content = adminAlertText(message);
  let sent = 0;
  for (const id of ids) {
    try {
      const user = await client.users.fetch(id);
      await user.send({ content, allowedMentions: { parse: [] } });
      sent += 1;
    } catch (error) {
      console.error(`admin alert: DM to ${id} failed:`, String((error as Error)?.message ?? error));
    }
  }
  return sent;
}

// DB-MEM M1 (Nathan, 2026-11-06: "alerts go to the Discord channel tcg-admin-alerts"): an ops alert posted to the
// private admin channel instead of a DM. The channel: ADMIN_ALERT_CHANNEL_ID when set, else the text channel named
// ADMIN_ALERT_CHANNEL_NAME (default tcg-admin-alerts) in DISCORD_GUILD_ID (else in any guild of the bot).
export const ADMIN_ALERT_CHANNEL_DEFAULT = 'tcg-admin-alerts';
type SendChannel = { id?: string; name?: string; isTextBased?: () => boolean; send: (body: unknown) => Promise<unknown> };
type GuildLike = { id: string; channels: { fetch: () => Promise<Map<string, SendChannel | null> | { values: () => Iterable<SendChannel | null> }> } };
export type ChannelClient = {
  channels: { fetch: (id: string) => Promise<unknown> };
  guilds: { cache: { values: () => Iterable<GuildLike> } };
};

let resolved: { key: string; id: string } | null = null; // the channel found by name, kept for the next alert

async function findAdminChannel(client: ChannelClient, env: NodeJS.ProcessEnv): Promise<SendChannel | null> {
  const id = (env.ADMIN_ALERT_CHANNEL_ID ?? '').trim();
  const name = (env.ADMIN_ALERT_CHANNEL_NAME ?? '').trim() || ADMIN_ALERT_CHANNEL_DEFAULT;
  const guildId = (env.DISCORD_GUILD_ID ?? '').trim();
  const key = `${id}|${name}|${guildId}`;
  const want = id || (resolved?.key === key ? resolved.id : '');
  if (want) {
    const ch = (await client.channels.fetch(want).catch(() => null)) as SendChannel | null;
    if (ch && typeof ch.send === 'function' && (!ch.isTextBased || ch.isTextBased())) return ch;
    if (id) return null; // a configured id that does not work: no guess by name
    resolved = null;
  }
  for (const g of client.guilds.cache.values()) {
    if (guildId && g.id !== guildId) continue;
    const all = await g.channels.fetch().catch(() => null);
    if (!all) continue;
    for (const ch of all.values()) {
      if (ch && ch.name === name && typeof ch.send === 'function' && (!ch.isTextBased || ch.isTextBased())) {
        if (ch.id) resolved = { key, id: ch.id };
        return ch;
      }
    }
  }
  return null;
}

// Posts the alert to the admin channel. Returns true when Discord took the post.
export async function postAdminChannel(client: ChannelClient, message: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    const ch = await findAdminChannel(client, env);
    if (!ch) { console.error('admin alert: the admin alert channel was not found (ADMIN_ALERT_CHANNEL_ID / ADMIN_ALERT_CHANNEL_NAME)'); return false; }
    await ch.send({ content: adminAlertText(message), allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.error('admin alert: the channel post failed:', String((error as Error)?.message ?? error));
    return false;
  }
}

/** Test only: forget the channel found by name. */
export function resetAdminChannelCache(): void { resolved = null; }
