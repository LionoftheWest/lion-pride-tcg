/**
 * Acceptance test for tcg-bot/supabase/ledger_reasons.sql. Rolled back (the result comes back in the exception),
 * test members only:
 *   node scripts/test-ledger-reasons.mjs          the migration file, executed inside the block
 *   node scripts/test-ledger-reasons.mjs --old    the database as it is (before the migration: FAILS)
 *   MUTATE=<name> node scripts/test-ledger-reasons.mjs   one broken mechanism: must FAIL
 * Invariants:
 *   - the allowed reasons of pack_ledger, card_ledger and shard_ledger (and of a pack gift) are the rows of
 *     ledger_reasons: a known reason inserts, an unknown reason is refused (check_violation), a reserved reason is
 *     accepted, a retired reason is refused for a new row while its old rows stay;
 *   - a new reason = one insert into ledger_reasons, then every ledger accepts it (no constraint change);
 *   - a reason in use cannot be deleted; a row of ledger_reasons needs a known ledger and a note;
 *   - the three reconciles stay ok and report reason_check from the foreign keys;
 *   - a re-run of pack_ledger_strict.sql, card_ledger.sql and shard_ledger_strict.sql keeps this state.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const file = (name) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${name}`, import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const mig = OLD ? '' : file('ledger_reasons.sql');
// The three older files, run again inside the block (their re-run must keep the new state).
const OLDFILES = ['pack_ledger_strict.sql', 'card_ledger.sql', 'shard_ledger_strict.sql'].map(file);
for (const s of [mig, ...OLDFILES]) if (/\$(m|c|o)\$/.test(s)) throw new Error('a migration file must not contain $m$, $c$ or $o$');

const PACK_LIST = "'opened', 'gift_sent', 'gift_received', 'welcome', 'launch_gift', 'raid_makeup_oct1', 'bug_reward', 'admin', 'event', 'tutorial', 'achievement', 'shop', 'hunt_reward', 'dungeon_prize', 'boon', 'earned_checkin', 'earned_streak', 'earned_hunt', 'earned_voice', 'earned_social', 'earned_dungeon', 'earned_gauntlet', 'earned_daily', 'earned_bonus'";
// Function mutations (fixtures.mjs) and SQL mutations (run inside the block after the migration).
const FN_MUT = {
  retiredok: ['public.ledger_reason_guard()', "v_status is null or v_status = 'retired'", 'v_status is null'],
  reservedrefused: ['public.ledger_reason_guard()', "v_status is null or v_status = 'retired'", "v_status is null or v_status in ('retired', 'reserved')"],
};
const SQL_MUT = {
  // The foreign keys alone: an unknown reason gets foreign_key_violation, a retired reason is accepted.
  notrigger: 'drop trigger pack_ledger_reason_guard on pack_ledger; drop trigger card_ledger_reason_guard on card_ledger; drop trigger shard_ledger_reason_guard on shard_ledger; drop trigger gift_claims_reason_guard on gift_claims;',
  // The trigger alone: a reason in use can be deleted, the reconciles lose reason_check.
  nofk: 'alter table pack_ledger drop constraint pack_ledger_reason_check; alter table card_ledger drop constraint card_ledger_reason_check; alter table shard_ledger drop constraint shard_ledger_reason_check; alter table gift_claims drop constraint gift_claims_pack_reason_check;',
  // What an unchanged pack_ledger_strict.sql would do on a re-run: the old check comes back.
  oldcheck: `alter table pack_ledger drop constraint pack_ledger_reason_check; alter table pack_ledger add constraint pack_ledger_reason_check check (reason in (${PACK_LIST}));`,
  // The gift trigger misses the pack gifts.
  giftunchecked: 'drop trigger gift_claims_reason_guard on gift_claims;',
};
const MUT = process.env.MUTATE && SQL_MUT[process.env.MUTATE] ? (console.log(`MUTATE=${process.env.MUTATE}`), SQL_MUT[process.env.MUTATE]) : mutation(FN_MUT);

const P = 'tst_lr';
const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', false, 'r', sqlerrm);
  end;`;
const done = (name, cond, extra = '') => `res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', coalesce(${cond}, false)${extra});`;
// One statement must fail with this SQLSTATE: ok := ok and (it did). A different error is a failure too.
const refused = (stmt, state = 'check_violation') =>
  `begin ${stmt}; ok := false; exception when ${state} then null; when others then ok := false; errs := errs || sqlerrm; end;`;

const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; ok boolean; n int; c bigint; g bigint; errs text[] := '{}';
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the database as it is'}
  ${MUT}
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${P}_a', 'tst a'), ('${P}_b', 'tst b');
  select min(id) into c from cards where rarity = 'normal';
${kase('the table: 24 pack, 14 card, 11 shard reasons, each with a note; the four reserved Shard reasons; RLS on, no API grant', `
    ${done('the table: 24 pack, 14 card, 11 shard reasons, each with a note; the four reserved Shard reasons; RLS on, no API grant', `
      (select count(*) from ledger_reasons where ledger = 'pack') = 24 and (select count(*) from ledger_reasons where ledger = 'card') = 14
      and (select count(*) from ledger_reasons where ledger = 'shard') = 11
      and not exists (select 1 from ledger_reasons where length(btrim(note)) < 20)
      and (select array_agg(reason order by reason) from ledger_reasons where status = 'reserved') = array['arena', 'expedition', 'minigame', 'wandering']
      and not exists (select 1 from ledger_reasons where status = 'reserved' and ledger <> 'shard')
      and (select relrowsecurity from pg_class where oid = 'public.ledger_reasons'::regclass)
      and not has_table_privilege('anon', 'public.ledger_reasons', 'select,insert,update,delete')
      and not has_table_privilege('authenticated', 'public.ledger_reasons', 'select,insert,update,delete')
      and obj_description('public.ledger_reasons'::regclass, 'pg_class') is not null
      and col_description('public.pack_ledger'::regclass, (select attnum from pg_attribute where attrelid = 'public.pack_ledger'::regclass and attname = 'ledger')) is not null`)}`)}
${kase('every reason in an existing row has a row; the four reason constraints are validated foreign keys', `
    select count(*) into n from (select ledger, reason from pack_ledger union select ledger, reason from card_ledger
      union select ledger, reason from shard_ledger union select reason_ledger, reason from gift_claims where reason_ledger is not null) u
     where not exists (select 1 from ledger_reasons x where x.ledger = u.ledger and x.reason = u.reason);
    ${done('every reason in an existing row has a row; the four reason constraints are validated foreign keys', `n = 0
      and (select count(*) from pg_constraint where contype = 'f' and convalidated and confrelid = 'public.ledger_reasons'::regclass
            and conname in ('pack_ledger_reason_check', 'card_ledger_reason_check', 'shard_ledger_reason_check', 'gift_claims_pack_reason_check')) = 4`, ", 'unseeded', n")}`)}
${kase('a known reason inserts on each ledger and on a pack gift', `
    perform grant_packs('${P}_a', 2, 'admin', null, 'test', 'ledger reasons');
    perform card_move('${P}_a', c, 1, 'event', 'test', 'ledger reasons');
    perform grant_shards('${P}_a', 50, 'admin', 'test', 'ledger reasons');
    g := give_gift('${P}_a', 'promo', 'Test', 1, 'event', null);
    ${done('a known reason inserts on each ledger and on a pack gift', `g is not null
      and (select ledger from pack_ledger where player_id = '${P}_a' and reason = 'admin') = 'pack'
      and (select ledger from card_ledger where player_id = '${P}_a' and reason = 'event') = 'card'
      and (select ledger from shard_ledger where player_id = '${P}_a' and reason = 'admin') = 'shard'
      and (select reason_ledger from gift_claims where id = g) = 'pack'`)}`)}
${kase('an unknown reason is refused on each ledger and on a pack gift (check_violation); a card gift keeps no pack reason', `
    ok := true;
    ${refused(`perform grant_packs('${P}_a', 1, 'opend', null, 'test', 'x')`)}
    ${refused(`insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id) values ('${P}_a', 1, 'admn', 'test', 'x')`)}
    ${refused(`perform card_move('${P}_a', c, 1, 'trde', 'test', 'x')`)}
    ${refused(`perform grant_shards('${P}_a', 5, 'arenna', 'test', 'x')`)}
    ${refused(`perform give_gift('${P}_a', 'promo', 'Test', 1, 'evnt', null)`)}
    ${refused(`update pack_ledger set reason = 'evnt' where player_id = '${P}_a' and reason = 'admin'`)}
    ok := ok and give_card_gift('${P}_b', c, 'Test card', 'any_card_reason');
    ${done('an unknown reason is refused on each ledger and on a pack gift (check_violation); a card gift keeps no pack reason', `ok and (select reason_ledger from gift_claims where player_id = '${P}_b' and reason = 'any_card_reason') is null and exists (select 1 from gift_claims where player_id = '${P}_b' and reason = 'any_card_reason')`, ", 'errors', to_jsonb(errs)")}`)}
${kase('the four reserved reasons are accepted on the Shard ledger (not on the pack ledger)', `
    perform grant_shards('${P}_b', 1, x, 'test', 'reserved reason') from unnest(array['expedition', 'arena', 'wandering', 'minigame']) x;
    ok := true;
    ${refused(`perform grant_packs('${P}_b', 1, 'arena', null, 'test', 'x')`)}
    ${done('the four reserved reasons are accepted on the Shard ledger (not on the pack ledger)', `ok and (select count(distinct reason) from shard_ledger where player_id = '${P}_b') = 4`, ", 'errors', to_jsonb(errs)")}`)}
${kase('a retired reason is refused for a new row (card opening_balance; a pack reason retired now, also as a gift); its old rows stay', `
    ok := (select status from ledger_reasons where ledger = 'card' and reason = 'opening_balance') = 'retired';
    ${refused(`perform card_move('${P}_a', c, 1, 'opening_balance', 'opening', 'x')`)}
    perform grant_packs('${P}_a', 1, 'bug_reward', null, 'test', 'before retired');
    update ledger_reasons set status = 'retired' where ledger = 'pack' and reason = 'bug_reward';
    ${refused(`perform grant_packs('${P}_a', 1, 'bug_reward', null, 'test', 'after retired')`)}
    ${refused(`perform give_gift('${P}_a', 'promo', 'Test', 1, 'bug_reward', null)`)}
    update pack_ledger set ref_id = 'old row edited' where player_id = '${P}_a' and reason = 'bug_reward';
    ${done('a retired reason is refused for a new row (card opening_balance; a pack reason retired now, also as a gift); its old rows stay', `ok
      and (select count(*) from pack_ledger where player_id = '${P}_a' and reason = 'bug_reward' and ref_id = 'old row edited') = 1`, ", 'errors', to_jsonb(errs)")}`)}
${kase('a new reason: one insert into ledger_reasons, then each ledger and a pack gift accept it', `
    insert into ledger_reasons (ledger, reason, note) values
      ('pack', 'tst_new_event', 'Test: a new event.'), ('card', 'tst_new_event', 'Test: a new event.'), ('shard', 'tst_new_event', 'Test: a new event.');
    perform grant_packs('${P}_b', 1, 'tst_new_event', null, 'test', 'new reason');
    perform card_move('${P}_b', c, 1, 'tst_new_event', 'test', 'new reason');
    perform grant_shards('${P}_b', 5, 'tst_new_event', 'test', 'new reason');
    g := give_gift('${P}_b', 'promo', 'Test', 1, 'tst_new_event', null);
    ${done('a new reason: one insert into ledger_reasons, then each ledger and a pack gift accept it', `g is not null
      and (select count(*) from pack_ledger where player_id = '${P}_b' and reason = 'tst_new_event') = 1
      and (select count(*) from card_ledger where player_id = '${P}_b' and reason = 'tst_new_event') = 1
      and (select count(*) from shard_ledger where player_id = '${P}_b' and reason = 'tst_new_event') = 1
      and (select added_on from ledger_reasons where ledger = 'pack' and reason = 'tst_new_event') = current_date
      and (select status from ledger_reasons where ledger = 'pack' and reason = 'tst_new_event') = 'active'`)}`)}
${kase('a reason in use cannot be deleted or renamed; a row needs a known ledger and a note; the ledger column cannot be set', `
    perform grant_shards('${P}_b', 5, 'admin', 'test', 'in use');
    ok := true;
    ${refused(`delete from ledger_reasons where ledger = 'shard' and reason = 'admin'`, 'foreign_key_violation')}
    ${refused(`update ledger_reasons set reason = 'admin2' where ledger = 'pack' and reason = 'admin'`, 'foreign_key_violation')}
    ${refused(`insert into ledger_reasons (ledger, reason, note) values ('gem', 'x', 'A note.')`)}
    ${refused(`insert into ledger_reasons (ledger, reason, note) values ('shard', 'tst_no_note', ' ')`)}
    ${refused(`insert into ledger_reasons (ledger, reason, note, status) values ('shard', 'tst_bad_status', 'A note.', 'paused')`)}
    ${refused(`insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, ledger) values ('${P}_a', 1, 'admin', 'test', 'x', 'card')`, 'generated_always')}
    ${done('a reason in use cannot be deleted or renamed; a row needs a known ledger and a note; the ledger column cannot be set', 'ok', ", 'errors', to_jsonb(errs)")}`)}
${kase('the three reconciles stay ok and report reason_check = true (the foreign keys)', `
    r := jsonb_build_object('pack', pack_ledger_reconcile() - 'mismatched_rows', 'card', card_ledger_reconcile() - 'mismatched_rows',
                            'shard', shard_ledger_reconcile() - 'mismatched_rows');
    ${done('the three reconciles stay ok and report reason_check = true (the foreign keys)', `(r->'pack'->>'ok')::boolean and (r->'card'->>'ok')::boolean and (r->'shard'->>'ok')::boolean
      and (r->'pack'->>'reason_check')::boolean and (r->'card'->>'reason_check')::boolean and (r->'shard'->>'reason_check')::boolean`, ", 'r', r")}`)}
${kase('a re-run of pack_ledger_strict.sql, card_ledger.sql and shard_ledger_strict.sql keeps the new state', `
    execute $o$${OLDFILES[0]}$o$;
    execute $o$${OLDFILES[1]}$o$;
    execute $o$${OLDFILES[2]}$o$;
    ok := true;
    ${refused(`perform grant_packs('${P}_a', 1, 'opend', null, 'test', 'x')`)}
    ${done('a re-run of pack_ledger_strict.sql, card_ledger.sql and shard_ledger_strict.sql keeps the new state', `ok
      and (select count(*) from pg_constraint where contype = 'f' and confrelid = 'public.ledger_reasons'::regclass
            and conname in ('pack_ledger_reason_check', 'card_ledger_reason_check', 'shard_ledger_reason_check', 'gift_claims_pack_reason_check')) = 4
      and not exists (select 1 from pg_constraint where contype = 'c' and conname in ('pack_ledger_reason_check', 'card_ledger_reason_check', 'shard_ledger_reason_check', 'gift_claims_pack_reason_check'))
      and (select count(*) from pg_trigger where tgname in ('pack_ledger_reason_guard', 'card_ledger_reason_guard', 'shard_ledger_reason_guard', 'gift_claims_reason_guard')) = 4
      and col_description('public.pack_ledger'::regclass, (select attnum from pg_attribute where attrelid = 'public.pack_ledger'::regclass and attname = 'reason')) like '%ledger_reasons%'
      and (pack_ledger_reconcile()->>'ok')::boolean and (card_ledger_reconcile()->>'ok')::boolean and (shard_ledger_reconcile()->>'ok')::boolean
      and exists (select 1 from ledger_reasons where ledger = 'pack' and reason = 'tst_new_event')`, ", 'errors', to_jsonb(errs)")}`)}
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
