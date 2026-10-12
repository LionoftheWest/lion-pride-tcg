/**
 * Acceptance test for tcg-bot/supabase/perf_five_slow_calls.sql, with NO lasting change:  node scripts/test-perf-five-slow-calls.mjs
 * Invariants:
 *   1. card_powers, dungeon_view / dungeon_view_lite (dungeon_view_core), gauntlet_view and ach_track_values (achievement_view)
 *      answer EXACTLY as the texts before the file did (reference copies ref_*, the live texts of 2026-10-11, db/schema) for EVERY
 *      player of the database, and card_powers(null) too. dungeon_view 'mine': cards with the same cp had no defined order in the
 *      old text, so the comparison sorts them by (cp desc, id) on both sides, as test-dungeon-view-lite.mjs does.
 *   2. The speed mechanism (a counting wrapper around the function, inside the rolled-back block): card_combat runs once per DIFFERENT input in card_powers and in 'mine', and
 *      dungeon_card_base once per squad card in gauntlet_view. A change that brings back the per-card calls fails here.
 * One DO block; the exception rolls everything back.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

// The reference copies: the live texts of 2026-10-11 (before perf_five_slow_calls.sql), renamed ref_*.
const REF = String.raw`
create function ref_gauntlet_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); v_week date := gauntlet_week(dungeon_day()); w gauntlet_weeks; r dungeon_runs; b jsonb; v_board jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  w := gauntlet_generate(v_week);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet';
  v_board := gauntlet_board(v_week, 100000);   -- read ONCE: the member's row and the top 3 both come from it
  select e into b from jsonb_array_elements(v_board) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'mode', 'gauntlet', 'day', v_day, 'week', v_week,
    'next_at', (v_day + 1)::timestamp at time zone 'America/Denver', 'ends_at', (v_week + 7)::timestamp at time zone 'America/Denver',
    'name', w.name, 'theme', w.theme, 'gate', adventure_gate(p_player), 'cost', cfg->'cost',
    'budget', balance_num('gauntlet', 'budget')::int,
    'squad', (select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.c->>'type', 'rarity', x.c->>'rarity',
               'cost', balance_num('dungeon', 'cost', x.c->>'rarity')::int, 'cp', (x.c->'cmb'->>'cp')::int,
               'hp', case when x.c->>'type' in ('Character', 'Creature') then (x.c->'cmb'->>'hp')::int else card_max_hp(0) end,
               'slugs', x.c->'tags') order by x.o)
             from unnest(w.squad) with ordinality x0(id, o) cross join lateral (select x0.id, x0.o, dungeon_card_base(x0.id) c) x),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', 0, 'cards', '[]'::jsonb, 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', (b->>'rank')::int) end,
    'best', b,
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(w.floors->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(w.floors),
    'players_week', (select count(distinct player_id) from dungeon_runs where mode = 'gauntlet' and day between v_week and v_week + 6),
    'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),
    'prizes', coalesce(dungeon_prizes_cfg()->'weekly', '[]'::jsonb));
end $function$
;
create function ref_card_powers(p_player text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with b as (select card_balance() v)
  select coalesce(jsonb_object_agg(x.id::text, x.v), '{}'::jsonb) from (
    select c.id, jsonb_build_object('power', round(card_cp_exact(c.rarity::text, 0, s.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int,
                                    'hp', card_max_hp(round(card_cp_exact(c.rarity::text, 0, s.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int,
                                                      (b.v->'card_hp'->>'floor')::numeric, (b.v->'card_hp'->>'per_cp')::numeric)) as v
      from b, cards c left join subjects s on s.id = c.subject_id where p_player is null
    union all
    select c.id, card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points, b.v)
                 || jsonb_build_object('power', round(card_cp_exact(c.rarity::text, pc.ascension, s.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int)
      from b, player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
     where p_player is not null and pc.player_id = p_player and pc.quantity > 0) x;
$function$
;
create function ref_ach_track_values(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v jsonb := '{}'::jsonb; n bigint; dv jsonb := coalesce(shard_cfg()->'dupe_values', '{}'::jsonb);
begin
  -- Collection (draw-pool cards only: Event cards do not count)
  select jsonb_build_object(
           'collector', count(*),
           'shine', count(*) filter (where c.rarity in ('illustrated_rare', 'secret_rare', 'full_art', 'gold')),
           'elementalist', count(*) filter (where ach_has_element(s.tags)))
    into v
    from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
   where pc.player_id = p_player and pc.quantity > 0 and c.in_draw_pool;
  select count(*) into n from (
    select c.subject_id from cards c left join player_cards pc on pc.card_id = c.id and pc.player_id = p_player and pc.quantity > 0
     where c.in_draw_pool group by c.subject_id having count(*) >= 2 and count(pc.card_id) = count(*)) x;
  v := v || jsonb_build_object('fullsets', n);
  v := v || (select jsonb_build_object(
      'ascension', coalesce(sum(pc.ascension), 0),
      'trainer', coalesce(sum(stat_pt(pc.stat_points, 'attack') + stat_pt(pc.stat_points, 'vitality') + stat_pt(pc.stat_points, 'precision')
                              + stat_pt(pc.stat_points, 'potency') + stat_pt(pc.stat_points, 'haste')), 0))
    from player_cards pc where pc.player_id = p_player and pc.quantity > 0);
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
end $function$
;
create function ref_dungeon_view_core(p_player text, p_mine boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int; v_mine jsonb := '{}'::jsonb;
  v_b jsonb; v_cost jsonb; v_h0 int; v_board jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  d := dungeon_generate(v_day);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
  v_board := dungeon_board(v_day, 1000);   -- read ONCE: the member's rank and the top 3 both come from it
  select (e->>'rank')::int into v_rank from jsonb_array_elements(v_board) e where e->>'player_id' = p_player;
  if p_mine then
    v_b := card_balance(); v_cost := balance_get('dungeon')->'cost'; v_h0 := card_max_hp(0);
    v_mine := jsonb_build_object('mine', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', s.type, 'rarity', c.rarity::text,
               'cost', coalesce((v_cost->>c.rarity::text)::numeric, balance_num('dungeon', 'cost', c.rarity::text))::int, 'cp', (x.cmb->>'cp')::int,
               'hp', case when s.type in ('Character', 'Creature') then (x.cmb->>'hp')::int else v_h0 end,
               'slugs', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)) order by (x.cmb->>'cp')::int desc), '[]'::jsonb)
             from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
             cross join lateral (select card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points, v_b) cmb) x
             where pc.player_id = p_player and pc.quantity > 0));
  end if;
  return jsonb_build_object('ok', true, 'day', v_day, 'next_at', (v_day + 1)::timestamp at time zone 'America/Denver',
    'name', d->>'name', 'rule', d->'rule', 'budget', coalesce((d->'rule'->>'budget')::int, balance_num('dungeon', 'budget')::int),
    'squad', balance_num('dungeon', 'squad')::int, 'cost', cfg->'cost', 'gate', adventure_gate(p_player), 'cap', balance_num('dungeon_rewards', 'run_shards_cap')::int,
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', v_rank) end,
    -- The rooms of the member's floor: a room ahead is "?" (only the guardian shows).
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(d->'floors'->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(d->'floors'),
    'runs_today', (select count(*) from dungeon_runs where day = v_day and mode = 'daily'),
    'top', (select coalesce(jsonb_agg(e order by o), '[]'::jsonb) from jsonb_array_elements(v_board) with ordinality t(e, o) where o <= 3),
    'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player and mode = 'daily'
                    order by floor desc, room desc, turns limit 1)) || v_mine;
end $function$
;
`;

const body = String.raw`do $t$
declare
  res jsonb := '[]'; pid text; top text; n int := 0; withrun int := 0; withpts int := 0;
  bad_cp int := 0; bad_dv int := 0; raw_dv int := 0; bad_gv int := 0; bad_av int := 0; k int; c0 bigint; c1 bigint; sq int;
begin
  ${REF}

  -- 'mine': same cp = no defined order in the old text; compare it sorted by (cp desc, id).
  create function norm_view(j jsonb) returns jsonb language sql immutable as $f$
    select case when j ? 'mine' then (j - 'mine') || jsonb_build_object('mine', (select coalesce(jsonb_agg(e order by (e->>'cp')::int desc, (e->>'id')::bigint), '[]'::jsonb) from jsonb_array_elements(j->'mine') e)) else j end $f$;

  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet', 'achievement_tracks');
  for pid in select id from players order by id loop
    n := n + 1;
    if card_powers(pid) is distinct from ref_card_powers(pid) then bad_cp := bad_cp + 1; end if;
    -- runs_per_day.sql (F-1 PR 3) added runs_left and last_run to the views (every other key must be the same)
    if norm_view(dungeon_view(pid) - 'runs_left' - 'last_run') is distinct from norm_view(ref_dungeon_view_core(pid, true)) then bad_dv := bad_dv + 1; end if;
    if (dungeon_view(pid) - 'runs_left' - 'last_run') is distinct from ref_dungeon_view_core(pid, true) then raw_dv := raw_dv + 1; end if;
    if (dungeon_view_lite(pid) - 'runs_left' - 'last_run') is distinct from ref_dungeon_view_core(pid, false) then bad_dv := bad_dv + 1; end if;
    if (gauntlet_view(pid) - 'runs_left' - 'last_run') is distinct from ref_gauntlet_view(pid) then bad_gv := bad_gv + 1; end if;
    if ach_track_values(pid) is distinct from ref_ach_track_values(pid) then bad_av := bad_av + 1; end if;
    if exists (select 1 from dungeon_runs where player_id = pid and day = dungeon_day()) then withrun := withrun + 1; end if;
    if exists (select 1 from player_cards where player_id = pid and quantity > 0 and stat_points is not null and stat_points <> '{}'::jsonb) then withpts := withpts + 1; end if;
  end loop;
  res := res || jsonb_build_object('case', 'card_powers = the old text for ' || n || ' players (' || withpts || ' with stat points)', 'ok', bad_cp = 0 and n > 0 and withpts > 0, 'bad', bad_cp);
  res := res || jsonb_build_object('case', 'card_powers(null) = the old text', 'ok', card_powers(null) = ref_card_powers(null) and card_powers(null) <> '{}'::jsonb);
  res := res || jsonb_build_object('case', 'dungeon_view and dungeon_view_lite = the old text for ' || n || ' players (' || withrun || ' with a run today; '
    || raw_dv || ' differ only in the order of same-cp cards)', 'ok', bad_dv = 0 and n > 0, 'bad', bad_dv);
  res := res || jsonb_build_object('case', 'gauntlet_view = the old text for ' || n || ' players', 'ok', bad_gv = 0 and n > 0, 'bad', bad_gv);
  res := res || jsonb_build_object('case', 'ach_track_values (achievement_view) = the old text for ' || n || ' players', 'ok', bad_av = 0 and n > 0, 'bad', bad_av);

  -- 2. The mechanism, on the member with the most cards.
  select player_id into top from player_cards where quantity > 0 group by player_id order by count(*) desc, player_id limit 1;
  select count(*) into k from (select distinct c.rarity, pc.ascension, s.cp_mod, pc.stat_points from player_cards pc join cards c on c.id = pc.card_id
     left join subjects s on s.id = c.subject_id where pc.player_id = top and pc.quantity > 0) x;
  -- A counting wrapper: the real function renamed, a wrapper with the old name adds 1 to a sequence and calls it (all undone at the end).
  create sequence perf_test_calls; create sequence perf_test_base;
  alter function card_combat(text, integer, numeric, jsonb, jsonb) rename to card_combat_counted;
  create function card_combat(p_rarity text, p_asc integer, p_mod numeric, p_pts jsonb, p_b jsonb) returns jsonb language plpgsql stable
    set search_path to 'public' as $f$ begin perform nextval('perf_test_calls'); return card_combat_counted(p_rarity, p_asc, p_mod, p_pts, p_b); end $f$;
  alter function dungeon_card_base(bigint) rename to dungeon_card_base_counted;
  create function dungeon_card_base(p_card bigint) returns jsonb language plpgsql stable
    set search_path to 'public' as $f$ begin perform nextval('perf_test_base'); return dungeon_card_base_counted(p_card); end $f$;
  c0 := nextval('perf_test_calls');
  perform card_powers(top);
  c1 := nextval('perf_test_calls');
  res := res || jsonb_build_object('case', 'card_powers: card_combat once per different input (' || k || ' for '
    || (select count(*) from player_cards where player_id = top and quantity > 0) || ' cards)', 'ok', c1 - c0 - 1 = k and k > 0, 'calls', c1 - c0 - 1, 'inputs', k);
  c0 := c1;
  perform dungeon_view(top);
  c1 := nextval('perf_test_calls');
  res := res || jsonb_build_object('case', 'dungeon_view mine: card_combat once per different input', 'ok', c1 - c0 - 1 = k, 'calls', c1 - c0 - 1, 'inputs', k);
  c0 := nextval('perf_test_base');
  perform gauntlet_view(top);
  c1 := nextval('perf_test_base');
  select coalesce(cardinality(squad), 0) into sq from gauntlet_weeks where week = gauntlet_week(dungeon_day());
  res := res || jsonb_build_object('case', 'gauntlet_view: dungeon_card_base once per squad card (' || sq || ')', 'ok', c1 - c0 - 1 = sq and sq > 0, 'calls', c1 - c0 - 1);

  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\n.*$/, ''));
let fail = 0;
for (const r of results) {
  const { case: name, ok, ...rest } = r;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 700)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
