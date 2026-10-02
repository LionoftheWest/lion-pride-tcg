import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mtDayStartISO } from './mt-time.js';

// The expected values come from the database (2026-10-02):
// date_trunc('day', t at time zone 'America/Denver') at time zone 'America/Denver'.
// They include the two daylight saving change days and the 6 PM MT hour that UTC got wrong.
const CASES = [
  ['2026-10-03T03:30:00Z', '2026-10-02T06:00:00.000Z'], // 9:30 PM MDT: still Oct 2 in MT
  ['2026-10-02T05:59:00Z', '2026-10-01T06:00:00.000Z'],
  ['2026-10-02T06:00:00Z', '2026-10-02T06:00:00.000Z'], // midnight MDT
  ['2026-12-15T06:59:00Z', '2026-12-14T07:00:00.000Z'],
  ['2026-12-15T07:00:00Z', '2026-12-15T07:00:00.000Z'], // midnight MST
  ['2026-11-01T06:30:00Z', '2026-11-01T06:00:00.000Z'], // fall back day
  ['2026-11-01T08:30:00Z', '2026-11-01T06:00:00.000Z'],
  ['2026-03-08T07:30:00Z', '2026-03-08T07:00:00.000Z'], // spring forward day
  ['2026-03-08T10:00:00Z', '2026-03-08T07:00:00.000Z'],
];

test('mtDayStartISO is the midnight MT that started the day (the database day)', () => {
  for (const [at, want] of CASES) assert.equal(mtDayStartISO(new Date(at)), want, at);
});
