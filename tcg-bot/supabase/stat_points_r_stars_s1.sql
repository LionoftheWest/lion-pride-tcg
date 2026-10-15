-- stat_points_r_stars_s1.sql (2026-10-15): the stat points option R and the star curve S1.
-- Nathan, 2026-10-15 ("Yes to all recommendations" on the stat and star study, docs/combat-lab.md "The stat and star study",
-- measured with scripts/combat-lab.mjs on the local copy). Both are VALUES of the balance table: no function changes, and the
-- balance_log records the change with "by" = nathan. Pattern: dungeon_balance_medium.sql.
--   1. balance stat_points, per point:  attack 0.05 -> 0.06,  vitality (Health) 0.06 -> 0.05,  precision (Crit) 0.03 -> 0.05,
--      potency (Support) 0.05 -> 0.12,  haste (Recharge) 0.04 -> 0.10.  per_star, crit_cap, haste_floor, max_per_stat, enabled stay.
--   2. balance stars, curve S1: normal 5 stars 8.0x -> 7.5x (75 CP, the same as a 0-star Full Art) and illustrated_rare 5 stars
--      5.5x -> 7.0x (140 CP, the same as a 0-star Gold). Every other rarity stays. Each curve keeps its shape (6 numbers, 0 to 5 stars).
--      promo (it cannot ascend) follows the normal curve as before.
-- The players who use stat points can reset ONE card for free: stat_reset_gift.sql (apply it together, no automatic reset).
-- Needs balance_table.sql (the keys). A re-run changes nothing (the same values; balance_log writes no row for an equal value).
-- Test: card-studio/scripts/test-stat-points-r-stars-s1.mjs (rolled back; MUTATE=<name> must FAIL).

select set_config('balance.by', 'nathan', true);

update public.balance
   set value = value || '{"attack": 0.06, "vitality": 0.05, "precision": 0.05, "potency": 0.12, "haste": 0.1}'::jsonb
 where key = 'stat_points';

update public.balance
   set value = '{"gold":[1,1.15,1.27,1.38,1.49,1.6],"event":[1,1.4,1.7,2,2.25,2.5],"promo":[1,2.86,4.25,5.41,6.57,7.5],"normal":[1,2.86,4.25,5.41,6.57,7.5],"full_art":[1,1.4,1.7,2,2.25,2.5],"secret_rare":[1,1.7,2.2,2.7,3.1,3.5],"illustrated_rare":[1,2.6,3.93,5,6.07,7]}'::jsonb,
       note = 'Star curve S1 (Nathan 2026-10-15; before: Option C 2026-10-03): the power multiplier for 0 to 5 stars, by rarity. A 5-star normal = 7.5x (75 CP, a 0-star Full Art), a 5-star illustrated rare = 7.0x (140 CP, a 0-star Gold). Used by the collection power, the leaderboard AND the raid. Event and promo cards cannot ascend (ascend_card), so only their 0-star value counts.'
 where key = 'stars';

do $$
declare v jsonb; s jsonb;
begin
  select value into v from public.balance where key = 'stat_points';
  if (v->>'attack')::numeric <> 0.06 or (v->>'vitality')::numeric <> 0.05 or (v->>'precision')::numeric <> 0.05
     or (v->>'potency')::numeric <> 0.12 or (v->>'haste')::numeric <> 0.10
     or (v->>'per_star')::int <> 3 or (v->>'max_per_stat')::int <> 15 or (v->>'crit_cap')::numeric <> 0.6
     or (v->>'haste_floor')::numeric <> 0.2 or not (v->>'enabled')::boolean then
    raise exception 'stat_points_r_stars_s1: balance.stat_points is not option R: %', v;
  end if;
  select value into s from public.balance where key = 'stars';
  if (s->'normal'->>5)::numeric <> 7.5 or (s->'illustrated_rare'->>5)::numeric <> 7.0
     or s->'normal' <> '[1,2.86,4.25,5.41,6.57,7.5]'::jsonb or s->'illustrated_rare' <> '[1,2.6,3.93,5,6.07,7]'::jsonb
     or s->'gold' <> '[1,1.15,1.27,1.38,1.49,1.6]'::jsonb or s->'secret_rare' <> '[1,1.7,2.2,2.7,3.1,3.5]'::jsonb
     or s->'full_art' <> '[1,1.4,1.7,2,2.25,2.5]'::jsonb or s->'event' <> '[1,1.4,1.7,2,2.25,2.5]'::jsonb
     or s->'promo' <> '[1,2.86,4.25,5.41,6.57,7.5]'::jsonb then
    raise exception 'stat_points_r_stars_s1: balance.stars is not curve S1: %', s;
  end if;
end $$;
