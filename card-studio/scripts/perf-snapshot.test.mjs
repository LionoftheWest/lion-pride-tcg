// node --test scripts/perf-snapshot.test.mjs  (no network: a fixture of a real pg_stat_statements answer, a fake fetch)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { labelOf, summarize, sortBy, diffSnapshots, makeSnapshot, fetchRows, formatTable, formatDiff, SNAPSHOT_QUERY } from './perf-snapshot.mjs';

const answer = JSON.parse(readFileSync(new URL('./fixtures/perf-snapshot-answer.json', import.meta.url), 'utf8'));

test('labels: a function call, a table read, a table write, a plain statement', () => {
  assert.equal(labelOf('WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM (SELECT $1 AS json_data) pgrst_payload, LATERAL (SELECT "public"."gauntlet_board"("p_week" := x."p_week") pgrst_scalar) pgrst_call) SELECT 1'), 'rpc gauntlet_board');
  assert.equal(labelOf('WITH pgrst_source AS ( SELECT "public"."player_cards"."quantity" FROM "public"."player_cards" WHERE "public"."player_cards"."player_id" = $1 ) SELECT 1'), 'read player_cards');
  assert.equal(labelOf('WITH pgrst_source AS ( INSERT INTO "public"."players"("id") SELECT 1 RETURNING 1) SELECT 1'), 'insert players');
  assert.equal(labelOf('WITH pgrst_source AS ( UPDATE "public"."players" SET "avatar" = $1 WHERE 1=1) SELECT 1'), 'update players');
  assert.equal(labelOf('delete from dungeon_runs where player_id = $1'), 'delete dungeon_runs');
  assert.equal(labelOf('select public.dungeon_prepare_day()'), 'call dungeon_prepare_day');
});
test('summarize: the real answer groups by function; the noise is dropped; the mean follows from the totals', () => {
  const rows = [
    { query: 'SELECT "public"."dungeon_view"($1)', calls: 10, total_exec_time: 100, max_exec_time: 30, rows: 10 },
    { query: 'SELECT "public"."dungeon_view"($1, $2)', calls: 30, total_exec_time: 200, max_exec_time: 50, rows: 30 },
    { query: "select set_config('role', $1, true)", calls: 999, total_exec_time: 5000, max_exec_time: 1, rows: 999 },
    { query: 'SELECT "id" FROM storage.buckets WHERE id = $1', calls: 5, total_exec_time: 5, max_exec_time: 1, rows: 5 },
  ];
  const s = summarize(rows);
  assert.equal(s.length, 1); assert.deepEqual([s[0].label, s[0].calls, s[0].total_ms, s[0].max_ms, s[0].mean_ms], ['rpc dungeon_view', 40, 300, 50, 7.5]);
  const real = sortBy(summarize(answer), 'total');
  assert.ok(real.length > 3 && real.every((r) => r.calls > 0 && r.mean_ms >= 0));
  assert.ok(real.every((r, i) => i === 0 || real[i - 1].total_ms >= r.total_ms), 'sorted by total');
  assert.ok(sortBy(real, 'calls')[0].calls >= sortBy(real, 'calls')[1].calls);
});
test('the API call is read only and names extensions.pg_stat_statements; a refused answer throws', async () => {
  let seen = null;
  const ok = async (url, init) => { seen = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return { ok: true, status: 200, json: async () => answer }; };
  const rows = await fetchRows({ token: 'T', ref: 'abc', fetchImpl: ok });
  assert.equal(rows.length, answer.length); assert.equal(seen.body.read_only, true); assert.equal(seen.url, 'https://api.supabase.com/v1/projects/abc/database/query');
  assert.match(seen.body.query, /extensions\.pg_stat_statements/); assert.equal(seen.body.query, SNAPSHOT_QUERY); assert.doesNotMatch(SNAPSHOT_QUERY, /\b(insert|update|delete|reset|alter|drop|create)\b/i);
  await assert.rejects(fetchRows({ token: 'T', ref: 'abc', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: 'no' }) }) }), /snapshot failed \(401\)/);
});
test('diff: the load between two snapshots; a reset counter counts as new; a new and a gone statement show', () => {
  const mk = (t, rows) => makeSnapshot(rows.map(([q, c, ms, mx]) => ({ query: `SELECT "public"."${q}"($1)`, calls: c, total_exec_time: ms, max_exec_time: mx, rows: c })), { now: new Date(t) });
  const a = mk('2026-10-11T10:00:00Z', [['dungeon_view', 100, 1000, 20], ['gauntlet_view', 50, 500, 30], ['old_fn', 5, 50, 10], ['reset_fn', 900, 9000, 99]]);
  const b = mk('2026-10-11T10:10:00Z', [['dungeon_view', 160, 1600, 40], ['gauntlet_view', 50, 500, 30], ['new_fn', 4, 40, 12], ['reset_fn', 10, 70, 8]]);
  const d = diffSnapshots(a, b);
  assert.equal(d.minutes, 10);
  const by = Object.fromEntries(d.rows.map((r) => [r.label, r]));
  assert.deepEqual([by['rpc dungeon_view'].calls, by['rpc dungeon_view'].total_ms, by['rpc dungeon_view'].mean_ms], [60, 600, 10]);
  assert.ok(!by['rpc gauntlet_view'], 'no change, not listed');
  assert.equal(by['rpc new_fn'].calls, 4); assert.equal(by['rpc reset_fn'].reset, true); assert.equal(by['rpc reset_fn'].calls, 10); assert.equal(by['rpc old_fn'].gone, true);
  assert.equal(d.rows[0].label, 'rpc dungeon_view', 'the largest change first');
  assert.match(formatDiff(d), /10\.0 minutes/); assert.match(formatDiff(d), /\(counter was reset\)/);
});
test('the table has a header, the top N rows and no statement text of a member', () => {
  const t = formatTable(sortBy(summarize(answer), 'total'), { top: 3 }).split('\n');
  assert.equal(t.length, 4); assert.match(t[0], /total ms/);
  assert.ok(!/\$1|json_data|pgrst_source/.test(t.join('\n')), 'only names, never the statement text');
});
