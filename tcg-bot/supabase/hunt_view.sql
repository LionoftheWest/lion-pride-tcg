-- The Hunt screen in ONE call (pressure test, 2026-09-28): /api/hunt made 4 REST calls per
-- player (the roster, today's card HP, the damage total, the round), so 100 players who
-- opened the Hunt in the same second waited ~6 s. The server falls back to the 4 calls if
-- this function is missing.
create or replace function public.hunt_view(p_player text, p_hunt bigint, p_day date)
returns jsonb
language sql
stable
set search_path = public
as $$
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
    'damage', coalesce((select sum(damage) from hunt_hits where hunt_id = p_hunt and player_id = p_player), 0),
    'round', (select round from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = p_day));
$$;

revoke all on function public.hunt_view(text, bigint, date) from public, anon, authenticated;

notify pgrst, 'reload schema';
