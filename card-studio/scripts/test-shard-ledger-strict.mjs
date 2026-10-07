/**
 * Acceptance test for tcg-bot/supabase/shard_ledger_strict.sql. Rolled back (the result comes back in the
 * exception), test members only:
 *   node scripts/test-shard-ledger-strict.mjs          the migration file, executed inside the block
 *   node scripts/test-shard-ledger-strict.mjs --old    the database as it is (before the migration: FAILS)
 *   MUTATE=<name> node scripts/test-shard-ledger-strict.mjs   one broken mechanism: must FAIL
 * Invariants:
 *   - a Shard reason that no writer uses is refused; a row without a ref is refused; a negative balance is refused;
 *   - every path that writes Shards writes ref_kind + ref_id that point at ONE source row;
 *   - after each path the member reconciles: shard_balance = sum(shard_ledger.amount), no row without a ref;
 *   - after a Dungeon run ends, dungeon_runs.shards / cards = its shard_ledger / card_ledger rows;
 *   - shard_ledger_reconcile() is ok for the whole database, and it reports a balance or run total that drifts.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/shard_ledger_strict.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$') || mig.includes('$c$')) throw new Error('the migration must not contain $m$ or $c$');

// Function mutations (fixtures.mjs) and constraint mutations (dropped inside the block).
const FN_MUT = {
  dailyoldref: ['public.claim_daily(text,text)', "'daily', 'daily_claim', d::text || ':' || p_task)", "'daily', 'daily', p_task)"],
  chatoldref: ['public.claim_daily_earn(text,date,integer,integer,integer)', "'daily', 'daily_claim', p_date::text || ':chat')", "'daily', 'daily', 'chat')"],
  shopoldref: ['public.buy_shop_item(text,text,integer,bigint,integer)', "'shop', 'shop_purchase', v_purchase::text);\n", "'shop', 'pack', p_qty::text);\n"],
  payoldref: ['public.dungeon_pay(text,date)', "'dungeon', 'dungeon_payout', p_mode || ':' || p_period::text)", "'dungeon', 'prize_' || p_mode, p_period::text)"],
  ledgerdrift: ['public.grant_shards(text,integer,text,text,text)', 'values (p_player, p_amount, p_reason,', 'values (p_player, p_amount + 1, p_reason,'],
  settledrift: ['public.dungeon_settle(bigint,text,boolean)', 'shards = v_sh,', 'shards = v_sh + 1,'],
  settlefindrun: ['public.dungeon_settle(bigint,text,boolean)', "perform card_move(r.player_id, (x #>> '{}')::bigint, 1, 'dungeon_loot', 'dungeon_run', r.id::text, 'dungeon');", "perform add_card_to_player(r.player_id, (x #>> '{}')::bigint, 'dungeon');"],
  reconblind: ['public.shard_ledger_reconcile()', 'and x.runs_shards_mismatched = 0 and x.runs_cards_mismatched = 0', ''],
};
const SQL_MUT = {
  noreasoncheck: 'alter table shard_ledger drop constraint shard_ledger_reason_check;',
  norefcheck: 'alter table shard_ledger drop constraint shard_ledger_ref_check;',
  nobalancecheck: 'alter table players drop constraint players_shard_balance_nonneg;',
};
const MUT = process.env.MUTATE && SQL_MUT[process.env.MUTATE] ? (console.log(`MUTATE=${process.env.MUTATE}`), SQL_MUT[process.env.MUTATE]) : mutation(FN_MUT);

const P = 'tst_sls';
const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', ${`$c$${name}$c$`}, 'ok', false, 'r', sqlerrm);
  end;`;
// ok + the case name, in one place.
const done = (name, cond, extra = '') => `res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', coalesce(${cond}, false)${extra});`;
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; ok boolean; g bigint; n int; c bigint; c2 bigint; run bigint; run2 bigint; pid bigint; x text;
  d date := (now() at time zone 'America/Denver')::date;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the database as it is'}
  ${MUT}
  perform set_config('tcg.skip_welcome', 'on', true);
  update settings set value = '1'::jsonb where key = 'pack_earn_multiplier';
  update settings set value = value || '{"enabled": true}' where key = 'dailies';
  update settings set value = value || '{"enabled": true}' where key = 'shards';
  update settings set value = '{"enabled": true, "users": []}'::jsonb where key = 'achievement_tracks';
  insert into players (id, username) values ('${P}_a', 'tst a'), ('${P}_d', 'tst d'), ('${P}_e', 'tst e'), ('${P}_s', 'tst s'),
    ('${P}_k', 'tst k'), ('${P}_h', 'tst h'), ('${P}_g', 'tst g'), ('${P}_v', 'tst v'), ('${P}_t', 'tst t'), ('${P}_r', 'tst r');
  select min(id) into c from cards where rarity = 'normal';
  select min(id) into c2 from cards where rarity = 'normal' and id > c;
  -- The member reconciles: balance = the sum of the ledger, and no row without a ref.
  create function pg_temp.tst_recon(p text) returns boolean language plpgsql as $r$
  begin
    return (select shard_balance from players where id = p) = (select coalesce(sum(amount), 0) from shard_ledger where player_id = p)
       and not exists (select 1 from shard_ledger where player_id = p and (ref_kind is null or ref_id is null));
  end $r$;
  -- One run's totals equal its ledger rows (the shard_ledger_reconcile rule, for one run).
  create function pg_temp.tst_run(p bigint) returns boolean language plpgsql as $r$
  begin
    return (select shards from dungeon_runs where id = p) = (select coalesce(sum(amount), 0) from shard_ledger
              where reason = 'dungeon' and ref_kind = 'run' and ref_id = p::text)
       and (select array(select unnest(cards) order by 1) from dungeon_runs where id = p)
         = coalesce((select array_agg(card_id order by card_id) from card_ledger where reason = 'dungeon_loot' and ref_kind = 'dungeon_run' and ref_id = p::text), '{}');
  end $r$;
${kase('a reason that no writer uses is refused (grant_shards and a direct insert)', `
    begin perform grant_shards('${P}_a', 5, 'arena', 'test', 'x'); ok := false; exception when check_violation then ok := true; end;
    if ok then begin insert into shard_ledger (player_id, amount, reason, ref_kind, ref_id) values ('${P}_a', 5, 'dialy', 'test', 'x'); ok := false; exception when check_violation then ok := true; end; end if;
    ${done('a reason that no writer uses is refused (grant_shards and a direct insert)', 'ok')}`)}
${kase('a Shard row without a ref is refused', `
    begin perform grant_shards('${P}_a', 5, 'admin'); ok := false; exception when check_violation then ok := true; end;
    if ok then begin perform grant_shards('${P}_a', 5, 'admin', 'test', null); ok := false; exception when check_violation then ok := true; end; end if;
    ${done('a Shard row without a ref is refused', "ok and pg_temp.tst_recon('" + P + "_a')")}`)}
${kase('a negative Shard balance is refused', `
    begin update players set shard_balance = -1 where id = '${P}_a'; ok := false; exception when check_violation then ok := true; end;
    if ok then begin perform grant_shards('${P}_a', -1, 'admin', 'test', 'x'); ok := false; exception when check_violation then ok := true; end; end if;
    ${done('a negative Shard balance is refused', "ok and pg_temp.tst_recon('" + P + "_a')")}`)}
${kase('claim_daily: ref (daily_claim, <day>:<task>)', `
    r := claim_daily('${P}_d', 'checkin');
    ${done('claim_daily: ref (daily_claim, <day>:<task>)', `(r->>'ok')::boolean and (r->>'shards')::int > 0
      and exists (select 1 from daily_claims where player_id = '${P}_d' and day = d and task = 'checkin')
      and (select count(*) from shard_ledger where player_id = '${P}_d') = 1
      and exists (select 1 from shard_ledger where player_id = '${P}_d' and reason = 'daily' and ref_kind = 'daily_claim' and ref_id = d::text || ':checkin')
      and pg_temp.tst_recon('${P}_d')`, ", 'r', r")}`)}
${kase('claim_daily_earn: the two chat dailies, ref (daily_claim, <day>:chat / chat_bonus)', `
    insert into daily_activity (player_id, activity_date, message_count) values ('${P}_e', d, 25);
    n := claim_daily_earn('${P}_e', d, 1, 1, 25);
    ${done('claim_daily_earn: the two chat dailies, ref (daily_claim, <day>:chat / chat_bonus)', `(select count(*) from shard_ledger where player_id = '${P}_e') = 2
      and exists (select 1 from shard_ledger where player_id = '${P}_e' and reason = 'daily' and ref_kind = 'daily_claim' and ref_id = d::text || ':chat')
      and exists (select 1 from shard_ledger where player_id = '${P}_e' and reason = 'daily' and ref_kind = 'daily_claim' and ref_id = d::text || ':chat_bonus')
      and pg_temp.tst_recon('${P}_e')`)}`)}
${kase('buy_shop_item (packs): ref (shop_purchase, id), amount = - the price', `
    perform grant_shards('${P}_s', 5000, 'admin', 'test', 'shard ledger test');
    r := buy_shop_item('${P}_s', 'pack', null, null, 2);
    select id into pid from shop_purchases where player_id = '${P}_s' and kind = 'pack';
    ${done('buy_shop_item (packs): ref (shop_purchase, id), amount = - the price', `(r->>'ok')::boolean
      and exists (select 1 from shard_ledger l join shop_purchases s on s.id = pid
                   where l.player_id = '${P}_s' and l.reason = 'shop' and l.ref_kind = 'shop_purchase' and l.ref_id = pid::text and l.amount = -s.price)
      and exists (select 1 from pack_ledger where player_id = '${P}_s' and reason = 'shop' and ref_kind = 'shop_purchase' and ref_id = pid::text)
      and pg_temp.tst_recon('${P}_s')`, ", 'r', r")}`)}
${kase('buy_shop_item (a card of the day): ref (shop_purchase, id); the card row keeps its slot ref', `
    perform shop_pick_stock(shop_day());
    select min(slot) into n from shop_stock where day = shop_day();
    r := buy_shop_item('${P}_s', 'card', n);
    select id into pid from shop_purchases where player_id = '${P}_s' and kind = 'card';
    ${done('buy_shop_item (a card of the day): ref (shop_purchase, id); the card row keeps its slot ref', `(r->>'ok')::boolean
      and exists (select 1 from shard_ledger l join shop_purchases s on s.id = pid
                   where l.player_id = '${P}_s' and l.reason = 'shop' and l.ref_kind = 'shop_purchase' and l.ref_id = pid::text and l.amount = -s.price)
      and exists (select 1 from card_ledger where player_id = '${P}_s' and reason = 'shop' and ref_kind = 'shop_card' and ref_id = shop_day()::text || ':' || n)
      and pg_temp.tst_recon('${P}_s')`, ", 'r', r")}`)}
${kase('buy_shop_item (a paid stat reset): ref (shop_purchase, id); a free reset writes no Shards row', `
    perform card_move('${P}_s', c, 1, 'admin', 'tx', 'shard ledger test');
    update player_cards set stat_points = '{"attack": 1}' where player_id = '${P}_s' and card_id = c;
    r := buy_shop_item('${P}_s', 'stat_reset', null, c);          -- the free weekly reset
    ok := (r->>'free')::boolean and not exists (select 1 from shard_ledger where player_id = '${P}_s' and amount = 0);
    update player_cards set stat_points = '{"attack": 1}' where player_id = '${P}_s' and card_id = c;
    r := buy_shop_item('${P}_s', 'stat_reset', null, c);          -- the paid one
    select max(id) into pid from shop_purchases where player_id = '${P}_s' and kind = 'stat_reset';
    ${done('buy_shop_item (a paid stat reset): ref (shop_purchase, id); a free reset writes no Shards row', `ok and (r->>'ok')::boolean and not (r->>'free')::boolean
      and exists (select 1 from shard_ledger l join shop_purchases s on s.id = pid
                   where l.player_id = '${P}_s' and l.reason = 'shop' and l.ref_kind = 'shop_purchase' and l.ref_id = pid::text and l.amount = -s.price and s.price > 0)
      and (select count(*) from shard_ledger where player_id = '${P}_s' and reason = 'shop') = 3
      and pg_temp.tst_recon('${P}_s')`, ", 'r', r")}`)}
${kase('convert_dupes: ref (card, id); the card_ledger convert row points at this Shards row', `
    perform card_move('${P}_k', c, 3, 'admin', 'tx', 'shard ledger test');
    r := convert_dupes('${P}_k', c, 2);
    select id into g from shard_ledger where player_id = '${P}_k' and reason = 'dupes';
    ${done('convert_dupes: ref (card, id); the card_ledger convert row points at this Shards row', `(r->>'ok')::boolean
      and exists (select 1 from shard_ledger where id = g and ref_kind = 'card' and ref_id = c::text)
      and exists (select 1 from card_ledger where player_id = '${P}_k' and reason = 'convert' and amount = -2 and ref_kind = 'shard_ledger' and ref_id = g::text)
      and pg_temp.tst_recon('${P}_k')`, ", 'r', r")}`)}
${kase('claim_gift (a Shards gift): ref (gift, id)', `
    insert into gift_claims (player_id, kind, title, amount, shards, reason) values ('${P}_g', 'promo', 'Test', 0, 300, 'event') returning id into g;
    r := claim_gift('${P}_g', g);
    ${done('claim_gift (a Shards gift): ref (gift, id)', `(r->>'ok')::boolean
      and exists (select 1 from shard_ledger where player_id = '${P}_g' and reason = 'event' and amount = 300 and ref_kind = 'gift' and ref_id = g::text)
      and pg_temp.tst_recon('${P}_g')`, ", 'r', r")}`)}
${kase('claim_achievement_tiers (milestone Shards): ref (achievement, the tier key)', `
    g := give_gift('${P}_t', 'promo', 'Test', 10, 'event', null);
    perform claim_gift('${P}_t', g);
    n := open_packs('${P}_t', (select array_agg(id) from (select id from cards order by id limit 10) z), 1);
    r := claim_achievement_tiers('${P}_t', 'track:packs');
    ${done('claim_achievement_tiers (milestone Shards): ref (achievement, the tier key)', `(r->>'ok')::boolean
      and exists (select 1 from shard_ledger where player_id = '${P}_t' and reason = 'milestone' and ref_kind = 'achievement' and ref_id = 'track:packs:1')
      and not exists (select 1 from shard_ledger where player_id = '${P}_t' and reason = 'milestone' and (ref_kind is distinct from 'achievement' or ref_id not like 'track:packs:%'))
      and pg_temp.tst_recon('${P}_t')`, ", 'r', r")}`)}
${kase('dungeon_pay (a board prize): ref (dungeon_payout, <mode>:<period>), the same ref as the pack row', `
    -- A fixed board (rolled back): only the pay path is under test here (test-dungeon.mjs tests the boards).
    execute 'create or replace function public.dungeon_board(p_day date default null, p_limit integer default 20) returns jsonb language sql as $b$ select ''[{"rank": 1, "player_id": "${P}_h"}]''::jsonb $b$';
    update balance set value = jsonb_set(value, '{daily,0}', '{"packs": 1, "shards": 300}') where key = 'dungeon_prizes';
    r := dungeon_pay('daily', '2099-01-04');
    ${done('dungeon_pay (a board prize): ref (dungeon_payout, <mode>:<period>), the same ref as the pack row', `(r->>'ok')::boolean
      and exists (select 1 from shard_ledger where player_id = '${P}_h' and reason = 'dungeon' and amount = 300 and ref_kind = 'dungeon_payout' and ref_id = 'daily:2099-01-04')
      and exists (select 1 from pack_ledger where player_id = '${P}_h' and reason = 'dungeon_prize' and ref_kind = 'dungeon_payout' and ref_id = 'daily:2099-01-04')
      and pg_temp.tst_recon('${P}_h')`, ", 'r', r")}`)}
${kase('dungeon_settle: the run totals (shards, cards) equal its ledger rows (cleared with the pending loot, and fell without it)', `
    insert into dungeon_runs (player_id, day, squad, state) values ('${P}_r', '2099-01-04', '{}',
      jsonb_build_object('phase', 'fight', 'bank', jsonb_build_object('shards', 30, 'cards', jsonb_build_array(c)),
                                           'pend', jsonb_build_object('shards', 10, 'cards', jsonb_build_array(c2)))) returning id into run;
    insert into dungeon_runs (player_id, day, squad, state) values ('${P}_r', '2099-01-05', '{}',
      jsonb_build_object('phase', 'fight', 'bank', jsonb_build_object('shards', 30, 'cards', jsonb_build_array(c)),
                                           'pend', jsonb_build_object('shards', 10, 'cards', jsonb_build_array(c2)))) returning id into run2;
    r := dungeon_settle(run, 'cleared', true);
    perform dungeon_settle(run2, 'fell', false);
    ${done('dungeon_settle: the run totals (shards, cards) equal its ledger rows (cleared with the pending loot, and fell without it)', `(select shards from dungeon_runs where id = run) = 40 and (select shards from dungeon_runs where id = run2) = 30
      and cardinality((select cards from dungeon_runs where id = run)) = 2 and cardinality((select cards from dungeon_runs where id = run2)) = 1
      and pg_temp.tst_run(run) and pg_temp.tst_run(run2) and pg_temp.tst_recon('${P}_r')`, ", 'r', r")}`)}
${kase('every test member reconciles, and shard_ledger_reconcile() is ok for the whole database', `
    select count(*) into n from players where id like '${P}_%' and not pg_temp.tst_recon(id);
    r := shard_ledger_reconcile() - 'mismatched_rows';
    ${done('every test member reconciles, and shard_ledger_reconcile() is ok for the whole database', `n = 0 and (r->>'ok')::boolean and (r->>'runs_shards_mismatched')::int = 0 and (r->>'runs_cards_mismatched')::int = 0
      and (r->>'runs_cards_checked')::int >= 2`, ", 'bad_members', n, 'r', r")}`)}
${kase('shard_ledger_reconcile() reports a drift: a balance, a run Shards total, a run cards total', `
    update players set shard_balance = shard_balance + 1 where id = '${P}_a';
    ok := not (shard_ledger_reconcile()->>'ok')::boolean and (shard_ledger_reconcile()->>'mismatched')::int = 1;
    update players set shard_balance = shard_balance - 1 where id = '${P}_a';
    update dungeon_runs set shards = shards + 1 where id = run;
    ok := ok and not (shard_ledger_reconcile()->>'ok')::boolean and (shard_ledger_reconcile()->>'runs_shards_mismatched')::int = 1;
    update dungeon_runs set shards = shards - 1, cards = cards[1:1] where id = run;
    ok := ok and not (shard_ledger_reconcile()->>'ok')::boolean and (shard_ledger_reconcile()->>'runs_cards_mismatched')::int = 1;
    ${done('shard_ledger_reconcile() reports a drift: a balance, a run Shards total, a run cards total', 'ok')}`)}
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
