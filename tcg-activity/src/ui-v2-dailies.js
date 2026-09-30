// The Dailies window (Nathan, 2026-09-30; design 18 approved the same day): today's tasks,
// their progress, and a Claim button for each one that is done, plus Claim all. The data
// and every rule come from dailies.sql (/api/dailies). The header button stays hidden
// while the Dailies flag is off.

import { v2ctx, toast } from './ui-v2.js';

const ctx = () => v2ctx();
const esc = (s) => ctx().esc(s ?? '');
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  checkin: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>'),
  chat: svg('<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5z"/>'),
  hunt: svg('<path d="m14.5 17.5 5-5"/><path d="m3 3 11 11"/><path d="m21 3-11 11"/><path d="m9.5 17.5-5-5"/><path d="M3 21l3-3"/><path d="m21 21-3-3"/>'),
  voice: svg('<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>'),
  social: svg('<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>'),
  pack: svg('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
};
const NAME = { checkin: 'Check in', chat: 'Chat', hunt: 'Hunt the boss', voice: 'Voice with someone', social: 'Trade or boon' };
const UNIT = { chat: 'msgs', hunt: 'cards', voice: 'min' };
let view = null;
let tickTimer = null;

const ready = (v) => (v?.enabled && !v.paused ? v.tasks.filter((t) => !t.auto && t.done && !t.claimed) : []);
const readyPacks = (v) => Math.min(ready(v).reduce((n, t) => n + (t.reward || 0), 0), Math.max(0, (v?.cap || 0) - (v?.earned || 0)));

function paintBadge() {
  const btn = ctx().el('dailyBtn');
  if (!btn) return;
  btn.classList.toggle('hidden', !view?.enabled);
  const n = ready(view).length;
  btn.classList.toggle('dl-hot', n > 0);
  let b = btn.querySelector('.navbadge');
  if (n > 0) { if (!b) { b = document.createElement('span'); b.className = 'navbadge'; btn.appendChild(b); } b.textContent = n; }
  else if (b) b.remove();
}

export async function refreshDailies() {
  try { view = await ctx().api('/api/dailies'); } catch { view = null; }
  paintBadge();
  const box = ctx().el('v2Dailies');
  if (box && !box.classList.contains('hidden')) paint();
}

export function initDailies() {
  const btn = ctx().el('dailyBtn');
  if (!btn) return;
  btn.innerHTML = ICON.checkin;
  btn.addEventListener('click', openDailiesV2);
  refreshDailies();
  setInterval(refreshDailies, 60000);
}

function left(iso) {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

const bar = (t) => `<i class="dl-bar"><i style="width:${Math.min(100, (100 * (t.have || 0)) / (t.need || 1))}%"></i></i>`;
const claimBtn = (task, n, paused) => `<button class="v2-btn gold dl-claim" data-task="${esc(task)}"${paused ? ' disabled' : ''}>${ICON.pack}Claim +${n}</button>`;
const chip = (n, cls = '') => `<span class="dl-chip ${cls}">${cls === 'ok' ? ICON.check : ICON.pack}+${n}</span>`;

// The 7 flames of this week of the streak: done, today, and to come.
function flames(t) {
  const day = t.claimed ? t.streak : t.streak + 1; // the day this claim is (or was)
  const pos = ((day - 1) % 7) + 1;
  return `<span class="dl-flames">${[1, 2, 3, 4, 5, 6, 7].map((i) => `<i class="${i < pos ? 'on' : i === pos ? (t.claimed ? 'on today' : 'today') : ''}">🔥</i>`).join('')}</span>`;
}

function row(t, paused) {
  const go = !t.auto && t.done && !t.claimed;
  let title = esc(NAME[t.task] || t.task), sub = '', right = '';
  if (t.task === 'checkin') {
    const day = t.claimed ? t.streak : t.streak + 1;
    title += ` <span class="dl-day">DAY ${day}</span>`;
    sub = `${flames(t)}${t.reward > 1 ? '<span class="dl-bonus">+1 bonus</span>' : ''}`;
  } else if (t.task === 'hunt' && !t.live && !t.have) {
    sub = '<span class="dl-dim">No boss</span>';
  } else if (t.task === 'social') {
    sub = t.claimed || t.done ? '' : `${bar(t)}<span class="mono">${t.have}/${t.need}</span>`;
  } else {
    sub = `${bar(t)}<span class="mono">${t.have}/${t.need} ${UNIT[t.task] || ''}</span>`;
  }
  if (t.task === 'chat') {
    if (t.packs) title += ` ${chip(t.packs, 'ok sm')}`;
    right = `<span class="dl-auto">${t.packs < t.max ? chip(1) : chip(t.packs, 'ok')}<small>AUTO</small></span>`;
  } else if (t.claimed) right = chip(t.reward, 'ok');
  else if (go) right = claimBtn(t.task, t.reward, paused);
  else right = chip(t.reward);
  return `<div class="dl-row k-${esc(t.task)}${go ? ' go' : ''}${t.claimed ? ' claimed' : ''}"><span class="dl-ico">${ICON[t.task] || ''}</span>
    <div class="dl-t"><b>${title}</b>${sub ? `<span class="dl-sub">${sub}</span>` : ''}</div>${right}</div>`;
}

function paint() {
  const box = ctx().el('v2Dailies');
  if (!box || !view) return;
  if (!view.enabled) { box.innerHTML = '<p class="v2-empty">Nothing here yet.</p>'; return; }
  const n = ready(view).length, rp = readyPacks(view), cap = view.cap || 7, earned = Math.min(view.earned, cap);
  const seg = Array.from({ length: cap }, (_, i) => `<i class="${i < earned ? 'on' : i < earned + rp ? 'ready' : ''}"></i>`).join('');
  box.innerHTML = `<div class="nt-head"><h3>Dailies</h3>${n ? `<span class="nt-count">${n}</span>` : ''}<span class="grow"></span>
      <span class="dl-reset">${ICON.reset}${view.paused ? 'Paused' : `Resets ${left(view.resets_at)}`}</span>
      <button class="v2-icon" id="dlClose" aria-label="Close">✕</button></div>
    <div class="dl-sum"><div class="dl-sum-top"><div><span class="dl-k">TODAY</span><b class="mono">${earned}</b><span class="mono">/ ${cap} packs</span></div>
      ${rp > 0 && n > 1 ? `<button class="v2-btn gold dl-all"${view.paused ? ' disabled' : ''}>${ICON.pack}Claim all +${rp}</button>` : ''}</div>
      <div class="dl-seg">${seg}</div>
      <div class="dl-legend"><span><i class="on"></i>${earned} earned</span><span><i class="ready"></i>${rp} ready</span><span><i></i>${Math.max(0, cap - earned - rp)} to go</span></div></div>
    <div class="dl-list">${view.tasks.map((t) => row(t, view.paused)).join('')}</div>`;
  box.querySelector('#dlClose')?.addEventListener('click', closeDailiesV2);
  box.querySelectorAll('.dl-claim').forEach((b) => b.addEventListener('click', () => claim(b, '/api/dailies/claim', { task: b.dataset.task })));
  box.querySelector('.dl-all')?.addEventListener('click', (e) => claim(e.currentTarget, '/api/dailies/claim-all', {}));
}

async function claim(b, path, body) {
  b.disabled = true;
  let r = null;
  try { r = await ctx().apiPost(path, body); } catch { r = null; }
  if (r?.ok) {
    toast(`🎁 +${r.packs} pack${r.packs === 1 ? '' : 's'}`);
    view = r.view || view;
    ctx().refreshPacks?.();
  } else {
    toast(r?.error === 'capped' ? `Daily limit: ${view?.cap} packs` : r?.error === 'paused' ? 'Paused' : 'Try again');
    await refreshDailies();
  }
  paintBadge();
  paint();
}

export async function openDailiesV2() {
  const { el } = ctx();
  let box = el('v2Dailies');
  if (!box) { document.body.insertAdjacentHTML('beforeend', '<div id="v2Dailies" class="v2-drop dl-drop hidden"></div>'); box = el('v2Dailies'); }
  if (!box.classList.contains('hidden')) { closeDailiesV2(); return; }
  box.classList.remove('hidden');
  if (!view) box.innerHTML = '<div class="v2-loading">Loading…</div>';
  else paint();
  await refreshDailies();
  paint();
  clearInterval(tickTimer);
  tickTimer = setInterval(refreshDailies, 10000); // while open: new chat, voice minutes, and the countdown within 10 s
  setTimeout(() => document.addEventListener('pointerdown', outside, { capture: true }), 0);
}
function outside(e) {
  const box = ctx().el('v2Dailies');
  if (box && !box.contains(e.target) && !e.target.closest('#dailyBtn')) closeDailiesV2();
}
export function closeDailiesV2() {
  const box = ctx().el('v2Dailies');
  if (!box || box.classList.contains('hidden')) return;
  box.classList.add('hidden');
  clearInterval(tickTimer);
  document.removeEventListener('pointerdown', outside, { capture: true });
}
