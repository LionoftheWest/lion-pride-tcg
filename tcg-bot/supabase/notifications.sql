-- In-app notifications: shown inside the Activity (a bell + panel), never a DM or
-- channel message. Each row is one alert for one player. Idempotent.

create table if not exists notifications (
  id         bigint generated always as identity primary key,
  player_id  text not null references players (id) on delete cascade,
  kind       text not null,                 -- pack_earned | pack_gift | card_gift | trade_offer | trade_accepted | admin
  message    text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_player_idx on notifications (player_id, read, created_at desc);
alter table notifications enable row level security;

-- Add one notification for a player.
create or replace function notify_player(p_player text, p_kind text, p_message text)
returns void language sql security invoker set search_path = public as $$
  insert into notifications (player_id, kind, message) values (p_player, p_kind, p_message);
$$;

-- Add the same notification to EVERY player (server-wide event drop).
create or replace function notify_all(p_kind text, p_message text)
returns int language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  insert into notifications (player_id, kind, message)
    select id, p_kind, p_message from players;
  get diagnostics n = row_count;
  return n;
end; $$;

notify pgrst, 'reload schema';
