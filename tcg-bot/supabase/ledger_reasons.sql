-- One shared list of ledger reasons (Nathan, 2026-10-07: "set up the data so its easy to add things like those
-- (Expedition, Arena, Wandering, Minigame) and other events").
-- Before: three CHECK constraints held the allowed reasons (pack_ledger 24, card_ledger 14, shard_ledger 11) and a
-- fourth copied the pack list (gift_claims). No reason had a written meaning.
-- After:
--   1. public.ledger_reasons (ledger, reason, note, status, added_on): one row per allowed reason, with its meaning
--      (proven from the writer functions) and a status: active, reserved (a planned feature, no writer yet) or
--      retired (old rows only).
--   2. Each ledger gets a stored generated constant column `ledger` ('pack' / 'card' / 'shard') and a foreign key
--      (ledger, reason) -> ledger_reasons. gift_claims gets `reason_ledger` = 'pack' for a pack gift, else null (a
--      null column skips the foreign key: the same rows as the old check). The foreign keys keep the OLD constraint
--      names (pack_ledger_reason_check, card_ledger_reason_check, shard_ledger_reason_check,
--      gift_claims_pack_reason_check): the three reconcile functions read convalidated of those names, so they
--      stay unchanged and still report reason_check.
--   3. A BEFORE trigger (ledger_reason_guard) refuses an unknown or a retired reason on a NEW row with
--      check_violation, the same error class as the old checks (the writers and the tests expect it). The foreign
--      key alone would accept a retired reason. The trigger runs before the foreign key, so an unknown reason
--      also gets check_violation, not foreign_key_violation.
-- Add a reason: insert one ledger_reasons row with its note. A new pack reason that counts to the daily cap must
-- also go into earned_today() (an explicit list, guarded by pack_ledger_strict.sql).
-- No guarded function changes. pack_ledger_strict.sql, card_ledger.sql and shard_ledger_strict.sql skip their old
-- reason checks once this table exists, so a re-run of one of them keeps this state.
-- Test: card-studio/scripts/test-ledger-reasons.mjs. Runs more than once with the same result.

do $pre$
begin
  if to_regprocedure('public.pack_ledger_reconcile()') is null or to_regprocedure('public.card_ledger_reconcile()') is null
     or to_regprocedure('public.shard_ledger_reconcile()') is null then
    raise exception 'ledger_reasons.sql: apply pack_ledger_strict.sql, card_ledger.sql and shard_ledger_strict.sql first';
  end if;
end $pre$;

-- 1. The table -------------------------------------------------------------------------------------------------
create table if not exists public.ledger_reasons (
  ledger text not null constraint ledger_reasons_ledger_check check (ledger in ('pack', 'card', 'shard')),
  reason text not null constraint ledger_reasons_reason_check check (reason ~ '^[a-z][a-z0-9_]*$'),
  note text not null constraint ledger_reasons_note_check check (length(btrim(note)) > 0),
  status text not null default 'active' constraint ledger_reasons_status_check check (status in ('active', 'reserved', 'retired')),
  added_on date not null default current_date,
  primary key (ledger, reason)
);
alter table public.ledger_reasons enable row level security;
revoke all on public.ledger_reasons from anon, authenticated;

-- 2. The seed: every reason that the old checks allowed. A row that exists is not changed (a later status or note
--    change stays). Each note names the writer (the live function text of 2026-10-07).
insert into public.ledger_reasons (ledger, reason, status, added_on, note) values
  -- pack_ledger (24)
  ('pack', 'opened', 'active', '2026-10-07', 'One pack used: a -1 row per pack. open_packs (ref (''open'', the open id), the same id for the packs of one open) and spend_pack.'),
  ('pack', 'gift_sent', 'active', '2026-10-07', 'Packs a member gives to another member: the sender''s - row (gift_packs, ref (''gift'', gift_claims.id)).'),
  ('pack', 'gift_received', 'active', '2026-10-07', 'Packs from another member: gift_packs puts the gift in the receiver''s bell with this reason, claim_gift pays it (ref (''gift'', id)). Also the default reason of give_gift.'),
  ('pack', 'welcome', 'active', '2026-10-07', 'The New Player Bonus gift for a new member (trigger welcome_packs -> give_gift), paid when it is claimed in the bell (claim_gift).'),
  ('pack', 'launch_gift', 'active', '2026-10-07', 'The Launch Day commemoration gift (gift_all_members, the bot /grantall), paid when it is claimed in the bell (claim_gift).'),
  ('pack', 'raid_makeup_oct1', 'active', '2026-10-07', 'The one-time Raid bug make-up gift for the Oct 1 squad bug (raid_makeup_oct1.sql, 2026-10-02), paid when it is claimed in the bell (claim_gift). Active while such a gift can wait in a bell.'),
  ('pack', 'bug_reward', 'active', '2026-10-07', 'A reward gift for a reported bug, paid when it is claimed in the bell (claim_gift). No writer in the code: an admin made the gift by hand (give_gift with this reason).'),
  ('pack', 'admin', 'active', '2026-10-07', 'A promo gift from an admin (the bot /givepacks: give_gift reason admin), paid when it is claimed in the bell (claim_gift).'),
  ('pack', 'event', 'active', '2026-10-07', 'An event drop to every member (the bot /grantall: give_gift_all, default reason event), paid when it is claimed in the bell (claim_gift).'),
  ('pack', 'tutorial', 'active', '2026-10-07', 'The one tutorial pack when all the tutorial steps are done (claim_tutorial_reward, ref (''tutorial'', ''complete'')).'),
  ('pack', 'achievement', 'active', '2026-10-07', 'Packs for an achievement, a track tier or a tag badge (claim_achievement, claim_achievement_tiers; ref (''achievement'', the key)).'),
  ('pack', 'shop', 'active', '2026-10-07', 'Packs bought with Shards in the Shop (buy_shop_item, ref (''shop_purchase'', shop_purchases.id)).'),
  ('pack', 'hunt_reward', 'active', '2026-10-07', 'The Hunt prize by damage rank when a Hunt ends (settle_hunt, ref (''hunt'', hunts.id)).'),
  ('pack', 'dungeon_prize', 'active', '2026-10-07', 'A Dungeon (daily) or Gauntlet (weekly) board prize (dungeon_pay, ref (''dungeon_payout'', ''<mode>:<period>'')).'),
  ('pack', 'boon', 'active', '2026-10-07', 'A pack boon card that a member plays on a member (play_card_effect -> grant_packs, ref (''player'', the caster)).'),
  ('pack', 'earned_checkin', 'active', '2026-10-07', 'The daily check-in packs (claim_daily task checkin, ref (''daily_claim'', ''<day>:checkin'')). Counts to the daily cap (earned_today()).'),
  ('pack', 'earned_streak', 'active', '2026-10-07', 'The streak bonus part of a check-in claim (claim_daily, ref (''daily_claim'', ''<day>:checkin'')). Counts to the daily cap (earned_today()).'),
  ('pack', 'earned_hunt', 'active', '2026-10-07', 'The Hunt daily (claim_daily task hunt: one fight with the boss; ref (''daily_claim'', ''<day>:hunt'')). Counts to the daily cap (earned_today()).'),
  ('pack', 'earned_voice', 'active', '2026-10-07', 'The voice daily (claim_daily task voice: minutes in voice; ref (''daily_claim'', ''<day>:voice'')). Counts to the daily cap (earned_today()).'),
  ('pack', 'earned_social', 'active', '2026-10-07', 'The social daily (claim_daily task social; ref (''daily_claim'', ''<day>:social'')). Counts to the daily cap (earned_today()).'),
  ('pack', 'earned_dungeon', 'active', '2026-10-07', 'The Dungeon daily (claim_daily task dungeon: a Dungeon run today; ref (''daily_claim'', ''<day>:dungeon'')). Counts to the daily cap (earned_today()).'),
  ('pack', 'earned_gauntlet', 'active', '2026-10-07', 'The Gauntlet daily (claim_daily task gauntlet; ref (''daily_claim'', ''<day>:gauntlet'')). Counts to the daily cap (earned_today()).'),
  ('pack', 'earned_daily', 'active', '2026-10-07', 'The chat daily: the first message of the day (claim_daily_earn, the bot; ref (''daily_claim'', ''<day>:chat'')). Counts to the daily cap (earned_today()).'),
  ('pack', 'earned_bonus', 'active', '2026-10-07', 'The chat bonus daily at the message threshold (claim_daily_earn, the bot; ref (''daily_claim'', ''<day>:chat_bonus'')). Counts to the daily cap (earned_today()).'),
  -- card_ledger (14)
  ('card', 'opening_balance', 'retired', '2026-10-07', 'The seed of card_ledger.sql: the copies each member held (plus those spent or converted) before the ledger started, ref (''opening'', ''card_ledger.sql''). Old rows only: the seed runs only on an empty ledger.'),
  ('card', 'pack', 'active', '2026-10-07', 'Cards pulled from a pack open (open_packs -> add_cards_to_player -> card_move, ref (''open'', the open id of the pack_ledger opened rows)).'),
  ('card', 'test_pack', 'active', '2026-10-07', 'Cards a tester draws with no pack spent (the bot openTestPacks -> add_cards_to_player with no open in the transaction; ref (''test_open'', a new id)).'),
  ('card', 'gift_sent', 'active', '2026-10-07', 'A card a member gives to another member: the sender''s -1 row (gift_card, ref (''gift'', gift_claims.id)).'),
  ('card', 'gift_received', 'active', '2026-10-07', 'A card gift from another member, claimed in the bell (claim_gift -> add_card_to_player ''gift'', gift reason member_gift; ref (''gift'', id)).'),
  ('card', 'event', 'active', '2026-10-07', 'A card gift that is not from a member (an event or launch card, give_card_gift), claimed in the bell (claim_gift -> add_card_to_player ''gift''; ref (''gift'', id)).'),
  ('card', 'trade', 'active', '2026-10-07', 'Both sides of an accepted trade, -1 and +1 for each member (accept_trade, ref (''trade_offer'', id)).'),
  ('card', 'auction', 'active', '2026-10-07', 'Both sides of a confirmed auction bid (confirm_bid, ref (''auction'', id)).'),
  ('card', 'shop', 'active', '2026-10-07', 'A card of the day bought in the Shop (buy_shop_item -> add_card_to_player ''shop'', ref (''shop_card'', ''<day>:<slot>'')).'),
  ('card', 'convert', 'active', '2026-10-07', 'Copies turned into Shards (convert_dupes, ref (''shard_ledger'', the Shards row id)).'),
  ('card', 'ascend', 'active', '2026-10-07', 'Copies spent on an Ascension star (ascend_card, ref (''ascension'', ''<card>:<star>'')).'),
  ('card', 'dungeon_loot', 'active', '2026-10-07', 'Cards from a Dungeon run when it ends (dungeon_settle, ref (''dungeon_run'', dungeon_runs.id)).'),
  ('card', 'dungeon_prize', 'active', '2026-10-07', 'A card in a Dungeon or Gauntlet board prize (dungeon_pay -> add_card_to_player ''dungeon_prize'', ref (''dungeon_payout'', ''<mode>:<period>'')).'),
  ('card', 'admin', 'active', '2026-10-07', 'A card move with no known source: add_card_to_player with an unknown source, remove_card_from_player (ref (''tx'', the transaction id)). card_ledger_reconcile() is not ok while such a row exists.'),
  -- shard_ledger (11)
  ('shard', 'daily', 'active', '2026-10-07', 'The Shards of a daily task (claim_daily; claim_daily_earn for the two chat dailies; ref (''daily_claim'', ''<day>:<task>'')).'),
  ('shard', 'dungeon', 'active', '2026-10-07', 'Dungeon Shards: run loot when a run ends (dungeon_settle, ref (''run'', dungeon_runs.id)) and a Dungeon or Gauntlet board prize (dungeon_pay, ref (''dungeon_payout'', ''<mode>:<period>'')).'),
  ('shard', 'dupes', 'active', '2026-10-07', 'Copies turned into Shards (convert_dupes, ref (''card'', the card id); the card_ledger convert row points back at this row).'),
  ('shard', 'event', 'active', '2026-10-07', 'The Shards in a bell gift (gift_claims.shards, for example give_shards_gift_all), paid by claim_gift (ref (''gift'', id)).'),
  ('shard', 'milestone', 'active', '2026-10-07', 'The Shards of an achievement track tier (claim_achievement_tiers, ref (''achievement'', the tier key)).'),
  ('shard', 'shop', 'active', '2026-10-07', 'Shards spent in the Shop: packs, a card of the day or a paid stat reset (buy_shop_item, - the price, ref (''shop_purchase'', id)).'),
  ('shard', 'admin', 'active', '2026-10-07', 'A manual grant or reversal by an admin. No writer in the code: grant_shards called by hand with a ref.'),
  ('shard', 'expedition', 'reserved', '2026-10-07', 'Planned: the Shards from an Expedition (cards sent on timed missions; docs/activities/05-expeditions.md). No writer yet.'),
  ('shard', 'arena', 'reserved', '2026-10-07', 'Planned: the PvP Arena fight and season Shards (docs/activities/04-pvp-arena.md, arena_finish). No writer yet.'),
  ('shard', 'wandering', 'reserved', '2026-10-07', 'Planned: the Shards for a Wandering Monster that falls in time, by share of the damage (docs/activities/06-wandering-monsters.md, wandering_close). No writer yet.'),
  ('shard', 'minigame', 'reserved', '2026-10-07', 'Planned: the Shards from the Mini Games and their Today boards (docs/activities/07-mini-games.md). No writer yet.')
on conflict (ledger, reason) do nothing;

-- 3. The generated columns ---------------------------------------------------------------------------------------
alter table public.pack_ledger add column if not exists ledger text generated always as ('pack') stored;
alter table public.card_ledger add column if not exists ledger text generated always as ('card') stored;
alter table public.shard_ledger add column if not exists ledger text generated always as ('shard') stored;
alter table public.gift_claims add column if not exists reason_ledger text
  generated always as (case when kind <> 'card' and amount <> 0 then 'pack' end) stored;

-- 4. The foreign keys replace the reason checks (the same names) ------------------------------------------------
do $fk$
declare t text[]; bad text;
begin
  -- Every reason in use must be seeded (else the foreign key below fails with a less clear message).
  select string_agg(distinct u.ledger || ':' || u.reason, ', ') into bad
    from (select ledger, reason from public.pack_ledger union select ledger, reason from public.card_ledger
          union select ledger, reason from public.shard_ledger
          union select reason_ledger, reason from public.gift_claims where reason_ledger is not null) u
   where not exists (select 1 from public.ledger_reasons r where r.ledger = u.ledger and r.reason = u.reason);
  if bad is not null then raise exception 'ledger_reasons.sql: reasons in use that have no ledger_reasons row: %', bad; end if;
  foreach t slice 1 in array array[
    ['pack_ledger', 'pack_ledger_reason_check', 'ledger'],
    ['card_ledger', 'card_ledger_reason_check', 'ledger'],
    ['shard_ledger', 'shard_ledger_reason_check', 'ledger'],
    ['gift_claims', 'gift_claims_pack_reason_check', 'reason_ledger']] loop
    if exists (select 1 from pg_constraint where conrelid = ('public.' || t[1])::regclass and conname = t[2] and contype = 'c') then
      execute format('alter table public.%I drop constraint %I', t[1], t[2]);
    end if;
    if not exists (select 1 from pg_constraint where conrelid = ('public.' || t[1])::regclass and conname = t[2] and contype = 'f') then
      execute format('alter table public.%I add constraint %I foreign key (%I, reason) references public.ledger_reasons (ledger, reason)',
                     t[1], t[2], t[3]);
    end if;
  end loop;
end $fk$;

-- 5. A new row needs an active or reserved reason ----------------------------------------------------------------
-- tg_argv: the ledger, the constraint name for the error. A null reason passes (the column is not null anyway).
create or replace function public.ledger_reason_guard()
returns trigger
language plpgsql
set search_path = public
as $function$
declare v_status text;
begin
  if new.reason is null then return new; end if;
  select status into v_status from ledger_reasons where ledger = tg_argv[0] and reason = new.reason;
  if v_status is null or v_status = 'retired' then
    raise exception '%: the % reason "%" is %', tg_table_name, tg_argv[0], new.reason,
      case when v_status is null then 'not in ledger_reasons' else 'retired (old rows only)' end
      using errcode = 'check_violation', constraint = tg_argv[1], table = tg_table_name,
            hint = 'Add the reason to public.ledger_reasons (with a note) before code writes it.';
  end if;
  return new;
end $function$;
revoke execute on function public.ledger_reason_guard() from public, anon, authenticated;

create or replace trigger pack_ledger_reason_guard before insert or update of reason on public.pack_ledger
  for each row execute function public.ledger_reason_guard('pack', 'pack_ledger_reason_check');
create or replace trigger card_ledger_reason_guard before insert or update of reason on public.card_ledger
  for each row execute function public.ledger_reason_guard('card', 'card_ledger_reason_check');
create or replace trigger shard_ledger_reason_guard before insert or update of reason on public.shard_ledger
  for each row execute function public.ledger_reason_guard('shard', 'shard_ledger_reason_check');
-- A pack gift (the rows of reason_ledger = 'pack'): its reason goes into pack_ledger when it is claimed.
create or replace trigger gift_claims_reason_guard before insert or update of reason, kind, amount on public.gift_claims
  for each row when (new.kind <> 'card' and new.amount <> 0)
  execute function public.ledger_reason_guard('pack', 'gift_claims_pack_reason_check');

-- 6. Documentation -----------------------------------------------------------------------------------------------
comment on table public.ledger_reasons is
  '[players-economy] The allowed reasons of the three ledgers (pack_ledger, card_ledger, shard_ledger), one row each, with its meaning. Each ledger has a foreign key (ledger, reason) to this table, and a trigger (ledger_reason_guard) refuses a new row with an unknown or retired reason. Add a reason: insert one row with its note before code writes it. A new pack reason that counts to the daily cap must also go into earned_today().';
comment on column public.ledger_reasons.ledger is 'The ledger: pack (pack_ledger), card (card_ledger) or shard (shard_ledger). A pack gift (gift_claims) uses the pack reasons.';
comment on column public.ledger_reasons.reason is 'The reason value that the ledger rows hold (lower case, digits and _).';
comment on column public.ledger_reasons.note is 'What the reason means: what the move is, which function writes it and its ref (ref_kind, ref_id).';
comment on column public.ledger_reasons.status is
  'active: writers use it. reserved: a planned feature with no writer yet (new rows are accepted). retired: old rows only, a new row is refused (ledger_reason_guard). Retire a reason only when no writer and no waiting gift (gift_claims) uses it.';
comment on column public.ledger_reasons.added_on is 'The day the row was added to this table. The seed (ledger_reasons.sql) has 2026-10-07; a seeded reason can be older.';

comment on column public.pack_ledger.ledger is 'Always ''pack'' (a stored generated constant): the first column of the foreign key (ledger, reason) -> ledger_reasons.';
comment on column public.card_ledger.ledger is 'Always ''card'' (a stored generated constant): the first column of the foreign key (ledger, reason) -> ledger_reasons.';
comment on column public.shard_ledger.ledger is 'Always ''shard'' (a stored generated constant): the first column of the foreign key (ledger, reason) -> ledger_reasons.';
comment on column public.gift_claims.reason_ledger is '''pack'' for a pack gift (kind <> ''card'' and amount <> 0), else null (generated). With reason, the foreign key to ledger_reasons: a pack gift must have a pack reason. Null skips the key.';

comment on column public.pack_ledger.reason is 'Why: a pack reason in ledger_reasons (its note gives the meaning). Foreign key pack_ledger_reason_check; a new row needs an active or reserved reason (ledger_reason_guard). The earned_ reasons count to the daily cap (earned_today()).';
comment on column public.card_ledger.reason is 'Why: a card reason in ledger_reasons (its note gives the meaning). Foreign key card_ledger_reason_check; a new row needs an active or reserved reason (ledger_reason_guard).';
comment on column public.shard_ledger.reason is 'Why: a shard reason in ledger_reasons (its note gives the meaning). Foreign key shard_ledger_reason_check; a new row needs an active or reserved reason (ledger_reason_guard).';
comment on column public.gift_claims.reason is 'The pack_ledger reason used when the gift is claimed. A pack gift needs an active or reserved pack reason in ledger_reasons (foreign key gift_claims_pack_reason_check, ledger_reason_guard).';

comment on constraint pack_ledger_reason_check on public.pack_ledger is 'Foreign key (ledger, reason) -> ledger_reasons (ledger_reasons.sql; the old check name, which pack_ledger_reconcile() reads).';
comment on constraint card_ledger_reason_check on public.card_ledger is 'Foreign key (ledger, reason) -> ledger_reasons (ledger_reasons.sql; the old check name, which card_ledger_reconcile() reads).';
comment on constraint shard_ledger_reason_check on public.shard_ledger is 'Foreign key (ledger, reason) -> ledger_reasons (ledger_reasons.sql; the old check name, which shard_ledger_reconcile() reads).';
comment on constraint gift_claims_pack_reason_check on public.gift_claims is 'Foreign key (reason_ledger, reason) -> ledger_reasons for a pack gift (ledger_reasons.sql; the old check name).';

comment on function public.ledger_reason_guard() is 'Trigger on pack_ledger, card_ledger, shard_ledger and the pack gifts of gift_claims: a new row (or a changed reason) needs a reason in ledger_reasons with status active or reserved. Else check_violation (the old check error class).';

notify pgrst, 'reload schema';
