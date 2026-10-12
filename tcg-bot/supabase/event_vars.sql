-- event_vars.sql (2026-10-11): F-1 PR 1, the event calendar foundation (docs/foundations.md F-1 items 0, 1, 2, 5, 7, 8).
-- Nathan (2026-10-11): "I want the freedom to make any kind of event I want." So an event changes the game only through
-- named variables with limits, and an event can be saved in a library and made again.
--
-- Before: an event could only pay gifts (drop, trigger, rank). A value that an event should change (the pull odds, the
-- earned packs) was changed by hand (/packrate) or not at all. event-tick ran every 10 minutes, and a live event could
-- change only its title, description and end.
-- Now:
--   1. event_vars       the registry of the variables that an event can change: key, label, note, the balance key (and the
--                       json path) of the base value, how live events combine (multiply or max), the limits, whole numbers.
--                       balance_path null = a FACTOR of the whole balance key (base 1; the reader applies it, for example
--                       game_pull_rates). Only registered keys can go into events.vars.
--   2. game_var(key)    the ONE reader: the base from balance, combined with the vars of every live event (status live and
--                       inside its window), the combined event part kept inside the limits. No live event = the balance value.
--                       game_vars() returns all of them in one call (the bot caches it, F-1 PR 4). game_pull_rates() is
--                       balance pulls with pull_rare_mult applied: every rate that is not normal x the factor, normal = the
--                       rest, so the rates still add up to 1.
--   3. events           new columns vars (jsonb {key: number}), theme (jsonb: name, color, art, banner), template_id (the
--                       library entry it was made from) and repeat_id (null; F-1 PR 2 adds event_repeats and its foreign
--                       key, so the column is ready and nothing writes it yet). New kind modifier: vars only, audience
--                       everyone, no rewards and no rules; event_pay refuses it (not_paid_here) and event_recipients has no
--                       row for it. Kind hunt is F-1 PR 2.
--   4. The checks       event_theme_errors (immutable: a CHECK on events and event_templates). event_vars_errors reads the
--                       registry, so it runs in a TRIGGER (events_vars_check), not in a CHECK: a dump restore loads tables in
--                       any order, and a CHECK that reads another table could refuse a valid row. event_shape_errors gets a
--                       6-argument form (the 4 old shapes + vars + theme); event_row_errors uses it, so the Admin save shows
--                       every error. The 4-argument form knows the kind modifier.
--   5. Live edits       (Nathan 2026-10-11: yes) admin_event_save: a live event may change its title, description, end,
--                       vars and theme; never its start, kind, key, audience, rewards or rules. event_log_write already
--                       writes every changed field (old and new), so a vars change is in event_log.
--   6. event_templates  the event library: name, kind, description, audience, rewards, rules, vars, theme, default_length.
--                       admin_event_templates (list), admin_event_template_save (new or edit, optimistic check),
--                       admin_event_template_from_event ("save as template"), admin_event_from_template (a new DRAFT event,
--                       template_id set; a change to the event never changes the template).
--   7. event-tick       every minute (was every 10 minutes): an event starts and ends within about 1 minute.
-- Not here (later F-1 PRs): the Hunt as an event and event_repeats (PR 2), runs each day (PR 3), the bot reads game_var
-- (PR 4), the admin calendar and template routes (PR 5). Variables whose base is still fixed in code (dungeon_runs_per_day,
-- gauntlet_runs_per_week) come with PR 3, after their balance key exists.
-- Test: card-studio/scripts/test-event-vars.mjs (rolled back; MUTATE=<name> must FAIL). Idempotent.

-- GUARD (the combat_core.sql rule): each replaced function must be the live text this file was built from (or the text this
-- file made).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.event_shape_errors(text, jsonb, jsonb, jsonb)', '868ac78be05b0c594ff56a60504fe2b8', '2b16151d87e19b012938ed178b8fb45e'),
    ('public.event_pay(bigint, text, timestamp with time zone)', '6d3f9669b6b776ea22ec91e76010aa30', 'c8748d3dea281bfc22e3fdaa9faf7f61'),
    ('public.event_row_errors(events)', '4326b649836f257bab1f406af76d46e8', 'd7251a662c596597ce997d71247d8995'),
    ('public.admin_event_save(jsonb, timestamp with time zone, text, text)', 'fabbe94949521a6d2fa6b28ed87e29e9', 'bfd1eeca77fa7dca32282cb25fdc5d12')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'event_vars.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the variable registry
create table if not exists public.event_vars (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]{2,47}$'),
  label        text not null check (length(trim(label)) between 1 and 60),
  note         text not null check (length(trim(note)) between 1 and 1000),
  balance_key  text not null references public.balance(key),
  balance_path text[],
  combine      text not null check (combine in ('multiply', 'max')),
  min_value    numeric not null check (min_value >= 0),
  max_value    numeric not null,
  whole        boolean not null default false,
  updated_at   timestamptz not null default now(),
  constraint event_vars_limits check (min_value <= max_value),
  constraint event_vars_factor check (balance_path is not null or combine = 'multiply')
);
alter table public.event_vars enable row level security;
revoke all on public.event_vars from anon, authenticated;

-- A variable with a path must point at a number in balance (balance_num raises otherwise).
create or replace function public.event_vars_base_check() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.balance_path is not null then perform balance_num(new.balance_key, variadic new.balance_path); end if;
  new.updated_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists event_vars_base_check on public.event_vars;
create trigger event_vars_base_check before insert or update on public.event_vars for each row execute function public.event_vars_base_check();

-- The first variables: only those whose base value is already in balance.
insert into public.event_vars (key, label, note, balance_key, balance_path, combine, min_value, max_value, whole) values
  ('pack_earn_mult', 'Earned packs', 'A factor on balance pack_earn_multiplier: every earned pack (the dailies and the chat packs). Live events multiply. The bot reads it from F-1 PR 4 (/packrate becomes a modifier event).',
   'pack_earn_multiplier', '{}', 'multiply', 0, 5, false),
  ('pull_rare_mult', 'Rare pull odds', 'A factor on every pull rate that is not normal (balance pulls.rates); normal takes the rest, so the rates add up to 1 (game_pull_rates). Live events multiply. The bot reads it from F-1 PR 4.',
   'pulls', null, 'multiply', 0.5, 5, false),
  ('daily_shards', 'Daily Shards', 'The Shards of every daily claim (balance daily.shards) x the factor, rounded. Live events multiply. Not read by the game yet (its reader calls game_var in a later F-1 PR).',
   'daily', '{shards}', 'multiply', 0, 5, true),
  ('daily_cap', 'Daily earned-pack cap', 'The most earned packs in one MT day (balance daily.cap). An event can only raise it (max). Not read by the game yet (a later F-1 PR).',
   'daily', '{cap}', 'max', 1, 20, true),
  ('dungeon_shards_mult', 'Dungeon Shards', 'A factor on every Dungeon Shards reward (balance dungeon_rewards: shards_kill, floor_shards, chest, offers and run_shards_cap). Live events multiply. Not read by the game yet (a later F-1 PR).',
   'dungeon_rewards', null, 'multiply', 0, 5, false),
  ('dungeon_loot_chance', 'Dungeon card drop chance', 'The card drop chance of a Dungeon kill (balance dungeon_rewards.loot_chance). An event can only raise it (max), at most 1. Not read by the game yet (a later F-1 PR).',
   'dungeon_rewards', '{loot_chance}', 'max', 0, 1, false),
  ('hunt_prize_mult', 'Hunt prize packs', 'A factor on the Hunt prize packs (balance hunt_prizes: base and ranks), rounded by the reader. Live events multiply. Not read by the game yet (a later F-1 PR).',
   'hunt_prizes', null, 'multiply', 0.5, 5, false),
  ('shop_price_mult', 'Shop prices', 'A factor on the Shop prices in Shards (balance shards: prices and pack_price); below 1 is a sale. Live events multiply. Not read by the game yet (a later F-1 PR).',
   'shards', null, 'multiply', 0.25, 2, false)
on conflict (key) do nothing;

-- ============================================================ 2. the shape checks of vars and theme
-- vars: an object of registered keys with numbers inside the limits (whole numbers for a whole max variable; a multiply
-- value is a factor, so it may be a fraction). A modifier needs
-- at least one; the launch event has none. Reads the registry (STABLE): used in a trigger and in the Admin checks.
create or replace function public.event_vars_errors(p_kind text, p_vars jsonb)
returns text[] language plpgsql stable set search_path = public as $$
declare e text[] := '{}'; k text; x jsonb; v event_vars; n numeric;
begin
  if p_vars is null or jsonb_typeof(p_vars) <> 'object' then return array['vars must be an object']; end if;
  if p_kind = 'modifier' and p_vars = '{}'::jsonb then e := e || 'vars: a modifier event changes at least one variable'::text; end if;
  if p_kind = 'launch_cards' and p_vars <> '{}'::jsonb then e := e || 'vars: the launch event has no variables'::text; end if;
  for k, x in select j.key, j.value from jsonb_each(p_vars) j order by j.key loop
    select * into v from event_vars where key = k;
    if not found then e := e || format('vars: %s is not a variable (event_vars)', k); continue; end if;
    if jsonb_typeof(x) <> 'number' then e := e || format('vars: %s must be a number', k); continue; end if;
    n := (x #>> '{}')::numeric;
    if n < v.min_value or n > v.max_value then e := e || format('vars: %s must be from %s to %s', k, v.min_value, v.max_value); end if;
    if v.whole and v.combine = 'max' and n <> trunc(n) then e := e || format('vars: %s must be a whole number', k); end if;
  end loop;
  return e;
end $$;

-- theme: an object with only name (1-40), color (#RRGGBB), art (an https URL, at most 500) and banner (1-120).
create or replace function public.event_theme_errors(p_theme jsonb)
returns text[] language plpgsql immutable set search_path = public as $$
declare e text[] := '{}'; k text;
begin
  if p_theme is null or jsonb_typeof(p_theme) <> 'object' then return array['theme must be an object']; end if;
  for k in select jsonb_object_keys(p_theme) loop
    if k not in ('name', 'color', 'art', 'banner') then e := e || format('theme: unknown key %s', k); end if;
  end loop;
  if p_theme ? 'name' and (jsonb_typeof(p_theme->'name') <> 'string' or length(trim(p_theme->>'name')) not between 1 and 40) then e := e || 'theme: name must be 1 to 40 characters'::text; end if;
  if p_theme ? 'color' and (jsonb_typeof(p_theme->'color') <> 'string' or (p_theme->>'color') !~ '^#[0-9A-Fa-f]{6}$') then e := e || 'theme: color must be #RRGGBB'::text; end if;
  if p_theme ? 'art' and (jsonb_typeof(p_theme->'art') <> 'string' or length(p_theme->>'art') > 500 or (p_theme->>'art') !~ '^https://[^\s]+$') then e := e || 'theme: art must be an https URL of at most 500 characters'::text; end if;
  if p_theme ? 'banner' and (jsonb_typeof(p_theme->'banner') <> 'string' or length(trim(p_theme->>'banner')) not between 1 and 120) then e := e || 'theme: banner must be 1 to 120 characters'::text; end if;
  return e;
end $$;

-- The 4 old shapes + vars + theme: the full list for the Admin checks (event_row_errors, the template checks).
create or replace function public.event_shape_errors(p_kind text, p_audience jsonb, p_rewards jsonb, p_rules jsonb, p_vars jsonb, p_theme jsonb)
returns text[] language sql stable set search_path = public as $$
  select event_shape_errors(p_kind, p_audience, p_rewards, p_rules) || event_vars_errors(p_kind, p_vars) || event_theme_errors(p_theme);
$$;

-- The 4-argument shape check (the CHECK events_shape): the kind modifier (audience everyone, rewards {}, rules {}).
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
  if p_kind is null or p_kind not in ('drop', 'trigger', 'rank', 'modifier', 'launch_cards') then
    return array['kind must be drop, trigger, rank, modifier or launch_cards'];
  end if;

  -- audience
  if p_audience is null or jsonb_typeof(p_audience) <> 'object' then e := e || 'audience must be an object'::text;
  elsif p_audience = '{}'::jsonb then e := e || 'audience: choose everyone or at least one filter'::text;
  elsif p_kind = 'modifier' and p_audience <> '{"all": true}'::jsonb then e := e || 'audience: a modifier event changes the game for everyone (audience must be {"all": true})'::text;
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
                               when 'modifier' then array[]::text[] else array['settings_key', 'gift_reasons'] end;
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
end $function$;

-- ============================================================ 3. the library and the new events columns
create table if not exists public.event_templates (
  id              bigint generated always as identity primary key,
  name            text not null unique check (length(trim(name)) between 1 and 80),
  kind            text not null check (kind in ('drop', 'trigger', 'rank', 'modifier')),
  description     text not null default '' check (length(description) <= 1000),
  audience        jsonb not null default '{"all": true}',
  rewards         jsonb not null default '{}',
  rules           jsonb not null default '{}',
  vars            jsonb not null default '{}',
  theme           jsonb not null default '{}',
  default_length  interval not null check (default_length > interval '0' and default_length <= interval '62 days'),
  source_event_id bigint references public.events(id),
  created_by      text not null check (length(trim(created_by)) > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint event_templates_shape check (cardinality(public.event_shape_errors(kind, audience, rewards, rules)) = 0),
  constraint event_templates_theme check (cardinality(public.event_theme_errors(theme)) = 0)
);
alter table public.event_templates enable row level security;
revoke all on public.event_templates from anon, authenticated;
drop trigger if exists event_templates_touch on public.event_templates;
create trigger event_templates_touch before update on public.event_templates for each row execute function public.events_touch();

alter table public.events add column if not exists vars jsonb not null default '{}';
alter table public.events add column if not exists theme jsonb not null default '{}';
alter table public.events add column if not exists template_id bigint references public.event_templates(id);
alter table public.events add column if not exists repeat_id bigint;
alter table public.events drop constraint if exists events_kind_check;
alter table public.events add constraint events_kind_check check (kind in ('drop', 'trigger', 'rank', 'modifier', 'launch_cards'));
alter table public.events drop constraint if exists events_theme;
alter table public.events add constraint events_theme check (cardinality(public.event_theme_errors(theme)) = 0);
-- The game_var read: the live events that change a variable.
create index if not exists events_live_vars on public.events (starts_at) where status = 'live' and vars <> '{}'::jsonb;

-- The registry check of vars (a trigger, not a CHECK: it reads event_vars). Runs when the kind or the vars change, so a later
-- change of a limit does not lock an old event (game_var keeps every value inside the current limits).
create or replace function public.events_vars_check() returns trigger
language plpgsql set search_path = public as $$
declare e text[];
begin
  e := event_vars_errors(new.kind, new.vars);
  if cardinality(e) > 0 then
    raise exception using errcode = 'check_violation', message = format('%s: %s', tg_table_name, array_to_string(e, '; '));
  end if;
  return new;
end $$;
drop trigger if exists events_vars_check on public.events;
create trigger events_vars_check before insert or update of kind, vars on public.events for each row execute function public.events_vars_check();
drop trigger if exists event_templates_vars_check on public.event_templates;
create trigger event_templates_vars_check before insert or update of kind, vars on public.event_templates for each row execute function public.events_vars_check();

-- ============================================================ 4. the reader
create or replace function public.game_var(p_key text, p_now timestamptz default now())
returns numeric language plpgsql stable set search_path = public as $$
declare v event_vars; base numeric; x numeric; acc numeric; n int := 0;
begin
  select * into v from event_vars where key = p_key;
  if not found then raise exception 'game_var: % is not a variable (event_vars)', p_key; end if;
  base := case when v.balance_path is null then 1 else balance_num(v.balance_key, variadic v.balance_path) end;
  for x in select (e.vars->>p_key)::numeric from events e
            where e.status = 'live' and e.vars <> '{}'::jsonb and e.starts_at <= p_now and e.ends_at > p_now and e.vars ? p_key loop
    n := n + 1;
    acc := case when n = 1 then x when v.combine = 'multiply' then acc * x else greatest(acc, x) end;
  end loop;
  if n = 0 then return base; end if;
  acc := least(greatest(acc, v.min_value), v.max_value);
  x := case v.combine when 'multiply' then base * acc else greatest(base, acc) end;
  return case when v.whole then round(x) else x end;
end $$;

create or replace function public.game_vars(p_now timestamptz default now())
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(v.key, game_var(v.key, p_now) order by v.key), '{}') from event_vars v;
$$;

-- balance pulls with pull_rare_mult: each rate that is not normal x the factor; normal = 1 - their sum (never below 0: when
-- the rare rates would pass 1, they are scaled down to add up to 1).
create or replace function public.game_pull_rates(p_now timestamptz default now())
returns jsonb language plpgsql stable set search_path = public as $$
declare p jsonb := balance_get('pulls'); f numeric := game_var('pull_rare_mult', p_now); r jsonb; s numeric;
begin
  select coalesce(jsonb_object_agg(j.key, (j.value #>> '{}')::numeric * f), '{}'), coalesce(sum((j.value #>> '{}')::numeric * f), 0)
    into r, s from jsonb_each(p->'rates') j where j.key <> 'normal';
  if s > 1 then
    select jsonb_object_agg(j.key, (j.value #>> '{}')::numeric / s) into r from jsonb_each(r) j;
    s := 1;
  end if;
  return jsonb_build_object('pack_size', p->'pack_size', 'rare_mult', f, 'rates', r || jsonb_build_object('normal', 1 - s));
end $$;

-- ============================================================ 5. the changed event functions
-- event_pay: a modifier is never paid (vars only).
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
  if e.kind in ('launch_cards', 'modifier') then return jsonb_build_object('paid', false, 'error', 'not_paid_here'); end if;
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

-- event_row_errors: the 6-argument shapes (vars and theme too). A candidate with no vars or theme counts as {}.
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
  if cardinality(e) = 0 and p_e.kind <> 'launch_cards' then
    v_cards := array(select (p_e.rewards->'per_member'->>'card_id')::bigint where p_e.rewards->'per_member'->>'card_id' is not null
                     union select (t->>'card_id')::bigint from jsonb_array_elements(coalesce(p_e.rewards->'ranks', '[]')) t where t->>'card_id' is not null);
    if exists (select 1 from unnest(v_cards) c where not exists (select 1 from cards x where x.id = c)) then e := e || 'rewards: a card id does not exist'::text; end if;
  end if;
  return e;
end $function$;

-- admin_event_save: vars and theme are editable; a live event may change its title, description, end, vars and theme
-- (Nathan 2026-10-11). template_id is set only when the event is made (admin_event_from_template).
CREATE OR REPLACE FUNCTION public.admin_event_save(p_event jsonb, p_expected_updated_at timestamp with time zone, p_actor text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare e events; c events; v_errors text[]; v_fields jsonb; v_id bigint; k text;
  editable constant text[] := array['key', 'kind', 'title', 'description', 'starts_at', 'ends_at', 'audience', 'rewards', 'rules', 'vars', 'theme', 'template_id'];
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
      c.vars := coalesce(c.vars, '{}'); c.theme := coalesce(c.theme, '{}');
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
    if c.template_id is distinct from e.template_id then
      return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array('template_id is set only when the event is made'));
    end if;
    if e.status = 'scheduled' and (c.key is distinct from e.key or c.kind is distinct from e.kind) then
      return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array('the key and the kind change only in a draft'));
    end if;
    if e.status = 'live' and (c.key, c.kind, c.starts_at, c.audience, c.rewards, c.rules) is distinct from (e.key, e.kind, e.starts_at, e.audience, e.rewards, e.rules) then
      return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array('a live event changes only its title, description, end, variables and theme'));
    end if;
    if e.status = 'live' and c.ends_at is distinct from e.ends_at and c.ends_at <= now() then
      return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('the end of a live event must be after now (use End now)'));
    end if;
  elsif c.template_id is not null and not exists (select 1 from event_templates t where t.id = c.template_id) then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('template_id: no such template'));
  end if;
  if c.kind = 'launch_cards' then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('kind launch_cards is only the migrated launch event')); end if;
  v_errors := event_row_errors(c);
  if cardinality(v_errors) > 0 then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', to_jsonb(v_errors)); end if;

  perform set_config('events.actor', p_actor, true);
  if v_id is null then
    insert into events (key, kind, title, description, status, starts_at, ends_at, audience, rewards, rules, vars, theme, template_id, created_by)
      values (c.key, c.kind, trim(c.title), c.description, 'draft', c.starts_at, c.ends_at, c.audience, c.rewards, c.rules, c.vars, c.theme, c.template_id, p_actor)
      returning * into c;
  else
    update events set key = c.key, kind = c.kind, title = trim(c.title), description = c.description, starts_at = c.starts_at, ends_at = c.ends_at,
                      audience = c.audience, rewards = c.rewards, rules = c.rules, vars = c.vars, theme = c.theme
     where id = v_id returning * into c;
  end if;
  perform set_config('events.actor', '', true);
  perform admin_log_action(p_actor, case when v_id is null then 'event_create' else 'event_edit' end, 'event', c.id::text,
    case when v_id is null then null else to_jsonb(e) end, to_jsonb(c), p_reason, 'studio');
  return jsonb_build_object('ok', true, 'event', to_jsonb(c));
end $function$;

-- ============================================================ 6. the library (Admin, service role only)
-- The errors of a candidate template: name (unique), description, default length, the 6 shapes, the reward cards exist.
create or replace function public.event_template_errors(p_t public.event_templates)
returns text[] language plpgsql stable set search_path = public as $$
declare e text[] := '{}'; v_cards bigint[];
begin
  if p_t.name is null or length(trim(p_t.name)) not between 1 and 80 then e := e || 'name: 1 to 80 characters'::text;
  elsif exists (select 1 from event_templates x where x.name = trim(p_t.name) and x.id is distinct from p_t.id) then e := e || 'name: another template has this name'::text; end if;
  if length(coalesce(p_t.description, '')) > 1000 then e := e || 'description: at most 1000 characters'::text; end if;
  if p_t.default_length is null or p_t.default_length <= interval '0' or p_t.default_length > interval '62 days' then
    e := e || 'default_length: more than 0 and at most 62 days'::text;
  end if;
  if p_t.kind is null or p_t.kind not in ('drop', 'trigger', 'rank', 'modifier') then e := e || 'kind must be drop, trigger, rank or modifier'::text;
  else e := e || event_shape_errors(p_t.kind, p_t.audience, p_t.rewards, p_t.rules, coalesce(p_t.vars, '{}'), coalesce(p_t.theme, '{}')); end if;
  if cardinality(e) = 0 then
    v_cards := array(select (p_t.rewards->'per_member'->>'card_id')::bigint where p_t.rewards->'per_member'->>'card_id' is not null
                     union select (t->>'card_id')::bigint from jsonb_array_elements(coalesce(p_t.rewards->'ranks', '[]')) t where t->>'card_id' is not null);
    if exists (select 1 from unnest(v_cards) c where not exists (select 1 from cards x where x.id = c)) then e := e || 'rewards: a card id does not exist'::text; end if;
  end if;
  return e;
end $$;

create or replace function public.admin_event_templates()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('rows', coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('events', (select count(*) from events e where e.template_id = t.id))
                                                order by t.name, t.id), '[]'))
    from event_templates t;
$$;

-- Save a new template (no id) or an edit (optimistic check on updated_at). source_event_id only on a new template.
create or replace function public.admin_event_template_save(p_template jsonb, p_expected_updated_at timestamptz, p_actor text, p_reason text default null)
returns jsonb language plpgsql set search_path = public as $$
declare t event_templates; c event_templates; v_errors text[]; v_id bigint; k text;
  editable constant text[] := array['name', 'kind', 'description', 'audience', 'rewards', 'rules', 'vars', 'theme', 'default_length', 'source_event_id'];
begin
  if coalesce(trim(p_actor), '') = '' then raise exception 'admin_event_template_save: the actor is required'; end if;
  if p_template is null or jsonb_typeof(p_template) <> 'object' then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('the template must be an object')); end if;
  for k in select jsonb_object_keys(p_template) loop
    if k <> 'id' and not k = any(editable) then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array(format('%s cannot be set', k))); end if;
  end loop;
  begin
    v_id := (p_template->>'id')::bigint;
    if v_id is null then
      c := jsonb_populate_record(null::event_templates, (p_template - 'id') || jsonb_build_object('created_by', p_actor));
      c.audience := coalesce(c.audience, '{"all": true}'); c.rewards := coalesce(c.rewards, '{}'); c.rules := coalesce(c.rules, '{}');
      c.vars := coalesce(c.vars, '{}'); c.theme := coalesce(c.theme, '{}'); c.description := coalesce(c.description, '');
      if c.source_event_id is not null and not exists (select 1 from events e where e.id = c.source_event_id) then
        return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('source_event_id: no such event'));
      end if;
    else
      select * into t from event_templates where id = v_id for update;
      if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
      c := jsonb_populate_record(t, p_template - 'id');
      if t.updated_at is distinct from p_expected_updated_at then return jsonb_build_object('ok', false, 'error', 'stale', 'template', to_jsonb(t)); end if;
      if c.source_event_id is distinct from t.source_event_id then
        return jsonb_build_object('ok', false, 'error', 'locked', 'errors', jsonb_build_array('source_event_id is set only when the template is made'));
      end if;
    end if;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range or interval_field_overflow then
    return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('a value has the wrong type: ' || sqlerrm));
  end;
  v_errors := event_template_errors(c);
  if cardinality(v_errors) > 0 then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', to_jsonb(v_errors)); end if;
  if v_id is null then
    insert into event_templates (name, kind, description, audience, rewards, rules, vars, theme, default_length, source_event_id, created_by)
      values (trim(c.name), c.kind, c.description, c.audience, c.rewards, c.rules, c.vars, c.theme, c.default_length, c.source_event_id, p_actor)
      returning * into c;
  else
    update event_templates set name = trim(c.name), kind = c.kind, description = c.description, audience = c.audience, rewards = c.rewards,
                               rules = c.rules, vars = c.vars, theme = c.theme, default_length = c.default_length
     where id = v_id returning * into c;
  end if;
  perform admin_log_action(p_actor, case when v_id is null then 'event_template_create' else 'event_template_edit' end, 'event_template', c.id::text,
    case when v_id is null then null else to_jsonb(t) end, to_jsonb(c), p_reason, 'studio');
  return jsonb_build_object('ok', true, 'template', to_jsonb(c));
end $$;

-- "Save as template": a new template from an event (its kind, description, audience, rewards, rules, vars, theme; the
-- default length = its window). The launch event cannot be a template.
create or replace function public.admin_event_template_from_event(p_event_id bigint, p_name text, p_actor text, p_reason text default null)
returns jsonb language plpgsql set search_path = public as $$
declare e events;
begin
  select * into e from events where id = p_event_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if e.kind = 'launch_cards' then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('the launch event cannot be a template')); end if;
  return admin_event_template_save(jsonb_build_object('name', p_name, 'kind', e.kind, 'description', e.description, 'audience', e.audience,
    'rewards', e.rewards, 'rules', e.rules, 'vars', e.vars, 'theme', e.theme, 'default_length', (e.ends_at - e.starts_at)::text,
    'source_event_id', e.id), null, p_actor, p_reason);
end $$;

-- A new DRAFT event from a template: starts at p_starts_at, ends default_length later, title = p_title or the template name.
-- The event is a copy: a later change to the event or to the template does not change the other.
create or replace function public.admin_event_from_template(p_template_id bigint, p_key text, p_starts_at timestamptz, p_actor text, p_title text default null, p_reason text default null)
returns jsonb language plpgsql set search_path = public as $$
declare t event_templates;
begin
  select * into t from event_templates where id = p_template_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_starts_at is null then return jsonb_build_object('ok', false, 'error', 'invalid', 'errors', jsonb_build_array('the start is required')); end if;
  return admin_event_save(jsonb_build_object('key', p_key, 'kind', t.kind, 'title', coalesce(nullif(trim(p_title), ''), t.name), 'description', t.description,
    'starts_at', p_starts_at, 'ends_at', p_starts_at + t.default_length, 'audience', t.audience, 'rewards', t.rewards, 'rules', t.rules,
    'vars', t.vars, 'theme', t.theme, 'template_id', t.id), null, p_actor, p_reason);
end $$;

-- ============================================================ 7. the lockdown (lockdown_grants.sql pattern)
revoke all on function public.event_vars_base_check(), public.event_vars_errors(text, jsonb), public.event_theme_errors(jsonb),
  public.event_shape_errors(text, jsonb, jsonb, jsonb, jsonb, jsonb), public.events_vars_check(), public.game_var(text, timestamptz),
  public.game_vars(timestamptz), public.game_pull_rates(timestamptz), public.event_template_errors(public.event_templates),
  public.admin_event_templates(), public.admin_event_template_save(jsonb, timestamptz, text, text),
  public.admin_event_template_from_event(bigint, text, text, text), public.admin_event_from_template(bigint, text, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.event_vars_errors(text, jsonb), public.event_theme_errors(jsonb),
  public.event_shape_errors(text, jsonb, jsonb, jsonb, jsonb, jsonb), public.game_var(text, timestamptz),
  public.game_vars(timestamptz), public.game_pull_rates(timestamptz), public.event_template_errors(public.event_templates),
  public.admin_event_templates(), public.admin_event_template_save(jsonb, timestamptz, text, text),
  public.admin_event_template_from_event(bigint, text, text, text), public.admin_event_from_template(bigint, text, timestamptz, text, text, text)
  to service_role;

-- ============================================================ 8. the pg_cron job: every minute (was every 10 minutes)
do $c$ begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule('event-tick') where exists (select 1 from cron.job where jobname = 'event-tick');
    perform cron.schedule('event-tick', '* * * * *', 'select public.event_tick();');
  end if;
end $c$;

-- ============================================================ comments
comment on table public.event_vars is $c$[events] The registry of the game variables that an event can change (event_vars.sql, F-1): key, label, note, the balance key and json path of the base value (balance_path null = a factor of the whole key, base 1), how live events combine (multiply or max), the limits of an event value, whole numbers. Only these keys can go into events.vars. game_var reads it. Server only.$c$;
comment on column public.event_vars.key is $c$The variable name in events.vars and game_var (3 to 48 characters a-z, 0-9, _), for example pull_rare_mult.$c$;
comment on column public.event_vars.label is $c$The short name for the Admin view (1 to 60 characters).$c$;
comment on column public.event_vars.note is $c$What the variable changes and who reads it (1 to 1000 characters).$c$;
comment on column public.event_vars.balance_key is $c$The balance key that holds the base value (balance.key).$c$;
comment on column public.event_vars.balance_path is $c$The json path of the base number in the balance value ('{}' = the whole value). Null = a factor of the whole key: the base is 1 and the reader applies it (for example game_pull_rates). A path must point at a number (event_vars_base_check).$c$;
comment on column public.event_vars.combine is $c$How live events combine: multiply (base x the product of the event factors) or max (the base or the largest event value, whichever is larger). A factor variable (no path) is always multiply.$c$;
comment on column public.event_vars.min_value is $c$The smallest value an event may set (a factor for multiply). game_var keeps the combined event part inside min_value..max_value.$c$;
comment on column public.event_vars.max_value is $c$The largest value an event may set (a factor for multiply). game_var keeps the combined event part inside min_value..max_value.$c$;
comment on column public.event_vars.whole is $c$True: game_var rounds the result; the event value of a whole max variable must be a whole number (a multiply value is a factor and may be a fraction).$c$;
comment on column public.event_vars.updated_at is $c$The time of the last change (event_vars_base_check).$c$;
comment on table public.event_templates is $c$[events] The event library (F-1 item 0): a saved event to schedule again. name, kind (drop, trigger, rank, modifier), description, audience, rewards, rules, vars, theme (the shapes of events) and default_length. admin_event_from_template makes a draft event from it (events.template_id); a change to one never changes the other. Server only.$c$;
comment on column public.event_templates.id is $c$The template id. events.template_id points at it.$c$;
comment on column public.event_templates.name is $c$The unique library name (1 to 80 characters), also the default title of an event made from it.$c$;
comment on column public.event_templates.kind is $c$drop, trigger, rank or modifier (the kinds of events; not launch_cards).$c$;
comment on column public.event_templates.description is $c$A note for the admin (at most 1000 characters), copied to the event.$c$;
comment on column public.event_templates.audience is $c$The audience of the events made from it (the shape of events.audience).$c$;
comment on column public.event_templates.rewards is $c$The rewards (the shape of events.rewards).$c$;
comment on column public.event_templates.rules is $c$The rules of the kind (the shape of events.rules).$c$;
comment on column public.event_templates.vars is $c$The variables that the events change (the shape of events.vars, checked against event_vars by the trigger event_templates_vars_check).$c$;
comment on column public.event_templates.theme is $c$The theme (the shape of events.theme).$c$;
comment on column public.event_templates.default_length is $c$The length of an event made from it (ends_at = starts_at + this; more than 0, at most 62 days).$c$;
comment on column public.event_templates.source_event_id is $c$The event it was saved from ("save as template"), else null.$c$;
comment on column public.event_templates.created_by is $c$Who made the template (the studio actor).$c$;
comment on column public.event_templates.created_at is $c$When the template was made.$c$;
comment on column public.event_templates.updated_at is $c$The time of the last change (events_touch). admin_event_template_save refuses an edit of a changed row as stale.$c$;
comment on column public.events.vars is $c$The game variables that the event changes while it is live, {key: number}: registered keys only (event_vars), inside their limits (the trigger events_vars_check). game_var combines the live events. A live event can change it; event_log records each change.$c$;
comment on column public.events.theme is $c$The look of the event: name (1-40), color (#RRGGBB), art (an https URL), banner (1-120). Checked by event_theme_errors. A live event can change it.$c$;
comment on column public.events.template_id is $c$The library entry it was made from (event_templates.id), else null. Set only when the event is made.$c$;
comment on column public.events.repeat_id is $c$The repeat rule that made it. Null: F-1 PR 2 adds event_repeats and the foreign key; nothing writes it yet.$c$;
comment on table public.events is $c$[events] One row per event (events.sql, event_vars.sql): key, kind (drop, trigger, rank, modifier, launch_cards), title, description, status (draft, scheduled, live, ended, cancelled), the window starts_at .. ends_at, audience, rewards and rules (jsonb; the shapes are in events.sql and checked by event_shape_errors), vars (game variables, event_vars) and theme, template_id. The Admin view writes it (admin_event_save, admin_event_schedule, admin_event_cancel, admin_event_end_now, admin_event_from_template); event_tick moves the status by time and pays. Every change writes event_log. Server only.$c$;
comment on column public.events.kind is $c$drop (paid at the start to the audience), trigger (paid once to each audience member who does rules.trigger in the window), rank (paid once at the end by rank of rules.metric), modifier (vars only: changes game variables while live, audience everyone, never paid), launch_cards (the migrated launch event: its own functions pay it, never the tick).$c$;
comment on function public.event_vars_base_check() is $c$[events] Trigger (before insert, update on event_vars): a variable with a balance_path must point at a number in balance (balance_num); sets updated_at.$c$;
comment on function public.event_vars_errors(text, jsonb) is $c$[events] The errors of an event's vars: an object of registered keys (event_vars) with numbers inside the limits (whole numbers for a whole max variable); a modifier needs at least one, the launch event none. Empty = valid. Reads the registry.$c$;
comment on function public.event_theme_errors(jsonb) is $c$[events] The errors of an event's theme: only name (1-40), color (#RRGGBB), art (an https URL, at most 500) and banner (1-120). Empty = valid. The CHECKs events_theme and event_templates_theme use it.$c$;
comment on function public.event_shape_errors(text, jsonb, jsonb, jsonb, jsonb, jsonb) is $c$[events] All shape errors of an event: the 4 shapes (kind, audience, rewards, rules) + vars (event_vars_errors) + theme (event_theme_errors). Empty = valid. event_row_errors and event_template_errors use it.$c$;
comment on function public.event_shape_errors(text, jsonb, jsonb, jsonb) is $c$[events] The errors of an event's kind, audience, rewards and rules (the shapes in events.sql; a modifier: audience everyone, rewards {}, rules {}). Empty = valid. The CHECK events_shape uses it; the Admin save uses the 6-argument form.$c$;
comment on function public.events_vars_check() is $c$[events] Trigger (before insert or update of kind or vars on events and event_templates): refuses vars that event_vars_errors rejects (an unknown key, a value outside the limits). A trigger, not a CHECK: it reads event_vars.$c$;
comment on function public.game_var(text, timestamp with time zone) is $c$[events] The value of one game variable at a time: the base from balance (or 1 for a factor), combined with the vars of every live event inside its window (multiply or max), the combined event part kept inside the limits, rounded for a whole variable. No live event = the balance value. Raises for an unknown key.$c$;
comment on function public.game_vars(timestamp with time zone) is $c$[events] Every game variable at a time, {key: game_var(key)}: the one call that the bot caches (F-1 PR 4).$c$;
comment on function public.game_pull_rates(timestamp with time zone) is $c$[events] balance pulls with the live pull_rare_mult: every rate that is not normal x the factor, normal = 1 - their sum (scaled to add up to 1 if they would pass 1). Returns pack_size, rare_mult and rates.$c$;
comment on function public.event_pay(bigint, text, timestamp with time zone) is $c$[events] Pays an event at a time through gift_claims (kind promo for packs and Shards, kind card, reason event, event_id set). start and end run once (event_payouts primary key); tick pays the members not paid yet. Writes event_payouts and event_log. Never pays launch_cards or modifier.$c$;
comment on function public.event_row_errors(public.events) is $c$[events] The errors of a candidate event row: key (format, unique), title, description, the times, the shapes with vars and theme (6-argument event_shape_errors) and that each reward card exists. Empty = valid.$c$;
comment on function public.event_tick(timestamp with time zone) is $c$[events] The pg_cron job event-tick (every minute since event_vars.sql): event_step for each scheduled or live event that started. One tick at a time (advisory lock). Returns the steps.$c$;
comment on function public.admin_event_save(jsonb, timestamp with time zone, text, text) is $c$[admin] Saves a new draft (no id) or an edit with an optimistic check (p_expected_updated_at must be the row's updated_at, else stale). Draft and scheduled: all fields (key and kind in a draft only); live: title, description, a later end, vars and theme (never start, kind, audience, rewards, rules). template_id only on a new event. Returns the errors of event_row_errors. Writes admin_actions and event_log. Service role only.$c$;
comment on function public.event_template_errors(public.event_templates) is $c$[events] The errors of a candidate template: name (1-80, unique), description, default_length (more than 0, at most 62 days), kind, the 6 shapes, the reward cards exist. Empty = valid.$c$;
comment on function public.admin_event_templates() is $c$[admin] The event library for the Admin view: every template by name, with the number of events made from it. Service role only.$c$;
comment on function public.admin_event_template_save(jsonb, timestamp with time zone, text, text) is $c$[admin] Saves a new template (no id) or an edit with an optimistic check on updated_at. Returns the errors of event_template_errors. Writes admin_actions. Service role only.$c$;
comment on function public.admin_event_template_from_event(bigint, text, text, text) is $c$[admin] Save as template: a new template from an event (kind, description, audience, rewards, rules, vars, theme; default_length = its window; source_event_id). Not the launch event. Service role only.$c$;
comment on function public.admin_event_from_template(bigint, text, timestamp with time zone, text, text, text) is $c$[admin] A new draft event from a template (admin_event_save): the key, the start, ends after default_length, title = p_title or the template name, template_id set. A copy: a later change to one does not change the other. Service role only.$c$;

notify pgrst, 'reload schema';
