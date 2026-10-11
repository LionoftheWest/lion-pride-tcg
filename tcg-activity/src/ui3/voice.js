// UI-06 Live in voice (v3 only, body.ui-v3): the "+N" window (D-59). A tap on "+N" opens a window with every member in voice,
// the others first and you last (the order the tile already has), paged "1 / N" where the rows do not fit (no scroll, 3.3).
// A side panel on expanded, a side sheet on medium and compact-land, a bottom sheet on compact-port. The page size is MEASURED
// on the list (voicePaging), never from a window size (F-1). All styles: public/ui3/90-ui-06.css.
import { sheet, pager } from './components.js';

/** The label of the "+N" button. */
export const moreLabel = (total) => `Show all ${total | 0} in voice`;
/** The window title. */
export const windowTitle = (total) => `Live in voice · ${total | 0}`;
/** The sheet side for a size class: the bottom sheet on compact-port, a side sheet on every other class (D-59). */
export const sheetSide = (size) => (size === 'compact-port' ? 'bottom' : 'side');

/** How many rows one page holds. n = members, listH = the list height WITH the pager shown, rowH, gap, pagerH.
 *  When all rows fit without the pager (it gives its room back), there is one page and no pager. */
export function voicePaging(n, listH, rowH, gap, pagerH) {
  const fit = (h) => Math.max(1, Math.floor((h + gap) / (rowH + gap)));
  if (n <= fit(listH + pagerH)) return { per: Math.max(1, n), pages: 1 };
  const per = fit(listH);
  return { per, pages: Math.max(1, Math.ceil(n / per)) };
}

/** Open the window. rows = the member row HTML strings (voiceCellHTML), total = their count, onPick(memberId, el) = a tap on a member. Returns close(). */
export function openVoiceWindow(rows, { onPick, from = null } = {}) {
  document.getElementById('u3VoiceWin')?.remove();
  const host = document.createElement('div');
  host.id = 'u3VoiceWin';
  host.innerHTML = sheet({ side: sheetSide(document.body.dataset.size), title: windowTitle(rows.length), body: '<div class="u3-vw-list" id="u3VwList"></div><div class="u3-vw-pg" id="u3VwPg"></div>' });
  const aside = host.querySelector('.u3-sheet');
  aside.classList.add('u3-vw');
  document.body.appendChild(host);
  const list = host.querySelector('#u3VwList');
  const pg = host.querySelector('#u3VwPg');
  let page = 1;
  const paint = () => {
    pg.innerHTML = pager({ page: 1, pages: 2 });   // the pager takes its room before the rows are counted
    list.innerHTML = rows.join('');
    const probe = list.querySelector('.u3-hm-cell');
    const rowH = probe ? probe.getBoundingClientRect().height : 0;
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    const { per, pages } = rowH ? voicePaging(rows.length, list.clientHeight, rowH, gap, pg.getBoundingClientRect().height) : { per: rows.length, pages: 1 };
    page = Math.min(page, pages);
    [...list.children].forEach((c, i) => { c.hidden = i < (page - 1) * per || i >= page * per; });
    pg.innerHTML = pages > 1 ? pager({ page, pages }) : '';
    pg.onclick = (e) => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) { page += b.dataset.page === 'next' ? 1 : -1; paint(); } };
  };
  const close = () => { host.remove(); document.removeEventListener('keydown', onKey, true); from?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  host.addEventListener('click', (e) => {
    if (e.target.closest('.u3-sheet__head .u3-ibtn') || e.target === host.querySelector('[data-u3-scrim]')) { close(); return; }
    const t = e.target.closest('[data-member]');
    if (t) { const id = t.dataset.member; const watch = t.classList.contains('watch'); close(); onPick?.(id, watch); }
  });
  paint();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (host.isConnected) paint(); }).observe(list);
  host.querySelector('.u3-sheet__head .u3-ibtn')?.focus();
  return close;
}
