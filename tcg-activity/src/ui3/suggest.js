// UI-29: the pure logic of the member suggest list (docs/design.md 3.3, D-07; approved frames: design repo UI-29/approved).
// The list under the search of the Member picker: avatar, the name with the typed part in gold, 44 px rows. With more
// matches than fit it is a NAMED scroll area with a visible rail (the cue). Everything here runs without a browser (node --test).
import { esc } from './components.js';

export const SUGGEST_MAX_ROWS = 6;   // the most rows that show at once (UI-29 notes, proposal 1); more matches scroll inside the list
export const SUGGEST_KEEP = 12;      // the most matches the list keeps (the server returns the best first)

/** A name never ends in "…" (D-08): break points after _ . - , between a letter and a digit, and at camelCase.
 *  Escapes the name. Pure. */
export function breakName(name) {
  return esc(name)
    .replace(/(?<=[a-z0-9])([_.\-])(?=[a-z0-9])/gi, '$1<wbr>')
    .replace(/([a-z])(?=[A-Z])/g, '$1<wbr>')
    .replace(/([a-z])(?=[0-9])/gi, '$1<wbr>');
}

/** The match in a name, marked (the typed part in gold). Escapes the name. Pure. */
export function markMatch(name, q) {
  const n = String(name ?? ''), t = String(q ?? '').trim();
  const i = t ? n.toLowerCase().indexOf(t.toLowerCase()) : -1;
  if (i < 0) return breakName(n);
  return `${breakName(n.slice(0, i))}<b>${esc(n.slice(i, i + t.length))}</b>${breakName(n.slice(i + t.length))}`;
}

/** The order of the list: a name that STARTS with the typed text first, then the other matches, then the rest. The order
 *  inside each group is the server order (the server rules are not changed). Keeps at most SUGGEST_KEEP. Pure. */
export function rankMatches(members, q, keep = SUGGEST_KEEP) {
  const t = String(q ?? '').trim().toLowerCase();
  const rank = (m) => {
    const i = t ? String(m?.name ?? '').toLowerCase().indexOf(t) : -1;
    return i === 0 ? 0 : i > 0 ? 1 : 2;
  };
  return (members || []).map((m, i) => [m, i, rank(m)]).sort((a, b) => a[2] - b[2] || a[1] - b[1]).slice(0, keep).map(([m]) => m);
}

/** How many WHOLE rows show: the room (px) in whole rows (each row rowH, gap between), at most max, at least 1, at most count.
 *  A row never shows cut (3.3). Pure. */
export function visibleRows({ room, rowH, gap = 0, count, max = SUGGEST_MAX_ROWS }) {
  const n = Math.floor(((Number(room) || 0) + gap) / ((Number(rowH) || 1) + gap));
  return Math.max(1, Math.min(count, max, n));
}

/** The height (px) of a list of n whole rows. Pure. */
export function listHeight(n, rowH, gap = 0) { return n * rowH + Math.max(0, n - 1) * gap; }
