// Upload the boss thumbnails (preview/thumbs/*.png) to the card-art store (boss/thumbs/).
// R2-MOVE (W7): every write goes through card-studio/src/art-store.js (the freeze and cut FILES, read on every call).
// One file = one logical write.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'node:fs';
import { createArtStore } from '../../card-studio/src/art-store.js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const store = createArtStore({ db: sb });
const dir = process.env.BOSS_THUMBS_DIR || 'preview/thumbs';
let ok = 0, fail = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.png'))) {
  const buf = readFileSync(`${dir}/${f}`);
  let error = null;
  try {
    await store.withWrite(`upload-boss-thumbs boss/thumbs/${f}`, async () => {
      for (let a = 1; a <= 4; a++) {
        try { await store.put(`boss/thumbs/${f}`, buf, 'image/png'); error = null; break; } catch (e) { error = e; if (/^refused:/.test(e.message)) break; }
        await new Promise(r => setTimeout(r, 700 * a));
      }
    });
  } catch (e) { error = e; }
  if (error) { console.log('ERR', f, error.message); fail++; } else { console.log('ok', f, Math.round(buf.length/1024)+'KB'); ok++; }
}
console.log(`DONE thumbs uploaded=${ok} failed=${fail}`);
process.exitCode = fail ? 1 : 0;
