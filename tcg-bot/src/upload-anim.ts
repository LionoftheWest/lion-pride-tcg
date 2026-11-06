import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getSupabase } from './supabase.js';

// Upload a rarity's shimmer WebP to the card-art store and point every card of
// that rarity at it.
//   npx tsx src/upload-anim.ts <rarity>
// R2-MOVE: the write goes through card-studio/src/art-store.js (W8). It reads the freeze and cut FILES on every call, so
// this folder's .env does not matter for them. The import path is computed, so tsc (and the bot image) do not need it:
// this tool runs only on Nathan's PC, from the repo.

const rarity = process.argv[2];
if (!rarity) {
  throw new Error('Usage: tsx src/upload-anim.ts <rarity>');
}

type ArtStore = {
  withWrite: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
  ensureBucket: () => Promise<void>;
  put: (name: string, buf: Buffer, contentType: string) => Promise<unknown>;
};
const storeUrl = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../../card-studio/src/art-store.js')).href;
const { createArtStore } = (await import(storeUrl)) as { createArtStore: (o: { db: unknown }) => ArtStore };

const supabase = getSupabase();
const store = createArtStore({ db: supabase });
const OBJECT = `${rarity}-shimmer.webp`;
// The LOGICAL address (I-4): the same string getPublicUrl gave before.
const url = `${(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/storage/v1/object/public/card-art/${OBJECT}`;

const count = await store.withWrite(`upload-anim ${rarity}`, async () => {
  const file = readFileSync(join(process.cwd(), 'blender', 'out', `${rarity}.webp`));
  await store.ensureBucket();
  await store.put(OBJECT, file, 'image/webp');
  const { error: updateError, count: n } = await supabase
    .from('cards')
    .update({ image_url: url }, { count: 'exact' })
    .eq('rarity', rarity);
  if (updateError) throw new Error(`update: ${updateError.message}`);
  return n;
});

console.log(`Uploaded ${rarity}:`, url);
console.log(`${rarity} cards updated:`, count);
