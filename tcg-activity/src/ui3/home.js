// UI-03 Home (v3 only, body.ui-v3): the markup of the three Home tiles in the approved layout (design repo UI-03/approved):
// the hero tile, the Live in voice tile and the Live pulls tile. ui-v2.js paints them with the same ids and data
// attributes as the v2 Home, so every handler, the countdown tick and the tutorial targets keep working. All styles
// are public/ui3/90-ui-03.css (tokens only). The layout is measured here (voice cells that fit, pull rows that fit),
// never from a window size (F-1).
import { icon } from './icons.js';
import { pager, button, segmented, progressSegmented, esc } from './components.js';
import { breakable } from '../effects-ui.js';
import { topMode } from './home-boss.js';

export const homeV3 = () => document.body.classList.contains('ui-v3');

const TAB_LABEL = [['all', 'All'], ['top', 'Top pulls'], ['den', 'Voice']];   // "Den" is "Voice" (10.1, G-133)

/** The "Top hunter" line: a button with a frame that opens the Leaderboard (D-48, D-52). */
export const topHunterHTML = (row, fmt) => (row
  ? `<button type="button" class="u3-hm-top" data-top-hunter aria-label="Top hunter: ${esc(row.username)}, ${fmt(row.damage)}"><span class="u3-hm-topt"><span class="u3-hm-topl">Top hunter:</span> <b>${breakable(esc(row.username))}</b> <i>·</i> <em>${fmt(row.damage)}</em></span></button>`
  : '<span class="u3-hm-top-slot"></span>');

/** The hero tile, resting (d = the /api/hunt answer, no active hunt). h = { fmt, hasModel }. */
export function heroRestHTML(d, h) {
  const last = d?.lastResult;
  const won = last?.status === 'defeated';
  const top = (d?.lastBoard || [])[0];
  const stage = last && h.hasModel ? '<div class="u3-hm-stage"><div class="u3-hm-boss"><canvas id="restCanvas"></canvas></div></div>' : '';
  const result = last ? `<span class="u3-hm-res ${won ? 'is-won' : 'is-lost'}">${icon(won ? 'trophy' : 'skull')}<span>${won ? 'Defeated by the pride' : 'Escaped'}</span></span>` : '';
  const stats = last ? `<div class="u3-hm-stats"><div><b>${h.fmt(d.myLast || 0)}</b><span>Your damage</span></div><div><b>${h.fmt(last.hp_max || 0)}</b><span>Boss HP</span></div>`
    + `<div><b>${esc(last.tier || '')}</b><span>Tier</span></div></div>` : '';
  const next = d?.nextSpawnAt ? `<div class="u3-hm-next"><span>Next boss in</span><b data-until="${esc(d.nextSpawnAt)}"></b></div>` : '';
  return `<div class="u3-hm-hb is-rest">${stage}<div class="u3-hm-info"><div class="u3-hm-i1"><span class="u3-hm-chip">The Hunt · Resting</span><h2 class="u3-hm-title">${breakable(esc(last ? last.name : 'The hunt is resting'))}</h2>${result}</div>${stats}${next}${topHunterHTML(top, h.fmt)}</div></div>`;
}

/** The hero tile, live fight. h = { rank }. */
export function heroLiveHTML(hunt, pct, h) {
  return `<div class="u3-hm-hb is-live"><div class="u3-hm-stage"><div class="u3-hm-boss"><canvas id="heroCanvas"></canvas></div></div><div class="u3-hm-info">`
    + `<div class="u3-hm-i1"><span class="u3-hm-chip is-live"><i class="u3-hm-livedot"></i>The Hunt · Live now</span><h2 class="u3-hm-title">${breakable(esc(hunt.name))}</h2></div>`
    + `<div class="u3-hm-hpg"><div class="u3-hm-hp"><span>${pct}% HP</span><span class="u3-hm-mono" data-closes="${esc(hunt.closes_at)}"></span></div>${progressSegmented({ value: pct / 100 })}</div>`
    + `<div class="u3-hm-act"><div class="u3-hm-join">${button({ label: 'Join the Hunt', icon: 'swords', variant: 'primary', data: { hjoin: '1' } })}<span class="u3-hm-faces" id="heroFaces"></span>`
    + `<span class="u3-hm-mono u3-hm-rank">${esc(h.rank || '')}</span></div><span class="u3-hm-top-slot" id="heroTop"></span></div></div></div>`;
}
/** Keep the hero inside its tile: when the info is taller than the tile, the layout mode is-tight (the boss beside the
 *  title, the stats under it), then is-tighter (smaller type), then is-nolabel (the Top hunter line without its label). Measured on the elements (design.md 3.3, brief section 5). */
export function fitHero(box) {
  const hb = box?.querySelector('.u3-hm-hb');
  const info = hb?.querySelector('.u3-hm-info');
  if (!hb || !info) return;
  hb.classList.remove('is-line', 'is-tight', 'is-tighter', 'is-nolabel');
  const over = () => info.scrollHeight > info.clientHeight + 1 || info.scrollWidth > info.clientWidth + 1 || hb.scrollHeight > hb.clientHeight + 1 || hb.scrollWidth > hb.clientWidth + 1;
  // UI-04: the Top 3 board first; the one "Top hunter" line on compact-land (D-58) or when the board does not fit
  if (hb.querySelector('.u3-hm-board') && topMode(document.body.dataset.size, false) === 'line') hb.classList.add('is-line');
  if (over() && hb.querySelector('.u3-hm-board') && !hb.classList.contains('is-line')) hb.classList.add('is-line');
  if (over()) { hb.classList.add('is-tight'); if (over()) { hb.classList.add('is-tighter'); if (over()) hb.classList.add('is-nolabel'); } }
}

/** How much content is cut: the overflow in px of every tile and of the grid (3.3). 0 = nothing is cut. */
export function cutTiles(root) {
  const hm = root?.querySelector('.u3-hm');
  if (!hm) return 0;
  const over = (t) => Math.max(0, t.scrollHeight - t.clientHeight - 1) + Math.max(0, t.scrollWidth - t.clientWidth - 1);
  return [...hm.children].reduce((n, t) => n + over(t), over(hm));
}

/** One member cell. p = the presence entry, b = { st } (vcBody), h = { avatar, name, ico, ago, self, watch }. */
export function voiceCellHTML(p, b, h) {
  const kind = p.status?.kind || 'here';
  return `<button type="button" class="u3-hm-cell k-${esc(kind)}${h.self ? ' self' : ''}${h.watch ? ' watch' : ''}" data-member="${esc(p.id)}">${h.avatar}`
    + `<span class="u3-hm-cn"><span class="u3-hm-c1"><b>${h.name}</b>${h.self ? '<em class="u3-hm-you">You</em>' : ''}`
    + `${h.watch ? `<span class="u3-hm-watch">${icon('eye')}<span>Watch</span></span>` : `<span class="u3-hm-ago">${esc(h.ago)}</span>`}</span>`
    + `<span class="u3-hm-st"><span aria-hidden="true">${esc(h.ico)}</span> <span>${esc(b.st)}</span></span></span></button>`;
}
/** The Live in voice tile. cells = the cell HTML strings (others first, then you). */
export function voiceHTML(cells, count) {
  return `<div class="u3-hm-vh"><b class="u3-hm-vt">${icon('headphones', { size: 'xl' })}<span>Live in voice</span></b><span class="u3-hm-vn">${count | 0}</span>`
    + `${count > 1 ? '<span class="u3-hm-live">Live</span>' : ''}</div><div class="u3-hm-vrow">${cells.join('')}</div>`;
}
/** Keep the cells that fit one row, then the "+N" cell (3.4 G-022). Measured on the row itself. */
export function fitVoice(box) {
  const row = box?.querySelector('.u3-hm-vrow');
  if (!row) return;
  row.querySelector('.u3-hm-more')?.remove();
  const cells = [...row.querySelectorAll('.u3-hm-cell')];
  cells.forEach((c) => { c.hidden = false; });
  row.classList.add('is-measure');
  const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
  const probe = document.createElement('span');
  probe.className = 'u3-hm-more'; probe.textContent = '+99';
  row.appendChild(probe);
  const moreW = probe.getBoundingClientRect().width;
  probe.remove();
  const avail = row.clientWidth;
  const w = cells.map((c) => c.getBoundingClientRect().width);
  const sum = (k) => w.slice(0, k).reduce((t, x) => t + x, 0) + gap * Math.max(0, k - 1);
  let k = cells.length;
  if (sum(k) > avail) { while (k > 1 && sum(k) + gap + moreW > avail) k -= 1; }
  row.classList.remove('is-measure');
  cells.forEach((c, i) => { c.hidden = i >= k; });
  if (k < cells.length) row.insertAdjacentHTML('beforeend', `<span class="u3-hm-more" aria-label="${cells.length - k} more members">+${cells.length - k}</span>`);
}

/** One pull row (the data-pi hook of the v2 Home; the v2 classes pl-row and pl-top are not used: their v2 rules would reach into these rows). */
export function pullRowHTML(p, i, h) {
  return `<div class="u3-hm-row u3-r-${esc(p.rarity)}" data-pi="${i}"><img src="${esc(h.thumb(p.image_url))}" data-full="${esc(p.image_url || '')}" alt="" loading="lazy">`
    + `<div class="u3-hm-rt"><span class="u3-hm-who"><b>${h.name(p)}</b> pulled</span><span class="u3-hm-card">${breakable(esc(p.name))}</span></div><span class="u3-hm-time">${esc(h.ago(p.at))}</span></div>`;
}
/** The featured pull (the first pull of the page, drawn large). */
export function featHTML(p, h) {
  return `<div class="u3-hm-feat u3-r-${esc(p.rarity)}" data-pi="${p.pi}"><img src="${esc(h.thumb(p.image_url))}" data-full="${esc(p.image_url || '')}" alt="">`
    + `<div class="u3-hm-ft"><span class="u3-hm-fk">${esc((h.label[p.rarity] || p.rarity).toUpperCase())} · ${esc(h.ago(p.at))}</span><b>${h.name(p)} pulled ${breakable(esc(p.name))}</b></div></div>`;
}
/** The Live pulls tile frame: header with the three tabs, the featured pull, the list and the pager slot. */
export function pullsHTML(tab) {
  return `<div class="u3-hm-ph"><b class="u3-hm-pt"><i class="u3-hm-livedot"></i>Live pulls</b>${segmented(TAB_LABEL.map(([id, label]) => ({ id, label, active: tab === id })), { label: 'Show pulls' })}</div>`
    + '<div class="u3-hm-fw" id="plFeat"></div><div class="u3-hm-list" id="plList"></div><div class="u3-hm-pg" id="plPager"></div>';
}
/** Fill the featured pull and the list from `start`: the rows that fit fully, then the pager ("1 / N"). One page = the
 *  featured pull and the rows that fit (the page size is measured, 3.4 G-022). Returns the start of the page shown. */
export function fitPulls(box, pulls, start, h, onPage) {
  const list = box?.querySelector('#plList');
  const pg = box?.querySelector('#plPager');
  const fw = box?.querySelector('#plFeat');
  if (!list || !pg || !fw) return start;
  if (!pulls.length) { fw.innerHTML = '<p class="u3-hm-empty">No pulls yet.</p>'; list.innerHTML = ''; pg.innerHTML = ''; return 0; }
  const paint = (from) => {
    fw.innerHTML = featHTML({ ...pulls[from], pi: from }, h);
    list.innerHTML = pulls.slice(from + 1, from + 25).map((p, j) => pullRowHTML(p, from + 1 + j, h)).join('');
  };
  // The rows that fit under the featured pull, then the pager. When the tile is still cut (a long name, a short frame), the mode
  // is-tight (smaller type and gaps) and once more.
  const layout = (from0) => {
    paint(from0);
    pg.innerHTML = pulls.length > 1 ? pager({ page: 1, pages: 2 }) : '';   // the pager takes its room before the rows are counted
    const room = list.getBoundingClientRect().bottom;
    while (list.children.length > 0 && list.lastElementChild.getBoundingClientRect().bottom > room + 1) list.lastElementChild.remove();
    const size = list.children.length + 1;
    const pages = Math.max(1, Math.ceil(pulls.length / size));
    const page = Math.min(pages, Math.floor(from0 / size) + 1);
    const from = (page - 1) * size;
    if (from !== from0) { paint(from); while (list.children.length > size - 1) list.lastElementChild.remove(); }
    pg.innerHTML = pages > 1 ? pager({ page, pages }) : '';
    pg.onclick = (e) => { const b = e.target.closest('[data-page]'); if (b && !b.disabled) onPage(b.dataset.page === 'next' ? from + size : Math.max(0, from - size)); };
    return from;
  };
  box.classList.remove('is-tight');
  let from = layout(start);
  if (box.scrollHeight > box.clientHeight + 1) { box.classList.add('is-tight'); from = layout(start); }
  return from;
}
