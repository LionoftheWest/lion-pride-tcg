/**
 * Acceptance test for tcg-bot/supabase/shards_convert_keep_one.sql on the LIVE database, NO lasting change:
 *   node scripts/test-shards-convert.mjs             (one DO block; the final RAISE rolls it all back)
 *   MUTATE=held node scripts/test-shards-convert.mjs   must FAIL (held copies convert)
 *   MUTATE=keep node scripts/test-shards-convert.mjs   must FAIL (the last copy converts)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const MIG = process.env.MIG || new URL('../../tcg-bot/supabase/shards_convert_keep_one.sql', import.meta.url);
let mig = readFileSync(MIG, 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const MUT = { held: ['free_copies(p_player, p_card) - 1', '(select quantity from player_cards where player_id = p_player and card_id = p_card) - 1'],
  keep: ['free_copies(p_player, p_card) - 1', 'free_copies(p_player, p_card)'] };
if (process.env.MUTATE) { const m = MUT[process.env.MUTATE]; if (!m || !mig.includes(m[0])) throw new Error('bad mutation'); mig = mig.replace(m[0], m[1]); }
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const body = String.raw`do $t$
declare bad text := ''; r jsonb; nm bigint; ev bigint;
begin
  execute $m$${mig}$m$;
  update settings set value = value || '{"enabled": true}' where key = 'shards';
  select id into nm from cards where rarity = 'normal' and tradeable and in_draw_pool order by id limit 1;
  insert into players (id, username) values ('tst_cv_a', 'convert a'), ('tst_cv_b', 'convert b');
  -- 1. A Normal at star 0 with 4 copies: 3 convert (the old rule: 0). The last copy never converts.
  insert into player_cards (player_id, card_id, quantity, ascension) values ('tst_cv_a', nm, 4, 0);
  if convertible_copies('tst_cv_a', nm) <> 3 then bad := bad || 'convertible ' || convertible_copies('tst_cv_a', nm) || '; '; end if;
  if (convert_dupes('tst_cv_a', nm, 4)->>'error') <> 'too_many' then bad := bad || 'converted the last copy; '; end if;
  r := convert_dupes('tst_cv_a', nm, 3);
  if not (r->>'ok')::boolean or (r->>'shards')::int <> 15 or (r->>'quantity')::int <> 1 then bad := bad || 'convert ' || r::text || '; '; end if;
  if (select shard_balance from players where id = 'tst_cv_a') <> 15 then bad := bad || 'balance; '; end if;
  -- 2. Held copies never convert: 5 copies, 1 in an auction -> 3 convert.
  update player_cards set quantity = 5 where player_id = 'tst_cv_a' and card_id = nm;
  r := start_auction('tst_cv_a', nm, null, 0, '{}', 'and', 2);
  if not (r->>'ok')::boolean then bad := bad || 'auction ' || r::text || '; '; end if;
  if convertible_copies('tst_cv_a', nm) <> 3 then bad := bad || 'held copy converts (' || convertible_copies('tst_cv_a', nm) || '); '; end if;
  -- 3. One copy: nothing; an Event card: no value.
  insert into player_cards (player_id, card_id, quantity) values ('tst_cv_b', nm, 1);
  if convertible_copies('tst_cv_b', nm) <> 0 then bad := bad || 'single copy; '; end if;
  select id into ev from cards where rarity::text = 'event' order by id limit 1;
  if ev is not null then
    insert into player_cards (player_id, card_id, quantity) values ('tst_cv_b', ev, 3);
    if (convert_dupes('tst_cv_b', ev, 1)->>'error') <> 'no_value' then bad := bad || 'event converts; '; end if;
  end if;
  raise exception 'RESULT:%', case when bad = '' then 'PASS' else bad end;
end $t$;`;
const res = await q(body);
const m = JSON.stringify(res).match(/RESULT:([^"\\]*)/);
if (!m) { console.error('NO RESULT:', JSON.stringify(res).slice(0, 1200)); process.exitCode = 1; }
else if (m[1] === 'PASS') console.log(`PASS${process.env.MUTATE ? ` (MUTATE=${process.env.MUTATE}: the test did NOT catch it)` : ''}`);
else { console.log(`FAIL: ${m[1]}`); process.exitCode = 1; }
