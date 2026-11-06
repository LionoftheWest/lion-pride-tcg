import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/hunt_v2_player_done.sql (item HUNT-V2-POSTS: the daily damage post of a LIVE Combat v2 Hunt day).
 * The invariant: a LIVE v2 day that ends by cap, squad_down or boss_down has exactly ONE hunt_events player_done of that member and day,
 * written after the last credit (total = the member's hunt_hits of the day), with the v1 payload the bot reads; a practice day, a day
 * ended by hunt_over or abandoned, and a call that finds the Hunt defeated write none. The backfill writes the missing posts of TODAY's
 * ended live days of the open Hunt, once.
 * ONE DO block on the LOCAL copy, undone by its final RAISE (no lasting change). It runs the file, then makes its own active Hunt (every other
 * active Hunt expires in the block), members, cards and day rows.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-hunt-v2-player-done.mjs        must PASS all
 *   MUTATE=<name> ...   must FAIL;   MUTATE=all ...   the baseline, every mutation (each must FAIL), the baseline again (one run)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-hunt-v2-player-done.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
let mig = read('../../tcg-bot/supabase/hunt_v2_player_done.sql');
let undo = read('../../tcg-bot/supabase/hunt_v2_player_done_undo.sql');
const NEW_MD5 = (mig.match(/if m not in \('[0-9a-f]{32}', '([0-9a-f]{32})'\)/) || [])[1];
const OLD_MD5 = '2e2f2b28bf7309ed1053610593128c40';
if (!NEW_MD5) throw new Error('the guard of the file must name the HBP md5 and the md5 of its own text');

// [anchor, replacement]; each anchor must match exactly once. A key in UNDO_MUT changes the undo file.
const MUT = {
  no_call: ['  perform hunt_v2_player_done(p_hunt, p_player, p_day);\n', ''],
  // the post moved before the shared write of the call (the total misses the last hits)
  call_before_credit: [/  s := hunt_v2_shared\(p_hunt, p_player, p_day, c\);\n([\s\S]*?)  perform hunt_v2_player_done\(p_hunt, p_player, p_day\);\n/,
    (_, mid) => `  perform hunt_v2_player_done(p_hunt, p_player, p_day);\n  s := hunt_v2_shared(p_hunt, p_player, p_day, c);\n${mid}`],
  practice_posts: ["  if not found or not r.live or r.status <> 'over'", "  if not found or r.status <> 'over'"],
  hunt_over_posts: ["not in ('cap', 'squad_down', 'boss_down') then return false;", "not in ('cap', 'squad_down', 'boss_down', 'hunt_over') then return false;"],
  no_boss_down: ["not in ('cap', 'squad_down', 'boss_down') then return false;", "not in ('cap', 'squad_down') then return false;"],
  active_posts: ["r.status <> 'over' or ", ''],
  defeated_posts: ["  if not found or h.status = 'defeated' then return false; end if;", '  if not found then return false; end if;'],
  no_once: [/  if exists \(select 1 from public\.hunt_events e[\s\S]*?    return false;\n  end if;\n/, ''],
  once_v1_window: ["(e.payload->>'day' = p_day::text\n                    or (e.payload->>'day' is null and e.created_at >= v_from and e.created_at < v_from + interval '1 day'))",
    '(e.created_at >= v_from)'],
  no_v1_same_day: ["\n                    or (e.payload->>'day' is null and e.created_at >= v_from and e.created_at < v_from + interval '1 day')", ''],
  payload_no_cards_used: ["'total', v_total, 'cards_used', v_used, 'top_card'", "'total', v_total, 'top_card'"],
  total_all_days: ['    from public.hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;\n', '    from public.hunt_hits where hunt_id = p_hunt and player_id = p_player;\n'],
  backfill_any_day: ['and v.day = hunt_v2_today() and v.live', 'and v.live'],
  backfill_closed_hunt: ["where h.status = 'active' and now() < h.closes_at and v.day", 'where true and v.day'],
  // Not listed (equivalent: hunt_v2_player_done checks the same rule, I-4c): the backfill without v.live. The day-row lock (FOR UPDATE)
  // matters only between two sessions (the backfill and a live call); this one-session block cannot show it.
  guard_off: [/do \$g\$\ndeclare m text;[\s\S]*?-- GUARD-END\n/, ''],
};
const UNDO_MUT = {
  undo_keeps_fn: ['drop function if exists public.hunt_v2_player_done(bigint, text, date);\n', ''],
  undo_keeps_call: ['  return s || jsonb_build_object(', '  perform 1;\n  return s || jsonb_build_object('],
};
const ALL = { ...MUT, ...UNDO_MUT };

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const baseline = (label) => {
    const r = runOne('');
    const last = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const pass = r.status === 0 && /^PASS all/.test(last);
    if (!pass) ok = false;
    console.log(`baseline ${label.padEnd(5)} (no mutation)  ${pass ? 'PASS' : 'FAIL'}  ${last}`);
    if (!pass) console.log((r.stdout || '') + (r.stderr || '').slice(0, 2000));
  };
  baseline('start');
  for (const name of Object.keys(ALL)) {
    const r = runOne(name);
    const last = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(last);
    if (!caught) ok = false;
    const why = (r.stdout || '').split(/\r?\n/).find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '';
    console.log(`mutation ${name.padEnd(22)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${last.slice(0, 30)}  ${why.slice(0, 150)}`);
  }
  baseline('end');
  console.log(ok ? `mutations: baseline PASS at the start and the end, all ${Object.keys(ALL).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const name = process.env.MUTATE;
  const m = ALL[name];
  if (!m) throw new Error(`no mutation ${name}`);
  const [a, b] = m;
  const src = MUT[name] ? mig : undo;
  const n = a instanceof RegExp ? (src.match(new RegExp(a.source, 'g')) || []).length : src.split(a).length - 1;
  if (n !== 1) throw new Error(`the mutation ${name} does not match exactly once (${n})`);
  const out = a instanceof RegExp ? src.replace(a, typeof b === 'function' ? b : () => b) : src.split(a).join(b);
  if (MUT[name]) mig = out; else undo = out;
}
for (const s of [mig, undo]) if (['$m$', '$t$', '$x$'].some((x) => s.includes(x))) throw new Error('the SQL must not contain $m$, $t$ or $x$');
const bfStart = mig.indexOf('do $bf$'), bfEnd = mig.indexOf('-- BACKFILL-END');
if (bfStart < 0 || bfEnd < bfStart) throw new Error('the backfill block (do $bf$ ... -- BACKFILL-END) is missing');
const BACKFILL = mig.slice(bfStart, bfEnd);

const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const id = (i) => `9000000000000058${String(i).padStart(2, '0')}`;
const M = Array.from({ length: 12 }, (_, i) => lit(id(i + 1)));   // M[0] .. M[11]
const KEYS = ['boss_hp', 'boss_hp_max', 'cards_used', 'day', 'player_id', 'top_card', 'top_damage', 'total'];
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;

const SQL = String.raw`do $t$
#variable_conflict use_column
declare res jsonb := '[]'; bk text; bn text; hid bigint; h2 bigint; na bigint[]; sup bigint[]; sq bigint[]; a jsonb; x jsonb; rw public.hunt_v2_days;
  dd date := hunt_v2_today(); n int; i int; msg text; ok boolean; b1 boolean; b2 boolean; b3 boolean; b4 boolean; e jsonb; tot bigint; m0 text; m1 text;
begin
  if to_regprocedure('public.hunt_v2_live_credit(bigint, text, date, jsonb)') is null then raise exception 'HBP is not applied on this copy'; end if;
  -- the file under test (its backfill runs here on the copy's rows; the block is undone)
  execute $m$${mig}$m$;
  ${add('G-0 after the file: hunt_v2_live_credit has the md5 that the guard of the file names as its own text',
    `md5(replace(pg_get_functiondef('public.hunt_v2_live_credit(bigint, text, date, jsonb)'::regprocedure), chr(13), '')) = ${lit(NEW_MD5)}`,
    `to_jsonb(md5(replace(pg_get_functiondef('public.hunt_v2_live_credit(bigint, text, date, jsonb)'::regprocedure), chr(13), '')))`)}
  -- the world
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_hv2pd_admin', true);
  update hunts set status = 'expired' where status = 'active';
  select x.key, x.name into bk, bn from hunt_bosses_v2 x where exists (select 1 from unnest(x.weak_to) w join roles r on w = 'role:' || r.key where r.class = 'attacker') order by x.ord limit 1;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || bn, 'Heroic', '[]'::jsonb, 50000000, 50000000, now() - interval '1 hour', now() + interval '2 days', 'active') returning id into hid;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || bn, 'Heroic', '[]'::jsonb, 80000, 80000, now() - interval '9 days', now() - interval '2 days', 'expired') returning id into h2;
  create temp table hv2pd_pool on commit drop as
    select distinct on (c.subject_id, c.rarity) c.id, c.rarity::text as rarity, s.type in ('Character', 'Creature') as att
      from cards c join subjects s on s.id = c.subject_id
     where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array' and exists (select 1 from roles x where x.key = s.ability_v2->>'role')
     order by c.subject_id, c.rarity, c.id;
  na := array(select id from hv2pd_pool where att and rarity = 'normal' order by id limit 4);
  sup := array(select id from hv2pd_pool where not att and rarity = 'normal' order by id limit 2);
  sq := na || sup;
  insert into players (id, username) select z, 'tst ' || z from unnest(array[${M.join(', ')}]) z;
  insert into player_cards (player_id, card_id, quantity) select p, c, 1 from unnest(array[${M.join(', ')}]) p, unnest(sq) c on conflict do nothing;
  -- a forced day row (the post reads only the row fields, the hunts row and hunt_hits)
  create function pg_temp.day(hh bigint, p text, d date, lv boolean, st text, eb text) returns void language sql as $x$
    insert into hunt_v2_days (hunt_id, player_id, day, boss, squad, state, start_hp, live, status, ended_by, ended_at)
    values (hh, p, d, 'x', '{}'::bigint[], '{}'::jsonb, 1, lv, st, eb, case when st = 'over' then now() end) $x$;
  create function pg_temp.posts(hh bigint, p text) returns int language sql as $x$
    select count(*)::int from hunt_events where hunt_id = hh and kind = 'player_done' and payload->>'player_id' = p $x$;
  create function pg_temp.post(hh bigint, p text) returns jsonb language sql as $x$
    select payload from hunt_events where hunt_id = hh and kind = 'player_done' and payload->>'player_id' = p order by id desc limit 1 $x$;

  -- ===== I-1 a real LIVE day (flag ON): start + auto until the day ends; one post with the v1 payload, total = hunt_hits of the day
  update balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';
  perform setseed(0.37);
  a := hunt_v2_start(${M[0]}, sq);
  for i in 1 .. 6 loop
    rw := (select d from hunt_v2_days d where d.hunt_id = hid and d.player_id = ${M[0]} and d.day = dd);
    exit when rw.status = 'over';
    x := hunt_v2_auto(${M[0]}, 1000);
  end loop;
  rw := (select d from hunt_v2_days d where d.hunt_id = hid and d.player_id = ${M[0]} and d.day = dd);
  e := pg_temp.post(hid, ${M[0]});
  select coalesce(sum(damage), 0) into tot from hunt_hits where hunt_id = hid and player_id = ${M[0]} and hit_date = dd;
  ${add('I-1a a live day (start, auto) ends by cap / squad_down / boss_down, credits hunt_hits, and writes exactly 1 player_done',
    `(a->>'ok')::boolean and rw.live and rw.status = 'over' and rw.ended_by in ('cap', 'squad_down', 'boss_down') and tot > 0 and pg_temp.posts(hid, ${M[0]}) = 1`,
    `jsonb_build_object('start', a->'error', 'status', rw.status, 'ended_by', rw.ended_by, 'live', rw.live, 'hits', tot, 'posts', pg_temp.posts(hid, ${M[0]}))`)}
  ${add('I-1b the payload: exactly the v1 keys + day; total = sum hunt_hits of the day (after the last credit), cards_used, top card and damage, the boss HP now',
    `(select array_agg(k order by k) from jsonb_object_keys(e) k) = array[${KEYS.map(lit).join(', ')}]
     and (e->>'total')::bigint = tot and e->>'player_id' = ${M[0]} and e->>'day' = dd::text
     and (e->>'cards_used')::int = (select count(distinct card_id) from hunt_hits where hunt_id = hid and player_id = ${M[0]} and hit_date = dd)
     and (e->>'top_damage')::bigint = (select max(damage) from hunt_hits where hunt_id = hid and player_id = ${M[0]} and hit_date = dd)
     and e->>'top_card' = (select c.name from hunt_hits hh join cards c on c.id = hh.card_id where hh.hunt_id = hid and hh.player_id = ${M[0]} and hh.hit_date = dd order by hh.damage desc, hh.card_id limit 1)
     and (e->>'boss_hp')::bigint = (select hp_remaining from hunts where id = hid) and (e->>'boss_hp_max')::bigint = 50000000`,
    `jsonb_build_object('payload', e, 'hits', tot)`)}
  -- I-2 once: another act / auto (not_fighting), another credit call, another post call: still 1
  x := hunt_v2_auto(${M[0]}, 5);
  perform hunt_v2_live_credit(hid, ${M[0]}, dd, '[]'::jsonb);
  ok := hunt_v2_player_done(hid, ${M[0]}, dd);
  ${add('I-2 once: a later auto (not_fighting), credit call and post call write nothing more (1 post)',
    `x->>'error' = 'not_fighting' and not ok and pg_temp.posts(hid, ${M[0]}) = 1`, `jsonb_build_object('auto', x, 'again', ok, 'posts', pg_temp.posts(hid, ${M[0]}))`)}

  -- ===== I-3 a real PRACTICE day (flag OFF, a tester): it ends, no post
  update balance set value = jsonb_set(jsonb_set(value, '{hunt}', 'false'), '{testers}', jsonb_build_array(${M[1]})) where key = 'combat_v2';
  a := hunt_v2_start(${M[1]}, sq);
  for i in 1 .. 6 loop
    rw := (select d from hunt_v2_days d where d.hunt_id = hid and d.player_id = ${M[1]} and d.day = dd);
    exit when rw.status = 'over';
    x := hunt_v2_auto(${M[1]}, 1000);
  end loop;
  rw := (select d from hunt_v2_days d where d.hunt_id = hid and d.player_id = ${M[1]} and d.day = dd);
  ${add('I-3 a practice day (live false) that ends writes no player_done',
    `(a->>'ok')::boolean and not rw.live and rw.status = 'over' and pg_temp.posts(hid, ${M[1]}) = 0`,
    `jsonb_build_object('start', a->'error', 'live', rw.live, 'status', rw.status, 'posts', pg_temp.posts(hid, ${M[1]}))`)}

  -- ===== I-4 the end rule on forced rows (M3 .. M9): cap, squad_down, boss_down post; hunt_over, abandoned, active, practice do not
  perform pg_temp.day(hid, ${M[2]}, dd, true, 'over', 'cap');
  perform pg_temp.day(hid, ${M[3]}, dd, true, 'over', 'squad_down');
  perform pg_temp.day(hid, ${M[4]}, dd, true, 'over', 'boss_down');
  perform pg_temp.day(hid, ${M[5]}, dd, true, 'over', 'hunt_over');
  perform pg_temp.day(hid, ${M[6]}, dd, true, 'over', 'abandoned');
  perform pg_temp.day(hid, ${M[7]}, dd, true, 'active', 'cap');   -- an inconsistent row: the post still waits for status over
  perform pg_temp.day(hid, ${M[8]}, dd, false, 'over', 'cap');
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (hid, ${M[2]}, na[1], dd, 300), (hid, ${M[2]}, na[2], dd, 500), (hid, ${M[2]}, na[3], dd - 1, 9000);
  b1 := hunt_v2_player_done(hid, ${M[2]}, dd); b2 := hunt_v2_player_done(hid, ${M[3]}, dd); b3 := hunt_v2_player_done(hid, ${M[4]}, dd);
  ${add('I-4a cap, squad_down and boss_down each post (true), once',
    `b1 and b2 and b3 and pg_temp.posts(hid, ${M[2]}) = 1 and pg_temp.posts(hid, ${M[3]}) = 1 and pg_temp.posts(hid, ${M[4]}) = 1`,
    `jsonb_build_object('cap', b1, 'squad_down', b2, 'boss_down', b3)`)}
  e := pg_temp.post(hid, ${M[2]});
  ${add('I-4b the numbers of the day only (an earlier day of the same Hunt is not counted): total 800, cards_used 2, top 500 on the second card',
    `(e->>'total')::bigint = 800 and (e->>'cards_used')::int = 2 and (e->>'top_damage')::bigint = 500 and e->>'top_card' = (select name from cards where id = na[2])`, 'e')}
  b1 := hunt_v2_player_done(hid, ${M[5]}, dd); b2 := hunt_v2_player_done(hid, ${M[6]}, dd); b3 := hunt_v2_player_done(hid, ${M[7]}, dd);
  b4 := hunt_v2_player_done(hid, ${M[8]}, dd);
  ${add('I-4c hunt_over, abandoned, an active day and a practice day (live false, cap) do not post',
    `not b1 and not b2 and not b3 and not b4 and (select count(*) from hunt_events where hunt_id = hid and kind = 'player_done'
       and payload->>'player_id' in (${M[5]}, ${M[6]}, ${M[7]}, ${M[8]})) = 0`,
    `jsonb_build_object('hunt_over', b1, 'abandoned', b2, 'active', b3, 'practice', b4)`)}

  -- ===== I-5 the Hunt defeated (the v1 rule: the defeat post covers it): no post
  perform pg_temp.day(hid, ${M[9]}, dd, true, 'over', 'cap');
  update hunts set status = 'defeated' where id = hid;
  ok := hunt_v2_player_done(hid, ${M[9]}, dd);
  update hunts set status = 'active' where id = hid;
  ${add('I-5 a defeated Hunt: no post', `not ok and pg_temp.posts(hid, ${M[9]}) = 0`)}

  -- ===== I-6 the once-check: a v1 post of the same Denver day (no day key) counts; a v2 post of YESTERDAY does not block today
  insert into hunt_events (hunt_id, kind, payload) values (hid, 'player_done', jsonb_build_object('player_id', ${M[10]}, 'total', 1));
  perform pg_temp.day(hid, ${M[10]}, dd, true, 'over', 'squad_down');
  b1 := hunt_v2_player_done(hid, ${M[10]}, dd);
  ${add('I-6a a v1 player_done of today (no day key) counts as written: no second post', `not b1 and pg_temp.posts(hid, ${M[10]}) = 1`)}
  perform pg_temp.day(hid, ${M[11]}, dd - 1, true, 'over', 'cap');
  ok := hunt_v2_player_done(hid, ${M[11]}, dd - 1);
  perform pg_temp.day(hid, ${M[11]}, dd, true, 'over', 'cap');
  b2 := hunt_v2_player_done(hid, ${M[11]}, dd);
  ${add('I-6b a v2 post of yesterday (written now, day key yesterday) does not block the post of today (2 posts, 2 days)',
    `ok and b2 and pg_temp.posts(hid, ${M[11]}) = 2
     and (select array_agg(payload->>'day' order by payload->>'day') from hunt_events where hunt_id = hid and kind = 'player_done' and payload->>'player_id' = ${M[11]}) = array[(dd - 1)::text, dd::text]`)}

  -- ===== I-7 the backfill: today's ended live days of the OPEN Hunt with no post get one; a second run adds none; yesterday, a closed Hunt
  -- and a practice day get none
  delete from hunt_events where hunt_id in (hid, h2) and kind = 'player_done';
  perform pg_temp.day(h2, ${M[2]}, dd, true, 'over', 'cap');
  execute $m$${BACKFILL}$m$;
  n := (select count(*) from hunt_events where hunt_id in (hid, h2) and kind = 'player_done');
  ${add('I-7a the backfill posts each ended live day of today of the open Hunt (M1 real, M3 cap, M4 squad_down, M5 boss_down, M10 cap, M11 squad_down, M12 cap): 7',
    `n = 7 and (select count(distinct payload->>'player_id') from hunt_events where hunt_id = hid and kind = 'player_done') = 7
     and (select bool_and(payload->>'day' = dd::text) from hunt_events where hunt_id = hid and kind = 'player_done')`,
    `jsonb_build_object('n', n, 'who', (select jsonb_agg(jsonb_build_object('p', payload->>'player_id', 'd', payload->>'day')) from hunt_events where hunt_id in (hid, h2) and kind = 'player_done'))`)}
  ${add('I-7b the backfill skips the closed Hunt, yesterday, practice, hunt_over, abandoned and active days',
    `pg_temp.posts(h2, ${M[2]}) = 0 and not exists (select 1 from hunt_events where hunt_id = hid and kind = 'player_done' and (payload->>'day' <> dd::text
       or payload->>'player_id' in (${M[1]}, ${M[5]}, ${M[6]}, ${M[7]}, ${M[8]})))`)}
  execute $m$${BACKFILL}$m$;
  ${add('I-7c a second backfill run writes nothing (still 7)', `(select count(*) from hunt_events where hunt_id in (hid, h2) and kind = 'player_done') = 7`)}

  -- ===== I-8 the guard: a changed hunt_v2_live_credit refuses the file; the undo puts back the HBP text and drops the function; the file runs again
  begin
    execute replace(pg_get_functiondef('public.hunt_v2_live_credit(bigint, text, date, jsonb)'::regprocedure), 'AS $function$', E'AS $function$\n-- changed');
    msg := null;
    begin execute $m$${mig}$m$; exception when others then msg := sqlerrm; end;
    raise exception 'hv2pd_rollback:%', coalesce(msg, '');
  exception when others then
    msg := sqlerrm;
  end;
  ${add('I-8a the guard: a hunt_v2_live_credit that is not the HBP text or this file text: the file raises (changed since this file was built)',
    `msg like 'hv2pd_rollback:%changed since this file was built%'`, 'to_jsonb(msg)')}
  -- (each step in its own sub-block: a refused step is a FAIL of its case, and the cases above still report)
  msg := null;
  begin execute $m$${undo}$m$; exception when others then msg := sqlerrm; end;
  m0 := md5(replace(pg_get_functiondef('public.hunt_v2_live_credit(bigint, text, date, jsonb)'::regprocedure), chr(13), ''));
  ${add('I-8b the undo: hunt_v2_live_credit is the HBP text again (md5) and hunt_v2_player_done is gone',
    `msg is null and m0 = ${lit(OLD_MD5)} and to_regprocedure('public.hunt_v2_player_done(bigint, text, date)') is null`, 'jsonb_build_object(\'err\', msg, \'md5\', m0)')}
  msg := null;
  begin execute $m$${mig}$m$; execute $m$${mig}$m$; exception when others then msg := sqlerrm; end;
  m1 := md5(replace(pg_get_functiondef('public.hunt_v2_live_credit(bigint, text, date, jsonb)'::regprocedure), chr(13), ''));
  ${add('I-8c the file runs again after the undo and twice in a row (idempotent), the same md5', `msg is null and m1 = ${lit(NEW_MD5)}`, 'jsonb_build_object(\'err\', msg, \'md5\', m1)')}

  raise exception 'RESULT:%', jsonb_build_object('rows', res)::text;
end $t$;`;

let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
try {
  const j = JSON.parse(await runBlock(SQL));
  for (const r of j.rows) say(r.ok, r.case, JSON.stringify(r.got).slice(0, 1500));
} catch (e) { say(false, 'the test block raised (the file did not apply?)', String(e.message).slice(0, 2000)); }
const GATE_N = 17;
if (!fail && total !== GATE_N) say(false, `the block gave ${total} cases, the gate has ${GATE_N}`);
console.log(fail ? `${fail} of ${total} FAILED` : `PASS all ${total}`);
process.exitCode = fail ? 1 : 0;
