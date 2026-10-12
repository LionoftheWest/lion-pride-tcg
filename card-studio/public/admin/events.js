// Lion Pride TCG - Admin view: the Events page (list, one event, the editor). The first page that writes.
// Data: /api/admin/events* (src/admin-events-routes.js -> the admin_event* SQL functions, tcg-bot/supabase/events.sql).
// "Test, then apply": Test shows who would get what (admin_event_preview_draft, nothing saved); Save writes the event
// (a draft); Schedule makes it start at its time; the pg_cron job event-tick starts, pays and ends it.
// The shell (admin.js) passes its helpers in `k`. Every text goes in as textContent (member names are data).
// F-1 PR 5: #/events is the month calendar (calendar.js); #/events/list is this list; the editor has the variables
// (event_vars, each with its base value and limits, refused in the form outside the limits) and the theme.
import { isoToMt, mtToIso, varErrors, makeKey } from './calendar-core.js';

const KINDS = [['drop', 'Drop'], ['trigger', 'Trigger'], ['rank', 'Rank'], ['modifier', 'Modifier']];
export const KIND_LABEL = { drop: 'Drop', trigger: 'Trigger', rank: 'Rank', modifier: 'Modifier', hunt: 'Hunt', launch_cards: 'Launch cards' };
// D-185: the theme color is one of the 8 name colors (shared/tokens.json game.name-color-1..8). No new color.
export const THEME_COLORS = ['#F4B73C', '#FF5A5A', '#FF9A3C', '#5BE38A', '#4FD6F0', '#5B8CFF', '#B45AD8', '#FF7AC8'];
const TRIGGERS = [['hunt_hit', 'Hunt hit'], ['tutorial_done', 'Tutorial done'], ['pack_opened', 'Pack opened'], ['dungeon_run', 'Dungeon run']];
const METRICS = [['hunt_damage', 'Hunt damage'], ['packs_opened', 'Packs opened']];
const STATUS = { live: ['pass', 'Live'], scheduled: ['info', 'Scheduled'], draft: ['idle', 'Draft'], ended: ['idle', 'Ended'], cancelled: ['warn', 'Cancelled'] };
const ERRORS = {
  stale: 'This event changed since this page loaded. Reload the event.',
  locked: 'This event cannot change.',
  bad_status: 'This action is not possible in this status.',
  not_found: 'No event with this id.',
};
/* ---------- Mountain Time <-> ISO (the game day is MT; the inputs show MT): calendar-core.js ---------- */
export { isoToMt, mtToIso };

/* ---------- writes ---------- */
export async function send(path, body) {
  const r = await fetch(`/api/admin/events${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-admin-write': '1', accept: 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new Error('Login required'); }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(j?.error || `The server answered ${r.status}`);
  return j;
}
export const problems = (res) => [ERRORS[res?.error] || null, ...(res?.errors || [])].filter(Boolean);

const cssOnce = new Set();
export function css(name = 'events') {
  if (cssOnce.has(name)) return;
  cssOnce.add(name);
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `/admin/${name}.css` }));
}

export async function pageEvents(main, args, q, k) {
  css();
  // The shell decodes each group of the route; an empty group arrives as the text "undefined".
  const [idOrNew, edit] = args.map((x) => (x && x !== 'undefined' ? x : null));
  if (!idOrNew || idOrNew === 'library') {
    css('calendar');
    const cal = await import('./calendar.js');
    return idOrNew === 'library' ? cal.pageLibrary(main, q, k) : cal.pageCalendar(main, q, k);
  }
  if (idOrNew === 'list') return listPage(main, k);
  if (idOrNew === 'new') return formPage(main, null, k);
  if (edit) return formPage(main, Number(idOrNew), k);
  return detailPage(main, Number(idOrNew), k);
}

export const statusOf = (k, st) => { const [c, t] = STATUS[st] || ['idle', k.label(st)]; return k.statusTag(c, t); };

/* ---------- the list ---------- */
function listPage(main, k) {
  const { h, icon } = k;
  main.append(k.pageHead('Events', null, h('div', { class: 'ev-actions' }, h('a', { class: 'btn', href: '#/events' }, icon('calendar'), 'Calendar'),
    h('a', { class: 'btn primary', href: '#/events/new' }, icon('plus'), 'New event'))));
  const box = h('div');
  main.append(box);
  k.fill(box, async () => {
    const d = await k.api('/events');
    const p = k.panel('All events', { sub: `${k.N(d.rows.length)} events` });
    p.body.append(...[d.rows.length ? k.table({ rows: d.rows, title: 'title', onRow: (x) => { location.hash = `#/events/${x.id}`; }, cols: [
      { key: 'title', label: 'Event', fmt: (x) => h('span', { class: 'ev-name' }, h('strong', null, x.title), h('span', { class: 'ev-key num' }, x.key)) },
      { key: 'kind', label: 'Kind', fmt: (x) => KIND_LABEL[x.kind] || x.kind },
      { key: 'status', label: 'Status', fmt: (x) => statusOf(k, x.status) },
      { key: 'starts_at', label: 'Start', fmt: (x) => k.when(x.starts_at, true) },
      { key: 'ends_at', label: 'End', fmt: (x) => k.when(x.ends_at, true) },
      { key: 'members', label: 'Members', r: true, fmt: (x) => k.N(x.members) },
      { key: 'claimed', label: 'Claimed', r: true, fmt: (x) => `${k.N(x.claimed)} / ${k.N(x.gifts)}` }] }) : h('div', { class: 'empty' }, 'No events')].flat());
    return p.el;
  });
}

/* ---------- one event ---------- */
export const audienceText = (a, k) => {
  if (!a || a.all) return 'Everyone';
  const out = [];
  if (a.active_since) out.push(`Active since ${k.when(a.active_since, true)}`);
  if (a.joined_after) out.push(`Joined after ${k.when(a.joined_after, true)}`);
  if (a.joined_before) out.push(`Joined before ${k.when(a.joined_before, true)}`);
  if (a.tutorial_done) out.push('Tutorial done');
  if (a.members) out.push(`${a.members.length} listed members`);
  return out.join(', ');
};
export const rewardText = (x) => [x.packs ? `${x.packs} ${x.packs === 1 ? 'pack' : 'packs'}` : null, x.shards ? `${x.shards} Shards` : null,
  x.card_id ? `card #${x.card_id}` : null].filter(Boolean).join(', ') || '-';
const num =(v) => (Number.isInteger(v) ? String(v) : String(Number(Number(v).toFixed(4))));
/** The variables of an event as text: "Rare pull odds x2 (base 1)". registry = the rows of /events/vars (may be empty). */
export const varsText = (vars, registry = []) => Object.entries(vars || {}).map(([key, v]) => {
  const r = registry.find((x) => x.key === key);
  return r ? `${r.label} ${r.combine === 'multiply' ? 'x' : ''}${num(v)} (base ${r.base == null ? '?' : num(r.base)})` : `${key} ${num(v)}`;
}).join(', ');
export const themeText = (t) => [t?.name, t?.banner ? `"${t.banner}"` : null, t?.color, t?.art ? 'art' : null].filter(Boolean).join(', ');
/** The facts of an event (the detail page and the calendar panel). */
export function factsList(d, k, registry = []) {
  const { h } = k;
  const e = d.event;
  const dl = (rows) => h('dl', { class: 'ev-dl' }, rows.filter(Boolean).map(([t, v]) => [h('dt', null, t), h('dd', null, v)]));
  const r = e.rewards || {};
  return dl([
    ['Key', h('span', { class: 'num' }, e.key)], ['Kind', KIND_LABEL[e.kind] || e.kind], ['Status', statusOf(k, e.status)],
    ['Start', k.when(e.starts_at, true)], ['End', k.when(e.ends_at, true)], e.ended_at ? ['Ended', k.when(e.ended_at, true)] : null,
    ['Audience', audienceText(e.audience, k)],
    e.rules?.trigger ? ['Trigger', (TRIGGERS.find((x) => x[0] === e.rules.trigger) || [, e.rules.trigger])[1]] : null,
    e.rules?.metric ? ['Ranked by', (METRICS.find((x) => x[0] === e.rules.metric) || [, e.rules.metric])[1]] : null,
    e.kind === 'drop' ? ['Late joiners', e.rules?.late_joiners ? 'Yes' : 'No'] : null,
    r.title ? ['Bell title', r.title] : null,
    r.per_member ? ['Each member', rewardText(r.per_member)] : null,
    ...(r.ranks || []).map((t) => [t.from === t.to ? `Rank ${t.from}` : `Ranks ${t.from}-${t.to}`, rewardText(t)]),
    e.kind === 'modifier' ? ['Rewards', 'None (a modifier only changes variables)'] : null,
    Object.keys(e.vars || {}).length ? ['Variables', varsText(e.vars, registry)] : null,
    Object.keys(e.theme || {}).length ? ['Theme', themeText(e.theme)] : null,
    e.template_id ? ['Template', h('a', { href: '#/events/library' }, `#${e.template_id}`)] : null,
    ['Repeat rule', e.repeat_id ? `Repeat #${e.repeat_id}` : 'None (one time)'],
    e.rules?.settings_key ? ['Settings', h('span', { class: 'num' }, e.rules.settings_key)] : null,
    d.cards?.length ? ['Cards', d.cards.map((x) => `${x.name} (#${x.id})`).join(', ')] : null,
    e.description ? ['Description', e.description] : null,
    ['Created by', e.created_by],
  ]);
}
export function payoutsTable(d, k) {
  const { h } = k;
  return d.payouts.length ? k.table({ phone: 'table', rows: d.payouts, cols: [
    { key: 'period', label: 'Run', fmt: (x) => (x.period.startsWith('tick:') ? 'Tick' : k.label(x.period)) },
    { key: 'paid_at', label: 'Paid', fmt: (x) => k.when(x.paid_at, true) },
    { key: 'members', label: 'Members', r: true, fmt: (x) => k.N(x.members) }, { key: 'packs', label: 'Packs', r: true, fmt: (x) => k.N(x.packs) },
    { key: 'shards', label: 'Shards', r: true, fmt: (x) => k.N(x.shards) }, { key: 'cards', label: 'Cards', r: true, fmt: (x) => k.N(x.cards) }] }) : h('div', { class: 'empty' }, 'No payouts');
}
export function logTable(d, k) {
  const { h } = k;
  return d.log.length ? k.table({ rows: d.log, title: 'action', cols: [
    { key: 'action', label: 'Action', fmt: (x) => k.label(x.action) }, { key: 'at', label: 'When', fmt: (x) => k.when(x.at, true) },
    { key: 'actor', label: 'Who' }, { key: 'new', label: 'Change', fmt: (x) => h('span', { class: 'json-text' }, changeText(x, k)) }] }) : h('div', { class: 'empty' }, 'No changes');
}
/** The status buttons of an event: Schedule, Back to draft, End now, Cancel event. act(path, body, ask). */
export function statusButtons(e, act, k) {
  const { h } = k;
  const id = e.id, up = { expected_updated_at: e.updated_at }, out = [];
  if (e.status === 'draft' && e.kind !== 'launch_cards') out.push(h('button', { class: 'btn primary', type: 'button', onclick: () => act(`/${id}/schedule`, { ...up, on: true }, 'Schedule this event?') }, 'Schedule'));
  if (e.status === 'scheduled') out.push(h('button', { class: 'btn', type: 'button', onclick: () => act(`/${id}/schedule`, { ...up, on: false }) }, 'Back to draft'));
  if (e.status === 'live' && e.kind !== 'launch_cards') out.push(h('button', { class: 'btn', type: 'button', onclick: () => act(`/${id}/end`, up, 'End this event now and pay its end?') }, 'End now'));
  if (['draft', 'scheduled', 'live'].includes(e.status) && e.kind !== 'launch_cards') {
    out.push(h('button', { class: 'btn ev-danger', type: 'button', onclick: () => act(`/${id}/cancel`, up, 'Cancel this event? It pays nothing more.') }, 'Cancel event'));
  }
  return out;
}
let registryCache = null;
/** The variable registry with the base values (GET /events/vars), read once for each page load. */
export async function loadRegistry(k) {
  if (!registryCache) registryCache = k.api('/events/vars').then((d) => d.rows || []).catch((e) => { registryCache = null; throw e; });
  return registryCache;
}

function detailPage(main, id, k) {
  const { h } = k;
  const head = k.pageHead('Event', h('span', { class: 'crumb' }, h('a', { href: '#/events' }, 'Events'), ' / ', String(id)));
  main.append(head);
  const box = h('div');
  main.append(box);
  const msg = h('div', { class: 'ev-msg', role: 'status', 'aria-live': 'polite' });
  const reload = () => k.fill(box, load);
  async function act(path, body, ask) {
    if (ask && !window.confirm(`${ask} (${k.session.source || '?'} database)`)) return;
    msg.replaceChildren();
    try {
      const res = await send(path, body);
      if (res.ok === false) { msg.replaceChildren(...problems(res).map((t) => h('p', { class: 'ev-err' }, t))); return; }
      reload();
    } catch (e) { msg.replaceChildren(h('p', { class: 'ev-err' }, e.message)); }
  }
  async function load() {
    const [d, registry] = await Promise.all([k.api(`/events/${id}`), loadRegistry(k).catch(() => [])]);
    if (!d.found) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No event with this id'));
    const e = d.event;
    head.querySelector('.title').textContent = e.title;
    const buttons = [];
    if (d.editable !== 'none') buttons.push(h('a', { class: 'btn', href: `#/events/${id}/edit` }, 'Edit'));
    if (e.kind !== 'launch_cards' && e.kind !== 'modifier') buttons.push(h('button', { class: 'btn', type: 'button', onclick: () => showPreview() }, 'Preview'));
    buttons.push(...statusButtons(e, act, k));
    const c = d.claims || {};
    const facts = k.panel('Event', { right: statusOf(k, e.status) });
    facts.body.append(factsList(d, k, registry));
    const pv = k.panel('Preview');
    pv.el.hidden = true;
    function showPreview() {
      pv.el.hidden = false;
      k.fill(pv.body, async () => previewView(await k.api(`/events/${id}/preview`), k));
      pv.el.scrollIntoView({ block: 'nearest' });
    }
    const pays = k.panel('Payouts');
    pays.body.append(...[payoutsTable(d, k)].flat());
    const log = k.panel('Log');
    log.body.append(...[logTable(d, k)].flat());
    return [
      h('div', { class: 'ev-actions' }, buttons),
      msg,
      h('div', { class: 'kpis' }, k.kpi('Members', k.N(c.members)), k.kpi('Gifts', k.N(c.gifts)), k.kpi('Claimed', k.N(c.claimed)),
        k.kpi('Packs', k.N(c.packs), h('span', { class: 'num' }, `${k.N(c.packs_claimed)} claimed`)),
        k.kpi('Shards', k.N(c.shards), h('span', { class: 'num' }, `${k.N(c.shards_claimed)} claimed`)),
        k.kpi('Cards', k.N(c.cards), h('span', { class: 'num' }, `${k.N(c.cards_claimed)} claimed`))),
      h('div', { class: 'cols-2' }, h('div', { class: 'stack' }, facts.el, pv.el), h('div', { class: 'stack' }, pays.el, log.el)),
    ];
  }
  reload();
}
export const changeText = (x, k) => {
  const v = (val) => (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(val) ? k.when(val, true) : JSON.stringify(val ?? null));
  const n = x.new || {};
  if (x.action === 'pay') return `${n.members} members, ${n.packs} packs, ${n.shards} Shards, ${n.cards} cards`;
  if (x.action === 'create' || x.action === 'migrate') return '';
  return Object.keys(n).map((key) => `${key}: ${v(x.old?.[key])} -> ${v(n[key])}`).join(', ');
};

export function previewView(p, k) {
  const { h } = k;
  if (p.ok === false) return h('div', null, (p.errors || []).map((t) => h('p', { class: 'ev-err' }, t)));
  const out = [h('div', { class: 'kpis k4' }, k.kpi('Members', k.N(p.members), h('span', { class: 'num' }, `${k.N(p.new_members)} new`)),
    k.kpi('Packs', k.N(p.packs)), k.kpi('Shards', k.N(p.shards)), k.kpi('Cards', k.N(p.cards))),
  h('p', { class: 'note' }, `Audience ${k.N(p.audience)} members. At ${k.when(p.at, true)}.`)];
  if (p.missing_cards?.length) out.push(h('p', { class: 'ev-err' }, `Missing cards: ${p.missing_cards.join(', ')}`));
  if (p.by_rank?.length) {
    out.push(...[k.table({ phone: 'table', rows: p.by_rank, cols: [{ key: 'rank', label: 'Rank', r: true, fmt: (x) => k.N(x.rank) },
      { key: 'members', label: 'Members', r: true, fmt: (x) => k.N(x.members) }, { key: 'packs', label: 'Packs', r: true, fmt: (x) => k.N(x.packs) },
      { key: 'shards', label: 'Shards', r: true, fmt: (x) => k.N(x.shards) }, { key: 'card_id', label: 'Card', r: true }] })].flat());
  }
  if (p.sample?.length) {
    out.push(h('h3', { class: 'ev-h3' }, `First ${p.sample.length} members`));
    out.push(...[k.table({ rows: p.sample, title: 'username', cols: [
      { key: 'username', label: 'Member', fmt: (x) => x.username || x.member_id },
      p.by_rank?.length ? { key: 'rank', label: 'Rank', r: true, fmt: (x) => k.N(x.rank) } : null,
      { key: 'packs', label: 'Packs', r: true, fmt: (x) => k.N(x.packs) }, { key: 'shards', label: 'Shards', r: true, fmt: (x) => k.N(x.shards) },
      { key: 'card_id', label: 'Card', r: true }, { key: 'paid', label: 'Paid', fmt: (x) => (x.paid ? 'Yes' : 'No') }].filter(Boolean) })].flat());
  }
  return out;
}

/* ---------- the editor ---------- */
export const blank = (startIso, endIso) => {
  const start = new Date(Date.now() + 86400000);
  start.setUTCMinutes(0, 0, 0);
  const s = startIso || start.toISOString();
  return { key: '', kind: 'drop', title: '', description: '', starts_at: s, ends_at: endIso || new Date(Date.parse(s) + 7 * 86400000).toISOString(),
    audience: { all: true }, rewards: { per_member: { packs: 1 } }, rules: {}, vars: {}, theme: {} };
};

function formPage(main, id, k) {
  const { h } = k;
  const head = k.pageHead(id ? 'Edit event' : 'New event', h('span', { class: 'crumb' }, h('a', { href: '#/events' }, 'Events'), ' / ',
    id ? h('a', { href: `#/events/${id}` }, String(id)) : 'New'));
  main.append(head);
  const box = h('div');
  main.append(box);
  k.fill(box, async () => {
    let ev = blank(), editable = 'all', updatedAt = null, status = 'draft';
    const registry = await loadRegistry(k).catch(() => []);
    if (id) {
      const d = await k.api(`/events/${id}`);
      if (!d.found) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No event with this id'));
      ev = d.event; editable = d.editable; updatedAt = d.event.updated_at; status = d.event.status;
      if (editable === 'none') return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'This event cannot change'));
    }
    return editor(ev, { id, editable, updatedAt, status, registry }, k);
  });
}

const fmtNum = (v) => (v == null ? '?' : Number.isInteger(Number(v)) ? String(Number(v)) : String(Number(Number(v).toFixed(4))));
/** The value of a variable while only this event is live (game_var): multiply = base x factor, max = the larger one. */
const resultOf = (r, v) => {
  if (r.base == null || !Number.isFinite(v)) return null;
  const x = r.combine === 'multiply' ? r.base * Math.min(Math.max(v, r.min_value), r.max_value) : Math.max(r.base, Math.min(Math.max(v, r.min_value), r.max_value));
  return r.whole ? Math.round(x) : x;
};

/**
 * The event form. opts: id (null = a new draft), editable and status (admin_event), updatedAt (the optimistic check),
 * registry (the rows of /events/vars), onSaved(event) (the calendar panel; else the page goes to the event), back (a link).
 * A live event changes its title, description, end, variables and theme (event_vars.sql, Nathan 2026-10-11).
 */
export function editor(ev, { id, editable, updatedAt, status, registry = [], onSaved = null, back = null }, k) {
  const { h, icon } = k;
  const live = editable === 'text_and_end' || status === 'live';
  const lockAll = live;                                          // a live event: title, description, end, variables, theme
  const lockKey = Boolean(id) && status !== 'draft';            // the key and the kind change only in a draft
  const field = (lbl, input, cls = '') => h('label', { class: `ev-field ${cls}` }, h('span', { class: 'ev-lbl' }, lbl), input);
  const inp = (props) => h('input', { class: 'field', ...props });
  const num = (v, max, name) => inp({ type: 'number', min: '0', max: String(max), step: '1', value: v ?? '', name, inputmode: 'numeric' });

  const f = {
    title: inp({ name: 'title', value: ev.title || '', maxlength: '80', required: true }),
    key: inp({ name: 'key', value: ev.key || '', maxlength: '48', pattern: '[a-z0-9][a-z0-9_]{2,47}', disabled: lockKey || lockAll }),
    kind: h('select', { class: 'field', name: 'kind', disabled: lockKey || lockAll }, KINDS.map(([v, t]) => h('option', { value: v, selected: ev.kind === v }, t))),
    description: h('textarea', { class: 'field', name: 'description', rows: '2', maxlength: '1000' }),
    starts_at: inp({ type: 'datetime-local', name: 'starts_at', value: isoToMt(ev.starts_at), disabled: lockAll }),
    ends_at: inp({ type: 'datetime-local', name: 'ends_at', value: isoToMt(ev.ends_at) }),
  };
  f.description.value = ev.description || '';
  // A new event: the key follows the title and the start day until it is typed by hand.
  let keyTyped = Boolean(ev.key);
  f.key.addEventListener('input', () => { keyTyped = true; });
  const autoKey = () => { if (!id && !keyTyped) f.key.value = makeKey(f.title.value, (f.starts_at.value || '').slice(0, 10)); };
  f.title.addEventListener('input', autoKey);
  f.starts_at.addEventListener('change', autoKey);

  // Audience: everyone, or filters (all must match).
  const a = ev.audience || { all: true };
  const aud = {
    mode: h('select', { class: 'field', name: 'audience_mode', disabled: lockAll }, [['all', 'Everyone'], ['filter', 'Filters']].map(([v, t]) => h('option', { value: v, selected: (a.all ? 'all' : 'filter') === v }, t))),
    active_since: inp({ type: 'datetime-local', name: 'active_since', value: isoToMt(a.active_since), disabled: lockAll }),
    joined_after: inp({ type: 'datetime-local', name: 'joined_after', value: isoToMt(a.joined_after), disabled: lockAll }),
    joined_before: inp({ type: 'datetime-local', name: 'joined_before', value: isoToMt(a.joined_before), disabled: lockAll }),
    tutorial_done: inp({ type: 'checkbox', name: 'tutorial_done', checked: Boolean(a.tutorial_done), disabled: lockAll }),
    members: h('textarea', { class: 'field', name: 'members', rows: '2', disabled: lockAll }),
  };
  aud.members.value = (a.members || []).join('\n');
  const filters = h('div', { class: 'ev-grid' },
    field('Active since (MT)', aud.active_since), field('Joined after (MT)', aud.joined_after), field('Joined before (MT)', aud.joined_before),
    h('label', { class: 'ev-check' }, aud.tutorial_done, 'Tutorial done'), field('Members (ids)', aud.members, 'ev-wide'));
  const syncAud = () => { filters.hidden = aud.mode.value === 'all'; };
  aud.mode.addEventListener('change', syncAud);

  // Rewards and rules by kind.
  const r = ev.rewards || {};
  const bellTitle = inp({ name: 'bell_title', value: r.title || '', maxlength: '80', disabled: lockAll });
  const pm = r.per_member || {};
  const per = { packs: num(pm.packs, 100, 'packs'), shards: num(pm.shards, 100000, 'shards'), card_id: inp({ type: 'number', min: '1', step: '1', name: 'card_id', value: pm.card_id ?? '' }) };
  for (const x of Object.values(per)) x.disabled = lockAll;
  const perBox = h('div', { class: 'ev-grid' }, field('Packs', per.packs), field('Shards', per.shards), field('Card id', per.card_id));
  const tiers = h('div', { class: 'ev-tiers' });
  const tierRow = (t = {}) => {
    const row = h('div', { class: 'ev-tier' },
      field('From', num(t.from ?? 1, 1000, 'from')), field('To', num(t.to ?? t.from ?? 1, 1000, 'to')), field('Packs', num(t.packs, 100, 'packs')),
      field('Shards', num(t.shards, 100000, 'shards')), field('Card id', inp({ type: 'number', min: '1', step: '1', name: 'card_id', value: t.card_id ?? '' })),
      h('button', { class: 'btn', type: 'button', disabled: lockAll, onclick: () => row.remove() }, 'Remove'));
    for (const x of row.querySelectorAll('input')) x.disabled = lockAll;
    tiers.append(row);
  };
  for (const t of r.ranks || []) tierRow(t);
  if (!(r.ranks || []).length) tierRow({ from: 1, to: 1, packs: 1 });
  const addTier = h('button', { class: 'btn', type: 'button', disabled: lockAll, onclick: () => {
    const last = [...tiers.querySelectorAll('input[name=to]')].pop();
    const from = (Number(last?.value) || 0) + 1;
    tierRow({ from, to: from });
  } }, 'Add tier');
  const rankBox = h('div', null, tiers, addTier);
  const rules = ev.rules || {};
  const trigger = h('select', { class: 'field', name: 'trigger', disabled: lockAll }, TRIGGERS.map(([v, t]) => h('option', { value: v, selected: rules.trigger === v }, t)));
  const metric = h('select', { class: 'field', name: 'metric', disabled: lockAll }, METRICS.map(([v, t]) => h('option', { value: v, selected: rules.metric === v }, t)));
  const late = inp({ type: 'checkbox', name: 'late_joiners', checked: Boolean(rules.late_joiners), disabled: lockAll });
  const ruleDrop = h('label', { class: 'ev-check' }, late, 'Late joiners');
  const ruleTrig = field('Trigger', trigger);
  const ruleRank = field('Ranked by', metric);

  // Variables (event_vars): each row shows the base value, the limits and the result; the form refuses a value outside the limits.
  const varRows = h('div', { class: 'ev-vars' });
  const varPick = h('select', { class: 'field', name: 'var_add', 'aria-label': 'Add a variable' });
  const syncPick = () => {
    const used = new Set([...varRows.querySelectorAll('[data-var]')].map((x) => x.dataset.var));
    varPick.replaceChildren(h('option', { value: '' }, registry.length ? 'Add a variable' : 'No variables (event_vars is empty)'),
      ...registry.filter((x) => !used.has(x.key)).map((x) => h('option', { value: x.key }, `${x.label} (${x.key})`)));
  };
  const varRow = (key, value) => {
    const reg = registry.find((x) => x.key === key) || { key, label: key, note: 'Not in the registry', min_value: 0, max_value: 0, combine: 'multiply', base: null };
    const step = reg.whole && reg.combine === 'max' ? '1' : '0.01';
    const input = inp({ type: 'number', name: `var_${key}`, min: String(reg.min_value), max: String(reg.max_value), step, value: value ?? '', inputmode: 'decimal', 'aria-label': reg.label });
    const err = h('p', { class: 'ev-var-err', role: 'alert' });
    const result = h('span', { class: 'ev-var-result num' });
    const check = () => {
      const v = input.value === '' ? NaN : Number(input.value);
      const errs = varErrors(f.kind.value, { [key]: Number.isNaN(v) ? input.value : v }, registry).filter((t) => !/at least one/.test(t));
      err.textContent = input.value === '' ? 'Type a value' : errs.join('; ').replace(/^vars: /, '');
      input.setCustomValidity(err.textContent);
      const res = resultOf(reg, v);
      result.textContent = res == null || err.textContent ? '' : `While live: ${fmtNum(res)}`;
    };
    input.addEventListener('input', check);
    const row = h('div', { class: 'ev-var', 'data-var': key },
      h('div', { class: 'ev-var-head' }, h('strong', null, reg.label), h('span', { class: 'ev-key num' }, key),
        h('button', { class: 'btn icon-only', type: 'button', 'aria-label': `Remove ${reg.label}`, onclick: () => { row.remove(); syncPick(); } }, icon('x'))),
      h('div', { class: 'ev-var-body' },
        h('div', { class: 'ev-var-facts' },
          h('span', null, 'Base ', h('b', { class: 'num' }, fmtNum(reg.base))),
          h('span', null, 'Limits ', h('b', { class: 'num' }, `${fmtNum(reg.min_value)} to ${fmtNum(reg.max_value)}`)),
          h('span', null, reg.combine === 'multiply' ? 'A factor (x)' : 'Raises to the value (max)'), result),
        input),
      h('p', { class: 'ev-var-note' }, reg.note), err);
    varRows.append(row);
    check();
    return row;
  };
  for (const [key, value] of Object.entries(ev.vars || {})) varRow(key, value);
  varPick.addEventListener('change', () => {
    const key = varPick.value;
    if (!key) return;
    const reg = registry.find((x) => x.key === key);
    const row = varRow(key, reg ? (reg.combine === 'multiply' ? Math.min(Math.max(2, reg.min_value), reg.max_value) : Math.min(Math.max(reg.base ?? reg.min_value, reg.min_value), reg.max_value)) : '');
    syncPick();
    row.querySelector('input').focus();
  });
  syncPick();
  const collectVars = () => Object.fromEntries([...varRows.querySelectorAll('[data-var]')].map((row) => {
    const v = row.querySelector('input').value;
    return [row.dataset.var, v === '' ? v : Number(v)];
  }));

  // Theme: name, color (D-185: one of the 8 name colors), art (https), banner.
  const th = ev.theme || {};
  const themeIn = {
    name: inp({ name: 'theme_name', value: th.name || '', maxlength: '40' }),
    art: inp({ name: 'theme_art', value: th.art || '', maxlength: '500', type: 'url', placeholder: 'https://' }),
    banner: inp({ name: 'theme_banner', value: th.banner || '', maxlength: '120' }),
  };
  let themeColor = th.color || '';
  const swatches = h('div', { class: 'ev-swatches', role: 'radiogroup', 'aria-label': 'Theme color' });
  const drawSwatches = () => swatches.replaceChildren(...['', ...THEME_COLORS].map((c) => h('button', {
    class: `ev-swatch${themeColor.toUpperCase() === c ? ' on' : ''}${c ? '' : ' none'}`, type: 'button', role: 'radio', 'aria-checked': String(themeColor.toUpperCase() === c),
    'aria-label': c ? `Color ${c}` : 'No color', title: c || 'No color', style: c ? `background:${c}` : null, 'data-color': c,
    onclick: () => { themeColor = c; drawSwatches(); } }, c ? null : icon('x'))));
  drawSwatches();
  const collectTheme = () => {
    const t = {};
    if (themeIn.name.value.trim()) t.name = themeIn.name.value.trim();
    if (themeColor) t.color = themeColor;
    if (themeIn.art.value.trim()) t.art = themeIn.art.value.trim();
    if (themeIn.banner.value.trim()) t.banner = themeIn.banner.value.trim();
    return t;
  };
  const themeErrors = (t) => (t.art && !/^https:\/\/\S+$/.test(t.art) ? ['theme: art must be an https URL'] : []);

  // The values as the API takes them (only the fields the status allows).
  const intOr = (el) => (el.value === '' ? undefined : Number(el.value));
  const reward = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== 0 && !Number.isNaN(v)));
  function collect() {
    const out = { title: f.title.value.trim(), description: f.description.value, ends_at: mtToIso(f.ends_at.value), vars: collectVars(), theme: collectTheme() };
    if (id) out.id = id;
    if (lockAll) return out;
    if (!lockKey) { out.key = f.key.value.trim(); out.kind = f.kind.value; }
    out.starts_at = mtToIso(f.starts_at.value);
    const kd = f.kind.value;
    if (kd === 'modifier') { out.audience = { all: true }; out.rewards = {}; out.rules = {}; return out; }
    if (aud.mode.value === 'all') out.audience = { all: true };
    else {
      const au = {};
      for (const key of ['active_since', 'joined_after', 'joined_before']) if (aud[key].value) au[key] = mtToIso(aud[key].value);
      if (aud.tutorial_done.checked) au.tutorial_done = true;
      const ids = aud.members.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
      if (ids.length) au.members = [...new Set(ids)];
      out.audience = au;
    }
    const rw = {};
    if (bellTitle.value.trim()) rw.title = bellTitle.value.trim();
    if (kd === 'rank') {
      rw.ranks = [...tiers.querySelectorAll('.ev-tier')].map((row) => {
        const g = (n) => row.querySelector(`input[name=${n}]`);
        return { from: intOr(g('from')), to: intOr(g('to')), ...reward({ packs: intOr(g('packs')), shards: intOr(g('shards')), card_id: intOr(g('card_id')) }) };
      });
    } else rw.per_member = reward({ packs: intOr(per.packs), shards: intOr(per.shards), card_id: intOr(per.card_id) });
    out.rewards = rw;
    out.rules = kd === 'drop' ? (late.checked ? { late_joiners: true } : {}) : kd === 'trigger' ? { trigger: trigger.value } : { metric: metric.value };
    return out;
  }
  /** The errors the form finds before the server: the variables (limits, registry) and the theme art. */
  const formErrors = (ev2) => [...varErrors(f.kind.value, ev2.vars, registry), ...themeErrors(ev2.theme)];

  const msg = h('div', { class: 'ev-msg', role: 'status', 'aria-live': 'polite' });
  const result = k.panel('Test result');
  result.el.hidden = true;
  const testBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    msg.replaceChildren();
    result.el.hidden = false;
    k.fill(result.body, async () => previewView(await send('/test', { event: collect() }), k));
  } }, 'Test');
  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Save');
  const form = h('form', { class: 'ev-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    msg.replaceChildren();
    const out = collect();
    const errs = formErrors(out);
    if (errs.length) { msg.replaceChildren(...errs.map((t) => h('p', { class: 'ev-err' }, t))); return; }
    if (k.session.source !== 'LOCAL' && !window.confirm(`Save this event to the ${k.session.source || '?'} database?`)) return;
    saveBtn.disabled = true;
    try {
      const res = await send('/', { event: out, expected_updated_at: updatedAt });
      if (res.ok === false) { msg.replaceChildren(...problems(res).map((t) => h('p', { class: 'ev-err' }, t))); return; }
      if (onSaved) onSaved(res.event); else location.hash = `#/events/${res.event.id}`;
    } catch (err) { msg.replaceChildren(h('p', { class: 'ev-err' }, err.message)); } finally { saveBtn.disabled = false; }
  } });
  const pBasics = k.panel('Event', { right: live ? h('span', { class: 'tag' }, icon('lock'), 'Live: the start, kind, audience and rewards are locked') : null });
  pBasics.body.append(h('div', { class: 'ev-grid' }, field('Title', f.title), field('Key', f.key), field('Kind', f.kind),
    field('Start (MT)', f.starts_at), field('End (MT)', f.ends_at), field('Description', f.description, 'ev-wide')));
  const pAud = k.panel('Audience');
  pAud.body.append(h('div', { class: 'ev-grid' }, field('Who', aud.mode)), filters);
  const pRew = k.panel('Rewards');
  pRew.body.append(h('div', { class: 'ev-grid' }, field('Bell title', bellTitle), ruleTrig, ruleRank, ruleDrop), perBox, rankBox);
  const pVars = k.panel('Variables', { sub: 'What the event changes while it is live. Each value stays inside its limits.' });
  pVars.body.append(varRows, h('div', { class: 'ev-grid' }, field('Add', varPick)));
  const pTheme = k.panel('Theme');
  pTheme.body.append(h('div', { class: 'ev-grid' }, field('Name', themeIn.name), field('Banner', themeIn.banner), field('Art (https URL)', themeIn.art, 'ev-wide'),
    h('div', { class: 'ev-field ev-wide' }, h('span', { class: 'ev-lbl' }, 'Color'), swatches)));
  const syncKind = () => {
    const kd = f.kind.value;
    const mod = kd === 'modifier';
    pAud.el.hidden = mod; pRew.el.hidden = mod; testBtn.hidden = mod;
    perBox.hidden = kd === 'rank'; rankBox.hidden = kd !== 'rank';
    ruleDrop.hidden = kd !== 'drop'; ruleTrig.hidden = kd !== 'trigger'; ruleRank.hidden = kd !== 'rank';
    for (const inpEl of varRows.querySelectorAll('input')) inpEl.dispatchEvent(new Event('input'));
  };
  f.kind.addEventListener('change', syncKind);
  form.append(h('div', { class: 'cols-2' }, h('div', { class: 'stack' }, pBasics.el, pVars.el, pTheme.el), h('div', { class: 'stack' }, pAud.el, pRew.el, result.el)),
    msg, h('div', { class: 'ev-actions ev-bottom' }, testBtn, saveBtn, back === false ? null : h('a', { class: 'btn', href: back || (id ? `#/events/${id}` : '#/events') }, 'Back')));
  syncAud(); syncKind();
  return form;
}
