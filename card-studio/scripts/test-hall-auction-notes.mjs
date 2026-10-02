/**
 * Acceptance test for tcg-bot/supabase/hall_auction_notes.sql on the LIVE database, NO lasting change
 * (one DO block; the exception rolls it all back): an expired auction notifies the seller and the bidder.
 *   node scripts/test-hall-auction-notes.mjs
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/hall_auction_notes.sql', import.meta.url)), 'utf8');
const body = String.raw`do $t$
declare bad text := ''; n1 bigint; n2 bigint; aid bigint; r jsonb; k int;
begin
  execute $m$${mig}$m$;
  select id into n1 from cards where rarity = 'normal' and tradeable order by id limit 1;
  select id into n2 from cards where rarity = 'normal' and tradeable order by id offset 1 limit 1;
  insert into players (id, username) values ('tst_hn_s', 'seller'), ('tst_hn_b', 'bidder');
  insert into player_cards (player_id, card_id, quantity) values ('tst_hn_s', n1, 1), ('tst_hn_b', n2, 1);
  r := start_auction('tst_hn_s', n1, null, 0, '{}', 'and', 1); aid := (r->>'id')::bigint;
  r := place_bid('tst_hn_b', aid, array[n2]);
  if free_copies('tst_hn_b', n2) <> 0 then bad := bad || 'bid not held; '; end if;
  update auctions set ends_at = now() - interval '1 minute' where id = aid;
  k := expire_auctions();
  if (select status from auctions where id = aid) <> 'expired' then bad := bad || 'not expired; '; end if;
  if free_copies('tst_hn_b', n2) <> 1 or free_copies('tst_hn_s', n1) <> 1 then bad := bad || 'cards not free; '; end if;
  if (select count(*) from notifications where player_id = 'tst_hn_s' and kind = 'auction_ended') <> 1 then bad := bad || 'no seller note; '; end if;
  if (select count(*) from notifications where player_id = 'tst_hn_b' and kind = 'auction_ended') <> 1 then bad := bad || 'no bidder note; '; end if;
  if (select count(*) from notifications where player_id = 'tst_hn_b' and kind = 'auction_ended' and message like '%free again%') <> 1 then bad := bad || 'bidder note text; '; end if;
  -- A second run ends nothing and sends nothing more.
  k := expire_auctions();
  if (select count(*) from notifications where player_id in ('tst_hn_s', 'tst_hn_b')) <> 2 then bad := bad || 'notes sent twice; '; end if;
  raise exception 'RESULTS [%]', bad;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS [error: % / %]', sqlerrm, bad;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS \[([^\]]*)\]/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 800)); process.exit(1); }
if (m[1]) { console.log('FAIL', m[1]); process.exit(1); }
console.log('PASS: an expired auction frees the cards and notifies the seller and the bidder, once');
