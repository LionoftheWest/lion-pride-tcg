import './localdb-guard.mjs';
/**
 * Concurrency test of the v2 spend (tcg-bot/supabase/combat_v2_progress_spend.sql, spend_card_points_v2; plan 20.13 "Open for M1d" item 6,
 * done in 20.14). Two sessions spend on the same card at the same time, on two real connections:
 *   session A spends 3 points and holds its transaction open for 1.5 s; session B starts 0.3 s later and spends 3 more (budget 5).
 *   Expected: A {ok: true}; B waits for A (the row lock of `for update`), then answers {ok: false, error: 'not_enough', free: 2}, never a raw
 *   exception; the stored row and the ledger have only the spend of A.
 * The function under test is the spend of the M1c file (or its planted fault), made as a test copy public.m1d_conc_spend (the same body,
 * another name), so a planted fault never replaces the real function. Each run COMMITS a sample (a test player with an 18-digit id, one
 * card, one progress row, the player in the tester list) and removes all of it in a finally step: the player rows, the progress rows and
 * their ledger rows, the tester list as it was, its balance_log rows and the test copy. Take the local database lock first.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-progress-concurrency.mjs     must PASS
 *   MUTATE=rev_spend_no_lock ...                                                                              must FAIL
 *   MUTATE=all ...                                                                                            the baseline, then every mutation
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rawQuery, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-progress-concurrency.mjs');

const FILE = process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/combat_v2_progress_spend.sql', import.meta.url));
const src = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
let fn = (src.match(/create or replace function public\.spend_card_points_v2\(p_player text, p_card bigint, p_add jsonb\) returns jsonb\n[\s\S]*?\nend \$fn\$;\n/) || [])[0];
if (!fn) throw new Error('spend_card_points_v2 not found in the file');
const MUT = {
  rev_spend_no_lock: ['  select * into r from card_progress_v2 where player_id = p_player and card_id = p_card for update;\n', '  select * into r from card_progress_v2 where player_id = p_player and card_id = p_card;\n'],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)          ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const out = (r.stdout || '').trim().split(/\r?\n/);
    const line = out.pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const first = out.find((l) => l.startsWith('FAIL')) || '';
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  ${first.slice(0, 140)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || fn.split(m[0]).length !== 2) throw new Error(`the mutation ${process.env.MUTATE} does not match the function exactly once`);
  fn = fn.split(m[0]).join(m[1]);
}
const COPY = fn.replace('create or replace function public.spend_card_points_v2(', 'create or replace function public.m1d_conc_spend(');
if (COPY.includes('$x$')) throw new Error('the SQL must not contain $x$');
const P = '999999999999999971';
const BY = 'm1d-conc-test';

// one request; the answer rows (the preload sends it to the local postgres-meta, one pooled connection per request)
async function q(sql) {
  const t = await rawQuery(sql);
  let j; try { j = JSON.parse(t); } catch { return { error: t }; }
  if (!Array.isArray(j)) return { error: j.message || j.error || t };
  return { rows: j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = `do $x$
begin
  perform set_config('balance.by', '${BY}', true);
  update public.balance set value = jsonb_set(value, '{testers}', coalesce((select jsonb_agg(t) from jsonb_array_elements(value->'testers') t where t <> to_jsonb('${P}'::text)), '[]'::jsonb))
   where key = 'combat_v2' and value->'testers' ? '${P}';
  delete from public.balance_log where changed_by = '${BY}';
  delete from public.card_progress_v2_log where player_id = '${P}';
  delete from public.card_progress_v2 where player_id = '${P}';
  delete from public.player_cards where player_id = '${P}';
  delete from public.pack_ledger where player_id = '${P}';
  delete from public.players where id = '${P}';
  drop function if exists public.m1d_conc_spend(text, bigint, jsonb);
end $x$;`;

const results = [];
const add = (name, ok, got) => results.push({ name, ok, got });
let card;
try {
  const pre = await q(cleanup);   // a run that stopped early left its rows: remove them first
  if (pre.error) throw new Error('cleanup: ' + pre.error);
  const setup = await q(`do $x$
declare c bigint; pid bigint;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', '${BY}', true);
  if to_regprocedure('public.spend_card_points_v2(text, bigint, jsonb)') is null then raise exception 'M1c (combat_v2_progress_spend.sql) is not applied on this copy'; end if;
  insert into public.players (id, username) values ('${P}', 'm1d conc test');
  select c2.id into c from public.cards c2 join public.subjects s on s.id = c2.subject_id where s.ability_v2->>'role' in (select key from public.roles) order by c2.id limit 1;
  insert into public.player_cards (player_id, card_id, quantity, first_source, ascension) values ('${P}', c, 1, 'admin', 0);
  insert into public.card_progress_v2 (player_id, card_id, level, xp) values ('${P}', c, 5, card_level_xp_at(5)) returning id into pid;
  insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp) values (pid, '${P}', c, 'grant_level', '', 'm1dconc', 5, card_level_xp_at(5));
  update public.balance set value = jsonb_set(value, '{testers}', (value->'testers') || to_jsonb('${P}'::text)) where key = 'combat_v2';
end $x$;
${COPY}
select card_id from public.player_cards where player_id = '${P}';`);
  if (setup.error) throw new Error('setup: ' + setup.error);
  card = setup.rows[0]?.card_id;
  const ppl = (await q("select balance_num('v2_level', 'points_per_level')::int n")).rows?.[0]?.n;
  add('the sample: the budget is level 5 x points_per_level 1 = 5 (the two spends of 3 do not both fit)', ppl === 1 && card != null, { ppl, card });

  // the two sessions
  const t0 = Date.now();
  const A = q(`with a as materialized (select public.m1d_conc_spend('${P}', ${card}, '{"atk": 3}') r) select a.r, pg_sleep(1.5) from a;`).then((x) => ({ ...x, ms: Date.now() - t0 }));
  await sleep(300);
  const t1 = Date.now();
  const B = q(`select public.m1d_conc_spend('${P}', ${card}, '{"def": 3}') r;`).then((x) => ({ ...x, ms: Date.now() - t1 }));
  const [a, b] = await Promise.all([A, B]);
  const ra = a.rows?.[0]?.r, rb = b.rows?.[0]?.r;
  add('session A spends 3 points: ok', ra?.ok === true && ra?.progress?.points?.atk === 3, a.error || ra);
  add('session B (at the same time, 3 more) answers not_enough with free 2, not a raw exception', !b.error && rb?.ok === false && rb?.error === 'not_enough' && rb?.free === 2, b.error ? `raised: ${String(b.error).slice(0, 200)}` : rb);
  add('session B waited for session A (the two connections overlapped: B took at least 1 s)', b.ms >= 1000, { b_ms: b.ms, a_ms: a.ms });
  const end = await q(`select (select row_to_json(x) from (select atk_pts, def_pts from public.card_progress_v2 where player_id = '${P}') x) row,
    (select count(*) from public.card_progress_v2_log where player_id = '${P}' and reason = 'spend') spends,
    (select count(distinct ref) from public.card_progress_v2_log where player_id = '${P}' and reason = 'spend') refs;`);
  const e = end.rows?.[0];
  add('the stored row and the ledger have only the spend of A (atk 3, def 0; one ledger row, one ref)', e?.row?.atk_pts === 3 && e?.row?.def_pts === 0 && Number(e?.spends) === 1 && Number(e?.refs) === 1, end.error || e);
} catch (err) {
  add(`the test ran (${String(err.message).slice(0, 300)})`, false, null);
} finally {
  const c = await q(cleanup);
  const left = await q(`select (select count(*) from public.players where id = '${P}') + (select count(*) from public.card_progress_v2_log where player_id = '${P}')
    + (select count(*) from public.balance_log where changed_by = '${BY}') + (select count(*) from pg_proc where proname = 'm1d_conc_spend')
    + (select count(*) from public.balance where key = 'combat_v2' and value->'testers' ? '${P}') n;`);
  add('the cleanup removed every row of the run (players, ledger, balance_log, the tester entry, the test copy)', !c.error && Number(left.rows?.[0]?.n) === 0, c.error || left.rows?.[0]);
}
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ' ' + JSON.stringify(r.got).slice(0, 600)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
