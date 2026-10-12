-- hunt_calendar.sql (2026-10-11): F-1 PR 2, the Hunt as a calendar event, and repeats (docs/foundations.md F-1 items 3 and 4).
-- Before: one Hunt each week, fixed in code: the cron jobs hunt-spawn-mt (Thu 15:00 MT), hunt-nudge-mt (Mon 11:00 MT) and
-- hunt-close-mt-mdt / -mst (Mon 17:00 MT) called weekly_boss_tick, which acted only in the hour of hunt_mt_slot and refused a
-- second spawn inside 6 hours (the 6-hour guard). close_weekly_boss closed the newest boss due within 1 hour.
-- Now:
--   1. Kind hunt      an events row of kind hunt IS a Hunt: audience everyone, rewards {} (settle_hunt pays balance
--                     hunt_prizes, once: hunts.settled_at), rules {} or {"tier": "Normal" | "Heroic" | "Mythic"}. event_pay
--                     refuses it (not_paid_here). Two Hunt events cannot overlap (one boss at a time: spawn_hunt closes the
--                     active boss), so event_row_errors refuses an overlap with a scheduled or live Hunt event. Several Hunt
--                     events in one week are normal rows, with no special code.
--   2. The tick       event_step -> event_hunt_step for a live Hunt event: no boss linked yet -> spawn_weekly_boss(ends_at,
--                     event id, tier) (the same spawn as before: roster_snapshot, spawn_hunt, the hunt_events spawn post), linked
--                     by hunts.event_id (unique). The nudge post (nudge_hunt) 6 hours before ends_at, once (the old Monday 11:00
--                     MT for a Monday 17:00 close), only when the window is longer than 6 hours.
--   3. The end        the trigger events_hunt_sync: a change of events.ends_at moves hunts.closes_at (also a live edit and End
--                     now); the event ended or cancelled closes the boss with close_hunt (status expired, settle_hunt pays once,
--                     the expired post). A defeated boss is already settled: close_hunt does nothing.
--   4. Repeats        event_repeats: a library template (event_templates) + a weekly rule (ISO weekday, local time, IANA time
--                     zone) + the weeks ahead (4). event_repeats_fill (pg_cron event-repeats, every hour) makes the missing
--                     rows of the next weeks as SCHEDULED events (key <key_prefix>_<YYYYMMDD local>, repeat_id, template_id). The
--                     start and the end are computed on the LOCAL clock (start + template default_length), so a window across a
--                     change of daylight saving time keeps its local times (Thu 15:00 MDT -> Mon 17:00 MST). A row is a copy: a
--                     change to one week (or its cancel) leaves the template and the other weeks the same, and is never made again
--                     (the key exists).
--   5. The seed       the template "Weekly Hunt" (kind hunt, 4 days 2 hours) and the repeat weekly_hunt (Thursday 15:00
--                     America/Denver): the same window as hunt_mt_slot, so players see no change. An active boss from the old
--                     job is adopted as a live Hunt event (key hunt_<id>), so its Monday nudge and close still happen.
--   6. Removed        the cron jobs hunt-spawn-mt, hunt-nudge-mt, hunt-close-mt-mdt, hunt-close-mt-mst; weekly_boss_tick (with
--                     the 6-hour guard) and close_weekly_boss (it closed a boss due within 1 hour, so a moved end could close
--                     early). Kept: close_due_hunts (hunt-close-due, every 10 minutes: a boss with no event), daily_raid_board
--                     (raid-board-mt, 06:00 MT, the newest active boss), hunt_mt_slot ('board') and next_hunt_close.
--   7. next_hunt_spawn the start of the next scheduled Hunt event (the Activity countdown), null when none.
-- Not here: the admin functions and screens for repeats (F-1 PR 5). Test: card-studio/scripts/test-hunt-calendar.mjs (rolled
-- back; MUTATE=<name> must FAIL). Idempotent.

-- GUARD (the combat_core.sql rule): each replaced function must be the live text this file was built from (or the text this
-- file made). A function that this file drops and makes again with new arguments is checked only while it still exists.
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.event_shape_errors(text, jsonb, jsonb, jsonb)', '2b16151d87e19b012938ed178b8fb45e', '0fcac6e1d67c8d296f52f0d0b66ebd03'),
    ('public.event_template_errors(public.event_templates)', 'dac2d89a577a40f73d386467ac3a4798', '259503c6e58887ded9c4e3dc77f5af8e'),
    ('public.event_row_errors(public.events)', 'd7251a662c596597ce997d71247d8995', '0d8c61a6e2f5f5ae23e354e1bc319c6d'),
    ('public.event_pay(bigint, text, timestamp with time zone)', 'c8748d3dea281bfc22e3fdaa9faf7f61', '5f138be08c32d605a87dc286ada90626'),
    ('public.event_step(bigint, timestamp with time zone)', 'd7a32742b445e7d6d3657ff7ce4014e9', 'a5e63fb3c1ec29bda3db162378a603f4'),
    ('public.next_hunt_spawn()', '81e24792178a5658a5878988f91bbca4', '7a10d2e69c142ef5a0ecb9b12d5253eb'),
    ('public.spawn_weekly_boss()', 'fb69b21fa8f72cc4af7a8db12b17bfc6', 'fb69b21fa8f72cc4af7a8db12b17bfc6'),
    ('public.nudge_hunt()', 'a6e6a457ce0f190c50568165818ac806', 'a6e6a457ce0f190c50568165818ac806')
  ) x(fn, old_md5, new_md5) loop
    continue when to_regprocedure(f.fn) is null;
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'hunt_calendar.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the kind hunt
-- The 4-argument shape check (the CHECK events_shape): the kind hunt (audience everyone, rewards {}, rules {} or a tier).
CREATE OR REPLACE FUNCTION public.event_shape_errors(p_kind text, p_audience jsonb, p_rewards jsonb, p_rules jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare e text[] := '{}'; k text; v jsonb; i int := 0; prev int := 0; n int;
  iso constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$';
  allowed_rules text[];
begin
  if p_kind is null or p_kind not in ('drop', 'trigger', 'rank', 'modifier', 'hunt', 'launch_cards') then
    return array['kind must be drop, trigger, rank, modifier, hunt or launch_cards'];
  end if;

  -- audience
  if p_audience is null or jsonb_typeof(p_audience) <> 'object' then e := e || 'audience must be an object'::text;
  elsif p_audience = '{}'::jsonb then e := e || 'audience: choose everyone or at least one filter'::text;
  elsif p_kind = 'modifier' and p_audience <> '{"all": true}'::jsonb then e := e || 'audience: a modifier event changes the game for everyone (audience must be {"all": true})'::text;
  elsif p_kind = 'hunt' and p_audience <> '{"all": true}'::jsonb then e := e || 'audience: a Hunt is for everyone (audience must be {"all": true})'::text;
  else
    for k in select jsonb_object_keys(p_audience) loop
      if k not in ('all', 'active_since', 'joined_after', 'joined_before', 'tutorial_done', 'members') then e := e || format('audience: unknown key %s', k); end if;
    end loop;
    if p_audience ? 'all' and (p_audience->'all' <> 'true'::jsonb or (select count(*) from jsonb_object_keys(p_audience)) > 1) then
      e := e || 'audience: all must be true and alone'::text;
    end if;
    if p_audience ? 'tutorial_done' and p_audience->'tutorial_done' <> 'true'::jsonb then e := e || 'audience: tutorial_done must be true'::text; end if;
    foreach k in array array['active_since', 'joined_after', 'joined_before'] loop
      continue when not p_audience ? k;
      if jsonb_typeof(p_audience->k) <> 'string' or (p_audience->>k) !~ iso then e := e || format('audience: %s must be an ISO time with a zone', k); continue; end if;
      begin perform (p_audience->>k)::timestamptz; exception when others then e := e || format('audience: %s is not a valid time', k); end;
    end loop;
    if p_audience ? 'members' then
      v := p_audience->'members';
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 1000 then e := e || 'audience: members must be a list of 1 to 1000 ids'::text;
      elsif exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[A-Za-z0-9_]{1,40}$') then
        e := e || 'audience: a member id is not valid'::text;
      elsif (select count(distinct x) from jsonb_array_elements_text(v) x) <> jsonb_array_length(v) then e := e || 'audience: a member is listed twice'::text;
      end if;
    end if;
  end if;

  -- rewards
  if p_rewards is null or jsonb_typeof(p_rewards) <> 'object' then e := e || 'rewards must be an object'::text;
  elsif p_kind = 'launch_cards' then
    if p_rewards <> '{}'::jsonb then e := e || 'rewards: a launch_cards event keeps its rewards in settings (rewards must be {})'::text; end if;
  elsif p_kind = 'modifier' then
    if p_rewards <> '{}'::jsonb then e := e || 'rewards: a modifier event gives no rewards (rewards must be {})'::text; end if;
  elsif p_kind = 'hunt' then
    if p_rewards <> '{}'::jsonb then e := e || 'rewards: a Hunt pays the Hunt prizes (balance hunt_prizes), so rewards must be {}'::text; end if;
  else
    for k in select jsonb_object_keys(p_rewards) loop
      if k not in ('title', 'per_member', 'ranks') then e := e || format('rewards: unknown key %s', k); end if;
    end loop;
    if p_rewards ? 'title' and (jsonb_typeof(p_rewards->'title') <> 'string' or length(trim(p_rewards->>'title')) not between 1 and 80) then
      e := e || 'rewards: title must be 1 to 80 characters'::text;
    end if;
    if p_kind in ('drop', 'trigger') then
      if p_rewards ? 'ranks' then e := e || format('rewards: a %s event has per_member, not ranks', p_kind); end if;
      if not p_rewards ? 'per_member' then e := e || 'rewards: per_member is required'::text;
      else e := e || event_reward_errors(p_rewards->'per_member', 'rewards.per_member', false); end if;
    else -- rank
      if p_rewards ? 'per_member' then e := e || 'rewards: a rank event has ranks, not per_member'::text; end if;
      v := p_rewards->'ranks';
      if v is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) not between 1 and 20 then e := e || 'rewards: ranks must be a list of 1 to 20 tiers'::text;
      else
        n := cardinality(e);
        for i in 0 .. jsonb_array_length(v) - 1 loop
          e := e || event_reward_errors(v->i, format('rewards.ranks[%s]', i + 1), true);
        end loop;
        if cardinality(e) = n then
          for i in 0 .. jsonb_array_length(v) - 1 loop
            if (v->i->>'from')::int > (v->i->>'to')::int then e := e || format('rewards.ranks[%s]: from is after to', i + 1);
            elsif (v->i->>'from')::int <= prev then e := e || format('rewards.ranks[%s]: the tiers must go up and not overlap', i + 1);
            end if;
            prev := (v->i->>'to')::int;
          end loop;
        end if;
      end if;
    end if;
  end if;

  -- rules
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then return e || 'rules must be an object'::text; end if;
  allowed_rules := case p_kind when 'drop' then array['late_joiners'] when 'trigger' then array['trigger'] when 'rank' then array['metric']
                               when 'modifier' then array[]::text[] when 'hunt' then array['tier'] else array['settings_key', 'gift_reasons'] end;
  for k in select jsonb_object_keys(p_rules) loop
    if not k = any(allowed_rules) then e := e || format('rules: unknown key %s for a %s event', k, p_kind); end if;
  end loop;
  if p_kind = 'drop' and p_rules ? 'late_joiners' and jsonb_typeof(p_rules->'late_joiners') <> 'boolean' then e := e || 'rules: late_joiners must be true or false'::text; end if;
  if p_kind = 'trigger' and coalesce(p_rules->>'trigger', '') not in ('hunt_hit', 'tutorial_done', 'pack_opened', 'dungeon_run') then
    e := e || 'rules: trigger must be hunt_hit, tutorial_done, pack_opened or dungeon_run'::text;
  end if;
  if p_kind = 'rank' and coalesce(p_rules->>'metric', '') not in ('hunt_damage', 'packs_opened') then
    e := e || 'rules: metric must be hunt_damage or packs_opened'::text;
  end if;
  if p_kind = 'hunt' and p_rules ? 'tier' and (jsonb_typeof(p_rules->'tier') <> 'string' or p_rules->>'tier' not in ('Normal', 'Heroic', 'Mythic')) then
    e := e || 'rules: tier must be Normal, Heroic or Mythic (no tier = a random tier)'::text;
  end if;
  if p_kind = 'launch_cards' and (jsonb_typeof(p_rules->'settings_key') is distinct from 'string' or jsonb_typeof(p_rules->'gift_reasons') is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_rules->'gift_reasons') x where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^event:[a-z0-9_]+$')) then
    e := e || 'rules: a launch_cards event needs settings_key and gift_reasons (event:<name>)'::text;
  end if;
  return e;
end $function$;

alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in ('drop', 'trigger', 'rank', 'modifier', 'hunt', 'launch_cards'));
alter table public.event_templates drop constraint if exists event_templates_kind_check;
alter table public.event_templates add constraint event_templates_kind_check check (kind in ('drop', 'trigger', 'rank', 'modifier', 'hunt'));

-- The template errors: the kind hunt.
CREATE OR REPLACE FUNCTION public.event_template_errors(p_t event_templates)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare e text[] := '{}'; v_cards bigint[];
begin
  if p_t.name is null or length(trim(p_t.name)) not between 1 and 80 then e := e || 'name: 1 to 80 characters'::text;
  elsif exists (select 1 from event_templates x where x.name = trim(p_t.name) and x.id is distinct from p_t.id) then e := e || 'name: another template has this name'::text; end if;
  if length(coalesce(p_t.description, '')) > 1000 then e := e || 'description: at most 1000 characters'::text; end if;
  if p_t.default_length is null or p_t.default_length <= interval '0' or p_t.default_length > interval '62 days' then
    e := e || 'default_length: more than 0 and at most 62 days'::text;
  end if;
  if p_t.kind is null or p_t.kind not in ('drop', 'trigger', 'rank', 'modifier', 'hunt') then e := e || 'kind must be drop, trigger, rank, modifier or hunt'::text;
  else e := e || event_shape_errors(p_t.kind, p_t.audience, p_t.rewards, p_t.rules, coalesce(p_t.vars, '{}'), coalesce(p_t.theme, '{}')); end if;
  if cardinality(e) = 0 then
    v_cards := array(select (p_t.rewards->'per_member'->>'card_id')::bigint where p_t.rewards->'per_member'->>'card_id' is not null
                     union select (t->>'card_id')::bigint from jsonb_array_elements(coalesce(p_t.rewards->'ranks', '[]')) t where t->>'card_id' is not null);
    if exists (select 1 from unnest(v_cards) c where not exists (select 1 from cards x where x.id = c)) then e := e || 'rewards: a card id does not exist'::text; end if;
  end if;
  return e;
end $function$;

-- event_row_errors: a Hunt event must not overlap a scheduled or live Hunt event (one boss at a time).
CREATE OR REPLACE FUNCTION public.event_row_errors(p_e events)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare e text[] := '{}'; v_cards bigint[];
begin
  if p_e.key is null or p_e.key !~ '^[a-z0-9][a-z0-9_]{2,47}$' then e := e || 'key: 3 to 48 characters a-z, 0-9 and _'::text;
  elsif exists (select 1 from events x where x.key = p_e.key and x.id is distinct from p_e.id) then e := e || 'key: another event has this key'::text; end if;
  if p_e.title is null or length(trim(p_e.title)) not between 1 and 80 then e := e || 'title: 1 to 80 characters'::text; end if;
  if length(coalesce(p_e.description, '')) > 1000 then e := e || 'description: at most 1000 characters'::text; end if;
  if p_e.starts_at is null or p_e.ends_at is null then e := e || 'the start and the end are required'::text;
  elsif p_e.ends_at <= p_e.starts_at then e := e || 'the end must be after the start'::text; end if;
  e := e || event_shape_errors(p_e.kind, p_e.audience, p_e.rewards, p_e.rules, coalesce(p_e.vars, '{}'), coalesce(p_e.theme, '{}'));
  if cardinality(e) = 0 and p_e.kind = 'hunt' and exists (select 1 from events x where x.kind = 'hunt' and x.id is distinct from p_e.id
       and x.status in ('scheduled', 'live') and x.starts_at < p_e.ends_at and x.ends_at > p_e.starts_at) then
    e := e || 'the Hunt overlaps another Hunt event (one boss at a time)'::text;
  end if;
  if cardinality(e) = 0 and p_e.kind <> 'launch_cards' then
    v_cards := array(select (p_e.rewards->'per_member'->>'card_id')::bigint where p_e.rewards->'per_member'->>'card_id' is not null
                     union select (t->>'card_id')::bigint from jsonb_array_elements(coalesce(p_e.rewards->'ranks', '[]')) t where t->>'card_id' is not null);
    if exists (select 1 from unnest(v_cards) c where not exists (select 1 from cards x where x.id = c)) then e := e || 'rewards: a card id does not exist'::text; end if;
  end if;
  return e;
end $function$;

-- event_pay: a Hunt is never paid here (settle_hunt pays the Hunt prizes).
CREATE OR REPLACE FUNCTION public.event_pay(p_id bigint, p_period text, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare e events; v_title text; v_by text := current_setting('balance.by', true); v_period text := p_period;
  v_members int := 0; v_packs int := 0; v_shards int := 0; v_cards int := 0; v_out jsonb;
begin
  if p_period is null or p_period not in ('start', 'end', 'tick') then raise exception 'event_pay: the period is start, end or tick'; end if;
  select * into e from events where id = p_id;
  if not found then return jsonb_build_object('paid', false, 'error', 'not_found'); end if;
  if e.kind in ('launch_cards', 'modifier', 'hunt') then return jsonb_build_object('paid', false, 'error', 'not_paid_here'); end if;
  if p_period in ('start', 'end') then
    insert into event_payouts (event_id, period) values (p_id, p_period) on conflict do nothing;
    if not found then return jsonb_build_object('paid', false, 'error', 'already_paid', 'period', p_period); end if;
  end if;
  v_title := left(coalesce(nullif(trim(e.rewards->>'title'), ''), e.title), 80);
  perform set_config('balance.by', 'event:' || e.key, true); -- the actor of the admin_actions row (gift_admin_log)
  with r as (select x.* from event_recipients(e, p_now) x),
  a as (insert into gift_claims (player_id, kind, title, amount, shards, reason, event_id)
          select r.member_id, 'promo', v_title, r.packs, r.shards, 'event', e.id from r where r.packs > 0 or r.shards > 0
          on conflict do nothing returning player_id, amount, shards),
  b as (insert into gift_claims (player_id, kind, title, amount, reason, card_id, event_id)
          select r.member_id, 'card', left(c.name, 80), 1, 'event', r.card_id, e.id from r join cards c on c.id = r.card_id
          on conflict do nothing returning player_id)
  select (select count(*) from (select a.player_id from a union select b.player_id from b) m),
         (select coalesce(sum(a.amount), 0) from a), (select coalesce(sum(a.shards), 0) from a), (select count(*) from b)
    into v_members, v_packs, v_shards, v_cards;
  perform set_config('balance.by', coalesce(v_by, ''), true);
  if p_period = 'tick' then
    if v_members = 0 then return jsonb_build_object('paid', false, 'period', 'tick', 'members', 0); end if;
    v_period := 'tick:' || to_char(p_now at time zone 'Etc/UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'); -- a label in UTC, not a game day
    insert into event_payouts (event_id, period, members, packs, shards, cards) values (p_id, v_period, v_members, v_packs, v_shards, v_cards)
      on conflict (event_id, period) do update set members = event_payouts.members + excluded.members, packs = event_payouts.packs + excluded.packs,
        shards = event_payouts.shards + excluded.shards, cards = event_payouts.cards + excluded.cards;
  else
    update event_payouts set members = v_members, packs = v_packs, shards = v_shards, cards = v_cards, paid_at = now()
     where event_id = p_id and period = p_period;
  end if;
  v_out := jsonb_build_object('period', v_period, 'members', v_members, 'packs', v_packs, 'shards', v_shards, 'cards', v_cards);
  insert into event_log (event_id, actor, action, new)
    values (p_id, coalesce(nullif(current_setting('events.actor', true), ''), balance_who()), 'pay', v_out);
  return v_out || jsonb_build_object('paid', true);
end $function$;

-- ============================================================ 2. the boss of an event
alter table public.hunts add column if not exists event_id bigint references public.events(id);
create unique index if not exists hunts_event_once on public.hunts (event_id) where event_id is not null;

-- The weekly spawn, now with the close time, the event and the tier of a Hunt event (no argument = the old weekly spawn:
-- closes at next_hunt_close, a random tier). The one spawn path: roster_snapshot, spawn_hunt, the hunt_events spawn post.
drop function if exists public.spawn_weekly_boss();
create or replace function public.spawn_weekly_boss(p_closes_at timestamptz default null, p_event_id bigint default null, p_tier text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_snap bigint; v_new bigint; v_close timestamptz;
        v_name text; v_tier text; v_hp bigint; v_weak jsonb;
begin
  v_snap  := roster_snapshot();
  v_new   := spawn_hunt(7, p_tier);
  v_close := coalesce(p_closes_at, next_hunt_close());
  update hunts set closes_at = v_close, event_id = p_event_id where id = v_new;
  select name, tier, hp_max, weak_points into v_name, v_tier, v_hp, v_weak from hunts where id = v_new;
  insert into hunt_events (hunt_id, kind, payload)
    values (v_new, 'spawn', jsonb_build_object('name', v_name, 'tier', v_tier,
      'hp', v_hp, 'closes_at', v_close, 'weak', v_weak));
  return jsonb_build_object('ok', true, 'new', v_new, 'snapshot', v_snap, 'closes_at', v_close, 'event_id', p_event_id);
end $$;

-- The nudge post of one boss (p_hunt), or of the newest active boss (no argument, as before).
drop function if exists public.nudge_hunt();
create or replace function public.nudge_hunt(p_hunt bigint default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_id bigint; v_name text; v_close timestamptz; v_hp bigint; v_max bigint;
begin
  select id, name, closes_at, hp_remaining, hp_max into v_id, v_name, v_close, v_hp, v_max
    from hunts where status = 'active' and (p_hunt is null or id = p_hunt) order by id desc limit 1;
  if v_id is null then return jsonb_build_object('ok', true, 'note', 'no_active'); end if;
  insert into hunt_events (hunt_id, kind, payload)
    values (v_id, 'nudge', jsonb_build_object('name', v_name, 'closes_at', v_close,
      'hp_remaining', v_hp, 'hp_max', v_max));
  return jsonb_build_object('ok', true, 'nudged', v_id);
end $$;

-- One tick of a live Hunt event: spawn its boss once (a boss linked by event_id, even defeated, is never made again), then
-- the nudge 6 hours before the end, once. The 6 hours: the old Monday 11:00 MT nudge of a Monday 17:00 MT close.
create or replace function public.event_hunt_step(p_e public.events, p_now timestamptz)
returns jsonb language plpgsql set search_path = public as $$
declare h hunts; c_nudge constant interval := interval '6 hours';
begin
  select * into h from hunts where event_id = p_e.id;
  if not found then
    return jsonb_build_object('spawn', spawn_weekly_boss(p_e.ends_at, p_e.id, p_e.rules->>'tier'));
  end if;
  if h.status = 'active' and p_now >= p_e.ends_at - c_nudge and p_e.ends_at - c_nudge > p_e.starts_at
     and not exists (select 1 from hunt_events x where x.hunt_id = h.id and x.kind = 'nudge') then
    return jsonb_build_object('nudge', nudge_hunt(h.id));
  end if;
  return null;
end $$;

-- event_step: a live Hunt event runs event_hunt_step (the end and the cancel close the boss in the trigger events_hunt_sync).
CREATE OR REPLACE FUNCTION public.event_step(p_id bigint, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare e events; v_done jsonb := '[]'; v_late boolean; v_hunt jsonb;
begin
  select * into e from events where id = p_id for update;
  if not found then return jsonb_build_object('id', p_id, 'error', 'not_found'); end if;
  v_late := e.kind = 'drop' and coalesce((e.rules->>'late_joiners')::boolean, false);
  if e.status = 'scheduled' and e.starts_at <= p_now then
    update events set status = 'live' where id = p_id;
    e.status := 'live';
    v_done := v_done || jsonb_build_object('live', true);
    if e.kind = 'drop' then v_done := v_done || jsonb_build_object('start', event_pay(p_id, 'start', least(p_now, e.ends_at))); end if;
  end if;
  if e.status = 'live' then
    if e.ends_at <= p_now then
      if e.kind in ('trigger', 'rank') or v_late then v_done := v_done || jsonb_build_object('end', event_pay(p_id, 'end', e.ends_at)); end if;
      update events set status = 'ended', ended_at = p_now where id = p_id;
      v_done := v_done || jsonb_build_object('ended', true);
    elsif e.kind = 'trigger' or v_late then
      v_done := v_done || jsonb_build_object('tick', event_pay(p_id, 'tick', p_now));
    elsif e.kind = 'hunt' then
      v_hunt := event_hunt_step(e, p_now);
      if v_hunt is not null then v_done := v_done || v_hunt; end if;
    end if;
  end if;
  return jsonb_build_object('id', p_id, 'key', e.key, 'steps', v_done);
end $function$;

-- The boss follows its event: a new end moves closes_at; ended or cancelled closes the boss (close_hunt: settle_hunt pays once).
create or replace function public.events_hunt_sync() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.ends_at is distinct from old.ends_at then
    update hunts set closes_at = new.ends_at where event_id = new.id and status = 'active';
  end if;
  if new.status in ('ended', 'cancelled') and old.status not in ('ended', 'cancelled') then
    perform close_hunt(h.id) from hunts h where h.event_id = new.id and h.status = 'active';
  end if;
  return null;
end $$;
drop trigger if exists events_hunt_sync on public.events;
create trigger events_hunt_sync after update of ends_at, status on public.events for each row when (new.kind = 'hunt') execute function public.events_hunt_sync();

-- The Activity countdown: the start of the next scheduled Hunt event (null when none is scheduled).
CREATE OR REPLACE FUNCTION public.next_hunt_spawn()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select min(starts_at) from events where kind = 'hunt' and status = 'scheduled'; $function$;

-- ============================================================ 3. repeats
create table if not exists public.event_repeats (
  id          bigint generated always as identity primary key,
  template_id bigint not null references public.event_templates(id),
  key_prefix  text not null unique check (key_prefix ~ '^[a-z0-9][a-z0-9_]{2,38}$'),
  title       text check (title is null or length(trim(title)) between 1 and 80),
  weekday     smallint not null check (weekday between 1 and 7),
  at_time     time not null,
  tz          text not null default 'America/Denver',
  weeks_ahead smallint not null default 4 check (weeks_ahead between 1 and 12),
  active      boolean not null default true,
  created_by  text not null check (length(trim(created_by)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.event_repeats enable row level security;
revoke all on public.event_repeats from anon, authenticated;

-- The time zone must be a known IANA name (timezone() raises otherwise); sets updated_at.
create or replace function public.event_repeats_check() returns trigger
language plpgsql set search_path = public as $$
begin
  perform timezone(new.tz, now());
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists event_repeats_check on public.event_repeats;
create trigger event_repeats_check before insert or update on public.event_repeats for each row execute function public.event_repeats_check();

alter table public.events drop constraint if exists events_repeat_id_fkey;
alter table public.events add constraint events_repeat_id_fkey foreign key (repeat_id) references public.event_repeats(id);

-- Make the missing rows of every active repeat: each weekly slot that starts after p_now and inside weeks_ahead weeks, as a
-- SCHEDULED copy of the template. The start and the end are on the local clock of the repeat (a window across a change of
-- daylight saving time keeps its local times). A slot whose key exists (made before, edited or cancelled) is never made again.
-- A Hunt slot that overlaps a scheduled or live Hunt event is skipped (one boss at a time).
create or replace function public.event_repeats_fill(p_now timestamptz default now())
returns jsonb language plpgsql set search_path = public as $$
declare r event_repeats; t event_templates; d0 date; d date; k int; s timestamptz; en timestamptz; v_key text;
  v_rows jsonb := '[]'; v_actor text := current_setting('events.actor', true);
begin
  if not pg_try_advisory_xact_lock(hashtext('public.event_repeats_fill')) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  perform set_config('events.actor', 'event_repeats', true);
  for r in select * from event_repeats where active order by id loop
    select * into strict t from event_templates where id = r.template_id;
    d0 := (p_now at time zone r.tz)::date;
    d0 := d0 + ((r.weekday - extract(isodow from d0)::int) % 7 + 7) % 7;
    for k in 0 .. r.weeks_ahead loop
      d := d0 + 7 * k;
      s := (d + r.at_time) at time zone r.tz;
      continue when s <= p_now;
      exit when s > p_now + make_interval(days => 7 * r.weeks_ahead);
      v_key := r.key_prefix || '_' || to_char(d, 'YYYYMMDD');
      continue when exists (select 1 from events x where x.key = v_key);
      en := ((d + r.at_time) + t.default_length) at time zone r.tz;
      if t.kind = 'hunt' and exists (select 1 from events x where x.kind = 'hunt' and x.status in ('scheduled', 'live') and x.starts_at < en and x.ends_at > s) then
        v_rows := v_rows || jsonb_build_object('key', v_key, 'skipped', 'overlap');
        continue;
      end if;
      insert into events (key, kind, title, description, status, starts_at, ends_at, audience, rewards, rules, vars, theme, template_id, repeat_id, created_by)
        values (v_key, t.kind, coalesce(r.title, t.name), t.description, 'scheduled', s, en, t.audience, t.rewards, t.rules, t.vars, t.theme, t.id, r.id,
                'repeat:' || r.key_prefix);
      v_rows := v_rows || jsonb_build_object('key', v_key, 'starts_at', s, 'ends_at', en);
    end loop;
  end loop;
  perform set_config('events.actor', coalesce(v_actor, ''), true);
  return jsonb_build_object('ok', true, 'at', p_now, 'rows', v_rows);
end $$;

-- ============================================================ 4. the lockdown (lockdown_grants.sql pattern)
revoke all on function public.spawn_weekly_boss(timestamptz, bigint, text), public.nudge_hunt(bigint), public.event_hunt_step(public.events, timestamptz),
  public.events_hunt_sync(), public.event_repeats_check(), public.event_repeats_fill(timestamptz)
  from public, anon, authenticated;
grant execute on function public.spawn_weekly_boss(timestamptz, bigint, text), public.nudge_hunt(bigint), public.event_hunt_step(public.events, timestamptz),
  public.events_hunt_sync(), public.event_repeats_check(), public.event_repeats_fill(timestamptz)
  to service_role;

-- ============================================================ 5. the seed: the weekly Hunt as the first repeat
insert into public.event_templates (name, kind, description, audience, rewards, rules, vars, theme, default_length, created_by)
  values ('Weekly Hunt', 'hunt', 'The weekly raid boss: Thursday 3 PM to Monday 5 PM Mountain Time (before: hunt_mt_slot and the hunt-*-mt cron jobs).',
          '{"all": true}', '{}', '{}', '{}', '{}', interval '4 days 2 hours', 'hunt_calendar.sql')
  on conflict (name) do nothing;
insert into public.event_repeats (template_id, key_prefix, title, weekday, at_time, tz, weeks_ahead, created_by)
  select id, 'weekly_hunt', 'Weekly Hunt', 4, time '15:00', 'America/Denver', 4, 'hunt_calendar.sql' from public.event_templates where name = 'Weekly Hunt'
  on conflict (key_prefix) do nothing;

-- The boss that the old job spawned (if one is active) becomes a live Hunt event, so its nudge and its close still happen.
do $a$
declare h hunts; v_id bigint;
begin
  select * into h from hunts where status = 'active' and event_id is null and closes_at > now() order by id desc limit 1;
  if found then
    perform set_config('events.actor', 'hunt_calendar.sql', true);
    insert into events (key, kind, title, status, starts_at, ends_at, audience, rewards, rules, template_id, repeat_id, created_by)
      select 'hunt_' || h.id, 'hunt', 'Weekly Hunt', 'live', least(h.opens_at, now()), h.closes_at, '{"all": true}', '{}', '{}', t.id, r.id, 'hunt_calendar.sql'
        from event_templates t join event_repeats r on r.template_id = t.id where t.name = 'Weekly Hunt' and r.key_prefix = 'weekly_hunt'
      on conflict (key) do nothing
      returning id into v_id;
    if v_id is not null then update hunts set event_id = v_id where id = h.id; end if;
    perform set_config('events.actor', '', true);
  end if;
  perform event_repeats_fill();
end $a$;

-- ============================================================ 6. the pg_cron jobs: the fixed Hunt jobs go, event-repeats comes
do $c$ begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(j.jobname) from cron.job j where j.jobname in ('hunt-spawn-mt', 'hunt-nudge-mt', 'hunt-close-mt-mdt', 'hunt-close-mt-mst');
    perform cron.unschedule('event-repeats') where exists (select 1 from cron.job where jobname = 'event-repeats');
    perform cron.schedule('event-repeats', '17 * * * *', 'select public.event_repeats_fill();');
  end if;
end $c$;
drop function if exists public.weekly_boss_tick(text);
drop function if exists public.close_weekly_boss();

-- ============================================================ comments
comment on table public.event_repeats is $c$[events] The repeats of the event calendar (hunt_calendar.sql, F-1 item 4): a library template (event_templates) and a weekly rule (ISO weekday, local time, IANA time zone), weeks_ahead weeks ahead. event_repeats_fill (pg_cron event-repeats, every hour) makes the missing rows as scheduled events (key <key_prefix>_<YYYYMMDD>, events.repeat_id). The first repeat is weekly_hunt (Thursday 15:00 America/Denver). Server only.$c$;
comment on column public.event_repeats.id is $c$The repeat id. events.repeat_id points at it.$c$;
comment on column public.event_repeats.template_id is $c$The library template that each row copies (event_templates.id): kind, description, audience, rewards, rules, vars, theme, and default_length (the end = the local start + it).$c$;
comment on column public.event_repeats.key_prefix is $c$The start of the event keys (3 to 39 characters a-z, 0-9, _; unique): each row is <key_prefix>_<YYYYMMDD of the local start day>. A key that exists is never made again.$c$;
comment on column public.event_repeats.title is $c$The title of the rows (1 to 80 characters), else the template name.$c$;
comment on column public.event_repeats.weekday is $c$The ISO weekday of the start (1 Monday .. 7 Sunday) on the local clock of tz.$c$;
comment on column public.event_repeats.at_time is $c$The local start time on that weekday (the clock of tz, so it does not move at a change of daylight saving time).$c$;
comment on column public.event_repeats.tz is $c$The IANA time zone of the rule, for example America/Denver (event_repeats_check refuses an unknown name).$c$;
comment on column public.event_repeats.weeks_ahead is $c$How many weeks of rows exist ahead (1 to 12, normally 4).$c$;
comment on column public.event_repeats.active is $c$False: event_repeats_fill makes no more rows (the rows made stay).$c$;
comment on column public.event_repeats.created_by is $c$Who made the repeat (the studio actor or the migration).$c$;
comment on column public.event_repeats.created_at is $c$When the repeat was made.$c$;
comment on column public.event_repeats.updated_at is $c$The time of the last change (event_repeats_check).$c$;
comment on column public.events.repeat_id is $c$The repeat that made the row (event_repeats.id), else null. The row is a copy: a change to it does not change the repeat, the template or the other weeks.$c$;
comment on column public.hunts.event_id is $c$The Hunt event of the boss (events.id, kind hunt), else null (a boss from the Admin view or from before hunt_calendar.sql). Unique: an event spawns one boss. events_hunt_sync keeps closes_at = the event end and closes the boss when the event ends.$c$;
comment on column public.hunts.closes_at is $c$When the Hunt ends: the end of its Hunt event (events_hunt_sync moves it when the end changes). After it, attacks are refused and the boss closes (the event end, or close_due_hunts for a boss with no event).$c$;
comment on table public.events is $c$[events] One row per event (events.sql, event_vars.sql, hunt_calendar.sql): key, kind (drop, trigger, rank, modifier, hunt, launch_cards), title, description, status (draft, scheduled, live, ended, cancelled), the window starts_at .. ends_at, audience, rewards and rules (jsonb; the shapes are in events.sql and checked by event_shape_errors), vars (game variables, event_vars) and theme, template_id, repeat_id. The Admin view writes it (admin_event_save, admin_event_schedule, admin_event_cancel, admin_event_end_now, admin_event_from_template) and event_repeats_fill makes the repeated rows; event_tick moves the status by time, pays, and runs the Hunt boss. Every change writes event_log. Server only.$c$;
comment on column public.events.kind is $c$drop (paid at the start to the audience), trigger (paid once to each audience member who does rules.trigger in the window), rank (paid once at the end by rank of rules.metric), modifier (vars only: changes game variables while live, audience everyone, never paid), hunt (a Hunt boss: spawned at the start, closed at the end, rules.tier optional, audience everyone; settle_hunt pays the Hunt prizes), launch_cards (the migrated launch event: its own functions pay it, never the tick).$c$;
comment on function public.event_shape_errors(text, jsonb, jsonb, jsonb) is $c$[events] The errors of an event's kind, audience, rewards and rules (the shapes in events.sql; a modifier: audience everyone, rewards {}, rules {}; a hunt: audience everyone, rewards {}, rules {} or a tier). Empty = valid. The CHECK events_shape uses it; the Admin save uses the 6-argument form.$c$;
comment on function public.event_template_errors(public.event_templates) is $c$[events] The errors of a candidate template: name (1-80, unique), description, default_length (more than 0, at most 62 days), kind (drop, trigger, rank, modifier, hunt), the 6 shapes, the reward cards exist. Empty = valid.$c$;
comment on function public.event_row_errors(public.events) is $c$[events] The errors of a candidate event row: key (format, unique), title, description, the times, the shapes with vars and theme (6-argument event_shape_errors), a Hunt that overlaps a scheduled or live Hunt event, and that each reward card exists. Empty = valid.$c$;
comment on function public.event_pay(bigint, text, timestamp with time zone) is $c$[events] Pays an event at a time through gift_claims (kind promo for packs and Shards, kind card, reason event, event_id set). start and end run once (event_payouts primary key); tick pays the members not paid yet. Writes event_payouts and event_log. Never pays launch_cards, modifier or hunt.$c$;
comment on function public.event_step(bigint, timestamp with time zone) is $c$[events] One step of one event: scheduled to live (a drop pays its start), live to ended at ends_at (trigger and rank pay the end), the catch-up of a live trigger event or a drop with late_joiners, and event_hunt_step for a live Hunt event. launch_cards: status only.$c$;
comment on function public.event_hunt_step(public.events, timestamp with time zone) is $c$[events] One tick of a live Hunt event: spawns its boss once (spawn_weekly_boss with the event end, id and rules.tier; hunts.event_id), then the nudge post (nudge_hunt) 6 hours before the end, once, when the window is longer than 6 hours. Returns the step or null.$c$;
comment on function public.events_hunt_sync() is $c$[events] Trigger (after update of ends_at or status on events, kind hunt): a new end moves hunts.closes_at of the active boss; ended or cancelled closes the boss with close_hunt (settle_hunt pays once).$c$;
comment on function public.event_repeats_check() is $c$[events] Trigger (before insert or update on event_repeats): refuses an unknown time zone; sets updated_at.$c$;
comment on function public.event_repeats_fill(timestamp with time zone) is $c$[events] The pg_cron job event-repeats (every hour): for each active repeat, makes the missing weekly rows that start after p_now and inside weeks_ahead weeks, as scheduled copies of the template (start and end on the local clock of the repeat). A key that exists is never made again; a Hunt slot that overlaps a Hunt event is skipped. One run at a time (advisory lock). Returns the rows.$c$;
comment on function public.spawn_weekly_boss(timestamp with time zone, bigint, text) is $c$[hunt] The Hunt spawn: roster_snapshot, spawn_hunt(7, p_tier), closes_at = p_closes_at (else next_hunt_close()), hunts.event_id = p_event_id, and a hunt_events spawn row. Called by event_hunt_step at the start of a Hunt event.$c$;
comment on function public.nudge_hunt(bigint) is $c$[hunt] Writes a hunt_events nudge row (name, closes_at, HP) for the boss p_hunt (else the newest active Hunt). Called by event_hunt_step 6 hours before the end of a Hunt event.$c$;
comment on function public.next_hunt_spawn() is $c$[hunt] The start of the next scheduled Hunt event (events kind hunt), null when none is scheduled. Called by the Activity /api/hunt for the countdown when no boss is active.$c$;
comment on function public.next_hunt_close() is $c$[hunt] The next Monday 5 PM Mountain Time. spawn_weekly_boss uses it as the close of a spawn with no event.$c$;

notify pgrst, 'reload schema';
