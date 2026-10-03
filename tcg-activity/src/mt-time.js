// The game clock is Mountain Time (Nathan, 2026-09-30): a game day starts at midnight
// America/Denver, the same day the database uses (mt_clock.sql). Used by the server and
// the client, so both agree on "today".
const TZ = 'America/Denver';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today's MT date as "YYYY-MM-DD". */
export function mtToday(at = new Date()) {
  return dayFmt.format(at);
}

// Minutes east of UTC for the MT offset at an instant (MDT -360, MST -420).
function mtOffsetMin(at) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || 'GMT-7';
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : -420;
}

/** The midnight MT that started today, as an ISO timestamp (date_trunc('day', now() at time zone
 *  'America/Denver') at time zone 'America/Denver' in the database). */
export function mtDayStartISO(at = new Date()) {
  const [y, mo, d] = mtToday(at).split('-').map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0)); // that midnight, as if it were UTC
  return new Date(guess.getTime() - mtOffsetMin(guess) * 60000).toISOString();
}

/** The next midnight MT as an ISO timestamp (when the daily limits reset). */
export function nextMtMidnightISO(at = new Date()) {
  const [y, mo, d] = mtToday(at).split('-').map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d + 1, 0, 0, 0)); // that midnight, as if it were UTC
  return new Date(guess.getTime() - mtOffsetMin(guess) * 60000).toISOString();
}
