/**
 * Fight pressure test: N scratch players (lt_open_*) each fight ONE daily battle against
 * one boss, all at the same time, through the real hunt_attack RPC. Each player attacks
 * with a ready card until all its cards are down (or MAX attacks). Reports the attack
 * latency, the throughput, every error, and the boss HP. Run ON THE VM, against a
 * SCRATCH boss only (its events must be muted; see the setup SQL in the PR):
 *   node tools/pressure.mjs <players=100> <hunt_id=2> [max_attacks=40]
 */
import { createClient } from '@supabase/supabase-js';

const N = Number(process.argv[2] || 100);
const HUNT = Number(process.argv[3] || 2);
const MAX = Number(process.argv[4] || 40);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ids = Array.from({ length: N }, (_, i) => `lt_open_${String(i).padStart(4, '0')}`);
// The squad = up to 8 attacker cards (a pack opened during the test adds support cards).
const { data: pc, error: pcErr } = await sb.from('player_cards').select('player_id, card_id, card:cards(subject:subjects(tags))').in('player_id', ids);
if (pcErr) { console.error(pcErr.message); process.exit(1); }
const squads = new Map(ids.map((id) => [id, []]));
for (const r of pc) {
  const sq = squads.get(r.player_id);
  if (r.card?.subject?.tags?.class === 'attacker' && sq.length < 8) sq.push(r.card_id);
}
const { data: h0 } = await sb.from('hunts').select('hp_remaining, hp_max, status, name').eq('id', HUNT).single();
if (!/zzz|pressure/i.test(h0?.name || '')) { console.error(`hunt ${HUNT} is not a scratch boss: ${h0?.name}`); process.exit(1); }

// TARGET=http://127.0.0.1:4466: attack through the Activity server (its gate and caches),
// logged in as the scratch player (the server must run with LOADTEST=1 and LOADTEST_HUNT_ID).
const TARGET = process.env.TARGET || '';
async function viaApp(pid, card) {
  try {
    const r = await fetch(`${TARGET}/api/hunt/attack`, { method: 'POST', headers: { authorization: `Bearer lt:${pid}`, 'content-type': 'application/json' }, body: JSON.stringify({ cardId: card }) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { data: j, error: null } : { data: null, error: { code: String(r.status), message: j.error || 'http' } };
  } catch (e) { return { data: null, error: { code: 'EXC', message: String(e) } }; }
}
const calls = [];
let defeatedAt = null;
const t0 = performance.now();

async function battle(pid) {
  const alive = [...squads.get(pid)];
  let k = 0, fails = 0;
  while (alive.length && k < MAX) {
    const card = alive[k % alive.length];
    k += 1;
    const s = performance.now();
    const { data, error } = TARGET ? await viaApp(pid, card) : await sb.rpc(process.env.RPC || 'hunt_attack', { p_player: pid, p_hunt: HUNT, p_card: card });
    const ms = performance.now() - s;
    const rec = { ms, at: s - t0, kind: error ? `ERR ${error.code || ''} ${String(error.message).slice(0, 60)}` : data?.ok ? 'ok' : `no:${data?.error}` };
    calls.push(rec);
    if (error) { if (++fails >= 3) return; continue; }
    if (data?.defeated && defeatedAt === null) defeatedAt = (performance.now() - t0) / 1000;
    if (!data?.ok) {
      if (data?.error === 'hunt_over') return;
      if (data?.error === 'downed' || data?.error === 'day_limit') alive.splice(alive.indexOf(card), 1);
      continue; // stunned: try the next card
    }
    if (data.card_downed) alive.splice(alive.indexOf(card), 1);
  }
}

await Promise.all(ids.map((id) => battle(id)));
const wall = (performance.now() - t0) / 1000;
const { data: h1 } = await sb.from('hunts').select('hp_remaining, status').eq('id', HUNT).single();

const lat = calls.map((c) => c.ms).sort((a, b) => a - b);
const p = (q) => lat[Math.min(lat.length - 1, Math.floor((q / 100) * lat.length))] || 0;
const kinds = {};
for (const c of calls) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
// throughput per 5 s window
const win = {};
for (const c of calls) { const w = Math.floor(c.at / 5000) * 5; win[w] = (win[w] || 0) + 1; }
console.log(`\nFIGHT ${N} players vs hunt ${HUNT} (${h0.name}), max ${MAX} attacks each`);
console.log(`  calls ${calls.length} in ${wall.toFixed(1)}s = ${(calls.length / wall).toFixed(1)} attacks/s`);
console.log(`  latency p50 ${p(50).toFixed(0)}ms  p95 ${p(95).toFixed(0)}ms  p99 ${p(99).toFixed(0)}ms  max ${p(100).toFixed(0)}ms`);
console.log(`  results ${JSON.stringify(kinds)}`);
console.log(`  per 5 s: ${Object.entries(win).map(([w, n]) => `${w}s:${n}`).join(' ')}`);
console.log(`  boss HP ${h0.hp_remaining} -> ${h1.hp_remaining} (${h1.status})${defeatedAt !== null ? `, defeated at ${defeatedAt.toFixed(1)}s` : ''}\n`);
