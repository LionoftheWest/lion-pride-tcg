-- Achievement rewards (Nathan, 2026-09-27: "a redeem reward on achievements that have
-- been completed", with a variety of rewards). The Activity server checks that the
-- achievement is complete (tcg-activity/src/achievements.js, the same rules the
-- player sees), then calls claim_achievement, which records the claim ONCE and
-- grants its packs in the same transaction. Titles and avatar frames are cosmetics:
-- a claimed one can be equipped on the profile (players.title / players.frame).

create table if not exists achievement_claims (
  player_id  text not null references players (id) on delete cascade,
  key        text not null,
  packs      int  not null default 0,
  title      text,
  frame      text,
  claimed_at timestamptz not null default now(),
  primary key (player_id, key)
);
alter table achievement_claims enable row level security;

alter table players add column if not exists title text;
alter table players add column if not exists frame text;

-- Returns { ok, balance } on the first claim, { ok:false, error:'claimed' } after.
create or replace function claim_achievement(p_player text, p_key text, p_packs int, p_title text, p_frame text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare inserted int; bal int;
begin
  if p_packs < 0 or p_packs > 10 then return jsonb_build_object('ok', false, 'error', 'bad_reward'); end if;
  insert into achievement_claims (player_id, key, packs, title, frame)
    values (p_player, p_key, p_packs, p_title, p_frame)
    on conflict (player_id, key) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if p_packs > 0 then
    bal := grant_packs(p_player, p_packs, 'achievement', p_key);
    if bal is null then raise exception 'unknown player %', p_player; end if; -- rolls the claim back
  end if;
  return jsonb_build_object('ok', true, 'balance', bal);
end; $$;

notify pgrst, 'reload schema';
