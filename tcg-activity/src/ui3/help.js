// UI-38 the FAQ window, v3 (lion-pride-tcg-design UI-38/approved, review-1; FEEDBACK D-80 items 4 and 5: the title is
// "FAQ", answer 1 starts with "Play."). Only under body.ui-v3 (settings.ui_v3): ui-v2-help.js paints this HTML in place
// of its v2 markup and keeps all of its logic (the entries, one answer open at a time, Replay tutorial). With the flag
// off nothing here runs.
// - The window is a bottom sheet on the dock edge on compact-port, a side sheet on compact-land (out of the Discord
//   corner zone), and a panel under the top bar on medium and expanded (ui3.css "FAQ window", ui3/90-ui-38.css).
// - The list is the named scroll area "help answers" (3.3, D-07) with a scroll cue, only when the questions do not fit.
import { esc, iconButton, button, chip } from './components.js';
import { icon } from './icons.js';

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

const MIN_THUMB = 0.12;   // the shortest thumb, as a share of the rail (a very long list keeps a thumb that can be seen)

/** The scroll cue (3.3, D-07): the thumb of the rail for a list. Pure: show = the list overflows; top and height are
 *  percent of the rail. The thumb is as long as the visible share of the list and moves with scrollTop. */
export function thumbMetrics({ scrollTop, clientHeight, scrollHeight }) {
  if (!(scrollHeight > clientHeight + 1) || !(clientHeight > 0)) return { show: false, top: 0, height: 100 };
  const height = Math.min(100, Math.max(MIN_THUMB, clientHeight / scrollHeight) * 100);
  const room = scrollHeight - clientHeight;
  const share = Math.min(1, Math.max(0, scrollTop / room));
  return { show: true, top: share * (100 - height), height };
}

/** Put the rail of the area in line with its list. Called on scroll, on resize and after every repaint. */
export function syncRail(area) {
  const list = area?.querySelector('.u3-hp__list'), rail = area?.querySelector('.u3-hp__rail');
  if (!list || !rail) return;
  const m = thumbMetrics(list);
  rail.hidden = !m.show;
  rail.style.setProperty('--hp-thumb-top', `${m.top}%`);
  rail.style.setProperty('--hp-thumb-h', `${m.height}%`);
}
