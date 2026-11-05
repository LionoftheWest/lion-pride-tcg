// The content check of a rendered card face (S2-PUB, the UI-68 risk of 2026-11-04: under CPU load headless Edge gave a partly
// white screenshot that passed the file wait). Used by scripts/push-set.mjs after each card push (one re-render on a FAIL) and by
// the S2-PUB gate (gate.mjs images, on the uploaded file).
//   white      the fraction of near-white pixels (r, g and b > 240)
//   blankRows  the fraction of image rows that are more than 90% near-white
// Calibration (the 126 face PNGs of the 33 new S2 cards, Wed 2026-11-04 rehearsal): white max 0.0735 (median about 0.01),
// blankRows 0 for all. So the limits are white <= 0.25 and blankRows <= 0.05 (S2PUB_WHITE_MAX, S2PUB_BLANKROWS_MAX override).
// A still face PNG and the first frame of an animated WebP are checked the same way.
import sharp from 'sharp';

export const WHITE_MAX = Number(process.env.S2PUB_WHITE_MAX || 0.25);
export const BLANKROWS_MAX = Number(process.env.S2PUB_BLANKROWS_MAX || 0.05);

/** { ok, white, blankRows, width, height } of an image file or buffer. */
export async function faceCheck(input) {
  const { data, info } = await sharp(input, { page: 0 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let white = 0, rows = 0;
  for (let y = 0; y < info.height; y++) {
    let rw = 0;
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) rw += 1;
    }
    white += rw;
    if (rw > 0.9 * info.width) rows += 1;
  }
  const w = white / (info.width * info.height), b = rows / info.height;
  return { ok: w <= WHITE_MAX && b <= BLANKROWS_MAX, white: Number(w.toFixed(4)), blankRows: Number(b.toFixed(4)), width: info.width, height: info.height };
}
