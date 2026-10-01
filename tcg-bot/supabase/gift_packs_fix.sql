-- SECURITY FIX (2026-10-01): a member could gift packs they did not have. In gift_packs,
-- UPDATE ... RETURNING true INTO moved sets moved to NULL when the sender has too few packs,
-- and IF NOT moved is NULL (not true), so the "return false" never ran: the recipient got the
-- packs and the sender paid nothing (a live check: 0 packs, gift 50 -> the friend had 50).
-- Fixed: moved IS NOT TRUE. The gift behaves as before otherwise.
create or replace function public.gift_packs(p_from text, p_to text, p_amount integer)
 returns boolean language plpgsql set search_path to 'public' as $$
declare moved boolean := false;
begin
  if p_amount is null or p_amount < 1 or p_from = p_to then return false; end if;
  perform 1 from players where id = p_to;
  if not found then return false; end if;
  update players set pack_balance = pack_balance - p_amount
    where id = p_from and pack_balance >= p_amount
    returning true into moved;
  if moved is not true then return false; end if;
  update players set pack_balance = pack_balance + p_amount where id = p_to;
  insert into pack_ledger (player_id, amount, reason, granted_by) values
    (p_from, -p_amount, 'gift_sent', p_to),
    (p_to, p_amount, 'gift_received', p_from);
  return true;
end $$;

notify pgrst, 'reload schema';
