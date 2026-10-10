// UI-24 the bell window (lion-pride-tcg-design UI-24/approved, review-1; D-31, D-80 item 22). Only under body.ui-v3
// (settings.ui_v3): ui-v2-social.js paints this window when the flag is on, and keeps the v2 panel when it is off.
// The data, the Claim calls and the row actions stay in ui-v2-social.js (one logic); this module is the layout:
// - Head: "Notifications", the unread Counter, "Mark all read" (ghost), Close. Tabs All, Hunt, Trades (no Settings
//   tab: D-31 moves the ping settings to the Settings page; the Menu tile still reaches them until UI-61 ships).
// - "Gifts to claim" with one primary button (Claim all) and a secondary Claim on each gift (5.3); a refused claim
//   shows "Something went wrong. Try again." under the gifts head (7.3, 10.6).
// - The Hunt card, then the rows under "Today" and "Earlier". A row body may truncate (10.4); a tap on the row shows
//   its full text in place (the approval's build note).
// - The rows that do not fit scroll: the Earlier rows (the Today rows when there is no Earlier) are the named scroll
//   area "bell notes" with a visible rail (3.3, D-07, D-144), like the FAQ list. No pager; no row is dropped.
import { esc, button, iconButton, counter, inlineMessage, stateEmpty } from './components.js';
import { watchRail } from './scroll-rail.js';
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

/** The units of the list for a tab: gifts head + gifts, the Hunt card, then Today and Earlier with their rows.
 *  scroll = true on the rows of the scroll area (the Earlier rows, or the Today rows when there is no Earlier). */
export function bellUnits(s) {
  const u = [];
  if (s.gifts.length) {
    const total = s.gifts.filter((g) => g.kind !== 'card').reduce((n, g) => n + (Number(g.amount) || 0), 0);
    const all = s.gifts.length > 1 ? button({ label: `Claim all${total ? ` +${total}` : ''}`, variant: 'primary', size: 'sm', data: { claimall: '' } }) : '';
    u.push({ head: true, html: `<div class="u3-bell__head2"><span class="u3-label">Gifts to claim</span>${all}</div>${s.giftError ? inlineMessage({ kind: 'error', text: CLAIM_ERROR }) : ''}` });
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
  const scrollKey = groups[1][2].length ? 'earlier' : 'today';
  for (const [key, label, rows] of groups) {
    if (!rows.length) continue;
    u.push({ head: true, html: `<span class="u3-label u3-bell__sec">${label}</span>` });
    for (const x of rows) {
      const k = s.kindOf(x.kind);
      const open = s.expanded.has(x.id);
      u.push({ section: key, scroll: key === scrollKey, note: x.id, html: `<div class="u3-note${x.read ? '' : ' is-unread'}${open ? ' is-full' : ''}" data-note="${esc(x.id)}">`
        + `<span class="u3-note__ico">${icon(noteIcon(x.kind), { size: 'lg' })}</span>`
        + `<button type="button" class="u3-note__main" aria-expanded="${open}"><span class="u3-note__text" data-trunc>${esc(s.strip(x.message))}</span>`
        + `${k.label ? `<span class="u3-note__kind">${esc(k.label)}</span>` : ''}</button>`
        + `${k.act ? button({ label: k.act, variant: 'secondary', size: 'sm', data: { act: k.act } }) : ''}`
        + `<span class="u3-note__ago">${esc(s.ago(x.created_at))}</span>${x.read ? '' : '<span class="u3-note__dot" role="img" aria-label="Unread"></span>'}</div>` });
    }
  }
  return u;
}

function frame(s) {
  const tabs = [['all', 'All'], ['hunt', 'Hunt'], ['trades', 'Trades']];
  // the Settings tab stays in the markup, hidden: the Menu's Settings tile opens it (shell.js) until UI-61 ships
  const seg = `<div class="u3-seg u3-bell__tabs nt-tabs" role="tablist" aria-label="Notifications">${tabs.map(([v, l]) => `<button type="button" role="tab" class="u3-seg__item${s.tab === v ? ' is-active' : ''}"`
    + ` aria-selected="${s.tab === v}" data-t="${v}"><span>${l}</span></button>`).join('')}<button type="button" data-t="settings" hidden>Settings</button></div>`;
  const read = s.unread ? button({ label: 'Mark all read', variant: 'ghost', size: 'sm', icon: 'check', data: { read: '' } }) : '';
  // The tabs keep their own row on every class: on compact-land the head line keeps the Discord corner zone free (2.3)
  const inline = false;
  return `<header class="u3-bell__head"><h2 class="u3-bell__title" id="u3BellT">Notifications</h2>${s.unread ? counter(s.unread) : ''}`
    + `<span class="u3-bell__grow"></span>${read}${inline ? seg : ''}<span class="u3-bell__close" data-close>${iconButton({ icon: 'x', label: 'Close' })}</span></header>${inline ? '' : seg}`
    + `<div class="u3-bell__list" id="ntList"></div>`;
}

let stopRail = null;

/**
 * Paint the window into box. s = { tab, items, gifts, hunt, unread, giftError, expanded (Set of ids), size, now,
 * kindOf, strip, ago, thumb, coin, rarityLabel, settings (HTML or null), focus (a row id or null) }.
 * The rows that scroll sit in the named scroll area "bell notes" (the rail shows only when they overflow). After a tap
 * on a row (focus) the scroll position stays and the row is kept whole in view. Returns { scroll: boolean }.
 */
export function paintBell(box, s) {
  const keep = s.focus != null ? box.querySelector('.u3-bell__scroll')?.scrollTop || 0 : 0;
  stopRail?.(); stopRail = null;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-labelledby', 'u3BellT');
  box.innerHTML = frame(s);
  const list = box.querySelector('.u3-bell__list');
  if (s.settings != null) { list.innerHTML = s.settings; return { scroll: false }; }
  const units = bellUnits(s);
  if (!units.length) { list.innerHTML = stateEmpty({ title: 'Nothing here yet.' }); return { scroll: false }; }
  const wrap = (u) => `<div class="u3-bell__u">${u.html}</div>`;
  const rows = units.filter((u) => u.scroll);
  list.innerHTML = `<div class="u3-bell__fixed">${units.filter((u) => !u.scroll).map(wrap).join('')}</div>`
    + (rows.length ? `<div class="u3-bell__area"><div class="u3-bell__scroll" role="region" aria-label="Notifications list" data-scroll-area="bell notes" tabindex="0">${rows.map(wrap).join('')}</div>`
      + `<span class="u3-bell__rail" aria-hidden="true" hidden><span class="u3-bell__thumb"></span></span></div>` : '');
  const sc = list.querySelector('.u3-bell__scroll');
  if (!sc) return { scroll: false };
  sc.scrollTop = keep;
  const row = s.focus != null ? sc.querySelector(`[data-note="${CSS.escape(String(s.focus))}"]`)?.parentElement : null;
  if (row && sc.scrollHeight > sc.clientHeight + 1) {
    const top = row.offsetTop - sc.offsetTop, bottom = top + row.offsetHeight;
    if (row.offsetHeight >= sc.clientHeight || top < sc.scrollTop) sc.scrollTop = top;
    else if (bottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = bottom - sc.clientHeight;
  }
  stopRail = watchRail(sc, list.querySelector('.u3-bell__rail'), '--bell-thumb-top', '--bell-thumb-h');
  return { scroll: true };
}
