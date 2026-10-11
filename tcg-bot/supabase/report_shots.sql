-- Private screenshots of a player report (Nathan, 2026-10-11; docs/player-reports.md).
-- A member adds up to balance report_shots.per_report images to an own report, after the report is sent (the report
-- never waits for an image). The Activity (tcg-activity/reports.js) checks the type by its first bytes, asks
-- reserve_report_shot for a place, and uploads the file to the PRIVATE storage bucket report-shots at <report id>/<n>.<ext>.
-- The images never go to GitHub: the Issue only counts them ("N screenshot(s), see the Admin page (private)").
-- The card studio Admin page (Player reports) shows them through signed links that end after a few minutes.
-- Cleanup: report_shots_expired lists the shots older than balance report_shots.keep_days; the Activity removes the files
-- through the storage API and then the rows. SQL cannot remove a storage file (a row delete in storage.objects leaves
-- the file in the store, and Supabase blocks it), so the cleanup is not in prune_old_rows.
-- No member can read the table (RLS on, no policy; lockdown_grants.sql removes the API grants).

-- 1. The private bucket. Only the service role writes or reads it (no storage policy for anon or authenticated).
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('report-shots', 'report-shots', false, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;

-- 2. One row per screenshot.
create table if not exists public.player_report_shots (
  id         bigint generated always as identity primary key,
  report_id  bigint not null references public.player_reports(id) on delete cascade,
  n          smallint not null check (n >= 1),
  path       text not null unique,
  mime       text not null check (mime in ('image/webp', 'image/png', 'image/jpeg')),
  bytes      int not null check (bytes > 0),
  created_at timestamptz not null default now(),
  stored_at  timestamptz,
  noted_at   timestamptz,
  unique (report_id, n)
);
alter table public.player_report_shots enable row level security;
create index if not exists player_report_shots_created on public.player_report_shots (created_at);
create index if not exists player_report_shots_unnoted on public.player_report_shots (report_id) where noted_at is null and stored_at is not null;

-- 3. The numbers (the database rule: no numbers in code).
create or replace function public.balance_check_report_shots()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $f$
declare k text; v jsonb;
begin
  if new.key = 'report_shots' then
    foreach k in array array['keep_days', 'per_report', 'max_bytes'] loop
      v := new.value->k;
      if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric < 1 or (v #>> '{}')::numeric % 1 <> 0 then
        raise exception 'balance report_shots: % must be a whole number of at least 1', k;
      end if;
    end loop;
    if (new.value->>'per_report')::int > 9 then raise exception 'balance report_shots: per_report must be 9 or less'; end if;
    if (new.value->>'max_bytes')::int > 5242880 then raise exception 'balance report_shots: max_bytes must be 5242880 (5 MB) or less (the Activity accepts at most 5 MB)'; end if;
  end if;
  return new;
end $f$;
drop trigger if exists balance_check_report_shots on public.balance;
create trigger balance_check_report_shots before insert or update on public.balance
  for each row execute function public.balance_check_report_shots();

insert into public.balance (key, value, note)
values ('report_shots', '{"keep_days": 90, "per_report": 3, "max_bytes": 1572864}'::jsonb,
  $n$The private screenshots of a player report (player_report_shots, bucket report-shots). keep_days = the days a screenshot is kept (report_shots_expired; the Activity removes the file and the row). per_report = the most screenshots on one report, 1 to 9 (reserve_report_shot). max_bytes = the largest image in bytes, at most 5 MB (reserve_report_shot; the Activity reads at most 5 MB).$n$)
on conflict (key) do nothing;

-- 4. A place for one screenshot. Returns {ok, id, n, path} or {ok:false, error}: type, big, report (not found, not the
-- member's own, or older than keep_days), full. The caller is the verified member (the Activity, never the request body).
create or replace function public.reserve_report_shot(p_player text, p_report bigint, p_mime text, p_bytes int)
returns jsonb
language plpgsql
set search_path to 'public'
as $f$
declare
  cfg jsonb := (select value from balance where key = 'report_shots');
  ext text := case p_mime when 'image/webp' then 'webp' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' end;
  used int;
  next_n int;
  new_id bigint;
  p text;
begin
  if cfg is null then raise exception 'reserve_report_shot: balance report_shots is missing'; end if;
  if ext is null then return jsonb_build_object('ok', false, 'error', 'type'); end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > (cfg->>'max_bytes')::int then
    return jsonb_build_object('ok', false, 'error', 'big', 'max_bytes', (cfg->>'max_bytes')::int);
  end if;
  if not exists (select 1 from player_reports r where r.id = p_report and r.player_id = p_player
                  and r.created_at > now() - make_interval(days => (cfg->>'keep_days')::int)) then
    return jsonb_build_object('ok', false, 'error', 'report');
  end if;
  -- One upload at a time per report, so two fast uploads cannot both pass the limit.
  perform pg_advisory_xact_lock(hashtext('player_report_shots:' || p_report));
  select count(*), coalesce(max(n), 0) + 1 into used, next_n from player_report_shots where report_id = p_report;
  if used >= (cfg->>'per_report')::int then
    return jsonb_build_object('ok', false, 'error', 'full', 'per_report', (cfg->>'per_report')::int);
  end if;
  p := p_report || '/' || next_n || '.' || ext;
  insert into player_report_shots (report_id, n, path, mime, bytes) values (p_report, next_n, p, p_mime, p_bytes)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'n', next_n, 'path', p);
end $f$;
revoke execute on function public.reserve_report_shot(text, bigint, text, int) from public, anon, authenticated;

-- 5. The screenshots to remove: older than keep_days, oldest first.
create or replace function public.report_shots_expired(p_limit int default 100)
returns table (id bigint, path text)
language sql
stable
set search_path to 'public'
as $f$
  select s.id, s.path from player_report_shots s
   where s.created_at < now() - make_interval(days => (select (value->>'keep_days')::int from balance where key = 'report_shots'))
   order by s.created_at, s.id
   limit greatest(1, least(coalesce(p_limit, 100), 1000));
$f$;
revoke execute on function public.report_shots_expired(int) from public, anon, authenticated;

-- 6. Comments (the same text is in db_comments.sql).
comment on table public.player_report_shots is $c$One row per private screenshot of a player report (reserve_report_shot, the Activity POST /api/feedback/:id/shot). The file is in the private storage bucket report-shots at path. It never goes to GitHub: the Issue counts the stored rows. The Activity removes the file and the row after balance report_shots.keep_days (report_shots_expired).$c$;
comment on column public.player_report_shots.report_id is $c$The report (player_reports.id). Only the member who sent the report can add a screenshot.$c$;
comment on column public.player_report_shots.n is $c$1, 2, 3 ...: the place on the report, at most balance report_shots.per_report.$c$;
comment on column public.player_report_shots.path is $c$The object path in the bucket report-shots: <report id>/<n>.<webp|png|jpg>.$c$;
comment on column public.player_report_shots.mime is $c$image/webp, image/png or image/jpeg (the Activity checks the first bytes of the file).$c$;
comment on column public.player_report_shots.bytes is $c$The file size, at most balance report_shots.max_bytes.$c$;
comment on column public.player_report_shots.created_at is $c$When the place was reserved. report_shots_expired counts the keep days from it.$c$;
comment on column public.player_report_shots.stored_at is $c$When the upload to storage finished. Null: the upload did not finish (the Admin page and the Issue count only stored rows).$c$;
comment on column public.player_report_shots.noted_at is $c$When the GitHub Issue counted this screenshot (in the Issue text, or in a comment for a screenshot that came after the Issue).$c$;
comment on function public.reserve_report_shot(text, bigint, text, int) is $c$A place for one screenshot on the member's own report: checks the type, the size (balance report_shots.max_bytes), the owner, the age (keep_days) and the count (per_report, one upload at a time per report). Returns {ok, id, n, path} or {ok:false, error: type|big|report|full}. Service role only.$c$;
comment on function public.balance_check_report_shots() is $c$Trigger (before insert, update on balance): the shape of the key report_shots (report_shots.sql): keep_days, per_report and max_bytes whole numbers of at least 1, per_report at most 9, max_bytes at most 5242880 (the Activity reads at most 5 MB of an upload).$c$;
comment on column public.player_reports.context is $c$Short strings from the client: screen, version, window, error, and the device facts app, device, os, engine, layout, dpr (tcg-activity/src/device-facts.js). The Activity (cleanContext) drops all other keys; the raw user agent is never stored.$c$;
comment on function public.report_shots_expired(int) is $c$The screenshots older than balance report_shots.keep_days (id, path), oldest first, at most p_limit (1 to 1000). The Activity removes each file through the storage API, then the rows. Service role only.$c$;

notify pgrst, 'reload schema';
