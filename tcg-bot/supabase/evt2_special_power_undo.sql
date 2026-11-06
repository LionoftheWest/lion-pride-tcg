-- evt2_special_power_undo.sql (2026-11-05, EVT-2 B4 undo): back to the values before evt2_special_power.sql. Apply on Nathan's word only.
-- balance_check refuses an update that loses a leaf, so the event and promo keys of effect_tiers cannot be removed: they become
-- {"cd": 1, "power": 1}, which gives the same result as no key (play_card_effect: coalesce(.., 1)).
-- rarity_cp.promo 75 -> 10, stars.promo -> the normal curve, v2_asc.alias.promo -> normal. "by" = nathan, 4 balance_log rows.
-- promo stays in v2_support.enabler_extra_stack, because balance_check refuses the removal (balance_leaves recurses into arrays:
-- removing enabler_extra_stack.3 (string) is a lost leaf). No promo card exists, so it has no effect.
-- The balance_check limit for effect_tiers stays (the undo values pass it). A cooldown already started keeps its ready_at.
-- A second run changes nothing.

-- One DO block (the pattern of combat_v2_hunt_balance_c_undo.sql): the updates and the check run together.
do $u$
declare b jsonb;
begin
  perform set_config('balance.by', 'nathan', true);
  update public.balance
     set value = value || '{"event": {"cd": 1, "power": 1}, "promo": {"cd": 1, "power": 1}}'::jsonb,
         note = case when position('undo of EVT-2 B4 (evt2_special_power_undo.sql).' in coalesce(note, '')) > 0 then note else coalesce(note || ' ', '') || 'undo of EVT-2 B4 (evt2_special_power_undo.sql).' end
   where key = 'effect_tiers';
  update public.balance set value = jsonb_set(value, '{promo}', '10'::jsonb), note = case when position('undo of EVT-2 B4 (evt2_special_power_undo.sql).' in coalesce(note, '')) > 0 then note else coalesce(note || ' ', '') || 'undo of EVT-2 B4 (evt2_special_power_undo.sql).' end where key = 'rarity_cp';
  update public.balance set value = jsonb_set(value, '{promo}', value->'normal'), note = case when position('undo of EVT-2 B4 (evt2_special_power_undo.sql).' in coalesce(note, '')) > 0 then note else coalesce(note || ' ', '') || 'undo of EVT-2 B4 (evt2_special_power_undo.sql).' end where key = 'stars';
  update public.balance set value = jsonb_set(value, '{alias,promo}', '"normal"'::jsonb), note = case when position('undo of EVT-2 B4 (evt2_special_power_undo.sql).' in coalesce(note, '')) > 0 then note else coalesce(note || ' ', '') || 'undo of EVT-2 B4 (evt2_special_power_undo.sql).' end where key = 'v2_asc';
  b := (select jsonb_object_agg(key, value) from public.balance where key in ('effect_tiers', 'rarity_cp', 'stars', 'v2_asc'));
  if b->'effect_tiers'->'event' <> '{"cd": 1, "power": 1}'::jsonb or b->'effect_tiers'->'promo' <> '{"cd": 1, "power": 1}'::jsonb
     or (b->'rarity_cp'->>'promo')::numeric <> 10 or b->'stars'->'promo' <> b->'stars'->'normal'
     or b->'v2_asc'->'alias'->>'promo' <> 'normal' then
    raise exception 'evt2_special_power_undo.sql: the values are not the before values: %', b;
  end if;
end $u$;
