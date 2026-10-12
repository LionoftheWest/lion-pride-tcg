-- f2_set_not_season.sql (2026-10-12, F-2 PR 4, the SQL part): a set works like Season 1 without reading the season TEXT.
-- Defects found in the live text (db/schema/functions, 2026-10-12):
--   ach_track_values        reads cards.in_draw_pool (twice: collector/shine/elementalist and fullsets), not draw_pool, so a card of a set that
--                           is not pullable counted for the achievements, and a pool row (reprint) was ignored.
--   ach_tag_badges          groups the tag badges by coalesce(cards.season, 'Season 1') and builds the short name from the season text.
--   combat_weak             the Hunt/Dungeon weak point kind 'season' compares a card's season TEXT; there was no kind for a set.
--   hunt_attack, hunt_card_crits, hunt_pick_pool, dungeon_attack   pass cards.season / info->>'season' to combat_weak.
--   dungeon_card, dungeon_card_base   give the card info with 'season' only (no set).
-- Change:
--   * ach_track_values reads draw_pool (set_draw_pool: pullable set, its pool rows, in_draw_pool and source 'draw').
--   * ach_tag_badges groups by the home set (cards.set_id); the season of the badge ('Season N') and its short name ('SN') come from
--     card_sets.season. The answer has the same columns and, for S1, the same rows (key tag:S1:..., season 'Season 1', short 'S1').
--   * combat_weak: the 5th argument (still named p_season, so that an older file that replaces this function still applies) is now the HOME SET id. New weak point kind
--     'set' (value = a set id). The kind 'season' keeps working for an older boss: it matches the season text of that set, read from
--     card_sets (one lookup, only when a weak or resist point has that kind). Nothing writes kind 'season' today (spawn_hunt writes tag).
--   * The callers pass the set id: hunt_attack (v_set), hunt_card_crits, hunt_pick_pool, dungeon_attack (info->>'set').
--   * dungeon_card and dungeon_card_base add the key 'set' to their answer. Every key they had is unchanged.
-- NOT changed, on purpose (the Activity reads them; a later UI PR moves them): cards.season (the column stays, cards_set_rules keeps it as
-- 'Season ' || card_sets.season), the key 'season' of dungeon_card / hunt_view / ach badges, 'Season 1 Complete' (a rule in
-- tcg-activity/src/achievements.js, not SQL). cards_set_rules still gives a card with no set_id the one set of its season (open question).
-- Test: card-studio/scripts/test-set-not-season.mjs (S1 answers identical before and after; a test set with its own season).

-- GUARD (the combat_core.sql rule): this file replaces the live functions below. It runs only on the live text it was built from
-- (the first md5) or on its own result (the second md5). Any other change stops it: rebuild this file.
do $g$
declare x text[]; m text;
begin
  foreach x slice 1 in array array[
    ['ach_track_values(text)', '8aaca289690d7134433622782013d90e', '14927afaf886b134383f4c72ec987925'],
    ['ach_tag_badges(text)', '56ea953ca6228d9c61103376e9e41225', '7aaa043e73a29381736237fabb96d86c'],
    ['combat_weak(jsonb, jsonb, text, text, text, text[], integer)', '08f4e644e8adb9f260f27592b8aef9bd', '1069a7ba258f37745c526f4d90c3b497'],
    ['hunt_attack(text, bigint, bigint)', '8ccc00dfb53f9b0203054a7e00120afb', 'd378bd47d31633c2a0ba4b1e905d895b'],
    ['hunt_card_crits(text, bigint)', '71464d5300b559c26e17e38c635b42e5', '445046bcbee8ea2c4df26651217112b4'],
    ['hunt_pick_pool(text, bigint, bigint[])', '18a0bce68ec6e6a0c106585a0808638f', 'aa33750469536abf8f7ce0c04114427d'],
    ['dungeon_attack(text, bigint, integer, text)', '430e8e22df67fb87044ed5bfc99658ca', 'd2046f0dd57dfaec7612154c25898845'],
    ['dungeon_card(text, bigint)', '71ccd32ce017a6bddb7c8ea73a2fda34', '0157f39075de176152a21e3671bbc957'],
    ['dungeon_card_base(bigint)', '308e136c5197419746ca0eef9cc5fad0', '1371cd672a937f60f232c0a5a66f26e6']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m not in (x[2], x[3]) then raise exception 'f2_set_not_season.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

CREATE OR REPLACE FUNCTION public.ach_track_values(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v jsonb := '{}'::jsonb; n bigint; dv jsonb := coalesce(shard_cfg()->'dupe_values', '{}'::jsonb);
begin
  -- Collection (draw-pool cards only: Event cards do not count)
  -- ach_has_element once per different subject (perf_five_slow_calls.sql): it depends only on the subject's tags.
  with o as materialized (
    select c.rarity, c.subject_id from player_cards pc join cards c on c.id = pc.card_id
     where pc.player_id = p_player and pc.quantity > 0 and c.id in (select id from draw_pool)),
  e as materialized (select s.id, ach_has_element(s.tags) el from subjects s where s.id in (select o.subject_id from o))
  select jsonb_build_object(
           'collector', count(*),
           'shine', count(*) filter (where o.rarity in ('illustrated_rare', 'secret_rare', 'full_art', 'gold')),
           'elementalist', count(*) filter (where e.el))
    into v
    from o left join e on e.id = o.subject_id;
  select count(*) into n from (
    select c.subject_id from cards c left join player_cards pc on pc.card_id = c.id and pc.player_id = p_player and pc.quantity > 0
     where c.id in (select id from draw_pool) group by c.subject_id having count(*) >= 2 and count(pc.card_id) = count(*)) x;
  v := v || jsonb_build_object('fullsets', n);
  -- The 3-argument stat_pt with balance stat_points.max_per_stat read once (perf_five_slow_calls.sql), not once per card and stat.
  v := v || (select jsonb_build_object(
      'ascension', coalesce(sum(pc.ascension), 0),
      'trainer', coalesce(sum(stat_pt(pc.stat_points, 'attack', m.mx) + stat_pt(pc.stat_points, 'vitality', m.mx) + stat_pt(pc.stat_points, 'precision', m.mx)
                              + stat_pt(pc.stat_points, 'potency', m.mx) + stat_pt(pc.stat_points, 'haste', m.mx)), 0))
    from player_cards pc cross join lateral (select (select balance_num('stat_points', 'max_per_stat')::int) mx) m
   where pc.player_id = p_player and pc.quantity > 0);
  -- Packs
  v := v || jsonb_build_object('packs', (select count(*) from pack_ledger where player_id = p_player and reason = 'opened'));
  v := v || jsonb_build_object('generous',
      (select coalesce(sum(-amount), 0) from pack_ledger where player_id = p_player and reason = 'gift_sent')
    + (select count(*) from gift_claims where from_id = p_player and kind = 'card' and reason = 'member_gift'));
  -- Market
  -- The trade ledger (offers + auctions), as tradesDone in server.js.
  v := v || jsonb_build_object('trader', (select count(*) from card_trades where from_id = p_player or to_id = p_player));
  v := v || jsonb_build_object('market',
      (select count(*) from trade_offers where status = 'accepted' and listing_id is not null and (from_id = p_player or to_id = p_player))
    + (select count(*) from auctions where status = 'sold' and seller_id = p_player)
    + (select count(*) from auction_bids where status = 'won' and bidder_id = p_player));
  v := v || jsonb_build_object('wish', (select count(*) from wish_grants where giver_id = p_player));
  -- Shards (earned: not admin or event gifts, not the Shop, not the achievement Shards themselves)
  v := v || jsonb_build_object('shards', (select coalesce(sum(amount), 0) from shard_ledger
      where player_id = p_player and amount > 0 and reason not in ('admin', 'event', 'milestone', 'shop')));
  v := v || jsonb_build_object('shopper', (select count(*) from shop_purchases where player_id = p_player));
  -- A 'dupes' row holds the Shards; the copies = Shards / the rarity's value per copy.
  v := v || jsonb_build_object('recycler', (select coalesce(sum(round(l.amount::numeric / nullif((dv->>c.rarity::text)::numeric, 0))), 0)
      from shard_ledger l join cards c on c.id::text = l.ref_id
     where l.player_id = p_player and l.reason = 'dupes' and l.ref_kind = 'card'));
  -- Dailies
  v := v || jsonb_build_object('grind',
      -- every claim except the plain chat daily (before pack_ledger_strict.sql: daily_claims + the chat bonus flags)
      (select count(*) from daily_claims where player_id = p_player and task <> 'chat'));
  v := v || jsonb_build_object('streak', (select coalesce(max(run_len), 0) from (
      select count(*) run_len from (select day, day - (row_number() over (order by day))::int g
                                from (select distinct day from daily_claims where player_id = p_player and task = 'checkin') d) x
       group by g) y));
  v := v || jsonb_build_object('voice', (select count(*) from (
      select day from daily_claims where player_id = p_player and task = 'voice'
      union select day from daily_claims where player_id = p_player and task = 'chat_bonus') d));
  -- Raid
  -- Joined = own committed cards (hunt_card_hp), as huntsJoined in server.js: a Raid Crasher credit
  -- row in hunt_hits is raid damage only (trade_ledger_raid_credit.sql). Damage stays on hunt_hits.
  v := v || (select jsonb_build_object('heavy', coalesce(sum(damage), 0), 'bighit', coalesce(max(damage), 0))
               from hunt_hits where player_id = p_player);
  v := v || jsonb_build_object('raider', (select count(distinct hunt_id) from hunt_card_hp where player_id = p_player));
  v := v || jsonb_build_object('slayer', (select count(*) from hunts h where h.status = 'defeated'
      and exists (select 1 from hunt_card_hp x where x.hunt_id = h.id and x.player_id = p_player)));
  -- The prize order of settle_hunt: total damage, then the first hit.
  v := v || jsonb_build_object('podium', (select count(*) from (
      select x.player_id, sum(x.damage) dmg, row_number() over (partition by x.hunt_id order by sum(x.damage) desc, min(x.id)) rk
        from hunt_hits x join hunts h on h.id = x.hunt_id and h.settled_at is not null
       group by x.hunt_id, x.player_id) r where r.player_id = p_player and r.rk <= 3 and r.dmg > 0));
  -- Social
  v := v || (select jsonb_build_object('prankster', count(*) filter (where kind = 'prank'), 'vibes', count(*) filter (where kind = 'boon'))
               from card_plays where player_id = p_player);
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.ach_tag_badges(p_player text)
 RETURNS TABLE(key text, season text, short text, tag text, label text, title text, need integer, have integer, packs integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with pool as (
    select c.set_id, 'Season ' || cs.season season, cs.season sn, c.subject_id, c.id card_id, s.tag_slugs
      from cards c join subjects s on s.id = c.subject_id join card_sets cs on cs.id = c.set_id
     where c.id in (select id from draw_pool) and c.rarity::text <> 'event'),   -- set_pools.sql: draw_pool, not in_draw_pool
  subj as (
    select p.set_id, p.season, p.sn, p.subject_id, t.slug
      from pool p cross join lateral unnest(p.tag_slugs) t(slug)
     where t.slug like 'origin:%' or t.slug like 'type:%'
     group by 1, 2, 3, 4, 5),
  mine as (
    select distinct p.set_id, p.subject_id from pool p
      join player_cards pc on pc.card_id = p.card_id and pc.player_id = p_player and pc.quantity > 0),
  b as (
    select s.set_id, s.season, s.sn, s.slug, count(*)::int need, count(m.subject_id)::int have
      from subj s left join mine m on m.set_id = s.set_id and m.subject_id = s.subject_id
     group by 1, 2, 3, 4)
  select 'tag:' || sh.short || ':' || b.slug, b.season, sh.short, b.slug,
         initcap(split_part(b.slug, ':', 2)), initcap(split_part(b.slug, ':', 2)) || ' Master ' || sh.short,
         b.need, b.have, (ceil(b.need / balance_num('achievement_rewards', 'tag_badge', 'cards_per_pack')) + balance_num('achievement_rewards', 'tag_badge', 'extra_packs'))::int
    from b cross join lateral (select 'S' || b.sn short) sh
   order by b.sn, b.set_id, b.slug like 'type:%', b.need desc, b.slug;
$function$;

CREATE OR REPLACE FUNCTION public.combat_weak(p_weak jsonb, p_resist jsonb, p_type text, p_rarity text, p_season text, p_tags text[], p_stack integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_wm int; v_rm int; v_season text;
begin
  -- p_season holds the HOME SET id of the card (the name stays: an older file that replaces this function still works). Kind set: that set. kind season (an older boss may hold it): the season of that set, read from card_sets.
  if coalesce(p_weak, '[]'::jsonb) @> '[{"kind": "season"}]' or coalesce(p_resist, '[]'::jsonb) @> '[{"kind": "season"}]' then
    select 'Season ' || cs.season into v_season from card_sets cs where cs.id = p_season;
  end if;
  select count(*) into v_wm from jsonb_array_elements(coalesce(p_weak, '[]'::jsonb)) w
    where (w->>'kind' = 'type'   and w->>'value' = p_type)
       or (w->>'kind' = 'rarity' and w->>'value' = p_rarity)
       or (w->>'kind' = 'set'    and w->>'value' = p_season)
       or (w->>'kind' = 'season' and w->>'value' = v_season)
       or (w->>'kind' = 'tag'    and w->>'value' = any(p_tags));
  select count(*) into v_rm from jsonb_array_elements(coalesce(p_resist, '[]'::jsonb)) w
    where (w->>'kind' = 'type'   and w->>'value' = p_type)
       or (w->>'kind' = 'rarity' and w->>'value' = p_rarity)
       or (w->>'kind' = 'set'    and w->>'value' = p_season)
       or (w->>'kind' = 'season' and w->>'value' = v_season)
       or (w->>'kind' = 'tag'    and w->>'value' = any(p_tags));
  return jsonb_build_object('wm', v_wm, 'rm', v_rm, 'mult', public.combat_weak_mult(v_wm, v_rm, p_stack, public.balance_get('combat')));
end $function$;

CREATE OR REPLACE FUNCTION public.hunt_attack(p_player text, p_hunt bigint, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_rcap int;
  v_status text; v_closes timestamptz; v_weak jsonb; v_tier text;
  v_qty int; v_asc int; v_rarity text; v_set text; v_type text; v_mod numeric; v_cardname text;
  v_cp int; v_bonus boolean; v_day date; v_hp bigint; v_hpmax bigint;
  v_maxhp int; v_cardhp int; v_downed boolean;
  v_miss boolean; v_crit boolean; v_block boolean; v_outcome text;
  v_base numeric; v_dmg int;
  v_counter boolean; v_cdmg int; v_tmult numeric;
  v_feed text; v_settle jsonb; v_milestone boolean;
  v_total bigint; v_used int; v_topcard text; v_topdmg bigint; v_cap int;
  v_bossact text; v_slam jsonb; v_round int; v_targets jsonb;
  v_ability jsonb; v_aeff text; v_aamt numeric; v_athresh numeric; v_heal int;
  v_buff numeric; v_debuff numeric; v_shield int; v_absorb int; v_critchance numeric;
  v_enrage numeric; v_enr_until int; v_weaken numeric; v_wk_until int; v_expose numeric; v_exp_until int; v_stun_until int;
  v_bmult numeric; v_r numeric;
  v_resist jsonb; v_tags text[]; v_wtags text[]; v_wm int; v_rm int; v_stack int; v_wmult numeric;
  v_plist text[]; v_share bigint; v_bheal int; v_lost numeric; v_phase text; v_extra text; v_stunned_card boolean;
  v_passive jsonb; v_pk text; v_elem text; v_syn int; v_synmult numeric; v_burn int; v_burned boolean;
  v_origin text; v_osyn int; v_omult numeric; v_ksyn int; v_kmult numeric;
  v_stats jsonb; v_atk numeric; v_pts jsonb; v_cmb jsonb;
  v_double boolean := false; v_rally numeric; v_mend numeric; v_bf numeric;
  v_party jsonb; v_crash jsonb; v_crash_dmg int := 0; v_crash_to text; v_crash_card bigint;
  v_crash_fb boolean := false; v_crash_round int; v_clog bigint;
  v_sq jsonb; v_wk jsonb; v_hit jsonb; v_act jsonb; v_ab jsonb; v_area numeric;
  v_bname text; v_marks jsonb; v_pick jsonb; v_ctr jsonb; v_tick jsonb; v_ubuff numeric := 1;
  v_rtgt bigint; v_redir jsonb; v_squad bigint[];   -- D-129 / D-132: the card a single boss hit lands on, when it is not the attacking card
  v_rrar text; v_rasc int; v_rmod numeric; v_rpts jsonb; v_rkind text; v_rmax int;
begin
  select status, closes_at, weak_points, resist_points, tier, hp_max, passive, coalesce(hp_share, hp_max), stats, hp_remaining, name
    into v_status, v_closes, v_weak, v_resist, v_tier, v_hpmax, v_passive, v_share, v_stats, v_hp, v_bname
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then
    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  v_pk := v_passive->>'kind';
  -- Every passive the boss has (passive.list; an older hunt has only passive.kind).
  select coalesce(array_agg(x->>'kind'), array[v_pk]) into v_plist
    from jsonb_array_elements(coalesce(v_passive->'list', '[]'::jsonb)) x;
  v_plist := array_remove(v_plist, null);

  select pc.quantity, pc.ascension, c.rarity::text, c.set_id, s.type, s.cp_mod, c.name, s.ability, s.tag_slugs, pc.stat_points
    into v_qty, v_asc, v_rarity, v_set, v_type, v_mod, v_cardname, v_ability, v_tags, v_pts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_type not in ('Character', 'Creature') then
    return jsonb_build_object('ok', false, 'error', 'not_attacker', 'card_type', v_type);
  end if;

  v_day := (now() at time zone 'America/Denver')::date;
  -- One squad per day (hunt_squads.sql): a locked squad fights only with its own cards.
  if not hunt_squad_allows(p_hunt, p_player, v_day, p_card) then
    return jsonb_build_object('ok', false, 'error', 'not_in_squad');
  end if;
  -- The round limit (hunt_loop_caps.sql): a squad fights at most hunt_round_cap rounds a day.
  v_rcap := hunt_round_cap();
  if coalesce((select round from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day), 0) >= v_rcap then
    return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap);
  end if;
  -- The stat points of this copy (stat_points.sql). With the flag off: card_power + card_max_hp.
  v_cmb := card_combat(v_rarity, v_asc, v_mod, v_pts);
  v_cp := (v_cmb->>'cp')::int;
  v_maxhp := (v_cmb->>'hp')::int;

  select hp_remaining, downed, coalesce(dmg_buff, 1), coalesce(dmg_debuff, 1), coalesce(shield, 0)
    into v_cardhp, v_downed, v_buff, v_debuff, v_shield
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if not found then
    v_cardhp := v_maxhp; v_downed := false; v_buff := 1; v_debuff := 1; v_shield := 0;
    v_cap := hunt_card_cap();
    if (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) >= v_cap then
      return jsonb_build_object('ok', false, 'error', 'day_limit', 'cap', v_cap);
    end if;
  else
    v_cap := hunt_card_cap();
  end if;
  if v_downed or v_cardhp <= 0 then
    return jsonb_build_object('ok', false, 'error', 'downed', 'card_hp', 0, 'card_max_hp', v_maxhp);
  end if;

  v_round := hunt_state_round(p_hunt, p_player, v_day);
  select coalesce(cd_until_round, 0) >= v_round + 1 into v_stunned_card
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if coalesce(v_stunned_card, false) and (
       exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day
               and h.card_id <> p_card and not h.downed and coalesce(h.cd_until_round, 0) < v_round + 1
               and exists (select 1 from cards c join subjects s on s.id = c.subject_id where c.id = h.card_id and s.type in ('Character', 'Creature')))
       or (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) < v_cap) then
    return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
  end if;
  -- Mend (a boon): the first hurt card that attacks heals the waiting amount first
  -- (after the downed / stunned checks, so a refused attack keeps the boon).
  if v_cardhp < v_maxhp then
    v_mend := take_player_effect(p_player, 'mend');
    if v_mend is not null then v_cardhp := least(v_maxhp, v_cardhp + greatest(1, round(v_mend))::int); end if;
  end if;
  select boss_enrage, enrage_until, boss_weaken, weaken_until, boss_expose, expose_until, stunned_until, marks
    into v_enrage, v_enr_until, v_weaken, v_wk_until, v_expose, v_exp_until, v_stun_until, v_marks
    from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;

  v_aeff := case when v_ability->>'kind' = 'attack' then v_ability->>'effect' else null end;
  v_aamt := coalesce((v_ability->>'amount')::numeric, 0);
  v_athresh := coalesce((v_ability->>'threshold')::numeric, 0);

  -- The squad in this fight (combat_core.sql: combat_squad): the other cards and their tags.
  v_sq := combat_squad(v_tags,
    exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day),
    (select coalesce(jsonb_agg(to_jsonb(s.tag_slugs)), '[]'::jsonb)
       from (select distinct h.card_id from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id <> p_card) hc
       join cards c on c.id = hc.card_id join subjects s on s.id = c.subject_id),
    v_weak);
  v_stack := (v_sq->>'stack')::int;
  v_wk := combat_weak(v_weak, v_resist, v_type, v_rarity, v_set, v_tags, v_stack);
  v_wm := (v_wk->>'wm')::int; v_rm := (v_wk->>'rm')::int; v_wmult := (v_wk->>'mult')::numeric;
  v_bonus := v_wm > 0;
  v_elem := v_sq->>'elem'; v_syn := (v_sq->>'syn')::int; v_synmult := (v_sq->>'synmult')::numeric;

  v_critchance := combat_crit_chance(v_bonus, v_aeff, v_aamt, v_cmb);
  v_hit := combat_hit(v_cp, v_wmult, v_buff, v_debuff, v_synmult, v_critchance,
    combat_miss('shrouded' = any(v_plist)),                                          -- shrouded: more misses
    v_aeff, v_aamt, v_athresh, 'armored' = any(v_plist) and 'trait:melee' = any(v_tags),
    case when v_exp_until >= v_round and v_expose > 0 and not hunt_mark_on(v_marks, 'block_expose', v_round) then v_expose else 0 end, v_hp, v_hpmax);   -- Veil (hunt_boss_moves.sql)
  v_miss := (v_hit->>'miss')::boolean; v_crit := (v_hit->>'crit')::boolean; v_block := (v_hit->>'block')::boolean;
  v_dmg := (v_hit->>'dmg')::int; v_outcome := v_hit->>'outcome'; v_double := (v_hit->>'double')::boolean;
  if not v_miss then
    -- Rally (a boon): the next hit deals +amount % (the boon is used up by this hit).
    v_rally := take_player_effect(p_player, 'rally');
    if v_rally is not null then v_dmg := greatest(1, round(v_dmg * (1 + least(v_rally, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Butterfingers (a prank, effects_outside.sql): the next hit deals -amount % (used up by this hit).
    v_bf := take_player_effect(p_player, 'butterfingers');
    if v_bf is not null and v_dmg > 0 then v_dmg := greatest(1, round(v_dmg * (1 - least(v_bf, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Launch Party (the Launch Day Player boon, launch_event_cards.sql): +amount % on each of the
    -- next N hits (options.uses), one charge per hit.
    v_party := use_effect_charge(p_player, 'launch_party');
    if v_party is not null then v_dmg := greatest(1, round(v_dmg * (1 + least((v_party->>'amount')::numeric, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Raid Crasher (the Launch Day Raider prank): the boss takes +amount % more on each of the next N
    -- hits, and that extra damage counts for the prankster (options.credit_to) on the leaderboard.
    v_crash := use_effect_charge(p_player, 'raid_crasher');
    if v_crash is not null then
      v_crash_dmg := greatest(1, round(v_dmg * least((v_crash->>'amount')::numeric, balance_num('combat', 'effect_cap_pct')) / 100.0))::int;
      v_crash_to := coalesce(v_crash->'options'->>'credit_to', v_crash->'options'->>'sender_id');
      v_crash_card := (v_crash->'options'->>'card_id')::bigint;
      -- No owner or no card (damage_log.sql): the extra damage still hits the boss, so the attacker gets the credit on
      -- the attacking card. Boss HP and hunt_hits then agree; the log row says fallback.
      if v_crash_to is null or v_crash_card is null then
        v_crash_to := p_player; v_crash_card := p_card; v_crash_fb := true;
      end if;
      v_crash_round := v_round;
    end if;
  end if;

  if v_dmg > 0 then
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
      values (p_hunt, p_player, p_card, v_day, v_dmg)
      on conflict (hunt_id, player_id, card_id, hit_date)
      do update set damage = hunt_hits.damage + excluded.damage;
    -- The Raid Crasher share: the prankster's own hunt_hits row (their Raider card), so it counts
    -- for the leaderboard and the prizes.
    if v_crash_dmg > 0 and v_crash_to is not null and v_crash_card is not null then
      insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
        values (p_hunt, v_crash_to, v_crash_card, v_day, v_crash_dmg)
        on conflict (hunt_id, player_id, card_id, hit_date)
        do update set damage = hunt_hits.damage + excluded.damage;
    end if;
    update hunts set hp_remaining = greatest(0, hp_remaining - v_dmg - v_crash_dmg),
      status      = case when hp_remaining - v_dmg - v_crash_dmg <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_dmg - v_crash_dmg <= 0 then now() else defeated_at end
      where id = p_hunt;
  end if;
  select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;

  v_heal := 0;
  if v_aeff = 'lifesteal' and v_dmg > 0 then
    v_heal := combat_lifesteal(v_dmg, v_aamt, v_maxhp);  -- cap: lifesteal cannot out-heal the boss
    v_cardhp := least(v_maxhp, v_cardhp + v_heal);
  end if;
  -- Counter marks on this attack (hunt_boss_moves.sql): Counter-pick (an empowered attack hurts the attacker by the
  -- bonus x counterpick.x) and Demotion (an attack on an exposed boss sends demotion.back back): balance boss_counters.
  if v_dmg > 0 and v_buff > 1 and hunt_mark_on(v_marks, 'counterpick', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(hunt_counter_num('counterpick', 'x') * v_dmg * (v_buff - 1) / v_buff))::int);
  end if;
  if v_dmg > 0 and v_exp_until >= v_round and v_expose > 0 and hunt_mark_on(v_marks, 'demotion', v_round)
     and not hunt_mark_on(v_marks, 'block_expose', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(v_dmg * hunt_counter_num('demotion', 'back')))::int);
  end if;
  v_ubuff := v_buff;   -- the empower this attack used (Tier List)
  v_buff := 1;

  -- The boss ATK (Nathan, 2026-09-28: flat stats, so tougher cards survive more hits).
  -- hunts.stats.atk is set at spawn; an older hunt uses the tier default.
  v_atk := coalesce((v_stats->>'atk')::numeric, balance_num('boss_atk', v_tier));
  v_bossact := null; v_cdmg := 0; v_slam := '[]'::jsonb;
  if v_status <> 'defeated' then
    update hunt_combat_state set round = round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
      returning round into v_round;
    -- Phase 1 below 50% HP: permanent rage. Frenzied: +5% per 10% of HP lost (combat_enemy_mult).
    v_lost := 1 - v_hp::numeric / greatest(1, v_hpmax);
    v_bmult := combat_enemy_mult(v_enrage, v_enr_until,
      case when hunt_mark_on(v_marks, 'block_weaken', v_round) then 0 else v_weaken end,   -- Alt-F4 (hunt_boss_moves.sql)
      v_wk_until, v_round, 'volatile' = any(v_plist), v_lost, 'frenzied' = any(v_plist));
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: + spiral.step for each weaken played
      v_bmult := v_bmult * (1 + coalesce((v_marks->'spiral'->>'bonus')::numeric, 0));
    end if;
    v_bheal := 0;

    -- The enemy turn (combat_core.sql: combat_enemy_act): a surprise draw.
    -- The damage-over-time marks tick first (hunt_boss_moves.sql: Infect, Nightshade).
    v_tick := hunt_counter_tick(p_hunt, p_player, v_day, p_card, v_round);
    if (v_tick->>'attacker')::int > 0 then
      v_ab := combat_absorb(v_shield, (v_tick->>'attacker')::int); v_shield := (v_ab->>'shield')::int;
      v_cardhp := greatest(0, v_cardhp - (v_ab->>'dmg')::int);
    end if;
    v_act := combat_enemy_act(v_atk, v_bmult, v_round, v_stun_until, v_lost, v_share);
    v_bossact := v_act->>'action'; v_cdmg := (v_act->>'dmg')::int; v_area := (v_act->>'area')::numeric;
    v_bheal := v_bheal + (v_act->>'heal')::int;
    -- A counter move (hunt_boss_moves.sql): a share of the normal turns of a boss with a move pool (balance boss_counters). An effect move comes on
    -- top of the usual turn (base); a hit move replaces it.
    v_pick := hunt_counter_pick(p_hunt, p_player, v_day, v_bname, v_bossact);
    if v_pick is not null then
      v_ctr := hunt_counter_act(p_hunt, p_player, v_day, p_card, v_round, v_atk, v_bmult, v_pick->>'key', v_pick->>'name',
        v_cardhp, v_maxhp, v_shield, v_ubuff);
      if v_ctr->>'shield' is not null then v_shield := (v_ctr->>'shield')::int; end if;
      if v_ctr->>'debuff' is not null then v_debuff := (v_ctr->>'debuff')::numeric; end if;
      v_cardhp := greatest(0, v_cardhp - (v_ctr->>'loss')::int);
      v_bheal := v_bheal + (v_ctr->>'heal')::int;
      if not (v_ctr->>'base')::boolean then   -- a hit move: no usual turn
        v_bheal := v_bheal - (v_act->>'heal')::int;
        v_bossact := 'counter'; v_area := 0; v_cdmg := (v_ctr->>'dmg')::int;
        if not (v_ctr->>'pierce')::boolean then
          v_ab := combat_absorb(v_shield, v_cdmg); v_shield := (v_ab->>'shield')::int; v_cdmg := (v_ab->>'dmg')::int;
        end if;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
      end if;
    end if;
    -- D-129 (Nathan, 2026-10-08) and D-132 (2026-10-09): the boss's SINGLE hit (strike, drain, stun) picks a RANDOM card of the
    -- WHOLE LOCKED SQUAD, the attacking card and the supports included, from the first attack of the day. A support can go
    -- down here (D-126: only in the Hunt and the Arena). The pool: the attacking card, and every card of today's locked squad
    -- (hunt_squads.card_ids) that is owned and not down. A squad card that has not acted yet has no hunt_card_hp row: it enters
    -- with full HP when it is hit (hunt_commit_card; if the cap refuses, the same insert, so the hit is never lost). With no
    -- locked squad (a member who never locked one) the pool is the attacking card and the cards that already have a row.
    -- Slam and Cataclysm keep their own targets (the attacking card takes the main hit, every other card WITH A ROW its own
    -- area hit), and so do the counter moves.
    v_rtgt := null; v_redir := null;
    if v_bossact in ('strike', 'drain', 'stun') then
      select card_ids into v_squad from hunt_squads where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      select t.cid into v_rtgt from (select p_card as cid
          union select x from unnest(coalesce(v_squad, '{}'::bigint[])) x
            where x <> p_card
              and not exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = x and h.downed)
              and exists (select 1 from player_cards pc where pc.player_id = p_player and pc.card_id = x and pc.quantity > 0)
          union select h.card_id from hunt_card_hp h
            where v_squad is null and h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id <> p_card and not h.downed) t
        order by random() limit 1;
    end if;
    if v_rtgt is not null and v_rtgt <> p_card then   -- the hit lands on another card: it takes the hit (and the stun) instead
      if not exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = v_rtgt) then
        -- D-132: a squad card that never acted enters with full HP (the HP rule of hunt_support: card_combat, a support card_max_hp(0))
        select pc.ascension, c.rarity::text, s.cp_mod, pc.stat_points, s.ability->>'kind'
          into v_rasc, v_rrar, v_rmod, v_rpts, v_rkind
          from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
          where pc.player_id = p_player and pc.card_id = v_rtgt;
        v_rmax := (card_combat(v_rrar, v_rasc, v_rmod, v_rpts)->>'hp')::int;
        if v_rkind = 'support' then v_rmax := card_max_hp(0); end if;
        if not hunt_commit_card(p_hunt, p_player, v_rtgt, v_day, v_rmax) then   -- refused (the daily card cap): the hit is not lost
          insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)
            values (p_hunt, p_player, v_rtgt, v_day, v_rmax, v_rmax, false)
            on conflict (hunt_id, player_id, card_id, hit_date) do nothing;
        end if;
      end if;
      v_redir := hunt_counter_hit(p_hunt, p_player, v_day, v_rtgt, v_cdmg, false);
      if v_bossact = 'stun' then
        update hunt_card_hp set cd_until_round = greatest(coalesce(cd_until_round, 0), v_round + 1), updated_at = now()
          where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and card_id = v_rtgt;
      end if;
      v_cdmg := 0;
    elsif v_bossact in ('cataclysm', 'strike', 'slam', 'drain', 'stun') then
      v_ab := combat_absorb(v_shield, v_cdmg); v_shield := (v_ab->>'shield')::int; v_cdmg := (v_ab->>'dmg')::int;
      v_cardhp := greatest(0, v_cardhp - v_cdmg);
    end if;
    if v_area > 0 then   -- Slam / Cataclysm: every other card standing rolls its own hit
      with tgt as (
        select h.card_id, greatest(0, h.raw - coalesce(h.shield, 0)) as dmg,
               greatest(0, coalesce(h.shield, 0) - h.raw) as shleft
               from (select x.*, combat_area_roll(v_atk, v_area, v_bmult) as raw
                     from hunt_card_hp x
                     where x.hunt_id = p_hunt and x.player_id = p_player and x.hit_date = v_day and x.card_id <> p_card and not x.downed) h
      ), upd as (
        update hunt_card_hp h set hp_remaining = greatest(0, h.hp_remaining - t.dmg),
            shield = t.shleft, downed = (h.hp_remaining - t.dmg) <= 0, updated_at = now()
        from tgt t where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = t.card_id
        returning h.card_id, h.hp_remaining, h.max_hp, h.downed, t.dmg
      )
      select coalesce(jsonb_agg(jsonb_build_object('card_id', card_id, 'dmg', dmg, 'hp', hp_remaining, 'max_hp', max_hp, 'downed', downed)), '[]'::jsonb)
        into v_slam from upd;
    end if;
    if v_bossact = 'enrage' then
      update hunt_combat_state set boss_enrage = balance_num('boss_moves', 'enrage_x'), enrage_until = v_round + balance_num('boss_moves', 'enrage_rounds')::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif v_bossact = 'curse' then
      v_debuff := balance_num('boss_moves', 'curse_x');
    end if;
    if 'regenerating' = any(v_plist) and v_bossact <> 'stunned' then v_bheal := v_bheal + combat_regen(v_share); end if;
    if 'thorns' = any(v_plist) and v_dmg > 0 then
      v_cardhp := greatest(0, v_cardhp - combat_thorns(v_dmg));
    end if;
    if v_bheal > 0 then
      update hunts set hp_remaining = least(hp_max, hp_remaining + v_bheal) where id = p_hunt and status = 'active'
        returning hp_remaining into v_hp;
    end if;
    -- Phase 2 below boss_moves.phase2_at HP: the boss gains one more passive (once per hunt).
    v_phase := null;
    if v_hp::numeric / greatest(1, v_hpmax) < balance_num('boss_moves', 'phase2_at') and not coalesce((v_passive->>'phase2')::boolean, false) then
      select k into v_extra from unnest(passives_for('phase2')) k
        where k <> all(v_plist) order by random() limit 1;
      update hunts set passive = coalesce(passive, '{}'::jsonb) || jsonb_build_object('phase2', true,
          'list', coalesce(passive->'list', '[]'::jsonb) || case when v_extra is null then '[]'::jsonb
            else jsonb_build_array(jsonb_build_object('kind', v_extra, 'label', passive_label(v_extra))) end)
        where id = p_hunt;
      v_phase := coalesce(v_extra, 'phase2');
    elsif (v_hp + v_dmg)::numeric / greatest(1, v_hpmax) >= balance_num('boss_moves', 'rage_at') and v_hp::numeric / greatest(1, v_hpmax) < balance_num('boss_moves', 'rage_at') then
      v_phase := 'rage';                            -- this hit took the boss below rage_at
    end if;
  end if;

  -- Flaming boss: a chance the attacking card catches burn after acting.
  v_burned := false;
  if 'flaming' = any(v_plist) and v_status <> 'defeated' then
    v_burn := combat_burn(v_atk);
    if v_burn > 0 then
      v_ab := combat_absorb(v_shield, v_burn); v_shield := (v_ab->>'shield')::int; v_burn := (v_ab->>'dmg')::int;
      v_cardhp := greatest(0, v_cardhp - v_burn); v_burned := v_burn > 0;
    end if;
  end if;

  v_downed := v_cardhp <= 0;
  v_counter := v_bossact is not null and v_bossact not in ('stunned', 'enrage', 'curse', 'regenerate', 'charging');

  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, dmg_buff, dmg_debuff, shield, cd_until_round)
    values (p_hunt, p_player, p_card, v_day, v_cardhp, v_maxhp, v_downed, v_buff, v_debuff, v_shield,
            case when v_bossact = 'stun' and v_redir is null then v_round + 1 else 0 end)
    on conflict (hunt_id, player_id, card_id, hit_date)
    do update set hp_remaining = excluded.hp_remaining, downed = excluded.downed,
      dmg_buff = excluded.dmg_buff, dmg_debuff = excluded.dmg_debuff, shield = excluded.shield,
      cd_until_round = greatest(excluded.cd_until_round, hunt_card_hp.cd_until_round), updated_at = now();

  insert into hunt_combat_log (hunt_id, player_id, card_id, cp, outcome, bonus, crit, block,
    damage, countered, counter_dmg, card_hp_after, card_downed, boss_hp_after)
  values (p_hunt, p_player, p_card, v_cp, v_outcome, v_bonus, v_crit, v_block,
    v_dmg, v_counter, v_cdmg, v_cardhp, v_downed, v_hp)
  returning id into v_clog;

  -- The Hunt Crasher log row (damage_log.sql): the extra damage that hunt_hits credits to the prankster's Raider card.
  -- amount = the charge amount (%), result.value = the damage, combat_log_id = the attack it rode on.
  if v_dmg > 0 and v_crash_dmg > 0 then
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, result)
    values ('hunt', p_hunt, v_crash_to, v_crash_card, 'effect', v_day, v_crash_round, 'raid_crasher', (v_crash->>'amount')::numeric,
      jsonb_build_object('value', v_crash_dmg, 'attacker', p_player, 'attack_card', p_card, 'combat_log_id', v_clog, 'fallback', v_crash_fb));
  end if;

  if v_status = 'defeated' then
    v_settle := settle_hunt(p_hunt);
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;

  select coalesce((select value #>> '{}' from settings where key = 'hunt_attack_feed'), 'milestones') into v_feed;
  v_milestone := v_crit or v_downed;
  if v_status <> 'defeated' and not v_miss and (v_feed = 'all' or (v_feed = 'milestones' and v_milestone)) then
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'attack', jsonb_build_object('player_id', p_player, 'card', v_cardname,
        'damage', v_dmg, 'outcome', v_outcome, 'crit', v_crit, 'bonus', v_bonus, 'downed', v_downed));
  end if;

  -- The end-of-day summary (hunt_squad_done.sql): when every attacker of the locked squad is down,
  -- once per member per day. It needed 8 cards used, so a short squad (or the old squad bug) never posted.
  -- The round limit also ends the squad, so its summary posts then too (hunt_loop_caps.sql).
  if v_status <> 'defeated' and ((v_downed and hunt_squad_done(p_hunt, p_player, v_day, v_cap)) or v_round >= v_rcap)
     and not exists (select 1 from hunt_events where hunt_id = p_hunt and kind = 'player_done'
                       and payload->>'player_id' = p_player and created_at >= (v_day::timestamp at time zone 'America/Denver')) then
    select coalesce(sum(damage), 0), count(distinct card_id) into v_total, v_used
      from hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    select c.name, sub.d into v_topcard, v_topdmg
      from (select card_id, sum(damage) d from hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
            group by card_id order by d desc limit 1) sub join cards c on c.id = sub.card_id;
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'player_done', jsonb_build_object('player_id', p_player,
        'total', v_total, 'cards_used', v_used, 'top_card', v_topcard, 'top_damage', v_topdmg,
        'boss_hp', v_hp, 'boss_hp_max', v_hpmax));
  end if;

  v_targets := case when v_redir is null then '[]'::jsonb else jsonb_build_array(v_redir) end   -- the HIT card is targets[0] (the client marks a stun / curse on targets[0])
      || jsonb_build_array(jsonb_build_object('card_id', p_card, 'dmg', v_cdmg,
      'hp', v_cardhp, 'max_hp', v_maxhp, 'downed', v_downed)) || coalesce(v_slam, '[]'::jsonb) || coalesce(v_tick->'targets', '[]'::jsonb)
      || coalesce(v_ctr->'targets', '[]'::jsonb);

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'outcome', v_outcome,
    'bonus', v_bonus, 'resisted', v_rm > 0, 'crit', v_crit, 'cp', v_cp, 'heal', v_heal, 'ability', v_aeff,
    'hp_remaining', v_hp, 'status', v_status, 'defeated', v_status = 'defeated',
    'countered', v_counter, 'counter_dmg', v_cdmg,
    'round', v_round, 'round_cap', v_rcap,
    'card_hp', v_cardhp, 'card_max_hp', v_maxhp, 'card_downed', v_downed, 'shield', v_shield,
    'burned', v_burned, 'double', v_double, 'rally', v_rally, 'butterfingers', v_bf, 'mend', v_mend, 'party', v_party->'amount', 'crashed', nullif(v_crash_dmg, 0), 'atk', round(v_atk), 'boss_heal', coalesce(v_bheal, 0), 'phase', v_phase, 'passives', to_jsonb(v_plist),
    'synergy', case when v_syn >= balance_num('combat', 'syn_small_at') then jsonb_build_object('element', v_elem, 'count', v_syn) else null end,
    'boss_action', case when v_bossact is null then null
      else jsonb_build_object('kind', case when v_bossact = 'counter' then v_ctr->>'anim' else v_bossact end, 'round', v_round, 'targets', v_targets)
        || case when v_ctr is null then '{}'::jsonb else jsonb_build_object('move', v_ctr->>'move', 'counter', v_ctr->>'key') end end);
end $function$;

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
    select c.id, s.type, c.rarity::text rar, c.set_id, array(select t from unnest(s.tag_slugs) t where t = any(v_wt) order by t) wtags,
           case when s.ability->>'kind' = 'attack' then s.ability->>'effect' end aeff, coalesce((s.ability->>'amount')::numeric, 0) aamt,
           coalesce(pc.stat_points, '{}'::jsonb) pts
      from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
     where pc.player_id = p_player and pc.quantity > 0 and s.type in ('Character', 'Creature')),
  wk as materialized (select d.*, (combat_weak(v_w, v_r, d.type, d.rar, d.set_id, d.wtags, 0)->>'wm')::int > 0 bonus
                        from (select distinct type, rar, set_id, wtags from k) d),
  p as materialized (select d.pts, card_combat('normal', 0, 1, d.pts, v_b) cmb from (select distinct pts from k) d),
  kk as materialized (select k.id, wk.bonus, k.aeff, k.aamt, k.pts from k join wk on wk.type = k.type and wk.rar = k.rar
                        and wk.set_id is not distinct from k.set_id and wk.wtags = k.wtags),
  x as materialized (select d.*, combat_crit_chance(d.bonus, d.aeff, d.aamt, p.cmb) crit
                       from (select distinct bonus, aeff, aamt, pts from kk) d join p on p.pts = d.pts)
  select coalesce(jsonb_object_agg(kk.id::text, x.crit), '{}'::jsonb) into res
    from kk join x on x.bonus = kk.bonus and x.aeff is not distinct from kk.aeff and x.aamt = kk.aamt and x.pts = kk.pts;
  return res;
end $function$;

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
  cross join lateral (select combat_weak(h.w, h.r, s.type, c.rarity::text, c.set_id, s.tag_slugs, 0) v) wk
  where pc.player_id = p_player and pc.quantity > 0 and (p_cards is null or pc.card_id = any(p_cards));
$function$;

CREATE OR REPLACE FUNCTION public.dungeon_attack(p_player text, p_card bigint, p_target integer DEFAULT NULL::integer, p_mode text DEFAULT 'daily'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); r dungeon_runs; st jsonb; c jsonb; info jsonb; f jsonb; v_t int; v_tags text[];
  v_ab jsonb; v_aeff text; v_aamt numeric; v_athresh numeric; sq jsonb; wk jsonb; v_crit numeric; hit jsonb; v_dmg int := 0; v_heal int := 0;
  v_round int; v_pl text[]; ek text; kill jsonb := null; v_cmb jsonb; v_boost numeric := 0; et jsonb := null; v_maxhp int; v_guard int := 0; v_end jsonb := null;
  v_fh0 int; v_log jsonb := '[]';   -- dungeon_combat_log.sql: the foe HP before the hit; the HP events of this action
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  select * into r from dungeon_runs where player_id = p_player and day = dungeon_day() and status = 'active' and mode = coalesce(p_mode, 'daily') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_run'); end if;
  st := r.state;
  if st->>'phase' <> 'fight' then return jsonb_build_object('ok', false, 'error', 'not_fighting'); end if;
  c := st->'cards'->p_card::text;
  if c is null then return jsonb_build_object('ok', false, 'error', 'not_in_squad'); end if;
  info := dungeon_run_card(r, p_card);
  if info is null then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if info->>'type' not in ('Character', 'Creature') then return jsonb_build_object('ok', false, 'error', 'not_attacker'); end if;
  if (c->>'down')::boolean then return jsonb_build_object('ok', false, 'error', 'downed'); end if;
  v_round := (st->>'round')::int;
  if v_round >= balance_num('dungeon', 'round_cap')::int then   -- balance dungeon.round_cap
    perform dungeon_settle(r.id, 'fell', false); return jsonb_build_object('ok', false, 'error', 'round_cap'); end if;
  -- D-182: a stunned card never attacks (it was allowed when every attacker was stunned). With no action left the turn passes: dungeon_pass_turn.
  if (c->>'cd')::int >= v_round + 1 then return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', (c->>'cd')::int); end if;
  select (e.ord - 1)::int into v_t from jsonb_array_elements(st->'foes') with ordinality e(f, ord)
    where (e.f->>'hp')::int > 0 order by (case when (e.ord - 1)::int = p_target then 0 else 1 end), e.ord limit 1;
  f := st->'foes'->v_t;
  v_tags := dungeon_txt(info->'tags'); v_pl := dungeon_txt(f->'passives');
  v_ab := info->'ability'; v_cmb := info->'cmb'; v_maxhp := (c->>'max')::int;
  v_aeff := case when v_ab->>'kind' = 'attack' then v_ab->>'effect' else null end;
  v_aamt := coalesce((v_ab->>'amount')::numeric, 0); v_athresh := coalesce((v_ab->>'threshold')::numeric, 0);
  sq := combat_squad(v_tags, true,
    (select coalesce(jsonb_agg(coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)), '[]'::jsonb) from unnest(r.squad) x
       join cards cc on cc.id = x join subjects s on s.id = cc.subject_id where x <> p_card), f->'weak');
  wk := combat_weak(f->'weak', f->'resist', info->>'type', info->>'rarity', info->>'set', v_tags, (sq->>'stack')::int);
  v_crit := combat_crit_chance((wk->>'wm')::int > 0, v_aeff, v_aamt, v_cmb);
  hit := combat_hit((v_cmb->>'cp')::int, (wk->>'mult')::numeric, (c->>'buff')::numeric, (c->>'debuff')::numeric, (sq->>'synmult')::numeric,
    v_crit, combat_miss('shrouded' = any(v_pl)), v_aeff, v_aamt, v_athresh,
    'armored' = any(v_pl) and 'trait:melee' = any(v_tags),
    case when (f->>'exu')::int >= v_round and (f->>'ex')::numeric > 0 then (f->>'ex')::numeric else 0 end,
    (f->>'hp')::bigint, (f->>'max')::bigint);
  v_dmg := (hit->>'dmg')::int;
  if v_dmg > 0 then
    select rule->>'boost_tag', coalesce((rule->>'boost')::numeric, 0) into ek, v_boost from dungeon_days where day = r.day and r.mode = 'daily';
    v_dmg := greatest(1, round(v_dmg * (st->>'buff')::numeric * (1 + case when ek is not null and ek = any(v_tags) then v_boost else 0 end)))::int;
    -- A monster's guard (Stone Skin, Shield Up ...) absorbs first.
    v_guard := least(coalesce((f->>'sh')::int, 0), v_dmg);
    f := f || jsonb_build_object('sh', coalesce((f->>'sh')::int, 0) - v_guard);
    v_dmg := v_dmg - v_guard;
  end if;
  v_fh0 := (f->>'hp')::int;
  f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_dmg));
  st := jsonb_set(st, array['foes', v_t::text], f);
  -- The attack row (dungeon_combat_log.sql): value = the HP the foe lost (dmg = the hit after the guard, before the HP floor).
  v_log := jsonb_build_array(dungeon_hp_event('attack', v_aeff, p_card, null, v_t, v_round, 'foe', 'dmg', v_fh0 - (f->>'hp')::int, f,
    jsonb_build_object('dmg', v_dmg, 'guarded', v_guard, 'outcome', hit->>'outcome', 'crit', hit->'crit', 'double', hit->'double',
      'bonus', (wk->>'wm')::int > 0, 'resisted', (wk->>'rm')::int > 0, 'cp', (v_cmb->>'cp')::int))
    || jsonb_build_object('amount', case when v_aeff is not null then v_aamt end));
  if v_aeff = 'lifesteal' and v_dmg > 0 then
    v_heal := combat_lifesteal(v_dmg, v_aamt, v_maxhp);
    st := jsonb_set(st, array['cards', p_card::text, 'hp'], to_jsonb(least(v_maxhp, (c->>'hp')::int + v_heal)));
    v_log := v_log || dungeon_hp_event('effect', 'lifesteal', p_card, p_card, v_t, v_round, 'card', 'heal',
      least(v_maxhp, (c->>'hp')::int + v_heal) - (c->>'hp')::int, st->'cards'->p_card::text, jsonb_build_object('raw', v_heal));
  end if;
  st := jsonb_set(st, array['cards', p_card::text, 'buff'], '1');
  if (f->>'hp')::int <= 0 then kill := dungeon_after_kill(r, st); st := kill->'state'; end if;
  if st->>'phase' = 'fight' then
    et := dungeon_enemy_turn(st, p_card, v_t, v_dmg); st := et->'state';
    v_log := v_log || coalesce(et->'hp_log', '[]'::jsonb);
    -- The squad falls when no ATTACKER stands (support cards alone cannot attack: the run was stuck).
    if not exists (select 1 from jsonb_each(st->'cards') where not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false)) then st := st || '{"phase": "fell"}'; end if;
  end if;
  update dungeon_runs set state = st, turns = turns + 1 where id = r.id;
  perform dungeon_combat_log(r, v_log);   -- dungeon_combat_log.sql: the attack, lifesteal and every enemy HP change
  if st->>'phase' = 'fell' then v_end := dungeon_settle(r.id, 'fell', false);
  elsif st->>'phase' = 'cleared' then v_end := dungeon_settle(r.id, 'cleared', true); end if;
  perform dungeon_log_add(r.id, jsonb_build_object('kind', 'attack', 'card', p_card, 'target', v_t),
    jsonb_build_object('dmg', v_dmg, 'guarded', v_guard, 'outcome', hit->>'outcome', 'double', hit->'double', 'heal', v_heal, 'enemy', et->'actions', 'kill', kill));
  return jsonb_build_object('ok', true, 'damage', v_dmg, 'guarded', v_guard, 'outcome', hit->>'outcome', 'crit', hit->'crit', 'double', hit->'double',
    'bonus', (wk->>'wm')::int > 0, 'resisted', (wk->>'rm')::int > 0, 'heal', v_heal, 'target', v_t,
    'kill', kill is not null, 'loot', case when kill is null then null else jsonb_build_object('shards', kill->'shards', 'card', kill->'card') end,
    'enemy', coalesce(et->'actions', '[]'::jsonb), 'burned', coalesce(et->'burned', '0'), 'poison', coalesce(et->'poison', '[]'::jsonb),
    'settled', v_end,
    'state', (select state from dungeon_runs where id = r.id), 'status', (select status from dungeon_runs where id = r.id));
end $function$;

CREATE OR REPLACE FUNCTION public.dungeon_card(p_player text, p_card bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', c.id, 'name', c.name, 'type', s.type, 'rarity', c.rarity::text, 'season', c.season, 'set', c.set_id,
    'tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'ability', s.ability,
    'cmb', card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points))
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0;
$function$;

CREATE OR REPLACE FUNCTION public.dungeon_card_base(p_card bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', c.id, 'name', c.name, 'type', s.type, 'rarity', c.rarity::text, 'season', c.season, 'set', c.set_id,
    'tags', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb), 'ability', s.ability,
    'cmb', card_combat(c.rarity::text, 0, s.cp_mod, '{}'::jsonb))
  from cards c join subjects s on s.id = c.subject_id where c.id = p_card;
$function$;

notify pgrst, 'reload schema';
