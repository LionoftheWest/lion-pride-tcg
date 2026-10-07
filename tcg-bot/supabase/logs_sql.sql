-- logs_sql.sql: more history in the database (Nathan, 2026-10-07: "record all those spots as well, I want to be
-- gathering as much data as possible"). Only new tables, triggers, two nullable columns and the retention numbers.
-- No guarded function is replaced: every log is a TRIGGER on the table, so every writer (the Activity, the bot,
-- SQL functions, the SQL editor) is recorded, also a writer that a later change adds.
--
--  1. settings_log     every insert, update (with a value change) and delete of a settings row.
--  2. profile_log      one row per changed profile field of a member (title, frame, spotlight, avatar, username,
--                      each top-level key of notify_prefs and of tutorial). Not pack_balance / shard_balance
--                      (pack_ledger and shard_ledger have them).
--  3. wishlist_log     add, remove, replace, set_top, unset_top on wishlists.
--  4. stat_point_log   one row per stat that changed on a copy (player_cards.stat_points): spend, reset, other.
--  5. admin_actions    the admin audit log of the Admin view Phase 2 + admin_log_action(). The bot admin gifts
--                      (/givepacks, /grantall, /grantall everyone) and SQL event gifts write a row now (a trigger
--                      on gift_claims for the reasons admin, event, launch_gift).
--  6. notifications.read_at  (nullable). The write path (the Activity marks a note read) is a separate change.
--  7. player_reports.target_id (nullable, FK players). The write path is a separate change.
--  8. prune_old_rows   keeps bell notes, posted hunt_events and ended discord_effects 365 days (was 30 / 90),
--                      cron run details 90 days (was 14). The new logs are never pruned.
--
-- Member data (ids, names, the member lists inside settings values) stays in these tables behind RLS. The API
-- roles have no grant (lockdown_grants.sql defaults; revoked here again). Who: balance_who() (the setting
-- balance.by, else the session user), the same rule as balance_log.
-- Test: card-studio/scripts/test-logs-sql.mjs. Idempotent.

-- ============================================================ 1. settings_log
create table if not exists public.settings_log (
  id         bigint generated always as identity primary key,
  key        text not null,
  op         text not null check (op in ('insert', 'update', 'delete')),
  old_value  jsonb,
  new_value  jsonb,
  changed_at timestamptz not null default now(),
  changed_by text not null
);
create index if not exists settings_log_key on public.settings_log (key, changed_at desc);
alter table public.settings_log enable row level security;
revoke all on public.settings_log from anon, authenticated;

create or replace function public.settings_log_write() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    insert into settings_log (key, op, old_value, new_value, changed_by) values (old.key, 'delete', old.value, null, balance_who());
    return old;
  end if;
  if tg_op = 'UPDATE' and old.value = new.value and old.key = new.key then return new; end if; -- only updated_at: no row
  insert into settings_log (key, op, old_value, new_value, changed_by)
    values (new.key, lower(tg_op), case when tg_op = 'UPDATE' then old.value end, new.value, balance_who());
  return new;
end $$;
drop trigger if exists settings_log_write on public.settings;
create trigger settings_log_write after insert or update or delete on public.settings
  for each row execute function public.settings_log_write();

-- ============================================================ 2. profile_log
create table if not exists public.profile_log (
  id         bigint generated always as identity primary key,
  player_id  text not null,
  field      text not null,
  old_value  jsonb,
  new_value  jsonb,
  changed_at timestamptz not null default now(),
  changed_by text not null
);
create index if not exists profile_log_player on public.profile_log (player_id, changed_at desc);
create index if not exists profile_log_field on public.profile_log (field, changed_at desc);
alter table public.profile_log enable row level security;
revoke all on public.profile_log from anon, authenticated;

create or replace function public.profile_log_write() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_by text := balance_who();
begin
  insert into profile_log (player_id, field, old_value, new_value, changed_by)
  select new.id, f.field, f.o, f.n, v_by
    from (values
      (1, 'username', to_jsonb(old.username), to_jsonb(new.username)),
      (2, 'avatar', to_jsonb(old.avatar), to_jsonb(new.avatar)),
      (3, 'title', to_jsonb(old.title), to_jsonb(new.title)),
      (4, 'frame', to_jsonb(old.frame), to_jsonb(new.frame)),
      (5, 'spotlight', to_jsonb(old.spotlight), to_jsonb(new.spotlight))) f(ord, field, o, n)
   where f.o is distinct from f.n order by f.ord;
  -- The two jsonb columns: one row per top-level key that changed (notify_prefs.all, tutorial.done, ...).
  -- A value that is not an object is logged as the whole column.
  if old.notify_prefs is distinct from new.notify_prefs then
    if jsonb_typeof(old.notify_prefs) = 'object' and jsonb_typeof(new.notify_prefs) = 'object' then
      insert into profile_log (player_id, field, old_value, new_value, changed_by)
      select new.id, 'notify_prefs.' || k2, old.notify_prefs -> k2, new.notify_prefs -> k2, v_by
        from (select jsonb_object_keys(old.notify_prefs) union select jsonb_object_keys(new.notify_prefs)) x(k2)
       where (old.notify_prefs -> k2) is distinct from (new.notify_prefs -> k2) order by k2;
    else
      insert into profile_log (player_id, field, old_value, new_value, changed_by) values (new.id, 'notify_prefs', old.notify_prefs, new.notify_prefs, v_by);
    end if;
  end if;
  if old.tutorial is distinct from new.tutorial then
    if jsonb_typeof(old.tutorial) = 'object' and jsonb_typeof(new.tutorial) = 'object' then
      insert into profile_log (player_id, field, old_value, new_value, changed_by)
      select new.id, 'tutorial.' || k2, old.tutorial -> k2, new.tutorial -> k2, v_by
        from (select jsonb_object_keys(old.tutorial) union select jsonb_object_keys(new.tutorial)) x(k2)
       where (old.tutorial -> k2) is distinct from (new.tutorial -> k2) order by k2;
    else
      insert into profile_log (player_id, field, old_value, new_value, changed_by) values (new.id, 'tutorial', old.tutorial, new.tutorial, v_by);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profile_log_write on public.players;
-- WHEN: the pack_balance / shard_balance updates (many each minute) do not call the function.
create trigger profile_log_write after update of username, avatar, title, frame, spotlight, notify_prefs, tutorial on public.players
  for each row when (old.username is distinct from new.username or old.avatar is distinct from new.avatar
    or old.title is distinct from new.title or old.frame is distinct from new.frame or old.spotlight is distinct from new.spotlight
    or old.notify_prefs is distinct from new.notify_prefs or old.tutorial is distinct from new.tutorial)
  execute function public.profile_log_write();

-- ============================================================ 3. wishlist_log
create table if not exists public.wishlist_log (
  id          bigint generated always as identity primary key,
  player_id   text not null,
  slot        int not null,
  op          text not null check (op in ('add', 'remove', 'replace', 'set_top', 'unset_top')),
  card_id     bigint,
  old_card_id bigint,
  changed_at  timestamptz not null default now(),
  changed_by  text not null
);
create index if not exists wishlist_log_player on public.wishlist_log (player_id, changed_at desc);
create index if not exists wishlist_log_card on public.wishlist_log (card_id, changed_at desc);
alter table public.wishlist_log enable row level security;
revoke all on public.wishlist_log from anon, authenticated;

create or replace function public.wishlist_log_write() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_by text := balance_who();
begin
  if tg_op = 'INSERT' then
    insert into wishlist_log (player_id, slot, op, card_id, changed_by) values (new.player_id, new.slot, 'add', new.card_id, v_by);
    if new.top then insert into wishlist_log (player_id, slot, op, card_id, changed_by) values (new.player_id, new.slot, 'set_top', new.card_id, v_by); end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into wishlist_log (player_id, slot, op, card_id, changed_by) values (old.player_id, old.slot, 'remove', old.card_id, v_by);
    return old;
  end if;
  if old.card_id is distinct from new.card_id then
    insert into wishlist_log (player_id, slot, op, card_id, old_card_id, changed_by) values (new.player_id, new.slot, 'replace', new.card_id, old.card_id, v_by);
  end if;
  if old.top is distinct from new.top then
    insert into wishlist_log (player_id, slot, op, card_id, changed_by)
      values (new.player_id, new.slot, case when new.top then 'set_top' else 'unset_top' end, new.card_id, v_by);
  end if;
  return new;
end $$;
drop trigger if exists wishlist_log_write on public.wishlists;
create trigger wishlist_log_write after insert or update or delete on public.wishlists
  for each row execute function public.wishlist_log_write();

-- ============================================================ 4. stat_point_log
-- The writers of player_cards.stat_points (2026-10-07, db/schema/functions): spend_stat_points (adds points),
-- reset_stat_points and buy_shop_item kind stat_reset (set '{}'). A row delete (the last copy leaves) loses the
-- points: reason other. The Activity and the bot only call the two RPCs. The trigger sees every writer.
create table if not exists public.stat_point_log (
  id         bigint generated always as identity primary key,
  player_id  text not null,
  card_id    bigint not null,
  stat       text not null,
  delta      numeric not null,
  points     numeric not null,
  reason     text not null check (reason in ('spend', 'reset', 'other')),
  changed_at timestamptz not null default now(),
  changed_by text not null
);
create index if not exists stat_point_log_player on public.stat_point_log (player_id, changed_at desc);
create index if not exists stat_point_log_card on public.stat_point_log (card_id, changed_at desc);
alter table public.stat_point_log enable row level security;
revoke all on public.stat_point_log from anon, authenticated;

create or replace function public.stat_point_log_write() returns trigger
language plpgsql set search_path to 'public' as $$
declare
  o jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else coalesce(old.stat_points, '{}'::jsonb) end;
  n jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else coalesce(new.stat_points, '{}'::jsonb) end;
  v_reason text;
begin
  if jsonb_typeof(o) <> 'object' then o := '{}'::jsonb; end if;
  if jsonb_typeof(n) <> 'object' then n := '{}'::jsonb; end if;
  -- The numbers of each stat key in old and new (a non-number counts as 0, so a strange value never blocks the write).
  with v as (
    select k,
           case when jsonb_typeof(o -> k) = 'number' then (o ->> k)::numeric else 0 end ov,
           case when jsonb_typeof(n -> k) = 'number' then (n ->> k)::numeric else 0 end nv
      from (select jsonb_object_keys(o) union select jsonb_object_keys(n)) x(k))
  select case
           when tg_op = 'UPDATE' and n = '{}'::jsonb and o <> '{}'::jsonb then 'reset'
           when tg_op = 'UPDATE' and bool_and(nv >= ov) and bool_or(nv > ov) then 'spend'
           else 'other' end
    into v_reason from v;
  insert into stat_point_log (player_id, card_id, stat, delta, points, reason, changed_by)
  select coalesce(new.player_id, old.player_id), coalesce(new.card_id, old.card_id), k, nv - ov, nv, v_reason, balance_who()
    from (select k,
                 case when jsonb_typeof(o -> k) = 'number' then (o ->> k)::numeric else 0 end ov,
                 case when jsonb_typeof(n -> k) = 'number' then (n ->> k)::numeric else 0 end nv
            from (select jsonb_object_keys(o) union select jsonb_object_keys(n)) x(k)) v
   where nv <> ov order by k;
  return null;
end $$;
drop trigger if exists stat_point_log_upd on public.player_cards;
drop trigger if exists stat_point_log_ins on public.player_cards;
drop trigger if exists stat_point_log_del on public.player_cards;
create trigger stat_point_log_upd after update of stat_points on public.player_cards
  for each row when (old.stat_points is distinct from new.stat_points) execute function public.stat_point_log_write();
create trigger stat_point_log_ins after insert on public.player_cards
  for each row when (new.stat_points <> '{}'::jsonb) execute function public.stat_point_log_write();
create trigger stat_point_log_del after delete on public.player_cards
  for each row when (old.stat_points <> '{}'::jsonb) execute function public.stat_point_log_write();

-- ============================================================ 5. admin_actions
create table if not exists public.admin_actions (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       text not null check (length(trim(actor)) > 0),
  action      text not null check (length(trim(action)) > 0),
  target_kind text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  source      text not null check (source in ('studio', 'bot', 'sql')),
  undo_of     bigint references public.admin_actions(id)
);
create index if not exists admin_actions_at on public.admin_actions (at desc);
create index if not exists admin_actions_target on public.admin_actions (target_kind, target_id, at desc);
-- An action is undone at most once (an undo of the undo is a new action with its own id).
create unique index if not exists admin_actions_one_undo on public.admin_actions (undo_of) where undo_of is not null;
alter table public.admin_actions enable row level security;
revoke all on public.admin_actions from anon, authenticated;

create or replace function public.admin_log_action(p_actor text, p_action text, p_target_kind text, p_target_id text,
  p_before jsonb, p_after jsonb, p_reason text, p_source text default 'studio', p_undo_of bigint default null)
returns bigint language plpgsql set search_path to 'public' as $$
declare v_id bigint;
begin
  insert into admin_actions (actor, action, target_kind, target_id, before, after, reason, source, undo_of)
    values (p_actor, p_action, p_target_kind, p_target_id, p_before, p_after, p_reason, coalesce(p_source, 'studio'), p_undo_of)
    returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.admin_log_action(text, text, text, text, jsonb, jsonb, text, text, bigint) from public, anon, authenticated;

-- The admin gifts: give_gift (reason admin: the bot /givepacks, from_id = the admin), give_gift_all and
-- give_shards_gift_all (reason event: /grantall, or SQL), gift_all_members (reason launch_gift: /grantall everyone).
-- One admin_actions row per statement and gift (one row for a whole /grantall, with every gift id).
-- Member gifts (gift_received, member_gift), welcome and automatic event:* card gifts are not admin actions.
create or replace function public.gift_admin_log() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  insert into admin_actions (actor, action, target_kind, target_id, after, reason, source)
  select coalesce(g.from_id, balance_who()), 'gift',
         case when count(*) = 1 then 'player' else 'players' end,
         case when count(*) = 1 then min(g.player_id) end,
         jsonb_build_object('kind', g.kind, 'title', g.title, 'amount', g.amount, 'shards', g.shards, 'count', count(*),
                            'gift_ids', jsonb_agg(g.id order by g.id)),
         g.reason,
         case when g.from_id is not null then 'bot' else 'sql' end
    from admin_gift_new g
   where g.reason in ('admin', 'event', 'launch_gift')
   group by g.from_id, g.kind, g.title, g.amount, g.shards, g.reason;
  return null;
end $$;
drop trigger if exists gift_admin_log on public.gift_claims;
create trigger gift_admin_log after insert on public.gift_claims
  referencing new table as admin_gift_new for each statement execute function public.gift_admin_log();

-- ============================================================ 6. and 7. columns for the other write paths
alter table public.notifications add column if not exists read_at timestamptz;
alter table public.player_reports add column if not exists target_id text references public.players(id) on delete set null;
create index if not exists player_reports_target on public.player_reports (target_id) where target_id is not null;

-- ============================================================ 8. retention (prune_old_rows.sql, not md5-guarded)
-- Measured on live 2026-10-07 (database 35 MB of 500 MB; 6.5 days since the launch reset): about 51 bell notes,
-- 10 hunt_events, 13 discord_effects and 183 cron runs per day. 365 days of the three game tables is about 8 MB.
create or replace function public.prune_old_rows()
 returns jsonb
 language plpgsql
 security invoker
 set search_path to 'public'
as $$
declare n_notes int; n_events int; n_fx int; n_cron int;
begin
  delete from public.notifications
   where created_at < now() - interval '365 days';
  get diagnostics n_notes = row_count;

  delete from public.hunt_events
   where posted_at is not null and posted_at < now() - interval '365 days';
  get diagnostics n_events = row_count;

  delete from public.discord_effects
   where status in ('done', 'reverted', 'skipped', 'failed')
     and updated_at < now() - interval '365 days' and created_at < now() - interval '365 days';
  get diagnostics n_fx = row_count;

  delete from cron.job_run_details
   where status <> 'running' and coalesce(end_time, start_time) < now() - interval '90 days';
  get diagnostics n_cron = row_count;

  return jsonb_build_object('notifications', n_notes, 'hunt_events', n_events,
    'discord_effects', n_fx, 'cron_job_run_details', n_cron);
end $$;
revoke execute on function public.prune_old_rows() from public, anon, authenticated;
do $c$ begin
  perform cron.unschedule('prune-old-rows') where exists (select 1 from cron.job where jobname = 'prune-old-rows');
  perform cron.schedule('prune-old-rows', '30 10 * * *', 'select prune_old_rows();');
end $c$;

-- ============================================================ comments (the same text is in db_comments.sql)
comment on table public.settings_log is $c$One row per insert, change or delete of a settings row (the settings_log_write trigger). A changed value is required: an equal value writes no row. Some values hold member id lists (discord_immune, ui_v3.users): server only.$c$;
comment on column public.settings_log.id is $c$The log row id.$c$;
comment on column public.settings_log.key is $c$The settings key that changed (settings.key).$c$;
comment on column public.settings_log.op is $c$insert, update (a changed value) or delete.$c$;
comment on column public.settings_log.old_value is $c$The value before the change. Null for an insert.$c$;
comment on column public.settings_log.new_value is $c$The value after the change. Null for a delete.$c$;
comment on column public.settings_log.changed_at is $c$When the change was made.$c$;
comment on column public.settings_log.changed_by is $c$Who made the change: balance_who (the setting balance.by, else the session user).$c$;
comment on function public.settings_log_write() is $c$Trigger (after insert, update, delete on settings): writes a settings_log row with the old value, the new value and balance_who. Writes nothing when the value did not change.$c$;

comment on table public.profile_log is $c$One row per changed profile field of a member (the profile_log_write trigger on players): username, avatar, title, frame, spotlight, and each top-level key of notify_prefs and tutorial (notify_prefs.<key>, tutorial.<key>). Not the pack or Shard balance (the ledgers). Server only.$c$;
comment on column public.profile_log.id is $c$The log row id.$c$;
comment on column public.profile_log.player_id is $c$The member (players.id). No foreign key: the history stays.$c$;
comment on column public.profile_log.field is $c$The field: username, avatar, title, frame, spotlight, notify_prefs.<key> or tutorial.<key> (the whole column notify_prefs or tutorial when it is not a jsonb object).$c$;
comment on column public.profile_log.old_value is $c$The value before the change as jsonb (null = no value).$c$;
comment on column public.profile_log.new_value is $c$The value after the change as jsonb (null = no value).$c$;
comment on column public.profile_log.changed_at is $c$When the change was made.$c$;
comment on column public.profile_log.changed_by is $c$Who made the change: balance_who (the setting balance.by, else the session user; the Activity and the bot show as authenticator).$c$;
comment on function public.profile_log_write() is $c$Trigger (after a players row change with a new username, avatar, title, frame, spotlight, notify_prefs or tutorial): writes one profile_log row per changed field and per changed top-level key of notify_prefs and tutorial.$c$;

comment on table public.wishlist_log is $c$One row per wishlist change (the wishlist_log_write trigger on wishlists): add, remove, replace (another card in the slot), set_top, unset_top. Server only.$c$;
comment on column public.wishlist_log.id is $c$The log row id.$c$;
comment on column public.wishlist_log.player_id is $c$The member (players.id). No foreign key: the history stays.$c$;
comment on column public.wishlist_log.slot is $c$The wishlist slot (1 to 5).$c$;
comment on column public.wishlist_log.op is $c$add, remove, replace, set_top or unset_top.$c$;
comment on column public.wishlist_log.card_id is $c$The card in the slot after the change (for remove: the card that left).$c$;
comment on column public.wishlist_log.old_card_id is $c$For replace: the card that was in the slot before. Else null.$c$;
comment on column public.wishlist_log.changed_at is $c$When the change was made.$c$;
comment on column public.wishlist_log.changed_by is $c$Who made the change: balance_who (the setting balance.by, else the session user).$c$;
comment on function public.wishlist_log_write() is $c$Trigger (after insert, update, delete on wishlists): writes wishlist_log rows (add, remove, replace, set_top, unset_top).$c$;

comment on table public.stat_point_log is $c$One row per stat that changed on an owned card (player_cards.stat_points, the stat_point_log_* triggers): spend (spend_stat_points), reset (reset_stat_points, buy_shop_item stat_reset), other (any other change, for example the player_cards row deleted). Server only.$c$;
comment on column public.stat_point_log.id is $c$The log row id.$c$;
comment on column public.stat_point_log.player_id is $c$The member (players.id). No foreign key: the history stays.$c$;
comment on column public.stat_point_log.card_id is $c$The card (cards.id).$c$;
comment on column public.stat_point_log.stat is $c$The stat key in stat_points: attack, vitality, precision, potency or haste.$c$;
comment on column public.stat_point_log.delta is $c$The change of the points of this stat (positive = spent, negative = reset or removed).$c$;
comment on column public.stat_point_log.points is $c$The points of this stat after the change.$c$;
comment on column public.stat_point_log.reason is $c$spend (all stats up or the same), reset (all points to {}), other (any other change, a new row with points, a deleted row).$c$;
comment on column public.stat_point_log.changed_at is $c$When the change was made.$c$;
comment on column public.stat_point_log.changed_by is $c$Who made the change: balance_who (the setting balance.by, else the session user).$c$;
comment on function public.stat_point_log_write() is $c$Trigger (on player_cards: after a change of stat_points, a new row or a deleted row with stat_points not empty): writes one stat_point_log row per changed stat with the reason spend, reset or other.$c$;

comment on table public.admin_actions is $c$[admin] The admin audit log: one row per admin action (who, what, the target, before and after, why, where from, which action it undoes). admin_log_action writes it for the Admin view; the gift_admin_log trigger writes the admin gifts (reasons admin, event, launch_gift). Server only.$c$;
comment on column public.admin_actions.id is $c$The action id. undo_of points at it.$c$;
comment on column public.admin_actions.at is $c$When the action was made.$c$;
comment on column public.admin_actions.actor is $c$Who made it: the admin (the Discord id from the bot or the studio), else balance_who for SQL.$c$;
comment on column public.admin_actions.action is $c$What was done, for example gift (gift_admin_log) or the Admin view action name.$c$;
comment on column public.admin_actions.target_kind is $c$The kind of target, for example player (one member), players (many members), card, balance, settings. Null = none.$c$;
comment on column public.admin_actions.target_id is $c$The target id as text (for player: players.id). Null for many targets (after.count and after.gift_ids list them).$c$;
comment on column public.admin_actions.before is $c$The state before the action as jsonb (for an undo). Null = not recorded.$c$;
comment on column public.admin_actions.after is $c$The state after the action as jsonb. For a gift: kind, title, amount, shards, count, gift_ids.$c$;
comment on column public.admin_actions.reason is $c$Why: the text of the admin, or the gift reason (admin, event, launch_gift).$c$;
comment on column public.admin_actions.source is $c$Where it came from: studio (the Admin view), bot (an admin slash command), sql (the SQL editor or a script).$c$;
comment on column public.admin_actions.undo_of is $c$The action that this action undoes (admin_actions.id), else null. An action is undone at most once (admin_actions_one_undo).$c$;
comment on function public.admin_log_action(text, text, text, text, jsonb, jsonb, text, text, bigint) is $c$[admin] Writes one admin_actions row and returns its id: actor, action, target kind and id, before, after, reason, source (studio, bot or sql; default studio), undo_of. Refuses an empty actor or action, a bad source and a second undo of one action. Service role only.$c$;
comment on function public.gift_admin_log() is $c$[admin] Trigger (after insert on gift_claims, once per statement): writes one admin_actions row per admin gift group of the statement (reasons admin, event, launch_gift), with the gift ids. The actor is from_id (the admin, source bot), else balance_who (source sql).$c$;

comment on column public.notifications.read_at is $c$When the member read the note. Null = unread, or read before the write path existed (the column came 2026-10-07; the Activity write path is a separate change).$c$;
comment on column public.player_reports.target_id is $c$The member that the report is about (players.id), else null. Null when that member row is deleted.$c$;
comment on function public.prune_old_rows() is $c$Deletes old rows: bell notes after 365 days, posted hunt_events after 365, ended discord_effects after 365, cron run details after 90 (logs_sql.sql, 2026-10-07; was 30 / 90 / 30 / 30 / 14). The logs (settings_log, profile_log, wishlist_log, stat_point_log, admin_actions) are never pruned. The pg_cron job prune-old-rows runs it each day. Returns the counts.$c$;

notify pgrst, 'reload schema';
