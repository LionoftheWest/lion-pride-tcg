// Upload the rendered boss clips to the card-art store, where the existing /api/img proxy
// already serves them to the Activity. Idempotent (upsert).
//   node scripts/upload-boss-clips.mjs
// R2-MOVE (W7): every write goes through card-studio/src/art-store.js. It reads the freeze and cut FILES on every call,
// so this folder's .env does not matter for them. One file = one logical write. BOSS_CLIPS_SRC = the source folder.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { createArtStore } from '../../card-studio/src/art-store.js';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const store = createArtStore({ db: sb });

const SRC = process.env.BOSS_CLIPS_SRC || 'C:/Users/vaugh/discord/card-studio/out/behemoth';
const ARCH = 'behemoth';
const states = ['idle', 'walk', 'run', 'stomp', 'punch', 'swipe', 'jump_attack', 'roar', 'hit', 'death'];
// [dest extension, source suffix, content-type]
const variants = [['webm', '.webm', 'video/webm'], ['m.webm', '_m.webm', 'video/webm'], ['mp4', '.mp4', 'video/mp4']];

let ok = 0, fail = 0;
for (const st of states) {
  for (const [outExt, srcSuf, ct] of variants) {
    const src = `${SRC}/boss_${st}${srcSuf}`;
    if (!existsSync(src)) { console.log('skip (missing)', src); continue; }
    const dest = `boss/${ARCH}/${st}.${outExt}`;
    const buf = readFileSync(src);
    let error = null;
    try {
      await store.withWrite(`upload-boss-clips ${dest}`, async () => {
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          try { await store.put(dest, buf, ct); error = null; break; } catch (e) {
            error = e;
            if (/^refused:/.test(e.message)) break;
          }
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      });
    } catch (e) { error = e; }
    if (error) { console.log(`ERR  ${dest}  ${error.message}`); fail += 1; }
    else { console.log(`ok   ${dest}  ${Math.round(buf.length / 1024)}KB`); ok += 1; }
  }
}
console.log(`\nDONE  uploaded=${ok} failed=${fail}`);
process.exitCode = fail ? 1 : 0;
