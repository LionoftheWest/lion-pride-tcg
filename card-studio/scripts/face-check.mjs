// The content check of a rendered card face (S2-PUB, the UI-68 risks of 2026-11-04: under CPU load headless Edge gave a partly
// white screenshot, and a CUT screenshot whose bottom rows are transparent; the file wait accepts both). Used by scripts/push-set.mjs
// after each card push (one re-render on a FAIL, a 2nd FAIL stops the run) and by the S2-PUB gate (gate.mjs images, the uploaded file).
//   white       the fraction of near-white pixels (r, g and b > 240; alpha ignored)
//   blankRows   the fraction of image rows that are more than 90% near-white
//   clear       the fraction of fully transparent pixels (alpha 0)
//   clearRows   the fraction of image rows that are more than 50% transparent (a cut band, at the bottom or anywhere)
// Calibration (the 126 face PNGs of the 33 new S2 cards, Wed 2026-11-04 rehearsal): white max 0.0735, blankRows 0, clear max 0.0024
// (the rounded corners), clearRows 0; the 53 animated WebPs (frame 1, the uploaded file): clear 0.031-0.0317, clearRows 0.0143
// (their transparent edge); EXCEPT ottozone-s-head-full_art: PNG clearRows 0.0921 (rows 1271-1399 of 1400 transparent), WebP 0.1029,
// the cut shot of UI-68 F1; it was pushed on copy 1 with no error). Limits: white <= 0.25, blankRows <= 0.05, clear <= 0.05,
// clearRows <= 0.03 (a band of 3% of the rows: 21 rows of 700, 42 of 1400) (S2PUB_WHITE_MAX, S2PUB_BLANKROWS_MAX, S2PUB_CLEAR_MAX, S2PUB_CLEARROWS_MAX override).
// A still face PNG and the first frame of an animated WebP are checked the same way.
import sharp from 'sharp';

export const WHITE_MAX = Number(process.env.S2PUB_WHITE_MAX || 0.25);
export const BLANKROWS_MAX = Number(process.env.S2PUB_BLANKROWS_MAX || 0.05);
export const CLEAR_MAX = Number(process.env.S2PUB_CLEAR_MAX || 0.05);
export const CLEARROWS_MAX = Number(process.env.S2PUB_CLEARROWS_MAX || 0.03);

/** { ok, white, blankRows, clear, clearRows, width, height } of an image file or buffer. */
export async function faceCheck(input) {
  const { data, info } = await sharp(input, { page: 0 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let white = 0, rows = 0, clear = 0, clearRows = 0;
  for (let y = 0; y < info.height; y++) {
    let rw = 0, rc = 0;
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * ch;
      if (data[i + 3] === 0) { rc += 1; continue; }
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) rw += 1;
    }
    white += rw; clear += rc;
    if (rw > 0.9 * info.width) rows += 1;
    if (rc > 0.5 * info.width) clearRows += 1;
  }
  const n = info.width * info.height;
  const r = (v) => Number(v.toFixed(4));
  const out = { white: r(white / n), blankRows: r(rows / info.height), clear: r(clear / n), clearRows: r(clearRows / info.height), width: info.width, height: info.height };
  out.ok = out.white <= WHITE_MAX && out.blankRows <= BLANKROWS_MAX && out.clear <= CLEAR_MAX && out.clearRows <= CLEARROWS_MAX;
  return out;
}
