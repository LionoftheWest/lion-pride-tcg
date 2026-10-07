-- Card sets (Nathan, 2026-10-07; docs/design.md Appendix A D-80 to D-84).
--   D-80 One pack balance: players.pack_balance stays one count; the member chooses the set when opening.
--   D-81 Old sets stay pullable (Season 1 stays after Season 2 releases): card_sets.pullable.
--   D-102 The first set is named "Origins". D-103 A set and a season are separate: a season holds one or more
--      sets. card_sets.season (S1 -> 1); card_sets.code = letters of the name ('ORI'), unique; the card label is
--      code + number ("ORI · #014").
--   D-82 Same odds: every set uses the one balance row 'pulls' (no per-set odds here).
--   D-83 The set code on the card ("S2 · #014"): cards.set_id + cards.set_number, fixed once assigned.
--   D-84 Rewards (Dungeon, Shop) keep drawing from every pullable set; only packs choose a set.
--
-- The design:
--   1. card_sets: one row per set. S1 = 'Origins', code 'ORI', season 1. The id 'S1' stays as the stable key
--      (cards.set_id, pack_ledger.set_id, players.last_open_set point at it); the members see name and code.
--   2. cards.set_id is the one source of the set of a card. cards.season stays as 'Season ' || the season of
--      the set (the Activity, the Hunt weak points 'season', the achievement tag badges and the studio read
--      it: 'Season 1' for every existing card, unchanged); the trigger cards_set_rules keeps it so. A writer
--      that sends only a season (old code) gets the one set of that season (several sets: refused, send
--      set_id); no season and no set = Season 1 (the old || 'Season 1' default).
--   3. cards.set_number: the number in the set, assigned once by the database from card_sets.last_number
--      (a counter, so the number of a deleted card is never given again). The backfill uses the order that
--      the browser uses today (tcg-activity/src/ui-v2.js mergedCards: per season, in catalog order =
--      cards.id), so no member sees a number change. A direct change of set_number is refused.
--   4. draw_pool: the one definition of "a card that a draw can give" (in the draw pool, source draw, its
--      set pullable). The bot's pack draw and the reward draws (dungeon_card_of: Dungeon chests and loot,
--      Dungeon / Gauntlet prizes; shop_pick_stock: the Shop) read it.
--   5. open_packs(text, bigint[], integer, text): an open from one set. The set must be pullable and every
--      card must be in the draw pool of that set. The pack_ledger rows keep their open id (ref 'open') and
--      record the set in pack_ledger.set_id. The 3-argument open_packs (no set) is NOT changed.
--   6. pullable_sets(member): the list for the coming Open screen, in one statement for any number of sets.
--   7. The Open screen (D-85 to D-90, section 3b): the last set a member opened, a cover card from the set
--      itself, is_new on the newest set, and a pack color + pack artwork per set.
-- Runs more than once with the same result.

-- GUARD (the combat_core.sql rule): this file replaces the live functions below. It runs only on the live
-- text it was built from (the first md5) or on its own result (the second md5). Any other change stops it,
-- so that change is never reverted: rebuild this file from the live text.
do $g$
declare x text[]; m text;
begin
  foreach x slice 1 in array array[
    ['dungeon_card_of(text)', '2a19d3471678cf52a3308d02cae8d870', '1b92692ef66cd4a6cd2d1cb831a84528'],
    ['shop_pick_stock(date)', '31c924069c18e0ff477bba7fc6c6d7b1', '589f407a4c0961c9ccfdbcc7bc6df5c9']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m not in (x[2], x[3]) then raise exception 'card_sets.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

-- 1. cards.season: it was added by hand on live; this records it in the repo. --------------------------
alter table public.cards add column if not exists season text;

-- 2. The sets ----------------------------------------------------------------------------------------
create table if not exists public.card_sets (
  id text primary key check (id ~ '^[A-Z0-9]{1,8}$'),
  name text not null unique,               -- D-102 'Origins'
  code text not null unique check (code ~ '^[A-Z0-9]{1,8}$'),
  released_at timestamptz,
  pullable boolean not null default true,
  sort integer not null default 0,
  last_number integer not null default 0 check (last_number >= 0),
  created_at timestamptz not null default now());
alter table public.card_sets enable row level security;
revoke all on public.card_sets from anon, authenticated;
-- D-90 (section 3b): the pack color of each set (required) and the pack artwork (for later).
alter table public.card_sets add column if not exists pack_color text;
alter table public.card_sets add column if not exists pack_art_url text;
-- D-103: the season of the set (a season holds one or more sets).
alter table public.card_sets add column if not exists season integer;
insert into public.card_sets (id, name, code, released_at, sort, pack_color, season)
  values ('S1', 'Origins', 'ORI', (select min(created_at) from public.cards), 1, '#ff8d4d', 1)
  on conflict (id) do nothing;
alter table public.card_sets alter column season set not null;
do $q$
begin
  if not exists (select 1 from pg_constraint where conname = 'card_sets_season_positive') then
    alter table public.card_sets add constraint card_sets_season_positive check (season > 0);
  end if;
end $q$;
-- The season number in a cards.season text: 'Season 3' -> 3; '' or null = Season 1; any other text -> null.
create or replace function public.season_number(p_season text)
 returns integer
 language sql
 immutable
 set search_path to 'public'
as $function$
  select substring(coalesce(nullif(p_season, ''), 'Season 1') from '^Season ([0-9]+)$')::int;
$function$;

-- 3. cards.set_id and cards.set_number -----------------------------------------------------------------
alter table public.cards add column if not exists set_id text references public.card_sets(id);
alter table public.cards add column if not exists set_number integer;
-- The trigger goes first (it is created again below), so the backfill runs without it.
drop trigger if exists cards_set_rules on public.cards;

-- Every season in use must have exactly one set; else stop before anything is half done.
do $s$
declare v text;
begin
  select string_agg(distinct coalesce(nullif(c.season, ''), 'Season 1'), ', ') into v
    from public.cards c
   where c.set_id is null
     and (select count(*) from public.card_sets s where s.season = public.season_number(c.season)) <> 1;
  if v is not null then raise exception 'card_sets.sql: the season(s) % must have exactly one card_sets row for the backfill', v; end if;
end $s$;

-- The set of each card: the one set of its season ('' or null = Season 1, as the browser does).
update public.cards c set set_id = s.id
  from public.card_sets s
 where c.set_id is null and s.season = public.season_number(c.season);

-- The number: the browser order (ui-v2.js mergedCards: a counter per season over the catalog in id order).
-- Only cards with no number; they come after the numbers that the set already gave (none on the first run).
with n as (
  select c.id, s.last_number + row_number() over (partition by c.set_id order by c.id) as num
    from public.cards c join public.card_sets s on s.id = c.set_id
   where c.set_number is null)
update public.cards c set set_number = n.num from n where n.id = c.id;
update public.card_sets s set last_number = greatest(s.last_number, coalesce((select max(set_number) from public.cards c where c.set_id = s.id), 0));
-- The season copy follows the season of the set ('Season 1' for every existing card: no reader sees a change).
update public.cards c set season = 'Season ' || s.season from public.card_sets s where s.id = c.set_id and c.season is distinct from 'Season ' || s.season;

alter table public.cards alter column set_id set not null;
alter table public.cards alter column set_number set not null;
do $k$
begin
  if not exists (select 1 from pg_constraint where conname = 'cards_set_number_key') then
    alter table public.cards add constraint cards_set_number_key unique (set_id, set_number);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cards_set_number_positive') then
    alter table public.cards add constraint cards_set_number_positive check (set_number > 0);
  end if;
end $k$;
create index if not exists cards_set_id_idx on public.cards (set_id);

-- The rules of a card's set (BEFORE INSERT / UPDATE):
--   - an insert with no set_id: the one set of that season (no season = Season 1); no set or several sets in
--     that season, or a text that is not 'Season <n>', is refused;
--   - season is always 'Season ' || the season of the set (a write of season alone changes nothing);
--   - a new card, or a card that moves to another set, gets the next number of its set (card_sets.last_number;
--     the row lock on the set serializes two inserts at the same time);
--   - set_number is fixed: a direct change is refused.
create or replace function public.cards_set_rules()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare v_n int;
begin
  if tg_op = 'INSERT' and new.set_id is null then
    select min(id), count(*) into new.set_id, v_n from card_sets where season = season_number(new.season);
    if v_n <> 1 then
      raise exception 'cards: the season % has % sets (send set_id)', coalesce(new.season, 'null'), v_n using errcode = 'check_violation';
    end if;
  end if;
  new.season := coalesce((select 'Season ' || season from card_sets where id = new.set_id), new.season);
  if tg_op = 'INSERT' or new.set_id is distinct from old.set_id then
    update card_sets set last_number = last_number + 1 where id = new.set_id returning last_number into new.set_number;
  elsif new.set_number is distinct from old.set_number then
    raise exception 'cards: the set number of card % is fixed (% -> %)', old.id, old.set_number, new.set_number using errcode = 'check_violation';
  end if;
  return new;
end $function$;
create trigger cards_set_rules before insert or update of set_id, set_number, season on public.cards
  for each row execute function public.cards_set_rules();

-- 3b. The Open screen (Nathan, 2026-10-07, D-85 to D-90) ----------------------------------------------
-- D-86 The picture of a set is a card "from the set itself": card_sets.cover_card_id. The foreign key on
--      (cover_card_id, id) -> cards (id, set_id) refuses a card of another set, and refuses to move the cover
--      card to another set. A deleted cover card leaves the set with no cover (set null on cover_card_id only).
-- D-90 The pack of each set has its own color (pack_color, required: a new set must choose one) and, later,
--      its own artwork (pack_art_url, nullable). S1 = the orange of today's pack: #ff8d4d, the median of the
--      orange swirl pixels of tcg-activity/public/pack_still.png. D-105: the same color is the outline of
--      the text on the pack (one column) (the pack image of the Open screen,
--      tcg-activity/src/main.js packImg).
-- D-85 The Open window preselects the set the member opened last: players.last_open_set (open_packs with a
--      set writes it). First visit: the newest pullable set (pullable_sets).
-- D-89 "New" on the newest set: released_at, and is_new in pullable_sets.
do $u$
begin
  if not exists (select 1 from pg_constraint where conname = 'cards_id_set_key') then
    alter table public.cards add constraint cards_id_set_key unique (id, set_id);
  end if;
end $u$;
alter table public.card_sets add column if not exists cover_card_id bigint;
do $u$
begin
  if not exists (select 1 from pg_constraint where conname = 'card_sets_cover_in_set') then
    alter table public.card_sets add constraint card_sets_cover_in_set foreign key (cover_card_id, id)
      references public.cards (id, set_id) on update restrict on delete set null (cover_card_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'card_sets_pack_color_hex') then
    alter table public.card_sets add constraint card_sets_pack_color_hex check (pack_color ~ '^#[0-9a-f]{6}$');
  end if;
end $u$;
update public.card_sets set pack_color = '#ff8d4d' where id = 'S1' and pack_color is null;
alter table public.card_sets alter column pack_color set not null;
-- The S1 cover: LionoftheWest's Pikachu, Full Art (card 32, S1 #009). Nathan may change it:
--   update card_sets set cover_card_id = <a Season 1 card id> where id = 'S1';
-- Only when S1 has no cover yet (a second run keeps Nathan's choice); if card 32 is not in S1, the first S1 Full Art.
update public.card_sets s set cover_card_id = coalesce(
    (select id from public.cards where id = 32 and set_id = 'S1'),
    (select min(id) from public.cards where set_id = 'S1' and rarity::text = 'full_art'))
 where s.id = 'S1' and s.cover_card_id is null;
alter table public.players add column if not exists last_open_set text references public.card_sets(id) on delete set null;

-- 4. The draw pool -------------------------------------------------------------------------------------
create or replace view public.draw_pool with (security_invoker = true) as
  select c.id, c.subject_id, c.name, c.rarity, c.source, c.image_url, c.artist_credit, c.lore, c.set_id, c.set_number
    from public.cards c join public.card_sets s on s.id = c.set_id
   where c.in_draw_pool and c.source::text = 'draw' and s.pullable;
revoke all on public.draw_pool from anon, authenticated;

-- 5. The reward draws read the draw pool (D-84: every pullable set, the same odds as before) ----------
CREATE OR REPLACE FUNCTION public.dungeon_card_of(p_rarity text)
 RETURNS bigint
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select id from draw_pool where rarity::text = p_rarity order by random() limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.shop_pick_stock(p_day date)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := shard_cfg(); v_cool int := coalesce((cfg->>'cooldown_days')::int, 7);
  r record; v_slot int := 0; v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('shop_pick_stock'), (p_day - date '2000-01-01'));
  if exists (select 1 from shop_stock where day = p_day) then
    return (select count(*) from shop_stock where day = p_day);
  end if;
  for r in select k as rarity, (cfg->'stock'->>k)::int as n
             from unnest(array['normal', 'illustrated_rare', 'secret_rare']) k loop
    v_n := coalesce(r.n, 0);
    if v_n <= 0 then continue; end if;
    insert into shop_stock (day, slot, card_id, rarity, price)
    select p_day, v_slot + row_number() over (), c.id, r.rarity, (cfg->'prices'->>r.rarity)::int
      from (select c.id from draw_pool c
             where c.rarity::text = r.rarity
               and c.rarity::text not in ('gold', 'full_art', 'event', 'promo')
               and not exists (select 1 from shop_stock s where s.card_id = c.id
                                and s.day > p_day - v_cool and s.day < p_day)
             order by random() limit v_n) c;
    get diagnostics v_n = row_count;
    v_slot := v_slot + v_n;
  end loop;
  return v_slot;
end $function$;

-- 6. An open from one set ----------------------------------------------------------------------------
alter table public.pack_ledger add column if not exists set_id text references public.card_sets(id);

-- The same steps as open_packs(text, bigint[], integer) (pack_ledger_strict.sql), with two checks first and
-- the set on the ledger rows. The bot draws the cards from the draw pool of the set (D-82: the one 'pulls' row).
create or replace function public.open_packs(p_player_id text, p_cards bigint[], p_size integer, p_set text)
 returns integer
 language plpgsql
 set search_path to 'public'
as $function$
declare v_want int; v_have int; v_n int; v_open text := gen_random_uuid()::text; -- one id for the packs of this open
begin
  if not exists (select 1 from card_sets where id = p_set and pullable) then
    raise exception 'set_not_pullable: %', coalesce(p_set, 'null') using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_cards) x(id) where not exists (select 1 from draw_pool d where d.id = x.id and d.set_id = p_set)) then
    raise exception 'open_packs: a card is not in the draw pool of set %', p_set using errcode = 'P0001';
  end if;
  v_want := coalesce(array_length(p_cards, 1), 0) / greatest(1, p_size);
  if v_want < 1 or v_want > 10 then return 0; end if;
  -- The row lock makes concurrent opens of one player wait, so the balance never goes below 0.
  select pack_balance into v_have from players where id = p_player_id for update;
  v_n := least(coalesce(v_have, 0), v_want);
  if v_n <= 0 then return 0; end if;
  update players set pack_balance = pack_balance - v_n, last_open_set = p_set where id = p_player_id; -- D-85
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, set_id)
    select p_player_id, -1, 'opened', 'open', v_open, p_set from generate_series(1, v_n);
  perform add_cards_to_player(p_player_id, p_cards[1 : v_n * p_size]);
  return v_n;
end $function$;

-- 7. The sets for the Open screen ---------------------------------------------------------------------
-- One statement for any number of sets (D-90 "there will be tons of sets"): the counts are two grouped scans
-- (the draw pool, the member's cards), joined to the sets; no query per set.
--   sets[]:   id, name, code, released_at, is_new (D-89: the newest pullable set by released_at, only when
--             there are 2 or more pullable sets), cards (what a pack of the set can give), owned (how many of
--             them the member has), cover_card_id + cover_image_url (D-86), pack_color + pack_art_url (D-90);
--   last_set: the set the member opened last if it is still pullable, else the newest pullable set (D-85).
create or replace function public.pullable_sets(p_player text)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  with s as (select * from card_sets where pullable),
  newest as (select id from s order by released_at desc nulls last, sort desc, id desc limit 1),
  n as (select set_id, count(*) as cards from draw_pool group by set_id),
  o as (select d.set_id, count(*) as owned from player_cards pc join draw_pool d on d.id = pc.card_id
         where pc.player_id = p_player and pc.quantity > 0 group by d.set_id)
  select jsonb_build_object(
    'sets', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'code', s.code, 'season', s.season, 'released_at', s.released_at,
        'is_new', s.id = (select id from newest) and (select count(*) from s) > 1,
        'cards', coalesce(n.cards, 0), 'owned', coalesce(o.owned, 0),
        'cover_card_id', s.cover_card_id, 'cover_image_url', c.image_url,
        'pack_color', s.pack_color, 'pack_art_url', s.pack_art_url)
      order by s.sort, s.id)
      from s left join n on n.set_id = s.id left join o on o.set_id = s.id left join cards c on c.id = s.cover_card_id), '[]'::jsonb),
    'last_set', coalesce((select p.last_open_set from players p join s on s.id = p.last_open_set where p.id = p_player),
                         (select id from newest)));
$function$;

-- 8. Locked like every function (lockdown_grants.sql) -------------------------------------------------
revoke execute on function public.open_packs(text, bigint[], integer, text) from public, anon, authenticated;
revoke execute on function public.pullable_sets(text) from public, anon, authenticated;
revoke execute on function public.cards_set_rules() from public, anon, authenticated;
revoke execute on function public.season_number(text) from public, anon, authenticated;
grant execute on function public.season_number(text) to service_role;
grant execute on function public.open_packs(text, bigint[], integer, text) to service_role;
grant execute on function public.pullable_sets(text) to service_role;
grant select on public.card_sets, public.draw_pool to service_role;

-- 9. Documentation -----------------------------------------------------------------------------------
comment on table public.card_sets is
  '[cards] One row per card set (D-80 to D-84). A pack opens from one set (open_packs with p_set); the reward draws use every pullable set (draw_pool).';
comment on column public.card_sets.id is 'The set id (cards.set_id), for example S1.';
comment on column public.card_sets.name is 'The set name the members see (D-102: S1 = Origins).';
comment on column public.card_sets.season is 'D-103: the season of the set (a season holds one or more sets). cards.season = ''Season '' || this (cards_set_rules).';
comment on function public.season_number(text) is 'The season number in a cards.season text: ''Season 3'' -> 3, '''' or null -> 1, any other text -> null.';
comment on column public.card_sets.code is 'D-103: letters from the set name, unique, shown on a card with its number, for example "ORI · #014" (D-83).';
comment on column public.card_sets.released_at is 'When the set was released (information for the Open screen; it does not gate the draws).';
comment on column public.card_sets.pullable is 'true = packs and rewards can give its cards (draw_pool). D-81: an old set stays pullable.';
comment on column public.card_sets.sort is 'The order of the sets on the Open screen (pullable_sets).';
comment on column public.card_sets.created_at is 'When the set row was made.';
comment on column public.draw_pool.id is 'The card id (cards.id).';
comment on column public.draw_pool.subject_id is 'The subject of the card (cards.subject_id).';
comment on column public.draw_pool.name is 'The card name (cards.name).';
comment on column public.draw_pool.rarity is 'The card rarity (cards.rarity); the pack draw groups the pool by it.';
comment on column public.draw_pool.source is 'Always draw here (cards.source).';
comment on column public.draw_pool.image_url is 'The card image (cards.image_url).';
comment on column public.draw_pool.artist_credit is 'The artist (cards.artist_credit).';
comment on column public.draw_pool.lore is 'The card text (cards.lore).';
comment on column public.draw_pool.set_id is 'The set of the card (cards.set_id); a pack from a set filters on it.';
comment on column public.draw_pool.set_number is 'The number of the card in its set (cards.set_number).';
comment on column public.card_sets.last_number is 'The last set_number given in this set. cards_set_rules adds 1 for each new card, so a number is never given twice.';
comment on column public.cards.season is '''Season '' || card_sets.season of set_id (kept by cards_set_rules). Read by the Activity, the Hunt weak points, the achievement tag badges and the studio.';
comment on column public.cards.set_id is 'The set of the card (card_sets.id): the one source. A pack from a set draws only its cards.';
comment on column public.cards.set_number is 'The number of the card in its set ("S1 · #014"), given once by cards_set_rules; it never changes.';
comment on column public.pack_ledger.set_id is 'For an open: the set the member chose (open_packs with p_set). null = an open with no set (every pullable set) or not an open.';
comment on view public.draw_pool is 'The cards a draw can give: in the draw pool, source draw, and the set is pullable. The bot pack draw, dungeon_card_of (Dungeon chests and loot, Dungeon / Gauntlet prizes) and shop_pick_stock read it.';
comment on function public.open_packs(text, bigint[], integer, text) is 'Opens up to 10 packs from one set: the set must be pullable and each card in its draw pool (else an error). Then the same as open_packs(text, bigint[], integer), with the set on the pack_ledger rows. Returns the packs opened.';
comment on function public.pullable_sets(text) is 'The Open screen in one statement: {sets: [id, name, code, season, released_at, is_new, cards (a pack of the set can give), owned (of those, by the member), cover_card_id, cover_image_url, pack_color, pack_art_url], last_set (D-85)}.';
comment on column public.card_sets.cover_card_id is 'D-86: the picture of the set, a card of the set itself (card_sets_cover_in_set refuses a card of another set). null = no cover.';
comment on column public.card_sets.pack_color is 'D-90: the color of the pack of the set (#rrggbb). D-105: also the outline color of the text on the pack (one color, one column). S1 #ff8d4d = the orange of tcg-activity/public/pack_still.png.';
comment on column public.card_sets.pack_art_url is 'D-90: the pack artwork of the set, for later. null = the color only.';
comment on column public.players.last_open_set is 'D-85: the set of the member''s last open with a set (open_packs with p_set). The Open window preselects it.';
comment on function public.cards_set_rules() is 'Trigger on cards: the one set of the season when no set_id is sent, season = ''Season '' || the set season, the next set_number for a new card or a card that moves set, and no direct change of set_number.';

notify pgrst, 'reload schema';
