// UI-24 the bell window (lion-pride-tcg-design UI-24/approved, review-1; D-31, D-80 item 22). Only under body.ui-v3
// (settings.ui_v3): ui-v2-social.js paints this window when the flag is on, and keeps the v2 panel when it is off.
// The data, the Claim calls and the row actions stay in ui-v2-social.js (one logic); this module is the layout:
// - Head: "Notifications", the unread Counter, "Mark all read" (ghost), Close. Tabs All, Hunt, Trades (no Settings
//   tab: D-31 moves the ping settings to the Settings page; the Menu tile still reaches them until UI-61 ships).
// - "Gifts to claim" with one primary button (Claim all) and a secondary Claim on each gift (5.3); a refused claim
//   shows "Something went wrong. Try again." under the gifts head (7.3, 10.6).
// - The Hunt card, then the rows under "Today" and "Earlier". A row body may truncate (10.4); a tap on the row shows
//   its full text in place (the approval's build note).
// - The list pages "1 / N" (3.4, G-022, D-36): no row is dropped. On compact-land there is no pager (Nathan 2026-10-09):
//   every row shows on one screen in smaller rows, in as many columns as the window holds (packColumns). The pager
//   comes back only when even the columns cannot hold the rows (the window never hides a notification).
import { esc, button, iconButton, counter, pager, inlineMessage, stateEmpty } from './components.js';
import { icon } from './icons.js';

export const CLAIM_ERROR = 'Something went wrong. Try again.';

// One SVG icon for each kind (5.2 Icon, G-053: no emoji as icons). Auctions live in the Trade Hall: its icon.
const KIND_ICON = {
  pack_earned: 'package', pack_gift: 'gift', card_gift: 'layers', trade_offer: 'arrow-left-right', trade_counter: 'arrow-left-right',
  trade_accepted: 'circle-check',
};
export function noteIcon(kind) {
  const k = String(kind || '');
  if (KIND_ICON[k]) return KIND_ICON[k];
  if (k.startsWith('auction')) return 'landmark';
  if (k.startsWith('hunt')) return 'swords';
  return 'bell';
}

/**
 * The pages of the list (3.4: the rows that fit, then the Pager). units: [{ h, head?, section?, page2? }] in order.
 * A head (a section label) never ends a page: it moves to the page of its first row, and a section that goes on
 * to the next page shows its head again. A unit with page2 starts page 2 (D-80 22: the Hunt card on compact-land).
 * full = the list height with no pager, paged = the list height with the pager. Returns { pages: [[unit index]] }:
 * a head index can appear on more than one page.
 */
export function packPages(units, { full, paged, gap = 0 }) {
  const run = (H) => {
    const pages = [];
    let cur = []; let used = 0; let head = null; let headOn = false;
    const push = (i) => { used += (cur.length ? gap : 0) + units[i].h; cur.push(i); };
    const lift = units.findIndex((u) => u.page2);
    const order = units.map((_, i) => i).filter((i) => i !== lift);
    const breakPage = () => {
      pages.push(cur); cur = []; used = 0; headOn = false;
      if (lift >= 0 && pages.length === 1) { const h = head; head = null; push(lift); head = h; }
    };
    for (const i of order) {
      const u = units[i];
      if (u.head) { head = i; headOn = false; continue; }
      if (u.section == null) head = null;
      const withHead = head != null && !headOn ? units[head].h + gap : 0;
      const need = (cur.length ? gap : 0) + withHead + u.h;
      if (cur.length && used + need > H) breakPage();
      if (head != null && !headOn) { push(head); headOn = true; }
      push(i);
    }
    if (cur.length) pages.push(cur);
    if (lift >= 0 && !pages.flat().includes(lift)) pages.push([lift]);
    return pages.length ? pages : [[]];
  };
  const one = run(full);
  return { pages: one.length > 1 ? run(paged) : one };
}

/**
 * The columns of one page (compact-land: Nathan 2026-10-09, no paging while the rows fit in columns).
 * Returns pages, each an array of columns, each column an array of unit indexes. With cols = 1 it is packPages.
 * When the rows fit in cols columns of the full height: one page, no pager. Otherwise the pages of the paged height,
 * cols columns on each page.
 */
export function packColumns(units, { full, paged, gap = 0, cols = 1 }) {
  const n = Math.max(1, cols | 0);
  if (n === 1) return packPages(units, { full, paged, gap }).pages.map((c) => [c]);
  const one = packPages(units, { full, paged: full, gap }).pages;
  if (one.length <= n) return [one];
  const many = packPages(units, { full: paged, paged, gap }).pages;
  const out = [];
  for (let i = 0; i < many.length; i += n) out.push(many.slice(i, i + n));
  return out;
}

// ---- The window markup ----
const giftWhat = (g, rarityLabel, coin) => {
  if (g.kind === 'card' && g.card) return `<span class="u3-gift__what u3-r-${esc(g.card.rarity)}">${esc(rarityLabel(g.card.rarity))} card</span>`;
  const parts = [];
  if (g.amount) parts.push(`<span>${g.amount} pack${g.amount === 1 ? '' : 's'}</span>`);
  if (g.shards) parts.push(`<span class="u3-gift__shards">${coin}${Number(g.shards).toLocaleString('en-US')} Shards</span>`);
  return `<span class="u3-gift__what">${parts.join('<span> + </span>')}</span>`;
};
const giftLead = (g, thumb, coin) => {
  if (g.kind === 'card' && g.card?.image_url) return `<span class="u3-gift__card u3-r-${esc(g.card.rarity)}"><img src="${esc(thumb(g.card.image_url))}" alt="" draggable="false"></span>`;
  if (g.shards && !g.amount) return `<span class="u3-gift__ico u3-gift__ico--coin">${coin}</span>`;
  return `<span class="u3-gift__ico">${icon('gift', { size: 'xl' })}</span>`;
};

/** The units of the list for a tab: gifts head + gifts, the Hunt card, then Today and Earlier with their rows. */
export function bellUnits(s) {
  const u = [];
  if (s.gifts.length) {
    const total = s.gifts.filter((g) => g.kind !== 'card').reduce((n, g) => n + (Number(g.amount) || 0), 0);
    const all = s.gifts.length > 1 ? button({ label: `Claim all${total ? ` +${total}` : ''}`, variant: 'primary', size: 'sm', data: { claimall: '' } }) : '';
    // again = the head when its section goes on in the next column or page: the label only (one Claim all)
    u.push({ head: true, html: `<div class="u3-bell__head2"><span class="u3-label">Gifts to claim</span>${all}</div>${s.giftError ? inlineMessage({ kind: 'error', text: CLAIM_ERROR }) : ''}`,
      again: `<div class="u3-bell__head2"><span class="u3-label">Gifts to claim</span></div>` });
    for (const g of s.gifts) {
      u.push({ section: 'gifts', html: `<div class="u3-gift">${giftLead(g, s.thumb, s.coin)}<span class="u3-gift__main"><span class="u3-gift__title">${esc(g.title)}</span>`
        + `${giftWhat(g, s.rarityLabel, s.coin)}</span>${button({ label: 'Claim', variant: 'secondary', size: 'sm', data: { claim: g.id } })}</div>` });
    }
  }
  if (s.hunt && s.tab !== 'trades') {
    const pct = s.hunt.hp_max ? Math.max(0, Math.min(100, Math.round((100 * s.hunt.hp_remaining) / s.hunt.hp_max))) : 0;
    u.push({ html: `<div class="u3-bellhunt"><span class="u3-bellhunt__main"><span class="u3-bellhunt__chip"><span class="u3-bellhunt__live" aria-hidden="true"></span>HUNT</span>`
      + `<span class="u3-bellhunt__name">${esc(s.hunt.name)}</span><span class="u3-bar u3-bar--sm u3-bellhunt__hp" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Boss HP">`
      + `<span class="u3-bar__fill" style="--u3-v:${pct}%"></span></span></span>${button({ label: 'Hunt', variant: 'primary', icon: 'swords', data: { act: 'Hunt' } })}</div>` });
  }
  const today = new Date(s.now).toDateString();
  const list = s.items.filter((x) => s.tab === 'all' || s.kindOf(x.kind).tab === s.tab);
  const groups = [['today', 'Today', list.filter((x) => new Date(x.created_at).toDateString() === today)],
    ['earlier', 'Earlier', list.filter((x) => new Date(x.created_at).toDateString() !== today)]];
  for (const [key, label, rows] of groups) {
    if (!rows.length) continue;
    u.push({ head: true, html: `<span class="u3-label u3-bell__sec">${label}</span>` });
    for (const x of rows) {
      const k = s.kindOf(x.kind);
      const open = s.expanded.has(x.id);
      u.push({ section: key, note: x.id, html: `<div class="u3-note${x.read ? '' : ' is-unread'}${open ? ' is-full' : ''}" data-note="${esc(x.id)}">`
        + `<span class="u3-note__ico">${icon(noteIcon(x.kind), { size: 'lg' })}</span>`
        + `<button type="button" class="u3-note__main" aria-expanded="${open}"><span class="u3-note__text" data-trunc>${esc(s.strip(x.message))}</span>`
        + `${k.label ? `<span class="u3-note__kind">${esc(k.label)}</span>` : ''}</button>`
        + `${k.act ? button({ label: k.act, variant: 'secondary', size: 'sm', data: { act: k.act } }) : ''}`
        + `<span class="u3-note__ago">${esc(s.ago(x.created_at))}</span>${x.read ? '' : '<span class="u3-note__dot" role="img" aria-label="Unread"></span>'}</div>` });
    }
  }
  return u;
}

function frame(s, inline) {
  const tabs = [['all', 'All'], ['hunt', 'Hunt'], ['trades', 'Trades']];
  // the Settings tab stays in the markup, hidden: the Menu's Settings tile opens it (shell.js) until UI-61 ships
  const seg = `<div class="u3-seg u3-bell__tabs nt-tabs" role="tablist" aria-label="Notifications">${tabs.map(([v, l]) => `<button type="button" role="tab" class="u3-seg__item${s.tab === v ? ' is-active' : ''}"`
    + ` aria-selected="${s.tab === v}" data-t="${v}"><span>${l}</span></button>`).join('')}<button type="button" data-t="settings" hidden>Settings</button></div>`;
  const read = s.unread ? button({ label: 'Mark all read', variant: 'ghost', size: 'sm', icon: 'check', data: { read: '' } }) : '';
  // inline = the tabs share the head line (compact-land when the line has room: paintBell measures it, more rows fit, 3.4)
  return `<header class="u3-bell__head${inline ? ' is-inline' : ''}"><h2 class="u3-bell__title" id="u3BellT">Notifications</h2>${s.unread ? counter(s.unread) : ''}`
    + `<span class="u3-bell__grow"></span>${read}${inline ? seg : ''}<span class="u3-bell__close" data-close>${iconButton({ icon: 'x', label: 'Close' })}</span></header>${inline ? '' : seg}`
    + `<div class="u3-bell__list" id="ntList"></div><div class="u3-bell__pager" hidden></div>`;
}

// How many columns the list holds: its width over the least column width (--bell-colw, measured with a probe).
function bellCols(list) {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--bell-colw);height:0';
  list.appendChild(probe);
  const colw = probe.getBoundingClientRect().width;
  probe.remove();
  const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
  return colw > 0 ? Math.max(1, Math.floor((list.clientWidth + gap) / (colw + gap))) : 1;
}

/**
 * Paint the window into box. s = { tab, items, gifts, hunt, unread, giftError, page, expanded (Set of ids), size, now,
 * kindOf, strip, ago, thumb, coin, rarityLabel, settings (HTML or null), focus (a row id or null) }. Returns { pages, page }.
 */
export function paintBell(box, s) {
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-labelledby', 'u3BellT');
  box.innerHTML = frame(s, s.size === 'compact-land');
  const head = box.querySelector('.u3-bell__head');
  // the head line has no room for the tabs beside the title: the tabs take their own row under it
  if (head.classList.contains('is-inline') && head.scrollWidth > head.clientWidth + 1) box.innerHTML = frame(s, false);
  const list = box.querySelector('.u3-bell__list');
  const pg = box.querySelector('.u3-bell__pager');
  if (s.settings != null) { list.innerHTML = s.settings; return { pages: 1 }; }
  const units = bellUnits(s);
  if (!units.length) { list.innerHTML = stateEmpty({ title: 'Nothing here yet.' }); return { pages: 1 }; }
  // measure: every unit once, the list height with and without the pager. compact-land holds columns: the fewest
  // columns that hold every row without a pager (at most colsMax, the window width over the least column width)
  const land = s.size === 'compact-land';
  list.classList.toggle('is-cols', land);
  const colsMax = land ? bellCols(list) : 1;
  let pages;
  for (let n = 1; n <= colsMax; n++) {
    list.style.setProperty('--bell-cols', n);
    list.innerHTML = units.map((u, i) => `<div class="u3-bell__u" data-u="${i}">${u.html}</div>`).join('');
    pg.innerHTML = pager({ page: 1, pages: 2 });
    pg.hidden = false;
    const paged = list.clientHeight;
    pg.hidden = true;
    const full = list.clientHeight;
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    units.forEach((u, i) => { u.h = list.children[i].getBoundingClientRect().height; });
    pages = packColumns(units, { full, paged, gap, cols: n });
    if (pages.length === 1 || n === colsMax) break;
  }
  // the page of the row that the member just opened or closed (its new height can move it), else the asked page
  const fi = s.focus != null ? units.findIndex((u) => u.note === s.focus) : -1;
  const at = fi >= 0 ? pages.findIndex((p) => p.some((c) => c.includes(fi))) + 1 : 0;
  const page = at || Math.min(Math.max(1, s.page | 0), pages.length);
  const shown = pages[page - 1];
  list.style.setProperty('--bell-cols', Math.max(1, shown.length));
  const seen = new Set();
  const cell = (i) => { const again = seen.has(i) && units[i].again; seen.add(i); return `<div class="u3-bell__u">${again || units[i].html}</div>`; };
  list.innerHTML = land
    ? shown.map((c) => `<div class="u3-bell__col">${c.map(cell).join('')}</div>`).join('')
    : shown[0].map(cell).join('');
  pg.innerHTML = pages.length > 1 ? pager({ page, pages: pages.length }) : '';
  pg.hidden = pages.length <= 1;
  return { pages: pages.length, page, cols: shown.length };
}
