/**
 * Card thumbnails for the grids, feeds and pack reveals (2026-09-28). The full card images
 * are 628 KB on average (up to 1.7 MB), and every grid loaded them: a 50-card reveal was
 * ~30 MB. Each thumbnail is a WebP in card-art/thumbs/<same path>.webp: a still card is
 * 480 px wide (q80); an animated card (Secret Rare, Full Art, Gold: a one-time shine, 24
 * frames) stays animated at 320 px (q70), so the grids look the same. The
 * zoom view keeps the full image. The Activity falls back to the full image when a
 * thumbnail is missing, so a new card without one still shows.
 *   node scripts/make-thumbs.mjs            # only the missing thumbnails
 *   node scripts/make-thumbs.mjs --all      # rebuild every thumbnail
 *   node scripts/make-thumbs.mjs --dry      # sizes only, no upload
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { makeThumb, thumbObject } from '../src/thumbs.js';
import { createClient } from '@supabase/supabase-js';

const ALL = process.argv.includes('--all'), DRY = process.argv.includes('--dry');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY, URL = process.env.SUPABASE_URL;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const thumbPath = thumbObject;

const { data: cards, error } = await sb.from('cards').select('id, image_url').not('image_url', 'is', null);
if (error) throw new Error(error.message);
const paths = [...new Set(cards.map((c) => c.image_url.split('/card-art/')[1]?.split('?')[0]).filter(Boolean))];
paths.push('cards/card-back.png');

// Which thumbnails exist already (one list call per folder).
async function listTimes(folder) {
  const m = new Map();
  for (let off = 0; ; off += 1000) {
    const { data } = await sb.storage.from('card-art').list(folder, { limit: 1000, offset: off });
    for (const f of data || []) m.set(`${folder}/${f.name}`, Date.parse(f.updated_at || f.created_at || 0));
    if (!data || data.length < 1000) break;
  }
  return m;
}
const have = ALL ? new Map() : await listTimes('thumbs/cards');
const full = ALL ? new Map() : await listTimes('cards');
// Missing, or older than its full image (push.js re-uploads a card under the same name).
const todo = paths.filter((p) => ALL || !have.has(thumbPath(p)) || (full.get(p) || 0) > have.get(thumbPath(p)));
console.log(`${paths.length} card images, ${have.size} thumbnails exist, ${todo.length} to make${DRY ? ' (dry run)' : ''}`);

let before = 0, after = 0, done = 0, failed = 0, anim = 0;
async function one(p) {
  try {
    const r = await fetch(`${URL}/storage/v1/object/public/card-art/${p}`);
    if (!r.ok) throw new Error(`download ${r.status}`);
    const src = Buffer.from(await r.arrayBuffer());
    const { out, animated } = await makeThumb(src);
    if (animated) anim += 1;
    before += src.length; after += out.length;
    if (!DRY) {
      const u = await fetch(`${URL}/storage/v1/object/card-art/${thumbPath(p)}`, {
        method: 'POST', body: out,
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'image/webp', 'x-upsert': 'true', 'cache-control': 'max-age=604800' },
      });
      if (!u.ok) throw new Error(`upload ${u.status} ${(await u.text()).slice(0, 80)}`);
    }
    done += 1;
  } catch (e) { failed += 1; console.log(`FAIL ${p}: ${e.message}`); }
}
for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(one));
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`made ${done} (${anim} animated), failed ${failed} | full ${kb(before)} -> thumbnails ${kb(after)} (${before ? Math.round(100 - (100 * after) / before) : 0}% smaller, ${done ? kb(after / done) : '0'} each)`);
process.exitCode = failed ? 1 : 0;
