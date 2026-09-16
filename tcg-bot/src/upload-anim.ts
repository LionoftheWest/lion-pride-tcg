import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSupabase } from './supabase.js';

// Upload a rarity's shimmer WebP to Supabase Storage and point every card of
// that rarity at it.
//   npx tsx src/upload-anim.ts <rarity>

const rarity = process.argv[2];
if (!rarity) {
  throw new Error('Usage: tsx src/upload-anim.ts <rarity>');
}

const supabase = getSupabase();
const BUCKET = 'card-art';
const OBJECT = `${rarity}-shimmer.webp`;

const file = readFileSync(join(process.cwd(), 'blender', 'out', `${rarity}.webp`));

const { error: bucketError } = await supabase.storage.createBucket(BUCKET, {
  public: true,
});
if (bucketError && !/exist/i.test(bucketError.message)) {
  throw new Error(`createBucket: ${bucketError.message}`);
}

const { error: uploadError } = await supabase.storage
  .from(BUCKET)
  .upload(OBJECT, file, { contentType: 'image/webp', upsert: true });
if (uploadError) throw new Error(`upload: ${uploadError.message}`);

const { data } = supabase.storage.from(BUCKET).getPublicUrl(OBJECT);
const url = data.publicUrl;

const { error: updateError, count } = await supabase
  .from('cards')
  .update({ image_url: url }, { count: 'exact' })
  .eq('rarity', rarity);
if (updateError) throw new Error(`update: ${updateError.message}`);

console.log(`Uploaded ${rarity}:`, url);
console.log(`${rarity} cards updated:`, count);
