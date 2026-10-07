-- db_comments.sql: a note (COMMENT ON) on every public table, column and function.
-- Notes only: no function text changes, so the md5 guards are not touched. Safe to re-run.
-- The pages in docs/data/ are generated from these notes: card-studio/scripts/gen-data-docs.mjs.
-- Coverage test: card-studio/scripts/test-db-docs.mjs (every object has a note and a page).

-- ===== a-cards =====
-- Database documentation, area A: cards, collection, packs and trading.
-- Only COMMENT ON statements. Facts come from the live catalog (pg_get_functiondef, pg_trigger, cron.job)
-- and the callers in tcg-activity/, tcg-bot/src/ and card-studio/. A comment that was already on live
-- stays as it is, except gift_claims.reason (replaced: the old text covered pack gifts only).

-- ============================================================ cards
comment on table public.cards is $c$[cards] One row per card: one subject in one rarity. The card studio (card-studio/src/push.js) writes it. The bot draw, the Activity catalog and most game functions read it. Anyone can read it.$c$;
comment on column public.cards.id is $c$Row id. Other tables link to it as card_id.$c$;
comment on column public.cards.subject_id is $c$The subject of the card (subjects.id). All rarities of one subject share it.$c$;
comment on column public.cards.name is $c$The card title. The card studio sets it and keeps it the same as subjects.name.$c$;
comment on column public.cards.rarity is $c$The rarity (enum card_rarity): normal, illustrated_rare, secret_rare, full_art, gold, promo or event. One row per subject and rarity.$c$;
comment on column public.cards.source is $c$Where the card comes from (enum card_source: draw, achievement, event, promo). The card studio always writes draw.$c$;
comment on column public.cards.image_url is $c$The public URL of the card face in the card-art storage bucket, with a ?v= cache key. The card studio sets it on each push.$c$;
comment on column public.cards.artist_credit is $c$The artist name printed on the card, or null. The card studio sets it.$c$;
comment on column public.cards.lore is $c$The flavor text of this rarity, or null. The card studio sets it.$c$;
comment on column public.cards.in_draw_pool is $c$True when packs can draw the card (the bot draw reads only these rows). The trigger cards_event_rules sets it to false for promo and event cards.$c$;
comment on column public.cards.created_at is $c$Time the row was made (the first push of this rarity).$c$;
comment on column public.cards.season is $c$The season label of the card (for example 'Season 1'). The card studio sets it. The Activity uses it for Hunt weak points.$c$;
comment on column public.cards.event is $c$The event or period name of a promo or event card, else null. The card studio sets it.$c$;
comment on column public.cards.tradeable is $c$False when trades, gifts and the Trading Hall must refuse the card. The card studio sets it per rarity. The trigger cards_event_rules forces false for promo and event cards.$c$;

-- ============================================================ subjects
comment on table public.subjects is $c$[cards] One row per card subject (the character or thing on the card), shared by all its rarities. The card studio and its scripts (push-abilities, push-effects, set-tags) write it. The Hunt, effects and power functions read it.$c$;
comment on column public.subjects.id is $c$Row id. cards.subject_id links to it.$c$;
comment on column public.subjects.key is $c$The card id in the card studio (unique). push.js upserts the subject on this key.$c$;
comment on column public.subjects.name is $c$The subject name. The card studio sets it.$c$;
comment on column public.subjects.description is $c$The genre text from the card studio, or null.$c$;
comment on column public.subjects.created_at is $c$Time the row was made.$c$;
comment on column public.subjects.cp_mod is $c$The power multiplier of this subject (1.0 = no change). card_cp_exact multiplies the card power by it.$c$;
comment on column public.subjects.ability is $c$The Hunt ability of the card as JSON (name, desc, kind attack or support, effect, amount, cooldown, affinity), or null. The card studio and push-abilities.mjs set it. The Hunt functions read it.$c$;
comment on column public.subjects.tags is $c$The card tags as JSON facets (for example type, class, origin, traits). Each facet is a string or a list. The card studio and the tag scripts set it.$c$;
comment on column public.subjects.tag_slugs is $c$The tags as flat 'facet:value' text in lower case (traits become trait:). The trigger subjects_flatten_tags fills it from tags. Do not write it directly.$c$;
comment on column public.subjects.effect is $c$The prank or boon effect of the card as JSON (name, desc, primitive, base, cooldown_h), or null. push-effects.mjs sets it. play_card_effect reads it.$c$;

-- ============================================================ player_cards (table comment and quantity are on live)
comment on column public.player_cards.player_id is $c$The member who holds the copies (players.id).$c$;
comment on column public.player_cards.card_id is $c$The card (cards.id).$c$;
comment on column public.player_cards.first_obtained_at is $c$Time the row was made: the first copy. The row goes at 0 copies, so a later copy starts a new time.$c$;
comment on column public.player_cards.ascension is $c$The stars of the card for this member, 0 to 5. ascend_card adds one. It changes the card power (card_power).$c$;
comment on column public.player_cards.stat_points is $c$The stat points spent on this card as JSON: attack, vitality, precision, potency, haste. spend_stat_points adds, reset_stat_points clears. The total cap comes from the stars and balance key stat_points.$c$;
comment on column public.player_cards.first_source is $c$How the first copy came (card_move p_source): pull, trade, auction, gift, shop, dungeon or dungeon_prize.$c$;

-- ============================================================ gift_claims (table comment is on live)
comment on column public.gift_claims.id is $c$Row id. pack_ledger, card_ledger and shard_ledger rows point at it with ref ('gift', id).$c$;
comment on column public.gift_claims.player_id is $c$The member who receives the gift (players.id).$c$;
comment on column public.gift_claims.kind is $c$The gift type: card (a card gift) or a pack/Shards label such as member_gift, new_player, launch_day, promo, once_<name>. new_player, launch_day and once_ kinds are once per member (unique indexes).$c$;
comment on column public.gift_claims.title is $c$The text that the bell shows for the gift. A card gift uses the card name.$c$;
comment on column public.gift_claims.amount is $c$The packs paid on claim (0 to 999). A card gift holds 1 (one card).$c$;
comment on column public.gift_claims.reason is $c$A pack gift: the pack_ledger reason that claim_gift writes (gift_claims_pack_reason_check). A card gift: member_gift (claimed as gift_received) or an event key such as event:launch_player (claimed as event, once per member).$c$;
comment on column public.gift_claims.from_id is $c$The member who sent the gift (players.id), or null for a game gift.$c$;
comment on column public.gift_claims.created_at is $c$Time the gift was made.$c$;
comment on column public.gift_claims.claimed_at is $c$Time the member claimed the gift in the bell, or null while it waits. claim_gift sets it.$c$;
comment on column public.gift_claims.card_id is $c$The card of a card gift (cards.id), else null.$c$;
comment on column public.gift_claims.shards is $c$The Shards paid on claim (0 to 100000). claim_gift pays them with grant_shards reason event.$c$;

-- ============================================================ trade_offers
comment on table public.trade_offers is $c$[trading] One row per one-for-one trade offer between two members. create_trade, create_trade_open and offer_on_listing write it. counter_trade, accept_trade and set_trade_status change it. The Activity /api/trades reads it.$c$;
comment on column public.trade_offers.id is $c$Row id. card_ledger rows of the trade use ref ('trade_offer', id).$c$;
comment on column public.trade_offers.from_id is $c$The member who made the offer (players.id).$c$;
comment on column public.trade_offers.to_id is $c$The member who receives the offer (players.id).$c$;
comment on column public.trade_offers.offer_card_id is $c$The card that from_id gives (cards.id). One copy is held (free_copies) while the offer is pending or countered.$c$;
comment on column public.trade_offers.request_card_id is $c$The card that to_id gives (cards.id), same rarity. Null for an open offer (create_trade_open) until to_id picks a card with counter_trade.$c$;
comment on column public.trade_offers.status is $c$pending (waits for to_id), countered (to_id picked a card, waits for from_id), accepted, declined or cancelled.$c$;
comment on column public.trade_offers.created_at is $c$Time the offer was made.$c$;
comment on column public.trade_offers.resolved_at is $c$Time the offer was accepted, declined or cancelled, else null.$c$;
comment on column public.trade_offers.countered_at is $c$Time to_id picked the card of an open offer (counter_trade), else null.$c$;
comment on column public.trade_offers.listing_id is $c$The Trading Hall listing that the offer answers (trade_listings.id), else null. offer_on_listing sets it.$c$;

-- ============================================================ trade_listings
comment on table public.trade_listings is $c$[trading] One row per card that a member lists in the Trading Hall. list_for_trade writes it. unlist_for_trade and the trigger trade_listing_close close it. The Activity /api/hall reads it.$c$;
comment on column public.trade_listings.id is $c$Row id. trade_offers.listing_id links to it.$c$;
comment on column public.trade_listings.player_id is $c$The member who lists the card (players.id). A member has at most 5 open listings (list_for_trade).$c$;
comment on column public.trade_listings.card_id is $c$The listed card (cards.id). One open listing per member and card (index trade_listings_open_once).$c$;
comment on column public.trade_listings.status is $c$open or closed. A listing closes when the member unlists it or when an offer on it is accepted.$c$;
comment on column public.trade_listings.created_at is $c$Time the card was listed.$c$;
comment on column public.trade_listings.closed_at is $c$Time the listing closed, else null.$c$;

-- ============================================================ card_trades
comment on table public.card_trades is $c$[trading] One row per completed card swap: an accepted trade offer or a sold auction. Only the triggers card_trades_offer and card_trades_auction write it. The Activity profile and leaderboard, achievements and dailies read it.$c$;
comment on column public.card_trades.id is $c$Row id. wish_grants.ref_id links to it for a trade or an auction.$c$;
comment on column public.card_trades.kind is $c$offer (from trade_offers) or auction (from auctions).$c$;
comment on column public.card_trades.from_id is $c$The offer sender or the auction seller (players.id).$c$;
comment on column public.card_trades.to_id is $c$The offer receiver or the winning bidder (players.id).$c$;
comment on column public.card_trades.from_cards is $c$The card ids that from_id gave (cards.id).$c$;
comment on column public.card_trades.to_cards is $c$The card ids that to_id gave (cards.id): the requested card or the bid cards.$c$;
comment on column public.card_trades.offer_id is $c$The trade offer (trade_offers.id) for kind offer, else null. Unique.$c$;
comment on column public.card_trades.auction_id is $c$The auction (auctions.id) for kind auction, else null. Unique.$c$;
comment on column public.card_trades.created_at is $c$Time of the swap: trade_offers.resolved_at or auctions.settled_at.$c$;

-- ============================================================ auctions
comment on table public.auctions is $c$[trading] One row per Trading Hall auction: one card for bid cards. start_auction writes it. The bid functions, expire_auctions and the bot auction posts change it. The Activity /api/auctions reads it.$c$;
comment on column public.auctions.id is $c$Row id. card_ledger rows of the sale use ref ('auction', id).$c$;
comment on column public.auctions.seller_id is $c$The member who sells the card (players.id). One live or accepted auction per seller (index auctions_one_live).$c$;
comment on column public.auctions.card_id is $c$The card for sale (cards.id). One copy is held (free_copies) while the auction is live or accepted.$c$;
comment on column public.auctions.min_rarity is $c$The rarity that min_count asks for (rarity_rank or higher), or null for no count rule.$c$;
comment on column public.auctions.min_count is $c$How many bid cards of min_rarity or higher a bid must hold, 0 to 5. 0 = no count rule.$c$;
comment on column public.auctions.min_cards is $c$Card ids (0 to 3) that a bid must hold. Empty = no card rule.$c$;
comment on column public.auctions.min_mode is $c$How the two rules join: and (both must be true) or or (one is enough). auction_meets applies it.$c$;
comment on column public.auctions.status is $c$live, accepted (the seller accepted a bid, the bidder must confirm), sold, closed (the seller stopped it) or expired.$c$;
comment on column public.auctions.accepted_bid_id is $c$The bid that the seller accepted (auction_bids.id), else null.$c$;
comment on column public.auctions.created_at is $c$Time the auction started.$c$;
comment on column public.auctions.ends_at is $c$Time the auction ends: start time plus 1 to 14 days (start_auction).$c$;
comment on column public.auctions.settled_at is $c$Time the auction became sold, closed or expired, else null.$c$;
comment on column public.auctions.notice_message_id is $c$A mark of the bot start post (auction-posts.ts), not a Discord id: null = no post yet, posted, failed, skip or ended.$c$;
comment on column public.auctions.notice_dirty is $c$True after a change that the bot has not posted. The SQL functions set it. The bot sets it to false after the end post.$c$;
comment on column public.auctions.notice_at is $c$Time of the last bot post for this auction, else null. The bot sets it.$c$;
comment on column public.auctions.accepted_at is $c$Time the seller accepted a bid, else null. The bidder must confirm in 24 hours or expire_auctions declines the bid.$c$;

-- ============================================================ auction_bids
comment on table public.auction_bids is $c$[trading] One row per bid on an auction: a set of bid cards. place_bid writes it. withdraw_bid, accept_bid, confirm_bid, decline_accepted_bid and return_bids change it. The Activity auction screens and the bot read it.$c$;
comment on column public.auction_bids.id is $c$Row id. auctions.accepted_bid_id links to it.$c$;
comment on column public.auction_bids.auction_id is $c$The auction (auctions.id).$c$;
comment on column public.auction_bids.bidder_id is $c$The member who bids (players.id). One open or accepted bid per member and auction.$c$;
comment on column public.auction_bids.cards is $c$The bid card ids (cards.id), 1 to 5. A repeated id is one more copy. These copies are held (free_copies) while the bid is open or accepted.$c$;
comment on column public.auction_bids.status is $c$open, accepted (by the seller), won (sold), declined, returned (the auction ended for this bid) or withdrawn (by the bidder or by a new bid).$c$;
comment on column public.auction_bids.created_at is $c$Time the bid was made.$c$;
comment on column public.auction_bids.updated_at is $c$Time of the last status change.$c$;

-- ============================================================ wishlists
comment on table public.wishlists is $c$[trading] The cards that a member wants: up to 5 slots per member. set_wishlist and set_wish_top write it. The Activity /api/wishlist and /api/hall, the bot trade pictures and achievements read it.$c$;
comment on column public.wishlists.player_id is $c$The member (players.id).$c$;
comment on column public.wishlists.slot is $c$The slot, 1 to 5.$c$;
comment on column public.wishlists.card_id is $c$The wanted card (cards.id). A card is in one slot only per member.$c$;
comment on column public.wishlists.created_at is $c$Time the card was put in the slot.$c$;
comment on column public.wishlists.top is $c$True for the one top want of the member (index wishlists_one_top). set_wish_top sets it.$c$;

-- ============================================================ wish_grants
comment on table public.wish_grants is $c$[trading] One row each time a member gives a card that is on the receiver's wishlist. ach_wish_grant writes it from the triggers on card_trades and gift_claims. ach_track_values reads it for achievements.$c$;
comment on column public.wish_grants.id is $c$Row id.$c$;
comment on column public.wish_grants.giver_id is $c$The member who gave the card (players.id).$c$;
comment on column public.wish_grants.receiver_id is $c$The member who got the wanted card (players.id).$c$;
comment on column public.wish_grants.card_id is $c$The card that was on the receiver's wishlist (cards.id).$c$;
comment on column public.wish_grants.source is $c$trade, auction or gift.$c$;
comment on column public.wish_grants.ref_id is $c$The source row: card_trades.id for trade or auction, gift_claims.id for gift.$c$;
comment on column public.wish_grants.created_at is $c$Time the row was written.$c$;

-- ============================================================ artist_submissions
comment on table public.artist_submissions is $c$[cards] Planned: card art sent by artists for review. No code or function reads or writes this table.$c$;
comment on column public.artist_submissions.id is $c$Row id.$c$;
comment on column public.artist_submissions.submitted_by is $c$The member who sent the art. No code sets it.$c$;
comment on column public.artist_submissions.subject_name is $c$The proposed subject name. No code sets it.$c$;
comment on column public.artist_submissions.proposed_rarity is $c$The proposed rarity (enum card_rarity). No code sets it.$c$;
comment on column public.artist_submissions.image_url is $c$The URL of the sent art. No code sets it.$c$;
comment on column public.artist_submissions.artist_credit is $c$The artist name to print. No code sets it.$c$;
comment on column public.artist_submissions.lore is $c$The proposed flavor text. No code sets it.$c$;
comment on column public.artist_submissions.status is $c$The review state (enum submission_status): pending, approved or rejected. No code sets it.$c$;
comment on column public.artist_submissions.reviewed_by is $c$The person who reviewed the art. No code sets it.$c$;
comment on column public.artist_submissions.created_at is $c$Time the row was made.$c$;

-- ============================================================ roster_power_history
comment on table public.roster_power_history is $c$[cards] One row per snapshot of the community card power. roster_snapshot writes it at each weekly boss spawn. Only card-studio/scripts/roster-stats.mjs reads it. The live Hunt HP does not use it.$c$;
comment on column public.roster_power_history.id is $c$Row id.$c$;
comment on column public.roster_power_history.captured_at is $c$Time of the snapshot.$c$;
comment on column public.roster_power_history.players is $c$The count of members (players rows).$c$;
comment on column public.roster_power_history.owned_cards is $c$The count of player_cards rows with at least one copy.$c$;
comment on column public.roster_power_history.total_power is $c$The sum of card_power over all owned cards (one per member and card, with stars).$c$;
comment on column public.roster_power_history.boss_hp_normal is $c$An estimate: roster_boss_hp(deployable_power), balance key boss_hp_estimate (min floor). Not the HP of a real boss.$c$;
comment on column public.roster_power_history.boss_hp_heroic is $c$An estimate: roster_boss_hp(deployable_power), balance key boss_hp_estimate (min floor). Not the HP of a real boss.$c$;
comment on column public.roster_power_history.boss_hp_mythic is $c$An estimate: roster_boss_hp(deployable_power), balance key boss_hp_estimate (min floor). Not the HP of a real boss.$c$;
comment on column public.roster_power_history.deployable_power is $c$The result of deployable_power(): the power that members can send into a Hunt.$c$;

-- ============================================================ functions: trading
comment on function public.accept_bid(text,bigint) is $c$The seller accepts one open bid: the bid and the auction become accepted, and the bidder has 24 hours to confirm. Activity /api/auction/accept. Returns ok, bidder, auction, confirm_by.$c$;
comment on function public.auction_meets(bigint,bigint[]) is $c$True when a set of bid cards meets the auction minimum (min_rarity, min_count, min_cards, min_mode). Called by place_bid and the Activity /api/auction. Writes nothing.$c$;
comment on function public.close_auction(text,bigint) is $c$The seller stops a live or accepted auction: returns all bids (return_bids) and sets status closed. Activity /api/auction/close. Returns ok or an error.$c$;
comment on function public.counter_trade(bigint,text,bigint) is $c$The receiver of an open offer picks the card to give back (same rarity, tradeable, free copy): sets request_card_id and status countered. Activity /api/trade/counter. Returns true when it worked.$c$;
comment on function public.create_trade(text,text,bigint,bigint) is $c$Makes a pending one-for-one offer (both cards tradeable, same rarity, a free copy of the offered card). Activity /api/trade/offer and offer_on_listing. Returns the trade_offers id, or null.$c$;
comment on function public.create_trade_open(text,text,bigint) is $c$Makes a pending offer with no requested card: the receiver picks one later with counter_trade. Activity /api/trade/offer. Returns the trade_offers id, or null.$c$;
comment on function public.decline_accepted_bid(text,bigint) is $c$The bidder declines the accepted bid: the bid becomes declined, the auction goes live again, or expires (returning all bids) when its time is up. Activity /api/auction/decline.$c$;
comment on function public.expire_auctions() is $c$Declines accepted bids not confirmed in 24 hours and ends live auctions whose time is up (return_bids, notify_player). pg_cron job expire-auctions (every 10 minutes). Returns the auctions changed.$c$;
comment on function public.free_copies(text,bigint) is $c$The copies of a card that a member can use now: quantity minus the copies held by pending or countered offers, a live or accepted auction, and open or accepted bids. Internal helper of the trade, auction, gift and ascend functions.$c$;
comment on function public.list_for_trade(text,bigint) is $c$Lists a tradeable card with a free copy in the Trading Hall (max 5 open listings). Activity /api/hall/list. Writes trade_listings. Returns ok and the listing id, or an error.$c$;
comment on function public.offer_on_listing(text,bigint,bigint) is $c$Makes a trade offer on a Trading Hall listing (create_trade, then sets listing_id). One pending offer per member and listing. Activity /api/hall/offer. Returns ok, id, to.$c$;
comment on function public.place_bid(text,bigint,bigint[]) is $c$Places a bid of 1 to 5 free cards on a live auction and withdraws the member's old bid. A gold card takes only Full Art, Promo or Event bids. Activity /api/auction/bid. Returns ok, id, meets.$c$;
comment on function public.rarity_rank(text) is $c$The order of a rarity: normal 0, illustrated_rare 1, secret_rare and promo 2, full_art and event 3, gold 4. Internal helper of auction_meets.$c$;
comment on function public.return_bids(bigint,bigint) is $c$Sets the open and accepted bids of an auction to returned, except p_keep. Internal helper of close_auction, confirm_bid, decline_accepted_bid and expire_auctions.$c$;
comment on function public.set_trade_status(bigint,text,text) is $c$Declines (the receiver) or cancels (the sender) a pending or countered offer. Activity /api/trade/resolve. Returns true when it worked.$c$;
comment on function public.set_wish_top(text,integer) is $c$Marks one filled wishlist slot as the member's top want and clears the old one. Activity /api/wishlist/top. Returns ok or an error.$c$;
comment on function public.set_wishlist(text,integer,bigint) is $c$Puts a card in a wishlist slot (1 to 5), or empties the slot when p_card is null. A card is in one slot only. Activity /api/wishlist. Returns ok or an error.$c$;
comment on function public.start_auction(text,bigint,text,integer,bigint[],text,integer) is $c$Starts an auction of 1 to 14 days for a free copy, with the seller's minimum. One live auction per seller. Activity /api/auction/start. Writes auctions. Returns ok and the id, or an error.$c$;
comment on function public.unlist_for_trade(text,bigint) is $c$The member closes an open listing and declines its pending offers. Activity /api/hall/unlist. Returns ok or an error.$c$;
comment on function public.withdraw_bid(text,bigint) is $c$The bidder withdraws an open bid. An accepted bid cannot be withdrawn here (use decline_accepted_bid). Activity /api/auction/withdraw. Returns ok or an error.$c$;
comment on function public.card_trades_from_auction() is $c$Trigger card_trades_auction on auctions (status becomes sold): writes the card_trades row of the sale. Internal helper.$c$;
comment on function public.card_trades_from_offer() is $c$Trigger card_trades_offer on trade_offers (status becomes accepted): writes the card_trades row of the trade. Internal helper.$c$;
comment on function public.trade_listing_close() is $c$Trigger trade_listing_close on trade_offers: when an offer on a listing is accepted, closes the listing and declines its other pending offers. Internal helper.$c$;

-- ============================================================ functions: power and stats
comment on function public.ascend_cost(text,integer) is $c$The copies that the next star costs for a rarity at a star count, or null at 5 stars. The numbers are in balance key ascend_cost. Called by ascend_card.$c$;
comment on function public.card_cp_exact(text,integer,numeric) is $c$The exact card power: the rarity power times the star multiplier times cp_mod. The numbers are in balance keys rarity_cp and stars. Internal helper of card_power and card_combat.$c$;
comment on function public.card_power(text,integer,numeric) is $c$The card power (CP) as an integer: card_cp_exact rounded. The one CP calculation. Called by ascend_card, the collection and roster power functions and deployable_power.$c$;
comment on function public.card_powers(text) is $c$A JSON map card id to power and HP. With no member: every card at 0 stars. With a member: that member's cards with stars and stat points (card_combat). Activity /api/collection, /api/hunt, /api/hunt/autopick, /api/spotlight.$c$;
comment on function public.card_stats_for(text) is $c$The stat point state of a member: on (from balance key stat_points), the reset week, and the combat stats of each card with stars or points. Activity /api/collection and hunt_view.$c$;
comment on function public.collection_power_all() is $c$The collection power of every member: the sum of card_power, with the set bonus (balance key set_bonus) on a subject when the member owns all its cards. Activity /api/leaderboard/v2.$c$;
comment on function public.deployable_power(integer) is $c$The sum, over all members, of each member's top N Character and Creature card powers (N = p_cap or hunt_card_cap()). Called by roster_snapshot and roster_stats.$c$;
comment on function public.my_collection_power(text) is $c$The collection power of one member (the same rule as collection_power_all). Activity /api/collection and /api/profile.$c$;
comment on function public.reset_stat_points(text,bigint) is $c$Clears the stat points of one card, once per game week (players.stat_reset_week, America/Denver). Activity /api/stats/reset. Returns ok and the new stats, or an error.$c$;
comment on function public.roster_snapshot() is $c$Writes one roster_power_history row (members, owned cards, total and deployable power, the boss HP estimates of roster_boss_hp). Called by spawn_weekly_boss (pg_cron hunt-spawn-mt through weekly_boss_tick) and roster-stats.mjs. Returns the row id.$c$;
comment on function public.roster_stats() is $c$The community card power as JSON: counts, total and deployable power, the boss HP estimates (roster_boss_hp), cards by rarity and by stars. Only card-studio/scripts/roster-stats.mjs calls it. Writes nothing.$c$;
comment on function public.roster_top_players(integer) is $c$The members with the most total card power (no set bonus): owned cards, total power, best card. Only card-studio/scripts/roster-stats.mjs calls it.$c$;
comment on function public.spend_stat_points(text,bigint,jsonb) is $c$Adds stat points to one card (attack, vitality, precision, potency, haste) up to the cap of its stars (balance key stat_points). Activity /api/stats/spend. Returns ok, points and stats, or an error.$c$;
comment on function public.stat_cfg() is $c$The stat point settings: balance key stat_points. Internal helper of the stat point, combat and shop functions.$c$;
comment on function public.stat_pt(jsonb,text) is $c$The points of one stat in a stat_points object, as an integer from 0 to the max in balance key stat_points. Internal helper of spend_stat_points, card_combat and ach_track_values.$c$;
comment on function public.top_collection_power(integer) is $c$The top members by collection power (the same rule as collection_power_all), max 100. Not called by any code or job (only test-balance-table.mjs).$c$;
comment on function public.convertible_copies(text,bigint) is $c$The copies of a card that a member can turn into Shards: free_copies minus one (one copy stays). Called by convert_dupes and the Activity /api/shards/convertible.$c$;

-- ============================================================ functions: packs and gifts
comment on function public.give_card_gift(text,bigint,text,text) is $c$Puts a card gift in a member's bell (gift_claims, kind card), once per member and reason. Called by launch_player_gift and launch_raider_gift. Returns true when it wrote a row.$c$;
comment on function public.launch_player_gift(text) is $c$Gives the Launch Day Player card gift (settings key launch_event_cards) to a member while the offer is open. Called by claim_tutorial_reward and set_launch_player_card. Returns true when it gave the gift.$c$;
comment on function public.launch_raider_gift() is $c$Trigger launch_raider_gift on hunt_hits: a hit in one of the launch Hunts (settings key launch_event_cards) gives the Launch Day Raider card gift once. Internal helper.$c$;
comment on function public.set_launch_player_card(bigint) is $c$Admin: sets the Launch Day Player card in settings, gives its subject the Launch Party effect, and sends the gift to the members who finished the tutorial. Not called by any code or job. Returns the gifts sent.$c$;
comment on function public.welcome_packs() is $c$Trigger players_welcome_packs on players: a new member with a Discord id gets the welcome pack gift in the bell. The number is in balance key welcome_packs. Setting tcg.skip_welcome = on skips it.$c$;

-- ============================================================ functions: card rules
comment on function public.cards_event_rules() is $c$Trigger cards_event_rules on cards: a promo or event card is never tradeable and never in the draw pool. Internal helper.$c$;
comment on function public.subjects_flatten_tags() is $c$Trigger subjects_flatten_tags_trg on subjects: fills tag_slugs from tags. Internal helper.$c$;

-- ===== b-hunt =====
-- Database documentation: the weekly Hunt (the boss), combat, and card effects (boons and pranks).
-- Only COMMENT ON statements. Facts come from the live function text, the constraints, pg_cron and the callers
-- (tcg-activity/server.js, tcg-activity/effects.js, tcg-bot/src). The comments that were already correct on live
-- (hunt_attack, hunt_damage_reconcile, settle_hunt, combat_actions, hunt_adjustments) are not repeated here.
-- The Hunt tier is stored as Normal, Heroic, Mythic (= Tier 1, Tier 2, Tier 3). The Hunt day is the Mountain Time day.

-- ============================================================ The Hunt: tables

comment on table public.hunts is $c$[hunt] One row per Hunt boss. spawn_hunt writes it. hunt_attack and hunt_support change the HP and status, close_hunt and settle_hunt end it. The Activity (/api/hunt and others) and the bot read it. Server only (RLS on, no API grants).$c$;
comment on column public.hunts.id is $c$Hunt id. Every hunt_* table and combat_actions.ref_id (mode hunt) point at it.$c$;
comment on column public.hunts.name is $c$The boss name, a random pick from the fixed list of rigged model bosses in spawn_hunt. hunt_counter_pick uses it to find the boss moves in settings key hunt_boss_moves.$c$;
comment on column public.hunts.tier is $c$The boss tier: Normal, Heroic or Mythic (Tier 1, 2, 3). spawn_hunt sets it (random, or the p_tier argument). The HP, ATK, weak points and passives come from the balance keys for this tier.$c$;
comment on column public.hunts.weak_points is $c$The boss weaknesses: a jsonb array of {kind, value}. spawn_hunt writes kind tag (a tag slug). combat_weak also matches kind type, rarity and season. A matched card deals more damage.$c$;
comment on column public.hunts.hp_max is $c$The boss full HP. spawn_hunt sets it from balance key boss_hp (the tier value, not below the floor).$c$;
comment on column public.hunts.hp_remaining is $c$The boss HP now, shared by all members. Attacks, smite and Hunt Crasher damage lower it. Boss heals raise it, never above hp_max. 0 = defeated.$c$;
comment on column public.hunts.opens_at is $c$When the Hunt opened (the insert time).$c$;
comment on column public.hunts.closes_at is $c$When the Hunt ends. spawn_weekly_boss sets it to next_hunt_close() (Monday 5 PM Mountain Time). After it, attacks are refused and close_due_hunts closes the Hunt.$c$;
comment on column public.hunts.status is $c$active, defeated (hunt_attack or a smite took the HP to 0) or expired (closed by time, or replaced by a new spawn). No check constraint.$c$;
comment on column public.hunts.defeated_at is $c$When the boss HP reached 0. Null if the boss was not defeated.$c$;
comment on column public.hunts.created_at is $c$When the row was written.$c$;
comment on column public.hunts.settled_at is $c$When settle_hunt paid the prizes. Not null = paid, so a second settle does nothing.$c$;
comment on column public.hunts.resist_points is $c$The boss resistances: a jsonb array of {kind, value}, the same shape as weak_points. A matched card deals less damage (combat_weak).$c$;
comment on column public.hunts.passive is $c$The boss passives: {kind, label} of the first passive (for older readers), list (all passives as {kind, label}) and phase2 (true after hunt_attack added the phase-2 passive). The count per tier is in balance key boss_tiers.$c$;
comment on column public.hunts.hp_share is $c$The base size of the boss heals (drain, regenerate, the Regenerating passive): balance key boss_hp.heal_share, else hp_max / crew. Null on an old Hunt: hunt_attack then uses hp_max.$c$;
comment on column public.hunts.stats is $c$The boss stats as jsonb: atk = the boss attack. spawn_hunt sets it from balance keys boss_atk (tier) and boss_stats (the boss multiplier). Null on an old Hunt: hunt_attack then uses the tier value.$c$;

comment on table public.hunt_hits is $c$[hunt] The damage of one card of one member on one Hunt day: one row per (hunt, member, card, day), summed. hunt_attack and hunt_support (smite) write it. The leaderboard, settle_hunt, the Activity and the bot read it. Trigger launch_raider_gift runs on insert.$c$;
comment on column public.hunt_hits.id is $c$Row id. settle_hunt uses the lowest id of a member to break a damage tie (the first hit wins).$c$;
comment on column public.hunt_hits.hunt_id is $c$The Hunt (hunts.id).$c$;
comment on column public.hunt_hits.player_id is $c$The member (players.id) who gets the damage credit. For a Hunt Crasher share: the prankster, not the attacker.$c$;
comment on column public.hunt_hits.card_id is $c$The card (cards.id) that gets the credit: the attacking card, the smite card or the prankster's Raider card.$c$;
comment on column public.hunt_hits.hit_date is $c$The Hunt day (the Mountain Time date) of the damage.$c$;
comment on column public.hunt_hits.damage is $c$The total damage of this card on this day, in boss HP points. Each new hit adds to it.$c$;
comment on column public.hunt_hits.created_at is $c$When the first damage of the row was written.$c$;

comment on table public.hunt_card_hp is $c$[hunt] The fight state of one card of one member on one Hunt day: HP, shield, buffs and cooldown. hunt_attack, hunt_support, hunt_commit_card and the counter-move functions write it. hunt_view and /api/hunt read it.$c$;
comment on column public.hunt_card_hp.hunt_id is $c$The Hunt (hunts.id).$c$;
comment on column public.hunt_card_hp.player_id is $c$The member (players.id) who owns the card.$c$;
comment on column public.hunt_card_hp.card_id is $c$The card (cards.id). The number of rows for a member on a day is the cards used that day, at most balance key daily_card_cap.$c$;
comment on column public.hunt_card_hp.hit_date is $c$The Hunt day (the Mountain Time date). Each day starts with full HP.$c$;
comment on column public.hunt_card_hp.hp_remaining is $c$The card HP now, 0 to max_hp.$c$;
comment on column public.hunt_card_hp.max_hp is $c$The card full HP: card_combat hp for an attacker, card_max_hp(0) (the HP floor) for a support card.$c$;
comment on column public.hunt_card_hp.downed is $c$true = the card HP reached 0. A downed card cannot attack or support for the rest of the day. A heal does not revive it.$c$;
comment on column public.hunt_card_hp.updated_at is $c$When the row last changed.$c$;
comment on column public.hunt_card_hp.shield is $c$Shield points (from a shield support). Boss damage takes the shield first. 0 = no shield.$c$;
comment on column public.hunt_card_hp.dmg_buff is $c$The empower multiplier for the next attack of this card (1 = none). hunt_attack resets it to 1 after the attack.$c$;
comment on column public.hunt_card_hp.dmg_debuff is $c$The curse multiplier on the damage of this card (1 = none, below 1 = cursed). A cleanse support sets it back to 1.$c$;
comment on column public.hunt_card_hp.cd_until_round is $c$The squad round until which the card waits. A support card plays again when the round reaches it (its cooldown). A card stunned by the boss gets round + 1. 0 = ready.$c$;

comment on table public.hunt_combat_log is $c$[hunt] One row per attack of a card on the Hunt boss, with the rolls and the boss turn. hunt_attack writes it. The Activity feed (/api/hunt/feed), hunt_combat_stats, hunt_fight_summary and hunt_damage_reconcile read it.$c$;
comment on column public.hunt_combat_log.id is $c$Row id (also the order of the attacks). combat_actions.result.combat_log_id points at it.$c$;
comment on column public.hunt_combat_log.hunt_id is $c$The Hunt (hunts.id).$c$;
comment on column public.hunt_combat_log.player_id is $c$The member (players.id) who attacked.$c$;
comment on column public.hunt_combat_log.card_id is $c$The attacking card (cards.id).$c$;
comment on column public.hunt_combat_log.ts is $c$When the attack happened. The feed counts the members with an attack in the last 5 minutes.$c$;
comment on column public.hunt_combat_log.cp is $c$The combat power of the attacking copy (card_combat cp, with its stars and stat points).$c$;
comment on column public.hunt_combat_log.outcome is $c$The attack roll: miss, hit, crit or blocked (combat_hit).$c$;
comment on column public.hunt_combat_log.bonus is $c$true = the card matched at least one boss weak point.$c$;
comment on column public.hunt_combat_log.crit is $c$true = a critical hit.$c$;
comment on column public.hunt_combat_log.block is $c$true = the boss blocked part of the damage.$c$;
comment on column public.hunt_combat_log.damage is $c$The damage of this attack to the boss, in HP points (0 on a miss). It does not include the Hunt Crasher share.$c$;
comment on column public.hunt_combat_log.countered is $c$true = the boss turn after this attack was a hit (not stunned, charging, enrage, curse or regenerate).$c$;
comment on column public.hunt_combat_log.counter_dmg is $c$The boss-turn damage to the attacking card after its shield. It does not include burn, thorns or damage over time.$c$;
comment on column public.hunt_combat_log.card_hp_after is $c$The attacking card HP after the boss turn.$c$;
comment on column public.hunt_combat_log.card_downed is $c$true = the attacking card went down in this exchange.$c$;
comment on column public.hunt_combat_log.boss_hp_after is $c$The boss HP after this attack and the boss heals of this turn.$c$;

comment on table public.hunt_combat_state is $c$[hunt] The boss fight state of one member on one Hunt day: the round, the boss buffs and debuffs, and the counter-move marks. The boss HP is shared (hunts), this state is not. hunt_attack, hunt_support and the counter functions write it.$c$;
comment on column public.hunt_combat_state.hunt_id is $c$The Hunt (hunts.id).$c$;
comment on column public.hunt_combat_state.player_id is $c$The member (players.id).$c$;
comment on column public.hunt_combat_state.hit_date is $c$The Hunt day (the Mountain Time date).$c$;
comment on column public.hunt_combat_state.round is $c$The boss turns of this squad today. hunt_attack adds 1 after each attack on a living boss. At balance key round_cap the squad stops for the day.$c$;
comment on column public.hunt_combat_state.boss_enrage is $c$The boss damage multiplier of an enrage move (balance key boss_moves). It acts while round <= enrage_until.$c$;
comment on column public.hunt_combat_state.enrage_until is $c$The last round of the enrage. 0 = none.$c$;
comment on column public.hunt_combat_state.updated_at is $c$When the row last changed.$c$;
comment on column public.hunt_combat_state.boss_weaken is $c$The share of boss damage that a weaken support removes (0 to the cap in balance key support). It acts while round <= weaken_until.$c$;
comment on column public.hunt_combat_state.weaken_until is $c$The last round of the weaken. 0 = none.$c$;
comment on column public.hunt_combat_state.boss_expose is $c$The extra share of damage the boss takes from an expose support (0 to the cap in balance key support). It acts while round <= expose_until.$c$;
comment on column public.hunt_combat_state.expose_until is $c$The last round of the expose. 0 = none.$c$;
comment on column public.hunt_combat_state.stunned_until is $c$The boss skips its turn while round <= this value (a stun support sets round + 1). It also starts the stun immunity (combat_stun_immune).$c$;
comment on column public.hunt_combat_state.marks is $c$The counter-move marks as jsonb, mostly {key: {until: round, mult}}: for example heal_block_card, dot, half_<effect>, block_<effect>, null_next, stun_fail, mirror, spiral, undying. Written by hunt_counter_act, read by hunt_attack and hunt_support.$c$;

comment on table public.hunt_squads is $c$[hunt] The squad a member locked for one Hunt day: one row per (hunt, member, day). lock_hunt_squad writes it (/api/hunt/squad). hunt_squad_allows, hunt_squad_done and /api/hunt read it. A locked squad fights only with its own cards.$c$;
comment on column public.hunt_squads.hunt_id is $c$The Hunt (hunts.id).$c$;
comment on column public.hunt_squads.player_id is $c$The member (players.id).$c$;
comment on column public.hunt_squads.hit_date is $c$The Hunt day (the Mountain Time date).$c$;
comment on column public.hunt_squads.card_ids is $c$The squad cards (cards.id), 1 to 8 (check constraint), at most balance key daily_card_cap, at least one attacker (Character or Creature).$c$;
comment on column public.hunt_squads.locked_at is $c$When the squad was locked or last changed.$c$;

comment on table public.hunt_events is $c$[hunt] The outbox of Hunt posts for Discord. The Hunt functions write a row (spawn, nudge, defeat, expired, player_done, leaderboard, attack). The bot (hunt-notify.ts) posts rows with posted_at null. It does not post kind attack. prune_old_rows deletes old rows.$c$;
comment on column public.hunt_events.id is $c$Row id (the post order).$c$;
comment on column public.hunt_events.hunt_id is $c$The Hunt (hunts.id).$c$;
comment on column public.hunt_events.kind is $c$spawn (spawn_weekly_boss), nudge (nudge_hunt), defeat (hunt_attack, hunt_support), expired (close_hunt), player_done and attack (hunt_attack), leaderboard (daily_raid_board).$c$;
comment on column public.hunt_events.payload is $c$The post data for the kind, for example the boss name, tier, HP, closes_at, the top members or the squad summary.$c$;
comment on column public.hunt_events.created_at is $c$When the row was written.$c$;
comment on column public.hunt_events.posted_at is $c$When the bot posted the row. Null = not posted yet.$c$;

-- ============================================================ Card effects: tables

comment on table public.effect_primitives is $c$[effects] The list of effect types (primitives) a card can carry, with their kind, channel and hard limits. Only SQL migrations write it. play_card_effect and the Activity (/api/effects/me) read it.$c$;
comment on column public.effect_primitives.primitive is $c$The effect type key, for example rally, mend, raid_crasher, nickname, gift_pack. subjects.effect.primitive points at it.$c$;
comment on column public.effect_primitives.kind is $c$boon, prank or neutral (check constraint). Only a prank meets the target counters (decoy, ward, reflect, redirect, delay) and the prank caps.$c$;
comment on column public.effect_primitives.channel is $c$Where it acts: app (a player_effects row for the Activity or the Hunt), discord (a discord_effects row for the bot) or voice (a discord_effects row that waits for voice).$c$;
comment on column public.effect_primitives.max_amount is $c$The hard ceiling of the amount after scaling. Null = no ceiling.$c$;
comment on column public.effect_primitives.max_duration_s is $c$The hard ceiling of the duration in seconds after scaling. Null = no ceiling.$c$;
comment on column public.effect_primitives.stacks is $c$true = a second copy can land while one is active. false = play_card_effect refuses with already_active.$c$;
comment on column public.effect_primitives.enabled is $c$true = cards with this effect can be played. false = play_card_effect refuses with effect_disabled.$c$;
comment on column public.effect_primitives.note is $c$A short text that tells what the effect does. The Activity, the bot and the SQL functions do not read it.$c$;

comment on table public.card_plays is $c$[effects] One row per card effect play (a boon, prank or neutral effect sent to a member). play_card_effect writes it, refund_card_play marks a refund. The Activity, the bot posts (effect-notify.ts) and the caps read it.$c$;
comment on column public.card_plays.id is $c$Play id. player_effects.source_play_id and discord_effects.play_id point at it.$c$;
comment on column public.card_plays.player_id is $c$The member (players.id) who played the card.$c$;
comment on column public.card_plays.target_id is $c$The member (players.id) the effect landed on: aimed_at, or the sender after a reflect, or another member after a redirect.$c$;
comment on column public.card_plays.aimed_at is $c$The member (players.id) the sender picked. The pair cap counts on it.$c$;
comment on column public.card_plays.card_id is $c$The card (cards.id) that was played.$c$;
comment on column public.card_plays.subject_id is $c$The card subject (subjects.id). The cooldown is per member and subject.$c$;
comment on column public.card_plays.primitive is $c$The effect type (effect_primitives.primitive).$c$;
comment on column public.card_plays.kind is $c$boon, prank or neutral, copied from effect_primitives.kind.$c$;
comment on column public.card_plays.rarity is $c$The card rarity at the play. It sets the tier power and cooldown (balance key effect_tiers).$c$;
comment on column public.card_plays.amount is $c$The effect amount after the tier, star or stat-point scaling and the ceiling. The unit depends on the primitive (for example % for rally).$c$;
comment on column public.card_plays.duration_s is $c$The effect duration in seconds after scaling and the ceiling. Null or 0 = no time limit.$c$;
comment on column public.card_plays.outcome is $c$applied, blocked (ward or a cap where it lands), decoyed, reflected, redirected, delayed (lands 1 hour later) or refunded (refund_card_play). A refunded play counts in no cap.$c$;
comment on column public.card_plays.created_at is $c$When the card was played. The daily caps count plays from the Mountain Time day start.$c$;
comment on column public.card_plays.posted_at is $c$When the bot posted the play to Discord (effect-notify.ts). Null = not posted yet.$c$;
comment on column public.card_plays.seen_at is $c$When the target saw the play in the Activity (/api/effects/seen). Null = not seen.$c$;
comment on column public.card_plays.refund_reason is $c$Why the play was refunded (max 60 characters, from the bot, for example not_moderatable or not_manageable). Null = no refund.$c$;
comment on column public.card_plays.refund_seen_at is $c$When the sender saw the refund in the Activity (/api/effects/refunds/seen).$c$;

comment on table public.card_effect_cooldowns is $c$[effects] When a member can play a card subject's effect again: one row per (member, subject). play_card_effect writes it, refund_card_play deletes it. play_card_effect and /api/effects/me read it.$c$;
comment on column public.card_effect_cooldowns.player_id is $c$The member (players.id).$c$;
comment on column public.card_effect_cooldowns.subject_id is $c$The card subject (subjects.id). All copies and versions of the subject share one cooldown.$c$;
comment on column public.card_effect_cooldowns.ready_at is $c$When the effect can be played again. The length is the card cooldown_h scaled by balance keys effect_tiers, effect_ascension and effect_cooldown_scale.$c$;

comment on table public.player_effects is $c$[effects] An effect that waits on or acts on a member in the Activity or the Hunt (channel app). play_card_effect and the test route write it. The Activity, hunt_attack, take_player_effect, use_effect_charge and claim_daily use it up.$c$;
comment on column public.player_effects.id is $c$Row id.$c$;
comment on column public.player_effects.player_id is $c$The member (players.id) who has the effect.$c$;
comment on column public.player_effects.primitive is $c$The effect type (effect_primitives.primitive).$c$;
comment on column public.player_effects.amount is $c$The effect amount (unit by primitive, for example % for rally and butterfingers, HP for mend).$c$;
comment on column public.player_effects.duration_s is $c$The effect length in seconds. Null = until used.$c$;
comment on column public.player_effects.options is $c$Extra data: card_id, sender_id, uses (charges left), credit_to (Hunt Crasher credit), title, poll choice, arm_s and arm_after (a screen prank that waits), test (a test row).$c$;
comment on column public.player_effects.source_play_id is $c$The play that made it (card_plays.id). Null for a test row.$c$;
comment on column public.player_effects.created_at is $c$When the row was written. An armed screen prank older than 7 days is dropped.$c$;
comment on column public.player_effects.expires_at is $c$When the effect ends. Null = until used.$c$;
comment on column public.player_effects.consumed_at is $c$When the effect was used up, cleansed or dropped. Null = still waiting or active.$c$;
comment on column public.player_effects.starts_at is $c$When the effect starts: the play time, 1 hour later after a delay counter, or infinity for a screen prank that waits until the target opens the Activity (arm_on_open).$c$;

comment on table public.discord_effects is $c$[effects] A job for the bot to act in Discord (channel discord or voice): one row per effect on a member. play_card_effect writes it. The bot (discord-effects.ts) runs it, changes the status and undoes it at revert_at. prune_old_rows deletes old rows.$c$;
comment on column public.discord_effects.id is $c$Row id.$c$;
comment on column public.discord_effects.play_id is $c$The play (card_plays.id). A body_swap partner row has the same play_id.$c$;
comment on column public.discord_effects.target_id is $c$The member (players.id) the bot acts on.$c$;
comment on column public.discord_effects.primitive is $c$The effect type (effect_primitives.primitive), for example nickname, timeout, color_role, vc_mute.$c$;
comment on column public.discord_effects.amount is $c$The effect amount after scaling (unit by primitive).$c$;
comment on column public.discord_effects.duration_s is $c$The effect length in seconds. Null or 0 = no undo time.$c$;
comment on column public.discord_effects.options is $c$The play options (card_id, sender_id, title, poll) and the bot state for the run (for example color, times, sent, left, emoji, swap_side).$c$;
comment on column public.discord_effects.status is $c$pending (waits for execute_after), active (done in Discord, waits for revert_at), done, reverted, failed or skipped (check constraint). The bot sets it.$c$;
comment on column public.discord_effects.execute_after is $c$The bot runs the job at or after this time (1 hour later after a delay counter).$c$;
comment on column public.discord_effects.revert_at is $c$When the bot undoes the effect. Null = no undo. A cleanse sets it to now.$c$;
comment on column public.discord_effects.original_value is $c$What the bot must restore: the nickname before the effect (as JSON) or the id of the role it added.$c$;
comment on column public.discord_effects.error is $c$Why the job failed or was skipped (for example not_in_guild, cleansed, never_in_voice). Null = no error.$c$;
comment on column public.discord_effects.created_at is $c$When the row was written.$c$;
comment on column public.discord_effects.updated_at is $c$When the row last changed.$c$;

-- ============================================================ The Hunt: functions

comment on function public.spawn_hunt(integer,text) is $c$[hunt] Makes a new Hunt boss and returns its id. It first closes every active Hunt with close_hunt, so settle_hunt pays its prizes once. Picks the tier, weak and resist tags, passives, HP and ATK from the balance keys. Called by spawn_weekly_boss and test scripts.$c$;
comment on function public.spawn_weekly_boss() is $c$[hunt] The weekly spawn: roster_snapshot, spawn_hunt(7), closes_at = next_hunt_close(), and a hunt_events spawn row. Called by weekly_boss_tick('spawn'). Returns {ok, new, snapshot, closes_at}.$c$;
comment on function public.weekly_boss_tick(text) is $c$[hunt] The pg_cron entry for the Hunt week: kind spawn, nudge or close. It acts only in the Mountain Time hour of hunt_mt_slot, and spawns only if no Hunt opened in the last 6 hours. Called by the jobs hunt-spawn-mt, hunt-nudge-mt, hunt-close-mt-mdt and hunt-close-mt-mst.$c$;
comment on function public.nudge_hunt() is $c$[hunt] Writes a hunt_events nudge row (name, closes_at, HP) for the newest active Hunt. Called by weekly_boss_tick('nudge') on Monday 11 AM Mountain Time.$c$;
comment on function public.close_weekly_boss() is $c$[hunt] Closes the newest active Hunt that ends within 1 hour (close_hunt). Called by weekly_boss_tick('close').$c$;
comment on function public.close_due_hunts() is $c$[hunt] Closes every active Hunt whose closes_at has passed (close_hunt). Called by the pg_cron job hunt-close-due every 10 minutes. Returns {ok, closed}.$c$;
comment on function public.close_hunt(bigint) is $c$[hunt] Ends an active Hunt by time: status expired, settle_hunt pays the prizes, and a hunt_events expired row with the top 3. Does nothing for a Hunt that is not active. Called by close_due_hunts and close_weekly_boss.$c$;
comment on function public.daily_raid_board(timestamp with time zone) is $c$[hunt] Writes the daily Hunt leaderboard post (a hunt_events leaderboard row with the top 10) once per Mountain Time day at 6 AM. Called by the pg_cron job raid-board-mt. Returns true when it wrote a row.$c$;
comment on function public.hunt_mt_slot(text,timestamp with time zone) is $c$[hunt] True when the time is in the Mountain Time hour of the kind: spawn (Thursday 3 PM), nudge (Monday 11 AM), close (Monday 5 PM), board (every day 6 AM). Internal helper of weekly_boss_tick and daily_raid_board.$c$;
comment on function public.hunt_next_mt(integer,integer,timestamp with time zone) is $c$[hunt] The next time after p_at at the ISO weekday and hour on the Mountain Time clock (America/Denver). Internal helper of next_hunt_spawn and next_hunt_close.$c$;
comment on function public.next_hunt_spawn() is $c$[hunt] The next weekly spawn time (Thursday 3 PM Mountain Time). Called by the Activity /api/hunt for the countdown when no boss is active.$c$;
comment on function public.next_hunt_close() is $c$[hunt] The next weekly close time (Monday 5 PM Mountain Time). Called by spawn_weekly_boss to set hunts.closes_at.$c$;
comment on function public.hunt_support(text,bigint,bigint,bigint) is $c$[hunt] One support card play in the Hunt (empower, shield, heal, weaken, expose, stun, cleanse, smite). Called by /api/hunt/support. Writes hunt_card_hp, hunt_combat_state, combat_actions, and for smite hunts, hunt_hits and hunt_events. Returns jsonb.$c$;
comment on function public.lock_hunt_squad(text,bigint,bigint[]) is $c$[hunt] Locks the member's squad for today (hunt_squads). Checks the unlock gate, the size, ownership and at least one attacker. A squad that has fought cannot change. Called by /api/hunt/squad. Returns {ok, squad} or {ok false, error}.$c$;
comment on function public.hunt_view(text,bigint,date) is $c$[hunt] The member's Hunt state in one read: owned cards, today's hunt_card_hp rows, card stats, total damage and the round. Called by /api/hunt and /api/hunt/autopick.$c$;
comment on function public.hunt_leaderboard(bigint,integer) is $c$[hunt] The members of a Hunt by total damage (hunt_hits), top p_limit (1 to 100). Called by the Activity (/api/hunt, /api/hunt/leaderboard, the profile) and daily_raid_board.$c$;
comment on function public.adventure_gate(text) is $c$[hunt] The unlock gate for the Hunt, Dungeon and Gauntlet: all starter gifts redeemed and enough attacker cards (settings key adventure_gate). Returns {ok, gifts_open, gifts_total, attackers, need}. Called by /api/hunt and the squad and dungeon functions.$c$;
comment on function public.hunt_squad_allows(bigint,text,date,bigint) is $c$[hunt] True when the card can fight today: it is in the locked squad, or (no squad yet) the member passes adventure_gate. Internal helper of hunt_attack, hunt_support and hunt_commit_card.$c$;
comment on function public.hunt_squad_done(bigint,text,date,integer) is $c$[hunt] True when the member's squad is out for today: every attacker of the locked squad is down, or (no squad) the card cap is used and every card is down. Internal helper of hunt_attack (the player_done post).$c$;
comment on function public.hunt_squad_cards(bigint,text,date,bigint) is $c$[hunt] The other standing cards of the member's squad today (not p_card): HP, shield, buff and ability kind and effect. Internal helper of hunt_counter_act.$c$;
comment on function public.hunt_commit_card(bigint,text,bigint,date,integer) is $c$[hunt] Adds a card to today's fight (a hunt_card_hp row with full HP) if the squad allows it and the daily card cap is not full. True = the card is in. Internal helper of hunt_support.$c$;
comment on function public.hunt_state_round(bigint,text,date) is $c$[hunt] Makes sure that the member's hunt_combat_state row for today exists and returns its round. Internal helper of hunt_attack and hunt_support.$c$;
comment on function public.hunt_round_cap() is $c$[hunt] The most boss rounds a squad can fight in a day. The number is in balance key round_cap. Internal helper of hunt_attack and hunt_support.$c$;
comment on function public.hunt_card_cap() is $c$[hunt] The most cards a member can use in the Hunt in a day. The number is in balance key daily_card_cap. Internal helper of hunt_attack, hunt_commit_card, lock_hunt_squad and deployable_power.$c$;
comment on function public.hunt_combat_stats(bigint) is $c$[hunt] The roll rates of the attacks in hunt_combat_log (miss, crit, block, weak, counter %, downs, damage) for one Hunt or all (null). Called only by the local tool card-studio/scripts/combat-stats.mjs.$c$;
comment on function public.hunt_fight_summary() is $c$[hunt] One row per Hunt: tier, HP, status, attacks, members who attacked and the minutes to the kill. Called only by the local tool card-studio/scripts/combat-stats.mjs.$c$;

-- ============================================================ The Hunt: boss counter moves (docs/hunt-boss-moves.md)

comment on function public.hunt_counter_pick(bigint,text,date,text,text) is $c$[hunt] Picks a counter move for the boss turn from settings key hunt_boss_moves (the boss move pool and share), or returns null for the usual turn. Also handles the Rubberband mark on a stunned turn. Internal helper of hunt_attack.$c$;
comment on function public.hunt_counter_act(bigint,text,date,bigint,integer,numeric,numeric,text,text,integer,integer,integer,numeric) is $c$[hunt] Applies one counter move by key: damage, marks in hunt_combat_state, shield and HP changes in hunt_card_hp. Returns {key, move, anim, base, dmg, loss, pierce, shield, debuff, heal, targets}. Internal helper of hunt_attack.$c$;
comment on function public.hunt_counter_tick(bigint,text,date,bigint,integer) is $c$[hunt] Runs the damage-over-time marks (marks.dot) at the start of the boss turn: hits the other cards, removes ended marks, and returns the damage for the attacking card and the hit list. Internal helper of hunt_attack.$c$;
comment on function public.hunt_counter_hit(bigint,text,date,bigint,integer,boolean) is $c$[hunt] Deals damage to one standing squad card (the shield takes it first unless pierce). Returns {card_id, dmg, hp, max_hp, downed}, or null if the card is down or not in the fight. Internal helper of hunt_counter_act and hunt_counter_tick.$c$;
comment on function public.hunt_counter_cd(bigint,text,date,text,integer,integer) is $c$[hunt] Puts the member's standing support cards (all, or one effect) on cooldown for p_n more rounds. Returns the number of cards. Internal helper of hunt_counter_act.$c$;
comment on function public.hunt_marks_patch(bigint,text,date,jsonb) is $c$[hunt] Merges keys into hunt_combat_state.marks for a member and day. Internal helper of hunt_counter_act, hunt_counter_tick and hunt_support.$c$;
comment on function public.hunt_mark_on(jsonb,text,integer) is $c$[hunt] True when the mark p_key acts in the round (marks.key.until >= round). Internal helper of hunt_attack and hunt_support.$c$;

-- ============================================================ Combat rules (shared by the Hunt and the Dungeon)

comment on function public.card_combat(text,integer,numeric,jsonb) is $c$[combat] The combat stats of one card copy from rarity, stars, cp_mod and stat points: {on, cp, hp, crit, potency, haste, free}. With the stat-point flag off (stat_cfg): cp and hp with no point bonuses. Used by hunt_attack, hunt_support, play_card_effect, card_powers and the Dungeon.$c$;
comment on function public.card_max_hp(integer) is $c$[combat] The card HP for a combat power. The floor and the HP per CP are in balance key card_hp. card_max_hp(0) = the floor, the support card HP. Internal helper of card_combat, hunt_support and the Dungeon and Gauntlet.$c$;
comment on function public.combat_hit(integer,numeric,numeric,numeric,numeric,numeric,numeric,text,numeric,numeric,boolean,numeric,bigint,bigint) is $c$[combat] One attack roll: miss, crit or block, then the damage from CP, weak and synergy multipliers, buffs, armored, expose, execute and rampage. Returns {dmg, outcome, miss, crit, block, double}. Internal helper of hunt_attack and dungeon_attack.$c$;
comment on function public.combat_weak(jsonb,jsonb,text,text,text,text[],integer) is $c$[combat] Counts the weak and resist matches of a card and returns the damage multiplier {wm, rm, mult}, limited by balance key combat. Internal helper of hunt_attack and dungeon_attack.$c$;
comment on function public.combat_squad(text[],boolean,jsonb,jsonb) is $c$[combat] The squad synergy of a card: the weak-tag stack and the element, origin and trait multipliers, limited by balance key combat (syn_cap). Returns {stack, elem, syn, synmult}. Internal helper of hunt_attack and dungeon_attack.$c$;
comment on function public.combat_crit_chance(boolean,text,numeric,jsonb) is $c$[combat] The crit chance of an attack: the base or weak-point chance in balance key combat, plus focus, plus Precision points under the cap in balance key stat_points. Internal helper of hunt_attack and dungeon_attack.$c$;
comment on function public.combat_miss(boolean) is $c$[combat] The miss chance of an attack, higher against a Shrouded boss. The numbers are in balance keys combat and boss_passives. Internal helper of hunt_attack and dungeon_attack.$c$;
comment on function public.combat_lifesteal(integer,numeric,integer) is $c$[combat] The HP a lifesteal attack heals: damage x amount, capped by a share of the card max HP (balance key combat, lifesteal_cap). Internal helper of hunt_attack and dungeon_attack.$c$;
comment on function public.combat_absorb(integer,integer) is $c$[combat] Takes damage from a shield first. Returns {shield, dmg}: the shield left and the damage that gets through. Internal helper of hunt_attack and dungeon_enemy_turn.$c$;
comment on function public.combat_enemy_act(numeric,numeric,integer,integer,numeric,bigint) is $c$[combat] The usual Hunt boss turn: stunned, charging or Cataclysm by the round cycle, else a weighted draw (strike, slam, drain, stun, enrage, curse, regenerate) from balance key boss_moves. Returns {action, dmg, area, heal}. Internal helper of hunt_attack.$c$;
comment on function public.combat_pool_act(numeric,numeric,integer,integer,numeric,integer,jsonb,boolean) is $c$[combat] An enemy turn drawn from a move pool (weights per move), with the Cataclysm cycle when p_charge. The numbers are in balance key pool_moves. Returns {action, move, dmg, area, heal, hits, dot, guard}. Internal helper of dungeon_enemy_turn.$c$;
comment on function public.combat_enemy_mult(numeric,integer,numeric,integer,integer,boolean,numeric,boolean) is $c$[combat] The enemy damage multiplier for the round: enrage, weaken, Volatile, rage below the HP threshold and Frenzied. The numbers are in balance keys boss_moves and boss_passives. Internal helper of hunt_attack and dungeon_enemy_turn.$c$;
comment on function public.combat_area_roll(numeric,numeric,numeric) is $c$[combat] One random area hit on one card: ATK x area x the roll range x the multiplier, at least 1. Internal helper of hunt_attack, hunt_counter_act and dungeon_enemy_turn.$c$;
comment on function public.combat_burn(numeric) is $c$[combat] The Flaming passive: a chance that the attacking card takes burn damage, else 0. The numbers are in balance key boss_passives. Internal helper of hunt_attack and dungeon_enemy_turn.$c$;
comment on function public.combat_thorns(integer) is $c$[combat] The Thorns passive: the damage that comes back to the attacking card, a share of its damage (balance key boss_passives). Internal helper of hunt_attack and dungeon_enemy_turn.$c$;
comment on function public.combat_regen(bigint) is $c$[combat] The Regenerating passive: the boss heal per turn, a share of the heal base (balance key boss_passives). Internal helper of hunt_attack.$c$;
comment on function public.combat_support_value(text,numeric,numeric,integer) is $c$[combat] The value of a support effect (empower multiplier, shield or heal HP, weaken or expose share, smite damage), with the caps in balance key support. Internal helper of hunt_support and dungeon_support.$c$;
comment on function public.combat_aff_scale(integer) is $c$[combat] The affinity scale of a support: 1 + a step per matching squad card, up to a cap (balance key support). Internal helper of hunt_support and dungeon_support.$c$;
comment on function public.combat_stun_immune(integer,integer) is $c$[combat] True when the enemy cannot be stunned in this round (it was stunned in the last rounds of balance key support, stun_immune_rounds). Internal helper of hunt_support and dungeon_support.$c$;

-- ============================================================ Card effects: functions

comment on function public.play_card_effect(text,bigint,text) is $c$[effects] Plays a card effect on a member: checks ownership, enabled, cooldown, caps, counters and stacking, scales the amount, writes card_plays, card_effect_cooldowns and player_effects or discord_effects. Called by /api/effects/play. Returns {ok, play_id, outcome}.$c$;
comment on function public.play_card_effect_choice(text,bigint,text,integer) is $c$[effects] play_card_effect for a poll card: it passes the sender's question pick (p_choice) to play_card_effect. Called by /api/effects/play when the request has a choice.$c$;
comment on function public.refund_card_play(bigint,text) is $c$[effects] Marks a play refunded (card_plays outcome, refund_reason) and deletes the sender's cooldown for the subject. Called by the bot (discord-effects.ts) when Discord refuses the effect. Returns {ok, player, subject}.$c$;
comment on function public.card_effect_active(text,text) is $c$[effects] True when the member has the effect waiting or active: a player_effects row not used up or ended, or a pending or active discord_effects row. Internal helper of play_card_effect (no stacking, redirect).$c$;
comment on function public.take_player_effect(text,text) is $c$[effects] Uses up the oldest waiting effect of the type for the member and returns its amount, or null if none. An effect whose starts_at is still in the future (a delayed prank) is not used up. Called by hunt_attack (mend, rally, butterfingers) and the bot (lucky_pull).$c$;
comment on function public.use_effect_charge(text,text) is $c$[effects] Uses one charge (options.uses) of the oldest started effect of the type, and uses the row up at the last charge. Returns {amount, options} or null. Internal helper of hunt_attack (launch_party, raid_crasher).$c$;
comment on function public.arm_player_effects(text) is $c$[effects] Starts the screen pranks that wait for the member to open the Activity (options.arm_s), and drops those older than 7 days. Called by /api/effects/me. Returns the number started.$c$;
comment on function public.arm_on_open() is $c$[effects] Trigger player_effects_arm_on_open (before insert on player_effects): a screen prank (googly_eyes, upside_down, rubber_chicken, fog) waits (starts_at infinity) until arm_player_effects starts it.$c$;

-- ===== c-dungeon =====
-- Database documentation: Dungeon Run, Gauntlet, Shards, Shop, achievements.
-- Only COMMENT ON statements. Facts come from the live function text, the constraints and the callers
-- (tcg-activity/server.js, tcg-activity/src/*-routes.js, pg_cron). shard_ledger, dungeon_runs.shards / cards
-- and the functions that already had a correct comment are documented in their own migrations.

-- ============================================================ Dungeon Run and Gauntlet: tables

comment on table public.dungeon_days is $c$[dungeon] One row per game day: the daily dungeon, the same for every member. dungeon_generate writes it on the first view or start of the day. dungeon_start, dungeon_choose, dungeon_attack (the rule boost) and dungeon_view read it.$c$;
comment on column public.dungeon_days.day is $c$The game day (dungeon_day(), America/Denver).$c$;
comment on column public.dungeon_days.name is $c$The dungeon name, a seeded draw from a fixed list in dungeon_generate.$c$;
comment on column public.dungeon_days.rule is $c$The daily rule: one object of dungeon_rules() (name, note and one of types, no_rarity, boost_tag + boost, budget). dungeon_start enforces it.$c$;
comment on column public.dungeon_days.floors is $c$The dungeon: an array of floors, each an array of 5 rooms {type, foes}. Room 1 is a fight, room 5 the floor guardian. The floor count is settings.dungeon floors.$c$;
comment on column public.dungeon_days.created_at is $c$When dungeon_generate made the row.$c$;

comment on table public.dungeon_runs is $c$[dungeon] One row per run: a member, a game day and a mode (unique). dungeon_start or gauntlet_start writes it, the member actions change state, dungeon_settle ends it. The boards, the views and shard_ledger_reconcile read it.$c$;
comment on column public.dungeon_runs.id is $c$Run id. dungeon_log, shard_ledger (ref run) and card_ledger (ref dungeon_run) point at it.$c$;
comment on column public.dungeon_runs.player_id is $c$The member (players.id) who plays the run.$c$;
comment on column public.dungeon_runs.day is $c$The game day the run started (dungeon_day()). A Gauntlet run counts for the week that holds this day.$c$;
comment on column public.dungeon_runs.squad is $c$The 5 card ids of the squad. Daily: the member's own cards, picked at dungeon_start. Gauntlet: the squad of the week (gauntlet_weeks.squad).$c$;
comment on column public.dungeon_runs.state is $c$The live run as jsonb: phase, round, each squad card (hp, cd, buffs), the foes, the offers, the loot (bank = safe, pend = at risk until the floor is cleared) and mode. Only the dungeon functions write it.$c$;
comment on column public.dungeon_runs.floor is $c$The current floor, from 1. The board ranks by floor, then room, then turns.$c$;
comment on column public.dungeon_runs.room is $c$The current room of the floor, 1 to 5 (5 = the guardian).$c$;
comment on column public.dungeon_runs.turns is $c$The attacks made in the run (dungeon_attack adds 1). Fewer turns ranks higher at the same floor and room.$c$;
comment on column public.dungeon_runs.status is $c$active or over (dungeon_runs_status_check). dungeon_settle sets over.$c$;
comment on column public.dungeon_runs.ended_by is $c$Why the run ended (null while active): fell, cleared, retreat or abandoned (an active run of an earlier day). Set by dungeon_settle.$c$;
comment on column public.dungeon_runs.started_at is $c$When the run started.$c$;
comment on column public.dungeon_runs.ended_at is $c$When dungeon_settle ended the run (null while active).$c$;
comment on column public.dungeon_runs.mode is $c$daily (the Dungeon Run) or gauntlet (the weekly Gauntlet), dungeon_runs_mode_check. A member has at most one run of each mode a day.$c$;

comment on table public.dungeon_log is $c$[dungeon] One row per action in a run (start, attack, support, choose, door, next_floor, retreat) with its result. dungeon_log_add writes it. No code reads it: it is the audit trail of a run.$c$;
comment on column public.dungeon_log.run_id is $c$The run (dungeon_runs.id). The rows go when the run row goes.$c$;
comment on column public.dungeon_log.n is $c$The order of the action in the run: 1, 2, 3 ...$c$;
comment on column public.dungeon_log.action is $c$What the member did, as jsonb: kind (start, attack, support, choose, door, next_floor, retreat) and its inputs (card, target, pick).$c$;
comment on column public.dungeon_log.result is $c$What happened, as jsonb: for example damage, the enemy actions, a kill and its loot, or the settled totals.$c$;
comment on column public.dungeon_log.created_at is $c$When the action was recorded.$c$;

comment on table public.dungeon_monsters is $c$[dungeon] The monster catalog: one row per monster type. dungeon.sql and dungeon_v2.sql seed it. dungeon_make_foe reads it to build each foe of a Dungeon or Gauntlet room.$c$;
comment on column public.dungeon_monsters.key is $c$The monster id, for example slime. A foe keeps it as key.$c$;
comment on column public.dungeon_monsters.name is $c$The base name. dungeon_make_foe adds the element and the kind (for example Fire Slime (Elite)).$c$;
comment on column public.dungeon_monsters.model is $c$The 3D model file tcg-activity/public/dungeon/monsters/<model>.glb.$c$;
comment on column public.dungeon_monsters.hp is $c$The HP on floor 1. dungeon_make_foe scales it by floor, room and kind (settings.dungeon hp_growth, room_growth and the kind multipliers).$c$;
comment on column public.dungeon_monsters.atk is $c$The attack on floor 1. dungeon_make_foe scales it by floor and kind (settings.dungeon atk_growth and the kind multipliers).$c$;
comment on column public.dungeon_monsters.tags is $c$The tag slugs of the monster (trait:...). dungeon_make_foe adds the element tag. Card weakness and bonus rules match them.$c$;
comment on column public.dungeon_monsters.moves is $c$The named moves as a jsonb array of {name, kind, w}: kind is a move of the shared combat core (combat_pool_act), w its draw weight.$c$;

comment on table public.dungeon_payouts is $c$[dungeon] One row per paid board: the Dungeon board of a day or the Gauntlet board of a week. dungeon_pay inserts it first, so each board pays once. dungeon_prize_tick reads it to skip paid periods.$c$;
comment on column public.dungeon_payouts.mode is $c$daily (the Dungeon board) or gauntlet (the Gauntlet board), dungeon_payouts_mode_check.$c$;
comment on column public.dungeon_payouts.period is $c$The day of the daily board, or the Sunday that starts the Gauntlet week (gauntlet_week()).$c$;
comment on column public.dungeon_payouts.winners is $c$What dungeon_pay paid, as a jsonb array of {rank, player_id, shards, packs, cards}. The prize table is balance key dungeon_prizes.$c$;
comment on column public.dungeon_payouts.paid_at is $c$When the board was paid. add_card_to_player finds the payout of a prize card by this time.$c$;

comment on table public.gauntlet_weeks is $c$[dungeon] One row per Gauntlet week: one squad and one dungeon for every member. gauntlet_generate writes it on the first view or start of the week. gauntlet_start, gauntlet_view and dungeon_run_floors read it.$c$;
comment on column public.gauntlet_weeks.week is $c$The Sunday that starts the week (gauntlet_week(), America/Denver game days).$c$;
comment on column public.gauntlet_weeks.name is $c$The Gauntlet name, a seeded draw from a fixed list in gauntlet_generate.$c$;
comment on column public.gauntlet_weeks.squad is $c$The 5 card ids every member plays this week: 3 attackers and 2 supports at base level, chosen by gauntlet_squad within the budget.$c$;
comment on column public.gauntlet_weeks.theme is $c$The support affinity tag that the squad is built around, or null when no theme fits.$c$;
comment on column public.gauntlet_weeks.floors is $c$The dungeon of the week, the same shape as dungeon_days.floors (room weights in settings.gauntlet room_weights).$c$;
comment on column public.gauntlet_weeks.created_at is $c$When gauntlet_generate made the row.$c$;

-- ============================================================ Shop: tables

comment on table public.shop_stock is $c$[shop] One row per card slot of the Shop of a day. shop_pick_stock writes the day once. shop_today, buy_shop_item and add_card_to_player (the card ref) read it.$c$;
comment on column public.shop_stock.day is $c$The Shop day (shop_day(), America/Denver).$c$;
comment on column public.shop_stock.slot is $c$The slot number of the day, 1, 2, 3 ... in rarity order (normal, illustrated_rare, secret_rare).$c$;
comment on column public.shop_stock.card_id is $c$The card in the slot: a draw-pool card that was not in the Shop in the cooldown days (balance key shards, cooldown_days).$c$;
comment on column public.shop_stock.rarity is $c$The rarity of the slot: normal, illustrated_rare or secret_rare. The slot count per rarity is balance key shards (stock).$c$;
comment on column public.shop_stock.price is $c$The price in Shards, copied from balance key shards (prices) when the stock was picked. Must be above 0.$c$;

comment on table public.shop_purchases is $c$[shop] One row per Shop purchase: packs, a card of the day or a stat reset. buy_shop_item writes it before its Shards row (ref shop_purchase). shop_today, buy_shop_item and ach_track_values (Shopper) read it.$c$;
comment on column public.shop_purchases.id is $c$Purchase id. The shard_ledger and pack_ledger rows of the purchase point at it (ref shop_purchase).$c$;
comment on column public.shop_purchases.player_id is $c$The member (players.id) who bought.$c$;
comment on column public.shop_purchases.day is $c$The Shop day of the purchase (shop_day()).$c$;
comment on column public.shop_purchases.kind is $c$pack, card or stat_reset (shop_purchases_kind_check).$c$;
comment on column public.shop_purchases.slot is $c$For a card: the shop_stock slot (one purchase per member, day and slot). Null for the other kinds.$c$;
comment on column public.shop_purchases.card_id is $c$For a card: the card bought. For a stat reset: the card whose stat points were reset. Null for packs.$c$;
comment on column public.shop_purchases.qty is $c$The number of packs bought (1 for a card or a stat reset).$c$;
comment on column public.shop_purchases.price is $c$The Shards paid. 0 for the free weekly stat reset.$c$;
comment on column public.shop_purchases.created_at is $c$When the purchase was made.$c$;

-- ============================================================ Achievements: tables

comment on table public.achievement_tracks is $c$[achievements] One row per tiered achievement track (24). achievement_tracks.sql seeds it. achievement_view, claim_achievement_tiers, achievement_gallery and the ach_* helpers read it.$c$;
comment on column public.achievement_tracks.key is $c$The track id, the same key as in the ach_track_values output (for example collector).$c$;
comment on column public.achievement_tracks.ord is $c$The display order.$c$;
comment on column public.achievement_tracks.grp is $c$The group shown in the Activity, for example Collection, Packs, Hunt.$c$;
comment on column public.achievement_tracks.name is $c$The track name shown to members.$c$;
comment on column public.achievement_tracks.tiers is $c$The 5 values to reach Bronze, Silver, Gold, Diamond and Mythic, in the track's own unit (exactly 5).$c$;
comment on column public.achievement_tracks.step is $c$Each Mythic +N tier needs this much more than the previous tier. Null = no tiers after Mythic. Must be above 0.$c$;
comment on column public.achievement_tracks.titles is $c$The 3 titles won at Gold, Diamond and Mythic (exactly 3).$c$;

comment on table public.achievement_switch_map is $c$[achievements] One row per old one-time achievement that a track replaced. achievement_tracks.sql seeds it. claim_achievement refuses these keys while the tracks are on, and ach_tier_paid_before uses them to skip packs already paid.$c$;
comment on column public.achievement_switch_map.old_key is $c$The retired old achievement key (an achievement_claims key).$c$;
comment on column public.achievement_switch_map.track is $c$The track (achievement_tracks.key) that replaces it.$c$;
comment on column public.achievement_switch_map.proves is $c$The track value that a claim of the old key proves, in the track's own unit (0 or more).$c$;
comment on column public.achievement_switch_map.adds is $c$true: the proofs of the claimed old keys of the track add up. false: only the largest proof counts.$c$;

comment on table public.achievement_claims is $c$[achievements] One row per achievement that a member claimed: an old one-time key, a track tier (track:<track>:<tier>) or a tag badge (tag:<season>:<tag>). claim_achievement and claim_achievement_tiers write it. The views, the gallery and the profile read it.$c$;
comment on column public.achievement_claims.player_id is $c$The member (players.id) who claimed.$c$;
comment on column public.achievement_claims.key is $c$The achievement key: an old key (balance key achievement_rewards, badges), track:<track>:<tier>, or tag:<season short>:<tag slug>. One claim per member and key.$c$;
comment on column public.achievement_claims.packs is $c$The packs paid (pack_ledger ref achievement). 0 when an old claim already paid the tier.$c$;
comment on column public.achievement_claims.title is $c$The title won, or null.$c$;
comment on column public.achievement_claims.frame is $c$The frame won (for a track: diamond:<track> or mythic:<track>), or null.$c$;
comment on column public.achievement_claims.claimed_at is $c$When the member claimed.$c$;
comment on column public.achievement_claims.shards is $c$The Shards paid (shard_ledger reason milestone). 0 for old keys and tag badges.$c$;

-- ============================================================ Dungeon Run and Gauntlet: functions

comment on function public.dungeon_cfg() is $c$Internal helper: the Dungeon settings (settings.dungeon) merged with the run rewards (balance key dungeon_rewards). Returns jsonb.$c$;
comment on function public.dungeon_day() is $c$The game day: today's date in America/Denver. Dungeon days, Gauntlet weeks and dailies_tasks use it.$c$;
comment on function public.dungeon_rules() is $c$Internal helper: the list of daily rules that dungeon_generate draws from (allowed types, banned rarity, a tag boost or a smaller budget). Returns a jsonb array.$c$;
comment on function public.dungeon_rand(text) is $c$Internal helper: a seeded number from 0 to 1 from a text key (md5). The same key always gives the same number, so a day or week builds the same dungeon.$c$;
comment on function public.dungeon_pick(jsonb, numeric) is $c$Internal helper: picks a key of a weights object ({key: weight}) with a number from 0 to 1. Used for room types and prize card rarities. Returns the key.$c$;
comment on function public.dungeon_tier(double precision) is $c$Internal helper: turns a number from 0 to 1 into a tier 1 to 5 with the weights balance dungeon_rewards.tier_weights. Used for chest and room-reward tiers.$c$;
comment on function public.dungeon_txt(jsonb) is $c$Internal helper: a jsonb array of strings as text[] (empty for null).$c$;
comment on function public.dungeon_generate(date) is $c$Internal helper: builds the dungeon of a day once (seeded by settings.dungeon salt) and writes dungeon_days. Called by dungeon_start and dungeon_view. Returns the day row as jsonb.$c$;
comment on function public.dungeon_room_foes(text, integer, integer, text) is $c$Internal helper: the foes of one room (1-3 for a fight, 4-5 for a horde, else 1), seeded by the room key. Returns a jsonb array of foes.$c$;
comment on function public.dungeon_make_foe(text, integer, integer, text) is $c$Internal helper: builds one foe from a seeded dungeon_monsters row: element, HP and attack scaled by floor, room and kind, weakness, resistance, passives. Returns the foe as jsonb.$c$;
comment on function public.dungeon_card(text, bigint) is $c$Internal helper: a card that the member owns, with its combat stats (card_combat with the member's ascension and stat points). Null when not owned. Returns jsonb.$c$;
comment on function public.dungeon_card_base(bigint) is $c$Internal helper: a card with its base combat stats (no ascension, no stat points), for the Gauntlet squad. Returns jsonb.$c$;
comment on function public.dungeon_run_card(public.dungeon_runs, bigint) is $c$Internal helper: a squad card of a run. Daily: dungeon_card (the member's copy). Gauntlet: dungeon_card_base when the card is in the squad. Returns jsonb or null.$c$;
comment on function public.dungeon_run_floors(public.dungeon_runs) is $c$Internal helper: the floors of a run, from dungeon_days (daily) or gauntlet_weeks (gauntlet). Returns jsonb.$c$;
comment on function public.dungeon_card_of(text) is $c$Internal helper: a random draw-pool card of a rarity, for loot and prizes. Returns the card id or null.$c$;
comment on function public.dungeon_drop_rarity(integer) is $c$Internal helper: rolls the rarity of a kill drop by floor (balance key dungeon_rewards, loot). Returns normal, illustrated_rare or secret_rare.$c$;
comment on function public.dungeon_chest_rarity(integer) is $c$Internal helper: rolls the rarity of a chest or reward card of a tier 1-5 (balance key dungeon_rewards, chest_rarity). Returns normal, illustrated_rare or secret_rare.$c$;
comment on function public.dungeon_loot(jsonb, integer, bigint) is $c$Internal helper: adds Shards and a card to the at-risk loot (state pend). The Shards stop at the run cap (balance key dungeon_rewards, run_shards_cap). Returns the new state.$c$;
comment on function public.dungeon_offers(jsonb, integer) is $c$Internal helper: draws 3 room rewards to choose from (heal, buff, Shards, card, ward, reset, revive) with tiers. The amounts by tier and the least tiers are in balance dungeon_rewards.offers. The Gauntlet offers no Shards or cards. Returns a jsonb array.$c$;
comment on function public.dungeon_enter(jsonb, jsonb, integer, integer) is $c$Internal helper: moves a run state into a room. A fight room loads its foes, a rest room heals, a choice room offers doors, a treasure room opens a chest (Shards and card chance from balance dungeon_rewards.chest). Returns the new state.$c$;
comment on function public.dungeon_enemy_turn(jsonb, bigint, integer, integer) is $c$Internal helper: the foes' turn after an attack: poison ticks, each living foe acts (combat_pool_act), then thorns and burn hit the attacker. Returns the new state and the actions.$c$;
comment on function public.dungeon_after_kill(public.dungeon_runs, jsonb) is $c$Internal helper: after a foe falls, adds the kill loot (daily only). When the room is cleared it offers rewards, or after the guardian banks the floor loot. Returns the state, Shards, card, cleared.$c$;
comment on function public.dungeon_log_add(bigint, jsonb, jsonb) is $c$Internal helper: writes the next dungeon_log row of a run (action and result).$c$;
comment on function public.dungeon_settle_stale() is $c$Ends every active run of an earlier day as abandoned (dungeon_settle, banked loot only). Called by the pg_cron job dungeon-settle-stale and by dungeon_pay. Returns the count.$c$;
comment on function public.dungeon_start(text, bigint[]) is $c$POST /api/dungeon/start: starts today's daily run with 5 owned cards. Checks the flag, adventure_gate, one run a day, the daily rule and the budget. Writes dungeon_runs and dungeon_log. Returns ok, run and state.$c$;
comment on function public.dungeon_attack(text, bigint, integer, text) is $c$POST /api/dungeon/attack: one squad card attacks a foe on the shared combat core, then the foes act. Settles the run when the squad falls or the dungeon is cleared. Returns the hit, the enemy actions and the state.$c$;
comment on function public.dungeon_support(text, bigint, bigint, integer, text) is $c$POST /api/dungeon/support: a support card uses its ability on an ally or a foe (one support a round, with cooldown). Settles the run when the dungeon is cleared. Returns the effect and the state.$c$;
comment on function public.dungeon_choose(text, integer, text) is $c$POST /api/dungeon/choose: takes a room reward, a door or continue, then enters the next room (or the next floor after floor_done). The dark door odds and its rare chest are in balance dungeon_rewards.door. Writes dungeon_runs and dungeon_log. Returns the pick and the state.$c$;
comment on function public.dungeon_retreat(text, text) is $c$POST /api/dungeon/retreat: ends the run between floors and pays the banked loot (dungeon_settle). Returns ok, floor, room, shards and cards.$c$;
comment on function public.dungeon_board(date, integer) is $c$GET /api/dungeon/board, dungeon_view and dungeon_pay: the daily board of a day (default today) ranked by floor, room, turns, end time. Returns a jsonb array with rank, member and depth.$c$;
comment on function public.dungeon_view(text) is $c$GET /api/dungeon: the member's Dungeon screen. Ends the member's active runs of earlier days, builds today's dungeon, and returns the rule, the budget, the run, the member's cards, the rooms of the floor and the top 3.$c$;
comment on function public.dungeon_prizes_cfg() is $c$Internal helper: settings.dungeon_prizes (the flag and the start day) merged with the prize tables (balance key dungeon_prizes). Returns jsonb.$c$;
comment on function public.dungeon_prize_tick() is $c$Called by the pg_cron job dungeon-prizes each hour: pays each unpaid daily board of the last 7 days and the last finished Gauntlet week (dungeon_pay). Off while settings.dungeon_prizes is off.$c$;

comment on function public.gauntlet_cfg() is $c$Internal helper: the Gauntlet settings (settings.gauntlet: the flag, the budget, the room weights). Returns jsonb.$c$;
comment on function public.gauntlet_week(date) is $c$Internal helper: the Sunday that starts the Gauntlet week of a day. Returns a date.$c$;
comment on function public.gauntlet_pool() is $c$Internal helper: the cards that the Gauntlet squad can use (attackers and support cards, no Event or Promo), with cost, tags and affinity. Called by gauntlet_squad.$c$;
comment on function public.gauntlet_squad(date) is $c$Internal helper: picks the seeded squad of a week (3 attackers and 2 supports, different characters, within the budget, a theme when one fits). Returns {squad, theme, cost} or null.$c$;
comment on function public.gauntlet_generate(date) is $c$Internal helper: builds the Gauntlet of a week once (squad and seeded floors) and writes gauntlet_weeks. Called by gauntlet_start and gauntlet_view. Returns the week row.$c$;
comment on function public.gauntlet_start(text) is $c$POST /api/gauntlet/start: starts today's Gauntlet run with the week's squad. Checks both flags, adventure_gate and one Gauntlet run a day. Writes dungeon_runs (mode gauntlet) and dungeon_log.$c$;
comment on function public.gauntlet_board(date, integer) is $c$GET /api/gauntlet/board, gauntlet_view and dungeon_pay: the Gauntlet board of a week (default this week). Each member's best run of the week counts. Returns a jsonb array with rank and runs.$c$;
comment on function public.gauntlet_view(text) is $c$GET /api/gauntlet: the member's Gauntlet screen. Ends the member's active runs of earlier days, builds the week, and returns the squad, today's run, the member's best rank, the rooms, the top 3 and the prizes.$c$;

-- ============================================================ Shards and Shop: functions

comment on function public.shard_cfg() is $c$The Shard settings: the flag (settings.shards) merged with every Shard number (balance key shards). Called by the Shop functions, convert_dupes, ach_track_values and the Activity (shop-routes.js).$c$;
comment on function public.shop_day() is $c$The Shop day: today's date in America/Denver.$c$;
comment on function public.shop_pick_stock(date) is $c$Internal helper: picks the card stock of a Shop day once (count, prices and cooldown in balance key shards) and writes shop_stock. Called by shop_today and buy_shop_item. Returns the slot count.$c$;
comment on function public.shop_today(text) is $c$GET /api/shop: the Shop of today for the member: balance, pack and reset prices, the free weekly reset, and the stock with a bought flag for each slot. Picks the stock when needed.$c$;
comment on function public.give_shards_gift_all(text, text, integer, text) is $c$Not called by any code or job: an admin tool (shards_dailies_gifts.sql). Puts a one-time Shards gift (a once_ kind) in every member's bell (gift_claims). Returns the rows added.$c$;

-- ============================================================ Achievements: functions

comment on function public.ach_has_element(jsonb) is $c$Internal helper: true when a subject's tags hold an element trait (fire, water, shadow ...). ach_track_values uses it for the Elementalist track.$c$;
comment on function public.ach_tracks_on(text) is $c$Internal helper: true when the tiered tracks are on for the member (settings.achievement_tracks enabled, or the member is in its users list).$c$;
comment on function public.ach_tier_need(text, integer) is $c$Internal helper: the track value needed for a tier: tiers 1-5 from achievement_tracks.tiers, a Mythic +N tier from step. Null when the tier does not exist.$c$;
comment on function public.ach_tier_reward(text, integer) is $c$Internal helper: the reward of a track tier (packs and Shards from balance key achievement_rewards, plus the track's title and frame). Returns jsonb.$c$;
comment on function public.ach_tier_paid_before(text, text, integer) is $c$Internal helper: true when the member's claimed old achievements (achievement_switch_map) already prove a tier 1-5 of the track. Then claim_achievement_tiers pays no packs for it.$c$;
comment on function public.ach_tag_badges(text) is $c$Internal helper: the tag badges of each season (one per origin or type tag) with the subjects needed, the subjects the member owns and the packs (balance key achievement_rewards, tag_badge).$c$;
comment on function public.ach_wish_grant(text, text, bigint, text, bigint) is $c$Internal helper: writes a wish_grants row when a member gives a card that is on the receiver's wishlist. Called by the triggers ach_wish_trade and ach_wish_gift.$c$;
comment on function public.ach_wish_trade() is $c$Trigger function on card_trades (trigger ach_wish_trade): records a wish grant for each traded card that was on the other member's wishlist.$c$;
comment on function public.ach_wish_gift() is $c$Trigger function on gift_claims (trigger ach_wish_gift): records a wish grant when a member gift card was on the receiver's wishlist.$c$;
comment on function public.achievement_view(text) is $c$GET /api/achievements: the member's tracks (value, reached and claimed tiers), tag badges, the count ready to claim and the retired old keys. Returns {enabled: false} while the tracks are off.$c$;
comment on function public.achievement_gallery(text) is $c$GET /api/achievements/gallery: every title and frame of the tracks and tag badges, how to get it, how many members own it and whether the member owns it. Returns jsonb.$c$;

-- ===== d-platform =====
-- Database documentation, part D: members, dailies, notifications, balance and platform.
-- Only COMMENT ON statements. Facts come from the live catalog and the callers in tcg-activity/, tcg-bot/src/
-- and tcg-bot/supabase/*.sql (2026-10-07). The docs in docs/data/ are generated from these comments
-- (card-studio/scripts/gen-data-docs.mjs).

-- ===== players (the table comment and pack_balance, shard_balance are already on live) =====
comment on column public.players.id is $c$The Discord user id of the member (17 to 20 digits). The primary key. Every per-member table links to it.$c$;
comment on column public.players.username is $c$The Discord name of the member. The bot (ensurePlayer) writes it again when it sees the member. The Activity writes it when it makes a missing row.$c$;
comment on column public.players.created_at is $c$When the row was made: the first time the bot, the Activity or a gift saw the member.$c$;
comment on column public.players.first_pack_ping_at is $c$When the bot sent the one first-pack mention to the member (claim_first_pack_ping). Null = not sent. The bot sets it to null again when the channel post fails.$c$;
comment on column public.players.spotlight is $c$Up to 3 card ids (cards.id) that the member shows on the profile (players_spotlight_max3). Empty = automatic. The Activity /api/spotlight sets it, only with cards the member owns.$c$;
comment on column public.players.avatar is $c$The Discord avatar hash of the member (null = the default avatar). The bot (ensurePlayer) and the Activity at login (/api/flags) write it when it changes.$c$;
comment on column public.players.title is $c$The equipped title (null = none). The Activity /api/cosmetics sets it, only to a title in the achievement_claims rows of the member.$c$;
comment on column public.players.frame is $c$The equipped profile frame (null = none). The Activity /api/cosmetics sets it, only to a frame in the achievement_claims rows of the member.$c$;
comment on column public.players.stat_reset_week is $c$The ISO week (America/Denver, IYYY-IW) of the last free stat point reset. reset_stat_points and buy_shop_item write it. card_stats_for and shop_today read it. Null = never.$c$;
comment on column public.players.notify_prefs is $c$The ping settings of the member (bell > Settings): booleans all, plays, trades, raid, packs, playing. The Activity /api/notify-prefs writes it. The bot (ping-prefs.ts) and playing_today read it.$c$;
comment on column public.players.tutorial is $c$The tutorial state: done = the finished steps, seen = the view explainer sets shown, skipped = true when skipped. The Activity /api/tutorial writes it. claim_tutorial_reward reads done.$c$;

-- ===== voice_minutes =====
comment on table public.voice_minutes is $c$One row per member per game day (America/Denver): the voice minutes for the Dailies voice task. add_voice_minutes (the bot, each minute) writes it. dailies_tasks reads it.$c$;
comment on column public.voice_minutes.player_id is $c$The member (players.id).$c$;
comment on column public.voice_minutes.day is $c$The game day (America/Denver).$c$;
comment on column public.voice_minutes.minutes is $c$The minutes counted on that day. Each tick of add_voice_minutes adds 1.$c$;

-- ===== notifications =====
comment on table public.notifications is $c$One row per note in the bell of a member. notify_player (the Activity, the bot, SQL) and claim_tutorial_reward write it. The Activity /api/notifications reads it. prune_old_rows deletes old rows.$c$;
comment on column public.notifications.id is $c$The note id.$c$;
comment on column public.notifications.player_id is $c$The member who gets the note (players.id).$c$;
comment on column public.notifications.kind is $c$The type of note, for example pack_gift, pack_earned, trade_offer, trade_counter, trade_accepted, auction_bid, card_gift. The writer sets it. No check constraint.$c$;
comment on column public.notifications.message is $c$The text that the bell shows.$c$;
comment on column public.notifications.read is $c$True after the member opened the bell (the Activity /api/notifications/read sets all to true).$c$;
comment on column public.notifications.created_at is $c$When the note was made. The bell shows the newest 30.$c$;

-- ===== playing_posts =====
comment on table public.playing_posts is $c$One row per member per game day: the is-playing post of the bot in the notifications channel. The bot (playing-posts.ts) writes and reads it to edit the same post in a session.$c$;
comment on column public.playing_posts.player_id is $c$The member that the post shows (players.id).$c$;
comment on column public.playing_posts.day is $c$The game day (America/Denver) of the post.$c$;
comment on column public.playing_posts.message_id is $c$The Discord message id of the post.$c$;
comment on column public.playing_posts.updated_at is $c$The last edit of the post. The bot uses it to find if a new session can edit the same post.$c$;

-- ===== player_reports =====
comment on table public.player_reports is $c$One row per Bug, Feedback or Idea report that a member sent with the wrench (submit_report, the Activity /api/feedback). The Activity (reports.js) copies each row to a GitHub Issue that does not name the member.$c$;
comment on column public.player_reports.id is $c$The report id. The GitHub Issue says report #id.$c$;
comment on column public.player_reports.player_id is $c$The member who sent it (players.id). It stays in the database only.$c$;
comment on column public.player_reports.kind is $c$bug, feedback or idea (player_reports_kind_check).$c$;
comment on column public.player_reports.body is $c$The report text, 5 to 1500 characters (player_reports_body_check), trimmed by submit_report.$c$;
comment on column public.player_reports.context is $c$Short strings from the client: screen, version, window, error. The Activity (cleanContext) drops all other keys.$c$;
comment on column public.player_reports.created_at is $c$When the member sent it. submit_report counts the reports of one game day for the per-day limit.$c$;
comment on column public.player_reports.issue_number is $c$The GitHub Issue number. Null until the Activity (reports.js syncOnce) made the Issue.$c$;
comment on column public.player_reports.issue_url is $c$The URL of the GitHub Issue. Null until the sync.$c$;
comment on column public.player_reports.synced_at is $c$When the Issue was made. Null = the report waits for the sync.$c$;
comment on column public.player_reports.attempts is $c$The failed sync attempts. The sync stops after 8.$c$;
comment on column public.player_reports.last_error is $c$The error of the last failed sync (at most 300 characters). Null after a good sync.$c$;

-- ===== settings =====
comment on table public.settings is $c$One row per feature flag or config value (key, jsonb). Migrations write most rows. Keys: dailies, dungeon, gauntlet, shards, achievement_tracks, ui_v3 (enabled flags), dungeon_prizes, adventure_gate, reports (per_day limit), hunt_attack_feed, hunt_boss_moves, launch_event_cards, discord_immune (the bot writes it).$c$;
comment on column public.settings.key is $c$The name of the flag or config. The primary key. The SQL functions and the Activity read a row by this name.$c$;
comment on column public.settings.value is $c$The flag or config as jsonb, for example {"enabled": true}. The shape depends on the key.$c$;
comment on column public.settings.updated_at is $c$When the row was made. The writer sets it on a change (the bot sets it for discord_immune). No trigger sets it.$c$;

-- ===== balance =====
comment on table public.balance is $c$One row per game number (key) that changes card power, combat or rewards. The SQL functions read it with balance_get and balance_num. The Activity and the bot read it with a 60 s cache. Triggers check each change and write balance_log.$c$;
comment on column public.balance.key is $c$The name of the number. The primary key. A key cannot be deleted (balance_check), because the game reads it.$c$;
comment on column public.balance.value is $c$The number or the jsonb object of numbers. balance_check refuses a negative number and an update that removes a leaf or changes its type. balance_check_economy checks pulls and daily.$c$;
comment on column public.balance.note is $c$What the value does, in plain words: the unit, the readers and the rules. The docs page docs/data/balance.md shows it.$c$;
comment on column public.balance.updated_at is $c$When the value last changed. balance_check sets it on each update.$c$;
comment on column public.balance.updated_by is $c$Who made the last change: balance_who (the setting balance.by, else the session user). balance_check sets it on each update.$c$;

-- ===== balance_log =====
comment on table public.balance_log is $c$One row per insert or update of a balance row (the balance_log_write trigger). An update that changes neither the value nor the note writes no row. Server only.$c$;
comment on column public.balance_log.id is $c$The log row id.$c$;
comment on column public.balance_log.key is $c$The balance key that changed (balance.key).$c$;
comment on column public.balance_log.op is $c$insert or update (a balance row cannot be deleted).$c$;
comment on column public.balance_log.old_value is $c$The value before the change. Null for an insert.$c$;
comment on column public.balance_log.new_value is $c$The value after the change.$c$;
comment on column public.balance_log.changed_at is $c$When the change was made.$c$;
comment on column public.balance_log.changed_by is $c$Who made the change: balance_who (the setting balance.by, else the session user).$c$;

-- ===== schema_migrations =====
comment on table public.schema_migrations is $c$One row per SQL file applied with card-studio/scripts/apply-sql.mjs. It shows which migrations the database has. A file applied two times has two rows.$c$;
comment on column public.schema_migrations.id is $c$The row id.$c$;
comment on column public.schema_migrations.file is $c$The file name of the migration (no folder), for example balance_table.sql.$c$;
comment on column public.schema_migrations.sha256 is $c$The sha256 of the file text that was applied.$c$;
comment on column public.schema_migrations.applied_at is $c$When apply-sql.mjs applied the file.$c$;

-- ===== balance functions =====
comment on function public.balance_get(text) is $c$Returns the value of one balance key as jsonb. Raises an error for a missing key (fail closed). Internal helper: many SQL functions use it.$c$;
comment on function public.balance_num(text, text[]) is $c$Returns the number at a path in a balance value, for example balance_num('daily', 'cap'). Raises an error when there is no number. Internal helper: many SQL functions use it.$c$;
comment on function public.balance_who() is $c$Returns who changes the balance: the setting balance.by, else the session user. Internal helper of balance_check and balance_log_write.$c$;
comment on function public.balance_leaves(jsonb) is $c$Returns each leaf of a jsonb value: its path, its jsonb type and its number. Internal helper of balance_check.$c$;
comment on function public.balance_check() is $c$Trigger (before insert, update, delete on balance): refuses a delete, a negative number, an update that removes a leaf or changes its type, and a bad stars row. Sets updated_at and updated_by.$c$;
comment on function public.balance_check_economy() is $c$Trigger (before insert, update on balance): the pulls rates must add up to 1, pulls pack_size must be a whole number from 1 to 20, daily streak_cycle must be at least 1.$c$;
comment on function public.balance_log_write() is $c$Trigger (after insert, update on balance): writes a balance_log row with the old value, the new value and balance_who. Writes nothing when the value and the note did not change.$c$;

-- ===== dailies =====
comment on function public.checkin_streak(text, date) is $c$Returns the check-in streak of a member before the given day: the run of days with a checkin claim or a used streak shield. Internal helper of dailies_tasks.$c$;
comment on function public.streak_shield_waiting(text, date) is $c$True when a member missed only yesterday, checked in the day before, and has an unused streak_shield effect. Internal helper of checkin_streak and claim_daily.$c$;
comment on function public.dailies_tasks(text) is $c$Returns the daily tasks of a member today (jsonb array): checkin, chat, hunt, voice, social, and dungeon and gauntlet when their mode is on, with progress, done, claimed and reward. Internal helper of dailies_view and claim_daily.$c$;
comment on function public.dailies_view(text) is $c$Returns the Dailies panel of a member: enabled, paused, day, reset time, daily cap, packs earned today, Shards, and the tasks. The Activity GET /api/dailies and claim_daily call it.$c$;
comment on function public.add_voice_minutes(text[]) is $c$Adds 1 voice minute today to each given member who has a players row. The bot (voice-dailies.ts) calls it each minute. Does nothing while the Dailies are off or earning is paused. Returns the rows changed.$c$;
comment on function public.record_activity(text, date) is $c$Adds 1 to the chat message count of a member on a game day (daily_activity) and returns the new count. The bot calls it for each message.$c$;
comment on function public.claim_first_pack_ping(text) is $c$Sets players.first_pack_ping_at once. Returns true only the first time, so the bot sends the first-pack mention once. The bot (store.ts) calls it.$c$;

-- ===== gifts and notes to members =====
comment on function public.give_gift(text, text, text, integer, text, text) is $c$Puts one pack gift in the bell of a member (a gift_claims row). Returns its id, or null for an amount below 1 or a once-only gift that exists. The bot /givepacks, gift_all_members, gift_packs and welcome_packs call it.$c$;
comment on function public.give_gift_all(text, text, integer, text, text) is $c$Puts the same pack gift in the bell of every member (gift_claims rows). Returns the number of gifts made. The bot /grantall calls it.$c$;
comment on function public.gift_all_members(jsonb, integer, text) is $c$Gives every given server member the one Launch Day gift (give_gift) and makes a players row for a new member. A member who has it is skipped. The bot /grantall everyone calls it. Returns the counts.$c$;
comment on function public.notify_player(text, text, text) is $c$Writes one note in the bell of a member (notifications). The Activity, the bot, dungeon_pay and expire_auctions call it.$c$;
comment on function public.playing_today(text) is $c$Returns the data of the is-playing post for a member today: name, avatar, the playing ping setting, packs opened, Hunt damage and the best new card. The bot (playing-posts.ts) calls it.$c$;
comment on function public.submit_report(text, text, text, jsonb) is $c$Stores a member report (player_reports) after the checks: kind, length 5 to 1500, the member exists, and the per-day limit (settings reports.per_day, default 3). The Activity /api/feedback calls it.$c$;

-- ===== platform =====
comment on function public.bot_work() is $c$Returns one jsonb answer for the bot timers: fx, plays, events, auctions, each true when that part has work. The bot (bot-work.ts) calls it about each 10 s, so idle timers make no other requests.$c$;
comment on function public.prune_old_rows() is $c$Deletes old rows: read notes after 30 days, unread after 90, posted hunt_events after 30, ended discord_effects after 30, cron run details after 14. The pg_cron job prune-old-rows runs it each day. Returns the counts.$c$;
comment on function public.rls_auto_enable() is $c$Event trigger function (the event trigger ensure_rls, at ddl_command_end): turns on row level security for each new table in the public schema.$c$;

notify pgrst, 'reload schema';
