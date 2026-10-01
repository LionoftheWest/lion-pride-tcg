-- Fixed hunt prizes (Nathan, 2026-10-01). The same prizes when the boss falls and when it
-- escapes, and only for members who fought (any hunt_hits row, an attack or a support):
--   1st 7 packs, 2nd 5, 3rd 4, 4th-10th 3 (by total damage), every other hunter 1.
-- A leaderboard prize replaces the 1 pack (it does not add to it). A member with 0 damage
-- (supports only) gets the 1 pack but no leaderboard place. Ties: the first to hit ranks first.
-- The dial: settings.hunt_prizes = {"base": 1, "ranks": [7, 5, 4, 3, 3, 3, 3, 3, 3, 3]}.
-- Also the boss HP for the launch week: Normal 30k, Heroic + Mythic 40k (was 15k/20k/20k).

insert into settings (key, value) values ('hunt_prizes', '{"base": 1, "ranks": [7, 5, 4, 3, 3, 3, 3, 3, 3, 3]}')
  on conflict (key) do update set value = excluded.value;
update settings set value = jsonb_build_object('Normal', 30000, 'Heroic', 40000, 'Mythic', 40000, 'crew', 10)
  where key = 'hunt_hp';

create or replace function settle_hunt(p_hunt bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_status text; v_settled timestamptz; v_cfg jsonb; v_base int; v_ranks jsonb;
  v_participants int := 0; r record; v_packs int; v_paidtotal int := 0; v_paid jsonb := '[]'::jsonb;
begin
  select status, settled_at into v_status, v_settled from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_settled is not null then return jsonb_build_object('ok', false, 'error', 'already_settled'); end if;
  if v_status not in ('defeated', 'expired') then return jsonb_build_object('ok', false, 'error', 'not_ended'); end if;

  select value into v_cfg from settings where key = 'hunt_prizes';
  v_cfg := coalesce(v_cfg, '{"base": 1, "ranks": [7, 5, 4, 3, 3, 3, 3, 3, 3, 3]}'::jsonb);
  v_base := greatest(0, coalesce((v_cfg->>'base')::int, 1));
  v_ranks := coalesce(v_cfg->'ranks', '[]'::jsonb);

  for r in
    select t.player_id, t.dmg,
           case when t.dmg > 0 then row_number() over (order by t.dmg desc, t.first_hit) end as place
      from (select player_id, sum(damage) as dmg, min(id) as first_hit
              from hunt_hits where hunt_id = p_hunt group by player_id) t
     order by t.dmg desc, t.first_hit
  loop
    v_participants := v_participants + 1;
    v_packs := case when r.place is not null and r.place <= jsonb_array_length(v_ranks)
                    then (v_ranks->>(r.place::int - 1))::int else v_base end;
    if v_packs > 0 then perform grant_packs(r.player_id, v_packs, 'hunt_reward', null); end if;
    v_paidtotal := v_paidtotal + v_packs;
    v_paid := v_paid || jsonb_build_object('player_id', r.player_id, 'packs', v_packs, 'place', r.place);
  end loop;

  update hunts set settled_at = now() where id = p_hunt;
  return jsonb_build_object('ok', true, 'defeated', v_status = 'defeated', 'participants', v_participants,
    'total_packs', v_paidtotal, 'paid', v_paid);
end $$;
