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
