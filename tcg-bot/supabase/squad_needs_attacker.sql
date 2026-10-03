-- A raid squad needs at least 1 attacker (Nathan, 2026-10-03): "You have no attackers, you will
-- not be able to do any damage, please have at least 1 attacker in your squad". Supports (Moment,
-- Item, Place, no type) deal no damage, so a support-only squad fought and got no raid prize.
-- lock_hunt_squad below is the LIVE body (pg_get_functiondef, 2026-10-03) plus the 'no_attacker'
-- check. The Activity checks the same rule before Lock In (src/squad-pick.js hasAttacker).
-- Test (rolled back): node scripts/test-squad-needs-attacker.mjs [--old]

CREATE OR REPLACE FUNCTION public.lock_hunt_squad(p_player text, p_hunt bigint, p_cards bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_day date := (now() at time zone 'America/Denver')::date; v_cap int; v_n int; v_used bigint[];
begin
  if not exists (select 1 from hunts where id = p_hunt and status = 'active') then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  select coalesce((select (value #>> '{}')::int from settings where key = 'hunt_daily_card_cap'), 8) into v_cap;
  select count(distinct x) into v_n from unnest(coalesce(p_cards, '{}')) x;
  if v_n < 1 or v_n > v_cap or v_n <> cardinality(p_cards) then return jsonb_build_object('ok', false, 'error', 'bad_squad'); end if;
  if exists (select 1 from unnest(p_cards) x where not exists (select 1 from player_cards where player_id = p_player and card_id = x and quantity > 0)) then
    return jsonb_build_object('ok', false, 'error', 'not_owned');
  end if;
  -- At least 1 attacker (Nathan, 2026-10-03): a squad of supports deals no damage, so the member
  -- would fight and get no raid prize. Attackers are the types hunt_attack accepts.
  if not exists (select 1 from unnest(p_cards) x join cards c on c.id = x join subjects s on s.id = c.subject_id
                 where s.type in ('Character', 'Creature')) then
    return jsonb_build_object('ok', false, 'error', 'no_attacker');
  end if;
  select coalesce(array_agg(card_id), '{}') into v_used from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  if exists (select 1 from hunt_squads where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) and cardinality(v_used) > 0 then
    return jsonb_build_object('ok', false, 'error', 'squad_fixed', 'squad', (select card_ids from hunt_squads where hunt_id = p_hunt and player_id = p_player and hit_date = v_day));
  end if;
  if not (v_used <@ p_cards) then return jsonb_build_object('ok', false, 'error', 'must_keep_used', 'used', to_jsonb(v_used)); end if;
  insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (p_hunt, p_player, v_day, p_cards)
    on conflict (hunt_id, player_id, hit_date) do update set card_ids = excluded.card_ids, locked_at = now();
  return jsonb_build_object('ok', true, 'squad', to_jsonb(p_cards));
end $function$;

notify pgrst, 'reload schema';
