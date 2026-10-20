-- combat_v2_stats.sql (2026-10-18): combat v2, phase 2, PR E3: the 9 stats of a card (docs/combat-redesign-plan.md sections 2.1 to 2.4 and 14).
-- Needs combat_v2_turn_meter.sql (E2) first (combat_v2_numbers, combat_v2_speed), and so E1 (the roles table) and V1 (the balance keys v2_asc,
-- v2_level, v2_stats, v2_card_hp, v2_support, v2_speed, v2_roles).
-- Before: only the v1 stats exist (card_combat: CP, HP, crit, potency, haste from the stat points of the stars). Nothing calculates a v2 stat.
-- After this file (the reference is the simulator card-studio/v2sim, formulas.mjs F.ascCp, F.converge, F.levelPoints, F.stats, F.supportPower and
-- cards.mjs makeCard):
--   combat_v2_stats(cp_base, points, role, numbers): the 9 stats from the base CP (after the catch-up dial) and the spent points (plan 2.2). PURE.
--     Each point count is used up to v2_stats.max_per_stat.
--       atk (the CP of the hits) = cp_base + atk.flat x ATK           hp  = v2_card_hp.base + v2_card_hp.per_cp x cp_base + hp.flat x HP
--       def = min(def.cap, def.pct x DEF)                             crd (the crit damage multiplier) = crd.base + crd.pct x CRD
--       crt (the crit chance) = min(crt.cap, crt.base + crt.pct x CRT) abl (the multiplier of the active's amounts) = 1 + abl.pct x ABL
--       ddg = min(ddg.cap, ddg.pct x DDG)                              acc = acc.pct x ACC
--       spd (the speed) = combat_v2_speed of the role with the SPD points and no status (E2: the one speed formula)
--     The role passive adds (for example the Striker crit) are not in these numbers: the hit core applies them (PR E4), as in the simulator.
--   card_combat_v2(rarity, stars, cp_mod, level, points, role[, numbers]): the whole v2 stat line of one card. Reads balance and the roles table.
--     ASC-3 (plan 2.3): cp_asc = base[r] x (1 + (top[r] / base[r] - 1) x curve[stars]) x cp_mod (r after v2_asc.alias; stars 0 to 5, clamped like
--       the simulator and v1; cp_mod NULL = 1).
--     Level (plan 2.4): the level is clamped to v2_level.max_level; level points = level x points_per_level.
--     The catch-up dial D (plan 2.4): cp_base = cp_asc + converge_d x (level / max_level) x (target_cp - cp_asc). HP and the support factor use it.
--     The support factor (plan 2.1): power = (cp_base / v2_support.power_ref) ^ power_exp for a support role, 1 for an attacker.
--     extra_stack = 1 for a rarity in v2_support.enabler_extra_stack (the rarity as given: event counts), else 0.
--     The role (the roles table): class, label, the passive text, its numbers (v2_roles.<key>) and the base speed.
--     It REFUSES: an unknown rarity or role, a negative level, a point key that is not one of the 9 stats, a point count that is not a whole number
--     of 0 or more, and more points than the level gives (the simulator makeCard rule).
--     Answer: {rarity, stars, level, role, class, cp_asc, cp_base, power, extra_stack, points {9}, points_level, points_free,
--              stats {atk, def, hp, crd, crt, abl, ddg, acc, spd}, spd_x, passive {key, label, class, text, numbers, speed}}.
--     The numbers are exact numeric (no rounding): a screen rounds for display.
-- NO CHANGE IN PLAY: card_combat (v1) and every v1 function stay as they are; nothing calls the new functions yet (the progress flag of combat_v2 is
-- OFF; PR M1 adds the card levels and the v2 points). The goldens, the shadow test and fight-timing.mjs prove it.
-- Every number is in balance (CI check C1: only 0 and 1 in the bodies; card_combat_v2 is in the C1 scope). Idempotent. Server only.
-- Test: card-studio/scripts/test-combat-v2-stats.mjs (rolled back; the simulator formulas on a grid of every rarity x star x level x role;
-- MUTATE=all must catch every mutation).

-- ============================================================ 1. the 9 stats from the base CP and the points
create or replace function public.combat_v2_stats(p_cp_base numeric, p_pts jsonb, p_role text, p_b jsonb) returns jsonb
language plpgsql immutable set search_path = public as $fn$
declare
  st jsonb := p_b->'v2_stats'; hp jsonb := p_b->'v2_card_hp';
  mx numeric := (p_b->'v2_stats'->>'max_per_stat')::numeric;
  pts jsonb := coalesce(p_pts, '{}'::jsonb);
  k text; p jsonb := '{}'::jsonb;
begin
  if st is null or hp is null or mx is null then raise exception 'combat_v2_stats: no balance value for v2_stats or v2_card_hp'; end if;
  if jsonb_typeof(pts) is distinct from 'object' then raise exception 'combat_v2_stats: the points must be an object {stat: count}'; end if;
  for k in select x from jsonb_object_keys(pts) x loop
    if not st ? k or k = 'max_per_stat' then raise exception 'combat_v2_stats: % is not one of the 9 stats (balance v2_stats)', k; end if;
    if jsonb_typeof(pts->k) is distinct from 'number' or (pts->>k)::numeric < 0 or (pts->>k)::numeric % 1 <> 0 then
      raise exception 'combat_v2_stats: the points of % must be a whole number of 0 or more', k;
    end if;
  end loop;
  -- the points that count: each stat up to max_per_stat
  for k in select x from jsonb_object_keys(st) x where x <> 'max_per_stat' loop
    p := p || jsonb_build_object(k, least(coalesce((pts->>k)::numeric, 0), mx));
  end loop;
  return jsonb_build_object(
    'atk', p_cp_base + (st->'atk'->>'flat')::numeric * (p->>'atk')::numeric,
    'def', least((st->'def'->>'cap')::numeric, (st->'def'->>'pct')::numeric * (p->>'def')::numeric),
    'hp',  (hp->>'base')::numeric + (hp->>'per_cp')::numeric * p_cp_base + (st->'hp'->>'flat')::numeric * (p->>'hp')::numeric,
    'crd', (st->'crd'->>'base')::numeric + (st->'crd'->>'pct')::numeric * (p->>'crd')::numeric,
    'crt', least((st->'crt'->>'cap')::numeric, (st->'crt'->>'base')::numeric + (st->'crt'->>'pct')::numeric * (p->>'crt')::numeric),
    'abl', 1 + (st->'abl'->>'pct')::numeric * (p->>'abl')::numeric,
    'ddg', least((st->'ddg'->>'cap')::numeric, (st->'ddg'->>'pct')::numeric * (p->>'ddg')::numeric),
    'acc', (st->'acc'->>'pct')::numeric * (p->>'acc')::numeric,
    'spd', combat_v2_speed(jsonb_build_object('role', p_role, 'spd', (p->>'spd')::numeric), 0, p_b),
    'spd_x', 1 + (st->'spd'->>'pct')::numeric * (p->>'spd')::numeric,
    'points', p);
end $fn$;

-- ============================================================ 2. the stat line of one card
create or replace function public.card_combat_v2(p_rarity text, p_stars int, p_mod numeric, p_level int, p_pts jsonb, p_role text, p_b jsonb) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  a jsonb := p_b->'v2_asc'; lv jsonb := p_b->'v2_level'; su jsonb := p_b->'v2_support';
  r text; base numeric; top numeric; s int; lvl int; cp_asc numeric; cp_base numeric; spent numeric; lpts numeric;
  ro public.roles%rowtype; o jsonb;
begin
  if a is null or lv is null or su is null then raise exception 'card_combat_v2: no balance value for v2_asc, v2_level or v2_support'; end if;
  r := coalesce(a->'alias'->>p_rarity, p_rarity);
  base := (a->'base'->>r)::numeric; top := (a->'top'->>r)::numeric;
  if base is null or top is null then raise exception 'card_combat_v2: unknown rarity %', p_rarity; end if;
  select * into ro from public.roles where key = p_role;
  if not found then raise exception 'card_combat_v2: unknown role % (the roles table)', p_role; end if;
  if p_level is null or p_level < 0 then raise exception 'card_combat_v2: the level must be 0 or more'; end if;
  -- ASC-3 (stars clamped to the curve: 0 to 5)
  s := greatest(0, least(coalesce(p_stars, 0), jsonb_array_length(a->'curve') - 1));
  cp_asc := base * (1 + (top / base - 1) * (a->'curve'->>s)::numeric) * coalesce(p_mod, 1);
  -- the level and the catch-up dial D
  lvl := least(p_level, (lv->>'max_level')::int);
  cp_base := cp_asc + (lv->>'converge_d')::numeric * lvl / (lv->>'max_level')::numeric * ((lv->>'target_cp')::numeric - cp_asc);
  lpts := lvl * (lv->>'points_per_level')::numeric;
  o := combat_v2_stats(cp_base, p_pts, p_role, p_b);
  select coalesce(sum(x.value::numeric), 0) into spent from jsonb_each_text(coalesce(p_pts, '{}'::jsonb)) x;
  if spent > lpts then raise exception 'card_combat_v2: % points spent, the level % gives %', spent, p_level, lpts; end if;
  return jsonb_build_object(
    'rarity', r, 'stars', s, 'level', lvl, 'role', ro.key, 'class', ro.class,
    'cp_asc', cp_asc, 'cp_base', cp_base,
    'power', case when ro.class = 'support' then power(cp_base / (su->>'power_ref')::numeric, (su->>'power_exp')::numeric) else 1 end,
    'extra_stack', case when su->'enabler_extra_stack' ? p_rarity then 1 else 0 end,
    'points', o->'points', 'points_level', lpts, 'points_free', lpts - spent,
    'stats', o - 'points' - 'spd_x', 'spd_x', o->'spd_x',
    'passive', jsonb_build_object('key', ro.key, 'label', ro.label, 'class', ro.class, 'text', ro.passive,
                                  'numbers', balance_path(ro.numbers), 'speed', balance_path(ro.speed)));
end $fn$;

create or replace function public.card_combat_v2(p_rarity text, p_stars int, p_mod numeric, p_level int, p_pts jsonb, p_role text) returns jsonb
language sql stable set search_path = public as $fn$
  select card_combat_v2(p_rarity, p_stars, p_mod, p_level, p_pts, p_role,
    combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed']));
$fn$;

-- ============================================================ 3. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['combat_v2_stats(numeric, jsonb, text, jsonb)', 'card_combat_v2(text, integer, numeric, integer, jsonb, text, jsonb)',
                           'card_combat_v2(text, integer, numeric, integer, jsonb, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.combat_v2_stats(numeric, jsonb, text, jsonb) is $cm$[combat] Combat v2 (plan 2.2): the 9 stats from the base CP (after the catch-up dial) and the spent points {atk, def, hp, crd, crt, abl, ddg, acc, spd}, each point count up to v2_stats.max_per_stat: atk = cp_base + flat x ATK; hp = v2_card_hp.base + per_cp x cp_base + flat x HP; def, crt, ddg capped; crd, abl, acc; spd = combat_v2_speed of the role. Without the role passive adds (PR E4). PURE. combat_v2_stats.sql.$cm$;
comment on function public.card_combat_v2(text, integer, numeric, integer, jsonb, text, jsonb) is $cm$[combat] Combat v2: the stat line of one card (plan 2.1 to 2.4): ASC-3 (v2_asc), the level points and the catch-up dial D (v2_level), the 9 stats (combat_v2_stats), the support factor (v2_support), the role and its passive (the roles table). Refuses an unknown rarity or role, a negative level, bad points and more points than the level gives. Exact numbers. card_combat (v1) is not changed. combat_v2_stats.sql.$cm$;
comment on function public.card_combat_v2(text, integer, numeric, integer, jsonb, text) is $cm$[combat] card_combat_v2 with the numbers of balance v2_asc, v2_level, v2_stats, v2_card_hp, v2_support and v2_speed. Reads only. combat_v2_stats.sql.$cm$;

notify pgrst, 'reload schema';
