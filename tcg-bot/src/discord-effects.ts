import { AttachmentBuilder, escapeMarkdown, PermissionFlagsBits, type Client, type Guild, type GuildMember, type Message, type MessageCreateOptions, type Role } from 'discord.js';
import { getSupabase } from './supabase.js';
import { announce } from './internal.js';
import { botWork } from './bot-work.js';
import { art } from './playing-posts.js';
import { launchActivityRow } from './ui/launch.js';
// The server (DISCORD_GUILD_ID), read here so the pure helpers test without the bot token.
const GUILD_ID = (): string => process.env.DISCORD_GUILD_ID ?? '';

// Real Discord boons and pranks (docs/boons-and-pranks.md §3A). play_card_effect() writes a
// discord_effects row; this loop does the Discord action, and it undoes each effect when
// its revert_at passes (also after a restart, so nobody stays renamed). Kill switch:
// FEATURE_DISCORD_EFFECTS=1 (default OFF). Built here: nickname, crown, title, sticker, timeout,
// clown_role, spotlight_role, hype, ping_parade, reaction_storm, color_role, vc_mute, vc_deafen,
// heckle, fanfare, squeaky; effects_spread.sql: slowmode, hot_take_poll, body_swap, parrot, spongebob.
export const discordEffectsEnabled = (): boolean => process.env.FEATURE_DISCORD_EFFECTS === '1';

const TICK_MS = 10_000;
export const BUILT = ['nickname', 'crown', 'title', 'sticker', 'timeout', 'clown_role', 'spotlight_role', 'hype', 'ping_parade', 'reaction_storm', 'color_role', 'vc_mute', 'vc_deafen', 'heckle', 'fanfare', 'squeaky', 'slowmode', 'hot_take_poll', 'body_swap', 'parrot', 'spongebob'] as const;
// Rows that WAIT before they act: a voice prank waits (max 48 h) until the target is in voice;
// a name color waits (max 24 h) for the target to pick it in the Activity (then gold).
export const WAIT_S: Record<string, number> = { vc_mute: 172800, vc_deafen: 172800, color_role: 86400 };
// Rows the bot ARMS and then fires on the target's next move (SPEC-outside-effects.md, 2026-10-03):
// heckle = one reply to their next message, fanfare / squeaky = one post when they next join voice.
// parrot / spongebob (effects_spread.sql) = one reply that repeats their next message with text.
// At revert_at (created_at + 48 h) an unused one is skipped ('expired').
const ARMED = ['heckle', 'fanfare', 'squeaky', 'parrot', 'spongebob'];
/** The armed rows that answer the next chat message (one reply per message: a heckle first). */
const ECHO = ['parrot', 'spongebob'];
const ARM_S = 172800;
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
// The nickname layers: a nickname replaces the name, crown + sticker go before it, a title after it.
// body_swap (effects_spread.sql) is a nickname layer too: the other member's own name.
const NICK = ['nickname', 'crown', 'title', 'sticker', 'body_swap'];
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
export function composeNick(original: string | null, display: string, layers: { nickname?: string | null; crown?: boolean; title?: string | null; sticker?: string | null }): string | null {
  const base = layers.nickname || original;
  const head = [layers.crown ? '👑' : '', layers.sticker || ''].filter(Boolean).join(' ');
  if (!head && !layers.title) return base;
  // "👑 🦆 <name> · <title>" in 32 characters: the name is cut (whole characters), never the
  // crown, the sticker or the title. Only a title too long for any name is cut too (the name
  // keeps its first 3 characters). Discord's limit is checked in UTF-16 units (the stricter count).
  const pre = head ? `${head} ` : '';
  let suf = layers.title ? ` · ${layers.title}` : '';
  const name = base ?? display;
  let cut = fitChars(name, NICK_MAX - pre.length - suf.length);
  const min = fitChars(name, Math.min(name.length, 6), 3);
  if (cut.length < min.length) {
    cut = min;
    suf = fitChars(suf, NICK_MAX - pre.length - cut.length);
  }
  return `${pre}${cut}${suf}`.slice(0, NICK_MAX);
}

/** The first whole characters (graphemes, so an emoji is never split) of s within max UTF-16 units, at most count characters. */
function fitChars(s: string, max: number, count = Infinity): string {
  let out = '';
  let n = 0;
  for (const { segment } of new Intl.Segmenter().segment(s)) {
    if (n >= count || out.length + segment.length > max) break;
    out += segment; n += 1;
  }
  return out.trimEnd();
}

/** The title layer: options.title (play_card_effect picks it from the card's titles), else the first title. */
export function titleFor(options: Record<string, unknown>): string {
  return String(options.title ?? '').trim() || pick(options.titles, 'Pranked', () => 0).trim() || 'Pranked';
}

/** The sticker layer: options.sticker, else the first of the card's stickers, else 🏷️ (an emoji, not a word). */
export function stickerFor(options: Record<string, unknown>): string {
  const s = String(options.sticker ?? '').trim() || pick(options.stickers, '', () => 0).trim();
  return s && s.length <= 8 ? s : '🏷️';
}

/** The ping times (seconds after the play) for a ping parade: amount pings over the duration. */
export function pingTimes(amount: number, durationS: number): number[] {
  const n = Math.max(1, Math.min(3, Math.round(amount || 1)));
  const d = Math.max(0, Math.min(300, durationS || 0));
  return Array.from({ length: n }, (_, i) => (n === 1 ? 0 : Math.round((d * i) / (n - 1))));
}

/** The first max whole characters (an emoji is never split). */
export function cutText(s: string, max: number): string {
  let out = '';
  for (const { segment } of new Intl.Segmenter().segment(s)) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return out;
}

// Discord tokens that must stay exactly as they are (a custom emoji, a user / role / channel mention).
const TOKEN = /(<a?:\w+:\d+>|<[@#][!&]?\d+>)/;
/** SpongeBob text: the letters in aLtErNaTiNg case (lower first); Discord tokens stay the same. */
export function spongeCase(text: string): string {
  let up = false;
  return text.split(TOKEN).map((part, i) => (i % 2 === 1 ? part : [...part].map((ch) => {
    if (ch.toLowerCase() === ch.toUpperCase()) return ch; // not a letter
    const out = up ? ch.toUpperCase() : ch.toLowerCase();
    up = !up;
    return out;
  }).join(''))).join('');
}

/** The reply of a parrot / spongebob to a message text: the prefix + the text, at most 300 characters. */
export function echoLine(primitive: string, text: string): string {
  const line = primitive === 'parrot' ? `🦜 ${text}` : `🧽 ${spongeCase(text)}`;
  return cutText(line, 300);
}

/** A hot take poll from the card options: the question and the fixed answers, "{name}" = the target. */
export function pollFor(options: Record<string, unknown>, name: string, hours = 1) {
  const fill = (s: string) => s.split('{name}').join(name);
  // The sender's pick (play_card_effect copies it into question/answers; polls[choice] if only the list is there).
  const picked = Array.isArray(options.polls) ? (options.polls[Number(options.choice ?? -1)] as Record<string, unknown> | undefined) : undefined;
  const src = options.question != null ? options : picked ?? {};
  const q = cutText(fill(String(src.question ?? 'Hot take: is {name} right?')), 300);
  const raw = Array.isArray(src.answers) ? src.answers.map(String).filter(Boolean) : [];
  const answers = (raw.length >= 2 ? raw : ['Yes', 'No']).slice(0, 10).map((a) => ({ text: cutText(fill(a), 55) }));
  return { question: { text: q }, answers, duration: Math.max(1, Math.min(24, Math.round(hours))), allowMultiselect: false };
}

/** The slowmode gap in seconds (amount; 30 when unset), 5 to 60. */
export const slowGapS = (amount: number | null): number => Math.max(5, Math.min(60, Math.round(Number(amount) || 30)));

/** One random item from a list option, or the fallback. */
export function pick(list: unknown, fallback: string, rnd: () => number = Math.random): string {
  return Array.isArray(list) && list.length ? String(list[Math.floor(rnd() * list.length)]) : fallback;
}

// ---- the loop -------------------------------------------------------------------------------

type Store = ReturnType<typeof getSupabase>;
/** The outside world of the loop (the tests swap in fakes: no live Supabase, no Discord). */
export const fxDeps = { store: (): Store => getSupabase(), work: botWork, announce };
const storms = new Map<string, { id: number; left: number; emoji: string }>();
/** Slowmode (effects_spread.sql): the target's last kept message time in each channel, until revert_at. */
type Slow = { id: number; until: number; gapMs: number; card: string; last: Map<string, number>; noticed: boolean };
const slow = new Map<string, Slow>();
function setSlow(r: Pick<EffectRow, 'id' | 'target_id' | 'amount' | 'options' | 'revert_at'>): void {
  const until = r.revert_at ? new Date(r.revert_at).getTime() : 0;
  if (until <= Date.now()) { slow.delete(r.target_id); return; }
  const was = slow.get(r.target_id);
  const keep = was && was.id === r.id;
  slow.set(r.target_id, { id: r.id, until, gapMs: slowGapS(r.amount) * 1000, card: String(r.options?.card ?? 'a card'),
    last: keep ? was.last : new Map(), noticed: keep ? was.noticed : Boolean(r.options?.noticed) });
}
/** The armed heckle / fanfare / squeaky rows by target, oldest first (rebuilt on every full tick). */
type Armed = { id: number; primitive: string; target: string; options: Record<string, unknown>; until: number };
const armed = new Map<string, Armed[]>();
function addArmed(r: Pick<EffectRow, 'id' | 'primitive' | 'target_id' | 'options' | 'revert_at'>): void {
  const until = r.revert_at ? new Date(r.revert_at).getTime() : Infinity;
  if (until <= Date.now()) return;
  const list = armed.get(r.target_id) ?? [];
  if (!list.some((a) => a.id === r.id)) list.push({ id: r.id, primitive: r.primitive, target: r.target_id, options: r.options ?? {}, until });
  armed.set(r.target_id, list);
}
/** Take (remove) the armed rows of these primitives for a member: the first one, or all of them. */
function takeArmed(target: string, prims: string[], all: boolean): Armed[] {
  const list = armed.get(target);
  if (!list) return [];
  const live = list.filter((a) => a.until > Date.now());
  const hit = live.filter((a) => prims.includes(a.primitive)).slice(0, all ? undefined : 1);
  const rest = live.filter((a) => !hit.includes(a));
  if (rest.length) armed.set(target, rest); else armed.delete(target);
  return hit;
}
function dropArmed(target: string, id: number): void {
  const rest = (armed.get(target) ?? []).filter((a) => a.id !== id);
  if (rest.length) armed.set(target, rest); else armed.delete(target);
}
/** Use up one armed row in the table: true only when it was still armed (not done, cleansed or expired). */
async function claimArmed(sb: Store, id: number): Promise<boolean> {
  const now = new Date().toISOString();
  const { data } = await sb.from('discord_effects').update({ status: 'done', updated_at: now }).eq('id', id).eq('status', 'active').gt('revert_at', now).select('id');
  return (data ?? []).length > 0;
}

async function patchRow(sb: Store, id: number, fields: Record<string, unknown>): Promise<void> {
  await sb.from('discord_effects').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
}

async function reasonFor(sb: Store, row: EffectRow): Promise<{ reason: string; card: string; sender: string }> {
  const [{ data: p }, { data: c }] = await Promise.all([
    sb.from('players').select('username').eq('id', String(row.options.sender_id ?? '')).maybeSingle(),
    sb.from('cards').select('name').eq('id', Number(row.options.card_id ?? 0)).maybeSingle(),
  ]);
  const card = c?.name ?? 'a card';
  return { reason: `Lion Pride TCG: ${p?.username ?? 'someone'} played ${card}`, card, sender: p?.username ?? 'Someone' };
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

/** The active nick rows of a member (nickname / crown / title / sticker), oldest first. */
async function nickRows(sb: Store, target: string): Promise<EffectRow[]> {
  const { data } = await sb.from('discord_effects').select('*').eq('target_id', target).in('primitive', NICK).eq('status', 'active').order('created_at');
  return (data ?? []) as EffectRow[];
}
const parseOrig = (v: string | null): string | null => { try { return v == null ? null : (JSON.parse(v).nick ?? null); } catch { return null; } };

async function applyNick(sb: Store, member: GuildMember, rows: EffectRow[], reason: string): Promise<string | null> {
  const original = rows.length ? parseOrig(rows[0]!.original_value) : member.nickname;
  // The newest row of each layer wins (two titles: the last one shows until it ends).
  const last = (prim: string) => [...rows].reverse().find((r) => r.primitive === prim);
  const nickRow = [...rows].reverse().find((r) => r.primitive === 'nickname' || r.primitive === 'body_swap');
  const titleRow = last('title'), stickerRow = last('sticker');
  const want = composeNick(original, member.user.globalName ?? member.user.username, {
    nickname: nickRow ? String(nickRow.options.applied_nick ?? '') || null : null,
    crown: rows.some((r) => r.primitive === 'crown'),
    title: titleRow ? titleFor(titleRow.options) : null,       // deterministic: the same text at every re-layer
    sticker: stickerRow ? stickerFor(stickerRow.options) : null,
  });
  if (member.nickname !== want) await member.setNickname(want, reason);
  for (const r of rows) await patchRow(sb, r.id, { options: { ...r.options, applied: want } });
  return want;
}

async function execute(client: Client, sb: Store, guild: Guild, row: EffectRow): Promise<void> {
  const member = await guild.members.fetch(row.target_id).catch(() => null);
  if (!member) { await patchRow(sb, row.id, { status: 'failed', error: 'not_in_guild' }); return; }
  const { reason, card, sender } = await reasonFor(sb, row);
  const p = row.primitive;
  // The bot itself is the one safe live-test target (it can rename itself and take roles).
  const self = member.id === guild.members.me?.id;
  // The server owner is a target like anyone (Nathan, 2026-10-03): a role or a voice prank is tried,
  // and Discord's own error (if any) is recorded by the tick. What Discord truly forbids (a nickname
  // layer, a timeout) the Activity refuses on the owner before the play; if it still fails here (any
  // member the bot cannot change), the play is REFUNDED (refund_card_play, effects_spread.sql).
  const ageS = (Date.now() - new Date(row.created_at).getTime()) / 1000;
  const endsAt = () => new Date(Date.now() + Math.max(5, Number(row.duration_s) || 30) * 1000).toISOString();
  if (VOICE.includes(p)) {
    if (!member.voice?.channelId) {
      // Not in voice now: the prank waits (it runs when they join), at most 48 hours.
      if (ageS > WAIT_S[p]!) await patchRow(sb, row.id, { status: 'skipped', error: 'never_in_voice' });
      return;
    }
    if (p === 'vc_mute') await member.voice.setMute(true, reason); else await member.voice.setDeaf(true, reason);
    await patchRow(sb, row.id, { status: 'active', revert_at: new Date(Date.now() + Math.max(5, Math.min(30, row.duration_s || 30)) * 1000).toISOString() });
    return;
  }
  if (p === 'color_role') {
    const hex = colorFor(row.options, ageS);
    if (!hex) return; // the target has not picked yet
    const role = await colorRole(guild, hex);
    if (!roleBelowBot(guild, role)) { await patchRow(sb, row.id, { status: 'failed', error: 'role_above_bot' }); return; }
    await member.roles.add(role, reason);
    await patchRow(sb, row.id, { status: 'active', original_value: role.id, revert_at: endsAt(), options: { ...row.options, color: hex } });
    return;
  }
  if (p === 'timeout') {
    if (!member.moderatable) { await refundPlay(sb, row, 'not_moderatable'); return; }
    await member.timeout(Math.max(5, Math.min(60, row.duration_s || 60)) * 1000, reason);
    await patchRow(sb, row.id, { status: 'done' });
  } else if (NICK.includes(p)) {
    const before = await nickRows(sb, row.target_id);
    const original = before.length ? before[0]!.original_value : JSON.stringify({ nick: member.nickname });
    const opts = { ...row.options };
    // The template uses the member's own name (not a name another effect gave them).
    const ownName = parseOrig(original) ?? member.user.globalName ?? member.user.username;
    if (p === 'nickname') opts.applied_nick = nickFromTemplate(pick(row.options.nicknames, '{name} the Pranked'), ownName);
    if (p === 'body_swap' && row.options.swap_side !== 'partner') {
      // Name Swap: the target takes the other member's own name; a second row gives the other member
      // the target's name (the same end). The other member = the sender (a reflected swap: the reflector).
      const otherId = String(row.target_id === String(row.options.sender_id ?? '') ? (row.options.credit_to ?? '') : (row.options.sender_id ?? ''));
      const other = otherId && otherId !== row.target_id ? await guild.members.fetch(otherId).catch(() => null) : null;
      if (!other) { await patchRow(sb, row.id, { status: 'failed', error: 'no_partner' }); return; }
      opts.applied_nick = cutText(await ownNameOf(sb, other), NICK_MAX);
      opts.pair_id = row.id;
      const end = row.revert_at ?? new Date(Date.now() + Math.min(3600, Number(row.duration_s) || 3600) * 1000).toISOString();
      if (!self && !member.manageable) { await refundPlay(sb, row, 'not_manageable'); return; } // before the other side
      if (other.id === guild.members.me?.id || other.manageable) {
        await sb.from('discord_effects').insert({ play_id: row.play_id, target_id: other.id, primitive: 'body_swap', amount: row.amount,
          duration_s: row.duration_s, status: 'pending', execute_after: new Date().toISOString(), revert_at: end,
          options: { ...row.options, swap_side: 'partner', pair_id: row.id, applied_nick: cutText(ownName, NICK_MAX) } });
      } else {
        opts.partner_error = 'not_manageable'; // the sender is the owner: only the target is renamed
      }
    }
    // play_card_effect sets revert_at (1 h); a row without one must still end (nobody stays renamed).
    const revertAt = row.revert_at ?? (p === 'title' || p === 'sticker' || p === 'body_swap' ? new Date(Date.now() + Math.min(3600, Number(row.duration_s) || 3600) * 1000).toISOString() : null);
    if (!self && !member.manageable) {
      // The other side of a swap is not the target: the target was renamed, so no refund.
      if (row.options.swap_side === 'partner') await patchRow(sb, row.id, { status: 'failed', error: 'not_manageable' });
      else await refundPlay(sb, row, 'not_manageable');
      return;
    }
    await patchRow(sb, row.id, { status: 'active', original_value: original, options: opts, ...(revertAt !== row.revert_at ? { revert_at: revertAt } : {}) });
    await applyNick(sb, member, [...before, { ...row, status: 'active', original_value: original, options: opts, revert_at: revertAt }], reason);
  } else if (p in ROLES) {
    // A role (also on the owner): Discord checks the ROLE position, not the member's (assumed for the
    // owner; the live check is listed in PR #151). member.manageable was the wrong test.
    const role = await ensureRole(guild, p);
    if (!roleBelowBot(guild, role)) { await patchRow(sb, row.id, { status: 'failed', error: 'role_above_bot' }); return; }
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
  } else if (p === 'slowmode') {
    // Slowmode: until revert_at (5 min), the bot deletes the target's messages that come less than
    // the gap after their last kept message in the same channel. Needs Manage Messages: fail closed.
    const perms = (guild.members.me as { permissions?: { has?: (p: bigint) => boolean } } | null)?.permissions;
    if (!perms?.has?.(PermissionFlagsBits.ManageMessages)) { await patchRow(sb, row.id, { status: 'failed', error: 'no_manage_messages' }); return; }
    const revertAt = row.revert_at ?? new Date(Date.now() + Math.min(300, Number(row.duration_s) || 300) * 1000).toISOString();
    const options = { ...row.options, card, gap_s: slowGapS(row.amount) };
    await patchRow(sb, row.id, { status: 'active', revert_at: revertAt, options });
    setSlow({ ...row, revert_at: revertAt, options });
  } else if (p === 'hot_take_poll') {
    // One Discord poll about the target (fixed question + answers from the card), in the plays channel.
    const name = member.nickname ?? member.user.globalName ?? member.user.username;
    const poll = pollFor(row.options, name, (Number(row.duration_s) || 3600) / 3600);
    const ok = await fxDeps.announce(client, { content: `📊 ${escapeMarkdown(sender)} played **${card}** on <@${row.target_id}>`, poll } as MessageCreateOptions, 'plays');
    // Active until the poll ends (no second poll on the same member before then); nothing to undo.
    await patchRow(sb, row.id, ok ? { status: 'active', revert_at: row.revert_at ?? new Date(Date.now() + poll.duration * 3600_000).toISOString() } : { status: 'failed', error: 'post_failed' });
  } else if (ARMED.includes(p)) {
    // Arm: wait (48 h from the play) for the target's next message / voice join.
    const revertAt = new Date(new Date(row.created_at).getTime() + ARM_S * 1000).toISOString();
    const options = { ...row.options, sender_name: sender, card };
    await patchRow(sb, row.id, { status: 'active', revert_at: revertAt, options });
    addArmed({ ...row, revert_at: revertAt, options });
  } else {
    await patchRow(sb, row.id, { status: 'skipped', error: 'not_built' });
  }
}

/** True when the role is under the bot's top role (Discord lets a bot give only those). */
function roleBelowBot(guild: Guild, role: Role): boolean {
  const top = guild.members.me?.roles?.highest?.position;
  return top == null || role.position < top;
}

/** Discord refused a nickname layer or a timeout (the owner, or a member the bot cannot change): the
 *  row fails with the reason, and the play is refunded (the sender's cooldown is cleared, the play
 *  does not count in the daily caps, outcome 'refunded'; the Activity tells the sender). */
async function refundPlay(sb: Store, row: EffectRow, reason: string): Promise<void> {
  await patchRow(sb, row.id, { status: 'failed', error: reason });
  if (row.play_id == null) return;
  const { error } = await sb.rpc('refund_card_play', { p_play: row.play_id, p_reason: reason });
  if (error) await patchRow(sb, row.id, { error: `${reason}; refund: ${String(error.message).slice(0, 150)}` });
}

/** A member's own name: the nickname before any effect (kept in the first nick row), else the nickname, else the Discord name. */
async function ownNameOf(sb: Store, m: GuildMember): Promise<string> {
  const rows = await nickRows(sb, m.id);
  const orig = rows.length ? parseOrig(rows[0]!.original_value) : m.nickname;
  return orig ?? m.user.globalName ?? m.user.username;
}

async function revert(sb: Store, guild: Guild, row: EffectRow): Promise<void> {
  const p = row.primitive;
  if (ARMED.includes(p)) {
    // Not used in 48 h (or cleansed / undone): nothing on Discord to undo.
    dropArmed(row.target_id, row.id);
    await patchRow(sb, row.id, { status: 'skipped', error: 'expired' });
    return;
  }
  if (p === 'slowmode') {
    slow.delete(row.target_id);
    await patchRow(sb, row.id, { status: 'reverted' });
    return;
  }
  if (p === 'body_swap' && row.options.pair_id != null) {
    // A swap ends for both members together (a cleanse or Undo all on one side ends the other side too).
    const pair = String(row.options.pair_id);
    const now = new Date().toISOString();
    await sb.from('discord_effects').update({ revert_at: now, updated_at: now })
      .eq('primitive', 'body_swap').eq('status', 'active').eq('options->>pair_id', pair).neq('id', row.id).gt('revert_at', now);
    await sb.from('discord_effects').update({ status: 'skipped', error: 'pair_ended', updated_at: now })
      .eq('primitive', 'body_swap').eq('status', 'pending').eq('options->>pair_id', pair).neq('id', row.id);
  }
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

/** One run at a time. A forced request during a run is not dropped: it runs once when the run
 *  ends (a voice join during a tick waited up to 1 h for its unmute; bot audit, 2026-10-03). */
export function serialRunner<A>(run: (arg: A, force: boolean) => Promise<void>): (arg: A, force?: boolean) => Promise<void> {
  let running = false;
  let queued: { arg: A } | null = null;
  const go = async (arg: A, force = false): Promise<void> => {
    if (running) { if (force) queued = { arg }; return; }
    running = true;
    try { await run(arg, force); } finally { running = false; }
    const next = queued as { arg: A } | null;
    queued = null;
    if (next) await go(next.arg, true);
  };
  return go;
}

/** force: a member joined voice - run the full tick without the bot_work() check (bot_work_waits.sql
 *  does not count the rows that wait for a voice join, so the join must run them itself). */
export const tick = serialRunner(runTick);
async function runTick(client: Client, force: boolean): Promise<void> {
  try {
    if (!force && !(await fxDeps.work()).fx) return; // nothing due (bot_work.sql: one question, not four)
    const sb = fxDeps.store();
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
        await fxDeps.announce(client, `<@${row.target_id}>`, 'plays'); // only the mention (Nathan, 2026-10-03); muted = no ping
        sent += 1;
      }
      await patchRow(sb, row.id, sent >= times.length ? { status: 'done', options: { ...row.options, sent } } : { options: { ...row.options, sent } });
    }
    // 3. Reaction storms: keep the live list in step with the table (after a restart too).
    const { data: st } = await sb.from('discord_effects').select('id, target_id, options').eq('status', 'active').eq('primitive', 'reaction_storm');
    storms.clear();
    for (const r of (st ?? []) as EffectRow[]) storms.set(r.target_id, { id: r.id, left: Number(r.options.left ?? 5), emoji: String(r.options.emoji ?? '🤡') });
    // 3a. Slowmode: the same.
    const { data: sl } = await sb.from('discord_effects').select('id, target_id, amount, options, revert_at').eq('status', 'active').eq('primitive', 'slowmode');
    const slowIds = new Set(((sl ?? []) as EffectRow[]).map((r) => r.target_id));
    for (const t of [...slow.keys()]) if (!slowIds.has(t)) slow.delete(t);
    for (const r of (sl ?? []) as EffectRow[]) setSlow(r);
    // 3b. Armed heckles / fanfares / squeakies: the same (the startup tick is forced for this).
    const { data: ar } = await sb.from('discord_effects').select('id, target_id, primitive, options, revert_at').eq('status', 'active').in('primitive', ARMED).order('created_at');
    armed.clear();
    for (const r of (ar ?? []) as EffectRow[]) addArmed(r);
    // 4. Undo what has ended (a cleanse sets revert_at = now()).
    const { data: due } = await sb.from('discord_effects').select('*').eq('status', 'active').lte('revert_at', now).order('created_at').limit(20);
    for (const row of (due ?? []) as EffectRow[]) {
      try { await revert(sb, guild, row); } catch (e) { await patchRow(sb, row.id, { error: `revert: ${String((e as Error).message).slice(0, 180)}` }); }
    }
  } catch (error) {
    console.error('discord-effects tick error:', error);
  }
}

/** Slowmode: true when the message came too soon and the bot deleted it (one notice, the first time). */
async function slowed(message: Message): Promise<boolean> {
  const sl = slow.get(message.author.id);
  if (!sl) return false;
  if (sl.until <= Date.now()) { slow.delete(message.author.id); return false; }
  const at = message.createdTimestamp ?? Date.now();
  const prev = sl.last.get(message.channelId);
  if (prev == null || at - prev >= sl.gapMs) { sl.last.set(message.channelId, at); return false; }
  const gone = await message.delete().then(() => true, () => false);
  if (gone && !sl.noticed) {
    sl.noticed = true;
    const ch = message.channel as unknown as { send?: (o: MessageCreateOptions) => Promise<unknown> };
    const content = `🐌 <@${message.author.id}> is in slowmode (**${sl.card}**): one message every ${Math.round(sl.gapMs / 1000)} seconds, until <t:${Math.ceil(sl.until / 1000)}:t>.`;
    if (typeof ch.send === 'function') await ch.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
    const sb = fxDeps.store();
    const { data } = await sb.from('discord_effects').select('options').eq('id', sl.id).maybeSingle();
    await patchRow(sb, sl.id, { options: { ...(data?.options ?? {}), noticed: true } });
  }
  return gone;
}

/** The reaction storm: react to the target's next messages. A heckle: reply once to the next one.
 *  A parrot / spongebob: repeat the next message that has text, once. Slowmode first: a deleted
 *  message gets nothing else. */
export async function onEffectMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (await slowed(message)) return;
  const [h] = takeArmed(message.author.id, ['heckle'], false);
  if (h) await heckle(message, h);
  const text = String(message.content ?? '').trim();
  if (!h && text) {
    const [e] = takeArmed(message.author.id, ECHO, false);
    if (e) await echo(message, e, text);
  }
  const s = storms.get(message.author.id);
  if (!s || s.left <= 0) return;
  s.left -= 1;
  await message.react(s.emoji).catch(() => {});
  const sb = fxDeps.store();
  const { data } = await sb.from('discord_effects').select('options').eq('id', s.id).maybeSingle();
  await patchRow(sb, s.id, s.left <= 0 ? { status: 'done', options: { ...(data?.options ?? {}), left: 0 } } : { options: { ...(data?.options ?? {}), left: s.left } });
  if (s.left <= 0) storms.delete(message.author.id);
}

/** Admin Undo all: every active Discord effect ends now (the next tick undoes them). */
export async function undoAll(client: Client): Promise<number> {
  const sb = fxDeps.store();
  const { data } = await sb.from('discord_effects').update({ revert_at: new Date().toISOString() }).eq('status', 'active').select('id');
  await sb.from('discord_effects').update({ status: 'skipped', error: 'undo_all' }).eq('status', 'pending');
  await tick(client);
  return (data ?? []).length;
}

/** The members no bot can rename or time out (Discord: the server owner), in settings discord_immune.
 *  The Activity reads it and refuses ONLY a nickname layer, a Name Swap or a timeout on them, before
 *  the play (nothing is spent); every other effect works on the owner (effects_spread, 2026-10-03). */
export async function storeImmune(client: Client): Promise<void> {
  try {
    const guild = await client.guilds.fetch(GUILD_ID());
    await fxDeps.store().from('settings').upsert({ key: 'discord_immune', value: [guild.ownerId], updated_at: new Date().toISOString() }, { onConflict: 'key' });
  } catch (e) { console.error('discord_immune:', e); }
}

export function startDiscordEffects(client: Client): ReturnType<typeof setInterval> | null {
  if (!discordEffectsEnabled()) return null;
  void storeImmune(client);
  // At start, forced (no bot_work() check): undo whatever ended while the bot was down, and rebuild
  // the in-memory lists (storms, armed heckles / fanfares), which bot_work() does not count as work.
  void tick(client, true);
  const timer = setInterval(() => { void tick(client); }, TICK_MS);
  console.log('Discord effects started (poll every 10s).');
  return timer;
}

async function echo(message: Message, a: Armed, text: string): Promise<void> {
  const sb = fxDeps.store();
  if (!(await claimArmed(sb, a.id))) return;
  // parse: [] = no @everyone / @here / role / user ping, even when the text has one.
  await message.reply({ content: echoLine(a.primitive, text), allowedMentions: { parse: [], repliedUser: false } })
    .catch((e: Error) => patchRow(sb, a.id, { error: `reply: ${String(e.message).slice(0, 180)}` }));
}

async function heckle(message: Message, h: Armed): Promise<void> {
  const sb = fxDeps.store();
  if (!(await claimArmed(sb, h.id))) return;
  const line = pick(h.options.lines, `🎤 ${String(h.options.sender_name ?? 'Someone')} says hi`).slice(0, 300);
  await message.reply({ content: line, allowedMentions: { parse: [], repliedUser: false } })
    .catch((e: Error) => patchRow(sb, h.id, { error: `reply: ${String(e.message).slice(0, 180)}` }));
}

/** The voice states the join check reads (discord.js VoiceState has these). */
export type VoiceSide = { id: string; channelId: string | null; channel?: unknown };
/** A join: not in voice before, in voice now (a move or a leave is not a join). */
export const isVoiceJoin = (before: VoiceSide, after: VoiceSide): boolean => !before.channelId && !!after.channelId;

const ENTRANCE: Record<string, (target: string, sender: string) => string> = {
  fanfare: (t, s) => `📯 <@${t}> has arrived! (Fanfare from ${s})`,
  squeaky: (t, s) => `🐔 <@${t}> squeaked in… (thanks to ${s})`,
};

/** A fanfare / squeaky: on the target's next voice JOIN, one post in that voice channel's text chat
 *  (discord.js v14 voice channels are text-based), else in the notifications channel. */
export async function onEffectVoice(client: Client, before: VoiceSide, after: VoiceSide): Promise<void> {
  if (!isVoiceJoin(before, after)) return;
  const due = takeArmed(after.id, ['fanfare', 'squeaky'], true);
  if (!due.length) return;
  const sb = fxDeps.store();
  for (const a of due) {
    try {
      if (!(await claimArmed(sb, a.id))) continue;
      const from = escapeMarkdown(String(a.options.sender_name ?? 'Someone'));
      // A card can bring its own line (Discord Pizza Party): "{target}" = the mention, "{sender}" = the sender.
      const own = typeof a.options.line === 'string' && a.options.line.trim() ? cutText(a.options.line.trim(), 300) : null;
      const content = own ? own.split('{target}').join(`<@${a.target}>`).split('{sender}').join(from) : ENTRANCE[a.primitive]!(a.target, from);
      const { data: c } = await sb.from('cards').select('image_url').eq('id', Number(a.options.card_id ?? 0)).maybeSingle();
      const png = await art((c as { image_url?: string | null } | null)?.image_url ?? null);
      const body: MessageCreateOptions = { content, components: [launchActivityRow()] };
      if (png) body.files = [new AttachmentBuilder(png, { name: 'card.png' })];
      const ch = after.channel as { isTextBased?: () => boolean; send?: (o: MessageCreateOptions) => Promise<unknown> } | null | undefined;
      let sent = false;
      if (ch?.isTextBased?.() && typeof ch.send === 'function') {
        sent = await ch.send({ ...body, allowedMentions: { parse: [] } }).then(() => true, () => false); // no ping in the voice chat
      }
      if (!sent) sent = await fxDeps.announce(client, body, 'plays');
      if (!sent) await patchRow(sb, a.id, { error: 'post_failed' });
    } catch (e) { await patchRow(sb, a.id, { error: `post: ${String((e as Error).message).slice(0, 180)}` }).catch(() => {}); }
  }
}
