-- combat_v2_progress_tables.sql (2026-10-23): combat v2 step M1a, the storage of the v2 card progress and its ledger
-- (docs/combat-redesign-plan.md 2.2 to 2.4, 11 and 20.11). Needs combat_v2_flags_balance.sql (the balance keys v2_level, v2_stats and
-- card_level) and combat_v2_stats.sql (E3: the 9 point keys of card_combat_v2).
-- Before: no table, column or function holds a card level, XP or v2 points (the v1 points are player_cards.stat_points).
-- After this file:
--   card_progress_v2: one row for each player_cards row that has v2 progress (none here). Level, XP, the points spent in each of the 9 v2
--     stats, and bonus_points (the free points of a refund: decision 3 of 20.11, a separate count, not extra levels). The foreign key to
--     player_cards is ON DELETE CASCADE: the v2 progress goes with the last copy, the same as the v1 stars and points (decision 4).
--     The trigger card_progress_v2_check reads its limits from balance (no number in this file):
--       level <= v2_level.max_level; each stat <= v2_stats.max_per_stat;
--       the points spent <= level x v2_level.points_per_level + bonus_points (so card_combat_v2 with the bonus of M1b accepts every row);
--       the level is the level of the XP: xp_at(level) <= xp, and xp < xp_at(level + 1) below the max level, where
--       xp_at(L) = L x card_level.cost_base + card_level.cost_per_level x L x (L - 1) / 2 (level L to L + 1 costs cost_base + cost_per_level x L);
--       the key (player_id, card_id) and the id never change.
--   card_progress_v2_log: the M1 ledger, one row for each change of a card_progress_v2 row (a granted level, a converted point, a top-up, a
--     refund, old dead points, XP, a v2 spend, a v2 reset). The unique key (progress_id, reason, stat, ref) makes each grant idempotent: a
--     second run of the same step adds no row. The deltas (d_level, d_xp, d_points, d_bonus) of the rows of one progress_id sum to the stored
--     row. No foreign key: the ledger keeps the history after the last copy leaves (a new copy gets a new progress id). A row never changes
--     (the trigger card_progress_v2_log_check refuses an update); an insert needs the progress row with the same player and card.
-- NO CHANGE IN PLAY: both tables are empty, no v1 or v2 game function reads or writes them, no v1 function changes, and the flag
-- combat_v2.progress stays false. The functions that fill them come with M1b to M1h. RLS is on with no policy: service role only.
-- Idempotent (create if not exists; the triggers and comments are set again). Server only.
-- Test: card-studio/scripts/test-combat-v2-progress-tables.mjs (rolled back; MUTATE=all must catch every mutation).

-- ============================================================ 1. the v2 progress of a card
create table if not exists public.card_progress_v2 (
  id bigint generated always as identity unique,
  player_id text not null,
  card_id bigint not null,
  level integer not null default 0 check (level >= 0),
  xp integer not null default 0 check (xp >= 0),
  atk_pts smallint not null default 0 check (atk_pts >= 0),
  def_pts smallint not null default 0 check (def_pts >= 0),
  hp_pts smallint not null default 0 check (hp_pts >= 0),
  crd_pts smallint not null default 0 check (crd_pts >= 0),
  crt_pts smallint not null default 0 check (crt_pts >= 0),
  abl_pts smallint not null default 0 check (abl_pts >= 0),
  ddg_pts smallint not null default 0 check (ddg_pts >= 0),
  acc_pts smallint not null default 0 check (acc_pts >= 0),
  spd_pts smallint not null default 0 check (spd_pts >= 0),
  bonus_points integer not null default 0 check (bonus_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, card_id),
  foreign key (player_id, card_id) references public.player_cards (player_id, card_id) on delete cascade
);
alter table public.card_progress_v2 enable row level security;
revoke all on public.card_progress_v2 from public, anon, authenticated;

create or replace function public.card_progress_v2_check() returns trigger language plpgsql set search_path = public as $fn$
declare
  v_max int := balance_num('v2_level', 'max_level')::int;
  v_ppl int := balance_num('v2_level', 'points_per_level')::int;
  v_cap int := balance_num('v2_stats', 'max_per_stat')::int;
  v_base numeric := balance_num('card_level', 'cost_base');
  v_per numeric := balance_num('card_level', 'cost_per_level');
  v_spent int := new.atk_pts + new.def_pts + new.hp_pts + new.crd_pts + new.crt_pts + new.abl_pts + new.ddg_pts + new.acc_pts + new.spd_pts;
  v_at numeric; v_next numeric;
begin
  if tg_op = 'UPDATE' and (new.id, new.player_id, new.card_id) is distinct from (old.id, old.player_id, old.card_id) then
    raise exception 'card_progress_v2: the id, player and card of a row never change (the ledger rows name the id)';
  end if;
  if new.level > v_max then
    raise exception 'card_progress_v2 %: level % is above v2_level.max_level %', new.id, new.level, v_max;
  end if;
  if greatest(new.atk_pts, new.def_pts, new.hp_pts, new.crd_pts, new.crt_pts, new.abl_pts, new.ddg_pts, new.acc_pts, new.spd_pts) > v_cap then
    raise exception 'card_progress_v2 %: a stat has more than v2_stats.max_per_stat % points', new.id, v_cap;
  end if;
  if v_spent > new.level * v_ppl + new.bonus_points then
    raise exception 'card_progress_v2 %: % points spent, but level % gives % and the bonus is %', new.id, v_spent, new.level, new.level * v_ppl, new.bonus_points;
  end if;
  v_at := new.level * v_base + v_per * new.level * (new.level - 1) / 2;
  v_next := (new.level + 1) * v_base + v_per * (new.level + 1) * new.level / 2;
  if new.xp < v_at or (new.level < v_max and new.xp >= v_next) then
    raise exception 'card_progress_v2 %: % XP is not level % (card_level: level % needs % to % XP)', new.id, new.xp, new.level, new.level, v_at,
      case when new.level < v_max then (v_next - 1)::text else 'any' end;
  end if;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists card_progress_v2_check on public.card_progress_v2;
create trigger card_progress_v2_check before insert or update on public.card_progress_v2 for each row execute function public.card_progress_v2_check();

-- ============================================================ 2. the M1 ledger
create table if not exists public.card_progress_v2_log (
  id bigint generated always as identity primary key,
  progress_id bigint not null,
  player_id text not null,
  card_id bigint not null,
  reason text not null check (reason in ('grant_level', 'convert', 'topup', 'refund', 'dead_points', 'xp', 'spend', 'reset')),
  stat text not null default '' check (stat in ('', 'atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd')),
  ref text not null check (ref ~ '^[a-z0-9_]+(:[a-z0-9_.-]+)*$'),
  d_level integer not null default 0,
  d_xp integer not null default 0,
  d_points integer not null default 0,
  d_bonus integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  created_by text not null default 'unknown',
  unique (progress_id, reason, stat, ref),
  -- the deltas that each reason may carry (a grant is never negative; only a reset takes points back)
  constraint card_progress_v2_log_deltas check (case reason
    when 'grant_level' then d_level > 0 and d_xp >= 0 and d_points = 0 and d_bonus = 0 and stat = ''
    when 'xp'          then d_xp > 0 and d_level >= 0 and d_points = 0 and d_bonus = 0 and stat = '' and ref ~ '^(hunt|dungeon):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    when 'refund'      then d_bonus > 0 and d_level = 0 and d_xp = 0 and d_points = 0
    when 'reset'       then d_points < 0 and d_level = 0 and d_xp = 0 and d_bonus = 0 and stat <> ''
    else                    d_points > 0 and d_level = 0 and d_xp = 0 and d_bonus = 0 and stat <> ''   -- convert, topup, dead_points, spend
  end)
);
create index if not exists card_progress_v2_log_player on public.card_progress_v2_log (player_id, created_at desc);
alter table public.card_progress_v2_log enable row level security;
revoke all on public.card_progress_v2_log from public, anon, authenticated;

create or replace function public.card_progress_v2_log_check() returns trigger language plpgsql set search_path = public as $fn$
begin
  if tg_op = 'UPDATE' then
    raise exception 'card_progress_v2_log: a ledger row never changes; add a new row';
  end if;
  if not exists (select 1 from public.card_progress_v2 p where p.id = new.progress_id and p.player_id = new.player_id and p.card_id = new.card_id) then
    raise exception 'card_progress_v2_log: no card_progress_v2 row % for this player and card', new.progress_id;
  end if;
  new.created_at := now();
  new.created_by := balance_who();
  return new;
end $fn$;
drop trigger if exists card_progress_v2_log_check on public.card_progress_v2_log;
create trigger card_progress_v2_log_check before insert or update on public.card_progress_v2_log for each row execute function public.card_progress_v2_log_check();

-- ============================================================ 3. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['card_progress_v2_check()', 'card_progress_v2_log_check()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on table public.card_progress_v2 is $cm$Combat v2 card progress (plan 2.2 to 2.4, 11, 20.11; combat_v2_progress_tables.sql, step M1a): one row for each player_cards row with v2 progress: the level, the XP, the points spent in each of the 9 v2 stats and the free bonus points of a refund. Deleted with the last copy (foreign key to player_cards, on delete cascade). The trigger card_progress_v2_check reads the limits from balance (v2_level, v2_stats, card_level). Every change has a row in card_progress_v2_log. Nothing reads it until combat_v2.progress is on (the functions come with M1b to M1h). Service role only.$cm$;
comment on column public.card_progress_v2.id is $cm$The progress id (never reused, never changes). The ledger card_progress_v2_log names it, so a copy that leaves and comes back starts a new history.$cm$;
comment on column public.card_progress_v2.player_id is $cm$The owner (players.id). With card_id: the player_cards row (foreign key, on delete cascade).$cm$;
comment on column public.card_progress_v2.card_id is $cm$The card (cards.id). With player_id: the player_cards row (foreign key, on delete cascade).$cm$;
comment on column public.card_progress_v2.level is $cm$The card level, 0 to balance v2_level.max_level. Always the level of the XP (card_level costs, the trigger checks it). Each level gives v2_level.points_per_level points.$cm$;
comment on column public.card_progress_v2.xp is $cm$The total XP of the card. Level L needs L x card_level.cost_base + card_level.cost_per_level x L x (L - 1) / 2 XP. At go-live a card starts at the exact XP of its granted level (decision 5 of plan 20.11).$cm$;
comment on column public.card_progress_v2.atk_pts is $cm$Points spent in Attack (ATK), 0 to v2_stats.max_per_stat. The points key atk of card_combat_v2.$cm$;
comment on column public.card_progress_v2.def_pts is $cm$Points spent in Defense (DEF), 0 to v2_stats.max_per_stat. The points key def of card_combat_v2.$cm$;
comment on column public.card_progress_v2.hp_pts is $cm$Points spent in HP, 0 to v2_stats.max_per_stat. The points key hp of card_combat_v2.$cm$;
comment on column public.card_progress_v2.crd_pts is $cm$Points spent in Crit Damage (CRD), 0 to v2_stats.max_per_stat. The points key crd of card_combat_v2.$cm$;
comment on column public.card_progress_v2.crt_pts is $cm$Points spent in Crit % (CRT), 0 to v2_stats.max_per_stat. The points key crt of card_combat_v2.$cm$;
comment on column public.card_progress_v2.abl_pts is $cm$Points spent in Ability (ABL), 0 to v2_stats.max_per_stat. The points key abl of card_combat_v2.$cm$;
comment on column public.card_progress_v2.ddg_pts is $cm$Points spent in Dodge (DDG), 0 to v2_stats.max_per_stat. The points key ddg of card_combat_v2.$cm$;
comment on column public.card_progress_v2.acc_pts is $cm$Points spent in Accuracy (ACC), 0 to v2_stats.max_per_stat. The points key acc of card_combat_v2.$cm$;
comment on column public.card_progress_v2.spd_pts is $cm$Points spent in Speed (SPD), 0 to v2_stats.max_per_stat. The points key spd of card_combat_v2.$cm$;
comment on column public.card_progress_v2.bonus_points is $cm$Free points from a refund (the part of a converted v1 stat above the cap, plan 11 and 20.11), a separate count and not levels: the points spent may be up to level x v2_level.points_per_level + bonus_points.$cm$;
comment on column public.card_progress_v2.created_at is $cm$When the row was made.$cm$;
comment on column public.card_progress_v2.updated_at is $cm$The last change (set by the trigger).$cm$;

comment on table public.card_progress_v2_log is $cm$The M1 ledger of the combat v2 card progress (plan 20.11; combat_v2_progress_tables.sql, step M1a): one row for each change of a card_progress_v2 row, with its reason. The unique key (progress_id, reason, stat, ref) makes each step idempotent. The deltas of the rows of one progress_id sum to the stored row. No foreign key: the history stays after the last copy leaves. A row never changes (trigger card_progress_v2_log_check). Service role only.$cm$;
comment on column public.card_progress_v2_log.id is $cm$The row id.$cm$;
comment on column public.card_progress_v2_log.progress_id is $cm$The card_progress_v2.id that the row changed (it must exist at insert, with the same player and card).$cm$;
comment on column public.card_progress_v2_log.player_id is $cm$The owner at the time of the change (a copy of card_progress_v2.player_id, kept after the row goes).$cm$;
comment on column public.card_progress_v2_log.card_id is $cm$The card (a copy of card_progress_v2.card_id, kept after the row goes).$cm$;
comment on column public.card_progress_v2_log.reason is $cm$Why: grant_level (the go-live level and its XP), convert (a v1 point converted), topup (the smallest count that reaches the old value), refund (bonus points), dead_points (old v1 Support and Recharge points of an attacker), xp (a fight-day), spend (a v2 point spent), reset (v2 points taken back).$cm$;
comment on column public.card_progress_v2_log.stat is $cm$The v2 stat of a points row (atk, def, hp, crd, crt, abl, ddg, acc, spd); empty for a level or XP row; may name the source stat of a refund.$cm$;
comment on column public.card_progress_v2_log.ref is $cm$The idempotency key of the step: the run of a conversion (for example m1) or, for xp, the source and the Mountain day (hunt:YYYY-MM-DD or dungeon:YYYY-MM-DD: one award for each card, day and source).$cm$;
comment on column public.card_progress_v2_log.d_level is $cm$The change of card_progress_v2.level (grant_level, or xp when the XP gives a level).$cm$;
comment on column public.card_progress_v2_log.d_xp is $cm$The change of card_progress_v2.xp (grant_level: the exact XP of the level; xp: the award).$cm$;
comment on column public.card_progress_v2_log.d_points is $cm$The change of the points in the stat: above 0 for convert, topup, dead_points and spend; below 0 for reset.$cm$;
comment on column public.card_progress_v2_log.d_bonus is $cm$The change of card_progress_v2.bonus_points (refund).$cm$;
comment on column public.card_progress_v2_log.note is $cm$An optional text (for example the v1 stat and its points of a conversion). Aggregates only in reports.$cm$;
comment on column public.card_progress_v2_log.created_at is $cm$When the row was added (set by the trigger).$cm$;
comment on column public.card_progress_v2_log.created_by is $cm$Who added it: balance_who() (the setting balance.by, else the session user; set by the trigger).$cm$;

comment on function public.card_progress_v2_check() is $cm$[combat] Trigger (before insert, update on card_progress_v2): refuses a level above v2_level.max_level, a stat above v2_stats.max_per_stat, more points spent than level x v2_level.points_per_level + bonus_points, an XP that is not the XP of the level (card_level.cost_base, cost_per_level), and a change of the id, player or card. Sets updated_at. combat_v2_progress_tables.sql.$cm$;
comment on function public.card_progress_v2_log_check() is $cm$[combat] Trigger (before insert, update on card_progress_v2_log): refuses an update (a ledger row never changes) and a row with no card_progress_v2 row of the same id, player and card. Sets created_at and created_by (balance_who). combat_v2_progress_tables.sql.$cm$;

notify pgrst, 'reload schema';
