import './localdb-guard.mjs';
/**
 * The M1e dry run (SPEC ON v6 6.4 CV10 and 6.5 M-C): the REAL switch file combat_v2_switch_on.sql on the local copy (fresh from live), in one
 * request that is undone by its final RAISE. Prints AGGREGATES ONLY (no player id, no card id):
 *   the input rows and members, the progress and ledger rows, the rows per level, the bonus total, the refund points of the cap (by stat:
 *   points, rows, members; the most on one card), the level overflow bonus, the top-up and dead-points rows, the rows where the v2 value is
 *   below the v1 value (atk < v1 CP or hp < v1 HP: must be 0), the 6.7 check (combat_v2_convert_check: must be ok) and the runtime of the
 *   switch statement (must be < 30 s).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/convert-dry-run.mjs            the dry run (exit 1 when a limit fails)
 *   PLANT=topup_off ...                                                                         the CV10 mutation: a planted 2-star event
 *     attacker with attack 5 (x1 ATK below the v1 CP) and the top-up removed from the file: the "below v1" count must be 1 (exit 1)
 * The file combat_v2_convert.sql is sent first (with PLANT, the mutated text), so the dry run works before and after it is applied.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('convert-dry-run.mjs');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let mig = readFileSync(`${ROOT}tcg-bot/supabase/combat_v2_convert.sql`, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const swOn = readFileSync(`${ROOT}tcg-bot/supabase/combat_v2_switch_on.sql`, 'utf8').replace(/\r\n/g, '\n');
const PLANT_ID = '999999999999999976';
let plant = '';
if (process.env.PLANT === 'topup_off') {
  const a = '    if t > (stored->>s)::int then top := top';
  if (mig.split(a).length !== 2) throw new Error('the top-up line is not in the file once');
  mig = mig.split(a).join('    if false then top := top');
  plant = `insert into public.players (id, username) values ('${PLANT_ID}', 'm1e dry plant');
  insert into public.player_cards (player_id, card_id, quantity, ascension, stat_points)
    select '${PLANT_ID}', c.id, 1, 2, '{"attack": 5}' from public.cards c join public.subjects s on s.id = c.subject_id join public.roles ro on ro.key = s.ability_v2->>'role'
     where ro.class = 'attacker' and c.rarity = 'event' order by c.id limit 1;`;
} else if (process.env.PLANT) throw new Error(`unknown PLANT ${process.env.PLANT}`);

const block = String.raw`
do $t$
declare t0 timestamptz; secs numeric; r jsonb := '{}'; x jsonb; chk jsonb;
begin
  ${plant}
  t0 := clock_timestamp();
  execute $swf$${swOn}$swf$;
  secs := extract(epoch from clock_timestamp() - t0);
  select jsonb_build_object('input_rows', count(*), 'members', count(distinct player_id)) into x from public.combat_v2_convert_input where ref = 'm1';
  r := r || x;
  r := r || jsonb_build_object('progress_rows', (select count(*) from public.card_progress_v2), 'ledger_rows', (select count(*) from public.card_progress_v2_log),
    'rows_per_level', (select jsonb_object_agg(level, n order by level) from (select level, count(*) n from public.card_progress_v2 group by 1) q),
    'bonus_total', (select coalesce(sum(bonus_points), 0) from public.card_progress_v2),
    'refund_cap', (select jsonb_build_object('points', coalesce(sum(d_bonus), 0), 'rows', count(distinct progress_id), 'members', count(distinct player_id))
                     from public.card_progress_v2_log where reason = 'refund' and stat <> ''),
    'refund_cap_by_stat', (select jsonb_object_agg(stat, jsonb_build_object('points', p, 'rows', n, 'members', m)) from
                     (select stat, sum(d_bonus) p, count(distinct progress_id) n, count(distinct player_id) m from public.card_progress_v2_log where reason = 'refund' and stat <> '' group by 1) q),
    'refund_cap_max_one_card', (select coalesce(max(s), 0) from (select sum(d_bonus) s from public.card_progress_v2_log where reason = 'refund' and stat <> '' group by progress_id) q),
    'level_overflow', (select jsonb_build_object('points', coalesce(sum(d_bonus), 0), 'rows', count(*), 'members', count(distinct player_id))
                     from public.card_progress_v2_log where reason = 'refund' and stat = ''),
    'topup', (select jsonb_build_object('points', coalesce(sum(d_points), 0), 'rows', count(*)) from public.card_progress_v2_log where reason = 'topup'),
    'dead_points', (select jsonb_build_object('points', coalesce(sum(d_points), 0), 'rows', count(distinct progress_id), 'members', count(distinct player_id))
                     from public.card_progress_v2_log where reason = 'dead_points'));
  -- the rows where the v2 value at the converted level is below the v1 value (combat_v2_convert_expect gives both)
  select jsonb_build_object('below_v1', count(*) filter (where (e->'v2'->>'atk')::numeric < (e->'v1'->>'cp')::numeric or (e->'v2'->>'hp')::numeric < (e->'v1'->>'hp')::numeric),
                            'below_v1_cp', count(*) filter (where (e->'v2'->>'atk')::numeric < (e->'v1'->>'cp')::numeric),
                            'below_v1_hp', count(*) filter (where (e->'v2'->>'hp')::numeric < (e->'v1'->>'hp')::numeric))
    into x from (select combat_v2_convert_expect(card_id, stars, stat_points) e from public.combat_v2_convert_input where ref = 'm1') q where (e->>'row')::boolean;
  r := r || x;
  chk := combat_v2_convert_check();
  r := r || jsonb_build_object('check_ok', chk->'ok', 'check', chk - 'items' - 'switch_at', 'switch_seconds', secs);
  raise exception 'RESULT:%', r;
end $t$;`;

const out = JSON.parse(await runBlock(mig + '\n' + block));
console.log(JSON.stringify(out, null, 1));
const bad = [];
if (out.below_v1 !== 0) bad.push(`${out.below_v1} rows lose CP or HP`);
if (!(out.switch_seconds < 30)) bad.push(`the switch took ${out.switch_seconds} s`);
if (out.check_ok !== true) bad.push('combat_v2_convert_check is not ok');
console.log(bad.length ? `DRY RUN FAIL: ${bad.join('; ')}` : `DRY RUN PASS: 0 rows lose CP or HP, switch ${Number(out.switch_seconds).toFixed(2)} s, check ok`);
process.exit(bad.length ? 1 : 0);
