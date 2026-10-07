-- card_decisions.sql: Nathan's decisions of 2026-10-07 (the one-source-rules audit, PR #243). Idempotent.
-- 1. Subject 252 (DEEZ NUTZ, card studio key deez-nutz) had no type. Nathan: it is an Item. Then subjects.type is
--    NOT NULL. Before, hunt_attack / dungeon_attack / dungeon_start / gauntlet_start test `type not in (...)`, and a
--    null type passed that test as an attacker. With NOT NULL that gap is closed (those functions do not change).
--    The card studio push (card-studio/src/push.js) now refuses a card with no type.
-- 2. One rarity order: rarity_rank() (hall_auctions.sql; Event 3 and Promo 2, the same as the bot). playing_today
--    used its own copy that ranked Event and Promo as 0. It now calls rarity_rank. The bot copy
--    (tcg-bot/src/playing-card.ts RARITY.rank) and the SQL function are both pinned to shared/rarity-rank.json.
-- 3. One element list: element_aliases() holds the 13 element names, their order and their aliases (Nathan: robot IS
--    metal). element_of() and card_element() read it. combat_squad (element synergy) and ach_has_element (the
--    Elementalist track) use it. Before, combat_squad knew only the 13 exact names, so a 'robot' card was no Metal card.
--    The trait synergy still skips only the 13 element names (as before). The client copy is tcg-activity/src/elements.js.
-- 4. pack_ledger_ref_check: every pack move has ref_kind + ref_id (the shard_ledger rule). Live had 0 rows without a ref.
-- combat_squad, ach_has_element and playing_today are rebuilt from their LIVE text (2026-10-07) with only these lines.
-- balance_table.sql and combat_core.sql carry the same combat_squad text, and the balance_table.sql guard accepts the
-- new md5, so a re-run of either file does not revert it. Test: card-studio/scripts/test-card-decisions.mjs.

-- GUARD (the combat_core.sql rule): each function must be the live text this file was built from, or its result.
do $g$ begin
  if md5(replace(pg_get_functiondef('public.combat_squad'::regproc), chr(13), '')) not in ('d3618d2947fbb305a84de6d00f7078ff', '8395926de7607dd8f187c45a3555f1c9') then
    raise exception 'card_decisions.sql: the live combat_squad changed since this file was built. Rebuild from the live text.';
  end if;
  if md5(replace(pg_get_functiondef('public.ach_has_element'::regproc), chr(13), '')) not in ('348c402a6e9e8a38d21fba88576aea83', '2a18b4f269a791202de3031f7966aa65') then
    raise exception 'card_decisions.sql: the live ach_has_element changed since this file was built. Rebuild from the live text.';
  end if;
  if md5(replace(pg_get_functiondef('public.playing_today'::regproc), chr(13), '')) not in ('a34073cd5b36e2584acdafaa3835e0c3', '6311e6e45a217ddd74ccb8ca638013b9') then
    raise exception 'card_decisions.sql: the live playing_today changed since this file was built. Rebuild from the live text.';
  end if;
  if public.rarity_rank('event') <> 3 or public.rarity_rank('promo') <> 2 then
    raise exception 'card_decisions.sql: rarity_rank is not the order of hall_auctions.sql (event 3, promo 2). Check shared/rarity-rank.json.';
  end if;
end $g$;
-- GUARD-END

-- 1. subjects.type: subject 252 is an Item, then no subject can be without a type ---------------------------------
update public.subjects set type = 'Item' where id = 252 and key = 'deez-nutz' and type is null;
do $t$ begin
  if exists (select 1 from public.subjects where type is null) then
    raise exception 'card_decisions.sql: subjects with no type: %. Give each a type (Character, Creature, Item, Place or Moment) first.',
      (select string_agg(id::text, ', ' order by id) from public.subjects where type is null);
  end if;
end $t$;
alter table public.subjects alter column type set not null;
comment on column public.subjects.type is $c$The PVE type: Character, Creature, Item, Place or Moment (check subjects_type_check, NOT NULL). Only Character and Creature attack (hunt_attack, dungeon_attack). The card studio push (push.js) sets it and refuses a card with no type.$c$;

-- 2. playing_today: the best new card of today by rarity_rank (Event and Promo count, as in the bot) ----------------
CREATE OR REPLACE FUNCTION public.playing_today(p_player text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with d as (select (now() at time zone 'America/Denver')::date as day,
                    ((now() at time zone 'America/Denver')::date)::timestamp at time zone 'America/Denver' as t0)
  select jsonb_build_object(
    'name', (select username from players where id = p_player),
    'avatar', (select avatar from players where id = p_player),
    'playing_pref', coalesce((select notify_prefs->>'playing' from players where id = p_player), 'true'),
    'packs', (select count(*) from pack_ledger, d where player_id = p_player and reason = 'opened' and created_at >= d.t0),
    'damage', (select coalesce(sum(damage), 0) from hunt_hits, d where player_id = p_player and hit_date = d.day),
    'best', (select jsonb_build_object('id', c.id, 'name', c.name, 'rarity', c.rarity, 'image_url', c.image_url)
               from player_cards pc join cards c on c.id = pc.card_id, d
              where pc.player_id = p_player and pc.first_obtained_at >= d.t0
              order by public.rarity_rank(c.rarity::text) desc, pc.first_obtained_at desc
              limit 1));
$function$;
comment on function public.playing_today(text) is $c$Returns the data of the is-playing post for a member today: name, avatar, the playing ping setting, packs opened, Hunt damage and the best new card (highest rarity_rank, then the newest). The bot (playing-posts.ts) calls it.$c$;
comment on function public.rarity_rank(text) is $c$The one rarity order: normal 0, illustrated_rare 1, secret_rare and promo 2, full_art and event 3, gold 4. Used by auction_meets and playing_today. The bot copy (tcg-bot/src/playing-card.ts RARITY.rank) and this function are both tested against shared/rarity-rank.json.$c$;

-- 3. The element names and their aliases: one source -------------------------------------------------------------
-- ord = the priority when a card carries several elements (the lowest wins), the same as ELEMENT_ORDER in the client.
create or replace function public.element_aliases()
returns table (alias text, element text, ord int)
language sql immutable parallel safe
set search_path = public
as $f$
  select a.alias, a.element, a.ord from (values
    ('fire', 'fire', 1), ('flame', 'fire', 1), ('burning', 'fire', 1),
    ('water', 'water', 2), ('aqua', 'water', 2), ('ocean', 'water', 2),
    ('lightning', 'lightning', 3), ('electric', 'lightning', 3), ('thunder', 'lightning', 3),
    ('ice', 'ice', 4), ('frost', 'ice', 4), ('frozen', 'ice', 4),
    ('nature', 'nature', 5), ('grass', 'nature', 5), ('plant', 'nature', 5), ('wood', 'nature', 5),
    ('earth', 'earth', 6), ('rock', 'earth', 6), ('stone', 'earth', 6), ('ground', 'earth', 6),
    ('air', 'air', 7), ('wind', 'air', 7), ('flying', 'air', 7),
    ('shadow', 'shadow', 8), ('dark', 'shadow', 8), ('ghost', 'shadow', 8),
    ('light', 'light', 9), ('holy', 'light', 9), ('radiant', 'light', 9),
    ('arcane', 'arcane', 10), ('magic', 'arcane', 10), ('fairy', 'arcane', 10), ('mystic', 'arcane', 10),
    ('psychic', 'psychic', 11), ('psi', 'psychic', 11),
    ('toxic', 'toxic', 12), ('poison', 'toxic', 12), ('venom', 'toxic', 12),
    ('metal', 'metal', 13), ('robot', 'metal', 13), ('mechanical', 'metal', 13), ('tech', 'metal', 13), ('steel', 'metal', 13)
  ) a(alias, element, ord);
$f$;
comment on function public.element_aliases() is $c$The ONE list of the 13 elements, their priority (ord, the lowest wins) and their aliases (for example robot = metal, Nathan 2026-10-07). element_of, card_element, combat_squad and ach_has_element read it. The client copy is tcg-activity/src/elements.js (test-card-decisions.mjs checks that they agree).$c$;

-- A trait ('robot') or a trait slug ('trait:robot') -> its element ('metal'), or null. Other slugs (origin:...) -> null.
create or replace function public.element_of(p_tag text)
returns text
language sql immutable parallel safe
set search_path = public
as $f$
  select a.element from public.element_aliases() a where a.alias = lower(trim(regexp_replace(p_tag, '^trait:', '', 'i')));
$f$;
comment on function public.element_of(text) is $c$The element of one trait or trait slug (robot or trait:robot -> metal), or null. Other slugs (origin:..., class:...) -> null. Reads element_aliases.$c$;

-- The dominant element of a card: the element with the lowest ord among its traits, or null (physical).
create or replace function public.card_element(p_tags text[])
returns text
language sql immutable parallel safe
set search_path = public
as $f$
  select a.element from unnest(coalesce(p_tags, '{}'::text[])) t
    join public.element_aliases() a on a.alias = lower(trim(regexp_replace(t, '^trait:', '', 'i')))
   order by a.ord limit 1;
$f$;
comment on function public.card_element(text[]) is $c$The dominant element of a card from its tag slugs (subjects.tag_slugs) or bare traits: the element with the lowest ord in element_aliases, or null. combat_squad and ach_has_element use it. The same rule as cardElement() in tcg-activity/src/elements.js.$c$;

CREATE OR REPLACE FUNCTION public.combat_squad(p_tags text[], p_self_in boolean, p_others jsonb, p_weak jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_wtags text[]; v_stack int := 0; v_elem text; v_syn int; v_synmult numeric := 1;
  v_origin text; v_osyn int; v_omult numeric := 1; v_ksyn int; v_kmult numeric := 1;
  v_o jsonb := coalesce(p_others, '[]'::jsonb);
begin
  select array_agg(w->>'value') into v_wtags
    from jsonb_array_elements(coalesce(p_weak, '[]'::jsonb)) w where w->>'kind' = 'tag';
  if v_wtags is not null and array_length(v_wtags, 1) > 0 then
    select count(*) into v_stack from jsonb_array_elements(v_o) o
      where array(select jsonb_array_elements_text(o)) && v_wtags;
    if p_self_in and p_tags && v_wtags then v_stack := v_stack + 1; end if;
  end if;
  -- Element synergy: this card's dominant element + how many other cards share it.
  -- The element names and their aliases have one source: element_aliases() (card_decisions.sql; robot = metal).
  v_elem := public.card_element(p_tags);
  if v_elem is not null then
    select count(*) into v_syn from jsonb_array_elements(v_o) o where exists (select 1 from jsonb_array_elements_text(o) t where public.element_of(t) = v_elem);
    v_syn := coalesce(v_syn, 0) + 1;   -- include this card
    if v_syn >= public.balance_num('combat', 'syn_big_at') then v_synmult := public.balance_num('combat', 'element_big'); elsif v_syn >= public.balance_num('combat', 'syn_small_at') then v_synmult := public.balance_num('combat', 'element_small'); end if;
  else
    v_syn := 0;
  end if;
  -- Origin (game) synergy.
  v_origin := (select t from unnest(p_tags) t where t like 'origin:%' limit 1);
  if v_origin is not null then
    select count(*) into v_osyn from jsonb_array_elements(v_o) o where o ? v_origin;
    v_osyn := coalesce(v_osyn, 0) + 1;
    if v_osyn >= public.balance_num('combat', 'syn_big_at') then v_omult := public.balance_num('combat', 'origin_big'); elsif v_osyn >= public.balance_num('combat', 'syn_small_at') then v_omult := public.balance_num('combat', 'origin_small'); end if;
  end if;
  -- Trait (kind) synergy: the best-shared non-element trait.
  select coalesce(max(cnt), 0) into v_ksyn from (
    select count(*) as cnt from unnest(p_tags) tg cross join jsonb_array_elements(v_o) o
      where tg like 'trait:%' and tg not in (select 'trait:' || a.element from public.element_aliases() a)
        and o ? tg
      group by tg) k;
  if v_ksyn > 0 then v_ksyn := v_ksyn + 1; if v_ksyn >= public.balance_num('combat', 'syn_big_at') then v_kmult := public.balance_num('combat', 'trait_big'); elsif v_ksyn >= public.balance_num('combat', 'syn_small_at') then v_kmult := public.balance_num('combat', 'trait_small'); end if; end if;
  v_synmult := least(public.balance_num('combat', 'syn_cap'), v_synmult * v_omult * v_kmult);
  return jsonb_build_object('stack', v_stack, 'elem', v_elem, 'syn', v_syn, 'synmult', v_synmult);
end $function$;
comment on function public.combat_squad(text[],boolean,jsonb,jsonb) is $c$[combat] The squad synergy of a card: the weak-tag stack and the element, origin and trait multipliers, limited by balance key combat (syn_cap). The element comes from card_element (element_aliases: robot = metal); the trait synergy skips the 13 element names. Returns {stack, elem, syn, synmult}. Internal helper of hunt_attack and dungeon_attack.$c$;

CREATE OR REPLACE FUNCTION public.ach_has_element(p_tags jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- One element list: card_element / element_aliases (card_decisions.sql).
  select public.card_element(array(select jsonb_array_elements_text(case when jsonb_typeof(p_tags->'traits') = 'array' then p_tags->'traits' else '[]'::jsonb end))) is not null;
$function$;
comment on function public.ach_has_element(jsonb) is $c$Internal helper: true when a subject's tags hold an element trait or an alias of one (card_element / element_aliases). ach_track_values uses it for the Elementalist track.$c$;

-- 4. pack_ledger: every pack move names its source row -----------------------------------------------------------
do $r$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.pack_ledger'::regclass and conname = 'pack_ledger_ref_check') then
    if exists (select 1 from public.pack_ledger where ref_kind is null or ref_id is null) then
      raise exception 'card_decisions.sql: % pack_ledger rows have no ref_kind / ref_id. Match them to their source first.',
        (select count(*) from public.pack_ledger where ref_kind is null or ref_id is null);
    end if;
    alter table public.pack_ledger add constraint pack_ledger_ref_check check (ref_kind is not null and ref_id is not null);
  end if;
end $r$;
comment on column public.pack_ledger.ref_kind is $c$The kind of source row (never null: check pack_ledger_ref_check): gift (gift_claims.id), daily_claim (daily_claims, ref_id = '<day>:<task>'), achievement (achievement_claims.key), shop_purchase (shop_purchases.id), hunt (hunts.id), dungeon_payout (dungeon_payouts, ref_id = '<mode>:<period>'), open (one pack open; ref_id = the open id, the same for the packs of one open), tutorial (ref_id = 'complete'), player (ref_id = a member id: the boon caster).$c$;
comment on column public.pack_ledger.ref_id is $c$The id of the source row (see ref_kind), as text. Never null (check pack_ledger_ref_check).$c$;

notify pgrst, 'reload schema';
