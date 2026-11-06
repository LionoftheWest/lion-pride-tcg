import './localdb-guard.mjs';
/**
 * Concurrency test of the stat screen spend (tcg-bot/supabase/stat_v2.sql: stat_v2_spend + card_progress_v2_sync; SPEC v3 G-S12, M3 of
 * review r1). Two sessions spend on the same card that has NO progress row yet, on two real connections:
 *   session A spends 2 points and holds its transaction open for 1.5 s; session B starts 0.3 s later and spends 2 more (3 stars: budget 9).
 *   Expected: both {ok: true}, never a raw exception; B waits for A (the player_cards row lock); ONE progress row, ONE grant_level ledger
 *   row (the sync of A; B finds the row at level 9), and two spend rows with two refs.
 * The functions under test are the spend and the sync of stat_v2.sql (or their planted fault), made as test copies public.statv2_conc_spend and
 * public.statv2_conc_sync (the same bodies, other names), so a planted fault never replaces a real function. stat_v2.sql must be applied on
 * the copy (stat_v2_on, card_stats_v2_entry). "Flag on" = combat_v2.progress true (GLOBAL) and the test player in settings stat_v2.users
 * (SPEC 6: a tester entry is not "flag on"). Each run COMMITS a sample (a test player with an 18-digit id, one card with 3 stars, the
 * flags) and removes all of it in a finally step: the player rows, the progress and ledger rows, the stat_v2 users and the progress flag as
 * they were, their balance_log and settings_log rows, and the test copies. Take the local database lock first.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-stat-v2-concurrency.mjs     must PASS
 *   MUTATE=m12_no_lock ...                                                                         must FAIL
 *   MUTATE=all ...                                                                                 the baseline, then every mutation
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rawQuery, assertLocal } from './lab-lib.mjs';
assertLocal('test-stat-v2-concurrency.mjs');

const FILE = process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/stat_v2.sql', import.meta.url));
const src = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const pick = (name) => (src.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\nend \\$fn\\$;\\n`)) || [])[0];
let spend = pick('stat_v2_spend'), sync = pick('card_progress_v2_sync');
if (!spend || !sync) throw new Error('stat_v2_spend or card_progress_v2_sync not found in the file');
const MUT = {
  // M12: drop the player_cards lock AND the on conflict
  m12_no_lock: [['spend', '  perform 1 from player_cards where player_id = p_player and card_id = p_card and quantity > 0 for update;\n', '  perform 1 from player_cards where player_id = p_player and card_id = p_card and quantity > 0;\n'],
    ['sync', '  insert into card_progress_v2 (player_id, card_id) values (p_player, p_card) on conflict (player_id, card_id) do nothing;\n', '  insert into card_progress_v2 (player_id, card_id) values (p_player, p_card);\n']],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)          ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) { ok = false; console.log(base.stdout); }
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const out = (r.stdout || '').trim().split(/\r?\n/);
    const line = out.pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const fails = out.filter((l) => l.startsWith('FAIL')).map((l) => l.slice(0, 220));
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}\n  ${fails.join('\n  ')}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  for (const [which, a, b] of m) {
    const t = which === 'spend' ? spend : sync;
    if (t.split(a).length !== 2) throw new Error(`the mutation ${process.env.MUTATE} does not match ${which} exactly once`);
    if (which === 'spend') spend = t.split(a).join(b); else sync = t.split(a).join(b);
  }
}
const COPY = spend.replace('create or replace function public.stat_v2_spend(', 'create or replace function public.statv2_conc_spend(')
  .replace('  perform card_progress_v2_sync(p_player, p_card, v_lv);\n', '  perform statv2_conc_sync(p_player, p_card, v_lv);\n')
  + sync.replace('create or replace function public.card_progress_v2_sync(', 'create or replace function public.statv2_conc_sync(');
if (!COPY.includes('perform statv2_conc_sync(')) throw new Error('the spend copy does not call the sync copy');
if (COPY.includes('$x$')) throw new Error('the SQL must not contain $x$');
const P = '999999999999999991';
const BY = 'statv2-conc-test';

async function q(sql) {
  const t = await rawQuery(sql);
  let j; try { j = JSON.parse(t); } catch { return { error: t }; }
  if (!Array.isArray(j)) return { error: j.message || j.error || t };
  return { rows: j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the flags as they were (read once, before the setup), put back by the cleanup
const before = (await q("select (select value->'progress' from public.balance where key = 'combat_v2') progress, (select value from public.settings where key = 'stat_v2') sv;")).rows?.[0];
if (!before || before.sv == null) throw new Error('stat_v2.sql is not applied on this copy (no settings stat_v2)');
const cleanup = `do $x$
begin
  perform set_config('balance.by', '${BY}', true);
  update public.settings set value = jsonb_set(value, '{users}', coalesce((select jsonb_agg(u) from jsonb_array_elements(value->'users') u where u <> to_jsonb('${P}'::text)), '[]'::jsonb))
   where key = 'stat_v2' and value->'users' ? '${P}';
  update public.balance set value = jsonb_set(value, '{progress}', '${JSON.stringify(before.progress)}'::jsonb) where key = 'combat_v2' and value->'progress' is distinct from '${JSON.stringify(before.progress)}'::jsonb;
  delete from public.balance_log where changed_by = '${BY}';
  delete from public.settings_log where changed_by = '${BY}';
  delete from public.card_progress_v2_log where player_id = '${P}';
  delete from public.card_progress_v2 where player_id = '${P}';
  delete from public.player_cards where player_id = '${P}';
  delete from public.pack_ledger where player_id = '${P}';
  delete from public.players where id = '${P}';
  drop function if exists public.statv2_conc_spend(text, bigint, jsonb);
  drop function if exists public.statv2_conc_sync(text, bigint, integer);
end $x$;`;

const results = [];
const add = (name, ok, got) => results.push({ name, ok, got });
let card;
try {
  const pre = await q(cleanup);   // a run that stopped early left its rows: remove them first
  if (pre.error) throw new Error('cleanup: ' + pre.error);
  const setup = await q(`do $x$
declare c bigint;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', '${BY}', true);
  insert into public.players (id, username) values ('${P}', 'stat v2 conc test');
  select c2.id into c from public.cards c2 join public.subjects s on s.id = c2.subject_id where s.ability_v2->>'role' in (select key from public.roles) order by c2.id limit 1;
  insert into public.player_cards (player_id, card_id, quantity, first_source, ascension) values ('${P}', c, 1, 'admin', 3);
  -- flag on: the GLOBAL progress flag (not the tester list) and the player in stat_v2.users
  update public.balance set value = jsonb_set(value, '{progress}', 'true') where key = 'combat_v2' and value->'progress' <> 'true'::jsonb;
  update public.settings set value = jsonb_set(value, '{users}', (value->'users') || to_jsonb('${P}'::text)) where key = 'stat_v2';
end $x$;
${COPY}
select card_id from public.player_cards where player_id = '${P}';`);
  if (setup.error) throw new Error('setup: ' + setup.error);
  card = setup.rows[0]?.card_id;
  const pre2 = (await q(`select public.stat_v2_on('${P}') on_, public.combat_v2_on('progress') global_, (select count(*) from public.card_progress_v2 where player_id = '${P}') rows_,
    (public.card_stats_v2_entry('${P}', ${card}))->'free' free_`)).rows?.[0];
  add('the sample: flag on (global progress + stat_v2.users), 3 stars, NO progress row, free 9', pre2?.on_ === true && pre2?.global_ === true && Number(pre2?.rows_) === 0 && pre2?.free_ === 9, pre2);

  // the two sessions
  const t0 = Date.now();
  const A = q(`with a as materialized (select public.statv2_conc_spend('${P}', ${card}, '{"atk": 2}') r) select a.r, pg_sleep(1.5) from a;`).then((x) => ({ ...x, ms: Date.now() - t0 }));
  await sleep(300);
  const t1 = Date.now();
  const B = q(`select public.statv2_conc_spend('${P}', ${card}, '{"def": 2}') r;`).then((x) => ({ ...x, ms: Date.now() - t1 }));
  const [a, b] = await Promise.all([A, B]);
  const ra = a.rows?.[0]?.r, rb = b.rows?.[0]?.r;
  add('session A spends 2 points: ok', ra?.ok === true && ra?.progress?.points?.atk === 2, a.error || ra);
  add('session B (at the same time, 2 more) answers ok, not a raw exception', !b.error && rb?.ok === true && rb?.progress?.points?.def === 2 && rb?.progress?.points?.atk === 2, b.error ? `raised: ${String(b.error).slice(0, 300)}` : rb);
  add('session B waited for session A (the two connections overlapped: B took at least 1 s)', b.ms >= 1000, { b_ms: b.ms, a_ms: a.ms });
  const end = await q(`select (select count(*) from public.card_progress_v2 where player_id = '${P}') rows_,
    (select row_to_json(x) from (select level, atk_pts, def_pts from public.card_progress_v2 where player_id = '${P}') x) row_,
    (select count(*) from public.card_progress_v2_log where player_id = '${P}' and reason = 'grant_level') grants,
    (select count(distinct ref) from public.card_progress_v2_log where player_id = '${P}' and reason = 'spend') spend_refs;`);
  const e = end.rows?.[0];
  add('one progress row (level 9, atk 2, def 2), one grant_level row, two spend refs', Number(e?.rows_) === 1 && e?.row_?.level === 9 && e?.row_?.atk_pts === 2 && e?.row_?.def_pts === 2
    && Number(e?.grants) === 1 && Number(e?.spend_refs) === 2, end.error || e);
} catch (err) {
  add(`the test ran (${String(err.message).slice(0, 300)})`, false, null);
} finally {
  const c = await q(cleanup);
  const left = await q(`select (select count(*) from public.players where id = '${P}') + (select count(*) from public.card_progress_v2_log where player_id = '${P}')
    + (select count(*) from public.balance_log where changed_by = '${BY}') + (select count(*) from public.settings_log where changed_by = '${BY}')
    + (select count(*) from pg_proc where proname in ('statv2_conc_spend', 'statv2_conc_sync'))
    + (select count(*) from public.settings where key = 'stat_v2' and value->'users' ? '${P}') n,
    (select value->'progress' from public.balance where key = 'combat_v2') progress, (select value from public.settings where key = 'stat_v2') sv;`);
  const l = left.rows?.[0];
  add('the cleanup removed every row of the run and put back the flags (progress, stat_v2) as they were', !c.error && Number(l?.n) === 0
    && JSON.stringify(l?.progress) === JSON.stringify(before.progress) && JSON.stringify(l?.sv) === JSON.stringify(before.sv), c.error || l);
}
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ' ' + JSON.stringify(r.got).slice(0, 600)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
