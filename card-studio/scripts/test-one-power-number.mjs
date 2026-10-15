import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/f3_one_power_number.sql (F-3 acceptance test 7: "The power on the roster equals the power in a fight for
 * the same card"), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-one-power-number.mjs     must PASS (the file is applied twice: idempotent)
 *   MUTATE=<name> ...                                                                           must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                              runs every mutation, one line each
 * Invariant: for every owned copy, the power that the roster shows (card_powers.power, owned_card_power, the ascend result) = the cp that the fights
 * read (card_combat cp; the Dungeon through dungeon_card, the Hunt through hunt_pick_pool), with stars AND stat points. Every total (roster_stats,
 * roster_snapshot, roster_top_players, deployable_power, collection power) is the sum of those numbers, computed here again from card_combat.
 *   1. Sample copies: every rarity x stars 0..5 x point sets (Attack only, Vitality only, mixed, none) x the cp_mod of the card.
 *   2. card_powers.power = card_combat cp = dungeon_card cp = hunt_pick_pool cp = owned_card_power.power = card_power_pts, for each sample copy,
 *      and the points are in it (at least 10 copies show more than the old card_power).
 *   3. The totals: roster_stats, roster_snapshot, roster_top_players (total, best card), deployable_power(3), collection_power_all and
 *      my_collection_power (a complete set gets the set bonus) against an independent sum over card_combat.
 *   4. ascend_card: the power of the answer = the power card_powers shows after it, with the points of the copy.
 *   5. card_power (3 arguments) is still the base number with no points.
 *   6. The flag OFF (stat_points.enabled = false): the power of every copy is the old number (card_power) and the collection power the old formula.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/f3_one_power_number.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const MUT = {
  cardpowers_old: ["x.cc || jsonb_build_object('power', (x.cc->>'cp')::int) v", "x.cc || jsonb_build_object('power', round(card_cp_exact(k.rarity, k.ascension, k.cp_mod, b.v->'rarity_cp', b.v->'stars'))::int) v"],
  ascend_nopts: ['card_power_pts(v_rarity, v_asc + 1, v_mod, v_pts)', "card_power_pts(v_rarity, v_asc + 1, v_mod, '{}'::jsonb)"],
  ascend_sameasc: ['card_power_pts(v_rarity, v_asc + 1, v_mod, v_pts)', 'card_power_pts(v_rarity, v_asc, v_mod, v_pts)'],
  owned_nopts: ['card_power_pts(d.rarity, d.ascension, d.cp_mod, d.stat_points, b.v) cp', "card_power_pts(d.rarity, d.ascension, d.cp_mod, '{}'::jsonb, b.v) cp"],
  owned_nostars: ['card_power_pts(d.rarity, d.ascension, d.cp_mod, d.stat_points, b.v) cp', 'card_power_pts(d.rarity, 0, d.cp_mod, d.stat_points, b.v) cp'],
  owned_join: ['and k.stat_points = o.stat_points;', 'and (k.stat_points = o.stat_points or true);'],
  pts_fn: ['select card_power_pts(p_rarity, p_asc, p_mod, p_pts, card_balance());', "select card_power_pts(p_rarity, p_asc, p_mod, '{}'::jsonb, card_balance());"],
  pts_fn5: ["select (card_combat(p_rarity, p_asc, p_mod, p_pts, p_b)->>'cp')::int;", "select round(card_cp_exact(p_rarity, p_asc, p_mod, p_b->'rarity_cp', p_b->'stars'))::int;"],
  deploy_type: ["where o.type in ('Character', 'Creature')", 'where true'],
  deploy_order: ['order by o.power desc) as rn', 'order by o.power asc) as rn'],
  stats_total: ['coalesce(sum(power), 0)::bigint as total_power', 'coalesce(sum(power) + 1, 0)::bigint as total_power'],
  snap_total: ['select coalesce(sum(o.power), 0)::bigint, count(*)::int', 'select coalesce(sum(o.power) + 1, 0)::bigint, count(*)::int'],
  top_total: ['sum(o.power)::bigint,', 'sum(o.power + 1)::bigint,'],
  top_best: ['max(o.power)\n  from owned_card_power() o', 'min(o.power)\n  from owned_card_power() o'],
  coll_sum: ['select o.player_id, o.subject_id, sum(o.power) base_cp', 'select o.player_id, o.subject_id, sum(o.power + 1) base_cp'],
  coll_bonus: ['select ps.player_id, sum(case when ps.ov = st.tv', 'select ps.player_id, sum(case when false'],
  my_sum: ['select o.subject_id, sum(o.power) base_cp', 'select o.subject_id, sum(o.power + 1) base_cp'],
  my_bonus: ['select coalesce(sum(case when ps.ov = st.tv', 'select coalesce(sum(case when false'],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(15)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.split(m[0]).join(m[1]);
}
if (['$m$', '$t$'].some((x) => mig.includes(x))) throw new Error('the migration must not contain $m$ or $t$');

const body = String.raw`do $t$
declare
  res jsonb := '[]'; bad int; n int; flag boolean; r record; x jsonb; h bigint; pool jsonb; ex int; snap bigint; v_att int; v_more int; asc_cost int; ar jsonb; cid bigint;
  pts_sets jsonb[] := array['{}'::jsonb, '{"attack":3}', '{"vitality":4}', '{"attack":2,"vitality":3,"precision":1,"potency":2,"haste":2}', '{"attack":15}', '{"potency":5}'];
begin
  execute $m$${mig}$m$;
  execute $m$${mig}$m$;   -- two times: idempotent
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('tst_opn', 'tst opn'), ('tst_opn2', 'tst opn2'), ('tst_opn3', 'tst opn3');

  -- Sample copies of tst_opn: 12 cards of each rarity, the stars and the point sets in turn (card id order).
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
    select 'tst_opn', y.id, 1, (y.rn % 6)::int, pts_sets[1 + ((y.rn / 2) % 6)::int]
      from (select c.id, row_number() over (order by c.rarity, c.id) rn from cards c join subjects s on s.id = c.subject_id
             where c.id in (select id from (select id, row_number() over (partition by rarity order by id) k from cards) z where k <= 12)) y;
  -- tst_opn3 owns every card of one subject that has several cards (the set bonus), with Attack points on each.
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
    select 'tst_opn3', c.id, 1, 1, '{"attack":3}' from cards c
     where c.subject_id = (select subject_id from cards group by subject_id having count(*) > 1 order by subject_id limit 1);

  for flag in select unnest(array[true, false]) loop
    update balance set value = value || jsonb_build_object('enabled', flag) where key = 'stat_points';

    -- 2. one number for each sample copy
    n := 0; bad := 0; v_more := 0;
    x := card_powers('tst_opn');
    for r in select pc.card_id, c.rarity::text rarity, pc.ascension, s.cp_mod, pc.stat_points from player_cards pc join cards c on c.id = pc.card_id
               join subjects s on s.id = c.subject_id where pc.player_id = 'tst_opn' and pc.quantity > 0 loop
      n := n + 1;
      ex := (card_combat(r.rarity, r.ascension, r.cp_mod, r.stat_points)->>'cp')::int;
      if (x->(r.card_id::text)->>'power')::int is distinct from ex
         or (x->(r.card_id::text)->>'cp')::int is distinct from ex
         or (dungeon_card('tst_opn', r.card_id)->'cmb'->>'cp')::int is distinct from ex
         or (select o.power from owned_card_power('tst_opn') o where o.card_id = r.card_id) is distinct from ex
         or card_power_pts(r.rarity, r.ascension, r.cp_mod, r.stat_points) is distinct from ex then bad := bad + 1; end if;
      if (x->(r.card_id::text)->>'power')::int > card_power(r.rarity, r.ascension, r.cp_mod) then v_more := v_more + 1; end if;
      -- the flag OFF: the old number
      if not flag and (x->(r.card_id::text)->>'power')::int is distinct from card_power(r.rarity, r.ascension, r.cp_mod) then bad := bad + 1; end if;
    end loop;
    res := res || jsonb_build_object('case', 'flag ' || flag || ': card_powers = card_combat = dungeon_card = owned_card_power = card_power_pts (' || n || ' copies)', 'ok', bad = 0 and n >= 50, 'bad', bad, 'n', n);
    res := res || jsonb_build_object('case', 'flag ' || flag || ': the points are in the shown power (' || v_more || ' copies above the old card_power)',
      'ok', case when flag then v_more >= 10 else v_more = 0 end, 'more', v_more);

    -- the Hunt: hunt_pick_pool cp (the number hunt_attack and the auto-pick use)
    select id into h from hunts order by id desc limit 1;
    if h is not null then
      pool := hunt_pick_pool('tst_opn', h, null);
      select count(*) filter (where (e->>'cp')::int is distinct from (x->(e->>'id')->>'power')::int), count(*) into bad, n from jsonb_array_elements(pool) e;
      res := res || jsonb_build_object('case', 'flag ' || flag || ': hunt_pick_pool cp = the roster power (' || n || ' copies)', 'ok', bad = 0 and n >= 50, 'bad', bad);
    end if;

    -- 3. the totals against an independent sum over card_combat (every player of the copy, not only the sample)
    create temp table if not exists opn_ref (player_id text, card_id bigint, subject_id bigint, type text, cp int) on commit drop;
    truncate opn_ref;
    insert into opn_ref select pc.player_id, pc.card_id, c.subject_id, s.type::text, (card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'cp')::int
      from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id where pc.quantity >= 1;
    res := res || jsonb_build_object('case', 'flag ' || flag || ': roster_stats total, owned cards and owners = the sum of card_combat',
      'ok', (roster_stats()->>'total_power')::bigint = (select sum(cp) from opn_ref) and (roster_stats()->>'owned_cards')::int = (select count(*) from opn_ref)
        and (roster_stats()->>'owners')::int = (select count(distinct player_id) from opn_ref)
        and (roster_stats()->>'deployable_power')::bigint = deployable_power());
    snap := roster_snapshot();
    res := res || jsonb_build_object('case', 'flag ' || flag || ': roster_snapshot total_power = the sum of card_combat',
      'ok', (select rp.total_power from roster_power_history rp where rp.id = snap) = (select sum(cp) from opn_ref));
    select count(*) into bad from (
      select a.player_id from roster_top_players(1000) a full join (select player_id, count(*) c, sum(cp) s, max(cp) m from opn_ref group by player_id) b on b.player_id = a.player_id
       where a.total_power is distinct from b.s or a.best_card is distinct from b.m or a.owned_cards is distinct from b.c) z;
    res := res || jsonb_build_object('case', 'flag ' || flag || ': roster_top_players total, best card and count = card_combat', 'ok', bad = 0 and exists (select 1 from roster_top_players(1000) where player_id = 'tst_opn'), 'bad', bad);
    res := res || jsonb_build_object('case', 'flag ' || flag || ': deployable_power(3) = the best 3 attackers of each player by card_combat',
      'ok', deployable_power(3) = (select coalesce(sum(cp), 0) from (select cp, row_number() over (partition by player_id order by cp desc) rn from opn_ref where type in ('Character', 'Creature')) q where rn <= 3));
    -- the collection power: the sum of each subject, x the set bonus when every card of the subject is owned
    create temp table if not exists opn_coll (player_id text, power bigint) on commit drop;
    truncate opn_coll;
    insert into opn_coll select player_id, sum(case when ov = tv then round(s * (balance_get('set_bonus') #>> '{}')::numeric) else s end)::bigint
      from (select rr.player_id, rr.subject_id, sum(rr.cp) s, count(*) ov, (select count(*) from cards c2 where c2.subject_id = rr.subject_id) tv from opn_ref rr group by rr.player_id, rr.subject_id) z group by player_id;
    select count(*) into bad from (select a.player_id from collection_power_all() a full join opn_coll b on b.player_id = a.player_id where a.power is distinct from b.power) z;
    res := res || jsonb_build_object('case', 'flag ' || flag || ': collection_power_all = the independent sum with the set bonus', 'ok', bad = 0 and (select power from opn_coll where player_id = 'tst_opn3') is not null, 'bad', bad);
    select count(*) into bad from (select player_id from opn_coll where my_collection_power(player_id) is distinct from power) z;
    res := res || jsonb_build_object('case', 'flag ' || flag || ': my_collection_power = the same for every player', 'ok', bad = 0, 'bad', bad);
    -- the set bonus is in tst_opn3 (a complete subject): its power is above the plain sum
    res := res || jsonb_build_object('case', 'flag ' || flag || ': a complete set gets the bonus (tst_opn3)',
      'ok', my_collection_power('tst_opn3') > (select sum(cp) from opn_ref where player_id = 'tst_opn3'));
    if not flag then
      -- the flag OFF: the old formula, from card_cp_exact only
      select count(*) into bad from (select z1.p from (select pc2.player_id p, sum(case when ov = tv then round(s * (balance_get('set_bonus') #>> '{}')::numeric) else s end)::bigint pw from (select pc3.player_id, c.subject_id, sum(round(card_cp_exact(c.rarity::text, pc3.ascension, s2.cp_mod))::int) s, count(*) ov, (select count(*) from cards c2 where c2.subject_id = c.subject_id) tv from player_cards pc3 join cards c on c.id = pc3.card_id join subjects s2 on s2.id = c.subject_id where pc3.quantity >= 1 group by pc3.player_id, c.subject_id) pc2 group by pc2.player_id) z1 where my_collection_power(z1.p) is distinct from z1.pw) z;
      res := res || jsonb_build_object('case', 'flag false: my_collection_power = the old formula (card_cp_exact)', 'ok', bad = 0, 'bad', bad);
    end if;
  end loop;

  -- 4. ascend_card: the power of the answer = card_powers after it (the points of the copy are in it)
  update balance set value = value || '{"enabled": true}' where key = 'stat_points';
  select c.id, ascend_cost(c.rarity::text, 0) into cid, asc_cost from cards c join subjects s on s.id = c.subject_id
    where c.rarity not in ('event', 'promo') and s.type in ('Character', 'Creature') and c.rarity = 'normal' order by c.id limit 1;
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points) values ('tst_opn2', cid, 1 + asc_cost, 0, '{"attack":2,"vitality":1}');
  ar := ascend_card('tst_opn2', cid);
  x := card_powers('tst_opn2');
  res := res || jsonb_build_object('case', 'ascend_card: the power of the answer = card_powers after it, with the Attack points',
    'ok', (ar->>'ok')::boolean and (ar->>'power')::int = (x->(cid::text)->>'power')::int
      and (ar->>'power')::int > card_power((select rarity::text from cards where id = cid), 1, (select cp_mod from subjects where id = (select subject_id from cards where id = cid))), 'answer', ar);
  -- 5. card_power (3 arguments) is still the base number
  res := res || jsonb_build_object('case', 'card_power (3 arguments) is the base number: no points',
    'ok', card_power('normal', 0, 1.0) = round(card_cp_exact('normal', 0, 1.0))::int and card_power('gold', 3, 1.3) = round(card_cp_exact('gold', 3, 1.3))::int);

  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\n.*$/, ''));
let fail = 0;
for (const r of results) {
  const { case: name, ok, ...rest } = r;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 700)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
