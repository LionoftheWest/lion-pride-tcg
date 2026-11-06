import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_hunt_boons.sql (item HBP: the Combat v2 Hunt reads the Hunt boons and pranks rally,
 * butterfingers, launch_party, raid_crasher and mend; pipeline item HBP SPEC v2, gate section 6: G-1 .. G-11).
 * In-block cases (G-1 .. G-9, G-11): NO lasting change (one DO block per request, undone by its final RAISE). Each block runs this file (the
 * copy must have R3-ON; the file guard accepts the R3-ON text or this file's text), makes its own active Hunt (every other active Hunt expires
 * in the block), its own members, testers and effect rows, and sets the flag combat_v2.hunt per case.
 * The H cases (G-10): two real connections, a COMMITTED sample (members 0450x, Hunts marked weak_points ["hbp_h_sample"]), removed in a
 * finally step (0 rows left is checked). The copy must have this file applied for H.
 *   LOCALDB=1 LOCALDB_ENV=... node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-hunt-boons.mjs       must PASS all
 *   MUTATE=<name> ...   must FAIL; MUTATE=all ...   the baseline, every mutation (each must FAIL), the baseline again
 *   SEEDS=<n> (G-3, default 20), LOGS=<n> (G-2, default 50), ROUNDS=<n> (G-10, default 20); fewer than the spec print PARTIAL
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-hunt-boons.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('../../tcg-bot/supabase/combat_v2_hunt_boons.sql');
let undo = read('../../tcg-bot/supabase/combat_v2_hunt_boons_undo.sql');
const CLEAN = mig;
// the guard of the file: [function, the md5 of the text that this file makes]
const GUARD_NEW = [...CLEAN.matchAll(/\('public\.([^']+)', '[0-9a-f]{32}', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], m[2]]);
if (GUARD_NEW.length !== 3) throw new Error('the guard of the file must name 3 functions with their md5 (' + GUARD_NEW.length + ')');
// HUNT-V2-NATIVE (review r1 M1): hunt_v2_native_units.sql replaces hunt_v2_live_credit after this file, so this file's guard refuses the copy.
// A block takes the native file off first (its undo, rolled back with the block), applies this file, and does not put
// the native file back: the block checks this file alone, as before (rolled back with the block). The H harness takes the native file off before its
// committed mutated apply and puts it back in its finally step.
const NATIVE = read('../../tcg-bot/supabase/hunt_v2_native_units.sql');
const NATIVE_UNDO = read('../../tcg-bot/supabase/hunt_v2_native_units_undo.sql');
const NATIVE_LC = (NATIVE.match(/\('public\.hunt_v2_live_credit\(bigint, text, date, jsonb\)', '[0-9a-f]{32}', '([0-9a-f]{32})'\)/) || [])[1];
if (!NATIVE_LC) throw new Error('the guard of hunt_v2_native_units.sql must name hunt_v2_live_credit with its md5');
for (const t of [NATIVE, NATIVE_UNDO]) if (t.includes('$nu$')) throw new Error('the native files must not contain $nu$');
const NATIVE_ON = `md5(replace(pg_get_functiondef('public.hunt_v2_live_credit(bigint, text, date, jsonb)'::regprocedure), chr(13), '')) = '${NATIVE_LC}'`;
const SEEDS = Number(process.env.SEEDS || 20), LOGS = Number(process.env.LOGS || 50), ROUNDS = Number(process.env.ROUNDS || 20);

// ---------------------------------------------------------------------------------------------------------- the mutations (spec 6, 8.6)
// [anchor, replacement] on the file; a key in UNDO_MUT changes the undo file instead. Each anchor must match exactly once.
const USES_BLOCK = /  s := hunt_v2_shared\(p_hunt, p_player, p_day, c\);\n[\s\S]*?    end loop;\n  end if;\n/;
const MUT = {
  // G-1
  no_cap: ["a := least(coalesce((r->>'amount')::numeric, 0), cap);", "a := coalesce((r->>'amount')::numeric, 0);"],
  tick_boosted: ["hit := e->>'k' = 'act' and e->'actor'->>'side' = 'card' and dec > 0;", 'hit := dec > 0;'],
  crash_from_base: ['          own := dec * m;\n          xp :=', '          own := dec;\n          xp :='],
  newest_first: ["order by (z->>'created_at')::timestamptz, (z->>'id')::bigint)", "order by (z->>'created_at')::timestamptz desc, (z->>'id')::bigint desc)"],
  crash_no_fallback: ['if xp is null or xc is null then xp := null; xc := card; fb := true; end if;', 'if xp is null or xc is null then continue; end if;'],
  rally_one_row: ["if fx->k->>'primitive' = pr and (lft->>(fx->k->>'id'))::int > 0 then j := k; exit; end if;", "if fx->k->>'primitive' = pr and (lft->>(fx->k->>'id'))::int > 0 and not (pr = 'rally' and n_rally > 0) then j := k; exit; end if;"],
  fk_no_fallback: [/'options', e\.options\n[\s\S]*?else array\['card_id'\] end\)\n/, "'options', e.options)\n"],
  zero_hit_uses: ["hit := e->>'k' = 'act' and e->'actor'->>'side' = 'card' and dec > 0;", "hit := e->>'k' = 'act' and e->'actor'->>'side' = 'card';"],
  // G-2
  plan_rounds_per_hit: ['coalesce((per->>card)::numeric, 0) + own)', 'coalesce((per->>card)::numeric, 0) + round(own))'],
  // G-3
  extras_not_in_hp: ['  v_dec := v_total + v_extra;', '  v_dec := v_total;'],
  crash_no_log: ['    insert into public.combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, result)\n', '    continue;\n    insert into public.combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, result)\n'],
  crash_to_member: ['values (p_hunt, c.player, c.card, p_day, c.dmg)', 'values (p_hunt, p_player, c.card, p_day, c.dmg)'],
  uses_not_written: ["  if coalesce((s->>'written')::boolean, false) then\n    for u in", '  if false then\n    for u in'],
  // G-4 .. G-7
  rally_all_hits: ["if pr = 'rally' then m := m * (1 + a / 100); n_rally := n_rally + 1;", "if pr = 'rally' then m := m * (1 + a / 100); n_rally := n_rally + 1; lft := lft || jsonb_build_object(r->>'id', 1);"],
  practice_consumes: ["  if not found or not r.live then return jsonb_build_object('total', 0, 'written', false); end if;", "  if not found then return jsonb_build_object('total', 0, 'written', false); end if;"],
  consume_before_shared: [USES_BLOCK, "  for u in select z from jsonb_array_elements(c->'uses') z loop\n    if (u->>'left')::int <= 0 then update public.player_effects set consumed_at = now() where id = (u->>'id')::bigint;\n    else update public.player_effects set options = options || jsonb_build_object('uses', (u->>'left')::int) where id = (u->>'id')::bigint; end if;\n  end loop;\n  s := hunt_v2_shared(p_hunt, p_player, p_day, c);\n  if coalesce((s->>'over')::boolean, false) then\n    update public.hunt_v2_days set status = 'over', ended_by = 'hunt_over', ended_at = coalesce(ended_at, now())\n     where hunt_id = p_hunt and player_id = p_player and day = p_day and (status = 'active' or ended_by is distinct from 'hunt_over');\n  end if;\n"],
  touch_v1: ['-- ============================================================ 5. server only', "do $hb$ begin execute replace(pg_get_functiondef('public.hunt_attack(text, bigint, bigint)'::regprocedure), 'AS $function$', 'AS $function$\n-- hbp'); end $hb$;\n-- ============================================================ 5. server only"],
  // G-8, G-9
  guard_off: [/do \$g\$\ndeclare m text; f record;[\s\S]*?-- GUARD-END\n/, ''],
  boons_read_flag: ['  c := hunt_v2_boon_plan(p_log, to_jsonb(r.squad), v_hpmax / v_max, fx,', "  c := hunt_v2_boon_plan(p_log, to_jsonb(r.squad), v_hpmax / v_max, case when combat_v2_on('hunt') then fx else '[]'::jsonb end,"],
  // G-10 (the H cases)
  rows_no_lock: ['order by pe.created_at, pe.id for update skip locked) e;', 'order by pe.created_at, pe.id) e;'],
  no_skip_locked: ['order by pe.created_at, pe.id for update skip locked) e;', 'order by pe.created_at, pe.id for update) e;'],
  // G-11
  mend_raw_hp: ["(u->>'hp')::numeric + (u->>'max')::numeric * least(v_mamt,", "(u->>'hp')::numeric + 100 * least(v_mamt,"],
  mend_any_card: ["    u := f->'cards'->(t->>'id');\n", "    t := jsonb_build_object('side', 'card', 'id', (select q.key from jsonb_each(f->'cards') q where combat_v2_up(q.value) order by (q.value->>'hp')::numeric / (q.value->>'max')::numeric, q.key limit 1));\n    u := f->'cards'->(t->>'id');\n"],
  mend_full_card: ["coalesce((u->>'hp')::numeric, 0) > 0\n       and (u->>'hp')::numeric < (u->>'max')::numeric then", "coalesce((u->>'hp')::numeric, 0) > 0 then"],
  mend_take_first: [/      select pe\.id, coalesce\(pe\.amount, 0\) into v_mid, v_mamt from public\.player_effects pe\n[\s\S]*?limit 1 for update skip locked;\n/, "      v_mamt := take_player_effect(p_player, 'mend'); v_mid := case when v_mamt is null then null else -1 end;\n"],
};
const UNDO_MUT = {
  undo_wrong: ['drop function if exists public.hunt_v2_boon_plan(jsonb, jsonb, numeric, jsonb, numeric);\n', ''],
};
// the spec 6 names, in the table order (G-12 h3_no_reapply and G-13 slow_plan run in their own harness: test-combat-v2-hunt-practice.mjs and the M-T probe)
const NAMED = `no_cap tick_boosted crash_from_base newest_first crash_no_fallback rally_one_row fk_no_fallback zero_hit_uses plan_rounds_per_hit
  extras_not_in_hp crash_no_log crash_to_member uses_not_written rally_all_hits practice_consumes consume_before_shared touch_v1 guard_off undo_wrong
  boons_read_flag rows_no_lock no_skip_locked mend_raw_hp mend_any_card mend_full_card mend_take_first`.split(/\s+/).filter(Boolean);
const ALL = { ...MUT, ...UNDO_MUT };
const H_MUTS = ['rows_no_lock', 'no_skip_locked'];

if (process.env.MUTATE === 'all') {
  let ok = true;
  const missing = NAMED.filter((n) => !ALL[n]);
  console.log(`named mutations of the spec 6 table (this harness): ${NAMED.length}; missing: ${missing.length ? missing.join(' ') : 'none'}`);
  if (missing.length) ok = false;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const baseline = (label) => {
    const base = runOne('');
    const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
    const pass = base.status === 0 && /^PASS all/.test(bl);
    console.log(`baseline ${label.padEnd(6)} (no mutation)     ${pass ? 'PASS' : 'FAIL'}  ${bl.slice(0, 160)}`);
    if (!pass) { ok = false; console.log((base.stdout || '').split(/\r?\n/).filter((l) => /^FAIL/.test(l)).join('\n').slice(0, 3000)); }
  };
  baseline('start');
  for (const name of Object.keys(ALL)) {
    const t0 = Date.now();
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const why = (r.stdout || '').split(/\r?\n/).find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '';
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  ${Math.round((Date.now() - t0) / 1000)}s  ${why.slice(0, 170)}`);
  }
  // the harness check of review F-9 (not a product mutation): the harness repeats a committed call; G-10d must FAIL
  {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: '', ONLY: 'G10', HARNESS_MUT: 'retry_commits_twice', LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line) && /^FAIL G-10d/m.test(r.stdout || '');
    if (!caught) ok = false;
    const why = (r.stdout || '').split(/\r?\n/).find((l) => /^FAIL/.test(l)) || '';
    console.log(`harness check retry_commits_twice ${caught ? 'caught (G-10d FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  ${Math.round((Date.now() - t0) / 1000)}s  ${why.slice(0, 170)}`);
  }
  baseline('end');
  console.log(ok ? `mutations: baseline PASS at the start and the end, all ${Object.keys(ALL).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const name = process.env.MUTATE;
  const m = MUT[name] || UNDO_MUT[name];
  if (!m) throw new Error(`no mutation ${name}`);
  const [a, b] = m;
  const src = MUT[name] ? mig : undo;
  const n = a instanceof RegExp ? (src.match(new RegExp(a.source, 'g')) || []).length : src.split(a).length - 1;
  if (n !== 1) throw new Error(`the mutation ${name} does not match exactly once (${n})`);
  const out = a instanceof RegExp ? src.replace(a, b) : src.split(a).join(b);
  if (MUT[name]) mig = out; else undo = out;
}
for (const s of [mig, undo]) if (['$m$', '$t$', '$x$', '$w$', '$n$'].some((x) => s.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $x$, $w$ or $n$');

// ---------------------------------------------------------------------------------------------------------- the shared SQL
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const id = (k, i) => `9000000000000${k}${String(i).padStart(2, '0')}`;
const TESTERS = Array.from({ length: 4 }, (_, i) => id('044', i + 1));
const MEMBERS = Array.from({ length: 60 }, (_, i) => id('046', i + 1));
const PRANK = id('047', 1);   // the prankster P of the raid_crasher rows
const T = (i) => lit(TESTERS[i - 1]);
const M = (i) => lit(MEMBERS[i - 1]);
const P = lit(PRANK);
const V1_MD5 = { attack: '7f71eebe29b73b15f7c46d2b7a44c4b0', support: 'e3f4fa9d381f6e8779e6151830a3c2ae' };
const R3ON_MD5 = { turns: '32480034440a93d10fc5b671aba81d65', shared: '7633f3120651daf0a9094e43d08df801', live: '187f166bf4d3e559924ca105dbaf62b1' };
const FN4 = ['hunt_v2_boon_plan(jsonb, jsonb, numeric, jsonb, numeric)', 'hunt_v2_shared(bigint, text, date, jsonb)', 'hunt_v2_live_credit(bigint, text, date, jsonb)', 'hunt_v2_turns(text, jsonb, boolean, integer)'];
const PRE = String.raw`
  if to_regprocedure('public.hunt_v2_shared(bigint, text, date, jsonb)') is null then raise exception 'R3-ON (combat_v2_on_hunt.sql) is not applied on this copy'; end if;
  if to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is null then
    execute 'create function public.combat_v2_synergy(p_state jsonb, p_b jsonb) returns jsonb language sql immutable as ''select p_state''';
  end if;`;
const WORLD = String.raw`
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_hbp_admin', true);
  update hunts set status = 'expired' where status = 'active';
  select x.key, x.name into bk, bn from hunt_bosses_v2 x where exists (select 1 from unnest(x.weak_to) w join roles r on w = 'role:' || r.key where r.class = 'attacker') order by x.ord limit 1;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || bn, 'Heroic', '[]'::jsonb, 80000, 32000, now() - interval '1 hour', now() + interval '2 days', 'active') returning id into hid;
  cap := coalesce(balance_num('combat', 'effect_cap_pct'), 100);
  create temp table hbp_pool on commit drop as
    select distinct on (c.subject_id, c.rarity) c.id, c.rarity::text as rarity, s.type in ('Character', 'Creature') as att
      from cards c join subjects s on s.id = c.subject_id
     where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from roles x where x.key = s.ability_v2->>'role')
     order by c.subject_id, c.rarity, c.id;
  na := array(select id from hbp_pool where att and rarity = 'normal' order by id limit 12);
  sup := array(select id from hbp_pool where not att and rarity = 'normal' order by id limit 5);
  sq := na[1:4] || sup[1:2];
  insert into players (id, username) select z, 'tst ' || z from unnest(array[${[...TESTERS, ...MEMBERS, PRANK].map(lit).join(', ')}]) z;
  insert into player_cards (player_id, card_id, quantity) select p, c, 1 from unnest(array[${[...TESTERS, ...MEMBERS].map(lit).join(', ')}]) p, unnest(na || sup) c on conflict do nothing;
  update balance set value = jsonb_set(jsonb_set(value, '{testers}', ${lit(JSON.stringify(TESTERS))}::jsonb), '{hunt}', 'false') where key = 'combat_v2';
  create function pg_temp.all_true_s(p boolean, v boolean) returns boolean language sql immutable as $x$ select coalesce(p, true) and coalesce(v, false) $x$;
  create aggregate pg_temp.all_true(boolean) (sfunc = pg_temp.all_true_s, stype = boolean);
  create function pg_temp.flag(v boolean) returns void language sql as $x$ update balance set value = jsonb_set(value, '{hunt}', to_jsonb(v)) where key = 'combat_v2' $x$;
  -- one effect row, created age ago (a fixed order: now() is the same in the whole block)
  create function pg_temp.eff(p text, prim text, amt numeric, opt jsonb, age interval) returns bigint language sql as $x$
    insert into player_effects (player_id, primitive, amount, options, created_at, starts_at) values (p, prim, amt, opt, now() - age, now() - age - interval '1 minute') returning id $x$;
  -- the waiting rows of the 4 damage primitives, in the shape that hunt_v2_live_credit passes to the plan (the test rows have a real P and card)
  create function pg_temp.fx(p text) returns jsonb language sql as $x$
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'primitive', e.primitive, 'amount', coalesce(e.amount, 0), 'created_at', e.created_at, 'options', e.options) order by e.created_at, e.id), '[]'::jsonb)
      from player_effects e where e.player_id = p and e.primitive in ('rally', 'butterfingers', 'launch_party', 'raid_crasher') and e.consumed_at is null $x$;
  -- every effect row of a member (the unchanged checks)
  create function pg_temp.rows(p text) returns jsonb language sql as $x$
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'p', e.primitive, 'c', e.consumed_at, 'o', e.options) order by e.id), '[]'::jsonb) from player_effects e where e.player_id = p $x$;
  create function pg_temp.snap() returns jsonb language plpgsql as $x$
  declare out jsonb := '{}'; tb text; v jsonb;
  begin
    for tb in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'hunt_v2_days' order by 1 loop
      execute format('select jsonb_build_array(count(*), md5(coalesce(string_agg(t::text, %L order by t::text), %L))) from public.%I t', '|', '', tb) into v;
      out := out || jsonb_build_object(tb, v);
    end loop;
    return out;
  end $x$;
  -- the expected own credit of a raw per-card map (the R3-ON largest remainder rule, computed here, not by the function under test)
  create function pg_temp.lr(per jsonb) returns jsonb language sql as $x$
    with p as (select key as card, value::numeric as a from jsonb_each_text(per)), t as (select coalesce(round(sum(a)), 0)::bigint as total from p),
         fl as (select card, floor(a)::bigint as f, a - floor(a) as r from p), rk as (select card, f, row_number() over (order by r desc, card) as n from fl)
    select jsonb_build_object('total', (select total from t), 'cards', coalesce((select jsonb_object_agg(card, f + case when n <= (select total from t) - (select coalesce(sum(f), 0) from fl) then 1 else 0 end) from rk), '{}'::jsonb)) $x$;
  -- the raw expected credit of an answer log (the R3-ON spec rule from the answer log)
  create function pg_temp.expect(lg jsonb, squad jsonb, sc numeric) returns jsonb language sql as $x$
    with d as (select case when e->>'k' = 'act' and e->'actor'->>'side' = 'card' then e->'actor'->>'id' else squad->>0 end as card,
                      ((h->>'before')::numeric - (h->>'after')::numeric) * sc as amt
                 from jsonb_array_elements(coalesce(lg, '[]'::jsonb)) e, jsonb_array_elements(coalesce(e->'hp', '[]'::jsonb)) h
                where h->>'side' = 'enemy' and h->>'id' = '0' and (h->>'after')::numeric < (h->>'before')::numeric),
         per as (select card, sum(amt) a from d group by 1)
    select jsonb_build_object('raw', coalesce((select sum(a) from per), 0), 'total', coalesce((select round(sum(a)) from per), 0)::bigint) $x$;
  -- the scaled decreases of the hits of a log (INV-1: card acts with a decrease), in log order
  create function pg_temp.hits_of(lg jsonb, sc numeric) returns numeric[] language sql as $x$
    select coalesce(array_agg(d order by o), '{}') from (select o, (select sum((h->>'before')::numeric - (h->>'after')::numeric) from jsonb_array_elements(coalesce(e->'hp', '[]'::jsonb)) h
        where h->>'side' = 'enemy' and h->>'id' = '0' and (h->>'after')::numeric < (h->>'before')::numeric) * sc as d
      from jsonb_array_elements(coalesce(lg, '[]'::jsonb)) with ordinality q(e, o) where e->>'k' = 'act' and e->'actor'->>'side' = 'card') z where d > 0 $x$;
  create function pg_temp.vrow(p text) returns hunt_v2_days language sql as $x$ select * from hunt_v2_days where player_id = p and day = hunt_v2_today() order by started_at desc limit 1 $x$;
  create function pg_temp.hits(h bigint, p text) returns jsonb language sql as $x$
    select coalesce(jsonb_object_agg(card_id::text, damage), '{}'::jsonb) from hunt_hits where hunt_id = h and player_id = p $x$;
  create function pg_temp.sumj(j jsonb) returns numeric language sql immutable as $x$ select coalesce(sum(v::numeric), 0) from jsonb_each_text(coalesce(j, '{}'::jsonb)) q(k, v) $x$;
  create function pg_temp.xsum(j jsonb) returns bigint language sql immutable as $x$ select coalesce(sum((z->>'value')::bigint), 0) from jsonb_array_elements(coalesce(j, '[]'::jsonb)) z $x$;
  create function pg_temp.sc(p text) returns numeric language sql as $x$ select (select hp_max from hunts where id = d.hunt_id)::numeric / (d.state->'fight'->'enemies'->0->>'max')::numeric from hunt_v2_days d where d.player_id = p and d.day = hunt_v2_today() order by d.started_at desc limit 1 $x$;`;
const DECL = `res jsonb := '[]'; b jsonb; a jsonb; a2 jsonb; x jsonb; y jsonb; e jsonb; o jsonb; ok boolean; n int; i int; k int; t text; msg text;
  bk text; bn text; hid bigint; sq bigint[]; na bigint[]; sup bigint[]; rw public.hunt_v2_days; before jsonb; after jsonb; h0 bigint; h1 bigint;
  sh0 jsonb; sh1 jsonb; sc numeric; out jsonb; row0 jsonb; lg jsonb; c0 bigint; c1 bigint; cap numeric; L jsonb; sq3 jsonb; r1 bigint; r2 bigint; r3 bigint; r4 bigint;
  fx0 jsonb; pl jsonb; p0 bigint; p1 bigint; ca0 bigint; ca1 bigint; cl0 jsonb; cl1 jsonb; tc text; oc text; f jsonb; mx numeric; mo numeric; d0 jsonb; d1 jsonb;
  party_used int; crash_used int; rally_used int; hs numeric[]; native_on boolean`;
const block = (body) => String.raw`do $t$
#variable_conflict use_column
declare ${DECL};
begin
  ${PRE}
  native_on := ${NATIVE_ON};
  if native_on then execute $nu$${NATIVE_UNDO}$nu$; end if;
  execute $m$${mig}$m$;
  ${WORLD}
  ${body}
  raise exception 'RESULT:%', jsonb_build_object('rows', res)::text;
end $t$;`;
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;
const sub = (body) => String.raw`
  begin
    ${body}
    raise exception 'hbp_rollback';
  exception when others then if sqlerrm <> 'hbp_rollback' then res := res || jsonb_build_object('case', 'a sub-block raised', 'ok', false, 'got', to_jsonb(sqlerrm)); end if;
  end;`;

// ---------------------------------------------------------------------------------------------------------- B1: G-1 plan unit cases (pure)
// The fixed log (scale 1.5): hit 1 (card c1, decrease 10 -> 15), a tick (2 -> 3, to c1 = squad[0]), hit 2 (c2, 20 -> 30), an enemy act that
// decreases the boss HP (3 -> 4.5, to c1), a card act with no decrease (c3), hit 3 (c3, 30 -> 45). Base raw: c1 22.5, c2 30, c3 45.
const LOG_SQL = String.raw`
  sq3 := jsonb_build_array(sq[1]::text, sq[2]::text, sq[3]::text);
  L := jsonb_build_array(
    jsonb_build_object('k', 'act', 'actor', jsonb_build_object('side', 'card', 'id', sq[1]), 'hp', jsonb_build_array(jsonb_build_object('side', 'enemy', 'id', 0, 'before', 100, 'after', 90))),
    jsonb_build_object('k', 'clock', 'hp', jsonb_build_array(jsonb_build_object('side', 'enemy', 'id', 0, 'before', 90, 'after', 88))),
    jsonb_build_object('k', 'act', 'actor', jsonb_build_object('side', 'card', 'id', sq[2]), 'hp', jsonb_build_array(jsonb_build_object('side', 'enemy', 'id', 0, 'before', 88, 'after', 68))),
    jsonb_build_object('k', 'act', 'actor', jsonb_build_object('side', 'enemy', 'id', 0), 'hp', jsonb_build_array(jsonb_build_object('side', 'enemy', 'id', 0, 'before', 68, 'after', 65), jsonb_build_object('side', 'card', 'id', sq[1], 'before', 50, 'after', 40))),
    jsonb_build_object('k', 'act', 'actor', jsonb_build_object('side', 'card', 'id', sq[3]), 'hp', jsonb_build_array(jsonb_build_object('side', 'card', 'id', sq[3], 'before', 40, 'after', 45))),
    jsonb_build_object('k', 'act', 'actor', jsonb_build_object('side', 'card', 'id', sq[3]), 'hp', jsonb_build_array(jsonb_build_object('side', 'enemy', 'id', 0, 'before', 65, 'after', 35))));
  create function pg_temp.base(m1 numeric, m2 numeric, m3 numeric, c1 text, c2 text, c3 text) returns jsonb language sql immutable as $x$
    select pg_temp.lr(jsonb_build_object(c1, 15 * m1 + 3 + 4.5, c2, 30 * m2, c3, 45 * m3)) $x$;
  create function pg_temp.fxrow(i bigint, prim text, amt numeric, opt jsonb, age int) returns jsonb language sql immutable as $x$
    select jsonb_build_object('id', i, 'primitive', prim, 'amount', amt, 'options', opt, 'created_at', to_jsonb(timestamptz '2026-11-01 00:00:00+00' - make_interval(mins => age))) $x$;
  create function pg_temp.sumok(pl jsonb) returns boolean language sql immutable as $x$ select pg_temp.sumj(pl->'cards') = (pl->>'total')::numeric $x$;`;
const C = (i) => `sq[${i}]::text`;
const B1 = block(String.raw`
  ${LOG_SQL}
  -- (a) rally 20: only hit 1 x 1.2
  pl := hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(11, 'rally', 20, '{"uses": 1}', 10)), cap);
  ${add('G-1a rally 20: only hit 1 x 1.2 (total and cards = the expected largest remainder), the row used once (left 0), boons.rally 1',
    `pl->'total' = pg_temp.base(1.2, 1, 1, ${C(1)}, ${C(2)}, ${C(3)})->'total' and pl->'cards' = pg_temp.base(1.2, 1, 1, ${C(1)}, ${C(2)}, ${C(3)})->'cards'
     and pl->'uses' = '[{"id": 11, "left": 0, "used": 1, "primitive": "rally"}]'::jsonb and (pl->'boons'->>'rally')::int = 1 and pg_temp.sumok(pl)`, `jsonb_build_object('plan', pl, 'exp', pg_temp.base(1.2, 1, 1, ${C(1)}, ${C(2)}, ${C(3)}))`)}
  -- (b) butterfingers 15: only hit 1 x 0.85
  pl := hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(12, 'butterfingers', 15, '{}', 10)), cap);
  ${add('G-1b butterfingers 15: only hit 1 x 0.85, the row used once',
    `pl->'total' = pg_temp.base(0.85, 1, 1, ${C(1)}, ${C(2)}, ${C(3)})->'total' and pl->'cards' = pg_temp.base(0.85, 1, 1, ${C(1)}, ${C(2)}, ${C(3)})->'cards'
     and pl->'uses' = '[{"id": 12, "left": 0, "used": 1, "primitive": "butterfingers"}]'::jsonb and pg_temp.sumok(pl)`, `jsonb_build_object('plan', pl)`)}
  -- (c) all four on hit 1: own = 15 x 1.2 x 0.85 x 1.2 = 18.36; extra = greatest(1, round(18.36 x 0.25)) = 5 (from the FINAL value; the base 15 gives 4)
  pl := hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(21, 'rally', 20, '{}', 40), pg_temp.fxrow(22, 'butterfingers', 15, '{}', 30),
          pg_temp.fxrow(23, 'launch_party', 20, '{"uses": 1}', 20), pg_temp.fxrow(24, 'raid_crasher', 25, jsonb_build_object('uses', 1, 'credit_to', ${P}, 'card_id', 378), 10)), cap);
  ${add('G-1c rally + butterfingers + launch_party + raid_crasher on hit 1: own = base x 1.2 x 0.85 x 1.2 (18.36), extra = greatest(1, round(final x 0.25)) = 5 to (P, 378)',
    `pl->'total' = pg_temp.base(1.224, 1, 1, ${C(1)}, ${C(2)}, ${C(3)})->'total' and pl->'cards' = pg_temp.base(1.224, 1, 1, ${C(1)}, ${C(2)}, ${C(3)})->'cards'
     and jsonb_array_length(pl->'extras') = 1 and (pl->'extras'->0->>'value')::bigint = 5 and pl->'extras'->0->>'player' = ${P} and (pl->'extras'->0->>'card')::bigint = 378
     and (pl->'extras'->0->>'hits')::int = 1 and not (pl->'extras'->0->>'fallback')::boolean and jsonb_array_length(pl->'uses') = 4 and pg_temp.sumok(pl)`, `jsonb_build_object('plan', pl)`)}
  -- (d) launch_party rows uses 2 (older) and uses 8: hits 1-2 from row 1 (left 0), hit 3 from row 2 (left 7)
  pl := hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(32, 'launch_party', 20, '{"uses": 8}', 10), pg_temp.fxrow(31, 'launch_party', 20, '{"uses": 2}', 20)), cap);
  ${add('G-1d launch_party rows (uses 2 older, uses 8 newer): hits 1-2 from the older row (left 0), hit 3 from the newer row (left 7); every hit x 1.2',
    `pl->'cards' = pg_temp.base(1.2, 1.2, 1.2, ${C(1)}, ${C(2)}, ${C(3)})->'cards'
     and pl->'uses' @> '[{"id": 31, "used": 2, "left": 0}, {"id": 32, "used": 1, "left": 7}]'::jsonb and jsonb_array_length(pl->'uses') = 2 and (pl->'boons'->>'party_hits')::int = 3`, `jsonb_build_object('plan', pl)`)}
  -- (e) raid_crasher 25, uses 3, credit_to P, card 378: extras round(15 x .25) = 4, round(30 x .25) = 8, round(45 x .25) = 11 -> 23 in 3 hits
  pl := hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(41, 'raid_crasher', 25, jsonb_build_object('uses', 3, 'credit_to', ${P}, 'card_id', 378, 'sender_id', '1'), 10)), cap);
  ${add('G-1e raid_crasher 25 uses 3 (P, 378): per hit greatest(1, round(final x 0.25)) = 4 + 8 + 11 = 23 to (P, 378), hits 3, the own credit unchanged, the row left 0',
    `pl->'cards' = pg_temp.base(1, 1, 1, ${C(1)}, ${C(2)}, ${C(3)})->'cards' and jsonb_array_length(pl->'extras') = 1 and (pl->'extras'->0->>'value')::bigint = 23
     and pl->'extras'->0->>'player' = ${P} and (pl->'extras'->0->>'card')::bigint = 378 and (pl->'extras'->0->>'hits')::int = 3 and pl->'uses' @> '[{"id": 41, "left": 0, "used": 3}]'::jsonb`, `jsonb_build_object('plan', pl)`)}
  -- (f) raid_crasher with no owner (no credit_to, no sender_id), and one with no card_id: the extra to (the member = null here, the attacking card), fallback
  pl := hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(51, 'raid_crasher', 25, '{"uses": 3, "card_id": 378}', 10)), cap);
  a := hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(52, 'raid_crasher', 25, jsonb_build_object('uses', 3, 'credit_to', ${P}), 10)), cap);
  ${add('G-1f raid_crasher with no owner, and with no card: the extras go to the attacking card of each hit (player null = the member, set by hunt_v2_live_credit), fallback true (4 + 8 + 11)',
    `(select pg_temp.all_true(z->>'player' is null and (z->>'fallback')::boolean) from jsonb_array_elements((pl->'extras') || (a->'extras')) z)
     and (select jsonb_object_agg(z->>'card', (z->>'value')::int) from jsonb_array_elements(pl->'extras') z) = jsonb_build_object(${C(1)}, 4, ${C(2)}, 8, ${C(3)}, 11)
     and (select jsonb_object_agg(z->>'card', (z->>'value')::int) from jsonb_array_elements(a->'extras') z) = jsonb_build_object(${C(1)}, 4, ${C(2)}, 8, ${C(3)}, 11)`, `jsonb_build_object('no_owner', pl->'extras', 'no_card', a->'extras')`)}
  -- (g) only the tick, the enemy act and the 0-decrease card act (entries 2, 4, 5), with rally and launch_party waiting: nothing is used or boosted
  lg := jsonb_build_array(L->1, L->3, L->4);
  pl := hunt_v2_boon_plan(lg, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(61, 'rally', 20, '{}', 20), pg_temp.fxrow(62, 'launch_party', 20, '{"uses": 8}', 10)), cap);
  ${add('G-1g a tick, an enemy act and a card act with no decrease: no use, no boost (the credit = hunt_v2_credit of the same log)',
    `pl->'uses' = '[]'::jsonb and pl->'total' = hunt_v2_credit(lg, to_jsonb(sq), 1.5)->'total' and pl->'cards' = hunt_v2_credit(lg, to_jsonb(sq), 1.5)->'cards' and (pl->'boons'->>'rally')::int = 0`, `jsonb_build_object('plan', pl)`)}
  -- (h) amount 150 with cap 100: x 2 (not x 2.5)
  pl := hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(71, 'rally', 150, '{}', 10)), 100);
  ${add('G-1h rally amount 150 with cap 100: hit 1 x 2', `pl->'cards' = pg_temp.base(2, 1, 1, ${C(1)}, ${C(2)}, ${C(3)})->'cards'`, `jsonb_build_object('plan', pl)`)}
  -- (j) two rally rows (20 older, 10 newer): hit 1 uses the older, hit 2 the newer, hit 3 not boosted
  pl := hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(82, 'rally', 10, '{}', 10), pg_temp.fxrow(81, 'rally', 20, '{}', 20)), cap);
  ${add('G-1j two rally rows: hit 1 x 1.2 (the older row), hit 2 x 1.1 (the newer row), hit 3 not boosted; both rows left 0',
    `pl->'cards' = pg_temp.base(1.2, 1.1, 1, ${C(1)}, ${C(2)}, ${C(3)})->'cards' and pl->'uses' @> '[{"id": 81, "left": 0}, {"id": 82, "left": 0}]'::jsonb and (pl->'boons'->>'rally')::int = 2`, `jsonb_build_object('plan', pl)`)}
  -- (i) the sum of cards = total (every case above), and the no-row plan = hunt_v2_credit of the fixed log
  pl := hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, '[]'::jsonb, cap);
  ${add('G-1i sum of cards = total (no rows, rally, all four, launch_party); with no rows the plan = hunt_v2_credit',
    `pg_temp.sumok(pl) and pl->'total' = hunt_v2_credit(L, to_jsonb(sq), 1.5)->'total' and pl->'cards' = hunt_v2_credit(L, to_jsonb(sq), 1.5)->'cards'
     and pg_temp.sumok(hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(11, 'rally', 20, '{}', 10)), cap))
     and pg_temp.sumok(hunt_v2_boon_plan(L, to_jsonb(sq), 1.5, jsonb_build_array(pg_temp.fxrow(31, 'launch_party', 25, '{"uses": 9}', 10), pg_temp.fxrow(12, 'butterfingers', 7, '{}', 10)), cap))`, `jsonb_build_object('plan', pl)`)}
  -- (k) (integration through hunt_v2_live_credit) a raid_crasher whose credit_to has no players row, and one whose card_id has no cards row
  perform pg_temp.flag(true);
  ${sub(String.raw`
    a := hunt_v2_start(${M(1)}, sq); rw := pg_temp.vrow(${M(1)});
    r1 := pg_temp.eff(${M(1)}, 'raid_crasher', 25, '{"uses": 1, "credit_to": "900000000000099999", "card_id": 378}', interval '2 hours');
    r2 := pg_temp.eff(${M(1)}, 'raid_crasher', 25, jsonb_build_object('uses', 1, 'credit_to', ${P}, 'card_id', 999999999999), interval '1 hour');
    msg := null;
    begin x := hunt_v2_live_credit(hid, ${M(1)}, rw.day, L); exception when others then msg := sqlerrm; end;
    ${add('G-1k a raid_crasher with a credit_to that has no players row, and one with a card_id that has no cards row: no error; both extras go to the member on the attacking cards (hits 1, 2), fallback true; both rows consumed; reconcile 0',
      `msg is null and (a->>'ok')::boolean and (x->>'written')::boolean
       and (select count(*) from combat_actions ca where ca.ref_id = hid and ca.effect = 'raid_crasher' and ca.player_id = ${M(1)} and (ca.result->>'fallback')::boolean) = 2
       and not exists (select 1 from combat_actions ca where ca.ref_id = hid and ca.effect = 'raid_crasher' and ca.player_id <> ${M(1)})
       and (select count(*) from player_effects where id in (r1, r2) and consumed_at is not null) = 2
       and (select coalesce(sum(unexplained), 0) from hunt_damage_reconcile(hid)) = 0`,
      `jsonb_build_object('err', msg, 'start', a->'error', 'credit', x, 'ca', (select jsonb_agg(jsonb_build_object('p', player_id, 'c', card_id, 'r', result)) from combat_actions where ref_id = hid))`)}
  `)}
`);

// ---------------------------------------------------------------------------------------------------------- B2: G-2 (no-boon equality on real seeded logs)
const B2 = (from, to) => block(String.raw`
  perform pg_temp.flag(true);
  out := '[]';
  for i in ${from} .. ${to} loop
    begin
      perform setseed(i / 100.0);
      a := hunt_v2_start(${M(2)}, sq); rw := pg_temp.vrow(${M(2)}); sc := pg_temp.sc(${M(2)});
      lg := a->'log';
      for n in 1 .. 4 loop
        if lg is not null and jsonb_array_length(lg) > 0 then
          out := out || jsonb_build_array(jsonb_build_object('seed', i, 'call', n, 'eq', hunt_v2_boon_plan(lg, to_jsonb(rw.squad), sc, '[]'::jsonb, cap)->'total' = hunt_v2_credit(lg, to_jsonb(rw.squad), sc)->'total'
            and hunt_v2_boon_plan(lg, to_jsonb(rw.squad), sc, '[]'::jsonb, cap)->'cards' = hunt_v2_credit(lg, to_jsonb(rw.squad), sc)->'cards', 'total', hunt_v2_credit(lg, to_jsonb(rw.squad), sc)->'total'));
        end if;
        exit when (pg_temp.vrow(${M(2)})).status = 'over' or n = 4;
        x := case when n < 3 then hunt_v2_auto(${M(2)}, 3) else hunt_v2_auto(${M(2)}, 1000) end;
        exit when not (x->>'ok')::boolean;
        lg := x->'log';
      end loop;
      raise exception 'hbp_rollback';
    exception when others then if sqlerrm <> 'hbp_rollback' then out := out || jsonb_build_array(jsonb_build_object('seed', i, 'raised', sqlerrm)); end if;
    end;
  end loop;
  res := out;
`);

// ---------------------------------------------------------------------------------------------------------- B3: G-3 live integration (seeded)
const B3 = (from, to) => block(String.raw`
  perform pg_temp.flag(true);
  out := '[]';
  for i in ${from} .. ${to} loop
    begin
      perform setseed(i / 100.0);
      a := hunt_v2_start(${M(3)}, sq); rw := pg_temp.vrow(${M(3)}); sc := pg_temp.sc(${M(3)});
      r1 := pg_temp.eff(${M(3)}, 'rally', 20, '{"uses": 1}', interval '3 hours');
      r2 := pg_temp.eff(${M(3)}, 'launch_party', 20, '{"uses": 8}', interval '2 hours');
      r3 := pg_temp.eff(${M(3)}, 'raid_crasher', 25, jsonb_build_object('uses', 3, 'credit_to', ${P}, 'card_id', 378, 'sender_id', ${P}), interval '1 hour');
      row0 := jsonb_build_object('seed', i, 'calls', 0, 'bad', '[]'::jsonb, 'hits', 0, 'extras', 0);
      party_used := 0; crash_used := 0; rally_used := 0;
      for n in 1 .. 3 loop
        exit when (pg_temp.vrow(${M(3)})).status = 'over';
        fx0 := pg_temp.fx(${M(3)});
        c0 := (pg_temp.vrow(${M(3)})).credited; h0 := (select hp_remaining from hunts where id = hid); sh0 := pg_temp.hits(hid, ${M(3)});
        cl0 := (select coalesce(jsonb_object_agg(card_id::text, s), '{}'::jsonb) from (select card_id, sum(damage) s from hunt_combat_log where hunt_id = hid and player_id = ${M(3)} group by 1) z);
        p0 := (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid and player_id = ${P} and card_id = 378 and hit_date = rw.day);
        ca0 := (select count(*) from combat_actions where ref_id = hid and effect = 'raid_crasher');
        x := case when n < 3 then hunt_v2_auto(${M(3)}, 3) else hunt_v2_auto(${M(3)}, 1000) end;
        if not (x->>'ok')::boolean then row0 := jsonb_set(row0, '{bad}', (row0->'bad') || jsonb_build_object('err', x->'error')); exit; end if;
        pl := hunt_v2_boon_plan(x->'log', to_jsonb(rw.squad), sc, fx0, cap);
        c1 := (pg_temp.vrow(${M(3)})).credited; h1 := (select hp_remaining from hunts where id = hid); sh1 := pg_temp.hits(hid, ${M(3)});
        cl1 := (select coalesce(jsonb_object_agg(card_id::text, s), '{}'::jsonb) from (select card_id, sum(damage) s from hunt_combat_log where hunt_id = hid and player_id = ${M(3)} group by 1) z);
        p1 := (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid and player_id = ${P} and card_id = 378 and hit_date = rw.day);
        ca1 := (select count(*) from combat_actions where ref_id = hid and effect = 'raid_crasher');
        party_used := party_used + (pl->'boons'->>'party_hits')::int; crash_used := crash_used + (pl->'boons'->>'crash_hits')::int; rally_used := rally_used + (pl->'boons'->>'rally')::int;
        e := jsonb_build_object(
          'a', c1 - c0 = (pl->>'total')::bigint,
          'b', h0 - h1 = (pl->>'total')::bigint + pg_temp.xsum(pl->'extras'),
          'c', coalesce((select pg_temp.all_true(coalesce((sh1->>k)::bigint, 0) - coalesce((sh0->>k)::bigint, 0) = (pl->'cards'->>k)::bigint
                   and coalesce((cl1->>k)::bigint, 0) - coalesce((cl0->>k)::bigint, 0) = (pl->'cards'->>k)::bigint) from jsonb_object_keys(pl->'cards') k), true)
               and pg_temp.sumj(sh1) - pg_temp.sumj(sh0) = (pl->>'total')::numeric,
          'd', p1 - p0 = pg_temp.xsum(pl->'extras'),
          'e', case when pg_temp.xsum(pl->'extras') > 0 then ca1 - ca0 = 1 and exists (select 1 from combat_actions ca where ca.ref_id = hid and ca.mode = 'hunt' and ca.effect = 'raid_crasher' and ca.kind = 'effect'
                     and ca.player_id = ${P} and ca.card_id = 378 and (ca.result->>'value')::bigint = pg_temp.xsum(pl->'extras') and (ca.result->>'hits')::int = (pl->'boons'->>'crash_hits')::int
                     and ca.id = (select max(id) from combat_actions where ref_id = hid)) else ca1 = ca0 end,
          'f', ((select consumed_at is not null from player_effects where id = r1) = (rally_used > 0))
               and (case when party_used >= 8 then (select consumed_at is not null from player_effects where id = r2) else (select (options->>'uses')::int = 8 - party_used and consumed_at is null from player_effects where id = r2) end)
               and (case when crash_used >= 3 then (select consumed_at is not null from player_effects where id = r3) else (select (options->>'uses')::int = 3 - crash_used and consumed_at is null from player_effects where id = r3) end),
          'g', (select coalesce(sum(abs(unexplained)), 0) from hunt_damage_reconcile(hid)) = 0);
        if not (select pg_temp.all_true(v::boolean) from jsonb_each_text(e) q(k, v)) then
          row0 := jsonb_set(row0, '{bad}', (row0->'bad') || jsonb_build_object('call', n, 'checks', e, 'plan', pl - 'cards', 'credited', c1 - c0, 'hp', h0 - h1, 'p', p1 - p0, 'ca', ca1 - ca0));
        end if;
        row0 := row0 || jsonb_build_object('calls', n, 'hits', (row0->>'hits')::int + (pl->'boons'->>'party_hits')::int + greatest(0, 0), 'extras', (row0->>'extras')::bigint + pg_temp.xsum(pl->'extras'),
          'rally', rally_used, 'party', party_used, 'crash', crash_used);
      end loop;
      out := out || jsonb_build_array(row0);
      raise exception 'hbp_rollback';
    exception when others then if sqlerrm <> 'hbp_rollback' then out := out || jsonb_build_array(jsonb_build_object('seed', i, 'raised', sqlerrm)); end if;
    end;
  end loop;
  res := out;
`);

// ---------------------------------------------------------------------------------------------------------- B4: G-4 .. G-9
const B4 = block(String.raw`
  -- G-4 P-1 exact: one rally 20; one call with hits: credited = the no-boon credit + 20 % of hit 1 (+-1); the row consumed
  perform pg_temp.flag(true);
  out := '[]';
  for i in 1 .. 6 loop
    begin
      perform setseed(i / 50.0);
      a := hunt_v2_start(${M(4)}, sq); sc := pg_temp.sc(${M(4)});
      r1 := pg_temp.eff(${M(4)}, 'rally', 20, '{"uses": 1}', interval '1 hour');
      c0 := (pg_temp.vrow(${M(4)})).credited;
      x := hunt_v2_auto(${M(4)}, 1000);
      c1 := (pg_temp.vrow(${M(4)})).credited;
      hs := pg_temp.hits_of(x->'log', sc);
      out := out || jsonb_build_array(jsonb_build_object('seed', i, 'hits', cardinality(hs), 'ok', cardinality(hs) = 0 or (abs((c1 - c0) - ((pg_temp.expect(x->'log', to_jsonb((pg_temp.vrow(${M(4)})).squad), sc)->>'raw')::numeric + 0.2 * hs[1])) <= 1
        and (select consumed_at is not null from player_effects where id = r1)), 'delta', c1 - c0, 'raw', pg_temp.expect(x->'log', to_jsonb((pg_temp.vrow(${M(4)})).squad), sc)->'raw', 'h1', hs[1], 'h2', hs[2]));
      raise exception 'hbp_rollback';
    exception when others then if sqlerrm <> 'hbp_rollback' then out := out || jsonb_build_array(jsonb_build_object('seed', i, 'ok', false, 'raised', sqlerrm)); end if;
    end;
  end loop;
  ${add('G-4 P-1: one rally 20 and one Auto call with hits (6 seeds): credited = the no-boon credit of the log + 20 % of the scaled hit 1 (+-1), the row consumed; at least 3 calls with 2+ hits',
    `(select pg_temp.all_true((z->>'ok')::boolean) from jsonb_array_elements(out) z) and (select count(*) from jsonb_array_elements(out) z where (z->>'hits')::int >= 2) >= 3`, 'out')}
  -- G-5 practice day (flag OFF, tester): a full Auto day changes no row (effect rows included) but hunt_v2_days
  perform pg_temp.flag(false);
  ${sub(String.raw`
    r1 := pg_temp.eff(${T(1)}, 'rally', 20, '{}', interval '4 hours'); r2 := pg_temp.eff(${T(1)}, 'launch_party', 20, '{"uses": 8}', interval '3 hours');
    r3 := pg_temp.eff(${T(1)}, 'raid_crasher', 25, jsonb_build_object('uses', 3, 'credit_to', ${P}, 'card_id', 378), interval '2 hours'); r4 := pg_temp.eff(${T(1)}, 'mend', 20, '{}', interval '1 hour');
    before := pg_temp.snap();
    a := hunt_v2_start(${T(1)}, sq); x := hunt_v2_auto(${T(1)}, 1000);
    after := pg_temp.snap();
    ${add('G-5 practice day (flag OFF, tester, live false): a full Auto day leaves the 4 waiting rows (rally, launch_party, raid_crasher, mend) and every shared row unchanged',
      `(a->>'ok')::boolean and (x->>'ok')::boolean and not (pg_temp.vrow(${T(1)})).live and before = after`,
      `jsonb_build_object('diff', (select jsonb_agg(q.key) from jsonb_each(before) q where after->q.key is distinct from q.value), 'err', coalesce(a->'error', x->'error'))`)}
  `)}
  -- G-6 closed Hunt: a planted wrapper of dungeon_v2_play sets the Hunt defeated after the play (another member's defeat); the shared write answers over
  perform pg_temp.flag(true);
  ${sub(String.raw`
    a := hunt_v2_start(${M(5)}, sq);
    r1 := pg_temp.eff(${M(5)}, 'rally', 20, '{}', interval '4 hours'); r2 := pg_temp.eff(${M(5)}, 'launch_party', 20, '{"uses": 8}', interval '3 hours');
    r3 := pg_temp.eff(${M(5)}, 'raid_crasher', 25, jsonb_build_object('uses', 3, 'credit_to', ${P}, 'card_id', 378), interval '2 hours'); r4 := pg_temp.eff(${M(5)}, 'mend', 20, '{}', interval '1 hour');
    -- the card with the turn hurt (so a mend could apply)
    update hunt_v2_days set state = jsonb_set(state, array['fight', 'cards', state->'fight'->'ext'->'turn'->>'id', 'hp'], to_jsonb(((state->'fight'->'cards'->(state->'fight'->'ext'->'turn'->>'id')->>'max')::numeric) / 2))
     where player_id = ${M(5)} and day = hunt_v2_today();
    d0 := pg_temp.rows(${M(5)});
    alter function public.dungeon_v2_play(jsonb, jsonb, integer, jsonb) rename to hbp_real_play;
    execute 'create function public.dungeon_v2_play(p_fight jsonb, p_choice jsonb, p_max integer, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $w$
      declare r jsonb := public.hbp_real_play(p_fight, p_choice, p_max, p_b); begin update public.hunts set status = ''defeated'', defeated_at = now() where status = ''active''; return r; end $w$';
    x := hunt_v2_auto(${M(5)}, 1000);
    ${add('G-6 closed Hunt (the Hunt is defeated between the play and the shared write): the shared write answers over, every waiting row (rally, launch_party uses, raid_crasher uses, mend) unchanged',
      `coalesce((x->'credit'->>'over')::boolean, false) and pg_temp.rows(${M(5)}) = d0 and pg_temp.expect(x->'log', to_jsonb(sq), 1)->>'total' <> '0'`,
      `jsonb_build_object('credit', x->'credit', 'err', x->'error', 'before', d0, 'after', pg_temp.rows(${M(5)}))`)}
  `)}
  -- G-7 v1 unchanged after the file
  ${add(`G-7 v1 unchanged after the file: md5 hunt_attack = ${V1_MD5.attack}, hunt_support = ${V1_MD5.support}`,
    `md5(replace(pg_get_functiondef('public.hunt_attack(text, bigint, bigint)'::regprocedure), chr(13), '')) = '${V1_MD5.attack}'
     and md5(replace(pg_get_functiondef('public.hunt_support(text, bigint, bigint, bigint)'::regprocedure), chr(13), '')) = '${V1_MD5.support}'`,
    `jsonb_build_object('attack', md5(replace(pg_get_functiondef('public.hunt_attack(text, bigint, bigint)'::regprocedure), chr(13), '')), 'support', md5(replace(pg_get_functiondef('public.hunt_support(text, bigint, bigint, bigint)'::regprocedure), chr(13), '')))`)}
  -- G-8 the guard, idempotence, the undo, the grants
  msg := null;
  begin
    execute replace(pg_get_functiondef('public.hunt_v2_shared(bigint, text, date, jsonb)'::regprocedure), 'AS $function$', 'AS $function$ ');
    begin execute $m$${mig}$m$; exception when others then msg := sqlerrm; end;
    raise exception 'hbp_rollback';
  exception when others then if sqlerrm <> 'hbp_rollback' then msg := 'the plant raised: ' || sqlerrm; end if;
  end;
  ${add('G-8a the guard: a foreign hunt_v2_shared text (one space added) makes the file refuse (raise, no change)', `msg like '%changed since this file was built%'`, 'to_jsonb(msg)')}
  o := (select jsonb_object_agg(z, md5(replace(pg_get_functiondef(('public.' || z)::regprocedure), chr(13), ''))) from unnest(array[${FN4.map(lit).join(', ')}]) z);
  msg := null;
  -- the second run of the text that is applied now: its guard accepts that text (for a mutated text the md5 of the file is replaced by the
  -- md5 of the mutated text, so G-8b tests idempotence and does not catch every mutation of a guarded function)
  begin execute ${GUARD_NEW.map(([fn, m]) => `replace(`).join('')}$m$${mig}$m$${GUARD_NEW.map(([fn, m]) => `, '${m}', md5(replace(pg_get_functiondef('public.${fn}'::regprocedure), chr(13), '')))`).join('')}; exception when others then msg := sqlerrm; end;
  ${add('G-8b a second run: no error, the 4 functions unchanged (md5)', `msg is null and o = (select jsonb_object_agg(z, md5(replace(pg_get_functiondef(('public.' || z)::regprocedure), chr(13), ''))) from unnest(array[${FN4.map(lit).join(', ')}]) z)`, `jsonb_build_object('err', msg, 'md5', o)`)}
  msg := null;
  begin
    begin execute $m$${undo}$m$; exception when others then msg := sqlerrm; end;
    a := jsonb_build_object('turns', md5(replace(pg_get_functiondef('public.hunt_v2_turns(text, jsonb, boolean, integer)'::regprocedure), chr(13), '')),
      'shared', md5(replace(pg_get_functiondef('public.hunt_v2_shared(bigint, text, date, jsonb)'::regprocedure), chr(13), '')),
      'live', md5(replace(pg_get_functiondef('public.hunt_v2_live_credit(bigint, text, date, jsonb)'::regprocedure), chr(13), '')),
      'plan', to_regprocedure('public.hunt_v2_boon_plan(jsonb, jsonb, numeric, jsonb, numeric)') is not null);
    raise exception 'hbp_rollback';
  exception when others then if sqlerrm <> 'hbp_rollback' then msg := 'the undo block raised: ' || sqlerrm; end if;
  end;
  ${add('G-8c the undo file: no error, the 3 R3-ON md5s exactly, hunt_v2_boon_plan dropped',
    `msg is null and a = '${JSON.stringify({ turns: R3ON_MD5.turns, shared: R3ON_MD5.shared, live: R3ON_MD5.live, plan: false })}'::jsonb`, `jsonb_build_object('err', msg, 'after', a)`)}
  ${add('G-8d the grants: anon and authenticated have no EXECUTE on the 4 functions; service_role has it; a [combat] comment that names the file',
    `(select pg_temp.all_true(not has_function_privilege('anon', z::regprocedure, 'EXECUTE') and not has_function_privilege('authenticated', z::regprocedure, 'EXECUTE')
        and has_function_privilege('service_role', z::regprocedure, 'EXECUTE') and coalesce(obj_description(z::regprocedure, 'pg_proc'), '') like '[combat]%combat_v2_hunt_boons.sql%')
       from unnest(array[${FN4.map(lit).join(', ')}]) z)`)}
  -- G-9 flag OFF (rollback, HO9)
  ${sub(String.raw`
    perform pg_temp.flag(true);
    a := hunt_v2_start(${M(6)}, sq);
    r1 := pg_temp.eff(${M(6)}, 'rally', 20, '{}', interval '2 hours'); r2 := pg_temp.eff(${M(6)}, 'launch_party', 20, '{"uses": 8}', interval '1 hour');
    perform pg_temp.flag(false);
    c0 := (pg_temp.vrow(${M(6)})).credited;
    x := hunt_v2_auto(${M(6)}, 1000);
    ${add('G-9a a live day started with the flag ON keeps crediting AND using boons after the flag goes OFF (rally consumed, launch_party uses < 8)',
      `(a->>'ok')::boolean and (pg_temp.vrow(${M(6)})).live and (pg_temp.vrow(${M(6)})).credited > c0
       and (select consumed_at is not null from player_effects where id = r1) and (select consumed_at is not null or (options->>'uses')::int < 8 from player_effects where id = r2)`,
      `jsonb_build_object('credit', x->'credit', 'rows', pg_temp.rows(${M(6)}))`)}
    a := hunt_v2_start(${M(7)}, sq);
    ${add('G-9b a new start with the flag OFF (not a tester): not_tester (v1)', `a->>'error' = 'not_tester'`, 'a')}
    out := '[]'; ok := false;
    for k in 8 .. 14 loop
      r1 := pg_temp.eff(${lit(MEMBERS[0]).slice(0, -3)}' || lpad(k::text, 2, '0'), 'rally', 20, '{}', interval '1 hour');
      x := hunt_attack(${lit(MEMBERS[0]).slice(0, -3)}' || lpad(k::text, 2, '0'), hid, na[1]);
      out := out || jsonb_build_array(jsonb_build_object('k', k, 'ok', x->'ok', 'err', x->'error', 'outcome', x->'outcome', 'consumed', (select consumed_at is not null from player_effects where id = r1)));
      if (x->>'ok')::boolean and coalesce(x->>'outcome', '') <> 'miss' then ok := (select consumed_at is not null from player_effects where id = r1); exit; end if;
    end loop;
    ${add('G-9c a v1 hunt_attack with the flag OFF (no v2 day) consumes a waiting rally as before (the first attack that is not a miss)', 'ok', 'out')}
  `)}
`);

// ---------------------------------------------------------------------------------------------------------- B5: G-11 mend
// set-up of one case: a live (or practice) day of member p; the card with the turn at hp = frac x max; another up card at 10 % (more hurt, so
// mend_any_card heals a different card); one mend 20 row; a capture wrapper of dungeon_v2_play keeps the fight it receives
const MEND_SETUP = (p, frac) => String.raw`
    a := hunt_v2_start(${p}, sq);
    rw := pg_temp.vrow(${p}); f := rw.state->'fight'; tc := f->'ext'->'turn'->>'id';
    oc := (select q.key from jsonb_each(f->'cards') q where q.key <> tc and combat_v2_up(q.value) order by q.key limit 1);
    mx := (f->'cards'->tc->>'max')::numeric; mo := (f->'cards'->oc->>'max')::numeric;
    update hunt_v2_days set state = jsonb_set(jsonb_set(state, array['fight', 'cards', tc, 'hp'], to_jsonb(mx * ${frac})), array['fight', 'cards', oc, 'hp'], to_jsonb(mo * 0.1))
     where player_id = ${p} and day = hunt_v2_today();
    r4 := pg_temp.eff(${p}, 'mend', 20, '{}', interval '1 hour');
    d0 := pg_temp.rows(${p});`;
const CAPTURE = String.raw`
    create temp table if not exists hbp_cap (f jsonb) on commit drop;
    alter function public.dungeon_v2_play(jsonb, jsonb, integer, jsonb) rename to hbp_real_play;
    execute 'create function public.dungeon_v2_play(p_fight jsonb, p_choice jsonb, p_max integer, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $w$
      begin insert into hbp_cap values (p_fight); return public.hbp_real_play(p_fight, p_choice, p_max, p_b); end $w$';`;
const B5 = block(String.raw`
  perform pg_temp.flag(true);
  -- (a) the card with the turn at 50 %, mend 20: hp = 0.5 max + 0.2 max (the fight that is played), the other card unchanged, the row consumed, answer mend
  ${sub(String.raw`
    ${MEND_SETUP(M(10), 0.5)}
    ${CAPTURE}
    x := hunt_v2_auto(${M(10)}, 1);
    y := (select hbp_cap.f from hbp_cap limit 1);
    ${add('G-11a the card with the turn hurt (50 % of max), mend 20: the played fight has its hp = 0.5 max + 0.2 max, the more hurt other card unchanged, the row consumed, answer mend = 0.2 max',
      `(x->>'ok')::boolean and (y->'cards'->tc->>'hp')::numeric = mx * 0.5 + mx * 0.2 and (y->'cards'->oc->>'hp')::numeric = mo * 0.1
       and (select consumed_at is not null from player_effects where id = r4) and (x->>'mend')::numeric = mx * 0.2`,
      `jsonb_build_object('hp', y->'cards'->tc->'hp', 'max', mx, 'other', y->'cards'->oc->'hp', 'mend', x->'mend', 'err', x->'error', 'rows', pg_temp.rows(${M(10)}))`)}
  `)}
  -- (b) the card with the turn not hurt: the row unchanged
  ${sub(String.raw`
    ${MEND_SETUP(M(11), 1)}
    x := hunt_v2_auto(${M(11)}, 1);
    ${add('G-11b the card with the turn not hurt (hp = max; another card hurt): the mend row unchanged, answer mend null', `(x->>'ok')::boolean and pg_temp.rows(${M(11)}) = d0 and x->'mend' = 'null'::jsonb`, `jsonb_build_object('mend', x->'mend', 'err', x->'error')`)}
  `)}
  -- (c) the unit with the turn is down, or is the boss
  ${sub(String.raw`
    ${MEND_SETUP(M(12), 0.5)}
    update hunt_v2_days set state = jsonb_set(jsonb_set(state, array['fight', 'cards', tc, 'down'], 'true'), array['fight', 'cards', tc, 'hp'], '0') where player_id = ${M(12)} and day = hunt_v2_today();
    begin x := hunt_v2_auto(${M(12)}, 1); exception when others then x := jsonb_build_object('raised', sqlerrm); end;
    ok := pg_temp.rows(${M(12)}) = d0;
    update hunt_v2_days set state = jsonb_set(jsonb_set(state, array['fight', 'cards', tc, 'down'], 'false'), array['fight', 'cards', tc, 'hp'], to_jsonb(mx * 0.5)) where player_id = ${M(12)} and day = hunt_v2_today();
    update hunt_v2_days set state = jsonb_set(state, '{fight,ext,turn}', '{"side": "enemy", "id": 0}') where player_id = ${M(12)} and day = hunt_v2_today();
    begin y := hunt_v2_auto(${M(12)}, 1); exception when others then y := jsonb_build_object('raised', sqlerrm); end;
    ${add('G-11c the unit with the turn is down (hp 0), or is the boss: the mend row unchanged', `ok and pg_temp.rows(${M(12)}) = d0`, `jsonb_build_object('down', coalesce(x->'error', x->'raised'), 'boss', coalesce(y->'error', y->'raised'))`)}
  `)}
  -- (d) practice day
  perform pg_temp.flag(false);
  ${sub(String.raw`
    ${MEND_SETUP(T(2), 0.5)}
    x := hunt_v2_auto(${T(2)}, 1);
    ${add('G-11d practice day (tester, flag OFF), the card with the turn hurt: the mend row unchanged', `(a->>'ok')::boolean and not rw.live and (x->>'ok')::boolean and pg_temp.rows(${T(2)}) = d0`, `jsonb_build_object('err', coalesce(a->'error', x->'error'))`)}
  `)}
  perform pg_temp.flag(true);
  -- (e) closed Hunt
  ${sub(String.raw`
    ${MEND_SETUP(M(13), 0.5)}
    update hunts set status = 'expired' where id = hid;
    x := hunt_v2_auto(${M(13)}, 1);
    ${add('G-11e closed Hunt: hunt_over, the mend row unchanged', `x->>'error' = 'hunt_over' and pg_temp.rows(${M(13)}) = d0`, `jsonb_build_object('x', x)`)}
  `)}
  -- (f) an invalid Act choice: bad_choice, the row unchanged, the saved fight unchanged
  ${sub(String.raw`
    ${MEND_SETUP(M(14), 0.5)}
    f := (pg_temp.vrow(${M(14)})).state;
    x := hunt_v2_act(${M(14)}, '{"use": "zzz"}'::jsonb);
    ${add('G-11f the card with the turn hurt, mend waiting, an INVALID Act choice: bad_choice, the mend row unchanged, the saved fight unchanged',
      `x->>'error' = 'bad_choice' and pg_temp.rows(${M(14)}) = d0 and (pg_temp.vrow(${M(14)})).state = f`, `jsonb_build_object('x', x, 'rows', pg_temp.rows(${M(14)}))`)}
  `)}
  -- (g) the shared write answers over (a planted wrapper sets the Hunt defeated after the play: the defeat race of another member)
  ${sub(String.raw`
    ${MEND_SETUP(M(15), 0.5)}
    alter function public.dungeon_v2_play(jsonb, jsonb, integer, jsonb) rename to hbp_real_play;
    execute 'create function public.dungeon_v2_play(p_fight jsonb, p_choice jsonb, p_max integer, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $w$
      declare r jsonb := public.hbp_real_play(p_fight, p_choice, p_max, p_b); begin update public.hunts set status = ''defeated'', defeated_at = now() where status = ''active''; return r; end $w$';
    x := hunt_v2_auto(${M(15)}, 1000);
    ${add('G-11g the card with the turn hurt, mend waiting, the shared write answers over (the Hunt is defeated by another member during the call): the mend row unchanged',
      `coalesce((x->'credit'->>'over')::boolean, false) and pg_temp.rows(${M(15)}) = d0`, `jsonb_build_object('credit', x->'credit', 'err', x->'error', 'rows', pg_temp.rows(${M(15)}))`)}
  `)}
`);

// ---------------------------------------------------------------------------------------------------------- H: G-10 (two real connections)
// The R3-ON H method: real requests on pooled connections, a COMMITTED sample (members 0450x, the prankster 04599, sample Hunts marked
// weak_points ["hbp_h_sample"], the flag combat_v2.hunt ON), removed in a finally step (0 rows left is checked; the flag back to OFF only when
// this harness set it). The copy must have this file applied. A G-10 mutation applies the mutated file first; the finally step applies the clean file.
const HP = Array.from({ length: 200 }, (_, i) => id('045', i + 1));
const HPR = id('045', 99) + '9';   // the prankster of the H cases (a players row; owns card 378)
const HMARK = '["hbp_h_sample"]';
const HBY = 'hbp-h-test';
async function hq(sql) {
  const { rawQuery } = await import('./lab-lib.mjs');
  const t = await rawQuery(sql);
  let j; try { j = JSON.parse(t); } catch { return { error: t }; }
  if (!Array.isArray(j)) return { error: j.message || j.error || t, code: (String(j.message || '').match(/ERROR:\s+([0-9A-Z]{5}):/) || [])[1] };
  return { rows: j };
}
const HL = (s) => lit(s);
const hCleanup = String.raw`do $x$
declare tb text;
begin
  perform set_config('balance.by', '${HBY}', true);
  if exists (select 1 from public.balance_log where changed_by = '${HBY}') then
    update public.balance set value = jsonb_set(value, '{hunt}', 'false') where key = 'combat_v2' and value->'hunt' = 'true'::jsonb;
  end if;
  delete from public.balance_log where changed_by = '${HBY}';
  for tb in select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
             where c.table_schema = 'public' and c.column_name = 'player_id' and t.table_type = 'BASE TABLE' and c.table_name <> 'players' loop
    execute format('delete from public.%I where player_id = any(%L::text[])', tb, array[${[...HP, HPR].map(HL).join(', ')}]);
  end loop;
  delete from public.hunt_events where hunt_id in (select id from public.hunts where weak_points = '${HMARK}'::jsonb);
  delete from public.hunt_hits where hunt_id in (select id from public.hunts where weak_points = '${HMARK}'::jsonb);
  delete from public.combat_actions where mode = 'hunt' and ref_id in (select id from public.hunts where weak_points = '${HMARK}'::jsonb);
  delete from public.hunts where weak_points = '${HMARK}'::jsonb;
  delete from public.players where id = any(array[${[...HP, HPR].map(HL).join(', ')}]);
  if to_regprocedure('public.hbp_h_real_step(jsonb, jsonb, jsonb)') is not null then
    drop function public.combat_v2_step(jsonb, jsonb, jsonb);
    alter function public.hbp_h_real_step(jsonb, jsonb, jsonb) rename to combat_v2_step;
  end if;
  if to_regprocedure('public.hbp_h_real_out(bigint, text, date, jsonb)') is not null then
    drop function public.hunt_v2_out(bigint, text, date, jsonb);
    alter function public.hbp_h_real_out(bigint, text, date, jsonb) rename to hunt_v2_out;
  end if;
  drop sequence if exists public.hbp_h_seq;
  if to_regprocedure('public.hbp_h_synstub()') is not null then
    drop function public.combat_v2_synergy(jsonb, jsonb); drop function public.hbp_h_synstub();
  end if;
end $x$;`;
const hTimed = (call, timeout = true) => `/* hbp_B */ with z as materialized (select ${timeout ? "set_config('lock_timeout', '500ms', true)" : "''::text"} v), s as materialized (select ${call} r from z) select s.r, round(extract(epoch from clock_timestamp() - statement_timestamp()) * 1000)::int as server_ms, clock_timestamp() as b_end from s;`;
const hHold = (call) => `/* hbp_A */ with a as materialized (select ${call} r) select a.r, pg_sleep(3) as s, clock_timestamp() as a_end from a;`;
const hLockThen = (lock, call) => `/* hbp_A */ do $h$ begin ${lock} perform pg_sleep(1.5); perform ${call}; end $h$; select clock_timestamp() as a_end;`;
const hSeenA = String.raw`do $x$ declare k int := 0; begin
  loop
    perform pg_stat_clear_snapshot();
    exit when exists (select 1 from pg_stat_activity a where a.pid <> pg_backend_pid() and a.wait_event = 'PgSleep' and a.backend_xid is not null and a.query like '%/* hbp_A */%');
    k := k + 1; if k > 300 then raise exception 'A did not hold its lock within 15 s'; end if;
    perform pg_sleep(0.05);
  end loop; end $x$; select 1 as held;`;
const SQ_SQL = `(select array_agg(card_id order by card_id) from public.player_cards where player_id = ${HL(HP[0])})`;
const SQP_SQL = `(select array_agg(card_id order by card_id) from public.player_cards where player_id = ${HL(HPR)})`;
const hNewHunt = (hp) => String.raw`do $x$ begin
  update public.hunts set status = 'expired' where weak_points = '${HMARK}'::jsonb and status = 'active';
  insert into public.hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || (select x.name from public.hunt_bosses_v2 x order by x.ord limit 1), 'Heroic', '${HMARK}'::jsonb, 80000, ${hp}, now() + interval '1 hour', now() + interval '2 days', 'active');
end $x$; select (select id from public.hunts where weak_points = '${HMARK}'::jsonb and status = 'active') as hunt;`;
const hTough = (p) => `update public.hunt_v2_days set state = jsonb_set(state, '{fight,cards}', (select jsonb_object_agg(q.key, q.value || jsonb_build_object('hp', (q.value->>'max')::numeric * 100, 'max', (q.value->>'max')::numeric * 100)) from jsonb_each(state->'fight'->'cards') q)) where player_id = ${HL(p)} and status = 'active';`;
const hEff = (p, prim, amt, opt) => `insert into public.player_effects (player_id, primitive, amount, options, created_at, starts_at) values (${HL(p)}, '${prim}', ${amt}, '${JSON.stringify(opt)}'::jsonb, clock_timestamp(), now() - interval '1 minute') returning id;`;
const retryCall = async (sql) => {
  let r = await hq(sql); const first = r.error ? { code: r.code || null, msg: String(r.error).slice(0, 200) } : null; let n = 0;
  if (r.code === '40P01' || r.code === '40001') { n = 1; r = await hq(sql); }
  // the harness check (review F-9): a wrong harness that repeats a call that already committed
  if (!r.error && process.env.HARNESS_MUT === 'retry_commits_twice') { n += 1; r = await hq(sql); }
  return { r, n, first };
};

async function runH({ mig: hmig, CLEAN: hclean, ROUNDS: R, mutated }) {
  const out = []; const add3 = (name, ok, got) => out.push({ name, ok, got });
  const Q = '$' + 'm' + '$';
  let nativeOn = false;   // HUNT-V2-NATIVE (review r1 M1): the native file was on the copy before H
  let pn = 0; const nextP = () => HP[++pn];
  const liveP = async (where, sq = SQ_SQL, who = null) => {
    for (let t = 0; t < 4; t++) {
      const p = who || nextP(); const s = (await hq(`select hunt_v2_start(${HL(p)}, ${sq}) r;`)).rows?.[0]?.r;
      if (s?.ok === true && s.status === 'active') { await hq(hTough(p)); return { p, s }; }
      if (who) { await hq(`delete from public.hunt_card_hp where player_id = ${HL(p)}; delete from public.hunt_v2_days where player_id = ${HL(p)};`); }
    }
    throw new Error(`4 set-up starts in a row gave no active day (${where})`);
  };
  const one = async (sql) => (await hq(sql)).rows?.[0];
  try {
    const pre = await hq(hCleanup); if (pre.error) throw new Error('cleanup: ' + pre.error);
    const st = await one(`select to_regprocedure('public.hunt_v2_boon_plan(jsonb, jsonb, numeric, jsonb, numeric)') is not null as applied;`);
    if (!st?.applied) throw new Error('HBP (combat_v2_hunt_boons.sql) is not applied on this copy');
    nativeOn = (await one(`select ${NATIVE_ON} as on;`))?.on === true;
    if (mutated && nativeOn) { const u = await hq(`do $h$ begin execute ${Q}${NATIVE_UNDO}${Q}; end $h$;`); if (u.error) throw new Error('take the native file off: ' + u.error); }
    if (mutated) { const m = await hq(`do $h$ begin execute ${Q}${hmig}${Q}; end $h$;`); if (m.error) throw new Error('apply the mutated file: ' + m.error); }
    const setup = await hq(String.raw`do $x$ declare sq bigint[]; begin
      perform set_config('tcg.skip_welcome', 'on', true);
      perform set_config('balance.by', '${HBY}', true);
      if to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is null then
        execute 'create function public.combat_v2_synergy(p_state jsonb, p_b jsonb) returns jsonb language sql immutable as ''select p_state''';
        execute 'create function public.hbp_h_synstub() returns void language sql as ''select null''';
      end if;
      sq := array(select c.id from cards c join subjects s on s.id = c.subject_id where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array'
                   and exists (select 1 from roles x where x.key = s.ability_v2->>'role') and c.rarity::text = 'normal' order by s.type in ('Character', 'Creature') desc, c.id limit 6);
      insert into public.players (id, username) select z, 'hbp h ' || z from unnest(array[${[...HP, HPR].map(HL).join(', ')}]) z;
      insert into public.player_cards (player_id, card_id, quantity, first_source) select p, c, 1, 'admin' from unnest(array[${HP.map(HL).join(', ')}]) p, unnest(sq) c;
      insert into public.player_cards (player_id, card_id, quantity, first_source) select ${HL(HPR)}, c, 1, 'admin' from unnest(array[378::bigint] || sq[1:5]) c;
      update public.balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';
    end $x$; select 1 as ok;`);
    if (setup.error) throw new Error('setup: ' + setup.error);
    let H = (await one(hNewHunt(80000)))?.hunt;
    // ---- (a) one member, two calls at once, launch_party uses 8 (the day lock serializes)
    {
      let A = await liveP('a'); let good = 0; const bad = [];
      for (let k = 0; k < R; k++) {
        await hq(`delete from public.player_effects where player_id = ${HL(A.p)};`);
        const rid = (await one(hEff(A.p, 'launch_party', 20, { uses: 8 })))?.id;
        const [c1, c2] = await Promise.all([hq(`select hunt_v2_auto(${HL(A.p)}, 3) r;`), hq(`select hunt_v2_auto(${HL(A.p)}, 3) r;`)]);
        const u = (r) => Number(r.rows?.[0]?.r?.credit?.boons?.party_hits || 0);
        const row = await one(`select consumed_at is not null as c, (options->>'uses')::int as uses from public.player_effects where id = ${rid};`);
        const used = u(c1) + u(c2); const left = row?.c ? 0 : row?.uses;
        const ok = !c1.error && !c2.error && used <= 8 && left === 8 - used && (used < 8 || row?.c);
        if (ok) good++; else bad.push({ k, used, row, e1: c1.error && String(c1.error).slice(0, 120), e2: c2.error && String(c2.error).slice(0, 120) });
        if (c1.rows?.[0]?.r?.status !== 'active' || c2.rows?.[0]?.r?.status !== 'active') A = await liveP('a');
      }
      add3(`G-10a ${R} rounds: one member, two Auto calls at once with launch_party uses 8: the boosted hits of both answers = 8 - left, never more than 8, each use once`, good === R, { good, bad: bad.slice(0, 3) });
    }
    // ---- (a2) two connections call hunt_v2_live_credit DIRECTLY (no day lock) with the same fixed log of 1 card hit, launch_party uses 8, both open at once
    {
      let A = await liveP('a2'); let good = 0; const bad = [];
      const day = (await one(`select hunt_v2_today() d;`))?.d;
      const card = (await one(`select squad[1] c from public.hunt_v2_days where player_id = ${HL(A.p)} and status = 'active';`))?.c;
      const LOGF = JSON.stringify([{ k: 'act', actor: { side: 'card', id: Number(card) }, hp: [{ side: 'enemy', id: 0, before: 1000, after: 990 }] }]);
      for (let k = 0; k < R; k++) {
        await hq(`delete from public.player_effects where player_id = ${HL(A.p)};`);
        const rid = (await one(hEff(A.p, 'launch_party', 20, { uses: 8 })))?.id;
        const call = `hunt_v2_live_credit(${H}, ${HL(A.p)}, '${day}'::date, '${LOGF}'::jsonb)`;
        const Ar = hq(hHold(call));
        const seen = await hq(hSeenA);
        const B = await hq(`select ${call} r;`);
        const a = await Ar;
        const ua = Number(a.rows?.[0]?.r?.boons?.party_hits || 0), ub = Number(B.rows?.[0]?.r?.boons?.party_hits || 0);
        const row = await one(`select consumed_at is not null as c, (options->>'uses')::int as uses from public.player_effects where id = ${rid};`);
        const left = row?.c ? 0 : row?.uses;
        const ok = !seen.error && !a.error && !B.error && ua + ub >= 1 && left === 8 - (ua + ub) && a.rows?.[0]?.r?.written && B.rows?.[0]?.r?.written;
        if (ok) good++; else bad.push({ k, ua, ub, left, seen: seen.error && String(seen.error).slice(0, 100), ea: a.error && String(a.error).slice(0, 120), eb: B.error && String(B.error).slice(0, 120) });
      }
      add3(`G-10a2 ${R} rounds: two connections call hunt_v2_live_credit directly for the same live day (1 card hit, launch_party uses 8) at once: the uses written = the boosted credited hits (left = 8 - boosted), no lost use`, good === R, { good, bad: bad.slice(0, 3) });
    }
    // ---- (b) A with raid_crasher for P while P acts with card 378 in its squad
    {
      H = (await one(hNewHunt(80000)))?.hunt;
      const hp0 = 80000;
      let A = await liveP('b'); const Pd = await liveP('b-P', SQP_SQL, HPR);
      await hq(hEff(A.p, 'raid_crasher', 25, { uses: 1000, credit_to: HPR, card_id: 378 }));
      let good = 0; const bad = [];
      for (let k = 0; k < R; k++) {
        const [c1, c2] = await Promise.all([hq(`select hunt_v2_auto(${HL(A.p)}, 1) r;`), hq(`select hunt_v2_auto(${HL(HPR)}, 1) r;`)]);
        const ok = !c1.error && !c2.error && c1.rows?.[0]?.r?.ok !== false && c2.rows?.[0]?.r?.ok !== false;
        if (ok) good++; else bad.push({ k, e1: c1.error && String(c1.error).slice(0, 140), e2: c2.error && String(c2.error).slice(0, 140), r1: c1.rows?.[0]?.r?.error, r2: c2.rows?.[0]?.r?.error });
        if (c1.rows?.[0]?.r?.status !== 'active') { A = await liveP('b'); await hq(hEff(A.p, 'raid_crasher', 25, { uses: 1000, credit_to: HPR, card_id: 378 })); }
        if (c2.rows?.[0]?.r?.status !== 'active') break;
      }
      const ck = await one(`select (select coalesce(sum(damage), 0)::bigint from public.hunt_hits where hunt_id = ${H} and player_id = ${HL(HPR)}) phits,
          (select coalesce(sum(credited), 0)::bigint from public.hunt_v2_days where hunt_id = ${H} and player_id = ${HL(HPR)}) pcred,
          (select coalesce(sum((result->>'value')::bigint), 0)::bigint from public.combat_actions where ref_id = ${H} and effect = 'raid_crasher' and player_id = ${HL(HPR)}) pext,
          (select hp_remaining from public.hunts where id = ${H}) hp, (select coalesce(sum(damage), 0)::bigint from public.hunt_hits where hunt_id = ${H}) allhits,
          (select coalesce(sum(abs(unexplained)), 0) from hunt_damage_reconcile(${H})) unexpl;`);
      const sums = ck && Number(ck.phits) === Number(ck.pcred) + Number(ck.pext) && Number(ck.hp) === hp0 - Number(ck.allhits) && Number(ck.unexpl) === 0 && Number(ck.pext) > 0;
      add3(`G-10b ${R} rounds: A (raid_crasher for P) and P (card 378 in its squad) act at once: no error (no 40P01); P's hunt_hits = P's credit + A's extras; boss HP = start - all credits; reconcile 0`, good >= Math.min(R, good) && bad.length === 0 && sums, { good, bad: bad.slice(0, 3), ck });
    }
    // ---- (b2) A's act credits P (raid_crasher) while P STARTS a live day with a start decrease (review F-4: a possible 40P01, the route retries once)
    {
      let good = 0; const bad = []; let retries = 0;
      for (let k = 0; k < R; k++) {
        H = (await one(hNewHunt(80000)))?.hunt;
        await hq(`delete from public.hunt_card_hp where player_id = ${HL(HPR)}; delete from public.hunt_v2_days where player_id = ${HL(HPR)};`);
        const A = await liveP('b2');
        await hq(hEff(A.p, 'raid_crasher', 25, { uses: 1000, credit_to: HPR, card_id: 378 }));
        await hq(String.raw`do $x$ begin
          alter function public.combat_v2_step(jsonb, jsonb, jsonb) rename to hbp_h_real_step;
          execute 'create function public.combat_v2_step(p_state jsonb, p_choice jsonb, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $w$
            declare r jsonb := public.hbp_h_real_step(p_state, p_choice, p_b); hp numeric;
            begin
              if (p_choice is not null and p_choice <> ''null''::jsonb) or (p_state->>''clock'')::int > 0 then return r; end if;
              hp := (r->''state''->''enemies''->0->>''hp'')::numeric;
              r := jsonb_set(r, ''{state,enemies,0,hp}'', to_jsonb(hp - 1));
              return jsonb_set(r, ''{log}'', (r->''log'') || jsonb_build_array(jsonb_build_object(''k'', ''clock'', ''hp'', jsonb_build_array(jsonb_build_object(''side'', ''enemy'', ''id'', 0, ''before'', hp, ''after'', hp - 1)))));
            end $w$';
        end $x$; select 1 as planted;`);
        const Ar = retryCall(hLockThen(`perform 1 from public.hunts where id = ${H} for no key update;`, `hunt_v2_auto(${HL(A.p)}, 3)`));
        const seen = await hq(hSeenA);
        const B = await retryCall(hTimed(`hunt_v2_start(${HL(HPR)}, ${SQP_SQL})`, false));
        const a = await Ar;
        await hq(String.raw`do $x$ begin drop function public.combat_v2_step(jsonb, jsonb, jsonb); alter function public.hbp_h_real_step(jsonb, jsonb, jsonb) rename to combat_v2_step; end $x$; select 1 as unplanted;`);
        const rb = B.r.rows?.[0]?.r;
        const ck = await one(`select (select count(*)::int from public.hunt_v2_days where hunt_id = ${H} and player_id = ${HL(HPR)}) pdays,
            (select coalesce(sum(abs(unexplained)), 0) from hunt_damage_reconcile(${H})) unexpl,
            (select coalesce(sum((result->>'value')::bigint), 0)::bigint from public.combat_actions where ref_id = ${H} and effect = 'raid_crasher' and player_id = ${HL(HPR)}) pext;`);
        retries += a.n + B.n;
        const ok = !seen.error && !a.r.error && !B.r.error && a.n + B.n <= 1 && rb?.ok === true && ck?.pdays === 1 && Number(ck?.unexpl) === 0 && Number(ck?.pext) > 0;
        if (ok) good++; else bad.push({ k, retries: a.n + B.n, a_first: a.first, b_first: B.first, a_err: a.r.error && String(a.r.error).slice(0, 140), b: B.r.error ? String(B.r.error).slice(0, 140) : rb?.error, ck });
      }
      add3(`G-10b2 ${R} rounds: A's act credits P (raid_crasher) while P starts a live day with a start decrease: both calls end with their writes after at most one retry (${retries} retries in all), reconcile 0, P's day row exists once`, good === R, { good, retries, bad: bad.slice(0, 3) });
    }
    // ---- (c) the OTHER connection takes A's effect row first (for update; pg_sleep(3)), then A acts: A is not slowed, not boosted by it, and does not change it
    {
      H = (await one(hNewHunt(80000)))?.hunt;
      let A = await liveP('c'); let good = 0; const bad = [];
      for (let k = 0; k < R; k++) {
        await hq(`delete from public.player_effects where player_id = ${HL(A.p)};`);
        const rid = (await one(hEff(A.p, 'rally', 20, { uses: 1 })))?.id;
        const Ar = hq(`/* hbp_A */ with a as materialized (select id from public.player_effects where id = ${rid} for update) select a.id, pg_sleep(3) as s, clock_timestamp() as a_end from a;`);
        const seen = await hq(hSeenA);
        const B = await hq(hTimed(`hunt_v2_auto(${HL(A.p)}, 1)`, false));
        const a = await Ar;
        const rb = B.rows?.[0]?.r;
        const row = await one(`select consumed_at is null as w, options from public.player_effects where id = ${rid};`);
        const ok = !seen.error && !a.error && !B.error && rb?.ok === true && Number(B.rows?.[0]?.server_ms) < 1000 && Number(rb?.credit?.boons?.rally || 0) === 0 && row?.w === true;
        if (ok) good++; else bad.push({ k, ms: B.rows?.[0]?.server_ms, rally: rb?.credit?.boons?.rally, row, e: B.error && String(B.error).slice(0, 140) });
        if (rb?.status !== 'active') A = await liveP('c');
      }
      add3(`G-10c ${R} rounds: the other connection holds A's rally row (FOR UPDATE, 3 s), then A acts: A ends in < 1 s server time, A's hits are not boosted by the row, the row stays waiting`, good === R, { good, bad: bad.slice(0, 3) });
    }
    // ---- (d) a forced abort after the shared write (a planted hunt_v2_out raises 40P01 on every odd call); the harness repeats the call once
    {
      H = (await one(hNewHunt(80000)))?.hunt;
      await hq(String.raw`do $x$ begin
        create sequence public.hbp_h_seq;
        alter function public.hunt_v2_out(bigint, text, date, jsonb) rename to hbp_h_real_out;
        execute 'create function public.hunt_v2_out(p_hunt bigint, p_player text, p_day date, p_extra jsonb) returns jsonb language plpgsql set search_path = public as $w$
          begin if nextval(''public.hbp_h_seq'') % 2 = 1 then raise exception using errcode = ''40P01'', message = ''hbp planted abort after the shared write''; end if;
          return public.hbp_h_real_out(p_hunt, p_player, p_day, p_extra); end $w$';
      end $x$; select 1 as planted;`);
      let A = await liveP('d'); let good = 0; const bad = [];
      for (let k = 0; k < R; k++) {
        await hq(`delete from public.player_effects where player_id = ${HL(A.p)}; select setval('public.hbp_h_seq', 1, false);`);
        const rid = (await one(hEff(A.p, 'launch_party', 20, { uses: 8 })))?.id;
        const c0 = await one(`select credited c, (select coalesce(sum(damage), 0)::bigint from public.hunt_hits where hunt_id = ${H} and player_id = ${HL(A.p)}) h from public.hunt_v2_days where player_id = ${HL(A.p)} and status = 'active';`);
        const x = await retryCall(`select hunt_v2_auto(${HL(A.p)}, 3) r;`);
        const r = x.r.rows?.[0]?.r;
        const c1 = await one(`select credited c, (select coalesce(sum(damage), 0)::bigint from public.hunt_hits where hunt_id = ${H} and player_id = ${HL(A.p)}) h from public.hunt_v2_days where player_id = ${HL(A.p)} order by started_at desc limit 1;`);
        const row = await one(`select consumed_at is not null as c, (options->>'uses')::int as uses from public.player_effects where id = ${rid};`);
        const used = Number(r?.credit?.boons?.party_hits || 0); const left = row?.c ? 0 : row?.uses;
        const ok = x.first?.code === '40P01' && x.n === 1 && !x.r.error && r?.ok === true && left === 8 - used
          && Number(c1?.c) - Number(c0?.c) === Number(r?.credit?.total || 0) && Number(c1?.h) - Number(c0?.h) === Number(r?.credit?.total || 0);
        if (ok) good++; else bad.push({ k, first: x.first, n: x.n, used, left, credit: r?.credit?.total, dc: Number(c1?.c) - Number(c0?.c), dh: Number(c1?.h) - Number(c0?.h), err: x.r.error && String(x.r.error).slice(0, 140) });
        if (r?.status !== 'active') A = await liveP('d');
      }
      await hq(String.raw`do $x$ begin drop function public.hunt_v2_out(bigint, text, date, jsonb); alter function public.hbp_h_real_out(bigint, text, date, jsonb) rename to hunt_v2_out; drop sequence public.hbp_h_seq; end $x$; select 1 as unplanted;`);
      add3(`G-10d ${R} rounds: a forced abort (40P01) after the shared write, the call repeated once: the rows of the aborted try are unchanged, the retry uses each charge once (left = 8 - boosted), the credit is written once`, good === R, { good, bad: bad.slice(0, 3) });
    }
  } catch (err) {
    add3(`G-10 the H cases ran (${String(err.message).slice(0, 300)})`, false, null);
  } finally {
    const c = await hq(hCleanup);
    let r = { error: null };
    // the clean file WITHOUT its guard (the guard refuses the mutated text on the copy), then the check that the 3 md5s are the file's again
    if (mutated) {
      r = await hq(`do $h$ begin execute ${Q}${hclean.replace(/do \$g\$\ndeclare m text; f record;[\s\S]*?-- GUARD-END\n/, '')}${Q}; end $h$;`);
      const m = await one(`select string_agg(md5(replace(pg_get_functiondef(('public.' || z)::regprocedure), chr(13), '')), ',' order by z) s from unnest(array[${GUARD_NEW.map(([fn]) => lit(fn)).join(', ')}]) z;`);
      const want = GUARD_NEW.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, x]) => x).join(',');
      if (!r.error && m?.s !== want) r = { error: `the clean file is not back: ${m?.s} <> ${want}` };
      if (!r.error && nativeOn) {
        const n = await hq(`do $h$ begin execute ${Q}${NATIVE}${Q}; end $h$;`);
        if (n.error) r = { error: 'put the native file back: ' + n.error };
        else if ((await one(`select ${NATIVE_ON} as on;`))?.on !== true) r = { error: 'the native file is not back' };
      }
    }
    const left = await one(`select (select count(*) from public.players where id = any(array[${[...HP, HPR].map(HL).join(', ')}])) + (select count(*) from public.hunts where weak_points = '${HMARK}'::jsonb)
      + (select count(*) from public.balance_log where changed_by = '${HBY}') + (select count(*) from pg_proc where proname in ('hbp_h_real_step', 'hbp_h_real_out', 'hbp_h_synstub'))
      + (select count(*) from pg_class where relname = 'hbp_h_seq') n, (select value->>'hunt' from public.balance where key = 'combat_v2') flag;`);
    add3('G-10 the cleanup removed every sample row (members, the prankster, Hunts, hits, effect rows, balance_log), the plants are gone, the flag is OFF again' + (mutated ? ', and the clean file is applied again' : ''),
      !c.error && !r.error && Number(left?.n) === 0 && left?.flag === 'false', { c: c.error, r: r.error, left });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------- run
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const show = (rows) => { for (const r of rows) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 1200)); } };
const run = async (label, sql) => {
  try { const j = JSON.parse(await runBlock(sql)); return j.rows; }
  catch (e) { say(false, `${label}: the test block raised (the file did not apply?)`, String(e.message).slice(0, 1500)); return null; }
};
const ONLY = process.env.ONLY || '';
const want = (g) => !ONLY || ONLY.split(',').includes(g);
const hMut = H_MUTS.includes(process.env.MUTATE);
if (!hMut) {
  if (want('G1')) { const r = await run('B1', B1); if (r) show(r); }
  if (want('G2')) {
    const rows = [];
    for (let s = 1; s <= 40 && rows.filter((r) => !r.raised).length < LOGS; s += 5) { const r = await run(`B2 ${s}`, B2(s, s + 4)); if (r) rows.push(...r); }
    const good = rows.filter((r) => !r.raised).slice(0, LOGS);
    say(good.length >= LOGS && good.every((r) => r.eq) && rows.every((r) => !r.raised),
      `G-2 ${good.length} real seeded live-day logs (start, auto 3, auto 3, auto 1000): hunt_v2_boon_plan(log, squad, scale, '[]', cap) total and cards = hunt_v2_credit(log, squad, scale) exactly (${good.reduce((s, r) => s + Number(r.total || 0), 0)} credit in all)`,
      JSON.stringify(rows.filter((r) => r.raised || !r.eq).slice(0, 3)).slice(0, 900));
  }
  if (want('G3')) {
    const rows = [];
    for (let s = 1; s <= SEEDS; s += 5) { const r = await run(`B3 ${s}`, B3(s, Math.min(SEEDS, s + 4))); if (r) rows.push(...r); }
    const good = rows.filter((r) => !r.raised);
    const per = (k) => good.length === SEEDS && good.every((r) => !r.bad.some((b) => b.checks && !b.checks[k]) && !r.bad.some((b) => b.err));
    const extra = JSON.stringify(rows.filter((r) => r.raised || r.bad.length).slice(0, 2)).slice(0, 1500);
    const sum = `${good.length} seeds; rally used ${good.filter((r) => r.rally > 0).length}, launch_party hits ${good.reduce((s, r) => s + (r.party || 0), 0)}, raid_crasher hits ${good.reduce((s, r) => s + (r.crash || 0), 0)}, extras ${good.reduce((s, r) => s + Number(r.extras || 0), 0)}`;
    say(per('a'), `G-3a live calls with rally 20 + launch_party (uses 8) + raid_crasher (25, uses 3, P, 378): per call the credited delta = the plan total of the returned log with the rows as they were (${sum})`, extra);
    say(per('b'), 'G-3b per call the boss HP delta = total + extras', extra);
    say(per('c'), "G-3c per call the member's hunt_hits and hunt_combat_log grow by the same per-card values", extra);
    say(per('d'), "G-3d per call P's hunt_hits (card 378, today) grows by the extras", extra);
    say(per('e'), "G-3e per call with extras: one combat_actions row (mode hunt, kind effect, raid_crasher, player P, card 378) with result.value = the extras", extra);
    say(per('f'), 'G-3f the rows: rally consumed by its first hit; launch_party uses = 8 - hits; raid_crasher uses = 3 - hits (consumed at 0)', extra);
    say(per('g') && good.some((r) => r.crash > 0) && good.some((r) => r.rally > 0), 'G-3g hunt_damage_reconcile unexplained = 0 for every player after every call (and the seeds used rally and raid_crasher)', extra);
  }
  if (want('G4')) { const r = await run('B4', B4); if (r) show(r); }
  if (want('G11')) { const r = await run('B5', B5); if (r) show(r); }
}
// a mutation of an in-block text cannot change the H cases (they use the copy's committed functions): its run skips H
const skipH = !!process.env.MUTATE && !hMut;
if (want('G10') && process.env.H !== '0' && !skipH) {
  for (const r of await runH({ mig, CLEAN, ROUNDS, mutated: hMut })) say(r.ok, r.name, String(JSON.stringify(r.got ?? null)).slice(0, 1200));
} else if (!ONLY || want('G10')) console.log(skipH ? 'SKIP G-10 (an in-block mutation: H uses the committed file)' : 'SKIP G-10 (H=0): NOT a gate result');
const GATE_N = 44;
const partial = !!ONLY || process.env.H === '0' || SEEDS < 20 || LOGS < 50 || ROUNDS < 20 || (!hMut && total !== GATE_N);
console.log(fail ? `${fail} of ${total} FAILED` : partial ? `PARTIAL ${total} passed (ONLY=${ONLY || '-'}, H=${process.env.H ?? '1'}, SEEDS ${SEEDS}, LOGS ${LOGS}, ROUNDS ${ROUNDS}): NOT a gate result` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
