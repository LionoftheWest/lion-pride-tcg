/**
 * Acceptance test for tcg-bot/supabase/shards_shop.sql on the LIVE database, NO lasting change:
 *   node scripts/test-shards-shop.mjs            (one DO block; the final RAISE rolls it all back)
 *   MUTATE=cooldown node scripts/test-shards-shop.mjs   must FAIL (the 7-day cooldown removed)
 *   MUTATE=held     node scripts/test-shards-shop.mjs   must FAIL (convert ignores held copies)
 *   MUTATE=balance  node scripts/test-shards-shop.mjs   must FAIL (a card buy skips the balance check)
 *   MUTATE=free     node scripts/test-shards-shop.mjs   must FAIL (a reset never uses the free weekly reset)
 *   MUTATE=freeleak node scripts/test-shards-shop.mjs   must FAIL (the free reset is never marked used)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/shards_shop.sql', import.meta.url)), 'utf8')
  .replace(/notify pgrst[^\n]*\n/g, '');
const MUT = {
  cooldown: ['and not exists (select 1 from shop_stock s where s.card_id = c.id\n                                and s.day > p_day - v_cool and s.day < p_day)', ''],
  held: ['greatest(0, free_copies(p_player, p_card) - 1', 'greatest(0, (select quantity from player_cards where player_id = p_player and card_id = p_card) - 1'],
  balance: ["if v_bal < s.price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', s.price); end if;", ''],
  free: ['if v_used is distinct from v_week then', 'if false then'],
  freeleak: ['      update players set stat_reset_week = v_week where id = p_player;\n', ''],
};
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.replace(m[0], m[1]);
}
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const body = String.raw`do $t$
declare bad text := ''; r jsonb; d date := date '2099-01-05'; i int; j int; n int;
  sr bigint; nm bigint; nm2 bigint; ev bigint; c_sr bigint; v_week text;
  ok boolean;
begin
  execute $m$${mig}$m$;
  update settings set value = value || '{"enabled": true}' where key = 'shards';

  -- 1. The daily stock: 10 cards (6 / 3 / 1), the right tiers, only draw-pool cards, idempotent.
  n := shop_pick_stock(d);
  if n <> 10 then bad := bad || 'stock size ' || n || '; '; end if;
  if (select count(*) from shop_stock where day = d and rarity = 'normal') <> 6
     or (select count(*) from shop_stock where day = d and rarity = 'illustrated_rare') <> 3
     or (select count(*) from shop_stock where day = d and rarity = 'secret_rare') <> 1 then bad := bad || 'stock mix; '; end if;
  if exists (select 1 from shop_stock s join cards c on c.id = s.card_id where s.day = d
               and (c.rarity::text <> s.rarity or c.rarity::text in ('gold', 'full_art', 'event', 'promo') or not c.in_draw_pool)) then
    bad := bad || 'stock has a forbidden card; '; end if;
  if shop_pick_stock(d) <> 10 or (select count(*) from shop_stock where day = d) <> 10 then bad := bad || 'stock not idempotent; '; end if;
  -- Nathan's prices (2026-10-02): Normal 100, Illustrated Rare 450, Secret Rare 1,500, a pack 250, a stat reset 150.
  if exists (select 1 from shop_stock where day = d and price <> case rarity when 'normal' then 100 when 'illustrated_rare' then 450 when 'secret_rare' then 1500 end) then
    bad := bad || 'stock prices; '; end if;
  if (shop_today('tst_nobody')->>'pack_price')::int <> 250 or (shop_today('tst_nobody')->>'stat_reset_price')::int <> 150 then
    bad := bad || 'pack / reset price; '; end if;

  -- 2. The 7-day cooldown: days d .. d+6 never share a card. On d+7, with a stock of "every
  --    eligible Secret Rare", the Secret Rare of day d is back and the ones of d+1 .. d+6 are not.
  for i in 1..6 loop perform shop_pick_stock(d + i); end loop;
  if (select count(*) - count(distinct card_id) from shop_stock where day between d and d + 6) <> 0 then
    bad := bad || 'a card repeats inside 7 days; '; end if;
  update settings set value = jsonb_set(value, '{stock}', '{"normal": 0, "illustrated_rare": 0, "secret_rare": 1000}') where key = 'shards';
  perform shop_pick_stock(d + 7);
  if not exists (select 1 from shop_stock a join shop_stock b on b.card_id = a.card_id where a.day = d and a.rarity = 'secret_rare' and b.day = d + 7) then
    bad := bad || 'day-7 card not back; '; end if;
  if exists (select 1 from shop_stock a join shop_stock b on b.card_id = a.card_id where a.day between d + 1 and d + 6 and b.day = d + 7) then
    bad := bad || 'a card back before 7 days; '; end if;
  update settings set value = jsonb_set(value, '{stock}', '{"normal": 6, "illustrated_rare": 3, "secret_rare": 1}') where key = 'shards';

  -- 3. Buying. Today's stock; member A starts with 0 Shards.
  delete from shop_stock where day = shop_day();  -- a fresh stock for this test only (rolled back)
  perform shop_pick_stock(shop_day());
  select card_id, slot into c_sr, j from shop_stock where day = shop_day() and rarity = 'secret_rare';
  insert into players (id, username) values ('tst_sh_a', 'shard a'), ('tst_sh_b', 'shard b'), ('tst_sh_c', 'shard c');
  r := buy_shop_item('tst_sh_a', 'card', j);
  if (r->>'ok')::boolean or r->>'error' <> 'not_enough' then bad := bad || 'buy with 0 shards ' || r::text || '; '; end if;
  if exists (select 1 from player_cards where player_id = 'tst_sh_a') then bad := bad || 'card given with 0 shards; '; end if;
  if grant_shards('tst_sh_a', 2500, 'admin') <> 2500 then bad := bad || 'grant; '; end if;
  if grant_shards('tst_nobody', 5, 'admin') is not null then bad := bad || 'grant to nobody; '; end if;
  r := buy_shop_item('tst_sh_a', 'card', j);
  if not (r->>'ok')::boolean or (r->>'balance')::int <> 1000 then bad := bad || 'buy sr ' || r::text || '; '; end if;
  if (select first_source from player_cards where player_id = 'tst_sh_a' and card_id = c_sr) is distinct from 'shop' then
    bad := bad || 'shop card shows as a pull; '; end if;
  r := buy_shop_item('tst_sh_a', 'card', j);
  if (r->>'ok')::boolean or r->>'error' <> 'bought' then bad := bad || 'bought twice ' || r::text || '; '; end if;
  if not ((select e->>'bought' from jsonb_array_elements(shop_today('tst_sh_a')->'stock') e where (e->>'slot')::int = j))::boolean then
    bad := bad || 'shop_today bought flag; '; end if;
  if (buy_shop_item('tst_sh_a', 'card', 99)->>'error') <> 'no_slot' then bad := bad || 'slot 99; '; end if;

  -- 4. Packs: no limit on Shop packs, and they do not count toward the 5-pack earn limit.
  i := (select pack_balance from players where id = 'tst_sh_a');
  r := buy_shop_item('tst_sh_a', 'pack', null, null, 3);
  if not (r->>'ok')::boolean or (r->>'balance')::int <> 250 or (r->>'packs')::int <> i + 3 then bad := bad || 'buy packs ' || r::text || '; '; end if;
  if earned_today('tst_sh_a') <> 0 then bad := bad || 'shop packs count as earned; '; end if;
  if (select sum(amount) from pack_ledger where player_id = 'tst_sh_a' and reason = 'shop') <> 3 then bad := bad || 'pack ledger; '; end if;
  if (buy_shop_item('tst_sh_a', 'pack', null, null, 11)->>'error') <> 'bad_qty' or (buy_shop_item('tst_sh_a', 'pack', null, null, 0)->>'error') <> 'bad_qty' then
    bad := bad || 'pack qty bounds; '; end if;
  if (buy_shop_item('tst_sh_a', 'pack', null, null, 3)->>'error') <> 'not_enough' then bad := bad || 'packs over balance; '; end if;

  -- 5. The balance never goes below 0, and the ledger always sums to the balance.
  ok := false;
  begin perform grant_shards('tst_sh_a', -100000, 'admin'); exception when check_violation then ok := true; end;
  if not ok then bad := bad || 'negative balance allowed; '; end if;
  if (select sum(amount) from shard_ledger where player_id = 'tst_sh_a') <> (select shard_balance from players where id = 'tst_sh_a') then
    bad := bad || 'ledger <> balance; '; end if;

  -- 6. The stat reset uses the free weekly reset first (0 Shards, the week marked used); the
  --    next reset in the same week costs 150 (Nathan, 2026-10-02).
  select id into nm from cards where rarity = 'normal' and tradeable and in_draw_pool order by id limit 1;
  select id into nm2 from cards where rarity = 'normal' and tradeable and in_draw_pool order by id offset 1 limit 1;
  v_week := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points) values ('tst_sh_c', nm, 1, 1, '{"attack": 3}');
  update players set stat_reset_week = null where id = 'tst_sh_c';
  perform grant_shards('tst_sh_c', 200, 'admin');
  if not (shop_today('tst_sh_c')->>'free_reset')::boolean then bad := bad || 'free reset not offered; '; end if;
  r := buy_shop_item('tst_sh_c', 'stat_reset', null, nm);
  if not (r->>'ok')::boolean or not (r->>'free')::boolean or (r->>'balance')::int <> 200 then bad := bad || 'free reset ' || r::text || '; '; end if;
  if (select stat_points from player_cards where player_id = 'tst_sh_c' and card_id = nm) <> '{}'::jsonb then bad := bad || 'points not cleared (free); '; end if;
  if (select stat_reset_week from players where id = 'tst_sh_c') is distinct from v_week then bad := bad || 'free reset not marked used; '; end if;
  if (shop_today('tst_sh_c')->>'free_reset')::boolean then bad := bad || 'free reset offered twice; '; end if;
  update player_cards set stat_points = '{"vitality": 3}' where player_id = 'tst_sh_c' and card_id = nm;
  r := buy_shop_item('tst_sh_c', 'stat_reset', null, nm);
  if not (r->>'ok')::boolean or (r->>'free')::boolean or (r->>'balance')::int <> 50 then bad := bad || 'paid reset ' || r::text || '; '; end if;
  if (select stat_points from player_cards where player_id = 'tst_sh_c' and card_id = nm) <> '{}'::jsonb then bad := bad || 'points not cleared (paid); '; end if;
  if (buy_shop_item('tst_sh_c', 'stat_reset', null, nm)->>'error') <> 'nothing_spent' then bad := bad || 'reset with no points; '; end if;

  -- 7. Convert extras: keep 1 copy and the copies that ascension still needs; held copies never convert.
  select id into sr from cards where rarity = 'secret_rare' and in_draw_pool order by id limit 1;
  insert into player_cards (player_id, card_id, quantity, ascension) values ('tst_sh_b', sr, 4, 5), ('tst_sh_b', nm, 50, 0);
  if convertible_copies('tst_sh_b', sr) <> 3 then bad := bad || 'convertible maxed ' || convertible_copies('tst_sh_b', sr) || '; '; end if;
  if (convert_dupes('tst_sh_b', sr, 4)->>'error') <> 'too_many' then bad := bad || 'convert too many; '; end if;
  r := convert_dupes('tst_sh_b', sr, 3);
  if not (r->>'ok')::boolean or (r->>'shards')::int <> 120 or (r->>'quantity')::int <> 1 then bad := bad || 'convert ' || r::text || '; '; end if;
  n := 50 - 1 - (select sum(ascend_cost('normal', a)) from generate_series(0, 4) a)::int;
  if convertible_copies('tst_sh_b', nm) <> greatest(n, 0) then bad := bad || 'convertible normal ' || convertible_copies('tst_sh_b', nm) || '; '; end if;
  r := start_auction('tst_sh_b', nm, null, 0, '{}', 'and', 2);
  if not (r->>'ok')::boolean then bad := bad || 'auction ' || r::text || '; '; end if;
  if convertible_copies('tst_sh_b', nm) <> greatest(n - 1, 0) then bad := bad || 'held copy converts; '; end if;
  select id into ev from cards where rarity::text = 'event' order by id limit 1;
  if ev is not null then
    insert into player_cards (player_id, card_id, quantity) values ('tst_sh_b', ev, 3);
    if (convert_dupes('tst_sh_b', ev, 1)->>'error') <> 'no_value' then bad := bad || 'event converts; '; end if;
  end if;

  -- 8. The flag OFF: every Shop RPC refuses.
  update settings set value = value || '{"enabled": false}' where key = 'shards';
  if (buy_shop_item('tst_sh_a', 'pack', null, null, 1)->>'error') <> 'disabled'
     or (shop_today('tst_sh_a')->>'error') <> 'disabled'
     or (convert_dupes('tst_sh_b', nm, 1)->>'error') <> 'disabled' then bad := bad || 'flag off not refused; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = msg.match(/RESULT:([^"\\]*)/);
if (!m) { console.error('NO RESULT:', msg.slice(0, 2000)); process.exitCode = 1; }
else if (m[1] === 'PASS') console.log(`PASS${process.env.MUTATE ? ` (MUTATE=${process.env.MUTATE}: the test did NOT catch it)` : ''}`);
else { console.log(`FAIL: ${m[1]}`); process.exitCode = 1; }
