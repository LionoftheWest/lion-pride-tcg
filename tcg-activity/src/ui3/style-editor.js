// UI-15 Profile style editor (title, frame) and Spotlight editor, v3: design repo UI-15/approved (review-1), only under
// body.ui-v3 (settings.ui_v3). D-80 item 16: the Spotlight grid moved into the Card picker (UI-64, card-picker.js), so
// this window holds the slots, the title, the frame and Save; a tap on a slot opens the picker (pick 3, numbered).
// ui-v2.js openSpotEditor() keeps the data and the save (POST /api/spotlight and /api/cosmetics, as v2).
import { esc, button, iconButton, chip, inlineMessage } from './components.js';
import { icon } from './icons.js';
import { thumb } from '../thumb.js';

export const SPOT_CAP = 3;

/** The slot row: the picked cards in order, then the empty slots with their number (E15: an empty slot keeps its size). */
export function slotsHTML(cards) {
  return `<ol class="u3-se-slots" aria-label="Spotlight">${Array.from({ length: SPOT_CAP }, (_, i) => {
    const c = cards[i];
    if (!c) return `<li class="u3-se-slot"><button type="button" class="u3-se-slot__pick" data-sepick="${i}" aria-label="Spotlight ${i + 1}"><span>${i + 1}</span></button></li>`;
    return `<li class="u3-se-slot is-full u3-r-${esc(c.rarity || 'normal')}"><button type="button" class="u3-se-slot__pick" data-sepick="${i}" aria-label="${esc(c.name || 'Card')}">`
      + `${c.image_url ? `<img src="${thumb(c.image_url)}" alt="" draggable="false">` : ''}</button>`
      + `<button type="button" class="u3-se-slot__x" data-seunpick="${esc(c.id)}" aria-label="Remove ${esc(c.name || 'card')}">${icon('x', { size: 'sm' })}</button></li>`;
  }).join('')}</ol>`;
}

/** The title select (the library Select look): None, the titles the member owns, then the locked ones (greyed, how to get). */
export function titleSelectHTML(owned, locked, value) {
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  return `<span class="u3-select"><select class="u3-select__input" id="u3SeTitle" aria-label="Title">${opt('', 'None', !value)}`
    + owned.map((t) => opt(t, t, t === value)).join('')
    + (locked.length ? `<optgroup label="Locked">${locked.map((t) => `<option disabled>🔒 ${esc(t.value)} · ${esc(t.by)}</option>`).join('')}</optgroup>` : '')
    + `</select>${icon('chevron-down')}</span>`;
}

/** The frame chips: None, the frames the member owns, then the locked ones (greyed, the lock and how to get in the title). */
export function frameChipsHTML(owned, locked, value) {
  const ring = (f) => (f ? `<i class="se-ring frame-${esc(f.split(':')[0])}" aria-hidden="true"></i>` : '');
  const one = (f, label, on) => chip({ label, on, data: { seframe: f } }).replace('<span>', `${ring(f)}<span>`);
  return `<div class="u3-se-frames">${one('', 'None', !value)}${owned.map((f) => one(f.value, f.label, f.value === value)).join('')}`
    + locked.map((f) => chip({ label: f.label, disabled: true }).replace('<button', `<button title="Unlock: ${esc(f.by)}"`).replace('<span>', `${icon('lock', { size: 'sm' })}${ring(f.value)}<span>`)).join('')
    + '</div>';
}

/**
 * The window. d: { avatar (html), name, cards (the picked, in order), titles: { owned, locked }, title, frames: { owned, locked },
 *   frame, msg (text or ''), busy }
 */
export function styleEditorHTML(d) {
  return `<div class="u3-scrim u3-se-scrim" data-u3-scrim><section class="u3-dialog u3-se" role="dialog" aria-modal="true" aria-labelledby="u3SeT">`
    + `<header class="u3-se__head">${d.avatar}<h2 class="u3-se__name" id="u3SeT">${esc(d.name)}</h2>${iconButton({ icon: 'x', label: 'Close', data: { seclose: '1' } })}</header>`
    + `<div class="u3-se__a"><div class="u3-se__lab"><span class="u3-label">Spotlight</span><span class="u3-se__n">${d.cards.length}/${SPOT_CAP}</span></div>${slotsHTML(d.cards)}</div>`
    + `<div class="u3-se__b"><span class="u3-label">Title</span>${titleSelectHTML(d.titles.owned, d.titles.locked, d.title)}`
    + `<span class="u3-label">Frame</span>${frameChipsHTML(d.frames.owned, d.frames.locked, d.frame)}</div>`
    + `<footer class="u3-se__foot"><div class="u3-se__msg" aria-live="polite">${d.msg ? inlineMessage({ kind: 'error', text: d.msg }) : ''}</div>`
    + `${button({ label: 'Save', variant: 'primary', busy: d.busy, busyLabel: 'Saving', data: { sesave: '1' } })}</footer>`
    + '</section></div>';
}
