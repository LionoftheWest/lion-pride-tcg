// Card thumbnails (2026-09-28). The Activity loads small copies instead of the full card
// image (628 KB on average, up to 1.7 MB):
// - grid/<path>.webp   every card, STILL, 480 px (q80): the grids and feeds. For an animated
//                      card (Secret Rare, Full Art, Gold: a one-time shine) it is the LAST
//                      frame, which is how the card looks after the shine (Nathan, 2026-09-28).
// - reveal/<path>.webp animated cards only, ANIMATED, 320 px (q70): the pack reveals, so the
//                      shine plays when the card is revealed.
// The zoom views keep the full image. Used by push.js (each new image) and
// scripts/make-thumbs.mjs (the backfill).
import sharp from 'sharp';

export const GRID = { width: 480, quality: 80 };
export const REVEAL = { width: 320, quality: 70 };

const base = (object) => object.replace(/\.[a-z0-9]+$/i, '');
/** cards/<name>.<ext> -> grid/cards/<name>.webp */
export const gridObject = (object) => `grid/${base(object)}.webp`;
/** cards/<name>.<ext> -> reveal/cards/<name>.webp (animated cards only) */
export const revealObject = (object) => `reveal/${base(object)}.webp`;

/** The thumbnails for one card image: { grid, reveal (null for a still card), animated }. */
export async function makeThumbs(buffer) {
  const pages = (await sharp(buffer, { animated: true }).metadata()).pages || 1;
  const animated = pages > 1;
  const grid = await sharp(buffer, animated ? { page: pages - 1 } : {})
    .resize({ width: GRID.width, withoutEnlargement: true }).webp({ quality: GRID.quality }).toBuffer();
  const reveal = animated
    ? await sharp(buffer, { animated: true }).resize({ width: REVEAL.width, withoutEnlargement: true }).webp({ quality: REVEAL.quality, effort: 5 }).toBuffer()
    : null;
  return { grid, reveal, animated };
}
