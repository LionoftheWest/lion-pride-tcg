// UI-28: the play flow after the Boons tab picks a card (docs/design.md 6.5 pickers, 5.2 Dialog, Toast, Banner; D-42, D-43).
// Approved: design repo UI-28/approved. The pure rules and the HTML of the windows, so that they can be checked without a
// browser: the confirm window (boon, prank, shield), the poll question list, the owner block, the refund popup, the
// result line, and the incoming banners. The server keeps its own rules (play_card_effect, the bot); nothing here
// changes a rule or an effect.
import { esc, chip, button, iconButton, inlineMessage, progressLinear } from './components.js';
import { icon } from './icons.js';
import { kindName } from './boons.js';

/** The effects Discord does not allow on the server owner (the list of tcg-activity/effects.js, the server refuses them before the play). */
export const OWNER_FORBIDDEN = ['nickname', 'title', 'sticker', 'crown', 'body_swap', 'timeout'];

/** The play buttons and the chip words of each kind (glossary 10.1, D-05). */
export const KIND_TEXT = {
  boon: { chip: 'Boon', play: 'Play boon', icon: 'gift' },
  prank: { chip: 'Prank', play: 'Play prank', icon: 'drama' },
  shield: { chip: 'Shield', play: 'Play shield', icon: 'shield-check' },
};

/** True when this card cannot be played on this member: the member is the server owner and Discord refuses the effect. Pure. */
export function ownerBlocked(primitive, targetId, immune) {
  return OWNER_FORBIDDEN.includes(primitive) && (immune || []).map(String).includes(String(targetId));
}

/** The owner popup line (frame owner-blocked): it names no member. A timeout says "time out", the others say "rename". */
export function ownerBlockText(primitive) {
  return `Discord does not let anyone ${primitive === 'timeout' ? 'time out' : 'rename'} the server owner, so this card cannot be played.`;
}

/** The questions of a poll card with the member name filled in: [{ i, text }], i = the index the server expects. Pure. */
export function pollQuestions(effect, name) {
  const polls = effect?.options?.polls;
  if (!Array.isArray(polls)) return [];
  return polls.map((p, i) => ({ i, text: String(p?.question ?? '').split('{name}').join(name) })).filter((q) => q.text);
}

/** The result line (toast) for the sender after a play: the outcomes of play_card_effect. other = the name of a redirect target. Pure. */
export function playResultText(r, toName, otherName, voice) {
  switch (r?.outcome) {
    case 'blocked': return `${toName}'s ward blocked it.`;
    case 'reflected': return 'It bounced back to you!';
    case 'decoyed': return `${toName}'s decoy took the hit.`;
    case 'redirected': return `It was redirected to ${otherName || 'another member'}.`;
    case 'delayed': return `It lands on ${toName} in 1 hour.`;
    default: return voice ? `Played on ${toName}. It waits until they join voice (1 hour max).` : `Played on ${toName}.`;
  }
}

/** The refund popup (frame refunded): one refunded play of /api/effects/me "refunds" { reason, target, card: { name } }. Pure. */
export function refundText(rf) {
  const what = rf?.reason === 'not_moderatable' ? 'time out' : 'rename';
  const target = rf?.target || 'that member';
  const card = rf?.card?.name || 'card';
  return `Discord did not let the bot ${what} ${target}, so your ${card} did nothing. The play is refunded: the card is ready again, and it does not count today.`;
}

/** An incoming play as a banner (frame incoming-banners): kind for the edge color, the icon, three lines (who, the card, the tail). Pure. */
export function bannerOf(p) {
  const sender = p?.sender || 'Someone';
  const card = p?.card?.name || 'a card';
  const kind = p?.kind === 'prank' ? 'prank' : 'boon';
  const out = p?.outcome;
  if (out === 'blocked') return { kind, icon: 'shield-check', who: `${sender} tried`, card, tail: 'on you, but it was blocked!' };
  if (out === 'reflected') return { kind, icon: 'shield-check', who: 'Your', card, tail: 'bounced back to you!' };
  if (out === 'decoyed') return { kind, icon: 'drama', who: `${sender} played`, card, tail: 'on you. Your cardboard cutout took it!' };
  if (out === 'delayed') return { kind, icon: 'timer', who: `${sender} played`, card, tail: 'on you. It lands in 1 hour.' };
  return { kind, icon: KIND_TEXT[kindName(p?.kind)]?.icon || 'gift', who: `${sender} played`, card, tail: 'on you!' };
}

/** Plays today (the same block as the Boons tab, UI-27): label, bar, "n/cap". */
export const todayHTML = (used, cap) => (cap
  ? `<div class="u3-bn-today u3-bn-today--win${used >= cap ? ' is-full' : ''}"><span class="u3-bn-today__label">Plays today</span>${progressLinear({ value: used / cap, label: 'Plays today' })}<b class="u3-bn-today__n">${used}/${cap}</b></div>`
  : '');

/**
 * The confirm window (6.5, frames play-confirm, confirm-boon, played, poll-pick). One window for every entry (Boons tab,
 * profile): the kind chip and state, the effect name, the card with its text and chips, "To" the member, "On <member>"
 * the effects that are active, the poll questions of a poll card, the error line, Plays today, Back and the play button.
 * o: { kind, title, desc, imgSrc, rarity, chips: [{ icon, text }], whoHTML, toName, active: [text], polls: [{ i, text }], choice,
 *   msg, used, cap, busy, disabled }
 */
export function confirmHTML(o) {
  const k = KIND_TEXT[o.kind] ? o.kind : 'shield';
  const t = KIND_TEXT[k];
  const chips = (o.chips || []).map((c) => `<span class="u3-fxw__chip">${icon(c.icon)}<span>${esc(c.text)}</span></span>`).join('');
  const on = (o.active || []).length ? (o.active || []).map((a) => `<span class="u3-fxw__chip u3-fxw__chip--plain">${esc(a)}</span>`).join('') : '<span class="u3-fxw__none">Nothing active</span>';
  const polls = (o.polls || []).length
    ? `<div class="u3-fxw__polls"><span class="u3-label">Pick a question</span><div class="u3-fxw__plist" role="radiogroup" aria-label="Pick a question">${o.polls.map((q) => `<button type="button" class="u3-fxw__q${o.choice === q.i ? ' is-on' : ''}" role="radio" aria-checked="${o.choice === q.i ? 'true' : 'false'}" data-fxq="${q.i}">${esc(q.text)}</button>`).join('')}</div></div>`
    : '';
  const needPick = (o.polls || []).length && o.choice == null;
  return `<div class="u3-scrim u3-fxw-scrim" data-u3-scrim><div class="u3-dialog u3-fxw u3-fxw--${k}" role="dialog" aria-modal="true" aria-labelledby="u3FxT" tabindex="-1">`
    + `<header class="u3-fxw__head"><div class="u3-fxw__tags">${chip({ label: t.chip, kind: 'effect', effect: k })}<span class="u3-fxw__state">Ready</span></div>`
    + `${iconButton({ icon: 'x', label: 'Close', data: { fxclose: '1' } })}</header>`
    + `<h2 class="u3-dialog__title u3-fxw__title" id="u3FxT">${esc(o.title)}</h2>`
    + `<div class="u3-fxw__main"><div class="u3-fxw__card u3-r-${esc(o.rarity || 'normal')}">${o.imgSrc ? `<img src="${esc(o.imgSrc)}" alt="" draggable="false">` : ''}</div>`
    + `<div class="u3-fxw__info"><p class="u3-fxw__desc">${esc(o.desc || '')}</p><div class="u3-fxw__chips">${chips}</div></div></div>`
    + `<div class="u3-fxw__to"><span class="u3-label">To</span>${o.whoHTML}</div>`
    + `<div class="u3-fxw__on"><span class="u3-label">On ${esc(o.toName)}</span>${on}</div>`
    + `${polls}${o.msg ? `<div class="u3-fxw__msg">${inlineMessage({ kind: 'error', text: o.msg })}</div>` : ''}`
    + `<footer class="u3-fxw__foot">${todayHTML(o.used, o.cap)}<div class="u3-fxw__acts">${button({ label: 'Back', data: { fxback: '1' } })}`
    + `${button({ label: t.play, variant: k, busy: !!o.busy, busyLabel: 'Playing', disabled: !!o.disabled || !!needPick, data: { fxplay: '1' } })}</div></footer></div></div>`;
}

/** A small Dialog (owner block, refund): title, one line, OK on the right (frames owner-blocked, refunded). */
export function noticeHTML({ title, line, id = 'u3FxN' }) {
  return `<div class="u3-scrim u3-fxw-scrim" data-u3-scrim><div class="u3-dialog u3-fxn" role="dialog" aria-modal="true" aria-labelledby="${esc(id)}-t" aria-describedby="${esc(id)}-d" tabindex="-1">`
    + `<h2 class="u3-dialog__title" id="${esc(id)}-t">${esc(title)}</h2><p class="u3-dialog__line u3-fxn__line" id="${esc(id)}-d">${esc(line)}</p>`
    + `<footer class="u3-fxn__foot">${button({ label: 'OK', variant: 'primary', data: { fxok: '1' } })}</footer></div></div>`;
}

/** One incoming banner (5.2 Banner, frame incoming-banners): the card, who played, the card name, the tail, and the close button. */
export function bannerHTML(b, { id, extra = '' } = {}) {
  return `<div class="u3-banner u3-banner--${b.kind} u3-fxb" role="status" data-fxb="${esc(id ?? '')}">`
    + `${b.imgSrc ? `<span class="u3-fxb__card"><img src="${esc(b.imgSrc)}" alt="" draggable="false"></span>` : ''}`
    + `<span class="u3-fxb__text"><span class="u3-fxb__who">${icon(b.icon)}<span>${esc(b.who)}</span></span><b class="u3-fxb__name">${esc(b.card)}</b><span class="u3-fxb__tail">${esc(b.tail)}</span>${extra}</span>`
    + `${iconButton({ icon: 'x', label: 'Close', variant: 'plain', data: { fxbclose: id ?? '' } })}</div>`;
}

/** At most this many banners show at once; the rest wait their turn (no stack that covers the screen). */
export const BANNERS_MAX = 3;
