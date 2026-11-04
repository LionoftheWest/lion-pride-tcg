import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_convert.sql (combat v2 step M1e; SPEC ON v6 3.7 and 6.4 CV1-CV12) and the switch files
 * combat_v2_switch_on.sql / combat_v2_switch_off.sql (SPEC ON 3.6).
 * Phase 1: NO lasting change: one request = the file (with the mutation) + one DO block, undone by its final RAISE. The block runs the REAL
 *   switch file on the whole local copy (fresh from live), so CV4 checks every real row. Test players have ids of 18 digits (999...97x).
 * Phase 2 (CV8, two real connections): COMMITS one test player with one card, B spends a v1 point while A runs the switch file in a block
 *   that is undone; the finally step deletes the test player and its rows. Take the local database lock first.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-convert.mjs     must PASS
 *   MUTATE=<name> ...                                                                           must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                              the baseline (must PASS), then every mutation
 * Cases (SPEC ON 6.4): CV1 the 4 examples (option B); CV2 cap and bonus; CV3 top-up; CV4 every real row; CV5 double apply, any ref, undo,
 *   fix twice, a failed ledger insert; CV6 v1 untouched; CV7 undo and redo; CV8 late spend (phase 2); CV9 numbers from balance (+ C1);
 *   CV11 live level (N-7b); CV12 Shop reset paused (progress ON) and the v1 Shop reset unchanged (progress OFF); SW the switch files.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rawQuery, runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-convert.mjs');

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILE = process.env.MIG || `${ROOT}tcg-bot/supabase/combat_v2_convert.sql`;
let mig = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
let swOn = readFileSync(`${ROOT}tcg-bot/supabase/combat_v2_switch_on.sql`, 'utf8').replace(/\r\n/g, '\n');
const swOff = readFileSync(`${ROOT}tcg-bot/supabase/combat_v2_switch_off.sql`, 'utf8').replace(/\r\n/g, '\n');

const PAUSE = "  if p_kind = 'stat_reset' and combat_v2_on('progress', p_player) then   -- M1e\n    return jsonb_build_object('ok', false, 'error', 'stat_reset_paused', 'message', 'Stat reset returns with the v2 stats screen.');   -- M1e\n  end if;   -- M1e\n";
const CHARGE = "      if v_price > 0 then v_new := grant_shards(p_player, -v_price, 'shop', 'shop_purchase', v_purchase::text); end if;   -- M1d\n";
const SKIP = "  if exists (select 1 from public.card_progress_v2 where player_id = i.player_id and card_id = i.card_id) then\n    return jsonb_build_object('row', false, 'skipped', true); end if;\n  insert into public.card_progress_v2 (player_id, card_id) values (i.player_id, i.card_id) returning id into pid;\n";
const FIXDEL = '    if pid is not null then delete from public.card_progress_v2 where id = pid; end if;\n';
const LEDGER_LOOP = "    if lid is null then continue; end if;\n";
const INPUT_FILTER = '       and not exists (select 1 from public.combat_v2_convert_input x where x.player_id = pc.player_id and x.card_id = pc.card_id)\n';
const MUT = {
  // CV1
  round_down: ["when 'up' then ceil(x)", "when 'up' then floor(x)"],
  level_rule_a: ['  over := greatest(0, spent - lv * ppl);\n', '  lv := greatest(lv, least(mx, spent));\n  over := greatest(0, spent - lv * ppl);\n'],
  // CV9 (the ratios from balance)
  ratio_literal: ["    x := n * (cv->'ratios'->>k)::numeric;\n", "    x := n * case k when 'attack' then 1 when 'vitality' then 1 when 'precision' then 1.25 when 'potency' then 2.4 else 3.33 end;\n"],
  // CV2
  excess_dropped: ["      refund := refund || jsonb_build_object(s, (conv->>s)::int + coalesce((top->>s)::int, 0) - (stored->>s)::int);\n", '      null;\n'],
  // CV3
  topup_missing: ['    if t > (stored->>s)::int then top := top', '    if false then top := top'],
  // CV4
  row_missing: ["  if not (e->>'row')::boolean then return jsonb_build_object('row', false); end if;\n", "  if not (e->>'row')::boolean or i.id = (select min(z.id) from public.combat_v2_convert_input z where z.ref = i.ref) then return jsonb_build_object('row', false); end if;\n"],
  delta_mismatch: ['bonus_points = bonus_points + (l->>\'d_bonus\')::int\n', 'bonus_points = bonus_points + (l->>\'d_bonus\')::int + 1\n'],
  input_missing_row: [INPUT_FILTER, INPUT_FILTER + "       and pc.player_id <> (select min(z.player_id) from public.player_cards z where z.stat_points <> '{}'::jsonb)\n"],
  stars_only_row: ["     where pc.stat_points is not null and pc.stat_points <> '{}'::jsonb\n", '     where (pc.stat_points is not null and pc.stat_points <> \'{}\'::jsonb) or pc.ascension > 0\n',
    "  if conv = '{}'::jsonb then return jsonb_build_object('row', false, 'level', lv, 'xp', card_level_xp_at(lv, b)); end if;\n", ''],
  // CV5
  progress_before_ledger: [LEDGER_LOOP, ''],
  no_unique_ref: [INPUT_FILTER, '       and not exists (select 1 from public.combat_v2_convert_input x where x.player_id = pc.player_id and x.card_id = pc.card_id and x.ref = p_ref)\n'],
  rerun_after_undo_converts: [INPUT_FILTER, '       and not exists (select 1 from public.card_progress_v2 x where x.player_id = pc.player_id and x.card_id = pc.card_id)\n'],
  // CV6
  v1_points_cleared: ["  return jsonb_build_object('row', true, 'progress_id', pid, 'ledger', n);\n", "  update public.player_cards set stat_points = '{}'::jsonb where player_id = i.player_id and card_id = i.card_id;\n  return jsonb_build_object('row', true, 'progress_id', pid, 'ledger', n);\n"],
  // CV7
  undo_all: ['       and not exists (select 1 from public.card_progress_v2_log l where l.progress_id = p.id and l.ref <> p_ref)\n', ''],
  fix_adds_on_top: [FIXDEL, ''],
  fix_changes_spent_row: ["    if pid is not null and exists (select 1 from public.card_progress_v2_log where progress_id = pid and reason in ('spend', 'reset', 'xp')) then\n      n_spent := n_spent + 1; continue; end if;\n", ''],
  // CV8 (phase 2)
  no_late_spend_check: ["    if r.cur is not null and coalesce(r.live, '{}'::jsonb) is distinct from r.cur->'stat_points' then why := why || 'live_differs'::text; n_live := n_live + 1; end if;\n", ''],
  m1b_adds_on_top: [SKIP, "  select id into pid from public.card_progress_v2 where player_id = i.player_id and card_id = i.card_id;\n  if pid is null then insert into public.card_progress_v2 (player_id, card_id) values (i.player_id, i.card_id) returning id into pid; end if;\n", FIXDEL, ''],
  // CV11
  asc_no_level: ["  return jsonb_build_object('level', greatest(lv, r.level), 'bonus', r.bonus_points,", "  return jsonb_build_object('level', r.level, 'bonus', r.bonus_points,"],
  level_literal: ["(b->'v2_convert'->>'level_per_star')::int * coalesce(v_stars, 0)", '3 * coalesce(v_stars, 0)'],
  // CV12
  shop_reset_open: [PAUSE, ''],
  shop_charge_before_refuse: [PAUSE, '', CHARGE, CHARGE + "      return jsonb_build_object('ok', false, 'error', 'stat_reset_paused', 'message', 'Stat reset returns with the v2 stats screen.');   -- M1e\n"],
  refuse_when_off: ["  if p_kind = 'stat_reset' and combat_v2_on('progress', p_player) then   -- M1e\n", "  if p_kind = 'stat_reset' then   -- M1e\n"],
  today_not_paused: ["    'stat_reset_paused', v_v2,", "    'stat_reset_paused', false,"],
  // SW (the switch file)
  switch_log_first: ["  r := combat_v2_convert('m1');\n  raise notice 'combat_v2_switch_on: %', r;\n  insert into public.combat_v2_switch_log (action, at) values ('on', clock_timestamp());\n",
    "  insert into public.combat_v2_switch_log (action, at) values ('on', now());\n  r := combat_v2_convert('m1');\n  raise notice 'combat_v2_switch_on: %', r;\n"],
  convert_before_flags: ["  update public.balance set value = value || '{\"gauntlet\": true, \"dungeon\": true, \"hunt\": true, \"progress\": true}'::jsonb where key = 'combat_v2';\n", ''],
  // CV9 (C1 on the file): a literal 3 in a fight function
  c1_literal: ["  lps int := (cv->>'level_per_star')::int;\n", '  lps int := 3;\n'],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  console.log(`baseline (no mutation)             ${base.status === 0 && /^PASS/.test(bl) ? 'PASS' : 'FAIL'}  ${bl.slice(0, 160)}`);
  if (base.status !== 0) { ok = false; console.log((base.stdout || '') + (base.stderr || '')); }
  for (const name of Object.keys(MUT)) {
    const r = runOne(name);
    const out = (r.stdout || '').trim().split(/\r?\n/);
    const line = out.pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    const first = out.find((l) => l.startsWith('FAIL')) || (r.stderr || '').split('\n').find((l) => /rror/.test(l)) || '';
    console.log(`mutation ${name.padEnd(27)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 40)}  ${first.slice(0, 140)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  for (let i = 0; i < m.length; i += 2) {
    const inSw = ['switch_log_first', 'convert_before_flags'].includes(process.env.MUTATE);
    const src = inSw ? swOn : mig;
    if (src.split(m[i]).length !== 2) throw new Error(`the mutation ${process.env.MUTATE} (part ${i / 2 + 1}) does not match exactly once`);
    if (inSw) swOn = swOn.split(m[i]).join(m[i + 1]); else mig = mig.split(m[i]).join(m[i + 1]);
  }
}
for (const x of ['$t$', '$q$', '$s$', '$swf$', '$swo$']) if (mig.includes(x) || swOn.includes(x) || swOff.includes(x)) throw new Error(`the SQL must not contain ${x}`);

const fails = [];
const results = [];
const note = (c, ok, detail) => { results.push({ case: c, ok, detail }); if (!ok) fails.push(c); };

// ---------------------------------------------------------------- CV9 part 2: the C1 check of CI on the functions of this file
{
  const { check } = await import(pathToFileURL(`${ROOT}ci/combat/c1-numbers.mjs`).href);
  const cfg = JSON.parse(readFileSync(`${ROOT}ci/combat/c1-numbers.json`, 'utf8'));
  const fns = [...mig.matchAll(/create or replace function public\.([a-z0-9_]+)\([\s\S]*?\nend \$fn\$;\n/g)].map((m) => ({ name: m[1], body: m[0], where: 'combat_v2_convert.sql' }));
  const r = check([], fns, cfg);
  const mine = r.problems.filter((p) => fns.some((f) => p.includes(f.name)));
  note('CV9 C1 (ci/combat/c1-numbers.mjs check) on the ' + fns.length + ' functions of the file: no combat number outside balance', mine.length === 0 && fns.length >= 7, mine.slice(0, 3));
}

const P = '999999999999999971', Q = '999999999999999972', N = '999999999999999974', W = '999999999999999975', R = '999999999999999973';
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const OLD_TODAY = (mig.match(/CREATE OR REPLACE FUNCTION public\.shop_today[\s\S]*?^end \$function\$;\n/m) || [])[0].replace(/^.*-- M1e\b.*\n/gm, '');

const block = String.raw`
do $t$
declare res jsonb := '[]'; r jsonb; r2 jsonb; e jsonb; ok boolean; n int; n2 int; k text; x jsonb; y jsonb; pid bigint; pid2 bigint;
  md5_pts_a text; md5_pts_b text; md5_cc_a text; md5_cc_b text; c_in int; c_pr int; c_led int; c_in2 int; c_pr2 int; c_led2 int; v1cp numeric; t int;
  snap_a jsonb; snap_b jsonb; v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW'); v_price int; flag0 jsonb; at_on timestamptz;
begin
  select value into flag0 from public.balance where key = 'combat_v2';
  insert into public.players (id, username) values ('${P}', 'm1e test p'), ('${Q}', 'm1e test q'), ('${N}', 'm1e test n'), ('${W}', 'm1e test w');
  insert into public.player_cards (player_id, card_id, quantity, ascension, stat_points) values
    ('${P}', 293, 1, 3, '{"attack": 3, "vitality": 5, "precision": 1}'), ('${P}', 317, 1, 4, '{"potency": 12}'),
    ('${P}', 107, 1, 3, '{"haste": 9}'), ('${P}', 209, 1, 2, '{"haste": 1, "attack": 1, "potency": 1, "vitality": 2, "precision": 1}'),
    ('${Q}', 317, 1, 5, '{"potency": 15}'), ('${Q}', 293, 1, 2, '{}'), ('${Q}', 107, 1, 5, '{}');

  -- ===== FLAG OFF (progress off on this copy; the planted players are not testers)
  begin perform combat_v2_convert('m1'); ok := false; exception when raise_exception then ok := sqlerrm like '%progress is off%'; end;
  res := res || jsonb_build_object('case', 'OFF combat_v2_convert refuses while combat_v2.progress is off (rule 0)', 'ok', ok);
  -- CV12 OFF: the steps of test-shards-shop.mjs 117-129 on the NEW buy_shop_item; shop_today = the old answer + stat_reset_paused false
  begin
    insert into public.player_cards (player_id, card_id, quantity, ascension, stat_points) values ('${N}', 293, 1, 1, '{"attack": 3}');
    update public.players set stat_reset_week = null where id = '${N}';
    perform grant_shards('${N}', 200, 'admin', 'test', 'm1e test');
    v_price := game_shop_price((shard_cfg()->>'stat_reset_price')::int);
    r := buy_shop_item('${N}', 'stat_reset', null, 293);
    ok := (r->>'ok')::boolean and (r->>'free')::boolean and (r->>'balance')::int = 200
      and (select stat_points from public.player_cards where player_id = '${N}' and card_id = 293) = '{}'::jsonb
      and (select stat_reset_week from public.players where id = '${N}') = v_week;
    update public.player_cards set stat_points = '{"vitality": 3}' where player_id = '${N}' and card_id = 293;
    r2 := buy_shop_item('${N}', 'stat_reset', null, 293);
    ok := ok and (r2->>'ok')::boolean and not (r2->>'free')::boolean and (r2->>'balance')::int = 200 - v_price
      and (buy_shop_item('${N}', 'stat_reset', null, 293)->>'error') = 'nothing_spent';
    x := shop_today('${N}');
    execute $q$${OLD_TODAY}$q$;
    y := shop_today('${N}');
    ok := ok and x->'stat_reset_paused' = 'false'::jsonb and (x - 'stat_reset_paused') = y;
    raise exception 'SCN:%', jsonb_build_object('ok', ok, 'r', r, 'r2', r2, 'paused', x->'stat_reset_paused');
  exception when raise_exception then
    if sqlerrm not like 'SCN:%' then raise; end if;
    r := substr(sqlerrm, 5)::jsonb;
    res := res || jsonb_build_object('case', 'CV12 OFF the v1 Shop reset (free week, paid, nothing_spent) works on the new buy_shop_item; shop_today = the old answer + stat_reset_paused false', 'ok', (r->>'ok')::boolean, 'detail', r);
  end;

  -- ===== CV6 before
  select md5(string_agg(player_id || ':' || card_id || ':' || stat_points::text, ',' order by player_id, card_id)) into md5_pts_a from public.player_cards;
  select md5(string_agg(card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)::text, ',' order by pc.player_id, pc.card_id)) into md5_cc_a
    from public.player_cards pc join public.cards c on c.id = pc.card_id left join public.subjects s on s.id = c.subject_id where pc.stat_points <> '{}'::jsonb;
  create temp table m1e_pts on commit drop as select player_id, card_id, ascension, stat_points from public.player_cards where stat_points <> '{}'::jsonb;

  -- ===== SW: the REAL switch file
  execute $swf$${swOn}$swf$;
  select value into x from public.balance where key = 'combat_v2';
  select at into at_on from public.combat_v2_switch_log where action = 'on' order by id desc limit 1;
  ok := x->'gauntlet' = 'true' and x->'dungeon' = 'true' and x->'hunt' = 'true' and x->'progress' = 'true' and x->'testers' = flag0->'testers'
    and at_on is not null and at_on >= (select max(changed_at) from public.balance_log where key = 'combat_v2')
    and at_on >= (select max(at) from public.combat_v2_convert_input);
  res := res || jsonb_build_object('case', 'SW switch on: the 4 flags true, testers kept, one switch_log on row written LAST (at >= every input row and >= the balance_log row)', 'ok', ok, 'flag', x, 'at', at_on);

  -- ===== CV1 the 4 examples of 3.7 (option B)
  ok := true; x := '[]';
  for r in select to_jsonb(p) || jsonb_build_object('free', p.level + p.bonus_points - (p.atk_pts + p.def_pts + p.hp_pts + p.crd_pts + p.crt_pts + p.abl_pts + p.ddg_pts + p.acc_pts + p.spd_pts)) as j
             from public.card_progress_v2 p where p.player_id = '${P}' order by p.card_id loop
    x := x || jsonb_build_array(jsonb_build_array(r->'card_id', r->'level', r->'xp', r->'bonus_points', r->'free', r->'atk_pts', r->'hp_pts', r->'crt_pts', r->'abl_pts', r->'spd_pts'));
  end loop;
  y := '[[107, 9, 81, 21, 20, 0, 0, 0, 0, 10], [209, 6, 45, 6, 0, 1, 2, 2, 3, 4], [293, 9, 81, 1, 0, 3, 5, 2, 0, 0], [317, 12, 126, 19, 21, 0, 0, 0, 10, 0]]';
  res := res || jsonb_build_object('case', 'CV1 the 4 examples (card, level, xp, bonus, free, atk, hp, crt, abl, spd) = the option B table of 3.7', 'ok', x = y, 'got', x);
  -- the dead points of 209 (an attacker: Support and Recharge) and the reasons of each example
  select jsonb_agg(jsonb_build_array(l.card_id, l.reason, l.stat, l.d_level, l.d_xp, l.d_points, l.d_bonus) order by l.card_id, l.id) into x
    from public.card_progress_v2_log l where l.player_id = '${P}';
  ok := x @> '[[209, "dead_points", "abl", 0, 0, 3, 0], [209, "dead_points", "spd", 0, 0, 4, 0], [209, "convert", "atk", 0, 0, 1, 0], [209, "refund", "", 0, 0, 0, 6],
               [107, "convert", "spd", 0, 0, 10, 0], [107, "refund", "spd", 0, 0, 0, 20], [107, "refund", "", 0, 0, 0, 1], [317, "refund", "abl", 0, 0, 0, 19],
               [293, "grant_level", "", 9, 81, 0, 0]]'::jsonb
    and not x @> '[[317, "dead_points", "abl", 0, 0, 10, 0]]'::jsonb and jsonb_array_length(x) = 19;
  res := res || jsonb_build_object('case', 'CV1 the ledger rows of the 4 examples (19 rows: grant_level, refund by stat and by level, convert, dead_points on the attacker 209 only)', 'ok', ok, 'got', x);

  -- ===== CV2 cap and bonus: potency 15 on a 5-star support
  select jsonb_build_array(level, abl_pts, bonus_points) into x from public.card_progress_v2 where player_id = '${Q}' and card_id = 317;
  res := res || jsonb_build_object('case', 'CV2 potency 15 on a 5-star support: level 15, ABL 10, bonus 36 - 10 = 26 (no level overflow)', 'ok', x = '[15, 10, 26]', 'got', x);

  -- ===== CV3 top-up: a v1 attack value (stat_points.attack x 3.33 in this sub-block) that x1 ATK does not reach
  begin
    update public.balance set value = jsonb_set(value, '{attack}', to_jsonb(((value->>'attack')::numeric * 3.33)::numeric(6, 4))) where key = 'stat_points';
    e := combat_v2_convert_expect(293, 3, '{"attack": 3}');
    v1cp := (card_combat('normal', 3, (select s.cp_mod from cards c join subjects s on s.id = c.subject_id where c.id = 293), '{"attack": 3}')->>'cp')::numeric;
    -- the smallest count n >= 3 whose card_combat_v2 atk at level 9 reaches v1cp (computed here, independent of the file)
    t := 3;
    while t < 10 and (card_combat_v2('normal', 3, (select s.cp_mod from cards c join subjects s on s.id = c.subject_id where c.id = 293), 9, jsonb_build_object('atk', t), 'survivor',
                      combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']), t)->'stats'->>'atk')::numeric < v1cp loop t := t + 1; end loop;
    ok := t > 3 and (e->'points'->>'atk')::int = t and e->'ledger' @> jsonb_build_array(jsonb_build_object('reason', 'topup', 'stat', 'atk', 'd_points', t - 3))
      and e->'ledger' @> '[{"reason": "convert", "stat": "atk", "d_points": 3}]';
    raise exception 'SCN:%', jsonb_build_object('ok', ok, 'want', t, 'v1cp', v1cp, 'e', e - 'ledger', 'ledger', e->'ledger');
  exception when raise_exception then
    if sqlerrm not like 'SCN:%' then raise; end if;
    r := substr(sqlerrm, 5)::jsonb;
    res := res || jsonb_build_object('case', 'CV3 top-up: x1 ATK below the v1 value: a topup row with the smallest count that reaches it (independent loop)', 'ok', (r->>'ok')::boolean, 'detail', r);
  end;

  -- ===== CV4 every real row (the copy is fresh from live)
  select count(*) into n from ((select player_id, card_id, ascension, stat_points from m1e_pts except select player_id, card_id, stars, stat_points from public.combat_v2_convert_input where ref = 'm1')
    union all (select player_id, card_id, stars, stat_points from public.combat_v2_convert_input where ref = 'm1' except select player_id, card_id, ascension, stat_points from m1e_pts)) d;
  select count(*) into n2 from m1e_pts;
  res := res || jsonb_build_object('case', 'CV4 the m1 input rows = every player_cards row with v1 points at the switch (both ways, with stars and points)', 'ok', n = 0 and n2 > 0, 'diff', n, 'rows', n2);
  select count(*) filter (where not ok1), count(*) filter (where not ok2), count(*) into n, n2, t from (
    select p.id, e2->>'row' = 'true' and p.level = (e2->>'level')::int and p.xp = (e2->>'xp')::int and p.bonus_points = (e2->>'bonus')::int
             and p.atk_pts = (e2->'points'->>'atk')::int and p.def_pts = (e2->'points'->>'def')::int and p.hp_pts = (e2->'points'->>'hp')::int
             and p.crd_pts = (e2->'points'->>'crd')::int and p.crt_pts = (e2->'points'->>'crt')::int and p.abl_pts = (e2->'points'->>'abl')::int
             and p.ddg_pts = (e2->'points'->>'ddg')::int and p.acc_pts = (e2->'points'->>'acc')::int and p.spd_pts = (e2->'points'->>'spd')::int as ok1,
           (select sum(d_level) = p.level and sum(d_xp) = p.xp and sum(d_bonus) = p.bonus_points
                   and sum(d_points) = p.atk_pts + p.def_pts + p.hp_pts + p.crd_pts + p.crt_pts + p.abl_pts + p.ddg_pts + p.acc_pts + p.spd_pts
                   and count(*) = jsonb_array_length(e2->'ledger') and bool_and(l.ref = 'm1')
              from public.card_progress_v2_log l where l.progress_id = p.id) as ok2
      from public.card_progress_v2 p
      cross join lateral (select combat_v2_convert_expect(i.card_id, i.stars, i.stat_points) e2 from public.combat_v2_convert_input i
                           where i.player_id = p.player_id and i.card_id = p.card_id order by i.at desc, i.id desc limit 1) z) q;
  select count(*) into c_in from public.combat_v2_convert_input i where (combat_v2_convert_expect(i.card_id, i.stars, i.stat_points)->>'row')::boolean;
  res := res || jsonb_build_object('case', 'CV4 every PROGRESS row = combat_v2_convert_expect(its current input row) column by column, its ledger rows sum to it (T6), and one row per input row with points',
    'ok', n = 0 and n2 = 0 and t = c_in and t > 0 and t = (select count(*) from public.card_progress_v2), 'rows', t, 'bad', n, 'bad_ledger', n2, 'want_rows', c_in);
  select count(*) into n from public.card_progress_v2 p where not exists (select 1 from m1e_pts m where m.player_id = p.player_id and m.card_id = p.card_id);
  res := res || jsonb_build_object('case', 'CV4 no progress row for a card with stars and no v1 points (Q 293, Q 107 and every real stars-only card)', 'ok', n = 0
    and not exists (select 1 from public.card_progress_v2 where player_id = '${Q}' and card_id in (293, 107)), 'rows', n);
  r := combat_v2_convert_check();
  res := res || jsonb_build_object('case', 'CV4 combat_v2_convert_check() (6.7 rows 2a and 2b) finds nothing after the switch', 'ok', (r->>'ok')::boolean, 'detail', r - 'items');

  -- ===== CV6 v1 untouched
  select md5(string_agg(player_id || ':' || card_id || ':' || stat_points::text, ',' order by player_id, card_id)) into md5_pts_b from public.player_cards;
  select md5(string_agg(card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)::text, ',' order by pc.player_id, pc.card_id)) into md5_cc_b
    from public.player_cards pc join public.cards c on c.id = pc.card_id left join public.subjects s on s.id = c.subject_id where pc.stat_points <> '{}'::jsonb;
  res := res || jsonb_build_object('case', 'CV6 the md5 of every player_cards.stat_points and of every v1 card_combat answer is the same before and after the switch', 'ok', md5_pts_a = md5_pts_b and md5_cc_a = md5_cc_b);

  -- ===== CV5 double apply, any ref, and fix twice
  select count(*) into c_in from public.combat_v2_convert_input; select count(*) into c_pr from public.card_progress_v2; select count(*) into c_led from public.card_progress_v2_log;
  r := combat_v2_convert('m1'); r2 := combat_v2_convert('m1c');
  select count(*) into c_in2 from public.combat_v2_convert_input; select count(*) into c_pr2 from public.card_progress_v2; select count(*) into c_led2 from public.card_progress_v2_log;
  res := res || jsonb_build_object('case', 'CV5 a second combat_v2_convert(m1), and one with another ref (m1c), add 0 input, progress and ledger rows', 'ok',
    c_in = c_in2 and c_pr = c_pr2 and c_led = c_led2 and (r->>'input_rows')::int = 0 and (r2->>'input_rows')::int = 0, 'r', r, 'r2', r2);
  r := combat_v2_convert_fix();
  select count(*) into c_in2 from public.combat_v2_convert_input; select count(*) into c_pr2 from public.card_progress_v2; select count(*) into c_led2 from public.card_progress_v2_log;
  res := res || jsonb_build_object('case', 'CV5 combat_v2_convert_fix() right after the switch changes nothing (0 rows)', 'ok', (r->>'fixed')::int = 0 and c_in = c_in2 and c_pr = c_pr2 and c_led = c_led2, 'r', r);
  -- undo one card, then convert again: that card has an input row, so it is NOT converted again
  r := combat_v2_convert_undo('m1', array[293::bigint]);
  select count(*) into n from public.card_progress_v2 where card_id = 293;
  r2 := combat_v2_convert('m1');
  select count(*) into n2 from public.card_progress_v2 where card_id = 293;
  res := res || jsonb_build_object('case', 'CV5 after combat_v2_convert_undo(m1, {293}) a second combat_v2_convert(m1) does not convert card 293 again', 'ok',
    (r->>'deleted')::int > 0 and n = 0 and n2 = 0 and (r2->>'input_rows')::int = 0, 'undo', r, 'r2', r2);
  r := combat_v2_convert_fix(array[293::bigint]);
  r2 := combat_v2_convert_fix(array[293::bigint]);
  select count(*) into n from public.card_progress_v2 where card_id = 293;
  select count(*) into c_led from public.card_progress_v2_log; r2 := r2 || jsonb_build_object('ledger_after', c_led);
  r2 := r2 || jsonb_build_object('second', combat_v2_convert_fix(array[293::bigint]));
  select count(*) into c_led2 from public.card_progress_v2_log;
  res := res || jsonb_build_object('case', 'CV5 the fix of the undone card 293 converts it once (m1b); a second and a third fix call add 0 rows', 'ok',
    (r->>'fixed')::int = (r->>'fixed')::int and (r->>'fixed')::int > 0 and n = (r->>'fixed')::int and (r2->>'fixed')::int = 0 and (r2->'second'->>'fixed')::int = 0 and c_led = c_led2
    and not exists (select 1 from public.card_progress_v2 p where p.card_id = 293 and exists (select 1 from public.card_progress_v2_log l where l.progress_id = p.id and l.ref <> 'm1b')), 'r', r, 'r2', r2);
  -- a failed ledger insert (a planted trigger that drops every refund row) leaves no progress change for that step
  begin
    insert into public.player_cards (player_id, card_id, quantity, ascension, stat_points) values ('${W}', 317, 1, 4, '{"potency": 12}');
    insert into public.combat_v2_convert_input (ref, player_id, card_id, stars, stat_points) values ('m1t', '${W}', 317, 4, '{"potency": 12}') returning id into pid;
    create function pg_temp.m1e_drop_refund() returns trigger language plpgsql as $q$ begin if new.reason = 'refund' then return null; end if; return new; end $q$;
    create trigger m1e_drop_refund before insert on public.card_progress_v2_log for each row execute function pg_temp.m1e_drop_refund();
    r := combat_v2_convert_write(pid);
    select to_jsonb(p) into x from public.card_progress_v2 p where player_id = '${W}' and card_id = 317;
    select jsonb_build_object('n', count(*), 'bonus', coalesce(sum(d_bonus), 0), 'pts', coalesce(sum(d_points), 0), 'lv', coalesce(sum(d_level), 0)) into y
      from public.card_progress_v2_log where player_id = '${W}';
    ok := (x->>'bonus_points')::int = 0 and (y->>'bonus')::int = 0 and (x->>'abl_pts')::int = 10 and (y->>'pts')::int = 10 and (x->>'level')::int = 12 and (y->>'n')::int = 2;
    raise exception 'SCN:%', jsonb_build_object('ok', ok, 'row', x, 'ledger', y);
  exception when raise_exception then
    if sqlerrm not like 'SCN:%' then raise; end if;
    r := substr(sqlerrm, 5)::jsonb;
    res := res || jsonb_build_object('case', 'CV5 a ledger insert that adds no row (refund dropped) leaves the progress row without that step (bonus 0 = the ledger sum)', 'ok', (r->>'ok')::boolean, 'detail', r);
  end;

  -- ===== CV11 the live level (N-7b): a converted 2-star card and a 2-star card with no progress row
  x := jsonb_build_array(card_progress_v2_fight('${P}', 209)->'level', card_progress_v2_fight('${Q}', 293)->'level');
  update public.player_cards set ascension = ascension + 1 where (player_id, card_id) in (('${P}', 209::bigint), ('${Q}', 293::bigint));
  y := jsonb_build_array(card_progress_v2_fight('${P}', 209)->'level', card_progress_v2_fight('${Q}', 293)->'level');
  r := card_progress_v2_fight('${P}', 209);
  r2 := card_combat_v2('normal', 3, (select s.cp_mod from cards c join subjects s on s.id = c.subject_id where c.id = 209), (r->>'level')::int, r->'points', 'striker',
    combat_v2_numbers(array['v2_asc', 'v2_level', 'v2_stats', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']), (r->>'bonus')::int);
  insert into public.card_progress_v2 (player_id, card_id, level, xp) values ('${Q}', 107, 30, card_level_xp_at(30));
  ok := x = '[6, 6]' and y = '[9, 9]' and (r2->>'level')::int = 9 and (r2->>'points_free')::int = 3 and r->'points'->'spd' = '4'
    and (card_progress_v2_fight('${Q}', 107)->>'level')::int = 30 and (select level from public.card_progress_v2 where player_id = '${P}' and card_id = 209) = 6;
  res := res || jsonb_build_object('case', 'CV11 level = 3 x the CURRENT stars for a converted card and a card with no row (6, 6 -> 9, 9 after a star; the stored row stays 6; card_combat_v2 accepts it, 3 free); a level 30 row stays 30',
    'ok', ok, 'before', x, 'after', y, 'unit', r2->'points_free');
  begin
    update public.balance set value = value || '{"progress": false}' where key = 'combat_v2';
    x := card_progress_v2_fight('${P}', 209);
    update public.balance set value = value || '{"progress": true}' where key = 'combat_v2';
    update public.balance set value = jsonb_set(value, '{level_per_star}', '2') where key = 'v2_convert';
    y := card_progress_v2_fight('${Q}', 293);
    raise exception 'SCN:%', jsonb_build_object('ok', x = '{"level": 0, "points": {}, "bonus": 0}' and (y->>'level')::int = 6, 'off', x, 'lps2', y);
  exception when raise_exception then
    if sqlerrm not like 'SCN:%' then raise; end if;
    r := substr(sqlerrm, 5)::jsonb;
    res := res || jsonb_build_object('case', 'CV11 progress OFF: level 0, no points; v2_convert.level_per_star 2: a 3-star card fights at level 6 (the number from balance)', 'ok', (r->>'ok')::boolean, 'detail', r);
  end;

  -- ===== CV9 the ratios, the rounding and the level from balance v2_convert
  begin
    x := combat_v2_convert_expect(317, 4, '{"potency": 4}');
    update public.balance set value = jsonb_set(value, '{round}', '"down"') where key = 'v2_convert';
    y := combat_v2_convert_expect(317, 4, '{"potency": 4}');
    update public.balance set value = jsonb_set(jsonb_set(value, '{round}', '"up"'), '{ratios,potency}', '2.0') where key = 'v2_convert';
    r := combat_v2_convert_expect(317, 4, '{"potency": 4}');
    update public.balance set value = jsonb_set(value, '{level_per_star}', '2') where key = 'v2_convert';
    r2 := combat_v2_convert_expect(317, 4, '{"potency": 4}');
    raise exception 'SCN:%', jsonb_build_object('ok', x->'points'->'abl' = '10' and y->'points'->'abl' = '9' and r->'points'->'abl' = '8' and r2->'level' = '8' and r2->'xp' = to_jsonb(card_level_xp_at(8)),
      'up', x->'points'->'abl', 'down', y->'points'->'abl', 'ratio2', r->'points'->'abl', 'lps2', r2->'level');
  exception when raise_exception then
    if sqlerrm not like 'SCN:%' then raise; end if;
    r := substr(sqlerrm, 5)::jsonb;
    res := res || jsonb_build_object('case', 'CV9 potency 4 on a 4-star support: ABL 10 (x2.4 up), 9 (round down), 8 (ratio 2.0); level_per_star 2 gives level 8: every number from v2_convert', 'ok', (r->>'ok')::boolean, 'detail', r);
  end;

  -- ===== CV12 progress ON: the Shop stat reset is paused (free week, a v2 gift, Shards) and changes nothing
  ok := true; x := '[]';
  for k in select unnest(array['week', 'gift', 'shards']) loop
    update public.players set stat_reset_week = case when k = 'week' then null else v_week end where id = '${P}';
    delete from public.stat_reset_gifts where player_id = '${P}';
    if k = 'gift' then insert into public.stat_reset_gifts (player_id, gift, expires_at) values ('${P}', 'v2_m1e_test', now() + interval '1 day'); end if;
    if k = 'shards' then perform grant_shards('${P}', 10000, 'admin', 'test', 'm1e test'); end if;
    select jsonb_build_object('pr', (select to_jsonb(p) from public.card_progress_v2 p where player_id = '${P}' and card_id = 317),
      'led', (select count(*) from public.card_progress_v2_log where player_id = '${P}'), 'sp', (select count(*) from public.shop_purchases where player_id = '${P}'),
      'sl', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]') from public.shard_ledger s where player_id = '${P}'),
      'pl', (select jsonb_build_array(shard_balance, stat_reset_week) from public.players where id = '${P}'),
      'g', (select coalesce(jsonb_agg(to_jsonb(g) order by g.gift), '[]') from public.stat_reset_gifts g where player_id = '${P}'),
      'v1', (select stat_points from public.player_cards where player_id = '${P}' and card_id = 317)) into snap_a;
    r := buy_shop_item('${P}', 'stat_reset', null, 317);
    select jsonb_build_object('pr', (select to_jsonb(p) from public.card_progress_v2 p where player_id = '${P}' and card_id = 317),
      'led', (select count(*) from public.card_progress_v2_log where player_id = '${P}'), 'sp', (select count(*) from public.shop_purchases where player_id = '${P}'),
      'sl', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]') from public.shard_ledger s where player_id = '${P}'),
      'pl', (select jsonb_build_array(shard_balance, stat_reset_week) from public.players where id = '${P}'),
      'g', (select coalesce(jsonb_agg(to_jsonb(g) order by g.gift), '[]') from public.stat_reset_gifts g where player_id = '${P}'),
      'v1', (select stat_points from public.player_cards where player_id = '${P}' and card_id = 317)) into snap_b;
    ok := ok and r = '{"ok": false, "error": "stat_reset_paused", "message": "Stat reset returns with the v2 stats screen."}'::jsonb and snap_a = snap_b and snap_a->'pr' is not null;
    x := x || jsonb_build_object(k, r->'error', 'same', snap_a = snap_b);
  end loop;
  ok := ok and shop_today('${P}')->'stat_reset_paused' = 'true'::jsonb;
  res := res || jsonb_build_object('case', 'CV12 progress ON: buy_shop_item(stat_reset) with a free week, a v2 gift and Shards answers stat_reset_paused with the line; progress row, ledger, purchases, Shards, week and gifts byte-identical; shop_today stat_reset_paused true',
    'ok', ok, 'got', x);

  -- ===== CV7 a fix on a card with a row (no undo first): the row is replaced by ONE clean conversion of the new input; a second need is reported
  select id into pid from public.card_progress_v2 where player_id = '${P}' and card_id = 107;
  update public.player_cards set stat_points = '{"haste": 6}' where player_id = '${P}' and card_id = 107;
  r := combat_v2_convert_fix(array[107::bigint]);
  select to_jsonb(p) into x from public.card_progress_v2 p where player_id = '${P}' and card_id = 107;
  e := combat_v2_convert_expect(107, 3, '{"haste": 6}');
  ok := (x->>'id')::bigint <> pid and (x->>'spd_pts')::int = (e->'points'->>'spd')::int and (x->>'bonus_points')::int = (e->>'bonus')::int and (x->>'level')::int = (e->>'level')::int
    and (x->>'xp')::int = (e->>'xp')::int and (e->>'bonus')::int = 11
    and (select count(*) = jsonb_array_length(e->'ledger') and bool_and(ref = 'm1b') from public.card_progress_v2_log where progress_id = (x->>'id')::bigint)
    and (select stat_points from public.combat_v2_convert_input where ref = 'm1b' and player_id = '${P}' and card_id = 107) = '{"haste": 6}';
  update public.player_cards set stat_points = '{"haste": 5}' where player_id = '${P}' and card_id = 107;
  r2 := combat_v2_convert_fix(array[107::bigint]);
  select to_jsonb(p) into y from public.card_progress_v2 p where player_id = '${P}' and card_id = 107;
  ok := ok and (r2->>'reported_second_fix')::int >= 1 and x = y;
  res := res || jsonb_build_object('case', 'CV7 a fix of a converted card with new live points: a NEW progress id = combat_v2_convert_expect(the m1b input) with only m1b ledger rows; a second need is reported, not written',
    'ok', ok, 'r', r, 'r2', r2);
  -- a card with a v2 spend row: undo keeps it, the fix reports it and changes nothing
  r := spend_card_points_v2('${P}', 317, '{"atk": 1}');
  select to_jsonb(p) into snap_a from public.card_progress_v2 p where player_id = '${P}' and card_id = 317;
  update public.player_cards set stat_points = '{"potency": 11}' where player_id = '${P}' and card_id = 317;
  r2 := combat_v2_convert_fix(array[317::bigint]);
  select to_jsonb(p) into snap_b from public.card_progress_v2 p where player_id = '${P}' and card_id = 317;
  ok := (r->>'ok')::boolean and (r2->>'reported_spent')::int >= 1 and snap_a = snap_b;
  r := combat_v2_convert_undo('m1');
  select count(*) into n from public.card_progress_v2 p where exists (select 1 from public.card_progress_v2_log l where l.progress_id = p.id and l.ref = 'm1')
     and not exists (select 1 from public.card_progress_v2_log l where l.progress_id = p.id and l.ref <> 'm1');
  ok := ok and n = 0 and (r->>'deleted')::int > 0 and exists (select 1 from public.card_progress_v2 where player_id = '${P}' and card_id = 317)
    and exists (select 1 from public.card_progress_v2 where player_id = '${P}' and card_id = 107) and exists (select 1 from public.card_progress_v2 where player_id = '${Q}' and card_id = 107);
  res := res || jsonb_build_object('case', 'CV7 a row with a spend row: the fix reports it and changes nothing; combat_v2_convert_undo(m1) removes every m1-only row and keeps the spent row, the m1b rows and a row of no ref m1',
    'ok', ok, 'spend', r2, 'undo', r, 'parts', jsonb_build_array(snap_a = snap_b, n, exists (select 1 from public.card_progress_v2 where player_id = '${P}' and card_id = 317), exists (select 1 from public.card_progress_v2 where player_id = '${P}' and card_id = 107), exists (select 1 from public.card_progress_v2 where player_id = '${Q}' and card_id = 107)));
  -- redo: undo + fix with a new input = one clean conversion of the new input
  update public.player_cards set stat_points = '{"attack": 2, "vitality": 2}' where player_id = '${P}' and card_id = 209;
  r := combat_v2_convert_fix(array[209::bigint]);
  select to_jsonb(p) into x from public.card_progress_v2 p where player_id = '${P}' and card_id = 209;
  e := combat_v2_convert_expect(209, 3, '{"attack": 2, "vitality": 2}');
  ok := x is not null and (x->>'level')::int = (e->>'level')::int and (x->>'xp')::int = (e->>'xp')::int and (x->>'bonus_points')::int = (e->>'bonus')::int
    and (x->>'atk_pts')::int = (e->'points'->>'atk')::int and (x->>'hp_pts')::int = (e->'points'->>'hp')::int and (x->>'level')::int = 9
    and (select count(*) = jsonb_array_length(e->'ledger') and bool_and(ref = 'm1b') from public.card_progress_v2_log where progress_id = (x->>'id')::bigint)
    and (combat_v2_convert_check(array[209::bigint])->>'ok')::boolean;
  res := res || jsonb_build_object('case', 'CV7 redo: after the undo, the fix of card 209 with new live points (3 stars now) = ONE clean conversion of the m1b input, column by column; the check is then clean',
    'ok', ok, 'r', r, 'row', x - 'created_at' - 'updated_at');

  -- ===== SW the rollback file: the 3 mode flags false, progress stays true, the switch_log off row; the v1 spend stays frozen
  execute $swo$${swOff}$swo$;
  select value into x from public.balance where key = 'combat_v2';
  ok := x->'gauntlet' = 'false' and x->'dungeon' = 'false' and x->'hunt' = 'false' and x->'progress' = 'true' and x->'testers' = flag0->'testers'
    and (select action from public.combat_v2_switch_log order by id desc limit 1) = 'off'
    and (spend_stat_points('${N}', 293, '{"attack": 1}')->>'error') = 'disabled';
  res := res || jsonb_build_object('case', 'SW switch off: gauntlet, dungeon, hunt false, progress true, testers kept, an off row last; the v1 spend still refuses', 'ok', ok, 'flag', x);

  raise exception 'RESULT:%', res;
end $t$;`;

// a raised error in the block (a refused row, a trigger) is a FAIL of the gate, with its text
try {
  const out = await runBlock(mig + '\n' + block);
  for (const r of JSON.parse(out)) note(r.case, r.ok === true, r);
} catch (e) {
  note('phase 1 block runs to its end (no raised error)', false, String(e.message).slice(0, 600));
}

// ---------------------------------------------------------------- Phase 2: CV8 late spend on two real connections
{
  const setup = `insert into public.players (id, username) values ('${R}', 'm1e test r') on conflict (id) do nothing;
    insert into public.player_cards (player_id, card_id, quantity, ascension, stat_points) values ('${R}', 209, 1, 2, '{"attack": 1}')
      on conflict (player_id, card_id) do update set ascension = 2, stat_points = '{"attack": 1}';`;
  const cleanup = `delete from public.stat_point_log where player_id = '${R}'; delete from public.player_cards where player_id = '${R}';
    delete from public.shard_ledger where player_id = '${R}'; delete from public.players where id = '${R}';`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const s = JSON.parse(await rawQuery(setup + ' select 1 as ok;'));
    if (!Array.isArray(s)) throw new Error('CV8 setup failed: ' + JSON.stringify(s).slice(0, 300));
    // B: the v1 spend reads the flag (still false), changes the points and holds its transaction open
    const B = rawQuery(`do $b$ declare r jsonb; begin r := spend_stat_points('${R}', 209, '{"attack": 1}');
      if not (r->>'ok')::boolean then raise exception 'B spend refused: %', r; end if; perform pg_sleep(2.5); end $b$; select 1 as ok;`);
    await sleep(600);
    // A: the file, then the REAL switch file (it reads the points while B is open), then waits for B's commit, then the 6.7 check and the fix
    const A = runBlock(mig + `\n${swOn}\n` + String.raw`
do $t$
declare r jsonb; c jsonb; f jsonb; x jsonb; e jsonb; inp jsonb; ok boolean;
begin
  select stat_points into inp from public.combat_v2_convert_input where ref = 'm1' and player_id = '${R}' and card_id = 209;
  perform pg_sleep(3);
  c := combat_v2_convert_check(array[209::bigint]);
  f := combat_v2_convert_fix(array[209::bigint]);
  select to_jsonb(p) into x from public.card_progress_v2 p where player_id = '${R}' and card_id = 209;
  e := combat_v2_convert_expect(209, 2, (select stat_points from public.player_cards where player_id = '${R}' and card_id = 209));
  ok := inp = '{"attack": 1}' and (select stat_points from public.player_cards where player_id = '${R}' and card_id = 209) = '{"attack": 2}'
    and c->'items' @> jsonb_build_array(jsonb_build_object('player_id', '${R}', 'card_id', 209, 'why', '["live_differs"]'::jsonb))
    and (x->>'atk_pts')::int = (e->'points'->>'atk')::int and (x->>'atk_pts')::int = 2 and (x->>'bonus_points')::int = (e->>'bonus')::int and (x->>'level')::int = (e->>'level')::int
    and (select stat_points from public.combat_v2_convert_input where ref = 'm1b' and player_id = '${R}' and card_id = 209) = '{"attack": 2}'
    and not exists (select 1 from public.card_progress_v2_log where progress_id = (x->>'id')::bigint and ref <> 'm1b')
    and (spend_stat_points('${R}', 209, '{"attack": 1}')->>'error') = 'disabled';
  raise exception 'RESULT:%', jsonb_build_object('ok', ok, 'input', inp, 'check', c - 'items', 'fix', f, 'row', x - 'created_at' - 'updated_at');
end $t$;`);
    const [b, a] = await Promise.all([B, A]);
    const ra = JSON.parse(a);
    note('CV8 late spend: B spends a v1 point while A runs the switch file; the m1 input has the old points; the check finds live_differs; the fix writes m1b = the live points and a new row of m1b rows only; spend_stat_points then refuses',
      ra.ok === true && /"ok"/.test(b), { a: ra, b: String(b).slice(0, 200) });
  } catch (e) {
    note('CV8 phase 2 runs to its end (no raised error)', false, String(e.message).slice(0, 600));
  } finally {
    await rawQuery(cleanup + ' select 1 as ok;');
  }
}

for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r.detail).slice(0, 900)}`);
console.log(fails.length ? `FAILED ${fails.length} of ${results.length}` : `PASS all ${results.length}`);
process.exit(fails.length ? 1 : 0);
