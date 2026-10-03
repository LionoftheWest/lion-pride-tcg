/**
 * fix_last_copy_remove.sql (2026-10-01): Accept on a trade did nothing when a member gave
 * their last copy. Rolled back against the LIVE database:  node scripts/test-trade-accept.mjs
 * BASELINE=1 runs the same cases WITHOUT the migration (the cases of a last copy must fail).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.env.BASELINE ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/fix_last_copy_remove.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const X = '999999999999999971', Y = '999999999999999972';
// Each case runs in its own sub-block, so an error in one case is a FAIL, not the end of the run.
const kase = (name, sql) => String.raw`
  begin
    ${sql}
  exception when others then
    if sqlerrm like 'RESULTS%' then raise; end if;
    res := res || jsonb_build_object('case', ${`'${name.replace(/'/g, "''")}'`}, 'ok', false, 'error', replace(sqlerrm, '"', ''));
  end;`;
const has = (p, c) => `coalesce((select quantity from player_cards where player_id = '${p}' and card_id = ${c}), 0)`;
const body = String.raw`do $t$
declare res jsonb := '[]'; a bigint; b bigint; c bigint; o bigint; ok boolean;
begin
  ${mig ? `execute $m$${mig}$m$;` : ''}
  -- Three tradeable non-gold cards of one rarity (a swap must be the same rarity).
  select x[1], x[2], x[3] into a, b, c from (select array_agg(id order by id) x from cards
    where tradeable and rarity::text = 'normal') s;
  insert into players (id, username) values ('${X}', 'tst trade x'), ('${Y}', 'tst trade y');
  ${kase('a swap of two LAST copies moves both cards and closes the offer', String.raw`
    insert into player_cards (player_id, card_id, quantity) values ('${X}', a, 1), ('${Y}', b, 1);
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id) values ('${X}', '${Y}', a, b) returning id into o;
    ok := accept_trade(o, '${Y}');
    res := res || jsonb_build_object('case', 'a swap of two LAST copies moves both cards and closes the offer', 'ok',
      ok and ${has(X, 'a')} = 0 and ${has(X, 'b')} = 1 and ${has(Y, 'b')} = 0 and ${has(Y, 'a')} = 1
      and (select status from trade_offers where id = o) = 'accepted', 'accept', ok);`)}
  delete from player_cards where player_id in ('${X}', '${Y}');
  ${kase('a swap of a duplicate takes one copy off and keeps the stars', String.raw`
    insert into player_cards (player_id, card_id, quantity, ascension) values ('${X}', a, 2, 2), ('${Y}', b, 1, 0);
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id) values ('${X}', '${Y}', a, b) returning id into o;
    ok := accept_trade(o, '${Y}');
    res := res || jsonb_build_object('case', 'a swap of a duplicate takes one copy off and keeps the stars', 'ok',
      ok and ${has(X, 'a')} = 1 and (select ascension from player_cards where player_id = '${X}' and card_id = a) = 2
      and ${has(Y, 'a')} = 1 and ${has(X, 'b')} = 1);`)}
  delete from player_cards where player_id in ('${X}', '${Y}');
  ${kase('a card gift of a LAST copy leaves the sender at once and arrives on Redeem', String.raw`
    insert into player_cards (player_id, card_id, quantity) values ('${X}', c, 1);
    ok := gift_card('${X}', '${Y}', c);
    -- The card waits in the receiver's bell (member_card_gifts_redeem.sql) until Redeem.
    ok := ok and ${has(X, 'c')} = 0 and ${has(Y, 'c')} = 0;
    ok := ok and coalesce((claim_gift('${Y}', (select id from gift_claims where player_id = '${Y}' and kind = 'card' and card_id = c and claimed_at is null order by id desc limit 1))->>'ok')::boolean, false);
    res := res || jsonb_build_object('case', 'a card gift of a LAST copy leaves the sender at once and arrives on Redeem', 'ok', ok and ${has(X, 'c')} = 0 and ${has(Y, 'c')} = 1);`)}
  delete from player_cards where player_id in ('${X}', '${Y}');
  ${kase('the sender no longer has the card: refused, nothing moves', String.raw`
    insert into player_cards (player_id, card_id, quantity) values ('${Y}', b, 1);
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id) values ('${X}', '${Y}', a, b) returning id into o;
    ok := accept_trade(o, '${Y}');
    res := res || jsonb_build_object('case', 'the sender no longer has the card: refused, nothing moves', 'ok',
      not ok and ${has(Y, 'b')} = 1 and ${has(Y, 'a')} = 0 and (select status from trade_offers where id = o) = 'pending');`)}
  delete from player_cards where player_id in ('${X}', '${Y}');
  ${kase('the receiver no longer has the card: refused, the sender keeps theirs', String.raw`
    insert into player_cards (player_id, card_id, quantity) values ('${X}', a, 1);
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id) values ('${X}', '${Y}', a, b) returning id into o;
    ok := accept_trade(o, '${Y}');
    res := res || jsonb_build_object('case', 'the receiver no longer has the card: refused, the sender keeps theirs', 'ok',
      not ok and ${has(X, 'a')} = 1 and ${has(Y, 'a')} = 0);`)}
  ${kase('only the receiver can accept', String.raw`
    insert into player_cards (player_id, card_id, quantity) values ('${X}', a, 1), ('${Y}', b, 1) on conflict do nothing;
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id) values ('${X}', '${Y}', a, b) returning id into o;
    res := res || jsonb_build_object('case', 'only the receiver can accept', 'ok', not accept_trade(o, '${X}') and ${has(X, 'a')} = 1);`)}
  raise exception 'RESULTS %', res;
end $t$;`;
console.log(process.env.BASELINE ? '== BASELINE (no migration)' : '== WITH fix_last_copy_remove.sql');
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2000)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 300)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after (live unchanged):', JSON.stringify(await q("select (select count(*) from players where id like '9999999999999999%') test_players, (select count(*) from trade_offers) offers")));
process.exit(fail ? 1 : 0);
