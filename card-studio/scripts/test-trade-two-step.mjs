/**
 * trade_two_step.sql (Nathan, 2026-10-01): offer one card -> the receiver picks a card of the
 * same rarity -> the sender accepts -> the swap. Rolled back against the LIVE database:
 *   node scripts/test-trade-two-step.mjs        (BASELINE=1: without the migration)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.env.BASELINE ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/trade_two_step.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const X = '999999999999999991', Y = '999999999999999992';
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
declare res jsonb := '[]'; a bigint; b bigint; c bigint; s bigint; o bigint; o2 bigint; ok boolean;
begin
  ${mig ? `execute $m$${mig}$m$;` : ''}
  select x[1], x[2], x[3] into a, b, c from (select array_agg(id order by id) x from cards where tradeable and rarity::text = 'normal') n;
  select min(id) into s from cards where tradeable and rarity::text = 'secret_rare';
  insert into players (id, username) values ('${X}', 'tst two x'), ('${Y}', 'tst two y');
  insert into player_cards (player_id, card_id, quantity) values ('${X}', a, 1), ('${Y}', b, 1), ('${Y}', s, 1), ('${Y}', a, 1);
  ${kase('1. an offer names only the sender card, and reserves it', `
    o := create_trade_open('${X}', '${Y}', a);
    ${add('1. an offer names only the sender card, and reserves it', `o is not null and (select request_card_id is null and status = 'pending' from trade_offers where id = o) and free_copies('${X}', a) = 0`)}
    ${add('2. the reserved copy cannot go into a second offer', `create_trade_open('${X}', '${Y}', a) is null`)}
    ${add('3. the sender cannot accept before the receiver picks', `not accept_trade(o, '${X}') and not accept_trade(o, '${Y}')`)}
    ${add('4. the receiver cannot pick another rarity', `not counter_trade(o, '${Y}', s)`)}
    ${add('5. the receiver cannot pick the same card back', `not counter_trade(o, '${Y}', a)`)}
    ${add('6. the receiver cannot pick a card they do not own', `not counter_trade(o, '${Y}', c)`)}
    ${add('7. only the receiver can pick', `not counter_trade(o, '${X}', b)`)}
    ok := counter_trade(o, '${Y}', b);
    ${add('8. the receiver picks a card of the same rarity: countered, the pick is reserved', `ok and (select status = 'countered' and request_card_id = b from trade_offers where id = o) and free_copies('${Y}', b) = 0`)}
    ${add('9. after the pick, the receiver cannot accept (the sender decides)', `not accept_trade(o, '${Y}')`)}
    ok := accept_trade(o, '${X}');
    ${add('10. the sender accepts: the cards swap, marked trade', `ok and ${has(X, 'a')} = 0 and ${has(X, 'b')} = 1 and ${has(Y, 'b')} = 0 and ${has(Y, 'a')} = 2
      and (select first_source from player_cards where player_id = '${X}' and card_id = b) = 'trade' and (select status from trade_offers where id = o) = 'accepted'`)}`)}
  ${kase('11. the receiver can decline a countered trade, the sender can cancel an open one', `
    o := create_trade_open('${Y}', '${X}', a);
    ok := counter_trade(o, '${X}', b);
    o2 := create_trade_open('${Y}', '${X}', s);
    ${add('11. the receiver can decline a countered trade, the sender can cancel an open one', `ok and set_trade_status(o, '${X}', 'declined') and set_trade_status(o2, '${Y}', 'cancelled')
      and free_copies('${X}', b) = 1 and free_copies('${Y}', s) = 1`)}`)}
  ${kase('12. an old offer that names both cards still accepts by the receiver', `
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id) values ('${X}', '${Y}', b, a) returning id into o;
    ok := accept_trade(o, '${Y}');
    ${add('12. an old offer that names both cards still accepts by the receiver', `ok and ${has(Y, 'b')} = 1`, `, 'accept', ok, 'yb', ${has(Y, 'b')}, 'xb', ${has(X, 'b')}, 'ya', ${has(Y, 'a')}`)}`)}
  raise exception 'RESULTS %', res;
end $t$;`;
console.log(process.env.BASELINE ? '== BASELINE (no migration)' : '== WITH trade_two_step.sql');
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 300)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after (live unchanged):', JSON.stringify(await q("select (select count(*) from players where id like '99999999999999999%') test_players, (select count(*) from pg_proc where proname = 'counter_trade') counter_live")));
process.exit(fail ? 1 : 0);
