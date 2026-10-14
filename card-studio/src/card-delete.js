// Delete a WHOLE card from the studio (Nathan, 2026-10-14: "there isn't a way to delete a card completely").
// Test: scripts/test-studio-card-delete.mjs (mocks the database, the storage and the files).
//
// The flow:
//   not live (no subjects row for the key): remove the local entry and the local files. Nothing else exists.
//   live: 1. removeTiers for ALL live tiers (src/tier-delete.js): the card rows go first, the images only after the
//            database said yes. A card with history (Hunt, Shop, combat, plays, auction, gift claim, wish grant) is
//            refused: then NOTHING changed, here or live (status 409).
//         2. the subject: its cooldown rows (card_effect_cooldowns, no history) and then the subjects row. If the
//            database refuses here, the local card stays (status 409) and the message says what was already removed.
//         3. the admin log row (admin_log_action), then the local entry and files. A failure of step 3 is a warning:
//            the live delete is done and cannot be undone.
// A number in the set stays as a gap (cards.set_number is not reused).
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { removeTiers } from './tier-delete.js';

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The local files of one card: art/<id>-<slot>.<ext> and out/gallery-<id>-<slot>.png. The slot has no "-", so a card
 * whose id starts with this id and a dash ("dragon-king" next to "dragon") is never matched.
 */
export function localFilesOf(id, artDir, outDir) {
  const art = new RegExp(`^${esc(id)}-[a-z_]+\\.[a-z0-9]+$`);
  const gal = new RegExp(`^gallery-${esc(id)}-[a-z_]+\\.png$`);
  const list = (dir, re) => (existsSync(dir) ? readdirSync(dir).filter((n) => re.test(n)).map((n) => join(dir, n)) : []);
  return [...list(artDir, art), ...list(outDir, gal)];
}

function readJson(file) {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; } catch { return null; }
}
const writeJson = (file, v) => writeFileSync(file, JSON.stringify(v, null, 2), 'utf8');

/**
 * Remove the local side of a card: its files and its entries in art/_sources.json, _frames.json and _artists.json.
 * (Tags and tier details live inside the cards.json entry, so removing that entry removes them.)
 * A tier of ANOTHER card that reused this card's art (art/_sources.json) loses that pointer: it is counted and returned.
 * @returns {{files: number, orphanedSources: number}}
 */
export function removeLocalFiles({ id, artDir, outDir }) {
  let files = 0;
  for (const f of localFilesOf(id, artDir, outDir)) { try { unlinkSync(f); files++; } catch { /* ignore */ } }
  const srcFile = join(artDir, '_sources.json');
  const src = readJson(srcFile);
  let orphanedSources = 0;
  if (src) {
    delete src[id];
    for (const [other, slots] of Object.entries(src)) {
      for (const [slot, s] of Object.entries(slots || {})) if (s?.fromId === id) { delete slots[slot]; orphanedSources++; }
      if (!Object.keys(slots || {}).length) delete src[other];
    }
    writeJson(srcFile, src);
  }
  const frFile = join(artDir, '_frames.json');
  const fr = readJson(frFile);
  if (fr) {
    for (const k of Object.keys(fr)) if (new RegExp(`^${esc(id)}-[a-z_]+$`).test(k)) delete fr[k];
    writeJson(frFile, fr);
  }
  const arFile = join(artDir, '_artists.json');
  const ar = readJson(arFile);
  if (ar) { delete ar[id]; writeJson(arFile, ar); }
  return { files, orphanedSources };
}

/**
 * @param {object} o
 * @param {object} o.db        a supabase client (from / storage / rpc)
 * @param {string} o.bucket    the storage bucket of the card art
 * @param {object} o.card      the cards.json entry ({ id, name, finishes })
 * @param {string} o.actor     the admin log actor, for example "studio:nathan"
 * @param {() => object} o.removeLocal  removes the cards.json entry and the files; returns { files, orphanedSources }
 * @returns {Promise<{ok: true, live: boolean, warnings: string[]} | {ok: false, status: number, error: string}>}
 */
export async function deleteWholeCard({ db, bucket, card, actor, removeLocal }) {
  const warnings = [];
  let subject;
  try {
    const q = await db.from('subjects').select('id').eq('key', card.id).maybeSingle();
    if (q.error) throw new Error(q.error.message);
    subject = q.data;
  } catch (e) {
    return { ok: false, status: 502, error: `Could not reach the live game, so nothing was deleted (${e.message || e}).` };
  }

  if (!subject) {
    const l = removeLocal();
    return { ok: true, live: false, warnings: orphanWarning(l, warnings), local: l };
  }

  // 1. The card rows of every live tier (also a live tier that cards.json no longer lists), then their images.
  let tiers = [...(card.finishes || [])];
  try {
    const rows = await db.from('cards').select('rarity').eq('subject_id', subject.id);
    if (rows.error) throw new Error(rows.error.message);
    tiers = [...new Set([...tiers, ...(rows.data || []).map((r) => r.rarity)])];
  } catch (e) {
    return { ok: false, status: 502, error: `Could not read the live card rows, so nothing was deleted (${e.message || e}).` };
  }
  let r;
  try {
    r = await removeTiers({ db, bucket, cardId: card.id, subjectId: subject.id, tiers });
  } catch (e) {
    r = { ok: false, error: `The live delete failed, so nothing was deleted (${e.message || e}).` };
  }
  if (!r.ok) return { ok: false, status: 409, error: r.error };
  if (r.warning) warnings.push(r.warning);

  // 2. The subject. Its cooldown rows hold no history, so they go first; the subjects row follows.
  const done = `The live card rows${r.warning ? '' : ' and images'} are already deleted and the card stays in the studio.`;
  const cd = await db.from('card_effect_cooldowns').delete().eq('subject_id', subject.id);
  if (cd.error) return { ok: false, status: 409, error: `The live game refused to delete the cooldown rows of this card (${cd.error.message}). ${done}` };
  const sd = await db.from('subjects').delete().eq('id', subject.id);
  if (sd.error) return { ok: false, status: 409, error: `The live game refused to delete the card subject (${sd.error.message}). ${done}` };

  // 3. The admin log, then the local side. Both are warnings only: the live delete cannot be undone.
  try {
    const lg = await db.rpc('admin_log_action', {
      p_actor: actor, p_action: 'card_delete', p_target_kind: 'card', p_target_id: card.id,
      p_before: { name: card.name, tiers }, p_after: null, p_reason: 'studio: Delete card', p_source: 'studio',
    });
    if (lg.error) throw new Error(lg.error.message);
  } catch (e) {
    warnings.push(`the admin log row was not written (${e.message || e})`);
  }
  let l = { files: 0, orphanedSources: 0 };
  try { l = removeLocal(); } catch (e) { warnings.push(`the live card is deleted, but the local files were not removed (${e.message || e})`); }
  return { ok: true, live: true, warnings: orphanWarning(l, warnings), local: l };
}

function orphanWarning(l, warnings) {
  if (l?.orphanedSources) warnings.push(`${l.orphanedSources} tier(s) of other cards reused the art of this card and now have no art`);
  return warnings;
}
