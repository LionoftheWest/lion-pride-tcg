/**
 * Per-endpoint latency: for each GET path, one cold call, then CONC concurrent calls from
 * CONC different scratch players. Finds the endpoint that bends under load.
 *   TARGET=http://127.0.0.1:4466 CONC=50 node tools/endpoints.mjs   (server with LOADTEST=1)
 */
const TARGET = process.env.TARGET || 'http://127.0.0.1:4466';
const CONC = Number(process.env.CONC || 50);
const PATHS = (process.env.PATHS || '/api/config,/api/flags,/api/catalog,/api/collection,/api/pulls,/api/pack-status,/api/players,/api/hunt,/api/hunt/feed,/api/hunt/leaderboard,/api/leaderboard,/api/leaderboard/v2,/api/profile,/api/effects/me,/api/effects/on,/api/effects/recent,/api/effects/badges,/api/notifications,/api/trades').split(',');
const uid = (i) => `lt_open_${String(i % 100).padStart(4, '0')}`;
async function call(path, i) {
  const t = performance.now();
  try {
    const r = await fetch(TARGET + path, { headers: { authorization: `Bearer lt:${uid(i)}` } });
    const body = await r.text();
    return { ms: performance.now() - t, status: r.status, err: r.status >= 400 ? body.slice(0, 80) : '' };
  } catch (e) { return { ms: performance.now() - t, status: 'EXC', err: String(e).slice(0, 80) }; }
}
for (const path of PATHS) {
  const one = await call(path, 7);
  const t = performance.now();
  const rs = await Promise.all(Array.from({ length: CONC }, (_, i) => call(path, i)));
  const wall = performance.now() - t;
  const lat = rs.map((r) => r.ms).sort((a, b) => a - b);
  const bad = rs.filter((r) => r.status !== 200);
  console.log(`${path.padEnd(22)} single ${String(Math.round(one.ms)).padStart(5)}ms ${one.status} | x${CONC}: p50 ${String(Math.round(lat[CONC >> 1])).padStart(5)}ms max ${String(Math.round(lat[CONC - 1])).padStart(5)}ms wall ${String(Math.round(wall)).padStart(5)}ms bad ${bad.length}${bad.length ? ' ' + JSON.stringify([...new Set(bad.map((b) => `${b.status} ${b.err}`))].slice(0, 2)) : ''}`);
}
