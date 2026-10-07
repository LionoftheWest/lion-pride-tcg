// The cards a pack can give (D-80 to D-84, tcg-bot/supabase/card_sets.sql). The database view draw_pool is
// the one definition: in the draw pool, source draw, and the set is pullable. With no set, a pack draws from
// every pullable set (the old behavior while Season 1 is the only set). With a set, only from that set, and
// the set must be pullable. The odds stay the one balance row `pulls` (D-82): they are not read here.
import type { SupabaseClient } from '@supabase/supabase-js';
import { type Rarity, groupByRarity } from './draw.js';
import type { Card } from './store.js';

/** The error text for a set that a pack cannot open from (unknown, or not pullable). */
export const SET_NOT_PULLABLE = 'set_not_pullable';

/** A set id as card_sets.id allows it (1 to 8 capitals or digits). */
export const isSetId = (v: unknown): v is string => typeof v === 'string' && /^[A-Z0-9]{1,8}$/.test(v);

const COLS = 'id, name, rarity, source, image_url, artist_credit, lore, set_id, set_number';

/** Load the draw pool (all pullable sets, or one set), grouped by rarity. Throws SET_NOT_PULLABLE for a bad set. */
export async function loadDrawPool(sb: SupabaseClient, setId?: string): Promise<Record<Rarity, Card[]>> {
  if (setId !== undefined) {
    if (!isSetId(setId)) throw new Error(SET_NOT_PULLABLE);
    const { data: set, error: se } = await sb.from('card_sets').select('id, pullable').eq('id', setId).maybeSingle();
    if (se) throw new Error(`loadDrawPool failed: ${se.message}`);
    if (!set || (set as { pullable?: boolean }).pullable !== true) throw new Error(SET_NOT_PULLABLE);
  }
  let q = sb.from('draw_pool').select(COLS);
  if (setId !== undefined) q = q.eq('set_id', setId);
  const { data, error } = await q;
  if (error) throw new Error(`getDrawPool failed: ${error.message}`);
  return groupByRarity((data ?? []) as Card[]);
}

/** The open_packs arguments. With no set: exactly the 3 old arguments (the 3-argument function, unchanged). */
export function openPacksArgs(playerId: string, cardIds: number[], packSize: number, setId?: string): Record<string, unknown> {
  const args: Record<string, unknown> = { p_player_id: playerId, p_cards: cardIds, p_size: packSize };
  if (setId !== undefined) args.p_set = setId;
  return args;
}
