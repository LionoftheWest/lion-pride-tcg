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
import { getArtist } from './artists.js';
import { slotDetails } from './cardstore.js';

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
    .upsert({ key: card.id, name: card.name, description: card.genre, type: card.type ?? null }, { onConflict: 'key' })
    .select('id')
    .single();
  if (se) throw new Error(`subject: ${se.message}`);

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

    const url = `${supabase.storage.from(BUCKET).getPublicUrl(object).data.publicUrl}?v=${Date.now()}`;

    const { data: existing } = await supabase
      .from('cards')
      .select('id')
      .eq('subject_id', subject.id)
      .eq('rarity', rarity)
      .maybeSingle();

    // This tier's own description / season / event; the draw-pool rule comes
    // from the tier's flags in rarity.js.
    const rowSeason = det.season || null;
    const rowEvent = needsPeriod(rarity) ? (det.event || null) : null;
    const inPool = inDrawPool(rarity);
    // A card marked untradeable in the portal locks ALL its tiers from trading.
    const tradeable = card.tradeable !== false;
    if (existing) {
      await supabase
        .from('cards')
        .update({ name: card.name, lore: det.lore, artist_credit: artist || null, season: rowSeason, event: rowEvent, image_url: url, in_draw_pool: inPool, tradeable, source: 'draw' })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('cards')
        .insert({ subject_id: subject.id, name: card.name, rarity, lore: det.lore, artist_credit: artist || null, season: rowSeason, event: rowEvent, image_url: url, in_draw_pool: inPool, tradeable, source: 'draw' });
    }
    results.push({ rarity, url, animated: ANIMATED.has(rarity) });
  }
  return results;
}
