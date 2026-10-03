import type { Client, Guild, GuildMember, Message, Role } from 'discord.js';
import { getSupabase } from './supabase.js';
import { announce } from './internal.js';
import { botWork } from './bot-work.js';
// The server (DISCORD_GUILD_ID), read here so the pure helpers test without the bot token.
const GUILD_ID = (): string => process.env.DISCORD_GUILD_ID ?? '';

// Real Discord boons and pranks (docs/boons-and-pranks.md §3A). play_card_effect() writes a
// discord_effects row; this loop does the Discord action, and it undoes each effect when
// its revert_at passes (also after a restart, so nobody stays renamed). Kill switch:
// FEATURE_DISCORD_EFFECTS=1 (default OFF). Built here: nickname, crown, timeout,
// clown_role, spotlight_role, hype, ping_parade, reaction_storm, color_role, vc_mute, vc_deafen.
export const discordEffectsEnabled = (): boolean => process.env.FEATURE_DISCORD_EFFECTS === '1';

const TICK_MS = 10_000;
export const BUILT = ['nickname', 'crown', 'timeout', 'clown_role', 'spotlight_role', 'hype', 'ping_parade', 'reaction_storm', 'color_role', 'vc_mute', 'vc_deafen'] as const;
// Rows that WAIT before they act: a voice prank waits (max 1 h) until the target is in voice;
// a name color waits (max 24 h) for the target to pick it in the Activity (then gold).
const WAIT_S: Record<string, number> = { vc_mute: 3600, vc_deafen: 3600, color_role: 86400 };
const VOICE = ['vc_mute', 'vc_deafen'];
/** The name colors a member can pick (the Activity shows the same list). */
export const NAME_COLORS: Record<string, string> = {
  '#F4B73C': 'Gold', '#FF5A5A': 'Red', '#FF9A3C': 'Orange', '#5BE38A': 'Green',
  '#4FD6F0': 'Teal', '#5B8CFF': 'Blue', '#B45AD8': 'Purple', '#FF7AC8': 'Pink',
};
/** The color a row should use: the picked one (if valid), gold after the wait, else null (wait). */
export function colorFor(options: Record<string, unknown>, ageS: number): string | null {
  const c = String(options.color ?? '').toUpperCase();
  if (NAME_COLORS[c]) return c;
  return ageS >= WAIT_S.color_role! ? '#F4B73C' : null;
}
const NICK = ['nickname', 'crown'];
const ROLES: Record<string, { name: string; color: number; hoist: boolean }> = {
  clown_role: { name: '🤡 Clown', color: 0xff5a5a, hoist: false },
  spotlight_role: { name: '✨ Spotlight', color: 0xf4b73c, hoist: true },
};
const NICK_MAX = 32;

export interface EffectRow {
  id: number;
  play_id: number | null;
  target_id: string;
  primitive: string;
  amount: number | null;
  duration_s: number | null;
  options: Record<string, unknown>;
  status: string;
  revert_at: string | null;
  original_value: string | null;
  created_at: string;
}

// ---- pure helpers (discord-effects.test.ts) ----------------------------------------------

/** A nickname from a card template ("{name} the Clown"), cut to Discord's 32 characters. */
export function nickFromTemplate(template: string, name: string): string {
  const t = template.includes('{name}') ? template : `{name} ${template}`;
  const room = Math.max(1, NICK_MAX - (t.length - '{name}'.length));
  return t.replace('{name}', name.slice(0, room)).slice(0, NICK_MAX);
}

/**
 * The nickname a member should have for the nick effects that are active now.
 * original = the member's own nickname before the first effect (null = none),
 * display = the name Discord shows without a nickname. null = no nickname.
 */
export function composeNick(original: string | null, display: string, layers: { nickname?: string | null; crown?: boolean }): string | null {
  let base = original;
  if (layers.nickname) base = layers.nickname;
  if (layers.crown) return `👑 ${base ?? display}`.slice(0, NICK_MAX);
  return base;
}

/** The ping times (seconds after the play) for a ping parade: amount pings over the duration. */
export function pingTimes(amount: number, durationS: number): number[] {
  const n = Math.max(1, Math.min(3, Math.round(amount || 1)));
  const d = Math.max(0, Math.min(300, durationS || 0));
  return Array.from({ length: n }, (_, i) => (n === 1 ? 0 : Math.round((d * i) / (n - 1))));
}

/** One random item from a list option, or the fallback. */
export function pick(list: unknown, fallback: string, rnd: () => number = Math.random): string {
  return Array.isArray(list) && list.length ? String(list[Math.floor(rnd() * list.length)]) : fallback;
}

// ---- the loop -------------------------------------------------------------------------------

type Store = ReturnType<typeof getSupabase>;
const storms = new Map<string, { id: number; left: number; emoji: string }>();

async function patchRow(sb: Store, id: number, fields: Record<string, unknown>): Promise<void> {
  await sb.from('discord_effects').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
}

async function reasonFor(sb: Store, row: EffectRow): Promise<{ reason: string; card: string }> {
  const [{ data: p }, { data: c }] = await Promise.all([
    sb.from('players').select('username').eq('id', String(row.options.sender_id ?? '')).maybeSingle(),
    sb.from('cards').select('name').eq('id', Number(row.options.card_id ?? 0)).maybeSingle(),
  ]);
  const card = c?.name ?? 'a card';
  return { reason: `Lion Pride TCG: ${p?.username ?? 'someone'} played ${card}`, card };
}

async function ensureRole(guild: Guild, key: string): Promise<Role> {
  const def = ROLES[key]!;
  const roles = await guild.roles.fetch();
  const found = roles.find((r) => r.name === def.name);
  if (found) return found;
  const role = await guild.roles.create({ name: def.name, colors: { primaryColor: def.color }, hoist: def.hoist, mentionable: false, reason: 'Lion Pride TCG effect role' });
  const top = guild.members.me?.roles.highest;
  if (top && def.hoist) await role.setPosition(Math.max(1, top.position - 1)).catch(() => {});
  return role;
}

/** The shared role of one name color, just under the bot's role (so its color shows). */
async function colorRole(guild: Guild, hex: string): Promise<Role> {
  const name = `🎨 ${NAME_COLORS[hex]}`;
  const roles = await guild.roles.fetch();
  const found = roles.find((r) => r.name === name);
  if (found) return found;
  const role = await guild.roles.create({ name, colors: { primaryColor: parseInt(hex.slice(1), 16) }, hoist: false, mentionable: false, reason: 'Lion Pride TCG name color' });
  const top = guild.members.me?.roles.highest;
  if (top) await role.setPosition(Math.max(1, top.position - 1)).catch(() => {});
  return role;
}

/** The active nick rows of a member (nickname / crown), oldest first. */
async function nickRows(sb: Store, target: string): Promise<EffectRow[]> {
  const { data } = await sb.from('discord_effects').select('*').eq('target_id', target).in('primitive', NICK).eq('status', 'active').order('created_at');
  return (data ?? []) as EffectRow[];
}
const parseOrig = (v: string | null): string | null => { try { return v == null ? null : (JSON.parse(v).nick ?? null); } catch { return null; } };

async function applyNick(sb: Store, member: GuildMember, rows: EffectRow[], reason: string): Promise<string | null> {
  const original = rows.length ? parseOrig(rows[0]!.original_value) : member.nickname;
  const nickRow = [...rows].reverse().find((r) => r.primitive === 'nickname');
  const want = composeNick(original, member.user.globalName ?? member.user.username, {
    nickname: nickRow ? String(nickRow.options.applied_nick ?? '') || null : null,
    crown: rows.some((r) => r.primitive === 'crown'),
  });
  if (member.nickname !== want) await member.setNickname(want, reason);
  for (const r of rows) await patchRow(sb, r.id, { options: { ...r.options, applied: want } });
  return want;
}

async function execute(client: Client, sb: Store, guild: Guild, row: EffectRow): Promise<void> {
  const member = await guild.members.fetch(row.target_id).catch(() => null);
  if (!member) { await patchRow(sb, row.id, { status: 'failed', error: 'not_in_guild' }); return; }
  const { reason, card } = await reasonFor(sb, row);
  const p = row.primitive;
  // The bot itself is the one safe test target (it can rename itself and take roles).
  // The bot itself is the one safe live-test target (it can rename itself and take roles).
  const self = member.id === guild.members.me?.id;
  if ((NICK.includes(p) || p in ROLES) && !self && !member.manageable) { await patchRow(sb, row.id, { status: 'failed', error: 'not_manageable' }); return; }
  const ageS = (Date.now() - new Date(row.created_at).getTime()) / 1000;
  const endsAt = () => new Date(Date.now() + Math.max(5, Number(row.duration_s) || 30) * 1000).toISOString();
  if (VOICE.includes(p)) {
    if (member.id === guild.ownerId) { await patchRow(sb, row.id, { status: 'failed', error: 'owner' }); return; }
    if (!member.voice?.channelId) {
      // Not in voice now: the prank waits (it runs when they join), at most 1 hour.
      if (ageS > WAIT_S[p]!) await patchRow(sb, row.id, { status: 'skipped', error: 'never_in_voice' });
      return;
    }
    if (p === 'vc_mute') await member.voice.setMute(true, reason); else await member.voice.setDeaf(true, reason);
    await patchRow(sb, row.id, { status: 'active', revert_at: new Date(Date.now() + Math.max(5, Math.min(30, row.duration_s || 30)) * 1000).toISOString() });
    return;
  }
  if (p === 'color_role') {
    if (!self && !member.manageable) { await patchRow(sb, row.id, { status: 'failed', error: 'not_manageable' }); return; }
    const hex = colorFor(row.options, ageS);
    if (!hex) return; // the target has not picked yet
    const role = await colorRole(guild, hex);
    await member.roles.add(role, reason);
    await patchRow(sb, row.id, { status: 'active', original_value: role.id, revert_at: endsAt(), options: { ...row.options, color: hex } });
    return;
  }
  if (p === 'timeout') {
    if (!member.moderatable) { await patchRow(sb, row.id, { status: 'failed', error: 'not_moderatable' }); return; }
    await member.timeout(Math.max(5, Math.min(60, row.duration_s || 60)) * 1000, reason);
    await patchRow(sb, row.id, { status: 'done' });
  } else if (NICK.includes(p)) {
    const before = await nickRows(sb, row.target_id);
    const original = before.length ? before[0]!.original_value : JSON.stringify({ nick: member.nickname });
    const opts = { ...row.options };
    // The template uses the member's own name (not a name another effect gave them).
    const ownName = parseOrig(original) ?? member.user.globalName ?? member.user.username;
    if (p === 'nickname') opts.applied_nick = nickFromTemplate(pick(row.options.nicknames, '{name} the Pranked'), ownName);
    await patchRow(sb, row.id, { status: 'active', original_value: original, options: opts });
    await applyNick(sb, member, [...before, { ...row, status: 'active', original_value: original, options: opts }], reason);
  } else if (p in ROLES) {
    const role = await ensureRole(guild, p);
    await member.roles.add(role, reason);
    await patchRow(sb, row.id, { status: 'active', original_value: role.id });
  } else if (p === 'hype') {
    // The play post (effect-notify.ts) is the hype message; nothing else to do.
    await patchRow(sb, row.id, { status: 'done' });
  } else if (p === 'ping_parade') {
    const times = pingTimes(Number(row.amount) || 3, row.duration_s || 300);
    await patchRow(sb, row.id, { status: 'active', options: { ...row.options, times, sent: 0, card } });
  } else if (p === 'reaction_storm') {
    const left = Math.max(1, Math.min(5, Math.round(Number(row.amount) || 5)));
    const emoji = String(row.options.emoji ?? '🤡');
    await patchRow(sb, row.id, { status: 'active', options: { ...row.options, left, emoji } });
    storms.set(row.target_id, { id: row.id, left, emoji });
  } else {
    await patchRow(sb, row.id, { status: 'skipped', error: 'not_built' });
  }
  void client;
}

async function revert(sb: Store, guild: Guild, row: EffectRow): Promise<void> {
  const p = row.primitive;
  const member = await guild.members.fetch(row.target_id).catch(() => null);
  if (member && NICK.includes(p)) {
    const rest = (await nickRows(sb, row.target_id)).filter((r) => r.id !== row.id);
    // Restore only a name the bot set: a member who renamed themselves keeps their choice.
    if (member.nickname === (row.options.applied ?? null)) {
      // Every nick row holds the same original (copied from the first one at apply).
      if (rest.length) {
        await applyNick(sb, member, rest, 'Lion Pride TCG: effect ended');
      } else {
        await member.setNickname(parseOrig(row.original_value), 'Lion Pride TCG: effect ended').catch(() => {});
      }
    }
  } else if (member && p in ROLES && row.original_value) {
    const still = await sb.from('discord_effects').select('id').eq('target_id', row.target_id).eq('primitive', p).eq('status', 'active').neq('id', row.id);
    if (!(still.data ?? []).length) await member.roles.remove(row.original_value, 'Lion Pride TCG: effect ended').catch(() => {});
  } else if (p === 'reaction_storm') {
    storms.delete(row.target_id);
  } else if (VOICE.includes(p)) {
    // Discord keeps a server mute after the member leaves voice, and it can be lifted only
    // while they are connected: the row stays active and is retried (every tick, and at
    // once when they join), so nobody stays muted.
    if (!member) { await patchRow(sb, row.id, { status: 'reverted', error: 'left_server' }); return; }
    if (!member.voice?.channelId) { await patchRow(sb, row.id, { error: 'waiting_for_voice' }); return; }
    if (p === 'vc_mute') await member.voice.setMute(false, 'Lion Pride TCG: effect ended'); else await member.voice.setDeaf(false, 'Lion Pride TCG: effect ended');
  } else if (p === 'color_role' && row.original_value) {
    const still = await sb.from('discord_effects').select('id').eq('target_id', row.target_id).eq('primitive', p).eq('status', 'active').eq('original_value', row.original_value).neq('id', row.id);
    if (member && !(still.data ?? []).length) await member.roles.remove(row.original_value, 'Lion Pride TCG: effect ended').catch(() => {});
    const role = await guild.roles.fetch(row.original_value).catch(() => null);
    if (role && role.members.size === 0) await role.delete('Lion Pride TCG: no member has this color').catch(() => {});
  }
  await patchRow(sb, row.id, { status: 'reverted' });
}

let running = false;
/** force: a member joined voice - run the full tick without the bot_work() check (bot_work_waits.sql
 *  does not count the rows that wait for a voice join, so the join must run them itself). */
export async function tick(client: Client, force = false): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!force && !(await botWork()).fx) return; // nothing due (bot_work.sql: one question, not four)
    const sb = getSupabase();
    const guild = await client.guilds.fetch(GUILD_ID());
    const now = new Date().toISOString();
    // 1. New plays.
    const { data: todo } = await sb.from('discord_effects').select('*').eq('status', 'pending').lte('execute_after', now).order('id').limit(50); // waiting rows stay pending
    for (const row of (todo ?? []) as EffectRow[]) {
      try { await execute(client, sb, guild, row); } catch (e) { await patchRow(sb, row.id, { status: 'failed', error: String((e as Error).message).slice(0, 200) }); }
    }
    // 2. Ping parades that are due.
    const { data: parades } = await sb.from('discord_effects').select('*').eq('status', 'active').eq('primitive', 'ping_parade');
    for (const row of (parades ?? []) as EffectRow[]) {
      const times = (row.options.times as number[]) ?? [0];
      let sent = Number(row.options.sent ?? 0);
      const start = new Date(row.created_at).getTime();
      while (sent < times.length && Date.now() >= start + times[sent]! * 1000) {
        await announce(client, `🔔 <@${row.target_id}> — **${row.options.card ?? 'a card'}** (${sent + 1}/${times.length})`, 'plays'); // muted = no ping
        sent += 1;
      }
      await patchRow(sb, row.id, sent >= times.length ? { status: 'done', options: { ...row.options, sent } } : { options: { ...row.options, sent } });
    }
    // 3. Reaction storms: keep the live list in step with the table (after a restart too).
    const { data: st } = await sb.from('discord_effects').select('id, target_id, options').eq('status', 'active').eq('primitive', 'reaction_storm');
    storms.clear();
    for (const r of (st ?? []) as EffectRow[]) storms.set(r.target_id, { id: r.id, left: Number(r.options.left ?? 5), emoji: String(r.options.emoji ?? '🤡') });
    // 4. Undo what has ended (a cleanse sets revert_at = now()).
    const { data: due } = await sb.from('discord_effects').select('*').eq('status', 'active').lte('revert_at', now).order('created_at').limit(20);
    for (const row of (due ?? []) as EffectRow[]) {
      try { await revert(sb, guild, row); } catch (e) { await patchRow(sb, row.id, { error: `revert: ${String((e as Error).message).slice(0, 180)}` }); }
    }
  } catch (error) {
    console.error('discord-effects tick error:', error);
  } finally {
    running = false;
  }
}

/** The reaction storm: react to the target's next messages. */
export async function onEffectMessage(message: Message): Promise<void> {
  const s = storms.get(message.author.id);
  if (!s || s.left <= 0) return;
  s.left -= 1;
  await message.react(s.emoji).catch(() => {});
  const sb = getSupabase();
  const { data } = await sb.from('discord_effects').select('options').eq('id', s.id).maybeSingle();
  await patchRow(sb, s.id, s.left <= 0 ? { status: 'done', options: { ...(data?.options ?? {}), left: 0 } } : { options: { ...(data?.options ?? {}), left: s.left } });
  if (s.left <= 0) storms.delete(message.author.id);
}

/** Admin Undo all: every active Discord effect ends now (the next tick undoes them). */
export async function undoAll(client: Client): Promise<number> {
  const sb = getSupabase();
  const { data } = await sb.from('discord_effects').update({ revert_at: new Date().toISOString() }).eq('status', 'active').select('id');
  await sb.from('discord_effects').update({ status: 'skipped', error: 'undo_all' }).eq('status', 'pending');
  await tick(client);
  return (data ?? []).length;
}

export function startDiscordEffects(client: Client): void {
  if (!discordEffectsEnabled()) return;
  void tick(client); // at start: undo whatever ended while the bot was down
  setInterval(() => { void tick(client); }, TICK_MS);
  console.log('Discord effects started (poll every 10s).');
}
