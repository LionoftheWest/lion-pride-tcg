-- Player-to-player pack gifting: move packs from one balance to another,
-- atomically, logging both sides. Idempotent (create or replace).

create or replace function gift_packs(p_from text, p_to text, p_amount int)
returns boolean language plpgsql security invoker set search_path = public as $$
declare moved boolean := false;
begin
  if p_amount < 1 or p_from = p_to then
    return false;
  end if;
  -- The recipient must be a real player.
  perform 1 from players where id = p_to;
  if not found then
    return false;
  end if;
  -- Take from the sender only if they actually have enough (atomic guard).
  update players set pack_balance = pack_balance - p_amount
    where id = p_from and pack_balance >= p_amount
    returning true into moved;
  if not moved then
    return false;
  end if;
  update players set pack_balance = pack_balance + p_amount where id = p_to;
  insert into pack_ledger (player_id, amount, reason, granted_by) values
    (p_from, -p_amount, 'gift_sent', p_to),
    (p_to, p_amount, 'gift_received', p_from);
  return true;
end; $$;

notify pgrst, 'reload schema';
