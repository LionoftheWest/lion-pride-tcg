-- combat_v2_progress_spend.sql (2026-10-23): combat v2 step M1c, a player spends and resets the v2 points of a card
-- (docs/combat-redesign-plan.md 2.2 to 2.4, 11, 20.11 and 20.13 "M1c as built"). Needs combat_v2_progress_tables.sql (M1a: card_progress_v2,
-- card_progress_v2_log), combat_v2_progress_math.sql (M1b: card_combat_v2 with bonus_points), combat_v2_testers.sql (combat_v2_on with a
-- player) and stat_reset_gift.sql (the table stat_reset_gifts).
-- Before: nothing writes the v2 points of a card (card_progress_v2 is empty and has no writer).
-- After this file (the shape of the v1 paths spend_stat_points, reset_stat_points and stat_reset_gift_use, which do NOT change):
--   spend_card_points_v2(player, card, add): add = {stat: count} for the 9 v2 stats (atk, def, hp, crd, crt, abl, ddg, acc, spd), each count
--     a whole number 1 to 99. Every check runs before any write, and each refusal is an answer {ok: false, error}, never a raised error:
--     disabled (combat_v2_on('progress', player) is false), bad_request, bad_stat, bad_amount, not_owned (no player_cards row with
--     quantity > 0), no_progress (no card_progress_v2 row), no_role (the subject has no ability_v2 role: card_combat_v2 cannot give the
--     stat line), stat_cap (a stat above v2_stats.max_per_stat), not_enough (more than level x v2_level.points_per_level + bonus_points;
--     with free). Then, with the progress row locked: the ledger FIRST (reason spend, one row for each stat, d_points > 0, one ref
--     'spend:<n>' for the call from card_progress_v2_ref_seq), then the progress row (plan 20.11 open item 7).
--     Answer: {ok: true, progress: {level, xp, bonus, points: {the 9 keys}, free}, stats: card_combat_v2 (the role of subjects.ability_v2)}.
--   reset_card_points_v2(player, card): the 9 point columns to 0; the level, the XP and bonus_points do not change. Refusals: disabled,
--     no_player, not_owned, no_progress, no_role, nothing_spent, reset_used (with next). The free reset: the weekly one first (one for
--     each Mountain ISO week for each player, the same marker players.stat_reset_week as v1), then one open v2 gift
--     (stat_reset_gift_use_v2). The ledger first: reason reset, one row for each stat above 0, d_points = minus the count, one ref
--     'reset:<n>'. Answer: the same shape as the spend, and used = 'week' or 'gift'.
--   stat_reset_gift_use_v2(player, card): the v1 stat_reset_gift_use for the gifts whose key starts with 'v2_' only (the earliest deadline
--     first). A v1 gift (for example r_s1_2026_10) is never taken. The v1 stat_reset_gift_use does not change here: it still takes any
--     open gift, also a 'v2_' gift (M1d makes it skip them; no 'v2_' gift exists before M1h).
--   card_progress_v2_ref_seq: the number of each spend and reset call (a ref is never used twice).
-- Every limit comes from balance (v2_stats.max_per_stat, v2_level.points_per_level; the stat line from the keys of card_combat_v2). No
-- number in this file (CI check C1). NO CHANGE IN PLAY: no v1 function changes and no other function calls these; the flag
-- combat_v2.progress stays false (so both functions answer disabled for every player who is not a tester). Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-progress-spend.mjs (rolled back; MUTATE=all must catch every mutation).

-- ============================================================ 1. the number of each call (the ref of its ledger rows)
create sequence if not exists public.card_progress_v2_ref_seq as bigint;
revoke all on sequence public.card_progress_v2_ref_seq from public, anon, authenticated;
grant usage, select, update on sequence public.card_progress_v2_ref_seq to service_role;

-- ============================================================ 2. the progress answer (shared by the spend and the reset)
create or replace function public.card_progress_v2_view(p_player text, p_card bigint) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare r public.card_progress_v2%rowtype; v_rar text; v_asc int; v_mod numeric; v_role text; v_pts jsonb; v_spent int;
begin
  select * into r from card_progress_v2 where player_id = p_player and card_id = p_card;
  if not found then raise exception 'card_progress_v2_view: no card_progress_v2 row for this player and card'; end if;
  select c.rarity::text, pc.ascension, s.cp_mod, s.ability_v2->>'role' into v_rar, v_asc, v_mod, v_role
    from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
   where pc.player_id = p_player and pc.card_id = p_card;
  v_pts := jsonb_build_object('atk', r.atk_pts, 'def', r.def_pts, 'hp', r.hp_pts, 'crd', r.crd_pts, 'crt', r.crt_pts,
                              'abl', r.abl_pts, 'ddg', r.ddg_pts, 'acc', r.acc_pts, 'spd', r.spd_pts);
  v_spent := r.atk_pts + r.def_pts + r.hp_pts + r.crd_pts + r.crt_pts + r.abl_pts + r.ddg_pts + r.acc_pts + r.spd_pts;
  return jsonb_build_object(
    'progress', jsonb_build_object('level', r.level, 'xp', r.xp, 'bonus', r.bonus_points, 'points', v_pts,
      'free', r.level * balance_num('v2_level', 'points_per_level')::int + r.bonus_points - v_spent),
    -- the same source as card_power_v2: card_combat_v2 with the rarity, the stars, cp_mod and the role of subjects.ability_v2
    'stats', card_combat_v2(v_rar, v_asc, v_mod, r.level, v_pts, v_role,
      combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed']), r.bonus_points));
end $fn$;

-- ============================================================ 3. spend
create or replace function public.spend_card_points_v2(p_player text, p_card bigint, p_add jsonb) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  k text; v jsonb; r public.card_progress_v2%rowtype; v_role text; v_cap int; v_ppl int; v_add int := 0; v_spent int; v_ref text; v_n int;
begin
  if not combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if p_add is null or jsonb_typeof(p_add) <> 'object' or p_add = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'bad_request'); end if;
  for k, v in select * from jsonb_each(p_add) loop
    if k not in ('atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd') then
      return jsonb_build_object('ok', false, 'error', 'bad_stat', 'stat', k); end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[1-9][0-9]?$' then
      return jsonb_build_object('ok', false, 'error', 'bad_amount', 'stat', k); end if;
    v_add := v_add + (v #>> '{}')::int;
  end loop;
  if not exists (select 1 from player_cards where player_id = p_player and card_id = p_card and quantity > 0) then
    return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  select * into r from card_progress_v2 where player_id = p_player and card_id = p_card for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_progress'); end if;
  select s.ability_v2->>'role' into v_role from cards c left join subjects s on s.id = c.subject_id where c.id = p_card;
  if v_role is null or not exists (select 1 from roles where key = v_role) then
    return jsonb_build_object('ok', false, 'error', 'no_role'); end if;
  v_cap := balance_num('v2_stats', 'max_per_stat')::int;
  v_ppl := balance_num('v2_level', 'points_per_level')::int;
  if r.atk_pts + coalesce((p_add->>'atk')::int, 0) > v_cap or r.def_pts + coalesce((p_add->>'def')::int, 0) > v_cap
     or r.hp_pts + coalesce((p_add->>'hp')::int, 0) > v_cap or r.crd_pts + coalesce((p_add->>'crd')::int, 0) > v_cap
     or r.crt_pts + coalesce((p_add->>'crt')::int, 0) > v_cap or r.abl_pts + coalesce((p_add->>'abl')::int, 0) > v_cap
     or r.ddg_pts + coalesce((p_add->>'ddg')::int, 0) > v_cap or r.acc_pts + coalesce((p_add->>'acc')::int, 0) > v_cap
     or r.spd_pts + coalesce((p_add->>'spd')::int, 0) > v_cap then
    return jsonb_build_object('ok', false, 'error', 'stat_cap', 'cap', v_cap); end if;
  v_spent := r.atk_pts + r.def_pts + r.hp_pts + r.crd_pts + r.crt_pts + r.abl_pts + r.ddg_pts + r.acc_pts + r.spd_pts;
  if v_spent + v_add > r.level * v_ppl + r.bonus_points then
    return jsonb_build_object('ok', false, 'error', 'not_enough', 'free', r.level * v_ppl + r.bonus_points - v_spent); end if;
  -- the ledger FIRST (plan 20.11 open item 7): one row for each stat, one ref for the call. A ref is never used twice, so the insert
  -- adds every row or raises (and then nothing changes). The progress row changes only after it.
  v_ref := 'spend:' || nextval('public.card_progress_v2_ref_seq');
  insert into card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_points)
  select r.id, p_player, p_card, 'spend', x.key, v_ref, (x.value #>> '{}')::int from jsonb_each(p_add) x;
  get diagnostics v_n = row_count;
  if v_n <> (select count(*) from jsonb_object_keys(p_add)) then
    raise exception 'spend_card_points_v2: the ledger took % of % rows', v_n, (select count(*) from jsonb_object_keys(p_add)); end if;
  update card_progress_v2 set
    atk_pts = atk_pts + coalesce((p_add->>'atk')::int, 0), def_pts = def_pts + coalesce((p_add->>'def')::int, 0),
    hp_pts = hp_pts + coalesce((p_add->>'hp')::int, 0), crd_pts = crd_pts + coalesce((p_add->>'crd')::int, 0),
    crt_pts = crt_pts + coalesce((p_add->>'crt')::int, 0), abl_pts = abl_pts + coalesce((p_add->>'abl')::int, 0),
    ddg_pts = ddg_pts + coalesce((p_add->>'ddg')::int, 0), acc_pts = acc_pts + coalesce((p_add->>'acc')::int, 0),
    spd_pts = spd_pts + coalesce((p_add->>'spd')::int, 0)
   where id = r.id;
  return jsonb_build_object('ok', true) || card_progress_v2_view(p_player, p_card);
end $fn$;

-- ============================================================ 4. the v2 gift reset
create or replace function public.stat_reset_gift_use_v2(p_player text, p_card bigint) returns boolean
language plpgsql set search_path = public as $fn$
begin
  with g as (
    select gift from stat_reset_gifts
     where player_id = p_player and starts_with(gift, 'v2_') and used_at is null and expires_at > now()
     order by expires_at, gift limit 1 for update)
  update stat_reset_gifts s set used_at = now(), used_card = p_card from g where s.player_id = p_player and s.gift = g.gift;
  return found;
end $fn$;

-- ============================================================ 5. reset
create or replace function public.reset_card_points_v2(p_player text, p_card bigint) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW'); v_used text; v_how text;
  r public.card_progress_v2%rowtype; v_role text; v_ref text; v_n int; v_want int;
begin
  if not combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  -- the lock order of v1 (reset_stat_points): the player row, then the card
  select stat_reset_week into v_used from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  if not exists (select 1 from player_cards where player_id = p_player and card_id = p_card and quantity > 0) then
    return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  select * into r from card_progress_v2 where player_id = p_player and card_id = p_card for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_progress'); end if;
  select s.ability_v2->>'role' into v_role from cards c left join subjects s on s.id = c.subject_id where c.id = p_card;
  if v_role is null or not exists (select 1 from roles where key = v_role) then
    return jsonb_build_object('ok', false, 'error', 'no_role'); end if;
  v_want := (r.atk_pts > 0)::int + (r.def_pts > 0)::int + (r.hp_pts > 0)::int + (r.crd_pts > 0)::int + (r.crt_pts > 0)::int
          + (r.abl_pts > 0)::int + (r.ddg_pts > 0)::int + (r.acc_pts > 0)::int + (r.spd_pts > 0)::int;
  if v_want = 0 then return jsonb_build_object('ok', false, 'error', 'nothing_spent'); end if;
  -- the free reset: the weekly one (the v1 marker), else one open v2 gift. A nested if: the gift is taken only when the week is used.
  if v_used is distinct from v_week then
    v_how := 'week';
  else
    if not stat_reset_gift_use_v2(p_player, p_card) then
      return jsonb_build_object('ok', false, 'error', 'reset_used',
        'next', (date_trunc('week', now() at time zone 'America/Denver') + interval '7 days') at time zone 'America/Denver'); end if;
    v_how := 'gift';
  end if;
  -- the ledger FIRST: one row for each stat above 0, d_points = minus the count, one ref for the call
  v_ref := 'reset:' || nextval('public.card_progress_v2_ref_seq');
  insert into card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_points)
  select r.id, p_player, p_card, 'reset', x.stat, v_ref, -x.n
    from (values ('atk', r.atk_pts), ('def', r.def_pts), ('hp', r.hp_pts), ('crd', r.crd_pts), ('crt', r.crt_pts),
                 ('abl', r.abl_pts), ('ddg', r.ddg_pts), ('acc', r.acc_pts), ('spd', r.spd_pts)) x(stat, n)
   where x.n > 0;
  get diagnostics v_n = row_count;
  if v_n <> v_want then raise exception 'reset_card_points_v2: the ledger took % of % rows', v_n, v_want; end if;
  update card_progress_v2 set atk_pts = 0, def_pts = 0, hp_pts = 0, crd_pts = 0, crt_pts = 0, abl_pts = 0, ddg_pts = 0, acc_pts = 0, spd_pts = 0
   where id = r.id;
  if v_how = 'week' then update players set stat_reset_week = v_week where id = p_player; end if;
  return jsonb_build_object('ok', true, 'used', v_how) || card_progress_v2_view(p_player, p_card);
end $fn$;

-- ============================================================ 6. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['card_progress_v2_view(text, bigint)', 'spend_card_points_v2(text, bigint, jsonb)', 'stat_reset_gift_use_v2(text, bigint)',
                           'reset_card_points_v2(text, bigint)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on sequence public.card_progress_v2_ref_seq is $cm$The number of each v2 spend and reset call (spend_card_points_v2, reset_card_points_v2): the ref spend:<n> or reset:<n> of its card_progress_v2_log rows. A number is never used twice, so two calls never share a ref. combat_v2_progress_spend.sql.$cm$;
comment on function public.card_progress_v2_view(text, bigint) is $cm$[combat] The answer of a v2 spend or reset: progress {level, xp, bonus, points (the 9 stats), free = level x v2_level.points_per_level + bonus - spent} and stats = card_combat_v2 of the card (rarity, stars, cp_mod, the role of subjects.ability_v2, the bonus points: the same source as card_power_v2). Reads only. Called by spend_card_points_v2 and reset_card_points_v2. combat_v2_progress_spend.sql.$cm$;
comment on function public.spend_card_points_v2(text, bigint, jsonb) is $cm$[combat] Combat v2 (plan 2.2, 2.4, 20.13): a player spends v2 points on a card. add = {stat: count} of the 9 stats (atk, def, hp, crd, crt, abl, ddg, acc, spd), 1 to 99 each. Refuses with an answer before any write: disabled (combat_v2_on progress for the player), bad_request, bad_stat, bad_amount, not_owned, no_progress, no_role, stat_cap (v2_stats.max_per_stat), not_enough (level x v2_level.points_per_level + bonus_points; with free). Writes the ledger card_progress_v2_log FIRST (reason spend, one row for each stat, one ref spend:<n> for the call), then card_progress_v2. Answer {ok, progress, stats}. combat_v2_progress_spend.sql.$cm$;
comment on function public.stat_reset_gift_use_v2(text, bigint) is $cm$[combat] Uses the next open v2 gift reset of a player (stat_reset_gifts with a gift key that starts with v2_, not used, not expired; the earliest deadline first): true = used. Never takes a v1 gift. Called by reset_card_points_v2 after the weekly free reset. combat_v2_progress_spend.sql.$cm$;
comment on function public.reset_card_points_v2(text, bigint) is $cm$[combat] Combat v2 (plan 2.2, 20.13): a player resets the v2 points of a card to 0; the level, the XP and bonus_points do not change. Free: one reset for each Mountain ISO week for each player (players.stat_reset_week, the v1 marker), then one open v2 gift (stat_reset_gift_use_v2); else reset_used with next. Refuses with an answer before any write: disabled, no_player, not_owned, no_progress, no_role, nothing_spent. Writes the ledger FIRST (reason reset, one row for each stat above 0, d_points = minus the count, one ref reset:<n>), then card_progress_v2. Answer {ok, used (week or gift), progress, stats}. combat_v2_progress_spend.sql.$cm$;

notify pgrst, 'reload schema';
