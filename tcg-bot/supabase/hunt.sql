-- Phase 2: The Pride Hunt — a weekly, randomized, co-op raid boss the whole server
-- chips at. Players "send" cards; damage = the card's CP, x2 if the card matches a
-- weak point. Each card can be sent once per UTC day per hunt. Additive + inert
-- until the API (flag FEATURE_HUNT) calls it.

create table if not exists hunts (
  id           bigserial primary key,
  name         text not null,
  tier         text not null,                    -- Normal | Heroic | Mythic
  weak_points  jsonb not null,                   -- [{"kind":"type"|"rarity"|"season","value":"..."}]
  hp_max       bigint not null,
  hp_remaining bigint not null,
  opens_at     timestamptz not null default now(),
  closes_at    timestamptz not null,
  status       text not null default 'active',   -- active | defeated | expired
  defeated_at  timestamptz,
  created_at   timestamptz not null default now()
);
alter table hunts enable row level security;  -- service-role only; deny anon (no policies)

create table if not exists hunt_hits (
  id         bigserial primary key,
  hunt_id    bigint not null references hunts(id) on delete cascade,
  player_id  text not null,
  card_id    bigint not null,
  hit_date   date not null,
  damage     int not null,
  created_at timestamptz not null default now(),
  unique (hunt_id, player_id, card_id, hit_date)  -- one send per card per day per hunt
);
alter table hunt_hits enable row level security;
create index if not exists hunt_hits_hunt_player on hunt_hits (hunt_id, player_id);

-- Spawn a fresh randomized hunt: random tier, random type weak points, HP scaled to
-- the player count. Expires any still-active hunt first. All knobs are here (tunable).
create or replace function spawn_hunt(p_days int default 3)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_players int; v_tier text; v_nweak int; v_tiermult numeric;
  v_weak jsonb; v_hp bigint; v_name text; v_id bigint;
  c_types text[] := array['Character','Creature','Item','Place','Moment'];
  c_names text[] := array['The Salt Kraken','The Lag Beast','The Tilt Titan','Server Gremlin',
                          'The Whiff Wyrm','Rage-Quit Revenant','The Ping Phantom','Meta Hydra',
                          'The Desync Dragon','Frame-Drop Fiend'];
begin
  update hunts set status = 'expired' where status = 'active';
  select greatest(1, count(*)) into v_players from players;
  v_tier := (array['Normal','Heroic','Mythic'])[1 + floor(random() * 3)];
  v_tiermult := case v_tier when 'Normal' then 1.0 when 'Heroic' then 2.0 else 3.5 end;
  v_nweak := case v_tier when 'Normal' then 1 when 'Heroic' then 2 else 3 end;
  select jsonb_agg(jsonb_build_object('kind', 'type', 'value', t)) into v_weak
    from (select unnest(c_types) t order by random() limit v_nweak) x;
  v_hp := greatest(2000, round(v_players * 1500 * v_tiermult));
  v_name := c_names[1 + floor(random() * array_length(c_names, 1))];
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, closes_at)
    values (v_name, v_tier, v_weak, v_hp, v_hp, now() + make_interval(days => p_days))
    returning id into v_id;
  return v_id;
end $$;

-- Attack the hunt with one owned card. Row-locks the hunt so concurrent hits never
-- drive HP negative or double-count. Enforces once-per-card-per-day. Damage = CP,
-- x2 if the card matches any weak point. Marks the hunt defeated at 0 HP.
create or replace function hunt_attack(p_player text, p_hunt bigint, p_card bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_status text; v_closes timestamptz; v_weak jsonb;
  v_qty int; v_asc int; v_rarity text; v_season text; v_type text; v_mod numeric;
  v_cp int; v_dmg int; v_bonus boolean; v_day date; v_hp bigint;
begin
  select status, closes_at, weak_points into v_status, v_closes, v_weak
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then
    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;

  select pc.quantity, pc.ascension, c.rarity::text, c.season, s.type, s.cp_mod
    into v_qty, v_asc, v_rarity, v_season, v_type, v_mod
  from player_cards pc
  join cards c    on c.id = pc.card_id
  join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;

  v_day := (now() at time zone 'utc')::date;
  if exists (select 1 from hunt_hits where hunt_id = p_hunt and player_id = p_player
               and card_id = p_card and hit_date = v_day) then
    return jsonb_build_object('ok', false, 'error', 'resting'); -- already sent today
  end if;

  v_cp := card_power(v_rarity, v_asc, v_mod);
  v_bonus := exists (
    select 1 from jsonb_array_elements(v_weak) w
    where (w->>'kind' = 'type'   and w->>'value' = v_type)
       or (w->>'kind' = 'rarity' and w->>'value' = v_rarity)
       or (w->>'kind' = 'season' and w->>'value' = v_season));
  v_dmg := case when v_bonus then v_cp * 2 else v_cp end;

  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
    values (p_hunt, p_player, p_card, v_day, v_dmg);
  update hunts
     set hp_remaining = greatest(0, hp_remaining - v_dmg),
         status      = case when hp_remaining - v_dmg <= 0 then 'defeated' else status end,
         defeated_at = case when hp_remaining - v_dmg <= 0 then now() else defeated_at end
   where id = p_hunt;

  select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;
  return jsonb_build_object('ok', true, 'damage', v_dmg, 'bonus', v_bonus, 'cp', v_cp,
    'hp_remaining', v_hp, 'status', v_status, 'defeated', v_status = 'defeated');
end $$;

-- Per-hunt contribution leaderboard.
create or replace function hunt_leaderboard(p_hunt bigint, p_limit int default 20)
returns table(player_id text, username text, damage bigint)
language sql stable set search_path = public as $$
  select h.player_id, p.username, sum(h.damage)::bigint
  from hunt_hits h join players p on p.id = h.player_id
  where h.hunt_id = p_hunt
  group by h.player_id, p.username
  order by 3 desc
  limit greatest(1, least(100, coalesce(p_limit, 20)));
$$;

notify pgrst, 'reload schema';
