import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const config = {
  token: required('DISCORD_TOKEN'),
  clientId: required('DISCORD_CLIENT_ID'),
  // Optional: a guild ID scopes command registration to one server for instant updates.
  guildId: process.env.DISCORD_GUILD_ID ?? '',
  // Discord ids allowed to run admin commands (gift/grant-all/set the rate).
  adminIds: (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};

export const isAdmin = (id: string): boolean => config.adminIds.includes(id);
