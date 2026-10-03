-- Convert extras: keep 1 copy (Nathan, 2026-10-02, option B).
-- The first rule (shards_shop.sql) also kept every copy that the next ascension stars still need:
-- a Normal needed 45 copies before one converted, and on the live data 0 of 43 members could
-- convert anything. Now every FREE copy above 1 can convert; the member chooses between
-- ascension and Shards. Held copies (trade offers, an auction, bids) still never convert, and
-- convert_dupes still refuses rarities with no value (Event, Promo).
-- Test: card-studio/scripts/test-shards-convert.mjs. Idempotent.
create or replace function public.convertible_copies(p_player text, p_card bigint)
returns integer language sql stable set search_path = public as $$
  select greatest(0, free_copies(p_player, p_card) - 1);
$$;

notify pgrst, 'reload schema';
