import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/stat_points_r_stars_s1.sql (stat points option R + star curve S1) and
 * tcg-bot/supabase/stat_reset_gift.sql (one extra free stat reset), on the LOCAL copy, NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-stat-points-r-stars-s1.mjs        must PASS (both files are applied twice: idempotent)
 *   MUTATE=<name> ...                                                                                      must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                         runs every mutation, one line each
 *   MD5=1 ...                                                                                              prints the md5 of the three gift functions after the file
 * Invariants:
 *   1. balance stat_points per point = option R (attack 0.06, vitality 0.05, precision 0.05, potency 0.12, haste 0.10); the other keys stay.
 *      One card with 5 points in each stat: CP x1.30, HP x1.25, crit 25%, support x1.60, cooldown x0.50.
 *   2. balance stars = curve S1: a 5-star normal is 75 CP, a 5-star illustrated rare 140 CP (card_power and card_combat). gold, event, full_art and
 *      secret_rare are the same arrays as before; every curve has 6 numbers; the 0-star power of every rarity is the same as before.
 *   3. balance_log records both changes with changed_by = nathan.
 *   4. The gift: one open row for each player (deadline 14 days), a re-run adds no row (not for a new player either) and no points are reset.
 *   5. A player resets for free by the weekly reset and by the gift, in this order (the weekly first), once each; the next reset is refused
 *      (reset_stat_points) or paid (buy_shop_item, the price of the Shop). The gift row says when and for which card. An expired gift, a
 *      refused reset (no points) and a weekly reset never use the gift. shop_today says free_reset / gift_reset / gift_reset_until.
 *   6. The table is private (RLS on, no anon or authenticated privilege).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

const rd = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
let s1 = rd('stat_points_r_stars_s1.sql'), gift = rd('stat_reset_gift.sql');
// M1d (combat_v2_progress_freeze_v1.sql) replaced 4 of the functions that the gift file checks. The state of the day of the gift file is the live text
// of main before M1d: the 4 v1 functions of section 3 of that file minus its lines with the mark "-- M1d". The block puts it back first.
const OLDV1 = (() => {
  const m = rd('combat_v2_progress_freeze_v1.sql'), i = m.indexOf('CREATE OR REPLACE FUNCTION public.spend_stat_points'), j = m.indexOf('-- ============================================================ 4. server only');
  if (i < 0 || j < i) throw new Error('section 3 of combat_v2_progress_freeze_v1.sql not found');
  return m.slice(i, j).split('\n').filter((l) => !l.includes('-- M1d')).join('\n');
})();
const IR = '[1,2.6,3.93,5,6.07,7]';
const MUT = {   // [file, old, new]
  vit_old: ['s1', '"vitality": 0.05', '"vitality": 0.06'],
  pot_old: ['s1', '"potency": 0.12', '"potency": 0.07'],
  ir_old: ['s1all', IR, '[1,2.2,3.2,4,4.8,5.5]'],
  normal_old: ['s1all', '[1,2.86,4.25,5.41,6.57,7.5]', '[1,3,4.5,5.75,7,8]'],
  gold_changed: ['s1all', '"gold":[1,1.15,1.27,1.38,1.49,1.6]', '"gold":[1,1.25,1.45,1.63,1.82,2]'],
  no_by: ['s1', "set_config('balance.by', 'nathan', true)", "set_config('balance.by', 'someone', true)"],
  gift_reuse: ['gift', '     where player_id = p_player and used_at is null and expires_at > now()\n     order by', '     where player_id = p_player and expires_at > now()\n     order by'],
  gift_expired: ['gift', '     where player_id = p_player and used_at is null and expires_at > now()\n     order by', '     where player_id = p_player and used_at is null\n     order by'],
  gift_not_marked: ['gift', 'set used_at = now(), used_card = p_card from g', 'set used_at = used_at, used_card = used_card from g'],
  gift_before_week: ['gift', 'if v_used is distinct from v_week then\n      -- The free weekly', 'if v_used is distinct from v_week and false then\n      -- The free weekly'],
  reset_ignores: ['gift', 'if not stat_reset_gift_use(p_player, p_card) then', 'if true then'],
  buy_ignores: ['gift', 'elsif stat_reset_gift_use(p_player, p_card) then', 'elsif false then'],
  shop_free: ['gift', "      or exists (select 1 from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now()),\n    'gift_reset',", ",\n    'gift_reset',"],
  regrant: ['gift', "where not exists (select 1 from public.stat_reset_gifts g where g.gift = 'r_s1_2026_10');", "where true on conflict do nothing;"],
  short_deadline: ['gift', "now() + interval '14 days'", "now() + interval '1 day'"],
  auto_reset: ['gift', 'insert into public.stat_reset_gifts (player_id, gift, expires_at)', "update public.player_cards set stat_points = '{}'::jsonb where stat_points <> '{}'::jsonb;\ninsert into public.stat_reset_gifts (player_id, gift, expires_at)"],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const lines = (r.stdout || '').trim().split(/\r?\n/);
    const fails = lines.filter((l) => /^FAIL/.test(l)).length;
    const caught = r.status !== 0 && (fails > 0 || /FAILED|NO RESULTS/.test(lines[lines.length - 1] || ''));
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(16)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${(lines.find((l) => /^FAIL/.test(l)) || lines[lines.length - 1] || '').slice(0, 140)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`unknown mutation ${process.env.MUTATE}`);
  const src = m[0] === 'gift' ? gift : s1;
  if (!src.includes(m[1])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  const out = m[0] === 'gift' ? src.replace(m[1], () => m[2]) : m[0] === 's1all' ? src.split(m[1]).join(m[2]) : src.replace(m[1], () => m[2]);
  if (m[0] === 'gift') gift = out; else s1 = out;
  // The files' own guards and self-checks would also stop a mutated file. They are turned into notices, so that the TEST assertions are what catches it.
  gift = gift.replace('if m not in (f.old_md5, f.new_md5) then', 'if false then').split("raise exception 'stat_reset_gift").join("raise notice 'stat_reset_gift");
  s1 = s1.split("raise exception 'stat_points_r_stars_s1").join("raise notice 'stat_points_r_stars_s1");
}
if ([s1, gift, OLDV1].some((x) => x.includes('$m$') || x.includes('$t$'))) throw new Error('the migrations must not contain $m$ or $t$');

const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; cmb jsonb; ok boolean; bad text; i int; n int;
  rar text; a int; before jsonb; old_stars jsonb; new_stars jsonb; pts_before text; pts_after text; npl int;
  cA bigint; cB bigint; cC bigint; wk text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
  bal0 int; v_price int; base int; k text; v_exp timestamptz;
begin
  -- When the files are already applied on this copy (after the rehearsal), the block first puts the state before them back (rolled back with the block).
  if (select value->>'vitality' from balance where key = 'stat_points')::numeric = 0.05 then
    update balance set value = value || '{"attack": 0.05, "vitality": 0.06, "precision": 0.03, "potency": 0.05, "haste": 0.04}'::jsonb where key = 'stat_points';
    update balance set value = jsonb_set(jsonb_set(jsonb_set(value, '{normal}', '[1,3,4.5,5.75,7,8]'), '{illustrated_rare}', '[1,2.2,3.2,4,4.8,5.5]'), '{promo}', '[1,3,4.5,5.75,7,8]') where key = 'stars';
  end if;
  if to_regclass('public.stat_reset_gifts') is not null then execute 'delete from public.stat_reset_gifts'; end if;
  -- The state before: the stars of every rarity and star in the old curve (card_power with cp_mod 1).
  old_stars := balance_get('stars');
  select jsonb_object_agg(x.rar || x.a, card_power(x.rar, x.a, 1.0)) into before
    from (select r2 as rar, a2 as a from unnest(array['normal','illustrated_rare','secret_rare','full_art','gold','event','promo']) r2, generate_series(0, 5) a2) x;
  select coalesce(sum(length(stat_points::text)), 0)::text || ':' || count(*) into pts_before from player_cards;

  -- Fixtures (before the gift file, so each player gets a gift): tst_g1 weekly unused, tst_g2 weekly used, tst_g3 weekly used + gift expired later,
  -- tst_g4 weekly used + shards, tst_g5 weekly used with no points.
  insert into players (id, username) values ('tst_g1', 'tst g1'), ('tst_g2', 'tst g2'), ('tst_g3', 'tst g3'), ('tst_g4', 'tst g4'), ('tst_g5', 'tst g5'), ('tst_g7', 'tst g7');
  select count(*) into npl from players;
  select id into cA from cards where rarity = 'normal' and tradeable and in_draw_pool order by id limit 1;
  select id into cB from cards where rarity = 'normal' and tradeable and in_draw_pool order by id offset 1 limit 1;
  select id into cC from cards where rarity = 'normal' and tradeable and in_draw_pool order by id offset 2 limit 1;
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points) values
    ('tst_g1', cA, 1, 3, '{"attack": 4, "vitality": 3}'), ('tst_g1', cB, 1, 3, '{"haste": 5}'), ('tst_g1', cC, 1, 3, '{"potency": 2}'),
    ('tst_g2', cA, 1, 3, '{"attack": 4}'), ('tst_g2', cB, 1, 3, '{"vitality": 2}'),
    ('tst_g3', cA, 1, 3, '{"attack": 4}'),
    ('tst_g4', cA, 1, 3, '{"attack": 4}'), ('tst_g4', cB, 1, 3, '{"haste": 1}'), ('tst_g4', cC, 1, 3, '{"precision": 1}'),
    ('tst_g5', cA, 1, 3, '{}'), ('tst_g7', cA, 1, 3, '{"attack": 4}');
  update players set stat_reset_week = wk where id in ('tst_g2', 'tst_g3', 'tst_g4', 'tst_g5');
  update players set stat_reset_week = null where id in ('tst_g1', 'tst_g7');
  update settings set value = value || balance_get('shards') where key = 'shards';
  update settings set value = value || '{"enabled": true}' where key = 'shards';
  perform grant_shards('tst_g4', 1000, 'admin', 'test', 'stat gift test');
  perform grant_shards('tst_g1', 1000, 'admin', 'test', 'stat gift test');
  update balance set value = value || '{"enabled": true}' where key = 'stat_points';

  execute $m$${OLDV1}$m$;   -- M1d: the v1 functions as they were when the gift file was built
  execute $m$${s1}$m$;
  execute $m$${gift}$m$;

  -- 1. option R
  ok := (select value->>'attack' from balance where key = 'stat_points')::numeric = 0.06 and (select value->>'vitality' from balance where key = 'stat_points')::numeric = 0.05
    and (select value->>'precision' from balance where key = 'stat_points')::numeric = 0.05 and (select value->>'potency' from balance where key = 'stat_points')::numeric = 0.12
    and (select value->>'haste' from balance where key = 'stat_points')::numeric = 0.10
    and balance_num('stat_points', 'per_star') = 3 and balance_num('stat_points', 'max_per_stat') = 15 and balance_num('stat_points', 'crit_cap') = 0.6 and balance_num('stat_points', 'haste_floor') = 0.2;
  res := res || jsonb_build_object('case', 'balance stat_points = option R (attack 6, health 5, crit 5, support 12, recharge 10 per point; the other keys stay)', 'ok', ok, 'v', balance_get('stat_points'));
  cmb := card_combat('gold', 0, 1.0, '{"attack":5,"vitality":5,"precision":5,"potency":5,"haste":5}');
  res := res || jsonb_build_object('case', 'one card, 5 points in each stat: CP 140 x 1.30 = 182, HP x 1.25, crit 25%, support x 1.60, cooldown x 0.50', 'ok',
    (cmb->>'cp')::int = 182 and (cmb->>'hp')::int = round(card_max_hp(140) * 1.25) and (cmb->>'crit')::numeric = 0.25
    and (cmb->>'potency')::numeric = 1.6 and (cmb->>'haste')::numeric = 0.5, 'cmb', cmb);
  cmb := card_combat('normal', 5, 1.0, '{"attack":15}');
  res := res || jsonb_build_object('case', 'a 5-star normal with 15 Attack: 75 x 1.9 = 142.5 -> 143 (round)', 'ok', (cmb->>'cp')::int = round(75 * 1.9), 'cmb', cmb);
  cmb := card_combat('normal', 5, 1.0, '{"vitality":10}');
  res := res || jsonb_build_object('case', 'Health 10 points: +50% HP of the 75 CP card', 'ok', (cmb->>'hp')::int = round(card_max_hp(75) * 1.5), 'cmb', cmb);

  -- 2. stars S1
  res := res || jsonb_build_object('case', 'a 5-star normal = 75 CP and a 5-star illustrated rare = 140 CP (card_power and card_combat, with and without points)', 'ok',
    card_power('normal', 5, 1.0) = 75 and card_power('illustrated_rare', 5, 1.0) = 140
    and (card_combat('normal', 5, 1.0, '{}')->>'cp')::int = 75 and (card_combat('illustrated_rare', 5, 1.0, '{}')->>'cp')::int = 140,
    'n', card_power('normal', 5, 1.0), 'ir', card_power('illustrated_rare', 5, 1.0));
  new_stars := balance_get('stars');
  ok := true; bad := '';
  foreach k in array array['gold', 'event', 'full_art', 'secret_rare'] loop
    if new_stars->k is distinct from old_stars->k then ok := false; bad := bad || k || ' '; end if;
  end loop;
  res := res || jsonb_build_object('case', 'the curves of gold, event, full_art and secret_rare are the same arrays as before', 'ok', ok, 'changed', bad);
  ok := true; bad := '';
  for k in select jsonb_object_keys(new_stars) loop
    if jsonb_array_length(new_stars->k) <> 6 then ok := false; bad := bad || k || ' '; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(new_stars)) <> 7 then ok := false; end if;
  res := res || jsonb_build_object('case', 'seven rarities, each with 6 numbers (0 to 5 stars)', 'ok', ok, 'bad', bad);
  ok := true; bad := '';
  foreach rar in array array['normal','illustrated_rare','secret_rare','full_art','gold','event','promo'] loop
    if card_power(rar, 0, 1.0) is distinct from (before->>(rar || 0))::int then ok := false; bad := bad || rar || ' '; end if;
    foreach k in array array['gold', 'event', 'full_art', 'secret_rare'] loop
      if rar = k then for a in 1..5 loop
        if card_power(rar, a, 1.0) is distinct from (before->>(rar || a))::int then ok := false; bad := bad || rar || a || ' '; end if;
      end loop; end if;
    end loop;
  end loop;
  res := res || jsonb_build_object('case', '0-star power of every rarity, and gold / event / full_art / secret_rare at every star, is the same CP as before', 'ok', ok, 'bad', bad);
  ok := true;
  foreach rar in array array['normal', 'illustrated_rare'] loop
    for a in 1..5 loop
      if (new_stars->rar->>a)::numeric <= (new_stars->rar->>(a - 1))::numeric then ok := false; end if;   -- the curve still rises
    end loop;
  end loop;
  res := res || jsonb_build_object('case', 'the normal and illustrated_rare curves still rise with each star', 'ok', ok);

  -- 3. the log
  res := res || jsonb_build_object('case', 'balance_log records stat_points and stars with changed_by = nathan', 'ok',
    exists (select 1 from balance_log where key = 'stat_points' and changed_by = 'nathan' and changed_at = now())
    and exists (select 1 from balance_log where key = 'stars' and changed_by = 'nathan' and changed_at = now()));

  -- 4. the gift rows, no automatic reset, a re-run
  select count(*) into n from stat_reset_gifts where gift = 'r_s1_2026_10' and used_at is null and expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour';
  res := res || jsonb_build_object('case', 'one open gift for each player, the deadline is 14 days', 'ok', n = npl, 'gifts', n, 'players', npl);
  select coalesce(sum(length(stat_points::text)), 0)::text || ':' || count(*) into pts_after from player_cards;
  res := res || jsonb_build_object('case', 'no points were reset by the files (all stat_points of all player_cards, summed, are the same + the fixtures)', 'ok',
    (select count(*) from player_cards where player_id like 'tst_g%' and stat_points <> '{}'::jsonb) = 10
    and (select coalesce(sum(length(stat_points::text)), 0) from player_cards where player_id not like 'tst_g%') = split_part(pts_before, ':', 1)::bigint);
  ${process.env.MD5 === '1' ? `raise exception 'MD5S %', jsonb_build_object('reset', md5(replace(pg_get_functiondef('public.reset_stat_points(text, bigint)'::regprocedure), chr(13), '')), 'buy', md5(replace(pg_get_functiondef('public.buy_shop_item(text, text, integer, bigint, integer)'::regprocedure), chr(13), '')), 'shop', md5(replace(pg_get_functiondef('public.shop_today(text)'::regprocedure), chr(13), '')));` : ''}
  insert into players (id, username) values ('tst_g6', 'tst g6');   -- a player who joins after the gift: no gift on a re-run
  execute $m$${s1}$m$;
  execute $m$${gift}$m$;
  select count(*) into n from stat_reset_gifts where gift = 'r_s1_2026_10';
  res := res || jsonb_build_object('case', 'a second run of both files: no gift added (not for a new player), nothing changed', 'ok',
    n = npl and not exists (select 1 from stat_reset_gifts where player_id = 'tst_g6') and (select count(*) from stat_reset_gifts where used_at is not null) = 0, 'n', n, 'players', npl);

  -- 5. the resets
  -- g3: the gift is expired
  update stat_reset_gifts set expires_at = now() - interval '1 second' where player_id = 'tst_g3';
  -- g1: weekly unused. The Shop shows free + a gift.
  r := shop_today('tst_g1');
  res := res || jsonb_build_object('case', 'shop_today: weekly unused + a gift: free_reset true, gift_reset true, gift_reset_until set', 'ok',
    (r->>'free_reset')::boolean and (r->>'gift_reset')::boolean and r->>'gift_reset_until' is not null, 'r', r);
  r := reset_stat_points('tst_g1', cA);
  res := res || jsonb_build_object('case', 'g1 reset 1 = the weekly one (the gift stays open)', 'ok',
    (r->>'ok')::boolean and (select stat_reset_week from players where id = 'tst_g1') = wk
    and (select used_at from stat_reset_gifts where player_id = 'tst_g1') is null, 'r', r);
  r := shop_today('tst_g1');
  res := res || jsonb_build_object('case', 'shop_today after the weekly: still free (the gift)', 'ok', (r->>'free_reset')::boolean and (r->>'gift_reset')::boolean);
  r := reset_stat_points('tst_g1', cB);
  res := res || jsonb_build_object('case', 'g1 reset 2 = the gift: ok, the card is cleared, the gift row has the time and the card', 'ok',
    (r->>'ok')::boolean and (select stat_points from player_cards where player_id = 'tst_g1' and card_id = cB) = '{}'::jsonb
    and (select used_card from stat_reset_gifts where player_id = 'tst_g1') = cB and (select used_at from stat_reset_gifts where player_id = 'tst_g1') is not null, 'r', r);
  r := reset_stat_points('tst_g1', cC);
  res := res || jsonb_build_object('case', 'g1 reset 3 (reset_stat_points): refused reset_used, the points stay', 'ok',
    r->>'error' = 'reset_used' and (select stat_points from player_cards where player_id = 'tst_g1' and card_id = cC) = '{"potency": 2}'::jsonb, 'r', r);
  r := shop_today('tst_g1');
  v_price := (r->>'stat_reset_price')::int;
  res := res || jsonb_build_object('case', 'shop_today after both: not free, gift_reset false, no deadline', 'ok',
    not (r->>'free_reset')::boolean and not (r->>'gift_reset')::boolean and r->>'gift_reset_until' is null and v_price > 0, 'r', r);
  select shard_balance into bal0 from players where id = 'tst_g1';
  r := buy_shop_item('tst_g1', 'stat_reset', null, cC);
  res := res || jsonb_build_object('case', 'g1 reset 3 (Shop): paid, the Shop price is charged, the points are cleared', 'ok',
    (r->>'ok')::boolean and not (r->>'free')::boolean and (r->>'price')::int = v_price and (r->>'balance')::int = bal0 - v_price
    and (select stat_points from player_cards where player_id = 'tst_g1' and card_id = cC) = '{}'::jsonb, 'r', r);

  -- g2: weekly used + a gift. The Shop reset is free, once.
  r := shop_today('tst_g2');
  res := res || jsonb_build_object('case', 'shop_today, weekly used + a gift: free_reset true, gift_reset true', 'ok', (r->>'free_reset')::boolean and (r->>'gift_reset')::boolean, 'r', r);
  r := buy_shop_item('tst_g2', 'stat_reset', null, cA);
  res := res || jsonb_build_object('case', 'g2 Shop reset with the gift: free, 0 Shards, the card cleared, the gift row names the card', 'ok',
    (r->>'ok')::boolean and (r->>'free')::boolean and (r->>'price')::int = 0
    and (select stat_points from player_cards where player_id = 'tst_g2' and card_id = cA) = '{}'::jsonb
    and (select used_card from stat_reset_gifts where player_id = 'tst_g2') = cA
    and exists (select 1 from shop_purchases where player_id = 'tst_g2' and kind = 'stat_reset' and card_id = cA and price = 0), 'r', r);
  r := buy_shop_item('tst_g2', 'stat_reset', null, cB);
  res := res || jsonb_build_object('case', 'g2 second Shop reset: no Shards, no free reset: refused not_enough, the points stay', 'ok',
    r->>'error' = 'not_enough' and (select stat_points from player_cards where player_id = 'tst_g2' and card_id = cB) = '{"vitality": 2}'::jsonb, 'r', r);
  r := reset_stat_points('tst_g2', cB);
  res := res || jsonb_build_object('case', 'g2 reset_stat_points after the gift: refused reset_used', 'ok', r->>'error' = 'reset_used', 'r', r);

  -- g3: the gift is expired
  r := shop_today('tst_g3');
  res := res || jsonb_build_object('case', 'g3 (gift expired, weekly used): not free, gift_reset false', 'ok', not (r->>'free_reset')::boolean and not (r->>'gift_reset')::boolean, 'r', r);
  r := reset_stat_points('tst_g3', cA);
  res := res || jsonb_build_object('case', 'g3 reset with an expired gift: refused reset_used, the gift stays unused', 'ok',
    r->>'error' = 'reset_used' and (select used_at from stat_reset_gifts where player_id = 'tst_g3') is null, 'r', r);

  -- g4: refused resets never use the gift; the gift then covers one; the paid one after
  r := reset_stat_points('tst_g4', 9999999);
  res := res || jsonb_build_object('case', 'g4 a card the player does not own: not_owned, the gift stays', 'ok',
    r->>'error' = 'not_owned' and (select used_at from stat_reset_gifts where player_id = 'tst_g4') is null, 'r', r);
  r := buy_shop_item('tst_g4', 'stat_reset', null, 9999999);
  res := res || jsonb_build_object('case', 'g4 Shop: a card not owned: not_owned, the gift stays', 'ok',
    r->>'error' = 'not_owned' and (select used_at from stat_reset_gifts where player_id = 'tst_g4') is null, 'r', r);
  r := reset_stat_points('tst_g5', cA);
  res := res || jsonb_build_object('case', 'g5 a card with no points: nothing_spent, the gift stays', 'ok',
    r->>'error' = 'nothing_spent' and (select used_at from stat_reset_gifts where player_id = 'tst_g5') is null, 'r', r);
  r := buy_shop_item('tst_g5', 'stat_reset', null, cA);
  res := res || jsonb_build_object('case', 'g5 Shop: nothing_spent, the gift stays', 'ok',
    r->>'error' = 'nothing_spent' and (select used_at from stat_reset_gifts where player_id = 'tst_g5') is null, 'r', r);
  r := buy_shop_item('tst_g4', 'stat_reset', null, cA);
  ok := (r->>'ok')::boolean and (r->>'free')::boolean;
  r := buy_shop_item('tst_g4', 'stat_reset', null, cB);
  res := res || jsonb_build_object('case', 'g4: the gift covers one reset, the next costs Shards (the paid reset works as before)', 'ok',
    ok and (r->>'ok')::boolean and not (r->>'free')::boolean and (r->>'price')::int = v_price and (r->>'balance')::int = 1000 - v_price, 'r', r);
  -- g7: weekly unused + a gift: the Shop reset uses the WEEKLY one (the gift stays for later)
  r := buy_shop_item('tst_g7', 'stat_reset', null, cA);
  res := res || jsonb_build_object('case', 'g7 Shop reset, weekly unused: free by the weekly reset (week marked), the gift stays open', 'ok',
    (r->>'ok')::boolean and (r->>'free')::boolean and (select stat_reset_week from players where id = 'tst_g7') = wk
    and (select used_at from stat_reset_gifts where player_id = 'tst_g7') is null, 'r', r);
  -- the same gift cannot be used twice at once (the row is marked): a third reset is paid again
  r := buy_shop_item('tst_g4', 'stat_reset', null, cC);
  res := res || jsonb_build_object('case', 'g4: a third reset is paid too (one gift = one reset)', 'ok',
    (r->>'ok')::boolean and not (r->>'free')::boolean and (select count(*) from stat_reset_gifts where player_id = 'tst_g4' and used_at is not null) = 1, 'r', r);

  -- 6. the table is private
  res := res || jsonb_build_object('case', 'stat_reset_gifts: RLS on, no anon or authenticated privilege; the helper is not callable by them', 'ok',
    (select relrowsecurity from pg_class where oid = 'public.stat_reset_gifts'::regclass)
    and not has_table_privilege('anon', 'public.stat_reset_gifts', 'select') and not has_table_privilege('authenticated', 'public.stat_reset_gifts', 'select')
    and not has_function_privilege('anon', 'public.stat_reset_gift_use(text, bigint)', 'execute')
    and not has_function_privilege('authenticated', 'public.stat_reset_gift_use(text, bigint)', 'execute'));
  -- the table rejects a used row with no card
  ok := false;
  begin update stat_reset_gifts set used_at = now(), used_card = null where player_id = 'tst_g5'; exception when check_violation then ok := true; end;
  res := res || jsonb_build_object('case', 'the table refuses a used gift with no card', 'ok', ok);

  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body));
const md5 = out.match(/MD5S (\{[^}]*\})/);
if (md5) { console.log(md5[1].replace(/\\"/g, '"')); process.exit(0); }
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
