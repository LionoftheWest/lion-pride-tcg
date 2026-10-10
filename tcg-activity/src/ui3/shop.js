// UI-43 the Shop (lion-pride-tcg-design UI-43/approved, review-1; D-41, D-80 item 23). Only under body.ui-v3
// (settings.ui_v3): ui-v2-shop.js paints this layout when the flag is on and keeps the v2 Shop when it is off. The
// data, the prices, the buy calls and the windows' logic stay in ui-v2-shop.js (one logic); this module is the layout:
// - Today's stock, Packs and Stat reset are sub-tabs in the row under the top bar on compact and medium (D-37, D-27);
//   expanded keeps Packs and Stat reset as a right column with no tab row (D-41).
// - Every stock card is one ShopItem: the card face, then the price pill, which is the Buy button (D-80 23). Featured is
//   the same item, larger. "New" stays on the card; no owned badge (D-29).
// - "New stock in" is a chip in the stock header on every class.
// - The card width is the one number this module computes (3.5): the largest that fits the stock area for the layout
//   of the class (wide: medium landscape and expanded; tall: medium portrait). Both compact classes (compact: portrait and
//   landscape phones) show the whole stock with NO pager (Nathan 2026-10-08): the fitter measures three arrangements, one
//   row of 10 (row), Featured + Illustrated Rare over the 6 Normal in one row (stack, 6 columns) or over 2 rows of 3
//   (stack, 3 columns), and takes the one with the largest card.
import { esc, button, iconButton, inlineMessage, rewardPill } from './components.js';
import { icon } from './icons.js';
import { TOKENS } from '../tokens.js';
import { thumb } from '../thumb.js';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/** The layout for a size class and the stock area (D-41, D-46: a tall area stacks rows, a wide area keeps columns). */
export function shopLayout(size, width, height) {
  if (size === 'compact-port' || size === 'compact-land') return 'compact';
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
  } else {   // stack (compact): Featured + Illustrated Rare over the Normal rows; m.cols = the Normal cards in one row
    return fitStack(m);
  }
  return { w: Math.max(0, Math.floor(w)), fw: Math.max(0, Math.floor(fw)) };
}

/**
 * The stack arrangement of the compact classes (no pager): row 1 = Featured (fw = 1.15 cards, the UI-43 approved 430x932
 * ratio) beside the Illustrated Rare cards, row 2 = the Normal cards in rows of m.cols. The largest card width whose
 * width (labels included) and height (labels, pills, gaps) both fit. Returns { w, fw } (floored).
 */
export const STACK_FEAT = 1.15;
export function fitStack(m) {
  const { W, H, gap: g, G, labelH, si, pillH, f = 1, ir = 3, nm = 6, cols = 6, ratio = TOKENS['card-ratio'], max = TOKENS['card-tile-max'] } = m;
  const lw = m.labelW || [];
  const rows = Math.max(1, Math.ceil(nm / Math.max(1, cols)));
  const ok = (w) => {
    const fw = f ? w * STACK_FEAT : 0;
    const top = [f ? Math.max(lw[0] || 0, fw) : 0, ir ? Math.max(lw[ir && f ? 1 : 0] || 0, ir * w + (ir - 1) * g) : 0].filter(Boolean);
    const w1 = top.reduce((t, x) => t + x, 0) + Math.max(0, top.length - 1) * G;
    const w2 = nm ? Math.max(lw[lw.length - 1] || 0, Math.min(cols, nm) * w + (Math.min(cols, nm) - 1) * g) : 0;
    const h1 = top.length ? labelH + si + Math.max(fw, ir ? w : 0) * ratio + si + pillH : 0;
    const h2 = nm ? labelH + si + rows * (w * ratio + si + pillH) + (rows - 1) * g : 0;
    return Math.max(w1, w2) <= W && h1 + h2 + (h1 && h2 ? G : 0) <= H;
  };
  let lo = 0; let hi = max;
  if (ok(hi)) lo = hi; else for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return { w: Math.max(0, Math.floor(lo)), fw: f ? Math.floor(lo * STACK_FEAT) : 0 };
}

// ---- Markup ----
const pillBody = (coin, n) => `${coin}<b>${fmt(n)}</b>`;
function item(s, coin, featured = false) {
  const c = s.card;
  const isNew = !s.bought && !s.owned;
  return `<li class="u3-shopitem u3-r-${esc(s.rarity)}${featured ? ' u3-shopitem--feat' : ''}${s.bought ? ' is-bought' : ''}">`
    + `<button type="button" class="u3-shopitem__card" data-view="${s.slot}" aria-label="See ${esc(c.name)}">`
    + `${c.image_url ? `<img src="${esc(thumb(c.image_url))}" alt="" draggable="false">` : ''}</button>`
    + `${isNew ? '<span class="u3-chip u3-chip--sm u3-chip--new u3-shopitem__new" role="img" aria-label="New"><span aria-hidden="true">✦</span><span class="u3-shopitem__newtxt" aria-hidden="true">New</span></span>' : ''}`
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
    .map(([k, ic, t]) => `<button type="button" role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" aria-controls="u3ShopP-${k}" aria-label="${t}">${icon(ic)}<span class="u3-tab__label">${t}</span></button>`).join('')}</div></div>` : '';
  const stock = `<section class="u3-shop__stock">${stockHead({ count: n, left: s.left, title: size === 'expanded' })}<div class="u3-shop__body"></div></section>`;
  if (!tabs) return `<div class="u3-shop u3-shop--desk">${stock}<div class="u3-shop__side">${packsPanel(d, s.qty, s.coin)}${resetPanel(d, s.coin, s.day)}</div></div>`;
  // every tab panel is in the page (the hidden ones with role=tabpanel): the one fitter paints only the stock that shows
  const panel = (k, html) => `<div class="u3-shop__panel${k === 'stock' ? '' : ' u3-shop__one'}" role="tabpanel" id="u3ShopP-${k}"${tab === k ? '' : ' hidden'}>${k === 'stock' && tab !== 'stock' ? '' : html}</div>`;
  return `${sub}<div class="u3-shop u3-shop--${tab}">${panel('stock', stock)}${panel('packs', packsPanel(d, s.qty, s.coin))}${panel('reset', resetPanel(d, s.coin, s.day))}</div>`;
}

const px = (v) => parseFloat(v) || 0;
/**
 * Fit and paint the stock area of a painted Shop. The whole stock always shows: there is no pager and no hidden card.
 * Compact classes: the arrangement with the largest card (row, stack of 6, stack of 3), then the measured modes
 * is-tight (no coin in the price pill) and is-tight2 (the group labels only for screen readers) when the card is too
 * narrow for its price (9.1: a touch target of 44 px). Returns { pages: 1, page: 1, mode }.
 */
export function fitStock(root, blocks, { size }) {
  const body = root.querySelector('.u3-shop__body');
  const done = (mode = '') => ({ pages: 1, page: 1, mode });
  if (!body) return done();
  const stock = root.querySelector('.u3-shop__stock');
  stock.classList.remove('is-tight', 'is-tight2');
  body.innerHTML = blocks.map((b) => group(b.key, b.head, b.items.join(''), b.name)).join('');
  const layout = shopLayout(size, root.clientWidth, root.clientHeight);   // the shape of the Shop area: an upright tablet stacks (D-46)
  const setW = (w, fw) => { body.style.setProperty('--u3-w', `${w}px`); body.style.setProperty('--u3-fw', `${fw}px`); };
  const measure = () => {
    const cs = getComputedStyle(body);
    const labels = [...body.querySelectorAll('.u3-sgroup__label')];
    return { W: body.clientWidth, H: body.clientHeight, gap: px(cs.getPropertyValue('--u3-sg')), G: px(cs.getPropertyValue('--u3-sG')), si: px(cs.getPropertyValue('--u3-si')),
      labelH: labels[0]?.getBoundingClientRect().height || 0, labelW: labels.map((n) => n.scrollWidth),
      pillH: body.querySelector('.u3-shopitem__buy')?.getBoundingClientRect().height || 0,
      f: blocks.some((b) => b.key === 'feat') ? 1 : 0, ir: blocks.find((b) => b.key === 'ir')?.items.length || 0, nm: blocks.find((b) => b.key === 'nm')?.items.length || 0 };
  };
  // the narrowest card whose price pill still shows its whole price (coin, number, the pill padding)
  const pillMinOf = () => Math.max(0, ...[...body.querySelectorAll('.u3-shopitem__buy')].map((b) => {
    const c = getComputedStyle(b);
    const kids = [...b.children].filter((k) => getComputedStyle(k).display !== 'none');
    return kids.reduce((t, k) => t + k.getBoundingClientRect().width, 0) + px(c.columnGap) * Math.max(0, kids.length - 1)
      + px(c.paddingLeft) + px(c.paddingRight) + px(c.borderLeftWidth) + px(c.borderRightWidth);
  }));
  if (layout !== 'compact') {
    const m = measure();
    stock.setAttribute('data-layout', layout);
    const { w, fw } = fitShop(layout, m);
    setW(w, fw);
    return done(layout);
  }
  const pick = (m) => {
    const cands = [['row', fitShop('row', m)], ['stack6', fitStack({ ...m, cols: 6 })], ['stack3', fitStack({ ...m, cols: 3 })]];
    cands.forEach((c) => { c.w = c[1].w; });
    return cands.reduce((best, c) => (c[1].w > best[1].w ? c : best));   // a tie keeps the earlier one (row first)
  };
  const apply = (c) => {
    const mode = c[0];
    stock.setAttribute('data-layout', mode === 'row' ? 'row' : 'stack');
    body.style.setProperty('--u3-nmcols', mode === 'stack3' ? '3' : '6');
    setW(c[1].w, mode === 'row' ? c[1].w : c[1].fw);
  };
  let m = measure();
  let c = pick(m);
  apply(c);
  const pillMin = () => pillMinOf();
  if (c[1].w < pillMin()) {
    stock.classList.add('is-tight');
    m = measure(); c = pick(m); apply(c);
    if (c[1].w < Math.max(pillMin(), TOKENS.hit)) {
      stock.classList.add('is-tight2');
      m = { ...measure(), labelH: 0, labelW: [] }; c = pick(m); apply(c);
    }
  }
  return done(c[0]);
}

// ---- The confirm window (5.2 Dialog: Cancel left, the action right; one primary) ----
/**
 * c = { kind, art (html), eyebrow, title, sub (html), table (html or ''), rows: { now, price, priceLabel, after, freeText },
 *   msg, short, busy, go: { label, icon, reward, variant } }
 */
export function confirmHTML(c, coin) {
  const after = c.rows.after;
  const price = c.rows.freeText ? `<b class="u3-sbal__free">${icon('calendar-check', { size: 'sm' })}${esc(c.rows.freeText)}</b>`
    : `<span class="u3-sbal__v">${coin}<b>${c.rows.sign || '-'} ${fmt(c.rows.price)}</b></span>`;
  const msgs = [c.note ? inlineMessage({ kind: 'info', text: c.note }) : '', c.msg ? inlineMessage({ kind: 'error', text: c.msg }) : c.short ? inlineMessage({ kind: 'error', text: 'You do not have enough Shards.' }) : ''].join('');
  const go = button({ label: c.go.label, variant: c.go.variant || 'primary', icon: c.go.icon || null, reward: c.go.reward ?? null, disabled: c.short, busy: c.busy, busyLabel: c.go.busyLabel || (c.kind === 'reset' ? 'Resetting' : 'Buying'), data: { go: '' } });
  return `<div class="u3-scrim u3-sdlg-scrim" data-u3-scrim><div class="u3-dialog u3-sdlg u3-sdlg--${c.kind}" role="dialog" aria-modal="true" aria-labelledby="u3SdlgT">`
    + `<div class="u3-sdlg__art">${c.art}</div><div class="u3-sdlg__main"><header class="u3-sdlg__head"><div><span class="u3-label u3-sdlg__eyebrow">${esc(c.eyebrow)}</span>`
    + `<h2 class="u3-dialog__title" id="u3SdlgT">${esc(c.title)}</h2><div class="u3-sdlg__sub">${c.sub}</div></div>`
    + `<span data-x>${iconButton({ icon: 'x', label: 'Close' })}</span></header>${c.table || ''}${c.control || ''}`
    + `<div class="u3-sbal"><div><span>Balance now</span><span class="u3-sbal__v">${coin}<b>${fmt(c.rows.now)}</b></span></div>`
    + `<div><span>${esc(c.rows.priceLabel)}</span>${price}</div>`
    + `<div class="u3-sbal__after"><span>${c.rows.price ? 'Balance after' : 'Balance after · no change'}</span><span class="u3-sbal__v${after < 0 ? ' is-neg' : ''}">${coin}<b>${fmt(after)}</b></span></div></div>`
    + `<div class="u3-sdlg__msgs">${msgs}</div>`
    + `<footer class="u3-dialog__foot">${button({ label: 'Cancel', variant: 'secondary', data: { cancel: '' } })}${go}</footer></div></div></div>`;
}

export { rewardPill };
