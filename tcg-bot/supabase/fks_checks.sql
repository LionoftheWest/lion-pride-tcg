-- Missing foreign keys and checks (database audit, 2026-10-07). Constraints only: no function changes.
-- Each constraint below was missing on live, and live had 0 rows that break it on 2026-10-07, so each one is
-- added VALID (old rows are checked too). If a row breaks one before this file runs, the file stops and
-- changes nothing: count the bad rows, then decide (NOT VALID or a data fix). Runs more than once with the
-- same result (each constraint is added only when its name is missing).
--
-- 1. Foreign keys. A column that names a member, a card, a Hunt or a bid now must point at a real row.
--    ON DELETE:
--    - the hunt_id columns CASCADE, like the four hunt_id keys that exist (hunt_hits, hunt_card_hp,
--      hunt_squads, hunt_adjustments): the Hunt owns these rows. sim-hunt-balance.mjs deletes a spawned
--      Hunt that already has its 'spawn' hunt_events row.
--    - all others NO ACTION: no function deletes a member, a card or a bid. The manual deletes
--      (pressure_teardown.sql, the test members) delete the child rows first. A card with Hunt, trade or
--      shop history cannot be deleted (combat_actions.card_id, card_plays.card_id and auctions.card_id
--      already work this way).
--    Not added, with the reason:
--    - pack_ledger.granted_by, gift_claims.from_id: the bot writes the Discord id of the admin who ran
--      /givepacks or /grantall. An admin who never opened the game has no players row.
--    - combat_actions.ref_id, wish_grants.ref_id, the ledgers' ref_id: the parent table depends on
--      mode / source / ref_kind. A foreign key cannot follow it.
--    - array columns (hunt_squads.card_ids, auction_bids.cards, auctions.min_cards, dungeon_runs.squad,
--      dungeon_runs.cards): a foreign key cannot check an array.
--    - artist_submissions.submitted_by / reviewed_by: the table is not used (0 rows, no writer).
--    - achievement_claims.key: a tier key (for example 'packs3'), not an achievement_tracks key.
-- 2. Checks on status / kind text columns: the values that the writer functions use (the live text).
--    Not added: notifications.kind, gift_claims.kind, player_cards.first_source and the ledgers' ref_kind
--    (an open list that the bot, the Activity or an admin command extends).
-- 3. Checks on amounts that must never be negative (or zero, for a ledger move or a quantity).
-- 4. NOT in this file: pack_ledger_ref_check (a pack move must have ref_kind + ref_id, the shard_ledger
--    rule; card_ledger.ref_kind / ref_id are already NOT NULL). Live has 0 pack rows without a ref and every
--    live writer passes one, but 17 local SQL tests still write pack rows without a ref (raw inserts, or an
--    old migration file that they run again with its pre-ref function text). Those tests must change first.

do $fk$
declare x text[];
begin
  foreach x slice 1 in array array[
  -- 1. Foreign keys --------------------------------------------------------------------------------
    -- the trade ledger: both members of a finished trade or auction
    ['card_trades', 'card_trades_from_id_fkey', 'foreign key (from_id) references public.players(id)'],
    ['card_trades', 'card_trades_to_id_fkey', 'foreign key (to_id) references public.players(id)'],
    -- the bid that the seller accepted
    ['auctions', 'auctions_accepted_bid_id_fkey', 'foreign key (accepted_bid_id) references public.auction_bids(id)'],
    -- the Hunt tables: the Hunt, the member and the card of each row
    ['hunt_card_hp', 'hunt_card_hp_player_id_fkey', 'foreign key (player_id) references public.players(id)'],
    ['hunt_card_hp', 'hunt_card_hp_card_id_fkey', 'foreign key (card_id) references public.cards(id)'],
    ['hunt_combat_log', 'hunt_combat_log_hunt_id_fkey', 'foreign key (hunt_id) references public.hunts(id) on delete cascade'],
    ['hunt_combat_log', 'hunt_combat_log_player_id_fkey', 'foreign key (player_id) references public.players(id)'],
    ['hunt_combat_log', 'hunt_combat_log_card_id_fkey', 'foreign key (card_id) references public.cards(id)'],
    ['hunt_combat_state', 'hunt_combat_state_hunt_id_fkey', 'foreign key (hunt_id) references public.hunts(id) on delete cascade'],
    ['hunt_combat_state', 'hunt_combat_state_player_id_fkey', 'foreign key (player_id) references public.players(id)'],
    ['hunt_events', 'hunt_events_hunt_id_fkey', 'foreign key (hunt_id) references public.hunts(id) on delete cascade'],
    ['hunt_hits', 'hunt_hits_player_id_fkey', 'foreign key (player_id) references public.players(id)'],
    ['hunt_hits', 'hunt_hits_card_id_fkey', 'foreign key (card_id) references public.cards(id)'],
    -- the card of a shop purchase, a granted wish and the ally of a support play
    ['shop_purchases', 'shop_purchases_card_id_fkey', 'foreign key (card_id) references public.cards(id)'],
    ['wish_grants', 'wish_grants_card_id_fkey', 'foreign key (card_id) references public.cards(id)'],
    ['combat_actions', 'combat_actions_target_card_fkey', 'foreign key (target_card) references public.cards(id)'],
  -- 2. status / kind checks (the writer of each list is named) -------------------------------------
    -- spawn_hunt inserts 'active' (the default); hunt_attack / hunt_support set 'defeated'; close_hunt sets 'expired'
    ['hunts', 'hunts_status_check', $$check (status in ('active', 'defeated', 'expired'))$$],
    -- spawn_hunt refuses any other tier
    ['hunts', 'hunts_tier_check', $$check (tier in ('Normal', 'Heroic', 'Mythic'))$$],
    -- 'pending' (default), counter_trade 'countered', accept_trade 'accepted', set_trade_status 'declined' / 'cancelled'
    ['trade_offers', 'trade_offers_status_check', $$check (status in ('pending', 'countered', 'accepted', 'declined', 'cancelled'))$$],
    -- combat_hit returns one of these four (hunt_attack writes it)
    ['hunt_combat_log', 'hunt_combat_log_outcome_check', $$check (outcome in ('hit', 'crit', 'blocked', 'miss'))$$],
    -- the 8 inserts: spawn_weekly_boss, hunt_attack, hunt_support, daily_raid_board, nudge_hunt, close_hunt
    ['hunt_events', 'hunt_events_kind_check', $$check (kind in ('spawn', 'attack', 'player_done', 'defeat', 'expired', 'nudge', 'leaderboard'))$$],
    -- play_card_effect copies effect_primitives.kind (effect_primitives_kind_check has the same list)
    ['card_plays', 'card_plays_kind_check', $$check (kind in ('boon', 'prank', 'neutral'))$$],
    -- the rarity text copies cards.rarity (the enum card_rarity); start_auction refuses any other min_rarity
    ['card_plays', 'card_plays_rarity_check', $$check (rarity in ('normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold', 'promo', 'event'))$$],
    ['shop_stock', 'shop_stock_rarity_check', $$check (rarity in ('normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold', 'promo', 'event'))$$],
    ['auctions', 'auctions_min_rarity_check', $$check (min_rarity in ('normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold', 'promo', 'event'))$$],
    -- dungeon_settle: 'cleared', 'fell', 'retreat', 'abandoned' (null while the run is active)
    ['dungeon_runs', 'dungeon_runs_ended_by_check', $$check (ended_by in ('cleared', 'fell', 'retreat', 'abandoned'))$$],
    -- balance_log_write runs AFTER INSERT OR UPDATE: lower(tg_op)
    ['balance_log', 'balance_log_op_check', $$check (op in ('insert', 'update'))$$],
    -- claim_daily refuses any other task; claim_daily_earn writes 'chat' and 'chat_bonus'
    ['daily_claims', 'daily_claims_task_check', $$check (task in ('checkin', 'hunt', 'voice', 'social', 'dungeon', 'gauntlet', 'chat', 'chat_bonus'))$$],
    -- the five card types (backfill-types.mjs, docs/design.md); null = not typed yet
    ['subjects', 'subjects_type_check', $$check (type in ('Character', 'Creature', 'Item', 'Place', 'Moment'))$$],
  -- 3. amount checks ------------------------------------------------------------------------------
    -- a ledger row moves something (grant_packs / grant_shards skip 0; card_ledger_amount_check is the same rule)
    ['pack_ledger', 'pack_ledger_amount_check', 'check (amount <> 0)'],
    ['shard_ledger', 'shard_ledger_amount_check', 'check (amount <> 0)'],
    ['shop_purchases', 'shop_purchases_qty_check', 'check (qty > 0)'],
    ['shop_purchases', 'shop_purchases_price_check', 'check (price >= 0)'],
    ['daily_claims', 'daily_claims_amount_check', 'check (amount >= 0)'],
    ['voice_minutes', 'voice_minutes_minutes_check', 'check (minutes >= 0)'],
    ['daily_activity', 'daily_activity_message_count_check', 'check (message_count >= 0)'],
    ['achievement_claims', 'achievement_claims_amount_check', 'check (packs >= 0 and shards >= 0)'],
    ['player_cards', 'player_cards_ascension_check', 'check (ascension >= 0)'],
    ['dungeon_runs', 'dungeon_runs_shards_check', 'check (shards >= 0)'],
    -- damage and HP: every writer clamps with greatest(0, ...) or least(max, ...)
    ['hunt_hits', 'hunt_hits_damage_check', 'check (damage >= 0)'],
    ['hunt_combat_log', 'hunt_combat_log_damage_check', 'check (damage >= 0 and counter_dmg >= 0)'],
    ['hunts', 'hunts_hp_check', 'check (hp_max > 0 and hp_remaining >= 0)'],
    ['hunt_card_hp', 'hunt_card_hp_hp_check', 'check (max_hp > 0 and hp_remaining >= 0 and shield >= 0)']
  ] loop
    if not exists (select 1 from pg_constraint where conrelid = ('public.' || x[1])::regclass and conname = x[2]) then
      execute format('alter table public.%I add constraint %I %s', x[1], x[2], x[3]);
    end if;
  end loop;
end $fk$;

-- The one new index: deleting a Hunt cascades to hunt_events, which had no index on hunt_id. The other new
-- foreign key columns have an index that starts with the column, or their parent (a member, a card, a bid)
-- is never deleted by a function.
create index if not exists hunt_events_hunt_id_idx on public.hunt_events (hunt_id);

notify pgrst, 'reload schema';
