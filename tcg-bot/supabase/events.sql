-- events.sql: ONE Events system (Nathan 2026-10-07: "adjust events, make new events" from the Admin view).
--
-- Before this file the events were spread out: settings.launch_event_cards + the launch functions, /grantall drops
-- (give_gift_all reason event), once_ Shards drops, one-off reasons. A ledger row pointed at a gift row, never at an
-- event, and nothing scheduled an event. Now:
--   1. events         one row per event: kind, status, time window, audience, rewards, rules (shapes below, checked
--                     by event_shape_errors in a CHECK constraint). event_log records every change (who, old, new).
--                     event_payouts records each payout run (exactly once for start and end: the primary key).
--   2. gift_claims.event_id and cards.event_id point at the event. A gift of an event is the SAME gift as every
--                     other gift: it waits in the bell, the member presses Redeem (claim_gift), and the ledger rows
--                     point at the gift (ref gift, id). A unique index allows one gift per member, kind and card.
--   3. event_tick()   the pg_cron job event-tick (every 10 minutes): scheduled -> live -> ended by time, and the
--                     payouts through gift_claims. Kind launch_cards is never paid by the tick (see 5).
--   4. admin_event*   the Admin view functions (service role only): list, one event, save (draft / edit, optimistic
--                     updated_at check), schedule, cancel, end now, preview (no side effects). Each change writes
--                     admin_actions (admin_log_action) and event_log.
--   5. The launch event (launch_event_cards.sql) becomes ONE events row, kind launch_cards, with the same window
--                     (player_from .. player_until). Its guarded functions (launch_player_gift, launch_raider_gift,
--                     set_launch_player_card, give_card_gift, claim_tutorial_reward) are NOT changed: they keep
--                     reading settings.launch_event_cards, so the members see the same gifts. The tick only moves
--                     its status (live -> ended at player_until) and never pays it. A trigger links its new gifts
--                     (reasons in rules.gift_reasons) to the row, and its old gifts and its two cards get event_id.
--                     The Admin functions refuse to change it: settings.launch_event_cards stays its source.
--
-- The shapes (event_shape_errors returns the list of errors; empty = valid):
--   audience (an object; filters are AND; a member who left the server (players.left_guild_at) is never in it):
--     {"all": true}                                  every member (alone, no other key)
--     {"active_since": "<ISO time with zone>"}        a game action on a game day from that day (admin_active_days, game)
--     {"joined_after": "<ISO>", "joined_before": "<ISO>"}  players.created_at in [after, before)
--     {"tutorial_done": true}                        the tutorial reward claimed (pack_ledger reason tutorial)
--     {"members": ["<id>", ...]}                     these members only (1 to 1000 ids)
--   rewards (an object):
--     "title": "<bell text, 1-80>"                   optional; default the event title. A card gift shows the card name.
--     "per_member": {"packs": 0-100, "shards": 0-100000, "card_id": <id>|null}   kinds drop and trigger
--     "ranks": [{"from": 1, "to": 1, "packs": .., "shards": .., "card_id": ..}, ...] kind rank: 1-20 tiers, from <= to <= 1000,
--              ascending without overlap. Each item needs packs > 0, shards > 0 or a card.
--   rules (an object, by kind):
--     drop          {"late_joiners": true|false}     paid at the start to the audience; late_joiners: also each tick
--                                                    while live (a member who joins the audience later)
--     trigger       {"trigger": "hunt_hit" | "tutorial_done" | "pack_opened" | "dungeon_run"}  paid once to each
--                                                    audience member who does it inside the window (each tick)
--     rank          {"metric": "hunt_damage" | "packs_opened"}  paid once at the end by rank (rank(): ties share a rank)
--     launch_cards  {"settings_key": "launch_event_cards", "gift_reasons": ["event:launch_player", ...]}  never paid here
--
-- Gifts: packs and Shards = one gift_claims row (kind promo, reason event: the ledger reason pack:event and the Shards
-- reason event, the same as /grantall); a card = one row (kind card, reason event). gift_admin_log writes the
-- admin_actions row of each payout (reason event; the actor is event:<key>).
-- Test: card-studio/scripts/test-events.mjs. Idempotent. Not md5-guarded (all objects are new).

-- ============================================================ 1. the shape check (before the table: its CHECK uses it)
create or replace function public.event_reward_errors(p_item jsonb, p_where text, p_rank boolean)
returns text[] language plpgsql immutable set search_path = public as $$
declare e text[] := '{}'; k text; v jsonb;
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then return array[p_where || ' must be an object']; end if;
  for k in select jsonb_object_keys(p_item) loop
    if not (k in ('packs', 'shards', 'card_id') or (p_rank and k in ('from', 'to'))) then e := e || format('%s: unknown key %s', p_where, k); end if;
  end loop;
  foreach k in array case when p_rank then array['packs', 'shards', 'from', 'to'] else array['packs', 'shards'] end loop
    v := p_item->k;
    if v is null then
      if k in ('from', 'to') then e := e || format('%s: %s is required', p_where, k); end if;
      continue;
    end if;
    if jsonb_typeof(v) <> 'number' or (v::text) !~ '^-?[0-9]{1,9}$' then e := e || format('%s: %s must be a whole number', p_where, k); continue; end if;
    if k = 'packs' and (v::text)::numeric not between 0 and 100 then e := e || format('%s: packs must be 0 to 100', p_where); end if;
    if k = 'shards' and (v::text)::numeric not between 0 and 100000 then e := e || format('%s: shards must be 0 to 100000', p_where); end if;
    if k in ('from', 'to') and (v::text)::numeric not between 1 and 1000 then e := e || format('%s: %s must be 1 to 1000', p_where, k); end if;
  end loop;
  v := p_item->'card_id';
  if v is not null and v <> 'null'::jsonb and (jsonb_typeof(v) <> 'number' or (v::text) !~ '^[1-9][0-9]{0,17}$') then
    e := e || format('%s: card_id must be a card id', p_where);
  end if;
  if cardinality(e) = 0 and coalesce((p_item->>'packs')::int, 0) = 0 and coalesce((p_item->>'shards')::int, 0) = 0
     and coalesce(p_item->'card_id', 'null'::jsonb) = 'null'::jsonb then
    e := e || format('%s: give packs, Shards or a card', p_where);
  end if;
  return e;
end $$;

create or replace function public.event_shape_errors(p_kind text, p_audience jsonb, p_rewards jsonb, p_rules jsonb)
returns text[] language plpgsql immutable set search_path = public as $$
declare e text[] := '{}'; k text; v jsonb; i int := 0; prev int := 0; n int;
  iso constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$';
  allowed_rules text[];
begin
  if p_kind is null or p_kind not in ('drop', 'trigger', 'rank', 'launch_cards') then
    return array['kind must be drop, trigger, rank or launch_cards'];
  end if;

  -- audience
  if p_audience is null or jsonb_typeof(p_audience) <> 'object' then e := e || 'audience must be an object'::text;
  elsif p_audience = '{}'::jsonb then e := e || 'audience: choose everyone or at least one filter'::text;
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
                               else array['settings_key', 'gift_reasons'] end;
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
  if p_kind = 'launch_cards' and (jsonb_typeof(p_rules->'settings_key') is distinct from 'string' or jsonb_typeof(p_rules->'gift_reasons') is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_rules->'gift_reasons') x where jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^event:[a-z0-9_]+$')) then
    e := e || 'rules: a launch_cards event needs settings_key and gift_reasons (event:<name>)'::text;
  end if;
  return e;
end $$;

-- ============================================================ 2. the tables
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  key         text not null unique check (key ~ '^[a-z0-9][a-z0-9_]{2,47}$'),
  kind        text not null check (kind in ('drop', 'trigger', 'rank', 'launch_cards')),
  title       text not null check (length(trim(title)) between 1 and 80),
  description text not null default '' check (length(description) <= 1000),
  status      text not null default 'draft' check (status in ('draft', 'scheduled', 'live', 'ended', 'cancelled')),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  audience    jsonb not null default '{"all": true}',
  rewards     jsonb not null default '{}',
  rules       jsonb not null default '{}',
  created_by  text not null check (length(trim(created_by)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  ended_at    timestamptz,
  constraint events_time_order check (ends_at > starts_at),
  constraint events_ended_at check ((status in ('ended', 'cancelled')) = (ended_at is not null)),
  constraint events_shape check (cardinality(public.event_shape_errors(kind, audience, rewards, rules)) = 0)
);
create index if not exists events_due on public.events (starts_at) where status in ('scheduled', 'live');
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;

create table if not exists public.event_log (
  id       bigint generated always as identity primary key,
  event_id bigint not null references public.events(id),
  at       timestamptz not null default now(),
  actor    text not null check (length(trim(actor)) > 0),
  action   text not null check (action in ('create', 'migrate', 'edit', 'schedule', 'unschedule', 'start', 'end', 'cancel', 'pay')),
  old      jsonb,
  new      jsonb
);
create index if not exists event_log_event on public.event_log (event_id, id desc);
alter table public.event_log enable row level security;
revoke all on public.event_log from anon, authenticated;

create table if not exists public.event_payouts (
  event_id bigint not null references public.events(id),
  period   text not null check (period ~ '^(start|end|tick:.+)$'),
  paid_at  timestamptz not null default now(),
  members  int not null default 0 check (members >= 0),
  packs    int not null default 0 check (packs >= 0),
  shards   int not null default 0 check (shards >= 0),
  cards    int not null default 0 check (cards >= 0),
  primary key (event_id, period)
);
alter table public.event_payouts enable row level security;
revoke all on public.event_payouts from anon, authenticated;

alter table public.gift_claims add column if not exists event_id bigint references public.events(id);
create unique index if not exists gift_claims_event_once on public.gift_claims (event_id, player_id, kind, coalesce(card_id, 0)) where event_id is not null;
alter table public.cards add column if not exists event_id bigint references public.events(id);

-- ============================================================ 3. the triggers (updated_at, event_log, the gift link)
create or replace function public.events_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events for each row execute function public.events_touch();

create or replace function public.event_log_write() returns trigger
language plpgsql set search_path = public as $$
declare v_old jsonb; v_new jsonb; v_action text;
  v_actor text := coalesce(nullif(current_setting('events.actor', true), ''), balance_who());
begin
  if tg_op = 'INSERT' then
    insert into event_log (event_id, actor, action, new)
      values (new.id, v_actor, coalesce(nullif(current_setting('events.action', true), ''), 'create'), to_jsonb(new) - 'updated_at');
    return null;
  end if;
  select jsonb_object_agg(o.key, o.value), jsonb_object_agg(o.key, n.value) into v_old, v_new
    from jsonb_each(to_jsonb(old)) o join jsonb_each(to_jsonb(new)) n on n.key = o.key
   where o.value is distinct from n.value and o.key <> 'updated_at';
  if v_new is null then return null; end if;
  v_action := case when old.status is distinct from new.status then
      case new.status when 'scheduled' then 'schedule' when 'draft' then 'unschedule' when 'live' then 'start' when 'ended' then 'end' else 'cancel' end
    else 'edit' end;
  insert into event_log (event_id, actor, action, old, new) values (new.id, v_actor, v_action, v_old, v_new);
  return null;
end $$;
drop trigger if exists event_log_write on public.events;
create trigger event_log_write after insert or update on public.events for each row execute function public.event_log_write();

-- A gift whose reason an event lists in rules.gift_reasons (the launch event: event:launch_player, event:launch_raider)
-- gets that event id. The launch functions stay as they are.
create or replace function public.gift_claims_event_link() returns trigger
language plpgsql set search_path = public as $$
begin
  new.event_id := (select e.id from events e where e.rules->'gift_reasons' ? new.reason order by e.id limit 1);
  return new;
end $$;
drop trigger if exists gift_claims_event_link on public.gift_claims;
create trigger gift_claims_event_link before insert on public.gift_claims for each row
  when (new.event_id is null and new.reason like 'event:%') execute function public.gift_claims_event_link();

-- ============================================================ 4. who and what (read only)
-- The members of an audience at a time.
create or replace function public.event_audience(p_audience jsonb, p_now timestamptz default now())
returns table(member_id text) language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare v_active text[] := '{}';
begin
  if p_audience ? 'active_since' then
    select coalesce(array_agg(distinct a.player_id), '{}') into v_active
      from admin_active_days(game_day((p_audience->>'active_since')::timestamptz), game_day(p_now)) a where a.game;
  end if;
  return query select p.id from players p
   where p.left_guild_at is null
     and (p_audience ? 'all' or (
          (not p_audience ? 'members' or p.id in (select m from jsonb_array_elements_text(p_audience->'members') m))
      and (not p_audience ? 'joined_after' or p.created_at >= (p_audience->>'joined_after')::timestamptz)
      and (not p_audience ? 'joined_before' or p.created_at < (p_audience->>'joined_before')::timestamptz)
      and (not p_audience ? 'tutorial_done' or exists (select 1 from pack_ledger l where l.player_id = p.id and l.reason = 'tutorial' and l.created_at < p_now))
      and (not p_audience ? 'active_since' or p.id = any(v_active))));
end $$;

-- Who gets what if the event paid at p_now (the window ends at least(p_now, ends_at)). Read only: event_pay and the
-- previews use it, so a preview shows exactly what a payout would give (before the once-per-member rule).
create or replace function public.event_recipients(p_e public.events, p_now timestamptz default now())
returns table(member_id text, rank int, score bigint, packs int, shards int, card_id bigint)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare t0 timestamptz := p_e.starts_at; t1 timestamptz := least(p_now, p_e.ends_at); pm jsonb := p_e.rewards->'per_member';
begin
  if p_e.kind = 'drop' then
    return query select au.member_id, null::int, null::bigint, coalesce((pm->>'packs')::int, 0), coalesce((pm->>'shards')::int, 0), (pm->>'card_id')::bigint
      from event_audience(p_e.audience, t1) au;
  elsif p_e.kind = 'trigger' then
    return query select au.member_id, null::int, null::bigint, coalesce((pm->>'packs')::int, 0), coalesce((pm->>'shards')::int, 0), (pm->>'card_id')::bigint
      from event_audience(p_e.audience, t1) au
     where case p_e.rules->>'trigger'
       when 'hunt_hit' then exists (select 1 from hunt_hits h where h.player_id = au.member_id and h.created_at >= t0 and h.created_at < t1)
                         or exists (select 1 from hunt_combat_log c where c.player_id = au.member_id and c.ts >= t0 and c.ts < t1)
       when 'tutorial_done' then exists (select 1 from pack_ledger l where l.player_id = au.member_id and l.reason = 'tutorial' and l.created_at >= t0 and l.created_at < t1)
       when 'pack_opened' then exists (select 1 from pack_ledger l where l.player_id = au.member_id and l.reason = 'opened' and l.created_at >= t0 and l.created_at < t1)
       when 'dungeon_run' then exists (select 1 from dungeon_runs d where d.player_id = au.member_id and d.started_at >= t0 and d.started_at < t1)
       else false end;
  elsif p_e.kind = 'rank' then
    return query
      with aud as (select au.member_id from event_audience(p_e.audience, t1) au),
      s as (
        select x.pid, sum(x.v)::bigint as sc from (
          select c.player_id as pid, c.damage::bigint as v from hunt_combat_log c
           where p_e.rules->>'metric' = 'hunt_damage' and c.ts >= t0 and c.ts < t1 and c.damage > 0
          union all
          select l.player_id, abs(l.amount)::bigint from pack_ledger l
           where p_e.rules->>'metric' = 'packs_opened' and l.reason = 'opened' and l.created_at >= t0 and l.created_at < t1
        ) x where x.pid in (select aud.member_id from aud) group by x.pid having sum(x.v) > 0),
      r as (select s.pid, (rank() over (order by s.sc desc))::int as rk, s.sc from s)
      select r.pid, r.rk, r.sc, coalesce((z.t->>'packs')::int, 0), coalesce((z.t->>'shards')::int, 0), (z.t->>'card_id')::bigint
        from r join lateral (select t from jsonb_array_elements(p_e.rewards->'ranks') t
                              where r.rk between (t->>'from')::int and (t->>'to')::int limit 1) z on true;
  end if;
  -- launch_cards: nothing (its own functions pay it).
end $$;

-- The preview of an event row at p_now: counts and totals, the split into new and already paid, the ranks and the
-- first 25 members. No side effects.
create or replace function public.event_preview(p_e public.events, p_now timestamptz default now())
returns jsonb language sql stable set search_path = public as $$
  with r as (select x.* from event_recipients(p_e, p_now) x where x.packs > 0 or x.shards > 0 or x.card_id is not null),
  rp as (
    select r.*, exists (select 1 from gift_claims g where p_e.id is not null and g.event_id = p_e.id and g.player_id = r.member_id) as paid
      from r)
  select jsonb_build_object(
    'at', least(p_now, p_e.ends_at),
    'kind', p_e.kind,
    'audience', case when p_e.kind = 'launch_cards' then null else (select count(*) from event_audience(p_e.audience, least(p_now, p_e.ends_at))) end,
    'members', (select count(*) from rp),
    'packs', (select coalesce(sum(packs), 0) from rp),
    'shards', (select coalesce(sum(shards), 0) from rp),
    'cards', (select count(*) from rp where card_id is not null),
    'new_members', (select count(*) from rp where not paid),
    'new_packs', (select coalesce(sum(packs), 0) from rp where not paid),
    'new_shards', (select coalesce(sum(shards), 0) from rp where not paid),
    'new_cards', (select count(*) from rp where card_id is not null and not paid),
    'missing_cards', (select coalesce(jsonb_agg(distinct rp.card_id), '[]') from rp where rp.card_id is not null and not exists (select 1 from cards c where c.id = rp.card_id)),
    'by_rank', (select coalesce(jsonb_agg(jsonb_build_object('rank', b.rank, 'members', b.n, 'packs', b.packs, 'shards', b.shards, 'card_id', b.card_id) order by b.rank), '[]')
                  from (select rank, count(*) as n, sum(packs) as packs, sum(shards) as shards, min(card_id) as card_id from rp where rank is not null group by rank) b),
    'sample', (select coalesce(jsonb_agg(jsonb_build_object('member_id', s.member_id, 'username', s.username, 'rank', s.rank, 'score', s.score,
                  'packs', s.packs, 'shards', s.shards, 'card_id', s.card_id, 'paid', s.paid) order by s.rank nulls last, s.username, s.member_id), '[]')
                 from (select rp.*, p.username from rp join players p on p.id = rp.member_id order by rp.rank nulls last, p.username, rp.member_id limit 25) s));
$$;

-- ============================================================ 5. paying (the tick and the Admin end now)
-- Pays one event at p_now through gift_claims. period start / end: exactly once (event_payouts primary key; a second
-- call returns already_paid). period tick: pays the members not paid yet and records a 'tick:<time>' row when it paid.
-- The unique index gift_claims_event_once is the second guard: one gift per member, kind and card for each event.
create or replace function public.event_pay(p_id bigint, p_period text, p_now timestamptz default now())
returns jsonb language plpgsql set search_path = public as $$
#variable_conflict use_column
declare e events; v_title text; v_by text := current_setting('balance.by', true); v_period text := p_period;
  v_members int := 0; v_packs int := 0; v_shards int := 0; v_cards int := 0; v_out jsonb;
begin
  if p_period is null or p_period not in ('start', 'end', 'tick') then raise exception 'event_pay: the period is start, end or tick'; end if;
  select * into e from events where id = p_id;
  if not found then return jsonb_build_object('paid', false, 'error', 'not_found'); end if;
  if e.kind = 'launch_cards' then return jsonb_build_object('paid', false, 'error', 'not_paid_here'); end if;
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
end $$;

-- One step of one event at p_now: scheduled -> live (a drop pays its start), live -> ended at ends_at (trigger and rank
-- pay their end; a drop with late_joiners its last catch-up), and the catch-up of a live trigger event (or a drop with
-- late_joiners). A launch_cards event only changes status. Returns what it did.
create or replace function public.event_step(p_id bigint, p_now timestamptz default now())
returns jsonb language plpgsql set search_path = public as $$
declare e events; v_done jsonb := '[]'; v_late boolean;
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
    end if;
  end if;
  return jsonb_build_object('id', p_id, 'key', e.key, 'steps', v_done);
end $$;

-- The pg_cron job event-tick (every 10 minutes): one step for each due event. One tick at a time (an advisory lock).
create or replace function public.event_tick(p_now timestamptz default now())
returns jsonb language plpgsql set search_path = public as $$
declare v_id bigint; v_out jsonb := '[]'; v_actor text := current_setting('events.actor', true);
begin
  if not pg_try_advisory_xact_lock(hashtext('public.event_tick')) then return jsonb_build_object('ok', false, 'error', 'busy'); end if;
  perform set_config('events.actor', 'event_tick', true);
  for v_id in select id from events where status in ('scheduled', 'live') and starts_at <= p_now order by starts_at, id loop
    v_out := v_out || event_step(v_id, p_now);
  end loop;
  perform set_config('events.actor', coalesce(v_actor, ''), true);
  return jsonb_build_object('ok', true, 'at', p_now, 'events', v_out);
end $$;

-- ============================================================ 6. the Admin view (service role only)
-- The errors of a candidate row (the shapes, the times, the cards, the key). Empty = valid.
create or replace function public.event_row_errors(p_e public.events)
returns text[] language plpgsql stable set search_path = public as $$
declare e text[] := '{}'; v_cards bigint[];
begin
  if p_e.key is null or p_e.key !~ '^[a-z0-9][a-z0-9_]{2,47}$' then e := e || 'key: 3 to 48 characters a-z, 0-9 and _'::text;
  elsif exists (select 1 from events x where x.key = p_e.key and x.id is distinct from p_e.id) then e := e || 'key: another event has this key'::text; end if;
  if p_e.title is null or length(trim(p_e.title)) not between 1 and 80 then e := e || 'title: 1 to 80 characters'::text; end if;
  if length(coalesce(p_e.description, '')) > 1000 then e := e || 'description: at most 1000 characters'::text; end if;
  if p_e.starts_at is null or p_e.ends_at is null then e := e || 'the start and the end are required'::text;
  elsif p_e.ends_at <= p_e.starts_at then e := e || 'the end must be after the start'::text; end if;
  e := e || event_shape_errors(p_e.kind, p_e.audience, p_e.rewards, p_e.rules);
  if cardinality(e) = 0 and p_e.kind <> 'launch_cards' then
    v_cards := array(select (p_e.rewards->'per_member'->>'card_id')::bigint where p_e.rewards->'per_member'->>'card_id' is not null
                     union select (t->>'card_id')::bigint from jsonb_array_elements(coalesce(p_e.rewards->'ranks', '[]')) t where t->>'card_id' is not null);
    if exists (select 1 from unnest(v_cards) c where not exists (select 1 from cards x where x.id = c)) then e := e || 'rewards: a card id does not exist'::text; end if;
  end if;
  return e;
end $$;

create or replace function public.admin_events()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('now', now(), 'rows', coalesce(jsonb_agg(x.j order by x.ord, x.starts_at desc, x.id desc), '[]'))
    from (select e.id, e.starts_at, case e.status when 'live' then 0 when 'scheduled' then 1 when 'draft' then 2 else 3 end as ord,
                 jsonb_build_object('id', e.id, 'key', e.key, 'kind', e.kind, 'title', e.title, 'status', e.status, 'starts_at', e.starts_at,
                   'ends_at', e.ends_at, 'ended_at', e.ended_at, 'updated_at', e.updated_at, 'created_by', e.created_by,
                   'gifts', (select count(*) from gift_claims g where g.event_id = e.id),
                   'claimed', (select count(*) from gift_claims g where g.event_id = e.id and g.claimed_at is not null),
                   'members', (select count(distinct g.player_id) from gift_claims g where g.event_id = e.id)) as j
            from events e) x;
$$;

create or replace function public.admin_event(p_id bigint)
returns jsonb language sql stable set search_path = public as $$
  select case when e.id is null then jsonb_build_object('found', false) else jsonb_build_object('found', true,
    'event', to_jsonb(e),
    'editable', case when e.kind = 'launch_cards' then 'none' when e.status in ('draft', 'scheduled') then 'all' when e.status = 'live' then 'text_and_end' else 'none' end,
    'payouts', (select coalesce(jsonb_agg(to_jsonb(p) - 'event_id' order by p.paid_at, p.period), '[]') from event_payouts p where p.event_id = e.id),
    'claims', (select jsonb_build_object('gifts', count(*), 'claimed', count(g.claimed_at), 'members', count(distinct g.player_id),
                 'packs', coalesce(sum(g.amount) filter (where g.kind <> 'card'), 0), 'packs_claimed', coalesce(sum(g.amount) filter (where g.kind <> 'card' and g.claimed_at is not null), 0),
                 'shards', coalesce(sum(g.shards), 0), 'shards_claimed', coalesce(sum(g.shards) filter (where g.claimed_at is not null), 0),
                 'cards', count(*) filter (where g.kind = 'card'), 'cards_claimed', count(g.claimed_at) filter (where g.kind = 'card'))
                 from gift_claims g where g.event_id = e.id),
    'cards', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'rarity', c.rarity) order by c.id), '[]') from cards c
               where c.event_id = e.id or c.id in (select (e.rewards->'per_member'->>'card_id')::bigint
                                                    union select (t->>'card_id')::bigint from jsonb_array_elements(coalesce(e.rewards->'ranks', '[]')) t)),
    'log', (select coalesce(jsonb_agg(to_jsonb(l) - 'event_id' order by l.id desc), '[]') from (select * from event_log where event_id = e.id order by id desc limit 100) l)) end
  from (select 1) one left join events e on e.id = p_id;
$$;

-- Save a draft (no id: a new event) or an edit. p_expected_updated_at: the updated_at the editor read (an edit is
-- refused as stale when the row changed since). Draft and scheduled: every field (the key and the kind in a draft
-- only). Live: the title, the description and the end (not before now). Ended, cancelled and launch_cards: refused.
create or replace function public.admin_event_save(p_event jsonb, p_expected_updated_at timestamptz, p_actor text, p_reason text default null)
returns jsonb language plpgsql set search_path = public as $$
declare e events; c events; v_errors text[]; v_fields jsonb; v_id bigint; k text;
  editable constant text[] := array['key', 'kind', 'title', 'description', 'starts_at', 'ends_at', 'audience', 'rewards', 'rules'];
begin
  if coalesce(trim(p_actor), '') = '' then raise exception 'admin_event_save: the actor is required'; end if;
  if p_event is null or jsonb_typeof(p_event) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('the event must be an object')); end if;
  for k in select jsonb_object_keys(p_event) loop
    if k <> 'id' and not k = any(editable) then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array(format('%s cannot be set', k))); end if;
  end loop;
  v_fields := p_event - 'id';
  begin
    v_id := (p_event->>'id')::bigint;
    if v_id is null then
      c := jsonb_populate_record(null::events, v_fields || jsonb_build_object('status', 'draft', 'created_by', p_actor));
      c.audience := coalesce(c.audience, '{"all": true}'); c.rewards := coalesce(c.rewards, '{}'); c.rules := coalesce(c.rules, '{}');
      c.description := coalesce(c.description, '');
    else
      select * into e from events where id = v_id for update;
      if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
      c := jsonb_populate_record(e, v_fields);
    end if;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('a value has the wrong type: ' || sqlerrm));
  end;
  if v_id is not null then
    if e.updated_at is distinct from p_expected_updated_at then return jsonb_build_object('ok', false, 'error', 'stale', 'event', to_jsonb(e)); end if;
    if e.kind = 'launch_cards' then return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array('the launch event is set in settings.launch_event_cards')); end if;
    if e.status in ('ended', 'cancelled') then return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array(format('an event that is %s cannot change', e.status))); end if;
    if e.status = 'scheduled' and (c.key is distinct from e.key or c.kind is distinct from e.kind) then
      return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array('the key and the kind change only in a draft'));
    end if;
    if e.status = 'live' and (c.key, c.kind, c.starts_at, c.audience, c.rewards, c.rules) is distinct from (e.key, e.kind, e.starts_at, e.audience, e.rewards, e.rules) then
      return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array('a live event changes only its title, description and end'));
    end if;
    if e.status = 'live' and c.ends_at is distinct from e.ends_at and c.ends_at <= now() then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('the end of a live event must be after now (use End now)'));
    end if;
  end if;
  if c.kind = 'launch_cards' then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('kind launch_cards is only the migrated launch event')); end if;
  v_errors := event_row_errors(c);
  if cardinality(v_errors) > 0 then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', to_jsonb(v_errors)); end if;

  perform set_config('events.actor', p_actor, true);
  if v_id is null then
    insert into events (key, kind, title, description, status, starts_at, ends_at, audience, rewards, rules, created_by)
      values (c.key, c.kind, trim(c.title), c.description, 'draft', c.starts_at, c.ends_at, c.audience, c.rewards, c.rules, p_actor)
      returning * into c;
  else
    update events set key = c.key, kind = c.kind, title = trim(c.title), description = c.description, starts_at = c.starts_at, ends_at = c.ends_at,
                      audience = c.audience, rewards = c.rewards, rules = c.rules
     where id = v_id returning * into c;
  end if;
  perform set_config('events.actor', '', true);
  perform admin_log_action(p_actor, case when v_id is null then 'event_create' else 'event_edit' end, 'event', c.id::text,
    case when v_id is null then null else to_jsonb(e) end, to_jsonb(c), p_reason, 'studio');
  return jsonb_build_object('ok', true, 'event', to_jsonb(c));
end $$;

-- A status change by the admin (schedule, unschedule, cancel): checks, the update, the logs.
create or replace function public.admin_event_status(p_id bigint, p_expected_updated_at timestamptz, p_actor text, p_to text, p_reason text)
returns jsonb language plpgsql set search_path = public as $$
declare e events; c events; v_errors text[];
begin
  if coalesce(trim(p_actor), '') = '' then raise exception 'admin_event_status: the actor is required'; end if;
  select * into e from events where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if e.updated_at is distinct from p_expected_updated_at then return jsonb_build_object('ok', false, 'error', 'stale', 'event', to_jsonb(e)); end if;
  if e.kind = 'launch_cards' then return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array('the launch event is set in settings.launch_event_cards')); end if;
  if not ((p_to = 'scheduled' and e.status = 'draft') or (p_to = 'draft' and e.status = 'scheduled') or (p_to = 'cancelled' and e.status in ('draft', 'scheduled', 'live'))) then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'errors', jsonb_build_array(format('%s cannot become %s', e.status, p_to)));
  end if;
  if p_to = 'scheduled' then
    v_errors := event_row_errors(e);
    if e.ends_at <= now() then v_errors := v_errors || 'the end is in the past'::text; end if;
    if cardinality(v_errors) > 0 then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', to_jsonb(v_errors)); end if;
  end if;
  perform set_config('events.actor', p_actor, true);
  update events set status = p_to, ended_at = case when p_to = 'cancelled' then now() end where id = p_id returning * into c;
  perform set_config('events.actor', '', true);
  perform admin_log_action(p_actor, case p_to when 'scheduled' then 'event_schedule' when 'draft' then 'event_unschedule' else 'event_cancel' end,
    'event', p_id::text, jsonb_build_object('status', e.status), jsonb_build_object('status', c.status), p_reason, 'studio');
  return jsonb_build_object('ok', true, 'event', to_jsonb(c));
end $$;

-- Schedule a draft (p_on true) or move a scheduled event back to a draft (p_on false). The tick starts it at starts_at.
create or replace function public.admin_event_schedule(p_id bigint, p_expected_updated_at timestamptz, p_actor text, p_on boolean default true)
returns jsonb language sql set search_path = public as $$
  select admin_event_status(p_id, p_expected_updated_at, p_actor, case when p_on then 'scheduled' else 'draft' end, null);
$$;

-- Cancel a draft, scheduled or live event: no more payouts. The gifts already given stay in the bells.
create or replace function public.admin_event_cancel(p_id bigint, p_expected_updated_at timestamptz, p_actor text, p_reason text default null)
returns jsonb language sql set search_path = public as $$
  select admin_event_status(p_id, p_expected_updated_at, p_actor, 'cancelled', p_reason);
$$;

-- End a live event now: the end becomes now, and the step pays its end (trigger, rank, a drop with late_joiners) once.
create or replace function public.admin_event_end_now(p_id bigint, p_expected_updated_at timestamptz, p_actor text, p_reason text default null)
returns jsonb language plpgsql set search_path = public as $$
declare e events; c events; v_now timestamptz; v_step jsonb;
begin
  if coalesce(trim(p_actor), '') = '' then raise exception 'admin_event_end_now: the actor is required'; end if;
  select * into e from events where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if e.updated_at is distinct from p_expected_updated_at then return jsonb_build_object('ok', false, 'error', 'stale', 'event', to_jsonb(e)); end if;
  if e.kind = 'launch_cards' then return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array('the launch event is set in settings.launch_event_cards')); end if;
  if e.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'bad_status', 'errors', jsonb_build_array(format('%s cannot end now (only live)', e.status))); end if;
  v_now := greatest(now(), e.starts_at + interval '1 second');
  perform set_config('events.actor', p_actor, true);
  if e.ends_at > v_now then update events set ends_at = v_now where id = p_id; end if;
  v_step := event_step(p_id, v_now);
  perform set_config('events.actor', '', true);
  select * into c from events where id = p_id;
  perform admin_log_action(p_actor, 'event_end_now', 'event', p_id::text, jsonb_build_object('status', e.status, 'ends_at', e.ends_at),
    jsonb_build_object('status', c.status, 'ends_at', c.ends_at, 'step', v_step), p_reason, 'studio');
  return jsonb_build_object('ok', true, 'event', to_jsonb(c), 'step', v_step);
end $$;

-- Who would get what if the tick ran now (counts, totals, the first 25 members). No side effects.
create or replace function public.admin_event_preview(p_id bigint)
returns jsonb language sql stable set search_path = public as $$
  select case when e.id is null then jsonb_build_object('found', false) else event_preview(e, now()) || jsonb_build_object('found', true, 'status', e.status) end
    from (select 1) one left join events e on e.id = p_id;
$$;

-- The same for an event that is not saved (the editor "Test"): the fields of admin_event_save. No side effects.
create or replace function public.admin_event_preview_draft(p_event jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare c events; v_errors text[];
begin
  if p_event is null or jsonb_typeof(p_event) <> 'object' then return jsonb_build_object('ok', false, 'errors', jsonb_build_array('the event must be an object')); end if;
  begin
    c := jsonb_populate_record(null::events, (p_event - 'id' - 'status' - 'created_by') || jsonb_build_object('status', 'draft', 'created_by', 'preview'));
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('a value has the wrong type: ' || sqlerrm));
  end;
  c.audience := coalesce(c.audience, '{"all": true}'); c.rewards := coalesce(c.rewards, '{}'); c.rules := coalesce(c.rules, '{}');
  c.id := (p_event->>'id')::bigint; -- an edit: the members already paid by the saved event show as paid
  if c.kind = 'launch_cards' then return jsonb_build_object('ok', false, 'errors', jsonb_build_array('kind launch_cards is only the migrated launch event')); end if;
  v_errors := event_row_errors(c);
  if cardinality(v_errors) > 0 then return jsonb_build_object('ok', false, 'errors', to_jsonb(v_errors)); end if;
  return event_preview(c, now()) || jsonb_build_object('ok', true);
end $$;

revoke execute on function public.event_reward_errors(jsonb, text, boolean), public.event_shape_errors(text, jsonb, jsonb, jsonb),
  public.events_touch(), public.event_log_write(), public.gift_claims_event_link(), public.event_audience(jsonb, timestamptz),
  public.event_recipients(public.events, timestamptz), public.event_preview(public.events, timestamptz), public.event_pay(bigint, text, timestamptz),
  public.event_step(bigint, timestamptz), public.event_tick(timestamptz), public.event_row_errors(public.events), public.admin_events(),
  public.admin_event(bigint), public.admin_event_save(jsonb, timestamptz, text, text), public.admin_event_status(bigint, timestamptz, text, text, text),
  public.admin_event_schedule(bigint, timestamptz, text, boolean), public.admin_event_cancel(bigint, timestamptz, text, text),
  public.admin_event_end_now(bigint, timestamptz, text, text), public.admin_event_preview(bigint), public.admin_event_preview_draft(jsonb)
  from public, anon, authenticated;

-- ============================================================ 7. the launch event: one row (data)
do $launch$
declare cfg jsonb := (select value from settings where key = 'launch_event_cards'); v_id bigint; v_until timestamptz;
begin
  if cfg is null then return; end if; -- a database without the launch event
  v_until := (cfg->>'player_until')::timestamptz;
  if not exists (select 1 from events where key = 'launch_2026') then
    perform set_config('events.actor', 'events.sql', true);
    perform set_config('events.action', 'migrate', true);
    insert into events (key, kind, title, description, status, starts_at, ends_at, audience, rewards, rules, created_by, ended_at)
    values ('launch_2026', 'launch_cards', 'Launch Day event cards',
      'Launch Day Player: a member who finishes the tutorial in the window gets the card (claim_tutorial_reward). Launch Day Raider: a member who fights in the first two Hunts from the launch boss gets the card (the launch_raider_gift trigger). One copy each. Set in settings.launch_event_cards (launch_event_cards.sql).',
      case when now() < v_until then 'live' else 'ended' end, (cfg->>'player_from')::timestamptz, v_until, '{"all": true}', '{}',
      jsonb_build_object('settings_key', 'launch_event_cards', 'gift_reasons', jsonb_build_array('event:launch_player', 'event:launch_raider')),
      'events.sql', case when now() < v_until then null else v_until end);
    perform set_config('events.action', '', true);
    perform set_config('events.actor', '', true);
  end if;
  select id into v_id from events where key = 'launch_2026';
  update gift_claims set event_id = v_id where event_id is null and reason in ('event:launch_player', 'event:launch_raider');
  update cards set event_id = v_id where event_id is null and id in ((cfg->>'player_card')::bigint, (cfg->>'raider_card')::bigint);
end $launch$;

-- ============================================================ 8. the pg_cron job (only when it is missing)
do $c$ begin
  if to_regclass('cron.job') is not null and not exists (select 1 from cron.job where jobname = 'event-tick') then
    perform cron.schedule('event-tick', '*/10 * * * *', 'select public.event_tick();');
  end if;
end $c$;

-- ============================================================ comments (the same text is in db_comments.sql)
comment on table public.events is $c$[events] One row per event (events.sql): key, kind (drop, trigger, rank, launch_cards), title, description, status (draft, scheduled, live, ended, cancelled), the window starts_at .. ends_at, audience, rewards and rules (jsonb; the shapes are in events.sql and checked by event_shape_errors). The Admin view writes it (admin_event_save, admin_event_schedule, admin_event_cancel, admin_event_end_now); event_tick moves the status by time and pays. Every change writes event_log. Server only.$c$;
comment on column public.events.id is $c$The event id. gift_claims.event_id, cards.event_id, event_log and event_payouts point at it.$c$;
comment on column public.events.key is $c$The unique short name (3 to 48 characters a-z, 0-9, _), for example launch_2026. Payout gifts write the actor event:<key> in admin_actions.$c$;
comment on column public.events.kind is $c$drop (paid at the start to the audience), trigger (paid once to each audience member who does rules.trigger in the window), rank (paid once at the end by rank of rules.metric), launch_cards (the migrated launch event: its own functions pay it, never the tick).$c$;
comment on column public.events.title is $c$The event name (1 to 80 characters). The bell shows it on a packs or Shards gift unless rewards.title is set.$c$;
comment on column public.events.description is $c$A note for the admin (at most 1000 characters). Members do not see it.$c$;
comment on column public.events.status is $c$draft (being edited), scheduled (event_tick starts it at starts_at), live, ended (at ends_at, or End now), cancelled (no more payouts; the gifts already given stay).$c$;
comment on column public.events.starts_at is $c$The start of the window. A trigger or rank event counts actions from this time.$c$;
comment on column public.events.ends_at is $c$The end of the window (after starts_at). The tick ends the event at this time and pays the end once.$c$;
comment on column public.events.audience is $c$Who can get the rewards: {"all": true}, or filters that must all match: active_since, joined_after, joined_before (ISO times with a zone), tutorial_done (true), members (a list of ids). A member who left the server never counts (event_audience).$c$;
comment on column public.events.rewards is $c$What a member gets: title (optional bell text), per_member {packs, shards, card_id} for drop and trigger, ranks [{from, to, packs, shards, card_id}] for rank. Empty for launch_cards.$c$;
comment on column public.events.rules is $c$The rule of the kind: drop {late_joiners}, trigger {trigger: hunt_hit, tutorial_done, pack_opened, dungeon_run}, rank {metric: hunt_damage, packs_opened}, launch_cards {settings_key, gift_reasons}.$c$;
comment on column public.events.created_by is $c$Who made the event (the studio actor, or events.sql for the migrated launch event).$c$;
comment on column public.events.created_at is $c$When the row was made.$c$;
comment on column public.events.updated_at is $c$The time of the last change (the events_touch trigger, clock time). The Admin view sends it back: an edit of a changed row is refused as stale.$c$;
comment on column public.events.ended_at is $c$When the event ended or was cancelled; null while draft, scheduled or live (check events_ended_at).$c$;
comment on table public.event_log is $c$[events] One row per change of an event (the event_log_write trigger) and per payout run (event_pay): who (events.actor, else balance_who), the action (create, migrate, edit, schedule, unschedule, start, end, cancel, pay), the old and new values of the changed fields. Never pruned. Server only.$c$;
comment on column public.event_log.id is $c$Row id.$c$;
comment on column public.event_log.event_id is $c$The event (events.id).$c$;
comment on column public.event_log.at is $c$When the change was made.$c$;
comment on column public.event_log.actor is $c$Who made it: the studio actor, event_tick, events.sql, or balance_who for a change in SQL.$c$;
comment on column public.event_log.action is $c$create, migrate, edit, schedule, unschedule, start, end, cancel or pay.$c$;
comment on column public.event_log.old is $c$The changed fields before the change (null for create and pay).$c$;
comment on column public.event_log.new is $c$The changed fields after the change; the whole row for create; for pay: period, members, packs, shards, cards.$c$;
comment on table public.event_payouts is $c$[events] One row per payout run of an event (event_pay): start (a drop) and end (trigger, rank, a drop with late_joiners) once each (the primary key makes a second run a no-op), tick:<time> for each catch-up that paid. members, packs, shards and cards are what the run gave. Server only.$c$;
comment on column public.event_payouts.event_id is $c$The event (events.id).$c$;
comment on column public.event_payouts.period is $c$start, end, or tick:<UTC time> (a catch-up run).$c$;
comment on column public.event_payouts.paid_at is $c$When the run paid.$c$;
comment on column public.event_payouts.members is $c$The members who got a new gift in this run.$c$;
comment on column public.event_payouts.packs is $c$The packs given in this run (gift_claims.amount).$c$;
comment on column public.event_payouts.shards is $c$The Shards given in this run (gift_claims.shards).$c$;
comment on column public.event_payouts.cards is $c$The card gifts given in this run.$c$;
comment on column public.gift_claims.event_id is $c$The event of the gift (events.id), else null. event_pay sets it; the gift_claims_event_link trigger sets it for a reason in an event's rules.gift_reasons (the launch cards). One gift per event, member, kind and card (gift_claims_event_once).$c$;
comment on column public.cards.event_id is $c$The event that gives this card (events.id), else null. Set for the two launch cards by events.sql.$c$;
comment on function public.event_reward_errors(jsonb, text, boolean) is $c$[events] The errors of one reward item (per_member or a rank tier): packs 0-100, shards 0-100000, card_id, from and to 1-1000 for a tier, at least one reward. Empty = valid.$c$;
comment on function public.event_shape_errors(text, jsonb, jsonb, jsonb) is $c$[events] The errors of an event's kind, audience, rewards and rules (the shapes in events.sql). Empty = valid. The CHECK events_shape uses it, and the Admin save shows the list.$c$;
comment on function public.events_touch() is $c$[events] Trigger (before update on events): sets updated_at to the clock time.$c$;
comment on function public.event_log_write() is $c$[events] Trigger (after insert or update on events): writes event_log with the changed fields and the action (from the status change, else edit). The actor is the setting events.actor, else balance_who.$c$;
comment on function public.gift_claims_event_link() is $c$[events] Trigger (before insert on gift_claims, reason event:*): sets event_id to the event whose rules.gift_reasons lists the reason (the launch cards).$c$;
comment on function public.event_audience(jsonb, timestamp with time zone) is $c$[events] The member ids of an audience at a time: everyone, or all filters (active_since through admin_active_days game rows, joined_after/joined_before on players.created_at, tutorial_done through pack_ledger reason tutorial, members). Members who left the server are left out.$c$;
comment on function public.event_recipients(public.events, timestamp with time zone) is $c$[events] Who gets what if the event paid at the time: member, rank, score, packs, shards, card. drop: the audience; trigger: the audience members with the trigger in the window (hunt_hits or hunt_combat_log, pack_ledger tutorial or opened, dungeon_runs); rank: rank() of the metric in the window (hunt_combat_log damage, pack_ledger opened) matched to the tiers. Read only.$c$;
comment on function public.event_preview(public.events, timestamp with time zone) is $c$[events] The preview of an event row: audience size, members, packs, shards, cards, the part not paid yet (new_*), missing cards, by_rank and the first 25 members. Read only.$c$;
comment on function public.event_pay(bigint, text, timestamp with time zone) is $c$[events] Pays an event at a time through gift_claims (kind promo for packs and Shards, kind card, reason event, event_id set). start and end run once (event_payouts primary key); tick pays the members not paid yet. Writes event_payouts and event_log. Never pays launch_cards.$c$;
comment on function public.event_step(bigint, timestamp with time zone) is $c$[events] One step of one event: scheduled to live (a drop pays its start), live to ended at ends_at (trigger and rank pay the end), and the catch-up of a live trigger event or a drop with late_joiners. launch_cards: status only.$c$;
comment on function public.event_tick(timestamp with time zone) is $c$[events] The pg_cron job event-tick (every 10 minutes): event_step for each scheduled or live event that started. One tick at a time (advisory lock). Returns the steps.$c$;
comment on function public.event_row_errors(public.events) is $c$[events] The errors of a candidate event row: key (format, unique), title, description, the times, the shapes and that each reward card exists. Empty = valid.$c$;
comment on function public.admin_events() is $c$[admin] The event list for the Admin view: live, scheduled, draft, then the others (newest first), with the gift counts (gift_claims.event_id). Service role only.$c$;
comment on function public.admin_event(bigint) is $c$[admin] One event: the row, what can be edited, the payouts (event_payouts), the claims (gift_claims: gifts, claimed, packs, Shards, cards), the cards and the last 100 event_log rows. Service role only.$c$;
comment on function public.admin_event_save(jsonb, timestamp with time zone, text, text) is $c$[admin] Saves a new draft (no id) or an edit with an optimistic check (p_expected_updated_at must be the row's updated_at, else stale). Draft and scheduled: all fields (key and kind in a draft only); live: title, description and a later end. Returns the errors of event_row_errors. Writes admin_actions and event_log. Service role only.$c$;
comment on function public.admin_event_status(bigint, timestamp with time zone, text, text, text) is $c$[admin] The status change of admin_event_schedule and admin_event_cancel: draft to scheduled (a valid row with a future end), scheduled to draft, draft, scheduled or live to cancelled. Optimistic check; writes admin_actions and event_log. Service role only.$c$;
comment on function public.admin_event_schedule(bigint, timestamp with time zone, text, boolean) is $c$[admin] Schedules a draft (p_on true; the tick starts it at starts_at) or moves a scheduled event back to a draft (p_on false). Service role only.$c$;
comment on function public.admin_event_cancel(bigint, timestamp with time zone, text, text) is $c$[admin] Cancels a draft, scheduled or live event: the tick pays it no more. The gifts already given stay. Service role only.$c$;
comment on function public.admin_event_end_now(bigint, timestamp with time zone, text, text) is $c$[admin] Ends a live event now: the end becomes now and event_step pays the end once. Writes admin_actions and event_log. Service role only.$c$;
comment on function public.admin_event_preview(bigint) is $c$[admin] Who would get what if the tick ran now (event_preview): counts, totals, ranks, the first 25 members. No side effects. Service role only.$c$;
comment on function public.admin_event_preview_draft(jsonb) is $c$[admin] The preview of an event that is not saved (the editor Test): the fields of admin_event_save, checked by event_row_errors. No side effects. Service role only.$c$;

notify pgrst, 'reload schema';
