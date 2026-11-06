/**
 * The card thumbnails (src/thumbs.js has the sizes): grid/<path>.webp (still, every card)
 * and reveal/<path>.webp (animated, animated cards only). The full card images are 628 KB
 * on average, and every grid loaded them: a 50-card reveal was ~30 MB. The Activity falls
 * back to the full image when a thumbnail is missing, so a new card without one still shows.
 *   node scripts/make-thumbs.mjs            # only the missing thumbnails
 *   node scripts/make-thumbs.mjs --all      # rebuild every thumbnail
 *   node scripts/make-thumbs.mjs --dry      # sizes only, no upload
 * R2-MOVE (W5): the list, the source read and every write go through src/art-store.js (Supabase or R2 by ART_STORE;
 * the freeze and cut FILES, read on every call). One object pair (grid + reveal) = one logical write.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { makeThumbs, gridObject, revealObject } from '../src/thumbs.js';
import { createClient } from '@supabase/supabase-js';
import { createArtStore } from '../src/art-store.js';

const ALL = process.argv.includes('--all'), DRY = process.argv.includes('--dry');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY, URL = process.env.SUPABASE_URL;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const store = createArtStore({ db: sb });

const { data: cards, error } = await sb.from('cards').select('id, image_url').not('image_url', 'is', null);
if (error) throw new Error(error.message);
const paths = [...new Set(cards.map((c) => c.image_url.split('/card-art/')[1]?.split('?')[0]).filter(Boolean))];
paths.push('cards/card-back.png');

// Which thumbnails exist already (one list call per folder).
async function listTimes(folder) {
  const m = new Map();
  for (const f of await store.list(folder)) m.set(f.name, f.updated);
  return m;
}
const have = ALL ? new Map() : await listTimes('grid/cards');
const full = ALL ? new Map() : await listTimes('cards');
// Missing, or older than its full image (push.js re-uploads a card under the same name).
const todo = paths.filter((p) => ALL || !have.has(gridObject(p)) || (full.get(p) || 0) > have.get(gridObject(p)));
console.log(`${paths.length} card images, ${have.size} thumbnails exist, ${todo.length} to make${DRY ? ' (dry run)' : ''}`);

let before = 0, after = 0, revealBytes = 0, done = 0, failed = 0, anim = 0;
async function one(p) {
  try {
    const r = await fetch(store.readUrl(p));
    if (!r.ok) throw new Error(`download ${r.status}`);
    const src = Buffer.from(await r.arrayBuffer());
    const { grid, reveal, animated } = await makeThumbs(src);
    if (animated) anim += 1;
    before += src.length; after += grid.length; revealBytes += reveal ? reveal.length : 0;
    if (!DRY) {
      await store.withWrite(`make-thumbs ${p}`, async () => {
        for (const [obj, out] of [[gridObject(p), grid], [revealObject(p), reveal]]) {
          if (!out) continue;
          try { await store.put(obj, out, 'image/webp', { cacheControl: '604800' }); } catch (e) { throw new Error(`upload ${obj} ${e.message}`.slice(0, 160)); }
        }
      });
    }
    done += 1;
  } catch (e) { failed += 1; console.log(`FAIL ${p}: ${e.message}`); }
}
for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(one));
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`made ${done} (${anim} animated), failed ${failed} | full ${kb(before)} -> grid ${kb(after)} (${before ? Math.round(100 - (100 * after) / before) : 0}% smaller, ${done ? kb(after / done) : '0'} each); reveal copies ${kb(revealBytes)} (${anim ? kb(revealBytes / anim) : '0'} each)`);
process.exitCode = failed ? 1 : 0;
