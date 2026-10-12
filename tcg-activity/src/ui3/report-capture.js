// UI-40 review-2: the browser parts of the screenshots. The pure rules are in report-shots.js.
//
// "Add this screen" (review-2 build note: the game view behind the window, without the window):
// - The page is drawn into a canvas with html-to-image (MIT): it copies the DOM into an SVG foreignObject and draws that
//   SVG as an image. It is loaded only when a member taps the button (its own chunk), so the start bundle does not grow.
//   The CSP allows it: it fetches the page's own CSS, fonts and images (connect-src 'self') and draws data: images (img-src).
// - The WebGL canvases (the 3D boss, the Dungeon stage) do not keep their picture after a frame is shown
//   (preserveDrawingBuffer is false, and it stays false: it costs a copy on every frame on phones). So the picture of each
//   canvas is read in a ResizeObserver callback: the browser runs it in the same rendering step, after the animation
//   frame callbacks that draw the 3D view and before the frame is shown, so the drawing buffer still holds the picture.
//   html-to-image reads a canvas with canvas.toDataURL(), so for the capture each canvas returns that picture.
//   A canvas that did not draw in that frame (a paused view) gives an empty picture: it is left transparent.
import { fitSize, shrinkTo } from './report-shots.js';

/** The pictures of the canvases, read in one rendering step (see above). Map<canvas, dataURL>. */
function grabCanvases(canvases) {
  return new Promise((resolve) => {
    if (!canvases.length || typeof ResizeObserver !== 'function') { resolve(new Map()); return; }
    const ro = new ResizeObserver(() => {
      ro.disconnect();
      const out = new Map();
      for (const c of canvases) { try { out.set(c, c.toDataURL('image/png')); } catch { /* a tainted canvas: left out */ } }
      resolve(out);
    });
    ro.observe(document.documentElement);   // the first observation is delivered in the next rendering step
  });
}

let fontCSS = null;   // the embedded font CSS, made once per page (html-to-image fetches the font files)

/**
 * The game view behind the Report window as a canvas. exclude(node) -> true leaves a node out (the window itself).
 * The capture is at the CSS size of the window times scale (at most 2).
 */
export async function captureView({ exclude = () => false, scale = Math.min(2, window.devicePixelRatio || 1) } = {}) {
  const lib = await import('html-to-image');
  const canvases = [...document.querySelectorAll('canvas')].filter((c) => c.width > 0 && c.height > 0 && c.getClientRects().length && !exclude(c));
  const pics = await grabCanvases(canvases);
  for (const [c, url] of pics) Object.defineProperty(c, 'toDataURL', { value: () => url, configurable: true });
  try {
    const body = document.body;
    const opts = {
      width: window.innerWidth, height: window.innerHeight, pixelRatio: scale,
      backgroundColor: getComputedStyle(body).backgroundColor,
      // An image that shows nothing on the page (no src, broken, not loaded yet) is left out: html-to-image would fetch the
      // page itself for an empty src and fail on it.
      filter: (n) => !(n instanceof Element) || !(exclude(n) || (n instanceof HTMLImageElement && (!n.complete || !n.naturalWidth))),
      imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
      cacheBust: false,
    };
    if (fontCSS == null) { try { fontCSS = await lib.getFontEmbedCSS(body, opts); } catch { fontCSS = ''; } }
    const svg = widenWrapRows(await lib.toSvg(body, { ...opts, fontEmbedCSS: fontCSS || undefined }));
    const img = new Image();
    img.src = svg;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(opts.width * scale); canvas.height = Math.round(opts.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    for (const c of pics.keys()) delete c.toDataURL;
  }
}

/**
 * The copy writes every computed width with 3 or 4 decimals, so the children of a wrapping flex row can add up to a hair
 * more than the row (the Home stats: 267.109 for 75.1094 + 72 + 72 + 48) and the copy wraps a row that the page does not.
 * Every element with flex-wrap: wrap (serialized as the shorthand flex-flow) gets half a CSS pixel more width in the SVG. svgUrl = the data: URL of html-to-image.
 */
export function widenWrapRows(svgUrl) {
  const at = svgUrl.indexOf(',');
  const head = svgUrl.slice(0, at + 1);
  const svg = decodeURIComponent(svgUrl.slice(at + 1));
  const out = svg.replace(/style="([^"]*flex-(?:wrap|flow):[^;"]*(?<![\w-])wrap(?![\w-])[^"]*)"/g, (m, css) => `style="${css.replace(/(^|[;\s])width: (\d+(?:\.\d+)?)px/, (w, pre, n) => `${pre}width: ${Number(n) + 0.5}px`)}"`);
  return head + encodeURIComponent(out);
}

/** A Blob or File -> something drawImage takes, with its size. */
async function decode(src) {
  if (src instanceof HTMLCanvasElement) return { img: src, w: src.width, h: src.height };
  if (typeof createImageBitmap === 'function') {
    try { const b = await createImageBitmap(src); return { img: b, w: b.width, h: b.height }; } catch { /* the <img> path below */ }
  }
  const url = URL.createObjectURL(src);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, w: img.naturalWidth, h: img.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

/** One encode: WebP where the browser can encode it, else JPEG (Safari before 18 returns PNG for image/webp). */
function encoder(img) {
  const canvas = document.createElement('canvas');
  let type = 'image/webp';
  return async (w, h, q) => {
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0, w, h);
    let blob = await toBlob(canvas, type, q);
    if (blob && blob.type !== type) { type = 'image/jpeg'; blob = await toBlob(canvas, type, q); }
    return blob;
  };
}

/**
 * Shrink and encode an image (a File, a Blob or a canvas) at or under maxBytes (null = no known limit yet).
 * Returns { blob, mime, url } (url = an object URL for the thumbnail), or throws when it cannot.
 */
export async function prepareShot(src, { maxBytes = null, onProgress = () => {} } = {}) {
  const { img, w, h } = await decode(src);
  onProgress(0.2);
  if (!fitSize(w, h).w) throw new Error('empty image');
  const blob = await shrinkTo(encoder(img), w, h, maxBytes, (k) => onProgress(0.2 + 0.8 * k));
  img.close?.();
  if (!blob) throw new Error('too large');
  return { blob, mime: blob.type, url: URL.createObjectURL(blob) };
}
