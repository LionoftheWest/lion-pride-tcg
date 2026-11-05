-- evt2_event_triggers.sql (2026-11-05, EVT-2 B2): the two event cards of the Set 2 launch need two triggers
-- (items/EVT-2/SPEC.md v2.4, section 4 B2; Nathan 2026-11-05 Q9, Q10).
--   (a) event_shape_errors(text, jsonb, jsonb, jsonb) (the 4-argument one; the 6-argument one wraps it): the trigger app_visit is allowed.
--   (b) event_recipients, trigger app_visit (the WoW card "The Forever Queue", a login reward): the member has an app_sessions row with
--       started_at in [t0, t1). A visit that started before t0 does NOT count, also when it continues after t0 (Nathan Q9:
--       last_seen_at is not read). A new visit starts after a 30-minute gap (app_session_touch).
--   (c) event_recipients, trigger hunt_hit (the OoT card "Hand-Me-Down Hero", a Hunt reward): also a v1 support tap (combat_actions
--       mode 'hunt', created_at in [t0, t1)) and a v2 Hunt day (hunt_v2_days started_at OR ended_at in [t0, t1)); a tester practice
--       day on an ended Hunt (state.practice_ended, hunt_v2_start.sql) does not count. Before: only v1 hunt_hits and hunt_combat_log, which
--       a v2 Hunt never writes, so a hunt_hit event granted nobody in a v2 Hunt (defect D2).
-- Nothing else in the two functions changes. The undo: evt2_event_triggers_undo.sql (the base text). On a live rollback cancel the
-- 2 EVT-2 events first, then apply the undo. Test: card-studio/scripts/test-evt2-triggers.mjs (rolled back; MUTATE=all must FAIL
-- each mutation). Idempotent.

-- GUARD (the combat_core.sql rule): each replaced function must be the live text this file was built from, or the text of
-- evt2_event_triggers.sql (so a re-run and the undo are both allowed).
do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.event_recipients(public.events, timestamp with time zone)', '5247775127ebf8c582c710a705084e4a', 'a76865dd59671c79f943042333a91bcc'),
    ('public.event_shape_errors(text, jsonb, jsonb, jsonb)', '0fcac6e1d67c8d296f52f0d0b66ebd03', '75ac31010d0efaf14f282ebef294af2a')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'evt2_event_triggers.sql: the live % changed since this file was built (md5 %). Rebuild it from the live text.', f.fn, m;
    end if;
  end loop;
end $g$;
-- GUARD-END

CREATE OR REPLACE FUNCTION public.event_recipients(p_e events, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(member_id text, rank integer, score bigint, packs integer, shards integer, card_id bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
                         or exists (select 1 from combat_actions a where a.player_id = au.member_id and a.mode = 'hunt' and a.created_at >= t0 and a.created_at < t1)
                         or exists (select 1 from hunt_v2_days v where v.player_id = au.member_id and not coalesce((v.state->>'practice_ended')::boolean, false)
                                     and ((v.started_at >= t0 and v.started_at < t1) or (v.ended_at >= t0 and v.ended_at < t1)))
       when 'tutorial_done' then exists (select 1 from pack_ledger l where l.player_id = au.member_id and l.reason = 'tutorial' and l.created_at >= t0 and l.created_at < t1)
       when 'pack_opened' then exists (select 1 from pack_ledger l where l.player_id = au.member_id and l.reason = 'opened' and l.created_at >= t0 and l.created_at < t1)
       when 'dungeon_run' then exists (select 1 from dungeon_runs d where d.player_id = au.member_id and d.started_at >= t0 and d.started_at < t1)
       when 'app_visit' then exists (select 1 from app_sessions s where s.player_id = au.member_id and s.started_at >= t0 and s.started_at < t1)
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
end $function$;

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
  if p_kind = 'trigger' and coalesce(p_rules->>'trigger', '') not in ('hunt_hit', 'tutorial_done', 'pack_opened', 'dungeon_run', 'app_visit') then
    e := e || 'rules: trigger must be hunt_hit, tutorial_done, pack_opened, dungeon_run or app_visit'::text;
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

-- CHECK: both functions are the text of this file.
do $c$
begin
  if md5(replace(pg_get_functiondef('public.event_recipients(public.events, timestamp with time zone)'::regprocedure), chr(13), '')) <> 'a76865dd59671c79f943042333a91bcc' then
    raise exception 'evt2_event_triggers.sql: event_recipients is not the text of this file';
  end if;
  if md5(replace(pg_get_functiondef('public.event_shape_errors(text, jsonb, jsonb, jsonb)'::regprocedure), chr(13), '')) <> '75ac31010d0efaf14f282ebef294af2a' then
    raise exception 'evt2_event_triggers.sql: event_shape_errors is not the text of this file';
  end if;
end $c$;
