// Lion Pride TCG - Admin view: the Events page (list, one event, the editor). The first page that writes.
// Data: /api/admin/events* (src/admin-events-routes.js -> the admin_event* SQL functions, tcg-bot/supabase/events.sql).
// "Test, then apply": Test shows who would get what (admin_event_preview_draft, nothing saved); Save writes the event
// (a draft); Schedule makes it start at its time; the pg_cron job event-tick starts, pays and ends it.
// The shell (admin.js) passes its helpers in `k`. Every text goes in as textContent (member names are data).

const KINDS = [['drop', 'Drop'], ['trigger', 'Trigger'], ['rank', 'Rank']];
const KIND_LABEL = { drop: 'Drop', trigger: 'Trigger', rank: 'Rank', launch_cards: 'Launch cards' };
const TRIGGERS = [['hunt_hit', 'Hunt hit'], ['tutorial_done', 'Tutorial done'], ['pack_opened', 'Pack opened'], ['dungeon_run', 'Dungeon run']];
const METRICS = [['hunt_damage', 'Hunt damage'], ['packs_opened', 'Packs opened']];
const STATUS = { live: ['pass', 'Live'], scheduled: ['info', 'Scheduled'], draft: ['idle', 'Draft'], ended: ['idle', 'Ended'], cancelled: ['warn', 'Cancelled'] };
const ERRORS = {
  stale: 'This event changed since this page loaded. Reload the event.',
  locked: 'This event cannot change.',
  bad_status: 'This action is not possible in this status.',
  not_found: 'No event with this id.',
};
const TZ = 'America/Denver';

/* ---------- Mountain Time <-> ISO (the game day is MT; the inputs show MT) ---------- */
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parts = (ms) => Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
export const isoToMt = (iso) => {
  if (!iso) return '';
  const p = parts(Date.parse(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
export const mtToIso = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v || '');
  if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = want;
  for (let i = 0; i < 3; i++) { // the MT offset at that time (DST): move until the MT wall time matches
    const p = parts(t);
    const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    if (seen === want) break;
    t += want - seen;
  }
  return new Date(t).toISOString();
};

/* ---------- writes ---------- */
async function send(path, body) {
  const r = await fetch(`/api/admin/events${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-admin-write': '1', accept: 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new Error('Login required'); }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(j?.error || `The server answered ${r.status}`);
  return j;
}
const problems = (res) => [ERRORS[res?.error] || null, ...(res?.errors || [])].filter(Boolean);

let cssOnce = false;
function css() {
  if (cssOnce) return;
  cssOnce = true;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/admin/events.css' }));
}

export async function pageEvents(main, args, q, k) {
  css();
  // The shell decodes each group of the route; an empty group arrives as the text "undefined".
  const [idOrNew, edit] = args.map((x) => (x && x !== 'undefined' ? x : null));
  if (!idOrNew) return listPage(main, k);
  if (idOrNew === 'new') return formPage(main, null, k);
  if (edit) return formPage(main, Number(idOrNew), k);
  return detailPage(main, Number(idOrNew), k);
}

const statusOf = (k, st) => { const [c, t] = STATUS[st] || ['idle', k.label(st)]; return k.statusTag(c, t); };

/* ---------- the list ---------- */
function listPage(main, k) {
  const { h, icon } = k;
  main.append(k.pageHead('Events', null, h('a', { class: 'btn primary', href: '#/events/new' }, icon('calendar'), 'New event')));
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
const audienceText = (a, k) => {
  if (!a || a.all) return 'Everyone';
  const out = [];
  if (a.active_since) out.push(`Active since ${k.when(a.active_since, true)}`);
  if (a.joined_after) out.push(`Joined after ${k.when(a.joined_after, true)}`);
  if (a.joined_before) out.push(`Joined before ${k.when(a.joined_before, true)}`);
  if (a.tutorial_done) out.push('Tutorial done');
  if (a.members) out.push(`${a.members.length} listed members`);
  return out.join(', ');
};
const rewardText = (x) => [x.packs ? `${x.packs} ${x.packs === 1 ? 'pack' : 'packs'}` : null, x.shards ? `${x.shards} Shards` : null,
  x.card_id ? `card #${x.card_id}` : null].filter(Boolean).join(', ') || '-';

function detailPage(main, id, k) {
  const { h, icon } = k;
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
    const d = await k.api(`/events/${id}`);
    if (!d.found) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No event with this id'));
    const e = d.event;
    head.querySelector('.title').textContent = e.title;
    const up = { expected_updated_at: e.updated_at };
    const buttons = [];
    if (d.editable !== 'none') buttons.push(h('a', { class: 'btn', href: `#/events/${id}/edit` }, 'Edit'));
    if (e.kind !== 'launch_cards') buttons.push(h('button', { class: 'btn', type: 'button', onclick: () => showPreview() }, 'Preview'));
    if (e.status === 'draft' && e.kind !== 'launch_cards') buttons.push(h('button', { class: 'btn primary', type: 'button', onclick: () => act(`/${id}/schedule`, { ...up, on: true }, 'Schedule this event?') }, 'Schedule'));
    if (e.status === 'scheduled') buttons.push(h('button', { class: 'btn', type: 'button', onclick: () => act(`/${id}/schedule`, { ...up, on: false }) }, 'Back to draft'));
    if (e.status === 'live' && e.kind !== 'launch_cards') buttons.push(h('button', { class: 'btn', type: 'button', onclick: () => act(`/${id}/end`, up, 'End this event now and pay its end?') }, 'End now'));
    if (['draft', 'scheduled', 'live'].includes(e.status) && e.kind !== 'launch_cards') {
      buttons.push(h('button', { class: 'btn ev-danger', type: 'button', onclick: () => act(`/${id}/cancel`, up, 'Cancel this event? It pays nothing more.') }, 'Cancel event'));
    }
    const c = d.claims || {};
    const facts = k.panel('Event', { right: statusOf(k, e.status) });
    const dl = (rows) => h('dl', { class: 'ev-dl' }, rows.filter(Boolean).map(([t, v]) => [h('dt', null, t), h('dd', null, v)]));
    const r = e.rewards || {};
    facts.body.append(dl([
      ['Key', h('span', { class: 'num' }, e.key)], ['Kind', KIND_LABEL[e.kind] || e.kind],
      ['Start', k.when(e.starts_at, true)], ['End', k.when(e.ends_at, true)], e.ended_at ? ['Ended', k.when(e.ended_at, true)] : null,
      ['Audience', audienceText(e.audience, k)],
      e.rules?.trigger ? ['Trigger', (TRIGGERS.find((x) => x[0] === e.rules.trigger) || [, e.rules.trigger])[1]] : null,
      e.rules?.metric ? ['Ranked by', (METRICS.find((x) => x[0] === e.rules.metric) || [, e.rules.metric])[1]] : null,
      e.kind === 'drop' ? ['Late joiners', e.rules?.late_joiners ? 'Yes' : 'No'] : null,
      r.title ? ['Bell title', r.title] : null,
      r.per_member ? ['Each member', rewardText(r.per_member)] : null,
      ...(r.ranks || []).map((t) => [t.from === t.to ? `Rank ${t.from}` : `Ranks ${t.from}-${t.to}`, rewardText(t)]),
      e.rules?.settings_key ? ['Settings', h('span', { class: 'num' }, e.rules.settings_key)] : null,
      d.cards?.length ? ['Cards', d.cards.map((x) => `${x.name} (#${x.id})`).join(', ')] : null,
      e.description ? ['Description', e.description] : null,
      ['Created by', e.created_by],
    ]));
    const pv = k.panel('Preview');
    pv.el.hidden = true;
    function showPreview() {
      pv.el.hidden = false;
      k.fill(pv.body, async () => previewView(await k.api(`/events/${id}/preview`), k));
      pv.el.scrollIntoView({ block: 'nearest' });
    }
    const pays = k.panel('Payouts');
    pays.body.append(...[d.payouts.length ? k.table({ phone: 'table', rows: d.payouts, cols: [
      { key: 'period', label: 'Run', fmt: (x) => (x.period.startsWith('tick:') ? 'Tick' : k.label(x.period)) },
      { key: 'paid_at', label: 'Paid', fmt: (x) => k.when(x.paid_at, true) },
      { key: 'members', label: 'Members', r: true, fmt: (x) => k.N(x.members) }, { key: 'packs', label: 'Packs', r: true, fmt: (x) => k.N(x.packs) },
      { key: 'shards', label: 'Shards', r: true, fmt: (x) => k.N(x.shards) }, { key: 'cards', label: 'Cards', r: true, fmt: (x) => k.N(x.cards) }] }) : h('div', { class: 'empty' }, 'No payouts')].flat());
    const log = k.panel('Log');
    log.body.append(...[d.log.length ? k.table({ rows: d.log, title: 'action', cols: [
      { key: 'action', label: 'Action', fmt: (x) => k.label(x.action) }, { key: 'at', label: 'When', fmt: (x) => k.when(x.at, true) },
      { key: 'actor', label: 'Who' }, { key: 'new', label: 'Change', fmt: (x) => h('span', { class: 'json-text' }, changeText(x, k)) }] }) : h('div', { class: 'empty' }, 'No changes')].flat());
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
const changeText = (x, k) => {
  const v = (val) => (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(val) ? k.when(val, true) : JSON.stringify(val ?? null));
  const n = x.new || {};
  if (x.action === 'pay') return `${n.members} members, ${n.packs} packs, ${n.shards} Shards, ${n.cards} cards`;
  if (x.action === 'create' || x.action === 'migrate') return '';
  return Object.keys(n).map((key) => `${key}: ${v(x.old?.[key])} -> ${v(n[key])}`).join(', ');
};

function previewView(p, k) {
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
const blank = () => {
  const start = new Date(Date.now() + 86400000);
  start.setUTCMinutes(0, 0, 0);
  return { key: '', kind: 'drop', title: '', description: '', starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 7 * 86400000).toISOString(),
    audience: { all: true }, rewards: { per_member: { packs: 1 } }, rules: {} };
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
    if (id) {
      const d = await k.api(`/events/${id}`);
      if (!d.found) return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No event with this id'));
      ev = d.event; editable = d.editable; updatedAt = d.event.updated_at; status = d.event.status;
      if (editable === 'none') return h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'This event cannot change'));
    }
    return editor(ev, { id, editable, updatedAt, status }, k);
  });
}

function editor(ev, { id, editable, updatedAt, status }, k) {
  const { h } = k;
  const lockAll = editable === 'text_and_end';                 // a live event: title, description, end
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
  const syncKind = () => {
    const kd = f.kind.value;
    perBox.hidden = kd === 'rank'; rankBox.hidden = kd !== 'rank';
    ruleDrop.hidden = kd !== 'drop'; ruleTrig.hidden = kd !== 'trigger'; ruleRank.hidden = kd !== 'rank';
  };
  f.kind.addEventListener('change', syncKind);

  // The values as the API takes them (only the fields the status allows).
  const intOr = (el) => (el.value === '' ? undefined : Number(el.value));
  const reward = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== 0 && !Number.isNaN(v)));
  function collect() {
    const out = { title: f.title.value.trim(), description: f.description.value, ends_at: mtToIso(f.ends_at.value) };
    if (id) out.id = id;
    if (lockAll) return out;
    if (!lockKey) { out.key = f.key.value.trim(); out.kind = f.kind.value; }
    out.starts_at = mtToIso(f.starts_at.value);
    if (aud.mode.value === 'all') out.audience = { all: true };
    else {
      const au = {};
      for (const key of ['active_since', 'joined_after', 'joined_before']) if (aud[key].value) au[key] = mtToIso(aud[key].value);
      if (aud.tutorial_done.checked) au.tutorial_done = true;
      const ids = aud.members.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
      if (ids.length) au.members = [...new Set(ids)];
      out.audience = au;
    }
    const kd = f.kind.value;
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
    if (k.session.source !== 'LOCAL' && !window.confirm(`Save this event to the ${k.session.source || '?'} database?`)) return;
    saveBtn.disabled = true;
    msg.replaceChildren();
    try {
      const res = await send('/', { event: collect(), expected_updated_at: updatedAt });
      if (res.ok === false) { msg.replaceChildren(...problems(res).map((t) => h('p', { class: 'ev-err' }, t))); return; }
      location.hash = `#/events/${res.event.id}`;
    } catch (err) { msg.replaceChildren(h('p', { class: 'ev-err' }, err.message)); } finally { saveBtn.disabled = false; }
  } });
  const pBasics = k.panel('Event');
  pBasics.body.append(h('div', { class: 'ev-grid' }, field('Title', f.title), field('Key', f.key), field('Kind', f.kind),
    field('Start (MT)', f.starts_at), field('End (MT)', f.ends_at), field('Description', f.description, 'ev-wide')));
  const pAud = k.panel('Audience');
  pAud.body.append(h('div', { class: 'ev-grid' }, field('Who', aud.mode)), filters);
  const pRew = k.panel('Rewards');
  pRew.body.append(h('div', { class: 'ev-grid' }, field('Bell title', bellTitle), ruleTrig, ruleRank, ruleDrop), perBox, rankBox);
  form.append(h('div', { class: 'cols-2' }, h('div', { class: 'stack' }, pBasics.el, pAud.el), h('div', { class: 'stack' }, pRew.el, result.el)),
    msg, h('div', { class: 'ev-actions ev-bottom' }, testBtn, saveBtn, h('a', { class: 'btn', href: id ? `#/events/${id}` : '#/events' }, 'Back')));
  syncAud(); syncKind();
  return form;
}
