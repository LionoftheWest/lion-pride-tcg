-- Effects cleanup, batch 3 (2026-09-29): the effect types that were stored but never used.
-- 1. The neutral counters in the fixed order of docs/boons-and-pranks.md 3C (decoy, ward,
--    reflect, redirect, delay), depth 1 (one counter per play):
--      decoy     the next prank hits a cardboard cutout: the post says "Direct hit!", nothing lands,
--      redirect  the next prank goes to a random other member who plays (their caps still count),
--      delay     the next prank lands 1 hour later (player_effects.starts_at / discord execute_after).
--    Changed: a bounced prank no longer meets the SENDER's ward (depth 1).
-- 2. Switched on with the Activity support (tcg-activity/src/effects-ui.js): decoy, redirect,
--    delay, and the pack pranks jinx, fake_gold, photobomb, slow_motion + the showcase pranks
--    swap_showcase, mustache.
-- Idempotent.

alter table public.player_effects add column if not exists starts_at timestamptz not null default now();
alter table public.card_plays drop constraint if exists card_plays_outcome_check;
alter table public.card_plays add constraint card_plays_outcome_check
  check (outcome in ('applied', 'blocked', 'reflected', 'decoyed', 'redirected', 'delayed'));

-- An effect that has not started yet (a delayed prank) still counts for no-stacking.
update public.effect_primitives set enabled = true
 where primitive in ('decoy', 'redirect', 'delay', 'jinx', 'fake_gold', 'photobomb', 'slow_motion', 'swap_showcase', 'mustache');

-- ---- play_card_effect (the live definition + the counter order and delay) ----

CREATE OR REPLACE FUNCTION public.play_card_effect(p_player text, p_card bigint, p_target text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_subject bigint; v_rarity text; v_qty int; v_eff jsonb; v_prim effect_primitives%rowtype;
  v_tiers jsonb; v_caps jsonb; v_power numeric; v_cd numeric;
  v_asc int; v_ascset jsonb; v_scale numeric; v_pts jsonb; v_cmb jsonb;
  v_amount numeric; v_dur int; v_cooldown_h numeric; v_ready timestamptz;
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_final text := p_target; v_outcome text := 'applied'; v_play bigint;
  v_reflect_id bigint; v_ward_id bigint; v_opts jsonb;
  v_counter_id bigint; v_counter text; v_start timestamptz;
begin
  if p_player = p_target then return jsonb_build_object('ok', false, 'error', 'self_target'); end if;
  if not exists (select 1 from players where id = p_target) then
    return jsonb_build_object('ok', false, 'error', 'no_target');
  end if;

  -- Serialize plays that touch the same members (caps + counters), in a fixed order.
  perform 1 from players where id in (p_player, p_target) order by id for update;

  select pc.quantity, c.subject_id, c.rarity::text, s.effect, coalesce(pc.ascension, 0), pc.stat_points
    into v_qty, v_subject, v_rarity, v_eff, v_asc, v_pts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_eff is null or v_eff->>'primitive' is null then
    return jsonb_build_object('ok', false, 'error', 'no_effect');
  end if;

  select * into v_prim from effect_primitives where primitive = v_eff->>'primitive';
  if not found or not v_prim.enabled then
    return jsonb_build_object('ok', false, 'error', 'effect_disabled', 'primitive', v_eff->>'primitive');
  end if;

  -- Cooldown (player + subject).
  select ready_at into v_ready from card_effect_cooldowns
   where player_id = p_player and subject_id = v_subject for update;
  if found and v_ready > now() then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_at', v_ready);
  end if;

  -- Caps (0 or missing = off).
  select value into v_caps from settings where key = 'card_effect_caps';
  v_caps := coalesce(v_caps, '{}'::jsonb);
  if coalesce((v_caps->>'send_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and created_at >= v_day)
         >= (v_caps->>'send_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'send_cap');
  end if;
  if coalesce((v_caps->>'pair_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and aimed_at = p_target and created_at >= v_day)
         >= (v_caps->>'pair_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'pair_cap');
  end if;
  if v_prim.kind = 'prank' then
    if coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and kind = 'prank' and created_at >= v_day)
           >= (v_caps->>'prank_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_prank_cap');
    end if;
    if v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and primitive = 'timeout' and created_at >= v_day)
           >= (v_caps->>'timeout_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_timeout_cap');
    end if;
  end if;
  if v_prim.primitive = 'gift_pack' and coalesce((v_caps->>'gift_pack_per_week')::int, 0) > 0
     and ((select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and target_id = p_target and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int
       or (select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and player_id = p_player and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int) then
    return jsonb_build_object('ok', false, 'error', 'gift_pack_cap');
  end if;

  -- Counters on the target, for pranks only, in the fixed order of docs/boons-and-pranks.md
  -- 3C: decoy, ward, reflect, redirect, delay. Depth 1: ONE counter acts on a play, and a
  -- bounced or redirected prank meets no second counter. Found first, used up only after
  -- every refusal check, so a refused play never costs the target a counter.
  if v_prim.kind = 'prank' then
    select id, primitive into v_counter_id, v_counter from player_effects
     where player_id = p_target and consumed_at is null and starts_at <= now()
       and primitive in ('decoy', 'ward', 'reflect', 'redirect', 'delay')
       and (expires_at is null or expires_at > now())
     order by array_position(array['decoy', 'ward', 'reflect', 'redirect', 'delay'], primitive), id limit 1;
    if v_counter = 'decoy' then v_outcome := 'decoyed';          -- a cardboard cutout takes it
    elsif v_counter = 'ward' then v_outcome := 'blocked';
    elsif v_counter = 'reflect' then v_final := p_player; v_outcome := 'reflected';
    elsif v_counter = 'redirect' then                             -- a random other member who plays
      select pl.id into v_final from players pl
       where pl.id not in (p_player, p_target) and exists (select 1 from player_cards pc where pc.player_id = pl.id)
         and not card_effect_active(pl.id, v_prim.primitive)             -- someone it can land on
         and (coalesce((v_caps->>'prank_recv_per_day')::int, 0) = 0
              or (select count(*) from card_plays cp where cp.target_id = pl.id and cp.kind = 'prank' and cp.created_at >= v_day)
                 < (v_caps->>'prank_recv_per_day')::int)
       order by random() limit 1;
      if v_final is null then v_final := p_target; v_counter_id := null; v_counter := null;  -- nobody else
      else v_outcome := 'redirected'; end if;
    elsif v_counter = 'delay' then v_outcome := 'delayed';        -- it lands 1 hour later
    end if;
    -- The caps count where a prank LANDS. A bounce or a redirect onto a member at their prank
    -- (or timeout) cap fizzles (found by boon-sim.mjs: a victim got 5 pranks + 1 reflected = 6).
    if v_final <> p_target and (
         (coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
          and (select count(*) from card_plays where target_id = v_final and kind = 'prank' and created_at >= v_day)
              >= (v_caps->>'prank_recv_per_day')::int)
         or (v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
          and (select count(*) from card_plays where target_id = v_final and primitive = 'timeout' and created_at >= v_day)
              >= (v_caps->>'timeout_recv_per_day')::int)) then
      v_outcome := 'blocked';
    end if;
  end if;

  -- No stacking (checked on the member it would land on). Refused plays keep the cooldown.
  if v_outcome not in ('blocked', 'decoyed') and not v_prim.stacks and card_effect_active(v_final, v_prim.primitive) then
    return jsonb_build_object('ok', false, 'error', 'already_active', 'primitive', v_prim.primitive);
  end if;

  update player_effects set consumed_at = now() where id = v_counter_id;
  v_start := now() + case when v_outcome = 'delayed' then interval '1 hour' else interval '0' end;

  -- Tier scaling, then the hard ceilings.
  select value into v_tiers from settings where key = 'card_effect_tiers';
  v_power := coalesce((v_tiers->v_rarity->>'power')::numeric, 1);
  v_cd    := coalesce((v_tiers->v_rarity->>'cd')::numeric, 1);
  -- Ascension (Nathan, 2026-09-27): each star of THIS copy makes the effect stronger
  -- and the cooldown shorter, on top of the tier. The hard limits below still clamp.
  select value into v_ascset from settings where key = 'card_effect_ascension';
  v_cmb := card_combat(v_rarity, v_asc, 1, v_pts);
  if (v_cmb->>'on')::boolean then
    -- Stat points on: the Potency and Haste points of THIS copy replace the per-star bonus.
    v_power := v_power * (v_cmb->>'potency')::numeric;
    v_cd    := v_cd * (v_cmb->>'haste')::numeric;
  else
    v_power := v_power * (1 + coalesce((v_ascset->>'power_per_star')::numeric, 0) * v_asc);
    v_cd    := v_cd * greatest(0.2, 1 - coalesce((v_ascset->>'cd_per_star')::numeric, 0) * v_asc);
  end if;
  -- One global knob for how often every card can be played (1 = as written).
  select coalesce((value #>> '{}')::numeric, 1) into v_scale from settings where key = 'card_effect_cooldown_scale';
  v_cd    := v_cd * coalesce(v_scale, 1);
  v_amount := round((v_eff->'base'->>'amount')::numeric * v_power, 2);
  v_dur    := round((v_eff->'base'->>'duration_s')::numeric * v_power)::int;
  if v_prim.max_amount is not null then v_amount := least(v_amount, v_prim.max_amount); end if;
  if v_prim.max_duration_s is not null then v_dur := least(v_dur, v_prim.max_duration_s); end if;
  v_cooldown_h := coalesce((v_eff->>'cooldown_h')::numeric, 24) * v_cd;

  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind,
                          rarity, amount, duration_s, outcome)
  values (p_player, v_final, p_target, p_card, v_subject, v_prim.primitive, v_prim.kind,
          v_rarity, v_amount, v_dur, v_outcome)
  returning id into v_play;

  insert into card_effect_cooldowns (player_id, subject_id, ready_at)
  values (p_player, v_subject, now() + make_interval(secs => v_cooldown_h * 3600))
  on conflict (player_id, subject_id) do update set ready_at = excluded.ready_at;

  -- What the visuals need: which card, who sent it, and ONE title from the card's list.
  v_opts := coalesce(v_eff->'options', '{}'::jsonb) || jsonb_build_object('card_id', p_card, 'sender_id', p_player);
  if jsonb_typeof(v_eff->'options'->'titles') = 'array' and jsonb_array_length(v_eff->'options'->'titles') > 0 then
    v_opts := v_opts || jsonb_build_object('title',
      v_eff->'options'->'titles'->>(floor(random() * jsonb_array_length(v_eff->'options'->'titles')))::int);
  end if;

  if v_outcome not in ('blocked', 'decoyed') then
    if v_prim.primitive = 'gift_pack' then
      perform grant_packs(v_final, greatest(1, v_amount::int), 'boon', p_player);
    elsif v_prim.primitive = 'cleanse' then
      update player_effects set consumed_at = now()
       where player_id = v_final and consumed_at is null
         and primitive in (select primitive from effect_primitives where kind = 'prank');
      update discord_effects set revert_at = now(), updated_at = now()
       where target_id = v_final and status in ('pending', 'active')
         and primitive in (select primitive from effect_primitives where kind = 'prank');
    elsif v_prim.channel = 'app' then
      insert into player_effects (player_id, primitive, amount, duration_s, options, source_play_id, starts_at, expires_at)
      values (v_final, v_prim.primitive, v_amount, v_dur, v_opts, v_play, v_start,
              case when v_dur is not null and v_dur > 0 then v_start + make_interval(secs => v_dur) end);
    else
      insert into discord_effects (play_id, target_id, primitive, amount, duration_s, options, execute_after, revert_at)
      values (v_play, v_final, v_prim.primitive, v_amount, v_dur, v_opts, v_start,
              case when v_dur is not null and v_dur > 0 then v_start + make_interval(secs => v_dur) end);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'play_id', v_play, 'outcome', v_outcome, 'target', v_final,
    'primitive', v_prim.primitive, 'kind', v_prim.kind, 'rarity', v_rarity, 'ascension', v_asc,
    'amount', v_amount, 'duration_s', v_dur, 'ready_at', now() + make_interval(secs => v_cooldown_h * 3600));
end $function$;

notify pgrst, 'reload schema';
