// UI-68 PROTOTYPE: the combat v2 parts of the card face (role icon, element mark, unique active, Silver line, Makes / Uses
// chips). Pure HTML builders for templates/card.template.html and card.fullart.html. The card text is DATA (card.v2),
// never in a template: card.v2 = { role, element, active: { name, text }, silver, makes: [], uses: [], stars }.
// Inline statuses in a text: "{poison:Poisoned}" = the UI-67 status icon + the word in its family color.
// Every color is a shared/tokens.json value or a UI-67 color (role-attack, role-support: the 3 UI-67 tokens go into UI-00).
import { LUCIDE } from './face-icons.js';

const C = {
  bgBase: '#0A0A12', surface2: '#20202F', textPrimary: '#F5F2EC', textSecondary: '#AEABC0', textMuted: '#9592AB',
  roleAttack: '#F2611D', roleSupport: '#3FE3F5', tierSilver: '#C9D1DC',
};
// UI-67 families: color, text color (when it differs), shape (square = harm, circle = boon).
const FAM = {
  dot: { color: '#FF4D63', text: '#FF6B7D', shape: 'square' },
  control: { color: '#B28CFF', shape: 'square' },
  accuracy: { color: '#FFF1B8', shape: 'square' },
  tempo: { color: '#9BEBFF', shape: 'square' },
  vuln: { color: '#FF8A3D', shape: 'square' },
  boons: { color: '#3DD9B4', shape: 'circle' },
};
export const STATUS = {
  poison: ['Poison', 'dot', 'flask-conical'], burn: ['Burn', 'dot', 'flame-kindling'],
  stunned: ['Stunned', 'control', 'orbit'], frozen: ['Frozen', 'control', 'cuboid'], sleep: ['Sleep', 'control', 'bed'],
  paralyzed: ['Paralyzed', 'control', 'activity'], blinded: ['Blinded', 'accuracy', 'eye-off'], confused: ['Confused', 'accuracy', 'shuffle'],
  slowed: ['Slowed', 'tempo', 'snail'], chill: ['Chill', 'tempo', 'thermometer-snowflake'],
  exposed: ['Exposed', 'vuln', 'heart-crack'], weakened: ['Weakened', 'vuln', 'arrow-big-down-dash'], mark: ['Mark', 'vuln', 'target'],
  shielded: ['Shielded', 'boons', 'shield'], empowered: ['Empowered', 'boons', 'arrow-big-up-dash'], focused: ['Focused', 'boons', 'focus'],
  quickened: ['Quickened', 'boons', 'rabbit'],
};
export const ROLE = {
  breaker: ['Breaker', 'attacker', 'drill'], striker: ['Striker', 'attacker', 'sword'], flurry: ['Flurry', 'attacker', 'repeat-2'],
  finisher: ['Finisher', 'attacker', 'axe'], survivor: ['Survivor', 'attacker', 'heart-pulse'], cleaver: ['Cleaver', 'attacker', 'slice'],
  warden: ['Warden', 'support', 'brick-wall'], medic: ['Medic', 'support', 'cross'], controller: ['Controller', 'support', 'anchor'],
  spotter: ['Spotter', 'support', 'binoculars'], herald: ['Herald', 'support', 'megaphone'], artillery: ['Artillery', 'support', 'rocket'],
};
// The element icons of tcg-activity/src/element-icons.js and the colors of shared/tokens.json "element" (copied for the prototype).
const EL = {
  fire: ['#FF6A3D', 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z'],
  water: ['#3CB6FF', 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z'],
  lightning: ['#FFD43B', 'M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
  ice: ['#9BEBFF', 'M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1M9 3l3 3 3-3M9 21l3-3 3 3M3 9l3 3-3 3M21 9l-3 3 3 3'],
  nature: ['#5BD66B', 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10zM2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12'],
  earth: ['#C98D55', 'm8 3 4 8 5-5 5 15H2L8 3z'],
  air: ['#BFEAFF', 'M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2'],
  shadow: ['#8A6CFF', 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z'],
  light: ['#FFF1B8', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4'],
  arcane: ['#E06AFF', 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM5 3v4M3 5h4M19 17v4M17 19h4'],
  psychic: ['#FF6AD0', 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  toxic: ['#9CD93C', 'M10 2v7.3M14 9.3V2M8.5 2h7M14 9.3a6.5 6.5 0 1 1-4 0M5.5 16h13'],
  metal: ['#A8BCCF', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1'],
};

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const svg = (inner, size, color, sw = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/** The UI-67 status badge: harm = rounded square, boon = circle; surface-2 fill, family stroke and glyph. */
// Review-2 (Nathan: the icons did not line up with the text): the badge is an inline glyph sized in em (1.0em box),
// centered on the cap height by CSS (.v2-badge vertical-align), so it lines up in the active text, the Silver line and chips.
export function statusBadge(key) {
  const s = STATUS[key]; if (!s) return '';
  const f = FAM[s[1]];
  return `<span class="v2-badge ${f.shape}" style="border-color:${f.color}">${svg(LUCIDE[s[2]], '68%', f.color, 2.4)}</span>`;
}

/** The UI-67 role badge: attacker = diamond (role-attack), support = circle (role-support), bg-base glyph. */
export function roleBadge(role, size = 40) {
  const r = ROLE[role]; if (!r) return '';
  const fill = r[1] === 'attacker' ? C.roleAttack : C.roleSupport;
  const shape = r[1] === 'attacker'
    ? `<polygon points="${size / 2},0 ${size},${size / 2} ${size / 2},${size} 0,${size / 2}" fill="${fill}"/>`
    : `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${fill}"/>`;
  const g = Math.round(size * 0.5);
  return `<span class="v2-role" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}">${shape}</svg>`
    + `<span class="v2-role-g" style="width:${g}px;height:${g}px">${svg(LUCIDE[r[2]], g, C.bgBase, 2.25)}</span></span>`;
}

export function elementMark(el, size = 32) {
  const e = EL[el]; if (!e) return '';
  return `<span class="v2-el" style="width:${size}px;height:${size}px;border:2px solid ${e[0]}">${svg(`<path d="${e[1]}"/>`, Math.round(size * 0.6), e[0])}</span>`;
}

/** A card text with "{key:Word}" statuses as an icon + the word in the family color. */
export function richText(text) {
  return esc(text).replace(/\{([a-z]+):([^}]+)\}/g, (m, key, word) => {
    const s = STATUS[key]; if (!s) return word;
    const f = FAM[s[1]];
    return `<span class="v2-st" style="color:${f.text || f.color}">${statusBadge(key)}${word}</span>`;
  });
}

function chips(label, keys) {
  if (!keys || !keys.length) return '';
  return `<span class="v2-chips"><span class="v2-chips-l">${label}</span>${keys.map((k) => {
    const s = STATUS[k]; if (!s) return '';
    const f = FAM[s[1]];
    return `<span class="v2-chip" style="color:${f.text || f.color}">${statusBadge(k)}${esc(s[0])}</span>`;
  }).join('')}</span>`;
}

/** All placeholders of the v2 face, or empty strings when the card has no v2 data (the face stays as today). */
export function faceParts(card) {
  const v = card.v2;
  if (!v) return { V2CLASS: '', ROLEBADGE: '', ROLENAME: '', ELEMENT: '', ACTIVE: '', SILVER: '', CHIPS: '', V2LORE: '' };
  const r = ROLE[v.role];
  const on = (v.stars || 0) >= 3;
  const lock = on ? '' : svg(LUCIDE.lock, 12, C.tierSilver, 2.5);
  return {
    V2CLASS: `v2 ${r ? r[1] : ''}${on ? ' silver-on' : ''}${v.faOption ? ' fa-' + v.faOption : ''}`,
    ROLEBADGE: roleBadge(v.role),
    ROLENAME: r ? `<span class="v2-rolename" style="color:${r[1] === 'attacker' ? C.roleAttack : C.roleSupport}">${esc(r[0])}</span>` : '',
    ELEMENT: elementMark(v.element),
    ACTIVE: v.active ? `<div class="v2-active"><span class="v2-aname">${esc(v.active.name)}</span> <span class="v2-atext">${richText(v.active.text)}</span></div>` : '',
    SILVER: v.silver ? `<div class="v2-silver"><span class="v2-slabel">${lock}Silver</span><span class="v2-stext">${richText(v.silver)}</span></div>` : '',
    CHIPS: [chips('Makes', v.makes), chips('Uses', v.uses)].join(''),
    // Review-2: the lore line stays (Nathan). The tier's own lore (slotDetails) is merged into card.lore by renderTier.
    V2LORE: card.lore ? `<span>&ldquo;${esc(card.lore)}&rdquo;</span>` : '',
  };
}
