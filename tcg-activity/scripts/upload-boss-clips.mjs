// Upload the rendered boss clips to Supabase storage (card-art bucket), where the
// existing /api/img proxy already serves them to the Activity. Idempotent (upsert).
//   node scripts/upload-boss-clips.mjs
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const SRC = 'C:/Users/vaugh/discord/card-studio/out/behemoth';
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
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      ({ error } = await sb.storage.from('card-art').upload(dest, buf, { contentType: ct, upsert: true }));
      if (!error) break;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
    if (error) { console.log(`ERR  ${dest}  ${error.message}`); fail += 1; }
    else { console.log(`ok   ${dest}  ${Math.round(buf.length / 1024)}KB`); ok += 1; }
  }
}
console.log(`\nDONE  uploaded=${ok} failed=${fail}`);
process.exit(fail ? 1 : 0);
