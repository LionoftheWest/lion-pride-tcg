/**
 * Upload the shared lion card back once, as the reveal cover for every pack.
 * Re-run only when the back design changes.
 * Usage:  node src/upload-back.js
 * R2-MOVE (W3): the write goes through src/art-store.js (Supabase or R2 by ART_STORE; the freeze and cut files).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabase } from './supabase.js';
import { renderBack } from './render.js';
import { createArtStore } from './art-store.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const OBJECT = 'cards/card-back.png';

const store = createArtStore({ db: supabase });
await store.withWrite('card-back', async () => {
  const png = join(ROOT, 'assets', 'card-back.png');
  await renderBack(png, 1); // 500x700, same size as every card face (no embed resize)
  await store.put(OBJECT, readFileSync(png), 'image/png');
});

// The LOGICAL address (I-4): the same string getPublicUrl gave before.
const url = `${String(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/storage/v1/object/public/card-art/${OBJECT}`;
console.log('card back uploaded:');
console.log(url);
