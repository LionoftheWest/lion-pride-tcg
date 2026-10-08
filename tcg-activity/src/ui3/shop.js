// UI-43 the Shop (lion-pride-tcg-design UI-43/approved, review-1; D-41, D-80 item 23). Only under body.ui-v3
// (settings.ui_v3): ui-v2-shop.js paints this layout when the flag is on and keeps the v2 Shop when it is off. The
// data, the prices, the buy calls and the windows' logic stay in ui-v2-shop.js (one logic); this module is the layout:
// - Today's stock, Packs and Stat reset are sub-tabs in the row under the top bar on compact and medium (D-37, D-27);
//   expanded keeps Packs and Stat reset as a right column with no tab row (D-41).
// - Every stock card is one ShopItem: the card face, then the price pill, which is the Buy button (D-80 23). Featured is
//   the same item, larger. "New" stays on the card; no owned badge (D-29).
// - "New stock in" is a chip in the stock header on every class.
// - The card width is the one number this module computes (3.5): the largest that fits the stock area for the layout
//   of the class (row: compact-land; wide: medium landscape and expanded; tall: medium portrait; port: compact-port,
//   which pages by blocks, 3.4).
import { esc, button, iconButton, pager, inlineMessage, rewardPill } from './components.js';
import { icon } from './icons.js';
import { TOKENS } from '../tokens.js';
import { thumb } from '../thumb.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/** The layout for a size class and the stock area (D-41, D-46: a tall area stacks rows, a wide area keeps columns). */
export function shopLayout(size, width, height) {
  if (size === 'compact-port') return 'port';
  if (size === 'compact-land') return 'row';
  if (size === 'medium' && height > width) return 'tall';
  return 'wide';
}

/**
 * The card widths (3.5). m = { W, H, gap (between cards), G (between groups), labelH, si (inner gap), pillH,
 * f (0/1 Featured), ir, nm, labelW: [the label width of each group, in order], ratio, max }. Returns { w, fw } in CSS px
 * (floored). A block = label + si + card + si + pill. A group is as wide as its cards or its label, whichever is wider.
 */
export function fitShop(layout, m) {
  const { W, H, gap: g, G, labelH, si, pillH, f = 1, ir = 3, nm = 6, ratio = TOKENS['card-ratio'], max = TOKENS['card-tile-max'] } = m;
  const extra = labelH + 2 * si + pillH;   // a block without its card
  const byH = (h) => (h - extra) / ratio;   // the card width whose block fits the height h
  let w; let fw;
  if (layout === 'row') {
    const groups = [f, ir, nm].filter(Boolean);
    const lw = m.labelW || [];
    const width = (x) => groups.reduce((t, k, i) => t + Math.max(lw[i] || 0, k * x + (k - 1) * g), 0) + (groups.length - 1) * G;
    let lo = 0; let hi = Math.max(0, byH(H));
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (width(mid) <= W) lo = mid; else hi = mid; }
    w = lo;
    fw = w;
  } else if (layout === 'wide') {
    const right = Math.max(ir, nm, 1);
    const rows = (ir ? 1 : 0) + (nm ? 1 : 0) || 1;
    const wH = (H - (rows - 1) * G - rows * extra) / (rows * ratio);
    // Featured at most 3.2 cards wide (UI-43 approved 917x692 and 1280x720: 224 to 70, 230 to 72), so a squarer area
    // does not give it all the width
    const k = f ? 3.2 : 0;
    w = Math.min(max, wH, (W - (f ? G : 0) - (right - 1) * g) / (right + k));
    fw = f ? Math.min(byH(H), k * w) : 0;
    w = Math.min(max, wH, (W - (f ? fw + G : 0) - (right - 1) * g) / right);   // the room Featured leaves
  } else if (layout === 'tall') {
    const top = ir;
    w = Math.min(max, (W - (Math.max(nm, 1) - 1) * g) / Math.max(nm, 1));
    const row2 = nm ? extra + w * ratio : 0;
    const wTop = byH(H - row2 - (nm ? G : 0));
    w = Math.min(w, wTop);
    // Featured at most 1.65 cards wide (UI-43 approved 768x1024: 180 to 109), so the row above the Normal cards stays one block
    fw = f ? Math.min(byH(H - row2 - (nm ? G : 0)), W - (top ? G + top * w + (top - 1) * g : 0), w * 1.65) : 0;
  } else {   // port: 3 in a row; one block must fit the page
    w = Math.min((W - 2 * g) / 3, byH(H));
    // Featured and the Illustrated Rare row share page 1 when a card at most 15% smaller lets them (UI-43 approved 430x932)
    const pair = f && ir ? (H - G - 2 * extra) / (ratio * 2.15) : 0;
    if (pair >= w * 0.85 && pair < w) w = pair;
    fw = Math.min(w * 1.15, W, byH(H));
  }
  return { w: Math.max(0, Math.floor(w)), fw: Math.max(0, Math.floor(fw)) };
}

/**
 * The compact-port pages (3.4): the blocks that fit, then the next page. units: [{ h, head? }] in order; a head (a group
 * label) never ends a page and shows again on the next page when its group goes on. A unit's gap is the space above it
 * (none at the top of a page; an item under its head uses the head's own gap below). full / paged = the area height
 * without / with the pager. Returns [[unit index]]. (The bell, UI-24, pages its rows the same way.)
 */
export function pageBlocks(units, { full, paged, gap = 0 }) {
  const gapOf = (i) => units[i].gap ?? gap;
  const run = (H) => {
    const pages = [];
    let cur = []; let used = 0; let head = null; let headOn = false;
    const push = (i, g) => { used += (cur.length ? g : 0) + units[i].h; cur.push(i); };
    for (let i = 0; i < units.length; i++) {
      if (units[i].head) { head = i; headOn = false; continue; }
      const withHead = head != null && !headOn;
      const need = withHead ? (cur.length ? gapOf(head) : 0) + units[head].h + (units[head].below ?? gapOf(i)) + units[i].h : (cur.length ? gapOf(i) : 0) + units[i].h;
      if (cur.length && used + need > H) { pages.push(cur); cur = []; used = 0; headOn = false; }
      if (head != null && !headOn) { push(head, gapOf(head)); headOn = true; push(i, units[head].below ?? gapOf(i)); } else push(i, gapOf(i));
    }
    if (cur.length) pages.push(cur);
    return pages.length ? pages : [[]];
  };
  const one = run(full);
  return one.length > 1 ? run(paged) : one;
}

// ---- Markup ----
const pillBody = (coin, n) => `${coin}<b>${fmt(n)}</b>`;
function item(s, coin, featured = false) {
  const c = s.card;
  const isNew = !s.bought && !s.owned;
  return `<li class="u3-shopitem u3-r-${esc(s.rarity)}${featured ? ' u3-shopitem--feat' : ''}${s.bought ? ' is-bought' : ''}">`
    + `<button type="button" class="u3-shopitem__card" data-view="${s.slot}" aria-label="See ${esc(c.name)}">`
    + `${c.image_url ? `<img src="${esc(thumb(c.image_url))}" alt="" draggable="false">` : ''}</button>`
    + `${isNew ? '<span class="u3-chip u3-chip--sm u3-chip--new u3-shopitem__new"><span aria-hidden="true">✦</span><span>New</span></span>' : ''}`
    + `<button type="button" class="u3-shopitem__buy" data-buy="${s.slot}"${s.bought ? ' disabled' : ''} aria-label="${s.bought ? `${esc(c.name)}: Bought` : `Buy ${esc(c.name)} for ${fmt(s.price)} Shards`}">`
    + `${s.bought ? `${icon('check', { size: 'sm' })}<b>Bought</b>` : pillBody(coin, s.price)}</button></li>`;
}
const groupHead = (key, label, each, coin) => `<div class="u3-sgroup__label u3-sgroup__label--${key}">`
  + `${key === 'feat' ? icon('star', { size: 'sm' }) : '<span aria-hidden="true">◆</span>'}<span class="u3-sgroup__name">${esc(label)}</span>`
  + `${each != null ? `<span class="u3-sgroup__each">${coin}${fmt(each)} each</span>` : ''}</div>`;
const group = (key, head, items, name = '') => `<div class="u3-sgroup u3-sgroup--${key}">${head}<ul class="u3-sgroup__items"${name ? ` aria-label="${esc(name)}"` : ''}>${items}</ul></div>`;

/** The stock blocks in order: [{ key, head, items: [html] }] (Featured, Illustrated Rare, Normal). */
export function stockBlocks(d, coin, rarityLabel) {
  const by = (r) => (d.stock || []).filter((s) => s.rarity === r && s.card);
  const sr = by('secret_rare')[0];
  const ir = by('illustrated_rare');
  const nm = by('normal');
  const out = [];
  if (sr) out.push({ key: 'feat', name: 'Featured', head: groupHead('feat', 'Featured', null, coin), items: [item(sr, coin, true)] });
  if (ir.length) out.push({ key: 'ir', name: rarityLabel('illustrated_rare'), head: groupHead('ir', rarityLabel('illustrated_rare'), ir[0].price, coin), items: ir.map((s) => item(s, coin)) });
  if (nm.length) out.push({ key: 'nm', name: rarityLabel('normal'), head: groupHead('nm', rarityLabel('normal'), nm[0].price, coin), items: nm.map((s) => item(s, coin)) });
  return out;
}

export function stockHead({ count, left, title }) {
  return `<header class="u3-shop__head">${title ? `<div class="u3-shop__titles"><h2 class="u3-shop__title">${icon('store', { size: 'lg' })}<span>Today's stock</span></h2>`
    + `<span class="u3-shop__count">${count} cards</span></div>` : `<span class="u3-shop__count">${count} cards</span>`}`
    + `<span class="u3-shop__timer">${icon('timer')}<span>New stock in</span><b class="sh-left">${esc(left)}</b></span></header>`;
}

export function packsPanel(d, qty, coin) {
  const max = d.max_packs_per_buy || 10;
  const step = (dir, ic, lbl, off) => `<button type="button" class="u3-step__btn" data-q="${dir}" aria-label="${lbl}"${off ? ' disabled' : ''}>${icon(ic, { size: 'lg' })}</button>`;
  return `<section class="u3-spanel u3-spanel--packs"><header class="u3-spanel__head"><span class="u3-spanel__ico">${icon('package', { size: 'lg' })}</span>`
    + `<h3 class="u3-spanel__title">Packs</h3><span class="u3-spanel__price">${coin}<b>${fmt(d.pack_price)}</b><i>each</i></span></header>`
    + `<div class="u3-spanel__body"><div class="u3-spack"><span class="u3-spack__art">${icon('crown', { size: '2xl' })}<i>LION PRIDE</i></span><b>Lion Pride pack</b></div>`
    + `<div class="u3-spanel__ctl"><div class="u3-sqty"><span class="u3-sqty__label">Quantity</span><div class="u3-step"><div class="u3-step__ctl">${step(-1, 'minus', 'Decrease', qty <= 1)}`
    + `<span class="u3-step__value" aria-live="polite">${qty}</span>${step(1, 'plus', 'Increase', qty >= max)}</div><span class="u3-step__limits">1 to ${max}</span></div></div>`
    + `<div class="u3-stotal"><span>Total</span><span class="u3-stotal__v">${coin}<b>${fmt(d.pack_price * qty)}</b></span></div>`
    + `${button({ label: `Buy ${qty} pack${qty === 1 ? '' : 's'}`, variant: 'primary', icon: 'package', data: { buypacks: '' } })}</div></div></section>`;
}

export function resetPanel(d, coin, day) {
  return `<section class="u3-spanel u3-spanel--reset"><header class="u3-spanel__head"><span class="u3-spanel__ico">${icon('rotate-ccw', { size: 'lg' })}</span>`
    + `<h3 class="u3-spanel__title">Stat reset</h3><span class="u3-spanel__price">${coin}<b>${fmt(d.stat_reset_price)}</b></span></header>`
    + `<div class="u3-sfree${d.free_reset ? ' is-ok' : ''}">${icon('calendar-check')}<b>Free weekly reset</b><span>${d.free_reset ? 'Available' : `Used · back ${esc(day)}`}</span></div>`
    + `<button type="button" class="u3-btn u3-btn--secondary u3-btn--md u3-schoose" data-choose><span class="u3-btn__label">Choose a card</span>${icon('arrow-right')}</button></section>`;
}

/** The Shop view. s = { d, tab, qty, size, left, coin, rarityLabel, day }. The stock area is fitted after paint (fitStock). */
export function shopHTML(s) {
  const { d, size } = s;
  const tabs = size !== 'expanded';
  const n = (d.stock || []).length;
  const tab = tabs ? s.tab : 'stock';
  const sub = tabs ? `<div class="v2-subtabs u3-shop-tabs" role="tablist"><div class="seg">${[['stock', 'store', "Today's stock"], ['packs', 'package', 'Packs'], ['reset', 'rotate-ccw', 'Stat reset']]
    .map(([k, ic, t]) => `<button type="button" role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" aria-controls="u3ShopP-${k}">${icon(ic)}<span>${t}</span></button>`).join('')}</div></div>` : '';
  const stock = `<section class="u3-shop__stock">${stockHead({ count: n, left: s.left, title: size === 'expanded' })}<div class="u3-shop__body"></div><div class="u3-shop__pager" hidden></div></section>`;
  if (!tabs) return `<div class="u3-shop u3-shop--desk">${stock}<div class="u3-shop__side">${packsPanel(d, s.qty, s.coin)}${resetPanel(d, s.coin, s.day)}</div></div>`;
  // every tab panel is in the page (the hidden ones with role=tabpanel): the one fitter paints only the stock that shows
  const panel = (k, html) => `<div class="u3-shop__panel${k === 'stock' ? '' : ' u3-shop__one'}" role="tabpanel" id="u3ShopP-${k}"${tab === k ? '' : ' hidden'}>${k === 'stock' && tab !== 'stock' ? '' : html}</div>`;
  return `${sub}<div class="u3-shop u3-shop--${tab}">${panel('stock', stock)}${panel('packs', packsPanel(d, s.qty, s.coin))}${panel('reset', resetPanel(d, s.coin, s.day))}</div>`;
}

const px = (v) => parseFloat(v) || 0;
/** Fit and paint the stock area of a painted Shop. page = the compact-port page (1-based). Returns { pages, page }. */
export function fitStock(root, blocks, { page = 1, size }) {
  const body = root.querySelector('.u3-shop__body');
  const pg = root.querySelector('.u3-shop__pager');
  if (!body) return { pages: 1, page: 1 };
  const all = (list) => list.map((b) => group(b.key, b.head, b.items.join(''), b.name)).join('');
  // pass 1: measure the parts at the default width
  body.innerHTML = all(blocks);
  pg.innerHTML = pager({ page: 1, pages: 2 });
  pg.hidden = false;
  const Hp = body.clientHeight;
  pg.hidden = true;
  const H = body.clientHeight;
  const W = body.clientWidth;
  const cs = getComputedStyle(body);
  const labelH = body.querySelector('.u3-sgroup__label')?.getBoundingClientRect().height || 0;
  const labelW = [...body.querySelectorAll('.u3-sgroup__label')].map((n) => n.scrollWidth);
  const pillH = body.querySelector('.u3-shopitem__buy')?.getBoundingClientRect().height || 0;
  // the narrowest card whose price pill still shows its whole price (coin, number, the pill padding)
  const pillMinOf = () => Math.max(0, ...[...body.querySelectorAll('.u3-shopitem__buy')].map((b) => {
    const c = getComputedStyle(b);
    const kids = [...b.children].filter((k) => getComputedStyle(k).display !== 'none');
    return kids.reduce((t, k) => t + k.getBoundingClientRect().width, 0) + px(c.columnGap) * Math.max(0, kids.length - 1)
      + px(c.paddingLeft) + px(c.paddingRight) + px(c.borderLeftWidth) + px(c.borderRightWidth);
  }));
  const pillMin = pillMinOf();
  const m = { W, H, gap: px(cs.getPropertyValue('--u3-sg')), G: px(cs.getPropertyValue('--u3-sG')), si: px(cs.getPropertyValue('--u3-si')), labelH, pillH,
    labelW, f: blocks.some((b) => b.key === 'feat') ? 1 : 0, ir: blocks.find((b) => b.key === 'ir')?.items.length || 0, nm: blocks.find((b) => b.key === 'nm')?.items.length || 0 };
  const layout = shopLayout(size, innerWidth, innerHeight);   // the frame shape: an upright tablet stacks (D-46)
  root.querySelector('.u3-shop__stock')?.setAttribute('data-layout', layout);
  const setW = (w, fw) => { body.style.setProperty('--u3-w', `${w}px`); body.style.setProperty('--u3-fw', `${fw}px`); };
  if (layout !== 'port') {
    const { w, fw } = fitShop(layout, m);
    if (layout !== 'row' || w >= pillMin) { setW(w, fw); return { pages: 1, page: 1 }; }
    // a narrow row: first the price number without its coin (is-tight); on a short landscape phone also the group labels
    // only for screen readers (is-tight2: the frame color shows the rarity, the price is on every card), so every card
    // shows its whole price and stays a touch target (9.1)
    const stock = root.querySelector('.u3-shop__stock');
    stock.classList.add('is-tight');
    const t1 = fitShop('row', { ...m, labelW: [...body.querySelectorAll('.u3-sgroup__label')].map((n) => n.scrollWidth) });
    if (t1.w >= Math.max(pillMinOf(), TOKENS.hit)) { setW(t1.w, t1.fw); return { pages: 1, page: 1 }; }
    stock.classList.add('is-tight2');
    const tcs = getComputedStyle(body);
    const tight = fitShop('row', { ...m, G: px(tcs.getPropertyValue('--u3-sG')), si: px(tcs.getPropertyValue('--u3-si')), labelH: 0, labelW: [] });
    const paged = blocks.length > 1 ? fitShop('row', { ...m, H: Hp, f: 1, ir: Math.max(m.ir, m.nm), nm: 0, labelW: [] }) : { w: 0 };
    if (tight.w >= TOKENS.hit || paged.w < tight.w) { setW(tight.w, tight.fw); return { pages: 1, page: 1 }; }
    stock.classList.remove('is-tight', 'is-tight2');
    // a short landscape phone: one row of every card would cut the prices, so the groups page (3.4: Featured and
    // Illustrated Rare, then Normal), every page at the same card width
    const split = [blocks.filter((b) => b.key !== 'nm'), blocks.filter((b) => b.key === 'nm')].filter((x) => x.length);
    const sub = (list) => fitShop('row', { ...m, H: Hp, labelW: list.map((b) => labelW[blocks.indexOf(b)]),
      f: list.some((b) => b.key === 'feat') ? 1 : 0, ir: list.find((b) => b.key === 'ir')?.items.length || 0, nm: list.find((b) => b.key === 'nm')?.items.length || 0 });
    const ws = split.map(sub);
    const w2 = Math.min(...ws.map((x) => x.w));
    setW(w2, w2);
    const p = Math.min(Math.max(1, page), split.length);
    body.innerHTML = all(split[p - 1]);
    pg.innerHTML = pager({ page: p, pages: split.length });
    pg.hidden = false;
    return { pages: split.length, page: p };
  }
  // compact-port: blocks of 3 cards, the pages by height (3.4); a group that goes on shows its label again
  const { w, fw } = fitShop('port', { ...m, H: Hp });
  setW(w, fw);
  // the space above each unit: a group label G, its first row si, a next row of the same group gap (the port CSS)
  const units = [];
  for (const b of blocks) {
    units.push({ head: true, html: b.head, key: b.key, gap: m.G, below: m.si });
    for (let i = 0; i < b.items.length; i += 3) units.push({ section: b.key, key: b.key, gap: i ? m.gap : m.si, html: b.items.slice(i, i + 3).join('') });
  }
  body.innerHTML = units.map((u) => (u.head ? `<div class="u3-sgroup__label-wrap">${u.html}</div>` : `<ul class="u3-sgroup__items u3-sgroup__items--${u.key}">${u.html}</ul>`)).join('');
  [...body.children].forEach((el, i) => { units[i].h = el.getBoundingClientRect().height; });
  const pages = pageBlocks(units, { full: H, paged: Hp });
  const p = Math.min(Math.max(1, page), pages.length);
  // a page that holds only Featured: the card grows to fill it (3.4: content fills its area; UI-43 approved 375x667)
  if (pages[p - 1].every((i) => units[i].key === 'feat')) {
    const big = Math.min(W * 0.75, (pages.length > 1 ? Hp : H) - (labelH + 2 * m.si + pillH)) ;
    setW(w, Math.max(fw, Math.floor(Math.min(W * 0.75, big / (TOKENS['card-ratio'])))));
  }
  body.innerHTML = pages[p - 1].map((i) => (units[i].head ? `<div class="u3-sgroup__label-wrap">${units[i].html}</div>` : `<ul class="u3-sgroup__items u3-sgroup__items--${units[i].key}">${units[i].html}</ul>`)).join('');
  pg.innerHTML = pages.length > 1 ? pager({ page: p, pages: pages.length }) : '';
  pg.hidden = pages.length <= 1;
  return { pages: pages.length, page: p };
}

// ---- The confirm window (5.2 Dialog: Cancel left, the action right; one primary) ----
/**
 * c = { kind, art (html), eyebrow, title, sub (html), table (html or ''), rows: { now, price, priceLabel, after, freeText },
 *   msg, short, busy, go: { label, icon, reward, variant } }
 */
export function confirmHTML(c, coin) {
  const after = c.rows.after;
  const price = c.rows.freeText ? `<b class="u3-sbal__free">${icon('calendar-check', { size: 'sm' })}${esc(c.rows.freeText)}</b>`
    : `<span class="u3-sbal__v">${coin}<b>- ${fmt(c.rows.price)}</b></span>`;
  const msgs = [c.msg ? inlineMessage({ kind: 'error', text: c.msg }) : c.short ? inlineMessage({ kind: 'error', text: 'You do not have enough Shards.' }) : ''].join('');
  const go = button({ label: c.go.label, variant: c.go.variant || 'primary', icon: c.go.icon || null, reward: c.go.reward ?? null, disabled: c.short, busy: c.busy, busyLabel: c.kind === 'reset' ? 'Resetting' : 'Buying', data: { go: '' } });
  return `<div class="u3-scrim u3-sdlg-scrim" data-u3-scrim><div class="u3-dialog u3-sdlg u3-sdlg--${c.kind}" role="dialog" aria-modal="true" aria-labelledby="u3SdlgT">`
    + `<div class="u3-sdlg__art">${c.art}</div><div class="u3-sdlg__main"><header class="u3-sdlg__head"><div><span class="u3-label u3-sdlg__eyebrow">${esc(c.eyebrow)}</span>`
    + `<h2 class="u3-dialog__title" id="u3SdlgT">${esc(c.title)}</h2><div class="u3-sdlg__sub">${c.sub}</div></div>`
    + `<span data-x>${iconButton({ icon: 'x', label: 'Close' })}</span></header>${c.table || ''}`
    + `<div class="u3-sbal"><div><span>Balance now</span><span class="u3-sbal__v">${coin}<b>${fmt(c.rows.now)}</b></span></div>`
    + `<div><span>${esc(c.rows.priceLabel)}</span>${price}</div>`
    + `<div class="u3-sbal__after"><span>${c.rows.price ? 'Balance after' : 'Balance after · no change'}</span><span class="u3-sbal__v${after < 0 ? ' is-neg' : ''}">${coin}<b>${fmt(after)}</b></span></div></div>`
    + `<div class="u3-sdlg__msgs">${msgs}</div>`
    + `<footer class="u3-dialog__foot">${button({ label: 'Cancel', variant: 'secondary', data: { cancel: '' } })}${go}</footer></div></div></div>`;
}

export { rewardPill };
