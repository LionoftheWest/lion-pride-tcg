import { getSupabase } from './supabase.js';
import {
  type DailyActivity,
  type PackAward,
  type Rarity,
  BONUS_THRESHOLD,
  drawPack,
  groupByRarity,
  packsToAward,
} from './draw.js';

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
}

/** One owned line in a member's collection. */
export interface OwnedCard {
  quantity: number;
  card: Card;
}

/** The result of opening earned packs. */
export interface OpenResult {
  award: PackAward;
  packs: Card[][];
}

/** The current UTC day as an ISO date string, for example "2026-09-08". */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// A process-local cache of players we have already inserted this run, so we do
// not upsert the same player row on every single message.
const knownPlayers = new Set<string>();

/** Insert a player row if it is absent, and keep the username fresh. */
export async function ensurePlayer(id: string, username: string): Promise<void> {
  if (knownPlayers.has(id)) return; // already upserted this run — skip the round-trip
  const supabase = getSupabase();
  const { error } = await supabase
    .from('players')
    .upsert({ id, username }, { onConflict: 'id' });
  if (error) throw new Error(`ensurePlayer failed: ${error.message}`);
  knownPlayers.add(id);
}

// The earn dial (settings.pack_earn_multiplier), cached briefly so a message
// burst does not hammer the settings table. An event week just changes this value.
let multiplierCache = { value: 1, at: 0 };
async function earnMultiplier(): Promise<number> {
  if (Date.now() - multiplierCache.at < 60_000) return multiplierCache.value;
  const supabase = getSupabase();
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'pack_earn_multiplier')
    .maybeSingle();
  const v = Number(data?.value);
  multiplierCache = { value: Number.isFinite(v) && v >= 0 ? v : 1, at: Date.now() };
  return multiplierCache.value;
}

/** Count one message toward today, and earn packs the first time a threshold hits. */
export async function recordMessage(id: string, username: string): Promise<void> {
  if (!knownPlayers.has(id)) {
    await ensurePlayer(id, username);
  }
  const supabase = getSupabase();
  const today = utcToday();
  const { data: count, error } = await supabase.rpc('record_activity', {
    p_player_id: id,
    p_date: today,
  });
  if (error) throw new Error(`recordMessage failed: ${error.message}`);

  // Only run the earn check on the message that actually crosses a threshold.
  if (count === 1 || count === BONUS_THRESHOLD) {
    const mult = await earnMultiplier();
    const perPack = Math.max(0, Math.round(mult)); // base = 1 pack, bonus = 1 pack, scaled by the dial
    const { data: granted, error: earnErr } = await supabase.rpc('claim_daily_earn', {
      p_player_id: id,
      p_date: today,
      p_base: perPack,
      p_bonus: perPack,
      p_bonus_threshold: BONUS_THRESHOLD,
    });
    if (earnErr) throw new Error(`claim_daily_earn failed: ${earnErr.message}`);
    if (granted && granted > 0) {
      await notifyPlayer(id, 'pack_earned', `🎁 You earned ${granted} pack${granted === 1 ? '' : 's'}! Open them in the Lion Pride TCG activity.`);
    }
  }
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

/** Grant packs to EVERY player (a server-wide event drop). Returns how many players. */
export async function grantPacksAll(amount: number, reason: string, by?: string): Promise<number> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('grant_packs_all', {
    p_amount: amount,
    p_reason: reason,
    p_by: by ?? null,
  });
  if (error) throw new Error(`grantPacksAll failed: ${error.message}`);
  return (data as number) ?? 0;
}

/** A player's recent notifications (newest first). */
export async function getNotifications(playerId: string, limit = 15): Promise<
  { id: number; kind: string; message: string; read: boolean; created_at: string }[]
> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, message, read, created_at')
    .eq('player_id', playerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getNotifications failed: ${error.message}`);
  return (data ?? []) as { id: number; kind: string; message: string; read: boolean; created_at: string }[];
}

/** Mark all of a player's notifications read. */
export async function markNotificationsRead(playerId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('notifications').update({ read: true }).eq('player_id', playerId).eq('read', false);
}

/** Add an in-app notification for a player (shown in the Activity, never a DM). */
export async function notifyPlayer(playerId: string, kind: string, message: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('notify_player', { p_player: playerId, p_kind: kind, p_message: message });
  if (error) throw new Error(`notifyPlayer failed: ${error.message}`);
}
/** Notify EVERY player (server-wide event). */
export async function notifyAll(kind: string, message: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('notify_all', { p_kind: kind, p_message: message });
  if (error) throw new Error(`notifyAll failed: ${error.message}`);
}

/** Read / set the pack-earn multiplier dial. */
export async function getMultiplierValue(): Promise<number> {
  const supabase = getSupabase();
  const { data } = await supabase.from('settings').select('value').eq('key', 'pack_earn_multiplier').maybeSingle();
  const v = Number(data?.value);
  return Number.isFinite(v) ? v : 1;
}
export async function setMultiplier(value: number): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', 'pack_earn_multiplier');
  if (error) throw new Error(`setMultiplier failed: ${error.message}`);
}

/** Move packs from one player's balance to another (player-to-player gift). */
export async function giftPacks(fromId: string, toId: string, amount: number): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('gift_packs', { p_from: fromId, p_to: toId, p_amount: amount });
  if (error) throw new Error(`giftPacks failed: ${error.message}`);
  return Boolean(data);
}

/** Grant packs to a player (gift / event / admin). Returns the new balance. */
export async function grantPacks(id: string, amount: number, reason: string, by?: string): Promise<number | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('grant_packs', {
    p_player_id: id,
    p_amount: amount,
    p_reason: reason,
    p_by: by ?? null,
  });
  if (error) throw new Error(`grantPacks failed: ${error.message}`);
  return (data as number | null) ?? null;
}

/**
 * Spend ONE pack from the balance and draw it. Returns the drawn cards, or null
 * if the player has no packs. This is the single open path for /open and the
 * Activity, so the balance is the one source of truth.
 */
export async function openOnePack(id: string, username: string): Promise<Card[] | null> {
  await ensurePlayer(id, username);
  const supabase = getSupabase();
  const { data: ok, error } = await supabase.rpc('spend_pack', { p_player_id: id });
  if (error) throw new Error(`spend_pack failed: ${error.message}`);
  if (!ok) return null;

  const pool = await getDrawPool();
  if (pool.normal.length === 0) {
    await grantPacks(id, 1, 'admin', 'refund_empty_pool'); // give the pack back
    throw new Error('The card pool is empty. Add at least one Normal draw card with /seed first.');
  }
  const pack = drawPack(pool);
  await grantCards(id, pack);
  return pack;
}

/** Read a member's activity row for today. Absent means no messages yet. */
async function getTodayActivity(id: string): Promise<DailyActivity> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('daily_activity')
    .select('message_count, base_claimed, bonus_claimed')
    .eq('player_id', id)
    .eq('activity_date', utcToday())
    .maybeSingle();
  if (error) throw new Error(`getTodayActivity failed: ${error.message}`);

  return {
    messageCount: data?.message_count ?? 0,
    baseClaimed: data?.base_claimed ?? false,
    bonusClaimed: data?.bonus_claimed ?? false,
  };
}

/** Load every draw-pool card, grouped by rarity, ready for a pack draw. Cached
 * 60s — the pool changes only when cards are added/removed, but it was re-queried
 * on EVERY open (one wasted round-trip per pack). */
let drawPoolCache: { at: number; pool: Record<Rarity, Card[]> } | null = null;
const DRAW_POOL_TTL = 60_000;
async function getDrawPool(): Promise<Record<Rarity, Card[]>> {
  const now = Date.now();
  if (drawPoolCache && now - drawPoolCache.at < DRAW_POOL_TTL) return drawPoolCache.pool;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('cards')
    .select('id, name, rarity, source, image_url, artist_credit, lore')
    .eq('in_draw_pool', true)
    .eq('source', 'draw');
  if (error) throw new Error(`getDrawPool failed: ${error.message}`);
  const pool = groupByRarity((data ?? []) as Card[]);
  drawPoolCache = { at: now, pool };
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
 * Open every pack the member has earned today but not yet claimed.
 * Returns the opened packs. An empty result means nothing was earned.
 */
export async function openEarnedPacks(
  id: string,
  username: string,
): Promise<OpenResult> {
  await ensurePlayer(id, username);

  const activity = await getTodayActivity(id);
  const award = packsToAward(activity);
  if (!award.base && !award.bonus) {
    return { award, packs: [] };
  }

  const pool = await getDrawPool();
  if (pool.normal.length === 0) {
    throw new Error(
      'The card pool is empty. Add at least one Normal draw card with /seed first.',
    );
  }

  const packs: Card[][] = [];
  const claimed: Record<string, boolean> = {};

  if (award.base) {
    const pack = drawPack(pool);
    await grantCards(id, pack);
    packs.push(pack);
    claimed.base_claimed = true;
  }
  if (award.bonus) {
    const pack = drawPack(pool);
    await grantCards(id, pack);
    packs.push(pack);
    claimed.bonus_claimed = true;
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('daily_activity')
    .update(claimed)
    .eq('player_id', id)
    .eq('activity_date', utcToday());
  if (error) throw new Error(`marking packs claimed failed: ${error.message}`);

  return { award, packs };
}

/**
 * Draw and grant packs immediately, ignoring the daily limit. Admin testing only.
 * Do not expose this to members.
 */
export async function openTestPacks(
  id: string,
  username: string,
  count: number,
): Promise<OpenResult> {
  await ensurePlayer(id, username);

  const pool = await getDrawPool();
  if (pool.normal.length === 0) {
    throw new Error(
      'The card pool is empty. Add at least one Normal draw card with /seed first.',
    );
  }

  const packs: Card[][] = [];
  for (let i = 0; i < count; i += 1) {
    const pack = drawPack(pool);
    await grantCards(id, pack);
    packs.push(pack);
  }
  return { award: { base: true, bonus: count > 1 }, packs };
}

/** Load a member's full collection, highest rarity value first is left to the caller. */
export async function getCollection(id: string): Promise<OwnedCard[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('player_cards')
    .select(
      'quantity, card:cards(id, name, rarity, source, image_url, artist_credit, lore, subject:subjects(name))',
    )
    .eq('player_id', id);
  if (error) throw new Error(`getCollection failed: ${error.message}`);

  // Supabase types the nested join loosely, so shape it here.
  return ((data ?? []) as unknown as RawOwned[]).map((row) => ({
    quantity: row.quantity,
    card: {
      id: row.card.id,
      name: row.card.name,
      rarity: row.card.rarity,
      source: row.card.source,
      image_url: row.card.image_url,
      artist_credit: row.card.artist_credit,
      lore: row.card.lore,
      subject_name: row.card.subject?.name ?? null,
    },
  }));
}

interface RawOwned {
  quantity: number;
  card: {
    id: number;
    name: string;
    rarity: Rarity;
    source: string;
    image_url: string | null;
    artist_credit: string | null;
    lore: string | null;
    subject: { name: string } | null;
  };
}

/** Find one card by an exact (case-insensitive) name. */
export async function findCardByName(name: string): Promise<Card | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('cards')
    .select(
      'id, name, rarity, source, image_url, artist_credit, lore, subject:subjects(name)',
    )
    .ilike('name', name)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`findCardByName failed: ${error.message}`);
  if (!data) return null;

  const raw = data as unknown as RawOwned['card'];
  return {
    id: raw.id,
    name: raw.name,
    rarity: raw.rarity,
    source: raw.source,
    image_url: raw.image_url,
    artist_credit: raw.artist_credit,
    lore: raw.lore,
    subject_name: raw.subject?.name ?? null,
  };
}

/** Shape a raw joined card row into a Card. */
function mapCard(raw: RawOwned['card']): Card {
  return {
    id: raw.id,
    name: raw.name,
    rarity: raw.rarity,
    source: raw.source,
    image_url: raw.image_url,
    artist_credit: raw.artist_credit,
    lore: raw.lore,
    subject_name: raw.subject?.name ?? null,
  };
}

/** Load one card by its id. */
export async function getCardById(id: number): Promise<Card | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('cards')
    .select(
      'id, name, rarity, source, image_url, artist_credit, lore, subject:subjects(name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getCardById failed: ${error.message}`);
  if (!data) return null;
  return mapCard(data as unknown as RawOwned['card']);
}

/** Load the whole catalog, for the Browse Cards view. */
export async function getAllCards(): Promise<Card[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('cards')
    .select(
      'id, name, rarity, source, image_url, artist_credit, lore, subject:subjects(name)',
    );
  if (error) throw new Error(`getAllCards failed: ${error.message}`);
  return ((data ?? []) as unknown as RawOwned['card'][]).map(mapCard);
}

export interface DailyStatus extends DailyActivity {
  baseAvailable: boolean;
  bonusAvailable: boolean;
}

/** Read a member's daily status: message count and which packs are still open. */
export async function getDailyStatus(id: string): Promise<DailyStatus> {
  const activity = await getTodayActivity(id);
  const award = packsToAward(activity);
  return { ...activity, baseAvailable: award.base, bonusAvailable: award.bonus };
}

export interface PlayerSummary {
  totalUnique: number;
  totalCopies: number;
  rarest: Card | null;
}

const RARITY_RANK: Record<string, number> = {
  normal: 0,
  illustrated_rare: 1,
  secret_rare: 2,
  full_art: 3,
  gold: 4,
};

/** A per-member summary for the panel dashboard. */
export async function getPlayerSummary(id: string): Promise<PlayerSummary> {
  const owned = await getCollection(id);
  let totalCopies = 0;
  let rarest: Card | null = null;
  for (const row of owned) {
    totalCopies += row.quantity;
    if (!rarest || RARITY_RANK[row.card.rarity]! > RARITY_RANK[rarest.rarity]!) {
      rarest = row.card;
    }
  }
  return { totalUnique: owned.length, totalCopies, rarest };
}

/** Turn a subject name into a stable slug key, for example "Ember Fox" -> "ember-fox". */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface NewCard {
  subjectName: string;
  name: string;
  rarity: Rarity;
  imageUrl?: string;
  artistCredit?: string;
  lore?: string;
}

/** Create a card, and its subject if that subject is new. For seeding and testing. */
export async function addCard(input: NewCard): Promise<Card> {
  const supabase = getSupabase();
  const key = slugify(input.subjectName);

  const { data: subject, error: subjectError } = await supabase
    .from('subjects')
    .upsert({ key, name: input.subjectName }, { onConflict: 'key' })
    .select('id')
    .single();
  if (subjectError) throw new Error(`addCard subject failed: ${subjectError.message}`);

  const { data: card, error: cardError } = await supabase
    .from('cards')
    .insert({
      subject_id: subject.id,
      name: input.name,
      rarity: input.rarity,
      image_url: input.imageUrl ?? null,
      artist_credit: input.artistCredit ?? null,
      lore: input.lore ?? null,
    })
    .select('id, name, rarity, source, image_url, artist_credit, lore')
    .single();
  if (cardError) throw new Error(`addCard failed: ${cardError.message}`);

  return card as Card;
}
