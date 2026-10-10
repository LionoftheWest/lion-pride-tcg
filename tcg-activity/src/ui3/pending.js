// UI-25: Pending (D-32, D-35; design repo UI-25/approved): the open trade offers of the caller, in two sections
// (Incoming, Sent). The markup only; src/ui-v2-social.js owns the data, the actions, the fit and the paging.
// Row = Row/offer (D-30): the member, the two cards (Card/thumb 64 px, GET / GIVE under them), the actions on the right.
// A tap on the row opens the Offer view. Accept is a secondary button, Decline the danger button (5.3, D-64 item 10).
import { esc, button, iconButton, counter, pager, chip } from './components.js';
import { breakName } from './member-picker.js';
import { icon } from './icons.js';

/** The time since an ISO date: "just now", "5m ago", "3h ago", "1d ago". Pure (unit-tested). */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!t) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * What an offer asks of me. Pure (unit-tested). The same rules as the v2 Offers panel:
 * incoming + countered: I picked a card and wait for them ("wait");
 * incoming with a request: Accept; incoming with no request: I pick my card ("pick");
 * sent + countered: they picked a card, I accept ("accept"); sent: wait.
 */
export function offerKind(o, dir) {
  if (dir === 'in') return o.status === 'countered' ? 'wait' : (o.request ? 'accept' : 'pick');
  return o.status === 'countered' ? 'accept' : 'wait';
}
/** The sent-row status text (as the v2 panel). */
export const sentStatus = (o) => (o.status === 'countered' ? 'Picked a card' : o.request ? 'Waiting' : 'Picking a card');

/** The rows: incoming first those that wait for me; sent first those that I can accept. Hidden ids (an undo window) leave. */
export function pendingLists(offers, hidden = new Set()) {
  const keep = (o) => !hidden.has(Number(o.id));
  const inc = [...(offers?.incoming || [])].filter(keep).sort((x, y) => (x.status === 'countered') - (y.status === 'countered'));
  const out = [...(offers?.outgoing || [])].filter(keep).sort((x, y) => (y.status === 'countered') - (x.status === 'countered'));
  return { inc, out };
}
/** The number of offers that wait for me: the count in the heading and the Dot on the Pending button. */
export const waiting = ({ inc, out }) => inc.filter((o) => o.status !== 'countered').length + out.filter((o) => o.status === 'countered').length;

function cardThumb(c, tag, h) {
  if (!c) return '';
  return `<span class="u3-pd-card"><span class="u3-pd-card__img u3-r-${esc(c.rarity || 'normal')}"><img src="${esc(h.thumb(c.image_url))}" data-full="${esc(c.image_url || '')}" alt="${esc(c.name || '')}" draggable="false"></span>`
    + `<span class="u3-pd-card__tag">${tag}</span></span>`;
}
const swap = () => `<span class="u3-pd-swap" aria-hidden="true">${icon('arrow-left-right')}</span>`;

/** A row action: the icon and the label; the tight form shows the icon only (the name stays in aria-label). */
function act(label, variant, ic, id, name) {
  return button({ label, variant, icon: ic, data: { act: name, id } }).replace('<button', `<button aria-label="${esc(label)}"`);
}

/** One row. dir: 'in' | 'out'. h: { thumb(url), avatar(id, name) }. */
export function rowHTML(o, dir, h) {
  const k = offerKind(o, dir);
  const who = dir === 'in' ? { id: o.from_id, name: o.from_name } : { id: o.to_id, name: o.to_name };
  const name = who.name || 'Someone';
  const status = dir === 'out' ? sentStatus(o) : (k === 'wait' ? 'Waiting' : '');
  // incoming: they give o.offer (GET) for o.request (GIVE); sent: I give o.offer (GIVE) for o.request (GET)
  const first = cardThumb(o.offer, dir === 'in' ? 'Get' : 'Give', h);
  const second = o.request ? swap() + cardThumb(o.request, dir === 'in' ? 'Give' : 'Get', h) : '';
  const data = { id: o.id };
  let acts = '';
  if (dir === 'in') {
    const main = k === 'accept' ? act('Accept', 'secondary', 'check', o.id, 'accept')
      : k === 'pick' ? act('Pick your card', 'secondary', 'arrow-left-right', o.id, 'pick') : '';
    acts = `${main}${act('Decline', 'danger', 'x', o.id, 'decline')}`;
  } else {
    acts = `${k === 'accept' ? act('Accept', 'secondary', 'check', o.id, 'accept') : ''}`
      + iconButton({ icon: 'x', label: 'Cancel offer', variant: 'panel', data: { act: 'cancel', ...data } });
  }
  return `<li class="u3-pd-row u3-pd-row--${dir} is-${k}" data-oid="${esc(o.id)}">`
    + `<button type="button" class="u3-pd-row__open" data-act="view" data-id="${esc(o.id)}" aria-label="${esc(`Offer ${dir === 'in' ? 'from' : 'to'} ${name}`)}">`
    + `<span class="u3-pd-row__who">${h.avatar(who.id, name)}<span class="u3-pd-row__name">${breakName(name)}</span>${status ? `<span class="u3-pd-row__st">${esc(status)}</span>` : ''}</span>`
    + `<span class="u3-pd-row__cards">${first}${second}</span></button>`
    + `<span class="u3-pd-row__acts">${acts}</span></li>`;
}

function section(key, label, rows, per, page, empty, h, dir) {
  const pages = Math.max(1, Math.ceil(rows.length / (per || rows.length || 1)));
  const p = Math.min(page, pages - 1);
  const shown = per ? rows.slice(p * per, p * per + per) : rows;
  return `<section class="u3-pd-sec" data-sec="${key}" aria-label="${label}"><div class="u3-pd-sec__head"><h3 class="u3-label">${label}</h3><span class="u3-pd-sec__n">${rows.length}</span></div>`
    + (rows.length ? `<ul class="u3-pd-sec__list">${shown.map((o) => rowHTML(o, dir, h)).join('')}</ul>` : `<p class="u3-pd-empty">${empty}</p>`)
    + (pages > 1 ? `<div class="u3-pd-sec__pager">${pager({ page: p + 1, pages })}</div>` : '') + '</section>';
}

/** The sections. st: { inc, out, perIn, perOut, pageIn, pageOut } (per 0 = all rows). The caller fits per. */
export function sectionsHTML(st, h) {
  return section('in', 'Incoming', st.inc, st.perIn, st.pageIn || 0, 'No incoming offers.', h, 'in')
    + section('out', 'Sent', st.out, st.perOut, st.pageOut || 0, 'No sent offers.', h, 'out');
}
/** The head of the side panel: the title and the count of offers that wait for me. */
export const headHTML = (n, sheet = false) => (sheet ? '' : `<div class="u3-pd__head"><h2 class="u3-pd__title">Pending</h2>${n ? counter(n) : ''}</div>`);

/** The Offer view (D-30): the member, the status, the time, both cards large, the actions. */
export function viewHTML(o, dir, h) {
  const k = offerKind(o, dir);
  const who = dir === 'in' ? { id: o.from_id, name: o.from_name } : { id: o.to_id, name: o.to_name };
  const big = (c, tag) => (c ? `<span class="u3-pd-big"><span class="u3-pd-big__img u3-r-${esc(c.rarity || 'normal')}"><img src="${esc(c.image_url || '')}" alt="${esc(c.name || '')}" draggable="false"></span><span class="u3-pd-card__tag">${tag}</span></span>` : '');
  const t = ago(o.created_at);
  const accept = button({ label: 'Accept', variant: 'primary', icon: 'check', data: { act: 'accept', id: o.id } });
  const foot = dir === 'in'
    ? `${button({ label: 'Decline', variant: 'danger', icon: 'x', data: { act: 'decline', id: o.id } })}${k === 'accept' ? accept : k === 'pick' ? button({ label: 'Pick your card', variant: 'primary', data: { act: 'pick', id: o.id } }) : ''}`
    : `${button({ label: 'Cancel offer', variant: 'danger', icon: 'x', data: { act: 'cancel', id: o.id } })}${k === 'accept' ? accept : ''}`;
  return `<div class="u3-scrim u3-pd-scrim" data-u3-scrim><div class="u3-dialog u3-pd-view" role="dialog" aria-modal="true" aria-labelledby="u3PdVt">`
    + `<header class="u3-pd-view__head">${h.avatar(who.id, who.name || 'Someone')}<div class="u3-pd-view__who"><span class="u3-label">Trade offer</span>`
    + `<div class="u3-pd-view__line"><h2 class="u3-pd-view__name" id="u3PdVt">${breakName(who.name || 'Someone')}</h2>${chip({ label: dir === 'in' ? 'Incoming' : 'Sent', kind: 'status' })}</div>`
    + `${t ? `<span class="u3-pd-view__time">Sent ${t}</span>` : ''}</div>${iconButton({ icon: 'x', label: 'Close', variant: 'plain', data: { act: 'close' } })}</header>`
    + `<div class="u3-pd-view__cards">${big(o.offer, dir === 'in' ? 'Get' : 'Give')}${o.request ? swap() + big(o.request, dir === 'in' ? 'Give' : 'Get') : ''}</div>`
    + `<footer class="u3-pd-view__foot">${foot}</footer></div></div>`;
}
