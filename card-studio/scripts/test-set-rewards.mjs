/**
 * Acceptance test for tcg-bot/supabase/d191_set_rewards.sql (D-191, D-192): the reward of a set achievement is one rule in balance,
 * and the title "Season 1 Champion" is renamed to "Origins Champion" for the members who earned or equipped it.
 * NO lasting change (one DO block; the final RAISE rolls it back), on the LOCAL copy only:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-set-rewards.mjs     must PASS (the file is applied twice)
 *   MUTATE=list | MUTATE=<name> | MUTATE=all                                               each mutation must FAIL
 * The block first puts balance and the players back to the state of the live database before the file (the old S1 title, no rule).
 * Invariants:
 *   A. claim_achievement('set:T93') for a pullable test set pays the rule once: 5 packs, "<set name> Champion", the frame 'holo:T93';
 *      one ledger row, one claim row, a second claim is refused ('claimed') and pays nothing.
 *   B. 's1' pays what it paid (5 packs, frame 'holo'), the title is "Origins Champion".
 *   C. A set that is not pullable, an unknown set id and a missing rule pay nothing ('unknown'); a row 'set:<id>' of its own in badges wins.
 *   D. An equipped and an earned "Season 1 Champion" show "Origins Champion" afterwards; another title is not changed.
 *   E. Applying the file a second time changes nothing (idempotent).
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/d191_set_rewards.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \([^)]*\)[\s\S]*?-- GUARD-END\n/, '');   // the guard checks the live text, not this block
if (/do \$g\$/.test(mig)) throw new Error('the guard is still in the migration text');
const MUT = {
  rule_not_pullable: ['and pullable;', ';'],
  rule_title: ['"title":"{name} Champion"', '"title":"{name} Set Champion"'],
  rule_frame: ['"frame":"holo:{id}"', '"frame":"holo"'],
  rule_packs: ['"packs":5,"title"', '"packs":3,"title"'],
  rule_off: ['if c is not null and s.id is not null then', 'if false then'],
  rename_players: ["update public.players set title = 'Origins Champion' where title = 'Season 1 Champion';", ''],
  rename_claims: ["update public.achievement_claims set title = 'Origins Champion' where title = 'Season 1 Champion';", ''],
  s1_title: ["'{badges,s1,title}', '\"Origins Champion\"'", "'{badges,s1,title}', '\"Season 1 Champion\"'"],
  own_row_ignored: ["if r is null and left(p_key, 4) = 'set:' then", "if left(p_key, 4) = 'set:' then"],
};
if (process.env.MUTATE === 'list') { console.log(Object.keys(MUT).join('\n')); process.exit(0); }
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(18)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 140)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.replace(m[0], m[1]);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const P = 'tst_d191_';
const body = String.raw`do $t$
declare res jsonb := '[]'; r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb; r6 jsonb; bal int; led int; cl int; row_ok boolean;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  if exists (select 1 from card_sets where id in ('T93', 'T94') or code in ('TST93', 'TST94') or season in (93, 94)) then raise exception 'the test sets exist already'; end if;
  insert into card_sets (id, name, code, pack_color, season, pullable) values ('T93', 'Test Set 93', 'TST93', '#112233', 93, true), ('T94', 'Test Set 94', 'TST94', '#223344', 94, false);
  -- The state of the live database before the file: the old S1 title, no rule. (balance_check refuses to remove a key: off for the set-up only.)
  alter table balance disable trigger balance_check;
  update balance set value = (value - 'set_complete') || jsonb_build_object('badges', jsonb_set(value->'badges', '{s1,title}', '"Season 1 Champion"')) where key = 'achievement_rewards';
  update balance set value = jsonb_set(value, '{badges,s1,frame}', '"holo"') where key = 'achievement_rewards';   -- d191_s1_origins_frame.sql came later: the state before it
  alter table balance enable trigger balance_check;
  insert into players (id, username, pack_balance, title) values ('${P}1', '${P}1', 0, null), ('${P}2', '${P}2', 0, 'Season 1 Champion'), ('${P}3', '${P}3', 0, 'Archivist');
  insert into achievement_claims (player_id, key, packs, title, frame) values ('${P}2', 's1', 5, 'Season 1 Champion', 'holo'), ('${P}3', 'own100', 3, 'Archivist', 'gold');
  r1 := claim_achievement('${P}1', 'set:T93');
  res := res || jsonb_build_object('case', 'C0 before the file: set:T93 has no reward (unknown)', 'ok', (r1->>'error') = 'unknown', 'r', r1);

  execute $m$${mig}$m$;
  execute $m$${mig}$m$;   -- E: the second application

  res := res || jsonb_build_object('case', 'D1 an equipped "Season 1 Champion" shows "Origins Champion"', 'ok',
    (select title from players where id = '${P}2') = 'Origins Champion', 'now', (select title from players where id = '${P}2'));
  res := res || jsonb_build_object('case', 'D2 an earned s1 claim shows "Origins Champion" (the equip check reads this row)', 'ok',
    (select title from achievement_claims where player_id = '${P}2' and key = 's1') = 'Origins Champion', 'now', (select title from achievement_claims where player_id = '${P}2' and key = 's1'));
  res := res || jsonb_build_object('case', 'D3 another title is not changed', 'ok',
    (select title from players where id = '${P}3') = 'Archivist' and (select title from achievement_claims where player_id = '${P}3' and key = 'own100') = 'Archivist');
  res := res || jsonb_build_object('case', 'D4 no row with the old title is left in players or achievement_claims', 'ok',
    not exists (select 1 from players where title = 'Season 1 Champion') and not exists (select 1 from achievement_claims where title = 'Season 1 Champion'));

  r1 := claim_achievement('${P}1', 'set:T93');
  r2 := claim_achievement('${P}1', 'set:T93');
  select pack_balance into bal from players where id = '${P}1';
  select count(*) into led from pack_ledger where player_id = '${P}1' and reason = 'achievement' and ref_id = 'set:T93';
  select count(*) into cl from achievement_claims where player_id = '${P}1' and key = 'set:T93';
  select (packs = 5 and title = 'Test Set 93 Champion' and frame = 'holo:T93') into row_ok from achievement_claims where player_id = '${P}1' and key = 'set:T93';
  res := res || jsonb_build_object('case', 'A1 set:T93 pays 5 packs, "Test Set 93 Champion" and the frame holo:T93', 'ok',
    coalesce((r1->>'ok')::boolean, false) and (r1->>'packs')::int = 5 and r1->>'title' = 'Test Set 93 Champion' and r1->>'frame' = 'holo:T93' and bal = 5, 'r', r1, 'bal', bal);
  res := res || jsonb_build_object('case', 'A2 the claim row has the same reward, one claim row, one ledger row', 'ok', cl = 1 and led = 1 and coalesce(row_ok, false), 'cl', cl, 'led', led);
  res := res || jsonb_build_object('case', 'A3 a second claim is refused and pays nothing', 'ok', (r2->>'ok')::boolean is false and r2->>'error' = 'claimed' and bal = 5, 'r', r2);

  r3 := claim_achievement('${P}1', 's1');
  select pack_balance into bal from players where id = '${P}1';
  res := res || jsonb_build_object('case', 'B1 s1 pays 5 packs, "Origins Champion", frame holo (only the title text changed)', 'ok',
    coalesce((r3->>'ok')::boolean, false) and (r3->>'packs')::int = 5 and r3->>'title' = 'Origins Champion' and r3->>'frame' = 'holo' and bal = 10, 'r', r3);

  r4 := claim_achievement('${P}1', 'set:T94');
  r5 := claim_achievement('${P}1', 'set:NOPE');
  res := res || jsonb_build_object('case', 'C1 a set that is not pullable and an unknown set pay nothing', 'ok',
    r4->>'error' = 'unknown' and r5->>'error' = 'unknown' and (select pack_balance from players where id = '${P}1') = 10, 'r4', r4, 'r5', r5);

  update balance set value = jsonb_set(value, '{badges,set:T93}', '{"packs":1}') where key = 'achievement_rewards';
  insert into players (id, username, pack_balance) values ('${P}4', '${P}4', 0);
  r6 := claim_achievement('${P}4', 'set:T93');
  res := res || jsonb_build_object('case', 'C2 a row set:T93 of its own in badges wins over the rule', 'ok', (r6->>'packs')::int = 1 and r6->>'title' is null, 'r', r6);
  alter table balance disable trigger balance_check;
  update balance set value = jsonb_set(value - 'set_complete', '{badges}', (value->'badges') - 'set:T93') where key = 'achievement_rewards';
  insert into players (id, username, pack_balance) values ('${P}5', '${P}5', 0);
  r6 := claim_achievement('${P}5', 'set:T93');
  res := res || jsonb_build_object('case', 'C3 no rule in balance: a set key pays nothing (fails closed)', 'ok', r6->>'error' = 'unknown', 'r', r6);

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'ERROR % %', sqlstate, sqlerrm;
end $t$;`;

const out = await q(body);
const m = JSON.stringify(out).match(/RESULTS (\[.*\])/);
if (!m) { console.log('ERROR ' + JSON.stringify(out).slice(0, 700)); process.exit(1); }
const rows = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
let bad = 0;
for (const x of rows) { if (!x.ok) bad += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok ? '' : ' ' + JSON.stringify(x).slice(0, 500)}`); }
console.log(bad ? `FAIL ${bad} of ${rows.length} cases (${rows.filter((x) => !x.ok).map((x) => x.case.split(' ')[0]).join(' ')})` : `PASS all ${rows.length} cases`);
process.exit(bad ? 1 : 0);
