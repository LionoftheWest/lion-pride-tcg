// The ascension flair on a card (the look of card-studio/templates/flair.template.html):
// a metal-foil border per tier (Normal, Bronze, Silver, Gold, Prestige rainbow), one
// star-gem per star on the left edge, and at star 5 the big holographic crown.
const CROWN = `<div class="crown-big"><svg viewBox="0 0 140 110" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="flairHolo" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#b8862a"/><stop offset=".2" stop-color="#ffe9a8"/>
    <stop offset=".4" stop-color="#fff6cf"/><stop offset=".55" stop-color="#9be7ff"/>
    <stop offset=".7" stop-color="#ffd76e"/><stop offset=".85" stop-color="#ff9be3"/>
    <stop offset="1" stop-color="#b8862a"/></linearGradient></defs>
  <path class="cbody" d="M12 84 L12 30 L41 60 L70 14 L99 60 L128 30 L128 84 Z"/>
  <rect class="cband" x="12" y="82" width="116" height="20" rx="5"/>
</svg></div>`;

/** The flair markup for a star level (0 = none). */
export function flairHTML(stars) {
  const a = Math.max(0, Math.min(5, Number(stars) || 0));
  if (!a) return '';
  return `<div class="flair f${a}"><div class="ring"></div>${a >= 5 ? CROWN : ''}<div class="gems">${'<div class="gem">★</div>'.repeat(a)}</div></div>`;
}

/** Put the flair of a star level on a card element (replaces any earlier flair). */
export function setFlair(host, stars) {
  if (!host) return;
  host.querySelector(':scope > .flair')?.remove();
  const html = flairHTML(stars);
  if (html) host.insertAdjacentHTML('beforeend', html);
}
