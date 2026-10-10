// UI-04 Home boss (v3 only): the Top 3 board of the live Hunt slide (D-58) and the pure logic around it.
// The board is a button with a frame (D-52): a tap opens the Leaderboard window. It shows only the real entries
// (1 to 3). Where 3 rows do not fit (compact-land, or a short tile), the slide keeps the single "Top hunter" line:
// the hero measures that (fitHero in home.js sets the mode is-line). No window size is read here (F-1).
import { esc } from './components.js';
import { breakable } from '../effects-ui.js';

/** The first three real entries of a board: { id, name, damage }. Rows with no name are dropped, never invented. */
export function boardRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.username)
    .slice(0, 3)
    .map((r) => ({ id: r.player_id, name: String(r.username), damage: Number(r.damage) || 0 }));
}

/** The spoken text of the board button (G-133 words: "Top hunters"). */
export function boardLabel(rows, fmt) {
  return `Top hunters: ${rows.map((r, i) => `${i + 1}, ${r.name}, ${fmt(r.damage)}`).join('. ')}`;
}

/** The Top 3 board. rows = boardRows(...), h = { fmt, avatar(id, name) }. Empty rows = no board. */
export function boardHTML(rows, h) {
  if (!rows.length) return '';
  const items = rows.map((r, i) => `<li class="u3-hm-br"><span class="u3-hm-brk">${i + 1}</span>${h.avatar(r.id, r.name)}`
    + `<b class="u3-hm-brn">${breakable(esc(r.name))}</b><em class="u3-hm-brd">${h.fmt(r.damage)}</em></li>`).join('');
  return `<button type="button" class="u3-hm-board" data-top-hunter aria-label="${esc(boardLabel(rows, h.fmt))}">`
    + `<span class="u3-hm-brh">Top 3</span><ul class="u3-hm-brl">${items}</ul></button>`;
}

/** The mode for the Top block: the board, or the one line. size = body[data-size] (the size-class module), tight = the hero is cut. */
export const topMode = (size, tight) => (size === 'compact-land' || tight ? 'line' : 'board');
