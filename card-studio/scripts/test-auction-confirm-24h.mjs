/**
 * Acceptance test for tcg-bot/supabase/auction_confirm_24h.sql on the LIVE database, NO lasting change
 * (one DO block, rolled back): an accepted bid not confirmed in 24 hours is declined; the auction
 * reopens with time left, or ends with every bid returned; a 23-hour-old accept is kept.
 *   node scripts/test-auction-confirm-24h.mjs
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/auction_confirm_24h.sql', import.meta.url)), 'utf8');
const body = String.raw`do $t$
declare bad text := ''; n1 bigint; n2 bigint; n3 bigint; n4 bigint; a1 bigint; a2 bigint; b1 bigint; b2 bigint; b3 bigint; r jsonb; k int;
begin
  execute $m$${mig}$m$;
  select id into n1 from cards where rarity = 'normal' and tradeable order by id limit 1;
  select id into n2 from cards where rarity = 'normal' and tradeable order by id offset 1 limit 1;
  select id into n3 from cards where rarity = 'normal' and tradeable order by id offset 2 limit 1;
  select id into n4 from cards where rarity = 'normal' and tradeable order by id offset 3 limit 1;
  insert into players (id, username) values ('tst_c24_s', 's'), ('tst_c24_t', 't'), ('tst_c24_b', 'b'), ('tst_c24_c', 'c');
  insert into player_cards (player_id, card_id, quantity) values ('tst_c24_s', n1, 1), ('tst_c24_t', n2, 1), ('tst_c24_b', n3, 1), ('tst_c24_c', n4, 1);
  -- A: time left. B bids, the seller accepts, 25 hours pass with no confirm -> declined, live again.
  a1 := (start_auction('tst_c24_s', n1, null, 0, '{}', 'and', 7)->>'id')::bigint;
  b1 := (place_bid('tst_c24_b', a1, array[n3])->>'id')::bigint;
  r := accept_bid('tst_c24_s', b1);
  if (r->>'confirm_by') is null or (select accepted_at from auctions where id = a1) is null then bad := bad || 'accept_at not set; '; end if;
  update auctions set accepted_at = now() - interval '23 hours' where id = a1;
  k := expire_auctions();
  if (select status from auctions where id = a1) <> 'accepted' then bad := bad || '23 h accept ended early; '; end if;
  update auctions set accepted_at = now() - interval '25 hours' where id = a1;
  k := expire_auctions();
  if (select status from auctions where id = a1) <> 'live' or (select accepted_at from auctions where id = a1) is not null then bad := bad || 'not reopened; '; end if;
  if (select status from auction_bids where id = b1) <> 'declined' or free_copies('tst_c24_b', n3) <> 1 then bad := bad || 'bid not freed; '; end if;
  if free_copies('tst_c24_s', n1) <> 0 then bad := bad || 'seller card not held after reopen; '; end if;
  if (select count(*) from notifications where player_id = 'tst_c24_b' and kind = 'auction_ended') <> 1 then bad := bad || 'no bidder note; '; end if;
  if (select count(*) from notifications where player_id = 'tst_c24_s' and kind = 'auction_declined') <> 1 then bad := bad || 'no seller reopen note; '; end if;
  -- B: time up. Two bids, one accepted, no confirm -> expired, both bids back, everyone told.
  a2 := (start_auction('tst_c24_t', n2, null, 0, '{}', 'and', 1)->>'id')::bigint;
  b2 := (place_bid('tst_c24_c', a2, array[n4])->>'id')::bigint;
  r := accept_bid('tst_c24_t', b2);
  update auctions set accepted_at = now() - interval '25 hours', ends_at = now() - interval '1 hour' where id = a2;
  k := expire_auctions();
  if (select status from auctions where id = a2) <> 'expired' then bad := bad || 'not expired; '; end if;
  if free_copies('tst_c24_t', n2) <> 1 or free_copies('tst_c24_c', n4) <> 1 then bad := bad || 'cards not free after expiry; '; end if;
  if (select count(*) from notifications where player_id = 'tst_c24_t' and kind = 'auction_ended') <> 1 then bad := bad || 'no seller end note; '; end if;
  -- A second run changes nothing.
  k := expire_auctions();
  if k <> 0 then bad := bad || 'second run acted ' || k || '; '; end if;
  -- The decline path clears the accept time.
  b3 := (place_bid('tst_c24_b', a1, array[n3])->>'id')::bigint;
  r := accept_bid('tst_c24_s', b3);
  r := decline_accepted_bid('tst_c24_b', a1);
  if (select accepted_at from auctions where id = a1) is not null or (select status from auctions where id = a1) <> 'live' then bad := bad || 'decline left accept_at; '; end if;
  raise exception 'RESULTS [%]', bad;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS [error: % / %]', sqlerrm, bad;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS \[([^\]]*)\]/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 800)); process.exit(1); }
if (m[1]) { console.log('FAIL', m[1]); process.exit(1); }
console.log('PASS: an accept unconfirmed for 24 h is declined (reopen / expire), everyone told; 23 h kept; decline clears');
