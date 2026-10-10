// The Shop (design 29, approved by Nathan 2026-10-02: desktop, portrait and landscape, review 3).
// The top bar shows the Shard balance (the lime coin) and the Shop button. The Shop view sells
// today's random card stock (the same for everyone, new at midnight MT), packs (1 to 10 at a time,
// no daily limit) and a stat reset (the free weekly reset first, then 150 Shards).
// Every rule and price lives in SQL (tcg-bot/supabase/shards_shop.sql); the data comes from
// src/shop-routes.js. The flag: /api/flags -> shards (SHARDS_USERS / FEATURE_SHARDS).
import { v2ctx, toast, paintCards } from './ui-v2.js';
import { thumb } from './thumb.js';
import { isPort, isLand } from './mobile.js';
import { every } from './poll.js';
import { fmtFor } from './ui3/number.js';
import { shopHTML, stockBlocks, fitStock, confirmHTML } from './ui3/shop.js';
import { openCardPicker } from './ui3/card-picker.js';

const ctx = () => v2ctx();
const esc = (s) => ctx().esc(s ?? '');
const fmt = (n) => Number(n || 0).toLocaleString();
const RL = (r) => ctx().RARITY_LABEL?.[r] || String(r || '').replace(/_/g, ' ');
const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

// The Shards coin (design 29, option D "Lime Token"): a hexagon coin with a shard cut into its face.
export const COIN = '<svg class="sh-coin" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,1.5 21.6,7 21.6,17 12,22.5 2.4,17 2.4,7" fill="#7FAE12"/><polygon points="12,3.7 19.7,8.1 19.7,15.9 12,20.3 4.3,15.9 4.3,8.1" fill="#B8F02A"/><path d="M12 6.4 14.7 11.3 12 17.6 9.3 11.3Z" fill="#26350A"/><path d="M12 6.4 14.7 11.3 12 12.5Z" fill="#F1FFC9"/></svg>';
const ICON = {
  store: svg('<path d="M3 9.5 4.6 4h14.8L21 9.5"/><path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M5 12.4V20h14v-7.6"/><path d="M10 20v-4.5h4V20"/>'),
  pack: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  timer: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>', 2.4),
  cal: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  crown: svg('<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/>', 1.8),
};
const STAT_NAME = { attack: 'Attack', vitality: 'Vitality', precision: 'Precision', potency: 'Potency', haste: 'Haste' };
const STAT_SHORT = { attack: 'ATK', vitality: 'VIT', precision: 'PRE', potency: 'POT', haste: 'HST' };

export const shop = { on: false, data: null, qty: 1, tab: 'stock', modal: null, busy: false, msg: '', pick: { page: 0 }, page: 1 };
const isV3 = () => document.body.classList.contains('ui-v3');
let tick = null;

// ---- The top bar ------------------------------------------------------------------------------
function paintTop() {
  const { el } = ctx();
  const pill = el('v2Shards'), btn = el('shopBtn');
  if (!pill || !btn) return;
  pill.classList.toggle('hidden', !shop.on);
  btn.classList.toggle('hidden', !shop.on);
  if (!shop.on) return;
  // v3: the compact form on the compact classes (design.md 10.5); the full number stays in the button name
  const bal = shop.data?.balance, b = document.body;
  pill.innerHTML = `${COIN}<b>${b.classList.contains('ui-v3') ? fmtFor(bal, b.dataset.size) : fmt(bal)}</b><span class="lbl">Shards</span>`;
  pill.setAttribute('aria-label', `${fmt(bal)} Shards`);
  btn.classList.toggle('on', ctx().currentView() === 'shop');
}

async function load() {
  let d = null;
  try { d = await ctx().api('/api/shop'); } catch { d = null; }
  shop.data = d && d.ok ? d : (d?.error ? { closed: true, message: d.message } : shop.data);
  paintTop();
  return shop.data;
}

/** The size class changed (v3): paint the pill again in its number form. */
export const repaintShards = () => { if (shop.on) paintTop(); };

// The balance changed elsewhere (a gift, a daily): repaint the top bar pill.
export const refreshShards = () => (shop.on ? load() : Promise.resolve(null));

export function initShop(on) {
  shop.on = !!on;
  const { el } = ctx();
  const btn = el('shopBtn');
  if (btn) {
    btn.innerHTML = `${ICON.store}<span class="lbl">Shop</span>`;
    btn.addEventListener('click', () => { ctx().sfx?.('click'); ctx().show('shop'); });
  }
  el('v2Shards')?.addEventListener('click', () => ctx().show('shop'));
  paintTop();
  if (!shop.on) return;
  load();
  every(60000, load); // paused while hidden, slower when idle (poll.js)
}

// ---- The view ---------------------------------------------------------------------------------
export async function renderShopV2() {
  const { el } = ctx();
  paintTop();
  if (!shop.on) { el('main').innerHTML = '<div class="sh-closed"><b>The Shop is closed.</b></div>'; return; }
  if (shop.data && !shop.data.closed) paint();
  else el('main').innerHTML = '<div class="loading">Loading…</div>';
  if (!ctx().cache.collection) Promise.resolve(ctx().refreshOwned?.()).catch(() => {});
  const before = JSON.stringify(shop.data);
  await load();
  if (ctx().currentView() !== 'shop') return;
  if (JSON.stringify(shop.data) !== before || !el('main').querySelector('.v2-shop')) paint();
}
export function disposeShop() { clearInterval(tick); tick = null; }

function left(iso) {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
function startTick() {
  clearInterval(tick);
  tick = setInterval(() => {
    if (ctx().currentView() !== 'shop') { disposeShop(); return; }
    const d = shop.data;
    if (!d?.next_at) return;
    if (new Date(d.next_at).getTime() <= Date.now()) { load().then(() => { if (ctx().currentView() === 'shop') paint(); }); return; }
    document.querySelectorAll('.sh-left').forEach((n) => { n.textContent = left(d.next_at); });
  }, 1000);
}

const price = (n, cls = '') => `<span class="sh-price ${cls}">${COIN}<b>${fmt(n)}</b></span>`;
// compact: the short form on a card (landscape): "×3" / "New".
const ownChip = (s, compact) => (s.bought ? '' : s.owned ? `<span class="sh-chip">${compact ? `×${s.owned}` : `Owned ${s.owned}`}</span>` : `<span class="sh-chip new">${compact ? 'New' : '✦ New'}</span>`);
const cardImg = (c, cls = '', slot = null, extra = '') => `<div class="sh-card ${cls} r-${c?.rarity || 'normal'}"${slot != null ? ` data-view="${slot}" title="See the card"` : ''}>${c?.image_url ? `<img src="${thumb(c.image_url)}" data-full="${esc(c.image_url)}" alt="${esc(c.name)}">` : ''}${extra}</div>`;
const by = (r) => (shop.data?.stock || []).filter((s) => s.rarity === r && s.card);
const nextDay = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });

function stockHTML() {
  const d = shop.data;
  const sr = by('secret_rare')[0];
  const ir = by('illustrated_rare');
  const nm = by('normal');
  const featured = sr ? `<div class="sh-feat${sr.bought ? ' bought' : ''}">
      <span class="sh-kick">${ICON.star}Featured</span>
      ${cardImg(sr.card, 'big', sr.slot)}
      <div class="sh-feat-info"><b class="sh-feat-name">${esc(sr.card.name)}</b><span class="sh-rar" style="color:var(--r-secret_rare)">◆ ${esc(RL('secret_rare'))}</span></div>
      <div class="sh-feat-row">${price(sr.price, 'lg')}${ownChip(sr)}</div>
      <button class="v2-btn gold sh-buy" data-buy="${sr.slot}"${sr.bought ? ' disabled' : ''}>${sr.bought ? `${ICON.check}Bought today` : `${ICON.store}<span class="long">${sr.card.name.length <= 16 ? `Buy ${esc(sr.card.name)}` : 'Buy this card'}</span><span class="short">Buy</span>`}</button>
    </div>` : '';
  const irRow = ir.map((s) => `<div class="sh-ir${s.bought ? ' bought' : ''}">
      ${cardImg(s.card, '', s.slot, isLand() ? ownChip(s, true).replace('sh-chip', 'sh-chip on-card') : '')}${s.bought ? `<span class="sh-done">${ICON.check}Bought today</span>` : ''}
      <div class="sh-ir-side">${isLand() ? '' : ownChip(s)}<span class="grow"></span>${price(s.price)}<button class="v2-btn sh-mini" data-buy="${s.slot}"${s.bought ? ' disabled' : ''}>${s.bought ? 'Bought' : 'Buy'}</button></div>
    </div>`).join('');
  const phone = isLand() || isPort();
  // The IR side tiles (desktop, a wide landscape phone); else the Normal layout (card + buy pill).
  const irTiles = !isPort() && !(isLand() && document.body.classList.contains('m-narrow'));
  const nmRow = (list) => list.map((s) => `<div class="sh-nm${s.bought ? ' bought' : ''}">
      <span class="sh-nm-card">${cardImg(s.card, '', s.slot, (s.bought ? `<span class="sh-done">${ICON.check}${phone ? 'Bought' : 'Bought today'}</span>` : '') + (phone ? ownChip(s, true).replace('sh-chip', 'sh-chip on-card') : ''))}</span>
      <span class="sh-nm-foot"><button class="sh-pbuy" data-buy="${s.slot}"${s.bought ? ' disabled' : ''} title="Buy">${COIN}<b>${fmt(s.price)}</b></button>${phone ? '' : ownChip(s)}</span>
    </div>`).join('');
  // All the Normals in one row, no pages (Nathan, 2026-10-02: "all the normals ... in one view").
  const per = 6;
  const pages = Math.max(1, Math.ceil(nm.length / per));
  shop.nmPage = Math.min(shop.nmPage || 0, pages - 1);
  const nmShown = nm.slice(shop.nmPage * per, shop.nmPage * per + per);
  return `<section class="sh-stock">
      ${isPort() ? `<div class="sh-sub"><span>${ir.length + nm.length + (sr ? 1 : 0)} cards</span><span class="sh-timer">${ICON.timer}New stock in <b class="sh-left">${left(d.next_at)}</b></span></div>`
    : isLand() ? '' : `<div class="sh-head"><div><h2>${ICON.store}Today's stock</h2><span>${ir.length + nm.length + (sr ? 1 : 0)} cards</span></div><span class="sh-timer">${ICON.timer}New stock in <b class="sh-left">${left(d.next_at)}</b></span></div>`}
      <div class="sh-body">
        ${featured}
        <div class="sh-rows">
          <div class="sh-rowh" style="--rc:var(--r-illustrated_rare)">◆ ${esc(RL('illustrated_rare'))} <span>${COIN}${fmt(d.stock.find((s) => s.rarity === 'illustrated_rare')?.price)} each</span></div>
          <div class="sh-irs${irTiles ? '' : ' as-nm'}" style="--n:${isPort() ? (document.body.classList.contains('m-short') ? 6 : 4) : 3}">${irTiles ? irRow : nmRow(ir)}</div>
          <div class="sh-rowh" style="--rc:var(--r-normal)">◆ ${esc(RL('normal'))} <span>${COIN}${fmt(d.stock.find((s) => s.rarity === 'normal')?.price)} each</span></div>
          <div class="sh-nms" style="--n:${per}">${nmRow(nmShown)}</div>
          ${pages > 1 ? `<div class="v2-pager sh-pager"><button data-np="-1"${shop.nmPage ? '' : ' disabled'}>‹</button><span>${shop.nmPage + 1} / ${pages}</span><button data-np="1"${shop.nmPage >= pages - 1 ? ' disabled' : ''}>›</button></div>` : ''}
        </div>
      </div>
    </section>`;
}

function packsHTML() {
  const d = shop.data;
  const max = d.max_packs_per_buy || 10;
  shop.qty = Math.min(Math.max(1, shop.qty), max);
  return `<section class="sh-panel sh-packs">
      <div class="sh-ph"><span class="sh-ico">${ICON.pack}</span><b>Packs</b><span class="grow"></span>${price(d.pack_price, 'sm')}<i class="dim">each</i></div>
      <div class="sh-packrow"><span class="sh-packart">${ICON.crown}<i>LION PRIDE</i></span><div><b>Lion Pride pack</b></div></div>
      <div class="sh-qty"><div><b>Quantity</b><span>1 to ${max}</span></div><span class="grow"></span>
        <button class="sh-step" data-q="-1"${shop.qty <= 1 ? ' disabled' : ''}>−</button><b class="sh-qn">${shop.qty}</b><button class="sh-step" data-q="1"${shop.qty >= max ? ' disabled' : ''}>+</button></div>
      <div class="sh-total"><span>Total</span>${price(d.pack_price * shop.qty, 'lg')}</div>
      <button class="v2-btn gold sh-buypacks">${ICON.pack}Buy ${shop.qty} pack${shop.qty === 1 ? '' : 's'}</button>
    </section>`;
}

function resetHTML() {
  const d = shop.data;
  return `<section class="sh-panel sh-reset">
      <div class="sh-ph"><span class="sh-ico prank">${ICON.reset}</span><b>Stat reset</b><span class="grow"></span>${price(d.stat_reset_price, 'sm')}</div>
      <div class="sh-free${d.free_reset ? ' ok' : ''}">${ICON.cal}<b>Free weekly reset</b><span class="grow"></span><span>${d.free_reset ? 'Available' : `Used · back ${esc(nextDay(d.free_reset_next))}`}</span></div>
      <span class="grow"></span>
      <button class="v2-btn sh-choose">Choose a card ${ICON.arrow}</button>
    </section>`;
}

function paint() {
  if (isV3()) { paintV3(); return; }
  const { el } = ctx();
  const d = shop.data;
  if (!d || d.closed) { el('main').innerHTML = `<div class="sh-closed"><b>${esc(d?.message || 'The Shop is closed.')}</b></div>`; return; }
  let html;
  if (isPort()) {
    // Portrait (design 29, 07): three tabs, one section at a time.
    const tabs = `<div class="seg sh-tabs">${[['stock', ICON.store, "Today's stock"], ['packs', ICON.pack, 'Packs'], ['reset', ICON.reset, 'Stat reset']]
      .map(([k, i, t]) => `<button data-tab="${k}" class="${shop.tab === k ? 'on' : ''}">${i}${t}</button>`).join('')}</div>`;
    html = `<div class="v2-shop port">${tabs}${shop.tab === 'packs' ? packsHTML() : shop.tab === 'reset' ? resetHTML() : stockHTML()}</div>`;
  } else if (isLand()) {
    // Landscape (design 29, 13): a side panel with the sections and the countdown.
    const n = (d.stock || []).length;
    const side = `<aside class="sh-side"><nav class="sh-nav">
        <button data-tab="stock" class="${shop.tab === 'stock' ? 'on' : ''}">${ICON.store}<b>Today's stock</b><i>${n}</i></button>
        <button data-tab="packs" class="${shop.tab === 'packs' ? 'on' : ''}">${ICON.pack}<b>Packs</b>${price(d.pack_price, 'sm')}</button>
        <button data-tab="reset" class="${shop.tab === 'reset' ? 'on' : ''}">${ICON.reset}<b>Stat reset</b>${price(d.stat_reset_price, 'sm')}</button></nav>
      <div class="sh-cd"><span>${ICON.timer}New stock in</span><b class="sh-left">${left(d.next_at)}</b><i>${n} cards</i></div></aside>`;
    html = `<div class="v2-shop land">${side}${shop.tab === 'packs' ? packsHTML() : shop.tab === 'reset' ? resetHTML() : stockHTML()}</div>`;
  } else {
    html = `<div class="v2-shop desk">${stockHTML()}<div class="sh-right">${packsHTML()}${resetHTML()}</div></div>`;
  }
  el('main').innerHTML = html;
  wire();
  startTick();
}

// ---- The v3 Shop (UI-43, src/ui3/shop.js): the same data, prices and buy calls, the approved layout ----
let fitT = null;
function onShopResize() {
  clearTimeout(fitT);
  fitT = setTimeout(() => { if (ctx().currentView() === 'shop' && isV3()) paint(); else removeEventListener('resize', onShopResize); }, 120);
}
function paintV3() {
  const { el } = ctx();
  const d = shop.data;
  if (!d || d.closed) { el('main').innerHTML = `<div class="sh-closed"><b>${esc(d?.message || 'The Shop is closed.')}</b></div>`; return; }
  const size = document.body.dataset.size || 'expanded';
  shop.qty = Math.min(Math.max(1, shop.qty), d.max_packs_per_buy || 10);
  el('main').innerHTML = shopHTML({ d, tab: shop.tab, qty: shop.qty, size, left: left(d.next_at), coin: COIN, rarityLabel: RL, day: nextDay(d.free_reset_next) });
  const root = el('main').querySelector('.u3-shop');
  if (root?.querySelector('.u3-shop__stock')) {
    const r = fitStock(root, stockBlocks(d, COIN, RL), { size });
    shop.page = r.page; shop.pages = r.pages;
  }
  // the tab row and the Shop root (not #main: its click handler would outlive the view)
  wire([el('main').querySelector(':scope > .u3-shop-tabs'), root]);
  startTick();
  removeEventListener('resize', onShopResize);
  addEventListener('resize', onShopResize);
  // the fitter measured with the fallback font: measure again once the fonts are in (their sizes move the parts)
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (ctx().currentView() === 'shop' && isV3()) paint(); });
}

function wire(hosts) {
  const roots = (hosts || [ctx().el('main').querySelector('.v2-shop')]).filter(Boolean);
  if (!roots.length) return;
  const onclick = (e) => {
    const t = e.target;
    const tab = t.closest('[data-tab]');
    if (tab) { shop.tab = tab.dataset.tab; shop.page = 1; paint(); return; }
    const pg = t.closest('[data-page]');
    if (pg && !pg.disabled) { shop.page = Math.min(shop.pages || 1, Math.max(1, shop.page + (pg.dataset.page === 'next' ? 1 : -1))); paint(); return; }
    if (t.closest('[data-buypacks]')) { openConfirm({ kind: 'pack', qty: shop.qty }); return; }
    if (t.closest('[data-choose]')) { openPicker(); return; }
    const np = t.closest('[data-np]');
    if (np && !np.disabled) { shop.nmPage = (shop.nmPage || 0) + Number(np.dataset.np); paint(); return; }
    const q = t.closest('[data-q]');
    if (q && !q.disabled) { shop.qty += Number(q.dataset.q); paint(); return; }
    if (t.closest('.sh-buypacks')) { openConfirm({ kind: 'pack', qty: shop.qty }); return; }
    if (t.closest('.sh-choose')) { openPicker(); return; }
    const buyBtn = t.closest('[data-buy]');
    if (buyBtn) {
      const s = shop.data.stock.find((x) => String(x.slot) === buyBtn.dataset.buy);
      if (s && !s.bought) openConfirm({ kind: 'card', slot: s.slot });
      return;
    }
    const art = t.closest('[data-view]');
    if (art) openCard(Number(art.dataset.view));
  };
  for (const r of roots) r.onclick = onclick;
}

// Tap the card art: the card information window (Nathan, 2026-10-02), with the full catalog card
// (lore, ability, tags). Shown unlocked: a member sees the card before buying it. The arrows step
// through today's stock in the order on screen.
function openCard(slot) {
  const cat = ctx().cache.catalog?.cards || [];
  const order = { secret_rare: 0, illustrated_rare: 1, normal: 2 };
  const stock = [...(shop.data?.stock || [])].filter((s) => s.card).sort((a, b) => order[a.rarity] - order[b.rarity] || a.slot - b.slot);
  const full = (s) => ({ ...s.card, ...(cat.find((c) => Number(c.id) === Number(s.card_id)) || {}), locked: false });
  const s = stock.find((x) => x.slot === slot);
  if (s) ctx().openViewer(full(s), { list: stock.map(full) });
}

// ---- The windows (confirm, card picker) -------------------------------------------------------
function modalBox() {
  const { el } = ctx();
  let box = el('shopModal');
  if (!box) {
    document.body.insertAdjacentHTML('beforeend', '<div id="shopModal" class="v2-modal sh-modal hidden"></div>');
    box = el('shopModal');
    box.addEventListener('click', (e) => { if (e.target === box && !shop.busy) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.classList.contains('hidden') && !shop.busy) closeModal(); });
  }
  return box;
}
function closeModal() {
  shop.modal = null; shop.msg = '';
  if (isV3()) { ctx().el('u3ShopDlg')?.remove(); if (!ctx().el('shopModal')) return; }
  modalBox().classList.add('hidden');
}

function balanceRows(cost, freeText) {
  const bal = shop.data.balance || 0;
  const after = bal - cost;
  return `<div class="sh-bal">
      <div><span>Balance now</span>${price(bal)}</div>
      <div><span>Price${freeText ? '' : cost && shop.modal?.kind === 'pack' ? ` · ${shop.modal.qty} × ${fmt(shop.data.pack_price)}` : ''}</span>${freeText ? `<b class="sh-freep">${ICON.cal}${esc(freeText)}</b>` : `<span class="sh-price">${COIN}<b>- ${fmt(cost)}</b></span>`}</div>
      <div class="sh-after"><span>Balance after${cost ? '' : ' · no change'}</span>${price(after, 'lg')}</div>
    </div>`;
}

function openConfirm(m) {
  shop.modal = m; shop.msg = '';
  paintModal();
}
function paintModal() {
  if (isV3() && shop.modal && shop.modal.kind !== 'convert') { paintModalV3(); return; }
  const box = modalBox();
  const m = shop.modal;
  if (!m) { box.classList.add('hidden'); return; }
  if (m.kind === 'convert') { paintConvert(); return; }
  const d = shop.data;
  let art, kick, title, sub, cost, freeText = '', note = '', go;
  if (m.kind === 'card') {
    const s = d.stock.find((x) => x.slot === m.slot);
    if (!s) { closeModal(); return; }
    art = cardImg(s.card, 'big'); kick = s.rarity === 'secret_rare' ? "Featured · Today's stock" : "Today's stock";
    title = `Buy ${esc(s.card.name)}?`; sub = `<span class="sh-rar" style="color:var(--r-${s.rarity})">◆ ${esc(RL(s.rarity))}</span>${ownChip(s)}`;
    cost = s.price; go = `Buy ${COIN}<b>${fmt(cost)}</b>`;
  } else if (m.kind === 'pack') {
    art = `<div class="sh-packstack"><span class="sh-packart big">${ICON.crown}<i>LION PRIDE</i></span><em>x${m.qty}</em></div>`;
    kick = 'Packs · Shop'; title = `Buy ${m.qty} pack${m.qty === 1 ? '' : 's'}?`;
    sub = `<span class="dim">Lion Pride pack</span><span class="sh-chip gold">x${m.qty}</span>`;
    cost = d.pack_price * m.qty; note = `The ${m.qty === 1 ? 'pack goes' : `${m.qty} packs go`} to OPEN with your other packs.`;
    go = `Buy ${m.qty} pack${m.qty === 1 ? '' : 's'} ${COIN}<b>${fmt(cost)}</b>`;
  } else {
    const c = m.card;
    const pts = c.stat?.points || {};
    const total = Object.values(pts).reduce((a, b) => a + Number(b || 0), 0);
    const free = !!d.free_reset;
    art = cardImg(c, 'big'); kick = 'Stat reset'; title = `Reset ${esc(c.name)}?`;
    sub = `<span class="sh-rar" style="color:var(--r-${c.rarity})">◆ ${esc(RL(c.rarity))}</span><span class="sh-chip ${free ? 'ok' : ''}">${free ? 'Free weekly reset' : `Free reset used · back ${esc(nextDay(d.free_reset_next))}`}</span>`;
    note = `<div class="sh-pts"><div class="sh-pts-h"><span>Stat points</span><span>Now</span><span>After</span></div>${Object.entries(pts).filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => `<div><span>${esc(STAT_NAME[k] || k)}</span><b>${v}</b><b class="z">0</b></div>`).join('')}<p>${total} points ready to place again.</p></div>`;
    cost = free ? 0 : d.stat_reset_price; freeText = free ? 'Free · weekly reset' : '';
    go = free ? `${ICON.reset}Reset` : `${ICON.reset}Reset ${COIN}<b>${fmt(cost)}</b>`;
  }
  const short = (d.balance || 0) < cost;
  box.innerHTML = `<div class="sh-confirm${m.kind === 'reset' ? ' reset' : ''}" role="dialog" aria-modal="true">
      ${isPort() ? '<i class="sh-grab"></i>' : ''}
      <div class="sh-cart">${art}</div>
      <div class="sh-cbody">
        <button class="sh-x" aria-label="Close">${ICON.close}</button>
        <span class="sh-kick ${m.kind}">${kick}</span>
        <h3>${title}</h3>
        <div class="sh-csub">${sub}</div>
        ${m.kind === 'reset' ? note : ''}
        ${balanceRows(cost, freeText)}
        ${m.kind === 'pack' ? `<div class="sh-cnote">${ICON.pack}${esc(note)}</div>` : ''}
        ${shop.msg ? `<div class="sh-err">${esc(shop.msg)}</div>` : short ? '<div class="sh-err">You do not have enough Shards.</div>' : ''}
        <div class="sh-acts"><button class="v2-btn sh-cancel">Cancel</button><button class="v2-btn gold sh-go"${short || shop.busy ? ' disabled' : ''}>${shop.busy ? 'Buying…' : go}</button></div>
      </div>
    </div>`;
  box.classList.remove('hidden');
  box.querySelector('.sh-x').onclick = () => { if (!shop.busy) closeModal(); };
  box.querySelector('.sh-cancel').onclick = () => { if (!shop.busy) closeModal(); };
  box.querySelector('.sh-go').onclick = () => buy();
}

// The v3 confirm (UI-43): the library Dialog, centered; Cancel left, the action right (5.3); the reset is the danger
// action (7.4); a negative balance after uses danger (4.5); a refused buy shows the 10.6 text.
function dlgHost() {
  let host = ctx().el('u3ShopDlg');
  if (!host) {
    host = document.createElement('div');
    host.id = 'u3ShopDlg';
    document.body.appendChild(host);
    host.addEventListener('click', (e) => {
      if (shop.busy) return;
      if (e.target.matches('[data-u3-scrim]') || e.target.closest('[data-x], [data-cancel]')) { closeModal(); return; }
      if (e.target.closest('[data-go]')) buy();
    });
  }
  return host;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('u3ShopDlg') && !shop.busy) closeModal(); });
function paintModalV3() {
  const m = shop.modal;
  const d = shop.data;
  const art = (c) => `<span class="u3-sdlg__card u3-r-${esc(c.rarity)}">${c.image_url ? `<img src="${thumb(c.image_url)}" alt="" draggable="false">` : ''}</span>`;
  const rar = (r) => `<span class="u3-sdlg__rar u3-r-${esc(r)}"><span aria-hidden="true">◆</span>${esc(RL(r))}</span>`;
  const chip = (t) => `<span class="u3-chip u3-chip--sm u3-sdlg__chip">${esc(t)}</span>`;
  let c;
  if (m.kind === 'card') {
    const s = d.stock.find((x) => x.slot === m.slot);
    if (!s) { closeModal(); return; }
    c = { kind: 'card', art: art(s.card), eyebrow: s.rarity === 'secret_rare' ? "Featured · Today's stock" : "Today's stock", title: `Buy ${s.card.name}?`,
      sub: `${rar(s.rarity)}${s.bought ? '' : s.owned ? chip(`Owned ${s.owned}`) : chip('✦ New')}`, cost: s.price, priceLabel: 'Price', go: { label: 'Buy', reward: fmt(s.price) } };
  } else if (m.kind === 'pack') {
    c = { kind: 'pack', art: `<span class="u3-spack__art u3-spack__art--big">${ICON.crown}<i>LION PRIDE</i><em>x${m.qty}</em></span>`, eyebrow: 'Packs · Shop',
      title: `Buy ${m.qty} pack${m.qty === 1 ? '' : 's'}?`, sub: `<span class="u3-sdlg__dim">Lion Pride pack</span>${chip(`x${m.qty}`)}`, cost: d.pack_price * m.qty,
      priceLabel: `Price · ${m.qty} × ${fmt(d.pack_price)}`, go: { label: `Buy ${m.qty} pack${m.qty === 1 ? '' : 's'}`, reward: fmt(d.pack_price * m.qty) } };
  } else {
    const card = m.card;
    const pts = card.stat?.points || {};
    const total = Object.values(pts).reduce((a, b) => a + Number(b || 0), 0);
    const free = !!d.free_reset;
    const table = `<div class="u3-spts"><div class="u3-spts__h"><span>Stat points</span><span>Now</span><span>After</span></div>${Object.entries(pts).filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => `<div class="u3-spts__r"><span>${esc(STAT_NAME[k] || k)}</span><b>${v}</b><b class="u3-spts__z">0</b></div>`).join('')}<p class="u3-spts__note">${total} points ready to place again.</p></div>`;
    c = { kind: 'reset', art: art(card), eyebrow: 'Stat reset', title: `Reset ${card.name}?`, table,
      sub: `${rar(card.rarity)}${chip(free ? 'Free weekly reset' : `Free reset used · back ${nextDay(d.free_reset_next)}`)}`, cost: free ? 0 : d.stat_reset_price, priceLabel: 'Price',
      freeText: free ? 'Free · weekly reset' : '', go: { label: 'Reset', icon: 'rotate-ccw', variant: 'danger', reward: free ? null : fmt(d.stat_reset_price) } };
  }
  const bal = d.balance || 0;
  const html = confirmHTML({ ...c, rows: { now: bal, price: c.cost, priceLabel: c.priceLabel, after: bal - c.cost, freeText: c.freeText || '' },
    msg: shop.msg, short: bal < c.cost, busy: shop.busy }, COIN);
  const host = dlgHost();
  host.innerHTML = html;
  host.querySelector(shop.busy ? '.u3-sdlg' : '[data-cancel]')?.focus?.();
}

async function buy() {
  const m = shop.modal;
  if (!m || shop.busy) return;
  shop.busy = true; shop.msg = ''; paintModal();
  const body = m.kind === 'pack' ? { kind: 'pack', qty: m.qty } : m.kind === 'card' ? { kind: 'card', slot: m.slot } : { kind: 'stat_reset', cardId: m.card.id };
  let r = null;
  try { r = await ctx().apiPost('/api/shop/buy', body); } catch { r = null; }
  shop.busy = false;
  if (!r?.ok) { shop.msg = r?.message || (isV3() ? 'Something went wrong. Try again.' : 'That did not work. Try again.'); paintModal(); return; }
  ctx().sfx?.(m.kind === 'card' ? 'rare' : 'page');
  if (shop.data) shop.data.balance = r.balance;
  closeModal();
  if (m.kind === 'pack') { ctx().refreshPacks?.(); toast(`${m.qty} pack${m.qty === 1 ? '' : 's'} added to OPEN`); }
  if (m.kind === 'card') { toast('The card is in your collection'); }
  if (m.kind === 'reset') { toast(r.free ? 'Reset with your free weekly reset' : 'Stat points reset'); }
  if (m.kind !== 'pack') { ctx().cache.collection = null; Promise.resolve(ctx().refreshOwned?.()).catch(() => {}); }
  await load();
  if (ctx().currentView() === 'shop') paint();
}

// The stat reset picker (design 29, 04): only the member's cards with stat points spent.
async function openPicker() {
  if (isV3()) { openPickerV3(); return; }
  const box = modalBox();
  shop.modal = { kind: 'pick' };
  if (!ctx().cache.collection) { box.innerHTML = '<div class="sh-picker"><div class="loading">Loading…</div></div>'; box.classList.remove('hidden'); try { await ctx().refreshOwned(); } catch { /* keep */ } }
  if (shop.modal?.kind !== 'pick') return;
  const d = shop.data;
  const list = (ctx().cache.collection?.cards || []).filter((c) => c.stat?.points && Object.values(c.stat.points).some((v) => Number(v) > 0));
  const free = !!d.free_reset;
  box.innerHTML = `<div class="sh-picker" role="dialog" aria-modal="true">
      <div class="sh-pk-head"><div><span class="sh-kick reset">Stat reset</span><h3>Choose a card</h3><span class="dim">${list.length} card${list.length === 1 ? '' : 's'}</span></div><button class="sh-x" aria-label="Close">${ICON.close}</button></div>
      <div class="sh-free${free ? ' ok' : ''}">${ICON.cal}<b>${free ? 'Your free weekly reset is available' : `Free reset used · back ${esc(nextDay(d.free_reset_next))}`}</b><span class="grow"></span><span>This reset costs</span>${price(free ? 0 : d.stat_reset_price, 'sm')}</div>
      ${list.length ? '<div class="sh-pk-grid v2-grid" data-cap="40"></div><div class="v2-pager sh-pk-pager"></div>' : '<p class="v2-empty">None of your cards has stat points to reset.</p>'}
    </div>`;
  box.classList.remove('hidden');
  box.querySelector('.sh-x').onclick = closeModal;
  if (!list.length) return;
  const grid = box.querySelector('.sh-pk-grid');
  const state = { page: 0, tile: (c, idx) => `<div class="v2-cell" data-idx="${idx}"><div class="v2-card r-${c.rarity}">${c.image_url ? `<img src="${thumb(c.image_url)}" alt="${esc(c.name)}" loading="lazy">` : ''}</div>
      <div class="v2-cap sh-pts-cap">${Object.entries(c.stat.points).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${STAT_SHORT[k] || k} ${v}`).join(' · ')}</div></div>` };
  requestAnimationFrame(() => paintCards(grid, box.querySelector('.sh-pk-pager'), list, state, (c) => openConfirm({ kind: 'reset', card: c })));
}

// The v3 stat reset picker: the Card picker (UI-64) in pick-one mode; the stat points on each card; the free reset line.
async function openPickerV3() {
  if (!ctx().cache.collection) { try { await ctx().refreshOwned(); } catch { /* keep */ } }
  const d = shop.data;
  const list = (ctx().cache.collection?.cards || []).filter((c) => c.stat?.points && Object.values(c.stat.points).some((v) => Number(v) > 0));
  const free = !!d.free_reset;
  const line = `${free ? 'Your free weekly reset is available' : `Free reset used · back ${nextDay(d.free_reset_next)}`} · This reset costs ${fmt(free ? 0 : d.stat_reset_price)} Shards`;
  openCardPicker({
    title: 'Choose a card', one: true, cap: 1, cards: list, selected: [],
    caption: (c) => Object.entries(c.stat?.points || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${STAT_SHORT[k] || k} ${v}`),
    status: (sel) => ({ checks: [{ ok: free, label: line }], ready: sel.length === 1, reason: 'Choose a card' }),
    detail: (c) => ctx().openViewer?.(c),
    returnFocus: document.querySelector('[data-choose]'),
    onConfirm: (sel) => { const card = list.find((c) => Number(c.id) === Number(sel[0])); if (card) setTimeout(() => openConfirm({ kind: 'reset', card }), 0); return true; },
  });
}

// ---- Convert extras (the Collection card panel): extra copies become Shards. The server keeps
// 1 copy (Nathan, 2026-10-02, option B: the member chooses between ascension and Shards) and never
// converts a held copy (convertible_copies, shards_convert_keep_one.sql). ----
export async function fillConvertButton(card, onDone) {
  const btn = ctx().el('pConvert');
  if (!btn || !shop.on || card?.locked || (card?.quantity || 0) < 2) return;
  let r = null;
  try { r = await ctx().api(`/api/shards/convertible?cardId=${encodeURIComponent(card.id)}`); } catch { r = null; }
  if (ctx().el('pConvert') !== btn || !r?.count || !r?.each) return; // another card is open now, or nothing to convert
  btn.innerHTML = `${COIN}<span class="cv-long">Convert ${r.count} extra${r.count === 1 ? '' : 's'}</span><span class="cv-short">×${r.count}</span>`;
  btn.title = `${r.count} extra cop${r.count === 1 ? 'y' : 'ies'} = ${fmt(r.count * r.each)} Shards`;
  btn.classList.remove('hidden');
  btn.onclick = () => { shop.modal = { kind: 'convert', card, max: r.count, each: r.each, n: r.count, onDone }; shop.msg = ''; paintModal(); };
}

function paintConvert() {
  const box = modalBox();
  const m = shop.modal;
  const bal = shop.data?.balance || 0;
  const get = m.n * m.each;
  box.innerHTML = `<div class="sh-confirm convert" role="dialog" aria-modal="true">
      ${isPort() ? '<i class="sh-grab"></i>' : ''}
      <div class="sh-cart">${cardImg(m.card, 'big')}</div>
      <div class="sh-cbody">
        <button class="sh-x" aria-label="Close">${ICON.close}</button>
        <span class="sh-kick reset">Convert extras</span>
        <h3>Convert extra copies of ${esc(m.card.name)}?</h3>
        <div class="sh-csub"><span class="sh-rar" style="color:var(--r-${m.card.rarity})">◆ ${esc(RL(m.card.rarity))}</span><span class="sh-chip">Owned ${m.card.quantity}</span></div>
        <div class="sh-qty sh-cqty"><div><b>Copies to convert</b><span>${fmt(m.each)} Shards each · 1 to ${m.max}</span></div><span class="grow"></span>
          <button class="sh-step" data-cq="-1"${m.n <= 1 ? ' disabled' : ''}>−</button><b class="sh-qn">${m.n}</b><button class="sh-step" data-cq="1"${m.n >= m.max ? ' disabled' : ''}>+</button></div>
        <div class="sh-bal">
          <div><span>Balance now</span>${price(bal)}</div>
          <div><span>You get · ${m.n} × ${fmt(m.each)}</span><span class="sh-price">${COIN}<b>+ ${fmt(get)}</b></span></div>
          <div class="sh-after"><span>Balance after</span>${price(bal + get, 'lg')}</div>
        </div>
        <div class="sh-cnote">${ICON.check}You keep 1 copy.${(m.card.ascension || 0) < 5 ? ' These copies can also ascend this card.' : ''}</div>
        ${shop.msg ? `<div class="sh-err">${esc(shop.msg)}</div>` : ''}
        <div class="sh-acts"><button class="v2-btn sh-cancel">Cancel</button><button class="v2-btn gold sh-go"${shop.busy ? ' disabled' : ''}>${shop.busy ? 'Converting…' : `Convert ${COIN}<b>+${fmt(get)}</b>`}</button></div>
      </div>
    </div>`;
  box.classList.remove('hidden');
  box.querySelector('.sh-x').onclick = () => { if (!shop.busy) closeModal(); };
  box.querySelector('.sh-cancel').onclick = () => { if (!shop.busy) closeModal(); };
  box.querySelectorAll('[data-cq]').forEach((b) => { b.onclick = () => { m.n = Math.min(m.max, Math.max(1, m.n + Number(b.dataset.cq))); paintConvert(); }; });
  box.querySelector('.sh-go').onclick = async () => {
    if (shop.busy) return;
    shop.busy = true; shop.msg = ''; paintConvert();
    let r = null;
    try { r = await ctx().apiPost('/api/shards/convert', { cardId: m.card.id, count: m.n }); } catch { r = null; }
    shop.busy = false;
    if (!r?.ok) { shop.msg = r?.message || 'That did not work. Try again.'; paintConvert(); return; }
    ctx().sfx?.('page');
    if (shop.data) shop.data.balance = r.balance;
    closeModal();
    toast(`+${fmt(r.shards)} Shards`);
    refreshShards();
    m.onDone?.(r);
  };
}
