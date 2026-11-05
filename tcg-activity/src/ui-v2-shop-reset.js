// The Stat reset panel of the v2 Shop (ui-v2-shop.js), as pure functions with no DOM import, so a unit test can read the
// markup (UI-43 r2 M-1: ui-v2-shop.js imports ui-v2.js and cannot load in node). The markup is the same as before.
// h = the helpers of ui-v2-shop.js: { esc, price, icon: { reset, cal, arrow }, nextDay }.
import { RESET_PAUSED } from './ui3/shop.js';

/** UI-43 N-10 (Nathan 2026-11-04 "Sure do option 1"): false while combat v2 progress is ON (shop_today.stat_reset_paused). */
export const resetOpen = (d) => !d?.stat_reset_paused;

export function resetHTMLv2(d, h) {
  const paused = !resetOpen(d);
  return `<section class="sh-panel sh-reset">
      <div class="sh-ph"><span class="sh-ico prank">${h.icon.reset}</span><b>Stat reset</b><span class="grow"></span>${h.price(d.stat_reset_price, 'sm')}</div>
      <div class="sh-free${d.free_reset && !paused ? ' ok' : ''}">${h.icon.cal}<b>Free weekly reset</b><span class="grow"></span><span>${paused ? 'Paused' : d.free_reset ? 'Available' : `Used · back ${h.esc(h.nextDay(d.free_reset_next))}`}</span></div>
      ${paused ? `<div class="sh-err">${h.esc(RESET_PAUSED)}</div>` : ''}
      <span class="grow"></span>
      <button class="v2-btn sh-choose"${paused ? ' disabled aria-disabled="true"' : ''}>Choose a card ${h.icon.arrow}</button>
    </section>`;
}
