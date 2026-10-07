-- The app logs (Nathan, 2026-10-07: "record all those spots as well, I want to be gathering as much data as possible").
-- Each log answers one question that the ledgers cannot:
--   app_sessions     a member who opens the Activity and only looks (no pack, no fight, no trade)
--   tutorial_steps   when each walkthrough step was done (players.tutorial keeps only the list)
--   page_views       views against purchases (the Shop, the Trading Hall, auctions, the Dungeon ...)
--   notifications.read_at       when the member read the bell notes
--   player_reports.target_id    the member a report is about (optional)
--   players.guild_joined_at, players.left_guild_at   the Discord server join and leave
-- Writers: the Activity server (tcg-activity/logs.js, flag FEATURE_APP_LOGS) and the bot (tcg-bot/src/guild-log.ts,
-- flag FEATURE_GUILD_LOG). Each write is one small insert or update with no read-back, throttled in the server.
-- notifications.read_at and player_reports.target_id may also come from the SQL log PR: "if not exists", same type.
-- Closed to the API roles (RLS on, no policy, no grant); the service role reads and writes. Safe to re-run.
-- Test: card-studio/scripts/test-logs-app.mjs.

-- ============================================================ the columns
alter table public.notifications add column if not exists read_at timestamptz;
alter table public.player_reports add column if not exists target_id text references public.players(id);
alter table public.players add column if not exists guild_joined_at timestamptz;
alter table public.players add column if not exists left_guild_at timestamptz;

-- ============================================================ app_sessions
create table if not exists public.app_sessions (
  id           bigint generated always as identity primary key,
  player_id    text not null references public.players(id) on delete cascade,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at     timestamptz,
  client       jsonb not null default '{}'
);
create index if not exists app_sessions_player on public.app_sessions (player_id, last_seen_at desc);
create index if not exists app_sessions_started on public.app_sessions (started_at);
alter table public.app_sessions enable row level security;
revoke all on public.app_sessions from anon, authenticated;

-- One call per member at most every 5 minutes (the server throttles it). A session continues while the last call
-- is less than 30 minutes old; else the open sessions of the member end at their last_seen_at and a new row starts.
-- p_client is merged into the row (the platform, the user agent, the window size when the client sends it).
-- Returns the session id, or null for an unknown member (no players row is made here).
create or replace function public.app_session_touch(p_player text, p_client jsonb default null)
returns bigint
language plpgsql
set search_path = public
as $function$
declare
  v_id bigint;
  v_seen timestamptz;
  v_client jsonb := case when jsonb_typeof(p_client) = 'object' then p_client else '{}'::jsonb end;
begin
  if p_player is null then return null; end if;
  -- One member at a time, so two calls at once cannot both start a session.
  perform pg_advisory_xact_lock(hashtext('app_sessions:' || p_player));
  select id, last_seen_at into v_id, v_seen from app_sessions
   where player_id = p_player and ended_at is null
   order by last_seen_at desc limit 1;
  if v_id is not null and v_seen > now() - interval '30 minutes' then
    update app_sessions set last_seen_at = now(), client = client || v_client where id = v_id;
    return v_id;
  end if;
  update app_sessions set ended_at = last_seen_at where player_id = p_player and ended_at is null;
  if not exists (select 1 from players where id = p_player) then return null; end if;
  insert into app_sessions (player_id, client) values (p_player, v_client) returning id into v_id;
  return v_id;
end $function$;
revoke all on function public.app_session_touch(text, jsonb) from public, anon, authenticated;

-- ============================================================ tutorial_steps
create table if not exists public.tutorial_steps (
  player_id text not null references public.players(id) on delete cascade,
  step      text not null check (char_length(step) between 1 and 40),
  done_at   timestamptz not null default now(),
  primary key (player_id, step)
);
create index if not exists tutorial_steps_done on public.tutorial_steps (done_at);
alter table public.tutorial_steps enable row level security;
revoke all on public.tutorial_steps from anon, authenticated;

-- ============================================================ page_views
create table if not exists public.page_views (
  id        bigint generated always as identity primary key,
  player_id text not null references public.players(id) on delete cascade,
  view      text not null check (view ~ '^[a-z_]{1,30}$'),
  ref       text check (char_length(ref) <= 40),
  at        timestamptz not null default now()
);
create index if not exists page_views_player on public.page_views (player_id, at);
create index if not exists page_views_view on public.page_views (view, at);
alter table public.page_views enable row level security;
revoke all on public.page_views from anon, authenticated;

-- ============================================================ the Discord server join and leave (the bot)
-- p_rows = [{"id": "<member id>", "at": "<joinedAt>"}, ...]: the join time from Discord (the newest join).
-- Only existing players rows change (no row is made). A time older than the stored one is ignored.
-- Returns the number of rows changed.
create or replace function public.guild_joined(p_rows jsonb)
returns integer
language plpgsql
set search_path = public
as $function$
declare n int;
begin
  if jsonb_typeof(p_rows) <> 'array' then return 0; end if;
  with r as (
    select distinct on (x->>'id') x->>'id' as id, (x->>'at')::timestamptz as at
      from jsonb_array_elements(p_rows) x
     where x->>'id' is not null and x->>'at' is not null
     order by x->>'id', (x->>'at')::timestamptz desc
  )
  update players p set guild_joined_at = r.at
    from r
   where p.id = r.id and (p.guild_joined_at is null or p.guild_joined_at < r.at);
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.guild_joined(jsonb) from public, anon, authenticated;

-- A member left the Discord server (GuildMemberRemove). Only an existing players row changes.
-- In the server now = left_guild_at is null or left_guild_at < guild_joined_at (a join after the leave).
create or replace function public.guild_left(p_player text, p_at timestamptz default now())
returns boolean
language plpgsql
set search_path = public
as $function$
begin
  update players set left_guild_at = coalesce(p_at, now()) where id = p_player;
  return found;
end $function$;
revoke all on function public.guild_left(text, timestamptz) from public, anon, authenticated;

-- ============================================================ the notes (also in db_comments.sql)
comment on column public.notifications.read_at is $c$Time the member read the note: the bell sets it with read = true (POST /api/notifications/read, the Activity, flag FEATURE_APP_LOGS). Null = not read, or read before this column existed.$c$;
comment on column public.player_reports.target_id is $c$The member that the report is about (players.id), or null. The report form sends it (optional); the Activity checks that the member exists. The GitHub Issue never shows it.$c$;
comment on column public.players.guild_joined_at is $c$Time the member last joined the Discord server (Discord joinedAt). The bot sets it on GuildMemberAdd and fills empty rows at start and once a day (guild_joined). Null = not known yet.$c$;
comment on column public.players.left_guild_at is $c$Time the member last left the Discord server (GuildMemberRemove, the bot: guild_left). In the server now = null or older than guild_joined_at.$c$;
comment on table public.app_sessions is $c$[logs] One row per Activity visit of a member (a gap of 30 minutes starts a new visit). The Activity server writes it through app_session_touch at most every 5 minutes for each member (any API call; flag FEATURE_APP_LOGS). Answers "who opens the Activity and only looks". Service role only.$c$;
comment on column public.app_sessions.id is $c$Row id.$c$;
comment on column public.app_sessions.player_id is $c$The member (players.id).$c$;
comment on column public.app_sessions.started_at is $c$Time of the first API call of the visit.$c$;
comment on column public.app_sessions.last_seen_at is $c$Time of the last recorded call (5-minute steps: the server calls app_session_touch at most every 5 minutes; the client polls nothing while the window is hidden).$c$;
comment on column public.app_sessions.ended_at is $c$Set to last_seen_at when the next visit of the member starts. Null = open, or ended with no later visit: last_seen_at older than 30 minutes means it ended then.$c$;
comment on column public.app_sessions.client is $c$What the server knows of the client: platform (desktop, mobile or web, from the user agent; sdk_platform when the client sends the Discord SDK value), ua (the user agent, cut to 200 characters), w and h (the window size when the client sends it).$c$;
comment on function public.app_session_touch(text, jsonb) is $c$[logs] Records an Activity visit: continues the open app_sessions row of the member when its last_seen_at is less than 30 minutes old, else ends the open rows (ended_at = last_seen_at) and starts a new row. p_client is merged into client. Returns the session id, or null for an unknown member. Called by the Activity server (logs.js) at most every 5 minutes per member. Service role only.$c$;
comment on table public.tutorial_steps is $c$[logs] One row per walkthrough step a member did, with the time (the first time only: a replay does not move it). The Activity server writes it on POST /api/tutorial (flag FEATURE_APP_LOGS): the steps of players.tutorial done, seen:<set> for a view explainer, skipped, replay and finished. Service role only.$c$;
comment on column public.tutorial_steps.player_id is $c$The member (players.id).$c$;
comment on column public.tutorial_steps.step is $c$The step: a tutorial step name (gifts, open, rarity, collection, hunt, community, dailies, voice), seen:<explainer set>, skipped, replay or finished.$c$;
comment on column public.tutorial_steps.done_at is $c$Time the member first did the step.$c$;
comment on table public.page_views is $c$[logs] Which screens a member opens: one row per member, view and ref per 10 minutes at most (the Activity server throttles it; flag FEATURE_APP_LOGS). Written when the screen data route answers (shop, hall, auctions, auction, dungeon, gauntlet, leaderboard, member_profile) and by POST /api/view for the screens that have no own route. Compare with shop_purchases, trade_listings, auctions and dungeon_runs for conversion. Service role only.$c$;
comment on column public.page_views.id is $c$Row id.$c$;
comment on column public.page_views.player_id is $c$The member who opened the screen (players.id).$c$;
comment on column public.page_views.view is $c$The screen: shop, hall, auctions, auction, dungeon, gauntlet, leaderboard, member_profile, or a screen name that the client sends to POST /api/view (allow-listed in tcg-activity/logs.js).$c$;
comment on column public.page_views.ref is $c$What on the screen, or null: the auction id (auction), the list (auctions: open or mine), the member id (member_profile).$c$;
comment on column public.page_views.at is $c$Time of the view.$c$;
comment on function public.guild_joined(jsonb) is $c$[logs] Sets players.guild_joined_at from a list [{id, at}] (Discord joinedAt): only existing rows, only a newer time. The bot calls it on GuildMemberAdd and for the rows with no time at start and once a day (guild-log.ts, flag FEATURE_GUILD_LOG). Returns the rows changed. Service role only.$c$;
comment on function public.guild_left(text, timestamp with time zone) is $c$[logs] Sets players.left_guild_at for one member (only an existing row). The bot calls it on GuildMemberRemove (guild-log.ts; needs the Server Members intent). Returns true when a row changed. Service role only.$c$;

notify pgrst, 'reload schema';
