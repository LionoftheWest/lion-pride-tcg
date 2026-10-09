// UI-34 and UI-35 the pack reveal (lion-pride-tcg-design UI-34/approved and UI-35/approved, review-3; D-91 to D-109).
// The logic of the reveal, apart from the DOM (main.js paints the stage): the clips of the chosen set (D-101), which
// pack plays the rare clip (D-96, D-107), and the order of the cards (the best card last, D-92, D-109).
// Only under body.ui-v3: main.js calls this module only when settings.ui_v3 is on.

/** The rank of a card is "rare" (SR or better: Secret Rare, Full Art, Gold, Event, Promo), as isRarePull in main.js. */
export const RARE_RANK = 2;

/** The clips of a set (D-93, D-101): tcg-activity/public/packs/<set_id>/ (card-studio/pack-art, PR 272). */
export const CLIPS = ['idle_loop', 'open', 'open_rare'];
export function clipUrl(set, kind) {
  if (!CLIPS.includes(kind)) throw new Error(`unknown clip "${kind}"`);
  return `/packs/${encodeURIComponent(String(set))}/${kind}.webp`;
}

/** The set whose pack shows: the set of the open (the Open window, UI-33), else the fallback (the set the member
 *  would open next: the server's last_set). Never empty: Season 1 (S1) is the first set. */
export const packSet = (set, fallback) => String(set || fallback || 'S1');

/** The index of the best card: the highest rank; the first of equal ranks. -1 for no cards. */
export function bestIndex(cards, rank) {
  let best = -1, br = -Infinity;
  (cards || []).forEach((c, i) => { const r = rank(c); if (r > br) { br = r; best = i; } });
  return best;
}

/** D-92: the best card is revealed last: the same cards, the best one moved to the end. The order of the others stays
 *  (the server order in a single pack, the shuffle in a multi open). */
export function bestLast(cards, rank) {
  const list = [...(cards || [])];
  const i = bestIndex(list, rank);
  if (i < 0 || i === list.length - 1) return list;
  const [best] = list.splice(i, 1);
  list.push(best);
  return list;
}

/** D-109: "Reveal all" turns the cards that are still face down, the best card last. faceDown = the indexes still face
 *  down; best = the index of the best card. */
export function revealOrder(faceDown, best) {
  const rest = [...faceDown].filter((i) => i !== best).sort((a, b) => a - b);
  return faceDown.includes(best) ? [...rest, best] : rest;
}

/** D-96, D-107: the packs that play the rare clip: the packs that hold an SR+ card. Every other pack plays open.webp. */
export function rarePacks(packs, rank) {
  return (packs || []).map((p, i) => ((p || []).some((c) => rank(c) >= RARE_RANK) ? i : -1)).filter((i) => i >= 0);
}

/** The one number of a reveal (3.5): the largest 5:7 card width that shows every card in the area, no scroll (D-72).
 *  Returns the width and the columns. */
export function fitCards(n, width, height, gap) {
  const count = Math.max(1, n | 0);
  let best = { cw: 0, cols: count };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cw = Math.floor(Math.min((width - (cols - 1) * gap) / cols, ((height - (rows - 1) * gap) / rows) * 5 / 7));
    if (cw > best.cw) best = { cw, cols };
  }
  return best;
}

/** The pack body of the clips: 389 x 703 of the 800 x 1120 frame (x 205-594, y 261-964). */
export const PACK_RATIO = 389 / 703;

/** UI-35 the waiting packs (D-100): the largest pack body that shows every pack, and the rows (balanced: 10 packs in 3
 *  rows are 4, 3, 3, not 4, 4, 2). */
const TOUCH_MIN = 44;   // design.md 9.1
export function fitPacks(n, width, height, gap) {
  const count = Math.max(1, n | 0);
  const all = [];
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    all.push({ cols, rows, pw: Math.floor(Math.min((width - (cols - 1) * gap) / cols, ((height - (rows - 1) * gap) / rows) * PACK_RATIO)) });
  }
  const top = Math.max(...all.map((c) => c.pw));
  // A pack up to 15% smaller is worth fewer rows (5 packs are 3 + 2 as drawn on 430x932, not 2 + 2 + 1), but never a pack
  // under the 44 px touch size (9.1) when a larger one fits.
  const best = all.filter((c) => c.pw >= Math.min(top, Math.max(top * 0.85, TOUCH_MIN))).sort((x, y) => x.rows - y.rows || y.pw - x.pw)[0];
  return { pw: best.pw, cols: best.cols, rows: balancedRows(count, best.rows) };
}
/** n items in r rows, as even as possible, the longer rows first: (10, 3) -> [4, 3, 3]. */
export function balancedRows(n, r) {
  const rows = Math.max(1, Math.min(n, r | 0));
  const base = Math.floor(n / rows), extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

/** D-72 / review-2: the New mark follows the card width: a chip from 88 px, a small chip from 70 px, else a dot. */
export const newMark = (cardWidth) => (cardWidth >= 88 ? 'chip' : cardWidth >= 70 ? 'small' : 'dot');

/** D-100: the packs of a multi open start one after the other, about 0.4 s apart. The start time of each pack (ms). */
export const PACK_GAP_MS = 400;
export const packStarts = (n) => Array.from({ length: Math.max(0, n | 0) }, (_, i) => i * PACK_GAP_MS);

/** D-135, D-140: the packs stand in one stack. The pack with index 0 is in front; a rare pack stays in its real place
 *  (it is not moved). Each pack is in front for 0.4 s; a rare pack holds the front for 1.4 s, until its burst (D-97). */
export const RARE_HOLD_MS = 1400;
/** D-142: the packs that show behind the front pack. */
export const STACK_LAYERS = 4;
/** The order of the stack opening: for each pack its start time (ms), the packs left (D-141: this pack and the ones
 *  behind it, so it starts at n and ends at 1) and the end of the sequence (the cards come then: the last pack plays its
 *  whole clip up to its burst). rare = a Set or an array of the indexes of the rare packs. */
export function stackTimeline(n, rare = [], gap = PACK_GAP_MS, hold = RARE_HOLD_MS) {
  const count = Math.max(0, n | 0);
  const isRare = new Set(rare);
  const steps = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    steps.push({ pack: i, start: t, left: count - i });
    t += isRare.has(i) ? hold : gap;
  }
  return { steps, end: count ? steps[count - 1].start + hold : 0 };
}
/** The layer of a pack behind the front pack: 0 in front, up to STACK_LAYERS (the packs further back hide behind it). */
export const stackDepth = (pack, front, layers = STACK_LAYERS) => Math.min(Math.max(0, pack - front), layers);

// ---- The clips: fetched once per set into a Blob; each play gets a fresh object URL, so the clip starts at frame 1
// with no new download (as tearSource in main.js). Preloaded while the member reads the prompt. ----
const blobs = new Map();   // url -> Promise<Blob>
const live = new Set();    // object URLs of the reveal on screen
export function clipBlob(url, fetcher = globalThis.fetch) {
  if (!blobs.has(url)) {
    blobs.set(url, fetcher(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((e) => { blobs.delete(url); throw e; }));   // the next reveal tries again
  }
  return blobs.get(url);
}
/** A fresh object URL of a clip (a new URL restarts the animation). */
export function clipSource(url) {
  return clipBlob(url).then((b) => { const u = URL.createObjectURL(b); live.add(u); return u; });
}
/** The reveal closed: free the object URLs. */
export function releaseClips() { for (const u of live) URL.revokeObjectURL(u); live.clear(); }
