-- combat_v2_progress_math.sql (2026-10-23): combat v2 step M1b, the pure math of the card levels and the bonus points in the budget
-- (docs/combat-redesign-plan.md 2.4, 11 and 20.11 decision 3; 20.12 "M1b as built"). Needs combat_v2_stats.sql (E3: card_combat_v2) and
-- combat_v2_progress_tables.sql (M1a: card_progress_v2 and its trigger).
-- Before: the XP formula of a level is written out in the M1a trigger card_progress_v2_check; no function gives the level of an XP or the
--   XP award of a fight-day; card_combat_v2 refuses more points than level x points_per_level (a refund of bonus points cannot be stored).
-- After this file (the reference is the simulator card-studio/v2sim, formulas.mjs F.xpAt, F.levelOfXp, F.xpAward and F.pointBudget):
--   card_level_xp_at(level[, numbers]): the total XP of a level. Level L to L + 1 costs card_level.cost_base + card_level.cost_per_level x L,
--     so xp_at(L) = the sum of those costs for 0 to L - 1 (today 5 + L: level 1 = 5, level 3 = 18, level 30 = 585). Refuses a level below 0
--     or above v2_level.max_level.
--   card_level_of_xp(xp[, numbers]): the level of an XP: the highest level L (0 to v2_level.max_level) with xp_at(L) <= xp.
--   card_level_xp_award(source, level, levels[, numbers]): the XP of one fight-day (plan 2.4): card_level.xp_hunt_day for 'hunt',
--     card_level.xp_dungeon_run for 'dungeon' (the Gauntlet gives no XP). The catch-up rule: `levels` are the levels of the player's
--     v2 cards; when the card's level is below the mean of the top card_level.catchup_top of them, the award is
--     floor(award x card_level.catchup_x). An empty list gives no catch-up.
--   Each function has a PURE form with the numbers (IMMUTABLE; the jsonb of combat_v2_numbers) and a STABLE form that reads balance
--   card_level and v2_level. Every number is in balance. A missing number REFUSES (fails closed): a null never passes a check.
--   card_progress_v2_check (the M1a trigger, REPLACED): the same checks; the XP of the level now comes from card_level_xp_at (one formula).
--     Accepts and refuses the same rows as the M1a body (the test compares the two on every level and XP boundary). The error texts
--     show whole numbers.
--   card_combat_v2(rarity, stars, cp_mod, level, points, role, numbers, bonus_points) (NEW): the stat line with bonus points in the
--     budget: the points spent may be up to level x points_per_level + bonus_points (decision 3 of 20.11: refunds are bonus points, not
--     levels). points_free = level points + bonus - spent. Refuses a bonus below 0 or null.
--   card_combat_v2(rarity, stars, cp_mod, level, points, role, numbers) (REPLACED): calls the new form with bonus 0. The same answer and the
--     same error texts as before (the test compares the old and the new body on a grid). No default argument: a default on the new form
--     makes every 7-argument call ambiguous. The 6-argument form does not change.
-- NO CHANGE IN PLAY: no v1 function changes and none calls these functions; the flag combat_v2.progress stays false; both progress tables
--   stay empty. Idempotent. Server only (no execute for anon and authenticated).
-- Test: card-studio/scripts/test-combat-v2-progress-math.mjs (rolled back; MUTATE=all must catch every mutation).

-- ============================================================ 1. the XP of a level and the level of an XP
create or replace function public.card_level_xp_at(p_level int, p_b jsonb) returns int
language plpgsql immutable set search_path = public as $fn$
declare
  base numeric := (p_b->'card_level'->>'cost_base')::numeric;
  per numeric := (p_b->'card_level'->>'cost_per_level')::numeric;
  mx numeric := (p_b->'v2_level'->>'max_level')::numeric;
  v numeric;
begin
  if base is null or per is null or mx is null then
    raise exception 'card_level_xp_at: no balance value for card_level.cost_base, card_level.cost_per_level or v2_level.max_level';
  end if;
  if base <> trunc(base) or per <> trunc(per) then raise exception 'card_level_xp_at: the card_level costs must be whole numbers'; end if;
  if p_level is null or p_level < 0 then raise exception 'card_level_xp_at: the level must be 0 or more'; end if;
  if p_level > mx then raise exception 'card_level_xp_at: level % is above v2_level.max_level %', p_level, mx; end if;
  -- level L to L + 1 costs base + per x L
  select coalesce(sum(base + per * k), 0) into v from generate_series(0, p_level - 1) k;
  return v::int;
end $fn$;

create or replace function public.card_level_xp_at(p_level int) returns int
language sql stable set search_path = public as $fn$
  select card_level_xp_at(p_level, combat_v2_numbers(array['card_level', 'v2_level']));
$fn$;

create or replace function public.card_level_of_xp(p_xp int, p_b jsonb) returns int
language plpgsql immutable set search_path = public as $fn$
declare
  mx numeric := (p_b->'v2_level'->>'max_level')::numeric;
  lv int := 0;
begin
  if mx is null then raise exception 'card_level_of_xp: no balance value for v2_level.max_level'; end if;
  if p_xp is null or p_xp < 0 then raise exception 'card_level_of_xp: the XP must be 0 or more'; end if;
  while lv < mx and card_level_xp_at(lv + 1, p_b) <= p_xp loop
    lv := lv + 1;
  end loop;
  return lv;
end $fn$;

create or replace function public.card_level_of_xp(p_xp int) returns int
language sql stable set search_path = public as $fn$
  select card_level_of_xp(p_xp, combat_v2_numbers(array['card_level', 'v2_level']));
$fn$;

-- ============================================================ 2. the XP of a fight-day and the catch-up rule
create or replace function public.card_level_xp_award(p_source text, p_level int, p_levels int[], p_b jsonb) returns int
language plpgsql immutable set search_path = public as $fn$
declare
  c jsonb := p_b->'card_level';
  x numeric := (c->>'catchup_x')::numeric;
  top numeric := (c->>'catchup_top')::numeric;
  base numeric; n int; s numeric;
begin
  if p_source is null or p_source not in ('hunt', 'dungeon') then
    raise exception 'card_level_xp_award: the source must be hunt or dungeon (the Gauntlet gives no XP)';
  end if;
  base := case p_source when 'hunt' then (c->>'xp_hunt_day')::numeric else (c->>'xp_dungeon_run')::numeric end;
  if base is null or x is null or top is null then
    raise exception 'card_level_xp_award: no balance value for card_level.xp_hunt_day, xp_dungeon_run, catchup_x or catchup_top';
  end if;
  if p_level is null or p_level < 0 then raise exception 'card_level_xp_award: the level must be 0 or more'; end if;
  if p_levels is null or array_position(p_levels, null) is not null or exists (select 1 from unnest(p_levels) v where v < 0) then
    raise exception 'card_level_xp_award: the levels of the player must be a list of levels of 0 or more';
  end if;
  -- the mean of the top catchup_top levels (the card below it gets catchup_x; compared as level x n < sum, exact)
  select count(*), coalesce(sum(t.v), 0) into n, s from (select v from unnest(p_levels) v order by v desc limit top) t;
  if n > 0 and p_level * n < s then return floor(base * x)::int; end if;
  return base::int;
end $fn$;

create or replace function public.card_level_xp_award(p_source text, p_level int, p_levels int[]) returns int
language sql stable set search_path = public as $fn$
  select card_level_xp_award(p_source, p_level, p_levels, combat_v2_numbers(array['card_level']));
$fn$;

-- ============================================================ 3. the M1a trigger with the one XP formula
create or replace function public.card_progress_v2_check() returns trigger language plpgsql set search_path = public as $fn$
declare
  v_max int := balance_num('v2_level', 'max_level')::int;
  v_ppl int := balance_num('v2_level', 'points_per_level')::int;
  v_cap int := balance_num('v2_stats', 'max_per_stat')::int;
  v_spent int := new.atk_pts + new.def_pts + new.hp_pts + new.crd_pts + new.crt_pts + new.abl_pts + new.ddg_pts + new.acc_pts + new.spd_pts;
  v_at int; v_next int;
begin
  if tg_op = 'UPDATE' and (new.id, new.player_id, new.card_id) is distinct from (old.id, old.player_id, old.card_id) then
    raise exception 'card_progress_v2: the id, player and card of a row never change (the ledger rows name the id)';
  end if;
  if new.level > v_max then
    raise exception 'card_progress_v2 %: level % is above v2_level.max_level %', new.id, new.level, v_max;
  end if;
  if greatest(new.atk_pts, new.def_pts, new.hp_pts, new.crd_pts, new.crt_pts, new.abl_pts, new.ddg_pts, new.acc_pts, new.spd_pts) > v_cap then
    raise exception 'card_progress_v2 %: a stat has more than v2_stats.max_per_stat % points', new.id, v_cap;
  end if;
  if v_spent > new.level * v_ppl + new.bonus_points then
    raise exception 'card_progress_v2 %: % points spent, but level % gives % and the bonus is %', new.id, v_spent, new.level, new.level * v_ppl, new.bonus_points;
  end if;
  -- the XP of the level (card_level_xp_at: the one formula; it refuses a level below 0 and a missing balance number)
  v_at := card_level_xp_at(new.level);
  if new.level < v_max then v_next := card_level_xp_at(new.level + 1); end if;
  if new.xp < v_at or (new.level < v_max and new.xp >= v_next) then
    raise exception 'card_progress_v2 %: % XP is not level % (card_level: level % needs % to % XP)', new.id, new.xp, new.level, new.level, v_at,
      case when new.level < v_max then (v_next - 1)::text else 'any' end;
  end if;
  new.updated_at := now();
  return new;
end $fn$;

-- ============================================================ 4. card_combat_v2 with the bonus points in the budget
create or replace function public.card_combat_v2(p_rarity text, p_stars int, p_mod numeric, p_level int, p_pts jsonb, p_role text, p_b jsonb, p_bonus int) returns jsonb
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
  if p_bonus is null or p_bonus < 0 then raise exception 'card_combat_v2: the bonus points must be 0 or more'; end if;
  -- ASC-3 (stars clamped to the curve: 0 to 5)
  s := greatest(0, least(coalesce(p_stars, 0), jsonb_array_length(a->'curve') - 1));
  cp_asc := base * (1 + (top / base - 1) * (a->'curve'->>s)::numeric) * coalesce(p_mod, 1);
  -- the level and the catch-up dial D
  lvl := least(p_level, (lv->>'max_level')::int);
  cp_base := cp_asc + (lv->>'converge_d')::numeric * lvl / (lv->>'max_level')::numeric * ((lv->>'target_cp')::numeric - cp_asc);
  lpts := lvl * (lv->>'points_per_level')::numeric;
  o := combat_v2_stats(cp_base, p_pts, p_role, p_b);
  select coalesce(sum(x.value::numeric), 0) into spent from jsonb_each_text(coalesce(p_pts, '{}'::jsonb)) x;
  -- the budget: the level points + the bonus points (a refund, plan 20.11 decision 3)
  if spent > lpts + p_bonus then
    if p_bonus = 0 then raise exception 'card_combat_v2: % points spent, the level % gives %', spent, p_level, lpts; end if;
    raise exception 'card_combat_v2: % points spent, the level % gives % and the bonus is %', spent, p_level, lpts, p_bonus;
  end if;
  return jsonb_build_object(
    'rarity', r, 'stars', s, 'level', lvl, 'role', ro.key, 'class', ro.class,
    'cp_asc', cp_asc, 'cp_base', cp_base,
    'power', case when ro.class = 'support' then power(cp_base / (su->>'power_ref')::numeric, (su->>'power_exp')::numeric) else 1 end,
    'extra_stack', case when su->'enabler_extra_stack' ? p_rarity then 1 else 0 end,
    'points', o->'points', 'points_level', lpts, 'points_free', lpts + p_bonus - spent,
    'stats', o - 'points' - 'spd_x', 'spd_x', o->'spd_x',
    'passive', jsonb_build_object('key', ro.key, 'label', ro.label, 'class', ro.class, 'text', ro.passive,
                                  'numbers', balance_path(ro.numbers), 'speed', balance_path(ro.speed)));
end $fn$;

create or replace function public.card_combat_v2(p_rarity text, p_stars int, p_mod numeric, p_level int, p_pts jsonb, p_role text, p_b jsonb) returns jsonb
language sql stable set search_path = public as $fn$
  select card_combat_v2(p_rarity, p_stars, p_mod, p_level, p_pts, p_role, p_b, 0);
$fn$;

-- ============================================================ 5. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['card_level_xp_at(integer, jsonb)', 'card_level_xp_at(integer)', 'card_level_of_xp(integer, jsonb)', 'card_level_of_xp(integer)',
                           'card_level_xp_award(text, integer, integer[], jsonb)', 'card_level_xp_award(text, integer, integer[])',
                           'card_combat_v2(text, integer, numeric, integer, jsonb, text, jsonb, integer)',
                           'card_combat_v2(text, integer, numeric, integer, jsonb, text, jsonb)', 'card_progress_v2_check()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.card_level_xp_at(integer, jsonb) is $cm$[combat] Combat v2 card levels (plan 2.4): the total XP of a level with the given numbers (card_level, v2_level). Level L to L + 1 costs card_level.cost_base + cost_per_level x L (today 5 + L: level 3 = 18, level 30 = 585). Refuses a level below 0 or above v2_level.max_level and a missing number. PURE. combat_v2_progress_math.sql.$cm$;
comment on function public.card_level_xp_at(integer) is $cm$[combat] card_level_xp_at with the numbers of balance card_level and v2_level. Reads only. combat_v2_progress_math.sql.$cm$;
comment on function public.card_level_of_xp(integer, jsonb) is $cm$[combat] Combat v2 card levels (plan 2.4): the level of an XP with the given numbers: the highest level (0 to v2_level.max_level) whose card_level_xp_at is at most the XP. Refuses an XP below 0 and a missing number. PURE. combat_v2_progress_math.sql.$cm$;
comment on function public.card_level_of_xp(integer) is $cm$[combat] card_level_of_xp with the numbers of balance card_level and v2_level. Reads only. combat_v2_progress_math.sql.$cm$;
comment on function public.card_level_xp_award(text, integer, integer[], jsonb) is $cm$[combat] Combat v2 card levels (plan 2.4): the XP of one fight-day of a card with the given numbers: card_level.xp_hunt_day (source hunt) or xp_dungeon_run (source dungeon; the Gauntlet gives no XP). The catch-up rule: the levels are the levels of the player's v2 cards; a card below the mean of the top card_level.catchup_top of them gets floor(XP x catchup_x). An empty list gives no catch-up. Refuses another source, a level below 0, a bad list and a missing number. PURE. combat_v2_progress_math.sql.$cm$;
comment on function public.card_level_xp_award(text, integer, integer[]) is $cm$[combat] card_level_xp_award with the numbers of balance card_level. Reads only. combat_v2_progress_math.sql.$cm$;
comment on function public.card_combat_v2(text, integer, numeric, integer, jsonb, text, jsonb, integer) is $cm$[combat] Combat v2: the stat line of one card (plan 2.1 to 2.4) with bonus points: ASC-3 (v2_asc), the level points and the catch-up dial D (v2_level), the 9 stats (combat_v2_stats), the support factor (v2_support), the role and its passive (the roles table). The points spent may be up to level x points_per_level + the bonus points (a refund, plan 20.11 decision 3); points_free = level points + bonus - spent. Refuses an unknown rarity or role, a negative level, a bonus below 0, bad points and more points than the budget. Exact numbers. combat_v2_progress_math.sql (the body of combat_v2_stats.sql + the bonus).$cm$;
comment on function public.card_combat_v2(text, integer, numeric, integer, jsonb, text, jsonb) is $cm$[combat] Combat v2: the stat line of one card with no bonus points (card_combat_v2 with bonus 0: the answer of combat_v2_stats.sql). card_combat (v1) is not changed. combat_v2_progress_math.sql.$cm$;
comment on function public.card_progress_v2_check() is $cm$[combat] Trigger (before insert, update on card_progress_v2): refuses a level above v2_level.max_level, a stat above v2_stats.max_per_stat, more points spent than level x v2_level.points_per_level + bonus_points, an XP that is not the XP of the level (card_level_xp_at: the one formula), and a change of the id, player or card. Sets updated_at. combat_v2_progress_tables.sql, the XP check through card_level_xp_at since combat_v2_progress_math.sql.$cm$;

notify pgrst, 'reload schema';
