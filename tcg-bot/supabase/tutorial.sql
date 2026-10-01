-- The first-time walkthrough (Nathan, 2026-09-30; designs 21 + 22). players.tutorial holds the
-- progress: {"done": ["open", ...], "skipped": true|false}. Finishing all 7 steps pays 1 pack
-- ONCE (reason 'tutorial': an outside pack, it never counts toward the 5 activity packs).
-- Replaying the tutorial clears "done" and "skipped" but never pays again.
alter table public.players add column if not exists tutorial jsonb not null default '{}'::jsonb;

create or replace function public.claim_tutorial_reward(p_player text) returns jsonb
language plpgsql set search_path = public as $$
declare t jsonb; bal int;
  steps text[] := array['open', 'rarity', 'collection', 'hunt', 'community', 'dailies', 'voice'];
begin
  select tutorial into t from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  if exists (select 1 from pack_ledger where player_id = p_player and reason = 'tutorial') then
    return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if exists (select 1 from unnest(steps) s where not coalesce(t->'done', '[]'::jsonb) ? s) then
    return jsonb_build_object('ok', false, 'error', 'not_done'); end if;
  bal := grant_packs(p_player, 1, 'tutorial', null);
  insert into notifications (player_id, kind, message) values (p_player, 'pack_gift', '🎁 Tutorial complete! Here is 1 free pack.');
  return jsonb_build_object('ok', true, 'packs', 1, 'balance', bal);
end $$;
revoke all on function public.claim_tutorial_reward(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
