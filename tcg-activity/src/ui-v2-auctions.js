// UI-32 Auctions under body.ui-v3 (design repo UI-32/approved; D-67, D-74; the rules in src/ui3/auctions.js). ui-v2-hall.js owns the Hall
// state (`hall`), the data calls and the v2 views; this module paints the v3 views over the same state and keeps every handler and API
// call of the v2 views (the server rules stay in src/hall-routes.js). The views: the open list and My auctions, Start an auction,
// the seller view (bids, Accept, Close early) and the bidder view (the bid with the Card picker, Withdraw with Undo, Confirm).
import { esc, button, iconButton, searchField, pager, chip, segmented, stateEmpty, inlineMessage, toast as toastHTML, select, stepper } from './ui3/components.js';
import { icon } from './ui3/icons.js';
import { fitGrid, openCardPicker } from './ui3/card-picker.js';
import { listFit, applyListPick, listFilterCount } from './ui3/compose.js';
import { applyHall, filterCount, clampPage, pagesOf, switchHTML } from './ui3/hall.js';
// (the pager of the seller bids uses the same helpers as the list)
import * as AU from './ui3/auctions.js';
import { TOKENS } from './tokens.js';
import { thumb } from './thumb.js';
import { v2ctx, toast, onSwipe, ensureCatalog } from './ui-v2.js';
import { cardElement } from './elements.js';
import { commTabs, wireCommTabs } from './ui-v2-social.js';
import { explainBtn, maybeExplain } from './ui-v2-explain.js';

export function auctionsV3(deps) {
  const { hall } = deps;
  const ctx = () => v2ctx();
  const mine = () => ctx().cache.collection?.cards || [];
  const catalog = () => ctx().cache.catalog?.cards || [];
  const R = (r) => AU.rarityName(r);
  let ro = null, mo = null, auItems = [], dlgKey = null, toastT = 0;

  // ---- the shared parts ------------------------------------------------------------------------
  const avatar = (id, name) => `<span class="u3-mp-av" aria-hidden="true"><span>${esc(String(name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`
    + `<img src="/api/avatar/${esc(id)}" alt="" loading="lazy" draggable="false" data-err="remove"></span>`;
  const face = (c, cls = '') => `<span class="u3-au-face u3-r-${esc(c.rarity || 'normal')} ${cls}">${c.image_url ? `<img src="${thumb(c.image_url)}" alt="" draggable="false">` : ''}</span>`;
  const rareChip = (r) => chip({ label: R(r), kind: 'rarity', rarity: r });
  const dia = (r) => `<span class="u3-au-dia u3-r-${esc(r || 'normal')}"><span class="u3-chip__mark"></span></span>`;
  const totals = (cards) => AU.bidTotals(cards).map((t) => `<span class="u3-au-tot"><b>${t.n}×</b>${dia(t.rarity)}<span>${esc(R(t.rarity))}</span></span>`).join('');
  const msgHTML = () => (hall.msg ? inlineMessage({ kind: hall.msgOk ? 'success' : 'error', text: hall.msg }) : '');
  const detail = (c) => { const full = catalog().find((x) => Number(x.id) === Number(c.id)) || c; ctx().openViewer?.(full); };
  const lookup = (id) => mine().find((c) => Number(c.id) === Number(id)) || catalog().find((c) => Number(c.id) === Number(id));

  function stop() { ro?.disconnect(); ro = null; mo?.disconnect(); mo = null; deps.stopHall(); }
  // Layout modes measured from the page box (the info panel and the main panel share the height): level 0 = the frames, 1 = is-tight, 2 = is-tighter.
  const stacked = () => /^(compact-port|medium)$/.test(document.body.dataset.size || '');
  function settle(root, fits, max = 3) {
    const top = Math.min(max, stacked() ? 3 : 2);
    for (let level = 0; level <= top; level++) {
      root.classList.toggle('is-tight', level === 1); root.classList.toggle('is-tighter', level >= 2); root.classList.toggle('is-sheet', level === 3);
      const body = root.querySelector('.u3-au-info__body'); if (body) body.hidden = level === 3 && !hall.infoOpen;   // folded: the toggle (aria-controls) opens it
      if (fits(level) || level === top) return level;
    }
    return top;
  }
  // the info panel holds its content (side by side with the main panel it has the page height; stacked it has its own height)
  const asideFits = (root) => { const a = root.querySelector('.u3-au__aside'); return !a || a.scrollHeight <= a.clientHeight + 1; };
  // measure after the first paint, when the fonts and the late content arrive, and when the page box changes (the page box does not depend on the mode)
  function watch(root, lay) {
    let raf = 0;
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (root.isConnected) lay(); }); };
    lay();
    document.fonts?.ready.then(run);
    if (window.ResizeObserver) { ro = new ResizeObserver(run); ro.observe(root); }
  }
  function closeDlg() { document.getElementById('u3AuDlgHost')?.remove(); dlgKey = null; }
  function closeToast() { clearTimeout(toastT); document.getElementById('u3AuToast')?.remove(); }
  function showToast(text, action, fn) {
    closeToast();
    document.body.insertAdjacentHTML('beforeend', `<div id="u3AuToast" class="u3-au-toast">${toastHTML({ kind: 'info', text, action })}</div>`);
    document.querySelector('#u3AuToast .u3-toast__action')?.addEventListener('click', async () => { closeToast(); await fn?.(); });
    toastT = setTimeout(closeToast, 8000);
  }
  const reset = (extra = {}) => Object.assign(hall, { auction: null, start: null, bid: [], page: 0, bpage: 0, infoOpen: false, msg: '', msgOk: false, sheet: false, ...extra });
  async function back() { closeDlg(); closeToast(); stop(); reset(); await deps.renderHall(); }
  // the page of the start, seller and bidder views: the back button, then the panels (the grid areas change with the size class)
  function page(cls, body) {
    const { el } = ctx();
    stop(); closeDlg();
    el('main').innerHTML = `<div class="u3-au ${cls}">${commTabs()}${explainBtn(hall.sub)}<div class="u3-au__back">${button({ label: 'Auctions', icon: 'arrow-left', data: { auback: '1' } })}</div>${body}</div>`;
    wireCommTabs();
    maybeExplain(hall.sub);
    const root = el('main').querySelector('.u3-au');
    root.classList.toggle('is-info-open', !!hall.infoOpen);
    root.addEventListener('click', onClick);
    return root;
  }

  // ---- the list: Open auctions and My auctions -----------------------------------------------------------
  const searchHTML = () => searchField({ value: hall.q, placeholder: 'Search cards, tags…' });
  function list() {
    const { el } = ctx();
    const n = filterCount(hall.f), on = hall.aview === 'mine';
    stop(); closeDlg(); closeToast();
    hall.cls = document.body.dataset.size;
    el('main').innerHTML = `<div class="u3-hl u3-au-list">${commTabs()}${explainBtn(hall.sub)}`
      + `<div class="u3-hl__sw" id="hlSub">${switchHTML('auctions', hall.view)}</div>`
      + `<div class="u3-hl__manage">${button({ label: 'Manage my listings', variant: 'primary', icon: 'settings', data: { aumanage: '1' } })}</div>`
      + `<div class="u3-hl__wish"><button type="button" class="u3-btn u3-btn--secondary u3-btn--md u3-au-mine${on ? ' is-on' : ''}" aria-pressed="${on}" data-aumine="1">${icon('user')}<span class="u3-btn__label">My auctions</span></button></div>`
      + `<div class="u3-hl__find" id="hlSearch">${searchHTML()}</div>`
      + `<div class="u3-hl__filt">${button({ label: n ? `Filters (${n})` : 'Filters', icon: 'list-filter', data: { hlfilters: '1' } })}</div>`
      + `<ul class="u3-hl__grid u3-au-grid" id="hlGrid" aria-label="${on ? 'My auctions' : 'Open auctions'}"></ul><div class="u3-hl__pager" id="hlPager"></div></div>`;
    wireCommTabs();
    maybeExplain(hall.sub);
    const root = el('main').querySelector('.u3-hl');
    root.querySelector('#hlSub').onclick = deps.onSwitch;
    root.querySelector('[data-aumanage]').onclick = manage;
    root.querySelector('[data-aumine]').onclick = async () => { hall.aview = on ? 'open' : 'mine'; hall.page = 0; await deps.renderHall(); };
    root.querySelector('[data-hlfilters]').onclick = deps.openHallFilters;
    const find = el('hlSearch');
    const refreshSearch = () => {
      const had = find.contains(document.activeElement), caret = had ? document.activeElement.selectionStart : null;
      find.innerHTML = searchHTML();
      if (had) { const i = find.querySelector('.u3-search__input'); i?.focus({ preventScroll: true }); try { i.setSelectionRange(caret, caret); } catch { /* */ } }
    };
    find.addEventListener('input', (e) => {
      if (!e.target.classList.contains('u3-search__input')) return;
      const had = !!hall.q;
      hall.q = e.target.value; hall.page = 0;
      if (!!hall.q !== had) refreshSearch();
      fill(el('hlGrid'));
    });
    find.addEventListener('click', (e) => { if (!e.target.closest('.u3-ibtn')) return; hall.q = ''; hall.page = 0; refreshSearch(); fill(el('hlGrid')); });
    const g = el('hlGrid');
    g.addEventListener('click', (e) => { const b = e.target.closest('[data-idx]'); const c = b && auItems[Number(b.dataset.idx)]; if (c) deps.openAuction(c._a.id); });
    onSwipe(g, (dir) => { const p = clampPage(hall.page + dir, pagesOf(auItems.length, g._per)); if (p !== hall.page) { hall.page = p; fill(g); } });
    el('hlPager').onclick = (e) => { const b = e.target.closest('button[data-page]'); if (!b || b.disabled) return; hall.page += b.dataset.page === 'next' ? 1 : -1; fill(g); };
    if (window.ResizeObserver) { ro = new ResizeObserver(() => requestAnimationFrame(() => { if (el('hlGrid') === g && g.isConnected) fill(g); })); ro.observe(g); }
    // the keyboard and the size class change the box after the resize: fit again, the page kept (as the Collection and the Card picker)
    if (window.MutationObserver) { let t = 0; mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { if (el('hlGrid') === g && g.isConnected) { g._keep = hall.page * (g._per || 1); fill(g); } else mo?.disconnect(); }, 100); }); mo.observe(document.body, { attributes: true, attributeFilter: ['data-kb', 'data-size', 'data-input', 'data-short'] }); }
    if (!ctx().cache.catalog) ensureCatalog().then(() => { if (el('hlGrid') === g && (hall.q || filterCount(hall.f))) fill(g); });
    // From the bell's Confirm: open the auction that waits for me (the cached list may not have it yet).
    if (hall.openAccepted) {
      const w = AU.waitingForMe(hall.auctions);
      if (w) { hall.openAccepted = false; deps.openAuction(w.id); return; }
    }
    fill(g);
    document.fonts?.ready.then(() => { if (el('hlGrid') === g) fill(g); });
  }
  // One live auction per member: Manage opens it; with none, it opens Start an auction (the v2 rule).
  async function manage() {
    let my = [...(hall.auctionsBy.open || []), ...(hall.auctionsBy.mine || [])].find((a) => a.mine);
    if (!my) { const d = await ctx().api('/api/auctions?view=mine').catch(() => null); my = (d?.auctions || []).find((a) => a.mine); }
    if (my) { await deps.openAuction(my.id); return; }
    try { await ctx().refreshOwned(); } catch { /* keep */ }
    hall.start = AU.newStart(); hall.page = 0; hall.msg = ''; deps.paintHall();
  }
  function tile(c, idx) {
    const a = c._a, cap = AU.listCaption(a);
    return `<li class="u3-au-cell"><div class="u3-hl-card u3-r-${esc(c.rarity || 'normal')}"><button type="button" class="u3-hl-card__pick" data-idx="${idx}" aria-label="${esc(c.name)}, ${esc(a.seller)}, ${esc(cap.text)}, ${cap.bids} bids">`
      + `${c.image_url ? `<img src="${thumb(c.image_url)}" data-full="${esc(c.image_url)}" alt="" loading="lazy" draggable="false">` : ''}</button></div>`
      + `<span class="u3-au-cap is-${cap.kind}">${cap.kind === 'live' || cap.kind === 'soon' ? icon('hourglass', { size: 'sm' }) : ''}<span>${esc(cap.text)}</span>${icon('gavel', { size: 'sm' })}<span>${cap.bids}</span></span></li>`;
  }
  // the page: the grid fitted to its box (the caption under each card is part of the cell), the cards of the page, the pager
  function fill(g) {
    if (!g || !g.isConnected) return;
    const rows = AU.asRows(hall.auctions);
    auItems = applyHall(rows, { q: hall.q, filters: hall.f, tagsOf: deps.tagsOf, elementOf: cardElement, owns: deps.owns }).map((x, i) => ({ ...x.card, _a: x, _k: i }));
    const root = g.closest('.u3-hl');
    const gap = parseFloat(getComputedStyle(g).columnGap) || 0;
    // the keyboard is open (body[data-kb]): the captions give way (90-ui-32.css) and the grid fits by card size alone, as the Card picker;
    // the tile never goes under the tile size, so the pick button stays 44 px or more (fewer cards on the page is fine)
    const kb = document.body.hasAttribute('data-kb');
    const cap = kb ? 0 : g._cap || TOKENS['sp-5'];
    const extra = kb ? 0 : cap + TOKENS['sp-1'];
    const fit = (o) => fitGrid(g.clientWidth, g.clientHeight, gap, { extra, ...o });
    const solve = () => {
      root.classList.remove('is-tight');
      let r = fit();
      if (r.rows < 2) { root.classList.add('is-tight'); r = fit(); }
      if (!kb && r.rows < 2) { const s = fit({ min: TOKENS['card-mini'] }); if (s.rows >= 2) r = s; }
      return r;
    };
    root.classList.remove('has-pager');
    let f = solve();
    if (auItems.length > f.cols * f.rows) { root.classList.add('has-pager'); f = solve(); if (auItems.length <= f.cols * f.rows) { root.classList.remove('has-pager'); f = solve(); } }
    // every card on one page: the cards grow to fill the box (up to the largest tile), as the Trade Hall lists
    if (auItems.length && auItems.length <= f.cols * f.rows) {
      const all = AU.fitAllWithCaption(auItems.length, g.clientWidth, g.clientHeight, gap, { min: f.tile, max: TOKENS['card-tile-max'], ratio: TOKENS['card-ratio'], extra });
      if (all) f = { ...f, ...all };
    }
    g.classList.toggle('is-short', f.tile < TOKENS.hit);
    g.classList.toggle('is-narrow', f.tile < TOKENS['card-tile']);   // a card under the tile size (the keyboard is open): the caption takes the label size so it fits the cell
    const per = f.cols * f.rows;
    g._per = per;
    if (g._keep != null) { hall.page = Math.floor(g._keep / per); g._keep = null; }
    hall.page = clampPage(hall.page, pagesOf(auItems.length, per));
    g.style.setProperty('--hl-cols', f.cols); g.style.setProperty('--hl-tile', `${f.tile}px`); g.style.setProperty('--au-cap', `${cap}px`);
    g.classList.toggle('is-empty', !auItems.length);
    const html = auItems.length ? auItems.slice(hall.page * per, hall.page * per + per).map((c, i) => tile(c, hall.page * per + i)).join('')
      : `<li class="u3-hl__none">${stateEmpty({ title: AU.emptyText(hall.aview, !!(hall.q.trim() || filterCount(hall.f))) })}</li>`;
    if (g._html !== html) { g._html = html; g.innerHTML = html; }
    // the caption height as laid out (it can wrap on a small card): fit again once with it
    const hs = [...g.querySelectorAll('.u3-au-cap')].map((e) => Math.ceil(e.getBoundingClientRect().height));
    const need = hs.length ? Math.max(...hs) : cap;
    if (!kb && need !== g._cap && need > 0 && !g._capTry) { g._cap = need; g._capTry = true; g._html = null; fill(g); g._capTry = false; return; }
    const pages = pagesOf(auItems.length, per), p = ctx().el('hlPager');
    const ph = pages > 1 ? pager({ page: hall.page + 1, pages }) : '';
    if (p && p._html !== ph) { p._html = ph; p.innerHTML = ph; }
  }

  // ---- Start an auction --------------------------------------------------------------------------
  function paintStart() {
    const st = hall.start;
    const c = st.card, gold = c?.rarity === 'gold', allowed = AU.bidRarities(gold);
    const hits = AU.askHits(catalog(), allowed, st.q, st.minCards);
    const slot = c ? `<button type="button" class="u3-au-start__slot is-full u3-r-${esc(c.rarity || 'normal')}" data-aupickcard="1" aria-label="Change the card: ${esc(c.name)}">${face(c)}</button>`
      : `<button type="button" class="u3-au-start__slot" data-aupickcard="1" aria-label="${AU.TEXT.pickCard}">${icon('plus', { size: 'xl' })}<span>${AU.TEXT.pickCard}</span></button>`;
    const info = c ? `<h3 class="u3-au-start__name">${esc(c.name)}</h3><div class="u3-au-start__bids">${rareChip(c.rarity)}<span class="u3-label">Bids</span><span>${gold ? AU.BID_GOLD.map(R).join(', ') : 'Any card but Gold'}</span></div>` : '';
    const chips = st.minCards.map((x) => `<span class="u3-au-ask">${face(x)}<span class="u3-au-ask__name">${esc(x.name)}</span>${iconButton({ icon: 'x', label: `Remove ${x.name}`, size: 'sm', variant: 'plain', data: { auunask: x.id } })}</span>`).join('');
    const body = `<section class="u3-au__main u3-au-start" aria-label="Start auction">`
      + `<h2 class="u3-au-start__head">${icon('gavel', { size: 'xl' })}<span>Start auction</span></h2>`
      + `<div class="u3-au-start__card">${slot}</div><div class="u3-au-start__info">${info}</div>`
      + `<div class="u3-au-start__min"><span class="u3-label">Minimum</span>`
      + `<div class="u3-au-start__row" data-step="count">${stepper({ value: st.minCount, min: 0, max: AU.MIN_MAX, unit: '×', name: 'minimum count' })}${select({ value: R(st.minRarity || AU.defaultMinRarity(gold)), options: allowed.map(R), label: 'Minimum rarity', disabled: !st.minCount })}</div>`
      + `<div class="u3-au-start__ask">${segmented([{ id: 'and', label: 'AND', active: st.mode === 'and' }, { id: 'or', label: 'OR', active: st.mode === 'or' }], { label: 'Minimum mode' })}`
      + `<div class="u3-au-start__find"><div id="auAsk">${searchField({ value: st.q, placeholder: 'Ask for a card (up to 3)', label: 'Ask for a card', disabled: st.minCards.length >= AU.ASK_MAX })}</div><ul class="u3-au-hits" id="auHits"></ul></div></div>`
      + `<div class="u3-au-start__chips" id="auChips">${chips}</div></div>`
      + `<div class="u3-au-start__len"><span class="u3-label">Length</span><span class="u3-au-start__ends" id="auEnds">${esc(AU.endsText(Date.now() + st.days * 86400e3))}</span>`
      + `<div class="u3-au-start__row" data-step="days">${stepper({ value: st.days, min: AU.DAYS_MIN, max: AU.DAYS_MAX, unit: ` day${st.days === 1 ? '' : 's'}`, name: 'length', limits: '1 to 14 days' })}</div></div>`
      + `<div class="u3-au-start__msg">${st.msg ? inlineMessage({ kind: 'error', text: st.msg }) : ''}</div>`
      + `<div class="u3-au-start__go">${button({ label: 'Start auction', variant: 'primary', icon: 'gavel', disabled: !AU.startReady(st), data: { austart: '1' } })}</div></section>`;
    const root = page('u3-au--one', body);
    // a page too short for the panel brings the parts closer (is-tight, then is-tighter): nothing is cut off
    const main = root.querySelector('.u3-au-start');
    watch(root, () => settle(root, () => main.scrollHeight <= main.clientHeight + 1, 2));
    const hitsEl = root.querySelector('#auHits');
    const paintHits = () => {
      const hh = AU.askHits(catalog(), allowed, st.q, st.minCards);
      hitsEl.innerHTML = hh.map((x) => `<li><button type="button" class="u3-au-hit" data-auhit="${x.id}">${face(x)}<span class="u3-au-hit__txt"><b>${esc(x.name)}</b><span class="u3-au-hit__r u3-r-${esc(x.rarity)}">${dia(x.rarity)}<span>${esc(R(x.rarity))}</span></span></span>${icon('plus', { size: 'lg' })}</button></li>`).join('');
      hitsEl.hidden = !hh.length;
    };
    paintHits();
    if (!ctx().cache.catalog) ensureCatalog().then(() => { if (hall.start === st && hitsEl.isConnected) paintHits(); });
    root.querySelector('#auAsk').addEventListener('input', (e) => { if (!e.target.classList.contains('u3-search__input')) return; st.q = e.target.value; paintHits(); });
    root.querySelector('#auAsk').addEventListener('click', (e) => { if (!e.target.closest('.u3-ibtn')) return; st.q = ''; deps.paintHall(); });
    // pointerdown keeps the box focused while a hit is chosen (the keyboard stays, nothing jumps)
    hitsEl.addEventListener('pointerdown', (e) => { if (e.target.closest('.u3-au-hit')) e.preventDefault(); });
    root.querySelector('.u3-select__input')?.addEventListener('change', (e) => { st.minRarity = allowed.find((r) => R(r) === e.target.value) || st.minRarity; });
    root.addEventListener('click', (e) => {
      const hit = e.target.closest('[data-auhit]');
      if (!hit) return;
      const x = catalog().find((k) => Number(k.id) === Number(hit.dataset.auhit));
      if (x) { hall.start = AU.addAsk(st, x); hall.start.q = ''; deps.paintHall(); }
    });
  }
  async function openStartPicker(from) {
    const st = hall.start;
    try { await ctx().refreshOwned(); } catch { /* keep */ }
    await ensureCatalog().catch(() => {});
    const cards = AU.startable(mine(), hall.held).map((c) => ({ ...c, tags: c.tags || deps.tagsOf(c) }));
    const rarities = ['gold', 'full_art', 'secret_rare', 'illustrated_rare', 'normal'].filter((r) => cards.some((c) => c.rarity === r));
    openCardPicker({
      title: 'Start auction', icon: 'gavel', one: true, cap: 1, cards, selected: st.card ? [Number(st.card.id)] : [], returnFocus: from,
      filters: [{ key: 'rarity', label: 'Rarity', value: 'all', clear: 'all', options: [{ id: 'all', label: 'All' }, ...rarities.map((id) => ({ id, label: R(id) }))] }],
      filterCount: listFilterCount, apply: applyListPick,
      status: (sel) => ({ checks: [], ready: sel.length === 1 }),
      detail: (c) => ctx().openViewer?.(c),
      clear: { label: 'Clear', resets: true },
      onConfirm: async (sel) => { const c = cards.find((x) => Number(x.id) === Number(sel[0])); if (c) { hall.start = AU.chooseCard(hall.start, c); deps.paintHall(); } return true; },
    });
  }
  async function startNow() {
    const st = hall.start;
    if (!AU.startReady(st)) return;
    const b = document.querySelector('[data-austart]'); if (b) b.disabled = true;
    let r = null;
    try { r = await ctx().apiPost('/api/auction/start', AU.startBody(st)); } catch (e) { r = e?.body || null; }
    if (!r?.ok) { st.msg = r?.message || AU.TEXT.startError; deps.paintHall(); return; }
    hall.start = null; toast?.(`Your auction for ${st.card.name} is open.`);
    await deps.openAuction(r.id);
  }
  function onStep(btn) {
    const st = hall.start, kind = btn.closest('[data-step]')?.dataset.step, up = /^Increase/.test(btn.getAttribute('aria-label'));
    if (kind === 'count') hall.start = AU.setMinCount(st, st.minCount + (up ? 1 : -1));
    else if (kind === 'days') hall.start = { ...st, days: AU.clampDays(st.days + (up ? 1 : -1)) };
    deps.paintHall();
  }

  // ---- one auction: the info panel (seller and bidder) ------------------------------------------------------
  function info(a, extra) {
    const t = AU.timeLeft(a.ends_at), open = a.status === 'live' || a.status === 'accepted';
    const lines = AU.minLines(a.min).map((l) => `<li class="u3-au-min__line">${l.lead ? `<span class="u3-au-min__lead">${l.lead}</span>` : ''}${l.kind === 'count'
      ? `<b>${l.count}×</b>${dia(l.rarity)}<span>${esc(R(l.rarity))}</span>` : `${face(l.card, 'is-mini')}<span class="u3-au-min__name">${esc(l.card.name)}</span>`}</li>`).join('');
    return `<aside class="u3-au__aside u3-au-info" aria-label="Auction">`
      + `<button type="button" class="u3-au-info__toggle" data-auinfo="1" aria-expanded="${!!hall.infoOpen}" aria-controls="u3AuInfoBody">${icon('gavel', { size: 'xl' })}<span class="u3-au-info__tname">Auction Information</span>${rareChip(a.card.rarity)}${icon('chevron-up')}</button>`
      + `<div class="u3-au-info__body" id="u3AuInfoBody" data-disclosure="1">`
      + `<header class="u3-au-info__head">${a.isSeller ? `${icon('gavel', { size: 'xl' })}<h2 class="u3-au-info__title">Your auction</h2>` : `${avatar(a.seller_id, a.seller)}<h2 class="u3-au-info__title">${esc(a.seller)}</h2>`}<span class="u3-au-info__rar">${rareChip(a.card.rarity)}</span></header>`
      + `<div class="u3-au-info__top"><button type="button" class="u3-au-info__card u3-r-${esc(a.card.rarity || 'normal')}" data-auview="1" aria-label="Card details: ${esc(a.card.name)}">${face(a.card)}<span class="u3-au-info__mag">${icon('search')}</span></button>`
      + `<div class="u3-au-info__txt"><h3 class="u3-au-info__name">${esc(a.card.name)}</h3>`
      + `<div class="u3-au-time${t.soon && open ? ' is-soon' : ''}">${open ? `<span class="u3-au-time__pill">${icon('hourglass')}<b>${esc(t.text)}</b></span><span class="u3-au-time__ends">${esc(AU.endsText(a.ends_at, Date.now(), 'Ends'))}</span>`
        : `<span class="u3-au-time__pill"><b>${a.status === 'sold' ? 'Sold' : 'Ended'}</b></span>`}</div></div></div>`
      + `<div class="u3-au-info__facts"><div class="u3-au-min"><span class="u3-label">Minimum</span>${lines ? `<ul class="u3-au-min__list">${lines}</ul>` : `<span class="u3-au-min__any">${AU.TEXT.anyBid}</span>`}</div>`
      + `<div class="u3-au-nbids"><span class="u3-label">Bids</span><b>${a.bidsCount}</b></div></div>${extra}</div></aside>`;
  }
  const stepsHTML = (list) => `<ol class="u3-au-steps">${list.map((s) => `<li class="${s.on ? 'is-on' : ''}${s.done ? ' is-done' : ''}"><span class="u3-au-steps__n">${s.done ? icon('check', { size: 'sm' }) : s.n}</span><span>${esc(s.label)}</span></li>`).join('')}</ol>`;

  // ---- the bidder view ---------------------------------------------------------------------------------
  function paintAuction() {
    const a = hall.auction;
    if (a.isSeller) return paintSeller(a);
    const my = a.myBid;
    const confirm = a.status === 'accepted' && my?.status === 'accepted';
    const byId = new Map(mine().map((c) => [Number(c.id), c]));
    const cards = hall.bid.map((id) => byId.get(Number(id)) || (my?.cards || []).find((x) => Number(x.id) === Number(id))).filter(Boolean);
    const st = AU.bidStatus(a, cards), gold = a.card.rarity === 'gold';
    const stateHTML = a.status !== 'live' && !confirm ? `<span class="u3-au-bid__state">${esc(AU.closedText(a))}</span>`
      : st ? `<span class="u3-au-bid__state is-${st}">${icon(st === 'meets' ? 'circle-check' : 'circle-minus')}<span>${st === 'meets' ? 'Meets minimum' : 'Below minimum'}</span></span>` : '';
    const slots = [0, 1, 2, 3, 4].map((i) => (cards[i] ? `<li><button type="button" class="u3-au-slot is-full u3-r-${esc(cards[i].rarity || 'normal')}" data-auslot="1" aria-label="Change the bid: ${esc(cards[i].name)}">${face(cards[i])}</button></li>`
      : `<li><button type="button" class="u3-au-slot" data-auslot="1" aria-label="Add card">${icon('plus', { size: 'xl' })}<span>Add card</span></button></li>`)).join('');
    const best = a.best ? `<div class="u3-au-best"><div class="u3-au-best__head"><span class="u3-label">Best bid</span>${a.best.meets ? `<span class="u3-au-best__ok">${icon('circle-check', { size: 'sm' })}Meets minimum</span>` : ''}${a.best.mine ? chip({ label: 'You', kind: 'filter', interactive: false }) : ''}</div>`
      + `<div class="u3-au-best__row"><span class="u3-au-thumbs">${a.best.cards.map((x) => face(x, 'is-thumb')).join('')}</span><span class="u3-au-sum">${totals(a.best.cards)}</span></div></div>` : `<p class="u3-au-none">${AU.TEXT.noBids}</p>`;
    const body = `<section class="u3-au__main u3-au-bid" aria-label="Your bid">`
      + `<header class="u3-au-bid__head"><span class="u3-label">Your bid</span><span class="u3-au-bid__n">${cards.length} / ${AU.BID_MAX}</span>${stateHTML}</header>`
      + `<ul class="u3-au-bid__slots" id="auSlots">${slots}</ul>`
      + `<div class="u3-au-bid__note"><span class="u3-au-bid__rule">${gold ? AU.TEXT.goldBids : AU.TEXT.anyButGold}</span><span class="u3-au-bid__msg">${msgHTML()}</span></div>`
      + `<div class="u3-au-bid__acts">${my && !confirm ? button({ label: 'Withdraw', icon: 'undo-2', data: { auwithdraw: '1' } }) : ''}${button({ label: AU.bidLabel(my), variant: 'primary', icon: 'gavel', disabled: !AU.canPlace(a, cards), data: { auplace: '1' } })}</div></section>`
      + info(a, best);
    const root = page('u3-au--bid', body);
    const box = root.querySelector('#auSlots');
    // the slot size from the slots box; a page too short for slots of the card thumb size brings the info panel closer (is-tight, then is-tighter)
    watch(root, () => settle(root, (level) => {
      const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
      const f = listFit(box.clientWidth, box.clientHeight, gap, { n: AU.BID_MAX, min: TOKENS['card-mini'], ratio: TOKENS['card-ratio'] });
      box.style.setProperty('--au-tile', `${f.tile}px`);
      return box.clientHeight >= f.tile * TOKENS['card-ratio'] - 1 && f.tile >= (level < 2 ? TOKENS['card-thumb'] : TOKENS['card-mini']) && asideFits(root);
    }));
    if (confirm) confirmDialog(a, my);
  }
  async function openBidPicker(from) {
    const a = hall.auction, my = a.myBid;
    try { await ctx().refreshOwned(); } catch { /* keep */ }
    await ensureCatalog().catch(() => {});
    const cards = AU.bidCards(mine(), a, { held: hall.held, myBidCards: my?.cards || [], sellerWish: hall.sellerWish }).map((c) => ({ ...c, tags: c.tags || deps.tagsOf(c) }));
    const rarities = AU.bidRarities(a.card.rarity === 'gold').filter((r) => cards.some((c) => c.rarity === r));
    const byMark = new Map(cards.map((c) => [Number(c.id), c.mark]));
    openCardPicker({
      title: 'Your bid', icon: 'gavel', cap: AU.BID_MAX, cards, selected: hall.bid.map(Number), returnFocus: from,
      mark: (c) => (byMark.get(Number(c.id)) === 'wish' ? { icon: 'heart', label: "on the seller's wishlist" } : null),
      filters: [{ key: 'rarity', label: 'Rarity', value: 'all', clear: 'all', options: [{ id: 'all', label: 'All' }, ...rarities.map((id) => ({ id, label: R(id) }))] }],
      filterCount: listFilterCount, apply: applyListPick,
      status: (sel) => ({ checks: [{ ok: sel.length === AU.BID_MAX, label: `${sel.length} / ${AU.BID_MAX} cards` }, { ok: true, label: a.card.rarity === 'gold' ? AU.TEXT.goldBids : AU.TEXT.anyButGold }], ready: true }),
      detail: (c) => ctx().openViewer?.(c),
      onConfirm: async (sel) => { hall.bid = AU.setBid(sel); hall.msg = ''; deps.paintHall(); return true; },
    });
  }
  async function placeBid() {
    const a = hall.auction;
    const b = document.querySelector('[data-auplace]'); if (b) b.disabled = true;
    let r = null;
    try { r = await ctx().apiPost('/api/auction/bid', { auctionId: a.id, cards: hall.bid }); } catch (e) { r = e?.body || null; }
    if (r?.ok) { await deps.openAuction(a.id); hall.msg = AU.placedText(r.meets); hall.msgOk = true; deps.paintHall(); return; }
    hall.msg = r?.message || 'Could not place the bid.'; hall.msgOk = false; deps.paintHall();
  }
  // Withdraw: the bid goes now and the toast offers Undo (D-67, review-2): Undo places the same cards again with the same call.
  async function withdraw() {
    const a = hall.auction, prev = (a.myBid?.cards || []).map((c) => Number(c.id));
    let r = null;
    try { r = await ctx().apiPost('/api/auction/withdraw', { auctionId: a.id }); } catch (e) { r = e?.body || null; }
    await deps.openAuction(a.id);
    if (!r?.ok) { hall.msg = r?.message || 'Could not withdraw the bid.'; hall.msgOk = false; deps.paintHall(); return; }
    showToast(AU.TEXT.withdrawn, 'Undo', async () => {
      let u = null;
      try { u = await ctx().apiPost('/api/auction/bid', { auctionId: a.id, cards: prev }); } catch (e) { u = e?.body || null; }
      await deps.openAuction(a.id);
      if (!u?.ok) { hall.msg = u?.message || 'Could not place the bid.'; hall.msgOk = false; deps.paintHall(); }
    });
  }
  // The accepted bid: the bidder confirms or declines (two steps: the seller accepts, the bidder confirms).
  function confirmDialog(a, my) {
    const left = a.confirm_by ? AU.timeLeft(a.confirm_by).text : '';
    openDlg(`<div class="u3-dialog u3-au-dlg" role="dialog" aria-modal="true" aria-labelledby="u3AuDt" tabindex="-1">`
      + `<header class="u3-dialog__head"><h2 class="u3-dialog__title u3-au-dlg__title" id="u3AuDt">${icon('gavel', { size: 'xl' })}<span>${esc(a.seller)} accepted your bid</span></h2></header>`
      + stepsHTML(AU.bidderSteps(a.seller))
      + (left ? `<p class="u3-au-dlg__line">${icon('hourglass')}<span>${esc(AU.confirmDeadline(left))}</span></p>` : '')
      + `<div class="u3-au-deal"><div class="u3-au-deal__side"><span class="u3-label">Your offer</span><span class="u3-au-deal__cards">${(my.cards || []).map((x) => face(x, 'is-deal')).join('')}</span></div>`
      + `<span class="u3-au-deal__swap">${icon('arrow-left-right', { size: 'xl' })}</span><div class="u3-au-deal__side"><span class="u3-label">Their offer</span><span class="u3-au-deal__cards">${face(a.card, 'is-deal')}</span></div></div>`
      + `<div class="u3-au-dlg__msg">${msgHTML()}</div>`
      + `<footer class="u3-dialog__foot">${button({ label: 'Decline', variant: 'danger', icon: 'x', data: { audecline: '1' } })}${button({ label: 'Confirm', variant: 'primary', icon: 'check', data: { auconfirm: '1' } })}</footer></div>`, 'confirm');
  }
  function openDlg(inner, key) {
    closeDlg();
    const host = document.createElement('div');
    host.id = 'u3AuDlgHost'; dlgKey = key;
    host.innerHTML = `<div class="u3-scrim u3-au-scrim" data-u3-scrim>${inner}</div>`;
    (ctx().el('main')?.querySelector('.u3-au') || document.body).appendChild(host);   // inside the view: leaving the view takes the window with it
    host.addEventListener('click', onDlgClick);
    host.querySelector('.u3-dialog')?.focus({ preventScroll: true });
  }
  async function onDlgClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset, a = hall.auction;
    if (d.aucancel) { closeDlg(); return; }
    if (d.auconfirm) {
      b.disabled = true;
      let r = null;
      try { r = await ctx().apiPost('/api/auction/confirm', { auctionId: a.id }); } catch (x) { r = x?.body || null; }
      if (!r?.ok) { hall.msg = r?.message || 'Could not confirm.'; hall.msgOk = false; deps.paintHall(); return; }
      await ctx().refreshOwned();
      toast?.(`${a.card.name} is yours!`);
      closeDlg(); reset({ aview: 'mine' }); await deps.renderHall();
    } else if (d.audecline) {
      try { await ctx().apiPost('/api/auction/decline', { auctionId: a.id }); } catch { /* */ }
      await deps.openAuction(a.id);
    } else if (d.auclosego) {
      b.disabled = true;
      try { await ctx().apiPost('/api/auction/close', { auctionId: a.id }); } catch { /* */ }
      closeDlg(); reset(); await deps.renderHall();
    }
  }

  // ---- the seller view -------------------------------------------------------------------------------------
  function paintSeller(a) {
    const accepted = a.status === 'accepted';
    const { rows, bestId } = AU.sellerRows(a);
    const waitFor = accepted ? rows.find((b) => b.id === a.accepted_bid_id) : null;
    const ago = (iso) => ctx().ago?.(iso) || '';
    const row = (b) => {
      const isAcc = b.id === a.accepted_bid_id;
      const st = b.meets ? `<span class="u3-au-row__st is-meets">${icon('circle-check')}<span>Meets minimum</span></span>` : `<span class="u3-au-row__st is-below">${icon('circle-minus')}<span>Below minimum</span></span>`;
      return `<li class="u3-au-row${isAcc ? ' is-accepted' : ''}${b.id === bestId ? ' is-best' : ''}">`
        + `<div class="u3-au-row__who">${avatar(b.bidder_id, b.bidder)}<b class="u3-au-row__name">${esc(b.bidder)}</b><i>${esc(ago(b.at))}</i></div>`
        + `<div class="u3-au-row__body"><span class="u3-au-thumbs">${b.cards.map((x) => `<button type="button" class="u3-au-tinfo" data-autinfo="${x.id}" aria-label="Card details: ${esc(x.name)}">${face(x, 'is-thumb')}</button>`).join('')}</span><span class="u3-au-sum">${totals(b.cards)}</span></div>`
        + `<div class="u3-au-row__flag">${b.id === bestId ? `<span class="u3-au-row__best">${icon('crown', { size: 'sm' })}<span>Best</span></span>` : ''}${st}</div>`
        + `<div class="u3-au-row__act">${isAcc ? `<span class="u3-au-row__wait">${icon('hourglass')}<span>${esc(AU.waitText(b.bidder, a.confirm_by ? AU.timeLeft(a.confirm_by).text : ''))}</span></span>`
          : button({ label: 'Accept', variant: b.meets ? 'primary' : 'secondary', icon: 'check', disabled: accepted || a.status !== 'live', data: { auaccept: b.id } })}</div></li>`;
    };
    const extra = `<div class="u3-au-info__foot">${stepsHTML(AU.steps(a, waitFor?.bidder))}<div class="u3-au-info__acts">${button({ label: 'Close early', variant: 'danger', icon: 'x', disabled: !(a.status === 'live' || accepted), data: { auclose: '1' } })}</div></div>`;
    const body = `<section class="u3-au__main u3-au-seller" aria-label="Bids"><header class="u3-au-seller__head"><span class="u3-label">Bids</span><span class="u3-au-bid__n">${rows.length}</span></header>`
      + `<ul class="u3-au-rows" id="auRows">${rows.map(row).join('') || `<li class="u3-au-none">${AU.TEXT.noBids}</li>`}</ul>`
      + `<div class="u3-au-seller__msg">${msgHTML()}</div><div class="u3-au-seller__pager" id="auPager"></div></section>` + info(a, extra);
    const root = page('u3-au--seller', body);
    const box = root.querySelector('#auRows'), pg = root.querySelector('#auPager'), items = [...box.children].filter((x) => x.classList.contains('u3-au-row'));
    // the bids the box holds (a page of them with the pager when they do not all fit: no scroll); the info panel closes up first when not even two fit
    const paint = (per) => {
      hall.bpage = clampPage(hall.bpage | 0, pagesOf(items.length, per));
      items.forEach((x, i) => { x.hidden = i < hall.bpage * per || i >= hall.bpage * per + per; });
      const pages = pagesOf(items.length, per);
      pg.innerHTML = pages > 1 ? pager({ page: hall.bpage + 1, pages }) : '';
    };
    const rawOf = () => {
      items.forEach((x) => { x.hidden = false; });
      if (!items.length) return 1;
      const gap = parseFloat(getComputedStyle(box).rowGap) || 0, rh = Math.max(...items.map((x) => x.getBoundingClientRect().height));
      return Math.floor((box.clientHeight + gap) / (rh + gap));   // 0 = not even one bid fits
    };
    const perOf = () => Math.max(1, rawOf());
    const main = root.querySelector('.u3-au-seller');
    watch(root, () => settle(root, () => {
      pg.innerHTML = '';
      let raw = rawOf();
      if (items.length > Math.max(1, raw)) { pg.innerHTML = pager({ page: 1, pages: 2 }); raw = rawOf(); }
      paint(Math.max(1, raw));
      return raw >= Math.min(2, items.length) && box.scrollHeight <= box.clientHeight + 1 && main.scrollHeight <= main.clientHeight + 1 && asideFits(root);
    }));
    pg.onclick = (e) => { const b = e.target.closest('button[data-page]'); if (!b || b.disabled) return; hall.bpage = (hall.bpage | 0) + (b.dataset.page === 'next' ? 1 : -1); root.dispatchEvent(new Event('au-relayout')); };
    root.addEventListener('au-relayout', () => { const per = perOf(); paint(per); });
  }
  function closeConfirm() {
    openDlg(`<div class="u3-dialog u3-au-dlg" role="dialog" aria-modal="true" aria-labelledby="u3AuDt" tabindex="-1"><header class="u3-dialog__head"><div><h2 class="u3-dialog__title" id="u3AuDt">${AU.TEXT.closeTitle}</h2>`
      + `<p class="u3-dialog__line">${AU.TEXT.closeLine}</p></div></header><footer class="u3-dialog__foot">${button({ label: 'Cancel', data: { aucancel: '1' } })}${button({ label: AU.TEXT.closeTitle, variant: 'danger', icon: 'x', data: { auclosego: '1' } })}</footer></div>`, 'close');
  }
  async function accept(id, b) {
    const a = hall.auction;
    if (b) b.disabled = true;
    let r = null;
    try { r = await ctx().apiPost('/api/auction/accept', { bidId: Number(id) }); } catch (e) { r = e?.body || null; }
    const msg = r?.ok ? AU.TEXT.accepted : (r?.message || 'Could not accept.');
    await deps.openAuction(a.id);
    hall.msg = msg; hall.msgOk = !!r?.ok; deps.paintHall();
  }

  // ---- the clicks of the start, seller and bidder views ----------------------------------------------------------
  async function onClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.auback) await back();
    else if (b.classList.contains('u3-step__btn')) onStep(b);
    else if (d.seg && hall.start) { hall.start = { ...hall.start, mode: d.seg === 'or' ? 'or' : 'and' }; deps.paintHall(); }
    else if (d.aupickcard) await openStartPicker(b);
    else if (d.auunask) { hall.start = AU.removeAsk(hall.start, d.auunask); deps.paintHall(); }
    else if (d.austart) await startNow();
    else if (d.auslot) { if (hall.auction.status !== 'live') { hall.msg = AU.closedText(hall.auction); hall.msgOk = false; deps.paintHall(); } else await openBidPicker(b); }
    else if (d.auplace) await placeBid();
    else if (d.auwithdraw) await withdraw();
    else if (d.auview) detail(hall.auction.card);
    else if (d.autinfo) { const c = lookup(d.autinfo) || hall.auction.bids?.flatMap((x) => x.cards).find((x) => Number(x.id) === Number(d.autinfo)); if (c) detail(c); }
    else if (d.auaccept) await accept(d.auaccept, b);
    else if (d.auclose) closeConfirm();
    else if (d.auinfo) { hall.infoOpen = !hall.infoOpen; b.closest('.u3-au')?.classList.toggle('is-info-open', hall.infoOpen); b.setAttribute('aria-expanded', String(hall.infoOpen)); const body = b.closest('.u3-au')?.querySelector('.u3-au-info__body'); if (body && b.closest('.u3-au')?.classList.contains('is-sheet')) body.hidden = !hall.infoOpen; }
  }

  return { list, fill, paintStart, paintAuction, closeToast, closeDlg, stop };
}
