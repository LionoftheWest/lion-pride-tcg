/**
 * Acceptance test for tcg-bot/supabase/trade_ledger_raid_credit.sql (2026-10-03), rolled back:
 *   node scripts/test-trade-ledger-raid-credit.mjs          (with the migration)
 *   BASELINE=1 node scripts/test-trade-ledger-raid-credit.mjs   (the live functions: must FAIL)
 * 1. an accepted trade writes one card_trades row with the right cards on each side;
 * 2. a confirmed auction with a 3-card bid writes one 'auction' row (1 card from the seller, 3 to);
 * 3. the backfill has one row for each accepted trade_offers row;
 * 4. a Raid Crasher credit (a hunt_hits row only) does not do the hunt daily; a committed card does;
 * 5. the social daily reads card_trades (a same-card swap does not count, a real trade does).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.env.BASELINE ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/trade_ledger_raid_credit.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const X = '999999999999999961', Y = '999999999999999962', S = '999999999999999963', B = '999999999999999964',
  P1 = '999999999999999965', P2 = '999999999999999966', Z = '999999999999999967';
// Each case runs in its own sub-block, so an error in one case is a FAIL, not the end of the run.
const kase = (name, sql) => String.raw`
  begin
    ${sql}
    res := res || jsonb_build_object('case', ${`'${name.replace(/'/g, "''")}'`}, 'ok', coalesce(ok, false), 'info', replace(coalesce(info, ''), '"', ''''));
  exception when others then
    if sqlerrm like 'RESULTS%' then raise; end if;
    res := res || jsonb_build_object('case', ${`'${name.replace(/'/g, "''")}'`}, 'ok', false, 'error', replace(sqlerrm, '"', ''));
  end;`;
const task = (p, k) => `(select e from jsonb_array_elements(dailies_tasks('${p}')) e where e->>'task' = '${k}')`;
const body = String.raw`do $t$
declare res jsonb := '[]'; ok boolean; info text; r jsonb; n1 bigint; n2 bigint; gd bigint; fa1 bigint; fa2 bigint; fa3 bigint;
  o bigint; aid bigint; bid bigint; h bigint; d date := (now() at time zone 'America/Denver')::date; ct record;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the live functions'}
  perform set_config('tcg.skip_welcome', 'on', true);
  select id into n1 from cards where rarity = 'normal' and tradeable order by id limit 1;
  select id into n2 from cards where rarity = 'normal' and tradeable order by id offset 1 limit 1;
  select id into gd from cards where rarity = 'gold' and not tradeable order by id limit 1;
  select id into fa1 from cards where rarity = 'full_art' order by id limit 1;
  select id into fa2 from cards where rarity = 'full_art' order by id offset 1 limit 1;
  select id into fa3 from cards where rarity = 'full_art' order by id offset 2 limit 1;
  insert into players (id, username) values ('${X}', 'tst tl x'), ('${Y}', 'tst tl y'), ('${S}', 'tst tl seller'),
    ('${B}', 'tst tl bidder'), ('${P1}', 'tst tl crasher'), ('${P2}', 'tst tl fighter'), ('${Z}', 'tst tl same');

  ${kase('3. the backfill: one offer row for each accepted trade_offers row (and each sold auction)', String.raw`
    info := (select count(*) from card_trades where kind = 'offer')::text || ' ledger offers / '
         || (select count(*) from trade_offers where status = 'accepted')::text || ' accepted offers';
    ok := (select count(*) from card_trades where kind = 'offer') = (select count(*) from trade_offers where status = 'accepted')
      and not exists (select 1 from trade_offers o where o.status = 'accepted'
                       and not exists (select 1 from card_trades c where c.offer_id = o.id and c.from_id = o.from_id and c.to_id = o.to_id
                                         and c.from_cards = array[o.offer_card_id] and c.to_cards = array[o.request_card_id]))
      and (select count(*) from card_trades where kind = 'auction') = (select count(*) from auctions where status = 'sold');`)}

  ${kase('1. an accepted trade writes one card_trades row: the sender gave the offer card, the receiver the requested card', String.raw`
    insert into player_cards (player_id, card_id, quantity) values ('${X}', n1, 1), ('${Y}', n2, 1);
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id) values ('${X}', '${Y}', n1, n2) returning id into o;
    ok := accept_trade(o, '${Y}');
    select * into ct from card_trades where offer_id = o;
    info := row_to_json(ct)::text;
    ok := ok and (select count(*) from card_trades where offer_id = o) = 1 and ct.kind = 'offer'
      and ct.from_id = '${X}' and ct.from_cards = array[n1] and ct.to_id = '${Y}' and ct.to_cards = array[n2]
      and (select quantity from player_cards where player_id = '${Y}' and card_id = n1) = 1;`)}

  ${kase('5. the social daily reads the ledger: a real trade counts, a same-card swap does not', String.raw`
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id, status, resolved_at) values ('${Z}', '${P2}', n1, n1, 'accepted', now());
    ok := (${task(X, 'social')}->>'done')::boolean and (${task(Y, 'social')}->>'done')::boolean
      and not (${task(Z, 'social')}->>'done')::boolean
      and exists (select 1 from card_trades where from_id = '${Z}');
    info := ${task(X, 'social')}::text || ' / same-card ' || ${task(Z, 'social')}::text;`)}

  ${kase('2. a confirmed auction with a 3-card bid writes one auction row: 1 card from the seller, 3 to the seller', String.raw`
    insert into player_cards (player_id, card_id, quantity) values ('${S}', gd, 1), ('${B}', fa1, 1), ('${B}', fa2, 1), ('${B}', fa3, 1);
    r := start_auction('${S}', gd, 'full_art', 2, '{}', 'and', 7); aid := (r->>'id')::bigint;
    r := place_bid('${B}', aid, array[fa1, fa2, fa3]); bid := (r->>'id')::bigint;
    r := accept_bid('${S}', bid);
    r := confirm_bid('${B}', aid);
    select * into ct from card_trades where auction_id = aid;
    info := r::text || ' ' || coalesce(row_to_json(ct)::text, 'no row');
    ok := (r->>'ok')::boolean and (select count(*) from card_trades where auction_id = aid) = 1 and ct.kind = 'auction'
      and ct.from_id = '${S}' and ct.from_cards = array[gd] and ct.to_id = '${B}'
      and cardinality(ct.to_cards) = 3 and ct.to_cards @> array[fa1, fa2, fa3];`)}

  ${kase('4. a Raid Crasher credit row alone does not do the hunt daily; a committed card does', String.raw`
    select id into h from hunts where status = 'active' order by id desc limit 1;
    if h is null then h := spawn_hunt(3); end if;
    -- The crash credit (hunt_attack credit_to): a hunt_hits row, no hunt_card_hp row.
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h, '${P1}', n1, d, 40);
    -- A real fight: hunt_commit_card puts the card in hunt_card_hp (and the attack writes hunt_hits).
    -- The row is written directly: the squad gate of hunt_commit_card depends on the hunt state.
    insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp) values (h, '${P2}', n2, d, 60, 60);
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h, '${P2}', n2, d, 25);
    info := 'credit ' || ${task(P1, 'hunt')}::text || ' / fight ' || ${task(P2, 'hunt')}::text;
    ok := not (${task(P1, 'hunt')}->>'done')::boolean and (${task(P2, 'hunt')}->>'done')::boolean;`)}

  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : `\n     ${r.error || r.info || ''}`}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
