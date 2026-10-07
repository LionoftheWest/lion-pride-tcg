-- one_source_rules.sql: one source for two copied rules (Nathan 2026-10-03: one source of truth for each number
-- and each calculation). New functions only. No md5-guarded function changes.
--
-- 1. The game day. A game day starts at midnight Mountain Time (America/Denver, mt_clock.sql). game_day() and
--    game_day_start() are the named rule. dungeon_day() and shop_day() had the same text: they now call game_day()
--    (the same answer). The JS copies (tcg-activity/src/mt-time.js, tcg-bot/src/store.ts utcToday) are tested equal
--    to game_day() at many instants, the DST changes included (card-studio/scripts/test-one-source-rules.mjs).
-- 2. The effect preview. The card viewer and the play picker show what a card effect will do (amount, duration,
--    cooldown). The Activity computed it again in JS (tcg-activity/src/effects-ui.js scaled()). effect_preview()
--    is the same math as play_card_effect() (tier x this copy's bonus x the global knob, then the hard limits), for
--    every effect card of a member. The Activity serves it at GET /api/effects/preview. The test proves that the
--    preview equals what play_card_effect() writes for each card. play_card_effect() is md5-guarded
--    (balance_table.sql, balance_economy.sql), so it is not changed here: a later rebuild can make it call
--    effect_preview_card() and remove the last copy.
-- Idempotent.

create or replace function public.game_day(p_at timestamptz default now())
 returns date
 language sql
 stable
 set search_path to 'public'
as $function$
  select (p_at at time zone 'America/Denver')::date;
$function$;

create or replace function public.game_day_start(p_day date)
 returns timestamptz
 language sql
 stable
 set search_path to 'public'
as $function$
  select p_day::timestamp at time zone 'America/Denver';
$function$;

create or replace function public.dungeon_day()
 returns date
 language sql
 stable
as $function$ select public.game_day(); $function$;

create or replace function public.shop_day()
 returns date
 language sql
 stable
 set search_path to 'public'
as $function$
  select game_day();
$function$;

-- The scaled numbers of one effect card copy: the math of play_card_effect() (its block "Tier scaling, then the
-- hard ceilings"), with the same balance keys, in the same order.
create or replace function public.effect_preview_card(p_rarity text, p_asc integer, p_pts jsonb, p_effect jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare v_prim effect_primitives%rowtype; v_tiers jsonb; v_ascset jsonb; v_cmb jsonb; v_scale numeric;
  v_power numeric; v_cd numeric; v_pmul numeric; v_cmul numeric; v_amount numeric; v_dur int;
begin
  if p_effect is null or p_effect->>'primitive' is null then return null; end if;
  select * into v_prim from effect_primitives where primitive = p_effect->>'primitive';
  v_tiers := balance_get('effect_tiers');
  v_power := coalesce((v_tiers->p_rarity->>'power')::numeric, 1);
  v_cd    := coalesce((v_tiers->p_rarity->>'cd')::numeric, 1);
  v_ascset := balance_get('effect_ascension');
  v_cmb := card_combat(p_rarity, coalesce(p_asc, 0), 1, p_pts);
  if (v_cmb->>'on')::boolean then
    v_pmul := (v_cmb->>'potency')::numeric;
    v_cmul := (v_cmb->>'haste')::numeric;
  else
    v_pmul := 1 + coalesce((v_ascset->>'power_per_star')::numeric, 0) * coalesce(p_asc, 0);
    v_cmul := greatest((v_ascset->>'cd_floor')::numeric, 1 - coalesce((v_ascset->>'cd_per_star')::numeric, 0) * coalesce(p_asc, 0));
  end if;
  v_power := v_power * v_pmul;
  v_cd    := v_cd * v_cmul;
  v_scale := (balance_get('effect_cooldown_scale') #>> '{}')::numeric;
  v_cd    := v_cd * coalesce(v_scale, 1);
  v_amount := round((p_effect->'base'->>'amount')::numeric * v_power, 2);
  v_dur    := round((p_effect->'base'->>'duration_s')::numeric * v_power)::int;
  if v_prim.max_amount is not null then v_amount := least(v_amount, v_prim.max_amount); end if;
  if v_prim.max_duration_s is not null then v_dur := least(v_dur, v_prim.max_duration_s); end if;
  return jsonb_build_object('primitive', p_effect->>'primitive', 'kind', v_prim.kind, 'enabled', coalesce(v_prim.enabled, false),
    'amount', v_amount, 'duration_s', v_dur, 'cooldown_h', coalesce((p_effect->>'cooldown_h')::numeric, 24) * v_cd,
    'stats_on', coalesce((v_cmb->>'on')::boolean, false), 'potency', v_pmul, 'haste', v_cmul);
end $function$;

-- Every effect card a member owns: card id -> effect_preview_card().
create or replace function public.effect_preview(p_player text)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(pc.card_id::text,
           effect_preview_card(c.rarity::text, coalesce(pc.ascension, 0), pc.stat_points, s.effect)), '{}'::jsonb)
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.quantity > 0 and s.effect->>'primitive' is not null;
$function$;

comment on function public.game_day(timestamptz) is $c$The game day of an instant (default now): the date in Mountain Time (America/Denver). A game day starts at midnight MT. The one named rule for the game day (one_source_rules.sql). dungeon_day and shop_day call it. The JS copies (tcg-activity/src/mt-time.js mtToday, tcg-bot/src/store.ts utcToday) are tested equal to it (test-one-source-rules.mjs).$c$;
comment on function public.game_day_start(date) is $c$The instant a game day starts: midnight Mountain Time of that date. The JS copy tcg-activity/src/mt-time.js mtDayStartISO is tested equal to it (test-one-source-rules.mjs).$c$;
comment on function public.effect_preview_card(text,integer,jsonb,jsonb) is $c$What one effect card copy will do when played: the amount, the duration and the cooldown in hours after the tier (balance effect_tiers), the copy bonus (Potency and Haste with stat points on, else balance effect_ascension per star), the knob effect_cooldown_scale and the hard limits of effect_primitives. The same math as play_card_effect (test-one-source-rules.mjs proves it). Null when the card has no effect.$c$;
comment on function public.effect_preview(text) is $c$A JSON map card id to effect_preview_card for every effect card the member owns. Activity GET /api/effects/preview: the card viewer and the play picker show these numbers, so the client does not compute them again.$c$;

notify pgrst, 'reload schema';
