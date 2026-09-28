// Card thumbnails (card-studio/scripts/make-thumbs.mjs, 2026-09-28). The grids, feeds and
// pack reveals load card-art/thumbs/<path>.webp (a still card ~45 KB, an animated card keeps
// its shine at ~650 KB) instead of the full image (628 KB on average, up to 1.7 MB). The
// zoom views keep the full image.
export function thumb(url) {
  if (!url) return '';
  return url.replace(/\/card-art\/(cards\/[^?]+?)\.(png|webp|jpe?g)(\?|$)/i, '/card-art/thumbs/$1.webp$3');
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
