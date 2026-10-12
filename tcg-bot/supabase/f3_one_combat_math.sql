-- f3_one_combat_math.sql (2026-10-11, F-3 PR 1, docs/foundations.md "F-3. Combat in one place", items 3, 4 and 9).
-- Nathan, 2026-10-11: "lets make it one PLACE"; the stat decisions: "Attack raises only attack power. Vitality raises only HP";
-- Haste works in fights (the approved recommendations); no free reset of points ("not for now").
--
-- 1. Haste works in fights. Before (observed): hunt_support and dungeon_support used the raw ability cooldown, so Haste points
--    did nothing in a fight (only boons and pranks read them). Now: cooldown = combat_cooldown(raw, haste)
--    = greatest(1, round(raw x haste)). round (to the nearest round), not ceil or floor:
--      - ceil needs 9 points before a 3-round cooldown moves (0.64 x 3 = 1.92 -> 2); round needs 5 (0.80 x 3 = 2.4 -> 2);
--      - floor gives a 2-round cooldown -> 1 with ONE point (0.96 x 2 = 1.92 -> 1), a 50% cut for 4%;
--      - round is the nearest whole round to "-4% per point": the first point that matters is point 3 (cooldown 5),
--        4 (cooldown 4), 5 (cooldown 3) or 7 (cooldown 2). A cooldown is never below 1 round (greatest(1, ...)).
--    With no Haste points (haste = 1) every cooldown is the same as before: the golden fights do not change.
-- 2. Attack raises only attack power. Before (observed): card_combat calculated HP from the CP AFTER the Attack bonus, so 1 Attack
--    point gave +5% CP and +5% HP. Now: HP = card_max_hp(the CP before the Attack bonus) x (1 + vitality x points). With no Attack
--    points the HP is the same as before.
-- 3. One combat math. The auto-pick (squad-pick.js bestSquad / teamValue / supportValue) and the Team CP (main.js
--    computeSquadStats) copied the synergy, weakness and crit numbers in JS. They now call SQL:
--      - combat_squad_core: the squad synergy and the weak stack of one card, from card facts (combat_card_facts). combat_squad
--        (the fights) now builds the facts and calls it, so the fight and the auto-pick use ONE calculation.
--      - combat_weak_mult: the weakness multiplier. combat_weak (the fights) calls it.
--      - combat_squad_value: the value of each attacker of a squad = cp x weakness x synergy x armored, the same factors
--        combat_hit uses (the roll, the buffs and the crit are the same for every squad).
--      - hunt_squad_value (Team CP, the synergy chips) and hunt_autopick (the auto-pick) read it.
--      - hunt_card_crits: the crit chance of each attacker (combat_crit_chance) for the card viewer (hunt_view 'crit').
--    The numbers of the auto-pick search (how it weighs two supports) are the balance key autopick.
-- Tests: card-studio/scripts/test-f3-combat-math.mjs (and the golden fights, card-studio/scripts/combat-golden.mjs, on the LOCAL copy).

-- GUARD (the combat_core.sql rule): each function this file replaces must be the live text it was built from (or the text this file made).
do $g$
declare m text; f text; ok text[];
begin
  foreach f in array array[
    'public.card_combat(text, integer, numeric, jsonb, jsonb)|ef946d0ed4e109d6ab85b3219d9f417e|c213fbf8f94214b5d2b316b6b21efd7b',
    'public.combat_squad(text[], boolean, jsonb, jsonb)|8395926de7607dd8f187c45a3555f1c9|ae971d84f72e316da1890e45373a71cf',
    'public.combat_weak(jsonb, jsonb, text, text, text, text[], integer)|98c1aad65e30464beb60d98c4aa6e538|08f4e644e8adb9f260f27592b8aef9bd',
    'public.hunt_support(text, bigint, bigint, bigint)|fc9e9f0040a9c09d090d75145820b6c3|558ae31f748d04cbb4f9ad6533e61edc',
    'public.dungeon_support(text, bigint, bigint, integer, text)|eb559373ab9a79aea8eb98fceefbdaec|b0becbb6202d44da2ff811db0a384653',
    'public.hunt_view(text, bigint, date)|52785d0ec5e3d1fb4544b091fd1affba|7998a24aa0fc6aecc685369fe945e555'] loop
    ok := string_to_array(f, '|');
    select md5(replace(pg_get_functiondef(ok[1]::regprocedure), chr(13), '')) into strict m;
    if m not in (ok[2], ok[3]) then
      raise exception 'f3_one_combat_math.sql: the live % changed since this file was built (md5 %). Rebuild it from the live text.', ok[1], m;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- The balance key of the auto-pick search (not a fight number: how the pick weighs two supports against each other).
insert into public.balance (key, value, note) values ('autopick',
  '{"repeat_x": 0.5, "same_role_x": 0.85, "effect_x": {"cleanse": 0.6}, "sustain": ["heal", "shield", "weaken"], "candidates": 30}'::jsonb,
  'The Hunt auto-pick (hunt_autopick). Two supports: the second one counts x repeat_x when it has the same effect as the first, '
  'x same_role_x when both keep the squad alive (sustain) or both add damage; effect_x weighs an effect (cleanse helps only against a debuff). '
  'candidates: at most this many attackers enter the search (the strongest by their best possible value; the cards that fought today always enter). '
  'The fight numbers (synergy, weakness, armored, affinity) come from combat, boss_passives and support.')
on conflict (key) do nothing;

-- 1. The cooldown of a support with Haste points: the nearest whole round, never below 1 round.
-- (plpgsql: a SQL function with SET search_path is planned again on every call.)
CREATE OR REPLACE FUNCTION public.combat_cooldown(p_raw integer, p_haste numeric)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
begin
  return greatest(1, round(coalesce(p_raw, 1) * coalesce(p_haste, 1)))::int;
end $function$;

-- 2. card_combat: Attack raises only the CP. HP comes from the CP before the Attack bonus; Vitality alone raises it.
CREATE OR REPLACE FUNCTION public.card_combat(p_rarity text, p_asc integer, p_mod numeric, p_pts jsonb, p_b jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c jsonb := p_b->'stat_points';
  a int := greatest(0, least(5, coalesce(p_asc, 0)));
  pts jsonb := coalesce(p_pts, '{}'::jsonb);
  fl numeric := (p_b->'card_hp'->>'floor')::numeric; per numeric := (p_b->'card_hp'->>'per_cp')::numeric;
  mx int := (c->>'max_per_stat')::int;
  v_x numeric; v_cp int; v_spent int; sa int; sv int; sp int; sq int; sh int;
begin
  if c is null or p_b->'rarity_cp' is null or p_b->'stars' is null or fl is null or per is null or mx is null then
    raise exception 'balance: no value for the combat keys (stat_points, rarity_cp, stars, card_hp)';
  end if;
  v_x := card_cp_exact(p_rarity, a, p_mod, p_b->'rarity_cp', p_b->'stars');
  if not coalesce((c->>'enabled')::boolean, false) then
    v_cp := round(v_x)::int;
    return jsonb_build_object('on', false, 'cp', v_cp, 'hp', card_max_hp(v_cp, fl, per), 'crit', 0,
      'potency', 1, 'haste', 1, 'free', 0);
  end if;
  sa := stat_pt(pts, 'attack', mx); sv := stat_pt(pts, 'vitality', mx); sp := stat_pt(pts, 'precision', mx);
  sq := stat_pt(pts, 'potency', mx); sh := stat_pt(pts, 'haste', mx);
  v_spent := sa + sv + sp + sq + sh;
  v_cp := round(v_x * (1 + (c->>'attack')::numeric * sa))::int;
  return jsonb_build_object('on', true, 'cp', v_cp,
    -- F-3 (Nathan, 2026-10-11): the HP of the CP BEFORE the Attack bonus (round(v_x)), so an Attack point does not raise HP.
    'hp', round(card_max_hp(round(v_x)::int, fl, per) * (1 + (c->>'vitality')::numeric * sv))::int,
    'crit', (c->>'precision')::numeric * sp,
    'potency', 1 + (c->>'potency')::numeric * sq,
    'haste', greatest((c->>'haste_floor')::numeric, 1 - (c->>'haste')::numeric * sh),
    'free', greatest(0, (c->>'per_star')::int * a - v_spent));
end $function$;

-- 3. The squad facts of one card (what the synergy reads from its tags), and whether it carries a weak tag of the boss.
--    elem: the dominant element (= card_element); els: every element of its tags (= element_of of each tag); origin: its
--    origin tag; kinds: its trait tags that are not an element name; tags: all its tags.
--    The element list is element_aliases(), read once per session (combat_element_map is IMMUTABLE: the cached plan holds it).
--    The reason: card_element and element_of are planned again on each call (~0.7 ms for one card); a fight reads 8 cards.
--    test-f3-combat-math.mjs checks elem = card_element and els = element_of for every subject.
CREATE OR REPLACE FUNCTION public.combat_element_map()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('alias', jsonb_object_agg(a.alias, jsonb_build_array(a.element, a.ord)),
                            'canon', (select jsonb_agg(distinct x.element) from public.element_aliases() x))
  from public.element_aliases() a;
$function$;

CREATE OR REPLACE FUNCTION public.combat_card_facts(p_tags text[], p_wtags text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare m jsonb := public.combat_element_map(); t text; e jsonb; v_elem text; v_ord int; v_els jsonb := '[]'::jsonb; v_kinds jsonb := '[]'::jsonb; v_origin text;
begin
  foreach t in array coalesce(p_tags, '{}'::text[]) loop
    e := m->'alias'->lower(trim(regexp_replace(t, '^trait:', '', 'i')));   -- the alias rule of element_of / card_element
    if e is not null then
      if not v_els ? (e->>0) then v_els := v_els || to_jsonb(e->>0); end if;
      if v_ord is null or (e->>1)::int < v_ord then v_ord := (e->>1)::int; v_elem := e->>0; end if;
    end if;
    if v_origin is null and t like 'origin:%' then v_origin := t; end if;
    if t like 'trait:%' and not (m->'canon' ? substr(t, 7)) then v_kinds := v_kinds || to_jsonb(t); end if;
  end loop;
  return jsonb_build_object('elem', v_elem, 'els', v_els, 'origin', v_origin, 'kinds', v_kinds,
    'tags', coalesce(to_jsonb(p_tags), '[]'::jsonb), 'weak', coalesce(p_tags && p_wtags, false));
end $function$;

-- The squad synergy and the weak stack of one card (p_self) among the other cards (p_others), from their facts.
-- p_c = balance combat. The only synergy calculation: combat_squad (the fights) and combat_squad_value (auto-pick, Team CP) call it.
CREATE OR REPLACE FUNCTION public.combat_squad_core(p_self jsonb, p_self_in boolean, p_others jsonb, p_c jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare v_o jsonb := coalesce(p_others, '[]'::jsonb); v_stack int; v_elem text := p_self->>'elem'; v_syn int := 0; v_synmult numeric := 1;
  v_origin text := p_self->>'origin'; v_osyn int := 0; v_omult numeric := 1; v_kind text; v_ksyn int := 0; v_kmult numeric := 1;
  v_small numeric := (p_c->>'syn_small_at')::numeric; v_big numeric := (p_c->>'syn_big_at')::numeric;
begin
  if v_small is null or v_big is null or p_c->>'syn_cap' is null or p_c->>'element_big' is null or p_c->>'element_small' is null
     or p_c->>'origin_big' is null or p_c->>'origin_small' is null or p_c->>'trait_big' is null or p_c->>'trait_small' is null then
    raise exception 'balance: no number for the squad synergy (combat.syn_*, element_*, origin_*, trait_*)';
  end if;
  -- The weak stack: the cards with a weak tag of the boss (this card too when it is in the fight).
  -- Element synergy: this card's dominant element + how many other cards have that element in their tags. Origin: the same for
  -- its origin tag. (One pass over the other cards.)
  select count(*) filter (where (o->>'weak')::boolean), count(*) filter (where o->'els' ? v_elem) + 1, count(*) filter (where o->'tags' ? v_origin) + 1
    into v_stack, v_syn, v_osyn from jsonb_array_elements(v_o) o;
  if p_self_in and coalesce((p_self->>'weak')::boolean, false) then v_stack := v_stack + 1; end if;
  if v_elem is null then v_syn := 0; end if;
  if v_origin is null then v_osyn := 0; end if;
  if v_elem is not null then
    if v_syn >= v_big then v_synmult := (p_c->>'element_big')::numeric; elsif v_syn >= v_small then v_synmult := (p_c->>'element_small')::numeric; end if;
  end if;
  if v_origin is not null then
    if v_osyn >= v_big then v_omult := (p_c->>'origin_big')::numeric; elsif v_osyn >= v_small then v_omult := (p_c->>'origin_small')::numeric; end if;
  end if;
  -- Trait (kind) synergy: the best-shared non-element trait.
  select k, count(*) into v_kind, v_ksyn from jsonb_array_elements_text(coalesce(p_self->'kinds', '[]'::jsonb)) k
    cross join jsonb_array_elements(v_o) o where o->'tags' ? k
    group by k order by count(*) desc, k limit 1;
  v_ksyn := coalesce(v_ksyn, 0);
  if v_ksyn > 0 then v_ksyn := v_ksyn + 1; if v_ksyn >= v_big then v_kmult := (p_c->>'trait_big')::numeric; elsif v_ksyn >= v_small then v_kmult := (p_c->>'trait_small')::numeric; end if; end if;
  v_synmult := least((p_c->>'syn_cap')::numeric, v_synmult * v_omult * v_kmult);
  return jsonb_build_object('stack', v_stack, 'elem', v_elem, 'syn', v_syn, 'synmult', v_synmult,
    'origin', v_origin, 'osyn', v_osyn, 'kind', v_kind, 'ksyn', v_ksyn);
end $function$;

-- combat_squad (hunt_attack, dungeon_attack): the same answer as before, from combat_squad_core.
CREATE OR REPLACE FUNCTION public.combat_squad(p_tags text[], p_self_in boolean, p_others jsonb, p_weak jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with w as (select array_agg(x->>'value') wt from jsonb_array_elements(coalesce(p_weak, '[]'::jsonb)) x where x->>'kind' = 'tag')
  select public.combat_squad_core(public.combat_card_facts(p_tags, w.wt), p_self_in,
    (select coalesce(jsonb_agg(public.combat_card_facts(array(select jsonb_array_elements_text(o)), w.wt)), '[]'::jsonb)
       from jsonb_array_elements(coalesce(p_others, '[]'::jsonb)) o),
    public.balance_get('combat'))
  from w;
$function$;

-- 4. The weakness multiplier from the counts (wm weak matches, rm resist matches, the weak stack). p_c = balance combat.
CREATE OR REPLACE FUNCTION public.combat_weak_mult(p_wm integer, p_rm integer, p_stack integer, p_c jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare v_step numeric := (p_c->>'weak_step')::numeric; v_free numeric := (p_c->>'weak_stack_free')::numeric; v_wmult numeric;
begin
  if v_step is null or v_free is null or p_c->>'resist_step' is null or p_c->>'resist_decay' is null or p_c->>'weak_min' is null or p_c->>'weak_max' is null then
    raise exception 'balance: no number for the weakness (combat.weak_*, resist_*)';
  end if;
  v_wmult := 1
    + (1 - power(v_step, p_wm)) * (case when p_stack <= v_free then 1 else power(v_step, p_stack - v_free) end)
    - (p_c->>'resist_step')::numeric * (1 - power((p_c->>'resist_decay')::numeric, p_rm));
  return greatest((p_c->>'weak_min')::numeric, least((p_c->>'weak_max')::numeric, v_wmult));
end $function$;

CREATE OR REPLACE FUNCTION public.combat_weak(p_weak jsonb, p_resist jsonb, p_type text, p_rarity text, p_season text, p_tags text[], p_stack integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_wm int; v_rm int;
begin
  select count(*) into v_wm from jsonb_array_elements(coalesce(p_weak, '[]'::jsonb)) w
    where (w->>'kind' = 'type'   and w->>'value' = p_type)
       or (w->>'kind' = 'rarity' and w->>'value' = p_rarity)
       or (w->>'kind' = 'season' and w->>'value' = p_season)
       or (w->>'kind' = 'tag'    and w->>'value' = any(p_tags));
  select count(*) into v_rm from jsonb_array_elements(coalesce(p_resist, '[]'::jsonb)) w
    where (w->>'kind' = 'type'   and w->>'value' = p_type)
       or (w->>'kind' = 'rarity' and w->>'value' = p_rarity)
       or (w->>'kind' = 'season' and w->>'value' = p_season)
       or (w->>'kind' = 'tag'    and w->>'value' = any(p_tags));
  return jsonb_build_object('wm', v_wm, 'rm', v_rm, 'mult', public.combat_weak_mult(v_wm, v_rm, p_stack, public.balance_get('combat')));
end $function$;

-- 5. The Hunt pool of a member: one entry per owned card (all of them, or the cards in p_cards), ordered by card id.
--    atk: an attacker; used / downed: it fought today / it is down today; cp, potency: card_combat; wm, rm: its weak and resist
--    matches (combat_weak); arm: x armored_x for a melee card on an armored boss (combat_hit); eff, aff: a support's effect and
--    affinity tag; fx: its squad facts (combat_card_facts).
CREATE OR REPLACE FUNCTION public.hunt_pick_pool(p_player text, p_hunt bigint, p_cards bigint[] DEFAULT NULL::bigint[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with h as (
    select weak_points w, resist_points r,
           array_remove(coalesce((select array_agg(x->>'kind') from jsonb_array_elements(coalesce(passive->'list', '[]'::jsonb)) x), array[passive->>'kind']), null) pl
      from hunts where id = p_hunt),
  wt as (select (select array_agg(x->>'value') from jsonb_array_elements(coalesce(h.w, '[]'::jsonb)) x where x->>'kind' = 'tag') t from h),
  b as (select card_balance() v, balance_num('boss_passives', 'armored_x') ax, (now() at time zone 'America/Denver')::date d)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'atk', s.type in ('Character', 'Creature'), 'used', hc.card_id is not null, 'downed', coalesce(hc.downed, false),
      'cp', (k.cmb->>'cp')::numeric, 'potency', coalesce((k.cmb->>'potency')::numeric, 1),
      'wm', (wk.v->>'wm')::int, 'rm', (wk.v->>'rm')::int,
      'arm', case when 'armored' = any(h.pl) and 'trait:melee' = any(s.tag_slugs) then b.ax else 1 end,
      'eff', case when s.ability->>'kind' = 'support' then s.ability->>'effect' end, 'aff', s.ability->>'affinity',
      'fx', combat_card_facts(s.tag_slugs, wt.t)) order by c.id), '[]'::jsonb)
  from h, wt, b, player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  left join hunt_card_hp hc on hc.hunt_id = p_hunt and hc.player_id = p_player and hc.card_id = pc.card_id
    and hc.hit_date = (now() at time zone 'America/Denver')::date
  cross join lateral (select card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points, b.v) cmb) k
  cross join lateral (select combat_weak(h.w, h.r, s.type, c.rarity::text, c.season, s.tag_slugs, 0) v) wk
  where pc.player_id = p_player and pc.quantity > 0 and (p_cards is null or pc.card_id = any(p_cards));
$function$;

-- 6. The value of each attacker of a squad. p_members = the pool entries (hunt_pick_pool) of the squad, each card once; the first
--    p_n are the squad, the rest count for the synergy and the weak stack only (the cards that fought today, the supports).
--    value = cp x weakness x synergy x armored: the factors of combat_hit that depend on the squad (the roll, the buffs, the
--    crit and the block are the same for every squad). p_c = balance combat. i = the position in p_members (0-based).
CREATE OR REPLACE FUNCTION public.combat_squad_value(p_members jsonb, p_n integer, p_c jsonb)
 RETURNS TABLE(i integer, id bigint, cp numeric, wmult numeric, synmult numeric, value numeric, sq jsonb)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare k int; e jsonb; s jsonb; w numeric; n int := jsonb_array_length(coalesce(p_members, '[]'::jsonb));
  fx jsonb := coalesce((select jsonb_agg(m->'fx' order by o) from jsonb_array_elements(p_members) with ordinality q(m, o)), '[]'::jsonb);
begin
  for k in 0 .. least(p_n, n) - 1 loop
    e := p_members->k;
    continue when not (e->>'atk')::boolean;
    s := public.combat_squad_core(e->'fx', true, fx - k, p_c);   -- the other cards: all but this one
    w := public.combat_weak_mult((e->>'wm')::int, (e->>'rm')::int, (s->>'stack')::int, p_c);
    i := k; id := (e->>'id')::bigint; cp := (e->>'cp')::numeric; wmult := w; synmult := (s->>'synmult')::numeric;
    value := cp * w * synmult * (e->>'arm')::numeric; sq := s;
    return next;
  end loop;
end $function$;

-- 7. Team CP and the synergy chips of a squad (GET /api/hunt/squad-value). One call for each squad change on the screen.
--    cp: the sum of the attackers' CP; team_cp: the sum of CP x synergy (the old "Team CP"); value: the sum of the fight values;
--    cards: each attacker's factors; groups: each synergy of the squad (element / origin / trait), how many cards share it,
--    on = it is active (syn_small_at), max = syn_big_at.
CREATE OR REPLACE FUNCTION public.hunt_squad_value(p_player text, p_hunt bigint, p_cards bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare c jsonb := balance_get('combat'); pool jsonb; n int; res jsonb;
begin
  pool := hunt_pick_pool(p_player, p_hunt, coalesce(p_cards, '{}'));
  n := jsonb_array_length(pool);
  with r as (select v.* from combat_squad_value(pool, n, c) v),
  g as (
    select 'element' kind, sq->>'elem' key, max((sq->>'syn')::int) n from r where sq->>'elem' is not null group by 2
    union all select 'origin', sq->>'origin', max((sq->>'osyn')::int) from r where sq->>'origin' is not null group by 2
    union all select 'trait', sq->>'kind', max((sq->>'ksyn')::int) from r where sq->>'kind' is not null group by 2)
  select jsonb_build_object(
    'cp', coalesce((select sum(cp) from r), 0)::bigint,
    'team_cp', coalesce((select round(sum(cp * synmult)) from r), 0)::bigint,
    'value', coalesce((select sum(value) from r), 0),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'cp', cp, 'wmult', wmult, 'synmult', synmult, 'value', value) order by id) from r), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'key', key, 'n', g.n, 'on', g.n >= (c->>'syn_small_at')::numeric,
                         'max', (c->>'syn_big_at')::int) order by g.n desc, kind, key) from g), '[]'::jsonb))
  into res;
  return res;
end $function$;

-- 8. The auto-pick (GET /api/hunt/autopick): the squad with the highest team value the member can field TODAY. It is the
--    search of squad-pick.js bestSquad (2026-10-01), moved here so it uses the fight's own calculation (combat_squad_value).
--    A downed card never goes in. A card that fought today and still stands is free; a new card needs a free daily slot.
--    The squad: 2 supports (the best pair for this squad) + the attackers with the highest value; supports fill more slots
--    only when the attackers run out. The returned ids: the attackers (strongest first), then the supports.
-- The team value of p_team (positions in p_ent, 0-based) with the cards p_ctx in the fight too.
CREATE OR REPLACE FUNCTION public.hunt_autopick_val(p_ent jsonb[], p_team integer[], p_ctx integer[], p_c jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(v.value), 0) from public.combat_squad_value(
    to_jsonb(array(select p_ent[t.z + 1] from unnest(p_team) with ordinality t(z, o) order by t.o)
          || array(select p_ent[x.z + 1] from (select distinct z from unnest(p_ctx) z where z <> all(p_team)) x order by x.z)),
    cardinality(p_team), p_c) v;
$function$;

-- Add attackers one at a time (the largest gain in team value first) while the squad has room and the daily limit allows.
-- p_keep = the new daily slots kept for the supports that are not picked yet.
CREATE OR REPLACE FUNCTION public.hunt_autopick_add(p_ent jsonb[], p_c jsonb, p_atk integer[], p_team integer[], p_sups integer[],
  p_usedtoday integer[], p_used boolean[], p_lim integer, p_cap integer, p_newslots integer, p_keep integer)
 RETURNS integer[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare team int[] := coalesce(p_team, '{}'); x int; best int; gain numeric; g numeric; base numeric; nfresh int;
begin
  while cardinality(team) < p_lim and cardinality(team) + cardinality(p_sups) < p_cap loop
    base := hunt_autopick_val(p_ent, team, p_usedtoday || p_sups, p_c);
    nfresh := (select count(*) from unnest(team || p_sups) z where not p_used[z + 1])::int;
    best := null; gain := null;
    foreach x in array p_atk loop
      continue when x = any(team) or (not p_used[x + 1] and nfresh + p_keep >= p_newslots);
      g := hunt_autopick_val(p_ent, team || x, p_usedtoday || p_sups, p_c) - base;
      if gain is null or g > gain then gain := g; best := x; end if;
    end loop;
    exit when best is null;
    team := team || best;
  end loop;
  return team;
end $function$;

-- The supports with the highest support value for this squad: every pair (p_k >= 2) or, with no pair, every single one (p_k >= 1).
-- One support's value: its effect weight (autopick.effect_x) x its Potency x the affinity scale (combat_aff_scale) for the cards
-- with its affinity tag. Of two supports the stronger counts in full; the other x repeat_x for the same effect, x same_role_x
-- when both keep the squad alive (autopick.sustain) or both add damage.
CREATE OR REPLACE FUNCTION public.hunt_autopick_sups(p_k integer, p_sup integer[], p_team integer[], p_usedtoday integer[], p_used boolean[],
  p_newslots integer, p_eff text[], p_aff text[], p_pot numeric[], p_tags jsonb[], p_scale numeric[], p_ap jsonb)
 RETURNS integer[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare nfresh int := (select count(*) from unnest(p_team) z where not p_used[z + 1])::int;
  inu boolean[]; basecnt int[]; ok int[]; i int; j int; x int; y int; a numeric; b numeric; v numeric; bestv numeric := -1; best int[] := '{}';
  sustain text[] := array(select jsonb_array_elements_text(coalesce(p_ap->'sustain', '[]'::jsonb)));
  rep numeric := (p_ap->>'repeat_x')::numeric; same numeric := (p_ap->>'same_role_x')::numeric; n int := cardinality(p_used);
begin
  if coalesce(p_k, 0) < 1 then return '{}'; end if;
  -- U = the cards that fought today and the attackers. The affinity count over U counts each card once (as hunt_support does).
  inu := array(select z = any(p_usedtoday || p_team) from generate_series(0, n - 1) z);
  basecnt := array(select case when p_aff[z + 1] is null then 0 else
      (select count(*) from (select distinct m from unnest(p_usedtoday || p_team) m) mm where p_tags[mm.m + 1] ? p_aff[z + 1]) end::int
    from generate_series(0, n - 1) z);
  ok := array(select z from unnest(p_sup) z where p_used[z + 1] or nfresh < p_newslots);
  if p_k >= 2 then
    for i in 1 .. cardinality(ok) loop
      for j in i + 1 .. cardinality(ok) loop
        x := ok[i]; y := ok[j];
        continue when (case when p_used[x + 1] then 0 else 1 end) + (case when p_used[y + 1] then 0 else 1 end) + nfresh > p_newslots;
        a := coalesce((p_ap->'effect_x'->>p_eff[x + 1])::numeric, 1) * p_pot[x + 1] * p_scale[1 + case when p_aff[x + 1] is null then 0 else basecnt[x + 1]
               + (case when not inu[x + 1] and p_tags[x + 1] ? p_aff[x + 1] then 1 else 0 end) + (case when not inu[y + 1] and p_tags[y + 1] ? p_aff[x + 1] then 1 else 0 end) end];
        b := coalesce((p_ap->'effect_x'->>p_eff[y + 1])::numeric, 1) * p_pot[y + 1] * p_scale[1 + case when p_aff[y + 1] is null then 0 else basecnt[y + 1]
               + (case when not inu[y + 1] and p_tags[y + 1] ? p_aff[y + 1] then 1 else 0 end) + (case when not inu[x + 1] and p_tags[x + 1] ? p_aff[y + 1] then 1 else 0 end) end];
        if b > a then v := a; a := b; b := v; end if;
        v := a + b * case when p_eff[x + 1] is not distinct from p_eff[y + 1] then rep
                          when coalesce(p_eff[x + 1] = any(sustain), false) = coalesce(p_eff[y + 1] = any(sustain), false) then same else 1 end;
        if v > bestv + 1e-9 then bestv := v; best := array[x, y]; end if;
      end loop;
    end loop;
  end if;
  if cardinality(best) = 0 then
    foreach x in array ok loop
      continue when (case when p_used[x + 1] then 0 else 1 end) + nfresh > p_newslots;
      v := coalesce((p_ap->'effect_x'->>p_eff[x + 1])::numeric, 1) * p_pot[x + 1] * p_scale[1 + case when p_aff[x + 1] is null then 0 else basecnt[x + 1]
             + (case when not inu[x + 1] and p_tags[x + 1] ? p_aff[x + 1] then 1 else 0 end) end];
      if v > bestv + 1e-9 then bestv := v; best := array[x]; end if;
    end loop;
  end if;
  return best;
end $function$;

-- The search on a pool (hunt_pick_pool entries; the tests give it made-up pools, as squad-pick.test.js did).
CREATE OR REPLACE FUNCTION public.hunt_autopick_pool(p_pool jsonb, p_cap integer)
 RETURNS bigint[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c jsonb := balance_get('combat'); ap jsonb := balance_get('autopick');
  cap int := p_cap;
  pool jsonb := coalesce(p_pool, '[]'::jsonb); ent jsonb[]; n int; x int; i int; pass int;
  isatk boolean[] := '{}'; used boolean[] := '{}'; down boolean[] := '{}'; pot numeric[] := '{}'; eff text[] := '{}'; aff text[] := '{}'; tags jsonb[] := '{}';
  ub numeric[] := '{}'; lb numeric[] := '{}'; scale numeric[];
  atk int[] := '{}'; sup int[] := '{}'; usedtoday int[] := '{}'; team int[] := '{}'; sups int[] := '{}'; t int[];
  newslots int; room int; want int; keep0 int; nfresh int; best int; gain numeric; g numeric; base numeric; improved boolean; thr numeric;
  kmax int := (ap->>'candidates')::int;
begin
  if (ap->>'repeat_x') is null or (ap->>'same_role_x') is null or kmax is null then
    raise exception 'balance: no number for autopick (repeat_x, same_role_x, candidates)';
  end if;
  n := jsonb_array_length(pool);
  if n = 0 then return '{}'; end if;
  ent := array(select e from jsonb_array_elements(pool) with ordinality q(e, o) order by o);
  scale := array(select combat_aff_scale(z) from generate_series(0, n + 1) z);   -- scale[1] = 0 cards with the tag
  for x in 0 .. n - 1 loop
    isatk := isatk || (ent[x + 1]->>'atk')::boolean; used := used || (ent[x + 1]->>'used')::boolean; down := down || (ent[x + 1]->>'downed')::boolean;
    pot := pot || (ent[x + 1]->>'potency')::numeric; eff := eff || (ent[x + 1]->>'eff'); aff := aff || (ent[x + 1]->>'aff'); tags := tags || (ent[x + 1]->'fx'->'tags');
    -- the best and the worst value this card can have in any squad (for the candidate limit below)
    ub := ub || ((ent[x + 1]->>'cp')::numeric * combat_weak_mult((ent[x + 1]->>'wm')::int, (ent[x + 1]->>'rm')::int, 0, c) * (c->>'syn_cap')::numeric * (ent[x + 1]->>'arm')::numeric);
    lb := lb || ((ent[x + 1]->>'cp')::numeric * combat_weak_mult((ent[x + 1]->>'wm')::int, (ent[x + 1]->>'rm')::int, cap, c) * (ent[x + 1]->>'arm')::numeric);
    if used[x + 1] then usedtoday := usedtoday || x; end if;
    if not down[x + 1] then if isatk[x + 1] then atk := atk || x; else sup := sup || x; end if; end if;
  end loop;
  newslots := greatest(0, cap - cardinality(usedtoday));
  -- openSlots(cards, [], cap): the cards that fought today and stand + the new cards the daily limit still allows
  room := least(cap, (select count(*) from unnest(usedtoday) z where not down[z + 1])::int
    + least(newslots, (select count(*) from generate_series(0, n - 1) z where not used[z + 1] and not down[z + 1])::int));
  want := least(2, cardinality(sup));
  keep0 := greatest(0, want - (select count(*) from unnest(sup) z where used[z + 1])::int);
  -- The candidates: an attacker whose best value is below the worst value of `room` other attackers does not enter;
  -- then at most autopick.candidates by their best value, and every attacker that fought today (it is free).
  thr := coalesce((select lb[z + 1] from unnest(atk) z order by lb[z + 1] desc offset greatest(0, room - 1) limit 1), 0);
  atk := array(select q.z from (select z from unnest(atk) z where used[z + 1] or ub[z + 1] >= thr
                                 order by used[z + 1] desc, ub[z + 1] desc, z limit greatest(kmax, cardinality(usedtoday))) q order by q.z);

  -- 1. attackers, leaving the support slots
  team := hunt_autopick_add(ent, c, atk, team, sups, usedtoday, used, greatest(0, room - want), cap, newslots, keep0);
  -- 2. the best supports for these attackers
  sups := hunt_autopick_sups(least(want, room - cardinality(team)), sup, team, usedtoday, used, newslots, eff, aff, pot, tags, scale, ap);
  -- 3. swaps: replace an attacker with one outside while the value rises (synergy can make two weaker cards of one element
  --    beat one strong card), then the supports again for the final squad
  for pass in 1 .. 20 loop
    improved := false;
    for i in 1 .. cardinality(team) loop
      base := hunt_autopick_val(ent, team, usedtoday || sups, c);
      nfresh := (select count(*) from unnest(team || sups) z where not used[z + 1])::int;
      best := null; gain := 1e-9;
      foreach x in array atk loop
        continue when x = any(team) or (not used[x + 1]
          and nfresh - (case when not used[team[i] + 1] then 1 else 0 end) + (case when cardinality(sups) > 0 then 0 else keep0 end) >= newslots);
        t := team; t[i] := x;
        g := hunt_autopick_val(ent, t, usedtoday || sups, c) - base;
        if g > gain then gain := g; best := x; end if;
      end loop;
      if best is not null then team[i] := best; improved := true; end if;
    end loop;
    exit when not improved;
  end loop;
  sups := hunt_autopick_sups(cardinality(sups), sup, team, usedtoday, used, newslots, eff, aff, pot, tags, scale, ap);
  -- 4. a slot left (fewer supports): an attacker
  team := hunt_autopick_add(ent, c, atk, team, sups, usedtoday, used, cap, cap, newslots, case when cardinality(sups) > 0 then 0 else keep0 end);
  -- 5. too few attackers: more supports, the strongest for this squad first
  foreach x in array array(select z from unnest(sup) z order by
      coalesce((ap->'effect_x'->>eff[z + 1])::numeric, 1) * pot[z + 1]
        * scale[1 + case when aff[z + 1] is null then 0 else (select count(*) from unnest(team || sups) m where tags[m + 1] ? aff[z + 1])::int end] desc, z) loop
    exit when cardinality(team) + cardinality(sups) >= cap;
    continue when x = any(sups) or (not used[x + 1] and (select count(*) from unnest(team || sups) z where not used[z + 1]) >= newslots);
    sups := sups || x;
  end loop;
  -- the attackers strongest first (each one's value in the final squad), then the supports
  return array(select (ent[u.z + 1]->>'id')::bigint from unnest(team) with ordinality u(z, o)
                order by hunt_autopick_val(ent, array[u.z], usedtoday || team || sups, c) desc, u.o)
      || array(select (ent[u.z + 1]->>'id')::bigint from unnest(sups) with ordinality u(z, o) order by u.o);
end $function$;

-- The auto-pick of a member on a boss (cap: balance daily_card_cap).
CREATE OR REPLACE FUNCTION public.hunt_autopick(p_player text, p_hunt bigint, p_cap integer DEFAULT NULL::integer)
 RETURNS bigint[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.hunt_autopick_pool(public.hunt_pick_pool(p_player, p_hunt, null), coalesce(p_cap, public.hunt_card_cap()));
$function$;

-- 9. The crit chance of each attacker of the member on this boss (combat_crit_chance: the weakness bonus, a focus ability,
--    the Precision points under the cap), for the card viewer. hunt_view returns it as 'crit'. Each function runs once for
--    each distinct input, not once for each card (hunt_view is on the Hunt screen's path):
--      - combat_weak gets only the card's tags that are weak tags of the boss (its tag rule tests "value = any(tags)", so the
--        count is the same);
--      - the crit part of card_combat depends on the points only (not the rarity, the stars or cp_mod).
CREATE OR REPLACE FUNCTION public.hunt_card_crits(p_player text, p_hunt bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_w jsonb; v_r jsonb; v_wt text[]; v_b jsonb := card_balance(); res jsonb;
begin
  select weak_points, resist_points into v_w, v_r from hunts where id = p_hunt;
  v_wt := array(select x->>'value' from jsonb_array_elements(coalesce(v_w, '[]'::jsonb)) x where x->>'kind' = 'tag');
  with k as materialized (
    select c.id, s.type, c.rarity::text rar, c.season, array(select t from unnest(s.tag_slugs) t where t = any(v_wt) order by t) wtags,
           case when s.ability->>'kind' = 'attack' then s.ability->>'effect' end aeff, coalesce((s.ability->>'amount')::numeric, 0) aamt,
           coalesce(pc.stat_points, '{}'::jsonb) pts
      from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
     where pc.player_id = p_player and pc.quantity > 0 and s.type in ('Character', 'Creature')),
  wk as materialized (select d.*, (combat_weak(v_w, v_r, d.type, d.rar, d.season, d.wtags, 0)->>'wm')::int > 0 bonus
                        from (select distinct type, rar, season, wtags from k) d),
  p as materialized (select d.pts, card_combat('normal', 0, 1, d.pts, v_b) cmb from (select distinct pts from k) d),
  kk as materialized (select k.id, wk.bonus, k.aeff, k.aamt, k.pts from k join wk on wk.type = k.type and wk.rar = k.rar
                        and wk.season is not distinct from k.season and wk.wtags = k.wtags),
  x as materialized (select d.*, combat_crit_chance(d.bonus, d.aeff, d.aamt, p.cmb) crit
                       from (select distinct bonus, aeff, aamt, pts from kk) d join p on p.pts = d.pts)
  select coalesce(jsonb_object_agg(kk.id::text, x.crit), '{}'::jsonb) into res
    from kk join x on x.bonus = kk.bonus and x.aeff is not distinct from kk.aeff and x.aamt = kk.aamt and x.pts = kk.pts;
  return res;
end $function$;

comment on function public.combat_cooldown(integer, numeric) is 'F-3: a support cooldown with Haste points: greatest(1, round(raw x haste)). hunt_support and dungeon_support.';
comment on function public.combat_element_map() is 'F-3: element_aliases() as one jsonb (alias -> [element, ord], canon), read once per session by combat_card_facts.';
comment on function public.combat_card_facts(text[], text[]) is 'F-3: the squad facts of one card (dominant element, elements, origin, kinds, tags, weak tag of the boss) for combat_squad_core.';
comment on function public.combat_squad_core(jsonb, boolean, jsonb, jsonb) is 'F-3: the only squad synergy and weak-stack calculation (balance combat). combat_squad (fights) and combat_squad_value (auto-pick, Team CP) call it.';
comment on function public.combat_weak_mult(integer, integer, integer, jsonb) is 'F-3: the weakness multiplier from the weak and resist matches and the weak stack (balance combat). combat_weak calls it.';
comment on function public.combat_squad_value(jsonb, integer, jsonb) is 'F-3: the value of each attacker of a squad = cp x weakness x synergy x armored (the squad factors of combat_hit).';
comment on function public.hunt_pick_pool(text, bigint, bigint[]) is 'F-3: the Hunt pool of a member (card_combat, combat_weak counts, armored, support effect, squad facts) for the auto-pick and Team CP.';
comment on function public.hunt_squad_value(text, bigint, bigint[]) is 'F-3: Team CP, the fight value and the synergy groups of a squad (GET /api/hunt/squad-value).';
comment on function public.hunt_autopick(text, bigint, integer) is 'F-3: the auto-pick (GET /api/hunt/autopick): the squad with the highest team value the member can field today.';
comment on function public.hunt_autopick_pool(jsonb, integer) is 'F-3: the auto-pick search on a pool (hunt_pick_pool entries); the tests give it made-up pools.';
comment on function public.hunt_autopick_val(jsonb[], integer[], integer[], jsonb) is 'F-3: the team value of a squad in the auto-pick search (combat_squad_value).';
comment on function public.hunt_autopick_add(jsonb[], jsonb, integer[], integer[], integer[], integer[], boolean[], integer, integer, integer, integer) is 'F-3: the auto-pick step that adds attackers by the largest gain in team value.';
comment on function public.hunt_autopick_sups(integer, integer[], integer[], integer[], boolean[], integer, text[], text[], numeric[], jsonb[], numeric[], jsonb) is 'F-3: the auto-pick step that picks the best support pair (balance autopick, combat_aff_scale).';
comment on function public.hunt_card_crits(text, bigint) is 'F-3: the crit chance of each attacker of a member on a boss (combat_crit_chance), hunt_view crit.';

-- 10. hunt_support: Haste shortens the cooldown (the live text; changed: v_scmb, v_cd).
CREATE OR REPLACE FUNCTION public.hunt_support(p_player text, p_hunt bigint, p_card bigint, p_target bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_rcap int; v_sdown boolean; v_stun_until int;
  v_status text; v_closes timestamptz; v_tier text; v_hp bigint;
  v_qty int; v_type text; v_ability jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text;
  v_day date; v_round int; v_cd_until int; v_cap int; v_maxhp int;
  v_tqty int; v_trar text; v_tasc int; v_tmod numeric; v_tmaxhp int; v_tcp int;
  v_tpts jsonb; v_srar text; v_sasc int; v_smod numeric; v_spts jsonb; v_scmb jsonb;
  v_aff text; v_ttags text[]; v_affcount int := 0; v_scale numeric := 1; v_matched boolean := false; v_sdmg int;
  v_settle jsonb;
  v_marks jsonb; v_plist text[]; v_f numeric := 1; v_ctr text[] := '{}'; v_gain int; v_tkind text; v_fail boolean := false;
begin
  select status, closes_at, tier into v_status, v_closes, v_tier from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  select coalesce(array_agg(x->>'kind'), '{}') into v_plist from hunts h, jsonb_array_elements(coalesce(h.passive->'list', '[]'::jsonb)) x where h.id = p_hunt;

  select pc.quantity, s.type, s.ability, c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points
    into v_qty, v_type, v_ability, v_srar, v_sasc, v_smod, v_spts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_ability is null or v_ability->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;

  v_eff := v_ability->>'effect';
  v_amt := coalesce((v_ability->>'amount')::numeric, 0);
  -- Potency points of this support copy make its effect stronger (1 with the flag off).
  v_scmb := card_combat(v_srar, v_sasc, v_smod, v_spts);
  v_amt := v_amt * coalesce((v_scmb->>'potency')::numeric, 1);
  v_dur := coalesce((v_ability->>'duration')::int, 1);
  -- F-3: Haste points shorten the cooldown (combat_cooldown: never below 1 round).
  v_cd  := combat_cooldown(coalesce((v_ability->>'cooldown')::int, 1), (v_scmb->>'haste')::numeric);
  v_tgt := coalesce(v_ability->>'target', 'boss');
  v_aff := v_ability->>'affinity';
  v_day := (now() at time zone 'America/Denver')::date;
  if not hunt_squad_allows(p_hunt, p_player, v_day, p_card) then -- hunt_squads.sql
    return jsonb_build_object('ok', false, 'error', 'not_in_squad');
  end if;
  v_round := hunt_state_round(p_hunt, p_player, v_day);

  -- The round limit (hunt_loop_caps.sql).
  v_rcap := hunt_round_cap();
  if v_round >= v_rcap then return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap); end if;
  select cd_until_round, downed or hp_remaining <= 0 into v_cd_until, v_sdown from hunt_card_hp
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  -- A support card that is down does nothing (hunt_loop_caps.sql: a downed heal card kept a squad alive).
  if coalesce(v_sdown, false) then return jsonb_build_object('ok', false, 'error', 'support_downed'); end if;
  if found and v_round < coalesce(v_cd_until, 0) then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', v_cd_until, 'round', v_round);
  end if;

  v_maxhp := card_max_hp(0);   -- a support card: the HP floor (60 since hunt_launch_balance.sql)
  if not hunt_commit_card(p_hunt, p_player, p_card, v_day, v_maxhp) then
    return jsonb_build_object('ok', false, 'error', 'day_limit');
  end if;

  -- Affinity synergy: how many committed squad cards share this support's affinity tag.
  if v_aff is not null then
    select count(distinct h.card_id) into v_affcount
    from hunt_card_hp h join cards c on c.id = h.card_id join subjects s on s.id = c.subject_id
    where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and v_aff = any(s.tag_slugs);
  end if;
  v_scale := combat_aff_scale(v_affcount);

  -- Counters (hunt_boss_moves.sql): the counter passives and the boss marks make this support weaker.
  select marks into v_marks from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  v_marks := coalesce(v_marks, '{}'::jsonb);
  if coalesce((v_marks->>'null_next')::int, 0) > 0 then   -- Packet Loss (1) / Shadow Ban (2): this play does nothing
    update hunt_combat_state set marks = case when (marks->>'null_next')::int > 1 then jsonb_set(marks, '{null_next}', to_jsonb((marks->>'null_next')::int - 1))
      else marks - 'null_next' end, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
      values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, 0, case when v_tgt in ('ally', 'self') then p_target end,
              jsonb_build_object('nullified', true, 'countered', jsonb_build_array('null_next')));
    return jsonb_build_object('ok', true, 'effect', v_eff, 'nullified', true, 'countered', jsonb_build_array('null_next'),
      'ready_round', v_round + v_cd, 'round', v_round, 'boss_hp', (select hp_remaining from hunts where id = p_hunt), 'defeated', false);
  end if;
  if v_eff = 'heal' and 'plague' = any(v_plist) then v_f := v_f * balance_num('boss_passives', 'plague_x'); v_ctr := v_ctr || 'plague'::text; end if;
  if v_eff in ('shield', 'smite') and 'shatterer' = any(v_plist) then v_f := v_f * balance_num('boss_passives', 'shatterer_x'); v_ctr := v_ctr || 'shatterer'::text; end if;
  if v_eff in ('empower', 'expose') and 'dispeller' = any(v_plist) then v_f := v_f * balance_num('boss_passives', 'dispeller_x'); v_ctr := v_ctr || 'dispeller'::text; end if;
  if v_eff = 'weaken' and 'juggernaut' = any(v_plist) then v_f := v_f * balance_num('boss_passives', 'juggernaut_x'); v_ctr := v_ctr || 'juggernaut'::text; end if;
  if v_eff = 'heal' and p_target is not null and hunt_mark_on(v_marks->'heal_block_card', p_target::text, v_round) then
    v_f := v_f * coalesce((v_marks->'heal_block_card'->p_target::text->>'mult')::numeric, hunt_counter_mult('heal_block_card')); v_ctr := v_ctr || 'bloodrot'::text;
  end if;
  if v_eff in ('shield', 'empower', 'weaken', 'expose', 'smite') and hunt_mark_on(v_marks, 'block_' || v_eff, v_round) then
    v_f := v_f * coalesce((v_marks->('block_' || v_eff)->>'mult')::numeric, hunt_counter_mult('block_' || v_eff)); v_ctr := v_ctr || ('block_' || v_eff);
  end if;
  if hunt_mark_on(v_marks, 'half_' || v_eff, v_round) then   -- Shatter, Rattle, Nerf, Fade, Rollback, Decay for the day (balance boss_counters)
    v_f := v_f * coalesce((v_marks->('half_' || v_eff)->>'mult')::numeric, hunt_counter_mult('half_' || v_eff)); v_ctr := v_ctr || ('half_' || v_eff);
  end if;
  if v_f <> 1 then v_amt := v_amt * v_f; end if;

  -- resolve ally-targeted effects (need a committed target row)
  if v_tgt in ('ally', 'self') then
    if p_target is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    select pc.quantity, c.rarity::text, pc.ascension, s.cp_mod, s.tag_slugs, pc.stat_points, s.ability->>'kind'
      into v_tqty, v_trar, v_tasc, v_tmod, v_ttags, v_tpts, v_tkind
    from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
    where pc.player_id = p_player and pc.card_id = p_target;
    if not found or v_tqty < 1 then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    v_tcp := (card_combat(v_trar, v_tasc, v_tmod, v_tpts)->>'cp')::int;
    v_tmaxhp := (card_combat(v_trar, v_tasc, v_tmod, v_tpts)->>'hp')::int;
    if v_tkind = 'support' then v_tmaxhp := card_max_hp(0); end if;   -- D-70: a support target has the support HP
    perform hunt_commit_card(p_hunt, p_player, p_target, v_day, v_tmaxhp);

    -- matched ally gets the stronger effect
    v_matched := v_aff is not null and v_ttags is not null and v_aff = any(v_ttags);
    if v_matched then v_amt := v_amt * balance_num('support', 'matched_x'); end if;

    if v_eff = 'empower' then
      update hunt_card_hp set dmg_buff = combat_support_value('empower', v_amt, 1, null), updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'shield' then
      -- amount = a fraction of the TARGET's max HP (was flat 60 on 30-HP cards).
      update hunt_card_hp set shield = shield + combat_support_value('shield', v_amt, 1, max_hp)::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'heal' then
      -- amount = a fraction of the TARGET's max HP (was flat 60, a full heal on the
      -- 30-HP cards). A heal never revives a downed card (that is a separate boon).
      if exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player
                  and card_id = p_target and hit_date = v_day and downed) then
        return jsonb_build_object('ok', false, 'error', 'target_downed');
      end if;
      select hp_remaining into v_gain from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
      update hunt_card_hp set hp_remaining = least(max_hp, hp_remaining + combat_support_value('heal', v_amt, 1, max_hp)::int),
        updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day
        returning hp_remaining - v_gain into v_gain;
      if v_gain > 0 and hunt_mark_on(v_marks, 'undying', v_round) then   -- Undying: the boss heals the same
        update hunts set hp_remaining = least(hp_max, hp_remaining + v_gain) where id = p_hunt and status = 'active';
        v_ctr := v_ctr || 'undying'::text;
      end if;
    else
      return jsonb_build_object('ok', false, 'error', 'bad_ally_effect');
    end if;

  -- boss-targeted / team effects (scaled by affinity synergy)
  elsif v_eff = 'weaken' then
    update hunt_combat_state set boss_weaken = combat_support_value('weaken', v_amt, v_scale, null), weaken_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: each weaken adds spiral.step to the boss damage
      perform hunt_marks_patch(p_hunt, p_player, v_day, jsonb_build_object('spiral', (v_marks->'spiral')
        || jsonb_build_object('bonus', coalesce((v_marks->'spiral'->>'bonus')::numeric, 0) + hunt_counter_num('spiral', 'step'))));
      v_ctr := v_ctr || 'spiral'::text;
    end if;
  elsif v_eff = 'expose' then
    update hunt_combat_state set boss_expose = combat_support_value('expose', v_amt, v_scale, null), expose_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'stun' then
    -- Stun immunity (hunt_loop_caps.sql): after a stun the boss cannot be stunned for 2 rounds, so
    -- 4 stun cards cannot lock it (at most 1 stunned round in 3).
    select stunned_until into v_stun_until from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    if combat_stun_immune(v_stun_until, v_round) then
      return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', v_stun_until + balance_num('support', 'stun_immune_rounds')::int);
    end if;
    -- Desync / Juggernaut (hunt_boss_moves.sql): the stun fails; the card still goes on cooldown.
    if coalesce((v_marks->>'stun_fail')::boolean, false) then
      v_fail := true; v_ctr := v_ctr || 'desync'::text;
      update hunt_combat_state set marks = marks - 'stun_fail', updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif 'juggernaut' = any(v_plist) then
      if random() < balance_num('boss_passives', 'juggernaut_stun_fail') then v_fail := true; v_ctr := v_ctr || 'juggernaut'::text; end if;
    end if;
    if not v_fail then
    update hunt_combat_state set stunned_until = v_round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    end if;
  elsif v_eff = 'cleanse' then
    if hunt_mark_on(v_marks, 'lock_cleanse', v_round) then   -- Hotfix (hunt_boss_moves.sql): the curse stays
      v_ctr := v_ctr || 'hotfix'::text;
    elsif 'plague' = any(v_plist) then                         -- Plague: removes only plague_cleanse of a curse
      v_ctr := v_ctr || 'plague'::text;
      update hunt_card_hp set dmg_debuff = dmg_debuff + (1 - dmg_debuff) * balance_num('boss_passives', 'plague_cleanse'), updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and dmg_debuff <> 1;
    else
    update hunt_card_hp set dmg_debuff = 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and dmg_debuff <> 1;
    end if;
    if hunt_mark_on(v_marks, 'rot', v_round) then              -- Rot: the cleanse also removes empower and shields
      update hunt_card_hp set dmg_buff = 1, shield = 0, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      v_ctr := v_ctr || 'rot'::text;
    end if;
  elsif v_eff = 'smite' then
    v_sdmg := combat_support_value('smite', v_amt, v_scale, null)::int;
    if coalesce((v_marks->>'mirror')::boolean, false) then   -- Mirror (hunt_boss_moves.sql): the smite hits the smite card
      update hunt_combat_state set marks = marks - 'mirror', updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      update hunt_card_hp set hp_remaining = greatest(0, hp_remaining - v_sdmg), downed = hp_remaining - v_sdmg <= 0, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
      v_ctr := v_ctr || 'mirror'::text;
    else
    update hunts set hp_remaining = greatest(0, hp_remaining - v_sdmg),
      status = case when hp_remaining - v_sdmg <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_sdmg <= 0 then now() else defeated_at end
      where id = p_hunt;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, p_player, p_card, v_day, v_sdmg)
      on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage;
    select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;
    -- The killing Smite: settle once + the same 'defeat' notification as hunt_attack (2026-10-03).
    if v_status = 'defeated' then
      v_settle := settle_hunt(p_hunt);
      insert into hunt_events (hunt_id, kind, payload)
        values (p_hunt, 'defeat', jsonb_build_object(
          'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
          'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                  from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                        group by player_id order by sum(damage) desc limit 3) t)));
    end if;
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff);
  end if;

  -- The action log (combat_actions.sql, Nathan 2026-10-06): every support play that worked, for the balance data.
  insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
  values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, v_amt,
    case when v_tgt in ('ally', 'self') then p_target end,
    jsonb_build_object('gained', case when v_eff = 'heal' then v_gain end, 'mirrored', 'mirror' = any(v_ctr), 'countered', to_jsonb(v_ctr),
      'scale', v_scale, 'matched', v_matched, 'aff_count', v_affcount, 'affinity', v_aff, 'cooldown', v_cd,
      'value', case
        when v_eff = 'smite' then v_sdmg
        when v_eff in ('weaken', 'expose') then combat_support_value(v_eff, v_amt, v_scale, null)
        when v_eff = 'empower' then combat_support_value('empower', v_amt, 1, null)
        when v_eff in ('heal', 'shield') then (select combat_support_value(v_eff, v_amt, 1, h.max_hp) from hunt_card_hp h
          where h.hunt_id = p_hunt and h.player_id = p_player and h.card_id = p_target and h.hit_date = v_day)
      end,
      'target_after', (select jsonb_build_object('hp', h.hp_remaining, 'max_hp', h.max_hp, 'shield', h.shield, 'dmg_buff', h.dmg_buff, 'downed', h.downed)
        from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.card_id = p_target and h.hit_date = v_day)));

  update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;

  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'target', p_target,
    'affinity', v_aff, 'aff_count', v_affcount, 'matched', v_matched,
    'ready_round', v_round + v_cd, 'round', v_round,
    'boss_hp', (select hp_remaining from hunts where id = p_hunt),
    'defeated', (select status from hunts where id = p_hunt) = 'defeated')
    || case when cardinality(v_ctr) > 0 then jsonb_build_object('countered', to_jsonb(v_ctr)) else '{}'::jsonb end;
end $function$;

-- 11. dungeon_support: Haste shortens the cooldown (the live text; changed: v_cd).
CREATE OR REPLACE FUNCTION public.dungeon_support(p_player text, p_card bigint, p_target_card bigint DEFAULT NULL::bigint, p_target_foe integer DEFAULT NULL::integer, p_mode text DEFAULT 'daily'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; v_ab jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text; v_aff text;
  v_round int; v_affc int := 0; v_scale numeric; v_matched boolean := false; tc jsonb; tinfo jsonb; f jsonb; v_t int; v_val numeric; k text; kill jsonb := null; v_end jsonb := null;
  v_log jsonb;   -- dungeon_combat_log.sql: the row of this play
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  c := st->'cards'->p_card::text;
  if c is null then return jsonb_build_object('ok', false, 'error', 'not_in_squad'); end if;
  info := dungeon_run_card(r, p_card);
  v_ab := info->'ability';
  if v_ab is null or v_ab->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;
  if (c->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'support_downed'); end if;
  v_round := (st->>'round')::int;
  if coalesce((st->>'sup_round')::int, -1) = v_round then return jsonb_build_object('ok', false, 'error', 'one_support'); end if;
  if v_round < (c->>'cd')::int then return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', (c->>'cd')::int, 'round', v_round); end if;
  v_eff := v_ab->>'effect';
  v_amt := coalesce((v_ab->>'amount')::numeric, 0) * coalesce((info->'cmb'->>'potency')::numeric, 1);
  v_dur := coalesce((v_ab->>'duration')::int, 1);
  -- F-3: Haste points shorten the cooldown (combat_cooldown: never below 1 round; the Gauntlet card has no points).
  v_cd := combat_cooldown(coalesce((v_ab->>'cooldown')::int, 1), (info->'cmb'->>'haste')::numeric);
  v_tgt := coalesce(v_ab->>'target', 'boss'); v_aff := v_ab->>'affinity';
  if v_aff is not null then
    select count(*) into v_affc from unnest(r.squad) x join cards cc on cc.id = x join subjects s on s.id = cc.subject_id where v_aff = any(s.tag_slugs);
  end if;
  v_scale := combat_aff_scale(v_affc);
  if v_tgt in ('ally', 'self') then
    if p_target_card is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    tc := st->'cards'->p_target_card::text;
    if tc is null then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    tinfo := dungeon_run_card(r, p_target_card);
    v_matched := v_aff is not null and v_aff = any(dungeon_txt(tinfo->'tags'));
    if v_matched then v_amt := v_amt * balance_num('support', 'matched_x'); end if;
    if v_eff = 'empower' then tc := tc || jsonb_build_object('buff', combat_support_value('empower', v_amt, 1, null));
    elsif v_eff = 'shield' then tc := tc || jsonb_build_object('shield', (tc->>'shield')::int + combat_support_value('shield', v_amt, 1, (tc->>'max')::int)::int);
    elsif v_eff = 'heal' then
      if (tc->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'target_downed'); end if;
      tc := tc || jsonb_build_object('hp', least((tc->>'max')::int, (tc->>'hp')::int + combat_support_value('heal', v_amt, 1, (tc->>'max')::int)::int));
    else return jsonb_build_object('ok', false, 'error', 'bad_ally_effect'); end if;
    -- value = the HP the ally gained (heal); applied = the buff, the shield points added or the HP healed.
    v_log := dungeon_hp_event('support', v_eff, p_card, p_target_card, null, v_round, 'card', case when v_eff = 'heal' then 'heal' end,
      (tc->>'hp')::int - (st->'cards'->p_target_card::text->>'hp')::int, tc,
      jsonb_build_object('applied', case v_eff when 'empower' then tc->'buff'
        when 'shield' then to_jsonb(coalesce((tc->>'shield')::int, 0) - coalesce((st->'cards'->p_target_card::text->>'shield')::int, 0))
        else to_jsonb((tc->>'hp')::int - (st->'cards'->p_target_card::text->>'hp')::int) end));
    st := jsonb_set(st, array['cards', p_target_card::text], tc);
  elsif v_eff = 'cleanse' then
    for k in select jsonb_object_keys(st->'cards') loop st := jsonb_set(st, array['cards', k], (st->'cards'->k) || '{"debuff": 1, "psn": 0, "psnu": -1}'); end loop;
    v_log := dungeon_hp_event('support', v_eff, p_card, null, null, v_round, null, null, 0, null, null);
  else
    select (e.ord - 1)::int into v_t from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
      where (e.f->>'hp')::int > 0 order by (case when (e.ord - 1)::int = p_target_foe then 0 else 1 end), e.ord limit 1;
    f := st->'foes'->v_t;
    if v_eff = 'weaken' then f := f || jsonb_build_object('wk', combat_support_value('weaken', v_amt, v_scale, null), 'wku', v_round + v_dur);
    elsif v_eff = 'expose' then f := f || jsonb_build_object('ex', combat_support_value('expose', v_amt, v_scale, null), 'exu', v_round + v_dur);
    elsif v_eff = 'stun' then
      if combat_stun_immune((f->>'st')::int, v_round) then return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', (f->>'st')::int + 2); end if;
      f := f || jsonb_build_object('st', v_round + 1);
    elsif v_eff = 'smite' then
      v_val := combat_support_value('smite', v_amt, v_scale, null);
      f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_val::int));
    else return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff); end if;
    -- value = the HP the foe lost (smite); applied = the weaken / expose value, the stun round or the smite damage.
    v_log := dungeon_hp_event('support', v_eff, p_card, null, v_t, v_round, 'foe', case when v_eff = 'smite' then 'dmg' end,
      (st->'foes'->v_t->>'hp')::int - (f->>'hp')::int, f,
      jsonb_build_object('applied', case v_eff when 'weaken' then f->'wk' when 'expose' then f->'ex' when 'stun' then f->'st' else to_jsonb(v_val) end,
        'until', case v_eff when 'weaken' then f->'wku' when 'expose' then f->'exu' when 'stun' then f->'st' end));
    st := jsonb_set(st, array['foes', v_t::text], f);
    if (f->>'hp')::int <= 0 then kill := dungeon_after_kill(r, st); st := kill->'state'; end if;
  end if;
  st := jsonb_set(st, array['cards', p_card::text, 'cd'], to_jsonb(v_round + v_cd));
  st := st || jsonb_build_object('sup_round', v_round);
  update dungeon_runs set state = st where id = r.id;
  perform dungeon_combat_log(r, jsonb_build_array(v_log || jsonb_build_object('amount', v_amt, 'result', (v_log->'result') || jsonb_build_object(
    'matched', v_matched, 'scale', v_scale, 'aff_count', v_affc, 'affinity', v_aff, 'cooldown', v_cd, 'kill', kill is not null))));
  if st->>'phase' = 'cleared' then v_end := dungeon_settle(r.id, 'cleared', true); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'support', 'card', p_card, 'target_card', p_target_card, 'target_foe', v_t),
    jsonb_build_object('effect', v_eff, 'amount', v_amt, 'matched', v_matched, 'kill', kill));
  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'matched', v_matched, 'aff_count', v_affc,
    'ready_round', v_round + v_cd, 'kill', kill is not null, 'settled', v_end,
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $function$;

-- 12. hunt_view: the crit chance of each attacker (the live text; changed: crit).
CREATE OR REPLACE FUNCTION public.hunt_view(p_player text, p_hunt bigint, p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ascension', pc.ascension, 'first_obtained_at', pc.first_obtained_at,
        'card', jsonb_build_object('id', c.id, 'name', c.name, 'rarity', c.rarity, 'image_url', c.image_url, 'season', c.season,
          'subject', case when s.id is null then null else jsonb_build_object('type', s.type, 'cp_mod', s.cp_mod, 'ability', s.ability, 'tags', s.tags) end)))
      from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
      where pc.player_id = p_player), '[]'::jsonb),
    'hp', coalesce((
      select jsonb_agg(jsonb_build_object('card_id', h.card_id, 'hp_remaining', h.hp_remaining, 'max_hp', h.max_hp,
        'downed', h.downed, 'shield', h.shield, 'cd_until_round', h.cd_until_round))
      from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = p_day), '[]'::jsonb),
    'stats', card_stats_for(p_player),
    'crit', hunt_card_crits(p_player, p_hunt),   -- F-3: the crit chance of each attacker on this boss (the card viewer)
    'damage', coalesce((select sum(damage) from hunt_hits where hunt_id = p_hunt and player_id = p_player), 0),
    'round', (select round from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = p_day));
$function$;

notify pgrst, 'reload schema';
