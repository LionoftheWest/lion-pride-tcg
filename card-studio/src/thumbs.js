// Card thumbnails (2026-09-28): the Activity's grids, feeds and pack reveals load
// card-art/thumbs/<path>.webp instead of the full image (628 KB on average). A still card is
// 480 px wide (q80); an animated card (Secret Rare, Full Art, Gold: a one-time shine) stays
// animated at 320 px (q70). Used by push.js (each new image) and scripts/make-thumbs.mjs.
import sharp from 'sharp';

export const STILL = { width: 480, quality: 80 };
export const ANIM = { width: 320, quality: 70 };

/** cards/<name>.<ext> -> thumbs/cards/<name>.webp */
export const thumbObject = (object) => `thumbs/${object.replace(/\.[a-z0-9]+$/i, '')}.webp`;

/** The thumbnail bytes for one card image; `animated` says which kind it was. */
export async function makeThumb(buffer) {
  const animated = ((await sharp(buffer, { animated: true }).metadata()).pages || 1) > 1;
  const o = animated ? ANIM : STILL;
  const out = await sharp(buffer, { animated }).resize({ width: o.width, withoutEnlargement: true }).webp({ quality: o.quality, effort: 5 }).toBuffer();
  return { out, animated };
}
