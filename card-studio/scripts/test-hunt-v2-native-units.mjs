import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/hunt_v2_native_units.sql (item HUNT-V2-NATIVE: the shared Hunt boss in combat v2 units).
 * LOCAL copy only. One DO block per request, undone by its final RAISE: NO lasting change. Each block applies the file (and, for the
 * "as before" cases, the undo file in a rolled-back sub-block), makes its own Hunts and members, and sets the flag combat_v2.hunt per case.
 *   LOCALDB=1 LAB_LOCK_OWNER=<you> node --import ./scripts/localdb-preload.mjs scripts/test-hunt-v2-native-units.mjs    must PASS
 *   MUTATE=<name> ...   must FAIL;   MUTATE=all ...   the baseline, then every mutation (each must FAIL), in one run
 * Cases:
 *   N1  flag ON: spawn_hunt makes each tier in v2 units: hp_max = hp_remaining = round(combat_v2_hunt_boss(tier, key).max),
 *       stats.unit = 'v2', stats.v1_hp = the v1 tier size (balance boss_hp), stats.atk and hp_share as before
 *   N1b flag ON, no v2 boss for the name: v1 units, no mark
 *   N2  flag OFF: spawn_hunt gives the same row as the origin/main function (undo file) with the same random seed
 *   N2b flag ON: spawn_hunt gives the same row as origin/main except hp_max, hp_remaining and stats.unit / stats.v1_hp
 *   N3  a v2-unit day: the private copy starts at hp = hp_remaining, max = hp_max; every call credits 1:1 (hunt_hits delta = shared HP
 *       delta = round(the private decreases)); also when the copy max differs from hp_max (a v2 Hunt is never converted)
 *   N3b a v2-unit Hunt with a fractional v2 max: the member who takes the last HP defeats the boss (hp 0, defeated)
 *   N4  the current-unit row (no stats.unit, hp_max 80000): every call still converts x hp_max / private max
 *   N4b the same with the flag OFF after the start (the live day goes on): still converts
 *   N5  ach_track_values heavy / bighit: a v1-unit Hunt counts x 1, a v2-unit Hunt x v1_hp / hp_max; a member with only v1 rows has the
 *       origin/main values
 *   N6  the file changes no row of hunts (the live Hunt keeps its numbers), runs a second time, and the guard refuses an unknown text
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-hunt-v2-native-units.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const CLEAN = read('../../tcg-bot/supabase/hunt_v2_native_units.sql');
const UNDO = read('../../tcg-bot/supabase/hunt_v2_native_units_undo.sql');

// ---------------------------------------------------------------------------------------------------------- the mutations of the file
const MUT = {
  spawn_never_v2: ["  if combat_v2_on('hunt') then\n    v_key := hunt_v2_boss_key(v_name);", "  if false then\n    v_key := hunt_v2_boss_key(v_name);"],
  spawn_ignores_flag: ["  if combat_v2_on('hunt') then\n    v_key := hunt_v2_boss_key(v_name);", "  if true then\n    v_key := hunt_v2_boss_key(v_name);"],
  spawn_no_mark: ["jsonb_build_object('unit', 'v2', 'v1_hp', v_v1hp)", "jsonb_build_object('v1_hp', v_v1hp)"],
  spawn_v1hp_wrong: ["jsonb_build_object('unit', 'v2', 'v1_hp', v_v1hp)", "jsonb_build_object('unit', 'v2', 'v1_hp', v_hp)"],
  spawn_no_key_v2: ["    if v_key is not null then v_hp := ", "    if true then v_hp := "],
  start_no_copy: ["  if not v_practice and h.stats->>'unit' = 'v2' then boss := boss || ", "  if false then boss := boss || "],
  credit_always_convert: ["case when v_unit = 'v2' then 1 else v_hpmax / v_max end", "v_hpmax / v_max"],
  credit_never_convert: ["case when v_unit = 'v2' then 1 else v_hpmax / v_max end", "1"],
  ach_no_scale: ["case when h.stats->>'unit' = 'v2' then (h.stats->>'v1_hp')::numeric / h.hp_max else 1 end", "1::numeric"],
  ach_scale_all: ["case when h.stats->>'unit' = 'v2' then (h.stats->>'v1_hp')::numeric / h.hp_max else 1 end", "coalesce((h.stats->>'v1_hp')::numeric, 80000) / h.hp_max"],
  ach_bighit_sum: ["'bighit', coalesce(round(max(x.damage * f.k)), 0)", "'bighit', coalesce(round(max(x.damage)), 0)"],
  guard_missing: [/do \$g\$\ndeclare m text; f record;[\s\S]*?-- GUARD-END\n/, ''],
};
function mutate(src, name) {
  const [a, b] = MUT[name];
  const n = a instanceof RegExp ? (src.match(new RegExp(a.source, 'g')) || []).length : src.split(a).length - 1;
  if (n !== 1) throw new Error(`the mutation ${name} does not match exactly once (${n})`);
  const out = a instanceof RegExp ? src.replace(a, b) : src.split(a).join(b);
  return out;
}
const GUARD_RE = /do \$g\$\ndeclare m text; f record;[\s\S]*?-- GUARD-END\n/;
const noGuard = (s) => s.replace(GUARD_RE, '');
for (const s of [CLEAN, UNDO]) if (['$m$', '$t$', '$x$', '$u$'].some((x) => s.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $x$ or $u$');

// ---------------------------------------------------------------------------------------------------------- the shared SQL
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const MEMBERS = Array.from({ length: 6 }, (_, i) => `9000000000000077${String(i + 1).padStart(2, '0')}`);
const M = (i) => lit(MEMBERS[i - 1]);
const DECL = `res jsonb := '[]'; a jsonb; x jsonb; e jsonb; ok boolean; n int; i int; t text; msg text; bk text; bn text; hid bigint; sq bigint[];
  na bigint[]; sup bigint[]; rw record; h0 bigint; h1 bigint; s0 bigint; s1 bigint; sc numeric; row0 jsonb; row1 jsonb; lg jsonb; mx numeric; bad jsonb;
  hs text; hs2 text; fk text; ftier text`;
const WORLD = String.raw`
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_hvn_admin', true);
  update hunts set status = 'expired' where status = 'active';
  -- the boss of the day cases: the first v2 boss whose Weak to role is an attacker role (as test-combat-v2-on-hunt.mjs)
  select x.key, x.name into bk, bn from hunt_bosses_v2 x where exists (select 1 from unnest(x.weak_to) w join roles r on w = 'role:' || r.key where r.class = 'attacker') order by x.ord limit 1;
  create temp table hvn_pool on commit drop as
    select distinct on (c.subject_id, c.rarity) c.id, c.rarity::text as rarity, s.type in ('Character', 'Creature') as att
      from cards c join subjects s on s.id = c.subject_id
     where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from roles y where y.key = s.ability_v2->>'role')
     order by c.subject_id, c.rarity, c.id;
  na := array(select id from hvn_pool where att and rarity = 'normal' order by id limit 12);
  sup := array(select id from hvn_pool where not att and rarity = 'normal' order by id limit 5);
  sq := na[1:4] || sup[1:2];
  insert into players (id, username) select z, 'tst ' || z from unnest(array[${MEMBERS.map(lit).join(', ')}]) z;
  insert into player_cards (player_id, card_id, quantity) select p, c, 1 from unnest(array[${MEMBERS.map(lit).join(', ')}]) p, unnest(na || sup) c on conflict do nothing;
  delete from player_effects where player_id in (${MEMBERS.map(lit).join(', ')});
  create function pg_temp.flag(v boolean) returns void language sql as $x$ update balance set value = jsonb_set(value, '{hunt}', to_jsonb(v)) where key = 'combat_v2' $x$;
  create function pg_temp.vrow(p text) returns hunt_v2_days language sql as $x$ select * from hunt_v2_days where player_id = p and day = hunt_v2_today() order by started_at desc limit 1 $x$;
  -- the expected credit of one answer log x sc (the rule, computed here from the log, not by the function under test)
  create function pg_temp.expect(lg jsonb, sc numeric) returns bigint language sql as $x$
    select coalesce(round(sum(((h->>'before')::numeric - (h->>'after')::numeric) * sc)), 0)::bigint
      from jsonb_array_elements(coalesce(lg, '[]'::jsonb)) e, jsonb_array_elements(coalesce(e->'hp', '[]'::jsonb)) h
     where h->>'side' = 'enemy' and h->>'id' = '0' and (h->>'after')::numeric < (h->>'before')::numeric $x$;
  create function pg_temp.hitsum(h bigint, p text) returns bigint language sql as $x$ select coalesce(sum(damage), 0)::bigint from hunt_hits where hunt_id = h and player_id = p $x$;
  -- one member day: the start, then auto 3, auto 3, auto 1000; each call checked: hunt_hits delta = shared HP delta = expect(log, sc).
  -- sc null = 1 (v2 units); sc 0 = hp_max / the private max of the day (the v1 conversion). Returns {calls, bad[]}
  create function pg_temp.day(p text, hid bigint, sq bigint[], scm numeric, off_after_start boolean default false, tamper_max numeric default null)
  returns jsonb language plpgsql as $x$
  declare a jsonb; lg jsonb; n int; h0 bigint; h1 bigint; s0 bigint; s1 bigint; ex bigint; sc numeric; bad jsonb := '[]'; rw hunt_v2_days; calls int := 0;
  begin
    h0 := (select hp_remaining from hunts where id = hid); s0 := pg_temp.hitsum(hid, p);
    a := hunt_v2_start(p, sq);
    if not coalesce((a->>'ok')::boolean, false) then return jsonb_build_object('calls', 0, 'bad', jsonb_build_array(jsonb_build_object('start', a->'error'))); end if;
    select * into rw from hunt_v2_days where player_id = p and hunt_id = hid order by started_at desc limit 1;
    if tamper_max is not null then
      -- the private copy max differs from hp_max (a day whose copy came from the boss function): the credit must not read it for a v2 Hunt
      update hunt_v2_days set state = jsonb_set(state, '{fight,enemies,0,max}', to_jsonb(tamper_max)) where hunt_id = hid and player_id = p and day = rw.day;
    end if;
    if off_after_start then perform pg_temp.flag(false); end if;
    lg := a->'log';
    for n in 1 .. 4 loop
      sc := case when scm = 0 then (select hp_max from hunts where id = hid)::numeric / (rw.state->'fight'->'enemies'->0->>'max')::numeric else coalesce(scm, 1) end;
      ex := pg_temp.expect(lg, sc);
      h1 := (select hp_remaining from hunts where id = hid); s1 := pg_temp.hitsum(hid, p);
      calls := calls + 1;
      if not (s1 - s0 = ex and h0 - h1 = least(ex, h0)) then
        bad := bad || jsonb_build_object('call', n, 'expect', ex, 'hits_delta', s1 - s0, 'hp_delta', h0 - h1, 'sc', sc);
      end if;
      select * into rw from hunt_v2_days where player_id = p and hunt_id = hid order by started_at desc limit 1;
      exit when rw.status = 'over' or n = 4;
      h0 := h1; s0 := s1;
      a := case when n < 3 then hunt_v2_auto(p, 3) else hunt_v2_auto(p, 1000) end;
      if not coalesce((a->>'ok')::boolean, false) then bad := bad || jsonb_build_object('call', n, 'err', a->'error'); exit; end if;
      lg := a->'log';
    end loop;
    return jsonb_build_object('calls', calls, 'bad', bad, 'credited', rw.credited, 'hits', pg_temp.hitsum(hid, p));
  end $x$;`;
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;
// a sub-block that is always rolled back
const sub = (body) => String.raw`
  begin
    ${body}
    raise exception 'hvn_rollback';
  exception when others then if sqlerrm <> 'hvn_rollback' then res := res || jsonb_build_object('case', 'a sub-block raised', 'ok', false, 'got', to_jsonb(sqlerrm)); end if;
  end;`;
const block = (mig, body, mutated) => String.raw`do $t$
#variable_conflict use_column
declare ${DECL};
begin
  -- N6 (part): the file changes no hunts row
  hs := (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from hunts t);
  execute $m$${mig}$m$;
  hs2 := (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from hunts t);
  ${add('N6 the file changes no row of hunts (the live Hunt keeps its numbers)', 'hs = hs2')}
  ${WORLD}
  ${body}
  raise exception 'RESULT:%', jsonb_build_object('rows', res)::text;
end $t$;`;

// ---------------------------------------------------------------------------------------------------------- B1: spawn (N1, N1b, N2, N2b), N6
const B1 = (mig, mutated) => block(mig, String.raw`
  perform pg_temp.flag(true);
  foreach t in array array['Normal', 'Heroic', 'Mythic'] loop
    ${sub(String.raw`
      perform setseed(0.42);
      hid := spawn_hunt(7, t);
      select * into rw from hunts where id = hid;
      mx := (combat_v2_hunt_boss(t, hunt_v2_boss_key(rw.name))->>'max')::numeric;
      ${add("N1 flag ON: spawn_hunt makes the tier in v2 units (hp_max = hp_remaining = round(v2 max), unit v2, v1_hp = boss_hp, atk, hp_share)",
        `hunt_v2_boss_key(rw.name) is not null and rw.hp_max = round(mx) and rw.hp_remaining = rw.hp_max and rw.stats->>'unit' = 'v2'
         and (rw.stats->>'v1_hp')::bigint = greatest((balance_get('boss_hp')->>'floor')::bigint, balance_num('boss_hp', t)::bigint)
         and rw.stats ? 'atk' and rw.hp_share = (balance_get('boss_hp')->>'heal_share')::bigint`,
        `jsonb_build_object('tier', t, 'name', rw.name, 'hp_max', rw.hp_max, 'v2max', mx, 'stats', rw.stats, 'hp_share', rw.hp_share)`)}`)}
  end loop;
  -- N1b: no v2 boss for any name (the names are changed in this rolled-back sub-block): v1 units, no mark
  ${sub(String.raw`
    update hunt_bosses_v2 set name = name || ' (renamed by the test)';
    hid := spawn_hunt(7, 'Heroic');
    select * into rw from hunts where id = hid;
    ${add('N1b flag ON, no v2 boss for the name: v1 units (balance boss_hp), no unit mark',
      `rw.hp_max = greatest((balance_get('boss_hp')->>'floor')::bigint, balance_num('boss_hp', 'Heroic')::bigint) and not (rw.stats ? 'unit') and not (rw.stats ? 'v1_hp')`,
      `jsonb_build_object('hp_max', rw.hp_max, 'stats', rw.stats)`)}`)}
  -- N2 / N2b: the same seed with the origin/main function (the undo file, rolled back) and with this file
  foreach t in array array['off', 'on'] loop
    perform pg_temp.flag(t = 'on');
    row0 := null;
    begin
      execute $u$${mutated ? noGuard(UNDO) : UNDO}$u$;
      perform setseed(0.31);
      hid := spawn_hunt(7, 'Mythic');
      select to_jsonb(h) - array['id', 'opens_at', 'closes_at', 'created_at'] into row0 from hunts h where h.id = hid;
      raise exception 'hvn_keep:%', row0::text;
    exception when others then
      if sqlerrm like 'hvn_keep:%' then row0 := substr(sqlerrm, 10)::jsonb; else res := res || jsonb_build_object('case', 'the undo sub-block raised', 'ok', false, 'got', to_jsonb(sqlerrm)); end if;
    end;
    ${sub(String.raw`
      perform setseed(0.31);
      hid := spawn_hunt(7, 'Mythic');
      select to_jsonb(h) - array['id', 'opens_at', 'closes_at', 'created_at'] into row1 from hunts h where h.id = hid;
      if t = 'off' then
        ${add('N2 flag OFF: spawn_hunt gives the same row as origin/main (same seed): v1 units, no mark', `row0 is not null and row1 = row0 and not ((row1->'stats') ? 'unit')`,
          `jsonb_build_object('before', row0, 'after', row1)`)}
      else
        ${add('N2b flag ON: spawn_hunt gives the origin/main row except hp_max, hp_remaining and stats.unit / stats.v1_hp',
          `row0 is not null and (row1 - array['hp_max', 'hp_remaining', 'stats']) = (row0 - array['hp_max', 'hp_remaining', 'stats'])
           and (row1->'stats') - array['unit', 'v1_hp'] = row0->'stats' and (row1->'stats'->>'v1_hp')::bigint = (row0->>'hp_max')::bigint
           and (row1->>'hp_max')::bigint <> (row0->>'hp_max')::bigint`,
          `jsonb_build_object('before', row0, 'after', row1)`)}
      end if;`)}
  end loop;
  -- N6: a second run, and the guard
  begin execute $m$${mutated ? noGuard(mig) : mig}$m$; msg := null; exception when others then msg := sqlerrm; end;
  ${add('N6 the file runs a second time with no error', 'msg is null', 'to_jsonb(msg)')}
  ${sub(String.raw`
    execute replace(pg_get_functiondef('public.hunt_v2_live_credit(bigint, text, date, jsonb)'::regprocedure), 'AS $function$', 'AS $function$ ');
    begin execute $m$${mig}$m$; msg := null; exception when others then msg := sqlerrm; end;
    ${add('N6 the guard: an unknown hunt_v2_live_credit text (one space added) makes the file refuse', `msg like '%changed since this file was built%'`, 'to_jsonb(msg)')}`)}
`, mutated);

// ---------------------------------------------------------------------------------------------------------- B2: the credit (N3, N3b, N4, N4b)
const B2 = (mig, mutated) => block(mig, String.raw`
  perform pg_temp.flag(true);
  -- a real boss and tier with a fractional v2 max (the copy rule matters there)
  select z.key, z.tier into fk, ftier from (select x.key, tr.tier, (combat_v2_hunt_boss(tr.tier, x.key)->>'max')::numeric m
      from hunt_bosses_v2 x cross join unnest(array['Normal', 'Heroic', 'Mythic']) tr(tier)) z where z.m <> round(z.m) order by z.key, z.tier limit 1;
  mx := (combat_v2_hunt_boss(ftier, fk)->>'max')::numeric;
  -- N3: a v2-unit Hunt at 40 percent, as spawn_hunt makes it (the fractional boss)
  ${sub(String.raw`
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
      values ('The ' || (select name from hunt_bosses_v2 where key = fk), ftier, '[]'::jsonb, round(mx), round(round(mx) * 0.4), now() - interval '1 hour', now() + interval '2 days', 'active',
              jsonb_build_object('atk', 50, 'unit', 'v2', 'v1_hp', 80000)) returning id into hid;
    h0 := (select hp_remaining from hunts where id = hid);
    perform setseed(0.1);
    row0 := pg_temp.day(${M(1)}, hid, sq, null);
    rw := pg_temp.vrow(${M(1)});
    ${add('N3 a v2-unit day (a fractional v2 max): the private copy starts at hp = hp_remaining and max = hp_max',
      `fk is not null and mx <> round(mx) and rw.start_hp = h0 and (rw.state->'fight'->'enemies'->0->>'max')::numeric = round(mx)`, `jsonb_build_object('start_hp', rw.start_hp, 'hp_rem', h0, 'max', rw.state->'fight'->'enemies'->0->'max')`)}
    ${add('N3 a v2-unit day: every call credits 1:1 (hunt_hits delta = shared HP delta = round(the private decreases)); credited = hunt_hits',
      `(row0->>'calls')::int >= 2 and jsonb_array_length(row0->'bad') = 0 and (row0->>'credited')::bigint = (row0->>'hits')::bigint and (row0->>'hits')::bigint > 0`, 'row0')}`)}
  mx := (combat_v2_hunt_boss('Heroic', bk)->>'max')::numeric;
  -- N3 (tamper): the copy max differs from hp_max; a v2 Hunt is still credited 1:1
  ${sub(String.raw`
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
      values ('The ' || bn, 'Heroic', '[]'::jsonb, round(mx), round(round(mx) * 0.4), now() - interval '1 hour', now() + interval '2 days', 'active',
              jsonb_build_object('atk', 50, 'unit', 'v2', 'v1_hp', 80000)) returning id into hid;
    perform setseed(0.2);
    row0 := pg_temp.day(${M(2)}, hid, sq, null, false, round(mx) / 2.0);
    ${add('N3 a v2-unit Hunt is never converted: with a copy max of hp_max / 2 every later call still credits 1:1',
      `(row0->>'calls')::int >= 2 and jsonb_array_length(row0->'bad') = 0`, 'row0')}`)}
  -- N3b: the fractional v2 max, little HP left: the member defeats the boss
  ${sub(String.raw`
    mx := coalesce((combat_v2_hunt_boss(ftier, fk)->>'max')::numeric, 0);
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
      values ('The ' || (select name from hunt_bosses_v2 where key = fk), ftier, '[]'::jsonb, round(mx), 40, now() - interval '1 hour', now() + interval '2 days', 'active',
              jsonb_build_object('atk', 50, 'unit', 'v2', 'v1_hp', 80000)) returning id into hid;
    perform setseed(0.3);
    row0 := pg_temp.day(${M(3)}, hid, sq, null);
    select * into rw from hunts where id = hid;
    ${add('N3b a fractional v2 max: the member who takes the last 40 HP defeats the boss (hp 0, defeated, hunt_hits = 40 or more)',
      `fk is not null and mx <> round(mx) and rw.hp_remaining = 0 and rw.status = 'defeated' and (row0->>'hits')::bigint >= 40`,
      `jsonb_build_object('key', fk, 'tier', ftier, 'max', mx, 'hp', rw.hp_remaining, 'status', rw.status, 'day', row0)`)}`)}
  mx := (combat_v2_hunt_boss('Heroic', bk)->>'max')::numeric;
  -- N4: the current-unit row (no stats.unit, hp_max 80000, as the live Hunt 148564)
  ${sub(String.raw`
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
      values ('The ' || bn, 'Heroic', '[]'::jsonb, 80000, 32000, now() - interval '1 hour', now() + interval '2 days', 'active', jsonb_build_object('atk', 50)) returning id into hid;
    perform setseed(0.1);
    row0 := pg_temp.day(${M(4)}, hid, sq, 0);
    rw := pg_temp.vrow(${M(4)});
    ${add('N4 the current-unit row (no mark, hp_max 80000): the copy starts at the shared fraction of the v2 max; every call converts x hp_max / private max',
      `abs(rw.start_hp - mx * 32000 / 80000.0) < 0.001 and (row0->>'calls')::int >= 2 and jsonb_array_length(row0->'bad') = 0 and (row0->>'hits')::bigint > 0`,
      `jsonb_build_object('start_hp', rw.start_hp, 'want', mx * 32000 / 80000.0, 'day', row0)`)}`)}
  -- N4b: the same, flag OFF after the start
  ${sub(String.raw`
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
      values ('The ' || bn, 'Heroic', '[]'::jsonb, 80000, 32000, now() - interval '1 hour', now() + interval '2 days', 'active', jsonb_build_object('atk', 50)) returning id into hid;
    perform setseed(0.1);
    row0 := pg_temp.day(${M(5)}, hid, sq, 0, true);
    ${add('N4b flag OFF after the start: the live day of the current-unit row still converts x hp_max / private max',
      `(row0->>'calls')::int >= 2 and jsonb_array_length(row0->'bad') = 0 and (row0->>'hits')::bigint > 0`, 'row0')}`)}
`, mutated);

// ---------------------------------------------------------------------------------------------------------- B3: ach_track_values (N5)
const B3 = (mig, mutated) => block(mig, String.raw`
  ${sub(String.raw`
    -- a v1-unit Hunt (no mark, Normal 70000) and a v2-unit Hunt (hp_max 36244, v1_hp 80000), both ended
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
      values ('The ' || bn, 'Normal', '[]'::jsonb, 70000, 0, now() - interval '9 days', now() - interval '8 days', 'expired', jsonb_build_object('atk', 50)) returning id into h0;
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
      values ('The ' || bn, 'Heroic', '[]'::jsonb, 36244, 0, now() - interval '3 days', now() - interval '2 days', 'expired',
              jsonb_build_object('atk', 50, 'unit', 'v2', 'v1_hp', 80000)) returning id into h1;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values
      (h0, ${M(6)}, na[1], current_date - 9, 1000), (h0, ${M(6)}, na[2], current_date - 9, 600),
      (h1, ${M(6)}, na[1], current_date - 3, 3624), (h1, ${M(6)}, na[2], current_date - 3, 100),
      (h0, ${M(5)}, na[1], current_date - 9, 2500), (h0, ${M(5)}, na[2], current_date - 9, 450);
    a := ach_track_values(${M(6)});
    ${add('N5 heavy = v1 damage x 1 + v2 damage x v1_hp / hp_max; bighit = the largest row on that scale',
      `(a->>'heavy')::numeric = round(1600 + 3724 * 80000 / 36244.0) and (a->>'bighit')::numeric = round(3624 * 80000 / 36244.0)`,
      `jsonb_build_object('heavy', a->'heavy', 'bighit', a->'bighit', 'want_heavy', round(1600 + 3724 * 80000 / 36244.0), 'want_bighit', round(3624 * 80000 / 36244.0))`)}
    x := ach_track_values(${M(5)});
    begin
      execute $u$${mutated ? noGuard(UNDO) : UNDO}$u$;
      e := ach_track_values(${M(5)});
      raise exception 'hvn_keep:%', e::text;
    exception when others then if sqlerrm like 'hvn_keep:%' then e := substr(sqlerrm, 10)::jsonb; else e := to_jsonb(sqlerrm); end if;
    end;
    ${add('N5 a member with only v1-unit rows has exactly the origin/main values (every track)', `x = e and (x->>'heavy')::numeric = 2950 and (x->>'bighit')::numeric = 2500`,
      `jsonb_build_object('now', x, 'before', e)`)}`)}
`, mutated);

// ---------------------------------------------------------------------------------------------------------- the run
async function run(mig, mutated = false) {
  const rows = [];
  for (const [name, b] of [['B1', B1], ['B2', B2], ['B3', B3]]) {
    let out;
    try { out = JSON.parse(await runBlock(b(mig, mutated))); } catch (e) { rows.push({ case: `${name} raised`, ok: false, got: String(e.message).slice(0, 1500) }); continue; }
    rows.push(...out.rows);
  }
  return rows;
}
const print = (rows) => { for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  got: ' + JSON.stringify(r.got).slice(0, 900)}`); };
const LOG = process.env.HVN_LOG;
const say = (s) => { console.log(s); if (LOG) appendFileSync(LOG, s + '\n'); };

const want = process.env.MUTATE;
if (!want) {
  const rows = await run(CLEAN);
  print(rows);
  const fail = rows.filter((r) => !r.ok).length;
  say(fail ? `HVN FAIL ${fail} of ${rows.length}` : `HVN PASS ${rows.length} of ${rows.length}`);
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
