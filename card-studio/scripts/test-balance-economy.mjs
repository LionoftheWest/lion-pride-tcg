/**
 * Acceptance test for tcg-bot/supabase/balance_economy.sql (audit step 5: the ECONOMY numbers in the balance table),
 * with NO lasting change: one DO block, rolled back by its final exception. Run it on the LOCAL copy:
 *   node --import ./scripts/localdb-preload.mjs scripts/test-balance-economy.mjs          (LOCALDB=1)
 *   ... scripts/test-balance-economy.mjs --old     the baseline: the same checks WITHOUT the migration (must FAIL)
 *   ECO_MUTATE=<name> ...                          a mutation after the migration: the named check must FAIL
 *     (cap_literal, ach_client, streak, prize, settings_read, no_check)
 * Checks:
 *  1. NO-CHANGE (only on a copy where the migration is not applied yet): with today's values the new functions return
 *     what the old ones returned: dailies_view for 60 members, check-ins (no streak, day 3, 4, 7, 10), voice (29 / 30 min),
 *     social, the daily cap (Shards only), the chat packs (claim_daily_earn as the bot calls it), add_voice_minutes,
 *     the 50 one-time achievements (old: the Activity sent the reward; new: only the key) + a second claim, a Raid
 *     settlement (13 hunters), the welcome gift, the prank / boon send cap, shard_cfg, dungeon_cfg, shop_today,
 *     gauntlet_view, dungeon_view, a Dungeon + Gauntlet prize payout (fixed seed) - and every ledger row they wrote.
 *  2. Every moved number is READ from balance: a changed value changes the result at once (no migration).
 *  3. The client number is ignored: claim_achievement pays balance achievement_rewards.badges, whatever is sent.
 *  4. The guard: balance_check_economy refuses pull rates that do not add up to 1, a bad pack size, a 0-day streak;
 *     a moved key cannot be deleted.
 *  5. One source: the moved settings rows / parts are gone (the flags stay), and no function reads them any more.
 *  6. Re-run: the migration runs again without a change (the functions and a tuned value stay); the rebuilt
 *     pack_ledger_strict.sql and card_ledger.sql run again and keep the new functions.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OLD = process.argv.includes('--old');
const MUT = process.env.ECO_MUTATE || '';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const file = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const mig = file('balance_economy.sql');
const rerun = ['pack_ledger_strict.sql', 'card_ledger.sql'].map(file);
for (const s of [mig, ...rerun]) if (s.includes('$m$') || s.includes('$t$') || s.includes('$x$')) throw new Error('a migration contains $m$, $t$ or $x$');

// The rewards the Activity SENT before (tcg-activity/src/achievements.js REWARDS, the commit before this change),
// written here on purpose: the old claim gets them from the "client", the new one must pay the same from balance.
const OLD_BADGES = JSON.parse(mig.match(/jsonb_build_object\('badges', '(\{[^']*\})'::jsonb\)/)[1]);
const SENT = JSON.stringify(OLD_BADGES).replace(/'/g, "''");

// A mutation (after the migration): proves that the named check can fail.
const fnEdit = (sig, from, to) => `execute replace(pg_get_functiondef('public.${sig}'::regprocedure), ${lit(from)}, ${lit(to)});`;
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const MUTATIONS = {
  cap_literal: fnEdit('dailies_view(text)', "'cap', balance_num('daily', 'cap')::int,", "'cap', 5,"),
  ach_client: fnEdit('claim_achievement(text,text,integer,text,text)', "v_packs := coalesce((r->>'packs')::int, 0);", "v_packs := coalesce(p_packs, (r->>'packs')::int, 0);"),
  streak: fnEdit('dailies_tasks(text)', "prior % balance_num('daily', 'streak_cycle')::int + 1", "prior % 6 + 1"),
  prize: fnEdit('settle_hunt(bigint)', "v_base := balance_num('hunt_prizes', 'base')::int;", "v_base := balance_num('hunt_prizes', 'base')::int + 1;"),
  settings_read: fnEdit('welcome_packs()', 'into n from balance where key', 'into n from settings where key'),
  no_check: 'drop trigger balance_check_economy on balance;',
};
if (MUT && !MUTATIONS[MUT]) throw new Error(`ECO_MUTATE: one of ${Object.keys(MUTATIONS).join(', ')}`);

// The same code runs on the old functions (before the migration) and on the new ones (after it), each time inside its
// own subtransaction, and returns everything it saw in v_res. 'tst_eco_*' are test members (no member data).
const SCENARIO = (achCall) => String.raw`
  insert into players (id, username, pack_balance) select 'tst_eco_' || k, 'tst eco', 0 from generate_series(1, 14) k;
  v_res := jsonb_build_object('views_real', (select jsonb_agg(dailies_view(id) order by id) from (select id from players where id not like 'tst_%' order by id limit 60) p));
  -- check-in streaks: prior days 0, 2 (day 3), 3 (day 4), 6 (day 7), 9 (day 10)
  insert into daily_claims (player_id, day, task, amount)
    select 'tst_eco_' || p.k, v_d - g, 'checkin', 1 from (values (2, 2), (3, 3), (4, 6), (5, 9)) p(k, n), generate_series(1, p.n) g;
  for v_k in 1..5 loop
    v_res := v_res || jsonb_build_object('view_' || v_k, dailies_view('tst_eco_' || v_k), 'checkin_' || v_k, claim_daily('tst_eco_' || v_k, 'checkin') - 'view');
  end loop;
  -- voice 30 (done) and 29 (not done); social (a boon on another member); the cap (5 earned: Shards only)
  insert into voice_minutes (player_id, day, minutes) values ('tst_eco_6', v_d, 30), ('tst_eco_7', v_d, 29);
  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome)
    select 'tst_eco_9', 'tst_eco_8', 'tst_eco_8', c.id, c.subject_id, 'rally', 'boon', c.rarity::text, 'applied' from cards c where c.id = v_boon;
  perform grant_packs('tst_eco_10', 5, 'earned_hunt', null, 'daily_claim', v_d::text || ':hunt');
  v_res := v_res || jsonb_build_object('voice_6', claim_daily('tst_eco_6', 'voice') - 'view', 'voice_7', claim_daily('tst_eco_7', 'voice') - 'view',
    'social_9', claim_daily('tst_eco_9', 'social') - 'view', 'capped_10', claim_daily('tst_eco_10', 'checkin') - 'view',
    'voice_tick', add_voice_minutes(array['tst_eco_14', 'tst_eco_14', 'nobody_here']));
  -- the chat packs, as the bot calls claim_daily_earn (p_base = p_bonus = round(dial) = 1, threshold 25)
  insert into daily_activity (player_id, activity_date, message_count, base_claimed, bonus_claimed)
    values ('tst_eco_11', v_d, 30, false, false), ('tst_eco_12', v_d, 24, false, false), ('tst_eco_13', v_d, 26, false, false);
  perform grant_packs('tst_eco_13', 4, 'earned_hunt', null, 'daily_claim', v_d::text || ':hunt');
  v_res := v_res || jsonb_build_object('chat_11', claim_daily_earn('tst_eco_11', v_d, 1, 1, 25), 'chat_12', claim_daily_earn('tst_eco_12', v_d, 1, 1, 25),
    'chat_13', claim_daily_earn('tst_eco_13', v_d, 1, 1, 25), 'chat_11_again', claim_daily_earn('tst_eco_11', v_d, 1, 1, 25));
  -- the 50 one-time achievements, then each a second time
  for v_key, v_b in select key, value from jsonb_each('${SENT}'::jsonb) loop
    v_ach := v_ach || jsonb_build_object(v_key, ${achCall} - 'packs' - 'title' - 'frame');
  end loop;
  for v_key, v_b in select key, value from jsonb_each('${SENT}'::jsonb) loop
    v_ach := v_ach || jsonb_build_object(v_key || '_again', ${achCall} - 'packs' - 'title' - 'frame');
  end loop;
  v_res := v_res || jsonb_build_object('achievements', v_ach,
    'ach_rows', (select jsonb_agg(jsonb_build_array(key, packs, title, frame) order by key) from achievement_claims where player_id = 'tst_eco_1'));
  -- a Raid settlement: 13 hunters (two tie), the boss escaped
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, closes_at, status)
    values ('Eco Test', 'Normal', '[]', 1000, 500, now() - interval '1 minute', 'expired') returning id into v_h;
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
    select v_h, 'tst_eco_' || k, v_boon, v_d, (array[900, 800, 700, 600, 500, 500, 400, 300, 200, 100, 50, 20, 0])[k] from generate_series(1, 13) k;
  v_res := v_res || jsonb_build_object('settle', settle_hunt(v_h), 'settle_again', settle_hunt(v_h));
  -- the welcome gift (a new member with a Discord-like id)
  insert into players (id, username) values ('100000000000000999', 'tst eco new');
  v_res := v_res || jsonb_build_object('welcome', (select jsonb_agg(jsonb_build_array(kind, reason, title, amount)) from gift_claims where player_id = '100000000000000999'));
  delete from gift_claims where player_id = '100000000000000999'; delete from players where id = '100000000000000999';
  -- the send cap: 10 plays today, the 11th is refused
  insert into player_cards (player_id, card_id, quantity) values ('tst_eco_3', v_boon, 1);
  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome)
    select 'tst_eco_3', 'tst_eco_' || (4 + k % 8), 'tst_eco_' || (4 + k % 8), c.id, c.subject_id, 'rally', 'boon', c.rarity::text, 'applied'
      from cards c, generate_series(1, 10) k where c.id = v_boon;
  v_res := v_res || jsonb_build_object('play_capped', play_card_effect('tst_eco_3', v_boon, 'tst_eco_14'));
  -- the Shards and Dungeon numbers as the SQL sees them
  perform setseed(0.42);
  v_res := v_res || jsonb_build_object('shard_cfg', shard_cfg(), 'dungeon_cfg', dungeon_cfg(), 'shop', shop_today('tst_eco_1'),
    'gauntlet_view', gauntlet_view('tst_eco_1'), 'dungeon_view', dungeon_view('tst_eco_1'));
  -- a Dungeon day + a Gauntlet week payout (the real boards of the copy, a fixed seed); the flag on for the test
  update settings set value = jsonb_set(value, '{enabled}', 'true') where key = 'dungeon_prizes';
  -- 12 test runs yesterday (the Dungeon day board) and last week (the Gauntlet week board), so the payouts pay winners
  insert into dungeon_runs (player_id, day, squad, state, floor, room, turns, status, ended_at, mode)
    select 'tst_eco_' || k, dungeon_day() - 1, '{}'::bigint[], '{}'::jsonb, 20 - k, 1, 10, 'over', now() - interval '1 day', 'daily' from generate_series(1, 12) k
    union all
    select 'tst_eco_' || k, gauntlet_week(dungeon_day()) - 6, '{}'::bigint[], '{}'::jsonb, 15 - k, 2, 5, 'over', now() - interval '3 days', 'gauntlet' from generate_series(1, 12) k;
  delete from dungeon_payouts;
  perform setseed(0.17);
  v_res := v_res || jsonb_build_object('prize_tick', dungeon_prize_tick(), 'pay_week', dungeon_pay('gauntlet', gauntlet_week(dungeon_day()) - 7));
  -- every ledger row the scenario wrote (no ids: a sequence does not roll back)
  v_res := v_res || jsonb_build_object(
    'pack_ledger', (select jsonb_agg(jsonb_build_array(player_id, amount, reason, ref_kind, case when ref_kind = 'hunt' and ref_id = v_h::text then 'the test hunt' else ref_id end) order by player_id, reason, ref_id, amount) from pack_ledger where created_at >= v_t0),
    'shard_ledger', (select jsonb_agg(jsonb_build_array(player_id, amount, reason) order by player_id, reason, amount) from shard_ledger where created_at >= v_t0),
    'daily_claims', (select jsonb_agg(jsonb_build_array(player_id, task, amount) order by player_id, task) from daily_claims where player_id like 'tst_eco_%' and day = v_d),
    'balances', (select jsonb_agg(jsonb_build_array(id, pack_balance) order by id) from players where id like 'tst_eco_%'),
    'notifications', (select count(*) from notifications where created_at >= v_t0));`;

const body = String.raw`do $t$
declare
  res jsonb := '[]'; pre boolean; v_res jsonb; v_ach jsonb := '{}'; old_r jsonb; new_r jsonb; r jsonb; ok boolean; n int;
  v_d date := (now() at time zone 'America/Denver')::date; v_t0 timestamptz := now(); v_k int; v_key text; v_b jsonb;
  v_h bigint; v_boon bigint; m1 jsonb; m2 jsonb; v_cap jsonb;
begin
  pre := not exists (select 1 from pg_tables where tablename = 'balance') or not exists (select 1 from balance where key = 'pulls');
  select c.id into v_boon from cards c join subjects s on s.id = c.subject_id
   where s.effect->>'primitive' = 'rally' and jsonb_typeof(s.effect->'options'->'polls') is distinct from 'array' order by c.id limit 1;

  -- 1a. The OLD answers (only before the migration is applied).
  if pre and ${!OLD} then
    begin
      ${SCENARIO("claim_achievement('tst_eco_1', v_key, (v_b->>'packs')::int, v_b->>'title', v_b->>'frame')")}
      old_r := v_res; v_ach := '{}';
      raise exception 'rollback-old';
    exception when others then
      if sqlerrm <> 'rollback-old' then old_r := jsonb_build_object('error', sqlerrm); end if;
    end;
  end if;

  ${OLD ? '-- --old: no migration' : '-- The migration.\n  execute $m$' + mig + '$m$;'}
  ${MUT ? `-- ECO_MUTATE=${MUT}\n  ${MUTATIONS[MUT]}` : ''}

  -- 1b. The NEW answers with today's values: they must be the same.
  if pre and ${!OLD} then
    begin
      v_ach := '{}';
      ${SCENARIO("claim_achievement('tst_eco_1', v_key)")}
      new_r := v_res;
      raise exception 'rollback-new';
    exception when others then
      if sqlerrm <> 'rollback-new' then new_r := jsonb_build_object('error', sqlerrm); end if;
    end;
    res := res || jsonb_build_object('case', 'NO CHANGE with today''s values: dailies_view x 60 members, 5 check-ins (streak days 1, 3, 4, 7, 10), voice 30 / 29, social, the cap, 4 chat claims, add_voice_minutes, 50 achievements + 50 second claims, a Raid settlement (13 hunters) + a second one, the welcome gift, the send cap, shard_cfg, dungeon_cfg, shop_today, gauntlet_view, dungeon_view, a Dungeon day + Gauntlet week payout (12 test runs each), and every ledger row = the old functions',
      'ok', old_r = new_r and old_r ? 'settle' and not old_r ? 'error',
      'diff', (select jsonb_agg(k) from jsonb_object_keys(old_r || new_r) k where old_r->k is distinct from new_r->k),
      -- the ledger rows only one side wrote (a member id is masked: no member data in the output)
      'ledger_only_old', (select jsonb_agg(case when x->>0 like 'tst_%' then x else jsonb_set(x, '{0}', '"member"') end) from jsonb_array_elements(coalesce(old_r->'pack_ledger', '[]')) x where not coalesce(new_r->'pack_ledger', '[]') @> jsonb_build_array(x)),
      'ledger_only_new', (select jsonb_agg(case when x->>0 like 'tst_%' then x else jsonb_set(x, '{0}', '"member"') end) from jsonb_array_elements(coalesce(new_r->'pack_ledger', '[]')) x where not coalesce(old_r->'pack_ledger', '[]') @> jsonb_build_array(x)),
      'error_old', old_r->>'error', 'error_new', new_r->>'error',
      'ledger_counts', jsonb_build_array(jsonb_array_length(coalesce(old_r->'pack_ledger', '[]')), jsonb_array_length(coalesce(new_r->'pack_ledger', '[]'))),
      'detail', format('%s ledger rows, %s Shard rows, %s daily claims, %s achievement claims, %s Raid prize packs, %s prize-tick payouts (%s winners) compared',
        jsonb_array_length(coalesce(new_r->'pack_ledger', '[]')), jsonb_array_length(coalesce(new_r->'shard_ledger', '[]')),
        jsonb_array_length(coalesce(new_r->'daily_claims', '[]')), jsonb_array_length(coalesce(new_r->'ach_rows', '[]')),
        new_r->'settle'->>'total_packs', jsonb_array_length(coalesce(new_r->'prize_tick'->'paid', '[]')),
        (select coalesce(sum(jsonb_array_length(coalesce(p->'winners', '[]'))), 0) from jsonb_array_elements(coalesce(new_r->'prize_tick'->'paid', '[]') || jsonb_build_array(new_r->'pay_week')) p)));
  else
    res := res || jsonb_build_object('case', case when ${OLD} then 'no change: not possible without the migration' else 'no change: skipped (the migration is already applied on this copy; it ran on the fresh copy)' end, 'ok', ${!OLD}, 'skipped', true);
  end if;

  insert into players (id, username, pack_balance) select 'tst_ecb_' || k, 'tst ecb', 0 from generate_series(1, 9) k;

  -- 2. Every moved number is read from balance (a changed value changes the result at once).
  begin
    update balance set value = jsonb_set(value, '{cap}', '2') where key = 'daily';
    perform grant_packs('tst_ecb_1', 2, 'earned_hunt', null, 'daily_claim', v_d::text || ':hunt');
    r := claim_daily('tst_ecb_1', 'checkin');
    res := res || jsonb_build_object('case', 'daily.cap 5 -> 2: the view says 2 and a member with 2 earned packs gets 0 packs (Shards only)',
      'ok', (dailies_view('tst_ecb_1')->>'cap')::int = 2 and (r->>'packs')::int = 0 and (r->>'shards')::int = 40, 'r', r - 'view');
  exception when others then res := res || jsonb_build_object('case', 'daily.cap', 'ok', false, 'error', sqlerrm); end;
  update balance set value = jsonb_set(value, '{cap}', '5') where key = 'daily';
  begin
    update balance set value = value || '{"checkin":2,"streak_bonus":3,"streak_days":[1,7],"streak_cycle":7}' where key = 'daily';
    r := claim_daily('tst_ecb_2', 'checkin');
    res := res || jsonb_build_object('case', 'daily.checkin 2 + streak_bonus 3 on day 1: the first check-in pays 5 (2 earned_checkin + 3 earned_streak)',
      'ok', (r->>'packs')::int = 5 and (select sum(amount) from pack_ledger where player_id = 'tst_ecb_2' and reason = 'earned_checkin') = 2
        and (select sum(amount) from pack_ledger where player_id = 'tst_ecb_2' and reason = 'earned_streak') = 3, 'r', r - 'view');
  exception when others then res := res || jsonb_build_object('case', 'daily.checkin / streak', 'ok', false, 'error', sqlerrm); end;
  update balance set value = value || '{"checkin":1,"streak_bonus":1,"streak_days":[3,7],"streak_cycle":7}' where key = 'daily';
  begin
    update balance set value = value || '{"chat":2,"chat_bonus":2,"chat_bonus_at":3}' where key = 'daily';
    insert into daily_activity (player_id, activity_date, message_count, base_claimed, bonus_claimed) values ('tst_ecb_3', v_d, 3, false, false);
    n := claim_daily_earn('tst_ecb_3', v_d, 1, 1, 25);   -- the numbers the bot sends are not read
    res := res || jsonb_build_object('case', 'daily.chat 2 / chat_bonus 2 / chat_bonus_at 3: 3 messages pay 4 (the bot''s 1 / 1 / 25 are ignored); the view shows need 3, max 4',
      'ok', n = 4 and (dailies_view('tst_ecb_3')->'tasks'->1->>'need')::int = 3 and (dailies_view('tst_ecb_3')->'tasks'->1->>'max')::int = 4, 'got', n);
  exception when others then res := res || jsonb_build_object('case', 'daily.chat', 'ok', false, 'error', sqlerrm); end;
  update balance set value = value || '{"chat":1,"chat_bonus":1,"chat_bonus_at":25}' where key = 'daily';
  begin
    update balance set value = value || '{"voice_minutes":5,"shards":7}' where key = 'daily';
    update balance set value = jsonb_set(value, '{tasks,voice}', '3') where key = 'daily';
    insert into voice_minutes (player_id, day, minutes) values ('tst_ecb_4', v_d, 5);
    r := claim_daily('tst_ecb_4', 'voice');
    res := res || jsonb_build_object('case', 'daily.voice_minutes 5, tasks.voice 3, shards 7: 5 minutes pay 3 packs + 7 Shards',
      'ok', (r->>'packs')::int = 3 and (r->>'shards')::int = 7, 'r', r - 'view');
  exception when others then res := res || jsonb_build_object('case', 'daily.voice / tasks / shards', 'ok', false, 'error', sqlerrm); end;
  update balance set value = jsonb_set(value || '{"voice_minutes":30,"shards":40}', '{tasks,voice}', '1') where key = 'daily';
  begin
    update balance set value = '2' where key = 'pack_earn_multiplier';
    r := claim_daily('tst_ecb_5', 'checkin');
    update balance set value = '0' where key = 'pack_earn_multiplier';
    res := res || jsonb_build_object('case', 'pack_earn_multiplier 2: a check-in pays 2; 0: claims paused, the view says paused',
      'ok', (r->>'packs')::int = 2 and claim_daily('tst_ecb_6', 'checkin')->>'error' = 'paused' and (dailies_view('tst_ecb_6')->>'paused')::boolean, 'r', r - 'view');
  exception when others then res := res || jsonb_build_object('case', 'pack_earn_multiplier', 'ok', false, 'error', sqlerrm); end;
  update balance set value = '1' where key = 'pack_earn_multiplier';
  begin
    update balance set value = '{"base":2,"ranks":[9,4,4,4,4,4,4,4,4,4]}' where key = 'hunt_prizes';
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, closes_at, status)
      values ('Eco Test 2', 'Normal', '[]', 1000, 0, now(), 'defeated') returning id into v_h;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (v_h, 'tst_ecb_7', v_boon, v_d, 50), (v_h, 'tst_ecb_8', v_boon, v_d, 10);
    r := settle_hunt(v_h);
    res := res || jsonb_build_object('case', 'hunt_prizes ranks [9, 4, ...]: 1st gets 9, 2nd gets 4 (the base is in the no-change check)', 'ok', (r->>'total_packs')::int = 13
      and (select pack_balance from players where id = 'tst_ecb_7') = 9 and (select pack_balance from players where id = 'tst_ecb_8') = 4, 'r', r->'total_packs');
  exception when others then res := res || jsonb_build_object('case', 'hunt_prizes', 'ok', false, 'error', sqlerrm); end;
  begin
    update balance set value = jsonb_set(jsonb_set(value, '{daily,0,shards}', '999'), '{weekly,0,packs}', '77') where key = 'dungeon_prizes';
    update balance set value = jsonb_set(jsonb_set(value, '{shards_kill}', '4'), '{run_shards_cap}', '123') where key = 'dungeon_rewards';
    update balance set value = jsonb_set(value, '{pack_price}', '99') where key = 'shards';
    r := gauntlet_view('tst_ecb_1');
    res := res || jsonb_build_object('case', 'dungeon_prizes / dungeon_rewards / shards: dungeon_prizes_cfg, the Gauntlet prize list, dungeon_cfg and shard_cfg show the new values, dungeon_view the new run cap (the flags still from settings)',
      'ok', (dungeon_prizes_cfg()->'daily'->0->>'shards')::int = 999 and dungeon_prizes_cfg() ? 'enabled'
        and (r->'prizes'->0->>'packs')::int = 77 and (dungeon_view('tst_ecb_1')->>'cap')::int = 123
        and (dungeon_cfg()->>'shards_kill')::int = 4 and dungeon_cfg() ? 'enabled' and (shard_cfg()->>'pack_price')::int = 99 and shard_cfg() ? 'enabled',
      'gauntlet', r->'prizes'->0);
  exception when others then res := res || jsonb_build_object('case', 'dungeon_prizes / dungeon_rewards / shards', 'ok', false, 'error', sqlerrm); end;
  begin
    update balance set value = '3' where key = 'welcome_packs';
    insert into players (id, username) values ('100000000000000998', 'tst ecb new');
    res := res || jsonb_build_object('case', 'welcome_packs 10 -> 3: a new member gets a 3-pack welcome gift',
      'ok', (select sum(amount) from gift_claims where player_id = '100000000000000998') = 3);
  exception when others then res := res || jsonb_build_object('case', 'welcome_packs', 'ok', false, 'error', sqlerrm); end;
  begin
    insert into player_cards (player_id, card_id, quantity) values ('tst_ecb_9', v_boon, 1);
    insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome)
      select 'tst_ecb_9', 'tst_ecb_' || (1 + k % 8), 'tst_ecb_' || (1 + k % 8), c.id, c.subject_id, 'rally', 'boon', c.rarity::text, 'applied'
        from cards c, generate_series(1, 10) k where c.id = v_boon;
    r := play_card_effect('tst_ecb_9', v_boon, 'tst_ecb_3');
    update balance set value = jsonb_set(value, '{send_per_day}', '11') where key = 'card_effect_caps';
    v_cap := play_card_effect('tst_ecb_9', v_boon, 'tst_ecb_2');
    res := res || jsonb_build_object('case', 'card_effect_caps.send_per_day 10 -> 11: the 11th play is refused (send_cap), then it is not',
      'ok', r->>'error' = 'send_cap' and coalesce(v_cap->>'error', '') <> 'send_cap', 'before', r->>'error', 'after', coalesce(v_cap->>'error', 'played'));
  exception when others then res := res || jsonb_build_object('case', 'card_effect_caps', 'ok', false, 'error', sqlerrm); end;

  -- 3. The achievement reward is the balance value, whatever the caller sends.
  begin
    update balance set value = jsonb_set(value, '{badges,first,packs}', '4') where key = 'achievement_rewards';
    r := claim_achievement('tst_ecb_1', 'first', 10, 'Hacker', 'gold');
    res := res || jsonb_build_object('case', 'claim_achievement pays badges.first (4 packs, no title or frame) and ignores the sent 10 packs / title / frame; an unknown key pays nothing',
      'ok', (r->>'ok')::boolean and (r->>'packs')::int = 4
        and (select jsonb_build_array(packs, title, frame) from achievement_claims where player_id = 'tst_ecb_1' and key = 'first') = '[4, null, null]'
        and (select sum(amount) from pack_ledger where player_id = 'tst_ecb_1' and reason = 'achievement') = 4
        and claim_achievement('tst_ecb_1', 'made_up', 5, null, null)->>'error' = 'unknown'
        and not exists (select 1 from achievement_claims where player_id = 'tst_ecb_1' and key = 'made_up'), 'r', r);
  exception when others then res := res || jsonb_build_object('case', 'achievement rewards from balance', 'ok', false, 'error', sqlerrm); end;

  -- 4. The guard.
  begin
    select count(*) into n from (values
      ('update balance set value = jsonb_set(value, ''{rates,gold}'', ''0.001'') where key = ''pulls''', 'add up to 1'),
      ('update balance set value = jsonb_set(value, ''{pack_size}'', ''0'') where key = ''pulls''', 'pack_size'),
      ('update balance set value = jsonb_set(value, ''{streak_cycle}'', ''0'') where key = ''daily''', 'streak_cycle'),
      ('delete from balance where key = ''pulls''', 'do not delete'),
      ('update balance set value = jsonb_set(value, ''{cap}'', ''-1'') where key = ''daily''', 'negative')) g(s, want)
     where not exists (select 1 from (select balance_try(g.s) e) x where x.e like '%' || g.want || '%');
    res := res || jsonb_build_object('case', 'the guard refuses: pull rates that do not add up to 1, pack_size 0, streak_cycle 0, deleting a key, a negative cap', 'ok', n = 0, 'not_refused', n);
  exception when others then res := res || jsonb_build_object('case', 'the guard', 'ok', false, 'error', sqlerrm); end;

  -- 5. One source.
  begin
    select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname <> 'dungeon_prizes_cfg'
      and (p.prosrc ~ $x$settings where key = '(pack_earn_multiplier|hunt_prizes|welcome_packs|card_effect_caps|dungeon_prizes)'$x$
           or p.prosrc ~ $x$cfg->>'(cap|shards|voice_minutes)'$x$);
    res := res || jsonb_build_object('case', 'one source: the old settings rows pack_earn_multiplier, hunt_prizes, welcome_packs, card_effect_caps are gone; dailies, shards, dungeon_prizes keep only their flags; settings.dungeon has no reward part; no function reads a moved setting',
      'ok', n = 0 and not exists (select 1 from settings where key in ('pack_earn_multiplier', 'hunt_prizes', 'welcome_packs', 'card_effect_caps'))
        and (select array_agg(k order by k) from settings, jsonb_object_keys(value) k where key = 'dailies') = '{enabled}'
        and (select array_agg(k order by k) from settings, jsonb_object_keys(value) k where key = 'shards') = '{enabled}'
        and (select array_agg(k order by k) from settings, jsonb_object_keys(value) k where key = 'dungeon_prizes') = '{enabled,from}'
        and not exists (select 1 from settings, jsonb_object_keys(value) k where key = 'dungeon' and k in ('shards_kill', 'shards_room', 'floor_shards', 'run_shards_cap', 'loot_chance', 'loot', 'chest_rarity'))
        and not has_function_privilege('anon', 'public.dungeon_prizes_cfg()', 'execute'), 'functions_reading_old_settings', n);
  exception when others then res := res || jsonb_build_object('case', 'one source', 'ok', false, 'error', sqlerrm); end;

  -- 6. Re-run: the migration again (a tuned value stays), then the rebuilt guarded files.
  begin
    update balance set value = jsonb_set(value, '{cap}', '6') where key = 'daily';
    select jsonb_object_agg(p.oid::regprocedure::text, md5(replace(pg_get_functiondef(p.oid), chr(13), ''))) into m1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('claim_daily', 'claim_daily_earn', 'dailies_view', 'dailies_tasks', 'add_voice_minutes',
       'claim_achievement', 'settle_hunt', 'play_card_effect', 'dungeon_pay', 'dungeon_prize_tick', 'gauntlet_view', 'welcome_packs', 'shard_cfg', 'dungeon_cfg');
    ${OLD ? '' : 'execute $m$' + mig + '$m$;'}
    ${OLD ? '' : rerun.map((s) => 'execute $m$' + s + '$m$;').join('\n    ')}
    select jsonb_object_agg(p.oid::regprocedure::text, md5(replace(pg_get_functiondef(p.oid), chr(13), ''))) into m2 from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('claim_daily', 'claim_daily_earn', 'dailies_view', 'dailies_tasks', 'add_voice_minutes',
       'claim_achievement', 'settle_hunt', 'play_card_effect', 'dungeon_pay', 'dungeon_prize_tick', 'gauntlet_view', 'welcome_packs', 'shard_cfg', 'dungeon_cfg');
    res := res || jsonb_build_object('case', 're-run: balance_economy.sql, pack_ledger_strict.sql and card_ledger.sql run again; the 14 functions keep the new text and the tuned daily.cap 6 stays',
      'ok', m1 = m2 and (select count(*) from jsonb_object_keys(m1)) = 14 and balance_num('daily', 'cap') = 6, 'changed', (select jsonb_agg(k) from jsonb_object_keys(m1) k where m1->k is distinct from m2->k));
  exception when others then res := res || jsonb_build_object('case', 're-run', 'ok', false, 'error', sqlerrm); end;

  raise exception 'RES %', jsonb_build_object('res', res, 'pre', pre);
end $t$;`;

// balance_try(sql): the error text of one statement, or null (a helper for the guard check; dropped by the rollback).
const helper = `create or replace function pg_temp.balance_try(s text) returns text language plpgsql as $f$
begin execute s; return null; exception when others then return sqlerrm; end $f$;`;
const out = await q(helper.replace('pg_temp.', 'public.') + '\n' + body + '\n');
const msg = out.message || out.error || JSON.stringify(out);
await q('drop function if exists public.balance_try(text);');
const mm = msg.match(/RES (\{.*\})/s);
if (!mm) { console.log('FAIL the block did not finish:', msg.slice(0, 1500)); process.exit(1); }
const R = JSON.parse(mm[1]);
let fails = 0;
console.log(OLD ? 'BASELINE (--old: without balance_economy.sql) - these checks must FAIL\n'
  : `balance_economy.sql${MUT ? ` with the mutation ECO_MUTATE=${MUT} (a check must FAIL)` : ''}${R.pre ? ' (fresh copy: the no-change check runs)' : ''}\n`);
for (const r of R.res) {
  if (!r.ok) fails += 1;
  const extra = { ...r }; delete extra.case; delete extra.ok; delete extra.detail;
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${!r.ok ? '  ' + JSON.stringify(extra).slice(0, 700) : ''}`);
  if (r.ok && r.detail) console.log(`     ${r.detail}`);
}
console.log(`\nFAILS ${fails} of ${R.res.length}`);
process.exitCode = OLD || MUT ? (fails > 0 ? 0 : 1) : (fails ? 1 : 0);
