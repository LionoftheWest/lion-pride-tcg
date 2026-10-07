import { Events, GatewayIntentBits, Partials, type Client, type GuildMember, type PartialGuildMember } from 'discord.js';
import { getSupabase } from './supabase.js';
// The env var, not config.ts: config throws without the token, and the tests import this file.
const GUILD_ID = (): string => process.env.DISCORD_GUILD_ID ?? '';

// The Discord server join and leave of each member (logs_app.sql: players.guild_joined_at, players.left_guild_at).
// Two flags, both default OFF:
//   FEATURE_GUILD_LOG=1            fill guild_joined_at of the players rows that have none, at start and once a day.
//                                  One "Get Guild Member" call per row (no privileged intent needed). No row is made.
//   FEATURE_GUILD_MEMBERS_INTENT=1 also ask Discord for the Server Members intent (privileged) and record each join
//                                  (GuildMemberAdd) and leave (GuildMemberRemove) at once. Turn it on ONLY after the
//                                  intent is on in the Developer Portal: Discord refuses the login without it (4014).
export const guildLogOn = (): boolean => process.env.FEATURE_GUILD_LOG === '1';
export const membersIntentOn = (): boolean => guildLogOn() && process.env.FEATURE_GUILD_MEMBERS_INTENT === '1';

const BASE_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent];

/** The intents and partials of the client: GuildMembers (+ the GuildMember partial, so a leave of a member that is
 *  not in the cache still fires) only with FEATURE_GUILD_MEMBERS_INTENT. */
export function clientOptions(intentOn = membersIntentOn()): { intents: GatewayIntentBits[]; partials: Partials[] } {
  return intentOn
    ? { intents: [...BASE_INTENTS, GatewayIntentBits.GuildMembers], partials: [Partials.GuildMember] }
    : { intents: [...BASE_INTENTS], partials: [] };
}

export type JoinRow = { id: string; at: string };
/** The guild_joined rows from members: a human with a join time only. */
export function joinRows(members: Array<{ id: string; joinedAt: Date | null; bot: boolean }>): JoinRow[] {
  return members.filter((m) => !m.bot && m.joinedAt).map((m) => ({ id: m.id, at: (m.joinedAt as Date).toISOString() }));
}

const DAY_MS = 24 * 60 * 60_000;
const BATCH = 100;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The players ids with no join time (pages of 1,000: PostgREST returns at most 1,000 rows). */
async function idsWithoutJoin(): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await getSupabase().from('players').select('id').is('guild_joined_at', null).order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    ids.push(...(data ?? []).map((r) => String(r.id)));
    if (!data || data.length < 1000) return ids;
  }
}

/** Fill guild_joined_at of the rows that have none. A member who left the server is skipped (no time known). */
export async function backfillJoins(client: Client, { pauseMs = 250 } = {}): Promise<{ checked: number; set: number; notInServer: number }> {
  const guild = await client.guilds.fetch(GUILD_ID());
  const ids = (await idsWithoutJoin()).filter((id) => /^\d{17,20}$/.test(id)); // test rows have other ids
  let set = 0, notInServer = 0, rows: JoinRow[] = [];
  const flush = async (): Promise<void> => {
    if (!rows.length) return;
    const { data, error } = await getSupabase().rpc('guild_joined', { p_rows: rows });
    if (error) throw new Error(error.message);
    set += Number(data) || 0;
    rows = [];
  };
  for (const id of ids) {
    const m = await guild.members.fetch({ user: id, force: false }).catch(() => null);
    if (!m) notInServer += 1;
    else rows.push(...joinRows([{ id: m.id, joinedAt: m.joinedAt, bot: m.user.bot }]));
    if (rows.length >= BATCH) await flush();
    await sleep(pauseMs); // one call at a time, well under the Discord rate limit
  }
  await flush();
  return { checked: ids.length, set, notInServer };
}

async function onJoin(member: GuildMember): Promise<void> {
  if (member.guild.id !== GUILD_ID()) return;
  const rows = joinRows([{ id: member.id, joinedAt: member.joinedAt ?? new Date(), bot: member.user.bot }]);
  if (!rows.length) return;
  const { error } = await getSupabase().rpc('guild_joined', { p_rows: rows });
  if (error) console.error('guild-log join:', error.message);
}

async function onLeave(member: GuildMember | PartialGuildMember): Promise<void> {
  if (member.guild.id !== GUILD_ID() || member.user?.bot) return;
  const { error } = await getSupabase().rpc('guild_left', { p_player: member.id, p_at: new Date().toISOString() });
  if (error) console.error('guild-log leave:', error.message);
}

/** The join events (only with the intent) and the backfill at start and once a day (FEATURE_GUILD_LOG). */
export function startGuildLog(client: Client): void {
  if (!guildLogOn() || !GUILD_ID()) return;
  if (membersIntentOn()) {
    client.on(Events.GuildMemberAdd, (m) => { void onJoin(m).catch((e) => console.error('guild-log join:', e)); });
    client.on(Events.GuildMemberRemove, (m) => { void onLeave(m).catch((e) => console.error('guild-log leave:', e)); });
  }
  const run = (): void => {
    void backfillJoins(client)
      .then((r) => console.log(`guild-log: ${r.checked} rows with no join time, ${r.set} set, ${r.notInServer} not in the server.`))
      .catch((e) => console.error('guild-log backfill:', e));
  };
  run();
  setInterval(run, DAY_MS).unref();
  console.log(`Guild log started (backfill daily${membersIntentOn() ? ', join and leave events' : ''}).`);
}
