-- The "is playing" post (design 20, option B, Nathan 2026-09-30; tcg-bot/src/playing-posts.ts).
-- playing_posts: the one post per member per UTC day, edited in place.
-- playing_today(): what the picture shows - the member's best NEW card today (by rarity,
-- then the newest), packs opened today, boss damage today, and their "Show when I play"
-- setting (notify_prefs.playing; missing = on).

create table if not exists public.playing_posts (
  player_id  text not null references public.players(id) on delete cascade,
  day        date not null,
  message_id text not null,
  updated_at timestamptz not null default now(),
  primary key (player_id, day)
);
alter table public.playing_posts enable row level security;

create or replace function public.playing_today(p_player text) returns jsonb
language sql stable set search_path = public as $$
  with d as (select (now() at time zone 'utc')::date as day,
                    ((now() at time zone 'utc')::date)::timestamp at time zone 'utc' as t0)
  select jsonb_build_object(
    'name', (select username from players where id = p_player),
    'avatar', (select avatar from players where id = p_player),
    'playing_pref', coalesce((select notify_prefs->>'playing' from players where id = p_player), 'true'),
    'packs', (select count(*) from pack_ledger, d where player_id = p_player and reason = 'opened' and created_at >= d.t0),
    'damage', (select coalesce(sum(damage), 0) from hunt_hits, d where player_id = p_player and hit_date = d.day),
    'best', (select jsonb_build_object('id', c.id, 'name', c.name, 'rarity', c.rarity, 'image_url', c.image_url)
               from player_cards pc join cards c on c.id = pc.card_id, d
              where pc.player_id = p_player and pc.first_obtained_at >= d.t0
              order by case c.rarity::text when 'gold' then 4 when 'full_art' then 3 when 'secret_rare' then 2
                                           when 'illustrated_rare' then 1 else 0 end desc, pc.first_obtained_at desc
              limit 1));
$$;
revoke all on function public.playing_today(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
