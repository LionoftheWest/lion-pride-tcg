// Lion Pride TCG - Admin view: the pure logic of the event calendar (calendar.js). No DOM, no network, so node tests it
// (scripts/test-calendar-core.mjs). Every day is a Mountain Time calendar day 'YYYY-MM-DD' (the game day is MT).
//   monthGrid    the weeks of a month view (Sunday first, the days of the next and previous months fill the rows)
//   eventSpan    the first and the last MT day of an event (an end at 00:00 does not cover the next day)
//   layoutWeek   the bars of one week row: a column span and a lane for each event, the rest as "+N more" for each day
//   shiftEvent   drag: move an event, or move one edge, by whole days. The MT wall time stays (also across a DST change)
//   dragAllowed  what a drag may change in each status (a live event: only its end; F-1 item 8)
//   category     the color group of an event (D-186): hunt, modifier, community, dungeon
//   varErrors    the client copy of event_vars_errors (event_vars.sql): the form refuses a value outside the limits

export const TZ = 'America/Denver';

/* ---------- Mountain Time <-> ISO ---------- */
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parts = (ms) => Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
/** ISO -> the MT wall time 'YYYY-MM-DDTHH:MM' (the value of an input type=datetime-local). */
export const isoToMt = (iso) => {
  if (!iso) return '';
  const p = parts(Date.parse(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
/** The MT wall time 'YYYY-MM-DDTHH:MM' -> ISO (UTC). A wall time in the DST gap (02:30 on the spring day) moves forward. */
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
/** The MT day 'YYYY-MM-DD' of a time (ms or ISO). */
export const mtDay = (t) => isoToMt(new Date(typeof t === 'number' ? t : Date.parse(t)).toISOString()).slice(0, 10);

/* ---------- calendar days (pure date arithmetic on 'YYYY-MM-DD': no time zone) ---------- */
const dayMs = (d) => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d, n) => new Date(dayMs(d) + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 86400000);
export const weekday = (d) => new Date(dayMs(d)).getUTCDay(); // 0 = Sunday
export const monthKey = (d) => d.slice(0, 7);
/** 'YYYY-MM' + n months. */
export const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/**
 * The weeks of the month view of 'YYYY-MM': each week is 7 days, Sunday first (the Gauntlet week also starts on
 * Sunday). The first row holds the 1st, the last row holds the last day; 4 to 6 rows.
 * Returns { month, first, last, weeks: [[{ day, inMonth }, x7], ...] }; first/last = the first and the last day shown.
 */
export function monthGrid(ym) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new Error(`monthGrid: bad month ${ym}`);
  const d1 = `${ym}-01`;
  const dLast = addDays(`${addMonths(ym, 1)}-01`, -1);
  const first = addDays(d1, -weekday(d1));
  const last = addDays(dLast, 6 - weekday(dLast));
  const weeks = [];
  for (let d = first; d <= last; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => { const day = addDays(d, i); return { day, inMonth: monthKey(day) === ym }; }));
  }
  return { month: ym, first, last, weeks };
}

/** The end that the calendar shows: an event that ended early (End now) ends at ended_at. */
export const shownEnd = (ev) => (ev.status === 'ended' && ev.ended_at && Date.parse(ev.ended_at) < Date.parse(ev.ends_at) ? ev.ended_at : ev.ends_at);
/** The first and the last MT day of an event. The end is exclusive: an end at 00:00 MT does not cover that day. */
export function eventSpan(ev) {
  const s = Date.parse(ev.starts_at), e = Date.parse(shownEnd(ev));
  const a = mtDay(s);
  const b = e > s ? mtDay(e - 1) : a;
  return [a, b < a ? a : b];
}

/**
 * The bars of one week row. days = the 7 days of the week. events = rows with starts_at, ends_at (and id).
 * Each event that touches the week gets one segment: col (0-6), span (days), lane (0..), and contL / contR when it
 * goes on before or after this week. Lanes: by start, then the longer first, then the id (a stable order), each in the
 * first free lane. maxLanes: the segments in a lane >= maxLanes are hidden, and each day gets a count of its hidden events.
 * Returns { segs, more: [n x7], lanes }.
 */
export function layoutWeek(days, events, maxLanes = Infinity) {
  const w0 = days[0], w6 = days[6];
  const items = [];
  for (const ev of events) {
    const [a, b] = eventSpan(ev);
    if (b < w0 || a > w6) continue;
    const s = a < w0 ? w0 : a, e = b > w6 ? w6 : b;
    items.push({ ev, a, b, col: daysBetween(w0, s), span: daysBetween(s, e) + 1, contL: a < w0, contR: b > w6 });
  }
  items.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : 0) || daysBetween(y.a, y.b) - daysBetween(x.a, x.b)
    || (Date.parse(x.ev.starts_at) - Date.parse(y.ev.starts_at)) || (Number(x.ev.id) || 0) - (Number(y.ev.id) || 0));
  const laneEnd = []; // the last column used in each lane
  for (const it of items) {
    let lane = laneEnd.findIndex((end) => end < it.col);
    if (lane === -1) { lane = laneEnd.length; laneEnd.push(-1); }
    laneEnd[lane] = it.col + it.span - 1;
    it.lane = lane;
  }
  const more = [0, 0, 0, 0, 0, 0, 0];
  const segs = [];
  for (const it of items) {
    if (it.lane < maxLanes) { segs.push(it); continue; }
    for (let c = it.col; c < it.col + it.span; c++) more[c]++;
  }
  return { segs, more, lanes: laneEnd.length };
}

/** The events on one MT day (for the "+N more" list and the phone list), in start order. */
export const eventsOnDay = (day, events) => events.filter((ev) => { const [a, b] = eventSpan(ev); return a <= day && day <= b; })
  .sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at) || (Number(x.id) || 0) - (Number(y.id) || 0));

/* ---------- drag ---------- */
/** Move an ISO time by n MT calendar days, at the same MT wall time (15:00 MT stays 15:00 MT across a DST change). */
export const shiftIso = (iso, n) => {
  const w = isoToMt(iso);
  return mtToIso(`${addDays(w.slice(0, 10), n)}${w.slice(10)}`);
};
/**
 * mode 'move': both ends move by days. 'end': the end moves. 'start': the start moves. Returns { starts_at, ends_at }
 * or null when the result is empty (the end not after the start) or nothing changes.
 */
export function shiftEvent(ev, mode, days) {
  if (!days) return null;
  const s = mode === 'end' ? ev.starts_at : shiftIso(ev.starts_at, days);
  const e = mode === 'start' ? ev.ends_at : shiftIso(ev.ends_at, days);
  if (Date.parse(e) <= Date.parse(s)) return null;
  return { starts_at: s, ends_at: e };
}
/**
 * What a drag may change (admin_event_save): draft and scheduled: move and both edges; live: the end only (not before
 * now); ended, cancelled and the launch event: nothing. Returns { move, start, end }.
 */
export function dragAllowed(ev) {
  if (ev.kind === 'launch_cards' || !['draft', 'scheduled', 'live'].includes(ev.status)) return { move: false, start: false, end: false };
  if (ev.status === 'live') return { move: false, start: false, end: true };
  return { move: true, start: true, end: true };
}
/** The reason a drag result is refused before the server, or null. A live event: the end must stay after now. */
export function dragError(ev, mode, next, now = Date.now()) {
  const ok = dragAllowed(ev);
  if (!(mode === 'move' ? ok.move : mode === 'start' ? ok.start : ok.end)) {
    return ev.status === 'live' ? 'A live event cannot change its start.' : `An event that is ${ev.status} cannot change.`;
  }
  if (!next) return 'The end must be after the start.';
  if (ev.status === 'live' && Date.parse(next.ends_at) <= now) return 'The end of a live event must be after now (use End now).';
  return null;
}

/* ---------- color groups (D-186: one color and one icon for each kind) ---------- */
export const CATEGORIES = {
  hunt: { label: 'Hunt', icon: 'swords' },
  modifier: { label: 'Modifier', icon: 'trend' },
  community: { label: 'Community', icon: 'users' },
  dungeon: { label: 'Dungeon or Gauntlet', icon: 'castle' },
};
/**
 * hunt (kind hunt, F-1 PR 2); dungeon (a modifier that changes only Dungeon or Gauntlet variables); modifier (any other
 * modifier); community (the events that give gifts to members: drop, trigger, rank, the launch event).
 */
export function category(ev) {
  if (ev.kind === 'hunt') return 'hunt';
  if (ev.kind === 'modifier') {
    const keys = Object.keys(ev.vars || {});
    return keys.length && keys.every((k) => /^(dungeon|gauntlet)_/.test(k)) ? 'dungeon' : 'modifier';
  }
  return 'community';
}

/* ---------- variables ---------- */
/**
 * The client copy of event_vars_errors(kind, vars) (event_vars.sql): registered keys, numbers inside min..max, whole
 * numbers for a whole max variable, a modifier changes at least one variable. registry = [{ key, min_value, max_value,
 * whole, combine }]. Returns a list of texts; empty = valid.
 */
export function varErrors(kind, vars, registry) {
  const out = [];
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return ['vars must be an object'];
  const keys = Object.keys(vars).sort();
  if (kind === 'modifier' && !keys.length) out.push('vars: a modifier event changes at least one variable');
  for (const k of keys) {
    const v = registry.find((r) => r.key === k);
    if (!v) { out.push(`vars: ${k} is not a variable (event_vars)`); continue; }
    const n = vars[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) { out.push(`vars: ${k} must be a number`); continue; }
    if (n < Number(v.min_value) || n > Number(v.max_value)) out.push(`vars: ${k} must be from ${Number(v.min_value)} to ${Number(v.max_value)}`);
    if (v.whole && v.combine === 'max' && n !== Math.trunc(n)) out.push(`vars: ${k} must be a whole number`);
  }
  return out;
}

/** A key for a new event: the title as a-z, 0-9, _ and the start day, 3 to 48 characters (events.key). */
export function makeKey(title, day) {
  const base = String(title || 'event').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'event';
  const tail = `_${(day || '').replace(/-/g, '')}`;
  let k = `${base.slice(0, 48 - tail.length)}${tail}`.replace(/^_+/, '');
  if (!/^[a-z0-9]/.test(k)) k = `e${k}`;
  return k.length < 3 ? `${k}___`.slice(0, 3) : k.slice(0, 48);
}

/** A Postgres interval text ('7 days', '3 days 04:00:00', '12:00:00') -> a readable length. */
export function intervalText(v) {
  const m = /^(?:(\d+) days?)?\s*(?:(\d+):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(String(v || '').trim());
  if (!m) return String(v || '');
  const d = Number(m[1] || 0), hh = Number(m[2] || 0), mm = Number(m[3] || 0);
  return [d ? `${d} ${d === 1 ? 'day' : 'days'}` : null, hh ? `${hh} h` : null, mm ? `${mm} min` : null].filter(Boolean).join(' ') || '0';
}
