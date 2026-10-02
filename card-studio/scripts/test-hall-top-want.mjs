/**
 * Test hall_top_want.sql against the live DB with NO lasting change:
 *   node scripts/test-hall-top-want.mjs [file.sql]      (default: ../tcg-bot/supabase/hall_top_want.sql)
 * One DO block: apply the file, make a test member with 3 wishlist cards, star slots, then RAISE the
 * results (everything rolls back).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(process.argv[2] || new URL('../../tcg-bot/supabase/hall_top_want.sql', import.meta.url), 'utf8');
const P = 'tst_topwant';
const body = String.raw`do $t$ declare r jsonb; res jsonb := '[]'; tops int[]; c1 bigint; c2 bigint; c3 bigint; c4 bigint; dup boolean := false;
begin
  execute $m$${mig}$m$;
  select id into c1 from cards order by id limit 1 offset 0;
  select id into c2 from cards order by id limit 1 offset 1;
  select id into c3 from cards order by id limit 1 offset 2;
  select id into c4 from cards order by id limit 1 offset 3;
  insert into players (id, username) values ('${P}', 'tst top');
  perform set_wishlist('${P}', 1, c1); perform set_wishlist('${P}', 2, c2); perform set_wishlist('${P}', 3, c3);

  r := set_wish_top('${P}', 2);
  select array_agg(slot order by slot) into tops from wishlists where player_id = '${P}' and top;
  res := res || jsonb_build_object('case', 'star slot 2: only slot 2 is the top want', 'ok', (r->>'ok')::boolean and tops = array[2], 'tops', tops);

  r := set_wish_top('${P}', 3);
  select array_agg(slot order by slot) into tops from wishlists where player_id = '${P}' and top;
  res := res || jsonb_build_object('case', 'star slot 3: the star moves (one top want a member)', 'ok', (r->>'ok')::boolean and tops = array[3], 'tops', tops);

  r := set_wish_top('${P}', 5);
  select array_agg(slot order by slot) into tops from wishlists where player_id = '${P}' and top;
  res := res || jsonb_build_object('case', 'an empty slot cannot be the top want', 'ok', r->>'error' = 'empty_slot' and tops = array[3], 'r', r);

  perform set_wishlist('${P}', 3, c4);
  select array_agg(slot order by slot) into tops from wishlists where player_id = '${P}' and top;
  res := res || jsonb_build_object('case', 'a new card in the starred slot keeps the star', 'ok', tops = array[3] and (select card_id from wishlists where player_id = '${P}' and slot = 3) = c4, 'tops', tops);

  begin update wishlists set top = true where player_id = '${P}' and slot = 1; exception when unique_violation then dup := true; end;
  res := res || jsonb_build_object('case', 'the database refuses a second top want', 'ok', dup);

  raise exception 'RES %', res;
end $t$;`;
const out = JSON.stringify(await q(body)); const m = out.match(/RES (\[.*\])/);
if (!m) { console.log(out.slice(0, 1500)); process.exitCode = 1; }
else { const rs = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, '')); let f = 0; for (const x of rs) { if (!x.ok) f++; console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.case}${x.ok ? '' : '  ' + JSON.stringify(x)}`); } process.exitCode = f ? 1 : 0; }
console.log('after:', JSON.stringify(await q(`select (select count(*) from players where id='${P}') test_player, (select count(*) from information_schema.columns where table_name='wishlists' and column_name='top') top_col`)));
