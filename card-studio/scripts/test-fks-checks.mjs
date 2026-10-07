/**
 * Acceptance test for tcg-bot/supabase/fks_checks.sql. Rolled back (the result comes back in the exception),
 * test members only:
 *   node scripts/test-fks-checks.mjs          the migration file, executed inside the block
 *   node scripts/test-fks-checks.mjs --old    the database as it is (before the migration: FAILS)
 *   MUTATE=<name> node scripts/test-fks-checks.mjs   one broken constraint: must FAIL
 * Invariants:
 *   - each new foreign key refuses a row that names a member, card, Hunt or bid that does not exist;
 *   - each new check refuses a value outside its list or a negative (or zero) amount, and the error names
 *     THAT constraint (not an other one);
 *   - a valid row of the same shape is still accepted (no constraint is too strict);
 *   - deleting a Hunt removes its hunt_events, hunt_combat_log and hunt_combat_state rows (cascade);
 *   - deleting a member who has Hunt history is refused (NO ACTION), the history stays;
 *   - every new constraint exists and is VALIDATED, and hunt_events has its hunt_id index.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/fks_checks.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$') || mig.includes('$c$') || mig.includes('$s$')) throw new Error('the migration must not contain $m$, $c$ or $s$');

// Constraint mutations: dropped or weakened inside the block, after the migration.
const SQL_MUT = {
  nofk: 'alter table hunt_hits drop constraint hunt_hits_player_id_fkey;',
  nocardfk: 'alter table hunt_combat_log drop constraint hunt_combat_log_card_id_fkey;',
  nocheck: 'alter table trade_offers drop constraint trade_offers_status_check;',
  widecheck: "alter table hunts drop constraint hunts_status_check; alter table hunts add constraint hunts_status_check check (status in ('active', 'defeated', 'expired', 'bogus'));",
  nocascade: 'alter table hunt_events drop constraint hunt_events_hunt_id_fkey; alter table hunt_events add constraint hunt_events_hunt_id_fkey foreign key (hunt_id) references hunts(id);',
  noamount: 'alter table shard_ledger drop constraint shard_ledger_amount_check;',
};
if (process.env.MUTATE && !SQL_MUT[process.env.MUTATE]) throw new Error(`unknown mutation ${process.env.MUTATE}; known: ${Object.keys(SQL_MUT).join(' ')}`);
const MUT = process.env.MUTATE ? (console.log(`MUTATE=${process.env.MUTATE}`), SQL_MUT[process.env.MUTATE]) : '';

const P = 'tst_fkc';
const A = `'${P}_a'`, B = `'${P}_b'`, NOBODY = `'${P}_nobody'`;
const C = '(select min(id) from cards)', NOCARD = '-1';
const S = `(select subject_id from cards where id = ${C})`;
const H = `(select id from hunts where name = '${P} hunt')`;
const AU = `(select id from auctions where seller_id = ${A})`;
const PRIM = '(select min(primitive) from effect_primitives)';
const PR = "(select min(reason) from ledger_reasons where ledger = 'pack' and status = 'active')";
const SR = "(select min(reason) from ledger_reasons where ledger = 'shard' and status = 'active')";
const D = "'2026-01-05'";

// [constraint, the bad statement (must be refused BY THIS constraint), the same shape with a valid value (must pass)]
const ROWS = [
  // 1. foreign keys
  ['card_trades_from_id_fkey', `insert into card_trades (kind, from_id, to_id, from_cards, to_cards) values ('offer', ${NOBODY}, ${A}, '{}', '{}')`,
    `insert into card_trades (kind, from_id, to_id, from_cards, to_cards) values ('offer', ${B}, ${A}, '{}', '{}')`],
  ['card_trades_to_id_fkey', `insert into card_trades (kind, from_id, to_id, from_cards, to_cards) values ('offer', ${A}, ${NOBODY}, '{}', '{}')`,
    `insert into card_trades (kind, from_id, to_id, from_cards, to_cards) values ('offer', ${A}, ${B}, '{}', '{}')`],
  ['auctions_accepted_bid_id_fkey', `update auctions set accepted_bid_id = -1 where id = ${AU}`,
    `update auctions set accepted_bid_id = (select id from auction_bids where auction_id = ${AU}) where id = ${AU}`],
  ['hunt_card_hp_player_id_fkey', `insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp) values (${H}, ${NOBODY}, ${C}, ${D}, 10, 10)`,
    `insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp) values (${H}, ${A}, ${C}, ${D}, 10, 10)`],
  ['hunt_card_hp_card_id_fkey', `insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp) values (${H}, ${A}, ${NOCARD}, ${D}, 10, 10)`,
    `insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp) values (${H}, ${B}, ${C}, ${D}, 10, 10)`],
  ['hunt_combat_log_hunt_id_fkey', `insert into hunt_combat_log (hunt_id, player_id, card_id) values (-1, ${A}, ${C})`,
    `insert into hunt_combat_log (hunt_id, player_id, card_id) values (${H}, ${A}, ${C})`],
  ['hunt_combat_log_player_id_fkey', `insert into hunt_combat_log (hunt_id, player_id, card_id) values (${H}, ${NOBODY}, ${C})`,
    `insert into hunt_combat_log (hunt_id, player_id, card_id) values (${H}, ${B}, ${C})`],
  ['hunt_combat_log_card_id_fkey', `insert into hunt_combat_log (hunt_id, player_id, card_id) values (${H}, ${A}, ${NOCARD})`,
    `insert into hunt_combat_log (hunt_id, player_id, card_id) values (${H}, ${A}, ${C})`],
  ['hunt_combat_state_hunt_id_fkey', `insert into hunt_combat_state (hunt_id, player_id, hit_date) values (-1, ${A}, ${D})`,
    `insert into hunt_combat_state (hunt_id, player_id, hit_date) values (${H}, ${A}, ${D})`],
  ['hunt_combat_state_player_id_fkey', `insert into hunt_combat_state (hunt_id, player_id, hit_date) values (${H}, ${NOBODY}, ${D})`,
    `insert into hunt_combat_state (hunt_id, player_id, hit_date) values (${H}, ${B}, ${D})`],
  ['hunt_events_hunt_id_fkey', `insert into hunt_events (hunt_id, kind) values (-1, 'nudge')`, `insert into hunt_events (hunt_id, kind) values (${H}, 'nudge')`],
  ['hunt_hits_player_id_fkey', `insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (${H}, ${NOBODY}, ${C}, ${D}, 5)`,
    `insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (${H}, ${A}, ${C}, ${D}, 5)`],
  ['hunt_hits_card_id_fkey', `insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (${H}, ${A}, ${NOCARD}, ${D}, 5)`,
    `insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (${H}, ${B}, ${C}, ${D}, 5)`],
  ['shop_purchases_card_id_fkey', `insert into shop_purchases (player_id, day, kind, qty, price, card_id) values (${A}, ${D}, 'card', 1, 100, ${NOCARD})`,
    `insert into shop_purchases (player_id, day, kind, qty, price, card_id) values (${A}, ${D}, 'card', 1, 100, ${C})`],
  ['wish_grants_card_id_fkey', `insert into wish_grants (giver_id, receiver_id, card_id, source, ref_id) values (${A}, ${B}, ${NOCARD}, 'trade', 0)`,
    `insert into wish_grants (giver_id, receiver_id, card_id, source, ref_id) values (${A}, ${B}, ${C}, 'trade', 0)`],
  ['combat_actions_target_card_fkey', `insert into combat_actions (mode, ref_id, player_id, kind, game_day, target_card) values ('hunt', ${H}, ${A}, 'support', ${D}, ${NOCARD})`,
    `insert into combat_actions (mode, ref_id, player_id, kind, game_day, target_card) values ('hunt', ${H}, ${A}, 'support', ${D}, ${C})`],
  // 2. status / kind checks
  ['hunts_status_check', `update hunts set status = 'bogus' where id = ${H}`, `update hunts set status = 'expired' where id = ${H}`],
  ['hunts_tier_check', `update hunts set tier = 'Epic' where id = ${H}`, `update hunts set tier = 'Mythic' where id = ${H}`],
  ['trade_offers_status_check', `update trade_offers set status = 'bogus' where from_id = ${A}`, `update trade_offers set status = 'cancelled' where from_id = ${A}`],
  ['hunt_combat_log_outcome_check', `insert into hunt_combat_log (hunt_id, player_id, card_id, outcome) values (${H}, ${A}, ${C}, 'bogus')`,
    `insert into hunt_combat_log (hunt_id, player_id, card_id, outcome) values (${H}, ${A}, ${C}, 'blocked')`],
  ['hunt_events_kind_check', `insert into hunt_events (hunt_id, kind) values (${H}, 'bogus')`, `insert into hunt_events (hunt_id, kind) values (${H}, 'player_done')`],
  ['card_plays_kind_check', `insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome) values (${A}, ${B}, ${B}, ${C}, ${S}, ${PRIM}, 'bogus', 'normal', 'applied')`,
    `insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome) values (${A}, ${B}, ${B}, ${C}, ${S}, ${PRIM}, 'prank', 'normal', 'applied')`],
  ['card_plays_rarity_check', `insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome) values (${A}, ${B}, ${B}, ${C}, ${S}, ${PRIM}, 'boon', 'bogus', 'applied')`,
    `insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome) values (${A}, ${B}, ${B}, ${C}, ${S}, ${PRIM}, 'boon', 'event', 'applied')`],
  ['shop_stock_rarity_check', `insert into shop_stock (day, slot, card_id, rarity, price) values ('1999-01-01', 1, ${C}, 'bogus', 100)`,
    `insert into shop_stock (day, slot, card_id, rarity, price) values ('1999-01-01', 1, ${C}, 'gold', 100)`],
  ['auctions_min_rarity_check', `update auctions set min_rarity = 'bogus' where id = ${AU}`, `update auctions set min_rarity = 'secret_rare' where id = ${AU}`],
  ['dungeon_runs_ended_by_check', `insert into dungeon_runs (player_id, day, squad, state, status, ended_by) values (${A}, ${D}, '{}', '{}', 'over', 'bogus')`,
    `insert into dungeon_runs (player_id, day, squad, state, status, ended_by) values (${A}, ${D}, '{}', '{}', 'over', 'retreat')`],
  ['balance_log_op_check', `insert into balance_log (key, op, changed_by) values ('${P}', 'delete', 'test')`, `insert into balance_log (key, op, changed_by) values ('${P}', 'update', 'test')`],
  ['daily_claims_task_check', `insert into daily_claims (player_id, day, task, amount) values (${A}, ${D}, 'bogus', 1)`,
    `insert into daily_claims (player_id, day, task, amount) values (${A}, ${D}, 'chat_bonus', 1)`],
  ['subjects_type_check', `update subjects set type = 'Bogus' where id = ${S}`, `update subjects set type = 'Moment' where id = ${S}`],
  // 3. amount checks
  ['pack_ledger_amount_check', `insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id) values (${A}, 0, ${PR}, 'test', 'x')`,
    `insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id) values (${A}, -1, ${PR}, 'test', 'x')`],
  ['shard_ledger_amount_check', `insert into shard_ledger (player_id, amount, reason, ref_kind, ref_id) values (${A}, 0, ${SR}, 'test', 'x')`,
    `insert into shard_ledger (player_id, amount, reason, ref_kind, ref_id) values (${A}, 1, ${SR}, 'test', 'x')`],
  ['shop_purchases_qty_check', `insert into shop_purchases (player_id, day, kind, qty, price) values (${A}, ${D}, 'pack', 0, 100)`,
    `insert into shop_purchases (player_id, day, kind, qty, price) values (${A}, ${D}, 'pack', 1, 100)`],
  ['shop_purchases_price_check', `insert into shop_purchases (player_id, day, kind, qty, price) values (${A}, ${D}, 'pack', 1, -1)`,
    `insert into shop_purchases (player_id, day, kind, qty, price) values (${A}, ${D}, 'stat_reset', 1, 0)`],
  ['daily_claims_amount_check', `insert into daily_claims (player_id, day, task, amount) values (${B}, ${D}, 'checkin', -1)`,
    `insert into daily_claims (player_id, day, task, amount) values (${B}, ${D}, 'checkin', 0)`],
  ['voice_minutes_minutes_check', `insert into voice_minutes (player_id, day, minutes) values (${A}, ${D}, -1)`, `insert into voice_minutes (player_id, day, minutes) values (${A}, ${D}, 0)`],
  ['daily_activity_message_count_check', `insert into daily_activity (player_id, activity_date, message_count) values (${A}, ${D}, -1)`,
    `insert into daily_activity (player_id, activity_date, message_count) values (${A}, ${D}, 0)`],
  ['achievement_claims_amount_check', `insert into achievement_claims (player_id, key, packs) values (${A}, '${P}_k', -1)`,
    `insert into achievement_claims (player_id, key, packs, shards) values (${A}, '${P}_k', 0, 0)`],
  ['player_cards_ascension_check', `update player_cards set ascension = -1 where player_id = ${A}`, `update player_cards set ascension = 0 where player_id = ${A}`],
  ['dungeon_runs_shards_check', `insert into dungeon_runs (player_id, day, squad, state, status, shards) values (${A}, '2026-01-06', '{}', '{}', 'over', -1)`,
    `insert into dungeon_runs (player_id, day, squad, state, status, shards) values (${A}, '2026-01-06', '{}', '{}', 'over', 0)`],
  ['hunt_hits_damage_check', `insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (${H}, ${A}, ${C}, '2026-01-06', -1)`,
    `insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (${H}, ${A}, ${C}, '2026-01-06', 0)`],
  ['hunt_combat_log_damage_check', `insert into hunt_combat_log (hunt_id, player_id, card_id, damage, counter_dmg) values (${H}, ${A}, ${C}, 0, -1)`,
    `insert into hunt_combat_log (hunt_id, player_id, card_id, damage, counter_dmg) values (${H}, ${A}, ${C}, 0, 0)`],
  ['hunts_hp_check', `update hunts set hp_remaining = -1 where id = ${H}`, `update hunts set hp_remaining = 0 where id = ${H}`],
  ['hunt_card_hp_hp_check', `insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, shield) values (${H}, ${A}, ${C}, '2026-01-06', 0, 10, -1)`,
    `insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, shield) values (${H}, ${A}, ${C}, '2026-01-06', 0, 10, 0)`],
];
for (const r of ROWS) for (const s of r) if (s.includes('$s$')) throw new Error(`a statement contains $s$: ${r[0]}`);
const lit = (s) => `$s$${s}$s$`;

const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', ${`$c$${name}$c$`}, 'ok', false, 'r', sqlerrm);
  end;`;
const done = (name, cond, extra = '') => `res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', coalesce(${cond}, false)${extra});`;

const refusedCases = ROWS.map(([name, bad]) => kase(`refused by ${name}`, `
    r := pg_temp.tst_refused(${lit(bad)});
    ${done(`refused by ${name}`, `r->>'constraint' = '${name}'`, ", 'r', r")}`)).join('');
const goodAll = ROWS.map(([name, , good]) => `
    begin execute ${lit(good)}; exception when others then bad := bad || jsonb_build_object('c', '${name}', 'e', sqlerrm); end;`).join('');
const names = ROWS.map(([n]) => `'${n}'`).join(', ');

const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; ok boolean; n int; bad jsonb := '[]'; h2 bigint;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the database as it is'}
  ${MUT}
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values (${A}, 'tst a'), (${B}, 'tst b');
  insert into player_cards (player_id, card_id, quantity) values (${A}, ${C}, 1);
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, closes_at, status)
    values ('${P} hunt', 'Normal', '[]', 1000, 1000, now() + interval '1 day', 'active');
  insert into auctions (seller_id, card_id, ends_at) values (${A}, ${C}, now() + interval '1 day');
  insert into auction_bids (auction_id, bidder_id, cards) values (${AU}, ${B}, array[${C}]);
  insert into trade_offers (from_id, to_id, offer_card_id) values (${A}, ${B}, ${C});
  -- Runs one statement and undoes it. Returns the constraint that refused it, or 'accepted'.
  create function pg_temp.tst_refused(s text) returns jsonb language plpgsql as $f$
  declare c text; m text;
  begin
    begin
      execute s;
      raise exception 'TST_ACCEPTED';
    exception when others then
      get stacked diagnostics c = constraint_name, m = message_text;
      if m = 'TST_ACCEPTED' then return jsonb_build_object('constraint', 'accepted'); end if;
      return jsonb_build_object('constraint', c, 'error', m);
    end;
  end $f$;
${refusedCases}
${kase('a valid row of the same shape is accepted by every new constraint', `
${goodAll}
    ${done('a valid row of the same shape is accepted by every new constraint', "jsonb_array_length(bad) = 0", ", 'bad', bad")}`)}
${kase('deleting a Hunt removes its hunt_events, hunt_combat_log and hunt_combat_state rows (cascade)', `
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, closes_at, status)
      values ('${P} hunt 2', 'Heroic', '[]', 1000, 1000, now() + interval '1 day', 'active') returning id into h2;
    insert into hunt_events (hunt_id, kind) values (h2, 'spawn');
    insert into hunt_combat_log (hunt_id, player_id, card_id, outcome) values (h2, ${A}, ${C}, 'hit');
    insert into hunt_combat_state (hunt_id, player_id, hit_date) values (h2, ${A}, ${D});
    delete from hunts where id = h2;
    select (select count(*) from hunt_events where hunt_id = h2) + (select count(*) from hunt_combat_log where hunt_id = h2)
         + (select count(*) from hunt_combat_state where hunt_id = h2) into n;
    ${done('deleting a Hunt removes its hunt_events, hunt_combat_log and hunt_combat_state rows (cascade)', 'n = 0', ", 'left', n")}`)}
${kase('deleting a member with Hunt history is refused, and the history stays', `
    insert into players (id, username) values ('${P}_c', 'tst c');
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (${H}, '${P}_c', ${C}, '2026-01-07', 7);
    r := pg_temp.tst_refused($s$delete from players where id = '${P}_c'$s$);
    ${done('deleting a member with Hunt history is refused, and the history stays', `r->>'constraint' = 'hunt_hits_player_id_fkey'
      and exists (select 1 from hunt_hits where player_id = '${P}_c')`, ", 'r', r")}`)}
${kase('every new constraint exists and is validated, and hunt_events has its hunt_id index', `
    select count(*) into n from pg_constraint where connamespace = 'public'::regnamespace and convalidated and conname in (${names});
    ok := n = ${ROWS.length} and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'hunt_events_hunt_id_idx');
    ${done('every new constraint exists and is validated, and hunt_events has its hunt_id index', 'ok', ", 'validated', n, 'want', " + ROWS.length)}`)}
${kase('the migration runs a second time with no change', `
    ${mig ? 'execute $m$' + mig + '$m$;' : "raise exception 'no migration (--old)';"}
    select count(*) into n from pg_constraint where connamespace = 'public'::regnamespace and conname in (${names});
    ${done('the migration runs a second time with no change', `n = ${ROWS.length}`, ", 'n', n")}`)}
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
