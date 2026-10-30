import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_progress_freeze_v1.sql (combat v2 step M1d; plan 11, 20.11 trap a, 20.14):
 * when combat_v2_on('progress', player) is true the v1 spend and reset refuse, and the v1 Shop reset ROUTES to the v2 reset
 * (Nathan 2026-10-23 "Yes A"); the v1 gift use skips the v2_ gifts; the v2 reset is one function (card_progress_v2_reset) for
 * reset_card_points_v2 and the Shop.
 * NO lasting change: one DO block, undone by its final RAISE. The block first puts back the state before the file: the 4 v1 functions as
 * the file minus its lines with the mark "-- M1d", reset_card_points_v2 as the M1c file, and no card_progress_v2_reset. The md5 of each
 * must be the "old" md5 of the guard. So the test passes before and after the file is applied. The sample uses two new test players (ids
 * of 18 digits, so that the tester list accepts them) and cards they get only in this block; nothing is printed about a member.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-progress-freeze.mjs     must PASS
 *   MUTATE=<name> ...                                                                                    must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                       the baseline (must PASS), then every mutation, one line each
 * Invariants:
 *   T0 the v1 functions only get ADDED lines (the file minus the "-- M1d" lines = the live text of main); the guard accepts the old and the
 *      new text and refuses another text.
 *   T1 (no other change): the md5 of every other public function does not change; exactly the 5 functions change and card_progress_v2_reset
 *      is added; the flag does not change; the readers of combat_v2_on = before + the 3 v1 functions; only the two callers name the new one.
 *   T2 server only, search_path, and the comments.
 *   Flag OFF (the live state, no v2_ gift): 17 v1 calls (spend, reset, Shop reset, pack, card; ok and refused) give the SAME answers and
 *      the SAME writes before and after the file, for two players.
 *   Progress ON (everyone, or a tester): spend and reset answer disabled with 0 rows and no lock; the Shop reset is the v2 reset (a card
 *      with no v2 row: no_progress, 0 rows); the Shop pack and card still work. A non-tester gets the v1 answers and writes of before.
 *   The routed Shop reset: the week, then a v2_ gift (never a v1 gift), then the price (Shards once: one ledger row and one purchase row);
 *      not_enough and each refusal write nothing; the v1 points do not change.
 *   reset_card_points_v2 = the M1c function: the same answers and rows on a series at 6 fixed instants (the Mountain week boundary,
 *      summer and winter time), with the expected week, gift and reset_used order.
 *   The v1 gift use: never a v2_ gift (also through reset_stat_points), still a v1 gift; a key like 'v2xfoo' is NOT skipped.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-progress-freeze.mjs');

const FILE = process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/combat_v2_progress_freeze_v1.sql', import.meta.url));
let mig = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const M1C = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/combat_v2_progress_spend.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const M1C_RESET = (M1C.match(/create or replace function public\.reset_card_points_v2\(p_player text, p_card bigint\) returns jsonb\n[\s\S]*?\nend \$fn\$;\n/) || [])[0];
if (!M1C_RESET) throw new Error('reset_card_points_v2 not found in the M1c file');

const GATE = "  if combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;   -- M1d\n";
const CFG = "  if not coalesce((stat_cfg()->>'enabled')::boolean, false) then\n    return jsonb_build_object('ok', false, 'error', 'disabled'); end if;\n";
const SPEND_AFTER = '  if p_add is null';
const RESET_AFTER = '  select stat_reset_week into v_used from players where id = p_player for update;\n';
const SPEND_LOCK = "    for update of pc;\n  if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;\n  v_new := ";
const SPEND_WRITE = '  update player_cards set stat_points = v_new where player_id = p_player and card_id = p_card;\n';
const RESET_WRITE = '  update players set stat_reset_week = v_week where id = p_player;\n  return ';
const ROUTE = "    if combat_v2_on('progress', p_player) then   -- M1d\n";
const REFUSE = "    if combat_v2_on('progress', p_player) then return jsonb_build_object('ok', false, 'error', 'stats_disabled'); end if;   -- M1d\n";
const GIFT_LINE = "       and not starts_with(gift, 'v2_')";
const MARK = '-- ============================================================ 4. server only';
// a second copy of the v2 reset for the Shop that differs (its ref is shop:<n>): the brief asks for ONE shared write
const CORE = (mig.match(/create or replace function public.card_progress_v2_reset(p_player text[sS]*?
end $fn$;
/) || [])[0];
if (!CORE) throw new Error('card_progress_v2_reset not found in the file');
const CORE_COPY = CORE.replace('public.card_progress_v2_reset(', 'public.card_progress_v2_reset_shop(').replace("v_ref := 'reset:' ||", "v_ref := 'shop:' ||");
const MARK2 = '-- ============================================================ 2. reset_card_points_v2';
const MUT = {
  spend_no_gate: [GATE + CFG + SPEND_AFTER, CFG + SPEND_AFTER],
  reset_no_gate: [GATE + CFG + RESET_AFTER, CFG + RESET_AFTER],
  spend_one_arg: [GATE + CFG + SPEND_AFTER, GATE.replace("'progress', p_player", "'progress'") + CFG + SPEND_AFTER],
  reset_one_arg: [GATE + CFG + RESET_AFTER, GATE.replace("'progress', p_player", "'progress'") + CFG + RESET_AFTER],
  spend_gate_after_write: [GATE + CFG + SPEND_AFTER, CFG + SPEND_AFTER, SPEND_WRITE, SPEND_WRITE + GATE],
  reset_gate_after_write: [GATE + CFG + RESET_AFTER, CFG + RESET_AFTER, RESET_WRITE, RESET_WRITE.replace('  return ', GATE + '  return ')],
  spend_gate_after_lock: [GATE + CFG + SPEND_AFTER, CFG + SPEND_AFTER, SPEND_LOCK, SPEND_LOCK.replace('  v_new := ', GATE + '  v_new := ')],
  reset_gate_after_lock: [GATE + CFG + RESET_AFTER, CFG + RESET_AFTER + GATE],
  shop_no_route: [ROUTE, "    if false then   -- M1d\n"],
  shop_route_one_arg: [ROUTE, ROUTE.replace("'progress', p_player", "'progress'")],
  shop_pack_refused: ["  if p_kind = 'pack' then\n", "  if p_kind = 'pack' then\n" + REFUSE],
  shop_card_refused: ["  elsif p_kind = 'card' then\n", "  elsif p_kind = 'card' then\n" + REFUSE],
  shop_free_charges: ["      if v_v2->>'used' <> 'paid' then v_price := 0; end if;   -- M1d\n", ''],
  shop_no_purchase_row: ["      insert into shop_purchases (player_id, day, kind, card_id, price) values (p_player, v_day, 'stat_reset', p_card, v_price) returning id into v_purchase;   -- M1d\n", ''],
  shop_shards_twice: ["      v_new := v_bal;   -- M1d\n", "      v_new := v_bal;   -- M1d\n      if v_price > 0 then perform grant_shards(p_player, -v_price, 'shop', 'shop_purchase', v_purchase::text); end if;   -- M1d\n"],
  core_skips_week: ["  if v_used is distinct from v_week then\n    v_how := 'week';\n  elsif", "  if false then\n    v_how := 'week';\n  elsif"],
  core_gift_before_week: ["  if v_used is distinct from v_week then\n    v_how := 'week';\n  elsif stat_reset_gift_use_v2(p_player, p_card) then\n    v_how := 'gift';\n",
    "  if stat_reset_gift_use_v2(p_player, p_card) then\n    v_how := 'gift';\n  elsif v_used is distinct from v_week then\n    v_how := 'week';\n"],
  core_v1_gift: ['  elsif stat_reset_gift_use_v2(p_player, p_card) then', '  elsif stat_reset_gift_use(p_player, p_card) then'],
  core_no_price_check: ["    if coalesce(v_bal, 0) < p_price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', p_price); end if;\n", ''],
  core_week_utc: ["  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW'); v_used text; v_how text; v_bal int;", "  v_week text := to_char(now(), 'IYYY-IW'); v_used text; v_how text; v_bal int;"],
  core_no_marker: ["  if v_how = 'week' then update players set stat_reset_week = v_week where id = p_player; end if;\n  return jsonb_build_object('ok', true, 'used', v_how)", "  return jsonb_build_object('ok', true, 'used', v_how)"],
  shop_own_copy: ["      v_v2 := card_progress_v2_reset(p_player, p_card, v_price);   -- M1d
", "      v_v2 := card_progress_v2_reset_shop(p_player, p_card, v_price);   -- M1d
", MARK2, CORE_COPY + '
' + MARK2],
  rv2_price_zero: ['  return card_progress_v2_reset(p_player, p_card, null);', '  return card_progress_v2_reset(p_player, p_card, 0);'],
  gift_no_skip: [GIFT_LINE, '       and true'],
  gift_like_wildcard: [GIFT_LINE, "       and gift not like 'v2_%'"],
  grant_anon: ['grant execute on function public.card_progress_v2_reset(text, bigint, integer) to service_role;', 'grant execute on function public.card_progress_v2_reset(text, bigint, integer) to service_role, anon;'],
  comment_no_freeze: [/comment on function public\.reset_stat_points\(text, bigint\) is \$c\$[^\n]*\n/, "comment on function public.reset_stat_points(text, bigint) is $c$Clears the stat points of one card.$c$;\n"],
  flag_on: [MARK, `update public.balance set value = jsonb_set(value, '{progress}', 'true') where key = 'combat_v2';\n${MARK}`],
  other_fn_changed: [MARK, `create or replace function public.balance_who() returns text language sql stable set search_path to 'public' as $p$
  select coalesce(nullif(current_setting('balance.by', true), ''), session_user::text) || '';
$p$;
${MARK}`],
  other_reader: [MARK, `create or replace function public.m1d_probe() returns boolean language sql stable set search_path = public as $p$ select combat_v2_on('progress', 'x') $p$;\n${MARK}`],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)          ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (base.status !== 0) ok = false;
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const out = (r.stdout || '').trim().split(/\r?\n/);
    const line = out.pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const first = out.find((l) => l.startsWith('FAIL')) || '';
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  ${first.slice(0, 110)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  for (let i = 0; i < m.length; i += 2) {
    if (mig.split(m[i]).length !== 2) throw new Error(`the mutation ${process.env.MUTATE} (part ${i / 2 + 1}) does not match the migration exactly once`);
    mig = mig.split(m[i]).join(m[i + 1]);
  }
}
if (['$m$', '$t$', '$q$', '$s$'].some((x) => mig.includes(x) || M1C_RESET.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $q$ or $s$');

// the guard (checked on its own), the file without it (run in the block), and the state before the file
const GUARD_RE = /\ndo \$g\$[\s\S]*?-- GUARD-END\n/;
const guard = (mig.match(GUARD_RE) || [])[0];
if (!guard) throw new Error('the file has no guard');
const MD5 = Object.fromEntries([...guard.matchAll(/\('public\.([a-z0-9_]+)\([^']*\)', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], { old: m[2], new: m[3] }]));
if (Object.keys(MD5).length !== 5) throw new Error('the guard must name 5 functions with an old and a new md5');
const body0 = mig.replace(GUARD_RE, '\n');
const OLD_V1 = [...body0.replace(/^.*-- M1d\b.*\n/gm, '').matchAll(/^CREATE OR REPLACE FUNCTION[\s\S]*?^end \$function\$;\n/gm)].map((m) => m[0]);
if (OLD_V1.length !== 4) throw new Error('the file must have the 4 v1 functions in the live format');
const OLD_FNS = OLD_V1.join('\n') + '\n' + M1C_RESET + '\ndrop function if exists public.card_progress_v2_reset(text, bigint, integer);\n';
const ADDED = (body0.match(/^.*-- M1d\b.*\n/gm) || []).length;

const MINE = ['spend_stat_points(text,bigint,jsonb)', 'reset_stat_points(text,bigint)', 'stat_reset_gift_use(text,bigint)', 'buy_shop_item(text,text,integer,bigint,integer)', 'reset_card_points_v2(text,bigint)'];
const NEWFN = 'card_progress_v2_reset(text,bigint,integer)';
const READERS = ['spend_stat_points(text,bigint,jsonb)', 'reset_stat_points(text,bigint)', 'buy_shop_item(text,text,integer,bigint,integer)'];
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const sig = "replace(p.oid::regprocedure::text, ', ', ',')";
const P = '999999999999999961', Q = '999999999999999962';
const md5lit = lit(JSON.stringify(MD5));
// a sub-block that runs <expr> (jsonb), rolls back every write, and keeps the value in <into>
const sub = (stmts, expr, into) => `begin ${stmts} r := jsonb_build_object('v', ${expr}); raise exception 'SCN:%', r; exception when raise_exception then if sqlerrm like 'SCN:%' then ${into} := substr(sqlerrm, 5)::jsonb->'v'; else raise; end if; end;`;
// the fixed clock: now() of the v2 reset functions read from the setting m1d.now (inside a sub-block only)
const CLOCK = (fns) => fns.map((f) => `execute replace(pg_get_functiondef('public.${f}'::regprocedure), 'now()', 'pg_temp.m1d_now()');`).join(' ');

const body = String.raw`do $t$
declare res jsonb := '[]'; bad text[] := '{}'; md5a jsonb; md5b jsonb; flag_a jsonb; callers_a text[]; callers_b text[]; fns_a text[]; fns_b text[];
  mine text[] := array[${MINE.map(lit).join(', ')}]; readers text[] := array[${READERS.map(lit).join(', ')}];
  ca bigint; cb bigint; cn bigint; cr bigint; j int; r jsonb; s0 jsonb; s1 jsonb; k text; ok boolean; xa text; xb text; xp text; m text;
  old_p jsonb; old_q jsonb; new_p jsonb; new_q jsonb; tst_q jsonb; old_c jsonb; new_c jsonb; flag_off jsonb; flag_testers jsonb; flag_all jsonb;
  pa bigint; v_price int; v_bal int; v_week text;
begin
  -- 0. the state before the file (also when the file is applied on this copy)
  execute $m$${OLD_FNS}$m$;
  bad := '{}';
  foreach k in array mine loop
    m := md5(replace(pg_get_functiondef(('public.' || k)::regprocedure), chr(13), ''));
    if m is distinct from (${md5lit}::jsonb -> split_part(k, '(', 1) ->> 'old') then bad := bad || k; end if;
  end loop;
  res := res || jsonb_build_object('case', 'T0 the state before: the file minus its ${ADDED} "-- M1d" lines (the 4 v1 functions) and the M1c reset_card_points_v2 have the old md5 of the guard (= main)', 'ok', cardinality(bad) = 0, 'bad', bad);
  select jsonb_object_agg(${sig}, md5(pg_get_functiondef(p.oid))) into md5a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into fns_a from pg_proc p where p.pronamespace = 'public'::regnamespace;
  select value into flag_a from public.balance where key = 'combat_v2';
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into callers_a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(';

  -- the helpers of this block (pg_temp, gone with the rollback): calls that never raise, a snapshot of every row the calls may write
  create function pg_temp.sp(p text, c bigint, a jsonb) returns jsonb language plpgsql as $q$
  begin return public.spend_stat_points(p, c, a); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.rs(p text, c bigint) returns jsonb language plpgsql as $q$
  begin return public.reset_stat_points(p, c); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.sh(p text, kind text, slot int, c bigint, qty int) returns jsonb language plpgsql as $q$
  begin return public.buy_shop_item(p, kind, slot, c, qty); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.gu(p text, c bigint) returns jsonb language plpgsql as $q$
  begin return to_jsonb(public.stat_reset_gift_use(p, c)); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.sp2(p text, c bigint, a jsonb) returns jsonb language plpgsql as $q$
  begin return public.spend_card_points_v2(p, c, a); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.rs2(p text, c bigint) returns jsonb language plpgsql as $q$
  begin return public.reset_card_points_v2(p, c); exception when others then return jsonb_build_object('raised', sqlerrm); end $q$;
  create function pg_temp.m1d_now() returns timestamptz language sql stable as $q$ select current_setting('m1d.now')::timestamptz $q$;
  create function pg_temp.snap(p text) returns jsonb language sql as $q$
    select jsonb_build_object(
      'cards', (select coalesce(jsonb_agg(jsonb_build_object('c', card_id, 'q', quantity, 'pts', stat_points, 'asc', ascension) order by card_id), '[]') from public.player_cards where player_id = p),
      'player', (select jsonb_build_object('week', stat_reset_week, 'shards', shard_balance, 'packs', pack_balance) from public.players where id = p),
      'gifts', (select coalesce(jsonb_agg(jsonb_build_object('g', gift, 'used', used_at is not null, 'card', used_card) order by gift), '[]') from public.stat_reset_gifts where player_id = p),
      'shop', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'kind', kind, 'slot', slot, 'card', card_id, 'qty', qty, 'price', price) order by id), '[]') from public.shop_purchases where player_id = p),
      'shards', (select coalesce(jsonb_agg(jsonb_build_object('a', amount, 'r', reason, 'k', ref_kind) order by id), '[]') from public.shard_ledger where player_id = p),
      'packs', (select coalesce(jsonb_agg(jsonb_build_object('a', amount, 'r', reason, 'k', ref_kind) order by id), '[]') from public.pack_ledger where player_id = p),
      'cardlog', (select coalesce(jsonb_agg(jsonb_build_object('c', card_id, 'a', amount, 'r', reason) order by id), '[]') from public.card_ledger where player_id = p),
      'statlog', (select coalesce(jsonb_agg(jsonb_build_object('c', card_id, 's', stat, 'd', delta, 'p', points, 'r', reason) order by id), '[]') from public.stat_point_log where player_id = p),
      'v2', (select coalesce(jsonb_agg(to_jsonb(x) - 'updated_at' - 'id' order by x.card_id), '[]') from public.card_progress_v2 x where x.player_id = p),
      'v2log', (select coalesce(jsonb_agg(jsonb_build_object('c', l.card_id, 'r', l.reason, 's', l.stat, 'd', l.d_points) order by l.id), '[]') from public.card_progress_v2_log l where l.player_id = p)) $q$;
  -- the v1 series of one player (17 calls): every answer, then the snapshot of its rows
  create function pg_temp.scn(p text, ca bigint, cb bigint, cn bigint, j int) returns jsonb language plpgsql as $q$
  declare a jsonb := '[]';
  begin
    a := a || pg_temp.sp(p, ca, '{"attack": 2, "haste": 1}');
    a := a || pg_temp.sp(p, ca, '{"attack": 60}');
    a := a || pg_temp.sp(p, ca, '{"luck": 1}');
    a := a || pg_temp.sp(p, cn, '{"attack": 1}');
    a := a || pg_temp.rs(p, ca);                                  -- the weekly free reset
    a := a || pg_temp.sp(p, ca, '{"vitality": 1}');
    a := a || pg_temp.rs(p, ca);                                  -- the v1 gift
    a := a || pg_temp.sp(p, ca, '{"precision": 1}');
    a := a || pg_temp.rs(p, ca);                                  -- reset_used with next
    a := a || pg_temp.sh(p, 'stat_reset', null, ca, 1);          -- the Shop reset with Shards
    a := a || pg_temp.sp(p, cb, '{"potency": 1}');
    update public.players set stat_reset_week = null where id = p;
    a := a || pg_temp.sh(p, 'stat_reset', null, cb, 1);          -- the free weekly Shop reset
    a := a || pg_temp.sh(p, 'pack', null, null, 1);
    a := a || pg_temp.sh(p, 'card', j, null, 1);
    a := a || pg_temp.rs(p, cb);                                  -- nothing_spent
    a := a || pg_temp.sh(p, 'stat_reset', null, cb, 1);          -- nothing_spent
    a := a || pg_temp.sp(p, cb, '{"attack": 1}');
    return jsonb_build_object('answers', a, 'codes', (select jsonb_agg(coalesce(x->>'error', case when x ? 'raised' then 'raised' else 'ok' end) order by n) from jsonb_array_elements(a) with ordinality q(x, n)), 'rows', pg_temp.snap(p));
  end $q$;
  -- the v2 reset series at 6 fixed instants (Mountain week 43 ends Sunday 2026-10-25 24:00 MDT = 06:00 UTC; week 45 ends 2026-11-08 24:00 MST)
  create function pg_temp.clk(p text, c bigint) returns jsonb language plpgsql as $q$
  declare a jsonb := '[]'; t text; s jsonb;
  begin
    update public.players set stat_reset_week = null where id = p;
    foreach t in array array['2026-10-25 17:59:00-06', '2026-10-25 19:00:00-06', '2026-10-25 19:00:00-06', '2026-10-26 00:00:00-06', '2026-11-08 17:30:00-07', '2026-11-08 18:30:00-07'] loop
      perform set_config('m1d.now', t, true);
      s := pg_temp.sp2(p, c, '{"atk": 1, "spd": 1}');
      s := pg_temp.rs2(p, c);
      a := a || jsonb_build_object('at', t, 'used', coalesce(s->>'used', s->>'error', s->>'raised'), 'next', s->'next', 'week', (select stat_reset_week from public.players where id = p),
        'answer', s - 'stats', 'stats', s->'stats');
    end loop;
    return jsonb_build_object('steps', a, 'rows', pg_temp.snap(p) - 'cards' - 'player' - 'shop' - 'shards' - 'packs' - 'cardlog' - 'statlog');   -- the v2 rows, the v2 ledger and the gifts
  end $q$;

  -- the sample: two test players, cards (two with a v2 role, one other, one whose role is removed), a v1 gift each, Shards, today's stock
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'm1d-test', true);
  perform set_config('timezone', 'UTC', true);
  insert into public.players (id, username) values ('${P}', 'm1d test p'), ('${Q}', 'm1d test q');
  select c.id into ca from public.cards c join public.subjects s on s.id = c.subject_id where s.ability_v2->>'role' in (select key from public.roles) order by c.id limit 1;
  select c.id into cb from public.cards c join public.subjects s on s.id = c.subject_id where s.ability_v2->>'role' in (select key from public.roles) and c.id > ca order by c.id limit 1;
  select c.id into cr from public.cards c where c.subject_id not in (select subject_id from public.cards where id in (ca, cb)) and c.id > cb order by c.id limit 1;
  select c.id into cn from public.cards c where c.id not in (ca, cb, cr) order by c.id limit 1;
  if ca is null or cb is null or cr is null or cn is null then raise exception 'the sample: no cards'; end if;
  update public.subjects set ability_v2 = null where id = (select subject_id from public.cards where id = cr);   -- cr: a card with no v2 role
  insert into public.player_cards (player_id, card_id, quantity, first_source, ascension) values
    ('${P}', ca, 1, 'admin', 2), ('${P}', cb, 1, 'admin', 1), ('${P}', cr, 1, 'admin', 0), ('${Q}', ca, 1, 'admin', 2), ('${Q}', cb, 1, 'admin', 1);
  insert into public.stat_reset_gifts (player_id, gift, expires_at) values ('${P}', 'r_m1d_test', now() + interval '5 days'), ('${Q}', 'r_m1d_test', now() + interval '5 days');
  perform public.grant_shards('${P}', 5000, 'admin', 'test', 'm1d test');
  perform public.grant_shards('${Q}', 5000, 'admin', 'test', 'm1d test');
  update public.balance set value = jsonb_set(value, '{enabled}', 'true') where key = 'stat_points';
  update public.settings set value = jsonb_set(value, '{enabled}', 'true') where key = 'shards';
  delete from public.shop_stock where day = shop_day();
  perform public.shop_pick_stock(shop_day());
  select slot into j from public.shop_stock where day = shop_day() order by price, slot limit 1;
  v_price := game_shop_price((shard_cfg()->>'stat_reset_price')::int);
  v_week := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
  flag_off := jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers', '[]'::jsonb);
  flag_testers := jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', false, 'testers', jsonb_build_array('${P}'));
  flag_all := jsonb_build_object('gauntlet', false, 'dungeon', false, 'hunt', false, 'progress', true, 'testers', '[]'::jsonb);
  update public.balance set value = flag_off where key = 'combat_v2';

  -- 1. BEFORE the file: the v1 series of each player (each in a sub-block that rolls back)
  ${sub('', `pg_temp.scn('${P}', ca, cb, cn, j)`, 'old_p')}
  ${sub('', `pg_temp.scn('${Q}', ca, cb, cn, j)`, 'old_q')}
  res := res || jsonb_build_object('case', 'the v1 series before the file has the expected answers (so the compare below is not empty)', 'ok',
    old_p->'codes' = '["ok", "not_enough", "bad_stat", "not_owned", "ok", "ok", "ok", "ok", "reset_used", "ok", "ok", "ok", "ok", "ok", "nothing_spent", "nothing_spent", "ok"]'::jsonb
    and old_q->'codes' = old_p->'codes' and (old_p->'answers'->9->>'free')::boolean is false and (old_p->'answers'->11->>'free')::boolean is true, 'got', old_p->'codes');
  -- the M1c reset_card_points_v2 at the fixed instants (a tester; one open v2 gift)
  ${sub(`update public.balance set value = flag_testers where key = 'combat_v2';
    insert into public.card_progress_v2 (player_id, card_id, level, xp) values ('${P}', cb, 30, card_level_xp_at(30));
    insert into public.stat_reset_gifts (player_id, gift, expires_at) values ('${P}', 'v2_m1d_clock', '2026-12-31 00:00:00+00');
    ${CLOCK(['reset_card_points_v2(text, bigint)', 'stat_reset_gift_use_v2(text, bigint)'])}`, `pg_temp.clk('${P}', cb)`, 'old_c')}

  -- 2. the guard on the old state, then the file
  execute $m$${guard}$m$;
  execute $m$${body0}$m$;

  -- T1. no other change
  select jsonb_object_agg(${sig}, md5(pg_get_functiondef(p.oid))) into md5b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  res := res || jsonb_build_object('case', format('T1 the md5 of the %s other public functions does not change; exactly the 5 functions change', (select count(*) from jsonb_object_keys(md5a)) - 5), 'ok',
    (select coalesce(array_agg(x.key order by x.key), '{}') from jsonb_each_text(md5b) x where md5a ? x.key and md5a->>x.key is distinct from x.value) = (select array_agg(x order by x) from unnest(mine) x)
    and not exists (select 1 from jsonb_each_text(md5a) x where not md5b ? x.key),
    'changed', (select jsonb_agg(x.key) from jsonb_each_text(md5b) x where md5a ? x.key and md5a->>x.key is distinct from x.value));
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into fns_b from pg_proc p where p.pronamespace = 'public'::regnamespace and ${sig} <> all (fns_a);
  res := res || jsonb_build_object('case', 'T1 exactly one function is added: card_progress_v2_reset', 'ok', fns_b = array[${lit(NEWFN)}], 'added', fns_b);
  res := res || jsonb_build_object('case', 'T1 the flag combat_v2 does not change (progress stays false)', 'ok', (select value from public.balance where key = 'combat_v2') = flag_off);
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into callers_b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'combat_v2_on\s*\(';
  res := res || jsonb_build_object('case', 'T1 the readers of combat_v2_on = before + spend_stat_points, reset_stat_points and buy_shop_item', 'ok',
    callers_b = (select array_agg(x order by x) from (select unnest(callers_a) x union select unnest(readers)) q) and not (callers_a && readers),
    'now', (select array_agg(x) from unnest(callers_b) x where x <> all (callers_a)));
  select coalesce(array_agg(${sig} order by ${sig}), '{}') into bad from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'card_progress_v2_reset' and p.proname <> 'card_progress_v2_reset';
  res := res || jsonb_build_object('case', 'T1 only reset_card_points_v2 and buy_shop_item call card_progress_v2_reset', 'ok', bad = array['buy_shop_item(text,text,integer,bigint,integer)', 'reset_card_points_v2(text,bigint)'], 'callers', bad);
  ${process.env.MUTATE ? '-- (a mutation changes the text, so the new md5 of the guard cannot match it: these two cases run in the baseline only)' : String.raw`bad := '{}';
  foreach k in array mine loop
    if md5(replace(pg_get_functiondef(('public.' || k)::regprocedure), chr(13), '')) is distinct from (${md5lit}::jsonb -> split_part(k, '(', 1) ->> 'new') then bad := bad || k; end if;
  end loop;
  res := res || jsonb_build_object('case', 'T0 the guard: its new md5 = the md5 of the 5 functions this file made', 'ok', cardinality(bad) = 0, 'bad', bad);
  begin execute $m$${guard}$m$; ok := true; exception when others then ok := false; end;
  res := res || jsonb_build_object('case', 'T0 the guard accepts the state after the file (a second run)', 'ok', ok);`}
  begin
    execute replace(pg_get_functiondef('public.stat_reset_gift_use(text, bigint)'::regprocedure), 'return found;', 'return found; -- changed');
    execute $m$${guard}$m$;
    ok := false;
    raise exception 'GUARD:passed';
  exception when others then ok := sqlerrm like '%changed since this file was built%';
  end;
  res := res || jsonb_build_object('case', 'T0 the guard refuses a function that is neither the old nor the new text', 'ok', ok);

  -- T2. server only, search_path, comments
  bad := '{}';
  foreach k in array mine || ${lit(NEWFN)}::text loop
    if has_function_privilege('anon', 'public.' || k, 'execute') or has_function_privilege('authenticated', 'public.' || k, 'execute') then bad := bad || ('anon or authenticated can execute ' || k); end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = ('public.' || k)::regprocedure and a.grantee = 0) or (select proacl is null from pg_proc where oid = ('public.' || k)::regprocedure) then bad := bad || ('public can execute ' || k); end if;
    if not has_function_privilege('service_role', 'public.' || k, 'execute') then bad := bad || ('service_role cannot execute ' || k); end if;
    if not exists (select 1 from pg_proc p where p.oid = ('public.' || k)::regprocedure and 'search_path=public' = any(p.proconfig)) then bad := bad || ('no search_path: ' || k); end if;
    if coalesce(obj_description(('public.' || k)::regprocedure, 'pg_proc'), '') !~ 'combat_v2_progress_freeze_v1\.sql' then bad := bad || ('the comment does not name the file: ' || k); end if;
  end loop;
  foreach k in array readers loop
    if coalesce(obj_description(('public.' || k)::regprocedure, 'pg_proc'), '') !~ 'combat_v2_on\(''progress'', player\)' then bad := bad || ('the comment does not give the rule: ' || k); end if;
  end loop;
  if coalesce(obj_description('public.stat_reset_gift_use(text, bigint)'::regprocedure, 'pg_proc'), '') !~ 'starts with v2_' then bad := bad || 'the gift comment does not give the v2_ rule'::text; end if;
  if coalesce(obj_description('public.card_progress_v2_reset(text, bigint, integer)'::regprocedure, 'pg_proc'), '') !~ '^\[combat\] ' then bad := bad || 'no [combat] comment on card_progress_v2_reset'::text; end if;
  foreach k in array array['combat_v2_on(text)', 'combat_v2_on(text,text)'] loop
    if coalesce(obj_description(('public.' || k)::regprocedure, 'pg_proc'), '') ~ 'No v1 function calls it' or coalesce(obj_description(('public.' || k)::regprocedure, 'pg_proc'), '') !~ '^\[combat\] .*spend_stat_points.*reset_stat_points.*buy_shop_item' then
      bad := bad || ('the comment of ' || k || ' does not name the 3 v1 readers'); end if;
  end loop;
  res := res || jsonb_build_object('case', 'T2 server only (no execute for public, anon, authenticated), search_path, and the comments (the rule; combat_v2_on names the 3 v1 readers)', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- 3. flag OFF (the live state): the same answers and the same writes as before the file
  ${sub('', `pg_temp.scn('${P}', ca, cb, cn, j)`, 'new_p')}
  ${sub('', `pg_temp.scn('${Q}', ca, cb, cn, j)`, 'new_q')}
  res := res || jsonb_build_object('case', 'flag OFF: the 17 v1 calls (spend, reset, Shop reset, pack, card) give the same answers and the same writes as before the file (2 players)', 'ok',
    new_p = old_p and new_q = old_q, 'got', new_p->'codes', 'rows_same', new_p->'rows' = old_p->'rows');

  -- 4. progress ON for everyone: spend and reset refuse, write nothing, lock nothing; the Shop reset is the v2 one; pack and card work
  update public.player_cards set stat_points = '{"attack": 1}' where player_id = '${P}' and card_id = ca;   -- P has v1 points (Q stays as in the series)
  update public.balance set value = flag_all where key = 'combat_v2';
  bad := '{}';
  foreach k in array array['${P}', '${Q}'] loop
    s0 := pg_temp.snap(k);
    select xmax::text into xa from public.player_cards where player_id = k and card_id = ca;
    select xmax::text into xp from public.players where id = k;
    r := pg_temp.sp(k, ca, '{"attack": 1}'); if r is distinct from '{"ok": false, "error": "disabled"}'::jsonb then bad := bad || ('spend: ' || r::text); end if;
    r := pg_temp.rs(k, ca); if r is distinct from '{"ok": false, "error": "disabled"}'::jsonb then bad := bad || ('reset: ' || r::text); end if;
    select xmax::text into xb from public.player_cards where player_id = k and card_id = ca;
    if xb is distinct from xa then bad := bad || 'the spend or the reset locked the card row before the gate'::text; end if;
    select xmax::text into xb from public.players where id = k;
    if xb is distinct from xp then bad := bad || 'the reset locked the player row before the gate'::text; end if;
    r := pg_temp.sh(k, 'stat_reset', null, ca, 1); if r is distinct from '{"ok": false, "error": "no_progress"}'::jsonb then bad := bad || ('shop reset (no v2 row): ' || r::text); end if;
    if pg_temp.snap(k) is distinct from s0 then bad := bad || ('rows written for ' || case when k = '${P}' then 'P' else 'Q' end); end if;
  end loop;
  res := res || jsonb_build_object('case', 'progress ON for everyone: spend and reset answer disabled (no lock); the Shop reset is the v2 reset (no_progress); 0 rows written; the v1 points stay (2 players)', 'ok', cardinality(bad) = 0, 'bad', bad);
  bad := '{}';
  r := pg_temp.sh('${P}', 'pack', null, null, 1); if (r->>'ok')::boolean is not true or r->>'kind' <> 'pack' then bad := bad || ('pack: ' || r::text); end if;
  r := pg_temp.sh('${P}', 'card', j, null, 1); if (r->>'ok')::boolean is not true or r->>'kind' <> 'card' then bad := bad || ('card: ' || r::text); end if;
  res := res || jsonb_build_object('case', 'progress ON for everyone: the Shop pack and card still work', 'ok', cardinality(bad) = 0, 'bad', bad);

  -- 5. progress for testers only: the tester is refused / routed; the non-tester gets the same answers and writes as before the file
  update public.balance set value = flag_testers where key = 'combat_v2';
  bad := '{}';
  s0 := pg_temp.snap('${P}');
  r := pg_temp.sp('${P}', ca, '{"attack": 1}'); if r is distinct from '{"ok": false, "error": "disabled"}'::jsonb then bad := bad || ('spend: ' || r::text); end if;
  r := pg_temp.rs('${P}', ca); if r is distinct from '{"ok": false, "error": "disabled"}'::jsonb then bad := bad || ('reset: ' || r::text); end if;
  r := pg_temp.sh('${P}', 'stat_reset', null, ca, 1); if r is distinct from '{"ok": false, "error": "no_progress"}'::jsonb then bad := bad || ('shop reset: ' || r::text); end if;
  if pg_temp.snap('${P}') is distinct from s0 then bad := bad || 'rows written'::text; end if;
  res := res || jsonb_build_object('case', 'progress for testers only: the tester gets disabled from spend and reset and the v2 Shop reset (no_progress), 0 rows written', 'ok', cardinality(bad) = 0, 'bad', bad);
  ${sub('', `pg_temp.scn('${Q}', ca, cb, cn, j)`, 'tst_q')}
  res := res || jsonb_build_object('case', 'progress for testers only: the non-tester spends, resets and buys the v1 reset as before the file (the same 17 answers and writes)', 'ok',
    tst_q = old_q, 'got', tst_q->'codes', 'rows_same', tst_q->'rows' = old_q->'rows');

  -- 6. reset_card_points_v2 = the M1c function: the same answers and rows at the 6 fixed instants, and the expected order
  ${sub(`insert into public.card_progress_v2 (player_id, card_id, level, xp) values ('${P}', cb, 30, card_level_xp_at(30));
    insert into public.stat_reset_gifts (player_id, gift, expires_at) values ('${P}', 'v2_m1d_clock', '2026-12-31 00:00:00+00');
    ${CLOCK(['card_progress_v2_reset(text, bigint, integer)', 'reset_card_points_v2(text, bigint)', 'stat_reset_gift_use_v2(text, bigint)'])}`, `pg_temp.clk('${P}', cb)`, 'new_c')}
  res := res || jsonb_build_object('case', 'reset_card_points_v2 (through card_progress_v2_reset) = the M1c function: the same answers and rows at 6 fixed instants', 'ok', new_c = old_c and old_c is not null,
    'old', (select jsonb_agg(x->>'used') from jsonb_array_elements(old_c->'steps') x), 'new', (select jsonb_agg(x->>'used') from jsonb_array_elements(new_c->'steps') x));
  res := res || jsonb_build_object('case', 'the Mountain week at fixed instants: week (Sun 17:59 MDT), gift and reset_used (Sun 19:00 MDT: still week 43, UTC is Monday), week 44 (Mon 00:00 MDT), week 45 (Sun 17:30 MST), reset_used (Sun 18:30 MST)', 'ok',
    (select jsonb_agg(x->'used') from jsonb_array_elements(new_c->'steps') x) = '["week", "gift", "reset_used", "week", "week", "reset_used"]'::jsonb
    and (select jsonb_agg(x->'week') from jsonb_array_elements(new_c->'steps') x) = '["2026-43", "2026-43", "2026-43", "2026-44", "2026-45", "2026-45"]'::jsonb
    and (new_c->'steps'->2->>'next')::timestamptz = '2026-10-26 06:00:00+00' and (new_c->'steps'->5->>'next')::timestamptz = '2026-11-09 07:00:00+00',
    'got', (select jsonb_agg(jsonb_build_array(x->'used', x->'week', x->'next')) from jsonb_array_elements(new_c->'steps') x));

  -- 7. the routed Shop reset (P is a tester): the week, then a v2_ gift, then the price; never a v1 gift
  delete from public.stat_reset_gifts where player_id = '${P}';
  insert into public.stat_reset_gifts (player_id, gift, expires_at) values ('${P}', 'r_m1d_route', now() + interval '1 hour'), ('${P}', 'v2_m1d_route', now() + interval '2 hours');
  insert into public.card_progress_v2 (player_id, card_id, level, xp) values ('${P}', ca, 30, card_level_xp_at(30)) returning id into pa;
  insert into public.card_progress_v2 (player_id, card_id, level, xp) values ('${P}', cr, 1, card_level_xp_at(1));
  update public.player_cards set stat_points = '{"attack": 1}' where player_id = '${P}' and card_id = ca;
  update public.players set stat_reset_week = null where id = '${P}';
  select shard_balance into v_bal from public.players where id = '${P}';
  r := pg_temp.sp2('${P}', ca, '{"atk": 2, "def": 1}');
  s0 := pg_temp.snap('${P}');
  r := pg_temp.sh('${P}', 'stat_reset', null, ca, 1);
  s1 := pg_temp.snap('${P}');
  res := res || jsonb_build_object('case', 'Shop reset 1 (v2, P a tester): the free week: free, price 0, the Shards and the gifts unchanged, the marker = this week, one purchase row (price 0), no Shards row, 2 ledger rows (reason reset, one ref reset:<n>)', 'ok',
    (r - 'progress' - 'stats') = jsonb_build_object('ok', true, 'kind', 'stat_reset', 'free', true, 'price', 0, 'balance', v_bal, 'used', 'week')
    and r->'progress' = (public.card_progress_v2_view('${P}', ca))->'progress' and r->'stats' = (public.card_progress_v2_view('${P}', ca))->'stats'
    and s1->'player'->>'week' = v_week and s1->'player'->'shards' = s0->'player'->'shards' and s1->'gifts' = s0->'gifts' and s1->'shards' = s0->'shards'
    and jsonb_array_length(s1->'shop') = jsonb_array_length(s0->'shop') + 1 and s1->'shop'->-1 = jsonb_build_object('day', shop_day(), 'kind', 'stat_reset', 'slot', null, 'card', ca, 'qty', 1, 'price', 0)
    and jsonb_array_length(s1->'v2log') = jsonb_array_length(s0->'v2log') + 2 and s1->'cards' = s0->'cards'
    and (select atk_pts + def_pts from public.card_progress_v2 where id = pa) = 0
    and (select count(*) = 2 and count(distinct ref) = 1 and bool_and(ref ~ '^reset:[0-9]+$') from public.card_progress_v2_log where player_id = '${P}' and card_id = ca and reason = 'reset'), 'got', r - 'stats');
  r := pg_temp.sp2('${P}', ca, '{"atk": 1}');
  s0 := pg_temp.snap('${P}');
  r := pg_temp.sh('${P}', 'stat_reset', null, ca, 1);
  s1 := pg_temp.snap('${P}');
  res := res || jsonb_build_object('case', 'Shop reset 2 (v2): the week is used, so the v2_ gift (free, used with the card); the v1 gift (earlier deadline) stays open; no Shards', 'ok',
    r->>'used' = 'gift' and (r->>'free')::boolean and (r->>'price')::int = 0 and s1->'shards' = s0->'shards'
    and (select used_card from public.stat_reset_gifts where player_id = '${P}' and gift = 'v2_m1d_route') = ca
    and (select used_at from public.stat_reset_gifts where player_id = '${P}' and gift = 'r_m1d_route') is null, 'got', r - 'stats' - 'progress');
  update public.balance set value = flag_all where key = 'combat_v2';   -- resets 3 and 4 with progress ON for everyone (1 and 2: P as a tester)
  r := pg_temp.sp2('${P}', ca, '{"hp": 1}');
  s0 := pg_temp.snap('${P}');
  r := pg_temp.sh('${P}', 'stat_reset', null, ca, 1);
  s1 := pg_temp.snap('${P}');
  res := res || jsonb_build_object('case', format('Shop reset 3 (v2, progress ON for everyone): no free reset left, so the price %s: Shards taken once (one ledger row, ref shop_purchase), one purchase row; the v1 gift stays open', v_price), 'ok',
    v_price > 0 and r->>'used' = 'paid' and (r->>'free')::boolean is false and (r->>'price')::int = v_price and (r->>'balance')::int = v_bal - v_price
    and (s1->'player'->>'shards')::int = v_bal - v_price and jsonb_array_length(s1->'shards') = jsonb_array_length(s0->'shards') + 1
    and s1->'shards'->-1 = jsonb_build_object('a', -v_price, 'r', 'shop', 'k', 'shop_purchase')
    and s1->'shop'->-1 = jsonb_build_object('day', shop_day(), 'kind', 'stat_reset', 'slot', null, 'card', ca, 'qty', 1, 'price', v_price)
    and (select used_at from public.stat_reset_gifts where player_id = '${P}' and gift = 'r_m1d_route') is null, 'got', r - 'stats' - 'progress');
  r := pg_temp.sp2('${P}', ca, '{"acc": 1}');
  perform public.grant_shards('${P}', (v_price - 1) - (select shard_balance from public.players where id = '${P}'), 'admin', 'test', 'm1d test');   -- one Shard short (from the real balance)
  s0 := pg_temp.snap('${P}');
  r := pg_temp.sh('${P}', 'stat_reset', null, ca, 1);
  res := res || jsonb_build_object('case', 'Shop reset 4 (v2): one Shard short: not_enough with balance and price, 0 rows written', 'ok',
    r = jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_price - 1, 'price', v_price) and pg_temp.snap('${P}') = s0, 'got', r);
  bad := '{}';
  update public.players set stat_reset_week = null where id = '${P}';
  s0 := pg_temp.snap('${P}');
  r := pg_temp.sh('${P}', 'stat_reset', null, cn, 1); if r is distinct from '{"ok": false, "error": "not_owned"}'::jsonb then bad := bad || ('not owned: ' || r::text); end if;
  r := pg_temp.sh('${P}', 'stat_reset', null, cb, 1); if r is distinct from '{"ok": false, "error": "no_progress"}'::jsonb then bad := bad || ('no progress: ' || r::text); end if;
  r := pg_temp.sh('${P}', 'stat_reset', null, cr, 1); if r is distinct from '{"ok": false, "error": "no_role"}'::jsonb then bad := bad || ('no role: ' || r::text); end if;
  if pg_temp.snap('${P}') is distinct from s0 then bad := bad || 'rows written by not_owned, no_progress or no_role'::text; end if;
  insert into public.card_progress_v2 (player_id, card_id, level, xp) values ('${P}', cb, 1, card_level_xp_at(1));
  s0 := pg_temp.snap('${P}');
  r := pg_temp.sh('${P}', 'stat_reset', null, cb, 1); if r is distinct from '{"ok": false, "error": "nothing_spent"}'::jsonb then bad := bad || ('nothing spent: ' || r::text); end if;
  if pg_temp.snap('${P}') is distinct from s0 then bad := bad || 'rows written'::text; end if;
  res := res || jsonb_build_object('case', 'the v2 Shop reset refuses not_owned, no_progress, no_role, nothing_spent before any write (the week stays free)', 'ok', cardinality(bad) = 0, 'bad', bad);
  update public.balance set value = flag_off where key = 'combat_v2';

  -- 8. the v1 gift use: never a v2_ gift, still a v1 gift; 'v2xfoo' is not a v2_ key
  insert into public.stat_reset_gifts (player_id, gift, expires_at) values
    ('${Q}', 'v2_m1d_a', now() + interval '1 hour'), ('${Q}', 'v2xm1d', now() + interval '2 hours'), ('${Q}', 'v2_m1d_b', now() + interval '3 hours');
  r := jsonb_build_array(pg_temp.gu('${Q}', cb), pg_temp.gu('${Q}', cb), pg_temp.gu('${Q}', cb));
  res := res || jsonb_build_object('case', 'stat_reset_gift_use (v1): in deadline order v2_ (skipped), v2xm1d (taken), v2_ (skipped), r_ (taken), then none; both v2_ gifts stay open', 'ok',
    r = '[true, true, false]'::jsonb and (select used_card from public.stat_reset_gifts where player_id = '${Q}' and gift = 'v2xm1d') = cb
    and (select used_card from public.stat_reset_gifts where player_id = '${Q}' and gift = 'r_m1d_test') = cb
    and not exists (select 1 from public.stat_reset_gifts where player_id = '${Q}' and starts_with(gift, 'v2_') and used_at is not null), 'got', r);
  delete from public.stat_reset_gifts where player_id = '${P}';
  insert into public.stat_reset_gifts (player_id, gift, expires_at) values ('${P}', 'v2_m1d_a', now() + interval '1 hour'), ('${P}', 'r_m1d_late', now() + interval '2 hours');
  update public.players set stat_reset_week = v_week where id = '${P}';
  update public.player_cards set stat_points = '{"attack": 1}' where player_id = '${P}' and card_id = ca;
  r := pg_temp.rs('${P}', ca);
  res := res || jsonb_build_object('case', 'reset_stat_points (flag OFF) with the week used: takes the v1 gift (later deadline), never the v2_ gift', 'ok', (r->>'ok')::boolean is true
    and (select used_card from public.stat_reset_gifts where player_id = '${P}' and gift = 'r_m1d_late') = ca
    and (select used_at from public.stat_reset_gifts where player_id = '${P}' and gift = 'v2_m1d_a') is null, 'got', r - 'stats');
  update public.player_cards set stat_points = '{"attack": 1}' where player_id = '${P}' and card_id = ca;
  r := pg_temp.sh('${P}', 'stat_reset', null, ca, 1);
  res := res || jsonb_build_object('case', 'the v1 Shop reset (flag OFF) with the week and the v1 gift used: not free (Shards or not_enough), the v2_ gift stays open', 'ok',
    coalesce((r->>'free')::boolean, false) is false and coalesce(r->>'error', 'ok') in ('ok', 'not_enough')
    and (select used_at from public.stat_reset_gifts where player_id = '${P}' and gift = 'v2_m1d_a') is null, 'got', r - 'stats');

  -- 9. the file runs twice
  select jsonb_object_agg(${sig}, md5(pg_get_functiondef(p.oid))) into md5a from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  execute $m$${body0}$m$;
  select jsonb_object_agg(${sig}, md5(pg_get_functiondef(p.oid))) into md5b from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p');
  res := res || jsonb_build_object('case', 'a second run of the file changes no function', 'ok', md5a = md5b);

  raise exception 'RESULT:%', res::text;
end $t$;`;

let results;
try { results = JSON.parse(await runBlock(body)); }
catch (e) { console.log(`FAIL the test block raised (the file did not apply?): ${String(e.message).slice(0, 600)}`); console.log('1 of 1 FAILED'); process.exit(1); }
let fail = 0;
for (const r of results) {
  const { case: name, ok, ...rest } = r;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 900)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
