// S1-FACE art-report (SPEC v2.4 section 4, R-5 unpublished art): is the art in the new UI-68 face the art of the old live face?
// The art window of the UI-68 face is shorter than the old one (the ability box), and the art is placed with "cover", so the same art
// sits higher or lower and at another zoom. So: a block of the NEW art window (x 90-410, y 150-310 of 500x700) is searched in the OLD
// art window (x 20-480, y 70-560) at every offset (both at 1/4 size, RGB), at 11 scales (0.8-1.3). score = the smallest mean absolute
// difference (0-255). Calibration (2026-11-05, the 194 real S1 stills, new staged face vs old backup face): same art p50 11.6, p99 18.9,
// max 23.3; other art (40 pairs of different rows) min 31.2, p10 51.0. Limit 25: above = ART DIFFER (a line to Nathan, the row waits).
import sharp from 'sharp';

const Q = 4;
const TPL = { left: 90, top: 150, width: 320, height: 160 };
const WIN = { left: 20, top: 70, width: 460, height: 490 };
export const ART_LIMIT = 25;

async function region(buf, r, scale = 1) {
  const full = await sharp(buf, { page: 0 }).resize(500, 700, { fit: 'fill' }).png().toBuffer();
  const w = Math.round((r.width / Q) * scale), h = Math.round((r.height / Q) * scale);
  const { data } = await sharp(full).extract(r).resize(w, h, { fit: 'fill' }).flatten({ background: '#000' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w, h };
}

/** { score, dx, dy, scale }: the best match of the new art block inside the old art window. */
export async function artScore(newBuf, oldBuf) {
  const win = await region(oldBuf, WIN);
  let best = { score: Infinity };
  for (const scale of [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3]) {
    const t = await region(newBuf, TPL, scale);
    if (t.w > win.w || t.h > win.h) continue;
    for (let y = 0; y + t.h <= win.h; y++) {
      for (let x = 0; x + t.w <= win.w; x++) {
        let s = 0;
        for (let ty = 0; ty < t.h; ty++) {
          let ti = ty * t.w * 3, wi = ((y + ty) * win.w + x) * 3;
          for (let k = 0; k < t.w * 3; k++) s += Math.abs(t.data[ti++] - win.data[wi++]);
          if (s >= best.score * t.w * t.h * 3) break; // no better than the best
        }
        const score = s / (t.w * t.h * 3);
        if (score < best.score) best = { score, dx: x, dy: y, scale };
      }
    }
  }
  return { ...best, score: Number(best.score.toFixed(2)) };
}
