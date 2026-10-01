/**
 * gift_claims.sql (Nathan, 2026-10-01): every gift of packs is redeemed in the bell. Rolled
 * back against the LIVE database:  node scripts/test-gift-claims.mjs
 * The first case expects the launch-day state (the 211 x 20 direct grants); after the
 * migration it reports the conversion as already done.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/gift_claims.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const N = '527933470882660373', X = '999999999999999971';
const body = String.raw`do $t$
declare res jsonb := '[]'; g bigint; r jsonb; r2 jsonb; a jsonb;
begin
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'converted: 422 gifts waiting (211 x 2), every balance 0, no welcome/launch ledger rows, the old notes gone', 'ok',
    (select count(*) from gift_claims where claimed_at is null) = 422 and (select coalesce(sum(pack_balance), 0) from players) = 0
    and not exists (select 1 from pack_ledger where reason in ('welcome', 'launch_gift'))
    and not exists (select 1 from notifications where kind = 'pack_gift'),
    'gifts', (select count(*) from gift_claims), 'packs', (select sum(pack_balance) from players));
  res := res || jsonb_build_object('case', 'the two titles', 'ok',
    (select array_agg(title order by kind) from gift_claims where player_id = '${N}') = array['Launch Day commemoration gift', 'New Player Bonus']);
  select id into g from gift_claims where player_id = '${N}' and kind = 'new_player';
  r := claim_gift('${N}', g); r2 := claim_gift('${N}', g);
  res := res || jsonb_build_object('case', 'redeem: +10 (reason welcome); a second redeem is refused', 'ok',
    (r->>'ok')::boolean and (select pack_balance from players where id = '${N}') = 10 and r2->>'error' = 'claimed'
    and (select count(*) from pack_ledger where player_id = '${N}' and reason = 'welcome') = 1, 'r', r);
  res := res || jsonb_build_object('case', 'nobody can redeem someone else''s gift', 'ok',
    claim_gift('${X}', (select id from gift_claims where player_id = '${N}' and kind = 'launch_day'))->>'error' = 'not_found');
  insert into players (id, username) values ('${X}', 'tst new');
  res := res || jsonb_build_object('case', 'a new member gets a New Player Bonus waiting (0 packs until redeemed)', 'ok',
    (select pack_balance from players where id = '${X}') = 0 and exists (select 1 from gift_claims where player_id = '${X}' and kind = 'new_player' and amount = 10 and claimed_at is null));
  a := gift_all_members(jsonb_build_array(jsonb_build_object('id', '${X}', 'username', 'tst new'), jsonb_build_object('id', '${N}')), 10, '${N}');
  res := res || jsonb_build_object('case', 'the admin gift adds a Launch Day gift only where none exists', 'ok',
    (a->>'gifted')::int = 1 and (a->>'skipped')::int = 1 and exists (select 1 from gift_claims where player_id = '${X}' and kind = 'launch_day'), 'a', a);
  res := res || jsonb_build_object('case', 'a redeemed gift is an outside pack (not counted toward the 5)', 'ok', earned_today('${N}') = 0);
  -- A member gift: taken from the sender now, waits for the recipient.
  r := to_jsonb(gift_packs('${N}', '${X}', 3));
  res := res || jsonb_build_object('case', 'a member gift: the sender pays 3 now, the recipient has a Gift from <name> waiting (0 until redeemed)', 'ok',
    r = 'true'::jsonb and (select pack_balance from players where id = '${N}') = 7 and (select pack_balance from players where id = '${X}') = 0
    and exists (select 1 from gift_claims where player_id = '${X}' and kind = 'member_gift' and amount = 3 and title like 'Gift from %' and claimed_at is null),
    'title', (select title from gift_claims where player_id = '${X}' and kind = 'member_gift'));
  r := claim_gift('${X}', (select id from gift_claims where player_id = '${X}' and kind = 'member_gift'));
  res := res || jsonb_build_object('case', 'redeeming the member gift adds 3 (reason gift_received)', 'ok',
    (select pack_balance from players where id = '${X}') = 3 and exists (select 1 from pack_ledger where player_id = '${X}' and reason = 'gift_received' and amount = 3));
  res := res || jsonb_build_object('case', 'a member gift with too few packs is refused and nothing waits', 'ok',
    gift_packs('${X}', '${N}', 50) = false and not exists (select 1 from gift_claims where player_id = '${N}' and kind = 'member_gift'));
  -- An admin promo, an event drop to all, and the boon card's gift.
  perform give_gift('${X}', 'promo', 'Promo: Halloween', 5, 'admin', '${N}');
  perform give_gift('${X}', 'promo', 'Promo: Halloween', 5, 'admin', '${N}');
  res := res || jsonb_build_object('case', 'promos can repeat (2 waiting), each one redeemable', 'ok',
    (select count(*) from gift_claims where player_id = '${X}' and kind = 'promo' and claimed_at is null) = 2);
  res := res || jsonb_build_object('case', 'an event drop puts one gift in every member''s bell', 'ok',
    give_gift_all('promo', 'Event drop', 2, 'event', '${N}') = (select count(*) from players));
  res := res || jsonb_build_object('case', 'the gift-pack boon type is off', 'ok', (select enabled from effect_primitives where primitive = 'gift_pack') = false);
  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2000)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 500)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after (live unchanged):', JSON.stringify(await q("select (select sum(pack_balance) from players) packs, (select count(*) from information_schema.tables where table_name='gift_claims') table_live")));
