import type { Client } from 'discord.js';

// The LPTCG role (Nathan, 2026-10-02): every member with a Lion Pride TCG account gets it at their
// first login, so a post can ping the players instead of the whole server. The same grey as the
// other member roles (Gamer Cub, Streamer/Content Creator, Server Booster). Mentionable.
export const LPTCG_ROLE = 'LPTCG';
export const LPTCG_COLOR = 0x95a5a6;
const GUILD_ID = (): string => process.env.DISCORD_GUILD_ID ?? '';

let roleId: string | null = null;
const given = new Set<string>(); // members who have it (this process)

/** The LPTCG role id; it is created once if the server has none. */
export async function lptcgRoleId(client: Client): Promise<string | null> {
  if (roleId) return roleId;
  if (!GUILD_ID()) return null;
  const guild = await client.guilds.fetch(GUILD_ID());
  const roles = await guild.roles.fetch();
  let role = roles.find((r) => r.name === LPTCG_ROLE) ?? null;
  if (!role) role = await guild.roles.create({ name: LPTCG_ROLE, color: LPTCG_COLOR, mentionable: true, reason: 'Lion Pride TCG players' });
  roleId = role.id;
  return roleId;
}

/** Give a member the LPTCG role (once; a member who left the server is skipped). */
export async function giveLptcgRole(client: Client, userId: string): Promise<boolean> {
  if (!/^\d{17,20}$/.test(userId)) return false;
  if (given.has(userId)) return true;
  const id = await lptcgRoleId(client);
  if (!id) return false;
  const guild = await client.guilds.fetch(GUILD_ID());
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  if (!member.roles.cache.has(id)) await member.roles.add(id, 'Lion Pride TCG account');
  given.add(userId);
  return true;
}
