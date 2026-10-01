-- Player reports from the in-game report button (Nathan, 2026-10-01; design 23): Bug / Feedback /
-- Idea. The Activity syncs each report to a GitHub Issue in the PUBLIC game repo (labels
-- player-report + the kind). The Issue never names the member: the reporter stays in this
-- table, and no member can read it (RLS on, no policy; lockdown_grants.sql removes the grants).
create table if not exists public.player_reports (
  id           bigint generated always as identity primary key,
  player_id    text not null references public.players(id) on delete cascade,
  kind         text not null check (kind in ('bug', 'feedback', 'idea')),
  body         text not null check (char_length(body) between 5 and 1500),
  context      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  issue_number int,
  issue_url    text,
  synced_at    timestamptz,
  attempts     int not null default 0,
  last_error   text
);
alter table public.player_reports enable row level security;
create index if not exists player_reports_unsynced on public.player_reports (id) where synced_at is null;
create index if not exists player_reports_player_day on public.player_reports (player_id, created_at);

-- The daily limit per member (a game day starts at midnight MT). 0 turns reports off.
insert into public.settings (key, value) values ('reports', '{"per_day": 3}'::jsonb)
on conflict (key) do nothing;

-- Submit one report. Returns {ok, id} or {ok:false, error}. The caller is the verified member
-- (the Activity server passes the id from the Discord token, never from the request body).
create or replace function public.submit_report(p_player text, p_kind text, p_body text, p_context jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  lim int := coalesce((select (value->>'per_day')::int from settings where key = 'reports'), 3);
  body text := btrim(coalesce(p_body, ''));
  used int;
  new_id bigint;
begin
  if p_kind is null or p_kind not in ('bug', 'feedback', 'idea') then return jsonb_build_object('ok', false, 'error', 'kind'); end if;
  if char_length(body) < 5 then return jsonb_build_object('ok', false, 'error', 'short'); end if;
  if char_length(body) > 1500 then return jsonb_build_object('ok', false, 'error', 'long'); end if;
  if lim <= 0 then return jsonb_build_object('ok', false, 'error', 'off'); end if;
  if not exists (select 1 from players where id = p_player) then return jsonb_build_object('ok', false, 'error', 'player'); end if;
  -- One member at a time, so two fast taps cannot both pass the limit.
  perform pg_advisory_xact_lock(hashtext('player_reports:' || p_player));
  select count(*) into used from player_reports
   where player_id = p_player
     and (created_at at time zone 'America/Denver')::date = (now() at time zone 'America/Denver')::date;
  if used >= lim then return jsonb_build_object('ok', false, 'error', 'limit', 'limit', lim); end if;
  insert into player_reports (player_id, kind, body, context)
  values (p_player, p_kind, body, coalesce(p_context, '{}'::jsonb))
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'left', lim - used - 1);
end $function$;

notify pgrst, 'reload schema';
