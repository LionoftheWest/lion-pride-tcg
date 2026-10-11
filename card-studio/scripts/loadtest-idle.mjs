/**
 * Calls-per-member-per-minute of an IDLE member, on the LOCAL stack only (never live).
 * Each simulated member runs the real timer list of the client (the schedules below are copied from the source, file:line
 * in the comments) against a local Activity server. The script counts the database statements through pg_stat_statements
 * (local) and prints them per member per minute. Run the server first:
 *   LOADTEST=1 FEATURE_HUNT=1 FEATURE_DUNGEON=1 FEATURE_SHARDS=1 SUPABASE_URL=<local> SUPABASE_SERVICE_ROLE_KEY=<local> PORT=4471 node server.js
 *   SCHEDULE=before|after SCENARIO=home|hunt|dailies [N=10] [SECONDS=120] [PORT=4471] node card-studio/scripts/loadtest-idle.mjs
 * SCHEDULE=before: the timers and the Home / Hunt calls of origin/main 6e042e8 (2026-10-11). after: this branch.
 * Note: other sessions that use the same local database add noise; the table shows the functions, so read those rows.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const N = Number(process.env.N || 10), SECONDS = Number(process.env.SECONDS || 120), PORT = Number(process.env.PORT || 4471);
const SCHEDULE = process.env.SCHEDULE || 'after', SCENARIO = process.env.SCENARIO || 'home';
const env = Object.fromEntries(readFileSync(process.env.LOCALDB_ENV || join(process.env.TEMP || tmpdir(), 'localdb.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.PGMETA_URL)) throw new Error('not a local database');
const sql = async (query) => { const r = await fetch(`${env.PGMETA_URL}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j; };
const A = SCHEDULE === 'after';
// [path, every seconds (0 = once at start)]: the client's timers.
const BACKGROUND = [
  ['/api/notifications/count', 45],            // main.js:340 every(45000, refreshNotifBadge)
  ['/api/pack-status', 45],                    // main.js:347
  ['/api/trades', 45],                         // main.js:349
  ['/api/effects/me', A ? 45 : 30],            // effects-ui.js:61
  ['/api/effects/badges', A ? 45 : 30],        // effects-ui.js:62
  ['/api/shop', 60],                           // ui-v2-shop.js:84
  [A ? '/api/hunt?light=1' : '/api/hunt', 300],// main.js:464 huntDot (the red dot on the Hunt button)
  ['/api/collection', 0],                      // refreshOwned at start
];
const DAILIES_BADGE = ['/api/dailies', A ? 120 : 60];   // ui-v2-dailies.js:70
const HOME = [[A ? '/api/hunt?light=1' : '/api/hunt', 0], ['/api/profile', 0], ['/api/catalog', 0], ['/api/dungeon', 0], ['/api/gauntlet', 0]];   // ui-v2.js:1184 (each Home visit)
const SCENARIOS = {
  home: { start: HOME, timers: [...BACKGROUND, DAILIES_BADGE, ['/api/hunt/feed', 0]] },
  // the Hunt screen: the full /api/hunt twice at open (renderHunt + backgroundRefreshHunt), the feed every 3 s (main.js:1322)
  hunt: { start: [['/api/hunt', 0], ['/api/hunt', 0], ['/api/collection', 0]], timers: [...BACKGROUND, DAILIES_BADGE, ['/api/hunt/feed', 3]] },
  // the Dailies window open: every 10 s before, 30 s after (ui-v2-dailies.js:175); the badge timer skips while it is open (after)
  dailies: { start: [...HOME, ['/api/dailies', 0]], timers: [...BACKGROUND, ...(A ? [] : [DAILIES_BADGE]), ['/api/dailies', A ? 30 : 10]] },
};
const sc = SCENARIOS[SCENARIO]; if (!sc) throw new Error('SCENARIO');
const members = (await sql(`select id from players order by (select count(*) from player_cards pc where pc.player_id=players.id) desc limit ${N}`)).map((r) => r.id);
const base = `http://127.0.0.1:${PORT}`;
const http = {}; const lat = [];
const call = async (id, path) => {
  const t0 = performance.now();
  try { const r = await fetch(base + path, { headers: { Authorization: `Bearer lt:${id}` } }); await r.text(); const k = path.split('?')[0]; http[k] = (http[k] || 0) + 1; lat.push(performance.now() - t0); }
  catch { /* counted as nothing */ }
};
// Group the statements by function: the PostgREST text of an RPC names it after "public".
const LABEL = String.raw`coalesce('rpc ' || (regexp_match(query, '"public"[.]"([a-z_]+)"[(]'))[1], 'rest ' || coalesce((regexp_match(query, 'FROM "public"[.]"([a-z_]+)"'))[1], left(query, 50)))`;
await sql('select pg_stat_statements_reset()');
const timers = [];
for (const id of members) {
  const off = Math.random();   // members do not start in the same second
  for (const [p] of sc.start) setTimeout(() => call(id, p), off * 1000);
  for (const [p, every] of sc.timers) {
    setTimeout(() => call(id, p), off * 1000);
    if (every) timers.push(setInterval(() => call(id, p), every * 1000 * (0.97 + Math.random() * 0.06)));
  }
}
await new Promise((r) => setTimeout(r, SECONDS * 1000));
timers.forEach(clearInterval);
await new Promise((r) => setTimeout(r, 1500));
const rows = await sql(`select ${LABEL} q, sum(calls)::int c, sum(total_exec_time)::int ms from pg_stat_statements group by 1 order by 3 desc`);
const keep = rows.filter((r) => !/pg_stat_statements|pg_meta|information_schema|pg_catalog|set_config|^rpc (pg_|set_)|storage|^(BEGIN|COMMIT|SET|SHOW)/i.test(r.q));
const per = (x) => (x / N / (SECONDS / 60)).toFixed(2);
const totalCalls = keep.reduce((a, r) => a + r.c, 0), totalMs = keep.reduce((a, r) => a + r.ms, 0);
console.log(`SCHEDULE=${SCHEDULE} SCENARIO=${SCENARIO} N=${N} SECONDS=${SECONDS}`);
console.log(`HTTP calls per member per minute: ${per(Object.values(http).reduce((a, b) => a + b, 0))}   mean latency ${(lat.reduce((a, b) => a + b, 0) / lat.length).toFixed(0)} ms   p95 ${[...lat].sort((a, b) => a - b)[Math.floor(lat.length * 0.95)]?.toFixed(0)} ms`);
console.log(`database statements per member per minute: ${per(totalCalls)}   database time per member per minute: ${(totalMs / N / (SECONDS / 60)).toFixed(0)} ms`);
console.log('HTTP by route (per member per minute):', Object.entries(http).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${per(v)}`).join(', '));
for (const r of keep.slice(0, 10)) console.log(`  ${String(r.ms).padStart(6)} ms  ${String(r.c).padStart(5)} calls  ${r.q}`);
process.exit(0);
