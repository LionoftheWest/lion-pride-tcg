/**
 * Route latency of ONE member at a time (no queue, no other load), against a local Activity server. The members take turns
 * and the passes are 11 s apart, so the per-member caches (8-10 s) are cold at every call: the time is the database round
 * trips of the route. Use it with the simulated database latency (scripts/sim-db-latency.mjs) to see the effect of the
 * number of round trips in a row.
 *   ROUTES=/api/hunt,/api/collection,/api/flags [N=8] [PASSES=3] [PORT=4470] node card-studio/scripts/loadtest-roundtrips.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const N = Number(process.env.N || 8), PASSES = Number(process.env.PASSES || 3), PORT = Number(process.env.PORT || 4470);
const ROUTES = (process.env.ROUTES || '/api/hunt,/api/collection,/api/flags').split(',').map((r) => (r.startsWith('/') ? r : '/' + r));
const env = Object.fromEntries(readFileSync(process.env.LOCALDB_ENV || join(process.env.TEMP || tmpdir(), 'localdb.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.PGMETA_URL)) throw new Error('not a local database');
const sql = async (query) => (await (await fetch(`${env.PGMETA_URL}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })).json());
const members = (await sql(`select id from players order by (select count(*) from player_cards pc where pc.player_id=players.id) desc limit ${N}`)).map((r) => r.id);
const lat = {};
for (let p = 0; p < PASSES; p++) {
  if (p) await new Promise((r) => setTimeout(r, 11000));
  for (const id of members) for (const route of ROUTES) {
    const t0 = performance.now();
    const r = await fetch(`http://127.0.0.1:${PORT}${route}`, { headers: { Authorization: `Bearer lt:${id}` } }); await r.text();
    if (p > 0 || PASSES === 1) (lat[route] ||= []).push(performance.now() - t0);   // pass 0 warms the server (catalog, boss moves)
  }
}
const pc = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))].toFixed(0);
for (const [route, a] of Object.entries(lat)) console.log(`${route.padEnd(24)} p50 ${pc(a, 0.5)} ms  p95 ${pc(a, 0.95)} ms  (${a.length} calls)`);
process.exit(0);
