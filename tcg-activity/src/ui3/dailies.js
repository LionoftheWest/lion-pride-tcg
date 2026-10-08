// UI-36 the Dailies window, v3 (lion-pride-tcg-design UI-36/approved, review-1; FEEDBACK D-80 item 26). Only under
// body.ui-v3 (settings.ui_v3): ui-v2-dailies.js paints this HTML in place of its v2 markup and keeps all of its logic
// (the fetch, the claims, the badge, the 10 s refresh). With the flag off nothing here runs.
// - Every number comes from the server (/api/dailies: dailies_view and the balance key 'daily', src/dailies-pay.js
//   dailyExtras). This module keeps no copy of a cap, a reward or the streak week.
// - The window: a bottom sheet on the dock edge on compact-port, one column; a 2-column window in the safe frame on
//   compact-land; a 2-column panel under the top bar on medium (landscape) and expanded; a 1-column panel on medium
//   portrait (ui3.css "Dailies window").
import { esc, counter, button, iconButton, pager } from './components.js';
import { icon } from './icons.js';
import { fmtFull, fmtFor } from './number.js';

const NAME = { checkin: 'Check in', chat: 'Chat', hunt: 'Hunt the boss', voice: 'Voice with someone', social: 'Trade or boon', dungeon: 'Dungeon run', gauntlet: 'Gauntlet run' };
const UNIT = { chat: 'msgs', hunt: 'cards', voice: 'min' };
const ICON = { checkin: 'calendar-check', chat: 'message-circle', hunt: 'swords', voice: 'headphones', social: 'arrow-left-right', dungeon: 'castle', gauntlet: 'crown' };
const num = (n) => Number(n) || 0;
// The number form of this render: the compact form from 10,000 on the compact classes (10.5, G-168).
let fmt = fmtFull;

/** The dailies a member can claim now (the Counter): not while paused, not when the cap stops the packs and no Shards
 *  are paid (a daily at the cap still pays its Shards). */
export function readyTasks(v) {
  if (!v?.enabled || v.paused) return [];
  if (num(v.earned) >= num(v.cap) && !num(v.shards)) return [];
  return (v.tasks || []).filter((t) => !t.auto && t.done && !t.claimed);
}
/** The packs that wait: the ready rewards, never past the cap. */
export const readyPacks = (v) => Math.min(readyTasks(v).reduce((n, t) => n + num(t.reward), 0), Math.max(0, num(v?.cap) - num(v?.earned)));
/** The packs one daily pays now: its reward, never past the cap (dailies-pay.js payNow, the same rule). */
const payNow = (v, t) => Math.max(0, Math.min(num(t.reward), num(v.cap) - num(v.earned)));

/** The reset chip (10.5, D-15; FEEDBACK D-80 item 26): "Resets in 8h 23m · midnight MT". The two largest units. */
export function resetText(v, now = Date.now()) {
  if (v?.paused) return 'Paused';
  const ms = Math.max(0, new Date(v?.resets_at).getTime() - now);
  if (!Number.isFinite(ms)) return 'Resets at midnight MT';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return `Resets in ${h ? `${h}h ${m}m` : `${m}m`} · midnight MT`;
}

/** The streak marks of this week: the day of this claim (or of the last claim) and the week length from the server.
 *  done = before today, today = the gold ring (filled when claimed), to come = plain. */
export function streakMarks(t, cycle) {
  const n = num(cycle);
  if (n < 1) return { day: t.claimed ? num(t.streak) : num(t.streak) + 1, marks: [] };
  const day = t.claimed ? num(t.streak) : num(t.streak) + 1;
  const pos = ((Math.max(1, day) - 1) % n) + 1;
  return { day, marks: Array.from({ length: n }, (_, i) => (i + 1 < pos ? 'done' : i + 1 === pos ? (t.claimed ? 'today done' : 'today') : 'next')) };
}

const coin = () => icon('hexagon', { size: 'sm', cls: 'u3-coin' });
const packChip = (n) => `<span class="u3-dl-chip">${icon('package', { size: 'sm' })}<span>+${fmt(n)}</span></span>`;
const paidChip = (n, sm = false) => `<span class="u3-dl-chip u3-dl-chip--paid${sm ? ' u3-dl-chip--sm' : ''}">${icon('check', { size: 'sm' })}<span>+${fmt(n)}</span></span>`;
const shardChip = (v) => (num(v.shards) ? `<span class="u3-dl-chip u3-dl-chip--shards">${coin()}<span>+${fmt(v.shards)}</span></span>` : '');
const bar = (t) => `<span class="u3-dl-bar" aria-hidden="true"><span style="--u3-v:${Math.round(Math.min(1, num(t.have) / (num(t.need) || 1)) * 100)}%"></span></span>`;

function taskRow(v, t) {
  const go = !v.paused && !t.auto && t.done && !t.claimed;
  const pay = payNow(v, t);
  let title = `<span class="u3-dl-task__name">${esc(NAME[t.task] || t.task)}</span>`;
  let sub = '', end = '', streak = '';
  if (t.task === 'checkin') {
    const { day, marks } = streakMarks(t, v.streak_cycle);
    streak = `<span class="u3-dl-streak"><span class="u3-dl-day">Day ${fmt(day)}</span>${marks.length ? `<span class="u3-dl-marks" role="img" aria-label="Day ${fmt(day)} of ${fmt(marks.length)}">${marks.map((m) => `<span class="u3-dl-mark ${m.split(' ').map((c) => `is-${c}`).join(' ')}">${icon('flame', { size: 'sm' })}</span>`).join('')}</span>` : ''}</span>`;
  } else if (t.task === 'hunt' && !t.live && !num(t.have)) {
    sub = '<span class="u3-dl-task__note">No boss</span>';
  } else if (['social', 'hunt', 'dungeon', 'gauntlet'].includes(t.task)) {
    sub = t.claimed || t.done ? '' : `${bar(t)}<span class="u3-dl-task__count">${fmt(t.have)}/<wbr>${fmt(t.need)}</span>`;
  } else {
    sub = `${bar(t)}<span class="u3-dl-task__count">${fmt(t.have)}/<wbr>${fmt(t.need)} ${UNIT[t.task] || ''}</span>`;
  }
  if (t.task === 'chat') {
    if (num(t.packs)) title += paidChip(t.packs, true);
    end = `<span class="u3-dl-task__auto"><span class="u3-dl-task__chips">${num(t.max) && num(t.packs) >= num(t.max) ? paidChip(t.packs) : num(t.next) ? packChip(t.next) : ''}${shardChip(v)}</span><span class="u3-label">Auto</span></span>`;
  } else if (t.claimed) end = `<span class="u3-dl-task__chips">${paidChip(t.reward)}${shardChip(v)}</span>`;
  else if (go) {
    const capped = num(v.earned) >= num(v.cap);
    end = button({ label: capped ? 'Claim' : `Claim +${fmt(pay)}`, variant: 'primary', icon: capped ? null : 'package', reward: num(v.shards) ? `+${fmt(v.shards)}` : null, data: { task: t.task } });
  } else end = `<span class="u3-dl-task__chips">${packChip(pay)}${shardChip(v)}</span>`;
  const cls = ['u3-dl-task', `k-${t.task}`, go && 'is-go', t.claimed && 'is-claimed', sub && 'has-sub'].filter(Boolean).join(' ');
  return `<div class="${cls}"><span class="u3-dl-task__ico">${icon(ICON[t.task] || 'calendar-check', { size: 'xl' })}</span>`
    + `<span class="u3-dl-task__main"><span class="u3-dl-task__title">${title}</span>${sub ? `<span class="u3-dl-task__sub">${sub}</span>` : ''}</span>`
    + `${streak}<span class="u3-dl-task__end">${end}</span></div>`;
}

/** The window's inside. view = the /api/dailies answer. perPage = the tasks on one page (0 = all, no
 *  pager; ui-v2-dailies.js fitV3 measures it only when the tight spacing does not fit, 3.5). size = the size class. */
export function dailiesHTML(v, { now = Date.now(), page = 1, perPage = 0, size = '' } = {}) {
  fmt = (n) => fmtFor(n, size);
  const head = (n, reset = true) => `<header class="u3-dl__head"><h2 class="u3-dl__title" id="u3DlTitle">Dailies</h2>${n ? counter(n) : ''}`
    + `${reset ? `<span class="u3-dl__reset">${icon('rotate-ccw')}<span>${esc(resetText(v, now))}</span></span>` : ''}`
    + `${iconButton({ icon: 'x', label: 'Close', data: { 'dl-close': '1' } })}</header>`;
  if (!v?.enabled) return `${head(0, false)}<p class="u3-dl__empty">Nothing here yet.</p>`;
  const ready = readyTasks(v), n = ready.length, rp = readyPacks(v);
  const cap = num(v.cap), earned = Math.min(num(v.earned), cap);
  const seg = Array.from({ length: cap }, (_, i) => `<span class="u3-dl-seg__s${i < earned ? ' is-on' : i < earned + rp ? ' is-ready' : ''}"></span>`).join('');
  const all = (rp > 0 || num(v.shards)) && n > 1
    ? button({ label: rp ? `Claim all +${fmt(rp)}` : 'Claim all', variant: 'primary', icon: rp ? 'package' : null, reward: num(v.shards) ? `+${fmt(n * num(v.shards))}` : null, disabled: !!v.paused, data: { all: '1' } })
    : '';
  const sum = `<section class="u3-dl__sum" aria-label="Today"><span class="u3-label u3-dl__k">Today</span>`
    + `<span class="u3-dl__nums"><span class="u3-dl__packs"><b>${fmt(earned)}</b><span>/ ${fmt(cap)} packs</span></span>`
    + `${num(v.shards) ? `<span class="u3-dl__shards">${icon('hexagon', { size: 'lg', cls: 'u3-coin' })}<b>${fmt(v.shards_today)}</b><span>Shards</span></span>` : ''}</span>`
    + `${all ? `<span class="u3-dl__all">${all}</span>` : ''}`
    + `<span class="u3-dl-seg" role="img" aria-label="${fmt(earned)} of ${fmt(cap)} packs">${seg}</span>`
    + `<span class="u3-dl__legend"><span><i class="is-on"></i>${fmt(earned)} earned</span><span><i class="is-ready"></i>${fmt(rp)} ready</span><span><i></i>${fmt(Math.max(0, cap - earned - rp))} to go</span></span></section>`;
  const tasks = v.tasks || [];
  const per = perPage > 0 && perPage < tasks.length ? perPage : tasks.length;
  const pages = Math.max(1, Math.ceil(tasks.length / Math.max(1, per)));
  const pg = Math.min(Math.max(1, page | 0), pages);
  const shown = tasks.slice((pg - 1) * per, pg * per);
  return `${head(n)}${sum}<div class="u3-dl__list">${shown.map((t) => taskRow(v, t)).join('')}</div>`
    + `${pages > 1 ? `<div class="u3-dl__pager">${pager({ page: pg, pages })}</div>` : ''}`;
}
