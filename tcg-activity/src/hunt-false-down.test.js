// HUNT-FALSE-DOWN (Nathan, 2026-11-06: "my squad was down on the hunt even though it wasn't").
// A live v2 day writes 8 hunt_card_hp bridge rows (downed = true at full HP, hunt_v2_start). When /api/hunt/v2/view failed
// (live p95 15-24 s, errors on 2026-11-06), the Hunt view fell back to the v1 roster and squadDown() read the bridge rows as a
// squad that is down. The invariant: while a live v2 day exists today, the v1 roster never decides "squad down".
//   node --test src/hunt-false-down.test.js            a mutation: MUTATE=<name> node --test src/hunt-false-down.test.js
//   MUTATE=all node src/hunt-false-down.test.js        the baseline and every mutation in one run (each must fail)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
// [file, the text, its replacement]: each mutation brings the defect back by one path; the tests below must fail on each.
export const MUTATIONS = {
  // the rule ignores the server flag
  rule_ignores_flag: ['squad-pick.js', 'return !!d?.v2day && !(v?.ok && v.day);', 'return false;'],
  // the rule trusts a failed v2 answer ({ ok: false } or null)
  rule_trusts_error: ['squad-pick.js', 'return !!d?.v2day && !(v?.ok && v.day);', 'return !!d?.v2day && !v;'],
  // the Hunt view stops calling the rule (the original defect)
  view_no_guard: ['main.js', '  if (v2DayUnread(d, huntV2)) {\n', '  if (false) {\n'],
  // the guard does not stop the v1 squad rule
  view_no_return: ['main.js', "    return;\n  }\n  const v2over = huntV2Over(huntV2);", "  }\n  const v2over = huntV2Over(huntV2);"],
  // the server stops sending the flag
  server_no_flag: ['../server.js', ', v2day: (v2row || []).length > 0 });', ' });'],
  // the server counts a practice day (no bridge rows) as a live day
  server_practice: ['../server.js', ".eq('day', today).eq('live', true).limit(1),", ".eq('day', today).limit(1),"],
};

const name = process.env.MUTATE;
if (name === 'all') {
  const run = (n) => spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], { env: { ...process.env, MUTATE: n }, encoding: 'utf8' });
  const base = run('');
  console.log(`baseline (no mutation) ${base.status === 0 ? 'PASS' : 'FAIL'}`);
  let ok = base.status === 0;
  for (const n of Object.keys(MUTATIONS)) { const r = run(n); const caught = r.status !== 0; ok = ok && caught; console.log(`mutation ${n.padEnd(20)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}`); }
  console.log(`mutations: baseline ${base.status === 0 ? 'PASS' : 'FAIL'}, ${ok ? 'all caught' : 'NOT all caught'}`);
  process.exit(ok ? 0 : 1);
}
const source = (file) => {
  const s = readFileSync(join(here, file), 'utf8').replace(/\r\n/g, '\n');
  const m = name && MUTATIONS[name];
  if (!m || m[0] !== file) return s;
  const n = s.split(m[1]).length - 1; if (n !== 1) throw new Error(`mutation ${name}: the text matches ${n} times, not once`);
  return s.replace(m[1], m[2]);
};
async function pick() {
  const m = name && MUTATIONS[name];
  if (!m || m[0] !== 'squad-pick.js') return import('./squad-pick.js');
  const file = join(here, `.mut-${name}-squad-pick.js`);
  writeFileSync(file, source('squad-pick.js'));
  try { return await import(pathToFileURL(file).href); } finally { rmSync(file, { force: true }); }
}
const P = await pick();

// The live bridge rows of 2026-11-06 (lionofthewest94, hunt 148564): 8 rows, downed = true, hp_remaining = max_hp.
const bridge = [54, 57, 107, 221, 254, 82, 330, 259].map((id) => ({ id, type: 'Character', used: true, downed: true, hp: 200, max_hp: 200 }));
const v1Answer = { hunt: { id: 148564 }, roster: bridge, squad: bridge.map((c) => String(c.id)), usedToday: 8, v2day: true };

test('the trap: the v1 rule reads the 8 bridge rows as a squad that is down', () => {
  assert.equal(P.squadDown(v1Answer.roster, v1Answer.squad), true);
});

test('a live v2 day with no v2 answer (an error, a dropped request) is unread: the view waits', () => {
  assert.equal(P.v2DayUnread(v1Answer, null), true, 'the request failed: huntV2 is null');
  assert.equal(P.v2DayUnread(v1Answer, { ok: false, error: 'busy' }), true, 'an error answer');
  assert.equal(P.v2DayUnread(v1Answer, { ok: true, live: true, day: null }), true, 'an answer with no day row');
});

test('a v2 answer with the day row decides the screen; no live v2 day keeps the v1 rule', () => {
  assert.equal(P.v2DayUnread(v1Answer, { ok: true, day: { status: 'active' }, run: { status: 'active' }, fight: {} }), false);
  assert.equal(P.v2DayUnread(v1Answer, { ok: true, day: { status: 'over', ended_by: 'squad_down' } }), false);
  assert.equal(P.v2DayUnread({ ...v1Answer, v2day: false }, null), false, 'a v1 day: the v1 rule decides');
  assert.equal(P.v2DayUnread({ hunt: null }, null), false);
});

test('the Hunt view asks the rule before the v1 squad rule, and returns', () => {
  const s = source('main.js');
  const body = s.slice(s.indexOf('function paintHuntView(d)'));
  const guard = body.indexOf('  if (v2DayUnread(d, huntV2)) {\n');
  const ko = body.indexOf('const koForDay = ');
  assert.ok(guard > 0 && ko > guard, 'v2DayUnread(d, huntV2) runs before koForDay in paintHuntView');
  const branch = body.slice(guard, body.indexOf('\n  }\n', guard) + 4);
  assert.match(branch, /\n    return;\n  }$/,'the guard returns before the v1 squad rule');
});

test('/api/hunt sends v2day from a live hunt_v2_days row of today', () => {
  const s = source('../server.js');
  const route = s.slice(s.indexOf("app.get('/api/hunt',"), s.indexOf("app.post('/api/hunt/attack'"));
  assert.ok(route.includes("supabase.from('hunt_v2_days').select('day').eq('hunt_id', hunt.id).eq('player_id', me.id).eq('day', today).eq('live', true).limit(1),"));
  assert.ok(route.includes(', v2day: (v2row || []).length > 0 });'), 'the answer carries v2day');
});
