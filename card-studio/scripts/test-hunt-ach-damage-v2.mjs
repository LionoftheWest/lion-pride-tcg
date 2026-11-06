import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/hunt_ach_damage_v2.sql (HUNT-V2-NATIVE part 2, Nathan 2026-11-06 option B: the damage achievements
 * heavy, bighit, dmg1k, hit500 count in v2 numbers; the tiers in v2 units in balance v2_ach_damage; nobody loses an earned tier).
 * LOCAL copy only. One DO block per request, undone by its final RAISE: NO lasting change.
 *   LOCALDB=1 LAB_LOCK_OWNER=<you> node --import ./scripts/localdb-preload.mjs scripts/test-hunt-ach-damage-v2.mjs    must PASS
 *   MUTATE=<name> ...   must FAIL;   MUTATE=all ...   the baseline, then every mutation (each must FAIL), in one run
 * Cases:
 *   D1 the balance row v2_ach_damage (the exact numbers, a note) and its copy in achievement_tracks (heavy, bighit) and achievement_switch_map
 *   D2 ach_damage_rows: a v1-unit Hunt counts x v1_x, a v2-unit Hunt x 1; heavy = round(the sum), bighit = round(the largest row);
 *      ach_track_values and ach_damage_rows(null) give the same numbers
 *   D3 nobody loses a tier: members at each old tier edge (the tier, the tier - 1, the steps after tier 5; v1 rows only) reach at least the
 *      tier count of origin/main, at most 1 more (integer v2 values: about 2 v1 values map to one v2 number, so a value 1 below an old edge
 *      can reach it; tiers rounded down never take one away); the old goals dmg1k / hit500 never lost; the D-183 old_paid the same
 *   D4 the copy: a change of the balance row is copied to the two tables and written to balance_log; tiers that do not rise, 4 tiers, an
 *      unknown key, a v1_x out of its limits are refused
 *   D5 achievement_view (the member's tracks ON): the value of heavy = ach_damage_rows, the tiers = the balance tiers
 *   D6 ach_damage_rows: no EXECUTE for anon / authenticated; the file runs a second time; the guard refuses an unknown text; the undo puts the
 *      origin/main tables back
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-hunt-ach-damage-v2.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const CLEAN = read('../../tcg-bot/supabase/hunt_ach_damage_v2.sql');
const UNDO = read('../../tcg-bot/supabase/hunt_ach_damage_v2_undo.sql');
const MUT = {
  rows_no_factor: ["then 1::numeric else x end as f", "then 1::numeric else 1 end as f"],
  rows_factor_on_v2: ["case when h.stats->>'unit' = 'v2' then 1::numeric else x end as f", "x as f"],
  rows_bighit_sum: ['round(max(hh.damage * k.f))::bigint', 'round(sum(hh.damage * k.f))::bigint'],
  rows_one_player: ['where p_player is null or hh.player_id = p_player', 'where hh.player_id = p_player'],
  atv_raw: ["coalesce((select jsonb_build_object('heavy', d.heavy, 'bighit', d.bighit) from ach_damage_rows(p_player) d), jsonb_build_object('heavy', 0, 'bighit', 0))",
    "(select jsonb_build_object('heavy', coalesce(sum(damage), 0), 'bighit', coalesce(max(damage), 0)) from hunt_hits where player_id = p_player)"],
  tier_rounded_up: ['"tiers":[181,407,724,1177,1812]', '"tiers":[181,407,724,1177,1813]'],
  proof_too_high: ['"hit500":226', '"hit500":228'],
  sync_no_tracks: ["  update achievement_tracks set tiers = array(select (z #>> '{}')::int from jsonb_array_elements(v->'heavy'->'tiers') z), step = (v->'heavy'->>'step')::int where key = 'heavy';\n", ''],
  sync_no_proves: ["  update achievement_switch_map set proves = (v->'old'->>'dmg1k')::int where old_key = 'dmg1k';\n", ''],
  sync_no_rising: ["      raise exception 'balance v2_ach_damage: the tiers must rise (heavy.tiers and bighit.tiers)';\n", ''],
  spec_open: ['"heavy":{"tiers":["list","int 1 100000000",5,5]', '"heavy":{"tiers":["list","int 1 100000000",5,6]'],
  guard_missing: [/do \$g\$\ndeclare m text; f record;[\s\S]*?-- GUARD-END\n/, ''],
};
function mutate(src, name) {
  const [a, b] = MUT[name];
  const n = a instanceof RegExp ? (src.match(new RegExp(a.source, 'g')) || []).length : src.split(a).length - 1;
  if (n !== 1) throw new Error(`the mutation ${name} does not match exactly once (${n})`);
  return a instanceof RegExp ? src.replace(a, b) : src.split(a).join(b);
}
const noGuard = (s) => s.replace(/do \$g\$\ndeclare m text; f record;[\s\S]*?-- GUARD-END\n/, '');
for (const s of [CLEAN, UNDO]) if (['$m$', '$t$', '$x$', '$u$'].some((x) => s.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $x$ or $u$');

const lit = (s) => `'${s.replace(/'/g, "''")}'`;
// members: P(1) mixed v1 + v2 rows; P(2..) one per edge value
const P = (i) => lit(`9000000000000088${String(i).padStart(2, '0')}`);
// the old tier edges (v1 numbers): heavy tiers 2500 .. 250000 and the steps (step 100000), bighit 400 .. 4000, the old goals 1000 / 500
const HEAVY = [2500, 2499, 10000, 9999, 40000, 39999, 100000, 99999, 250000, 249999, 350000, 349999, 1000, 999, 1, 0];
const BIG = [400, 399, 900, 899, 1600, 1599, 2600, 2599, 4000, 3999, 500, 499, 1, 0];
const DECL = `res jsonb := '[]'; a jsonb; x jsonb; e jsonb; msg text; h1 bigint; h2 bigint; c bigint; n int; i int; v bigint; o jsonb; nw jsonb; na bigint[]`;
const block = (mig, body, mutated) => String.raw`do $t$
declare ${DECL};
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_had_admin', true);
  na := array(select id from cards order by id limit 3);
  -- a v1-unit Hunt and a v2-unit Hunt, both ended
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
    values ('The Test Boss', 'Heroic', '[]'::jsonb, 80000, 0, now() - interval '9 days', now() - interval '8 days', 'expired', '{"atk": 50}'::jsonb) returning id into h1;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
    values ('The Test Boss', 'Heroic', '[]'::jsonb, 36244, 0, now() - interval '3 days', now() - interval '2 days', 'expired', '{"atk": 50, "unit": "v2"}'::jsonb) returning id into h2;
  insert into players (id, username) select z, 'tst had' from unnest(array[${Array.from({ length: 40 }, (_, k) => P(k + 1)).join(', ')}]) z;
  -- P(1): v1 rows 1000 + 600, v2 rows 3624 + 100
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values
    (h1, ${P(1)}, na[1], current_date - 9, 1000), (h1, ${P(1)}, na[2], current_date - 9, 600), (h2, ${P(1)}, na[1], current_date - 3, 3624), (h2, ${P(1)}, na[2], current_date - 3, 100);
  -- the heavy edges: one v1 row each (P(2) ..); the bighit edges: one v1 row each (P(20) ..)
  ${HEAVY.map((d, k) => d > 0 ? `insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h1, ${P(k + 2)}, na[1], current_date - 9, ${d});` : '').join('\n  ')}
  ${BIG.map((d, k) => d > 0 ? `insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h1, ${P(k + 20)}, na[1], current_date - 9, ${d});` : '').join('\n  ')}
  -- the old goals dmg1k / hit500 claimed by P(14) (heavy 1000) and P(30) (bighit 500): the D-183 proof
  insert into achievement_claims (player_id, key, packs) values (${P(14)}, 'dmg1k', 0), (${P(30)}, 'hit500', 0) on conflict do nothing;
  create function pg_temp.reached(p_track text, p_val bigint) returns int language plpgsql as $x$
  declare k int := 0; nx bigint;
  begin
    loop nx := ach_tier_need(p_track, k + 1); exit when nx is null or p_val < nx or k > 2000; k := k + 1; end loop;
    return k;
  end $x$;
  -- per member: the values, the tiers reached, ach_tier_paid_before for tiers 1..5, the old goals (the Activity rule: value >= goal)
  create function pg_temp.state() returns jsonb language sql as $x$
    select jsonb_object_agg(p.id, jsonb_build_object('h', (t.v->>'heavy')::bigint, 'b', (t.v->>'bighit')::bigint,
      'th', pg_temp.reached('heavy', (t.v->>'heavy')::bigint), 'tb', pg_temp.reached('bighit', (t.v->>'bighit')::bigint),
      'ph', (select array_agg(ach_tier_paid_before(p.id, 'heavy', z) order by z) from generate_series(1, 5) z),
      'pb', (select array_agg(ach_tier_paid_before(p.id, 'bighit', z) order by z) from generate_series(1, 5) z),
      'g1', (t.v->>'heavy')::bigint >= (select proves from achievement_switch_map where old_key = 'dmg1k'),
      'g2', (t.v->>'bighit')::bigint >= (select proves from achievement_switch_map where old_key = 'hit500')))
      from players p cross join lateral (select ach_track_values(p.id) v) t where p.username = 'tst had' $x$;
  -- the origin/main state (no file), then the file
  o := pg_temp.state();
  execute $m$${mig}$m$;
  nw := pg_temp.state();
  ${body}
  raise exception 'RESULT:%', jsonb_build_object('rows', res)::text;
end $t$;`;
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;
const sub = (body) => String.raw`
  begin
    ${body}
    raise exception 'had_rollback';
  exception when others then if sqlerrm <> 'had_rollback' then res := res || jsonb_build_object('case', 'a sub-block raised', 'ok', false, 'got', to_jsonb(sqlerrm)); end if;
  end;`;
const X = 36244 / 80000;

const B1 = (mig, mutated) => block(mig, String.raw`
  -- D1
  ${add('D1 balance v2_ach_damage: v1_x 0.45305, heavy [1132,4530,18122,45305,113262] step 45305, bighit [181,407,724,1177,1812], old dmg1k 453 hit500 226, a note',
    `(select value = '{"v1_x":0.45305,"heavy":{"tiers":[1132,4530,18122,45305,113262],"step":45305},"bighit":{"tiers":[181,407,724,1177,1812]},"old":{"dmg1k":453,"hit500":226}}'::jsonb
       and note like 'The damage achievements in v2 numbers%' from balance where key = 'v2_ach_damage')`,
    `(select value from balance where key = 'v2_ach_damage')`)}
  ${add('D1 the copy: achievement_tracks heavy / bighit and achievement_switch_map dmg1k / hit500 have the balance numbers',
    `(select tiers = '{1132,4530,18122,45305,113262}' and step = 45305 from achievement_tracks where key = 'heavy')
     and (select tiers = '{181,407,724,1177,1812}' and step is null from achievement_tracks where key = 'bighit')
     and (select proves from achievement_switch_map where old_key = 'dmg1k') = 453 and (select proves from achievement_switch_map where old_key = 'hit500') = 226`,
    `(select jsonb_agg(jsonb_build_array(key, tiers, step)) from achievement_tracks where key in ('heavy', 'bighit'))`)}
  -- D2
  ${add('D2 ach_damage_rows: v1 rows x 0.45305 + v2 rows x 1 (heavy = round(1600 x 0.45305 + 3724) = 4449, bighit = round(max(1000 x 0.45305, 3624)) = 3624)',
    `(select heavy = round(1600 * ${X} + 3724) and bighit = 3624 from ach_damage_rows(${P(1)}))`, `(select to_jsonb(d) from ach_damage_rows(${P(1)}) d)`)}
  ${add('D2 ach_track_values and ach_damage_rows(null) give the same numbers for every test member',
    `(select bool_and((t.v->>'heavy')::bigint = d.heavy and (t.v->>'bighit')::bigint = d.bighit)
       from ach_damage_rows(null) d cross join lateral (select ach_track_values(d.player_id) v) t where d.player_id in (select id from players where username = 'tst had'))
     and (select count(*) from ach_damage_rows(null) d where d.player_id in (select id from players where username = 'tst had')) = ${1 + HEAVY.filter((d) => d > 0).length + BIG.filter((d) => d > 0).length}`)}
  ${add('D2 a v1-only member: heavy = round(v1 x 0.45305) (2500 -> 1133, 250000 -> 113263)',
    `(select heavy from ach_damage_rows(${P(2)})) = round(2500 * ${X}) and (select heavy from ach_damage_rows(${P(10)})) = round(250000 * ${X})`)}
  -- D3
  ${add('D3 nobody loses a tier: every edge member (v1 rows) reaches at least the heavy and bighit tier count of origin/main, at most 1 more; the tier edges themselves stay equal',
    `(select bool_and((nw->k->>'th')::int between (o->k->>'th')::int and (o->k->>'th')::int + 1 and (nw->k->>'tb')::int between (o->k->>'tb')::int and (o->k->>'tb')::int + 1)
       from jsonb_object_keys(o) k where k <> ${lit(P(1).slice(1, -1))})
     and (select bool_and((o->k->>'th') = (nw->k->>'th')) from jsonb_object_keys(o) k where k <> ${lit(P(1).slice(1, -1))} and (o->k->>'h')::bigint in (${HEAVY.filter((d, k) => k % 2 === 0 && d > 1).join(', ')}))
     and (select bool_and((o->k->>'tb') = (nw->k->>'tb')) from jsonb_object_keys(o) k where k <> ${lit(P(1).slice(1, -1))} and (o->k->>'b')::bigint in (${BIG.filter((d, k) => k % 2 === 0 && d > 1).join(', ')}))
     and (select count(distinct o->k->>'th') from jsonb_object_keys(o) k) >= 5 and (select count(distinct o->k->>'tb') from jsonb_object_keys(o) k) >= 5`,
    `(select jsonb_object_agg(k, jsonb_build_array(o->k->'th', nw->k->'th', o->k->'tb', nw->k->'tb', o->k->'h', nw->k->'h', o->k->'b', nw->k->'b')) from jsonb_object_keys(o) k where (o->k->>'th') <> (nw->k->>'th') or (o->k->>'tb') <> (nw->k->>'tb'))`)}
  ${add('D3 the old goals dmg1k / hit500 (value >= the goal) are never lost (an edge member 1 below the goal may reach it)',
    `(select bool_and((not (o->k->>'g1')::boolean or (nw->k->>'g1')::boolean) and (not (o->k->>'g2')::boolean or (nw->k->>'g2')::boolean)) from jsonb_object_keys(o) k where k <> ${lit(P(1).slice(1, -1))})
     and (select count(*) filter (where (nw->k->>'g1')::boolean) from jsonb_object_keys(o) k) > 0`,
    `(select jsonb_object_agg(k, jsonb_build_array(o->k->'g1', nw->k->'g1', o->k->'g2', nw->k->'g2')) from jsonb_object_keys(o) k where (o->k->>'g1') <> (nw->k->>'g1') or (o->k->>'g2') <> (nw->k->>'g2'))`)}
  ${add('D3 the D-183 proof (ach_tier_paid_before, tiers 1..5) is the same for every edge member (dmg1k and hit500 claimed by two of them)',
    `(select bool_and((o->k->'ph') = (nw->k->'ph') and (o->k->'pb') = (nw->k->'pb')) from jsonb_object_keys(o) k)
     and (nw->${P(30)}->'pb'->>0)::boolean`,
    `(select jsonb_object_agg(k, jsonb_build_array(o->k->'ph', nw->k->'ph', o->k->'pb', nw->k->'pb')) from jsonb_object_keys(o) k where (o->k->'ph') <> (nw->k->'ph') or (o->k->'pb') <> (nw->k->'pb'))`)}
  -- D4
  ${sub(String.raw`
    c := (select count(*) from balance_log where key = 'v2_ach_damage');
    update balance set value = jsonb_set(value, '{heavy,tiers}', '[1000,4000,18000,45000,113000]') where key = 'v2_ach_damage';
    ${add('D4 a change of the balance row is copied to achievement_tracks in the same transaction and written to balance_log',
      `(select tiers = '{1000,4000,18000,45000,113000}' from achievement_tracks where key = 'heavy') and (select count(*) from balance_log where key = 'v2_ach_damage') = c + 1`,
      `(select to_jsonb(tiers) from achievement_tracks where key = 'heavy')`)}`)}
  ${sub(String.raw`
    update balance set value = jsonb_set(value, '{old,hit500}', '200') where key = 'v2_ach_damage';
    ${add('D4 a change of old.hit500 is copied to achievement_switch_map', `(select proves from achievement_switch_map where old_key = 'hit500') = 200`)}`)}
  ${sub(String.raw`
    begin update balance set value = jsonb_set(value, '{bighit,tiers}', '[181,407,407,1177,1812]') where key = 'v2_ach_damage'; msg := null; exception when others then msg := sqlerrm; end;
    ${add('D4 tiers that do not rise are refused', `msg like '%the tiers must rise%'`, 'to_jsonb(msg)')}
    begin update balance set value = jsonb_set(value, '{heavy,tiers}', '[1,2,3,4,5,6]') where key = 'v2_ach_damage'; msg := null; exception when others then msg := sqlerrm; end;
    ${add('D4 6 tiers are refused (the shape: exactly 5)', `msg like '%heavy.tiers must have 5 to 5 items%'`, 'to_jsonb(msg)')}
    begin update balance set value = value || '{"extra": 1}' where key = 'v2_ach_damage'; msg := null; exception when others then msg := sqlerrm; end;
    ${add('D4 an unknown key is refused', `msg like '%unknown key extra%'`, 'to_jsonb(msg)')}
    begin update balance set value = jsonb_set(value, '{v1_x}', '1.5') where key = 'v2_ach_damage'; msg := null; exception when others then msg := sqlerrm; end;
    ${add('D4 a v1_x out of its limits (0.01 to 1) is refused', `msg like '%v1_x must be from 0.01 to 1%'`, 'to_jsonb(msg)')}`)}
  -- D5
  ${sub(String.raw`
    update settings set value = jsonb_set(coalesce(value, '{}'::jsonb), '{users}', coalesce(value->'users', '[]'::jsonb) || jsonb_build_array(${P(1)}::text)) where key = 'achievement_tracks';
    a := achievement_view(${P(1)});
    e := (select z from jsonb_array_elements(a->'tracks') z where z->>'key' = 'heavy');
    ${add('D5 achievement_view: heavy value = ach_damage_rows heavy (4449), the tiers = the balance tiers, the next goal 4530',
      `(e->>'value')::bigint = (select heavy from ach_damage_rows(${P(1)})) and e->'tiers' = '[1132,4530,18122,45305,113262]'::jsonb and (e->>'next')::bigint = 4530`, 'e')}`)}
  -- D6
  ${add('D6 ach_damage_rows: no EXECUTE for anon or authenticated; EXECUTE for service_role',
    `not has_function_privilege('anon', 'public.ach_damage_rows(text)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.ach_damage_rows(text)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.ach_damage_rows(text)', 'EXECUTE')`)}
  begin execute $m$${mutated ? noGuard(mig) : mig}$m$; msg := null; exception when others then msg := sqlerrm; end;
  ${add('D6 the file runs a second time with no error and keeps the balance row', `msg is null and (select value->'heavy'->>'step' from balance where key = 'v2_ach_damage') = '45305'`, 'to_jsonb(msg)')}
  ${sub(String.raw`
    execute replace(pg_get_functiondef('public.ach_track_values(text)'::regprocedure), 'AS $function$', 'AS $function$ ');
    begin execute $m$${mig}$m$; msg := null; exception when others then msg := sqlerrm; end;
    ${add('D6 the guard: an unknown ach_track_values text (one space added) makes the file refuse', `msg like '%changed since this file was built%'`, 'to_jsonb(msg)')}`)}
  ${sub(String.raw`
    execute $u$${mutated ? noGuard(UNDO) : UNDO}$u$;
    ${add('D6 the undo: the v1 tables (heavy 2500 .. 250000 step 100000, bighit 400 .. 4000, dmg1k 1000, hit500 500), no ach_damage_rows, the origin/main state',
      `(select tiers = '{2500,10000,40000,100000,250000}' and step = 100000 from achievement_tracks where key = 'heavy')
       and (select tiers = '{400,900,1600,2600,4000}' from achievement_tracks where key = 'bighit')
       and (select proves from achievement_switch_map where old_key = 'dmg1k') = 1000 and (select proves from achievement_switch_map where old_key = 'hit500') = 500
       and to_regprocedure('public.ach_damage_rows(text)') is null and pg_temp.state() = o`)}`)}
`, mutated);

async function run(mig, mutated = false) {
  try { return JSON.parse(await runBlock(B1(mig, mutated))).rows; } catch (e) { return [{ case: 'B1 raised', ok: false, got: String(e.message).slice(0, 1500) }]; }
}
const print = (rows) => { for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  got: ' + JSON.stringify(r.got).slice(0, 900)}`); };
const LOG = process.env.HAD_LOG;
const say = (s) => { console.log(s); if (LOG) appendFileSync(LOG, s + '\n'); };
const want = process.env.MUTATE;
if (!want) {
  const rows = await run(CLEAN);
  print(rows);
  const fail = rows.filter((r) => !r.ok).length;
  say(fail ? `HAD FAIL ${fail} of ${rows.length}` : `HAD PASS ${rows.length} of ${rows.length}`);
  process.exitCode = fail ? 1 : 0;
} else {
  const names = want === 'all' ? Object.keys(MUT) : want.split(',');
  let caught = 0, base = null;
  if (want === 'all') {
    const rows = await run(CLEAN);
    const fail = rows.filter((r) => !r.ok).length;
    base = fail === 0;
    say(`baseline (same run): ${base ? 'PASS' : 'FAIL'} ${rows.length - fail} of ${rows.length}`);
    if (!base) { print(rows); process.exit(1); }
  }
  for (const n of names) {
    const rows = await run(mutate(CLEAN, n), true);
    const failed = rows.filter((r) => !r.ok);
    if (failed.length) caught++;
    say(`MUTATE ${n}: ${failed.length ? 'CAUGHT' : 'MISSED'} (${failed.length} failing: ${failed.map((r) => r.case.slice(0, 60)).join(' | ')})`);
  }
  say(`mutations caught ${caught} of ${names.length}`);
  process.exitCode = caught === names.length && base !== false ? 0 : 1;
}
