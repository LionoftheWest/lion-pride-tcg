-- balance_economy.sql (2026-10-06, audit step 5; Nathan: "yes please"). Stacks on balance_table.sql,
-- achievement_tracks.sql, pack_ledger_strict.sql and card_ledger.sql.
--
-- The rule (Nathan 2026-10-03, CLAUDE.md "Database design"): every number that changes card power OR A REWARD lives
-- in public.balance. This file moves the ECONOMY numbers there, with their LIVE values (no value changes):
--   daily                 the Dailies: the daily pack cap (ONE value; it had two code defaults), check-in, streak,
--                         chat, the task packs, the Hunt need, the voice minutes, the Shards of a daily claim
--   pack_earn_multiplier  the earn dial (was settings.pack_earn_multiplier; the bot /packrate sets it)
--   pulls                 the pull rates per card and the pack size (were constants in the bot draw.ts)
--   hunt_prizes           the Raid prizes (was settings.hunt_prizes)
--   dungeon_prizes        the Dungeon daily and Gauntlet weekly prizes (settings.dungeon_prizes keeps the flags)
--   dungeon_rewards       the Dungeon run rewards (Shards, loot, chest odds; settings.dungeon keeps the rest)
--   shards                the Shards economy (prices, stock, dupe values; settings.shards keeps the flag)
--   welcome_packs         the packs for a new member (was settings.welcome_packs)
--   card_effect_caps      the prank / boon limits (was settings.card_effect_caps; balance_table.sql "phase 2")
--   achievement_rewards   + badges: the rewards of the 50 one-time achievements (were in tcg-activity/src/achievements.js
--                         and SENT by the Activity; claim_achievement now reads them and ignores the sent numbers)
-- The flags (enabled, from) stay in settings: they are switches, not balance numbers.
--
-- Every replaced function starts from the LIVE text (a dump of live, 2026-10-06, after card_ledger.sql #229) and changes
-- only the reads: a settings read or a literal becomes a balance read. With today's values each one returns what it
-- returned before (card-studio/scripts/test-balance-economy.mjs compares old and new). pack_ledger_strict.sql,
-- card_ledger.sql, balance_table.sql, effects_spread.sql and gauntlet.sql are rebuilt in the same PR with the same reads,
-- so a re-run never puts a settings read back. Idempotent.
--
-- GUARD (the combat_core.sql rule): this file replaces the live functions below. It runs only on the exact live text
-- it was built from (the first md5) or on its own result (the second md5). Any other change stops it here.
do $g$
declare x text[]; m text;
begin
  if to_regclass('public.balance') is null then raise exception 'balance_economy.sql: apply balance_table.sql first'; end if;
  foreach x slice 1 in array array[
  -- shard_ledger_strict.sql (2026-10-07) rebuilt the Shard refs: the second md5 of claim_daily, claim_daily_earn and dungeon_pay is its result.
  -- balance_settings_numbers.sql (2026-10-07) moved the Dungeon and Gauntlet numbers to balance: the second md5 of dungeon_cfg and gauntlet_view is its result (the same text below).
    ['claim_daily(text,text)', 'f3e6465d7321c8dcc1e577ae2183a71f', '06541bd131cdb91d3af34abdcf87b675'],
    ['claim_daily_earn(text,date,integer,integer,integer)', '6b1d1f2e7195418176f8523a89c0aefa', '11c7903f3652523f35e4860e43e0710e'],
    ['dailies_view(text)', '5b1085b985cb8d92754636700eac4210', 'a6fd7a1215aa849a5ffcf5f100ebfc4e'],
    ['dailies_tasks(text)', 'f6cd0494b958889336acbdfb808aa5a4', '4fe738d217b6a115b373e6f4dca111c1'],
    ['add_voice_minutes(text[])', 'ba6bc11f68058fdf820770d7afa8d808', '9752ca75dd040d5f115263d6d7541b2d'],
    ['claim_achievement(text,text,integer,text,text)', '4f9185d535810a84c48ccef18e7d1c79', '34f4be6488a0d45577e2745381e41f11'],
    ['settle_hunt(bigint)', '4235a21d9b5c8978c96c69eb18068de0', 'bb5cc060c1966f554db98be41bee7c44'],
    ['play_card_effect(text,bigint,text)', '2fc1d7c6fa08f03c87cac5c9caaa9c6a', 'ab436a5ddf42c3ac95f196f2c9b1ba0d'],
    ['dungeon_pay(text,date)', '4f2bec1174f40079ffbaccd62d47bb5a', 'c39c6a3b51b2206c2416412a1f49e6cb'],
    ['dungeon_prize_tick()', '7a98852db2bd22c66ee443a1e053fd44', '5300f541d81b66010ff65074027e89fa'],
    ['gauntlet_view(text)', 'fea70762286ef3a464fa186fd63ade5c', '0b729835b6ce3b124f0c947b1098a8de'],
    ['welcome_packs()', '409d04f25d7b784e51fd0128b0cbceaa', 'ccdd29c234f840f3905073c8c45885fc'],
    ['shard_cfg()', '2b6bc0083ea1357a1b1b5eb0810937fd', '471e2913d9da4f9f4b38140cecb98da4'],
    ['dungeon_cfg()', 'd868897b5cfc542894e5f5893005cb43', '7bcbe6253212fddee36af721f2252508']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m not in (x[2], x[3]) then raise exception 'balance_economy.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

-- 1. The values. A value that lives in settings today moves with its LIVE value (the literal is only the fallback
--    for a fresh database). `on conflict do nothing`: a re-run never resets a tuned value.
insert into public.balance (key, value, note) values
('daily', '{"cap":5,"shards":40,"checkin":1,"streak_cycle":7,"streak_days":[3,7],"streak_bonus":1,"chat":1,"chat_bonus_at":25,"chat_bonus":1,"hunt_need":1,"voice_minutes":30,"tasks":{"hunt":1,"voice":1,"social":1,"dungeon":1,"gauntlet":1}}'::jsonb || coalesce((select jsonb_strip_nulls(jsonb_build_object('cap', value->'cap', 'shards', value->'shards', 'voice_minutes', value->'voice_minutes')) from public.settings where key = 'dailies'), '{}'::jsonb),
 'The Dailies (dailies_tasks, claim_daily, claim_daily_earn, dailies_view; the bot reads chat_bonus_at). cap = the most earned packs in one MT day (every earned_* reason counts: earned_today). checkin = the check-in packs; streak_bonus more on the streak days (day N of each streak_cycle-day streak: 3 and 7). chat = the packs for the first message of the day, chat_bonus more at chat_bonus_at messages. tasks = the packs of each other daily; hunt_need = the cards to commit in the Hunt; voice_minutes = the minutes in voice with someone. Every pack amount x pack_earn_multiplier, never past cap. shards = the Shards of every daily claim (also at the cap). The on/off flag is settings.dailies.enabled.'),
('pack_earn_multiplier', coalesce((select value from public.settings where key = 'pack_earn_multiplier' and jsonb_typeof(value) = 'number'), '1'),
 'The earn dial: every earned pack (the dailies and the chat packs) x this, rounded. 0 = earning paused (the launch reset, 2026-09-30). The bot /packrate command sets it.'),
('pulls', '{"pack_size":5,"rates":{"normal":0.9398,"illustrated_rare":0.05,"secret_rare":0.006,"full_art":0.004,"gold":0.0002}}',
 'Pack opening (the bot draw.ts, 60 s cache): pack_size cards in one pack; each card rolls its rarity with rates (per card; they must add up to 1). Gold 0.0002 = 0.02% (Nathan 2026-10-02, PR #105). The Lucky Pull boon multiplies the rare rates of the first card (up to effect_primitives.max_amount). Never change a rate without Nathan.'),
('hunt_prizes', coalesce((select value from public.settings where key = 'hunt_prizes'), '{"base":1,"ranks":[7,5,4,3,3,3,3,3,3,3]}'),
 'Raid prizes (settle_hunt; the bot result post lists them): the hunter in place N by damage gets ranks[N-1] packs (1st 7, 2nd 5, 3rd 4, 4th to 10th 3), every other hunter base. Paid when the boss falls or escapes.'),
('dungeon_prizes', coalesce((select value - 'from' - 'enabled' from public.settings where key = 'dungeon_prizes'), '{"daily":[{"shards":300},{"shards":200},{"shards":150},{"shards":50},{"shards":50},{"shards":50},{"shards":50},{"shards":50},{"shards":50},{"shards":50}],"weekly":[{"odds":{"secret_rare":30,"illustrated_rare":70},"cards":3,"packs":5,"shards":500},{"odds":{"normal":60,"secret_rare":8,"illustrated_rare":32},"cards":2,"packs":3,"shards":300},{"odds":{"normal":75,"illustrated_rare":25},"cards":1,"packs":2,"shards":200},{"packs":1},{"packs":1},{"packs":1},{"packs":1},{"packs":1},{"packs":1},{"packs":1}]}'),
 'Dungeon and Gauntlet prizes (dungeon_pay, dungeon_prize_tick, gauntlet_view through dungeon_prizes_cfg): daily = the Dungeon day board by place, weekly = the Gauntlet week board by place (packs, Shards, cards; odds = the card rarity odds in %). The flags (enabled, from) stay in settings.dungeon_prizes.'),
('dungeon_rewards', '{"shards_kill":1,"shards_room":5,"floor_shards":10,"run_shards_cap":300,"loot_chance":0.06,"loot":[{"to":3,"normal":1,"secret_rare":0,"illustrated_rare":0},{"to":6,"normal":0.9,"secret_rare":0,"illustrated_rare":0.1},{"to":9,"normal":0.8,"secret_rare":0.02,"illustrated_rare":0.18},{"to":999,"normal":0.7,"secret_rare":0.05,"illustrated_rare":0.25}],"chest_rarity":{"1":[100,0,0],"2":[80,18,2],"3":[55,38,7],"4":[35,50,15],"5":[15,50,35]}}'::jsonb || coalesce((select jsonb_strip_nulls(jsonb_build_object('shards_kill', value->'shards_kill', 'shards_room', value->'shards_room', 'floor_shards', value->'floor_shards', 'run_shards_cap', value->'run_shards_cap', 'loot_chance', value->'loot_chance', 'loot', value->'loot', 'chest_rarity', value->'chest_rarity')) from public.settings where key = 'dungeon'), '{}'::jsonb),
 'Dungeon run rewards (dungeon_cfg merges this key into settings.dungeon): shards_kill per kill, floor_shards per floor, shards_room per room, at most run_shards_cap Shards in one run; loot_chance = the card drop chance, loot = the drop rarity odds up to floor "to"; chest_rarity = the chest rarity odds by chest tier. The fight numbers and the flag stay in settings.dungeon.'),
('shards', '{"stock":{"normal":6,"secret_rare":1,"illustrated_rare":3},"prices":{"normal":100,"secret_rare":1500,"illustrated_rare":450},"pack_price":250,"dupe_values":{"gold":250,"normal":5,"full_art":100,"secret_rare":40,"illustrated_rare":15},"cooldown_days":7,"stat_reset_price":150,"max_packs_per_buy":10}'::jsonb || coalesce((select jsonb_strip_nulls(jsonb_build_object('stock', value->'stock', 'prices', value->'prices', 'pack_price', value->'pack_price', 'dupe_values', value->'dupe_values', 'cooldown_days', value->'cooldown_days', 'stat_reset_price', value->'stat_reset_price', 'max_packs_per_buy', value->'max_packs_per_buy')) from public.settings where key = 'shards'), '{}'::jsonb),
 'The Shards economy (shard_cfg merges this key with the flag settings.shards.enabled): prices = a Shop card by rarity, pack_price, stat_reset_price; stock = the Shop cards each day by rarity; cooldown_days = the days before a card can come back to the stock; dupe_values = the Shards for one converted copy by rarity; max_packs_per_buy.'),
('welcome_packs', coalesce((select value from public.settings where key = 'welcome_packs' and jsonb_typeof(value) = 'number'), '10'),
 'Packs for a new member (the welcome_packs trigger: a New Player Bonus gift to redeem in the bell). 0 = none.'),
('card_effect_caps', coalesce((select value from public.settings where key = 'card_effect_caps'), '{"pair_per_day":3,"send_per_day":10,"gift_pack_per_week":2,"prank_recv_per_day":5,"timeout_recv_per_day":2}'),
 'Prank and boon limits (play_card_effect; the Community tab shows them): send_per_day = plays by one member in a day, pair_per_day = plays on the same member in a day, prank_recv_per_day = pranks one member can get in a day, timeout_recv_per_day = timeouts, gift_pack_per_week = Gift Pack boons per sender and per target in 7 days. 0 = no limit.')
on conflict (key) do nothing;

-- The one-time achievements: their rewards move from the Activity code into achievement_rewards.badges.
update public.balance
   set value = value || jsonb_build_object('badges', '{"first":{"packs":1},"own10":{"packs":1},"own25":{"packs":2},"own50":{"packs":2,"frame":"silver"},"own100":{"packs":3,"title":"Archivist","frame":"gold"},"s1":{"packs":5,"title":"Season 1 Champion","frame":"holo"},"ir1":{"packs":1},"sr1":{"packs":1},"fa1":{"packs":1},"g1":{"packs":1},"ir10":{"packs":2,"title":"Rare Hunter"},"sr5":{"packs":3,"title":"Secret Keeper"},"fa5":{"packs":3,"title":"Full House"},"g5":{"packs":3,"title":"Golden Touch","frame":"gold"},"fire5":{"packs":1,"title":"Flame Keeper"},"light5":{"packs":1,"title":"Dawn Bringer"},"lightning5":{"packs":1,"title":"Storm Chaser"},"nature5":{"packs":1,"title":"Wild Child"},"shadow5":{"packs":1,"title":"Night Walker"},"psychic5":{"packs":1,"title":"Mind Reader"},"water5":{"packs":1,"title":"Tide Caller"},"rainbow":{"packs":3,"title":"Rainbow Pride","frame":"holo"},"smash20":{"packs":2,"title":"Smash Fan"},"poke10":{"packs":2,"title":"Trainer"},"party5":{"packs":1,"title":"Party Starter"},"mc5":{"packs":1,"title":"Blockhead"},"place3":{"packs":1},"moment10":{"packs":2,"title":"Timekeeper"},"item5":{"packs":1,"title":"Loot Goblin"},"support10":{"packs":2,"title":"Support Crew"},"royal10":{"packs":2,"title":"Royalty"},"beast10":{"packs":2,"title":"Beast Master"},"fullset":{"packs":3,"title":"Completionist"},"double5":{"packs":2},"dup2":{"packs":1},"dup5":{"packs":2},"asc1":{"packs":1},"asc3":{"packs":2,"frame":"silver"},"asc5":{"packs":3,"title":"Maxed Out","frame":"gold"},"packs10":{"packs":1},"gift1":{"packs":1,"title":"Generous"},"hunt1":{"packs":1},"hunt4":{"packs":2,"title":"Hunt Regular"},"dmg1k":{"packs":1,"title":"Heavy Hitter"},"hit500":{"packs":2,"title":"Big Hitter"},"slay1":{"packs":2},"slay3":{"packs":3,"title":"Boss Breaker","frame":"silver"},"boon1":{"packs":1},"prank5":{"packs":2,"title":"Prankster"},"trade1":{"packs":1,"title":"Trader"}}'::jsonb),
       note = note || ' badges = the 50 one-time achievements (claim_achievement): packs, and a title / frame for some.'
 where key = 'achievement_rewards' and not value ? 'badges';
do $c$ begin
  if not exists (select 1 from public.balance where key = 'achievement_rewards' and value ? 'badges') then
    raise exception 'balance_economy.sql: balance achievement_rewards is missing (apply achievement_tracks.sql first)';
  end if;
end $c$;

-- 2. The economy shape rules (on top of balance_check): the pull rates add up to 1, a pack has 1 to 20 cards,
--    a streak cycle is at least 1 day. A wrong rate table would change every pack, so it is refused.
create or replace function public.balance_check_economy() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_sum numeric;
begin
  if new.key = 'pulls' then
    select sum((r.value #>> '{}')::numeric) into v_sum from jsonb_each(new.value->'rates') r;
    if v_sum is null or abs(v_sum - 1) > 0.000000001 then
      raise exception 'balance pulls: the rates must add up to 1 (now %)', v_sum;
    end if;
    if (new.value->>'pack_size')::numeric not between 1 and 20 or (new.value->>'pack_size')::numeric % 1 <> 0 then
      raise exception 'balance pulls: pack_size must be a whole number from 1 to 20';
    end if;
  elsif new.key = 'daily' then
    if (new.value->>'streak_cycle')::numeric < 1 then raise exception 'balance daily: streak_cycle must be at least 1'; end if;
  end if;
  return new;
end $$;
drop trigger if exists balance_check_economy on public.balance;
create trigger balance_check_economy before insert or update on public.balance
  for each row execute function public.balance_check_economy();
do $c$ begin
  -- the values inserted above pass the rule (an insert that was skipped by on conflict is checked here too)
  perform 1 from public.balance where key = 'pulls'
    and abs((select sum((r.value #>> '{}')::numeric) from jsonb_each(value->'rates') r) - 1) <= 0.000000001;
  if not found then raise exception 'balance_economy.sql: balance pulls.rates do not add up to 1'; end if;
end $c$;

-- 3. The prize accessor: the flags from settings, the prizes from balance.
create or replace function public.dungeon_prizes_cfg() returns jsonb
language sql stable set search_path to 'public' as $$
  select coalesce((select value from settings where key = 'dungeon_prizes'), '{}'::jsonb) || balance_get('dungeon_prizes');
$$;
revoke all on function public.dungeon_prizes_cfg() from public, anon, authenticated;
revoke all on function public.balance_check_economy() from public, anon, authenticated;

-- 4. The functions that read a moved number (LIVE text; only the reads change).
-- claim_daily
CREATE OR REPLACE FUNCTION public.claim_daily(p_player text, p_task text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := (balance_get('pack_earn_multiplier') #>> '{}')::numeric;
  per int; ck int; t jsonb; cap int; amt int; bal int; sh int := balance_num('daily', 'shards')::int; sbal int;
  d date := (now() at time zone 'America/Denver')::date;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  if mult <= 0 then return jsonb_build_object('ok', false, 'error', 'paused'); end if;
  if p_task not in ('checkin', 'hunt', 'voice', 'social', 'dungeon', 'gauntlet') then return jsonb_build_object('ok', false, 'error', 'bad_task'); end if;
  perform 1 from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;
  select x into t from jsonb_array_elements(dailies_tasks(p_player)) x where x->>'task' = p_task;
  if coalesce((t->>'claimed')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if not coalesce((t->>'done')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'not_done'); end if;
  per := greatest(round(mult), 0)::int;
  ck := balance_num('daily', 'checkin')::int * per; -- the check-in packs; the rest of a check-in claim is the streak bonus
  cap := balance_num('daily', 'cap')::int;
  amt := greatest(least((t->>'reward')::int * per, greatest(cap - earned_today(p_player), 0)), 0);
  -- At the earn limit a daily still pays its Shards (0 packs); with no Shards set, it is capped.
  if amt <= 0 and sh <= 0 then return jsonb_build_object('ok', false, 'error', 'capped'); end if;
  -- Stream Saver (effects_outside.sql): a gap of exactly one missed day and an unused streak_shield:
  -- the shield covers yesterday (options.shield_day, counted by checkin_streak) and is used up.
  if p_task = 'checkin' and streak_shield_waiting(p_player, d) then
    update player_effects set consumed_at = now(), options = options || jsonb_build_object('shield_day', to_char(d - 1, 'YYYY-MM-DD'))
     where id = (select id from player_effects
                  where player_id = p_player and primitive = 'streak_shield' and consumed_at is null
                    and starts_at <= now() and (expires_at is null or expires_at > now())
                  order by created_at limit 1 for update skip locked);
  end if;
  insert into daily_claims (player_id, day, task, amount) values (p_player, d, p_task, amt);
  if amt > 0 then
    if p_task = 'checkin' and amt > ck then
      perform grant_packs(p_player, ck, 'earned_checkin', null, 'daily_claim', d::text || ':checkin');
      bal := grant_packs(p_player, amt - ck, 'earned_streak', null, 'daily_claim', d::text || ':checkin');
    else
      bal := grant_packs(p_player, amt, 'earned_' || p_task, null, 'daily_claim', d::text || ':' || p_task);
    end if;
  else
    bal := (select pack_balance from players where id = p_player);
  end if;
  if sh > 0 then sbal := grant_shards(p_player, sh, 'daily', 'daily_claim', d::text || ':' || p_task); end if;
  return jsonb_build_object('ok', true, 'task', p_task, 'packs', amt, 'shards', sh, 'balance', bal, 'shard_balance', sbal,
    'view', dailies_view(p_player));
end $function$;

-- claim_daily_earn
CREATE OR REPLACE FUNCTION public.claim_daily_earn(p_player_id text, p_date date, p_base integer, p_bonus integer, p_bonus_threshold integer)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare a record; granted int := 0; amt int;
  cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  cap int := balance_num('daily', 'cap')::int;
  mult numeric := (balance_get('pack_earn_multiplier') #>> '{}')::numeric;
  sh int := case when coalesce((cfg->>'enabled')::boolean, false) and mult > 0 then balance_num('daily', 'shards')::int else 0 end;
begin
  -- p_base, p_bonus and p_bonus_threshold are no longer read (balance_economy.sql): the packs are balance daily.chat /
  -- daily.chat_bonus x pack_earn_multiplier, the bonus at daily.chat_bonus_at messages. The bot still sends them.
  select message_count, base_claimed, bonus_claimed into a
    from daily_activity where player_id = p_player_id and activity_date = p_date for update;
  if not found then return 0; end if;
  if a.message_count >= 1 and not a.base_claimed then
    update daily_activity set base_claimed = true where player_id = p_player_id and activity_date = p_date;
    amt := least(balance_num('daily', 'chat')::int * greatest(round(mult), 0)::int, greatest(cap - earned_today(p_player_id), 0));
    -- One daily_claims row per chat claim, also at the cap (amount 0), as claim_daily does: each claim is traceable.
    insert into daily_claims (player_id, day, task, amount) values (p_player_id, p_date, 'chat', greatest(amt, 0));
    if amt > 0 then perform grant_packs(p_player_id, amt, 'earned_daily', null, 'daily_claim', p_date::text || ':chat'); granted := granted + amt; end if;
    if sh > 0 then perform grant_shards(p_player_id, sh, 'daily', 'daily_claim', p_date::text || ':chat'); end if;
  end if;
  if a.message_count >= balance_num('daily', 'chat_bonus_at') and not a.bonus_claimed then
    update daily_activity set bonus_claimed = true where player_id = p_player_id and activity_date = p_date;
    amt := least(balance_num('daily', 'chat_bonus')::int * greatest(round(mult), 0)::int, greatest(cap - earned_today(p_player_id), 0));
    insert into daily_claims (player_id, day, task, amount) values (p_player_id, p_date, 'chat_bonus', greatest(amt, 0));
    if amt > 0 then perform grant_packs(p_player_id, amt, 'earned_bonus', null, 'daily_claim', p_date::text || ':chat_bonus'); granted := granted + amt; end if;
    if sh > 0 then perform grant_shards(p_player_id, sh, 'daily', 'daily_claim', p_date::text || ':chat_bonus'); end if;
  end if;
  return granted;
end $function$;

-- dailies_view
CREATE OR REPLACE FUNCTION public.dailies_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := (balance_get('pack_earn_multiplier') #>> '{}')::numeric;
  d date := (now() at time zone 'America/Denver')::date;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'paused', mult <= 0,
    'day', d, 'resets_at', (d + 1)::timestamp at time zone 'America/Denver',
    'cap', balance_num('daily', 'cap')::int, 'earned', earned_today(p_player),
    'shards', balance_num('daily', 'shards')::int,
    'shards_today', (select coalesce(sum(amount), 0) from shard_ledger where player_id = p_player and reason = 'daily'
                      and created_at >= d::timestamp at time zone 'America/Denver'),
    'tasks', dailies_tasks(p_player));
end $function$;

-- dailies_tasks
CREATE OR REPLACE FUNCTION public.dailies_tasks(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  d date := (now() at time zone 'America/Denver')::date;
  t0 timestamptz := d::timestamp at time zone 'America/Denver';
  vneed int := balance_num('daily', 'voice_minutes')::int;
  hneed int := balance_num('daily', 'hunt_need')::int; -- one fight with the boss (an attack or a support play), not the 8-card daily cap
  msgs int; base boolean; bonus boolean; used int; mins int; social boolean; live boolean;
  prior int; ci boolean;
  dgon boolean; gaon boolean; dg boolean; ga boolean;   -- the Dungeon and the Gauntlet dailies (Nathan, 2026-10-03)
  claimed text[];
begin
  select message_count, base_claimed, bonus_claimed into msgs, base, bonus
    from daily_activity where player_id = p_player and activity_date = d;
  -- The player's own committed cards (an attack or a support play). Not hunt_hits: a Raid
  -- Crasher credit row there is raid damage only (trade_ledger_raid_credit.sql).
  select count(distinct card_id) into used from hunt_card_hp where player_id = p_player and hit_date = d;
  live := exists (select 1 from hunts where status = 'active' and opens_at <= now() and closes_at > now());
  select minutes into mins from voice_minutes where player_id = p_player and day = d;
  social := exists (select 1 from card_trades where created_at >= t0
                      and (from_id = p_player or to_id = p_player) and from_cards <> to_cards)
         or exists (select 1 from card_plays where player_id = p_player and kind = 'boon' and created_at >= t0
                      and aimed_at is not null and aimed_at <> p_player and outcome <> 'blocked');
  select coalesce(array_agg(task), '{}') into claimed from daily_claims where player_id = p_player and day = d;
  prior := checkin_streak(p_player, d);
  ci := 'checkin' = any(claimed);
  -- A run started today (the Denver day, the same as dungeon_day()) does the daily of its mode. Each daily shows
  -- only while its mode is on.
  dgon := coalesce((select (value->>'enabled')::boolean from settings where key = 'dungeon'), false);
  gaon := dgon and coalesce((select (value->>'enabled')::boolean from settings where key = 'gauntlet'), false);
  dg := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode = 'daily');
  ga := exists (select 1 from dungeon_runs where player_id = p_player and day = d and mode = 'gauntlet');
  return jsonb_build_array(
    jsonb_build_object('task', 'checkin', 'done', true, 'claimed', ci,
      'streak', prior + case when ci then 1 else 0 end,
      'reward', balance_num('daily', 'checkin')::int
        + case when prior % balance_num('daily', 'streak_cycle')::int + 1 in (select x::int from jsonb_array_elements_text(balance_get('daily')->'streak_days') x)
               then balance_num('daily', 'streak_bonus')::int else 0 end),
    jsonb_build_object('task', 'chat', 'auto', true, 'have', coalesce(msgs, 0), 'need', balance_num('daily', 'chat_bonus_at')::int,
      'packs', (select coalesce(sum(amount), 0) from pack_ledger where player_id = p_player and reason in ('earned_daily', 'earned_bonus') and created_at >= t0), 'max', (balance_num('daily', 'chat') + balance_num('daily', 'chat_bonus'))::int),
    jsonb_build_object('task', 'hunt', 'have', least(coalesce(used, 0), hneed), 'need', hneed, 'live', live,
      'done', coalesce(used, 0) >= hneed, 'claimed', 'hunt' = any(claimed), 'reward', balance_num('daily', 'tasks', 'hunt')::int),
    jsonb_build_object('task', 'voice', 'have', least(coalesce(mins, 0), vneed), 'need', vneed,
      'done', coalesce(mins, 0) >= vneed, 'claimed', 'voice' = any(claimed), 'reward', balance_num('daily', 'tasks', 'voice')::int),
    jsonb_build_object('task', 'social', 'have', case when social then 1 else 0 end, 'need', 1,
      'done', social, 'claimed', 'social' = any(claimed), 'reward', balance_num('daily', 'tasks', 'social')::int))
    || case when dgon then jsonb_build_array(jsonb_build_object('task', 'dungeon', 'have', case when dg then 1 else 0 end, 'need', 1,
         'done', dg, 'claimed', 'dungeon' = any(claimed), 'reward', balance_num('daily', 'tasks', 'dungeon')::int)) else '[]'::jsonb end
    || case when gaon then jsonb_build_array(jsonb_build_object('task', 'gauntlet', 'have', case when ga then 1 else 0 end, 'need', 1,
         'done', ga, 'claimed', 'gauntlet' = any(claimed), 'reward', balance_num('daily', 'tasks', 'gauntlet')::int)) else '[]'::jsonb end;
end $function$;

-- add_voice_minutes
CREATE OR REPLACE FUNCTION public.add_voice_minutes(p_ids text[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := coalesce((select value from settings where key = 'dailies'), '{}'::jsonb);
  mult numeric := (balance_get('pack_earn_multiplier') #>> '{}')::numeric;
  n int;
begin
  if coalesce((cfg->>'enabled')::boolean, false) is not true or mult <= 0 then return 0; end if;
  insert into voice_minutes as v (player_id, day, minutes)
    select distinct u.id, (now() at time zone 'America/Denver')::date, 1
    from unnest(p_ids) as u(id) join players p on p.id = u.id
  on conflict (player_id, day) do update set minutes = v.minutes + 1;
  get diagnostics n = row_count;
  return n;
end $function$;

-- claim_achievement
CREATE OR REPLACE FUNCTION public.claim_achievement(p_player text, p_key text, p_packs integer DEFAULT NULL::integer, p_title text DEFAULT NULL::text, p_frame text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare inserted int; bal int; r jsonb; v_packs int;
begin
  -- The reward is balance achievement_rewards.badges (balance_economy.sql). p_packs, p_title and p_frame are no
  -- longer read: an older Activity still sends them.
  r := balance_get('achievement_rewards')->'badges'->p_key;
  if r is null then return jsonb_build_object('ok', false, 'error', 'unknown'); end if;
  v_packs := coalesce((r->>'packs')::int, 0);
  -- The tracks replace these keys (achievement_tracks.sql): never paid again once they are on.
  if ach_tracks_on(p_player) and exists (select 1 from achievement_switch_map where old_key = p_key) then
    return jsonb_build_object('ok', false, 'error', 'retired'); end if;
  insert into achievement_claims (player_id, key, packs, title, frame)
    values (p_player, p_key, v_packs, r->>'title', r->>'frame')
    on conflict (player_id, key) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if v_packs > 0 then
    bal := grant_packs(p_player, v_packs, 'achievement', null, 'achievement', p_key);
    if bal is null then raise exception 'unknown player %', p_player; end if; -- rolls the claim back
  end if;
  return jsonb_build_object('ok', true, 'balance', bal, 'packs', v_packs, 'title', r->>'title', 'frame', r->>'frame');
end; $function$;

-- settle_hunt
CREATE OR REPLACE FUNCTION public.settle_hunt(p_hunt bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_status text; v_settled timestamptz; v_cfg jsonb; v_base int; v_ranks jsonb;
  v_participants int := 0; r record; v_packs int; v_paidtotal int := 0; v_paid jsonb := '[]'::jsonb;
begin
  select status, settled_at into v_status, v_settled from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_settled is not null then return jsonb_build_object('ok', false, 'error', 'already_settled'); end if;
  if v_status not in ('defeated', 'expired') then return jsonb_build_object('ok', false, 'error', 'not_ended'); end if;

  v_cfg := balance_get('hunt_prizes');
  v_base := balance_num('hunt_prizes', 'base')::int;
  v_ranks := coalesce(v_cfg->'ranks', '[]'::jsonb);

  for r in
    select t.player_id, t.dmg,
           case when t.dmg > 0 then row_number() over (order by t.dmg desc, t.first_hit) end as place
      from (select player_id, sum(damage) as dmg, min(id) as first_hit
              from hunt_hits where hunt_id = p_hunt group by player_id) t
     order by t.dmg desc, t.first_hit
  loop
    v_participants := v_participants + 1;
    v_packs := case when r.place is not null and r.place <= jsonb_array_length(v_ranks)
                    then (v_ranks->>(r.place::int - 1))::int else v_base end;
    if v_packs > 0 then perform grant_packs(r.player_id, v_packs, 'hunt_reward', null, 'hunt', p_hunt::text); end if;
    v_paidtotal := v_paidtotal + v_packs;
    v_paid := v_paid || jsonb_build_object('player_id', r.player_id, 'packs', v_packs, 'place', r.place);
  end loop;

  update hunts set settled_at = now() where id = p_hunt;
  return jsonb_build_object('ok', true, 'defeated', v_status = 'defeated', 'participants', v_participants,
    'total_packs', v_paidtotal, 'paid', v_paid);
end $function$;

-- play_card_effect
CREATE OR REPLACE FUNCTION public.play_card_effect(p_player text, p_card bigint, p_target text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_subject bigint; v_rarity text; v_qty int; v_eff jsonb; v_prim effect_primitives%rowtype;
  v_tiers jsonb; v_caps jsonb; v_power numeric; v_cd numeric;
  v_asc int; v_ascset jsonb; v_scale numeric; v_pts jsonb; v_cmb jsonb;
  v_amount numeric; v_dur int; v_cooldown_h numeric; v_ready timestamptz;
  v_day timestamptz := date_trunc('day', now() at time zone 'America/Denver') at time zone 'America/Denver';
  v_final text := p_target; v_outcome text := 'applied'; v_play bigint;
  v_reflect_id bigint; v_ward_id bigint; v_opts jsonb;
  v_counter_id bigint; v_counter text; v_start timestamptz;
  v_choice int;   -- effects_spread.sql
begin
  if p_player = p_target then return jsonb_build_object('ok', false, 'error', 'self_target'); end if;
  if not exists (select 1 from players where id = p_target) then
    return jsonb_build_object('ok', false, 'error', 'no_target');
  end if;

  -- Serialize plays that touch the same members (caps + counters), in a fixed order.
  perform 1 from players where id in (p_player, p_target) order by id for update;

  select pc.quantity, c.subject_id, c.rarity::text, s.effect, coalesce(pc.ascension, 0), pc.stat_points
    into v_qty, v_subject, v_rarity, v_eff, v_asc, v_pts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_eff is null or v_eff->>'primitive' is null then
    return jsonb_build_object('ok', false, 'error', 'no_effect');
  end if;

  select * into v_prim from effect_primitives where primitive = v_eff->>'primitive';
  if not found or not v_prim.enabled then
    return jsonb_build_object('ok', false, 'error', 'effect_disabled', 'primitive', v_eff->>'primitive');
  end if;
  -- effects_spread.sql: a poll card (options.polls) needs the sender's pick of one of its questions
  -- (play_card_effect_choice sets it); a missing or wrong index is refused before anything is spent.
  if jsonb_typeof(v_eff->'options'->'polls') = 'array' then
    v_choice := nullif(current_setting('tcg.effect_choice', true), '')::int;
    if v_choice is null or v_choice < 0 or v_choice >= jsonb_array_length(v_eff->'options'->'polls') then
      return jsonb_build_object('ok', false, 'error', 'bad_choice');
    end if;
  end if;

  -- Cooldown (player + subject).
  select ready_at into v_ready from card_effect_cooldowns
   where player_id = p_player and subject_id = v_subject for update;
  if found and v_ready > now() then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_at', v_ready);
  end if;

  -- Caps (0 or missing = off).
  v_caps := balance_get('card_effect_caps');
  v_caps := coalesce(v_caps, '{}'::jsonb);
  if coalesce((v_caps->>'send_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
         >= (v_caps->>'send_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'send_cap');
  end if;
  if coalesce((v_caps->>'pair_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and aimed_at = p_target and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
         >= (v_caps->>'pair_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'pair_cap');
  end if;
  if v_prim.kind = 'prank' then
    if coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and kind = 'prank' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
           >= (v_caps->>'prank_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_prank_cap');
    end if;
    if v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and primitive = 'timeout' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
           >= (v_caps->>'timeout_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_timeout_cap');
    end if;
  end if;
  if v_prim.primitive = 'gift_pack' and coalesce((v_caps->>'gift_pack_per_week')::int, 0) > 0
     and ((select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and target_id = p_target and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int
       or (select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and player_id = p_player and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int) then
    return jsonb_build_object('ok', false, 'error', 'gift_pack_cap');
  end if;

  -- Counters on the target, for pranks only, in the fixed order of docs/boons-and-pranks.md
  -- 3C: decoy, ward, reflect, redirect, delay. Depth 1: ONE counter acts on a play, and a
  -- bounced or redirected prank meets no second counter. Found first, used up only after
  -- every refusal check, so a refused play never costs the target a counter.
  if v_prim.kind = 'prank' then
    select id, primitive into v_counter_id, v_counter from player_effects
     where player_id = p_target and consumed_at is null and starts_at <= now()
       and primitive in ('decoy', 'ward', 'reflect', 'redirect', 'delay')
       and (expires_at is null or expires_at > now())
     order by array_position(array['decoy', 'ward', 'reflect', 'redirect', 'delay'], primitive), id limit 1;
    if v_counter = 'decoy' then v_outcome := 'decoyed';          -- a cardboard cutout takes it
    elsif v_counter = 'ward' then v_outcome := 'blocked';
    elsif v_counter = 'reflect' then v_final := p_player; v_outcome := 'reflected';
    elsif v_counter = 'redirect' then                             -- a random other member who plays
      select pl.id into v_final from players pl
       where pl.id not in (p_player, p_target) and exists (select 1 from player_cards pc where pc.player_id = pl.id)
         and not card_effect_active(pl.id, v_prim.primitive)             -- someone it can land on
         and (coalesce((v_caps->>'prank_recv_per_day')::int, 0) = 0
              or (select count(*) from card_plays cp where cp.target_id = pl.id and cp.kind = 'prank' and cp.created_at >= v_day and cp.outcome <> 'refunded')   -- effects_spread.sql
                 < (v_caps->>'prank_recv_per_day')::int)
       order by random() limit 1;
      if v_final is null then v_final := p_target; v_counter_id := null; v_counter := null;  -- nobody else
      else v_outcome := 'redirected'; end if;
    elsif v_counter = 'delay' then v_outcome := 'delayed';        -- it lands 1 hour later
    end if;
    -- The caps count where a prank LANDS. A bounce or a redirect onto a member at their prank
    -- (or timeout) cap fizzles (found by boon-sim.mjs: a victim got 5 pranks + 1 reflected = 6).
    if v_final <> p_target and (
         (coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
          and (select count(*) from card_plays where target_id = v_final and kind = 'prank' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
              >= (v_caps->>'prank_recv_per_day')::int)
         or (v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
          and (select count(*) from card_plays where target_id = v_final and primitive = 'timeout' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
              >= (v_caps->>'timeout_recv_per_day')::int)) then
      v_outcome := 'blocked';
    end if;
  end if;

  -- No stacking (checked on the member it would land on). Refused plays keep the cooldown.
  if v_outcome not in ('blocked', 'decoyed') and not v_prim.stacks and card_effect_active(v_final, v_prim.primitive) then
    return jsonb_build_object('ok', false, 'error', 'already_active', 'primitive', v_prim.primitive);
  end if;

  update player_effects set consumed_at = now() where id = v_counter_id;
  v_start := now() + case when v_outcome = 'delayed' then interval '1 hour' else interval '0' end;

  -- Tier scaling, then the hard ceilings.
  v_tiers := balance_get('effect_tiers');   -- balance_table.sql
  v_power := coalesce((v_tiers->v_rarity->>'power')::numeric, 1);
  v_cd    := coalesce((v_tiers->v_rarity->>'cd')::numeric, 1);
  -- Ascension (Nathan, 2026-09-27): each star of THIS copy makes the effect stronger
  -- and the cooldown shorter, on top of the tier. The hard limits below still clamp.
  v_ascset := balance_get('effect_ascension');
  v_cmb := card_combat(v_rarity, v_asc, 1, v_pts);
  if (v_cmb->>'on')::boolean then
    -- Stat points on: the Potency and Haste points of THIS copy replace the per-star bonus.
    v_power := v_power * (v_cmb->>'potency')::numeric;
    v_cd    := v_cd * (v_cmb->>'haste')::numeric;
  else
    v_power := v_power * (1 + coalesce((v_ascset->>'power_per_star')::numeric, 0) * v_asc);
    v_cd    := v_cd * greatest((v_ascset->>'cd_floor')::numeric, 1 - coalesce((v_ascset->>'cd_per_star')::numeric, 0) * v_asc);
  end if;
  -- One global knob for how often every card can be played (1 = as written).
  v_scale := (balance_get('effect_cooldown_scale') #>> '{}')::numeric;
  v_cd    := v_cd * coalesce(v_scale, 1);
  v_amount := round((v_eff->'base'->>'amount')::numeric * v_power, 2);
  v_dur    := round((v_eff->'base'->>'duration_s')::numeric * v_power)::int;
  if v_prim.max_amount is not null then v_amount := least(v_amount, v_prim.max_amount); end if;
  if v_prim.max_duration_s is not null then v_dur := least(v_dur, v_prim.max_duration_s); end if;
  v_cooldown_h := coalesce((v_eff->>'cooldown_h')::numeric, 24) * v_cd;

  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind,
                          rarity, amount, duration_s, outcome)
  values (p_player, v_final, p_target, p_card, v_subject, v_prim.primitive, v_prim.kind,
          v_rarity, v_amount, v_dur, v_outcome)
  returning id into v_play;

  insert into card_effect_cooldowns (player_id, subject_id, ready_at)
  values (p_player, v_subject, now() + make_interval(secs => v_cooldown_h * 3600))
  on conflict (player_id, subject_id) do update set ready_at = excluded.ready_at;

  -- What the visuals need: which card, who sent it, and ONE title from the card's list.
  v_opts := coalesce(v_eff->'options', '{}'::jsonb) || jsonb_build_object('card_id', p_card, 'sender_id', p_player);
  -- Charges (launch_event_cards.sql): base.uses = how many hits a Hunt effect lasts (1 if unset);
  -- credit_to = who gets the Raid Crasher credit (a reflected prank: the member who reflected it).
  v_opts := v_opts || jsonb_build_object('uses', greatest(1, coalesce((v_eff->'base'->>'uses')::int, 1)),
    'credit_to', case when v_outcome = 'reflected' then p_target else p_player end);
  if jsonb_typeof(v_eff->'options'->'titles') = 'array' and jsonb_array_length(v_eff->'options'->'titles') > 0 then
    v_opts := v_opts || jsonb_build_object('title',
      v_eff->'options'->'titles'->>(floor(random() * jsonb_array_length(v_eff->'options'->'titles')))::int);
  end if;
  -- effects_spread.sql: the picked poll question and its fixed answers (the bot posts these).
  if v_choice is not null then
    v_opts := (v_opts - 'polls') || jsonb_build_object('choice', v_choice,
      'question', v_eff->'options'->'polls'->v_choice->'question', 'answers', v_eff->'options'->'polls'->v_choice->'answers');
  end if;

  if v_outcome not in ('blocked', 'decoyed') then
    if v_prim.primitive = 'gift_pack' then
      perform grant_packs(v_final, greatest(1, v_amount::int), 'boon', p_player);
    elsif v_prim.primitive = 'cleanse' then
      update player_effects set consumed_at = now()
       where player_id = v_final and consumed_at is null
         and primitive in (select primitive from effect_primitives where kind = 'prank');
      -- A Discord prank that has not run yet (a voice prank waiting for voice) is skipped;
      -- an active one is undone by the bot at its next tick.
      update discord_effects set status = 'skipped', error = 'cleansed', updated_at = now()
       where target_id = v_final and status = 'pending'
         and primitive in (select primitive from effect_primitives where kind = 'prank');
      update discord_effects set revert_at = now(), updated_at = now()
       where target_id = v_final and status = 'active'
         and primitive in (select primitive from effect_primitives where kind = 'prank');
    elsif v_prim.channel = 'app' then
      insert into player_effects (player_id, primitive, amount, duration_s, options, source_play_id, starts_at, expires_at)
      values (v_final, v_prim.primitive, v_amount, v_dur, v_opts, v_play, v_start,
              case when v_dur is not null and v_dur > 0 then v_start + make_interval(secs => v_dur) end);
    else
      insert into discord_effects (play_id, target_id, primitive, amount, duration_s, options, execute_after, revert_at)
      values (v_play, v_final, v_prim.primitive, v_amount, v_dur, v_opts, v_start,
              case when v_dur is not null and v_dur > 0 then v_start + make_interval(secs => v_dur) end);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'play_id', v_play, 'outcome', v_outcome, 'target', v_final,
    'primitive', v_prim.primitive, 'kind', v_prim.kind, 'rarity', v_rarity, 'ascension', v_asc,
    'amount', v_amount, 'duration_s', v_dur, 'ready_at', now() + make_interval(secs => v_cooldown_h * 3600));
end $function$;

-- dungeon_pay
CREATE OR REPLACE FUNCTION public.dungeon_pay(p_mode text, p_period date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare pz jsonb := dungeon_prizes_cfg(); board jsonb; e jsonb; p jsonb;
  i int; v_cards jsonb; v_card bigint; v_out jsonb := '[]'; v_rar text; v_msg text;
begin
  if p_mode not in ('daily', 'gauntlet') then raise exception 'dungeon_pay: bad mode %', p_mode; end if;
  insert into dungeon_payouts (mode, period) values (p_mode, p_period) on conflict do nothing;
  if not found then return jsonb_build_object('ok', false, 'error', 'already_paid'); end if;
  perform dungeon_settle_stale();
  board := case when p_mode = 'daily' then dungeon_board(p_period, 10) else gauntlet_board(p_period, 10) end;
  for e in select x from jsonb_array_elements(board) x order by (x->>'rank')::int loop
    p := pz->(case when p_mode = 'daily' then 'daily' else 'weekly' end)->((e->>'rank')::int - 1);
    continue when p is null;
    if coalesce((p->>'shards')::int, 0) > 0 then
      perform grant_shards(e->>'player_id', (p->>'shards')::int, 'dungeon', 'dungeon_payout', p_mode || ':' || p_period::text); end if;
    if coalesce((p->>'packs')::int, 0) > 0 then
      perform grant_packs(e->>'player_id', (p->>'packs')::int, 'dungeon_prize', null, 'dungeon_payout', p_mode || ':' || p_period::text); end if;
    v_cards := '[]';
    for i in 1..coalesce((p->>'cards')::int, 0) loop
      v_rar := dungeon_pick(p->'odds', random()::numeric);
      v_card := dungeon_card_of(v_rar);
      if v_card is not null then
        perform add_card_to_player(e->>'player_id', v_card, 'dungeon_prize');
        v_cards := v_cards || jsonb_build_object('id', v_card, 'rarity', v_rar);
      end if;
    end loop;
    v_msg := format('%s #%s: %s', case when p_mode = 'daily' then 'Dungeon' else 'Gauntlet' end, e->>'rank',
      concat_ws(', ', case when coalesce((p->>'shards')::int, 0) > 0 then (p->>'shards') || ' Shards' end,
                      case when coalesce((p->>'packs')::int, 0) > 0 then (p->>'packs') || case when (p->>'packs')::int = 1 then ' pack' else ' packs' end end,
                      case when jsonb_array_length(v_cards) > 0 then jsonb_array_length(v_cards) || case when jsonb_array_length(v_cards) = 1 then ' card' else ' cards' end end));
    perform notify_player(e->>'player_id', 'dungeon_prize', v_msg);
    v_out := v_out || jsonb_build_object('rank', (e->>'rank')::int, 'player_id', e->>'player_id', 'shards', coalesce((p->>'shards')::int, 0),
      'packs', coalesce((p->>'packs')::int, 0), 'cards', v_cards);
  end loop;
  update dungeon_payouts set winners = v_out where mode = p_mode and period = p_period;
  return jsonb_build_object('ok', true, 'mode', p_mode, 'period', p_period, 'winners', v_out);
end $function$;

-- dungeon_prize_tick
CREATE OR REPLACE FUNCTION public.dungeon_prize_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare pz jsonb := dungeon_prizes_cfg(); v_from date; d date; v jsonb := '[]'; x jsonb;
begin
  if not coalesce((pz->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  v_from := coalesce((pz->>'from')::date, dungeon_day());
  for d in select g::date from generate_series(greatest(v_from, dungeon_day() - 7), dungeon_day() - 1, interval '1 day') g loop
    continue when exists (select 1 from dungeon_payouts where mode = 'daily' and period = d);
    x := dungeon_pay('daily', d); v := v || x;
  end loop;
  d := gauntlet_week(dungeon_day()) - 7;   -- the last finished week
  if d >= gauntlet_week(v_from) and not exists (select 1 from dungeon_payouts where mode = 'gauntlet' and period = d) then
    x := dungeon_pay('gauntlet', d); v := v || x;
  end if;
  return jsonb_build_object('ok', true, 'paid', v);
end $function$;

-- gauntlet_view
CREATE OR REPLACE FUNCTION public.gauntlet_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); v_week date := gauntlet_week(dungeon_day()); w gauntlet_weeks; r dungeon_runs; b jsonb;
begin
  if not coalesce((cfg->>'enabled')::boolean, false) or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
  w := gauntlet_generate(v_week);
  select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'gauntlet';
  select e into b from jsonb_array_elements(gauntlet_board(v_week, 100000)) e where e->>'player_id' = p_player;
  return jsonb_build_object('ok', true, 'mode', 'gauntlet', 'day', v_day, 'week', v_week,
    'next_at', (v_day + 1)::timestamp at time zone 'America/Denver', 'ends_at', (v_week + 7)::timestamp at time zone 'America/Denver',
    'name', w.name, 'theme', w.theme, 'gate', adventure_gate(p_player), 'cost', cfg->'cost',
    'budget', balance_num('gauntlet', 'budget')::int,
    'squad', (select jsonb_agg(jsonb_build_object('id', x.id, 'type', x.c->>'type', 'rarity', x.c->>'rarity',
               'cost', balance_num('dungeon', 'cost', x.c->>'rarity')::int, 'cp', (x.c->'cmb'->>'cp')::int,
               'hp', case when x.c->>'type' in ('Character', 'Creature') then (x.c->'cmb'->>'hp')::int else card_max_hp(0) end,
               'slugs', x.c->'tags') order by x.o)
             from unnest(w.squad) with ordinality x0(id, o) cross join lateral (select x0.id, x0.o, dungeon_card_base(x0.id) c) x),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
      'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', 0, 'cards', '[]'::jsonb, 'squad', to_jsonb(r.squad),
      'state', r.state, 'rank', (b->>'rank')::int) end,
    'best', b,
    'rooms', (select jsonb_agg(jsonb_build_object(
               'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
               'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
             from jsonb_array_elements(w.floors->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
    'floors', jsonb_array_length(w.floors),
    'players_week', (select count(distinct player_id) from dungeon_runs where mode = 'gauntlet' and day between v_week and v_week + 6),
    'top', gauntlet_board(v_week, 3),
    'prizes', coalesce(dungeon_prizes_cfg()->'weekly', '[]'::jsonb));
end $function$;

-- welcome_packs
CREATE OR REPLACE FUNCTION public.welcome_packs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  if new.id !~ '^[0-9]{17,20}$' then return new; end if;
  if coalesce(current_setting('tcg.skip_welcome', true), '') = 'on' then return new; end if;
  -- balance welcome_packs (balance_economy.sql). A soft read on purpose: a sign-up never fails on it.
  select case when jsonb_typeof(value) = 'number' then (value)::int else 0 end into n from balance where key = 'welcome_packs';
  if coalesce(n, 0) <= 0 then return new; end if;
  perform give_gift(new.id, 'new_player', 'New Player Bonus', n, 'welcome', null);
  return new;
end $function$;

-- shard_cfg
CREATE OR REPLACE FUNCTION public.shard_cfg()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- The flag (enabled) is in settings.shards, every number in balance shards (balance_economy.sql).
  select coalesce((select value from settings where key = 'shards'), '{}'::jsonb) || balance_get('shards');
$function$;

-- dungeon_cfg
CREATE OR REPLACE FUNCTION public.dungeon_cfg()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- settings.dungeon holds the flag and the seed salt only. Every number is in balance: dungeon (the fight and run rules,
  -- balance_settings_numbers.sql) and dungeon_rewards (Shards, loot, chest odds, room rewards).
  select coalesce((select value from settings where key = 'dungeon'), '{}'::jsonb) || balance_get('dungeon') || balance_get('dungeon_rewards');
$function$;

-- 5. The old settings rows and parts: moved above, so remove them (one number, one source). The flags stay.
delete from public.settings where key in ('pack_earn_multiplier', 'hunt_prizes', 'welcome_packs', 'card_effect_caps');
update public.settings set value = value - 'cap' - 'shards' - 'voice_minutes' where key = 'dailies';
update public.settings set value = value - array['stock', 'prices', 'pack_price', 'dupe_values', 'cooldown_days', 'stat_reset_price', 'max_packs_per_buy'] where key = 'shards';
update public.settings set value = value - array['shards_kill', 'shards_room', 'floor_shards', 'run_shards_cap', 'loot_chance', 'loot', 'chest_rarity'] where key = 'dungeon';
update public.settings set value = value - 'daily' - 'weekly' where key = 'dungeon_prizes';

notify pgrst, 'reload schema';
