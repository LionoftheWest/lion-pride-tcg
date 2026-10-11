/**
 * Load test of the Dungeon fight path on the LOCAL stack (never live). N simulated members each start a run and attack
 * until the run ends or MAXACT actions. Run the server first (see the header of the report in the PR):
 *   LOADTEST=1 FEATURE_DUNGEON=1 SUPABASE_URL=<local> SUPABASE_SERVICE_ROLE_KEY=<local> PORT=4470 node tcg-activity/server.js
 *   [THINK=ms between actions, default 400] [RELOAD=every|kill: when the client reloads the view] node card-studio/scripts/loadtest-dungeon.mjs N [MAXACT] [PORT]
 * It resets today's runs of the N test members (local database only) and prints p50/p95 per route.
 * The database is the one named in %TEMP%/localdb.env (written by localdb/up.sh); the script refuses any other host.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const N = Number(process.argv[2] || 5), MAXACT = Number(process.argv[3] || 60), PORT = Number(process.argv[4] || 4470);
const env = Object.fromEntries(readFileSync(process.env.LOCALDB_ENV || join(process.env.TEMP || tmpdir(), 'localdb.env'), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.PGMETA_URL)) throw new Error('not a local database');
const sql = async (query) => { const r = await fetch(`${env.PGMETA_URL}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j; };
const RELOAD = process.env.RELOAD || 'kill'; const reloads = [];
const base = `http://127.0.0.1:${PORT}`;
const lat = {};   // route -> ms[]
const call = async (id, method, path, body) => {
  const t0 = performance.now();
  const r = await fetch(base + path, { method, headers: { Authorization: `Bearer lt:${id}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  (lat[`${method} ${path.split('?')[0]}`] ||= []).push(performance.now() - t0);
  return { status: r.status, j };
};
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const players = (await sql(`select p.id from players p where adventure_gate(p.id)->>'ok'='true' order by (select count(*) from player_cards pc where pc.player_id=p.id) desc limit ${N}`)).map((r) => r.id);
if (players.length < N) throw new Error(`only ${players.length} members pass the gate locally`);
await sql(`delete from dungeon_runs where player_id = any(array[${players.map((x) => `'${x}'`).join(',')}]) and day = dungeon_day()`).catch((e) => { throw new Error('reset failed: ' + e.message); });
const squadFor = async (id) => {
  const rows = await sql(`select pc.card_id id, s.type, c.rarity::text r, balance_num('dungeon','cost',c.rarity::text)::int cost from player_cards pc join cards c on c.id=pc.card_id join subjects s on s.id=c.subject_id where pc.player_id='${id}' and pc.quantity>0 order by cost desc`);
  const budget = (await sql(`select coalesce((select (rule->>'budget')::int from dungeon_days where day=dungeon_day()), balance_num('dungeon','budget')::int) b`))[0].b;
  const att = rows.filter((x) => x.type === 'Character' || x.type === 'Creature'), sup = rows.filter((x) => !(x.type === 'Character' || x.type === 'Creature'));
  const pick = []; let cost = 0;
  const take = (list, n) => { for (const c of list) { if (n === 0) break; if (cost + c.cost + 0 <= budget - (4 - pick.length) * 0 && !pick.includes(c)) { pick.push(c); cost += c.cost; n--; } } };
  for (const c of [...att].reverse()) { if (pick.length >= 4) break; if (cost + c.cost <= budget * 0.8) { pick.push(c); cost += c.cost; } }
  for (const c of [...att].reverse()) { if (pick.length >= 5) break; if (!pick.includes(c) && cost + c.cost <= budget) { pick.push(c); cost += c.cost; } }
  return pick.map((x) => Number(x.id));
};
const runOne = async (id) => {
  const cards = await squadFor(id);
  const s = await call(id, 'POST', '/api/dungeon/start', { cards });
  if (!s.j.ok) return { id, err: s.j.error || s.j.message || s.status };
  const v = await call(id, 'GET', '/api/dungeon');
  let acts = 0, st = v.j.run?.state || v.j.state, fails = 0;
  while (acts < MAXACT) {
    const ph = st?.phase;
    if (!ph || ph === 'fell' || ph === 'cleared' || ph === 'over') break;
    await new Promise((r) => setTimeout(r, Number(process.env.THINK || 400)));
    let a;
    if (ph === 'fight') {
      const alive = Object.entries(st.cards || {}).filter(([, c]) => !c.down && !c.sup).map(([k]) => Number(k));
      if (!alive.length) break;
      a = await call(id, 'POST', '/api/dungeon/attack', { cardId: alive[acts % alive.length] }); acts++;
    } else a = await call(id, 'POST', '/api/dungeon/choose', { pick: 0 });
    if (a.status === 429) { await new Promise((r) => setTimeout(r, 250)); continue; }
    if (!a.j.ok) { if (++fails > 5) return { id, acts, err: a.j.error }; continue; }
    st = a.j.state || st; if (a.j.status && a.j.status !== 'active') break;
    // The client reloads GET /api/dungeon (dungeon_view) after a fight action: RELOAD=every (before) or RELOAD=kill (after).
    if (ph === 'fight' && (RELOAD === 'every' || a.j.kill)) reloads.push(call(id, 'GET', '/api/dungeon'));
  }
  return { id, acts };
};
const t0 = performance.now();
const res = await Promise.all(players.map(runOne)); await Promise.all(reloads);
console.log(`N=${N} members, wall ${(performance.now() - t0).toFixed(0)} ms, actions ${res.reduce((a, r) => a + (r.acts || 0), 0)}, errors ${JSON.stringify(res.filter((r) => r.err).map((r) => r.err))}`);
console.log('route'.padEnd(26), 'n'.padStart(5), 'p50'.padStart(7), 'p95'.padStart(7), 'max'.padStart(7));
for (const [k, a] of Object.entries(lat)) console.log(k.padEnd(26), String(a.length).padStart(5), pct(a, 0.5).toFixed(0).padStart(7), pct(a, 0.95).toFixed(0).padStart(7), Math.max(...a).toFixed(0).padStart(7));
