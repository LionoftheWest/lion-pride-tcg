// Lion Pride TCG - Admin view: the event calendar (F-1 PR 5, docs/foundations.md F-1 item 9: "just like a Google Calendar view").
//   #/events            the month (default: the current MT month; ?m=YYYY-MM another month, &open=<id> opens an event)
//   #/events/library    the event library (event_templates): the list, "create from template"
// A bar for each event across its days, one color and one icon for each group (D-186). A click on a bar opens the panel
// (every detail; every field that can still change is editable there). A click on an empty day creates an event on that
// day (blank or from a template). Drag moves an event; drag of an edge changes its length. A live event changes only its
// end, variables and theme (F-1 item 8). The pure logic (grid, bars, drag, DST) is calendar-core.js, tested in node.
// Data: /api/admin/events/calendar, /vars, /templates (src/admin-events-routes.js). Every text goes in as textContent.
import * as C from './calendar-core.js';
import { send, problems, statusOf, editor, factsList, payoutsTable, logTable, statusButtons, loadRegistry, KIND_LABEL, blank, varsText, themeText } from './events.js';

const MAX_LANES = 3;          // bars in a week row; the rest show as "+N more" (the coordinator fix for UI-62: no bar overflow)
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthTitle = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
const dayTitle = (d) => `${WEEKDAYS[C.weekday(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)} ${d.slice(0, 4)}`;
const dayStart = (d, time = '00:00') => C.mtToIso(`${d}T${time}`);

function catTag(k, ev) {
  const cat = C.category(ev);
  return k.h('span', { class: `cal-cat cat-${cat}` }, k.icon(C.CATEGORIES[cat].icon), C.CATEGORIES[cat].label);
}
const legend = (k) => k.h('div', { class: 'cal-legend', 'aria-label': 'Colors' },
  Object.entries(C.CATEGORIES).map(([cat, c]) => k.h('span', { class: `cal-cat cat-${cat}` }, k.icon(c.icon), c.label)),
  k.h('span', { class: 'cal-key st-draft' }, 'Draft'), k.h('span', { class: 'cal-key st-live' }, 'Live'));

/* ---------- a modal and the side panel ---------- */
function overlay(k, { title, cls = '', onClose }) {
  const { h, icon } = k;
  const body = h('div', { class: 'cal-ov-body' });
  const heading = h('h2', { class: 'cal-ov-title' }, title);
  const close = () => { back.remove(); el.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape' && document.body.lastElementChild === el) close(); };
  const back = h('div', { class: 'cal-back', onclick: close });
  const el = h('div', { class: `cal-ov ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : 'Event' },
    h('div', { class: 'cal-ov-head' }, heading, h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))), body);
  document.addEventListener('keydown', esc);
  document.body.append(back, el);
  el.querySelector('button')?.focus({ preventScroll: true });
  return { el, body, heading, close };
}

/* ---------- the month ---------- */
export function pageCalendar(main, q, k) {
  const { h, icon } = k;
  const today = C.mtDay(Date.now());
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(q.get('m') || '') ? q.get('m') : C.monthKey(today);
  const grid = C.monthGrid(ym);
  const go = (m) => { location.hash = m === C.monthKey(today) ? '#/events' : `#/events?m=${m}`; };
  const state = { rows: [], features: {}, registry: [], templates: null, now: Date.now() };

  main.append(k.pageHead('Events', `${monthTitle(ym)}. Mountain Time. Click a day to add an event; drag a bar to move it.`, h('div', { class: 'ev-actions' },
    h('a', { class: 'btn', href: '#/events/library' }, icon('layers'), 'Library'),
    h('a', { class: 'btn', href: '#/events/list' }, icon('table'), 'List'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => openCreate(C.monthKey(today) === ym ? today : `${ym}-01`) }, icon('plus'), 'New event'))));
  const hint = h('span', { class: 'cal-hint', role: 'status', 'aria-live': 'polite' });
  main.append(h('div', { class: 'cal-bar-top' },
    h('div', { class: 'cal-nav' },
      h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Previous month', onclick: () => go(C.addMonths(ym, -1)) }, icon('left')),
      h('button', { class: 'btn', type: 'button', onclick: () => go(C.monthKey(today)), disabled: ym === C.monthKey(today) }, 'Today'),
      h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Next month', onclick: () => go(C.addMonths(ym, 1)) }, icon('right')),
      h('h2', { class: 'cal-month' }, monthTitle(ym))),
    legend(k)));
  const msg = h('div', { class: 'cal-msg', role: 'status', 'aria-live': 'polite' });
  const box = h('div', { class: 'cal-box' });
  const dayList = h('div', { class: 'cal-daylist' });
  main.append(msg, box, dayList, hint);
  const say = (text, bad = false) => { msg.replaceChildren(text ? h('p', { class: bad ? 'ev-err' : 'cal-ok' }, text) : ''); };
  let selected = C.monthKey(today) === ym ? today : `${ym}-01`;

  async function load() {
    const [cal, registry] = await Promise.all([
      k.api(`/events/calendar?from=${encodeURIComponent(dayStart(grid.first))}&to=${encodeURIComponent(dayStart(C.addDays(grid.last, 1)))}`),
      loadRegistry(k).catch(() => [])]);
    state.rows = cal.rows || []; state.features = cal.features || {}; state.registry = registry; state.now = Date.parse(cal.now) || Date.now();
    return draw();
  }
  const reload = () => k.fill(box, load);

  /* the grid */
  function draw() {
    const cal = h('div', { class: 'cal', role: 'grid', 'aria-label': `Events in ${monthTitle(ym)}` });
    cal.append(h('div', { class: 'cal-head', role: 'row' }, WEEKDAYS.map((d) => h('div', { class: 'cal-wd', role: 'columnheader' }, d))));
    for (const week of grid.weeks) {
      const days = week.map((x) => x.day);
      const L = C.layoutWeek(days, state.rows, MAX_LANES);
      const row = h('div', { class: 'cal-week', role: 'row' });
      week.forEach(({ day, inMonth }, i) => {
        const n = C.eventsOnDay(day, state.rows).length;
        row.append(h('div', { class: `cal-day${inMonth ? '' : ' out'}${day === today ? ' today' : ''}${day === selected ? ' sel' : ''}`, 'data-day': day, role: 'gridcell', tabindex: '0',
          style: `grid-column: ${i + 1}`, 'aria-label': `${dayTitle(day)}, ${n} ${n === 1 ? 'event' : 'events'}. Enter: new event`,
          onclick: (e) => { if (!e.target.closest('.cal-bar, .cal-more')) pickDay(day); },
          onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openCreate(day); } },
        h('span', { class: 'cal-num' }, String(Number(day.slice(8))))));
      });
      for (const s of L.segs) row.append(bar(s));
      L.more.forEach((n, c) => { if (n) row.append(h('button', { class: 'cal-more', type: 'button', style: `grid-column: ${c + 1}`, onclick: () => openDay(days[c]) }, `+${n} more`)); });
      cal.append(row);
    }
    drawDayList();
    return cal;
  }
  // The phone shows thin bars (D-184) and the list of the selected day under the grid; the desktop opens the create dialog.
  const phone = () => window.matchMedia('(max-width: 760px)').matches;
  function pickDay(day) {
    if (!phone()) return openCreate(day);
    selected = day;
    for (const el of box.querySelectorAll('.cal-day')) el.classList.toggle('sel', el.dataset.day === day);
    drawDayList();
  }
  function drawDayList() {
    const evs = C.eventsOnDay(selected, state.rows);
    dayList.replaceChildren(h('div', { class: 'cal-dl-head' }, h('strong', null, dayTitle(selected)),
      h('button', { class: 'btn', type: 'button', onclick: () => openCreate(selected) }, icon('plus'), 'New event')),
    evs.length ? h('div', { class: 'cal-dl' }, evs.map((ev) => evItem(ev))) : h('div', { class: 'empty' }, 'No events on this day'));
  }
  const evItem = (ev, after) => h('button', { class: `cal-item cat-${C.category(ev)} st-${ev.status}`, type: 'button', onclick: () => { after?.(); openEvent(ev.id); } },
    icon(C.CATEGORIES[C.category(ev)].icon), h('span', { class: 'cal-item-t' }, h('strong', null, ev.title), h('span', { class: 'cal-item-s' }, `${k.when(ev.starts_at)} to ${k.when(C.shownEnd(ev))}`)),
    statusOf(k, ev.status));

  function bar(s) {
    const ev = s.ev, cat = C.category(ev), ok = C.dragAllowed(ev);
    const el = h('div', { class: `cal-bar cat-${cat} st-${ev.status}${s.contL ? ' cont-l' : ''}${s.contR ? ' cont-r' : ''}${ok.move ? ' can-move' : ''}`,
      style: `grid-column: ${s.col + 1} / span ${s.span}; grid-row: ${s.lane + 2}`, role: 'button', tabindex: '0', 'data-id': String(ev.id),
      title: `${ev.title}\n${KIND_LABEL[ev.kind] || ev.kind}, ${ev.status}\n${k.when(ev.starts_at, true)} to ${k.when(C.shownEnd(ev), true)} MT`,
      'aria-label': `${ev.title}, ${C.CATEGORIES[cat].label}, ${ev.status}, ${k.when(ev.starts_at)} to ${k.when(C.shownEnd(ev))}`,
      onkeydown: (e) => { if (e.key === 'Enter') openEvent(ev.id); } },
    ok.start && !s.contL ? h('span', { class: 'cal-h cal-h-l', 'data-edge': 'start', title: 'Drag to change the start' }) : null,
    icon(C.CATEGORIES[cat].icon), h('span', { class: 'cal-bar-t' }, ev.title),
    ev.theme?.color ? h('span', { class: 'cal-dot', style: `background:${ev.theme.color}`, title: `Theme ${ev.theme.color}` }) : null,
    ev.status === 'live' ? h('span', { class: 'cal-live' }, 'LIVE') : null,
    ok.end && !s.contR ? h('span', { class: 'cal-h cal-h-r', 'data-edge': 'end', title: 'Drag to change the end' }) : null);
    el.addEventListener('pointerdown', (e) => dragStart(e, ev, el));
    return el;
  }

  /* drag: move (the bar), start or end (an edge). A click without a move opens the panel. */
  let drag = null;
  const dayAt = (x, y) => {
    for (const el of box.querySelectorAll('.cal-day')) { const r = el.getBoundingClientRect(); if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return el.dataset.day; }
    return null;
  };
  function paint(next, bad) {
    for (const el of box.querySelectorAll('.cal-drop, .cal-drop-bad')) el.classList.remove('cal-drop', 'cal-drop-bad');
    if (!next) return;
    const [a, b] = C.eventSpan({ starts_at: next.starts_at, ends_at: next.ends_at });
    for (const el of box.querySelectorAll('.cal-day')) if (el.dataset.day >= a && el.dataset.day <= b) el.classList.add(bad ? 'cal-drop-bad' : 'cal-drop');
  }
  function dragStart(e, ev, el) {
    if (e.button !== 0) return;
    const edge = e.target.closest('.cal-h')?.dataset.edge;
    drag = { ev, el, mode: edge || 'move', x: e.clientX, y: e.clientY, from: dayAt(e.clientX, e.clientY), moved: false, touch: e.pointerType === 'touch', next: null, err: null, id: e.pointerId };
    el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', dragMove);
    el.addEventListener('pointerup', dragEnd, { once: true });
    el.addEventListener('pointercancel', dragCancel, { once: true });
    e.preventDefault();
  }
  function dragMove(e) {
    if (!drag || drag.touch) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.moved = true;
    box.classList.add('dragging');
    const d = dayAt(e.clientX, e.clientY);
    if (!d || !drag.from) return;
    const delta = C.daysBetween(drag.from, d);
    drag.next = C.shiftEvent(drag.ev, drag.mode, delta);
    drag.err = delta ? C.dragError(drag.ev, drag.mode, drag.next, Date.now()) : null;
    paint(delta ? drag.next || { starts_at: drag.ev.starts_at, ends_at: drag.ev.starts_at } : null, Boolean(drag.err));
    hint.textContent = !delta ? '' : drag.err || `${drag.mode === 'move' ? 'Move' : drag.mode === 'end' ? 'End' : 'Start'}: ${k.when(drag.next.starts_at, true)} to ${k.when(drag.next.ends_at, true)} MT`;
  }
  function dragCleanup() {
    if (!drag) return;
    drag.el.removeEventListener('pointermove', dragMove);
    drag.el.removeEventListener('pointerup', dragEnd);
    drag.el.removeEventListener('pointercancel', dragCancel);
    box.classList.remove('dragging');
    paint(null);
    hint.textContent = '';
  }
  function dragCancel() { dragCleanup(); drag = null; }
  async function dragEnd() {
    const d = drag;
    dragCleanup();
    drag = null;
    if (!d) return;
    if (!d.moved) return openEvent(d.ev.id);
    if (!d.next) return;
    if (d.err) return say(d.err, true);
    const ev = d.ev;
    const body = { id: ev.id, ends_at: d.next.ends_at };
    if (d.mode !== 'end') body.starts_at = d.next.starts_at;
    if (k.session.source !== 'LOCAL' && !window.confirm(`Change "${ev.title}" in the ${k.session.source || '?'} database?`)) return;
    try {
      const res = await send('/', { event: body, expected_updated_at: ev.updated_at });
      if (res.ok === false) return say(problems(res).join(' '), true);
      say(`${ev.title}: ${k.when(res.event.starts_at, true)} to ${k.when(res.event.ends_at, true)} MT`);
      reload();
    } catch (err) { say(err.message, true); }
  }

  /* the panel of one event */
  let panelOv = null;
  async function openEvent(id) {
    panelOv?.close();
    const ov = overlay(k, { title: 'Event', cls: 'cal-drawer', onClose: () => { if (panelOv === ov) panelOv = null; } });
    panelOv = ov;
    const pmsg = h('div', { class: 'ev-msg', role: 'status', 'aria-live': 'polite' });
    const show = () => k.fill(ov.body, async () => {
      const d = await k.api(`/events/${id}`);
      if (!d.found) return h('div', { class: 'empty' }, 'No event with this id');
      const e = d.event;
      ov.heading.replaceChildren(catTag(k, e), h('span', { class: 'cal-ov-name' }, e.title), statusOf(k, e.status));
      const act = async (path, body, ask) => {
        if (ask && !window.confirm(`${ask} (${k.session.source || '?'} database)`)) return;
        pmsg.replaceChildren();
        try {
          const res = await send(path, body);
          if (res.ok === false) { pmsg.replaceChildren(...problems(res).map((t) => h('p', { class: 'ev-err' }, t))); return; }
          reload(); show();
        } catch (err) { pmsg.replaceChildren(h('p', { class: 'ev-err' }, err.message)); }
      };
      const tplName = h('input', { class: 'field', name: 'template_name', value: e.title, maxlength: '80', 'aria-label': 'Template name' });
      const saveTpl = e.kind === 'launch_cards' ? null : h('div', { class: 'cal-tpl' }, tplName, h('button', { class: 'btn', type: 'button', onclick: async () => {
        pmsg.replaceChildren();
        try {
          const res = await send(`/${e.id}/template`, { name: tplName.value.trim() });
          if (res.ok === false) { pmsg.replaceChildren(...problems(res).map((t) => h('p', { class: 'ev-err' }, t))); return; }
          state.templates = null;
          pmsg.replaceChildren(h('p', { class: 'cal-ok' }, `Saved to the library as "${res.template.name}". `, h('a', { href: '#/events/library' }, 'Open the library')));
        } catch (err) { pmsg.replaceChildren(h('p', { class: 'ev-err' }, err.message)); }
      } }, icon('layers'), 'Save as template'));
      const facts = k.panel('Details');
      facts.body.append(factsList(d, k, state.registry));
      const pays = k.panel('Payouts');
      pays.body.append(...[payoutsTable(d, k)].flat());
      const log = k.panel('Change log');
      log.body.append(...[logTable(d, k)].flat());
      const edit = d.editable === 'none' ? null : editor(e, { id: e.id, editable: d.editable, updatedAt: e.updated_at, status: e.status, registry: state.registry, back: false,
        onSaved: () => { reload(); show(); } }, k);
      return [
        h('div', { class: 'ev-actions' }, statusButtons(e, act, k), h('a', { class: 'btn', href: `#/events/${e.id}` }, icon('external'), 'Full page')),
        saveTpl, pmsg,
        edit ? h('div', { class: 'cal-edit' }, h('h3', { class: 'ev-h3' }, e.status === 'live' ? 'Edit (live: the end, the variables and the theme)' : 'Edit'), edit) : null,
        h('div', { class: 'stack' }, facts.el, pays.el, log.el),
      ];
    });
    show();
  }

  /* create on a day: blank or from a template, one time or (F-1 PR 2) a repeat */
  async function openCreate(day) {
    const ov = overlay(k, { title: `New event on ${dayTitle(day)}`, cls: 'cal-modal' });
    const time = h('input', { class: 'field', type: 'time', name: 'start_time', value: '00:00', step: '60', 'aria-label': 'Start time (MT)' });
    const repeatOn = Boolean(state.features.repeats);
    const once = h('input', { type: 'radio', name: 'when', value: 'once', checked: true });
    const rep = h('input', { type: 'radio', name: 'when', value: 'repeat', disabled: !repeatOn });
    const cmsg = h('div', { class: 'ev-msg', role: 'status', 'aria-live': 'polite' });
    const tbox = h('div', { class: 'cal-tlist' });
    ov.body.append(
      h('div', { class: 'ev-grid' }, h('label', { class: 'ev-field' }, h('span', { class: 'ev-lbl' }, 'Start (MT)'), time),
        h('div', { class: 'ev-field' }, h('span', { class: 'ev-lbl' }, 'When'), h('div', { class: 'cal-when' },
          h('label', { class: 'ev-check' }, once, 'One time'),
          h('label', { class: `ev-check${repeatOn ? '' : ' off'}` }, rep, 'Repeat'),
          repeatOn ? null : h('span', { class: 'cal-note' }, 'Repeats come with F-1 PR 2 (event_repeats).')))),
      h('h3', { class: 'ev-h3' }, 'From a blank'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => {
        const s = dayStart(day, time.value || '00:00');
        ov.close();
        openNew(blank(s, C.shiftIso(s, 1)));
      } }, icon('plus'), 'Blank event'),
      h('h3', { class: 'ev-h3' }, 'From a template'), tbox, cmsg);
    k.fill(tbox, async () => {
      state.templates = state.templates || (await k.api('/events/templates')).rows || [];
      if (!state.templates.length) return h('div', { class: 'empty' }, 'The library is empty. Save an event as a template from its panel.');
      return state.templates.map((t) => h('button', { class: `cal-item cat-${C.category(t)}`, type: 'button', onclick: async () => {
        cmsg.replaceChildren();
        const s = dayStart(day, time.value || '00:00');
        try {
          const res = await createFromTemplate(t, s);
          if (res.ok === false) { cmsg.replaceChildren(...problems(res).map((x) => h('p', { class: 'ev-err' }, x))); return; }
          ov.close();
          say(`Made the draft "${res.event.title}" from the template "${t.name}".`);
          reload();
          openEvent(res.event.id);
        } catch (err) { cmsg.replaceChildren(h('p', { class: 'ev-err' }, err.message)); }
      } }, icon(C.CATEGORIES[C.category(t)].icon), h('span', { class: 'cal-item-t' }, h('strong', null, t.name),
        h('span', { class: 'cal-item-s' }, [KIND_LABEL[t.kind] || t.kind, C.intervalText(t.default_length), varsText(t.vars, state.registry)].filter(Boolean).join(', '))), icon('plus')));
    });
  }
  function openNew(ev) {
    panelOv?.close();
    const ov = overlay(k, { title: 'New event', cls: 'cal-drawer', onClose: () => { if (panelOv === ov) panelOv = null; } });
    panelOv = ov;
    ov.body.append(editor(ev, { id: null, editable: 'all', updatedAt: null, status: 'draft', registry: state.registry, back: false,
      onSaved: (saved) => { say(`Saved the draft "${saved.title}".`); reload(); openEvent(saved.id); } }, k));
    ov.body.querySelector('input[name=title]')?.focus();
  }
  function openDay(day) {
    const ov = overlay(k, { title: dayTitle(day), cls: 'cal-modal' });
    ov.body.append(h('div', { class: 'cal-dl' }, C.eventsOnDay(day, state.rows).map((ev) => evItem(ev, ov.close))),
      h('div', { class: 'ev-actions ev-bottom' }, h('button', { class: 'btn', type: 'button', onclick: () => { ov.close(); openCreate(day); } }, icon('plus'), 'New event on this day')));
  }

  k.fill(box, async () => {
    const out = await load();
    const open = Number(q.get('open'));
    if (open > 0) setTimeout(() => openEvent(open), 0);
    return out;
  });
}

/** A draft from a template; a used key gets _2, _3 ... (the key is the template name and the start day). */
async function createFromTemplate(t, startsAt) {
  const base = C.makeKey(t.name, C.mtDay(startsAt));
  let res;
  for (let i = 1; i <= 5; i++) {
    const key = i === 1 ? base : `${base.slice(0, 45)}_${i}`;
    res = await send(`/templates/${t.id}/create`, { key, starts_at: startsAt });
    if (res.ok !== false || !(res.errors || []).some((x) => /another event has this key/.test(x))) return res;
  }
  return res;
}

/* ---------- the event library ---------- */
export function pageLibrary(main, q, k) {
  const { h, icon } = k;
  main.append(k.pageHead('Event library', h('span', { class: 'crumb' }, h('a', { href: '#/events' }, 'Events'), ' / Library'),
    h('a', { class: 'btn', href: '#/events' }, icon('calendar'), 'Calendar')));
  const box = h('div');
  main.append(box);
  k.fill(box, async () => {
    const [d, registry] = await Promise.all([k.api('/events/templates'), loadRegistry(k).catch(() => [])]);
    const rows = d.rows || [];
    const p = k.panel('Templates', { sub: `${k.N(rows.length)} saved events. Save an event as a template from its panel in the calendar.` });
    if (!rows.length) { p.body.append(h('div', { class: 'empty' }, 'The library is empty')); return p.el; }
    const tomorrow = C.addDays(C.mtDay(Date.now()), 1);
    p.body.append(h('div', { class: 'cal-lib' }, rows.map((t) => {
      const start = h('input', { class: 'field', type: 'datetime-local', name: 'tpl_start', value: `${tomorrow}T00:00`, 'aria-label': `Start of ${t.name} (MT)` });
      const msg = h('div', { class: 'ev-msg', role: 'status', 'aria-live': 'polite' });
      const make = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        msg.replaceChildren();
        const s = C.mtToIso(start.value);
        if (!s) { msg.replaceChildren(h('p', { class: 'ev-err' }, 'Choose a start')); return; }
        try {
          const res = await createFromTemplate(t, s);
          if (res.ok === false) { msg.replaceChildren(...problems(res).map((x) => h('p', { class: 'ev-err' }, x))); return; }
          location.hash = `#/events?m=${C.monthKey(C.mtDay(res.event.starts_at))}&open=${res.event.id}`;
        } catch (err) { msg.replaceChildren(h('p', { class: 'ev-err' }, err.message)); }
      } }, icon('plus'), 'Create from template');
      return h('article', { class: `cal-tpl-card cat-${C.category(t)}` },
        h('div', { class: 'cal-tpl-head' }, catTag(k, t), h('strong', { class: 'cal-tpl-name' }, t.name), h('span', { class: 'ev-key num' }, `#${t.id}`)),
        h('dl', { class: 'ev-dl' }, [['Kind', KIND_LABEL[t.kind] || t.kind], ['Length', C.intervalText(t.default_length)],
          Object.keys(t.vars || {}).length ? ['Variables', varsText(t.vars, registry)] : null, Object.keys(t.theme || {}).length ? ['Theme', themeText(t.theme)] : null,
          t.description ? ['Description', t.description] : null, ['Events made', k.N(t.events)], ['Saved by', t.created_by]]
          .filter(Boolean).map(([a, b]) => [h('dt', null, a), h('dd', null, b)])),
        h('div', { class: 'cal-tpl-make' }, h('label', { class: 'ev-field' }, h('span', { class: 'ev-lbl' }, 'Start (MT)'), start), make), msg);
    })));
    return p.el;
  });
}
