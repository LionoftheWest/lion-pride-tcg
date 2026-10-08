// UI-65: the one Member picker (docs/design.md 6.5 pickers, 6.5b; D-43, D-64). Approved: design repo UI-65/approved
// (review-2). Trades (UI-25), Gift, Boons & pranks (UI-27, UI-28) and profiles start with it. It fills the content area
// of its screen (in Trades it IS the Trades tab content): the search "Find a member" with the suggest list under it
// ("No member with that name"), then the member sections (Frequent, Recent; In voice and All members with the pager
// when a member has few partners, D-64 item 5). Every member tile has two tap targets (D-64 item 4): the magnifier
// opens the Profile (UI-14), the rest of the tile picks the member (Trades: the Trade window UI-63).
// The caller gives the sections and the actions; this module owns the layout, the search and the fit (no scroll, P1).
import { esc, searchField, pager } from './components.js';
import { icon } from './icons.js';

/** The match in a name, marked (the typed part in gold, UI-29). Escapes the name. Pure (unit-tested). */
export function markMatch(name, q) {
  const n = String(name ?? ''), t = String(q ?? '').trim();
  const i = t ? n.toLowerCase().indexOf(t.toLowerCase()) : -1;
  if (i < 0) return breakName(n);
  return `${breakName(n.slice(0, i))}<b>${esc(n.slice(i, i + t.length))}</b>${breakName(n.slice(i + t.length))}`;
}

/** A name never ends in "…" (D-08): break points after _ . - , between a letter and a digit, and at camelCase.
 *  Escapes the name. Pure (unit-tested). */
export function breakName(name) {
  return esc(name)
    .replace(/(?<=[a-z0-9])([_.\-])(?=[a-z0-9])/gi, '$1<wbr>')
    .replace(/([a-z])(?=[A-Z])/g, '$1<wbr>')
    .replace(/([a-z])(?=[0-9])/gi, '$1<wbr>');
}

/**
 * The member lists (6.5b, D-64 items 5 and 9). Pure (unit-tested).
 * history: [{ id, name, at }] one entry for each trade or offer with a partner (either direction).
 * voice: [{ id, name }] the members in voice now, in the voice order. all: [{ id, name }] every member (any order).
 * Frequent = the partners with 2 or more trades and offers, the most first (then the latest), up to 3.
 * Recent = the other partners, the latest first. In voice = the members in voice who are not partners.
 * All members = A to Z, without the members above. A member shows only once; never the member (me).
 */
export function memberLists({ history = [], voice = [], all = [], me = null } = {}) {
  const self = me == null ? null : String(me);
  const by = new Map();
  for (const h of history) {
    const id = String(h.id);
    if (!h.id || id === self) continue;
    const t = Date.parse(h.at) || 0;
    const p = by.get(id) || { id, name: h.name, n: 0, at: 0 };
    p.n += 1;
    if (t >= p.at) { p.at = t; if (h.name) p.name = h.name; }
    by.set(id, p);
  }
  const partners = [...by.values()];
  const frequent = partners.filter((p) => p.n >= 2).sort((a, b) => b.n - a.n || b.at - a.at).slice(0, 3);
  const fIds = new Set(frequent.map((p) => p.id));
  const recent = partners.filter((p) => !fIds.has(p.id)).sort((a, b) => b.at - a.at);
  const seen = new Set([...partners.map((p) => p.id), ...(self ? [self] : [])]);
  const inVoice = [];
  for (const v of voice) { const id = String(v.id); if (!seen.has(id)) { seen.add(id); inVoice.push({ id, name: v.name }); } }
  const az = all.map((m) => ({ id: String(m.id), name: m.name })).filter((m) => !seen.has(m.id) && (seen.add(m.id), true))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'en', { sensitivity: 'base' }));
  const strip = ({ id, name }) => ({ id, name });
  return { frequent: frequent.map(strip), recent: recent.map(strip), voice: inVoice, all: az };
}

const FITS = ['lg', 'md', 'sm', 'list'];   // the avatar sizes the fit tries (UI-65: 56, 38 on compact-land, 28 at 375x667), then list tiles
let seq = 0;

/**
 * Put the Member picker into host (an element with a definite height). Returns { update(opts), destroy() }.
 * opts: {
 *   sections: [{ key, label, members: [{ id, name }], form: 'avatar' | 'list', paged: false }],
 *     (paged: the last section pages with the Pager "1 / N", D-36; the other sections show the whole tiles that fit)
 *   search(q) -> Promise<[{ id, name }]>  the suggest list (the server match, best first), at most 6 show,
 *   onPick(member), onProfile(member),
 *   lead, trail: HTML before and after the search (the view "?", the Pending button: UI-25 owns them),
 *   blocked(member) -> reason or '' (the tile greys out with the reason, for example a daily limit; UI-28),
 *   avatarUrl(member) (default /api/avatar/<id>), placeholder (default "Find a member"),
 * }
 */
export function mountMemberPicker(host, opts) {
  const id = `u3Mp${++seq}`;
  const st = { opts: { ...opts }, q: '', sugg: null, page: 0, per: 0, fit: 0, timer: null, ask: 0, alive: true };
  host.innerHTML = `<div class="u3-mp" id="${id}"><div class="u3-mp__tools">${st.opts.lead || ''}<div class="u3-mp__find">${field('')}</div>${st.opts.trail || ''}</div>`
    + '<div class="u3-mp__body"></div></div>';
  const root = host.querySelector('.u3-mp');
  const body = root.querySelector('.u3-mp__body');
  const find = root.querySelector('.u3-mp__find');
  const url = (m) => (st.opts.avatarUrl ? st.opts.avatarUrl(m) : `/api/avatar/${encodeURIComponent(m.id)}`);

  function field(value) {
    return searchField({ value, placeholder: st.opts.placeholder || 'Find a member', label: st.opts.placeholder || 'Find a member', clearLabel: 'Clear search' });
  }
  const avatar = (m) => `<span class="u3-mp-av" aria-hidden="true"><span>${esc(String(m.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`
    + `<img src="${esc(url(m))}" alt="" loading="lazy" draggable="false"></span>`;

  function tileHTML(m, form, key, i) {
    const why = st.opts.blocked?.(m) || '';
    const name = esc(m.name || 'Member');
    return `<li class="u3-mp-tile u3-mp-tile--${form}${why ? ' is-off' : ''}">`
      + `<button type="button" class="u3-mp-tile__pick" data-mpick="${key}:${i}" aria-label="${name}${why ? `, ${esc(why)}` : ''}"${why ? ' aria-disabled="true"' : ''}>`
      + `${avatar(m)}<span class="u3-mp-tile__name">${name}</span>${why ? `<span class="u3-mp-tile__why">${esc(why)}</span>` : ''}</button>`
      + `<button type="button" class="u3-mp-tile__info" data-mprof="${key}:${i}" aria-label="Open ${name}'s profile">${icon('search')}</button></li>`;
  }

  function sectionsList() { return (st.opts.sections || []).filter((s) => (s.members || []).length); }

  function paint() {
    if (!st.alive) return;
    // the host edges: the keyboard layer (ui3.css body[data-kb]) keeps the picker's own left and right edges
    const hr = host.getBoundingClientRect();
    root.style.setProperty('--mp-host-l', `${Math.round(hr.left)}px`);
    root.style.setProperty('--mp-host-r', `${Math.round(innerWidth - hr.right)}px`);
    const list = sectionsList();
    body.dataset.fit = FITS[st.fit];
    body.classList.toggle('has-paged', !!list.at(-1)?.paged);
    body.innerHTML = list.map((s, k) => {
      const paged = s.paged && k === list.length - 1;
      let ms = s.members.map((m, i) => [m, i]);
      let pages = 1;
      if (paged && st.per) { pages = Math.max(1, Math.ceil(ms.length / st.per)); st.page = Math.min(st.page, pages - 1); ms = ms.slice(st.page * st.per, st.page * st.per + st.per); }
      return `<section class="u3-mp-sec${paged ? ' is-paged' : ''}" aria-label="${esc(s.label)}"><h3 class="u3-label u3-mp-sec__label">${esc(s.label)}</h3>`
        + `<ul class="u3-mp-sec__tiles u3-mp-sec__tiles--${s.form === 'list' ? 'list' : 'avatar'}" data-sec="${esc(s.key)}">`
        + ms.map(([m, i]) => tileHTML(m, s.form === 'list' ? 'list' : 'avatar', s.key, i)).join('') + '</ul>'
        + `${paged ? `<div class="u3-mp-sec__pager">${pager({ page: st.page + 1, pages })}</div>` : ''}</section>`;
    }).join('');
    fit();
  }

  // No scroll (P1, 3.4): a smaller avatar first (lg, md, sm), then list tiles, then only whole tile rows of the unpaged sections.
  // The paged section gets the rows that fit in its area. A long name first gets smaller (to 11 px), then wraps (D-08).
  function fit() {
    for (const n of body.querySelectorAll('.u3-mp-tile__name')) {
      let k = 0;
      while (n.scrollWidth > n.clientWidth + 0.5 && k < 6) {
        n.dataset.shrink = String(++k);
        if (k === 5) n.innerHTML = breakName(n.textContent);   // 11 px is not enough: the break points
      }
    }
    const over = () => body.scrollHeight > body.clientHeight + 0.5;
    const paged = body.querySelector('.u3-mp-sec.is-paged .u3-mp-sec__tiles');
    if (paged && !st.per) {
      // measure one page: the rows that fit in the space left under the other sections
      const tiles = [...paged.children];
      if (tiles.length) {
        const cols = getComputedStyle(paged).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
        const gap = parseFloat(getComputedStyle(paged).rowGap) || 0;
        const h = tiles[0].getBoundingClientRect().height;
        const free = body.clientHeight - (body.scrollHeight - paged.getBoundingClientRect().height);
        const rows = Math.max(1, Math.floor((free + gap) / (h + gap)));
        st.per = cols * rows;
        if (st.per < tiles.length) { paint(); return; }
      }
    }
    if (over() && st.fit < FITS.length - 1) { st.fit += 1; st.per = 0; paint(); return; }
    if (over()) {
      for (const ul of [...body.querySelectorAll('.u3-mp-sec:not(.is-paged) .u3-mp-sec__tiles')].reverse()) {
        for (;;) {
          const top = ul.lastElementChild.getBoundingClientRect().top;
          const row = [...ul.children].filter((li) => li.getBoundingClientRect().top >= top - 0.5);
          if (!over() || row.length === ul.children.length) break;   // the first row of a section stays
          row.forEach((li) => li.remove());
        }
        if (!over()) break;
      }
    }
    // Still too short (tiny, a landscape phone with the safe insets): the last sections go, then the last tiles of
    // the first section, so that nothing shows cut (3.3). The search finds every member.
    const secs = [...body.querySelectorAll('.u3-mp-sec')];
    while (over() && secs.length > 1) secs.pop().remove();
    const first = secs[0]?.querySelector('.u3-mp-sec__tiles');
    while (over() && first?.children.length) first.lastElementChild.remove();
    if (over() || (first && !first.children.length)) secs[0]?.remove();
  }

  // ---- the search and its suggest list (UI-29, unchanged look: avatar, name with the match in gold) ----
  function closeSuggest() { st.sugg = null; root.querySelector('.u3-mp-sug')?.remove(); }
  function showSuggest() {
    const had = root.querySelector('.u3-mp-sug');
    had?.remove();
    if (!st.sugg || !st.q.trim()) return;
    // the list is as wide as the dialog width at most, and ends at the right edge of the picker
    find.style.setProperty('--mp-room', `${Math.max(0, root.getBoundingClientRect().right - find.getBoundingClientRect().left)}px`);
    const rows = st.sugg.length
      ? st.sugg.map((m, i) => `<button type="button" class="u3-mp-sug__row" role="option" aria-selected="${i === 0 ? 'true' : 'false'}" data-msug="${i}">${avatar(m)}<span>${markMatch(m.name, st.q)}</span></button>`).join('')
      : '<p class="u3-mp-sug__none">No member with that name</p>';
    find.insertAdjacentHTML('beforeend', `<div class="u3-mp-sug${had ? ' is-still' : ''}" role="listbox" aria-label="Members">${rows}</div>`);
    // only whole rows above the dock and the frame bottom (a short frame, the keyboard): no row under another layer
    const box = find.querySelector('.u3-mp-sug');
    const floor = Math.min(innerHeight, document.getElementById('dock')?.getBoundingClientRect().top || innerHeight);
    while (box.children.length > 1 && box.getBoundingClientRect().bottom > floor) box.lastElementChild.remove();
  }
  function syncClear() {
    // the clear button shows only with text (SearchField): swap the field, keep the focus and the caret
    const has = !!find.querySelector('.u3-search .u3-ibtn');
    if (has === !!st.q) return;
    const inp = find.querySelector('.u3-search__input');
    const at = inp?.selectionStart ?? st.q.length;
    const focused = document.activeElement === inp;
    find.querySelector('.u3-search').outerHTML = field(st.q);
    const n = find.querySelector('.u3-search__input');
    if (focused) { n.focus({ preventScroll: true }); try { n.setSelectionRange(at, at); } catch { /* not a text box */ } }
  }
  // a pick empties the search (as v2 Trades): back from the Trade window, the field is ready for the next name
  async function pick(m) {
    closeSuggest(); clearTimeout(st.timer); st.ask += 1;
    st.q = ''; const inp = find.querySelector('.u3-search__input'); if (inp) inp.value = ''; syncClear();
    await st.opts.onPick?.(m);
  }

  const onInput = (e) => {
    if (!e.target.classList.contains('u3-search__input')) return;
    st.q = e.target.value;
    syncClear();
    clearTimeout(st.timer);
    const q = st.q.trim();
    if (!q) { closeSuggest(); return; }
    const ask = ++st.ask;
    st.timer = setTimeout(async () => {
      let found = [];
      try { found = (await st.opts.search?.(q)) || []; } catch { return; }   // keep the last list
      if (ask !== st.ask || !st.alive) return;   // a newer letter is on its way
      st.sugg = found.slice(0, 6);
      showSuggest();
    }, 150);
  };
  const onKey = (e) => {
    if (!e.target.classList?.contains('u3-search__input')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); }   // the list closes; the text stays (the search input would clear it)
    if (e.key === 'Enter' && st.sugg?.[0]) { e.preventDefault(); pick(st.sugg[0]); }
  };
  const onDown = (e) => { if (e.target.closest('.u3-mp-sug')) e.preventDefault(); };   // the box keeps the focus; the pick waits for the click
  const member = (ref) => { const [k, i] = String(ref).split(':'); return (st.opts.sections || []).find((s) => s.key === k)?.members?.[Number(i)]; };
  const onClick = (e) => {
    if (!root.isConnected) { destroy(); return; }   // the screen repainted without destroy(): let go of the page
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) { if (!e.target.closest('.u3-mp__find')) closeSuggest(); return; }
    const d = t.dataset;
    if (d.msug != null) { const m = st.sugg?.[Number(d.msug)]; if (m) pick(m); return; }
    if (t.matches('.u3-search .u3-ibtn')) { st.q = ''; closeSuggest(); syncClear(); find.querySelector('.u3-search__input')?.focus({ preventScroll: true }); return; }
    if (d.mprof) { const m = member(d.mprof); if (m) { closeSuggest(); st.opts.onProfile?.(m); } return; }
    if (d.mpick) { if (t.getAttribute('aria-disabled') === 'true') return; const m = member(d.mpick); if (m) pick(m); return; }
    if (d.page && t.closest('.u3-mp-sec__pager')) { st.page += d.page === 'next' ? 1 : -1; paint(); }
  };
  const onBlur = () => setTimeout(() => { if (st.alive && !root.contains(document.activeElement)) closeSuggest(); }, 250);
  // a Discord avatar that is gone (404): the initial on the fallback gradient shows (the library Avatar fallback)
  const onErr = (e) => { if (e.target.tagName === 'IMG' && root.contains(e.target)) e.target.remove(); };
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('focusout', onBlur);
  root.addEventListener('error', onErr, true);
  document.addEventListener('click', onClick);
  let rt = 0;
  const refit = () => { st.fit = 0; st.per = 0; paint(); };
  const ro = new ResizeObserver(() => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { if (!root.isConnected) { destroy(); return; } refit(); if (st.sugg) showSuggest(); }); });
  ro.observe(body);
  paint();
  document.fonts?.ready.then(() => { if (st.alive) refit(); });   // the text sizes change when the fonts arrive

  function destroy() {
    if (!st.alive) return;
    st.alive = false; clearTimeout(st.timer); cancelAnimationFrame(rt); ro.disconnect();
    document.removeEventListener('click', onClick);
    root.remove();
  }
  return {
    /** New sections or actions (for example after a trade): the page and the search stay. */
    update(next) { if (!st.alive) return; Object.assign(st.opts, next); refit(); },
    destroy,
  };
}
