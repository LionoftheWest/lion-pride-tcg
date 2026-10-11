// UI-08 the Card Detail window, v3 (lion-pride-tcg-design UI-08/approved, review-1; D-38, D-46, D-80 item 11). Only under body.ui-v3:
// ui-v2.js paints this HTML in place of the v2 side panel (#colPanel) and keeps all of its logic (ascend, convert, spotlight, stat points,
// the effect section). The element ids of the v2 panel stay (#pArt #pAscend #pConvert #pSpot #pTrade #pPts #ptsOpen #ptsDone #ptsSave #ptsUndo
// #ptsReset #colEffect), so the handlers do not change. The window is a dialog on medium and expanded (two columns), a full sheet on compact.
// CSS: public/ui3/90-ui-08.css. A tap on the art opens the 3D viewer (UI-09).
import { esc, inlineMessage } from './components.js';
import { icon } from './icons.js';

/** An IconButton with an id (the v2 handlers find it by id). */
const ibtn = (id, ic, label, cls = '') => `<button type="button" id="${id}" class="u3-ibtn u3-ibtn--md u3-ibtn--panel${cls ? ' ' + cls : ''}" aria-label="${esc(label)}">${icon(ic, { size: 'lg' })}</button>`;

const pct = (v, max) => Math.max(0, Math.min(100, Math.round((100 * v) / (max || 1))));

/** One stat box with its bar: label, shown value, share of the maximum, bar color token. */
export const statHTML = (label, value, share, color) => `<div class="u3-det__stat"><b>${esc(value)}</b><span>${esc(label)}</span>`
  + `<i class="u3-det__bar"><i style="width:${share}%;background:var(${color})"></i></i></div>`;

/** The tag chips: the element first (icon, gold edge), then the facets. tags = [{ label, ico }] with ico = inline SVG of the element. */
export const tagsHTML = (tags) => tags.map((t, i) => `<span class="u3-chip u3-chip--filter u3-chip--md${t.ico ? ' is-on' : ''}" data-i="${i}">${t.ico || ''}<span>${esc(t.label)}</span></span>`).join('');

/** The stars line: n filled of 5 (1 owned star = the flair level), then the copies text. */
export const starsHTML = (a, text) => `<span class="u3-det__stars" aria-label="${a} of 5 stars">${[0, 1, 2, 3, 4].map((i) => icon('star', { size: 'lg', cls: i < a ? 'is-on' : '' })).join('')}</span><span class="u3-det__own">${esc(text)}</span>`;

/** The ability box: name, "Ability · kind", description. */
export const abilityHTML = (ab) => (ab && ab.name
  ? `<section class="u3-det__box"><div class="u3-det__boxhead"><b>${esc(ab.name)}</b><span class="u3-label">${esc(['Ability', ab.kind].filter(Boolean).join(' · '))}</span></div><p>${esc(ab.desc || '')}</p></section>` : '');

/** The Ascension block: head, a note or "n / m copies" with the bar. m = { text } (no bar) or { have, need }. */
export const ascensionHTML = (m) => (!m ? '' : m.text
  ? `<section class="u3-det__asc"><div class="u3-det__boxhead"><span class="u3-label">Ascension</span><span>${esc(m.text)}</span></div></section>`
  : `<section class="u3-det__asc"><div class="u3-det__boxhead"><span class="u3-label">Ascension</span><span class="u3-det__mono">${m.have} / ${m.need} copies</span></div>`
    + `<i class="u3-det__bar u3-det__bar--lg"><i style="width:${pct(m.have, m.need)}%;background:var(--gold)"></i></i></section>`);

/**
 * The stat points block. p = { keys: [[key, label]], pts, add, free, picked, canReset, open }.
 * Closed (summary): the label, the points spent per stat, "n free" and Assign (free points) or Edit (a reset is left).
 * Open (the editor): the rows with + buttons, Save and Undo (picked points), Reset, and the close button.
 */
export function pointsHTML(p) {
  const left = p.free - p.picked;
  if (!p.open) {
    const sum = p.keys.filter(([k]) => Number(p.pts[k])).map(([k, label]) => `<span class="u3-chip u3-chip--filter u3-chip--sm">${esc(label)} ${Number(p.pts[k])}</span>`).join('');
    const btn = left > 0 ? `<button type="button" class="u3-btn u3-btn--primary u3-btn--md" id="ptsOpen" data-n="${left}"><span class="u3-btn__label">Assign</span></button>`
      : p.canReset ? '<button type="button" class="u3-btn u3-btn--secondary u3-btn--md" id="ptsOpen"><span class="u3-btn__label">Edit</span></button>' : '';
    return `<section class="u3-det__pts is-closed" id="pPts"><span class="u3-label">Stat points</span><span class="u3-det__sum">${sum}</span><span class="u3-det__free">${left} free</span>${btn}</section>`;
  }
  const rows = p.keys.map(([k, label]) => `<div class="u3-det__row"><span>${esc(label)}</span><b>${Number(p.pts[k]) || 0}${p.add[k] ? `<i>+${p.add[k]}</i>` : ''}</b>`
    + `<button type="button" class="u3-btn u3-btn--primary u3-det__plus" data-add="${k}" aria-label="Add a point to ${esc(label)}"${left > 0 ? '' : ' disabled'}>${icon('plus', { size: 'lg' })}</button></div>`).join('');
  const acts = (p.picked || p.canReset) ? `<div class="u3-det__acts2">${p.picked ? '<button type="button" class="u3-btn u3-btn--primary u3-btn--md" id="ptsSave"><span class="u3-btn__label">Save</span></button>'
    + '<button type="button" class="u3-btn u3-btn--secondary u3-btn--md" id="ptsUndo"><span class="u3-btn__label">Undo</span></button>' : ''}`
    + `${p.canReset ? '<button type="button" class="u3-btn u3-btn--ghost u3-btn--md" id="ptsReset"><span class="u3-btn__label">Reset</span></button>' : ''}</div>` : '';
  return `<section class="u3-det__pts is-open" id="pPts"><div class="u3-det__ptshead"><span class="u3-label">Stat points</span><span class="u3-det__free">${left} free</span>`
    + `${ibtn('ptsDone', 'x', 'Close stat points')}</div><div class="u3-det__rows">${rows}</div>${acts}</section>`;
}

/**
 * The window's inside. d = { c, num, season, name, rarity, rarityLabel, locked, art, a, own, stats: [html], lore, tags, ability, asc, points,
 * canAsc, ascLabel, convert, inSpot, effect }. The window is the dialog or the sheet by its class (CSS).
 */
export function detailHTML(d) {
  const art = `<div class="u3-det__art u3-r-${d.rarity}${d.locked ? ' is-locked' : ''}" id="pArt">${d.locked ? icon('lock', { size: '2xl' }) : `${d.art}`}</div>`;
  const id = `<div class="u3-det__id"><span class="u3-det__num">${esc(d.num)} · ${esc(d.season).toUpperCase()}</span><h2 class="u3-det__name" id="u3DetName">${esc(d.name)}</h2>`
    + `<span class="u3-chip u3-chip--rarity u3-chip--md u3-r-${d.rarity}">${icon('gem', { size: 'sm' })}<span>${esc(d.rarityLabel)}</span></span>`
    + `<div class="u3-det__ownrow">${starsHTML(d.a, d.own)}</div></div>`;
  const acts = [
    d.locked ? '' : '<button type="button" class="u3-btn u3-btn--secondary u3-btn--md sh-convert hidden" id="pConvert"></button>',
    d.canAsc ? `<button type="button" class="u3-btn u3-btn--primary u3-btn--md u3-det__asc-btn" id="pAscend"><span class="u3-btn__label">${esc(d.ascLabel)}</span></button>` : '',
    d.locked ? '' : ibtn('pSpot', 'star', d.inSpot ? 'Remove from Spotlight' : 'Add to Spotlight', d.inSpot ? 'is-on' : ''),
    ibtn('pTrade', 'arrow-left-right', 'Trade'),
  ].join('');
  const main = `<div class="u3-det__main"><div class="u3-det__top">${art}${id}</div>`
    + `<div class="u3-det__stats">${d.stats.join('')}</div>${d.lore ? `<p class="u3-det__lore">“${esc(d.lore)}”</p>` : ''}`
    + `<div class="u3-det__tags" id="pTags">${tagsHTML(d.tags)}</div><div class="u3-det__acts">${acts}</div></div>`;
  const side = `<div class="u3-det__side">${d.points && d.points.includes('is-open') ? d.points : `${abilityHTML(d.ability)}<div class="u3-det__fx hidden" id="colEffect"></div>${ascensionHTML(d.asc)}${d.points || ''}`}</div>`;
  return `${ibtn('pClose', 'x', 'Close', 'u3-det__x')}${main}${side}`;
}

/** The Shield kind of an effect box (W7, 10.1): the section head names the kind (Boon, Prank, Shield) with a line icon, no "Neutral". */
export function styleEffect(box) {
  const head = box?.querySelector('.v-sec-head');
  if (!head) return;
  const t = head.textContent.trim().replace(/^\S+\s+/, '');   // the emoji out, the kind word stays
  const kind = /neutral|shield/i.test(t) ? 'shield' : /prank/i.test(t) ? 'prank' : /boon/i.test(t) ? 'boon' : 'effect';
  box.dataset.kind = kind;
  const ic = { shield: 'shield', boon: 'gift', prank: 'party-popper' }[kind];
  head.innerHTML = `${ic ? icon(ic, { size: 'lg' }) : ''}<span>${kind === 'shield' ? 'Shield' : esc(t)}</span>`;
}

/** The fail message block (UI-10): kept for ui-v2.js. */
export const failHTML = (text) => inlineMessage({ kind: 'error', text });
