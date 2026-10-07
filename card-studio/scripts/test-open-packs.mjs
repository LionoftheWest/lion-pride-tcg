/**
 * Acceptance test for tcg-bot/supabase/open_packs_batch.sql against the LIVE database with
 * NO lasting change: node scripts/test-open-packs.mjs
 * One DO block applies the migration, opens packs for test players, checks each rule, then
 * RAISEs the results. The exception rolls everything back.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KEEP_LIVE } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/open_packs_batch.sql', import.meta.url)), 'utf8');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const body = String.raw`do $t$
declare ids bigint[]; n int; res jsonb := '[]';
begin
  ${KEEP_LIVE(['open_packs'], mig)}
  -- 10 packs of 5; the second half repeats the first, so duplicates must be grouped.
  select array_agg(id) into ids from (select id from cards where in_draw_pool order by id limit 25) x;
  ids := ids || ids;
  insert into players (id, username, pack_balance) values ('tst_op_a', 'a', 3), ('tst_op_b', 'b', 20), ('tst_op_c', 'c', 0);

  n := open_packs('tst_op_a', ids, 5);
  res := res || jsonb_build_object('case', 'balance 3, ask 10: 3 packs, 15 cards, 3 ledger rows, balance 0', 'ok',
    n = 3 and (select pack_balance from players where id = 'tst_op_a') = 0
    and (select sum(quantity) from player_cards where player_id = 'tst_op_a') = 15
    and (select count(*) from pack_ledger where player_id = 'tst_op_a' and reason = 'opened' and amount = -1) = 3, 'n', n);

  n := open_packs('tst_op_b', ids, 5);
  res := res || jsonb_build_object('case', 'balance 20, ask 10: 10 packs, 50 cards (duplicates grouped), balance 10', 'ok',
    n = 10 and (select pack_balance from players where id = 'tst_op_b') = 10
    and (select sum(quantity) from player_cards where player_id = 'tst_op_b') = 50
    and (select count(*) from player_cards where player_id = 'tst_op_b') = 25, 'n', n);

  n := open_packs('tst_op_c', ids, 5);
  res := res || jsonb_build_object('case', 'balance 0: 0 packs, nothing added', 'ok',
    n = 0 and not exists (select 1 from player_cards where player_id = 'tst_op_c'), 'n', n);

  n := open_packs('tst_op_b', ids || ids[1:5], 5);
  res := res || jsonb_build_object('case', '11 packs: refused, balance unchanged', 'ok',
    n = 0 and (select pack_balance from players where id = 'tst_op_b') = 10, 'n', n);

  raise exception 'RES %', res;
end $t$;`;
const out = JSON.stringify(await q(body)); const m = out.match(/RES (\[.*\])/);
if (!m) { console.log(out.slice(0, 1500)); process.exitCode = 1; }
else {
  const rows = JSON.parse(m[1].replace(/\\"/g, '"'));
  for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.case}  (n=${r.n})`);
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
}
console.log('after:', JSON.stringify(await q(`select (select count(*) from players where id like 'tst_op_%') test_players, to_regprocedure('open_packs(text,bigint[],int)') is not null fn_live`)));
