// Remove tiers (card rows) of one card from the live game, and only then their images.
// Since PR #242 (the foreign keys), the database refuses to delete a card row that has history: a Hunt hit,
// a Shop purchase, a combat action, a card play, an auction, a gift claim or a wish grant. Before this module,
// the studio ignored that refusal and deleted the images anyway, so the live card kept its row and lost its art.
// The order now: delete the rows, check the error, and remove the images only after the database said yes.
// Test: scripts/test-studio-tier-delete.mjs (mocks the database and the storage).
// R2-MOVE (W4): the images go through src/art-store.js (bucket card-art; Supabase or R2 by ART_STORE and the state files).
import { createArtStore } from './art-store.js';

// The tables whose foreign key blocks a card delete (on delete no action), in plain words.
export const HISTORY = {
  auctions: 'an auction',
  card_plays: 'a played card effect',
  combat_actions: 'combat history (Hunt / Dungeon actions)',
  gift_claims: 'a gift claim',
  hunt_adjustments: 'Hunt history (an adjustment)',
  hunt_card_hp: 'Hunt history (card HP in a Hunt)',
  hunt_combat_log: 'Hunt history (the combat log)',
  hunt_hits: 'Hunt history (hits on a boss)',
  shop_purchases: 'a Shop purchase',
  wish_grants: 'a wish grant',
};

// A plain message for a refused delete. PostgreSQL names the first table that still points at the card:
// details = 'Key (id)=(12) is still referenced from table "hunt_hits".'
export function refusalMessage(error, tiers) {
  const text = `${error?.details || ''} ${error?.message || ''}`;
  const table = (text.match(/referenced from table "([a-z_]+)"/) || text.match(/on table "([a-z_]+)"\s*$/) || [])[1];
  const what = table ? HISTORY[table] || `rows in ${table}` : null;
  const tierList = tiers.join(', ');
  if (error?.code === '23503' || what) {
    return `The live game refused to delete ${tierList}: the card has ${what || 'history'} that must stay. ` +
      'Nothing was deleted, and the images were kept.';
  }
  return `The live game refused to delete ${tierList} (${error?.message || error}). Nothing was deleted, and the images were kept.`;
}

/**
 * Delete the card rows of the removed tiers, then their images.
 * @param {object} o
 * @param {object} o.db       a supabase client (from / storage)
 * @param {string} o.bucket   the storage bucket of the card art
 * @param {string} o.cardId   the studio card id (the subject key and the image name prefix)
 * @param {number} o.subjectId
 * @param {string[]} o.tiers  the removed tiers (rarities)
 * @returns {Promise<{ok: true, warning?: string} | {ok: false, error: string}>}
 */
export async function removeTiers({ db, bucket, cardId, subjectId, tiers, store = createArtStore({ db }) }) { // eslint-disable-line no-unused-vars
  if (!tiers.length) return { ok: true };
  // R2-MOVE: one logical write (the rows, then the images). Under FROZEN it does not start, so no row is deleted.
  let h;
  try { h = store.beginWrite(`tier-delete ${cardId} ${tiers.join(',')}`); } catch (e) { return { ok: false, error: `${e.message}. Nothing was deleted.` }; }
  try {
    const { data: rows, error: readErr } = await db.from('cards').select('id').eq('subject_id', subjectId).in('rarity', tiers);
    if (readErr) return { ok: false, error: `Could not read the live card rows (${readErr.message}). Nothing was deleted.` };
    const rowIds = (rows || []).map((r) => r.id);
    if (rowIds.length) {
      // One statement: the foreign keys remove the members' copies (player_cards) and their card_ledger rows with
      // the card, so the card ledger still reconciles. A card with history is refused as a whole.
      const { error } = await db.from('cards').delete().in('id', rowIds);
      if (error) return { ok: false, error: refusalMessage(error, tiers) };
    }
    // The database said yes (or had no rows for these tiers): now the images can go (art-store: Supabase or R2).
    try {
      await store.remove(tiers.flatMap((r) => [`cards/${cardId}-${r}.webp`, `cards/${cardId}-${r}.png`]));
    } catch (e) {
      return { ok: true, warning: `the rows are deleted, but the images were not removed from storage (${e.message})` };
    }
    return { ok: true };
  } finally { store.endWrite(h); }
}
