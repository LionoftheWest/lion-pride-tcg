import { getSupabase } from './supabase.js';
import { balanceInt, getBalance } from './balance.js';
import {
  type PackAward,
  type PullTable,
  type Rarity,
  drawPack,
  pullTable,
} from './draw.js';
import { loadDrawPool, openPacksArgs } from './draw-pool.js';

/** A card as stored in the database. */
export interface Card {
  id: number;
  name: string;
  rarity: Rarity;
  source: string;
  image_url: string | null;
  artist_credit: string | null;
  lore: string | null;
  subject_name?: string | null;
  set_id?: string; // card_sets.sql: the set and the number in it ("S1 · #014", D-83)
  set_number?: number;
}

/** The result of opening earned packs. */
export interface OpenResult {
  award: PackAward;
  packs: Card[][];
}

// The game day is Mountain Time (Nathan, 2026-09-30; mt_clock.sql): "YYYY-MM-DD" in
// America/Denver. The name is kept for the callers; it is NOT the UTC day any more.
// The SQL game_day() (one_source_rules.sql) is the rule; store.test.ts proves this copy gives the same
// answers (shared/game-day-golden.json, which card-studio/scripts/test-one-source-rules.mjs checks against the SQL).
const mtDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
export function utcToday(at: Date = new Date()): string {
  return mtDay.format(at);
}

// A process-local cache of players we have already upserted this run (id -> the avatar
// hash saved), so we do not upsert the same player row on every single message.
const knownPlayers = new Map<string, string | null | undefined>();

/**
 * Insert a player row if it is absent, and keep the username fresh. `avatar` is the
 * Discord avatar hash (user.avatar): the Activity shows everyone's picture from it, so it
 * is saved whenever the bot sees a member and it changed (Nathan, 2026-09-30).
 */
export async function ensurePlayer(id: string, username: string, avatar?: string | null): Promise<void> {
  if (knownPlayers.has(id) && (avatar === undefined || knownPlayers.get(id) === avatar)) return;
  const supabase = getSupabase();
  const row: { id: string; username: string; avatar?: string } = { id, username };
  if (avatar) row.avatar = avatar;
  const { error } = await supabase.from('players').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`ensurePlayer failed: ${error.message}`);
  knownPlayers.set(id, avatar === undefined ? knownPlayers.get(id) : avatar);
}

// The earn dial (balance pack_earn_multiplier, balance_economy.sql), through the balance cache (60 s) so a
// message burst does not hammer the table. An event week just changes this value (/packrate).
async function earnMultiplier(): Promise<number> {
  const v = Number((await getBalance()).pack_earn_multiplier);
  if (!Number.isFinite(v) || v < 0) throw new Error('balance: pack_earn_multiplier is not a number');
  return v;
}
// The message count of the chat bonus pack (balance daily.chat_bonus_at; claim_daily_earn reads the same key).
export async function chatBonusAt(): Promise<number> {
  const d = (await getBalance()).daily as { chat_bonus_at?: unknown } | null;
  return balanceInt(d?.chat_bonus_at, 'daily.chat_bonus_at');
}
// The pull rates and the pack size (balance pulls), checked (draw.ts pullTable).
async function pulls(): Promise<PullTable> {
  return pullTable((await getBalance()).pulls);
}

/**
 * Count one message toward today, and earn packs the first time a threshold hits.
 * Returns the number of packs this message earned (0 for almost every message).
 */
export async function recordMessage(id: string, username: string, avatar?: string | null): Promise<number> {
  await ensurePlayer(id, username, avatar);
  // Dial 0 = earning paused (the launch reset, 2026-09-30). Count nothing: a counted
  // message would mark today's pack claimed with 0 packs, so the first message after
  // the resume must still be message 1 and earn the daily pack.
  if ((await earnMultiplier()) <= 0) return 0;
  const supabase = getSupabase();
  const today = utcToday();
  const { data: count, error } = await supabase.rpc('record_activity', {
    p_player_id: id,
    p_date: today,
  });
  if (error) throw new Error(`recordMessage failed: ${error.message}`);

  // Only run the earn check on the message that actually crosses a threshold.
  const bonusAt = await chatBonusAt();
  if (count === 1 || count === bonusAt) {
    const mult = await earnMultiplier();
    // claim_daily_earn decides the packs from balance (daily.chat / chat_bonus x the dial, balance_economy.sql)
    // and no longer reads these three numbers; they are still sent so an older function matches the call.
    const perPack = Math.max(0, Math.round(mult));
    const { data: granted, error: earnErr } = await supabase.rpc('claim_daily_earn', {
      p_player_id: id,
      p_date: today,
      p_base: perPack,
      p_bonus: perPack,
      p_bonus_threshold: bonusAt,
    });
    if (earnErr) throw new Error(`claim_daily_earn failed: ${earnErr.message}`);
    if (granted && granted > 0) {
      await notifyPlayer(id, 'pack_earned', `🎁 You earned ${granted} pack${granted === 1 ? '' : 's'}! Open them in the Lion Pride TCG activity.`);
      return granted;
    }
  }
  return 0;
}

/** Claim the one-time first-pack @mention. True only the first time for this player. */
export async function claimFirstPackPing(id: string): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('claim_first_pack_ping', { p_player: id });
  if (error) throw new Error(`claimFirstPackPing failed: ${error.message}`);
  return data === true;
}

/** Undo a claim whose channel post failed, so a later earn tries again. */
export async function releaseFirstPackPing(id: string): Promise<void> {
  await getSupabase().from('players').update({ first_pack_ping_at: null }).eq('id', id);
}

/** The player's current pack balance. */
export async function getPackBalance(id: string): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('players')
    .select('pack_balance')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getPackBalance failed: ${error.message}`);
  return data?.pack_balance ?? 0;
}


/** Add an in-app notification for a player (shown in the Activity, never a DM). */
export async function notifyPlayer(playerId: string, kind: string, message: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('notify_player', { p_player: playerId, p_kind: kind, p_message: message });
  if (error) throw new Error(`notifyPlayer failed: ${error.message}`);
}

/** Read / set the pack-earn multiplier dial (balance pack_earn_multiplier; balance_log records each change). */
export async function getMultiplierValue(): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('balance').select('value').eq('key', 'pack_earn_multiplier').maybeSingle();
  if (error) throw new Error(`getMultiplierValue failed: ${error.message}`);
  return Number(data?.value);
}
export async function setMultiplier(value: number): Promise<void> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('balance')
    .update({ value })
    .eq('key', 'pack_earn_multiplier')
    .select('key');
  if (error) throw new Error(`setMultiplier failed: ${error.message}`);
  if (!data?.length) throw new Error('setMultiplier failed: no balance key pack_earn_multiplier');
}

/** Move packs from one player's balance to another (player-to-player gift). */
export async function giftPacks(fromId: string, toId: string, amount: number): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('gift_packs', { p_from: fromId, p_to: toId, p_amount: amount });
  if (error) throw new Error(`giftPacks failed: ${error.message}`);
  return Boolean(data);
}

/**
 * A waiting Lucky Pull boon for this member (effects_cleanup.sql take_player_effect): its
 * amount, used up now, or null. Any error = no luck (the pack still opens).
 */
async function takeLuck(id: string): Promise<number | null> {
  try {
    const { data, error } = await getSupabase().rpc('take_player_effect', { p_player: id, p_primitive: 'lucky_pull' });
    if (error || data == null) return null;
    return Number(data) || null;
  } catch { return null; }
}


/**
 * Open up to `count` packs (the Activity's 1x/5x/10x) in ONE database call (open_packs,
 * tcg-bot/supabase/open_packs_batch.sql). The per-pack loop was 2 REST calls per pack:
 * 100 players opening 10 at once waited 38 s (pressure test, 2026-09-28). Stops where the
 * balance runs out. The spend and the cards are one transaction, so a failure loses no pack.
 */
export async function openPacks(id: string, username: string, count: number, setId?: string): Promise<Card[][]> {
  await ensurePlayer(id, username);
  // No set: every pullable set, as before. A set: only its cards; a set that is not pullable throws first.
  const pool = await getDrawPool(setId);
  if (pool.normal.length === 0) throw new Error('The card pool is empty. Add at least one Normal draw card with /seed first.');
  // A Lucky Pull boon goes on the first pack, and only when at least one pack can open.
  const table = await pulls(); // before the luck is used up: a balance error must not spend the boon
  const luck = count > 0 && (await getPackBalance(id).catch(() => 0)) > 0 ? await takeLuck(id) : null;
  const packs = Array.from({ length: count }, (_, i) => drawPack(pool, table, Math.random, i === 0 ? luck : null));
  const { data, error } = await getSupabase().rpc('open_packs', openPacksArgs(id, packs.flat().map((c) => c.id), table.pack_size, setId));
  if (error) throw new Error(`open_packs failed: ${error.message}`);
  return packs.slice(0, Number(data) || 0);
}

/** Load the draw-pool cards (draw-pool.ts: every pullable set, or one set), grouped by rarity, ready
 * for a pack draw. Cached 60s per set — the pool changes only when cards are added/removed, but it
 * was re-queried on EVERY open (one wasted round-trip per pack). */
const drawPoolCache = new Map<string, { at: number; pool: Record<Rarity, Card[]> }>();
const DRAW_POOL_TTL = 60_000;
async function getDrawPool(setId?: string): Promise<Record<Rarity, Card[]>> {
  const now = Date.now();
  const hit = drawPoolCache.get(setId ?? '');
  if (hit && now - hit.at < DRAW_POOL_TTL) return hit.pool;
  const pool = await loadDrawPool(getSupabase(), setId);
  drawPoolCache.set(setId ?? '', { at: now, pool });
  return pool;
}

/** Add every drawn card to the member's collection in ONE batched RPC. A pack
 * used to cost 5 separate add_card_to_player round-trips (the dominant open
 * latency under load); add_cards_to_player inserts them all in one statement. */
async function grantCards(playerId: string, cards: Card[]): Promise<void> {
  if (!cards.length) return;
  const supabase = getSupabase();
  const { error } = await supabase.rpc('add_cards_to_player', {
    p_player_id: playerId,
    p_card_ids: cards.map((c) => c.id),
  });
  if (error) throw new Error(`grantCards failed: ${error.message}`);
}

/**
 * Draw and grant packs immediately, ignoring the daily limit. Admin testing only.
 * Do not expose this to members.
 */
export async function openTestPacks(
  id: string,
  username: string,
  count: number,
  setId?: string,
): Promise<OpenResult> {
  await ensurePlayer(id, username);

  const pool = await getDrawPool(setId);
  if (pool.normal.length === 0) {
    throw new Error(
      'The card pool is empty. Add at least one Normal draw card with /seed first.',
    );
  }

  const table = await pulls();
  const packs: Card[][] = [];
  for (let i = 0; i < count; i += 1) {
    const pack = drawPack(pool, table);
    await grantCards(id, pack);
    packs.push(pack);
  }
  return { award: { base: true, bonus: count > 1 }, packs };
}

