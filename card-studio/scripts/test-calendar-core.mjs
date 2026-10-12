/**
 * Test of card-studio/public/admin/calendar-core.js (the pure logic of the Admin event calendar), no database:
 *   node scripts/test-calendar-core.mjs              must PASS
 *   MUTATE=<name> node scripts/test-calendar-core.mjs   must FAIL, for each name in MUT below
 *   MUTATE=all node scripts/test-calendar-core.mjs      prints the baseline, then one line for each mutation (each must FAIL)
 * Invariants:
 *   G1 the month grid: Sunday first, 7 days a row, the 1st in the first row and the last day in the last row, 4 to 6 rows,
 *      inMonth only for the days of the month (Feb 2026 = 4 rows, Aug 2026 = 6 rows, Oct 2026 = 5 rows)
 *   S1 the span of an event: MT days, the end exclusive (an end at 00:00 MT does not cover that day), a short event = 1 day,
 *      an event that ended early (End now) ends at ended_at
 *   L1 the bars of a week: a multi-day event is one segment for each week it touches, cut at the week edges with contL/contR;
 *      overlapping events get different lanes; a free lane is used again; the lanes past maxLanes are counted for each day
 *   D1 drag across a DST change keeps the MT wall time (15:00 MT stays 15:00 MT, so the UTC hour changes)
 *   D2 an edge drag moves only its edge; an empty result (end not after start) or 0 days = null
 *   D3 a live event: only its end (not move, not the start), and not to before now; ended / cancelled / launch: nothing
 *   C1 the color groups (D-186): hunt, dungeon (only dungeon_ / gauntlet_ vars), modifier, community
 *   V1 varErrors = event_vars_errors: an unknown key, a value outside min..max, a fraction for a whole max variable, a
 *      modifier with no vars are refused; a value on a limit and a fraction for a multiply variable are accepted
 *   K1 makeKey matches the events.key format ^[a-z0-9][a-z0-9_]{2,47}$
 *   M1 the month arithmetic: Dec + 1 = Jan of the next year, Jan - 1 = Dec
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SRC = fileURLToPath(new URL('../public/admin/calendar-core.js', import.meta.url));
// Each mutation breaks one mechanism; the test must FAIL for each.
const MUT = {
  grid_monday_first: ['first = addDays(d1, -weekday(d1))', 'first = addDays(d1, -((weekday(d1) + 6) % 7))'],
  grid_short: ['for (let d = first; d <= last; d = addDays(d, 7))', 'for (let d = first; d <= addDays(last, -7); d = addDays(d, 7))'],
  span_end_inclusive: ['const b = e > s ? mtDay(e - 1) : a;', 'const b = e > s ? mtDay(e) : a;'],
  span_utc_day: ['const a = mtDay(s);', 'const a = new Date(s).toISOString().slice(0, 10);'],
  span_ignore_ended_at: ["ev.status === 'ended' && ev.ended_at", "false && ev.ended_at"],
  lanes_no_reuse: ['let lane = laneEnd.findIndex((end) => end < it.col);', 'let lane = -1;'],
  lanes_overlap: ['laneEnd[lane] = it.col + it.span - 1;', 'laneEnd[lane] = it.col - 1;'],
  week_no_cut: ["const s = a < w0 ? w0 : a, e = b > w6 ? w6 : b;", 'const s = a, e = b;'],
  more_not_counted: ['for (let c = it.col; c < it.col + it.span; c++) more[c]++;', ''],
  shift_utc: ["return mtToIso(`${addDays(w.slice(0, 10), n)}${w.slice(10)}`);", 'return new Date(Date.parse(iso) + n * 86400000).toISOString();'],
  edge_moves_both: ["const s = mode === 'end' ? ev.starts_at : shiftIso(ev.starts_at, days);", 'const s = shiftIso(ev.starts_at, days);'],
  empty_allowed: ['if (Date.parse(e) <= Date.parse(s)) return null;', ''],
  live_moves: ["if (ev.status === 'live') return { move: false, start: false, end: true };", "if (ev.status === 'live') return { move: true, start: true, end: true };"],
  live_past_end: ["if (ev.status === 'live' && Date.parse(next.ends_at) <= now)", 'if (false)'],
  ended_drags: ["!['draft', 'scheduled', 'live'].includes(ev.status)", 'false'],
  dungeon_any: ['keys.every((k) => /^(dungeon|gauntlet)_/.test(k))', 'keys.some((k) => /^(dungeon|gauntlet)_/.test(k))'],
  vars_no_limits: ['if (n < Number(v.min_value) || n > Number(v.max_value))', 'if (false)'],
  vars_limit_exclusive: ['if (n < Number(v.min_value) || n > Number(v.max_value))', 'if (n <= Number(v.min_value) || n >= Number(v.max_value))'],
  vars_whole_all: ["if (v.whole && v.combine === 'max' && n !== Math.trunc(n))", 'if (v.whole && n !== Math.trunc(n))'],
  vars_modifier_empty: ["if (kind === 'modifier' && !keys.length)", 'if (false)'],
  month_wrap: ['return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, \'0\')}`;', 'return `${y}-${String(m + n).padStart(2, \'0\')}`;'],
};

if (process.env.MUTATE === 'all') {
  const run = (env) => spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const base = run({ MUTATE: '' });
  const baseLine = base.stdout.trim().split('\n').pop();
  console.log(`baseline (no mutation): exit ${base.status} ${baseLine}`);
  if (base.status !== 0) { console.log('the baseline is red: a mutation result is not valid'); process.exit(1); }
  let bad = 0;
  for (const name of Object.keys(MUT)) {
    const r = run({ MUTATE: name });
    const failed = r.status !== 0;
    if (!failed) bad++;
    const first = (r.stdout.split('\n').find((l) => l.startsWith('FAIL ')) || r.stderr.split('\n')[0] || '').slice(0, 110);
    console.log(`${failed ? 'KILLED  ' : 'SURVIVED'} ${name}  ${failed ? first : ''}`);
  }
  console.log(bad ? `MUTATION: ${bad} survived` : `MUTATION: all ${Object.keys(MUT).length} killed`);
  process.exit(bad ? 1 : 0);
}

let src = readFileSync(SRC, 'utf8');
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  if (!src.includes(m[0])) throw new Error(`mutation ${process.env.MUTATE}: the text is not in the source`);
  src = src.split(m[0]).join(m[1]);
}
const tmp = join(mkdtempSync(join(tmpdir(), 'calcore-')), 'calendar-core.mjs');
writeFileSync(tmp, src);
const C = await import(pathToFileURL(tmp).href);

let fails = 0, n = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 300)}`); };

// G1
for (const [ym, rows, first, last] of [['2026-02', 4, '2026-02-01', '2026-02-28'], ['2026-08', 6, '2026-07-26', '2026-09-05'], ['2026-10', 5, '2026-09-27', '2026-10-31'], ['2026-03', 5, '2026-03-01', '2026-04-04']]) {
  const g = C.monthGrid(ym);
  const flat = g.weeks.flat();
  const inM = flat.filter((x) => x.inMonth).map((x) => x.day);
  const days = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).getUTCDate();
  check(`G1 ${ym}: ${rows} rows, Sunday first, ${first}..${last}, ${days} days in the month`, g.weeks.length === rows && g.first === first && g.last === last
    && g.weeks.every((w) => w.length === 7 && C.weekday(w[0].day) === 0) && inM.length === days && inM[0] === `${ym}-01` && inM.at(-1) === `${ym}-${days}`
    && flat.every((x, i) => i === 0 || C.daysBetween(flat[i - 1].day, x.day) === 1), { rows: g.weeks.length, first: g.first, last: g.last, inM: inM.length });
}
// M1
check('M1 2026-12 + 1 = 2027-01, 2026-01 - 1 = 2025-12, + 14 = 2027-03', C.addMonths('2026-12', 1) === '2027-01' && C.addMonths('2026-01', -1) === '2025-12'
  && C.addMonths('2026-01', 14) === '2027-03', [C.addMonths('2026-12', 1), C.addMonths('2026-01', -1), C.addMonths('2026-01', 14)]);

// S1 (MT = UTC-6 in October, UTC-7 in December)
check('S1 an event Oct 10 15:00 MT .. Oct 13 00:00 MT covers Oct 10-12 (the end is exclusive)',
  eq(C.eventSpan({ starts_at: '2026-10-10T21:00:00Z', ends_at: '2026-10-13T06:00:00Z' }), ['2026-10-10', '2026-10-12']), C.eventSpan({ starts_at: '2026-10-10T21:00:00Z', ends_at: '2026-10-13T06:00:00Z' }));
check('S1 an event 20:00-23:00 MT on Oct 10 (02:00-05:00 UTC Oct 11) is on Oct 10 (the MT day, not UTC)',
  eq(C.eventSpan({ starts_at: '2026-10-11T02:00:00Z', ends_at: '2026-10-11T05:00:00Z' }), ['2026-10-10', '2026-10-10']), C.eventSpan({ starts_at: '2026-10-11T02:00:00Z', ends_at: '2026-10-11T05:00:00Z' }));
check('S1 an event that ended early (End now) ends at ended_at',
  eq(C.eventSpan({ status: 'ended', starts_at: '2026-10-10T18:00:00Z', ends_at: '2026-10-20T18:00:00Z', ended_at: '2026-10-12T18:00:00Z' }), ['2026-10-10', '2026-10-12']),
  C.eventSpan({ status: 'ended', starts_at: '2026-10-10T18:00:00Z', ends_at: '2026-10-20T18:00:00Z', ended_at: '2026-10-12T18:00:00Z' }));

// L1: the week of Oct 11-17 2026
const week = C.monthGrid('2026-10').weeks[2].map((x) => x.day);
const E = (id, a, b) => ({ id, starts_at: C.mtToIso(a), ends_at: C.mtToIso(b) });
const evs = [
  E(1, '2026-10-08T15:00', '2026-10-13T12:00'), // starts in the week before: Oct 11-13, contL
  E(2, '2026-10-12T00:00', '2026-10-20T00:00'), // overlaps 1, goes on to next week: Oct 12-17, contR
  E(3, '2026-10-14T10:00', '2026-10-14T11:00'), // after 1 ends: lane 0 is free again
  E(4, '2026-10-16T09:00', '2026-10-17T09:00'), // Oct 16-17
  E(5, '2026-10-16T10:00', '2026-10-16T12:00'), // Oct 16, a third lane
  E(6, '2026-10-18T00:00', '2026-10-19T00:00'), // next week: not in this row
];
const L = C.layoutWeek(week, evs);
const seg = (id) => L.segs.find((s) => s.ev.id === id);
check('L1 the week row holds the 5 events that touch it, not the one of the next week', L.segs.length === 5 && !seg(6), L.segs.map((s) => s.ev.id));
check('L1 a bar from the week before is cut at Sunday (col 0, 3 days, contL)', seg(1).col === 0 && seg(1).span === 3 && seg(1).contL && !seg(1).contR, seg(1));
check('L1 a bar into the next week is cut at Saturday (col 1, 6 days, contR)', seg(2).col === 1 && seg(2).span === 6 && seg(2).contR && !seg(2).contL, seg(2));
check('L1 overlapping events get different lanes; a free lane is used again', seg(1).lane === 0 && seg(2).lane === 1 && seg(3).lane === 0 && seg(4).lane === 0 && seg(5).lane === 2 && L.lanes === 3,
  L.segs.map((s) => [s.ev.id, s.lane]));
const no = (s) => s.segs.every((a) => s.segs.every((b) => a === b || a.lane !== b.lane || a.col + a.span <= b.col || b.col + b.span <= a.col));
check('L1 no two bars in one lane overlap', no(L), L.segs.map((s) => [s.ev.id, s.lane, s.col, s.span]));
const L2 = C.layoutWeek(week, evs, 2);
check('L1 maxLanes 2: the third lane is hidden and counted on its day (Oct 16 = col 5)', L2.segs.length === 4 && eq(L2.more, [0, 0, 0, 0, 0, 1, 0]), L2.more);
const next = C.layoutWeek(C.monthGrid('2026-10').weeks[3].map((x) => x.day), evs);
check('L1 the next week row continues event 2 (Oct 18-19, contL) and holds event 6', next.segs.find((s) => s.ev.id === 2)?.contL && next.segs.find((s) => s.ev.id === 2)?.span === 2 && next.segs.some((s) => s.ev.id === 6),
  next.segs.map((s) => [s.ev.id, s.col, s.span]));
check('L1 eventsOnDay(Oct 16) = 2, 4, 5 in start order', eq(C.eventsOnDay('2026-10-16', evs).map((e) => e.id), [2, 4, 5]), C.eventsOnDay('2026-10-16', evs).map((e) => e.id));

// D1: DST ends on Sunday Nov 1 2026 (UTC-6 -> UTC-7); starts on Sunday Mar 8 2026 (UTC-7 -> UTC-6)
const hunt = { status: 'scheduled', kind: 'drop', starts_at: '2026-10-29T21:00:00.000Z', ends_at: '2026-11-02T23:00:00.000Z' }; // Thu 15:00 MT .. Mon 16:00 MST
const moved = C.shiftEvent(hunt, 'move', 7);
check('D1 a move by 7 days across the fall DST change keeps 15:00 MT (22:00 UTC, not 21:00)', moved?.starts_at === '2026-11-05T22:00:00.000Z' && C.isoToMt(moved.starts_at) === '2026-11-05T15:00'
  && C.isoToMt(moved.ends_at) === '2026-11-09T16:00', moved);
const spring = C.shiftEvent({ status: 'draft', kind: 'drop', starts_at: C.mtToIso('2026-03-05T15:00'), ends_at: C.mtToIso('2026-03-06T15:00') }, 'move', 7);
check('D1 a move across the spring DST change keeps 15:00 MT (21:00 UTC, was 22:00)', spring?.starts_at === '2026-03-12T21:00:00.000Z' && C.isoToMt(spring.ends_at) === '2026-03-13T15:00', spring);
check('D1 mtToIso and isoToMt agree on both sides of a DST change', C.mtToIso('2026-11-01T00:30') === '2026-11-01T06:30:00.000Z' && C.mtToIso('2026-11-02T00:30') === '2026-11-02T07:30:00.000Z'
  && C.isoToMt('2026-11-02T07:30:00.000Z') === '2026-11-02T00:30', [C.mtToIso('2026-11-01T00:30'), C.mtToIso('2026-11-02T00:30')]);

// D2
const ev = { status: 'draft', kind: 'drop', starts_at: C.mtToIso('2026-10-14T15:00'), ends_at: C.mtToIso('2026-10-16T15:00') };
const endR = C.shiftEvent(ev, 'end', 2), startR = C.shiftEvent(ev, 'start', -1);
check('D2 the end edge +2 days: the start stays, the end moves', endR.starts_at === ev.starts_at && C.isoToMt(endR.ends_at) === '2026-10-18T15:00', endR);
check('D2 the start edge -1 day: the end stays, the start moves', startR.ends_at === ev.ends_at && C.isoToMt(startR.starts_at) === '2026-10-13T15:00', startR);
check('D2 the end edge -2 days (end = start) and 0 days are null', C.shiftEvent(ev, 'end', -2) === null && C.shiftEvent(ev, 'move', 0) === null, [C.shiftEvent(ev, 'end', -2)]);

// D3
const now = Date.parse('2026-10-15T12:00:00Z');
const live = { status: 'live', kind: 'modifier', starts_at: '2026-10-14T12:00:00Z', ends_at: '2026-10-17T12:00:00Z' };
check('D3 a live event: no move, no start edge, the end edge only', eq(C.dragAllowed(live), { move: false, start: false, end: true }), C.dragAllowed(live));
check('D3 a live event: a move is refused with the start rule', C.dragError(live, 'move', C.shiftEvent(live, 'move', 1), now) === 'A live event cannot change its start.', C.dragError(live, 'move', C.shiftEvent(live, 'move', 1), now));
check('D3 a live event: a later end is accepted, an end before now is refused', C.dragError(live, 'end', C.shiftEvent(live, 'end', 1), now) === null
  && /after now/.test(C.dragError(live, 'end', C.shiftEvent(live, 'end', -2), now) || ''), [C.dragError(live, 'end', C.shiftEvent(live, 'end', -2), now)]);
check('D3 ended, cancelled and the launch event: nothing', ['ended', 'cancelled'].every((st) => eq(C.dragAllowed({ ...live, status: st }), { move: false, start: false, end: false }))
  && eq(C.dragAllowed({ ...live, status: 'scheduled', kind: 'launch_cards' }), { move: false, start: false, end: false }), C.dragAllowed({ ...live, status: 'ended' }));
check('D3 draft and scheduled: move and both edges', eq(C.dragAllowed({ ...live, status: 'draft' }), { move: true, start: true, end: true }) && eq(C.dragAllowed({ ...live, status: 'scheduled' }), { move: true, start: true, end: true }), null);

// C1
check('C1 the color groups', C.category({ kind: 'hunt' }) === 'hunt' && C.category({ kind: 'modifier', vars: { dungeon_shards_mult: 2 } }) === 'dungeon'
  && C.category({ kind: 'modifier', vars: { dungeon_shards_mult: 2, pull_rare_mult: 2 } }) === 'modifier' && C.category({ kind: 'modifier', vars: { pull_rare_mult: 2 } }) === 'modifier'
  && ['drop', 'trigger', 'rank', 'launch_cards'].every((k) => C.category({ kind: k }) === 'community'), null);

// V1 (the first rows of event_vars.sql)
const REG = [
  { key: 'pull_rare_mult', min_value: 0.5, max_value: 5, whole: false, combine: 'multiply' },
  { key: 'daily_cap', min_value: 1, max_value: 20, whole: true, combine: 'max' },
  { key: 'daily_shards', min_value: 0, max_value: 5, whole: true, combine: 'multiply' },
];
check('V1 valid: a limit value, a fraction for a multiply variable (also a whole one), a whole max value', C.varErrors('modifier', { pull_rare_mult: 5, daily_shards: 1.5, daily_cap: 20 }, REG).length === 0
  && C.varErrors('modifier', { pull_rare_mult: 0.5 }, REG).length === 0, C.varErrors('modifier', { pull_rare_mult: 5, daily_shards: 1.5, daily_cap: 20 }, REG));
check('V1 above the max and below the min are refused', eq(C.varErrors('modifier', { pull_rare_mult: 5.01 }, REG), ['vars: pull_rare_mult must be from 0.5 to 5'])
  && C.varErrors('modifier', { daily_cap: 0 }, REG).length === 1, C.varErrors('modifier', { pull_rare_mult: 5.01 }, REG));
check('V1 a fraction for a whole max variable is refused', eq(C.varErrors('drop', { daily_cap: 2.5 }, REG), ['vars: daily_cap must be a whole number']), C.varErrors('drop', { daily_cap: 2.5 }, REG));
check('V1 an unknown key, a text value and a modifier with no vars are refused', C.varErrors('drop', { nope: 1 }, REG).length === 1 && C.varErrors('drop', { daily_cap: '3' }, REG).length === 1
  && eq(C.varErrors('modifier', {}, REG), ['vars: a modifier event changes at least one variable']) && C.varErrors('drop', {}, REG).length === 0, null);

// K1
const K = /^[a-z0-9][a-z0-9_]{2,47}$/;
const keys = [C.makeKey('Rare Rush!', '2026-10-14'), C.makeKey('', '2026-10-14'), C.makeKey('_x', ''), C.makeKey('Ünïcode Week '.repeat(10), '2026-12-31')];
check('K1 makeKey matches the events.key format', keys.every((k) => K.test(k)) && keys[0] === 'rare_rush_20261014', keys);
check('K1 intervalText', C.intervalText('7 days') === '7 days' && C.intervalText('1 day 04:00:00') === '1 day 4 h' && C.intervalText('12:30:00') === '12 h 30 min', [C.intervalText('1 day 04:00:00')]);

console.log(fails ? `FAIL ${fails} of ${n}` : `PASS all ${n}`);
process.exit(fails ? 1 : 0);
