-- evt2_special_power.sql (2026-11-05, EVT-2 B4): event and promo cards are special and have full-art power.
-- Nathan 2026-11-05 EVT-2 Q3b ("YES": event and promo cards get the full-art values for their prank/boon effects, and promo cards get full-art power in
-- fights). items/EVT-2/SPEC.md v2.4 section 4.7. One file, one transaction, every change logged in balance_log with "by" = nathan:
--   1. effect_tiers   + event {cd 0.75, power 1.3} and + promo {cd 0.75, power 1.3} (= full_art). Before: no key, so
--                     play_card_effect used power 1 and cd 1 (an event prank had normal power).
--   2. rarity_cp      promo 10 -> 75 (= full_art).
--   3. stars          promo: the normal curve -> the full_art curve [1, 1.4, 1.7, 2, 2.25, 2.5] (promo cannot ascend: only index 0 counts).
--   4. v2_asc         alias.promo normal -> full_art.
--   5. v2_support     enabler_extra_stack + "promo" (card_combat_v2 reads the raw rarity there, not the alias).
--   6. balance_check  a new limit for effect_tiers: each rarity is {cd, power}, power 0.5 to 3, cd 0.1 to 2.
-- event already has the full-art values in rarity_cp, stars, v2_asc and v2_support: no change. No promo card exists today.
-- Visible today: the 2 launch-day event cards' prank cooldown 168 h -> 126 h (their amounts are capped by the primitive).
-- The undo: evt2_special_power_undo.sql (on Nathan's word only). Test: card-studio/scripts/test-evt2-special-power.mjs
-- (rolled back; MUTATE=all must FAIL each mutation). A re-run changes nothing (the same values, the notes are not added twice).

-- GUARD (the combat_core.sql rule): balance_check must be the live text this file was built from, or the text of this file.
do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.balance_check()'::regprocedure), chr(13), '')) into strict m;
  if m not in ('c441652f39f6e29531939cc077b534e2', 'dcd3d07510e4c070168eb70f13754dd2') then
    raise exception 'evt2_special_power.sql: the live public.balance_check() changed since this file was built (md5 %). Rebuild it from the live text.', m;
  end if;
end $g$;
-- GUARD-END

CREATE OR REPLACE FUNCTION public.balance_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_bad text;
begin
  if tg_op = 'DELETE' then
    raise exception 'balance: the key % is read by the game; change its value, do not delete it', old.key;
  end if;
  select string_agg(array_to_string(n.path, '.'), ', ') into v_bad from balance_leaves(new.value) n where n.num < 0;
  if v_bad is not null then raise exception 'balance %: negative number at %', new.key, v_bad; end if;
  if tg_op = 'UPDATE' then
    select string_agg(array_to_string(o.path, '.') || ' (' || o.typ || ')', ', ') into v_bad
      from balance_leaves(old.value) o
     where o.typ <> 'object' and o.typ <> 'array'
       and not (new.key = 'combat_v2' and o.path[1] = 'testers')   -- combat_v2_testers.sql: the tester ids may go
       and not exists (select 1 from balance_leaves(new.value) n where n.path = o.path and n.typ = o.typ);
    if v_bad is not null then
      raise exception 'balance %: the new value lost or changed the type of %', new.key, v_bad;
    end if;
    new.updated_at := now();
    new.updated_by := balance_who();
  end if;
  if new.key = 'stars' then
    select string_agg(r.key, ', ') into v_bad from jsonb_each(new.value) r
     where jsonb_typeof(r.value) <> 'array' or jsonb_array_length(r.value) <> 6
        or exists (select 1 from jsonb_array_elements(r.value) x where jsonb_typeof(x) <> 'number' or (x #>> '{}')::numeric <= 0);
    if v_bad is not null then raise exception 'balance stars: % must be 6 numbers above 0 (0 to 5 stars)', v_bad; end if;
  end if;
  -- EVT-2 B4 (Nathan 2026-11-05 Q3b): each effect_tiers rarity is {cd, power}, power 0.5 to 3, cd 0.1 to 2.
  if new.key = 'effect_tiers' then
    select string_agg(r.key, ', ') into v_bad from jsonb_each(new.value) r
     where jsonb_typeof(r.value) <> 'object'
        or (select array_agg(k order by k) from jsonb_object_keys(r.value) k) is distinct from array['cd', 'power']
        or jsonb_typeof(r.value->'cd') <> 'number' or jsonb_typeof(r.value->'power') <> 'number'
        or (r.value->>'power')::numeric not between 0.5 and 3 or (r.value->>'cd')::numeric not between 0.1 and 2;
    if v_bad is not null then raise exception 'balance effect_tiers: % needs power 0.5 to 3 and cd 0.1 to 2', v_bad; end if;
  end if;
  return new;
end $function$;

select set_config('balance.by', 'nathan', true);

update public.balance
   set value = value || '{"event": {"cd": 0.75, "power": 1.3}, "promo": {"cd": 0.75, "power": 1.3}}'::jsonb,
       note = case when position('event and promo = the full_art values (Nathan 2026-11-05 EVT-2 Q3b: event and promo cards are special and have full-art power). Limits: every rarity has power 0.5 to 3 and cd 0.1 to 2.' in coalesce(note, '')) > 0 then note else coalesce(note || ' ', '') || 'event and promo = the full_art values (Nathan 2026-11-05 EVT-2 Q3b: event and promo cards are special and have full-art power). Limits: every rarity has power 0.5 to 3 and cd 0.1 to 2.' end
 where key = 'effect_tiers';

update public.balance
   set value = jsonb_set(value, '{promo}', '75'::jsonb),
       note = case when position('promo = full_art = 75 (Nathan 2026-11-05 EVT-2 Q3b); event = 75 since the launch.' in coalesce(note, '')) > 0 then note else coalesce(note || ' ', '') || 'promo = full_art = 75 (Nathan 2026-11-05 EVT-2 Q3b); event = 75 since the launch.' end
 where key = 'rarity_cp';

update public.balance
   set value = jsonb_set(value, '{promo}', '[1, 1.4, 1.7, 2, 2.25, 2.5]'::jsonb),
       note = case when position('promo = the full_art curve (Nathan 2026-11-05 EVT-2 Q3b). Event and promo cannot ascend, so only index 0 counts.' in coalesce(note, '')) > 0 then note else coalesce(note || ' ', '') || 'promo = the full_art curve (Nathan 2026-11-05 EVT-2 Q3b). Event and promo cannot ascend, so only index 0 counts.' end
 where key = 'stars';

update public.balance
   set value = jsonb_set(value, '{alias,promo}', '"full_art"'::jsonb),
       note = case when position('alias promo = full_art (Nathan 2026-11-05 EVT-2 Q3b; before: promo = normal).' in coalesce(note, '')) > 0 then note else coalesce(note || ' ', '') || 'alias promo = full_art (Nathan 2026-11-05 EVT-2 Q3b; before: promo = normal).' end
 where key = 'v2_asc';

update public.balance
   set value = case when value->'enabler_extra_stack' ? 'promo' then value
                    else jsonb_set(value, '{enabler_extra_stack}', (value->'enabler_extra_stack') || '["promo"]'::jsonb) end,
       note = case when position('promo added (Nathan 2026-11-05 EVT-2 Q3b; card_combat_v2.sql:74 reads the raw rarity, not the alias).' in coalesce(note, '')) > 0 then note else coalesce(note || ' ', '') || 'promo added (Nathan 2026-11-05 EVT-2 Q3b; card_combat_v2.sql:74 reads the raw rarity, not the alias).' end
 where key = 'v2_support';

-- CHECK: the after values (SPEC 4.7.1): event = promo = full_art.
do $c$
declare b jsonb := (select jsonb_object_agg(key, value) from public.balance where key in ('effect_tiers', 'rarity_cp', 'stars', 'v2_asc', 'v2_support'));
begin
  if b->'effect_tiers'->'event' <> b->'effect_tiers'->'full_art' or b->'effect_tiers'->'promo' <> b->'effect_tiers'->'full_art'
     or b->'effect_tiers'->'full_art' <> '{"cd": 0.75, "power": 1.3}'::jsonb
     or b->'rarity_cp'->'promo' <> b->'rarity_cp'->'full_art' or (b->'rarity_cp'->>'promo')::numeric <> 75
     or b->'stars'->'promo' <> b->'stars'->'full_art'
     or b->'v2_asc'->'alias'->>'promo' <> 'full_art'
     or not (b->'v2_support'->'enabler_extra_stack' ? 'promo') then
    raise exception 'evt2_special_power.sql: the after values are not the full_art values: %', b;
  end if;
  if md5(replace(pg_get_functiondef('public.balance_check()'::regprocedure), chr(13), '')) <> 'dcd3d07510e4c070168eb70f13754dd2' then
    raise exception 'evt2_special_power.sql: balance_check is not the text of this file';
  end if;
end $c$;
