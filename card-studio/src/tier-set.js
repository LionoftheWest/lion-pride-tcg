/**
 * A set for each tier ("add a tier to a past card that belongs to another set only", Nathan 2026-10-16).
 * A card has ONE home set (cards.json `set`). A tier may carry its own set: card.tierDetails[slot].set. No own set = the
 * home set (the behavior of every card before this file). The database already supports it: each cards row (one per tier)
 * has its own set_id, and cards_set_rules gives it its own number in that set.
 * Pure functions plus two database helpers that take the client as a parameter (so a test can mock it).
 */
import { slotDetails, cardSetId, isSetId } from './cardstore.js';

/**
 * F-2: a push never moves a card to another set as a side effect. The live row keeps its set unless the card editor's
 * "Change home set" action recorded the move (card.setMoveFrom = the old set). Returns null when the row may be written
 * with setId, else the reason to stop. ownTier = the tier name for a tier that has its own set: a home set move never moves it.
 */
export function setMoveProblem(card, liveSetId, setId, ownTier = null) {
  if (!liveSetId || liveSetId === setId) return null;
  if (!ownTier && card.setMoveFrom === liveSetId) return null; // Nathan changed the home set on purpose
  if (ownTier) {
    return `The ${ownTier} tier of "${card.name}" is in set ${liveSetId} in the game, but its tier says ${setId}. A push does not move a tier between sets.`;
  }
  return `"${card.name}" is in set ${liveSetId} in the game, but its card says ${setId}. A push does not move a card between sets. `
    + 'To move it (it gets a new number), use "Change home set" on the card page. To add it to another set, add it to the pool of that set.';
}

/** The set a tier is printed and numbered in: its own set, else the home set. Throws (cardSetId) when there is none. */
export function tierSetId(card, slot) {
  const own = card?.tierDetails?.[slot]?.set;
  if (own == null || own === '') return cardSetId(card);
  if (!isSetId(own)) throw new Error(`card ${card?.id}: bad set id ${JSON.stringify(own)} for the ${slot} tier (for example "S2")`);
  return own;
}

/** The same, without a throw: null when the card has no set at all (the lists and the UI). */
export function tierSetOrNull(card, slot) {
  try { return tierSetId(card, slot); } catch { return null; }
}

/** True when the tier has its own set that is not the home set. */
export const hasOwnSet = (card, slot) => {
  const own = card?.tierDetails?.[slot]?.set;
  return Boolean(own) && own !== card.set;
};

/**
 * The plan of a push: one entry per tier { rarity, slot, setId, own }. Throws the reason (setMoveProblem) when a live row of a
 * tier is in another set than the one the tier says: a tier that is live in S1 is never moved to S2 by a push.
 * liveRows: Map rarity -> { id, set_id }.
 */
export function planTierSets(card, finishes, liveRows, artKeyFor = (r) => r) {
  // Every live row counts, also one of a tier that is not on the card (as before this file): it is never moved either.
  const all = [...new Set([...finishes, ...liveRows.keys()])];
  return all.map((rarity) => {
    const slot = artKeyFor(rarity);
    const setId = tierSetId(card, slot);
    const own = hasOwnSet(card, slot);
    const live = liveRows.get(rarity);
    const why = live ? setMoveProblem(card, live.set_id, setId, own ? rarity : null) : null;
    if (why) throw new Error(why);
    return { rarity, slot, setId, own };
  });
}

/** The distinct sets of a push (the home set first): each must exist in card_sets before any upload. */
export const planSets = (plan, homeSet) => [...new Set([homeSet, ...plan.map((p) => p.setId)])];

/**
 * Write the cards row of one tier and CHECK the result. An existing row is updated, a new tier is inserted with its own set.
 * fields: the columns of the row (set_id included). Throws `card <rarity>: <message>` on any error.
 */
export async function writeTierRow({ db, existing, subjectId, rarity, fields }) {
  if (existing) {
    const { error } = await db.from('cards').update(fields).eq('id', existing.id);
    if (error) throw new Error(`card ${rarity}: ${error.message}`);
  } else {
    const { error } = await db.from('cards').insert({ subject_id: subjectId, rarity, ...fields });
    if (error) throw new Error(`card ${rarity}: ${error.message}`);
  }
}

/**
 * The set of one tier changed in the card editor (POST /api/details/:id/:slot, body.set). Returns
 * { ok: true, value } (value = the id to store, or null to clear = the home set) or { ok: false, status, error }.
 * A tier that is live in another set is refused: a push does not move it, and the editor must not say otherwise.
 */
export async function checkTierSetChange({ db, card, slot, set }) {
  const value = set === '' || set == null || set === card.set ? null : set;
  if (value !== null && !isSetId(value)) return { ok: false, status: 400, error: 'Choose a set.' };
  const target = value ?? card.set;
  if (target) {
    const { data: s, error: se } = await db.from('card_sets').select('id').eq('id', target).maybeSingle();
    if (se) return { ok: false, status: 502, error: 'Could not reach the game database: ' + se.message };
    if (!s) return { ok: false, status: 400, error: `No set ${target}.` };
  }
  const { data: subject, error: ue } = await db.from('subjects').select('id').eq('key', card.id).maybeSingle();
  if (ue) return { ok: false, status: 502, error: 'Could not reach the game database: ' + ue.message };
  if (subject) {
    const { data: rows, error: re } = await db.from('cards').select('set_id').eq('subject_id', subject.id).eq('rarity', slot);
    if (re) return { ok: false, status: 502, error: 'Could not reach the game database: ' + re.message };
    const live = rows?.[0]?.set_id;
    if (live && target && live !== target) {
      return { ok: false, status: 409, error: `This tier is live in set ${live}. A push does not move a tier to another set, so its set stays ${live}.` };
    }
  }
  return { ok: true, value };
}

/** The live set of the card's HOME tiers: the rows of tiers that have no own set of their own (the home move rule). */
export function homeLiveSet(card, rows) {
  const home = (rows || []).filter((r) => !hasOwnSet(card, r.rarity));
  return home[0]?.set_id || null;
}

export { slotDetails };
