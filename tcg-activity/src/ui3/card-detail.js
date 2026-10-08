// UI-08 Card Detail window (v3, only under body.ui-v3): it replaces the card panel beside the grid (D-38). It opens only
// on a tap on a card: a centered dialog on medium and expanded, a full sheet on compact-port and compact-land.
// Approved design: lion-pride-tcg-design UI-08/approved (review-1), with its conditions: the rarity chip "Normal"
// (sentence case, the label style makes no capitals here), "Convert 2 extras", the effect kind "neutral" shown as
// "Shield" (10.1). Sections (G-100): art, name block, stats, lore, tags, actions | ability, effect, ascension, stat points.
import { icon } from './icons.js';
import { esc, iconButton, button } from './components.js';

// ---- Pure logic (tested in card-detail.test.js) ------------------------------------------------------------------

/** The effect kind label (10.1: boon, prank, shield; "neutral" is the old name of shield). */
export const KIND = { boon: 'Boon', prank: 'Prank', neutral: 'Shield', shield: 'Shield' };
export const kindLabel = (k) => KIND[k] || 'Effect';
export const kindClass = (k) => (k === 'neutral' ? 'shield' : k);

/** "1 copy", "3 copies", or the not-owned line. */
export const copiesLine = (c) => (c.locked ? 'Not in your collection yet' : `${c.quantity} ${c.quantity === 1 ? 'copy' : 'copies'}`);

/** The ascension line: null (no section), { text } (a fact), or { have, need, pct } (the copies bar). */
export function ascensionOf(c, { on = true, noAscendText = 'Event cards do not ascend.' } = {}) {
  if (c.locked || !on) return null;
  const a = c.ascension || 0;
  if (a >= 5) return { text: '★5 max' };
  if (c.next_cost == null) return { text: noAscendText };
  const extra = Math.max(0, (c.quantity || 0) - 1);
  const need = c.next_cost;
  return { have: Math.min(extra, need), need, pct: need ? Math.min(100, Math.round((100 * extra) / need)) : 0 };
}

/** The Ascend button text, or null when the card cannot ascend now. */
export const ascendLabel = (c, on = true) => (!c.locked && on && (c.ascension || 0) < 5 && c.can_ascend ? `Ascend to ★${(c.ascension || 0) + 1} · uses ${c.next_cost}` : null);

/** The stats that do something for this card (the v2 rule): attackers fight; effects and supports cast. */
export function statKeys(c) {
  const keys = [];
  if (['Character', 'Creature'].includes(c.type)) keys.push('attack', 'vitality', 'precision');
  if (c.effect || c.ability?.kind === 'support') keys.push('potency');
  if (c.effect) keys.push('haste');
  return keys;
}
export const STAT_DEFS = [['attack', 'Attack'], ['vitality', 'Vitality'], ['precision', 'Precision'], ['potency', 'Potency'], ['haste', 'Haste']];
/** The free points after the picks that are not saved yet. */
export const freeLeft = (sp, add) => (sp?.free || 0) - Object.values(add || {}).reduce((t, n) => t + n, 0);

/** The tag chips: the element first (with its icon), then type, class, game, genre and traits (no element twice). */
export function tagList(c, { elementOf, gameLabels }) {
  const t = c.tags || {};
  const el = elementOf(c);
  const out = el ? [{ el }] : [];
  for (const f of ['type', 'class', 'origin', 'genre', 'traits']) {
    let vals = Array.isArray(t[f]) ? t[f] : (t[f] ? [t[f]] : []);
    if (f === 'traits' && el) vals = vals.filter((v) => String(v).toLowerCase() !== el);
    if (f === 'origin') vals = vals.map((v) => gameLabels[v] || v);
    for (const v of vals) { const s = String(v).split(':').pop(); out.push({ text: s.charAt(0).toUpperCase() + s.slice(1) }); }
  }
  return out;
}

// ---- The window --------------------------------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
let st = null;   // { c, list, d, pts: { add, open }, opener }

const cap = (s) => String(s || '').toUpperCase();
function statBox(value, label, pct, tone) {
  return `<div class="u3-cdw__stat"><b class="u3-cdw__statv">${esc(value)}</b><span class="u3-cdw__statl">${esc(label)}</span>`
    + `<span class="u3-cdw__statbar u3-cdw__statbar--${tone}" style="--u3-v:${pct}%"></span></div>`;
}

function headHTML(c, d) {
  const a = c.ascension || 0;
  const stars = Array.from({ length: 5 }, (_, i) => icon('star', { size: 'sm', cls: i < a ? 'is-on' : '' })).join('');
  return `<div class="u3-cdw__id">
      <span class="u3-cdw__num">${esc(d.numLabel(c))} · ${esc(cap(c.season || 'Season 1'))}</span>
      <h2 class="u3-cdw__name" id="u3CdwT">${esc(c.name)}</h2>
      <span class="u3-chip u3-chip--md u3-chip--rarity u3-r-${esc(c.rarity)}"><span class="u3-chip__mark" aria-hidden="true"></span><span>${esc(d.rarityLabel[c.rarity] || c.rarity)}</span></span>
      <span class="u3-cdw__own"><span class="u3-cdw__stars" role="img" aria-label="${a} of 5 stars">${stars}</span><span>${esc(copiesLine(c))}</span></span>
    </div>`;
}

function statsHTML(c, d) {
  const sp = !c.locked && d.statsOn() ? c.stat : null;
  const power = sp ? sp.cp : (c.power || 0);
  const hp = sp ? sp.hp : d.cardHp(power);
  const crit = 10 + Math.round((sp?.crit || 0) * 100);
  const pct = (v, m) => Math.min(100, Math.round((100 * v) / (m || 1)));
  return `<div class="u3-cdw__stats">${statBox(power, 'Power', pct(power, d.maxPow), 'power')}${statBox(hp, 'HP', pct(hp, d.cardHp(d.maxPow)), 'hp')}${statBox(`${crit}%`, 'Crit', pct(crit, 60), 'crit')}</div>`;
}

function tagsHTML(c, d) {
  const tags = tagList(c, { elementOf: d.elementOf, gameLabels: d.gameLabels });
  if (!tags.length) return '';
  return `<div class="u3-cdw__tags">${tags.map((t) => (t.el
    ? `<span class="u3-cdw__tag u3-cdw__tag--el">${d.elIcon(t.el)}<span>${esc(d.elementName(t.el))}</span></span>`
    : `<span class="u3-cdw__tag">${esc(t.text)}</span>`)).join('')}</div>`;
}

function actionsHTML(c, d) {
  const asc = ascendLabel(c, d.features().ascension);
  const inSpot = d.spotlight().includes(Number(c.id));
  const convert = c.locked ? '' : '<button type="button" class="u3-btn u3-btn--md u3-cdw__convert hidden" id="pConvert"></button>';
  const ascend = asc ? button({ label: asc, variant: 'primary', data: { cdw: 'ascend' } }) : '';
  const spot = c.locked ? '' : iconButton({ icon: 'star', label: inSpot ? 'Remove from Spotlight' : 'Add to Spotlight', variant: 'panel', data: { cdw: 'spot' } });
  const trade = iconButton({ icon: 'arrow-left-right', label: 'Trade', variant: 'panel', data: { cdw: 'trade' } });
  return `<div class="u3-cdw__acts${inSpot ? ' is-spot' : ''}">${convert}${ascend}${spot}${trade}</div>`;
}

function abilityHTML(c) {
  const ab = c.ability;
  if (!ab?.name) return '';
  return `<section class="u3-cdw__box"><header class="u3-cdw__boxhead"><b>${esc(ab.name)}</b><span class="u3-label">${esc(['Ability', ab.kind].filter(Boolean).join(' · '))}</span></header>`
    + `<p class="u3-cdw__desc">${esc(ab.desc || '')}</p></section>`;
}

function ascHTML(c, d) {
  const a = ascensionOf(c, { on: d.features().ascension, noAscendText: d.noAscendText });
  if (!a) return '';
  return `<section class="u3-cdw__asc"><header class="u3-cdw__rowhead"><span class="u3-label">Ascension</span>`
    + `<span class="u3-cdw__mono">${a.text ? esc(a.text) : `${a.have} / ${a.need} copies`}</span></header>`
    + `${a.text ? '' : `<span class="u3-cdw__bar" style="--u3-v:${a.pct}%"></span>`}</section>`;
}

function pointsHTML(c, d) {
  const sp = !c.locked && d.statsOn() ? c.stat : null;
  const keys = sp ? statKeys(c) : [];
  if (!keys.length) return '';
  const pts = sp.points || {};
  const left = freeLeft(sp, st.pts.add);
  const spent = Object.values(pts).reduce((t, n) => t + (Number(n) || 0), 0);
  const picked = Object.values(st.pts.add).some(Boolean);
  const canReset = spent > 0 && !picked && !d.statsResetUsed();
  if (!st.pts.open) {
    const chips = STAT_DEFS.filter(([k]) => keys.includes(k) && Number(pts[k])).map(([k, l]) => `<span class="u3-cdw__tag">${l} ${Number(pts[k])}</span>`).join('');
    const btn = left > 0 ? button({ label: 'Assign', variant: 'primary', size: 'sm', data: { cdw: 'pts-open' } })
      : canReset ? button({ label: 'Edit', variant: 'secondary', size: 'sm', data: { cdw: 'pts-open' } }) : '';
    return `<section class="u3-cdw__pts"><header class="u3-cdw__rowhead"><span class="u3-label">Stat points</span><span class="u3-cdw__mono${left > 0 ? ' is-free' : ''}">${left} free</span></header>`
      + `${chips || btn ? `<div class="u3-cdw__tags">${chips}${btn}</div>` : ''}</section>`;
  }
  const rows = STAT_DEFS.filter(([k]) => keys.includes(k)).map(([k, l]) => `<div class="u3-cdw__ptrow"><span>${l}</span>`
    + `<b class="u3-cdw__ptv">${Number(pts[k]) || 0}${st.pts.add[k] ? `<i>+${st.pts.add[k]}</i>` : ''}</b>`
    + `<button type="button" class="u3-btn u3-btn--primary u3-btn--md u3-cdw__ptadd" data-add="${k}" aria-label="Add a point to ${l}"${left > 0 ? '' : ' disabled'}>${icon('plus', { size: 'lg' })}</button></div>`).join('');
  return `<section class="u3-cdw__editor" aria-label="Stat points"><header class="u3-cdw__rowhead"><span class="u3-label">Stat points</span>`
    + `<span class="u3-cdw__mono is-free">${left} free</span>${iconButton({ icon: 'x', label: 'Close the stat points', variant: 'panel', data: { cdw: 'pts-close' } })}</header>`
    + `<div class="u3-cdw__ptrows">${rows}</div><div class="u3-cdw__ptacts">`
    + `${picked ? `${button({ label: 'Save', variant: 'primary', data: { cdw: 'pts-save' } })}${button({ label: 'Undo', variant: 'secondary', data: { cdw: 'pts-undo' } })}` : ''}`
    + `${canReset ? button({ label: 'Reset', variant: 'ghost', data: { cdw: 'pts-reset' } }) : ''}</div><p class="u3-cdw__err" id="u3CdwErr" role="alert"></p></section>`;
}

function windowHTML() {
  const { c, d } = st;
  const art = !c.locked && c.image_url
    ? `<button type="button" class="u3-cdw__art u3-r-${esc(c.rarity)}" data-cdw="art" aria-label="Open ${esc(c.name)} in 3D"><img src="${esc(c.image_url)}" alt="">${d.flair(c.ascension)}</button>`
    : `<div class="u3-cdw__art is-locked" role="img" aria-label="Not owned">${icon('lock', { size: 'xl' })}</div>`;
  const editing = st.pts.open;
  const asc = !!ascendLabel(c, d.features().ascension);
  return `<div class="u3-cdw${editing ? ' is-editing' : ''}${asc ? ' has-ascend' : ''}${c.locked ? ' is-locked' : ''}" role="dialog" aria-modal="true" aria-labelledby="u3CdwT">
    ${iconButton({ icon: 'x', label: 'Close', variant: 'panel', data: { cdw: 'close' } }).replace('class="u3-ibtn', 'class="u3-cdw__close u3-ibtn')}
    ${art}${headHTML(c, d)}
    ${statsHTML(c, d)}
    ${c.lore ? `<p class="u3-cdw__lore">“${esc(c.lore)}”</p>` : ''}
    ${tagsHTML(c, d)}${actionsHTML(c, d)}
    ${editing ? `<div class="u3-cdw__r u3-cdw__r--edit">${pointsHTML(c, d)}</div>`
    : `<div class="u3-cdw__r">${abilityHTML(c)}<section class="u3-cdw__box u3-cdw__fx hidden" id="u3CdwFx"></section>${ascHTML(c, d)}${pointsHTML(c, d)}</div>`}
  </div>`;
}

async function paintEffect() {
  const { c, d } = st;
  const box = $('u3CdwFx');
  if (!box || !d.effects.enabled()) return;
  const seq = st.seq;
  const full = await d.effects.of(c);
  if (!st || seq !== st.seq || !box.isConnected || !full?.effect?.primitive) return;
  const e = full.effect;
  const s = d.effects.scaled(full);
  const meta = [];
  if (s.amount != null) meta.push(`Power ${s.amount}`);
  if (s.dur) meta.push(`Lasts ${d.effects.fmtDur(s.dur)}`);
  meta.push(`Cooldown ${d.effects.fmtDur(s.cooldownH * 3600)}`);
  const wait = d.effects.readyIn(full);
  let btn = '';
  if (!c.locked) {
    if (!s.enabled) btn = button({ label: 'Unlocks soon', variant: 'primary', disabled: true });
    else if (wait > 0) btn = button({ label: `Ready in ${d.effects.fmtDur(wait)}`, variant: 'primary', disabled: true });
    else btn = button({ label: 'Play on a member', variant: 'primary', data: { cdw: 'play' } });
  }
  const k = kindClass(s.kind);
  box.className = `u3-cdw__box u3-cdw__fx u3-fx-${esc(k)}`;
  box.innerHTML = `<header class="u3-cdw__fxhead"><span class="u3-cdw__kind">${k === 'shield' ? icon('shield', { size: 'sm' }) : ''}<span>${esc(kindLabel(s.kind))}</span></span>`
    + `<b class="u3-cdw__fxname">${esc(e.name || e.primitive)}</b></header>${btn ? `<span class="u3-cdw__play">${btn}</span>` : ''}`
    + `<p class="u3-cdw__desc">${esc(e.desc || '')}</p><p class="u3-cdw__meta">${esc(meta.join(' · '))}</p>`;
  box.querySelector('[data-cdw="play"]')?.addEventListener('click', () => { const card = full; close(); d.effects.play(card); });
  fit();
}

function paint() {
  const host = $('u3Cdw');
  if (!host || !st) return;
  st.seq = (st.seq || 0) + 1;
  host.innerHTML = windowHTML();
  const { c, d } = st;
  if (!c.locked && !st.pts.open) d.fillConvert(c, async () => { await d.refresh(); reopen(); });
  paintEffect();
  fit();
}

// 3.3: the window never scrolls. When it is too tall, the lore goes to one line, then the tags to one row.
function fit() {
  const w = document.querySelector('#u3Cdw .u3-cdw');
  if (!w) return;
  w.classList.remove('is-tight', 'is-tighter');
  const over = () => w.scrollHeight > w.clientHeight + 1;
  if (over()) w.classList.add('is-tight');
  if (over()) w.classList.add('is-tighter');
}

/** Open the Card Detail for a card. d = the data and the actions of the caller (ui-v2.js). list = the grid order. */
export function openCardDetail(c, list, d) {
  const same = st && st.c?.id === c.id;
  st = { c, list: list || [], d, pts: same ? st.pts : { add: {}, open: false }, opener: st?.opener || document.activeElement, seq: 0 };
  let host = $('u3Cdw');
  if (!host) {
    host = document.createElement('div');
    host.id = 'u3Cdw'; host.className = 'u3-cdwhost';
    // First in <body>: the windows that open from it (the 3D viewer, Convert, the member picker) share the modal
    // layer (ui3.css) and come later in the page, so they show above it.
    document.body.prepend(host);
    host.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
    d.onSwipe?.(host, (dir) => step(dir));
  }
  paint();
  host.querySelector('.u3-cdw__close')?.focus();
}

/** Paint the open card again with fresh data (after an ascend, a save, a convert). */
function reopen() {
  if (!st) return;
  const fresh = st.d.cardById(st.c.id) || st.c;
  st.c = fresh;
  paint();
}

function step(dir) {
  if (!st || st.pts.open) return;
  const i = st.list.findIndex((x) => String(x.id) === String(st.c.id));
  const n = i < 0 ? null : st.list[i + dir];
  if (!n) return;
  st.c = n; st.pts = { add: {}, open: false };
  paint();
  st.d.onStep?.(n, i + dir);
}

export function close() {
  const host = $('u3Cdw');
  if (!host) return;
  document.removeEventListener('keydown', onKey, true);
  host.remove();
  const opener = st?.opener;
  st = null;
  if (opener?.isConnected) opener.focus();
}

async function post(path, body, btn, busyLabel) {
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); const l = btn.querySelector('.u3-btn__label'); if (l && busyLabel) l.textContent = busyLabel; }
  let r = null;
  try { r = await st.d.apiPost(path, body); } catch { r = null; }
  return r;
}

async function onClick(e) {
  if (!st) return;
  const host = e.currentTarget;
  if (e.target === host) { close(); return; }
  const add = e.target.closest('[data-add]');
  if (add && !add.disabled) { st.pts.add[add.dataset.add] = (st.pts.add[add.dataset.add] || 0) + 1; paint(); return; }
  const b = e.target.closest('[data-cdw]');
  if (!b || b.disabled) return;
  const { c, d } = st;
  const k = b.dataset.cdw;
  if (k === 'close') close();
  else if (k === 'art') d.openViewer(c, st.list);
  else if (k === 'trade') { close(); d.onTrade(c); }
  else if (k === 'spot') { const r = await d.toggleSpotlight(c); if (r && st) paint(); }
  else if (k === 'ascend') {
    const r = await post('/api/ascend', { cardId: c.id }, b, 'Ascending…');
    if (!st) return;
    if (!r?.ok) { b.disabled = false; b.removeAttribute('aria-busy'); const l = b.querySelector('.u3-btn__label'); if (l) l.textContent = 'Could not ascend'; if (r?.error && d.ascendError[r.error]) d.toast(d.ascendError[r.error]); return; }
    d.celebrate(c, r, statKeys(c).length > 0);
    await d.refresh(); reopen();
  } else if (k === 'pts-open') { st.pts.open = true; paint(); }
  else if (k === 'pts-close') { st.pts = { add: {}, open: false }; paint(); }
  else if (k === 'pts-undo') { st.pts.add = {}; paint(); }
  else if (k === 'pts-save' || k === 'pts-reset') {
    const r = await post(k === 'pts-save' ? '/api/stats/spend' : '/api/stats/reset', k === 'pts-save' ? { cardId: c.id, add: st.pts.add } : { cardId: c.id }, b, k === 'pts-save' ? 'Saving…' : 'Resetting…');
    if (!st) return;
    if (!r?.ok) {
      b.disabled = false; b.removeAttribute('aria-busy');
      const l = b.querySelector('.u3-btn__label'); if (l) l.textContent = k === 'pts-save' ? 'Save' : 'Reset';
      const err = $('u3CdwErr'); if (err) err.textContent = r?.error === 'reset_used' ? 'The free reset is used. It returns next week.' : 'Something went wrong. Try again.';
      return;
    }
    st.pts = { add: {}, open: false };
    await d.refresh(); reopen();
  }
}

// 6.2: Escape closes (the stat editor first); the focus stays in the window. The arrow keys step through the cards.
function onKey(e) {
  const host = $('u3Cdw');
  if (!host || !st) return;
  if (document.querySelector('.sh-modal:not(.hidden), #viewer:not(.hidden), #effectPick')) return;   // a window above it has the keys
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (st.pts.open) { st.pts = { add: {}, open: false }; paint(); } else close(); return; }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest('input, textarea')) { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); return; }
  if (e.key !== 'Tab') return;
  const f = [...host.querySelectorAll('button:not([disabled]):not(.hidden)')];
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } else if (i < 0) { e.preventDefault(); f[0].focus(); }
}

/** A size change re-fits the open window (2.1: the window stays open). */
export function refitCardDetail() { if (st) fit(); }
