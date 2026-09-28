// Card thumbnails (card-studio/src/thumbs.js, 2026-09-28) instead of the full card image
// (628 KB on average, up to 1.7 MB):
// - thumb(): the STILL grid copy (48 KB), for the grids and feeds. An animated card shows
//   its last frame, which is how it looks after its one-time shine (Nathan, 2026-09-28).
// - revealThumb(): the pack reveals. An animated card (its original is a .webp: push.js
//   saves only the animated tiers as .webp) gets its ANIMATED 320 px copy, so the shine
//   plays on the reveal; a still card gets the grid copy.
// The zoom views keep the full image.
const PARTS = /\/card-art\/(cards\/[^?]+?)\.(png|webp|jpe?g)(\?|$)/i;
export function thumb(url) {
  if (!url) return '';
  return url.replace(PARTS, '/card-art/grid/$1.webp$3');
}
export function revealThumb(url) {
  if (!url) return '';
  const m = url.match(PARTS);
  if (!m) return url;
  return url.replace(PARTS, `/card-art/${m[2].toLowerCase() === 'webp' ? 'reveal' : 'grid'}/$1.webp$3`);
}

// One listener for broken images (the CSP allows no inline onerror handlers):
// - data-full: a missing thumbnail falls back to the full image (a new card before
//   make-thumbs ran);
// - data-err="remove": the image is removed (an avatar with no picture).
export function installImgFallback() {
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLImageElement)) return;
    if (t.dataset.full && t.src !== new URL(t.dataset.full, location.href).href) { t.src = t.dataset.full; return; }
    if (t.dataset.err === 'remove') t.remove();
  }, true);
}
