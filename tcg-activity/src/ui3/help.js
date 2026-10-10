// UI-38 the FAQ window, v3 (lion-pride-tcg-design UI-38/approved, review-1; FEEDBACK D-80 items 4 and 5: the title is
// "FAQ", answer 1 starts with "Play."). Only under body.ui-v3 (settings.ui_v3): ui-v2-help.js paints this HTML in place
// of its v2 markup and keeps all of its logic (the entries, one answer open at a time, Replay tutorial). With the flag
// off nothing here runs.
// - The window is a bottom sheet on the dock edge on compact-port, a side sheet on compact-land (out of the Discord
//   corner zone), and a panel under the top bar on medium and expanded (ui3.css "FAQ window", ui3/90-ui-38.css).
// - The list is the named scroll area "help answers" (3.3, D-07) with a scroll cue, only when the questions do not fit.
import { esc, iconButton, button, chip } from './components.js';
import { icon } from './icons.js';
import { thumbMetrics, syncRailEls } from './scroll-rail.js';

// One icon has one meaning (D-50): the Hunt swords, Boons party-popper, Trades arrow-left-right.
const ICON = ['package', 'timer', 'gem', 'star', 'swords', 'calendar-check', 'party-popper', 'arrow-left-right', 'bell-off'];

/** The window's inside. faq = the entries of ui-v2-help.js (q3 / a3 are the v3 texts); open = the open entry (-1 = none). */
export function helpHTML(faq, open) {
  const head = `<header class="u3-hp__head"><h2 class="u3-hp__title" id="u3HpTitle">FAQ</h2>${iconButton({ icon: 'x', label: 'Close', data: { 'hp-close': '1' } })}</header>`;
  const items = faq.map((f, i) => {
    const on = i === open;
    const q = esc(f.q3 || f.q);
    return `<div class="u3-hp__item${on ? ' is-open' : ''}" data-i="${i}">`
      + `<button type="button" class="u3-hp__q" aria-expanded="${on}" data-q="${i}"><span class="u3-hp__ico">${icon(ICON[i] || 'circle-help', { size: 'xl' })}</span>`
      + `<b class="u3-hp__qt">${q}</b><span class="u3-hp__chev">${icon(on ? 'chevron-up' : 'chevron-down', { size: 'lg' })}</span></button>`
      + `${on ? `<div class="u3-hp__a"><p>${esc(f.a3 || f.a)}</p>${f.chips ? `<div class="u3-hp__chips">${f.chips.map((c) => chip({ label: c, kind: 'status' })).join('')}</div>` : ''}</div>` : ''}</div>`;
  }).join('');
  return `${head}<div class="u3-hp__area"><div class="u3-hp__list" role="region" aria-label="Help answers" data-scroll-area="help answers" tabindex="0">${items}</div>`
    + `<span class="u3-hp__rail" aria-hidden="true" hidden><span class="u3-hp__thumb"></span></span></div>`
    + `<div class="u3-hp__foot">${button({ label: 'Replay tutorial', variant: 'secondary', icon: 'rotate-ccw', data: { 'hp-replay': '1' } })}</div>`;
}

/** Keep the open answer whole in the list (the list scrolls only when the questions do not fit). */
export function showOpen(list) {
  const it = list?.querySelector('.u3-hp__item.is-open');
  if (!it || list.scrollHeight <= list.clientHeight + 1) return;
  const top = it.offsetTop, bottom = top + it.offsetHeight;
  if (it.offsetHeight >= list.clientHeight || top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

export { thumbMetrics };

/** Put the rail of the area in line with its list. Called on scroll, on resize and after every repaint. */
export function syncRail(area) {
  syncRailEls(area?.querySelector('.u3-hp__list'), area?.querySelector('.u3-hp__rail'), '--hp-thumb-top', '--hp-thumb-h');
}
