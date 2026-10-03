/**
 * ascend_guard.sql (2026-10-03): the copy that stays must be free, and Event cards do not ascend.
 * Rolled back (the result comes back in the exception):  node scripts/test-ascend-guard.mjs [--old]
 * --old: run the same cases against the function WITHOUT the migration (the baseline must fail).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/ascend_guard.sql', import.meta.url)), 'utf8');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const P = 'tst_ag';
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; n bigint; ev bigint; q int; a int;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${P}', 'tst ascend'), ('${P}_x', 'tst x');
  select id into n from cards where rarity = 'normal' order by id limit 1;
  select id into ev from cards where rarity = 'event' order by id limit 1;

  -- 1. 5 copies, 1 in a live auction: an ascend (cost 4) would leave only the held copy. Refused.
  insert into player_cards (player_id, card_id, quantity) values ('${P}', n, 5);
  insert into auctions (seller_id, card_id, ends_at) values ('${P}', n, now() + interval '1 day');
  r := ascend_card('${P}', n);
  select quantity, ascension into q, a from player_cards where player_id = '${P}' and card_id = n;
  res := res || jsonb_build_object('case', '5 copies with 1 in an auction: refused (held), nothing changes', 'ok',
    r->>'error' = 'held' and q = 5 and a = 0, 'r', r);

  -- 2. The auction gone: 5 free copies ascend to 1 star, 1 copy left.
  delete from auctions where seller_id = '${P}';
  r := ascend_card('${P}', n);
  select quantity, ascension into q, a from player_cards where player_id = '${P}' and card_id = n;
  res := res || jsonb_build_object('case', '5 free copies: 1 star, 1 copy left', 'ok', (r->>'ok')::boolean and q = 1 and a = 1, 'r', r);

  -- 3. 7 copies with 1 in an auction at 1 star (cost 6): free 6 < 7. Refused; with 8 copies it goes.
  update player_cards set quantity = 7 where player_id = '${P}' and card_id = n;
  insert into auctions (seller_id, card_id, ends_at) values ('${P}', n, now() + interval '1 day');
  r := ascend_card('${P}', n);
  res := res || jsonb_build_object('case', '7 copies, 1 held, cost 6: refused (a free copy must stay)', 'ok', r->>'error' = 'held', 'r', r);
  update player_cards set quantity = 8 where player_id = '${P}' and card_id = n;
  r := ascend_card('${P}', n);
  select quantity, ascension into q, a from player_cards where player_id = '${P}' and card_id = n;
  res := res || jsonb_build_object('case', '8 copies, 1 held, cost 6: 2 stars, the held copy + 1 free stay', 'ok',
    (r->>'ok')::boolean and q = 2 and a = 2 and free_copies('${P}', n) = 1, 'r', r);

  -- 4. An Event card never ascends.
  insert into player_cards (player_id, card_id, quantity) values ('${P}', ev, 10);
  r := ascend_card('${P}', ev);
  select ascension into a from player_cards where player_id = '${P}' and card_id = ev;
  res := res || jsonb_build_object('case', 'an Event card (10 copies) does not ascend', 'ok', r->>'error' = 'no_ascend' and a = 0, 'r', r);

  raise exception 'RESULTS %', res;
end $t$;`;
const out = await q(body);
const m = JSON.stringify(out).match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', JSON.stringify(out).slice(0, 600)); process.exitCode = 1; }
else {
  const rows = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  let bad = 0;
  for (const x of rows) { if (!x.ok) bad += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok ? '' : ' ' + JSON.stringify(x.r)}`); }
  console.log(bad ? `${bad} of ${rows.length} FAILED` : `PASS all ${rows.length}`);
  if (bad) process.exitCode = 1;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', JSON.stringify(left));
