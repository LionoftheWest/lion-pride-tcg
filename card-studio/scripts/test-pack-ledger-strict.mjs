/**
 * Acceptance test for tcg-bot/supabase/pack_ledger_strict.sql (audit plan steps 3 and 7). Rolled back
 * (the result comes back in the exception), test members only:
 *   node scripts/test-pack-ledger-strict.mjs          the migration file, executed inside the block
 *   node scripts/test-pack-ledger-strict.mjs --old    the database as it is (before the migration: FAILS)
 *   MUTATE=<name> node scripts/test-pack-ledger-strict.mjs   one broken mechanism: must FAIL
 * Invariants:
 *   - a misspelled pack reason is refused (pack_ledger and a pack gift in gift_claims);
 *   - a negative pack balance is refused;
 *   - every path that writes packs writes ref_kind + ref_id that point at its source row;
 *   - the chat dailies write daily_claims rows (also at the cap, amount 0);
 *   - after each path the member reconciles: pack_balance = sum(pack_ledger.amount), no row without a ref.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/pack_ledger_strict.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$') || mig.includes('$c$')) throw new Error('the migration must not contain $m$ or $c$');

// Function mutations (fixtures.mjs) and constraint mutations (dropped inside the block).
const FN_MUT = {
  giftnoref: ['public.claim_gift(text,bigint)', "g.from_id, 'gift', g.id::text)", 'g.from_id)'],
  opensplit: ['public.open_packs(text,bigint[],integer)', "'open', v_open from generate_series", "'open', gen_random_uuid()::text from generate_series"],
  chatnoclaim: ['public.claim_daily_earn(text,date,integer,integer,integer)', "insert into daily_claims (player_id, day, task, amount) values (p_player_id, p_date, 'chat_bonus', greatest(amt, 0));", ''],
  ledgerdrift: ['public.grant_packs(text,integer,text,text,text,text)', 'values (p_player_id, p_amount, p_reason, p_by,', 'values (p_player_id, p_amount + 1, p_reason, p_by,'],
};
const SQL_MUT = {
  noreasoncheck: 'alter table pack_ledger drop constraint pack_ledger_reason_check;',
  nogiftcheck: 'alter table gift_claims drop constraint gift_claims_pack_reason_check;',
  nobalancecheck: 'alter table players drop constraint players_pack_balance_nonneg;',
};
const MUT = process.env.MUTATE && SQL_MUT[process.env.MUTATE] ? (console.log(`MUTATE=${process.env.MUTATE}`), SQL_MUT[process.env.MUTATE]) : mutation(FN_MUT);

const P = 'tst_pls';
// One case: its body runs in a sub-block; an error is a failed case with the error text.
const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', ${`$c$${name}$c$`}, 'ok', false, 'r', sqlerrm);
  end;`;
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; ok boolean; g bigint; gid bigint; n int; h bigint; c bigint; cs bigint[]; x text; y text;
  d date := (now() at time zone 'America/Denver')::date;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the database as it is'}
  ${MUT}
  perform set_config('tcg.skip_welcome', 'on', true);
  update settings set value = '1'::jsonb where key = 'pack_earn_multiplier';
  update settings set value = value || '{"enabled": true}' where key = 'dailies';
  insert into players (id, username) values ('${P}_a', 'tst a'), ('${P}_b', 'tst b'), ('${P}_d', 'tst d'), ('${P}_e', 'tst e'),
    ('${P}_f', 'tst f'), ('${P}_t', 'tst t'), ('${P}_h', 'tst h'), ('${P}_g', 'tst g'), ('${P}_u', 'tst u');
  select array_agg(id) into cs from (select id from cards order by id limit 10) z;
  -- The member reconciles: balance = the sum of the ledger, and no row without a ref (plpgsql: the body is
  -- checked only when it runs, so --old reports the missing column as a failed case).
  create function pg_temp.tst_recon(p text) returns boolean language plpgsql as $r$
  begin
    return (select pack_balance from players where id = p) = (select coalesce(sum(amount), 0) from pack_ledger where player_id = p)
       and not exists (select 1 from pack_ledger where player_id = p and (ref_kind is null or ref_id is null));
  end $r$;
${kase('a misspelled reason is refused (grant_packs and a direct insert)', `
    begin perform grant_packs('${P}_a', 1, 'earnd_daily'); ok := false; exception when check_violation then ok := true; end;
    if ok then begin insert into pack_ledger (player_id, amount, reason) values ('${P}_a', 1, 'earned_dialy'); ok := false; exception when check_violation then ok := true; end; end if;
    res := res || jsonb_build_object('case', 'a misspelled reason is refused (grant_packs and a direct insert)', 'ok', ok);`)}
${kase('a pack gift with a misspelled reason is refused when it is made', `
    begin perform give_gift('${P}_a', 'promo', 'Test', 1, 'admn', null); ok := false; exception when check_violation then ok := true; end;
    res := res || jsonb_build_object('case', 'a pack gift with a misspelled reason is refused when it is made', 'ok', ok);`)}
${kase('a negative pack balance is refused', `
    begin update players set pack_balance = -1 where id = '${P}_a'; ok := false; exception when check_violation then ok := true; end;
    res := res || jsonb_build_object('case', 'a negative pack balance is refused', 'ok', ok and not spend_pack('${P}_u'));`)}
${kase('claim_gift: ref (gift, id), granted_by = the sender, the member reconciles', `
    g := give_gift('${P}_a', 'promo', 'Test drop', 3, 'admin', '${P}_b');
    r := claim_gift('${P}_a', g);
    res := res || jsonb_build_object('case', 'claim_gift: ref (gift, id), granted_by = the sender, the member reconciles', 'ok',
      (r->>'ok')::boolean and exists (select 1 from pack_ledger where player_id = '${P}_a' and reason = 'admin' and amount = 3
        and ref_kind = 'gift' and ref_id = g::text and granted_by = '${P}_b') and pg_temp.tst_recon('${P}_a'), 'r', r);`)}
${kase('gift_packs: the sender row and the receiver row point at the same gift', `
    perform gift_packs('${P}_a', '${P}_b', 2);
    select id into gid from gift_claims where player_id = '${P}_b' and kind = 'member_gift' and claimed_at is null;
    r := claim_gift('${P}_b', gid);
    res := res || jsonb_build_object('case', 'gift_packs: the sender row and the receiver row point at the same gift', 'ok',
      exists (select 1 from pack_ledger where player_id = '${P}_a' and reason = 'gift_sent' and amount = -2 and ref_kind = 'gift' and ref_id = gid::text and granted_by = '${P}_b')
      and exists (select 1 from pack_ledger where player_id = '${P}_b' and reason = 'gift_received' and amount = 2 and ref_kind = 'gift' and ref_id = gid::text and granted_by = '${P}_a')
      and pg_temp.tst_recon('${P}_a') and pg_temp.tst_recon('${P}_b'), 'r', r);`)}
${kase('open_packs: the packs of one open share one open id; spend_pack has its own', `
    -- a has 3 - 2 = 1 pack; b has 2. b opens 2 in one call, then a opens 1 with spend_pack.
    n := open_packs('${P}_b', cs[1:2], 1);
    ok := spend_pack('${P}_a');
    select count(distinct ref_id), count(*) into g, gid from pack_ledger where player_id = '${P}_b' and reason = 'opened' and ref_kind = 'open';
    res := res || jsonb_build_object('case', 'open_packs: the packs of one open share one open id; spend_pack has its own', 'ok',
      n = 2 and g = 1 and gid = 2 and ok
      and exists (select 1 from pack_ledger where player_id = '${P}_a' and reason = 'opened' and ref_kind = 'open' and ref_id is not null
                    and ref_id <> (select max(ref_id) from pack_ledger where player_id = '${P}_b' and reason = 'opened'))
      and pg_temp.tst_recon('${P}_a') and pg_temp.tst_recon('${P}_b'), 'n', n);`)}
${kase('claim_daily (checkin): ref (daily_claim, <day>:checkin)', `
    r := claim_daily('${P}_d', 'checkin');
    res := res || jsonb_build_object('case', 'claim_daily (checkin): ref (daily_claim, <day>:checkin)', 'ok',
      (r->>'ok')::boolean and exists (select 1 from daily_claims where player_id = '${P}_d' and day = d and task = 'checkin')
      and not exists (select 1 from pack_ledger where player_id = '${P}_d' and (ref_kind is distinct from 'daily_claim' or ref_id is distinct from d::text || ':checkin'))
      and exists (select 1 from pack_ledger where player_id = '${P}_d') and pg_temp.tst_recon('${P}_d'), 'r', r);`)}
${kase('the chat dailies write daily_claims rows (chat, chat_bonus) and ref (daily_claim, <day>:<task>)', `
    insert into daily_activity (player_id, activity_date, message_count) values ('${P}_e', d, 25);
    n := claim_daily_earn('${P}_e', d, 1, 1, 25);
    res := res || jsonb_build_object('case', 'the chat dailies write daily_claims rows (chat, chat_bonus) and ref (daily_claim, <day>:<task>)', 'ok',
      n = 2 and (select count(*) from daily_claims where player_id = '${P}_e' and day = d and task in ('chat', 'chat_bonus') and amount = 1) = 2
      and exists (select 1 from pack_ledger where player_id = '${P}_e' and reason = 'earned_daily' and ref_kind = 'daily_claim' and ref_id = d::text || ':chat')
      and exists (select 1 from pack_ledger where player_id = '${P}_e' and reason = 'earned_bonus' and ref_kind = 'daily_claim' and ref_id = d::text || ':chat_bonus')
      and pg_temp.tst_recon('${P}_e'), 'n', n);`)}
${kase('a chat claim at the cap is a daily_claims row with 0 packs and no pack row', `
    perform grant_packs('${P}_f', 5, 'earned_social', null, 'daily_claim', d::text || ':social');
    insert into daily_activity (player_id, activity_date, message_count) values ('${P}_f', d, 25);
    n := claim_daily_earn('${P}_f', d, 1, 1, 25);
    res := res || jsonb_build_object('case', 'a chat claim at the cap is a daily_claims row with 0 packs and no pack row', 'ok',
      n = 0 and (select count(*) from daily_claims where player_id = '${P}_f' and day = d and task in ('chat', 'chat_bonus') and amount = 0) = 2
      and not exists (select 1 from pack_ledger where player_id = '${P}_f' and reason in ('earned_daily', 'earned_bonus'))
      and earned_today('${P}_f') = 5 and pg_temp.tst_recon('${P}_f'), 'n', n);`)}
${kase('the achievement dailies count reads daily_claims: chat_bonus counts, the plain chat daily not', `
    r := ach_track_values('${P}_e');
    res := res || jsonb_build_object('case', 'the achievement dailies count reads daily_claims: chat_bonus counts, the plain chat daily not', 'ok',
      (r->>'grind')::int = 1 and (r->>'voice')::int = 1, 'grind', r->'grind', 'voice', r->'voice');`)}
${kase('claim_achievement: ref (achievement, key), granted_by null', `
    -- The reward is balance achievement_rewards.badges (balance_economy.sql): a 2-pack test badge.
    update balance set value = jsonb_set(value, '{badges,tst_key_x}', '{"packs": 2}') where key = 'achievement_rewards';
    r := claim_achievement('${P}_g', 'tst_key_x');
    res := res || jsonb_build_object('case', 'claim_achievement: ref (achievement, key), granted_by null', 'ok',
      (r->>'ok')::boolean and exists (select 1 from pack_ledger where player_id = '${P}_g' and reason = 'achievement' and amount = 2
        and ref_kind = 'achievement' and ref_id = 'tst_key_x' and granted_by is null) and pg_temp.tst_recon('${P}_g'), 'r', r);`)}
${kase('claim_achievement_tiers: ref (achievement, track key)', `
    update settings set value = '{"enabled": true, "users": []}'::jsonb where key = 'achievement_tracks';
    g := give_gift('${P}_t', 'promo', 'Test', 10, 'event', null);
    perform claim_gift('${P}_t', g);
    n := open_packs('${P}_t', cs, 1);
    r := claim_achievement_tiers('${P}_t', 'track:packs');
    res := res || jsonb_build_object('case', 'claim_achievement_tiers: ref (achievement, track key)', 'ok',
      (r->>'ok')::boolean and (r->>'packs')::int > 0
      and not exists (select 1 from pack_ledger where player_id = '${P}_t' and reason = 'achievement' and (ref_kind is distinct from 'achievement' or ref_id not like 'track:packs:%' or granted_by is not null))
      and exists (select 1 from pack_ledger where player_id = '${P}_t' and reason = 'achievement' and ref_id = 'track:packs:1')
      and pg_temp.tst_recon('${P}_t'), 'r', r);`)}
${kase('buy_shop_item (packs): ref (shop_purchase, id)', `
    perform grant_shards('${P}_a', 1000, 'admin', 'test', 'pack ledger test');
    r := buy_shop_item('${P}_a', 'pack', null, null, 2);
    select id into gid from shop_purchases where player_id = '${P}_a' and kind = 'pack';
    res := res || jsonb_build_object('case', 'buy_shop_item (packs): ref (shop_purchase, id)', 'ok',
      (r->>'ok')::boolean and exists (select 1 from pack_ledger where player_id = '${P}_a' and reason = 'shop' and amount = 2 and ref_kind = 'shop_purchase' and ref_id = gid::text)
      and pg_temp.tst_recon('${P}_a'), 'r', r);`)}
${kase('settle_hunt: ref (hunt, id)', `
    insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at, status)
      values ('Test Ledger Boss', 'Normal', '[]', '[]', 1000, 0, now() - interval '1 minute', 'expired') returning id into h;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h, '${P}_h', cs[1], d, 100);
    r := settle_hunt(h);
    res := res || jsonb_build_object('case', 'settle_hunt: ref (hunt, id)', 'ok',
      (r->>'ok')::boolean and exists (select 1 from pack_ledger where player_id = '${P}_h' and reason = 'hunt_reward' and ref_kind = 'hunt' and ref_id = h::text)
      and pg_temp.tst_recon('${P}_h'), 'r', r);`)}
${kase('dungeon_pay: ref (dungeon_payout, <mode>:<period>)', `
    -- A fixed board (rolled back): only the pay path is under test here (test-dungeon.mjs tests the boards).
    execute 'create or replace function public.gauntlet_board(p_week date default null, p_limit integer default 20) returns jsonb language sql as $b$ select ''[{"rank": 1, "player_id": "${P}_h"}]''::jsonb $b$';
    -- The prizes are balance dungeon_prizes (balance_economy.sql); the shape is fixed, so only place 1 changes.
    update balance set value = jsonb_set(value, '{weekly,0}', '{"packs": 2, "shards": 0, "cards": 0, "odds": {"secret_rare": 30, "illustrated_rare": 70}}') where key = 'dungeon_prizes';
    r := dungeon_pay('gauntlet', '2099-01-04');
    res := res || jsonb_build_object('case', 'dungeon_pay: ref (dungeon_payout, <mode>:<period>)', 'ok',
      (r->>'ok')::boolean and exists (select 1 from pack_ledger where player_id = '${P}_h' and reason = 'dungeon_prize' and amount = 2
        and ref_kind = 'dungeon_payout' and ref_id = 'gauntlet:2099-01-04') and pg_temp.tst_recon('${P}_h'), 'r', r);`)}
${kase('claim_tutorial_reward: ref (tutorial, complete)', `
    update players set tutorial = '{"done": ["open", "rarity", "collection", "hunt", "community", "dailies", "voice"]}' where id = '${P}_u';
    r := claim_tutorial_reward('${P}_u');
    res := res || jsonb_build_object('case', 'claim_tutorial_reward: ref (tutorial, complete)', 'ok',
      (r->>'ok')::boolean and exists (select 1 from pack_ledger where player_id = '${P}_u' and reason = 'tutorial' and ref_kind = 'tutorial' and ref_id = 'complete')
      and pg_temp.tst_recon('${P}_u'), 'r', r);`)}
${kase('a boon (play_card_effect calls grant_packs with the caster): ref (player, caster)', `
    perform grant_packs('${P}_g', 1, 'boon', '${P}_b');
    res := res || jsonb_build_object('case', 'a boon (play_card_effect calls grant_packs with the caster): ref (player, caster)', 'ok',
      exists (select 1 from pack_ledger where player_id = '${P}_g' and reason = 'boon' and ref_kind = 'player' and ref_id = '${P}_b' and granted_by = '${P}_b')
      and pg_temp.tst_recon('${P}_g'));`)}
${kase('every test member reconciles, and pack_ledger_reconcile() is ok for the whole database', `
    select count(*) into n from players where id like '${P}_%' and not pg_temp.tst_recon(id);
    r := pack_ledger_reconcile() - 'mismatched_rows';
    res := res || jsonb_build_object('case', 'every test member reconciles, and pack_ledger_reconcile() is ok for the whole database', 'ok',
      n = 0 and (r->>'ok')::boolean, 'bad_members', n, 'r', r);`)}
  raise exception 'RESULT:%', res::text;
end $t$;`;

const out = await q(body);
const msg = JSON.stringify(out);
const m = msg.match(/RESULT:(\[.*\])/);
if (!m) { console.log('FAIL the block did not return its results:', msg.slice(0, 1500)); process.exitCode = 1; }
else {
  const res = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  let fails = 0;
  for (const r of res) { if (!r.ok) fails += 1; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 400)}`); }
  console.log(`\n${OLD ? 'BASELINE (--old) ' : ''}${process.env.MUTATE ? `MUTATE=${process.env.MUTATE} ` : ''}${res.length - fails}/${res.length} pass, FAILS ${fails}`);
  if (fails) process.exitCode = 1;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', JSON.stringify(left));
