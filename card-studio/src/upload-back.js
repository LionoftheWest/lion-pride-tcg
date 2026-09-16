/**
 * Upload the shared lion card back once, as the reveal cover for every pack.
 * Re-run only when the back design changes.
 * Usage:  node src/upload-back.js
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabase } from './supabase.js';
import { renderBack } from './render.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const BUCKET = 'card-art';
const OBJECT = 'cards/card-back.png';

const png = join(ROOT, 'assets', 'card-back.png');
await renderBack(png, 1); // 500x700, same size as every card face (no embed resize)

const { error } = await supabase.storage
  .from(BUCKET)
  .upload(OBJECT, readFileSync(png), { contentType: 'image/png', upsert: true });
if (error) throw new Error(error.message);

const url = supabase.storage.from(BUCKET).getPublicUrl(OBJECT).data.publicUrl;
console.log('card back uploaded:');
console.log(url);
