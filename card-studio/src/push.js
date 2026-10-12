import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const execFileP = promisify(execFile);
const FRAMES = 24; // frames Blender renders per animated tier (for progress)
import { supabase } from './supabase.js';
import { renderPng } from './render.js';
import { artKeyFor, ANIMATED, inDrawPool, needsPeriod } from './rarity.js';
import { getFrame } from './frames.js';
import { makeThumbs, gridObject, revealObject } from './thumbs.js';
import { getArtist } from './artists.js';
import { publicUrl } from './storage-url.js';
import { slotDetails, subjectType, CARD_TYPES, cardSetId } from './cardstore.js';

/**
 * F-2: a push never moves a card to another set as a side effect. The live row keeps its home set unless the
 * card editor's "Change home set" action recorded the move (card.setMoveFrom = the old set). Returns null when
 * the row may be written with setId, else the reason to stop.
 */
export function setMoveProblem(card, liveSetId, setId) {
  if (!liveSetId || liveSetId === setId) return null;
  if (card.setMoveFrom === liveSetId) return null; // Nathan changed the home set on purpose
  return `"${card.name}" is in set ${liveSetId} in the game, but its card says ${setId}. A push does not move a card between sets. `
    + 'To move it (it gets a new number), use "Change home set" on the card page. To add it to another set, add it to the pool of that set.';
}

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const BUCKET = 'card-art';

const BLENDER = [
  'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe',
].find(existsSync);
const ANIM_SCRIPT = join(ROOT, 'blender', 'animate_face.py');
const ENCODE_SCRIPT = join(ROOT, 'blender', 'encode.py');

// Which tiers render through Blender (animated foil / metallic) vs. ship a
// static PNG is defined per tier in rarity.js (the `animated` flag).

async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
  if (error && !/exist/i.test(error.message)) throw error;
}

// Spawn Blender and count each rendered frame (it prints "Saved: …f_0001.png")
// so the studio can show a real progress bar, then encode the frames to WebP.
function animate(facePng, rarity, framesDir, webpOut, maskPng, onFrame) {
  const args = ['--background', '--python', ANIM_SCRIPT, '--', facePng, framesDir, rarity];
  if (maskPng) args.push(maskPng);
  return new Promise((resolve, reject) => {
    const proc = spawn(BLENDER, args);
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.includes('Saved:') && line.includes('f_')) onFrame?.();
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Blender exited ${code}`))));
    // loop=1: the foil sweep plays once, then the WebP rests on the still card
    // (no endless wiggle in Discord).
  }).then(() => execFileP('python', [ENCODE_SCRIPT, framesDir, webpOut, '1']));
}

/**
 * Render every finish of a card, upload each face (animated for the special
 * tiers), and upsert the subject + card rows so it goes live in the bot.
 */
export async function pushCard(card, artFor, outDir, onProgress) {
  // subjects.type is NOT NULL (card_decisions.sql): refuse a card with no type before any render or upload.
  const type = subjectType(card);
  if (!type) throw new Error(`"${card.name}" has no type. Pick one of ${CARD_TYPES.join(', ')} in Card Info, save, then push again.`);
  const setId = cardSetId(card); // before any upload: no set or a bad set id stops the push here
  const { data: set, error: sete } = await supabase.from('card_sets').select('id').eq('id', setId).maybeSingle();
  if (sete) throw new Error(`set ${setId}: ${sete.message}`);
  if (!set) throw new Error(`set ${setId} does not exist. Create it in the Sets section first.`);
  await ensureBucket();

  // Progress is measured in frame-units: each animated tier is FRAMES frames,
  // each static tier counts as a small fixed chunk. The bar advances as Blender
  // saves each frame (the slow part).
  const animatedCount = card.finishes.filter((r) => ANIMATED.has(r)).length;
  const staticCount = card.finishes.length - animatedCount;
  const totalUnits = animatedCount * FRAMES + staticCount * 4;
  let doneUnits = 0;
  const bump = (n, label) => {
    doneUnits += n;
    onProgress?.(doneUnits, totalUnits, label);
  };
  onProgress?.(0, totalUnits, 'starting');

  const { data: subject, error: se } = await supabase
    .from('subjects')
    .upsert({ key: card.id, name: card.name, description: card.genre, type, tags: card.tags ?? {}, ability: card.ability ?? null }, { onConflict: 'key' })
    .select('id')
    .single();
  if (se) throw new Error(`subject: ${se.message}`);

  // Before any render or upload: the rows that exist, and the set rule (no move as a side effect).
  const { data: rows, error: re } = await supabase.from('cards').select('id, rarity, set_id').eq('subject_id', subject.id);
  if (re) throw new Error(`cards: ${re.message}`);
  const liveRows = new Map((rows || []).map((r) => [r.rarity, r]));
  for (const r of liveRows.values()) {
    const why = setMoveProblem(card, r.set_id, setId);
    if (why) throw new Error(why);
  }

  const results = [];
  for (const rarity of card.finishes) {
    const facePng = join(outDir, `${card.id}-${rarity}.png`);
    const slot = artKeyFor(rarity);
    const frame = getFrame(card.id, slot);
    const artist = getArtist(card.id, slot);
    // This tier's own subject / description / season / event (merged over the
    // card so the Title stays card-wide).
    const det = slotDetails(card, slot);
    const eff = { ...card, ...det };
    // Animated tiers use this PNG only as a Blender texture (keep it crisp at
    // 2x). Normal uploads this PNG directly, so render it at 500x700 (scale 1)
    // to match every other tier's display size in Discord.
    await renderPng(eff, rarity, artFor(rarity), facePng, ANIMATED.has(rarity) ? 2 : 1, false, frame, artist);

    let object;
    let contentType;
    let buffer;
    if (ANIMATED.has(rarity)) {
      const framesDir = join(outDir, `frames-${card.id}-${rarity}`);
      const webp = join(outDir, `${card.id}-${rarity}.webp`);
      // Holo tiers get a rounded-corner artwork mask; Gold plates the whole card.
      let maskPng = null;
      if (rarity !== 'gold') {
        maskPng = join(outDir, `${card.id}-${rarity}-mask.png`);
        await renderPng(card, rarity, artFor(rarity), maskPng, 2, true);
      }
      await animate(facePng, rarity, framesDir, webp, maskPng, () => bump(1, rarity));
      object = `cards/${card.id}-${rarity}.webp`;
      contentType = 'image/webp';
      buffer = readFileSync(webp);
    } else {
      object = `cards/${card.id}-${rarity}.png`;
      contentType = 'image/png';
      buffer = readFileSync(facePng);
      bump(4, rarity);
    }

    const { error: ue } = await supabase.storage
      .from(BUCKET)
      .upload(object, buffer, { contentType, upsert: true });
    if (ue) throw new Error(`upload ${rarity}: ${ue.message}`);
    // Its thumbnails (src/thumbs.js): the still grid copy, and the animated reveal copy.
    const th = await makeThumbs(buffer);
    for (const [obj, buf] of [[gridObject(object), th.grid], [revealObject(object), th.reveal]]) {
      if (!buf) continue;
      const { error: te } = await supabase.storage.from(BUCKET).upload(obj, buf, { contentType: 'image/webp', upsert: true });
      if (te) throw new Error(`thumbnail ${rarity}: ${te.message}`);
    }

    const url = `${publicUrl(supabase, BUCKET, object)}?v=${Date.now()}`; // the base that received the upload (local or live)

    // One row per subject and rarity (the subject is this card: key = card.id). A reprint in another set is a
    // set_pool row of that set, not a new row here.
    const existing = liveRows.get(rarity) || null;

    // This tier's own description / event; the draw-pool rule comes from the tier's flags in rarity.js.
    // The set is per card (cardSetId); the database keeps cards.season = 'Season ' + the set's season (card_sets.sql),
    // so the season is not sent.
    const rowEvent = needsPeriod(rarity) ? (det.event || null) : null;
    const inPool = inDrawPool(rarity);
    // Tradeability is per tier now (det.tradeable): gold never trades, every
    // other tier follows its own portal toggle.
    const tradeable = det.tradeable !== false;
    // Every write is checked (F-2 item 6): an error stops the push and shows in the push status.
    if (existing) {
      const { error: we } = await supabase
        .from('cards')
        .update({ name: card.name, lore: det.lore, artist_credit: artist || null, set_id: setId, event: rowEvent, image_url: url, in_draw_pool: inPool, tradeable, source: 'draw' })
        .eq('id', existing.id);
      if (we) throw new Error(`card ${rarity}: ${we.message}`);
    } else {
      const { error: we } = await supabase
        .from('cards')
        .insert({ subject_id: subject.id, name: card.name, rarity, lore: det.lore, artist_credit: artist || null, set_id: setId, event: rowEvent, image_url: url, in_draw_pool: inPool, tradeable, source: 'draw' });
      if (we) throw new Error(`card ${rarity}: ${we.message}`);
    }
    results.push({ rarity, url, animated: ANIMATED.has(rarity) });
  }
  return results;
}
