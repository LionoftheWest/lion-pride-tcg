// UI-05 Home carousel (v3 only, body.ui-v3): the Hunt, Dungeon and Gauntlet slides of the Home hero (design repo UI-05/approved),
// the slide control (labels on expanded and medium, dots on the compact classes, D-57) and the pure logic around them.
// The Hunt slide is the UI-03/UI-04 hero (home.js). The Dungeon and Gauntlet slides show only what the mode lobby already
// shows (its header, the timer, the rule or the theme, the Top 3), read from the same routes. No window size is read here (F-1):
// the control swaps by body[data-size] in CSS, and the fit is measured on the elements. All styles: public/ui3/90-ui-05.css.
import { icon } from './icons.js';
import { iconButton, dot, esc } from './components.js';
import { breakable } from '../effects-ui.js';
import { topMode } from './home-boss.js';
import { KINDS, norm, isLive, left, themeVar, artURL } from './events.js';

export const SLIDES = { hunt: 'Hunt', dungeon: 'Dungeon', gauntlet: 'Gauntlet', events: 'Events' };

/** The slides in order: the Hunt first when it is live, else the next active mode first (D-14, D-45). A mode with no data (closed, off) has no slide.
 *  The Events slide is the LAST slide (D-188), and only when an event is live (D-45) and the flag shows it (`events`). */
export function slideOrder({ huntLive, dungeon, gauntlet, events }) {
  const modes = [dungeon ? 'dungeon' : null, gauntlet ? 'gauntlet' : null].filter(Boolean);
  const base = huntLive ? ['hunt', ...modes] : dungeon ? ['dungeon', 'hunt', ...(gauntlet ? ['gauntlet'] : [])] : ['hunt', ...modes];
  return events ? [...base, 'events'] : base;
}

/** The news Dot (D-45, D-55): the Dungeon has news while today's run is not used yet. Nothing else is drawn as news (UI-05 frames). */
export const slideNews = (key, data) => key === 'dungeon' && !!data && Number(data.runs_today) === 0 && !data.run;

/** The slide after `key` in `order`, wrapping (the arrows and a swipe). dir = 1 or -1. */
export function slideStep(order, key, dir) {
  const at = Math.max(0, order.indexOf(key));
  return order[(at + (dir < 0 ? -1 : 1) + order.length) % order.length];
}

const two = (n) => String(n).padStart(2, '0');
/** "07:58:35" until iso (0 when past). */
export function hms(iso, now = Date.now()) {
  const s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}
/** "6d 7h 53m" until iso (the Gauntlet week). */
export function dhm(iso, now = Date.now()) {
  const m = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 60000));
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h ${m % 60}m`;
}
/** "SUN, OCT 4" from the day key "2026-10-04". */
export const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
/** "OCT 4" from the week key. */
export const weekLabel = (week) => new Date(`${week}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
/** The theme tag as a name: "trait:robot" -> "Robot". */
export const themeName = (t) => String(t || '').replace(/^(trait|origin):/, '').replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());

/** The first three real board entries: { rank, name, at } with at = "3F Room 2". Nothing is invented. */
export function topRows(top) {
  return (Array.isArray(top) ? top : []).filter((t) => t && t.username).slice(0, 3)
    .map((t, i) => ({ rank: Number(t.rank) || i + 1, name: String(t.username), at: `${Number(t.floor) || 0}F Room ${Number(t.room) || 0}` }));
}

const board = (head, count, rows, empty, open) => {
  const list = rows.length
    ? `<ol class="u3-hm-sbl">${rows.map((r) => `<li class="u3-hm-sbr"><span class="u3-hm-sbk">${r.rank}</span><b class="u3-hm-sbn">${breakable(esc(r.name))}</b><em class="u3-hm-sbd">${esc(r.at)}</em></li>`).join('')}</ol>`
    : `<p class="u3-hm-sbe">${esc(empty)}</p>`;
  return `<button type="button" class="u3-hm-sboard" data-slide-open="${open}" aria-label="${esc(`${head}: ${rows.length ? rows.map((r) => `${r.rank}, ${r.name}, ${r.at}`).join('. ') : empty}`)}">`
    + `<span class="u3-hm-sbh"><span class="u3-hm-sbt">${esc(head)}</span><span class="u3-hm-sbc">${esc(count)}</span></span>${list}</button>`;
};
/** The one line that replaces the board where 3 rows do not fit (D-58). */
const line = (label, rows, empty, open) => `<button type="button" class="u3-hm-top u3-hm-sline" data-slide-open="${open}" aria-label="${esc(rows.length ? `${label}: ${rows[0].name}, ${rows[0].at}` : empty)}">`
  + `<span class="u3-hm-topt">${rows.length ? `<span class="u3-hm-topl">${esc(label)}:</span> <b>${breakable(esc(rows[0].name))}</b> <i>·</i> <em>${esc(rows[0].at)}</em>` : esc(empty)}</span></button>`;

// the real lobby picture; its black top rows are cut by the frame of the box (CSS), as the approved frames draw it
const art = '<div class="u3-hm-sart"><div class="u3-hm-simg" aria-hidden="true"></div></div>';
const slide = (kind, art2, body) => `<div class="u3-hm-sb is-${kind}" data-slide-open="${kind}">${art2}<div class="u3-hm-info u3-hm-sinfo">${body}</div></div>`;

/** The Dungeon slide. d = the /api/dungeon answer (name, day, next_at, rule, top, runs_today). */
export function dungeonSlideHTML(d) {
  const rows = topRows(d.top);
  const n = Number(d.runs_today) || 0;
  return slide('dungeon', art,
    `<div class="u3-hm-i1"><span class="u3-hm-chip">Dungeon</span>`
    + `<div class="u3-hm-strow"><h2 class="u3-hm-title">${icon('castle', { size: 'lg' })}<span>${breakable(esc(d.name))}</span></h2><span class="u3-hm-date">${esc(dayLabel(d.day))}</span></div></div>`
    + `<div class="u3-hm-next u3-hm-stimer">${icon('timer')}<span>New dungeon in</span><b data-hms="${esc(d.next_at)}">${hms(d.next_at)}</b></div>`
    + `<div class="u3-hm-rule"><span class="u3-hm-rl">Today's rule</span><b>${breakable(esc(d.rule?.name || 'Everything goes'))}</b></div>`
    + board("Today's top 3", `${n} run${n === 1 ? '' : 's'}`, rows, 'No runs yet today. Be the first.', 'dungeon')
    + line('Top today', rows, 'No runs yet today', 'dungeon'));
}
/** The Gauntlet slide. d = the /api/gauntlet answer (name, week, ends_at, theme, top, players_week). */
export function gauntletSlideHTML(d) {
  const rows = topRows(d.top);
  const n = Number(d.players_week) || 0;
  return slide('gauntlet', art,
    `<div class="u3-hm-i1"><span class="u3-hm-chip">Gauntlet</span>`
    + `<div class="u3-hm-strow"><h2 class="u3-hm-title">${icon('crown', { size: 'lg' })}<span>${breakable(esc(d.name))}</span></h2><span class="u3-hm-date">WEEK OF ${esc(weekLabel(d.week))}</span></div></div>`
    + `<div class="u3-hm-next u3-hm-stimer">${icon('timer')}<span>Week ends in</span><b data-dhm="${esc(d.ends_at)}">${dhm(d.ends_at)}</b></div>`
    + `<div class="u3-hm-rule"><span class="u3-hm-rl">This week's theme</span><b>${breakable(esc(d.theme ? themeName(d.theme) : 'Mixed'))}</b></div>`
    + board('Top 3 this week', `${n} member${n === 1 ? '' : 's'}`, rows, 'No runs yet this week. Be the first.', 'gauntlet')
    + line('Top this week', rows, 'No runs yet this week', 'gauntlet'));
}

/** The slide control. Dots on the compact classes and labels on the larger ones are both in the page; CSS shows one by body[data-size] (D-57).
 *  order = the keys, key = the active one, news = { key: true }. */
export function controlHTML(order, key, news = {}) {
  const arrows = (ic, label, dir) => iconButton({ icon: ic, label, variant: 'panel', data: { slidedir: dir } });
  const pip = (k) => `<button type="button" role="tab" class="u3-hm-pip${k === key ? ' is-on' : ''}" aria-selected="${k === key}" aria-label="${SLIDES[k]}" data-slide-go="${k}">${news[k] ? dot('New') : ''}</button>`;
  const lab = (k) => `<button type="button" role="tab" class="u3-seg__item${k === key ? ' is-active' : ''}" aria-selected="${k === key}" data-slide-go="${k}"><span>${SLIDES[k]}</span>${news[k] ? dot('New') : ''}</button>`;
  return `<div class="u3-hm-ctl">${arrows('chevron-left', 'Previous slide', 'prev')}`
    + `<div class="u3-hm-dots" role="tablist" aria-label="Slides">${order.map(pip).join('')}</div>`
    + `<div class="u3-seg u3-hm-labels" role="tablist" aria-label="Slides">${order.map(lab).join('')}</div>`
    + `${arrows('chevron-right', 'Next slide', 'next')}</div>`;
}

/** The hero with its control: one slide and, when there is more than one, the control under it. */
export function carouselHTML(order, key, slideHTML, news) {
  return `<div class="u3-hm-car" data-slide="${key}"><div class="u3-hm-slide">${slideHTML}</div>${order.length > 1 ? controlHTML(order, key, news) : ''}</div>`;
}

/** Keep a Dungeon or Gauntlet slide inside its tile: the one line instead of the Top 3 (compact-land, or cut), then smaller type (is-tight), then once more. */
export function fitSlide(box) {
  const sb = box?.querySelector('.u3-hm-sb');
  const info = sb?.querySelector('.u3-hm-sinfo');
  if (!sb || !info) return;
  sb.classList.remove('is-line', 'is-tight', 'is-tighter', 'is-nolabel', 'is-noart', 'is-noline', 'is-norl');
  const over = () => info.scrollHeight > info.clientHeight + 1 || info.scrollWidth > info.clientWidth + 1 || sb.scrollHeight > sb.clientHeight + 1 || sb.scrollWidth > sb.clientWidth + 1;
  if (topMode(document.body.dataset.size, false) === 'line') sb.classList.add('is-line');
  if (over() && !sb.classList.contains('is-line')) sb.classList.add('is-line');
  if (over()) { sb.classList.add('is-tight'); if (over()) { sb.classList.add('is-tighter'); if (over()) { sb.classList.add('is-nolabel'); if (over()) { sb.classList.add('is-noart'); if (over()) { sb.classList.add('is-noline'); if (over()) sb.classList.add('is-norl'); } } } } }   // the last steps: the line without its label (aria-label keeps it), then the text column alone (a decorative picture gives its width back), then no Top line: on the smallest phone (375x667) the text still ran over the slide control (Nathan 2026-10-11, "this needs to be fixed")
}

// ---- The Events slide (UI-05 review-5, D-184 to D-188, condition A; flag `events`) ----
/** The live events from /api/events, the one that ends first first (D-187). A scheduled event (not started) is not live. */
export function liveEvents(list, now = Date.now()) {
  return (Array.isArray(list) ? list : []).map(norm).filter((e) => e.k && Number.isFinite(e.start) && Number.isFinite(e.end) && isLive(e, now)).sort((a, b) => a.end - b.end || a.start - b.start);
}
const evRow = (e, now) => `<li class="u3-hm-evr" style="--k:${KINDS[e.k].color}">${icon(KINDS[e.k].icon)}<b class="u3-hm-evn">${breakable(esc(e.title))}</b><em class="u3-hm-evd">Ends in ${esc(left(e.end - now))}</em></li>`;
/** The Events slide. list = liveEvents(...) (not empty). The "Also live" place is ALWAYS kept, empty with one live event (condition A, D-165). */
export function eventsSlideHTML(list, now = Date.now()) {
  const e = list[0]; const more = list.slice(1);
  const k = KINDS[e.k];
  const url = artURL(e);
  const art2 = `<div class="u3-hm-sart"><div class="u3-hm-simg u3-hm-eimg" style="--t:${themeVar(e)}${url ? '' : `;--k:${k.color}`}" aria-hidden="true">`
    + (url ? `<img src="${esc(url)}" alt="">` : `<span class="u3-hm-eico">${icon(k.icon, { size: '2xl' })}</span>`) + '</div></div>';
  const body = `<div class="u3-hm-i1"><span class="u3-hm-chip is-live"><i class="u3-hm-livedot"></i>Event · Live now</span>`
    + `<div class="u3-hm-strow"><h2 class="u3-hm-title" style="--k:${k.color}">${icon(k.icon, { size: 'lg' })}<span>${breakable(esc(e.title))}</span></h2></div></div>`
    + `<div class="u3-hm-next u3-hm-stimer">${icon('timer')}<span>Ends in</span><b data-hms="${esc(e.ends_at)}">${hms(e.ends_at, now)}</b></div>`
    + `<div class="u3-hm-rule"><span class="u3-hm-rl">What changes</span><b>${breakable(esc(e.changes.length ? e.changes.map((c) => c.text).join(', ') : (e.description || k.label)))}</b></div>`
    + alsoLive(more, now) + alsoLine(more, now);
  return slide('events', art2, body);
}
/** The Also live box (rows: at most 2, then "+N more", D-187). With no other event it holds its place, hidden. */
function alsoLive(more, now) {
  if (!more.length) return `<div class="u3-hm-sboard is-held" aria-hidden="true"><span class="u3-hm-sbt">Also live</span><ul class="u3-hm-sbl"><li class="u3-hm-evr"><b class="u3-hm-evn">&nbsp;</b></li></ul></div>`;
  const n = more.length - 2;
  return `<button type="button" class="u3-hm-sboard" data-slide-open="events" aria-label="${esc(`Also live: ${more.map((e) => e.title).join(', ')}`)}"><span class="u3-hm-sbt">Also live</span>`
    + `<ul class="u3-hm-sbl">${more.slice(0, 2).map((e) => evRow(e, now)).join('')}</ul>${n > 0 ? `<span class="u3-hm-evm">+${n} more</span>` : ''}</button>`;
}
/** The one line of the compact classes: "Also live: <next> · <ends in or +N more>". */
function alsoLine(more, now) {
  if (!more.length) return '<span class="u3-hm-top u3-hm-sline is-held" aria-hidden="true"><span class="u3-hm-topt">&nbsp;</span></span>';
  const e = more[0];
  return `<button type="button" class="u3-hm-top u3-hm-sline" data-slide-open="events" aria-label="${esc(`Also live: ${more.map((x) => x.title).join(', ')}`)}"><span class="u3-hm-topt"><span class="u3-hm-topl">Also live:</span> <b>${breakable(esc(e.title))}</b> <i>·</i> <em>${more.length > 1 ? `+${more.length - 1} more` : `Ends in ${esc(left(e.end - now))}`}</em></span></button>`;
}
