/**
 * pull_feed_source.sql (2026-10-01): a traded or gifted card showed in Live pulls as "pulled".
 * Rolled back against the LIVE database:  node scripts/test-pull-feed-source.mjs
 * BASELINE=1 runs without the migration: the feed (newest rows) then shows the traded card.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const BASE = !!process.env.BASELINE;
const mig = BASE ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/pull_feed_source.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const X = '999999999999999981', Y = '999999999999999982', Z = '999999999999999983';
// The feed as the server reads it: the newest rows, only pulls once the column exists.
const feed = BASE ? `(select array_agg(card_id) from (select card_id from player_cards where player_id in ('${X}', '${Y}', '${Z}') order by first_obtained_at desc) f)`
  : `(select array_agg(card_id) from (select card_id from player_cards where player_id in ('${X}', '${Y}', '${Z}') and first_source = 'pull' order by first_obtained_at desc) f)`;
const body = String.raw`do $t$
declare res jsonb := '[]'; a bigint; b bigint; c bigint; d bigint; o bigint; ok boolean; f bigint[];
begin
  ${mig ? `execute $m$${mig}$m$;` : ''}
  select x[1], x[2], x[3], x[4] into a, b, c, d from (select array_agg(id order by id) x from cards where tradeable and rarity::text = 'normal') s;
  insert into players (id, username) values ('${X}', 'tst feed x'), ('${Y}', 'tst feed y'), ('${Z}', 'tst feed z');
  -- Packs: X pulls a and c, Y pulls b (add_cards_to_player is the pack path).
  perform add_cards_to_player('${X}', array[a, c]);
  perform add_cards_to_player('${Y}', array[b]);
  f := ${feed};
  res := res || jsonb_build_object('case', 'pack pulls show in the feed', 'ok', f @> array[a, b, c]);
  -- A swap: X gives a, Y gives b.
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id) values ('${X}', '${Y}', a, b) returning id into o;
  ok := accept_trade(o, '${Y}');
  f := ${feed};
  res := res || jsonb_build_object('case', 'a traded card is not a pull (Y got a, X got b)', 'ok', ok and not (coalesce(f, '{}') @> array[a]) and not (coalesce(f, '{}') @> array[b]), 'feed', f);
  -- A card gift: X gives c to Z.
  ok := gift_card('${X}', '${Z}', c);
  f := ${feed};
  res := res || jsonb_build_object('case', 'a gifted card is not a pull', 'ok', ok and not (coalesce(f, '{}') @> array[c]), 'feed', f);
  -- A later pull of a card the member already got by trade adds a copy, and the row stays a trade row.
  perform add_cards_to_player('${Y}', array[a, d]);
  res := res || jsonb_build_object('case', 'a new pull still shows; a dupe of a traded card adds a copy', 'ok',
    (${feed}) @> array[d] and (select quantity from player_cards where player_id = '${Y}' and card_id = a) = 2);
  raise exception 'RESULTS %', res;
end $t$;`;
console.log(BASE ? '== BASELINE (no migration)' : '== WITH pull_feed_source.sql');
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 300)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after (live unchanged):', JSON.stringify(await q("select (select count(*) from players where id like '99999999999999998%') test_players, (select count(*) from information_schema.columns where table_name = 'player_cards' and column_name = 'first_source') column_live")));
process.exit(fail ? 1 : 0);
