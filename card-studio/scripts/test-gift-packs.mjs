/**
 * gift_packs must refuse a gift the sender cannot pay (the 2026-10-01 NULL bug), and a sent
 * gift must write the ledger row that the "Generous" achievement counts (LEDGER.giftSent).
 * Rolled back:  node scripts/test-gift-packs.mjs [path/to/sql]
 * Without an argument it tests the LIVE function (the baseline).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { LEDGER } from '../../tcg-activity/src/achievements.js';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv[2] ? readFileSync(process.argv[2], 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';
const A = '999999999999999981', B = '999999999999999982';
const body = String.raw`do $t$
declare res jsonb := '[]'; g boolean; g0 boolean; g1 boolean; gm boolean; gn boolean;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the live function'}
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username, pack_balance) values ('${A}', 'tst poor', 3), ('${B}', 'tst friend', 0);
  g := gift_packs('${A}', '${B}', 50);
  res := res || jsonb_build_object('case', 'a gift bigger than the balance (3 -> 50) is refused and nothing moves', 'ok',
    g is false and (select pack_balance from players where id = '${B}') = 0 and (select pack_balance from players where id = '${A}') = 3
    and not exists (select 1 from pack_ledger where player_id in ('${A}', '${B}')));
  g := gift_packs('${A}', '${B}', 3);
  res := res || jsonb_build_object('case', 'a sent gift writes one ''${LEDGER.giftSent}'' row on the sender (the gift1 achievement counts it)', 'ok',
    (select count(*) from pack_ledger where player_id = '${A}' and reason = '${LEDGER.giftSent}') = 1);
  -- The gift waits in B's bell until Redeem (gift_claims.sql, 2026-10-01).
  perform claim_gift('${B}', (select id from gift_claims where player_id = '${B}' and claimed_at is null order by id desc limit 1));
  res := res || jsonb_build_object('case', 'a gift the sender can pay (3) moves 3 (redeemed in the bell)', 'ok',
    g is true and (select pack_balance from players where id = '${A}') = 0 and (select pack_balance from players where id = '${B}') = 3);
  g := gift_packs('${B}', '${B}', 1); g0 := gift_packs('${B}', '${A}', 0); gm := gift_packs('${B}', '${A}', -5); gn := gift_packs('${B}', '${A}', null);
  res := res || jsonb_build_object('case', 'self-gift, 0, negative and NULL amounts are refused', 'ok',
    g is false and g0 is false and gm is false and gn is false and (select pack_balance from players where id = '${B}') = 3);
  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
