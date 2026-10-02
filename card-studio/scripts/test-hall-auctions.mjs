/**
 * Acceptance test for tcg-bot/supabase/hall_auctions.sql on the LIVE database, NO lasting change:
 *   node scripts/test-hall-auctions.mjs        (one DO block; the exception rolls it all back)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/hall_auctions.sql', import.meta.url)), 'utf8');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const body = String.raw`do $t$
declare bad text := ''; r jsonb; n1 bigint; n2 bigint; sr1 bigint; sr2 bigint; fa1 bigint; fa2 bigint; fa3 bigint; gd bigint; gdt bigint;
  lid bigint; o1 bigint; o2 bigint; aid bigint; b1 bigint; b2 bigint; i int;
  ok boolean;
begin
  execute $m$${mig}$m$;
  -- Test cards: 2 Normals, 2 Secret Rares, 3 Full Arts, 1 Gold (not tradeable).
  select id into n1 from cards where rarity = 'normal' and tradeable order by id limit 1;
  select id into n2 from cards where rarity = 'normal' and tradeable order by id offset 1 limit 1;
  select id into sr1 from cards where rarity = 'secret_rare' and tradeable order by id limit 1;
  select id into sr2 from cards where rarity = 'secret_rare' and tradeable order by id offset 1 limit 1;
  select id into fa1 from cards where rarity = 'full_art' order by id limit 1;
  select id into fa2 from cards where rarity = 'full_art' order by id offset 1 limit 1;
  select id into fa3 from cards where rarity = 'full_art' order by id offset 2 limit 1;
  select id into gd from cards where rarity = 'gold' and not tradeable order by id limit 1;
  insert into players (id, username) values ('tst_ha_s', 'seller'), ('tst_ha_a', 'bidder a'), ('tst_ha_b', 'bidder b');
  insert into player_cards (player_id, card_id, quantity) values
    ('tst_ha_s', gd, 1), ('tst_ha_s', sr1, 1), ('tst_ha_s', n1, 1),
    ('tst_ha_a', fa1, 1), ('tst_ha_a', fa2, 1), ('tst_ha_a', n2, 1), ('tst_ha_a', sr2, 1),
    ('tst_ha_b', fa3, 1), ('tst_ha_b', n1, 1);

  -- 1. Wishlist.
  if not (set_wishlist('tst_ha_s', 1, sr2)->>'ok')::boolean then bad := bad || 'wish set; '; end if;
  if (set_wishlist('tst_ha_s', 2, sr2)->>'ok')::boolean then bad := bad || 'wish duplicate allowed; '; end if;
  if (set_wishlist('tst_ha_s', 6, sr1)->>'ok')::boolean then bad := bad || 'wish slot 6; '; end if;

  -- 2. For trade: S lists sr1; A offers sr2 (on S's wishlist, same rarity); B's offer of n1 fails (not on the wishlist).
  r := list_for_trade('tst_ha_s', sr1); lid := (r->>'id')::bigint;
  if lid is null then bad := bad || 'list ' || r::text || '; '; end if;
  if (list_for_trade('tst_ha_s', gd)->>'ok')::boolean then bad := bad || 'gold listed; '; end if;
  if (offer_on_listing('tst_ha_b', lid, n1)->>'ok')::boolean then bad := bad || 'offer off the wishlist; '; end if;
  r := offer_on_listing('tst_ha_a', lid, sr2); o1 := (r->>'id')::bigint;
  if o1 is null then bad := bad || 'listing offer ' || r::text || '; '; end if;
  if not accept_trade(o1, 'tst_ha_s') then bad := bad || 'listing accept; '; end if;
  if (select status from trade_listings where id = lid) <> 'closed' then bad := bad || 'listing not closed; '; end if;
  if (select quantity from player_cards where player_id = 'tst_ha_a' and card_id = sr1) is distinct from 1 then bad := bad || 'listing swap; '; end if;

  -- 3. Auctions: a Gold auction with a Normal minimum fails; a good one starts; only one live.
  if (start_auction('tst_ha_s', gd, 'normal', 1, '{}', 'and', 3)->>'ok')::boolean then bad := bad || 'gold min normal; '; end if;
  if (start_auction('tst_ha_s', gd, 'full_art', 2, '{}', 'and', 15)->>'ok')::boolean then bad := bad || '15 days; '; end if;
  r := start_auction('tst_ha_s', gd, 'full_art', 2, '{}', 'and', 7); aid := (r->>'id')::bigint;
  if aid is null then bad := bad || 'start ' || r::text || '; '; end if;
  if (start_auction('tst_ha_s', n1, null, 0, '{}', 'and', 3)->>'ok')::boolean then bad := bad || 'two live; '; end if;
  if free_copies('tst_ha_s', gd) <> 0 then bad := bad || 'auction card not held; '; end if;

  -- 4. Bids: a Normal in a Gold auction fails; 6 cards fail; A bids 2 Full Arts (meets); B bids 1 Full Art.
  if (place_bid('tst_ha_a', aid, array[n2])->>'ok')::boolean then bad := bad || 'normal bid on gold; '; end if;
  if (place_bid('tst_ha_a', aid, array[fa1, fa1])->>'ok')::boolean then bad := bad || 'bid with 2 of 1 copy; '; end if;
  if (place_bid('tst_ha_s', aid, array[fa1])->>'ok')::boolean then bad := bad || 'own bid; '; end if;
  r := place_bid('tst_ha_a', aid, array[fa1, fa2]); b1 := (r->>'id')::bigint;
  if b1 is null or not (r->>'meets')::boolean then bad := bad || 'bid a ' || r::text || '; '; end if;
  r := place_bid('tst_ha_b', aid, array[fa3]); b2 := (r->>'id')::bigint;
  if b2 is null or (r->>'meets')::boolean then bad := bad || 'bid b ' || r::text || '; '; end if;
  if free_copies('tst_ha_a', fa1) <> 0 then bad := bad || 'bid card not held; '; end if;
  if create_trade_open('tst_ha_a', 'tst_ha_b', fa1) is not null then bad := bad || 'held card traded; '; end if;

  -- 5. Accept A, A declines -> live again; accept A again, A confirms -> the swap; B's bid returns.
  if not (accept_bid('tst_ha_s', b1)->>'ok')::boolean then bad := bad || 'accept; '; end if;
  if (place_bid('tst_ha_b', aid, array[fa3])->>'ok')::boolean then bad := bad || 'bid while accepted; '; end if;
  r := decline_accepted_bid('tst_ha_a', aid); -- run first, then read the status (an OR may read it before the call)
  if not (r->>'ok')::boolean or (select status from auctions where id = aid) <> 'live' then bad := bad || 'decline; '; end if;
  if free_copies('tst_ha_a', fa1) <> 1 then bad := bad || 'declined bid still held; '; end if;
  r := place_bid('tst_ha_a', aid, array[fa1, fa2]); b1 := (r->>'id')::bigint;
  if not (accept_bid('tst_ha_s', b1)->>'ok')::boolean then bad := bad || 'accept 2; '; end if;
  if (confirm_bid('tst_ha_b', aid)->>'ok')::boolean then bad := bad || 'wrong bidder confirmed; '; end if;
  r := confirm_bid('tst_ha_a', aid);
  if not (r->>'ok')::boolean then bad := bad || 'confirm ' || r::text || '; '; end if;
  if (select quantity from player_cards where player_id = 'tst_ha_a' and card_id = gd) is distinct from 1 then bad := bad || 'bidder has no gold; '; end if;
  if exists (select 1 from player_cards where player_id = 'tst_ha_s' and card_id = gd) then bad := bad || 'seller kept gold; '; end if;
  if (select count(*) from player_cards where player_id = 'tst_ha_s' and card_id in (fa1, fa2)) <> 2 then bad := bad || 'seller lacks the bid cards; '; end if;
  if (select status from auction_bids where id = b2) <> 'returned' or free_copies('tst_ha_b', fa3) <> 1 then bad := bad || 'loser not returned; '; end if;
  if (select status from auctions where id = aid) <> 'sold' then bad := bad || 'not sold; '; end if;

  -- 6. Minimum rules: AND / OR with a specific card; close early; expire.
  r := start_auction('tst_ha_s', n1, 'secret_rare', 1, array[n1], 'or', 3); aid := (r->>'id')::bigint;
  if aid is null then bad := bad || 'start 2 ' || r::text || '; '; end if;
  if not auction_meets(aid, array[sr1]) then bad := bad || 'or count; '; end if;
  if auction_meets(aid, array[n2]) then bad := bad || 'or none; '; end if;
  update auctions set min_mode = 'and' where id = aid;
  if auction_meets(aid, array[sr1]) then bad := bad || 'and without the card; '; end if;
  r := place_bid('tst_ha_b', aid, array[n1]); b2 := (r->>'id')::bigint;
  r := close_auction('tst_ha_s', aid);
  if not (r->>'ok')::boolean or (select status from auction_bids where id = b2) <> 'returned' then bad := bad || 'close; '; end if;
  r := start_auction('tst_ha_s', n1, null, 0, '{}', 'and', 1); aid := (r->>'id')::bigint;
  r := place_bid('tst_ha_b', aid, array[n1]); b2 := (r->>'id')::bigint;
  update auctions set ends_at = now() - interval '1 minute' where id = aid;
  perform expire_auctions();
  if (select status from auctions where id = aid) <> 'expired' or (select status from auction_bids where id = b2) <> 'returned' then bad := bad || 'expire; '; end if;

  -- 7. accept_trade must not take a card held by an auction (an old-style request offer).
  r := start_auction('tst_ha_a', fa1, null, 0, '{}', 'and', 2);
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id) values ('tst_ha_s', 'tst_ha_a', fa2, fa1) returning id into o2;
  if accept_trade(o2, 'tst_ha_a') then bad := bad || 'trade took an auctioned card; '; end if;

  -- 8. Ascension spends only free copies: an auction + a trade offer hold 2 of 1 + cost copies.
  i := ascend_cost('secret_rare', 0);
  insert into players (id, username) values ('tst_ha_c', 'ascender');
  insert into player_cards (player_id, card_id, quantity) values ('tst_ha_c', sr1, 1 + i);
  r := start_auction('tst_ha_c', sr1, null, 0, '{}', 'and', 2);
  if not (r->>'ok')::boolean then bad := bad || 'asc auction ' || r::text || '; '; end if;
  o2 := create_trade_open('tst_ha_c', 'tst_ha_b', sr1);
  if i >= 1 and o2 is null then bad := bad || 'asc offer; '; end if;
  r := ascend_card('tst_ha_c', sr1);
  if (r->>'ok')::boolean or r->>'error' <> 'held' then bad := bad || 'ascend spent a held copy ' || r::text || '; '; end if;
  update trade_offers set status = 'declined' where id = o2;
  r := ascend_card('tst_ha_c', sr1);
  if not (r->>'ok')::boolean then bad := bad || 'ascend with free copies ' || r::text || '; '; end if;
  if free_copies('tst_ha_c', sr1) <> 0 or (select quantity from player_cards where player_id = 'tst_ha_c' and card_id = sr1) <> 1 then
    bad := bad || 'the auction copy after ascend; ';
  end if;

  raise exception 'RESULTS [%]', bad;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS [error: % / %]', sqlerrm, bad;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS \[([^\]]*)\]/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1200)); process.exit(1); }
if (m[1]) { console.log('FAIL', m[1]); process.exit(1); }
console.log('PASS: wishlists, listings + offers, auction rules, bids + holds, accept/decline/confirm/close/expire, the trade guard');
