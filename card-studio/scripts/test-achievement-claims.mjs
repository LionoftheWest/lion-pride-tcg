/**
 * Acceptance test for tcg-bot/supabase/achievement_rewards.sql, against the LIVE database
 * with NO lasting change:  node scripts/test-achievement-claims.mjs
 * One DO block applies the migration, makes a test player, claims the same achievement
 * twice, and checks: the first claim pays the packs once, the second is refused, the
 * ledger has one 'achievement' row, a bad reward is refused, and an unknown player rolls
 * the claim back. It RAISEs the results; the exception rolls back everything.
 */
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

dotenv.config({ override: true });
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = ((process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const migration = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/achievement_rewards.sql', import.meta.url)), 'utf8');
if (migration.includes('$mig$')) throw new Error('the migration must not contain $mig$');

const body = String.raw`
do $test$
declare r1 jsonb; r2 jsonb; r3 jsonb; bal int; led int; rows int; ghost text := 'none';
begin
  execute $mig$${migration}$mig$;
  insert into players (id, username, pack_balance) values ('test_claim_1', 'test_claim_1', 0);
  r1 := claim_achievement('test_claim_1', 'own10', 2, 'Tester', 'silver');
  r2 := claim_achievement('test_claim_1', 'own10', 2, 'Tester', 'silver');
  r3 := claim_achievement('test_claim_1', 'big', 99, null, null);
  select pack_balance into bal from players where id = 'test_claim_1';
  select count(*) into led from pack_ledger where player_id = 'test_claim_1' and reason = 'achievement';
  select count(*) into rows from achievement_claims where player_id = 'test_claim_1';
  begin
    perform claim_achievement('no_such_player', 'own10', 1, null, null);
    ghost := 'claimed';
  exception when others then
    ghost := (select case when exists (select 1 from achievement_claims where player_id = 'no_such_player') then 'left a row' else 'rolled back' end);
  end;
  raise exception 'RESULT %', jsonb_build_object('r1', r1, 'r2', r2, 'r3', r3, 'balance', bal, 'ledger', led, 'claims', rows, 'ghost', ghost);
end $test$;`;

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: body }),
});
const out = await r.json();
const msg = JSON.stringify(out);
const m = msg.match(/RESULT (\{.*?\})(?:\\n|")/);
if (!m) { console.log('no result:', msg.slice(0, 600)); process.exit(1); }
const res = JSON.parse(m[1].replace(/\\"/g, '"'));
const checks = [
  ['first claim ok', res.r1?.ok === true],
  ['second claim refused', res.r2?.ok === false && res.r2?.error === 'claimed'],
  ['bad reward refused', res.r3?.ok === false && res.r3?.error === 'bad_reward'],
  ['packs paid once (2)', res.balance === 2],
  ['one ledger row', res.ledger === 1],
  ['one claim row', res.claims === 1],
  ['unknown player rolled back', res.ghost === 'rolled back'],
];
for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
console.log(JSON.stringify(res));
const bad = checks.filter((c) => !c[1]).length;
console.log(bad ? `${bad} FAILED` : 'PASS claim_achievement');
process.exit(bad ? 1 : 0);
