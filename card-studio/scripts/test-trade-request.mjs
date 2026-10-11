/**
 * trade_request.sql (Nathan, D-168): a trade REQUEST (ask for one of their cards, the owner picks one of
 * mine, I confirm) and a FULL PROPOSAL (both cards named). Rolled back; run it on the LOCAL copy:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-trade-request.mjs
 * BASELINE=1 runs the same cases WITHOUT the migration: the request cases must FAIL (the offer and
 * full-proposal cases are regression guards and pass).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.env.BASELINE ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/trade_request.sql', import.meta.url)), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const X = '999999999999999981', Y = '999999999999999982';
const has = (p, c) => `coalesce((select quantity from player_cards where player_id = '${p}' and card_id = ${c}), 0)`;
const kase = (name, sql) => String.raw`
  begin
    ${sql}
  exception when others then
    if sqlerrm like 'RESULTS%' then raise; end if;
    res := res || jsonb_build_object('case', ${`'${name.replace(/'/g, "''")}'`}, 'ok', false, 'error', replace(sqlerrm, '"', ''));
  end;`;
const add = (name, cond, extra = '') => `res := res || jsonb_build_object('case', ${`'${name.replace(/'/g, "''")}'`}, 'ok', coalesce(${cond}, false)${extra});`;
const body = String.raw`do $t$
declare res jsonb := '[]'; a bigint; b bigint; c bigint; d bigint; s bigint; o bigint; o2 bigint; o3 bigint; o4 bigint; ok boolean;
begin
  ${mig ? `execute $m$${mig}$m$;` : ''}
  select x[1], x[2], x[3], x[4] into a, b, c, d from (select array_agg(id order by id) x from cards where tradeable and rarity::text = 'normal') n;
  select min(id) into s from cards where tradeable and rarity::text = 'secret_rare';
  insert into players (id, username) values ('${X}', 'tst req x'), ('${Y}', 'tst req y');
  -- X has a, c, s. Y has b and a. Nobody has d.
  insert into player_cards (player_id, card_id, quantity) values ('${X}', a, 1), ('${X}', c, 1), ('${X}', s, 1), ('${Y}', b, 1), ('${Y}', a, 1);

  ${kase('R1. a request makes a pending row with no offer card and holds no copy', `
    o := create_trade_request('${X}', '${Y}', b);
    ${add('R1. a request makes a pending row with no offer card and holds no copy', `o is not null and (select offer_card_id is null and request_card_id = b and status = 'pending' and from_id = '${X}' and to_id = '${Y}' from trade_offers where id = o) and free_copies('${Y}', b) = 1 and free_copies('${X}', a) = 1`)}
    ${add('R2. nobody can accept a request that has no picked card', `not accept_trade(o, '${X}') and not accept_trade(o, '${Y}')`)}
    ${add('R3. the old counter_trade does not act on a request', `not counter_trade(o, '${Y}', a)`)}
    ${add('R4. only the card owner picks', `not counter_trade_request(o, '${X}', a)`)}
    ${add('R5. the owner cannot pick the requested card itself', `not counter_trade_request(o, '${Y}', b)`)}
    ${add('R6. a pick of a card the requester does not have is refused', `not counter_trade_request(o, '${Y}', d)`)}
    ${add('R7. a pick of another rarity is refused', `not counter_trade_request(o, '${Y}', s)`)}
    o3 := create_trade_open('${X}', '${Y}', a);
    ${add('R8. a pick of a card the requester holds in another offer is refused', `o3 is not null and free_copies('${X}', a) = 0 and not counter_trade_request(o, '${Y}', a)`)}
    ok := set_trade_status(o3, '${X}', 'cancelled');
    ok := counter_trade_request(o, '${Y}', a);
    ${add('R9. the owner picks a card of the requester: countered, both cards are held', `ok and (select offer_card_id = a and request_card_id = b and status = 'countered' and countered_at is not null from trade_offers where id = o) and free_copies('${X}', a) = 0 and free_copies('${Y}', b) = 0`)}
    ${add('R10. after the pick the owner cannot accept (the requester decides)', `not accept_trade(o, '${Y}')`)}
    ok := accept_trade(o, '${X}');
    ${add('R11. the requester confirms: the cards swap, the ledger and the swap log have the rows', `ok and ${has(X, 'a')} = 0 and ${has(X, 'b')} = 1 and ${has(Y, 'b')} = 0 and ${has(Y, 'a')} = 2
      and (select status = 'accepted' and resolved_at is not null from trade_offers where id = o)
      and (select count(*) from card_ledger where ref_kind = 'trade_offer' and ref_id = o::text) = 4
      and (select sum(amount) from card_ledger where ref_kind = 'trade_offer' and ref_id = o::text and player_id = '${X}') = 0
      and (select amount from card_ledger where ref_kind = 'trade_offer' and ref_id = o::text and player_id = '${X}' and card_id = b) = 1
      and (select amount from card_ledger where ref_kind = 'trade_offer' and ref_id = o::text and player_id = '${Y}' and card_id = b) = -1
      and exists (select 1 from card_trades where offer_id = o and from_id = '${X}' and to_id = '${Y}' and from_cards = array[a] and to_cards = array[b])`)}`)}

  -- Now X has b, c, s. Y has a x2.
  delete from player_cards where player_id in ('${X}', '${Y}');
  insert into player_cards (player_id, card_id, quantity) values ('${X}', b, 1), ('${X}', c, 1), ('${X}', s, 1), ('${Y}', a, 2);
  ${kase('R12. a request of a card the owner does not have free is refused', `
    ${add('R12. a request of a card the owner does not have free is refused', `create_trade_request('${X}', '${Y}', b) is null and create_trade_request('${X}', '${Y}', d) is null and create_trade_request('${X}', '${X}', b) is null and create_trade_request('${X}', '999999999999999900', b) is null`)}
    o := create_trade_open('${Y}', '${X}', a);
    o2 := create_trade_open('${Y}', '${X}', a);
    ${add('R13. a copy that the owner holds in offers is not free to request', `o is not null and o2 is not null and free_copies('${Y}', a) = 0 and create_trade_request('${X}', '${Y}', a) is null`)}
    ok := set_trade_status(o, '${Y}', 'cancelled') and set_trade_status(o2, '${Y}', 'cancelled');`)}

  ${kase('R14. decline and cancel of a request release the held copies', `
    o := create_trade_request('${Y}', '${X}', b);          -- Y asks X for b
    ok := not set_trade_status(o, '${Y}', 'declined');
    ok := ok and set_trade_status(o, '${X}', 'declined'); -- read the row in a later statement (an inner update is not seen by the same query)
    ${add('R14. the owner declines a pending request', `o is not null and ok and (select status from trade_offers where id = o) = 'declined'`)}
    o := create_trade_request('${Y}', '${X}', b);
    ok := counter_trade_request(o, '${X}', a);              -- X picks a (Y has two)
    ${add('R15. the picked copies are held', `ok and free_copies('${Y}', a) = 1 and free_copies('${X}', b) = 0`)}
    ${add('R16. the owner declines a countered request: both copies are free again', `set_trade_status(o, '${X}', 'declined') and free_copies('${Y}', a) = 2 and free_copies('${X}', b) = 1`)}
    o2 := create_trade_request('${Y}', '${X}', b);
    ok := counter_trade_request(o2, '${X}', a);
    ${add('R17. the requester cancels a countered request: both copies are free again', `ok and not set_trade_status(o2, '${X}', 'cancelled') and set_trade_status(o2, '${Y}', 'cancelled') and free_copies('${Y}', a) = 2 and free_copies('${X}', b) = 1 and not accept_trade(o2, '${Y}')`)}
    o3 := create_trade_request('${Y}', '${X}', b);
    ${add('R18. the requester cancels a pending request', `set_trade_status(o3, '${Y}', 'cancelled') and not counter_trade_request(o3, '${X}', a)`)}`)}

  delete from player_cards where player_id in ('${X}', '${Y}');
  insert into player_cards (player_id, card_id, quantity) values ('${X}', b, 1), ('${X}', c, 1), ('${X}', s, 1), ('${Y}', a, 2);
  ${kase('R19. the existing offer flow still works', `
    o := create_trade_open('${X}', '${Y}', b);
    ok := counter_trade(o, '${Y}', a);
    ok := ok and not accept_trade(o, '${Y}');
    ok := ok and accept_trade(o, '${X}');
    ${add('R19. the existing offer flow still works', `o is not null and ok and ${has(X, 'b')} = 0 and ${has(X, 'a')} = 1 and ${has(Y, 'b')} = 1 and ${has(Y, 'a')} = 1`)}`)}

  -- Now X has a, c, s. Y has a, b.
  delete from player_cards where player_id in ('${X}', '${Y}');
  insert into player_cards (player_id, card_id, quantity) values ('${X}', a, 1), ('${X}', c, 1), ('${X}', s, 1), ('${Y}', a, 1), ('${Y}', b, 1);
  ${kase('R20. a full proposal: the receiver accepts, the sender cannot', `
    o := create_trade('${X}', '${Y}', a, b);
    ${add('R20. a full proposal holds the offered copy and the sender cannot accept it', `o is not null and (select status = 'pending' and offer_card_id = a and request_card_id = b from trade_offers where id = o) and free_copies('${X}', a) = 0 and not accept_trade(o, '${X}')`)}
    ok := accept_trade(o, '${Y}');
    ${add('R21. the receiver accepts a full proposal: the cards swap', `ok and ${has(X, 'a')} = 0 and ${has(X, 'b')} = 1 and ${has(Y, 'a')} = 2 and ${has(Y, 'b')} = 0 and (select count(*) from card_ledger where ref_kind = 'trade_offer' and ref_id = o::text) = 4`)}
    o2 := create_trade('${X}', '${Y}', b, a);
    ${add('R22. the receiver declines a full proposal', `set_trade_status(o2, '${Y}', 'declined') and free_copies('${X}', b) = 1`)}`)}
  raise exception 'RESULTS %', res;
end $t$;`;
console.log(process.env.BASELINE ? '== BASELINE (no migration)' : '== WITH trade_request.sql');
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 300)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after (unchanged):', JSON.stringify(await q("select (select count(*) from players where id like '99999999999999998%') test_players")));
process.exit(fail ? 1 : 0);
