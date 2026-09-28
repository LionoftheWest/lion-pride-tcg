-- Open up to 10 packs in ONE database call (the pressure test, 2026-09-28). A 10x open
-- was 20 REST calls (spend_pack + add_cards_to_player for each pack). With 100 players
-- opening 10 at once, an open waited 38 s, and 192 s under the full load, because
-- Supabase gives ~60 REST calls/s in total.
-- The bot draws the cards (p_cards = the packs in order, p_size cards each). This spends
-- one pack per pack, like spend_pack, stops when the balance runs out, and adds the cards
-- of the packs it spent. Returns the number of packs spent.
create or replace function public.open_packs(p_player_id text, p_cards bigint[], p_size int)
returns int
language plpgsql
set search_path = public
as $$
declare v_want int; v_have int; v_n int;
begin
  v_want := coalesce(array_length(p_cards, 1), 0) / greatest(1, p_size);
  if v_want < 1 or v_want > 10 then return 0; end if;
  -- The row lock makes concurrent opens of one player wait, so the balance never goes below 0.
  select pack_balance into v_have from players where id = p_player_id for update;
  v_n := least(coalesce(v_have, 0), v_want);
  if v_n <= 0 then return 0; end if;
  update players set pack_balance = pack_balance - v_n where id = p_player_id;
  insert into pack_ledger (player_id, amount, reason)
    select p_player_id, -1, 'opened' from generate_series(1, v_n);
  perform add_cards_to_player(p_player_id, p_cards[1 : v_n * p_size]);
  return v_n;
end $$;

revoke all on function public.open_packs(text, bigint[], int) from public, anon, authenticated;

notify pgrst, 'reload schema';
