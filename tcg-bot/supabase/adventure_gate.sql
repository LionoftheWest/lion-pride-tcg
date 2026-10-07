-- The unlock gate for the Hunt and the Dungeon (docs/activities/03-dungeon-run.md 3A; Nathan 2026-10-03:
-- "what I don't want is a new player drawing some cards, go into the hunt / dungeon run and not have
-- redeemed all their cards or try to do it with a small squad").
-- Open when BOTH are true: no starter gift (new_player, launch_day) is still open, and the member owns
-- at least settings.adventure_gate.attackers (8) attackers (Character / Creature).
-- The server enforces it: lock_hunt_squad refuses 'locked'; a member with no locked squad cannot fight
-- (hunt_squad_allows); dungeon_start refuses 'locked' (dungeon.sql). Test: card-studio/scripts/test-dungeon.mjs.
-- Idempotent. Apply BEFORE dungeon.sql.

-- GUARD: this file replaces live functions. It runs only on the exact live version it was built from
-- (or on its own result, so it can run again). Another change to the live function stops it here, so
-- that change is never reverted: rebuild this file from the live text first (.live/rebuild.mjs).
do $g$ begin
  -- balance_table.sql (2026-10-03): the functions below read public.balance, so it must exist first.
  if to_regclass('public.balance') is null then
    raise exception '%: apply balance_table.sql first (these functions read the balance table)', 'adventure_gate.sql';
  end if;
  if md5(replace(pg_get_functiondef('public.lock_hunt_squad'::regproc), chr(13), '')) not in ('4a80c769286b2b6022ab79b4cb01f7c6', '22bf3511259d728791ee370775beb5f2') then
    raise exception 'adventure_gate.sql: the live lock_hunt_squad changed since this file was built. Rebuild from the live text.';
  end if;
end $g$;
-- GUARD-END

insert into public.settings (key, value) values ('adventure_gate', jsonb_build_object('attackers', 8))
on conflict (key) do nothing;

create or replace function public.adventure_gate(p_player text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'ok', g.open = 0 and a.n >= g.need,
    'gifts_open', g.open, 'gifts_total', g.total,
    'attackers', a.n, 'need', g.need)
  from (select count(*) filter (where claimed_at is null)::int open, count(*)::int total,
               coalesce((select (value->>'attackers')::int from settings where key = 'adventure_gate'), 8) need
          from gift_claims where player_id = p_player and kind in ('new_player', 'launch_day')) g,
       (select count(*)::int n from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
          where pc.player_id = p_player and pc.quantity > 0 and s.type in ('Character', 'Creature')) a;
$$;

-- The Hunt squad lock: the live definition of 2026-10-03 (with the at-least-1-attacker rule of
-- squad_needs_attacker) + the gate first. Rebuilt from the live text, so nothing else changes.
CREATE OR REPLACE FUNCTION public.lock_hunt_squad(p_player text, p_hunt bigint, p_cards bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_day date := (now() at time zone 'America/Denver')::date; v_cap int; v_n int; v_used bigint[]; v_gate jsonb;
begin
  if not exists (select 1 from hunts where id = p_hunt and status = 'active') then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  -- The unlock gate (adventure_gate): the starter gifts redeemed + 8 attackers.
  v_gate := adventure_gate(p_player);
  if not (v_gate->>'ok')::boolean then return jsonb_build_object('ok', false, 'error', 'locked', 'gate', v_gate); end if;
  v_cap := hunt_card_cap();
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

-- With no locked squad, a card may fight only if the member passes the gate (was: always true).
-- A locked squad already passed the gate at lock time.
create or replace function public.hunt_squad_allows(p_hunt bigint, p_player text, p_day date, p_card bigint)
 returns boolean language sql stable set search_path to 'public' as $function$
  select coalesce((select p_card = any(card_ids) from hunt_squads
                    where hunt_id = p_hunt and player_id = p_player and hit_date = p_day),
                  (adventure_gate(p_player)->>'ok')::boolean);
$function$;

notify pgrst, 'reload schema';
