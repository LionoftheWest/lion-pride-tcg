/**
 * Acceptance test for tcg-bot/supabase/card_ledger.sql (audit plan step 4). Rolled back (the result comes back
 * in the exception), test members only:
 *   node scripts/test-card-ledger.mjs          the migration file, executed inside the block
 *   node scripts/test-card-ledger.mjs --old    the database as it is (before the migration: FAILS)
 *   MUTATE=<name> node scripts/test-card-ledger.mjs   one broken mechanism: must FAIL
 * Invariants:
 *   - a misspelled card reason is refused (card_move and a direct insert); a move with no ref is refused;
 *   - a member never goes below 0 copies: a remove of more than the member holds changes nothing;
 *   - every path that moves copies writes card_ledger rows with ref_kind + ref_id that point at its source row
 *     (pack open, tester open, member gift, event gift, trade, auction, shop, convert, ascend, Dungeon loot,
 *     Dungeon / Gauntlet prize); a failed trade moves nothing;
 *   - after each path the member reconciles: player_cards.quantity = sum(card_ledger.amount) for each card;
 *   - card_ledger_reconcile() is ok for the whole database (the seed included).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/card_ledger.sql', import.meta.url)), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$') || mig.includes('$c$')) throw new Error('the migration must not contain $m$ or $c$');

// Function mutations (fixtures.mjs) and constraint mutations (dropped inside the block).
const FN_MUT = {
  nofloor: ['public.card_move(text,bigint,integer,text,text,text,text)', 'if v_q is null or v_q < -p_amount then return null; end if;', 'if v_q is null then return null; end if;'],
  noledger: ['public.card_move(text,bigint,integer,text,text,text,text)', "insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id)\n  values (p_player, p_card, p_amount, p_reason, p_ref_kind, p_ref_id);", ''],
  ledgerdrift: ['public.card_move(text,bigint,integer,text,text,text,text)', 'values (p_player, p_card, p_amount, p_reason,', 'values (p_player, p_card, p_amount + 1, p_reason,'],
  openref: ['public.add_cards_to_player(text,bigint[])', "reason = 'opened' and ref_kind = 'open'", "reason = 'opened' and ref_kind = 'opn'"],
  giftref: ['public.add_card_to_player(text,bigint,text)', "kind = 'card' and claimed_at = now()", "kind = 'card' and claimed_at is null"],
  tradepartial: ['public.accept_trade(bigint,text)', "if card_move(t.to_id, t.request_card_id, -1, 'trade', 'trade_offer', p_offer_id::text) is null then raise exception 'trade_gone'; end if;", "if card_move(t.to_id, t.request_card_id, -1, 'trade', 'trade_offer', p_offer_id::text) is null then return false; end if;"],
  convertnoref: ['public.convert_dupes(text,bigint,integer)', "perform card_move(p_player, p_card, -p_count, 'convert', 'shard_ledger', v_row::text);", "update player_cards set quantity = quantity - p_count where player_id = p_player and card_id = p_card;"],
  ascendnoledger: ['public.ascend_card(text,bigint)', "perform card_move(p_player_id, p_card_id, -v_cost, 'ascend', 'ascension', p_card_id::text || ':' || (v_asc + 1));", "update player_cards set quantity = quantity - v_cost where player_id = p_player_id and card_id = p_card_id;"],
};
const SQL_MUT = {
  noreasoncheck: 'alter table card_ledger drop constraint card_ledger_reason_check;',
};
const MUT = process.env.MUTATE && SQL_MUT[process.env.MUTATE] ? (console.log(`MUTATE=${process.env.MUTATE}`), SQL_MUT[process.env.MUTATE]) : mutation(FN_MUT);

const P = 'tst_cl';
// One case: its body runs in a sub-block; an error is a failed case with the error text.
const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', ${`$c$${name}$c$`}, 'ok', false, 'r', sqlerrm);
  end;`;
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; ok boolean; g bigint; o bigint; n int; cs bigint[]; v text; w text; aid bigint; bid bigint; run bigint;
  sd date; ss int; sc bigint; sp int; before int;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the database as it is'}
  ${MUT}
  perform set_config('tcg.skip_welcome', 'on', true);
  update settings set value = value || '{"enabled": true}' where key = 'shards';
  insert into players (id, username) values ('${P}_a', 'tst a'), ('${P}_b', 'tst b'), ('${P}_c', 'tst c'), ('${P}_d', 'tst d'),
    ('${P}_e', 'tst e'), ('${P}_s', 'tst s'), ('${P}_h', 'tst h');
  -- Ten Normal draw cards that can be traded.
  select array_agg(id) into cs from (select id from cards where rarity = 'normal' and source = 'draw' and in_draw_pool and tradeable order by id limit 10) z;
  -- The member reconciles: for each card, quantity (0 with no row) = the sum of the ledger; no admin ('tx') row.
  create function pg_temp.cl_recon(p text) returns boolean language plpgsql as $r$
  begin
    return not exists (
      select 1 from (select card_id, quantity from player_cards where player_id = p) pc
        full join (select card_id, sum(amount) s from card_ledger where player_id = p group by card_id) l on l.card_id = pc.card_id
       where coalesce(pc.quantity, 0) <> coalesce(l.s, 0))
      and not exists (select 1 from card_ledger where player_id = p and ref_kind = 'tx');
  end $r$;
${kase('a misspelled reason is refused (card_move and a direct insert); a move with no ref is refused', `
    begin perform card_move('${P}_a', cs[1], 1, 'pakc', 'tx', '1'); ok := false; exception when check_violation then ok := true; end;
    if ok then begin insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id) values ('${P}_a', cs[1], 1, 'trdae', 'tx', '1'); ok := false; exception when check_violation then ok := true; end; end if;
    if ok then begin perform card_move('${P}_a', cs[1], 1, 'admin', null, null); ok := false; exception when others then ok := true; end; end if;
    res := res || jsonb_build_object('case', 'a misspelled reason is refused (card_move and a direct insert); a move with no ref is refused', 'ok',
      ok and not exists (select 1 from player_cards where player_id = '${P}_a'));`)}
${kase('open_packs: the cards of one open are pack rows with the open id of its pack_ledger rows', `
    perform grant_packs('${P}_a', 2, 'admin', null, 'gift', '0');
    n := open_packs('${P}_a', cs[1:5] || cs[1:5], 5);
    select max(ref_id) into v from pack_ledger where player_id = '${P}_a' and reason = 'opened';
    res := res || jsonb_build_object('case', 'open_packs: the cards of one open are pack rows with the open id of its pack_ledger rows', 'ok',
      n = 2 and (select sum(amount) from card_ledger where player_id = '${P}_a') = 10
      and not exists (select 1 from card_ledger where player_id = '${P}_a' and (reason <> 'pack' or ref_kind <> 'open' or ref_id <> v))
      and (select count(*) from card_ledger where player_id = '${P}_a') = 5
      and pg_temp.cl_recon('${P}_a'), 'n', n);`)}
${kase('a tester open (add_cards_to_player with no pack spent): test_pack rows with one test_open id', `
    perform add_cards_to_player('${P}_b', cs[1:5] || cs[1:2]);
    res := res || jsonb_build_object('case', 'a tester open (add_cards_to_player with no pack spent): test_pack rows with one test_open id', 'ok',
      (select count(distinct ref_id) from card_ledger where player_id = '${P}_b') = 1
      and not exists (select 1 from card_ledger where player_id = '${P}_b' and (reason <> 'test_pack' or ref_kind <> 'test_open'))
      and (select quantity from player_cards where player_id = '${P}_b' and card_id = cs[1]) = 2
      and pg_temp.cl_recon('${P}_b'));`)}
${kase('a remove of more copies than held changes nothing; quantity never below 0', `
    before := (select quantity from player_cards where player_id = '${P}_b' and card_id = cs[3]);
    n := card_move('${P}_b', cs[3], -(before + 1), 'admin', 'tx', '1');
    ok := true;
    begin update player_cards set quantity = -1 where player_id = '${P}_b' and card_id = cs[3]; ok := false; exception when check_violation then ok := true; end;
    res := res || jsonb_build_object('case', 'a remove of more copies than held changes nothing; quantity never below 0', 'ok',
      n is null and ok and (select quantity from player_cards where player_id = '${P}_b' and card_id = cs[3]) = before
      and not exists (select 1 from card_ledger where player_id = '${P}_b' and amount < 0) and pg_temp.cl_recon('${P}_b'), 'n', n);`)}
${kase('a member card gift: gift_sent and gift_received point at the same gift', `
    ok := gift_card('${P}_b', '${P}_c', cs[1]);
    select id into g from gift_claims where player_id = '${P}_c' and kind = 'card' and claimed_at is null;
    r := claim_gift('${P}_c', g);
    res := res || jsonb_build_object('case', 'a member card gift: gift_sent and gift_received point at the same gift', 'ok',
      ok and (r->>'ok')::boolean
      and exists (select 1 from card_ledger where player_id = '${P}_b' and card_id = cs[1] and amount = -1 and reason = 'gift_sent' and ref_kind = 'gift' and ref_id = g::text)
      and exists (select 1 from card_ledger where player_id = '${P}_c' and card_id = cs[1] and amount = 1 and reason = 'gift_received' and ref_kind = 'gift' and ref_id = g::text)
      and pg_temp.cl_recon('${P}_b') and pg_temp.cl_recon('${P}_c'), 'r', r);`)}
${kase('an event card gift claimed in the bell: event, ref (gift, id)', `
    ok := give_card_gift('${P}_c', cs[9], 'Test event card', 'event:tst_cl');
    select id into g from gift_claims where player_id = '${P}_c' and reason = 'event:tst_cl';
    r := claim_gift('${P}_c', g);
    res := res || jsonb_build_object('case', 'an event card gift claimed in the bell: event, ref (gift, id)', 'ok',
      ok and (r->>'ok')::boolean
      and exists (select 1 from card_ledger where player_id = '${P}_c' and card_id = cs[9] and amount = 1 and reason = 'event' and ref_kind = 'gift' and ref_id = g::text)
      and pg_temp.cl_recon('${P}_c'), 'r', r);`)}
${kase('a trade: four trade rows with ref (trade_offer, id)', `
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id) values ('${P}_b', '${P}_a', cs[2], cs[4]) returning id into o;
    ok := accept_trade(o, '${P}_a');
    res := res || jsonb_build_object('case', 'a trade: four trade rows with ref (trade_offer, id)', 'ok',
      ok and (select count(*) from card_ledger where ref_kind = 'trade_offer' and ref_id = o::text and reason = 'trade') = 4
      and (select sum(amount) from card_ledger where ref_kind = 'trade_offer' and ref_id = o::text) = 0
      and exists (select 1 from card_ledger where player_id = '${P}_a' and card_id = cs[2] and amount = 1 and ref_id = o::text)
      and exists (select 1 from card_ledger where player_id = '${P}_b' and card_id = cs[4] and amount = 1 and ref_id = o::text)
      and pg_temp.cl_recon('${P}_a') and pg_temp.cl_recon('${P}_b'));`)}
${kase('a trade whose requested copy is gone moves nothing and writes no row', `
    -- c holds no copy of cs[6]; the countered offer skips the free_copies check, so accept_trade reaches the moves.
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id, status) values ('${P}_b', '${P}_c', cs[3], cs[6], 'countered') returning id into o;
    before := (select quantity from player_cards where player_id = '${P}_b' and card_id = cs[3]);
    ok := accept_trade(o, '${P}_b');
    res := res || jsonb_build_object('case', 'a trade whose requested copy is gone moves nothing and writes no row', 'ok',
      not ok and (select quantity from player_cards where player_id = '${P}_b' and card_id = cs[3]) = before
      and not exists (select 1 from card_ledger where ref_kind = 'trade_offer' and ref_id = o::text)
      and pg_temp.cl_recon('${P}_b') and pg_temp.cl_recon('${P}_c'));`)}
${kase('an auction: the card and the bid cards move with ref (auction, id)', `
    perform add_cards_to_player('${P}_s', array[cs[7]]);
    perform add_cards_to_player('${P}_d', array[cs[8]]);
    r := start_auction('${P}_s', cs[7], null, 0, '{}', 'and', 1); aid := (r->>'id')::bigint;
    r := place_bid('${P}_d', aid, array[cs[8]]); bid := (r->>'id')::bigint;
    r := accept_bid('${P}_s', bid);
    r := confirm_bid('${P}_d', aid);
    res := res || jsonb_build_object('case', 'an auction: the card and the bid cards move with ref (auction, id)', 'ok',
      (r->>'ok')::boolean and (select count(*) from card_ledger where ref_kind = 'auction' and ref_id = aid::text and reason = 'auction') = 4
      and exists (select 1 from player_cards where player_id = '${P}_d' and card_id = cs[7])
      and exists (select 1 from player_cards where player_id = '${P}_s' and card_id = cs[8])
      and pg_temp.cl_recon('${P}_s') and pg_temp.cl_recon('${P}_d'), 'r', r);`)}
${kase('a shop card: shop, ref (shop_card, <day>:<slot>) = the shop_purchases row', `
    sd := shop_day(); perform shop_pick_stock(sd);
    select slot, card_id, price into ss, sc, sp from shop_stock where day = sd order by slot limit 1;
    perform grant_shards('${P}_e', sp + 10, 'admin', 'test', 'card ledger test');
    r := buy_shop_item('${P}_e', 'card', ss);
    res := res || jsonb_build_object('case', 'a shop card: shop, ref (shop_card, <day>:<slot>) = the shop_purchases row', 'ok',
      (r->>'ok')::boolean and exists (select 1 from shop_purchases where player_id = '${P}_e' and day = sd and kind = 'card' and slot = ss)
      and exists (select 1 from card_ledger where player_id = '${P}_e' and card_id = sc and amount = 1 and reason = 'shop' and ref_kind = 'shop_card' and ref_id = sd::text || ':' || ss)
      and pg_temp.cl_recon('${P}_e'), 'r', r);`)}
${kase('convert: the copies leave with ref (shard_ledger, the id of the Shards row)', `
    perform add_cards_to_player('${P}_e', array[cs[5], cs[5], cs[5]]);
    r := convert_dupes('${P}_e', cs[5], 2);
    res := res || jsonb_build_object('case', 'convert: the copies leave with ref (shard_ledger, the id of the Shards row)', 'ok',
      (r->>'ok')::boolean and exists (select 1 from card_ledger l join shard_ledger s on s.id::text = l.ref_id and s.player_id = l.player_id and s.reason = 'dupes'
        where l.player_id = '${P}_e' and l.card_id = cs[5] and l.amount = -2 and l.reason = 'convert' and l.ref_kind = 'shard_ledger')
      and (select quantity from player_cards where player_id = '${P}_e' and card_id = cs[5]) = 1
      and pg_temp.cl_recon('${P}_e'), 'r', r);`)}
${kase('ascend: the copies spent are one row with ref (ascension, <card>:<star>)', `
    perform add_cards_to_player('${P}_h', array_fill(cs[10], array[1 + ascend_cost('normal', 0)]));
    r := ascend_card('${P}_h', cs[10]);
    res := res || jsonb_build_object('case', 'ascend: the copies spent are one row with ref (ascension, <card>:<star>)', 'ok',
      (r->>'ok')::boolean and exists (select 1 from card_ledger where player_id = '${P}_h' and card_id = cs[10] and amount = -ascend_cost('normal', 0)
        and reason = 'ascend' and ref_kind = 'ascension' and ref_id = cs[10]::text || ':1')
      and (select quantity from player_cards where player_id = '${P}_h' and card_id = cs[10]) = 1
      and pg_temp.cl_recon('${P}_h'), 'r', r);`)}
${kase('Dungeon loot (dungeon_settle): dungeon_loot, ref (dungeon_run, id)', `
    insert into dungeon_runs (player_id, day, squad, state) values ('${P}_d', dungeon_day(), array[cs[1], cs[2], cs[3], cs[4], cs[5]],
      jsonb_build_object('phase', 'fight', 'bank', jsonb_build_object('shards', 0, 'cards', jsonb_build_array(cs[6])), 'pend', '{"shards":0,"cards":[]}'::jsonb))
      returning id into run;
    r := dungeon_settle(run, 'retreat', false);
    res := res || jsonb_build_object('case', 'Dungeon loot (dungeon_settle): dungeon_loot, ref (dungeon_run, id)', 'ok',
      exists (select 1 from card_ledger where player_id = '${P}_d' and card_id = cs[6] and amount = 1 and reason = 'dungeon_loot' and ref_kind = 'dungeon_run' and ref_id = run::text)
      and pg_temp.cl_recon('${P}_d'), 'r', r);`)}
${kase('a Gauntlet prize card (dungeon_pay): dungeon_prize, ref (dungeon_payout, <mode>:<period>)', `
    -- A fixed board (rolled back): only the pay path is under test here (test-dungeon.mjs tests the boards).
    execute 'create or replace function public.gauntlet_board(p_week date default null, p_limit integer default 20) returns jsonb language sql as $b$ select ''[{"rank": 1, "player_id": "${P}_h"}]''::jsonb $b$';
    -- The prizes are balance dungeon_prizes (balance_economy.sql); the shape is fixed, so only place 1 changes.
    update balance set value = jsonb_set(value, '{weekly,0}', '{"packs": 0, "shards": 0, "cards": 2, "odds": {"normal": 1, "secret_rare": 0, "illustrated_rare": 0}}') where key = 'dungeon_prizes';
    r := dungeon_pay('gauntlet', '2099-01-04');
    res := res || jsonb_build_object('case', 'a Gauntlet prize card (dungeon_pay): dungeon_prize, ref (dungeon_payout, <mode>:<period>)', 'ok',
      (r->>'ok')::boolean and (select coalesce(sum(amount), 0) from card_ledger where player_id = '${P}_h' and reason = 'dungeon_prize'
        and ref_kind = 'dungeon_payout' and ref_id = 'gauntlet:2099-01-04') = 2
      and pg_temp.cl_recon('${P}_h'), 'r', r);`)}
${kase('a move with no known source is an admin tx row, and the reconcile flags it', `
    begin
      ok := remove_card_from_player('${P}_c', cs[9]);
      r := card_ledger_reconcile() - 'mismatched_rows';
      v := (select reason || ':' || ref_kind from card_ledger where player_id = '${P}_c' and card_id = cs[9] and amount = -1);
      raise exception 'undo';
    exception when raise_exception then if sqlerrm <> 'undo' then raise; end if;
    end;
    res := res || jsonb_build_object('case', 'a move with no known source is an admin tx row, and the reconcile flags it', 'ok',
      ok and v = 'admin:tx' and not (r->>'ok')::boolean and (r->>'rows_tx_ref')::int = 1 and (r->>'mismatched')::int = 0, 'r', r);`)}
${kase('every test member reconciles, and card_ledger_reconcile() is ok for the whole database', `
    select count(*) into n from players where id like '${P}_%' and not pg_temp.cl_recon(id);
    r := card_ledger_reconcile() - 'mismatched_rows';
    res := res || jsonb_build_object('case', 'every test member reconciles, and card_ledger_reconcile() is ok for the whole database', 'ok',
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
