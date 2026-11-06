import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_on_hunt.sql (combat v2 step R3-ON: the Hunt in combat v2 for every member; plan 20.21,
 * pipeline item ON SPEC v6.1 section 3.4, gate 6.3, cases HO1-HO12). In-block cases: NO lasting change (one DO block per request, undone by
 * its final RAISE). Each block drops the R3 objects (the hunt_v2_ functions and hunt_v2_days), runs the R3a file and this file, so the test
 * passes before and after the apply. The block makes its own active Hunt (every other active Hunt expires in the block), its own members
 * and testers, and sets the flag combat_v2.hunt per case.
 * SYN: when the copy has no combat_v2_synergy, each block makes a stand-in that returns the state (HO2b plants its own stand-in).
 *   LOCALDB=1 LOCALDB_ENV=... node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-on-hunt.mjs       must PASS
 *   MUTATE=<name> ...   must FAIL; MUTATE=all ...   the baseline, then every mutation (each must FAIL)
 *   MUTATE=all_out      R3-ON-FIX (combat_v2_hunt_out_live.sql, cases HL1-HL4): the baseline (ONLY=OUT), then every OUT_MUT mutation (each must FAIL)
 *   ONLY=OUT            only block B5 (HL1-HL4) and no H: PARTIAL, not a gate result
 *   DAYS=<n>            the seeded live days of HO2 (default 20, the spec number); STARTS=<n> the seeded starts of HO2b (default 50)
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-on-hunt.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const R3A = read('../../tcg-bot/supabase/combat_v2_hunt_practice.sql');
let mig = process.env.MIG ? readFileSync(process.env.MIG, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '') : read('../../tcg-bot/supabase/combat_v2_on_hunt.sql');
let r3a = R3A;
const CLEAN = mig;
const HBP_FILE = read('../../tcg-bot/supabase/combat_v2_hunt_boons.sql');   // applied again by the mutated-H finally step when it was on the copy
let hbpBefore = false;
// R3-ON-FIX (combat_v2_hunt_out_live.sql) replaces hunt_v2_out (an R3a function): each block applies it after this file; the mutated-H finally
// step applies it again when it was on the copy before the run
const OUT_CLEAN = read('../../tcg-bot/supabase/combat_v2_hunt_out_live.sql');
let outFix = OUT_CLEAN;
let outBefore = false;
// HUNT-HEADER-V2 (hunt_v2_view_boss_max.sql) replaces hunt_v2_view (an R3-ON function): the mutated-H finally step applies it again when it was on
const VIEW_FIX = read('../../tcg-bot/supabase/hunt_v2_view_boss_max.sql');
let viewBefore = false;
const DAYS = Number(process.env.DAYS || 20), STARTS = Number(process.env.STARTS || 50);

// ---------------------------------------------------------------------------------------------------------- the mutations
// [anchor, replacement] on this file; a key in R3A_MUT changes the R3a file instead
const V1_ATTACK_HEAD = "    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;\n  -- R3-ON (combat_v2_on_hunt.sql): the Hunt is combat v2 for everyone with the flag ON; a live v2 day of today keeps v1 off (also after a rollback)\n";
const V2ON_LINE = "  if combat_v2_on('hunt') then return jsonb_build_object('ok', false, 'error', 'v2_on'); end if;   -- R3-ON\n";
const V2TODAY_LINES = "  if exists (select 1 from hunt_v2_days d where d.hunt_id = p_hunt and d.player_id = p_player and d.day = (now() at time zone 'America/Denver')::date and d.live) then   -- R3-ON\n    return jsonb_build_object('ok', false, 'error', 'v2_today'); end if;   -- R3-ON\n";
const SETTLE = "  if v_status = 'defeated' then\n    v_settle := settle_hunt(p_hunt);\n    insert into public.hunt_events (hunt_id, kind, payload)";
const MUT = {
  shared_when_off: ["  if not found or not r.live then return jsonb_build_object('total', 0, 'written', false); end if;", "  if not found then return jsonb_build_object('total', 0, 'written', false); end if;"],
  practice_writes_shared: ['    v_practice := true;\n', '    v_practice := true; v_live := true;\n'],
  credit_net: ["     where h->>'side' = 'enemy' and (h->>'id')::int = 0 and (h->>'after')::numeric < (h->>'before')::numeric", "     where h->>'side' = 'enemy' and (h->>'id')::int = 0"],
  scale_missing: ['  c := hunt_v2_credit(p_log, to_jsonb(r.squad), v_hpmax / v_max);', '  c := hunt_v2_credit(p_log, to_jsonb(r.squad), 1);'],
  credit_twice: ['  s := hunt_v2_shared(p_hunt, p_player, p_day, c);\n', '  s := hunt_v2_shared(p_hunt, p_player, p_day, c);\n  s := hunt_v2_shared(p_hunt, p_player, p_day, c);\n'],
  clamp_hits: ['values (p_hunt, p_player, c.card, p_day, c.dmg)', 'values (p_hunt, p_player, c.card, p_day, least(c.dmg, (select hp_remaining from public.hunts where id = p_hunt)))'],
  start_credit_dropped: ["  sh := hunt_v2_live_credit(h.id, p_player, v_day, r->'log');\n", '  sh := null;\n'],
  credit_top_card_only: ["    select case when e->>'k' = 'act' and e->'actor'->>'side' = 'card' then e->'actor'->>'id' else p_squad->>0 end as card,", "    select p_squad->>0 as card,"],
  no_settle: [SETTLE, SETTLE.replace('    v_settle := settle_hunt(p_hunt);\n', '')],
  settle_each_call: [SETTLE, SETTLE.replace("  if v_status = 'defeated' then", '  if true then')],
  no_bridge: ['    insert into public.hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)\n', '    perform 1;\n    insert into public.hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)\n      select * from (select 1::bigint, 2::text, 3::bigint, 4::date, 5, 6, true) z where false;\n    insert into public.hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed)\n'],
  bridge_up: ["round((v_units->(z::text)->>'max')::numeric)::int, true\n        from unnest(v_ids) z\n      on conflict (hunt_id, player_id, card_id, hit_date) do update set downed = true, updated_at = now();",
    "round((v_units->(z::text)->>'max')::numeric)::int, false\n        from unnest(v_ids) z\n      on conflict (hunt_id, player_id, card_id, hit_date) do update set downed = false, updated_at = now();"],
  no_combat_log: ["    insert into public.hunt_combat_log (hunt_id, player_id, card_id, outcome, damage, boss_hp_after) values (p_hunt, p_player, c.card, 'hit', c.dmg, v_hp);\n", '    perform 1;\n'],
  shared_reads_flag: ["  if not found or not r.live then return jsonb_build_object('total', 0, 'written', false); end if;", "  if not found or not combat_v2_on('hunt') then return jsonb_build_object('total', 0, 'written', false); end if;"],
  v1_attack_ungated: [V1_ATTACK_HEAD + V2ON_LINE, V1_ATTACK_HEAD],
  gate_reads_flag_only: [V1_ATTACK_HEAD + V2ON_LINE + V2TODAY_LINES, V1_ATTACK_HEAD + V2ON_LINE],
  ignore_v1_day: ["    if exists (select 1 from public.hunt_card_hp hc where hc.hunt_id = h.id and hc.player_id = p_player and hc.hit_date = v_day) then\n      return jsonb_build_object('ok', false, 'error', 'v1_today');\n    end if;\n", ''],
  guard_missing: [/do \$g\$\ndeclare m text; f record;[\s\S]*?-- GUARD-END\n/, ''],
  grant_anon: ['comment on function public.hunt_v2_view(text) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON', 'grant execute on function public.hunt_v2_credit(jsonb, jsonb, numeric) to anon;\ncomment on function public.hunt_v2_view(text) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON'],
  pick_level_zero: ['      u := dungeon_v2_unit(p_player, rr.card_id, bu);', '      u := combat_v2_card_unit(rr.card_id, bu);'],
};
// R3-ON-FIX: one mutation per key of the answer (HL1-HL4 must FAIL on each); MUTATE=all_out runs them with ONLY=OUT
const OUT_MUT = {
  out_no_live: ["'live', v_live, 'practice', not v_live,", "'practice', not v_live,"],
  out_practice_true: ["'practice', not v_live,", "'practice', true,"],
  out_no_hunt: ["      'hunt', (select jsonb_build_object('id', h.id, 'name', h.name, 'tier', h.tier, 'closes_at', h.closes_at,\n                 'live_frac', h.hp_remaining::numeric / h.hp_max) from public.hunts h where h.id = p_hunt),\n", ''],
  out_frac_before_credit: ["'live_frac', h.hp_remaining::numeric / h.hp_max)", "'live_frac', (h.hp_remaining + coalesce((p_extra->'credit'->>'total')::numeric, 0)) / h.hp_max)"],
  out_live_from_flag: ['  v_live := coalesce(r.live, false);', "  v_live := combat_v2_on('hunt');"],
  out_live_always: ['  v_live := coalesce(r.live, false);', '  v_live := true;'],
};
const R3A_MUT = {
  map_exact_name: ["   where lower(x.name) = lower(regexp_replace(p_name, '^The ', '', 'i')) or lower(x.name) = lower(p_name);", '   where x.name = p_name;'],
};

// the mutations that only the two-connection cases (H) catch: each changes only hunt_v2_ objects
Object.assign(MUT, {
  lock_at_start: ["    select status, closes_at into v_st, v_cl from public.hunts where id = h.id for key share;", "    select status, closes_at into v_st, v_cl from public.hunts where id = h.id for update;"],
  shared_lock_for_update: ["  select status, closes_at, tier into v_status, v_closes, v_tier from public.hunts where id = p_hunt for no key update;", "  select status, closes_at, tier into v_status, v_closes, v_tier from public.hunts where id = p_hunt for update;"],
  players_before_hunts: ["    select status, closes_at into v_st, v_cl from public.hunts where id = h.id for key share;\n    if v_st <> 'active' or now() >= v_cl then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;\n    perform 1 from public.players where id = p_player for update;\n", "    perform 1 from public.players where id = p_player for update;\n    select status, closes_at into v_st, v_cl from public.hunts where id = h.id for key share;\n    if v_st <> 'active' or now() >= v_cl then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;\n"],
  no_status_recheck: ["  if not found or v_status <> 'active' or now() >= v_closes then return jsonb_build_object('written', false, 'over', true, 'total', 0); end if;", "  if not found then return jsonb_build_object('written', false, 'over', true, 'total', 0); end if;"],
  writes_after_close: ["  if not found or v_status <> 'active' or now() >= v_closes then return jsonb_build_object('written', false, 'over', true, 'total', 0); end if;", "  if not found or v_status = 'defeated' then return jsonb_build_object('written', false, 'over', true, 'total', 0); end if;"],
  defeat_event_twice: ["  if not found or v_status <> 'active' or now() >= v_closes then return jsonb_build_object('written', false, 'over', true, 'total', 0); end if;", "  if not found or v_status not in ('active', 'defeated') or now() >= v_closes then return jsonb_build_object('written', false, 'over', true, 'total', 0); end if;"],
  retry_commits_twice: ["  if not found or v_status <> 'active' or now() >= v_closes then return jsonb_build_object('written', false, 'over', true, 'total', 0); end if;", "  for c in select key::bigint as card, value::bigint as dmg from jsonb_each_text(p_credit->'cards') where value::bigint > 0 loop insert into public.hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, p_player, c.card, p_day, c.dmg) on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage; end loop;\n  if not found or v_status <> 'active' or now() >= v_closes then return jsonb_build_object('written', false, 'over', true, 'total', 0); end if;"],
});
const NAMED = `shared_when_off practice_writes_shared credit_net scale_missing credit_twice clamp_hits start_credit_dropped credit_top_card_only no_settle
  settle_each_call no_bridge bridge_up no_combat_log map_exact_name shared_reads_flag v1_attack_ungated gate_reads_flag_only ignore_v1_day
  guard_missing grant_anon pick_level_zero lock_at_start shared_lock_for_update players_before_hunts no_status_recheck writes_after_close
  defeat_event_twice retry_commits_twice`.split(/\s+/).filter(Boolean);
const ALL = { ...MUT, ...R3A_MUT };

if (process.env.MUTATE === 'all') {
  let ok = true;
  const missing = NAMED.filter((n) => !ALL[n]);
  console.log(`named in-block mutations of the spec 6.3 table: ${NAMED.length}; missing: ${missing.length ? missing.join(' ') : 'none'}`);
  if (missing.length) ok = false;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)            ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 160)}`);
  if (base.status !== 0) { ok = false; console.log((base.stdout || '').split(/\r?\n/).filter((l) => /^FAIL/.test(l)).join('\n').slice(0, 3000)); }
  for (const name of Object.keys(ALL)) {
    const t0 = Date.now();
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const why = (r.stdout || '').split(/\r?\n/).find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '';
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  ${Math.round((Date.now() - t0) / 1000)}s  ${why.slice(0, 150)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(ALL).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE === 'all_out') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, ONLY: 'OUT', LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  const bok = base.status === 0 && /^PARTIAL/.test(bl);
  console.log(`baseline (no mutation, ONLY=OUT)   ${bok ? 'PASS' : 'FAIL'}  ${bl.slice(0, 160)}`);
  if (!bok) { ok = false; console.log((base.stdout || '').split(/\r?\n/).filter((l) => /^FAIL/.test(l)).join('\n').slice(0, 3000)); }
  for (const name of Object.keys(OUT_MUT)) {
    const r = runOne(name);
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const why = (r.stdout || '').split(/\r?\n/).find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '';
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  ${why.slice(0, 150)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(OUT_MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const name = process.env.MUTATE;
  const m = MUT[name] || R3A_MUT[name] || OUT_MUT[name];
  if (!m) throw new Error(`no mutation ${name}`);
  const [a, b] = m;
  const src = MUT[name] ? mig : R3A_MUT[name] ? r3a : outFix;
  const n = a instanceof RegExp ? (src.match(new RegExp(a.source, 'g')) || []).length : src.split(a).length - 1;
  if (n !== 1) throw new Error(`the mutation ${name} does not match exactly once (${n})`);
  const out = a instanceof RegExp ? src.replace(a, b) : src.split(a).join(b);
  if (MUT[name]) mig = out; else if (R3A_MUT[name]) r3a = out; else outFix = out;
}
for (const s of [mig, r3a, outFix]) if (['$m$', '$t$', '$x$', '$w$', '$n$'].some((x) => s.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $x$, $w$ or $n$');

// ---------------------------------------------------------------------------------------------------------- the shared SQL
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const id = (k, i) => `9000000000000${k}${String(i).padStart(2, '0')}`;
const TESTERS = Array.from({ length: 6 }, (_, i) => id('041', i + 1));
const MEMBERS = Array.from({ length: 30 }, (_, i) => id('042', i + 1));
const T = (i) => lit(TESTERS[i - 1]);
const M = (i) => lit(MEMBERS[i - 1]);
const PRE = String.raw`
  for f in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'hunt\_v2\_%' loop
    execute 'drop function ' || f;
  end loop;
  drop table if exists public.hunt_v2_days;
  syn_on := to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is not null and to_regprocedure('public.combat_v2_card_tags(bigint)') is not null;
  if to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is null then
    execute 'create function public.combat_v2_synergy(p_state jsonb, p_b jsonb) returns jsonb language sql immutable as ''select p_state''';
  end if;
  execute $m$${r3a}$m$;`;
const WORLD = String.raw`
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_r3on_admin', true);
  update hunts set status = 'expired' where status = 'active';
  select x.key, x.name into bk, bn from hunt_bosses_v2 x where exists (select 1 from unnest(x.weak_to) w join roles r on w = 'role:' || r.key where r.class = 'attacker') order by x.ord limit 1;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || bn, 'Heroic', '[]'::jsonb, 80000, 32000, now() - interval '1 hour', now() + interval '2 days', 'active') returning id into hid;
  b := combat_v2_enemy_numbers();
  create temp table r3on_pool on commit drop as
    select distinct on (c.subject_id, c.rarity) c.id, c.rarity::text as rarity, s.type in ('Character', 'Creature') as att
      from cards c join subjects s on s.id = c.subject_id
     where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from roles x where x.key = s.ability_v2->>'role')
     order by c.subject_id, c.rarity, c.id;
  na := array(select id from r3on_pool where att and rarity = 'normal' order by id limit 12);
  sup := array(select id from r3on_pool where not att and rarity = 'normal' order by id limit 5);
  sq := na[1:4] || sup[1:2];
  insert into players (id, username) select z, 'tst ' || z from unnest(array[${[...TESTERS, ...MEMBERS].map(lit).join(', ')}]) z;
  insert into player_cards (player_id, card_id, quantity) select p, c, 1 from unnest(array[${[...TESTERS, ...MEMBERS].map(lit).join(', ')}]) p, unnest(na || sup) c on conflict do nothing;
  update balance set value = jsonb_set(jsonb_set(value, '{testers}', ${lit(JSON.stringify(TESTERS))}::jsonb), '{hunt}', 'false') where key = 'combat_v2';
  create function pg_temp.all_true_s(p boolean, v boolean) returns boolean language sql immutable as $x$ select coalesce(p, true) and coalesce(v, false) $x$;
  create aggregate pg_temp.all_true(boolean) (sfunc = pg_temp.all_true_s, stype = boolean);
  create function pg_temp.flag(v boolean) returns void language sql as $x$ update balance set value = jsonb_set(value, '{hunt}', to_jsonb(v)) where key = 'combat_v2' $x$;
  create function pg_temp.snap() returns jsonb language plpgsql as $x$
  declare out jsonb := '{}'; tb text; v jsonb;
  begin
    for tb in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname <> 'hunt_v2_days' order by 1 loop
      execute format('select jsonb_build_array(count(*), md5(coalesce(string_agg(t::text, %L order by t::text), %L))) from public.%I t', '|', '', tb) into v;
      out := out || jsonb_build_object(tb, v);
    end loop;
    return out;
  end $x$;
  -- the expected credit of one answer log (the spec rule, computed here from the log of the answer, not by the function under test)
  create function pg_temp.expect(lg jsonb, squad jsonb, sc numeric) returns jsonb language sql as $x$
    with d as (select case when e->>'k' = 'act' and e->'actor'->>'side' = 'card' then e->'actor'->>'id' else squad->>0 end as card,
                      ((h->>'before')::numeric - (h->>'after')::numeric) * sc as amt
                 from jsonb_array_elements(coalesce(lg, '[]'::jsonb)) e, jsonb_array_elements(coalesce(e->'hp', '[]'::jsonb)) h
                where h->>'side' = 'enemy' and h->>'id' = '0' and (h->>'after')::numeric < (h->>'before')::numeric),
         per as (select card, sum(amt) a from d group by 1)
    select jsonb_build_object('raw', coalesce((select sum(a) from per), 0), 'total', coalesce((select round(sum(a)) from per), 0)::bigint,
      'per', coalesce((select jsonb_object_agg(card, a) from per), '{}'::jsonb)) $x$;
  create function pg_temp.vrow(p text) returns hunt_v2_days language sql as $x$ select * from hunt_v2_days where player_id = p and day = hunt_v2_today() order by started_at desc limit 1 $x$;
  create function pg_temp.hits(h bigint, p text) returns jsonb language sql as $x$
    select coalesce(jsonb_object_agg(card_id::text, damage), '{}'::jsonb) from hunt_hits where hunt_id = h and player_id = p $x$;`;
const DECL = `f text; res jsonb := '[]'; b jsonb; a jsonb; a2 jsonb; x jsonb; y jsonb; e jsonb; o jsonb; ok boolean; n int; i int; t text; msg text;
  syn_on boolean; bk text; bn text; hid bigint; sq bigint[]; na bigint[]; sup bigint[]; rw record; before jsonb; after jsonb; h0 bigint; h1 bigint;
  sh0 jsonb; sh1 jsonb; sc numeric; out jsonb; row0 jsonb; lg jsonb; c0 bigint; c1 bigint`;
const block = (body, extra = '') => String.raw`do $t$
#variable_conflict use_column
declare ${DECL}; ${extra}
begin
  ${PRE}
  execute $m$${mig}$m$;
  execute $m$${outFix}$m$;
  ${WORLD}
  ${body}
  raise exception 'RESULT:%', jsonb_build_object('syn', syn_on, 'rows', res)::text;
end $t$;`;
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;
// one sub-block that is rolled back: its body sets row0
const sub = (body) => String.raw`
  begin
    ${body}
    raise exception 'r3on_rollback';
  exception when others then if sqlerrm <> 'r3on_rollback' then res := res || jsonb_build_object('case', 'a sub-block raised', 'ok', false, 'got', to_jsonb(sqlerrm)); end if;
  end;`;

// ---------------------------------------------------------------------------------------------------------- B1: HO1, HO1b, HO8, HO9, HO10b, HO11 (grants), HO12
const B1 = block(String.raw`
  -- HO1 flag OFF: a tester day writes no shared row and takes no lock on the boss row (xmax unchanged), live false
  before := pg_temp.snap(); h0 := (select xmax::text::bigint from hunts where id = hid);
  a := hunt_v2_start(${T(1)}, sq); x := hunt_v2_auto(${T(1)}, 1000);
  after := pg_temp.snap(); h1 := (select xmax::text::bigint from hunts where id = hid); rw := pg_temp.vrow(${T(1)});
  ${add('HO1 flag OFF: a full tester day (start + auto) changes no public table but hunt_v2_days, takes no lock on the hunts row (xmax), and is not live (credited 0)',
    `(a->>'ok')::boolean and (x->>'ok')::boolean and before = after and h0 = h1 and not rw.live and rw.credited = 0`,
    `jsonb_build_object('diff', (select jsonb_agg(q.key) from jsonb_each(before) q where after->q.key is distinct from q.value), 'xmax', jsonb_build_array(h0, h1), 'live', rw.live, 'credited', rw.credited, 'err', a->'error')`)}
  a := hunt_v2_start(${M(1)}, sq);
  ${add('HO1 flag OFF: a member who is not a tester gets not_tester', `a->>'error' = 'not_tester'`, 'a')}
  -- HO1b a tester with no active Hunt practises against the newest ended Hunt (live frac 1), no shared write
  ${sub(String.raw`
    update hunts set status = 'expired' where id = hid;
    before := pg_temp.snap();
    a := hunt_v2_start(${T(2)}, sq); x := hunt_v2_auto(${T(2)}, 3);
    after := pg_temp.snap();
    ${add('HO1b a tester with no active Hunt: the start practises against the newest ended Hunt (its row, live false, the boss at full HP), act plays on, 0 shared rows changed',
      `(a->>'ok')::boolean and (pg_temp.vrow(${T(2)})).hunt_id = (select id from hunts order by opens_at desc limit 1) and not (pg_temp.vrow(${T(2)})).live and (x->>'ok')::boolean
       and (pg_temp.vrow(${T(2)})).start_hp = ((pg_temp.vrow(${T(2)})).state->'fight'->'enemies'->0->>'max')::numeric and before = after`,
      `jsonb_build_object('a', a->'error', 'x', x->'error', 'live', (pg_temp.vrow(${T(2)})).live, 'diff', (select jsonb_agg(q.key) from jsonb_each(before) q where after->q.key is distinct from q.value))`)}
  `)}
  -- HO8 every spawn-list name maps to one v2 key
  o := (select coalesce(jsonb_agg(z), '[]'::jsonb) from (select distinct n2 as z from (select jsonb_array_elements_text(coalesce((select value from balance where key = 'hunt_bosses'), '[]'::jsonb)) n2) q
         union select distinct name from hunts) w where hunt_v2_boss_key(z) is null and z <> 'The ' || 'nobody');
  ${add('HO8 every boss name of the Hunt (every hunts name; the hunt_bosses list when it exists) maps to one hunt_bosses_v2 key',
    `jsonb_array_length(o) = 0 and (select count(*) from hunts) > 0`, 'o')}
  -- HO9 the flag OFF during a live day: the credit continues to its end (the mark)
  ${sub(String.raw`
    perform pg_temp.flag(true);
    a := hunt_v2_start(${M(2)}, sq);
    perform pg_temp.flag(false);
    c0 := (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid and player_id = ${M(2)});
    x := hunt_v2_auto(${M(2)}, 1000);
    c1 := (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid and player_id = ${M(2)});
    rw := pg_temp.vrow(${M(2)});
    ${add('HO9 rollback (v2 side): a live day keeps crediting after the flag goes OFF (the hunt_hits grow by the credit of the call)',
      `(a->>'ok')::boolean and rw.live and (x->>'ok')::boolean and c1 - c0 = coalesce((x->'credit'->>'total')::bigint, 0) and c1 > c0`,
      `jsonb_build_object('c0', c0, 'c1', c1, 'credit', x->'credit'->'total', 'err', x->'error')`)}
  `)}
  -- HO10b the v1 side
  ${sub(String.raw`
    perform pg_temp.flag(true);
    x := hunt_attack(${M(3)}, hid, na[1]); y := hunt_support(${M(3)}, hid, sup[1], null);
    ${add('HO10b flag ON: v1 hunt_attack and hunt_support answer v2_on', `x->>'error' = 'v2_on' and y->>'error' = 'v2_on'`, `jsonb_build_object('attack', x, 'support', y)`)}
    a := hunt_v2_start(${M(4)}, sq);
    perform pg_temp.flag(false);
    x := hunt_attack(${M(4)}, hid, na[5]); y := hunt_support(${M(4)}, hid, sup[3], null);
    ${add('HO10b flag OFF after a live day today: hunt_attack and hunt_support answer v2_today', `(a->>'ok')::boolean and x->>'error' = 'v2_today' and y->>'error' = 'v2_today'`, `jsonb_build_object('attack', x, 'support', y)`)}
    x := hunt_attack(${M(5)}, hid, na[1]);
    perform pg_temp.flag(true);
    a := hunt_v2_start(${M(5)}, sq);
    ${add('HO10b a member with v1 rows today (no v2 day): a live start answers v1_today and writes no day row',
      `(x->>'ok')::boolean and a->>'error' = 'v1_today' and not exists (select 1 from hunt_v2_days where player_id = ${M(5)})`, `jsonb_build_object('v1', x->'error', 'start', a)`)}
  `)}
  -- HO11 grants of the new functions, the guard, a second run
  ${add('HO11 the new functions: no EXECUTE for anon or authenticated; EXECUTE for service_role; a [combat] comment that names the file',
    `(select pg_temp.all_true(not has_function_privilege('anon', z::regprocedure, 'EXECUTE') and not has_function_privilege('authenticated', z::regprocedure, 'EXECUTE')
        and has_function_privilege('service_role', z::regprocedure, 'EXECUTE') and coalesce(obj_description(z::regprocedure, 'pg_proc'), '') like '[combat]%combat_v2_on_hunt.sql%')
       from unnest(array['hunt_v2_credit(jsonb, jsonb, numeric)', 'hunt_v2_shared(bigint, text, date, jsonb)', 'hunt_v2_live_credit(bigint, text, date, jsonb)', 'hunt_v2_start(text, bigint[])', 'hunt_v2_turns(text, jsonb, boolean, integer)', 'hunt_v2_view(text)']) z)`)}
  msg := null;
  begin execute $m$${mig}$m$; exception when others then msg := sqlerrm; end;
  ${add('HO11 the file runs a second time with no error', 'msg is null', 'to_jsonb(msg)')}
  msg := null;
  begin
    execute replace(pg_get_functiondef('public.hunt_attack(text, bigint, bigint)'::regprocedure), 'AS $function$', 'AS $function$ ');
    begin execute $m$${mig}$m$; exception when others then msg := sqlerrm; end;
    raise exception 'r3on_rollback';
  exception when others then if sqlerrm <> 'r3on_rollback' then msg := 'the plant raised: ' || sqlerrm; end if;
  end;
  ${add('HO11 the guard: an unknown hunt_attack text (one space added) makes the file refuse', `msg like '%changed since this file was built%'`, 'to_jsonb(msg)')}
  -- HO12 the auto-pick pool = the dungeon_v2_unit stats (by id) with the fight speed
  ${sub(String.raw`
    perform pg_temp.flag(true);
    create temp table r3on_pick (p jsonb) on commit drop;
    alter function public.combat_v2_autopick(jsonb, jsonb, integer, jsonb, jsonb) rename to r3on_real_pick;
    execute 'create function public.combat_v2_autopick(p_pool jsonb, p_boss jsonb, p_cap integer, p_b jsonb default null, p_a jsonb default null) returns jsonb language plpgsql as $w$ begin insert into r3on_pick values (p_pool); return public.r3on_real_pick(p_pool, p_boss, p_cap, p_b, p_a); end $w$';
    update player_cards set ascension = 2 where player_id = ${M(6)} and card_id = na[2];
    a := hunt_v2_start(${M(6)}, null);
    o := (select p from r3on_pick limit 1);
    ${add('HO12 the auto-pick pool: each card (by id) has the atk, crt, crd of dungeon_v2_unit and spd = combat_v2_speed of that unit (a 2-star card: its 2-star stats)',
      `(a->>'ok')::boolean and jsonb_array_length(o) >= 6 and (select pg_temp.all_true(z->'atk' = dungeon_v2_unit(${M(6)}, (z->>'id')::bigint)->'atk'
          and z->'crt' = dungeon_v2_unit(${M(6)}, (z->>'id')::bigint)->'crt' and z->'crd' = dungeon_v2_unit(${M(6)}, (z->>'id')::bigint)->'crd'
          and (z->>'spd')::numeric = combat_v2_speed(dungeon_v2_unit(${M(6)}, (z->>'id')::bigint), 0, b)) from jsonb_array_elements(o) z)
       and (select (z->>'atk')::numeric from jsonb_array_elements(o) z where (z->>'id')::bigint = na[2]) > (combat_v2_card_unit(na[2])->>'atk')::numeric`,
      `jsonb_build_object('n', jsonb_array_length(o), 'err', a->'error', 'first', o->0)`)}
  `)}
`);

// ---------------------------------------------------------------------------------------------------------- B2: HO2, HO3 (seeded live days), HO5, HO6
const B2 = (from, to) => block(String.raw`
  perform pg_temp.flag(true);
  out := '[]';
  for i in ${from} .. ${to} loop
    begin
      perform setseed(i / 100.0);
      a := hunt_v2_start(${M(10)}, sq);
      rw := pg_temp.vrow(${M(10)});
      sc := 80000 / (rw.state->'fight'->'enemies'->0->>'max')::numeric;
      row0 := jsonb_build_object('seed', i, 'calls', 0, 'bad', '[]'::jsonb);
      h0 := (select hp_remaining from hunts where id = hid); sh0 := pg_temp.hits(hid, ${M(10)});
      lg := a->'log';
      -- the calls: auto 3, auto 3, auto 1000 (each checked)
      for n in 1 .. 4 loop
        e := pg_temp.expect(lg, to_jsonb(rw.squad), sc);
        h1 := (select hp_remaining from hunts where id = hid); sh1 := pg_temp.hits(hid, ${M(10)});
        -- the credit of the call: hunt_hits grow by the scaled decreases (rounded total), the boss HP by the same, per card the largest remainder
        ok := (select coalesce(sum(v::bigint), 0) from jsonb_each_text(sh1) q(k, v)) - (select coalesce(sum(v::bigint), 0) from jsonb_each_text(sh0) q(k, v)) = (e->>'total')::bigint
          and h0 - h1 = (e->>'total')::bigint
          and (select pg_temp.all_true(abs(coalesce((sh1->>k)::bigint, 0) - coalesce((sh0->>k)::bigint, 0) - (e->'per'->>k)::numeric) < 1) from jsonb_object_keys(e->'per') k);
        if not ok then row0 := jsonb_set(row0, '{bad}', (row0->'bad') || jsonb_build_object('call', n, 'expect', e - 'per', 'hits_delta',
             (select coalesce(sum(v::bigint), 0) from jsonb_each_text(sh1) q(k, v)) - (select coalesce(sum(v::bigint), 0) from jsonb_each_text(sh0) q(k, v)), 'hp_delta', h0 - h1)); end if;
        row0 := row0 || jsonb_build_object('calls', n, 'credited', (row0->>'credited')::numeric + (e->>'raw')::numeric);
        exit when (pg_temp.vrow(${M(10)})).status = 'over' or n = 4;
        h0 := h1; sh0 := sh1;
        x := case when n < 3 then hunt_v2_auto(${M(10)}, 3) else hunt_v2_auto(${M(10)}, 1000) end;
        if not (x->>'ok')::boolean then row0 := jsonb_set(row0, '{bad}', (row0->'bad') || jsonb_build_object('err', x->'error')); exit; end if;
        lg := x->'log';
      end loop;
      -- HO3: one hunt_combat_log row per credited card per call: the log sum = the hunt_hits sum; HO6 reconcile 0
      row0 := row0 || jsonb_build_object('log_eq', (select coalesce(sum(damage), 0) from hunt_combat_log where hunt_id = hid and player_id = ${M(10)}) = (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid and player_id = ${M(10)}),
        'reconcile', (select coalesce(sum(unexplained), 0) from hunt_damage_reconcile(hid)) = 0,
        'credited_eq', (pg_temp.vrow(${M(10)})).credited = (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid and player_id = ${M(10)}),
        'hits_total', (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid and player_id = ${M(10)}));
      out := out || jsonb_build_array(row0);
      raise exception 'r3on_rollback';
    exception when others then if sqlerrm <> 'r3on_rollback' then out := out || jsonb_build_array(jsonb_build_object('seed', i, 'raised', sqlerrm)); end if;
    end;
  end loop;
  res := out;
`);

// ---------------------------------------------------------------------------------------------------------- B3: HO2 heal, HO2b, HO4, HO5
const B3 = block(String.raw`
  -- HO2 a planted heal adds 0; a planted decrease is scaled
  e := hunt_v2_credit('[{"k": "act", "actor": {"side": "card", "id": 7}, "hp": [{"side": "enemy", "id": 0, "before": 100, "after": 130}]}]'::jsonb, '[7]'::jsonb, 10);
  y := hunt_v2_credit('[{"k": "act", "actor": {"side": "card", "id": 7}, "hp": [{"side": "enemy", "id": 0, "before": 100, "after": 97.5}]}, {"k": "clock", "hp": [{"side": "enemy", "id": 0, "before": 97.5, "after": 97.2}]}]'::jsonb, '[9, 7]'::jsonb, 10);
  ${add('HO2 a planted boss heal is credited 0; decreases are scaled (an act to its actor, a tick to the first squad card) with the largest remainder',
    `(e->>'total')::bigint = 0 and (y->>'total')::bigint = 28 and (y->'cards'->>'7')::bigint = 25 and (y->'cards'->>'9')::bigint = 3`, `jsonb_build_object('heal', e, 'dec', y)`)}
  perform pg_temp.flag(true);
  -- HO5 the bridge rows after a live start; the daily task and raider read them
  ${sub(String.raw`
    o := ach_track_values(${M(11)});
    a := hunt_v2_start(${M(11)}, sq);
    ${add('HO5 a live start writes one hunt_card_hp row per squad card, downed, hp = max = the unit max rounded',
      `(a->>'ok')::boolean and (select count(*) from hunt_card_hp where hunt_id = hid and player_id = ${M(11)} and hit_date = hunt_v2_today() and downed) = cardinality(sq)
       and (select pg_temp.all_true(hc.max_hp = round((a->'units'->(hc.card_id::text)->>'max')::numeric)) from hunt_card_hp hc where hc.hunt_id = hid and hc.player_id = ${M(11)})`,
      `(select jsonb_agg(jsonb_build_object('c', card_id, 'd', downed, 'max', max_hp)) from hunt_card_hp where hunt_id = hid and player_id = ${M(11)})`)}
    ${add('HO5 the v1 readers count the day: dailies_tasks hunt done; ach_track_values raider + 1',
      `(select (z->>'done')::boolean from jsonb_array_elements(dailies_tasks(${M(11)})) z where z->>'task' = 'hunt')
       and (ach_track_values(${M(11)})->>'raider')::int = (o->>'raider')::int + 1`,
      `jsonb_build_object('tasks', dailies_tasks(${M(11)}), 'raider', jsonb_build_array(o->'raider', ach_track_values(${M(11)})->'raider'))`)}
  `)}
  -- HO2b planted: a Poison on the boss at the start (a stand-in synergy plants it), so the first step ticks it
  ${sub(String.raw`
    alter function public.combat_v2_step(jsonb, jsonb, jsonb) rename to r3on_real_step;
    execute 'create function public.combat_v2_step(p_state jsonb, p_choice jsonb, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $w$
      declare r jsonb := public.r3on_real_step(p_state, p_choice, p_b); hp numeric;
      begin
        if p_choice is not null and p_choice <> ''null''::jsonb then return r; end if;
        hp := (r->''state''->''enemies''->0->>''hp'')::numeric;
        r := jsonb_set(r, ''{state,enemies,0,hp}'', to_jsonb(hp - 7));
        return jsonb_set(r, ''{log}'', (r->''log'') || jsonb_build_array(jsonb_build_object(''k'', ''clock'', ''hp'', jsonb_build_array(jsonb_build_object(''side'', ''enemy'', ''id'', 0, ''before'', hp, ''after'', hp - 7)))));
      end $w$';
    a := hunt_v2_start(${M(13)}, sq);
    rw := pg_temp.vrow(${M(13)});
    e := pg_temp.expect(a->'log', to_jsonb(rw.squad), 80000 / (rw.state->'fight'->'enemies'->0->>'max')::numeric);
    ${add('HO2b planted: a start whose first step decreases the boss HP (a step wrapper plants a 7 HP decrease) writes its scaled credit (hunt_hits, credited, the boss HP)',
      `(a->>'ok')::boolean and (e->>'total')::bigint > 0 and rw.credited = (e->>'total')::bigint
       and (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid and player_id = ${M(13)}) = (e->>'total')::bigint
       and (select hp_remaining from hunts where id = hid) = 32000 - (e->>'total')::bigint`,
      `jsonb_build_object('expect', e - 'per', 'credited', rw.credited, 'err', a->'error', 'hp', (select hp_remaining from hunts where id = hid), 'resists', (select resists from hunt_bosses_v2 where key = bk), 'log', (select jsonb_agg(jsonb_build_object('k', z->'k', 'actor', z->'actor', 'ticks', z->'ticks', 'hp', z->'hp')) from jsonb_array_elements(a->'log') z), 'boss_status', rw.state->'fight'->'enemies'->0->'status')`)}
  `)}
  -- HO4 the defeat: boss HP 50 in the block; the ending call defeats, settles once, one defeat event; hunt_hits get the full credit
  ${sub(String.raw`
    update hunts set hp_remaining = 50 where id = hid;
    a := hunt_v2_start(${M(14)}, sq);
    rw := pg_temp.vrow(${M(14)});
    -- the private boss at a frac of 50 / 80000 is tiny; the cards get 100 x HP, so the squad outlives it and the call crosses 0
    update hunt_v2_days set state = jsonb_set(state, '{fight,cards}', (select jsonb_object_agg(q.key, q.value || jsonb_build_object('hp', (q.value->>'max')::numeric * 100, 'max', (q.value->>'max')::numeric * 100)) from jsonb_each(state->'fight'->'cards') q))
     where player_id = ${M(14)} and day = hunt_v2_today();
    -- overkill: the shared boss has 5 HP left while the day credits about 50 (the clamp: HP stops at 0, hunt_hits get the full credit)
    update hunts set hp_remaining = 5 where id = hid;
    x := hunt_v2_auto(${M(14)}, 1000);
    ${add('HO4 the defeating call: status defeated, defeated_at set, hp 0, settle_hunt once (settled_at), exactly one defeat event; hunt_hits = the full credit (the v1 clamp)',
      `(select status from hunts where id = hid) = 'defeated' and (select defeated_at is not null and settled_at is not null and hp_remaining = 0 from hunts where id = hid)
       and (select count(*) from hunt_events where hunt_id = hid and kind = 'defeat') = 1
       and (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid and player_id = ${M(14)}) = (pg_temp.vrow(${M(14)})).credited
       and (pg_temp.vrow(${M(14)})).credited >= 40`,
      `jsonb_build_object('status', (select status from hunts where id = hid), 'events', (select count(*) from hunt_events where hunt_id = hid and kind = 'defeat'),
         'credited', (pg_temp.vrow(${M(14)})).credited, 'hits', (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid), 'start', a->'error', 'auto', x->'error', 'credit', x->'credit')`)}
  `)}
  -- HO4 a call that does not defeat: no settle, no defeat event
  ${sub(String.raw`
    a := hunt_v2_start(${M(16)}, sq); x := hunt_v2_auto(${M(16)}, 3);
    ${add('HO4 calls that do not defeat the boss: no settle (settled_at null) and no defeat event',
      `(a->>'ok')::boolean and (select settled_at is null and status = 'active' from hunts where id = hid) and not exists (select 1 from hunt_events where hunt_id = hid and kind = 'defeat')`,
      `jsonb_build_object('status', (select status from hunts where id = hid), 'settled', (select settled_at from hunts where id = hid))`)}
  `)}
`);


// ---------------------------------------------------------------------------------------------------------- B4: HO2b seeded live starts (chunks)
const B4 = (from, to) => block(String.raw`
  perform pg_temp.flag(true);
  out := '[]';
  for i in ${from} .. ${to} loop
    begin
      perform setseed(i / 100.0);
      before := pg_temp.snap();
      a := hunt_v2_start(${M(12)}, sq);
      after := pg_temp.snap(); rw := pg_temp.vrow(${M(12)});
      e := pg_temp.expect(a->'log', to_jsonb(rw.squad), 80000 / (rw.state->'fight'->'enemies'->0->>'max')::numeric);
      if (e->>'total')::bigint > 0 then
        ok := rw.credited = (e->>'total')::bigint;
      else
        ok := (select pg_temp.all_true(q.key in ('hunt_card_hp') or after->q.key = q.value) from jsonb_each(before) q) and rw.credited = 0;
      end if;
      out := out || jsonb_build_array(jsonb_build_object('seed', i, 'dec', (e->>'total')::bigint > 0, 'ok', coalesce(ok, false) and (a->>'ok')::boolean, 'credited', rw.credited, 'expect', e - 'per'));
      raise exception 'r3on_rollback';
    exception when others then if sqlerrm <> 'r3on_rollback' then out := out || jsonb_build_array(jsonb_build_object('seed', i, 'raised', sqlerrm)); end if;
    end;
  end loop;
  res := out;
`);

// ---------------------------------------------------------------------------------------------------------- B5: HL1-HL4 (R3-ON-FIX, the answer keys)
// POST-SWITCH-TRIAGE item 1: the start, act and auto answers of a LIVE member day must say live true, practice false, and carry the shared
// boss bar (hunt.live_frac) read AFTER the credit of the call; a tester practice day keeps practice true. The client rule huntLive reads
// v.live and v.day.live (tcg-activity/src/ui-v2-gauntlet2.js).
const B5 = block(String.raw`
  -- an answer of hunt_v2_out: ok, live = w, practice = not w, day.live = w, hunt = this Hunt with live_frac = the boss HP now (after the call)
  create function pg_temp.ans_ok(a jsonb, w boolean, h bigint) returns boolean language sql as $x$
    select coalesce((a->>'ok')::boolean, false) and a->'live' = to_jsonb(w) and a->'practice' = to_jsonb(not w) and a->'day'->'live' = to_jsonb(w)
      and (a->'hunt'->>'id')::bigint = h and (a->'hunt'->>'live_frac')::numeric = (select hp_remaining::numeric / hp_max from hunts where id = h)
      and a->'hunt' ? 'name' and a->'hunt' ? 'tier' and a->'hunt' ? 'closes_at' $x$;
  create function pg_temp.keys_of(a jsonb) returns jsonb language sql as $x$
    select jsonb_build_object('live', a->'live', 'practice', a->'practice', 'day_live', a->'day'->'live', 'hunt', a->'hunt', 'credit', a->'credit'->'total', 'err', a->'error') $x$;
  create function pg_temp.choice(p text) returns jsonb language plpgsql as $x$
  declare f jsonb := (pg_temp.vrow(p)).state->'fight'; d jsonb := combat_v2_auto(f, f->'ext'->'turn', combat_v2_enemy_numbers(), null);
  begin return jsonb_build_object('use', d->'use', 'target', d->'target', 'ally', d->'ally'); end $x$;
  -- HL1 a member (not a tester), the flag ON: start, act, auto
  ${sub(String.raw`
    perform pg_temp.flag(true);
    perform setseed(0.31);
    a := hunt_v2_start(${M(20)}, sq);
    ${add('HL1 member live day: the START answer has live true, practice false, day.live true, hunt (id, name, tier, closes_at) and live_frac = the boss HP after the call',
      `pg_temp.ans_ok(a, true, hid) and (a->>'status') = 'active'`, `pg_temp.keys_of(a)`)}
    x := hunt_v2_act(${M(20)}, pg_temp.choice(${M(20)}));
    ${add('HL1 member live day: the ACT answer has live true, practice false, day.live true, hunt.live_frac = the boss HP after the credit of the act',
      `pg_temp.ans_ok(x, true, hid)`, `pg_temp.keys_of(x)`)}
    y := hunt_v2_auto(${M(20)}, 3);
    ${add('HL1 member live day: the AUTO answer has live true, practice false, day.live true, hunt.live_frac = the boss HP after the credit of the auto',
      `pg_temp.ans_ok(y, true, hid)`, `pg_temp.keys_of(y)`)}
    ${add('HL1 the bar moves with the credit: the act + auto credit > 0, and the auto answer live_frac = (32000 - every hunt_hits damage) / 80000 < 0.4',
      `coalesce((y->'credit'->>'total')::bigint, 0) + coalesce((x->'credit'->>'total')::bigint, 0) > 0
       and (y->'hunt'->>'live_frac')::numeric < 0.4 and (y->'hunt'->>'live_frac')::numeric = (32000 - (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid)) / 80000.0`,
      `jsonb_build_object('act', pg_temp.keys_of(x), 'auto', pg_temp.keys_of(y), 'hits', (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid))`)}
    -- HL4 the view during the active day: the same hunt object as the answer (the shape of hunt_v2_view), live = the flag
    o := hunt_v2_view(${M(20)});
    ${add('HL4 the hunt object of the answer = the hunt object of hunt_v2_view (same keys, same values); the view keeps live true, practice false',
      `o->'hunt' = hunt_v2_out(hid, ${M(20)}, hunt_v2_today(), '{}'::jsonb)->'hunt' and o->'live' = 'true'::jsonb and o->'practice' = 'false'::jsonb`,
      `jsonb_build_object('view', o->'hunt', 'out', hunt_v2_out(hid, ${M(20)}, hunt_v2_today(), '{}'::jsonb)->'hunt')`)}
  `)}
  -- HL2 a tester practice day, the flag OFF: practice true, live false (start, act, auto)
  ${sub(String.raw`
    perform setseed(0.31);
    a := hunt_v2_start(${T(3)}, sq);
    x := hunt_v2_act(${T(3)}, pg_temp.choice(${T(3)}));
    y := hunt_v2_auto(${T(3)}, 3);
    ${add('HL2 tester practice day (flag OFF): the start, act and auto answers have live false, practice true, day.live false; no shared write (live_frac stays 32000 / 80000)',
      `pg_temp.ans_ok(a, false, hid) and pg_temp.ans_ok(x, false, hid) and pg_temp.ans_ok(y, false, hid) and (y->'hunt'->>'live_frac')::numeric = 0.4`,
      `jsonb_build_object('start', pg_temp.keys_of(a), 'act', pg_temp.keys_of(x), 'auto', pg_temp.keys_of(y))`)}
  `)}
  -- HL3 the mark, not the flag: a live day started with the flag ON answers live true after the flag goes OFF
  ${sub(String.raw`
    perform pg_temp.flag(true);
    perform setseed(0.31);
    a := hunt_v2_start(${M(21)}, sq);
    perform pg_temp.flag(false);
    y := hunt_v2_auto(${M(21)}, 3);
    ${add('HL3 a live day after the flag goes OFF (rollback): the auto answer still has live true, practice false (the day mark, INV-ON-1)',
      `(a->>'ok')::boolean and pg_temp.ans_ok(y, true, hid)`, `jsonb_build_object('start', pg_temp.keys_of(a), 'auto', pg_temp.keys_of(y))`)}
  `)}
`);

// ---------------------------------------------------------------------------------------------------------- H: HO4b, HO7 (two real connections)
// The M1d / R3a H3 method: real requests on pooled connections, a COMMITTED sample (members 043xx, sample Hunts marked weak_points
// ["r3on_h_sample"], the flag combat_v2.hunt ON), removed in a finally step (the flag back to OFF). The copy must have R3-ON applied; an H
// mutation applies the R3a file + the mutated R3-ON file, and the finally step applies the R3a file + the clean file again.
// Each lock case: B starts only when A is SEEN holding its lock (A sleeping after its locking statement, with an xid); the times are the
// server times of the statements; A's hold is 3 s. ROUNDS=<n> (default 20, the spec number).
const ROUNDS = Number(process.env.ROUNDS || 20);
const HP = Array.from({ length: 300 }, (_, i) => id('043', i + 1));   // the members of the harness (each round uses new ones)
const HMARK = '["r3on_h_sample"]';
const HBY = 'r3on-h-test';
async function hq(sql) {
  const { rawQuery } = await import('./lab-lib.mjs');
  const t = await rawQuery(sql);
  let j; try { j = JSON.parse(t); } catch { return { error: t }; }
  if (!Array.isArray(j)) return { error: j.message || j.error || t, code: (String(j.message || '').match(/ERROR:\s+([0-9A-Z]{5}):/) || [])[1] };
  return { rows: j };
}
const hsleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HL = (s) => lit(s);
const hCleanup = String.raw`do $x$
declare tb text;
begin
  perform set_config('balance.by', '${HBY}', true);
  -- the flag back to OFF only when this harness set it (its balance_log row): a copy after the switch keeps its flag ON
  if exists (select 1 from public.balance_log where changed_by = '${HBY}') then
    update public.balance set value = jsonb_set(value, '{hunt}', 'false') where key = 'combat_v2' and value->'hunt' = 'true'::jsonb;
  end if;
  delete from public.balance_log where changed_by = '${HBY}';
  for tb in select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
             where c.table_schema = 'public' and c.column_name = 'player_id' and t.table_type = 'BASE TABLE' and c.table_name <> 'players' loop
    execute format('delete from public.%I where player_id = any(%L::text[])', tb, array[${HP.map(HL).join(', ')}]);
  end loop;
  delete from public.hunt_events where hunt_id in (select id from public.hunts where weak_points = '${HMARK}'::jsonb);
  delete from public.hunt_hits where hunt_id in (select id from public.hunts where weak_points = '${HMARK}'::jsonb);
  delete from public.hunts where weak_points = '${HMARK}'::jsonb;
  delete from public.players where id = any(array[${HP.map(HL).join(', ')}]);
  if to_regprocedure('public.r3on_h_real_step(jsonb, jsonb, jsonb)') is not null then
    drop function public.combat_v2_step(jsonb, jsonb, jsonb);
    alter function public.r3on_h_real_step(jsonb, jsonb, jsonb) rename to combat_v2_step;
  end if;
  if to_regprocedure('public.r3on_h_synstub()') is not null then
    drop function public.combat_v2_synergy(jsonb, jsonb); drop function public.r3on_h_synstub();
  end if;
end $x$;`;
// the server time of B's statement (a lock wait is inside it, a proxy wait is not) and its end time
const hTimed = (call, timeout = true) => `/* r3on_B */ with z as materialized (select ${timeout ? "set_config('lock_timeout', '500ms', true)" : "''::text"} v), s as materialized (select ${call} r from z) select s.r, round(extract(epoch from clock_timestamp() - statement_timestamp()) * 1000)::int as server_ms, clock_timestamp() as b_end from s;`;
// A: one statement that locks and then sleeps 3 s in one transaction (its marker in the text), then its end time
const hHold = (call) => `/* r3on_A */ with a as materialized (select ${call} r) select a.r, pg_sleep(3) as s, clock_timestamp() as a_end from a;`;
const hHoldDo = (body, sleep = 3) => `/* r3on_A */ do $h$ begin ${body} perform pg_sleep(${sleep}); end $h$; select clock_timestamp() as a_end;`;
// lock first, sleep, then the call (the window in which B starts)
const hLockThen = (lock, call) => `/* r3on_A */ do $h$ begin ${lock} perform pg_sleep(1.5); perform ${call}; end $h$; select clock_timestamp() as a_end;`;
const hSeenA = String.raw`do $x$ declare k int := 0; begin
  loop
    perform pg_stat_clear_snapshot();
    exit when exists (select 1 from pg_stat_activity a where a.pid <> pg_backend_pid() and a.wait_event = 'PgSleep' and a.backend_xid is not null and a.query like '%/* r3on_A */%');
    k := k + 1; if k > 300 then raise exception 'A did not hold its lock within 15 s'; end if;
    perform pg_sleep(0.05);
  end loop; end $x$; select 1 as held;`;
const SQ_SQL = `(select array_agg(card_id order by card_id) from public.player_cards where player_id = ${HL(HP[0])})`;
// the active sample Hunt: every other sample Hunt expires; hp_remaining as given
const hNewHunt = (hp) => String.raw`do $x$ begin
  update public.hunts set status = 'expired' where weak_points = '${HMARK}'::jsonb and status = 'active';
  insert into public.hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || (select x.name from public.hunt_bosses_v2 x order by x.ord limit 1), 'Heroic', '${HMARK}'::jsonb, 80000, ${hp}, now() + interval '1 hour', now() + interval '2 days', 'active');
end $x$; select (select id from public.hunts where weak_points = '${HMARK}'::jsonb and status = 'active') as hunt;`;
const hStart = async (p) => (await hq(`select hunt_v2_start(${HL(p)}, ${SQ_SQL}) r;`)).rows?.[0]?.r;
// a member's day with the cards at 100 x HP (so a day lasts many calls) and a card turn now
const hTough = (p) => `update public.hunt_v2_days set state = jsonb_set(state, '{fight,cards}', (select jsonb_object_agg(q.key, q.value || jsonb_build_object('hp', (q.value->>'max')::numeric * 100, 'max', (q.value->>'max')::numeric * 100)) from jsonb_each(state->'fight'->'cards') q)) where player_id = ${HL(p)} and status = 'active';`;

async function runH() {
  const out = []; const add3 = (name, ok, got) => out.push({ name, ok, got });
  const hm = ['lock_at_start', 'shared_lock_for_update', 'players_before_hunts', 'retry_commits_twice', 'defeat_event_twice', 'no_status_recheck', 'writes_after_close'];
  const mutated = hm.includes(process.env.MUTATE);
  const Q = '$' + 'm' + '$';
  let pn = 0; const nextP = () => HP[++pn];   // HP[0] owns the cards of the squad query; every member owns them
  // A setup start can end the day in its start step (squad_down before any card turn: observed once in about 120 actor starts,
  // 2026-11-05, ho7e-r5-run2). Such a member has no live day, so the round could not test the lock cycle. The harness then takes the next
  // member (at most 3 tries) and records the skip. This changes only the set-up, never a check of a round.
  const skips = [];
  const liveP = async (where) => {
    for (let t = 0; t < 3; t++) {
      const p = nextP(); const s = await hStart(p);
      if (s?.ok === true && s.status === 'active') { await hq(hTough(p)); return { p, s }; }
      const sk = { skip: where, at: new Date().toISOString(), p: HP.indexOf(p), start: s ? { ok: s.ok, error: s.error ?? null, status: s.status ?? null } : null };
      skips.push(sk); if (process.env.HO7E_LOG) appendFileSync(process.env.HO7E_LOG, JSON.stringify(sk) + '\n');
    }
    throw new Error('3 set-up starts in a row gave no active day: ' + JSON.stringify(skips.slice(-3)));
  };
  try {
    const pre = await hq(hCleanup); if (pre.error) throw new Error('cleanup: ' + pre.error);
    const st = await hq(`select to_regprocedure('public.hunt_v2_shared(bigint, text, date, jsonb)') is not null as applied,
      to_regprocedure('public.hunt_v2_boon_plan(jsonb, jsonb, numeric, jsonb, numeric)') is not null as hbp,
      coalesce(obj_description('public.hunt_v2_out(bigint, text, date, jsonb)'::regprocedure, 'pg_proc'), '') like '%combat_v2_hunt_out_live.sql%' as out_fix,
      coalesce(obj_description('public.hunt_v2_view(text)'::regprocedure, 'pg_proc'), '') like '%hunt_v2_view_boss_max.sql%' as view_fix;`);
    if (!st.rows?.[0]?.applied) throw new Error('R3-ON (combat_v2_on_hunt.sql) is not applied on this copy');
    hbpBefore = st.rows[0].hbp === true;
    outBefore = st.rows[0].out_fix === true;
    viewBefore = st.rows[0].view_fix === true;
    if (mutated) { const m = await hq(`do $h$ begin execute ${Q}${r3a}${Q}; execute ${Q}${mig}${Q}; end $h$;`); if (m.error) throw new Error('apply the mutated file: ' + m.error); }
    const setup = await hq(String.raw`do $x$ declare sq bigint[]; begin
      perform set_config('tcg.skip_welcome', 'on', true);
      perform set_config('balance.by', '${HBY}', true);
      if to_regprocedure('public.combat_v2_synergy(jsonb, jsonb)') is null then
        execute 'create function public.combat_v2_synergy(p_state jsonb, p_b jsonb) returns jsonb language sql immutable as ''select p_state''';
        execute 'create function public.r3on_h_synstub() returns void language sql as ''select null''';
      end if;
      sq := array(select c.id from cards c join subjects s on s.id = c.subject_id where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array'
                   and exists (select 1 from roles x where x.key = s.ability_v2->>'role') and c.rarity::text = 'normal' order by s.type in ('Character', 'Creature') desc, c.id limit 6);
      insert into public.players (id, username) select z, 'r3on h ' || z from unnest(array[${HP.map(HL).join(', ')}]) z;
      insert into public.player_cards (player_id, card_id, quantity, first_source) select p, c, 1, 'admin' from unnest(array[${HP.map(HL).join(', ')}]) p, unnest(sq) c;
      update public.balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';
    end $x$; select 1 as ok;`);
    if (setup.error) throw new Error('setup: ' + setup.error);
    const onlyE = process.env.ONLY === 'HO7e';
    if (!onlyE) {
    // ---- (a), (b), (c): a big boss, members with tough days
    let H = (await hq(hNewHunt(80000))).rows?.[0]?.hunt;
    const tough = () => liveP('tough');
    let aOK = 0, aBad = []; let bOK = 0, bBad = []; let cOK = 0, cBad = [];
    let A = await tough();
    for (let k = 0, tries = 0; k < ROUNDS && tries < 3 * ROUNDS; tries++) {
      // (a) A: a real act with a credit, held 3 s; B: a live start of a member with no row today, lock_timeout 500 ms
      const Bp = nextP();
      const Ar = hq(hHold(`hunt_v2_auto(${HL(A.p)}, 1)`));
      const seen = await hq(hSeenA);
      const B = await hq(hTimed(`hunt_v2_start(${HL(Bp)}, ${SQ_SQL})`));
      const a = await Ar;
      const ra = a.rows?.[0]?.r, rb = B.rows?.[0]?.r;
      const held = !seen.error && !!(a.rows?.[0]?.a_end && B.rows?.[0]?.b_end && new Date(a.rows[0].a_end) > new Date(B.rows[0].b_end));
      const credit = Number(ra?.credit?.total || 0);
      const good = !B.error && rb?.ok === true && Number(B.rows?.[0]?.server_ms) < 1000 && held && credit > 0 && Number(rb?.credit?.total || 0) === 0;
      if (ra?.status !== 'active') A = await tough();
      if (!B.error && credit === 0 && ra?.ok) continue;   // A missed: no shared write in this round; the round runs again
      k++;
      if (good) aOK++; else aBad.push({ k, err: B.error ? String(B.error).slice(0, 160) : null, ms: B.rows?.[0]?.server_ms, held, a_credit: credit, a_err: ra?.error, b: rb?.error });
    }
    add3(`HO7 (a) ${ROUNDS} rounds: A holds a real hunt_v2_auto with a credit (FOR NO KEY UPDATE) 3 s; B's live start (no start decrease, lock_timeout 500 ms) answers ok in < 1 s server time, while A still holds`, aOK === ROUNDS, { ok: aOK, bad: aBad.slice(0, 3) });
    let A2 = await tough();
    for (let k = 0, tries = 0; k < ROUNDS && tries < 3 * ROUNDS; tries++) {
      // (b) the same A; B: a shared act of another member: B waits until A commits, then completes
      const Bm = await tough();
      const Ar = hq(hHold(`hunt_v2_auto(${HL(A.p)}, 1)`));
      const seen = await hq(hSeenA);
      const B = await hq(hTimed(`hunt_v2_auto(${HL(Bm.p)}, 1)`, false));
      const a = await Ar;
      const ra = a.rows?.[0]?.r, rb = B.rows?.[0]?.r;
      const after = !!(a.rows?.[0]?.a_end && B.rows?.[0]?.b_end && new Date(B.rows[0].b_end) >= new Date(a.rows[0].a_end));
      const good = !seen.error && !B.error && rb?.ok === true && Number(rb?.credit?.total || 0) > 0 && Number(ra?.credit?.total || 0) > 0 && after;
      if (ra?.status !== 'active') A = await tough();
      if (!B.error && ra?.ok && rb?.ok && (Number(ra?.credit?.total || 0) === 0 || Number(rb?.credit?.total || 0) === 0)) continue;   // a miss: run the round again
      k++;
      if (good) bOK++; else bBad.push({ k, err: B.error ? String(B.error).slice(0, 160) : null, after, a_credit: ra?.credit?.total, b_credit: rb?.credit?.total, b: rb?.error });
      // (c) two shared calls at once: no deadlock
      const C1 = hq(`select hunt_v2_auto(${HL(A2.p)}, 1) r;`); const C2 = hq(`select hunt_v2_auto(${HL(Bm.p)}, 1) r;`);
      const [c1, c2] = await Promise.all([C1, C2]);
      if (!c1.error && !c2.error && c1.rows?.[0]?.r?.ok !== false && c2.rows?.[0]?.r?.ok !== false) cOK++; else cBad.push({ k, e1: c1.error && String(c1.error).slice(0, 120), e2: c2.error && String(c2.error).slice(0, 120), r1: c1.rows?.[0]?.r?.error, r2: c2.rows?.[0]?.r?.error });
      if (c1.rows?.[0]?.r?.status !== 'active') A2 = await tough();
    }
    add3(`HO7 (b) ${ROUNDS} rounds: B's shared act waits until A commits (B ends after A), then completes with its credit; no error`, bOK === ROUNDS, { ok: bOK, bad: bBad.slice(0, 3) });
    add3(`HO7 (c) ${ROUNDS} rounds: two shared calls at once: no deadlock, no error`, cOK === ROUNDS, { ok: cOK, bad: cBad.slice(0, 3) });
    // ---- (d): A (another actor) runs the defeat call; P is a prize winner, not the actor; B = a live start of P (no start decrease)
    let dOK = 0, dBad = [];
    for (let k = 0; k < ROUNDS; k++) {
      H = (await hq(hNewHunt(5))).rows?.[0]?.hunt;
      const P = nextP();
      await hq(`insert into public.hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (${H}, ${HL(P)}, (${SQ_SQL})[1], hunt_v2_today(), 100);`);
      const Ap = (await liveP('d')).p;
      const Ar = hq(hLockThen(`perform 1 from public.hunts where id = ${H} for update;`, `hunt_v2_auto(${HL(Ap)}, 1000)`));
      const seen = await hq(hSeenA);
      const B = await hq(hTimed(`hunt_v2_start(${HL(P)}, ${SQ_SQL})`, false));
      const a = await Ar;
      const rb = B.rows?.[0]?.r;
      const ck = (await hq(`select (select count(*)::int from public.hunt_events where hunt_id = ${H} and kind = 'defeat') ev, (select status from public.hunts where id = ${H}) st;`)).rows?.[0];
      const after = !!(a.rows?.[0]?.a_end && B.rows?.[0]?.b_end && new Date(B.rows[0].b_end) >= new Date(a.rows[0].a_end));
      const good = !seen.error && !a.error && !B.error && ck?.st === 'defeated' && ck?.ev === 1 && rb && (rb.ok === true || rb.error === 'no_hunt') && after;
      if (good) dOK++; else dBad.push({ k, a_err: a.error ? String(a.error).slice(0, 160) : null, b_err: B.error ? String(B.error).slice(0, 160) : rb?.error, ck, after });
    }
    add3(`HO7 (d) ${ROUNDS} rounds: A's defeat call (settle_hunt, grant_packs) while B starts for the prize winner P (not the actor): no deadlock error, B completes after A, one defeat event`, dOK === ROUNDS, { ok: dOK, bad: dBad.slice(0, 3) });
    }
    let H;
    // ---- (e) the two cycles of 3.4; the harness repeats a call once after a 40P01 (the route rule)
    const retry = async (sql) => { let r = await hq(sql); const first = r.error ? { code: r.code || null, msg: String(r.error).slice(0, 200) } : null; let n = 0; if (r.code === '40P01' || r.code === '40001') { n = 1; r = await hq(sql); } return { r, n, first }; };
    // HO7E_LOG=<file>: one JSON line per round (both connections, which aborted, the final rows) (orchestrator 2026-11-04: explain the flake)
    const recs = []; const rec = (o) => { o = { at: new Date().toISOString(), pn, ...o }; recs.push(o); if (process.env.HO7E_LOG) appendFileSync(process.env.HO7E_LOG, JSON.stringify(o) + '\n'); };
    const rowsOf = async (H) => (await hq(`select (select status from public.hunts where id = ${H}) st, (select hp_remaining from public.hunts where id = ${H}) hp, (select settled_at is not null from public.hunts where id = ${H}) settled,
        (select coalesce(jsonb_agg(jsonb_build_object('p', player_id, 'status', status, 'ended_by', ended_by, 'credited', credited, 'live', live) order by player_id), '[]'::jsonb) from public.hunt_v2_days where hunt_id = ${H}) days,
        (select coalesce(jsonb_agg(jsonb_build_object('p', player_id, 'd', s) order by player_id), '[]'::jsonb) from (select player_id, sum(damage) s from public.hunt_hits where hunt_id = ${H} group by 1) z) hits;`)).rows?.[0];
    const dayOf = async (p) => (await hq(`select hunt_v2_today() today, (select jsonb_agg(jsonb_build_object('hunt', hunt_id, 'day', day, 'status', status, 'ended_by', ended_by, 'steps', steps, 'last', state->'last'->>'kind', 'credited', credited)) from public.hunt_v2_days where player_id = ${HL(p)}) rows;`)).rows?.[0];
    const ans = (r) => r ? { ok: r.ok, error: r.error ?? null, status: r.status ?? null, credit: r.credit?.total ?? null } : null;
    const conn = (x) => ({ answer: ans(x.r.rows?.[0]?.r), first: x.first, retried: x.n, final_err: x.r.error ? { code: x.r.code || null, msg: String(x.r.error).slice(0, 200) } : null });
    let eOK = 0, eBad = [];
    for (let k = 0; k < ROUNDS; k++) {
      // (e-a) A = the defeat call of actor P, B = a new start of the same P
      H = (await hq(hNewHunt(5))).rows?.[0]?.hunt;
      const { p: P, s: sP } = await liveP('e-a'); const dP0 = await dayOf(P);
      const Ar = (async () => retry(hLockThen(`perform 1 from public.hunts where id = ${H} for no key update;`, `hunt_v2_auto(${HL(P)}, 1000)`)))();
      const seen = await hq(hSeenA);
      const B = await retry(hTimed(`hunt_v2_start(${HL(P)}, ${SQ_SQL})`, false));
      const a = await Ar;
      const rb = B.r.rows?.[0]?.r;
      const chk = (await hq(`select (select count(*)::int from public.hunt_events where hunt_id = ${H} and kind = 'defeat') ev,
          (select coalesce(sum(damage), 0)::bigint from public.hunt_hits where hunt_id = ${H} and player_id = ${HL(P)}) hits,
          (select coalesce(sum(credited), 0)::bigint from public.hunt_v2_days where hunt_id = ${H} and player_id = ${HL(P)}) cred;`)).rows?.[0];
      const good = !seen.error && !a.r.error && !B.r.error && a.n + B.n <= 1 && rb && (rb.ok === true || rb.error === 'already' || rb.error === 'no_hunt') && chk?.ev === 1 && Number(chk.hits) === Number(chk.cred);
      rec({ k, case: 'e-a', good, seen_err: seen.error ? String(seen.error).slice(0, 160) : null, A: conn(a), B: { ...conn(B), answer: rb ? (rb.ok ? 'ok' : rb.error) : null, credit: rb?.credit ?? null }, chk, rows: await rowsOf(H), P: HP.indexOf(P), P_start: ans(sP), P_day_before: dP0, P_day_after: await dayOf(P) });
      if (good) eOK++; else eBad.push({ k, case: 'e-a', retries: a.n + B.n, a_err: a.r.error && String(a.r.error).slice(0, 120), b: B.r.error ? String(B.r.error).slice(0, 120) : rb?.error, chk });
      // (e-b) A = a defeat call, B = a start whose first step decreases the boss HP (B is a prize winner: its players row is in the settle)
      H = (await hq(hNewHunt(5))).rows?.[0]?.hunt;
      const Bq = nextP();
      await hq(`insert into public.hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (${H}, ${HL(Bq)}, (${SQ_SQL})[1], hunt_v2_today(), 100);`);
      const { p: Ap, s: sA } = await liveP('e-b'); const dA0 = await dayOf(Ap);
      // the plant (committed for this round, removed after): the first step of a start decreases the boss HP by 1
      await hq(String.raw`do $x$ begin
        alter function public.combat_v2_step(jsonb, jsonb, jsonb) rename to r3on_h_real_step;
        execute 'create function public.combat_v2_step(p_state jsonb, p_choice jsonb, p_b jsonb default null) returns jsonb language plpgsql set search_path = public as $w$
          declare r jsonb := public.r3on_h_real_step(p_state, p_choice, p_b); hp numeric;
          begin
            if (p_choice is not null and p_choice <> ''null''::jsonb) or (p_state->>''clock'')::int > 0 then return r; end if;
            hp := (r->''state''->''enemies''->0->>''hp'')::numeric;
            r := jsonb_set(r, ''{state,enemies,0,hp}'', to_jsonb(hp - 1));
            return jsonb_set(r, ''{log}'', (r->''log'') || jsonb_build_array(jsonb_build_object(''k'', ''clock'', ''hp'', jsonb_build_array(jsonb_build_object(''side'', ''enemy'', ''id'', 0, ''before'', hp, ''after'', hp - 1)))));
          end $w$';
      end $x$; select 1 as planted;`);
      const Ar2 = (async () => retry(hLockThen(`perform 1 from public.hunts where id = ${H} for no key update;`, `hunt_v2_auto(${HL(Ap)}, 1000)`)))();
      const seen2 = await hq(hSeenA);
      const B2 = await retry(hTimed(`hunt_v2_start(${HL(Bq)}, ${SQ_SQL})`, false));
      const a2 = await Ar2;
      await hq(String.raw`do $x$ begin drop function public.combat_v2_step(jsonb, jsonb, jsonb); alter function public.r3on_h_real_step(jsonb, jsonb, jsonb) rename to combat_v2_step; end $x$; select 1 as unplanted;`);
      const rb2 = B2.r.rows?.[0]?.r;
      const chk2 = (await hq(`select (select count(*)::int from public.hunt_events where hunt_id = ${H} and kind = 'defeat') ev,
          (select coalesce(sum(damage), 0)::bigint from public.hunt_hits where hunt_id = ${H} and player_id = ${HL(Bq)}) - 100 hits,
          (select coalesce(sum(credited), 0)::bigint from public.hunt_v2_days where hunt_id = ${H} and player_id = ${HL(Bq)}) cred,
          (select coalesce(sum(damage), 0)::bigint from public.hunt_hits where hunt_id = ${H} and player_id = ${HL(Ap)}) ahits,
          (select coalesce(sum(credited), 0)::bigint from public.hunt_v2_days where hunt_id = ${H} and player_id = ${HL(Ap)}) acred;`)).rows?.[0];
      const good2 = !seen2.error && !a2.r.error && !B2.r.error && a2.n + B2.n <= 1 && rb2 && (rb2.ok === true || rb2.error === 'no_hunt') && chk2?.ev === 1
        && Number(chk2.hits) === Number(chk2.cred) && Number(chk2.ahits) === Number(chk2.acred);
      rec({ k, case: 'e-b', good: good2, seen_err: seen2.error ? String(seen2.error).slice(0, 160) : null, A: conn(a2), B: { ...conn(B2), answer: rb2 ? (rb2.ok ? 'ok' : rb2.error) : null, credit: rb2?.credit ?? null }, chk: chk2, rows: await rowsOf(H), Ap: HP.indexOf(Ap), Ap_start: ans(sA), Ap_day_before: dA0, Ap_day_after: await dayOf(Ap), Bq_day_after: await dayOf(Bq) });
      if (good2) eOK++; else eBad.push({ k, case: 'e-b', retries: a2.n + B2.n, a_err: a2.r.error && String(a2.r.error).slice(0, 120), b: B2.r.error ? String(B2.r.error).slice(0, 120) : rb2?.error, chk: chk2 });
    }
    add3(`HO7 (e) ${ROUNDS} rounds of each cycle of 3.4 ((a) the defeat call of P + a new start of P; (b) a defeat call + a start with a start decrease of a prize winner): at most one 40P01 per round, the retry completes (or already / no_hunt), the credits written once, exactly one defeat event`, eOK === 2 * ROUNDS, { ok: eOK, setup_skips: skips.length, bad: recs.filter((r) => !r.good).slice(0, 3) });
    if (!onlyE) {
    // ---- HO4b the race: A sets defeated + settles under FOR UPDATE and commits; B, a live call started before, completes after it
    for (const kind of ['defeat', 'close']) {
      H = (await hq(hNewHunt(30000))).rows?.[0]?.hunt;
      const Bp = (await liveP('HO4b')).p;
      const aBody = kind === 'defeat'
        ? `perform 1 from public.hunts where id = ${H} for update; update public.hunts set hp_remaining = 0, status = 'defeated', defeated_at = now() where id = ${H}; perform settle_hunt(${H}); insert into public.hunt_events (hunt_id, kind, payload) values (${H}, 'defeat', '{}'::jsonb);`
        : `perform 1 from public.hunts where id = ${H} for update; perform close_hunt(${H});`;
      const Ar = hq(hHoldDo(aBody));
      const seen = await hq(hSeenA);
      const B = await hq(hTimed(`hunt_v2_auto(${HL(Bp)}, 5)`, false));
      const a = await Ar;
      const rb = B.rows?.[0]?.r;
      const chk = (await hq(`select (select count(*)::int from public.hunt_events where hunt_id = ${H} and kind = 'defeat') ev, (select status from public.hunts where id = ${H}) st,
          (select count(*)::int from public.hunt_hits where hunt_id = ${H}) hits, (select ended_by from public.hunt_v2_days where hunt_id = ${H} and player_id = ${HL(Bp)}) ended;`)).rows?.[0];
      const good = !seen.error && !a.error && !B.error && chk?.hits === 0 && chk?.ended === 'hunt_over'
        && (kind === 'defeat' ? chk?.ev === 1 && chk?.st === 'defeated' : chk?.st === 'expired' && chk?.ev === 0);
      add3(`HO4b race (${kind === 'defeat' ? 'A defeats and settles' : 'A = close_hunt'}): B's live call, started before, completes after A: ${kind === 'defeat' ? 'one defeat event' : 'status stays expired'}, no hunt_hits row written after, B's day ends hunt_over`,
        good, { a_err: a.error && String(a.error).slice(0, 160), b_err: B.error && String(B.error).slice(0, 160), b: rb?.error ?? rb?.credit, chk });
    }
    }
  } catch (err) {
    add3(`H the test ran (${String(err.message).slice(0, 300)})`, false, null);
  } finally {
    const c = await hq(hCleanup);
    let r = { error: null };
    // HBP (combat_v2_hunt_boons.sql) replaces 3 R3-ON functions: when it was on the copy before the run, apply it again after the clean R3-ON file
    if (mutated) r = await hq(`do $h$ begin execute ${Q}${R3A}${Q}; execute ${Q}${CLEAN}${Q};${hbpBefore ? ` execute ${Q}${HBP_FILE}${Q};` : ''}${outBefore ? ` execute ${Q}${OUT_CLEAN}${Q};` : ''}${viewBefore ? ` execute ${Q}${VIEW_FIX}${Q};` : ''} end $h$;`);
    const left = await hq(`select (select count(*) from public.players where id = any(array[${HP.map(HL).join(', ')}])) + (select count(*) from public.hunts where weak_points = '${HMARK}'::jsonb)
      + (select count(*) from public.balance_log where changed_by = '${HBY}') + (select count(*) from pg_proc where proname in ('r3on_h_real_step', 'r3on_h_synstub')) n,
      (select value->>'hunt' from public.balance where key = 'combat_v2') flag;`);
    add3('H the cleanup removed every sample row (members, Hunts, events, hits, balance_log), the flag is OFF again, the plants are gone' + (mutated ? ', and the clean file is applied again' : ''),
      !c.error && !r.error && Number(left.rows?.[0]?.n) === 0 && left.rows?.[0]?.flag === 'false', { c: c.error, r: r.error, left: left.rows?.[0] });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------- run
let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
const show = (rows) => { for (const r of rows) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 900)); } };
let synOn = null;
const run = async (label, sql) => {
  try { const j = JSON.parse(await runBlock(sql)); if (synOn === null) synOn = j.syn; return j.rows; }
  catch (e) { say(false, `${label}: the test block raised (the file did not apply?)`, String(e.message).slice(0, 1500)); return null; }
};
if (process.env.ONLY === 'OUT') { const r5 = await run('B5', B5); if (r5) show(r5); }
else if (process.env.ONLY !== 'HO7e') {
const r1 = await run('B1', B1); if (r1) show(r1);
console.log(`     SYN on the copy: ${synOn ? 'yes' : 'no (a stand-in combat_v2_synergy that returns the state)'}`);
const rows2 = [];
for (let a = 1; a <= DAYS; a += 10) { const r = await run(`B2 ${a}`, B2(a, Math.min(DAYS, a + 9))); if (r) rows2.push(...r); }
const good = rows2.filter((r) => !r.raised);
say(good.length === DAYS && good.every((r) => r.bad.length === 0),
  `HO2 on ${good.length} seeded live days (start, auto 3, auto 3, auto 1000): at every call the new hunt_hits = the scaled boss HP decreases of the answer log (rounded total), the shared HP decrease = the same, each card within 1 of its exact share (${good.reduce((s, r) => s + (r.hits_total || 0), 0)} credited in all)`,
  JSON.stringify(rows2.filter((r) => r.raised || r.bad.length).slice(0, 2)).slice(0, 1200));
say(good.length > 0 && good.every((r) => r.log_eq), 'HO3 one hunt_combat_log row per credited card: the log damage sum = the hunt_hits sum of the member', JSON.stringify(good.filter((r) => !r.log_eq).slice(0, 2)));
say(good.length > 0 && good.every((r) => r.reconcile && r.credited_eq), 'HO6 hunt_damage_reconcile unexplained = 0; the day credited = its hunt_hits', JSON.stringify(good.filter((r) => !r.reconcile || !r.credited_eq).slice(0, 2)));
const r3 = await run('B3', B3); if (r3) show(r3);
const rows4 = [];
for (let a = 1; a <= STARTS; a += 10) { const r = await run(`B4 ${a}`, B4(a, Math.min(STARTS, a + 9))); if (r) rows4.push(...r); }
say(rows4.length === STARTS && rows4.every((r) => !r.raised && r.ok),
  `HO2b ${rows4.length} seeded live starts: a start with a boss HP decrease writes its scaled credit (${rows4.filter((r) => r.dec).length} had one); a start with none changes no shared row (only the bridge rows)`,
  JSON.stringify(rows4.filter((r) => r.raised || !r.ok).slice(0, 2)).slice(0, 900));
const r5 = await run('B5', B5); if (r5) show(r5);
}
if (process.env.H !== '0' && process.env.ONLY !== 'OUT') { for (const r of await runH()) say(r.ok, r.name, String(JSON.stringify(r.got ?? null)).slice(0, 900)); }
else console.log('SKIP H (H=0): NOT a gate result');
// Review r1 F-3: only the full gate prints "PASS all 37" (30 + R3-ON-FIX HL1-HL4: 7). ONLY, H=0, or fewer DAYS / STARTS / ROUNDS than the spec print PARTIAL (not a gate result).
const GATE_N = 37;
const partial = !!process.env.ONLY || process.env.H === '0' || DAYS < 20 || STARTS < 50 || ROUNDS < 20 || total !== GATE_N;
console.log(fail ? `${fail} of ${total} FAILED` : partial ? `PARTIAL ${total} of ${GATE_N} passed (ONLY=${process.env.ONLY || '-'}, H=${process.env.H ?? '1'}, DAYS ${DAYS}, STARTS ${STARTS}, ROUNDS ${ROUNDS}): NOT a gate result` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
